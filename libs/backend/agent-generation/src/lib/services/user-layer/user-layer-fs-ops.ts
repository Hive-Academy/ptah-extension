/**
 * UserLayerFsOps — every filesystem primitive the user layer is built from.
 *
 * Extracted from `UserLayerMirrorService` (TASK_2026_278 batch 1b) when the
 * orphan reaper became a third consumer of the same copy/snapshot/guard set.
 * The facade keeps its class name, DI token and method signatures; this is the
 * collaborator it delegates to, and the reaper injects the same instance so
 * there is exactly ONE implementation of "refuse to write outside the user
 * layer" in the tree.
 *
 * Every write path funnels through {@link assertUnderUserLayer}. That guard is
 * the reason this class is not a bag of free functions: it is a policy, and a
 * policy with one caller is a bug waiting for a second caller.
 */
import { homedir } from 'os';
import { join, resolve, sep, basename, dirname } from 'path';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
  stat,
  lstat,
  unlink,
} from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  DEFAULT_HISTORY_DIR,
  ORIGIN_SIDECAR_FILENAME,
} from './origin-sidecar.types';
import { isErrnoCode } from './source-hash';

export const MAX_COPY_RECURSION_DEPTH = 20;

export class UserLayerFsOps {
  constructor(private readonly logger: Logger) {}

  /** Absolute root of the user layer (`~/.ptah/user`). */
  userLayerBase(): string {
    return resolve(join(homedir(), '.ptah', 'user'));
  }

  /**
   * Refuse any write that would land outside `~/.ptah/user/`, and any write
   * under `~/.ptah/plugins/` (the sources are read-only to this side).
   */
  assertUnderUserLayer(targetPath: string): void {
    const userBase = this.userLayerBase();
    const resolved = resolve(targetPath);
    if (resolved !== userBase && !resolved.startsWith(userBase + sep)) {
      throw new Error(
        `[UserLayerMirror] refusing to write outside ~/.ptah/user/: ${resolved}`,
      );
    }
    const pluginsBase = resolve(join(homedir(), '.ptah', 'plugins'));
    if (resolved === pluginsBase || resolved.startsWith(pluginsBase + sep)) {
      throw new Error(
        `[UserLayerMirror] refusing to write under ~/.ptah/plugins/: ${resolved}`,
      );
    }
  }

  async copyTree(sourceDir: string, targetDir: string): Promise<void> {
    const rootStat = await lstat(sourceDir);
    if (rootStat.isSymbolicLink()) {
      this.logger.warn('[UserLayerMirror] skipping symlinked source root', {
        sourceDir,
      });
      return;
    }
    await this.copyTreeRec(sourceDir, targetDir, 0);
  }

  private async copyTreeRec(
    sourceDir: string,
    targetDir: string,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_COPY_RECURSION_DEPTH) {
      this.logger.warn(
        '[UserLayerMirror] copy recursion depth cutoff; skill may be partially cloned',
        { sourceDir, maxDepth: MAX_COPY_RECURSION_DEPTH },
      );
      return;
    }
    await mkdir(targetDir, { recursive: true });
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await this.copyTreeRec(sourcePath, targetPath, depth + 1);
      } else if (entry.isFile()) {
        await this.copyFileAtomic(sourcePath, targetPath);
      }
    }
  }

  async copyFileAtomic(sourceFile: string, targetFile: string): Promise<void> {
    this.assertUnderUserLayer(targetFile);
    const content = await readFile(sourceFile);
    const tempPath = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
    if (dirname(tempPath) !== dirname(targetFile)) {
      throw new Error(
        `[UserLayerMirror] temp path must share the target parent dir: ${tempPath}`,
      );
    }
    let renamed = false;
    try {
      await writeFile(tempPath, content);
      await rename(tempPath, targetFile);
      renamed = true;
    } finally {
      if (!renamed) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
  }

  async writeTextAtomic(targetFile: string, content: string): Promise<void> {
    this.assertUnderUserLayer(targetFile);
    const tempPath = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
    if (dirname(tempPath) !== dirname(targetFile)) {
      throw new Error(
        `[UserLayerMirror] temp path must share the target parent dir: ${tempPath}`,
      );
    }
    await mkdir(dirname(targetFile), { recursive: true });
    let renamed = false;
    try {
      await writeFile(tempPath, content, 'utf8');
      await rename(tempPath, targetFile);
      renamed = true;
    } finally {
      if (!renamed) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
  }

  /** Delete everything in a clone dir except `.history/` and the sidecar. */
  async clearCloneTrackedContent(cloneDir: string): Promise<void> {
    this.assertUnderUserLayer(cloneDir);
    const entries = await readdir(cloneDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === DEFAULT_HISTORY_DIR) {
        continue;
      }
      if (entry.name === ORIGIN_SIDECAR_FILENAME) {
        continue;
      }
      const entryPath = join(cloneDir, entry.name);
      this.assertUnderUserLayer(entryPath);
      await rm(entryPath, { recursive: true, force: true });
    }
  }

  /** `rm -rf`, guarded to the user layer. */
  async removePath(targetPath: string): Promise<void> {
    this.assertUnderUserLayer(targetPath);
    await rm(targetPath, { recursive: true, force: true });
  }

  async makeUniqueHistoryDir(parentDir: string, ts: string): Promise<string> {
    this.assertUnderUserLayer(parentDir);
    await mkdir(parentDir, { recursive: true });
    let candidate = join(parentDir, ts);
    let counter = 0;
    for (;;) {
      this.assertUnderUserLayer(candidate);
      try {
        await mkdir(candidate, { recursive: false });
        return candidate;
      } catch (error: unknown) {
        if (!isErrnoCode(error, 'EEXIST')) {
          throw error;
        }
        counter += 1;
        candidate = join(parentDir, `${ts}-${counter}`);
      }
    }
  }

  async snapshotTreeRec(
    sourceDir: string,
    targetDir: string,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_COPY_RECURSION_DEPTH) {
      this.logger.warn(
        '[UserLayerMirror] snapshot recursion depth cutoff; history may be partial',
        { sourceDir, maxDepth: MAX_COPY_RECURSION_DEPTH },
      );
      return;
    }
    await mkdir(targetDir, { recursive: true });
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name === DEFAULT_HISTORY_DIR) {
        continue;
      }
      if (entry.name === ORIGIN_SIDECAR_FILENAME) {
        continue;
      }
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await this.snapshotTreeRec(sourcePath, targetPath, depth + 1);
      } else if (entry.isFile()) {
        await this.copyFileAtomic(sourcePath, targetPath);
      }
    }
  }

  /** Snapshot a dir clone INTO its own `.history/<ts>/`. */
  async snapshotDirToHistory(cloneDir: string): Promise<string> {
    const historyTsDir = await this.makeUniqueHistoryDir(
      join(cloneDir, DEFAULT_HISTORY_DIR),
      String(Date.now()),
    );
    await this.snapshotTreeRec(cloneDir, historyTsDir, 0);
    return historyTsDir;
  }

  /**
   * Snapshot a dir clone into the ROOT's `.history/<slug>/<ts>/` — the layout
   * flat file clones already use.
   *
   * This exists because {@link snapshotDirToHistory} writes INSIDE the clone,
   * which is exactly wrong when the next step is deleting the clone: the
   * snapshot would go with it. Reaping is the only caller, and it is the only
   * caller that removes the directory it just snapshotted.
   */
  async snapshotDirToRootHistory(
    rootDir: string,
    slug: string,
    cloneDir: string,
  ): Promise<string> {
    const historyTsDir = await this.makeUniqueHistoryDir(
      join(rootDir, DEFAULT_HISTORY_DIR, slug),
      String(Date.now()),
    );
    await this.snapshotTreeRec(cloneDir, historyTsDir, 0);
    return historyTsDir;
  }

  async snapshotFileToHistory(
    rootDir: string,
    slug: string,
    cloneFile: string,
  ): Promise<string> {
    const historyTsDir = await this.makeUniqueHistoryDir(
      join(rootDir, DEFAULT_HISTORY_DIR, slug),
      String(Date.now()),
    );
    const targetFile = join(historyTsDir, basename(cloneFile));
    await this.copyFileAtomic(cloneFile, targetFile);
    return historyTsDir;
  }

  async listSubdirectories(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  async listMarkdownFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  }

  async dirExists(dir: string): Promise<boolean> {
    try {
      const s = await stat(dir);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const s = await stat(filePath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  isEnoent(error: unknown): boolean {
    return isErrnoCode(error, 'ENOENT');
  }
}
