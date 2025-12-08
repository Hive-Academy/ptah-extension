// Chat-specific services
export {
  FilePickerService,
  type ChatFile,
  type FileSuggestion,
} from './file-picker.service';

// ChatStore - Signal-based reactive store (TASK_2025_023)
export { ChatStore } from './chat.store';

// ExecutionTreeBuilder - Immutable tree construction (TASK_2025_023 Phase 2)
export {
  ExecutionTreeBuilder,
  type AgentSpawnInfo,
} from './tree-builder.service';

// SessionReplayService - Session reconstruction from JSONL (TASK_2025_023 Phase 3)
export { SessionReplayService } from './session-replay.service';

// SessionManager - Session lifecycle and node map management (TASK_2025_023 Phase 4)
export { SessionManager } from './session-manager.service';

// Chat types - Shared interfaces for ChatStore refactoring
export type {
  NodeMaps,
  SessionStatus,
  SessionState,
  SessionLoadResult,
  AgentSessionData,
  ClassifiedAgentMessages,
  ProcessedChunkType,
  ProcessedChunk,
} from './chat.types';

// ConfirmationDialogService - Custom confirmation dialog for VS Code webview
export {
  ConfirmationDialogService,
  type ConfirmationDialogOptions,
} from './confirmation-dialog.service';

// PendingSessionManagerService - Pending session resolution management (TASK_2025_054 Batch 1)
export { PendingSessionManagerService } from './pending-session-manager.service';

// MessageSenderService - Centralized message sending mediator (TASK_2025_054 Batch 3)
export { MessageSenderService } from './message-sender.service';
