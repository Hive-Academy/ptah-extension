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
