/**
 * TaskIndexService — unit specs.
 *
 * Uses a purpose-built in-memory `IFileSystemProvider` fake with a FIREABLE
 * watcher (the shared platform-core mock exposes no fire handle) plus the real
 * `InMemoryTaskIndexStore` and `TaskScannerService`. Covers: lazy start,
 * debounce coalescing (N events → 1 flush + 1 event, NFR-2), write-order
 * (`applyFolderChange` → 'write' event), rebuild equivalence, and detail read.
 */
import 'reflect-metadata';
import * as path from 'path';
import {
  FileType,
  createEvent,
  type IFileSystemProvider,
  type IFileWatcher,
  type DirectoryEntry,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SPECS_README_FILE,
  renderSpecsReadme,
  roundJudgeFile,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { TaskScannerService } from './task-scanner.service';
import {
  InMemoryTaskIndexStore,
  type ITaskIndexStore,
} from './task-index.store';
import {
  TaskIndexService,
  type TaskIndexChangeEvent,
} from './task-index.service';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const ROOT = 'd:/tmp/ws-index-svc';

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Minimal fireable in-memory file system. */
class FakeFs implements Partial<IFileSystemProvider> {
  private readonly files = new Map<string, string>();
  /** Every path passed to `writeFile`, in order — lets specs assert on writes. */
  readonly writes: string[] = [];
  fireChange!: (p: string) => void;
  fireCreate!: (p: string) => void;
  fireDelete!: (p: string) => void;

  setFile(p: string, content: string): void {
    this.files.set(norm(p), content);
  }

  deleteFile(p: string): void {
    this.files.delete(norm(p));
  }

  async writeFile(p: string, content: string): Promise<void> {
    this.writes.push(norm(p));
    this.files.set(norm(p), content);
  }

  async exists(p: string): Promise<boolean> {
    const n = norm(p);
    if (this.files.has(n)) return true;
    for (const key of this.files.keys()) {
      if (key.startsWith(`${n}/`)) return true;
    }
    return false;
  }

  async readFile(p: string): Promise<string> {
    const n = norm(p);
    const content = this.files.get(n);
    if (content === undefined) throw new Error(`ENOENT ${n}`);
    return content;
  }

  async readDirectory(dir: string): Promise<DirectoryEntry[]> {
    const d = norm(dir);
    const children = new Map<string, FileType>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(`${d}/`)) continue;
      const rest = key.slice(d.length + 1);
      const seg = rest.split('/')[0];
      const isFile = rest.indexOf('/') === -1;
      children.set(seg, isFile ? FileType.File : FileType.Directory);
    }
    return [...children.entries()].map(([name, type]) => ({ name, type }));
  }

  createFileWatcher(): IFileWatcher {
    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();
    this.fireChange = fireChange;
    this.fireCreate = fireCreate;
    this.fireDelete = fireDelete;
    return { onDidChange, onDidCreate, onDidDelete, dispose: jest.fn() };
  }
}

function specsDir(): string {
  return path.join(normalizeWorkspaceRoot(ROOT), '.ptah', 'specs');
}

function carrier(folder: string): string {
  return path.join(specsDir(), folder, 'task.md');
}

function validTask(id: string): string {
  return `---\nstatus: backlog\ntype: FEATURE\ntitle: ${id}\ncreated: 2026-07-14T10:00:00.000Z\nupdated: 2026-07-14T10:00:00.000Z\n---\nbody of ${id}`;
}

function buildServiceWithParts(fs: FakeFs): {
  service: TaskIndexService;
  scanner: TaskScannerService;
} {
  const logger = makeLogger();
  const scanner = new TaskScannerService(
    fs as unknown as IFileSystemProvider,
    logger,
  );
  const store = new InMemoryTaskIndexStore(logger);
  const service = new TaskIndexService(
    logger,
    fs as unknown as IFileSystemProvider,
    scanner,
    store,
  );
  return { service, scanner };
}

function buildService(fs: FakeFs): TaskIndexService {
  return buildServiceWithParts(fs).service;
}

/** Same wiring, but with a caller-owned logger + store so both can be asserted on. */
function buildServiceWith(
  fs: FakeFs,
  logger: Logger,
  store: ITaskIndexStore,
): TaskIndexService {
  const scanner = new TaskScannerService(
    fs as unknown as IFileSystemProvider,
    logger,
  );
  return new TaskIndexService(
    logger,
    fs as unknown as IFileSystemProvider,
    scanner,
    store,
  );
}

function seedTwoValidOneExcluded(fs: FakeFs): void {
  fs.setFile(carrier('TASK_2026_001'), validTask('TASK_2026_001'));
  fs.setFile(carrier('TASK_2026_002'), validTask('TASK_2026_002'));
  // Folder present but no task.md carrier → excluded (no_carrier).
  fs.setFile(path.join(specsDir(), 'TASK_2026_003', 'context.md'), 'notes');
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('TaskIndexService.ensureStarted', () => {
  it('lazily indexes the workspace and exposes it via list()', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);

    await service.ensureStarted(ROOT);
    const result = await service.list(ROOT);

    expect(result.specsDirExists).toBe(true);
    expect(result.tasks.map((t) => t.id).sort()).toEqual([
      'TASK_2026_001',
      'TASK_2026_002',
    ]);
    expect(result.excludedCount).toBe(1);
    service.dispose();
  });

  it('collapses two CONCURRENT calls into one rebuild and one README write', async () => {
    // Since step 11 the host warms the index at activation while `tasks:*`
    // RPCs still call `ensureStarted` themselves — the two now race on the
    // very first call (R4).
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const { service, scanner } = buildServiceWithParts(fs);
    const scanSpy = jest.spyOn(scanner, 'scan');

    await Promise.all([
      service.ensureStarted(ROOT),
      service.ensureStarted(ROOT),
    ]);

    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(fs.writes).toEqual([norm(path.join(specsDir(), SPECS_README_FILE))]);
    service.dispose();
  });

  it('the joining caller sees a WARMED index, not an empty one', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);

    const first = service.ensureStarted(ROOT);
    // Second caller starts while the first is still warming.
    await service.ensureStarted(ROOT);
    const result = await service.list(ROOT);
    await first;

    expect(result.tasks).toHaveLength(2);
    service.dispose();
  });

  it('does not latch `started` when the index write fails, so a later call retries', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const scanner = new TaskScannerService(
      fs as unknown as IFileSystemProvider,
      logger,
    );
    const store = new InMemoryTaskIndexStore(logger);
    // Mirrors an Electron/CLI boot where the SQLite connection is not open yet.
    const replace = jest
      .spyOn(store, 'replaceWorkspace')
      .mockImplementationOnce(() => {
        throw new Error('PERSISTENCE_UNAVAILABLE');
      });
    const service = new TaskIndexService(
      logger,
      fs as unknown as IFileSystemProvider,
      scanner,
      store,
    );

    await service.ensureStarted(ROOT);
    expect(replace).toHaveBeenCalledTimes(1);

    // The store is healthy now — the next call must actually warm up.
    await service.ensureStarted(ROOT);
    expect(replace).toHaveBeenCalledTimes(2);
    expect((await service.list(ROOT)).tasks).toHaveLength(2);

    service.dispose();
  });

  it('does not emit an event for the silent warm-up', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);
    const events: TaskIndexChangeEvent[] = [];
    service.onDidChangeIndex((e) => events.push(e));

    await service.ensureStarted(ROOT);

    expect(events).toHaveLength(0);
    service.dispose();
  });
});

/**
 * TASK_2026_306 task 4.4 — the offline-store guard.
 *
 * Electron and the CLI both register the store in the same DI pass as the
 * activation warm-up and open the SQLite connection hundreds of log lines later,
 * so the first warm-up is GUARANTEED to be running against a store that cannot
 * accept a write. Asking `isReady()` first turns that from a caught failure
 * (WARN on every clean boot) into a skipped write (DEBUG), without touching the
 * scan, the README, or the recovery latch — and without covering for a store
 * that claimed readiness and failed anyway.
 */
describe('TaskIndexService rebuild — offline-store guard', () => {
  function offlineStore(logger: Logger): {
    store: InMemoryTaskIndexStore;
    isReady: jest.SpyInstance<boolean, []>;
    replace: jest.SpyInstance;
  } {
    const store = new InMemoryTaskIndexStore(logger);
    return {
      store,
      isReady: jest.spyOn(store, 'isReady').mockReturnValue(false),
      replace: jest.spyOn(store, 'replaceWorkspace'),
    };
  }

  it('skips the write ENTIRELY when the store is not ready', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const { store, replace } = offlineStore(logger);
    const service = buildServiceWith(fs, logger, store);

    await service.ensureStarted(ROOT);

    expect(replace).not.toHaveBeenCalled();
    service.dispose();
  });

  /**
   * The whole point of 4.4: `Persistence is offline` was a PREDICTED failure
   * being reported in the channel reserved for unpredicted ones. Nothing on a
   * clean boot may reach `logger.warn` any more.
   */
  it('emits no WARN at all on the too-early first warm-up', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const { store } = offlineStore(logger);
    const service = buildServiceWith(fs, logger, store);

    await service.ensureStarted(ROOT);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('index rebuild write skipped'),
    );
    service.dispose();
  });

  /**
   * The reason this fix was chosen over deferring the whole warm-up: on a host
   * where the connection NEVER opens (ABI mismatch, missing native binary) the
   * contract doc must still land. Skipping only the write keeps that free.
   */
  it('still writes the specs README when the store is not ready', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const { store } = offlineStore(logger);
    const service = buildServiceWith(fs, logger, store);

    await service.ensureStarted(ROOT);

    expect(fs.writes).toEqual([norm(path.join(specsDir(), SPECS_README_FILE))]);
    expect(await fs.readFile(path.join(specsDir(), SPECS_README_FILE))).toBe(
      renderSpecsReadme(),
    );
    service.dispose();
  });

  /**
   * `specsDirExists` is written by `rebuild` from the scan, and
   * `ensureSpecsReadme` early-returns on it. A guard that skipped the scan too
   * would silently take the README with it — this is the assertion that proves
   * it did not.
   */
  it('still records specsDirExists from the scan when the store is not ready', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const { store } = offlineStore(logger);
    const service = buildServiceWith(fs, logger, store);

    await service.ensureStarted(ROOT);

    expect((await service.list(ROOT)).specsDirExists).toBe(true);
    service.dispose();
  });

  it('performs the real rebuild once the store reports ready', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const { store, isReady, replace } = offlineStore(logger);
    const service = buildServiceWith(fs, logger, store);

    await service.ensureStarted(ROOT);
    expect(replace).not.toHaveBeenCalled();

    // What `startTaskSpecsIndex`'s `onDidOpen` subscription triggers.
    isReady.mockReturnValue(true);
    await service.ensureStarted(ROOT);

    expect(replace).toHaveBeenCalledTimes(1);
    expect((await service.list(ROOT)).tasks).toHaveLength(2);
    expect(logger.warn).not.toHaveBeenCalled();
    service.dispose();
  });

  it('writes without a skip log when the store is ready from the start', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const store = new InMemoryTaskIndexStore(logger);
    const replace = jest.spyOn(store, 'replaceWorkspace');
    const service = buildServiceWith(fs, logger, store);

    await service.ensureStarted(ROOT);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect((await service.list(ROOT)).tasks).toHaveLength(2);
    service.dispose();
  });

  /**
   * The guard removes ONE predicted failure from the warn channel. A store that
   * reported readiness and then failed — closed connection, full disk, corrupt
   * page — is unpredicted and must still be loud.
   */
  it('still WARNs when a store that reported READY fails the write anyway', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const logger = makeLogger();
    const store = new InMemoryTaskIndexStore(logger);
    jest.spyOn(store, 'replaceWorkspace').mockImplementation(() => {
      throw new Error('SQLITE_FULL: database or disk is full');
    });
    const service = buildServiceWith(fs, logger, store);

    await service.ensureStarted(ROOT);

    expect(logger.warn).toHaveBeenCalledWith(
      '[task-specs] index rebuild write failed',
      { error: 'SQLITE_FULL: database or disk is full' },
    );
    service.dispose();
  });
});

describe('TaskIndexService specs README (self-write suppression)', () => {
  function readmePath(): string {
    return path.join(specsDir(), SPECS_README_FILE);
  }

  it('writes the README with EXACTLY ONE rebuild (no self-triggered loop)', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const { service, scanner } = buildServiceWithParts(fs);
    const scanSpy = jest.spyOn(scanner, 'scan');

    await service.ensureStarted(ROOT);

    // The README lands in the very directory this service watches. If the
    // write re-entered the watcher we would see a second scan here.
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(fs.writes).toEqual([norm(readmePath())]);
    expect(await fs.readFile(readmePath())).toBe(renderSpecsReadme());
    service.dispose();
  });

  it('performs ZERO writes on a later start when the content already matches', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const first = buildService(fs);
    await first.ensureStarted(ROOT);
    first.dispose();
    expect(fs.writes).toHaveLength(1);

    fs.writes.length = 0;
    const second = buildService(fs);
    await second.ensureStarted(ROOT);

    expect(fs.writes).toEqual([]);
    second.dispose();
  });

  it('ignores watcher events for the generated README', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const fs = new FakeFs();
      seedTwoValidOneExcluded(fs);
      const service = buildService(fs);
      const events: TaskIndexChangeEvent[] = [];
      service.onDidChangeIndex((e) => events.push(e));

      await service.ensureStarted(ROOT);
      fs.fireChange(readmePath());
      fs.fireCreate(readmePath());

      jest.advanceTimersByTime(300);
      await flush();

      expect(events).toHaveLength(0);
      service.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not materialize .ptah/specs when the workspace has no specs dir', async () => {
    const fs = new FakeFs();
    const service = buildService(fs);

    await service.ensureStarted(ROOT);

    expect(fs.writes).toEqual([]);
    expect(await fs.exists(readmePath())).toBe(false);
    service.dispose();
  });
});

describe('TaskIndexService watcher debounce', () => {
  it('coalesces a burst of N events into ONE flush + ONE event', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const fs = new FakeFs();
      seedTwoValidOneExcluded(fs);
      const service = buildService(fs);
      const events: TaskIndexChangeEvent[] = [];
      service.onDidChangeIndex((e) => events.push(e));

      await service.ensureStarted(ROOT);
      fs.setFile(carrier('TASK_2026_004'), validTask('TASK_2026_004'));

      fs.fireChange(carrier('TASK_2026_004'));
      fs.fireChange(carrier('TASK_2026_004'));
      fs.fireCreate(carrier('TASK_2026_004'));
      expect(events).toHaveLength(0); // still debouncing

      jest.advanceTimersByTime(300);
      await flush();
      await flush();

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe('watcher');
      expect(events[0].folderNames).toEqual(['TASK_2026_004']);
      service.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores registry.md and .archive/ watcher events', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const fs = new FakeFs();
      seedTwoValidOneExcluded(fs);
      const service = buildService(fs);
      const events: TaskIndexChangeEvent[] = [];
      service.onDidChangeIndex((e) => events.push(e));

      await service.ensureStarted(ROOT);
      fs.fireChange(path.join(specsDir(), 'registry.md'));
      fs.fireChange(path.join(specsDir(), '.archive', 'TASK_OLD', 'task.md'));

      jest.advanceTimersByTime(300);
      await flush();

      expect(events).toHaveLength(0);
      service.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('TaskIndexService write-order (applyFolderChange)', () => {
  it('reparses the changed folder and emits a write event', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);
    const events: TaskIndexChangeEvent[] = [];
    service.onDidChangeIndex((e) => events.push(e));

    await service.ensureStarted(ROOT);
    fs.setFile(carrier('TASK_2026_007'), validTask('TASK_2026_007'));
    await service.applyFolderChange(ROOT, 'TASK_2026_007');

    const list = await service.list(ROOT);
    expect(list.tasks.map((t) => t.id)).toContain('TASK_2026_007');
    const writeEvents = events.filter((e) => e.reason === 'write');
    expect(writeEvents).toHaveLength(1);
    expect(writeEvents[0].folderNames).toEqual(['TASK_2026_007']);
    service.dispose();
  });
});

describe('TaskIndexService.reindex', () => {
  it('is equivalent to the watch-updated index (rebuild equivalence)', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);

    await service.ensureStarted(ROOT);
    fs.setFile(carrier('TASK_2026_008'), validTask('TASK_2026_008'));
    await service.applyFolderChange(ROOT, 'TASK_2026_008');
    const afterWatch = (await service.list(ROOT)).tasks;

    const res = await service.reindex(ROOT);
    const afterReindex = (await service.list(ROOT)).tasks;

    expect(res.indexedCount).toBe(3);
    expect(res.excludedCount).toBe(1);
    expect(afterReindex).toEqual(afterWatch);
    service.dispose();
  });
});

describe('TaskIndexService.getDetail', () => {
  it('returns body + folder artifacts for a valid task', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);

    const detail = await service.getDetail(ROOT, 'TASK_2026_001');

    expect(detail).not.toBeNull();
    expect(detail?.body).toContain('body of TASK_2026_001');
    expect(detail?.artifacts).toContain('task.md');
    service.dispose();
  });

  it('returns null for a missing task', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);

    expect(await service.getDetail(ROOT, 'TASK_2026_999')).toBeNull();
    service.dispose();
  });
});

describe('TaskIndexService.readRoundJudge', () => {
  function seedJudge(fs: FakeFs, folder: string, round: number): void {
    fs.setFile(carrier(folder), validTask(folder));
    fs.setFile(
      path.join(specsDir(), folder, roundJudgeFile(round)),
      `## VERDICT\n\nREVISE (round ${round})`,
    );
  }

  it('reads the report for the requested round', async () => {
    const fs = new FakeFs();
    seedJudge(fs, 'TASK_2026_001', 1);
    const service = buildService(fs);

    await expect(
      service.readRoundJudge(ROOT, 'TASK_2026_001', 1),
    ).resolves.toBe('## VERDICT\n\nREVISE (round 1)');
    service.dispose();
  });

  /**
   * The path must be COMPOSED from the shared contract, never hand-written —
   * Duty 1 of the contract guard permits the literal only in
   * `task-spec.contract.ts`. Asserting against `roundJudgeFile()` rather than
   * against a string here is what makes a drift in the contract fail this test
   * instead of silently reading a file that no longer exists.
   */
  it('composes the filename via roundJudgeFile(), not a literal', async () => {
    const fs = new FakeFs();
    fs.setFile(carrier('TASK_2026_001'), validTask('TASK_2026_001'));
    fs.setFile(
      path.join(specsDir(), 'TASK_2026_001', roundJudgeFile(2)),
      'round two',
    );
    const service = buildService(fs);

    await expect(
      service.readRoundJudge(ROOT, 'TASK_2026_001', 2),
    ).resolves.toBe('round two');
    // Round 1 shares the folder but not the name — proves `round` selects.
    await expect(
      service.readRoundJudge(ROOT, 'TASK_2026_001', 1),
    ).resolves.toBeNull();
    service.dispose();
  });

  /**
   * An unjudged round is the ORDINARY state of a run in progress, not a fault.
   * Round 2 has no report while round 1 is still being revised.
   */
  it('returns null for an unjudged round rather than throwing', async () => {
    const fs = new FakeFs();
    seedJudge(fs, 'TASK_2026_001', 1);
    const service = buildService(fs);

    await expect(
      service.readRoundJudge(ROOT, 'TASK_2026_001', 3),
    ).resolves.toBeNull();
    service.dispose();
  });

  it('returns null for a folder that does not exist', async () => {
    const fs = new FakeFs();
    seedTwoValidOneExcluded(fs);
    const service = buildService(fs);

    await expect(
      service.readRoundJudge(ROOT, 'TASK_2026_999', 1),
    ).resolves.toBeNull();
    service.dispose();
  });
});
