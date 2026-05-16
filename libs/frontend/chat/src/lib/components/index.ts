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

// ============================================================================
// ATOMS - Basic building blocks
// ============================================================================
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

// ============================================================================
// MOLECULES - Standalone (ungrouped)
// ============================================================================
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  AgentSummaryComponent,
  QuestionCardComponent,
  ThinkingBlockComponent,
} from '@ptah-extension/chat-ui';

// ============================================================================
// MOLECULES - Agent Card
// ============================================================================
export * from './molecules/agent-card/agent-card.component';
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

// ============================================================================
// MOLECULES - Tool Execution
// ============================================================================
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

// ============================================================================
// MOLECULES - Permissions
// ============================================================================
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  DenyMessagePopoverComponent,
  PermissionBadgeComponent,
  PermissionRequestCardComponent,
} from '@ptah-extension/chat-ui';

// ============================================================================
// MOLECULES - Chat Input
// ============================================================================
export * from './molecules/chat-input/chat-input.component';
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  AgentSelectorComponent,
  AutopilotPopoverComponent,
} from '@ptah-extension/chat-ui';

// ============================================================================
// MOLECULES - Session
// ============================================================================
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

// ============================================================================
// MOLECULES - Trial & Billing
// ============================================================================
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  TrialBannerComponent,
  TrialEndedModalComponent,
  CommunityUpgradeBannerComponent,
} from '@ptah-extension/chat-ui';

// ============================================================================
// MOLECULES - Notifications
// ============================================================================
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export {
  NotificationBellComponent,
  CompactionNotificationComponent,
} from '@ptah-extension/chat-ui';

// ============================================================================
// MOLECULES - Setup & Plugins
// ============================================================================
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

// ============================================================================
// MOLECULES - Compact Session
// ============================================================================
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

// ============================================================================
// UTILITIES
// ============================================================================
/**
 * @deprecated Re-exported from @ptah-extension/chat-ui. Import directly from
 * @ptah-extension/chat-ui in new code.
 */
export { generateAgentColor } from '@ptah-extension/chat-ui';

// ============================================================================
// ORGANISMS - Execution
// ============================================================================
export * from './organisms/execution/execution-node.component';
export * from './organisms/execution/inline-agent-bubble.component';
export * from './organisms/execution/agent-execution.component';

// ============================================================================
// ORGANISMS - Standalone
// ============================================================================
export * from './organisms/message-bubble.component';
export * from './organisms/agent-monitor-panel.component';
export * from './organisms/workspace-sidebar.component';

// ============================================================================
// TEMPLATES - Page layouts
// ============================================================================
export * from './templates/chat-view.component';
export * from './templates/app-shell.component';
export * from './templates/welcome.component';
export * from './templates/electron-shell.component';
export * from './templates/electron-welcome.component';

// ============================================================================
// AUTOCOMPLETE COMPONENTS
// ============================================================================
export * from './file-suggestions/file-tag.component';
export * from './file-suggestions/unified-suggestions-dropdown.component';
