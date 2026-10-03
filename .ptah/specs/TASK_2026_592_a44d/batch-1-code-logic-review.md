# Code Logic Review — TASK_2026_592_a44d, Batch 1 (libs/frontend/chat-state)

Review type: same-side (author was an in-process frontend-developer; reviewer is in-process too). Reason: CLI lanes are busy with another session. A cross-side review of the whole diff follows at the end.
Scope: `git diff -- libs/frontend/chat-state` (tab-manager.service.ts plus 3 specs). Read in full: closeTab, forceCloseTab, resetTabToFresh, abort-controller block, markTabIdle, markTabStreaming, message-sender `wireAbortDispatch`, all `closeTab` callers. I did not run the tests; the author's report claims typecheck, lint and tests pass.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED (with follow-ups for Batch 2 / a small canvas fix) |
| Blocking | 0 |
| Serious | 1 (pre-existing, widened by this batch) |
| Moderate | 3 |
| Failure modes found | 4 |

## Five logic questions

1. Silent failure. `streamAbortDispatched` is true whenever a live controller was aborted, even when the abort listener returned early because the tab had no `claudeSessionId` yet (message-sender.service.ts:223-226). No `chat:abort` is sent in that case. This is harmless to Batch 2 because the event's `sessionId` is also null, so there is nothing to end. The session that `chat:start` later creates on the backend is orphaned. That is pre-existing and outside Batch 1, but worth a note for the final review.
2. Unexpected user action. The extended confirm fires for programmatic closes. See Serious issue 1.
3. Wrong-answer input. `closeTab` captures `tab` before `await confirm` (tab-manager.service.ts:919) and uses it afterwards (`tab.claudeSessionId` at :965). If the stream's session id arrives while the dialog is open, the event carries `sessionId: null` while the abort listener (which reads the live tab) sends `chat:abort` with the real id. The abort still ends that session, so there is no leak, but the event is inconsistent. If the tab is closed during the dialog by another path, a second `closeTab` call still emits a second `closedTab`, and Batch 2 would send a duplicate `chat:abort` (low impact: the backend returns `already-ended`).
4. Dependency failure. None added by this batch. The abort listener's RPC failure is already handled with `.catch` plus `console.warn` (message-sender.service.ts:229-236).
5. Missing. There is no test that a streaming close which has a controller but whose tab has a null session id reports a sensible flag. There is no test for the flag being absent on `forceClose` or `reset`. There is also no canvas test for the cancel path (see Serious issue 1).

## Focus 1: flag correctness per close path

- `closeTab` (tab-manager.service.ts:952): the flag is the return value of `abortStreamingForTab`. It is true only if a live, unaborted controller existed. The only `createAbortController` caller is `wireAbortDispatch` (message-sender.service.ts:217), and every such controller carries the abort listener. So true means the listener fired.
- False-positive true on an idle tab: not reachable. `markTabIdle` (tab-manager.service.ts:2563) and `markTabStreaming(false)` (:1292) both clear the controller. Awaiting-background and sleeping tabs are past turn end, so their controller is cleared and the flag is false. Batch 2 will therefore correctly end those sessions. This relies on `markTabStreaming(false)` or `markTabIdle` always running before the status becomes `awaiting-background`. I did not trace every turn-end path; the logic-review of Batch 2 should confirm that.
- False negative on a streaming tab: possible when the controller was never created or was cleared, for example a queue-flush that sends with no signal (message-sender.service.ts:490-500), or a status of `streaming` with the spinner cleared. The result is flag false. Batch 2 then sends `chat:abort`, and no listener has fired, so there is no double abort. The failure direction is safe.
- `forceCloseTab` (:876) never sets the flag, and it clears the controller without aborting. Correct for pop-out, which transfers the session.
- `resetTabToFresh` (:1006) discards the boolean. The `reset` event carries no flag. This matches decision (e): `/clear` does not end the session in v1. Batch 2 filters on `kind === 'close'`.
- Already-aborted controller: returns false and drops the controller from the map. No double abort. Correct.

Verdict on Focus 1: correct. No path reports false for a live dispatched stream abort, and no path reports true for an idle close.

## Focus 2: confirm for awaiting-background and sleeping

Callers:

| Caller | Awaits | Behaviour with the wider prompt |
| --- | --- | --- |
| tab-bar.component.ts:195, keyboard-shortcuts.service.ts:77 | no | Correct; a user-initiated close. |
| app-shell.component.ts:621 (after `deleteSession` succeeded and the user already confirmed Delete) | no | A second "Close Tab?" can now appear for background tabs. Streaming and dirty tabs already had it. If the user cancels, the tab stays bound to a deleted session. |
| chat-view.component.ts:1418 (rewind delete-original) | yes | Handles cancel correctly through `survivors` (:1426). The prompt is acceptable here. |
| tribunal-run.service.ts:207 `endRun` | yes | Handles cancel through `stillOpen` (:208-211). Fine. |
| canvas.store.ts:243 `removeTile` | yes | Drops the tile even when the user cancels. See Serious issue 1. |

### Serious issue 1: canvas `removeTile` removes the tile when the close is cancelled

- File: libs/frontend/canvas/src/lib/canvas.store.ts:242-246 (the doc comment at :238-241 claims otherwise).
- Scenario: the user clicks the tile close button (canvas-workspace-grid.component.ts:132) on a streaming, dirty, awaiting-background or sleeping tab, then clicks "Keep Open". `closeTab` returns void on cancel, so the tile is dropped anyway while the tab and its session live on. The session is then unreachable from the canvas.
- Pre-existing for streaming and dirty. This batch widens it to background tabs, which are common after the user leaves a project running.
- Fix (smallest): in `removeTile`, after the await, return early if `this.tabManager.tabs()` still contains the tab. This mirrors `tribunal-run.service.ts:208-211` and `chat-view.component.ts:1426`. This can be a one-line follow-up in the canvas lib; it is outside Batch 1's file set, so route it to a small Batch or fold it into Batch 2 / 3.

### Moderate issue 2: app-shell double prompt after session delete

- File: app-shell.component.ts:621. The session is already deleted and the user already confirmed.
- Smallest correct handling: use `forceCloseTab`? No. That path skips `closedTab` semantics only partly and does not abort. Prefer leaving `closeTab` as is. The delete already ends the backend record, and Batch 2 will send a harmless `chat:abort` that returns `already-ended`. Accept the prompt, since it only appears for tabs with running work, and the user deleting a running session should arguably be asked. Document it; do not add a new bypass parameter in this task.
- Recommendation: no code change. State it in the PR description.

## Focus 3: deleted `closeOtherTabs` / `closeTabsToRight`

Grep of `libs` and `apps` for `.ts` and `.html` shows no remaining references. The only remaining hits for the names are none. No templates or context menus call them. Confirmed clean.

## Focus 4: workspace switch test

tab-manager.cross-workspace.spec.ts:145-199 uses the real `TabManagerService` with the real `TabWorkspacePartitionService` (file header lines 4-7, providers at :43-49). It checks `closedTab()` is null after switching away and back, that both parked tabs keep their ids and session ids, and that the live signal is not aborted. This is meaningful, but it is a regression guard: it passes on the pre-fix code too, because the code did not previously close tabs on a switch. That is acceptable; the test pins the invariant for the user's requirement. It does not cover a switch that happens while a `closeTab` confirm is pending (low).

## Focus 5: tests vs fix

- Confirm tests for `awaiting-background` / `sleeping`: fail on the old code (no prompt, `confirm` called 0 times). Good.
- `streamAbortDispatched` true / false tests: fail on the old code (property absent), including the already-aborted case, which asserts `toBe(false)`, not just falsy. Good.
- `abortStreamingForTab` boolean tests: fail on the old code (returned undefined).
- Weakness: the "live" test registers a bare controller with no listener, so it proves the boolean, not that a `chat:abort` was sent. That is fine for chat-state, but Batch 2's tests must cover the listener path.
- Missing edges (Minor): null `claudeSessionId` with a live controller (documents that the flag is true but the event sessionId is null); `forceClose` and `reset` events carry no flag; a streaming close where the controller was already cleared (flag false).

## Failure modes

### Stale tab across the confirm await
- Trigger: the session id is assigned, or the tab is closed, while the confirm dialog is open.
- Symptom: the event `sessionId` is null while the listener sends `chat:abort` with the real id, or a duplicate `closedTab` is emitted if two closes race.
- Evidence: tab-manager.service.ts:919 (capture), :927 (await), :965 (stale use).
- Handling: none.
- Recommendation: after the confirm, re-read `const live = this._tabs().find(...)`, return if it is gone, and use `live.claudeSessionId` for the event. A few lines; worth doing now because Batch 2 acts on `sessionId`.

### Flag true with no dispatch (null session id)
- Trigger: a close during the first stream before `chat:start` returns.
- Evidence: message-sender.service.ts:223-226.
- Impact: Batch 2 has no id, so it skips. A backend session may be orphaned. Pre-existing; record it in the task notes.

### Canvas tile dropped on cancel
See Serious issue 1.

### App-shell double prompt
See Moderate issue 2.

## Moderate and minor

- tab-manager.service.ts:2358-2360: a blank line pair is left where the two methods were removed (style, not logic).
- The comment at tab-manager.service.ts:2595 still describes the abort flow accurately.
- Doc for `streamAbortDispatched` says "already sent `chat:abort`"; given the null-session early return, say "dispatched, if the tab had a session id".

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Close tab exposes whether a stream abort was already dispatched | COMPLETE | Stale-tab detail above |
| Confirm for background and sleeping tabs | COMPLETE | Canvas cancel and app-shell prompt side effects |
| Delete dead close methods | COMPLETE | None |
| Workspace switch emits no closedTab | COMPLETE | Guard test only |
| forceClose / reset unaffected | COMPLETE | None |

## Verdict

- Recommendation: APPROVE the batch (score 7/10), with two follow-ups: re-read the tab after the confirm in `closeTab` (cheap, protects Batch 2), and the canvas `removeTile` cancel guard.
- Confidence: MEDIUM-HIGH (tests not run by me).
- Top risk: Batch 2 acts on the event's `sessionId`, which can be stale after the confirm await.
