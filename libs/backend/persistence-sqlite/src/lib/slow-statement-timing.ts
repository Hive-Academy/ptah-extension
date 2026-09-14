/**
 * Slow-statement timing for the shared SQLite handle (TASK_2026_437, C13).
 *
 * better-sqlite3 is synchronous and runs on the host's main thread, so every
 * statement is a stretch of time the event loop cannot service anything else.
 * Whether that time contributes to the measured lag (session:validate 4.7 s,
 * chat:continue 8.6 s) has never been measured. This wrapper measures it before
 * anyone moves a store to a worker: any call at or above
 * `PTAH_SQLITE_SLOW_WARN_MS` (default 50) logs one `[SQLite] slow statement`
 * line naming the SQL, the operation, the rows and the duration.
 *
 * Contract:
 *  - Never alters a result or an exception. Every call is forwarded to the
 *    real object with the caller's own `arguments`; timing happens in a
 *    `finally`, and a throwing logger is swallowed.
 *  - The fast path is two clock reads and one comparison. Below the threshold
 *    nothing is logged and the rate-limit table is not touched.
 *  - At most one line per SQL text per `rateWindowMs` (default 60 s). Repeats
 *    inside the window are counted and reported on the next line as
 *    `suppressedSinceLastLog`, so a hot slow query stays visible without
 *    flooding the log.
 *
 * Members other than the timed ones are forwarded bound to the real object —
 * better-sqlite3's native methods brand-check their receiver and throw
 * "Illegal invocation" when called with a Proxy as `this`.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import { roundMs } from '@ptah-extension/vscode-core';
import type {
  SqliteDatabase,
  SqliteStatement,
} from './sqlite-connection.service';

export const SQLITE_SLOW_WARN_MS_ENV = 'PTAH_SQLITE_SLOW_WARN_MS';

/**
 * 50 ms — the long-task bar. A synchronous block that long already drops a
 * frame on the Electron host, while an indexed statement on `ptah.db` finishes
 * in well under a millisecond, so anything over it is a real signal.
 */
export const DEFAULT_SQLITE_SLOW_WARN_MS = 50;

/** One line per SQL text per minute — the cap from implementation-plan C13. */
export const DEFAULT_SQLITE_SLOW_RATE_WINDOW_MS = 60_000;

/** How much SQL text a log line carries. */
const SQL_PREVIEW_CHARS = 120;

/**
 * Upper bound on distinct SQL texts remembered for rate limiting. Dynamic SQL
 * (an `IN (?, ?, …)` list built per call) would otherwise grow the table
 * without limit. At the cap only the entry slow least recently is evicted, so
 * every other key keeps its `suppressedSinceLastLog` count; eviction can only
 * permit an extra line, never hide one.
 */
export const SQLITE_SLOW_RATE_TABLE_MAX_ENTRIES = 256;

export type SlowStatementOperation =
  | 'run'
  | 'get'
  | 'all'
  | 'iterate'
  | 'exec'
  | 'pragma'
  | 'transaction';

export interface SlowStatementTimingOptions {
  readonly logger: Logger;
  /** Log at or above this many milliseconds. */
  readonly thresholdMs: number;
  /** Minimum gap between two lines for the same SQL text. */
  readonly rateWindowMs?: number;
  /** Monotonic millisecond clock. Test seam; defaults to `performance.now`. */
  readonly now?: () => number;
}

type AnyFn = (...args: unknown[]) => unknown;

interface RateEntry {
  lastLoggedAt: number;
  suppressed: number;
}

/**
 * Times forwarded calls and decides whether a slow one may log. One instance
 * per wrapped database, so a single rate-limit table spans the database and
 * every statement it prepared.
 */
class SlowStatementReporter {
  private readonly rateTable = new Map<string, RateEntry>();

  constructor(
    private readonly logger: Logger,
    private readonly thresholdMs: number,
    private readonly rateWindowMs: number,
    readonly now: () => number,
  ) {}

  /**
   * Call `method` on `receiver` with `args` and time it. The result and any
   * exception pass through untouched.
   */
  invoke(
    key: string,
    op: SlowStatementOperation,
    method: AnyFn,
    receiver: unknown,
    args: ArrayLike<unknown>,
  ): unknown {
    const startedAt = this.now();
    let result: unknown;
    let failed = true;
    try {
      result = Reflect.apply(method, receiver, args);
      failed = false;
      return result;
    } finally {
      this.settle(key, op, this.now() - startedAt, result, failed);
    }
  }

  /** Report `durationMs` if it crossed the threshold. Cheap below it. */
  settle(
    key: string,
    op: SlowStatementOperation,
    durationMs: number,
    result: unknown,
    failed: boolean,
    rows?: number,
  ): void {
    if (durationMs < this.thresholdMs) return;
    this.report(
      key,
      op,
      durationMs,
      rows ?? (failed ? undefined : rowsOf(op, result)),
      failed,
    );
  }

  private report(
    key: string,
    op: SlowStatementOperation,
    durationMs: number,
    rows: number | undefined,
    failed: boolean,
  ): void {
    const at = this.now();
    const entry = this.rateTable.get(key);
    // Delete-then-set moves the key to the end of Map insertion order on every
    // slow hit, so the first key is always the one slow least recently.
    this.rateTable.delete(key);
    if (entry && at - entry.lastLoggedAt < this.rateWindowMs) {
      entry.suppressed++;
      this.rateTable.set(key, entry);
      return;
    }
    const suppressedSinceLastLog = entry?.suppressed ?? 0;
    if (this.rateTable.size >= SQLITE_SLOW_RATE_TABLE_MAX_ENTRIES) {
      const oldest = this.rateTable.keys().next();
      if (!oldest.done) this.rateTable.delete(oldest.value);
    }
    this.rateTable.set(key, { lastLoggedAt: at, suppressed: 0 });
    try {
      this.logger.warn('[SQLite] slow statement', {
        sql: key.slice(0, SQL_PREVIEW_CHARS),
        op,
        durationMs: roundMs(durationMs),
        rows,
        failed,
        suppressedSinceLastLog,
      });
    } catch {
      // A diagnostics line must never turn a successful statement into a
      // failure, or replace the statement's own exception with the logger's.
    }
  }
}

/** Row count a finished call returned or changed, for attribution. */
function rowsOf(
  op: SlowStatementOperation,
  result: unknown,
): number | undefined {
  switch (op) {
    case 'all':
      return Array.isArray(result) ? result.length : undefined;
    case 'get':
      return result === undefined ? 0 : 1;
    case 'run': {
      const changes = (result as { changes?: unknown } | undefined)?.changes;
      return typeof changes === 'number' ? changes : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * `iterate()` does no work until the caller pulls rows, so timing the call
 * alone would always read ~0. Time every `next()` and report the accumulated
 * total once — when the iterator is exhausted, closed early, or throws.
 */
function timeIterator(
  reporter: SlowStatementReporter,
  sql: string,
  inner: IterableIterator<unknown>,
  initialMs: number,
): IterableIterator<unknown> {
  let totalMs = initialMs;
  let rows = 0;
  let finished = false;
  const finish = (failed: boolean): void => {
    if (finished) return;
    finished = true;
    reporter.settle(sql, 'iterate', totalMs, undefined, failed, rows);
  };
  const wrapped: IterableIterator<unknown> = {
    next() {
      const startedAt = reporter.now();
      let step: IteratorResult<unknown>;
      try {
        step = inner.next();
      } catch (error: unknown) {
        totalMs += reporter.now() - startedAt;
        finish(true);
        throw error;
      }
      totalMs += reporter.now() - startedAt;
      if (step.done) finish(false);
      else rows++;
      return step;
    },
    return(value?: unknown) {
      finish(false);
      return inner.return
        ? inner.return(value)
        : { done: true as const, value };
    },
    [Symbol.iterator]() {
      return wrapped;
    },
  };
  return wrapped;
}

/** Proxy a prepared statement so `run/get/all/iterate` are timed. */
function wrapStatement(
  reporter: SlowStatementReporter,
  sql: string,
  statement: SqliteStatement,
): SqliteStatement {
  const methods = new Map<PropertyKey, unknown>();
  const proxy: SqliteStatement = new Proxy(statement, {
    get(target, prop) {
      const cached = methods.get(prop);
      if (cached !== undefined) return cached;
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const method = value as AnyFn;
      let forwarded: AnyFn;
      if (prop === 'run' || prop === 'get' || prop === 'all') {
        const op: SlowStatementOperation = prop;
        forwarded = function timedStatementCall() {
          // eslint-disable-next-line prefer-rest-params -- forwarding `arguments` avoids a rest-array allocation per call
          return reporter.invoke(sql, op, method, target, arguments);
        };
      } else if (prop === 'iterate') {
        forwarded = (...args: unknown[]) => {
          const startedAt = reporter.now();
          let inner: IterableIterator<unknown>;
          try {
            inner = Reflect.apply(
              method,
              target,
              args,
            ) as IterableIterator<unknown>;
          } catch (error: unknown) {
            reporter.settle(
              sql,
              'iterate',
              reporter.now() - startedAt,
              undefined,
              true,
            );
            throw error;
          }
          return timeIterator(reporter, sql, inner, reporter.now() - startedAt);
        };
      } else {
        // pluck/raw/expand/bind/safeIntegers return the statement itself for
        // chaining; hand back the proxy so the chained call stays timed.
        forwarded = (...args: unknown[]) => {
          const out: unknown = Reflect.apply(method, target, args);
          return out === target ? proxy : out;
        };
      }
      methods.set(prop, forwarded);
      return forwarded;
    },
  });
  return proxy;
}

/**
 * A better-sqlite3 transaction function carries `deferred` / `immediate` /
 * `exclusive` variants. Each is timed under the same key; the timed span
 * includes BEGIN and COMMIT, which is the whole synchronous block the caller
 * sees. The caller's `this` is forwarded, as better-sqlite3 does.
 */
function wrapTransaction<T extends AnyFn>(
  reporter: SlowStatementReporter,
  fn: T,
  transaction: T,
): T {
  const key = `<transaction ${fn.name || 'anonymous'}>`;
  const timeVariant = (inner: AnyFn): AnyFn =>
    function timedTransaction(this: unknown) {
      // eslint-disable-next-line prefer-rest-params -- forward the caller's arguments unchanged
      return reporter.invoke(key, 'transaction', inner, this, arguments);
    };
  const timed = timeVariant(transaction);
  for (const variant of ['deferred', 'immediate', 'exclusive'] as const) {
    const inner = (transaction as unknown as Record<string, unknown>)[variant];
    if (typeof inner === 'function') {
      Object.defineProperty(timed, variant, {
        value: timeVariant(inner as AnyFn),
        enumerable: true,
      });
    }
  }
  return timed as T;
}

/**
 * Return a view of `db` whose prepared statements, `exec`, `pragma` and
 * transaction functions are timed. Every other member is forwarded to `db`.
 */
export function withSlowStatementTiming(
  db: SqliteDatabase,
  options: SlowStatementTimingOptions,
): SqliteDatabase {
  const reporter = new SlowStatementReporter(
    options.logger,
    options.thresholdMs,
    options.rateWindowMs ?? DEFAULT_SQLITE_SLOW_RATE_WINDOW_MS,
    options.now ?? (() => performance.now()),
  );
  const methods = new Map<PropertyKey, unknown>();

  return new Proxy(db, {
    get(target, prop) {
      const cached = methods.get(prop);
      if (cached !== undefined) return cached;
      const value: unknown = Reflect.get(target, prop, target);
      // `open` / `inTransaction` are live getters — never cache a non-function.
      if (typeof value !== 'function') return value;
      const method = value as AnyFn;
      let forwarded: AnyFn;
      if (prop === 'prepare') {
        forwarded = (...args: unknown[]) =>
          wrapStatement(
            reporter,
            String(args[0]),
            Reflect.apply(method, target, args) as SqliteStatement,
          );
      } else if (prop === 'exec' || prop === 'pragma') {
        const op: SlowStatementOperation = prop;
        forwarded = function timedDatabaseCall() {
          // eslint-disable-next-line prefer-rest-params -- forwarding `arguments` avoids a rest-array allocation per call
          const args = arguments;
          return reporter.invoke(String(args[0]), op, method, target, args);
        };
      } else if (prop === 'transaction') {
        forwarded = (...args: unknown[]) =>
          wrapTransaction(
            reporter,
            args[0] as AnyFn,
            Reflect.apply(method, target, args) as AnyFn,
          );
      } else {
        forwarded = method.bind(target);
      }
      methods.set(prop, forwarded);
      return forwarded;
    },
  });
}
