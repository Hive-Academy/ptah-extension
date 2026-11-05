/**
 * Zod request schema for `session:handoffChain` (TASK_2026_876).
 *
 * The webview only holds SDK session UUIDs (`session:list` rows), so any
 * other id is rejected at the RPC boundary.
 */
import { z } from 'zod';
import { UUID_REGEX } from '@ptah-extension/shared';

export const SessionHandoffChainParamsSchema = z.object({
  sessionId: z.string().regex(UUID_REGEX),
});
