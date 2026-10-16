# Plan review - TASK_2026_687_615f (cross-side, Anthropic)

Reviewed: `implementation-plan.md` (72 lines, codex lane) against `task.md`, `decisions.md`, `context.md`,
TASK_2026_678_9083 `future-enhancements.md` and its cited reviews, TASK_2026_686_eb9e `code-logic-review-r3.md`,
and current code in the worktree (HEAD d5d3db286). Read-only; no Nx/Jest/tsc run.
Paths: `CC/` = `libs/frontend/command-center/src/lib/`. "ctrl" = `CC/components/command-center-page.controller.ts`.

**Verdict: REVISE.** The inventory is mostly accurate and the preserve list covers every public member. But one open
Moderate is missing. Three batches have ownership gaps, where a fix needs a file that its batch does not own. Two
timeout designs would cut legitimate long turns. The F-10 design misses its own race and adds a library edge it
does not need.

## Spot-checks (all against current code)

| Claim in plan | Result | Evidence |
| --- | --- | --- |
| N1 closed (typed `voiceError`) | Correct | `CC/model/command-center.store.ts:70-82` |
| F-2 counted registration closed | Correct | `chat-state/.../tab-manager.service.ts:3149-3173` |
| V r6 M-1 closed (draft kept on refusal) | Correct | `CC/components/command-center-page.component.ts:406-420` |
| V r3 M-1 closed (no rail overscroll) | Correct | `page.component.ts:75-81` |
| R4-1 closed | Correct | `page.component.ts:104-109` |
| r5 S-1 / M-4 closed (guard in `send`) | Correct | `CC/model/session-coordinator.ts:238-260` |
| S1 M-A open (no expiry) | Correct | ctrl `379-411` |
| S1 M-B open (no retry-decline UI) | Correct | `page.component.ts:237-245` handles only `retry-speech` |
| r6 M-1 open (`void page.open()`) | Correct | `page.component.ts:432`; ctrl `462-480` has no catch around the open |
| R3-3 / D M-4 open | Correct | ctrl `441-459`, with `abandonTurn` for every non-success at `:458` |
| 686 M-1 open; Space key; Mic icon | Correct | `send-lock.service.ts:66-68`; `setup-hub.component.ts:797`; `electron-shell.component.ts:150-159` |
| M-r1-7 / E M-6 open | Correct | `command-scene-renderer.ts:299-303`; `scene-layout.ts:352-357` (full-viewport grid) |

Preserve list (plan :52-54): all 20 public fields and 13 public methods of the controller are assigned to either the
controller or the provider. None is lost. The A1 click-only Confirm chain is preserved (ctrl `148-160` filter,
`509-518` refusal). The plan also says not to regress the stale-workspace guard.
Wave order: B3 after B1 for the controller, and B3 after B2 for `command-center-turn-status.ts`. Both are correct.
E M-5 can reuse the existing `focusWorkListRow` output (`command-overlay.component.ts:141`, bound at
`page.component.ts:188`), so B4 needs no edit to the page.

## REVISE items

1. **Missing open Moderate: guard M-3** (`code-logic-review-phase-d-guard.md:85-89`, listed in future-enhancements
   under the S1 section). ctrl `586-593`: `confirmProposal` still runs `this.expectedRequest.set(null)` (`:590`)
   unconditionally after `await this.tribunal.confirm(id)`, so it can clear the nonce of a newer request. Add an
   inventory row and assign it to B1 (roster provider). Fix: capture `expectedRequest()?.nonce` before the await,
   and clear only if the value is unchanged. Add a spec: a new Tribunal request sent during the confirm await keeps
   its nonce.

2. **Ownership gap in the voice loop.** D M-1/M-2, D M-4/E M-4 (typed `stt/tts/playback/chat` kinds) and R3-3 all
   need changes in `CC/voice/command-voice-loop.ts` (`beginAwaitingTurn :446-451`, `abandonTurn :471-475`, error
   sites). Only B2 owns that file (wave 1), and B2's coverage list (plan :44) names only N3 and D M-3. B3 does not
   own it. Fix: put the loop side of these items in B2 with a named API, for example
   `abandonTurn(token, outcome: 'failed' | 'aborted' | 'timed-out')`, typed-turn sequence capture (item 8) and a
   `setVoiceError` call per kind. B3 then wires the controller side. The alternative is to give B3 the voice loop
   and its spec in wave 2.

3. **Roster provider construction is underspecified and would hit a DI cycle.**
   - The roster effects call the voice loop: ctrl `372-373`, `417`, `437-438`, `592`, `602`, `615`, `634`,
     `662-663`. But `voice` is built inside the controller with a callback that reads `ordinaryQuestion` (`:251-256`).
     An `@Injectable` provider cannot reach `voice` unless it injects the controller, which is a cycle.
   - The page `providers` array (`page.component.ts:39-45`) and its spec belong to B3, not B1.
   - Fix (preferred): construct the provider as a plain class inside the controller field initializer, with explicit
     dependencies and a small voice port. This follows the existing precedent: `new TribunalRunCoordinator`
     (`:63`), `new CommandVoiceLoop(..., hooks)` (`:246`) and `trackWorkspaceBinding` (`:50`).
   - Otherwise, B1 must own `page.component.ts` (providers line only) and its spec in wave 1, and the plan must state
     how the voice port is attached.
   - Also specify:
     - (a) The provider exposes a `tribunalRequestActive` signal, because the retained `answerOrdinaryQuestion`
       reads `activeTribunalRequest` (`:514`).
     - (b) Name the owner of the pending-input effect (`:412-440`). It also writes `store.setPendingInput` and
       speaks permission and ordinary prompts.
     - (c) The provider clears every timer it owns through a `DestroyRef`: the roster timeout, the invalid-Decline
       timer and the new TTL. Today only the invalid-Decline timer is cleared on destroy (`:272`). The roster
       timeout is cleared only through `exit()`.

4. **Fixed wall-clock bounds would cut legitimate long turns (S1 M-A and R3-3, plan :14, :22, :66).**
   - S1 M-A: a 120 s limit from creation expires while a slow discovery turn is still streaming. The real proposal
     that arrives later is then declined as invalid (ctrl `365-374`).
   - R3-3: a fixed limit per voice turn gives up on a slow agent turn, and its reply is then dropped by the token
     check (loop `:455-461`).
   - Fix: start each bound only when the root tab stops being `streaming`, `awaiting-background` or `sleeping`
     without a newer terminal pulse. Use a short grace period (about 10-15 s; tunable) and cancel it if streaming
     resumes.
   - For M-A, start it after the skipped pulse (`:401-407`), as the source review suggests ("grace timer after the
     skipped pulse").
   - Specs: a long streaming turn longer than the grace period does not expire; idle after the skip does expire.

5. **F-10 is not the smallest correct fix.**
   - (a) **Severity and scope.** The source rates F-10 Minor and phrases it as "confirm no notification sound
     plays" (`code-logic-review-phase-e-r1.md:152-176`). Verify it in the Electron pass first. If it is kept as a
     fix, record the scope extension under Decisions. The same applies to F-6 and F-9, which are also listed under
     Minor (`:152-175`). `task.md` says Minors are recorded, not fixed.
   - (b) **Library.** Place the flag in `chat-state`, next to `CommandCenterSendLockService`
     (`chat-state/src/lib/command-center-send-lock.service.ts:11`, root-scoped and specific to the Command Center).
     Both `command-center` and `notification-center` already import `chat-state`. Today `command-center` does not
     import `notification-center`. A feature-to-feature edge is allowed (`eslint.config.mjs:409-416`) and makes no
     cycle, but it is an unnecessary new coupling.
   - (c) **Race.** `BURST_MS = 350` (`notification-ledger.service.ts:44`). The chime fires at `:452`, normally
     before TTS synthesis has produced audio, so a check for "spoken audio active" at burst time is false and the
     chime still plays. Instead, key on "Command Center voice session active for root tab X", set on voice
     start, stop and exit and cleared on page destroy. Evaluate it per pulse in the effect at `:167-172`: still
     call `appendCompletion` and the announcement, but leave matching pulses out of the sound count.
   - (d) **Wiring.** `CommandVoiceLoop` is built with `new` in the controller (`:246`), so the call that sets the
     flag needs a controller edit. That edit belongs to B3, not to B2 in wave 1.

6. **S1 M-B UI is in the wrong batch.** The new `retry-decline` action needs the `CommandToast.action` union
   (`store.ts:67`) and the toast button (`page.component.ts:237-245`). Both are B3 files, but B1 covers M-B in
   wave 1. Fix: B1 keeps `retryInvalidDecline` and the interim and final toast text. B3 adds the union member and
   the button.

7. **Stale-guard citation and A1 under r6 M-2.**
   - The guard is at `session-coordinator.ts:238-260` (the pre-open check and the post-open recheck), not
     `250-287`. Lines `262-287` are `bindingIsCurrent`. Fix the citation at plan :72.
   - State explicitly that the new readiness path only re-opens the session. It must never replay a Confirm or a
     launch turn (`sendLaunchTurn :297-299`) after the rebind. The user clicks again (A1).
   - The r5 M-3 option "set running before send" must stay after the guard.

8. **D M-1/M-2 fix is too vague** ("settle tokens by tab and terminal sequence", plan :9).
   - Concrete cause: `minPulseSeq` is computed when the turn begins awaiting (ctrl `259-262`). A typed turn queued
     during STT (loop `437-444`) whose pulse has already arrived is therefore excluded, which leaves a phantom
     token and a deaf loop.
   - Fix: read `lastTerminalPulseByTab().get(tabId)?.seq` before `coordinator.send` (`:553`, `:579`) and carry that
     value through `armTypedTurn` (`:554`, `:583`) into the armed entry.
   - Spec: the typed turn's pulse arrives before `beginAwaitingTurn` and the turn still settles.

9. **D M-4 abort detection is unspecified.**
   - Pulse classification is only `'success' | 'error'` (`tab-manager.service.ts:84`). Define an abort as
     `terminalReason` equal to `'aborted_streaming'` or `'aborted_tools'` (`shared/.../sdk-hook.types.ts:74-75`),
     or a Stop the user started on the page.
   - Also give a cue for `success` with a null `lastAssistantMessage`. It currently falls into `abandonTurn`
     silently (ctrl `456-458`).

10. **F-2 old-tab retention across workspaces.**
    - `tabs.tabs()` covers only the active workspace. After a workspace switch, the old tab's terminal state is
      never observed, so the registration would last until the page is destroyed.
    - Fix: read the old tab's status through `findTabByIdAcrossWorkspaces` (`tab-manager.service.ts:697`). It is
      an assumption that this lookup is reactive; the implementer must check it.
    - Keep the `trackMarkedTabVisibility(tabs, store)` signature unchanged in wave 1, because its caller (ctrl
      `:311`) is a B1 file.

11. **Checks and line budget.**
    - `context.md:9-10` says lanes run no Nx or Jest while running in parallel. The CLAUDE.md rule is one heavy
      check at a time. Plan :43-46 tells every wave-1 and wave-2 lane to run `nx test`. Fix: lanes write specs
      only, and the orchestrator runs the scoped checks one at a time after each wave.
    - Add "controller stays at or below 700 lines (target about 550 after B1)" to B3 as well. Today only B1 states
      the limit, and B3 adds F-6, r6, R3-3, D M-1/M-2 and D M-4 to the controller.

12. **V M-r1-2 focus token is unnamed** ("one existing high-contrast focus token", plan :29). Name
    `focus-visible:outline-base-content`, the repository standard (about 112 uses in `libs/frontend`). Require a
    measured contrast of at least 3:1 in light theme. B3 and B4 each replace `outline-warning` only in their own
    files.

13. **Recorded list (plan :72).**
    - Add R4-2 (`code-logic-review-phase-e-r4.md:79`) and guard Minors 1-2.
    - Mark r7 M-A (`code-logic-review-phase-e-r7.md:97-110`) as closed by `page.component.ts:412-417`, so that the
      inventory accounts for every Moderate in the cited reviews.
