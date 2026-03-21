# Implementation Plan - TASK_2025_209: Platform Unification

## Codebase Investigation Summary

### Libraries Analyzed

- **vscode-lm-tools** (`libs/backend/vscode-lm-tools/`) - MCP server, ptah.ai namespace, system prompt
- **llm-abstraction** (`libs/backend/llm-abstraction/`) - VsCodeLmProvider, provider registry
- **agent-generation** (`libs/backend/agent-generation/`) - VsCodeLmService (agent customization)
- **agent-sdk** (`libs/backend/agent-sdk/`) - InternalQueryService (already platform-agnostic)
- **rpc-handlers** (`libs/backend/rpc-handlers/`) - Shared LlmRpcHandlers, ProviderRpcHandlers, IModelDiscovery
- **vscode-core** (`libs/backend/vscode-core/`) - TOKENS.LLM_RPC_HANDLERS, LlmRpcHandlers interface
- **ptah-electron** (`apps/ptah-electron/`) - 11 Electron-specific RPC handlers, DI container

### Key Discoveries

1. **ContentGenerationService already migrated** from VsCodeLmService to InternalQueryService (Agent SDK).
   Evidence: `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:12-13` - comment says "Previously: VsCodeLmService -> VsCodeLmProvider (required Copilot). Now: InternalQueryService -> Agent SDK (uses API key directly)".

2. **VsCodeLmService is registered in DI but has zero consumers** - `@inject(AGENT_GENERATION_TOKENS.VSCODE_LM_SERVICE)` returns zero grep results across the entire codebase. It is dead code.

3. **buildAINamespace() is 600+ lines** of VS Code LM API calls (chat, chatWithHistory, chatStream, countTokens, etc.) used exclusively by the MCP code execution server for the `ptah.ai.*` namespace.

4. **ElectronSessionExtendedRpcHandlers is a literal empty class** - register() does nothing, just logs a debug message. Confirmed dead code.

5. **ElectronLayoutRpcHandlers has trivial no-op methods** (layout:persist and layout:restore return `{ success: true }` unconditionally).

6. **copilot-sdk.adapter.ts uses `vscode.authentication`** for GitHub auth (line 880), not `vscode.lm`. This is a different concern (platform auth, already abstracted via `IPlatformAuthProvider`).

7. **Shared LlmRpcHandlers depends on TOKENS.LLM_RPC_HANDLERS** (a VS Code-specific interface) - Electron cannot use it, which is why ElectronLlmRpcHandlers exists as a parallel implementation.

---

## Architecture Design

### Design Philosophy

**Direct replacement, no backward compatibility layers.** Remove dead code first (lowest risk), then gut vscode.lm dependencies, then consolidate Electron handlers.

### Workstream Dependency Order

```
WS1 (Remove ptah.ai) ─────────────── can start immediately
WS2 (Replace vscode.lm) ────────────  can start immediately (independent of WS1)
WS3 (Unify Electron RPC) ─────────── depends on WS2 (LlmRpcHandlers unification)
```

WS1 and WS2 are independent and can be parallelized. WS3 depends on WS2 because unifying ElectronLlmRpcHandlers into shared handlers requires the shared LlmRpcHandlers to no longer depend on vscode.lm.

---

## WS1: Remove `ptah.ai` Namespace

### Rationale

The `ptah.ai.*` namespace exposes VS Code LM API to MCP code execution. It was designed for Claude CLI to delegate tasks to VS Code LM models. This is now obsolete because:

- CLI agent spawning (ptah.agent.spawn) replaces invokeAgent
- The Agent SDK's InternalQueryService provides LLM calls without vscode.lm
- The entire ptah.ai namespace is VS Code-exclusive and blocks platform unification

### Components

#### Component 1: Delete buildAINamespace() and AINamespace type

**Purpose**: Remove the entire 600+ line AI namespace builder and its type definition.

**Files Affected**:

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` (MODIFY)

   - Delete `buildAINamespace()` function (lines 310-936)
   - Remove `import * as vscode from 'vscode'` (line 15) - after removing buildAINamespace, this import is only needed if buildFilesNamespace uses it. Investigation shows buildFilesNamespace uses `FileType` from `@ptah-extension/platform-core`, NOT vscode. The vscode import becomes unnecessary.
   - Remove `AINamespace` from the import on line 23: `import { AINamespace, FilesNamespace } from '../types';`
   - Keep: `buildFilesNamespace()`, `buildHelpMethod()`, `resolveWorkspacePath()`, `stripJsonComments()`, `HELP_DOCS`

2. `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (MODIFY)

   - Delete `AINamespace` interface definition
   - Remove `ai: AINamespace` from `PtahAPI` interface (line 45)
   - The `import * as vscode from 'vscode'` on line 15 remains needed for `DiagnosticsNamespace` which uses `vscode.DiagnosticSeverity`

3. `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (MODIFY)

   - Remove `buildAINamespace` import (line 57)
   - Remove `ai: buildAINamespace(systemDeps)` call (line 258)

4. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts` (MODIFY)
   - Remove `buildAINamespace` from barrel export

#### Component 2: Update HELP_DOCS and system prompt

**Purpose**: Remove references to ptah.ai from help documentation and system prompt.

**Files Affected**:

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` (MODIFY)

   - In `HELP_DOCS.overview` (line 38): Remove the `AI: ptah.ai.* (chat, tokens, tools, specialized tasks)` line
   - Delete `HELP_DOCS.ai` entry entirely (lines 50-79)

2. `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` (MODIFY)

   - Remove all `ptah.ai.*` references from the system prompt constant
   - Remove `ptah.ai.invokeAgent(agentPath, task, model)` example (line 42)
   - Remove `ptah.ai.fitsInContext(content, model, reserve)` example (line 44)
   - Remove the "Other Namespaces" line referencing ptah.ai (around line 562)
   - Remove the `ptah.ai.invokeAgent` example code (around line 603)

3. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` (MODIFY)
   - Remove any `ptah.ai` references from tool descriptions

#### Component 3: Remove ptah.ai parameter types

**Purpose**: Clean up unused parameter type definitions.

**Files Affected**:

1. `libs/backend/vscode-lm-tools/src/lib/types/tool-parameters.ts` (INSPECT)
   - Investigation shows this file contains only workspace/search/context/diagnostics parameter types. No AI-specific types found. **No changes needed.**

### WS1 Risk Assessment

**Risk: LOW**

- ptah.ai is self-contained within vscode-lm-tools
- No external consumers depend on the AINamespace (it's only exposed inside MCP code execution sandbox)
- Removing it from PtahAPI interface and builder is clean deletion
- The system prompt changes are cosmetic (remove references to deleted functionality)

**Testing**: Build `nx build vscode-lm-tools` and `nx run vscode-lm-tools:typecheck`. Run existing tests if any.

---

## WS2: Replace Remaining vscode.lm Usage

### Rationale

After WS1, the remaining vscode.lm consumers are:

1. `VsCodeLmProvider` (477 lines) - standalone LLM provider class
2. `VsCodeLmService` (404 lines) - agent generation wrapper, already has zero consumers
3. `VsCodeModelDiscovery` (46 lines) - model listing for webview
4. `LlmRpcHandlers` in rpc-handlers (353 lines) - delegates to TOKENS.LLM_RPC_HANDLERS
5. `LlmRpcHandlers` interface in vscode-core (interface + types)
6. `copilot-sdk.adapter.ts` - uses `vscode.authentication`, NOT `vscode.lm`

### Components

#### Component 4: Delete VsCodeLmService (dead code)

**Purpose**: Remove the dead VsCodeLmService class that nobody injects anymore.

**Evidence**: Grep for `@inject.*VSCODE_LM_SERVICE` returns zero results. ContentGenerationService already migrated to InternalQueryService.

**Files Affected**:

1. `libs/backend/agent-generation/src/lib/services/vscode-lm.service.ts` (DELETE)
2. `libs/backend/agent-generation/src/lib/services/vscode-lm.service.spec.ts` (DELETE)
3. `libs/backend/agent-generation/src/lib/interfaces/vscode-lm.interface.ts` (DELETE)
4. `libs/backend/agent-generation/src/lib/interfaces/index.ts` (MODIFY)
   - Remove `IVsCodeLmService, SectionCustomizationRequest` export
5. `libs/backend/agent-generation/src/lib/di/tokens.ts` (MODIFY)
   - Remove `VSCODE_LM_SERVICE` token definition and its JSDoc comment (lines 107-111)
   - Remove from the AGENT_GENERATION_TOKENS object export (line 204)
6. `libs/backend/agent-generation/src/lib/di/register.ts` (MODIFY)
   - Remove `import { VsCodeLmService }` (line 31)
   - Remove the `container.register(AGENT_GENERATION_TOKENS.VSCODE_LM_SERVICE, ...)` registration (lines 115-120)
   - Remove `'VSCODE_LM_SERVICE'` from the logged services list (line 190)
7. `libs/backend/agent-generation/src/lib/types/core.types.ts` (INSPECT)
   - Check if `AgentProjectContext` or other types are only used by VsCodeLmService. If shared with other services, keep them.
8. `libs/backend/agent-generation/src/index.ts` (MODIFY)
   - Remove `VsCodeLmService` and `LlmValidationFallbackError` exports if present

#### Component 5: Delete VsCodeLmProvider

**Purpose**: Remove the 477-line VS Code LM API provider class.

**Evidence**: After VsCodeLmService deletion, VsCodeLmProvider's only consumer is gone. Check for other imports.

**Pre-condition**: Verify no other files import VsCodeLmProvider. Current consumers found:

- `libs/backend/agent-generation/src/lib/services/vscode-lm.service.ts` (being deleted in Component 4)
- `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.spec.ts` (test file)
- `libs/backend/llm-abstraction/src/vscode-lm.ts` (secondary entry point)
- `libs/backend/llm-abstraction/src/index.ts` (barrel export)
- `libs/backend/llm-abstraction/src/lib/registry/provider-import-map.ts` (dynamic import map)
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts` (check if it uses VsCodeLmProvider directly)

**Files Affected**:

1. `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.ts` (DELETE)
2. `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.spec.ts` (DELETE)
3. `libs/backend/llm-abstraction/src/vscode-lm.ts` (DELETE) - secondary entry point for tree-shaking
4. `libs/backend/llm-abstraction/src/index.ts` (MODIFY) - remove VsCodeLmProvider export
5. `libs/backend/llm-abstraction/src/lib/registry/provider-import-map.ts` (MODIFY) - remove vscode-lm from provider map

**IMPORTANT**: Before deleting, verify `enhanced-prompts.service.ts` does NOT directly use VsCodeLmProvider. The grep shows it as a match - investigate if it's just a type reference or actual usage.

#### Component 6: Simplify LlmRpcHandlers to not require vscode.lm

**Purpose**: The shared `LlmRpcHandlers` in rpc-handlers currently delegates to `TOKENS.LLM_RPC_HANDLERS` (a VS Code-specific interface). After removing VsCodeLmProvider, the `LlmRpcHandlers` interface in vscode-core becomes dead code.

**Strategy**: The shared LlmRpcHandlers class should handle LLM provider operations directly using platform abstractions (ISecretStorage via AuthSecretsService, ConfigManager for provider settings) instead of delegating to a VS Code-specific interface.

**Files Affected**:

1. `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts` (REWRITE)

   - Remove dependency on `TOKENS.LLM_RPC_HANDLERS` (the VS Code-specific interface)
   - Implement provider status, API key management, and model listing directly
   - Use `TOKENS.AUTH_SECRETS_SERVICE` for API key storage (already platform-agnostic)
   - Use `TOKENS.CONFIG_MANAGER` for provider/model preferences
   - Use `TOKENS.MODEL_DISCOVERY` (IModelDiscovery) for model listing
   - Use `DependencyContainer` for lazy resolution (same pattern as other handlers)

2. `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` (DELETE or gut)

   - The `LlmRpcHandlers` interface and related types (`LlmProviderStatus`, `SetApiKeyRequest`, etc.) can be moved to shared if still needed by the rewritten handler, or deleted if the rewrite uses simpler types.
   - The `LlmProviderName` type should be updated from `'vscode-lm'` to something like `'anthropic' | 'openrouter'`

3. `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY)

   - Remove `LLM_RPC_HANDLERS` token if no longer needed
   - Keep other LLM-related tokens that are still used

4. `libs/backend/vscode-core/src/index.ts` (MODIFY)
   - Remove `LlmRpcHandlers` interface export, `SetApiKeyRequest`, `SetApiKeyResponse`, `LlmProviderName` if moved/deleted

#### Component 7: Replace VsCodeModelDiscovery with static model list

**Purpose**: `VsCodeModelDiscovery` uses `vscode.lm.selectChatModels()` to enumerate models. In the unified architecture, model discovery should not depend on vscode.lm.

**Strategy**: The `IModelDiscovery` interface is already defined in rpc-handlers. The VS Code implementation (`VsCodeModelDiscovery`) and the Electron implementation (`ElectronModelDiscovery`) are both registered via `TOKENS.MODEL_DISCOVERY`.

For VS Code, we have two options:

- Option A: Keep VsCodeModelDiscovery as VS Code-specific (it IS platform-specific)
- Option B: Replace with a static/SDK-based model list

**Recommendation: Option A (Keep as platform-specific)**. Model discovery IS inherently platform-specific. The `IModelDiscovery` abstraction already handles this correctly. `VsCodeModelDiscovery` stays in the VS Code app, `ElectronModelDiscovery` stays in the Electron app. The shared `ProviderRpcHandlers` uses `IModelDiscovery` via DI.

**Files Affected**: NONE for this component. VsCodeModelDiscovery is correctly placed and uses the platform abstraction.

**However**: The `VsCodeModelDiscovery` file uses `import * as vscode from 'vscode'` which is correct for a VS Code app-layer file. No changes needed.

#### Component 8: Address copilot-sdk.adapter.ts vscode import

**Purpose**: `copilot-sdk.adapter.ts` imports `* as vscode from 'vscode'` but only uses `vscode.authentication.getSession('github', ...)` for auth, not `vscode.lm`.

**Strategy**: This is NOT a vscode.lm issue. The `vscode.authentication` usage is already abstracted via `IPlatformAuthProvider`. However, the adapter currently calls vscode.authentication directly.

**Recommendation**: Defer to a separate task. The copilot adapter is CLI-specific code that only runs in VS Code. It is not blocking platform unification for the main LLM path. Mark as tech debt.

**Files Affected**: NONE for this task.

### WS2 Risk Assessment

**Risk: MEDIUM**

- Deleting VsCodeLmService is safe (zero consumers confirmed)
- Deleting VsCodeLmProvider requires verifying enhanced-prompts.service.ts usage
- Rewriting shared LlmRpcHandlers is the highest risk change - must maintain same RPC method signatures
- Model discovery is correctly abstracted, no changes needed

**Testing**:

- `nx build agent-generation && nx run agent-generation:typecheck`
- `nx build llm-abstraction && nx run llm-abstraction:typecheck`
- `nx build rpc-handlers && nx run rpc-handlers:typecheck`
- `nx build vscode-core && nx run vscode-core:typecheck`
- Verify all `llm:*` RPC methods still work in both VS Code and Electron

---

## WS3: Unify Electron RPC Handlers

### Rationale

The Electron app has 11 handler classes. After investigation:

- 1 is empty dead code (ElectronSessionExtendedRpcHandlers)
- 1 is trivial no-ops (ElectronLayoutRpcHandlers)
- 2 duplicate shared functionality (ElectronChatExtendedRpcHandlers, ElectronAgentRpcHandlers)
- 1 will be unified after WS2 (ElectronLlmRpcHandlers)
- 6 are legitimately platform-specific (keep as-is)

### Components

#### Component 9: Delete ElectronSessionExtendedRpcHandlers (dead code)

**Purpose**: This class has an empty `register()` method that just logs a debug message. Pure dead code.

**Evidence**: `apps/ptah-electron/src/services/rpc/handlers/electron-session-extended-rpc.handlers.ts` lines 27-33: register() does nothing.

**Files Affected**:

1. `apps/ptah-electron/src/services/rpc/handlers/electron-session-extended-rpc.handlers.ts` (DELETE)
2. `apps/ptah-electron/src/services/rpc/handlers/index.ts` (MODIFY) - remove export
3. `apps/ptah-electron/src/di/container.ts` (MODIFY)
   - Remove `ElectronSessionExtendedRpcHandlers` import (line 128)
   - Remove `container.registerSingleton(ElectronSessionExtendedRpcHandlers)` (line 636)
   - Remove from logged handlers list (line 655)
4. `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)
   - Remove `ElectronSessionExtendedRpcHandlers` import (line 54)
   - Remove from constructor parameter (line 95)
   - Remove from `electronHandlers` array (lines 184-187)

#### Component 10: Delete ElectronLayoutRpcHandlers (no-ops)

**Purpose**: Both layout:persist and layout:restore are no-ops that return `{ success: true }`. Layout state is managed client-side. These methods serve no purpose.

**Files Affected**:

1. `apps/ptah-electron/src/services/rpc/handlers/electron-layout-rpc.handlers.ts` (DELETE)
2. `apps/ptah-electron/src/services/rpc/handlers/index.ts` (MODIFY) - remove export
3. `apps/ptah-electron/src/di/container.ts` (MODIFY)
   - Remove `ElectronLayoutRpcHandlers` import (line 132)
   - Remove `container.registerSingleton(ElectronLayoutRpcHandlers)` (line 639)
   - Remove from logged handlers list (line 658)
4. `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)
   - Remove import, constructor parameter, and array entry

**NOTE**: Check if the webview ever calls `layout:persist` or `layout:restore`. If it does, those calls will fail silently (RPC handler not found). This is acceptable since they were no-ops anyway.

#### Component 11: Move ElectronChatExtendedRpcHandlers to shared

**Purpose**: `chat:send-message` and `chat:stop` are not Electron-specific - they use `SdkAgentAdapter` which is available in both platforms.

**Strategy**: Move these methods into the shared `ChatRpcHandlers` class or create new methods in the shared handler.

**Files Affected**:

1. `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (MODIFY)

   - Add `chat:send-message` method (alias for continuation)
   - Add `chat:stop` method (calls sdkAdapter.interruptSession)

2. `apps/ptah-electron/src/services/rpc/handlers/electron-chat-extended-rpc.handlers.ts` (DELETE)
3. `apps/ptah-electron/src/services/rpc/handlers/index.ts` (MODIFY) - remove export
4. `apps/ptah-electron/src/di/container.ts` (MODIFY) - remove registration
5. `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY) - remove handler

**CAUTION**: Verify `chat:send-message` and `chat:stop` are NOT already registered by the shared ChatRpcHandlers. If they conflict, the shared handler takes precedence and the Electron handler's methods are shadowed.

#### Component 12: Move ElectronAgentRpcHandlers to shared

**Purpose**: `agent:stop` calls `sdkAdapter.interruptSession()` which is platform-agnostic.

**Strategy**: Add `agent:stop` to a shared handler (perhaps SubagentRpcHandlers or a new AgentLifecycleRpcHandlers if appropriate).

**Files Affected**:

1. Determine target shared handler - likely `SubagentRpcHandlers` or create dedicated handler
2. `apps/ptah-electron/src/services/rpc/handlers/electron-agent-rpc.handlers.ts` (DELETE)
3. `apps/ptah-electron/src/services/rpc/handlers/index.ts` (MODIFY)
4. `apps/ptah-electron/src/di/container.ts` (MODIFY)
5. `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)

#### Component 13: Unify ElectronLlmRpcHandlers after WS2

**Purpose**: After WS2 rewrites the shared LlmRpcHandlers to not depend on vscode.lm, the Electron-specific LLM handler becomes redundant.

**Depends on**: Component 6 (WS2 - rewrite shared LlmRpcHandlers)

**Strategy**: Once the shared LlmRpcHandlers uses AuthSecretsService + ConfigManager + IModelDiscovery (all platform-agnostic), Electron can use the shared handler instead of ElectronLlmRpcHandlers.

**Files Affected**:

1. `apps/ptah-electron/src/services/rpc/handlers/electron-llm-rpc.handlers.ts` (DELETE)
2. `apps/ptah-electron/src/services/rpc/handlers/index.ts` (MODIFY) - remove export
3. `apps/ptah-electron/src/di/container.ts` (MODIFY)
   - Remove ElectronLlmRpcHandlers registration
   - Add shared LlmRpcHandlers registration (from `@ptah-extension/rpc-handlers`)
4. `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)
   - Replace ElectronLlmRpcHandlers with shared LlmRpcHandlers

#### Handlers to KEEP (platform-specific, no changes needed)

These 6 handlers remain Electron-specific:

| Handler                             | Reason to Keep                                                |
| ----------------------------------- | ------------------------------------------------------------- |
| `ElectronWorkspaceRpcHandlers`      | Uses Electron file system APIs                                |
| `ElectronFileRpcHandlers`           | Uses Electron file APIs                                       |
| `ElectronCommandRpcHandlers`        | Uses Electron IPC for commands                                |
| `ElectronEditorRpcHandlers`         | Uses Electron editor bridge                                   |
| `ElectronAuthExtendedRpcHandlers`   | Uses Electron secret storage (auth:setApiKey, auth:getStatus) |
| `ElectronConfigExtendedRpcHandlers` | Uses Electron storage + permission handler init               |

### WS3 Risk Assessment

**Risk: LOW-MEDIUM**

- Deleting empty/no-op handlers (Components 9-10): **LOW** risk
- Moving chat/agent methods to shared (Components 11-12): **MEDIUM** risk - need to verify VS Code side doesn't already register these methods
- Unifying LLM handler (Component 13): **MEDIUM** risk - depends on WS2 success

---

## Implementation Order (Batched)

### Batch 1: Dead Code Removal (Lowest Risk)

**Components**: 4, 9, 10
**Risk**: LOW
**Dependencies**: None

1. Delete VsCodeLmService + its interface + DI token + registration (Component 4)
2. Delete ElectronSessionExtendedRpcHandlers (Component 9)
3. Delete ElectronLayoutRpcHandlers (Component 10)

### Batch 2: ptah.ai Namespace Removal

**Components**: 1, 2, 3
**Risk**: LOW
**Dependencies**: None (independent of Batch 1)

1. Delete buildAINamespace() and AINamespace type (Component 1)
2. Update HELP_DOCS and system prompt (Component 2)
3. Verify tool-parameters.ts (Component 3 - likely no-op)

### Batch 3: VsCodeLmProvider Removal

**Components**: 5
**Risk**: MEDIUM
**Dependencies**: Batch 1 (VsCodeLmService must be deleted first)

1. Verify enhanced-prompts.service.ts does not directly use VsCodeLmProvider
2. Delete VsCodeLmProvider + spec + secondary entry point
3. Update llm-abstraction exports and provider registry

### Batch 4: Shared LlmRpcHandlers Rewrite

**Components**: 6
**Risk**: MEDIUM-HIGH
**Dependencies**: Batch 3

1. Rewrite LlmRpcHandlers to use AuthSecretsService + ConfigManager + IModelDiscovery
2. Remove/gut vscode-core LlmRpcHandlers interface
3. Update TOKENS and exports

### Batch 5: Electron Handler Unification

**Components**: 11, 12, 13
**Risk**: MEDIUM
**Dependencies**: Batch 4 (for Component 13)

1. Move chat:send-message and chat:stop to shared ChatRpcHandlers
2. Move agent:stop to shared handler
3. Replace ElectronLlmRpcHandlers with shared LlmRpcHandlers
4. Update Electron DI container and registration service

---

## DI Token and Registration Changes Summary

### Tokens to REMOVE

| Token                                       | Location                      | Reason                               |
| ------------------------------------------- | ----------------------------- | ------------------------------------ |
| `AGENT_GENERATION_TOKENS.VSCODE_LM_SERVICE` | agent-generation/di/tokens.ts | Dead code, zero consumers            |
| `TOKENS.LLM_RPC_HANDLERS`                   | vscode-core/di/tokens.ts      | Replaced by rewritten shared handler |

### DI Registrations to REMOVE (Electron container.ts)

| Registration                         | Line | Reason             |
| ------------------------------------ | ---- | ------------------ |
| `ElectronSessionExtendedRpcHandlers` | ~636 | Empty dead code    |
| `ElectronLayoutRpcHandlers`          | ~639 | No-op methods      |
| `ElectronChatExtendedRpcHandlers`    | ~625 | Moved to shared    |
| `ElectronAgentRpcHandlers`           | ~638 | Moved to shared    |
| `ElectronLlmRpcHandlers`             | ~624 | Replaced by shared |

### DI Registrations to ADD (Electron container.ts)

| Registration                         | Reason                          |
| ------------------------------------ | ------------------------------- |
| `LlmRpcHandlers` (from rpc-handlers) | Replaces ElectronLlmRpcHandlers |

---

## Files Affected Summary

### DELETE (12 files)

- `libs/backend/agent-generation/src/lib/services/vscode-lm.service.ts`
- `libs/backend/agent-generation/src/lib/services/vscode-lm.service.spec.ts`
- `libs/backend/agent-generation/src/lib/interfaces/vscode-lm.interface.ts`
- `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.ts`
- `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.spec.ts`
- `libs/backend/llm-abstraction/src/vscode-lm.ts`
- `apps/ptah-electron/src/services/rpc/handlers/electron-session-extended-rpc.handlers.ts`
- `apps/ptah-electron/src/services/rpc/handlers/electron-layout-rpc.handlers.ts`
- `apps/ptah-electron/src/services/rpc/handlers/electron-chat-extended-rpc.handlers.ts`
- `apps/ptah-electron/src/services/rpc/handlers/electron-agent-rpc.handlers.ts`
- `apps/ptah-electron/src/services/rpc/handlers/electron-llm-rpc.handlers.ts`
- `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` (DELETE or heavily gut)

### REWRITE (1 file)

- `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts`

### MODIFY (15+ files)

- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`
- `libs/backend/agent-generation/src/lib/di/tokens.ts`
- `libs/backend/agent-generation/src/lib/di/register.ts`
- `libs/backend/agent-generation/src/lib/interfaces/index.ts`
- `libs/backend/agent-generation/src/index.ts`
- `libs/backend/llm-abstraction/src/index.ts`
- `libs/backend/llm-abstraction/src/lib/registry/provider-import-map.ts`
- `libs/backend/vscode-core/src/di/tokens.ts`
- `libs/backend/vscode-core/src/index.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
- `apps/ptah-electron/src/di/container.ts`
- `apps/ptah-electron/src/services/rpc/handlers/index.ts`
- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts`

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are backend TypeScript (DI, services, RPC handlers)
- No frontend/UI components involved
- Requires understanding of DI container patterns and RPC handler architecture
- Node.js/VS Code extension runtime knowledge needed

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-10 hours

**Breakdown**:

- Batch 1 (dead code deletion): 1 hour
- Batch 2 (ptah.ai removal): 1-2 hours
- Batch 3 (VsCodeLmProvider removal): 1 hour
- Batch 4 (LlmRpcHandlers rewrite): 2-3 hours
- Batch 5 (Electron handler unification): 1-2 hours

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **enhanced-prompts.service.ts VsCodeLmProvider usage**:

   - File: `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`
   - Check if it imports/uses VsCodeLmProvider directly or just references the type
   - If it uses VsCodeLmProvider, refactor to use InternalQueryService first

2. **chat:send-message / chat:stop in VS Code app**:

   - Verify VS Code's RpcMethodRegistrationService does NOT already register these methods
   - If it does, moving to shared handlers would create conflicts

3. **llm:listVsCodeModels behavior**:

   - After rewriting shared LlmRpcHandlers, this method should delegate to IModelDiscovery
   - VS Code's VsCodeModelDiscovery returns real models
   - Electron's ElectronModelDiscovery returns empty arrays
   - The behavior difference is correct (platform-specific discovery)

4. **Build all affected libraries after each batch**:
   ```bash
   nx run-many --target=typecheck --projects=vscode-lm-tools,agent-generation,llm-abstraction,rpc-handlers,vscode-core
   ```
