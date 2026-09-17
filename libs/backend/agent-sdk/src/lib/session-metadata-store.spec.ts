/**
 * session-metadata-store — unit specs.
 *
 * Covers `SessionMetadataStore`, the per-workspace UI-metadata layer for
 * sessions. This store is intentionally minimal — messages and conversation
 * history live in `~/.claude/projects/*.jsonl`, not here — but it carries
 * invariants that several features (sidebar filtering, cost dashboard,
 * CLI-agent resume, child-session hiding) depend on:
 *
 *   - `create` is idempotent: if metadata already exists for a session id,
 *     the existing `name` is preserved (user-rename wins over auto-name).
 *   - `createChild` marks sessions as hidden from the sidebar
 *     (`isChildSession: true`).
 *   - `save` round-trips through `IStateStorage.update` and preserves
 *     `isChildSession` / `cliSessions` when a later save omits them (merge
 *     contract, not replace).
 *   - `getForWorkspace` filters by workspaceId (path-separator insensitive)
 *     and excludes child sessions unless `includeChildren` is true.
 *   - `addCliSession` upserts by `cliSessionId` (resume replaces, not
 *     duplicates).
 *   - `addStats` accumulates, and if the session is a child, propagates the
 *     stats to the parent referenced via `cliSessions[*].sdkSessionId`.
 *   - Concurrent `addCliSession` calls serialize through the internal write
 *     queue (no lost updates).
 */

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentOutputCursorStaleError,
  SessionMetadataStore,
  flushSessionMetadataStores,
  type PersistedAgentOutput,
  type TaggedAgentOutputItem,
} from './session-metadata-store';
import {
  StateStorageCursorStaleError,
  StateStorageValueTooLargeError,
  jsonUtf8Bytes,
  omitJsonPaths,
  type IAsyncStateStorage,
  type StateStorageGetOptions,
  type StateStorageSequenceReadOptions,
} from '@ptah-extension/platform-core';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type {
  AgentId,
  CliOutputSegment,
  CliSessionReference,
  FlatStreamEventUnion,
  SubagentRecord,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { SdkError } from './errors';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

const WORKSPACE = '/workspace/project';
const METADATA_KEY = 'ptah.sessionMetadata';

function segments(count: number): readonly CliOutputSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'text' as const,
    content: `segment-${i}`,
  }));
}

function streamEvents(count: number): readonly FlatStreamEventUnion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${i}`,
    eventType: 'text_delta',
    timestamp: i,
    sessionId: 'sess-1',
    messageId: 'msg-1',
    source: 'stream',
    text: 'x',
  })) as unknown as readonly FlatStreamEventUnion[];
}

function cliRef(
  overrides: Partial<CliSessionReference> = {},
): CliSessionReference {
  return {
    cliSessionId: 'cli-1',
    cli: 'codex',
    agentId: 'agent-codex-1' as AgentId,
    task: 'do a thing',
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'completed',
    ...overrides,
  };
}

describe('SessionMetadataStore', () => {
  let storage: ReturnType<typeof createMockStateStorage>;
  let logger: MockLogger;
  let store: SessionMetadataStore;

  beforeEach(() => {
    storage = createMockStateStorage();
    logger = createMockLogger();
    store = new SessionMetadataStore(storage, asLogger(logger));
  });

  // -------------------------------------------------------------------------
  // create / createChild — idempotence + child flag
  // -------------------------------------------------------------------------

  describe('create / createChild', () => {
    it('creates new metadata with zeroed stats', async () => {
      const md = await store.create('sess-1', WORKSPACE, 'First session');
      expect(md).toMatchObject({
        sessionId: 'sess-1',
        name: 'First session',
        workspaceId: WORKSPACE,
        totalCost: 0,
        totalTokens: { input: 0, output: 0 },
      });
      expect(md.isChildSession).toBeUndefined();
    });

    it('preserves a user-renamed name on repeat create() for the same id', async () => {
      await store.create('sess-1', WORKSPACE, 'Auto name');
      await store.rename('sess-1', 'User renamed');

      const md = await store.create('sess-1', WORKSPACE, 'Auto name AGAIN');
      expect(md.name).toBe('User renamed');
    });

    // TASK_2026_295: SdkAgentAdapter passes the raw `realSessionId` straight
    // from the SDK init message. SessionRegistry.bindRealSessionId rejects a
    // blank one three lines away; this store took it and wrote a record keyed
    // by '' that nothing can address.
    it.each([
      ['empty', ''],
      ['whitespace-only', '   '],
    ])('refuses to create metadata for an %s sessionId', async (_label, id) => {
      await expect(store.create(id, WORKSPACE, 'Poisoned')).rejects.toThrow(
        SdkError,
      );
      await expect(store.get(id)).resolves.toBeNull();
    });

    it('marks child sessions with isChildSession=true', async () => {
      const md = await store.createChild(
        'sess-child',
        WORKSPACE,
        'Child session',
      );
      expect(md.isChildSession).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // markChildSession — non-destructive child flagging
  // -------------------------------------------------------------------------

  describe('markChildSession', () => {
    it('creates a minimal hidden child record when none exists', async () => {
      await store.markChildSession('child-x', WORKSPACE);
      const md = await store.get('child-x');
      expect(md?.isChildSession).toBe(true);
      expect(md?.totalCost).toBe(0);
      const visible = await store.getForWorkspace(WORKSPACE);
      expect(visible.map((m) => m.sessionId)).not.toContain('child-x');
    });

    it('flags an already-imported top-level session WITHOUT clobbering name/cost', async () => {
      await store.create('leaked-1', WORKSPACE, 'Real name');
      await store.addStats('leaked-1', {
        cost: 4.2,
        tokens: { input: 10, output: 5 },
      });

      await store.markChildSession('leaked-1', WORKSPACE);

      const md = await store.get('leaked-1');
      expect(md?.isChildSession).toBe(true);
      expect(md?.name).toBe('Real name');
      expect(md?.totalCost).toBe(4.2);
      const visible = await store.getForWorkspace(WORKSPACE);
      expect(visible.map((m) => m.sessionId)).not.toContain('leaked-1');
    });

    it('is idempotent (no throw, stays hidden) on repeat calls', async () => {
      await store.markChildSession('child-x', WORKSPACE);
      await store.markChildSession('child-x', WORKSPACE);
      const md = await store.get('child-x');
      expect(md?.isChildSession).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getForWorkspace — filtering
  // -------------------------------------------------------------------------

  describe('getForWorkspace', () => {
    it('excludes child sessions by default and includes them when asked', async () => {
      await store.create('parent-1', WORKSPACE, 'Parent');
      await store.createChild('child-1', WORKSPACE, 'Child');

      const visible = await store.getForWorkspace(WORKSPACE);
      expect(visible.map((m) => m.sessionId)).toEqual(['parent-1']);

      const all = await store.getForWorkspace(WORKSPACE, true);
      expect(all.map((m) => m.sessionId).sort()).toEqual([
        'child-1',
        'parent-1',
      ]);
    });

    it('matches workspaceId across path-separator differences (Windows/POSIX)', async () => {
      const winWorkspace = 'C:\\Users\\alice\\project';
      const posixQuery = 'C:/Users/alice/project';

      await store.create('sess-1', winWorkspace, 'win');
      const out = await store.getForWorkspace(posixQuery);
      expect(out).toHaveLength(1);
      expect(out[0].sessionId).toBe('sess-1');
    });

    it('sorts by lastActiveAt descending', async () => {
      // Seed storage directly so we control timestamps exactly.
      storage.__state.seed('ptah.sessionMetadata', [
        {
          sessionId: 'older',
          name: 'a',
          workspaceId: WORKSPACE,
          createdAt: 1,
          lastActiveAt: 1,
          totalCost: 0,
          totalTokens: { input: 0, output: 0 },
        },
        {
          sessionId: 'newer',
          name: 'b',
          workspaceId: WORKSPACE,
          createdAt: 10,
          lastActiveAt: 10,
          totalCost: 0,
          totalTokens: { input: 0, output: 0 },
        },
      ]);
      const out = await store.getForWorkspace(WORKSPACE);
      expect(out.map((m) => m.sessionId)).toEqual(['newer', 'older']);
    });
  });

  // -------------------------------------------------------------------------
  // save — merge of unrelated fields
  // -------------------------------------------------------------------------

  describe('save (merge semantics)', () => {
    it('preserves existing isChildSession when an update omits it', async () => {
      await store.createChild('child-1', WORKSPACE, 'child');
      // Simulate a later save that "forgets" the child flag.
      const current = (await store.get('child-1')) as NonNullable<
        Awaited<ReturnType<typeof store.get>>
      >;
      await store.save({
        ...current,
        isChildSession: undefined, // explicitly dropped
      });
      const after = await store.get('child-1');
      expect(after?.isChildSession).toBe(true);
    });

    it('preserves existing cliSessions when an update omits them', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addCliSession('sess-1', cliRef({ cliSessionId: 'keep-me' }));

      const current = (await store.get('sess-1')) as NonNullable<
        Awaited<ReturnType<typeof store.get>>
      >;
      await store.save({
        ...current,
        cliSessions: undefined,
        name: 'renamed inline',
      });
      const after = await store.get('sess-1');
      expect(after?.name).toBe('renamed inline');
      expect(after?.cliSessions?.map((c) => c.cliSessionId)).toEqual([
        'keep-me',
      ]);
    });

    it('preserves resume state when a later save omits it', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      const interrupted: SubagentRecord = {
        toolCallId: 'tool-1',
        agentType: 'backend',
        status: 'interrupted',
        startedAt: Date.now(),
        interruptedAt: Date.now(),
        parentSessionId: 'sess-1',
        agentId: 'agent-1',
      };
      await store.saveResumeState('sess-1', {
        workingDirectory: `${WORKSPACE}/.claude/worktrees/fix`,
        resumableSdkSubagents: [interrupted],
      });

      const current = (await store.get('sess-1')) as NonNullable<
        Awaited<ReturnType<typeof store.get>>
      >;
      await store.save({
        ...current,
        workingDirectory: undefined,
        resumableSdkSubagents: undefined,
        name: 'renamed',
      });

      const after = await store.get('sess-1');
      expect(after?.workingDirectory).toBe(
        `${WORKSPACE}/.claude/worktrees/fix`,
      );
      expect(after?.resumableSdkSubagents).toEqual([interrupted]);
    });
  });

  describe('saveResumeState', () => {
    it('stores only interrupted foreground SDK records for the canonical session', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      const base: SubagentRecord = {
        toolCallId: 'kept',
        agentType: 'backend',
        status: 'interrupted',
        startedAt: Date.now(),
        interruptedAt: Date.now(),
        parentSessionId: 'sess-1',
        agentId: 'agent-kept',
      };

      await store.saveResumeState('sess-1', {
        resumableSdkSubagents: [
          base,
          { ...base, toolCallId: 'running', status: 'running' },
          { ...base, toolCallId: 'background', isBackground: true },
          { ...base, toolCallId: 'cli', isCliAgent: true },
          { ...base, toolCallId: 'other', parentSessionId: 'sess-2' },
        ],
      });

      const after = await store.get('sess-1');
      expect(after?.resumableSdkSubagents).toEqual([base]);
    });
  });

  // -------------------------------------------------------------------------
  // addCliSession — upsert by cliSessionId
  // -------------------------------------------------------------------------

  describe('addCliSession', () => {
    it('throws SdkError when the parent session does not exist', async () => {
      await expect(store.addCliSession('missing', cliRef())).rejects.toThrow(
        SdkError,
      );
    });

    it('appends a new CLI session reference', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addCliSession('sess-1', cliRef({ cliSessionId: 'cli-a' }));
      await store.addCliSession('sess-1', cliRef({ cliSessionId: 'cli-b' }));

      const md = await store.get('sess-1');
      expect(md?.cliSessions?.map((c) => c.cliSessionId)).toEqual([
        'cli-a',
        'cli-b',
      ]);
    });

    it('replaces (not duplicates) an existing reference by cliSessionId', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'cli-a', status: 'running' }),
      );
      await store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'cli-a', status: 'completed' }),
      );

      const md = await store.get('sess-1');
      expect(md?.cliSessions).toHaveLength(1);
      expect(md?.cliSessions?.[0].status).toBe('completed');
    });

    it('serializes concurrent calls so no reference is lost', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await Promise.all([
        store.addCliSession('sess-1', cliRef({ cliSessionId: 'a' })),
        store.addCliSession('sess-1', cliRef({ cliSessionId: 'b' })),
        store.addCliSession('sess-1', cliRef({ cliSessionId: 'c' })),
      ]);

      const md = await store.get('sess-1');
      const ids = md?.cliSessions?.map((c) => c.cliSessionId).sort();
      expect(ids).toEqual(['a', 'b', 'c']);
    });
  });

  // -------------------------------------------------------------------------
  // Write coalescing + bulk-output split (TASK_2026_323 blocker B5)
  //
  // Every write rewrote the whole all-sessions blob, and every CLI session
  // reference inside it carried up to 50 000 stream events. N agents spawning
  // and exiting therefore cost O(N² × events) bytes of main-thread JSON.
  // -------------------------------------------------------------------------

  describe('write coalescing', () => {
    function metadataWrites(): number {
      return storage.update.mock.calls.filter(([key]) => key === METADATA_KEY)
        .length;
    }

    it('serializes the blob ONCE for a burst of ten agent lifecycle writes', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      const before = metadataWrites();

      await Promise.all(
        Array.from({ length: 10 }, (_unused, i) =>
          store.addCliSession(
            'sess-1',
            cliRef({
              cliSessionId: `cli-${i}`,
              agentId: `agent-${i}` as AgentId,
            }),
          ),
        ),
      );

      expect(metadataWrites() - before).toBe(1);

      const md = await store.get('sess-1');
      expect(md?.cliSessions).toHaveLength(10);
    });

    it('has reached storage by the time an awaited write resolves', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      const persisted = storage.__state.entries.get(METADATA_KEY) as
        | Array<{ sessionId: string }>
        | undefined;
      expect(persisted?.map((m) => m.sessionId)).toEqual(['sess-1']);
    });

    it('serves a staged mutation to readers before its flush completes', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      const first = store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'a' }),
      );
      const second = store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'b' }),
      );
      await Promise.all([first, second]);

      // Both survive: the second read-modify-write saw the first even though
      // the first never reached storage on its own.
      const md = await store.get('sess-1');
      expect(md?.cliSessions?.map((c) => c.cliSessionId)).toEqual(['a', 'b']);
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_324 finding 3 — the host shutdown flush.
  //
  // `flush()` had no external caller. A failed flush keeps its snapshot staged
  // — visible to readers, durable nowhere — and waits for a later write that,
  // at shutdown, never comes. `flushSessionMetadataStores()` is what the three
  // host teardown paths call; it reaches every live store without needing a
  // container, because the CLI installs its signal handlers before one exists.
  // -------------------------------------------------------------------------

  describe('flushSessionMetadataStores (host shutdown path)', () => {
    /** Fail the next all-sessions write only; everything else behaves. */
    function failNextMetadataWrite(): void {
      let armed = true;
      storage.update.mockImplementation(async (key: string, value: unknown) => {
        if (armed && key === METADATA_KEY) {
          armed = false;
          throw new Error('storage busy');
        }
        if (value === undefined) storage.__state.entries.delete(key);
        else storage.__state.entries.set(key, value);
      });
    }

    function persistedNames(): string[] {
      const blob = storage.__state.entries.get(METADATA_KEY) as
        | Array<{ name: string }>
        | undefined;
      return (blob ?? []).map((m) => m.name);
    }

    it('writes a staged snapshot that no later write would have carried', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      failNextMetadataWrite();

      await expect(store.rename('sess-1', 'Renamed')).rejects.toThrow(
        'storage busy',
      );
      // Staged, not stored: the reader sees it, the disk does not.
      expect(persistedNames()).toEqual(['parent']);
      expect((await store.get('sess-1'))?.name).toBe('Renamed');

      await flushSessionMetadataStores();

      expect(persistedNames()).toEqual(['Renamed']);
    });

    it('never throws out of a teardown, even when storage is already gone', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      failNextMetadataWrite();
      await expect(store.rename('sess-1', 'Renamed')).rejects.toThrow(
        'storage busy',
      );

      storage.update.mockRejectedValue(new Error('storage closed'));

      await expect(flushSessionMetadataStores()).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Shutdown flush failed'),
        expect.anything(),
      );
    });
  });

  describe('bulk agent output', () => {
    const FAT_AGENT = 'agent-fat' as AgentId;
    const ENVELOPE_BYTES = Buffer.byteLength(
      JSON.stringify({
        success: true,
        data: { items: [], nextCursor: '0'.repeat(32), done: false },
        correlationId: '0'.repeat(64),
      }),
      'utf8',
    );

    function rpcBytes(page: unknown): number {
      return Buffer.byteLength(
        JSON.stringify({
          success: true,
          data: page,
          correlationId: '0'.repeat(64),
        }),
        'utf8',
      );
    }

    function createAsyncFake() {
      const getAsync = jest.fn(
        async (
          key: string,
          defaultValue?: unknown,
          options?: StateStorageGetOptions,
        ) => {
          const value = storage.get(key, defaultValue);
          return options?.projection && value !== undefined
            ? omitJsonPaths(value, options.projection.omit)
            : value;
        },
      );
      const readJsonSequence = jest.fn(async function* (
        key: string,
        options?: StateStorageSequenceReadOptions,
      ) {
        const items = storage.get<unknown[]>(key) ?? [];
        const maxJsonBytes = options?.maxJsonBytes ?? Number.POSITIVE_INFINITY;
        let used = options?.jsonEnvelopeBytes ?? 2;
        let index = options?.cursor ? Number(options.cursor) : 0;
        const page: unknown[] = [];
        while (index < items.length) {
          const cost = jsonUtf8Bytes(items[index]) + (page.length > 0 ? 1 : 0);
          if (used + cost > maxJsonBytes) break;
          page.push(items[index]);
          used += cost;
          index++;
        }
        if (page.length === 0 && index < items.length) {
          throw new Error('fake item exceeds budget');
        }
        const done = index >= items.length;
        yield {
          items: page,
          nextCursor: done ? null : String(index),
          done,
          approximateBytes: used,
        };
      });
      const replaceJsonSequence = jest.fn(
        async (
          key: string,
          chunks: AsyncIterable<{ items: readonly unknown[] }>,
        ) => {
          const items: unknown[] = [];
          for await (const chunk of chunks) items.push(...chunk.items);
          await storage.update(key, items);
        },
      );
      const asyncStorage = {
        ...storage,
        getAsync,
        readJsonSequence,
        replaceJsonSequence,
      } as unknown as IAsyncStateStorage;
      return {
        asyncStore: new SessionMetadataStore(asyncStorage, asLogger(logger)),
        getAsync,
        readJsonSequence,
        replaceJsonSequence,
      };
    }

    function storeOverSequence(
      readJsonSequence: (...args: never[]) => unknown,
    ): SessionMetadataStore {
      const asyncStorage = {
        ...storage,
        getAsync: jest.fn(async (key: string, defaultValue?: unknown) =>
          storage.get(key, defaultValue),
        ),
        readJsonSequence,
        replaceJsonSequence: jest.fn(async () => undefined),
      } as unknown as IAsyncStateStorage;
      return new SessionMetadataStore(asyncStorage, asLogger(logger));
    }

    function fatDetail(refs: readonly CliSessionReference[]) {
      return {
        sessionId: 'sess-1',
        name: 'parent',
        workspaceId: WORKSPACE,
        createdAt: 1,
        lastActiveAt: 1,
        totalCost: 0,
        totalTokens: { input: 0, output: 0 },
        cliSessions: refs,
      };
    }

    function fatRef(agentId: string, cliSessionId: string) {
      return cliRef({
        cliSessionId,
        agentId: agentId as AgentId,
        stdout: 'raw tail',
        segments: segments(500),
        streamEvents: streamEvents(400),
      });
    }

    async function seedFatReference(): Promise<void> {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addCliSession(
        'sess-1',
        cliRef({
          cliSessionId: 'cli-fat',
          agentId: FAT_AGENT,
          stdout: 'raw tail',
          segments: segments(500),
          streamEvents: streamEvents(5000),
        }),
      );
    }

    function strippedLogCalls(): unknown[][] {
      return logger.info.mock.calls.filter(
        ([message]) =>
          typeof message === 'string' &&
          message.includes('Stripped bulk output'),
      );
    }

    it('strips stdout, segments and streamEvents from the stored reference on write', async () => {
      await seedFatReference();

      const blob = JSON.stringify(storage.__state.entries.get(METADATA_KEY));
      expect(blob).not.toContain('streamEvents');
      expect(blob).not.toContain('"segments"');
      expect(blob).not.toContain('raw tail');
      expect(strippedLogCalls()).toEqual([
        [expect.any(String), { sessionId: 'sess-1', strippedBulkRefCount: 1 }],
      ]);
    });

    it('counts stripped bulk once per reference handed to a save', async () => {
      await store.save(
        fatDetail([
          fatRef('agent-a', 'cli-a'),
          fatRef('agent-b', 'cli-b'),
          cliRef({ cliSessionId: 'cli-lean', agentId: 'agent-c' as AgentId }),
        ]),
      );

      expect(strippedLogCalls()).toEqual([
        [expect.any(String), { sessionId: 'sess-1', strippedBulkRefCount: 2 }],
      ]);
      const blob = JSON.stringify(storage.__state.entries.get(METADATA_KEY));
      expect(blob).not.toContain('streamEvents');
      expect(blob).not.toContain('raw tail');
      expect(
        [...storage.__state.entries.keys()].filter((key) =>
          key.startsWith('ptah.agentOutput:'),
        ),
      ).toEqual([]);
    });

    it('leaves no stored bulk after an unrelated write to an unmigrated fat record', async () => {
      storage.__state.seed(METADATA_KEY, [
        fatDetail([fatRef('agent-a', 'cli-a'), fatRef('agent-b', 'cli-b')]),
      ]);

      await store.addStats('sess-1', {
        cost: 0.01,
        tokens: { input: 1, output: 1 },
      });

      const blob = JSON.stringify(storage.__state.entries.get(METADATA_KEY));
      expect(blob).not.toContain('streamEvents');
      expect(blob).not.toContain('raw tail');
      expect((await store.get('sess-1'))?.cliSessions).toHaveLength(2);
    });

    it('strips bulk from a reference with no agentId as well', async () => {
      storage.__state.seed(METADATA_KEY, [
        fatDetail([fatRef('', 'cli-no-id')]),
      ]);

      await store.rename('sess-1', 'Renamed');

      const blob = JSON.stringify(storage.__state.entries.get(METADATA_KEY));
      expect(blob).not.toContain('streamEvents');
      expect(blob).not.toContain('raw tail');
      expect((await store.get('sess-1'))?.name).toBe('Renamed');
    });

    it('does not log a strip when every reference is already lean', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addCliSession('sess-1', cliRef());
      await store.rename('sess-1', 'Renamed');

      expect(strippedLogCalls()).toEqual([]);
    });

    it('counts only non-empty bulk and skips references carrying empty fields', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'cli-empty', stdout: '', segments: [] }),
      );
      expect(strippedLogCalls()).toEqual([]);

      await store.save(
        fatDetail([
          cliRef({ cliSessionId: 'cli-empty', stdout: '', streamEvents: [] }),
          cliRef({
            cliSessionId: 'cli-full',
            agentId: 'agent-full' as AgentId,
            segments: segments(1),
          }),
        ]),
      );
      expect(strippedLogCalls()).toEqual([
        [expect.any(String), { sessionId: 'sess-1', strippedBulkRefCount: 1 }],
      ]);
    });

    it('returns projected details from sync and async storage alike', async () => {
      const refs = [fatRef('agent-a', 'cli-a'), fatRef('agent-b', 'cli-b')];
      storage.__state.seed(METADATA_KEY, [fatDetail(refs)]);
      const syncDetail = await store.get('sess-1');

      storage.__state.entries.delete(METADATA_KEY);
      storage.__state.seed('ptah.session:sess-1', fatDetail(refs));
      const { asyncStore, getAsync } = createAsyncFake();
      const asyncDetail = await asyncStore.get('sess-1');

      expect(getAsync).toHaveBeenCalledWith('ptah.session:sess-1', undefined, {
        projection: {
          omit: [
            ['cliSessions', '*', 'stdout'],
            ['cliSessions', '*', 'segments'],
            ['cliSessions', '*', 'streamEvents'],
          ],
        },
      });
      expect(asyncDetail).toEqual(syncDetail);
      expect(syncDetail?.cliSessions).toHaveLength(2);
      for (const ref of syncDetail?.cliSessions ?? []) {
        expect(ref).not.toHaveProperty('stdout');
        expect(ref).not.toHaveProperty('segments');
        expect(ref).not.toHaveProperty('streamEvents');
      }
    });

    it('never reads a session detail without the projection', () => {
      const source = readFileSync(
        join(__dirname, 'session-metadata-store.ts'),
        'utf8',
      );
      const detailReads = [...source.matchAll(/sessionDetailKey\(/g)]
        .map((match) => match.index ?? 0)
        .filter(
          (index) =>
            !source.slice(index - 9, index).startsWith('function') &&
            !/update\(\s*$/.test(source.slice(index - 40, index)),
        );
      expect(detailReads.length).toBeGreaterThan(0);
      for (const index of detailReads) {
        expect(source.slice(index - 60, index)).toMatch(
          /getAsync<[^>]+>\(\s*$/,
        );
        expect(source.slice(index, index + 120)).toContain(
          'DETAIL_READ_OPTIONS',
        );
      }
      const getBody = source.slice(
        source.indexOf('async get(sessionId: string)'),
        source.indexOf('async saveResumeState('),
      );
      expect(getBody).toContain(
        'omitJsonPaths(summary, DETAIL_PROJECTION.omit)',
      );
    });

    it('stores bulk output under a per-agent key, not the blob', async () => {
      await store.saveAgentOutput(FAT_AGENT, {
        segments: segments(500),
        streamEvents: streamEvents(5000),
      });

      const stored = storage.__state.entries.get(
        `ptah.agentOutput:${FAT_AGENT}`,
      ) as PersistedAgentOutput;
      expect(stored.agentId).toBe(FAT_AGENT);
      expect(stored.segments).toHaveLength(500);
      expect(stored.streamEvents).toHaveLength(5000);
      expect(storage.__state.entries.has(METADATA_KEY)).toBe(false);
    });

    it('writes stdout as the single text segment only when there is no other output', async () => {
      await store.saveAgentOutput(FAT_AGENT, { stdout: 'only raw text' });

      const stored = storage.__state.entries.get(
        `ptah.agentOutput:${FAT_AGENT}`,
      ) as PersistedAgentOutput;
      expect(stored.segments).toEqual([
        { type: 'text', content: 'only raw text' },
      ]);
      expect(stored.streamEvents).toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Stored agent output'),
        {
          segments: 1,
          streamEvents: 0,
          stdoutDropped: false,
          stdoutFallback: true,
        },
      );
    });

    it('drops stdout when segments or stream events exist, and logs the drop', async () => {
      await store.saveAgentOutput(FAT_AGENT, {
        stdout: 'duplicate tail',
        streamEvents: streamEvents(3),
      });

      const stored = storage.__state.entries.get(
        `ptah.agentOutput:${FAT_AGENT}`,
      ) as PersistedAgentOutput;
      expect(stored.segments).toBeUndefined();
      expect(stored.streamEvents).toHaveLength(3);
      expect(JSON.stringify(stored)).not.toContain('duplicate tail');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Stored agent output'),
        {
          segments: 0,
          streamEvents: 3,
          stdoutDropped: true,
          stdoutFallback: false,
        },
      );
    });

    it('logs a stdout-free save at debug only', async () => {
      await store.saveAgentOutput(FAT_AGENT, { segments: segments(2) });

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Stored agent output'),
        expect.anything(),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Stored agent output'),
        {
          segments: 2,
          streamEvents: 0,
          stdoutDropped: false,
          stdoutFallback: false,
        },
      );
    });

    it('writes the stdout fallback as one tagged item on async storage', async () => {
      const { asyncStore, replaceJsonSequence } = createAsyncFake();

      await asyncStore.saveAgentOutput(FAT_AGENT, {
        stdout: 'raw only',
        segments: [],
        streamEvents: [],
      });

      expect(replaceJsonSequence).toHaveBeenCalledTimes(1);
      expect(
        storage.__state.entries.get(`ptah.agentOutput:${FAT_AGENT}`),
      ).toEqual([
        { tag: 'segment', value: { type: 'text', content: 'raw only' } },
      ]);
    });

    it('writes nothing when there is no output to store', async () => {
      await store.saveAgentOutput(FAT_AGENT, {
        stdout: '',
        segments: [],
        streamEvents: [],
      });
      expect(storage.update).not.toHaveBeenCalledWith(
        `ptah.agentOutput:${FAT_AGENT}`,
        expect.anything(),
      );
      expect(storage.__state.entries.has(`ptah.agentOutput:${FAT_AGENT}`)).toBe(
        false,
      );
    });

    it('pages synchronous output in segment-then-event order without duplication', async () => {
      await store.saveAgentOutput(FAT_AGENT, {
        segments: segments(40),
        streamEvents: streamEvents(40),
      });
      const { savedAt } = storage.__state.entries.get(
        `ptah.agentOutput:${FAT_AGENT}`,
      ) as PersistedAgentOutput;

      const received: string[] = [];
      let cursor: string | undefined;
      let pageCount = 0;
      do {
        const page = await store.getAgentOutputPage(FAT_AGENT, cursor, 1024);
        expect(rpcBytes(page)).toBeLessThanOrEqual(1024);
        received.push(
          ...page.items.map((item) =>
            item.tag === 'segment' ? item.value.content : item.value.id,
          ),
        );
        if (page.nextCursor !== null) {
          expect(page.nextCursor).toMatch(new RegExp(`^s${savedAt}\\.\\d+$`));
        }
        cursor = page.nextCursor ?? undefined;
        pageCount++;
      } while (cursor);

      expect(pageCount).toBeGreaterThan(1);
      expect(received).toEqual([
        ...segments(40).map((item) => item.content),
        ...streamEvents(40).map((item) => item.id),
      ]);
      expect(new Set(received).size).toBe(received.length);
    });

    it('bounds the complete UTF-8 RPC envelope and honors continuation cursors', async () => {
      const multibyteSegments = Array.from({ length: 40 }, (_, index) => ({
        type: 'text' as const,
        content: `${index}:${'界'.repeat(3_000)}`,
      }));
      await store.saveAgentOutput(FAT_AGENT, {
        segments: multibyteSegments,
        streamEvents: [],
      });

      const first = await store.getAgentOutputPage(
        FAT_AGENT,
        undefined,
        256 * 1024,
      );
      expect(first.done).toBe(false);
      expect(first.nextCursor).not.toBeNull();
      expect(rpcBytes(first)).toBeLessThanOrEqual(256 * 1024);

      const second = await store.getAgentOutputPage(
        FAT_AGENT,
        first.nextCursor ?? undefined,
        256 * 1024,
      );
      expect(second.items[0]).toEqual({
        tag: 'segment',
        value: multibyteSegments[first.items.length],
      });
    });

    it('rejects a malformed synchronous cursor', async () => {
      await store.saveAgentOutput(FAT_AGENT, { segments: segments(2) });

      await expect(
        store.getAgentOutputPage(FAT_AGENT, 'not-a-cursor', 1024),
      ).rejects.toThrow('Invalid agent output cursor');
      await expect(
        store.getAgentOutputPage(FAT_AGENT, '5', 1024),
      ).rejects.toThrow('Invalid agent output cursor');
    });

    it('reports a synchronous cursor from an older save as stale', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      try {
        await store.saveAgentOutput(FAT_AGENT, { segments: segments(80) });
        const first = await store.getAgentOutputPage(
          FAT_AGENT,
          undefined,
          1024,
        );
        expect(first.nextCursor).toMatch(/^s1000\.\d+$/);

        now.mockReturnValue(2_000);
        await store.saveAgentOutput(FAT_AGENT, { segments: segments(80) });

        await expect(
          store.getAgentOutputPage(
            FAT_AGENT,
            first.nextCursor ?? undefined,
            1024,
          ),
        ).rejects.toBeInstanceOf(AgentOutputCursorStaleError);
        await store.deleteAgentOutput(FAT_AGENT);
        await expect(
          store.getAgentOutputPage(FAT_AGENT, 's2000.1', 1024),
        ).rejects.toBeInstanceOf(AgentOutputCursorStaleError);
      } finally {
        now.mockRestore();
      }
    });

    it('shrinks a synchronous item that exceeds the page budget instead of failing the page', async () => {
      const heavy = `${String.fromCharCode(1)}界${String.fromCodePoint(0x1f600)}`;
      await store.saveAgentOutput(FAT_AGENT, {
        segments: [
          { type: 'text', content: heavy.repeat(1_000) },
          { type: 'text', content: 'next' },
        ],
      });

      const first = await store.getAgentOutputPage(FAT_AGENT, undefined, 1024);
      expect(first.items).toHaveLength(1);
      expect(rpcBytes(first)).toBeLessThanOrEqual(1024);
      const content =
        first.items[0].tag === 'segment' ? first.items[0].value.content : '';
      expect(content).toMatch(/\[truncated \d+ bytes\]$/);
      expect(content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      const truncationLogs = logger.info.mock.calls.filter(
        ([message]) =>
          typeof message === 'string' &&
          message.includes('Truncated oversized agent output items'),
      );
      expect(truncationLogs).toEqual([
        [
          expect.stringContaining(FAT_AGENT),
          {
            truncatedItems: [
              {
                pageIndex: 0,
                originalJsonBytes: Buffer.byteLength(
                  JSON.stringify({
                    tag: 'segment',
                    value: { type: 'text', content: heavy.repeat(1_000) },
                  }),
                  'utf8',
                ),
              },
            ],
          },
        ],
      ]);
      expect(JSON.stringify(truncationLogs)).not.toContain(heavy);

      const second = await store.getAgentOutputPage(
        FAT_AGENT,
        first.nextCursor ?? undefined,
        1024,
      );
      expect(second).toEqual({
        items: [{ tag: 'segment', value: { type: 'text', content: 'next' } }],
        nextCursor: null,
        done: true,
      });
    });

    it('fails a synchronous item that cannot be shrunk with StateStorageValueTooLargeError', async () => {
      await store.saveAgentOutput(FAT_AGENT, {
        segments: [
          {
            type: 'tool-call',
            content: '',
            toolInput: { values: Array.from({ length: 400 }, (_, i) => i) },
          },
        ],
      });

      await expect(
        store.getAgentOutputPage(FAT_AGENT, undefined, 1024),
      ).rejects.toBeInstanceOf(StateStorageValueTooLargeError);
    });

    it('reads one async page with exactly one dual-budget readJsonSequence call', async () => {
      const page = {
        items: [
          {
            tag: 'segment' as const,
            value: { type: 'text' as const, content: '界'.repeat(40_000) },
          },
        ],
        nextCursor: 'g3.1',
        done: false,
        approximateBytes: 1,
      };
      const readJsonSequence = jest.fn(async function* (): AsyncIterable<
        typeof page
      > {
        yield page;
      });
      const asyncStore = storeOverSequence(readJsonSequence);

      const result = await asyncStore.getAgentOutputPage(
        FAT_AGENT,
        'g3.0',
        512 * 1024,
      );

      expect(readJsonSequence).toHaveBeenCalledTimes(1);
      expect(readJsonSequence).toHaveBeenCalledWith(
        `ptah.agentOutput:${FAT_AGENT}`,
        {
          cursor: 'g3.0',
          maxBytes: 256 * 1024,
          maxJsonBytes: 256 * 1024,
          jsonEnvelopeBytes: ENVELOPE_BYTES,
          maxItemBytes: 256 * 1024 - ENVELOPE_BYTES,
        },
      );
      expect(result).toEqual({
        items: page.items,
        nextCursor: 'g3.1',
        done: false,
      });
      expect(rpcBytes(result)).toBeLessThanOrEqual(256 * 1024);
    });

    it('drains async output with one readJsonSequence call per page', async () => {
      const { asyncStore, readJsonSequence } = createAsyncFake();
      await asyncStore.saveAgentOutput(FAT_AGENT, {
        segments: Array.from({ length: 12 }, (_, i) => ({
          type: 'text' as const,
          content: `${i}${'界'.repeat(150)}`,
        })),
      });

      let cursor: string | undefined;
      let pages = 0;
      let items = 0;
      do {
        const page = await asyncStore.getAgentOutputPage(
          FAT_AGENT,
          cursor,
          1024,
        );
        expect(rpcBytes(page)).toBeLessThanOrEqual(1024);
        items += page.items.length;
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor);

      expect(items).toBe(12);
      expect(pages).toBeGreaterThan(1);
      expect(readJsonSequence).toHaveBeenCalledTimes(pages);
    });

    it('maps a stale storage cursor to AgentOutputCursorStaleError without retrying', async () => {
      const readJsonSequence = jest.fn(async function* () {
        yield* [];
        throw new StateStorageCursorStaleError(`ptah.agentOutput:${FAT_AGENT}`);
      });
      const asyncStore = storeOverSequence(readJsonSequence);

      const error = await asyncStore
        .getAgentOutputPage(FAT_AGENT, 'g1.4', 256 * 1024)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AgentOutputCursorStaleError);
      expect(error).toBeInstanceOf(SdkError);
      expect((error as AgentOutputCursorStaleError).agentId).toBe(FAT_AGENT);
      expect(readJsonSequence).toHaveBeenCalledTimes(1);
    });

    it('passes value-too-large through unchanged', async () => {
      const tooLarge = new StateStorageValueTooLargeError('k', 9_999_999);
      const readJsonSequence = jest.fn(async function* () {
        yield* [];
        throw tooLarge;
      });

      await expect(
        storeOverSequence(readJsonSequence).getAgentOutputPage(
          FAT_AGENT,
          undefined,
          256 * 1024,
        ),
      ).rejects.toBe(tooLarge);
    });

    it('logs worker-truncated items with page-relative indexes', async () => {
      const readJsonSequence = jest.fn(async function* () {
        yield {
          items: [{ tag: 'segment', value: { type: 'text', content: 'x' } }],
          nextCursor: 'g2.9',
          done: false,
          approximateBytes: 1,
          truncatedItems: [{ index: 0, originalJsonBytes: 1_112_231 }],
        };
      });

      await storeOverSequence(readJsonSequence).getAgentOutputPage(
        FAT_AGENT,
        'g2.8',
        256 * 1024,
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Truncated oversized agent output items'),
        { truncatedItems: [{ pageIndex: 0, originalJsonBytes: 1_112_231 }] },
      );
    });

    it('closes the page iterator rather than abandoning it', async () => {
      let closed = false;
      const readJsonSequence = jest.fn(async function* () {
        try {
          yield {
            items: [],
            nextCursor: null,
            done: true,
            approximateBytes: 1,
          };
          yield {
            items: [],
            nextCursor: null,
            done: true,
            approximateBytes: 1,
          };
        } finally {
          closed = true;
        }
      });

      await expect(
        storeOverSequence(readJsonSequence).getAgentOutputPage(
          FAT_AGENT,
          undefined,
          256 * 1024,
        ),
      ).resolves.toEqual({ items: [], nextCursor: null, done: true });
      expect(closed).toBe(true);
    });

    it('answers an absent async sequence with an empty final page', async () => {
      const { asyncStore } = createAsyncFake();

      await expect(
        asyncStore.getAgentOutputPage(FAT_AGENT, undefined, 256 * 1024),
      ).resolves.toEqual({ items: [], nextCursor: null, done: true });
    });

    it('rejects a worker page that violates the final RPC budget', async () => {
      const page = {
        items: [
          {
            tag: 'segment' as const,
            value: { type: 'text' as const, content: '界'.repeat(90_000) },
          },
        ],
        nextCursor: '1',
        done: false,
        approximateBytes: 1,
      };
      const readJsonSequence = jest.fn(async function* (): AsyncIterable<
        typeof page
      > {
        yield page;
      });

      await expect(
        storeOverSequence(readJsonSequence).getAgentOutputPage(
          FAT_AGENT,
          undefined,
          256 * 1024,
        ),
      ).rejects.toThrow('Agent output page exceeds RPC budget');
      expect(readJsonSequence).toHaveBeenCalledTimes(1);
    });

    it('keeps restore lean and exposes complete history only through pages', async () => {
      await seedFatReference();
      await store.saveAgentOutput(FAT_AGENT, {
        segments: segments(500),
        streamEvents: streamEvents(5000),
      });

      const refs = await store.getCliSessionsForRestore('sess-1');
      expect(refs).toHaveLength(1);
      expect(refs[0]).not.toHaveProperty('stdout');
      expect(refs[0]).not.toHaveProperty('segments');
      expect(refs[0]).not.toHaveProperty('streamEvents');
      expect(refs[0].cliSessionId).toBe('cli-fat');

      const received: TaggedAgentOutputItem[] = [];
      let cursor: string | undefined;
      do {
        const page = await store.getAgentOutputPage(
          FAT_AGENT,
          cursor,
          32 * 1024,
        );
        received.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(received.filter((item) => item.tag === 'segment')).toHaveLength(
        500,
      );
      expect(
        received.filter((item) => item.tag === 'streamEvent'),
      ).toHaveLength(5000);
    });

    it('returns projected references for restore from an unmigrated fat record', async () => {
      storage.__state.seed(METADATA_KEY, [
        fatDetail([fatRef('agent-a', 'cli-a')]),
      ]);

      const refs = await store.getCliSessionsForRestore('sess-1');

      expect(refs).toEqual([
        cliRef({ cliSessionId: 'cli-a', agentId: 'agent-a' as AgentId }),
      ]);
    });

    it('returns an empty list for a session with no CLI agents', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await expect(store.getCliSessionsForRestore('sess-1')).resolves.toEqual(
        [],
      );
      await expect(store.getCliSessionsForRestore('missing')).resolves.toEqual(
        [],
      );
    });

    // -----------------------------------------------------------------------
    // TASK_2026_324 finding 4 — re-association must not orphan a key.
    // -----------------------------------------------------------------------

    it('deletes the displaced agent output key when a cliSessionId is re-associated', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.saveAgentOutput('agent-first' as AgentId, {
        streamEvents: streamEvents(10),
      });
      await store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'cli-a', agentId: 'agent-first' as AgentId }),
      );

      // Same CLI session resumed under a NEW agent: the slot is the only route
      // to `ptah.agentOutput:agent-first`, so replacing it strands that key.
      await store.saveAgentOutput('agent-second' as AgentId, {
        streamEvents: streamEvents(4),
      });
      await store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'cli-a', agentId: 'agent-second' as AgentId }),
      );

      expect(storage.__state.entries.has('ptah.agentOutput:agent-first')).toBe(
        false,
      );
      expect(storage.__state.entries.has('ptah.agentOutput:agent-second')).toBe(
        true,
      );
    });

    it('keeps the displaced output key when the replacement reference never reaches storage', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.saveAgentOutput('agent-first' as AgentId, {
        streamEvents: streamEvents(10),
      });
      await store.addCliSession(
        'sess-1',
        cliRef({ cliSessionId: 'cli-a', agentId: 'agent-first' as AgentId }),
      );
      await store.saveAgentOutput('agent-second' as AgentId, {
        streamEvents: streamEvents(4),
      });

      // The blob write fails on the re-association. Deleting the displaced key
      // first would leave `cli-a` pointing at `agent-first` in STORED metadata
      // — the reference readers still see — with its output already gone.
      storage.update.mockImplementation(async (key: string, value: unknown) => {
        if (key === METADATA_KEY) throw new Error('storage full');
        if (value === undefined) storage.__state.entries.delete(key);
        else storage.__state.entries.set(key, value);
      });

      await expect(
        store.addCliSession(
          'sess-1',
          cliRef({ cliSessionId: 'cli-a', agentId: 'agent-second' as AgentId }),
        ),
      ).rejects.toThrow('storage full');

      expect(storage.__state.entries.has('ptah.agentOutput:agent-first')).toBe(
        true,
      );
    });

    it('keeps the output key when the same agent re-reports the same cliSessionId', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.saveAgentOutput('agent-same' as AgentId, {
        streamEvents: streamEvents(10),
      });
      const ref = cliRef({
        cliSessionId: 'cli-a',
        agentId: 'agent-same' as AgentId,
      });
      await store.addCliSession('sess-1', { ...ref, status: 'running' });
      await store.addCliSession('sess-1', { ...ref, status: 'completed' });

      expect(storage.__state.entries.has('ptah.agentOutput:agent-same')).toBe(
        true,
      );
    });

    it('drops the per-agent output keys when the session is deleted', async () => {
      await seedFatReference();
      await store.saveAgentOutput(FAT_AGENT, {
        streamEvents: streamEvents(10),
      });
      expect(storage.__state.entries.has(`ptah.agentOutput:${FAT_AGENT}`)).toBe(
        true,
      );

      await store.delete('sess-1');

      expect(storage.__state.entries.has(`ptah.agentOutput:${FAT_AGENT}`)).toBe(
        false,
      );
    });

    it('keeps the per-agent output keys when the session list deletion flush fails', async () => {
      await seedFatReference();
      await store.saveAgentOutput(FAT_AGENT, {
        streamEvents: streamEvents(10),
      });

      // Fail the metadata blob flush so the session record survives in storage.
      // Deleting output keys before this flush would strand the surviving
      // session with references pointing to output keys that no longer exist.
      storage.update.mockImplementation(async (key: string, value: unknown) => {
        if (key === METADATA_KEY) throw new Error('storage busy');
        if (value === undefined) storage.__state.entries.delete(key);
        else storage.__state.entries.set(key, value);
      });

      await expect(store.delete('sess-1')).rejects.toThrow('storage busy');

      // The per-agent output key survives in storage and was never written to undefined
      expect(storage.__state.entries.has(`ptah.agentOutput:${FAT_AGENT}`)).toBe(
        true,
      );
      const undefinedOutputCalls = storage.update.mock.calls.filter(
        ([key, value]) =>
          key === `ptah.agentOutput:${FAT_AGENT}` && value === undefined,
      );
      expect(undefinedOutputCalls).toHaveLength(0);
    });

    it('makes session list durable before deleting per-agent output keys', async () => {
      await seedFatReference();
      await store.saveAgentOutput(FAT_AGENT, {
        streamEvents: streamEvents(10),
      });

      const updateOrder: string[] = [];
      storage.update.mockImplementation(async (key: string, value: unknown) => {
        updateOrder.push(key);
        if (value === undefined) storage.__state.entries.delete(key);
        else storage.__state.entries.set(key, value);
      });

      await store.delete('sess-1');

      const metadataIdx = updateOrder.indexOf(METADATA_KEY);
      const agentOutputIdx = updateOrder.indexOf(
        `ptah.agentOutput:${FAT_AGENT}`,
      );

      expect(metadataIdx).toBeGreaterThanOrEqual(0);
      expect(agentOutputIdx).toBeGreaterThanOrEqual(0);
      expect(metadataIdx).toBeLessThan(agentOutputIdx);

      expect(storage.__state.entries.has(`ptah.agentOutput:${FAT_AGENT}`)).toBe(
        false,
      );
      expect(await store.get('sess-1')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // addStats — accumulation + parent propagation
  // -------------------------------------------------------------------------

  describe('addStats', () => {
    it('accumulates cost and tokens', async () => {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addStats('sess-1', {
        cost: 0.01,
        tokens: { input: 5, output: 3 },
      });
      await store.addStats('sess-1', {
        cost: 0.02,
        tokens: { input: 2, output: 1 },
      });

      const md = await store.get('sess-1');
      expect(md?.totalCost).toBeCloseTo(0.03, 5);
      expect(md?.totalTokens).toEqual({ input: 7, output: 4 });
    });

    it('propagates child session stats to the referenced parent', async () => {
      await store.create('parent-1', WORKSPACE, 'parent');
      await store.createChild('child-1', WORKSPACE, 'child');
      // Link the child to the parent via a CliSessionReference whose
      // sdkSessionId points at the child's session id.
      await store.addCliSession(
        'parent-1',
        cliRef({
          cliSessionId: 'cli-parent-link',
          sdkSessionId: 'child-1',
        }),
      );

      await store.addStats('child-1', {
        cost: 0.05,
        tokens: { input: 100, output: 50 },
      });

      const parent = await store.get('parent-1');
      expect(parent?.totalCost).toBeCloseTo(0.05, 5);
      expect(parent?.totalTokens).toEqual({ input: 100, output: 50 });

      const child = await store.get('child-1');
      expect(child?.totalCost).toBeCloseTo(0.05, 5);
    });

    it('silently no-ops when the target session does not exist', async () => {
      await expect(
        store.addStats('missing', { cost: 1, tokens: { input: 1, output: 1 } }),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // isReferencedAsChildSession
  // -------------------------------------------------------------------------

  describe('isReferencedAsChildSession', () => {
    it('returns true when a parent cliSessions entry points at the given sdkSessionId', async () => {
      await store.create('parent-1', WORKSPACE, 'parent');
      await store.addCliSession(
        'parent-1',
        cliRef({ sdkSessionId: 'maybe-child' }),
      );
      await expect(
        store.isReferencedAsChildSession('maybe-child'),
      ).resolves.toBe(true);
    });

    it('returns false when no parent references the id', async () => {
      await expect(store.isReferencedAsChildSession('nope')).resolves.toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // delete / rename / touch
  // -------------------------------------------------------------------------

  describe('delete / rename / touch', () => {
    it('delete removes only the targeted session', async () => {
      await store.create('a', WORKSPACE, 'A');
      await store.create('b', WORKSPACE, 'B');

      await store.delete('a');

      expect(await store.get('a')).toBeNull();
      expect(await store.get('b')).not.toBeNull();
    });

    it('rename changes the name while preserving other fields', async () => {
      await store.create('a', WORKSPACE, 'Original');
      await store.rename('a', 'Renamed');
      const md = await store.get('a');
      expect(md?.name).toBe('Renamed');
      expect(md?.workspaceId).toBe(WORKSPACE);
    });

    it('touch bumps lastActiveAt', async () => {
      const md = await store.create('a', WORKSPACE, 'A');
      const original = md.lastActiveAt;
      // Ensure a measurable clock tick.
      await new Promise((r) => setTimeout(r, 5));
      await store.touch('a');
      const after = await store.get('a');
      expect(after?.lastActiveAt ?? 0).toBeGreaterThan(original);
    });
  });
});
