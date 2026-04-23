/**
 * Amplify Gen 2 doesn't export a clean type for the `defineBackend` return
 * value (it's generic over the caller's resource dictionary), and the custom
 * constructs in this folder all need to reach into `backend.data.stack`,
 * `backend.<fnName>.resources.lambda`, etc.
 *
 * Rather than plumbing a massive generic through every helper, we define a
 * minimal structural type that captures only the properties we actually use.
 * Runtime still gets the real rich object; compile-time just has to agree
 * that the shape exists.
 */
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type { Stack } from "aws-cdk-lib";

export interface FunctionResources {
  resources: { lambda: IFunction };
}

export interface MinimalBackend {
  data: { stack: Stack; resources?: Record<string, unknown> };
  stack: Stack;
  /** Any function added via `defineBackend({...fns})` is on the backend object. */
  [key: string]: unknown;
  /** Amplify-provided helper that merges outputs emitted to amplify_outputs.json. */
  addOutput: (output: Record<string, unknown>) => void;
}

/** Narrow `unknown` to FunctionResources at runtime + type boundary. */
export function asFn(backend: MinimalBackend, key: string): FunctionResources {
  const fn = backend[key] as FunctionResources | undefined;
  if (!fn || !fn.resources || !fn.resources.lambda) {
    throw new Error(
      `Custom construct expected backend.${key} to be a resolved Lambda resource. ` +
        `Is it in the defineBackend() call in amplify/backend.ts?`,
    );
  }
  return fn;
}
