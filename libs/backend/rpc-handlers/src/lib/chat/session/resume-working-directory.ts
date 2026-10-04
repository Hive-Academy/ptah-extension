import type {
  IFileSystemProvider,
  IPlatformInfo,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { isUnsafeWorkspacePath } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

import { isAuthorizedWorkspace } from '../../utils/workspace-authorization';

interface ResumeWorkingDirectoryOptions {
  readonly persistedPath: string | undefined;
  readonly fallbackPath: string;
  readonly sessionId: string;
  readonly workspaceProvider: IWorkspaceProvider;
  readonly fileSystemProvider: IFileSystemProvider;
  readonly platformInfo: IPlatformInfo;
  readonly logger: Logger;
}

/**
 * Resolve the SDK cwd from metadata only when it remains a safe, authorized,
 * existing path. Otherwise the caller's authorized workspace is the resume
 * location.
 */
export async function resolveResumeWorkingDirectory({
  persistedPath,
  fallbackPath,
  sessionId,
  workspaceProvider,
  fileSystemProvider,
  platformInfo,
  logger,
}: ResumeWorkingDirectoryOptions): Promise<string> {
  if (!persistedPath) return fallbackPath;
  if (!isAuthorizedWorkspace(persistedPath, workspaceProvider)) {
    logger.warn(
      '[RPC] chat:resume - persisted working directory is not authorized; using fallback',
      { sessionId, persistedPath, fallbackPath },
    );
    return fallbackPath;
  }
  const safety = isUnsafeWorkspacePath(persistedPath, platformInfo);
  if (!safety.ok) {
    logger.warn(
      '[RPC] chat:resume - persisted working directory is unsafe; using fallback',
      { sessionId, persistedPath, fallbackPath, reason: safety.reason },
    );
    return fallbackPath;
  }
  try {
    if (await fileSystemProvider.exists(persistedPath)) return persistedPath;
  } catch (error: unknown) {
    logger.warn(
      '[RPC] chat:resume - persisted working directory could not be checked; using fallback',
      error instanceof Error ? error : new Error(String(error)),
    );
    return fallbackPath;
  }
  logger.warn(
    '[RPC] chat:resume - persisted working directory no longer exists; using fallback',
    { sessionId, persistedPath, fallbackPath },
  );
  return fallbackPath;
}
