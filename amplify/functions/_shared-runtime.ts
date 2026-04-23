/**
 * Common Lambda runtime config — every function in this project is Node 20
 * with bundled TypeScript, ARM64 for cost, 30s default timeout (overridable
 * per function), and 512 MB memory (overridable).
 *
 * Functions that do heavy work (boq-parser for 10 MB Excel files, chatbot for
 * OpenSearch RAG + Gemini calls) bump memory/timeout in their own resource.ts.
 */
/** Amplify Gen 2 function option shape (the public FunctionProps type
 *  isn't re-exported, so we describe the shape we actually use). */
export interface RuntimeProfile {
  runtime: 20;
  architecture: "arm64" | "x86_64";
  timeoutSeconds: number;
  memoryMB: number;
}

export const DEFAULT_RUNTIME: RuntimeProfile = {
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
  architecture: "arm64",
};

/** Lambdas that run on a schedule (not on-demand) get this profile. */
export const SCHEDULED_RUNTIME: RuntimeProfile = {
  ...DEFAULT_RUNTIME,
  timeoutSeconds: 300, // 5 min — enough for full-table scans
  memoryMB: 1024,
};

/** Heavy-compute Lambdas (BOQ parse, chatbot, Tally XML large exports). */
export const HEAVY_RUNTIME: RuntimeProfile = {
  ...DEFAULT_RUNTIME,
  timeoutSeconds: 120,
  memoryMB: 1536,
};
