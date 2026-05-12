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
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { expectNormalizedPath } from '@ptah-extension/shared/testing';
import { runFileSystemContract } from '@ptah-extension/platform-core/testing';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { FileType } from '@ptah-extension/platform-core';
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

    const watcher = provider.createFileWatcher('**/*.ts');

    const changedFiles: string[] = [];
    const createdFiles: string[] = [];
    const deletedFiles: string[] = [];

    watcher.onDidChange((fp) => changedFiles.push(fp));
    watcher.onDidCreate((fp) => createdFiles.push(fp));
    watcher.onDidDelete((fp) => deletedFiles.push(fp));

    // Allow the async IIFE inside createFileWatcher to resolve and register
    // event handlers with the mock watcher.
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Trigger each chokidar event
    handlers['change']?.[0]?.('/project/foo.ts');
    handlers['add']?.[0]?.('/project/bar.ts');
    handlers['unlink']?.[0]?.('/project/baz.ts');

    expect(changedFiles).toEqual(['/project/foo.ts']);
    expect(createdFiles).toEqual(['/project/bar.ts']);
    expect(deletedFiles).toEqual(['/project/baz.ts']);

    watcher.dispose();
  });
});
