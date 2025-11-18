/**
 * Claude Event Relay Service
 *
 * Purpose: Bridge CLAUDE_DOMAIN_EVENTS (EventBus) to CHAT_MESSAGE_TYPES (Webview)
 *
 * Architecture:
 * - Subscribes to all 15 CLAUDE_DOMAIN_EVENTS
 * - Maps claude:* events → chat:* messages
 * - Forwards to webview via WebviewManager.postMessage()
 *
 * This service fills the critical gap identified in EVENT_SYSTEM_GAP_ANALYSIS.md
 */

import { injectable, inject } from 'tsyringe';
import { Subscription } from 'rxjs';
import { TOKENS, EventBus } from '@ptah-extension/vscode-core';
import { CLAUDE_DOMAIN_EVENTS } from '@ptah-extension/claude-domain';
import type {
  ClaudeContentChunkEvent,
  ClaudeThinkingEventPayload,
  ClaudeToolEventPayload,
  ClaudePermissionRequestEvent,
  ClaudePermissionResponseEvent,
  ClaudeAgentStartedEvent,
  ClaudeAgentActivityEventPayload,
  ClaudeAgentCompletedEvent,
  ClaudeSessionInitEvent,
  ClaudeSessionEndEvent,
  ClaudeHealthUpdateEvent,
  ClaudeErrorEvent,
} from '@ptah-extension/claude-domain';
import {
  CHAT_MESSAGE_TYPES,
  MessageId,
  type ChatMessageChunkPayload,
  type ChatThinkingPayload,
  type ChatToolStartPayload,
  type ChatToolProgressPayload,
  type ChatToolResultPayload,
  type ChatToolErrorPayload,
  type ChatPermissionRequestPayload,
  type ChatPermissionResponsePayload,
  type ChatAgentStartedPayload,
  type ChatAgentActivityPayload,
  type ChatAgentCompletedPayload,
  type ChatSessionInitPayload,
  type ChatSessionEndPayload,
  type ChatHealthUpdatePayload,
  type ChatCliErrorPayload,
} from '@ptah-extension/shared';

export interface IWebviewManager {
  postMessage(message: { type: string; payload: unknown }): boolean;
}

@injectable()
export class ClaudeEventRelayService {
  private subscriptions: Subscription[] = [];

  constructor(
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: IWebviewManager,
    @inject(TOKENS.LOGGER) private readonly logger: any
  ) {}

  /**
   * Initialize all EventBus → Webview subscriptions
   */
  initialize(): void {
    this.logger.info(
      '[ClaudeEventRelay] Initializing event relay subscriptions...'
    );

    // 1. Content streaming chunks
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeContentChunkEvent>(CLAUDE_DOMAIN_EVENTS.CONTENT_CHUNK)
        .subscribe((event) => {
          const payload: ChatMessageChunkPayload = {
            sessionId: event.payload.sessionId,
            messageId: event.payload.chunk.messageId || MessageId.create(), // Fallback if missing
            content: event.payload.chunk.delta,
            isComplete: false,
            streaming: true,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
            payload,
          });
        })
    );

    // 2. Thinking events
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeThinkingEventPayload>(CLAUDE_DOMAIN_EVENTS.THINKING)
        .subscribe((event) => {
          const payload: ChatThinkingPayload = {
            sessionId: event.payload.sessionId,
            content: event.payload.thinking.content,
            timestamp: event.payload.thinking.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.THINKING,
            payload,
          });
        })
    );

    // 3. Tool events (start, progress, result, error)
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_START)
        .subscribe((event) => {
          const payload: ChatToolStartPayload = {
            sessionId: event.payload.sessionId,
            toolCallId: event.payload.event.toolCallId,
            tool: event.payload.event.tool || 'unknown',
            args: event.payload.event.args || {},
            timestamp: event.payload.event.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.TOOL_START,
            payload,
          });
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_PROGRESS)
        .subscribe((event) => {
          const payload: ChatToolProgressPayload = {
            sessionId: event.payload.sessionId,
            toolCallId: event.payload.event.toolCallId,
            message: event.payload.event.message || '',
            timestamp: event.payload.event.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.TOOL_PROGRESS,
            payload,
          });
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_RESULT)
        .subscribe((event) => {
          const payload: ChatToolResultPayload = {
            sessionId: event.payload.sessionId,
            toolCallId: event.payload.event.toolCallId,
            output: event.payload.event.output,
            duration: event.payload.event.duration || 0,
            timestamp: event.payload.event.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.TOOL_RESULT,
            payload,
          });
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_ERROR)
        .subscribe((event) => {
          const payload: ChatToolErrorPayload = {
            sessionId: event.payload.sessionId,
            toolCallId: event.payload.event.toolCallId,
            error: event.payload.event.error || 'Unknown tool error',
            timestamp: event.payload.event.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.TOOL_ERROR,
            payload,
          });
        })
    );

    // 4. Permission events
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudePermissionRequestEvent>(
          CLAUDE_DOMAIN_EVENTS.PERMISSION_REQUESTED
        )
        .subscribe((event) => {
          const payload: ChatPermissionRequestPayload = {
            id: event.payload.request.toolCallId,
            tool: event.payload.request.tool,
            action: JSON.stringify(event.payload.request.args), // Serialize args as action
            description: event.payload.request.description,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.PERMISSION_REQUEST,
            payload,
          });
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudePermissionResponseEvent>(
          CLAUDE_DOMAIN_EVENTS.PERMISSION_RESPONDED
        )
        .subscribe((event) => {
          const payload: ChatPermissionResponsePayload = {
            requestId: event.payload.response.toolCallId,
            response: event.payload.response.decision,
            timestamp: event.payload.response.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE,
            payload,
          });
        })
    );

    // 5. Agent lifecycle events
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeAgentStartedEvent>(CLAUDE_DOMAIN_EVENTS.AGENT_STARTED)
        .subscribe((event) => {
          const payload: ChatAgentStartedPayload = {
            sessionId: event.payload.sessionId,
            agentId: event.payload.agent.agentId,
            subagentType: event.payload.agent.subagentType,
            description: event.payload.agent.description,
            timestamp: event.payload.agent.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.AGENT_STARTED,
            payload,
          });
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeAgentActivityEventPayload>(
          CLAUDE_DOMAIN_EVENTS.AGENT_ACTIVITY
        )
        .subscribe((event) => {
          const payload: ChatAgentActivityPayload = {
            sessionId: event.payload.sessionId,
            agentId: event.payload.agent.agentId,
            toolName: event.payload.agent.toolName,
            timestamp: event.payload.agent.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.AGENT_ACTIVITY,
            payload,
          });
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeAgentCompletedEvent>(
          CLAUDE_DOMAIN_EVENTS.AGENT_COMPLETED
        )
        .subscribe((event) => {
          const payload: ChatAgentCompletedPayload = {
            sessionId: event.payload.sessionId,
            agentId: event.payload.agent.agentId,
            duration: event.payload.agent.duration,
            result: event.payload.agent.result,
            timestamp: event.payload.agent.timestamp,
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.AGENT_COMPLETED,
            payload,
          });
        })
    );

    // 6. Session lifecycle
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeSessionInitEvent>(CLAUDE_DOMAIN_EVENTS.SESSION_INIT)
        .subscribe((event) => {
          const payload: ChatSessionInitPayload = {
            sessionId: event.payload.sessionId,
            claudeSessionId: event.payload.claudeSessionId,
            model: event.payload.model,
            timestamp: Date.now(),
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.SESSION_INIT,
            payload,
          });
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeSessionEndEvent>(CLAUDE_DOMAIN_EVENTS.SESSION_END)
        .subscribe((event) => {
          const payload: ChatSessionEndPayload = {
            sessionId: event.payload.sessionId,
            reason: event.payload.reason,
            timestamp: Date.now(),
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.SESSION_END,
            payload,
          });
        })
    );

    // 7. Health updates
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeHealthUpdateEvent>(CLAUDE_DOMAIN_EVENTS.HEALTH_UPDATE)
        .subscribe((event) => {
          const payload: ChatHealthUpdatePayload = {
            available: event.payload.health.available,
            version: event.payload.health.version,
            responseTime: event.payload.health.responseTime,
            error: event.payload.health.error,
            timestamp: Date.now(),
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.HEALTH_UPDATE,
            payload,
          });
        })
    );

    // 8. CLI errors
    this.subscriptions.push(
      this.eventBus
        .subscribe<ClaudeErrorEvent>(CLAUDE_DOMAIN_EVENTS.CLI_ERROR)
        .subscribe((event) => {
          const payload: ChatCliErrorPayload = {
            sessionId: event.payload.sessionId,
            error: event.payload.error,
            context: event.payload.context,
            timestamp: Date.now(),
          };

          this.webviewManager.postMessage({
            type: CHAT_MESSAGE_TYPES.CLI_ERROR,
            payload,
          });
        })
    );

    this.logger.info(
      `[ClaudeEventRelay] Initialized ${this.subscriptions.length} event relay subscriptions`
    );
  }

  /**
   * Clean up all subscriptions
   */
  dispose(): void {
    this.logger.info(
      '[ClaudeEventRelay] Disposing event relay subscriptions...'
    );
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }
}
