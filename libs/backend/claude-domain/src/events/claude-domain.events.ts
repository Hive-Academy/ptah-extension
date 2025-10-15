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
} from '@ptah-extension/shared';

/**
 * Event topics for claude-domain
 */
export const CLAUDE_DOMAIN_EVENTS = {
  // Content streaming
  CONTENT_CHUNK: 'claude:content:chunk',
  THINKING: 'claude:thinking',

  // Tool execution
  TOOL_START: 'claude:tool:start',
  TOOL_PROGRESS: 'claude:tool:progress',
  TOOL_RESULT: 'claude:tool:result',
  TOOL_ERROR: 'claude:tool:error',

  // Permissions
  PERMISSION_REQUESTED: 'claude:permission:requested',
  PERMISSION_RESPONDED: 'claude:permission:responded',

  // Session lifecycle
  SESSION_INIT: 'claude:session:init',
  SESSION_END: 'claude:session:end',

  // Health
  HEALTH_UPDATE: 'claude:health:update',

  // Errors
  CLI_ERROR: 'claude:error',
} as const;

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

/**
 * Event bus interface (to be implemented by vscode-core EventBus)
 */
export interface IEventBus {
  publish<T>(topic: string, payload: T): void;
}

/**
 * DI token for EventBus - must match registration in di/register.ts
 * Uses Symbol.for() for consistency with other domain service tokens
 */
export const EVENT_BUS = Symbol.for('EventBus');

/**
 * Event publishers - convenience functions for emitting typed events
 */
@injectable()
export class ClaudeDomainEventPublisher {
  constructor(@inject(EVENT_BUS) private readonly eventBus: IEventBus) {}

  emitContentChunk(sessionId: SessionId, chunk: ClaudeContentChunk): void {
    this.eventBus.publish<ClaudeContentChunkEvent>(
      CLAUDE_DOMAIN_EVENTS.CONTENT_CHUNK,
      {
        sessionId,
        chunk,
      }
    );
  }

  emitThinking(sessionId: SessionId, thinking: ClaudeThinkingEvent): void {
    this.eventBus.publish<ClaudeThinkingEventPayload>(
      CLAUDE_DOMAIN_EVENTS.THINKING,
      {
        sessionId,
        thinking,
      }
    );
  }

  emitToolEvent(sessionId: SessionId, event: ClaudeToolEvent): void {
    const topic =
      event.type === 'start'
        ? CLAUDE_DOMAIN_EVENTS.TOOL_START
        : event.type === 'progress'
        ? CLAUDE_DOMAIN_EVENTS.TOOL_PROGRESS
        : event.type === 'result'
        ? CLAUDE_DOMAIN_EVENTS.TOOL_RESULT
        : CLAUDE_DOMAIN_EVENTS.TOOL_ERROR;

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
      CLAUDE_DOMAIN_EVENTS.PERMISSION_REQUESTED,
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
      CLAUDE_DOMAIN_EVENTS.PERMISSION_RESPONDED,
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
      CLAUDE_DOMAIN_EVENTS.SESSION_INIT,
      {
        sessionId,
        claudeSessionId,
        model,
      }
    );
  }

  emitSessionEnd(sessionId: SessionId, reason?: string): void {
    this.eventBus.publish<ClaudeSessionEndEvent>(
      CLAUDE_DOMAIN_EVENTS.SESSION_END,
      {
        sessionId,
        reason,
      }
    );
  }

  emitHealthUpdate(health: ClaudeCliHealth): void {
    this.eventBus.publish<ClaudeHealthUpdateEvent>(
      CLAUDE_DOMAIN_EVENTS.HEALTH_UPDATE,
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
    this.eventBus.publish<ClaudeErrorEvent>(CLAUDE_DOMAIN_EVENTS.CLI_ERROR, {
      sessionId,
      error,
      context,
    });
  }
}
