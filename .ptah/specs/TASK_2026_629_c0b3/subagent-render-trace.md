# R9 item 7 — nested sub-agent render: trace and parity list

Read-only trace, 2026-10-13, on HEAD `0c3cf0ac4` (started by the R9 architect before the user stopped it). Input for
the R9 plan. Line numbers are from the worktree.

## Findings that change the plan

1. **`ptah-agent-execution` is dead code.** `AgentExecutionComponent` (`agent-execution.component.ts:54`) is never
   mounted; only the barrel exports it (`libs/frontend/chat/src/lib/components/index.ts:147`). The live inline render
   is `ptah-inline-agent-bubble`.
2. **Sub-agent permission prompts show ONLY inside the nested render.** A nested tool gets
   `getPermissionForTool(toolCallId)` → `[permission]` on `ptah-tool-call-item` (`execution-node.component.ts:313-318`),
   which auto-expands and shows `ptah-permission-request-card` (`tool-call-item.component.ts:105-112,161-166`).
   `PermissionHandlerService.toolIdsInExecutionTree` (`permission-handler.service.ts:227-263`) counts sub-agent tool ids
   as "in the tree", so `unmatchedPermissions` (`:275-301`) excludes them and the fallback `ptah-permission-badge`
   (`chat-view.component.html:165-166`) never shows them. Hiding the nested tools hides these prompts unless the tile or
   the full view surfaces them.
3. **No existing "full sub-agent view" shows live tool calls.** The overlay and the canvas `sub:` lane load a text-only
   transcript once over RPC (`SubagentTranscriptMessage = {role, text, timestamp?}`,
   `shared/.../subagent-registry.types.ts:265-272`). The live data is the frontend `ExecutionNode` subtree. So the
   "no backend work, stays live" full view must render the agent's `ExecutionNode` subtree (`ptah-execution-node`
   recursion), not the transcript viewer.
4. **The `agent` branch is shared.** `ptah-execution-node` is also mounted by `harness-builder-view.component.ts:279`,
   `apps-transcript.component.ts:86`, `analysis-transcript.component.ts:87`, `cli-agent-output.component.ts:105`, and
   `AgentMonitorTreeBuilderService` (`chat/src/lib/services/agent-monitor-tree-builder.service.ts:798`) emits `agent`
   nodes for CLI agent cards. The tile mode must be opt-in (input or token) for the main chat transcript only.
5. **Canvas lane routing is not reachable from the Rail/detail transcript.** `SESSION_CARD_ACTIONS`
   (`session-context.token.ts:62-69`, `openLane(laneKey)`, `openSession()`) is provided by the canvas tile
   (`canvas-tile.component.ts:603-631,653-656`, via `ngComponentOutletInjector` `:425-430`), but NOT by
   `canvas-detail-transcript.component.ts:46-59`, which both the Grid detail panel and the Rail focus area render.
   Add a provider there (routing to `CanvasDetailService.selectLaneFor/open`, `canvas-detail.service.ts:22,42`;
   element provider on `OrchestraCanvasComponent`, `orchestra-canvas.component.ts:76-81`). Outside the canvas nothing
   is provided — a fallback is needed (in-place full view or the overlay).
6. **Backgrounded sub-agents use lane key `bg:`, not `sub:`** (`compact-lane-rows.ts:21-29,71`); the lane view filters
   on it (`canvas-lane-view.component.ts:213-219`), so a stale `sub:` key falls back to the orchestrator lane.

## Inline render today

- Mount: `chat-transcript.component.ts:404-410` (`_treeBuilder.buildTree(state, 'tab-'+tabId())`), `:426-451`;
  `message-bubble.component.html:104-111` renders `ptah-execution-node` with `[getPermissionForTool]`
  (`message-bubble.component.ts:325-328`).
- `ExecutionNodeComponent` (`execution-node.component.ts:133`): inputs `node` (:439), `isStreaming` (:442),
  `isFinalizing` (:451), `getPermissionForTool` (:457-459), `ptahUi` (:470ff); output `permissionResponded` (:465).
  `@case ('agent')` (:336-366) mounts `ptah-inline-agent-bubble` with `#bubbleChildTemplate` recursion (:357-365).
  Agents can also sit under a `sendMessage` card (:285-305) or a tool item body (:312-332,
  `tool-call-item.component.ts:93-117`).
- `InlineAgentBubbleComponent` (`inline-agent-bubble.component.ts:72`): inputs `node` (:648), `getPermissionForTool`
  (:653-655), `nodeTemplate` (:664-666), `isFinalizing` (:674); output `permissionResponded` (:680); injects
  `AgentMonitorStore`, `BackgroundAgentStore`, `ModelStateService`, `SubagentTranscriptViewerService`,
  `ScrollDirtyService` (:617-621); joins the record `subagents().get(node().toolCallId)` (:938-945).

## Data

- `ExecutionNode` (`libs/shared/src/lib/types/execution/node.ts:138-224`): `agentType` :171, `agentDescription` :175,
  `agentModel` :173, `agentId` :183, `status` :144 (`streaming` until the Task tool_result, then `complete`,
  `agent-node.fn.ts:112,119`), `isBackground` :217, `toolCallId` :158 (Task tool_use id), `startTime` :191. `toolCount`
  :203 and `endTime` are never set; count `children` with `type === 'tool'`. Duration/tokens/cost from
  `AgentStatsService.aggregateAgentStats` (`agent-stats.service.ts:59-121`). Last activity only on the record
  (`latestSummary`, `lastToolName`, `lastEventAt`).
- Tree building: `ExecutionTreeBuilderService.buildTree` (`chat-streaming/src/lib/execution-tree-builder.service.ts:279`);
  pure builders in `libs/frontend/chat-execution-tree/src/lib/builders/`; detection `tool-node.fn.ts:51-64`;
  `buildAgentNode` replaces the Task tool node (:92-121, `agent-node.fn.ts:26-131`, id `agent:${toolCallId}`);
  placeholder agent `tryBuildPlaceholderAgent` (:272-406). Rebuilt on every `streamingState` change
  (`chat-transcript._executionTrees`, `StreamPresentationStore.streamingMessages` :249); finalized via
  `MessageFinalizationService` (:139) and `HistoryMessageBuilder` (:151).
- `SubagentRecord` (`agent-monitor.store.ts:531-619`), keyed by `parentToolUseId` = `AgentStartEvent.toolCallId`
  (`onAgentStart` :2008-2044), `subagents` (:758), `getSubagent()` (:761). No start time
  (`compact-lane-rows.ts:82` sets `startedAt: null`).

## Background-agent visual (reuse)

- `BackgroundAgentStripComponent` (`chat-ui/.../background-agent-strip.component.ts:157`) is a list widget; one row is
  :221-400 (status indicator :227-263, focus button :266-295, `⋯` menu :298-…); status line :563-570; formatters
  exported at :96, :109. No kind icon, no tool count. Smart wrapper `BackgroundAgentTrayComponent` (:171; mappers
  `fromSubagent` :246-278, `fromBackground` :294-336), mounted at `chat-view.component.html:60-63`.
- Closest single-row tile: `ptah-compact-session-lanes` row (`compact-session-lanes.component.ts:96-125`, kind icon,
  name, status, elapsed; `CompactLaneRow`, `compact-lane.types.ts:11-21`).
- Neither is a reusable single tile: extract the strip row (e.g. `ptah-background-agent-row`) or build a tile from
  `generateAgentColor`, the formatters and the status icon `@switch`.

## Existing full views

- `SubagentTranscriptViewerComponent` (`chat-ui/.../subagent-transcript-viewer.component.ts:41`): text-only.
- `SubagentTranscriptOverlayComponent` (`subagent-transcript-overlay.component.ts:23`, modal at
  `app-shell.component.html:11`), opened by `SubagentTranscriptViewerService.openFor` (`:63-74`), one RPC load
  (`agent-monitor.store.ts:2502`), manual refresh, no "back".
- `CanvasLaneViewComponent` (`canvas-lane-view.component.ts:31`) `sub:` lane (:122-182): usage summary, permission
  cards filtered by `request.agentToolCallId === sub.parentToolUseId && !request.surfaceMode` (:245-258), Stop, the
  text-only transcript viewer (one-shot RPC :267-300, refresh :303-334). `selectedSubagent` (:205-220) needs
  `rec.parentSessionId === sessionId` (`lane-owner.ts:2-8`), else falls back to the orchestrator lane.

## Specs that assert the inline render

- `inline-agent-bubble.component.spec.ts` (Phase 3 record, `canStop` x3, `canBackground` x4, send-message UI x5,
  `onStopClick` x2, template click wiring, scroll listener).
- `execution-node.ptah-ui.spec.ts` (bubble stub :60-73, :189-191; :327; sendMessage-nested agent).
- `execution-node.send-message.spec.ts` (bubble stub :55-60, :102-103; :116, :132).
- `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts` (`AGENT_CARD = 'ptah-inline-agent-bubble'`
  :58; :184 asserts summary text and "1 tools" / "2 tools") — e2e, do not run; update if the selector changes.
- Data-only, probably unaffected: `chat-transcript.display.spec.ts`, `transcript-agent-facts.spec.ts`,
  `transcript-ptah-ui-host-sources.spec.ts`, `send-message-chip.component.spec.ts`, chat-streaming builder specs.

## Parity list (inline nested view)

| # | Capability | Where |
|---|---|---|
| 1 | Interleaved text timeline (markdown, agent-summary XML) | `execution-node.component.ts:154-259` |
| 2 | Thinking blocks | `:260-262` |
| 3 | Nested tool calls (input, output, diff, error, result) | `tool-call-item.component.ts:84-117` |
| 4 | SDK cards (workflow / task / monitor / sendMessage / scheduleWakeup) | `execution-node.component.ts:264-311` |
| 5 | Nested sub-agents at any depth | `:336-366` |
| 6 | **Permission prompts for sub-agent tools** | `tool-call-item.component.ts:105-112,161-166`; `permission-handler.service.ts:284-300` |
| 7 | Tool errors / results | `ptah-tool-output-display`; `tool-node.fn.ts:224-225` |
| 8 | Agent states (streaming, interrupted, resumed, background) | bubble :86-187, :822-841 |
| 9 | Record status badge + progress line | :194-279 |
| 10 | Stop | :302-318, :1090-1100 |
| 11 | Send to background | :283-299, :1102-1115 |
| 12 | Message (steer) this agent | :342-418, :1068-1088 |
| 13 | RPC command error line | :365-374 |
| 14 | View full transcript (overlay) | :324-335, :1001-1013 |
| 15 | Expand / collapse (agent and per tool item; Escape) | bubble :699; `tool-call-item.component.ts:127,180-200` |
| 16 | Auto-scroll follow + pin | bubble :701-821 |
| 17 | Stats footer (model, tokens, cost, duration) | :505-534 |
| 18 | "N tools" count | `childStats` :864-877 |
| 19 | Copy (tool I/O buttons; message copy walks the whole tree) | `tool-input-display.component.ts:128`, `code-output.component.ts:108,121`, `copy-button.component.ts:91-97` |
| 20 | Streaming / starting / empty placeholders | :467-498 |
| 21 | Finalize-animation suppression | `isFinalizing`; `data-finalizing` :590-598 |

## Uncertainties

- Whether finished history replays move `SubagentRecord.status` past `running` (`onTaskToolResult` :2415) — not
  verified.
- No record / `parentSessionId` mismatch / Workflow agents → a `sub:` lane cannot resolve and falls back to the
  orchestrator lane.
- `CanvasDetailService` unreachable from a tile's ChatView rests on `ngComponentOutletInjector` semantics — not run.
