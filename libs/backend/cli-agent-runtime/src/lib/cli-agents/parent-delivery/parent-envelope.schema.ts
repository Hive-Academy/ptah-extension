import { z } from 'zod';
import { AgentId } from '@ptah-extension/shared';

export const PARENT_ENVELOPE_INDEX_KEY = 'ptah:parent-envelopes:v1';
export const PARENT_ENVELOPE_BODY_PREFIX = 'ptah:parent-envelope-body:v1:';
export const PARENT_COMPLETION_OUTBOX_PREFIX = 'ptah:parent-completion-outbox:v1:';
export const PARENT_COMPLETION_KEYS_PREFIX = 'ptah:parent-completion-keys:v1:';
export const PARENT_TOMBSTONE_KEY = 'ptah:deleted-parent-sessions:v1';

/** Same limit as `MAX_AGENT_REPORT_LENGTH` (agent-report-router); not imported to avoid a cycle. */
const MAX_BODY_CHARS = 1_048_576;
const timestamp = z.number().int().nonnegative();
const deliveryId = z.string().regex(/^lane-delivery:\S{1,480}$/)
  .transform((value) => value as `lane-delivery:${string}`);
const agentIdSchema = z.string().refine(AgentId.validate).transform(AgentId.from);

export const ParentEnvelopeRecordSchema = z.object({
  id: deliveryId,
  parentSessionId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  kind: z.enum(['report', 'completion']),
  dedupeKey: z.string().regex(/^\S{1,470}$/),
  verdict: z.enum(['delivered', 'no-deliverable', 'unverified', 'failed']).optional(),
  stopReason: z.enum([
    'repeat-call', 'usage-limit', 'auth', 'session-mismatch', 'host-restart',
  ]).optional(),
  originName: z.string().min(1).max(200).optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  state: z.enum([
    'pending', 'sending', 'delivered', 'blocked-retryable', 'outcome-unknown', 'cancelled',
  ]),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().max(200).optional(),
  nextRetryAt: timestamp.optional(),
  attemptId: z.string().uuid().optional(),
  everDispatched: z.boolean().optional(),
  bodyBytes: z.number().int().nonnegative(),
  deliveredAt: timestamp.optional(),
  cancelledAt: timestamp.optional(),
  waitingReason: z.literal('parent-offline').optional(),
}).strict();
export type ParentEnvelopeRecord = z.infer<typeof ParentEnvelopeRecordSchema>;

export const ParentEnvelopeIndexSchema = z.object({
  version: z.literal(1),
  records: z.array(z.unknown()),
}).strict();

export const ParentEnvelopeBodySchema = z.object({
  text: z.string().max(MAX_BODY_CHARS),
  envelopeId: deliveryId,
  parentSessionId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  kind: z.enum(['report', 'completion']),
  dedupeKey: z.string().regex(/^\S{1,470}$/),
  verdict: z.enum(['delivered', 'no-deliverable', 'unverified', 'failed']).optional(),
  stopReason: z.enum([
    'repeat-call', 'usage-limit', 'auth', 'session-mismatch', 'host-restart',
  ]).optional(),
  originName: z.string().min(1).max(200).optional(),
  createdAt: timestamp,
}).strict();
export type ParentEnvelopeBody = z.infer<typeof ParentEnvelopeBodySchema>;

export const ParentTombstonePhaseSchema = z.enum(['intent', 'metadata-deleted', 'purged']);
export type ParentTombstonePhase = z.infer<typeof ParentTombstonePhaseSchema>;
export const ParentTombstoneRecordSchema = z.object({
  sessionId: z.string().min(1).max(200),
  phase: ParentTombstonePhaseSchema,
  markedAt: timestamp,
  updatedAt: timestamp,
  purgedAt: timestamp.optional(),
}).strict().refine((record) =>
  (record.phase === 'purged') === (record.purgedAt !== undefined));
export type ParentTombstoneRecord = z.infer<typeof ParentTombstoneRecordSchema>;
export const ParentTombstoneIndexSchema = z.object({
  version: z.literal(1),
  records: z.array(z.unknown()).max(512),
}).strict();
export class ParentTombstonePersistError extends Error {
  constructor(
    readonly sessionId: string,
    readonly phase: ParentTombstonePhase | 'cleared',
    cause: unknown,
  ) {
    super(`Parent tombstone ${phase} persist failed for ${sessionId}`, { cause });
    this.name = 'ParentTombstonePersistError';
  }
}

export const ParentCompletionOutboxEntrySchema = z.object({
  dedupeKey: z.string().regex(/^\S{1,470}$/),
  agentId: agentIdSchema,
  parentSessionId: z.string().min(1).max(200),
  completedAt: z.string().datetime(),
  body: z.string().max(MAX_BODY_CHARS),
  verdict: z.enum(['delivered', 'no-deliverable', 'unverified', 'failed']),
  stopReason: z.enum([
    'repeat-call', 'usage-limit', 'auth', 'session-mismatch', 'host-restart',
  ]).optional(),
  originName: z.string().min(1).max(200),
  createdAt: timestamp,
}).strict();
export type ParentCompletionOutboxEntry = z.infer<typeof ParentCompletionOutboxEntrySchema>;
export const ParentCompletionOutboxSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.unknown()),
}).strict();

export const ParentCompletionKeySchema = z.object({
  dedupeKey: z.string().regex(/^\S{1,470}$/),
  state: z.enum(['accepted', 'cancelled']),
  at: timestamp,
}).strict();
export type ParentCompletionKey = z.infer<typeof ParentCompletionKeySchema>;
export const ParentCompletionKeyShardSchema = z.object({
  version: z.literal(1),
  keys: z.array(z.unknown()),
}).strict();
