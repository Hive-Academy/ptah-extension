/**
 * Unit tests for the slow-statement timing wrapper (TASK_2026_437, C13).
 *
 * A manual clock drives every duration, so thresholds and rate-limit windows
 * are asserted exactly rather than by racing a real machine. The fake database
 * and statement use `#private` fields: like better-sqlite3's native methods,
 * they throw when called with a Proxy as `this`, which pins the "forward bound
 * to the real object" rule.
 */
import 'reflect-metadata';
import {
  withSlowStatementTiming,
  DEFAULT_SQLITE_SLOW_RATE_WINDOW_MS,
  SQLITE_SLOW_RATE_TABLE_MAX_ENTRIES,
} from './slow-statement-timing';
import type {
  SqliteDatabase,
  SqliteStatement,
} from './sqlite-connection.service';
import { createMockLogger, type MockLogger } from './testing/mock-logger';

class ManualClock {
  value = 1_000;
  reads = 0;
  readonly now = (): number => {
    this.reads++;
    return this.value;
  };
  advance(ms: number): void {
    this.value += ms;
  }
}

class BrandedStatement {
  readonly #sql: string;
  constructor(
    sql: string,
    private readonly clock: ManualClock,
    private readonly costMs: () => number,
    private readonly rows: unknown[],
  ) {
    this.#sql = sql;
  }
  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    this.clock.advance(this.costMs());
    if (this.#sql.startsWith('FAIL')) throw new Error(`boom:${params.join()}`);
    return { changes: params.length, lastInsertRowid: 7 };
  }
  get(...params: unknown[]): unknown {
    this.clock.advance(this.costMs());
    return params[0] === 'missing' ? undefined : { sql: this.#sql, params };
  }
  all(): unknown[] {
    this.clock.advance(this.costMs());
    return [...this.rows];
  }
  *iterate(): IterableIterator<unknown> {
    for (const row of this.rows) {
      this.clock.advance(this.costMs());
      yield row;
    }
    void this.#sql;
  }
  pluck(): this {
    void this.#sql;
    return this;
  }
}

class BrandedDatabase {
  readonly #secret = 'native';
  opened = true;
  readonly statements: BrandedStatement[] = [];
  transactionThis: unknown;
  costMs = 1;
  rows: unknown[] = [{ id: 1 }, { id: 2 }, { id: 3 }];

  constructor(private readonly clock: ManualClock) {}

  get open(): boolean {
    return this.opened;
  }
  get inTransaction(): boolean {
    return false;
  }
  prepare(sql: string): SqliteStatement {
    void this.#secret;
    const stmt = new BrandedStatement(
      sql,
      this.clock,
      () => this.costMs,
      this.rows,
    );
    this.statements.push(stmt);
    return stmt as unknown as SqliteStatement;
  }
  exec(sql: string): unknown {
    this.clock.advance(this.costMs);
    return `${this.#secret}:${sql}`;
  }
  pragma(pragma: string): unknown {
    this.clock.advance(this.costMs);
    return pragma;
  }
  secret(): string {
    return this.#secret;
  }
  close(): void {
    this.opened = false;
  }
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    void this.#secret;
    const run = (mode: string) =>
      function (this: unknown, ...args: unknown[]): unknown {
        return `${mode}:${String(fn.apply(this, args))}`;
      };
    return Object.assign(run('default'), {
      deferred: run('deferred'),
      immediate: run('immediate'),
      exclusive: run('exclusive'),
    }) as unknown as T;
  }
}

function setup(thresholdMs = 50): {
  clock: ManualClock;
  real: BrandedDatabase;
  db: SqliteDatabase;
  logger: MockLogger;
} {
  const clock = new ManualClock();
  const real = new BrandedDatabase(clock);
  const logger = createMockLogger();
  const db = withSlowStatementTiming(real as unknown as SqliteDatabase, {
    logger,
    thresholdMs,
    now: clock.now,
  });
  return { clock, real, db, logger };
}

const slowLines = (logger: MockLogger) =>
  logger.entries.filter((e) => e.message === '[SQLite] slow statement');

describe('withSlowStatementTiming', () => {
  it('forwards results and arguments unchanged and logs nothing below the threshold', () => {
    const { db, logger } = setup();

    const stmt = db.prepare('SELECT * FROM t WHERE id = ?');
    expect(stmt.run(1, 2)).toEqual({ changes: 2, lastInsertRowid: 7 });
    expect(stmt.get('a')).toEqual({
      sql: 'SELECT * FROM t WHERE id = ?',
      params: ['a'],
    });
    expect(stmt.all()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect([...stmt.iterate()]).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(db.exec('CREATE TABLE x (a)')).toBe('native:CREATE TABLE x (a)');

    expect(slowLines(logger)).toHaveLength(0);
  });

  it('costs exactly two clock reads per fast call and never consults the rate table', () => {
    const { db, clock, logger } = setup();
    const stmt = db.prepare('SELECT 1');
    clock.reads = 0;

    for (let i = 0; i < 1_000; i++) stmt.get(i);

    // Two reads per call: start and end. `report()` would add a third.
    expect(clock.reads).toBe(2_000);
    expect(logger.entries.filter((e) => e.level === 'warn')).toHaveLength(0);
  });

  it('logs SQL (first 120 chars), op, rows and duration at or above the threshold', () => {
    const { db, real, logger } = setup(50);
    real.costMs = 50;
    const longSql = `SELECT ${'x, '.repeat(80)}y FROM t`;

    db.prepare(longSql).all();

    const lines = slowLines(logger);
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
    expect(lines[0].context).toEqual({
      sql: longSql.slice(0, 120),
      op: 'all',
      durationMs: 50,
      rows: 3,
      failed: false,
      suppressedSinceLastLog: 0,
    });
  });

  it('reports changes for run and 0/1 rows for get', () => {
    const { db, real, logger } = setup(10);
    real.costMs = 20;

    db.prepare('UPDATE a SET b = ?').run(1, 2, 3);
    db.prepare('SELECT b FROM a WHERE id = ?').get('missing');

    expect(slowLines(logger).map((l) => l.context)).toEqual([
      expect.objectContaining({ op: 'run', rows: 3 }),
      expect.objectContaining({ op: 'get', rows: 0 }),
    ]);
  });

  it('emits at most one line per SQL text per window and counts the suppressed repeats', () => {
    const { db, real, clock, logger } = setup(50);
    real.costMs = 80;
    const stmt = db.prepare('SELECT slow');

    stmt.all();
    stmt.all();
    db.prepare('SELECT slow').all(); // same text, different statement object
    db.prepare('SELECT other').all(); // different text — its own budget
    expect(slowLines(logger)).toHaveLength(2);

    clock.advance(DEFAULT_SQLITE_SLOW_RATE_WINDOW_MS);
    stmt.all();

    const lines = slowLines(logger);
    expect(lines).toHaveLength(3);
    expect(lines[2].context).toEqual(
      expect.objectContaining({
        sql: 'SELECT slow',
        suppressedSinceLastLog: 2,
      }),
    );
  });

  it('rethrows the original exception and marks a slow failure', () => {
    const { db, real, logger } = setup(50);
    real.costMs = 60;
    const stmt = db.prepare('FAIL INSERT');

    let thrown: unknown;
    try {
      stmt.run('p');
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('boom:p');
    expect(slowLines(logger)[0].context).toEqual(
      expect.objectContaining({ op: 'run', failed: true, rows: undefined }),
    );
  });

  it('evicts only the least recently slow SQL text at the cap, keeping other suppression counts', () => {
    const { db, real, clock, logger } = setup(50);
    real.costMs = 60;
    const quiet = db.prepare('SELECT quiet');
    const kept = db.prepare('SELECT kept');

    quiet.all(); // logged, then never slow again — the eviction candidate
    kept.all(); // logged
    kept.all(); // suppressed x1
    // Fill the table to the cap: the last filler evicts 'SELECT quiet'.
    for (let i = 0; i < SQLITE_SLOW_RATE_TABLE_MAX_ENTRIES - 1; i++) {
      db.prepare(`SELECT filler_${i}`).all();
    }
    kept.all(); // suppressed x2 — a suppressed hit also refreshes recency

    // 'SELECT quiet' was evicted, so it logs again inside the window.
    quiet.all();
    expect(slowLines(logger).at(-1)?.context).toEqual(
      expect.objectContaining({
        sql: 'SELECT quiet',
        suppressedSinceLastLog: 0,
      }),
    );

    // 'SELECT kept' survived both evictions with its count intact. A full
    // `Map.clear()` at the cap would have reset it to 0.
    clock.advance(DEFAULT_SQLITE_SLOW_RATE_WINDOW_MS);
    kept.all();
    expect(slowLines(logger).at(-1)?.context).toEqual(
      expect.objectContaining({
        sql: 'SELECT kept',
        suppressedSinceLastLog: 2,
      }),
    );
  });

  it('never lets a throwing logger break a statement', () => {
    const { db, real, logger } = setup(50);
    real.costMs = 60;
    logger.warn = () => {
      throw new Error('logger down');
    };

    expect(db.prepare('SELECT 1').get('a')).toEqual({
      sql: 'SELECT 1',
      params: ['a'],
    });
  });

  it('times transaction functions and their variants, forwarding this and arguments', () => {
    const { db, clock, logger } = setup(50);
    const receiver = { tag: 'r' };
    const txn = db.transaction(function importRows(
      this: unknown,
      ...args: unknown[]
    ) {
      clock.advance(75);
      return `${(this as { tag: string }).tag}:${args.join('+')}`;
    });

    expect(txn.call(receiver, 1, 2)).toBe('default:r:1+2');
    clock.advance(DEFAULT_SQLITE_SLOW_RATE_WINDOW_MS);
    const immediate = (
      txn as unknown as Record<string, (...a: unknown[]) => unknown>
    )['immediate'];
    expect(immediate.call(receiver, 3)).toBe('immediate:r:3');

    expect(slowLines(logger).map((l) => l.context)).toEqual([
      expect.objectContaining({
        sql: '<transaction importRows>',
        op: 'transaction',
        durationMs: 75,
      }),
      expect.objectContaining({
        sql: '<transaction importRows>',
        op: 'transaction',
        durationMs: 75,
      }),
    ]);
  });

  it('accumulates iterate() time across rows and reports once when exhausted', () => {
    const { db, real, logger } = setup(50);
    real.costMs = 20; // 3 rows x 20 ms — no single step crosses 50 ms

    const seen = [...db.prepare('SELECT id FROM big').iterate()];

    expect(seen).toHaveLength(3);
    expect(slowLines(logger)).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          op: 'iterate',
          rows: 3,
          durationMs: 60,
        }),
      }),
    ]);
  });

  it('reports an iterate() closed early by break', () => {
    const { db, real, logger } = setup(30);
    real.costMs = 20;

    for (const row of db.prepare('SELECT id FROM big').iterate()) {
      if ((row as { id: number }).id === 2) break;
    }

    expect(slowLines(logger).map((l) => l.context)).toEqual([
      expect.objectContaining({ op: 'iterate', rows: 2, durationMs: 40 }),
    ]);
  });

  it('forwards untimed members bound to the real object and keeps getters live', () => {
    const { db, real } = setup();
    const wrapped = db as unknown as BrandedDatabase;

    expect(wrapped.secret()).toBe('native');
    expect(db.open).toBe(true);
    db.close();
    expect(real.opened).toBe(false);
    expect(db.open).toBe(false);
  });

  it('returns the timed statement from chaining calls such as pluck()', () => {
    const { db, real, logger } = setup(50);
    real.costMs = 55;
    const stmt = db.prepare('SELECT v FROM kv') as unknown as BrandedStatement;

    const chained = stmt.pluck();
    expect(chained).toBe(stmt);
    chained.all();

    expect(slowLines(logger)).toHaveLength(1);
  });
});
