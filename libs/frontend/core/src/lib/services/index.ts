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
