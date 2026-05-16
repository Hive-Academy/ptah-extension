// Chat-specific services
export {
  FilePickerService,
  type ChatFile,
  type FileSuggestion,
} from './file-picker.service';

// ChatStore - Signal-based reactive store
export { ChatStore } from './chat.store';

// ExecutionTreeBuilderService - Builds ExecutionNode tree from flat streaming events.
// Moved to @ptah-extension/chat-streaming. Re-exported here for backwards
// compatibility — new code should import directly from '@ptah-extension/chat-streaming'.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';

// Pure execution-tree helpers moved to `@ptah-extension/chat-execution-tree`.
// Re-exported here for backwards compatibility — new code should import
// directly from the new lib.
/** @deprecated Import from `@ptah-extension/chat-execution-tree` instead. */
export {
  AgentStatsService,
  MAX_DEPTH,
  type BuilderDeps,
  type BackgroundAgentLookup,
} from '@ptah-extension/chat-execution-tree';

// SessionManager - Session lifecycle and node map management.
// Moved to @ptah-extension/chat-streaming. Re-exported here for backwards
// compatibility — new code should import directly from '@ptah-extension/chat-streaming'.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export { SessionManager } from '@ptah-extension/chat-streaming';

// Chat types - Shared interfaces moved to @ptah-extension/chat-types lib.
// Re-exported here for backwards compatibility with existing barrel imports;
// new code should import directly from '@ptah-extension/chat-types'.
export {
  createEmptyStreamingState,
  type StreamingState,
  type NodeMaps,
  type SessionStatus,
  type SessionState,
  type SessionLoadResult,
  type TabViewMode,
} from '@ptah-extension/chat-types';

// ConfirmationDialogService - Custom confirmation dialog for VS Code webview.
// Moved to @ptah-extension/chat-state. Re-exported here for backwards
// compatibility — new code should import directly from '@ptah-extension/chat-state'.
/** @deprecated Import from `@ptah-extension/chat-state` instead. */
export {
  ConfirmationDialogService,
  type ConfirmationDialogOptions,
} from '@ptah-extension/chat-state';

// MessageSenderService - Centralized message sending mediator
export { MessageSenderService } from './message-sender.service';

// MessageValidationService - Centralized message validation
export {
  MessageValidationService,
  type ValidationResult,
} from './message-validation.service';

// ChatMessageHandler - Message routing handler for chat-related VS Code messages
export { ChatMessageHandler } from './chat-message-handler.service';

// AgentMonitorStore - Real-time agent process monitoring state.
// Moved to @ptah-extension/chat-streaming.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';

// BackgroundAgentStore - Background agent monitoring state.
// Moved to @ptah-extension/chat-streaming.
/** @deprecated Import from `@ptah-extension/chat-streaming` instead. */
export {
  BackgroundAgentStore,
  type BackgroundAgentEntry,
} from '@ptah-extension/chat-streaming';

// AgentMonitorMessageHandler - Routes agent monitor messages to store
export { AgentMonitorMessageHandler } from './agent-monitor-message-handler.service';

// PanelResizeService - Standalone panel width state for drag-to-resize
export { PanelResizeService } from './panel-resize.service';

// ActionBannerService - Shared inline banner for branch/rewind/editor actions (S3).
// Lifted from ChatViewComponent so canvas tiles and the active view share a
// single banner surface.
export {
  ActionBannerService,
  type ActionBannerState,
} from './action-banner.service';

// AgentMonitorTreeBuilderService - Builds ExecutionNode tree for agent monitor panel
export { AgentMonitorTreeBuilderService } from './agent-monitor-tree-builder.service';

// TabManagerService - Multi-session tab state management with workspace partitioning.
// Moved to @ptah-extension/chat-state. Re-exported here for backwards compatibility —
// new code should import directly from '@ptah-extension/chat-state'.
/** @deprecated Import from `@ptah-extension/chat-state` instead. */
export {
  TabManagerService,
  type LiveModelStatsPayload,
  type PreloadedStatsPayload,
} from '@ptah-extension/chat-state';

// WorkspaceCoordinatorService - Cross-library workspace coordination (breaks core→chat circular dep)
export { WorkspaceCoordinatorService } from './workspace-coordinator.service';

// TabWorkspacePartitionService - Workspace-partitioned tab state management.
// Moved to @ptah-extension/chat-state. Re-exported here for backwards compatibility —
// new code should import directly from '@ptah-extension/chat-state'.
/** @deprecated Import from `@ptah-extension/chat-state` instead. */
export {
  TabWorkspacePartitionService,
  type WorkspaceTabSet,
  type TabLookupResult,
} from '@ptah-extension/chat-state';

// SessionDisplayUtils - Shared session name/date formatting (extracted from AppShell + Canvas)
export { SessionDisplayUtils } from './session-display-utils.service';

// SESSION_CONTEXT — optional per-tile session override for canvas tiles
export { SESSION_CONTEXT } from '../tokens/session-context.token';

// STREAMING_CONTROL token + StreamingControlImpl + provideStreamingControl
// have been DELETED. The cycle they were inverting
// (TabManager → STREAMING_CONTROL → StreamingHandler/AgentMonitorStore →
// TabManager) was a runtime cycle the inversion did not actually break;
// it was the source of NG0200 in the webview. The router (in
// `@ptah-extension/chat-routing`) now owns the cleanup decision tree by
// subscribing to `TabManagerService.closedTab` via `effect()`.

// ModelRefreshControl — inverted-dependency contract used by TabManagerService
// to refresh the available-models list after createTab() without depending
// on @ptah-extension/core (forbidden for type:data-access).
export { provideModelRefreshControl } from './chat-store/model-refresh-control.provider';
