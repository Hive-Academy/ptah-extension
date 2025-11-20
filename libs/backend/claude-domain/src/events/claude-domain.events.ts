/**
 * Claude Domain Events - Typed event topics and publishers
 * SOLID: Single Responsibility - Only event definition and emission helpers
 */

import { injectable, inject } from 'tsyringe';
import {
  SessionId,
  ClaudeContentChunk,
  ClaudeThinkingEvent,
  ClaudeToolEvent,
  ClaudePermissionRequest,
  ClaudePermissionResponse,
  ClaudeCliHealth,
  ClaudeAgentStartEvent,
  ClaudeAgentActivityEvent,
  ClaudeAgentCompleteEvent,
  CHAT_MESSAGE_TYPES,
  ContentBlock,
} from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * Event payload types
 */
export interface ClaudeContentChunkEvent {
  readonly sessionId: SessionId;
  readonly chunk: ClaudeContentChunk;
}

export interface ClaudeThinkingEventPayload {
  readonly sessionId: SessionId;
  readonly thinking: ClaudeThinkingEvent;
}

export interface ClaudeToolEventPayload {
  readonly sessionId: SessionId;
  readonly event: ClaudeToolEvent;
}

export interface ClaudePermissionRequestEvent {
  readonly sessionId: SessionId;
  readonly request: ClaudePermissionRequest;
}

export interface ClaudePermissionResponseEvent {
  readonly sessionId: SessionId;
  readonly response: ClaudePermissionResponse;
}

export interface ClaudeSessionInitEvent {
  readonly sessionId: SessionId;
  readonly claudeSessionId: string;
  readonly model?: string;
}

export interface ClaudeSessionEndEvent {
  readonly sessionId: SessionId;
  readonly reason?: string;
}

export interface ClaudeHealthUpdateEvent {
  readonly health: ClaudeCliHealth;
}

export interface ClaudeErrorEvent {
  readonly sessionId?: SessionId;
  readonly error: string;
  readonly context?: Record<string, unknown>;
}

export interface ClaudeAgentStartedEvent {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentStartEvent;
}

export interface ClaudeAgentActivityEventPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentActivityEvent;
}

export interface ClaudeAgentCompletedEvent {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentCompleteEvent;
}

export interface ClaudeMessageCompleteEvent {
  readonly sessionId: SessionId;
}

export interface ClaudeTokenUsageEvent {
  readonly sessionId: SessionId;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheCreationTokens: number;
    readonly totalCost: number;
  };
}

/**
 * Event bus interface (to be implemented by vscode-core EventBus)
 */
export interface IEventBus {
  publish<T>(topic: string, payload: T): void;
}

/**
 * Event publishers - convenience functions for emitting typed events
 */
@injectable()
export class ClaudeDomainEventPublisher {
  constructor(@inject(TOKENS.EVENT_BUS) private readonly eventBus: IEventBus) {}

  emitContentChunk(
    sessionId: SessionId,
    blocks: readonly ContentBlock[]
  ): void {
    // NOTE: This emits an INTERNAL event 'claude:domain:contentChunk'
    // NOT MESSAGE_CHUNK which is the user-facing webview event
    // message-handler.service.ts transforms the stream into proper MESSAGE_CHUNK events

    // INTERNAL event topic (NOT in CHAT_MESSAGE_TYPES - internal to claude-domain)
    const INTERNAL_CONTENT_CHUNK = 'claude:domain:contentChunk';

    // Construct ClaudeContentChunk with blocks
    const chunk: ClaudeContentChunk = {
      type: 'content',
      blocks,
      timestamp: Date.now(),
    };

    this.eventBus.publish<ClaudeContentChunkEvent>(INTERNAL_CONTENT_CHUNK, {
      sessionId,
      chunk,
    });
  }

  emitThinking(sessionId: SessionId, thinking: ClaudeThinkingEvent): void {
    // Flatten the thinking structure to match webview payload expectations
    // Webview expects ChatThinkingPayload (flat structure)
    // NOT ClaudeThinkingEventPayload (nested structure)
    this.eventBus.publish(CHAT_MESSAGE_TYPES.THINKING, {
      sessionId,
      content: thinking.content,
      timestamp: thinking.timestamp,
    });
  }

  emitToolEvent(sessionId: SessionId, event: ClaudeToolEvent): void {
    // Flatten the event structure to match webview payload expectations
    // Webview expects ChatToolStartPayload, ChatToolResultPayload, etc. (flat structure)
    // NOT ClaudeToolEventPayload (nested structure)

    if (event.type === 'start') {
      this.eventBus.publish(CHAT_MESSAGE_TYPES.TOOL_START, {
        sessionId,
        toolCallId: event.toolCallId,
        tool: event.tool,
        args: event.args,
        timestamp: event.timestamp,
      });
    } else if (event.type === 'progress') {
      this.eventBus.publish(CHAT_MESSAGE_TYPES.TOOL_PROGRESS, {
        sessionId,
        toolCallId: event.toolCallId,
        message: event.message,
        timestamp: event.timestamp,
      });
    } else if (event.type === 'result') {
      this.eventBus.publish(CHAT_MESSAGE_TYPES.TOOL_RESULT, {
        sessionId,
        toolCallId: event.toolCallId,
        output: event.output,
        duration: event.duration,
        timestamp: event.timestamp,
      });
    } else if (event.type === 'error') {
      this.eventBus.publish(CHAT_MESSAGE_TYPES.TOOL_ERROR, {
        sessionId,
        toolCallId: event.toolCallId,
        error: event.error,
        timestamp: event.timestamp,
      });
    }
  }

  emitPermissionRequested(
    sessionId: SessionId,
    request: ClaudePermissionRequest
  ): void {
    // Flatten the request structure to match webview payload expectations
    // ChatPermissionRequestPayload expects: id, tool, action, description, timestamp, sessionId
    // ClaudePermissionRequest has: toolCallId, tool, args, description?, timestamp
    this.eventBus.publish(CHAT_MESSAGE_TYPES.PERMISSION_REQUEST, {
      id: request.toolCallId,
      tool: request.tool,
      action: JSON.stringify(request.args), // Convert args object to string for action field
      description: request.description || '',
      timestamp: request.timestamp,
      sessionId,
    });
  }

  emitPermissionResponded(
    sessionId: SessionId,
    response: ClaudePermissionResponse
  ): void {
    // Flatten the response structure to match webview payload expectations
    // ChatPermissionResponsePayload expects: requestId, decision, timestamp, sessionId
    // ClaudePermissionResponse has: decision, provenance, timestamp
    this.eventBus.publish(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE, {
      requestId: 'unknown', // ClaudePermissionResponse doesn't have requestId - need to track this
      decision: response.decision,
      timestamp: response.timestamp,
      sessionId,
    });
  }

  emitSessionInit(
    sessionId: SessionId,
    claudeSessionId: string,
    model?: string
  ): void {
    this.eventBus.publish<ClaudeSessionInitEvent>(
      CHAT_MESSAGE_TYPES.SESSION_INIT,
      {
        sessionId,
        claudeSessionId,
        model,
      }
    );
  }

  emitSessionEnd(sessionId: SessionId, reason?: string): void {
    this.eventBus.publish<ClaudeSessionEndEvent>(
      CHAT_MESSAGE_TYPES.SESSION_END,
      {
        sessionId,
        reason,
      }
    );
  }

  emitHealthUpdate(health: ClaudeCliHealth): void {
    this.eventBus.publish<ClaudeHealthUpdateEvent>(
      CHAT_MESSAGE_TYPES.HEALTH_UPDATE,
      {
        health,
      }
    );
  }

  emitError(
    error: string,
    sessionId?: SessionId,
    context?: Record<string, unknown>
  ): void {
    this.eventBus.publish<ClaudeErrorEvent>(CHAT_MESSAGE_TYPES.CLI_ERROR, {
      sessionId,
      error,
      context,
    });
  }

  emitAgentStarted(sessionId: SessionId, agent: ClaudeAgentStartEvent): void {
    this.eventBus.publish<ClaudeAgentStartedEvent>(
      CHAT_MESSAGE_TYPES.AGENT_STARTED,
      { sessionId, agent }
    );
  }

  emitAgentActivity(
    sessionId: SessionId,
    agent: ClaudeAgentActivityEvent
  ): void {
    this.eventBus.publish<ClaudeAgentActivityEventPayload>(
      CHAT_MESSAGE_TYPES.AGENT_ACTIVITY,
      { sessionId, agent }
    );
  }

  emitAgentCompleted(
    sessionId: SessionId,
    agent: ClaudeAgentCompleteEvent
  ): void {
    this.eventBus.publish<ClaudeAgentCompletedEvent>(
      CHAT_MESSAGE_TYPES.AGENT_COMPLETED,
      { sessionId, agent }
    );
  }

  emitMessageComplete(sessionId: SessionId): void {
    this.eventBus.publish<ClaudeMessageCompleteEvent>(
      CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE,
      { sessionId }
    );
  }

  emitTokenUsage(
    sessionId: SessionId,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      totalCost: number;
    }
  ): void {
    this.eventBus.publish<ClaudeTokenUsageEvent>(
      CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED,
      { sessionId, usage }
    );
  }
}
