/**
 * SessionMetadataStore over the global session store (Plane PTAH-35, MP-1).
 *
 * The store is resolved through DI the way the hosts build it. When
 * PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY is bound, every session is written
 * to that one store, keyed by its own id and project, whatever project the UI
 * has active. Nothing goes to the workspace-routed state storage, and nothing
 * waits in memory for its project to become active.
 */

import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type SessionRecord,
} from '@ptah-extension/platform-core';
import {
  createMockSessionBlobStore,
  createMockSessionRecordRepository,
  createMockStateStorage,
} from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SessionMetadataStore } from './session-metadata-store';

const WS_A = '/projects/alpha';
const WS_B = '/projects/beta';
const WS_C = '/projects/gamma';
const METADATA_KEY = 'ptah.sessionMetadata';

/** Electron-style storage that routes every call to the active project's store. */
function routedStorage() {
  const stores = new Map([
    [WS_A, createMockStateStorage()],
    [WS_B, createMockStateStorage()],
    [WS_C, createMockStateStorage()],
  ]);
  let active = WS_A;
  const current = () =>
    stores.get(active) as ReturnType<typeof createMockStateStorage>;
  return {
    stores,
    activate: (path: string) => {
      active = path;
    },
    storage: {
      get: <T>(key: string, fallback?: T) => current().get<T>(key, fallback),
      update: (key: string, value: unknown) => current().update(key, value),
      keys: () => current().keys(),
      getActiveWorkspacePath: () => active,
      getStorageForWorkspace: (path: string) => stores.get(path),
    },
  };
}

function build(
  routed: ReturnType<typeof routedStorage>,
  records: Map<string, SessionRecord>,
): SessionMetadataStore {
  const c = rootContainer.createChildContainer();
  c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: routed.storage,
  });
  c.register(TOKENS.LOGGER, { useValue: createMockLogger() });
  c.register(PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY, {
    useValue: createMockSessionRecordRepository({ records }),
  });
  c.register(PLATFORM_TOKENS.SESSION_BLOB_STORE, {
    useValue: createMockSessionBlobStore(),
  });
  return c.resolve(SessionMetadataStore);
}

const ids = (items: ReadonlyArray<{ sessionId: string }>) =>
  items.map((m) => m.sessionId).sort();

describe('SessionMetadataStore — global session store', () => {
  it('keeps sessions of 3 projects written at once while the active project changes', async () => {
    const routed = routedStorage();
    const records = new Map<string, SessionRecord>();
    const store = build(routed, records);

    await Promise.all([
      store.create('sess-a', WS_A, 'Alpha'),
      (async () => {
        routed.activate(WS_B);
        await store.create('sess-b', WS_B, 'Beta');
      })(),
      (async () => {
        routed.activate(WS_C);
        await store.create('sess-c', WS_C, 'Gamma');
      })(),
    ]);
    routed.activate(WS_C);
    await Promise.all([
      store.touch('sess-a'),
      store.touch('sess-b'),
      store.rename('sess-a', 'Alpha renamed'),
    ]);

    // A restart: a new store over the same records, with a different project active.
    routed.activate(WS_B);
    const restarted = build(routed, records);

    expect(ids(await restarted.getForWorkspace(WS_A))).toEqual(['sess-a']);
    expect(ids(await restarted.getForWorkspace(WS_B))).toEqual(['sess-b']);
    expect(ids(await restarted.getForWorkspace(WS_C))).toEqual(['sess-c']);
    expect(ids(await restarted.getAll())).toEqual([
      'sess-a',
      'sess-b',
      'sess-c',
    ]);
    await expect(restarted.get('sess-a')).resolves.toMatchObject({
      name: 'Alpha renamed',
      workspaceId: WS_A,
    });
  });

  it('writes nothing into the workspace-routed state storage', async () => {
    const routed = routedStorage();
    const store = build(routed, new Map());
    routed.activate(WS_B);

    await store.create('sess-a', WS_A, 'Alpha');
    await store.create('sess-b', WS_B, 'Beta, in the active project');
    await store.touch('sess-a');
    await store.touch('sess-b');

    for (const project of [WS_A, WS_B, WS_C]) {
      expect(
        routed.stores.get(project)?.__state.entries.get(METADATA_KEY),
      ).toBeUndefined();
    }
  });

  it('lists a project however its path is spelled', async () => {
    const routed = routedStorage();
    const store = build(routed, new Map());

    await store.create('sess-a', `${WS_A}/`, 'Alpha');

    expect(ids(await store.getForWorkspace(WS_A))).toEqual(['sess-a']);
    expect(ids(await store.getForWorkspace(`${WS_A}//`))).toEqual(['sess-a']);
  });

  describe('agent output', () => {
    const AGENT = '33333333-3333-4333-8333-333333333333';

    function buildWithBlobs(routed: ReturnType<typeof routedStorage>) {
      const blobs = createMockSessionBlobStore();
      const c = rootContainer.createChildContainer();
      c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
        useValue: routed.storage,
      });
      c.register(TOKENS.LOGGER, { useValue: createMockLogger() });
      c.register(PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY, {
        useValue: createMockSessionRecordRepository(),
      });
      c.register(PLATFORM_TOKENS.SESSION_BLOB_STORE, { useValue: blobs });
      return { store: c.resolve(SessionMetadataStore), blobs };
    }

    it('is stored under its session, not in the workspace storage, and pages back', async () => {
      const routed = routedStorage();
      const { store, blobs } = buildWithBlobs(routed);
      await store.create('sess-a', WS_A, 'Alpha');
      routed.activate(WS_B);

      await store.saveAgentOutput(
        AGENT,
        { segments: [{ type: 'text', content: 'hello' }] },
        'sess-a',
      );

      expect([...blobs.__blobs.keys()]).toEqual([
        `sess-a/agent-output.${AGENT}`,
      ]);
      for (const project of [WS_A, WS_B, WS_C]) {
        expect(routed.stores.get(project)?.__state.entries.size).toBe(0);
      }
      const page = await store.getAgentOutputPage(
        AGENT,
        undefined,
        64 * 1024,
        'sess-a',
      );
      expect(page).toMatchObject({
        done: true,
        items: [{ tag: 'segment', value: { content: 'hello' } }],
      });
    });

    it('is removed with its session', async () => {
      const routed = routedStorage();
      const { store, blobs } = buildWithBlobs(routed);
      await store.create('sess-a', WS_A, 'Alpha');
      await store.saveAgentOutput(
        AGENT,
        { segments: [{ type: 'text', content: 'x' }] },
        'sess-a',
      );
      await store.addCliSession('sess-a', {
        cliSessionId: 'cli-1',
        cli: 'codex',
        agentId: AGENT,
        task: 't',
        startedAt: new Date(0).toISOString(),
        status: 'completed',
      } as never);

      await store.delete('sess-a');

      expect(blobs.__blobs.size).toBe(0);
    });

    it('refuses to guess a location when no session id is given', async () => {
      const { store } = buildWithBlobs(routedStorage());
      await expect(
        store.saveAgentOutput(AGENT, {
          segments: [{ type: 'text', content: 'x' }],
        }),
      ).rejects.toThrow(/session id/i);
    });
  });

  it('waits for the legacy copy-forward before its first read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const records = new Map<string, SessionRecord>();
    const c = rootContainer.createChildContainer();
    c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: routedStorage().storage,
    });
    c.register(TOKENS.LOGGER, { useValue: createMockLogger() });
    const repository = createMockSessionRecordRepository({ records });
    c.register(PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY, {
      useValue: repository,
    });
    c.register(PLATFORM_TOKENS.SESSION_BLOB_STORE, {
      useValue: createMockSessionBlobStore(),
    });
    c.register(PLATFORM_TOKENS.SESSION_STORE_GATE, {
      useValue: { whenReady: () => gate },
    });
    const store = c.resolve(SessionMetadataStore);

    let listed: string[] | undefined;
    const listing = store
      .getForWorkspace(WS_A)
      .then((rows) => (listed = ids(rows)));
    // The copy-forward lands a session while the list is waiting.
    await repository.upsert({
      sessionId: 'migrated',
      workspacePath: WS_A,
      name: 'From the old store',
      createdAt: 1,
      lastActiveAt: 1,
      isChild: false,
      summary: { sessionId: 'migrated' },
      detail: { sessionId: 'migrated' },
    });
    await Promise.resolve();
    expect(listed).toBeUndefined();

    release();
    await listing;
    expect(listed).toEqual(['migrated']);
  });

  it('deletes from the global store', async () => {
    const routed = routedStorage();
    const records = new Map<string, SessionRecord>();
    const store = build(routed, records);

    await store.create('sess-a', WS_A, 'Alpha');
    await store.delete('sess-a');

    expect(records.has('sess-a')).toBe(false);
    await expect(store.get('sess-a')).resolves.toBeNull();
  });
});
