# Test Report — TASK_2026_655 R-F4

## Scope

- User request: In Electron single chat, restore an in-flight message after switching away from its workspace and back, including subsequent live deltas and streaming status.
- Source: `implementation-plan.md:785-799` defines R-F4; `:190-193` adds the A-2 subagent anchor; `:1041` requires streaming status while the backend is generating.
- File: `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-loader.resync-live-seed.spec.ts`
- Review finding covered: `code-logic-review-F3.md:139-140` calls out the missing seedless status-probe assertion. The status variant calls the real reconciler against a mocked `session:status` reply.

## Cases

1. **`R-F4 restores the seeded start and hidden text before a fenced live delta`**: begins with a streaming tab and message `S`; holds `chat:resume`; resyncs with `turn_state(generating, rev 11)`, `message_start(S)`, and `hidden`; delivers `text_delta(S, live)` through the real fence during the held RPC; replies with a different UUID-keyed history message. Asserts the seeded start in `eventsByMessage`, `hiddenlive` in `textAccumulators`, the history message in `messages`, status `streaming`, and revision 11. Also asserts no fallback status probe.
2. **`R-F4 status variant probes a missing seed turn state and restores streaming`**: resyncs with a seed that has no turn state; the real `SessionLivenessReconcilerService` receives `session:status` reporting `generating` at revision 12. Asserts the probe call, tab status `streaming`, and applied revision.
3. **`A-2 nests a seeded subagent anchor under the Task tool in replayed history`**: history contains an assistant message with a Task `tool_start`; the post-finalization seed contains an `agent_start` and assistant `message_start` whose `parentToolUseId` points to that Task. Asserts that the anchor reached the streaming bucket and that the historical Task node contains the seeded subagent text.

## Dependencies

- Real: `SessionLoaderService`, `SessionHistoryReplayer`, `StreamingHandlerService`, `TabManagerService`, `TurnStateApplier`, `SessionLivenessReconcilerService`, `HistoryMessageBuilder`, `ExecutionTreeBuilderService`, and their state/accumulation collaborators.
- Mocked RPC: `ClaudeRpcService.call` controls `session:load`, held `chat:resume`, and the `session:status` probe.
- Host/UI boundaries: a `VSCodeService` configuration stub with `isElectron: true`, a `StreamViewportController.requestStreamResync` stub, and the same confirmation/model-refresh test providers used by nearby loader tests.

## Decisions

- The spec enters through `SessionLoaderService.switchSession` with the `liveSeed` callback shape passed by `ChatMessageHandlerService.handleStreamSnapshot` at `chat-message-handler.service.ts:544-555`. Constructing the full message handler would pull in routing and host message services outside the loader/replayer regression seam.
- The viewport controller is stubbed because its constructor declares viewports through `SurfaceRouterService`; that host declaration is outside R-F4. Confirmation and model refresh are UI boundaries required by the real tab manager. The tab, replay, streaming, tree, turn-state, and status-probe logic remain real.
- The subagent assertion targets the historical Task node itself. Finding only an unattached seeded event would not establish the A-2 nesting requirement.

## Execution

- Jest/Nx: **not run**, per the task's explicit instruction that another lane is running chat checks and the orchestrator will run this spec.
- Scoped TypeScript diagnostics: no diagnostics were reported for the new spec; the final check reported 257 sibling-file errors outside this file (the count changed from 255 during concurrent edits). Diagnostics are static checks, not passing test evidence.
- Tests added: 3. Passed/failed/skipped counts: unknown until the orchestrator runs them.

## Suspected defects

- **A-2 nesting may fail**: `MessageFinalizationService.finalizeSessionHistory` calls `TabManagerService.applyFinalizedHistory` (`message-finalization.service.ts:281-303`), which stores the Task tree in `messages` and sets `streamingState: null` (`tab-manager.service.ts:2005-2015`). The replayer applies the seed only after finalization (`session-history-replayer.service.ts:326-328,665-696`). The seeded child therefore enters a new streaming state, while the Task tool remains in the immutable historical message tree. The code examined shows no merge across that boundary. The A-2 case should expose this if run; no runtime failure is claimed yet.
- No other R-F4 defect is claimed without execution. The orchestrator should run the new spec to establish the actual result.
