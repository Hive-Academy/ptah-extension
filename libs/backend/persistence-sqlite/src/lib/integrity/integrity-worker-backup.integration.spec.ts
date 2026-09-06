/**
 * A-1 PINNED (TASK_2026_383 Batch 6, Revision 1).
 *
 * Assumption A-1 is the premise the entire backup feature rests on: **a
 * connection opened `{ readonly: true, fileMustExist: true }` can call
 * `backup()`, against a database another connection is actively writing, and
 * the destination passes `quick_check`.** Batch 6 originally verified it with
 * manual probes reported in prose. That is exactly the failure class this whole
 * task is about — a fail-safe hiding a broken dependency. If a `better-sqlite3`
 * bump, an ABI change or a platform quirk breaks A-1, `performBackup` maps it
 * to `'unavailable'` with a `detail`: no crash, no corrupted state, no test
 * failure, and no backups. Nothing would go red. This file makes it go red.
 *
 * It calls `performBackup` DIRECTLY — not through the worker transport. The
 * worker entry (`integrity-worker.ts`) cannot be imported in Jest (it
 * subscribes to a parent port at module scope and throws when there is none),
 * which is why Revision 1 moved the command's body into the protocol module.
 * The only things this file substitutes for the worker's own are the two
 * openers, and it builds them with the same flags the worker uses
 * (`integrity-worker.ts`'s `openReadOnly` / `openForValidation`) so the thing
 * under test is the real pairing, not a convenient one.
 *
 * NATIVE GUARD. Follows the repository's `nativeAvailable ? it : it.skip`
 * idiom (`sqlite-connection.realbinary.spec.ts:12-34`,
 * `memory-curator/src/lib/code-symbol.store.spec.ts:170-184`, ~75 sites). The
 * probe fails, and this suite self-skips, on a checkout whose
 * `better-sqlite3` is compiled for the Electron ABI while Jest runs on Node's —
 * the normal state of a developer machine that has run `nx rebuild-native
 * ptah-electron`. It runs in CI, where the module is built for the Node that
 * runs Jest.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  performBackup,
  type BackupEnvironment,
  type BackupSourceDatabase,
  type BackupValidationDatabase,
} from './integrity-worker-protocol';

interface ProbeDatabase extends BackupSourceDatabase, BackupValidationDatabase {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): void; get(): unknown };
}

type DatabaseCtor = new (
  file: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => ProbeDatabase;

describe('integrity worker backup — real better-sqlite3 (A-1)', () => {
  let nativeAvailable = false;
  let nativeProbeError: string | null = null;
  let Database: DatabaseCtor | null = null;
  try {
    require.resolve('better-sqlite3');
    Database = require('better-sqlite3') as DatabaseCtor;
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch (err: unknown) {
    nativeAvailable = false;
    nativeProbeError = err instanceof Error ? err.message : String(err);
  }
  if (!nativeAvailable && nativeProbeError) {
    process.stderr.write(
      `[integration-spec] native probe failed; A-1 suite skipped: ${nativeProbeError}\n`,
    );
  }

  const maybe = nativeAvailable ? it : it.skip;

  let workDir: string;
  let dbPath: string;
  /** The LIVE WRITER. Held open for the whole test, exactly like the host. */
  let writer: ProbeDatabase | null = null;
  let writeTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * The two openers, with the SAME flags `integrity-worker.ts` uses. Source
   * read-only (that is the assumption); copy read-write (a read-only open
   * cannot checkpoint on close and leaves `-wal`/`-shm` sidecars, which the
   * sidecar assertion below is what pins).
   */
  function makeEnvironment(
    overrides: Partial<BackupEnvironment> = {},
  ): BackupEnvironment {
    const ctor = Database as DatabaseCtor;
    return {
      fs,
      openSource: (source: string) =>
        new ctor(source, { readonly: true, fileMustExist: true }),
      openCopy: (dest: string) => new ctor(dest, { fileMustExist: true }),
      now: () => Date.now(),
      inFlight: new Set<string>(),
      ...overrides,
    };
  }

  beforeEach(() => {
    if (!nativeAvailable || !Database) return;
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-a1-backup-'));
    dbPath = path.join(workDir, 'ptah.sqlite');

    writer = new Database(dbPath);
    writer.exec('PRAGMA journal_mode = WAL');
    writer.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
    const insert = writer.prepare('INSERT INTO t(v) VALUES (?)');
    for (let i = 0; i < 500; i++) insert.run(`row-${i}`);
    // Keep writing THROUGHOUT the backup. A read-only copy of a quiescent file
    // proves much less than one taken from under a live WAL writer, which is
    // the situation the worker is actually in.
    writeTimer = setInterval(() => {
      try {
        insert.run('concurrent');
      } catch {
        // The writer is closed in afterEach; a late tick is not a failure.
      }
    }, 1);
  });

  afterEach(() => {
    if (writeTimer) clearInterval(writeTimer);
    writeTimer = null;
    try {
      writer?.close();
    } catch {
      // Already closed by a test.
    }
    writer = null;
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  function readCopy(dest: string): { quickCheck: unknown; rows: number } {
    const ctor = Database as DatabaseCtor;
    const copy = new ctor(dest, { readonly: true, fileMustExist: true });
    try {
      return {
        quickCheck: copy.pragma('quick_check', { simple: true }),
        rows: (
          copy.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
        ).c,
      };
    } finally {
      copy.close();
    }
  }

  maybe(
    'A-1: a read-only source connection backs up a live WAL database and the copy passes quick_check',
    async () => {
      const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');

      const response = await performBackup(makeEnvironment(), {
        id: 1,
        type: 'backup',
        dbPath,
        destPath: dest,
      });

      // THE ASSUMPTION ITSELF. A `'unavailable'` here is the silent-degradation
      // failure this file exists to make loud, so assert on the detail too —
      // it carries the driver's own error message when the premise breaks.
      expect(response.detail).toBeNull();
      expect(response.verdict).toBe('ok');
      expect(response.quickCheck).toBe('ok');
      expect(response.bytesWritten).toBeGreaterThan(0);
      expect(fs.existsSync(dest)).toBe(true);

      // Validated independently of the worker's own verdict.
      const copy = readCopy(dest);
      expect(copy.quickCheck).toBe('ok');
      expect(copy.rows).toBeGreaterThanOrEqual(500);
    },
  );

  maybe('leaves no -wal/-shm sidecar beside the finished backup', async () => {
    // Rotation selects by filename PREFIX, so a sidecar takes a rotation slot
    // and evicts a real backup. Validating the copy read-only would plant
    // both; this is what forces `openCopy` to stay read-write.
    const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');

    const response = await performBackup(makeEnvironment(), {
      id: 2,
      type: 'backup',
      dbPath,
      destPath: dest,
    });

    expect(response.verdict).toBe('ok');
    expect(fs.readdirSync(path.dirname(dest))).toEqual([
      'ptah-2026-09-06.sqlite',
    ]);
  });

  maybe('the source database is untouched by the backup', async () => {
    const dest = path.join(
      workDir,
      'ptah.pre-migration-20260906T101500Z.sqlite',
    );
    const before = (
      writer?.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
    ).c;

    const response = await performBackup(makeEnvironment(), {
      id: 3,
      type: 'backup',
      dbPath,
      destPath: dest,
    });

    expect(response.verdict).toBe('ok');
    const after = (
      writer?.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
    ).c;
    // The live writer keeps inserting, so the count only ever grows — what
    // matters is that the read-only backup connection did not roll it back,
    // truncate it, or make the handle unusable.
    expect(after).toBeGreaterThanOrEqual(before);
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  maybe(
    'a failure AFTER a real copy lands leaves no artifact and no sidecars',
    async () => {
      // The forced failure is the file lockdown, which is the one post-copy
      // step that can realistically throw on a fully written backup (a locked
      // parent, an odd ACL). `backup()` itself is real and really writes the
      // file first, so this exercises the cleanup path on a genuine artifact
      // rather than on a path nothing ever created.
      const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');
      const env = makeEnvironment({
        fs: {
          ...fs,
          chmodSync: (target: string, mode: number) => {
            if (target === dest)
              throw new Error('EPERM: forced lockdown failure');
            fs.chmodSync(target, mode);
          },
        },
      });

      const response = await performBackup(env, {
        id: 4,
        type: 'backup',
        dbPath,
        destPath: dest,
      });

      expect(response.verdict).toBe('unavailable');
      expect(response.detail).toContain('forced lockdown failure');
      expect(response.bytesWritten).toBe(0);
      expect(fs.existsSync(dest)).toBe(false);
      expect(fs.existsSync(`${dest}-wal`)).toBe(false);
      expect(fs.existsSync(`${dest}-shm`)).toBe(false);
    },
  );

  maybe(
    'a destination directory that cannot be created leaves no artifact',
    async () => {
      // `backups` already exists as a FILE, so `mkdirSync` fails before any
      // copy is attempted.
      fs.writeFileSync(path.join(workDir, 'backups'), 'not a directory');
      const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');

      const response = await performBackup(makeEnvironment(), {
        id: 5,
        type: 'backup',
        dbPath,
        destPath: dest,
      });

      expect(response.verdict).toBe('unavailable');
      expect(response.bytesWritten).toBe(0);
      expect(fs.existsSync(dest)).toBe(false);
      expect(fs.readFileSync(path.join(workDir, 'backups'), 'utf8')).toBe(
        'not a directory',
      );
    },
  );

  maybe('a corrupt copy is reported corrupt and removed', async () => {
    // `quick_check` really runs, on a real file, and really answers something
    // other than `ok`. PAGE 1 IS LEFT INTACT: it holds the SQLite header and
    // the schema, and overwriting it makes the OPEN fail ("file is not a
    // database") — which is `'unavailable'`, not `'corrupt'`, and would test
    // the wrong branch. Corrupting from page 2 on damages the table b-tree
    // while leaving a file SQLite will still open, which is the only way to
    // reach a genuine `'corrupt'` verdict.
    const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');
    const env = makeEnvironment({
      openCopy: (target: string) => {
        const size = fs.statSync(target).size;
        const handle = fs.openSync(target, 'r+');
        try {
          fs.writeSync(
            handle,
            Buffer.alloc(size - 4096, 0x41),
            0,
            size - 4096,
            4096,
          );
        } finally {
          fs.closeSync(handle);
        }
        const ctor = Database as DatabaseCtor;
        return new ctor(target, { fileMustExist: true });
      },
    });

    const response = await performBackup(env, {
      id: 6,
      type: 'backup',
      dbPath,
      destPath: dest,
    });

    expect(response.verdict).toBe('corrupt');
    expect(response.bytesWritten).toBe(0);
    expect(fs.existsSync(dest)).toBe(false);
  });

  maybe(
    'a second request for the same destination is refused while the first is in flight',
    async () => {
      const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');
      const env = makeEnvironment();
      const request = {
        id: 7,
        type: 'backup' as const,
        dbPath,
        destPath: dest,
      };

      const [first, second] = await Promise.all([
        performBackup(env, request),
        performBackup(env, { ...request, id: 8 }),
      ]);

      // Exactly one wins; the other is refused rather than allowed to
      // interleave its cleanup with the winner's in-progress copy.
      const verdicts = [first.verdict, second.verdict].sort();
      expect(verdicts).toEqual(['ok', 'unavailable']);
      const refused = first.verdict === 'unavailable' ? first : second;
      expect(refused.detail).toContain('already in flight');
      expect(fs.existsSync(dest)).toBe(true);
      expect(readCopy(dest).quickCheck).toBe('ok');
    },
  );

  maybe(
    'a symlinked backups directory pointing out of the tree is refused',
    async () => {
      // The string-level containment check passes here — `<dbDir>/backups/x` is
      // structurally inside the tree — so this is `resolveRealBackupDestination`
      // and nothing else. Junction type on Windows: a directory junction needs
      // no elevation, unlike a symlink.
      const outside = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ptah-a1-outside-'),
      );
      try {
        fs.symlinkSync(
          outside,
          path.join(workDir, 'backups'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (err: unknown) {
        // Unprivileged symlink creation is refused on some Windows configs.
        // Skipping beats asserting nothing, and the pure-path cases in
        // `integrity-worker-protocol.spec.ts` still cover the rest.
        process.stderr.write(
          `[integration-spec] symlink case skipped: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        fs.rmSync(outside, { recursive: true, force: true });
        return;
      }

      const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');
      const response = await performBackup(makeEnvironment(), {
        id: 9,
        type: 'backup',
        dbPath,
        destPath: dest,
      });

      expect(response.verdict).toBe('unavailable');
      expect(response.detail).toContain(
        'resolves outside the database directory tree',
      );
      expect(fs.readdirSync(outside)).toEqual([]);
      fs.rmSync(outside, { recursive: true, force: true });
    },
  );
});
