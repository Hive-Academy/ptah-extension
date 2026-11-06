import 'reflect-metadata';
import type { SqliteDatabase, SqliteStatement } from '@ptah-extension/persistence-sqlite';
import { SearchWorkerRuntime } from './search-worker-runtime';
import { CodeSymbolStore } from './code-symbol.store';
import {
  createSearchWorkerResultSchemas,
  searchWorkerOutboundSchema,
  type SearchWorkerOutbound,
} from './search-worker.protocol';

const droppedRows = jest.fn();
const searchWorkerResultSchemas = createSearchWorkerResultSchemas(droppedRows);

interface FakeDbState {
  dataVersion: number;
  chunkTexts: string[];
  readonly pragmas: string[];
  readonly writes: string[];
}

function memoryRow(id: string): Record<string, unknown> {
  return {
    id,
    session_id: null,
    workspace_root: '/work',
    tier: 'recall',
    kind: 'fact',
    subject: `subject ${id}`,
    content: `content ${id}`,
    source_message_ids: '[]',
    salience: 0.5,
    decay_rate: 0.01,
    hits: 0,
    pinned: 0,
    created_at: 1,
    updated_at: 1,
    last_used_at: 1,
    expires_at: null,
    request: null,
    investigated: null,
    learned: null,
    completed: null,
    next_steps: null,
    type: 'discovery',
    concepts_json: '[]',
    files_json: '[]',
  };
}

/** Routes the few statements the worker issues; anything that writes is recorded. */
function fakeDb(state: FakeDbState): SqliteDatabase {
  const statement = (sql: string): SqliteStatement => ({
    all: () => {
      if (sql.includes('memory_chunks_fts MATCH')) {
        return state.chunkTexts.map((text, i) => ({
          rowid: i + 1,
          chunk_id: `c${i + 1}`,
          memory_id: `m${i + 1}`,
          ord: 0,
          text,
          token_count: 2,
          created_at: 1,
        }));
      }
      if (sql.includes('FROM memory_chunks WHERE memory_id = ?')) {
        return [{ id: 'c1', memory_id: 'm1', ord: 0, text: 'chunk one', token_count: 2, created_at: 1 }];
      }
      return [];
    },
    get: (id: unknown) => (sql.includes('FROM memories WHERE id = ?') ? memoryRow(String(id)) : undefined),
    run: () => {
      state.writes.push(sql);
      return { changes: 0, lastInsertRowid: 0 };
    },
    iterate: () => [][Symbol.iterator](),
  });
  return {
    exec: (sql: string) => state.writes.push(sql),
    prepare: statement,
    pragma: (text: string) => {
      state.pragmas.push(text);
      return text === 'data_version' ? state.dataVersion : undefined;
    },
    close: () => undefined,
    open: true,
    inTransaction: false,
    transaction: (fn) => fn,
  };
}

function setup(open?: (dbPath: string) => SqliteDatabase): {
  runtime: SearchWorkerRuntime;
  posted: SearchWorkerOutbound[];
  state: FakeDbState;
} {
  const posted: SearchWorkerOutbound[] = [];
  const state: FakeDbState = { dataVersion: 1, chunkTexts: ['alpha one'], pragmas: [], writes: [] };
  const runtime = new SearchWorkerRuntime({
    post: (message) => posted.push(message),
    openReadOnly: open ?? (() => fakeDb(state)),
  });
  return { runtime, posted, state };
}

const init = {
  kind: 'init',
  dbPath: '/db/ptah.sqlite',
  embedderDim: 3,
  embedderModelId: 'test-model',
  rerankAvailable: false,
};

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function resultFor(posted: SearchWorkerOutbound[], id: number): unknown {
  const reply = posted.find((m) => m.kind === 'result' && m.id === id);
  if (!reply || reply.kind !== 'result') throw new Error(`no result for request ${id}`);
  return reply.result;
}

describe('SearchWorkerRuntime', () => {
  afterEach(() => expect(droppedRows).not.toHaveBeenCalled());

  it('forwards a logged Error as a bounded serialized error, not a plain record', () => {
    const { runtime, posted } = setup();
    runtime.logger.error('query blew up', new Error('outer', { cause: new Error('inner') }));
    const [message] = posted;
    expect(searchWorkerOutboundSchema.safeParse(message).success).toBe(true);
    expect(message).toEqual({
      kind: 'log',
      level: 'error',
      message: 'query blew up',
      error: {
        name: 'Error',
        message: 'outer',
        stack: expect.stringContaining('outer'),
        cause: { name: 'Error', message: 'inner', stack: expect.stringContaining('inner') },
      },
    });
  });

  it('rejects invalid host messages with a forwarded warning', () => {
    const { runtime, posted } = setup();
    runtime.handle({ kind: 'memory', id: -1, query: 'x', topK: 3 });
    expect(posted).toEqual([
      expect.objectContaining({ kind: 'log', level: 'warn', message: expect.stringContaining('invalid host message') }),
    ]);
  });

  it('answers a query sent before init with an error reply', async () => {
    const { runtime, posted } = setup();
    runtime.handle({ kind: 'chunks', id: 4, memoryId: 'm1' });
    await flush();
    expect(posted).toContainEqual({ kind: 'error', id: 4, message: 'search worker not initialized' });
  });

  it('reports init-failed when the database cannot be opened', () => {
    const { runtime, posted } = setup(() => {
      throw new Error('SQLITE_CANTOPEN');
    });
    runtime.handle(init);
    expect(posted).toEqual([{ kind: 'init-failed', message: 'SQLITE_CANTOPEN' }]);
  });

  it('opens the connection query-only and reports lexical-only search without a vec path', () => {
    const { runtime, posted, state } = setup();
    runtime.handle(init);
    expect(state.pragmas).toContain('query_only = ON');
    expect(posted).toContainEqual({ kind: 'ready', vecLoaded: false });
  });

  it('logs how long each boot stage took before reporting ready', () => {
    const { runtime, posted } = setup();
    runtime.handle(init);
    const stages = posted.find((m) => m.kind === 'log' && m.message.includes('init stages'));
    expect(stages).toEqual(expect.objectContaining({
      level: 'info',
      context: expect.objectContaining({
        uptimeBeforeInitMs: expect.any(Number),
        openMs: expect.any(Number),
        vecLoadMs: expect.any(Number),
        setupMs: expect.any(Number),
        initMs: expect.any(Number),
      }),
    }));
    expect(posted.indexOf(stages ?? posted[0])).toBeLessThan(posted.findIndex((m) => m.kind === 'ready'));
  });

  it('does not start a request whose deadline passed while it waited', async () => {
    const { runtime, posted } = setup();
    runtime.handle(init);
    runtime.handle({ kind: 'chunks', id: 9, memoryId: 'm1', deadlineMs: Date.now() - 1 });
    await flush();
    expect(posted).toContainEqual({ kind: 'error', id: 9, message: 'request deadline passed before it started' });
    expect(posted.some((m) => m.kind === 'result')).toBe(false);
  });

  it('passes the request deadline to the symbol search', async () => {
    const searchSymbols = jest
      .spyOn(CodeSymbolStore.prototype, 'searchSymbols')
      .mockResolvedValue({ hits: [], bm25Only: true });
    try {
      const { runtime, posted } = setup();
      runtime.handle(init);
      const deadlineMs = Date.now() + 4_500;
      runtime.handle({ kind: 'symbols', id: 3, query: 'Foo', topK: 5, workspaceRoot: '/work', deadlineMs });
      await flush();
      expect(searchSymbols).toHaveBeenCalledWith('Foo', 5, '/work', deadlineMs);
      expect(resultFor(posted, 3)).toEqual({ hits: [], bm25Only: true });
    } finally {
      searchSymbols.mockRestore();
    }
  });

  it('answers chunk lookups with rows the host schema accepts', async () => {
    const { runtime, posted } = setup();
    runtime.handle(init);
    runtime.handle({ kind: 'chunks', id: 1, memoryId: 'm1' });
    await flush();
    const parsed = searchWorkerResultSchemas.chunks.parse(resultFor(posted, 1));
    expect(parsed).toEqual([
      { id: 'c1', memoryId: 'm1', ord: 0, text: 'chunk one', tokenCount: 2, createdAt: 1 },
    ]);
  });

  it('serves fresh memory results after another connection commits (data_version)', async () => {
    const { runtime, posted, state } = setup();
    runtime.handle(init);
    runtime.handle({ kind: 'memory', id: 1, query: 'alpha', topK: 3, workspaceRoot: '/work' });
    await flush();
    const first = searchWorkerResultSchemas.memory.parse(resultFor(posted, 1));
    expect(first.hits.map((hit) => hit.chunk.text)).toEqual(['alpha one']);

    // Same query, no commit elsewhere: the LRU answers.
    state.chunkTexts = ['alpha two'];
    runtime.handle({ kind: 'memory', id: 2, query: 'alpha', topK: 3, workspaceRoot: '/work' });
    await flush();
    const cached = searchWorkerResultSchemas.memory.parse(resultFor(posted, 2));
    expect(cached.hits.map((hit) => hit.chunk.text)).toEqual(['alpha one']);

    // The main process committed: the cache is dropped.
    state.dataVersion = 2;
    runtime.handle({ kind: 'memory', id: 3, query: 'alpha', topK: 3, workspaceRoot: '/work' });
    await flush();
    const fresh = searchWorkerResultSchemas.memory.parse(resultFor(posted, 3));
    expect(fresh.hits.map((hit) => hit.chunk.text)).toEqual(['alpha two']);
    expect(state.writes).toEqual([]);
  });
});
