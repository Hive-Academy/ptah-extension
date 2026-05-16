/**
 * @ptah-extension/chat-ui — Reusable presentational chat components.
 *
 * Atomic Design layout:
 *   - Atoms: smallest reusable building blocks
 *   - Molecules: composed UI pieces
 */

// ============================================================================
// ATOMS
// ============================================================================
export { CopyButtonComponent } from './lib/atoms/copy-button.component';
export { CostBadgeComponent } from './lib/atoms/cost-badge.component';
export { DurationBadgeComponent } from './lib/atoms/duration-badge.component';
export { ElectronResizeHandleComponent } from './lib/atoms/electron-resize-handle.component';
export { ErrorAlertComponent } from './lib/atoms/error-alert.component';
export { ExpandableContentComponent } from './lib/atoms/expandable-content.component';
export { FilePathLinkComponent } from './lib/atoms/file-path-link.component';
export { SidebarTabComponent } from './lib/atoms/sidebar-tab.component';
export { StatusBadgeComponent } from './lib/atoms/status-badge.component';
export { StreamingQuotesComponent } from './lib/atoms/streaming-quotes.component';
export { StreamingTextRevealComponent } from './lib/atoms/streaming-text-reveal.component';
export { ThemeToggleComponent } from './lib/atoms/theme-toggle.component';
export { TokenBadgeComponent } from './lib/atoms/token-badge.component';
export { ToolIconComponent } from './lib/atoms/tool-icon.component';
export { TypingCursorComponent } from './lib/atoms/typing-cursor.component';
export { RESIZE_HANDLE_STYLES } from './lib/atoms/resize-handle.styles';

// ============================================================================
// MOLECULES — Agent Card
// ============================================================================
export { AgentCardOutputComponent } from './lib/molecules/agent-card/agent-card-output.component';
export { AgentCardPermissionComponent } from './lib/molecules/agent-card/agent-card-permission.component';
export type {
  RenderSegment,
  StderrSegment,
} from './lib/molecules/agent-card/agent-card.types';

// ============================================================================
// MOLECULES — Standalone
// ============================================================================
export { AgentSummaryComponent } from './lib/molecules/agent-summary.component';
export { CommunityUpgradeBannerComponent } from './lib/molecules/community-upgrade-banner.component';
export { QuestionCardComponent } from './lib/molecules/question-card.component';
export { ThinkingBlockComponent } from './lib/molecules/thinking-block.component';
export { TrialBannerComponent } from './lib/molecules/trial-banner.component';
export { TrialEndedModalComponent } from './lib/molecules/trial-ended-modal.component';

// ============================================================================
// MOLECULES — Chat Input
// ============================================================================
export { AgentSelectorComponent } from './lib/molecules/chat-input/agent-selector.component';
export { AutopilotPopoverComponent } from './lib/molecules/chat-input/autopilot-popover.component';

// ============================================================================
// MOLECULES — Compact Session
// ============================================================================
export { CompactSessionActivityComponent } from './lib/molecules/compact-session/compact-session-activity.component';
export { CompactSessionHeaderComponent } from './lib/molecules/compact-session/compact-session-header.component';
export { CompactSessionInputComponent } from './lib/molecules/compact-session/compact-session-input.component';
export { CompactSessionStatsComponent } from './lib/molecules/compact-session/compact-session-stats.component';
export { CompactSessionTextComponent } from './lib/molecules/compact-session/compact-session-text.component';

// ============================================================================
// MOLECULES — Notifications
// ============================================================================
export { CompactionNotificationComponent } from './lib/molecules/notifications/compaction-notification.component';
export { NotificationBellComponent } from './lib/molecules/notifications/notification-bell.component';

// ============================================================================
// MOLECULES — Permissions
// ============================================================================
export { DenyMessagePopoverComponent } from './lib/molecules/permissions/deny-message-popover.component';
export { PermissionBadgeComponent } from './lib/molecules/permissions/permission-badge.component';
export { PermissionRequestCardComponent } from './lib/molecules/permissions/permission-request-card.component';

// ============================================================================
// MOLECULES — Session
// ============================================================================
export { SessionCostSummaryComponent } from './lib/molecules/session/session-cost-summary.component';
export {
  SessionStatsSummaryComponent,
  type LiveModelStats,
  type ModelUsageEntry,
} from './lib/molecules/session/session-stats-summary.component';
export { TabItemComponent } from './lib/molecules/session/tab-item.component';

// ============================================================================
// MOLECULES — Setup & Plugins
// ============================================================================
export { McpDirectoryBrowserComponent } from './lib/molecules/setup-plugins/mcp-directory-browser.component';
export { PluginBrowserModalComponent } from './lib/molecules/setup-plugins/plugin-browser-modal.component';
export { PluginStatusWidgetComponent } from './lib/molecules/setup-plugins/plugin-status-widget.component';
export { PromptSuggestionsComponent } from './lib/molecules/setup-plugins/prompt-suggestions.component';
export { SetupStatusWidgetComponent } from './lib/molecules/setup-plugins/setup-status-widget.component';
export { SkillShBrowserComponent } from './lib/molecules/setup-plugins/skill-sh-browser.component';

// ============================================================================
// MOLECULES — Tool Execution
// ============================================================================
export { CodeOutputComponent } from './lib/molecules/tool-execution/code-output.component';
export { DiffDisplayComponent } from './lib/molecules/tool-execution/diff-display.component';
export { TodoListDisplayComponent } from './lib/molecules/tool-execution/todo-list-display.component';
export { ToolCallHeaderComponent } from './lib/molecules/tool-execution/tool-call-header.component';
export { ToolInputDisplayComponent } from './lib/molecules/tool-execution/tool-input-display.component';
export { ToolOutputDisplayComponent } from './lib/molecules/tool-execution/tool-output-display.component';

// ============================================================================
// UTILITIES
// ============================================================================
export {
  generateAgentColor,
  generateAgentColorOklch,
  formatOklch,
  isThemeFallbackColor,
  THEME_FALLBACK_OKLCH,
  type OklchColor,
} from './lib/utils/agent-color.utils';
