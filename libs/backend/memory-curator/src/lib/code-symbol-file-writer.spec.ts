import 'reflect-metadata';
import type {
  IEmbedder,
  SqliteDatabase,
  SqliteStatement,
} from '@ptah-extension/persistence-sqlite';
import { CodeSymbolStore, type CodeSymbolInsert } from './code-symbol.store';
import {
  MAX_SYMBOL_ROWS_PER_TRANSACTION,
  symbolWriteChunks,
} from './code-symbol-file-writer';
import type {
  CuratorLogger,
  SqliteDbProvider,
} from './sqlite-reader-deps.types';

/**
 * fix-10 — bounded symbol writes. These run on a recording stub database so
 * they execute everywhere; the native-gated cases in `code-symbol.store.spec.ts`
 * pin the same contract against real better-sqlite3 where it loads.
 */

interface RecordedRun {
  readonly sql: string;
  readonly args: readonly unknown[];
  /** 1-based transaction the statement ran in; 0 = outside any. */
  readonly txn: number;
}

class RecordingStatement implements SqliteStatement {
  constructor(
    private readonly sql: string,
    private readonly db: RecordingDb,
  ) {}
  run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    this.db.record(this.sql, args);
    return {
      changes: this.sql.startsWith('DELETE') ? 3 : 1,
      lastInsertRowid: 0,
    };
  }
  get(...args: unknown[]): unknown {
    this.db.record(this.sql, args);
    return undefined;
  }
  all(...args: unknown[]): unknown[] {
    this.db.record(this.sql, args);
    return [];
  }
  iterate(): IterableIterator<unknown> {
    return [][Symbol.iterator]();
  }
}

class RecordingDb implements SqliteDatabase {
  readonly runs: RecordedRun[] = [];
  readonly open = true;
  inTransaction = false;
  transactions = 0;
  /** Throw from the upsert of this 0-based row index, if set. */
  failAtUpsert: number | null = null;
  private upserts = 0;

  record(sql: string, args: readonly unknown[]): void {
    if (sql.startsWith('INSERT INTO code_symbols (id')) {
      if (this.upserts === this.failAtUpsert) {
        throw new Error('simulated insert failure');
      }
      this.upserts++;
    }
    this.runs.push({
      sql,
      args,
      txn: this.inTransaction ? this.transactions : 0,
    });
  }
  exec(): unknown {
    return undefined;
  }
  prepare(sql: string): SqliteStatement {
    return new RecordingStatement(sql.trim(), this);
  }
  pragma(): unknown {
    return undefined;
  }
  close(): void {
    return;
  }
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    const wrapped = (...args: unknown[]): unknown => {
      this.transactions++;
      this.inTransaction = true;
      try {
        return fn(...args);
      } finally {
        this.inTransaction = false;
      }
    };
    // The generic return is the caller's own function type; a wrapper with
    // the same parameters and result is that type at runtime.
    return wrapped as T;
  }
}

function makeLogger(): jest.Mocked<CuratorLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const embedder: IEmbedder = {
  dim: 4,
  modelId: 'test',
  embed: (texts) => Promise.resolve(texts.map(() => new Float32Array(4))),
  dispose: () => Promise.resolve(),
};

function makeStore(db: RecordingDb): {
  store: CodeSymbolStore;
  logger: jest.Mocked<CuratorLogger>;
} {
  const connection: SqliteDbProvider = {
    db,
    vecExtensionLoaded: false,
    handleFatalWriteError: () => false,
  };
  const logger = makeLogger();
  const store = new CodeSymbolStore(logger, connection, embedder, {
    available: false,
  });
  return { store, logger };
}

function rows(count: number, file = '/ws/src/big.ts'): CodeSymbolInsert[] {
  return Array.from({ length: count }, (_, i) => ({
    workspaceRoot: '/ws',
    filePath: file,
    kind: 'function',
    symbolName: `fn${i}`,
    subject: `code:${file}#fn${i}`,
    text: `function fn${i}() {}`,
    tokenCount: 4,
  }));
}

const isUpsert = (run: RecordedRun): boolean =>
  run.sql.startsWith('INSERT INTO code_symbols (id');
const isClear = (run: RecordedRun): boolean =>
  run.sql.startsWith('DELETE FROM code_symbols WHERE');

describe('symbolWriteChunks', () => {
  it('always returns one chunk, empty for no rows', () => {
    expect(symbolWriteChunks(0, 3)).toEqual([{ start: 0, end: 0 }]);
  });
  it('covers every row once, in order, bounded by the size', () => {
    expect(symbolWriteChunks(7, 3)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 7 },
    ]);
  });
});

describe('CodeSymbolStore.replaceFileSymbols — bounded transactions', () => {
  it('writes a normal file in ONE transaction, as before', async () => {
    const db = new RecordingDb();
    const { store } = makeStore(db);

    await store.replaceFileSymbols(
      '/ws',
      '/ws/src/a.ts',
      rows(5, '/ws/src/a.ts'),
    );

    expect(db.transactions).toBe(1);
    expect(db.runs.filter(isUpsert)).toHaveLength(5);
  });

  it('splits a large file into bounded transactions with identical writes', async () => {
    const total = MAX_SYMBOL_ROWS_PER_TRANSACTION * 2 + 50;
    const input = rows(total);
    const db = new RecordingDb();
    const { store } = makeStore(db);

    await store.replaceFileSymbols('/ws', '/ws/src/big.ts', input);

    expect(db.transactions).toBe(3);
    const upserts = db.runs.filter(isUpsert);
    // Every row, in input order, with the same column values.
    expect(upserts.map((run) => run.args[0])).toEqual(
      input.map((entry) =>
        expect.objectContaining({
          workspace_root: entry.workspaceRoot,
          file_path: entry.filePath,
          kind: entry.kind,
          symbol_name: entry.symbolName,
          subject: entry.subject,
          text: entry.text,
          token_count: entry.tokenCount,
        }),
      ),
    );
    // One shared timestamp, as in the single-transaction write.
    const stamps = new Set(
      upserts.map((run) => (run.args[0] as { created_at: number }).created_at),
    );
    expect(stamps.size).toBe(1);
    // The old rows are cleared exactly once, in the first transaction.
    expect(db.runs.filter(isClear).map((run) => run.txn)).toEqual([1]);
    // No transaction holds more than the bound.
    for (let txn = 1; txn <= 3; txn++) {
      expect(
        upserts.filter((run) => run.txn === txn).length,
      ).toBeLessThanOrEqual(MAX_SYMBOL_ROWS_PER_TRANSACTION);
    }
  });

  it('hands the event loop a turn between transactions', async () => {
    const db = new RecordingDb();
    const { store } = makeStore(db);
    const txnAtImmediate: number[] = [];
    setImmediate(() => txnAtImmediate.push(db.transactions));

    await store.replaceFileSymbols(
      '/ws',
      '/ws/src/big.ts',
      rows(MAX_SYMBOL_ROWS_PER_TRANSACTION + 1),
    );

    // Our macrotask ran after the first transaction and before the second.
    expect(txnAtImmediate).toEqual([1]);
    expect(db.transactions).toBe(2);
  });

  it('removes the partial rows and rethrows when a later chunk fails', async () => {
    const db = new RecordingDb();
    db.failAtUpsert = MAX_SYMBOL_ROWS_PER_TRANSACTION + 10;
    const { store } = makeStore(db);

    await expect(
      store.replaceFileSymbols(
        '/ws',
        '/ws/src/big.ts',
        rows(MAX_SYMBOL_ROWS_PER_TRANSACTION * 2),
      ),
    ).rejects.toThrow(/simulated insert failure/);

    // First transaction cleared + wrote; the failed second rolled back; a
    // third transaction cleared the file again.
    expect(db.runs.filter(isClear).map((run) => run.txn)).toEqual([1, 3]);
  });

  it('serialises two replaces of the same file so chunks never interleave', async () => {
    const db = new RecordingDb();
    const { store } = makeStore(db);
    const big = rows(MAX_SYMBOL_ROWS_PER_TRANSACTION * 2);
    const small = rows(1);

    await Promise.all([
      store.replaceFileSymbols('/ws', '/ws/src/big.ts', big),
      store.replaceFileSymbols('/ws', '/ws/src/big.ts', small),
    ]);

    // Big: clear in txn 1, rows in 1-2. Small: its own clear in txn 3.
    expect(db.runs.filter(isClear).map((run) => run.txn)).toEqual([1, 3]);
    expect(db.transactions).toBe(3);
  });
});
