/**
 * Default offset between an overlay panel and its origin element, in pixels.
 *
 * Used by `NativeDropdownComponent` and `NativePopoverComponent` so visual
 * spacing stays consistent across overlay primitives.
 */
export const DEFAULT_OVERLAY_OFFSET = 8;

/**
 * Tighter offset used when the overlay sits visually attached to its origin,
 * e.g. an autocomplete suggestion list anchored to its input.
 */
export const AUTOCOMPLETE_OVERLAY_OFFSET = 4;
