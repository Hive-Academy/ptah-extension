/**
 * Copy-forward from legacy per-workspace stores into the global session store
 * (Plane PTAH-35, MP-1).
 *
 * The legacy data is written by SessionMetadataStore itself, without the
 * repository, over a sync store (VS Code shape) and an async one (Electron
 * worker shape: split index, detail keys, agent output as a sequence). It is
 * then migrated and read back through the store with the repository bound.
 */

import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  omitJsonPaths,
  type IAsyncStateStorage,
  type IStateStorage,
  type SessionRecord,
  type StateStorageGetOptions,
} from '@ptah-extension/platform-core';
import {
  createMockSessionBlobStore,
  createMockSessionRecordRepository,
  createMockStateStorage,
} from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { AgentId, CliSessionReference } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SessionMetadataStore } from './session-metadata-store';
import { LegacySessionStoreMigrator } from './session-store-migrator';

const WS_A = '/projects/alpha';
const WS_B = '/projects/beta';
const AGENT = '33333333-3333-4333-8333-333333333333' as AgentId;
const TURN_KEY_PREFIX = 'ptah.turnChangeSets:';
const SESS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_BLOB = 'turn-change-sets';
const logger = createMockLogger() as unknown as Logger;

/** Electron worker-shaped legacy store over a plain mock store. */
function asyncLegacy() {
  const inner = createMockStateStorage();
  const storage = {
    get: inner.get,
    update: inner.update,
    keys: inner.keys,
    getAsync: jest.fn(
      async (
        key: string,
        fallback?: unknown,
        options?: StateStorageGetOptions,
      ) => {
        const value = inner.get(key, fallback);
        return options?.projection && value !== undefined
          ? omitJsonPaths(value, options.projection.omit)
          : value;
      },
    ),
    readJsonSequence: jest.fn(async function* (key: string) {
      const items = inner.get<unknown[]>(key) ?? [];
      yield { items, nextCursor: null, done: true, approximateBytes: 0 };
    }),
    replaceJsonSequence: jest.fn(
      async (
        key: string,
        chunks: AsyncIterable<{ items: readonly unknown[] }>,
      ) => {
        const items: unknown[] = [];
        for await (const chunk of chunks) items.push(...chunk.items);
        await inner.update(key, items);
      },
    ),
  } as unknown as IAsyncStateStorage;
  return { storage, inner };
}

function ref(agentId: AgentId): CliSessionReference {
  return {
    cliSessionId: `cli-${agentId}`,
    cli: 'codex',
    agentId,
    task: 'task',
    startedAt: new Date(0).toISOString(),
    status: 'completed',
  } as CliSessionReference;
}

/** Write one session the way today's code does, with agent output and change sets. */
async function writeLegacy(
  storage: IStateStorage,
  sessionId: string,
  workspace: string,
  name: string,
): Promise<void> {
  const legacy = new SessionMetadataStore(storage, logger);
  await legacy.create(sessionId, workspace, name);
  await legacy.saveAgentOutput(AGENT, {
    segments: [{ type: 'text', content: `out-${sessionId}` }],
  });
  await legacy.addCliSession(sessionId, ref(AGENT));
  await legacy.flush();
  await storage.update(`${TURN_KEY_PREFIX}${sessionId}`, {
    schemaVersion: 1,
    changeSets: [{ sessionId, turnEndedAt: 1 }],
  });
}

function target(records = new Map<string, SessionRecord>()) {
  const repository = createMockSessionRecordRepository({ records });
  const blobs = createMockSessionBlobStore();
  const migrator = new LegacySessionStoreMigrator(repository, blobs, logger, [
    { keyPrefix: TURN_KEY_PREFIX, blobName: TURN_BLOB },
  ]);
  const c = rootContainer.createChildContainer();
  c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: createMockStateStorage(),
  });
  c.register(TOKENS.LOGGER, { useValue: logger });
  c.register(PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY, {
    useValue: repository,
  });
  c.register(PLATFORM_TOKENS.SESSION_BLOB_STORE, { useValue: blobs });
  const store = () => c.resolve(SessionMetadataStore);
  return { repository, blobs, migrator, store, records };
}

describe('LegacySessionStoreMigrator', () => {
  it.each([
    ['sync (VS Code shape)', () => ({ storage: createMockStateStorage() })],
    ['async (Electron worker shape)', () => asyncLegacy()],
  ])(
    'copies sessions, agent output and change sets from a %s store',
    async (_label, make) => {
      const { storage } = make();
      await writeLegacy(storage, SESS_A, WS_A, 'Alpha');
      const t = target();

      const result = await t.migrator.migrate([
        { sourcePath: '/legacy/alpha', storage },
      ]);

      expect(result).toMatchObject({ copied: 1, failed: 0, skipped: 0 });
      const store = t.store();
      await expect(store.get(SESS_A)).resolves.toMatchObject({
        name: 'Alpha',
        workspaceId: WS_A,
        cliSessions: [expect.objectContaining({ agentId: AGENT })],
      });
      expect(
        (await store.getForWorkspace(WS_A)).map((m) => m.sessionId),
      ).toEqual([SESS_A]);
      const page = await store.getAgentOutputPage(
        AGENT,
        undefined,
        64 * 1024,
        SESS_A,
      );
      expect(page.items).toEqual([
        { tag: 'segment', value: { type: 'text', content: `out-${SESS_A}` } },
      ]);
      expect(t.blobs.__blobs.get(`${SESS_A}/${TURN_BLOB}`)).toEqual({
        schemaVersion: 1,
        changeSets: [{ sessionId: SESS_A, turnEndedAt: 1 }],
      });
    },
  );

  it('leaves the legacy store exactly as it was', async () => {
    const { storage, inner } = asyncLegacy();
    await writeLegacy(storage, SESS_A, WS_A, 'Alpha');
    const before = JSON.stringify([...inner.__state.entries]);

    await target().migrator.migrate([{ sourcePath: '/legacy/alpha', storage }]);

    expect(JSON.stringify([...inner.__state.entries])).toBe(before);
  });

  it('keeps the newer copy when a session exists in two stores or already migrated', async () => {
    const older = createMockStateStorage();
    const newer = createMockStateStorage();
    await writeLegacy(older, SESS_A, WS_A, 'Old name');
    await writeLegacy(newer, SESS_A, WS_A, 'New name');
    const index = newer.get<{ sessionId: string; lastActiveAt: number }[]>(
      'ptah.sessionMetadata',
    ) as { sessionId: string; lastActiveAt: number }[];
    await newer.update(
      'ptah.sessionMetadata',
      index.map((m) => ({ ...m, lastActiveAt: m.lastActiveAt + 1_000 })),
    );
    const t = target();

    await t.migrator.migrate([
      { sourcePath: '/legacy/newer', storage: newer },
      { sourcePath: '/legacy/older', storage: older },
    ]);

    await expect(t.store().get(SESS_A)).resolves.toMatchObject({
      name: 'New name',
    });
  });

  it('skips a source it already copied in the same state, and copies it again once it changed', async () => {
    const storage = createMockStateStorage();
    await writeLegacy(storage, SESS_A, WS_A, 'Alpha');
    const t = target();
    await t.migrator.migrate([{ sourcePath: '/legacy/alpha', storage }]);

    const again = await t.migrator.migrate([
      { sourcePath: '/legacy/alpha', storage },
    ]);
    expect(again).toMatchObject({ copied: 0, skipped: 1 });

    // An older build wrote a new session after a rollback.
    await writeLegacy(storage, SESS_B, WS_B, 'Beta');
    const third = await t.migrator.migrate([
      { sourcePath: '/legacy/alpha', storage },
    ]);
    expect(third).toMatchObject({ skipped: 0, failed: 0 });
    expect((await t.store().getAll()).map((m) => m.sessionId).sort()).toEqual([
      SESS_A,
      SESS_B,
    ]);
  });

  it('does not copy a row whose id is not a session id', async () => {
    const storage = createMockStateStorage();
    await writeLegacy(storage, SESS_A, WS_A, 'Alpha');
    const index = storage.get<object[]>('ptah.sessionMetadata') ?? [];
    await storage.update('ptah.sessionMetadata', [
      ...index,
      { ...index[0], sessionId: 'fleet-model-runs', name: 'Not a session' },
    ]);
    const t = target();

    const result = await t.migrator.migrate([
      { sourcePath: '/legacy/alpha', storage },
    ]);

    expect(result.copied).toBe(1);
    expect([...t.records.keys()]).toEqual([SESS_A]);
  });

  it('skips agent output whose agent id is not a safe blob name and copies the session', async () => {
    const storage = createMockStateStorage();
    await writeLegacy(storage, SESS_A, WS_A, 'Alpha');
    const index = storage.get<Array<{ cliSessions?: unknown[] }>>(
      'ptah.sessionMetadata',
    ) as Array<{ cliSessions?: unknown[] }>;
    await storage.update('ptah.sessionMetadata', [
      {
        ...index[0],
        cliSessions: [
          ...(index[0].cliSessions ?? []),
          {
            ...ref('a/b' as AgentId),
            segments: [{ type: 'text', content: 'bad' }],
          },
        ],
      },
    ]);
    const t = target();

    const result = await t.migrator.migrate([
      { sourcePath: '/legacy/alpha', storage },
    ]);

    expect(result).toMatchObject({ copied: 1, failed: 0 });
    expect([...t.blobs.__blobs.keys()].some((k) => k.includes('a/b'))).toBe(
      false,
    );
  });

  it('copies the other sources when one cannot be read', async () => {
    const good = createMockStateStorage();
    await writeLegacy(good, SESS_A, WS_A, 'Alpha');
    const broken = {
      get: () => {
        throw new Error('corrupt store');
      },
      update: async () => undefined,
      keys: () => [],
    } as unknown as IStateStorage;
    const t = target();

    const result = await t.migrator.migrate([
      { sourcePath: '/legacy/broken', storage: broken },
      { sourcePath: '/legacy/alpha', storage: good },
    ]);

    expect(result).toMatchObject({ copied: 1, failed: 1 });
    expect(t.repository.recordMigrationSource).not.toHaveBeenCalledWith(
      '/legacy/broken',
      expect.anything(),
      expect.anything(),
    );
  });
});
