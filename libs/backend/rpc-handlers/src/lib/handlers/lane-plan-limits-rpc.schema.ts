/**
 * Zod schema for {@link LanePlanLimitsRpcHandlers}.
 *
 * `agent:getLanePlanLimits` takes no parameters, and this schema says exactly
 * that. `.strict()` matters here more than usual: the read has no `refresh`
 * flag (decisions.md #18), so a caller that starts sending one — or any other
 * field — gets a parse failure instead of a silently ignored second contract.
 */

import { z } from 'zod';

export const LanePlanLimitsParamsSchema = z.object({}).strict();

export type LanePlanLimitsInput = z.infer<typeof LanePlanLimitsParamsSchema>;
