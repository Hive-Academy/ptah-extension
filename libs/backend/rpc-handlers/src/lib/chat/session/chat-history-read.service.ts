import { inject, injectable } from 'tsyringe';

import {
  SDK_TOKENS,
  type SessionHistoryReaderService,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  isUnsafeWorkspacePath,
  type IFileSystemProvider,
  type IPlatformInfo,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  HISTORY_PAGE_DEFAULT_EVENTS,
  resolveHistoryCursorEndIndex,
  selectHistoryPage,
  type ChatHistoryPageParams,
  type ChatHistoryPageResult,
  type SessionId,
} from '@ptah-extension/shared';
import {
  RpcUserError,
  TOKENS,
  type Logger,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';

import { isAuthorizedWorkspace } from '../../utils/workspace-authorization';

@injectable()
export class ChatHistoryReadService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystemProvider: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
  ) {}

  async readForResume(
    sessionId: SessionId,
    fallbackWorkspacePath: string,
    persistedPath?: string,
  ) {
    const resolvedWorkspacePath = await this.resolveResumeWorkingDirectory(
      persistedPath,
      fallbackWorkspacePath,
      sessionId,
    );
    const history = await this.historyReader.readSessionHistory(
      sessionId,
      resolvedWorkspacePath,
      { checkCompactionBoundary: true },
    );
    return { ...history, resolvedWorkspacePath };
  }

  async readPage(
    params: ChatHistoryPageParams,
  ): Promise<ChatHistoryPageResult> {
    const fallbackWorkspacePath =
      params.workspacePath || this.workspaceProvider.getWorkspaceRoot();
    if (!fallbackWorkspacePath) {
      throw new RpcUserError(
        'No workspace folder open. Please open a folder before resuming a chat session.',
        'WORKSPACE_NOT_OPEN',
      );
    }
    if (
      params.workspacePath &&
      !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
    ) {
      throw new RpcUserError(
        'Access denied: workspace path is not an open folder.',
        'UNAUTHORIZED_WORKSPACE',
      );
    }
    const safety = isUnsafeWorkspacePath(
      fallbackWorkspacePath,
      this.platformInfo,
    );
    if (!safety.ok) {
      throw new RpcUserError(
        `Cannot start a session in this folder: ${safety.reason}. Please open a real project folder.`,
        'UNAUTHORIZED_WORKSPACE',
      );
    }

    const metadata = await this.sessionMetadataStore.get(params.sessionId);
    const resolvedWorkspacePath = await this.resolveResumeWorkingDirectory(
      metadata?.workingDirectory,
      fallbackWorkspacePath,
      params.sessionId,
    );
    const events = await this.historyReader.readSessionEvents(
      params.sessionId,
      resolvedWorkspacePath,
    );
    const endIndex = resolveHistoryCursorEndIndex(events, params.cursor);
    const page = selectHistoryPage(events, {
      endIndex,
      maxEvents: params.maxEvents ?? HISTORY_PAGE_DEFAULT_EVENTS,
    });
    return {
      ...page,
      resumableSubagents: this.subagentRegistry.getResumableBySession(
        params.sessionId,
      ),
    };
  }

  /**
   * Resolve the SDK process cwd from durable session metadata before any JSONL
   * lookup. Invalid, unsafe, deleted, or unreadable paths use the caller's
   * authorized fallback workspace.
   */
  private async resolveResumeWorkingDirectory(
    persistedPath: string | undefined,
    fallbackPath: string,
    sessionId: string,
  ): Promise<string> {
    if (!persistedPath) return fallbackPath;
    if (!isAuthorizedWorkspace(persistedPath, this.workspaceProvider)) {
      this.logger.warn(
        '[RPC] chat:resume - persisted working directory is not authorized; using fallback',
        { sessionId, persistedPath, fallbackPath },
      );
      return fallbackPath;
    }
    const safety = isUnsafeWorkspacePath(persistedPath, this.platformInfo);
    if (!safety.ok) {
      this.logger.warn(
        '[RPC] chat:resume - persisted working directory is unsafe; using fallback',
        { sessionId, persistedPath, fallbackPath, reason: safety.reason },
      );
      return fallbackPath;
    }
    try {
      if (await this.fileSystemProvider.exists(persistedPath))
        return persistedPath;
    } catch (error: unknown) {
      this.logger.warn(
        '[RPC] chat:resume - persisted working directory could not be checked; using fallback',
        error instanceof Error ? error : new Error(String(error)),
      );
      return fallbackPath;
    }
    this.logger.warn(
      '[RPC] chat:resume - persisted working directory no longer exists; using fallback',
      { sessionId, persistedPath, fallbackPath },
    );
    return fallbackPath;
  }
}
