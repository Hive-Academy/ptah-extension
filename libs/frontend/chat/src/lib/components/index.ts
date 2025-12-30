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

// ============================================================================
// MOLECULES - Combinations of atoms
// ============================================================================
export * from './molecules/thinking-block.component';
export * from './molecules/tool-call-item.component';
export * from './molecules/agent-summary.component';
export * from './molecules/chat-input.component';
export * from './molecules/session-cost-summary.component';
export * from './molecules/setup-status-widget.component';
export * from './molecules/permission-badge.component';
export {
  QuestionCardComponent,
  type AskUserQuestionRequest,
  type AskUserQuestionResponse,
} from './molecules/question-card.component';

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
// AUTOCOMPLETE COMPONENTS
// ============================================================================
export * from './file-suggestions/file-tag.component';
export * from './file-suggestions/unified-suggestions-dropdown.component';
