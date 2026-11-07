/**
 * Message protocol between `WalCheckpointWorkerClient` (Electron main) and the
 * WAL checkpoint utility process (`wal-checkpoint-worker.ts`).
 *
 * Both sides parse every inbound message with these schemas, so a reply is a
 * typed value on arrival and nothing is cast across the process boundary.
 */
import { z } from 'zod';

/** `-1` answers a request the worker could not parse (no id to echo). */
const requestId = z.number().int().min(-1);

export const walCheckpointRequestSchema = z.object({
  type: z.literal('checkpoint'),
  requestId: z.number().int().nonnegative(),
  dbPath: z.string().min(1),
});
export type WalCheckpointRequest = z.infer<typeof walCheckpointRequestSchema>;

/**
 * One `PRAGMA wal_checkpoint(PASSIVE)` outcome. `walFrames` is the WAL length
 * in frames and `checkpointedFrames` how many of them are now in the database
 * file; equal values mean the checkpoint caught up. `busy` is SQLite's own
 * flag: another checkpointer held the lock.
 */
export const walCheckpointResultSchema = z.object({
  type: z.literal('checkpoint-result'),
  requestId,
  busy: z.boolean(),
  walFrames: z.number().int(),
  checkpointedFrames: z.number().int(),
  durationMs: z.number().finite().nonnegative(),
});
export type WalCheckpointResult = z.infer<typeof walCheckpointResultSchema>;

export const walCheckpointFailureSchema = z.object({
  type: z.literal('checkpoint-error'),
  requestId,
  message: z.string(),
});
export type WalCheckpointFailure = z.infer<typeof walCheckpointFailureSchema>;

export const walCheckpointWorkerOutboundSchema = z.discriminatedUnion('type', [
  walCheckpointResultSchema,
  walCheckpointFailureSchema,
]);
export type WalCheckpointWorkerOutbound = z.infer<
  typeof walCheckpointWorkerOutboundSchema
>;

/** The row `PRAGMA wal_checkpoint` returns. */
export const walCheckpointPragmaRowsSchema = z
  .array(
    z.object({
      busy: z.number(),
      log: z.number(),
      checkpointed: z.number(),
    }),
  )
  .length(1);
