/**
 * Chat Components - Barrel Export
 *
 * Atomic Design hierarchy with DaisyUI + Tailwind
 * - Atoms: MarkdownBlock, StatusBadge, TokenBadge, DurationBadge
 * - Molecules: ThinkingBlock, ToolCallItem, AgentSummary
 * - Organisms: ExecutionNode (recursive!), MessageBubble, InlineAgentBubble, AgentExecution
 * - Templates: ChatView, AppShell
 *
 * Autocomplete Components:
 * - FileTagComponent - Compact file chip with removal
 * - UnifiedSuggestionsDropdownComponent - @ and / autocomplete dropdown
 *
 * Most atoms and many molecules now live in
 * @ptah-extension/chat-ui. Re-exports below are kept for backward
 * compatibility — prefer importing directly from @ptah-extension/chat-ui
 * in new code.
 */
/**
 * @deprecated Re-exported from @ptah-extension/markdown for backward
 * compatibility. Import directly from @ptah-extension/markdown in new code.
 */
export { MarkdownBlockComponent } from '@ptah-extension/markdown';

/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  CopyButtonComponent,
  CostBadgeComponent,
  DurationBadgeComponent,
  ElectronResizeHandleComponent,
  ErrorAlertComponent,
  ExpandableContentComponent,
  FilePathLinkComponent,
  SidebarTabComponent,
  StatusBadgeComponent,
  StreamingQuotesComponent,
  StreamingTextRevealComponent,
  ThemeToggleComponent,
  TokenBadgeComponent,
  ToolIconComponent,
  TypingCursorComponent,
} from '@ptah-extension/chat-ui';
export * from './atoms/resize-handle.component';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  AgentSummaryComponent,
  QuestionCardComponent,
  ThinkingBlockComponent,
} from '@ptah-extension/chat-ui';
export * from './molecules/agent-card/agent-card.component';
export * from './molecules/agent-continue-input/agent-continue-input.component';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  AgentCardOutputComponent,
  AgentCardPermissionComponent,
} from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export type { RenderSegment, StderrSegment } from '@ptah-extension/chat-ui';
export * from './molecules/tool-execution/tool-call-item.component';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  CodeOutputComponent,
  DiffDisplayComponent,
  TodoListDisplayComponent,
  ToolCallHeaderComponent,
  ToolInputDisplayComponent,
  ToolOutputDisplayComponent,
} from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  DenyMessagePopoverComponent,
  PermissionBadgeComponent,
  PermissionRequestCardComponent,
} from '@ptah-extension/chat-ui';
export * from './molecules/chat-input/chat-input.component';
export * from './molecules/send-to-messaging/send-to-messaging.component';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  AgentSelectorComponent,
  AutopilotPopoverComponent,
} from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  SessionCostSummaryComponent,
  SessionStatsSummaryComponent,
  TabItemComponent,
} from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export type { LiveModelStats, ModelUsageEntry } from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  TrialBannerComponent,
  TrialEndedModalComponent,
  CommunityUpgradeBannerComponent,
} from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  NotificationBellComponent,
  CompactionNotificationComponent,
} from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  SetupStatusWidgetComponent,
  PluginStatusWidgetComponent,
  PluginBrowserModalComponent,
  PromptSuggestionsComponent,
  SkillShBrowserComponent,
  McpDirectoryBrowserComponent,
} from '@ptah-extension/chat-ui';
export * from './molecules/compact-session/compact-session-card.component';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  CompactSessionActivityComponent,
  CompactSessionHeaderComponent,
  CompactSessionInputComponent,
  CompactSessionStatsComponent,
  CompactSessionTextComponent,
} from '@ptah-extension/chat-ui';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export { generateAgentColor } from '@ptah-extension/chat-ui';
export * from './organisms/execution/execution-node.component';
export * from './organisms/execution/inline-agent-bubble.component';
export * from './organisms/execution/agent-execution.component';
export * from './organisms/message-bubble.component';
export * from './organisms/transcript/chat-transcript.component';
export * from './organisms/agent-monitor-panel.component';
export * from './organisms/workspace-sidebar.component';
export * from './templates/chat-view.component';
export * from './templates/app-shell.component';
export * from './templates/welcome.component';
export * from './templates/electron-shell.component';
export * from './templates/electron-welcome.component';
export * from './file-suggestions/file-tag.component';
export * from './file-suggestions/unified-suggestions-dropdown.component';
