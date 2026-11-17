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
#    Every set is retried: `convex dev` reacts to each change by re-pushing,
#    and a set that lands mid-push can fail with a 503
#    OptimisticConcurrencyControlFailure (seen on main, run 44004811126).
set_env() {
  local name="$1" value="$2"
  for attempt in $(seq 1 15); do
    if npx convex env set "$name" "$value"; then return 0; fi
    echo "convex env set $name failed (attempt $attempt); retrying..."
    sleep 2
  done
  fail "Couldn't set $name on the local deployment."
}
set_env CLERK_JWT_ISSUER_DOMAIN "https://clerk.e2e.invalid"
set_env ENTRY_TOKEN_SECRET "$(openssl rand -hex 32)"
set_env E2E_SEED_ALLOWED 1

# 3. Trigger a push now that the env vars exist, and wait for it.
touch convex/schema.ts
for _ in $(seq 1 240); do
  grep -q "Convex functions ready" "$LOG" && break
  sleep 1
done
grep -q "Convex functions ready" "$LOG" || fail "Functions never finished pushing."
echo "Convex functions are live."
