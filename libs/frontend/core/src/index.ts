// Main entry point for core library
export * from './lib/services';

// Export LogLevel enum for external configuration
export { LogLevel, type LoggingConfig } from './lib/services/logging.service';

// Export stub types for message transformer (Phase 0 migration)
// TODO (Phase 4): Migrate components to StrictChatMessage and remove stubs
export type {
  ClaudeContent,
  ProcessedClaudeMessage,
  ExtractedFileInfo,
  ToolUsageSummary,
  ContentProcessingResult,
} from './lib/types/message-transformer.types';

// Export AgentTreeNode from ChatService
export type { AgentTreeNode } from './lib/services/chat.service';

// Export utility functions and type guards (stub implementations)
// TODO (Phase 4): Migrate components to direct StrictChatMessage usage
export {
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  isThinkingContent,
  extractFilePathsFromText,
  detectFileType,
} from './lib/types/message-transformer.types';
