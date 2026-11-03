import 'reflect-metadata';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AISessionConfig, SessionId } from '@ptah-extension/shared';
import { SdkAgentAdapter } from './sdk-agent-adapter';
import { SessionMetadataStore } from './session-metadata-store';
import { SdkAdapterCallbackRegistry } from './helpers/sdk-adapter-callback-registry';

const R = '/project';
const A = '/project/child-a';
const B = '/project/child-a/child-b';
const stream = (async function* () {})();

function runtime(store: SessionMetadataStore) {
  const executeQuery = jest.fn().mockImplementation(async () => ({
    sdkQuery: {},
    initialModel: 'model',
    sessionToken: 'token',
  }));
  const executeSlashCommandQuery = jest
    .fn()
    .mockImplementation(async (_id, _command, config) => {
      await config.beforeRelaunch();
      return { sdkQuery: {}, initialModel: 'model', sessionToken: 'token' };
    });
  const transform = jest.fn().mockReturnValue(stream);
  const adapter = Object.create(SdkAgentAdapter.prototype) as SdkAgentAdapter;
  Object.assign(adapter, {
    initialized: true,
    logger: createMockLogger(),
    metadataStore: store,
    callbacks: new SdkAdapterCallbackRegistry(),
    runtimeState: { getCliJsPath: () => null },
    sessionLifecycle: {
      executeQuery,
      executeSlashCommandQuery,
      find: jest.fn().mockReturnValue(undefined),
      bindRealSessionId: jest.fn().mockReturnValue('bound'),
    },
    streamTransformer: { transform },
    streamTaps: new WeakMap(),
    pendingUserActivity: new Map(),
    statsOwner: {
      startNew: () => ({ generation: 1 }),
      prepareRun: jest
        .fn()
        .mockResolvedValue({ generation: 1, candidate: null }),
      beginRun: jest.fn(),
      rebind: jest.fn(),
      leaseOf: jest.fn(),
    },
    historyReader: {
      readSessionUsagePrefix: jest.fn().mockResolvedValue(null),
      readLastSavedCostState: jest.fn().mockResolvedValue(null),
    },
    sessionBudget: { observeLive: jest.fn(), release: jest.fn() },
    sessionIdResolvedRegistry: { notifyAll: jest.fn() },
    activityRegistry: { notifyAll: jest.fn() },
  });
  return { adapter, executeQuery, executeSlashCommandQuery, transform };
}

async function bind(
  h: ReturnType<typeof runtime>,
  id: string,
  cwd: string,
  workspaceId: string,
  roots: readonly string[],
) {
  await h.adapter.startChatSession({
    tabId: id,
    model: 'model',
    projectPath: cwd,
    workspaceId,
    pluginConfigAncestorRoots: roots,
  });
  const last = h.transform.mock.lastCall?.[0] as {
    onSessionIdResolved: (
      tabId: string,
      realSessionId: string,
    ) => Promise<void>;
  };
  await last.onSessionIdResolved(id, `sdk-${id}`);
}

describe('SdkAgentAdapter durable plugin lineage', () => {
  let store: SessionMetadataStore;
  beforeEach(() => {
    store = new SessionMetadataStore(
      createMockStateStorage(),
      createMockLogger() as unknown as Logger,
    );
  });

  it('binds R → A → B to real SDK IDs and restores B in a fresh runtime', async () => {
    const first = runtime(store);
    await bind(first, 'r', R, R, []);
    await bind(first, 'a', A, R, [R]);
    await bind(first, 'b', B, R, [A, R]);
    expect((await store.get('sdk-b'))?.pluginConfigAncestorRoots).toEqual([
      A,
      R,
    ]);
    await store.delete('sdk-a');

    const fresh = runtime(store);
    await fresh.adapter.resumeSession('sdk-b' as SessionId, {
      model: 'model',
      projectPath: B,
      pluginConfigAncestorRoots: [],
    });
    expect(
      fresh.executeQuery.mock.lastCall?.[0].sessionConfig
        .pluginConfigAncestorRoots,
    ).toEqual([A, R]);
    await fresh.adapter.executeSlashCommand('sdk-b' as SessionId, '/compact', {
      sessionConfig: {
        model: 'model',
        projectPath: B,
        pluginConfigAncestorRoots: [],
      } as AISessionConfig,
    });
    expect(
      fresh.executeSlashCommandQuery.mock.lastCall?.[2].sessionConfig
        .pluginConfigAncestorRoots,
    ).toEqual([A, R]);
  });

  it('refuses malformed stored lineage before a recreated query', async () => {
    const created = await store.create('sdk-b', R, 'B');
    jest
      .spyOn(store, 'get')
      .mockResolvedValue({ ...created, pluginConfigAncestorRoots: [''] });
    const h = runtime(store);
    await expect(
      h.adapter.resumeSession('sdk-b' as SessionId, {
        model: 'model',
        projectPath: B,
      }),
    ).rejects.toThrow(/malformed stored/);
    expect(h.executeQuery).not.toHaveBeenCalled();
  });
});
