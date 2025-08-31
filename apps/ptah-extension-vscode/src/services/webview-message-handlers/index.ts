// Export all message handlers for easy importing
export { IWebviewMessageHandler, BaseWebviewMessageHandler } from './base-message-handler';
export { ChatMessageHandler } from './chat-message-handler';
export { CommandMessageHandler } from './command-message-handler';
export { ContextMessageHandler } from './context-message-handler';
export { AnalyticsMessageHandler } from './analytics-message-handler';
export { StateMessageHandler } from './state-message-handler';
export { ViewMessageHandler } from './view-message-handler';
export { ConfigMessageHandler } from './config-message-handler';
export { ProviderMessageHandler } from './provider-message-handler';
export { WebviewMessageRouter } from './message-router';

// Export additional types for easier imports
export type { StrictPostMessageFunction } from './base-message-handler';
