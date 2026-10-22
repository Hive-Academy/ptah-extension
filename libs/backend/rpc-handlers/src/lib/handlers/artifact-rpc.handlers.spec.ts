import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS, type IArtifactStore, type IUserInteraction } from '@ptah-extension/platform-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { ArtifactRpcHandlers, isSafeExternalUrl } from './artifact-rpc.handlers';

type Handler = (params: unknown) => Promise<unknown>;

function setup(store?: IArtifactStore) {
  const methods = new Map<string, Handler>();
  const logger = { warn: jest.fn() } as Partial<Logger> as Logger;
  const rpc = {
    registerMethod: jest.fn((name: string, handler: Handler) => methods.set(name, handler)),
  } as Partial<RpcHandler> as RpcHandler;
  const lifecycle = { find: jest.fn((id: string) => id === 'tab-a' || id === 'sdk-a'
    ? { tabId: 'tab-a', config: { projectPath: '/workspace/a' } }
    : undefined) };
  const container = {
    isRegistered: jest.fn((token: symbol) => token === SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER
      || token === PLATFORM_TOKENS.ARTIFACT_STORE && !!store),
    resolve: jest.fn((token: symbol) => token === SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER ? lifecycle : store),
  } as Partial<DependencyContainer> as DependencyContainer;
  const interaction = { openExternal: jest.fn(async () => true) } as Partial<IUserInteraction> as IUserInteraction;
  new ArtifactRpcHandlers(logger, rpc, container, interaction).register();
  const call = (name: string, params: unknown) => {
    const handler = methods.get(name);
    if (!handler) throw new Error(`Missing handler: ${name}`);
    return handler(params);
  };
  return { call, container, lifecycle, interaction };
}

describe('ArtifactRpcHandlers', () => {
  it('resolves a tab or SDK id and lists only its routing tab and workspace', async () => {
    const store = { list: jest.fn(async () => ({ artifacts: [] })) } as Partial<IArtifactStore> as IArtifactStore;
    const h = setup(store);
    expect(await h.call('artifacts:list', { sessionId: 'sdk-a' })).toEqual({ artifacts: [] });
    expect(store.list).toHaveBeenCalledWith({ workspaceRoot: '/workspace/a', sessionId: 'tab-a' });
  });

  it('returns only the registry session rows without saved paths', async () => {
    const artifact = {
      id: 'abcdefghijklmnop', title: 'Report', revision: 1, sessionId: 'tab-a',
      viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
      createdAt: '2026-10-20T12:00:00.000Z',
    };
    const store = { list: jest.fn(async () => ({ artifacts: [artifact] })) } as Partial<IArtifactStore> as IArtifactStore;
    const h = setup(store);
    expect(await h.call('artifacts:list', { sessionId: 'tab-a' }))
      .toEqual({ artifacts: [artifact] });
    expect(store.list).toHaveBeenCalledWith({ workspaceRoot: '/workspace/a', sessionId: 'tab-a' });
  });

  it('returns an empty list without a store or known session', async () => {
    const h = setup();
    expect(await h.call('artifacts:list', { sessionId: 'unknown' })).toEqual({ artifacts: [] });
    expect(h.lifecycle.find).toHaveBeenCalledWith('unknown');
  });

  it('rejects a list request without a session id', async () => {
    const h = setup();
    await expect(h.call('artifacts:list', {})).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it.each(['javascript:alert(1)', 'file:///tmp/a', 'ptah-artifact://id/index.html'])(
    'rejects unsafe link %s', async (url) => {
      const h = setup();
      await expect(h.call('artifacts:openLink', { url })).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(h.interaction.openExternal).not.toHaveBeenCalled();
    },
  );

  it.each(['https://example.com', 'http://example.com'])(
    'opens HTTP(S) link %s', async (url) => {
      const h = setup();
      expect(await h.call('artifacts:openLink', { url })).toEqual({ opened: true });
      expect(h.interaction.openExternal).toHaveBeenCalledWith(url);
    },
  );

  it('allows only HTTP(S) URLs in the local navigation predicate', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///tmp/a')).toBe(false);
    expect(isSafeExternalUrl('not a URL')).toBe(false);
  });
});
