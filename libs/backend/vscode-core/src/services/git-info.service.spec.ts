/**
 * GitInfoService — unit specs for the 6 added git-query methods.
 *
 * Coverage matrix:
 *   getBranches   — parses for-each-ref output into BranchRef[]
 *   getBranches   — returns empty result when exitCode !== 0
 *   checkout      — returns { dirty: true } when status --porcelain is non-empty and force=false
 *   checkout      — proceeds (does not short-circuit) when force=true
 *   checkout      — returns { success: false, error: 'Invalid branch name' } for '..' injection
 *   stashList     — parses tab-separated stash list output into StashEntry[]
 *   stashList     — returns empty entries when output is blank
 *   getRemotes    — deduplicates fetch+push lines for the same remote name
 *   getRemotes    — returns empty remotes when exitCode !== 0
 *   getLastCommit — parses all 7 fixed-position fields; converts Unix seconds to ms
 *   getLastCommit — returns empty result when output is blank
 *   getLastCommit — returns 0 for time when ct field is absent
 *
 * TASK_2026_173 additions:
 *   readBlob      — content / empty-but-tracked / binary-by-NUL / absent
 *   readBlob      — classifies failures by exit code (not-a-repo, no-commits)
 *   readBlob      — never leaks stderr or an absolute path to the client
 *   readBlob      — rejects path traversal before spawning git
 *   diffFile      — every row of the side-resolution table, both comparisons
 *   diffFile      — staged rename reads the original side at origPath (N3)
 *   diffFile      — snapshotToken is stable per snapshot, differs per content
 *   parseFileStatus — origPath from the type-2 post-tab segment (N3)
 *
 * TASK_2026_204 / TASK_2026_205 additions:
 *   readBlob      — a gitlink classifies as `submodule`, not `unknown`
 *   diffFile      — a directory read classifies as `is-a-directory`
 *
 * TASK_2026_437 additions (single-flight read runs):
 *   refreshGitInfo — a burst of invalidate+refresh during one run costs one trailing run
 *   getGitInfo     — joins a current run; one workspace's refresh never queues another's
 *   cachedRead     — a value from a run invalidated mid-flight is not written back
 *   singleFlight   — rejection and timeout settle waiters and still start the trailing run
 *
 * TASK_2026_437 additions (C11 git process supervision):
 *   refreshGitInfo — every git child of the run gets background OS priority
 *   getGitInfo     — a user-driven read keeps normal priority
 *   getGitInfo     — line counts are read for the first 200 untracked files only
 *   readUntrackedNumstat — a file over 1 MiB reports unknown line counts
 *
 * TASK_2026_576 Batch 25 additions (change-set delegates):
 *   readChangeSetNumstat — tracked, deleted, binary, untracked, unchanged paths;
 *                          empty tree on an unborn branch; failures give null
 *                          counts; unsafe paths never reach git; argv chunking
 *   readHeadText         — HEAD sha read capped at the per-side limit;
 *                          too-large; unborn branch is absent; traversal refused
 *
 * TASK_2026_576 Batch 45 additions (commit streaming):
 *   commit          — onOutput streams; cancelOperation / caller signal stop it;
 *                     the operation id is freed on settle; a running id is refused
 *   readStagedPatch — patch flags; none / failed; 48 KiB cap stops git
 *
 * TASK_2026_616 Batch G additions (git status timeout):
 *   getGitInfo     — the status and both numstat reads carry GIT_STATUS_TIMEOUT_MS
 *   getGitInfo     — a non-repository is classified from the status exit, no probe
 *   refreshGitInfo — a timeout backs off background refreshes for 30 s; a user
 *                    read runs anyway and a success closes the window
 *   statusBackoffRemainingMs — the open window as a countdown (0 when closed);
 *                    the service itself creates no follow-up timer
 *
 * `crossSpawn` is mocked at the module boundary so no git binary is required.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 */

import 'reflect-metadata';
import * as os from 'os';
import * as path from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';

// ---------------------------------------------------------------------------
// Mock cross-spawn so we control stdout/stderr/exitCode per test.
// ---------------------------------------------------------------------------
const mockSpawn = jest.fn();
jest.mock('cross-spawn', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSpawn(...args),
}));

// `os.setPriority` is mocked so the background-priority specs observe the call
// and never reprioritise a real process (TASK_2026_437 C11).
const mockSetPriority = jest.fn();
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  setPriority: (...args: unknown[]) => mockSetPriority(...args),
}));

import {
  GitInfoService,
  isMutatingGitCommand,
  setGitInfoClockForTests,
  resetGitInfoClockForTests,
  GIT_STATUS_TIMEOUT_BACKOFF_MS,
} from './git-info.service';
import {
  GitCancelledError,
  GitOutputLimitError,
  GitTimeoutError,
  GIT_STATUS_TIMEOUT_MS,
} from '../utils/exec-git';
import { STAGED_PATCH_TRUNCATED_NOTE } from './git/git-staged-patch.reader';
import { GIT_DIFF_MAX_SIDE_BYTES } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Minimal logger double
// ---------------------------------------------------------------------------
function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helper: make crossSpawn return a fake child-process-like EventEmitter.
// The implementation uses a callback-based "close" event pattern internally.
// ---------------------------------------------------------------------------
function makeSpawnResult(opts: {
  stdout: string;
  stderr?: string;
  exitCode: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};

  const proc = {
    stdout: {
      on: jest.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => cb(Buffer.from(opts.stdout)), 0);
        }
      }),
    },
    stderr: {
      on: jest.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => cb(Buffer.from(opts.stderr ?? '')), 0);
        }
      }),
    },
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      if (event === 'close') {
        setTimeout(() => cb(opts.exitCode), 10);
      }
    }),
  };

  return proc;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GitInfoService — new git methods (TASK_2026_111)', () => {
  let service: GitInfoService;
  const WS = '/fake/workspace';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GitInfoService(makeLogger() as never);
  });

  // ==========================================================================
  // getBranches
  // ==========================================================================

  describe('worktree paths', () => {
    it('requests NUL-delimited porcelain and preserves the returned path', async () => {
      const repositoryPath = '/home/zoë/projects/研究\nrepository ';
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({
          stdout: [
            `worktree ${repositoryPath}`,
            'HEAD abcdef1234567890',
            'branch refs/heads/main',
            '',
            '',
          ].join('\0'),
          exitCode: 0,
        }),
      );

      const [worktree] = await service.getWorktrees(WS);

      expect(mockSpawn.mock.calls[0][1]).toEqual([
        'worktree',
        'list',
        '--porcelain',
        '-z',
      ]);
      expect(worktree.path).toBe(repositoryPath);
      expect(worktree.isMain).toBe(true);
    });

    it('uses the shared nested default for UI/backend creation', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );
      const branch = 'feature/ui-default';

      const result = await service.addWorktree(WS, { branch });

      expect(result.success).toBe(true);
      expect(result.worktreePath).toContain(
        `${path.sep}.claude-worktrees${path.sep}`,
      );
      expect((mockSpawn.mock.calls[0][1] as string[]).at(-1)).toBe(branch);
    });

    it('rejects an escaping relative custom path before spawning git', async () => {
      const result = await service.addWorktree(WS, {
        branch: 'feature/x',
        path: '../workspace-evil',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Relative worktree path must stay/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('retains an explicit absolute custom path', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );
      const explicit = path.resolve('/worktrees/ui-explicit');

      const result = await service.addWorktree(WS, {
        branch: 'feature/x',
        path: explicit,
      });

      expect(result).toEqual({ success: true, worktreePath: explicit });
      expect(mockSpawn.mock.calls[0][1]).toEqual([
        'worktree',
        'add',
        '--end-of-options',
        explicit,
        'feature/x',
      ]);
    });

    it('reports the minimum git version when worktree add rejects --end-of-options', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({
          stdout: '',
          stderr:
            "error: unknown option `end-of-options'\nusage: git worktree add [<options>] <path> [<commit-ish>]\n",
          exitCode: 129,
        }),
      );

      const result = await service.addWorktree(WS, {
        branch: 'feature/x',
        path: path.resolve('/worktrees/old-git'),
      });

      expect(result).toEqual({
        success: false,
        error: 'Git 2.24 or later is required for this action.',
      });
    });
  });
  describe('getBranches()', () => {
    /**
     * One `for-each-ref` line, in the field order of
     * `GitInfoService.BRANCH_REF_FORMAT`:
     *   refname, refname:short, HEAD, objectname:short, upstream:short,
     *   upstream:track, creatordate:unix
     */
    function refLine(f: {
      refname: string;
      short: string;
      head?: '*' | ' ';
      hash?: string;
      upstream?: string;
      track?: string;
      date?: string;
    }): string {
      return [
        f.refname,
        f.short,
        f.head ?? ' ',
        f.hash ?? 'abc1234',
        f.upstream ?? '',
        f.track ?? '',
        f.date ?? '1700000000',
      ].join('\t');
    }

    /** The argv handed to the Nth `crossSpawn` call. */
    function argvOf(callIndex: number): string[] {
      return mockSpawn.mock.calls[callIndex][1] as string[];
    }

    it('parses for-each-ref output into local BranchRef[]', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({
          stdout:
            refLine({
              refname: 'refs/heads/main',
              short: 'main',
              head: '*',
              upstream: 'origin/main',
              track: '[ahead 2]',
            }) + '\n',
          exitCode: 0,
        }),
      );

      const result = await service.getBranches(WS, false);

      expect(result.current).toBe('main');
      expect(result.local).toHaveLength(1);
      expect(result.local[0].name).toBe('main');
      expect(result.local[0].isCurrent).toBe(true);
      expect(result.local[0].upstream).toBe('origin/main');
      expect(result.local[0].ahead).toBe(2);
      expect(result.local[0].behind).toBe(0);
      expect(result.local[0].lastCommitTime).toBe(1700000000000);
    });

    // The defect this task fixed: the format string carried `%09%09` where it
    // meant `%(ahead-behind:upstream)`, so the field was always empty and every
    // upstream-tracking branch fell into a per-branch `git rev-list` spawn,
    // sequentially. 20 of those spawns measured 4.1 s against 0.29 s for the
    // single `for-each-ref` that replaced them.
    it('spawns exactly ONE git process for a repo full of tracking branches', async () => {
      const lines = Array.from({ length: 25 }, (_, i) =>
        refLine({
          refname: `refs/heads/feat-${i}`,
          short: `feat-${i}`,
          head: i === 0 ? '*' : ' ',
          upstream: `origin/feat-${i}`,
          track: '[ahead 1, behind 3]',
        }),
      );
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({ stdout: lines.join('\n') + '\n', exitCode: 0 }),
      );

      const result = await service.getBranches(WS, false);

      expect(result.local).toHaveLength(25);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const argv = argvOf(0);
      expect(argv[0]).toBe('for-each-ref');
      expect(argv).toContain('refs/heads/');
      expect(argv).not.toContain('refs/remotes/');
      expect(argv.join(' ')).not.toContain('rev-list');
    });

    it('never asks for %(ahead-behind:upstream), which is fatal for untracked refs', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );

      await service.getBranches(WS, true);

      const format = argvOf(0).find((a) => a.startsWith('--format='));
      expect(format).toBeDefined();
      expect(format).not.toContain('ahead-behind');
      expect(format).toContain('%(upstream:track)');
    });

    // `%(upstream:track)` is empty for BOTH "in sync" and "no upstream at all",
    // which is why the last row exists: git emits nothing in either case and
    // the parser must not read that as a missing field.
    it.each([
      ['origin/main', '[ahead 3, behind 2]', 3, 2],
      ['origin/main', '[ahead 3]', 3, 0],
      ['origin/main', '[behind 2]', 0, 2],
      ['origin/main', '[gone]', 0, 0],
      ['origin/main', '', 0, 0],
      ['', '', 0, 0],
    ])(
      'maps upstream %p + track %p to ahead=%i behind=%i',
      async (upstream, track, ahead, behind) => {
        mockSpawn.mockImplementation(() =>
          makeSpawnResult({
            stdout:
              refLine({
                refname: 'refs/heads/main',
                short: 'main',
                head: '*',
                upstream,
                track,
              }) + '\n',
            exitCode: 0,
          }),
        );

        const result = await service.getBranches(WS, false);

        expect(result.local[0].ahead).toBe(ahead);
        expect(result.local[0].behind).toBe(behind);
        // Empty upstream is reported as absent, not as an empty string.
        expect(result.local[0].upstream).toBe(upstream || undefined);
      },
    );

    it('returns empty result when for-each-ref exits non-zero', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({ stdout: '', exitCode: 128, stderr: 'not a repo' }),
      );

      const result = await service.getBranches(WS, false);

      expect(result.local).toEqual([]);
      expect(result.remote).toEqual([]);
    });

    it('includes remote branches when includeRemote=true, from the SAME invocation', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({
          stdout:
            [
              refLine({
                refname: 'refs/heads/main',
                short: 'main',
                head: '*',
                upstream: 'origin/main',
                track: '[ahead 1]',
              }),
              refLine({
                refname: 'refs/remotes/origin/HEAD',
                short: 'origin/HEAD',
              }),
              refLine({
                refname: 'refs/remotes/origin/main',
                short: 'origin/main',
                hash: 'def5678',
              }),
            ].join('\n') + '\n',
          exitCode: 0,
        }),
      );

      const result = await service.getBranches(WS, true);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(argvOf(0)).toContain('refs/remotes/');
      expect(result.local).toHaveLength(1);
      // `origin/HEAD` is a symref onto the remote default, not a branch.
      expect(result.remote).toHaveLength(1);
      expect(result.remote[0].name).toBe('origin/main');
      expect(result.remote[0].isRemote).toBe(true);
      expect(result.remote[0].remote).toBe('origin');
    });

    it('tells a local branch named origin/foo from the remote ref of the same short name', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({
          stdout:
            [
              refLine({
                refname: 'refs/heads/origin/foo',
                short: 'origin/foo',
              }),
              refLine({
                refname: 'refs/remotes/origin/foo',
                short: 'origin/foo',
              }),
            ].join('\n') + '\n',
          exitCode: 0,
        }),
      );

      const result = await service.getBranches(WS, true);

      expect(result.local.map((b) => b.name)).toEqual(['origin/foo']);
      expect(result.local[0].isRemote).toBe(false);
      expect(result.remote.map((b) => b.name)).toEqual(['origin/foo']);
    });

    it('falls back to symbolic-ref exactly once when no ref carries the HEAD marker', async () => {
      // Unborn branch: `for-each-ref` lists nothing, so nothing is marked `*`.
      mockSpawn.mockImplementation((_cmd: unknown, args: string[]) =>
        args[0] === 'symbolic-ref'
          ? makeSpawnResult({ stdout: 'main\n', exitCode: 0 })
          : makeSpawnResult({ stdout: '', exitCode: 0 }),
      );

      const result = await service.getBranches(WS, false);

      expect(result.current).toBe('main');
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(argvOf(1)[0]).toBe('symbolic-ref');
    });

    it('leaves current empty on a detached HEAD without failing', async () => {
      mockSpawn.mockImplementation((_cmd: unknown, args: string[]) =>
        args[0] === 'symbolic-ref'
          ? makeSpawnResult({ stdout: '', exitCode: 128 })
          : makeSpawnResult({
              stdout:
                refLine({ refname: 'refs/heads/main', short: 'main' }) + '\n',
              exitCode: 0,
            }),
      );

      const result = await service.getBranches(WS, false);

      expect(result.current).toBe('');
      expect(result.local[0].isCurrent).toBe(false);
    });
  });

  // ==========================================================================
  // Cache-invalidation classification (TASK_2026_343 follow-up)
  //
  // `execGit` derives invalidation from the argv, so this table IS the
  // contract: a verb classified as a read serves a stale branch list until the
  // next watcher event. The default is "mutating", so the mutating rows below
  // include verbs this service does not spawn today — that is the point.
  // ==========================================================================

  describe('isMutatingGitCommand()', () => {
    it.each([
      // Every read this service actually performs.
      [['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']],
      [['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', 'a']],
      [['status', '--porcelain', '--', 'a.ts']],
      // Leading `-c k=v` pairs are skipped before the verb is read.
      [['-c', 'core.quotepath=off', 'status']],
      [['-c', 'a.b=1', '-c', 'c.d=2', 'diff', '--', 'a.ts']],
      [['-c', 'x.y=z', 'remote', '-v']],
      [['for-each-ref', '--format=x', 'refs/heads/']],
      [['symbolic-ref', '--short', 'HEAD']],
      [['stash', 'list', '--format=x']],
      [['stash', 'show']],
      [['worktree', 'list', '--porcelain', '-z']],
      [['tag', '--sort=-creatordate', '--format=x']],
      [['remote', '-v']],
      [['remote']],
      [['log', '-1', '--format=x', 'HEAD']],
      [['show', 'HEAD:src/a.ts']],
      [['diff', '--cached', '-U3', '--', 'a.ts']],
      [['rev-parse', '--is-inside-work-tree']],
      // Read-only plumbing with no writing form.
      [['rev-list', '--count', 'HEAD']],
      [['cat-file', '-p', 'HEAD']],
      [['ls-files']],
      [['ls-tree', 'HEAD']],
      [['merge-base', 'a', 'b']],
    ])('classifies %j as a read', (args: string[]) => {
      expect(isMutatingGitCommand(args)).toBe(false);
    });

    it.each([
      // Writes this service performs.
      [['add', '--', 'a.ts']],
      [['reset', 'HEAD', '--', 'a.ts']],
      [['checkout', '--', 'a.ts']],
      [['checkout', 'main']],
      [['clean', '-f', '--', 'a.ts']],
      [['commit', '-m', 'msg']],
      [['push']],
      [['apply', '--cached', '--verbose', '-']],
      [['apply', '--check', '--verbose', '-']],
      [['write-tree']],
      [['read-tree', 'abc123']],
      [['worktree', 'add', '/p', 'br']],
      [['worktree', 'remove', '/p']],
      [['stash', 'push']],
      [['stash', 'pop']],
      // Verbs this service does NOT spawn today. They must still classify as
      // mutations so a method added later inherits invalidation.
      [['branch', '-D', 'old']],
      [['branch', 'new-branch']],
      [['fetch', '--all', '--prune']],
      [['tag', 'v1.0.0']],
      [['cherry-pick', 'abc123']],
      [['revert', 'abc123']],
      [['am', '--3way']],
      [['merge', 'main']],
      [['rebase', 'main']],
      [['pull', '--rebase']],
      [['switch', 'main']],
      [['restore', '--staged', 'a.ts']],
      [['remote', 'add', 'origin', 'url']],
      [['remote', 'set-url', 'origin', 'url']],
      // Repoints HEAD — exactly what the branch cache holds.
      [['symbolic-ref', 'HEAD', 'refs/heads/main']],
      // An unknown verb is a mutation by default.
      [['some-future-plumbing', '--flag']],
      // `-c` pairs never hide a writing verb, and a bare `-c` is no verb.
      [['-c', 'core.hooksPath=/x', 'commit', '-m', 'msg']],
      [['-c', 'a=1', '-c', 'b=2', 'stash', 'pop']],
      [['-c', 'x.y=z', 'remote', 'add', 'origin', 'url']],
      [['-c', 'x.y=z']],
      [['restore', '--staged', '--worktree', '--source=HEAD', '--', 'a', 'b']],
    ])('classifies %j as a mutation', (args: string[]) => {
      expect(isMutatingGitCommand(args)).toBe(true);
    });
  });

  // ==========================================================================
  // Read cache + in-flight coalescing (TASK_2026_343)
  // ==========================================================================

  describe('read cache', () => {
    const BRANCH_LINE =
      'refs/heads/main\tmain\t*\tabc1234\torigin/main\t\t1700000000\n';

    beforeEach(() => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({ stdout: BRANCH_LINE, exitCode: 0 }),
      );
    });

    it('coalesces two concurrent identical getBranches calls into one invocation', async () => {
      const [a, b] = await Promise.all([
        service.getBranches(WS, false),
        service.getBranches(WS, false),
      ]);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
      expect(a.current).toBe('main');
    });

    it('serves a settled result without spawning git again', async () => {
      await service.getBranches(WS, false);
      const again = await service.getBranches(WS, false);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(again.current).toBe('main');
    });

    it('does not share an entry between includeRemote variants', async () => {
      await service.getBranches(WS, false);
      await service.getBranches(WS, true);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('invalidateReadCache() makes the next call spawn git again', async () => {
      await service.getBranches(WS, false);
      service.invalidateReadCache(WS);
      await service.getBranches(WS, false);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('invalidating one workspace leaves another workspace cached', async () => {
      const OTHER = '/fake/other';
      await service.getBranches(WS, false);
      await service.getBranches(OTHER, false);
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      service.invalidateReadCache(OTHER);
      await service.getBranches(WS, false);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('a computation in flight when invalidation fires does not populate the cache', async () => {
      const inFlight = service.getBranches(WS, false);
      service.invalidateReadCache(WS);
      await inFlight;

      await service.getBranches(WS, false);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('a mutating git command invalidates the cache automatically', async () => {
      await service.getBranches(WS, false);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // force=true is a single `switch --discard-changes` spawn, which
      // `isMutatingGitCommand` recognises.
      await service.checkout(WS, 'other', false, true);
      await service.getBranches(WS, false);

      const forEachRefCalls = mockSpawn.mock.calls.filter(
        ([, args]: [unknown, string[]]) => args[0] === 'for-each-ref',
      );
      expect(forEachRefCalls).toHaveLength(2);
    });

    it('a read command does not invalidate the entry it just populated', async () => {
      await service.getTags(WS);
      await service.getTags(WS);

      const tagCalls = mockSpawn.mock.calls.filter(
        ([, args]: [unknown, string[]]) => args[0] === 'tag',
      );
      expect(tagCalls).toHaveLength(1);
    });

    // `getGitInfo` is the working-tree status walk and the git watcher's own
    // source of truth. A settled entry would make the watcher push status it
    // had already superseded, so it gets coalescing only.
    it('getGitInfo coalesces concurrently but is never served from a settled entry', async () => {
      mockSpawn.mockImplementation((_cmd: unknown, args: string[]) =>
        args[0] === 'rev-parse'
          ? makeSpawnResult({
              stdout: args.includes('--git-path')
                ? '.git/MERGE_HEAD\n.git/CHERRY_PICK_HEAD\n.git/rebase-merge\n.git/rebase-apply\n'
                : 'true\n',
              exitCode: 0,
            })
          : makeSpawnResult({ stdout: '# branch.head main\0', exitCode: 0 }),
      );

      await Promise.all([service.getGitInfo(WS), service.getGitInfo(WS)]);
      // status + staged/worktree numstat + the operation markers'
      // `rev-parse --git-path`, once — not twice.
      expect(mockSpawn).toHaveBeenCalledTimes(4);

      await service.getGitInfo(WS);

      // A fresh run; the marker paths are already resolved, so one spawn fewer.
      expect(mockSpawn).toHaveBeenCalledTimes(7);
    });
  });

  // ==========================================================================
  // checkout
  // ==========================================================================

  describe('checkout()', () => {
    it('reports dirty + conflictingPaths when git refuses the switch (no status pre-check)', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({
          stdout: '',
          stderr:
            'error: Your local changes to the following files would be overwritten by checkout:\n' +
            '\tsrc/index.ts\n' +
            'Please commit your changes or stash them before you switch branches.\n' +
            'Aborting\n',
          exitCode: 1,
        }),
      );

      const result = await service.checkout(WS, 'feat/x', false, false);

      expect(result).toMatchObject({
        success: false,
        dirty: true,
        conflictingPaths: ['src/index.ts'],
      });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn.mock.calls[0][1]).toEqual([
        'switch',
        '--end-of-options',
        'feat/x',
      ]);
    });

    it('runs switch --discard-changes when force=true', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );

      const result = await service.checkout(WS, 'feat/x', false, true);

      expect(result).toEqual({ success: true });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn.mock.calls[0][1]).toEqual([
        'switch',
        '--discard-changes',
        '--end-of-options',
        'feat/x',
      ]);
    });

    it('reports an untracked blocker of switch --discard-changes as dirty with a move-or-delete message', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({
          stdout: '',
          stderr:
            "error: Untracked working tree file 'docs/it''s.txt' would be overwritten by merge.\n",
          exitCode: 128,
        }),
      );

      const result = await service.checkout(WS, 'feat/x', false, true);

      expect(result).toEqual({
        success: false,
        dirty: true,
        conflictingPaths: ["docs/it''s.txt"],
        error:
          "Untracked files block this switch: docs/it''s.txt. Move or delete them, then try again.",
      });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('reports the untracked list refusal of a plain switch as dirty, keeping git text', async () => {
      const stderr =
        'error: The following untracked working tree files would be overwritten by checkout:\n' +
        '\tu1.txt\n' +
        '\tu2.txt\n' +
        'Please move or remove them before you switch branches.\n' +
        'Aborting\n';
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', stderr, exitCode: 1 }),
      );

      const result = await service.checkout(WS, 'feat/x', false, false);

      expect(result).toEqual({
        success: false,
        dirty: true,
        conflictingPaths: ['u1.txt', 'u2.txt'],
        error: stderr.trim(),
      });
    });

    it.each([
      ["git: 'switch' is not a git command. See 'git --help'.\n", 1],
      [
        "error: unknown option `end-of-options'\nusage: git switch [<options>] [<branch>]\n",
        129,
      ],
    ])(
      'reports the minimum git version when git is too old (%#)',
      async (stderr, exitCode) => {
        mockSpawn.mockImplementationOnce(() =>
          makeSpawnResult({ stdout: '', stderr, exitCode }),
        );

        const result = await service.checkout(WS, 'feat/x', false, false);

        expect(result).toEqual({
          success: false,
          error: 'Git 2.24 or later is required for this action.',
        });
      },
    );

    it('returns { success: false, error: "Invalid branch name" } for path traversal attempt', async () => {
      const result = await service.checkout(WS, '../evil', false, false);

      expect(result).toEqual({ success: false, error: 'Invalid branch name' });
      // No git calls should be made for invalid branch
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns { success: true } when git switch succeeds', async () => {
      mockSpawn.mockImplementation(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );

      const result = await service.checkout(WS, 'main', false, false);

      expect(result).toEqual({ success: true });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('refuses track when refs/remotes/<branch> does not resolve, without switching', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', exitCode: 1 }),
      );

      const result = await service.checkout(WS, 'origin/x', false, false, {
        track: true,
      });

      expect(result).toEqual({
        success: false,
        error: "'origin/x' is not a remote-tracking branch",
      });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn.mock.calls[0][1]).toEqual([
        'rev-parse',
        '--verify',
        '--quiet',
        'refs/remotes/origin/x',
      ]);
    });

    it('refuses track for a branch name without a remote prefix, running no git', async () => {
      const result = await service.checkout(WS, 'main', false, false, {
        track: true,
      });

      expect(result).toEqual({
        success: false,
        error: "'main' is not a remote-tracking branch",
      });
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // stashList
  // ==========================================================================

  describe('stashList()', () => {
    it('parses tab-separated stash list output into StashEntry[]', async () => {
      const stashOutput = [
        'stash@{0}\t1111111111111111111111111111111111111111\t1700000100\tWIP on main: fix\ttests',
        'stash@{1}\t2222222222222222222222222222222222222222\t1700000050\tWIP on feat/x: add feature',
        '',
      ].join('\n');

      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: stashOutput, exitCode: 0 }),
      );

      const result = await service.stashList(WS);

      expect(result.count).toBe(2);
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0];
      expect(first.index).toBe(0);
      expect(first.hash).toBe('1111111111111111111111111111111111111111');
      expect(first.message).toBe('WIP on main: fix\ttests');

      const second = result.entries[1];
      expect(second.index).toBe(1);
      expect(second.hash).toBe('2222222222222222222222222222222222222222');
      expect(second.message).toBe('WIP on feat/x: add feature');
    });

    it('returns empty entries when output is blank', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );

      const result = await service.stashList(WS);

      expect(result.count).toBe(0);
      expect(result.entries).toEqual([]);
    });

    it('returns empty entries when exitCode is non-zero', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', exitCode: 128, stderr: 'not a repo' }),
      );

      const result = await service.stashList(WS);

      expect(result.count).toBe(0);
      expect(result.entries).toEqual([]);
    });
  });

  // ==========================================================================
  // getRemotes
  // ==========================================================================

  describe('getRemotes()', () => {
    it('deduplicates fetch+push lines for the same remote name', async () => {
      const remoteOutput = [
        'origin\thttps://github.com/user/repo.git (fetch)',
        'origin\thttps://github.com/user/repo.git (push)',
        'upstream\thttps://github.com/org/repo.git (fetch)',
        'upstream\thttps://github.com/org/repo.git (push)',
        '',
      ].join('\n');

      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: remoteOutput, exitCode: 0 }),
      );

      const result = await service.getRemotes(WS);

      expect(result.remotes).toHaveLength(2);

      const origin = result.remotes.find((r) => r.name === 'origin');
      expect(origin).toBeDefined();
      expect(origin?.fetchUrl).toBe('https://github.com/user/repo.git');
      expect(origin?.pushUrl).toBe('https://github.com/user/repo.git');

      const upstream = result.remotes.find((r) => r.name === 'upstream');
      expect(upstream).toBeDefined();
      expect(upstream?.fetchUrl).toBe('https://github.com/org/repo.git');
    });

    it('returns empty remotes when exitCode is non-zero', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', exitCode: 128, stderr: 'not a repo' }),
      );

      const result = await service.getRemotes(WS);

      expect(result.remotes).toEqual([]);
    });

    it('returns empty remotes when output has no lines', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '\n', exitCode: 0 }),
      );

      const result = await service.getRemotes(WS);

      expect(result.remotes).toEqual([]);
    });
  });

  // ==========================================================================
  // getLastCommit
  // ==========================================================================

  describe('getLastCommit()', () => {
    it('parses all 7 fixed-position fields and converts Unix seconds to milliseconds', async () => {
      // Format: %H\n%h\n%s\n%an\n%ae\n%ct\n%b
      const logOutput = [
        'abc123def456abc123def456abc123def456abc123de',
        'abc123d',
        'feat: add branch picker',
        'Jane Doe',
        'jane@example.com',
        '1700000000',
        'Detailed body text here.',
      ].join('\n');

      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: logOutput, exitCode: 0 }),
      );

      const result = await service.getLastCommit(WS, 'HEAD');

      expect(result.hash).toBe('abc123def456abc123def456abc123def456abc123de');
      expect(result.shortHash).toBe('abc123d');
      expect(result.subject).toBe('feat: add branch picker');
      expect(result.author).toBe('Jane Doe');
      expect(result.authorEmail).toBe('jane@example.com');
      // 1700000000 Unix seconds → 1700000000000 ms
      expect(result.time).toBe(1700000000 * 1000);
      expect(result.body).toBe('Detailed body text here.');
    });

    it('returns empty result when output is blank (no commits)', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );

      const result = await service.getLastCommit(WS);

      expect(result.hash).toBe('');
      expect(result.shortHash).toBe('');
      expect(result.subject).toBe('');
      expect(result.time).toBe(0);
    });

    it('returns 0 for time when ct field is absent', async () => {
      const logOutput = [
        'abc123def456abc123def456abc123def456abc123de',
        'abc123d',
        'Initial commit',
        'Dev',
        'dev@example.com',
        // ct line intentionally empty
        '',
        '',
      ].join('\n');

      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: logOutput, exitCode: 0 }),
      );

      const result = await service.getLastCommit(WS);

      expect(result.time).toBe(0);
    });

    it('uses provided ref instead of HEAD when specified', async () => {
      const logOutput = [
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef00',
        'deadbeef',
        'chore: bump version',
        'CI Bot',
        'ci@example.com',
        '1699900000',
        '',
      ].join('\n');

      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: logOutput, exitCode: 0 }),
      );

      await service.getLastCommit(WS, 'v1.2.3');

      // Verify the ref was passed to git log
      const args: string[] = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toBe('v1.2.3');
    });
  });
});

// ===========================================================================
// TASK_2026_173 — readBlob / diffFile / origPath
// ===========================================================================

/** Queue spawn responses in call order and record the argv of each call. */
function queueSpawn(
  responses: Array<{ stdout?: string; stderr?: string; exitCode: number }>,
): { calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
    calls.push(args);
    const response = responses[Math.min(index, responses.length - 1)];
    index++;
    return makeSpawnResult({
      stdout: response.stdout ?? '',
      stderr: response.stderr,
      exitCode: response.exitCode,
    });
  });
  return { calls };
}

const posix = (p: string): string => p.replace(/\\/g, '/');

/** Minimal `WorktreeFileReader` over an in-memory file map. */
function makeFileReader(files: Record<string, string>) {
  return {
    exists: jest.fn(async (p: string) =>
      Object.prototype.hasOwnProperty.call(files, posix(p)),
    ),
    readFileBytes: jest.fn(async (p: string) => {
      const content = files[posix(p)];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return new Uint8Array(Buffer.from(content, 'utf8'));
    }),
  };
}

describe('GitInfoService.readBlob()', () => {
  let service: GitInfoService;
  const WS = '/fake/workspace';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GitInfoService(makeLogger() as never);
  });

  it('returns content and spawns nothing extra on the happy path', async () => {
    const { calls } = queueSpawn([{ stdout: 'hello\n', exitCode: 0 }]);

    const result = await service.readBlob(WS, 'HEAD', 'src/a.ts');

    expect(result).toEqual({ outcome: 'content', content: 'hello\n' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['show', 'HEAD:src/a.ts']);
  });

  it('reads the index side with an empty revision prefix', async () => {
    const { calls } = queueSpawn([{ stdout: 'staged\n', exitCode: 0 }]);

    await service.readBlob(WS, '', 'src/a.ts');

    expect(calls[0]).toEqual(['show', ':src/a.ts']);
  });

  it('classifies content containing a NUL byte as binary with a byte length', async () => {
    const NUL = String.fromCharCode(0);
    queueSpawn([
      { stdout: `PNG${NUL}${String.fromCharCode(26)}`, exitCode: 0 },
    ]);

    const result = await service.readBlob(WS, 'HEAD', 'logo.png');

    expect(result).toEqual({ outcome: 'binary', byteLength: 5 });
  });

  it('reports a genuinely empty tracked file as empty content, not as absent', async () => {
    queueSpawn([{ stdout: '', exitCode: 0 }]);

    const result = await service.readBlob(WS, 'HEAD', 'empty.ts');

    expect(result).toEqual({ outcome: 'content', content: '' });
  });

  it('classifies a path missing at the revision as absent, via exit code only', async () => {
    const { calls } = queueSpawn([
      { exitCode: 128, stderr: 'fatal: path does not exist\n' },
      { exitCode: 1 },
    ]);

    const result = await service.readBlob(WS, 'HEAD', 'src/new.ts');

    expect(result).toEqual({ outcome: 'absent' });
    expect(calls[1]).toEqual([
      'rev-parse',
      '--verify',
      '--quiet',
      'HEAD:src/new.ts',
    ]);
  });

  it('classifies a broken repository as error/not-a-repo, never as absent', async () => {
    queueSpawn([
      { exitCode: 128 }, // show
      { exitCode: 128 }, // rev-parse <spec>
      { exitCode: 128 }, // rev-parse --is-inside-work-tree
    ]);

    const result = await service.readBlob(WS, 'HEAD', 'src/a.ts');

    expect(result.outcome).toBe('error');
    if (result.outcome === 'error') {
      expect(result.code).toBe('not-a-repo');
    }
  });

  it('classifies an unborn HEAD as error/no-commits', async () => {
    queueSpawn([
      { exitCode: 128 }, // show
      { exitCode: 128 }, // rev-parse <spec>
      { stdout: 'true\n', exitCode: 0 }, // --is-inside-work-tree
      { exitCode: 1 }, // rev-parse --verify --quiet HEAD
    ]);

    const result = await service.readBlob(WS, 'HEAD', 'src/a.ts');

    expect(result.outcome).toBe('error');
    if (result.outcome === 'error') {
      expect(result.code).toBe('no-commits');
    }
  });

  it('classifies a gitlink as error/submodule rather than the generic unknown', async () => {
    // The exact pair the ladder already had: `git show` refuses (128) because
    // the entry is a commit reference, while `rev-parse --verify` on the same
    // spec succeeds (0) because that commit is a perfectly good object.
    const { calls } = queueSpawn([
      { exitCode: 128, stderr: 'fatal: bad object HEAD:vendor/sub\n' },
      { stdout: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\n', exitCode: 0 },
    ]);

    const result = await service.readBlob(WS, 'HEAD', 'vendor/sub');

    expect(result.outcome).toBe('error');
    if (result.outcome === 'error') {
      expect(result.code).toBe('submodule');
    }
    // No pre-flight probes: the signal was already in hand, so classifying it
    // must not cost the extra spawns the `unknown` path pays.
    expect(calls).toHaveLength(2);
  });

  it('still falls through to the pre-flight probes when show failed for a reason other than 128', async () => {
    queueSpawn([
      { exitCode: 129 }, // show
      { stdout: 'sha\n', exitCode: 0 }, // rev-parse <spec> resolves
      { exitCode: 128 }, // rev-parse --is-inside-work-tree
    ]);

    const result = await service.readBlob(WS, 'HEAD', 'src/a.ts');

    expect(result.outcome).toBe('error');
    if (result.outcome === 'error') {
      expect(result.code).toBe('not-a-repo');
    }
  });

  it('never leaks stderr or an absolute path into the client-facing message', async () => {
    queueSpawn([
      { exitCode: 128, stderr: 'fatal: /fake/workspace/.git is corrupt\n' },
      { exitCode: 128 },
      { exitCode: 128 },
    ]);

    const result = await service.readBlob(WS, 'HEAD', 'src/a.ts');

    expect(result.outcome).toBe('error');
    if (result.outcome === 'error') {
      expect(result.message).not.toContain(WS);
      expect(result.message).not.toContain('corrupt');
      expect(result.message).toContain('src/a.ts');
    }
  });

  it('rejects a traversing path before spawning git', async () => {
    const { calls } = queueSpawn([{ exitCode: 0 }]);

    await expect(
      service.readBlob(WS, 'HEAD', '../../etc/passwd'),
    ).rejects.toThrow(/traversal/i);
    expect(calls).toHaveLength(0);
  });
});

describe('GitInfoService.diffFile()', () => {
  let service: GitInfoService;
  const WS = '/fake/workspace';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GitInfoService(makeLogger() as never);
  });

  // --- staged comparison ---------------------------------------------------

  it('staged modification: commit(HEAD) -> index', async () => {
    const { calls } = queueSpawn([
      { stdout: 'abc123\n', exitCode: 0 }, // rev-parse --verify --quiet HEAD
      { stdout: 'old\n', exitCode: 0 }, // show HEAD:path
      { stdout: 'new\n', exitCode: 0 }, // show :path
    ]);

    const result = await service.diffFile(
      WS,
      { path: 'src/a.ts', comparison: 'staged' },
      makeFileReader({}),
    );

    expect(result.originalRef).toEqual({ kind: 'commit', sha: 'abc123' });
    expect(result.modifiedRef).toEqual({ kind: 'index' });
    expect(result.original).toEqual({ outcome: 'content', content: 'old\n' });
    expect(result.modified).toEqual({ outcome: 'content', content: 'new\n' });
    expect(calls[1]).toEqual(['show', 'HEAD:src/a.ts']);
    expect(calls[2]).toEqual(['show', ':src/a.ts']);
  });

  it('staged addition: absent -> index', async () => {
    queueSpawn([
      { stdout: 'abc123\n', exitCode: 0 }, // HEAD sha
      { exitCode: 128 }, // show HEAD:path
      { exitCode: 1 }, // rev-parse <spec> => absent
      { stdout: 'brand new\n', exitCode: 0 }, // show :path
    ]);

    const result = await service.diffFile(
      WS,
      { path: 'src/new.ts', comparison: 'staged' },
      makeFileReader({}),
    );

    expect(result.original).toEqual({ outcome: 'absent' });
    expect(result.originalRef).toEqual({ kind: 'absent' });
    expect(result.modifiedRef).toEqual({ kind: 'index' });
  });

  it('staged deletion: commit(HEAD) -> absent', async () => {
    queueSpawn([
      { stdout: 'abc123\n', exitCode: 0 },
      { stdout: 'gone\n', exitCode: 0 }, // show HEAD:path
      { exitCode: 128 }, // show :path
      { exitCode: 1 }, // rev-parse <spec> => absent
    ]);

    const result = await service.diffFile(
      WS,
      { path: 'src/gone.ts', comparison: 'staged' },
      makeFileReader({}),
    );

    expect(result.originalRef).toEqual({ kind: 'commit', sha: 'abc123' });
    expect(result.modified).toEqual({ outcome: 'absent' });
    expect(result.modifiedRef).toEqual({ kind: 'absent' });
  });

  it('staged rename: reads the original side at the pre-rename path (N3)', async () => {
    const { calls } = queueSpawn([
      { stdout: 'abc123\n', exitCode: 0 },
      { stdout: 'old\n', exitCode: 0 },
      { stdout: 'new\n', exitCode: 0 },
    ]);

    const result = await service.diffFile(
      WS,
      {
        path: 'src/new-name.ts',
        comparison: 'staged',
        originalPath: 'src/old-name.ts',
      },
      makeFileReader({}),
    );

    expect(calls[1]).toEqual(['show', 'HEAD:src/old-name.ts']);
    expect(calls[2]).toEqual(['show', ':src/new-name.ts']);
    expect(result.originalPath).toBe('src/old-name.ts');
    expect(result.path).toBe('src/new-name.ts');
  });

  it('repository with zero commits: absent -> index, HEAD never read', async () => {
    const { calls } = queueSpawn([
      { exitCode: 1 }, // rev-parse --verify --quiet HEAD => unborn
      { stdout: 'first\n', exitCode: 0 }, // show :path
      { stdout: '', exitCode: 0 }, // diff --cached (patch, TASK_2026_173 D2)
    ]);

    const result = await service.diffFile(
      WS,
      { path: 'src/a.ts', comparison: 'staged' },
      makeFileReader({}),
    );

    expect(result.original).toEqual({ outcome: 'absent' });
    expect(result.originalRef).toEqual({ kind: 'absent' });
    expect(result.modifiedRef).toEqual({ kind: 'index' });
    // rev-parse + show + the patch read. The count is asserted so an extra
    // spawn cannot creep onto the read path unnoticed; the substantive claim
    // is the next line — an unborn HEAD is never dereferenced.
    expect(calls).toHaveLength(3);
    expect(calls.some((argv) => argv.includes('HEAD:src/a.ts'))).toBe(false);
  });

  // --- worktree comparison -------------------------------------------------

  it('unstaged modification: index -> worktree', async () => {
    const { calls } = queueSpawn([{ stdout: 'indexed\n', exitCode: 0 }]);
    const reader = makeFileReader({
      '/fake/workspace/src/a.ts': 'working\n',
    });

    const result = await service.diffFile(
      WS,
      { path: 'src/a.ts', comparison: 'worktree' },
      reader,
    );

    expect(calls[0]).toEqual(['show', ':src/a.ts']);
    expect(result.originalRef).toEqual({ kind: 'index' });
    expect(result.modifiedRef).toEqual({ kind: 'worktree' });
    expect(result.modified).toEqual({
      outcome: 'content',
      content: 'working\n',
    });
  });

  it('untracked file: absent -> worktree', async () => {
    queueSpawn([
      { exitCode: 128 }, // show :path
      { exitCode: 1 }, // rev-parse <spec> => absent
    ]);
    const reader = makeFileReader({ '/fake/workspace/src/new.ts': 'brand\n' });

    const result = await service.diffFile(
      WS,
      { path: 'src/new.ts', comparison: 'worktree' },
      reader,
    );

    expect(result.original).toEqual({ outcome: 'absent' });
    expect(result.originalRef).toEqual({ kind: 'absent' });
    expect(result.modifiedRef).toEqual({ kind: 'worktree' });
  });

  it('worktree deletion: index -> absent, and does not throw (A4)', async () => {
    queueSpawn([{ stdout: 'pre-deletion\n', exitCode: 0 }]);
    const reader = makeFileReader({});

    const result = await service.diffFile(
      WS,
      { path: 'src/gone.ts', comparison: 'worktree' },
      reader,
    );

    expect(result.original).toEqual({
      outcome: 'content',
      content: 'pre-deletion\n',
    });
    expect(result.originalRef).toEqual({ kind: 'index' });
    expect(result.modified).toEqual({ outcome: 'absent' });
    expect(result.modifiedRef).toEqual({ kind: 'absent' });
    expect(reader.readFileBytes).not.toHaveBeenCalled();
  });

  // The UI no longer routes folders here, but retain the boundary guard for
  // stale clients and direct RPC callers. Node answers `EISDIR`, while the VS
  // Code file-system port answers `FileIsADirectory`.
  it.each([['EISDIR'], ['FileIsADirectory']])(
    'classifies a directory read (%s) as error/is-a-directory',
    async (errnoCode) => {
      queueSpawn([
        { exitCode: 128 }, // show :path
        { exitCode: 1 }, // rev-parse <spec> => absent from the index
      ]);
      const reader = {
        exists: jest.fn(async () => true),
        readFileBytes: jest.fn(async () => {
          throw Object.assign(new Error('illegal operation on a directory'), {
            code: errnoCode,
          });
        }),
      };

      const result = await service.diffFile(
        WS,
        { path: 'src/some-dir', comparison: 'worktree' },
        reader,
      );

      expect(result.original).toEqual({ outcome: 'absent' });
      expect(result.modified.outcome).toBe('error');
      if (result.modified.outcome === 'error') {
        expect(result.modified.code).toBe('is-a-directory');
        expect(result.modified.message).not.toContain(WS);
      }
    },
  );

  it('detects a binary worktree file by its NUL bytes', async () => {
    queueSpawn([{ exitCode: 128 }, { exitCode: 1 }]);
    const reader = makeFileReader({
      '/fake/workspace/logo.png': `PNG${String.fromCharCode(0)}!`,
    });

    const result = await service.diffFile(
      WS,
      { path: 'logo.png', comparison: 'worktree' },
      reader,
    );

    expect(result.modified).toEqual({ outcome: 'binary', byteLength: 5 });
  });

  // --- snapshot token ------------------------------------------------------

  it('produces a stable token for identical input and a different one otherwise', async () => {
    const reader = makeFileReader({ '/fake/workspace/src/a.ts': 'working\n' });

    queueSpawn([{ stdout: 'indexed\n', exitCode: 0 }]);
    const first = await service.diffFile(
      WS,
      { path: 'src/a.ts', comparison: 'worktree' },
      reader,
    );

    queueSpawn([{ stdout: 'indexed\n', exitCode: 0 }]);
    const second = await service.diffFile(
      WS,
      { path: 'src/a.ts', comparison: 'worktree' },
      reader,
    );

    queueSpawn([{ stdout: 'CHANGED\n', exitCode: 0 }]);
    const third = await service.diffFile(
      WS,
      { path: 'src/a.ts', comparison: 'worktree' },
      reader,
    );

    expect(first.snapshotToken).toBe(second.snapshotToken);
    expect(third.snapshotToken).not.toBe(first.snapshotToken);
    expect(first.snapshotToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a traversing path before spawning git', async () => {
    const { calls } = queueSpawn([{ exitCode: 0 }]);

    await expect(
      service.diffFile(
        WS,
        { path: '../outside.ts', comparison: 'worktree' },
        makeFileReader({}),
      ),
    ).rejects.toThrow(/traversal/i);
    expect(calls).toHaveLength(0);
  });
});

describe('GitInfoService.getGitInfo() — -z status parsing, origPath (N3)', () => {
  let service: GitInfoService;
  const WS = '/fake/workspace';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GitInfoService(makeLogger() as never);
  });

  it('populates origPath from the NUL field after a type-2 rename record', async () => {
    const status = [
      '# branch.head main',
      '2 R. N... 100644 100644 100644 abc123 def456 R100 src/new-name.ts',
      'src/old-name.ts',
      '',
    ].join('\0');

    // The status run doubles as the repository probe (TASK_2026_616 G.2):
    // it is the first spawn, and the queued answers start there.
    queueSpawn([{ stdout: status, exitCode: 0 }]);

    const info = await service.getGitInfo(WS);

    expect(info.files).toHaveLength(1);
    expect(info.files[0]).toEqual({
      path: 'src/new-name.ts',
      status: 'R',
      staged: true,
      origPath: 'src/old-name.ts',
    });
  });

  it('leaves origPath undefined for ordinary type-1 entries', async () => {
    const status = [
      '# branch.head main',
      '1 .M N... 100644 100644 100644 abc123 def456 src/a.ts',
      '',
    ].join('\0');

    queueSpawn([{ stdout: status, exitCode: 0 }]);

    const info = await service.getGitInfo(WS);

    expect(info.files[0].origPath).toBeUndefined();
  });

  it('requests and parses every untracked file instead of collapsed directories', async () => {
    const status = [
      '# branch.head main',
      '? .github/workflows/ci.yml',
      '? libs/new-lib/src/index.ts',
      '',
    ].join('\0');

    queueSpawn([{ stdout: status, exitCode: 0 }]);

    const info = await service.getGitInfo(WS);

    expect(mockSpawn.mock.calls[0][1]).toEqual([
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--untracked-files=all',
    ]);
    expect(info.files).toEqual([
      {
        path: '.github/workflows/ci.yml',
        status: '??',
        staged: false,
        additions: null,
        deletions: null,
      },
      {
        path: 'libs/new-lib/src/index.ts',
        status: '??',
        staged: false,
        additions: null,
        deletions: null,
      },
    ]);
  });

  it('keeps quote, backslash and edge-space paths verbatim and never lists ignored records', async () => {
    const status = [
      '# branch.head main',
      '1 .M N... 100644 100644 100644 abc123 def456 a"b.txt',
      '1 .M N... 100644 100644 100644 abc123 def456 a\\b.txt',
      '1 .M N... 100644 100644 100644 abc123 def456  lead and trail ',
      '! build/out.js',
      '',
    ].join('\0');
    queueSpawn([{ stdout: status, exitCode: 0 }]);
    const info = await service.getGitInfo(WS);

    expect(info.files.map((file) => file.path)).toEqual([
      'a"b.txt',
      'a\\b.txt',
      ' lead and trail ',
    ]);
  });

  it('warns once per workspace about unparseable records and keeps the rest', async () => {
    const logger = makeLogger();
    service = new GitInfoService(logger as never);
    const status = ['# branch.head main', 'garbage', '? new.txt', ''].join(
      '\0',
    );
    const run = () => {
      queueSpawn([
        { stdout: status, exitCode: 0 },
        { stdout: '', exitCode: 0 }, // both numstat reads
      ]);
      return service.getGitInfo(WS);
    };

    const first = await run();
    await run();

    expect(first.files.map((file) => file.path)).toEqual(['new.txt']);
    const warnings = logger.warn.mock.calls.filter(([message]) =>
      String(message).includes('unparseable'),
    );
    expect(warnings).toHaveLength(1);
  });
});

describe('GitInfoService.discardChanges() — -z classification (RC4)', () => {
  const WS = '/fake/workspace';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restores a staged rename named by its new path from HEAD, both sides', async () => {
    const service = new GitInfoService(makeLogger() as never);
    const { calls } = queueSpawn([
      // Pathspec-limited status: the rename reads as a staged add + edit.
      {
        stdout: '1 AM N... 000000 100644 100644 0000000 abc123 new name.txt\0',
        exitCode: 0,
      },
      // Unfiltered tracked-only status reveals the rename pair.
      {
        stdout:
          '2 RM N... 100644 100644 100644 abc123 abc123 R100 new name.txt\0old name.txt\0',
        exitCode: 0,
      },
      { stdout: '', exitCode: 0 },
    ]);

    const result = await service.discardChanges(WS, ['new name.txt']);

    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      [
        'status',
        '--porcelain=v2',
        '-z',
        '--untracked-files=all',
        '--',
        'new name.txt',
      ],
      ['status', '--porcelain=v2', '-z', '--untracked-files=no'],
      [
        'restore',
        '--staged',
        '--worktree',
        '--source=HEAD',
        '--',
        'old name.txt',
        'new name.txt',
      ],
    ]);
  });

  it('checks out tracked paths and cleans untracked ones without trimming them', async () => {
    const service = new GitInfoService(makeLogger() as never);
    const { calls } = queueSpawn([
      {
        stdout: [
          '1 .M N... 100644 100644 100644 abc123 def456  spaced ',
          '? new file.txt ',
          '! ignored.log',
          '',
        ].join('\0'),
        exitCode: 0,
      },
      { stdout: '', exitCode: 0 },
    ]);

    const result = await service.discardChanges(WS, [
      ' spaced ',
      'new file.txt ',
      'ignored.log',
    ]);

    expect(result).toEqual({ success: true });
    expect(calls.slice(1)).toEqual([
      ['checkout', '--', ' spaced '],
      ['clean', '-f', '--', 'new file.txt '],
    ]);
  });

  it('fails without touching files when the status read fails', async () => {
    const service = new GitInfoService(makeLogger() as never);
    const { calls } = queueSpawn([
      { stdout: '', stderr: 'fatal: bad things\n', exitCode: 128 },
    ]);

    const result = await service.discardChanges(WS, ['a.txt']);

    // Typed and sanitized: git's raw stderr never reaches the client.
    expect(result).toEqual({
      success: false,
      code: 'GIT_ERROR',
      error: 'Could not read file status; nothing was discarded.',
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    [
      'GIT_ERROR',
      'fatal: unable to read tree\n',
      'Could not read file status; nothing was discarded.',
    ],
    [
      'LOCKED',
      "fatal: Unable to create '/fake/workspace/.git/index.lock': File exists.\n",
      'Another git process is using this repository.',
    ],
  ])(
    'fails with %s and runs no write when the rename lookup read fails',
    async (code, stderr, error) => {
      const service = new GitInfoService(makeLogger() as never);
      const { calls } = queueSpawn([
        {
          stdout: '1 AM N... 000000 100644 100644 0000000 abc123 new.txt\0',
          exitCode: 0,
        },
        { stdout: '', stderr, exitCode: 128 },
      ]);

      const result = await service.discardChanges(WS, ['new.txt']);

      expect(result).toEqual({ success: false, code, error });
      // Both status reads, and no checkout/restore/clean after them.
      expect(calls.map((args) => args[0])).toEqual(['status', 'status']);
    },
  );
});

/**
 * The `getGitInfo` failure log (TASK_2026_342, live smoke 2026-08-29).
 *
 * The line read `[ERROR] [GitInfoService] getGitInfo failed` with nothing after
 * it — no folder, no reason. `Logger.error`'s console transport renders only
 * `context.error` (the slot for a real `Error` instance) and `context.metadata`,
 * so the `{ workspacePath, error }` object this passed as context was dropped
 * whole, and a `git status` timeout was indistinguishable from a spawn failure
 * after the fact. Everything the reader needs is now in the message itself.
 */
describe('GitInfoService.getGitInfo() — failure logging', () => {
  const WS = 'D:/projects/property-hub';

  it('names the workspace and the reason in the message, not in dropped context', async () => {
    const logger = makeLogger();
    const service = new GitInfoService(logger as never);

    mockSpawn.mockImplementation(() => {
      // `git status` — the pipeline's first and only pre-flight read
      // (TASK_2026_616 G.2) — never starts. This is the shape `execGit`
      // rejects with.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          if (event === 'error') {
            setTimeout(() => cb(new Error('spawn git ENOENT')), 0);
          }
        }),
      };
    });

    const info = await service.getGitInfo(WS);

    // Degraded, not thrown — the watcher still gets a payload.
    expect(info.isGitRepo).toBe(true);
    expect(info.files).toEqual([]);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, error] = logger.error.mock.calls[0];
    expect(message).toContain(WS);
    expect(message).toContain('spawn git ENOENT');
    // A real Error in the second slot is the only thing the console transport
    // renders there; the old plain-object cast rendered as nothing.
    expect(error).toBeInstanceOf(Error);
  });
});

// ===========================================================================
// Spawner threading — TASK_2026_383 Batch 11.3.
//
// The service reaches `exec-git` through exactly two private seams, so an
// injected `IProcessSpawner` has to reach every git invocation without any
// call site opting in. These specs pin that: with a spawner, `crossSpawn` is
// never called; without one, nothing about the inline path changes.
// ===========================================================================
describe('GitInfoService — IProcessSpawner threading', () => {
  const WS = '/fake/workspace';

  /** A `SpawnedProcessHandle` double that emits `stdout` then closes. */
  function makeHandle(stdout: string, exitCode = 0) {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      stdin: { on: jest.fn(), end: jest.fn(), write: jest.fn() },
      stdout: {
        on: jest.fn((event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') setTimeout(() => cb(Buffer.from(stdout)), 0);
        }),
      },
      stderr: { on: jest.fn() },
      whenSpawned: Promise.resolve(1234),
      pid: 1234,
      killed: false,
      kill: jest.fn(),
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        (listeners[event] ??= []).push(cb);
        if (event === 'close') setTimeout(() => cb(exitCode), 10);
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes a read through the spawner instead of cross-spawn', async () => {
    const spawnProcess = jest.fn(() => makeHandle('true\n'));
    const service = new GitInfoService(
      makeLogger() as never,
      {
        spawnProcess,
      } as never,
    );

    await service.isGitRepo(WS);

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('routes the buffer seam through the spawner too', async () => {
    const spawnProcess = jest.fn(() => makeHandle('file contents\n'));
    const service = new GitInfoService(
      makeLogger() as never,
      {
        spawnProcess,
      } as never,
    );

    await service.readBlob(WS, 'HEAD', 'src/a.ts');

    expect(spawnProcess).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('keeps the inline path when no spawner is supplied', async () => {
    mockSpawn.mockImplementation(() =>
      makeSpawnResult({ stdout: 'true\n', exitCode: 0 }),
    );
    const service = new GitInfoService(makeLogger() as never);

    await service.isGitRepo(WS);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Single-flight with one trailing rerun — TASK_2026_437 C4 (INV-3, AC-3 P1).
//
// The git watcher used to call `invalidateReadCache` then `getGitInfo` per
// file-system event, and invalidation deleted the in-flight entry, so every
// event started its own `git status` beside the ones still running. These
// specs pin the replacement: one run per key, one queued trailing run for
// every caller that arrived after an invalidation, nothing stale written back,
// and no caller stranded when a run rejects or times out.
// ===========================================================================
describe('GitInfoService — single-flight read runs (TASK_2026_437)', () => {
  const WS = '/fake/workspace';

  /** Let queued microtasks (fake child closes, promise chains) drain. */
  async function drain(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  }

  /**
   * A spawner double that counts live children of one held git verb.
   *
   * Every other child emits its stdout and closes on the next microtask. A
   * held child stays alive until the test calls `release()`, which is what
   * lets a spec invalidate "during one run" deterministically.
   */
  function makeCountingSpawner(heldVerb: string) {
    const pending: Array<() => void> = [];
    const state = { spawns: 0, live: 0, maxLive: 0 };

    const spawnProcess = jest.fn((opts: { args: string[] }) => {
      const verb = opts.args[0];
      const held = verb === heldVerb;
      let stdout = '';
      if (verb === 'rev-parse') stdout = 'true\n';
      if (held) {
        state.spawns++;
        state.live++;
        state.maxLive = Math.max(state.maxLive, state.live);
        const name = `run${state.spawns}`;
        stdout =
          verb === 'status'
            ? `# branch.head ${name}\0`
            : `refs/heads/${name}\t${name}\t*\tabc1234\t\t\t1700000000\n`;
      }

      const dataListeners: Array<(chunk: Buffer) => void> = [];
      const closeListeners: Array<(code: number) => void> = [];
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        if (held) state.live--;
        for (const listener of dataListeners) listener(Buffer.from(stdout));
        for (const listener of closeListeners) listener(0);
      };
      if (held) pending.push(close);
      else queueMicrotask(close);

      return {
        stdin: { on: jest.fn(), end: jest.fn(), write: jest.fn() },
        stdout: {
          on: jest.fn((event: string, cb: (chunk: Buffer) => void) => {
            if (event === 'data') dataListeners.push(cb);
          }),
        },
        stderr: { on: jest.fn() },
        // No pid: a timeout's tree kill must never be aimed at a real process.
        whenSpawned: Promise.resolve(undefined),
        pid: undefined,
        killed: false,
        kill: jest.fn(),
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') closeListeners.push(cb);
        }),
      };
    });

    return {
      spawnProcess,
      state,
      /** Close the oldest still-pending held child. */
      release: (): void => pending.shift()?.(),
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('five invalidate+refresh calls during one run cost exactly one trailing status run', async () => {
    const spawner = makeCountingSpawner('status');
    const service = new GitInfoService(
      makeLogger() as never,
      {
        spawnProcess: spawner.spawnProcess,
      } as never,
    );

    const first = service.getGitInfo(WS);
    await drain();
    expect(spawner.state.spawns).toBe(1);

    const refreshes = Array.from({ length: 5 }, () =>
      service.refreshGitInfo(WS),
    );
    await drain();
    // Invalidation never starts a parallel run.
    expect(spawner.state.spawns).toBe(1);

    spawner.release();
    await drain();
    expect(spawner.state.spawns).toBe(2);

    spawner.release();
    const [firstInfo, ...refreshed] = await Promise.all([first, ...refreshes]);

    expect(spawner.state.spawns).toBe(2);
    expect(spawner.state.maxLive).toBe(1);
    expect(firstInfo.branch.branch).toBe('run1');
    // Every refresh resolves with a run that started after it was called.
    for (const info of refreshed) expect(info.branch.branch).toBe('run2');
  });

  it('a plain getGitInfo during a run joins it instead of queueing', async () => {
    const spawner = makeCountingSpawner('status');
    const service = new GitInfoService(
      makeLogger() as never,
      {
        spawnProcess: spawner.spawnProcess,
      } as never,
    );

    const a = service.getGitInfo(WS);
    await drain();
    const b = service.getGitInfo(WS);
    await drain();
    spawner.release();

    const [infoA, infoB] = await Promise.all([a, b]);
    expect(spawner.state.spawns).toBe(1);
    expect(infoB.branch.branch).toBe(infoA.branch.branch);
  });

  it('refreshing one workspace does not queue a rerun for another', async () => {
    const spawner = makeCountingSpawner('status');
    const service = new GitInfoService(
      makeLogger() as never,
      {
        spawnProcess: spawner.spawnProcess,
      } as never,
    );

    const other = service.getGitInfo('/fake/other');
    await drain();
    const refreshed = service.refreshGitInfo(WS);
    await drain();
    const joined = service.getGitInfo('/fake/other');
    await drain();
    // One run per root: the other root's run is still current and is joined.
    expect(spawner.state.spawns).toBe(2);

    spawner.release();
    spawner.release();
    await Promise.all([other, refreshed, joined]);
    expect(spawner.state.spawns).toBe(2);
  });

  it('a cached read invalidated mid-run discards the stale value and caches the trailing one', async () => {
    const spawner = makeCountingSpawner('for-each-ref');
    const service = new GitInfoService(
      makeLogger() as never,
      {
        spawnProcess: spawner.spawnProcess,
      } as never,
    );

    const stale = service.getBranches(WS, false);
    await drain();
    service.invalidateReadCache(WS);
    const fresh = service.getBranches(WS, false);
    await drain();
    expect(spawner.state.spawns).toBe(1);

    spawner.release();
    expect((await stale).current).toBe('run1');
    await drain();
    expect(spawner.state.spawns).toBe(2);

    spawner.release();
    expect((await fresh).current).toBe('run2');

    // The trailing run's value was written back; the stale one never was.
    const served = await service.getBranches(WS, false);
    expect(served.current).toBe('run2');
    expect(spawner.state.spawns).toBe(2);
    expect(spawner.state.maxLive).toBe(1);
  });

  it('a rejected run settles its waiters and the queued trailing run still starts', async () => {
    const service = new GitInfoService(makeLogger() as never);
    let rejectFirst!: (reason: unknown) => void;
    const secondResult = {
      isGitRepo: true,
      branch: { branch: 'second', upstream: null, ahead: 0, behind: 0 },
      files: [],
    };
    const compute = jest
      .spyOn(
        service as unknown as {
          computeGitInfo: (ws: string) => Promise<unknown>;
        },
        'computeGitInfo',
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(secondResult));

    const first = service.getGitInfo(WS);
    const joined = service.getGitInfo(WS);
    const trailing = service.refreshGitInfo(WS);
    await drain();
    expect(compute).toHaveBeenCalledTimes(1);

    rejectFirst(new Error('boom'));

    await expect(first).rejects.toThrow('boom');
    await expect(joined).rejects.toThrow('boom');
    await expect(trailing).resolves.toBe(secondResult);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('a synchronous throw starts at once, rejects its callers and never wedges the key', async () => {
    const service = new GitInfoService(makeLogger() as never);
    const nextResult = {
      isGitRepo: true,
      branch: { branch: 'next', upstream: null, ahead: 0, behind: 0 },
      files: [],
    };
    const compute = jest
      .spyOn(
        service as unknown as {
          computeGitInfo: (ws: string) => Promise<unknown>;
        },
        'computeGitInfo',
      )
      .mockImplementationOnce(() => {
        throw new Error('sync boom');
      })
      .mockImplementationOnce(() => Promise.resolve(nextResult));

    const failed = service.getGitInfo(WS);
    // `compute` ran synchronously inside the call, not a microtask later.
    expect(compute).toHaveBeenCalledTimes(1);
    await expect(failed).rejects.toThrow('sync boom');

    await drain();
    await expect(service.getGitInfo(WS)).resolves.toBe(nextResult);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('a timed-out git status resolves its callers and releases the trailing run', async () => {
    jest.useFakeTimers({
      doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
    });
    const logger = makeLogger();
    const spawner = makeCountingSpawner('status');
    const service = new GitInfoService(
      logger as never,
      {
        spawnProcess: spawner.spawnProcess,
      } as never,
    );

    const first = service.getGitInfo(WS);
    await drain();
    const refreshed = service.refreshGitInfo(WS);
    await drain();
    expect(spawner.state.spawns).toBe(1);

    // The first status child never exits; the status read's own budget
    // (GIT_STATUS_TIMEOUT_MS, TASK_2026_616 G.1) rejects, `computeGitInfo`
    // maps that to an empty result, and the flight settles.
    await jest.advanceTimersByTimeAsync(GIT_STATUS_TIMEOUT_MS);
    const firstInfo = await first;
    expect(firstInfo.branch.branch).toBe('');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('git status timed out'),
      expect.any(Error),
    );

    await drain();
    expect(spawner.state.spawns).toBe(2);
    // The hung child is still pending at the head of the queue. It keeps its
    // exec-git process-gate slot until it closes (TASK_2026_437 C11), but the
    // gate has slots to spare, so the trailing run was not held up. Close both.
    spawner.release();
    spawner.release();
    expect((await refreshed).branch.branch).toBe('run2');
  });
});

// ===========================================================================
// Git process supervision in the status pipeline — TASK_2026_437 C11 (INV-4).
//
// A watcher-driven refresh runs its git children at background OS priority;
// a user-driven `getGitInfo` does not. An untracked file has no git numstat,
// so its line count is a full disk read: only the first 200, each at most
// 1 MiB, are counted, and the rest report unknown.
// ===========================================================================
describe('GitInfoService — status pipeline bounds (TASK_2026_437 C11)', () => {
  const WS = '/fake/workspace';

  /** A spawner handle with a pid that answers per git verb, then closes. */
  function makeVerbSpawner(statusStdout: string) {
    return jest.fn((opts: { args: string[] }) => {
      const verb = opts.args[0];
      const stdout =
        verb === 'rev-parse'
          ? opts.args.includes('--git-path')
            ? '.git/MERGE_HEAD\n.git/CHERRY_PICK_HEAD\n.git/rebase-merge\n.git/rebase-apply\n'
            : 'true\n'
          : verb === 'status'
            ? statusStdout
            : '';
      const dataListeners: Array<(chunk: Buffer) => void> = [];
      const closeListeners: Array<(code: number) => void> = [];
      // A macrotask, not a microtask: exec-git skips `setPriority` for a
      // child already closed when its pid arrives, so the child must still be
      // alive when `whenSpawned` settles.
      setTimeout(() => {
        for (const listener of dataListeners) listener(Buffer.from(stdout));
        for (const listener of closeListeners) listener(0);
      }, 0);
      return {
        stdin: { on: jest.fn(), end: jest.fn(), write: jest.fn() },
        stdout: {
          on: jest.fn((event: string, cb: (chunk: Buffer) => void) => {
            if (event === 'data') dataListeners.push(cb);
          }),
        },
        stderr: { on: jest.fn() },
        whenSpawned: Promise.resolve(31337),
        pid: 31337,
        killed: false,
        kill: jest.fn(),
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') closeListeners.push(cb);
        }),
      };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshGitInfo lowers every git child of the run to background priority', async () => {
    const spawnProcess = makeVerbSpawner('# branch.head main\0');
    const service = new GitInfoService(
      makeLogger() as never,
      { spawnProcess } as never,
    );

    await service.refreshGitInfo(WS);

    // status, the staged + worktree numstat reads, and the operation markers'
    // `rev-parse --git-path` — no repository probe spawn (TASK_2026_616 G.2).
    expect(spawnProcess).toHaveBeenCalledTimes(4);
    expect(mockSetPriority).toHaveBeenCalledTimes(4);
    for (const call of mockSetPriority.mock.calls) {
      expect(call).toEqual([
        31337,
        os.constants.priority.PRIORITY_BELOW_NORMAL,
      ]);
    }
  });

  it('a user-driven getGitInfo keeps normal priority', async () => {
    const spawnProcess = makeVerbSpawner('# branch.head main\0');
    const service = new GitInfoService(
      makeLogger() as never,
      { spawnProcess } as never,
    );

    await service.getGitInfo(WS);

    expect(spawnProcess).toHaveBeenCalledTimes(4);
    expect(mockSetPriority).not.toHaveBeenCalled();
  });

  it('reads line counts for the first 200 untracked files only', async () => {
    const untracked = Array.from({ length: 250 }, (_, i) => `? new/f${i}.ts`);
    const spawnProcess = makeVerbSpawner(
      ['# branch.head main', ...untracked, ''].join('\0'),
    );
    const service = new GitInfoService(
      makeLogger() as never,
      { spawnProcess } as never,
    );
    const readUntracked = jest
      .spyOn(
        service as unknown as {
          readUntrackedNumstat: (
            ws: string,
            p: string,
          ) => Promise<{ additions: number; deletions: number }>;
        },
        'readUntrackedNumstat',
      )
      .mockResolvedValue({ additions: 7, deletions: 0 });

    const info = await service.getGitInfo(WS);

    expect(info.files).toHaveLength(250);
    expect(readUntracked).toHaveBeenCalledTimes(200);
    expect(info.files[199]).toMatchObject({ additions: 7, deletions: 0 });
    for (const file of info.files.slice(200)) {
      expect(file.additions).toBeNull();
      expect(file.deletions).toBeNull();
    }
  });

  it('reports an oversized status as unavailable, not as a clean tree, and warns once', async () => {
    const logger = makeLogger();
    const spawnProcess = makeVerbSpawner('# branch.head main\0');
    const service = new GitInfoService(
      logger as never,
      {
        spawnProcess,
      } as never,
    );
    const seam = service as unknown as {
      execGit: (args: string[], cwd: string, options?: unknown) => unknown;
    };
    const realExecGit = seam.execGit.bind(service);
    jest
      .spyOn(seam, 'execGit')
      .mockImplementation((args: string[], cwd: string, options?: unknown) =>
        args[0] === 'status'
          ? Promise.reject(new GitOutputLimitError('status', 32))
          : realExecGit(args, cwd, options),
      );

    const first = await service.getGitInfo(WS);
    const second = await service.refreshGitInfo(WS);

    for (const info of [first, second]) {
      expect(info).toEqual({
        isGitRepo: true,
        branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
        files: [],
        statusUnavailable: 'output-too-large',
      });
    }
    const limitWarnings = logger.warn.mock.calls.filter(([message]) =>
      String(message).includes('status is unavailable'),
    );
    expect(limitWarnings).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports a blob past the per-side cap as too-large with its real size', async () => {
    const service = new GitInfoService(makeLogger() as never);
    const seam = service as unknown as {
      execGitBuffer: (...args: unknown[]) => Promise<unknown>;
      execGit: (args: string[]) => Promise<unknown>;
    };
    jest
      .spyOn(seam, 'execGitBuffer')
      .mockRejectedValue(
        new GitOutputLimitError('show', GIT_DIFF_MAX_SIDE_BYTES),
      );
    const exec = jest.spyOn(seam, 'execGit').mockResolvedValue({
      stdout: '3145728\n',
      stderr: '',
      exitCode: 0,
    });

    const result = await service.readBlob(WS, 'HEAD', 'big.txt');

    expect(result).toEqual({ outcome: 'too-large', byteLength: 3145728 });
    expect(exec.mock.calls[0][0]).toEqual(['cat-file', '-s', 'HEAD:big.txt']);
  });

  it('reports the cap as the size when git cannot say how big the blob is', async () => {
    const service = new GitInfoService(makeLogger() as never);
    const seam = service as unknown as {
      execGitBuffer: (...args: unknown[]) => Promise<unknown>;
      execGit: (args: string[]) => Promise<unknown>;
    };
    jest
      .spyOn(seam, 'execGitBuffer')
      .mockRejectedValue(
        new GitOutputLimitError('show', GIT_DIFF_MAX_SIDE_BYTES),
      );
    jest.spyOn(seam, 'execGit').mockRejectedValue(new Error('spawn failed'));

    const result = await service.readBlob(WS, '', 'big.txt');

    expect(result).toEqual({
      outcome: 'too-large',
      byteLength: GIT_DIFF_MAX_SIDE_BYTES,
    });
  });

  it('reads a blob capped at the per-side limit, so a binary still classifies', async () => {
    const service = new GitInfoService(makeLogger() as never);
    const seam = service as unknown as {
      execGitBuffer: (
        args: string[],
        cwd: string,
        options?: { maxOutputBytes?: number },
      ) => Promise<unknown>;
    };
    const buffer = jest.spyOn(seam, 'execGitBuffer').mockResolvedValue({
      stdout: Buffer.from([0x00, 0x01]),
      stderr: '',
      exitCode: 0,
    });

    const result = await service.readBlob(WS, 'HEAD', 'big.bin');

    expect(result).toEqual({ outcome: 'binary', byteLength: 2 });
    expect(buffer.mock.calls[0][2]).toEqual({
      maxOutputBytes: GIT_DIFF_MAX_SIDE_BYTES,
    });
  });

  it('reports unknown line counts for an untracked file over 1 MiB', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-cap-'));
    try {
      await writeFile(path.join(root, 'small.txt'), 'a\nb\nc\n');
      await writeFile(
        path.join(root, 'big.txt'),
        Buffer.alloc(1024 * 1024 + 1, 0x61),
      );
      const service = new GitInfoService(makeLogger() as never);
      const read = (
        service as unknown as {
          readUntrackedNumstat: (
            ws: string,
            p: string,
          ) => Promise<{ additions: number | null; deletions: number | null }>;
        }
      ).readUntrackedNumstat.bind(service);

      await expect(read(root, 'small.txt')).resolves.toEqual({
        additions: 3,
        deletions: 0,
        binary: false,
      });
      await expect(read(root, 'big.txt')).resolves.toEqual({
        additions: null,
        deletions: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  describe('network sync operations (push, pull, fetch)', () => {
    let syncService: GitInfoService;
    beforeEach(() => {
      jest.clearAllMocks();
      syncService = new GitInfoService(makeLogger() as never);
    });

    it('push passes GIT_TERMINAL_PROMPT=0 and translates auth failures', async () => {
      // 1. rev-parse @{u} succeeds (upstream exists)
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: 'origin/main\n', exitCode: 0 }),
      );
      // 2. git push fails with terminal prompts disabled
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({
          stdout: '',
          stderr:
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
          exitCode: 128,
        }),
      );

      const result = await syncService.push(WS);

      expect(result).toEqual({
        success: false,
        error: 'Authentication is required for this remote.',
      });

      const pushCall = mockSpawn.mock.calls[1];
      expect(pushCall[2]?.env?.GIT_TERMINAL_PROMPT).toBe('0');
      expect(pushCall[2]?.env?.GIT_ASKPASS).toBe('');
    });

    it('pull passes GIT_TERMINAL_PROMPT=0 and translates auth failures', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({
          stdout: '',
          stderr:
            "fatal: Authentication failed for 'https://github.com/repo.git'\n",
          exitCode: 128,
        }),
      );

      const result = await syncService.pull(WS);

      expect(result).toEqual({
        success: false,
        error: 'Authentication is required for this remote.',
      });

      const pullCall = mockSpawn.mock.calls[0];
      expect(pullCall[2]?.env?.GIT_TERMINAL_PROMPT).toBe('0');
      expect(pullCall[2]?.env?.GIT_ASKPASS).toBe('');
    });

    it('fetch passes GIT_TERMINAL_PROMPT=0 and translates auth failures', async () => {
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({
          stdout: '',
          stderr:
            'Permission denied (publickey).\nfatal: Could not read from remote repository.\n',
          exitCode: 128,
        }),
      );

      const result = await syncService.fetch(WS);

      expect(result).toEqual({
        success: false,
        error: 'Authentication is required for this remote.',
      });

      const fetchCall = mockSpawn.mock.calls[0];
      expect(fetchCall[2]?.env?.GIT_TERMINAL_PROMPT).toBe('0');
      expect(fetchCall[2]?.env?.GIT_ASKPASS).toBe('');
    });
  });
});

// ===========================================================================
// TASK_2026_616 Batch G: git status timeout.
//
// One status refresh is three git children, and the fixed 10 s budget each
// starves under host contention (git.exe launch stalls while many agents
// run in the same repository), so the status read and its two numstat reads
// carry a 30 s budget — still below the 60 s `LONG_GIT_CALL_MS` that moves a
// call to the gate's background lane. `git status` doubles as the repository
// probe (one spawn fewer per refresh), and after a timeout the watcher's
// refreshes back off for 30 s instead of piling onto the same stall.
// ===========================================================================
describe('GitInfoService — status timeout budget and backoff (TASK_2026_616)', () => {
  const WS = '/fake/workspace';

  /** A `SpawnedProcessHandle` double that emits its output, then closes. */
  function makeHandle(opts: {
    stdout: string;
    stderr?: string;
    exitCode?: number;
  }) {
    const stderr = opts.stderr ?? '';
    return {
      stdin: { on: jest.fn(), end: jest.fn(), write: jest.fn() },
      stdout: {
        on: jest.fn((event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => cb(Buffer.from(opts.stdout)), 0);
          }
        }),
      },
      stderr: {
        on: jest.fn((event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data' && stderr) {
            setTimeout(() => cb(Buffer.from(stderr)), 0);
          }
        }),
      },
      whenSpawned: Promise.resolve(31337),
      pid: 31337,
      killed: false,
      kill: jest.fn(),
      on: jest.fn((event: string, cb: (code: number) => void) => {
        if (event === 'close') setTimeout(() => cb(opts.exitCode ?? 0), 0);
      }),
    };
  }

  /** A spawner that answers a full status pipeline per git verb. */
  function makePipelineSpawner() {
    return jest.fn((opts: { args: string[] }) => {
      const verb = opts.args[0];
      const stdout =
        verb === 'status'
          ? '# branch.head main\0'
          : verb === 'rev-parse' && opts.args.includes('--git-path')
            ? '.git/MERGE_HEAD\n.git/CHERRY_PICK_HEAD\n.git/rebase-merge\n.git/rebase-apply\n'
            : '';
      return makeHandle({ stdout });
    });
  }

  /**
   * A service whose first status read rejects with a git timeout (opening
   * the backoff window); every later call runs the real pipeline.
   */
  function makeBackedOffService() {
    const spawnProcess = makePipelineSpawner();
    const service = new GitInfoService(
      makeLogger() as never,
      {
        spawnProcess,
      } as never,
    );
    const seam = service as unknown as {
      execGit: (
        args: string[],
        cwd: string,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const realExecGit = seam.execGit.bind(service);
    jest
      .spyOn(seam, 'execGit')
      .mockImplementationOnce((args: string[], cwd: string) =>
        args[0] === 'status'
          ? Promise.reject(new GitTimeoutError('status', GIT_STATUS_TIMEOUT_MS))
          : realExecGit(args, cwd),
      )
      .mockImplementation((args, cwd, options) =>
        realExecGit(args, cwd, options),
      );
    return { spawnProcess, service };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetGitInfoClockForTests();
  });

  it('passes the status budget to the status and both numstat reads', async () => {
    const spawnProcess = makePipelineSpawner();
    const service = new GitInfoService(
      makeLogger() as never,
      { spawnProcess } as never,
    );
    const calls: Array<{
      verb: string;
      numstat: boolean;
      timeoutMs?: number;
    }> = [];
    const seam = service as unknown as {
      execGit: (
        args: string[],
        cwd: string,
        options?: { timeoutMs?: number },
      ) => Promise<unknown>;
    };
    const realExecGit = seam.execGit.bind(service);
    jest.spyOn(seam, 'execGit').mockImplementation((args, cwd, options) => {
      calls.push({
        verb: args[0],
        numstat: args[0] === 'diff' && args.includes('--numstat'),
        timeoutMs: options?.timeoutMs,
      });
      return realExecGit(args, cwd, options);
    });

    await service.refreshGitInfo(WS);

    const statusCalls = calls.filter(({ verb }) => verb === 'status');
    const numstatCalls = calls.filter(({ numstat }) => numstat);
    expect(statusCalls).toHaveLength(1);
    expect(numstatCalls).toHaveLength(2);
    for (const call of [...statusCalls, ...numstatCalls]) {
      expect(call.timeoutMs).toBe(GIT_STATUS_TIMEOUT_MS);
    }
    // 30 s, and still under the 60 s that moves a call to the gate's
    // background lane, so a user-driven read keeps the interactive lane.
    expect(GIT_STATUS_TIMEOUT_MS).toBe(30_000);
    expect(GIT_STATUS_TIMEOUT_MS).toBeLessThan(60_000);
    // The operation markers' read keeps the default budget.
    const markerCalls = calls.filter(({ verb }) => verb === 'rev-parse');
    expect(markerCalls).toHaveLength(1);
    expect(markerCalls[0].timeoutMs).toBeUndefined();
  });

  it('classifies a non-repository from the status exit, without a probe spawn', async () => {
    const spawnProcess = jest.fn((_opts: { args: string[] }) =>
      makeHandle({
        stdout: '',
        stderr:
          'fatal: not a git repository (or any of the parent directories): .git\n',
        exitCode: 128,
      }),
    );
    const service = new GitInfoService(
      makeLogger() as never,
      { spawnProcess } as never,
    );

    const info = await service.getGitInfo(WS);

    expect(info).toEqual({
      isGitRepo: false,
      branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
      files: [],
    });
    // The status run itself refused the directory; no probe spawn ran first
    // and no numstat read ran after.
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess.mock.calls[0][0].args[0]).toBe('status');
  });

  it('backs off watcher refreshes for 30 s after a timeout; a user read runs and a success closes the window', async () => {
    let nowMs = 1_000_000;
    setGitInfoClockForTests(() => nowMs);
    const logger = makeLogger();
    const spawnProcess = makePipelineSpawner();
    const service = new GitInfoService(
      logger as never,
      {
        spawnProcess,
      } as never,
    );
    const seam = service as unknown as {
      execGit: (
        args: string[],
        cwd: string,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const realExecGit = seam.execGit.bind(service);
    jest
      .spyOn(seam, 'execGit')
      .mockImplementationOnce((args: string[], cwd: string) =>
        args[0] === 'status'
          ? Promise.reject(new GitTimeoutError('status', GIT_STATUS_TIMEOUT_MS))
          : realExecGit(args, cwd),
      )
      .mockImplementation((args, cwd, options) =>
        realExecGit(args, cwd, options),
      );

    // A status read times out: the usual unavailable result, no spawn at all
    // (the rejection happens before the pipeline's other children).
    const timedOut = await service.getGitInfo(WS);
    expect(timedOut).toEqual({
      isGitRepo: true,
      branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
      files: [],
      statusUnavailable: 'timeout',
    });
    expect(spawnProcess).not.toHaveBeenCalled();

    // 5 s inside the 30 s window: a watcher-driven refresh is skipped — no
    // spawn, nothing invalidated — and says "timeout" so the UI keeps the
    // last good list.
    nowMs += 5_000;
    const skipped = await service.refreshGitInfo(WS);
    expect(skipped).toEqual({
      isGitRepo: true,
      branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
      files: [],
      statusUnavailable: 'timeout',
    });
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('skipping background refresh'),
    );

    // An explicit user/RPC read still runs inside the window — and its
    // success closes the window.
    const userRead = await service.getGitInfo(WS);
    expect(userRead.isGitRepo).toBe(true);
    expect(userRead.statusUnavailable).toBeUndefined();
    expect(spawnProcess).toHaveBeenCalledTimes(4);

    // The watcher's refresh runs again: status + both numstat reads; the
    // operation markers' `rev-parse --git-path` is cached from the run above.
    nowMs += 1_000;
    const refreshed = await service.refreshGitInfo(WS);
    expect(refreshed.isGitRepo).toBe(true);
    expect(spawnProcess).toHaveBeenCalledTimes(7);
  });

  it('reports the open backoff window, and creates no timer of its own', async () => {
    jest.useFakeTimers({
      doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
    });
    const { spawnProcess, service } = makeBackedOffService();
    expect(service.statusBackoffRemainingMs('/no/backoff/here')).toBe(0);

    // The first status read times out, so the backoff window opens.
    await expect(service.getGitInfo(WS)).resolves.toMatchObject({
      statusUnavailable: 'timeout',
    });
    expect(service.statusBackoffRemainingMs(WS)).toBe(
      GIT_STATUS_TIMEOUT_BACKOFF_MS,
    );

    // A skipped watcher refresh creates no timer — the follow-up push belongs
    // to the pusher (the git watcher), not to this service.
    await expect(service.refreshGitInfo(WS)).resolves.toMatchObject({
      statusUnavailable: 'timeout',
    });
    expect(jest.getTimerCount()).toBe(0);
    expect(service.statusBackoffRemainingMs(WS)).toBe(
      GIT_STATUS_TIMEOUT_BACKOFF_MS,
    );
    expect(spawnProcess).not.toHaveBeenCalled();

    // The window is a countdown: 0 once it has closed, with nothing run.
    await jest.advanceTimersByTimeAsync(GIT_STATUS_TIMEOUT_BACKOFF_MS);
    expect(service.statusBackoffRemainingMs(WS)).toBe(0);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('a skipped refresh still invalidates the read cache for that root', async () => {
    const { spawnProcess, service } = makeBackedOffService();
    const forEachRefSpawns = () =>
      spawnProcess.mock.calls.filter(
        (call) => call[0].args[0] === 'for-each-ref',
      );

    // A status read times out, so the backoff window opens.
    await expect(service.getGitInfo(WS)).resolves.toMatchObject({
      statusUnavailable: 'timeout',
    });
    // A branches read settles into the read cache and is served from it.
    await service.getBranches(WS, false);
    await service.getBranches(WS, false);
    expect(forEachRefSpawns()).toHaveLength(1);

    // The skipped watcher refresh still drops the cached reads for the root.
    await service.refreshGitInfo(WS);
    await service.getBranches(WS, false);
    expect(forEachRefSpawns()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_576 Batch 25: change-set facade delegates
// ---------------------------------------------------------------------------

describe('GitInfoService — change-set delegates (TASK_2026_576)', () => {
  const WS = '/fake/workspace';
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const LITERAL = ':(top,literal)';
  type ExecResult = { stdout: string; stderr: string; exitCode: number };
  const ok = (stdout: string): ExecResult => ({
    stdout,
    stderr: '',
    exitCode: 0,
  });
  const exit = (exitCode: number): ExecResult => ({
    stdout: '',
    stderr: 'fatal',
    exitCode,
  });

  /** Spy the text seam; `answer` sees each argv in turn. */
  function seamOf(
    service: GitInfoService,
    answer: (args: string[]) => ExecResult,
  ) {
    const seam = service as unknown as {
      execGit: (args: string[], cwd: string) => Promise<ExecResult>;
    };
    return jest
      .spyOn(seam, 'execGit')
      .mockImplementation(async (args: string[]) => answer(args));
  }

  /** Spy the buffer seam used by `readBlob`. */
  function bufferSeamOf(service: GitInfoService) {
    return jest.spyOn(
      service as unknown as {
        execGitBuffer: (
          args: string[],
          cwd: string,
          options?: unknown,
        ) => Promise<unknown>;
      },
      'execGitBuffer',
    );
  }

  describe('readChangeSetNumstat', () => {
    it('counts tracked changes against HEAD and untracked files from disk', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const exec = seamOf(service, (args) => {
        if (args[0] === 'rev-parse') {
          return args.includes('--show-toplevel')
            ? ok('/fake/repo\n')
            : ok('abc123\n');
        }
        if (args[0] === 'diff') {
          return ok(
            '3\t1\tsrc/a.ts\0' + '0\t4\tsrc/gone.ts\0' + '-\t-\timg.png\0',
          );
        }
        if (args[0] === 'ls-files') return ok('new.ts\0');
        throw new Error(`unexpected ${args.join(' ')}`);
      });
      const readUntracked = jest
        .spyOn(
          service as unknown as {
            readUntrackedNumstat: (ws: string, p: string) => Promise<unknown>;
          },
          'readUntrackedNumstat',
        )
        .mockResolvedValue({ additions: 9, deletions: 0, binary: false });

      const counts = await service.readChangeSetNumstat(WS, [
        'src/a.ts',
        'src/gone.ts',
        'img.png',
        'new.ts',
        'reverted.ts',
      ]);

      expect(Object.fromEntries(counts)).toEqual({
        'src/a.ts': { additions: 3, deletions: 1, binary: false },
        'src/gone.ts': { additions: 0, deletions: 4, binary: false },
        'img.png': { additions: null, deletions: null, binary: true },
        'new.ts': { additions: 9, deletions: 0, binary: false },
        'reverted.ts': { additions: 0, deletions: 0, binary: false },
      });
      const diffArgs = exec.mock.calls[1][0];
      expect(diffArgs.slice(0, 7)).toEqual([
        'diff',
        '--numstat',
        '-z',
        '--find-renames',
        '--end-of-options',
        'abc123',
        '--',
      ]);
      expect(diffArgs).toContain(`${LITERAL}src/a.ts`);
      expect(exec.mock.calls[2][0]).toEqual([
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        '--full-name',
        '--',
        `${LITERAL}new.ts`,
        `${LITERAL}reverted.ts`,
      ]);
      // Untracked paths are root-relative: read from the repository top level.
      expect(exec.mock.calls[3][0]).toEqual(['rev-parse', '--show-toplevel']);
      expect(readUntracked).toHaveBeenCalledWith(
        path.normalize('/fake/repo'),
        'new.ts',
      );
    });

    it('leaves untracked counts unknown when the top level cannot be resolved', async () => {
      const logger = makeLogger();
      const service = new GitInfoService(logger as never);
      seamOf(service, (args) => {
        if (args[0] === 'rev-parse') {
          return args.includes('--show-toplevel') ? exit(128) : ok('abc\n');
        }
        if (args[0] === 'ls-files') return ok('new.ts\0');
        return ok('');
      });
      const readUntracked = jest.spyOn(
        service as unknown as {
          readUntrackedNumstat: (ws: string, p: string) => Promise<unknown>;
        },
        'readUntrackedNumstat',
      );

      const counts = await service.readChangeSetNumstat(WS, ['new.ts']);

      expect(counts.get('new.ts')).toEqual({ additions: null, deletions: null });
      expect(readUntracked).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('diffs against the empty tree on an unborn branch', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const exec = seamOf(service, (args) =>
        args[0] === 'rev-parse' ? exit(1) : ok('2\t0\ta.ts\0'),
      );

      const counts = await service.readChangeSetNumstat(WS, ['a.ts']);

      expect(counts.get('a.ts')).toEqual({
        additions: 2,
        deletions: 0,
        binary: false,
      });
      expect(exec.mock.calls[1][0]).toContain(EMPTY_TREE);
    });

    it('reports null counts for every path when git diff fails', async () => {
      const logger = makeLogger();
      const service = new GitInfoService(logger as never);
      seamOf(service, (args) =>
        args[0] === 'rev-parse' ? ok('abc123\n') : exit(128),
      );

      const counts = await service.readChangeSetNumstat(WS, ['a.ts', 'b.ts']);

      expect(Object.fromEntries(counts)).toEqual({
        'a.ts': { additions: null, deletions: null },
        'b.ts': { additions: null, deletions: null },
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('reports null counts when HEAD cannot be resolved', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const exec = seamOf(service, () => exit(128));

      const counts = await service.readChangeSetNumstat(WS, ['a.ts']);

      expect(counts.get('a.ts')).toEqual({ additions: null, deletions: null });
      expect(exec).toHaveBeenCalledTimes(1);
    });

    it('keeps null counts when git throws, and never rejects', async () => {
      const service = new GitInfoService(makeLogger() as never);
      seamOf(service, () => {
        throw new GitOutputLimitError('diff', 16);
      });

      await expect(service.readChangeSetNumstat(WS, ['a.ts'])).resolves.toEqual(
        new Map([['a.ts', { additions: null, deletions: null }]]),
      );
    });

    it('gives an unsafe path null counts without passing it to git', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const exec = seamOf(service, (args) =>
        args[0] === 'rev-parse' ? ok('abc123\n') : ok('1\t1\tok.ts\0'),
      );

      const counts = await service.readChangeSetNumstat(WS, [
        'ok.ts',
        '../escape.ts',
        '/etc/passwd',
      ]);

      expect(counts.get('ok.ts')).toEqual({
        additions: 1,
        deletions: 1,
        binary: false,
      });
      for (const unsafe of ['../escape.ts', '/etc/passwd']) {
        expect(counts.get(unsafe)).toEqual({
          additions: null,
          deletions: null,
        });
      }
      const argv = exec.mock.calls.flatMap(([args]) => args).join('\n');
      expect(argv).not.toContain('escape');
      expect(argv).not.toContain('passwd');
    });

    it('splits a long path list across git runs to stay under the argv limit', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const paths = Array.from(
        { length: 2000 },
        (_, i) => `packages/some-long-directory-name/file-${i}.ts`,
      );
      const exec = seamOf(service, (args) => {
        if (args[0] === 'rev-parse') return ok('abc123\n');
        const lines = args
          .filter((arg) => arg.startsWith(LITERAL))
          .map((arg) => `1\t0\t${arg.slice(LITERAL.length)}\0`);
        return ok(lines.join(''));
      });

      const counts = await service.readChangeSetNumstat(WS, paths);

      const diffRuns = exec.mock.calls.filter(([args]) => args[0] === 'diff');
      expect(diffRuns.length).toBeGreaterThan(1);
      for (const [args] of diffRuns) {
        expect(args.join(' ').length).toBeLessThan(32 * 1024);
      }
      expect(counts.size).toBe(2000);
      expect([...counts.values()].every((c) => c.additions === 1)).toBe(true);
    });
  });

  describe('readHeadText', () => {
    it('reads the blob at the resolved HEAD sha, capped at the per-side limit', async () => {
      const service = new GitInfoService(makeLogger() as never);
      seamOf(service, () => ok('abc123\n'));
      const buffer = bufferSeamOf(service).mockResolvedValue({
        stdout: Buffer.from('hello\n'),
        stderr: '',
        exitCode: 0,
      });

      const result = await service.readHeadText(WS, 'src/a.ts');

      expect(result).toEqual({ outcome: 'content', content: 'hello\n' });
      expect(buffer.mock.calls[0][0]).toEqual(['show', 'abc123:src/a.ts']);
      expect(buffer.mock.calls[0][2]).toEqual({
        maxOutputBytes: GIT_DIFF_MAX_SIDE_BYTES,
      });
    });

    it('is too-large past the per-side cap', async () => {
      const service = new GitInfoService(makeLogger() as never);
      seamOf(service, (args) =>
        args[0] === 'cat-file' ? ok('3145728\n') : ok('abc123\n'),
      );
      bufferSeamOf(service).mockRejectedValue(
        new GitOutputLimitError('show', GIT_DIFF_MAX_SIDE_BYTES),
      );

      await expect(service.readHeadText(WS, 'big.txt')).resolves.toEqual({
        outcome: 'too-large',
        byteLength: 3145728,
      });
    });

    it('reads from the empty tree on an unborn branch', async () => {
      const service = new GitInfoService(makeLogger() as never);
      // HEAD does not resolve, and neither does `<empty tree>:a.ts`.
      seamOf(service, () => exit(1));
      const buffer = bufferSeamOf(service).mockResolvedValue({
        stdout: Buffer.alloc(0),
        stderr: 'fatal: path does not exist',
        exitCode: 128,
      });

      await expect(service.readHeadText(WS, 'a.ts')).resolves.toEqual({
        outcome: 'absent',
      });
      expect(buffer.mock.calls[0][0]).toEqual(['show', `${EMPTY_TREE}:a.ts`]);
    });

    it('refuses path traversal before spawning git', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const exec = seamOf(service, () => ok('abc123\n'));

      await expect(service.readHeadText(WS, '../x')).rejects.toThrow(
        /traversal/,
      );
      expect(exec).not.toHaveBeenCalled();
    });

    it('maps a git spawn failure to an error outcome', async () => {
      const service = new GitInfoService(makeLogger() as never);
      seamOf(service, () => {
        throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
      });

      const result = await service.readHeadText(WS, 'a.ts');

      expect(result.outcome).toBe('error');
    });
  });
});

describe('GitInfoService — commit streaming and staged patch (TASK_2026_576 Batch 45)', () => {
  const WS = '/fake/workspace';
  type ExecResult = { stdout: string; stderr: string; exitCode: number };
  type ExecOptions = {
    signal?: AbortSignal;
    onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  };
  type Answer = (
    args: string[],
    options: ExecOptions | undefined,
  ) => Promise<ExecResult>;

  const ok = (stdout = ''): ExecResult => ({ stdout, stderr: '', exitCode: 0 });

  function seamOf(service: GitInfoService, answer: Answer) {
    const seam = service as unknown as {
      execGit: (
        args: string[],
        cwd: string,
        options?: ExecOptions,
      ) => Promise<ExecResult>;
    };
    return jest
      .spyOn(seam, 'execGit')
      .mockImplementation(async (args, _cwd, options) => answer(args, options));
  }

  /** A `git commit` that streams `lines`, then runs until its signal aborts. */
  function hangingCommit(lines: string[]) {
    let started: () => void = () => undefined;
    const commitStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const answer: Answer = (args, options) => {
      if (args[0] !== 'commit') {
        // rev-parse lookups fail: no index.lock path, no hooks directory.
        return Promise.resolve({ stdout: '', stderr: 'fatal', exitCode: 128 });
      }
      for (const line of lines) options?.onOutput?.('stdout', line);
      started();
      return new Promise<ExecResult>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new GitCancelledError('commit')),
        );
      });
    };
    return { answer, commitStarted };
  }

  describe('commit()', () => {
    it('streams output to onOutput and is stopped by cancelOperation', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const { answer, commitStarted } = hangingCommit([
        'lint 1/3\n',
        'lint 2/3\n',
      ]);
      seamOf(service, answer);
      const seen: string[] = [];

      const pending = service.commit(WS, 'feat: x', {
        operationId: 'op-1',
        onOutput: (_stream, chunk) => seen.push(chunk),
      });
      await commitStarted;

      expect(seen).toEqual(['lint 1/3\n', 'lint 2/3\n']);
      expect(service.cancelOperation('op-1')).toBe(true);
      await expect(pending).resolves.toEqual({
        success: false,
        code: 'CANCELLED',
        error: 'Commit cancelled.',
      });
      // The registry entry went with the settled commit.
      expect(service.cancelOperation('op-1')).toBe(false);
    });

    it('releases the operation id after a successful commit', async () => {
      const service = new GitInfoService(makeLogger() as never);
      seamOf(service, async (args) => {
        if (args[0] === 'rev-parse' && args[1] === '--short') {
          return ok('abc1234\n');
        }
        if (args[0] === 'log') return ok('feat: x\n');
        return ok();
      });

      const result = await service.commit(WS, 'feat: x', {
        operationId: 'op-ok',
      });

      expect(result).toEqual({
        success: true,
        commitHash: 'abc1234',
        subject: 'feat: x',
      });
      expect(service.cancelOperation('op-ok')).toBe(false);
    });

    it('refuses a second commit with an operation id that is still running', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const { answer, commitStarted } = hangingCommit([]);
      const exec = seamOf(service, answer);

      const first = service.commit(WS, 'feat: one', { operationId: 'dup' });
      await commitStarted;
      const second = await service.commit(WS, 'feat: two', {
        operationId: 'dup',
      });

      expect(second).toEqual({
        success: false,
        code: 'GIT_ERROR',
        error: 'An operation with this id is already running.',
      });
      expect(
        exec.mock.calls.filter(([args]) => args[0] === 'commit'),
      ).toHaveLength(1);
      service.cancelOperation('dup');
      await expect(first).resolves.toMatchObject({ code: 'CANCELLED' });
    });

    it('cancels through the caller signal as well as the operation id', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const { answer, commitStarted } = hangingCommit([]);
      seamOf(service, answer);
      const caller = new AbortController();

      const pending = service.commit(WS, 'feat: x', {
        operationId: 'op-sig',
        signal: caller.signal,
      });
      await commitStarted;
      caller.abort();

      await expect(pending).resolves.toMatchObject({ code: 'CANCELLED' });
      expect(service.cancelOperation('op-sig')).toBe(false);
    });

    it('answers false for an operation id that is not running', () => {
      const service = new GitInfoService(makeLogger() as never);
      expect(service.cancelOperation('never-started')).toBe(false);
    });
  });

  describe('readStagedPatch()', () => {
    it('reads git diff --cached with the patch flags', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const patch = 'diff --git a/a.ts b/a.ts\n+x\n';
      const exec = seamOf(service, async () => ok(patch));

      await expect(service.readStagedPatch(WS)).resolves.toEqual({
        kind: 'patch',
        patch,
        truncated: false,
      });
      expect(exec.mock.calls[0][0]).toEqual([
        'diff',
        '--cached',
        '-U3',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--src-prefix=a/',
        '--dst-prefix=b/',
      ]);
    });

    it('reports none when nothing is staged and failed when git fails', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const exec = seamOf(service, async () => ok());
      await expect(service.readStagedPatch(WS)).resolves.toEqual({
        kind: 'none',
      });

      exec.mockImplementation(async () => ({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      }));
      await expect(service.readStagedPatch(WS)).resolves.toEqual({
        kind: 'failed',
      });
    });

    it('stops git past 48 KiB and keeps whole lines plus a truncation note', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const line = `+${'x'.repeat(99)}\n`; // 101 bytes
      let aborted = false;
      seamOf(service, (_args, options) => {
        for (let i = 0; i < 1000 && !options?.signal?.aborted; i++) {
          options?.onOutput?.('stdout', line);
        }
        aborted = options?.signal?.aborted ?? false;
        return Promise.reject(new GitCancelledError('diff'));
      });

      const result = await service.readStagedPatch(WS);

      expect(aborted).toBe(true);
      if (result.kind !== 'patch') throw new Error(`got ${result.kind}`);
      expect(result.truncated).toBe(true);
      expect(result.patch.endsWith(STAGED_PATCH_TRUNCATED_NOTE)).toBe(true);
      const body = result.patch.slice(0, -STAGED_PATCH_TRUNCATED_NOTE.length);
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(48 * 1024);
      expect(body.length % line.length).toBe(0);
    });

    it('caps a completed run whose output is over 48 KiB', async () => {
      const service = new GitInfoService(makeLogger() as never);
      const line = `+${'y'.repeat(99)}\n`;
      seamOf(service, async () => ok(line.repeat(600)));

      const result = await service.readStagedPatch(WS);

      expect(result).toMatchObject({ kind: 'patch', truncated: true });
    });
  });
});
