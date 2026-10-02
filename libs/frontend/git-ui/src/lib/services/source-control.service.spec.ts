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

  it('getOriginalContent calls git:showFile without mutation timeout', async () => {
    await service.getOriginalContent('src/app.ts');

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:showFile',
      { path: 'src/app.ts', workspaceRoot: '/test/workspace' },
    );
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
