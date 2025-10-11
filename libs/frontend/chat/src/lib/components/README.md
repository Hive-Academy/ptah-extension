# Chat Components

**Library**: `@ptah-extension/frontend/chat`  
**Purpose**: Chat interface components and services for Claude Code CLI interaction

---

## Component Organization Strategy

### 📁 Folder Structure

```text
components/
├── containers/         # Container components (smart)
│   └── chat/          # Main chat container
├── messages/          # Message display components
│   ├── chat-messages-list/
│   ├── enhanced-messages-list/
│   ├── claude-message-content/
│   └── messages-container/
├── input/             # Chat input components
│   ├── chat-input-area/
│   ├── file-tag/
│   └── file-suggestions-dropdown/
├── status/            # Status/header components
│   ├── chat-header/
│   ├── chat-status-bar/
│   ├── token-usage/
│   └── streaming-status/
└── empty/             # Empty state components
    └── chat-empty-state/
```

---

## Component Inventory (From Monolithic App)

### Container Component (1)

| Component             | Purpose                 | Lines | Status     |
| --------------------- | ----------------------- | ----- | ---------- |
| `VSCodeChatComponent` | Main chat orchestration | ~200  | To extract |

### Message Components (5)

| Component                              | Purpose                    | Lines | Status     |
| -------------------------------------- | -------------------------- | ----- | ---------- |
| `VSCodeChatMessagesContainerComponent` | Message container wrapper  | ~70   | To extract |
| `VSCodeChatMessagesListComponent`      | Message list display       | ~400  | To extract |
| `EnhancedChatMessagesListComponent`    | Enhanced message rendering | ~150  | To extract |
| `ClaudeMessageContentComponent`        | Claude-specific content    | ~180  | To extract |

### Input Components (3)

| Component                                | Purpose                 | Lines | Status     |
| ---------------------------------------- | ----------------------- | ----- | ---------- |
| `VSCodeChatInputAreaComponent`           | Chat text input         | ~270  | To extract |
| `VSCodeFileTagComponent`                 | File attachment display | ~280  | To extract |
| `VSCodeFileSuggestionsDropdownComponent` | File picker dropdown    | ~240  | To extract |

### Status Components (4)

| Component                            | Purpose                  | Lines | Status     |
| ------------------------------------ | ------------------------ | ----- | ---------- |
| `VSCodeChatHeaderComponent`          | Chat header with actions | ~90   | To extract |
| `VSCodeChatStatusBarComponent`       | Connection status bar    | ~100  | To extract |
| `VSCodeChatTokenUsageComponent`      | Token usage display      | ~110  | To extract |
| `VSCodeChatStreamingStatusComponent` | Streaming indicator      | ~100  | To extract |

### Empty State (1)

| Component                       | Purpose           | Lines | Status     |
| ------------------------------- | ----------------- | ----- | ---------- |
| `VSCodeChatEmptyStateComponent` | Empty chat prompt | ~250  | To extract |

**Total**: 13 components, ~2,430 LOC

---

## Services (5)

| Service                    | Purpose                | Lines | Status     |
| -------------------------- | ---------------------- | ----- | ---------- |
| `EnhancedChatService`      | Chat orchestration     | ~TBD  | To extract |
| `ChatStateManagerService`  | Chat state management  | ~TBD  | To extract |
| `MessageProcessingService` | Message transformation | ~TBD  | To extract |
| `StateService`             | Chat-specific state    | ~TBD  | To extract |
| `StreamHandlingService`    | Stream processing      | ~TBD  | To extract |

---

## Modern Angular Patterns

All components will be migrated to:

### ✅ Signal-Based APIs

```typescript
export class ChatHeaderComponent {
  readonly providerStatus = input.required<ProviderStatus>();
  readonly sessionCount = input<number>(0);

  readonly newSession = output<void>();
  readonly settingsOpened = output<void>();
}
```

### ✅ Modern Control Flow

```html
@if (messages().length > 0) { @for (message of messages(); track message.id) {
<ptah-message [content]="message" />
} } @else {
<ptah-chat-empty-state />
}
```

### ✅ OnPush Change Detection

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,  // REQUIRED
})
```

---

## Migration Checklist

Per component:

- [ ] Copy from `apps/ptah-extension-webview/src/app/features/chat/`
- [ ] Rename file to remove `vscode-` prefix (optional)
- [ ] Convert to signal-based APIs
- [ ] Migrate control flow syntax
- [ ] Add OnPush change detection
- [ ] Update imports
- [ ] Migrate tests
- [ ] Update barrel exports

---

**Last Updated**: October 11, 2025  
**Component Count**: 0 (13 to extract)  
**Service Count**: 0 (5 to extract)  
**Status**: Foundation setup complete, awaiting extraction
