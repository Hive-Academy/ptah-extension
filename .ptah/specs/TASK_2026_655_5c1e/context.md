# TASK_2026_655 — main-agent stream chunks stop rendering after a workspace switch

## User report

Single chat layout (`layoutMode === 'single'`), Electron app. The main agent streams in
workspace A. The user switches to workspace B, then back to A. After that, streamed chunks
for the in-flight turn do not render in A. Status, turn-state and agent-monitor (CLI lane)
updates still render.

## Status of earlier work

- Lane 1 (codex) changed `BatchedUpdateService.canFlush`. Review (opencode) approved it, but it
  does NOT apply to this case: in single layout `visibleTabIds` is empty, so the old predicate
  already flushed the active tab. The change was REVERTED by user decision. `diagnosis.md` and
  `code-logic-review.md` describe that discarded change; do not rebuild it.

## Leading hypothesis (from code reading; not proven at runtime)

1. Backend `ChatStreamDeliveryCoordinator`
   (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts`)
   keeps a hidden tab's events in a capped tail: 256 events / 512 KiB (`:23-24`). On overflow
   `retain` (`:203-218`) DISCARDS the whole tail and sets `resyncRequired`.
2. On the switch back, `StreamViewportController`
   (`libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts`) declares the new
   viewport; `updateViewport` → `reveal` (`:220-248`) sends `CHAT_STREAM_SNAPSHOT` with
   `resyncRequired: true`.
3. `ChatMessageHandlerService.handleStreamSnapshot`
   (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:530-543`) calls
   `ChatStore.resyncStream` (`chat.store.ts:228-236`) → `SessionLoaderService.switchSession(...,
   { targetTabId, reason: 'resync' })` (`chat-store/session-loader.service.ts:759-984`).
4. That path calls `applyResumingSession` (`session-loader.service.ts:837-844`;
   `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2533-2561`): `messages: []`, empty
   `streamingState`, `status: 'resuming'`, then replays `chat:resume` history through
   `SessionHistoryReplayerService` with a live-event fence (`historyReplayer.claim/release`,
   `deferLiveEvent`).
5. The in-flight assistant message is (probably) not complete in the `chat:resume` transcript,
   so its `message_start` is lost. Later live deltas land in an `eventsByMessage` bucket with no
   `message_start`. `findMessageStartEvent`
   (`libs/frontend/chat-execution-tree/src/lib/builders/message-node.fn.ts:59-77`) is what
   decides root rendering, so those deltas never render.

Open questions to settle with evidence:
- Q1: What does backend `chat:resume` return for a session whose turn is still running (Electron,
  `ptahUiFence: true`)? Does it include the partial in-flight message (its `message_start` and
  deltas so far)? Find the backend handler and trace it.
- Q2: After the fence is released, what happens to the deferred live events and to the tab
  status (`resuming` → ?). Does anything re-mark the tab streaming?
- Q3: Confirm that a bucket with deltas but no `message_start` produces no rendered node.
- Q4: Is there any OTHER path in this sequence that drops chunks (e.g. `lastTurnStateRevision`
  reset, deduplication cleanup `cleanupSessionDeduplication`, `deferLiveEvent` never releasing)?
