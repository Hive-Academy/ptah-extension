# Task Context - TASK_2025_048

## User Intent

Create shared UI component library with Angular CDK Overlay - Build ui-agnostic dropdown, popover, and autocomplete components using cdkConnectedOverlay, then migrate existing implementations (unified-suggestions-dropdown, agent-selector, model-selector, autopilot-popover) to use the new shared library.

## Conversation Summary

### Background

- TASK_2025_046 attempted to fix dropdown keyboard navigation using `DropdownInteractionService` with document-level event listeners
- Multiple approaches failed: manual listeners, capture phase events, immediate preventDefault
- Root cause: Using `@if` for conditional rendering instead of proper CDK Overlay pattern
- Current implementation only uses `@angular/cdk/a11y` (ActiveDescendantKeyManager, Highlightable)
- NOT using CDK Overlay features: cdkConnectedOverlay, focus management, backdrop, portal rendering

### Research Findings (2025-12-06)

**Sources Researched:**

- Netanel Basal: "Advanced Angular: Implementing a Reusable Autocomplete Component"
- Netanel Basal: "Creating Powerful Components with Angular CDK"
- Brian Treese: Angular CDK Overlay Tutorials (basics + positioning)
- Decoded Frontend: Angular CDK Overlay Module
- Atomic Object: Angular CDK Dropdown Component

**Key Pattern: Directive-Based Architecture (Netanel Basal)**

1. `AutocompleteDirective` - Attaches to any input element, manages overlay lifecycle
2. `AutocompleteComponent` - Wraps content in `ng-template` for lazy instantiation, uses `exportAs`
3. `OptionComponent` - Generic selector (`ptah-option`), implements `Highlightable`, reusable across dropdown/autocomplete/select

**Why CDK Overlay Fixes Textarea Interception:**

- Current: Dropdown renders INSIDE component tree → textarea captures keydown events first
- CDK: Dropdown renders in PORTAL at body level → completely outside component hierarchy
- Focus stays on textarea, keyboard nav via `ActiveDescendantKeyManager` + `aria-activedescendant`

**Key CDK Directives:**

- `cdkOverlayOrigin` - Marks trigger element as positioning anchor
- `cdkConnectedOverlay` - Renders content in portal, handles positioning/backdrop
- `[cdkConnectedOverlayOpen]` - Controls visibility (replaces `@if`)
- `[cdkConnectedOverlayHasBackdrop]` - Enables click-outside detection
- `(backdropClick)` - Event for closing on outside click

### Current State Analysis

Existing dropdown/popover components (all using manual patterns):

1. `unified-suggestions-dropdown.component.ts` - File/command autocomplete (@, / triggers)
2. `agent-selector.component.ts` - Agent selection dropdown
3. `model-selector.component.ts` - Model selection dropdown
4. `autopilot-popover.component.ts` - Autopilot settings popover

Current anti-patterns being used:

- `@if (isOpen())` for conditional rendering (instead of cdkConnectedOverlay)
- Manual absolute positioning with CSS (instead of CDK positioning engine)
- `DropdownInteractionService` for click-outside (instead of CDK backdrop)
- Manual keyboard navigation (instead of CDK focus management)
- Z-index management issues (CDK portal solves this)

## Technical Context

- **Branch**: feature/TASK_2025_048-cdk-overlay-components
- **Created**: 2025-12-06
- **Type**: FEATURE (new shared library + migration)
- **Complexity**: Complex (new library, 4 component migrations, architectural pattern)

## Execution Strategy

**FEATURE (Full Workflow)** with UI/UX considerations:

1. Project Manager → Requirements & scope
2. Software Architect → Implementation plan for shared library + migration
3. Team Leader → Decomposition & development
4. QA → Testing & review
5. Modernization → Future enhancements

## Dependencies

- `@angular/cdk` (already installed, version 20)
- CDK modules needed: OverlayModule, A11yModule, PortalModule

## Success Criteria

1. New shared library `libs/frontend/ui` with CDK-based components
2. Dropdown component with proper keyboard navigation
3. Popover component with backdrop and focus management
4. Autocomplete component combining both patterns
5. All 4 existing components migrated to use shared library
6. Keyboard navigation works correctly (no textarea interception)
7. Click-outside works via CDK backdrop
8. Proper focus management and ARIA support
