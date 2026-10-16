# Plan re-review (round 3, final) - TASK_2026_687_615f (cross-side, Anthropic)

Reviewed: `implementation-plan.md` (95 lines, Revision log round-2 rows :92-95) against
`implementation-plan-re-review.md` N1-N4 and current code at HEAD d5d3db286. Read-only; no Nx, Jest, tsc or build.
`CC/` = `libs/frontend/command-center/src/lib/`; "ctrl" = `CC/components/command-center-page.controller.ts`.

**Verdict: REVISE (one item).** N1-N4 are closed. The Stop fallback added for N1 adds one Serious defect. The
fallback was my own round-2 recommendation, and it rested on a wrong premise.

## Round-2 items

| # | Status | Evidence (plan / code) |
| --- | --- | --- |
| N1 R3-3 bound | CLOSED in scope | Plan :21 is marked "(narrowed)". Plan :65 adds the Decisions row with source `code-logic-review-phase-e-r3.md:80-82,174` and the `lastActivityAt` evidence. The spec "Stop with no pulse ever settles locally" is at :21. See R1 for the defect the fallback adds. |
| N2 Active-status set | CLOSED | Plan :15 and :21: grace only in `loaded`/`fresh`/`draft` with no pending root question or permission; `resuming`/`switching` cancel it; the spec covers a long `resuming` phase. Statuses verified at `chat-types.ts:545-553`. B1 exports the predicate from the roster file (:40). B3 owns that file in wave 2 (:42), so the file has one owner per wave. |
| N3 Wave-1 compile | CLOSED | Plan :41: `armTypedTurn(minPulseSeq?)` and `abandonTurn(token, outcome?)` default to today's behaviour; `trackTurnStatus`/`trackMarkedTabVisibility` signatures stay unchanged; B3 switches the callers. Current signatures: loop `437`, `471`; `turn-status.ts:49-53`; callers ctrl `333`, `458`, `554`, `583`. |
| N4 Work-list focus owner | CLOSED | Plan :43 adds `command-work-list.component.ts` and its spec to B4. Every remaining `focus-visible:outline-warning` file has an owner: work-list `:41`, pending-input and overlay (B4), and voice-hud, session-controls and page (B3). |

## Ownership and disjointness after the round-2 edits

- Wave 1: B1 owns the controller and roster (:40). B2 owns the loop, turn-status, send-lock, voice-session, the
  chat-state index, the dispatch spec and the ledger (:41). They are disjoint.
- Wave 2: B3 owns ten CC files (:42). B4 owns scene, overlay, positioner, pending-input, work-list, shell and
  setup-hub (:43). They are disjoint.
- The new Stop fallback edits only controller and roster code, which B3 owns. The armed queue is the controller's
  `armedTurns` at ctrl `101`, not loop state, so B3 needs no loop edit.
- Round-1 items show no regression. A1 (click-only Confirm and the nonce gate) is untouched.

## REVISE

1. **Serious: the Stop fallback timer (plan :21) can corrupt a newer turn, and it is redundant.**
   - *It is redundant.* Today's page Stop already recovers at once, with or without a pulse:
     - HUD Stop emits `(stop)="page.stopVoice()"` (`page.component.ts:265`).
     - `stopVoice` clears the armed turns immediately (ctrl `496-498`, `691-694`).
     - `voice.stop()` → `release()` sets `awaitingTurnToken = null` and clears the queued turns (loop `580-603`).
     - `coordinator.stop()` sets `stopped` before `chat:abort` (`session-coordinator.ts:216-229`).
     - My round-2 item N1(b) assumed Stop did not settle. That assumption was wrong.
   - *It can corrupt a newer turn.* As written, the timer starts on Stop and only a pulse cancels it. Suppose the
     user presses Stop, restarts voice and sends within the 10-15 s window. Then the timer:
     - clears the new turn's armed entries, so the pulse effect at ctrl `441-459` never settles that turn and the
       hang that R3-3 fixes comes back;
     - writes `stopped` over a live `running` turn.
   - Correction (B3, plan :21 and the spec column):
     - Delete the timer fallback.
     - State that page Stop recovery is the existing synchronous path, with the citations above.
     - Keep the spec "Stop with no pulse ever delivered", asserting: no armed entry, loop not awaiting, store
       `stopped`.
     - Add a spec: a late pulse after Stop plus a new send produces no cue, no double settle and no status rewrite.
     - Update the :92 Revision-log row to match.
     - If a timer is still wanted, it must capture the token and armed snapshot at Stop, clear only those entries,
       skip the status write when a newer send has happened, and be cancelled by `startVoice`, `sendCommand`/
       `armTypedTurn`, a rebind or destroy.
