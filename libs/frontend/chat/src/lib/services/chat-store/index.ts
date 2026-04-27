/**
 * ChatStore Child Services
 *
 * Extracted services following Facade pattern.
 * ChatStore delegates to these services for specialized responsibilities.
 *
 * Architecture:
 * - StreamingHandlerService: Execution tree building
 * - CompletionHandlerService: Chat completion handling and auto-send
 * - SessionLoaderService: Session loading, pagination, switching, ID resolution
 * - ConversationService: New/continue conversation, message sending, abort
 * - PermissionHandlerService: Permission request management and correlation
 *
 * Wave C7g (TASK_2025_291) additions:
 * - CompactionLifecycleService: SDK session-compaction state machine
 * - MessageDispatchService: Send/queue routing + slash-command guard
 * - SessionStatsAggregatorService: SESSION_STATS aggregation + auto-send re-steering
 * - ChatLifecycleService: Bootstrap, license fetch, agent-summary routing,
 *   session-ID resolution, chat-error handling
 */

// TASK_2026_105 Wave G2 Phase 3: StreamingHandlerService + PermissionHandlerService
// moved to @ptah-extension/chat-streaming. Re-exported here for backwards
// compatibility — new code should import directly from '@ptah-extension/chat-streaming'.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export { StreamingHandlerService } from '@ptah-extension/chat-streaming';
export { CompletionHandlerService } from './completion-handler.service';
export { SessionLoaderService } from './session-loader.service';
export { ConversationService } from './conversation.service';
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export { PermissionHandlerService } from '@ptah-extension/chat-streaming';
// NEW (Wave C7g)
export { CompactionLifecycleService } from './compaction-lifecycle.service';
export { MessageDispatchService } from './message-dispatch.service';
export { SessionStatsAggregatorService } from './session-stats-aggregator.service';
export { ChatLifecycleService } from './chat-lifecycle.service';
