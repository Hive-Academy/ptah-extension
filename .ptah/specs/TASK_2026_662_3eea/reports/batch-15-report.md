# Batch 15: fatal verified archive preflight

## Files changed

- `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:1-145` — fixed-table JSONL export, owner-only files, receipt, and streaming SHA-256/row-count verification.
- `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.spec.ts:1-75` — present/absent tables, pipeline-only job rows, tamper rejection, file modes, and unavailable-vec preflight.
- `libs/backend/persistence-sqlite/src/lib/migration-runner.ts:23,111-158,340-380` — awaited version-57 boundary, older vec catch-up first, fatal preflight, and guarded deferred vec catch-up.
- `libs/backend/persistence-sqlite/src/lib/migration-runner.spec.ts:16,40-56` — version-56 behavior and fatal version-57 archive failure.

## Write path and receipt

`archiveSkillPipeline(db, archiveRoot?)` defaults to `~/.ptah/backups/skill-pipeline`; the optional root lets batch 50 archive a DB copy to its chosen location. Each call creates a unique `pre-0057-*` directory with mode `0700`. The archive root is also set to `0700`. Present tables have `<table>.jsonl` files with mode `0600`. `receipt.json` has mode `0600`. Node applies these modes where the platform supports them.

The receipt is JSON with `archivePath` and an ordered `tables` array. Each entry contains `table`, `present`, `file`, `rows`, and `sha256`. Missing tables have `present: false`, `file: null`, `rows: 0`, and `sha256: null`. `job_runs.jsonl` contains only rows whose `job_id` is in the four-ID allowlist. The archive function calls `verifySkillPipelineArchive` after writing `receipt.json`; verification re-reads the receipt and every file, recomputes SHA-256 and newline row counts, and throws on mismatch. `SqliteMigrationRunner` calls this function before any migration version 57 or higher and logs the verified archive path with its injected logger. The exported verifier also lets later tooling re-read a receipt.

The four job IDs are `@ptah/skills-drain-frequent` (`libs/backend/thoth-runtime/src/lib/skill-drain-jobs.ts:43`), `@ptah/skills-drain-nightly` (`:51`), `@ptah/skills-drain-weekly` (`:59`), and `@ptah/skills-backlog-cleanup` (`libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:23`).

## Verification

Scoped `ptah_get_diagnostics` returned zero errors and warnings with clean coverage. Tests, Nx, lint, build, and e2e were not run as instructed; the orchestrator owns the specified project check. All four source/spec files use LF line endings. Migration 0057 remains unregistered; the migration registry still ends at version 56.

## Decisions

- **Archive location:** Use an owner-only dedicated directory under `~/.ptah/backups/skill-pipeline`, with an optional caller-supplied root. The plan specified an owner-only archive but no exact path; this follows the existing `.ptah` backup location and lets the later dry run choose a location. Reversible by changing the default root before 0057 registration.
- **Archive representation:** One JSONL file per present table and a JSON receipt; absent tables have explicit entries. This matches the requested format and permits direct row-count and hash verification. Reversible before a migration consumes the files.
- **Vec ordering:** Catch up deferred migrations through 56 immediately before archive verification, then allow version-57 migration or deferred vec statement. If an older catch-up fails, the preflight throws. Existing <=56 runs keep their previous catch-up behavior. This follows plan row 15 and the runner's existing deferred-vec path. Reversible before 0057 registration.
- **Job selection:** Use the four IDs declared in the thoth-runtime job specifications as a fixed SQL parameter allowlist. This preserves unrelated `job_runs` rows and avoids introducing a backend dependency from persistence to thoth-runtime. Reversible if those canonical job IDs change.
