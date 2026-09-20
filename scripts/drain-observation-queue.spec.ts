/**
 * Tests for the offline `observation_queue` drain (TASK_2026_483).
 *
 * Every test here runs against a TEMPORARY FIXTURE database created under the
 * OS temp directory. Nothing in this file may ever touch
 * `~/.ptah/state/ptah.sqlite`; `assertIsFixture` enforces that at runtime.
 *
 * The point of this file is the DESTRUCTIVE path — the half a `--dry-run`
 * cannot reach: `probeWriteLock` under a genuinely held lock, the backup
 * verification, the delete loop's survivor guarantees, interrupt-and-resume,
 * and the post-run invariant.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  assertUnprocessedUnchanged,
  drainBatches,
  main,
  openDatabase,
  parseArgs,
  parseLockedPaths,
  probeWriteLock,
  targetsLiveDatabase,
  verifyBackup,
  type SqliteDatabase,
} from './drain-observation-queue';

// ---------------------------------------------------------------------------
// Fixture support
// ---------------------------------------------------------------------------

type SqliteDatabaseConstructor = new (
  file: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

const Database = require('better-sqlite3') as SqliteDatabaseConstructor;

const MILLISECONDS_PER_DAY = 86_400_000;

/** Mirrors migration `0016_observation_queue.ts`. */
const CREATE_TABLE_SQL = `CREATE TABLE observation_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  workspace_root TEXT,
  prompt_number INTEGER,
  kind TEXT NOT NULL,
  tool_name TEXT,
  tool_input_json TEXT,
  tool_response_text TEXT,
  assistant_message TEXT,
  user_prompt TEXT,
  file_path TEXT,
  captured_at INTEGER NOT NULL,
  processed_at INTEGER
)`;

const createdDirectories: string[] = [];

/**
 * The one rule this file cannot be allowed to break. A fixture path lives under
 * the OS temp directory and never inside a `.ptah` state directory.
 */
function assertIsFixture(dbPath: string): void {
  const resolved = path.resolve(dbPath).toLowerCase();
  const temp = path.resolve(os.tmpdir()).toLowerCase();
  if (!resolved.startsWith(temp)) {
    throw new Error(`Refusing: ${dbPath} is not under the temp directory`);
  }
  if (resolved.includes(`${path.sep}.ptah${path.sep}`)) {
    throw new Error(`Refusing: ${dbPath} looks like a real Ptah state file`);
  }
}

function makeFixtureDirectory(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-spec-'));
  createdDirectories.push(dir);
  return dir;
}

interface SeedRow {
  readonly processedAt: number | null;
  readonly capturedAt?: number;
}

function seedFixture(rows: readonly SeedRow[]): {
  dbPath: string;
  cutoffMs: number;
} {
  const dbPath = path.join(makeFixtureDirectory(), 'fixture.sqlite');
  assertIsFixture(dbPath);

  const db = new Database(dbPath);
  // INCREMENTAL must be set before the first table is created, so the reclaim
  // path in `main` is exercised rather than reported unavailable.
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('journal_mode = WAL');
  db.exec(CREATE_TABLE_SQL);

  const insert = db.prepare(
    `INSERT INTO observation_queue
       (session_id, kind, tool_name, tool_response_text, captured_at, processed_at)
     VALUES (@session, 'tool', 'Read', @payload, @captured, @processed)`,
  );
  const payload = 'x'.repeat(4096);
  for (const row of rows) {
    insert.run({
      session: 'fixture-session',
      payload,
      captured: row.capturedAt ?? Date.now() - 30 * MILLISECONDS_PER_DAY,
      processed: row.processedAt,
    });
  }
  db.close();

  return { dbPath, cutoffMs: Date.now() - 7 * MILLISECONDS_PER_DAY };
}

function countWhere(dbPath: string, predicate: string): number {
  const db = openDatabase(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS value FROM observation_queue WHERE ${predicate}`,
      )
      .get() as { value: number } | undefined;
    return row === undefined ? 0 : Number(row.value);
  } finally {
    db.close();
  }
}

/** Seven old-and-processed rows, one fresh-and-processed row, one unprocessed. */
function seedStandardFixture(): { dbPath: string; cutoffMs: number } {
  const cutoff = Date.now() - 7 * MILLISECONDS_PER_DAY;
  const rows: SeedRow[] = [];
  for (let index = 0; index < 7; index += 1) {
    rows.push({ processedAt: cutoff - 60_000 - index });
  }
  rows.push({ processedAt: cutoff + 60_000 });
  rows.push({ processedAt: null });
  return seedFixture(rows);
}

afterAll(() => {
  for (const dir of createdDirectories) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // A fixture the OS still holds is cleaned up by the temp directory itself.
    }
  }
});

// ---------------------------------------------------------------------------
// probeWriteLock — the only interlock standing on the destructive path
// ---------------------------------------------------------------------------

describe('probeWriteLock', () => {
  it('reports nothing when no other connection holds the write lock', () => {
    const { dbPath } = seedStandardFixture();
    expect(probeWriteLock(dbPath)).toEqual([]);
  });

  it('reports a blocking finding while a second connection holds BEGIN IMMEDIATE', () => {
    const { dbPath } = seedStandardFixture();
    const holder = new Database(dbPath);
    holder.exec('BEGIN IMMEDIATE');
    try {
      const findings = probeWriteLock(dbPath);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe('write-lock');
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
  });

  it('is a probe and not a constant — it clears again once the lock is released', () => {
    const { dbPath } = seedStandardFixture();
    const holder = new Database(dbPath);
    holder.exec('BEGIN IMMEDIATE');
    expect(probeWriteLock(dbPath)).toHaveLength(1);
    holder.exec('ROLLBACK');
    holder.close();
    expect(probeWriteLock(dbPath)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// targetsLiveDatabase — the predicate that decides blocking vs advisory
// ---------------------------------------------------------------------------

describe('targetsLiveDatabase', () => {
  /**
   * A directory alias that a LEXICAL `path.resolve` cannot see through. On
   * Windows this is an NTFS junction, which — unlike a file symlink — needs no
   * elevation and no Developer Mode. Elsewhere it is an ordinary directory
   * symlink.
   */
  function makeDirectoryAlias(target: string): string {
    const alias = path.join(makeFixtureDirectory(), 'alias');
    fs.symlinkSync(
      target,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return alias;
  }

  it('sees through a junction/symlink: an alias of the live path IS the live database', () => {
    const realDirectory = makeFixtureDirectory();
    const livePath = path.join(realDirectory, 'live.sqlite');
    fs.writeFileSync(livePath, 'fixture stand-in for the live database');
    assertIsFixture(livePath);

    const aliasPath = path.join(
      makeDirectoryAlias(realDirectory),
      'live.sqlite',
    );
    assertIsFixture(aliasPath);
    expect(fs.existsSync(aliasPath)).toBe(true);

    // Sanity, so this test CAN fail: the two spellings are lexically distinct,
    // which is exactly what the old `path.resolve().toLowerCase()` compared.
    expect(path.resolve(aliasPath).toLowerCase()).not.toBe(
      path.resolve(livePath).toLowerCase(),
    );

    expect(targetsLiveDatabase(aliasPath, livePath)).toBe(true);
  });

  it('is not constant: a different real file is not the live database', () => {
    const { dbPath } = seedStandardFixture();
    const other = seedStandardFixture().dbPath;
    expect(targetsLiveDatabase(other, dbPath)).toBe(false);
  });

  it('fails closed: an unresolvable path on either side counts as live', () => {
    const { dbPath } = seedStandardFixture();
    const missing = path.join(makeFixtureDirectory(), 'never-created.sqlite');
    expect(fs.existsSync(missing)).toBe(false);

    // Target unresolvable: must NOT be handed the advisory branch.
    expect(targetsLiveDatabase(missing, dbPath)).toBe(true);
    // Live side unresolvable (no Ptah install on this host): same answer.
    expect(targetsLiveDatabase(dbPath, missing)).toBe(true);
  });
});

describe('parseLockedPaths', () => {
  it('accepts an array of strings', () => {
    expect(parseLockedPaths(['a', 'b'])).toEqual(['a', 'b']);
  });

  it.each([[null], [{}], ['a'], [[1]], [[null]]])(
    'throws on malformed payload %p',
    (payload: unknown) => {
      expect(() => parseLockedPaths(payload)).toThrow(/malformed/i);
    },
  );
});

// ---------------------------------------------------------------------------
// drainBatches — the survivor guarantees
// ---------------------------------------------------------------------------

describe('drainBatches', () => {
  const never = (): boolean => false;

  function openWritable(dbPath: string): SqliteDatabase {
    return openDatabase(dbPath, { readonly: false, fileMustExist: true });
  }

  it('leaves every processed_at IS NULL row in place after a full drain', () => {
    const { dbPath, cutoffMs } = seedStandardFixture();
    const options = parseArgs(['--db', dbPath, '--batch-size', '2']);
    const db = openWritable(dbPath);
    try {
      const result = drainBatches(db, options, cutoffMs, never);
      expect(result.interrupted).toBe(false);
      expect(result.deleted).toBe(7);
    } finally {
      db.close();
    }
    expect(countWhere(dbPath, 'processed_at IS NULL')).toBe(1);
  });

  it('leaves a processed row inside the cutoff in place', () => {
    const { dbPath, cutoffMs } = seedStandardFixture();
    const options = parseArgs(['--db', dbPath, '--batch-size', '3']);
    const db = openWritable(dbPath);
    try {
      drainBatches(db, options, cutoffMs, never);
    } finally {
      db.close();
    }
    expect(
      countWhere(
        dbPath,
        `processed_at IS NOT NULL AND processed_at >= ${cutoffMs}`,
      ),
    ).toBe(1);
    expect(countWhere(dbPath, '1=1')).toBe(2);
  });

  it('still spares the unprocessed row when the cutoff would sweep everything else', () => {
    const { dbPath } = seedStandardFixture();
    const absurdFutureCutoff = Date.now() + 365 * MILLISECONDS_PER_DAY;
    const options = parseArgs(['--db', dbPath, '--batch-size', '4']);
    const db = openWritable(dbPath);
    try {
      const result = drainBatches(db, options, absurdFutureCutoff, never);
      expect(result.deleted).toBe(8);
    } finally {
      db.close();
    }
    expect(countWhere(dbPath, '1=1')).toBe(1);
    expect(countWhere(dbPath, 'processed_at IS NULL')).toBe(1);
  });

  it('stops on an interrupt and resumes correctly on the next run', () => {
    const { dbPath, cutoffMs } = seedStandardFixture();
    const options = parseArgs(['--db', dbPath, '--batch-size', '2']);

    // Interrupt at the top of the third iteration: two batches of two commit.
    let iterations = 0;
    const interruptAfterTwoBatches = (): boolean => {
      iterations += 1;
      return iterations > 2;
    };

    const first = openWritable(dbPath);
    let firstResult;
    try {
      firstResult = drainBatches(
        first,
        options,
        cutoffMs,
        interruptAfterTwoBatches,
      );
    } finally {
      first.close();
    }
    expect(firstResult.interrupted).toBe(true);
    expect(firstResult.deleted).toBe(4);
    expect(firstResult.batches).toBe(2);
    expect(countWhere(dbPath, '1=1')).toBe(5);

    const second = openWritable(dbPath);
    let secondResult;
    try {
      secondResult = drainBatches(second, options, cutoffMs, never);
    } finally {
      second.close();
    }
    expect(secondResult.interrupted).toBe(false);
    // The resumed run picks up exactly the three eligible rows left behind.
    expect(secondResult.deleted).toBe(3);
    expect(countWhere(dbPath, '1=1')).toBe(2);
    expect(countWhere(dbPath, 'processed_at IS NULL')).toBe(1);
  });

  it('honours --max-rows as a hard ceiling', () => {
    const { dbPath, cutoffMs } = seedStandardFixture();
    const options = parseArgs([
      '--db',
      dbPath,
      '--batch-size',
      '2',
      '--max-rows',
      '3',
    ]);
    const db = openWritable(dbPath);
    try {
      expect(drainBatches(db, options, cutoffMs, never).deleted).toBe(3);
    } finally {
      db.close();
    }
    expect(countWhere(dbPath, '1=1')).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// The post-run invariant
// ---------------------------------------------------------------------------

describe('assertUnprocessedUnchanged', () => {
  it('passes when the unprocessed count is identical', () => {
    expect(() => assertUnprocessedUnchanged(6_395, 6_395)).not.toThrow();
  });

  it('fires when an unprocessed row went missing', () => {
    expect(() => assertUnprocessedUnchanged(6_395, 6_394)).toThrow(
      /INVARIANT VIOLATED: unprocessed row count changed from 6395 to 6394/,
    );
  });

  it('fires when the count moved in either direction', () => {
    expect(() => assertUnprocessedUnchanged(1, 2)).toThrow(
      /INVARIANT VIOLATED/,
    );
  });
});

// ---------------------------------------------------------------------------
// Backup verification
// ---------------------------------------------------------------------------

describe('verifyBackup', () => {
  function makeBackup(dbPath: string): Promise<string> {
    const destination = path.join(path.dirname(dbPath), 'copy.sqlite');
    const db = openDatabase(dbPath, { readonly: true, fileMustExist: true });
    return db
      .backup(destination)
      .then(() => {
        db.close();
        return destination;
      })
      .catch((error: unknown) => {
        db.close();
        throw error instanceof Error ? error : new Error(String(error));
      });
  }

  it('accepts a backup taken through the SQLite backup API', async () => {
    const { dbPath } = seedStandardFixture();
    const destination = await makeBackup(dbPath);
    expect(() => verifyBackup(dbPath, destination)).not.toThrow();
  });

  it('rejects an empty copy', async () => {
    const { dbPath } = seedStandardFixture();
    const destination = await makeBackup(dbPath);
    fs.writeFileSync(destination, '');
    expect(() => verifyBackup(dbPath, destination)).toThrow(/empty file/i);
  });

  it('rejects a copy shorter than the source — the truncated-header case', async () => {
    const { dbPath } = seedStandardFixture();
    const destination = await makeBackup(dbPath);
    const head = fs.readFileSync(destination).subarray(0, 4096);
    fs.writeFileSync(destination, head);
    expect(() => verifyBackup(dbPath, destination)).toThrow(
      /smaller than the source/i,
    );
  });

  it('rejects a copy that is long enough but is not a database', async () => {
    const { dbPath } = seedStandardFixture();
    const destination = await makeBackup(dbPath);
    const size = fs.statSync(dbPath).size;
    fs.writeFileSync(destination, Buffer.alloc(size + 4096, 0x61));
    expect(() => verifyBackup(dbPath, destination)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// main — the whole destructive path, end to end, on a fixture
// ---------------------------------------------------------------------------

describe('main (destructive path, fixture database)', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('backs up, re-checks the interlocks, drains and keeps the unprocessed row', async () => {
    const { dbPath } = seedStandardFixture();
    assertIsFixture(dbPath);

    const exitCode = await main(['--db', dbPath, '--batch-size', '2']);
    expect(exitCode).toBe(0);

    const backupDir = path.join(path.dirname(dbPath), 'backups');
    const backups = fs.readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    const backupPath = path.join(backupDir, backups[0] as string);
    // The backup was taken BEFORE the delete, so it still holds all nine rows.
    expect(countWhere(backupPath, '1=1')).toBe(9);

    expect(countWhere(dbPath, '1=1')).toBe(2);
    expect(countWhere(dbPath, 'processed_at IS NULL')).toBe(1);
  }, 120_000);

  it('a dry run deletes nothing and writes no backup', async () => {
    const { dbPath } = seedStandardFixture();
    assertIsFixture(dbPath);

    const exitCode = await main(['--db', dbPath, '--dry-run']);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(path.dirname(dbPath), 'backups'))).toBe(
      false,
    );
    expect(countWhere(dbPath, '1=1')).toBe(9);
  }, 120_000);
});
