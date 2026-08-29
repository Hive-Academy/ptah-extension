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
 * `crossSpawn` is mocked at the module boundary so no git binary is required.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Mock cross-spawn so we control stdout/stderr/exitCode per test.
// ---------------------------------------------------------------------------
const mockSpawn = jest.fn();
jest.mock('cross-spawn', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSpawn(...args),
}));

import { GitInfoService } from './git-info.service';

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

    it.each([
      ['[ahead 3, behind 2]', 3, 2],
      ['[ahead 3]', 3, 0],
      ['[behind 2]', 0, 2],
      ['[gone]', 0, 0],
      ['', 0, 0],
    ])(
      'maps upstream:track %p to ahead=%i behind=%i',
      async (track, ahead, behind) => {
        mockSpawn.mockImplementation(() =>
          makeSpawnResult({
            stdout:
              refLine({
                refname: 'refs/heads/main',
                short: 'main',
                head: '*',
                upstream: 'origin/main',
                track,
              }) + '\n',
            exitCode: 0,
          }),
        );

        const result = await service.getBranches(WS, false);

        expect(result.local[0].ahead).toBe(ahead);
        expect(result.local[0].behind).toBe(behind);
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

      // force=true skips the dirty-tree probe and goes straight to the
      // `checkout` spawn, which `isMutatingGitCommand` recognises.
      await service.checkout(WS, 'other', false, true);
      await service.getBranches(WS, false);

      const forEachRefCalls = mockSpawn.mock.calls.filter(
        ([, args]: [unknown, string[]]) => args[0] === 'for-each-ref',
      );
      expect(forEachRefCalls).toHaveLength(2);
    });

    it('a read command does not invalidate the entry it just populated', async () => {
      await service.stashList(WS);
      await service.stashList(WS);

      const stashCalls = mockSpawn.mock.calls.filter(
        ([, args]: [unknown, string[]]) => args[0] === 'stash',
      );
      expect(stashCalls).toHaveLength(1);
    });

    // `getGitInfo` is the working-tree status walk and the git watcher's own
    // source of truth. A settled entry would make the watcher push status it
    // had already superseded, so it gets coalescing only.
    it('getGitInfo coalesces concurrently but is never served from a settled entry', async () => {
      mockSpawn.mockImplementation((_cmd: unknown, args: string[]) =>
        args[0] === 'rev-parse'
          ? makeSpawnResult({ stdout: 'true\n', exitCode: 0 })
          : makeSpawnResult({ stdout: '# branch.head main\n', exitCode: 0 }),
      );

      await Promise.all([service.getGitInfo(WS), service.getGitInfo(WS)]);
      // rev-parse + status, once — not twice.
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      await service.getGitInfo(WS);

      expect(mockSpawn).toHaveBeenCalledTimes(4);
    });
  });

  // ==========================================================================
  // checkout
  // ==========================================================================

  describe('checkout()', () => {
    it('returns { success: false, dirty: true } when status --porcelain has output and force=false', async () => {
      // First call: status --porcelain (returns dirty output)
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: ' M src/index.ts\n', exitCode: 0 }),
      );

      const result = await service.checkout(WS, 'feat/x', false, false);

      expect(result).toEqual({ success: false, dirty: true });
      // Checkout itself should NOT have been called
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('proceeds with checkout when force=true even if status shows dirty tree', async () => {
      // Only the checkout call — status is skipped when force=true
      mockSpawn.mockImplementationOnce(() =>
        makeSpawnResult({ stdout: '', exitCode: 0 }),
      );

      const result = await service.checkout(WS, 'feat/x', false, true);

      expect(result).toEqual({ success: true });
      // Only 1 call: the checkout; status was skipped
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const args: string[] = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--force');
      expect(args).toContain('feat/x');
    });

    it('returns { success: false, error: "Invalid branch name" } for path traversal attempt', async () => {
      const result = await service.checkout(WS, '../evil', false, false);

      expect(result).toEqual({ success: false, error: 'Invalid branch name' });
      // No git calls should be made for invalid branch
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns { success: true } for clean tree when force=false', async () => {
      let callIdx = 0;
      mockSpawn.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          // status --porcelain: clean
          return makeSpawnResult({ stdout: '', exitCode: 0 });
        }
        // checkout call
        return makeSpawnResult({ stdout: '', exitCode: 0 });
      });

      const result = await service.checkout(WS, 'main', false, false);

      expect(result).toEqual({ success: true });
    });
  });

  // ==========================================================================
  // stashList
  // ==========================================================================

  describe('stashList()', () => {
    it('parses tab-separated stash list output into StashEntry[]', async () => {
      const stashOutput = [
        'stash@{0}\tWIP on main: fix tests\t1700000100',
        'stash@{1}\tWIP on feat/x: add feature\t1700000050',
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
      expect(first.message).toBe('WIP on main: fix tests');

      const second = result.entries[1];
      expect(second.index).toBe(1);
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

  // An untracked *directory* row is clickable in Source Control, so this
  // request really does reach the service. Its worktree side reads the
  // directory itself: node answers `EISDIR`, the VS Code file-system port
  // answers `FileIsADirectory`, and both used to land on `unknown`.
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

describe('GitInfoService.parseFileStatus() — origPath (N3)', () => {
  let service: GitInfoService;
  const WS = '/fake/workspace';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GitInfoService(makeLogger() as never);
  });

  it('populates origPath from the post-tab segment of a type-2 rename line', async () => {
    const status = [
      '# branch.head main',
      '2 R. N... 100644 100644 100644 abc123 def456 R100 src/new-name.ts\tsrc/old-name.ts',
      '',
    ].join('\n');

    queueSpawn([
      { stdout: 'true\n', exitCode: 0 }, // isGitRepo
      { stdout: status, exitCode: 0 }, // status --porcelain=v2
    ]);

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
    ].join('\n');

    queueSpawn([
      { stdout: 'true\n', exitCode: 0 },
      { stdout: status, exitCode: 0 },
    ]);

    const info = await service.getGitInfo(WS);

    expect(info.files[0].origPath).toBeUndefined();
  });
});
