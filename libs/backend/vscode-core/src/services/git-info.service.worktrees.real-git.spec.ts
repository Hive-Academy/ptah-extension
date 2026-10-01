/**
 * GitInfoService worktree administration against REAL git (TASK_2026_576
 * RC10, Requirement 2.2).
 *
 * Agent worktrees live under `<repo>/.claude-worktrees/`. Unexcluded, that
 * directory showed as untracked and `git add -- .` swept it in; deleted with
 * `rm -rf`, its admin entry lingered forever. Covered here:
 * - the exclude line is written once, to the commondir `info/exclude`, and
 *   `.claude-worktrees/` is then absent from `status` and from `add -- .`;
 * - an exclude write failure is warned and the add still succeeds;
 * - a locked worktree is labelled and never force-removed;
 * - an `rm -rf` worktree is labelled prunable, and prune drops its entry;
 * - each call acts on the root it is given.
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 *   libs/backend/vscode-core/src/services/git/agent-worktree-admin.ts
 *   libs/shared/src/lib/utils/git.utils.ts (parseWorktreeList)
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitInfoService } from './git-info.service';
import type { Logger } from '../logging';

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const EXCLUDE_LINE = '/.claude-worktrees/';

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}

/** A repository with one commit on `main`. */
function makeRepo(): string {
  const dir = makeTempDir('ptah-worktrees-');
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'first');
  return dir;
}

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function commonExcludeFile(repo: string): string {
  return path.join(repo, '.git', 'info', 'exclude');
}

function excludeLineCount(file: string): number {
  if (!fs.existsSync(file)) return 0;
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() === EXCLUDE_LINE).length;
}

function samePath(a: string, b: string): boolean {
  const fold = (p: string) => {
    const f = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? f.toLowerCase() : f;
  };
  return fold(a) === fold(b);
}

let logger: jest.Mocked<Logger>;
let service: GitInfoService;

beforeEach(() => {
  logger = makeLogger();
  service = new GitInfoService(logger);
});

afterAll(() => {
  for (const dir of createdDirs.reverse()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('GitInfoService worktree administration (real git)', () => {
  jest.setTimeout(120_000);

  describe('exclude on create', () => {
    it('writes the exclude line once and keeps agent worktrees out of status and add', async () => {
      const repo = makeRepo();
      const exclude = commonExcludeFile(repo);

      const first = await service.addWorktree(repo, {
        branch: 'agent-one',
        createBranch: true,
      });
      const second = await service.addWorktree(repo, {
        branch: 'agent-two',
        createBranch: true,
      });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(first.worktreePath).toContain(
        `${path.sep}.claude-worktrees${path.sep}`,
      );
      expect(excludeLineCount(exclude)).toBe(1);

      expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe(
        '',
      );
      git(repo, 'add', '--', '.');
      expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    });

    it('writes to the common info/exclude when called from a linked worktree', async () => {
      const repo = makeRepo();
      const linked = path.join(makeTempDir('ptah-linked-'), 'linked');
      git(repo, 'worktree', 'add', '-q', '-b', 'linked', linked);

      const result = await service.addWorktree(linked, {
        branch: 'agent-from-linked',
        createBranch: true,
      });

      expect(result.success).toBe(true);
      expect(excludeLineCount(commonExcludeFile(repo))).toBe(1);
      expect(
        fs.existsSync(
          path.join(repo, '.git', 'worktrees', 'linked', 'info', 'exclude'),
        ),
      ).toBe(false);
      expect(
        git(linked, 'status', '--porcelain', '--untracked-files=all'),
      ).toBe('');
    });

    it('writes nothing when the directory is already ignored', async () => {
      const repo = makeRepo();
      fs.writeFileSync(path.join(repo, '.gitignore'), '.claude-worktrees/\n');
      git(repo, 'add', '.gitignore');
      git(repo, 'commit', '-qm', 'ignore');

      const result = await service.addWorktree(repo, {
        branch: 'agent-ignored',
        createBranch: true,
      });

      expect(result.success).toBe(true);
      expect(excludeLineCount(commonExcludeFile(repo))).toBe(0);
    });

    it('does not touch the exclude for a worktree outside .claude-worktrees', async () => {
      const repo = makeRepo();
      const outside = path.join(makeTempDir('ptah-outside-'), 'wt');

      const result = await service.addWorktree(repo, {
        branch: 'outside',
        path: outside,
        createBranch: true,
      });

      expect(result).toEqual({ success: true, worktreePath: outside });
      expect(excludeLineCount(commonExcludeFile(repo))).toBe(0);
    });

    it('warns and still succeeds when the exclude cannot be written', async () => {
      const repo = makeRepo();
      const exclude = commonExcludeFile(repo);
      fs.rmSync(exclude, { force: true });
      fs.mkdirSync(exclude, { recursive: true }); // a directory: unreadable as a file

      const result = await service.addWorktree(repo, {
        branch: 'agent-unwritable',
        createBranch: true,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(result.worktreePath ?? '')).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('could not exclude'),
        expect.objectContaining({ workspacePath: repo }),
      );
    });
  });

  describe('locked worktrees', () => {
    it('labels a locked worktree with its reason and never force-removes it', async () => {
      const repo = makeRepo();
      const added = await service.addWorktree(repo, {
        branch: 'agent-locked',
        createBranch: true,
      });
      const wtPath = added.worktreePath ?? '';
      git(repo, 'worktree', 'lock', '--reason', 'keep me', wtPath);

      const listed = await service.getWorktrees(repo);
      const entry = listed.find((wt) => samePath(wt.path, wtPath));
      expect(entry).toMatchObject({ locked: true, lockReason: 'keep me' });
      expect(listed[0].locked).toBeUndefined();

      const removed = await service.removeWorktree(repo, wtPath, true);
      expect(removed.success).toBe(false);
      expect(removed.error).toMatch(/locked \(keep me\)/);
      expect(fs.existsSync(wtPath)).toBe(true);
      expect(
        (await service.getWorktrees(repo)).some((wt) =>
          samePath(wt.path, wtPath),
        ),
      ).toBe(true);
    });

    it('labels a lock without a reason', async () => {
      const repo = makeRepo();
      const added = await service.addWorktree(repo, {
        branch: 'agent-bare-lock',
        createBranch: true,
      });
      git(repo, 'worktree', 'lock', added.worktreePath ?? '');

      const entry = (await service.getWorktrees(repo)).find((wt) =>
        samePath(wt.path, added.worktreePath ?? ''),
      );
      expect(entry?.locked).toBe(true);
      expect(entry?.lockReason).toBeUndefined();
    });
  });

  describe('prunable worktrees', () => {
    it('labels an rm -rf worktree prunable, then prune drops its entry', async () => {
      const repo = makeRepo();
      const added = await service.addWorktree(repo, {
        branch: 'agent-gone',
        createBranch: true,
      });
      const wtPath = added.worktreePath ?? '';
      fs.rmSync(wtPath, { recursive: true, force: true });

      const before = (await service.getWorktrees(repo)).find((wt) =>
        samePath(wt.path, wtPath),
      );
      expect(before?.prunable).toBe(true);
      expect(before?.prunableReason).toEqual(expect.any(String));

      await expect(service.pruneWorktrees(repo)).resolves.toEqual({
        success: true,
      });
      const after = await service.getWorktrees(repo);
      expect(after).toHaveLength(1);
      expect(after[0].isMain).toBe(true);
    });

    it('removes a worktree with remove -- <path> and leaves nothing to prune', async () => {
      const repo = makeRepo();
      const added = await service.addWorktree(repo, {
        branch: 'agent-remove',
        createBranch: true,
      });

      await expect(
        service.removeWorktree(repo, added.worktreePath ?? ''),
      ).resolves.toEqual({ success: true });
      expect(fs.existsSync(added.worktreePath ?? '')).toBe(false);
      expect(await service.getWorktrees(repo)).toHaveLength(1);
    });
  });

  describe('root scoping', () => {
    it('lists and prunes only the repository it is given', async () => {
      const repoA = makeRepo();
      const repoB = makeRepo();
      const inA = await service.addWorktree(repoA, {
        branch: 'agent-a',
        createBranch: true,
      });
      const inB = await service.addWorktree(repoB, {
        branch: 'agent-b',
        createBranch: true,
      });
      fs.rmSync(inA.worktreePath ?? '', { recursive: true, force: true });
      fs.rmSync(inB.worktreePath ?? '', { recursive: true, force: true });

      await service.pruneWorktrees(repoA);

      expect(await service.getWorktrees(repoA)).toHaveLength(1);
      const listedB = await service.getWorktrees(repoB);
      expect(listedB).toHaveLength(2);
      expect(listedB[1].prunable).toBe(true);
      expect(excludeLineCount(commonExcludeFile(repoA))).toBe(1);
      expect(excludeLineCount(commonExcludeFile(repoB))).toBe(1);
    });
  });
});
