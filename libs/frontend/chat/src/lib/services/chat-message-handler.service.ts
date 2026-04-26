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
import { FlatStreamEventUnion, MESSAGE_TYPES } from '@ptah-extension/shared';
import { ChatStore } from './chat.store';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { TabId } from '@ptah-extension/chat-state';
import { StreamRouter } from '@ptah-extension/chat-routing';

@Injectable({ providedIn: 'root' })
export class ChatMessageHandler implements MessageHandler {
  private readonly chatStore = inject(ChatStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  /**
   * TASK_2026_106 Phase 3 — authoritative StreamRouter.
   *
   * The router owns the routing graph (ConversationRegistry +
   * TabSessionBinding) and reacts to TabManager's `closedTab` signal to
   * perform per-session cleanup. The shadow-mode try/catch is gone — a
   * router defect now needs to surface, not be silently swallowed.
   * `chat.store.processStreamEvent` continues to drive the user-visible
   * tree update (no behavior change for content rendering).
   */
  private readonly streamRouter = inject(StreamRouter);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.CHAT_CHUNK,
    // CHAT_COMPLETE intentionally not registered — SESSION_STATS is authoritative (TASK_2025_101)
    // CHAT_COMPLETE fires per-turn (on message_complete), not at session end.
    // Handling it here would mark tabs idle mid-session during multi-turn tool-use.
    MESSAGE_TYPES.CHAT_ERROR,
    MESSAGE_TYPES.PERMISSION_REQUEST,
    MESSAGE_TYPES.AGENT_SUMMARY_CHUNK,
    MESSAGE_TYPES.SESSION_STATS,
    MESSAGE_TYPES.SESSION_ID_RESOLVED,
    MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
    MESSAGE_TYPES.PERMISSION_SESSION_CLEANUP,
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
      case MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED:
        this.handlePermissionAutoResolved(message.payload);
        break;
      case MESSAGE_TYPES.PERMISSION_SESSION_CLEANUP:
        this.handlePermissionSessionCleanup(message.payload);
        break;
    }
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

    // TASK_2026_106 Phase 3 — authoritative routing. The router maintains
    // ConversationRegistry/TabSessionBinding so other consumers (Phase 4+
    // banner UI, fan-out) can resolve session→conversation→tab[] mapping
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
    this.chatStore.handlePermissionRequest(
      payload as Parameters<typeof this.chatStore.handlePermissionRequest>[0],
    );
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
    this.chatStore.handleQuestionRequest(
      payload as import('@ptah-extension/shared').AskUserQuestionRequest,
    );
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
}
