# Batch 37 report

## Pre-delete reference search

Ran `rg -n "SKILL_DRAIN_JOBS|skill-drain-jobs|SKILL_BACKLOG_CLEANUP|skill-backlog-cleanup|createSkillDrain|createSkillBacklog" libs apps tools scripts` before deletion. For the Thoth runtime job symbols and paths, the source matches were:

- `libs/backend/thoth-runtime/src/index.ts:18-20` — drain job and type exports.
- `libs/backend/thoth-runtime/src/index.ts:29-32` — backlog cleanup job, handler, and type exports.
- `libs/backend/thoth-runtime/src/lib/skill-drain-jobs.ts:3,40` — job table documentation and definition.
- `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:22,30,40` — job and handler definitions, plus a separate skill-synthesis cleanup service token reference.
- `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.spec.ts:15-17,57,73,79,81,91,96,108,120,134,147,159,163` — imports and assertions for the deleted cleanup job; lines 73 and 159 reference its service token.

The broad expression also matched unrelated skill-synthesis cleanup service/store source and static `tools/mcp-bench` JSON references. A follow-up source search for the exact runtime job names, paths, and exported types found **no importer outside the files changed or deleted here**. There were no Electron importers and no other source importers. `skill-drain-jobs.spec.ts` did not exist.

## Files deleted/changed

- Deleted `libs/backend/thoth-runtime/src/lib/skill-drain-jobs.ts`.
- Deleted `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts`.
- Deleted `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.spec.ts`.
- Changed `libs/backend/thoth-runtime/src/index.ts` to remove both job exports and the obsolete drain comment.

## Decisions

- Kept the memory retention export and other Thoth runtime wiring intact, as required by plan row 33 C.
- After deletion, scoped `rg` found no Thoth runtime job references and source `rg` found no remaining references to the deleted job names or paths.
- Did not run tests, typecheck, lint, build, serve, or e2e, per task instructions.

## Clarifications Needed

none
