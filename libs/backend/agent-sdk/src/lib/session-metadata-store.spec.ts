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
import { SessionMetadataStore } from './session-metadata-store';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { CliSessionReference, AgentId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { SdkError } from './errors';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

const WORKSPACE = '/workspace/project';

function cliRef(
  overrides: Partial<CliSessionReference> = {},
): CliSessionReference {
  return {
    cliSessionId: 'cli-1',
    cli: 'gemini',
    agentId: 'agent-gemini-1' as AgentId,
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
