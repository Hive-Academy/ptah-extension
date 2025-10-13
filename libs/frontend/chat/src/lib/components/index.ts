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

// Status Components (4/6 complete)
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
