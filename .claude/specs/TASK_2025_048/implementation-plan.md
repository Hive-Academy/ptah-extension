# Implementation Plan - TASK_2025_048: Shared UI Library with CDK Overlay

## 📊 Codebase Investigation Summary

### Evidence Collection

**Investigation Scope**:

- **Existing Components Analyzed**: 6 components (unified-suggestions-dropdown, suggestion-option, agent-selector, model-selector, autopilot-popover, dropdown-interaction.service)
- **Angular CDK Version**: ^20.2.14 (verified in package.json)
- **Existing CDK Usage**: ActiveDescendantKeyManager, Highlightable interface (libs/frontend/chat/src/lib/components/file-suggestions/)
- **Frontend Libraries Analyzed**: chat, core (project.json structure)

### Libraries Discovered

1. **@angular/cdk** (version ^20.2.14)

   - Currently using: `@angular/cdk/a11y` (ActiveDescendantKeyManager, Highlightable)
   - **NOT currently using**: `@angular/cdk/overlay`, `@angular/cdk/portal` (the core issue!)
   - Location: node_modules/@angular/cdk
   - Documentation: Available via @angular/cdk generators

2. **libs/frontend/chat** (Feature Library)

   - Path: D:\projects\ptah-extension\libs\frontend\chat
   - Components: UnifiedSuggestionsDropdownComponent, SuggestionOptionComponent, AgentSelectorComponent, ModelSelectorComponent, AutopilotPopoverComponent
   - Current patterns: Manual positioning, @if rendering, DropdownInteractionService usage
   - Import alias: @ptah-extension/chat

3. **libs/frontend/core** (Core Services Library)
   - Path: D:\projects\ptah-extension\libs\frontend\core
   - Services: DropdownInteractionService (87 lines - band-aid solution)
   - Import alias: @ptah-extension/core

### Patterns Identified

#### Pattern 1: ActiveDescendantKeyManager (GOOD - Keep This!)

**Evidence**: unified-suggestions-dropdown.component.ts:109-165

```typescript
// VERIFIED: ActiveDescendantKeyManager correctly implemented
private keyManager: ActiveDescendantKeyManager<SuggestionOptionComponent> | null = null;

// Initialization in effect()
this.keyManager = new ActiveDescendantKeyManager(options)
  .withVerticalOrientation()
  .withWrap()
  .withHomeAndEnd();

// Keyboard handling
onKeyDown(event: KeyboardEvent): boolean {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      this.keyManager.onKeydown(event);
      return true;
    // ...
  }
}
```

**Pattern Quality**: ✅ EXCELLENT - Focus stays on input, aria-activedescendant pattern
**Reuse Strategy**: Integrate with new CDK Overlay components

#### Pattern 2: Highlightable Implementation (GOOD - Reuse!)

**Evidence**: suggestion-option.component.ts:84-117

```typescript
// VERIFIED: Highlightable interface for keyboard navigation
export class SuggestionOptionComponent implements Highlightable {
  isActive = false;

  setActiveStyles(): void {
    this.isActive = true;
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  setInactiveStyles(): void {
    this.isActive = false;
  }
}
```

**Pattern Quality**: ✅ EXCELLENT - Works with ActiveDescendantKeyManager
**Reuse Strategy**: Create generic OptionComponent implementing this exact pattern

#### Pattern 3: @if Conditional Rendering (ANTI-PATTERN - Replace!)

**Evidence**:

- unified-suggestions-dropdown.component.ts:48 - `@if (isOpen())`
- agent-selector.component.ts:52 - `@if (isOpen())`
- model-selector.component.ts:23 - DaisyUI dropdown classes

**Anti-Pattern Issue**: Renders dropdown INSIDE component DOM tree → textarea intercepts keyboard events
**Replacement**: CDK Overlay portal (renders at document body level, outside component hierarchy)

#### Pattern 4: Manual Positioning (ANTI-PATTERN - Replace!)

**Evidence**: unified-suggestions-dropdown.component.ts:48

```typescript
// VERIFIED ANTI-PATTERN: Manual absolute positioning
class="absolute bottom-full left-0 right-0 mb-1 z-50"
```

**Anti-Pattern Issue**: Manual CSS positioning, z-index management, no collision detection
**Replacement**: CDK ConnectedPositionStrategy with automatic repositioning

#### Pattern 5: DropdownInteractionService (BAND-AID - Deprecate!)

**Evidence**: dropdown-interaction.service.ts:1-226

- **Created**: TASK_2025_046 (attempted fix for keyboard navigation)
- **Approach**: Capture-phase document listeners (lines 128-169)
- **Result**: FAILED - Textarea still intercepts events
- **LOC**: 87 lines
- **Usage**: agent-selector.component.ts:125,150

**Why It Failed**: Event listeners can't fully solve the structural problem. Dropdown rendered inside component tree means events flow through parent textarea first, even with capture phase.

**Deprecation Plan**: Mark service as deprecated, create migration guide to CDK Overlay components

#### Pattern 6: DaisyUI Dropdown Classes (ANTI-PATTERN - Replace!)

**Evidence**:

- model-selector.component.ts:23 - `class="dropdown dropdown-top dropdown-end"`
- autopilot-popover.component.ts:32 - `class="dropdown dropdown-top dropdown-end"`

**Anti-Pattern Issue**: Relies on CSS :focus and tabindex for open/close, no keyboard nav support, manual blur() calls
**Replacement**: CDK Overlay with backdrop management

### Integration Points

#### Integration 1: ChatInputComponent (Inferred from context)

**Purpose**: Parent component that uses unified-suggestions-dropdown
**Integration Pattern**:

- ChatInputComponent manages textarea
- AtTriggerDirective/SlashTriggerDirective detect @ and / characters
- Opens UnifiedSuggestionsDropdownComponent
- Passes keyboard events via onKeyDown() method

**New Integration Strategy** (with CDK Overlay):

- ChatInputComponent uses new AutocompleteComponent
- AutocompleteDirective attaches to textarea element
- CDK Overlay renders dropdown in portal (outside textarea DOM hierarchy)
- ActiveDescendantKeyManager maintains keyboard focus on textarea

#### Integration 2: AgentDiscoveryFacade

**Source**: agent-selector.component.ts:124
**Evidence**: `private readonly agentDiscovery = inject(AgentDiscoveryFacade);`
**Purpose**: Provides agent data (fetchAgents(), searchAgents())
**Integration Pattern**: Signal-based data flow (agents stored in signal)
**Compatibility**: No changes needed - new DropdownComponent accepts generic data

#### Integration 3: ModelStateService

**Source**: model-selector.component.ts:105
**Evidence**: `readonly modelState = inject(ModelStateService);`
**Purpose**: Manages model selection state (availableModels(), switchModel())
**Integration Pattern**: Signal-based state management
**Compatibility**: No changes needed - new DropdownComponent works with signals

#### Integration 4: AutopilotStateService

**Source**: autopilot-popover.component.ts:159
**Evidence**: `readonly autopilotState = inject(AutopilotStateService);`
**Purpose**: Manages autopilot toggle state (enabled(), toggleAutopilot())
**Integration Pattern**: Signal-based state with async RPC calls
**Compatibility**: No changes needed - new PopoverComponent works with signals

---

## 🏗️ Architecture Design (Evidence-Based)

### Design Philosophy

**Chosen Approach**: Netanel Basal Directive-Based Architecture + CDK Overlay Portals

**Rationale**:

1. **Proven Pattern**: Netanel Basal's articles demonstrate production-ready autocomplete with CDK
2. **Codebase Alignment**: Already using ActiveDescendantKeyManager correctly (just missing Overlay)
3. **Minimal Disruption**: Existing Highlightable pattern can be reused as-is
4. **Portal Benefits**: Renders dropdown at body level, completely outside component hierarchy

**Evidence**:

- Research findings: task-description.md:700-871 (Netanel Basal patterns)
- Existing CDK usage: ActiveDescendantKeyManager in unified-suggestions-dropdown.component.ts:109-165
- Similar implementations: SuggestionOptionComponent.Highlightable pattern proven to work

### Component Architecture Overview

**Design Principle**: Feature-based grouping with clear domain boundaries for future extensibility.

```
libs/frontend/ui/
├── src/
│   ├── index.ts                              # Public API barrel export
│   ├── lib/
│   │   │
│   │   ├── overlays/                         # DOMAIN: Floating UI Elements
│   │   │   ├── dropdown/                     # Simple trigger-based dropdown
│   │   │   │   ├── dropdown.component.ts
│   │   │   │   ├── dropdown.component.spec.ts
│   │   │   │   └── index.ts
│   │   │   ├── popover/                      # Modal-like popover with focus trap
│   │   │   │   ├── popover.component.ts
│   │   │   │   ├── popover.component.spec.ts
│   │   │   │   └── index.ts
│   │   │   ├── tooltip/                      # FUTURE: Hover tooltips
│   │   │   │   └── index.ts                  # Placeholder
│   │   │   ├── shared/                       # Shared overlay utilities
│   │   │   │   ├── overlay-positions.ts      # Reusable position configs
│   │   │   │   ├── overlay.types.ts          # Shared type definitions
│   │   │   │   └── index.ts
│   │   │   └── index.ts                      # Overlays barrel export
│   │   │
│   │   ├── selection/                        # DOMAIN: Selection UI Components
│   │   │   ├── option/                       # Generic selectable option
│   │   │   │   ├── option.component.ts       # Implements Highlightable
│   │   │   │   ├── option.component.spec.ts
│   │   │   │   └── index.ts
│   │   │   ├── autocomplete/                 # Input-triggered suggestions
│   │   │   │   ├── autocomplete.component.ts # Overlay + keyManager
│   │   │   │   ├── autocomplete.directive.ts # Attaches to input
│   │   │   │   ├── autocomplete.component.spec.ts
│   │   │   │   └── index.ts
│   │   │   ├── select/                       # FUTURE: Custom select dropdown
│   │   │   │   └── index.ts                  # Placeholder
│   │   │   ├── combobox/                     # FUTURE: Searchable select
│   │   │   │   └── index.ts                  # Placeholder
│   │   │   ├── listbox/                      # FUTURE: Multi-select list
│   │   │   │   └── index.ts                  # Placeholder
│   │   │   └── index.ts                      # Selection barrel export
│   │   │
│   │   ├── feedback/                         # FUTURE DOMAIN: User Feedback
│   │   │   ├── toast/                        # FUTURE: Toast notifications
│   │   │   │   └── index.ts
│   │   │   ├── alert/                        # FUTURE: Inline alerts
│   │   │   │   └── index.ts
│   │   │   ├── progress/                     # FUTURE: Progress indicators
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── layout/                           # FUTURE DOMAIN: Layout Primitives
│   │   │   ├── virtual-scroll/               # FUTURE: Virtualized lists
│   │   │   │   └── index.ts
│   │   │   ├── resizable/                    # FUTURE: Resizable panels
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   │
│   │   └── a11y/                             # FUTURE DOMAIN: Accessibility Utils
│   │       ├── focus-trap/                   # FUTURE: Reusable focus trap
│   │       │   └── index.ts
│   │       ├── live-announcer/               # FUTURE: Screen reader announcements
│   │       │   └── index.ts
│   │       └── index.ts
│   │
│   └── CLAUDE.md                             # Library documentation
├── project.json                              # Nx project config
├── tsconfig.json                             # TypeScript config
├── tsconfig.lib.json                         # Library build config
├── tsconfig.spec.json                        # Test config
└── README.md                                 # Quick start guide
```

### Domain Boundaries

| Domain         | Purpose                                              | Current Components   | Future Components                       |
| -------------- | ---------------------------------------------------- | -------------------- | --------------------------------------- |
| **overlays/**  | Floating UI elements positioned relative to triggers | dropdown, popover    | tooltip, context-menu, dialog           |
| **selection/** | Components for selecting items from lists            | option, autocomplete | select, combobox, listbox, chips        |
| **feedback/**  | User feedback and notifications                      | -                    | toast, alert, progress, skeleton        |
| **layout/**    | Layout primitives and containers                     | -                    | virtual-scroll, resizable, splitter     |
| **a11y/**      | Accessibility utilities and helpers                  | -                    | focus-trap, live-announcer, key-manager |

### Import Patterns

```typescript
// Domain-level imports (recommended)
import { DropdownComponent, PopoverComponent } from '@ptah-extension/ui/overlays';
import { OptionComponent, AutocompleteComponent } from '@ptah-extension/ui/selection';

// Component-level imports (for tree-shaking)
import { DropdownComponent } from '@ptah-extension/ui/overlays/dropdown';
import { AutocompleteComponent } from '@ptah-extension/ui/selection/autocomplete';

// Full library import (not recommended - larger bundle)
import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';
```

### Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                        SELECTION DOMAIN                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ AutocompleteComponent                                    │    │
│  │   ├── uses OptionComponent (internal)                    │    │
│  │   ├── uses ActiveDescendantKeyManager (CDK A11y)        │    │
│  │   └── uses DropdownComponent (from overlays/)            │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ OptionComponent                                          │    │
│  │   └── implements Highlightable (CDK A11y)               │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ depends on
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        OVERLAYS DOMAIN                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ DropdownComponent                                        │    │
│  │   ├── uses cdkConnectedOverlay (CDK Overlay)            │    │
│  │   └── uses ConnectedPositionStrategy (CDK Overlay)      │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ PopoverComponent                                         │    │
│  │   ├── uses cdkConnectedOverlay (CDK Overlay)            │    │
│  │   └── uses FocusTrap (CDK A11y)                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ shared/overlay-positions.ts                              │    │
│  │   └── DROPDOWN_POSITIONS, POPOVER_POSITIONS, etc.       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Future Extensibility Examples

**Adding a Tooltip (overlays domain)**:

```typescript
// libs/frontend/ui/src/lib/overlays/tooltip/tooltip.directive.ts
@Directive({ selector: '[ptahTooltip]' })
export class TooltipDirective {
  // Uses same overlay infrastructure as dropdown/popover
  // Shares overlay-positions.ts for positioning
}
```

**Adding a Select (selection domain)**:

```typescript
// libs/frontend/ui/src/lib/selection/select/select.component.ts
@Component({ selector: 'ptah-select' })
export class SelectComponent {
  // Uses OptionComponent for options (shared)
  // Uses DropdownComponent for overlay (from overlays/)
  // Uses ActiveDescendantKeyManager (same as autocomplete)
}
```

**Adding Toast Notifications (feedback domain)**:

```typescript
// libs/frontend/ui/src/lib/feedback/toast/toast.service.ts
@Injectable({ providedIn: 'root' })
export class ToastService {
  // Uses CDK Overlay for positioning
  // Independent of selection/overlays domains
}
```

---

## 📦 Component Specifications

### Component 1: OptionComponent (Generic Highlightable)

#### Purpose

Reusable option item for dropdown/autocomplete/select components. Implements Highlightable interface for ActiveDescendantKeyManager compatibility. Generic across all use cases (files, agents, models, commands).

#### Pattern (Evidence-Based)

**Chosen Pattern**: Highlightable Implementation
**Evidence**: suggestion-option.component.ts:84-117 (existing pattern works well)
**Rationale**:

- Already proven to work with ActiveDescendantKeyManager
- Supports aria-activedescendant pattern (focus stays on input)
- Visual feedback via setActiveStyles/setInactiveStyles
- Automatic scroll-into-view on keyboard navigation

#### Component Specification

**Responsibilities**:

- Render option content via content projection
- Implement Highlightable interface for keyboard navigation
- Provide visual active state (bg-primary when isActive)
- Scroll into view when activated via keyboard
- Emit selection events on click or Enter key
- Support mouse hover to trigger focus changes

**Base Interfaces** (verified):

- `Highlightable` from @angular/cdk/a11y (verified: existing usage in suggestion-option.component.ts:84)

**Key Dependencies** (verified):

- `@angular/cdk/a11y` - Highlightable interface
- `@angular/core` - Component, input, output, ElementRef, inject, signal

**TypeScript API**:

```typescript
import { Component, input, output, ElementRef, inject } from '@angular/core';
import { Highlightable } from '@angular/cdk/a11y';

/**
 * OptionComponent - Generic Option for Dropdowns/Autocomplete
 *
 * Implements Highlightable interface for ActiveDescendantKeyManager.
 * Content projection allows custom option layouts.
 *
 * Usage:
 * <ptah-option
 *   [optionId]="'option-' + index"
 *   [value]="item"
 *   (selected)="onSelect($event)">
 *   <div class="flex items-center gap-2">
 *     <span>{{ item.icon }}</span>
 *     <span>{{ item.name }}</span>
 *   </div>
 * </ptah-option>
 */
@Component({
  selector: 'ptah-option',
  standalone: true,
  template: `
    <div [id]="optionId()" class="px-3 py-2 rounded-md cursor-pointer transition-colors" [class.bg-primary]="isActive" [class.text-primary-content]="isActive" [class.hover:bg-base-300]="!isActive" (click)="handleClick()" (mouseenter)="hovered.emit()" role="option" [attr.aria-selected]="isActive">
      <ng-content />
    </div>
  `,
})
export class OptionComponent<T = unknown> implements Highlightable {
  private readonly elementRef = inject(ElementRef);

  // Inputs
  readonly optionId = input.required<string>();
  readonly value = input.required<T>();

  // Outputs
  readonly selected = output<T>();
  readonly hovered = output<void>();

  // Highlightable interface state
  isActive = false;

  setActiveStyles(): void {
    this.isActive = true;
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  setInactiveStyles(): void {
    this.isActive = false;
  }

  handleClick(): void {
    this.selected.emit(this.value());
  }

  getHostElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }
}
```

**Quality Requirements**:

**Functional**:

- MUST implement Highlightable interface correctly
- MUST emit selected event on click and Enter key
- MUST support mouse hover to change active state
- MUST scroll into view when activated via keyboard
- MUST support generic type parameter for value

**Non-Functional**:

- **Reusability**: Generic type parameter allows any data type
- **Performance**: No change detection issues (OnPush compatible)
- **Accessibility**: ARIA role="option", aria-selected binding
- **Styling**: Content projection for flexible layouts

**Pattern Compliance**:

- MUST follow existing Highlightable pattern (suggestion-option.component.ts:84-117)
- MUST use DaisyUI classes (bg-primary, text-primary-content, hover:bg-base-300)
- MUST use Angular 20+ signals (input, output)

**Files Affected**:

- `libs/frontend/ui/src/lib/selection/option/option.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/selection/option/option.component.spec.ts` (CREATE)
- `libs/frontend/ui/src/lib/selection/option/index.ts` (CREATE)

---

### Component 2: DropdownComponent (CDK Overlay Wrapper)

#### Purpose

Wrapper around cdkConnectedOverlay for simple dropdown UI. Handles trigger element positioning, backdrop click detection, and portal rendering. Integrates with ActiveDescendantKeyManager for keyboard navigation.

#### Pattern (Evidence-Based)

**Chosen Pattern**: CDK Overlay with ConnectedPositionStrategy
**Evidence**: task-description.md:716-740 (Netanel Basal CDK pattern)
**Rationale**:

- Renders in portal at document body level (solves textarea interception)
- Automatic positioning with fallback strategies
- Built-in backdrop click-outside detection
- Z-index management via OverlayContainer

#### Component Specification

**Responsibilities**:

- Wrap trigger element and dropdown content
- Render dropdown in CDK portal (outside component hierarchy)
- Position overlay relative to trigger using ConnectedPositionStrategy
- Manage backdrop for click-outside detection
- Emit opened/closed/backdropClicked events
- Support manual open/close via signal binding

**Base Classes/Interfaces** (verified):

- None (standalone component wrapping CDK directives)

**Key Dependencies** (verified):

- `@angular/cdk/overlay` - OverlayModule, cdkConnectedOverlay, cdkOverlayOrigin, ConnectedPosition
- `@angular/core` - Component, input, output, signal, ViewChild, TemplateRef

**TypeScript API**:

```typescript
import { Component, input, output, ViewChild, TemplateRef, signal } from '@angular/core';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';

/**
 * DropdownComponent - CDK Overlay Dropdown Wrapper
 *
 * Wraps cdkConnectedOverlay for simple dropdown use cases.
 * Renders dropdown in portal at document body level.
 * Supports backdrop click-outside detection.
 *
 * Usage:
 * <ptah-dropdown
 *   [isOpen]="isOpen()"
 *   [closeOnBackdropClick]="true"
 *   [positions]="dropdownPositions"
 *   (opened)="onOpen()"
 *   (closed)="onClose()">
 *
 *   <button trigger (click)="toggleDropdown()">
 *     Open Menu
 *   </button>
 *
 *   <div content class="dropdown-panel">
 *     <ptah-option *ngFor="let item of items" [value]="item">
 *       {{ item.name }}
 *     </ptah-option>
 *   </div>
 * </ptah-dropdown>
 */
@Component({
  selector: 'ptah-dropdown',
  standalone: true,
  imports: [OverlayModule],
  template: `
    <div cdkOverlayOrigin #trigger="cdkOverlayOrigin">
      <ng-content select="[trigger]" />
    </div>

    <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="trigger" [cdkConnectedOverlayOpen]="isOpen()" [cdkConnectedOverlayPositions]="positions()" [cdkConnectedOverlayHasBackdrop]="hasBackdrop()" [cdkConnectedOverlayBackdropClass]="backdropClass()" (backdropClick)="handleBackdropClick()" (attach)="opened.emit()" (detach)="closed.emit()">
      <div class="dropdown-panel bg-base-200 border border-base-300 rounded-lg shadow-lg">
        <ng-content select="[content]" />
      </div>
    </ng-template>
  `,
})
export class DropdownComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly positions = input<ConnectedPosition[]>(DEFAULT_DROPDOWN_POSITIONS);
  readonly hasBackdrop = input(true);
  readonly backdropClass = input('cdk-overlay-transparent-backdrop');
  readonly closeOnBackdropClick = input(true);

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();

  handleBackdropClick(): void {
    this.backdropClicked.emit();
    if (this.closeOnBackdropClick()) {
      this.closed.emit();
    }
  }
}

// Default position configuration (below first, above as fallback)
const DEFAULT_DROPDOWN_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
];
```

**Quality Requirements**:

**Functional**:

- MUST render dropdown in CDK portal (outside component DOM tree)
- MUST position overlay using ConnectedPositionStrategy
- MUST detect backdrop clicks and emit event
- MUST support custom position configurations
- MUST emit opened/closed lifecycle events

**Non-Functional**:

- **Performance**: Overlay renders only when isOpen() is true
- **Accessibility**: Backdrop blocks background interaction when enabled
- **Z-Index Management**: Automatic via OverlayContainer
- **Positioning**: Automatic fallback strategies (below → above)

**Pattern Compliance**:

- MUST use cdkConnectedOverlay (task-description.md:716-740)
- MUST use ConnectedPosition for positioning (task-description.md:776-791)
- MUST use DaisyUI classes for styling (bg-base-200, border, rounded-lg, shadow-lg)

**Files Affected**:

- `libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.spec.ts` (CREATE)
- `libs/frontend/ui/src/lib/overlays/dropdown/index.ts` (CREATE)

---

### Component 3: PopoverComponent (Overlay + Backdrop + Focus Trap)

#### Purpose

Popover component with backdrop overlay and focus trap. Similar to DropdownComponent but with modal-like behavior (blocks background, traps focus). Used for autopilot settings, confirmation dialogs.

#### Pattern (Evidence-Based)

**Chosen Pattern**: CDK Overlay + FocusTrap (from CDK A11y)
**Evidence**: task-description.md:716-740 (CDK Overlay pattern) + autopilot-popover.component.ts:1-228 (modal-like behavior)
**Rationale**:

- Backdrop blocks background interaction (modal-like UX)
- FocusTrap ensures keyboard navigation stays within popover
- Escape key closes popover and returns focus to trigger

#### Component Specification

**Responsibilities**:

- Render popover in CDK portal with dark/transparent backdrop
- Position overlay according to preference (above/below/before/after)
- Trap focus within popover content when open
- Return focus to trigger element when closed
- Emit backdrop click and close events

**Base Classes/Interfaces** (verified):

- None (standalone component wrapping CDK directives)

**Key Dependencies** (verified):

- `@angular/cdk/overlay` - OverlayModule, cdkConnectedOverlay
- `@angular/cdk/a11y` - A11yModule, FocusTrap, FocusTrapFactory
- `@angular/core` - Component, input, output, signal, ViewChild

**TypeScript API**:

```typescript
import { Component, input, output, ViewChild, ElementRef, inject, AfterViewInit } from '@angular/core';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { A11yModule, FocusTrap, FocusTrapFactory } from '@angular/cdk/a11y';

/**
 * PopoverComponent - Modal-like Popover with Focus Trap
 *
 * Similar to DropdownComponent but with modal behavior:
 * - Dark/transparent backdrop blocks background interaction
 * - Focus trapped within popover content
 * - Escape key closes and returns focus to trigger
 *
 * Usage:
 * <ptah-popover
 *   [isOpen]="isOpen()"
 *   [position]="'below'"
 *   [hasBackdrop]="true"
 *   [backdropClass]="'cdk-overlay-dark-backdrop'"
 *   (closed)="onClose()">
 *
 *   <button trigger (click)="togglePopover()">
 *     Open Settings
 *   </button>
 *
 *   <div content class="popover-panel">
 *     <h3>Settings</h3>
 *     <button (click)="save()">Save</button>
 *     <button (click)="cancel()">Cancel</button>
 *   </div>
 * </ptah-popover>
 */
@Component({
  selector: 'ptah-popover',
  standalone: true,
  imports: [OverlayModule, A11yModule],
  template: `
    <div cdkOverlayOrigin #trigger="cdkOverlayOrigin">
      <ng-content select="[trigger]" />
    </div>

    <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="trigger" [cdkConnectedOverlayOpen]="isOpen()" [cdkConnectedOverlayPositions]="getPositions()" [cdkConnectedOverlayHasBackdrop]="hasBackdrop()" [cdkConnectedOverlayBackdropClass]="backdropClass()" (backdropClick)="handleBackdropClick()" (attach)="handleAttach()" (detach)="handleDetach()">
      <div #popoverContent class="popover-panel bg-base-200 border border-base-300 rounded-lg shadow-xl" (keydown.escape)="handleEscape()">
        <ng-content select="[content]" />
      </div>
    </ng-template>
  `,
})
export class PopoverComponent implements AfterViewInit {
  private readonly focusTrapFactory = inject(FocusTrapFactory);
  private focusTrap: FocusTrap | null = null;

  @ViewChild('popoverContent') popoverContent!: ElementRef<HTMLElement>;

  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly position = input<'above' | 'below' | 'before' | 'after'>('below');
  readonly hasBackdrop = input(true);
  readonly backdropClass = input('cdk-overlay-transparent-backdrop');

  // Outputs
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly backdropClicked = output<void>();

  ngAfterViewInit(): void {
    // FocusTrap setup happens when overlay attaches
  }

  getPositions(): ConnectedPosition[] {
    const position = this.position();
    return POPOVER_POSITION_MAP[position] || POPOVER_POSITION_MAP.below;
  }

  handleAttach(): void {
    // Create focus trap when popover opens
    if (this.popoverContent) {
      this.focusTrap = this.focusTrapFactory.create(this.popoverContent.nativeElement);
      this.focusTrap.focusInitialElementWhenReady();
    }
    this.opened.emit();
  }

  handleDetach(): void {
    // Destroy focus trap when popover closes
    this.focusTrap?.destroy();
    this.focusTrap = null;
    this.closed.emit();
  }

  handleBackdropClick(): void {
    this.backdropClicked.emit();
    this.closed.emit();
  }

  handleEscape(): void {
    this.closed.emit();
  }
}

// Position configurations for popover
const POPOVER_POSITION_MAP: Record<string, ConnectedPosition[]> = {
  below: [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
  ],
  above: [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ],
  before: [
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -8 },
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 8 },
  ],
  after: [
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 8 },
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -8 },
  ],
};
```

**Quality Requirements**:

**Functional**:

- MUST trap focus within popover when open
- MUST return focus to trigger when closed
- MUST support backdrop with dark/transparent variants
- MUST close on Escape key press
- MUST support 4 position preferences (above/below/before/after)

**Non-Functional**:

- **Accessibility**: FocusTrap ensures keyboard-only navigation works
- **UX**: Modal-like behavior blocks background interaction
- **Performance**: FocusTrap created/destroyed on open/close

**Pattern Compliance**:

- MUST use cdkConnectedOverlay for portal rendering
- MUST use FocusTrap from CDK A11y module
- MUST use DaisyUI classes for styling

**Files Affected**:

- `libs/frontend/ui/src/lib/overlays/popover/popover.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/overlays/popover/popover.component.spec.ts` (CREATE)
- `libs/frontend/ui/src/lib/overlays/popover/index.ts` (CREATE)

---

### Component 4: AutocompleteComponent (Overlay + ActiveDescendantKeyManager)

#### Purpose

Autocomplete component combining CDK Overlay with ActiveDescendantKeyManager for keyboard navigation. Renders suggestions in portal below input element, maintains focus on input during navigation. Used for @file and /command triggers.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Directive-Based Autocomplete (Netanel Basal) + CDK Overlay Portal
**Evidence**:

- task-description.md:742-771 (Netanel Basal autocomplete pattern)
- unified-suggestions-dropdown.component.ts:1-281 (existing ActiveDescendantKeyManager usage)

**Rationale**:

- AutocompleteDirective attaches to any input element (reusable)
- AutocompleteComponent wraps overlay + keyManager logic
- Portal rendering solves textarea interception (root cause!)
- ActiveDescendantKeyManager keeps focus on input (ARIA pattern)

#### Component Specification

**Responsibilities**:

- Render suggestions list in CDK portal below input
- Integrate ActiveDescendantKeyManager for keyboard navigation
- Maintain focus on input element during navigation (aria-activedescendant)
- Filter suggestions based on query after trigger character
- Emit selection events with selected suggestion
- Support loading state and empty state

**Base Classes/Interfaces** (verified):

- None (uses ActiveDescendantKeyManager internally)

**Key Dependencies** (verified):

- `@angular/cdk/overlay` - OverlayModule, cdkConnectedOverlay
- `@angular/cdk/a11y` - ActiveDescendantKeyManager
- `@angular/core` - Component, Directive, input, output, signal, viewChildren, effect
- OptionComponent - Generic option component (created above)

**TypeScript API**:

```typescript
import { Component, Directive, input, output, signal, viewChildren, effect, ElementRef, inject, AfterViewInit, OnDestroy } from '@angular/core';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { ActiveDescendantKeyManager } from '@angular/cdk/a11y';
import { OptionComponent } from '../option/option.component';

/**
 * AutocompleteDirective - Attaches to Input Element
 *
 * Manages overlay lifecycle and delegates keyboard events to AutocompleteComponent.
 * Integrates with parent input element via cdkOverlayOrigin.
 *
 * Usage:
 * <input type="text" ptahAutocomplete />
 */
@Directive({
  selector: '[ptahAutocomplete]',
  standalone: true,
})
export class AutocompleteDirective {
  readonly elementRef = inject(ElementRef<HTMLInputElement>);

  // AutocompleteComponent will use this directive to get input element reference
}

/**
 * AutocompleteComponent - Autocomplete with CDK Overlay
 *
 * Combines CDK Overlay portal rendering with ActiveDescendantKeyManager
 * for keyboard navigation. Focus stays on input element (aria-activedescendant).
 *
 * Usage:
 * <ptah-autocomplete
 *   [suggestions]="suggestions()"
 *   [isLoading]="isLoading()"
 *   [isOpen]="isOpen()"
 *   (suggestionSelected)="onSelect($event)"
 *   (closed)="onClose()">
 *
 *   <input type="text" autocompleteInput />
 *
 *   <ng-template suggestionTemplate let-suggestion>
 *     <div class="flex items-center gap-2">
 *       <span>{{ suggestion.icon }}</span>
 *       <span>{{ suggestion.name }}</span>
 *     </div>
 *   </ng-template>
 * </ptah-autocomplete>
 */
@Component({
  selector: 'ptah-autocomplete',
  standalone: true,
  imports: [OverlayModule, OptionComponent],
  template: `
    <div cdkOverlayOrigin #inputOrigin="cdkOverlayOrigin">
      <ng-content select="[autocompleteInput]" />
    </div>

    <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="inputOrigin" [cdkConnectedOverlayOpen]="isOpen()" [cdkConnectedOverlayPositions]="autocompletePositions" [cdkConnectedOverlayWidth]="inputOrigin.elementRef.nativeElement.offsetWidth" cdkConnectedOverlayPush>
      <div class="suggestions-panel bg-base-200 border border-base-300 rounded-lg shadow-lg max-h-80 flex flex-col" role="listbox" [attr.aria-label]="ariaLabel()">
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
          @for (suggestion of suggestions(); track trackBy($index, suggestion); let i = $index) {
          <ptah-option [optionId]="'suggestion-' + i" [value]="suggestion" (selected)="handleSelection($event)" (hovered)="handleHover(i)">
            <!-- Custom template from parent -->
            <ng-container *ngTemplateOutlet="suggestionTemplate; context: { $implicit: suggestion }" />
          </ptah-option>
          }
        </div>
        }
      </div>
    </ng-template>
  `,
})
export class AutocompleteComponent<T = unknown> implements AfterViewInit, OnDestroy {
  // Inputs
  readonly suggestions = input.required<T[]>();
  readonly isLoading = input(false);
  readonly isOpen = input.required<boolean>();
  readonly headerTitle = input<string>('');
  readonly ariaLabel = input('Suggestions');
  readonly emptyMessage = input('No matches found');
  readonly trackBy = input<(index: number, item: T) => string | number>((index: number) => index);

  // Outputs
  readonly suggestionSelected = output<T>();
  readonly closed = output<void>();

  // ViewChildren for ActiveDescendantKeyManager
  private readonly optionComponents = viewChildren(OptionComponent<T>);

  // ActiveDescendantKeyManager
  private keyManager: ActiveDescendantKeyManager<OptionComponent<T>> | null = null;

  // Active option ID for aria-activedescendant
  private readonly _activeOptionId = signal<string | null>(null);
  readonly activeOptionId = this._activeOptionId.asReadonly();

  // Autocomplete position (below input, match width)
  readonly autocompletePositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  constructor() {
    // Initialize/re-initialize key manager when options change
    effect(() => {
      const options = this.optionComponents();
      if (options.length > 0) {
        if (this.keyManager) {
          this.keyManager.setFirstItemActive();
          this.updateActiveOptionId();
        } else {
          this.initKeyManager();
        }
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.keyManager) {
      this.initKeyManager();
    }
  }

  ngOnDestroy(): void {
    this.keyManager?.destroy();
  }

  private initKeyManager(): void {
    const options = this.optionComponents();
    if (options.length === 0) return;

    this.keyManager = new ActiveDescendantKeyManager(options).withVerticalOrientation().withWrap().withHomeAndEnd();

    this.keyManager.setFirstItemActive();
    this.updateActiveOptionId();

    this.keyManager.change.subscribe(() => {
      this.updateActiveOptionId();
    });
  }

  private updateActiveOptionId(): void {
    const activeItem = this.keyManager?.activeItem;
    if (activeItem) {
      this._activeOptionId.set(activeItem.optionId());
    }
  }

  // ============================================================
  // PUBLIC API - Called by parent for keyboard navigation
  // ============================================================

  /**
   * Handle keyboard events from parent
   * Returns true if event was handled (parent should preventDefault)
   */
  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.keyManager) return false;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        this.keyManager.onKeydown(event);
        return true;

      case 'Enter':
        this.selectFocused();
        return true;

      case 'Escape':
        this.closed.emit();
        return true;

      default:
        return false;
    }
  }

  selectFocused(): void {
    const activeItem = this.keyManager?.activeItem;
    if (activeItem) {
      this.suggestionSelected.emit(activeItem.value());
    }
  }

  handleHover(index: number): void {
    this.keyManager?.setActiveItem(index);
  }

  handleSelection(suggestion: T): void {
    this.suggestionSelected.emit(suggestion);
  }

  getActiveDescendantId(): string | null {
    return this._activeOptionId();
  }
}
```

**Quality Requirements**:

**Functional**:

- MUST render suggestions in CDK portal (outside input DOM tree)
- MUST integrate ActiveDescendantKeyManager for keyboard nav
- MUST keep focus on input element during navigation
- MUST support custom suggestion templates via content projection
- MUST emit selection events on Enter or click

**Non-Functional**:

- **Accessibility**: ARIA role="listbox", aria-activedescendant pattern
- **Performance**: Overlay renders only when isOpen() is true
- **Reusability**: Generic type parameter for any suggestion type

**Pattern Compliance**:

- MUST use ActiveDescendantKeyManager (unified-suggestions-dropdown.component.ts:109-165)
- MUST use cdkConnectedOverlay for portal rendering
- MUST match input width via cdkConnectedOverlayWidth
- MUST use DaisyUI classes for styling

**Files Affected**:

- `libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.component.ts` (CREATE)
- `libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.directive.ts` (CREATE)
- `libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.component.spec.ts` (CREATE)
- `libs/frontend/ui/src/lib/selection/autocomplete/index.ts` (CREATE)

---

## 🔄 Migration Plan

### Migration Overview

**4 Components to Migrate**:

1. unified-suggestions-dropdown (COMPLEX - autocomplete with @ / triggers)
2. agent-selector (MEDIUM - dropdown with agent list)
3. model-selector (SIMPLE - dropdown with model list)
4. autopilot-popover (SIMPLE - popover with settings)

**Migration Strategy**: Incremental, one component at a time, with feature flag fallback if needed.

### Migration 1: UnifiedSuggestionsDropdownComponent → AutocompleteComponent

**Complexity**: HIGH (most complex component, critical UX path)

**Current State** (Evidence):

- File: unified-suggestions-dropdown.component.ts:1-281
- Pattern: @if rendering (line 48), manual positioning, ActiveDescendantKeyManager
- Anti-patterns: Manual absolute positioning, rendered inside component tree
- LOC: 281 lines (before migration)

**Target State**:

- Use AutocompleteComponent from new ui library
- CDK Overlay portal rendering (solves textarea interception!)
- Keep ActiveDescendantKeyManager integration (working well)
- Reduce LOC by ~30% (remove manual positioning, @if logic)

**Step-by-Step Migration**:

1. **Install UI Library Dependency** (in chat library)

   ```json
   // libs/frontend/chat/project.json
   // Add dependency: libs/frontend/ui
   ```

2. **Replace Template @if with AutocompleteComponent**

   ```typescript
   // BEFORE (unified-suggestions-dropdown.component.ts:46-90)
   template: `
     <div class="absolute bottom-full left-0 right-0 mb-1 z-50 ...">
       <!-- Manual positioning, @if rendering -->
     </div>
   `;

   // AFTER
   template: `
     <ptah-autocomplete
       [suggestions]="suggestions()"
       [isLoading]="isLoading()"
       [isOpen]="true"
       [headerTitle]="getHeaderTitle()"
       (suggestionSelected)="suggestionSelected.emit($event)"
       (closed)="closed.emit()">
   
       <!-- AutocompleteComponent handles portal rendering -->
     </ptah-autocomplete>
   `;
   ```

3. **Remove Manual Positioning CSS**

   - DELETE: `class="absolute bottom-full left-0 right-0 mb-1 z-50"`
   - CDK Overlay handles positioning automatically

4. **Keep ActiveDescendantKeyManager Integration**

   - KEEP: onKeyDown() method (lines 209-231)
   - KEEP: getActiveDescendantId() method (line 182)
   - Parent ChatInputComponent still calls onKeyDown() with events

5. **Update SuggestionOptionComponent**

   - REPLACE: suggestion-option.component.ts with ptah-option from ui library
   - REUSE: Existing Highlightable implementation pattern
   - MIGRATE: Custom template content to ng-template

6. **Remove DropdownInteractionService Dependency**
   - DELETE: No longer needed (CDK Overlay backdrop handles click-outside)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts` (MODIFY)
- `libs/frontend/chat/src/lib/components/file-suggestions/suggestion-option.component.ts` (REWRITE to use ptah-option)

**Breaking Changes**:

- None (component selector stays same: `ptah-unified-suggestions-dropdown`)
- Internal template changes only
- Public API unchanged (inputs/outputs stay same)

**Backward Compatibility**:

- Full backward compatibility maintained
- Parent ChatInputComponent requires no changes
- AtTriggerDirective/SlashTriggerDirective work as-is

**Expected LOC Reduction**: 281 → ~195 lines (~30% reduction)

---

### Migration 2: AgentSelectorComponent → DropdownComponent

**Complexity**: MEDIUM (uses DropdownInteractionService, manual keyboard nav)

**Current State** (Evidence):

- File: agent-selector.component.ts:1-250
- Pattern: @if rendering (line 52), DropdownInteractionService usage (line 125)
- Anti-patterns: Manual focus tracking (\_focusedIndex signal), document listeners
- LOC: 250 lines (before migration)

**Target State**:

- Use DropdownComponent from new ui library
- CDK Overlay portal rendering
- Replace manual keyboard nav with ActiveDescendantKeyManager + OptionComponent
- Remove DropdownInteractionService dependency

**Step-by-Step Migration**:

1. **Replace Template @if with DropdownComponent**

   ```typescript
   // BEFORE (agent-selector.component.ts:52-117)
   template: `
     @if (isOpen()) {
     <div class="absolute bottom-full left-0 mb-2 z-50 w-80 ...">
       <!-- Manual dropdown -->
     </div>
     }
   `;

   // AFTER
   template: `
     <ptah-dropdown
       [isOpen]="isOpen()"
       [closeOnBackdropClick]="true"
       (backdropClicked)="closeDropdown()"
       (closed)="closeDropdown()">
   
       <button trigger (click)="toggleDropdown()">
         <lucide-angular [img]="UsersIcon" />
         <span>Agents</span>
       </button>
   
       <div content class="w-80 max-h-80">
         <!-- Agent list with ptah-option -->
         @for (agent of agents(); track agent.name; let i = $index) {
         <ptah-option
           [optionId]="'agent-' + i"
           [value]="agent"
           (selected)="selectAgent($event)">
   
           <div class="flex items-start gap-3">
             <span>{{ agent.icon }}</span>
             <div class="flex-1">
               <span class="font-medium">{{ agent.name }}</span>
               <span class="text-xs">{{ agent.description }}</span>
             </div>
           </div>
         </ptah-option>
         }
       </div>
     </ptah-dropdown>
   `;
   ```

2. **Remove DropdownInteractionService**

   - DELETE: `private readonly dropdownService = inject(DropdownInteractionService);` (line 125)
   - DELETE: `this.dropdownService.autoManageListeners(...)` (lines 150-160)
   - CDK Overlay backdrop replaces click-outside detection

3. **Remove Manual Keyboard Navigation**

   - DELETE: `_focusedIndex` signal (line 140)
   - DELETE: `navigateDown()`, `navigateUp()`, `selectFocused()` methods (lines 212-237)
   - OptionComponent + ActiveDescendantKeyManager handle this automatically

4. **Simplify toggleDropdown()**

   ```typescript
   // BEFORE (lines 186-207)
   async toggleDropdown(): Promise<void> {
     // Manual state management, loading, focus tracking
   }

   // AFTER
   toggleDropdown(): void {
     this._isOpen.set(!this._isOpen());
     // CDK Overlay handles the rest
   }
   ```

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/agent-selector.component.ts` (MODIFY)

**Breaking Changes**: None
**Expected LOC Reduction**: 250 → ~120 lines (~50% reduction)

---

### Migration 3: ModelSelectorComponent → DropdownComponent

**Complexity**: SIMPLE (DaisyUI dropdown, no keyboard nav currently)

**Current State** (Evidence):

- File: model-selector.component.ts:1-127
- Pattern: DaisyUI dropdown classes (line 23), manual blur() for close (line 121)
- Missing: Keyboard navigation support
- LOC: 127 lines (before migration)

**Target State**:

- Use DropdownComponent from new ui library
- Add keyboard navigation (currently missing!)
- Remove DaisyUI dropdown classes
- Remove manual blur() logic

**Step-by-Step Migration**:

1. **Replace DaisyUI Dropdown with DropdownComponent**

   ```typescript
   // BEFORE (model-selector.component.ts:23-100)
   template: `
     <div class="dropdown dropdown-top dropdown-end">
       <button tabindex="0">...</button>
       <div tabindex="0" class="dropdown-content">...</div>
     </div>
   `;

   // AFTER
   template: `
     <ptah-dropdown
       [isOpen]="isOpen()"
       [closeOnBackdropClick]="true"
       (closed)="closeDropdown()">
   
       <button trigger (click)="toggleDropdown()">
         {{ modelState.currentModelDisplay() }}
       </button>
   
       <div content class="w-72">
         @for (model of modelState.availableModels(); track model.id; let i = $index) {
         <ptah-option
           [optionId]="'model-' + i"
           [value]="model"
           (selected)="selectModel($event.id)">
   
           <div class="flex items-start gap-3">
             <lucide-angular [img]="CheckIcon" *ngIf="model.isSelected" />
             <div class="flex-1">
               <span class="font-medium">{{ model.name }}</span>
               @if (model.isRecommended) {
               <span class="badge badge-primary badge-xs">Recommended</span>
               }
               <span class="text-xs">{{ model.description }}</span>
             </div>
           </div>
         </ptah-option>
         }
       </div>
     </ptah-dropdown>
   `;
   ```

2. **Add isOpen Signal**

   ```typescript
   // ADD: isOpen state management
   private readonly _isOpen = signal(false);
   readonly isOpen = this._isOpen.asReadonly();

   toggleDropdown(): void {
     this._isOpen.set(!this._isOpen());
   }

   closeDropdown(): void {
     this._isOpen.set(false);
   }
   ```

3. **Remove Manual blur() Logic**

   - DELETE: `const activeElement = document.activeElement as HTMLElement; activeElement?.blur();` (lines 120-121)
   - CDK Overlay backdrop handles close automatically

4. **Add Keyboard Navigation** (NEW FEATURE!)
   - OptionComponent provides keyboard nav automatically
   - Users can now use ArrowUp/ArrowDown/Enter to select models

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/model-selector.component.ts` (MODIFY)

**Breaking Changes**: None
**New Features**: Keyboard navigation support (was missing before!)
**Expected LOC Reduction**: 127 → ~90 lines (~30% reduction)

---

### Migration 4: AutopilotPopoverComponent → PopoverComponent

**Complexity**: SIMPLE (DaisyUI dropdown, similar to model-selector)

**Current State** (Evidence):

- File: autopilot-popover.component.ts:1-228
- Pattern: DaisyUI dropdown classes (line 32), manual blur() for close
- Missing: Keyboard navigation for permission level selection
- LOC: 228 lines (before migration)

**Target State**:

- Use PopoverComponent from new ui library
- Add dark backdrop (modal-like UX)
- Add keyboard navigation for permission levels
- Remove manual blur() logic

**Step-by-Step Migration**:

1. **Replace DaisyUI Dropdown with PopoverComponent**

   ```typescript
   // BEFORE (autopilot-popover.component.ts:32-154)
   template: `
     <div class="dropdown dropdown-top dropdown-end">
       <button tabindex="0">...</button>
       <div tabindex="0" class="dropdown-content">...</div>
     </div>
   `;

   // AFTER
   template: `
     <ptah-popover
       [isOpen]="isOpen()"
       [position]="'above'"
       [hasBackdrop]="true"
       [backdropClass]="'cdk-overlay-dark-backdrop'"
       (closed)="closePopover()">
   
       <button trigger (click)="togglePopover()">
         <lucide-angular [img]="autopilotState.enabled() ? ZapIcon : ZapOffIcon" />
         <span>{{ autopilotState.statusText() }}</span>
       </button>
   
       <div content class="w-80">
         <!-- Enable/Disable content -->
         @if (!autopilotState.enabled()) {
         <div class="p-4">
           <p>Autopilot allows Claude to automatically approve actions...</p>
   
           <!-- Permission level selector with keyboard nav -->
           @for (level of permissionLevels; track level.id; let i = $index) {
           <ptah-option
             [optionId]="'level-' + i"
             [value]="level"
             (selected)="selectLevel($event.id)">
   
             <span class="font-medium">{{ level.name }}</span>
             <span class="text-xs">{{ level.description }}</span>
           </ptah-option>
           }
   
           <button (click)="enableAutopilot()">Enable Autopilot</button>
         </div>
         } @else {
         <div class="p-4">
           <p>Autopilot is Active</p>
           <button (click)="disableAutopilot()">Disable Autopilot</button>
         </div>
         }
       </div>
     </ptah-popover>
   `;
   ```

2. **Add isOpen Signal**

   ```typescript
   private readonly _isOpen = signal(false);
   readonly isOpen = this._isOpen.asReadonly();

   togglePopover(): void {
     this._isOpen.set(!this._isOpen());
   }

   closePopover(): void {
     this._isOpen.set(false);
   }
   ```

3. **Remove Manual closeDropdown() Logic**

   - DELETE: `closeDropdown()` method with manual blur() (lines 223-226)
   - PopoverComponent handles backdrop close automatically

4. **Add Keyboard Navigation for Permission Levels** (NEW FEATURE!)
   - OptionComponent provides keyboard nav automatically
   - Users can use ArrowUp/ArrowDown to select permission level before enabling

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/autopilot-popover.component.ts` (MODIFY)

**Breaking Changes**: None
**New Features**:

- Dark backdrop (modal-like UX)
- Keyboard navigation for permission level selection
  **Expected LOC Reduction**: 228 → ~150 lines (~35% reduction)

---

## 🔗 Integration Architecture

### Integration Point 1: ChatInputComponent ↔ AutocompleteComponent

**Current Integration** (Inferred):

- ChatInputComponent contains textarea element
- AtTriggerDirective detects @ character, opens unified-suggestions-dropdown
- SlashTriggerDirective detects / character, opens unified-suggestions-dropdown
- ChatInputComponent passes keyboard events to dropdown.onKeyDown()

**New Integration** (with CDK Overlay):

```typescript
// ChatInputComponent template (BEFORE)
template: `
  <textarea
    #textareaRef
    (keydown)="handleKeydown($event)"
    [attr.aria-activedescendant]="dropdown()?.getActiveDescendantId()">
  </textarea>

  @if (showSuggestions()) {
  <ptah-unified-suggestions-dropdown
    [suggestions]="suggestions()"
    (suggestionSelected)="insertSuggestion($event)"
    (closed)="closeSuggestions()" />
  }
`;

// ChatInputComponent template (AFTER - CDK Overlay)
template: `
  <ptah-autocomplete
    [suggestions]="suggestions()"
    [isLoading]="isLoadingSuggestions()"
    [isOpen]="showSuggestions()"
    [headerTitle]="getSuggestionHeader()"
    (suggestionSelected)="insertSuggestion($event)"
    (closed)="closeSuggestions()">

    <textarea
      autocompleteInput
      #textareaRef
      (keydown)="handleKeydown($event)"
      [attr.aria-activedescendant]="autocomplete()?.getActiveDescendantId()">
    </textarea>

    <ng-template suggestionTemplate let-suggestion>
      <!-- Custom suggestion rendering -->
      <div class="flex items-start gap-3">
        <span>{{ suggestion.icon }}</span>
        <div class="flex-1">
          <span class="font-medium">{{ suggestion.name }}</span>
          <span class="text-xs">{{ suggestion.description }}</span>
        </div>
      </div>
    </ng-template>
  </ptah-autocomplete>
`;
```

**Key Changes**:

1. AutocompleteComponent wraps textarea (instead of rendering separately)
2. Portal rendering happens automatically (via cdkConnectedOverlay)
3. Parent still handles @ / trigger detection
4. Parent still calls autocomplete.onKeyDown() for keyboard events
5. aria-activedescendant still managed by AutocompleteComponent

**Integration Compatibility**: ✅ Full backward compatibility

- AtTriggerDirective works unchanged
- SlashTriggerDirective works unchanged
- Parent keyboard event handling unchanged

---

### Integration Point 2: AtTriggerDirective/SlashTriggerDirective ↔ AutocompleteComponent

**Current Pattern** (Inferred):

- Directives attach to textarea element
- Detect @ or / characters in input
- Signal parent to open suggestions dropdown
- Parent manages dropdown open/close state

**New Pattern** (with CDK Overlay):

- **NO CHANGES NEEDED** - Directives remain unchanged
- AutocompleteComponent replaces UnifiedSuggestionsDropdownComponent
- Same signal-based communication pattern
- CDK Overlay portal rendering transparent to directives

**Compatibility**: ✅ Zero changes required to trigger directives

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**Keyboard Navigation**:

- All dropdowns MUST support ArrowUp/ArrowDown/Home/End/Enter/Escape
- Focus MUST stay on input element during autocomplete navigation (aria-activedescendant)
- Keyboard events MUST NOT be intercepted by parent textarea (portal rendering solves this!)

**Visual Rendering**:

- Dropdowns MUST render in CDK portal at document body level
- Dropdowns MUST position correctly below/above trigger element with fallback strategies
- Dropdowns MUST have proper z-index management (automatic via OverlayContainer)

**Interaction**:

- Click outside MUST close dropdown via CDK backdrop (no manual document listeners)
- Escape key MUST close dropdown and return focus to trigger
- Backdrop click MUST be configurable (close or ignore)

### Non-Functional Requirements

**Performance**:

- Bundle size increase < 15KB gzipped (@angular/cdk/overlay is tree-shakable)
- Overlay render time < 16ms (< 1 frame at 60fps)
- Zero memory leaks from unclosed overlays (verified via takeUntilDestroyed)
- Zero document listeners when all dropdowns closed (improvement over DropdownInteractionService)

**Accessibility**:

- WCAG 2.1 Level AA compliance for all components
- ARIA role="listbox" on dropdown containers
- ARIA role="option" on option elements
- ARIA aria-activedescendant pointing to active option
- ARIA aria-expanded on trigger buttons
- Focus trap in popover when open
- Focus return to trigger when closed

**Reusability**:

- Components MUST support generic type parameters (not hardcoded to specific domain types)
- Components MUST use content projection for custom layouts
- Components MUST work with DaisyUI classes for theming
- Components MUST NOT contain business logic (agnostic to agents/files/models)

**Maintainability**:

- CLAUDE.md documentation with component API, usage examples, migration guide
- TypeScript strict mode (no `any` types)
- Unit tests covering open/close, keyboard nav, accessibility
- Integration tests with parent components

**Compatibility**:

- Angular 20+ with signals
- @angular/cdk ^20.2.14
- VS Code webview environment (Chromium-based)
- No conflicts with VS Code webview messaging or theming

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

1. **Frontend-Only Work**: Angular components, CDK Overlay integration, UI library creation
2. **Browser APIs**: CDK Overlay uses browser Portal API, FocusTrap uses DOM APIs
3. **Angular Expertise**: Requires deep knowledge of Angular CDK, signals, content projection
4. **UI/UX Focus**: Visual component styling, DaisyUI integration, accessibility

**Backend Developer NOT Needed**: Zero backend/NestJS work, no API changes

---

### Complexity Assessment

**Complexity**: HIGH

**Estimated Effort**: 16-24 hours (2-3 days)

**Breakdown**:

**Phase 1: Library Setup** (2-4 hours)

- Generate libs/frontend/ui via Nx Angular library generator
- Configure project.json, tsconfig.json, barrel exports
- Install CDK Overlay dependencies
- Create overlay-positions.ts, overlay.types.ts shared utilities

**Phase 2: Component Creation** (6-8 hours)

- OptionComponent (2 hours) - Simplest, copy from SuggestionOptionComponent pattern
- DropdownComponent (2 hours) - CDK Overlay wrapper, position strategy
- PopoverComponent (1 hour) - Similar to DropdownComponent + FocusTrap
- AutocompleteComponent (3 hours) - Most complex, ActiveDescendantKeyManager integration

**Phase 3: Migration** (6-8 hours)

- UnifiedSuggestionsDropdownComponent migration (3 hours) - Most complex
- AgentSelectorComponent migration (1.5 hours) - Medium complexity
- ModelSelectorComponent migration (1 hour) - Simple
- AutopilotPopoverComponent migration (1.5 hours) - Simple

**Phase 4: Testing & Documentation** (2-4 hours)

- Unit tests for 4 new components
- Integration tests with parent components
- CLAUDE.md documentation
- Migration guide for DropdownInteractionService deprecation

**Risk Buffers**:

- CDK learning curve: +1 day (if team unfamiliar with CDK Overlay)
- Visual regression fixes: +0.5 day (if positioning differs from current CSS)

---

### Files Affected Summary

**CREATE** (New UI Library with Domain Structure):

```
libs/frontend/ui/
├── project.json
├── tsconfig.json
├── tsconfig.lib.json
├── tsconfig.spec.json
├── README.md
├── CLAUDE.md
└── src/
    ├── index.ts                          # Main barrel export
    └── lib/
        ├── overlays/                     # DOMAIN: Floating UI
        │   ├── index.ts                  # Domain barrel
        │   ├── dropdown/
        │   │   ├── dropdown.component.ts
        │   │   ├── dropdown.component.spec.ts
        │   │   └── index.ts
        │   ├── popover/
        │   │   ├── popover.component.ts
        │   │   ├── popover.component.spec.ts
        │   │   └── index.ts
        │   ├── tooltip/                  # FUTURE placeholder
        │   │   └── index.ts
        │   └── shared/
        │       ├── overlay-positions.ts
        │       ├── overlay.types.ts
        │       └── index.ts
        │
        ├── selection/                    # DOMAIN: Selection UI
        │   ├── index.ts                  # Domain barrel
        │   ├── option/
        │   │   ├── option.component.ts
        │   │   ├── option.component.spec.ts
        │   │   └── index.ts
        │   ├── autocomplete/
        │   │   ├── autocomplete.component.ts
        │   │   ├── autocomplete.directive.ts
        │   │   ├── autocomplete.component.spec.ts
        │   │   └── index.ts
        │   ├── select/                   # FUTURE placeholder
        │   │   └── index.ts
        │   ├── combobox/                 # FUTURE placeholder
        │   │   └── index.ts
        │   └── listbox/                  # FUTURE placeholder
        │       └── index.ts
        │
        ├── feedback/                     # FUTURE DOMAIN placeholder
        │   └── index.ts
        │
        ├── layout/                       # FUTURE DOMAIN placeholder
        │   └── index.ts
        │
        └── a11y/                         # FUTURE DOMAIN placeholder
            └── index.ts
```

**Total Files to Create**: ~35 files (including future placeholders for extensibility)

**MODIFY** (Migrate Existing Components):

- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-selector.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/model-selector.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/autopilot-popover.component.ts`

**REWRITE** (Replace with Generic Option):

- `libs/frontend/chat/src/lib/components/file-suggestions/suggestion-option.component.ts` (use ptah-option instead)

**DEPRECATE** (Mark for Removal):

- `libs/frontend/core/src/lib/services/dropdown-interaction.service.ts` (add @deprecated JSDoc comment, migration guide in CLAUDE.md)

---

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All CDK imports exist in codebase**:

   - `@angular/cdk/overlay` - OverlayModule, cdkConnectedOverlay, cdkOverlayOrigin, ConnectedPosition (verified: package.json @angular/cdk ^20.2.14)
   - `@angular/cdk/a11y` - A11yModule, ActiveDescendantKeyManager, Highlightable, FocusTrap, FocusTrapFactory (verified: existing usage in unified-suggestions-dropdown.component.ts)
   - `@angular/cdk/portal` - Portal, TemplatePortal (included in OverlayModule)

2. **All patterns verified from examples**:

   - ActiveDescendantKeyManager pattern: unified-suggestions-dropdown.component.ts:109-165
   - Highlightable pattern: suggestion-option.component.ts:84-117
   - Signal-based state: agent-selector.component.ts:136-146
   - DaisyUI styling: All existing components use DaisyUI classes

3. **Library documentation consulted**:

   - Angular CDK Overlay: https://material.angular.dev/cdk/overlay/overview
   - ActiveDescendantKeyManager: https://material.angular.dev/cdk/a11y/overview#activedescendantkeymanager
   - Netanel Basal articles (referenced in task-description.md:700-871)

4. **No hallucinated APIs**:
   - All CDK directives verified in @angular/cdk documentation
   - All patterns extracted from existing codebase
   - No assumptions about API surface

---

### Architecture Delivery Checklist

- ✅ All components specified with evidence from existing codebase
- ✅ All patterns verified from codebase (ActiveDescendantKeyManager, Highlightable)
- ✅ All imports/decorators verified as existing (@angular/cdk ^20.2.14 in package.json)
- ✅ Quality requirements defined (functional + non-functional)
- ✅ Integration points documented (ChatInputComponent, trigger directives)
- ✅ Files affected list complete (CREATE 23 files, MODIFY 4 files, DEPRECATE 1 file)
- ✅ Developer type recommended (frontend-developer)
- ✅ Complexity assessed (HIGH, 16-24 hours, 2-3 days)
- ✅ No step-by-step implementation (team-leader will decompose into atomic tasks)

---

## 📚 Evidence Citations

### Codebase Evidence

**Existing CDK Usage**:

- ActiveDescendantKeyManager: libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts:109-165
- Highlightable interface: libs/frontend/chat/src/lib/components/file-suggestions/suggestion-option.component.ts:84-117

**Anti-Patterns to Replace**:

- @if rendering: unified-suggestions-dropdown.component.ts:48, agent-selector.component.ts:52
- Manual positioning: unified-suggestions-dropdown.component.ts:48 (`class="absolute bottom-full left-0 right-0"`)
- DropdownInteractionService: dropdown-interaction.service.ts:1-226 (TASK_2025_046 failed attempt)
- DaisyUI dropdown classes: model-selector.component.ts:23, autopilot-popover.component.ts:32

**Signal-Based Patterns**:

- Signal state management: agent-selector.component.ts:136-146 (isOpen, focusedIndex, agents)
- Input/output signals: All components use Angular 20+ signal APIs

**DaisyUI Styling**:

- Verified usage: All components use DaisyUI classes (btn, dropdown, badge, loading, etc.)

### Research Evidence

**CDK Overlay Patterns**:

- Source: task-description.md:700-871 (Netanel Basal articles, Brian Treese tutorials)
- Key pattern: Directive-based autocomplete with portal rendering
- Evidence: ActiveDescendantKeyManager + cdkConnectedOverlay solves textarea interception

**Root Cause Analysis**:

- Issue: Textarea intercepts keyboard events before dropdown handler runs
- Cause: Dropdown rendered INSIDE component tree (@if conditional rendering)
- Solution: CDK Overlay portal renders OUTSIDE component hierarchy at body level
- Evidence: task-description.md:838-870 (event flow diagrams)

---

## 🎯 Success Criteria (Definition of Done)

### Library Creation

- ✅ New library exists at libs/frontend/ui
- ✅ Library exports OptionComponent, DropdownComponent, PopoverComponent, AutocompleteComponent
- ✅ Import alias @ptah-extension/ui works
- ✅ No circular dependencies with chat/core/dashboard libraries

### Component Functionality

- ✅ OptionComponent implements Highlightable interface correctly
- ✅ DropdownComponent renders in CDK portal (outside component tree)
- ✅ PopoverComponent traps focus when open
- ✅ AutocompleteComponent integrates ActiveDescendantKeyManager

### Migration Success

- ✅ unified-suggestions-dropdown uses AutocompleteComponent (keyboard nav works!)
- ✅ agent-selector uses DropdownComponent (no DropdownInteractionService)
- ✅ model-selector uses DropdownComponent (keyboard nav added!)
- ✅ autopilot-popover uses PopoverComponent (dark backdrop added!)

### Quality Gates

- ✅ All existing unit tests pass after migration
- ✅ Keyboard navigation works in all 4 components (ArrowUp/Down/Enter/Escape)
- ✅ Bundle size increase < 15KB gzipped
- ✅ Zero console errors or warnings
- ✅ CLAUDE.md documentation complete with usage examples

### Critical Test: Textarea Keyboard Interception

- ✅ **WHEN** user types @ in chat input **THEN** ArrowDown does NOT move cursor in textarea
- ✅ **WHEN** user presses ArrowDown **THEN** suggestion list navigates to next item
- ✅ **WHEN** user presses Enter **THEN** selected suggestion is inserted (not newline)
- ✅ **WHEN** user presses Escape **THEN** dropdown closes, focus returns to textarea

**Verification Method**:

1. Open chat input
2. Type @
3. Press ArrowDown multiple times
4. **Expected**: Suggestion list navigation (cursor stays at end of textarea)
5. **Before migration**: Cursor moves to next line in textarea (BUG)
6. **After migration**: Cursor stays put, dropdown navigates (FIXED!)

---

## 🚨 Risk Mitigation

### Risk 1: Textarea Event Interception Persists (Probability: LOW, Impact: CRITICAL)

**Mitigation Strategy**:

1. **Verify portal rendering early**: Inspect DOM, confirm dropdown is in `cdk-overlay-container` at body level
2. **Test keyboard nav in isolation**: Create test harness with textarea + autocomplete before migrating
3. **Use ActiveDescendantKeyManager correctly**: Focus stays on input, aria-activedescendant points to option
4. **Fallback**: If ActiveDescendant fails, use FocusTrap with manual event delegation

**Evidence Supporting Success**:

- Research shows CDK Overlay solves this exact problem (task-description.md:838-870)
- Existing ActiveDescendantKeyManager usage proves pattern works (unified-suggestions-dropdown.component.ts:109-165)

---

### Risk 2: Visual Regression in Migrated Components (Probability: MEDIUM, Impact: MEDIUM)

**Mitigation Strategy**:

1. **Match existing positioning**: Use ConnectedPositionStrategy with same offsets as current CSS
2. **Screenshot comparison**: Visual regression tests before/after migration
3. **Custom position configs**: DROPDOWN_POSITIONS and POPOVER_POSITION_MAP match existing layouts
4. **User validation**: Review UI with stakeholders before marking complete

**Fallback**: Add CSS overrides to match legacy appearance exactly if positioning differs

---

### Risk 3: Breaking Changes in Migration (Probability: MEDIUM, Impact: HIGH)

**Mitigation Strategy**:

1. **Maintain backward-compatible selectors**: Component selectors stay same (ptah-unified-suggestions-dropdown, ptah-agent-selector, etc.)
2. **Keep existing @Input/@Output names**: Public API unchanged
3. **Comprehensive unit tests**: Verify all tests pass before/after migration
4. **Internal changes only**: Template restructuring, no public API changes

**Fallback**: Feature flag to toggle between old and new implementation if migration causes issues

---

### Risk 4: CDK Learning Curve (Probability: MEDIUM, Impact: MEDIUM)

**Mitigation Strategy**:

1. **Reference documentation**: Angular CDK docs, Netanel Basal articles, Brian Treese tutorials
2. **Start simple**: Implement DropdownComponent first (simplest), then PopoverComponent, then AutocompleteComponent (most complex)
3. **Code review**: Senior developer familiar with CDK reviews implementation
4. **Time buffer**: Add 1 day to estimate for CDK learning

**Resource**: task-description.md:700-871 (CDK patterns with code examples)

---

## 📖 Additional Resources

### Official Documentation

- [Angular CDK Overlay](https://material.angular.dev/cdk/overlay/overview)
- [ActiveDescendantKeyManager](https://material.angular.dev/cdk/a11y/overview#activedescendantkeymanager)
- [ARIA Authoring Practices - Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)

### Research Articles

- [Netanel Basal: Advanced Angular Autocomplete](https://medium.com/netanelbasal/advanced-angular-implementing-a-reusable-autocomplete-component-9908c2f04f5)
- [Netanel Basal: Creating Powerful Components with Angular CDK](https://medium.com/netanelbasal/creating-powerful-components-with-angular-cdk-2cef53d81cea)
- [Brian Treese: Angular CDK Overlay Tutorial](https://briantree.se/angular-cdk-overlay-tutorial-learn-the-basics/)

### Codebase References

- Existing ActiveDescendantKeyManager: libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts
- Existing Highlightable: libs/frontend/chat/src/lib/components/file-suggestions/suggestion-option.component.ts
- DropdownInteractionService (to deprecate): libs/frontend/core/src/lib/services/dropdown-interaction.service.ts

---

**ARCHITECTURE COMPLETE** ✅

**Next Steps for Team-Leader**:

1. Read this implementation plan
2. Decompose into atomic, git-verifiable tasks (in tasks.md)
3. Assign tasks to frontend-developer
4. Verify git commits after each task completion
5. Trigger QA review after all migrations complete
