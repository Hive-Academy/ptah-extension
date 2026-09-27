/**
 * `cli-file-system-provider.spec.ts` — runs the shared `runFileSystemContract`
 * against `CliFileSystemProvider`, plus CLI-specific behavioural checks.
 *
 * The contract hard-codes POSIX paths like `/fs/greeting.txt`. On Windows those
 * would resolve to `C:\fs\...` which requires admin. We wrap the real provider
 * with a tiny remapping proxy that rewrites the `/fs` prefix onto a per-test
 * `os.tmpdir()` subdirectory so the same suite runs cross-platform without
 * privileged filesystem access (mirrors the Electron impl's harness).
 */

// chokidar@5 is pure ESM, which ts-jest CJS cannot load. The contract test
// for `createFileWatcher` only asserts the returned object's shape, so stub
// the module with a minimal sync watcher that satisfies chokidar's API.
jest.mock('chokidar', () => ({
  watch: () => ({
    on: () => undefined,
    close: () => Promise.resolve(),
  }),
}));

import 'reflect-metadata';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { expectNormalizedPath } from '@ptah-extension/shared/testing';
import {
  countDirectoryReads,
  runFileSystemContract,
} from '@ptah-extension/platform-core/testing';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import {
  FileType,
  IncompleteFileSearchError,
} from '@ptah-extension/platform-core';
import { CliFileSystemProvider } from './cli-file-system-provider';

// Track every tmp dir we provision so the afterEach teardown can remove them
// even if the spec under test throws before cleaning up.
const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const base = path.join(os.tmpdir(), 'ptah-cli-fs-');
  const dir = await fs.mkdtemp(base);
  tmpDirs.push(dir);
  return dir;
}

/**
 * Wrap a `CliFileSystemProvider` so the contract's POSIX-style `/fs` paths
 * resolve to real entries under a tmp directory. The wrapper only rewrites
 * paths; every other behaviour comes straight from the real impl.
 */
function remap(
  root: string,
  provider: CliFileSystemProvider,
): IFileSystemProvider {
  const rewrite = (p: string): string => {
    if (p.startsWith('/fs')) {
      const rel = p.slice('/fs'.length).replace(/^[\\/]+/, '');
      return rel ? path.join(root, rel) : root;
    }
    return p;
  };

  return {
    readFile: (p) => provider.readFile(rewrite(p)),
    readFileBytes: (p) => provider.readFileBytes(rewrite(p)),
    writeFile: (p, c) => provider.writeFile(rewrite(p), c),
    writeFileBytes: (p, c) => provider.writeFileBytes(rewrite(p), c),
    readDirectory: (p) => provider.readDirectory(rewrite(p)),
    stat: (p) => provider.stat(rewrite(p)),
    exists: (p) => provider.exists(rewrite(p)),
    delete: (p, opts) => provider.delete(rewrite(p), opts),
    createDirectory: (p) => provider.createDirectory(rewrite(p)),
    createDirectoryExclusive: (p) =>
      provider.createDirectoryExclusive(rewrite(p)),
    copy: (src, dst, opts) => provider.copy(rewrite(src), rewrite(dst), opts),
    findFiles: (pattern, exclude, max, cwd) =>
      provider.findFiles(pattern, exclude, max, cwd ? rewrite(cwd) : undefined),
    createFileWatcher: (pattern) => provider.createFileWatcher(pattern),
  };
}

// Known divergences exposed by the contract (mirrors the Electron impl — this
// is copied logic, so the same Node >= 20 and ESM issues surface here too):
// TODO(W4.B3): impl divergence — `copy produces an identical file` passes
//   `force: options?.overwrite` (undefined) into `fs.cp`, which is a TypeError
//   on Node >= 20. Fix: `force: options?.overwrite ?? false`.
// TODO(W4.B3): impl divergence — `createFileWatcher returns an IFileWatcher`
//   uses `require('chokidar')` at call time, but chokidar is ESM-only in
//   recent versions and Jest's default `transformIgnorePatterns` excludes it.
//   Fix: either switch to `await import('chokidar')` (matching the `fast-glob`
//   pattern in the same file) or add chokidar to `transformIgnorePatterns`.
runFileSystemContract('CliFileSystemProvider', async () => {
  const root = await makeTempDir();
  return remap(root, new CliFileSystemProvider());
});

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* swallow — best-effort cleanup */
    });
  }
});

describe('CliFileSystemProvider — CLI-specific behaviour', () => {
  let provider: CliFileSystemProvider;
  let root: string;

  beforeEach(async () => {
    provider = new CliFileSystemProvider();
    root = await makeTempDir();
  });

  it('writeFile creates missing parent directories under a real fs root', async () => {
    const nested = path.join(root, 'deep', 'nested', 'file.txt');
    await provider.writeFile(nested, 'payload');
    expect(await provider.exists(nested)).toBe(true);
    expect(await provider.readFile(nested)).toBe('payload');
  });

  it('readDirectory surfaces files and subdirectories with correct FileType', async () => {
    await provider.writeFile(path.join(root, 'a.txt'), '1');
    await provider.createDirectory(path.join(root, 'sub'));
    const entries = await provider.readDirectory(root);
    const byName = new Map(entries.map((e) => [e.name, e.type]));
    expect(byName.get('a.txt')).toBe(FileType.File);
    expect(byName.get('sub')).toBe(FileType.Directory);
  });

  it('delete({ recursive: true }) removes a populated directory', async () => {
    await provider.writeFile(path.join(root, 'dir', 'a.txt'), 'a');
    await provider.writeFile(path.join(root, 'dir', 'b.txt'), 'b');
    await provider.delete(path.join(root, 'dir'), { recursive: true });
    expect(await provider.exists(path.join(root, 'dir'))).toBe(false);
  });

  it('copy without overwrite rejects when the destination already exists', async () => {
    await provider.writeFile(path.join(root, 'src.txt'), 'a');
    await provider.writeFile(path.join(root, 'dst.txt'), 'b');
    await expect(
      provider.copy(path.join(root, 'src.txt'), path.join(root, 'dst.txt')),
    ).rejects.toThrow();
  });

  it('findFiles with cwd returns absolute paths whose prefix matches the cwd', async () => {
    await provider.writeFile(path.join(root, 'pkg', 'index.ts'), 'export {};');
    await provider.writeFile(path.join(root, 'pkg', 'util.ts'), 'export {};');
    const results = await provider.findFiles('**/*.ts', undefined, 10, root);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      // fast-glob returns POSIX separators on Windows — normalise before
      // asserting the prefix so the test runs identically on both platforms.
      expectNormalizedPath(r.slice(0, root.length), root);
    }
  });

  it('findFiles honours maxResults by truncating the returned array', async () => {
    for (let i = 0; i < 5; i++) {
      await provider.writeFile(path.join(root, `f${i}.ts`), 'x');
    }
    const results = await provider.findFiles('**/*.ts', undefined, 2, root);
    expect(results.length).toBe(2);
  });

  // TASK_2026_559 Batch 23b r1/r2 M1: maxResults bounds the walk itself. On
  // a real flat directory of 2,000 matches, a limit of 5 reads a handful of
  // entries (fast-glob read and emitted all 2,000) and closes what it opened.
  it('findFiles with maxResults reads a bounded number of entries of a 2,000-file directory', async () => {
    const flat = path.join(root, 'flat');
    await fs.mkdir(flat);
    // The fixture is created in parallel chunks: 2,000 sequential writes
    // alone can pass jest's default 5 s under a loaded full-suite run.
    for (let chunk = 0; chunk < 2_000; chunk += 200) {
      await Promise.all(
        Array.from({ length: 200 }, (_, i) =>
          fs.writeFile(path.join(flat, `f${chunk + i}.ts`), ''),
        ),
      );
    }
    const probe = countDirectoryReads();
    try {
      const results = await provider.findFiles('**/*.ts', [], 5, root);

      expect(results).toHaveLength(5);
      expect(probe.entriesRead).toBeGreaterThan(0);
      expect(probe.entriesRead).toBeLessThanOrEqual(6);
      expect(probe.closed).toBe(probe.opened);
    } finally {
      probe.restore();
    }
  }, 30_000);

  // TASK_2026_559 Batch 23b r4 B1 (FB): a search root that does not exist
  // (or is a file) is an incomplete search, never an empty complete answer.
  it.each([
    ['a missing root', 'nonexistent', 'ENOENT'],
    ['a root that is a file', 'root-file.txt', 'ENOTDIR'],
  ])(
    'findFiles with maxResults rejects %s as incomplete (%s)',
    async (_label, name, code) => {
      await fs.writeFile(path.join(root, 'root-file.txt'), '');
      const error = await provider
        .findFiles('**/*.ts', [], 100, path.join(root, name))
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );
      expect(error).toBeInstanceOf(IncompleteFileSearchError);
      expect((error as IncompleteFileSearchError).failures).toEqual({
        total: 1,
        byCode: { [code]: 1 },
      });
      expect((error as IncompleteFileSearchError).matches).toEqual([]);
    },
  );

  // TASK_2026_559 Batch 23b r3 B1 (FB): an unreadable directory in a bounded
  // search rejects with what was found and why, never a silent short list.
  it.each([['EIO'], ['EACCES'], ['EPERM']])(
    'findFiles with maxResults rejects an unreadable subtree (%s) as incomplete',
    async (code) => {
      await fs.mkdir(path.join(root, 'src'));
      await fs.mkdir(path.join(root, 'locked'));
      await fs.writeFile(path.join(root, 'src', 'a.ts'), '');
      await fs.writeFile(path.join(root, 'locked', 'b.ts'), '');
      const opendir = fsSync.promises.opendir.bind(fsSync.promises);
      const spy = jest
        .spyOn(fsSync.promises, 'opendir')
        .mockImplementation(async (dir, options) => {
          if (path.basename(String(dir)) === 'locked') {
            throw Object.assign(new Error(code), { code });
          }
          return opendir(dir, options);
        });
      try {
        const error = await provider.findFiles('**/*.ts', [], 100, root).then(
          () => undefined,
          (rejection: unknown) => rejection,
        );
        expect(error).toBeInstanceOf(IncompleteFileSearchError);
        const incomplete = error as IncompleteFileSearchError;
        expect(incomplete.failures).toEqual({
          total: 1,
          byCode: { [code]: 1 },
        });
        expect(incomplete.matches.map((m) => path.basename(m))).toEqual([
          'a.ts',
        ]);
        expect(incomplete.message).not.toContain(root);
      } finally {
        spy.mockRestore();
      }
    },
  );

  // TASK_2026_559 Batch 23b r3 S1 (FB): a bounded search (large limit)
  // returns exactly what the unlimited search returns, for every pattern
  // class; a literal `package.json` was [] with a limit.
  it.each([
    ['package.json'],
    ['./package.json'],
    ['{abs}/package.json'],
    ['missing.json'],
    ['src'],
    ['.env'],
    ['*.json'],
    ['**/package.json'],
    ['src/{a,b}.ts'],
    ['src/+(a|b).ts'],
    ['src/*.TS'],
    ['src/[aA]*.ts'],
    ['**/.*'],
    ['**/*'],
    ['{abs}/src/**/*.ts'],
    // r4 S1 (FB): escaped metacharacters in route-style names.
    ['app/\\[id\\]/page.tsx'],
    ['app/\\[id\\]/**/*.tsx'],
    ['app/\\(group\\)/*.ts'],
    ['lit\\[1\\].ts'],
    ['{abs}/app/\\[id\\]/*.tsx'],
  ])(
    'findFiles %s with a large limit equals the unlimited search',
    async (rawPattern) => {
      for (const file of [
        'package.json',
        '.env',
        'src/a.ts',
        'src/b.ts',
        'src/APP.TS',
        'src/.hidden/c.ts',
        'node_modules/pkg/package.json',
        'app/[id]/page.tsx',
        'app/(group)/layout.ts',
        'lit[1].ts',
      ]) {
        await provider.writeFile(path.join(root, file), '');
      }
      const pattern = rawPattern.replace(
        '{abs}',
        root.split(path.sep).join('/'),
      );
      const exclude = ['**/node_modules/**'];
      const unlimited = await provider.findFiles(
        pattern,
        exclude,
        undefined,
        root,
      );
      const bounded = await provider.findFiles(
        pattern,
        exclude,
        1_000_000,
        root,
      );

      expect([...bounded].sort()).toEqual([...unlimited].sort());
      // An escaped pattern names an existing file: parity is not vacuous.
      if (rawPattern.includes('\\')) expect(unlimited).toHaveLength(1);
    },
  );

  // TASK_2026_559 Batch 23b r1 B1: per-letter bracket classes (the graph
  // discovery glob's form) match every extension case in this adapter.
  it.each([
    ['bounded', 100],
    ['unbounded', undefined],
  ])(
    'findFiles (%s) matches upper- and mixed-case extensions through bracket classes',
    async (_label, max) => {
      for (const name of [
        'APP.TS',
        'analysis.R',
        'lib.Ts',
        'main.ts',
        'x.md',
      ]) {
        await provider.writeFile(path.join(root, 'src', name), '');
      }
      const results = await provider.findFiles(
        '**/*.{[tT][sS],[rR]}',
        [],
        max,
        root,
      );
      expect(results.map((r) => path.basename(r)).sort()).toEqual([
        'APP.TS',
        'analysis.R',
        'lib.Ts',
        'main.ts',
      ]);
    },
  );

  it('stat on a written file reports correct byte size and File type', async () => {
    await provider.writeFile(path.join(root, 'sz.txt'), 'abcd');
    const s = await provider.stat(path.join(root, 'sz.txt'));
    expect(s.type).toBe(FileType.File);
    expect(s.size).toBe(4);
  });

  it('readFileBytes round-trips arbitrary binary payloads', async () => {
    const bytes = new Uint8Array([0, 127, 128, 255]);
    await provider.writeFileBytes(path.join(root, 'blob.bin'), bytes);
    const actual = await provider.readFileBytes(path.join(root, 'blob.bin'));
    expect(Array.from(actual)).toEqual(Array.from(bytes));
  });

  it('createFileWatcher wires change/add/unlink events through chokidar and fires the correct IFileWatcher events', async () => {
    // Replace the module-level chokidar stub with one that captures event
    // handlers so we can invoke them manually and assert the IFileWatcher
    // onDidChange / onDidCreate / onDidDelete events fire correctly.
    const handlers: Record<string, ((fp: string) => void)[]> = {};
    const mockWatch = jest.fn((_pattern: string, _opts: object) => ({
      on(event: string, handler: (fp: string) => void): unknown {
        (handlers[event] ??= []).push(handler);
        return this;
      },
      close: () => Promise.resolve(),
    }));

    const chokidar = jest.requireMock<{ watch: jest.Mock }>('chokidar');
    chokidar.watch = mockWatch;

    const projectRoot = path.resolve('/project');
    const watcher = provider.createFileWatcher('**/*.ts', { cwd: projectRoot });

    const changedFiles: string[] = [];
    const createdFiles: string[] = [];
    const deletedFiles: string[] = [];

    watcher.onDidChange((fp) => changedFiles.push(fp));
    watcher.onDidCreate((fp) => createdFiles.push(fp));
    watcher.onDidDelete((fp) => deletedFiles.push(fp));

    // Allow the async IIFE inside createFileWatcher to resolve and register
    // event handlers with the mock watcher.
    await new Promise<void>((resolve) => setImmediate(resolve));

    // chokidar is handed a DIRECTORY, never the glob — it has not understood
    // globs since v4, and passing one through produced a watcher on a literal
    // path named `**` that silently never fired.
    expect(mockWatch.mock.calls[0][0]).toBe(projectRoot.replace(/\\/g, '/'));

    // Trigger each chokidar event
    handlers['change']?.[0]?.(path.join(projectRoot, 'foo.ts'));
    handlers['add']?.[0]?.(path.join(projectRoot, 'bar.ts'));
    handlers['unlink']?.[0]?.(path.join(projectRoot, 'baz.ts'));
    // Not a `.ts` file: chokidar reports everything under the watched
    // directory, so the glob is now applied on this side before emitting.
    handlers['add']?.[0]?.(path.join(projectRoot, 'notes.md'));

    expect(changedFiles).toEqual([path.join(projectRoot, 'foo.ts')]);
    expect(createdFiles).toEqual([path.join(projectRoot, 'bar.ts')]);
    expect(deletedFiles).toEqual([path.join(projectRoot, 'baz.ts')]);

    watcher.dispose();
  });
});

describe('findFiles — exclude behavior (TASK_2026_119)', () => {
  // These tests exercise fast-glob's `ignore` option directly against a real
  // tmp-directory fixture, so they would catch a regression where the exclude
  // array is accidentally comma-joined into a single string (the original bug).

  let provider: CliFileSystemProvider;
  let root: string;

  beforeEach(async () => {
    provider = new CliFileSystemProvider();
    root = await makeTempDir();
    // Create fixture structure:
    //   <root>/src/app.ts          ← should always be returned
    //   <root>/node_modules/pkg/index.ts ← should be excluded by **/node_modules/**
    await provider.writeFile(path.join(root, 'src', 'app.ts'), 'export {};');
    await provider.writeFile(
      path.join(root, 'node_modules', 'pkg', 'index.ts'),
      'export {};',
    );
  });

  it('string[] exclude filters matching files', async () => {
    const results = await provider.findFiles(
      '**/*.ts',
      ['**/node_modules/**'],
      100,
      root,
    );

    // Normalise separators for cross-platform assertion
    const normalised = results.map((r) => r.replace(/\\/g, '/'));

    // src/app.ts must appear
    expect(normalised.some((r) => r.includes('src/app.ts'))).toBe(true);
    // node_modules paths must NOT appear
    expect(normalised.some((r) => r.includes('node_modules'))).toBe(false);
  });

  it('empty exclude array behaves like undefined', async () => {
    const results = await provider.findFiles('**/*.ts', [], 100, root);
    const normalised = results.map((r) => r.replace(/\\/g, '/'));

    // Both files should be returned when exclude is empty
    expect(normalised.some((r) => r.includes('src/app.ts'))).toBe(true);
    expect(normalised.some((r) => r.includes('node_modules'))).toBe(true);
  });

  it('undefined exclude returns all files', async () => {
    const results = await provider.findFiles('**/*.ts', undefined, 100, root);
    const normalised = results.map((r) => r.replace(/\\/g, '/'));

    expect(normalised.some((r) => r.includes('src/app.ts'))).toBe(true);
    expect(normalised.some((r) => r.includes('node_modules'))).toBe(true);
  });
});
