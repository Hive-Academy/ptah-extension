import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type {
  IFileSystemProvider,
  IPlatformInfo,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { isUnsafeWorkspacePath } from '@ptah-extension/platform-core';
import { RpcUserError, type Logger } from '@ptah-extension/vscode-core';

import { isAuthorizedWorkspace } from '../../utils/workspace-authorization';

export interface ResolveSessionFolderOptions {
  readonly sessionId: string;
  readonly metadataStore: Pick<SessionMetadataStore, 'get'>;
  readonly workspaceProvider: IWorkspaceProvider;
  readonly fileSystemProvider: IFileSystemProvider;
  readonly platformInfo: IPlatformInfo;
  readonly logger: Logger;
}

/**
 * The folder a session acts in: its saved cwd (a worktree for agent children),
 * else its project folder. Each must still be inside a registered folder, safe
 * and present.
 *
 * Never falls back to the active folder. A session that acts in whatever
 * folder happens to be open runs its tools in the wrong repo once more than
 * one project is open (PTAH-37).
 *
 * @throws RpcUserError SESSION_NOT_FOUND for an unknown id,
 *   SESSION_FOLDER_UNAVAILABLE when no saved folder passes the checks.
 */
export async function resolveSessionFolder({
  sessionId,
  metadataStore,
  workspaceProvider,
  fileSystemProvider,
  platformInfo,
  logger,
}: ResolveSessionFolderOptions): Promise<string> {
  const metadata = await metadataStore.get(sessionId);
  if (!metadata) {
    throw new RpcUserError(
      `Session not found: ${sessionId}`,
      'SESSION_NOT_FOUND',
    );
  }

  const candidates = [metadata.workingDirectory, metadata.workspaceId].filter(
    (path, index, all): path is string =>
      !!path?.trim() && all.indexOf(path) === index,
  );
  for (const candidate of candidates) {
    const rejection = await checkCandidate(
      candidate,
      workspaceProvider,
      fileSystemProvider,
      platformInfo,
    );
    if (!rejection) return candidate;
    logger.warn('[RPC] session folder candidate rejected', {
      sessionId,
      candidate,
      reason: rejection,
    });
  }

  throw new RpcUserError(
    "This session's folder is not available. Open its project folder and try again.",
    'SESSION_FOLDER_UNAVAILABLE',
  );
}

async function checkCandidate(
  candidate: string,
  workspaceProvider: IWorkspaceProvider,
  fileSystemProvider: IFileSystemProvider,
  platformInfo: IPlatformInfo,
): Promise<string | undefined> {
  if (!isAuthorizedWorkspace(candidate, workspaceProvider)) {
    return 'not inside a registered folder';
  }
  const safety = isUnsafeWorkspacePath(candidate, platformInfo);
  if (!safety.ok) return safety.reason;
  try {
    return (await fileSystemProvider.exists(candidate))
      ? undefined
      : 'does not exist';
  } catch (error: unknown) {
    return `could not be checked: ${error instanceof Error ? error.message : String(error)}`;
  }
}
