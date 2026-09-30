/**
 * GitInfoService hunk writes under hostile diff config, against REAL git
 * (TASK_2026_576 RC7, Requirement 1.9).
 *
 * The hunk path reads `git diff` and hands the reassembled patch to
 * `git apply`. A user's `diff.noprefix`, custom `diff.srcPrefix` /
 * `diff.dstPrefix` or a textconv driver changes what `git diff` prints, and
 * the patch then no longer applies (wrong `-p1` strip, or text that is not the
 * file's). The explicit `--src-prefix=a/ --dst-prefix=b/ --no-textconv` in
 * `DIFF_FLAGS` must make stage, unstage and revert work under each of them.
 *
 * Every repository is created under the OS temp directory and deleted.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { GitInfoService } from './git-info.service';
import type { WorktreeFileAccess } from './git-info.service';
import type { Logger } from '../logging';

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

const createdDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
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

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const BASE = Array.from({ length: 60 }, (_, i) => `l${i + 1}`);

/** Three well-separated edits => three `@@` hunks at -U3. */
function edited(): string[] {
  const next = [...BASE];
  next[4] = 'l5-mod';
  next[24] = 'l25-mod';
  next[44] = 'l45-mod';
  return next;
}

/**
 * A textconv driver that upper-cases the file. Written as a node script in
 * its own temp directory (outside the repository) so it runs on every OS.
 */
function upperCaseTextconv(repo: string): void {
  const scriptDir = tempDir('ptah-textconv-');
  const script = path.join(scriptDir, 'upper.js');
  fs.writeFileSync(
    script,
    "process.stdout.write(require('fs').readFileSync(process.argv[2], 'utf8').toUpperCase());\n",
  );
  const slash = (p: string): string => p.replace(/\\/g, '/');
  git(
    repo,
    'config',
    'diff.upper.textconv',
    `"${slash(process.execPath)}" "${slash(script)}"`,
  );
  fs.writeFileSync(path.join(repo, '.gitattributes'), 'f.txt diff=upper\n');
  git(repo, 'add', '.gitattributes');
  git(repo, 'commit', '-qm', 'attributes');
}

type Setup = (repo: string) => void;

const CONFIGS: Array<[string, Setup, (plainDiff: string) => void]> = [
  [
    'diff.noprefix=true',
    (repo) => git(repo, 'config', 'diff.noprefix', 'true'),
    (plain) => expect(plain).toContain('--- f.txt'),
  ],
  [
    'custom diff.srcPrefix / diff.dstPrefix',
    (repo) => {
      git(repo, 'config', 'diff.srcPrefix', 'SRC/');
      git(repo, 'config', 'diff.dstPrefix', 'DST/');
    },
    (plain) => expect(plain).toContain('--- SRC/f.txt'),
  ],
  [
    'a textconv driver',
    upperCaseTextconv,
    (plain) => expect(plain).toContain('+L5-MOD'),
  ],
];

describe('GitInfoService hunk writes under diff config (real git)', () => {
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

  function makeRepo(setup: Setup): string {
    const repo = tempDir('ptah-diffcfg-');
    git(repo, 'init', '-q', '-b', 'main', '.');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Ptah Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(repo, 'f.txt'), `${BASE.join('\n')}\n`);
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-qm', 'init');
    setup(repo);
    fs.writeFileSync(path.join(repo, 'f.txt'), `${edited().join('\n')}\n`);
    return repo;
  }

  async function apply(
    repo: string,
    comparison: 'worktree' | 'staged',
    operation: 'stage' | 'unstage' | 'revert',
    hunkIndices: number[],
  ) {
    const diff = await service.diffFile(
      repo,
      { path: 'f.txt', comparison },
      fileSystem,
    );
    // The patch the write path works from ignores the user's diff config.
    expect(diff.patch).toContain('--- a/f.txt\n+++ b/f.txt\n');
    expect(diff.patch).not.toContain('L5-MOD');
    return service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison,
        operation,
        hunkIndices,
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );
  }

  it.each(CONFIGS)(
    'stage, unstage and revert one hunk succeed under %s',
    async (_label, setup, proveActive) => {
      const repo = makeRepo(setup);
      // The config really is in force for plain `git diff`.
      proveActive(git(repo, 'diff'));

      await expect(
        apply(repo, 'worktree', 'stage', [0]),
      ).resolves.toMatchObject({ success: true });
      expect(git(repo, 'diff', '--cached', '--no-textconv')).toContain(
        '+l5-mod',
      );

      await expect(
        apply(repo, 'staged', 'unstage', [0]),
      ).resolves.toMatchObject({ success: true });
      expect(git(repo, 'diff', '--cached')).toBe('');

      await expect(
        apply(repo, 'worktree', 'revert', [2]),
      ).resolves.toMatchObject({ success: true });
      const text = fs.readFileSync(path.join(repo, 'f.txt'), 'utf8');
      expect(text).toContain('l5-mod');
      expect(text).toContain('l25-mod');
      expect(text).not.toContain('l45-mod');
      expect(text).toContain('l45\n');
    },
  );
});
