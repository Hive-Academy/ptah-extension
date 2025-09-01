// Chat Feature Components
export { VSCodeChatEmptyStateComponent } from './chat-empty-state.component';
export { VSCodeChatTokenUsageComponent, type TokenUsage } from './chat-token-usage.component';
export { VSCodeChatInputAreaComponent } from './chat-input-area.component';
export {
  VSCodeChatMessagesListComponent,
  type ChatMessage,
} from './chat-messages-list.component';
export { EnhancedChatMessagesListComponent } from './enhanced-chat-messages-list.component';
export { ClaudeMessageContentComponent } from './claude-message-content.component';
export { VSCodeChatHeaderComponent, type ProviderStatus } from './chat-header.component';
export {
  VSCodeChatStatusBarComponent,
  type ChatStatusMetrics,
} from './chat-status-bar.component';
export { VSCodeChatStreamingStatusComponent } from './chat-streaming-status.component';
export { VSCodeChatMessagesContainerComponent } from './chat-messages-container.component';
export { VSCodeFileTagComponent } from './file-tag.component';
export { VSCodeFileSuggestionsDropdownComponent } from './file-suggestions-dropdown.component';

// Shared types that might be needed
export { type DropdownOption } from '../../../shared/components/forms/dropdown-option.interface';
export { type QuickCommand } from '../../../shared/components/overlays/command-bottom-sheet.component';
export { type PermissionRequest, type PermissionResponse } from '../../../shared/components/overlays/permission-popup.component';

// Session components re-export
export { SessionSelectorComponent } from '../../session/components/session-selector.component';