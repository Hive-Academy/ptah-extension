/**
 * @ptah-extension/chat-state — Per-tab chat state model and TabManagerService.
 *
 * TASK_2026_105 Wave G2 Phase 2: Extracted from `@ptah-extension/chat` so
 * downstream apps (electron, dashboard, canvas) can consume tab state
 * without pulling the full chat feature library.
 *
 * Boundary: tagged `scope:webview` + `type:data-access`. Per Nx
 * `enforce-module-boundaries`, this lib can only depend on
 * `type:data-access` and `type:util` libs (currently
 * `@ptah-extension/chat-types` and `@ptah-extension/shared`). Cross-cutting
 * dependencies on `type:core` services are inverted via DI tokens
 * (`MODEL_REFRESH_CONTROL`).
 *
 * TASK_2026_106 Phase 3: `STREAMING_CONTROL` token removed. TabManager no
 * longer pushes to streaming code; instead it emits `ClosedTabEvent`s on
 * its `closedTab` signal and the `StreamRouter` (in
 * `@ptah-extension/chat-routing`) reacts via `effect()`. This deletes the
 * NG0200 cycle that motivated the inversion in the first place.
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
// IDENTITY (TASK_2026_106 Phase 1)
// ============================================================================
export {
  TabId,
  ConversationId,
  BackgroundAgentId,
  type ClaudeSessionId,
} from './lib/identity/ids';

// ============================================================================
// ROUTING REGISTRIES (TASK_2026_106 Phase 1, additive — no callers yet)
// ============================================================================
export {
  ConversationRegistry,
  type ConversationRecord,
} from './lib/conversation-registry.service';
export { TabSessionBinding } from './lib/tab-session-binding.service';
