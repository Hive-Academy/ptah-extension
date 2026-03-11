# Implementation Plan - TASK_2025_092

## Critical Update: VS Code Webview UI Toolkit Deprecated

**IMPORTANT**: The original task specified using `@vscode/webview-ui-toolkit`. This package was **deprecated on January 1, 2025** and the repository was archived on January 6, 2025.

**Deprecation Reason**: The FAST project (foundation technology) underwent restructuring and deprecated FAST Foundation. Microsoft did not allocate resources for a rewrite.

**Sources**:

- [Deprecation Announcement](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561)
- [Repository (Archived)](https://github.com/microsoft/vscode-webview-ui-toolkit)

**Alternative Approach**: This plan uses **vscode-elements** (community library) + **Floating UI** + **Native Angular components**.

---

## Codebase Investigation Summary

### Libraries Discovered

**1. Current CDK Implementation** (to be replaced)

- Path: `libs/frontend/ui/src/lib/`
- Components: DropdownComponent, PopoverComponent, OptionComponent, AutocompleteComponent
- Issues documented in context.md:
  - Signal dependency loop in effects (optionId() tracked as dependency)
  - Subscription leaks in keyManager.change
  - CDK Overlay portal rendering conflicts with VS Code webview sandboxing
  - Fatal hang/freeze when typing @ or / triggers

**2. vscode-elements** (alternative - Lit-based)

- GitHub: https://github.com/vscode-elements/elements
- Available components:
  - `vscode-single-select`, `vscode-multi-select`, `vscode-option` - Select dropdowns
  - `vscode-button`, `vscode-textfield`, `vscode-checkbox` - Form controls
  - `vscode-context-menu`, `vscode-context-menu-item` - Context menus
  - NO autocomplete component (must build custom)
- Integration: Web components via CUSTOM_ELEMENTS_SCHEMA

**3. Floating UI** (positioning library)

- Package: `@floating-ui/dom`
- Size: ~3KB (vs CDK Overlay's larger footprint)
- Features: Positioning, flip, shift, auto-update
- Angular integration: Direct usage or via ngx-float-ui wrapper

### Patterns Identified

**1. Current CDK Overlay Pattern** (problematic)

- Evidence: `libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.ts:36-57`
- Uses `cdkConnectedOverlay` directive for portal rendering
- Uses `OverlayModule` and `A11yModule` from CDK
- Portal rendering conflicts with VS Code webview sandboxing

**2. ActiveDescendantKeyManager Pattern** (problematic)

- Evidence: `libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.component.ts:148-151`
- Uses CDK A11y's keyboard manager
- Signal dependency loop causes fatal hangs
- Subscription leaks in change stream

**3. Consumer Pattern** (to preserve)

- Evidence: `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts:115-124`
- Uses `CdkOverlayOrigin` to reference trigger element
- Forwards keyboard events to dropdown component
- ARIA attributes for accessibility

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Native Angular + Floating UI Hybrid
**Rationale**:

1. CDK Overlay has documented conflicts with VS Code webview sandboxing
2. VS Code Webview UI Toolkit is deprecated (January 1, 2025)
3. vscode-elements provides VS Code styling but lacks autocomplete
4. Floating UI provides lightweight positioning without portal conflicts

**Evidence**:

- Task context.md:8-11 documents CDK conflicts causing fatal hangs
- vscode-elements GitHub shows no autocomplete component
- Floating UI documentation confirms vanilla JS usage in any framework

### Component Architecture

```
libs/frontend/ui/src/lib/
├── native/                          # NEW: Native implementations (no CDK)
│   ├── dropdown/
│   │   ├── native-dropdown.component.ts
│   │   └── index.ts
│   ├── popover/
│   │   ├── native-popover.component.ts
│   │   └── index.ts
│   ├── autocomplete/
│   │   ├── native-autocomplete.component.ts
│   │   └── index.ts
│   ├── option/
│   │   ├── native-option.component.ts
│   │   └── index.ts
│   └── shared/
│       ├── floating-ui.service.ts
│       ├── keyboard-navigation.service.ts
│       └── index.ts
│
├── vscode/                          # NEW: VS Code Elements wrappers
│   ├── vscode-select.component.ts
│   └── index.ts
│
└── overlays/ (DEPRECATED)           # Existing CDK components (remove after migration)
```

---

## Component Specifications

### Component 1: FloatingUIService

**Purpose**: Lightweight positioning service using @floating-ui/dom to replace CDK Overlay positioning.

**Pattern**: Service-based positioning (verified pattern in Angular ecosystem)
**Evidence**: Floating UI documentation and AgnosUI Angular implementation

**Responsibilities**:

- Position floating elements relative to reference elements
- Handle flip/shift for viewport constraints
- Auto-update on scroll/resize
- Cleanup on destroy

**Implementation Pattern**:

```typescript
// Pattern: Floating UI service wrapper
import { Injectable, inject, DestroyRef } from '@angular/core';
import { computePosition, flip, shift, offset, autoUpdate, Placement } from '@floating-ui/dom';

export interface FloatingUIOptions {
  placement?: Placement;
  offset?: number;
  flip?: boolean;
  shift?: boolean;
}

@Injectable()
export class FloatingUIService {
  private readonly destroyRef = inject(DestroyRef);
  private cleanupFn: (() => void) | null = null;

  /**
   * Position a floating element relative to a reference element.
   * Automatically updates on scroll/resize.
   */
  async position(referenceEl: HTMLElement, floatingEl: HTMLElement, options: FloatingUIOptions = {}): Promise<void> {
    const middleware = [offset(options.offset ?? 8), ...(options.flip !== false ? [flip()] : []), ...(options.shift !== false ? [shift({ padding: 8 })] : [])];

    // Initial position
    const { x, y } = await computePosition(referenceEl, floatingEl, {
      placement: options.placement ?? 'bottom-start',
      middleware,
    });

    Object.assign(floatingEl.style, {
      left: `${x}px`,
      top: `${y}px`,
      position: 'absolute',
    });

    // Auto-update on scroll/resize
    this.cleanupFn = autoUpdate(referenceEl, floatingEl, async () => {
      const { x, y } = await computePosition(referenceEl, floatingEl, {
        placement: options.placement ?? 'bottom-start',
        middleware,
      });
      Object.assign(floatingEl.style, { left: `${x}px`, top: `${y}px` });
    });
  }

  cleanup(): void {
    this.cleanupFn?.();
    this.cleanupFn = null;
  }
}
```

**Quality Requirements**:

- Must not use CDK Overlay
- Must handle viewport constraints (flip/shift)
- Must cleanup listeners on destroy
- Must support placement options (top, bottom, left, right + alignment)

**Files Affected**:

- `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts` (CREATE)

---

### Component 2: KeyboardNavigationService

**Purpose**: Native keyboard navigation for list-based components, replacing CDK's ActiveDescendantKeyManager.

**Pattern**: Service-based keyboard handling
**Evidence**: ActiveDescendantKeyManager pattern from CDK (simplified)

**Responsibilities**:

- Track active item index in a list
- Handle ArrowUp/ArrowDown/Home/End navigation
- Emit active item changes
- Support wrap-around navigation

**Implementation Pattern**:

```typescript
// Pattern: Native keyboard navigation (no CDK)
import { Injectable, signal } from '@angular/core';

export interface KeyboardNavigationConfig {
  itemCount: number;
  wrap?: boolean;
  horizontal?: boolean;
}

@Injectable()
export class KeyboardNavigationService {
  private readonly _activeIndex = signal<number>(-1);
  readonly activeIndex = this._activeIndex.asReadonly();

  private config: KeyboardNavigationConfig = { itemCount: 0 };

  configure(config: KeyboardNavigationConfig): void {
    this.config = config;
    if (config.itemCount > 0 && this._activeIndex() === -1) {
      this._activeIndex.set(0);
    }
  }

  /**
   * Handle keyboard event. Returns true if event was handled.
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    const { itemCount, wrap = true, horizontal = false } = this.config;
    if (itemCount === 0) return false;

    const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';
    const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';

    switch (event.key) {
      case nextKey:
        this.setNext(wrap);
        return true;
      case prevKey:
        this.setPrevious(wrap);
        return true;
      case 'Home':
        this._activeIndex.set(0);
        return true;
      case 'End':
        this._activeIndex.set(itemCount - 1);
        return true;
      default:
        return false;
    }
  }

  setNext(wrap: boolean): void {
    const current = this._activeIndex();
    const max = this.config.itemCount - 1;
    if (current < max) {
      this._activeIndex.set(current + 1);
    } else if (wrap) {
      this._activeIndex.set(0);
    }
  }

  setPrevious(wrap: boolean): void {
    const current = this._activeIndex();
    if (current > 0) {
      this._activeIndex.set(current - 1);
    } else if (wrap) {
      this._activeIndex.set(this.config.itemCount - 1);
    }
  }

  setActiveIndex(index: number): void {
    if (index >= 0 && index < this.config.itemCount) {
      this._activeIndex.set(index);
    }
  }

  reset(): void {
    this._activeIndex.set(this.config.itemCount > 0 ? 0 : -1);
  }
}
```

**Quality Requirements**:

- Must not use CDK A11y
- Must use Angular signals (not BehaviorSubject)
- Must support wrap-around navigation
- Must support Home/End keys

**Files Affected**:

- `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts` (CREATE)

---

### Component 3: NativeOptionComponent

**Purpose**: Simple selectable option component for dropdown/autocomplete lists. Replaces CDK Highlightable-based OptionComponent.

**Pattern**: Signal-based input/output component
**Evidence**: Current OptionComponent pattern (simplified)

**Responsibilities**:

- Display option content via projection
- Track active state via input signal
- Emit selection and hover events
- Apply active styles based on input

**Implementation Pattern**:

```typescript
// Pattern: Native option component (no CDK Highlightable)
@Component({
  selector: 'ptah-native-option',
  standalone: true,
  host: {
    '[id]': 'optionId()',
    class: 'block px-3 py-2 rounded-md cursor-pointer transition-colors',
    '[class.bg-primary]': 'isActive()',
    '[class.text-primary-content]': 'isActive()',
    '[class.hover:bg-base-300]': '!isActive()',
    '(click)': 'handleClick()',
    '(mouseenter)': 'hovered.emit()',
    role: 'option',
    '[attr.aria-selected]': 'isActive()',
    tabindex: '-1',
  },
  template: `<ng-content />`,
})
export class NativeOptionComponent<T = unknown> {
  readonly optionId = input.required<string>();
  readonly value = input.required<T>();
  readonly isActive = input<boolean>(false); // Controlled by parent, not self-managed

  readonly selected = output<T>();
  readonly hovered = output<void>();

  private readonly elementRef = inject(ElementRef);

  handleClick(): void {
    this.selected.emit(this.value());
  }

  /**
   * Scroll this option into view. Called by parent when this becomes active.
   */
  scrollIntoView(): void {
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  getHostElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }
}
```

**Key Difference from Current Implementation**:

- `isActive` is an INPUT signal controlled by parent, not self-managed state
- No Highlightable interface (no CDK dependency)
- Parent manages active state, child just renders

**Quality Requirements**:

- Must not implement CDK Highlightable interface
- Must use signal-based inputs
- Must provide scrollIntoView() method for parent
- Must use DaisyUI classes for styling

**Files Affected**:

- `libs/frontend/ui/src/lib/native/option/native-option.component.ts` (CREATE)

---

### Component 4: NativeDropdownComponent

**Purpose**: Dropdown container with Floating UI positioning. Replaces CDK Overlay-based DropdownComponent.

**Pattern**: Content projection + Floating UI positioning
**Evidence**: Current DropdownComponent template structure (adapted)

**Responsibilities**:

- Render trigger and content via content projection
- Position content using Floating UI
- Handle backdrop click for closing
- Manage open/close state via inputs

**Implementation Pattern**:

```typescript
// Pattern: Native dropdown with Floating UI
@Component({
  selector: 'ptah-native-dropdown',
  standalone: true,
  template: `
    <!-- Trigger element (always rendered) -->
    <div #triggerRef class="dropdown-trigger">
      <ng-content select="[trigger]" />
    </div>

    <!-- Dropdown panel (conditionally rendered) -->
    @if (isOpen()) {
      <!-- Backdrop for click-outside detection -->
      @if (hasBackdrop()) {
        <div
          class="fixed inset-0 z-40"
          [class.bg-black/20]="backdropClass() === 'dark'"
          (click)="handleBackdropClick()"
        ></div>
      }

      <!-- Floating content -->
      <div
        #floatingRef
        class="dropdown-panel bg-base-200 border border-base-300 rounded-lg shadow-lg z-50"
      >
        <ng-content select="[content]" />
      </div>
    }
  `,
})
export class NativeDropdownComponent implements AfterViewInit, OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);

  readonly isOpen = input.required<boolean>();
  readonly placement = input<Placement>('bottom-start');
  readonly offset = input<number>(8);
  readonly hasBackdrop = input<boolean>(true);
  readonly backdropClass = input<'transparent' | 'dark'>('transparent');
  readonly closeOnBackdropClick = input<boolean>(true);

  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();

  private readonly triggerRef = viewChild<ElementRef>('triggerRef');
  private readonly floatingRef = viewChild<ElementRef>('floatingRef');

  constructor() {
    // Effect to position dropdown when opened
    effect(() => {
      if (this.isOpen()) {
        this.positionDropdown();
        this.opened.emit();
      } else {
        this.floatingUI.cleanup();
      }
    });
  }

  private async positionDropdown(): Promise<void> {
    const trigger = this.triggerRef()?.nativeElement;
    const floating = this.floatingRef()?.nativeElement;

    if (trigger && floating) {
      await this.floatingUI.position(trigger, floating, {
        placement: this.placement(),
        offset: this.offset(),
      });
    }
  }

  handleBackdropClick(): void {
    this.backdropClicked.emit();
    if (this.closeOnBackdropClick()) {
      this.closed.emit();
    }
  }

  ngOnDestroy(): void {
    this.floatingUI.cleanup();
  }
}
```

**Quality Requirements**:

- Must not use CDK Overlay
- Must use Floating UI for positioning
- Must support backdrop click detection
- Must emit opened/closed events
- Must cleanup on destroy

**Files Affected**:

- `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts` (CREATE)

---

### Component 5: NativePopoverComponent

**Purpose**: Modal-like popover with focus trap and escape key handling. Replaces CDK-based PopoverComponent.

**Pattern**: Floating UI + native focus management
**Evidence**: Current PopoverComponent (adapted without CDK FocusTrap)

**Responsibilities**:

- Position popover using Floating UI
- Trap focus within popover content
- Handle Escape key to close
- Return focus to trigger on close

**Implementation Pattern**:

```typescript
// Pattern: Native popover with focus trap
@Component({
  selector: 'ptah-native-popover',
  standalone: true,
  template: `
    <div #triggerRef class="popover-trigger">
      <ng-content select="[trigger]" />
    </div>

    @if (isOpen()) {
      @if (hasBackdrop()) {
        <div
          class="fixed inset-0 z-40"
          [class.bg-black/50]="backdropClass() === 'dark'"
          (click)="handleBackdropClick()"
        ></div>
      }

      <div
        #floatingRef
        class="popover-panel bg-base-200 border border-base-300 rounded-lg shadow-xl z-50"
        tabindex="-1"
        (keydown.escape)="handleEscape()"
      >
        <ng-content select="[content]" />
      </div>
    }
  `,
})
export class NativePopoverComponent implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);

  readonly isOpen = input.required<boolean>();
  readonly placement = input<Placement>('bottom');
  readonly hasBackdrop = input<boolean>(true);
  readonly backdropClass = input<'transparent' | 'dark'>('dark');

  readonly opened = output<void>();
  readonly closed = output<void>();

  private readonly triggerRef = viewChild<ElementRef>('triggerRef');
  private readonly floatingRef = viewChild<ElementRef>('floatingRef');
  private previousActiveElement: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.openPopover();
      } else {
        this.closePopover();
      }
    });
  }

  private async openPopover(): Promise<void> {
    // Store current focus for restoration
    this.previousActiveElement = document.activeElement as HTMLElement;

    const trigger = this.triggerRef()?.nativeElement;
    const floating = this.floatingRef()?.nativeElement;

    if (trigger && floating) {
      await this.floatingUI.position(trigger, floating, {
        placement: this.placement(),
      });

      // Focus the popover content
      floating.focus();
      this.opened.emit();
    }
  }

  private closePopover(): void {
    this.floatingUI.cleanup();

    // Return focus to previous element
    if (this.previousActiveElement) {
      this.previousActiveElement.focus();
      this.previousActiveElement = null;
    }
  }

  handleBackdropClick(): void {
    this.closed.emit();
  }

  handleEscape(): void {
    this.closed.emit();
  }

  ngOnDestroy(): void {
    this.floatingUI.cleanup();
  }
}
```

**Quality Requirements**:

- Must not use CDK FocusTrap
- Must restore focus on close
- Must handle Escape key
- Must support dark/transparent backdrop

**Files Affected**:

- `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts` (CREATE)

---

### Component 6: NativeAutocompleteComponent

**Purpose**: Input-triggered autocomplete with native keyboard navigation. Replaces CDK-based AutocompleteComponent.

**Pattern**: Floating UI + KeyboardNavigationService + signal-based state
**Evidence**: Current AutocompleteComponent structure (rewritten without CDK)

**Responsibilities**:

- Position suggestions panel using Floating UI
- Handle keyboard navigation via KeyboardNavigationService
- Track active option via signal
- Support loading/empty states
- Provide ARIA attributes for accessibility

**Implementation Pattern**:

```typescript
// Pattern: Native autocomplete (no CDK)
@Component({
  selector: 'ptah-native-autocomplete',
  standalone: true,
  imports: [NativeOptionComponent],
  providers: [FloatingUIService, KeyboardNavigationService],
  template: `
    <div #inputOrigin class="autocomplete-input">
      <ng-content select="[autocompleteInput]" />
    </div>

    @if (isOpen()) {
    <div #floatingPanel class="suggestions-panel bg-base-200 border border-base-300 rounded-lg shadow-lg max-h-80 flex flex-col z-50" role="listbox" [attr.aria-label]="ariaLabel()">
      <!-- Header -->
      @if (headerTitle()) {
      <div class="px-3 py-2 border-b border-base-300">
        <span class="text-xs font-semibold text-base-content/70 uppercase tracking-wide">
          {{ headerTitle() }}
        </span>
      </div>
      }

      <!-- Loading State -->
      @if (isLoading()) {
      <div class="flex items-center justify-center gap-3 p-4">
        <span class="loading loading-spinner loading-sm"></span>
        <span class="text-sm text-base-content/70">Loading...</span>
      </div>
      }

      <!-- Empty State -->
      @else if (suggestions().length === 0) {
      <div class="flex items-center justify-center p-4">
        <span class="text-sm text-base-content/60">{{ emptyMessage() }}</span>
      </div>
      }

      <!-- Suggestions List -->
      @else {
      <div class="flex flex-col overflow-y-auto overflow-x-hidden p-1">
        @for (suggestion of suggestions(); track trackBy()($index, suggestion); let i = $index) {
        <ptah-native-option [optionId]="'suggestion-' + i" [value]="suggestion" [isActive]="i === activeIndex()" (selected)="handleSelection($event)" (hovered)="handleHover(i)" />
        }
      </div>
      }
    </div>
    }
  `,
})
export class NativeAutocompleteComponent<T = unknown> implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);
  private readonly keyboardNav = inject(KeyboardNavigationService);

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

  // ViewChild references
  private readonly inputOrigin = viewChild<ElementRef>('inputOrigin');
  private readonly floatingPanel = viewChild<ElementRef>('floatingPanel');
  private readonly optionComponents = viewChildren(NativeOptionComponent);

  // Active index from keyboard navigation service
  readonly activeIndex = this.keyboardNav.activeIndex;

  constructor() {
    // Configure keyboard navigation when suggestions change
    effect(() => {
      const count = this.suggestions().length;
      this.keyboardNav.configure({ itemCount: count, wrap: true });
    });

    // Position panel when opened
    effect(() => {
      if (this.isOpen()) {
        this.positionPanel();
      } else {
        this.floatingUI.cleanup();
      }
    });

    // Scroll active option into view
    effect(() => {
      const index = this.activeIndex();
      const options = this.optionComponents();
      if (index >= 0 && index < options.length) {
        options[index].scrollIntoView();
      }
    });
  }

  private async positionPanel(): Promise<void> {
    const origin = this.inputOrigin()?.nativeElement;
    const panel = this.floatingPanel()?.nativeElement;

    if (origin && panel) {
      await this.floatingUI.position(origin, panel, {
        placement: 'bottom-start',
        offset: 4,
      });
    }
  }

  /**
   * Handle keyboard events from parent.
   * Returns true if event was handled.
   */
  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isLoading()) return false;

    if (event.key === 'Enter') {
      this.selectFocused();
      return true;
    }

    if (event.key === 'Escape') {
      this.closed.emit();
      return true;
    }

    return this.keyboardNav.handleKeyDown(event);
  }

  selectFocused(): void {
    const index = this.activeIndex();
    const suggestions = this.suggestions();
    if (index >= 0 && index < suggestions.length) {
      this.suggestionSelected.emit(suggestions[index]);
    }
  }

  handleHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }

  handleSelection(suggestion: T): void {
    this.suggestionSelected.emit(suggestion);
  }

  getActiveDescendantId(): string | null {
    const index = this.activeIndex();
    return index >= 0 ? `suggestion-${index}` : null;
  }

  ngOnDestroy(): void {
    this.floatingUI.cleanup();
  }
}
```

**Quality Requirements**:

- Must not use CDK Overlay or ActiveDescendantKeyManager
- Must use FloatingUIService for positioning
- Must use KeyboardNavigationService for navigation
- Must provide ARIA attributes
- Must support loading/empty states

**Files Affected**:

- `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts` (CREATE)

---

### Component 7: VSCodeSelectComponent (Optional)

**Purpose**: Angular wrapper for vscode-elements' `<vscode-single-select>` web component.

**Pattern**: Web component wrapper with CUSTOM_ELEMENTS_SCHEMA
**Evidence**: Angular web components integration pattern

**Responsibilities**:

- Wrap vscode-single-select for Angular usage
- Bridge Angular signals to web component properties
- Forward events to Angular outputs

**Implementation Pattern**:

```typescript
// Pattern: VS Code Elements wrapper
@Component({
  selector: 'ptah-vscode-select',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <vscode-single-select [attr.disabled]="disabled() ? '' : null" (change)="handleChange($event)">
      @for (option of options(); track option.value) {
      <vscode-option [value]="option.value" [selected]="option.value === value()">
        {{ option.label }}
      </vscode-option>
      }
    </vscode-single-select>
  `,
})
export class VSCodeSelectComponent {
  readonly options = input.required<{ value: string; label: string }[]>();
  readonly value = input<string>('');
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<string>();

  handleChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.valueChange.emit(target.value);
  }
}
```

**Quality Requirements**:

- Must use CUSTOM_ELEMENTS_SCHEMA
- Must work with vscode-elements package
- Must bridge Angular signals to web component

**Files Affected**:

- `libs/frontend/ui/src/lib/vscode/vscode-select.component.ts` (CREATE)

---

## Integration Architecture

### Integration Points

**1. FloatingUIService Integration**

- Used by: NativeDropdownComponent, NativePopoverComponent, NativeAutocompleteComponent
- Pattern: Injected as component-level provider

**2. KeyboardNavigationService Integration**

- Used by: NativeAutocompleteComponent
- Pattern: Injected as component-level provider
- Configured via effect when suggestions change

**3. Consumer Component Migration**

- UnifiedSuggestionsDropdownComponent: Replace CDK Overlay with NativeAutocompleteComponent
- ChatInputComponent: Replace CdkOverlayOrigin with direct element reference
- Directives: No changes needed (RxJS-only, no CDK dependencies)

### Data Flow

```
User Types "@" or "/"
        |
        v
AtTriggerDirective / SlashTriggerDirective (unchanged)
        |
        v
ChatInputComponent
        |-- Opens dropdown
        v
NativeAutocompleteComponent
        |-- Positions via FloatingUIService
        |-- Navigates via KeyboardNavigationService
        |-- Renders NativeOptionComponents
        |
        v
User Selects / Closes
        |
        v
ChatInputComponent handles selection
```

### Dependencies

**External Dependencies to ADD**:

```json
{
  "@floating-ui/dom": "^1.6.0",
  "vscode-elements": "^1.7.0"
}
```

**External Dependencies to REMOVE** (after migration):

- `@angular/cdk/overlay` imports in native components
- `@angular/cdk/a11y` imports in native components

---

## Quality Requirements

### Functional Requirements

1. **Dropdown/Popover**

   - Must position correctly relative to trigger element
   - Must handle viewport constraints (flip/shift)
   - Must close on backdrop click
   - Must close on Escape key

2. **Autocomplete**

   - Must position below input (or above if not enough space)
   - Must navigate with ArrowUp/ArrowDown/Home/End
   - Must select on Enter
   - Must close on Escape
   - Must support loading/empty states

3. **Keyboard Navigation**
   - Must work without CDK ActiveDescendantKeyManager
   - Must support wrap-around navigation
   - Must track active item index

### Non-Functional Requirements

- **Performance**: No signal dependency loops
- **Memory**: No subscription leaks
- **Compatibility**: No CDK Overlay portal conflicts
- **Accessibility**: ARIA attributes for screen readers
- **Styling**: DaisyUI classes for VS Code theme compatibility

### Pattern Compliance

- All components must be standalone
- All state must use Angular signals
- No CDK Overlay or CDK A11y dependencies
- Must use Floating UI for positioning

---

## Risk Assessment

### Risk 1: Floating UI Learning Curve

**Probability**: Medium
**Impact**: Low
**Mitigation**: FloatingUIService abstracts complexity; well-documented API

### Risk 2: Web Component Integration with Angular

**Probability**: Low
**Impact**: Medium
**Mitigation**: CUSTOM_ELEMENTS_SCHEMA is established Angular pattern

### Risk 3: Focus Management Without CDK FocusTrap

**Probability**: Medium
**Impact**: Medium
**Mitigation**: Native focus management with manual implementation

### Risk 4: Consumer Migration Complexity

**Probability**: Medium
**Impact**: High
**Mitigation**: Phased migration; keep CDK components during transition

---

## Implementation Batches

### Batch 1: Foundation (2-3 hours)

**Priority**: HIGH
**Dependencies**: None

1. Add @floating-ui/dom dependency to package.json
2. Create FloatingUIService
3. Create KeyboardNavigationService
4. Create barrel exports for native/shared

**Files**:

- `package.json` (MODIFY)
- `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/shared/index.ts` (CREATE)

### Batch 2: Core Components (3-4 hours)

**Priority**: HIGH
**Dependencies**: Batch 1

1. Create NativeOptionComponent
2. Create NativeDropdownComponent
3. Create NativePopoverComponent

**Files**:

- `libs/frontend/ui/src/lib/native/option/native-option.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/option/index.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/dropdown/index.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/popover/index.ts` (CREATE)

### Batch 3: Autocomplete (2-3 hours)

**Priority**: HIGH
**Dependencies**: Batch 1, Batch 2

1. Create NativeAutocompleteComponent
2. Create barrel exports for native module

**Files**:

- `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/autocomplete/index.ts` (CREATE)
- `libs/frontend/ui/src/lib/native/index.ts` (CREATE)

### Batch 4: Consumer Migration (3-4 hours)

**Priority**: HIGH
**Dependencies**: Batch 3

1. Migrate UnifiedSuggestionsDropdownComponent to use NativeAutocompleteComponent
2. Update ChatInputComponent to use native components
3. Update library exports

**Files**:

- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts` (REWRITE)
- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts` (MODIFY)
- `libs/frontend/ui/src/index.ts` (MODIFY)

### Batch 5: Optional - VS Code Elements (1-2 hours)

**Priority**: LOW
**Dependencies**: None (optional)

1. Add vscode-elements dependency
2. Create VSCodeSelectComponent wrapper

**Files**:

- `package.json` (MODIFY)
- `libs/frontend/ui/src/lib/vscode/vscode-select.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/vscode/index.ts` (CREATE)

### Batch 6: Cleanup (1-2 hours)

**Priority**: MEDIUM
**Dependencies**: Batch 4

1. Deprecate old CDK components (add @deprecated JSDoc)
2. Update CLAUDE.md documentation
3. Run tests and verify functionality

**Files**:

- `libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.ts` (MODIFY - add deprecation)
- `libs/frontend/ui/src/lib/overlays/popover/popover.component.ts` (MODIFY - add deprecation)
- `libs/frontend/ui/src/lib/selection/option/option.component.ts` (MODIFY - add deprecation)
- `libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.component.ts` (MODIFY - add deprecation)
- `libs/frontend/ui/CLAUDE.md` (MODIFY)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

1. All work is in Angular frontend library (`libs/frontend/ui`)
2. Requires Angular signals, components, and services expertise
3. Web component integration with CUSTOM_ELEMENTS_SCHEMA
4. No backend changes required

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 12-18 hours

**Breakdown**:

- Foundation services: 2-3 hours
- Core components: 3-4 hours
- Autocomplete: 2-3 hours
- Consumer migration: 3-4 hours
- Optional VS Code Elements: 1-2 hours
- Cleanup & testing: 1-2 hours

### Files Affected Summary

**CREATE**:

- `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts`
- `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts`
- `libs/frontend/ui/src/lib/native/shared/index.ts`
- `libs/frontend/ui/src/lib/native/option/native-option.component.ts`
- `libs/frontend/ui/src/lib/native/option/index.ts`
- `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts`
- `libs/frontend/ui/src/lib/native/dropdown/index.ts`
- `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts`
- `libs/frontend/ui/src/lib/native/popover/index.ts`
- `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts`
- `libs/frontend/ui/src/lib/native/autocomplete/index.ts`
- `libs/frontend/ui/src/lib/native/index.ts`
- `libs/frontend/ui/src/lib/vscode/vscode-select.component.ts` (optional)
- `libs/frontend/ui/src/lib/vscode/index.ts` (optional)

**MODIFY**:

- `package.json` - Add @floating-ui/dom, optionally vscode-elements
- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`
- `libs/frontend/ui/src/index.ts`
- `libs/frontend/ui/CLAUDE.md`

**REWRITE**:

- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts`

**DEPRECATE** (add @deprecated):

- `libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.ts`
- `libs/frontend/ui/src/lib/overlays/popover/popover.component.ts`
- `libs/frontend/ui/src/lib/selection/option/option.component.ts`
- `libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.component.ts`

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **Floating UI installation**:

   - Run `npm install @floating-ui/dom`
   - Verify import works: `import { computePosition } from '@floating-ui/dom'`

2. **Signal patterns verified**:

   - `input.required<T>()` pattern from existing components
   - `output<T>()` pattern from existing components
   - `viewChild()` signal-based pattern

3. **No CDK imports in new components**:

   - No `@angular/cdk/overlay`
   - No `@angular/cdk/a11y`
   - No `OverlayModule`, `A11yModule`, `ActiveDescendantKeyManager`

4. **Library documentation consulted**:
   - `libs/frontend/ui/CLAUDE.md` for existing patterns
   - `libs/frontend/chat/CLAUDE.md` for consumer patterns

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] Alternative libraries researched (VS Code Toolkit deprecated)
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM-HIGH)
- [x] Risk assessment provided
- [x] Implementation batches ordered

---

## References

- [VS Code Webview UI Toolkit Deprecation](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561)
- [vscode-elements Library](https://github.com/vscode-elements/elements)
- [Floating UI Documentation](https://floating-ui.com/)
- [Angular CUSTOM_ELEMENTS_SCHEMA](https://angular.dev/api/core/CUSTOM_ELEMENTS_SCHEMA)
- [Angular Web Components Integration](https://www.angulararchitects.io/blog/angular-elements-web-components-with-standalone-components/)
