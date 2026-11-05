import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { createMockFileSystemProvider, createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { resolveResumeWorkingDirectory } from './resume-working-directory';

it('warns once for repeated missing persisted directories', async () => {
  const root = 'C:\\ptah-test';
  const missing = `${root}\\missing`;
  const fileSystemProvider = createMockFileSystemProvider();
  fileSystemProvider.exists.mockResolvedValue(false);
  const logger = createMockLogger();
  const options = {
    persistedPath: missing,
    fallbackPath: root,
    sessionId: 'session',
    workspaceProvider: createMockWorkspaceProvider({ folders: [root] }),
    fileSystemProvider,
    platformInfo: { type: 'electron', extensionPath: root, globalStoragePath: root, workspaceStoragePath: root } as IPlatformInfo,
    logger,
  };
  expect(await resolveResumeWorkingDirectory(options)).toBe(root);
  expect(await resolveResumeWorkingDirectory(options)).toBe(root);
  expect(logger.warn).toHaveBeenCalledTimes(1);
});
