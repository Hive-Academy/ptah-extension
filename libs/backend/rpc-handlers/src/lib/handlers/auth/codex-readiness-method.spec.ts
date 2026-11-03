import 'reflect-metadata';
import type { ICodexReadinessReader } from '@ptah-extension/auth-providers';
import type { AuthGetCodexReadinessResponse } from '@ptah-extension/shared';
import { RpcUserError, type RpcHandler } from '@ptah-extension/vscode-core';
import { CodexReadinessMethod } from './codex-readiness-method';

describe('CodexReadinessMethod', () => {
  const answer: AuthGetCodexReadinessResponse = {
    binary: { state: 'missing' },
    signIn: { outcome: 'signed-out' },
    checkedAt: '2026-11-03T00:00:00.000Z',
  };

  function setup(reader?: ICodexReadinessReader) {
    let handler: ((params: unknown) => Promise<AuthGetCodexReadinessResponse>) | undefined;
    const rpcHandler = {
      registerMethod: jest.fn((name: string, callback: (params: unknown) => Promise<AuthGetCodexReadinessResponse>) => {
        expect(name).toBe('auth:getCodexReadiness');
        handler = callback;
      }),
    } as unknown as RpcHandler;
    new CodexReadinessMethod(rpcHandler, reader).register();
    if (!handler) throw new Error('method was not registered');
    return handler;
  }

  it('forwards valid options and drops an unknown trigger', async () => {
    const read = jest.fn<Promise<AuthGetCodexReadinessResponse>, [Parameters<ICodexReadinessReader['read']>[0]]>(
      async () => answer,
    );
    const call = setup({ read });
    await expect(call({ refresh: true, trigger: 'follow-up' })).resolves.toEqual(answer);
    await expect(call({ refresh: false, trigger: 'other' })).resolves.toEqual(answer);
    expect(read).toHaveBeenNthCalledWith(1, { refresh: true, trigger: 'follow-up' });
    expect(read).toHaveBeenNthCalledWith(2, { refresh: false });
  });

  it.each([null, 'bad', [], { refresh: 'yes' }, { refresh: 1 }])(
    'rejects invalid params before reading', async params => {
      const read = jest.fn<Promise<AuthGetCodexReadinessResponse>, [Parameters<ICodexReadinessReader['read']>[0]]>(
        async () => answer,
      );
      await expect(setup({ read })(params)).rejects.toBeInstanceOf(RpcUserError);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('returns local unknown when the reader is absent', async () => {
    const result = await setup()({});
    expect(result).toMatchObject({
      binary: { state: 'unknown', reason: 'local' },
      signIn: { outcome: 'unreadable' },
    });
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  });
});
