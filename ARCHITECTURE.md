# Echo Architecture

This document explains how Echo is layered: client capture, Convex persistence,
AI structuring, tenant isolation, and the reliability guarantees that matter on
a job site.

It is the companion to [README.md](./README.md). Schema and domain vocabulary
live in [`convex/schema.ts`](convex/schema.ts) and [`types/index.ts`](types/index.ts).

---

## 1. Goals and non-goals

### Goals

- **Capture first.** A field worker can record and submit with one hand; the
  note is durable even if AI or network is flaky afterward.
- **Structured enough for ops.** Summary, materials, action items, urgency, and
  suggested job updates — not a free-form chatbot transcript dump.
- **Multi-tenant isolation.** Company A never reads Company B’s notes, audio,
  or photos.
- **Reactive owner review.** Dashboard updates when AI finishes without polling
  hacks.
- **Familiar RainCode patterns.** Same Clerk + Convex + tenant helpers as
  SiteAssist; same save-first AI enrichment mindset as Relay.

### Non-goals (MVP)

- Full CRM / invoicing / scheduling product surface
- Real-time multi-party voice calls
- On-device ML models as the sole transcription path
- Cross-company analytics or marketplace features

---

## 2. System layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Presentation (Next.js App Router)                              │
│  • /capture — field recorder UI                                 │
│  • /dashboard — notes list, detail, settings                    │
│  • shadcn/ui + mobile-first Tailwind                            │
└────────────────────────────┬────────────────────────────────────┘
                             │ Clerk session JWT
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Client data layer                                              │
│  • ConvexReactClient + ConvexProviderWithClerk                  │
│  • hooks: useQuery / useMutation / useAction                    │
│  • optional: local queue for offline drafts (post-MVP)          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Convex backend                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ queries      │  │ mutations    │  │ actions ("use node") │   │
│  │ list/get     │  │ create/save  │  │ structureNote        │   │
│  │ tenant-scope │  │ review/link  │  │ (OpenAI only here)   │   │
│  └──────────────┘  └──────────────┘  └──────────┬───────────┘   │
│  ┌──────────────┐  ┌──────────────┐              │              │
│  │ file storage │  │ schema       │              ▼              │
│  │ audio/photos │  │ + indexes    │         OpenAI API          │
│  └──────────────┘  └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

| Layer | Responsibility | Must not |
| ----- | -------------- | -------- |
| UI | Capture UX, review UX, optimistic feedback | Hold OpenAI keys or trust client-only auth |
| Convex queries/mutations | Auth, tenant checks, durable writes | Call OpenAI directly |
| Convex actions | Side effects (OpenAI, heavy I/O) | Be the only place a note is “saved” |
| File storage | Binary audio/photos | Be accessible without tenant-checked URLs |

---

## 3. Auth and multi-tenancy

### Identity path — dual auth model

**Owners / office (Clerk)**

1. Sign in with **Clerk**.
2. Next.js middleware protects `/dashboard/*`.
3. Convex validates the Clerk JWT via `auth.config.ts` (issuer domain env).
4. First authenticated session runs `users.store` which:
   - finds or creates a `users` row by `clerkUserId`
   - ensures a `companies` workspace exists
   - sets `role` (`owner` on first user, `member` thereafter)

**Field workers (PIN — no Clerk)**

1. Open public `/entry/[companyId]` (QR or shared link).
2. Enter a **4-digit PIN** managed on `teamMembers` (hashed at rest).
3. `teamMembers.verifyPin` returns member identity + a short verification token.
4. Submitted notes set `companyId` + `teamMemberId` (not a Clerk user).

Middleware does **not** require Clerk on `/entry/*`.

### Tenant scoping (single chokepoint)

All operational Convex functions go through helpers in
[`convex/lib/tenant.ts`](convex/lib/tenant.ts):

| Helper | Use |
| ------ | --- |
| `getCurrentUser` | Optional identity (nullable) |
| `requireCurrentUser` | Must be signed in + provisioned |
| `requireCompanyId` | Resolve caller’s `companyId` |
| `assertSameCompany` | After `db.get(id)`, prove the doc belongs to caller’s company |

**Rules**

- Every `voiceNotes`, `voiceNotePhotos`, `leads`, `jobs` row stores `companyId`.
- List queries always use a `by_company*` index — never full-table scans.
- Fetch-by-id always: `get` → `assertSameCompany`. Return generic `"Not found"`
  on mismatch (no cross-tenant existence leaks).
- Actions that structure a note re-check ownership via internal queries that
  still carry `companyId` constraints; public actions never accept a bare id
  without an auth boundary.

This matches SiteAssist’s model so engineers can move between products without
relearning tenancy.

### Roles (MVP)

| Actor | Auth | Capture | Review structure | Settings / crew |
| ----- | ---- | ------- | ---------------- | --------------- |
| `users.role = owner` | Clerk | Optional (dashboard later) | Yes | Yes |
| `users.role = member` | Clerk | Optional | Yes | Limited |
| `teamMembers` | PIN on `/entry` | Yes | No | No |

---

## 4. Data model relationships

```
companies 1──* users              (Clerk owners/office)
    │
    ├──* teamMembers          (PIN field workers)
    │
    ├──* leads
    │      └──* voiceNotes (optional leadId)
    │
    ├──* jobs
    │      │ leadId?
    │      └──* voiceNotes (optional jobId)
    │
    └──* voiceNotes  (recordedBy user? and/or teamMemberId?)
             └──* voiceNotePhotos
```

- A **voice note** always belongs to a company and a recording user
  (`recordedBy`).
- Linking to `leadId` / `jobId` is optional at capture time; owners can link
  later during review.
- Photos are separate rows so a note can grow media without rewriting the
  whole document; binaries live in **Convex file storage**, not base64 in the
  table.

### Index strategy (access patterns)

| Access pattern | Index |
| -------------- | ----- |
| Dashboard chronological list | `voiceNotes.by_company_and_created` |
| Filter by review/process status | `voiceNotes.by_company_and_status` |
| Filter by crew member | `voiceNotes.by_company_and_recorded_by` |
| Notes for one lead / job | `by_lead`, `by_job` |
| Idempotent offline / double-submit | `by_client_upload_id` |
| Photos for a note | `voiceNotePhotos.by_note` |
| Full-text search on transcript/summary | search indexes on `rawTranscript` / `aiSummary` (company-filtered) |

---

## 5. Voice handling pipeline

Field capture is the product’s critical path. The pipeline is deliberately
staged so each stage can fail independently.

### 5.1 Client capture (after PIN gate)

```
[PIN verified → teamMember session]
      │
      ▼
[Mic permission]
      │
      ▼
 MediaRecorder  ──────────► audio blob (always preferred)
      │
 SpeechRecognition API ───► live preview transcript (best-effort)
      │
 on stop:
      ├─► clientUploadId (uuid)
      ├─► photos (File[])
      └─► submit (save-first)
```

**Live preview:** browser `SpeechRecognition` / `webkitSpeechRecognition`.

**Durable audio:** `MediaRecorder` → Convex file storage (`audioStorageId`).

**Server accuracy path:** when audio is present, a Convex action may call
**OpenAI Whisper** and set `transcriptSource: "whisper" | "merged"` so long
recordings and noisy sites still produce a good transcript before structuring.

### 5.2 Upload and persist (mutations + storage)

1. Client requests short-lived upload URLs (`generateUploadUrl`).
2. Client PUTs audio/photo blobs to Convex storage → receives `storageId`s.
3. Client calls `voiceNotes.create` mutation with:
   - transcript text
   - `audioStorageId?`
   - photo storage ids
   - `clientUploadId`
   - links / flags

**Mutation responsibilities**

- `requireCurrentUser` + set `companyId` / `recordedBy` from auth (never trust
  client-supplied companyId).
- Dedupe on `clientUploadId` within the company (return existing note if
  retry).
- Insert `voiceNotes` with `status: "processing"`, `aiStatus: "pending"`.
- Insert `voiceNotePhotos` rows.
- `scheduler.runAfter(0, internal.ai.structureNote, { noteId })`.

**Invariant:** after a successful mutation, the note is queryable by the
dashboard even if the action never runs.

### 5.3 Server-side transcription (when audio exists)

If `rawTranscript` is empty/weak but `audioStorageId` is set, the structuring
action (or a dedicated `transcribeNote` step) may:

1. Fetch audio bytes from storage.
2. Call OpenAI Whisper (or equivalent) server-side.
3. Write `rawTranscript` + `transcriptSource: "whisper" | "client" | "merged"`.

MVP may ship **client transcript only** and treat Whisper as a fast follow-on
if audio is stored. Architecture reserves the field and action slot either way.

### 5.4 Failure modes (voice)

| Failure | Behavior |
| ------- | -------- |
| Mic denied | UI blocks record; explain permissions |
| Speech API unavailable | Allow record + manual text fallback; still accept audio |
| Upload fails mid-flight | Keep local draft; retry with same `clientUploadId` |
| Mutation fails | Show error; do not clear local draft until success |
| Action fails | Note stays saved; `aiStatus: "failed"` + retry button |

---

## 6. AI structuring layer

### 6.1 Placement

All OpenAI calls live in **`convex/ai.ts`** with `"use node"`.

- Prompts and JSON schemas: `convex/lib/prompts.ts`
- Apply results: internal mutation `voiceNotes.applyAiStructure`
- Record failures: `voiceNotes.applyAiFailure`

Mirrors SiteAssist (`convex/ai.ts` + `lib/prompts.ts`) and Relay’s
save-first structuring philosophy.

### 6.2 Input to the model

```
system: field-notes structuring role + trade context
user:
  company primary trade
  raw transcript
  optional job/lead titles
  optional worker urgency flag
  optional photo captions (not full image bytes in MVP unless vision enabled)
```

### 6.3 Structured output contract

The model returns a single JSON object (strict schema), roughly:

| Field | Purpose |
| ----- | ------- |
| `title` | Short owner-facing title |
| `summary` | 2–4 sentence operational summary |
| `materials` | `{ name, quantity?, unit?, notes? }[]` |
| `actionItems` | `{ title, assigneeHint?, dueHint?, priority? }[]` |
| `urgency` | `low \| medium \| high \| emergency` |
| `siteAddress` | If spoken/implied |
| `timelineNotes` | Chronology / sequence of work mentioned |
| `suggestedJobUpdates` | `{ field, value, rationale }[]` or freeform patches |
| `tags` | Freeform labels (e.g. `change_order`, `safety`) |
| `confidence` | 0–1 self-score |

Validators in the schema mirror this shape so invalid model output is rejected
or sanitized before write.

### 6.4 Lifecycle

```
create note
   aiStatus = pending
        │
        ▼
structureNote action starts
   aiStatus = processing
        │
        ├─ success → applyAiStructure
        │              aiStatus = completed
        │              status = ready (if still processing)
        │
        └─ failure → applyAiFailure
                       aiStatus = failed
                       aiErrorMessage set
                       aiGenerationAttempts++
                       raw note unchanged
```

**Graceful degradation**

- Missing `OPENAI_API_KEY`: write a clear placeholder summary; mark completed
  with low confidence or failed with “configure key” — prefer **usable UI**
  over hard crashes (SiteAssist pattern).
- Kill switch env (optional): same as no key.

### 6.5 Owner review loop

- `status: ready` → owner opens detail, edits structured fields if needed.
- `status: reviewed` when owner marks reviewed; optional `ownerNote`.
- Retry AI: public mutation/action gated by tenant check; only re-runs
  structuring, never deletes media/transcript.

---

## 7. Leads and jobs integration

Echo includes **lightweight** `leads` and `jobs` tables so notes can link to
operational objects without requiring SiteAssist as a hard dependency.

| Direction | Behavior |
| --------- | -------- |
| Capture | Optional picker: unlinked / lead / job |
| Review | Link or re-link note; show related notes on lead/job views |
| AI | `suggestedJobUpdates` are **proposals** until owner applies them |
| Future | Deep-link or sync ids with SiteAssist when product graph matures |

Do not auto-mutate job status from AI without an explicit owner action in MVP.

---

## 8. Storage and media

| Asset | Storage | Metadata table |
| ----- | ------- | -------------- |
| Audio memo | Convex `_storage` | `voiceNotes.audioStorageId`, duration, mime |
| Photos | Convex `_storage` | `voiceNotePhotos` rows |

**Access**

- Clients never get a permanent public URL without auth.
- Serving: `ctx.storage.getUrl(storageId)` inside a query that already
  verified the parent note’s `companyId`.

**Limits (recommended defaults)**

- Audio: ~5–10 minutes per note; reject larger client-side
- Photos: ~5–10 per note; compress client-side before upload
- Enforce size checks in create mutation when possible

---

## 9. Offline and field reliability

### MVP (online-first, failure-tolerant)

- Large touch targets, explicit “Saved” confirmation.
- Idempotent `clientUploadId`.
- AI never blocks persistence of the raw note.
- Retry AI and retry upload are first-class UI affordances.

### Near-term offline-first (designed for, not fully built)

```
┌──────────────┐     online?      ┌─────────────────┐
│ Capture UI   │ ── no ─────────► │ IndexedDB queue │
│              │                  │ drafts + blobs  │
│              │ ── yes ────────► │ create mutation │
└──────────────┘                  └────────┬────────┘
                                           │ reconnect
                                           ▼
                                    flush queue with
                                    same clientUploadId
```

Architecture requirements for that phase:

- Treat `clientUploadId` as the idempotency key (already in schema).
- Keep draft state machine: `local_only → uploading → synced | error`.
- Never assume background tabs stay alive on iOS; show queue badge on open.

---

## 10. Frontend route map

| Route | Audience | Purpose |
| ----- | -------- | ------- |
| `/` | Public | Marketing / value prop |
| `/sign-in`, `/sign-up` | Public | Clerk (owners) |
| `/entry/[companyId]` | Public + PIN | Field record, preview, photos, submit |
| `/dashboard` | Clerk | Overview stats |
| `/dashboard/notes` | Clerk | List + filters |
| `/dashboard/notes/[id]` | Clerk | Detail, AI panels, review |
| `/dashboard/leads` | Clerk | Link targets |
| `/dashboard/jobs` | Clerk | Link targets |
| `/dashboard/team` | Clerk | Crew PINs + entry URL/QR |
| `/dashboard/settings` | Clerk | Company profile |

Field entry is sparse and mobile-first; dashboard is scannable tables/cards.

---

## 11. Security checklist

- [ ] OpenAI key only on Convex env, never `NEXT_PUBLIC_*`
- [ ] Every query/mutation uses `requireCompanyId` / `assertSameCompany`
- [ ] Client cannot set `companyId` or `recordedBy` arbitrarily
- [ ] Storage URLs only after note ownership check
- [ ] Generic not-found errors on cross-tenant access
- [ ] Rate-limit public endpoints if any are added later
- [ ] Validate AI JSON against Convex validators before write

---

## 12. Observability and operations

MVP-friendly practices (align with Quill/Relay where useful):

- Structured `console` logs in actions with `noteId` + `companyId` (no PII in
  third-party tools by default).
- Persist `aiErrorMessage` and attempt counts on the note for owner-visible
  diagnosis.
- Optional later: events table for “note_created”, “ai_completed”,
  “note_reviewed” (SiteAssist `events` pattern).

---

## 13. Implementation order

1. ~~Scaffold Next.js + Tailwind + shadcn + Clerk + Convex providers~~ (Phase 2)
2. ~~`users` / `companies` + `teamMembers` + public entry shell~~ (Phase 2)
3. Storage helpers + `voiceNotes.create` (save-first, no AI)
4. Field entry: PIN keypad → record (SpeechRecognition + MediaRecorder) → submit
5. Whisper re-transcribe + `ai.structureNote` + apply / retry
6. Dashboard notes list/detail/filters + review actions
7. Lead/job CRUD + linking UI + crew management UI
8. PWA polish, entry QR, hardened submission tokens

---

## 14. Cross-product notes

| Concern | SiteAssist | Relay | Echo |
| ------- | ---------- | ----- | ---- |
| Backend | Convex | Supabase | Convex |
| Auth | Clerk | Supabase Auth | Clerk |
| AI placement | Convex action | Server route | Convex action |
| Core object | Lead | Shift entry | Voice note |
| Save-first AI | Yes (triage) | Yes | Yes |
| Tenant key | `companyId` | `business_id` | `companyId` |

Echo should feel like SiteAssist’s sibling for infrastructure and Relay’s
cousin for “field submits → office reviews structured notes.”
