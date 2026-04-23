/**
 * user-admin â€” Cognito user-pool administration via AppSync.
 *
 * Operations (Admin-group only at the AppSync layer):
 *   - LIST:   list up to 60 users with email + enabled + group memberships
 *   - CREATE: invite a new user (adminCreateUser with SUPPRESS suppressing the
 *             Cognito default email; we send our own invite through SES)
 *   - ADD_GROUP / REMOVE_GROUP: manage Admin / Logistics / Purchase / Sales roles
 *   - RESET_PASSWORD: force the user into a password-reset flow at next login
 *   - DISABLE / ENABLE: toggle account access without deleting history
 *   - DELETE: permanent removal (rare; requires explicit Admin action)
 *
 * The user-pool ID is read from the standard Amplify env var that Amplify Gen 2
 * injects into Lambdas that declare auth access; for local invoke we fall back
 * to AMPLIFY_AUTH_USERPOOL_ID.
 */
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  AdminResetUserPasswordCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  MessageActionType,
  DeliveryMediumType,
} from "@aws-sdk/client-cognito-identity-provider";

type Op =
  | "LIST"
  | "CREATE"
  | "ADD_GROUP"
  | "REMOVE_GROUP"
  | "RESET_PASSWORD"
  | "DISABLE"
  | "ENABLE"
  | "DELETE";

interface Input {
  op: Op;
  email?: string;
  givenName?: string;
  familyName?: string;
  role?: string;
  username?: string;
  limit?: number;
}

interface UserRow {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  createdAt?: string;
  groups?: string[];
}

interface Output {
  users?: UserRow[];
  affected?: string;
  error?: string;
}

const REGION = process.env.AWS_REGION ?? "ap-south-1";
let _client: CognitoIdentityProviderClient | undefined;
function cognito(): CognitoIdentityProviderClient {
  _client ??= new CognitoIdentityProviderClient({ region: REGION });
  return _client;
}

function userPoolId(): string {
  const id =
    process.env.AMPLIFY_AUTH_USERPOOL_ID ??
    process.env.COGNITO_USER_POOL_ID ??
    process.env.USER_POOL_ID;
  if (!id) {
    throw new Error(
      "User pool ID not available. Make sure this Lambda is granted access to the auth resource in backend.ts.",
    );
  }
  return id;
}

export const handler = async (rawEvent: Input | { arguments?: Input }): Promise<Output> => {
  // Support both CLI-invoke and AppSync resolver shapes.
  const event: Input = (rawEvent as { arguments?: Input })?.arguments ?? (rawEvent as Input);
  if (!event?.op) throw new Error("op is required");
  const UserPoolId = userPoolId();

  switch (event.op) {
    case "LIST":
      return { users: await listUsers(UserPoolId, event.limit ?? 60) };

    case "CREATE":
      if (!event.email) throw new Error("email is required");
      await cognito().send(
        new AdminCreateUserCommand({
          UserPoolId,
          Username: event.email,
          UserAttributes: [
            { Name: "email", Value: event.email },
            { Name: "email_verified", Value: "true" },
            event.givenName ? { Name: "given_name", Value: event.givenName } : null,
            event.familyName ? { Name: "family_name", Value: event.familyName } : null,
          ].filter(Boolean) as Array<{ Name: string; Value: string }>,
          DesiredDeliveryMediums: [DeliveryMediumType.EMAIL],
          MessageAction: MessageActionType.SUPPRESS,
          // Temporary password â€” Cognito will force change on first login.
          TemporaryPassword: generateTempPassword(),
        }),
      );
      if (event.role) {
        await cognito().send(
          new AdminAddUserToGroupCommand({
            UserPoolId,
            Username: event.email,
            GroupName: event.role,
          }),
        );
      }
      return { affected: event.email };

    case "ADD_GROUP":
      if (!event.username || !event.role) throw new Error("username + role required");
      await cognito().send(
        new AdminAddUserToGroupCommand({
          UserPoolId,
          Username: event.username,
          GroupName: event.role,
        }),
      );
      return { affected: event.username };

    case "REMOVE_GROUP":
      if (!event.username || !event.role) throw new Error("username + role required");
      await cognito().send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId,
          Username: event.username,
          GroupName: event.role,
        }),
      );
      return { affected: event.username };

    case "RESET_PASSWORD":
      if (!event.username) throw new Error("username required");
      await cognito().send(
        new AdminResetUserPasswordCommand({
          UserPoolId,
          Username: event.username,
        }),
      );
      return { affected: event.username };

    case "DISABLE":
      if (!event.username) throw new Error("username required");
      await cognito().send(
        new AdminDisableUserCommand({ UserPoolId, Username: event.username }),
      );
      return { affected: event.username };

    case "ENABLE":
      if (!event.username) throw new Error("username required");
      await cognito().send(
        new AdminEnableUserCommand({ UserPoolId, Username: event.username }),
      );
      return { affected: event.username };

    case "DELETE":
      if (!event.username) throw new Error("username required");
      await cognito().send(
        new AdminDeleteUserCommand({ UserPoolId, Username: event.username }),
      );
      return { affected: event.username };

    default:
      throw new Error(`Unknown op: ${String(event.op)}`);
  }
};

async function listUsers(UserPoolId: string, limit: number): Promise<UserRow[]> {
  const res = await cognito().send(
    new ListUsersCommand({ UserPoolId, Limit: Math.min(limit, 60) }),
  );
  const rows: UserRow[] = [];
  for (const u of res.Users ?? []) {
    const username = u.Username ?? "";
    const emailAttr = (u.Attributes ?? []).find((a) => a.Name === "email");
    const email = emailAttr?.Value ?? "";

    // Resolve group memberships â€” one extra call per user, but total users per
    // pool is typically small (< 100 employees). For larger tenants add a
    // DynamoDB-backed cache.
    let groups: string[] = [];
    try {
      const g = await cognito().send(
        new AdminListGroupsForUserCommand({ UserPoolId, Username: username }),
      );
      groups = (g.Groups ?? []).map((x) => x.GroupName ?? "").filter(Boolean);
    } catch {
      // best-effort
    }

    rows.push({
      username,
      email,
      enabled: u.Enabled ?? false,
      status: u.UserStatus ?? "UNKNOWN",
      createdAt: u.UserCreateDate?.toISOString(),
      groups,
    });
  }
  return rows;
}

/** Random password that satisfies the default Cognito policy. */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;
  const pick = (src: string) => src[Math.floor(Math.random() * src.length)]!;
  const core =
    pick(upper) +
    pick(lower) +
    pick(digits) +
    pick(symbols) +
    Array.from({ length: 10 }, () => pick(all)).join("");
  return core.split("").sort(() => Math.random() - 0.5).join("");
}
