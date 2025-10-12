/**
 * Chat Components - Barrel Export
 *
 * MODERNIZATION STATUS: 7/13 components migrated (54%)
 *
 * Components exported:
 * - ChatHeaderComponent - Header with action buttons and provider status
 * - ChatStatusBarComponent - System metrics and connection status
 * - ChatStreamingStatusComponent - Streaming feedback banner with stop control
 * - ChatTokenUsageComponent - Token consumption progress bar
 * - ChatEmptyStateComponent - Welcome screen with action cards
 * - FileTagComponent - File tag with preview and removal
 * - FileSuggestionsDropdownComponent - File suggestions with keyboard navigation
 *
 * TODO: Migrate remaining 6 components:
 * - MessagesContainerComponent
 * - MessagesListComponent
 * - EnhancedMessagesListComponent
 * - MessageContentComponent
 * - InputAreaComponent
 * - ChatComponent (container - migrate LAST)
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

// TODO: Export remaining components as they are migrated
// export * from './messages-container/messages-container.component';
// export * from './messages-list/messages-list.component';
// export * from './enhanced-messages-list/enhanced-messages-list.component';
// export * from './message-content/message-content.component';
// export * from './input-area/input-area.component';
// export * from './chat-container/chat.component';
