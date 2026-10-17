# Batch 4 report

## Task 4.1

Implemented `reduceIdleSession` as a pure, total reducer over the existing idle
signal and state types. It derives `timer` after every transition. Only a matching
Pending `attempt-due` emits `fire`, and that transition mints `claimId`.

Added a focused spec covering arming refusals, cancellation, stale and repeated
due signals, all timer phases, failure and timeout paths, both completion orders,
no-boundary completion, and notice identity. It includes the live P1 order and
same-run `session-bound` cases in both `precompact` and `postcompacted`.

Files written:

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-session.reducer.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-session.reducer.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-4-report.md`

## Verification

The prescribed Jest plus Nx command ran once in the foreground with tailed
output and `NX_NO_CLOUD=true`. Jest stopped before running tests because a spec
fixture spread a union-typed `turn()` signal into a `turn-ended` literal. The
fixture was corrected after that run. Nx typecheck reported success. Scoped
`ptah_get_diagnostics` after the correction reported zero TypeScript errors and
zero warnings. The corrected Jest spec has **not** been rerun because the batch
instruction allows the command only once; runtime test pass remains unverified.

Both new source files are under 500 lines (219 and 197 lines after correction).

## Risks handled

- Claim lifetime: boundary then result enters `boundary-ended` with claim held;
  matched PostCompact or the grace timeout releases it. PostCompact-first
  releases the claim immediately and retains only notice matching state.
- Missing or late boundary: a postcompacted result or grace timeout closes
  without a notice. A new-run binding or manual PreCompact closes the same way,
  so a later manual boundary cannot receive the idle notice.
- P1 second init frame: a `session-bound` with the current `runToken` is a
  no-op, including during `precompact` and `postcompacted`; the next boundary
  still sets the notice. The spec also follows the observed PreCompact,
  PostCompact, boundary, result order.
- Stale data and duplicate sends: turn readings are cleared on a new turn;
  mismatched session, attempt or deadline phase cannot fire or complete an
  attempt. Timers are computed from the resulting attempt on every reduction.
- External state and time: the reducer reads no clock or I/O; it uses only the
  supplied `ctx.now` and settings. The `rekey` signal changes the current
  session ID without replacing the attempt.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use deterministic IDs from run, turn, time and previous pending ID; derive claim ID from attempt ID. | Deterministic state-derived ID or random/clock-generated ID. | Pure reducer requirement and existing `IdleAttempt` fields. | Yes. |
| Treat same-run `session-bound` as no-op. | Reset on every init or reset only for a new run. | P1 re-emits init with the same session ID before boundary; Batch 4 explicitly requires this case. | Yes. |
| Keep `postcompacted` after claim release until boundary, result, grace expiry or a new run/manual compaction. | Close at PostCompact or retain notice matching briefly. | Component 4 completion order and D10 manual-gap rule. | Yes. |
