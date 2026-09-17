# Batch 7, Task 7.3 — Docs: name the hard-link/EXDEV residual

Docs-only change. Two files edited. No code change. No commit.

## Added sentences

### `libs/backend/persistence-sqlite/CLAUDE.md:62-66`

Added to the residuals paragraph that names the upgrade-day partial-daily case (the paragraph at lines 57-61 is unchanged):

> A second known limitation: when the backups directory sits on a filesystem
> without hard-link support, atomic publish fails, so every backup reports
> not-taken with a `'critical'` degradation — the failure is permanent and
> loud, and there is no copy or rename fallback by design.

### `libs/backend/persistence-sqlite/src/lib/backup.service.ts:28-31`

Added to the module docblock residuals text (the upgrade-day residual sentence at lines 26-27 is unchanged):

> A second known limitation: a backups directory without hard-link support
> fails the publish, so every backup reports not-taken with a `'critical'`
> degradation — permanent and loud, with no copy or rename fallback by design.

## Code evidence for the severity claim

Verified before writing. The code does what the review claims:

- `integrity-worker-protocol.ts:708-716` — the publish is `env.fs.linkSync(request.stagingPath, request.destPath)`. A non-EEXIST failure removes staging only, then returns `fail('atomic publish failed: ...')`. `fail` (line 612) builds a `backupUnavailable` response, which carries verdict `'unavailable'`. So EXDEV and `EPERM`/`ENOTSUP`-style link failures all map to `'unavailable'`, not to a fallback copy or rename.
- `backup.service.ts:360-381` — the host's `verdict === 'unavailable'` branch: only the two collision details (`BACKUP_DESTINATION_EXISTS`, `BACKUP_STAGING_EXISTS`) take the short-circuit paths; every other detail, including `atomic publish failed: ...`, reaches `reportNotTaken` at line 377.
- `backup.service.ts:408-416` — `reportNotTaken` emits `code: 'database.backup.not-taken'` with `severity: 'critical'` and logs at `warn`.

So: every backup attempt of every kind on such a host reports not-taken with one `critical` degradation event. The failure repeats on every attempt (nothing about the filesystem changes between runs) and there is no copy/rename fallback path anywhere in `performBackup`. The added sentences match the code.

Pinned by an existing spec: `reports an atomic-publish failure without a rename or copy fallback` (`integrity/integrity-worker-protocol.spec.ts:552-576`, per the batch 1 task 1.4 R1 review, section "New findings").

## Verification

`npx nx run-many -t lint --parallel=1 -p @ptah-extension/persistence-sqlite`:

```
 NX   Running target lint for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite

Linting "@ptah-extension/persistence-sqlite"...

✔ All files pass linting

 NX   Successfully ran target lint for project @ptah-extension/persistence-sqlite
```

Header names 1 project. 0 lint errors.

`git diff --stat`:

```
 libs/backend/persistence-sqlite/CLAUDE.md                 | 5 +++++
 libs/backend/persistence-sqlite/src/lib/backup.service.ts | 4 ++++
 2 files changed, 9 insertions(+)
```

Only the two permitted files changed. 9 insertions, 0 deletions — comment/markdown only.