/**
 * Secrets Manager helper with in-container caching.
 *
 * A warm Lambda keeps the decrypted secret in memory for the lifetime of the
 * container (up to CACHE_TTL_MS). Cold starts pay the Secrets Manager latency
 * once; subsequent invocations of the same container skip the network hop.
 */
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { secretsClient } from "./aws-clients.js";

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Returns the raw SecretString value for a secret ID. Intended for secrets
 * stored as a JSON object like `{"apiKey": "..."}`.
 */
export async function getSecretString(secretId: string): Promise<string> {
  const cached = cache.get(secretId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const res = await secretsClient().send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = res.SecretString;
  if (!value) {
    throw new Error(`Secret "${secretId}" has no SecretString (binary secrets not supported).`);
  }
  cache.set(secretId, { value, fetchedAt: Date.now() });
  return value;
}

/**
 * Fetch a JSON secret and extract a specific field.
 * Throws if the field is missing or the secret isn't valid JSON.
 */
export async function getSecretField(secretId: string, field: string): Promise<string> {
  const raw = await getSecretString(secretId);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Secret "${secretId}" is not valid JSON — cannot extract field "${field}".`);
  }
  const val = parsed[field];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`Secret "${secretId}" JSON has no string field "${field}".`);
  }
  return val;
}

/** Test-only helper. Clears the in-memory secret cache. */
export function _clearSecretsCacheForTests(): void {
  cache.clear();
}
