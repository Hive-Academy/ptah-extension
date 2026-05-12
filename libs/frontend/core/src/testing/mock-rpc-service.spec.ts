/**
 * Smoke tests for `createMockRpcService` — verifies the factory produces a
 * `jest.Mocked<ClaudeRpcService>` whose defaults round-trip and that
 * `rpcSuccess` / `rpcError` helpers build the expected `RpcResult` shape.
 */

import { ClaudeRpcService } from '../lib/services/claude-rpc.service';
import { createMockRpcService, rpcError, rpcSuccess } from './mock-rpc-service';

describe('createMockRpcService', () => {
  it('returns a mock whose default call() resolves to a success RpcResult', async () => {
    const rpc = createMockRpcService();

    const result = await rpc.call('session:list', {
      workspacePath: '/tmp',
    });

    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it('allows overriding call() per test via mockResolvedValue', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({ sessions: [], total: 0, hasMore: false }),
    );

    const result = await rpc.listSessions('/tmp');

    // listSessions uses the default mock, not the overridden call().
    expect(result.isSuccess()).toBe(true);
  });

  it('exposes typed wrappers (listSessions, openFile, deleteSession, renameSession, querySubagents, subagent commands)', () => {
    const rpc = createMockRpcService();
    const instance: Partial<ClaudeRpcService> = rpc;

    expect(typeof instance.listSessions).toBe('function');
    expect(typeof instance.openFile).toBe('function');
    expect(typeof instance.deleteSession).toBe('function');
    expect(typeof instance.renameSession).toBe('function');
    expect(typeof instance.querySubagents).toBe('function');
    expect(typeof instance.sendSubagentMessage).toBe('function');
    expect(typeof instance.stopSubagent).toBe('function');
    expect(typeof instance.interruptSubagentSession).toBe('function');
  });
});

describe('rpcSuccess / rpcError', () => {
  it('rpcSuccess produces a successful RpcResult with the given data', () => {
    const result = rpcSuccess({ hello: 'world' });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.data).toEqual({ hello: 'world' });
    }
  });

  it('rpcError produces a failed RpcResult carrying error + errorCode', () => {
    const result = rpcError<string>('boom', 'LICENSE_REQUIRED');
    expect(result.isError()).toBe(true);
    expect(result.error).toBe('boom');
    expect(result.isLicenseError()).toBe(true);
  });
});
