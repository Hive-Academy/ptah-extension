import 'reflect-metadata';

import { container } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import { AttentionRpcHandlers } from './attention-rpc.handlers';
import {
  AttentionGetSnapshotParamsSchema,
  AttentionGetSnapshotResultSchema,
} from './attention-rpc.schema';

const METHOD = 'attention:getSnapshot';

function setup() {
  const logger = { debug: jest.fn(), warn: jest.fn() };
  const registered = new Map<string, (params: unknown) => Promise<unknown>>();
  const rpcHandler = {
    registerMethod: jest.fn((method: string, handler: (params: unknown) => Promise<unknown>) => {
      registered.set(method, handler);
    }),
  };
  const coordinator = { pendingNotices: jest.fn(() => [
    {
      key: 'permission:request-1', generation: 12, kind: 'permission' as const,
      severity: 'warning' as const, label: 'Permission needed' as const,
      actionLabel: 'Open Ptah' as const, sessionTitle: 'Session A',
      target: { workspaceId: 'workspace-1', sessionId: 'session-1' },
      question: 'secret question', toolArgs: 'secret arguments',
    },
  ]) };
  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(SDK_TOKENS.HOST_ATTENTION_COORDINATOR, coordinator);
  child.resolve(AttentionRpcHandlers).register();
  const call = (params: unknown) => {
    const handler = registered.get(METHOD);
    if (!handler) throw new Error(`${METHOD} was not registered`);
    return handler(params);
  };
  return { call, coordinator, logger, rpcHandler };
}

describe('AttentionRpcHandlers', () => {
  it('registers the declared RPC method', () => {
    const { rpcHandler } = setup();
    expect(AttentionRpcHandlers.METHODS).toEqual([METHOD]);
    expect(RPC_METHOD_NAMES).toContain(METHOD);
    expect(rpcHandler.registerMethod).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown request fields before reading pending notices', async () => {
    const { call, coordinator } = setup();
    expect(AttentionGetSnapshotParamsSchema.safeParse({ filter: 'private' }).success).toBe(false);
    await expect(call({ filter: 'private' })).rejects.toBeInstanceOf(RpcUserError);
    expect(coordinator.pendingNotices).not.toHaveBeenCalled();
  });

  it('returns only the shared safe projection', async () => {
    const { call } = setup();
    const result = await call({});
    expect(result).toEqual({ notices: [{
      key: 'permission:request-1', generation: 12, kind: 'permission',
      title: 'Session A', occurredAt: 12,
      target: { workspaceId: 'workspace-1', sessionId: 'session-1' },
    }] });
    expect(AttentionGetSnapshotResultSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret|question|toolArgs/);
  });

  it('drops invalid notices, keeps valid notices, and logs one safe count', async () => {
    const { call, coordinator, logger } = setup();
    const valid = coordinator.pendingNotices()[0];
    coordinator.pendingNotices.mockReturnValueOnce([
      { ...valid, key: 'permission:secret path', question: 'secret question' },
      valid,
      { ...valid, key: 'permission:another bad path', toolArgs: 'secret arguments' },
    ]);
    await expect(call({})).resolves.toEqual({ notices: [{
      key: 'permission:request-1', generation: 12, kind: 'permission',
      title: 'Session A', occurredAt: 12,
      target: { workspaceId: 'workspace-1', sessionId: 'session-1' },
    }] });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[RPC] attention:getSnapshot dropped invalid notices',
      { errorName: 'ZodError', count: 2 },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  it('returns an empty snapshot when every pending notice is invalid', async () => {
    const { call, coordinator } = setup();
    const invalid = { ...coordinator.pendingNotices()[0], key: 'permission:bad path' };
    coordinator.pendingNotices.mockReturnValueOnce([invalid]);
    await expect(call({})).resolves.toEqual({ notices: [] });
  });

  it('returns a coded error when the coordinator cannot build a snapshot', async () => {
    const { call, coordinator, logger } = setup();
    coordinator.pendingNotices.mockImplementationOnce(() => {
      throw new Error('secret coordinator failure');
    });
    await expect(call({})).rejects.toMatchObject({
      name: 'RpcUserError',
      message: 'Attention snapshot unavailable.',
      errorCode: 'PERSISTENCE_UNAVAILABLE',
    });
    expect(logger.warn).toHaveBeenCalledWith('[RPC] attention:getSnapshot failed', {
      errorName: 'Error',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });
});
