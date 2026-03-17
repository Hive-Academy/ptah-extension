/**
 * Chat Components - Barrel Export
 *
 * REBUILT for TASK_2025_023 - Revolutionary ExecutionNode architecture
 *
 * NEW: Atomic Design hierarchy with DaisyUI + Tailwind
 * - Atoms: MarkdownBlock, StatusBadge, TokenBadge, DurationBadge
 * - Molecules: ThinkingBlock, ToolCallItem, AgentSummary
 * - Organisms: ExecutionNode (recursive!), MessageBubble, InlineAgentBubble, AgentExecution
 * - Templates: ChatView, AppShell
 *
 * Autocomplete Components:
 * - FileTagComponent - Compact file chip with removal
 * - UnifiedSuggestionsDropdownComponent - @ and / autocomplete dropdown
 */

// ============================================================================
// ATOMS - Basic building blocks
// ============================================================================
export * from './atoms/markdown-block.component';
export * from './atoms/status-badge.component';
export * from './atoms/token-badge.component';
export * from './atoms/cost-badge.component';
export * from './atoms/duration-badge.component';
export * from './atoms/streaming-text-reveal.component';
export * from './atoms/typing-cursor.component';
export * from './atoms/theme-toggle.component';
export * from './atoms/resize-handle.component';
export * from './atoms/electron-resize-handle.component';

// ============================================================================
// MOLECULES - Standalone (ungrouped)
// ============================================================================
export * from './molecules/thinking-block.component';
export * from './molecules/agent-summary.component';
export { QuestionCardComponent } from './molecules/question-card.component';

// ============================================================================
// MOLECULES - Tool Execution
// ============================================================================
export * from './molecules/tool-execution/tool-call-item.component';

// ============================================================================
// MOLECULES - Permissions
// ============================================================================
export * from './molecules/permissions/permission-badge.component';
export * from './molecules/permissions/deny-message-popover.component';

// ============================================================================
// MOLECULES - Chat Input
// ============================================================================
export * from './molecules/chat-input/chat-input.component';

// ============================================================================
// MOLECULES - Session
// ============================================================================
export * from './molecules/session/session-cost-summary.component';

// ============================================================================
// MOLECULES - Trial & Billing
// ============================================================================
export * from './molecules/trial-billing/trial-banner.component';
export * from './molecules/trial-billing/trial-ended-modal.component';
export * from './molecules/trial-billing/community-upgrade-banner.component';

// ============================================================================
// MOLECULES - Notifications
// ============================================================================
export * from './molecules/notifications/notification-bell.component';
export * from './molecules/notifications/background-agent-badge.component';
export * from './molecules/notifications/compaction-notification.component';

// ============================================================================
// MOLECULES - Setup & Plugins
// ============================================================================
export * from './molecules/setup-plugins/setup-status-widget.component';
export * from './molecules/setup-plugins/plugin-status-widget.component';
export * from './molecules/setup-plugins/plugin-browser-modal.component';

// ============================================================================
// MOLECULES - Agent Card (WIP - separate refactor)
// ============================================================================
export * from './molecules/agent-card/agent-card.component';

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
export * from './organisms/editor-panel-placeholder.component';

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
