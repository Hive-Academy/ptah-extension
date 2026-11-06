import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, dirname } from 'node:path';
import type { IReviewContextFiles, ReviewArtifactFileSystem, ReviewRoots } from '@ptah-extension/review-core';

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Restricts review file operations to the configured attempt tree. */
export class ReviewFiles implements IReviewContextFiles, ReviewArtifactFileSystem {
  constructor(private readonly roots: (path: string) => Promise<ReviewRoots>) {}

  private async checked(path: string, existing: boolean): Promise<string> {
    const root = await realpath((await this.roots(path)).attemptsRoot);
    const target = resolve(path);
    const rel = relative(root, target);
    const [attemptId] = rel.split(sep);
    if (!inside(root, target) || !/^[A-Za-z0-9_-]{1,64}$/.test(attemptId))
      throw new Error('Review file path is outside attempt root');
    if (!existing) {
      let ancestor = dirname(target);
      while (inside(root, ancestor) && ancestor !== root) {
        try {
          const actual = await realpath(ancestor);
          if (!inside(root, actual)) throw new Error('Review parent link escapes attempt root');
          break;
        } catch (error: unknown) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
          ancestor = dirname(ancestor);
        }
      }
    }
    if (existing) {
      const actual = await realpath(target);
      if (!inside(root, actual)) throw new Error('Review file link escapes attempt root');
    }
    return target;
  }

  async mkdir(path: string): Promise<void> {
    const target = await this.checked(path, false);
    await mkdir(target, { recursive: true });
    await this.checked(target, true);
  }

  async read(path: string): Promise<Uint8Array> {
    return readFile(await this.checked(path, true));
  }

  async remove(path: string): Promise<void> {
    const target = await this.checked(path, true);
    const root = await realpath((await this.roots(path)).attemptsRoot);
    if (dirname(target) !== root || (await lstat(target)).isSymbolicLink())
      throw new Error('Review removal requires an attempt directory');
    await rm(target, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    const target = await this.checked(path, false);
    try { await lstat(target); return true; }
    catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async realpath(path: string): Promise<string> {
    return realpath(await this.checked(path, true));
  }

  async writeFile(path: string, content: string, encoding: 'utf8'): Promise<void> {
    await this.checked(dirname(path), true);
    const target = await this.checked(path, false);
    await writeFile(target, content, { encoding, flag: 'wx' });
  }

  async readFile(path: string, encoding: 'utf8'): Promise<string> {
    return readFile(await this.checked(path, true), encoding);
  }
}
