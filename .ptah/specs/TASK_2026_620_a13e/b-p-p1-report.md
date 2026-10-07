# B-P P1 Memory Backend Report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\memory-curator.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\retention\memory-retention.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\control\indexing-control.service.ts`

## Inventory coverage

| Row | Gate / disposition                                                                                | Location                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| M1  | Existing live master gate retained.                                                               | `triggers/memory-trigger.service.ts:563`; `memory-trigger.service.spec.ts:2364`                                 |
| M2  | Existing live master gate retained.                                                               | `triggers/memory-trigger.service.ts:495`; `memory-trigger.service.spec.ts:865`                                  |
| M3  | Existing live master gate retained.                                                               | `triggers/memory-trigger.service.ts:410`; `memory-trigger.service.spec.ts:1176`                                 |
| M4  | Existing live master gate retained.                                                               | `triggers/memory-trigger.service.ts:437`; `memory-trigger.service.spec.ts:1176`                                 |
| M5  | Existing live master + session-end gate retained.                                                 | `triggers/memory-trigger.service.ts:479`; `memory-trigger.service.spec.ts:1176`                                 |
| M6  | Idle fire and episode curate re-read the master; pause event clears timers.                       | `triggers/memory-trigger.service.ts:225`, `:675`, `:706`; `memory-trigger.service.spec.ts:865`                  |
| M7  | Owed/armed state, config listener, lazy activity/session-start rearm, and stalled callback added. | `triggers/memory-trigger.service.ts:109`, `:219`, `:629`, `:946`, `:1090`; `memory-trigger.service.spec.ts:900` |
| M8  | In-flight curation is intentionally not aborted.                                                  | Existing queue behaviour; `memory-trigger.service.spec.ts:1834`                                                 |
| M9  | PreCompact listener returns before any curation while paused.                                     | `memory-curator.service.ts:253`; `memory-curator.service.spec.ts:1424`                                          |
| M10 | Explicitly unchanged follow-up F1.                                                                | No P1 change.                                                                                                   |
| M11 | Retention first returns `skipped: memory-paused`.                                                 | `retention/memory-retention.service.ts:194`; `memory-retention.service.spec.ts:690`                             |
| M12 | Lifecycle inherits the retention master gate.                                                     | `retention/memory-retention.service.ts:194`; `memory-retention.service.spec.ts:690`                             |
| M13 | Memory indexing skips master-paused runs unless forced; symbols unaffected.                       | `control/indexing-control.service.ts:314`, `:355`; `indexing-control.service.spec.ts:247`                       |
| M14 | P3 RPC dependency; not touched by P1.                                                             | `libs/backend/rpc-handlers` (P3); P1 has no spec.                                                               |
| M15 | P5 Electron warmup dependency; not touched by P1.                                                 | `apps/ptah-electron` (P5); P1 has no spec.                                                                      |
| M16 | Read-side injection remains on.                                                                   | Out of P1 / unchanged; no P1 spec.                                                                              |
| M17 | Read-side symbol injection remains on.                                                            | Out of P1 / unchanged; no P1 spec.                                                                              |
| M18 | Read-side search remains on.                                                                      | Out of P1 / unchanged; no P1 spec.                                                                              |
| M19 | Shared SQLite maintenance remains out of scope.                                                   | Unchanged; no P1 spec.                                                                                          |
| M20 | Host-local trigger-key follow-up F2; unchanged.                                                   | Unchanged; no P1 spec.                                                                                          |

## Pause/resume tests

- Added retention regression: `memory paused → skipped/memory-paused before retention work` in `retention/memory-retention.service.spec.ts:690`.
- Added paused PreCompact regression in `memory-curator.service.spec.ts:1424`.
- Added paused memory-index regression in `control/indexing-control.service.spec.ts:247`.
- Added trigger regressions in `memory-trigger.service.spec.ts:865`: pause clears a pre-armed idle timer; a host booted paused keeps its scan owed, re-arms from chat activity after a live setting flip, and does not double-arm.
- Focused run: `Test Suites: 4 passed, 4 total`; `Tests: 232 passed, 232 total`.

## Checks

`npx nx run-many -t test,typecheck,lint -p memory-curator --parallel=1`

`NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/memory-curator`

`npx nx run degradation-audit:lint`

`libs/backend/memory-curator: 20 ok (baseline 20)`

The command exits non-zero because an unrelated concurrent `apps/ptah-electron` baseline regression was reported (`5 FAIL (baseline 4)`); memory-curator is at baseline.

`npx prettier --check libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts libs/backend/memory-curator/src/lib/memory-curator.service.ts libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts libs/backend/memory-curator/src/lib/retention/memory-retention.types.ts libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts libs/backend/memory-curator/src/lib/control/indexing-control.service.ts libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts .ptah/specs/TASK_2026_620_a13e/b-p-p1-report.md`

`All matched files use Prettier code style!`

## Deviations

The full section-5 event-driven boot-scan test is not present: the new regression covers the lazy (no-event) resume and no-double-arm path, while the production listener implements the event path. P3 shared/RPC types are not required by these P1 production edits; M14 remains owned by P3.
