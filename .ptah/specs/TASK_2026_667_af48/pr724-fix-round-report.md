# PR #724 fix round: held commands on workspace removal and /clear

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-skill`. I ran no git commands and changed nothing in chat-state.

## Decision 1: workspace removal reuses `removedWorkspace$`, with no new close kind

I checked every `onTabClosed` subscriber to see whether `removeWorkspaceState` should emit `close`:

- **`closed-tab-session-ender.service.ts:49-64`.** On `close` it sends `chat:abort` for each orphaned session. Workspace removal already ends those sessions: `electron-layout.service.ts:355-382` aborts them after a confirm, and `:624-632` aborts the rest, before `cleanupWorkspaceState` runs at `:419`. A `close` event would send a second `chat:abort` for each session. The ender itself warns at `:21-22` that a second abort can overwrite the first one's persisted resume state. It also documents at `:19` that "a workspace switch never emits a close event at all". So emitting `close` is wrong.
- **`stream-router.service.ts:81`, `orchestra-canvas.component.ts:462-469` and `transcript-retention.service.ts:85-89`.** Each does per-tab teardown on close. The canvas and transcript retention already clean up workspace removal through `removedWorkspace$` (`orchestra-canvas.component.ts:436-441`, `transcript-retention.service.ts:96-102`). A close event would duplicate that work or change the router's behaviour, which is outside this fix.
- **`session-rotation-keep.service.ts:55-65`.** It would be harmless, but that alone does not justify the event.

A new `workspaceRemoved` kind would widen the `ClosedTabEvent` union (`tab-manager.service.ts:166`). Then all 6 subscribers would need to handle or ignore it, and so would the `closedTab` last-event signal.

The existing `removedWorkspace$` signal is narrower and needs no chat-state change. It is set for every removal, active or parked (`tab-workspace-partition.service.ts:475-478`, exposed at `tab-manager.service.ts:863`). The workspace's tab set is deleted first (`:456`), and the active `_tabs` are cleared (`tab-manager.service.ts:831-834`). After that, `findTabByIdAcrossWorkspaces` no longer resolves any of those tabs. Consumers already use this "prune ids that no longer resolve" pattern (`transcript-retention.service.ts:91-102`). The effect settles one change-detection pass after the removal. Any flush in between already drops the commands, because `releaseHeldCommand` drops them when the tab is gone (`conversation.service.ts:~245`).

## Decision 2: drop held commands on every `reset`, including the held `/clear` → `/session-handoff` chain

A held command is released only by `releaseHeldCommand`. That runs either after a delivered queue flush (`message-dispatch.service.ts:270`) or after the user cancels or edits the queue (`chat.store.ts:377-382`). A flush needs two things:

- a terminal `turn_state` for the tab's session (`chat.store.ts:424-437`)
- a bound session (`sendQueuedMessage` keeps the text queued and returns when there is none, `message-dispatch.service.ts:231-241`)

`resetTabToFresh` sets `queuedContent: null` and `claudeSessionId: null` (`tab-manager.service.ts:1404,1414-1415`), then emits `reset` (`:1435-1439`). Two cases follow:

- **The command waits behind queued text.** The reset discards that text, so no flush can ever deliver it. The command would stay pending; this is the review's finding.
- **The chain: held `/clear`, then held `/session-handoff`.**
  1. The text in front is flushed, and `/clear` becomes the queued message.
  2. The next turn end flushes `/clear` through `chat:continue`.
  3. The backend calls `interruptSession`, awaits the `CHAT_COMPLETE` (`command: 'clear'`) broadcast, and only then returns (`chat-slash-command-router.service.ts:92-105`).
  4. The webview therefore runs `resetTabToFresh` (`chat-message-handler.service.ts:387-397`) before the flush's reply triggers `releaseHeldCommand`.
  5. Before this fix, the release then queued `/session-handoff` on a fresh tab with no session. Nothing would flush it: there is no session and no turn end. If the user later sent a message, the handoff would run against a new conversation they never asked to hand off.

  The chain's flush is therefore never guaranteed, so it settles as dropped.

**Rule:** every `ClosedTabEvent` kind drops the tab's held commands (`close`, `forceClose`, `reset`), and so does a workspace removal. If the flush's reply arrives later, `releaseHeldCommand` finds no held entry and does nothing.

## Changes

`libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`
- **:11-19** Imports `effect` and `untracked`.
- **:90-108** The constructor:
  - The `onTabClosed` listener now drops on every kind (`:99-101`). It is still released through `DestroyRef`.
  - A new root `effect` on `tabManager.removedWorkspace$()` calls `dropHeldCommandsOfRemovedTabs` inside `untracked` (`:104-107`). The effect is destroyed with the root injector.
- **:110-116** New `dropHeldCommandsOfRemovedTabs()`. It drops held commands for every tab that `findTabByIdAcrossWorkspaces` no longer resolves.
- The `dropHeldCommands` doc comment now lists reset and workspace removal.

## Tests

`libs/frontend/chat/src/lib/services/session-budget-actions.queue.spec.ts` runs the real banner, dispatch and conversation services:
- The fake gains `removedWorkspace$` and a `resetTab()` helper that mirrors `resetTabToFresh` plus its `reset` event.
- New tests:
  - **:337** `settles the wrap-up as not sent when its workspace is removed`. `sendWrapUp()` resolves, `wrapUpSent()` is false, the "not sent" notice is shown, and nothing is flushed.
  - **:353** `settles the wrap-up as not sent when /clear discards the queue it waits behind`.
  - **:367** `a wrap-up held behind a queued /clear settles as not sent when the clear runs`. This is the chain test. The flush of `/clear` performs the reset before it replies, the same order as the backend. The test checks that the wrap-up settles as not sent, the queue is empty, and only `['Please check tests', '/clear']` was flushed.
- The close/forceClose test now uses the shared helpers.

`libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts`:
- The fake gains `removedWorkspace$` (typed with the exported `WorkspaceRemovalEvent`) and `findTabByIdAcrossWorkspaces`.
- **:575** `settles a held command as dropped on a reset, which discards the queue`. It replaces the old "keeps the held command on a reset" test, which asserted the pending state.
- **:589** `keeps the held command when another tab closes`. A `close` or `reset` of another tab leaves it pending.
- **:599** `settles a held command as dropped when its workspace is removed`. A removal that still resolves the tab is a no-op; a removal of the tab drops the command.

## Verification

```
npx jest -c libs/frontend/chat/jest.config.ts \
  libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts \
  libs/frontend/chat/src/lib/services/session-budget-actions.queue.spec.ts \
  --coverage=false --maxWorkers=2 2>&1 | tail -30
Test Suites: 2 passed, 2 total
Tests:       35 passed, 35 total
```

There were 30 tests before this round. The new total is 35: 3 added in the queue spec, plus a net 2 in the conversation spec (1 replaced by 3). Chat-state is unchanged, so I ran no chat-state spec.

`ptah_get_diagnostics` reports no errors in `conversation.service.ts` or the queue spec. In `conversation.service.spec.ts` it reports only errors that were there before: `makeTab({ id: 'tab-1' })` branded `TabId`/`SessionId` (TS2322) and `visibleTabIds` missing from the fake's declared type (`:115`). The new lines add no errors. I ran no nx typecheck, lint or build.

## Residual (not changed)

The chain is dropped correctly only because the reset arrives before the `/clear` flush's reply. The backend guarantees that order by awaiting the broadcast before it returns (`chat-slash-command-router.service.ts:95-105`). If a transport ever delivered the reply first, `releaseHeldCommand` would settle the wrap-up `true` and the reset would then clear it from the queue. The wrap-up would be reported as sent but never sent. It would still settle, so the pending-promise bug cannot return.
