/**
 * GitInfoService repository operation, conflict kinds, per-side size limit
 * and Git LFS pointers against REAL git (TASK_2026_576 RC12, Requirement 2.4).
 *
 * - A stopped merge, rebase or cherry-pick is reported as `operation`, in the
 *   main checkout and inside a linked worktree (whose markers live in
 *   `<common>/worktrees/<name>/`, not in the main `.git`).
 * - Unmerged entries are `U` with a conflict kind, never `M`.
 * - A 3 MiB side is `too-large`; a committed LFS pointer (no LFS install) is
 *   `lfs-pointer`. Neither has a patch, and `applyHunks` refuses both with
 *   `BINARY_UNSUPPORTED`.
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 *   libs/backend/vscode-core/src/services/git/git-repo-operation.reader.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { GitRepoOperationKind } from '@ptah-extension/shared';
import { GitInfoService } from './git-info.service';
import type { WorktreeFileAccess } from './git-info.service';
import type { Logger } from '../logging';

const GIT_ENV = {
  ...process.env,
  LC_ALL: 'C',
  LANG: 'C',
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
};

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Run a git command that is expected to stop on a conflict (non-zero exit). */
function gitConflict(repo: string, ...args: string[]): void {
  expect(() => git(repo, ...args)).toThrow();
}

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}

function makeRepo(): string {
  const dir = makeTempDir('ptah-operation-');
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function write(repo: string, relativePath: string, content: string): void {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commitAll(repo: string, message: string): void {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const fileSystem: WorktreeFileAccess = {
  async readFileBytes(filePath: string): Promise<Uint8Array> {
    return fsp.readFile(filePath);
  },
  async exists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  async writeFileBytes(filePath: string, content: Uint8Array): Promise<void> {
    await fsp.writeFile(filePath, content);
  },
};

/**
 * A repository whose `main` and `feature` branches both edit `a.txt` from one
 * base, so merging, rebasing or cherry-picking one onto the other conflicts.
 * Returns the repository root.
 */
function makeDivergedRepo(): string {
  const repo = makeRepo();
  write(repo, 'a.txt', 'base\n');
  write(repo, 'keep.txt', 'unchanged\n');
  commitAll(repo, 'base');
  git(repo, 'branch', 'feature');
  write(repo, 'a.txt', 'main side\n');
  commitAll(repo, 'main edit');
  git(repo, 'checkout', '-q', 'feature');
  write(repo, 'a.txt', 'feature side\n');
  commitAll(repo, 'feature edit');
  git(repo, 'checkout', '-q', 'main');
  return repo;
}

/**
 * Start `kind` in `cwd` so that it stops on the `a.txt` conflict. `cwd` is on
 * `main` (or a branch at `main`); `feature` is the other side.
 */
function stopOnConflict(cwd: string, kind: GitRepoOperationKind): void {
  switch (kind) {
    case 'merge':
      gitConflict(cwd, 'merge', '--no-edit', 'feature');
      return;
    case 'cherry-pick':
      gitConflict(cwd, 'cherry-pick', 'feature');
      return;
    case 'rebase':
      gitConflict(cwd, 'rebase', 'feature');
      return;
  }
}

const KINDS: GitRepoOperationKind[] = ['merge', 'rebase', 'cherry-pick'];

const OID =
  'sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393';
const OTHER_OID =
  'sha256:0000214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e0000';

const lfsPointer = (oid: string, size: number): string =>
  `version https://git-lfs.github.com/spec/v1\noid ${oid}\nsize ${size}\n`;

describe('GitInfoService repository operation and blob limits (real git)', () => {
  jest.setTimeout(120_000);

  let service: GitInfoService;

  beforeAll(() => {
    const version = execFileSync('git', ['--version'], { encoding: 'utf8' });
    expect(version).toMatch(/^git version/);
  });

  beforeEach(() => {
    service = new GitInfoService(makeLogger());
  });

  afterAll(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  describe('operation in progress', () => {
    it('reports no operation for a clean repository', async () => {
      const repo = makeDivergedRepo();
      const info = await service.getGitInfo(repo);
      expect(info.isGitRepo).toBe(true);
      expect(info.operation).toBeUndefined();
    });

    it.each(KINDS)(
      'reports a stopped %s in the main checkout with U entries',
      async (kind) => {
        const repo = makeDivergedRepo();
        stopOnConflict(repo, kind);

        const info = await service.getGitInfo(repo);

        expect(info.operation).toEqual({ kind, conflictedPaths: ['a.txt'] });
        const entries = info.files.filter((file) => file.path === 'a.txt');
        expect(entries).toEqual([
          expect.objectContaining({
            path: 'a.txt',
            status: 'U',
            staged: false,
            conflict: { kind: 'content' },
          }),
        ]);
      },
    );

    it.each(KINDS)(
      'reports a stopped %s inside a linked worktree, and only there',
      async (kind) => {
        const repo = makeDivergedRepo();
        const worktree = path.join(makeTempDir('ptah-operation-wt-'), 'wt');
        git(repo, 'worktree', 'add', '-q', '-b', 'wt-branch', worktree, 'main');
        stopOnConflict(worktree, kind);

        const [inWorktree, inMain] = await Promise.all([
          service.getGitInfo(worktree),
          service.getGitInfo(repo),
        ]);

        expect(inWorktree.operation).toEqual({
          kind,
          conflictedPaths: ['a.txt'],
        });
        expect(
          inWorktree.files.find((file) => file.path === 'a.txt')?.status,
        ).toBe('U');
        expect(inMain.operation).toBeUndefined();
        expect(inMain.files).toEqual([]);
      },
    );

    it('notices an operation that starts after the first status read', async () => {
      const repo = makeDivergedRepo();
      expect((await service.getGitInfo(repo)).operation).toBeUndefined();

      stopOnConflict(repo, 'merge');
      const info = await service.refreshGitInfo(repo);

      expect(info.operation).toEqual({
        kind: 'merge',
        conflictedPaths: ['a.txt'],
      });
    });

    it('labels a delete/modify conflict', async () => {
      const repo = makeRepo();
      write(repo, 'a.txt', 'base\n');
      commitAll(repo, 'base');
      git(repo, 'branch', 'feature');
      git(repo, 'rm', '-q', 'a.txt');
      git(repo, 'commit', '-q', '-m', 'delete');
      git(repo, 'checkout', '-q', 'feature');
      write(repo, 'a.txt', 'edited\n');
      commitAll(repo, 'edit');
      git(repo, 'checkout', '-q', 'main');
      gitConflict(repo, 'merge', '--no-edit', 'feature');

      const info = await service.getGitInfo(repo);

      expect(info.operation?.kind).toBe('merge');
      expect(info.files).toEqual([
        expect.objectContaining({
          path: 'a.txt',
          status: 'U',
          conflict: { kind: 'delete-modify' },
        }),
      ]);
    });
  });

  describe('per-side size limit', () => {
    const THREE_MIB = 3 * 1024 * 1024;

    function makeLargeFileRepo(): string {
      const repo = makeRepo();
      write(repo, 'big.txt', 'a'.repeat(THREE_MIB - 1) + '\n');
      commitAll(repo, 'big');
      write(repo, 'big.txt', 'b'.repeat(THREE_MIB - 1) + '\n');
      return repo;
    }

    it('reports both sides of a 3 MiB worktree diff as too-large', async () => {
      const repo = makeLargeFileRepo();

      const diff = await service.diffFile(
        repo,
        { path: 'big.txt', comparison: 'worktree' },
        fileSystem,
      );

      expect(diff.original).toEqual({
        outcome: 'too-large',
        byteLength: THREE_MIB,
      });
      expect(diff.modified).toEqual({
        outcome: 'too-large',
        byteLength: THREE_MIB,
      });
      expect(diff.patch).toBeNull();
      expect(diff.hunks).toEqual([]);
    });

    it('reports a 3 MiB committed side of a staged diff as too-large', async () => {
      const repo = makeLargeFileRepo();
      git(repo, 'add', 'big.txt');

      const diff = await service.diffFile(
        repo,
        { path: 'big.txt', comparison: 'staged' },
        fileSystem,
      );

      expect(diff.original).toEqual({
        outcome: 'too-large',
        byteLength: THREE_MIB,
      });
      expect(diff.modified.outcome).toBe('too-large');
      expect(diff.patch).toBeNull();
    });

    it('refuses to apply hunks to a too-large file', async () => {
      const repo = makeLargeFileRepo();
      const diff = await service.diffFile(
        repo,
        { path: 'big.txt', comparison: 'worktree' },
        fileSystem,
      );

      const result = await service.applyHunks(
        repo,
        {
          path: 'big.txt',
          comparison: 'worktree',
          operation: 'stage',
          hunkIndices: [0],
          snapshotToken: diff.snapshotToken,
        },
        fileSystem,
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          code: 'BINARY_UNSUPPORTED',
        }),
      );
      expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    });
  });

  describe('Git LFS pointers', () => {
    function makePointerRepo(): string {
      const repo = makeRepo();
      write(repo, 'model.bin', lfsPointer(OID, 1_048_576));
      commitAll(repo, 'pointer');
      write(repo, 'model.bin', lfsPointer(OTHER_OID, 2_097_152));
      return repo;
    }

    it('labels both sides of a pointer diff with their oid and size', async () => {
      const repo = makePointerRepo();

      const diff = await service.diffFile(
        repo,
        { path: 'model.bin', comparison: 'worktree' },
        fileSystem,
      );

      expect(diff.original).toEqual({
        outcome: 'lfs-pointer',
        oid: OID,
        size: 1_048_576,
      });
      expect(diff.modified).toEqual({
        outcome: 'lfs-pointer',
        oid: OTHER_OID,
        size: 2_097_152,
      });
      expect(diff.patch).toBeNull();
      expect(diff.hunks).toEqual([]);
    });

    it('refuses to apply hunks to a pointer file', async () => {
      const repo = makePointerRepo();
      const diff = await service.diffFile(
        repo,
        { path: 'model.bin', comparison: 'worktree' },
        fileSystem,
      );

      const result = await service.applyHunks(
        repo,
        {
          path: 'model.bin',
          comparison: 'worktree',
          operation: 'stage',
          hunkIndices: [0],
          snapshotToken: diff.snapshotToken,
        },
        fileSystem,
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          code: 'BINARY_UNSUPPORTED',
        }),
      );
      expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    });
  });
});
