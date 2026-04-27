/**
 * Platform provider mocks — public barrel.
 *
 * Each factory returns a `jest.Mocked<I...>` typed against the production
 * interface in `libs/backend/platform-core/src/interfaces/*.interface.ts`, so
 * any signature drift surfaces as a TypeScript compile error rather than a
 * runtime surprise in downstream specs.
 */

export {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
  type MockFileSystemProviderState,
} from './file-system-provider.mock';

export {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
  type MockWorkspaceProviderState,
  type MockWorkspaceProviderOverrides,
} from './workspace-provider.mock';

export {
  createMockSecretStorage,
  type MockSecretStorage,
  type MockSecretStorageState,
  type MockSecretStorageOverrides,
} from './secret-storage.mock';

export {
  createMockStateStorage,
  type MockStateStorage,
  type MockStateStorageState,
  type MockStateStorageOverrides,
} from './state-storage.mock';

export {
  createMockUserInteraction,
  type MockUserInteraction,
} from './user-interaction.mock';

export {
  createMockOutputChannel,
  type MockOutputChannel,
  type MockOutputChannelState,
  type MockOutputChannelOverrides,
} from './output-channel.mock';

export {
  createMockCommandRegistry,
  type MockCommandRegistry,
  type MockCommandRegistryState,
} from './command-registry.mock';

export {
  createMockEditorProvider,
  type MockEditorProvider,
  type MockEditorProviderState,
} from './editor-provider.mock';

export {
  createMockDiagnosticsProvider,
  type MockDiagnosticsProvider,
  type MockDiagnosticsProviderState,
  type MockDiagnosticsProviderOverrides,
} from './diagnostics-provider.mock';

export {
  createMockTokenCounter,
  type MockTokenCounter,
  type MockTokenCounterOverrides,
} from './token-counter.mock';

export {
  createMockAuthProvider,
  type MockAuthProvider,
  type MockAuthProviderOverrides,
} from './auth-provider.mock';

export {
  createMockPlatformCommands,
  type MockPlatformCommands,
} from './commands.mock';
