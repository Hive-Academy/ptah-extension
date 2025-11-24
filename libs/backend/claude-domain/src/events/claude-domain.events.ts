/**
 * Claude Domain Events - Typed event topics and publishers
 * SOLID: Single Responsibility - Only event definition and emission helpers
 */

import {
  ClaudeAgentActivityEvent,
  ClaudeAgentCompleteEvent,
  ClaudeAgentStartEvent,
  ClaudeCliHealth,
  ClaudeContentChunk,
  ClaudePermissionRequest,
  ClaudePermissionResponse,
  ClaudeThinkingEvent,
  ClaudeToolEvent,
  SessionId,
} from '@ptah-extension/shared';

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
