/**
 * @ptah-extension/chat-state — Per-tab chat state model and TabManagerService.
 *
 * Boundary: tagged `scope:webview` + `type:data-access`. Per Nx
 * `enforce-module-boundaries`, this lib can only depend on
 * `type:data-access` and `type:util` libs (currently
 * `@ptah-extension/chat-types` and `@ptah-extension/shared`). Cross-cutting
 * dependencies on `type:core` services are inverted via DI tokens
 * (`MODEL_REFRESH_CONTROL`).
 */
export {
  TabManagerService,
  type ClosedTabEvent,
} from './lib/tab-manager.service';
export {
  TabWorkspacePartitionService,
  type WorkspaceTabSet,
  type TabLookupResult,
  type WorkspaceRemovalEvent,
} from './lib/tab-workspace-partition.service';
export {
  ConfirmationDialogService,
  type ConfirmationDialogOptions,
  type ConfirmationDialogCheckbox,
  type ConfirmationDialogResult,
} from './lib/confirmation-dialog.service';
export {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './lib/model-refresh-control';
export type {
  LiveModelStatsPayload,
  PreloadedStatsPayload,
} from './lib/tab-state.types';
export {
  TabId,
  ConversationId,
  BackgroundAgentId,
  SurfaceId,
  type ClaudeSessionId,
} from './lib/identity/ids';
export {
  ConversationRegistry,
  type ConversationRecord,
  type CompactionMarkerRecord,
  type CompactionStatePatch,
  type CompactionStateView,
} from './lib/conversation-registry.service';
export { TabSessionBinding } from './lib/tab-session-binding.service';
export {
  SessionLivenessRegistry,
  type LivenessStatus,
} from './lib/session-liveness.registry';
