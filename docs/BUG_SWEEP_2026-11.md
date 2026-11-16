# Bug sweep — November 2026

Scope: the full stack of PRs (#1 → #16) as it will land on `main`. Focus was
on what per-feature tests can't catch: features interacting, hand-maintained
files drifting, and gaps between test doubles and real runtime.
Severity: **P0** data loss / leak / security · **P1** broken flow or wrong
data · **P2** minor.

## Findings

| # | Sev | What | Fixed? |
|---|-----|------|--------|
| F2 | **P1** | **Crew sessions survived a PIN change.** Resetting a crew member's PIN, or switching the company to 6-digit PINs, left anyone already signed in with the old PIN working for up to 12 h. That undercut the reason for a reset (a leaked PIN) and the "retires 4-digit PINs at once" promise. | ✅ Field sessions now end when the member's PIN is reset (`pinChangedAt`) or no longer matches the company's length. The error says "Re-enter your PIN", so the offline queue holds notes and asks for the new PIN instead of losing them. Renaming or changing a role doesn't sign anyone out. |
| F3 | **P1** | **Work for a workspace being deleted could still run and leave data behind.** An AI run queued before deletion still called OpenAI (cost) and could record usage after the usage rows were deleted. A late alert result could do the same for the alert log, leaving rows for a company that no longer exists. | ✅ The AI pipeline and customer drafts skip deleting workspaces. Usage and alert recording ignore them, so nothing is recreated after deletion. |
| F1 | P2 | "Send test alert" and "Send digest now" skipped the deleted-workspace lockout (they look the owner up directly). The window is seconds and owner-only, but it really sent. | ✅ Both refuse with "This workspace has been deleted." |
| F4 | P2 | Hand-edited `convex/_generated/api.d.ts` was missing `lib/csv` (added with the privacy work). Harmless at runtime; the first real codegen would fix it. | ✅ Added, plus a test that fails if the file drifts from the actual modules. |
| F5 | P2 | The sample note's two action items appear on the Tasks page and in the dashboard's open-items count, and its materials count toward "notes not linked to a job". | ⏸ Left as is: it's a demo meant to show those screens, and it disappears when deleted. Easy to exclude if pilots find it confusing. |
| F6 | P2 | After an ownership transfer, urgent alerts and the digest go to the **new** owner's sign-in email unless an alert email is set in Settings. | ⏸ Working as designed; worth one line in the transfer confirmation if pilots trip on it. |

## Checked and clean

- **Merge stack:** #1 → #16 form one straight line on `main`, so merging is
  a fast-forward to #16's head (green CI). Use merge commits, not squash, for
  stacked PRs.
- **Every public function** (77) has a reviewed access rule:
  member / owner / crew session / public-by-design. A new test fails if one is
  added without review. The two public actions and the shared note, update
  and suggestion helpers were read by hand.
- **Workspace deletion and export cover every company table** (read from the
  schema). New test; it catches a table missing from deletion.
- **Removed office users:** the only direct lookup (materials order history)
  handles a missing user; tasks are unassigned on removal.
- **Deleting a note mid-AI-run:** every AI write-back checks the note still
  exists.
- **Over budget + retry + urgent alert:** consistent (skip isn't counted as an
  attempt; urgent notes still alert).

## Not checked here (needs the real runtime)

Starting a local Convex backend isn't permitted in this environment, so
these go on the first-deploy list in [DEPLOY.md](DEPLOY.md):

- Real codegen: `npx convex dev` once, then `git diff convex/_generated`
  should show nothing but formatting.
- The new search index (`search_ai_title`) builds, and search returns old
  notes on real data.
- PIN reset on a real phone: the crew page asks for the new PIN, and a note
  recorded meanwhile sends after it's entered.
- One full end-to-end pass with real Clerk, Convex and OpenAI (sign-up →
  terms → checklist → crew PIN → record → AI → job update → order list →
  customer draft → export → delete a test workspace).
