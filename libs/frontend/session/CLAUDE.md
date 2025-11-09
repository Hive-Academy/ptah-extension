# libs/frontend/session - Session Management UI

## Purpose

Session management UI components for session selection, display, and lifecycle operations (create, switch, rename, delete, export).

## Components (3 total)

- **SessionManagerComponent** (`containers/session-manager/`): Smart container orchestrating sessions
- **SessionSelectorComponent** (`components/session-selector/`): Dropdown selector with quick create
- **SessionCardComponent** (`components/session-card/`): Individual session display with actions

## Quick Start

```typescript
import { SessionManagerComponent } from '@ptah-extension/session';

@Component({
  imports: [SessionManagerComponent],
})
export class AppComponent {
  sessionConfig = {
    displayMode: 'panel',
    showSessionCards: true,
    enableQuickActions: true,
    maxVisibleSessions: 12,
  };
}
```

## Session Actions

- **Switch**: Change active session
- **Rename**: Edit session name inline
- **Delete**: Remove session (confirmation)
- **Duplicate**: Copy session
- **Export**: Export to JSON/Markdown

## Signal Patterns

```typescript
// SessionCardComponent
readonly session = input.required<StrictChatSession>();
readonly isCurrent = input<boolean>(false);
readonly actionRequested = output<{ action: SessionAction['type']; session }>();

// Computed
readonly sessionStats = computed(() => ({
  messageCount: this.session().messageCount,
  tokenUsage: this.session().tokenUsage,
  timeAgo: this.getTimeAgo(this.session().lastActiveAt)
}));
```

## Dependencies

- `@ptah-extension/core`: ChatService, VSCodeService, etc.
- `@ptah-extension/shared`: StrictChatSession, SessionId

## Testing

```bash
nx test session
```

## File Locations

- **Container**: `src/lib/containers/session-manager/`
- **Components**: `src/lib/components/*/`
- **Entry**: `src/index.ts`
