/**
 * History Module - Session History Processing Services
 *
 * This module provides services for reading and processing session history
 * from Claude JSONL files. The services are extracted from SessionHistoryReaderService
 * for better maintainability and single responsibility.
 *
 * Services:
 * - HistoryEventFactory: Creates FlatStreamEventUnion events
 * - (Batch 2) JsonlReaderService: JSONL file I/O operations
 * - (Batch 3) AgentCorrelationService: Agent-to-task correlation
 * - (Batch 4) SessionReplayService: Event replay orchestration
 *
 * @see TASK_2025_106 - Session History Reader Refactoring
 */

// Types
export type {
  JsonlMessageLine,
  SessionHistoryMessage,
  ContentBlock,
  AgentSessionData,
  ToolResultData,
  AgentDataMapEntry,
  TaskToolUse,
} from './history.types';

// Services
export { HistoryEventFactory } from './history-event-factory';
