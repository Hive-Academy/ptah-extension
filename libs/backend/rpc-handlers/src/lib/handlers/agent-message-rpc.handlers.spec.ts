import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { RpcHandler } from '@ptah-extension/vscode-core';
import type { AgentMessageCoordinator } from '@ptah-extension/cli-agent-runtime';
import { AgentMessageRpcHandlers } from './agent-message-rpc.handlers';

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    AGENT_MESSAGE_COORDINATOR: Symbol.for('AgentMessageCoordinator'),
  },
}));

const AGENT_ID = '11111111-2222-4333-8444-555555555555';
const MESSAGE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('AgentMessageRpcHandlers', () => {
  const setup = () => {
    const logger = Object.assign(Object.create(null) as Logger, createMockLogger());
    const rpc = new RpcHandler(logger, undefined, undefined);
    const coordinator = Object.assign(Object.create(null) as AgentMessageCoordinator, {
      preview: jest.fn().mockReturnValue({ supported: true, mode: 'steer' }),
      send: jest.fn().mockResolvedValue({ mode: 'queue-next-turn', messageId: MESSAGE_ID }),
      getReceipt: jest.fn().mockResolvedValue({ id: MESSAGE_ID, state: 'accepted' }),
      cancel: jest.fn().mockResolvedValue({ id: MESSAGE_ID, state: 'failed' }),
    });
    new AgentMessageRpcHandlers(rpc, coordinator).register();
    const call = (method: string, params: Record<string, unknown>) =>
      rpc.handleMessage({ method, params, correlationId: method });
    return { coordinator, rpc, call };
  };

  it('routes all four methods to the coordinator', async () => {
    const { coordinator, rpc, call } = setup();
    expect(rpc.getRegisteredMethods()).toEqual(AgentMessageRpcHandlers.METHODS);
    await call('agent:previewMessage', { agentId: AGENT_ID, delivery: 'now' });
    await call('agent:sendMessage', { agentId: AGENT_ID, message: 'hello', delivery: 'steer' });
    await call('agent:getMessageReceipt', { agentId: AGENT_ID, messageId: MESSAGE_ID });
    await call('agent:cancelMessage', { agentId: AGENT_ID, messageId: MESSAGE_ID });
    expect(coordinator.preview).toHaveBeenCalledWith({ agentId: AGENT_ID, delivery: 'now' });
    expect(coordinator.send).toHaveBeenCalledWith({ agentId: AGENT_ID, message: 'hello', delivery: 'steer' });
    expect(coordinator.getReceipt).toHaveBeenCalledWith(AGENT_ID, MESSAGE_ID);
    expect(coordinator.cancel).toHaveBeenCalledWith(AGENT_ID, MESSAGE_ID);
  });

  it('rejects invalid delivery and unknown fields before coordinator calls', async () => {
    const { coordinator, call } = setup();
    const invalidDelivery = await call('agent:sendMessage', {
      agentId: AGENT_ID, message: 'hello', delivery: 'later',
    });
    const extraField = await call('agent:previewMessage', {
      agentId: AGENT_ID, delivery: 'queue', secret: 'extra',
    });
    expect(invalidDelivery.error).toBeDefined();
    expect(extraField.error).toBeDefined();
    expect(coordinator.send).not.toHaveBeenCalled();
    expect(coordinator.preview).not.toHaveBeenCalled();
  });
});
