/**
 * Chat stream broadcaster (Wave C7e).
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

  /**
   * Stream flat events to webview
   * Handles SDK AsyncIterable<FlatStreamEventUnion> → webview messages
   *
   * TASK_2025_082: Migrated from ExecutionNode to FlatStreamEventUnion
   * TASK_2025_092: Added tabId for frontend event routing
   * TASK_2025_092: CRITICAL FIX - Added message_complete handling for turn completion
   *   (This fix was previously only in dead-code SdkRpcHandlers, not here!)
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
  ): Promise<void> {
    this.logger.info(
      `[RPC] streamExecutionNodesToWebview STARTED for session ${sessionId}, tabId ${tabId}`,
    );
    let eventCount = 0;

    // TASK_2025_092: Track if we've sent chat:complete for this turn
    // This prevents duplicate completion signals when multiple message_complete events arrive
    // (e.g., OpenRouter sends duplicate assistant messages with same messageId)
    let turnCompleteSent = false;

    // Track whether we've saved child session metadata for Ptah CLI sessions.
    // When the real SDK session ID appears (different from tabId), we save
    // metadata with isChildSession=true so it doesn't appear in the sidebar.
    let childMetadataSaved = false;
    const isPtahCliSession = this.ptahCli.hasSession(tabId);

    // Track whether the stream exited normally (not via abort/error).
    // Used in the finally block to decide whether to clean up the session.
    // When a slash command replaces an existing session (e.g., /compact on an active chat),
    // the OLD stream is aborted and a NEW stream starts with the same sessionId.
    // The finally block must NOT clean up on abort — it would kill the replacement session.
    let streamExitedNormally = false;

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

        // Save child session metadata for Ptah CLI sessions once the real
        // SDK session ID is resolved. This prevents SessionImporterService
        // from importing the session as a top-level sidebar entry.
        // Awaited (not fire-and-forget) to ensure metadata is persisted
        // before extension shutdown could interrupt.
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
            // Track SDK UUID for cross-referencing in CliSessionReference.
            // Store by both tabId and agentId so persistCliSessionReference
            // can look up by ptahCliId (which is the agentId).
            this.ptahCli.setSdkSessionId(tabId, event.sessionId);
            if (ptahCliAgentId) {
              this.ptahCli.setSdkSessionId(ptahCliAgentId, event.sessionId);
            }
            this.logger.info(
              '[RPC] Child session metadata saved for Ptah CLI session',
              { sessionId: event.sessionId, tabId, agentId: ptahCliAgentId },
            );
          } catch (err: unknown) {
            this.logger.warn(
              '[RPC] Failed to save child session metadata — session may appear in sidebar',
              { error: err instanceof Error ? err.message : String(err) },
            );
          }
        }

        // Include tabId for frontend routing
        // sessionId in event is the real SDK UUID
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
          tabId, // For frontend tab routing
          sessionId: event.sessionId, // Real SDK UUID from the event
          event,
        });

        // TASK_2025_092: Reset turnCompleteSent when new turn starts (message_start)
        // This ensures multi-turn conversations properly signal completion for each turn
        if (event.eventType === 'message_start') {
          turnCompleteSent = false;
        }

        // When a background_agent_started event arrives, mark the agent in registry
        if (event.eventType === 'background_agent_started') {
          const bgEvent = event as BackgroundAgentStartedEvent;
          if (bgEvent.toolCallId) {
            this.subagentRegistry.update(bgEvent.toolCallId, {
              status: 'background',
              isBackground: true,
              outputFilePath: bgEvent.outputFilePath,
              backgroundStartedAt: Date.now(),
            });
            this.logger.info(
              '[RPC] Background agent registered from stream event',
              {
                toolCallId: bgEvent.toolCallId,
                agentId: bgEvent.agentId,
              },
            );
          }
        }

        if (event.eventType === 'message_complete' && !turnCompleteSent) {
          turnCompleteSent = true;
          this.logger.info(
            `[RPC] Turn complete - sending chat:complete for session ${sessionId}, tabId ${tabId}`,
            { eventCount },
          );
          await this.webviewManager.broadcastMessage(
            MESSAGE_TYPES.CHAT_COMPLETE,
            {
              tabId,
              sessionId,
              code: 0,
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
          },
        );
      }

      // Stream completed without error — safe to clean up in finally block
      streamExitedNormally = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const lowerMessage = errorMessage.toLowerCase();

      // Check if this is a user-initiated abort (not a real error)
      const isUserAbort =
        lowerMessage.includes('aborted by user') ||
        lowerMessage.includes('abort') ||
        lowerMessage.includes('cancelled') ||
        lowerMessage.includes('canceled');

      if (isUserAbort) {
        // User aborts are expected behavior, log at INFO level
        this.logger.info(
          `[RPC] Session ${sessionId} aborted by user after ${eventCount} events`,
        );
      } else {
        // Real errors should be logged at ERROR level
        this.logger.error(
          `[RPC] Error streaming flat events for session ${sessionId}, tabId ${tabId} after ${eventCount} events`,
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ChatRpcHandlers.streamExecutionNodesToWebview' },
        );
      }

      // If the stream errored with 0 events, the session resume failed entirely
      // (e.g., corrupted JSONL from a previous crash). Clean up the dead session
      // so the user isn't stuck trying to resume a broken session.
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

      // Only send error to webview for real errors, not user-initiated aborts.
      // User aborts include: stop button, /clear command, slash command re-query.
      // These are handled by their own completion signals (CHAT_COMPLETE).
      if (!isUserAbort) {
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_ERROR, {
          tabId,
          sessionId,
          error: isCorruptedResume
            ? 'Session could not be resumed. The conversation data may be corrupted. Please start a new session.'
            : errorMessage,
        });
      }
    } finally {
      // Clean up Ptah CLI session tracking on stream completion (natural or error)
      this.ptahCli.deleteSession(sessionId as string);
      this.ptahCli.deleteSession(tabId);
      // Note: ptahCliSdkSessionIds is NOT cleaned up here — it must persist
      // until persistCliSessionReference reads it (agent may exit later).

      // Clean up the session from activeSessions when the stream ends NORMALLY
      // (e.g., slash commands that terminate after execution). Without this,
      // chat:continue sees the session as "active" and calls sendMessage on a dead query.
      //
      // CRITICAL: Only clean up on normal exit, NOT on abort/error. When a slash
      // command replaces a session (e.g., /compact on active chat), the old stream
      // is aborted and a new stream starts with the same sessionId. Cleaning up on
      // abort would kill the replacement session — a race condition.
      if (streamExitedNormally && this.sdkAdapter.isSessionActive(sessionId)) {
        try {
          await this.sdkAdapter.endSession(sessionId);
          this.logger.info(
            `[RPC] Session ${sessionId} cleaned up after natural stream completion`,
          );
        } catch {
          // Best-effort cleanup — session may have already been ended
        }
      }
    }
  }
}
