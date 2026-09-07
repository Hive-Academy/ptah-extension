/**
 * IntegrityCheckStateStore specs (TASK_2026_380 B1).
 *
 * The store is driven against a STUB connection rather than a real database,
 * because what is being pinned here is the DEGRADE DIRECTION, not the SQL —
 * the SQL is pinned by `0042_db_integrity_check_state.spec.ts` against the real
 * schema lineage. The two properties that matter:
 *
 *   - a read that throws returns `null`, i.e. "never checked", i.e. DUE. A
 *     store that let the throw escape would take down whatever called it, and
 *     one that answered with a fabricated fresh record would SKIP a due check.
 *   - a write that throws is swallowed with a warn. A failed write costs one
 *     extra check in the next window; a thrown write would reject a dispatch
 *     that already did its work.
 *
 * `connection.db` throwing is not hypothetical: it throws
 * `RpcUserError('PERSISTENCE_UNAVAILABLE')` whenever the database is not open,
 * which is exactly the state a host is in while it is shutting down — the
 * moment an out-of-band worker is most likely to report back.
 */
import 'reflect-metadata';
import { createMockLogger } from '../testing/mock-logger';
import {
  IntegrityCheckStateStore,
  type IntegrityCheckState,
} from './integrity-check-state.store';
import type { SqliteConnectionService } from '../sqlite-connection.service';

interface StatementStub {
  get: jest.Mock;
  run: jest.Mock;
}

function makeStore(opts: {
  get?: () => unknown;
  run?: (...args: unknown[]) => unknown;
  dbThrows?: Error;
}): {
  store: IntegrityCheckStateStore;
  logger: ReturnType<typeof createMockLogger>;
  statement: StatementStub;
  prepare: jest.Mock;
} {
  const logger = createMockLogger();
  const statement: StatementStub = {
    get: jest.fn(opts.get ?? (() => undefined)),
    run: jest.fn(opts.run ?? (() => undefined)),
  };
  const prepare = jest.fn(() => statement);
  const connection = {
    get db() {
      if (opts.dbThrows) throw opts.dbThrows;
      return { prepare } as unknown;
    },
  } as unknown as SqliteConnectionService;
  return {
    store: new IntegrityCheckStateStore(logger, connection),
    logger,
    statement,
    prepare,
  };
}

const CLEAN_STATE: IntegrityCheckState = {
  checkedAt: 1_788_621_559_007,
  quickCheckOk: true,
  foreignKeyViolations: 0,
  durationMs: 1868,
  pageCount: 256_183,
  detail: null,
};

describe('IntegrityCheckStateStore.read', () => {
  it('returns null when there is no row (never checked)', () => {
    const { store } = makeStore({ get: () => undefined });
    expect(store.read()).toBeNull();
  });

  it('maps the raw row, decoding quick_check_ok as a boolean', () => {
    const { store } = makeStore({
      get: () => ({
        checked_at: 1_788_621_559_007,
        quick_check_ok: 1,
        foreign_key_violations: 0,
        duration_ms: 1868,
        page_count: 256_183,
        detail: null,
      }),
    });
    expect(store.read()).toEqual(CLEAN_STATE);
  });

  it('decodes quick_check_ok = 0 as a FAILED verdict, not a missing one', () => {
    // The service treats "last verdict was not ok" as due. Collapsing 0 into
    // `null` here would make a corrupt database look merely unchecked and then
    // look fresh again the moment a row existed.
    const { store } = makeStore({
      get: () => ({
        checked_at: 5,
        quick_check_ok: 0,
        foreign_key_violations: 3,
        duration_ms: 42,
        page_count: 7,
        detail: 'page 12 is corrupt',
      }),
    });
    expect(store.read()).toEqual({
      checkedAt: 5,
      quickCheckOk: false,
      foreignKeyViolations: 3,
      durationMs: 42,
      pageCount: 7,
      detail: 'page 12 is corrupt',
    });
  });

  it('degrades to null when `connection.db` throws PERSISTENCE_UNAVAILABLE', () => {
    const { store, logger } = makeStore({
      dbThrows: new Error('PERSISTENCE_UNAVAILABLE'),
    });
    expect(store.read()).toBeNull();
    expect(
      logger.entries.some(
        (e) => e.level === 'debug' && e.message.includes('read failed'),
      ),
    ).toBe(true);
  });

  it('degrades to null when the SELECT itself throws', () => {
    const { store } = makeStore({
      get: () => {
        throw new Error('no such table: db_integrity_check_state');
      },
    });
    expect(store.read()).toBeNull();
  });

  it('never rethrows a non-Error throw', () => {
    const { store } = makeStore({
      get: () => {
        throw 'a bare string';
      },
    });
    expect(() => store.read()).not.toThrow();
    expect(store.read()).toBeNull();
  });
});

describe('IntegrityCheckStateStore.write', () => {
  it('binds the six values in schema order, encoding the boolean as 1', () => {
    const { store, statement } = makeStore({});
    store.write(CLEAN_STATE);
    expect(statement.run).toHaveBeenCalledWith(
      1_788_621_559_007,
      1,
      0,
      1868,
      256_183,
      null,
    );
  });

  it('encodes a failed quick_check as 0 and carries the detail', () => {
    const { store, statement } = makeStore({});
    store.write({ ...CLEAN_STATE, quickCheckOk: false, detail: 'bad page' });
    expect(statement.run).toHaveBeenCalledWith(
      1_788_621_559_007,
      0,
      0,
      1868,
      256_183,
      'bad page',
    );
  });

  it('swallows a failing write and warns', () => {
    const { store, logger } = makeStore({
      run: () => {
        throw new Error('database is locked');
      },
    });
    expect(() => store.write(CLEAN_STATE)).not.toThrow();
    const warned = logger.entries.find((e) => e.level === 'warn');
    expect(warned?.message).toContain('write failed');
    expect(warned?.context).toEqual({ error: 'database is locked' });
  });

  it('swallows an unavailable connection', () => {
    const { store, logger } = makeStore({
      dbThrows: new Error('PERSISTENCE_UNAVAILABLE'),
    });
    expect(() => store.write(CLEAN_STATE)).not.toThrow();
    expect(logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });
});
