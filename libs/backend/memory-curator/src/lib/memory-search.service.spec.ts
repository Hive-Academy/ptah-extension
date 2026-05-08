/**
 * Unit tests for MemorySearchService.
 *
 * Covers `escapeFtsQuery` behaviour (Batch 6 / R2) and a native integration
 * test that verifies Porter stemming end-to-end.  The integration test is
 * skipped when better-sqlite3 is not available (Track 0 constraint).
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { MemoryStore } from './memory.store';
import { MemorySearchService } from './memory-search.service';

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
