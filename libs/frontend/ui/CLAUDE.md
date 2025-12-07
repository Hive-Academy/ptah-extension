# libs/frontend/ui - Shared UI Components with CDK Overlay

## Purpose

The **ui library** provides reusable, accessible UI components built on Angular CDK Overlay and A11y modules. It solves keyboard navigation issues in overlay components by rendering dropdowns, popovers, and autocomplete panels in CDK portals outside the component DOM tree.

## Key Responsibilities

- **Overlay Components**: Dropdown, Popover for floating UI elements
- **Selection Components**: Option, Autocomplete for keyboard-navigable lists
- **Portal Rendering**: All overlays render at document body level via CDK Overlay
- **Keyboard Navigation**: ActiveDescendantKeyManager integration for accessibility
- **Focus Management**: FocusTrap for modal-like popovers, focus return on close
- **Accessibility**: WCAG 2.1 Level AA compliant with ARIA patterns

## Architecture

```
libs/frontend/ui/src/lib/
├── overlays/                    # DOMAIN: Floating UI Elements
│   ├── dropdown/                # Simple trigger-based dropdown
│   │   ├── dropdown.component.ts
│   │   └── index.ts
│   ├── popover/                 # Modal-like popover with focus trap
│   │   ├── popover.component.ts
│   │   └── index.ts
│   └── shared/                  # Shared overlay utilities
│       ├── overlay-positions.ts # Reusable position configs
│       ├── overlay.types.ts     # Shared type definitions
│       └── index.ts
│
└── selection/                   # DOMAIN: Selection UI Components
    ├── option/                  # Generic selectable option
    │   ├── option.component.ts  # Implements Highlightable
    │   └── index.ts
    └── autocomplete/            # Input-triggered suggestions
        ├── autocomplete.component.ts
        ├── autocomplete.directive.ts
        └── index.ts
```

## Core Components

### 1. OptionComponent

**File**: `selection/option/option.component.ts`

Generic selectable option component implementing Highlightable interface for ActiveDescendantKeyManager compatibility.

#### Features

- Implements Highlightable interface from @angular/cdk/a11y
- Automatic scroll-into-view on keyboard navigation
- Visual active state with DaisyUI classes
- Content projection for custom layouts
- Generic type parameter for any value type

#### Usage

```typescript
import { OptionComponent } from '@ptah-extension/ui/selection';

@Component({
  template: `
    <ptah-dropdown [isOpen]="isOpen()">
      <button trigger (click)="toggleDropdown()">Select Model</button>

      <div content>
        @for (model of models(); track model.id; let i = $index) {
        <ptah-option [optionId]="'model-' + i" [value]="model" (selected)="selectModel($event)">
          <div class="flex items-center gap-2">
            <span>{{ model.name }}</span>
            @if (model.isRecommended) {
            <span class="badge badge-primary badge-xs">Recommended</span>
            }
          </div>
        </ptah-option>
        }
      </div>
    </ptah-dropdown>
  `,
  imports: [DropdownComponent, OptionComponent],
})
export class ModelSelectorComponent {}
```

#### API

```typescript
@Component({
  selector: 'ptah-option',
  standalone: true,
})
export class OptionComponent<T = unknown> implements Highlightable {
  // Inputs
  readonly optionId = input.required<string>();
  readonly value = input.required<T>();

  // Outputs
  readonly selected = output<T>();
  readonly hovered = output<void>();

  // Highlightable interface (managed by ActiveDescendantKeyManager)
  isActive: boolean;
  setActiveStyles(): void;
  setInactiveStyles(): void;
}
```

---

### 2. DropdownComponent

**File**: `overlays/dropdown/dropdown.component.ts`

Simple dropdown wrapper around CDK Overlay with backdrop and positioning support.

#### Features

- Portal rendering via cdkConnectedOverlay (renders at body level)
- Automatic positioning with fallback strategies
- Backdrop click-outside detection
- Configurable close behavior
- Signal-based open/close state

#### Usage

```typescript
import { DropdownComponent } from '@ptah-extension/ui/overlays';

@Component({
  template: `
    <ptah-dropdown [isOpen]="isOpen()" [closeOnBackdropClick]="true" (backdropClicked)="closeDropdown()" (closed)="closeDropdown()">
      <button trigger (click)="toggleDropdown()">Open Menu</button>

      <div content class="w-80">
        <!-- Dropdown content -->
      </div>
    </ptah-dropdown>
  `,
  imports: [DropdownComponent],
})
export class MyComponent {
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeDropdown(): void {
    this._isOpen.set(false);
  }
}
```

#### API

```typescript
@Component({
  selector: 'ptah-dropdown',
  standalone: true,
})
export class DropdownComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly positions = input<ConnectedPosition[]>(DROPDOWN_POSITIONS);
  readonly hasBackdrop = input(true);
  readonly backdropClass = input<BackdropClass>('cdk-overlay-transparent-backdrop');
  readonly closeOnBackdropClick = input(true);

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();
}
```

---

### 3. PopoverComponent

**File**: `overlays/popover/popover.component.ts`

Modal-like popover with dark backdrop and focus trap for keyboard accessibility.

#### Features

- Portal rendering via cdkConnectedOverlay
- FocusTrap from @angular/cdk/a11y (traps focus within popover)
- Focus return to trigger element on close
- Escape key closes popover
- 4 position preferences (above, below, before, after)

#### Usage

```typescript
import { PopoverComponent } from '@ptah-extension/ui/overlays';

@Component({
  template: `
    <ptah-popover [isOpen]="isOpen()" [position]="'above'" [hasBackdrop]="true" [backdropClass]="'cdk-overlay-dark-backdrop'" (closed)="closePopover()">
      <button trigger (click)="togglePopover()">Settings</button>

      <div content class="w-80 p-4">
        <h3 class="text-lg font-semibold">Settings</h3>
        <button (click)="save()">Save</button>
        <button (click)="cancel()">Cancel</button>
      </div>
    </ptah-popover>
  `,
  imports: [PopoverComponent],
})
export class SettingsComponent {
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  togglePopover(): void {
    this._isOpen.set(!this._isOpen());
  }

  closePopover(): void {
    this._isOpen.set(false);
  }
}
```

#### API

```typescript
@Component({
  selector: 'ptah-popover',
  standalone: true,
})
export class PopoverComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly position = input<OverlayPosition>('below');
  readonly hasBackdrop = input(true);
  readonly backdropClass = input<BackdropClass>('cdk-overlay-transparent-backdrop');

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();
}
```

---

### 4. AutocompleteComponent

**File**: `selection/autocomplete/autocomplete.component.ts`

Input-triggered autocomplete with ActiveDescendantKeyManager for keyboard navigation.

#### Features

- Portal rendering (solves textarea keyboard interception!)
- ActiveDescendantKeyManager integration (focus stays on input)
- Custom suggestion templates via content projection
- Loading and empty states
- Generic type parameter for any suggestion type

#### Usage

```typescript
import { AutocompleteComponent, AutocompleteDirective } from '@ptah-extension/ui/selection';

@Component({
  template: `
    <ptah-autocomplete [suggestions]="suggestions()" [isLoading]="isLoading()" [isOpen]="isOpen()" [headerTitle]="'Files'" (suggestionSelected)="insertSuggestion($event)" (closed)="closeSuggestions()">
      <input autocompleteInput type="text" [(ngModel)]="query" (input)="onInput($event)" />

      <ng-template suggestionTemplate let-suggestion>
        <div class="flex items-center gap-2">
          <span>{{ suggestion.icon }}</span>
          <span>{{ suggestion.name }}</span>
        </div>
      </ng-template>
    </ptah-autocomplete>
  `,
  imports: [AutocompleteComponent, AutocompleteDirective],
})
export class FilePickerComponent {
  private readonly _suggestions = signal<FileSuggestion[]>([]);
  readonly suggestions = this._suggestions.asReadonly();

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  onInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    // Fetch suggestions based on query
    this._suggestions.set(filteredSuggestions);
    this._isOpen.set(true);
  }

  insertSuggestion(suggestion: FileSuggestion): void {
    // Insert selected suggestion
    this._isOpen.set(false);
  }

  closeSuggestions(): void {
    this._isOpen.set(false);
  }
}
```

#### API

```typescript
@Component({
  selector: 'ptah-autocomplete',
  standalone: true,
})
export class AutocompleteComponent<T = unknown> {
  // Inputs
  readonly suggestions = input.required<T[]>();
  readonly isLoading = input(false);
  readonly isOpen = input.required<boolean>();
  readonly headerTitle = input<string>('');
  readonly ariaLabel = input('Suggestions');
  readonly emptyMessage = input('No matches found');
  readonly trackBy = input<(index: number, item: T) => string | number>((index) => index);

  // Outputs
  readonly suggestionSelected = output<T>();
  readonly closed = output<void>();

  // Public API (called by parent for keyboard navigation)
  onKeyDown(event: KeyboardEvent): boolean;
  selectFocused(): void;
  getActiveDescendantId(): string | null;
}
```

---

### 5. AutocompleteDirective

**File**: `selection/autocomplete/autocomplete.directive.ts`

Simple directive to mark the input element for AutocompleteComponent integration.

#### Usage

```typescript
<input autocompleteInput type="text" />
```

#### API

```typescript
@Directive({
  selector: '[autocompleteInput]',
  standalone: true,
})
export class AutocompleteDirective {
  readonly elementRef = inject(ElementRef<HTMLInputElement>);
}
```

---

## Shared Utilities

### Overlay Positions

**File**: `overlays/shared/overlay-positions.ts`

Pre-configured position strategies for consistent overlay placement.

```typescript
import { DROPDOWN_POSITIONS, AUTOCOMPLETE_POSITIONS, POPOVER_POSITION_MAP } from '@ptah-extension/ui/overlays';

// Dropdown positions (below first, above fallback)
const dropdown = DROPDOWN_POSITIONS;
// [
//   { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
//   { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
// ]

// Autocomplete positions (match input width)
const autocomplete = AUTOCOMPLETE_POSITIONS;
// [
//   { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
//   { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
// ]

// Popover position map (4 directions)
const popoverAbove = POPOVER_POSITION_MAP.above;
const popoverBelow = POPOVER_POSITION_MAP.below;
const popoverBefore = POPOVER_POSITION_MAP.before;
const popoverAfter = POPOVER_POSITION_MAP.after;
```

### Overlay Types

**File**: `overlays/shared/overlay.types.ts`

```typescript
export type OverlayPosition = 'above' | 'below' | 'before' | 'after';
export type BackdropClass = 'cdk-overlay-transparent-backdrop' | 'cdk-overlay-dark-backdrop';
```

---

## Migration Guide

### Migrating from DropdownInteractionService

**TASK_2025_046 created DropdownInteractionService as a temporary fix for dropdown keyboard navigation. It is now superseded by CDK Overlay portal rendering which solves the root cause (textarea event interception).**

#### Problem Statement

When dropdowns are rendered inside the component DOM tree (using `@if` conditional rendering), keyboard events flow through parent elements (like textarea) BEFORE reaching the dropdown handler. This causes:

- ArrowUp/ArrowDown moves cursor in textarea instead of navigating dropdown
- Enter inserts newline instead of selecting option
- Escape propagates to parent handlers

#### Root Cause

DropdownInteractionService attempted to solve this with capture-phase document listeners, but this is a band-aid. The real issue is **structural**: dropdown rendered INSIDE component hierarchy.

#### Solution: CDK Overlay Portal Rendering

CDK Overlay renders dropdowns in a portal at document body level, OUTSIDE the component DOM tree. This means keyboard events never flow through parent textarea/input elements.

```
BEFORE (DropdownInteractionService):
document → ... → textarea (intercepts ArrowDown) → dropdown handler (too late!)

AFTER (CDK Overlay):
document → cdk-overlay-container (at body level, no textarea in path) → dropdown handler ✅
```

#### Migration Steps

##### Step 1: Replace DropdownInteractionService with DropdownComponent

**Before**:

```typescript
import { DropdownInteractionService } from '@ptah-extension/core';

export class AgentSelectorComponent {
  private readonly dropdownService = inject(DropdownInteractionService);
  private readonly elementRef = inject(ElementRef);
  private readonly injector = inject(Injector);

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  constructor() {
    this.dropdownService.autoManageListeners(this.injector, {
      isOpenSignal: this.isOpen,
      elementRef: this.elementRef,
      onClickOutside: () => this._isOpen.set(false),
      keyboardNav: {
        onArrowDown: () => this.navigateDown(),
        onArrowUp: () => this.navigateUp(),
        onEnter: () => this.selectFocused(),
        onEscape: () => this._isOpen.set(false),
      },
    });
  }

  navigateDown(): void {
    /* manual focus tracking */
  }
  navigateUp(): void {
    /* manual focus tracking */
  }
  selectFocused(): void {
    /* manual selection */
  }
}
```

**After**:

```typescript
import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';

export class AgentSelectorComponent {
  // DropdownInteractionService removed - CDK Overlay handles everything!

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeDropdown(): void {
    this._isOpen.set(false);
  }

  selectAgent(agent: Agent): void {
    // Handle selection
    this._isOpen.set(false);
  }
}

// Template
@Component({
  template: `
    <ptah-dropdown
      [isOpen]="isOpen()"
      [closeOnBackdropClick]="true"
      (closed)="closeDropdown()">

      <button trigger (click)="toggleDropdown()">Agents</button>

      <div content>
        @for (agent of agents(); track agent.name; let i = $index) {
          <ptah-option
            [optionId]="'agent-' + i"
            [value]="agent"
            (selected)="selectAgent($event)">
            {{ agent.name }}
          </ptah-option>
        }
      </div>
    </ptah-dropdown>
  `,
  imports: [DropdownComponent, OptionComponent],
})
```

**Benefits**:

- ❌ No manual keyboard navigation methods
- ❌ No manual focus tracking
- ❌ No document listeners (CDK Overlay backdrop handles click-outside)
- ✅ OptionComponent provides keyboard nav automatically
- ✅ ~50% LOC reduction

##### Step 2: Replace DaisyUI Dropdown with DropdownComponent

**Before**:

```typescript
@Component({
  template: `
    <div class="dropdown dropdown-top dropdown-end">
      <button tabindex="0">{{ currentModel }}</button>
      <div tabindex="0" class="dropdown-content">
        <!-- Dropdown items -->
      </div>
    </div>
  `,
})
export class ModelSelectorComponent {
  closeDropdown(): void {
    const activeElement = document.activeElement as HTMLElement;
    activeElement?.blur(); // Manual blur() to close dropdown
  }
}
```

**After**:

```typescript
@Component({
  template: `
    <ptah-dropdown [isOpen]="isOpen()" (closed)="closeDropdown()">
      <button trigger (click)="toggleDropdown()">{{ currentModel }}</button>

      <div content>
        @for (model of models(); track model.id; let i = $index) {
        <ptah-option [optionId]="'model-' + i" [value]="model" (selected)="selectModel($event)">
          {{ model.name }}
        </ptah-option>
        }
      </div>
    </ptah-dropdown>
  `,
  imports: [DropdownComponent, OptionComponent],
})
export class ModelSelectorComponent {
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeDropdown(): void {
    this._isOpen.set(false); // No manual blur() needed!
  }
}
```

**Benefits**:

- ❌ No DaisyUI dropdown classes
- ❌ No manual blur() logic
- ✅ Keyboard navigation added (was missing before!)
- ✅ CDK Overlay backdrop handles close

##### Step 3: Replace DaisyUI Dropdown with PopoverComponent (Modal UX)

For modal-like dropdowns (autopilot settings, confirmation dialogs), use PopoverComponent with dark backdrop.

**Before**:

```typescript
@Component({
  template: `
    <div class="dropdown dropdown-top dropdown-end">
      <button tabindex="0">Autopilot</button>
      <div tabindex="0" class="dropdown-content">
        <!-- Settings -->
      </div>
    </div>
  `,
})
export class AutopilotPopoverComponent {}
```

**After**:

```typescript
@Component({
  template: `
    <ptah-popover [isOpen]="isOpen()" [position]="'above'" [hasBackdrop]="true" [backdropClass]="'cdk-overlay-dark-backdrop'" (closed)="closePopover()">
      <button trigger (click)="togglePopover()">Autopilot</button>

      <div content class="w-80 p-4">
        <!-- Settings with keyboard nav -->
        @for (level of permissionLevels; track level.id; let i = $index) {
        <ptah-option [optionId]="'level-' + i" [value]="level" (selected)="selectLevel($event)">
          {{ level.name }}
        </ptah-option>
        }
      </div>
    </ptah-popover>
  `,
  imports: [PopoverComponent, OptionComponent],
})
export class AutopilotPopoverComponent {}
```

**Benefits**:

- ✅ Dark backdrop (modal-like UX)
- ✅ Focus trap (keyboard accessibility)
- ✅ Keyboard navigation for permission levels (NEW FEATURE!)
- ✅ Focus returns to trigger on close

---

## Import Patterns

### Domain-Level Imports (Recommended)

```typescript
import { DropdownComponent, PopoverComponent } from '@ptah-extension/ui/overlays';
import { OptionComponent, AutocompleteComponent } from '@ptah-extension/ui/selection';
```

### Component-Level Imports (Tree-Shaking)

```typescript
import { DropdownComponent } from '@ptah-extension/ui/overlays/dropdown';
import { AutocompleteComponent } from '@ptah-extension/ui/selection/autocomplete';
```

### Full Library Import (Not Recommended)

```typescript
import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';
// Larger bundle - imports everything
```

---

## Dependencies

**Internal**:

- None (shared UI components, no internal library dependencies)

**External**:

- `@angular/core` (^20.1.2): Component framework
- `@angular/common` (^20.1.2): NgTemplateOutlet, NgFor, NgIf
- `@angular/cdk/overlay` (^20.2.14): Portal rendering, positioning
- `@angular/cdk/a11y` (^20.2.14): ActiveDescendantKeyManager, Highlightable, FocusTrap

---

## Testing

```bash
nx test ui               # Run unit tests
nx build ui              # Build to ESM
nx typecheck ui          # Type-check library
```

**Framework**: Jest with ts-jest transformer
**Coverage Target**: 80% minimum

---

## Critical Design Decisions

1. **Portal Rendering**: All overlays render at body level via CDK Overlay (solves keyboard interception)
2. **ActiveDescendantKeyManager**: Focus stays on input element, ARIA pattern for accessibility
3. **Composition Over Configuration**: Content projection for maximum flexibility
4. **Signal-Based**: Angular 20+ signals for reactive state management
5. **DaisyUI Styling**: All components use DaisyUI classes for theming consistency
6. **Generic Type Parameters**: Components work with any data type
7. **Domain-Based Organization**: overlays/ and selection/ domains for future extensibility

---

## Integration Points

**Consumed By**:

- `libs/frontend/chat` - UnifiedSuggestionsDropdown, AgentSelector, ModelSelector, AutopilotPopover
- Any frontend library needing dropdown/popover/autocomplete UI

**Depends On**:

- `@angular/cdk/overlay` - Portal rendering infrastructure
- `@angular/cdk/a11y` - Keyboard navigation and focus management

---

## File Paths Reference

- **Overlays**: `src/lib/overlays/dropdown/`, `src/lib/overlays/popover/`
- **Selection**: `src/lib/selection/option/`, `src/lib/selection/autocomplete/`
- **Shared**: `src/lib/overlays/shared/`
- **Entry Point**: `src/index.ts`
