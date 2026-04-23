/**
 * Cognito User Pool — identity + authorization for the AV Inventory platform.
 *
 * Groups (4):
 *   - Admin       — full CRUD on everything, financial visibility, user mgmt
 *   - Logistics   — GRN, DC, transfers, service tickets, label printing
 *   - Purchase    — PO, BOQ, import cost estimator, vendor mgmt
 *   - Sales       — read-only on projects/clients, invoice upload + payment status
 *
 * Security:
 *   - Password policy: 8+ chars, upper, number, special
 *   - Session idle TTL: 30 min (configurable per env via COGNITO_IDLE_SESSION_TTL_SECONDS)
 *   - MFA optional per user; Admin group can be force-enforced via pre-token-generation trigger
 *
 * Post-synth hardening for refresh token rotation + advanced security mode is
 * applied in `amplify/custom/cognito-hardening.ts` (imported by backend.ts).
 */
import { defineAuth } from "@aws-amplify/backend";

const idleTtl = Number(process.env.COGNITO_IDLE_SESSION_TTL_SECONDS ?? 1800);

export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: "CODE",
      verificationEmailSubject: "Verify your AV Inventory account",
      verificationEmailBody: (createCode) =>
        `Welcome to the AV Inventory platform. Your verification code is ${createCode()}. This code expires in 24 hours.`,
    },
  },

  userAttributes: {
    // Core identity
    givenName: { required: true, mutable: true },
    familyName: { required: true, mutable: true },
    phoneNumber: { required: false, mutable: true },

    // App-specific attributes
    "custom:role": {
      dataType: "String",
      mutable: true,
      maxLen: 32,
    },
    "custom:staffId": {
      dataType: "String",
      mutable: false,
      maxLen: 64,
    },
    "custom:department": {
      dataType: "String",
      mutable: true,
      maxLen: 64,
    },
  },

  groups: ["Admin", "Logistics", "Purchase", "Sales"],

  // Optional per-user MFA. Admin group enforcement is handled via a
  // pre-token-generation Lambda trigger (added in cognito-hardening.ts).
  multifactor: {
    mode: "OPTIONAL",
    sms: true,
    totp: true,
  },

  accountRecovery: "EMAIL_ONLY",

  /**
   * NB: Amplify Gen 2 `defineAuth` does not yet expose `idleSessionTTL`
   * directly. We apply it via a post-synth override to the CfnUserPool
   * in `amplify/custom/cognito-hardening.ts`, reading this value.
   */
});

// Re-export the idle TTL value so the hardening module can pick it up
// without re-reading process.env.
export const COGNITO_IDLE_TTL_SECONDS = idleTtl;
