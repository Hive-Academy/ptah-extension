import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { types } from 'node:util';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';

/**
 * ENOENT from a filesystem call, checked with no realm assumption. Jest runs
 * this module inside a `vm` context whose `Error` intrinsic is not the one
 * `node:fs` rejects with, so an `instanceof Error` guard rethrows every real
 * ENOENT under test; `types.isNativeError` accepts the native errors of any
 * realm and still rejects non-error throws. Measured on win32, Node 24: from
 * inside a vm context, a real fs ENOENT has `instanceof Error === false` and
 * `types.isNativeError === true`.
 */
function isEnoent(error: unknown): boolean {
  return (
    types.isNativeError(error) &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/** Owns only instruction directories created for this process's lanes. */
export class LaneInstructionFileStore {
  private readonly owned = new Map<string, { root: string; directory: string }>();

  constructor(private readonly files: IFileSystemProvider) {}

  async write(
    workspaceRoot: string,
    agentId: string,
    relativeName: string,
    content: string,
  ): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId) ||
        !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(relativeName) ||
        relativeName.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('Invalid lane instruction path');
    }
    const root = await realpath(workspaceRoot);
    if (!isAbsolute(root)) throw new Error('Workspace root is not absolute');
    const ptah = join(root, '.ptah');
    const lanes = join(ptah, 'lanes');
    for (const directory of [ptah, lanes]) {
      if (await this.files.exists(directory)) {
        const info = await lstat(directory);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Lane instruction parent is not a directory');
      } else {
        await this.files.createDirectory(directory);
      }
      this.assertInside(root, await realpath(directory));
    }
    let owned = this.owned.get(agentId);
    if (!owned) {
      const directory = join(lanes, agentId);
      await this.files.createDirectoryExclusive(directory);
      this.assertInside(root, await realpath(directory));
      owned = { root, directory };
      this.owned.set(agentId, owned);
    } else if (owned.root !== root) {
      throw new Error('Lane instruction root changed');
    }
    const filename = resolve(owned.directory, relativeName);
    this.assertInside(owned.directory, filename);
    await this.files.writeFile(filename, content);
    return filename;
  }

  async remove(agentId: string): Promise<void> {
    const owned = this.owned.get(agentId);
    if (!owned) return;
    let root: string;
    let directory: string;
    try {
      root = await realpath(owned.root);
      directory = await realpath(owned.directory);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - ENOENT can mean "removed": a
      // workspace or lane directory that no longer resolves, with no entry
      // left at the owned path, has nothing left to delete or to contain, and
      // keeping the entry would own a vanished directory forever. Any other
      // error still fails the removal.
      if (!isEnoent(error)) throw error;
      // An ENOENT from realpath is not proof the name is gone: the entry can
      // be a dangling link or junction. lstat does not follow the final
      // component, so an entry that still exists keeps its ownership and the
      // removal is refused as a containment change instead of silently
      // forgetting it; nothing is ever deleted through a link.
      let entryExists = false;
      try {
        await lstat(owned.directory);
        entryExists = true;
      } catch (lstatError: unknown) {
        if (!isEnoent(lstatError)) throw lstatError;
      }
      if (entryExists) throw new Error('Lane instruction directory changed');
      this.owned.delete(agentId);
      return;
    }
    this.assertInside(root, directory);
    if (directory !== owned.directory) throw new Error('Lane instruction directory changed');
    await this.files.delete(directory, { recursive: true });
    this.owned.delete(agentId);
  }

  private assertInside(root: string, candidate: string): void {
    const rel = relative(root, candidate);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('Lane instruction path escapes its root');
    }
  }
}
