import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import * as path from 'path';
import { WorkspaceFileIndexService } from './workspace-file-index.service';

/**
 * Minimal file-watcher double: captures the create/change/delete listeners the
 * service registers and lets tests fire synthetic events, mirroring what a real
 * IFileWatcher does.
 */
class FakeWatcher {
  createListeners: Array<(p: string) => void> = [];
  changeListeners: Array<(p: string) => void> = [];
  deleteListeners: Array<(p: string) => void> = [];
  disposed = false;

  readonly onDidCreate = (l: (p: string) => void) => {
    this.createListeners.push(l);
    return { dispose: () => undefined };
  };
  readonly onDidChange = (l: (p: string) => void) => {
    this.changeListeners.push(l);
    return { dispose: () => undefined };
  };
  readonly onDidDelete = (l: (p: string) => void) => {
    this.deleteListeners.push(l);
    return { dispose: () => undefined };
  };
  dispose = () => {
    this.disposed = true;
  };

  fireCreate(p: string): void {
    this.createListeners.forEach((l) => l(p));
  }
  fireDelete(p: string): void {
    this.deleteListeners.forEach((l) => l(p));
  }
}

// Flush the microtask queue so the async onCreate/onChange handlers settle.
const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
};

const ROOT = path.join('/', 'workspace');
const abs = (rel: string): string => path.join(ROOT, rel);

interface HarnessOptions {
  files?: string[];
  isIgnored?: (relativePath: string) => boolean;
  parsedIgnoreFiles?: unknown[];
}

function makeHarness(opts: HarnessOptions = {}) {
  const files = opts.files ?? [
    abs('src/auth.service.ts'),
    abs('src/util/format.ts'),
    abs('README.md'),
    abs('logo.png'),
  ];

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const indexer = {
    // eslint-disable-next-line @typescript-eslint/require-await
    indexWorkspaceStream: async function* () {
      for (const p of files) {
        yield { path: p, relativePath: path.relative(ROOT, p) };
      }
    },
  };

  const watcher = new FakeWatcher();
  const fsProvider = {
    createFileWatcher: jest.fn(
      (_pattern: string, _options?: { exclude?: string[] }) => watcher,
    ),
  };

  const workspaceProvider = {
    getWorkspaceRoot: jest.fn(() => ROOT),
  };

  const ignoreResolver = {
    parseWorkspaceIgnoreFiles: jest.fn(
      async () => opts.parsedIgnoreFiles ?? [],
    ),
    isIgnored: jest.fn(async (relativePath: string) => ({
      ignored: opts.isIgnored ? opts.isIgnored(relativePath) : false,
    })),
  };

  const service = new WorkspaceFileIndexService(
    logger as never,
    indexer as never,
    fsProvider as never,
    workspaceProvider as never,
    ignoreResolver as never,
  );

  return { service, watcher, fsProvider, ignoreResolver, files };
}

describe('WorkspaceFileIndexService', () => {
  it('builds the in-memory index once from indexWorkspaceStream', async () => {
    const { service, fsProvider } = makeHarness();

    await service.start(ROOT);

    expect(service.isReady()).toBe(true);
    expect(service.fileCount).toBe(4);
    // Watcher wired with node_modules et al. excluded at the OS level.
    expect(fsProvider.createFileWatcher).toHaveBeenCalledWith(
      '**/*',
      expect.objectContaining({ exclude: expect.arrayContaining([]) }),
    );
    const excludeArg = fsProvider.createFileWatcher.mock.calls[0][1];
    expect(excludeArg?.exclude).toContain('**/node_modules/**');
  });

  it('start is idempotent for the same root (single build)', async () => {
    const { service, fsProvider } = makeHarness();
    await Promise.all([service.start(ROOT), service.start(ROOT)]);
    await service.start(ROOT);
    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);
  });

  it('search scores exact/prefix/substring matches and orders by relevance', async () => {
    const { service } = makeHarness({
      files: [abs('auth.ts'), abs('src/auth.service.ts'), abs('src/other.ts')],
    });
    await service.start(ROOT);

    const results = service.search('auth', 10);
    expect(results.map((r) => r.fileName)).toEqual([
      'auth.ts', // exact-ish + prefix wins
      'auth.service.ts',
    ]);
    // Non-matching files are excluded entirely.
    expect(results.some((r) => r.fileName === 'other.ts')).toBe(false);
  });

  it('getAll returns files then directories with 0 size/mtime', async () => {
    const { service } = makeHarness();
    await service.start(ROOT);

    const all = service.getAll(1000);
    const names = all.map((r) => r.fileName);
    expect(names).toContain('auth.service.ts');
    // Ancestor directories are tracked too.
    expect(names).toContain('src');
    expect(names).toContain('util');
    for (const r of all) {
      expect(r.size).toBe(0);
      expect(r.lastModified).toBe(0);
    }
  });

  it('searchDirectories matches indexed ancestor directories', async () => {
    const { service } = makeHarness();
    await service.start(ROOT);

    const dirs = service.searchDirectories('util', 10);
    expect(dirs.map((d) => d.fileName)).toContain('util');
    expect(dirs.every((d) => d.isDirectory)).toBe(true);
  });

  it('patches the index when a file is created', async () => {
    const { service, watcher } = makeHarness();
    await service.start(ROOT);
    expect(service.search('newfile', 10)).toHaveLength(0);

    watcher.fireCreate(abs('src/newfile.ts'));
    await flush();

    const results = service.search('newfile', 10);
    expect(results.map((r) => r.fileName)).toEqual(['newfile.ts']);
  });

  it('removes an entry from the index when a file is deleted', async () => {
    const { service, watcher } = makeHarness();
    await service.start(ROOT);
    expect(service.search('format', 10)).toHaveLength(1);

    watcher.fireDelete(abs('src/util/format.ts'));
    await flush();

    expect(service.search('format', 10)).toHaveLength(0);
  });

  it('does NOT index a created file under a default-excluded directory', async () => {
    const { service, watcher } = makeHarness();
    await service.start(ROOT);

    watcher.fireCreate(abs('node_modules/pkg/index.ts'));
    await flush();

    // node_modules/** is a DEFAULT_WORKSPACE_EXCLUDE → never enters the index.
    expect(service.search('index', 10)).toHaveLength(0);
    expect(service.fileCount).toBe(4);
  });

  it('does NOT index a created file matched by workspace ignore rules', async () => {
    const { service, watcher, ignoreResolver } = makeHarness({
      parsedIgnoreFiles: [{ patterns: [] }],
      isIgnored: (rel) => rel.replace(/\\/g, '/').includes('generated/'),
    });
    await service.start(ROOT);

    watcher.fireCreate(abs('src/generated/schema.ts'));
    await flush();

    expect(ignoreResolver.isIgnored).toHaveBeenCalled();
    expect(service.search('schema', 10)).toHaveLength(0);
  });

  it('dispose tears down the watcher and clears state', async () => {
    const { service, watcher } = makeHarness();
    await service.start(ROOT);

    service.dispose();

    expect(watcher.disposed).toBe(true);
    expect(service.isReady()).toBe(false);
    expect(service.fileCount).toBe(0);
  });
});
