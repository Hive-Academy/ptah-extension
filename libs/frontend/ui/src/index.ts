/**
 * UI Library - Main Entry Point
 *
 * ARCHITECTURE: Shared UI component library with CDK Overlay integration
 *
 * DOMAINS:
 * - overlays: Floating UI elements (dropdown, popover, tooltip)
 * - selection: Selection UI components (option, autocomplete, select, combobox)
 *
 * EXPORTS:
 * - Domain barrel exports for tree-shaking support
 * - Shared overlay utilities (positions, types)
 */

export * from './lib/overlays';
export * from './lib/selection';
