import { z } from 'zod';
import {
  AGENT_MESSAGE_MAX_CHARS,
  AgentId,
} from '@ptah-extension/shared';

export const AGENT_MESSAGE_ENVELOPE_INDEX_KEY = 'ptah:agent-message-envelopes:v2';
export const AGENT_MESSAGE_BODY_PREFIX = 'ptah:agent-message-body:v2:';

const timestamp = z.number().int().nonnegative();
const agentIdSchema = z.string().refine(AgentId.validate).transform(AgentId.from);
const senderSchema = z.union([
  z.object({ kind: z.literal('user') }).strict(),
  z.object({
    kind: z.literal('parent'),
    sessionId: z.string().min(1).max(200).optional(),
  }).strict(),
  z.object({
    kind: z.literal('lane'),
    agentId: agentIdSchema,
    name: z.string().min(1).max(200).optional(),
    parentSessionId: z.string().min(1).max(200).optional(),
    verified: z.boolean(),
  }).strict(),
  z.enum(['user', 'parent']).transform((kind) => ({ kind })),
]);

export const AgentMessageEnvelopeSchema = z.object({
  id: z.string().uuid(),
  targetAgentId: agentIdSchema,
  laneLineageId: agentIdSchema,
  actualAgentId: agentIdSchema.optional(),
  parentSessionId: z.string().min(1).max(200).optional(),
  sender: senderSchema,
  senderKey: z.string().min(1).max(300),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
  state: z.enum([
    'not-started', 'dispatching', 'started', 'settled', 'blocked-retryable',
    'outcome-unknown', 'failed', 'expired', 'cancelled',
  ]),
  attemptId: z.string().uuid().optional(),
  everDispatched: z.boolean().optional(),
  /**
   * The text may have reached the lane: an adapter call accepted it
   * (`started`) or threw after it began. Unlike `everDispatched`, which the
   * journal sets before the adapter call, it gates the semantic ack of an
   * `outcome-unknown` envelope. Absent on records written before acks.
   */
  maybeDelivered: z.boolean().optional(),
  route: z.enum(['live', 'cold']).optional(),
  mode: z.enum(['steer', 'queue-next-turn', 'interrupt-resume', 'start-turn', 'unsupported']),
  delivery: z.enum(['queue', 'now']),
  allowPartialTurnLoss: z.boolean().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  terminalAt: timestamp.optional(),
  turnSeq: z.number().int().positive().optional(),
  cliSessionId: z.string().optional(),
  reason: z.string().max(200).optional(),
  lastError: z.string().max(200).optional(),
  attemptCount: z.number().int().nonnegative(),
  nextRetryAt: timestamp.optional(),
  limit: z.object({
    known: z.boolean(),
    resetAt: timestamp.optional(),
  }).strict().optional(),
  partialTurnLost: z.boolean().optional(),
  turnOutcome: z.enum(['completed', 'failed', 'stopped']).optional(),
  bodyBytes: z.number().int().nonnegative().optional(),
  ackState: z.enum(['pending', 'read', 'acted', 'rejected', 'unavailable']).optional(),
  ackAt: timestamp.optional(),
  ackNote: z.string().max(500).optional(),
}).strict();

export const AgentMessageEnvelopeIndexSchema = z.object({
  version: z.literal(1),
  records: z.array(z.unknown()),
}).strict();

export const AgentMessageBodySchema = z.object({
  text: z.string().max(AGENT_MESSAGE_MAX_CHARS),
  envelopeId: z.string().uuid(),
  targetAgentId: agentIdSchema,
  parentSessionId: z.string().min(1).max(200).optional(),
  createdAt: timestamp,
}).strict();

export type AgentMessageEnvelope = z.infer<typeof AgentMessageEnvelopeSchema>;
export type AgentMessageBody = z.infer<typeof AgentMessageBodySchema>;
export type NewEnvelope = Omit<AgentMessageEnvelope,
  'id' | 'state' | 'createdAt' | 'updatedAt' | 'attemptCount' | 'attemptId' |
  'everDispatched' | 'terminalAt' | 'nextRetryAt'
> & {
  readonly id?: string;
  readonly state?: AgentMessageEnvelope['state'];
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly attemptCount?: number;
  readonly terminalAt?: number;
  readonly nextRetryAt?: number;
};
/** The semantic ack fields, written apart from transport transitions. */
export type EnvelopeAckPatch = Pick<AgentMessageEnvelope, 'ackState' | 'ackAt' | 'ackNote'>;
export type EnvelopePatch =Partial<Omit<AgentMessageEnvelope,
  'id' | 'targetAgentId' | 'laneLineageId' | 'sender' | 'senderKey' |
  'idempotencyKey' | 'createdAt'
>>;
