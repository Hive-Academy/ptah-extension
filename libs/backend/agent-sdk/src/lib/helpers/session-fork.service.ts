import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { SessionId, MessageAnchorHint } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkError, SessionNotActiveError } from '../errors';
import { SessionMetadataStore } from '../session-metadata-store';
import { MESSAGE_ID_NOT_FOUND_PHRASE } from '../session-history-reader.service';
import type { SessionHistoryReaderService } from '../session-history-reader.service';
import type {
  ForkSessionResult,
  RewindFilesResult,
} from '../types/sdk-types/claude-sdk.types';
import type { SessionLifecycleManager } from './session-lifecycle-manager';

export interface ForkSessionParams {
  sessionId: SessionId;
  upToMessageId?: string;
  /**
   * Fallback hint for resolving `upToMessageId` to a transcript line UUID when
   * the frontend passed a client-only optimistic id. See {@link MessageAnchorHint}.
   */
  anchorHint?: MessageAnchorHint;
  title?: string;
  /**
   * Semantic hint that drives the auto-derived fork title when no explicit
   * `title` is supplied. `'rewind'` → `"<original> (rewind)"`; anything else
   * (including `undefined`) preserves the legacy `"<original> (fork)"`.
   */
  kind?: 'rewind' | 'branch';
}

export interface RewindFilesParams {
  sessionId: SessionId;
  userMessageId: string;
  /**
   * Fallback hint for resolving `userMessageId` to a transcript line UUID when
   * the frontend passed a client-only optimistic id. See {@link MessageAnchorHint}.
   */
  anchorHint?: MessageAnchorHint;
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
    const { sessionId, upToMessageId, anchorHint, title, kind } = params;

    this.logger.info(`[SessionForkService] Forking session: ${sessionId}`, {
      upToMessageId,
      title,
    });

    try {
      const sdkModule = (await import('@anthropic-ai/claude-agent-sdk')) as {
        forkSession?: (
          sessionId: string,
          options?: { upToMessageId?: string; title?: string; dir?: string },
        ) => Promise<ForkSessionResult>;
      };
      const fork = sdkModule.forkSession;
      if (typeof fork !== 'function') {
        throw new SdkError(
          `SDK module loaded but 'forkSession' export is ${typeof fork}, expected function`,
        );
      }

      const sourceMetadata = await this.metadataStore.get(sessionId);
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      const forkWorkspacePath = sourceMetadata?.workspaceId ?? workspaceRoot;

      let resolvedUpToMessageId: string | undefined = upToMessageId;
      if (upToMessageId !== undefined && forkWorkspacePath) {
        resolvedUpToMessageId = await this.historyReader.resolveNativeMessageId(
          sessionId,
          forkWorkspacePath,
          upToMessageId,
          anchorHint,
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

      const result = await fork(sessionId, {
        upToMessageId: resolvedUpToMessageId,
        title,
        // Pin the project directory so the SDK reads the same transcript the
        // resolver validated against, instead of relying on a global scan.
        ...(forkWorkspacePath ? { dir: forkWorkspacePath } : {}),
      });

      const suffix = kind === 'rewind' ? '(rewind)' : '(fork)';
      const forkName =
        title ??
        (sourceMetadata
          ? `${sourceMetadata.name} ${suffix}`
          : 'Forked session');

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
      // An unresolvable anchor is an expected user-facing condition (e.g. the
      // message could not be located in the transcript), not an infrastructure
      // fault — surface it without polluting Sentry.
      const isUnresolvableAnchor = errorObj.message.includes(
        MESSAGE_ID_NOT_FOUND_PHRASE,
      );
      if (!isUnresolvableAnchor) {
        this.sentryService.captureException(errorObj, {
          errorSource: 'SdkAgentAdapter.forkSession',
        });
      }
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
    const { sessionId, userMessageId, anchorHint, dryRun } = params;

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

    // `Query.rewindFiles` expects the user message's transcript line UUID. A
    // live user bubble carries a client-only optimistic id, so resolve it the
    // same way fork does. Best-effort: if resolution fails (e.g. the line is
    // not yet flushed), fall back to the raw id rather than blocking the rewind.
    const sourceMetadata = await this.metadataStore.get(sessionId);
    const rewindWorkspacePath =
      sourceMetadata?.workspaceId ?? this.workspaceProvider.getWorkspaceRoot();
    let resolvedUserMessageId = userMessageId;
    if (rewindWorkspacePath) {
      try {
        resolvedUserMessageId = await this.historyReader.resolveNativeMessageId(
          sessionId,
          rewindWorkspacePath,
          userMessageId,
          anchorHint,
        );
        if (resolvedUserMessageId !== userMessageId) {
          this.logger.info(
            '[SessionForkService] Resolved rewind userMessageId to native SDK UUID',
            { sessionId, userMessageId, resolvedUserMessageId },
          );
        }
      } catch (resolveError) {
        this.logger.warn(
          '[SessionForkService] Could not resolve rewind userMessageId; using raw id',
          {
            sessionId,
            userMessageId,
            reason:
              resolveError instanceof Error
                ? resolveError.message
                : String(resolveError),
          },
        );
      }
    }

    try {
      const result = await rec.query.rewindFiles(resolvedUserMessageId, {
        dryRun,
      });
      this.logger.info('[SessionForkService] rewindFiles completed', {
        sessionId,
        userMessageId: resolvedUserMessageId,
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
