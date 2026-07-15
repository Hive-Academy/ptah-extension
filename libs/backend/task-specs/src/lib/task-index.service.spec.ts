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
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { TaskScannerService } from './task-scanner.service';
import { InMemoryTaskIndexStore } from './task-index.store';
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
  fireChange!: (p: string) => void;
  fireCreate!: (p: string) => void;
  fireDelete!: (p: string) => void;

  setFile(p: string, content: string): void {
    this.files.set(norm(p), content);
  }

  deleteFile(p: string): void {
    this.files.delete(norm(p));
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

function buildService(fs: FakeFs): TaskIndexService {
  const logger = makeLogger();
  const scanner = new TaskScannerService(
    fs as unknown as IFileSystemProvider,
    logger,
  );
  const store = new InMemoryTaskIndexStore(logger);
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
