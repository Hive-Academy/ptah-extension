import type {
  AgentDeliveryReceipt,
  AgentDeliveryReceiptState,
  AgentId,
  AgentMessageRequest,
  CliAdapterManifest,
  CliDetectionResult,
} from '../agent-process.types';
import type {
  RpcMethodParams,
  RpcMethodResult,
} from '../rpc.types';
import { AgentId as AgentIds } from '../agent-process.types';
import { MESSAGE_TYPES } from './message-constants';
import type {
  AgentMonitorMessageReceiptPayload,
  AgentMonitorParentDeliveryPayload,
} from './agent-monitor';
import type { MessagePayloadMap } from './payload-map';
import {
  AgentMonitorMessageReceiptPayloadSchema,
  AgentMonitorParentDeliveryPayloadSchema,
} from './schemas';

const agentId = AgentIds.from('123e4567-e89b-42d3-a456-426614174000');

const manifest = {
  messaging: {
    steer: { state: 'unsupported', reason: 'No live input channel.' },
    interrupt: { state: 'unsupported', reason: 'No run-scoped interrupt.' },
    continuation: { state: 'supported' },
    resume: { state: 'supported' },
  },
  roleChannel: 'task-prompt',
  permissionModes: {
    plan: {
      state: 'supported',
      nativeMode: 'read-only',
      networkModes: ['allow', 'deny'],
    },
  },
  networkModes: {
    allow: { state: 'supported' },
    deny: { state: 'supported' },
  },
  limitReader: { state: 'available', source: 'test-reader' },
  mcp: { state: 'supported' },
} satisfies CliAdapterManifest;

const detection = {
  cli: 'codex',
  installed: true,
  messagingMode: 'steer',
  manifest,
} satisfies CliDetectionResult;

const request: AgentMessageRequest = {
  agentId,
  message: 'Continue the task.',
  delivery: 'queue',
  allowPartialTurnLoss: false,
};

function receipt(state: AgentDeliveryReceiptState): AgentDeliveryReceipt {
  return {
    id: `message-${state}`,
    agentId,
    state,
    mode: 'queue-next-turn',
    delivery: 'queue',
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('agent monitor lane contracts', () => {
  it('covers preview, send, receipt read, and cancel in the RPC registry', () => {
    const preview: RpcMethodParams<'agent:previewMessage'> = {
      agentId,
      delivery: 'now',
    };
    const send: RpcMethodParams<'agent:sendMessage'> = request;
    const read: RpcMethodParams<'agent:getMessageReceipt'> = {
      agentId,
      messageId: 'message-1',
    };
    const cancel: RpcMethodParams<'agent:cancelMessage'> = read;
    const previewResult = {} as RpcMethodResult<'agent:previewMessage'>;
    const receiptResult = {} as RpcMethodResult<'agent:getMessageReceipt'>;

    expect(preview.delivery).toBe('now');
    expect(send.allowPartialTurnLoss).toBe(false);
    expect(read.messageId).toBe('message-1');
    expect(cancel.agentId).toBe(agentId);
    expect(previewResult).toBeDefined();
    expect(receiptResult).toBeDefined();
    expect(detection.manifest).toBe(manifest);
  });

  it.each([
    'accepted',
    'started',
    'settled',
    'failed',
    'expired',
    'interrupted-undelivered',
  ] as const)('accepts the %s receipt state and rejects unknown fields', (state) => {
    const payload: AgentMonitorMessageReceiptPayload = { receipt: receipt(state) };
    const wire: MessagePayloadMap[typeof MESSAGE_TYPES.AGENT_MONITOR_MESSAGE_RECEIPT] =
      payload;

    expect(AgentMonitorMessageReceiptPayloadSchema.safeParse(wire).success).toBe(true);
    expect(
      AgentMonitorMessageReceiptPayloadSchema.safeParse({
        receipt: { ...receipt(state), message: 'not public' },
      }).success,
    ).toBe(false);
    expect(
      AgentMonitorMessageReceiptPayloadSchema.safeParse({ ...wire, extra: true }).success,
    ).toBe(false);
  });

  it.each(['pending', 'delivered'] as const)(
    'accepts the %s parent-delivery state and rejects unknown fields',
    (state) => {
      const payload: AgentMonitorParentDeliveryPayload = {
        agentId,
        kind: 'completion',
        state,
        deliveryId: 'lane-delivery:completion-1',
      };
      const wire: MessagePayloadMap[typeof MESSAGE_TYPES.AGENT_MONITOR_PARENT_DELIVERY] =
        payload;

      expect(AgentMonitorParentDeliveryPayloadSchema.safeParse(wire).success).toBe(true);
      expect(
        AgentMonitorParentDeliveryPayloadSchema.safeParse({ ...wire, extra: true }).success,
      ).toBe(false);
    },
  );
  it.each(['delivered', 'no-deliverable', 'failed', 'unverified'] as const)(
    'accepts the %s completion verdict',
    (verdict) => {
      expect(AgentMonitorParentDeliveryPayloadSchema.safeParse({
        agentId, kind: 'completion', state: 'pending', verdict, stopReason: 'usage-limit',
      }).success).toBe(true);
    },
  );
});
