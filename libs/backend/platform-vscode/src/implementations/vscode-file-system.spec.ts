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
