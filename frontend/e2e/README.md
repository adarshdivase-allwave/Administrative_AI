# End-to-end tests

Playwright-driven E2E tests for the AV Inventory frontend.

## Two run modes

### 1. Mock mode (default, fast, no AWS)

```bash
npm run test:e2e:install   # once — installs browser binaries
npm run test:e2e:mock
```

What happens:
- Vite boots with `VITE_E2E_MOCK=1`
- The Amplify client is swapped for `src/lib/amplify-client.mock.ts` — a
  deterministic in-memory backend
- Playwright drives the browser against `http://localhost:5173`
- All specs in `e2e/*.spec.ts` run

No AWS credentials, no real backend, no network calls beyond localhost.
Finishes in under 30 seconds.

### 2. Live mode (against an actual Amplify sandbox)

```bash
# 1. Run the sandbox from the repo root, in a separate terminal:
cd ..
APP_ENV=dev npm run sandbox

# 2. Ensure a test user exists in Cognito:
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id-from-amplify_outputs.json> \
  --username e2e-test@example.com \
  --temporary-password E2eTestPass123!  \
  --user-attributes Name=email,Value=e2e-test@example.com Name=email_verified,Value=true
aws cognito-idp admin-set-user-password \
  --user-pool-id <pool-id> \
  --username e2e-test@example.com \
  --password 'E2eTestPass123!' \
  --permanent
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <pool-id> \
  --username e2e-test@example.com \
  --group-name Admin

# 3. Provide credentials to Playwright:
export E2E_TEST_USER_EMAIL=e2e-test@example.com
export E2E_TEST_USER_PASSWORD='E2eTestPass123!'

# 4. Run:
npm run test:e2e:live
```

Specs in this folder skip the login step when `E2E_MODE=mock`. If you
add a new flow that depends on login, wrap it in a `test.describe.configure({ mode: 'serial' })`
plus a `beforeEach` that signs in with those env vars.

## What's covered

| Spec | What it verifies |
|---|---|
| `auth.spec.ts` | Unauthenticated redirects, sign-in form, forgot-password, 403 page |
| `client-portal.spec.ts` | Public portal with token auth — valid vs invalid vs missing token, no pricing leakage |
| `india-compliance.spec.ts` | Company brand rendering, Indian date format on portal |

## What's NOT covered (follow-ups)

- **GRN create end-to-end** — writing one requires a signed-in Admin session,
  multi-line form-fill, and a serial-number generator. It's ~100 more lines;
  the mock backend already supports it.
- **DC create with e-Way Bill enforcement** — same pattern.
- **Real-browser barcode scan** — Playwright can't simulate camera input
  directly; in live mode, point a phone at a printed QR and use the USB
  scan path instead for a fully-automated test.
- **Email delivery verification** — needs an SES-attached SNS + a queue
  the test can drain (deferred to a deploy-time integration test).

## CI

In GitHub Actions / Amplify Hosting CI, set:

```yaml
- run: npm ci
- run: npm run test:e2e:install
- run: npm run test:e2e:mock
```

On failure, artifacts (HTML report + screenshots + videos) are in `playwright-report/`.
