import { z } from 'zod';
import { defineSetting } from './definition';

/**
 * Schema for a single Ptah CLI agent configuration entry.
 *
 * This mirrors PtahCliConfig from @ptah-extension/shared (ptah-cli.types.ts).
 * A deliberate permissive schema is used here so the settings-core lib does not
 * take a hard dependency on @ptah-extension/shared. The tighter typed version
 * lives in the shared lib and is used at the RPC boundary.
 */
const PTAH_CLI_AGENT_ITEM_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  providerId: z.string(),
  enabled: z.boolean(),
  tierMappings: z
    .object({
      sonnet: z.string().optional(),
      opus: z.string().optional(),
      haiku: z.string().optional(),
    })
    .optional(),
  selectedModel: z.string().optional(),
  updatedAt: z.number(),
});

export const PTAH_CLI_AGENTS_DEF = defineSetting({
  key: 'ptahCliAgents',
  scope: 'global',
  sensitivity: 'plain',
  schema: z.array(PTAH_CLI_AGENT_ITEM_SCHEMA),
  default: [],
  sinceVersion: 1,
});

export type PtahCliAgentEntry = z.infer<typeof PTAH_CLI_AGENT_ITEM_SCHEMA>;
