// Core Services - Angular 20+ Signal-Based State Management
// Core Services - Foundation Layer (0 dependencies)
export * from './logging.service';
export {
  VSCodeService,
  provideVSCodeService,
  initializeVSCodeService,
  type WebviewConfig,
} from './vscode.service';
export * from './message-handler.service';

// Core Services - State Layer (depend on foundation)
export * from './app-state.service';
export * from './webview-config.service';
export * from './view-manager.service';
export * from './webview-navigation.service';

// File Management Layer (workspace file operations)
export { FilePickerService } from './file-picker.service';

// Chat Layer (pure chat logic, state management, validation, transformations)
export { ChatStateService } from './chat-state.service';
export { ChatValidationService } from './chat-validation.service';
export { ClaudeMessageTransformerService } from './claude-message-transformer.service';
export { MessageProcessingService } from './message-processing.service';
export * from './chat-state-manager.service';
export * from './chat.service';

// Provider Layer (AI provider management and health monitoring)
export {
  ProviderService,
  type ProviderInfo,
  type ProviderHealth,
  type ProviderError,
  type ProviderSwitchEvent,
} from './provider.service';

// Streaming Layer (chat message streaming state)
export {
  StreamHandlingService,
  type StreamState,
} from './stream-handling.service';

// Analytics Layer (system analytics and metrics)
export {
  AnalyticsService,
  type AnalyticsData,
  type PerformanceData,
  type ActivityItem,
} from './analytics.service';
