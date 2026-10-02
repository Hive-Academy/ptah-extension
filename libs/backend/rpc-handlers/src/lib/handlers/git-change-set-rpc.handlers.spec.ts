/**
 * GitChangeSetRpcHandlers — unit specs.
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/git-change-set-rpc.handlers.ts
 */

import 'reflect-metadata';

import { RpcUserError, type RpcHandler } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type { TurnChangeSet } from '@ptah-extension/shared';

import type { TurnChangeSetStore } from '../chat/change-set/turn-change-set.store';
import { GitChangeSetRpcHandlers } from './git-change-set-rpc.handlers';

type MockStore = jest.Mocked<Pick<TurnChangeSetStore, 'list'>>;

function changeSet(sessionId: string, turnEndedAt: number): TurnChangeSet {
  return {
    sessionId,
    workspaceRoot: '/workspace',
    turnStartedAt: turnEndedAt - 10,
    turnEndedAt,
    files: [{ path: 'src/a.ts', status: 'M', additions: 2, deletions: 1 }],
    truncatedCount: 0,
    totals: { files: 1, additions: 2, deletions: 1 },
    countsUnavailable: false,
  };
}

function buildSuite(): { rpc: MockRpcHandler; store: MockStore } {
  const rpc = createMockRpcHandler();
  const store: MockStore = { list: jest.fn().mockResolvedValue([]) };
  new GitChangeSetRpcHandlers(
    rpc as unknown as RpcHandler,
    store as unknown as TurnChangeSetStore,
  ).register();
  return { rpc, store };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (params: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method '${method}' was not registered`);
  return match[1];
}

describe('GitChangeSetRpcHandlers', () => {
  it('owns exactly git:turnChangeSets and registers it', () => {
    const { rpc } = buildSuite();

    expect(GitChangeSetRpcHandlers.METHODS).toEqual(['git:turnChangeSets']);
    const registered = (rpc.registerMethod as jest.Mock).mock.calls.map(
      ([name]) => name as string,
    );
    expect(registered).toEqual(['git:turnChangeSets']);
  });

  it("returns the session's stored change sets, oldest first, as stored", async () => {
    const { rpc, store } = buildSuite();
    const stored = [changeSet('s-1', 100), changeSet('s-1', 200)];
    store.list.mockResolvedValue(stored);

    const result = await getHandler(rpc, 'git:turnChangeSets')({
      sessionId: 's-1',
    });

    expect(store.list).toHaveBeenCalledWith('s-1');
    expect(result).toEqual({ changeSets: stored });
  });

  it('returns an empty list for a session with no change sets', async () => {
    const { rpc } = buildSuite();

    await expect(
      getHandler(rpc, 'git:turnChangeSets')({ sessionId: 's-2' }),
    ).resolves.toEqual({ changeSets: [] });
  });

  it.each([
    ['no params', undefined],
    ['null', null],
    ['missing sessionId', {}],
    ['empty sessionId', { sessionId: '' }],
    ['non-string sessionId', { sessionId: 42 }],
    ['oversized sessionId', { sessionId: 'x'.repeat(513) }],
    ['unknown field', { sessionId: 's-1', workspaceRoot: '/elsewhere' }],
  ])('rejects %s without reading storage', async (_label, params) => {
    const { rpc, store } = buildSuite();

    const call = getHandler(rpc, 'git:turnChangeSets')(params);

    await expect(call).rejects.toBeInstanceOf(RpcUserError);
    await expect(call).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(store.list).not.toHaveBeenCalled();
  });

  it('surfaces a storage failure as a rejection rather than an empty history', async () => {
    const { rpc, store } = buildSuite();
    store.list.mockRejectedValue(new Error('storage unavailable'));

    await expect(
      getHandler(rpc, 'git:turnChangeSets')({ sessionId: 's-1' }),
    ).rejects.toThrow('storage unavailable');
  });
});
