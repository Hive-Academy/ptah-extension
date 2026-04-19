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
export {
  createEmptyStreamingState,
  type StreamingState,
  type NodeMaps,
  type SessionStatus,
  type SessionState,
  type SessionLoadResult,
  type TabViewMode,
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

// ChatMessageHandler - Message routing handler for chat-related VS Code messages
export { ChatMessageHandler } from './chat-message-handler.service';

// AgentMonitorStore - Real-time agent process monitoring state
export { AgentMonitorStore, type MonitoredAgent } from './agent-monitor.store';

// BackgroundAgentStore - Background agent monitoring state
export {
  BackgroundAgentStore,
  type BackgroundAgentEntry,
} from './background-agent.store';

// AgentMonitorMessageHandler - Routes agent monitor messages to store
export { AgentMonitorMessageHandler } from './agent-monitor-message-handler.service';

// PanelResizeService - Standalone panel width state for drag-to-resize
export { PanelResizeService } from './panel-resize.service';

// AgentMonitorTreeBuilderService - Builds ExecutionNode tree for agent monitor panel (TASK_2025_173)
export { AgentMonitorTreeBuilderService } from './agent-monitor-tree-builder.service';

// TabManagerService - Multi-session tab state management with workspace partitioning (TASK_2025_208)
export { TabManagerService } from './tab-manager.service';

// WorkspaceCoordinatorService - Cross-library workspace coordination (breaks core→chat circular dep)
export { WorkspaceCoordinatorService } from './workspace-coordinator.service';

// TabWorkspacePartitionService - Workspace-partitioned tab state management (TASK_2025_208 Batch 6)
export {
  TabWorkspacePartitionService,
  type WorkspaceTabSet,
  type TabLookupResult,
} from './tab-workspace-partition.service';

// SessionDisplayUtils - Shared session name/date formatting (extracted from AppShell + Canvas)
export { SessionDisplayUtils } from './session-display-utils.service';

// SESSION_CONTEXT — optional per-tile session override for canvas tiles (TASK_2025_265)
export { SESSION_CONTEXT } from '../tokens/session-context.token';
