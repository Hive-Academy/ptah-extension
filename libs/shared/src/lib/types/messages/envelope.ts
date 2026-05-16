/**
 * Message envelope / request-response / metadata types.
 */

import type { SessionId, CorrelationId } from '../branded.types';
import type {
  ContentBlock,
  TextContentBlock,
  ThinkingContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
} from '../content-block.types';

import type { MessagePayloadMap } from './payload-map';

// Re-export for convenience
export { CorrelationId };

// Re-export ContentBlock types from foundation layer
export type {
  ContentBlock,
  TextContentBlock,
  ThinkingContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
};

/**
 * Generic Message Interface with Strict Typing
 */
export interface StrictMessage<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap,
> {
  readonly id: CorrelationId;
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
  readonly metadata: MessageMetadata;
}

/**
 * Message Metadata with structured information
 */
export interface MessageMetadata {
  readonly timestamp: number;
  readonly source: 'extension' | 'webview';
  readonly sessionId?: SessionId;
  readonly version: string;
}

/**
 * Request-Response Message Types
 */
export interface MessageRequest<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap,
> {
  readonly id: CorrelationId;
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
  readonly metadata: MessageMetadata;
  readonly timeout?: number;
}

export interface MessageResponse<T = unknown> {
  readonly requestId: CorrelationId;
  readonly success: boolean;
  readonly data?: T;
  readonly error?: MessageError;
  readonly metadata: MessageMetadata;
}

/**
 * Structured Error Information
 */
export interface MessageError {
  readonly code: string;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly stack?: string;
}
