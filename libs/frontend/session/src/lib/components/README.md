# Session Library - Components

**Library**: `@ptah-extension/session`  
**Purpose**: Session management UI components for Ptah extension webview

---

## 📂 Component Organization

All session-related components follow Angular 20+ standalone component patterns with signal-based APIs.

### Folder Structure

```
libs/frontend/session/src/lib/components/
├── session-selector/          # Session list and selection UI
│   ├── session-selector.component.ts
│   ├── session-selector.component.html
│   ├── session-selector.component.css
│   └── session-selector.component.spec.ts
├── session-card/              # Individual session display card
│   ├── session-card.component.ts
│   ├── session-card.component.html
│   ├── session-card.component.css
│   └── session-card.component.spec.ts
└── README.md (this file)
```

---

## 🎯 Component Inventory

### Container Components

**Managed in** `libs/frontend/session/src/lib/containers/`

1. **SessionManagerComponent**
   - **Purpose**: Orchestrates session list, creation, deletion, switching
   - **State**: Session list, active session, loading states
   - **Dependencies**: Core SessionService, VSCodeService
   - **Migration Status**: 🔄 Pending extraction from monolithic app

### Presentational Components

**Managed in this directory**

1. **SessionSelectorComponent**

   - **Purpose**: Display session list with search and filtering
   - **Inputs**: `sessions: Signal<Session[]>`, `activeSessionId: Signal<string>`
   - **Outputs**: `sessionSelected: OutputEmitterRef<string>`, `newSessionRequested: OutputEmitterRef<void>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~450

2. **SessionCardComponent**
   - **Purpose**: Individual session card with metadata and actions
   - **Inputs**: `session: Signal<Session>`, `isActive: Signal<boolean>`
   - **Outputs**: `sessionClicked: OutputEmitterRef<string>`, `deleteRequested: OutputEmitterRef<string>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~450

---

## 🚀 Modern Angular Patterns

### Signal-Based APIs

All components use modern signal APIs:

```typescript
import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';

@Component({
  selector: 'app-session-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
export class SessionCardComponent {
  // Modern signal inputs
  readonly session = input.required<Session>();
  readonly isActive = input<boolean>(false);

  // Modern signal outputs
  readonly sessionClicked = output<string>();
  readonly deleteRequested = output<string>();

  // Internal state
  readonly isHovered = signal<boolean>(false);

  // Computed values
  readonly displayTitle = computed(() => this.session().title || 'Untitled Session');
}
```

### Modern Control Flow

All templates use `@if`, `@for`, `@switch`:

```html
<!-- Modern control flow syntax -->
@if (isActive()) {
<div class="active-indicator">Active</div>
} @for (session of sessions(); track session.id) {
<app-session-card [session]="session" [isActive]="session.id === activeSessionId()" (sessionClicked)="onSessionSelect(session.id)" />
}
```

### OnPush Change Detection

All components require OnPush for performance:

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush, // MANDATORY
})
```

---

## 📝 Naming Conventions

### Component Selectors

- **Prefix**: `app-` (standard Angular convention)
- **Format**: `kebab-case`
- **Examples**: `app-session-selector`, `app-session-card`

### File Naming

- **Component**: `{name}.component.ts`
- **Template**: `{name}.component.html`
- **Styles**: `{name}.component.css`
- **Tests**: `{name}.component.spec.ts`

### Class Naming

- **Format**: `PascalCase` with `Component` suffix
- **Examples**: `SessionSelectorComponent`, `SessionCardComponent`

---

## 🧪 Testing Strategy

### Unit Tests

Each component has comprehensive unit tests:

```typescript
describe('SessionCardComponent', () => {
  it('should emit sessionClicked when card is clicked', () => {
    // Test signal-based outputs
    const component = harness.componentInstance;
    const emitSpy = jest.spyOn(component.sessionClicked, 'emit');

    component.onClick();

    expect(emitSpy).toHaveBeenCalledWith(component.session().id);
  });

  it('should compute displayTitle correctly', () => {
    // Test computed signals
    const component = harness.componentInstance;
    component.session.set({ id: '1', title: 'Test Session' });

    expect(component.displayTitle()).toBe('Test Session');
  });
});
```

### Coverage Requirements

- **Lines**: ≥80%
- **Branches**: ≥80%
- **Functions**: ≥80%
- **Statements**: ≥80%

---

## 🔄 Migration Checklist

When extracting components from monolithic app:

- [ ] Copy component files to appropriate library folder
- [ ] Convert `@Input()` → `input<T>()`
- [ ] Convert `@Output()` → `output<T>()`
- [ ] Convert `@ViewChild()` → `viewChild<T>()`
- [ ] Replace `*ngIf` → `@if`
- [ ] Replace `*ngFor` → `@for`
- [ ] Replace `*ngSwitch` → `@switch`
- [ ] Add `changeDetection: ChangeDetectionStrategy.OnPush`
- [ ] Update imports to use `@ptah-extension/shared` types
- [ ] Migrate component tests
- [ ] Export from `libs/frontend/session/src/index.ts`
- [ ] Update consuming components to import from `@ptah-extension/session`
- [ ] Verify `nx build frontend-session` succeeds
- [ ] Verify all tests pass with ≥80% coverage

---

## 📚 Related Documentation

- **Migration Guide**: `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `task-tracking/TASK_FE_001/implementation-plan.md`
- **Shared Types**: `libs/shared/src/lib/types/`

---

**Last Updated**: October 12, 2025  
**Components**: 2 presentational (SessionSelector, SessionCard)  
**Migration Status**: 🔄 Pending extraction from monolithic app
