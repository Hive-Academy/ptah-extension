import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { GIT_HOOK_TIMEOUT_MS, gitRpcTimeoutFor } from '@ptah-extension/shared';
import { GitStatusService } from './git-status.service';
import {
  COMMIT_MESSAGE_RPC_TIMEOUT_MS,
  SourceControlService,
} from './source-control.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

describe('SourceControlService', () => {
  let service: SourceControlService;
  const workspace = signal<string | null>('/test/workspace');
  const gitStatusMock = {
    activeWorkspacePath: workspace.asReadonly(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    workspace.set('/test/workspace');
    mockRpcCall.mockResolvedValue({ success: true, data: { success: true } });

    TestBed.configureTestingModule({
      providers: [
        SourceControlService,
        { provide: VSCodeService, useValue: {} },
        { provide: GitStatusService, useValue: gitStatusMock },
      ],
    });
    service = TestBed.inject(SourceControlService);
  });

  const EXPECTED_MUTATION_TIMEOUT = gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS);

  it('verifies MUTATION_RPC_TIMEOUT_MS equals 615_000 ms', () => {
    expect(EXPECTED_MUTATION_TIMEOUT).toBe(615_000);
  });

  it('stageFile passes MUTATION_RPC_TIMEOUT_MS and scoped workspace', async () => {
    await service.stageFile('src/app.ts');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:stage',
      { paths: ['src/app.ts'], workspaceRoot: '/test/workspace' },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });

  it('unstageFile passes MUTATION_RPC_TIMEOUT_MS and scoped workspace', async () => {
    await service.unstageFile('src/app.ts');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:unstage',
      { paths: ['src/app.ts'], workspaceRoot: '/test/workspace' },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });

  it('stageAll passes MUTATION_RPC_TIMEOUT_MS and scoped workspace with dot path', async () => {
    await service.stageAll();

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:stage',
      { paths: ['.'], workspaceRoot: '/test/workspace' },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });

  it('unstageAll passes MUTATION_RPC_TIMEOUT_MS and scoped workspace with dot path', async () => {
    await service.unstageAll();

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:unstage',
      { paths: ['.'], workspaceRoot: '/test/workspace' },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });

  it('discardChanges passes MUTATION_RPC_TIMEOUT_MS and scoped workspace', async () => {
    await service.discardChanges('src/app.ts');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:discard',
      { paths: ['src/app.ts'], workspaceRoot: '/test/workspace' },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });

  it('commit passes MUTATION_RPC_TIMEOUT_MS, commit message, and scoped workspace', async () => {
    await service.commit('feat: new feature');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:commit',
      { message: 'feat: new feature', workspaceRoot: '/test/workspace' },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });

  it('commit forwards an operationId when one is given', async () => {
    await service.commit('feat: x', 'op-1');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:commit',
      {
        message: 'feat: x',
        workspaceRoot: '/test/workspace',
        operationId: 'op-1',
      },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });

  it('cancelOperation sends only the operationId', async () => {
    await service.cancelOperation('op-1');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:cancelOperation',
      { operationId: 'op-1' },
    );
  });

  it('generateCommitMessage is scoped and waits 75 s', async () => {
    await service.generateCommitMessage();

    expect(COMMIT_MESSAGE_RPC_TIMEOUT_MS).toBe(75_000);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:generateCommitMessage',
      { workspaceRoot: '/test/workspace' },
      75_000,
    );
  });

  describe('operation abort/continue (TASK_2026_576 Batch 54)', () => {
    const FAILED = {
      status: 'failed',
      code: 'GIT_ERROR',
      error: 'Git did not answer. Check the repository and try again.',
    };

    it.each([
      ['abortOperation', 'git:operationAbort'],
      ['continueOperation', 'git:operationContinue'],
    ] as const)(
      '%s sends %s scoped, with the mutation timeout, and passes the result through',
      async (name, method) => {
        mockRpcCall.mockResolvedValueOnce({
          success: true,
          data: { status: 'completed', kind: 'rebase' },
        });

        await expect(service[name]()).resolves.toEqual({
          status: 'completed',
          kind: 'rebase',
        });
        expect(mockRpcCall).toHaveBeenCalledWith(
          expect.anything(),
          method,
          { workspaceRoot: '/test/workspace' },
          EXPECTED_MUTATION_TIMEOUT,
        );
      },
    );

    it('passes stopped and conflicts-remain through for continue', async () => {
      const stopped = {
        status: 'stopped',
        kind: 'rebase',
        conflictedPaths: ['a.ts'],
      };
      mockRpcCall.mockResolvedValueOnce({ success: true, data: stopped });
      await expect(service.continueOperation()).resolves.toEqual(stopped);

      mockRpcCall.mockResolvedValueOnce({
        success: true,
        data: { ...stopped, status: 'conflicts-remain' },
      });
      await expect(service.continueOperation()).resolves.toEqual({
        ...stopped,
        status: 'conflicts-remain',
      });
    });

    it('keeps the sanitized error, code and kind of a failure', async () => {
      const failed = {
        status: 'failed',
        kind: 'merge',
        code: 'LOCKED',
        error: 'Another git process is running.',
      };
      mockRpcCall.mockResolvedValueOnce({ success: true, data: failed });

      await expect(service.abortOperation()).resolves.toEqual(failed);
    });

    it.each([
      ['an RPC failure', { success: false, error: 'RPC timeout: x' }],
      ['an unknown status', { success: true, data: { status: 'odd' } }],
      ['a null payload', { success: true, data: null }],
      [
        'a completed reply without a kind',
        { success: true, data: { status: 'completed' } },
      ],
      [
        'a stopped reply without paths',
        { success: true, data: { status: 'stopped', kind: 'rebase' } },
      ],
    ])('reads %s as failed', async (_label, response) => {
      mockRpcCall.mockResolvedValueOnce(response);
      await expect(service.continueOperation()).resolves.toEqual(FAILED);
    });

    it('reads a stopped reply to abort as failed', async () => {
      mockRpcCall.mockResolvedValueOnce({
        success: true,
        data: { status: 'stopped', kind: 'rebase', conflictedPaths: [] },
      });
      await expect(service.abortOperation()).resolves.toEqual(FAILED);
    });

    it('reads a thrown transport error as failed', async () => {
      mockRpcCall.mockRejectedValueOnce(new Error('offline'));
      const spy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      await expect(service.abortOperation()).resolves.toEqual(FAILED);
      spy.mockRestore();
    });
  });

  it('omits workspaceRoot when activeWorkspacePath is null', async () => {
    workspace.set(null);

    await service.stageFile('file.txt');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:stage',
      { paths: ['file.txt'] },
      EXPECTED_MUTATION_TIMEOUT,
    );
  });
});
