# Requirements Document - TASK_2025_048

## Executive Summary

Build a shared UI component library (`libs/frontend/ui`) using Angular CDK Overlay to provide production-grade dropdown, popover, and autocomplete primitives. Migrate four existing components that currently use anti-patterns (manual positioning, `@if` rendering, document listeners) to the new CDK-based architecture. This initiative eliminates keyboard navigation bugs, improves accessibility, and establishes reusable UI patterns across the Ptah extension.

**Business Value**: Resolves critical UX issues where dropdown keyboard navigation fails due to textarea event interception, establishes maintainable UI patterns, and reduces code duplication across 4+ components.

**Timeline**: Based on codebase analysis, estimated 2-3 days for library creation + migration + testing.

---

## Problem Statement

### Current State Analysis

**Anti-patterns identified across 4 components:**

1. **unified-suggestions-dropdown.component.ts** (File/command autocomplete)

   - Uses `@if (isOpen())` for conditional rendering instead of CDK Overlay portals
   - Manual absolute positioning with CSS (`absolute bottom-full left-0 right-0`)
   - Uses ActiveDescendantKeyManager correctly BUT keyboard events still intercepted by textarea
   - No backdrop management - relies on DropdownInteractionService

2. **agent-selector.component.ts** (Agent selection dropdown)

   - Uses DropdownInteractionService with capture-phase document listeners
   - Manual click-outside detection
   - Z-index management issues (`z-50` hardcoded)
   - Manual keyboard navigation with signal-based focus tracking

3. **model-selector.component.ts** (Model selection dropdown)

   - Uses DaisyUI `dropdown` class utilities (not CDK)
   - Relies on CSS `:focus` and `tabindex` for open/close
   - No keyboard navigation support
   - Manual blur() to close dropdown

4. **autopilot-popover.component.ts** (Autopilot settings popover)
   - Similar DaisyUI pattern
   - No keyboard navigation
   - Manual focus management

### Root Cause: Missing CDK Overlay Integration

**TASK_2025_046 attempted fix**: DropdownInteractionService with capture-phase event listeners

- **Failed**: Textarea still intercepts ArrowUp/ArrowDown/Enter/Escape before dropdown handler runs
- **Root issue**: NOT using CDK Overlay portals that render OUTSIDE component hierarchy
- **Current approach**: Renders dropdown inside component DOM tree, subject to event bubbling/capture limitations

**CDK Overlay solves this by**:

- Rendering dropdown content in a portal at document body level
- Providing built-in backdrop with click-outside detection
- Managing focus traps and keyboard navigation at framework level
- Handling z-index management automatically via OverlayContainer

### Impact

**Current bugs**:

- Keyboard navigation unreliable in unified-suggestions-dropdown
- Inconsistent UX across different dropdown types
- ~200 lines of duplicated dropdown logic across 4 components
- Poor accessibility (missing ARIA, focus management)

**Technical debt**:

- DropdownInteractionService band-aid solution (87 lines) that doesn't fully solve the problem
- Manual positioning calculations susceptible to edge cases
- No support for advanced features (reposition on scroll, collision detection)

---

## Scope Definition

### In Scope

**Phase 1: Shared UI Library Creation**

1. Generate new library: `libs/frontend/ui`
2. Create 3 CDK-based primitive components:
   - `DropdownComponent` - Basic dropdown with trigger + content
   - `PopoverComponent` - Popover with backdrop and positioning options
   - `AutocompleteComponent` - Dropdown + input integration with keyboard nav

**Phase 2: Migration** 3. Migrate unified-suggestions-dropdown to use AutocompleteComponent 4. Migrate agent-selector to use DropdownComponent 5. Migrate model-selector to use DropdownComponent 6. Migrate autopilot-popover to use PopoverComponent

**Phase 3: Cleanup** 7. Deprecate DropdownInteractionService (mark for removal) 8. Update imports in chat library 9. Add library documentation (CLAUDE.md)

### Out of Scope

- ❌ Advanced CDK features (Drag & Drop, Virtual Scrolling)
- ❌ Custom styling themes (use DaisyUI classes)
- ❌ Animation/transition customization (use CDK defaults)
- ❌ Tooltip component (future enhancement)
- ❌ Modal/Dialog components (different use case)
- ❌ Migration of model-selector and autopilot-popover in Phase 1 (they can wait for Phase 2 if time-constrained)

---

## Functional Requirements

### Requirement 1: Shared UI Library Foundation

**User Story**: As a frontend developer, I want a dedicated UI component library, so that I can import reusable UI primitives without coupling to business logic.

#### Acceptance Criteria

1. WHEN generating the library THEN it SHALL be created at `libs/frontend/ui` with Angular 20+ standalone components
2. WHEN configuring the library THEN it SHALL import `@angular/cdk/overlay`, `@angular/cdk/a11y`, `@angular/cdk/portal` modules
3. WHEN other libraries import it THEN it SHALL export public API via barrel export (`index.ts`)
4. WHEN building the library THEN it SHALL have no circular dependencies with chat/core/dashboard libraries
5. WHEN consuming the library THEN developers SHALL use import alias `@ptah-extension/ui`

---

### Requirement 2: Dropdown Component

**User Story**: As a developer using the UI library, I want a dropdown component with CDK Overlay, so that keyboard navigation works reliably without event interception issues.

#### Acceptance Criteria

1. **WHEN using the component** THEN it SHALL provide:

   - Content projection slot for trigger element
   - Content projection slot for dropdown content
   - Signal-based `isOpen()` state
   - `cdkConnectedOverlay` for portal rendering
   - Backdrop with configurable click-outside behavior

2. **WHEN dropdown opens** THEN it SHALL:

   - Render content in CDK portal at document body level
   - Position overlay relative to trigger using PositionStrategy
   - Apply z-index automatically via OverlayContainer
   - Emit `opened` output event

3. **WHEN keyboard navigation occurs** THEN it SHALL:

   - Support ArrowDown to navigate next item
   - Support ArrowUp to navigate previous item
   - Support Enter to select focused item
   - Support Escape to close dropdown
   - Prevent event propagation to parent elements (no textarea interception)

4. **WHEN user clicks outside** THEN it SHALL:

   - Close dropdown via CDK backdrop click detection
   - Emit `closed` output event
   - NOT use manual document click listeners

5. **WHEN dropdown contains ActiveDescendantKeyManager** THEN it SHALL:
   - Accept generic type for list items implementing Highlightable
   - Expose `keyManager` property for parent component integration
   - Support ARIA `aria-activedescendant` pattern

---

### Requirement 3: Popover Component

**User Story**: As a developer using the UI library, I want a popover component with backdrop and positioning options, so that I can create modal-like popovers without manual positioning logic.

#### Acceptance Criteria

1. **WHEN using the component** THEN it SHALL provide:

   - Content projection slot for trigger element
   - Content projection slot for popover content
   - Input for position preference: `above | below | before | after`
   - Input for backdrop configuration: `transparent | dark | none`
   - Signal-based `isOpen()` state

2. **WHEN popover opens** THEN it SHALL:

   - Render content in CDK portal
   - Position overlay according to position preference with fallback strategies
   - Show backdrop if configured (blocks background interaction)
   - Trap focus within popover content (FocusTrap from CDK A11y)

3. **WHEN backdrop is clicked** THEN it SHALL:

   - Close popover
   - Emit `backdropClicked` output event
   - Return focus to trigger element

4. **WHEN escape key is pressed** THEN it SHALL:
   - Close popover
   - Emit `closed` output event
   - Return focus to trigger element

---

### Requirement 4: Autocomplete Component

**User Story**: As a developer building file/command suggestions, I want an autocomplete component combining dropdown + input integration, so that I can implement @ and / triggers without custom keyboard event handling.

#### Acceptance Criteria

1. **WHEN using the component** THEN it SHALL provide:

   - Integration with parent input element (via reference or directive)
   - Content projection slot for suggestion list content
   - Input for trigger characters: `string[]` (e.g., ['@', '/'])
   - Input for suggestions: `Signal<T[]>`
   - Input for loading state: `Signal<boolean>`
   - Output for suggestion selection: `EventEmitter<T>`

2. **WHEN trigger character is typed** THEN it SHALL:

   - Open dropdown below input element
   - Filter suggestions based on query after trigger
   - Position dropdown using ConnectedPositionStrategy
   - Focus first suggestion item

3. **WHEN keyboard events occur in input** THEN it SHALL:

   - Delegate ArrowUp/ArrowDown/Enter to dropdown component
   - Prevent default input behavior for navigation keys
   - Close dropdown on Escape
   - Allow text entry to update filter query

4. **WHEN suggestion is selected** THEN it SHALL:

   - Emit `suggestionSelected` output with selected item
   - Close dropdown
   - Replace trigger+query text in input with suggestion value
   - Return focus to input element

5. **WHEN dropdown is open** THEN it SHALL:
   - Show loading spinner if `isLoading()` is true
   - Show "No matches" state if `suggestions().length === 0`
   - Support mouse hover to change focused item
   - Support click to select item

---

### Requirement 5: Unified Suggestions Dropdown Migration

**User Story**: As a user typing @ or / in the chat input, I want reliable keyboard navigation, so that I can select files and commands without clicking.

#### Acceptance Criteria

1. **WHEN migrating unified-suggestions-dropdown** THEN it SHALL:

   - Replace `@if (isOpen())` with AutocompleteComponent usage
   - Remove manual positioning CSS (`absolute bottom-full`)
   - Remove DropdownInteractionService dependency
   - Maintain existing ActiveDescendantKeyManager integration
   - Preserve existing ARIA attributes

2. **WHEN user types @** THEN dropdown SHALL:

   - Open with file/folder suggestions
   - Navigate with ArrowUp/ArrowDown (no textarea interception)
   - Select with Enter key
   - Close with Escape key
   - Filter suggestions as user types

3. **WHEN user types /** THEN dropdown SHALL:

   - Open with slash command suggestions
   - Maintain same keyboard navigation behavior
   - Show command descriptions and icons

4. **WHEN integration is complete** THEN:
   - All existing unit tests SHALL pass
   - No visual regressions in dropdown appearance
   - Component LOC SHALL decrease by ~30% (remove manual logic)

---

### Requirement 6: Agent/Model/Autopilot Migration

**User Story**: As a developer maintaining selector components, I want consistent dropdown patterns, so that all dropdowns have the same UX and accessibility.

#### Acceptance Criteria

1. **WHEN migrating agent-selector** THEN it SHALL:

   - Use DropdownComponent instead of manual dropdown
   - Remove DropdownInteractionService usage
   - Remove manual focus tracking (`_focusedIndex` signal)
   - Maintain existing agent discovery integration
   - Keep single-column vertical layout

2. **WHEN migrating model-selector** THEN it SHALL:

   - Use DropdownComponent instead of DaisyUI dropdown class
   - Add keyboard navigation support (currently missing)
   - Remove manual blur() close logic
   - Maintain checkmark for selected model

3. **WHEN migrating autopilot-popover** THEN it SHALL:

   - Use PopoverComponent instead of DaisyUI dropdown class
   - Add backdrop with dark overlay
   - Add keyboard navigation for permission level selection
   - Maintain confirmation UX pattern

4. **WHEN all migrations are complete** THEN:
   - All 4 components SHALL use CDK-based primitives
   - Zero usage of DropdownInteractionService in codebase
   - Consistent keyboard navigation across all dropdowns
   - Consistent ARIA support (role="listbox", aria-activedescendant)

---

## Non-Functional Requirements

### Performance Requirements

- **Bundle Size**: Shared UI library SHALL add < 15KB gzipped to bundle (CDK Overlay is tree-shakable)
- **Rendering**: Dropdown open SHALL render overlay within 16ms (< 1 frame at 60fps)
- **Memory**: No memory leaks from unclosed overlays or subscriptions (verified via takeUntilDestroyed)
- **Event Handlers**: Zero document-level event listeners when all dropdowns closed (improvement over current DropdownInteractionService)

### Accessibility Requirements

- **Keyboard Navigation**: All components SHALL support keyboard-only operation (no mouse required)
- **ARIA Compliance**: SHALL implement `role="listbox"`, `role="option"`, `aria-activedescendant`, `aria-expanded`, `aria-controls`
- **Focus Management**: Focus SHALL be trapped in popover when open, returned to trigger when closed
- **Screen Reader**: Dropdown state changes SHALL be announced via ARIA live regions
- **WCAG 2.1 Level AA**: Contrast ratios, focus indicators, keyboard access SHALL meet standard

### Reusability Requirements

- **Generic Types**: Components SHALL support generic types for list items (not hardcoded to specific domain types)
- **Styling Flexibility**: Components SHALL use content projection for custom styling
- **DaisyUI Integration**: Components SHALL support DaisyUI classes for consistent theming
- **No Business Logic**: Components SHALL contain zero business logic (agnostic to agents/files/models)

### Maintainability Requirements

- **Documentation**: CLAUDE.md SHALL document component API, usage examples, integration patterns
- **Type Safety**: All component APIs SHALL use TypeScript strict mode (no `any` types)
- **Testing**: Each component SHALL have unit tests covering open/close, keyboard nav, accessibility
- **Migration Guide**: Document SHALL explain how to migrate from old patterns to new components

### Compatibility Requirements

- **Angular Version**: Compatible with Angular 20+ (signals, inject(), standalone components)
- **CDK Version**: Compatible with @angular/cdk ^20.2.14
- **Browser Support**: Same as VS Code webview engine (Chromium-based)
- **VS Code API**: No conflicts with VS Code webview messaging or theming

---

## Architecture Requirements

### Library Structure

```
libs/frontend/ui/
├── src/
│   ├── index.ts                          # Public API barrel export
│   ├── lib/
│   │   ├── dropdown/
│   │   │   ├── dropdown.component.ts     # Dropdown primitive
│   │   │   ├── dropdown.component.spec.ts
│   │   │   └── index.ts
│   │   ├── popover/
│   │   │   ├── popover.component.ts      # Popover primitive
│   │   │   ├── popover.component.spec.ts
│   │   │   └── index.ts
│   │   ├── autocomplete/
│   │   │   ├── autocomplete.component.ts # Autocomplete primitive
│   │   │   ├── autocomplete.component.spec.ts
│   │   │   └── index.ts
│   │   └── shared/
│   │       ├── overlay-position.config.ts # Reusable position strategies
│   │       └── overlay-types.ts           # Shared type definitions
│   └── CLAUDE.md                         # Library documentation
├── project.json                           # Nx project config
├── tsconfig.json                          # TypeScript config
├── tsconfig.lib.json                      # Library build config
├── tsconfig.spec.json                     # Test config
└── README.md                              # Quick start guide
```

### Component API Design

#### DropdownComponent API

```typescript
@Component({
  selector: 'ptah-dropdown',
  standalone: true,
  imports: [OverlayModule, A11yModule],
})
export class DropdownComponent {
  // Inputs
  isOpen = input.required<boolean>();
  closeOnBackdropClick = input(true);
  positions = input<ConnectedPosition[]>(DEFAULT_DROPDOWN_POSITIONS);

  // Outputs
  opened = output<void>();
  closed = output<void>();
  backdropClicked = output<void>();

  // Signals
  readonly overlayRef = signal<OverlayRef | null>(null);

  // Content projection
  // <ng-content select="[trigger]" /> - Trigger element
  // <ng-content select="[content]" />  - Dropdown content
}
```

#### PopoverComponent API

```typescript
@Component({
  selector: 'ptah-popover',
  standalone: true,
  imports: [OverlayModule, A11yModule],
})
export class PopoverComponent {
  // Inputs
  isOpen = input.required<boolean>();
  position = input<'above' | 'below' | 'before' | 'after'>('below');
  hasBackdrop = input(true);
  backdropClass = input('cdk-overlay-transparent-backdrop');

  // Outputs
  opened = output<void>();
  closed = output<void>();
  backdropClicked = output<void>();

  // Signals
  readonly overlayRef = signal<OverlayRef | null>(null);

  // Content projection
  // <ng-content select="[trigger]" /> - Trigger button
  // <ng-content select="[content]" />  - Popover content
}
```

#### AutocompleteComponent API

```typescript
@Component({
  selector: 'ptah-autocomplete',
  standalone: true,
  imports: [OverlayModule, A11yModule],
})
export class AutocompleteComponent<T> {
  // Inputs
  suggestions = input.required<T[]>();
  isLoading = input(false);
  triggerChars = input<string[]>(['@']);

  // Outputs
  suggestionSelected = output<T>();
  opened = output<void>();
  closed = output<void>();

  // ViewChild for integration
  @ViewChild(CdkConnectedOverlay) overlay!: CdkConnectedOverlay;

  // Public methods
  attachToInput(inputElement: ElementRef<HTMLInputElement>): void;
  open(): void;
  close(): void;

  // Content projection
  // <ng-content select="[suggestionList]" /> - Suggestion items template
}
```

---

## Dependencies & Risks

### Technical Dependencies

| Dependency     | Version  | Purpose                       | Risk Level              |
| -------------- | -------- | ----------------------------- | ----------------------- |
| @angular/cdk   | ^20.2.14 | Overlay, A11y, Portal modules | Low (already installed) |
| @angular/core  | ~20.1.0  | Framework foundation          | Low (current version)   |
| lucide-angular | Latest   | Icons for UI components       | Low (already used)      |
| DaisyUI        | Current  | CSS utility classes           | Low (styling only)      |

### Integration Risks

#### Risk 1: Textarea Event Interception Persists

- **Probability**: Low
- **Impact**: Critical
- **Scenario**: CDK Overlay portals might still have event interception issues if focus trap misconfigured
- **Mitigation**:
  - Use ActiveDescendantKeyManager with focus staying on input
  - Test keyboard navigation in isolation before migration
  - Implement comprehensive E2E tests for keyboard flows
- **Contingency**: Fallback to CDK FocusTrap with manual event delegation if ActiveDescendant pattern fails

#### Risk 2: Visual Regression in Migrated Components

- **Probability**: Medium
- **Impact**: Medium
- **Scenario**: CDK Overlay default positioning differs from current CSS positioning
- **Mitigation**:
  - Create visual regression tests (screenshot comparison)
  - Use custom ConnectedPositionStrategy matching current behavior
  - Review UI with stakeholders before marking complete
- **Contingency**: Add CSS overrides to match legacy appearance exactly

#### Risk 3: Bundle Size Increase

- **Probability**: Low
- **Impact**: Low
- **Scenario**: CDK Overlay adds significant bundle weight
- **Mitigation**:
  - Use tree-shakable imports (import only needed modules)
  - Analyze bundle with `nx build --stats-json`
  - Monitor bundle size in CI/CD
- **Contingency**: If bundle exceeds 15KB, lazy-load UI library

#### Risk 4: Breaking Changes in Migration

- **Probability**: Medium
- **Impact**: High
- **Scenario**: Migrated components have different API, breaking parent components
- **Mitigation**:
  - Maintain backward-compatible component selectors
  - Keep existing @Input/@Output names
  - Add deprecation warnings, not immediate removal
  - Comprehensive unit test coverage before migration
- **Contingency**: Feature flag to toggle between old and new implementation

#### Risk 5: CDK Learning Curve

- **Probability**: Medium
- **Impact**: Medium
- **Scenario**: Team unfamiliar with CDK patterns, implementation takes longer
- **Mitigation**:
  - Reference official Angular CDK documentation and examples
  - Start with simplest component (DropdownComponent)
  - Code review by senior developer familiar with CDK
- **Contingency**: Allocate extra time for CDK learning (add 1 day to estimate)

### Risk Matrix

| Risk                        | Probability | Impact   | Score | Priority                    |
| --------------------------- | ----------- | -------- | ----- | --------------------------- |
| Event Interception Persists | Low         | Critical | 6     | P0 - Must verify first      |
| Visual Regression           | Medium      | Medium   | 4     | P1 - Test thoroughly        |
| Bundle Size Increase        | Low         | Low      | 1     | P3 - Monitor only           |
| Breaking Changes            | Medium      | High     | 6     | P0 - Maintain compatibility |
| CDK Learning Curve          | Medium      | Medium   | 4     | P2 - Plan time buffer       |

---

## Success Metrics

### Functional Metrics

- ✅ **Keyboard Navigation Success Rate**: 100% (all keys work in all dropdowns)
- ✅ **Component Reusability**: 4 components migrated to shared primitives
- ✅ **Code Reduction**: ~200 lines removed (duplicate dropdown logic eliminated)
- ✅ **Test Coverage**: > 80% for new UI library components

### Non-Functional Metrics

- ✅ **Bundle Size**: Shared UI library < 15KB gzipped
- ✅ **Render Performance**: Overlay opens in < 16ms (measured via Performance API)
- ✅ **Accessibility Score**: 100% WCAG 2.1 Level AA compliance (tested with axe-core)
- ✅ **Zero Regressions**: All existing unit tests pass after migration

### User Experience Metrics

- ✅ **Keyboard-Only Usage**: All dropdowns fully operable without mouse
- ✅ **Screen Reader Compatibility**: Dropdown state changes announced correctly
- ✅ **Visual Consistency**: No detectable visual differences post-migration (screenshot comparison)
- ✅ **Developer Experience**: Migration guide reduces implementation time by 50% for new dropdowns

### Validation Criteria (Definition of Done)

1. **GIVEN** new UI library exists **WHEN** developer imports `@ptah-extension/ui` **THEN** DropdownComponent, PopoverComponent, AutocompleteComponent are available
2. **GIVEN** unified-suggestions-dropdown migrated **WHEN** user types @ in chat input **THEN** ArrowUp/ArrowDown/Enter/Escape work without textarea interception
3. **GIVEN** agent-selector migrated **WHEN** user opens agents dropdown **THEN** keyboard navigation works (currently missing)
4. **GIVEN** all migrations complete **WHEN** running `nx test` **THEN** all tests pass with > 80% coverage
5. **GIVEN** all migrations complete **WHEN** running `nx build` **THEN** bundle size increase < 15KB
6. **GIVEN** CLAUDE.md created **WHEN** developer reads documentation **THEN** they can implement new dropdown in < 30 minutes

---

## Stakeholder Analysis

### Primary Stakeholders

#### End Users (VS Code Extension Users)

- **Impact Level**: High
- **Involvement**: Indirect (UX improvements)
- **Needs**:
  - Reliable keyboard navigation in all dropdowns
  - Consistent UX across different dropdown types
  - Fast, responsive UI with no jank
- **Success Criteria**:
  - Can select files/commands with keyboard only (no mouse required)
  - No visual regressions or UI bugs
  - Dropdown behavior feels native to VS Code

#### Frontend Developers (Team Members)

- **Impact Level**: High
- **Involvement**: Direct implementation
- **Needs**:
  - Clear component API documentation
  - Migration guide from old patterns
  - Reusable primitives for future features
- **Success Criteria**:
  - Can build new dropdown in < 30 minutes
  - Understand CDK Overlay patterns
  - Reduced code duplication and maintenance burden

#### Backend Developers

- **Impact Level**: Low
- **Involvement**: None (frontend-only change)
- **Needs**: No API changes
- **Success Criteria**: No impact on backend services

### Secondary Stakeholders

#### QA/Testers

- **Impact Level**: Medium
- **Involvement**: Validation testing
- **Needs**:
  - Test plan for keyboard navigation flows
  - Accessibility testing checklist
  - Visual regression test suite
- **Success Criteria**:
  - All test scenarios pass
  - No critical bugs in keyboard navigation
  - Accessibility standards met

#### DevOps/CI Engineers

- **Impact Level**: Low
- **Involvement**: Build system updates
- **Needs**:
  - New library added to build pipeline
  - Bundle size monitoring
- **Success Criteria**:
  - CI builds pass with new library
  - No significant build time increase

### Stakeholder Impact Matrix

| Stakeholder   | Impact | Involvement   | Success Criteria                  |
| ------------- | ------ | ------------- | --------------------------------- |
| End Users     | High   | Indirect      | Keyboard nav works 100% of time   |
| Frontend Devs | High   | Direct        | Can build dropdown in < 30 min    |
| Backend Devs  | Low    | None          | No backend changes required       |
| QA/Testers    | Medium | Validation    | All tests pass, no regressions    |
| DevOps        | Low    | Build updates | CI passes, bundle size acceptable |

---

## Quality Gates

### Before Development

- [ ] Requirements reviewed and approved by tech lead
- [ ] CDK Overlay documentation reviewed by implementation team
- [ ] Migration plan validated (no breaking changes to public APIs)

### During Development

- [ ] DropdownComponent unit tests pass (> 80% coverage)
- [ ] PopoverComponent unit tests pass (> 80% coverage)
- [ ] AutocompleteComponent unit tests pass (> 80% coverage)
- [ ] Each migration maintains existing test coverage

### Before Merge

- [ ] All 4 migrated components pass existing unit tests
- [ ] Keyboard navigation verified in all dropdowns (manual testing)
- [ ] Accessibility audit passes (axe-core, no violations)
- [ ] Visual regression tests pass (screenshot comparison)
- [ ] Bundle size analysis shows < 15KB increase
- [ ] Code review approved by senior developer
- [ ] CLAUDE.md documentation complete with examples

### Post-Merge

- [ ] DropdownInteractionService marked deprecated with migration guide
- [ ] No console errors or warnings in VS Code extension
- [ ] Performance metrics collected (overlay render time < 16ms)
- [ ] Team notified of new UI library availability

---

## Implementation Notes

### Research Sources (Netanel Basal Pattern)

Based on research from Netanel Basal's articles and modern CDK tutorials:

**Key Architectural Insights**:

1. **Directive-based approach**: AutocompleteDirective attaches to any input, manages overlay lifecycle
2. **Decoupled OptionComponent**: Generic `ptah-option` selector (not `ptah-autocomplete-option`) for reusability
3. **exportAs pattern**: Components expose instance via `exportAs` for directive integration
4. **Lazy template instantiation**: Wrap content in `ng-template` for on-demand rendering

### CDK Overlay Key Patterns

**1. Basic Dropdown Template**:

```html
<!-- Trigger with cdkOverlayOrigin -->
<button cdkOverlayOrigin #trigger="cdkOverlayOrigin" (click)="isOpen.set(!isOpen())">Toggle</button>

<!-- Overlay content with cdkConnectedOverlay -->
<ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="trigger" [cdkConnectedOverlayOpen]="isOpen()" [cdkConnectedOverlayPositions]="positions" [cdkConnectedOverlayHasBackdrop]="true" [cdkConnectedOverlayBackdropClass]="'cdk-overlay-transparent-backdrop'" (backdropClick)="isOpen.set(false)" (overlayOutsideClick)="isOpen.set(false)">
  <div class="dropdown-panel bg-base-200 border border-base-300 rounded-lg shadow-lg">
    <ng-content />
  </div>
</ng-template>
```

**2. Autocomplete Template (Input + Overlay)**:

```html
<!-- Input with overlay origin -->
<input type="text" cdkOverlayOrigin #inputOrigin="cdkOverlayOrigin" (focus)="onFocus()" (input)="onInput($event)" (keydown)="onKeydown($event)" />

<!-- Connected overlay for suggestions -->
<ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="inputOrigin" [cdkConnectedOverlayOpen]="isOpen()" [cdkConnectedOverlayPositions]="dropdownPositions" [cdkConnectedOverlayWidth]="triggerWidth" cdkConnectedOverlayPush>
  <div class="suggestions-panel" role="listbox">
    @for (item of filteredSuggestions(); track item.id) {
    <ptah-option [value]="item" (selected)="selectItem($event)" />
    }
  </div>
</ng-template>
```

**3. Position Configuration**:

```typescript
import { ConnectedPosition } from '@angular/cdk/overlay';

// Standard dropdown positions (below first, above as fallback)
const DROPDOWN_POSITIONS: ConnectedPosition[] = [
  // Primary: Below, left-aligned
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
  // Fallback: Above, left-aligned
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
];

// Autocomplete positions (match input width)
const AUTOCOMPLETE_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];
```

**4. Keyboard Navigation with ActiveDescendantKeyManager**:

```typescript
import { ActiveDescendantKeyManager } from '@angular/cdk/a11y';
import { Highlightable } from '@angular/cdk/a11y';

// Option component implements Highlightable
export class OptionComponent implements Highlightable {
  isActive = false;

  setActiveStyles(): void {
    this.isActive = true;
    this.elementRef.nativeElement.scrollIntoView({ block: 'nearest' });
  }

  setInactiveStyles(): void {
    this.isActive = false;
  }
}

// Parent manages keyboard via ActiveDescendantKeyManager
private keyManager!: ActiveDescendantKeyManager<OptionComponent>;

ngAfterViewInit() {
  this.keyManager = new ActiveDescendantKeyManager(this.options)
    .withVerticalOrientation()
    .withWrap()
    .withHomeAndEnd();
}

onKeydown(event: KeyboardEvent): void {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    this.keyManager.onKeydown(event);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    this.selectActiveItem();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    this.close();
  }
}
```

**5. Why CDK Overlay Fixes Textarea Interception**:

```
CURRENT (broken):
┌─────────────────────────────────────┐
│ ChatInputComponent                  │
│  ┌───────────────────────────────┐  │
│  │ textarea (captures keydown)   │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │ dropdown (child of      │  │  │
│  │  │ textarea's container)   │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
Event flow: keydown → textarea → dropdown (TOO LATE!)

CDK OVERLAY (fixed):
┌─────────────────────────────────────┐
│ ChatInputComponent                  │
│  ┌───────────────────────────────┐  │
│  │ textarea                      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ CDK OverlayContainer (body level)   │
│  ┌───────────────────────────────┐  │
│  │ dropdown (OUTSIDE component   │  │
│  │ hierarchy, in portal)         │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
Keyboard events handled via ActiveDescendantKeyManager
Focus STAYS on textarea, aria-activedescendant points to option
```

### Component Architecture (Netanel Basal Pattern)

```
libs/frontend/ui/
├── src/
│   ├── index.ts                           # Public API barrel export
│   ├── lib/
│   │   ├── dropdown/
│   │   │   ├── dropdown.component.ts      # cdkConnectedOverlay wrapper
│   │   │   ├── dropdown-trigger.directive.ts  # cdkOverlayOrigin helper
│   │   │   └── index.ts
│   │   ├── autocomplete/
│   │   │   ├── autocomplete.component.ts  # Manages overlay + keyManager
│   │   │   ├── autocomplete.directive.ts  # Attaches to input, delegates events
│   │   │   └── index.ts
│   │   ├── option/
│   │   │   ├── option.component.ts        # Generic, implements Highlightable
│   │   │   └── index.ts                   # Reusable across dropdown/autocomplete
│   │   └── shared/
│   │       ├── overlay-positions.ts       # Reusable position configs
│   │       └── overlay.types.ts           # Shared type definitions
│   └── CLAUDE.md                          # Library documentation
```

### Migration Strategy

**Phase 1**: Create UI library foundation

- Generate `libs/frontend/ui` via Nx
- Create shared overlay position configs
- Create generic `OptionComponent` (implements Highlightable)

**Phase 2**: Create DropdownComponent

- Implement using `cdkConnectedOverlay`
- Test with simple button trigger
- Validate backdrop click-outside works

**Phase 3**: Create AutocompleteComponent + Directive

- AutocompleteDirective attaches to input
- AutocompleteComponent wraps overlay + keyManager
- Test keyboard navigation in isolation

**Phase 4**: Migrate unified-suggestions-dropdown (most complex)

- Replace `@if` rendering with AutocompleteComponent
- Remove manual positioning CSS
- Verify keyboard nav works without textarea interception

**Phase 5**: Migrate remaining components

- agent-selector → DropdownComponent
- model-selector → DropdownComponent
- autopilot-popover → DropdownComponent (with backdrop)

**Phase 6**: Cleanup

- Deprecate DropdownInteractionService
- Update CLAUDE.md with migration guide
- Remove old manual positioning code

### Testing Approach

**Unit Tests**: Component logic, input/output behavior
**Integration Tests**: Parent component + dropdown interaction
**E2E Tests**: Full keyboard navigation flows in VS Code webview
**Accessibility Tests**: axe-core automated audit + manual screen reader testing

### Key Validation Criteria

1. **Textarea Interception Test**: Type `@` in chat input, press ArrowDown - cursor should NOT move in textarea
2. **Backdrop Test**: Click outside dropdown - should close without manual listeners
3. **Portal Test**: Inspect DOM - dropdown should be in `cdk-overlay-container`, not component tree
4. **Focus Test**: During keyboard nav, `document.activeElement` should be textarea, not options

---

## Appendix: Technical References

### Primary Sources (Research)

- [Advanced Angular: Implementing a Reusable Autocomplete Component - Netanel Basal](https://medium.com/netanelbasal/advanced-angular-implementing-a-reusable-autocomplete-component-9908c2f04f5)
- [Creating Powerful Components with Angular CDK - Netanel Basal](https://medium.com/netanelbasal/creating-powerful-components-with-angular-cdk-2cef53d81cea)
- [Angular CDK Overlay Tutorial - Brian Treese](https://briantree.se/angular-cdk-overlay-tutorial-learn-the-basics/)
- [Angular CDK Overlay Positioning - Brian Treese](https://briantree.se/angular-cdk-overlay-tutorial-positioning/)
- [Angular CDK Overlay Module - Decoded Frontend](https://www.decodedfrontend.io/angular-cdk-overlay-module/)
- [Angular CDK Dropdown - Atomic Object](https://spin.atomicobject.com/angular-dropdown-menu/)

### Official Documentation

- [Angular CDK Overlay Documentation](https://material.angular.dev/cdk/overlay/overview)
- [ActiveDescendantKeyManager Guide](https://material.angular.dev/cdk/a11y/overview#activedescendantkeymanager)
- [ARIA Authoring Practices - Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)

### Reference Implementations

- [GitHub: Custom-Auto-Complete (Ahmed BHL)](https://github.com/ahmedbhl/Custom-Auto-Complete)
- [DaisyUI Dropdown Component](https://daisyui.com/components/dropdown/) (styling reference)

---

## Document Metadata

- **Task ID**: TASK_2025_048
- **Type**: FEATURE (new library + migration)
- **Priority**: P1 (High - UX bug fix)
- **Complexity**: Large (new library, 4 migrations, architectural change)
- **Estimated Effort**: 16-24 hours (2-3 days)
- **Created**: 2025-12-06
- **Updated**: 2025-12-06 (added research findings from Netanel Basal articles)
- **Author**: Project Manager Agent
- **Status**: READY FOR APPROVAL (updated with CDK patterns research)
