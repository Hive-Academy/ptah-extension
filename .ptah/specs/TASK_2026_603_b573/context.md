# TASK_2026_603 — a failed settings write must not land later

## Why

`libs/backend/platform-core/src/file-settings-manager.ts`. TASK_2026_555 Batch 1 made `set()` reject with
`SettingsPersistError` and restore memory when its write fails, with rollback owned by a per-key generation. Two
defects stay open (`TASK_2026_555/batches.md` follow-up 4, and m-6 in `final-code-logic-review.md`):

1. **Double failure (Batch 1 M1, `set()` around lines 122-147):** two failed writes of the same key in a row: the
   second rollback restores the first write's value, which was never persisted. It stays in memory, and the next
   successful `set()` of **any** key writes it to disk, because `persist()` serialises the whole map. So a save that
   the user saw fail (with an alert) can land silently later.
2. **Benign ENOENT warning (the temp-file sweep, around lines 553-558):** the orphan temp sweep logs a warning when
   the folder or a temp file is already gone. Noise only.

## Scope

- Track the last persisted snapshot (or per-key persisted value). A generation-owned rollback restores the persisted
  value, never an unpersisted one.
- Treat ENOENT in the sweep as expected (no warning); keep other codes logged.
- Keep TASK_2026_555's process-wide temp name counter (`persistTempSequence`) and the cross-process behaviour.

## Acceptance criteria

1. Spec: fail, fail, then a successful set of another key: the file never contains the first failed value.
2. Spec: the sweep logs nothing for ENOENT and still logs other codes.
3. Typecheck, lint, tests for platform-core and settings-core (Linux CI included).

## Out of scope

The settings schema and migrations.
