# Attention context label revision 1

## Defect 1 — workspace identity

- `chat-attention-source.service.ts:119-125,163`: an unmatched request now keeps `workspacePath: ''` and `workspaceName: 'Unknown workspace'`. A found tab uses its owning partition path. Only a found tab with `workspacePath: null` uses the active path or renderer startup root for the **display label**.
- `chat-attention-host-message-handler.service.ts:178-180,202`: a projection whose target does not resolve to a local workspace keeps `Unknown workspace`; it does not inherit the active workspace label. Its opaque routing identity remains unchanged.
- Specs: `chat-attention-source.service.spec.ts:132` and `chat-attention-host-message-handler.service.spec.ts:70` assert the unknown label for an unmatched request and remote projection.

## Defect 2 — lookup and Electron path

- `tab-workspace-partition.service.ts:108,169-174`: `_activeWorkspacePath` starts null; `initialize()` sets only the panel ID. `tab-manager.service.ts:743-745` calls `initialize()` and loads tab state without switching a workspace. The first path assignment is `tab-workspace-partition.service.ts:207`, reached through `TabManagerService.switchWorkspace()` at `tab-manager.service.ts:847-848`.
- On Electron, `electron-layout.service.ts:137,730-764` starts asynchronous restoration; `:780-822` waits for `workspace:getInfo`, then `workspace:switch`, before `coordinateWorkspaceSwitch()` calls the coordinator at `:529-535`; `workspace-coordinator.service.ts:178` eventually switches the tab manager. This proves a startup interval when loaded tabs can exist while the partition path is null. It does **not** prove that the reported notifications arrived in that interval. Another possible cause of the reported unknown label is an owner lookup miss. Removing the active folder can also clear the path (`tab-workspace-partition.service.ts:475-477`).
- `tab-workspace-partition.service.ts:253-295` now searches supplied active tabs by session ID even when the active path is null. It returns the found tab with `workspacePath: null`, matching the by-ID lookup at `:321-340`. It does not add null paths to the reverse index. `tab-workspace-partition.service.spec.ts:66` uses the real service to assert both lookups in this state.
- `chat-attention-source.service.spec.ts:44-52` now makes its session lookup mock require a matching tab in the active set when the mocked owner path is null. `:196` covers a lane permission resolved by session ID in that state.

### Session lookup callers checked

`TabManagerService` (`findTabBySessionIdAcrossWorkspaces` facade and `findTabBySessionId`) passes the live tab signal. Other callers inspected: ChatAttentionSource, ChatAttentionHostMessageHandler, NotificationFocusCoordinator, ChatMessageHandler, TurnEndHandler, SessionAgentRoster, ChatAgentFeedbackSender, AgentMonitorPanel, SendToMessaging, CompactSessionCard, TurnStateApplier, StreamingHandler, OrchestraCanvas, HarnessBuilderFocusRouter, and SetupWizardFocusRouter. They read the found tab, normalize a null path to undefined, or explicitly require a non-null workspace path. The session lookup's new null-path result is therefore consistent with its existing by-ID sibling. The notification focus case is handled separately below.

## Defect 3 — Open routing

- `chat-attention-source.service.ts:122-125` keeps the actual unpartitioned routing path as `''` while using the fallback only for `workspaceName`. `notification-focus-coordinator.service.ts:39-55` matches a null owner path to that empty path, leaves the active tab set in place, and sends the found tab ID through `AppStateManager.requestCanvasTab`. This bridge targets the canvas's implicit partition; the normal canvas focus request compares paths literally. `notification-focus-coordinator.service.spec.ts:76` asserts the tab ID is passed and no workspace switch happens, including a tab with no session ID.

## Defect 4 — context filtering

- `chat-attention-source.service.ts:138-149` and `chat-attention-host-message-handler.service.ts:187-189` reject drive, UNC, and absolute multisegment path shapes plus `sk-` keys and long hex/base64-like runs. Ordinary slashes and words such as “token” remain visible. The source and host specs include both accepted and rejected titles. The existing format is `Provider · Session title · Tool: Name` for permissions and `Provider · Session title · Question text` for questions, omitting absent parts; question text is collapsed and limited to 80 characters with an ellipsis. Context remains deterministic and rendered as text.

## Defect 5 — late renderer root

- `chat-attention-source.service.ts:51` reads `VSCodeService.config()` in the tracked effect, so a later workspace root update reconciles the label. `chat-attention-source.service.spec.ts:163` checks the later upsert and no extra upsert on an unchanged tick.

## Spec files changed

- `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-attention-source.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts`
- `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.spec.ts`

## Decisions

- The workspace basename is a presentation label. It must not replace the routing identity when a tab is unpartitioned.
- An unmatched or remote request displays `Unknown workspace` even when a local workspace is active.
- No Nx, Jest, TypeScript, lint, or build command was run in this round because another session holds the check slot. The orchestrator must run scoped checks.

## Not done

- I could not prove the exact timing or owner state of the original Electron report from source code alone. The code establishes the startup null-path window and tests the resulting lookup state.
