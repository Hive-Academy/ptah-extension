# Batch 8r-1 report

## Files changed

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-stream.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-lifecycle.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\streaming\chat-stream-broadcaster.service.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\streaming\chat-stream-broadcaster.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-event-callbacks.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-event-callbacks.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\native-session-controls.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\native-session-controls.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8r-1-report.md

## G2

- `codex-chat-adapter.ts:252-279,545-564` validates the optional initial/follow-up client message ID, keeps it out of the native turn input, and routes rejected follow-up options through logged `failure()`.
- `codex-chat-turn-stream.ts:217-228,280-323` emits one user `message_start` with the ID after native admission and consumes it in terminal `turn_state` on completion, interruption, and failure.

## G3

- `codex-chat-events.ts:48,342` publishes one failure notification; the callback wait was removed for failed turns in Revise 1 below.
- `codex-chat-turn-stream.ts:267-339` emits a failed terminal even before receipt or before any content, prevents a failed/interrupted `message_complete` from triggering a successful `chat:complete`, publishes one failure notification, and closes the dead native session. Stop after retirement has no active session to interrupt.
- `codex-chat-event-callbacks.ts:164-174` publishes the Claude-shaped `SESSION_TURN_FAILED` notification for a native turn failure with the real session ID and workspace path.
- `chat-stream-broadcaster.service.ts:345-351` preserves an already failed turn state when the marked stream error reaches its catch, while the existing reported-error guard suppresses a second `CHAT_ERROR`.

## G6

- `codex-chat-adapter.ts:712-732` maps a closed native context to an unavailable permission error; Revise 1 below replaces the original message-text check with a typed state check.
- `native-session-controls.ts:189-201` maps only that typed unavailable permission error to the no-live-session result, persists the level for the next open, and propagates genuine errors.

## Specs added or updated

- `codex-chat-adapter.spec.ts:230-280,637-648`: failed/interrupted turn handling, follow-up ID echo/consumption and native-input exclusion, invalid/unsupported option logging, typed unavailable versus real permission failure.
- `codex-chat-turn-lifecycle.spec.ts:242-265,386-428,470-582`: first-turn ID retirement; interrupted/failed terminal state; process death before and after receipt with zero content, one error callback, native cleanup, and harmless Stop.
- `codex-chat-event-callbacks.spec.ts:259-270`: one Claude turn-failed publication.
- `chat-stream-broadcaster.service.spec.ts:1054-1077`: failed-state preservation without a duplicate `chat:error`; existing reported-error spec remains.
- `native-session-controls.spec.ts:149-166`: stale-context save-only result and persisted permission, with a genuine failure still surfaced.

## Decisions

- Kept all UI and Claude behavior unchanged. Used the existing Claude turn-failed notification route and turn-state registry; Revise 1 adds the transcript notice that the bound tab needs.
- The first-message ID is handled when the start config provides it. The current `chat-session.service.ts` start caller does not pass a client message ID; that file belongs to another lane and was read only.
- `rg` was blocked by access denied; PowerShell read-only search was the fallback. Ptah skill discovery found no matching local skill to load.
- Removed a pre-existing UTF-8 BOM from the changed broadcaster source as required.

## Not done

- No tests, typecheck, lint, build, verification, or diagnostics were run, per the task's first rules. Runtime behavior is not claimed as verified.
- A failure before a native session is opened cannot carry a real session ID; this change covers failures once a Codex session has been opened, including start-turn rejection before receipt.

## Revise 1

### Defect 1: bound-tab transcript error

- Claude reference: `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:136-149,353-362` emits root assistant `message_start` and `text_delta` for assistant text; `libs/backend/agent-sdk/src/lib/message-transform/result-message.transformer.ts:12-36` emits the terminal `turn_state` after message chunks. `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:139-145` finalizes on failed state, and `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:175-191,230-307` keeps a renderable root message. `libs/backend/agent-sdk/src/lib/helpers/stop-failure-hook-handler.ts:75-99` records failure and emits a notification; that notification itself does not create bound-tab transcript text.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:57-85,310-312,352-354` emits exactly one root assistant start and fixed safe text delta before a failed `turn_state`, including zero-content pre-receipt failure. Interrupted turns emit no notice. The failed turn still throws with `webviewReported`, suppressing a second `CHAT_ERROR`; no failed `message_complete` is emitted.
- Gateway reference: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:897-912,613-625` collects every `text_delta` as reply text and sends one generic reply when the stream throws. `codex-chat-adapter.ts:377` records the gateway consumer and `codex-chat-turn-stream.ts:63` omits the notice for that consumer, leaving one failure reply.
- Specs: `codex-chat-turn-lifecycle.spec.ts:243-271,397-435,520-654` checks one notice before failed state for normal and zero-content failures, no notice on interrupt, and no gateway text delta; `codex-chat-adapter.spec.ts:234-257` checks the changed failed-turn event order.

### Defect 2: typed closed context

- `libs/backend/codex-runtime/src/lib/codex-context-state-error.ts:1-7` adds `CodexContextStateError` with distinct `closed` and `opening` states. `codex-context.ts:466` throws it from `assertOpen` while retaining the existing message for other callers; `libs/backend/codex-runtime/src/index.ts:53` exports the type.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:728-730` maps only the typed `closed` state to unavailable permission. Opening, unrelated errors, and a plain error with the former message take the normal failure path. The existing `native-session-controls.ts:189-201` saves the level only for unavailable permission.
- Specs: `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:557-581` covers the typed closed error and state distinction; `codex-chat-adapter.spec.ts:638-654` covers closed, opening, same-message plain error, and genuine failure.

### Defect 3: callback-independent failure settlement

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:55-68` stops waiting for a pending error-presentation callback once failure is known, while attaching a rejection handler to the detached promise. `codex-chat-turn-stream.ts:365-379` starts pre-receipt error publication without awaiting it, logs publication rejection as a real `Error`, and proceeds to close and throw. The failed `turn_state` is yielded before retirement.
- Spec: `codex-chat-turn-lifecycle.spec.ts:609-633` uses a never-settling callback for failures before and after receipt and checks failed state, throw, context close, and session-map retirement without a real timer.

### Defect 4: reported lint issues

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:575-579` replaces the zero-content, throwing `async function*` with an `AsyncIterable` whose `next()` rejects. This preserves the before-text process-death case and removes the reported `require-yield` error without adding a content event or a suppression.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:364-379` removes the unused `errorPresented = true` in the catch path. The flag is still set by the projection callback at `:165-167`, which is the only write needed to suppress duplicate host publication.
- No lines were added to `codex-chat-adapter.ts` in this additional-defects pass; its reported max-lines warning remains. The Revise 1 additions to that file were already present before this pass.

### Defect 5: seven reported agent-sdk spec failures

- **Failed and interrupted count cases — spec was stale.** `codex-chat-adapter.spec.ts:234-257` now checks the safe notice only for failure, consumes the expected terminal `turn_state`, then expects the stream rejection and verifies no completed-turn count. The production order is intentional: transcript text precedes the terminal state, which precedes generator rejection.
- **Missing terminal case — old spec was stale.** `codex-chat-adapter.spec.ts:727-758` asserts the native text, one fixed failure notice, failed terminal state, context and scope cleanup, dead session, and harmless Stop. The current `codex-chat-turn-stream.ts:347-380` retires a stream that ends without a terminal; keeping that session would contradict G3.
- **Start-turn rejection case — old spec was stale.** `codex-chat-adapter.spec.ts:1149-1179` consumes the fixed notice and failed state before asserting the logged, wrapped rejection; it then checks close, dead session, unavailable retry, and harmless Stop. This follows G3's zero-event start-failure settlement rather than retrying a failed native context.
- **First-turn completed, interrupted, and failed cases — pre-revise spec order was stale.** `codex-chat-turn-lifecycle.spec.ts:241-271` now checks the single user echo and consumed ID on the terminal state for all three outcomes, one notice only for failure, and the matching stream rejection or clean completion. The Revise 1 stream changes at `codex-chat-turn-stream.ts:250-260,310-345,348-384` supply that order. No assertion was weakened to ignore an unexpected event.

### Files changed in Revise 1

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-stream.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-lifecycle.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-context-state-error.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-context.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\index.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8r-1-report.md

### Decisions

- The transcript notice uses the Claude assistant-text stream shape and a fixed sentence without native stderr, paths, or secrets. It has no `message_complete`, because failed turns settle through `turn_state` and stream rejection.
- Failure presentation is best effort and cannot keep a dead native session alive. No timeout or real timer was added. The gateway reply is produced by its existing stream-error handler.
- No frontend, Claude, MCP, or other batches' files were edited.

### Not done

- Tests, typecheck, lint, build, verification, and diagnostics were not run, as instructed. Source inspection and spec additions do not establish runtime or compile success.
- The seven failures and lint findings came from the coordinator's pre-revise run; this revised state has not been rerun in this lane.
- Matching engineering skill discovery was unavailable in this lane; `rg` was access denied, so PowerShell read-only searches were used.
