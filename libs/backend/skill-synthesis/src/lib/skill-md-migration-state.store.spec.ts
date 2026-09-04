/**
 * SkillMdMigrationStateStore — the SQLite adapter behind the SKILL.md
 * migration marker (TASK_2026_331 B4).
 *
 * TWO PROPERTIES ARE THE POINT, and neither is "the upsert works".
 *
 * 1. IT DEGRADES INSTEAD OF THROWING. `SqliteConnectionService.db` throws
 *    `RpcUserError('PERSISTENCE_UNAVAILABLE')` whenever the connection is not
 *    open. A read that let that escape would take down
 *    `SkillSynthesisService.start()`; a read that returned anything other than
 *    `null` would risk SKIPPING the migration. `null` is the only answer that
 *    makes the caller walk, which is the pre-marker behaviour.
 * 2. ROWS ARE PER ROOT. Writing the active root must leave the candidates
 *    root's row untouched, because the two are walked back to back and a
 *    failure in the second must not be masked by the first one's success.
 *
 * The SQL is exercised against the REAL `0041` statement pulled out of
 * `MIGRATIONS`, not a hand-copied CREATE TABLE — a store and a migration that
 * drift apart is exactly what a hand-copied schema would hide.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { SkillMdMigrationStateStore } from './skill-md-migration-state.store';
import { SKILL_MD_MIGRATION_VERSION } from './skill-md-migration';

const sql0041 = MIGRATIONS.find((m) => m.version === 41)?.sql ?? '';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

function resolveOpener(): ((file: string) => DatabaseShape) | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const probe = new Database(':memory:');
    probe.close();
    return (file) => new Database(file);
  } catch {
    // The repo's better-sqlite3 is rebuilt against Electron's ABI by
    // postinstall and cannot load in the Jest runner; fall through.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    const probe = new DatabaseSync(':memory:');
    probe.close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

const opener = resolveOpener();

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const ACTIVE_ROOT = 'C:\\Users\\a\\.ptah\\skills';
const CANDIDATES_ROOT = 'C:\\Users\\a\\.ptah\\skills\\_candidates';

describe('SkillMdMigrationStateStore — degradation (no SQLite needed)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports no marker when the connection is closed, instead of throwing', () => {
    const store = new SkillMdMigrationStateStore(
      logger as never,
      {
        get db(): never {
          throw new Error('PERSISTENCE_UNAVAILABLE');
        },
      } as never,
    );

    // `null` — never an empty-but-present state, which would let the caller
    // treat an unavailable database as "already migrated".
    expect(store.read(ACTIVE_ROOT)).toBeNull();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('swallows a write failure and warns, so a completed walk is never undone', () => {
    const store = new SkillMdMigrationStateStore(
      logger as never,
      {
        get db(): never {
          throw new Error('PERSISTENCE_UNAVAILABLE');
        },
      } as never,
    );

    expect(() =>
      store.write(ACTIVE_ROOT, {
        migrationVersion: SKILL_MD_MIGRATION_VERSION,
        lastScanAt: Date.now(),
      }),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('SkillMdMigrationStateStore — round trip (skipped without any SQLite binding)', () => {
  const maybe = opener ? it : it.skip;

  function makeStore(): {
    store: SkillMdMigrationStateStore;
    db: DatabaseShape;
  } {
    const db = (opener as (file: string) => DatabaseShape)(':memory:');
    db.exec(sql0041);
    return {
      store: new SkillMdMigrationStateStore(
        logger as never,
        {
          db,
          isOpen: true,
        } as never,
      ),
      db,
    };
  }

  maybe('reads back nothing for a root that was never scanned', () => {
    const { store, db } = makeStore();
    try {
      expect(store.read(ACTIVE_ROOT)).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe('round-trips the version and the timestamp', () => {
    const { store, db } = makeStore();
    try {
      store.write(ACTIVE_ROOT, {
        migrationVersion: SKILL_MD_MIGRATION_VERSION,
        lastScanAt: 1_700_000_000_000,
      });
      expect(store.read(ACTIVE_ROOT)).toEqual({
        migrationVersion: SKILL_MD_MIGRATION_VERSION,
        lastScanAt: 1_700_000_000_000,
      });
    } finally {
      db.close();
    }
  });

  maybe('replaces the row for a root rather than accumulating rows', () => {
    const { store, db } = makeStore();
    try {
      store.write(ACTIVE_ROOT, { migrationVersion: 1, lastScanAt: 1000 });
      store.write(ACTIVE_ROOT, { migrationVersion: 2, lastScanAt: 2000 });
      expect(store.read(ACTIVE_ROOT)).toEqual({
        migrationVersion: 2,
        lastScanAt: 2000,
      });
      const count = db
        .prepare('SELECT COUNT(*) AS n FROM skill_md_migration_state')
        .get() as { n: number };
      expect(Number(count.n)).toBe(1);
    } finally {
      db.close();
    }
  });

  maybe('keeps the two roots independent', () => {
    const { store, db } = makeStore();
    try {
      store.write(ACTIVE_ROOT, { migrationVersion: 1, lastScanAt: 1000 });
      // The candidates walk failed, so nothing was written for it. The active
      // root's marker must not answer for it.
      expect(store.read(CANDIDATES_ROOT)).toBeNull();
      expect(store.read(ACTIVE_ROOT)).toEqual({
        migrationVersion: 1,
        lastScanAt: 1000,
      });
    } finally {
      db.close();
    }
  });
});
