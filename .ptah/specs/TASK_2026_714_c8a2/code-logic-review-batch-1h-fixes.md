# Code Logic Review - Batch 1h fix round (TASK_2026_714_c8a2)

Scope: the fix round only (S1, S2, M1, M2) in `libs/backend/codex-runtime/tools/evidence-harness.ts` and `evidence-harness.spec.ts`, uncommitted. Read-only. The one allowed Jest run passed: 126 of 126 tests (1 suite).

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 3 |

## S1: caller cap - closed

- `TurnBudget` (harness.ts:64-81) validates an integer from 1 to TURN_CAP in its constructor. `claim()` and `observeTurn()` compare against `this.cap`.
- `parseOptions` (:1678-1679) converts `--turn-cap` with `Number` and builds a `TurnBudget` to validate it. 0, 9, 1.5 and abc are rejected, and the spec covers all four.
- The run loop skips a case when `budget.consumed >= cap` (:1823). The artifact (:1875) and markdown total (:1925) use the effective cap.
- The edit case checks `budget.consumed >= budget.cap` after the decline and before `turn/steer` (:1349). It then records `turn/steer not sent: turn cap reached`, interrupts and fails, so `turn/steer` is not sent at the cap. The cap-1 spec (:1513) asserts no steer frame and `consumed === 1`.

Can a turn still start above the cap?
- A normal `turn/start` or `thread/compact/start` goes through `claim()` (:591), which refuses at the cap. This covers a case claimed before the check and compaction.
- A steer is sent only when `consumed < cap`. A steer-created turn is therefore charged at most up to `cap`, never above it. Each edit case has one steer (`approvalRounds === 1`), and `adoptSteerTurn` is idempotent through `chargedTurns`, so the response and the `turn/started` notification cannot double-charge.
- Residual (Minor): a server-created turn in a non-edit case is never charged. This predates the fix round and is not an over-cap start that the harness issues itself.
- Next real run, cap 7 with 7 cases of turnCost 1 and the edit case second: the 7th case is skipped whenever the steer creates a new turn. If the steer stays in the same turn, all 7 run. This is the accepted no-reserve design. It is reported as `worstCaseTurns` and `turnBudgetNote`, and the skipped case shows `not run: prior gate or usage bound`. The caller should expect the 7th case to be skipped.

## S2: preflight - closed

- `runHarness` (:1697-1700) throws when `sum(turnCost) > cap`, before dry-run output and before any child starts. The spec (:1530) asserts that `spawn` is not called.
- `worstCaseTurns` is planned turns plus the number of edit cases. It appears in the dry-run output and the artifact. The spec at :1541 checks it.
- Minor: the 11 default cases total about 8 or 9 by turnCost (several have cost 0, including the compaction case). A default `--run` may therefore need `--turn-cap` or a case selection. The report states this.

## M2: breaching usage recorded - closed

- The handler (:1432-1438) copies `usage.turnTotal(...)` into `result.usageByTurn` in a `finally` block, so the value is saved even when `observe` throws.
- The spec (:1502-1509) asserts `usageByTurn` equals the breaching total (`USAGE_TURN_LIMIT + 1`, or 100 in the cumulative mode), plus `usage.consumed` and `usage.exceeded`. This is a real assertion, not a tautology.

## M1: bounded trailing usage - closed, with one accuracy issue

- A single 500 ms timer is created together with the promise (:1224-1230). `finishUsageWait` clears it. The `finally` block also awaits the wait and calls `clearTimeout` (:1637-1638). The wait always resolves in at most 500 ms, so there is no hang. The case deadline is cleared only after the wait, so at worst it adds 500 ms.
- `beginUsageWait` is guarded by `usageWait ||`, so a second terminal or interrupt does not recreate the timer. No timer leaks.
- The trailing-usage spec (the interrupt path) and the terminal-usage spec (the normal-completion path) exercise real timing with a 30 ms notification.

### Moderate 1 - the "not observed" note can be false (:1224-1230, :1431, spec :1558)

- `finishUsageWait(true)` fires only for a usage update that arrives after `beginUsageWait`. If the turn's usage arrives before the terminal event, which is the usual order and the order in the `happy` fake (usage 200 before the interrupt), the wait always runs the full 500 ms. It then records `not observed within 500 ms` even though usage was observed.
- The spec at :1558 locks this in: its fake child sends usage 200 and the test still expects "not observed".
- Impact: every case pays a 500 ms stall, and the evidence artifact carries a misleading note. Evidence quality is affected, not safety.
- Fix: in `beginUsageWait`, resolve immediately with `observed` if `result.usageByTurn?.[turnId] !== undefined`. Alternatively, reword the note to "no further usage after terminal".

### Moderate 2 - one usage wait per case (:1217, :1180)

- `usageWait` is created once per case. After a steer starts a new turn, `adoptSteerTurn` resets `interrupted` and `terminal` but not the wait. Trailing usage for the second turn is not covered by the wait if the first turn already used it.
- This is an edge case in edit-case evidence only.

## Minor

- `Number(value)` accepts forms like `0x7`, `7 ` and `1e0` for `--turn-cap` (:1678). They are harmless because the result still has to be an integer from 1 to 8.
- A steer-created turn after the cap check relies on the throw in `adoptSteerTurn` (:1184-1188) as a backstop. It is unreachable given the :1349 check and is acceptable.
- The cap-7 and edit-second scenario is not a spec. Only cap 1 and the preflight are covered.

## Verdict

APPROVED, 8/10. S1, S2, M1 (boundedness and cleanup) and M2 are closed with no regression found. No turn can start above the caller cap, and the steer is correctly gated. The one defect is the inaccurate "not observed" usage note and its needless 500 ms stall. It should be fixed with a cheap early-resolve check, but it does not block the next real run.
