/**
 * `runFileSystemContract` — behavioural contract for `IFileSystemProvider`.
 *
 * Every platform impl (VS Code, Electron, CLI) runs the same suite so
 * divergence bugs (e.g. Electron returning `FileType.Unknown` where VS Code
 * returns `FileType.File`) surface before they reach production. Assertions
 * target observable behaviour — write-then-read round trips, ENOENT-class
 * rejection, `readDirectory` file/directory discrimination — never call
 * counts on the underlying jest spies.
 */

import type { IFileSystemProvider } from '../../interfaces/file-system-provider.interface';
import { FileType } from '../../types/platform.types';

export interface FileSystemContractOptions {
  /**
   * Directory the `createDirectoryExclusive` cases run inside, resolved fresh
   * per test. Defaults to the contract's virtual `/fs` root.
   *
   * Override this when the adapter's `createDirectoryExclusive` is backed by a
   * DIFFERENT filesystem from the rest of its methods. The VS Code adapter is
   * exactly that case: every other method goes through `vscode.workspace.fs`
   * (an in-memory double under test), but `createDirectoryExclusive` must use
   * `node:fs` because `vscode.workspace.fs.createDirectory` is recursive and
   * therefore cannot fail with EEXIST. Those cases consequently need a real,
   * writable directory rather than the virtual `/fs` prefix.
   */
  exclusiveCreateRoot?: () => Promise<string> | string;
}

export function runFileSystemContract(
  name: string,
  createProvider: () => Promise<IFileSystemProvider> | IFileSystemProvider,
  teardown?: () => Promise<void> | void,
  options?: FileSystemContractOptions,
): void {
  describe(`IFileSystemProvider contract — ${name}`, () => {
    let provider: IFileSystemProvider;
    let exclusiveRoot: string;

    beforeEach(async () => {
      provider = await createProvider();
      exclusiveRoot = options?.exclusiveCreateRoot
        ? await options.exclusiveCreateRoot()
        : '/fs';
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('writeFile → readFile round-trips UTF-8 including non-ASCII', async () => {
      await provider.writeFile('/fs/greeting.txt', 'hello — 🌍');
      expect(await provider.readFile('/fs/greeting.txt')).toBe('hello — 🌍');
    });

    it('writeFileBytes → readFileBytes round-trips binary content exactly', async () => {
      const bytes = new Uint8Array([0, 1, 2, 3, 255, 254]);
      await provider.writeFileBytes('/fs/blob.bin', bytes);
      const actual = await provider.readFileBytes('/fs/blob.bin');
      expect(Array.from(actual)).toEqual(Array.from(bytes));
    });

    it('readFile on missing path rejects (not resolves undefined)', async () => {
      await expect(
        provider.readFile('/fs/does-not-exist.txt'),
      ).rejects.toThrow();
    });

    it('stat on missing path rejects', async () => {
      await expect(provider.stat('/fs/missing')).rejects.toThrow();
    });

    it('exists returns true for written files and false for missing paths', async () => {
      await provider.writeFile('/fs/present.txt', 'x');
      expect(await provider.exists('/fs/present.txt')).toBe(true);
      expect(await provider.exists('/fs/absent.txt')).toBe(false);
    });

    it('stat on a written file reports FileType.File and correct byte size', async () => {
      await provider.writeFile('/fs/sized.txt', 'abcd');
      const stat = await provider.stat('/fs/sized.txt');
      expect(stat.type).toBe(FileType.File);
      expect(stat.size).toBe(4);
    });

    it('readDirectory surfaces direct children with correct FileType', async () => {
      await provider.writeFile('/fs/dir/child.txt', 'a');
      await provider.createDirectory('/fs/dir/sub');
      const entries = await provider.readDirectory('/fs/dir');
      const names = entries.map((e) => e.name).sort();
      expect(names).toContain('child.txt');
      const child = entries.find((e) => e.name === 'child.txt');
      expect(child?.type).toBe(FileType.File);
    });

    it('createDirectoryExclusive resolves when the path is free', async () => {
      await expect(
        provider.createDirectoryExclusive(`${exclusiveRoot}/claim-once`),
      ).resolves.toBeUndefined();
    });

    it('createDirectoryExclusive REJECTS with an EEXIST-typed error when the SAME path is created twice', async () => {
      // The whole reason this method exists. `createDirectory` is recursive and
      // resolves happily on an existing path, so it cannot claim a name.
      // Asserting the specific `EEXIST` code — not merely "rejects" — is what
      // stops a stat-then-create implementation from slipping through and
      // reintroducing the TOCTOU window.
      const target = `${exclusiveRoot}/claim-twice`;
      await provider.createDirectoryExclusive(target);

      let captured: unknown;
      await provider.createDirectoryExclusive(target).then(
        () => {
          throw new Error(
            'createDirectoryExclusive resolved on an existing path — it is not a compare-and-swap',
          );
        },
        (error: unknown) => {
          captured = error;
        },
      );

      // NOTE: deliberately not `toBeInstanceOf(Error)`. Errors raised by
      // `node:fs` originate in the Node core realm, whose `Error` constructor is
      // not the one inside Jest's sandbox, so `instanceof` is false there even
      // though the value is a genuine Error. The `code` is the load-bearing
      // part of the contract anyway — it is what callers branch on.
      expect(Object.prototype.toString.call(captured)).toBe('[object Error]');
      expect((captured as NodeJS.ErrnoException).code).toBe('EEXIST');
    });

    it('delete removes the file so subsequent reads reject', async () => {
      await provider.writeFile('/fs/gone.txt', 'bye');
      await provider.delete('/fs/gone.txt');
      await expect(provider.readFile('/fs/gone.txt')).rejects.toThrow();
    });

    it('copy produces an identical file at the destination path', async () => {
      await provider.writeFile('/fs/src.txt', 'copyme');
      await provider.copy('/fs/src.txt', '/fs/dst.txt');
      expect(await provider.readFile('/fs/dst.txt')).toBe('copyme');
    });

    it('createFileWatcher returns an IFileWatcher exposing the three events', () => {
      const watcher = provider.createFileWatcher('**/*.ts');
      expect(typeof watcher.onDidChange).toBe('function');
      expect(typeof watcher.onDidCreate).toBe('function');
      expect(typeof watcher.onDidDelete).toBe('function');
      expect(typeof watcher.dispose).toBe('function');
      watcher.dispose();
    });

    it('createFileWatcher accepts exclude and cwd options and still returns an IFileWatcher', () => {
      const watcher = provider.createFileWatcher('**/*', {
        exclude: ['**/node_modules/**'],
        cwd: process.cwd(),
      });
      expect(typeof watcher.onDidChange).toBe('function');
      expect(typeof watcher.onDidCreate).toBe('function');
      expect(typeof watcher.onDidDelete).toBe('function');
      expect(typeof watcher.dispose).toBe('function');
      watcher.dispose();
    });
  });
}
