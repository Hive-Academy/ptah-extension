/**
 * GitInfoService — unit specs for the 6 new methods added in TASK_2026_111 Batch 2.
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
    it('parses for-each-ref output into local BranchRef[]', async () => {
      // First call: symbolic-ref --short HEAD  (detects current branch)
      // Second call: for-each-ref refs/heads/
      let callIdx = 0;
      mockSpawn.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          // symbolic-ref call
          return makeSpawnResult({ stdout: 'main\n', exitCode: 0 });
        }
        // for-each-ref call — format: shortname TAB hash TAB upstream TAB ahead-behind TAB time
        const line = 'main\tabc1234\torigin/main\t2 0\t1700000000\n';
        return makeSpawnResult({ stdout: line, exitCode: 0 });
      });

      const result = await service.getBranches(WS, false);

      expect(result.current).toBe('main');
      expect(result.local).toHaveLength(1);
      expect(result.local[0].name).toBe('main');
      expect(result.local[0].ahead).toBe(2);
      expect(result.local[0].behind).toBe(0);
    });

    it('returns empty result when for-each-ref exits non-zero', async () => {
      let callIdx = 0;
      mockSpawn.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          return makeSpawnResult({ stdout: 'main\n', exitCode: 0 });
        }
        return makeSpawnResult({
          stdout: '',
          exitCode: 128,
          stderr: 'not a repo',
        });
      });

      const result = await service.getBranches(WS, false);

      expect(result.local).toEqual([]);
      expect(result.remote).toEqual([]);
    });

    it('includes remote branches when includeRemote=true', async () => {
      let callIdx = 0;
      mockSpawn.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          // symbolic-ref
          return makeSpawnResult({ stdout: 'main\n', exitCode: 0 });
        }
        if (callIdx === 2) {
          // for-each-ref refs/heads/
          return makeSpawnResult({
            stdout: 'main\tabc1234\torigin/main\t1 0\t1700000000\n',
            exitCode: 0,
          });
        }
        // for-each-ref refs/remotes/
        return makeSpawnResult({
          stdout: 'origin/main\tdef5678\t\t\t1700000000\n',
          exitCode: 0,
        });
      });

      const result = await service.getBranches(WS, true);

      expect(result.local).toHaveLength(1);
      expect(result.remote).toHaveLength(1);
      expect(result.remote[0].name).toBe('origin/main');
      expect(result.remote[0].isRemote).toBe(true);
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
