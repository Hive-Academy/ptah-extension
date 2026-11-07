---
id: TASK_2026_603_b573
status: backlog
type: BUGFIX
title: Stop a failed settings write from landing later with the next save
depends_on: []
created: "2026-10-03T12:10:04.051Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  After two failed writes of one key, PtahFileSettingsManager keeps an unpersisted value in memory,
  and the next successful set() of any key writes it to disk. Also quiet the ENOENT temp-sweep warning.
executor: backend-developer
estimate: S
labels:
  - settings
  - persistence
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

1. **Double failure.** `set()` rejects with `SettingsPersistError` and restores the previous
   in-memory value when its write fails. After two failed writes of the same key in a row, the
   second rollback restores the first write's value, which was never persisted. The next
   successful `set()` of any key writes it to disk, because `persist()` serialises the whole map.
   So a save that the user saw fail can land later. Fix: track the last persisted value per key
   (or a persisted snapshot), and roll back to it, never to an unpersisted value.
2. **ENOENT warning.** The stale temp-file sweep warns when a temp file is already gone. Treat
   ENOENT as expected and keep other error codes logged.

Keep the process-wide temp name counter (`persistTempSequence`) and the cross-process behaviour.

Acceptance: a spec for fail, fail, then a successful set of another key (the file never contains
the first failed value), and a spec that the sweep logs nothing for ENOENT and still logs other
codes.

## Current state (2026-11-07)

- Defect 1 is open. `libs/backend/platform-core/src/file-settings-manager.ts:146-177` restores
  `previous` (the in-memory value before this call), not the last persisted value.
- Defect 2 is partly done: a missing folder is now silent (`:605-611`), but a vanished temp file
  still logs `console.warn` (`:622-626`) with no ENOENT check.

Full context, plan and discussion live in [./context.md](./context.md).
