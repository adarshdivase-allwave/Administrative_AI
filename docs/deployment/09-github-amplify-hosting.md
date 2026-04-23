# GitHub → AWS Amplify Hosting (continuous deployment)

This repository includes an `amplify.yml` at the **root**. When Amplify Hosting is connected to GitHub, **every push** to the linked branch triggers a build that:

1. Runs **`npx ampx pipeline-deploy`** — deploys / updates the Gen 2 backend (AppSync, Cognito, Lambdas, DynamoDB, etc.) for that branch.
2. Builds the **Vite frontend** from `frontend/` and publishes `frontend/dist`.

## One-time: connect GitHub in the AWS Console

1. Sign in to **AWS Console** → **AWS Amplify** → **All apps**.
2. Open your app (for example **AV-Inventory-AdministrativeAI**), or choose **Create new app** → **Host web app** if you are starting fresh.
3. Choose **GitHub**. When prompted, **authorize AWS Amplify** for your GitHub account (OAuth). This is the standard, recommended method (no long-lived personal access token stored in Amplify unless you choose that path).
4. Select repository **`adarshdivase-allwave/Administrative_AI`** and branch **`main`** (or `staging` / `prod` if you use those).
5. Amplify should **detect `amplify.yml`** automatically. Confirm build settings show a **backend** phase and **frontend** phase.
6. Assign the **service role** Amplify suggests (or create one) so `pipeline-deploy` can create CloudFormation stacks and resources.
7. Save and **deploy**.

First fullstack build often takes **15–25 minutes**.

## Environment variables (per branch)

In **Amplify Console** → your app → **Hosting** → **Environment variables**, set at least:

| Variable   | Example (production) | Purpose |
|-----------|----------------------|---------|
| `APP_ENV` | `prod`               | Backend CDK / Lambda env (`dev`, `staging`, `prod`). |

`AWS_BRANCH` and `AWS_APP_ID` are **injected automatically** by Amplify during the build; do not set them manually.

Optional: `GEMINI_MODEL`, `USE_OPENSEARCH`, `SECRET_ID_GEMINI`, etc., if you override defaults in `amplify/backend.ts` and related modules.

## Secrets (not in Git)

- **Gemini**: create `av-inventory/gemini-api-key` in **Secrets Manager** in the **same region** as the Amplify app (for example `us-east-1`), before the first successful backend build that calls Gemini.
- **Forex**: this project uses the keyless `open.er-api.com` tier by default; no ExchangeRate secret is required.

## Cognito sign-in from the hosted URL

After the first deploy, your app is served from a URL like:

`https://main.<amplify-app-id>.amplifyapp.com`

Add that origin to **Amazon Cognito** → your user pool → **App integration** → **App client** → **Hosted UI** (if you use Hosted UI), and under **Allowed callback URLs** / **sign-out URLs** if applicable. For **email + password (SRP)** flows used by Amplify JS, still add the hosted domain under **Allowed callback URLs** if your client is configured for OAuth redirects.

## Sandbox vs pipeline

- **`npx ampx sandbox`** — local / personal stack; great for development.
- **`ampx pipeline-deploy` (in `amplify.yml`)** — **branch-based** stacks used by Amplify Hosting CI/CD.

Data and Cognito users in **sandbox** are **not** the same as in **pipeline** environments unless you migrate them.

## Troubleshooting

- **Build fails on `pipeline-deploy`**: check the Amplify **service role** has CloudFormation and IAM permissions; confirm **Secrets Manager** secrets exist in the app region.
- **Frontend builds but API errors**: confirm `amplify_outputs.json` is produced in the backend phase (Gen 2 does this before the frontend build uses the repo root file). Ensure the frontend resolves config from repo-root `amplify_outputs.json` (this project does via `frontend/src/lib/amplify-client.ts`).
