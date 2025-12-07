/**
 * ChatStore Child Services
 *
 * Extracted services following Facade pattern.
 * ChatStore delegates to these services for specialized responsibilities.
 *
 * Architecture:
 * - StreamingHandlerService: JSONL streaming and execution tree building
 * - CompletionHandlerService: Chat completion handling and auto-send
 * - SessionLoaderService: Session loading, pagination, switching, ID resolution
 * - ConversationService: New/continue conversation, message sending, abort
 * - PermissionHandlerService: Permission request management and correlation
 */

export { StreamingHandlerService } from './streaming-handler.service';
export { CompletionHandlerService } from './completion-handler.service';
export { SessionLoaderService } from './session-loader.service';
export { ConversationService } from './conversation.service';
export { PermissionHandlerService } from './permission-handler.service';
