/**
 * Native Components - Main Entry Point
 *
 * Native overlay and selection components that replace CDK-based implementations.
 * These components use Floating UI for positioning and signal-based keyboard navigation,
 * avoiding VS Code webview sandboxing conflicts with CDK Overlay.
 *
 * @module native
 *
 * @example
 * ```typescript
 * import {
 *   FloatingUIService,
 *   KeyboardNavigationService,
 *   NativeOptionComponent,
 *   NativeDropdownComponent,
 *   NativePopoverComponent,
 *   NativeAutocompleteComponent,
 * } from '@ptah-extension/ui';
 * ```
 */
export * from './shared';
export * from './option';
export * from './dropdown';
export * from './popover';
export * from './autocomplete';
export * from './form';
