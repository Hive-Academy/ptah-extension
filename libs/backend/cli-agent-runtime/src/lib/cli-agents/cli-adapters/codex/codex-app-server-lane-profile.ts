import { z } from 'zod';
import type { CodexLaneRequirements } from './codex-lane-profile';

export const identitySchema = z.strictObject({
  threadId: z.string().min(1),
  contextId: z.string().min(1),
  processGeneration: z.number().int().nonnegative(),
  normalizedHome: z.string().min(1),
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  profileFingerprint: z.string().min(1),
});

export const handledRequirements = [
  'agentsEnabled', 'pluginsEnabled', 'appsEnabled',
  'includeSkillInstructions', 'disabledUserMcpServers',
  'autoCompactTokens', 'toolOutputTokenLimit', 'webSearch',
  'ptahToolTimeoutSeconds', 'roleDelivery',
] satisfies readonly (keyof CodexLaneRequirements)[];
