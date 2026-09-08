/**
 * Integrity worker protocol specs (TASK_2026_380 B1; backup half added by
 * TASK_2026_383 Batch 6).
 *
 * Everything here is the worker's TESTABLE half, and it is tested here because
 * the worker ENTRY cannot be imported in Jest: it subscribes to a parent port
 * at module scope and throws when there is none. The entry itself is exercised
 * end to end through a fake factory in `integrity-check.service.spec.ts`.
 * That constraint is why the backup destination guard and the artifact
 * filesystem helpers live in the protocol module rather than in the entry —
 * anything left in the entry is, by construction, unassertable.
 *
 * `classifyQuickCheck` carries the single most consequential rule in this
 * feature: which failures are allowed to be called corruption. The permission
 * cases carry the second: a backup of the workspace database that is not
 * owner-only is a local information-disclosure hole, and it is exactly the kind
 * of thing that disappears silently in a move between processes.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BACKUP_DIR_MODE,
  BACKUP_FILE_MODE,
  classifyQuickCheck,
  ensureBackupDirectory,
  isBackupRequest,
  isIntegrityCheckRequest,
  removeBackupArtifact,
  resolveRealBackupDestination,
  restrictBackupFile,
  validateBackupDestination,
  type BackupArtifactFs,
} from './integrity-worker-protocol';

describe('classifyQuickCheck', () => {
  it("returns 'ok' only for the literal ok, trimmed", () => {
    expect(classifyQuickCheck('ok')).toBe('ok');
    expect(classifyQuickCheck('ok\n')).toBe('ok');
    expect(classifyQuickCheck('  ok  ')).toBe('ok');
  });

  it("returns 'corrupt' for any other string, because the pragma ANSWERED", () => {
    expect(classifyQuickCheck('*** in database main ***')).toBe('corrupt');
    expect(classifyQuickCheck('row 42 missing from index')).toBe('corrupt');
    expect(classifyQuickCheck('')).toBe('corrupt');
  });

  it("returns 'unavailable' for a non-string, because we got no answer", () => {
    // A driver that returned rows, `undefined`, or nothing at all has not told
    // us the file is bad — it has told us nothing. Calling that corruption is
    // the one mistake this vocabulary exists to prevent: the service writes no
    // record for `unavailable`, so an inconclusive check retries instead of
    // being remembered.
    expect(classifyQuickCheck(undefined)).toBe('unavailable');
    expect(classifyQuickCheck(null)).toBe('unavailable');
    expect(classifyQuickCheck([])).toBe('unavailable');
    expect(classifyQuickCheck({ ok: true })).toBe('unavailable');
    expect(classifyQuickCheck(1)).toBe('unavailable');
  });

  it('is pure — the same input always classifies the same way', () => {
    expect(classifyQuickCheck('ok')).toBe(classifyQuickCheck('ok'));
    expect(classifyQuickCheck('bad')).toBe(classifyQuickCheck('bad'));
  });
});

describe('isIntegrityCheckRequest', () => {
  it('accepts a well-formed check request', () => {
    expect(
      isIntegrityCheckRequest({
        id: 1,
        type: 'check',
        dbPath: 'C:\\db.sqlite',
      }),
    ).toBe(true);
  });

  it('rejects anything else, including an empty dbPath', () => {
    // An empty path would reach `better-sqlite3` and, without
    // `fileMustExist: true`, could open something that is not the database.
    expect(isIntegrityCheckRequest({ id: 1, type: 'check', dbPath: '' })).toBe(
      false,
    );
    expect(isIntegrityCheckRequest({ id: 1, type: 'init' })).toBe(false);
    expect(isIntegrityCheckRequest({ type: 'check', dbPath: 'x' })).toBe(false);
    expect(
      isIntegrityCheckRequest({ id: '1', type: 'check', dbPath: 'x' }),
    ).toBe(false);
    expect(isIntegrityCheckRequest(null)).toBe(false);
    expect(isIntegrityCheckRequest('check')).toBe(false);
  });

  it("does not accept a 'backup' request", () => {
    // The two guards must not overlap: the dispatch in `integrity-worker.ts`
    // tries `check` first, and a backup request matching it would be answered
    // with a check response the driver is not waiting for.
    expect(
      isIntegrityCheckRequest({
        id: 1,
        type: 'backup',
        dbPath: 'C:\\db.sqlite',
        destPath: 'C:\\db.daily.sqlite',
      }),
    ).toBe(false);
  });
});

describe('isBackupRequest', () => {
  it('accepts a well-formed backup request', () => {
    expect(
      isBackupRequest({
        id: 7,
        type: 'backup',
        dbPath: 'C:\\ptah\\ptah.sqlite',
        destPath: 'C:\\ptah\\backups\\ptah-2026-09-06.sqlite',
      }),
    ).toBe(true);
  });

  it('rejects a malformed backup request', () => {
    // The dispatch DROPS anything neither guard accepts, so each of these is a
    // payload the worker never acts on rather than one it acts on wrongly.
    expect(isBackupRequest({ id: 1, type: 'backup', dbPath: 'a' })).toBe(false); // no destPath
    expect(
      isBackupRequest({ id: 1, type: 'backup', dbPath: 'a', destPath: '' }),
    ).toBe(false); // empty destPath
    expect(
      isBackupRequest({ id: 1, type: 'backup', dbPath: '', destPath: 'b' }),
    ).toBe(false); // empty dbPath
    expect(
      isBackupRequest({ type: 'backup', dbPath: 'a', destPath: 'b' }),
    ).toBe(false); // no id
    expect(
      isBackupRequest({ id: '1', type: 'backup', dbPath: 'a', destPath: 'b' }),
    ).toBe(false); // id is not a number
    expect(
      isBackupRequest({ id: 1, type: 'restore', dbPath: 'a', destPath: 'b' }),
    ).toBe(false); // unknown command
    expect(isBackupRequest({ id: 1, type: 'check', dbPath: 'a' })).toBe(false);
    expect(isBackupRequest(null)).toBe(false);
    expect(isBackupRequest('backup')).toBe(false);
    expect(isBackupRequest(42)).toBe(false);
  });
});

describe('validateBackupDestination', () => {
  const dbPath = path.join(
    path.parse(process.cwd()).root,
    'ptah',
    'ptah.sqlite',
  );
  const dbDir = path.dirname(dbPath);

  it('accepts a sibling of the database', () => {
    // The `pre-migration` and `reset` kinds write straight beside the database.
    expect(
      validateBackupDestination(
        dbPath,
        path.join(dbDir, 'ptah.pre-migration-20260906T101500Z.sqlite'),
      ),
    ).toBeNull();
  });

  it('accepts a file in a subdirectory of the database directory', () => {
    // The `daily` kind writes into `<dbDir>/backups/`.
    expect(
      validateBackupDestination(
        dbPath,
        path.join(dbDir, 'backups', 'ptah-2026-09-06.sqlite'),
      ),
    ).toBeNull();
  });

  it('rejects a relative destination', () => {
    expect(validateBackupDestination(dbPath, 'backups/ptah.sqlite')).toContain(
      'not absolute',
    );
  });

  it('rejects a relative source', () => {
    expect(
      validateBackupDestination('ptah.sqlite', path.join(dbDir, 'copy.sqlite')),
    ).toContain('not absolute');
  });

  it('rejects the source database itself', () => {
    // `backup()` onto its own source would destroy the live database this
    // whole subsystem exists to protect.
    expect(validateBackupDestination(dbPath, dbPath)).toContain(
      'the source database itself',
    );
  });

  it('rejects a traversal that climbs out of the database directory', () => {
    expect(
      validateBackupDestination(
        dbPath,
        path.join(dbDir, '..', '..', 'evil.sqlite'),
      ),
    ).toContain('outside the database directory tree');
  });

  it('rejects the database directory itself', () => {
    expect(validateBackupDestination(dbPath, dbDir)).toContain(
      'outside the database directory tree',
    );
  });

  it('rejects an unrelated absolute path', () => {
    const elsewhere = path.join(
      path.parse(process.cwd()).root,
      'elsewhere',
      'copy.sqlite',
    );
    expect(validateBackupDestination(dbPath, elsewhere)).toContain(
      'outside the database directory tree',
    );
  });

  it('rejects the database directory itself with a trailing separator', () => {
    // `path.relative` normalizes trailing separators, and this function already
    // needed one platform-specific `path.relative` workaround (the cross-drive
    // absolute result below). A trailing slash is the next place a platform
    // difference would hide, and `<dbDir>/` must be rejected exactly as
    // `<dbDir>` is — not slip through as a non-empty relative result.
    expect(validateBackupDestination(dbPath, `${dbDir}${path.sep}`)).toContain(
      'outside the database directory tree',
    );
  });

  // `path.relative` returns an ABSOLUTE path across Windows drives and for a
  // UNC share, which is why the containment check tests `isAbsolute` on the
  // relative result. That line only executes on win32 — on POSIX these inputs
  // are not absolute paths at all and are refused one rule earlier — so the
  // branch is pinned where it exists rather than not at all.
  const itWindows = process.platform === 'win32' ? it : it.skip;

  itWindows('rejects a destination on a different drive', () => {
    expect(
      validateBackupDestination(
        'C:\\ptah\\ptah.sqlite',
        'D:\\evil\\copy.sqlite',
      ),
    ).toContain('outside the database directory tree');
  });

  itWindows('rejects a destination on a UNC share', () => {
    expect(
      validateBackupDestination(
        'C:\\ptah\\ptah.sqlite',
        '\\\\attacker\\share\\copy.sqlite',
      ),
    ).toContain('outside the database directory tree');
  });

  it('rejects a sibling directory with a shared name prefix', () => {
    // `<root>/ptah-evil` is NOT under `<root>/ptah`, and a naive
    // `startsWith(dbDir)` string test would have accepted it.
    const lookalike = path.join(`${dbDir}-evil`, 'copy.sqlite');
    expect(validateBackupDestination(dbPath, lookalike)).toContain(
      'outside the database directory tree',
    );
  });
});

describe('resolveRealBackupDestination', () => {
  // `validateBackupDestination` compares strings and a symlink defeats it. This
  // is the second half of the containment rule, and `performBackup` runs both.
  // The fs port is injected, so the symlink is expressed as a `realpathSync`
  // that answers differently from its input — no privileged filesystem
  // operation needed for the unit case. The end-to-end version, with a real
  // junction, is in `integrity-worker-backup.integration.spec.ts`.
  const root = path.parse(process.cwd()).root;
  const dbPath = path.join(root, 'ptah', 'ptah.sqlite');
  const dbDir = path.dirname(dbPath);

  function fsWith(
    realpaths: Record<string, string>,
    existing: string[],
  ): BackupArtifactFs {
    return {
      existsSync: (target: string) => existing.includes(target),
      mkdirSync: () => undefined,
      chmodSync: () => undefined,
      rmdirSync: () => undefined,
      unlinkSync: () => undefined,
      statSync: () => ({ size: 0 }),
      realpathSync: (target: string) => {
        const mapped = realpaths[target];
        if (mapped === undefined) throw new Error(`ENOENT: ${target}`);
        return mapped;
      },
    };
  }

  it('accepts a destination whose ancestors resolve to themselves', () => {
    const backups = path.join(dbDir, 'backups');
    const io = fsWith({ [dbDir]: dbDir, [backups]: backups }, [dbDir, backups]);
    expect(
      resolveRealBackupDestination(
        io,
        dbPath,
        path.join(backups, 'ptah-2026-09-06.sqlite'),
      ),
    ).toBeNull();
  });

  it('rejects a destination whose parent is a symlink out of the tree', () => {
    const backups = path.join(dbDir, 'backups');
    const elsewhere = path.join(root, 'elsewhere');
    const io = fsWith({ [dbDir]: dbDir, [backups]: elsewhere }, [
      dbDir,
      backups,
    ]);
    expect(
      resolveRealBackupDestination(
        io,
        dbPath,
        path.join(backups, 'ptah-2026-09-06.sqlite'),
      ),
    ).toContain('resolves outside the database directory tree');
  });

  it('resolves the nearest EXISTING ancestor when the destination directory is not created yet', () => {
    // `destPath` never exists at this point — that is the operation. Only the
    // ancestors that do exist can be resolved, and the tail is re-attached.
    const io = fsWith({ [dbDir]: dbDir }, [dbDir]);
    expect(
      resolveRealBackupDestination(
        io,
        dbPath,
        path.join(dbDir, 'backups', 'ptah-2026-09-06.sqlite'),
      ),
    ).toBeNull();
  });

  it('rejects when the database directory itself cannot be resolved', () => {
    // An ancestor we cannot resolve is an ancestor we cannot vouch for.
    const io = fsWith({}, [dbDir]);
    expect(
      resolveRealBackupDestination(io, dbPath, path.join(dbDir, 'copy.sqlite')),
    ).toContain('database directory could not be resolved');
  });

  it('rejects when an existing ancestor cannot be resolved', () => {
    const backups = path.join(dbDir, 'backups');
    const io = fsWith({ [dbDir]: dbDir }, [dbDir, backups]);
    expect(
      resolveRealBackupDestination(io, dbPath, path.join(backups, 'x.sqlite')),
    ).toContain('ancestor could not be resolved');
  });
});

describe('backup artifact filesystem helpers', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-backup-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  // `chmod` mode bits do not exist on Windows: Node's `chmodSync` there only
  // touches the read-only bit, so `statSync().mode` never reports 0o700/0o600
  // and asserting it would fail for a reason that has nothing to do with the
  // lockdown. The lockdown itself is what must not be silently lost — losing
  // it reopens a local information-disclosure hole, since the database holds
  // workspace content — so the assertion runs wherever it is meaningful.
  // Named to match the pre-existing instance of this idiom in
  // `apps/ptah-cli/src/smoke.spec.ts:153`, so a grep for one finds both.
  const itPosix = process.platform === 'win32' ? it.skip : it;

  describe('ensureBackupDirectory', () => {
    it('creates the destination directory when it is missing', () => {
      const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');
      ensureBackupDirectory(fs, dest);
      expect(fs.existsSync(path.dirname(dest))).toBe(true);
    });

    itPosix('locks a directory it created to owner-only 0700', () => {
      const dest = path.join(workDir, 'backups', 'ptah-2026-09-06.sqlite');
      ensureBackupDirectory(fs, dest);
      const mode = fs.statSync(path.dirname(dest)).mode & 0o777;
      expect(mode).toBe(BACKUP_DIR_MODE);
    });

    it('removes the directory it created when the chmod throws', () => {
      // Otherwise a created-but-unlocked directory survives a failed backup —
      // and the NEXT backup finds it pre-existing and therefore never locks it
      // down, so one transient chmod failure permanently downgrades the
      // permissions of the backup directory.
      const dir = path.join(workDir, 'backups');
      const dest = path.join(dir, 'copy.sqlite');
      const chmodFails: BackupArtifactFs = {
        ...fs,
        chmodSync: () => {
          throw new Error('EPERM: forced');
        },
      };

      expect(() => ensureBackupDirectory(chmodFails, dest)).toThrow('EPERM');
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('propagates the original error even when the rollback also fails', () => {
      const bothFail: BackupArtifactFs = {
        ...fs,
        existsSync: () => false,
        mkdirSync: () => undefined,
        chmodSync: () => {
          throw new Error('EPERM: the one worth reporting');
        },
        rmdirSync: () => {
          throw new Error('EBUSY: the rollback');
        },
      };

      expect(() =>
        ensureBackupDirectory(bothFail, path.join(workDir, 'x', 'copy.sqlite')),
      ).toThrow('the one worth reporting');
    });

    it('leaves an existing directory alone', () => {
      // Chmodding a directory we did not create would silently re-permission
      // whatever the host pointed at.
      const dir = path.join(workDir, 'existing');
      fs.mkdirSync(dir);
      const before = fs.statSync(dir).mode;
      ensureBackupDirectory(fs, path.join(dir, 'copy.sqlite'));
      expect(fs.statSync(dir).mode).toBe(before);
    });
  });

  describe('restrictBackupFile', () => {
    it('returns the size of the finished artifact', () => {
      const dest = path.join(workDir, 'copy.sqlite');
      fs.writeFileSync(dest, 'sqlite-ish bytes');
      expect(restrictBackupFile(fs, dest)).toBe(
        Buffer.byteLength('sqlite-ish bytes'),
      );
    });

    itPosix('locks the finished artifact to owner-only 0600', () => {
      const dest = path.join(workDir, 'copy.sqlite');
      fs.writeFileSync(dest, 'x', { mode: 0o644 });
      restrictBackupFile(fs, dest);
      expect(fs.statSync(dest).mode & 0o777).toBe(BACKUP_FILE_MODE);
    });

    it('throws when the artifact is missing, so the caller can clean up', () => {
      expect(() =>
        restrictBackupFile(fs, path.join(workDir, 'nope.sqlite')),
      ).toThrow();
    });
  });

  describe('removeBackupArtifact', () => {
    it('removes a partial artifact so it cannot take a rotation slot', () => {
      const dest = path.join(workDir, 'partial.sqlite');
      fs.writeFileSync(dest, 'half a database');
      removeBackupArtifact(fs, dest);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it('removes the WAL sidecars too, so they cannot take a rotation slot', () => {
      // Rotation selects by filename PREFIX, and `<name>.sqlite-wal` shares the
      // backup's prefix while sorting after it. Leaving the sidecars behind
      // evicts a real backup just as surely as leaving a partial file does.
      const dest = path.join(workDir, 'partial.sqlite');
      fs.writeFileSync(dest, 'half a database');
      fs.writeFileSync(`${dest}-wal`, 'wal');
      fs.writeFileSync(`${dest}-shm`, 'shm');
      removeBackupArtifact(fs, dest);
      expect(fs.readdirSync(workDir)).toEqual([]);
    });

    it('still removes the main file when a sidecar resists removal', () => {
      const removed: string[] = [];
      const partlyThrowing: BackupArtifactFs = {
        existsSync: () => true,
        mkdirSync: () => undefined,
        chmodSync: () => undefined,
        rmdirSync: () => undefined,
        realpathSync: (target: string) => target,
        statSync: () => ({ size: 0 }),
        unlinkSync: (target: string) => {
          if (target.endsWith('-wal')) throw new Error('EBUSY');
          removed.push(target);
        },
      };
      removeBackupArtifact(partlyThrowing, 'copy.sqlite');
      expect(removed).toEqual(['copy.sqlite', 'copy.sqlite-shm']);
    });

    it('does nothing when there is no artifact', () => {
      const dest = path.join(workDir, 'never-created.sqlite');
      expect(() => removeBackupArtifact(fs, dest)).not.toThrow();
      expect(fs.existsSync(dest)).toBe(false);
    });

    it('never throws when the unlink itself fails', () => {
      // It runs on the failure path, where a second failure would replace the
      // verdict the caller is already returning.
      const throwing: BackupArtifactFs = {
        existsSync: () => true,
        mkdirSync: () => undefined,
        chmodSync: () => undefined,
        rmdirSync: () => undefined,
        realpathSync: (target: string) => target,
        statSync: () => ({ size: 0 }),
        unlinkSync: () => {
          throw new Error('EBUSY');
        },
      };
      expect(() => removeBackupArtifact(throwing, 'anything')).not.toThrow();
    });
  });
});
