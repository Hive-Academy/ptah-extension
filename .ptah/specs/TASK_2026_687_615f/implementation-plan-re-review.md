# Plan re-review (round 2) - TASK_2026_687_615f (cross-side, Anthropic)

Reviewed: revised `implementation-plan.md` (Revision log :44-60) against `implementation-plan-review.md` and the current
code at HEAD d5d3db286 (worktree clean apart from the task folder). Read-only. No Nx, Jest, tsc or build was run.
Paths: `CC/` = `libs/frontend/command-center/src/lib/`. "ctrl" = `CC/components/command-center-page.controller.ts` (695 lines).

**Verdict: REVISE.** All 13 round-1 items are closed in the plan. The revision adds two gaps (N2, N3), and one round-1
recommendation of mine was incomplete (N1). Items N1-N3 are small, and N4 is a one-file ownership addition.

## Round-1 items

| # | Status | Evidence (plan / code) |
| --- | --- | --- |
| 1 Guard M-3 | CLOSED | Plan :14 (B1 captures nonce and proposal id before the await, and adds an interleave spec). Bug still present at ctrl `589-591`. |
| 2 Voice-loop ownership | CLOSED | Plan :9, :11, :21 and B2 :41 own the loop halves (`armTypedTurn(minPulseSeq)`, `abandonTurn(token, outcome)`, typed kinds). Loop `437`, `471` is B2-only. |
| 3 Roster construction / DI | CLOSED | Plan :19, :33: plain class, explicit deps, lazy `() => this.voice`, `tribunalRequestActive`, pending-input effect owner, DestroyRef for all three timers. No page `providers` edit (:12, :40). Precedent: ctrl `63`, `246`. |
| 4 Wall-clock bounds | CLOSED as asked | Plan :15, :21, :34. Two gaps remain, see N1 and N2. |
| 5 F-10 | CLOSED | Plan :20, :36-37: Minor exception recorded, flag in chat-state, decision per pulse before `queueBurst` (ledger `166-173`, `433-453`), controller lifecycle in B3. F-6 and F-9 recorded (:42). |
| 6 M-B split | CLOSED | Plan :16. B1 owns the gate and text; B3 owns the `CommandToast.action` union and the button. |
| 7 Guard citation / A1 | CLOSED | Plan :23 and :38 cite `session-coordinator.ts:238-260` (verified: pre-open check `239-249`, post-open recheck `253-260`), forbid replaying Confirm or launch, and set `running` after the guard. |
| 8 Typed-turn sequence | CLOSED | Plan :9: sample before **each** `coordinator.send` (ctrl `553`, `579`) and carry it through `armTypedTurn`. Spec covers a pulse that arrives during STT. |
| 9 Abort detection | CLOSED | Plan :11: `aborted_streaming`/`aborted_tools` or a page Stop counts as an abort; null successful reply gets a cue. |
| 10 F-2 cross-workspace | CLOSED | Plan :19: `findTabByIdAcrossWorkspaces` (`tab-manager.service.ts:697-701`, reads `_tabs()`), with a pulse fallback if not reactive; signature kept. |
| 11 Checks / budget | CLOSED | Plan :38 (lanes run no checks; the orchestrator runs them one at a time) and B3 :42 (controller ≤700). |
| 12 Focus token | CLOSED | Plan :28 names `focus-visible:outline-base-content` and requires ≥3:1 in light theme. One file has no owner, see N4. |
| 13 Recorded list | CLOSED | Plan :42: R4-2, guard Minors 1-2, r7 M-A closed (:34). |

## Cross-checks that pass

- Wave 1 files are disjoint. B1 owns the controller and roster. B2 owns the loop, turn-status, send-lock, voice-session,
  `chat-state/src/index.ts`, the dispatch spec and the ledger. Wave 2 files are disjoint too: B3 has ten CC files and B4
  has scene, overlay, pending-input, shell and setup-hub. Every fix's files belong to its batch, with the one exception
  in N4.
- Library edges add no cycle. `notification-ledger.service.ts:14` and the CC controller/turn-status files already import
  `@ptah-extension/chat-state`. `libs/frontend/chat-state` imports neither `notification-center` nor `command-center`
  (zero matches). The new root-scoped service in chat-state adds no new edge.
- No DI cycle: the roster is created with `new` and gets the voice loop through a lazy port. Nothing injects the controller.
- A1 is intact. The plan keeps click-only Confirm and the nonce gate (:23). Readiness never replays (:23). The guard M-3
  fix only narrows when the nonce is cleared. `answerOrdinaryQuestion` keeps its spoken-Confirm refusal (ctrl `513-518`)
  through `tribunalRequestActive`.

## REVISE items

1. **R3-3's actual failure mode is not bounded. This corrects my round-1 item 4.**
   - The source defines R3-3 as a tab that stays `streaming` because `turn_state` never arrives
     (`TASK_2026_678_9083/code-logic-review-phase-e-r3.md:80-82, :174`).
   - Plan :21 arms the grace only after the root *leaves* the active statuses, and it keeps an "indefinite genuine stream
     ... with visible Stop". So the stuck-`streaming` case stays unbounded.
   - An automatic idle watchdog is not possible either. No signal records activity per event: `TabState.lastActivityAt`
     (`chat-types.ts:667`) is written only on create and restore (`tab-manager.service.ts:952,1030,1301,1337,1651`).
   - Correction (B3):
     - (a) Keep the leave-active grace.
     - (b) Make page Stop a guaranteed recovery. After a page Stop, if no terminal pulse arrives within the same grace,
       call `abandonTurn(token, 'aborted')` (no cue), clear the armed entries, and settle the stored status locally to
       `stopped`. Add a spec for "Stop with no pulse ever delivered".
     - (c) Add a Decisions row: a silently stuck `streaming` tab without a user Stop is not bounded automatically, because
       no event-activity signal exists and a wall-clock bound would cut legitimate turns. Mark R3-3 "narrowed" in :21.

2. **The active-status set is incomplete. This affects S1 M-A (B1, plan :15) and R3-3 (B3, plan :21).**
   - `SessionStatus` also has `resuming` and `switching` (`chat-types.ts:550-551`). The plan's set (streaming /
     awaiting-background / sleeping) would run the grace while a queued Tribunal message flushes into a `resuming` tab.
   - R3-3's cancel list also omits a pending question or permission.
   - Correction:
     - Define the grace positively. It runs only while the root status is `loaded`, `fresh` or `draft` **and** no
       question or permission request is pending for the root tab or session. Any other status, or a pending request,
       cancels it.
     - Use one shared predicate for B1 and B3. B1 defines it in the roster file and B3 imports it, so the file stays
       single-owner.
     - Spec: a `resuming` phase longer than the grace does not expire.

3. **Wave-1 integration would not compile.**
   - B2 changes `armTypedTurn()` (loop `437`) and `abandonTurn(turnToken)` (loop `471`). It may also extend
     `trackTurnStatus(tabs, store, turnAbortable)` (`turn-status.ts:49-53`) for r5 fast failure.
   - Their callers are in B1's controller (ctrl `333`, `458`, `554`, `583`). B1 does not change those calls, yet
     `nx test command-center` runs after wave 1 (plan :40-41).
   - Correction (B2, plan :41): make every new parameter optional, with today's behaviour as the default (no
     `minPulseSeq` means the callback computes it; no `outcome` means the current silent finish). Keep both
     turn-status function signatures unchanged.
   - B3 switches the callers to the new arguments and may then make them required.

4. **V M-r1-2 has no owner for one file.**
   - `CC/components/command-work-list.component.ts:41` still uses `focus-visible:outline-warning`. Neither B3 nor B4
     owns that file. The plan says "replace only in owned files" (:28), so the item would close only partially.
   - Correction: add `command-work-list.component.ts` and its spec to B4. It does not overlap with B3.

## Non-blocking note (B1 spec)

The roster's effects (ctrl `334-440`) will be created during field initialization. That registers them before the
constructor's tab-change teardown (`319-332`); today the teardown runs first. Add a B1 spec covering a marked-tab switch
while a proposal and an expected request are both pending. It must produce no stale card, no false "Invalid Tribunal
proposal" toast, and no leftover timer.
