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

  emitContentChunk(sessionId: SessionId, chunk: ClaudeContentChunk): void {
    // 🔍 DIAGNOSTIC LOGGING: Track MESSAGE_CHUNK events to identify duplicates
    console.log('[MESSAGE_CHUNK]', {
      timestamp: new Date().toISOString(),
      sessionId,
      chunkTimestamp: chunk.timestamp,
      deltaLength: chunk.delta?.length || 0,
      index: chunk.index,
      caller: new Error().stack?.split('\n')[2]?.trim() || 'unknown',
    });

    this.eventBus.publish<ClaudeContentChunkEvent>(
      CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
      {
        sessionId,
        chunk,
      }
    );
  }

  emitThinking(sessionId: SessionId, thinking: ClaudeThinkingEvent): void {
    this.eventBus.publish<ClaudeThinkingEventPayload>(
      CHAT_MESSAGE_TYPES.THINKING,
      {
        sessionId,
        thinking,
      }
    );
  }

  emitToolEvent(sessionId: SessionId, event: ClaudeToolEvent): void {
    const topic =
      event.type === 'start'
        ? CHAT_MESSAGE_TYPES.TOOL_START
        : event.type === 'progress'
        ? CHAT_MESSAGE_TYPES.TOOL_PROGRESS
        : event.type === 'result'
        ? CHAT_MESSAGE_TYPES.TOOL_RESULT
        : CHAT_MESSAGE_TYPES.TOOL_ERROR;

    this.eventBus.publish<ClaudeToolEventPayload>(topic, {
      sessionId,
      event,
    });
  }

  emitPermissionRequested(
    sessionId: SessionId,
    request: ClaudePermissionRequest
  ): void {
    this.eventBus.publish<ClaudePermissionRequestEvent>(
      CHAT_MESSAGE_TYPES.PERMISSION_REQUEST,
      {
        sessionId,
        request,
      }
    );
  }

  emitPermissionResponded(
    sessionId: SessionId,
    response: ClaudePermissionResponse
  ): void {
    this.eventBus.publish<ClaudePermissionResponseEvent>(
      CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE,
      {
        sessionId,
        response,
      }
    );
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
