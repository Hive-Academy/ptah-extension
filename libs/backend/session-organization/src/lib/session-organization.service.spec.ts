import 'reflect-metadata';
import * as os from 'os';
import * as path from 'path';
import {
  normalizeWorkspaceRoot,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import {
  SessionOrganizationInputError,
  SessionOrganizationService,
  type SessionOrganizationChange,
  type SessionOrganizationMetadataReader,
} from './session-organization.service';
import type {
  SessionOrganizationStore,
  StoredOrganization,
} from './session-organization.store';

// ── Fakes ────────────────────────────────────────────────────────────────────

const ROOT = path.join(os.tmpdir(), 'ptah-session-org-ws');
const KEY = normalizeWorkspaceRoot(ROOT);
const SESSION = '0b6c2a52-6a39-4c8e-9a51-3c1f0d7e2b11';
const PARENT = '5d8e1f40-1c2b-4a3d-8e9f-0a1b2c3d4e5f';
const TAB_ID = 'tab_1727000000000_x7k2p';

type StoreMethod =
  | 'isReady'
  | 'listWorkspace'
  | 'listTaskLinks'
  | 'upsertOrganization'
  | 'linkTask'
  | 'unlinkTask'
  | 'addPrLink'
  | 'removePrLink'
  | 'recordAgentStartedSession'
  | 'deleteSession'
  | 'countChildren'
  | 'rekeySession';

type FakeStore = { [K in StoreMethod]: jest.Mock };

function createStore(): FakeStore {
  return {
    isReady: jest.fn(() => true),
    listWorkspace: jest.fn(() => new Map<string, StoredOrganization>()),
    listTaskLinks: jest.fn(() => []),
    upsertOrganization: jest.fn(),
    linkTask: jest.fn(),
    unlinkTask: jest.fn(() => true),
    addPrLink: jest.fn(),
    removePrLink: jest.fn(() => true),
    recordAgentStartedSession: jest.fn(),
    deleteSession: jest.fn(() => true),
    countChildren: jest.fn(() => new Map<string, number>()),
    rekeySession: jest.fn(() => [] as string[]),
  };
}

/** Write methods: none may run for a dropped capture. */
const WRITE_METHODS: StoreMethod[] = [
  'upsertOrganization',
  'linkTask',
  'unlinkTask',
  'addPrLink',
  'removePrLink',
  'recordAgentStartedSession',
  'deleteSession',
  'rekeySession',
];

interface Harness {
  service: SessionOrganizationService;
  store: FakeStore;
  metadata: Map<string, { workspaceId: string }>;
  getMetadata: jest.Mock;
  lines: string[];
  changes: SessionOrganizationChange[];
}

function setup(): Harness {
  const store = createStore();
  const metadata = new Map<string, { workspaceId: string }>([
    [SESSION, { workspaceId: ROOT }],
  ]);
  const getMetadata = jest.fn(async (id: string) => metadata.get(id) ?? null);
  const reader = {
    get: getMetadata,
  } as unknown as SessionOrganizationMetadataReader;
  const lines: string[] = [];
  const output = {
    appendLine: (line: string) => lines.push(line),
  } as unknown as IOutputChannel;
  const service = new SessionOrganizationService(
    store as unknown as SessionOrganizationStore,
    reader,
    output,
  );
  const changes: SessionOrganizationChange[] = [];
  service.onDidChange((e) => changes.push(e));
  return { service, store, metadata, getMetadata, lines, changes };
}

/** Recorder writes run detached after an awaited metadata read. */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function storedOrganization(
  overrides: Partial<StoredOrganization> = {},
): StoredOrganization {
  return {
    sessionId: SESSION,
    priority: 'high',
    status: 'waiting',
    pinned: true,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: 'user',
    updatedAt: 1000,
    tasks: [],
    prLinks: [],
    ...overrides,
  };
}

/** One call of each of the five recorder methods, for `sessionId`. */
function callEveryRecorderMethod(
  service: SessionOrganizationService,
  sessionId: string,
): void {
  service.recordWorktree({ sessionId, worktreePath: '/wt/a', branch: 'b' });
  service.recordLineage({ sessionId, parentSessionId: PARENT });
  service.linkTask({
    sessionId,
    taskId: 'TASK_2026_580_9f77',
    role: 'primary',
    source: 'agent',
  });
  service.addPrLink({
    sessionId,
    url: 'https://github.com/o/r/pull/1',
    source: 'agent',
  });
  service.recordAgentStartedSession({
    sessionId,
    workspaceRoot: ROOT,
    worktreePath: '/wt/a',
    branch: 'b',
  });
}

// ── Specs ────────────────────────────────────────────────────────────────────

describe('SessionOrganizationService', () => {
  describe('availability', () => {
    it('reads store readiness live on every call', () => {
      const h = setup();
      expect(h.service.isAvailable()).toBe(true);
      h.store.isReady.mockReturnValue(false);
      expect(h.service.isAvailable()).toBe(false);
    });

    it('reads a throwing readiness check as unavailable', () => {
      const h = setup();
      h.store.isReady.mockImplementation(() => {
        throw new Error('closed');
      });
      expect(h.service.isAvailable()).toBe(false);
    });
  });

  describe('tab-id guard (no metadata → dropped before any store call)', () => {
    it('drops a tab id on each of the five recorder methods', async () => {
      const h = setup();
      callEveryRecorderMethod(h.service, TAB_ID);
      await flush();

      for (const method of Object.keys(h.store) as StoreMethod[]) {
        expect(h.store[method]).not.toHaveBeenCalled();
      }
      expect(h.getMetadata).toHaveBeenCalledTimes(5);
      const drops = h.lines.filter((l) => l.includes(`dropped for ${TAB_ID}`));
      expect(drops).toHaveLength(5);
      for (const line of drops) {
        expect(line).toMatch(/^\[SessionOrganization\] /);
        expect(line).toContain('no metadata');
      }
      expect(h.changes).toEqual([]);
    });

    it('does not repair the drop from the hint alone', async () => {
      const h = setup();
      h.service.recordWorktree({
        sessionId: TAB_ID,
        workspaceRootHint: ROOT,
        worktreePath: '/wt/a',
      });
      await flush();
      expect(h.store.upsertOrganization).not.toHaveBeenCalled();
    });

    it('answers session-not-found to a mutation without metadata', async () => {
      const h = setup();
      await expect(
        h.service.setOrganization({ sessionId: TAB_ID, pinned: true }),
      ).resolves.toEqual({
        ok: false,
        reason: 'session-not-found',
        message: 'Session not found',
      });
      expect(h.store.upsertOrganization).not.toHaveBeenCalled();
    });
  });

  describe('root resolution', () => {
    it('prefers the metadata workspaceId over the hint', async () => {
      const h = setup();
      h.service.recordWorktree({
        sessionId: SESSION,
        workspaceRootHint: path.join(ROOT, 'worktrees', 'child'),
        worktreePath: '/wt/a',
      });
      await flush();
      expect(h.store.upsertOrganization).toHaveBeenCalledWith(
        KEY,
        SESSION,
        { worktreePath: '/wt/a' },
        expect.any(Number),
      );
    });

    it('falls back to the hint when the metadata has no workspace', async () => {
      const h = setup();
      const hintRoot = path.join(os.tmpdir(), 'other-ws');
      h.metadata.set(SESSION, { workspaceId: '' });
      h.service.linkTask({
        sessionId: SESSION,
        workspaceRootHint: hintRoot,
        taskId: 'TASK_1',
        role: 'related',
        source: 'agent',
      });
      await flush();
      expect(h.store.linkTask).toHaveBeenCalledWith(
        normalizeWorkspaceRoot(hintRoot),
        SESSION,
        { taskId: 'TASK_1', role: 'related', source: 'agent' },
        expect.any(Number),
      );
    });

    it('drops the write when neither metadata nor hint names a workspace', async () => {
      const h = setup();
      h.metadata.set(SESSION, { workspaceId: '  ' });
      h.service.recordWorktree({ sessionId: SESSION, worktreePath: '/wt/a' });
      await flush();
      expect(h.store.upsertOrganization).not.toHaveBeenCalled();
      expect(h.lines.join('\n')).toContain('neither the session metadata');
    });

    describe('normalization: one key for every spelling of the root', () => {
      const variants = [
        ROOT,
        ROOT + path.sep,
        ...(process.platform === 'win32'
          ? [
              ROOT.replace(/\\/g, '/'),
              (ROOT[0] === ROOT[0].toUpperCase()
                ? ROOT[0].toLowerCase()
                : ROOT[0].toUpperCase()) + ROOT.slice(1),
            ]
          : []),
      ];

      it.each(variants)('metadata workspaceId %p', async (variant) => {
        const h = setup();
        h.metadata.set(SESSION, { workspaceId: variant });
        callEveryRecorderMethod(h.service, SESSION);
        await flush();
        expect(h.store.upsertOrganization.mock.calls.map((c) => c[0])).toEqual([
          KEY,
          KEY,
        ]);
        expect(h.store.linkTask.mock.calls[0][0]).toBe(KEY);
        expect(h.store.addPrLink.mock.calls[0][0]).toBe(KEY);
        expect(
          h.store.recordAgentStartedSession.mock.calls[0][0].workspaceRoot,
        ).toBe(KEY);
      });

      it.each(variants)(
        'hint and recordAgentStartedSession.workspaceRoot %p',
        async (variant) => {
          const h = setup();
          h.metadata.set(SESSION, { workspaceId: '' });
          h.service.recordWorktree({
            sessionId: SESSION,
            workspaceRootHint: variant,
            worktreePath: '/wt/a',
          });
          h.service.recordAgentStartedSession({
            sessionId: SESSION,
            workspaceRoot: variant,
            worktreePath: '/wt/a',
            branch: 'b',
          });
          await flush();
          expect(h.store.upsertOrganization.mock.calls[0][0]).toBe(KEY);
          expect(
            h.store.recordAgentStartedSession.mock.calls[0][0].workspaceRoot,
          ).toBe(KEY);
          expect(h.changes.map((c) => c.workspaceRoot)).toEqual([KEY, KEY]);
        },
      );

      it('normalizes query roots', () => {
        const h = setup();
        h.service.queryWorkspace(ROOT + path.sep);
        h.service.countChildren(ROOT + path.sep);
        h.service.listTaskLinks(ROOT + path.sep, ['T']);
        expect(h.store.listWorkspace).toHaveBeenCalledWith(KEY);
        expect(h.store.countChildren).toHaveBeenCalledWith(KEY);
        expect(h.store.listTaskLinks).toHaveBeenCalledWith(KEY, ['T']);
      });
    });
  });

  describe('recorder writes', () => {
    it('records an agent-started child in one store call and names both sessions', async () => {
      const h = setup();
      h.service.recordAgentStartedSession({
        sessionId: SESSION,
        workspaceRoot: ROOT,
        parentSessionId: PARENT,
        worktreePath: '/wt/child',
        branch: 'feat/x',
        taskId: 'TASK_2026_584_aaaa',
      });
      await flush();
      expect(h.store.recordAgentStartedSession).toHaveBeenCalledWith(
        {
          sessionId: SESSION,
          workspaceRoot: KEY,
          parentSessionId: PARENT,
          worktreePath: '/wt/child',
          branch: 'feat/x',
          taskId: 'TASK_2026_584_aaaa',
        },
        expect.any(Number),
      );
      expect(h.changes).toEqual([
        {
          workspaceRoot: KEY,
          sessionIds: [SESSION, PARENT],
          reason: 'capture',
        },
      ]);
    });

    it('passes only the lineage fields given', async () => {
      const h = setup();
      h.service.recordLineage({ sessionId: SESSION, forkOfSessionId: PARENT });
      await flush();
      expect(h.store.upsertOrganization).toHaveBeenCalledWith(
        KEY,
        SESSION,
        { forkOfSessionId: PARENT },
        expect.any(Number),
      );
      expect(h.changes[0].sessionIds).toEqual([SESSION]);
    });

    it('canonicalizes a GitHub PR URL before the store sees it', async () => {
      const h = setup();
      h.service.addPrLink({
        sessionId: SESSION,
        url: 'https://GitHub.com/o/r/pull/42/files?x=1#y',
        source: 'agent',
      });
      await flush();
      expect(h.store.addPrLink).toHaveBeenCalledWith(
        KEY,
        SESSION,
        {
          url: 'https://github.com/o/r/pull/42',
          number: 42,
          repo: 'o/r',
          state: null,
          source: 'agent',
        },
        expect.any(Number),
      );
    });
  });

  describe('validation', () => {
    it.each<[string, (s: SessionOrganizationService) => void]>([
      [
        'unknown role',
        (s) =>
          s.linkTask({
            sessionId: SESSION,
            taskId: 'T',
            role: 'owner' as never,
            source: 'agent',
          }),
      ],
      [
        'unknown startedBy',
        (s) =>
          s.recordLineage({ sessionId: SESSION, startedBy: 'bot' as never }),
      ],
      ['empty lineage', (s) => s.recordLineage({ sessionId: SESSION })],
      [
        'self parent',
        (s) =>
          s.recordLineage({ sessionId: SESSION, parentSessionId: SESSION }),
      ],
      [
        'http PR URL',
        (s) =>
          s.addPrLink({
            sessionId: SESSION,
            url: 'http://github.com/o/r/pull/1',
            source: 'agent',
          }),
      ],
      [
        'unknown PR state',
        (s) =>
          s.addPrLink({
            sessionId: SESSION,
            url: 'https://github.com/o/r/pull/1',
            state: 'reopened' as never,
            source: 'agent',
          }),
      ],
      [
        'empty worktree path',
        (s) => s.recordWorktree({ sessionId: SESSION, worktreePath: '' }),
      ],
      [
        'multi-line session id',
        (s) => s.recordWorktree({ sessionId: 'a\nb', worktreePath: '/wt' }),
      ],
      [
        'multi-line parentSessionId',
        (s) => s.recordLineage({ sessionId: SESSION, parentSessionId: 'a\nb' }),
      ],
      [
        'oversized forkOfSessionId',
        (s) =>
          s.recordLineage({
            sessionId: SESSION,
            forkOfSessionId: 'x'.repeat(257),
          }),
      ],
      [
        'multi-line parentSessionId on an agent-started child',
        (s) =>
          s.recordAgentStartedSession({
            sessionId: SESSION,
            workspaceRoot: ROOT,
            parentSessionId: `${PARENT}\nforged`,
            worktreePath: '/wt',
            branch: 'b',
          }),
      ],
    ])('recorder drops %s without reading metadata', async (_label, call) => {
      const h = setup();
      expect(() => call(h.service)).not.toThrow();
      await flush();
      expect(h.getMetadata).not.toHaveBeenCalled();
      for (const method of WRITE_METHODS) {
        expect(h.store[method]).not.toHaveBeenCalled();
      }
      expect(h.lines).toHaveLength(1);
      expect(h.lines[0]).toMatch(/^\[SessionOrganization\] \w+ dropped: /);
    });

    it.each<[string, (s: SessionOrganizationService) => Promise<unknown>]>([
      ['no field', (s) => s.setOrganization({ sessionId: SESSION })],
      [
        'unknown priority',
        (s) =>
          s.setOrganization({ sessionId: SESSION, priority: 'p0' as never }),
      ],
      [
        'unknown status',
        (s) =>
          s.setOrganization({ sessionId: SESSION, status: 'open' as never }),
      ],
      [
        'non-boolean pinned',
        (s) =>
          s.setOrganization({ sessionId: SESSION, pinned: 'yes' as never }),
      ],
      [
        'unknown link source',
        (s) =>
          s.linkSessionTask({
            sessionId: SESSION,
            taskId: 'T',
            role: 'primary',
            source: 'robot' as never,
          }),
      ],
      [
        'empty task id',
        (s) => s.unlinkSessionTask({ sessionId: SESSION, taskId: '' }),
      ],
      [
        'javascript URL',
        (s) =>
          s.addSessionPrLink({
            sessionId: SESSION,
            url: 'javascript:alert(1)',
            source: 'user',
          }),
      ],
      [
        'oversized URL on remove',
        (s) =>
          s.removeSessionPrLink({
            sessionId: SESSION,
            url: `https://x.dev/${'a'.repeat(2048)}`,
          }),
      ],
    ])(
      'mutation rejects %s with SessionOrganizationInputError',
      async (_l, call) => {
        const h = setup();
        await expect(call(h.service)).rejects.toBeInstanceOf(
          SessionOrganizationInputError,
        );
        expect(h.getMetadata).not.toHaveBeenCalled();
      },
    );
  });

  describe('malformed input never throws into a producer', () => {
    const RECORDER_METHODS = [
      'recordWorktree',
      'recordLineage',
      'linkTask',
      'addPrLink',
      'recordAgentStartedSession',
    ] as const;
    const INPUTS: Array<[string, unknown]> = [
      ['undefined', undefined],
      ['null', null],
      ['{}', {}],
    ];
    const cases = RECORDER_METHODS.flatMap((method) =>
      INPUTS.map(
        ([label, input]) => [method, label, input] as [string, string, unknown],
      ),
    );

    it.each(cases)('%s(%s)', async (method, _label, input) => {
      const h = setup();
      const call = (
        h.service as unknown as Record<string, (i: unknown) => void>
      )[method].bind(h.service);

      expect(() => call(input)).not.toThrow();
      await flush();

      for (const storeMethod of Object.keys(h.store) as StoreMethod[]) {
        expect(h.store[storeMethod]).not.toHaveBeenCalled();
      }
      expect(h.getMetadata).not.toHaveBeenCalled();
      expect(h.lines).toHaveLength(1);
      expect(h.lines[0]).toMatch(
        new RegExp(`^\\[SessionOrganization\\] ${method} dropped: `),
      );
    });

    it.each<[string, unknown]>([
      ['undefined', undefined],
      ['null', null],
      ['a number', 7],
      ['an object', { href: 'https://github.com/o/r/pull/1' }],
    ])('PR mutations reject a %s url with the input error', async (_l, url) => {
      const h = setup();
      await expect(
        h.service.addSessionPrLink({
          sessionId: SESSION,
          url: url as string,
          source: 'user',
        }),
      ).rejects.toBeInstanceOf(SessionOrganizationInputError);
      await expect(
        h.service.removeSessionPrLink({
          sessionId: SESSION,
          url: url as string,
        }),
      ).rejects.toBeInstanceOf(SessionOrganizationInputError);
      expect(h.store.addPrLink).not.toHaveBeenCalled();
      expect(h.store.removePrLink).not.toHaveBeenCalled();
    });
  });

  describe('unavailable store (L8)', () => {
    it('drops every capture with a log line and writes nothing', async () => {
      const h = setup();
      h.store.isReady.mockReturnValue(false);
      callEveryRecorderMethod(h.service, SESSION);
      await flush();
      for (const method of WRITE_METHODS) {
        expect(h.store[method]).not.toHaveBeenCalled();
      }
      expect(h.lines.filter((l) => l.includes('store not open'))).toHaveLength(
        5,
      );
      expect(h.changes).toEqual([]);
    });

    it('answers organization-unavailable to a mutation', async () => {
      const h = setup();
      h.store.isReady.mockReturnValue(false);
      await expect(
        h.service.linkSessionTask({
          sessionId: SESSION,
          taskId: 'T',
          role: 'related',
          source: 'user',
        }),
      ).resolves.toEqual({
        ok: false,
        reason: 'organization-unavailable',
        message: 'Session organization storage is not available',
      });
      expect(h.store.linkTask).not.toHaveBeenCalled();
    });

    it('returns empty query results', () => {
      const h = setup();
      h.store.isReady.mockReturnValue(false);
      expect(h.service.queryWorkspace(ROOT).size).toBe(0);
      expect(h.service.countChildren(ROOT).size).toBe(0);
      expect(h.service.listTaskLinks(ROOT)).toEqual([]);
      expect(h.store.listWorkspace).not.toHaveBeenCalled();
    });

    it('catches a db getter throw (connection closed mid-call)', async () => {
      const h = setup();
      h.store.upsertOrganization.mockImplementation(() => {
        h.store.isReady.mockReturnValue(false);
        throw new Error('The database connection is not open');
      });
      h.service.recordWorktree({ sessionId: SESSION, worktreePath: '/wt' });
      await flush();
      expect(h.lines.join('\n')).toContain('recordWorktree failed');

      await expect(
        h.service.setOrganization({ sessionId: SESSION, pinned: true }),
      ).resolves.toMatchObject({
        ok: false,
        reason: 'organization-unavailable',
      });
      expect(h.changes).toEqual([]);
    });

    it('rethrows a storage error while the store is open', async () => {
      const h = setup();
      h.store.upsertOrganization.mockImplementation(() => {
        throw new Error('SQLITE_FULL');
      });
      await expect(
        h.service.setOrganization({ sessionId: SESSION, priority: 'low' }),
      ).rejects.toThrow('SQLITE_FULL');
      expect(h.lines.join('\n')).toContain('setOrganization failed');
    });
  });

  describe('mutations and change events', () => {
    it('setOrganization writes only the given fields, emits, and returns the summary', async () => {
      const h = setup();
      h.store.listWorkspace.mockReturnValue(
        new Map([
          [
            SESSION,
            storedOrganization({
              tasks: [
                { taskId: 'T', role: 'primary', source: 'user', createdAt: 5 },
              ],
            }),
          ],
        ]),
      );
      h.store.countChildren.mockReturnValue(new Map([[SESSION, 2]]));

      const result = await h.service.setOrganization({
        sessionId: SESSION,
        priority: 'high',
        pinned: true,
      });

      expect(h.store.upsertOrganization).toHaveBeenCalledWith(
        KEY,
        SESSION,
        { priority: 'high', pinned: true },
        expect.any(Number),
      );
      expect(h.changes).toEqual([
        { workspaceRoot: KEY, sessionIds: [SESSION], reason: 'user' },
      ]);
      expect(result).toEqual({
        ok: true,
        organization: {
          priority: 'high',
          status: 'waiting',
          pinned: true,
          worktreePath: null,
          branch: null,
          parentSessionId: null,
          forkOfSessionId: null,
          startedBy: 'user',
          tasks: [
            {
              taskId: 'T',
              role: 'primary',
              source: 'user',
              createdAt: 5,
              missing: false,
            },
          ],
          prLinks: [],
          childCount: 2,
          updatedAt: 1000,
        },
      });
    });

    it('returns defaults when the session has no stored row', async () => {
      const h = setup();
      h.store.unlinkTask.mockReturnValue(false);
      const result = await h.service.unlinkSessionTask({
        sessionId: SESSION,
        taskId: 'T',
      });
      expect(result).toMatchObject({
        ok: true,
        organization: {
          priority: 'normal',
          status: 'active',
          pinned: false,
          startedBy: 'user',
          childCount: 0,
          updatedAt: null,
        },
      });
      // Nothing was removed, so nothing changed.
      expect(h.changes).toEqual([]);
    });

    it('add and remove use the same canonical PR URL', async () => {
      const h = setup();
      await h.service.addSessionPrLink({
        sessionId: SESSION,
        url: 'https://github.com/o/r/pull/7/',
        state: 'open',
        source: 'user',
      });
      await h.service.removeSessionPrLink({
        sessionId: SESSION,
        url: 'https://github.com/o/r/pull/7?tab=files',
      });
      expect(h.store.addPrLink.mock.calls[0][2]).toEqual({
        url: 'https://github.com/o/r/pull/7',
        number: 7,
        repo: 'o/r',
        state: 'open',
        source: 'user',
      });
      expect(h.store.removePrLink).toHaveBeenCalledWith(
        KEY,
        SESSION,
        'https://github.com/o/r/pull/7',
        expect.any(Number),
      );
      expect(h.changes.map((c) => c.reason)).toEqual(['user', 'user']);
    });

    it('a throwing listener neither fails the write nor starves other listeners', async () => {
      const h = setup();
      const later: SessionOrganizationChange[] = [];
      h.service.onDidChange(() => {
        throw new Error('listener boom');
      });
      h.service.onDidChange((e) => later.push(e));
      await expect(
        h.service.setOrganization({ sessionId: SESSION, status: 'done' }),
      ).resolves.toMatchObject({ ok: true });
      expect(later).toHaveLength(1);
      expect(h.lines.join('\n')).toContain('change listener failed');
    });

    it('a disposed subscription and a disposed service emit nothing', async () => {
      const h = setup();
      const seen: SessionOrganizationChange[] = [];
      const sub = h.service.onDidChange((e) => seen.push(e));
      sub.dispose();
      await h.service.setOrganization({ sessionId: SESSION, pinned: false });
      expect(seen).toEqual([]);
      expect(h.changes).toHaveLength(1);

      h.service.dispose();
      h.service.dispose();
      await h.service.setOrganization({ sessionId: SESSION, pinned: true });
      expect(h.changes).toHaveLength(1);
    });
  });

  describe('lifecycle captures', () => {
    it('removeSession deletes under the normalized root and emits a delete', () => {
      const h = setup();
      h.service.removeSession(ROOT + path.sep, SESSION);
      expect(h.store.deleteSession).toHaveBeenCalledWith(KEY, SESSION);
      expect(h.changes).toEqual([
        { workspaceRoot: KEY, sessionIds: [SESSION], reason: 'delete' },
      ]);
    });

    it('removeSession emits nothing when no row existed', () => {
      const h = setup();
      h.store.deleteSession.mockReturnValue(false);
      h.service.removeSession(ROOT, SESSION);
      expect(h.changes).toEqual([]);
    });

    it('rekeySession emits one capture change per affected root', () => {
      const h = setup();
      h.store.rekeySession.mockReturnValue(['/a', '/b']);
      h.service.rekeySession(PARENT, SESSION);
      expect(h.store.rekeySession).toHaveBeenCalledWith(PARENT, SESSION);
      expect(h.changes).toEqual([
        {
          workspaceRoot: '/a',
          sessionIds: [PARENT, SESSION],
          reason: 'capture',
        },
        {
          workspaceRoot: '/b',
          sessionIds: [PARENT, SESSION],
          reason: 'capture',
        },
      ]);
    });

    it('rekeySession is a no-op for the same id and never throws', () => {
      const h = setup();
      h.service.rekeySession(SESSION, SESSION);
      expect(h.store.rekeySession).not.toHaveBeenCalled();

      h.store.rekeySession.mockImplementation(() => {
        throw new Error('boom');
      });
      expect(() => h.service.rekeySession(PARENT, SESSION)).not.toThrow();
      expect(h.lines.join('\n')).toContain('rekeySession failed');
    });

    it('drops lifecycle captures while unavailable', () => {
      const h = setup();
      h.store.isReady.mockReturnValue(false);
      h.service.removeSession(ROOT, SESSION);
      h.service.rekeySession(PARENT, SESSION);
      expect(h.store.deleteSession).not.toHaveBeenCalled();
      expect(h.store.rekeySession).not.toHaveBeenCalled();
      expect(h.lines.filter((l) => l.includes('store not open'))).toHaveLength(
        2,
      );
    });
  });
});
