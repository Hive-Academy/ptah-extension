import { z } from 'zod';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';

export const MAX_TASK_LENGTH = 100 * 1024;

export const AgentSpawnArgsSchema = z
  .object({
    task: z.string().min(1).max(MAX_TASK_LENGTH),
    cli: z.enum(SYSTEM_CLI_TYPES).optional(),
    ptahCliId: z.string().min(1).optional(),
    workingDirectory: z.string().optional(),
    timeout: z.number().int().nonnegative().optional(),
    files: z.array(z.string()).optional(),
    taskFolder: z.string().optional(),
    model: z.string().optional(),
    modelTier: z.enum(['opus', 'sonnet', 'haiku']).optional(),
    resume_session_id: z.string().optional(),
    role: z.string().min(1).max(100).optional(),
  })
  .strict();
