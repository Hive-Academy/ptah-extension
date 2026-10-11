import { inject, injectable } from 'tsyringe';

import {
  SDK_TOKENS,
  type SessionHistoryReaderService,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
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
  TOKENS,
  type Logger,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';

import { resolveSessionFolder } from './session-folder';

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

  /** The folder this session acts in. See {@link resolveSessionFolder}. */
  resolveSessionFolder(sessionId: SessionId): Promise<string> {
    return resolveSessionFolder({
      sessionId,
      metadataStore: this.sessionMetadataStore,
      workspaceProvider: this.workspaceProvider,
      fileSystemProvider: this.fileSystemProvider,
      platformInfo: this.platformInfo,
      logger: this.logger,
    });
  }

  async readForResume(sessionId: SessionId) {
    const resolvedWorkspacePath = await this.resolveSessionFolder(sessionId);
    const history = await this.historyReader.readSessionHistory(
      sessionId,
      resolvedWorkspacePath,
      { checkCompactionBoundary: true },
    );
    return { ...history, resolvedWorkspacePath };
  }

  /**
   * `params.workspacePath` is ignored: the page is read from the session's own
   * folder, whatever folder the caller has open.
   */
  async readPage(
    params: ChatHistoryPageParams,
  ): Promise<ChatHistoryPageResult> {
    const resolvedWorkspacePath = await this.resolveSessionFolder(
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
}
