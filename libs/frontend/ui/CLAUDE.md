# libs/frontend/ui - Shared UI Components

## Purpose

The **ui library** provides reusable, accessible UI components for overlay and selection patterns. It contains both CDK-based components (deprecated) and native Floating UI-based components (recommended).

## Key Responsibilities

- **Overlay Components**: Dropdown, Popover for floating UI elements
- **Selection Components**: Option, Autocomplete for keyboard-navigable lists
- **Native Components**: CDK-free alternatives using Floating UI + signal-based navigation
- **Keyboard Navigation**: Signal-based navigation service (native) and ActiveDescendantKeyManager (deprecated)
- **Focus Management**: Native focus store/restore (native) and FocusTrap (deprecated)
- **Accessibility**: WCAG 2.1 Level AA compliant with ARIA patterns

## Architecture

```
libs/frontend/ui/src/lib/
├── native/                      # RECOMMENDED: No CDK dependencies
│   ├── shared/                  # Core services
│   │   ├── floating-ui.service.ts      # Floating UI positioning wrapper
│   │   ├── keyboard-navigation.service.ts # Signal-based navigation
│   │   └── index.ts
│   ├── option/                  # Signal-based option component
│   │   ├── native-option.component.ts
│   │   └── index.ts
│   ├── dropdown/                # Floating UI dropdown
│   │   ├── native-dropdown.component.ts
│   │   └── index.ts
│   ├── popover/                 # Native focus management popover
│   │   ├── native-popover.component.ts
│   │   └── index.ts
│   ├── autocomplete/            # Complete autocomplete solution
│   │   ├── native-autocomplete.component.ts
│   │   └── index.ts
│   └── index.ts                 # Barrel export
│
├── overlays/                    # DEPRECATED: CDK-based components
│   ├── dropdown/                # CDK Overlay dropdown
│   │   ├── dropdown.component.ts
│   │   └── index.ts
│   ├── popover/                 # CDK Overlay + FocusTrap popover
│   │   ├── popover.component.ts
│   │   └── index.ts
│   └── shared/                  # Shared overlay utilities
│       ├── overlay-positions.ts
│       ├── overlay.types.ts
│       └── index.ts
│
└── selection/                   # DEPRECATED: CDK A11y-based components
    ├── option/                  # Highlightable-based option
    │   ├── option.component.ts
    │   └── index.ts
    └── autocomplete/            # ActiveDescendantKeyManager autocomplete
        ├── autocomplete.component.ts
        ├── autocomplete.directive.ts
        └── index.ts
```

---

## Native Components (Recommended)

Native components use Floating UI for positioning and Angular signals for state management.
**These are the recommended components for VS Code webview environments.**

### 1. FloatingUIService

**File**: `native/shared/floating-ui.service.ts`

Lightweight positioning service using `@floating-ui/dom`. Replaces CDK Overlay positioning.

#### Features

- Viewport-aware positioning with flip/shift middleware
- Auto-updates on scroll/resize via autoUpdate()
- Automatic cleanup on component destroy via DestroyRef
- No portal rendering (content stays in component DOM)

#### Usage

```typescript
import { FloatingUIService, FloatingUIOptions } from '@ptah-extension/ui';

@Component({
  providers: [FloatingUIService], // Provide at component level
})
export class MyDropdownComponent {
  private readonly floatingUI = inject(FloatingUIService);

  async openDropdown(): Promise<void> {
    await this.floatingUI.position(triggerEl, floatingEl, {
      placement: 'bottom-start',
      offset: 8,
      flip: true,
      shift: true,
    });
  }

  closeDropdown(): void {
    this.floatingUI.cleanup();
  }
}
```

#### API

```typescript
interface FloatingUIOptions {
  placement?: Placement; // 'bottom-start', 'top', 'right', etc.
  offset?: number; // Distance from trigger (default: 8)
  flip?: boolean; // Flip when constrained (default: true)
  shift?: boolean; // Shift along axis (default: true)
  shiftPadding?: number; // Padding from viewport edge (default: 8)
}

class FloatingUIService {
  position(referenceEl: HTMLElement, floatingEl: HTMLElement, options?: FloatingUIOptions): Promise<void>;
  cleanup(): void;
}
```

---

### 2. KeyboardNavigationService

**File**: `native/shared/keyboard-navigation.service.ts`

Signal-based keyboard navigation for list components. Replaces CDK ActiveDescendantKeyManager.

#### Features

- Uses Angular signals (not RxJS BehaviorSubject)
- No Highlightable interface required
- Parent component controls active state via activeIndex signal
- Supports ArrowUp/Down/Home/End keys with wrap-around
- Supports horizontal/vertical orientation

#### Usage

```typescript
import { KeyboardNavigationService, KeyboardNavigationConfig } from '@ptah-extension/ui';

@Component({
  providers: [KeyboardNavigationService],
})
export class MyListComponent {
  private readonly keyboardNav = inject(KeyboardNavigationService);
  readonly activeIndex = this.keyboardNav.activeIndex;

  constructor() {
    // Configure when items change
    effect(() => {
      this.keyboardNav.configure({
        itemCount: this.items().length,
        wrap: true,
      });
    });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (this.keyboardNav.handleKeyDown(event)) {
      event.preventDefault();
    }
  }

  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
```

#### API

```typescript
interface KeyboardNavigationConfig {
  itemCount: number;
  wrap?: boolean; // Wrap at ends (default: true)
  horizontal?: boolean; // Use Left/Right instead of Up/Down (default: false)
}

class KeyboardNavigationService {
  readonly activeIndex: Signal<number>; // -1 = no active item

  configure(config: KeyboardNavigationConfig): void;
  handleKeyDown(event: KeyboardEvent): boolean; // Returns true if handled
  setActiveIndex(index: number): void;
  setNext(wrap?: boolean): void;
  setPrevious(wrap?: boolean): void;
  setFirstItemActive(): void;
  setLastItemActive(): void;
  reset(): void;
}
```

---

### 3. NativeOptionComponent

**File**: `native/option/native-option.component.ts`

Generic selectable option with signal-based active state. Replaces CDK Highlightable-based OptionComponent.

#### Features

- **isActive is an INPUT signal** (parent controls, not self-managed)
- No Highlightable interface required
- Content projection for custom layouts
- ARIA role="option" with aria-selected
- DaisyUI classes for VS Code theme compatibility

#### Key Difference from CDK OptionComponent

```typescript
// CDK Pattern (DEPRECATED): Active state managed internally
// Component implements Highlightable interface
setActiveStyles(): void; // Called by ActiveDescendantKeyManager
setInactiveStyles(): void;

// Native Pattern (RECOMMENDED): Active state as input
readonly isActive = input<boolean>(false); // Parent passes this!
// Parent: [isActive]="i === activeIndex()"
```

#### Usage

```typescript
import { NativeOptionComponent } from '@ptah-extension/ui';

@Component({
  template: `
    @for (item of items(); track item.id; let i = $index) {
    <ptah-native-option [optionId]="'item-' + i" [value]="item" [isActive]="i === activeIndex()" (selected)="selectItem($event)" (hovered)="onHover(i)">
      {{ item.name }}
    </ptah-native-option>
    }
  `,
  imports: [NativeOptionComponent],
})
export class MyListComponent {
  readonly activeIndex = this.keyboardNav.activeIndex;

  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
```

#### API

```typescript
@Component({ selector: 'ptah-native-option' })
export class NativeOptionComponent<T = unknown> {
  // Inputs
  readonly optionId = input.required<string>(); // Required for ARIA
  readonly value = input.required<T>();
  readonly isActive = input<boolean>(false); // PARENT CONTROLS THIS

  // Outputs
  readonly selected = output<T>(); // Emitted on click
  readonly hovered = output<void>(); // Emitted on mouseenter

  // Methods
  scrollIntoView(): void; // Called by parent when active via keyboard
  getHostElement(): HTMLElement;
}
```

---

### 4. NativeDropdownComponent

**File**: `native/dropdown/native-dropdown.component.ts`

Dropdown container using Floating UI for positioning. Replaces CDK DropdownComponent.

#### Features

- Floating UI positioning (not CDK Overlay portal)
- Native backdrop element for click-outside detection
- Configurable backdrop appearance (transparent/dark)
- Content projection: [trigger] and [content] slots

#### Usage

```typescript
import { NativeDropdownComponent, NativeOptionComponent } from '@ptah-extension/ui';

@Component({
  template: `
    <ptah-native-dropdown [isOpen]="isOpen()" [placement]="'bottom-start'" [closeOnBackdropClick]="true" (closed)="closeDropdown()">
      <button trigger (click)="toggleDropdown()">Open Menu</button>

      <div content>
        @for (item of items(); track item.id; let i = $index) {
        <ptah-native-option [optionId]="'item-' + i" [value]="item" [isActive]="i === activeIndex()" (selected)="selectItem($event)">
          {{ item.name }}
        </ptah-native-option>
        }
      </div>
    </ptah-native-dropdown>
  `,
  imports: [NativeDropdownComponent, NativeOptionComponent],
})
export class MyDropdownComponent {}
```

#### API

```typescript
@Component({ selector: 'ptah-native-dropdown' })
export class NativeDropdownComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly placement = input<Placement>('bottom-start');
  readonly offset = input<number>(8);
  readonly hasBackdrop = input<boolean>(true);
  readonly backdropClass = input<'transparent' | 'dark'>('transparent');
  readonly closeOnBackdropClick = input<boolean>(true);

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();
}
```

---

### 5. NativePopoverComponent

**File**: `native/popover/native-popover.component.ts`

Modal-like popover with native focus management. Replaces CDK PopoverComponent + FocusTrap.

#### Features

- Floating UI positioning
- Native focus management (stores/restores previous focus)
- Escape key closes and returns focus
- Dark backdrop for modal-like UX
- No CDK FocusTrap dependency

#### Usage

```typescript
import { NativePopoverComponent } from '@ptah-extension/ui';

@Component({
  template: `
    <ptah-native-popover [isOpen]="isOpen()" [placement]="'bottom'" [hasBackdrop]="true" [backdropClass]="'dark'" (closed)="closePopover()">
      <button trigger (click)="togglePopover()">Settings</button>

      <div content class="p-4">
        <h3>Settings Panel</h3>
        <button (click)="save()">Save</button>
        <button (click)="cancel()">Cancel</button>
      </div>
    </ptah-native-popover>
  `,
  imports: [NativePopoverComponent],
})
export class SettingsComponent {}
```

#### API

```typescript
@Component({ selector: 'ptah-native-popover' })
export class NativePopoverComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly placement = input<Placement>('bottom');
  readonly offset = input<number>(8);
  readonly hasBackdrop = input<boolean>(true);
  readonly backdropClass = input<'transparent' | 'dark'>('dark');

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();
}
```

---

### 6. NativeAutocompleteComponent

**File**: `native/autocomplete/native-autocomplete.component.ts`

Complete autocomplete solution using native services. Replaces CDK AutocompleteComponent.

#### Features

- Floating UI for panel positioning
- KeyboardNavigationService for keyboard navigation
- Signal-based activeIndex (not ActiveDescendantKeyManager)
- Loading/empty state support
- Custom suggestion templates
- Same API as CDK version for easy migration

#### Usage

```typescript
import { NativeAutocompleteComponent } from '@ptah-extension/ui';

@Component({
  template: `
    <ptah-native-autocomplete [suggestions]="suggestions()" [isLoading]="isLoading()" [isOpen]="isOpen()" [suggestionTemplate]="suggestionTemplate" [headerTitle]="'Files'" (suggestionSelected)="onSelect($event)" (closed)="closePanel()">
      <input autocompleteInput type="text" (keydown)="handleKeyDown($event)" [attr.aria-activedescendant]="autocomplete.getActiveDescendantId()" />
    </ptah-native-autocomplete>

    <ng-template #suggestionTemplate let-suggestion>
      <div class="flex items-center gap-2">
        <span>{{ suggestion.icon }}</span>
        <span>{{ suggestion.name }}</span>
      </div>
    </ng-template>
  `,
  imports: [NativeAutocompleteComponent],
})
export class FilePickerComponent {
  @ViewChild(NativeAutocompleteComponent) autocomplete!: NativeAutocompleteComponent;

  handleKeyDown(event: KeyboardEvent): void {
    if (this.autocomplete.onKeyDown(event)) {
      event.preventDefault();
    }
  }
}
```

#### API

```typescript
@Component({ selector: 'ptah-native-autocomplete' })
export class NativeAutocompleteComponent<T = unknown> {
  // Inputs
  readonly suggestions = input.required<T[]>();
  readonly isLoading = input<boolean>(false);
  readonly isOpen = input.required<boolean>();
  readonly headerTitle = input<string>('');
  readonly ariaLabel = input<string>('Suggestions');
  readonly emptyMessage = input<string>('No matches found');
  readonly trackBy = input<(index: number, item: T) => unknown>((i) => i);
  readonly suggestionTemplate = input.required<TemplateRef<{ $implicit: T }>>();

  // Outputs
  readonly suggestionSelected = output<T>();
  readonly closed = output<void>();

  // Exposed signal from KeyboardNavigationService
  readonly activeIndex: Signal<number>;

  // Public API (called by parent for keyboard integration)
  onKeyDown(event: KeyboardEvent): boolean;
  selectFocused(): void;
  getActiveDescendantId(): string | null;
}
```

---

## Deprecated CDK Components

The following components use Angular CDK Overlay and A11y modules, which have conflicts
with VS Code webview sandboxing. **Migrate to native components.**

### DropdownComponent (DEPRECATED)

**Migration**: Use `NativeDropdownComponent` instead.

```typescript
// Before
import { DropdownComponent } from '@ptah-extension/ui';
<ptah-dropdown [isOpen]="isOpen()">...</ptah-dropdown>

// After
import { NativeDropdownComponent } from '@ptah-extension/ui';
<ptah-native-dropdown [isOpen]="isOpen()">...</ptah-native-dropdown>
```

### PopoverComponent (DEPRECATED)

**Migration**: Use `NativePopoverComponent` instead.

```typescript
// Before
import { PopoverComponent } from '@ptah-extension/ui';
<ptah-popover [isOpen]="isOpen()">...</ptah-popover>

// After
import { NativePopoverComponent } from '@ptah-extension/ui';
<ptah-native-popover [isOpen]="isOpen()">...</ptah-native-popover>
```

### OptionComponent (DEPRECATED)

**Migration**: Use `NativeOptionComponent` instead.

Key change: Replace Highlightable interface with isActive input.

```typescript
// Before (CDK Highlightable pattern)
import { OptionComponent } from '@ptah-extension/ui';
<ptah-option [optionId]="id" [value]="item">...</ptah-option>
// Active state managed by ActiveDescendantKeyManager calling setActiveStyles()

// After (Signal input pattern)
import { NativeOptionComponent } from '@ptah-extension/ui';
<ptah-native-option
  [optionId]="id"
  [value]="item"
  [isActive]="i === activeIndex()">  <!-- Parent controls active state! -->
  ...
</ptah-native-option>
```

### AutocompleteComponent (DEPRECATED)

**Migration**: Use `NativeAutocompleteComponent` instead.

Key change: Replace ActiveDescendantKeyManager with KeyboardNavigationService signals.

```typescript
// Before (CDK A11y pattern)
import { AutocompleteComponent } from '@ptah-extension/ui';
// Used ActiveDescendantKeyManager internally

// After (Signal-based pattern)
import { NativeAutocompleteComponent } from '@ptah-extension/ui';
// Uses KeyboardNavigationService with activeIndex signal
```

---

## Migration Guide: CDK to Native Components

### Why Migration is Needed

CDK Overlay and A11y modules have conflicts with VS Code webview sandboxing:

1. **Portal Rendering Issues**: CDK Overlay renders content in a portal at `document.body`, which can conflict with VS Code's webview security policies
2. **Focus Management Conflicts**: CDK FocusTrap can interfere with VS Code's focus handling
3. **Signal Dependency Loops**: CDK's Highlightable interface with `setActiveStyles()`/`setInactiveStyles()` causes dependency loops in Angular effects

### Key Pattern Changes

| CDK Pattern                           | Native Pattern                      |
| ------------------------------------- | ----------------------------------- |
| CDK Overlay portal rendering          | In-place rendering with Floating UI |
| CDK FocusTrap                         | Native focus store/restore          |
| ActiveDescendantKeyManager            | KeyboardNavigationService (signals) |
| Highlightable interface               | isActive input signal               |
| setActiveStyles()/setInactiveStyles() | [isActive]="i === activeIndex()"    |
| ConnectedPosition                     | Floating UI Placement               |

### Step-by-Step Migration

#### Step 1: Update Imports

```typescript
// Before
import { DropdownComponent, PopoverComponent, OptionComponent, AutocompleteComponent } from '@ptah-extension/ui';

// After
import { NativeDropdownComponent, NativePopoverComponent, NativeOptionComponent, NativeAutocompleteComponent } from '@ptah-extension/ui';
```

#### Step 2: Update Template Selectors

```html
<!-- Before -->
<ptah-dropdown>...</ptah-dropdown>
<ptah-popover>...</ptah-popover>
<ptah-option>...</ptah-option>
<ptah-autocomplete>...</ptah-autocomplete>

<!-- After -->
<ptah-native-dropdown>...</ptah-native-dropdown>
<ptah-native-popover>...</ptah-native-popover>
<ptah-native-option>...</ptah-native-option>
<ptah-native-autocomplete>...</ptah-native-autocomplete>
```

#### Step 3: Update Active State Management

```typescript
// Before: CDK manages active state via Highlightable
@Component({
  template: `
    @for (item of items(); track item.id) {
    <ptah-option [optionId]="'item-' + $index" [value]="item">
      {{ item.name }}
    </ptah-option>
    }
  `,
})
export class MyComponent {
  // ActiveDescendantKeyManager calls setActiveStyles() internally
}

// After: Parent controls active state via signal
@Component({
  providers: [KeyboardNavigationService],
  template: `
    @for (item of items(); track item.id; let i = $index) {
    <ptah-native-option [optionId]="'item-' + i" [value]="item" [isActive]="i === activeIndex()" (hovered)="onHover(i)">
      {{ item.name }}
    </ptah-native-option>
    }
  `,
})
export class MyComponent {
  private readonly keyboardNav = inject(KeyboardNavigationService);
  readonly activeIndex = this.keyboardNav.activeIndex;

  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
```

#### Step 4: Update Position Configuration

```typescript
// Before: CDK ConnectedPosition
import { ConnectedPosition } from '@angular/cdk/overlay';
const positions: ConnectedPosition[] = [{ originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' }];

// After: Floating UI Placement
import { Placement } from '@floating-ui/dom';
const placement: Placement = 'bottom-start';
```

---

## Import Patterns

### Recommended: Import from Main Entry Point

```typescript
// Native components (recommended)
import { NativeDropdownComponent, NativePopoverComponent, NativeOptionComponent, NativeAutocompleteComponent, FloatingUIService, KeyboardNavigationService } from '@ptah-extension/ui';

// Deprecated CDK components (for backwards compatibility)
import { DropdownComponent, PopoverComponent, OptionComponent, AutocompleteComponent } from '@ptah-extension/ui';
```

### Subpath Imports (Tree-Shaking)

```typescript
// Native components
import { NativeDropdownComponent } from '@ptah-extension/ui/native/dropdown';
import { FloatingUIService } from '@ptah-extension/ui/native/shared';

// Deprecated CDK components
import { DropdownComponent } from '@ptah-extension/ui/overlays/dropdown';
```

---

## Dependencies

**Internal**:

- None (shared UI components, no internal library dependencies)

**External**:

- `@angular/core` (^20.1.2): Component framework
- `@angular/common` (^20.1.2): NgTemplateOutlet
- `@floating-ui/dom` (^1.6.0): Native positioning (used by native components)
- `@angular/cdk/overlay` (^20.2.14): Portal rendering (deprecated components only)
- `@angular/cdk/a11y` (^20.2.14): Keyboard navigation (deprecated components only)

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

1. **Native vs CDK**: Native components preferred for VS Code webview compatibility
2. **Signal-Based State**: Angular signals for reactive state (not RxJS)
3. **Composition Over Configuration**: Content projection for flexibility
4. **DaisyUI Styling**: All components use DaisyUI for VS Code theme compatibility
5. **Component-Level Providers**: Services provided at component level for isolation
6. **Backwards Compatibility**: Deprecated CDK components still exported for migration period

---

## Integration Points

**Consumed By**:

- `libs/frontend/chat` - UnifiedSuggestionsDropdown, AgentSelector, ModelSelector

**Depends On**:

- `@floating-ui/dom` - Native positioning infrastructure
- `@angular/cdk` - Legacy components only (deprecated)

---

## File Paths Reference

- **Native Components**: `src/lib/native/`
- **Deprecated Overlays**: `src/lib/overlays/dropdown/`, `src/lib/overlays/popover/`
- **Deprecated Selection**: `src/lib/selection/option/`, `src/lib/selection/autocomplete/`
- **Entry Point**: `src/index.ts`
