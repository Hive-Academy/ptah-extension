/**
 * Chat Components - Barrel Export
 *
 * MODERNIZATION STATUS: 11/11 components migrated (100%) ✅ COMPLETE!
 *
 * Components exported:
 * - ChatHeaderComponent - Header with action buttons and provider status
 * - ChatStatusBarComponent - System metrics and connection status
 * - ChatStreamingStatusComponent - Streaming feedback banner with stop control
 * - ChatTokenUsageComponent - Token consumption progress bar
 * - ChatEmptyStateComponent - Welcome screen with action cards
 * - FileTagComponent - File tag with preview and removal
 * - FileSuggestionsDropdownComponent - File suggestions with keyboard navigation
 * - ChatMessageContentComponent - Rich message content renderer
 * - ChatMessagesListComponent - Message list with grouping and auto-scroll
 * - ChatInputAreaComponent - Message input with @ file mentions
 * - ChatMessagesContainerComponent - Orchestrator for message display ✅ COMPLETE!
 */

// Status Components (4/4 complete) ✅
export * from './chat-header/chat-header.component';
export * from './chat-status-bar/chat-status-bar.component';
export * from './chat-streaming-status/chat-streaming-status.component';
export * from './chat-token-usage/chat-token-usage.component';

// UI Components (3/3 complete) ✅
export * from './chat-empty-state/chat-empty-state.component';
export * from './file-tag/file-tag.component';
export * from './file-suggestions-dropdown/file-suggestions-dropdown.component';

// Message Components (3/3 complete) ✅
export * from './chat-messages';

// Input Components (1/1 complete) ✅
export * from './chat-input';

// Agent Visualization Components (3/3 complete) ✅ TASK_2025_004
export * from './agent-tree/agent-tree.component';
export * from './agent-timeline/agent-timeline.component';
export * from './agent-status-badge/agent-status-badge.component';

// Event Relay UI Components (4/4 complete) ✅ TASK_2025_006 - Batch 4
export * from './thinking-display/thinking-display.component';
export * from './tool-timeline/tool-timeline.component';
export * from './permission-dialog/permission-dialog.component';
export * from './agent-activity-timeline/agent-activity-timeline.component';

// ContentBlock Rendering Components (3/3 complete) ✅ TASK_2025_009 - Batch R2
export * from './thinking-block/thinking-block.component';
export * from './tool-use-block/tool-use-block.component';
export * from './tool-result-block/tool-result-block.component';

// Session Management Components (2/2 complete) ✅ TASK_SESSION_MANAGEMENT - Batch 3
export * from './session-dropdown/session-dropdown.component';
export * from './session-search-overlay/session-search-overlay.component';
