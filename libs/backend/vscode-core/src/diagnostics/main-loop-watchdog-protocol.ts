/**
 * The typed half of the watchdog worker's outbound protocol.
 *
 * The worker's program is an untyped string (`main-loop-watchdog-source.ts`),
 * so whatever it posts to main crosses a thread boundary without a compiler
 * between the two sides. Main parses it here before acting on it.
 */
import { z } from 'zod';

/** The recovery line the worker would have written itself. */
export const HangRecoveryRecordSchema = z.object({
  time: z.string(),
  source: z.literal('main-loop-watchdog'),
  event: z.literal('recovered'),
  blockedForMs: z.number().nonnegative(),
  breadcrumbs: z.record(z.string(), z.string()),
});

export type HangRecoveryRecord = z.infer<typeof HangRecoveryRecordSchema>;

/** Posted by the worker on recovery when main asked to write that line. */
export const WatchdogRecoveredMessageSchema = z.object({
  type: z.literal('recovered'),
  /** Epoch ms of the last heartbeat before the block. */
  hangStartedAt: z.number(),
  record: HangRecoveryRecordSchema,
});

export type WatchdogRecoveredMessage = z.infer<
  typeof WatchdogRecoveredMessageSchema
>;

/** What a hang-recovery enricher learned about the block. */
export interface HangRecoveryDetails {
  readonly hangStartedAt: number;
  readonly blockedForMs: number;
}

/**
 * Called on main once a hang has ended. Returns fields to merge into the
 * recovery line (e.g. a profile path and its top self-time frames). Must not
 * reject; a rejection is logged and the line is written without the extras.
 */
export type HangRecoveryEnricher = (
  details: HangRecoveryDetails,
) => Promise<Record<string, unknown>>;
