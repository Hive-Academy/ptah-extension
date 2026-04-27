/**
 * @ptah-extension/chat-execution-tree — Pure execution-tree builder helpers.
 *
 * TASK_2026_105 Wave G1: Extracted from `@ptah-extension/chat` so downstream
 * consumers (canvas, agent-monitor, future analytics surfaces) can build
 * ExecutionNode trees from flat streaming events without pulling the full
 * chat feature library.
 *
 * Boundary: tagged `scope:webview` + `type:feature`. The orchestrating
 * `ExecutionTreeBuilderService` and `BackgroundAgentStore` intentionally
 * stay in `@ptah-extension/chat` for now — they bundle together in the
 * G2.3 chat-streaming wave. The `BuilderDeps.backgroundAgentStore` field
 * is typed via an `import type` from `@ptah-extension/chat` so this lib
 * stays runtime-acyclic with chat.
 */

// ============================================================================
// SERVICES
// ============================================================================
export { AgentStatsService } from './lib/agent-stats.service';

// ============================================================================
// CONSTANTS
// ============================================================================
export { MAX_DEPTH } from './lib/execution-tree.constants';

// ============================================================================
// PURE BUILDER FUNCTIONS
// ============================================================================
export {
  buildAgentNode,
  buildInterleavedChildren,
} from './lib/builders/agent-node.fn';
export {
  buildMessageNode,
  findMessageStartEvent,
} from './lib/builders/message-node.fn';
export {
  buildToolNode,
  buildToolChildren,
  collectTools,
} from './lib/builders/tool-node.fn';

// ============================================================================
// TYPES
// ============================================================================
export type {
  BuilderDeps,
  BackgroundAgentLookup,
} from './lib/builders/builder-deps';
