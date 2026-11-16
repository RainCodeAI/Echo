# Browser tests

Playwright tests that render the **real app components** in a real browser
(Chromium), with a **fake Convex client** instead of a deployment. They cover
what unit tests can't: clicks, typing, offline/online, IndexedDB, downloads,
the clipboard, printing to PDF, phone-width layouts, and that each action
sends the right arguments to the right Convex function.

No Convex deployment, Clerk account or API keys are needed.

```bash
npm run test:browser                                         # all specs
npx playwright test tests/browser/specs/materials.spec.ts    # one spec
```

CI runs them as the **Browser tests** job on every PR. When a check fails, its
error names the check (e.g. `Send by text: opens sms: with the edited text…`);
screenshots are uploaded as the `browser-test-results` artifact.

## How it works

| Piece | What it does |
|---|---|
| `fixtures/<name>.tsx` | A page that mounts real components inside `<ConvexProvider>` with a fake client. Queries return canned data (often chosen by `?query=params`); mutations and actions are recorded on `window.__calls`. |
| `fixtures/shims/` | Stand-ins for `next/link`, `next/navigation` (`router.push` → `window.__pushed`), `next/image` and `@clerk/nextjs` (`signOut` → `window.__signedOut`). |
| `build.mjs` | Bundles every fixture with esbuild to `.out/<name>.js` and builds the app's Tailwind CSS once. |
| `server.mjs` | Serves `/<name>.html`, plus a **mock Convex backend** for the crew page (`/api/<function>`, uploads), whose state tests read and set via `GET/POST /__state` and `POST /__reset`. |
| `helpers.ts` | `check()` (a named soft assertion, so a run reports every failing check), `lastCall`/`allCalls`, `overflowX`, `iPhone` (iPhone 13 in Chromium), field-state helpers. |
| `specs/*.spec.ts` | The tests. Specs run one at a time because the crew-page specs share the mock backend. |

## Adding a test

1. Create `fixtures/<thing>.tsx`: render the component(s) with a fake client
   (copy an existing fixture; `materials.tsx` and `customer-update.tsx` are
   good models).
2. Create `specs/<thing>.spec.ts`: `page.goto("/<thing>.html?…")`, interact,
   then `check("what the user should see", condition)`.
3. Run `npm run test:browser`.

Keep checks about behaviour a person would notice (what's shown, what's sent),
and include a phone-width check for any new screen.
