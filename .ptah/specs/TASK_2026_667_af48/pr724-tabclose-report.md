# PR #724: held commands dropped on tab close

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-skill` (no git run).

## Close paths found

All paths are under `libs/frontend/chat-state/src/lib/tab-manager.service.ts`.

- `forceCloseTab` at :1245 removes the tab (:1267), then emits `kind: 'forceClose'` (:1269-1273).
- `closeTab` at :1295 aborts the stream (:1336), removes the tab (:1350), then emits `kind: 'close'` (:1352-1357).
- `resetTabToFresh` at :1386 keeps the tab and emits `kind: 'reset'` (:1435-1439).
- The existing API is `onTabClosed(listener)` at :316. It returns an unsubscribe function and delivers each event synchronously. Other services already subscribe through it with `destroyRef.onDestroy(this.tabManager.onTabClosed(...))`:
  - `closed-tab-session-ender.service.ts:42-46`
  - `session-rotation-keep.service.ts:25`
  - `transcript-retention.service.ts:85`

## Change

File: `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`

- Lines 11-17: added `DestroyRef` to the `@angular/core` import.
- Lines 87-96: added a new constructor that subscribes with the same pattern as the services above:
  `inject(DestroyRef).onDestroy(this.tabManager.onTabClosed(({ tabId, kind }) => { if (kind !== 'reset') this.dropHeldCommands(tabId); }))`.
  When a tab is closed or force-closed, its held commands now settle `false` (dropped). The listener is removed when the service is destroyed.
- The `dropHeldCommands` doc comment now also lists "a tab close".
- I added no new event type, did not touch chat-state, and added no new import into chat-state.
- Why `reset` is excluded: `/clear` keeps the tab, so the existing `releaseHeldCommand` path still settles those commands. That path drops a command when the sent text does not match the text it waited behind. Dropping commands on reset would also break a held `[/clear, /session-handoff]` chain.

## Tests

Both spec fakes gained an `onTabClosed` that tracks its listeners. The real `ConversationService` now calls it in its constructor.

- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts`, in the new describe "held commands on tab close":
  - `settles a held /session-handoff as dropped on close`
  - `settles a held /session-handoff as dropped on forceClose`
  - `keeps the held command on a reset or when another tab closes`
  - `stops listening for tab closes when the service is destroyed`
- `libs/frontend/chat/src/lib/services/session-budget-actions.queue.spec.ts` runs the real banner, dispatch and conversation services:
  - `settles the wrap-up as not sent when the tab is removed by close`
  - `settles the wrap-up as not sent when the tab is removed by forceClose`

  After the event, `sendWrapUp()` resolves, `wrapUpSent()` is `false`, `showError('...wrap-up request was not sent...', TAB)` is called and nothing is flushed.

## Verification

```
npx jest -c libs/frontend/chat/jest.config.ts \
  libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts \
  libs/frontend/chat/src/lib/services/session-budget-actions.queue.spec.ts \
  --coverage=false --maxWorkers=2
Test Suites: 2 passed, 2 total
Tests:       30 passed, 30 total
```

I ran no typecheck, lint or nx targets; those are left to the orchestrator.

`ptah_get_diagnostics` reports no errors in `conversation.service.ts` or the queue spec. In `conversation.service.spec.ts` it reports `TabId`/`SessionId` brand errors (TS2322) for `makeTab({ id: 'tab-1' })`. This file already had that pattern on its existing lines, and the new test uses it too. Jest's ts transform accepts it. I did not change it.
