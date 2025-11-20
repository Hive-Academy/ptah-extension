// Main entry point for core library
export * from './lib/services';

// Export LogLevel enum for external configuration
export { LogLevel, type LoggingConfig } from './lib/services/logging.service';

// Export types and type guards from ClaudeMessageTransformerService
export type {
  ClaudeContent,
  ProcessedClaudeMessage,
  ExtractedFileInfo,
  ToolUsageSummary,
  ContentProcessingResult,
  ClaudeStreamData,
  ClaudeCliStreamMessage,
} from './lib/services/claude-message-transformer.service';

// Export AgentTreeNode from ChatService
export type { AgentTreeNode } from './lib/services/chat.service';

// Export utility functions and type guards
export {
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  isThinkingContent,
  extractFilePathsFromText,
  detectFileType,
} from './lib/services/claude-message-transformer.service';

// Event subscription helpers (leverages MESSAGE_REGISTRY)
export * from './lib/utils/event-subscription-helpers';
