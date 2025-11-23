// Core Services - Angular 20+ Signal-Based State Management
// Core Services - Foundation Layer (0 dependencies)
export * from './logging.service';
export {
  VSCodeService,
  provideVSCodeService,
  initializeVSCodeService,
  type WebviewConfig,
} from './vscode.service';
// DELETED: MessageHandlerService - redundant, components subscribe directly to VSCodeService

// Core Services - State Layer (depend on foundation)
export * from './app-state.service';
export * from './webview-navigation.service';

// File Management Layer (workspace file operations)
// MOVED: FilePickerService → @ptah-extension/chat (chat-specific UI)

// Chat Layer (pure chat logic, state management, validation, transformations)
export { ChatStateService } from './chat-state.service';
// export { ChatValidationService } from './chat-validation.service'; // DELETED in Phase 0
// export { ClaudeMessageTransformerService } from './claude-message-transformer.service'; // DELETED in Phase 0
// export { MessageProcessingService } from './message-processing.service'; // DELETED in Phase 0
// MOVED: ChatStateManagerService → @ptah-extension/chat (chat-specific UI)
export * from './chat.service';

// Provider Layer (AI provider management and health monitoring)
// export { // DELETED in Phase 0
//   ProviderService,
//   type ProviderInfo,
//   type ProviderHealth,
//   type ProviderError,
//   type ProviderSwitchEvent,
// } from './provider.service';

// Analytics Layer (system analytics and metrics)
export {
  AnalyticsService,
  type AnalyticsData,
  type PerformanceData,
  type ActivityItem,
} from './analytics.service';
