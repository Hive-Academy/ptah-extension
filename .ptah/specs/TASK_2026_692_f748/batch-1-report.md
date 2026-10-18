# Batch 1 report

## Task 1.1 — coordinator claim and admission

Implemented synchronous idle claims, matching release, manual admission reservations, and PostCompact-aware manual decisions. Claims and reservations move with a rekeyed record and disappear on reset, unregister, and dispose. A late TRIGGERED → COMPACTING status preserves `postCompactSeen`; leaving an open state or opening a new run clears it. The decision type includes `coalesced`, and the public surface exports only `ManualCompactDecision` and `ManualCompactAdmission` types. No claim, reservation, or mark change emits a state transition.

Files modified:

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\compaction-coordinator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\compaction-state.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\index.ts`

## Task 1.2 — coordinator spec

Added cases for both admission orders, matching and mismatching releases, claim and reservation rebind/reset/lifetime, unknown and open sessions, OBSERVE_ONLY admission, PostCompact under equal and changed IDs, and the required PreCompact → PostCompact → late compacting status → manual `send` sequence. Also covered mark reset on boundary/new run and registration.

File modified:

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\compaction-coordinator.spec.ts`

## Validation risks and edge cases

- **Gate 2 mark loss:** fixed in the transition logic and covered by the late-status test. PostCompact before a boundary admits manual sends; the coordinator retains its existing boundary and dwell behavior.
- **Admission order and router race:** coordinator operations are synchronous and tested in both orders. The router's await placement and router spec belong to Batch 12.
- **Codex proxy / OBSERVE_ONLY:** state behavior remains unchanged; a spec verifies idle claims and reservations still apply to OBSERVE_ONLY records.
- **Unknown, reset, rekey and disposal:** claims fail safely for unknown/open records; matching IDs are required for releases; record-bound data moves on rekey and is dropped on reset/unregister/dispose.
- **A2 live `/compact` behavior:** no live send path was added here; P1 remains the Batch 10 acceptance gate. A3 event order remains a P1 assumption. A1, A4 and A5 are owned by later QA or batches.
- **Constructor compatibility, settings count/write path, service spec size, pending send liveness, scheduler leaks, lifecycle file size, UI evidence, and reducer ordering/rekey/sleep/settings edge cases:** no files for those features were changed in Batch 1; their listed mitigations remain assigned to Batches 2–17 and QA.

## Verification

Command run in the worktree (Bash, output tailed):

`npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -30 && npx nx typecheck @ptah-extension/agent-sdk 2>&1 | tail -20`

Result: **1 test suite passed; 45 tests passed; 0 failed.** `@ptah-extension/agent-sdk` typecheck succeeded (`tsc --noEmit`). Scoped `ptah_get_diagnostics` found 0 errors and 0 warnings. Nx printed a non-blocking Cloud organization 401 message after the successful local target.

## Decisions

- **Reservation identity:** use a coordinator-local incrementing string ID. A per-record counter was an alternative. The local counter stays fresh across record resets and requires no I/O; this is reversible without changing the public contract.
- **Claim refusal order:** return `open` before `held` or `manual-reserved` for an open record, following the plan's stated refusal order. A claim still takes precedence over manual dedupe when queried through `requestManualCompact`, as required for coalescing; this is reversible if the service needs a different refusal label.
