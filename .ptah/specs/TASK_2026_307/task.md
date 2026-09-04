---
id: TASK_2026_307
status: done
type: BUGFIX
title: >-
  A single Windows-locked file still aborts a whole workspace index because
  EPERM and EBUSY are missing from MISSING_ENTRY_CODES
description: >-
  `MISSING_ENTRY_CODES` at
  `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts:41`
  absorbs per-entry errors so that one unreadable file does not abort the whole
  index. It lists only the not-found family. On Windows a file held open by
  another process — an editor, a virus scanner, a running Electron host, the
  Claude CLI writing a session file — surfaces as `EPERM`, and sometimes
  `EBUSY`, not `ENOENT`. Those codes fall through the guard at `:63`, escape the
  per-entry absorb, and abort the entire indexing pass, so a single transiently
  locked file empties the workspace index on the platform this product primarily
  ships to. The fix is to add `EPERM` and `EBUSY` to the set. The precedent for
  the correct shape is already in this repo and was written for exactly this
  hazard: `libs/backend/harness-sync/src/lib/quarantine/quarantine.ts` retries
  all four of `EBUSY`, `EPERM`, `EACCES` and `ENOTEMPTY` and fails per-path
  rather than per-run, so the quarantine and repair path does NOT have this bug.
  Consider whether `EACCES` belongs in the indexer set too, and whether a
  per-entry retry is warranted or whether skip-and-continue is sufficient for a
  read-only indexing pass. Found during the TASK_2026_306 log review and left
  unfixed there as out of scope.
updated: '2026-08-25T21:25:44.949Z'
---

# A locked file aborts the whole workspace index on Windows

Machine-owned metadata carrier. Prose lives in `./context.md`.
