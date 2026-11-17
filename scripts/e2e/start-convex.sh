#!/usr/bin/env bash
# Starts a throwaway local Convex backend for the E2E suite (CI), pushes the
# real functions to it, and sets the env vars they need. Leaves `convex dev`
# running in the background. Needs CONVEX_AGENT_MODE=anonymous (no account).
set -euo pipefail

LOG="${RUNNER_TEMP:-/tmp}/convex-dev.log"
: > "$LOG"
nohup npx convex dev --typecheck disable --tail-logs disable >"$LOG" 2>&1 &
echo $! > "${RUNNER_TEMP:-/tmp}/convex-dev.pid"

fail() { echo "::error::$1"; echo "----- convex dev log -----"; cat "$LOG"; exit 1; }

# 1. Wait for the local deployment to exist (convex dev writes .env.local).
for _ in $(seq 1 180); do
  grep -qs "CONVEX_URL" .env.local && break
  sleep 1
done
grep -qs "CONVEX_URL" .env.local || fail "Local Convex deployment didn't start."
echo "Local deployment:"; grep -E "CONVEX_(URL|DEPLOYMENT)" .env.local

# 2. Env vars the functions need. (The first push fails without the auth
#    domain; it's a placeholder: the crew flow doesn't use Clerk.)
for _ in $(seq 1 30); do
  npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://clerk.e2e.invalid" && break
  sleep 2
done
npx convex env set ENTRY_TOKEN_SECRET "$(openssl rand -hex 32)"
npx convex env set E2E_SEED_ALLOWED 1

# 3. Trigger a push now that the env vars exist, and wait for it.
touch convex/schema.ts
for _ in $(seq 1 240); do
  grep -q "Convex functions ready" "$LOG" && break
  sleep 1
done
grep -q "Convex functions ready" "$LOG" || fail "Functions never finished pushing."
echo "Convex functions are live."
