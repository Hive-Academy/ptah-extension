// Registration function (primary export)
export { registerPlatformVscodeServices } from './registration';

// Settings registration (WP-2B)
export { registerVscodeSettings } from './settings/vscode-settings-registration';
export {
  VscodeSettingsAdapter,
  type VscodeApiSlice,
} from './settings/vscode-settings-adapter';

// Implementation classes (for testing/extension only)
export { VscodeFileSystemProvider } from './implementations/vscode-file-system-provider';
export { VscodeStateStorage } from './implementations/vscode-state-storage';
export { VscodeDiskStateStorage } from './implementations/vscode-disk-state-storage';
export { VscodeSecretStorage } from './implementations/vscode-secret-storage';
export { VscodeWorkspaceProvider } from './implementations/vscode-workspace-provider';
export { VscodeWorkspaceLifecycleProvider } from './implementations/vscode-workspace-lifecycle-provider';
export { VscodeUserInteraction } from './implementations/vscode-user-interaction';
export { VscodeOutputChannel } from './implementations/vscode-output-channel';
export { VscodeCommandRegistry } from './implementations/vscode-command-registry';
export { VscodeEditorProvider } from './implementations/vscode-editor-provider';
export { VscodeDiagnosticsProvider } from './implementations/vscode-diagnostics-provider';
