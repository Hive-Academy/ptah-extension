/**
 * Chat / Context / Analytics wire payloads.
 *
 * Extracted from message.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

import type { SessionId, MessageId, CorrelationId } from '../branded.types';
import type { ContentBlock } from '../content-block.types';
import type { SessionUIData } from '../claude-domain.types';

import type { StrictChatMessage, StrictChatSession } from './session';

// ============================================================================
// Chat Payloads
// ============================================================================

export interface ChatSendMessagePayload {
  readonly content: string;
  readonly files?: readonly string[];
  readonly correlationId?: CorrelationId;
  readonly metadata?: Readonly<{
    model?: string;
    temperature?: number;
  }>;
}

export interface ChatMessageChunkPayload {
  readonly sessionId: SessionId;
  readonly messageId: MessageId;
  readonly contentBlocks: readonly ContentBlock[];
  readonly isComplete: boolean;
  readonly streaming: boolean;
}

export interface ChatSessionStartPayload {
  readonly sessionId: SessionId;
  readonly workspaceId?: string;
}

/**
 * CLI session end payload
 * NOTE: Replaces previous webview session end payload structure
 */
export interface ChatSessionEndPayload {
  readonly sessionId: SessionId;
  readonly reason?: string;
  readonly timestamp: number;
}

export interface ChatNewSessionPayload {
  readonly name?: string;
  readonly workspaceId?: string;
}

export interface ChatSwitchSessionPayload {
  readonly sessionId: SessionId;
}

export interface ChatGetHistoryPayload {
  readonly sessionId: SessionId;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ChatMessageAddedPayload {
  readonly message: StrictChatMessage;
}

export interface ChatMessageCompletePayload {
  readonly message: StrictChatMessage;
}

export interface ChatSessionCreatedPayload {
  readonly session: StrictChatSession;
}

export interface ChatSessionSwitchedPayload {
  readonly session: StrictChatSession;
}

export interface ChatSessionUpdatedPayload {
  readonly session: StrictChatSession;
}

export interface ChatTokenUsageUpdatedPayload {
  readonly sessionId: SessionId;
  readonly tokenUsage: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly percentage: number;
    readonly maxTokens: number;
  };
}

export interface ChatHistoryLoadedPayload {
  readonly messages: readonly StrictChatMessage[];
}

// ============================================================================
// Context Payloads
// ============================================================================

export interface ContextUpdatePayload {
  readonly includedFiles: readonly string[];
  readonly excludedFiles: readonly string[];
  readonly tokenEstimate: number;
}

export interface AnalyticsEventPayload {
  readonly event: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface ContextGetFilesPayload {
  // No payload needed for get files request
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

export interface ContextIncludeFilePayload {
  readonly filePath: string;
}

export interface ContextExcludeFilePayload {
  readonly filePath: string;
}

export interface ContextSearchFilesPayload {
  readonly query: string;
  readonly includeImages?: boolean;
  readonly maxResults?: number;
  readonly fileTypes?: readonly string[];
}

export interface ContextGetAllFilesPayload {
  readonly includeImages?: boolean;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ContextGetFileSuggestionsPayload {
  readonly query: string;
  readonly limit?: number;
}

export interface ContextSearchImagesPayload {
  readonly query: string;
}

// ============================================================================
// Session Management Payloads
// ============================================================================

export interface ChatRenameSessionPayload {
  readonly sessionId: SessionId;
  readonly newName: string;
}

export interface ChatDeleteSessionPayload {
  readonly sessionId: SessionId;
}

export interface ChatBulkDeleteSessionsPayload {
  readonly sessionIds: readonly SessionId[];
}

export interface ChatSessionRenamedPayload {
  readonly sessionId: SessionId;
  readonly newName: string;
}

export interface ChatSessionDeletedPayload {
  readonly sessionId: SessionId;
}

/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface ChatGetSessionStatsPayload {
  // No payload needed for get session stats request
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

export interface ChatStopStreamPayload {
  readonly sessionId: SessionId | null;
  readonly messageId: MessageId | null;
  readonly timestamp: number;
}

export interface ChatStreamStoppedPayload {
  readonly sessionId: SessionId | null;
  readonly messageId: MessageId | null;
  readonly timestamp: number;
  readonly success: boolean;
}

/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface ChatRequestSessionsPayload {
  // No payload needed for request sessions
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

export interface ChatSessionsUpdatedPayload {
  readonly sessions: readonly SessionUIData[];
}
