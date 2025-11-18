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
        .subscribe(CLAUDE_DOMAIN_EVENTS.CONTENT_CHUNK as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeContentChunkEvent;
              const payload: ChatMessageChunkPayload = {
                sessionId: typedPayload.sessionId,
                messageId: MessageId.create(), // Always create new ID for chunks
                content: typedPayload.chunk.delta,
                isComplete: false,
                streaming: true,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding CONTENT_CHUNK:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] CONTENT_CHUNK subscription error:',
              err
            ),
        })
    );

    // 2. Thinking events
    this.subscriptions.push(
      this.eventBus.subscribe(CLAUDE_DOMAIN_EVENTS.THINKING as any).subscribe({
        next: (event: any) => {
          try {
            const typedPayload = event.payload as ClaudeThinkingEventPayload;
            const payload: ChatThinkingPayload = {
              sessionId: typedPayload.sessionId,
              content: typedPayload.thinking.content,
              timestamp: typedPayload.thinking.timestamp,
            };

            this.webviewManager.postMessage({
              type: CHAT_MESSAGE_TYPES.THINKING,
              payload,
            });
          } catch (error) {
            this.logger.error(
              '[ClaudeEventRelay] Error forwarding THINKING:',
              error
            );
          }
        },
        error: (err) =>
          this.logger.error(
            '[ClaudeEventRelay] THINKING subscription error:',
            err
          ),
      })
    );

    // 3. Tool events (start, progress, result, error)
    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.TOOL_START as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeToolEventPayload;
              const toolEvent = typedPayload.event as any; // ClaudeToolEvent is discriminated union
              const payload: ChatToolStartPayload = {
                sessionId: typedPayload.sessionId,
                toolCallId: toolEvent.toolCallId,
                tool: toolEvent.tool || 'unknown',
                args: toolEvent.args || {},
                timestamp: toolEvent.timestamp,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.TOOL_START,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding TOOL_START:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] TOOL_START subscription error:',
              err
            ),
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.TOOL_PROGRESS as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeToolEventPayload;
              const toolEvent = typedPayload.event as any; // ClaudeToolEvent is discriminated union
              const payload: ChatToolProgressPayload = {
                sessionId: typedPayload.sessionId,
                toolCallId: toolEvent.toolCallId,
                message: toolEvent.message || '',
                timestamp: toolEvent.timestamp,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.TOOL_PROGRESS,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding TOOL_PROGRESS:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] TOOL_PROGRESS subscription error:',
              err
            ),
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.TOOL_RESULT as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeToolEventPayload;
              const toolEvent = typedPayload.event as any; // ClaudeToolEvent is discriminated union
              const payload: ChatToolResultPayload = {
                sessionId: typedPayload.sessionId,
                toolCallId: toolEvent.toolCallId,
                output: toolEvent.output,
                duration: toolEvent.duration || 0,
                timestamp: toolEvent.timestamp,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.TOOL_RESULT,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding TOOL_RESULT:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] TOOL_RESULT subscription error:',
              err
            ),
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.TOOL_ERROR as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeToolEventPayload;
              const toolEvent = typedPayload.event as any; // ClaudeToolEvent is discriminated union
              const payload: ChatToolErrorPayload = {
                sessionId: typedPayload.sessionId,
                toolCallId: toolEvent.toolCallId,
                error: toolEvent.error || 'Unknown tool error',
                timestamp: toolEvent.timestamp,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.TOOL_ERROR,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding TOOL_ERROR:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] TOOL_ERROR subscription error:',
              err
            ),
        })
    );

    // 4. Permission events
    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.PERMISSION_REQUESTED as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload =
                event.payload as ClaudePermissionRequestEvent;
              const payload: ChatPermissionRequestPayload = {
                id: typedPayload.request.toolCallId,
                tool: typedPayload.request.tool,
                action: JSON.stringify(typedPayload.request.args),
                description: typedPayload.request.description,
                timestamp: Date.now(),
                sessionId: typedPayload.sessionId,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.PERMISSION_REQUEST,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding PERMISSION_REQUESTED:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] PERMISSION_REQUESTED subscription error:',
              err
            ),
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.PERMISSION_RESPONDED as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload =
                event.payload as ClaudePermissionResponseEvent;
              const payload: ChatPermissionResponsePayload = {
                requestId: typedPayload.response.toolCallId,
                response: typedPayload.response.decision,
                timestamp: typedPayload.response.timestamp,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding PERMISSION_RESPONDED:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] PERMISSION_RESPONDED subscription error:',
              err
            ),
        })
    );

    // 5. Agent lifecycle events
    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.AGENT_STARTED as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as any;
              const payload: ChatAgentStartedPayload = {
                sessionId: typedPayload.sessionId,
                agent: typedPayload.agent,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.AGENT_STARTED,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding AGENT_STARTED:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] AGENT_STARTED subscription error:',
              err
            ),
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.AGENT_ACTIVITY as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as any;
              const payload: ChatAgentActivityPayload = {
                sessionId: typedPayload.sessionId,
                agent: typedPayload.agent,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.AGENT_ACTIVITY,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding AGENT_ACTIVITY:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] AGENT_ACTIVITY subscription error:',
              err
            ),
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.AGENT_COMPLETED as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as any;
              const payload: ChatAgentCompletedPayload = {
                sessionId: typedPayload.sessionId,
                agent: typedPayload.agent,
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.AGENT_COMPLETED,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding AGENT_COMPLETED:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] AGENT_COMPLETED subscription error:',
              err
            ),
        })
    );

    // 6. Session lifecycle
    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.SESSION_INIT as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeSessionInitEvent;
              const payload: ChatSessionInitPayload = {
                sessionId: typedPayload.sessionId,
                claudeSessionId: typedPayload.claudeSessionId,
                model: typedPayload.model,
                timestamp: Date.now(),
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.SESSION_INIT,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding SESSION_INIT:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] SESSION_INIT subscription error:',
              err
            ),
        })
    );

    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.SESSION_END as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeSessionEndEvent;
              const payload: ChatSessionEndPayload = {
                sessionId: typedPayload.sessionId,
                reason: typedPayload.reason,
                timestamp: Date.now(),
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.SESSION_END,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding SESSION_END:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] SESSION_END subscription error:',
              err
            ),
        })
    );

    // 7. Health updates
    this.subscriptions.push(
      this.eventBus
        .subscribe(CLAUDE_DOMAIN_EVENTS.HEALTH_UPDATE as any)
        .subscribe({
          next: (event: any) => {
            try {
              const typedPayload = event.payload as ClaudeHealthUpdateEvent;
              const payload: ChatHealthUpdatePayload = {
                available: typedPayload.health.available,
                version: typedPayload.health.version,
                responseTime: typedPayload.health.responseTime,
                error: typedPayload.health.error,
                timestamp: Date.now(),
              };

              this.webviewManager.postMessage({
                type: CHAT_MESSAGE_TYPES.HEALTH_UPDATE,
                payload,
              });
            } catch (error) {
              this.logger.error(
                '[ClaudeEventRelay] Error forwarding HEALTH_UPDATE:',
                error
              );
            }
          },
          error: (err) =>
            this.logger.error(
              '[ClaudeEventRelay] HEALTH_UPDATE subscription error:',
              err
            ),
        })
    );

    // 8. CLI errors
    this.subscriptions.push(
      this.eventBus.subscribe(CLAUDE_DOMAIN_EVENTS.CLI_ERROR as any).subscribe({
        next: (event: any) => {
          try {
            const typedPayload = event.payload as ClaudeErrorEvent;
            const payload: ChatCliErrorPayload = {
              sessionId: typedPayload.sessionId,
              error: typedPayload.error,
              context: typedPayload.context,
              timestamp: Date.now(),
            };

            this.webviewManager.postMessage({
              type: CHAT_MESSAGE_TYPES.CLI_ERROR,
              payload,
            });
          } catch (error) {
            this.logger.error(
              '[ClaudeEventRelay] Error forwarding CLI_ERROR:',
              error
            );
          }
        },
        error: (err) =>
          this.logger.error(
            '[ClaudeEventRelay] CLI_ERROR subscription error:',
            err
          ),
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
