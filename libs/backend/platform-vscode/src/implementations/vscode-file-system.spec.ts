/**
 * `VscodeFileSystemProvider` — contract + VS Code-specific behaviour.
 *
 * Wraps the cross-platform `runFileSystemContract` harness so divergence from
 * the Electron impl surfaces immediately, plus a focused block for VS Code-only
 * semantics (scheme routing via `Uri.parse` vs. `Uri.file`, watcher wiring).
 */

import 'reflect-metadata';
import { runFileSystemContract } from '@ptah-extension/platform-core/testing';
import { VscodeFileSystemProvider } from './vscode-file-system-provider';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runFileSystemContract(
  'VscodeFileSystemProvider',
  () => new VscodeFileSystemProvider(),
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
