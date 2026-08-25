/**
 * Shared self-shot timing constants. Kept in one place so the compositions and
 * Root's calculateMetadata agree on the body→end-card transition overlap (the
 * fade consumes frames from BOTH sequences, so total duration must subtract it).
 */
export const OUTPUT_FPS = 30;

/** Crossfade length (frames) from the body into the end card (0 if no end card). */
export const END_TRANSITION_FRAMES = 14;

/** Eased layout-morph length (frames) between Hybrid layout states. */
export const HYBRID_MORPH_FRAMES = 13;
