# Echo — Code Review, Product Assessment & Roadmap

_Review date: November 2026. Covers commit `7d8ec96` → current branch._

---

## 1. Verdict

**Echo has a real shot, and the code is better than "unsure of the state"
suggests.** The foundation is solid. The remaining work is product work that
turns a capture tool into something an owner will pay for every month.

- **Engineering:** B+. Clean architecture, consistent tenant isolation,
  "save first, enrich second" design, unit tests on the risky pure logic.
  It builds, typechecks, lints (0 errors), and tests green. There is about
  10k lines of focused code and no dead weight.
- **Product readiness:** about 60% of a sellable MVP. Capture → AI → review
  works. What's missing is everything after review: alerts, follow-through,
  integrations, billing, and offline capture.
- **Market fit for RainCode:** strong as a **suite module**, weaker as a
  standalone. "Voice notes for contractors" on its own is a vitamin, and the
  photo/field-documentation space (CompanyCam, and the AI features that
  Jobber, Housecall Pro and ServiceTitan keep adding) is crowded. Echo wins
  when a crew's 30-second ramble becomes something that *happens*: an urgent
  text to the owner, a materials list for the supply house, a change-order
  draft in Quill, a follow-up in SiteAssist.

### Where Echo is genuinely differentiated
1. **No app, no crew accounts.** QR code + 4-digit PIN. Trades businesses have
   high crew turnover and hate per-seat pricing. "Unlimited crew, flat price"
   is a real wedge.
2. **Structured extraction, not just transcription.** Materials with
   quantities, action items, urgency, and site address. That's operational
   data, not a note.
3. **Bilingual by default** (as of this review). A Spanish-speaking crew
   records in Spanish and the office reads English. That matters across much
   of the trades workforce, and most competitors don't lead with it.
4. **Suite leverage.** It shares a stack and tenancy model with SiteAssist and
   Quill, so cross-product hand-offs are cheap to build.

### Where it's weak today
- Nothing happens after a note is saved. The **urgent flag does nothing**:
  there are no notifications, and "notificationsEnabled" is stored but unused.
- **No offline capture.** Basements, rural sites and metal buildings kill
  signal, and a reload or dead zone loses the draft.
- **No billing, no data export or deletion, no CI, no error monitoring.**

---

## 2. Bug / error sweep — what was fixed

All fixes are on branch `claude/eloquent-mccarthy-joos0m`.

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | **Blocker** | `package-lock.json` out of sync with `package.json` → `npm ci` failed, so any CI/Vercel deploy would fail | Lockfile regenerated |
| 2 | **Critical** | Next.js 16.2.10 advisory: middleware/proxy bypass (the dashboard gate is middleware) | Next 16.4.5; also postcss and vitest patches. Critical audit count 1 → 0 |
| 3 | **Critical** | `users.store` matched pending invites against a **client-supplied email** fallback. A new user could claim anyone's invite and join that company | Match only the JWT email, and reject when `email_verified` is false |
| 4 | **High** | Field token TTL was 15 min. Submitting after that failed, and the only recovery ("Switch user") **discarded the recording** | 12-hour shift TTL. Revocation is still immediate via the per-call `isActive` check |
| 5 | **High** | `createFromField` deleted storage blobs by client-supplied id on photo validation failure. A crafted request could delete another note's audio | Reject without deleting |
| 6 | **High** | An AI action that crashed or timed out left the note in "processing" forever, with retry blocked. Retry was also double-schedulable while "pending" (double OpenAI spend) | `aiStartedAt` + stale detection (12 min); retry blocked only while genuinely in flight |
| 7 | **Medium** | Flat 60s PIN lockout ≈ 14k guesses/day, enough to cover the whole 4-digit space | Escalating lockout 1m → 5m → 15m (capped to limit DoS) |
| 8 | **Medium** | Whisper ran only when the browser transcript was <12 chars, so the noisy live preview (poor on iOS and job sites) was effectively final | Server transcription whenever audio exists. Phone text kept as `deviceTranscript` and passed to the model |
| 9 | **Medium** | Whisper forced `language: "en"`, which garbled Spanish memos | Auto-detect; output still in English |
| 10 | **Medium** | `max_tokens: 900` truncated long memos → opaque JSON parse error. `max_tokens` is also rejected by newer OpenAI models | `max_completion_tokens: 2000`; explicit truncation and refusal errors |
| 11 | Low | Members could edit company settings (ARCHITECTURE.md says owner-only) | `requireOwner` + read-only form for members |
| 12 | Low | Retry-limit message said "edit the transcript", but no transcript editing exists | Message corrected |
| 13 | Low | `middleware.ts` deprecated in Next 16 | Renamed to `proxy.ts` |

New tests: TTL regression, lockout escalation, prompt device-notes (29 → 34).

### Known issues not fixed (tracked in roadmap)
- ~~`openai` v4 SDK / `zod` advisory~~ — fixed in Phase 0 (SDK v7, zod 4).
- **AI retry overwrites an owner's manual urgency** (`applyAiStructure` writes
  urgency unconditionally). Needs an "owner-set" marker. → Phase 1.
- **Orphaned storage**: abandoned uploads, oversized/rejected uploads, and
  `generateFieldUploadUrl` has no per-session cap. → Phase 1 cleanup cron +
  rate limit.
- **Search/filter is in-memory over the latest 200 notes**, so older notes
  aren't searchable, and `dashboardStats` scans every note. The search indexes
  already exist in the schema. → Phase 3.
- **4-digit PINs are inherently weak** on a public URL. Lockouts make brute
  force slow, not impossible. → Phase 3: optional 6-digit PINs and per-device
  trust.
- README claims the field worker can link a note to a lead/job; only the
  owner can today.
- 8 lint warnings (React 19 `set-state-in-effect`), all cosmetic.

---

## 3. Roadmap

Sequencing principle: **don't build billing before a real crew has used it
for two weeks.** Every phase ends with something you can put in front of a
pilot customer.

### Phase 0 — Ship to a pilot (≈1 week)
_Code side done; account setup follows [DEPLOY.md](DEPLOY.md)._
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): `npm ci` → typecheck
      (app + Convex) → lint → test → build → critical-vuln audit gate.
- [x] Sentry for Next.js (client + server), inert until a DSN is set; privacy
      defaults send no bodies/cookies/user info.
- [x] `openai` SDK v4 → v7 (Convex Node runtime pinned to 22 in
      `convex.json`). OpenAI calls extracted to `convex/lib/openaiCalls.ts`
      and verified against a mock OpenAI server. Production dependency audit:
      **0 vulnerabilities**.
- [x] Transcription model configurable (`OPENAI_TRANSCRIBE_MODEL`) +
      `scripts/eval-transcription.mjs` to compare models (with WER) on real
      recordings.
- [x] `ops:checkConfig` internal query: verifies production secrets without
      exposing values.
- [x] Deployment runbook ([DEPLOY.md](DEPLOY.md)) and pilot playbook
      ([PILOT.md](PILOT.md)).
- [ ] **You:** Clerk production instance + `convex` JWT template (with
      `email`, `email_verified`).
- [ ] **You:** Convex production env vars → `npx convex run ops:checkConfig --prod`.
- [ ] **You:** Vercel project + `CONVEX_DEPLOY_KEY` + domain
      (e.g. `echo.raincode.ai`); optional Sentry DSN.
- [ ] **You:** branch protection on `main` requiring CI.
- [ ] Run the smoke test in DEPLOY.md on a real iPhone and Android.
- [ ] Record ~20 real job-site memos and run the transcription eval.
- [ ] **Recruit 2–3 pilot companies** ([PILOT.md](PILOT.md)).

### Phase 1 — "Never lose a memo" (≈2–3 weeks)
_The #1 trust killer in field software is losing someone's work._
- [ ] **Offline capture queue**: IndexedDB draft + upload queue, retried on
      reconnect. `clientUploadId` idempotency already exists server-side.
      The draft survives reloads and dead zones.
- [ ] Persist the field session per device (12h token) so a reload doesn't
      force a PIN re-entry mid-shift.
- [ ] Owner can edit the transcript and AI fields; mark "owner-set" so AI
      retries don't clobber them (fixes known issue above).
- [ ] Field-side "today's jobs" picker so notes arrive pre-linked.
- [ ] Storage-cleanup cron for orphaned uploads; per-session upload cap.
- [ ] `convex-test` integration tests for tenancy and auth boundaries
      (cross-tenant reads, invite flow, field-session checks).

### Phase 2 — "Close the loop" (≈3–4 weeks) — _this is the product_
- [ ] **Urgent alerts**: SMS (Twilio) and/or email (Resend) to the owner
      within 60s of an urgent or emergency note. Respects
      `notificationsEnabled`.
- [ ] **Daily digest**: "7 notes from 3 crews, 2 need you, 14 materials
      requested."
- [ ] Action items become checkable tasks with an assignee; open items roll
      up on the dashboard.
- [ ] One-click **apply suggested job updates**.
- [ ] **Materials → order list**: aggregate across notes per job; export or
      share with the supply house.
- [ ] Customer-update draft: "send the homeowner a summary" (text/email,
      owner approves).

### Phase 3 — "Sellable" (≈3–4 weeks)
- [ ] Stripe billing. Suggested starting point: **flat per company, unlimited
      crew** (e.g. a starter and a pro tier), validated with pilots first.
- [ ] Self-serve onboarding: printable QR poster or truck sticker, sample note,
      first-crew-member wizard.
- [ ] Office user management: remove member, transfer ownership.
- [ ] Data export (CSV + media zip) and workspace deletion; recording-consent
      language; privacy policy/ToS.
- [ ] Per-tenant AI usage caps and cost dashboard (kill switch exists
      globally only).
- [ ] Optional 6-digit PINs; Convex search indexes for full-history search.

### Phase 4 — Suite leverage (ongoing)
- [ ] Quill: "turn these materials into an estimate draft."
- [ ] SiteAssist: notes appear on the lead/job timeline; shared lead/job IDs.
- [ ] Relay: end-of-shift handoff auto-built from the day's notes.
- [ ] Integrations: Jobber / Housecall Pro / QuickBooks job notes (where
      pilots already live).
- [ ] Photo AI: damage/progress tagging on attached photos.

### Pilot success metrics (decide go/no-go after ~4 weeks)
- ≥3 notes per active crew member per week, sustained in week 4.
- Median time from note → owner review under 24h.
- At least one "this saved me a trip / callback / mis-order" story per pilot.
- Pilot owners say they'd pay at the proposed price, or ask to keep it.
