# Echo — Production Deployment Runbook

The first production setup takes about an hour. Each step lists who does it
and how to verify it. Do the steps in order: later steps need values from
earlier ones.

**Architecture recap:** Vercel hosts the Next.js app. Convex hosts the
database, file storage and functions (including the OpenAI calls). Clerk
handles owner/office sign-in. Field crews never touch Clerk; they use the PIN
page.

---

## 1. Clerk — production instance

1. In the Clerk dashboard, create (or switch to) the **Production** instance
   for Echo. Enable **Email** and **Google** sign-in.
2. Clerk production requires a domain you control. Add the DNS records Clerk
   lists for `echo.raincode.ai` (or your chosen domain).
3. **JWT Templates → New → Convex.** Keep the name `convex`.
   - Confirm the claims include **`email`** and **`email_verified`**. The
     preset has both. Office invites only work when the signed-in email is
     present and verified (a security fix from the review).
   - Copy the **Issuer** URL (e.g. `https://clerk.echo.raincode.ai`).
4. Copy the **production** `pk_live_…` and `sk_live_…` keys for step 3.

## 2. Convex — production deployment

From a machine logged in to Convex (`npx convex login`):

```bash
npx convex dev --once
```

This links the repo to a Convex project, if it isn't linked already, and
regenerates `convex/_generated`. Commit any changes it makes to
`convex/_generated`.

Set production environment variables. These live in Convex, not Vercel:

```bash
npx convex env set --prod ENTRY_TOKEN_SECRET "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
```

```bash
npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN https://clerk.echo.raincode.ai
```

Omit the value so the CLI prompts for it (keeps the key out of shell history):

```bash
npx convex env set --prod OPENAI_API_KEY
```

Optional overrides (defaults shown):

```bash
npx convex env set --prod OPENAI_MODEL gpt-4o-mini
```

```bash
npx convex env set --prod OPENAI_TRANSCRIBE_MODEL whisper-1
```

Then create a **Production deploy key**: Convex dashboard → Project Settings
→ Deploy keys. Keep it for step 3.

> Use a dedicated OpenAI project key for Echo with a monthly budget limit set
> in the OpenAI dashboard. That's the cost backstop until per-tenant caps ship
> (Phase 3). The kill switch is `npx convex env set --prod OPENAI_KILL_SWITCH 1`.

## 3. Vercel — app hosting

1. **Add New → Project → Import** `RainCodeAI/Echo`. The framework is
   detected as Next.js. `vercel.json` already sets the build command to
   `npx convex deploy --cmd 'npm run build'`. That pushes the Convex
   functions and builds the app in one step, with `NEXT_PUBLIC_CONVEX_URL`
   injected automatically.
2. Environment variables (**Production** scope):

   | Variable | Value |
   | --- | --- |
   | `CONVEX_DEPLOY_KEY` | Production deploy key from step 2 |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
   | `CLERK_SECRET_KEY` | `sk_live_…` |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard` |
   | `NEXT_PUBLIC_APP_URL` | `https://echo.raincode.ai` |
   | `NEXT_PUBLIC_SENTRY_DSN` | from step 4 (optional) |
   | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | from step 4 (optional, enables readable stack traces) |

3. **Preview deployments.** Each one needs its own Convex backend. Either add
   a Convex **Preview** deploy key as `CONVEX_DEPLOY_KEY` in the *Preview*
   scope (Convex creates a throwaway backend per branch), or disable
   previews. Without a key, preview builds fail, which is safe because they
   can't touch production data.
4. **Domains:** add `echo.raincode.ai` and create the CNAME record Vercel
   shows.

## 4. Sentry — error monitoring (optional but recommended)

1. Create a **Next.js** project named `echo` in Sentry and copy its DSN into
   `NEXT_PUBLIC_SENTRY_DSN`.
2. For readable production stack traces, create an auth token (Settings → Auth
   Tokens) and set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` in
   Vercel.
3. Convex function errors: Convex dashboard → Settings → Integrations →
   exception reporting → Sentry (available on Convex paid plans). Without it,
   AI failures are still visible per note in the dashboard and in Convex logs.

Privacy defaults (`lib/sentry-options.ts`) send error metadata only, never
request bodies, cookies or user info. Field notes contain customer names and
addresses.

## 5. GitHub — guard `main`

Settings → Branches → add a rule for `main`: require a pull request and the
**CI / Typecheck, lint, test, build** check to pass. CI runs
`.github/workflows/ci.yml`: install with a lockfile check, typecheck (app +
Convex), lint, unit tests, build, and an audit that fails on critical
production vulnerabilities.

---

## 6. Verify the deployment

### Config check (30 seconds)

```bash
npx convex run ops:checkConfig --prod
```

Expect `"ready": true`. Any `required` check with `"ok": false` blocks launch.
The output never includes secret values.

### Smoke test (about 15 minutes, do it on real phones)

- [ ] Sign up as a new owner. The workspace is created and the dashboard loads.
- [ ] **Settings:** set the company name and primary trade.
- [ ] **Crew:** add a crew member with a PIN. Print or scan the QR code.
- [ ] **iPhone (Safari):** open the entry link, enter the PIN, record about 30s,
      attach a photo, flag it urgent, and submit. You should see "Saved".
- [ ] **Android (Chrome):** repeat with a Spanish memo if possible.
- [ ] **Dashboard:** both notes appear live. AI status reaches *Completed*
      within about a minute. The detail page shows `transcript: whisper`, and
      audio and photos play or open.
- [ ] The Spanish memo's summary is in English.
- [ ] A wrong PIN 10× locks entry for about 1 minute; a correct PIN afterwards
      works.
- [ ] Invite a second email from **Team**, sign up with it, and confirm it
      joins the same company as *Member* and can't edit company settings.
- [ ] Sentry (if configured): trigger a test error and confirm it arrives.

### Rollback

- **App:** Vercel → Deployments → previous deployment → *Instant Rollback*.
- **Convex functions:** redeploy the previous commit. Schema changes so far
  are additive (optional fields), so rolling back code is safe.
- **AI misbehaving or costs spiking:**
  `npx convex env set --prod OPENAI_KILL_SWITCH 1`. Notes still save; AI
  marks them failed and they can be retried later.
