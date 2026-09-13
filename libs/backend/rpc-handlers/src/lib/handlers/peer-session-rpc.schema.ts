/**
 * Zod schemas for {@link PeerSessionRpcHandlers} (TASK_2026_402, Task 10.3).
 *
 * Both schemas are `.strict()`. Ptah owns both ends of this boundary, so an
 * unexpected field is a caller bug and saying so is strictly better than
 * dropping it — the requirement's own wording is that an invalid value is an
 * error, never a silent fallback. That is the opposite of
 * `PeerSessionRecordSchema` in `agent-sdk`, which reads a file another program
 * writes and must tolerate fields it has never seen; the two strictness
 * choices are deliberate and neither should be copied onto the other.
 */

import { z } from 'zod';
import { MAX_PEER_MESSAGE_LENGTH } from '@ptah-extension/agent-sdk';

export const PeerSessionListParamsSchema = z
  .object({
    excludeSessionId: z.string().min(1).optional(),
  })
  .strict();

export const PeerSessionSendParamsSchema = z
  .object({
    /** Registry session id of the peer, taken from `peerSession:list`. */
    sessionId: z.string().min(1),
    /** The Ptah session that will perform the relay and pay the turn. */
    fromSessionId: z.string().min(1),
    /**
     * Capped at the Claude channel's own body limit, so an agent that learned
     * the limit on one path has learned it here too. An over-size message is
     * an error at this boundary rather than a truncation the sender would
     * never hear about.
     */
    message: z.string().min(1).max(MAX_PEER_MESSAGE_LENGTH),
  })
  .strict();

export type PeerSessionListInput = z.infer<typeof PeerSessionListParamsSchema>;
export type PeerSessionSendInputParams = z.infer<
  typeof PeerSessionSendParamsSchema
>;
