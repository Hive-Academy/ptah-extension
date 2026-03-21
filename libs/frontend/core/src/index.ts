// Main entry point for core library
export * from './lib/services';

// Export LogLevel enum for external configuration
export { LogLevel, type LoggingConfig } from './lib/services/logging.service';

// Tokens for cross-library dependency inversion
export {
  SESSION_DATA_PROVIDER,
  type ISessionDataProvider,
} from './lib/tokens/session-data.token';

export {
  WORKSPACE_COORDINATOR,
  type IWorkspaceCoordinator,
} from './lib/tokens/workspace-coordinator.token';
