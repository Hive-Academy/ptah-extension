# @ptah-extension/vscode-core

[Back to Main](../../../CLAUDE.md)

## Purpose

Core infrastructure layer for the VS Code host and shared backend services: logging, error handling, config, validation, RPC transport, license/feature gating, and a small set of VS Code API wrappers. Owns the canonical `TOKENS` DI registry for the extension.

## Boundaries

**Belongs here**:

- VS Code API wrappers (`CommandManager`, `WebviewManager`, `OutputManager`, `StatusBarManager`, `FileSystemManager`)
- Cross-cutting services: `Logger`, `ErrorHandler`, `ConfigManager`, `MessageValidatorService`
- RPC transport: `RpcHandler`, `RpcUserError`, RPC verification helpers
- License + feature gates: `LicenseService`, `FeatureGateService`, `AuthSecretsService`
- Webview message handler and subagent registry
- The `TOKENS` DI namespace

**Does NOT belong**:

- Domain logic (memory, skills, workspace analysis)
- Platform abstraction ports (those live in `platform-core`)
- Concrete adapters (in `platform-{cli,electron,vscode}`)
- Direct `vscode.*` consumption by anyone other than API wrappers

## Public API

DI: `TOKENS`, `registerVsCodeCoreServices`, `registerVsCodeCorePlatformAgnostic` (+ `PlatformAgnosticRegistrationOptions`).
Core: `Logger`, `ErrorHandler`, `ConfigManager`, `MessageValidatorService`, `ValidationError`, `MessageValidationError`, `PtahError`.
API wrappers: `CommandManager`, `WebviewManager`, `OutputManager`, `StatusBarManager`, `FileSystemManager`.
Messaging: `RpcHandler`, `RpcUserError`, `verifyRpcRegistration`, `assertRpcRegistration`.
Services: `SubagentRegistryService`, `WebviewMessageHandlerService`, `AuthSecretsService`, `LicenseService` (+ `isPremiumTier`), `FeatureGateService`.

## Internal Structure

- `src/api-wrappers/` — VS Code API wrappers
- `src/logging/` — `Logger`
- `src/error-handling/` — `ErrorHandler`
- `src/config/` — `ConfigManager`, file-settings store interface
- `src/validation/` — `MessageValidatorService` + error types
- `src/messaging/` — `rpc-handler.ts` (transport), `rpc-verification.ts`
- `src/services/` — license, feature gate, auth secrets, subagent registry, webview message handler
- `src/di/tokens.ts` — `TOKENS` namespace; `di/index.ts` — registration; `di/register-platform-agnostic.ts` — non-VS-Code hosts

## Key Files

- `src/messaging/rpc-handler.ts:46` — **`ALLOWED_METHOD_PREFIXES`** (runtime RPC namespace allowlist — must be kept in sync with `RpcMethodName` in `libs/shared`)
- `src/messaging/rpc-handler.ts:107` — `PRO_ONLY_METHOD_PREFIXES` for license gating
- `src/di/tokens.ts` — canonical `TOKENS`
- `src/services/license.service.ts` — tier values + `isPremiumTier`
- `src/services/feature-gate.service.ts` — Pro-only feature predicate
- `src/di/register-platform-agnostic.ts` — used by Electron/CLI hosts

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`
**External**: `@types/vscode`, `tsyringe`, `eventemitter3`, `axios`, `cross-spawn`, `zod`, `@sentry/node`

## Guidelines

- **Adding a new RPC namespace** requires updating BOTH `ALLOWED_METHOD_PREFIXES` here AND the `RpcMethodName` union in `libs/shared/.../rpc.types.ts`. Missing the runtime allowlist update produces a silent crash.
- Only export `TOKENS` namespace — never expose individual token symbols (the C8/refactor history avoided importing tokens directly).
- DI registration happens in app layer (`apps/ptah-extension-vscode/.../container.ts`); this lib only registers its own services via the provided helpers.
- Always use constructor injection (`@inject(TOKENS.X)`).
- `catch (error: unknown)`.
- API wrapper managers handle disposable cleanup — never bypass with raw `vscode.commands.registerCommand`.

## Cross-Lib Rules

Imported by virtually every backend lib. Should import only `platform-core` and `shared` from the monorepo.
