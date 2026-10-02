## Frontend implementation — `TASK_2026_592_a44d`, batch 1

**Tasks completed**: 1.1 (closeTab contract), 1.2 (chat-state specs). batches.md left untouched.

**Files** (all under `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session`):

- MODIFIED `libs\frontend\chat-state\src\lib\tab-manager.service.ts`
  - `ClosedTabEvent` gains optional `readonly streamAbortDispatched?: boolean`, with a doc line.
  - `abortStreamingForTab(tabId): boolean` returns true only when it aborts a live controller. It
    returns false when no controller is registered, or when the registered controller is already
    aborted (it is still dropped from the map). Doc comment updated.
  - `closeTab` stores the return value and emits it on `closedTab` as `streamAbortDispatched`.
    `closedTab` is still emitted before the tab is removed. `forceCloseTab` and `resetTabToFresh` do
    not set the flag (`resetTabToFresh` ignores the new return value; `forceCloseTab` never called it).
  - `needsConfirmation` now also covers `status === 'awaiting-background' || status === 'sleeping'`.
    New message: "This session has unsaved changes, is streaming, or has background work running.
    Closing it ends the session. Close anyway?" Title, labels and `confirmStyle: 'error'` are unchanged.
    The method doc comment was updated to match.
  - `closeOtherTabs` and `closeTabsToRight` deleted. They had no other doc references in the file.
    Repo-wide grep (excluding node_modules) found no remaining callers or mocks.
- MODIFIED `libs\frontend\chat-state\src\lib\tab-manager.lifecycle.spec.ts`
  - Deleted `describe('closeOtherTabs + closeTabsToRight')`.
  - Added the `backgroundTurnState(phase)` helper, and a passthrough `findTabByIdAcrossWorkspaces` on the
    partition mock. `applyTurnState` needs it; the mock is copied from `tab-manager.intent-mutators.spec.ts:92-97`.
  - New tests:
    - confirm is shown for `awaiting-background` and for `sleeping` (`it.each`), with the message
      text checked, and the tab closes on confirm with a `close` event;
    - cancel keeps the tab, emits no `closedTab` and makes no `unregisterSession` call (both statuses);
    - an idle session tab closes without confirm;
    - `streamAbortDispatched` is true with a live controller, falsy for an idle tab, and `false` for a
      registered but already-aborted controller.
- MODIFIED `libs\frontend\chat-state\src\lib\tab-manager.service.spec.ts`
  - `abortStreamingForTab` returns false when there is no controller and true for a live controller
    (signal aborted, controller dropped).
  - It returns false on a second call.
  - It returns false for a registered but already-aborted controller, with no second abort event.
- MODIFIED `libs\frontend\chat-state\src\lib\tab-manager.cross-workspace.spec.ts`
  - New `describe('workspace switch never closes tabs (TASK_2026_592)')`, using the real partition.
  - Setup: WS_A gets an idle session tab and a streaming tab with a live AbortController. Then switch
    to WS_B, create a tab there, and switch back to WS_A.
  - Assertions: `closedTab()` stays null throughout. Both tabs and their session ids are intact in the
    parked partition and again after returning. `findTabBySessionId` still resolves the parked tab.
    The live stream's signal is never aborted, and the spinner set still holds the streaming tab.
  - PROVES: workspace switch emits no closedTab.

**Stack observed**: Angular signals service (`signal`/`computed`, `_closedTab.set(...)`), from
`tab-manager.service.ts`. Jest with TestBed, from the existing chat-state specs.

**Design fidelity**: no visual change beyond the confirm message text. The dialog primitive
(`ConfirmationDialogService.confirm`) and its labels and style are reused unchanged.

**States covered**: confirm/cancel for streaming, resuming, dirty, awaiting-background and sleeping.
Idle tabs close with no prompt.

**Verification**:

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-state` printed
  "√ nx run @ptah-extension/chat-state:lint / √ ...:typecheck — Successfully ran targets typecheck, lint".
  This was re-run after the last spec edit, with the same result.
- `npx nx run-many -t test -p @ptah-extension/chat-state -- --maxWorkers=2` printed
  "Test Suites: 19 passed, 19 total; Tests: 476 passed, 476 total" (EXIT=0).
  - The first test attempt printed "Failed to process project graph", most likely contention with the
    concurrent Batch 4 nx run; the retry worked.
  - The second attempt failed 4 new tests because the lifecycle partition mock had no
    `findTabByIdAcrossWorkspaces`. I fixed the mock and re-ran: green.

**Risk handling**:

| Risk / edge case | Handling |
| --- | --- |
| Double `chat:abort` on a streaming close | `abortStreamingForTab` returns true only when this call fired the abort, so the MessageSender listener has already sent `chat:abort`. `closeTab` puts that on the event as `streamAbortDispatched: true` for Batch 2 to skip on. Pinned by the lifecycle and service tests. |
| Workspace switch ending sessions | No switch path touches `closeTab`/`_closedTab`. The new real-partition cross-workspace test proves no `closedTab` fires and parked streams are not aborted. |
| Pop-out / `/clear` / tribunal rollback | `forceCloseTab` and `resetTabToFresh` emit their events without `streamAbortDispatched`, and their `kind` stays `forceClose`/`reset`. Existing tests for both still pass. |
| `closedTab` single-value coalescing | Removed the only batch closers (`closeOtherTabs`, `closeTabsToRight`). Every remaining caller closes one tab per call. |
| Controller present but already aborted | Returns `false`, so the event carries `streamAbortDispatched: false`, and Batch 2's ender may send one extra `chat:abort` (harmless and rare, as accepted in the plan). The doc comment says so and a test pins it. |
| Confirm cancelled on `awaiting-background`/`sleeping` | Returns before abort, unregister and emit. Tested: tab kept, `closedTab()` null, no `unregisterSession`. |
| Programmatic closers now prompt for background tabs (tribunal `endRun`, app-shell delete cleanup, rewind delete-original) | Grepped the specs outside chat-state: none calls the real `closeTab`. The only programmatic caller spec, `tribunal-run.service.spec.ts`, mocks `closeTab` (`:286`, `:823`), so no spec asserts "no prompt". This behaviour change needs confirming at runtime and visual review (completion evidence). The `@ptah-extension/chat` test run belongs to Batch 2 and has not been run in this batch. |

**Plan deviations**: none. One addition: the lifecycle spec's partition mock gained
`findTabByIdAcrossWorkspaces`, needed to drive real `applyTurnState` into the background statuses.

**Out-of-scope observations**: none.

## Review fixes

Source: batch-1-code-logic-review.md (APPROVED with follow-ups). Only `libs/frontend/chat-state` was changed; `canvas.store.ts` was not touched (it belongs to Batch 2).

1. **Stale tab after confirm**. File: `libs\frontend\chat-state\src\lib\tab-manager.service.ts`.
   - `closeTab` uses its first lookup (`initialTab`) only for the confirm decision.
   - Once the confirm resolves (or is skipped), it re-reads the tab by id from `_tabs()`. The abort,
     the unregister, the `closedTab.sessionId`, the tab index and the removal all use that fresh read.
   - If the tab is no longer in the active list after the confirm, `closeTab` returns without emitting
     `closedTab`. This covers a tab closed by something else, force-closed, or parked by a workspace
     switch while the dialog was open.
2. **Missing tests**. File: `libs\frontend\chat-state\src\lib\tab-manager.lifecycle.spec.ts`.
   - Null `claudeSessionId` with a live controller: the event has `sessionId: null` and
     `streamAbortDispatched: true`, and there is no `unregisterSession` call.
   - A session id attached during the confirm (from inside the mocked dialog) appears in the emitted
     event, and the code unregisters it.
   - A tab force-closed during the confirm: there is no `close` emit. The last event is the
     `forceClose`, and the other tab survives.
   - `forceCloseTab` and `resetTabToFresh` events have no `streamAbortDispatched` property, even with a
     live controller registered.
3. **Formatting**. Removed the double blank line left in `tab-manager.service.ts` where
   `closeTabsToRight` used to be.

Verify (tail):

```
npx nx run-many -t typecheck,lint -p @ptah-extension/chat-state @ptah-extension/chat
√  nx run @ptah-extension/chat-state:lint
√  nx run @ptah-extension/chat-state:typecheck
√  nx run @ptah-extension/chat:lint
√  nx run @ptah-extension/chat:typecheck
 NX   Successfully ran targets typecheck, lint for 2 projects

npx nx run-many -t test -p @ptah-extension/chat-state -- --maxWorkers=2
Test Suites: 19 passed, 19 total
Tests:       480 passed, 480 total
 NX   Successfully ran target test for project @ptah-extension/chat-state
```
