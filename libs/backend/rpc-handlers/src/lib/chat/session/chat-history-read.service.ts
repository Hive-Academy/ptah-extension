import { inject, injectable } from 'tsyringe';

import {
  SDK_TOKENS,
  SessionHistoryRouteError,
  type SessionHistoryRouter,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
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
  type RpcUserErrorCode,
} from '@ptah-extension/shared';
import {
  TOKENS,
  RpcUserError,
  type Logger,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';

import { resolveSessionFolder } from './session-folder';

/** Keep host errors and native text out of both resume and page responses. */
export function nativeHistoryRpcError(error: unknown): RpcUserError | null {
  let code: string | undefined;
  if (error instanceof SessionHistoryRouteError) code = error.code;
  else if (
    error instanceof Error &&
    error.name === 'ElectronCodexHistoryError' &&
    'code' in error &&
    typeof error.code === 'string'
  ) code = error.code;
  if (code === undefined) return null;

  const mapped: Record<string, [RpcUserErrorCode, string]> = {
    nativePortUnavailable: ['HISTORY_UNAVAILABLE', 'Session history is unavailable in this host.'],
    invalidNativeIdentity: ['HISTORY_UNAVAILABLE', 'Saved session identity is incomplete.'],
    invalidIdentity: ['HISTORY_UNAVAILABLE', 'Saved session identity is incomplete.'],
    homeMismatch: ['HISTORY_UNAVAILABLE', 'The saved session belongs to a different home.'],
    binaryUnavailable: ['HISTORY_UNAVAILABLE', 'The history reader is unavailable.'],
    pathUnavailable: ['HISTORY_UNAVAILABLE', 'The saved session location is unavailable.'],
    threadNotFound: ['HISTORY_NOT_FOUND', 'The saved session history could not be found.'],
    busy: ['HISTORY_BUSY', 'Too many history reads are in progress. Try again.'],
    timeout: ['HISTORY_TIMEOUT', 'Reading session history timed out. Try again.'],
    cancelled: ['HISTORY_CANCELLED', 'Reading session history was cancelled.'],
    runtimeFailed: ['HISTORY_FAILED', 'Session history could not be read.'],
    nativeReadFailed: ['HISTORY_FAILED', 'Session history could not be read.'],
  };
  const result = Object.hasOwn(mapped, code)
    ? mapped[code]
    : mapped['nativeReadFailed'];
  return new RpcUserError(result[1], result[0]);
}

@injectable()
export class ChatHistoryReadService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'warn'>,
    @inject(SDK_TOKENS.SESSION_HISTORY_ROUTER)
    private readonly historyRouter: SessionHistoryRouter,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: Pick<SessionMetadataStore, 'get'>,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: Pick<SubagentRegistryService, 'getResumableBySession'>,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { isOptional: true })
    private readonly sessionLifecycle?: {
      find(id: string): { realSessionId?: string } | undefined;
    },
  ) {}

  /** The folder this session acts in. See {@link resolveSessionFolder}. */
  resolveSessionFolder(sessionId: SessionId): Promise<string> {
    return resolveSessionFolder({
      // A live session can still be addressed by its tab id (the CLI keeps it
      // when a turn ends before the SDK reports the real id); metadata is keyed
      // by the real id.
      sessionId:
        this.sessionLifecycle?.find(sessionId)?.realSessionId || sessionId,
      metadataStore: this.sessionMetadataStore,
      workspaceProvider: this.workspaceProvider,
      platformInfo: this.platformInfo,
      logger: this.logger,
    });
  }

  async readForResume(
    sessionId: SessionId,
    options?: { includeBlockOwners?: boolean },
  ) {
    const resolvedWorkspacePath = await this.resolveSessionFolder(sessionId);
    let history: Awaited<ReturnType<SessionHistoryRouter['readSessionHistory']>>;
    try {
      history = await this.historyRouter.readSessionHistory(
        sessionId,
        resolvedWorkspacePath,
        {
          checkCompactionBoundary: true,
          ...(options?.includeBlockOwners ? { includeBlockOwners: true } : {}),
        },
      );
    } catch (error: unknown) {
      throw nativeHistoryRpcError(error) ?? error;
    }
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
    let events: Awaited<ReturnType<SessionHistoryRouter['readSessionEvents']>>;
    try {
      events = await this.historyRouter.readSessionEvents(
        params.sessionId,
        resolvedWorkspacePath,
      );
    } catch (error: unknown) {
      throw nativeHistoryRpcError(error) ?? error;
    }
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
