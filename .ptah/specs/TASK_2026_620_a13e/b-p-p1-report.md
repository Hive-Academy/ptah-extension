# B-P P1 Memory Backend Report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\memory-curator.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\retention\memory-retention.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\memory-curator\src\lib\control\indexing-control.service.ts`

## Inventory coverage

| Row | Gate / disposition                                                                                              | Location                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Existing live master gate retained.                                                                             | `triggers/memory-trigger.service.ts:563`; `memory-trigger.service.spec.ts:2364`                                                                                   |
| M2  | Existing live master gate retained.                                                                             | `triggers/memory-trigger.service.ts:495`; `memory-trigger.service.spec.ts:865`                                                                                    |
| M3  | Existing live master gate retained.                                                                             | `triggers/memory-trigger.service.ts:410`; `memory-trigger.service.spec.ts:1176`                                                                                   |
| M4  | Existing live master gate retained.                                                                             | `triggers/memory-trigger.service.ts:437`; `memory-trigger.service.spec.ts:1176`                                                                                   |
| M5  | Existing live master + session-end gate retained.                                                               | `triggers/memory-trigger.service.ts:479`; `memory-trigger.service.spec.ts:1176`                                                                                   |
| M6  | Idle fire and episode curate re-read the master; pause clears timers and resume re-arms buffered episodes once. | `triggers/memory-trigger.service.ts:226`, `:680`, `:706`, `:1100`; `memory-trigger.service.spec.ts:866`                                                           |
| M7  | Owed/armed state, generation-owned scan completion, config listener, and lazy activity/session-start rearm.     | `triggers/memory-trigger.service.ts:110`, `:219`, `:636`, `:939`, `:1065`, `:1125`; `memory-trigger.boot-defer.spec.ts:358`; `memory-trigger.service.spec.ts:925` |
| M8  | In-flight curation is intentionally not aborted.                                                                | Existing queue behaviour; `memory-trigger.service.spec.ts:1834`                                                                                                   |
| M9  | PreCompact listener returns before any curation while paused, using the shared trigger constants.               | `memory-curator.service.ts:258`; `memory-curator.service.spec.ts:1424`                                                                                            |
| M10 | Explicitly unchanged follow-up F1.                                                                              | No P1 change.                                                                                                                                                     |
| M11 | Retention first returns `skipped: memory-paused`.                                                               | `retention/memory-retention.service.ts:194`; `memory-retention.service.spec.ts:690`                                                                               |
| M12 | Lifecycle inherits the retention master gate.                                                                   | `retention/memory-retention.service.ts:194`; `memory-retention.service.spec.ts:690`                                                                               |
| M13 | Memory indexing skips master-paused runs unless forced; symbols unaffected.                                     | `control/indexing-control.service.ts:314`, `:355`; `indexing-control.service.spec.ts:247`                                                                         |
| M14 | P3 RPC dependency; not touched by P1.                                                                           | `libs/backend/rpc-handlers` (P3); P1 has no spec.                                                                                                                 |
| M15 | P5 Electron warmup dependency; not touched by P1.                                                               | `apps/ptah-electron` (P5); P1 has no spec.                                                                                                                        |
| M16 | Read-side injection remains on.                                                                                 | Out of P1 / unchanged; no P1 spec.                                                                                                                                |
| M17 | Read-side symbol injection remains on.                                                                          | Out of P1 / unchanged; no P1 spec.                                                                                                                                |
| M18 | Read-side search remains on.                                                                                    | Out of P1 / unchanged; no P1 spec.                                                                                                                                |
| M19 | Shared SQLite maintenance remains out of scope.                                                                 | Unchanged; no P1 spec.                                                                                                                                            |
| M20 | Host-local trigger-key follow-up F2; unchanged.                                                                 | Unchanged; no P1 spec.                                                                                                                                            |

## Pause/resume tests

- Added retention regression: `memory paused → skipped/memory-paused before retention work` in `retention/memory-retention.service.spec.ts:690`.
- Added paused PreCompact regression in `memory-curator.service.spec.ts:1424`.
- Added paused memory-index regression in `control/indexing-control.service.spec.ts:247`.
- Added trigger regressions: `memory-trigger.service.spec.ts:866` uses a completed assistant turn to prove pause preserves a real buffered episode and settings-change resume re-arms exactly once; `memory-trigger.boot-defer.spec.ts:358` proves an externally paused in-progress scan stalls, releases its generation-owned arm, and re-arms once on lazy chat resume.
- Focused run: `Test Suites: 4 passed, 4 total`; `Tests: 232 passed, 232 total`.

## Checks

`npx nx run-many -t test,typecheck,lint -p memory-curator --parallel=1`

`NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/memory-curator`

`npx nx run degradation-audit:lint`

`libs/backend/memory-curator: 20 ok (baseline 20)`

The command exits non-zero because an unrelated concurrent `apps/ptah-electron` baseline regression was reported (`5 FAIL (baseline 4)`); memory-curator is at baseline.

`npx prettier --check libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts libs/backend/memory-curator/src/lib/memory-curator.service.ts libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts libs/backend/memory-curator/src/lib/retention/memory-retention.types.ts libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts libs/backend/memory-curator/src/lib/control/indexing-control.service.ts libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts .ptah/specs/TASK_2026_620_a13e/b-p-p1-report.md`

`All matched files use Prettier code style!`

## Review fixes round 2

- Added the no-event external-edit regression: a real buffered episode reaches `fireIdle` while `memory.enabled` reads false, performs no curation, then resumes lazily on later activity. This pins the live `fireIdle` / `tryEpisodeCurate` gate: `memory-trigger.service.spec.ts:928`; `memory-trigger.service.ts:693`.
- Replaced unconditional activity/session idle rearming with a recorded false-to-true transition. Resume rearming skips empty episodes, existing timers, provider-backoff sessions, and an exhausted current hourly rate-limit window: `memory-trigger.service.ts:229`, `:297`, `:641`, `:1103`, `:1119`; pinned by `memory-trigger.service.spec.ts:976`.
- Moved the boot root lookup inside the generation-owned `try/finally`, preserves `bootScanOwed` when no root exists, and proves a later activity re-arms exactly once: `memory-trigger.service.ts:944`; `memory-trigger.boot-defer.spec.ts:358`.

`npx nx run-many -t test,typecheck,lint -p memory-curator --parallel=1`

`NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/memory-curator`

`npx nx run degradation-audit:lint`

`libs/backend/memory-curator: 20 ok (baseline 20)`

The audit command exits non-zero because of an unrelated concurrent `libs/backend/cli-engine` baseline regression (`14 FAIL (baseline 12)`); memory-curator remains at baseline.

`npx prettier --check <changed files>`

`All matched files use Prettier code style!`

## Deviations

P3 shared/RPC types are not required by these P1 production edits; M14 remains owned by P3.

## Review fixes

- Fixed the external-edit boot-scan dead arm: each arm owns a monotonic generation and only its matching `finally` can release the arm. The regression starts a scan, changes `memory.enabled` without an event so it stalls, resumes through chat activity, and proves only one scan curates: `memory-trigger.boot-defer.spec.ts:358`.
- Fixed paused idle boundaries: pause clears timer ownership, settings-change resume (and lazy chat/session activity resume) re-arms only non-empty episodes with no timer. The regression uses a real completed assistant turn, so it would call curate without the gate: `memory-trigger.service.spec.ts:866`.
- Replaced PreCompact's hard-coded master-switch section/key/default with `MEMORY_TRIGGER_SECTION`, `MEMORY_TRIGGER_KEYS.enabled`, and `MEMORY_TRIGGER_DEFAULTS.enabled`: `memory-curator.service.ts:36`, `:260`.

`npx nx run-many -t test,typecheck,lint -p memory-curator --parallel=1`

`NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/memory-curator`

`npx nx run degradation-audit:lint`

`libs/backend/memory-curator: 20 ok (baseline 20)`

The audit command also reports unrelated concurrent baseline regressions outside this P1 scope; memory-curator remains at its baseline.

`npx prettier --check <changed files>`

`All matched files use Prettier code style!`
