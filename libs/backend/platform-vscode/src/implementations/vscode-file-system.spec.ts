/**
 * `VscodeFileSystemProvider` — contract + VS Code-specific behaviour.
 *
 * Wraps the cross-platform `runFileSystemContract` harness so divergence from
 * the Electron impl surfaces immediately, plus a focused block for VS Code-only
 * semantics (scheme routing via `Uri.parse` vs. `Uri.file`, watcher wiring).
 */

import 'reflect-metadata';
import * as realFs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { runFileSystemContract } from '@ptah-extension/platform-core/testing';
import { VscodeFileSystemProvider } from './vscode-file-system-provider';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

// `createDirectoryExclusive` is the one method that does NOT go through
// `vscode.workspace.fs` — it cannot, because that API is recursive and never
// reports EEXIST. It uses `node:fs` instead, so its contract cases need a real
// writable directory rather than the in-memory double's virtual `/fs` prefix
// (which would resolve to an unwritable `C:\fs` on Windows).
const realTmpDirs: string[] = [];

async function makeRealTempDir(): Promise<string> {
  const dir = await realFs.mkdtemp(
    nodePath.join(os.tmpdir(), 'ptah-vscode-fs-'),
  );
  realTmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (realTmpDirs.length > 0) {
    const dir = realTmpDirs.pop();
    if (!dir) continue;
    await realFs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup */
    });
  }
});

runFileSystemContract(
  'VscodeFileSystemProvider',
  () => new VscodeFileSystemProvider(),
  undefined,
  { exclusiveCreateRoot: makeRealTempDir },
);

describe('VscodeFileSystemProvider — VS Code-specific behaviour', () => {
  let provider: VscodeFileSystemProvider;

  beforeEach(() => {
    __resetVscodeTestDouble();
    provider = new VscodeFileSystemProvider();
  });

  it('routes scheme-qualified paths through vscode.Uri.parse', async () => {
    // vscode-vfs:// paths should not be mangled into file paths.
    await provider.writeFile('vscode-vfs://github/user/repo/file.ts', 'ok');
    expect(
      await provider.readFile('vscode-vfs://github/user/repo/file.ts'),
    ).toBe('ok');
  });

  it('createFileWatcher returns a disposable wired to vscode.workspace.createFileSystemWatcher', () => {
    const watcher = provider.createFileWatcher('**/*.ts');
    expect(typeof watcher.dispose).toBe('function');
    // The most recent watcher registration should match our pattern.
    const last =
      __vscodeState.createdWatchers[__vscodeState.createdWatchers.length - 1];
    expect(last.pattern).toBe('**/*.ts');
    watcher.dispose();
  });

  it('createFileWatcher forwards fsPath of triggered URIs to subscribers', () => {
    const watcher = provider.createFileWatcher('**/*.ts');
    const seen: string[] = [];
    const sub = watcher.onDidChange((p) => seen.push(p));

    const last =
      __vscodeState.createdWatchers[__vscodeState.createdWatchers.length - 1];
    last.fireChange({ fsPath: '/tmp/file.ts' });

    sub.dispose();
    watcher.dispose();
    expect(seen).toContain('/tmp/file.ts');
  });

  it('createDirectoryExclusive does NOT delegate to vscode.workspace.fs.createDirectory (R1)', async () => {
    // Guard against the exact regression risk R1 names: that API is recursive
    // and resolves on an existing directory, so routing through it would
    // produce a fake compare-and-swap that silently never rejects.
    const { workspace } = await import('vscode');
    const spy = workspace.fs.createDirectory as jest.Mock;
    spy.mockClear();

    const root = await makeRealTempDir();
    await provider.createDirectoryExclusive(`${root}/claimed`);

    expect(spy).not.toHaveBeenCalled();
    // Proves it really landed on disk rather than in the in-memory double.
    await expect(
      realFs.stat(nodePath.join(root, 'claimed')),
    ).resolves.toBeDefined();
  });

  it('createDirectoryExclusive rejects for virtual (non-file) schemes rather than faking atomicity', async () => {
    await expect(
      provider.createDirectoryExclusive('vscode-vfs://github/user/repo/dir'),
    ).rejects.toThrow(/requires a local file path/i);
  });

  it('readFile rejects with a vscode FileSystemError for missing paths', async () => {
    await expect(provider.readFile('/no/such/file')).rejects.toThrow(
      /File not found/i,
    );
  });
});

describe('findFiles — exclude brace expansion (TASK_2026_119)', () => {
  // The VS Code adapter converts a string[] exclude to a single GlobPattern
  // for vscode.workspace.findFiles (single element: pass-through; multiple
  // elements: wrap in {a,b,c} brace expansion).
  //
  // These tests capture the excludeGlob argument passed to the mock and assert
  // the conversion is correct, covering both code paths and the undefined case.

  let provider: VscodeFileSystemProvider;

  beforeEach(() => {
    __resetVscodeTestDouble();
    provider = new VscodeFileSystemProvider();
  });

  it('single-element array passes the pattern directly (no braces)', async () => {
    // Capture the argument passed to vscode.workspace.findFiles
    const { workspace } = await import('vscode');
    let capturedExclude: string | undefined = 'NOT_SET' as string | undefined;

    (workspace.findFiles as jest.Mock).mockImplementationOnce(
      async (_include: string, exclude: string | undefined) => {
        capturedExclude = exclude;
        return [];
      },
    );

    await provider.findFiles('**/*.ts', ['**/node_modules/**'], 10);

    expect(capturedExclude).toBe('**/node_modules/**');
    // Must NOT be wrapped in braces for a single-element array
    expect(capturedExclude).not.toBe('{**/node_modules/**}');
  });

  it('multi-element array wraps in braces', async () => {
    const { workspace } = await import('vscode');
    let capturedExclude: string | undefined;

    (workspace.findFiles as jest.Mock).mockImplementationOnce(
      async (_include: string, exclude: string | undefined) => {
        capturedExclude = exclude;
        return [];
      },
    );

    await provider.findFiles(
      '**/*.ts',
      ['**/node_modules/**', '**/dist/**'],
      10,
    );

    expect(capturedExclude).toBe('{**/node_modules/**,**/dist/**}');
  });

  it('undefined exclude passes undefined to vscode.workspace.findFiles', async () => {
    const { workspace } = await import('vscode');
    let capturedExclude: string | undefined = 'NOT_SET' as string | undefined;

    (workspace.findFiles as jest.Mock).mockImplementationOnce(
      async (_include: string, exclude: string | undefined) => {
        capturedExclude = exclude;
        return [];
      },
    );

    await provider.findFiles('**/*.ts', undefined, 10);

    expect(capturedExclude).toBeUndefined();
  });

  it('empty array passes undefined to vscode.workspace.findFiles', async () => {
    const { workspace } = await import('vscode');
    let capturedExclude: string | undefined = 'NOT_SET' as string | undefined;

    (workspace.findFiles as jest.Mock).mockImplementationOnce(
      async (_include: string, exclude: string | undefined) => {
        capturedExclude = exclude;
        return [];
      },
    );

    await provider.findFiles('**/*.ts', [], 10);

    expect(capturedExclude).toBeUndefined();
  });
});

describe('findFiles — cwd scoping via RelativePattern (TASK_2026_299 Task 2.5)', () => {
  let provider: VscodeFileSystemProvider;

  beforeEach(() => {
    __resetVscodeTestDouble();
    provider = new VscodeFileSystemProvider();
  });

  it('wraps the pattern in vscode.RelativePattern(cwd, pattern) when cwd is given', async () => {
    const { workspace, RelativePattern } = await import('vscode');
    let capturedInclude: unknown;

    (workspace.findFiles as jest.Mock).mockImplementationOnce(
      async (include: unknown) => {
        capturedInclude = include;
        return [];
      },
    );

    await provider.findFiles(
      '**/*.ts',
      undefined,
      10,
      'D:/projects/session-root',
    );

    expect(capturedInclude).toBeInstanceOf(RelativePattern);
    expect((capturedInclude as InstanceType<typeof RelativePattern>).base).toBe(
      'D:/projects/session-root',
    );
    expect(
      (capturedInclude as InstanceType<typeof RelativePattern>).pattern,
    ).toBe('**/*.ts');
  });

  it('passes the bare glob string (no RelativePattern) when cwd is undefined', async () => {
    const { workspace } = await import('vscode');
    let capturedInclude: unknown;

    (workspace.findFiles as jest.Mock).mockImplementationOnce(
      async (include: unknown) => {
        capturedInclude = include;
        return [];
      },
    );

    await provider.findFiles('**/*.ts', undefined, 10);

    expect(capturedInclude).toBe('**/*.ts');
  });

  it('returns absolute fsPath values from matched URIs regardless of cwd scoping', async () => {
    const { workspace } = await import('vscode');
    (workspace.findFiles as jest.Mock).mockImplementationOnce(async () => [
      { fsPath: 'D:/projects/session-root/src/a.ts' },
      { fsPath: 'D:/projects/session-root/src/b.ts' },
    ]);

    const results = await provider.findFiles(
      '**/*.ts',
      undefined,
      10,
      'D:/projects/session-root',
    );

    expect(results).toEqual([
      'D:/projects/session-root/src/a.ts',
      'D:/projects/session-root/src/b.ts',
    ]);
  });
});
