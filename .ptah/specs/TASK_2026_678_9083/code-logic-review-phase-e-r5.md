# Code Logic Review - TASK_2026_678_9083 - Phase E round 5 (delta, commit af8906844)

## Summary

| Metric        | Value                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| Score         | 7/10                                                                                  |
| Assessment    | NEEDS_REVISION                                                                        |
| Blocking      | 0                                                                                     |
| Serious       | 1 (a status turn still reaches the old workspace session)                             |
| Moderate      | 4                                                                                     |
| Minor         | 3                                                                                     |
| Scope         | The 8 changed source/spec files, plus session-coordinator.ts, tab-manager.service.ts, chat-lifecycle.service.ts for context. No tests run (the orchestrator ran 309/309, typecheck and lint). |

## Review family

- Implementer: codex (CLI lane), with orchestrator edits (`canSend` in the binding, do-while first open, harness fake, audit marker).
- Reviewer: Anthropic (Claude Sonnet 5.5). Different family from the implementer.

## N-1 status: CLOSED (with one test gap)

The new condition `loaded && !claudeSessionId && hasLiveSession === false` (`command-center-turn-status.ts:91-93`) is set only by `markSessionStartFailed` (`tab-manager.service.ts:1178-1181`, explicit `hasLiveSession: false`).

- Successful first turn: `markStreaming` sets the sticky `hasLiveSession: true` on the first streaming transition (`tab-manager.service.ts:1645-1648`). A success therefore never matches, and neither does a user Stop (`coordinator.stop` sets `'stopped'` first, `session-coordinator.ts:226`, so the `sessionStatus() === 'running'` guard also blocks it). No false error toast.
- Ordering: `markSessionStartFailed` writes `status`, `hasLiveSession` and the message in one `updateTabInternal` and then calls `markTabIdle`. The effect reads one `tabs()` snapshot, so the fields are present when the effect fires.
- The strict `=== false` is correct: a tab with `hasLiveSession` undefined does not match.
- Failed RESUME of an existing session (`claudeSessionId` set): not matched. `markSessionStartFailed` itself refuses such tabs (`:1172`), so the error goes through `turn_state` and `lastTerminalReason`. If that path sets no reason, the resume still settles silently to idle. This was not in scope, noted as Minor m-1.
- Residual race (M-3 below): if the failure lands before `coordinator.send` resolves and calls `setSessionStatus('running')` (`session-coordinator.ts:254`), the effect never sees `running`, and `shownSessionStatus` quietly shows `idle`. The r3 run showed running then idle, so the usual order works.

## N-2 status: PARTIAL (core flow CLOSED; one bypass open)

Traces:

- Initial open: the constructor `page.open()` calls `binding.open()`. `observedWorkspace` is captured at construction, so the first effect run returns early. No double open (also pinned by `workspace-binding.spec.ts:45-50`). If the workspace is null at first, `clear()` toasts, and the effect opens when it appears.
- A to B idle: the effect calls `open()`, the do-while runs `openOrResume`, `store.workspace()` becomes B, and the loop exits. OK.
- A to B while A streams: the marked tab changes, so the controller effect (`controller.ts:317-330`) tears down Tribunal/voice state and visibility unregisters. The effect-2 `idle` settle does not toast (root is undefined or `sessionStatus` is `'starting'`). A's turn keeps running with nothing observing it (M-2).
- A to B to A quickly: if the first rebind is still in flight, the effect skips (`store.workspace()` is still A), and the do-while loop re-opens for A after B lands (`binding.ts:30-39`). OK. Another window is a few microtasks wide (`opening` cleared in `finally` after the loop exit). `canSend` self-heals it.
- B becomes null: `clear()` sets session null, status error and a toast. When a workspace returns, the effect reopens. OK.
- open() fails: a null result breaks the loop, `opening` is cleared in `finally`, and there is no infinite loop. The loop is bounded by real workspace changes. A rejection also clears `opening`, and the caller is not left with an unhandled rejection. See M-1 for the swallowed rejection.
- `canSend` with a stale binding refuses the send, toasts, and rebinds. Voice transcripts go through `sendCommand(…, 'voice')` (`controller.ts:265`), so they are guarded. Typed and voice commands cannot reach the old session.
- Effect write loops: `open()` runs inside the effect without `untracked`, so its synchronous reads (`tabs.tabs()`, `store.*`) become dependencies. Reruns hit the early return and re-track only `activeWorkspacePath$`. Harmless, not a loop (Minor m-2).

Open item: S-1 (below).

## R4-4 status: CLOSED

`overscroll-behavior: contain` is gone from `.rail` (`command-center-page.component.ts:75-81`). `.rail` still has `max-height: clamp(420px, calc(100vh - 280px), 620px)` plus `overflow-y: auto`, so R3-1 still holds (a bounded single scroller). The stacked-layout block (`:100-103`) is unchanged. `.work-list-region` keeps its own `contain` (`:108`), which R4-1 needs. The spec flips to `not.toContain('overscroll-behavior: contain')` (`component.spec.ts:142`). It is CSS-string pinning, and runtime wheel chaining is only verified by the visual round.

## AC22 / Amendment A1

Holds. The new code adds `open`, `canSend` and `clear` only. It never sends text and never answers or confirms a Tribunal roster. `confirmProposal` and `sendLaunchTurn` are unchanged. Confirm still comes only from the card.

## Findings

### Blocking

None.

### Serious

**S-1. The Status button bypasses the stale-workspace guard.**
- File: `command-center-page.component.ts:274` (`(requestStatus)="page.coordinator.sendStatusTurn('Status')"`); the guard lives only in `controller.sendCommand` (`controller.ts:541`).
- Scenario: the user switches workspace A to B and clicks Status before the rebind finishes (the rebind can take up to 3 x 5 s of `session:list` retries in `session-coordinator.ts:151-175`). `coordinator.send` uses `markedTabId()`, which is still A's tab, so a billed "Status" turn goes to the OLD workspace session.
- Impact: this is the exact N-2 harm ("a command reaches the old workspace session"). The user sees A's status while looking at B. It is also a failed rebind's permanent state: after a null open result `store.workspace()` stays A, so Status keeps working against A.
- Fix: put the binding check inside `CommandCenterSessionCoordinator.send` (it has `tabs` and `store`: refuse when `markedTabId` is set and `store.workspace() !== tabs.activeWorkspacePath`). That also covers `sendLaunchTurn` (M-4). Or add a controller `requestStatus()` that calls `canSend()` and use it in the template. Add a spec for the status path.

### Moderate

- **M-1. Open rejections are swallowed under a false "reported" marker.** `binding.ts:60-62, 73-75`: `open().catch(() => {})` is annotated "the coordinator reports open failures through the safe toast". The coordinator only reports failures inside its try blocks. A throw from `switchTab` or `createCommandCenterTab` (`session-coordinator.ts:74, 121`) after `setSessionStatus('starting')` leaves the status at `starting` with no toast. The rejection reaches the effect/`canSend` caller, which discards it. Fix: in those catches, call `store.setSessionStatus('error')` plus a fixed-text toast.
- **M-2. A turn streaming on the old workspace is left running when the binding moves.** `binding.ts:68-76` and `controller.ts:317-330`: teardown stops voice and Tribunal discovery but does not abort A's turn, and nothing surfaces its result. Likely acceptable (same as leaving the page), but undeclared. Document it or abort deliberately.
- **M-3. Fast start failure can be missed.** `turn-status.ts:79-89` needs `previousTurnAbortable === true` and `sessionStatus() === 'running'`. If the tab goes streaming then failed before `coordinator.send` sets `running` (or within one flush), the toast never fires and the tab shows idle. The r3 log order suggests the usual case works. Consider setting `running` before awaiting the sender, or having the effect treat `starting`/`idle` plus a fresh failed-start tab as an error too.
- **M-4. Tribunal Confirm during the stale window.** `tribunal.transport.ts:175` calls `coordinator.sendLaunchTurn`, which reaches the old tab while the card is still shown (the marked-tab effect clears it only after the rebind lands). It is a click, so AC22 holds, but the launch turn goes to the old workspace session. The coordinator-level guard in S-1 covers it.

### Minor

- **m-1.** A failed resume of an existing session (`claudeSessionId` set) is still silent unless `lastTerminalReason` is set. Not in the r3 findings; note for the backlog.
- **m-2.** Wrap `void open()` in `untracked(...)` inside the workspace effect (`binding.ts:71-77`), so the effect does not re-track the coordinator's reads.
- **m-3.** The `canSend` toast reads "switching to the selected workspace" even when the first open is merely in flight with `store.workspace()` still null (`binding.ts:51-58`). Text only.

## Test quality

- N-1: `controller.spec.ts` pins the failed-start toast (`:476-489`, with explicit `hasLiveSession: false`). The success no-toast assertion (`:~460-480`) uses a tab WITH `claudeSessionId`, so it does not exercise the new discriminator. Gap: no test for `loaded`, no `claudeSessionId`, `hasLiveSession: true` (success or Stop) giving idle and no toast, nor for `hasLiveSession: undefined`.
- N-2: the binding spec and the controller spec pin the initial dedupe, A to B rebind, null clear, and the stale send refused with no `coordinator.send`. Not pinned: A to B to A during an in-flight open, open failure / `opening` reset, `sendStatusTurn` while stale (the S-1 path), do-while second pass. They are real assertions, not tautological, but cover the happy rebind only.

## Verdict

NEEDS_REVISION, 7/10, confidence HIGH on the code read (no tests run by me).

N-1 and R4-4 are closed. N-2 is correct for typed/voice commands and rebinding, but the Status button still reaches the old workspace session. Move the guard into `CommandCenterSessionCoordinator.send` (closes S-1 and M-4), add the discriminator-negative and stale-status specs, and fix the rejection handling (M-1).
