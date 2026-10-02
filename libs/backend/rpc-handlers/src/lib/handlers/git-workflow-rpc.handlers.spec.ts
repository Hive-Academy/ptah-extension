/**
 * GitWorkflowRpcHandlers — unit specs (TASK_2026_576 Component 30).
 *
 * The streaming `git:commit` and its throttle are covered in
 * `git-rpc.handlers.spec.ts` and `git-operation-output.throttle.spec.ts`.
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts
 */

import 'reflect-metadata';

import {
  RpcUserError,
  type GitInfoService,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { CommitMessageGenerator } from '@ptah-extension/agent-sdk';
import type {
  GitGenerateCommitMessageResult,
  GitLogResult,
  GitOperationContinueResult,
  GitOperationFailed,
  GitPrStatusResult,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { GitWorkflowRpcHandlers } from './git-workflow-rpc.handlers';

type MockGitInfo = jest.Mocked<
  Pick<
    GitInfoService,
    | 'cancelOperation'
    | 'getBranches'
    | 'readPrStatus'
    | 'abortOperation'
    | 'continueOperation'
    | 'getLog'
  >
>;

const LOG_OK: GitLogResult = {
  status: 'ok',
  mode: 'since-base',
  base: 'origin/main',
  branch: 'feat/x',
  commits: [
    {
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      subject: 'feat: x',
      authorName: 'Dev',
      authorDate: '2026-10-01T10:00:00+00:00',
      parentCount: 1,
      isRoot: false,
    },
  ],
  truncated: false,
};

const OPEN_PR: GitPrStatusResult = {
  status: 'ok',
  pr: { number: 7, title: 'feat: x', state: 'OPEN', isDraft: false },
  checks: { passing: 2, failing: 0, pending: 1, total: 3 },
};
type MockGenerator = jest.Mocked<Pick<CommitMessageGenerator, 'generate'>>;

interface Suite {
  rpc: MockRpcHandler;
  gitInfo: MockGitInfo;
  generator: MockGenerator;
  logger: MockLogger;
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider({
    folders: ['/workspace', 'D:\\repos\\other'],
  });
  const gitInfo: MockGitInfo = {
    cancelOperation: jest.fn().mockReturnValue(true),
    getBranches: jest
      .fn()
      .mockResolvedValue({ current: 'feat/x', local: [], remote: [] }),
    readPrStatus: jest.fn().mockResolvedValue(OPEN_PR),
    abortOperation: jest
      .fn()
      .mockResolvedValue({ status: 'completed', kind: 'merge' }),
    continueOperation: jest
      .fn()
      .mockResolvedValue({ status: 'completed', kind: 'rebase' }),
    getLog: jest.fn().mockResolvedValue(LOG_OK),
  };
  const generator: MockGenerator = {
    generate: jest.fn().mockResolvedValue({
      status: 'generated',
      message: 'feat: x',
    }),
  };
  new GitWorkflowRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    workspace as unknown as IWorkspaceProvider,
    gitInfo as unknown as GitInfoService,
    generator as unknown as CommitMessageGenerator,
  ).register();
  return { rpc, gitInfo, generator, logger };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (params: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method '${method}' was not registered`);
  return match[1];
}

describe('GitWorkflowRpcHandlers', () => {
  it('owns and registers exactly the workflow methods', () => {
    const { rpc } = buildSuite();

    expect(GitWorkflowRpcHandlers.METHODS).toEqual([
      'git:cancelOperation',
      'git:generateCommitMessage',
      'git:prStatus',
      'git:operationAbort',
      'git:operationContinue',
      'git:log',
    ]);
    const registered = (rpc.registerMethod as jest.Mock).mock.calls.map(
      ([name]) => name as string,
    );
    expect(registered).toEqual([...GitWorkflowRpcHandlers.METHODS]);
  });

  describe('git:cancelOperation', () => {
    it.each([true, false])(
      'forwards the id and answers cancelled=%s',
      async (cancelled) => {
        const { rpc, gitInfo } = buildSuite();
        gitInfo.cancelOperation.mockReturnValueOnce(cancelled);

        await expect(
          getHandler(rpc, 'git:cancelOperation')({ operationId: 'op-1' }),
        ).resolves.toEqual({ cancelled });
        expect(gitInfo.cancelOperation).toHaveBeenCalledWith('op-1');
      },
    );

    it.each([
      ['no params', undefined],
      ['a missing id', {}],
      ['an empty id', { operationId: '' }],
      ['a non-token id', { operationId: 'op 1; rm' }],
      ['an oversized id', { operationId: 'x'.repeat(129) }],
      ['an unknown key', { operationId: 'op-1', force: true }],
    ])('rejects %s without cancelling anything', async (_label, params) => {
      const { rpc, gitInfo } = buildSuite();

      const call = getHandler(rpc, 'git:cancelOperation')(params);

      await expect(call).rejects.toBeInstanceOf(RpcUserError);
      await expect(call).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });
      expect(gitInfo.cancelOperation).not.toHaveBeenCalled();
    });
  });

  describe('git:generateCommitMessage', () => {
    it.each<GitGenerateCommitMessageResult>([
      { status: 'generated', message: 'fix: y\n\nbody' },
      { status: 'unavailable', reason: 'no-staged-changes' },
      { status: 'unavailable', reason: 'rate-limited' },
      { status: 'unavailable', reason: 'timeout' },
    ])('returns the generator result as is: %o', async (outcome) => {
      const { rpc, generator } = buildSuite();
      generator.generate.mockResolvedValueOnce(outcome);

      await expect(
        getHandler(
          rpc,
          'git:generateCommitMessage',
        )({
          workspaceRoot: '/workspace',
        }),
      ).resolves.toEqual(outcome);
      expect(generator.generate).toHaveBeenCalledWith('/workspace');
    });

    it('uses the active workspace when no folder is named', async () => {
      const { rpc, generator } = buildSuite();

      await getHandler(rpc, 'git:generateCommitMessage')(undefined);

      expect(generator.generate).toHaveBeenCalledWith('/workspace');
    });

    it('accepts a registered folder written with other separators and case', async () => {
      const { rpc, generator } = buildSuite();

      await getHandler(
        rpc,
        'git:generateCommitMessage',
      )({
        workspaceRoot: 'd:/repos/other/',
      });

      expect(generator.generate).toHaveBeenCalledWith('d:/repos/other/');
    });

    it('never reads an unregistered folder', async () => {
      const { rpc, generator } = buildSuite();

      await expect(
        getHandler(
          rpc,
          'git:generateCommitMessage',
        )({
          workspaceRoot: '/somewhere/else',
        }),
      ).resolves.toEqual({ status: 'unavailable', reason: 'unreachable' });
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown key', { workspaceRoot: '/workspace', model: 'opus' }],
      ['an empty workspaceRoot', { workspaceRoot: '' }],
      ['a non-string workspaceRoot', { workspaceRoot: 7 }],
    ])('rejects %s without calling the provider', async (_label, params) => {
      const { rpc, generator } = buildSuite();

      const call = getHandler(rpc, 'git:generateCommitMessage')(params);

      await expect(call).rejects.toBeInstanceOf(RpcUserError);
      await expect(call).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('turns an unexpected throw into unreachable, keeping the detail in the log', async () => {
      const { rpc, generator, logger } = buildSuite();
      generator.generate.mockRejectedValueOnce(
        new Error('secret internal detail'),
      );

      const result = await getHandler(rpc, 'git:generateCommitMessage')({});

      expect(result).toEqual({ status: 'unavailable', reason: 'unreachable' });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('git:prStatus', () => {
    it('reads the current branch itself and passes it to the reader', async () => {
      const { rpc, gitInfo } = buildSuite();

      await expect(
        getHandler(rpc, 'git:prStatus')({ workspaceRoot: '/workspace' }),
      ).resolves.toEqual(OPEN_PR);
      expect(gitInfo.getBranches).toHaveBeenCalledWith('/workspace', false);
      expect(gitInfo.readPrStatus).toHaveBeenCalledWith('/workspace', 'feat/x');
    });

    it('uses the active workspace when no folder is named', async () => {
      const { rpc, gitInfo } = buildSuite();

      await getHandler(rpc, 'git:prStatus')(undefined);

      expect(gitInfo.readPrStatus).toHaveBeenCalledWith('/workspace', 'feat/x');
    });

    it('returns an unavailable reason from the reader as is', async () => {
      const { rpc, gitInfo } = buildSuite();
      gitInfo.readPrStatus.mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'gh-missing',
      });

      await expect(getHandler(rpc, 'git:prStatus')({})).resolves.toEqual({
        status: 'unavailable',
        reason: 'gh-missing',
      });
    });

    it('answers no-pr on a detached HEAD without calling the reader', async () => {
      const { rpc, gitInfo } = buildSuite();
      gitInfo.getBranches.mockResolvedValueOnce({
        current: '',
        local: [],
        remote: [],
      });

      await expect(getHandler(rpc, 'git:prStatus')({})).resolves.toEqual({
        status: 'unavailable',
        reason: 'no-pr',
      });
      expect(gitInfo.readPrStatus).not.toHaveBeenCalled();
    });

    it('turns a reader throw into failed, keeping the detail in the log', async () => {
      const { rpc, gitInfo, logger } = buildSuite();
      gitInfo.readPrStatus.mockRejectedValueOnce(
        new Error('secret internal detail'),
      );

      const result = await getHandler(rpc, 'git:prStatus')({});

      expect(result).toEqual({ status: 'unavailable', reason: 'failed' });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(logger.error).toHaveBeenCalled();
    });

    it('never reads an unregistered folder', async () => {
      const { rpc, gitInfo, logger } = buildSuite();

      await expect(
        getHandler(rpc, 'git:prStatus')({ workspaceRoot: '/somewhere/else' }),
      ).resolves.toEqual({ status: 'unavailable', reason: 'failed' });
      expect(gitInfo.getBranches).not.toHaveBeenCalled();
      expect(gitInfo.readPrStatus).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it.each([
      [
        'a client-supplied branch',
        { workspaceRoot: '/workspace', branch: 'x' },
      ],
      ['an empty workspaceRoot', { workspaceRoot: '' }],
      ['a non-string workspaceRoot', { workspaceRoot: 7 }],
    ])('rejects %s without reading anything', async (_label, params) => {
      const { rpc, gitInfo } = buildSuite();

      const call = getHandler(rpc, 'git:prStatus')(params);

      await expect(call).rejects.toBeInstanceOf(RpcUserError);
      await expect(call).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });
      expect(gitInfo.getBranches).not.toHaveBeenCalled();
      expect(gitInfo.readPrStatus).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['git:operationAbort', 'abortOperation'],
    ['git:operationContinue', 'continueOperation'],
  ] as const)('%s', (method, serviceMethod) => {
    it('acts on the named registered folder and returns the result as is', async () => {
      const { rpc, gitInfo } = buildSuite();
      const failed: GitOperationFailed = {
        status: 'failed',
        kind: 'rebase',
        code: 'HOOK_FAILED',
        error: 'A hook rejected the step.',
      };
      gitInfo[serviceMethod].mockResolvedValueOnce(failed);

      await expect(
        getHandler(rpc, method)({ workspaceRoot: 'd:/repos/other/' }),
      ).resolves.toEqual(failed);
      expect(gitInfo[serviceMethod]).toHaveBeenCalledWith('d:/repos/other/');
    });

    it('uses the active workspace when no folder is named', async () => {
      const { rpc, gitInfo } = buildSuite();

      await getHandler(rpc, method)(undefined);

      expect(gitInfo[serviceMethod]).toHaveBeenCalledWith('/workspace');
    });

    it('never acts on an unregistered folder', async () => {
      const { rpc, gitInfo, logger } = buildSuite();

      await expect(
        getHandler(rpc, method)({ workspaceRoot: '/somewhere/else' }),
      ).resolves.toEqual({
        status: 'failed',
        code: 'GIT_ERROR',
        error: 'No registered workspace folder to act on.',
      });
      expect(gitInfo[serviceMethod]).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it.each([
      ['a client-supplied kind', { workspaceRoot: '/workspace', kind: 'merge' }],
      ['an empty workspaceRoot', { workspaceRoot: '' }],
      ['a non-string workspaceRoot', { workspaceRoot: 7 }],
    ])('rejects %s without running git', async (_label, params) => {
      const { rpc, gitInfo } = buildSuite();

      const call = getHandler(rpc, method)(params);

      await expect(call).rejects.toBeInstanceOf(RpcUserError);
      await expect(call).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });
      expect(gitInfo[serviceMethod]).not.toHaveBeenCalled();
    });

    it('turns a throw into fixed copy, keeping the raw message in the log', async () => {
      const { rpc, gitInfo, logger } = buildSuite();
      gitInfo[serviceMethod].mockRejectedValueOnce(
        new Error('fatal: C:\\Users\\me\\secret\\.git/index.lock'),
      );

      const result = await getHandler(rpc, method)({});

      expect(result).toEqual({
        status: 'failed',
        code: 'GIT_ERROR',
        error: 'Git could not complete the action.',
      });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('git:operationContinue results', () => {
    it.each<GitOperationContinueResult>([
      { status: 'no-operation' },
      { status: 'conflicts-remain', kind: 'merge', conflictedPaths: ['a.ts'] },
      { status: 'stopped', kind: 'rebase', conflictedPaths: ['b.ts'] },
    ])('passes %o through unchanged', async (outcome) => {
      const { rpc, gitInfo } = buildSuite();
      gitInfo.continueOperation.mockResolvedValueOnce(outcome);

      await expect(
        getHandler(rpc, 'git:operationContinue')({}),
      ).resolves.toEqual(outcome);
    });
  });

  describe('git:log', () => {
    it('returns the reader result for the named registered folder', async () => {
      const { rpc, gitInfo } = buildSuite();

      await expect(
        getHandler(rpc, 'git:log')({ workspaceRoot: '/workspace' }),
      ).resolves.toEqual(LOG_OK);
      expect(gitInfo.getLog).toHaveBeenCalledWith('/workspace');
    });

    it('uses the active workspace when no folder is named', async () => {
      const { rpc, gitInfo } = buildSuite();

      await getHandler(rpc, 'git:log')(undefined);

      expect(gitInfo.getLog).toHaveBeenCalledWith('/workspace');
    });

    it('returns an unavailable reason from the reader as is', async () => {
      const { rpc, gitInfo } = buildSuite();
      gitInfo.getLog.mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'not-a-repository',
      });

      await expect(getHandler(rpc, 'git:log')({})).resolves.toEqual({
        status: 'unavailable',
        reason: 'not-a-repository',
      });
    });

    it('turns a reader throw into git-failed, keeping the detail in the log', async () => {
      const { rpc, gitInfo, logger } = buildSuite();
      gitInfo.getLog.mockRejectedValueOnce(new Error('secret internal detail'));

      const result = await getHandler(rpc, 'git:log')({});

      expect(result).toEqual({ status: 'unavailable', reason: 'git-failed' });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(logger.error).toHaveBeenCalled();
    });

    it('never reads an unregistered folder', async () => {
      const { rpc, gitInfo, logger } = buildSuite();

      await expect(
        getHandler(rpc, 'git:log')({ workspaceRoot: '/somewhere/else' }),
      ).resolves.toEqual({ status: 'unavailable', reason: 'not-a-repository' });
      expect(gitInfo.getLog).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it.each([
      ['a client-supplied base', { workspaceRoot: '/workspace', base: 'main' }],
      ['an empty workspaceRoot', { workspaceRoot: '' }],
      ['a non-string workspaceRoot', { workspaceRoot: 7 }],
    ])('rejects %s without reading anything', async (_label, params) => {
      const { rpc, gitInfo } = buildSuite();

      const call = getHandler(rpc, 'git:log')(params);

      await expect(call).rejects.toBeInstanceOf(RpcUserError);
      await expect(call).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });
      expect(gitInfo.getLog).not.toHaveBeenCalled();
    });
  });
});
