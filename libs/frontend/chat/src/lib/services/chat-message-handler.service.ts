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
} from '@ptah-extension/shared';
import { ChatStore } from './chat.store';
import { MessageSenderService } from './message-sender.service';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  TabId,
  TabManagerService,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import { StreamRouter } from '@ptah-extension/chat-routing';

@Injectable({ providedIn: 'root' })
export class ChatMessageHandler implements MessageHandler {
  private readonly chatStore = inject(ChatStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly messageSender = inject(MessageSenderService);
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
    // CHAT_COMPLETE intentionally not registered — SESSION_STATS is authoritative.
    // CHAT_COMPLETE fires per-turn (on message_complete), not at session end.
    // Handling it here would mark tabs idle mid-session during multi-turn tool-use.
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
    MESSAGE_TYPES.SETUP_WIZARD_START_NEW_PROJECT_CHAT,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case MESSAGE_TYPES.CHAT_CHUNK:
        this.handleChatChunk(message.payload);
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
      case MESSAGE_TYPES.SETUP_WIZARD_START_NEW_PROJECT_CHAT:
        this.handleSetupWizardStartNewProjectChat(message.payload);
        break;
    }
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

  // CHAT_CHUNK: SDK streaming events with tabId/sessionId extraction
  private handleChatChunk(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] chat:chunk received but payload is undefined!',
      );
      return;
    }

    const { tabId, sessionId, event } = payload as {
      tabId?: string;
      sessionId?: string;
      event: FlatStreamEventUnion;
    };

    this.chatStore.processStreamEvent(event, tabId, sessionId);

    // Authoritative routing. The router maintains
    // ConversationRegistry/TabSessionBinding so other consumers
    // (banner UI, fan-out) can resolve session→conversation→tab[] mapping
    // from a single source. Errors are NOT swallowed — a router defect
    // needs to surface during testing.
    const originTabId = tabId ? TabId.safeParse(tabId) : null;
    this.streamRouter.routeStreamEvent(event, originTabId ?? undefined);
  }

  // CHAT_ERROR: Chat error signal
  private handleChatError(payload: unknown): void {
    const { tabId, sessionId, error } =
      (payload as {
        tabId?: string;
        sessionId?: string;
        error?: string;
      }) ?? {};

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

  // PERMISSION_REQUEST: Permission prompt from backend
  private handlePermissionRequest(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] permission:request received but payload is undefined!',
      );
      return;
    }
    // Validate at the frontend receive point. A malformed payload must NOT
    // crash the message-handler loop for other message types; log + early-return.
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
    // 1. Append to PermissionHandler queue first so the prompt is in
    //    `_permissionRequests` by the time the router tags target tabs.
    this.chatStore.handlePermissionRequest(prompt);
    // 2. Compute fan-out target tabs and stash
    //    them on the PermissionHandler so cancel-on-decision can broadcast
    //    correctly. Router falls back to no-op when the prompt's session
    //    isn't yet in the registry — global visibility kicks in.
    this.streamRouter.routePermissionPrompt(prompt);
  }

  // AGENT_SUMMARY_CHUNK: Real-time agent summary streaming
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

  // SESSION_STATS: Cost/token data after completion
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

  // SESSION_ID_RESOLVED: Real SDK UUID resolution
  private handleSessionIdResolved(payload: unknown): void {
    const { tabId, realSessionId } =
      (payload as {
        tabId?: string;
        realSessionId?: string;
      }) ?? {};

    if (realSessionId) {
      this.chatStore.handleSessionIdResolved({
        tabId: tabId as string,
        realSessionId: realSessionId as string,
      });

      // Re-route any pending questions whose stale tabId targets just got
      // rebound to the real SDK session id. Without this, a question that
      // arrived during the pending-session window stays pinned to the
      // placeholder tabId and the chat-view filter silently drops it once
      // the binding flips.
      this.streamRouter.refreshQuestionTargetsForSession(
        realSessionId as ClaudeSessionId,
      );

      // Update parentSessionId on any agents spawned with the tab ID before
      // the real SDK UUID was resolved. Without this, agents spawned early in
      // the session lifecycle have a stale tab ID that never matches the tab's
      // claudeSessionId, making them invisible in the filtered agent panel.
      if (tabId) {
        this.agentMonitorStore.resolveParentSessionId(tabId, realSessionId);
      }
    } else {
      console.warn(
        '[ChatMessageHandler] session:id-resolved received but realSessionId is undefined!',
      );
    }
  }

  // ASK_USER_QUESTION_REQUEST: AskUserQuestion tool from SDK
  private handleAskUserQuestion(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] ask-user-question:request received but payload is undefined!',
      );
      return;
    }
    // Validate at the frontend receive point. A malformed payload must NOT
    // crash the message-handler loop for other message types; log + early-return.
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
    // 1. Enqueue the question first so the router-resolved targets land
    //    on a question that's already in the queue.
    this.chatStore.handleQuestionRequest(question);
    // 2. Resolve sessionId → tabs and stash the target tab ids on the
    //    PermissionHandler. Mirrors the permission prompt path. Without
    //    this, the chat-view filter falls back to raw payload-id equality,
    //    which silently drops questions whose session id rotated while
    //    the user was idle (compaction / late SESSION_ID_RESOLVED) — and
    //    the backend's `awaitQuestionResponse` has no timeout, so the
    //    tool call hangs forever.
    this.streamRouter.routeQuestionPrompt(question);
  }

  // ASK_USER_QUESTION_AUTO_RESOLVED: idle-timeout fired backend-side and the
  // recommended option was auto-picked. Drop the now-stale card from the UI
  // (the agent already received the answer and moved on).
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

  // PERMISSION_AUTO_RESOLVED: Always Allow sibling resolution
  private handlePermissionAutoResolved(payload: unknown): void {
    if (payload) {
      this.chatStore.handlePermissionAutoResolved(
        payload as { id: string; toolName: string },
      );
    }
  }

  // PERMISSION_SESSION_CLEANUP: Remove all permission/question cards for aborted session
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

  /**
   * SETUP_WIZARD_START_NEW_PROJECT_CHAT: backend handoff from the wizard
   * welcome screen's "Start New Project" button. Creates a fresh chat tab
   * and submits the seed `prompt` as the first user turn so the
   * saas-workspace-initializer skill can begin guiding the conversation.
   */
  private handleSetupWizardStartNewProjectChat(payload: unknown): void {
    const { prompt } = (payload as { prompt?: string }) ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      console.warn(
        '[ChatMessageHandler] setup-wizard:start-new-project-chat received but prompt is missing!',
      );
      return;
    }

    const tabId = this.tabManager.createTab();
    this.tabManager.switchTab(tabId);
    this.messageSender.send(prompt, { tabId }).catch((error: unknown) => {
      console.error(
        '[ChatMessageHandler] Failed to seed new-project chat:',
        error instanceof Error ? error.message : String(error),
      );
    });
  }
}
