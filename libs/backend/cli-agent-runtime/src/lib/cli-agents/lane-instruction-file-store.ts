import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';

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
        !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(relativeName) ||
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
    const root = await realpath(owned.root);
    const directory = await realpath(owned.directory);
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
