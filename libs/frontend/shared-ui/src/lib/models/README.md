# Shared UI Models & Types

**Library**: `@ptah-extension/shared-ui`  
**Purpose**: Type definitions for shared UI components

---

## Type Organization Strategy

### Types in This Library

Component-specific interfaces and types for:

1. **Component Input/Output Types** - Signal-based API contracts
2. **UI State Types** - Component-local state definitions
3. **Theme Types** - VS Code theme token mappings
4. **Validation Types** - Form validation states

### Types NOT in This Library

These belong in `@ptah-extension/shared`:

- Business domain types (`ChatMessage`, `Session`, etc.)
- VS Code extension types
- Backend service types
- Cross-boundary communication types

---

## Naming Conventions

### Component Input/Output Types

```typescript
// Component: ButtonComponent
export interface ButtonInputs {
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  isDisabled: boolean;
}

export interface ButtonOutputs {
  clicked: void;
  focused: void;
  blurred: void;
}
```

### UI State Types

```typescript
// Dropdown component state
export interface DropdownState {
  isOpen: boolean;
  searchQuery: string;
  highlightedIndex: number;
  selectedOption: DropdownOption | null;
}

export interface DropdownOption {
  id: string;
  label: string;
  value: unknown;
  isDisabled?: boolean;
}
```

### Theme Types

```typescript
export interface VSCodeThemeTokens {
  background: string;
  foreground: string;
  buttonBackground: string;
  buttonForeground: string;
  inputBackground: string;
  // ... etc
}

export type ThemeMode = 'light' | 'dark' | 'high-contrast';
```

### Validation Types

```typescript
export type ValidationState = 'valid' | 'invalid' | 'pending' | 'untouched';

export interface ValidationMessage {
  type: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
}
```

---

## File Organization

```text
models/
├── button.models.ts       # Button component types
├── dropdown.models.ts     # Dropdown component types
├── input.models.ts        # Input component types
├── theme.models.ts        # Theme-related types
├── validation.models.ts   # Validation types
└── index.ts               # Barrel export
```

---

## Type Reuse from @ptah-extension/shared

Always check `libs/shared/src/lib/types/` before creating new types:

```typescript
// Reuse existing types
import { ValidationState, DropdownOption } from '@ptah-extension/shared';

// Only create types specific to UI components
export interface InputComponentState {
  value: string;
  validationState: ValidationState; // Reuse from shared
  isFocused: boolean;
}
```

---

## Branded Types (Type Safety)

For component-specific IDs, use branded types:

```typescript
declare const __brand: unique symbol;
type Brand<T, TBrand> = T & { [__brand]: TBrand };

export type DropdownId = Brand<string, 'DropdownId'>;
export type InputId = Brand<string, 'InputId'>;

// Usage
const dropdownId: DropdownId = 'dropdown-1' as DropdownId;
```

---

## Immutable Types

All component input types should be immutable:

```typescript
// ✅ CORRECT: Readonly properties
export interface ButtonInputs {
  readonly label: string;
  readonly variant: 'primary' | 'secondary';
}

// ❌ INCORRECT: Mutable properties
export interface ButtonInputs {
  label: string; // Could be mutated
  variant: string; // Not type-safe
}
```

---

## Documentation

Every type should have JSDoc comments:

```typescript
/**
 * Configuration for dropdown component behavior
 */
export interface DropdownConfig {
  /**
   * Whether search is enabled in dropdown
   * @default false
   */
  readonly enableSearch: boolean;

  /**
   * Maximum height of dropdown menu in pixels
   * @default 300
   */
  readonly maxHeight: number;

  /**
   * Whether multi-select is enabled
   * @default false
   */
  readonly isMultiSelect: boolean;
}
```

---

## Current Types

**Status**: None yet (awaiting component extraction)

**Planned Types**:

- Button types (inputs, outputs, variants)
- Dropdown types (options, state, config)
- Input types (validation, state)
- Theme types (tokens, modes)
- Validation types (states, messages)

---

**Last Updated**: October 11, 2025  
**Type Count**: 0  
**Status**: Foundation setup complete, ready for type definitions
