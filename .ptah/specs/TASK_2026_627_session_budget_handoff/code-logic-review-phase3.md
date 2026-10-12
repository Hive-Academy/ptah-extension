# Code Logic Review, Phase 3 — TASK_2026_627 (Batches 7-8)

Range `91376becf..e6788c558`, libs only. Read in full: `session-budget.service.ts` (observeLive, onTurnTerminal, stageFor, accept/applyEvaluation, noticeLiveStage), `session-lifecycle-manager.ts` (onTurnTerminal, armHandoverIfIdle, atHandoffOrLimitStage), `sdk-agent-adapter.ts` (wrapLiveStatsForBudget, wrapResultStatsForActivity), plus the coordinator `armAtTerminal`/`startAutomatic`, `MainThreadNoticeQueue`, `LiveSessionStatsPublisher` header and the stream-transformer order. Ran the three specs once: 3 suites, 244 tests, all pass. Out of scope: 627-L1..L13.

## Summary

| Metric | Value |
|---|---|
| Overall score | 7/10 |
| Assessment | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 |
| Minor | 5 |

7 not 5-6: the authoritative path is untouched, every new path fails open, and the D17/D18 fix is correct. Not 8-9: D20 item 2 is a real, narrow bypass of user decision 1 that the code cannot close in these files.

## Risk checklist

- observeLive isolation: PASS. It writes only `liveFigure` and `liveNoticedRank` (`service.ts:279,313,334-335,492,507,552`). It never writes `snapshot`, `figure`, `revision`, `usageSeq`, `blocked`. `evaluateSessionBudget` is pure. It never throws: a try/catch around the whole body with `warnOnce`. `canSend`/`checkStored`/`checkSnapshot` do not read `liveFigure`.
- A3 measure guard: PASS with D15 residual. A mismatch against the authoritative measure returns before any write (`:303-310`). With no authoritative figure (first turn) there is no check; the estimate can raise `stageFor` and post a notice until the first result (D15, Minor). `stageFor` is read only by the handover arming, never by a send refusal.
- Stage floor: `previous.stage` is the floor in `nextSessionBudgetStage`, so live stage >= authoritative stage; `stageFor` max is consistent.
- R2 / D17 / D18: PASS. Terminal arms on `=== 'handoff'` only (`lifecycle:525`). Post-result arms on `handoff || limit` (`:547,558-561`), where the live figure is already cleared, so `limit` is authoritative. `armAtTerminal` is idempotent for a live op (reason kept, `startAutomatic` guards on phase `armed`). The `cancelledAutomaticSources` gate still holds, and a blocking limit clears it.
- Ordering in `onTurnTerminal`: arm reads the estimate, then `sessionBudget.onTurnTerminal`, then `markTurnEnded` (`:520-531`). Correct.
- Wrap-up notice: once per rank per turn (`:1156`); reset at terminal, extend and settings change. Limit notice posts even after a handoff notice (rank 2 > 1). Failure path: notice formatting cannot throw (`limit` is a number).
- Wrapper on all four `transform()` sites (`adapter:924,1083,1230,1592`); budget throw is WARN-once and the payload still reaches the host (`:1844-1860`).

## D20 severity judgement

1. Live `handoff` overestimate starts `budget-auto` (below 80% authoritative). Moderate. No data loss: the handoff doc is built, held inputs are carried, "Cancel" works, and the user-reserved click exists only at the blocking limit. It is the plan's intended path (`implementation-plan.md:387-394`), so accepted behaviour; the cost is an early rotation when the estimate is high (rate card vs SDK cost).
2. Live `handoff` at terminal, result reaches the blocking limit, no work in flight. Moderate, and the one genuine deviation: `armAtTerminal` already moved `budget-auto` to `writing-handoff` (`coordinator:371-375`), and S1 converts only `waiting-for-turn-end` (`:309-318`). The user loses the "Allow 20% more" choice and the click that user decision 1 and D5 reserve. No data loss. Window is narrow: the estimate must read 80-99% while the result reads >=100%, in the last second or so of a turn (live updates at <=1/s and includes the final usage frame). When `armAtTerminal` is entered with live op `budget-auto` in `armed`/running phases, nothing can convert it. Recommended fix (coordinator, deferred): when a result lands at the blocking limit and the op is `budget-auto` but not yet past `writing-handoff`, convert it, or have the lifecycle expose a "blocking" flag so the terminal defers a live `handoff` when `blockAtLimit` is on and the estimate is within a margin of the limit.

## Findings

### Moderate

1. D20 item 2, above (`lifecycle:525`, `coordinator:306-318`). Cannot break a lane config; can skip a user-reserved click. No data loss.
2. Interrupt path now arms off an estimate (`session-control.service.ts:125` calls the same `onTurnTerminal`): a user pressing Stop while the live stage is `handoff` starts a `budget-auto` rotation that no result ever confirms or refutes, since the interrupted turn may produce no usable authoritative snapshot. Previously the interrupt armed only from the last authoritative stage. Cannot break a lane config; can rotate a session the user just stopped (user can Cancel; no data loss because the handoff doc is written first).
3. Post-terminal re-publication: `onTurnTerminal` clears `liveFigure`/notices, but a throttled provisional flush that fires after an interrupt-driven terminal (no `livePublisher.onResult` ran) re-sets `liveFigure` (`service.ts:313`) and can re-post a wrap-up notice (`:1162`) that sits in the queue until the next turn's first tool result. Also the owner's non-provisional settle payload is ignored by `observeLive` (`:273`) and never reaches `accept`, so after an abnormal stream end with no result the live stage stays elevated until the next terminal or authoritative snapshot. Cannot break a lane config; the worst effect is a stale advisory stage and one stale notice. No data loss.

### Minor

1. `onTurnTerminal` clears the whole session queue (`service.ts:337`), including the subagent budget monitor's notice (`register.ts:511`) posted to the same queue. A pending subagent handoff notice is dropped at turn end.
2. D15 first-turn lower-bound/weighted estimate (accepted residual).
3. `wrapResultStatsForActivity`: if the host `inner(...)` throws, `armHandoverIfIdle` (`adapter:1825`) is skipped for that result. Arming happens at the next terminal. Put the arm in its own try before `inner`, or guard `inner`.
4. The limit notice says "Ptah will ask for a handoff and continue in a new session" (`service.ts:205`), but at a blocking limit the user must click "New session". Wording only.
5. The wrapper makes `onLiveStats` always defined (`adapter:1844`), so `LiveSessionStatsPublisher` is no longer inert for hosts with no callback (it was inert without one, `publisher inert = !onLiveStats`): a timer and owner watcher per stream everywhere. Intended, but a behaviour and cost change. A failed first handover at the terminal (sync `fail`) is retried once more by the post-result arm in the same turn.

## Five logic questions

1. Silent failure: `observeLive` swallows errors with a WARN-once (acceptable, advisory). A missing live feed degrades to turn-end-only behaviour. No success-looking false result found.
2. Unexpected user action: Stop at a live `handoff` starts a rotation (Moderate 2); Cancel is honoured through `cancelledAutomaticSources`.
3. Wrong answer on data: unpriced first-turn estimate (D15); overestimate (D20-1).
4. Dependency failure: budget or config read throws, fail-open and WARN-once; notice queue absent, `?.` no-op; host callback throws, budget already fed.
5. Missing from requirements: no way for the lifecycle to know a live `handoff` is within reach of a blocking limit; no confirmation of an estimate-armed rotation before it starts.

## Requirements fulfilment

| Requirement | Status | Gap |
|---|---|---|
| Live figure advisory only | COMPLETE | none |
| A3 measure guard | COMPLETE | D15 first-turn residual |
| Wrap-up notice once per rank per turn | COMPLETE | text wording (Minor 4) |
| Terminal arms on handoff only; post-result on handoff or limit | COMPLETE | D20-2 narrow bypass |
| Wrapper on all four transform sites | COMPLETE | none |
| Click at blocking limit always | PARTIAL | D20-2 |

## Verdict

- Recommendation: APPROVE, with the three Moderate items tracked (D20-2 first).
- Confidence: HIGH on the isolation and wiring; MEDIUM on D20 likelihood (depends on estimate accuracy in production).
- Top risk: a live `handoff` estimate starts an automatic rotation that the result then shows was at the blocking limit.
- A robust implementation would add: a coordinator conversion of an early `budget-auto` when a blocking result lands; no estimate-driven arming on the interrupt path; a queue clear that removes only the budget's own notices.
