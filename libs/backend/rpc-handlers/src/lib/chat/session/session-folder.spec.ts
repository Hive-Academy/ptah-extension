import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import { resolveSessionFolder } from './session-folder';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_A = '/c/projects/a';
const PROJECT_B = '/c/projects/b';
const WORKTREE_B = `${PROJECT_B}/.claude/worktrees/task`;

function resolve(
  options: {
    folders?: string[];
    activeRoot?: string;
    metadata?: { workspaceId: string; workingDirectory?: string } | null;
    exists?: jest.Mock;
  } = {},
) {
  const workspaceProvider = createMockWorkspaceProvider({
    folders: options.folders ?? [PROJECT_A, PROJECT_B],
  });
  (workspaceProvider.getWorkspaceRoot as jest.Mock).mockReturnValue(
    options.activeRoot ?? PROJECT_A,
  );
  return resolveSessionFolder({
    sessionId: SESSION_ID,
    metadataStore: {
      get: jest
        .fn()
        .mockResolvedValue(
          options.metadata === undefined
            ? { workspaceId: PROJECT_B, workingDirectory: WORKTREE_B }
            : options.metadata,
        ),
    },
    workspaceProvider: workspaceProvider as unknown as IWorkspaceProvider,
    fileSystemProvider: {
      exists: options.exists ?? jest.fn().mockResolvedValue(true),
    } as never,
    platformInfo: {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    logger: createMockLogger() as unknown as Logger,
  });
}

describe('resolveSessionFolder', () => {
  it("uses the session's saved cwd, not the active folder", async () => {
    await expect(resolve({ activeRoot: PROJECT_A })).resolves.toBe(WORKTREE_B);
  });

  it('uses the project folder when the saved cwd is gone', async () => {
    const exists = jest.fn(async (path: string) => path !== WORKTREE_B);
    await expect(resolve({ exists })).resolves.toBe(PROJECT_B);
  });

  it('uses the project folder for records with no saved cwd', async () => {
    await expect(
      resolve({ metadata: { workspaceId: PROJECT_B } }),
    ).resolves.toBe(PROJECT_B);
  });

  it('rejects an unknown session id', async () => {
    await expect(resolve({ metadata: null })).rejects.toMatchObject({
      errorCode: 'SESSION_NOT_FOUND',
    });
  });

  it('never falls back to the active folder when no saved folder is open', async () => {
    await expect(
      resolve({ folders: [PROJECT_A], activeRoot: PROJECT_A }),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
  });

  it('skips an unsafe saved folder', async () => {
    await expect(
      resolve({
        folders: ['/tmp/ptah-app', PROJECT_B],
        metadata: { workspaceId: PROJECT_B, workingDirectory: '/tmp/ptah-app' },
      }),
    ).resolves.toBe(PROJECT_B);
  });

  it('skips a folder that cannot be checked', async () => {
    const exists = jest.fn(async (path: string) => {
      if (path === WORKTREE_B) throw new Error('EACCES');
      return true;
    });
    await expect(resolve({ exists })).resolves.toBe(PROJECT_B);
  });
});
