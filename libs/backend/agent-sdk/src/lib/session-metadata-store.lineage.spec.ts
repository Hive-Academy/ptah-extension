import 'reflect-metadata';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import {
  omitJsonPaths,
  type IAsyncStateStorage,
  type StateStorageGetOptions,
} from '@ptah-extension/platform-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SessionMetadataStore,
  SESSION_METADATA_MIGRATION,
} from './session-metadata-store';

describe('SessionMetadataStore plugin configuration lineage', () => {
  const root = '/project';
  const ancestors = ['/project/parent', '/project/grandparent'];
  let store: SessionMetadataStore;
  let storage: ReturnType<typeof createMockStateStorage>;

  beforeEach(() => {
    storage = createMockStateStorage();
    store = new SessionMetadataStore(
      storage,
      createMockLogger() as unknown as Logger,
    );
  });

  it('distinguishes absent, explicitly empty, valid, and malformed records', async () => {
    expect(
      SessionMetadataStore.readPluginConfigAncestorRoots(null).status,
    ).toBe('missing');
    const legacy = await store.create('legacy', root, 'Legacy');
    expect(
      SessionMetadataStore.readPluginConfigAncestorRoots(legacy).status,
    ).toBe('legacy');
    const independent = await store.create(
      'independent',
      root,
      'Independent',
      'created',
      undefined,
      undefined,
      [],
    );
    expect(
      SessionMetadataStore.readPluginConfigAncestorRoots(independent),
    ).toEqual({ status: 'valid', roots: [] });
    expect(
      SessionMetadataStore.readPluginConfigAncestorRoots({
        ...legacy,
        pluginConfigAncestorRoots: [''],
      }),
    ).toEqual({ status: 'malformed' });
  });

  it('persists a new bind through detail, summary and later generic saves', async () => {
    const created = await store.create(
      'nested',
      root,
      'Nested',
      'created',
      `${root}/child`,
      undefined,
      ancestors,
    );
    await store.create(
      'nested',
      root,
      'Renamed by init',
      'created',
      `${root}/other`,
      undefined,
      [],
    );
    await store.save({
      ...created,
      pluginConfigAncestorRoots: undefined,
      totalCost: 4,
    });
    expect((await store.get('nested'))?.pluginConfigAncestorRoots).toEqual(
      ancestors,
    );
    expect(
      (await store.getForWorkspace(root))[0]?.pluginConfigAncestorRoots,
    ).toEqual(ancestors);
    expect(SESSION_METADATA_MIGRATION.summaryFields).toContainEqual({
      sourcePath: ['pluginConfigAncestorRoots'],
    });
    const fresh = new SessionMetadataStore(
      storage,
      createMockLogger() as unknown as Logger,
    );
    expect((await fresh.get('nested'))?.pluginConfigAncestorRoots).toEqual(
      ancestors,
    );
    expect(
      (await fresh.getForWorkspace(root))[0]?.pluginConfigAncestorRoots,
    ).toEqual(ancestors);
  });

  it('round trips through split index and detail storage after restart', async () => {
    const asyncStorage = {
      ...storage,
      getAsync: async (
        key: string,
        fallback?: unknown,
        options?: StateStorageGetOptions,
      ) => {
        const value = storage.get(key, fallback);
        return options?.projection && value !== undefined
          ? omitJsonPaths(value, options.projection.omit)
          : value;
      },
      readJsonSequence: jest.fn(async function* () {
        yield { items: [], nextCursor: null, done: true, approximateBytes: 0 };
      }),
      replaceJsonSequence: jest.fn(async () => undefined),
    } as unknown as IAsyncStateStorage;
    const split = new SessionMetadataStore(
      asyncStorage,
      createMockLogger() as unknown as Logger,
    );
    await split.create(
      'split',
      root,
      'Split',
      'created',
      `${root}/child`,
      undefined,
      ancestors,
    );
    expect(storage.__state.entries.get('ptah.sessionMetadata')).toMatchObject({
      schemaVersion: 1,
      items: [
        expect.objectContaining({ pluginConfigAncestorRoots: ancestors }),
      ],
    });
    expect(storage.__state.entries.get('ptah.session:split')).toMatchObject({
      pluginConfigAncestorRoots: ancestors,
    });
    const restarted = new SessionMetadataStore(
      asyncStorage,
      createMockLogger() as unknown as Logger,
    );
    expect((await restarted.get('split'))?.pluginConfigAncestorRoots).toEqual(
      ancestors,
    );
    expect(
      (await restarted.getForWorkspace(root))[0]?.pluginConfigAncestorRoots,
    ).toEqual(ancestors);
  });

  it('upgrades legacy once, preserving valid and malformed bindings', async () => {
    await store.create('old', root, 'Old');
    expect(
      await store.upgradeLegacyPluginConfigAncestorRoots('old', ancestors),
    ).toEqual({ status: 'valid', roots: ancestors });
    expect(
      await store.upgradeLegacyPluginConfigAncestorRoots('old', []),
    ).toEqual({ status: 'valid', roots: ancestors });
    const malformed = await store.create('bad', root, 'Bad');
    jest
      .spyOn(store, 'get')
      .mockResolvedValueOnce({ ...malformed, pluginConfigAncestorRoots: [''] });
    expect(
      await store.upgradeLegacyPluginConfigAncestorRoots('bad', ancestors),
    ).toEqual({ status: 'malformed' });
    expect(
      SessionMetadataStore.readPluginConfigAncestorRoots({
        ...malformed,
        pluginConfigAncestorRoots: [''],
      }),
    ).toEqual({ status: 'malformed' });
  });
});
