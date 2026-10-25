# Batch 1h fix report

## Summary

Implemented S1, S2, M2 and M1 in the scoped harness and spec. No changes to cases or failure-note labels. No git commands, installs, tests, lint, formatting checks or builds were run. Scoped ptah_get_diagnostics returned zero errors and warnings (TypeScript compiler source).

## S1: caller turn cap

- `libs/backend/codex-runtime/tools/evidence-harness.ts:66`: TurnBudget validates and retains a caller cap (default TURN_CAP); claim and observed-turn accounting use it.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1349`: after declining the original command, a full budget prevents steer, records `turn/steer not sent: turn cap reached`, interrupts, and fails cleanly.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1660`: optional HarnessOptions.turnCap and CLI --turn-cap validation. Effective cap is used in scheduling (1823), dry-run (1708), artifact (1872) and markdown total (1925).
- Specs: `does not send steer when the caller cap is one` (spec.ts:1513); `rejects --turn-cap %s` for 0, 9, 1.5 and abc (1522); `accepts --turn-cap 7` (1526).

## S2: planned-turn preflight

- `libs/backend/codex-runtime/tools/evidence-harness.ts:1697`: reject sum(turnCost) above the effective cap before child creation, including dry-run. No reserve slot added.
- Same block calculates worstCaseTurns as planned turns plus command-edit cases. Dry-run and artifact include that value and the note that a steer-created turn can cause later cases to be skipped. Runtime cap skips use `not run: prior gate or usage bound` (1823).
- Specs: `rejects planned turns over the caller cap before spawning a child` (spec.ts:1530); `reports worst-case turns without reserving a steer slot in preflight` (1541).

## M2: preserve breaching usage

- `libs/backend/codex-runtime/tools/evidence-harness.ts:447`: expose the accumulated total for a case/turn. UsageBudget already updates its cumulative accounting before throwing.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1478`: a finally clause copies the accumulated turn total into usageByTurn even when observe throws; the bound error propagates only after evidence is saved.
- Extended spec `%s usage bound fails the active case and latches the run stop gate` (spec.ts:1502, assertions at 1507) checks both the breaching turn total and cumulative total.

## M1: bounded trailing usage

- `libs/backend/codex-runtime/tools/evidence-harness.ts:1214`: a single 500 ms usage timer starts on interruption or terminal notification. Matching turn usage resolves it early and records `usage after terminal: observed`; expiration records `usage after terminal: not observed within 500 ms`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1587`: await the bounded window before settling the case, then recheck protocol health and markers. Finally also awaits an existing window and clears its timer (1637); the marker guard stays active during the wait. An interrupt no longer requires an indefinitely delayed terminal event before the window can finish.
- Specs: `captures trailing usage after %s` for trailing-usage (interrupt) and terminal-usage (normal completion), spec.ts:1550; `records when terminal usage does not arrive within 500 ms`, spec.ts:1558. Fake child uses a 30 ms trailing notification and the real bounded timeout.

## Decisions

- Validate caps in TurnBudget as well as parsing, covering direct API callers; options outside integer 1..TURN_CAP are rejected. Reversible implementation detail.
- Apply preflight to dry-runs too, since the requirement is rejection of oversized input case lists. Worst-case reporting does not reserve or charge turns. Reversible policy choice explicitly required by this round.
- Preserve the original usage-bound exception while copying evidence through finally; this avoids duplicating usage accounting in notification handling. Reversible implementation detail.

## Not done / risks

- Specs were added but not run, per caller instruction. Live App Server behavior remains unverified.
- Usage arriving later than 500 ms can still be absent; output explicitly records expiration. Observed bounds remain post-report safeguards, not provider-side spending limits.
- The full default case list can exceed the restored preflight cap; callers must pass a fitting selection. No case removal or reserve slot was introduced.
- M3 and M4 remain out of scope.
