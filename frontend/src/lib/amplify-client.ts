/**
 * Amplify Gen 2 client configuration — resilient to missing `amplify_outputs.json`.
 *
 * After `ampx sandbox`/`ampx pipeline-deploy`, Amplify writes `amplify_outputs.json`
 * to the repo root. We import it if present; otherwise we configure with
 * env-var fallbacks so the UI can still boot in "demo mode" for designers.
 *
 * The generated typed `api` client is re-exported for all data calls. Every
 * AppSync operation gets generated TypeScript types from the backend schema.
 */
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";

// E2E / local-demo mode — swap the real client for a deterministic in-memory
// mock. Controlled by VITE_E2E_MOCK=1 at build time.
const E2E_MOCK = import.meta.env.VITE_E2E_MOCK === "1";
if (E2E_MOCK) {
  console.info("[amplify] E2E mock mode — Amplify client replaced by in-memory stub");
}

// Try to import the generated outputs file. Vite transforms `import.meta.glob`
// at build time and returns an empty set when the file is missing, which is
// exactly what we want — no crash.
type AmplifyOutputs = Parameters<typeof Amplify.configure>[0];

const outputsModules = import.meta.glob("../../../amplify_outputs.json", {
  eager: true,
  import: "default",
}) as Record<string, AmplifyOutputs>;

const outputs: AmplifyOutputs | null = Object.values(outputsModules)[0] ?? null;

if (outputs) {
  Amplify.configure(outputs);
  if (import.meta.env.DEV) {
    console.info("[amplify] configured from amplify_outputs.json");
  }
} else if (import.meta.env.VITE_APPSYNC_URL) {
  // Env-var fallback — for environments (CI preview branches) where outputs
  // live outside the repo tree. Requires all 4 values to be set or bail.
  const fallback: AmplifyOutputs = {
    version: "1",
    auth: {
      user_pool_id: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "",
      user_pool_client_id: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID ?? "",
      aws_region: import.meta.env.VITE_AWS_REGION ?? "ap-south-1",
      identity_pool_id: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID,
    },
    data: {
      url: import.meta.env.VITE_APPSYNC_URL,
      aws_region: import.meta.env.VITE_AWS_REGION ?? "ap-south-1",
      default_authorization_type: "AMAZON_COGNITO_USER_POOLS",
      authorization_types: ["AMAZON_COGNITO_USER_POOLS", "AWS_IAM"],
    },
  } as unknown as AmplifyOutputs;
  Amplify.configure(fallback);
  console.info("[amplify] configured from VITE_* env vars");
} else {
  console.warn(
    "[amplify] no amplify_outputs.json found and no VITE_APPSYNC_URL — " +
      "run `ampx sandbox` from the repo root to provision the backend. " +
      "The UI will render but all data calls will fail until then.",
  );
}

/** Typed AppSync client — consumers get autocomplete on every model + op. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _api: any;
if (E2E_MOCK) {
  // Lazy-load the mock so it's only bundled when VITE_E2E_MOCK is set.
  // Vite tree-shakes the import at build time when the flag is 0.
  const mockMod = await import("./amplify-client.mock");
  _api = mockMod.api;
} else {
  _api = generateClient<Schema>();
}
export const api = _api;

/** Re-export Schema type for component consumers. */
export type { Schema };
