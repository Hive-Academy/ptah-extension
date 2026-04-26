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
// TASK_2026_105 Wave G2 Phase 3: moved to @ptah-extension/chat-streaming.
// Re-exported here for backwards compatibility — new code should import
// directly from '@ptah-extension/chat-streaming'.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';

// TASK_2026_105 Wave G1: pure execution-tree helpers moved to
// `@ptah-extension/chat-execution-tree`. Re-exported here for backwards
// compatibility — new code should import directly from the new lib.
/** @deprecated Import from `@ptah-extension/chat-execution-tree` instead. */
export {
  AgentStatsService,
  MAX_DEPTH,
  type BuilderDeps,
  type BackgroundAgentLookup,
} from '@ptah-extension/chat-execution-tree';

// SessionManager - Session lifecycle and node map management (TASK_2025_023 Phase 4)
// TASK_2026_105 Wave G2 Phase 3: moved to @ptah-extension/chat-streaming.
// Re-exported here for backwards compatibility — new code should import
// directly from '@ptah-extension/chat-streaming'.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export { SessionManager } from '@ptah-extension/chat-streaming';

// Chat types - Shared interfaces moved to @ptah-extension/chat-types lib (TASK_2026_103 Wave B3).
// Re-exported here for backwards compatibility with existing barrel imports; new code should
// import directly from '@ptah-extension/chat-types'.
export {
  createEmptyStreamingState,
  type StreamingState,
  type NodeMaps,
  type SessionStatus,
  type SessionState,
  type SessionLoadResult,
  type TabViewMode,
} from '@ptah-extension/chat-types';

// ConfirmationDialogService - Custom confirmation dialog for VS Code webview
// TASK_2026_105 Wave G2 Phase 2: moved to @ptah-extension/chat-state.
// Re-exported here for backwards compatibility — new code should import
// directly from '@ptah-extension/chat-state'.
/** @deprecated Import from `@ptah-extension/chat-state` instead. */
export {
  ConfirmationDialogService,
  type ConfirmationDialogOptions,
} from '@ptah-extension/chat-state';

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
// TASK_2026_105 Wave G2 Phase 3: moved to @ptah-extension/chat-streaming.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';

// BackgroundAgentStore - Background agent monitoring state
// TASK_2026_105 Wave G2 Phase 3: moved to @ptah-extension/chat-streaming.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export {
  BackgroundAgentStore,
  type BackgroundAgentEntry,
} from '@ptah-extension/chat-streaming';

// AgentMonitorMessageHandler - Routes agent monitor messages to store
export { AgentMonitorMessageHandler } from './agent-monitor-message-handler.service';

// PanelResizeService - Standalone panel width state for drag-to-resize
export { PanelResizeService } from './panel-resize.service';

// AgentMonitorTreeBuilderService - Builds ExecutionNode tree for agent monitor panel (TASK_2025_173)
export { AgentMonitorTreeBuilderService } from './agent-monitor-tree-builder.service';

// TabManagerService - Multi-session tab state management with workspace partitioning (TASK_2025_208)
// TASK_2026_105 Wave G2 Phase 2: moved to @ptah-extension/chat-state.
// Re-exported here for backwards compatibility — new code should import
// directly from '@ptah-extension/chat-state'.
/** @deprecated Import from `@ptah-extension/chat-state` instead. */
export {
  TabManagerService,
  type LiveModelStatsPayload,
  type PreloadedStatsPayload,
} from '@ptah-extension/chat-state';

// WorkspaceCoordinatorService - Cross-library workspace coordination (breaks core→chat circular dep)
export { WorkspaceCoordinatorService } from './workspace-coordinator.service';

// TabWorkspacePartitionService - Workspace-partitioned tab state management (TASK_2025_208 Batch 6)
// TASK_2026_105 Wave G2 Phase 2: moved to @ptah-extension/chat-state.
// Re-exported here for backwards compatibility — new code should import
// directly from '@ptah-extension/chat-state'.
/** @deprecated Import from `@ptah-extension/chat-state` instead. */
export {
  TabWorkspacePartitionService,
  type WorkspaceTabSet,
  type TabLookupResult,
} from '@ptah-extension/chat-state';

// SessionDisplayUtils - Shared session name/date formatting (extracted from AppShell + Canvas)
export { SessionDisplayUtils } from './session-display-utils.service';

// SESSION_CONTEXT — optional per-tile session override for canvas tiles (TASK_2025_265)
export { SESSION_CONTEXT } from '../tokens/session-context.token';

// TASK_2026_106 Phase 3: STREAMING_CONTROL token + StreamingControlImpl +
// provideStreamingControl have been DELETED. The cycle they were inverting
// (TabManager → STREAMING_CONTROL → StreamingHandler/AgentMonitorStore →
// TabManager) was a runtime cycle the inversion did not actually break;
// it was the source of NG0200 in the webview. The router (in
// `@ptah-extension/chat-routing`) now owns the cleanup decision tree by
// subscribing to `TabManagerService.closedTab` via `effect()`.

// ModelRefreshControl — inverted-dependency contract used by TabManagerService
// to refresh the available-models list after createTab() without depending
// on @ptah-extension/core (forbidden for type:data-access).
// TASK_2026_105 Wave G2 Phase 2.
export { provideModelRefreshControl } from './chat-store/model-refresh-control.provider';
