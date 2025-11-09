# Shared UI Services

**Library**: `@ptah-extension/shared-ui`  
**Purpose**: UI-specific service patterns and utilities

---

## Service Organization

The shared-ui library focuses primarily on **presentational components**. Most business logic and state management belongs in the `core` library or feature-specific libraries.

### Services in Shared UI (Minimal)

Shared-ui services should ONLY handle:

1. **UI-specific utilities** (e.g., DOM measurements, scroll management)
2. **Animation coordination** (if complex animations needed)
3. **Theme token resolution** (mapping VS Code theme to component styles)

### ❌ Avoid in Shared UI

- Business logic (belongs in feature libraries)
- Data fetching (belongs in core services)
- State management (belongs in core/feature services)
- VS Code API calls (belongs in core services)

---

## Pattern: Signal-Based Services

If a service is needed in shared-ui, follow this pattern:

```typescript
import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeTokenService {
  // Private writable signal
  private readonly _currentTheme = signal<'light' | 'dark'>('light');

  // Public readonly signal
  readonly currentTheme = this._currentTheme.asReadonly();

  // Computed values
  readonly primaryColor = computed(() => (this.currentTheme() === 'light' ? '#007ACC' : '#0098FF'));

  // Mutations
  updateTheme(theme: 'light' | 'dark'): void {
    this._currentTheme.set(theme);
  }
}
```

---

## Testing Strategy

Services should have:

- Unit tests for all public methods
- Signal reactivity tests
- Computed value tests
- Effect tests (if used)

### Example Test

```typescript
describe('ThemeTokenService', () => {
  let service: ThemeTokenService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeTokenService);
  });

  it('should update primary color when theme changes', () => {
    service.updateTheme('dark');
    expect(service.primaryColor()).toBe('#0098FF');
  });
});
```

---

## Service Guidelines

### Single Responsibility

Each service should have ONE clear purpose:

- ✅ `ThemeTokenService` - Resolve VS Code theme tokens
- ✅ `ScrollManagerService` - Manage scroll positions
- ❌ `UIService` - Too broad, decompose into specific services

### Size Limits

- **Services**: < 200 lines
- **Methods**: < 30 lines

### Dependencies

Shared-ui services should:

- ✅ Import from `@angular/core`
- ✅ Import from `@ptah-extension/shared` (types only)
- ❌ Import from feature libraries (creates circular deps)
- ❌ Import from core services (invert dependency)

---

## Current Services

**Status**: None yet (awaiting feature extraction)

---

**Last Updated**: October 11, 2025  
**Service Count**: 0  
**Status**: Foundation setup complete
