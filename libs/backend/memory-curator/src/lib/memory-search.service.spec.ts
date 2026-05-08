/**
 * Unit tests for MemorySearchService.
 *
 * Covers:
 *   - `escapeFtsQuery` behaviour (Batch 6 / R2)
 *   - Reranker integration (Batch 7 / R1): happy path, skip on <5 candidates,
 *     error fallback to RRF order
 *   - Porter stemming integration test (skipped without native better-sqlite3)
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { MemoryStore } from './memory.store';
import { MemorySearchService } from './memory-search.service';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeEmbedder(): IEmbedder {
  return {
    embed: jest.fn(async () => []),
    dim: 384,
  } as unknown as IEmbedder;
}

/**
 * Build a fake EmbedderWorkerClient so `instanceof EmbedderWorkerClient`
 * returns true inside MemorySearchService.workerClient.
 */
function makeWorkerClient(rerankImpl?: jest.Mock): EmbedderWorkerClient {
  const rerank = rerankImpl ?? jest.fn(async () => []);
  const fake = Object.create(
    EmbedderWorkerClient.prototype,
  ) as EmbedderWorkerClient;
  (fake as unknown as { embed: jest.Mock }).embed = jest.fn(async () => []);
  (fake as unknown as { rerank: jest.Mock }).rerank = rerank;
  (fake as unknown as { warmup: jest.Mock }).warmup = jest.fn(
    async () => undefined,
  );
  (fake as unknown as { dim: number }).dim = 384;
  return fake;
}

function makeConnection(): SqliteConnectionService {
  return {
    vecExtensionLoaded: false,
    db: {
      prepare: jest.fn(() => ({ all: jest.fn(() => []) })),
    },
  } as unknown as SqliteConnectionService;
}

function makeStore(): MemoryStore {
  return {
    getById: jest.fn(() => undefined),
    recordHit: jest.fn(),
  } as unknown as MemoryStore;
}

/** Unwrap the private `escapeFtsQuery` method for white-box assertion. */
function escape(service: MemorySearchService, q: string): string {
  return (
    service as unknown as { escapeFtsQuery(q: string): string }
  ).escapeFtsQuery(q);
}

function makeService(): MemorySearchService {
  return new MemorySearchService(
    makeLogger(),
    makeConnection(),
    makeEmbedder(),
    makeStore(),
  );
}

/** Build a service with vec search disabled and a controllable reranker. */
function makeServiceWithReranker(options: {
  rerankImpl?: jest.Mock;
  rows?: Array<{
    rowid: number;
    chunk_id: string;
    memory_id: string;
    ord: number;
    text: string;
    token_count: number;
    created_at: number;
  }>;
  memoryLookup?: (id: string) => unknown;
}): { service: MemorySearchService; rerankMock: jest.Mock; logger: Logger } {
  const rerankMock = options.rerankImpl ?? jest.fn(async () => []);
  const workerClient = makeWorkerClient(rerankMock);
  const logger = makeLogger();

  const rows = options.rows ?? [];
  const connection: SqliteConnectionService = {
    vecExtensionLoaded: false,
    db: {
      prepare: jest.fn(() => ({
        all: jest.fn(() => rows),
      })),
    },
  } as unknown as SqliteConnectionService;

  const { memoryLookup } = options;
  const store: MemoryStore = {
    getById: memoryLookup
      ? jest.fn((id) => memoryLookup(String(id)))
      : jest.fn(() => undefined),
    recordHit: jest.fn(),
  } as unknown as MemoryStore;

  const service = new MemorySearchService(
    logger,
    connection,
    workerClient,
    store,
  );
  return { service, rerankMock, logger };
}

// ---------------------------------------------------------------------------
// escapeFtsQuery — unit tests
// ---------------------------------------------------------------------------

describe('MemorySearchService.escapeFtsQuery', () => {
  let service: MemorySearchService;

  beforeEach(() => {
    service = makeService();
  });

  it('strips double-quote metacharacter from query', () => {
    // Quotes in the input are stripped: 'foo "bar" baz' becomes three
    // clean tokens. Each token is re-wrapped in its own synthesised quotes.
    const result = escape(service, 'hello "world" thing');
    expect(result).toContain('"hello"');
    expect(result).toContain('"world"');
    expect(result).toContain('"thing"*');
    // The surrounding output structure is exactly three tokens joined by OR.
    expect(result).toBe('"hello" OR "world" OR "thing"*');
  });

  it('strips asterisk metacharacter from query tokens', () => {
    const result = escape(service, 'foo* bar*');
    // The * from the raw tokens is stripped; only the synthesised trailing *
    // on the last token is present.
    expect(result).toBe('"foo" OR "bar"*');
  });

  it('strips opening and closing parentheses from query', () => {
    const result = escape(service, '(hello) (world)');
    expect(result).toBe('"hello" OR "world"*');
  });

  it('drops single-character tokens', () => {
    const result = escape(service, 'a the quick b fox');
    // 'a' and 'b' (single chars) are dropped; 'the' is two chars -> kept.
    expect(result).not.toMatch(/"a"/);
    expect(result).not.toMatch(/"b"/);
    expect(result).toContain('"the"');
    expect(result).toContain('"quick"');
    expect(result).toContain('"fox"*');
  });

  it('applies prefix match (* suffix) only to the last token', () => {
    const result = escape(service, 'alpha beta gamma');
    expect(result).toBe('"alpha" OR "beta" OR "gamma"*');
    // Only the last token ends with *
    const parts = result.split(' OR ');
    expect(parts.at(-1)).toMatch(/"\w+"\*$/);
    for (const p of parts.slice(0, -1)) {
      expect(p).not.toMatch(/\*$/);
    }
  });

  it('returns the no-match sentinel for an empty string', () => {
    expect(escape(service, '')).toBe('""');
  });

  it('returns the no-match sentinel when all tokens are single characters', () => {
    expect(escape(service, 'a b c')).toBe('""');
  });

  it('returns the no-match sentinel for a string that is only metacharacters', () => {
    expect(escape(service, '"*(*)')).toBe('""');
  });

  it('joins multi-token query with OR', () => {
    const result = escape(service, 'memory retrieval pipeline');
    expect(result).toBe('"memory" OR "retrieval" OR "pipeline"*');
  });

  it('single surviving token gets the prefix match', () => {
    const result = escape(service, 'configur');
    expect(result).toBe('"configur"*');
  });

  it('lowercases tokens before quoting', () => {
    const result = escape(service, 'Hello World');
    expect(result).toBe('"hello" OR "world"*');
  });
});

// ---------------------------------------------------------------------------
// Reranker integration (R1)
// ---------------------------------------------------------------------------

/** Build a minimal FTS row for test use. */
function ftsRow(
  rowid: number,
  text: string,
): {
  rowid: number;
  chunk_id: string;
  memory_id: string;
  ord: number;
  text: string;
  token_count: number;
  created_at: number;
} {
  return {
    rowid,
    chunk_id: `ck${rowid}`,
    memory_id: `mem${rowid}`,
    ord: 0,
    text,
    token_count: text.split(' ').length,
    created_at: 1_000_000,
  };
}

describe('MemorySearchService.searchRich — reranker (R1)', () => {
  it('happy path: 5+ candidates => reranker called, output reordered', async () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ftsRow(i, `candidate text ${i}`));

    // Reranker returns a reversed order: rowid 5 first, rowid 1 last.
    const rerankImpl = jest.fn(async () =>
      [5, 4, 3, 2, 1].map((id) => ({
        id: String(id),
        score: (5 - id + 1) * 0.1,
      })),
    );

    const { service, rerankMock } = makeServiceWithReranker({
      rerankImpl,
      rows,
      memoryLookup: (id) =>
        id.startsWith('mem')
          ? {
              id,
              subject: `subject ${id}`,
              content: `content ${id}`,
              tier: 'core',
            }
          : undefined,
    });

    const result = await service.searchRich('test query', 5);

    // Reranker must have been invoked.
    expect(rerankMock).toHaveBeenCalledTimes(1);

    // The first hit should be the one the reranker ranked first (rowid 5).
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].chunk.text).toBe('candidate text 5');
  });

  it('fewer than 5 candidates => reranker is skipped', async () => {
    const rows = [1, 2, 3, 4].map((i) => ftsRow(i, `text ${i}`));
    const rerankImpl = jest.fn(async () => []);
    const { service, rerankMock } = makeServiceWithReranker({
      rerankImpl,
      rows,
    });

    await service.searchRich('test query', 4);

    expect(rerankMock).not.toHaveBeenCalled();
  });

  it('worker rerank error => falls back to RRF order, search resolves', async () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ftsRow(i, `text ${i}`));
    const rerankImpl = jest.fn(async () => {
      throw new Error('model load timeout');
    });
    const { service, logger } = makeServiceWithReranker({
      rerankImpl,
      rows,
      memoryLookup: (id) =>
        id.startsWith('mem')
          ? { id, subject: `s${id}`, content: `c${id}`, tier: 'core' }
          : undefined,
    });

    // Should resolve (not reject) even when reranker throws.
    const result = await service.searchRich('test query', 5);

    // Result still has hits from RRF.
    expect(result.hits.length).toBeGreaterThan(0);

    // Warning was logged.
    expect(
      (logger.warn as jest.Mock).mock.calls.some((c) =>
        (c[0] as string).includes('reranker failed'),
      ),
    ).toBe(true);
  });

  it('existing embedder (non-worker) => reranker not called', async () => {
    // makeService() injects a plain IEmbedder stub, not an EmbedderWorkerClient.
    // MemorySearchService.workerClient returns null in this case.
    const rows = [1, 2, 3, 4, 5].map((i) => ftsRow(i, `text ${i}`));
    const logger = makeLogger();
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn(() => ({ all: jest.fn(() => rows) })),
      },
    } as unknown as SqliteConnectionService;
    const embedder = makeEmbedder(); // plain IEmbedder — no rerank()
    const store: MemoryStore = {
      getById: jest.fn(() => undefined),
      recordHit: jest.fn(),
    } as unknown as MemoryStore;

    const service = new MemorySearchService(
      logger,
      connection,
      embedder,
      store,
    );

    // Should resolve without error (workerClient is null, reranker skipped).
    const result = await service.searchRich('test query', 5);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Porter stemming integration test (skipped without native better-sqlite3)
// ---------------------------------------------------------------------------

describe('MemorySearchService — Porter stemming integration (skipped without native)', () => {
  // Detect whether the native module is available at the current Node ABI.
  // We must actually open a DB because require.resolve only checks the JS
  // shim, not whether the .node binary matches the host runtime ABI.
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? it : it.skip;

  maybe(
    'Porter stemming: chunk containing "configured" matches query "configuring"',
    () => {
      const Database = require('better-sqlite3') as new (file: string) => {
        exec(sql: string): void;
        prepare(sql: string): { all(...args: unknown[]): unknown[] };
        close(): void;
      };
      const db = new Database(':memory:');

      // Create the FTS5 virtual table with the porter tokenizer exactly as
      // migration 0010 defines it.
      db.exec(`
        CREATE TABLE memory_chunks (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          ord INTEGER NOT NULL,
          text TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
          chunk_id UNINDEXED,
          text,
          content='memory_chunks',
          content_rowid='rowid',
          tokenize='porter unicode61'
        );
        INSERT INTO memory_chunks(id, memory_id, ord, text, token_count, created_at)
          VALUES ('ck1', 'mem1', 0, 'the server was configured correctly', 10, 1000000);
        INSERT INTO memory_chunks_fts(rowid, chunk_id, text)
          SELECT rowid, id, text FROM memory_chunks;
      `);

      // Query with a different inflection — "configuring" should stem to
      // "configur" and match the "configured" document token.
      const service = makeService();
      const ftsQuery = escape(service, 'configuring');

      const rows = db
        .prepare(
          `SELECT mc.id FROM memory_chunks_fts fts
           JOIN memory_chunks mc ON mc.rowid = fts.rowid
           WHERE memory_chunks_fts MATCH ?`,
        )
        .all(ftsQuery) as Array<{ id: string }>;

      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].id).toBe('ck1');

      db.close();
    },
  );
});
