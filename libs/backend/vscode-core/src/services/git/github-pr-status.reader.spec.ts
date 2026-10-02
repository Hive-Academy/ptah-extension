import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type {
  IProcessSpawner,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import {
  DEFAULT_GH_PR_CACHE_TTL_MS,
  GH_NON_INTERACTIVE_ENV,
  GH_PR_LIST_JSON_FIELDS,
  GH_PR_LIST_LIMIT,
  GitHubPrStatusReader,
  normalizePrState,
  normalizeReviewDecision,
  ownerFromRemoteUrl,
  sanitizePrUrl,
  summarizeStatusCheckRollup,
} from './github-pr-status.reader';
import { GitInvalidRefError } from './git-ref-guard';
import type { GitWriteRunner } from './git-write-lock';

/** `gh pr list` argv for `branch`. */
function listArgs(branch: string): string[] {
  return [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'all',
    '--limit',
    String(GH_PR_LIST_LIMIT),
    '--json',
    GH_PR_LIST_JSON_FIELDS,
  ];
}

/** `gh pr list` stdout: one PR from `branch`, plus any `extra` fields. */
function prList(branch: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify([{ headRefName: branch, ...extra }]);
}

const mockCrossSpawn = jest.fn();
jest.mock('cross-spawn', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCrossSpawn(...args),
}));

const mockKillProcessTree = jest.fn().mockResolvedValue(undefined);
jest.mock('@ptah-extension/platform-core', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/platform-core')
  >('@ptah-extension/platform-core');
  return {
    ...actual,
    killProcessTree: (...args: unknown[]) => mockKillProcessTree(...args),
  };
});

interface FakeProcessOptions {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: Error & { code?: string };
  hang?: boolean;
  /** Stay open until `release()`; then behave as configured. */
  deferred?: boolean;
}

class FakeProcessHandle extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly whenSpawned = Promise.resolve(4242);
  readonly pid = 4242;
  killed = false;
  exitCode: number | null = null;

  constructor(private readonly options: FakeProcessOptions = {}) {
    super();
    if (options.error) {
      process.nextTick(() => {
        this.emit('error', options.error);
      });
      return;
    }

    if (!options.hang && !options.deferred) {
      process.nextTick(() => this.release());
    }
  }

  release(): void {
    if (this.options.stdout) this.stdout.write(this.options.stdout);
    this.stdout.end();
    if (this.options.stderr) this.stderr.write(this.options.stderr);
    this.stderr.end();

    this.exitCode = this.options.exitCode ?? 0;
    this.emit('close', this.exitCode);
  }

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    if (this.options.hang) {
      process.nextTick(() => {
        this.stdout.end();
        this.stderr.end();
        this.exitCode = null;
        this.emit('close', null);
      });
    }
    return true;
  }
}

describe('GitHubPrStatusReader', () => {
  const root = '/workspace/test-repo';
  let recordedRequests: ProcessSpawnRequest[] = [];
  let spawned: FakeProcessHandle[] = [];
  let nextProcessOptions: FakeProcessOptions = {};

  const fakeSpawner: IProcessSpawner = {
    spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle {
      recordedRequests.push(request);
      const handle = new FakeProcessHandle(nextProcessOptions);
      spawned.push(handle);
      return handle;
    },
  };

  const debugLogs: Array<{ msg: string; meta?: unknown }> = [];
  const warnLogs: Array<{ msg: string; meta?: unknown }> = [];
  const errorLogs: Array<{ msg: string; meta?: unknown }> = [];

  const mockLogger = {
    debug: (msg: string, meta?: unknown) => debugLogs.push({ msg, meta }),
    warn: (msg: string, meta?: unknown) => warnLogs.push({ msg, meta }),
    error: (msg: string, meta?: unknown) => errorLogs.push({ msg, meta }),
    info: jest.fn(),
  } as unknown as import('../../logging').Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    recordedRequests = [];
    spawned = [];
    nextProcessOptions = {};
    debugLogs.length = 0;
    warnLogs.length = 0;
    errorLogs.length = 0;
  });

  describe('argv and env shape', () => {
    it('runs gh pr list --head <branch> with expected fields and non-interactive env', async () => {
      const samplePrJson = prList('feat/my-branch', {
        number: 42,
        title: 'Add feature',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'APPROVED',
        url: 'https://github.com/org/repo/pull/42',
        statusCheckRollup: [],
      });
      nextProcessOptions = { exitCode: 0, stdout: samplePrJson };

      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        logger: mockLogger,
      });

      const result = await reader.read(root, 'feat/my-branch');

      expect(recordedRequests).toHaveLength(1);
      const req = recordedRequests[0];
      expect(req.command).toBe('gh');
      expect(req.cwd).toBe(root);

      // `--head` takes the value as a branch name, never a PR number.
      expect(req.args).toEqual(listArgs('feat/my-branch'));

      // Verify non-interactive env variables
      expect(req.env).toMatchObject(GH_NON_INTERACTIVE_ENV);

      expect(result).toEqual({
        status: 'ok',
        pr: {
          number: 42,
          title: 'Add feature',
          state: 'OPEN',
          isDraft: false,
          reviewDecision: 'APPROVED',
          url: 'https://github.com/org/repo/pull/42',
          headRefName: 'feat/my-branch',
        },
        checks: {
          passing: 0,
          failing: 0,
          pending: 0,
          total: 0,
        },
      });

      // Quiet logging: no warn or error logs
      expect(warnLogs).toHaveLength(0);
      expect(errorLogs).toHaveLength(0);
    });
  });

  describe('unsafe ref rejection', () => {
    it('rejects without spawning when branch starts with a dash', async () => {
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });
      await expect(reader.read(root, '-b')).rejects.toThrow(GitInvalidRefError);
      expect(recordedRequests).toHaveLength(0);
    });

    it('rejects without spawning when branch contains control characters or forbidden chars', async () => {
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });
      await expect(reader.read(root, 'feat..branch')).rejects.toThrow(
        GitInvalidRefError,
      );
      await expect(reader.read(root, 'feat~1')).rejects.toThrow(
        GitInvalidRefError,
      );
      await expect(reader.read(root, 'feat^')).rejects.toThrow(
        GitInvalidRefError,
      );
      expect(recordedRequests).toHaveLength(0);
    });
  });

  describe('url sanitization', () => {
    it('preserves valid https PR URLs and drops non-https URLs', async () => {
      expect(sanitizePrUrl('https://github.com/owner/repo/pull/10')).toBe(
        'https://github.com/owner/repo/pull/10',
      );
      expect(
        sanitizePrUrl('http://github.com/owner/repo/pull/10'),
      ).toBeUndefined();
      expect(sanitizePrUrl('javascript:alert(1)')).toBeUndefined();
      expect(sanitizePrUrl('ftp://example.com')).toBeUndefined();
      expect(sanitizePrUrl('not-a-url')).toBeUndefined();
      expect(sanitizePrUrl(null)).toBeUndefined();
    });

    it('omits url in the PR object when gh returns a non-https url', async () => {
      const samplePrJson = prList('fix/something', {
        number: 10,
        title: 'Http link',
        state: 'OPEN',
        isDraft: false,
        url: 'http://insecure.example.com/pr/10',
      });
      nextProcessOptions = { exitCode: 0, stdout: samplePrJson };

      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });
      const result = await reader.read(root, 'fix/something');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.pr.url).toBeUndefined();
      }
    });
  });

  describe('statusCheckRollup summarization', () => {
    it('summarizes check runs and status contexts accurately', () => {
      const rollup = [
        {
          __typename: 'CheckRun',
          name: 'ci/test',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
        },
        {
          __typename: 'CheckRun',
          name: 'ci/lint',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
        {
          __typename: 'CheckRun',
          name: 'ci/build',
          status: 'IN_PROGRESS',
          conclusion: null,
        },
        {
          __typename: 'CheckRun',
          name: 'ci/deploy',
          status: 'QUEUED',
          conclusion: null,
        },
        {
          __typename: 'CheckRun',
          name: 'ci/docs',
          status: 'COMPLETED',
          conclusion: 'SKIPPED',
        },
        {
          __typename: 'CheckRun',
          name: 'ci/e2e',
          status: 'COMPLETED',
          conclusion: 'TIMED_OUT',
        },
        { __typename: 'StatusContext', context: 'codecov', state: 'SUCCESS' },
        { __typename: 'StatusContext', context: 'sonar', state: 'PENDING' },
        { __typename: 'StatusContext', context: 'security', state: 'ERROR' },
      ];

      const summary = summarizeStatusCheckRollup(rollup);
      expect(summary).toEqual({
        passing: 3, // ci/test (SUCCESS), ci/docs (SKIPPED), codecov (SUCCESS)
        failing: 3, // ci/lint (FAILURE), ci/e2e (TIMED_OUT), security (ERROR)
        pending: 3, // ci/build (IN_PROGRESS), ci/deploy (QUEUED), sonar (PENDING)
        total: 9,
      });
    });

    it('handles null, non-array, or empty statusCheckRollup defensively', () => {
      expect(summarizeStatusCheckRollup(null)).toEqual({
        passing: 0,
        failing: 0,
        pending: 0,
        total: 0,
      });
      expect(summarizeStatusCheckRollup(undefined)).toEqual({
        passing: 0,
        failing: 0,
        pending: 0,
        total: 0,
      });
      expect(summarizeStatusCheckRollup({})).toEqual({
        passing: 0,
        failing: 0,
        pending: 0,
        total: 0,
      });
      expect(summarizeStatusCheckRollup([])).toEqual({
        passing: 0,
        failing: 0,
        pending: 0,
        total: 0,
      });
    });
  });

  describe('defensive JSON parse (A10)', () => {
    it('returns unavailable with reason failed on malformed JSON without throwing', async () => {
      nextProcessOptions = { exitCode: 0, stdout: 'Not JSON at all' };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        logger: mockLogger,
      });

      const result = await reader.read(root, 'feat/x');
      expect(result).toEqual({ status: 'unavailable', reason: 'failed' });
      expect(warnLogs).toHaveLength(0);
      expect(errorLogs).toHaveLength(0);
      const malformed = debugLogs.find((l) => l.msg.includes('Malformed JSON'));
      expect(malformed).toBeDefined();
      // Only the size is logged, never gh's output itself.
      expect(malformed?.meta).toEqual({ stdoutBytes: 15 });
    });

    it('answers failed for a JSON value that is not a list', async () => {
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify({ unexpected: 123 }),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const result = await reader.read(root, 'feat/x');
      expect(result).toEqual({ status: 'unavailable', reason: 'failed' });
    });

    it('normalizes missing and unknown fields of a matching PR', async () => {
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([
          null,
          { unexpected: 123 },
          {
            headRefName: 'feat/x',
            state: 'weird',
            reviewDecision: { nested: true },
          },
        ]),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const result = await reader.read(root, 'feat/x');
      expect(result).toEqual({
        status: 'ok',
        pr: {
          number: 0,
          title: '',
          state: 'UNKNOWN',
          isDraft: false,
          reviewDecision: null,
          headRefName: 'feat/x',
        },
        checks: {
          passing: 0,
          failing: 0,
          pending: 0,
          total: 0,
        },
      });
    });

    it('answers no-pr for an empty list', async () => {
      nextProcessOptions = { exitCode: 0, stdout: '[]' };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      expect(await reader.read(root, 'feat/x')).toEqual({
        status: 'unavailable',
        reason: 'no-pr',
      });
    });
  });

  describe('unavailable reason mapping', () => {
    it('maps ENOENT process error to gh-missing', async () => {
      const enoent = Object.assign(new Error('spawn gh ENOENT'), {
        code: 'ENOENT',
      });
      nextProcessOptions = { error: enoent };

      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        logger: mockLogger,
      });
      const result = await reader.read(root, 'feat/x');

      expect(result).toEqual({ status: 'unavailable', reason: 'gh-missing' });
      expect(warnLogs).toHaveLength(0);
      expect(errorLogs).toHaveLength(0);
    });

    it('maps synchronous ENOENT spawn failure to gh-missing', async () => {
      const throwingSpawner: IProcessSpawner = {
        spawnProcess() {
          throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        },
      };

      const reader = new GitHubPrStatusReader({
        spawner: throwingSpawner,
        logger: mockLogger,
      });
      const result = await reader.read(root, 'feat/x');

      expect(result).toEqual({ status: 'unavailable', reason: 'gh-missing' });
      expect(warnLogs).toHaveLength(0);
    });

    it('maps auth failure stderr to not-authenticated', async () => {
      nextProcessOptions = {
        exitCode: 1,
        stderr: 'To authenticate, please run `gh auth login`',
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        logger: mockLogger,
      });
      const result = await reader.read(root, 'feat/x');

      expect(result).toEqual({
        status: 'unavailable',
        reason: 'not-authenticated',
      });
      expect(warnLogs).toHaveLength(0);
    });

    it('maps "not logged in" stderr to not-authenticated', async () => {
      nextProcessOptions = {
        exitCode: 1,
        stderr:
          'You are not logged into any GitHub hosts. Run gh auth login to authenticate.',
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });
      const result = await reader.read(root, 'feat/x');

      expect(result).toEqual({
        status: 'unavailable',
        reason: 'not-authenticated',
      });
    });

    it('maps "no pull requests found" stderr to no-pr', async () => {
      nextProcessOptions = {
        exitCode: 1,
        stderr: 'no pull requests found for branch "feat/new"',
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        logger: mockLogger,
      });
      const result = await reader.read(root, 'feat/new');

      expect(result).toEqual({ status: 'unavailable', reason: 'no-pr' });
      expect(warnLogs).toHaveLength(0);
    });

    it('maps non-GitHub remote stderr to not-github', async () => {
      nextProcessOptions = {
        exitCode: 1,
        stderr:
          'none of the git remotes configured for this repository point to a known GitHub host.',
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });
      const result = await reader.read(root, 'feat/x');

      expect(result).toEqual({ status: 'unavailable', reason: 'not-github' });
    });

    it('maps unrecognized non-zero exit code to failed', async () => {
      nextProcessOptions = {
        exitCode: 2,
        stderr: 'unknown git error',
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });
      const result = await reader.read(root, 'feat/x');

      expect(result).toEqual({ status: 'unavailable', reason: 'failed' });
    });
  });

  describe('timeout', () => {
    it('aborts the child and returns timeout when execution exceeds timeoutMs', async () => {
      nextProcessOptions = { hang: true };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        timeoutMs: 50,
        logger: mockLogger,
      });

      const result = await reader.read(root, 'feat/timeout-test');

      expect(result).toEqual({ status: 'unavailable', reason: 'timeout' });
      expect(mockKillProcessTree).toHaveBeenCalledWith(4242);
      expect(warnLogs).toHaveLength(0);
    });
  });

  describe('caching and clock injection', () => {
    it('caches ok results for 60 s, serves cache hits without spawning, and misses after 60 s', async () => {
      let currentTime = 1_000_000;
      const samplePrJson = prList('feat/cache', {
        number: 1,
        title: 'Cached PR',
        state: 'OPEN',
        isDraft: false,
      });
      nextProcessOptions = { exitCode: 0, stdout: samplePrJson };

      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        cacheTtlMs: DEFAULT_GH_PR_CACHE_TTL_MS,
        now: () => currentTime,
      });

      // First read: cache miss -> spawns
      const res1 = await reader.read(root, 'feat/cache');
      expect(res1.status).toBe('ok');
      expect(recordedRequests).toHaveLength(1);

      // Advance by 30 s: cache hit -> no new spawn
      currentTime += 30_000;
      const res2 = await reader.read(root, 'feat/cache');
      expect(res2).toEqual(res1);
      expect(recordedRequests).toHaveLength(1);

      // Advance past 60 s (total 65 s): cache expired -> spawns again
      currentTime += 35_000;
      const res3 = await reader.read(root, 'feat/cache');
      expect(res3.status).toBe('ok');
      expect(recordedRequests).toHaveLength(2);
    });

    it('caches no-pr results for 60 s', async () => {
      let currentTime = 2_000_000;
      nextProcessOptions = {
        exitCode: 1,
        stderr: 'no pull requests found for branch "feat/none"',
      };

      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        now: () => currentTime,
      });

      const res1 = await reader.read(root, 'feat/none');
      expect(res1).toEqual({ status: 'unavailable', reason: 'no-pr' });
      expect(recordedRequests).toHaveLength(1);

      // Advance 20 s -> cache hit
      currentTime += 20_000;
      const res2 = await reader.read(root, 'feat/none');
      expect(res2).toEqual({ status: 'unavailable', reason: 'no-pr' });
      expect(recordedRequests).toHaveLength(1);
    });

    it('does NOT cache other failures (timeout, failed, not-authenticated)', async () => {
      const currentTime = 3_000_000;
      nextProcessOptions = {
        exitCode: 1,
        stderr: 'You are not logged into any GitHub hosts.',
      };

      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        now: () => currentTime,
      });

      const res1 = await reader.read(root, 'feat/auth');
      expect(res1).toEqual({
        status: 'unavailable',
        reason: 'not-authenticated',
      });
      expect(recordedRequests).toHaveLength(1);

      // Calling again immediately does not hit cache and spawns again
      const res2 = await reader.read(root, 'feat/auth');
      expect(res2).toEqual({
        status: 'unavailable',
        reason: 'not-authenticated',
      });
      expect(recordedRequests).toHaveLength(2);
    });

    it('normalizes workspaceRoot casing and separators for cache keys', async () => {
      const currentTime = 4_000_000;
      const samplePrJson = prList('feat/norm', {
        number: 99,
        title: 'Normalized',
        state: 'OPEN',
        isDraft: false,
      });
      nextProcessOptions = { exitCode: 0, stdout: samplePrJson };

      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        now: () => currentTime,
      });

      await reader.read('D:\\Projects\\Repo\\', 'feat/norm');
      expect(recordedRequests).toHaveLength(1);

      // Same repo with forward slashes and lowercase should hit cache
      await reader.read('d:/projects/repo', 'feat/norm');
      expect(recordedRequests).toHaveLength(1);
    });

    it('invalidate(root) drops every branch of that root and keeps other roots', async () => {
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([
          { number: 5, title: 'T', state: 'OPEN', headRefName: 'feat/a' },
          { number: 6, title: 'T', state: 'OPEN', headRefName: 'feat/b' },
        ]),
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        now: () => 5_000_000,
      });

      await reader.read('D:\\Repo', 'feat/a');
      await reader.read('D:\\Repo', 'feat/b');
      await reader.read('D:\\Repo2', 'feat/a');
      expect(recordedRequests).toHaveLength(3);

      // Same root in another spelling: the key is normalized the same way.
      reader.invalidate('d:/repo/');

      await reader.read('D:\\Repo', 'feat/a');
      await reader.read('D:\\Repo', 'feat/b');
      expect(recordedRequests).toHaveLength(5);
      // `D:\Repo2` shares the prefix text but is another root: still cached.
      await reader.read('D:\\Repo2', 'feat/a');
      expect(recordedRequests).toHaveLength(5);
    });

    it('invalidate() without a root clears the whole cache', async () => {
      nextProcessOptions = {
        exitCode: 0,
        stdout: prList('feat/a', { number: 6, title: 'T', state: 'OPEN' }),
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        now: () => 6_000_000,
      });

      await reader.read('/one', 'feat/a');
      await reader.read('/two', 'feat/a');
      reader.invalidate();
      await reader.read('/one', 'feat/a');
      await reader.read('/two', 'feat/a');
      expect(recordedRequests).toHaveLength(4);
    });
  });

  describe('cross-spawn fallback', () => {
    it('spawns through cross-spawn when no spawner is injected and never uses shell: true', async () => {
      const fakeChild = new FakeProcessHandle({
        exitCode: 0,
        stdout: prList('main', {
          number: 7,
          title: 'Via crossSpawn',
          state: 'OPEN',
          isDraft: false,
        }),
      });
      mockCrossSpawn.mockReturnValue(fakeChild);

      const reader = new GitHubPrStatusReader({
        // No spawner passed
        logger: mockLogger,
      });

      const result = await reader.read(root, 'main');

      expect(mockCrossSpawn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = mockCrossSpawn.mock.calls[0];
      expect(cmd).toBe('gh');
      expect(args).toEqual(listArgs('main'));
      expect(opts.cwd).toBe(root);
      expect(opts.shell).toBeUndefined(); // NEVER shell: true
      expect(opts.env).toMatchObject(GH_NON_INTERACTIVE_ENV);
      expect(result.status).toBe('ok');
    });
  });

  describe('branch match (SER-1)', () => {
    /** `git remote -v` output for `urls`. */
    function remoteList(urls: Record<string, string>): string {
      return Object.entries(urls)
        .flatMap(([name, url]) => [
          `${name}\t${url} (fetch)`,
          `${name}\t${url} (push)`,
        ])
        .join('\n');
    }

    /** A git runner answering `@{push}` with `pushRef` (null: no upstream). */
    function fakeGit(
      pushRef: string | null,
      urls: Record<string, string>,
    ): { exec: GitWriteRunner; calls: string[][] } {
      const calls: string[][] = [];
      const exec: GitWriteRunner = (args) => {
        calls.push(args);
        if (args[0] === 'remote') {
          return Promise.resolve({
            stdout: `${remoteList(urls)}\n`,
            stderr: '',
            exitCode: 0,
          });
        }
        if (pushRef === null) {
          return Promise.resolve({
            stdout: '',
            stderr: 'fatal: no upstream configured',
            exitCode: 128,
          });
        }
        return Promise.resolve({
          stdout: `${pushRef}\n`,
          stderr: '',
          exitCode: 0,
        });
      };
      return { exec, calls };
    }

    function pr(
      number: number,
      headRefName: string,
      owner: string,
      state = 'OPEN',
    ): Record<string, unknown> {
      return {
        number,
        title: `PR ${number}`,
        state,
        headRefName,
        headRepositoryOwner: { login: owner },
      };
    }

    it('treats an all-digit branch as a branch and rejects a PR from another head', async () => {
      // What `gh pr view 123` would show: PR #123, from some other branch.
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([pr(123, 'feat/other', 'org')]),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const result = await reader.read(root, '123');

      expect(recordedRequests[0].args).toEqual(listArgs('123'));
      expect(result).toEqual({ status: 'unavailable', reason: 'no-pr' });
    });

    it('accepts the PR whose head is the all-digit branch itself', async () => {
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([pr(77, '123', 'org')]),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const result = await reader.read(root, '123');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') expect(result.pr.number).toBe(77);
    });

    it("rejects a fork's PR from a branch of the same name (origin owner)", async () => {
      const git = fakeGit(null, { origin: 'https://github.com/Org/repo.git' });
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([pr(9, 'main', 'someone')]),
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        exec: git.exec,
      });

      expect(await reader.read(root, 'main')).toEqual({
        status: 'unavailable',
        reason: 'no-pr',
      });
      expect(git.calls).toContainEqual([
        'rev-parse',
        '--symbolic-full-name',
        'main@{push}',
      ]);
      expect(git.calls).toContainEqual(['remote', '-v']);
    });

    it("picks the PR from the branch's push remote among same-named heads", async () => {
      const git = fakeGit('refs/remotes/my/fork/feat/x', {
        origin: 'https://github.com/org/repo.git',
        my: 'git@github.com:other/repo.git',
        'my/fork': 'git@github.com:Me/repo.git',
      });
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([
          pr(3, 'feat/x', 'org'),
          pr(2, 'feat/x', 'me'),
          pr(1, 'feat/x', 'other'),
        ]),
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        exec: git.exec,
      });

      const result = await reader.read(root, 'feat/x');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') expect(result.pr.number).toBe(2);
    });

    it('prefers the open PR over a newer closed one', async () => {
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([
          pr(5, 'feat/y', 'org', 'CLOSED'),
          pr(4, 'feat/y', 'org', 'OPEN'),
        ]),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const result = await reader.read(root, 'feat/y');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.pr.number).toBe(4);
        expect(result.pr.state).toBe('OPEN');
      }
    });

    it('matches on the branch name alone when git cannot name an owner', async () => {
      const exec: GitWriteRunner = () => Promise.reject(new Error('git died'));
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([pr(8, 'feat/z', 'anyone')]),
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        exec,
        logger: mockLogger,
      });

      const result = await reader.read(root, 'feat/z');

      expect(result.status).toBe('ok');
      expect(warnLogs).toHaveLength(0);
    });

    it('finds its own PR behind more than ten newer fork PRs of the same head name (MIN-6)', async () => {
      const git = fakeGit(null, { origin: 'https://github.com/org/repo.git' });
      const forkPrs = Array.from({ length: 12 }, (_, index) =>
        pr(100 - index, 'main', `fork${index}`),
      );
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify([...forkPrs, pr(42, 'main', 'org')]),
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        exec: git.exec,
      });

      const result = await reader.read(root, 'main');

      expect(GH_PR_LIST_LIMIT).toBeGreaterThanOrEqual(50);
      expect(recordedRequests[0].args).toEqual(listArgs('main'));
      expect(result.status).toBe('ok');
      if (result.status === 'ok') expect(result.pr.number).toBe(42);
    });
  });

  describe('in-flight reads (MOD-2)', () => {
    it('drops a rejected run from the in-flight map so the next read spawns again (MIN-8)', async () => {
      nextProcessOptions = { exitCode: 1, stderr: 'boom' };
      // A logger that throws is the one way to make the read itself reject.
      const throwingLogger = {
        debug: () => {
          throw new Error('logger down');
        },
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as import('../../logging').Logger;
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        logger: throwingLogger,
      });

      await expect(reader.read(root, 'feat/reject')).rejects.toThrow(
        'logger down',
      );
      await expect(reader.read(root, 'feat/reject')).rejects.toThrow(
        'logger down',
      );
      expect(recordedRequests).toHaveLength(2);
    });

    it('does not cache a read that was running when invalidate was called', async () => {
      nextProcessOptions = {
        exitCode: 0,
        deferred: true,
        stdout: prList('feat/push', { number: 1, state: 'OPEN' }),
      };
      const reader = new GitHubPrStatusReader({
        spawner: fakeSpawner,
        now: () => 7_000_000,
      });

      const before = reader.read(root, 'feat/push');
      await new Promise((resolve) => setImmediate(resolve));
      expect(spawned).toHaveLength(1);

      reader.invalidate(root);
      spawned[0].release();
      expect((await before).status).toBe('ok');

      // The pre-invalidate result was not stored: this read asks gh again.
      nextProcessOptions = {
        exitCode: 0,
        stdout: prList('feat/push', { number: 1, state: 'OPEN' }),
      };
      await reader.read(root, 'feat/push');
      expect(recordedRequests).toHaveLength(2);
    });

    it('starts a fresh gh run for a read after invalidate instead of joining the old one', async () => {
      nextProcessOptions = {
        exitCode: 0,
        deferred: true,
        stdout: prList('feat/push', { number: 1, state: 'OPEN' }),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const before = reader.read(root, 'feat/push');
      await new Promise((resolve) => setImmediate(resolve));
      reader.invalidate();
      const after = reader.read(root, 'feat/push');
      await new Promise((resolve) => setImmediate(resolve));

      expect(spawned).toHaveLength(2);
      spawned.forEach((handle) => handle.release());
      await Promise.all([before, after]);
    });

    it('shares one gh run between concurrent reads of a branch', async () => {
      nextProcessOptions = {
        exitCode: 0,
        deferred: true,
        stdout: prList('feat/burst', { number: 3, state: 'OPEN' }),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const first = reader.read(root, 'feat/burst');
      const second = reader.read(root, 'feat/burst');
      await new Promise((resolve) => setImmediate(resolve));
      expect(spawned).toHaveLength(1);

      spawned[0].release();
      const [a, b] = await Promise.all([first, second]);
      expect(a).toEqual(b);
      expect(a.status).toBe('ok');
    });
  });

  describe('normalizers', () => {
    it('reads the owner from https, ssh and scp-style GitHub URLs', () => {
      expect(ownerFromRemoteUrl('https://github.com/Org/repo.git')).toBe('org');
      expect(ownerFromRemoteUrl('https://github.com/org/repo/')).toBe('org');
      expect(ownerFromRemoteUrl('ssh://git@github.com:22/me/repo')).toBe('me');
      expect(ownerFromRemoteUrl('git@github.com:me/repo.git')).toBe('me');
      expect(ownerFromRemoteUrl('https://github.com')).toBeNull();
      expect(ownerFromRemoteUrl('/srv/git/repo')).toBeNull();
      expect(ownerFromRemoteUrl('C:\\repos\\repo')).toBeNull();
    });

    it('closes the PR state and review decision to known values', () => {
      expect(normalizePrState('merged')).toBe('MERGED');
      expect(normalizePrState('DRAFTISH')).toBe('UNKNOWN');
      expect(normalizePrState(undefined)).toBe('UNKNOWN');
      expect(normalizeReviewDecision('approved')).toBe('APPROVED');
      expect(normalizeReviewDecision('')).toBeNull();
      expect(normalizeReviewDecision({ value: 'APPROVED' })).toBeNull();
      expect(normalizeReviewDecision(null)).toBeNull();
    });
  });
});
