/**
 * UI Library - Main Entry Point
 *
 * ARCHITECTURE: Shared UI component library with CDK Overlay integration
 *
 * DOMAINS:
 * - overlays: Floating UI elements (dropdown, popover, tooltip)
 * - selection: Selection UI components (option, autocomplete, select, combobox)
 * - native: CDK-free components using Floating UI
 *
 * EXPORTS:
 * - Domain barrel exports for tree-shaking support
 * - Shared overlay utilities (positions, types)
 * - Native components (CDK-free, VS Code webview compatible)
 *
 * The 'native' module provides CDK-free alternatives to the CDK-based
 * overlay and selection components. These use Floating UI for positioning
 * and signal-based keyboard navigation, avoiding VS Code webview sandboxing
 * conflicts with CDK Overlay.
 *
 * Prefer importing from 'native' for new components:
 * - FloatingUIService - positioning service
 * - KeyboardNavigationService - signal-based navigation
 * - NativeOptionComponent - option without Highlightable
 * - NativeDropdownComponent - dropdown without CDK Overlay
 * - NativePopoverComponent - popover without CDK FocusTrap
 * - NativeAutocompleteComponent - autocomplete without CDK
 *
 * KEEP THIS FILE A PURE LIST OF `export * from` LINES (R7, TASK_2026_533
 * Batch 24a). esbuild never emits a star-only barrel, but a concrete export
 * here would make it a kept module whose every import esbuild follows, pulling
 * every domain barrel, the brand-mark artwork table included, onto the eager
 * path. `native/brand-mark/brand-mark-barrels.spec.ts` enforces this.
 */

export * from './lib/overlays';
export * from './lib/selection';
export * from './lib/native';
