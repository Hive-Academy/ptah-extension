/**
 * Specs for KnowledgeAgentService — covers the critical
 * buildCorpus → primeCorpus → queryCorpus round-trip plus rebuild diffing.
 *
 * Acceptance criterion #3 (TASK_2026_136 § Batch C1): round-trip MUST be
 * covered by a real spec using a fake SessionLifecycleManager.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import { KnowledgeAgentService } from './knowledge-agent.service';
import type { CorpusStore } from './corpus.store';
import type { MemorySearchService } from '../memory-search.service';
import type { CorpusRecord, CorpusRef } from './corpus.types';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

interface FakeCorpusState {
  ref: CorpusRef;
  record: CorpusRecord;
  memberIds: string[];
}

function makeCorpusStore(): {
  store: CorpusStore;
  state: Map<string, FakeCorpusState>;
} {
  const state = new Map<string, FakeCorpusState>();
  const store = {
    create: jest.fn(
      (params: { name: string; workspaceRoot?: string | null }) => {
        const id = `id-${params.name}`;
        const ref: CorpusRef = {
          id,
          name: params.name,
          count: 0,
          builtAt: 1,
          rebuiltAt: null,
          workspaceRoot: params.workspaceRoot ?? null,
        };
        const record: CorpusRecord = {
          ...ref,
          queryJson: JSON.stringify(params),
          primedSessionIds: [],
        };
        state.set(params.name, { ref, record, memberIds: [] });
        return ref;
      },
    ),
    getByName: jest.fn((name: string) => state.get(name)?.record ?? null),
    setMemberIds: jest.fn((id: string, ids: readonly string[]) => {
      for (const v of state.values()) {
        if (v.ref.id === id) {
          v.memberIds = [...ids];
          v.record = { ...v.record, count: ids.length } as CorpusRecord;
          v.ref = { ...v.ref, count: ids.length };
        }
      }
    }),
    getMemberIds: jest.fn((id: string) => {
      for (const v of state.values()) {
        if (v.ref.id === id) return v.memberIds;
      }
      return [];
    }),
    setPrimedSessionIds: jest.fn((id: string, ids: readonly string[]) => {
      for (const v of state.values()) {
        if (v.ref.id === id) {
          v.record = {
            ...v.record,
            primedSessionIds: [...ids],
          } as CorpusRecord;
        }
      }
    }),
    updateRebuiltAt: jest.fn((id: string) => {
      for (const v of state.values()) {
        if (v.ref.id === id) {
          v.ref = { ...v.ref, rebuiltAt: 99 };
          v.record = { ...v.record, rebuiltAt: 99 } as CorpusRecord;
        }
      }
    }),
    delete: jest.fn((id: string) => {
      for (const [name, v] of state.entries()) {
        if (v.ref.id === id) {
          state.delete(name);
          return true;
        }
      }
      return false;
    }),
    list: jest.fn(() => Array.from(state.values()).map((v) => v.ref)),
  } as unknown as CorpusStore;
  return { store, state };
}

function makeSearch(rows: Array<{ id: string }>): MemorySearchService {
  return {
    searchIndex: jest.fn().mockResolvedValue({ rows, bm25Only: true }),
  } as unknown as MemorySearchService;
}

interface FakeSession {
  alive: boolean;
}

function makeSessions(): {
  mgr: SessionLifecycleManager;
  alive: Map<string, FakeSession>;
  sentMessages: Array<{ sessionId: string; content: string }>;
  registered: Array<{ tabId: string; corpusName?: string }>;
  ended: string[];
} {
  const alive = new Map<string, FakeSession>();
  const sentMessages: Array<{ sessionId: string; content: string }> = [];
  const registered: Array<{ tabId: string; corpusName?: string }> = [];
  const ended: string[] = [];
  const mgr = {
    register: jest.fn(
      (
        tabId: string,
        config: { corpusName?: string },
        _abort: AbortController,
      ) => {
        registered.push({ tabId, corpusName: config?.corpusName });
        alive.set(tabId, { alive: true });
        return {
          tabId,
          realSessionId: null,
          config,
        };
      },
    ),
    executeQuery: jest.fn().mockResolvedValue({
      sdkQuery: {},
      initialModel: 'claude-sonnet-4',
      abortController: new AbortController(),
    }),
    find: jest.fn((id: string) => {
      const rec = alive.get(id);
      return rec?.alive ? { tabId: id } : undefined;
    }),
    sendMessage: jest.fn(async (id: string, content: string) => {
      sentMessages.push({ sessionId: id, content });
    }),
    endSession: jest.fn(async (id: string) => {
      ended.push(id);
      alive.delete(id);
    }),
  } as unknown as SessionLifecycleManager;
  return { mgr, alive, sentMessages, registered, ended };
}

function makeService(opts?: { searchRows?: Array<{ id: string }> }): {
  svc: KnowledgeAgentService;
  store: CorpusStore;
  state: Map<string, FakeCorpusState>;
  sessions: ReturnType<typeof makeSessions>;
} {
  const { store, state } = makeCorpusStore();
  const sessions = makeSessions();
  const search = makeSearch(opts?.searchRows ?? []);
  const svc = new KnowledgeAgentService(
    makeLogger(),
    store,
    search,
    sessions.mgr,
  );
  return { svc, store, state, sessions };
}

describe('KnowledgeAgentService.buildCorpus', () => {
  it('persists the filter params and snapshots search rows into corpus_memories', async () => {
    const { svc, store } = makeService({
      searchRows: [{ id: 'mem-1' }, { id: 'mem-2' }, { id: 'mem-3' }],
    });
    const ref = await svc.buildCorpus({
      name: 'corpus-A',
      workspaceRoot: '/ws/X',
      query: 'curator',
    });
    expect(ref.name).toBe('corpus-A');
    expect(ref.count).toBe(3);
    expect((store.setMemberIds as jest.Mock).mock.calls[0][1]).toEqual([
      'mem-1',
      'mem-2',
      'mem-3',
    ]);
  });

  it('throws when a corpus with the same name already exists', async () => {
    const { svc } = makeService({ searchRows: [] });
    await svc.buildCorpus({ name: 'dup', workspaceRoot: null });
    await expect(
      svc.buildCorpus({ name: 'dup', workspaceRoot: null }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('KnowledgeAgentService — round-trip (acceptance criterion #3)', () => {
  it('buildCorpus → primeCorpus → queryCorpus drives a fake SessionLifecycleManager end-to-end', async () => {
    const { svc, sessions } = makeService({
      searchRows: [{ id: 'mem-1' }, { id: 'mem-2' }],
    });

    const ref = await svc.buildCorpus({
      name: 'corpus-X',
      workspaceRoot: '/ws/X',
      query: 'investigation',
    });
    expect(ref.count).toBe(2);

    const primed = await svc.primeCorpus('corpus-X');
    expect(primed.sessionId).toBeTruthy();
    expect(sessions.registered.length).toBe(1);
    expect(sessions.registered[0].corpusName).toBe('corpus-X');
    expect(sessions.alive.has(primed.sessionId)).toBe(true);

    const reply = await svc.queryCorpus('corpus-X', 'what did we learn?');
    expect(reply.sessionId).toBe(primed.sessionId);
    expect(sessions.sentMessages.length).toBe(1);
    expect(sessions.sentMessages[0].content).toBe('what did we learn?');
    expect((sessions.mgr.register as jest.Mock).mock.calls.length).toBe(1);
  });

  it('queryCorpus auto-primes when no alive primed session exists', async () => {
    const { svc, sessions } = makeService({
      searchRows: [{ id: 'mem-1' }],
    });
    await svc.buildCorpus({
      name: 'corpus-AP',
      workspaceRoot: null,
    });
    const reply = await svc.queryCorpus('corpus-AP', 'hi');
    expect((sessions.mgr.register as jest.Mock).mock.calls.length).toBe(1);
    expect(reply.sessionId).toBeTruthy();
  });
});

describe('KnowledgeAgentService.reprimeCorpus', () => {
  it('ends existing primed sessions, clears the list, then primes anew', async () => {
    const { svc, sessions } = makeService({
      searchRows: [{ id: 'mem-1' }],
    });
    await svc.buildCorpus({ name: 'corpus-R', workspaceRoot: null });
    const first = await svc.primeCorpus('corpus-R');
    expect(sessions.alive.has(first.sessionId)).toBe(true);
    const second = await svc.reprimeCorpus('corpus-R');
    expect(sessions.ended).toContain(first.sessionId);
    expect(second.sessionId).not.toBe(first.sessionId);
  });
});

describe('KnowledgeAgentService.rebuildCorpus', () => {
  it('diffs membership against persisted query_json and returns add/remove counts', async () => {
    const { svc, state } = makeService({
      searchRows: [{ id: 'mem-1' }, { id: 'mem-2' }],
    });
    await svc.buildCorpus({
      name: 'corpus-B',
      workspaceRoot: '/ws/X',
      query: 'rebuild',
    });
    const entry = state.get('corpus-B');
    expect(entry?.memberIds).toEqual(['mem-1', 'mem-2']);

    const newSearch = makeSearch([{ id: 'mem-2' }, { id: 'mem-3' }]);
    (svc as unknown as { search: MemorySearchService }).search = newSearch;
    const diff = await svc.rebuildCorpus('corpus-B');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(state.get('corpus-B')?.ref.rebuiltAt).not.toBeNull();
  });
});

describe('KnowledgeAgentService.deleteCorpus and listCorpora', () => {
  it('delete returns {deleted:true} only when a corpus existed', async () => {
    const { svc } = makeService({ searchRows: [] });
    expect(await svc.deleteCorpus('nope')).toEqual({ deleted: false });
    await svc.buildCorpus({ name: 'gone', workspaceRoot: null });
    expect(await svc.deleteCorpus('gone')).toEqual({ deleted: true });
  });

  it('listCorpora filters when workspaceRoot is provided, otherwise returns all', async () => {
    const { svc, store } = makeService({ searchRows: [] });
    await svc.buildCorpus({ name: 'a', workspaceRoot: '/ws/A' });
    svc.listCorpora('/ws/A');
    expect((store.list as jest.Mock).mock.calls[0][0]).toEqual({
      workspaceRoot: '/ws/A',
    });
    svc.listCorpora();
    expect((store.list as jest.Mock).mock.calls[1][0]).toEqual({});
  });
});
