# Session Library - Services

**Library**: `@ptah-extension/frontend/session`  
**Purpose**: Session management services (if any session-specific logic is needed)

---

## 📂 Service Organization

Currently, session services are managed in the **Core Library** (`@ptah-extension/frontend/core`).

### Architectural Decision

Session management services are **NOT** placed in this feature library because:

1. **Cross-Feature Dependency**: Sessions are used across multiple features (chat, analytics, dashboard)
2. **Core Infrastructure**: Session state is foundational infrastructure, not feature-specific
3. **Dependency Rule**: Feature libraries should not depend on each other (SOLID - Dependency Inversion)

### Where Session Services Live

- **Location**: `libs/frontend/core/src/lib/services/`
- **Import Path**: `@ptah-extension/frontend/core`

**Example Services**:

- `SessionStateService` - Manages active session, session list, session switching
- `SessionPersistenceService` - Handles session storage and restoration

---

## 🎯 When to Create Session-Specific Services

Create services **in this library** only if:

1. **Session-Specific UI Logic**: Business logic that is exclusively about rendering session UI components (not core session management)
2. **Component Helper Services**: Utilities that help session components but are not used by other features
3. **Isolated Responsibilities**: Logic that can be tested independently of core session state

**Example of session-specific service** (if needed in future):

```typescript
// libs/frontend/session/src/lib/services/session-ui-formatter.service.ts
import { Injectable, inject } from '@angular/core';
import { SessionStateService } from '@ptah-extension/frontend/core';

/**
 * Formats session data for UI display purposes only
 * (Not core business logic, just presentation helpers)
 */
@Injectable({ providedIn: 'root' })
export class SessionUIFormatterService {
  private readonly sessionState = inject(SessionStateService);

  /**
   * Format session title for card display
   */
  formatSessionTitle(session: Session): string {
    // UI-specific formatting logic
    return session.title || `Session ${session.id.substring(0, 8)}...`;
  }

  /**
   * Format session timestamp for display
   */
  formatTimestamp(timestamp: Date): string {
    // UI-specific time formatting
    return timestamp.toLocaleDateString();
  }
}
```

---

## 🚀 Modern Angular Patterns

If you do create services in this library, follow these patterns:

### Signal-Based State Management

```typescript
import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SessionUIStateService {
  // Private writable signal
  private readonly _expandedSessions = signal<Set<string>>(new Set());

  // Public readonly signal
  readonly expandedSessions = this._expandedSessions.asReadonly();

  // Computed values
  readonly expandedCount = computed(() => this._expandedSessions().size);

  // State mutations
  toggleSession(sessionId: string): void {
    this._expandedSessions.update((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }
}
```

### Dependency Injection with inject()

```typescript
import { Injectable, inject } from '@angular/core';
import { SessionStateService } from '@ptah-extension/frontend/core';

@Injectable({ providedIn: 'root' })
export class MySessionService {
  // Modern inject() function instead of constructor injection
  private readonly sessionState = inject(SessionStateService);
  private readonly logger = inject(LoggingService);

  // No constructor needed for simple DI
}
```

---

## 📝 Naming Conventions

### Service Class Names

- **Format**: `PascalCase` with `Service` suffix
- **Examples**: `SessionUIFormatterService`, `SessionUIStateService`

### File Naming

- **Service**: `{name}.service.ts`
- **Tests**: `{name}.service.spec.ts`

---

## 🧪 Testing Strategy

### Unit Tests

Each service should have comprehensive unit tests:

```typescript
describe('SessionUIFormatterService', () => {
  let service: SessionUIFormatterService;

  beforeEach(() => {
    service = TestBed.inject(SessionUIFormatterService);
  });

  it('should format session title correctly', () => {
    const session = { id: 'abc123', title: 'My Session' };
    expect(service.formatSessionTitle(session)).toBe('My Session');
  });

  it('should handle untitled sessions', () => {
    const session = { id: 'abc123def456', title: '' };
    expect(service.formatSessionTitle(session)).toBe('Session abc123de...');
  });
});
```

### Coverage Requirements

- **Lines**: ≥80%
- **Branches**: ≥80%
- **Functions**: ≥80%
- **Statements**: ≥80%

---

## 🔄 Current Status

**Services in this library**: 0

**Reason**: All session management logic is in `@ptah-extension/frontend/core` to maintain proper dependency boundaries.

---

## 📚 Related Documentation

- **Core Services**: `libs/frontend/core/src/lib/services/README.md`
- **Migration Guide**: `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `task-tracking/TASK_FE_001/implementation-plan.md`

---

**Last Updated**: October 12, 2025  
**Services**: 0 (all session logic in core library)  
**Migration Status**: N/A
