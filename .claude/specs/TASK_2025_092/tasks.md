# Development Tasks - TASK_2025_092

**Total Tasks**: 18 | **Batches**: 5 | **Status**: 5/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Floating UI provides computePosition, flip, shift, offset, autoUpdate APIs: Verified in Floating UI docs
- Angular signal-based inputs work with viewChildren: Verified - Angular 20+ pattern
- Content projection (ng-content) works in standalone components: Verified in existing codebase
- No CDK required for basic keyboard navigation: Verified - can implement natively

### Risks Identified

| Risk                                                       | Severity | Mitigation                                              |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------- |
| Consumer migration from keyManager to signal-based pattern | MEDIUM   | Task 4.1 includes detailed pattern change documentation |
| Brief position flash at 0,0 before calculation             | LOW      | Use CSS visibility:hidden until positioned              |
| Template rendering before viewChild available              | LOW      | Use effect() with null checks on viewChild refs         |

### Edge Cases to Handle

- [x] Empty suggestions list - Handled in NativeAutocompleteComponent with emptyMessage
- [x] Rapid open/close - Cleanup handled via floatingUI.cleanup() in effects
- [x] Window resize - autoUpdate() handles scroll/resize automatically
- [x] Keyboard navigation wrapping - KeyboardNavigationService supports wrap option

---

## Batch 1: Foundation Services [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: 33eeaab

### Task 1.1: Install @floating-ui/dom dependency [COMPLETE]

**File**: D:\projects\ptah-extension\package.json
**Spec Reference**: implementation-plan.md:922-929
**Pattern to Follow**: Existing dependency entries in package.json

**Quality Requirements**:

- Add @floating-ui/dom version ^1.6.0 to dependencies (not devDependencies)
- Run npm install to verify installation
- Verify import works: `import { computePosition } from '@floating-ui/dom'`

**Implementation Details**:

- Add to "dependencies" section
- Package provides: computePosition, flip, shift, offset, autoUpdate, Placement type

**Acceptance Criteria**:

- [ ] Package added to package.json
- [ ] npm install succeeds
- [ ] Import test compiles without error

---

### Task 1.2: Create FloatingUIService [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\shared\floating-ui.service.ts
**Spec Reference**: implementation-plan.md:116-189
**Pattern to Follow**: Service injection pattern from existing services

**Quality Requirements**:

- Injectable service (providedIn: 'root' or component-level)
- Uses @floating-ui/dom computePosition, flip, shift, offset, autoUpdate
- Provides position() async method
- Provides cleanup() method
- Handles DestroyRef for automatic cleanup
- Supports FloatingUIOptions interface (placement, offset, flip, shift)

**Implementation Details**:

```typescript
// Key imports
import { computePosition, flip, shift, offset, autoUpdate, Placement } from '@floating-ui/dom';
import { Injectable, inject, DestroyRef } from '@angular/core';

export interface FloatingUIOptions {
  placement?: Placement;
  offset?: number;
  flip?: boolean;
  shift?: boolean;
}
```

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] Exports FloatingUIService and FloatingUIOptions
- [ ] No CDK imports
- [ ] Compiles without TypeScript errors

---

### Task 1.3: Create KeyboardNavigationService [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\shared\keyboard-navigation.service.ts
**Spec Reference**: implementation-plan.md:200-297
**Pattern to Follow**: Signal-based service pattern

**Quality Requirements**:

- Uses Angular signal for activeIndex (not BehaviorSubject)
- Supports configure() method with KeyboardNavigationConfig
- Handles ArrowUp/ArrowDown/Home/End keys
- Supports wrap-around navigation
- Supports horizontal/vertical orientation
- Provides setActiveIndex(), setNext(), setPrevious(), reset() methods

**Implementation Details**:

```typescript
export interface KeyboardNavigationConfig {
  itemCount: number;
  wrap?: boolean;
  horizontal?: boolean;
}

// Key pattern: signal-based activeIndex
private readonly _activeIndex = signal<number>(-1);
readonly activeIndex = this._activeIndex.asReadonly();
```

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] Exports KeyboardNavigationService and KeyboardNavigationConfig
- [ ] Uses Angular signals (no RxJS BehaviorSubject)
- [ ] No CDK A11y imports
- [ ] Compiles without TypeScript errors

---

### Task 1.4: Create shared barrel exports [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\shared\index.ts
**Spec Reference**: implementation-plan.md:1014-1015
**Pattern to Follow**: libs/frontend/ui/src/lib/overlays/shared/index.ts

**Quality Requirements**:

- Export FloatingUIService and FloatingUIOptions from floating-ui.service
- Export KeyboardNavigationService and KeyboardNavigationConfig from keyboard-navigation.service

**Implementation Details**:

```typescript
export { FloatingUIService, type FloatingUIOptions } from './floating-ui.service';
export { KeyboardNavigationService, type KeyboardNavigationConfig } from './keyboard-navigation.service';
```

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] All exports accessible via '@ptah-extension/ui' after library index update
- [ ] Compiles without errors

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build ui`
- No CDK imports in new files
- Import from '@floating-ui/dom' works

---

## Batch 2: Core Components [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 6 | **Dependencies**: Batch 1
**Commit**: 710228c

### Task 2.1: Create NativeOptionComponent [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\option\native-option.component.ts
**Spec Reference**: implementation-plan.md:309-371
**Pattern to Follow**: libs/frontend/ui/src/lib/selection/option/option.component.ts (but without Highlightable)

**Quality Requirements**:

- Standalone component with signal-based inputs
- isActive is INPUT signal (not self-managed like CDK Highlightable)
- Uses content projection (ng-content) for custom layouts
- Provides scrollIntoView() and getHostElement() methods
- ARIA attributes: role="option", aria-selected
- DaisyUI classes for styling

**Implementation Details**:

```typescript
// Key difference: isActive is INPUT, not managed by setActiveStyles()
readonly optionId = input.required<string>();
readonly value = input.required<T>();
readonly isActive = input<boolean>(false);  // Parent controls this!

readonly selected = output<T>();
readonly hovered = output<void>();
```

**Validation Notes**:

- CRITICAL: Do NOT implement Highlightable interface
- Parent component must pass isActive, not call setActiveStyles()
- This is a breaking change from CDK pattern

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] No CDK A11y imports (no Highlightable)
- [ ] isActive is input signal, not property
- [ ] scrollIntoView() method exists
- [ ] Compiles without TypeScript errors

---

### Task 2.2: Create native option barrel export [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\option\index.ts
**Spec Reference**: implementation-plan.md:1025-1026

**Quality Requirements**:

- Export NativeOptionComponent

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] NativeOptionComponent exported

---

### Task 2.3: Create NativeDropdownComponent [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\dropdown\native-dropdown.component.ts
**Spec Reference**: implementation-plan.md:389-487
**Pattern to Follow**: libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.ts (but with Floating UI)

**Quality Requirements**:

- Standalone component with FloatingUIService injection
- Uses content projection: [trigger] and [content] slots
- Positions content using Floating UI (not CDK Overlay)
- Supports hasBackdrop, backdropClass, closeOnBackdropClick inputs
- Emits opened, closed, backdropClicked outputs
- Effect to position dropdown when isOpen changes
- Cleanup on destroy

**Implementation Details**:

```typescript
// Key pattern: effect() watches isOpen and positions dropdown
constructor() {
  effect(() => {
    if (this.isOpen()) {
      this.positionDropdown();
      this.opened.emit();
    } else {
      this.floatingUI.cleanup();
    }
  });
}
```

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] No CDK Overlay imports
- [ ] Uses FloatingUIService for positioning
- [ ] Supports backdrop click detection
- [ ] Compiles without TypeScript errors

---

### Task 2.4: Create native dropdown barrel export [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\dropdown\index.ts
**Spec Reference**: implementation-plan.md:1027-1028

**Quality Requirements**:

- Export NativeDropdownComponent

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] NativeDropdownComponent exported

---

### Task 2.5: Create NativePopoverComponent [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\popover\native-popover.component.ts
**Spec Reference**: implementation-plan.md:501-609
**Pattern to Follow**: libs/frontend/ui/src/lib/overlays/popover/popover.component.ts (but without CDK FocusTrap)

**Quality Requirements**:

- Standalone component with FloatingUIService injection
- Uses content projection: [trigger] and [content] slots
- Native focus management (store/restore previousActiveElement)
- Handles Escape key to close
- Supports dark backdrop
- Cleanup on destroy

**Implementation Details**:

```typescript
// Key pattern: native focus management
private previousActiveElement: HTMLElement | null = null;

private async openPopover(): Promise<void> {
  this.previousActiveElement = document.activeElement as HTMLElement;
  // ... position and focus
}

private closePopover(): void {
  if (this.previousActiveElement) {
    this.previousActiveElement.focus();
    this.previousActiveElement = null;
  }
}
```

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] No CDK FocusTrap imports
- [ ] Native focus management implemented
- [ ] Escape key handling works
- [ ] Compiles without TypeScript errors

---

### Task 2.6: Create native popover barrel export [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\popover\index.ts
**Spec Reference**: implementation-plan.md:1029-1030

**Quality Requirements**:

- Export NativePopoverComponent

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] NativePopoverComponent exported

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build ui`
- No CDK Overlay/A11y imports in new files
- Components render correctly with test harness

---

## Batch 3: Autocomplete Component [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1, Batch 2
**Commit**: c7c6f1a

### Task 3.1: Create NativeAutocompleteComponent [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\autocomplete\native-autocomplete.component.ts
**Spec Reference**: implementation-plan.md:621-808
**Pattern to Follow**: libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.component.ts (but without CDK)

**Quality Requirements**:

- Standalone component
- Provides FloatingUIService and KeyboardNavigationService at component level
- Uses content projection for input: [autocompleteInput] slot
- Uses viewChildren to track NativeOptionComponents
- Computes activeIndex from KeyboardNavigationService
- Positions panel using FloatingUIService
- Handles loading/empty states
- Provides onKeyDown() public method for parent
- Provides getActiveDescendantId() for ARIA
- Effect to configure keyboard navigation when suggestions change
- Effect to scroll active option into view

**Implementation Details**:

```typescript
// Key pattern: component-level service providers
@Component({
  providers: [FloatingUIService, KeyboardNavigationService],
  // ...
})
export class NativeAutocompleteComponent<T = unknown> {
  private readonly floatingUI = inject(FloatingUIService);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  // Parent must pass isActive to each option based on activeIndex
  readonly activeIndex = this.keyboardNav.activeIndex;
}
```

**Validation Notes**:

- CRITICAL: Active state managed via KeyboardNavigationService signal
- Options receive isActive as INPUT, not via keyManager
- This is the core fix for the signal dependency loop issue

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] No CDK imports (no ActiveDescendantKeyManager)
- [ ] Uses KeyboardNavigationService for navigation
- [ ] Uses FloatingUIService for positioning
- [ ] Supports loading/empty states
- [ ] onKeyDown() handles ArrowUp/Down/Enter/Escape
- [ ] Compiles without TypeScript errors

---

### Task 3.2: Create native autocomplete barrel export [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\autocomplete\index.ts
**Spec Reference**: implementation-plan.md:1041-1042

**Quality Requirements**:

- Export NativeAutocompleteComponent

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] NativeAutocompleteComponent exported

---

### Task 3.3: Create native module barrel export [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\index.ts
**Spec Reference**: implementation-plan.md:1043

**Quality Requirements**:

- Re-export from shared, option, dropdown, popover, autocomplete
- This is the main entry point for native components

**Implementation Details**:

```typescript
export * from './shared';
export * from './option';
export * from './dropdown';
export * from './popover';
export * from './autocomplete';
```

**Acceptance Criteria**:

- [ ] File created at correct path
- [ ] All native components accessible via single import path
- [ ] Compiles without errors

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build ui`
- NativeAutocompleteComponent renders with test data
- Keyboard navigation works (ArrowUp/Down/Enter/Escape)

---

## Batch 4: Consumer Migration [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 3
**Commit**: 21cfe2f

### Task 4.1: Migrate UnifiedSuggestionsDropdownComponent [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts
**Spec Reference**: implementation-plan.md:1048-1049
**Pattern to Follow**: Current component structure, replace CDK with native

**Quality Requirements**:

- Replace CDK Overlay imports with native component imports
- Replace ActiveDescendantKeyManager with signal-based active tracking
- Use NativeAutocompleteComponent or inline Floating UI positioning
- Remove all CDK A11y imports
- Preserve existing API (inputs, outputs, public methods)
- IMPORTANT: Must work with existing ChatInputComponent integration

**Implementation Details**:

```typescript
// BEFORE: CDK pattern
import { ActiveDescendantKeyManager } from '@angular/cdk/a11y';
private keyManager: ActiveDescendantKeyManager<SuggestionOptionComponent>;

// AFTER: Signal-based pattern
private readonly _activeIndex = signal(0);
readonly activeIndex = this._activeIndex.asReadonly();

// Options receive isActive computed from activeIndex
// [isActive]="i === activeIndex()"
```

**Validation Notes**:

- This is the CRITICAL consumer migration
- Must preserve onKeyDown() API for ChatInputComponent
- Must preserve getActiveDescendantId() for ARIA

**Acceptance Criteria**:

- [ ] No CDK Overlay imports
- [ ] No CDK A11y imports
- [ ] Keyboard navigation works (ArrowUp/Down/Enter/Escape)
- [ ] Mouse hover updates active index
- [ ] Existing ChatInputComponent integration unchanged
- [ ] Compiles without TypeScript errors

---

### Task 4.2: Update ChatInputComponent CDK references [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Spec Reference**: implementation-plan.md:1050

**Quality Requirements**:

- Remove CdkOverlayOrigin import if no longer needed
- Update template if NativeAutocomplete requires different origin reference
- Verify keyboard event forwarding still works

**Implementation Details**:

- Review if CdkOverlayOrigin is still needed
- If native components don't need it, remove import
- Test keyboard navigation flow: ChatInput -> UnifiedSuggestionsDropdown

**Acceptance Criteria**:

- [ ] Component compiles without errors
- [ ] Keyboard navigation works end-to-end
- [ ] @ trigger opens dropdown with files
- [ ] / trigger opens dropdown with commands
- [ ] Enter selects suggestion
- [ ] Escape closes dropdown

---

### Task 4.3: Update SuggestionOptionComponent if needed [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\suggestion-option.component.ts
**Spec Reference**: Based on UnifiedSuggestionsDropdown dependencies

**Quality Requirements**:

- If component implements Highlightable, update to use isActive input
- If tightly coupled to CDK, refactor to native pattern
- May need to extend or wrap NativeOptionComponent

**Implementation Details**:

- Check if SuggestionOptionComponent implements Highlightable
- If yes, change from setActiveStyles/setInactiveStyles to isActive input
- Ensure styling still works with DaisyUI classes

**Acceptance Criteria**:

- [ ] No CDK A11y imports (no Highlightable)
- [ ] Active state via input signal
- [ ] Visual styling preserved
- [ ] Compiles without TypeScript errors

---

### Task 4.4: Update UI library exports [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\src\index.ts
**Spec Reference**: implementation-plan.md:1055

**Quality Requirements**:

- Add export for native components: `export * from './lib/native';`
- Preserve existing overlays and selection exports (for backwards compatibility)

**Implementation Details**:

```typescript
// Add to index.ts
export * from './lib/native';
```

**Acceptance Criteria**:

- [ ] Native components importable via '@ptah-extension/ui'
- [ ] Existing exports still work
- [ ] Build passes: `npx nx build ui`

---

**Batch 4 Verification**:

- Build passes: `npx nx build chat`
- UnifiedSuggestionsDropdown works in VS Code webview
- No fatal hang when typing @ or /
- Keyboard navigation works correctly
- All existing functionality preserved

---

## Batch 5: Cleanup and Documentation [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 4
**Commit**: d52dadd

### Task 5.1: Add deprecation notices to CDK components [COMPLETE]

**Files**:

- D:\projects\ptah-extension\libs\frontend\ui\src\lib\overlays\dropdown\dropdown.component.ts
- D:\projects\ptah-extension\libs\frontend\ui\src\lib\overlays\popover\popover.component.ts
- D:\projects\ptah-extension\libs\frontend\ui\src\lib\selection\option\option.component.ts
- D:\projects\ptah-extension\libs\frontend\ui\src\lib\selection\autocomplete\autocomplete.component.ts
  **Spec Reference**: implementation-plan.md:1078-1082

**Quality Requirements**:

- Add @deprecated JSDoc tag to each component class
- Include migration path in deprecation notice
- Do NOT remove the components (backwards compatibility)

**Implementation Details**:

```typescript
/**
 * @deprecated Use NativeDropdownComponent from '@ptah-extension/ui' instead.
 * This component uses CDK Overlay which has conflicts with VS Code webview sandboxing.
 * Migration: Replace <ptah-dropdown> with <ptah-native-dropdown>.
 */
@Component({ ... })
export class DropdownComponent { ... }
```

**Acceptance Criteria**:

- [ ] All 4 CDK components have @deprecated JSDoc
- [ ] Deprecation message includes migration path
- [ ] Components still work (not removed)
- [ ] IDE shows deprecation warning on usage

---

### Task 5.2: Update UI library CLAUDE.md documentation [COMPLETE]

**File**: D:\projects\ptah-extension\libs\frontend\ui\CLAUDE.md
**Spec Reference**: implementation-plan.md:1083

**Quality Requirements**:

- Add section for native components
- Document FloatingUIService and KeyboardNavigationService
- Add migration guide from CDK to native components
- Update architecture diagram

**Implementation Details**:

- Add "Native Components" section after current components
- Document NativeOptionComponent, NativeDropdownComponent, NativePopoverComponent, NativeAutocompleteComponent
- Add "Migrating from CDK Components" section
- Update import examples

**Acceptance Criteria**:

- [ ] Native components documented
- [ ] Services documented
- [ ] Migration guide included
- [ ] Architecture diagram updated

---

**Batch 5 Verification**:

- All deprecation notices in place
- Documentation updated
- Build passes: `npx nx build ui`
- Final manual test in VS Code webview environment

---

## Code Review Remediation [COMPLETE]

**Commit**: 4644351

### Fixes Applied

1. Remove redundant `standalone: true` from native-autocomplete
2. Remove unused `filterChanged` output from unified-suggestions-dropdown
3. Add `positioningPending` flag to prevent stale positioning in dropdown
4. Add `isDestroyed` flag to prevent updates after destruction in floating-ui
5. Add `role="listbox"` ARIA attribute to native-dropdown
6. Add `tabindex="-1"` to suggestion-option host for accessibility
7. Convert `isBuiltinCommand` to computed signal in suggestion-option
8. Add `isConnected` check before focus restoration in native-popover
9. Add `@HostListener` for document clicks in native-dropdown
10. Add `disabled` input with styling to native-option
11. Move ID attribute to host in suggestion-option

**Build Status**: PASSED (ui typecheck, chat typecheck)

---

## Status Legend

| Icon          | Status                                     |
| ------------- | ------------------------------------------ |
| [PENDING]     | Not yet started                            |
| [IN PROGRESS] | Currently being worked on                  |
| [IMPLEMENTED] | Developer completed, awaiting verification |
| [COMPLETE]    | Verified and committed                     |
| [FAILED]      | Verification failed                        |
