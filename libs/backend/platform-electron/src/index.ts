// Registration function (primary export)
export { registerPlatformElectronServices } from './registration';
export type { ElectronPlatformOptions } from './registration';

// Implementations (for direct use if needed)
export { ElectronFileSystemProvider } from './implementations/electron-file-system-provider';
export { ElectronStateStorage } from './implementations/electron-state-storage';
export { ElectronSecretStorage } from './implementations/electron-secret-storage';
export type { SafeStorageApi } from './implementations/electron-secret-storage';
export { ElectronWorkspaceProvider } from './implementations/electron-workspace-provider';
export { ElectronUserInteraction } from './implementations/electron-user-interaction';
export type {
  ElectronDialogApi,
  ElectronBrowserWindowApi,
  ElectronShellApi,
} from './implementations/electron-user-interaction';
export { ElectronOutputChannel } from './implementations/electron-output-channel';
export { ElectronCommandRegistry } from './implementations/electron-command-registry';
export { ElectronEditorProvider } from './implementations/electron-editor-provider';
export { ElectronDiagnosticsProvider } from './implementations/electron-diagnostics-provider';
