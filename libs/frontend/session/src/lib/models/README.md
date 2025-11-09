# Session Library - Models

**Library**: `@ptah-extension/session`  
**Purpose**: Type definitions and interfaces for session UI components

---

## 📂 Type Organization

Session-related types follow a clear hierarchy of reuse:

### Type Reuse Strategy

1. **Use `@ptah-extension/shared` first** - Core domain types (Session, SessionInfo, etc.)
2. **Create component-specific types here** - UI-specific interfaces that extend shared types
3. **Export via library index** - Make types available to consuming components

---

## 🎯 Shared Types to Reuse

### From `@ptah-extension/shared`

```typescript
import { Session, SessionInfo, SessionMetadata } from '@ptah-extension/shared';

// These types are ALREADY defined in shared library
// DO NOT duplicate them here
```

**Available shared session types**:

- `Session` - Complete session object with messages
- `SessionInfo` - Session metadata without full message history
- `SessionMetadata` - Session creation/update timestamps and user info

**Import path**: `@ptah-extension/shared`

---

## 📝 Component-Specific Interfaces

Create types **in this library** only if:

1. **UI-Specific**: Type is exclusively for rendering session components
2. **Extends Shared Types**: Adds UI-specific properties to shared domain types
3. **Component APIs**: Signal input/output interfaces for session components

### Example: Session Component APIs

```typescript
// libs/frontend/session/src/lib/models/session-selector.models.ts
import { Session } from '@ptah-extension/shared';
import { Signal } from '@angular/core';

/**
 * Input signals for SessionSelectorComponent
 */
export interface SessionSelectorInputs {
  sessions: Signal<Session[]>;
  activeSessionId: Signal<string | null>;
  isLoading: Signal<boolean>;
}

/**
 * Output signals for SessionSelectorComponent
 */
export interface SessionSelectorOutputs {
  sessionSelected: string; // Session ID
  newSessionRequested: void;
  deleteSessionRequested: string; // Session ID
}

/**
 * UI state for session selector
 */
export interface SessionSelectorUIState {
  searchQuery: string;
  filterType: 'all' | 'recent' | 'starred';
  sortOrder: 'newest' | 'oldest' | 'alphabetical';
}
```

### Example: Session Card UI Models

```typescript
// libs/frontend/session/src/lib/models/session-card.models.ts
import { Session } from '@ptah-extension/shared';

/**
 * UI-specific display state for session card
 */
export interface SessionCardDisplayState {
  isExpanded: boolean;
  isHovered: boolean;
  showActions: boolean;
}

/**
 * Actions available on session card
 */
export type SessionCardAction = 'select' | 'delete' | 'rename' | 'duplicate' | 'export';

/**
 * Session card action event
 */
export interface SessionCardActionEvent {
  sessionId: string;
  action: SessionCardAction;
  metadata?: Record<string, unknown>;
}
```

---

## 🚀 Modern Angular Patterns

### Signal-Based Type Definitions

When defining component APIs, use signal types:

```typescript
import { Signal, OutputEmitterRef } from '@angular/core';

/**
 * Type-safe component inputs (signals)
 */
export interface SessionComponentInputs {
  data: Signal<Session>; // Readonly signal input
  config: Signal<SessionConfig>; // Readonly signal input
}

/**
 * Type-safe component outputs (signal emitters)
 */
export interface SessionComponentOutputs {
  itemSelected: OutputEmitterRef<string>; // Signal output
  actionTriggered: OutputEmitterRef<SessionCardActionEvent>; // Signal output
}
```

### Computed Value Types

```typescript
/**
 * Computed values derived from session state
 */
export interface SessionComputedValues {
  displayTitle: string;
  messageCount: number;
  formattedTimestamp: string;
  isActive: boolean;
}
```

---

## 📝 Naming Conventions

### Interface Naming

- **Component APIs**: `{ComponentName}Inputs`, `{ComponentName}Outputs`
- **UI State**: `{ComponentName}UIState`, `{ComponentName}DisplayState`
- **Events**: `{EventName}Event`
- **Enums**: `{Purpose}Type`, `{Purpose}Kind`

### File Naming

- **Format**: `{component-name}.models.ts`
- **Examples**: `session-selector.models.ts`, `session-card.models.ts`

### Export Strategy

All types are exported via library index:

```typescript
// libs/frontend/session/src/index.ts
export * from './lib/models/session-selector.models';
export * from './lib/models/session-card.models';
```

---

## 🔄 Type Reuse Checklist

Before creating a new type, verify:

- [ ] Type is NOT already in `@ptah-extension/shared`
- [ ] Type is UI-specific (not core domain logic)
- [ ] Type is used by multiple session components OR complex enough to warrant extraction
- [ ] Type extends/composes shared types appropriately
- [ ] Type follows signal-based API patterns

---

## 📚 Related Documentation

- **Shared Types**: `libs/shared/src/lib/types/`
- **Type Safety Guide**: `AGENTS.md` (Type/Schema Reuse Protocol)
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `task-tracking/TASK_FE_001/implementation-plan.md`

---

## 🎯 Current Status

**Types in this library**: 0 (pending component extraction)

**Expected types after migration**:

- `session-selector.models.ts` - SessionSelector component APIs
- `session-card.models.ts` - SessionCard component APIs

**All shared types**: Use `@ptah-extension/shared`

---

**Last Updated**: October 12, 2025  
**Type Files**: 0 (pending migration)  
**Shared Types Reused**: Session, SessionInfo, SessionMetadata
