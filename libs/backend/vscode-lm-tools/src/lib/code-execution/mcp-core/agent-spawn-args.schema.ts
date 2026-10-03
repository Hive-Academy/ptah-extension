import { z } from 'zod';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';

export const MAX_TASK_LENGTH = 100 * 1024;

/**
 * Deliverable paths one spawn may declare (TASK_2026_515).
 *
 * Bounded because every entry costs one filesystem check when the lane ends,
 * and a lane asked for twenty separate files is a lane that should have been
 * two lanes.
 */
export const MAX_DELIVERABLES = 20;

/**
 * Longest `effort` string a spawn may carry (TASK_2026_597). The longest real
 * level is six characters; the bound keeps an arbitrary value out of the
 * `Lane policy` log line, which echoes an ignored effort.
 */
export const MAX_EFFORT_LENGTH = 32;

export const AgentSpawnArgsSchema = z
  .object({
    task: z.string().min(1).max(MAX_TASK_LENGTH),
    cli: z.enum(SYSTEM_CLI_TYPES).optional(),
    ptahCliId: z.string().min(1).optional(),
    workingDirectory: z.string().optional(),
    timeout: z.number().int().nonnegative().optional(),
    files: z.array(z.string()).optional(),
    taskFolder: z.string().optional(),
    deliverables: z
      .array(z.string().min(1).max(1024))
      .max(MAX_DELIVERABLES)
      .optional(),
    model: z.string().optional(),
    modelTier: z.enum(['opus', 'sonnet', 'haiku']).optional(),
    resume_session_id: z.string().optional(),
    role: z.string().min(1).max(100).optional(),
    // Free string, not an enum: each CLI accepts its own scale, and the lane
    // spawn policy ignores a value its CLI does not take (R2.3 step 1).
    effort: z.string().min(1).max(MAX_EFFORT_LENGTH).optional(),
  })
  .strict();
