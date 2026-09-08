/**
 * Zod schemas for {@link BootRpcHandlers}.
 *
 * `boot:getReadiness` takes no parameters, and this schema says exactly that
 * rather than being skipped. The house rule is that every method validates at
 * the boundary; a no-argument method is where that rule is most tempting to
 * drop and least costly to keep. `.strict()` means a caller that starts
 * sending a field gets a parse failure here instead of silently establishing an
 * unversioned second contract.
 */

import { z } from 'zod';

export const BootGetReadinessParamsSchema = z.object({}).strict();

export type BootGetReadinessInput = z.infer<
  typeof BootGetReadinessParamsSchema
>;
