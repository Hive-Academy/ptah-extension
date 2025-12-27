// Chat-specific services
export {
  FilePickerService,
  type ChatFile,
  type FileSuggestion,
} from './file-picker.service';

// ChatStore - Signal-based reactive store (TASK_2025_023)
export { ChatStore } from './chat.store';

// ExecutionTreeBuilderService - Builds ExecutionNode tree from flat streaming events
// TASK_2025_090: Removed dead tree-builder.service.ts (ExecutionTreeBuilder was unused)
export { ExecutionTreeBuilderService } from './execution-tree-builder.service';

// SessionManager - Session lifecycle and node map management (TASK_2025_023 Phase 4)
export { SessionManager } from './session-manager.service';

// Chat types - Shared interfaces for ChatStore refactoring
export type {
  NodeMaps,
  SessionStatus,
  SessionState,
  SessionLoadResult,
} from './chat.types';

// ConfirmationDialogService - Custom confirmation dialog for VS Code webview
export {
  ConfirmationDialogService,
  type ConfirmationDialogOptions,
} from './confirmation-dialog.service';

// MessageSenderService - Centralized message sending mediator (TASK_2025_054 Batch 3)
export { MessageSenderService } from './message-sender.service';

// MessageValidationService - Centralized message validation (TASK_2025_054 Batch 5)
export {
  MessageValidationService,
  type ValidationResult,
} from './message-validation.service';
