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
import type { GitGenerateCommitMessageResult } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { GitWorkflowRpcHandlers } from './git-workflow-rpc.handlers';

type MockGitInfo = jest.Mocked<Pick<GitInfoService, 'cancelOperation'>>;
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
  it('owns and registers exactly the cancel and generate methods', () => {
    const { rpc } = buildSuite();

    expect(GitWorkflowRpcHandlers.METHODS).toEqual([
      'git:cancelOperation',
      'git:generateCommitMessage',
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
        getHandler(rpc, 'git:generateCommitMessage')({
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

      await getHandler(rpc, 'git:generateCommitMessage')({
        workspaceRoot: 'd:/repos/other/',
      });

      expect(generator.generate).toHaveBeenCalledWith('d:/repos/other/');
    });

    it('never reads an unregistered folder', async () => {
      const { rpc, generator } = buildSuite();

      await expect(
        getHandler(rpc, 'git:generateCommitMessage')({
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
});
