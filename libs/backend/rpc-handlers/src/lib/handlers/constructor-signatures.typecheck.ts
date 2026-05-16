/**
 * constructor-signatures.typecheck.ts
 *
 * Purpose: compile-time guard against constructor-argument drift for the five
 * highest-risk RPC handler classes.
 *
 * This file contains NO runtime tests — it exists solely so `tsc --noEmit`
 * (run via `nx typecheck rpc-handlers`) catches constructor-signature changes
 * before they reach integration specs or app-layer call sites.
 *
 * Pattern:
 *   type _Args = ConstructorParameters<typeof SomeHandler>;
 *   type _ParamN = _Args[N];
 *   const _assert: _ParamN extends ExpectedType ? true : never = true;
 *   void _assert;
 *
 * Each `const _assert: ... = true` is a compile-time assertion.  If the
 * handler's constructor signature changes the assertion produces a type error,
 * which `tsc --noEmit` surfaces as a CI failure in the `typecheck` target.
 */

// ---------------------------------------------------------------------------
// Imports — type-only so this file has zero runtime footprint.
// ---------------------------------------------------------------------------

import type { SetupRpcHandlers } from './setup-rpc.handlers';
import type { SettingsRpcHandlers } from './settings-rpc.handlers';
import type { AuthRpcHandlers } from './auth-rpc.handlers';
import type { LlmRpcHandlers } from './llm-rpc-app.handlers';
import type { WorkspaceRpcHandlers } from './workspace-rpc.handlers';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import type {
  SettingsExportService,
  SettingsImportService,
} from '@ptah-extension/agent-sdk';
import type {
  IWorkspaceProvider,
  IWorkspaceLifecycleProvider,
  ISaveDialogProvider,
  IUserInteraction,
} from '@ptah-extension/platform-core';
import type { DependencyContainer } from 'tsyringe';

// ---------------------------------------------------------------------------
// SetupRpcHandlers
// Signature: (logger, rpcHandler, modelSettings, pluginLoader, workspaceProvider,
//             container, sentryService, platformCommands, ...)
// Key assertion: param 0 = Logger, param 1 = RpcHandler, param 2 = ModelSettings
// ---------------------------------------------------------------------------

type _SetupRpcHandlersArgs = ConstructorParameters<typeof SetupRpcHandlers>;

type _SetupParam0 = _SetupRpcHandlersArgs[0];
const _assertSetupParam0: _SetupParam0 extends Logger ? true : never = true;
void _assertSetupParam0;

type _SetupParam1 = _SetupRpcHandlersArgs[1];
const _assertSetupParam1: _SetupParam1 extends RpcHandler ? true : never = true;
void _assertSetupParam1;

// param 2 must be ModelSettings (not ConfigManager — regression guard for the
// ConfigManager → ModelSettings drift)
type _SetupParam2 = _SetupRpcHandlersArgs[2];
const _assertSetupParam2: _SetupParam2 extends ModelSettings ? true : never =
  true;
void _assertSetupParam2;

// ---------------------------------------------------------------------------
// SettingsRpcHandlers
// Signature: (logger, rpcHandler, settingsExportService, settingsImportService,
//             saveDialogProvider, userInteraction, workspaceProvider,
//             platformCommands, licenseService)
// ---------------------------------------------------------------------------

type _SettingsRpcHandlersArgs = ConstructorParameters<
  typeof SettingsRpcHandlers
>;

type _SettingsParam0 = _SettingsRpcHandlersArgs[0];
const _assertSettingsParam0: _SettingsParam0 extends Logger ? true : never =
  true;
void _assertSettingsParam0;

type _SettingsParam1 = _SettingsRpcHandlersArgs[1];
const _assertSettingsParam1: _SettingsParam1 extends RpcHandler ? true : never =
  true;
void _assertSettingsParam1;

type _SettingsParam2 = _SettingsRpcHandlersArgs[2];
const _assertSettingsParam2: _SettingsParam2 extends SettingsExportService
  ? true
  : never = true;
void _assertSettingsParam2;

type _SettingsParam3 = _SettingsRpcHandlersArgs[3];
const _assertSettingsParam3: _SettingsParam3 extends SettingsImportService
  ? true
  : never = true;
void _assertSettingsParam3;

type _SettingsParam4 = _SettingsRpcHandlersArgs[4];
const _assertSettingsParam4: _SettingsParam4 extends ISaveDialogProvider
  ? true
  : never = true;
void _assertSettingsParam4;

type _SettingsParam5 = _SettingsRpcHandlersArgs[5];
const _assertSettingsParam5: _SettingsParam5 extends IUserInteraction
  ? true
  : never = true;
void _assertSettingsParam5;

type _SettingsParam6 = _SettingsRpcHandlersArgs[6];
const _assertSettingsParam6: _SettingsParam6 extends IWorkspaceProvider
  ? true
  : never = true;
void _assertSettingsParam6;

// ---------------------------------------------------------------------------
// AuthRpcHandlers
// Signature: (logger, rpcHandler, configManager, authSecretsService,
//             sdkAdapter, providerModels, copilotAuth, codexAuth, ...)
// ---------------------------------------------------------------------------

type _AuthRpcHandlersArgs = ConstructorParameters<typeof AuthRpcHandlers>;

type _AuthParam0 = _AuthRpcHandlersArgs[0];
const _assertAuthParam0: _AuthParam0 extends Logger ? true : never = true;
void _assertAuthParam0;

type _AuthParam1 = _AuthRpcHandlersArgs[1];
const _assertAuthParam1: _AuthParam1 extends RpcHandler ? true : never = true;
void _assertAuthParam1;

// ---------------------------------------------------------------------------
// LlmRpcHandlers
// Signature: (logger, rpcHandler, container, sentryService)
// ---------------------------------------------------------------------------

type _LlmRpcHandlersArgs = ConstructorParameters<typeof LlmRpcHandlers>;

type _LlmParam0 = _LlmRpcHandlersArgs[0];
const _assertLlmParam0: _LlmParam0 extends Logger ? true : never = true;
void _assertLlmParam0;

type _LlmParam1 = _LlmRpcHandlersArgs[1];
const _assertLlmParam1: _LlmParam1 extends RpcHandler ? true : never = true;
void _assertLlmParam1;

type _LlmParam2 = _LlmRpcHandlersArgs[2];
const _assertLlmParam2: _LlmParam2 extends DependencyContainer ? true : never =
  true;
void _assertLlmParam2;

// ---------------------------------------------------------------------------
// WorkspaceRpcHandlers
// Signature: (logger, rpcHandler, workspaceProvider, workspaceLifecycle,
//             userInteraction, workspaceContextManager, sessionImporter)
// ---------------------------------------------------------------------------

type _WorkspaceRpcHandlersArgs = ConstructorParameters<
  typeof WorkspaceRpcHandlers
>;

type _WorkspaceParam0 = _WorkspaceRpcHandlersArgs[0];
const _assertWorkspaceParam0: _WorkspaceParam0 extends Logger ? true : never =
  true;
void _assertWorkspaceParam0;

type _WorkspaceParam1 = _WorkspaceRpcHandlersArgs[1];
const _assertWorkspaceParam1: _WorkspaceParam1 extends RpcHandler
  ? true
  : never = true;
void _assertWorkspaceParam1;

type _WorkspaceParam2 = _WorkspaceRpcHandlersArgs[2];
const _assertWorkspaceParam2: _WorkspaceParam2 extends IWorkspaceProvider
  ? true
  : never = true;
void _assertWorkspaceParam2;

type _WorkspaceParam3 = _WorkspaceRpcHandlersArgs[3];
const _assertWorkspaceParam3: _WorkspaceParam3 extends IWorkspaceLifecycleProvider
  ? true
  : never = true;
void _assertWorkspaceParam3;
