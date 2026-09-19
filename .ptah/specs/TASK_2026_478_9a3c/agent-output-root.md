## Backend implementation — `TASK_2026_478_9a3c`, batch 1

**Tasks completed**: Isolated governor deferral from the run wall budget; added a sustained-foreground starvation escape; added failing-before/passing-after coverage for both behaviours.

**Files**:

- MODIFIED `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts` — adds a 250 ms governor ceiling and a two-skip foreground threshold.
- MODIFIED `libs/backend/memory-curator/src/lib/retention/retention-run-budget.ts` — uses the independent governor ceiling and permits only forced runs to bypass the foreground hard stop.
- MODIFIED `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts` — forces the third eligible hourly attempt after two consecutive foreground skips.
- MODIFIED `libs/backend/memory-curator/src/lib/retention/retention-run-budget.spec.ts` — covers the independent ceiling and the narrowly scoped foreground bypass.
- MODIFIED `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts` — covers post-timeout batch progress and sustained-load starvation escape.

**Stack observed**: TypeScript 5.9 in an Nx 22.6 monorepo; product-side tsyringe DI; better-sqlite3 persistence through the existing `ObservationRetentionStore` and `SqlitePageReclaimer`. Sources: root `CLAUDE.md`, `libs/backend/memory-curator/CLAUDE.md`, and `libs/backend/memory-curator/project.json`.

**Verification**: `npx nx run-many -t test -p @ptah-extension/memory-curator` ran exactly one project and passed 42/42 suites, 706/706 tests. `npx nx run @ptah-extension/memory-curator:typecheck` passed. `npx nx run @ptah-extension/memory-curator:lint` passed with five pre-existing warnings in unrelated files and zero errors.

**Plan deviations**: No batch or implementation plan existed. The change follows the confirmed task context directly. `observation-retention.store.ts` and `persistence-sqlite` were not changed; no index, `processed_at` write, unbounded delete, or `VACUUM` was introduced.

**Out-of-scope observations**: The first full test attempt encountered an unrelated shared Jest transform-cache `EPERM`; 41 suites and 623 tests passed while one suite could not start. The exact rerun passed completely. The starvation counter is intentionally in-memory on the singleton service, so a host restart resets the two-skip history; each continuously running host still forces a bounded run on its third eligible hourly attempt.
