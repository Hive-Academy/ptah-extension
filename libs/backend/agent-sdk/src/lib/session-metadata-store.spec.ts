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
import {
  SessionMetadataStore,
  flushSessionMetadataStores,
} from './session-metadata-store';
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

    async function seedFatReference(): Promise<void> {
      await store.create('sess-1', WORKSPACE, 'parent');
      await store.addCliSession(
        'sess-1',
        cliRef({
          cliSessionId: 'cli-fat',
          agentId: FAT_AGENT,
          segments: segments(500),
          streamEvents: streamEvents(5000),
        }),
      );
    }

    it('keeps streamEvents out of the all-sessions blob', async () => {
      await seedFatReference();

      const blob = storage.__state.entries.get(METADATA_KEY);
      expect(JSON.stringify(blob)).not.toContain('streamEvents');

      const md = await store.get('sess-1');
      expect(md?.cliSessions?.[0].streamEvents).toBeUndefined();
    });

    it('trims inline segments to a bounded tail', async () => {
      await seedFatReference();

      const md = await store.get('sess-1');
      expect(md?.cliSessions?.[0].segments).toHaveLength(200);
      // The TAIL is what is kept — the newest output is the useful part.
      expect(md?.cliSessions?.[0].segments?.[199].content).toBe('segment-499');
    });

    it('stores bulk output under a per-agent key, not the blob', async () => {
      await store.saveAgentOutput(FAT_AGENT, {
        segments: segments(500),
        streamEvents: streamEvents(5000),
      });

      expect(storage.update).toHaveBeenCalledWith(
        `ptah.agentOutput:${FAT_AGENT}`,
        expect.objectContaining({ agentId: FAT_AGENT }),
      );
      const stored = await store.getAgentOutput(FAT_AGENT);
      expect(stored?.streamEvents).toHaveLength(5000);
      expect(stored?.segments).toHaveLength(500);
    });

    it('writes nothing when there is no output to store', async () => {
      await store.saveAgentOutput(FAT_AGENT, {
        segments: [],
        streamEvents: [],
      });
      expect(storage.update).not.toHaveBeenCalledWith(
        `ptah.agentOutput:${FAT_AGENT}`,
        expect.anything(),
      );
      await expect(store.getAgentOutput(FAT_AGENT)).resolves.toBeNull();
    });

    it('rehydrates the restore payload from the per-agent key', async () => {
      await seedFatReference();
      await store.saveAgentOutput(FAT_AGENT, {
        segments: segments(500),
        streamEvents: streamEvents(5000),
      });

      const refs = await store.getCliSessionsForRestore('sess-1');
      expect(refs).toHaveLength(1);
      expect(refs[0].streamEvents).toHaveLength(5000);
      expect(refs[0].segments).toHaveLength(500);
      // The reference's own identity fields survive the merge.
      expect(refs[0].cliSessionId).toBe('cli-fat');
    });

    it('returns the lean reference when no bulk output was stored', async () => {
      await seedFatReference();
      // The store now migrates what it leans (TASK_2026_324 finding 1), so the
      // "nothing stored" case has to be made by DROPPING the key — which is
      // also the real one: an agent whose output was deleted, or a reference
      // written by a build that predates the per-agent split.
      await store.deleteAgentOutput(FAT_AGENT);

      const refs = await store.getCliSessionsForRestore('sess-1');
      expect(refs[0].streamEvents).toBeUndefined();
      expect(refs[0].segments).toHaveLength(200);
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
    // TASK_2026_324 finding 1 — a fat reference is MIGRATED, never dropped.
    //
    // `addCliSession` is not the only way a reference gets into a record. A
    // blob written before the per-agent split still carries inline
    // `streamEvents`, and `save` / `addStats` / `rename` /
    // `propagateStatsToParent` all round-trip that record through
    // `_saveInternal`. Leaning without migrating meant the first incidental
    // write — a cost update on an unrelated turn — silently deleted an
    // agent's whole execution tree.
    // -----------------------------------------------------------------------

    const OLD_FORMAT_AGENT = 'agent-old-format' as AgentId;

    /**
     * Seed the blob directly, so the fat reference reaches the store the one
     * way the bug needs: NOT through `addCliSession`.
     */
    function seedOldFormatBlob(ref: Partial<CliSessionReference> = {}): void {
      storage.__state.seed(METADATA_KEY, [
        {
          sessionId: 'sess-1',
          name: 'parent',
          workspaceId: WORKSPACE,
          createdAt: 1,
          lastActiveAt: 1,
          totalCost: 0,
          totalTokens: { input: 0, output: 0 },
          cliSessions: [
            cliRef({
              cliSessionId: 'cli-old',
              agentId: OLD_FORMAT_AGENT,
              segments: segments(500),
              streamEvents: streamEvents(400),
              ...ref,
            }),
          ],
        },
      ]);
    }

    it('migrates an old-format inline reference on an unrelated stats write', async () => {
      seedOldFormatBlob();

      await store.addStats('sess-1', {
        cost: 0.01,
        tokens: { input: 1, output: 1 },
      });

      // The blob is lean — that half already worked.
      const blob = storage.__state.entries.get(METADATA_KEY);
      expect(JSON.stringify(blob)).not.toContain('streamEvents');

      // ...and the bulk is still readable, which is the half that did not.
      const refs = await store.getCliSessionsForRestore('sess-1');
      expect(refs[0].streamEvents).toHaveLength(400);
      expect(refs[0].segments).toHaveLength(500);
    });

    it('leaves a reference with no agentId untouched — there is no key to migrate to', async () => {
      seedOldFormatBlob({ agentId: '' as AgentId });

      await store.addStats('sess-1', {
        cost: 0.01,
        tokens: { input: 1, output: 1 },
      });

      // Fat in the blob is the lesser evil: `ptah.agentOutput:<agentId>` IS
      // the destination, and there is no id to name it by.
      const md = await store.get('sess-1');
      expect(md?.cliSessions?.[0].streamEvents).toHaveLength(400);
      expect(md?.cliSessions?.[0].segments).toHaveLength(500);
    });

    it('never lets a migration shrink an already-stored snapshot', async () => {
      await store.saveAgentOutput(OLD_FORMAT_AGENT, {
        segments: segments(500),
        streamEvents: streamEvents(5000),
      });
      // A re-persist arriving with only the tail the agent still held.
      seedOldFormatBlob({ streamEvents: streamEvents(12) });

      await store.rename('sess-1', 'Renamed');

      const stored = await store.getAgentOutput(OLD_FORMAT_AGENT);
      expect(stored?.streamEvents).toHaveLength(5000);
    });

    it('keeps the reference fat when the migration write fails', async () => {
      seedOldFormatBlob();
      storage.update.mockImplementation(async (key: string, value: unknown) => {
        if (key.startsWith('ptah.agentOutput:')) {
          throw new Error('storage busy');
        }
        if (value === undefined) storage.__state.entries.delete(key);
        else storage.__state.entries.set(key, value);
      });

      await store.rename('sess-1', 'Renamed');

      const md = await store.get('sess-1');
      expect(md?.name).toBe('Renamed');
      expect(md?.cliSessions?.[0].streamEvents).toHaveLength(400);
      expect(logger.warn).toHaveBeenCalled();
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
