/**
 * GitWatcherService against REAL git and the REAL watch engine
 * (TASK_2026_576 RC5, Requirement 1.7).
 *
 * The workspace feed is `ElectronWorkspaceWatcher` over the in-process watch
 * host (`createInProcessWorkspaceWatchHostForker`: the same
 * `WorkspaceWatchHostCore` and `@parcel/watcher` engine the forked host runs,
 * with no bundle to build). `GitInfoService` is a stub, so every
 * `git:status-update` observed here was caused by the git-directory
 * subscription seeing the operation, and its `causes` say what it saw.
 *
 * Each case performs one real git operation in a temp repository and asserts
 * a push carrying the expected cause within 3 s: `git add`, `git commit`, a
 * nested ref created after start, a `packed-refs` rewrite, a merge creating
 * `MERGE_HEAD`, and a commit inside a linked worktree (watched through its
 * common git directory). Git runs with no global or system configuration, so
 * a developer's hooks, signing or templates cannot change the outcome.
 *
 * Nothing runs git in the repository under development: every repository is
 * created under `os.tmpdir()` and removed afterwards.
 */

import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import {
  ElectronWorkspaceWatcher,
  createInProcessWorkspaceWatchHostForker,
} from '@ptah-extension/platform-electron';
import type {
  GitChangeKind,
  GitInfoResult,
  GitStatusUpdatePayload,
  GitWorktreeInfo,
} from '@ptah-extension/shared';

import { GitWatcherService } from './git-watcher.service';

/** The acceptance bound: a push within 3 s of the operation finishing. */
const PUSH_TIMEOUT_MS = 3_000;

/** No push for this long means the previous operation's refresh has landed. */
const QUIET_MS = 1_000;

jest.setTimeout(60_000);

let gitExecutable: string | undefined;

/**
 * The git binary as an absolute path from the absolute PATH entries, so the
 * OS never searches relative or writable PATH entries at exec time (Sonar
 * typescript:S4036) — the same approach as `git-watcher.stress.harness.ts`.
 */
function resolveGitExecutable(): string {
  if (gitExecutable !== undefined) return gitExecutable;
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
      gitExecutable = candidate;
      return candidate;
    }
  }
  throw new Error(
    `git-watcher real-git spec: no ${name} on an absolute PATH entry`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Push {
  readonly causes: readonly GitChangeKind[];
  readonly at: number;
}

/** One armed `GitWatcherService` with a stub `GitInfoService` and its pushes. */
class WatchedWorkspace {
  readonly pushes: Push[] = [];
  readonly getWorktrees = jest.fn(async (): Promise<GitWorktreeInfo[]> => []);
  private readonly svc: GitWatcherService;

  constructor(
    readonly root: string,
    watcher: ElectronWorkspaceWatcher,
  ) {
    const noop = (): void => undefined;
    const logger = {
      info: noop,
      debug: noop,
      warn: noop,
      error: noop,
    } as unknown as Logger;
    const gitInfo = {
      refreshGitInfo: async (): Promise<GitInfoResult> =>
        ({ isGitRepo: true, files: [] }) as unknown as GitInfoResult,
      statusBackoffRemainingMs: (): number => 0,
      getWorktrees: this.getWorktrees,
    } as unknown as GitInfoService;
    this.svc = new GitWatcherService(gitInfo, logger, watcher);
  }

  start(): void {
    this.svc.start(this.root, (type, payload) => {
      if (type !== 'git:status-update') return;
      this.pushes.push({
        causes: (payload as GitStatusUpdatePayload).causes ?? [],
        at: Date.now(),
      });
    });
  }

  stop(): void {
    this.svc.stop();
  }

  /** Waits for a push after `since` whose causes include `cause`. */
  async waitForCause(
    cause: GitChangeKind,
    since: number,
    timeoutMs = PUSH_TIMEOUT_MS,
  ): Promise<Push | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.pushes
        .slice(since)
        .find((push) => push.causes.includes(cause));
      if (hit || Date.now() > deadline) return hit;
      await sleep(25);
    }
  }

  /** Waits until no push has arrived for {@link QUIET_MS}. */
  async settle(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let seen = this.pushes.length;
    let quietSince = Date.now();
    while (Date.now() - quietSince < QUIET_MS) {
      if (Date.now() > deadline) {
        throw new Error('the watcher never went quiet');
      }
      await sleep(50);
      if (this.pushes.length !== seen) {
        seen = this.pushes.length;
        quietSince = Date.now();
      }
    }
  }

  /**
   * Readiness barrier: the host subscribes natively after `watch` returns.
   * Touch a `refs`-classified file until a push shows the subscription live.
   */
  async waitUntilLive(fetchHeadPath: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const since = this.pushes.length;
      fs.writeFileSync(fetchHeadPath, `probe ${attempt}\n`);
      if (await this.waitForCause('refs', since, 1_000)) {
        await this.settle();
        return;
      }
    }
    throw new Error(
      `the git-directory subscription for ${this.root} never went live`,
    );
  }
}

describe('GitWatcherService — real git, real watch engine (RC5)', () => {
  let parent: string;
  let repo: string;
  let gitDir: string;
  let emptyConfig: string;
  let watcher: ElectronWorkspaceWatcher;
  let main: WatchedWorkspace;
  let linked: WatchedWorkspace | undefined;

  function git(args: readonly string[], cwd = repo): string {
    return execFileSync(resolveGitExecutable(), args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  }

  /** Runs `operation`, then asserts a push carrying `cause` within 3 s. */
  async function expectPush(
    target: WatchedWorkspace,
    cause: GitChangeKind,
    operation: () => void,
  ): Promise<void> {
    await target.settle();
    const since = target.pushes.length;
    operation();
    const push = await target.waitForCause(cause, since);
    if (push === undefined) {
      throw new Error(
        `no git:status-update with cause '${cause}' within ${PUSH_TIMEOUT_MS} ms; pushes since: ${JSON.stringify(
          target.pushes.slice(since).map((p) => p.causes),
        )}`,
      );
    }
    expect(push.causes).toContain(cause);
  }

  beforeAll(async () => {
    parent = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-576-gw-')),
    );
    emptyConfig = path.join(parent, 'empty.gitconfig');
    fs.writeFileSync(emptyConfig, '');
    repo = path.join(parent, 'repo');
    fs.mkdirSync(repo);
    git(['init', '-q']);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(['config', 'user.email', 'real-git@ptah.test']);
    git(['config', 'user.name', 'ptah-real-git']);
    git(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'seed\n');
    git(['add', 'README.md']);
    git(['commit', '-q', '-m', 'seed']);
    gitDir = path.join(repo, '.git');

    watcher = new ElectronWorkspaceWatcher({
      host: createInProcessWorkspaceWatchHostForker(),
    });
    main = new WatchedWorkspace(repo, watcher);
    main.start();
    await main.waitUntilLive(path.join(gitDir, 'FETCH_HEAD'));
  });

  afterAll(async () => {
    linked?.stop();
    main?.stop();
    watcher?.dispose();
    // Let the in-process engine release its native handles before removal.
    await sleep(200);
    try {
      fs.rmSync(parent, { recursive: true, force: true });
    } catch {
      // degradation-audit: optional-capability - temp-directory cleanup; a
      // leftover directory under os.tmpdir() affects no result.
    }
  });

  it('git add pushes an index change', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    await expectPush(main, 'index', () => git(['add', 'a.txt']));
  });

  it('git commit pushes a refs change', async () => {
    await expectPush(main, 'refs', () => git(['commit', '-q', '-m', 'add a']));
  });

  it('a nested ref created after start pushes a refs change', async () => {
    expect(fs.existsSync(path.join(gitDir, 'refs', 'heads', 'feature'))).toBe(
      false,
    );
    await expectPush(main, 'refs', () => git(['branch', 'feature/deep/x']));
  });

  it('repeated HEAD writes (lock-and-rename each time) each push a head change', async () => {
    // `symbolic-ref` writes HEAD only, through `HEAD.lock` and a rename over
    // the old file; the second write proves the watch survives the first.
    await expectPush(main, 'head', () =>
      git(['symbolic-ref', 'HEAD', 'refs/heads/feature/deep/x']),
    );
    await expectPush(main, 'head', () =>
      git(['symbolic-ref', 'HEAD', 'refs/heads/main']),
    );
    expect(git(['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/main');
  });

  it('a branch switch pushes a head change', async () => {
    try {
      await expectPush(main, 'head', () =>
        git(['checkout', '-q', 'feature/deep/x']),
      );
      expect(git(['symbolic-ref', 'HEAD']).trim()).toBe(
        'refs/heads/feature/deep/x',
      );
      await expectPush(main, 'head', () => git(['checkout', '-q', 'main']));
    } finally {
      git(['checkout', '-q', 'main']);
    }
    expect(git(['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/main');
  });

  it('a remote-tracking ref created after start pushes a refs change', async () => {
    expect(fs.existsSync(path.join(gitDir, 'refs', 'remotes'))).toBe(false);
    await expectPush(main, 'refs', () =>
      git(['update-ref', 'refs/remotes/origin/x', 'HEAD']),
    );
    expect(
      fs.existsSync(path.join(gitDir, 'refs', 'remotes', 'origin', 'x')),
    ).toBe(true);
  });

  it('a packed-refs rewrite pushes a refs change', async () => {
    await expectPush(main, 'refs', () => git(['pack-refs', '--all']));
    expect(fs.existsSync(path.join(gitDir, 'packed-refs'))).toBe(true);
  });

  it('a merge creating MERGE_HEAD pushes a head change', async () => {
    git(['checkout', '-q', '-b', 'side']);
    fs.writeFileSync(path.join(repo, 'side.txt'), 'side\n');
    git(['add', 'side.txt']);
    git(['commit', '-q', '-m', 'side']);
    git(['checkout', '-q', 'main']);

    await expectPush(main, 'head', () =>
      git(['merge', '--no-ff', '--no-commit', '-q', 'side']),
    );
    expect(fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))).toBe(true);

    git(['merge', '--abort']);
  });

  it('a commit inside a linked worktree pushes a refs change, and adding it re-lists worktrees', async () => {
    const worktree = path.join(parent, 'wt');
    await main.settle();
    const listingsBefore = main.getWorktrees.mock.calls.length;
    git(['worktree', 'add', '-q', '-b', 'wt-branch', worktree]);
    // `worktrees/wt/` is another worktree's administration for `main`.
    const deadline = Date.now() + PUSH_TIMEOUT_MS;
    while (
      main.getWorktrees.mock.calls.length === listingsBefore &&
      Date.now() < deadline
    ) {
      await sleep(25);
    }
    expect(main.getWorktrees.mock.calls.length).toBeGreaterThan(listingsBefore);

    // The worktree's own gitdir is `<common>/worktrees/wt`, reached through
    // its `commondir`; one subscription on the common dir covers both.
    const ownGitDir = path.join(gitDir, 'worktrees', 'wt');
    expect(
      fs.readFileSync(path.join(ownGitDir, 'commondir'), 'utf8').trim(),
    ).toBe('../..');
    linked = new WatchedWorkspace(worktree, watcher);
    linked.start();
    await linked.waitUntilLive(path.join(ownGitDir, 'FETCH_HEAD'));

    fs.writeFileSync(path.join(worktree, 'wt.txt'), 'wt\n');
    await expectPush(linked, 'index', () => git(['add', 'wt.txt'], worktree));
    await expectPush(linked, 'refs', () =>
      git(['commit', '-q', '-m', 'in worktree'], worktree),
    );
  });
});
