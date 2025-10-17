# libs/frontend/chat - Chat UI Components

## Purpose

Complete Angular chat interface with message display, input, streaming, session management, and token tracking.

## Components (11 total)

**Container**:

- `ChatComponent` (`containers/chat/`): Main orchestrator

**Message Display**:

- `ChatMessagesContainerComponent`: Empty state / message list switcher
- `ChatMessagesListComponent`: Message list with auto-scroll
- `ChatMessageContentComponent`: Rich content rendering (markdown, tool use, files)

**Input**:

- `ChatInputAreaComponent`: Multi-line input with @ mentions, file tags

**Status**:

- `ChatHeaderComponent`: Header with actions
- `ChatStatusBarComponent`: System metrics
- `ChatStreamingStatusComponent`: Streaming banner
- `ChatTokenUsageComponent`: Token progress bar
- `ChatEmptyStateComponent`: Welcome screen

**Utilities**:

- `FileTagComponent`: File attachment display
- `FileSuggestionsDropdownComponent`: @ syntax autocomplete

## Quick Start

```typescript
import { ChatComponent } from '@ptah-extension/chat';

@Component({
  imports: [ChatComponent],
})
export class AppComponent {}
```

## Signal Patterns

```typescript
// Input signals
readonly message = input.required<ProcessedClaudeMessage>();
readonly isStreaming = input<boolean>(false);

// Output signals
readonly messageClicked = output<ProcessedClaudeMessage>();
readonly sendMessage = output<void>();

// Computed
readonly sessionStats = computed(() => ({
  messageCount: this.messages().length,
  timeAgo: this.getTimeAgo(this.session().lastActiveAt)
}));
```

## Dependencies

- `@ptah-extension/core`: ChatService, FilePickerService, etc.
- `@ptah-extension/shared`: Types
- `@ptah-extension/shared-ui`: DropdownComponent, ActionButtonComponent
- `@ptah-extension/session`: SessionSelectorComponent
- `@ptah-extension/providers`: ProviderManagerComponent

## Testing

```bash
nx test chat
```

## File Locations

- **Container**: `src/lib/containers/chat/`
- **Components**: `src/lib/components/*/`
- **Entry**: `src/index.ts`
