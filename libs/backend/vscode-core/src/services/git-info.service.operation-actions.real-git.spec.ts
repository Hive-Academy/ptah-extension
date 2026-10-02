/**
 * GitInfoService abort / continue of an in-progress operation and the
 * merge-tool stage files against REAL git (TASK_2026_576 Requirement 11).
 *
 * - The operation is re-detected by the backend: a kind passed by a caller is
 *   ignored.
 * - Continue is refused while a path is unmerged, then completes without an
 *   editor: the inherited `GIT_EDITOR` / `core.editor` are set to `false`, so
 *   any editor launch would fail the step.
 * - Stage files are written inside the git directory and removed when the
 *   operation ends (abort, continue, or a status read with no operation).
 * - No `index.lock` is left behind.
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 *   libs/backend/vscode-core/src/services/git/git-operation-actions.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  GitOperationAbortResult,
  GitRepoOperationKind,
} from '@ptah-extension/shared';
import { GitInfoService } from './git-info.service';
import type { Logger } from '../logging';

const SETUP_ENV = {
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
    env: SETUP_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Run a git command that is expected to stop on a conflict (non-zero exit). */
function gitConflict(repo: string, ...args: string[]): void {
  expect(() => git(repo, ...args)).toThrow();
}

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  createdDirs.push(dir);
  return dir;
}

function makeRepo(): string {
  const dir = makeTempDir('ptah-op-actions-');
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  // Any editor git opened would fail the step.
  git(dir, 'config', 'core.editor', 'false');
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

function head(repo: string, rev = 'HEAD'): string {
  return git(repo, 'rev-parse', rev).trim();
}

function gitPath(repo: string, name: string): string {
  return path.resolve(repo, git(repo, 'rev-parse', '--git-path', name).trim());
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * `main` and `feature` both edit `a.txt` from one base; `feature` has
 * `featureCommits` commits, each rewriting `a.txt`.
 */
function makeDivergedRepo(featureCommits = 1): string {
  const repo = makeRepo();
  write(repo, 'a.txt', 'base\n');
  write(repo, 'keep.txt', 'unchanged\n');
  commitAll(repo, 'base');
  git(repo, 'branch', 'feature');
  write(repo, 'a.txt', 'main side\n');
  commitAll(repo, 'main edit');
  git(repo, 'checkout', '-q', 'feature');
  for (let i = 1; i <= featureCommits; i++) {
    write(repo, 'a.txt', `feature side ${i}\n`);
    commitAll(repo, `feature edit ${i}`);
  }
  git(repo, 'checkout', '-q', 'main');
  return repo;
}

/** Start `kind` on `main` so that it stops on the `a.txt` conflict. */
function stopOnConflict(repo: string, kind: GitRepoOperationKind): void {
  switch (kind) {
    case 'merge':
      gitConflict(repo, 'merge', '--no-edit', 'feature');
      return;
    case 'cherry-pick':
      gitConflict(repo, 'cherry-pick', 'feature');
      return;
    case 'rebase':
      gitConflict(repo, 'rebase', 'feature');
      return;
  }
}

function resolve(repo: string, content = 'resolved\n'): void {
  write(repo, 'a.txt', content);
  git(repo, 'add', 'a.txt');
}

function expectNoIndexLock(repo: string): void {
  expect(fs.existsSync(gitPath(repo, 'index.lock'))).toBe(false);
}

const KINDS: GitRepoOperationKind[] = ['merge', 'rebase', 'cherry-pick'];

describe('GitInfoService operation abort / continue (real git)', () => {
  jest.setTimeout(120_000);

  let service: GitInfoService;
  const savedEnv: Record<string, string | undefined> = {};
  const HOSTILE_ENV = {
    GIT_EDITOR: 'false',
    GIT_SEQUENCE_EDITOR: 'false',
    GIT_MERGE_AUTOEDIT: 'yes',
  };

  beforeAll(() => {
    const version = execFileSync('git', ['--version'], { encoding: 'utf8' });
    expect(version).toMatch(/^git version/);
    // The service inherits process.env: an editor it failed to override
    // would run `false` and fail the continue.
    for (const [key, value] of Object.entries(HOSTILE_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
  });

  beforeEach(() => {
    service = new GitInfoService(makeLogger());
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('reports no-operation for a clean repository and runs nothing', async () => {
    const repo = makeDivergedRepo();
    const before = head(repo);

    expect(await service.abortOperation(repo)).toEqual({
      status: 'no-operation',
    });
    expect(await service.continueOperation(repo)).toEqual({
      status: 'no-operation',
    });
    expect(head(repo)).toBe(before);
  });

  describe('merge', () => {
    it('refuses continue while conflicted, then continues with no editor', async () => {
      const repo = makeDivergedRepo();
      const mainTip = head(repo);
      stopOnConflict(repo, 'merge');

      const refused = await service.continueOperation(repo);
      expect(refused).toEqual({
        status: 'conflicts-remain',
        kind: 'merge',
        conflictedPaths: ['a.txt'],
      });
      expect(fs.existsSync(gitPath(repo, 'MERGE_HEAD'))).toBe(true);

      resolve(repo);
      const continued = await service.continueOperation(repo);

      expect(continued).toEqual({ status: 'completed', kind: 'merge' });
      expect(fs.existsSync(gitPath(repo, 'MERGE_HEAD'))).toBe(false);
      expect(head(repo, 'HEAD^1')).toBe(mainTip);
      expect(head(repo, 'HEAD^2')).toBe(head(repo, 'feature'));
      expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe(
        "Merge branch 'feature'",
      );
      expect((await service.getGitInfo(repo)).operation).toBeUndefined();
      expectNoIndexLock(repo);
    });

    it('aborts a conflicted merge back to the branch tip', async () => {
      const repo = makeDivergedRepo();
      const mainTip = head(repo);
      stopOnConflict(repo, 'merge');

      const result = await service.abortOperation(repo);

      expect(result).toEqual({ status: 'completed', kind: 'merge' });
      expect(head(repo)).toBe(mainTip);
      expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe(
        'main side\n',
      );
      expect(git(repo, 'status', '--porcelain')).toBe('');
      expectNoIndexLock(repo);
    });
  });

  describe('rebase', () => {
    it('aborts a conflicted rebase and restores the branch', async () => {
      const repo = makeDivergedRepo();
      const mainTip = head(repo);
      stopOnConflict(repo, 'rebase');

      const result = await service.abortOperation(repo);

      expect(result).toEqual({ status: 'completed', kind: 'rebase' });
      expect(fs.existsSync(gitPath(repo, 'rebase-merge'))).toBe(false);
      expect(fs.existsSync(gitPath(repo, 'rebase-apply'))).toBe(false);
      expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
      expect(head(repo)).toBe(mainTip);
      expectNoIndexLock(repo);
    });

    it('continues a resolved rebase with no editor', async () => {
      const repo = makeDivergedRepo();
      stopOnConflict(repo, 'rebase');
      resolve(repo);

      const result = await service.continueOperation(repo);

      expect(result).toEqual({ status: 'completed', kind: 'rebase' });
      expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
      expect(head(repo, 'HEAD^')).toBe(head(repo, 'feature'));
      expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('main edit');
      expectNoIndexLock(repo);
    });

    it('reports stopped when the next step conflicts too', async () => {
      // Rebase `feature` (two commits) onto `main`: both picks conflict.
      const repo = makeDivergedRepo(2);
      git(repo, 'checkout', '-q', 'feature');
      gitConflict(repo, 'rebase', 'main');
      resolve(repo, 'resolved first\n');

      const result = await service.continueOperation(repo);

      expect(result).toEqual({
        status: 'stopped',
        kind: 'rebase',
        conflictedPaths: ['a.txt'],
      });
      expect(fs.existsSync(gitPath(repo, 'rebase-merge'))).toBe(true);

      resolve(repo, 'resolved second\n');
      expect(await service.continueOperation(repo)).toEqual({
        status: 'completed',
        kind: 'rebase',
      });
      expectNoIndexLock(repo);
    });
  });

  describe('cherry-pick', () => {
    it('refuses continue while conflicted, then continues', async () => {
      const repo = makeDivergedRepo();
      const mainTip = head(repo);
      stopOnConflict(repo, 'cherry-pick');

      expect(await service.continueOperation(repo)).toEqual({
        status: 'conflicts-remain',
        kind: 'cherry-pick',
        conflictedPaths: ['a.txt'],
      });

      resolve(repo);
      const result = await service.continueOperation(repo);

      expect(result).toEqual({ status: 'completed', kind: 'cherry-pick' });
      expect(fs.existsSync(gitPath(repo, 'CHERRY_PICK_HEAD'))).toBe(false);
      expect(head(repo, 'HEAD^')).toBe(mainTip);
      expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe(
        'feature edit 1',
      );
      expectNoIndexLock(repo);
    });

    it('aborts a conflicted cherry-pick', async () => {
      const repo = makeDivergedRepo();
      const mainTip = head(repo);
      stopOnConflict(repo, 'cherry-pick');

      expect(await service.abortOperation(repo)).toEqual({
        status: 'completed',
        kind: 'cherry-pick',
      });
      expect(head(repo)).toBe(mainTip);
      expect(git(repo, 'status', '--porcelain')).toBe('');
      expectNoIndexLock(repo);
    });
  });

  it('acts on the detected kind, never on one the caller passes', async () => {
    const repo = makeDivergedRepo();
    stopOnConflict(repo, 'rebase');
    // A client that smuggles a kind through: the facade takes none.
    const abortWithKind = service.abortOperation.bind(service) as (
      workspacePath: string,
      kind: string,
    ) => Promise<GitOperationAbortResult>;

    const result = await abortWithKind(repo, 'merge');

    expect(result).toEqual({ status: 'completed', kind: 'rebase' });
    expect(fs.existsSync(gitPath(repo, 'rebase-merge'))).toBe(false);
  });

  describe('conflict stages', () => {
    it.each(KINDS)(
      'writes base/local/remote for a %s and removes them on abort',
      async (kind) => {
        const repo = makeDivergedRepo();
        stopOnConflict(repo, kind);

        const stages = await service.materializeConflictStages(repo, 'a.txt');

        expect(stages.status).toBe('ok');
        if (stages.status !== 'ok') return;
        const stageRoot = gitPath(repo, 'ptah-merge');
        for (const file of [stages.base, stages.local, stages.remote]) {
          expect(file.startsWith(stageRoot + path.sep)).toBe(true);
          expect(path.extname(file)).toBe('.txt');
        }
        expect(fs.readFileSync(stages.base, 'utf8')).toBe('base\n');
        // Stage 2 is HEAD's side; a rebase replays `main` onto `feature`.
        const ours = kind === 'rebase' ? 'feature side 1\n' : 'main side\n';
        const theirs = kind === 'rebase' ? 'main side\n' : 'feature side 1\n';
        expect(fs.readFileSync(stages.local, 'utf8')).toBe(ours);
        expect(fs.readFileSync(stages.remote, 'utf8')).toBe(theirs);
        expect(stages.result).toBe(path.join(repo, 'a.txt'));
        // Never part of the working tree's status.
        expect(git(repo, 'status', '--porcelain', '--', '.')).not.toContain(
          'ptah-merge',
        );

        expect((await service.abortOperation(repo)).status).toBe('completed');
        expect(fs.existsSync(stageRoot)).toBe(false);
        expectNoIndexLock(repo);
      },
    );

    it('removes them on continue', async () => {
      const repo = makeDivergedRepo();
      stopOnConflict(repo, 'merge');
      const stages = await service.materializeConflictStages(repo, 'a.txt');
      expect(stages.status).toBe('ok');

      resolve(repo);
      expect((await service.continueOperation(repo)).status).toBe('completed');

      expect(fs.existsSync(gitPath(repo, 'ptah-merge'))).toBe(false);
    });

    it('removes them at the next status once the operation ended elsewhere', async () => {
      const repo = makeDivergedRepo();
      stopOnConflict(repo, 'merge');
      expect(
        (await service.materializeConflictStages(repo, 'a.txt')).status,
      ).toBe('ok');
      const stageRoot = gitPath(repo, 'ptah-merge');
      expect(fs.existsSync(stageRoot)).toBe(true);

      git(repo, 'merge', '--abort');
      const info = await service.refreshGitInfo(repo);

      expect(info.operation).toBeUndefined();
      expect(fs.existsSync(stageRoot)).toBe(false);
    });

    it('writes an empty base for an add/add conflict', async () => {
      const repo = makeRepo();
      write(repo, 'keep.txt', 'x\n');
      commitAll(repo, 'base');
      git(repo, 'checkout', '-q', '-b', 'feature');
      write(repo, 'new.md', 'feature\n');
      commitAll(repo, 'feature add');
      git(repo, 'checkout', '-q', 'main');
      write(repo, 'new.md', 'main\n');
      commitAll(repo, 'main add');
      gitConflict(repo, 'merge', '--no-edit', 'feature');

      const stages = await service.materializeConflictStages(repo, 'new.md');

      expect(stages.status).toBe('ok');
      if (stages.status !== 'ok') return;
      expect(fs.readFileSync(stages.base, 'utf8')).toBe('');
      expect(fs.readFileSync(stages.local, 'utf8')).toBe('main\n');
      expect(fs.readFileSync(stages.remote, 'utf8')).toBe('feature\n');
    });

    it('writes the stages when the workspace folder is a repository subdirectory', async () => {
      const repo = makeRepo();
      write(repo, 'pkg/a.txt', 'base\n');
      commitAll(repo, 'base');
      git(repo, 'checkout', '-q', '-b', 'feature');
      write(repo, 'pkg/a.txt', 'feature side\n');
      commitAll(repo, 'feature edit');
      git(repo, 'checkout', '-q', 'main');
      write(repo, 'pkg/a.txt', 'main side\n');
      commitAll(repo, 'main edit');
      gitConflict(repo, 'merge', '--no-edit', 'feature');
      const workspace = path.join(repo, 'pkg');

      // Status paths are top-level relative, so the client names `pkg/a.txt`.
      const stages = await service.materializeConflictStages(
        workspace,
        'pkg/a.txt',
      );

      expect(stages.status).toBe('ok');
      if (stages.status !== 'ok') return;
      expect(fs.readFileSync(stages.base, 'utf8')).toBe('base\n');
      expect(fs.readFileSync(stages.local, 'utf8')).toBe('main side\n');
      expect(fs.readFileSync(stages.remote, 'utf8')).toBe('feature side\n');
      expect(stages.result).toBe(path.join(repo, 'pkg', 'a.txt'));

      expect((await service.abortOperation(workspace)).status).toBe(
        'completed',
      );
      expect(fs.existsSync(gitPath(repo, 'ptah-merge'))).toBe(false);
    });

    it('refuses paths outside the work tree, clean paths and non-text conflicts', async () => {
      const repo = makeRepo();
      write(repo, 'a.txt', 'base\n');
      write(repo, 'keep.txt', 'unchanged\n');
      commitAll(repo, 'base');
      git(repo, 'branch', 'feature');
      git(repo, 'rm', '-q', 'a.txt');
      git(repo, 'commit', '-q', '-m', 'delete');
      git(repo, 'checkout', '-q', 'feature');
      write(repo, 'a.txt', 'edited\n');
      commitAll(repo, 'edit');
      git(repo, 'checkout', '-q', 'main');
      gitConflict(repo, 'merge', '--no-edit', 'feature');

      for (const bad of [
        '../outside.txt',
        'dir/../../outside.txt',
        path.join(repo, 'a.txt'),
        '',
        'a\0b',
      ]) {
        expect(await service.materializeConflictStages(repo, bad)).toEqual({
          status: 'invalid-path',
        });
      }
      expect(await service.materializeConflictStages(repo, 'keep.txt')).toEqual(
        { status: 'not-conflicted' },
      );
      expect(await service.materializeConflictStages(repo, 'a.txt')).toEqual({
        status: 'not-mergeable',
        conflictKind: 'delete-modify',
      });
      expect(fs.existsSync(gitPath(repo, 'ptah-merge'))).toBe(false);
    });

    it('refuses when no operation is in progress', async () => {
      const repo = makeDivergedRepo();
      expect(await service.materializeConflictStages(repo, 'a.txt')).toEqual({
        status: 'no-operation',
      });
    });
  });
});
