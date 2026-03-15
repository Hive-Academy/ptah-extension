// Registration function (primary export)
export { registerPlatformVscodeServices } from './registration';

// Implementation classes (for testing/extension only)
export { VscodeFileSystemProvider } from './implementations/vscode-file-system-provider';
export { VscodeStateStorage } from './implementations/vscode-state-storage';
export { VscodeSecretStorage } from './implementations/vscode-secret-storage';
export { VscodeWorkspaceProvider } from './implementations/vscode-workspace-provider';
export { VscodeUserInteraction } from './implementations/vscode-user-interaction';
export { VscodeOutputChannel } from './implementations/vscode-output-channel';
export { VscodeCommandRegistry } from './implementations/vscode-command-registry';
export { VscodeEditorProvider } from './implementations/vscode-editor-provider';
