/**
 * GitInfoService.applyHunks — against REAL git, in REAL throwaway repositories.
 *
 * This file deliberately does NOT mock `cross-spawn`. `git-info.service.spec.ts`
 * does, which is right for the read path — but this code writes to a git index
 * and to a working tree, and a mocked `git apply` proves nothing about whether
 * a patch we reassembled is one git would actually accept. Every repository
 * here is created under the OS temp directory, asserted against, and deleted.
 * Nothing touches the repository this file lives in.
 *
 * Guard coverage (batch-8-dispatch §4):
 *   1 snapshot staleness refusal        — AC6   'refuses a diff that moved ...'
 *   2 server-side recompute (no cache)  — AC6   'recomputes ... on every call'
 *   3 atomic rollback                   — AC7   'restores the index ...' / worktree
 *   4 INVALID_OPERATION matrix          — AC12  'refuses unstage on a worktree diff'
 *   5 BINARY_UNSUPPORTED                — AC10  'refuses a binary file'
 *   6 validatePathSegment on both paths — NFR-8 'refuses traversal in originalPath'
 *
 * Acceptance coverage: AC2 (stage), AC3 (unstage), AC4 (revert), AC7, AC9
 * (CRLF / no-trailing-newline / non-ASCII byte identity against an independent
 * reassembly applied through the git CLI).
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

// ---------------------------------------------------------------------------
// Real-git harness
// ---------------------------------------------------------------------------

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

/** Raw bytes of `git diff [--cached]`, for byte-for-byte comparison. */
function gitDiffBytes(repo: string, cached: boolean): Buffer {
  return execFileSync(
    'git',
    ['diff', ...(cached ? ['--cached'] : []), '--no-color', '--no-ext-diff'],
    { cwd: repo, env: GIT_ENV },
  );
}

const createdRepos: string[] = [];

/**
 * A fresh repository with every setting this suite depends on pinned, so a
 * developer's global gitconfig cannot change what the assertions mean.
 * `core.autocrlf` is a parameter precisely because it is the setting AC9 is
 * about.
 */
function makeRepo(autocrlf: 'true' | 'false' | 'input' = 'false'): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-hunks-')),
  );
  createdRepos.push(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', autocrlf);
  return dir;
}

function write(repo: string, rel: string, contents: string | Buffer): void {
  fs.writeFileSync(path.join(repo, rel), contents);
}

function readBytes(repo: string, rel: string): Buffer {
  return fs.readFileSync(path.join(repo, rel));
}

/** 60 numbered lines; the fixture every multi-hunk test starts from. */
function baseLines(): string[] {
  return Array.from({ length: 60 }, (_, i) => `L${i + 1}`);
}

/** Three well-separated edits => exactly three `@@` hunks at -U3. */
function threeEdits(lines: string[]): string[] {
  const next = [...lines];
  next[4] = 'L5-MOD';
  next[24] = 'L25-MOD';
  next[44] = 'L45-MOD';
  return next;
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** The real `IFileSystemProvider` slice the service needs, backed by node fs. */
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
 * The service's private git seam, for the two tests that must interleave an
 * event with a specific git invocation. Typed rather than cast to `any`.
 */
interface ExecGitSeam {
  execGit(
    args: string[],
    cwd: string,
    options?: { stdin?: string | Buffer },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

function execGitSeam(service: GitInfoService): ExecGitSeam {
  return service as unknown as ExecGitSeam;
}

/**
 * An INDEPENDENT reassembly, written differently on purpose (lookahead split
 * rather than a terminator-preserving scan). AC9's byte-identity claim is only
 * worth something if the reference implementation is not the one under test.
 */
function referenceReassemble(patch: string, indices: number[]): string {
  const parts = patch.split(/^(?=@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)/m);
  const [header, ...hunks] = parts;
  return header + indices.map((i) => hunks[i]).join('');
}

// ---------------------------------------------------------------------------

describe('GitInfoService.applyHunks (real git)', () => {
  jest.setTimeout(120_000);

  let service: GitInfoService;
  let logger: Logger;

  beforeAll(() => {
    // Fail loudly rather than silently skipping: "no git" must not read as
    // "the write path is verified".
    const version = execFileSync('git', ['--version'], { encoding: 'utf8' });
    expect(version).toMatch(/^git version/);
  });

  beforeEach(() => {
    logger = makeLogger();
    service = new GitInfoService(logger);
  });

  afterAll(() => {
    for (const dir of createdRepos.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  /** Commit `f.txt` with 60 lines, then apply `threeEdits` to the worktree. */
  function repoWithThreeWorktreeHunks(): string {
    const repo = makeRepo();
    write(repo, 'f.txt', `${baseLines().join('\n')}\n`);
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-qm', 'init');
    write(repo, 'f.txt', `${threeEdits(baseLines()).join('\n')}\n`);
    return repo;
  }

  async function snapshot(repo: string, comparison: 'staged' | 'worktree') {
    return service.diffFile(repo, { path: 'f.txt', comparison }, fileSystem);
  }

  // -------------------------------------------------------------------------
  // Task 8.1 — patch + hunks on the read path
  // -------------------------------------------------------------------------

  it('reports git’s own patch and one GitHunkRef per @@ header', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');

    expect(diff.patch).toContain('diff --git a/f.txt b/f.txt');
    expect(diff.hunks).toHaveLength(3);
    expect(diff.hunks.map((h) => h.index)).toEqual([0, 1, 2]);

    // Positions come from git, and must match the headers git emitted.
    const headers = (diff.patch ?? '')
      .split('\n')
      .filter((line) => line.startsWith('@@ '));
    expect(diff.hunks.map((h) => h.header)).toEqual(headers);
    expect(diff.hunks[1].modifiedStart).toBeGreaterThan(
      diff.hunks[0].modifiedStart,
    );
  });

  it('asks for BOTH paths of a staged rename, so the patch is a rename and not a whole-file addition', async () => {
    const repo = makeRepo();
    write(repo, 'old.txt', 'a\nb\nc\nd\ne\nf\ng\nh\n');
    git(repo, 'add', 'old.txt');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'mv', 'old.txt', 'new.txt');
    write(repo, 'new.txt', 'a\nb\nc-MOD\nd\ne\nf\ng\nh\n');
    git(repo, 'add', 'new.txt');

    const diff = await service.diffFile(
      repo,
      { path: 'new.txt', comparison: 'staged', originalPath: 'old.txt' },
      fileSystem,
    );

    // With only the post-rename pathspec git emits `new file mode` and marks
    // every line an addition — staging from that would stage content whose
    // real pre-image was never read.
    expect(diff.patch).toContain('rename from old.txt');
    expect(diff.patch).not.toContain('new file mode');
    expect(diff.patch).toContain('-c\n');
  });

  // -------------------------------------------------------------------------
  // AC2 / AC3 / AC4 — only the selected hunk moves
  // -------------------------------------------------------------------------

  it('AC2: stages only the selected hunk, leaving the others in the working tree', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [1],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result).toMatchObject({ success: true });
    expect(result.snapshotToken).toEqual(expect.any(String));
    expect(result.snapshotToken).not.toBe(diff.snapshotToken);

    const staged = git(repo, 'diff', '--cached', '--no-color');
    expect(staged).toContain('+L25-MOD');
    expect(staged).not.toContain('+L5-MOD');
    expect(staged).not.toContain('+L45-MOD');

    const remaining = git(repo, 'diff', '--no-color');
    expect(remaining).toContain('+L5-MOD');
    expect(remaining).toContain('+L45-MOD');
    expect(remaining).not.toContain('+L25-MOD');
  });

  it('AC3: unstages only the selected hunk', async () => {
    const repo = repoWithThreeWorktreeHunks();
    git(repo, 'add', 'f.txt');
    const diff = await snapshot(repo, 'staged');
    expect(diff.hunks).toHaveLength(3);

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'staged',
        operation: 'unstage',
        hunkIndices: [0],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.success).toBe(true);

    const staged = git(repo, 'diff', '--cached', '--no-color');
    expect(staged).not.toContain('+L5-MOD');
    expect(staged).toContain('+L25-MOD');
    expect(staged).toContain('+L45-MOD');

    // The working tree is untouched by an unstage.
    expect(readBytes(repo, 'f.txt').toString('utf8')).toContain('L5-MOD');
  });

  it('AC4: reverts only the selected hunk and does not touch the index', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'revert',
        hunkIndices: [2],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.success).toBe(true);

    const contents = readBytes(repo, 'f.txt').toString('utf8');
    expect(contents).toContain('L5-MOD');
    expect(contents).toContain('L25-MOD');
    expect(contents).not.toContain('L45-MOD');

    // Nothing was staged.
    expect(git(repo, 'diff', '--cached', '--no-color')).toBe('');
  });

  it('applies a multi-hunk selection in file order even when asked out of order', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        // Descending, with a duplicate: `git apply` requires ascending order.
        hunkIndices: [2, 0, 2],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.success).toBe(true);
    const staged = git(repo, 'diff', '--cached', '--no-color');
    expect(staged).toContain('+L5-MOD');
    expect(staged).toContain('+L45-MOD');
    expect(staged).not.toContain('+L25-MOD');
  });

  // -------------------------------------------------------------------------
  // AC9 — byte identity against an independent reassembly applied by the CLI
  // -------------------------------------------------------------------------

  describe('AC9 byte identity vs the git CLI', () => {
    interface Fixture {
      name: string;
      autocrlf: 'true' | 'false';
      before: Buffer;
      after: Buffer;
    }

    const fixtures: Fixture[] = [
      {
        name: 'CRLF line endings under core.autocrlf=true',
        autocrlf: 'true',
        before: Buffer.from(
          baseLines()
            .map((l) => `${l}\r\n`)
            .join(''),
          'utf8',
        ),
        after: Buffer.from(
          threeEdits(baseLines())
            .map((l) => `${l}\r\n`)
            .join(''),
          'utf8',
        ),
      },
      {
        name: 'no trailing newline',
        autocrlf: 'false',
        before: Buffer.from(baseLines().join('\n'), 'utf8'),
        after: Buffer.from(threeEdits(baseLines()).join('\n'), 'utf8'),
      },
      {
        name: 'non-ASCII content (accents, CJK, astral-plane emoji)',
        autocrlf: 'false',
        before: Buffer.from(
          `${baseLines()
            .map((l, i) =>
              i === 4
                ? 'café'
                : i === 24
                  ? '日本語'
                  : i === 44
                    ? '🚀 rocket'
                    : l,
            )
            .join('\n')}\n`,
          'utf8',
        ),
        after: Buffer.from(
          `${baseLines()
            .map((l, i) =>
              i === 4
                ? 'café-MOD'
                : i === 24
                  ? '日本語-MOD'
                  : i === 44
                    ? '🚀 rocket-MOD'
                    : l,
            )
            .join('\n')}\n`,
          'utf8',
        ),
      },
    ];

    it.each(fixtures)(
      'stage produces a byte-identical repository state: $name',
      async ({ autocrlf, before, after }) => {
        const build = (): string => {
          const repo = makeRepo(autocrlf);
          write(repo, 'f.txt', before);
          git(repo, 'add', 'f.txt');
          git(repo, 'commit', '-qm', 'init');
          write(repo, 'f.txt', after);
          return repo;
        };

        const underTest = build();
        const reference = build();

        const diff = await snapshot(underTest, 'worktree');
        expect(diff.patch).not.toBeNull();
        expect(diff.hunks.length).toBeGreaterThanOrEqual(2);

        const selection = [diff.hunks.length - 1];

        const result = await service.applyHunks(
          underTest,
          {
            path: 'f.txt',
            comparison: 'worktree',
            operation: 'stage',
            hunkIndices: selection,
            snapshotToken: diff.snapshotToken,
          },
          fileSystem,
        );
        expect(result.success).toBe(true);

        // The reference repo gets the same selection through a separately
        // written reassembly, handed to the CLI on stdin.
        const referencePatch = referenceReassemble(diff.patch ?? '', selection);
        execFileSync('git', ['apply', '--cached', '-'], {
          cwd: reference,
          input: referencePatch,
          env: GIT_ENV,
        });

        expect(gitDiffBytes(underTest, true)).toEqual(
          gitDiffBytes(reference, true),
        );
        expect(gitDiffBytes(underTest, false)).toEqual(
          gitDiffBytes(reference, false),
        );
        expect(readBytes(underTest, 'f.txt')).toEqual(
          readBytes(reference, 'f.txt'),
        );
      },
    );

    it('revert restores the exact pre-edit bytes under core.autocrlf=true', async () => {
      const repo = makeRepo('true');
      const before = Buffer.from(
        baseLines()
          .map((l) => `${l}\r\n`)
          .join(''),
        'utf8',
      );
      write(repo, 'f.txt', before);
      git(repo, 'add', 'f.txt');
      git(repo, 'commit', '-qm', 'init');
      write(
        repo,
        'f.txt',
        Buffer.from(
          threeEdits(baseLines())
            .map((l) => `${l}\r\n`)
            .join(''),
          'utf8',
        ),
      );

      const diff = await snapshot(repo, 'worktree');
      const all = diff.hunks.map((h) => h.index);

      const result = await service.applyHunks(
        repo,
        {
          path: 'f.txt',
          comparison: 'worktree',
          operation: 'revert',
          hunkIndices: all,
          snapshotToken: diff.snapshotToken,
        },
        fileSystem,
      );

      expect(result.success).toBe(true);
      // CRLF survives the round trip even though the patch itself is LF-space.
      expect(readBytes(repo, 'f.txt')).toEqual(before);
      // And git agrees the file is clean, which is the authoritative check:
      // `git status` may still show it stat-dirty after a rewrite.
      expect(git(repo, 'diff', '--no-color')).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Guard 1 + 2 — AC6 staleness, refused server-side, recomputed every time
  // -------------------------------------------------------------------------

  it('AC6: refuses a diff that moved between the read and the apply, and writes nothing', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');

    const beforeIndex = git(repo, 'diff', '--cached', '--no-color');
    const beforeWorktreeDiff = git(repo, 'diff', '--no-color');

    // The hazard, verbatim: the file changes after the user was shown the diff.
    const mutated = threeEdits(baseLines());
    mutated[9] = 'L10-SNEAKED-IN';
    write(repo, 'f.txt', `${mutated.join('\n')}\n`);

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [1],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result).toEqual({
      success: false,
      code: 'STALE_SNAPSHOT',
      message: expect.stringContaining('changed since'),
    });
    // A refusal must never hand back a token that could be replayed.
    expect(result.snapshotToken).toBeUndefined();

    expect(git(repo, 'diff', '--cached', '--no-color')).toBe(beforeIndex);
    expect(git(repo, 'diff', '--no-color')).not.toBe(beforeWorktreeDiff); // our edit
    expect(readBytes(repo, 'f.txt').toString('utf8')).toContain(
      'L10-SNEAKED-IN',
    );
  });

  it('AC6: refuses the shifted-offset case, which `git apply --check` alone accepts', async () => {
    // Reproduces the catastrophic shape: the same hunk content still applies
    // cleanly, just five lines further down. `git apply --check` returns 0 for
    // this. The snapshot token is what refuses it.
    const repo = makeRepo();
    write(repo, 'f.txt', `${baseLines().join('\n')}\n`);
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-qm', 'init');

    const edited = baseLines();
    edited[29] = 'L30-MOD';
    write(repo, 'f.txt', `${edited.join('\n')}\n`);

    const diff = await snapshot(repo, 'worktree');
    expect(diff.hunks).toHaveLength(1);

    // Shift the pre-image: prepend five lines to the index copy, leaving the
    // hunk's context intact but five lines lower.
    write(
      repo,
      'f.txt',
      `${['X1', 'X2', 'X3', 'X4', 'X5', ...baseLines()].join('\n')}\n`,
    );
    git(repo, 'add', 'f.txt');
    const indexBefore = git(repo, 'diff', '--cached', '--no-color');

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [0],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('STALE_SNAPSHOT');
    expect(git(repo, 'diff', '--cached', '--no-color')).toBe(indexBefore);
    expect(indexBefore).not.toContain('L30-MOD');
  });

  it('AC6: recomputes the snapshot on every call rather than caching it', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const first = await snapshot(repo, 'worktree');

    write(repo, 'f.txt', `${baseLines().join('\n')}\n`);
    const second = await snapshot(repo, 'worktree');
    expect(second.snapshotToken).not.toBe(first.snapshotToken);

    write(repo, 'f.txt', `${threeEdits(baseLines()).join('\n')}\n`);
    const third = await snapshot(repo, 'worktree');
    // Same bytes as the first read => same token. A cached token would have
    // frozen at `first` and this test would pass vacuously; the middle read
    // proves it did not.
    expect(third.snapshotToken).toBe(first.snapshotToken);
  });

  it('AC6: the token is bound to the patch bytes, not only to the two sides', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const honest = await snapshot(repo, 'worktree');

    // Hold both sides constant and change ONLY the patch text. If the digest
    // did not cover the patch, these two tokens would be equal — and a write
    // landing between the side reads and the diff read would be certified as
    // "the snapshot the user was shown".
    const seam = execGitSeam(service);
    const original = seam.execGit.bind(service);
    const spy = jest
      .spyOn(seam, 'execGit')
      .mockImplementation(async (args, cwd, options) => {
        const result = await original(args, cwd, options);
        return args[0] === 'diff'
          ? { ...result, stdout: result.stdout.replace('L25-MOD', 'L25-OTHER') }
          : result;
      });

    try {
      const tampered = await snapshot(repo, 'worktree');
      expect(tampered.original).toEqual(honest.original);
      expect(tampered.modified).toEqual(honest.modified);
      expect(tampered.originalRef).toEqual(honest.originalRef);
      expect(tampered.modifiedRef).toEqual(honest.modifiedRef);
      expect(tampered.snapshotToken).not.toBe(honest.snapshotToken);
    } finally {
      spy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // Guard 3 — AC7 atomicity
  // -------------------------------------------------------------------------

  it('AC7: restores the index when the real apply fails after --check passed', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');
    const indexBefore = git(repo, 'diff', '--cached', '--no-color');
    const treeBefore = git(repo, 'write-tree').trim();

    // Sabotage the INDEX between `--check` and the real apply — the only
    // window in which a post-check failure is reachable, and the pre-image
    // that `git apply --cached` actually reads. Staging L25 as already
    // modified removes the `-L25` line the selected hunk needs, so git
    // refuses; a shift-only sabotage would have been absorbed as an offset.
    const seam = execGitSeam(service);
    const original = seam.execGit.bind(service);
    const spy = jest
      .spyOn(seam, 'execGit')
      .mockImplementation(async (args, cwd, options) => {
        if (args[0] === 'apply' && !args.includes('--check')) {
          const sabotaged = baseLines();
          sabotaged[24] = 'L25-MOD';
          write(repo, 'sab.txt', `${sabotaged.join('\n')}\n`);
          fs.copyFileSync(path.join(repo, 'sab.txt'), path.join(repo, 'f.txt'));
          git(repo, 'add', 'f.txt');
        }
        return original(args, cwd, options);
      });

    let result;
    try {
      result = await service.applyHunks(
        repo,
        {
          path: 'f.txt',
          comparison: 'worktree',
          operation: 'stage',
          hunkIndices: [1],
          snapshotToken: diff.snapshotToken,
        },
        fileSystem,
      );
    } finally {
      spy.mockRestore();
    }

    // Asserted unconditionally: a test that only checks the rollback "if it
    // failed" passes vacuously the moment the sabotage stops working.
    expect(result.success).toBe(false);
    expect(result.code).toBe('APPLY_FAILED');
    expect(result.message).toContain('restored');
    expect(git(repo, 'write-tree').trim()).toBe(treeBefore);
    expect(git(repo, 'diff', '--cached', '--no-color')).toBe(indexBefore);
  });

  it('AC7: the pre-write offset guard restores too, so "nothing changed" is true of the FILE', async () => {
    // The only way to reach guard 2 is an external write landing between the
    // snapshot re-check and the `--check` dry run. `--check` writes nothing,
    // which is why this branch used to return without restoring — but the
    // *external* write is still there, and the reply claimed nothing had
    // changed. (TASK_2026_219; the guard-2 half of batch-8c §3.)
    const repo = makeRepo();
    write(repo, 'f.txt', `${baseLines().join('\n')}\n`);
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-qm', 'init');

    const edited = baseLines();
    edited[29] = 'L30-MOD';
    write(repo, 'f.txt', `${edited.join('\n')}\n`);

    const diff = await snapshot(repo, 'worktree');
    expect(diff.hunks).toHaveLength(1);

    const bytesTheUserSaw = readBytes(repo, 'f.txt');

    // Shift the working tree five lines down at the instant of the dry run.
    // The hunk's context is intact, so `git apply -R --check` still says yes —
    // at an offset — which is exactly the case guard 2 refuses. `revert` is
    // the operation whose pre-image is the working tree, so this is the shape
    // an external editor save actually produces.
    const seam = execGitSeam(service);
    const original = seam.execGit.bind(service);
    const spy = jest
      .spyOn(seam, 'execGit')
      .mockImplementation(async (args, cwd, options) => {
        if (args[0] === 'apply' && args.includes('--check')) {
          write(
            repo,
            'f.txt',
            `${['X1', 'X2', 'X3', 'X4', 'X5', ...edited].join('\n')}\n`,
          );
        }
        return original(args, cwd, options);
      });

    let result;
    try {
      result = await service.applyHunks(
        repo,
        {
          path: 'f.txt',
          comparison: 'worktree',
          operation: 'revert',
          hunkIndices: [0],
          snapshotToken: diff.snapshotToken,
        },
        fileSystem,
      );
    } finally {
      spy.mockRestore();
    }

    // Asserted unconditionally: if the sabotage ever stops producing an
    // offset, this must fail rather than pass vacuously.
    expect(result.success).toBe(false);
    expect(result.code).toBe('APPLY_FAILED');
    expect(result.message).toContain('restored');
    // The claim under test: the concurrent write is gone, not merely
    // un-written-to. Before the fix the file still held the five extra lines
    // while the reply said "Nothing was changed".
    expect(readBytes(repo, 'f.txt')).toEqual(bytesTheUserSaw);
    expect(git(repo, 'diff', '--cached', '--no-color')).toBe('');
  });

  it('AC7: a patch git refuses leaves the repository byte-identical', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');

    // Stage everything, so the worktree patch's pre-image no longer matches
    // the index and `--check` must refuse it.
    git(repo, 'add', 'f.txt');
    const indexBefore = git(repo, 'diff', '--cached', '--no-color');
    const bytesBefore = readBytes(repo, 'f.txt');

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [0],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.success).toBe(false);
    expect(git(repo, 'diff', '--cached', '--no-color')).toBe(indexBefore);
    expect(readBytes(repo, 'f.txt')).toEqual(bytesBefore);
  });

  // -------------------------------------------------------------------------
  // Guard 4 — AC12 operation matrix
  // -------------------------------------------------------------------------

  it.each([
    ['worktree', 'unstage'],
    ['staged', 'stage'],
    ['staged', 'revert'],
  ] as const)(
    'AC12: refuses %s + %s with INVALID_OPERATION and never spawns git apply',
    async (comparison, operation) => {
      const repo = repoWithThreeWorktreeHunks();
      git(repo, 'add', 'f.txt');
      const indexBefore = git(repo, 'diff', '--cached', '--no-color');
      const bytesBefore = readBytes(repo, 'f.txt');

      const result = await service.applyHunks(
        repo,
        {
          path: 'f.txt',
          comparison,
          operation,
          hunkIndices: [0],
          // Deliberately a token that would never match: the matrix must be
          // checked before, and independently of, the snapshot.
          snapshotToken: 'not-a-real-token',
        },
        fileSystem,
      );

      expect(result.code).toBe('INVALID_OPERATION');
      expect(result.success).toBe(false);
      expect(git(repo, 'diff', '--cached', '--no-color')).toBe(indexBefore);
      expect(readBytes(repo, 'f.txt')).toEqual(bytesBefore);
    },
  );

  it('AC12: accepts every operation the matrix does allow', async () => {
    for (const [comparison, operation] of [
      ['worktree', 'stage'],
      ['worktree', 'revert'],
      ['staged', 'unstage'],
    ] as const) {
      const repo = repoWithThreeWorktreeHunks();
      if (comparison === 'staged') git(repo, 'add', 'f.txt');
      const diff = await snapshot(repo, comparison);

      const result = await service.applyHunks(
        repo,
        {
          path: 'f.txt',
          comparison,
          operation,
          hunkIndices: [0],
          snapshotToken: diff.snapshotToken,
        },
        fileSystem,
      );

      expect(result).toMatchObject({ success: true });
    }
  });

  // -------------------------------------------------------------------------
  // Guard 5 — AC10 binary
  // -------------------------------------------------------------------------

  it('AC10: refuses a real binary file with BINARY_UNSUPPORTED and writes nothing', async () => {
    const repo = makeRepo();
    write(repo, 'blob.bin', Buffer.from([0, 1, 2, 3, 0, 255, 7, 9]));
    git(repo, 'add', 'blob.bin');
    git(repo, 'commit', '-qm', 'init');
    write(repo, 'blob.bin', Buffer.from([0, 1, 2, 3, 0, 254, 8, 10, 11]));

    const diff = await service.diffFile(
      repo,
      { path: 'blob.bin', comparison: 'worktree' },
      fileSystem,
    );
    expect(diff.modified.outcome).toBe('binary');
    expect(diff.hunks).toEqual([]);

    const bytesBefore = readBytes(repo, 'blob.bin');
    const result = await service.applyHunks(
      repo,
      {
        path: 'blob.bin',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [0],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.code).toBe('BINARY_UNSUPPORTED');
    expect(git(repo, 'diff', '--cached', '--no-color')).toBe('');
    expect(readBytes(repo, 'blob.bin')).toEqual(bytesBefore);
  });

  it('an untracked file is reported as having no changes, not as binary', async () => {
    const repo = makeRepo();
    write(repo, 'seed.txt', 'seed\n');
    git(repo, 'add', 'seed.txt');
    git(repo, 'commit', '-qm', 'init');
    write(repo, 'fresh.txt', 'brand new\n');

    const diff = await service.diffFile(
      repo,
      { path: 'fresh.txt', comparison: 'worktree' },
      fileSystem,
    );
    expect(diff.patch).toBeNull();

    const result = await service.applyHunks(
      repo,
      {
        path: 'fresh.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [0],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.code).toBe('APPLY_FAILED');
    expect(result.message).not.toMatch(/binary/i);
  });

  // -------------------------------------------------------------------------
  // Guard 6 — NFR-8 path validation on BOTH paths
  // -------------------------------------------------------------------------

  it('NFR-8: refuses path traversal in originalPath, not only in path', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const bytesBefore = readBytes(repo, 'f.txt');

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        originalPath: '../../etc/passwd',
        comparison: 'staged',
        operation: 'unstage',
        hunkIndices: [0],
        snapshotToken: 'irrelevant',
      },
      fileSystem,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('UNKNOWN');
    // The reply carries no path, no stderr, no absolute location.
    expect(result.message).not.toContain('..');
    expect(result.message).not.toContain(repo);
    expect(readBytes(repo, 'f.txt')).toEqual(bytesBefore);
  });

  it('NFR-8: validates originalPath BEFORE anything else, not merely somewhere', async () => {
    // The previous test cannot tell this guard apart from `diffFile`'s own
    // `validatePathSegment`, which would refuse the same input a few lines
    // later — removing the check here left that test green. This one pairs a
    // traversal with an operation the matrix rejects: if path validation runs
    // first (as NFR-8 requires) the answer is UNKNOWN; if it does not, the
    // matrix answers INVALID_OPERATION and the traversal is never examined.
    const repo = repoWithThreeWorktreeHunks();

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        originalPath: '../../etc/passwd',
        comparison: 'worktree',
        operation: 'unstage',
        hunkIndices: [0],
        snapshotToken: 'irrelevant',
      },
      fileSystem,
    );

    expect(result.code).toBe('UNKNOWN');
    expect(result.code).not.toBe('INVALID_OPERATION');
  });

  it('NFR-8: refuses path traversal in path', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const result = await service.applyHunks(
      repo,
      {
        path: '../escape.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [0],
        snapshotToken: 'irrelevant',
      },
      fileSystem,
    );
    expect(result.code).toBe('UNKNOWN');
  });

  it('refuses a folder that is not a git repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-nogit-'));
    createdRepos.push(dir);

    const result = await service.applyHunks(
      dir,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [0],
        snapshotToken: 'irrelevant',
      },
      fileSystem,
    );

    expect(result.code).toBe('NOT_A_REPO');
  });

  it('refuses a hunk ordinal that is not in the diff', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');
    const indexBefore = git(repo, 'diff', '--cached', '--no-color');

    const result = await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [0, 99],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    expect(result.code).toBe('APPLY_FAILED');
    expect(git(repo, 'diff', '--cached', '--no-color')).toBe(indexBefore);
  });

  // -------------------------------------------------------------------------
  // R-1 forensics
  // -------------------------------------------------------------------------

  it('R-1: logs enough to reconstruct exactly what was applied', async () => {
    const repo = repoWithThreeWorktreeHunks();
    const diff = await snapshot(repo, 'worktree');

    await service.applyHunks(
      repo,
      {
        path: 'f.txt',
        comparison: 'worktree',
        operation: 'stage',
        hunkIndices: [1],
        snapshotToken: diff.snapshotToken,
      },
      fileSystem,
    );

    const info = (logger.info as jest.Mock).mock.calls.find(([message]) =>
      String(message).includes('applyHunks applied'),
    );
    expect(info).toBeDefined();
    expect(info?.[1]).toMatchObject({
      workspaceRoot: repo,
      path: 'f.txt',
      comparison: 'worktree',
      operation: 'stage',
      hunkIndices: [1],
      snapshotToken: diff.snapshotToken,
      exitCode: 0,
      offsets: [],
    });
    expect(info?.[1].patchSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(info?.[1].nextSnapshotToken).not.toBe(diff.snapshotToken);
  });
});
