import { z } from 'zod';

/**
 * Schema for a persisted model identifier.
 * Empty string means "no model selected" — the runtime falls back to
 * provider defaults in that case.
 */
export const MODEL_SELECTED_SCHEMA = z.string();

export type ModelSelected = z.infer<typeof MODEL_SELECTED_SCHEMA>;
