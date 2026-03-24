# TASK_2025_212: Cleanup Post-Unification Residuals — LLM Abstraction, RPC Orphans, Pricing, State Storage

## Strategy

**Type**: REFACTORING
**Workflow**: Partial (Architect → Team-Leader → Developers)
**Complexity**: Medium (5 independent issues)

## Issue List

### Issue 1: Remove vestigial LLM Abstraction layer

**Symptom**: `[ERROR] [ProviderRegistry.getOrLoadFactory] Failed to load provider module` + `[WARN] [LlmService.setProvider] Provider creation failed... "No import map entry for provider: vscode-lm"`
**Root Cause**: TASK_2025_209 removed all providers but left the entire `llm-abstraction` library registered and initializing at startup. The `PROVIDER_IMPORT_MAP` is empty `{}`. `LlmService`, `ProviderRegistry`, `LlmConfigurationService` all initialize, fail gracefully, and produce log noise.
**What to do**:

- Remove the `registerLlmAbstractionServices()` call from VS Code container setup
- Remove `LlmService`, `ProviderRegistry`, `LlmConfigurationService`, `LlmSecretsService` DI registrations
- Keep `CliDetectionService` and `AgentProcessManager` (these are still used for multi-CLI support)
- Remove the provider-related RPC handlers that depend on LlmService (`llm:getProviderStatus`, `llm:setApiKey`, etc.) if they're now dead
- Clean up the LLM-related RPC methods from the registry if they serve no purpose
  **Key Files**:
- `apps/ptah-extension-vscode/src/di/container.ts` — calls `registerLlmAbstractionServices()`
- `libs/backend/llm-abstraction/src/lib/di/register.ts` — registers all services
- `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts` — LLM RPC handlers

### Issue 2: Fix RPC orphan handlers and duplicate registration

**Symptom**: `[WARN] RpcHandler: Overwriting method "agent:stop"` + `[WARN] [RPC Verification] 2 orphan handlers (not in registry): chat:send-message, chat:stop`
**Root Cause**: `ChatRpcHandlers.register()` at lines 599-601 registers `chat:send-message`, `chat:stop`, and `agent:stop` as convenience aliases. But:

- `agent:stop` is ALSO registered by `AgentRpcHandlers` → overwrite warning
- `chat:send-message` and `chat:stop` are NOT in `RPC_METHOD_NAMES` → orphan warning
  **What to do**:
- Remove `agent:stop` registration from `ChatRpcHandlers` (it belongs in `AgentRpcHandlers`)
- Either add `chat:send-message` and `chat:stop` to `RPC_METHOD_NAMES` in `rpc.types.ts`, OR remove them from `ChatRpcHandlers` if they're not called by the frontend
- Check frontend code for any `chat:send-message` or `chat:stop` RPC calls
  **Key Files**:
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (lines 597-700)
- `libs/shared/src/lib/types/rpc.types.ts` (RPC_METHOD_NAMES array)

### Issue 3: Add `claude-sonnet-4-6` to pricing map (100+ log spam per session)

**Symptom**: `[Pricing] Model 'claude-sonnet-4-6' not found in pricing map, using default` — logged 100+ times during session history load
**Root Cause**: The new Claude Sonnet 4.6 model ID isn't in `DEFAULT_MODEL_PRICING`. The partial matching (`findModelPricing`) can match `claude-opus-4-6-20250623` but not `claude-sonnet-4-6` since there's no Sonnet 4.6 entry.
**What to do**: Add `claude-sonnet-4-6` (and the full dated variant) to `DEFAULT_MODEL_PRICING` in `pricing.utils.ts`. Use same pricing as `claude-sonnet-4-5-20250929` or update if pricing has changed.
**Key Files**:

- `libs/shared/src/lib/utils/pricing.utils.ts` (lines 52-189)

### Issue 4: Large extension state 9.2MB — migrate to disk storage

**Symptom**: `WARN [mainThreadStorage] large extension state detected: 9195kb. Consider to use 'storageUri' or 'globalStorageUri'`
**Root Cause**: VS Code's `context.workspaceState` is an in-memory key-value store with size warnings. Our extension stores ~9MB in it (session metadata, analysis results, cached data).
**What to do**:

- The Electron app already has `WorkspaceAwareStateStorage` implementing `IStateStorage` with disk-based JSON storage
- Extract the disk-based storage pattern to a shared library (or `platform-core`)
- Create a VS Code implementation that uses `context.storageUri` (file-system backed per-workspace storage)
- This aligns with TASK_2025_210 (Settings Export/Import) which needs disk storage for both platforms
  **Key Files**:
- `apps/ptah-electron/src/services/workspace-aware-state-storage.ts` — existing disk storage
- `apps/ptah-electron/src/services/workspace-context-manager.ts` — workspace management
- `libs/backend/platform-core/` — platform abstraction interfaces

### Issue 5: MCP server 500 on first request

**Symptom**: `GET / - 500 with id UNKNOWN in 9641ms` during startup
**Root Cause**: The MCP server gets a health check request before it's fully initialized. The 500 response is logged as an error but doesn't affect functionality.
**What to do**: Either add a readiness check before accepting requests, or downgrade the 500 log to debug level for the initial request, or delay the lock file creation until the server is ready.
**Key Files**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`

## Priority & Batching

- **Batch 1** (quick wins): Issues 2, 3, 5 — minimal changes, immediate log cleanup
- **Batch 2** (medium): Issue 1 — LLM abstraction removal, careful dependency checking
- **Batch 3** (larger): Issue 4 — disk storage, ties into TASK_2025_210

## Related Tasks

- TASK_2025_209 (Platform Unification) — completed, left LLM residuals
- TASK_2025_210 (Settings Export/Import) — planned, Issue 4 is a prerequisite
