/**
 * Message type guards and helper factories.
 */

import type { CorrelationId } from '../branded.types';

import type { StrictMessage } from './envelope';
import type { MessagePayloadMap } from './payload-map';
import type { RoutableMessage, SystemMessage, WebviewMessage } from './system';

/**
 * Type guard to check if message is a system message
 */
export function isSystemMessage(
  message: WebviewMessage,
): message is SystemMessage {
  return ['ready', 'webview-ready', 'requestInitialData'].includes(
    message.type,
  );
}

/**
 * Type guard to check if message is a routable message
 */
export function isRoutableMessage(
  message: WebviewMessage,
): message is RoutableMessage {
  return !isSystemMessage(message);
}

/**
 * Helper function to create strict messages with required metadata
 */
export function createStrictMessage<T extends keyof MessagePayloadMap>(
  type: T,
  payload: MessagePayloadMap[T],
  correlationId?: CorrelationId,
): StrictMessage<T> {
  return {
    id: (correlationId ?? crypto.randomUUID()) as CorrelationId,
    type,
    payload,
    metadata: {
      timestamp: Date.now(),
      source: 'webview',
      version: '1.0.0',
    },
  };
}
