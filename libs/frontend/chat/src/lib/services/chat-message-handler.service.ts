/**
 * Chat Message Handler - Routes chat-related VS Code messages to ChatStore
 *
 * Implements the MessageHandler interface to handle 9 message types that were
 * previously routed through VSCodeService's fragile lazy setter pattern.
 *
 * Handled message types:
 * - CHAT_CHUNK: Streaming events from SDK
 * - CHAT_COMPLETE: Chat completion signal
 * - CHAT_ERROR: Chat error signal
 * - PERMISSION_REQUEST: Permission prompt from backend
 * - AGENT_SUMMARY_CHUNK: Real-time agent summary streaming
 * - SESSION_STATS: Cost/token data after completion
 * - SESSION_ID_RESOLVED: Real SDK UUID resolution
 * - ASK_USER_QUESTION_REQUEST: AskUserQuestion tool from SDK
 * - PERMISSION_AUTO_RESOLVED: Always Allow sibling resolution
 */

import { Injectable, inject } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import { FlatStreamEventUnion, MESSAGE_TYPES } from '@ptah-extension/shared';
import { ChatStore } from './chat.store';

@Injectable({ providedIn: 'root' })
export class ChatMessageHandler implements MessageHandler {
  private readonly chatStore = inject(ChatStore);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.CHAT_CHUNK,
    MESSAGE_TYPES.CHAT_COMPLETE,
    MESSAGE_TYPES.CHAT_ERROR,
    MESSAGE_TYPES.PERMISSION_REQUEST,
    MESSAGE_TYPES.AGENT_SUMMARY_CHUNK,
    MESSAGE_TYPES.SESSION_STATS,
    MESSAGE_TYPES.SESSION_ID_RESOLVED,
    MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
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
      case MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED:
        this.handlePermissionAutoResolved(message.payload);
        break;
    }
  }

  // CHAT_CHUNK: SDK streaming events with tabId/sessionId extraction
  private handleChatChunk(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] chat:chunk received but payload is undefined!'
      );
      return;
    }

    const { tabId, sessionId, event } = payload as {
      tabId?: string;
      sessionId?: string;
      event: FlatStreamEventUnion;
    };

    this.chatStore.processStreamEvent(event, tabId, sessionId);
  }

  // CHAT_COMPLETE: Chat completion signal
  private handleChatComplete(payload: unknown): void {
    const { tabId, sessionId, code } =
      (payload as {
        tabId?: string;
        sessionId?: string;
        code?: number;
      }) ?? {};

    this.chatStore.handleChatComplete({
      tabId,
      sessionId,
      code: code ?? 0,
    });
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
        '[ChatMessageHandler] permission:request received but payload is undefined!'
      );
      return;
    }
    this.chatStore.handlePermissionRequest(
      payload as Parameters<typeof this.chatStore.handlePermissionRequest>[0]
    );
  }

  // AGENT_SUMMARY_CHUNK: Real-time agent summary streaming
  private handleAgentSummaryChunk(payload: unknown): void {
    console.log('[ChatMessageHandler] AGENT_SUMMARY_CHUNK received:', {
      hasPayload: !!payload,
      toolUseId: (payload as { toolUseId?: string })?.toolUseId,
      deltaLength: (payload as { summaryDelta?: string })?.summaryDelta?.length,
    });

    if (!payload) {
      console.warn(
        '[ChatMessageHandler] agent:summary-chunk received but payload is undefined!'
      );
      return;
    }
    this.chatStore.handleAgentSummaryChunk(
      payload as Parameters<typeof this.chatStore.handleAgentSummaryChunk>[0]
    );
  }

  // SESSION_STATS: Cost/token data after completion
  private handleSessionStats(payload: unknown): void {
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] session:stats received but payload is undefined!'
      );
      return;
    }
    this.chatStore.handleSessionStats(
      payload as Parameters<typeof this.chatStore.handleSessionStats>[0]
    );
  }

  // SESSION_ID_RESOLVED: Real SDK UUID resolution
  private handleSessionIdResolved(payload: unknown): void {
    const { tabId, realSessionId } =
      (payload as {
        tabId?: string;
        realSessionId?: string;
      }) ?? {};

    console.log('[ChatMessageHandler] Session ID resolved:', {
      tabId,
      realSessionId,
    });

    if (realSessionId) {
      this.chatStore.handleSessionIdResolved({
        tabId: tabId as string,
        realSessionId: realSessionId as string,
      });
    } else {
      console.warn(
        '[ChatMessageHandler] session:id-resolved received but realSessionId is undefined!'
      );
    }
  }

  // ASK_USER_QUESTION_REQUEST: AskUserQuestion tool from SDK
  private handleAskUserQuestion(payload: unknown): void {
    console.log(
      '[ChatMessageHandler] AskUserQuestion request received:',
      payload
    );
    if (!payload) {
      console.warn(
        '[ChatMessageHandler] ask-user-question:request received but payload is undefined!'
      );
      return;
    }
    this.chatStore.handleQuestionRequest(payload);
  }

  // PERMISSION_AUTO_RESOLVED: Always Allow sibling resolution
  private handlePermissionAutoResolved(payload: unknown): void {
    if (payload) {
      this.chatStore.handlePermissionAutoResolved(
        payload as { id: string; toolName: string }
      );
    }
  }
}
