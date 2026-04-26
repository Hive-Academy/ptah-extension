/**
 * @ptah-extension/chat-streaming — Streaming write-path bundle.
 *
 * TASK_2026_105 Wave G2 Phase 3: Extracted from `@ptah-extension/chat` to
 * isolate the SDK-event ingestion + execution-tree-builder + permission/agent
 * monitoring stack from chat UI features. This bundle owns:
 *   - Streaming event ingest, deduplication, and batched UI updates
 *   - Message finalization (turn → ExecutionChatMessage)
 *   - Permission/AskUserQuestion request lifecycle
 *   - Session-scoped node maps (SessionManager)
 *   - ExecutionTreeBuilderService orchestrator (binds the pure builders from
 *     `@ptah-extension/chat-execution-tree` and owns the memo cache)
 *   - BackgroundAgentStore + AgentMonitorStore signal stores
 *
 * Boundary: tagged `scope:webview` + `type:feature`. Outbound deps are
 * `@ptah-extension/shared`, `@ptah-extension/chat-types`,
 * `@ptah-extension/chat-state` (data-access), `@ptah-extension/core` (core),
 * and `@ptah-extension/chat-execution-tree` (feature). NO imports from
 * `@ptah-extension/chat` — the chat lib depends on this one, never the
 * reverse.
 *
 * The `BackgroundAgentLookup` structural port from chat-execution-tree
 * matches the BackgroundAgentStore shape, keeping the runtime graph
 * one-directional.
 */

// ============================================================================
// SERVICES — Streaming write path
// ============================================================================
export { StreamingHandlerService } from './lib/streaming-handler.service';
export { MessageFinalizationService } from './lib/message-finalization.service';
export { EventDeduplicationService } from './lib/event-deduplication.service';
export { BatchedUpdateService } from './lib/batched-update.service';
export { PermissionHandlerService } from './lib/permission-handler.service';

// ============================================================================
// SERVICES — Session + execution tree
// ============================================================================
export {
  SessionManager,
  type SessionState,
} from './lib/session-manager.service';
export { ExecutionTreeBuilderService } from './lib/execution-tree-builder.service';

// ============================================================================
// STORES — Agent monitoring
// ============================================================================
export {
  BackgroundAgentStore,
  type BackgroundAgentEntry,
} from './lib/background-agent.store';
export {
  AgentMonitorStore,
  type MonitoredAgent,
} from './lib/agent-monitor.store';
