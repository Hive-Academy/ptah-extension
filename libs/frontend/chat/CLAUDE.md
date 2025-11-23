# libs/frontend/chat - Chat UI Components

## Purpose

Complete Angular chat interface with message display, input, streaming, session management, and token tracking.

## Components (13 total)

**Container**:

- `ChatComponent` (`containers/chat/`): Main orchestrator

**Message Display**:

- `ChatMessagesContainerComponent`: Empty state / message list switcher
- `ChatMessagesListComponent`: Message list with auto-scroll
- `ChatMessageContentComponent`: Rich content rendering (markdown, tool use, files)

**Input**:

- `ChatInputAreaComponent`: Multi-line input with @ mentions, file tags

**Status**:

- `ChatHeaderComponent`: Header with actions and session dropdown
- `ChatStatusBarComponent`: System metrics
- `ChatStreamingStatusComponent`: Streaming banner
- `ChatTokenUsageComponent`: Token progress bar
- `ChatEmptyStateComponent`: Welcome screen

**Session Management**:

- `SessionDropdownComponent`: Recent sessions dropdown (5-10 sessions)
- `SessionSearchOverlayComponent`: Full-screen session search with filtering

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

## Key Features

### Session Management (New!)

**Two-tier session access pattern:**

#### 1. SessionDropdownComponent - Quick Access

Located in chat header for immediate session switching:

```typescript
<ptah-session-dropdown
  [currentSessionId]="currentSession()?.id ?? null"
  [recentSessions]="chatService.recentSessions()"
  (sessionSelected)="onSessionSelected($event)"
  (newSessionClicked)="createNewSession()"
  (searchAllClicked)="openSearchOverlay()"
/>
```

**Features**:

- Shows 5-10 most recent sessions (sorted by lastActiveAt)
- Active session highlighted with green indicator
- "New Session" button
- "Search All Sessions..." button to open full search
- Keyboard navigation (arrows, Enter, Escape)
- Click-outside-to-close
- VS Code theme integration
- Smooth animations (200ms)

**Responsive Behavior**:

- Desktop (≥1024px): 320px width dropdown
- Tablet (768-1024px): 280px width dropdown
- Mobile (<768px): Full-width dropdown

**Accessibility**:

- WCAG 2.1 AA compliant
- Full keyboard navigation
- ARIA attributes (role="menu", aria-expanded, aria-controls)
- Screen reader support
- Touch targets ≥ 44x44px

#### 2. SessionSearchOverlayComponent - Full Search

Full-screen modal for browsing and searching all sessions:

```typescript
<ptah-session-search-overlay
  [isOpen]="showSearchOverlay()"
  [currentSessionId]="currentSession()?.id ?? null"
  [sessions]="chatService.sessions()"
  (sessionSelected)="onSessionSelected($event)"
  (closed)="closeSearchOverlay()"
/>
```

**Features**:

- Debounced search (300ms) by session name
- Date-grouped results (Today, Yesterday, Last 7 Days, Last 30 Days, Older)
- Virtual scrolling (CSS content-visibility) for 100+ sessions
- Empty states (no results, no sessions)
- Keyboard navigation (Escape to close)
- Focus trap and restoration
- Backdrop click to close
- Smooth animations (250ms)

**Responsive Behavior**:

- Desktop (≥1024px): Centered 800px max-width
- Tablet (768-1024px): Full-width with padding
- Mobile (<768px): Full-screen with reduced padding

**Accessibility**:

- WCAG 2.1 AA compliant
- role="dialog" with aria-modal
- Auto-focus on search input
- Focus trap implementation
- Escape key to close
- Touch targets ≥ 44x44px
- Color contrast ≥ 4.5:1

**Backend Integration**:

- Sessions from `chatService.sessions()` (all sessions)
- Recent sessions from `chatService.recentSessions()` (computed signal)
- Switch via `chatService.switchToSession(sessionId)`
- Create via `chatService.createNewSession()`

**Performance Optimization**:

- Virtual scrolling with CSS `content-visibility: auto`
- Debounced search input (300ms)
- Computed signals for filtering and grouping
- Effect-based focus management

## Dependencies

- `@ptah-extension/core`: ChatService, FilePickerService, etc.
- `@ptah-extension/shared`: Types
- `@ptah-extension/shared-ui`: DropdownComponent, ActionButtonComponent
- `@ptah-extension/providers`: ProviderManagerComponent

## Testing

```bash
nx test chat
```

## File Locations

- **Container**: `src/lib/containers/chat/`
- **Components**: `src/lib/components/*/`
- **Entry**: `src/index.ts`
