// Main entry point for core library
export * from './lib/services';

// Export LogLevel enum for external configuration
export { LogLevel, type LoggingConfig } from './lib/services/logging.service';

// Export JSONL streaming types (RPC Phase 3.5)
export type {
  ProcessedClaudeMessage,
  AgentMetadata,
  SessionMetrics,
  JSONLMessage,
  JSONLAssistantMessage,
  JSONLToolMessage,
  JSONLPermissionMessage,
  JSONLStreamEvent,
  JSONLResultMessage,
  JSONLSystemMessage,
} from './lib/services/chat-state.service';

// Export AgentTreeNode from ChatService
export type { AgentTreeNode } from './lib/services/chat.service';
