# @ptah-extension/rpc-handlers

[Back to Main](../../../CLAUDE.md)

## Purpose

Platform-agnostic RPC handler classes shared between the VS Code extension, Electron app, and CLI. Each class owns a single RPC namespace (`session:`, `chat:`, `memory:`, …) and uses zod schemas for boundary validation.

## Boundaries

**Belongs here**:

- One `*-rpc.handlers.ts` per RPC namespace plus its `*-rpc.schema.ts`
- `register-all.ts` (shared registration fan-out) and `verify-and-report.ts`
- Sub-service DI bundles for harness (`HARNESS_TOKENS`) and chat (`CHAT_TOKENS`)
- Cross-cutting helpers used by handlers (`utils/workspace-authorization.ts`)

**Does NOT belong**:

- Platform-specific imports (`vscode`, electron, node IPC) — go through `platform-core` ports
- RPC transport/protocol implementation (`RpcHandler` lives in `vscode-core`)
- Business logic that has its own lib (delegate to `agent-sdk`, `memory-curator`, `workspace-intelligence`, etc.)

## Public API

**Handler classes** (≈30):
Tier 1: `SessionRpcHandlers`, `ContextRpcHandlers`, `AutocompleteRpcHandlers`, `SubagentRpcHandlers`, `LlmRpcHandlers`, `PluginRpcHandlers`, `PtahCliRpcHandlers`.
Tier 2: `SetupRpcHandlers`, `WizardGenerationRpcHandlers`, `ConfigRpcHandlers`, `LicenseRpcHandlers`, `ChatRpcHandlers`, `AuthRpcHandlers`, `EnhancedPromptsRpcHandlers`, `QualityRpcHandlers`, `ProviderRpcHandlers`, `WebSearchRpcHandlers`.
Other: `HarnessRpcHandlers`, `McpDirectoryRpcHandlers`, `GitRpcHandlers`, `WorkspaceRpcHandlers`, `SettingsRpcHandlers`, `MemoryRpcHandlers`, `SkillsSynthesisRpcHandlers`, `CronRpcHandlers`, `GatewayRpcHandlers`, `PersistenceRpcHandlers`, `IndexingRpcHandlers`.

**Registration**: `SHARED_HANDLERS`, `registerAllRpcHandlers` (via `register-all`), `verifyAndReport`, `HARNESS_TOKENS`, `registerHarnessServices`, `CHAT_TOKENS`, `registerChatServices`.

**Utilities**: `isAuthorizedWorkspace`, `mintResetChallengeToken`.

**Re-exports**: `IPlatformCommands`, `IPlatformAuthProvider`, `ISaveDialogProvider`, `IModelDiscovery` (canonical home is `platform-core`).

## Internal Structure

- `src/lib/handlers/` — one `*-rpc.handlers.ts` + `*-rpc.schema.ts` per namespace
- `src/lib/handlers/index.ts` — barrel for all handler classes
- `src/lib/harness/` — `HarnessRpcHandlers` sub-services + `HARNESS_TOKENS`
- `src/lib/chat/` — `ChatRpcHandlers` sub-services + `CHAT_TOKENS`
- `src/lib/utils/workspace-authorization.ts` — shared `isAuthorizedWorkspace` (PR-267)
- `src/lib/register-all.ts` — `SHARED_HANDLERS` tuple + compile-time RpcMethodName coverage assertions
- `src/lib/verify-and-report.ts` — runtime verification of registration completeness

## Key Files

- `src/lib/register-all.ts:53` — `SHARED_HANDLERS` canonical list (every handler class lives in this tuple)
- `src/lib/handlers/index.ts` — barrel exported via `src/index.ts`
- Each `*-rpc.handlers.ts` declares `static readonly METHODS` tuple — the union is compile-asserted to equal `RpcMethodName`
- `src/lib/utils/workspace-authorization.ts` — workspace auth gate used by privileged handlers

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-generation`
**External**: `tsyringe`, `zod`

## Guidelines

- **Namespace dual-registration (CRITICAL — historical bug source)**: every new RPC namespace requires updates in BOTH places:
  1. **Compile-time**: add the method name to `RpcMethodName` in `libs/shared/.../rpc.types.ts` (the union backs the compile-time assertion in `register-all.ts`).
  2. **Runtime**: add the prefix string to `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`. Missing this causes silent runtime crash — the transport rejects unrecognized prefixes.
- **One handler class per namespace** — name like `<Namespace>RpcHandlers`, file `<namespace>-rpc.handlers.ts`, schema file `<namespace>-rpc.schema.ts`.
- **Zod schemas mandatory** — every handler method validates params via its schema file before doing work.
- **Platform-agnostic only** — never `import * from 'vscode'`. Use `platform-core` ports (`IUserInteraction`, `IFileSystemProvider`, `IPlatformCommands`, …) via DI.
- **Catch unknown**: `catch (error: unknown)` and narrow before logging/returning.
- **Workspace guard** — privileged operations call `isAuthorizedWorkspace` before acting.
- Pro-only methods: also add prefix to `PRO_ONLY_METHOD_PREFIXES` in `vscode-core/.../rpc-handler.ts`.

## Cross-Lib Rules

Consumers: app layers (`apps/ptah-extension-vscode`, `apps/ptah-electron`, `apps/ptah-cli`).
Must not be imported by leaf libs (`platform-*`, `shared`, `memory-contracts`).
