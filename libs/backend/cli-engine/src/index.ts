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

export {
  CliRpcMethodRegistrationService,
  __CLI_EXCLUDED_RPC_METHODS_FOR_TEST,
} from './lib/rpc/cli-rpc-method-registration.service.js';
export { CliAgentRpcHandlers } from './lib/rpc/cli-agent-rpc.handlers.js';

export {
  CliPlatformCommands,
  CliPlatformAuth,
  CliSaveDialog,
  CliModelDiscovery,
} from './lib/platform/index.js';

export {
  CliOutputManagerAdapter,
  CliLoggerAdapter,
} from './lib/adapters/cli-adapters.js';

export { emitFatalError, FatalErrorCode } from './lib/output/stderr-json.js';
export type { FatalErrorCodeValue } from './lib/output/stderr-json.js';
