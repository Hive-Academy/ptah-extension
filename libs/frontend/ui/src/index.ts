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
 */

export * from './lib/overlays';
export * from './lib/selection';
export * from './lib/native';
