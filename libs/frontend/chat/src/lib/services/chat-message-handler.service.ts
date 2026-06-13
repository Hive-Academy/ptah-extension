/**
 * Chat Message Handler - Routes chat-related VS Code messages to ChatStore
 *
 * Implements the MessageHandler interface to handle message types that were
 * previously routed through VSCodeService's fragile lazy setter pattern.
 *
 * Handled message types:
 * - CHAT_CHUNK: Streaming events from SDK
 * - CHAT_COMPLETE: Chat completion signal (marks tab idle)
 * - CHAT_ERROR: Chat error signal
 * - PERMISSION_REQUEST: Permission prompt from backend
 * - AGENT_SUMMARY_CHUNK: Real-time agent summary streaming
 * - SESSION_STATS: Cost/token data after completion (authoritative completion signal)
 * - SESSION_ID_RESOLVED: Real SDK UUID resolution
 * - ASK_USER_QUESTION_REQUEST: AskUserQuestion tool from SDK
 * - PERMISSION_AUTO_RESOLVED: Always Allow sibling resolution
 * - PERMISSION_SESSION_CLEANUP: Session abort cleanup
 */

import { Injectable, inject } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import {
  AskUserQuestionRequestSchema,
  FlatStreamEventUnion,
  MESSAGE_TYPES,
  PermissionRequestSchema,
  SdkCompactionCompletePayloadSchema,
  SdkSubagentEndedPayloadSchema,
  SdkTurnEndedPayloadSchema,
  SdkTurnFailedPayloadSchema,
} from '@ptah-extension/shared';
import { ChatStore } from './chat.store';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  SessionLivenessRegistry,
  TabId,
  TabManagerService,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';

@Injectable({ providedIn: 'root' })
export class ChatMessageHandler implements MessageHandler {
  private readonly chatStore = inject(ChatStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly workflowClaims = inject(WorkflowSessionClaimService);
  /**
   * Authoritative StreamRouter.
   *
   * The router owns the routing graph (ConversationRegistry +
   * TabSessionBinding) and reacts to TabManager's `closedTab` signal to
   * perform per-session cleanup. A router defect needs to surface, not
   * be silently swallowed.
   * `chat.store.processStreamEvent` continues to drive the user-visible
   * tree update (no behavior change for content rendering).
   */
  private readonly streamRouter = inject(StreamRouter);

  private static readonly METADATA_DEBOUNCE_MS = 250;

  private _metadataChangedTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly handledMessageTypes = [
    MESSAGE_TYPES.CHAT_CHUNK,
    MESSAGE_TYPES.CHAT_COMPLETE,
    MESSAGE_TYPES.CHAT_ERROR,
    MESSAGE_TYPES.PERMISSION_REQUEST,
    MESSAGE_TYPES.AGENT_SUMMARY_CHUNK,
    MESSAGE_TYPES.SESSION_STATS,
    MESSAGE_TYPES.SESSION_ID_RESOLVED,
    MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    MESSAGE_TYPES.ASK_USER_QUESTION_AUTO_RESOLVED,
    MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
    MESSAGE_TYPES.PERMISSION_SESSION_CLEANUP,
    MESSAGE_TYPES.SESSION_METADATA_CHANGED,
    MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE,
    MESSAGE_TYPES.SESSION_TURN_ENDED,
    MESSAGE_TYPES.SESSION_TURN_FAILED,
    MESSAGE_TYPES.SESSION_SUBAGENT_ENDED,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case MESSAGE_TYPES.CHAT_CHUNK:
        this.handleChatChunk(message.payload);
        break;
      case MESSAGE_TYPES.CHAT_COMPLETE:
        this.handleChatComplete(message.payload);
        break;
      case MESSAGE_TYPES.CHAT_ERROR:
        this.handleChatError(message.payload);
        break;
      case MESSAGE_TYPES.PERMISSION_REQUEST:
        this.handlePermissionRequest(message.payload);
        break;
      case MESSAGE_TYPES.AGENT_SUMMARY_CHUNK:
        this.handleAgentSummaryChunk(message.payload);
        break;
      case MESSAGE_TYPES.SESSION_STATS:
        this.handleSessionStats(message.payload);
        break;
      case MESSAGE_TYPES.SESSION_ID_RESOLVED:
        this.handleSessionIdResolved(message.payload);
        break;
      case MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST:
        this.handleAskUserQuestion(message.payload);
        break;
      case MESSAGE_TYPES.ASK_USER_QUESTION_AUTO_RESOLVED:
        this.handleAskUserQuestionAutoResolved(message.payload);
        break;
      case MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED:
        this.handlePermissionAutoResolved(message.payload);
        break;
      case MESSAGE_TYPES.PERMISSION_SESSION_CLEANUP:
        this.handlePermissionSessionCleanup(message.payload);
        break;
      case MESSAGE_TYPES.SESSION_METADATA_CHANGED:
        this.handleSessionMetadataChanged();
        break;
      case MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE:
        this.handleSessionCompactionComplete(message.payload);
        break;
      case MESSAGE_TYPES.SESSION_TURN_ENDED:
        this.handleSessionTurnEnded(message.payload);
        break;
      case MESSAGE_TYPES.SESSION_TURN_FAILED:
        this.handleSessionTurnFailed(message.payload);
        break;
      case MESSAGE_TYPES.SESSION_SUBAGENT_ENDED:
        this.handleSessionSubagentEnded(message.payload);
        break;
    }
  }

  private workspaceFor(sessionId: string): string | undefined {
    return this.tabManager.findTabBySessionIdAcrossWorkspaces(sessionId)
      ?.workspacePath;
  }

  /**
   * CHAT_COMPLETE is intentionally NOT used to finalize streaming — it fires
   * per-turn (on each message_complete) and SESSION_STATS is the authoritative
   * end-of-turn signal (TASK_2025_101). The ONLY completion we action here is
   * the native `/clear` command, which the backend signals via this channel
   * with `command: 'clear'`. It wipes the target tab to a fresh, empty
   * conversation; every other CHAT_COMPLETE is ignored.
   */
  private handleChatComplete(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as {
      command?: unknown;
      tabId?: unknown;
      surfaceMode?: unknown;
    };
    if (
      typeof data.tabId === 'string' &&
      this.workflowClaims.surfaceFor(data.tabId)
    ) {
      return;
    }
    if (data.surfaceMode === true) return;
    if (data.command !== 'clear') return;
    if (typeof data.tabId !== 'string') return;
    const target = this.tabManager.tabs().find((t) => t.id === data.tabId);
    if (!target) return;
    if (target.claudeSessionId) {
      this.liveness.markIdle(
        target.claudeSessionId,
        this.workspaceFor(target.claudeSessionId),
      );
    }
    this.tabManager.resetTabToFresh(data.tabId);
  }

  private handleSessionSubagentEnded(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] session:subagentEnded received but payload is undefined!',
      );
      return;
    }
    const parsed = SdkSubagentEndedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatMessageHandler] Invalid SdkSubagentEndedPayload — dropped',
        parsed.error,
      );
      return;
    }
    if (parsed.data.backgroundTasks.length === 0) {
      this.liveness.markIdle(
        parsed.data.sessionId,
        this.workspaceFor(parsed.data.sessionId),
      );
    }
    this.chatStore.handleSubagentEndedNotification(parsed.data);
  }

  private handleSessionTurnEnded(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] session:turnEnded received but payload is undefined!',
      );
      return;
    }
    const parsed = SdkTurnEndedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatMessageHandler] Invalid SdkTurnEndedPayload — dropped',
        parsed.error,
      );
      return;
    }
    const ws = this.workspaceFor(parsed.data.sessionId);
    if (parsed.data.backgroundTasks.length > 0) {
      this.liveness.markAwaitingBackground(parsed.data.sessionId, ws);
    } else {
      this.liveness.markIdle(parsed.data.sessionId, ws);
    }
    this.chatStore.handleTurnEndedNotification(parsed.data);
  }

  private handleSessionTurnFailed(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] session:turnFailed received but payload is undefined!',
      );
      return;
    }
    const parsed = SdkTurnFailedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatMessageHandler] Invalid SdkTurnFailedPayload — dropped',
        parsed.error,
      );
      return;
    }
    this.liveness.markFailed(
      parsed.data.sessionId,
      this.workspaceFor(parsed.data.sessionId),
    );
    this.chatStore.handleTurnFailedNotification(parsed.data);
  }

  private handleSessionCompactionComplete(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] session:compactionComplete received but payload is undefined!',
      );
      return;
    }
    const parsed = SdkCompactionCompletePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatMessageHandler] Invalid SdkCompactionCompletePayload — dropped',
        parsed.error,
      );
      return;
    }
    this.chatStore.handleCompactionCompleteNotification(parsed.data);
  }

  /**
   * S4 — refresh sidebar session list when backend reports a metadata
   * mutation (created / updated / deleted / forked). Debounced so a burst of
   * mutations (e.g. fork + switch) triggers one refresh, not many.
   *
   * Replaces the imperative `chatStore.loadSessions()` in
   * `ChatViewComponent.onBranchRequested` — the event-driven path makes
   * every surface (canvas tiles, inactive tabs) stay in sync without
   * per-call-site plumbing.
   */
  private handleSessionMetadataChanged(): void {
    if (this._metadataChangedTimeout) {
      clearTimeout(this._metadataChangedTimeout);
    }
    this._metadataChangedTimeout = setTimeout(() => {
      this._metadataChangedTimeout = null;
      this.chatStore.loadSessions().catch((err) => {
        console.warn(
          '[ChatMessageHandler] loadSessions after session:metadataChanged failed:',
          err,
        );
      });
    }, ChatMessageHandler.METADATA_DEBOUNCE_MS);
  }
  private handleChatChunk(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] chat:chunk received but payload is undefined!',
      );
      return;
    }

    const { tabId, sessionId, event, surfaceMode } = payload as {
      tabId?: string;
      sessionId?: string;
      event: FlatStreamEventUnion;
      surfaceMode?: boolean;
    };

    const claimedSurface = tabId ? this.workflowClaims.surfaceFor(tabId) : null;
    if (claimedSurface) {
      if (event?.sessionId) {
        this.liveness.markStreaming(
          event.sessionId,
          this.workspaceFor(event.sessionId),
        );
      }
      this.streamRouter.routeStreamEventForSurface(event, claimedSurface);
      return;
    }

    if (surfaceMode === true) {
      return;
    }

    if (event?.sessionId) {
      this.liveness.markStreaming(
        event.sessionId,
        this.workspaceFor(event.sessionId),
      );
    }
    this.chatStore.processStreamEvent(event, tabId, sessionId);
    const originTabId = tabId ? TabId.safeParse(tabId) : null;
    this.streamRouter.routeStreamEvent(event, originTabId ?? undefined);
  }
  private handleChatError(payload: unknown): void {
    const { tabId, sessionId, error, surfaceMode } =
      (payload as {
        tabId?: string;
        sessionId?: string;
        error?: string;
        surfaceMode?: boolean;
      }) ?? {};

    const claimedSurface = tabId ? this.workflowClaims.surfaceFor(tabId) : null;
    if (claimedSurface) {
      console.error('[ChatMessageHandler] Workflow chat error:', {
        tabId,
        sessionId,
        error,
      });
      if (sessionId) {
        this.liveness.markFailed(sessionId, this.workspaceFor(sessionId));
      }
      return;
    }

    if (surfaceMode === true) {
      return;
    }

    console.error('[ChatMessageHandler] Chat error:', {
      tabId,
      sessionId,
      error,
    });

    this.chatStore.handleChatError({
      tabId,
      sessionId,
      error: error ?? 'Unknown error',
    });
  }
  private handlePermissionRequest(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] permission:request received but payload is undefined!',
      );
      return;
    }
    const parsed = PermissionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatMessageHandler] Invalid PermissionRequest payload — dropped',
        parsed.error,
      );
      return;
    }
    const prompt = parsed.data as Parameters<
      typeof this.chatStore.handlePermissionRequest
    >[0];
    this.chatStore.handlePermissionRequest(prompt);
    this.streamRouter.routePermissionPrompt(prompt);
  }
  private handleAgentSummaryChunk(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] agent:summary-chunk received but payload is undefined!',
      );
      return;
    }
    this.chatStore.handleAgentSummaryChunk(
      payload as Parameters<typeof this.chatStore.handleAgentSummaryChunk>[0],
    );
  }
  private handleSessionStats(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] session:stats received but payload is undefined!',
      );
      return;
    }
    this.chatStore.handleSessionStats(
      payload as Parameters<typeof this.chatStore.handleSessionStats>[0],
    );
  }
  private handleSessionIdResolved(payload: unknown): void {
    const { tabId, realSessionId } =
      (payload as {
        tabId?: string;
        realSessionId?: string;
      }) ?? {};

    if (realSessionId) {
      const claimedSurface = tabId
        ? this.workflowClaims.surfaceFor(tabId)
        : null;
      if (claimedSurface) {
        this.streamRouter.refreshQuestionTargetsForSession(
          realSessionId as ClaudeSessionId,
        );
        return;
      }
      this.chatStore.handleSessionIdResolved({
        tabId: tabId as string,
        realSessionId: realSessionId as string,
      });
      this.streamRouter.refreshQuestionTargetsForSession(
        realSessionId as ClaudeSessionId,
      );
      if (tabId) {
        this.agentMonitorStore.resolveParentSessionId(tabId, realSessionId);
      }
    } else {
      console.warn(
        '[ChatMessageHandler] session:id-resolved received but realSessionId is undefined!',
      );
    }
  }
  private handleAskUserQuestion(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] ask-user-question:request received but payload is undefined!',
      );
      return;
    }
    const parsed = AskUserQuestionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatMessageHandler] Invalid AskUserQuestionRequest payload — dropped',
        parsed.error,
      );
      return;
    }
    const question =
      parsed.data as import('@ptah-extension/shared').AskUserQuestionRequest;
    this.chatStore.handleQuestionRequest(question);
    this.streamRouter.routeQuestionPrompt(question);
  }
  private handleAskUserQuestionAutoResolved(payload: unknown): void {
    const { id, answers } =
      (payload as {
        id?: string;
        answers?: Record<string, string>;
      }) ?? {};
    if (!id) return;
    console.info(
      '[ChatMessageHandler] AskUserQuestion auto-resolved (idle timeout)',
      { id, answers },
    );
    this.chatStore.dropQuestionRequest(id);
  }
  private handlePermissionAutoResolved(payload: unknown): void {
    if (payload) {
      this.chatStore.handlePermissionAutoResolved(
        payload as { id: string; toolName: string },
      );
    }
  }
  private handlePermissionSessionCleanup(payload: unknown): void {
    const { sessionId } = (payload as { sessionId?: string }) ?? {};
    if (sessionId) {
      this.chatStore.cleanupPermissionSession(sessionId);
    } else {
      console.warn(
        '[ChatMessageHandler] permission:session-cleanup received but sessionId is undefined!',
      );
    }
  }
}
