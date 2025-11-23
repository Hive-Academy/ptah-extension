// Main entry point for core library
export * from './lib/services';

// Export LogLevel enum for external configuration
export { LogLevel, type LoggingConfig } from './lib/services/logging.service';

// Export types and type guards from ClaudeMessageTransformerService
// DELETED in Phase 0
// export type {
//   ClaudeContent,
//   ProcessedClaudeMessage,
//   ExtractedFileInfo,
//   ToolUsageSummary,
//   ContentProcessingResult,
//   ClaudeStreamData,
//   ClaudeCliStreamMessage,
// } from './lib/services/claude-message-transformer.service';

// Export AgentTreeNode from ChatService
export type { AgentTreeNode } from './lib/services/chat.service';

// Export utility functions and type guards
// DELETED in Phase 0
// export {
//   isTextContent,
//   isToolUseContent,
//   isToolResultContent,
//   isThinkingContent,
//   extractFilePathsFromText,
//   detectFileType,
// } from './lib/services/claude-message-transformer.service';

// Event subscription helpers (leverages MESSAGE_REGISTRY)
// DELETED in Phase 0
// export * from './lib/utils/event-subscription-helpers';
