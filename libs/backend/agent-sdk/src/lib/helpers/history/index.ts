/**
 * History Module - Session History Processing Services
 *
 * This module provides services for reading and processing session history
 * from Claude JSONL files. The services are extracted from SessionHistoryReaderService
 * for better maintainability and single responsibility.
 *
 * Services:
 * - HistoryEventFactory: Creates FlatStreamEventUnion events
 * - JsonlReaderService: JSONL file I/O operations
 * - AgentCorrelationService: Agent-to-task correlation
 * - SessionReplayService: Event replay orchestration
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
export { JsonlReaderService } from './jsonl-reader.service';
export { AgentCorrelationService } from './agent-correlation.service';
export { SessionReplayService } from './session-replay.service';
