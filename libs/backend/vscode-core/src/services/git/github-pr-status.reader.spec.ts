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
  GH_PR_VIEW_JSON_FIELDS,
  GitHubPrStatusReader,
  sanitizePrUrl,
  summarizeStatusCheckRollup,
} from './github-pr-status.reader';
import { GitInvalidRefError } from './git-ref-guard';

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

    if (!options.hang) {
      process.nextTick(() => {
        if (options.stdout) this.stdout.write(options.stdout);
        this.stdout.end();
        if (options.stderr) this.stderr.write(options.stderr);
        this.stderr.end();

        this.exitCode = options.exitCode ?? 0;
        this.emit('close', this.exitCode);
      });
    }
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
  let nextProcessOptions: FakeProcessOptions = {};

  const fakeSpawner: IProcessSpawner = {
    spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle {
      recordedRequests.push(request);
      return new FakeProcessHandle(nextProcessOptions);
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
    nextProcessOptions = {};
    debugLogs.length = 0;
    warnLogs.length = 0;
    errorLogs.length = 0;
  });

  describe('argv and env shape', () => {
    it('runs gh pr view with expected fields, safe branch after --, and non-interactive env', async () => {
      const samplePrJson = JSON.stringify({
        number: 42,
        title: 'Add feature',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'APPROVED',
        url: 'https://github.com/org/repo/pull/42',
        headRefName: 'feat/my-branch',
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

      // Verify argv has '--' before branch
      expect(req.args).toEqual([
        'pr',
        'view',
        '--json',
        GH_PR_VIEW_JSON_FIELDS,
        '--',
        'feat/my-branch',
      ]);

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
      const samplePrJson = JSON.stringify({
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
      expect(debugLogs.some((l) => l.msg.includes('Malformed JSON'))).toBe(
        true,
      );
    });

    it('handles unexpected JSON shapes defensively without throwing', async () => {
      nextProcessOptions = {
        exitCode: 0,
        stdout: JSON.stringify({ unexpected: 123 }),
      };
      const reader = new GitHubPrStatusReader({ spawner: fakeSpawner });

      const result = await reader.read(root, 'feat/x');
      expect(result).toEqual({
        status: 'ok',
        pr: {
          number: 0,
          title: '',
          state: 'OPEN',
          isDraft: false,
        },
        checks: {
          passing: 0,
          failing: 0,
          pending: 0,
          total: 0,
        },
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
      const samplePrJson = JSON.stringify({
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
      const samplePrJson = JSON.stringify({
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
  });

  describe('cross-spawn fallback', () => {
    it('spawns through cross-spawn when no spawner is injected and never uses shell: true', async () => {
      const fakeChild = new FakeProcessHandle({
        exitCode: 0,
        stdout: JSON.stringify({
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
      expect(args).toEqual([
        'pr',
        'view',
        '--json',
        GH_PR_VIEW_JSON_FIELDS,
        '--',
        'main',
      ]);
      expect(opts.cwd).toBe(root);
      expect(opts.shell).toBeUndefined(); // NEVER shell: true
      expect(opts.env).toMatchObject(GH_NON_INTERACTIVE_ENV);
      expect(result.status).toBe('ok');
    });
  });
});
