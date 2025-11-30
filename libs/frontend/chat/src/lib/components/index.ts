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
 * KEEPING: Suggestion components (user request - feature required)
 * - FileTagComponent - File tag with preview and removal
 * - FileSuggestionsDropdownComponent - File suggestions with keyboard navigation
 * - UnifiedSuggestionsDropdownComponent - Combined @ autocomplete dropdown
 */

// ============================================================================
// ATOMS - Basic building blocks
// ============================================================================
export * from './atoms/markdown-block.component';
export * from './atoms/status-badge.component';
export * from './atoms/token-badge.component';
export * from './atoms/duration-badge.component';

// ============================================================================
// MOLECULES - Combinations of atoms
// ============================================================================
export * from './molecules/thinking-block.component';
export * from './molecules/tool-call-item.component';
export * from './molecules/agent-summary.component';
export * from './molecules/chat-input.component';

// ============================================================================
// ORGANISMS - Complex sections
// ============================================================================
export * from './organisms/execution-node.component';
export * from './organisms/inline-agent-bubble.component';
export * from './organisms/agent-execution.component';
export * from './organisms/message-bubble.component';

// ============================================================================
// TEMPLATES - Page layouts
// ============================================================================
export * from './templates/chat-view.component';
export * from './templates/app-shell.component';

// ============================================================================
// LEGACY COMPONENTS - KEPT (feature required)
// ============================================================================
export * from './file-tag/file-tag.component';
export * from './file-suggestions-dropdown/file-suggestions-dropdown.component';
export * from './unified-suggestions-dropdown/unified-suggestions-dropdown.component';
