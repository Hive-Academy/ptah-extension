/**
 * Platform contract-test runners — public barrel.
 *
 * Each runner wraps a `describe(...)` block with behavioural invariants that
 * must hold for every platform impl (VS Code, Electron, CLI). Consumers call
 * the runner from a spec in the impl package, passing a factory that builds
 * a provider instance — see `implementation-plan.md` §3.2 for the pattern.
 */

export { runFileSystemContract } from './run-file-system-contract';
export {
  runWorkspaceContract,
  type WorkspaceProviderSetup,
} from './run-workspace-contract';
export { runSecretStorageContract } from './run-secret-storage-contract';
export { runStateStorageContract } from './run-state-storage-contract';
export {
  runUserInteractionContract,
  type UserInteractionSetup,
} from './run-user-interaction-contract';
export { runOutputChannelContract } from './run-output-channel-contract';
export { runCommandRegistryContract } from './run-command-registry-contract';
export {
  runEditorProviderContract,
  type EditorProviderSetup,
} from './run-editor-provider-contract';
export {
  runDiagnosticsProviderContract,
  type DiagnosticsProviderSetup,
} from './run-diagnostics-provider-contract';
export { runTokenCounterContract } from './run-token-counter-contract';
export {
  runAuthProviderContract,
  type AuthProviderSetup,
} from './run-auth-provider-contract';
export { runMasterKeyProviderContract } from './run-master-key-provider-contract';
export {
  runWorkspaceLifecycleContract,
  type WorkspaceLifecycleProviderSetup,
} from './run-workspace-lifecycle-contract';
export { runPlatformCommandsContract } from './run-platform-commands-contract';
export {
  runHttpServerProviderContract,
  type HttpServerProviderSetup,
} from './run-http-server-provider-contract';
