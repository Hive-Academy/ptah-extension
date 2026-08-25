/**
 * Early Adopter program configuration.
 *
 * `EARLY_ADOPTER_DEADLINE` is the single source of truth for the application
 * window close — 2026-09-30 23:59:59 UTC. Anchored to UTC so every surface
 * (pricing grid, builders offer card, …) and both the SSG snapshot and the
 * live client render agree on the same instant. Change this one value to move
 * the deadline everywhere.
 */
export const EARLY_ADOPTER_DEADLINE = Date.UTC(2026, 8, 30, 23, 59, 59);

/** Human-readable form of the deadline above — must move with it. */
export const EARLY_ADOPTER_DEADLINE_LABEL = 'Sep 30';
