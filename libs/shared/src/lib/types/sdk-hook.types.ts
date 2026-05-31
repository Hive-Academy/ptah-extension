/**
 * SDK Hook Payload Types
 *
 * Structural mirrors of the SDK hook payloads that cross the wire
 * (backend → webview) as session lifecycle notifications. These types are
 * shared between the bus emitter side (`agent-sdk` lib) and the webview
 * consumer side, and are validated with Zod at the RPC boundary.
 *
 * Phase 1 introduces only the PostCompact payload. Phases 2 and 3 will
 * extend this file with Stop/StopFailure/SubagentStop payloads.
 */

import { z } from 'zod';

/**
 * Wire payload for `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE`
 * (`'session:compactionComplete'`).
 *
 * Emitted after the SDK's PostCompact hook fires. Consumers stamp
 * `tab.lastCompactionAt = timestamp` and clear any in-flight compaction
 * state for the affected conversation.
 */
export interface SdkCompactionCompletePayload {
  /** SDK session UUID the compaction belongs to. */
  readonly sessionId: string;
  /** Workspace root the SDK query was rooted at. */
  readonly cwd: string;
  /** Whether the compaction was user-initiated (`manual`) or SDK-driven (`auto`). */
  readonly trigger: 'manual' | 'auto';
  /** Compaction summary text produced by the SDK. */
  readonly compactSummary: string;
  /** Epoch ms when the PostCompact hook fired in the backend. */
  readonly timestamp: number;
}

/** Zod schema for {@link SdkCompactionCompletePayload}, used at the RPC boundary. */
export const SdkCompactionCompletePayloadSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  trigger: z.union([z.literal('manual'), z.literal('auto')]),
  compactSummary: z.string(),
  timestamp: z.number().int().nonnegative(),
});
