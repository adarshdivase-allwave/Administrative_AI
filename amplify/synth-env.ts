/**
 * Runs before other `amplify/**/resource` modules during CDK synthesis.
 * When `APP_ENV` is unset, derives it from `AWS_BRANCH` (Amplify Hosting /
 * `ampx pipeline-deploy`) so hosted `main` uses `prod` and does not collide
 * with local sandbox resources that default to `dev`.
 */
function sanitizeBranchSegment(branch: string): string {
  const s = branch
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 28);
  return s || "hosting";
}

function defaultFromBranch(): string {
  const b = process.env.AWS_BRANCH?.trim();
  if (!b) return "dev";
  if (b === "main" || b === "master") return "prod";
  if (b === "staging") return "staging";
  return sanitizeBranchSegment(b);
}

const raw = process.env.APP_ENV?.trim();
if (!raw) {
  process.env.APP_ENV = defaultFromBranch();
} else {
  process.env.APP_ENV = raw.toLowerCase();
}

export const APP_ENV = process.env.APP_ENV;
