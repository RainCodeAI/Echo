# Echo: Backup and Restore Runbook

All of Echo's data lives in the production Convex deployment:
- the database tables
- file storage (recordings and photos)

Sign-in accounts live in Clerk. The app on Vercel holds no data.

This runbook covers:
- how to take backups
- how to restore after a mistake or an outage
- how backups fit with workspace deletion

> Check Convex's own docs for the exact current backup options and flags:
> *Dashboard → your production deployment → Settings → Backups*, and
> `npx convex export --help` / `npx convex import --help`. Commands below use
> the CLI from a checkout of this repo, signed in with an account that has
> access to the production deployment.

---

## 1. Set up (once, before the first real customer)

- [ ] **Turn on scheduled backups** in the Convex dashboard (production
      deployment → Settings → Backups).
  - Run them daily, and include file storage.
  - Periodic backups may need a paid Convex plan. If they aren't available,
    use the weekly manual export in §2 until they are.
- [ ] **Decide how long backups are kept, and keep it to 30 days or less.**
  - Deleted workspaces stay inside older backups until those backups expire.
  - The Privacy Policy says copies stay in backups "for a limited time".
    Put the real number in the policy before launch.
- [ ] **Record the production environment variables** in the team password
      manager: `npx convex env list --prod`.
  - They are not part of a data backup.
  - `ENTRY_TOKEN_SECRET`, `OPENAI_API_KEY`, the alert/email keys and
    `CLERK_JWT_ISSUER_DOMAIN` are needed to rebuild a deployment.
- [ ] **Do a restore drill** (§5) once before launch, then every quarter.

## 2. Manual backup (before risky changes)

Take one before:
- a schema change that rewrites or removes fields
- a bulk data fix
- running anything with `npx convex run ... --prod` that writes data

```bash
npx convex export --prod --include-file-storage --path "echo-prod-$(date -u +%Y%m%dT%H%MZ).zip"
```

The zip has every table and every file. It contains customer data:
- store it encrypted, in the same place as the scheduled backups
- never commit it or attach it to a ticket
- delete it once it's past the retention period

A *Backup now* button in the dashboard does the same thing.

## 3. What to do, by situation

| Situation | What to do |
| --- | --- |
| An owner deleted their workspace by mistake | **No restore needed** during the 7-day grace period. They sign in and press *Cancel deletion*. If they can't sign in, confirm it's really the owner, then run `npx convex run ops:cancelWorkspaceDeletion '{"companyId":"..."}' --prod`. Find the id with `npx convex run ops:pendingDeletions --prod`. |
| Grace period over, workspace already removed | It can only come back from a backup, and only as a partial restore (§4b). Tell the owner that up front. |
| An owner deleted one note by mistake | Deleting a note is permanent in the app. Recover it from a backup with a partial restore (§4b) if it matters enough. |
| A bad deploy corrupted or removed data for everyone | Roll the code back first (DEPLOY.md → Rollback), so the damage stops. Then do a full restore (§4a) from the last backup before the deploy. |
| Convex outage | Nothing to restore. Crew phones keep notes queued and send them when the backend is back. Watch the Convex status page. |
| Lost or leaked `ENTRY_TOKEN_SECRET` | Set a new one: `npx convex env set --prod ENTRY_TOKEN_SECRET "$(openssl rand -hex 32)"`. Every crew phone must enter its PIN again. Notes waiting on the phones are kept and send after the PIN. |

## 4. Restoring

### 4a. Full restore (whole deployment back to a point in time)

A full restore replaces **everything** written after the backup was taken.
That includes notes crews recorded in the meantime. Use it only when the
damage is worse than losing that window.

1. **Pause writes.**
   - Set `OPENAI_KILL_SWITCH=1`.
   - Put the app in maintenance (Vercel → redeploy with a maintenance page,
     or pause the project).
   - Crew phones will queue notes and send them after the restore.
2. **List deletions made after the backup.** See "Deletions after the backup"
   below.
3. **Take a backup of the current state** (§2), even if it's broken. It's
   your way back if the restore goes wrong.
4. **Restore.**
   - Dashboard → Backups → pick the backup → *Restore*.
   - Or from the CLI: `npx convex import --prod --replace-all <backup.zip>`.
     Check `--help` for the flag your CLI version uses to replace all tables.
5. **Redeploy the functions that match the backup's schema.**
   - Normally that's the current `main`: schema changes so far only add
     optional fields.
   - Run `npx convex run ops:checkConfig --prod`.
6. **Re-apply the deletions** from step 2.
7. **Resume.** Unset the kill switch, take the app out of maintenance, and
   smoke-test it (DEPLOY.md §6).

#### Deletions after the backup

A restore brings back anything deleted after the backup was taken, including
whole workspaces that their owners asked to delete. The database can't tell
you what those were, because the restore just rewrote it. The logs can:

- **Before you restore**, search the Convex logs (or your log stream) for the
  time since the backup:
  - `[workspace-deleted]`: the purge finished.
  - `[workspace-deletion-requested]`: the owner asked for deletion.
  - `[workspace-deletion-cancelled]`: the owner (or ops) cancelled it.
  - Note every `companyId`.
- **After you restore**, re-apply each deletion that was requested and not
  cancelled. Run this once per `companyId`; the purge starts right away:

  ```bash
  npx convex run ops:scheduleWorkspaceDeletion '{"companyId":"..."}' --prod
  ```

  - A workspace that was still in its grace period when the backup was
    taken comes back with that same grace period. Leave it alone unless the
    logs show its purge ran.
  - To give a workspace a grace period instead of purging at once, pass
    `"graceDays": 7`.
  - Check the result with `npx convex run ops:pendingDeletions --prod`.
- Notes deleted with *Delete note* after the backup aren't logged. If that
  matters for a customer, ask the owner to delete them again.

Configure a Convex **log stream** (Dashboard → Settings → Integrations) so
these log lines are kept longer than the dashboard's own log history.

### 4b. Partial restore (one workspace or one note)

Never import a partial backup into production with `--replace` or
`--replace-all`. That would overwrite everyone else's data.

1. Create a scratch deployment, either a new Convex project or a dev
   deployment that holds nothing important.
2. Restore the backup into it:

   ```bash
   npx convex import --replace-all <backup.zip>
   ```

3. Point a local copy of the app at the scratch deployment and sign in as an
   operator. Then either:
   - use the workspace's own **Export** (Settings → Your data) to hand the
     owner a zip of their data, recordings included; or
   - copy the specific rows (and their storage files) back to production by
     hand. Re-insert them with the same `companyId`, and re-upload the files
     to get new storage ids.
4. Delete the scratch deployment when you're done. It's a full copy of
   customer data.

Exporting is usually what the owner actually needs. Hand-copying rows back is
slow and easy to get wrong, so keep it for real emergencies.

## 5. Restore drill (quarterly)

1. Take the latest scheduled backup.
2. Restore it into a scratch deployment (§4b, steps 1–2).
3. Check all of the following:
   - row counts look right (Dashboard → Data)
   - a few recordings and photos play or open
   - one workspace's export downloads and opens
4. Time the whole thing and write the date and duration below.
5. Delete the scratch deployment.

| Date | Backup used | Duration | Notes |
| --- | --- | --- | --- |
| | | | |

## 6. How deletion works (for reference)

- **Delete workspace** (owner only, typing the workspace name):
  - Access stops at once for everyone, including crews and the public crew
    page.
  - Alerts and the digest are switched off.
  - The purge is scheduled for 7 days later (`DELETION_GRACE_DAYS`).
- **During the grace period**, the owner sees a "scheduled for deletion"
  screen. From there they can cancel (which restores access and the
  alert/digest settings) or export.
- **After the grace period**, `deleteWorkspaceBatch` removes the workspace
  100 rows at a time, files included. Once the purge starts it can't be
  cancelled.
- **Backups** keep their copy until they expire (§1).
