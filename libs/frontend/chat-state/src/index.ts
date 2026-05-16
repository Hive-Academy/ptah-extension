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

// ============================================================================
// SERVICES
// ============================================================================
export {
  TabManagerService,
  type ClosedTabEvent,
} from './lib/tab-manager.service';
export {
  TabWorkspacePartitionService,
  type WorkspaceTabSet,
  type TabLookupResult,
} from './lib/tab-workspace-partition.service';
export {
  ConfirmationDialogService,
  type ConfirmationDialogOptions,
} from './lib/confirmation-dialog.service';

// ============================================================================
// INVERTED-DEPENDENCY TOKENS
// ============================================================================
export {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './lib/model-refresh-control';

// ============================================================================
// PAYLOAD TYPES
// ============================================================================
export type {
  LiveModelStatsPayload,
  PreloadedStatsPayload,
} from './lib/tab-state.types';

// ============================================================================
// IDENTITY
// ============================================================================
export {
  TabId,
  ConversationId,
  BackgroundAgentId,
  SurfaceId,
  type ClaudeSessionId,
} from './lib/identity/ids';

// ============================================================================
// ROUTING REGISTRIES
// ============================================================================
export {
  ConversationRegistry,
  type ConversationRecord,
  type CompactionStatePatch,
  type CompactionStateView,
} from './lib/conversation-registry.service';
export { TabSessionBinding } from './lib/tab-session-binding.service';
