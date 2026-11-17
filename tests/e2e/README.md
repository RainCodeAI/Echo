# E2E tests (real Convex backend)

`.github/workflows/e2e.yml` runs on every push. It needs no accounts or secrets.

1. `scripts/e2e/start-convex.sh` starts a throwaway local Convex backend
   (`CONVEX_AGENT_MODE=anonymous`), sets test-only env vars
   (`E2E_SEED_ALLOWED=1`, a random `ENTRY_TOKEN_SECRET`) and pushes the real functions.
2. `git diff --exit-code -- convex/_generated` fails if the committed generated
   types differ from real codegen. If it fails, copy the diff from the log into
   `convex/_generated`.
3. The app is built against that backend and `tests/e2e` runs with Playwright.
   `global-setup.ts` seeds a workspace through `internal.e2e.seed`.

`convex/e2e.ts` refuses to run unless the deployment has `E2E_SEED_ALLOWED=1`.
Never set that on a real deployment.

## What's covered

Crew flow on `/entry/<companyId>`:
- wrong PIN, then right PIN
- the recording notice
- the job picker
- a real audio upload to Convex storage
- the AI step failing cleanly (CI has no OpenAI key)
- an offline submit that sends once on reconnect

Results are checked in the database through `internal.e2e.notes`.

Not covered yet: the owner flow (sign-in, dashboard). It needs Clerk test keys
as repository secrets.

## Run locally

```bash
bash scripts/e2e/start-convex.sh
npm run build
npx playwright test -c playwright.e2e.config.ts
```
