/**
 * Native Components - Main Entry Point
 *
 * Native overlay and selection components that replace CDK-based implementations.
 * These components use Floating UI for positioning and signal-based keyboard navigation,
 * avoiding VS Code webview sandboxing conflicts with CDK Overlay.
 *
 * @module native
 *
 * KEEP THIS FILE A PURE LIST OF `export * from` LINES (R7, TASK_2026_533
 * Batch 24a). esbuild never emits a star-only barrel, but a concrete export
 * here would make it a kept module whose every import esbuild follows, pulling
 * every sibling barrel, `./brand-mark` and its artwork table included, onto
 * the eager path. `brand-mark/brand-mark-barrels.spec.ts` enforces this.
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
 *   NativeCardComponent,
 *   NativeTabGroupComponent,
 *   NativeDrawerComponent,
 *   ProviderModelPickerComponent,
 *   PROVIDER_MODELS_LOADER,
 * } from '@ptah-extension/ui';
 * ```
 */
export * from './shared';
export * from './option';
export * from './dropdown';
export * from './popover';
export * from './autocomplete';
export * from './form';
export * from './card';
export * from './catalog-card';
export * from './brand-mark';
export * from './mark-svg';
export * from './monogram-tile';
export * from './brand-slugs';
export * from './tab-group';
export * from './drawer';
export * from './provider-model-picker';
export * from './provider-mark';
export * from './peer-session-picker';
