/**
 * Messaging Module Exports
 * Provides centralized access to all messaging-related components
 */

export { EventBus } from './event-bus';
export type { TypedEvent, RequestEvent, ResponseEvent } from './event-bus';

export { WebviewMessageBridge } from './webview-message-bridge';
