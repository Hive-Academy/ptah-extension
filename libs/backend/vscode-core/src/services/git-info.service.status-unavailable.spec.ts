/**
 * GitInfoService — reasoned `statusUnavailable` and the tri-state repository
 * probe (TASK_2026_576 RC3).
 *
 * A slow, locked or broken git used to read as "not a repository" (the probe
 * collapsed every failure to `false`) or as a clean tree (a failed status
 * returned an empty list). Both made the UI drop the user's changes. These
 * specs pin the replacement: only git's own "not a git repository" answer is
 * `isGitRepo: false`; every other failure is `isGitRepo: true` with an empty
 * list and a reason the renderer can show next to the last good list.
 *
 * The private `execGit` seam is replaced per spec, so no git binary runs.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 */

import 'reflect-metadata';

import { GitInfoService } from './git-info.service';
import { GitTimeoutError } from '../utils/exec-git';

type ExecResult = { stdout: string; stderr: string; exitCode: number };
type Answer = ExecResult | Error;

interface ExecGitSeam {
  execGit(args: string[], cwd: string, options?: unknown): Promise<ExecResult>;
}

const WS = '/fake/workspace';
const EMPTY_BRANCH = { branch: '', upstream: null, ahead: 0, behind: 0 };
const LOCK_STDERR =
  "fatal: Unable to create '/fake/workspace/.git/index.lock': File exists.\n";

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const ok = (stdout: string): ExecResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
});
const fail = (exitCode: number, stderr: string): ExecResult => ({
  stdout: '',
  stderr,
  exitCode,
});

/** A service whose git answers come from `answers`, keyed by verb. */
function serviceAnswering(answers: { 'rev-parse': Answer; status?: Answer }): {
  service: GitInfoService;
  logger: ReturnType<typeof makeLogger>;
} {
  const logger = makeLogger();
  const service = new GitInfoService(logger as never);
  jest
    .spyOn(service as unknown as ExecGitSeam, 'execGit')
    .mockImplementation(async (args: string[]) => {
      const answer =
        args[0] === 'rev-parse'
          ? answers['rev-parse']
          : args[0] === 'status'
            ? (answers.status ?? ok('# branch.head main\0'))
            : ok('');
      if (answer instanceof Error) throw answer;
      return answer;
    });
  return { service, logger };
}

describe('GitInfoService — tri-state repository probe (RC3)', () => {
  it('reports "not a repository" only for git\'s own exit-128 answer', async () => {
    const { service } = serviceAnswering({
      'rev-parse': fail(
        128,
        'fatal: not a git repository (or any of the parent directories): .git\n',
      ),
    });

    await expect(service.getGitInfo(WS)).resolves.toEqual({
      isGitRepo: false,
      branch: EMPTY_BRANCH,
      files: [],
    });
    await expect(service.isGitRepo(WS)).resolves.toBe(false);
  });

  it('reports "not a repository" when git answers false (inside .git)', async () => {
    const { service } = serviceAnswering({ 'rev-parse': ok('false\n') });

    const info = await service.getGitInfo(WS);

    expect(info.isGitRepo).toBe(false);
    expect(info.statusUnavailable).toBeUndefined();
  });

  it.each<[string, Answer, string]>([
    ['a probe timeout', new GitTimeoutError('rev-parse', 10_000), 'timeout'],
    ['a missing git binary', new Error('spawn git ENOENT'), 'error'],
    [
      'an exit 128 that is not "not a repository"',
      fail(128, 'fatal: detected dubious ownership in repository\n'),
      'error',
    ],
    ['an unexpected exit code', fail(1, 'boom\n'), 'error'],
    ['a lock failure', fail(128, LOCK_STDERR), 'locked'],
  ])(
    'never reports isGitRepo:false for %s',
    async (_label, probeAnswer, reason) => {
      const { service, logger } = serviceAnswering({
        'rev-parse': probeAnswer,
      });

      await expect(service.getGitInfo(WS)).resolves.toEqual({
        isGitRepo: true,
        branch: EMPTY_BRANCH,
        files: [],
        statusUnavailable: reason,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`gave no answer (${reason})`),
      );
      // The public boolean keeps its contract: only a definite yes is true.
      await expect(service.isGitRepo(WS)).resolves.toBe(false);
    },
  );

  it('isGitRepo() is true for a definite yes', async () => {
    const { service } = serviceAnswering({ 'rev-parse': ok('true\n') });

    await expect(service.isGitRepo(WS)).resolves.toBe(true);
  });
});

describe('GitInfoService — reasoned statusUnavailable (RC3)', () => {
  it.each<[string, Answer, string]>([
    ['a status timeout', new GitTimeoutError('status', 10_000), 'timeout'],
    ['a thrown spawn error', new Error('spawn git EACCES'), 'error'],
    ['a non-zero exit', fail(128, 'fatal: index file corrupt\n'), 'error'],
    ['a held index.lock', fail(128, LOCK_STDERR), 'locked'],
  ])(
    'maps %s to an empty list with a reason',
    async (_label, statusAnswer, reason) => {
      const { service } = serviceAnswering({
        'rev-parse': ok('true\n'),
        status: statusAnswer,
      });

      await expect(service.getGitInfo(WS)).resolves.toEqual({
        isGitRepo: true,
        branch: EMPTY_BRANCH,
        files: [],
        statusUnavailable: reason,
      });
    },
  );

  it('logs a thrown status failure with the workspace and the cause', async () => {
    const { service, logger } = serviceAnswering({
      'rev-parse': ok('true\n'),
      status: new GitTimeoutError('status', 10_000),
    });

    await service.getGitInfo(WS);

    const [message, error] = logger.error.mock.calls[0];
    expect(message).toContain(WS);
    expect(message).toContain('git status timed out after 10000ms');
    expect(error).toBeInstanceOf(GitTimeoutError);
  });

  it('a readable status carries no reason', async () => {
    const { service } = serviceAnswering({
      'rev-parse': ok('true\n'),
      status: ok('# branch.head main\0? new.txt\0'),
    });

    const info = await service.getGitInfo(WS);

    expect(info.statusUnavailable).toBeUndefined();
    expect(info.branch.branch).toBe('main');
    expect(info.files).toHaveLength(1);
  });
});
