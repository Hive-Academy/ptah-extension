import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { SessionId } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkError, SessionNotActiveError } from '../errors';
import { SessionMetadataStore } from '../session-metadata-store';
import type { SessionHistoryReaderService } from '../session-history-reader.service';
import type {
  ForkSessionResult,
  RewindFilesResult,
} from '../types/sdk-types/claude-sdk.types';
import type { SessionLifecycleManager } from './session-lifecycle-manager';

export interface ForkSessionParams {
  sessionId: SessionId;
  upToMessageId?: string;
  title?: string;
}

export interface RewindFilesParams {
  sessionId: SessionId;
  userMessageId: string;
  dryRun?: boolean;
}

@injectable()
export class SessionForkService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  async forkSession(params: ForkSessionParams): Promise<ForkSessionResult> {
    const { sessionId, upToMessageId, title } = params;

    this.logger.info(`[SessionForkService] Forking session: ${sessionId}`, {
      upToMessageId,
      title,
    });

    try {
      const sdkModule = (await import('@anthropic-ai/claude-agent-sdk')) as {
        forkSession?: (
          sessionId: string,
          options?: { upToMessageId?: string; title?: string },
        ) => Promise<ForkSessionResult>;
      };
      const fork = sdkModule.forkSession;
      if (typeof fork !== 'function') {
        throw new SdkError(
          `SDK module loaded but 'forkSession' export is ${typeof fork}, expected function`,
        );
      }

      const sourceMetadata = await this.metadataStore.get(sessionId);

      let resolvedUpToMessageId: string | undefined = upToMessageId;
      if (upToMessageId !== undefined) {
        const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
        const forkWorkspacePath = sourceMetadata?.workspaceId ?? workspaceRoot;
        if (forkWorkspacePath) {
          resolvedUpToMessageId =
            await this.historyReader.resolveNativeMessageId(
              sessionId,
              forkWorkspacePath,
              upToMessageId,
            );
          if (resolvedUpToMessageId !== upToMessageId) {
            this.logger.info(
              '[SessionForkService] Resolved Ptah message ID to native SDK UUID for fork',
              {
                sessionId,
                originalUpToMessageId: upToMessageId,
                resolvedUpToMessageId,
              },
            );
          }
        }
      }

      const result = await fork(sessionId, {
        upToMessageId: resolvedUpToMessageId,
        title,
      });

      const forkName =
        title ??
        (sourceMetadata ? `${sourceMetadata.name} (fork)` : 'Forked session');

      const workspaceId =
        sourceMetadata?.workspaceId ??
        this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceId) {
        throw new SdkError(
          `Cannot fork session ${sessionId}: source metadata has no workspaceId and no active workspace folder is open. Forking would create a poisoned metadata record that the sidebar and authorization layer would reject.`,
        );
      }
      await this.metadataStore.create(
        result.sessionId,
        workspaceId,
        forkName,
        'forked',
      );

      this.logger.info('[SessionForkService] Session forked successfully', {
        sourceSessionId: sessionId,
        newSessionId: result.sessionId,
        upToMessageId,
        resolvedUpToMessageId,
        workspaceId,
        forkName,
      });
      return result;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.sentryService.captureException(errorObj, {
        errorSource: 'SdkAgentAdapter.forkSession',
      });
      this.logger.error(
        '[SessionForkService] Failed to fork session',
        errorObj,
      );
      throw new SdkError(
        `Failed to fork session ${sessionId}: ${errorObj.message}`,
      );
    }
  }

  async rewindFiles(params: RewindFilesParams): Promise<RewindFilesResult> {
    const { sessionId, userMessageId, dryRun } = params;

    this.logger.info(`[SessionForkService] Rewinding files for session`, {
      sessionId,
      userMessageId,
      dryRun: dryRun ?? false,
    });

    const rec = this.sessionLifecycle.find(sessionId as string);
    if (!rec || !rec.query) {
      throw new SessionNotActiveError(
        `Cannot rewind files: session ${sessionId} is not active or has no live Query handle. ` +
          `rewindFiles requires the session to be currently active in SessionLifecycleManager — ` +
          `resume the session before invoking rewind.`,
      );
    }

    try {
      const result = await rec.query.rewindFiles(userMessageId, {
        dryRun,
      });
      this.logger.info('[SessionForkService] rewindFiles completed', {
        sessionId,
        userMessageId,
        canRewind: result.canRewind,
        filesChanged: result.filesChanged?.length ?? 0,
        insertions: result.insertions,
        deletions: result.deletions,
        error: result.error,
      });
      return result;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.sentryService.captureException(errorObj, {
        errorSource: 'SdkAgentAdapter.rewindFiles',
      });
      this.logger.error('[SessionForkService] rewindFiles failed', errorObj);
      throw new SdkError(
        `Failed to rewind files for session ${sessionId}: ${errorObj.message}`,
      );
    }
  }
}
