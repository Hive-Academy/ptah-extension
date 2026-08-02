export {
  withEngine,
  SdkInitFailedError,
  migrateLegacyAuthMethod,
  initializeSdkAdapter,
} from './lib/bootstrap/with-engine.js';
export type {
  WithEngineGlobals,
  WithEngineOptions,
  EngineContext,
  InitializeSdkAdapterResult,
  SdkAgentLifecycle,
} from './lib/bootstrap/with-engine.js';

export { CliDIContainer } from './lib/container.js';
export type {
  CliBootstrapOptions,
  CliBootstrapResult,
} from './lib/container.js';

export {
  activateThoth,
  disposeThoth,
  resetVecDiagnosticForTest,
} from './lib/bootstrap/thoth-runtime.js';
export type {
  ThothRefs,
  ThothTier,
  ThothTierOption,
} from './lib/bootstrap/thoth-runtime.js';

export { wireThothPushBridges } from './lib/bootstrap/wire-thoth-push-bridges.js';

export { CliMessageTransport } from './lib/transport/cli-message-transport.js';
export { CliWebviewManagerAdapter } from './lib/transport/cli-webview-manager-adapter.js';
export { CliFireAndForgetHandler } from './lib/transport/cli-fire-and-forget-handler.js';

export { createCliRpcHostProfile } from './lib/rpc/cli-host-profile.js';
export { CliFilePickerRpcHandlers } from './lib/rpc/cli-file-picker-rpc.handlers.js';
export {
  HEADLESS_FILE_PICKER,
  type HeadlessFilePickRequest,
  type IHeadlessFilePicker,
} from './lib/rpc/headless-file-picker.port.js';
export { CliAgentRpcHandlers } from './lib/rpc/cli-agent-rpc.handlers.js';

export {
  CliPlatformCommands,
  CliPlatformAuth,
  CliSaveDialog,
  CliModelDiscovery,
} from './lib/platform/index.js';
export type {
  AuthCommandPushSink,
  CliPlatformCommandsOptions,
} from './lib/platform/cli-platform-commands.js';

export {
  CliOutputManagerAdapter,
  CliLoggerAdapter,
} from './lib/adapters/cli-adapters.js';

export { emitFatalError, FatalErrorCode } from './lib/output/stderr-json.js';
export type { FatalErrorCodeValue } from './lib/output/stderr-json.js';

export type { Logger as ThothLogger } from '@ptah-extension/vscode-core';
