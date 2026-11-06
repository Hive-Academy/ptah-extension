import { z } from 'zod';
import { AgentId } from '@ptah-extension/shared';
import type { AgentMessageEnvelope } from './agent-message-envelope.schema';

export const LEGACY_RECEIPT_KEY = 'ptah:agent-delivery-receipts:v1';

const LegacyReceiptSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().refine(AgentId.validate).transform(AgentId.from),
  state: z.enum([
    'accepted', 'started', 'settled', 'failed', 'expired', 'interrupted-undelivered',
  ]),
  mode: z.enum(['steer', 'queue-next-turn', 'interrupt-resume', 'start-turn', 'unsupported']),
  delivery: z.enum(['queue', 'now']),
  sender: z.enum(['user', 'parent']).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  turnSeq: z.number().int().positive().optional(),
  cliSessionId: z.string().optional(),
  reason: z.string().max(200).optional(),
  partialTurnLost: z.boolean().optional(),
  turnOutcome: z.enum(['completed', 'failed', 'stopped']).optional(),
}).strict();

export function parseLegacyReceipts(value: unknown): AgentMessageEnvelope[] {
  if (!Array.isArray(value)) return [];
  const envelopes: AgentMessageEnvelope[] = [];
  for (const entry of value) {
    const parsed = LegacyReceiptSchema.safeParse(entry);
    if (!parsed.success) continue;
    const receipt = parsed.data;
    const terminal = receipt.state === 'settled' || receipt.state === 'failed' ||
      receipt.state === 'expired' || receipt.state === 'interrupted-undelivered';
    envelopes.push({
      id: receipt.id,
      targetAgentId: receipt.agentId,
      laneLineageId: receipt.agentId,
      sender: { kind: receipt.sender ?? 'parent' },
      senderKey: receipt.sender === 'user' ? 'user' : 'parent:legacy',
      state: terminal
        ? receipt.state === 'interrupted-undelivered' ? 'failed'
          : receipt.state === 'accepted' ? 'failed' : receipt.state
        : 'failed',
      mode: receipt.mode,
      delivery: receipt.delivery,
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt,
      ...(terminal || receipt.state !== 'settled' ? { terminalAt: receipt.updatedAt } : {}),
      ...(receipt.turnSeq !== undefined ? { turnSeq: receipt.turnSeq } : {}),
      ...(receipt.cliSessionId ? { cliSessionId: receipt.cliSessionId } : {}),
      reason: terminal ? receipt.reason : 'host-restarted',
      ...(receipt.partialTurnLost !== undefined
        ? { partialTurnLost: receipt.partialTurnLost } : {}),
      ...(receipt.turnOutcome ? { turnOutcome: receipt.turnOutcome } : {}),
      attemptCount: 0,
      bodyBytes: 0,
    });
  }
  return envelopes;
}
