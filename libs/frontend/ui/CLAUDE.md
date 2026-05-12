# @ptah-extension/ui

[Back to Main](../../../CLAUDE.md)

## Purpose

Shared UI primitives for overlay (dropdown, popover) and selection (option, autocomplete) patterns. Ships two parallel implementations — **`native/`** (Floating UI + signals, recommended) and **`overlays/` + `selection/`** (Angular CDK Overlay + A11y, deprecated). The native variants exist because CDK Overlay's portal rendering and `FocusTrap` conflict with VS Code webview sandboxing (TASK_2025_092).

## Boundaries

**Belongs here**: generic, reusable UI primitives consumed by multiple feature libraries (dropdown, popover, option, autocomplete), positioning service wrappers, keyboard-navigation services.

**Does NOT belong**: feature-specific components (chat input, agent card, etc. — those belong in `chat-ui` or `chat`), backend services, anything that imports `ChatStore` or feature state.

## Public API (from `src/index.ts`)

Re-exports `./lib/overlays`, `./lib/selection`, `./lib/native` — all three domain barrels.

**Native (recommended)**:

- Components: `NativeDropdownComponent`, `NativePopoverComponent`, `NativeOptionComponent`, `NativeAutocompleteComponent`
- Services: `FloatingUIService`, `KeyboardNavigationService`
- Types: `FloatingUIOptions`, `KeyboardNavigationConfig`

**Deprecated CDK variants**: `DropdownComponent`, `PopoverComponent`, `OptionComponent`, `AutocompleteComponent` + `AutocompleteDirective` + shared overlay position helpers.

## Internal Structure

- `src/lib/native/` — recommended Floating-UI-based primitives
  - `shared/floating-ui.service.ts` — wraps `@floating-ui/dom` (`computePosition` + `autoUpdate`)
  - `shared/keyboard-navigation.service.ts` — signal-based replacement for CDK `ActiveDescendantKeyManager`
  - `option/`, `dropdown/`, `popover/`, `autocomplete/` — one component per folder
- `src/lib/overlays/` — deprecated CDK Overlay components (`dropdown/`, `popover/`, `shared/`)
- `src/lib/selection/` — deprecated CDK A11y components (`option/`, `autocomplete/`)

## Key Files

- `src/lib/native/shared/floating-ui.service.ts` — viewport-aware positioning, auto-updates on scroll/resize, `DestroyRef` cleanup, no portal rendering (content stays in component DOM)
- `src/lib/native/shared/keyboard-navigation.service.ts` — `activeIndex` signal driven by `handleKeyDown` (Arrow/Home/End with wrap); no `Highlightable` interface required
- `src/lib/native/option/native-option.component.ts` — `isActive` is an **input signal** (parent controls), not internally managed (deliberate fix for CDK's `setActiveStyles`/`setInactiveStyles` dependency-loop pattern)

## State Management Pattern

- Native services use signals exclusively
- Component-level providers (`providers: [FloatingUIService]`, `providers: [KeyboardNavigationService]`) for instance isolation
- Active-state control is **lifted to the parent**: parent owns `activeIndex` signal, child options bind `[isActive]="i === activeIndex()"`

## Dependencies

**Internal**: none — pure UI library

**External**: `@angular/core`, `@angular/common`, `@floating-ui/dom` (native), `@angular/cdk/overlay` + `@angular/cdk/a11y` (deprecated path only)

## Angular Conventions Observed

- Standalone components, `ChangeDetectionStrategy.OnPush`
- `input.required<T>()` / `input<T>()` / `output<T>()`
- `inject()` for services and `DestroyRef`
- Content projection (`<ng-content select="[trigger]">`, `<ng-content select="[content]">`) for composition

## Guidelines

1. **Prefer `Native*` variants** for new code. The CDK variants are kept only for backward compatibility during the migration window.
2. **Parent controls active state** for native options. Never re-introduce the `Highlightable.setActiveStyles()` pattern — it caused signal dependency loops.
3. **Component-level service providers** — `FloatingUIService` and `KeyboardNavigationService` must be provided in the consuming component's `providers: []` for per-instance state.
4. **No CDK Overlay in new code.** Floating UI positions content in place (no portal), which works around VS Code webview sandboxing.
5. **DaisyUI styling** for VS Code theme compatibility.
6. **Subpath imports** are available for tree-shaking (`@ptah-extension/ui/native/dropdown`, etc.).
