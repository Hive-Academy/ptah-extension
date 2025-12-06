/**
 * Shared Overlay Type Definitions
 *
 * Common types used across overlay components (dropdown, popover, autocomplete).
 */

/**
 * Overlay position preference
 * Used by PopoverComponent to determine preferred position
 */
export type OverlayPosition = 'above' | 'below' | 'before' | 'after';

/**
 * CDK Overlay backdrop class options
 * - transparent: Invisible backdrop for click-outside detection only
 * - dark: Semi-transparent dark backdrop (modal-like UX)
 */
export type BackdropClass =
  | 'cdk-overlay-transparent-backdrop'
  | 'cdk-overlay-dark-backdrop';
