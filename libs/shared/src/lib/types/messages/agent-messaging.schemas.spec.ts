import {
  AGENT_LANE_MESSAGE_MAX_CHARS,
  AGENT_MESSAGE_MAX_CHARS,
  AgentId,
} from '../agent-process.types';
import type {
  AgentDeliveryReceipt,
  AgentDeliveryReceiptState,
  ParentDeliveryState,
  ParentDeliveryView,
} from '../agent-process.types';
import { RPC_METHOD_NAMES } from '../rpc.types';
import {
  AgentDeliveryReceiptSchema,
  AgentMonitorMessageReceiptPayloadSchema,
  AgentMonitorParentDeliveryPayloadSchema,
} from './schemas';

const agentId = AgentId.from('123e4567-e89b-42d3-a456-426614174000');

const legacyReceipt: AgentDeliveryReceipt = {
  id: 'message-1',
  agentId,
  state: 'accepted',
  mode: 'queue-next-turn',
  delivery: 'queue',
  sender: 'parent',
  preview: 'Continue the task.',
  createdAt: 1,
  updatedAt: 2,
  turnSeq: 3,
  cliSessionId: 'cli-session-1',
  reason: 'queue-full',
  partialTurnLost: false,
  turnOutcome: 'completed',
};

function extendedReceipt(state: AgentDeliveryReceiptState): AgentDeliveryReceipt {
  return {
    ...legacyReceipt,
    state,
    actualAgentId: agentId,
    sender: 'lane',
    senderAgentId: agentId,
    senderSessionId: 'sender-session-1',
    senderVerified: true,
    parentSessionId: 'parent-session-1',
    attemptCount: 2,
    everDispatched: true,
    lastError: 'The lane did not accept the message.',
    nextRetryAt: 4,
    limit: { known: true, resetAt: 5 },
    hasRecoverableBody: true,
    ackState: 'read',
    ackAt: 6,
    ackNote: 'Read by the lane.',
  };
}

function parentDelivery(state: ParentDeliveryState): ParentDeliveryView {
  return {
    deliveryId: `lane-delivery:report:${agentId}:3:abc123`,
    agentId,
    parentSessionId: 'parent-session-1',
    kind: 'report',
    state,
    createdAt: 1,
    updatedAt: 2,
    attempts: 2,
    lastError: 'The parent did not accept the delivery.',
    nextRetryAt: 4,
    waitingReason: 'parent-offline',
    everDispatched: true,
    preview: 'Batch complete.',
    verdict: 'delivered',
    stopReason: 'host-restart',
  };
}

describe('agent messaging schemas', () => {
  it.each([
    'dispatching',
    'blocked-retryable',
    'outcome-unknown',
    'cancelled',
  ] as const)('round-trips an extended %s receipt', (state) => {
    const receipt = extendedReceipt(state);

    expect(AgentDeliveryReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(
      AgentMonitorMessageReceiptPayloadSchema.parse({ receipt }),
    ).toEqual({ receipt });
  });

  it('keeps the legacy receipt shape compatible', () => {
    expect(AgentDeliveryReceiptSchema.parse(legacyReceipt)).toEqual(legacyReceipt);
  });

  it('accepts a lane sender without sender metadata', () => {
    const receipt = { ...legacyReceipt, sender: 'lane' };

    expect(AgentDeliveryReceiptSchema.parse(receipt)).toEqual(receipt);
  });

  it('validates senderAgentId as an AgentId string', () => {
    expect(
      AgentDeliveryReceiptSchema.safeParse({
        ...legacyReceipt,
        sender: 'lane',
        senderAgentId: agentId,
      }).success,
    ).toBe(true);
    expect(
      AgentDeliveryReceiptSchema.safeParse({
        ...legacyReceipt,
        sender: 'lane',
        senderAgentId: 'not-an-agent-id',
      }).success,
    ).toBe(false);
  });

  it('validates receipt and parent-delivery agentId as an AgentId string', () => {
    expect(
      AgentDeliveryReceiptSchema.safeParse({
        ...legacyReceipt,
        agentId: 'not-an-agent-id',
      }).success,
    ).toBe(false);
    expect(
      AgentMonitorParentDeliveryPayloadSchema.safeParse({
        ...parentDelivery('pending'),
        agentId: 'not-an-agent-id',
      }).success,
    ).toBe(false);
  });

  it('accepts dispatching with everDispatched', () => {
    const receipt = {
      ...legacyReceipt,
      state: 'dispatching',
      everDispatched: true,
    };

    expect(AgentDeliveryReceiptSchema.parse(receipt)).toEqual(receipt);
  });

  it('rejects unknown receipt keys and invalid field bounds', () => {
    expect(
      AgentDeliveryReceiptSchema.safeParse({ ...legacyReceipt, extra: true }).success,
    ).toBe(false);
    expect(
      AgentMonitorMessageReceiptPayloadSchema.safeParse({
        receipt: legacyReceipt,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      AgentDeliveryReceiptSchema.safeParse({
        ...legacyReceipt,
        attemptCount: -1,
      }).success,
    ).toBe(false);
    expect(
      AgentDeliveryReceiptSchema.safeParse({
        ...legacyReceipt,
        lastError: 'x'.repeat(201),
      }).success,
    ).toBe(false);
    expect(
      AgentDeliveryReceiptSchema.safeParse({
        ...legacyReceipt,
        ackNote: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it.each([
    'sending',
    'blocked-retryable',
    'outcome-unknown',
    'cancelled',
  ] as const)('round-trips an extended %s parent payload', (state) => {
    const payload = parentDelivery(state);

    expect(AgentMonitorParentDeliveryPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('rejects the removed parent expired state and accepts the not-saved removal payload', () => {
    const expired = { ...parentDelivery('pending'), state: 'expired' };
    expect(AgentMonitorParentDeliveryPayloadSchema.safeParse(expired).success).toBe(false);

    const payload = {
      ...parentDelivery('not-saved'),
      state: 'not-saved',
      removed: true,
    };
    expect(AgentMonitorParentDeliveryPayloadSchema.parse(payload)).toEqual(payload);
    expect(
      AgentMonitorParentDeliveryPayloadSchema.safeParse({ ...payload, removed: false }).success,
    ).toBe(false);
  });

  it.each([
    `lane-delivery:report:${agentId}:3:abc123`,
    `lane-delivery:${agentId}:2026-11-07T12:00:00.000Z`,
  ])('accepts the current parent delivery id format %s', (deliveryId) => {
    const payload = { ...parentDelivery('pending'), deliveryId };

    expect(AgentMonitorParentDeliveryPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('accepts host-restart and rejects host-restarted as stop reasons', () => {
    expect(
      AgentMonitorParentDeliveryPayloadSchema.safeParse({
        ...parentDelivery('pending'),
        stopReason: 'host-restart',
      }).success,
    ).toBe(true);
    expect(
      AgentMonitorParentDeliveryPayloadSchema.safeParse({
        ...parentDelivery('pending'),
        stopReason: 'host-restarted',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown parent payload keys', () => {
    expect(
      AgentMonitorParentDeliveryPayloadSchema.safeParse({
        ...parentDelivery('pending'),
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe('agent messaging RPC contracts', () => {
  it('registers every messaging method', () => {
    expect(RPC_METHOD_NAMES).toEqual(
      expect.arrayContaining([
        'agent:sendMessage',
        'agent:listMessageReceipts',
        'agent:getQueuedMessageBody',
        'agent:retryMessage',
        'agent:cancelMessage',
        'agent:listParentDeliveries',
        'agent:retryParentDelivery',
        'agent:cancelParentDelivery',
      ]),
    );
  });

  it('re-exports the shared message limits through agent-process.types', () => {
    expect(AGENT_MESSAGE_MAX_CHARS).toBe(102_400);
    expect(AGENT_LANE_MESSAGE_MAX_CHARS).toBe(32_768);
  });
});
