import { z } from 'zod';

/**
 * Valid reasoning effort levels.
 *
 * Empty string signals "provider does not support reasoning effort" —
 * the runtime treats it the same as omitting the parameter.
 */
export const EFFORT_LEVEL_SCHEMA = z.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  '',
]);

export type EffortLevel = z.infer<typeof EFFORT_LEVEL_SCHEMA>;
