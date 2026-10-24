# Code Logic Review - TASK_2026_714_c8a2, batch 1h (uncommitted diff)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REVISE |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 4 |
| Failure modes found | 6 |

Evidence: whole-file read of the changed regions of `evidence-harness.ts` (runCase 1100-1607, runHarness 1648-1870, UsageBudget 436-459, TurnBudget 63-80, RpcChild 470-630), full spec diff, cases and notes diffs. One scoped jest run: `evidence-harness.spec.ts`, 115 passed, 0 failed (output tail). No `any`, `@ts-ignore`, `@ts-expect-error` or `as unknown as` in either file (grep). No real codex binary run.

## Five logic questions

### 1. How does this fail silently?

- Last-turn usage can be missed. The loop exits on `turn/completed` (harness.ts:1542) or on the replacement-marker interrupt (1222), and then `rpc.stop()` runs. A final `thread/tokenUsage/updated` that trails the terminal event, or one never emitted for an interrupted request, is never observed (1438-1445). The 15000 / 100000 bounds therefore under-count by up to one model request. The report admits "may lag"; the artifact gap text (1855) says so as well. Not a silent success, but the bound is advisory.
- The breaching notification is not recorded in `usageByTurn`. `observe()` throws (harness.ts:452-457) before line 1444 runs, so the artifact shows the failure note but not the number that crossed the bound. Evidence-quality loss only.
- A same-turn steer costs a model request that `TurnBudget` never sees (only new turns are charged, 1175-1181). This is inherent, and the case notes record "steer stayed in the same turn".

### 2. What user action produces unexpected behaviour?

- The runner passes 7 cases of turnCost 1 and the edit case steers into a new turn. The harness uses the module constant `TURN_CAP = 8` (41, 1700 `new TurnBudget()`), so an 8th turn is accepted and billed although the user has 7 left. See S1.

### 3. What input data produces a wrong answer?

- Usage attribution is correct for the shapes seen. Thread totals are cumulative, so `observe` computes `delta = max(count, previous) - previous` and adds it to the notification's `turnId` bucket (harness.ts:443-459). A repeated snapshot adds 0 and a lower, out-of-order snapshot adds 0, so there is no double counting. The cumulative sum is the per-case thread max summed over cases, so the total is never under the true observed maximum.
- Misattribution is possible only if a delayed notification names the wrong turn. A cumulative snapshot that is delivered late is billed to whichever turn the notification names. The run total stays correct.
- A missing `turnId`, or a missing `tokenUsage.total.totalTokens`, makes `z.string()/z.number().parse` throw inside the stdout handler (1440-1441). That is fail-closed: the frame is rejected, the child is stopped and the case fails. `result.usage` is assigned before the parse (1439), which is harmless.
- `total.totalTokens` includes cached input, so the bound is conservative against billing. The edit case puts two model requests (original and steered) in one turn and may approach 15000 on its own. A false breach would latch the run stop and waste the remaining budget. See M2.

### 4. What happens when a dependency fails?

- Steer refused (RPC error): `status='error'`, a bounded note with the code, then `Approval rejected by safety gate`, interrupt and abort (1335-1352). Spec covers it. The original is already declined and no second turn/start is sent. OK.
- Steer timeout (15 s, 595): the RPC timeout fails the child. Handled by the same catch. `status` stays 'error'.
- The turn ends before the steer is sent (the server finishes the turn after the decline): the steer is rejected, the case fails, and the paid turn is wasted. Handled cleanly. Not preventable.
- Usage notification with the wrong shape: fail-closed, see above.
- A cap breach through `adoptSteerTurn` (1175-1181): the charge is recorded first and then 'not run: cap' is thrown. That is honest accounting, but the turn has already been started server-side.

### 5. What is missing that the requirements never mentioned?

- A caller-supplied cap (S1).
- A grace window for trailing usage after `turn/completed` (M1).
- A pre-steer budget check (S1).
- A guard that the runner's case list is consistent with the budget (S2).

## Failure modes

### Budget overrun via steer-created turn
- Trigger: caller budget 7, 7 cases planned at 1, the edit case's steer starts a new turn (or any 8th turn is observed).
- Symptom: 8 paid turns; `observeTurn()` returns true for the 8th (63-72) because the cap is the constant 8.
- Evidence: harness.ts:41, 69-72, 1700, 1770 (`budget.consumed >= TURN_CAP`); `HarnessOptions` (1609-1617) has no cap field; the dry-run and artifact print `cap: TURN_CAP`.
- Current handling: none for a lower caller budget.
- Recommendation: S1.

### Late or absent final usage
- Trigger: interrupt or terminal before the last `tokenUsage/updated`.
- Symptom: undercount of one request.
- Evidence: 1222, 1542-1546, 1598.
- Recommendation: M1.

### False per-turn breach in the edit case
- Trigger: original request plus steered request both land in turn-one, and the thread total reaches more than 15000.
- Symptom: the run is stopped by design, but the cost of the case is already spent and later cases do not run.
- Evidence: 443-459, 1766.
- Recommendation: M2.

### Planned-sum removal hides runner mistakes
- Trigger: the runner is edited to plan more than the budget.
- Evidence: 1649-1650 (the check is removed). The only enforcement is the runtime skip at 1770.
- Recommendation: S2.

### Original item completion after steer
- Trigger: the declined original item emits `item/completed` after steer.
- Handling: allowed (1375, `commandMatches` on `expectedCommand`). Safe: markers are enforced by `inspect()` and the approval gate.

### Race: respond then steer
- Trigger: a decline followed immediately by the steer, and the server ends the turn first.
- Handling: steer error, clean failure. Acceptable for an evidence harness.

## Blocking issues

None.

## Serious issues

### S1. The harness cannot honour a caller budget lower than 8; steer can overspend
- File: `libs/backend/codex-runtime/tools/evidence-harness.ts:41, 63-80, 1175-1181, 1700, 1770`; `HarnessOptions` 1609.
- Scenario: the next run has 7 turns left. The runner plans 7 x 1. The edit case steers into a new turn, `observeTurn()` returns 8 <= 8, and nothing stops it. If the edit case runs last, the 7 prior turns plus its new turn make 8. If steering starts a new turn earlier, the later case is skipped only at 8. Either way the user's 7-turn hard budget is exceeded by one real, paid turn. Nothing in the harness or the runner can lower the cap.
- Impact: a paid overrun of the user's explicit hard budget.
- Minimal fix (about 15 lines):
  1. `TurnBudget` takes `constructor(private readonly cap = TURN_CAP)`, with `claim()` and `observeTurn()` using `this.cap`.
  2. Add `turnCap?: number` to `HarnessOptions` (flag `--turn-cap`, an integer 1..TURN_CAP, otherwise throw). Pass it to `new TurnBudget(cap)`, to the 1770 check, and to the dry-run and artifact `cap` fields.
  3. In `onRequest`, before sending `turn/steer`, require `budget.consumed < cap`. If not, throw 'not run: cap' (decline already sent; this is a clean failure before any extra billing). This is the only check that can stop an 8th turn before it starts. Schedule the edit case so a slot remains, for example by not running it last under a tight cap, or by planning 6 + the edit case + 1 reserved slot.
  4. The runner (`spike-runner.ts`) passes `turnCap: remaining`.
- A spec is needed: cap 1, run edit, assert no `turn/steer` frame is sent.

### S2. No preflight on the planned list
- File: `evidence-harness.ts:1649-1650` (removed check), runHarness entry.
- Scenario: the planned-sum rejection was the only static protection against a mis-sized case list. A list that exceeds the budget now starts, spends, and is stopped only at runtime.
- Fix: after S1, restore the check against the caller cap: `sum(turnCost) + count(edit cases) <= cap`, where the extra count reserves the possible steer turn. The cap-8 default list can then exceed it only when the caller explicitly passes a larger plan. This removes the need for the "candidates" comment. Without it, accept the runtime skip but document that the runner owns the sum.

## Moderate and minor issues

- M1. `evidence-harness.ts:1542-1549`: no grace wait for trailing usage after `turn/completed`. Add a short bounded wait (for example up to 500 ms) for a `usageAfter` notification before stopping. Otherwise bounds undercount.
- M2. `evidence-cases.json:28-35` and `evidence-harness.ts:443-459`: two model requests in one turn can approach 15000. The user's bound is intentional, so this is a heads-up. If it trips, note in the artifact which call crossed it. `observe()` should store `turnTotal` into `usageByTurn` before throwing so the breaching number is recorded (1444 runs after the throw today).
- M3. Spec gaps (`evidence-harness.spec.ts` new block, 1357-1514): there is no spec for (a) a third approval after the second, (b) a second approval arriving without a steer (the 1260 guard), (c) `adoptSteerTurn` throwing at the cap through `runCase` (only the `TurnBudget` unit is tested), (d) the turn ending before the steer. The 'original' spec writes the original marker after approving the edited command, so it tests `inspect()`, not the case where the original command is ever accepted. The latter is covered separately by the 'repeat' spec (the exact-match gate).
- M4. The usage latch spec only asserts `usage.exceeded`; no `runHarness` test shows a later case receives 'not run: prior gate or usage bound' (the report acknowledges this; code at 1766 is simple and reads correctly).
- Minor: the steer prompt interpolates the command with a literal newline and the case prompt differs between original and edited; harmless. `evidence-failure-notes.ts` allowlist adds three literals correctly (verified against all throw sites: 'Per-turn usage bound reached', 'Cumulative usage bound reached', 'turn/steer missing from manifest').

## Data flow

1. turn/start (claimed, budget) -> `turn/started` sets `initialTurnId`, `turnId` (1364-1366) - OK.
2. Usage notification -> `observe(id, total, turnId)` delta attribution - OK, fail-closed on shape errors.
3. Request 1 -> must match the original exactly (`fixed` check, 1275-1291), hold 200 ms with marker absence checks, decline - OK. `inspect()` (editing branch) neither sets outcome nor interrupts.
4. turn/steer {threadId, expectedTurnId, input} matches `TurnSteerParams` required fields - OK. Response validated with Zod; new turn charged once by id (chargedTurns) - OK, but no pre-check of the cap (S1).
5. Request 2 -> exactly the edited command, `approvalRounds===1`, `steerSent` true; 3rd request or a request before steer -> 'Unexpected request' - OK.
6. Accept -> replacement written -> `inspect()` sets outcome and interrupts. Original or outside marker at any time -> failure - OK.
7. Status 'observed' requires 2 approvals and steer success (1556-1560) - OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 1. Usage bounds 15000 per turn / 100000 cumulative, distinct messages, breach stops later cases | COMPLETE | Observation lag, see M1, M2 |
| 1. Per-turn attribution without double or under counting | COMPLETE for in-order and out-of-order snapshots | Trailing/absent final snapshot |
| 2. ask-command-edit flow (exact match, decline, steer, no interrupt, exact edited, accept, original never written, repeated original and refused steer fail cleanly, new-turn record, charge) | COMPLETE | Pre-steer cap check missing (S1) |
| 3. Safety and other cases unchanged | COMPLETE | See below |
| 4. Turn budget honesty | PARTIAL | Constant cap 8 only (S1, S2) |
| 5. Specs real, strict TS | COMPLETE | Gaps M3, M4 |

Safety check for requirement 3: every change outside the edit case is guarded by `editing`. `markerApprovalDecision` is unchanged; `toolItems` limit is `editing ? 2 : 1`; the command-item exception requires `editing && steerSent`; the `terminal` condition is `!editing || id === turnId`, which reduces to the old behaviour for the other cases; `inspect()` early-returns only when `editing`. The only cross-case behavioural change is that `turnId` and `initialTurnId` are now also set from the `turn/started` notification (1364-1366); that only allows an earlier interrupt and does not loosen any gate. `recordCaseFailure` additions in the guard and onRequest catch are additive. The accepted side effect needs a matching approval: round 1 is accepted only when `fixed` holds for the edited command and the replacement is absent during the hold.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Repeated original command | YES | 'Unexpected command', declined, case fails | none |
| Steer refused | YES | RPC code note, interrupt, abort | turn wasted |
| Steer starts a new turn | YES | charged once (notification or response) | cap not pre-checked |
| Original marker written | YES | inspect failure | none |
| Third approval | YES | 'Unexpected request' | no spec |
| Usage snapshot repeated / lower | YES | delta 0 | none |
| Usage shape wrong / missing | YES | fail-closed | none |
| Trailing usage | NO | not waited for | M1 |
| Lower caller budget | NO | constant cap | S1 |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on the logic reviewed, MEDIUM on real server behaviour (steer response and usage ordering are unobserved).
- Top risk: with a 7-turn remaining budget the harness has no way to refuse an 8th turn, and the new steer path can create exactly that turn.
- What a robust implementation would add: a `--turn-cap` option wired through `TurnBudget`, a pre-steer `consumed < cap` check, a restored preflight sum that reserves one turn per edit case, recording `usageByTurn` before throwing, a short grace wait for trailing usage, and specs for the cap-before-steer and third-approval cases.
