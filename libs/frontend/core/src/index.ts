export * from './lib/services';
export { AttentionPermissionActionsComponent } from './lib/components/attention-permission-actions.component';
export {
  SURFACE_FOCUS_ROUTER,
  focusRouterKindFor,
  type SurfaceFocusRouter,
} from './lib/tokens/surface-focus-router.token';
export {
  ATTENTION_LANE_OPENER,
  type AttentionLaneOpener,
} from './lib/tokens/attention-lane-opener.token';
export {
  ATTENTION_ACTION_DISPATCHER,
  type AttentionActionDispatcher,
  type AttentionActionOutcome,
} from './lib/tokens/attention-action-dispatcher.token';
export {
  NOTICE_ACTION_HANDLER,
  type NoticeActionHandler,
} from './lib/tokens/notice-action-handler.token';
export * from './lib/services/providers-settings-state.service';
// Exported for its `MESSAGE_HANDLERS` registration only (the Kimi Code sign-in push); pages use
// `ProvidersSettingsStateService`.
export { ProvidersConnectionSetupService } from './lib/services/providers-connection-setup.service';
export { PeerSessionFacade } from './lib/services/peer-session.facade';
export {
  PlanLimitsStore,
  PLAN_LIMITS_CLOCK_TICK_MS,
  type PlanLimitsScopeHandle,
  type PlanLimitsSurfaceScope,
} from './lib/services/plan-limits.store';
export { LogLevel, type LoggingConfig } from './lib/services/logging.service';

export {
  type MarketplaceRoute,
  type MarketplaceServerSource,
  type MarketplaceSkillSource,
  marketplaceRouteCommands,
  marketplaceRouteFromSegments,
} from './lib/marketplace/marketplace-route';

export {
  SESSION_DATA_PROVIDER,
  type ISessionDataProvider,
} from './lib/tokens/session-data.token';

export {
  WORKSPACE_COORDINATOR,
  type IWorkspaceCoordinator,
  type ConfirmDialogOptions,
} from './lib/tokens/workspace-coordinator.token';

export {
  FILE_LINK_OPENER,
  type FileLinkOpenRequest,
  type IFileLinkOpener,
} from './lib/tokens/file-link-opener.token';

export {
  AGENT_FEEDBACK_SENDER,
  type AgentFeedbackSendResult,
  type AgentFeedbackTarget,
  type IAgentFeedbackSender,
} from './lib/tokens/agent-feedback-sender.token';

export {
  NOTIFICATION_FOCUS_ROUTER,
  type NotificationFocusOutcome,
  type NotificationFocusTarget,
  type NotificationFocusResult,
  type NotificationFocusRouter,
} from './lib/tokens/notification-focus-router.token';

export { ORCHESTRA_CANVAS_COMPONENT } from './lib/tokens/lazy-view-components.token';

export * from './lib/routing';
