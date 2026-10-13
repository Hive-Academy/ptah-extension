/**
 * Chat Library - Main Entry Point
 *
 * ARCHITECTURE: Chat feature library for Ptah Extension
 *
 * EXPORTS:
 * - Components: ChatComponent and related UI components
 * - Settings: SettingsComponent and AuthConfigComponent
 * - Services: Chat-specific services (ChatStateManagerService, FilePickerService)
 * - Types: AgentOption, ChatFile, FileSuggestion
 */

export * from './lib/components';
export * from './lib/settings';
export * from './lib/services';
export * from './lib/directives';

export { UpdateDialogService } from './lib/update-dialog/update-dialog.service';
export { UpdateDialogComponent } from './lib/update-dialog/update-dialog.component';

export {
  ChangeSetStore,
  type ChangeSetMarks,
} from './lib/services/change-set/change-set.store';
export { ChangeSetActionsService } from './lib/services/change-set/change-set-actions.service';
export { ChatAgentFeedbackSender } from './lib/services/agent-feedback/chat-agent-feedback-sender.service';
export { AgentPermissionResponder } from './lib/services/agent-permission-responder';
export {
  buildLaneSummary,
  LANE_KEY_PREFIX,
  laneKey,
  parseLaneKey,
} from './lib/components/molecules/compact-session/compact-lane-rows';
export { SESSION_CARD_ACTIONS } from './lib/tokens/session-context.token';
export { SESSION_FORCED_CARD } from './lib/tokens/session-context.token';
export { SESSION_START_GUARD } from './lib/tokens/session-context.token';
export { StreamPresentationStore } from './lib/services/stream-presentation-store.service';
export type { SessionCardActions } from './lib/tokens/session-context.token';
