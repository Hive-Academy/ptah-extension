/**
 * Chat stream broadcaster.
 *
 * Owns the webview broadcast loop (`streamEventsToWebview`). Moves
 * byte-identically from `chat-rpc.handlers.ts`. The streaming lifecycle
 * preserves:
 *
 *   - `isUserAbort` substring match (`'aborted by user' | 'abort' | 'cancelled' | 'canceled'`).
 *   - `isCorruptedResume` cleanup path (`eventCount === 0 && !isUserAbort`).
 *   - Every `MESSAGE_TYPES.CHAT_*` payload shape.
 *   - Ptah-CLI child-session metadata save.
 *   - Background-agent registration on `background_agent_started` events.
 *
 * ## Chunk coalescing (TASK_2026_323 B7)
 *
 * `CHAT_CHUNK` messages are buffered by {@link StreamBatchBuffer} and delivered
 * as `MESSAGE_TYPES.BATCH` envelopes. See that file for the ordering and
 * failure rules. Two invariants live HERE rather than there:
 *
 *  - **Nothing in the loop awaits a chunk broadcast.** Awaiting each hop parks
 *    the SDK stream drain behind the renderer, which is the actual mechanism
 *    behind the reported freeze. Turn boundaries still await: the buffer is
 *    flushed before `CHAT_COMPLETE` and before `CHAT_ERROR`, so a completion
 *    can never overtake the chunks it completes.
 *  - **All three transports unwrap a batch.** `MessageRouterService` for the
 *    two webview hosts, `CliWebviewManagerAdapter` for CLI/TUI. The CLI one is
 *    load-bearing and easy to miss: that transport emits the message `type` as
 *    an EventEmitter event NAME, and four consumers subscribe to `'chat:chunk'`
 *    by name (`chat-bridge`, `session-submit.service`, `anthropic-proxy.service`,
 *    the TUI's `use-chat`). Without de-batching there they go silent — no
 *    error, no fallback.
 *
 * ## The per-event debug log is NOT level-guarded, deliberately
 *
 * `Logger.log` already returns on `!shouldLog(level)` BEFORE it stringifies its
 * args (`logger.ts:203`, ahead of the `JSON.stringify` at `:206-217`), so at the
 * default production level nothing is serialised. A level guard here would
 * therefore buy nothing, and `Logger` exposes no public level accessor to write
 * one with (`minLevel` and `shouldLog` are both private). What a per-event call
 * DOES cost unconditionally is the template literal, the rest-args array and the
 * context object — small, but paid on every event of every session. Sampling
 * every {@link DEBUG_LOG_EVERY_N_EVENTS}th event removes that without hiding
 * anything: turn boundaries and errors log their own totals regardless.
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
import { StreamBatchBuffer } from './stream-batch-buffer';

export interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/**
 * Emit the per-event debug line once every N events. See the class doc for why
 * this is sampling rather than a level guard.
 */
export const DEBUG_LOG_EVERY_N_EVENTS = 100;

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

  /**
   * True while a broadcast loop is attached to this id â€” the liveness signal
   * that registry presence (`isSessionActive`) is NOT. Callers deciding
   * "continue into the live session vs. resume it" must consult this, since a
   * registered session whose loop has exited can no longer deliver events.
   *
   * Keyed by whatever `streamEventsToWebview` was called with: the tabId for a
   * fresh `chat:start`, the real session UUID for a resume. Callers holding
   * both should check both.
   */
  isStreaming(sessionId: string): boolean {
    return this.streamingSessionIds.has(sessionId);
  }

  /**
   * Stream flat events to webview
   * Handles SDK AsyncIterable<FlatStreamEventUnion> â†’ webview messages.
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
    // Identity of the record this loop is the consumer OF, captured before the
    // first event. The finally block compares against it so teardown can only
    // ever hit the record streamed here.
    const recordToken = this.sdkAdapter.getSessionToken(sessionId);
    const batch = new StreamBatchBuffer({
      sink: (type, payload) =>
        this.webviewManager.broadcastMessage(type, payload),
      onError: (error: unknown) =>
        this.logger.warn(
          `[RPC] Failed to deliver a chat batch for session ${sessionId}`,
          { error: error instanceof Error ? error.message : String(error) },
        ),
    });
    try {
      for await (const event of stream) {
        eventCount++;
        if (eventCount % DEBUG_LOG_EVERY_N_EVENTS === 0) {
          this.logger.debug(
            `[RPC] Streaming event #${eventCount} type=${event.eventType} to webview`,
            {
              sessionId,
              tabId,
              eventType: event.eventType,
              messageId: event.messageId,
            },
          );
        }
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
              '[RPC] Failed to save child session metadata â€” session may appear in sidebar',
              { error: err instanceof Error ? err.message : String(err) },
            );
          }
        }
        batch.push({
          type: MESSAGE_TYPES.CHAT_CHUNK,
          payload: {
            tabId, // For frontend tab routing
            sessionId: event.sessionId, // Real SDK UUID from the event
            event,
            ...(surfaceMode ? { surfaceMode: true } : {}),
          },
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
          // A turn boundary is the one place the buffer MUST NOT wait for its
          // timer: `chat:complete` closes the turn in the UI, so it arriving
          // ahead of the chunks it completes renders a truncated message.
          await batch.flush();
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

      await batch.flush();
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
      // Deliver whatever arrived before the failure. These chunks are real
      // output the user already paid for, and the error message reads as a
      // non-sequitur without them.
      await batch.flush();
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
      // Release the timer and let any size-triggered flush that is still in
      // flight land before teardown ends the session underneath it.
      batch.dispose();
      await batch.settle();
      this.streamingSessionIds.delete(sessionId as string);
      this.ptahCli.deleteSession(sessionId as string);
      this.ptahCli.deleteSession(tabId);
      // This loop is the session's ONLY consumer, so its exit â€” for any
      // reason, not just the clean `for await` completion â€” leaves nothing
      // reading the SDK query, and the record must be torn down.
      //
      // But it may tear down ONLY the record it actually streamed. Ids are
      // reused: `executeSlashCommandQuery` ends the old record and registers a
      // NEW one under the SAME id, then spends ~2s on harness preflight before
      // the fresh query starts. The old loop sees that end as a thrown abort
      // and arrives here meanwhile, while a presence check by id
      // (`isSessionActive`) says "active", because the NEW record is. Ending on
      // that answer aborted the replacement's AbortController and the
      // follow-up slash command died with "Operation aborted".
      // `endSessionIfTokenMatches` compares record identity and tears down
      // atomically, so a newer record under the same id is never touched, while
      // the idempotency that matters for the user-abort path (where
      // `chat:abort` already ended the session) still holds: the record is gone
      // and there is nothing to match.
      if (recordToken !== null) {
        try {
          const ended = await this.sdkAdapter.endSessionIfTokenMatches(
            sessionId,
            recordToken,
          );
          if (ended) {
            this.logger.info(
              `[RPC] Session ${sessionId} cleaned up after stream exit`,
              { normalExit: streamExitedNormally, eventCount },
            );
          } else {
            this.logger.info(
              `[RPC] Session ${sessionId} record was replaced before stream exit — leaving the newer query alone`,
              { normalExit: streamExitedNormally, eventCount },
            );
          }
        } catch (cleanupErr) {
          this.logger.warn(
            `[RPC] Failed to clean up session ${sessionId} after stream exit`,
            cleanupErr instanceof Error
              ? cleanupErr
              : new Error(String(cleanupErr)),
          );
        }
      }
    }
  }
}
