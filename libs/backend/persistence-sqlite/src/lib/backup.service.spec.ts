/**
 * SqliteBackupService specs (TASK_2026_383 Batch 7).
 *
 * THE SEAM IS A STUB WORKER FACTORY, not a validation-factory setter. The
 * service no longer opens a database at all: it computes a destination, posts
 * one `backup` request, and maps the verdict that comes back. Stubbing the
 * worker is therefore the truer seam — it is the same port the host implements,
 * so a test drives exactly what production drives.
 *
 * A REAL TEMP DIRECTORY IS USED THROUGHOUT, because the properties under test
 * are filesystem facts: which file survives a failed backup, and what rotation
 * can see. The stub worker writes a small placeholder at `destPath` where the
 * real one would write a copy, which is enough for every one of those.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SqliteBackupService, BACKUP_WORKER_BUDGET_MS } from './backup.service';
import { PERSISTENCE_TOKENS } from './di/tokens';
import { DbWorkerRunner } from './integrity/db-worker-runner';
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from './integrity/worker-process.port';
import type {
  BackupRequest,
  BackupResponse,
} from './integrity/integrity-worker-protocol';
import { createMockLogger } from './testing/mock-logger';

// `chmod` mode bits do not exist on Windows: Node's `chmodSync` there only
// touches the read-only bit, so `statSync().mode` never reports 0o600. Named to
// match `integrity-worker-protocol.spec.ts:374`, so a grep for one finds both.
const itPosix = process.platform === 'win32' ? it.skip : it;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-backup-test-'));
}

/** Let every pending microtask and I/O callback drain. Real timers only. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Write the copy plus the `-wal` / `-shm` sidecars a write-mode validation
 * session leaves behind, so a discard path can be asserted to remove all three.
 */
function seedArtifactWithSidecars(destPath: string): void {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  for (const target of [destPath, `${destPath}-wal`, `${destPath}-shm`]) {
    fs.writeFileSync(target, 'placeholder');
  }
}

/** The reply a healthy worker sends for a copy that landed and validated. */
function okReply(request: BackupRequest, bytesWritten = 4096): BackupResponse {
  return {
    id: request.id,
    type: 'backup',
    ok: true,
    verdict: 'ok',
    bytesWritten,
    durationMs: 120,
    quickCheck: 'ok',
    detail: null,
  };
}

interface DegradationLike {
  source: string;
  code: string;
  severity: string;
  summary: string;
  detail?: string;
}

/**
 * How the stub worker behaves when it receives the request.
 *
 * `respond` posts a reply; `exit` emits the exit event without one. A script
 * that does neither leaves the run to the budget, which no case here needs.
 */
type WorkerScript = (
  request: BackupRequest,
  respond: (msg: unknown) => void,
  exit: () => void,
) => void;

interface Harness {
  tmpDir: string;
  dbPath: string;
  service: SqliteBackupService;
  logger: ReturnType<typeof createMockLogger>;
  reports: DegradationLike[];
  requests: BackupRequest[];
  spawnCount: () => number;
}

function makeHarness(opts?: {
  withFactory?: boolean;
  withReporter?: boolean;
  spawnThrows?: boolean;
  script?: WorkerScript;
}): Harness {
  const tmpDir = makeTempDir();
  const dbPath = path.join(tmpDir, 'ptah.sqlite');
  fs.writeFileSync(dbPath, 'source-database-placeholder');
  const logger = createMockLogger();
  const reports: DegradationLike[] = [];
  const requests: BackupRequest[] = [];
  let spawnCount = 0;

  // Default script: the worker writes the copy and reports a clean verdict.
  const script: WorkerScript =
    opts?.script ??
    ((request, respond) => {
      fs.mkdirSync(path.dirname(request.destPath), { recursive: true });
      fs.writeFileSync(request.destPath, 'backup-copy-placeholder');
      respond(okReply(request));
    });

  const factory: IIntegrityWorkerProcessFactory = {
    spawn: () => {
      spawnCount += 1;
      if (opts?.spawnThrows) throw new Error('utilityProcess.fork failed');
      let onMessage: ((msg: unknown) => void) | null = null;
      let onExit: ((code: number | null) => void) | null = null;
      const worker: IIntegrityWorkerProcess = {
        postMessage: (msg: unknown) => {
          const request = msg as BackupRequest;
          requests.push(request);
          queueMicrotask(() =>
            script(
              request,
              (reply) => onMessage?.(reply),
              () => onExit?.(null),
            ),
          );
        },
        on: ((event: string, cb: (arg: never) => void) => {
          if (event === 'message') onMessage = cb as (msg: unknown) => void;
          if (event === 'exit') onExit = cb as (code: number | null) => void;
        }) as IIntegrityWorkerProcess['on'],
        kill: () => undefined,
      };
      return worker;
    },
  };

  const reporter = {
    report: (report: DegradationLike) => {
      reports.push(report);
    },
  };

  const service = new SqliteBackupService(
    dbPath,
    logger,
    new DbWorkerRunner(logger),
    opts?.withFactory === false ? null : factory,
    opts?.withReporter === false
      ? null
      : (reporter as unknown as ConstructorParameters<
          typeof SqliteBackupService
        >[4]),
  );

  return {
    tmpDir,
    dbPath,
    service,
    logger,
    reports,
    requests,
    spawnCount: () => spawnCount,
  };
}

// ── the happy path ──────────────────────────────────────────────────────────

describe('SqliteBackupService.backup — a clean verdict', () => {
  it('returns the destination path and leaves the file in place', async () => {
    const h = makeHarness();

    const result = await h.service.backup('pre-migration');

    expect(result).not.toBeNull();
    expect(result).toMatch(/ptah\.pre-migration-\d{8}T\d{6}Z\.sqlite$/);
    expect(result).toContain(h.tmpDir);
    expect(fs.existsSync(result as string)).toBe(true);
  });

  it('rotation is callable straight after, and keeps the returned file', async () => {
    // The two halves of the contract in one case: `backup()` only ever leaves
    // validated files behind, which is the invariant `rotate()` relies on.
    const h = makeHarness();

    const result = await h.service.backup('pre-migration');
    h.service.rotate('pre-migration', 3);

    expect(fs.existsSync(result as string)).toBe(true);
  });

  it('sends exactly one backup request carrying the injected dbPath', async () => {
    const h = makeHarness();

    const result = await h.service.backup('pre-migration');

    expect(h.spawnCount()).toBe(1);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toEqual({
      id: 1,
      type: 'backup',
      dbPath: h.dbPath,
      destPath: result,
    });
  });

  it('emits an info log on success', async () => {
    const h = makeHarness();
    await h.service.backup('pre-migration');
    expect(
      h.logger.entries.some(
        (e) => e.level === 'info' && /backup completed/.test(e.message),
      ),
    ).toBe(true);
  });

  it('places daily backups in a backups/ subdirectory', async () => {
    const h = makeHarness();

    const result = await h.service.backup('daily');

    expect(result).toContain(path.join(h.tmpDir, 'backups'));
    expect(result).toMatch(/ptah-\d{4}-\d{2}-\d{2}\.sqlite$/);
  });

  itPosix(
    "leaves the worker's 0600 lockdown untouched — the service never chmods",
    async () => {
      // The lockdown moved into the worker (`restrictBackupFile`, pinned at
      // `integrity-worker-protocol.spec.ts:446`). What must hold HERE is that
      // the service does not relax it on the way out: an artifact it returns
      // has exactly the permissions the worker gave it.
      const h = makeHarness({
        script: (request, respond) => {
          fs.mkdirSync(path.dirname(request.destPath), { recursive: true });
          fs.writeFileSync(request.destPath, 'backup-copy-placeholder');
          fs.chmodSync(request.destPath, 0o600);
          respond(okReply(request));
        },
      });

      const result = await h.service.backup('pre-migration');

      expect(fs.statSync(result as string).mode & 0o777).toBe(0o600);
    },
  );
});

// ── the four load-bearing failure verdicts ──────────────────────────────────

describe('SqliteBackupService.backup — no worker factory', () => {
  it('returns null, spawns nothing, and emits exactly one critical report', async () => {
    // No in-process fallback exists by design: a host with no worker takes no
    // backup, and says so loudly rather than quietly running the 27 s path.
    const h = makeHarness({ withFactory: false });

    const result = await h.service.backup('pre-migration');

    expect(result).toBeNull();
    expect(h.spawnCount()).toBe(0);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      source: 'database',
      code: 'database.backup.no-worker-factory',
      severity: 'critical',
    });
    expect(h.logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('writes no file anywhere', async () => {
    const h = makeHarness({ withFactory: false });
    await h.service.backup('pre-migration');
    expect(fs.readdirSync(h.tmpDir)).toEqual(['ptah.sqlite']);
  });

  it('does not throw when no degradation reporter is registered either', async () => {
    const h = makeHarness({ withFactory: false, withReporter: false });
    await expect(h.service.backup('pre-migration')).resolves.toBeNull();
  });
});

describe("SqliteBackupService.backup — an 'unavailable' verdict", () => {
  it('returns null and removes the artifact the worker kept', async () => {
    // The worker deliberately KEEPS a copy it could not validate and reports
    // `bytesWritten`. This class does not return that path, so the file must
    // not survive to take the newest rotation slot from a validated backup.
    let destPath = '';
    const h = makeHarness({
      script: (request, respond) => {
        destPath = request.destPath;
        fs.writeFileSync(request.destPath, 'unvalidated-copy');
        respond({
          ...okReply(request, 4096),
          verdict: 'unavailable',
          quickCheck: '',
          detail: 'Cannot find module better-sqlite3',
        });
      },
    });

    const result = await h.service.backup('pre-migration');

    expect(result).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('emits one critical report carrying the worker detail', async () => {
    const h = makeHarness({
      script: (request, respond) => {
        fs.writeFileSync(request.destPath, 'unvalidated-copy');
        respond({
          ...okReply(request, 4096),
          verdict: 'unavailable',
          quickCheck: '',
          detail: 'Cannot find module better-sqlite3',
        });
      },
    });

    await h.service.backup('pre-migration');

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      code: 'database.backup.not-taken',
      severity: 'critical',
      detail: 'Cannot find module better-sqlite3',
    });
  });
});

describe("SqliteBackupService.backup — a 'corrupt' verdict", () => {
  it('returns null and deletes the artifact', async () => {
    let destPath = '';
    const h = makeHarness({
      script: (request, respond) => {
        destPath = request.destPath;
        // The real worker unlinks a corrupt copy itself; a leftover here
        // proves this class does not depend on that having happened.
        fs.writeFileSync(request.destPath, 'bad-copy');
        respond({
          ...okReply(request, 0),
          verdict: 'corrupt',
          quickCheck: 'row 42 missing from index',
          detail: 'row 42 missing from index',
        });
      },
    });

    const result = await h.service.backup('pre-migration');

    expect(result).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
    expect(
      h.logger.entries.some(
        (e) => e.level === 'warn' && /integrity check failed/.test(e.message),
      ),
    ).toBe(true);
  });

  it('does NOT report a degradation — a corrupt copy is a definite answer', async () => {
    // `'corrupt'` means the question was asked and answered. That is a warning
    // about the data, not a lost capability, and conflating the two would make
    // the degradation tally mean two different things.
    const h = makeHarness({
      script: (request, respond) => {
        fs.writeFileSync(request.destPath, 'bad-copy');
        respond({ ...okReply(request, 0), verdict: 'corrupt' });
      },
    });

    await h.service.backup('pre-migration');

    expect(h.reports).toHaveLength(0);
  });
});

describe('SqliteBackupService.backup — the worker never answers', () => {
  it('an exit before a reply returns null, clears the artifact and reports', async () => {
    let destPath = '';
    const h = makeHarness({
      script: (request, _respond, exit) => {
        destPath = request.destPath;
        fs.writeFileSync(request.destPath, 'partial-copy');
        exit();
      },
    });

    const result = await h.service.backup('pre-migration');

    expect(result).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0].code).toBe('database.backup.not-taken');
  });

  it('an unrecognised reply shape is inconclusive, not a verdict', async () => {
    const h = makeHarness({
      script: (request, respond) => {
        fs.writeFileSync(request.destPath, 'copy');
        respond({ id: 1, ok: true, verdict: 'fine' });
      },
    });

    await expect(h.service.backup('pre-migration')).resolves.toBeNull();
  });

  it('rotate() does not evict a valid backup after a failed attempt', async () => {
    // The whole reason cleanup lives in `backup()`: a partial file carries the
    // NEWEST timestamp, so it would take a keep slot and evict a good backup.
    const h = makeHarness({
      script: (request, _respond, exit) => {
        fs.writeFileSync(request.destPath, 'partial-copy');
        exit();
      },
    });
    const good = path.join(
      h.tmpDir,
      'ptah.pre-migration-20250101T120000Z.sqlite',
    );
    fs.writeFileSync(good, 'good-backup');

    await h.service.backup('pre-migration');
    h.service.rotate('pre-migration', 1);

    expect(fs.existsSync(good)).toBe(true);
  });
});

describe('SqliteBackupService.backup — sidecar cleanup', () => {
  /**
   * `-wal` and `-shm` are what a run killed from OUTSIDE leaves behind: the
   * worker validates the copy read-write, and a budget expiry or an early exit
   * tears the process down before `performBackup`'s own cleanup can run. If the
   * host does not remove them, nothing ever will.
   */
  const sidecarCases: Array<{
    name: string;
    script: WorkerScript;
  }> = [
    {
      name: 'a worker that exits before replying',
      script: (request, _respond, exit) => {
        seedArtifactWithSidecars(request.destPath);
        exit();
      },
    },
    {
      name: "an 'unavailable' verdict",
      script: (request, respond) => {
        seedArtifactWithSidecars(request.destPath);
        respond({
          ...okReply(request, 4096),
          verdict: 'unavailable',
          detail: 'could not validate the copy',
        });
      },
    },
    {
      name: "a 'corrupt' verdict",
      script: (request, respond) => {
        seedArtifactWithSidecars(request.destPath);
        respond({ ...okReply(request, 0), verdict: 'corrupt' });
      },
    },
  ];

  for (const { name, script } of sidecarCases) {
    it(`removes the copy AND both sidecars after ${name}`, async () => {
      let destPath = '';
      const h = makeHarness({
        script: (request, respond, exit) => {
          destPath = request.destPath;
          script(request, respond, exit);
        },
      });

      const result = await h.service.backup('pre-migration');

      expect(result).toBeNull();
      expect(fs.existsSync(destPath)).toBe(false);
      expect(fs.existsSync(`${destPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${destPath}-shm`)).toBe(false);
    });
  }

  it('removes the copy AND both sidecars when the budget expires', async () => {
    // The path the worker itself can never clean up: the kill comes from the
    // runner, so nothing inside the worker gets to run its own cleanup.
    jest.useFakeTimers();
    try {
      let destPath = '';
      const h = makeHarness({
        // Seeds the artifact and then says nothing at all.
        script: (request) => {
          destPath = request.destPath;
          seedArtifactWithSidecars(request.destPath);
        },
      });

      const pending = h.service.backup('pre-migration');
      await jest.advanceTimersByTimeAsync(BACKUP_WORKER_BUDGET_MS);

      await expect(pending).resolves.toBeNull();
      expect(fs.existsSync(destPath)).toBe(false);
      expect(fs.existsSync(`${destPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${destPath}-shm`)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SqliteBackupService.backup — overlapping calls', () => {
  it('SERIALIZES two overlapping backups — one worker at a time, both results delivered', async () => {
    // The ruling is serialize, not reject: a pre-migration backup must never be
    // skipped because the daily job happened to be running, and vice versa.
    const release: Array<() => void> = [];
    let live = 0;
    let maxLive = 0;
    const h = makeHarness({
      script: (request, respond) => {
        live += 1;
        maxLive = Math.max(maxLive, live);
        release.push(() => {
          fs.mkdirSync(path.dirname(request.destPath), { recursive: true });
          fs.writeFileSync(request.destPath, 'copy');
          live -= 1;
          respond(okReply(request));
        });
      },
    });

    const first = h.service.backup('pre-migration');
    const second = h.service.backup('daily');

    // The first has reached the worker; the second has not been spawned at all.
    await flush();
    expect(h.spawnCount()).toBe(1);
    expect(release).toHaveLength(1);

    release[0]();
    await flush();
    expect(h.spawnCount()).toBe(2);
    expect(release).toHaveLength(2);

    release[1]();
    const [firstPath, secondPath] = await Promise.all([first, second]);

    // Both callers got a real answer, and the two runs never overlapped.
    expect(maxLive).toBe(1);
    expect(firstPath).not.toBeNull();
    expect(secondPath).not.toBeNull();
    expect(firstPath).not.toBe(secondPath);
    expect(h.requests.map((r) => r.destPath)).toEqual([firstPath, secondPath]);
  });

  it('a failed backup does not wedge the queue for the next one', async () => {
    let calls = 0;
    const h = makeHarness({
      script: (request, respond, exit) => {
        calls += 1;
        if (calls === 1) {
          exit();
          return;
        }
        fs.writeFileSync(request.destPath, 'copy');
        respond(okReply(request));
      },
    });

    const [failed, succeeded] = await Promise.all([
      h.service.backup('pre-migration'),
      h.service.backup('pre-migration'),
    ]);

    expect(failed).toBeNull();
    expect(succeeded).not.toBeNull();
  });
});

describe('SqliteBackupService.backup — never throws', () => {
  it('resolves null when the factory throws on spawn', async () => {
    const h = makeHarness({ spawnThrows: true });
    await expect(h.service.backup('pre-migration')).resolves.toBeNull();
  });

  it('resolves null when the worker replies with a thrown-shaped payload', async () => {
    const h = makeHarness({
      script: (_request, respond) => {
        respond(null);
      },
    });
    await expect(h.service.backup('daily')).resolves.toBeNull();
  });
});

// ── rotation ────────────────────────────────────────────────────────────────

describe('SqliteBackupService.rotate', () => {
  function seed(tmpDir: string, names: string[]): void {
    for (const name of names) {
      fs.writeFileSync(path.join(tmpDir, name), 'placeholder');
    }
  }

  it('keeps the 3 newest pre-migration files and deletes the rest', () => {
    const h = makeHarness();
    const names = [
      'ptah.pre-migration-20250101T120000Z.sqlite',
      'ptah.pre-migration-20250102T120000Z.sqlite',
      'ptah.pre-migration-20250103T120000Z.sqlite',
      'ptah.pre-migration-20250104T120000Z.sqlite',
      'ptah.pre-migration-20250105T120000Z.sqlite',
    ];
    seed(h.tmpDir, names);

    h.service.rotate('pre-migration', 3);

    const remaining = fs
      .readdirSync(h.tmpDir)
      .filter((f) => f.startsWith('ptah.pre-migration-'));
    expect(remaining.sort()).toEqual(names.slice(2).sort());
  });

  it('never counts a -wal or -shm sidecar as a backup', () => {
    // A read-write validation connection can leave `<file>-wal` / `-shm`
    // beside the artifact. They carry the backup's own prefix and sort AFTER
    // it, so if rotation counted them they would take keep slots and evict
    // real backups. The `.sqlite` suffix test is what stops that.
    const h = makeHarness();
    const real = [
      'ptah.pre-migration-20250101T120000Z.sqlite',
      'ptah.pre-migration-20250102T120000Z.sqlite',
    ];
    seed(h.tmpDir, [
      ...real,
      'ptah.pre-migration-20250102T120000Z.sqlite-wal',
      'ptah.pre-migration-20250102T120000Z.sqlite-shm',
    ]);

    h.service.rotate('pre-migration', 2);

    for (const name of real) {
      expect(fs.existsSync(path.join(h.tmpDir, name))).toBe(true);
    }
  });

  it('is a no-op when keep=0 (unbounded retention)', () => {
    const h = makeHarness();
    const names = [
      'ptah.reset-20250101T120000Z.sqlite',
      'ptah.reset-20250102T120000Z.sqlite',
      'ptah.reset-20250103T120000Z.sqlite',
    ];
    seed(h.tmpDir, names);

    h.service.rotate('reset', 0);

    for (const name of names) {
      expect(fs.existsSync(path.join(h.tmpDir, name))).toBe(true);
    }
  });

  it('is a no-op when the file count is within the keep limit', () => {
    const h = makeHarness();
    const names = [
      'ptah.pre-migration-20250101T120000Z.sqlite',
      'ptah.pre-migration-20250102T120000Z.sqlite',
    ];
    seed(h.tmpDir, names);

    h.service.rotate('pre-migration', 3);

    for (const name of names) {
      expect(fs.existsSync(path.join(h.tmpDir, name))).toBe(true);
    }
  });

  it('is non-fatal when the backup directory does not exist', () => {
    const h = makeHarness();
    expect(() => h.service.rotate('daily', 7)).not.toThrow();
  });
});

// ── DI ──────────────────────────────────────────────────────────────────────

describe('SqliteBackupService — DI', () => {
  it('resolves with no worker factory and no degradation reporter registered', () => {
    // Both are `{ isOptional: true }`; a container that binds neither must
    // still produce a usable service rather than a resolution error.
    const tmpDir = makeTempDir();
    const child = container.createChildContainer();
    child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
      useValue: path.join(tmpDir, 'ptah.sqlite'),
    });
    child.register(TOKENS.LOGGER, { useValue: createMockLogger() });
    child.registerSingleton(
      PERSISTENCE_TOKENS.BACKUP_SERVICE,
      SqliteBackupService,
    );

    const resolved = child.resolve<SqliteBackupService>(
      PERSISTENCE_TOKENS.BACKUP_SERVICE,
    );

    expect(resolved).toBeInstanceOf(SqliteBackupService);
  });
});
