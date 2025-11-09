// Main entry point for core library
export * from './lib/services';

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

// Export utility functions and type guards
export {
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  extractFilePathsFromText,
  detectFileType,
} from './lib/services/claude-message-transformer.service';

// Export FilePickerService types
export type {
  ChatFile,
  FileSuggestion,
} from './lib/services/file-picker.service';
