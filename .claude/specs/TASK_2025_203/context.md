# TASK_2025_203: Unify RPC Handler Architecture (Platform-Agnostic)

## User Request

Make VS Code RPC handler classes platform-agnostic so both VS Code and Electron can share them, eliminating the 2000+ line duplicate Electron RPC registration file.

## Problem Statement

- VS Code has 15+ properly architected RPC handler classes (AuthRpcHandlers, SessionRpcHandlers, ConfigRpcHandlers, etc.) in `apps/ptah-extension-vscode/src/services/rpc/handlers/`
- Electron has a 2000+ line procedural file (`apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts`) that duplicates all handler logic inline
- Every new RPC method requires implementation in BOTH files — causing drift (10+ methods were missing in Electron)
- The VS Code handler classes import `vscode` module but most logic uses DI-injected services that already have platform abstractions

## Strategy

- **Type**: REFACTORING
- **Workflow**: Partial (Architect → Team-Leader → Developers → QA)
- **Key Insight**: Platform abstractions already exist (TASK_2025_199/200):
  - `ISecretStorage` → replaces `vscode.ExtensionContext.secrets`
  - `IStateStorage` → replaces `vscode.workspace.getConfiguration`
  - `IWorkspaceProvider` → replaces `vscode.workspace.workspaceFolders`
  - `IFileSystemProvider` → replaces `vscode.workspace.fs`
  - `ConfigManager` shim → delegates to workspace state storage
  - `EXTENSION_CONTEXT` shim → delegates to platform storage
  - `AUTH_SECRETS_SERVICE` → ElectronAuthSecretsService adapter
  - `TOKENS.LOGGER` → ElectronLoggerAdapter
  - `TOKENS.LICENSE_SERVICE` → ElectronLicenseServiceStub

## Desired Outcome

1. Handler classes moved to a shared location (likely `libs/backend/vscode-core/src/messaging/handlers/`)
2. All `import * as vscode from 'vscode'` removed from handlers
3. Handlers use only DI tokens that both platforms provide
4. VS Code `RpcMethodRegistrationService` imports and registers shared handlers
5. Electron `registerExtendedRpcMethods` imports and registers the SAME shared handlers
6. The 2000+ line Electron procedural file is eliminated
7. Both platforms stay in sync automatically

## Files Involved

### VS Code Handler Classes (to be made platform-agnostic)

- `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/session-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/config-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/context-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/autocomplete-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/llm-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/provider-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/subagent-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/command-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/enhanced-prompts-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/quality-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/plugin-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/ptah-cli-rpc.handlers.ts`

### Electron File to Eliminate

- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (2200+ lines)

### Files to Update

- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (orchestrator — update imports)
- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (replace with shared handler registration)
- `apps/ptah-electron/src/di/container.ts` (register shared handler classes)
- `libs/backend/vscode-core/src/index.ts` (export shared handlers)
