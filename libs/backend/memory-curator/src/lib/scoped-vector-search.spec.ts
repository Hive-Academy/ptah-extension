import type { SqliteDatabase, SqliteStatement } from '@ptah-extension/persistence-sqlite';
import { MAX_SCOPED_VECTOR_CANDIDATES, scopedVectorCandidates } from './scoped-vector-search';
import type { CuratorLogger } from './sqlite-reader-deps.types';

let nativeAvailable = false;
try {
  const Database = require('better-sqlite3');
  const sqliteVec = require('sqlite-vec');
  const probe = new Database(':memory:');
  sqliteVec.load(probe);
  probe.close();
  nativeAvailable = true;
} catch {
  // degradation-audit: optional-capability - Electron ABI may differ from Jest's Node ABI.
}

type AllFn = (...params: unknown[]) => unknown[];

/** A connection whose every statement answers with `all`, recording its SQL. */
function fakeConnection(all: AllFn, sql: string[] = []): { db: SqliteDatabase } {
  const statement: SqliteStatement = {
    all,
    get: () => undefined,
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    iterate: () => [][Symbol.iterator](),
  };
  const db: SqliteDatabase = {
    exec: () => undefined,
    prepare: (text: string) => {
      sql.push(text);
      return statement;
    },
    pragma: () => undefined,
    close: () => undefined,
    open: true,
    inTransaction: false,
    transaction: (fn) => fn,
  };
  return { db };
}

function makeLogger(): jest.Mocked<Pick<CuratorLogger, 'debug'>> {
  return { debug: jest.fn() };
}

/** One answer row as the single-pass statement returns it. */
function answerRows(inspected: number, hits: ReadonlyArray<{ rowid: number; distance: number }>): unknown[] {
  if (hits.length === 0) return [{ inspected, rowid: null, distance: null }];
  return hits.map((hit) => ({ inspected, ...hit }));
}

describe('scopedVectorCandidates', () => {
  it('runs exactly one KNN pass, at the cap, per search', () => {
    const requested: number[] = [];
    const sql: string[] = [];
    const connection = fakeConnection((...params) => {
      requested.push(Number(params[1]));
      const target = Number(params.at(-1));
      const hits = Array.from({ length: Math.floor(MAX_SCOPED_VECTOR_CANDIDATES * 0.05) }, (_, i) => ({ rowid: i + 1, distance: i }));
      return answerRows(MAX_SCOPED_VECTOR_CANDIDATES, hits.slice(0, target));
    }, sql);
    const logger = makeLogger();
    const rows = scopedVectorCandidates(
      connection, 'code_symbols_vec', Buffer.alloc(16), 20,
      'JOIN code_symbols cs ON cs.rowid = candidates.rowid',
      'cs.workspace_root = ?', ['/small'], logger,
    );
    expect(rows).toHaveLength(20);
    expect(rows[0]).toEqual({ rowid: 1, distance: 0 });
    expect(requested).toEqual([MAX_SCOPED_VECTOR_CANDIDATES]);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('embedding MATCH ? AND k = ?');
    expect(sql[0]).not.toContain('vec_distance_l2');
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('does not widen or re-query when the scope is rare', () => {
    const requested: number[] = [];
    const connection = fakeConnection((...params) => {
      requested.push(Number(params[1]));
      return answerRows(MAX_SCOPED_VECTOR_CANDIDATES, []);
    });
    expect(scopedVectorCandidates(connection, 'memory_chunks_vec', Buffer.alloc(16), 100,
      'JOIN memories m ON m.rowid = candidates.rowid', 'm.workspace_root = ?', ['/rare'], makeLogger())).toEqual([]);
    expect(requested).toEqual([MAX_SCOPED_VECTOR_CANDIDATES]);
  });

  it('treats a KNN shorter than the cap as an exhausted table: exact, nothing logged', () => {
    const connection = fakeConnection(() => answerRows(300, [{ rowid: 4, distance: 0.2 }]));
    const logger = makeLogger();
    expect(scopedVectorCandidates(connection, 'memory_chunks_vec', Buffer.alloc(16), 20,
      'JOIN memories m ON m.rowid = candidates.rowid', 'm.workspace_root IS ?', ['/exhausted'], logger))
      .toEqual([{ rowid: 4, distance: 0.2 }]);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('returns partial hits at the cap and logs the shortfall once per scope', () => {
    const connection = fakeConnection(() => answerRows(MAX_SCOPED_VECTOR_CANDIDATES, [
      { rowid: 7, distance: 0.1 },
      { rowid: 9, distance: 0.4 },
    ]));
    const logger = makeLogger();
    const search = (scope: string) => scopedVectorCandidates(
      connection, 'memory_chunks_vec', Buffer.alloc(16), 20,
      'JOIN memories m ON m.rowid = candidates.rowid', 'm.workspace_root IS ?', [scope], logger,
    );

    expect(search('/tiny-share')).toEqual([
      { rowid: 7, distance: 0.1 },
      { rowid: 9, distance: 0.4 },
    ]);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('candidate cap'),
      {
        table: 'memory_chunks_vec',
        scopedHits: 2,
        requested: 20,
        candidatesInspected: MAX_SCOPED_VECTOR_CANDIDATES,
      },
    );

    search('/tiny-share');
    expect(logger.debug).toHaveBeenCalledTimes(1);

    search('/another-tiny-share');
    expect(logger.debug).toHaveBeenCalledTimes(2);
  });
});

(nativeAvailable ? describe : describe.skip)('scopedVectorCandidates native recall', () => {
  it('keeps 50k-row, 5% workspace recall within the candidate cap', () => {
    const Database = require('better-sqlite3');
    const sqliteVec = require('sqlite-vec');
    const db = new Database(':memory:');
    try {
      sqliteVec.load(db);
      db.exec('CREATE TABLE code_symbols (workspace_root TEXT NOT NULL); CREATE VIRTUAL TABLE code_symbols_vec USING vec0(embedding float[1])');
      const insert = db.prepare('INSERT INTO code_symbols (workspace_root) VALUES (?)');
      const insertVec = db.prepare('INSERT INTO code_symbols_vec (rowid, embedding) VALUES (?, ?)');
      db.transaction(() => {
        for (let i = 0; i < 50_000; i++) {
          const rowid = insert.run(i % 20 === 0 ? '/target' : '/other').lastInsertRowid;
          // vec0 rejects a REAL rowid; bind it as an integer.
          insertVec.run(BigInt(rowid), Buffer.from(new Float32Array([i]).buffer));
        }
      })();
      const embedding = Buffer.from(new Float32Array([0]).buffer);
      const actual = scopedVectorCandidates({ db }, 'code_symbols_vec', embedding, 20,
        'JOIN code_symbols cs ON cs.rowid = candidates.rowid', 'cs.workspace_root = ?', ['/target'], makeLogger());
      const exact = db.prepare(`SELECT v.rowid AS rowid FROM code_symbols_vec v
        JOIN code_symbols cs ON cs.rowid = v.rowid WHERE cs.workspace_root = ?
        ORDER BY vec_distance_l2(v.embedding, ?) LIMIT 20`).all('/target', embedding) as Array<{ rowid: number }>;
      expect(actual.map((row) => row.rowid)).toEqual(exact.map((row) => row.rowid));
    } finally {
      db.close();
    }
  });

  it('answers an empty scope with no rows and a small table exactly', () => {
    const Database = require('better-sqlite3');
    const sqliteVec = require('sqlite-vec');
    const db = new Database(':memory:');
    try {
      sqliteVec.load(db);
      db.exec('CREATE TABLE code_symbols (workspace_root TEXT NOT NULL); CREATE VIRTUAL TABLE code_symbols_vec USING vec0(embedding float[1])');
      const insert = db.prepare('INSERT INTO code_symbols (workspace_root) VALUES (?)');
      const insertVec = db.prepare('INSERT INTO code_symbols_vec (rowid, embedding) VALUES (?, ?)');
      for (let i = 0; i < 50; i++) {
        const rowid = insert.run(i % 2 === 0 ? '/even' : '/odd').lastInsertRowid;
        insertVec.run(BigInt(rowid), Buffer.from(new Float32Array([i]).buffer));
      }
      const embedding = Buffer.from(new Float32Array([0]).buffer);
      const logger = makeLogger();
      const search = (scope: string) => scopedVectorCandidates({ db }, 'code_symbols_vec', embedding, 100,
        'JOIN code_symbols cs ON cs.rowid = candidates.rowid', 'cs.workspace_root = ?', [scope], logger);
      expect(search('/none')).toEqual([]);
      const even = search('/even');
      expect(even).toHaveLength(25);
      expect(even[0]).toEqual({ rowid: 1, distance: 0 });
      // 50 vectors < the cap: the table was exhausted, so no shortfall is logged.
      expect(logger.debug).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
