// Main entry point for core library
export * from './lib/services';

// Export LogLevel enum for external configuration
export { LogLevel, type LoggingConfig } from './lib/services/logging.service';

// Note: ChatService removed - use ChatStore from @ptah-extension/chat instead
// Note: ChatStateService removed - functionality moved to ChatStore
