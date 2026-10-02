/**
 * SkillBacklogPurgeStateStore — the one-row backlog purge marker (`0051`).
 *
 * The schema is the REAL `0051` statement from `MIGRATIONS` (after `0025`,
 * whose `skill_suggestions` table `0051` alters), not a hand-copied CREATE
 * TABLE, so the store and the migration cannot drift apart unnoticed.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { SkillBacklogPurgeStateStore } from './skill-backlog-purge-state.store';
import {
  asConnection,
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';

const sql0025 = MIGRATIONS.find((m) => m.version === 25)?.sql ?? '';
const sql0051 = MIGRATIONS.find((m) => m.version === 51)?.sql ?? '';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const opener = resolveOpener();

describe('SkillBacklogPurgeStateStore — degradation (no SQLite needed)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads null and warns when the connection is closed', () => {
    const store = new SkillBacklogPurgeStateStore(
      logger as never,
      {
        get db(): never {
          throw new Error('PERSISTENCE_UNAVAILABLE');
        },
      } as never,
    );

    expect(store.read()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('so the purge runs'),
      { error: 'PERSISTENCE_UNAVAILABLE' },
    );
  });

  it('lets a markComplete failure propagate so the caller transaction rolls back', () => {
    const store = new SkillBacklogPurgeStateStore(
      logger as never,
      {
        get db(): never {
          throw new Error('PERSISTENCE_UNAVAILABLE');
        },
      } as never,
    );

    expect(() =>
      store.markComplete({ cutoffCreatedAt: 1, completedAt: 2, rejected: 0 }),
    ).toThrow('PERSISTENCE_UNAVAILABLE');
  });
});

const maybe = opener ? describe : describe.skip;

maybe('SkillBacklogPurgeStateStore — SQLite', () => {
  let db: TestDatabase;

  beforeEach(() => {
    jest.clearAllMocks();
    db = (opener as (file: string) => TestDatabase)(':memory:');
  });

  afterEach(() => db.close());

  function migratedStore(): SkillBacklogPurgeStateStore {
    db.exec(sql0025);
    db.exec(sql0051);
    return new SkillBacklogPurgeStateStore(logger as never, asConnection(db));
  }

  it('reads null and warns when the table is missing', () => {
    const store = new SkillBacklogPurgeStateStore(
      logger as never,
      asConnection(db),
    );

    expect(store.read()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('so the purge runs'),
      expect.objectContaining({
        error: expect.stringContaining('skill_backlog_purge_state'),
      }),
    );
  });

  it('reads null without a warn before the purge has run', () => {
    const store = migratedStore();
    expect(store.read()).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('round-trips the completed marker', () => {
    const store = migratedStore();
    const state = {
      cutoffCreatedAt: 1_700_000_000_000,
      completedAt: 1_702_592_000_000,
      rejected: 17,
    };

    expect(store.markComplete(state)).toBe(true);
    expect(store.read()).toEqual(state);
  });

  it('lets the first writer win and keeps one row', () => {
    const store = migratedStore();
    const first = { cutoffCreatedAt: 100, completedAt: 200, rejected: 3 };

    expect(store.markComplete(first)).toBe(true);
    expect(
      store.markComplete({
        cutoffCreatedAt: 999,
        completedAt: 999,
        rejected: 9,
      }),
    ).toBe(false);

    expect(store.read()).toEqual(first);
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM skill_backlog_purge_state')
      .get() as { n: number };
    expect(Number(count.n)).toBe(1);
  });
});
