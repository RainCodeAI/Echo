# Echo

**Voice-first field notes for contractors and trades businesses.**

Echo is a mobile-friendly field capture tool for landscaping, roofing, HVAC,
plumbing, electrical, painting, fence & deck, concrete, pressure washing,
security/camera install, and general contracting crews.

Workers speak into their phone on the job site. AI turns the voice memo into
structured notes, material lists, action items, photo context, and timeline
updates that feed into jobs, leads, and operations.

It is **not** a full CRM, accounting suite, or generic note app. It's a
**field-to-office capture layer** — optimized for gloves-on, one-handed use,
poor connectivity, and fast owner review back at the desk.

Echo is designed as a natural extension of the RainCode AI product family:

| Product | Role |
| ------- | ---- |
| **SiteAssist** | AI ops assistant — leads, follow-ups, messaging, jobs |
| **Relay** | Shift handoffs for small teams |
| **Quill** | Lead capture, estimates, and quote delivery |
| **Echo** | Voice field notes → structured operational data |

---

## Value proposition

| Who | Problem today | Echo |
| --- | ------------- | ---- |
| Field worker | Forgets details, hates typing, photos scattered in camera roll | Tap record → talk → attach photo → submit |
| Crew lead | Context lost between job site and office | Structured materials, actions, urgency auto-extracted |
| Owner / office | Scrambles for “what did the crew see?” | Dashboard of voice notes linked to leads/jobs, searchable by date/crew |

---

## Core user flows

### 1. Owner setup

1. Sign in with Clerk (Google or email).
2. Workspace is provisioned automatically (`users` + `companies`).
3. Complete company profile (trade, timezone, notification email).
4. Invite or add crew members (role: `owner` | `member`).
5. Land on the owner dashboard with an empty notes queue ready for first capture.

### 2. Field worker recording (PIN + QR, no Clerk)

1. Owner shares `/entry/[companyId]` (or a printed QR) and a 4-digit crew PIN.
2. Worker opens the public entry page on a phone (PWA-friendly) and enters PIN.
3. Optionally link the note to a lead or job (or leave unlinked for later).
4. Hold/tap **Record** — live browser SpeechRecognition preview + MediaRecorder audio.
5. Attach one or more job-site photos.
6. Optionally flag as urgent.
7. **Submit** — note is saved first (tied to company + team member), then AI structures it.
   Server may re-transcribe with Whisper when raw audio is present for higher accuracy.

### 3. Dashboard review

1. Owner opens the notes list (filter by date, crew, status, linked job/lead).
2. Open a note: hear/read transcript, see AI summary, materials, action items.
3. Edit structured fields if needed; mark reviewed / resolved.
4. Apply suggested job updates or promote details onto a lead/job.

```
Field phone                    Convex                         Owner dashboard
───────────                    ──────                         ───────────────
Record audio ──► transcript ─► voiceNotes.create
                  + photos  ─► storage + photos table
                               │
                               ▼
                          ai.structureNote (OpenAI)
                               │
                               ▼
                          applyAiStructure  ──────── reactive ──► note detail
```

---

## Tech stack

| Layer | Choice |
| ----- | ------ |
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS + shadcn/ui (Radix) |
| Backend / DB | Convex (reactive database + functions + file storage) |
| Auth | Clerk (multi-tenant via `companyId`) |
| AI | OpenAI API (Convex action, server-side only) |
| Mobile | Mobile-first UI + PWA-friendly (installable, large touch targets) |

Same core stack as **SiteAssist** and **Quill**, so patterns, env setup, and
tenant helpers stay familiar across RainCode apps.

---

## Architecture overview

```
Browser (Next.js App Router, React Server + Client Components)
   │  Clerk session  ─────────────────────────────┐
   ▼                                               │
ConvexProviderWithClerk  ── reactive queries ──►  Convex
   │                                               │  • queries   (read)
   │                                               │  • mutations (write, save-first)
   │                                               │  • actions   (OpenAI, transcription)
   │                                               │  • storage   (audio + photos)
   ▼                                               ▼
shadcn/ui + field UI                         OpenAI API (server-side only)
```

**Key ideas**

- **Multi-tenant from day one.** Every operational record carries a
  `companyId`. Tenant scoping + auth live in
  [`convex/lib/tenant.ts`](convex/lib/tenant.ts) (same pattern as SiteAssist).
- **Save first, enrich second.** Submitting a note always persists transcript
  (+ audio/photos when present) before AI runs. AI failure never loses the raw
  capture — status becomes retryable.
- **AI is isolated.** OpenAI lives only in Convex actions (`"use node"`).
  Prompts and JSON schemas live in `convex/lib/prompts.ts`.
- **Reactive review.** Owner dashboards subscribe to Convex queries; when
  structuring completes, the UI updates without a manual refresh.
- **Field reliability.** Client upload ids for idempotency, clear AI error
  states, offline-friendly capture queue (planned; see Future expansion).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for layer-by-layer detail (voice
pipeline, AI structuring, tenant isolation, offline strategy).

---

## Folder structure

```
Echo/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout + providers
│   ├── providers.tsx             # Clerk + Convex client wiring
│   ├── page.tsx                  # Public marketing / landing
│   ├── globals.css               # Tailwind + design tokens
│   ├── sign-in/ | sign-up/       # Clerk auth (owners / office)
│   ├── entry/[companyId]/       # Public field entry (PIN → record → submit)
│   └── dashboard/                # Clerk-authenticated owner app
│       ├── layout.tsx            # Auth gate + shell
│       ├── page.tsx              # Overview (counts + recent notes)
│       ├── notes/                # List, detail, review, filters
│       ├── leads/                # Lightweight lead list/link targets
│       ├── jobs/                 # Lightweight jobs board / link targets
│       ├── team/                 # Crew roster + 4-digit PINs + entry link/QR
│       └── settings/             # Company profile
│
├── components/
│   ├── ui/                       # shadcn/ui primitives
│   ├── dashboard/                # Sidebar, topbar, filters, stat cards
│   ├── notes/                    # Note cards, detail panels, AI sections
│   └── capture/                  # Recorder, transcript preview, photo attach
│
├── convex/                       # Backend (database + functions)
│   ├── schema.ts                 # Tables, validators, indexes
│   ├── auth.config.ts            # Trust Clerk-issued JWTs
│   ├── users.ts                  # Provisioning (Clerk → user/company)
│   ├── companies.ts              # Company profile
│   ├── voiceNotes.ts             # CRUD, list/filter, review, AI hooks
│   ├── leads.ts                  # Lead CRUD (link targets)
│   ├── jobs.ts                   # Jobs CRUD (link targets)
│   ├── ai.ts                     # OpenAI structuring action
│   ├── storage.ts                # Upload URL helpers for audio/photos
│   └── lib/
│       ├── tenant.ts             # Auth + tenant-scoping helpers
│       └── prompts.ts            # AI prompt + JSON schema construction
│
├── hooks/                        # Client hooks (useVoiceNotes, useStoreUser, …)
├── lib/                          # cn() util + shared constants
├── types/                        # Domain types (mirrors schema unions)
├── ARCHITECTURE.md               # Deep-dive: voice, AI, tenancy, offline
└── middleware.ts                 # Clerk route protection
```

---

## Data model

| Table | Purpose | Key indexes |
| ----- | ------- | ----------- |
| `companies` | Trades business / workspace (tenant) | — |
| `users` | Owner/office person linked to Clerk | `by_clerk_id`, `by_company` |
| `teamMembers` | Field workers (PIN auth, no Clerk) | `by_company`, `by_company_and_active` |
| `leads` | Customer request (link target for notes) | `by_company`, `by_company_and_status` |
| `jobs` | Scheduled / active work (link target) | `by_company`, `by_company_and_status`, `by_lead` |
| `voiceNotes` | Core field capture + AI structured output | `by_company`, `by_company_and_created`, `by_company_and_status`, `by_company_and_team_member`, `by_lead`, `by_job`, `by_client_upload_id` |
| `voiceNotePhotos` | Photos attached to a note (Convex storage) | `by_note`, `by_company` |

**Voice note status**: `processing → ready → reviewed → archived` (plus
`failed` for hard capture errors).

**AI status** (independent lifecycle): `pending → processing → completed | failed`.

**Urgency**: `low | medium | high | emergency`.

String unions in [`convex/schema.ts`](convex/schema.ts) mirror
[`types/index.ts`](types/index.ts) — keep them in sync.

---

## Getting started

### Prerequisites

- Node.js 18+ (recommend Node 20 or 24)
- Accounts: [Convex](https://convex.dev), [Clerk](https://clerk.com),
  [OpenAI](https://platform.openai.com)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

Fill in values as you complete the steps below.

### 3. Set up Convex

```bash
npx convex dev
```

This logs you in, creates a dev deployment, **generates `convex/_generated`**
(required — TypeScript errors on `./_generated/*` until this runs once), and
writes `NEXT_PUBLIC_CONVEX_URL` into `.env.local`. Leave it running for
backend hot-reload.

### 4. Set up Clerk

1. Create a Clerk application; copy the **Publishable key** and **Secret key**
   into `.env.local`.
2. In Clerk → **JWT Templates** → **New template → Convex**. Copy the
   **Issuer** URL from the `convex` template.
3. Point Convex at that issuer:

   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
   ```

   See `convex/auth.config.ts` once scaffolded.

### 5. Set up OpenAI

Give the **Convex deployment** the key (actions run server-side only):

```bash
npx convex env set OPENAI_API_KEY sk-...
# optional: npx convex env set OPENAI_MODEL gpt-4o-mini
```

Without this key the app still runs — notes save with a clear “AI unavailable”
placeholder instead of failing the capture.

### 6. Run the app

Two processes (Next.js + Convex). Preferred:

```bash
npm run dev:all      # next dev + convex dev
```

or separately:

```bash
npm run dev          # Next.js  → http://localhost:3000
npm run dev:convex   # Convex backend
```

Open <http://localhost:3000>, sign up, and land on a freshly provisioned workspace.

### Scripts

| Script | Does |
| ------ | ---- |
| `npm run dev` | Next.js dev server |
| `npm run dev:convex` | Convex backend (codegen + hot reload) |
| `npm run dev:all` | Both in parallel |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` (run `convex dev` first) |

---

## Environment variables

| Variable | Required | Used by | Notes |
| -------- | -------- | ------- | ----- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Browser / server | Clerk publishable key |
| `CLERK_SECRET_KEY` | Yes | Next.js server | Clerk secret key |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Convex auth | Set on Convex deployment; must match Clerk JWT template issuer |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Browser / server | Written by `npx convex dev` |
| `CONVEX_DEPLOYMENT` | Recommended | Convex CLI | Dev/prod deployment id |
| `OPENAI_API_KEY` | Yes for AI | Convex actions only | Never expose to the browser |
| `OPENAI_MODEL` | Optional | Convex AI | Defaults to `gpt-4o-mini` |
| `NEXT_PUBLIC_APP_URL` | Recommended | Links / PWA | e.g. `http://localhost:3000` |

---

## MVP feature checklist

1. **Owner dashboard** — list voice notes linked to leads/jobs; search/filter by date and crew
2. **Field entry** — public `/entry/[companyId]`, 4-digit PIN, big record button, live SpeechRecognition preview, MediaRecorder audio + photos, submit
3. **Server Whisper** — after upload, re-transcribe when audio exists for accuracy / longer memos
4. **AI structuring** — summary, materials, action items, urgency, suggested job updates
5. **Tenant scoping** — `companyId` isolation via `convex/lib/tenant.ts`
6. **PWA** — installable shell (manifest + basic SW); full offline queue later

---

## Recommended future expansion

Rough priority after MVP:

1. **Offline-first capture queue** — IndexedDB queue + background sync; `clientUploadId` already supports idempotent retries.
2. **Hardened field tokens** — HMAC submission tokens + server PIN lockouts (Relay pattern).
3. **Push / email digests** — daily briefing of unreviewed notes and urgent alerts.
4. **Cross-product deep links** — open the same lead/job in SiteAssist or convert materials into a Quill estimate draft.
5. **Crew assignment & geo tags** — map view of notes by site, automatic job matching from address.
6. **Clerk Organizations** for multi-admin office seats.
7. **Billing** — Stripe plan gating once capture loop is proven with real crews.

Because AI, auth, tenancy, storage, and capture persistence are isolated, these
can land incrementally without large refactors.

---

## Design notes

Echo should feel **operational and trustworthy in bright sunlight and dirty
hands**: high contrast, large hit targets, minimal chrome on the capture
screen, neutral slate surfaces, and a confident work-ready accent. Status and
urgency share one color language with SiteAssist where practical.

Field path priority: **record → submit → confirm saved**. Everything else
(perfect transcript polish, optional linking) is secondary to not losing the memo.

---

## Phase status

| Phase | Status |
| ----- | ------ |
| 1 — Architecture & documentation | Done |
| 2 — App scaffold (Next.js, Clerk, Convex providers, shell, teamMembers) | In progress |
| 3 — Capture + AI + dashboard MVP | Not started |

Phase 2 delivers scaffold + providers + owner shell + public entry route.
Full recorder UI and AI enrichment are Phase 3.
