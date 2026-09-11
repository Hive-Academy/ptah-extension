/**
 * Zod schemas for {@link SessionRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the session handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `SessionListParams`, `SessionLoadParams`, `SessionRenameParams`,
 * `SessionStatsBatchParams`) plus inline guards like the 1-200 character
 * name-length check and `isAuthorizedWorkspace()`. No `z.object({...})`
 * literals existed in `session-rpc.handlers.ts` at the time of W0.B6
 * extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler. If a future task adds Zod validation
 * to the session handler (e.g. to share the name-length rule between the
 * handler and tests), those schemas belong here.
 */

import { z } from 'zod';

export const SessionCliSessionsParamsSchema = z
  .object({ sessionId: z.string().min(1) })
  .strict();

export const SessionCliOutputPageParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    agentId: z.string().trim().min(1).max(4096),
    cursor: z.string().min(1).max(4096).optional(),
    maxBytes: z.number().int().min(1024).max(256 * 1024).optional(),
  })
  .strict();
