/**
 * Chat stream broadcaster.
 *
 * Owns the webview broadcast loop (`streamEventsToWebview`). Moves
 * byte-identically from `chat-rpc.handlers.ts`. The streaming lifecycle
 * preserves:
 *
 *   - `streamExitedNormally` cleanup gate.
 *   - `isUserAbort` substring match (`'aborted by user' | 'abort' | 'cancelled' | 'canceled'`).
 *   - `isCorruptedResume` cleanup path (`eventCount === 0 && !isUserAbort`).
 *   - Every `MESSAGE_TYPES.CHAT_*` payload shape.
 *   - Ptah-CLI child-session metadata save.
 *   - Background-agent registration on `background_agent_started` events.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SessionMetadataStore } from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  IAgentAdapter,
  SessionId,
  FlatStreamEventUnion,
  BackgroundAgentStartedEvent,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatPtahCliService } from '../ptah-cli/chat-ptah-cli.service';

export interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class ChatStreamBroadcaster {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(CHAT_TOKENS.PTAH_CLI)
    private readonly ptahCli: ChatPtahCliService,
  ) {}

  private readonly streamingSessionIds = new Set<string>();

  isStreaming(sessionId: string): boolean {
    return this.streamingSessionIds.has(sessionId);
  }

  /**
   * Stream flat events to webview
   * Handles SDK AsyncIterable<FlatStreamEventUnion> → webview messages.
   *
   * The webview rebuilds ExecutionNode trees at render time from these flat events.
   * Events include tabId for routing and sessionId (real SDK UUID) for storage.
   *
   * IMPORTANT: With streaming input mode, the for-await-of loop may never complete
   * because SDK keeps the session open for multi-turn. We must send chat:complete
   * on message_complete event for proper turn-level completion.
   */
  async streamEventsToWebview(
    sessionId: SessionId,
    stream: AsyncIterable<FlatStreamEventUnion>,
    tabId: string,
    surfaceMode?: boolean,
  ): Promise<void> {
    this.logger.info(
      `[RPC] streamExecutionNodesToWebview STARTED for session ${sessionId}, tabId ${tabId}`,
    );
    let eventCount = 0;
    let turnCompleteSent = false;
    let childMetadataSaved = false;
    const isPtahCliSession = this.ptahCli.hasSession(tabId);
    let streamExitedNormally = false;

    this.streamingSessionIds.add(sessionId as string);
    try {
      for await (const event of stream) {
        eventCount++;
        this.logger.debug(
          `[RPC] Streaming event #${eventCount} type=${event.eventType} to webview`,
          {
            sessionId,
            tabId,
            eventType: event.eventType,
            messageId: event.messageId,
          },
        );
        if (
          isPtahCliSession &&
          !childMetadataSaved &&
          event.sessionId &&
          event.sessionId !== tabId
        ) {
          childMetadataSaved = true;
          const workspacePath = this.workspaceProvider.getWorkspaceRoot() ?? '';
          const ptahCliAgentId = this.ptahCli.getAgentId(tabId);
          const sessionName = ptahCliAgentId
            ? `CLI Agent: ${ptahCliAgentId}`
            : 'CLI Agent Session';
          try {
            await this.sessionMetadataStore.createChild(
              event.sessionId,
              workspacePath,
              sessionName,
            );
            this.ptahCli.setSdkSessionId(tabId, event.sessionId);
            if (ptahCliAgentId) {
              this.ptahCli.setSdkSessionId(ptahCliAgentId, event.sessionId);
            }
          } catch (err: unknown) {
            this.logger.warn(
              '[RPC] Failed to save child session metadata — session may appear in sidebar',
              { error: err instanceof Error ? err.message : String(err) },
            );
          }
        }
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
          tabId, // For frontend tab routing
          sessionId: event.sessionId, // Real SDK UUID from the event
          event,
          ...(surfaceMode ? { surfaceMode: true } : {}),
        });
        if (event.eventType === 'message_start') {
          turnCompleteSent = false;
        }
        if (event.eventType === 'background_agent_started') {
          const bgEvent = event as BackgroundAgentStartedEvent;
          if (bgEvent.toolCallId) {
            this.subagentRegistry.update(bgEvent.toolCallId, {
              status: 'background',
              isBackground: true,
              outputFilePath: bgEvent.outputFilePath,
              backgroundStartedAt: Date.now(),
            });
          }
        }

        if (event.eventType === 'message_complete' && !turnCompleteSent) {
          turnCompleteSent = true;
          await this.webviewManager.broadcastMessage(
            MESSAGE_TYPES.CHAT_COMPLETE,
            {
              tabId,
              sessionId,
              code: 0,
              ...(surfaceMode ? { surfaceMode: true } : {}),
            },
          );
        }
      }

      if (!turnCompleteSent) {
        await this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.CHAT_COMPLETE,
          {
            tabId,
            sessionId,
            code: 0,
            ...(surfaceMode ? { surfaceMode: true } : {}),
          },
        );
      }
      streamExitedNormally = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const lowerMessage = errorMessage.toLowerCase();
      const isUserAbort =
        lowerMessage.includes('aborted by user') ||
        lowerMessage.includes('abort') ||
        lowerMessage.includes('cancelled') ||
        lowerMessage.includes('canceled');

      if (isUserAbort) {
        this.logger.info(
          `[RPC] Session ${sessionId} aborted by user after ${eventCount} events`,
        );
      } else {
        this.logger.error(
          `[RPC] Error streaming flat events for session ${sessionId}, tabId ${tabId} after ${eventCount} events`,
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ChatRpcHandlers.streamExecutionNodesToWebview' },
        );
      }
      const isCorruptedResume = eventCount === 0 && !isUserAbort;
      if (isCorruptedResume) {
        this.logger.warn(
          `[RPC] Session ${sessionId} failed during resume (0 events), cleaning up dead session. Original error: ${errorMessage}`,
        );
        try {
          await this.sdkAdapter.endSession(sessionId);
        } catch (cleanupErr) {
          this.logger.warn(
            `[RPC] Failed to clean up corrupted session ${sessionId}`,
            cleanupErr instanceof Error
              ? cleanupErr
              : new Error(String(cleanupErr)),
          );
        }
      }
      if (!isUserAbort) {
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_ERROR, {
          tabId,
          sessionId,
          error: isCorruptedResume
            ? 'Session could not be resumed. The conversation data may be corrupted. Please start a new session.'
            : errorMessage,
          ...(surfaceMode ? { surfaceMode: true } : {}),
        });
      }
    } finally {
      this.streamingSessionIds.delete(sessionId as string);
      this.ptahCli.deleteSession(sessionId as string);
      this.ptahCli.deleteSession(tabId);
      if (streamExitedNormally && this.sdkAdapter.isSessionActive(sessionId)) {
        await this.sdkAdapter.endSession(sessionId);
        this.logger.info(
          `[RPC] Session ${sessionId} cleaned up after natural stream completion`,
        );
      }
    }
  }
}
