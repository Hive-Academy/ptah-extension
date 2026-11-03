import { constants, promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type {
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
  readonly platformInfo: IPlatformInfo;
  readonly logger: Pick<Logger, 'warn'>;
}

/** Check both the supplied root and its physical directory before policy reads. */
export async function validateSessionPolicyRoot(
  root: string,
  workspaceProvider: IWorkspaceProvider,
  platformInfo: IPlatformInfo,
): Promise<string> {
  const unavailable = (cause?: unknown) => {
    const error = new RpcUserError(
      'Session policy root is unavailable.',
      'SESSION_FOLDER_UNAVAILABLE',
    );
    if (cause !== undefined) Object.assign(error, { cause });
    return error;
  };
  if (typeof root !== 'string' || !root.trim() || !isAbsolute(root))
    throw unavailable();
  const supplied = resolve(root);
  if (
    !isAuthorizedWorkspace(supplied, workspaceProvider) ||
    !isUnsafeWorkspacePath(supplied, platformInfo).ok
  )
    throw unavailable();
  try {
    const physical = await fs.realpath(supplied);
    const physicalStat = await fs.stat(physical);
    if (
      !isAuthorizedWorkspace(physical, workspaceProvider) ||
      !isUnsafeWorkspacePath(physical, platformInfo).ok ||
      !physicalStat.isDirectory()
    )
      throw unavailable();
    await fs.access(supplied, constants.R_OK | constants.X_OK);
    await fs.access(physical, constants.R_OK | constants.X_OK);
    return physical;
  } catch (error) {
    throw unavailable(error);
  }
}

/** A distinct saved cwd is authoritative; failure never redirects to its parent. */
export async function resolveSessionFolder({
  sessionId,
  metadataStore,
  workspaceProvider,
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
  const candidate = metadata.workingDirectory?.trim()
    ? metadata.workingDirectory
    : metadata.workspaceId;
  try {
    await validateSessionPolicyRoot(candidate, workspaceProvider, platformInfo);
    return candidate;
  } catch (error) {
    const cause =
      error instanceof Error && 'cause' in error ? error.cause : error;
    const rejection = cause instanceof Error ? cause : error;
    logger.warn('[RPC] session folder candidate rejected', {
      sessionId,
      candidate,
      code:
        rejection instanceof RpcUserError
          ? rejection.errorCode
          : rejection instanceof Error && 'code' in rejection
            ? String(rejection.code)
            : 'SESSION_FOLDER_UNAVAILABLE',
      message:
        rejection instanceof Error ? rejection.message : 'Unknown rejection',
    });
    throw new RpcUserError(
      "This session's folder is not available. Open its project folder and try again.",
      'SESSION_FOLDER_UNAVAILABLE',
    );
  }
}
