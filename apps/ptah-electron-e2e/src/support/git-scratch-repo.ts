import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Real on-disk git repositories for Electron e2e specs.
 *
 * `TASK_2026_218` requires that `git:applyHunks` be exercised against a real
 * repository through the real RPC path — a mocked `git:diffFile` response
 * proves nothing about whether a click reaches `git apply`. These helpers
 * create a throwaway repo, drive git through `execFileSync`, and read the
 * index back so a spec can assert on `git diff --cached` rather than on a
 * fixture's own echo.
 *
 * The repo is passed to the app as the positional workspace argument
 * (see `apps/ptah-electron/src/activation/bootstrap.ts` — the first non-flag
 * argv becomes the workspace root), so the running app resolves it through
 * the real `ElectronWorkspaceProvider`.
 */

/**
 * Git invocation flags that make a scratch repo behave identically regardless
 * of the developer's or runner's global git config. Signing and hooks are off
 * because a commit prompt would hang the spec; `core.autocrlf=false` keeps the
 * bytes the spec writes identical to the bytes git diffs on Windows.
 */
const GIT_CONFIG_ARGS = [
  '-c',
  'user.name=Ptah E2E',
  '-c',
  'user.email=e2e@ptah.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'init.defaultBranch=main',
];

export interface ScratchRepo {
  /** Absolute path to the repository working tree. */
  readonly root: string;
  /** Run a git command in the repo and return trimmed stdout. */
  git(...args: string[]): string;
  /** Write a file relative to the repo root, creating parent directories. */
  write(relativePath: string, content: string): void;
  /** Read the staged diff (`git diff --cached`). */
  stagedDiff(): string;
  /** Read the unstaged diff (`git diff`). */
  worktreeDiff(): string;
  /** Remove the repo from disk. Safe to call more than once. */
  cleanup(): void;
}

export function createScratchRepo(): ScratchRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-git-'));

  const git = (...args: string[]): string =>
    execFileSync('git', [...GIT_CONFIG_ARGS, ...args], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();

  const write = (relativePath: string, content: string): void => {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  };

  git('init');

  // Persist the line-ending rule into the repo, because `-c` only reaches the
  // processes THIS file spawns. The app spawns its own — `GitInfoService`
  // shells out to `git apply -R -` for a hunk revert — and those inherit the
  // machine's global config instead. On a Windows box with the common
  // `core.autocrlf=true`, that one write converts the whole file to CRLF while
  // `write()` above put LF on disk and `worktreeDiff()` reads back under
  // `autocrlf=false`: every line reads as changed and three hunks collapse
  // into one 120-line hunk. The bug is not in the revert, which restores
  // exactly the right text; it is that only half the processes touching this
  // repo were hearing the setting. Writing it to `.git/config` is what makes
  // the promise in the comment above true for the app as well as the spec.
  git('config', 'core.autocrlf', 'false');

  return {
    root,
    git,
    write,
    stagedDiff: () => git('diff', '--cached'),
    worktreeDiff: () => git('diff'),
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // The app's recursive fs.watch can hold a handle on Windows past
        // process exit; a leaked tmp dir is not worth failing a spec over.
      }
    },
  };
}

/**
 * A file whose three modified regions are far enough apart that git emits them
 * as three separate hunks under the default three lines of context. This is
 * what makes "that hunk and only that hunk" an assertion rather than a
 * tautology — staging one region must leave the other two unstaged.
 */
export const THREE_HUNK_FILE = 'src/calc.ts';

const TOTAL_LINES = 120;
const HUNK_LINES = [10, 55, 100] as const;

function buildFile(changed: ReadonlySet<number>): string {
  const lines: string[] = [];
  for (let i = 1; i <= TOTAL_LINES; i++) {
    lines.push(
      changed.has(i)
        ? `export const value${i} = ${i * 1000}; // CHANGED`
        : `export const value${i} = ${i};`,
    );
  }
  return lines.join('\n') + '\n';
}

/** The committed baseline — no region changed. */
export const BASELINE_CONTENT = buildFile(new Set());

/** The working-tree state — all three regions changed. */
export const MODIFIED_CONTENT = buildFile(new Set(HUNK_LINES));

/** The line numbers the three hunks sit on, in file order. */
export const HUNK_LINE_NUMBERS: readonly number[] = HUNK_LINES;

/**
 * Create a repo holding one committed file with three unstaged hunks, plus a
 * `.gitignore`-free clean tree so the source-control panel lists exactly one
 * changed file.
 */
export function createThreeHunkRepo(): ScratchRepo {
  const repo = createScratchRepo();
  repo.write(THREE_HUNK_FILE, BASELINE_CONTENT);
  repo.git('add', '.');
  repo.git('commit', '-m', 'baseline');
  repo.write(THREE_HUNK_FILE, MODIFIED_CONTENT);
  return repo;
}
