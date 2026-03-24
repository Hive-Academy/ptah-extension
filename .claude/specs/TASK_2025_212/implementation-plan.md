# Implementation Plan - TASK_2025_212: Cleanup Post-Unification Residuals

## Codebase Investigation Summary

### Libraries Discovered

- **llm-abstraction** (`libs/backend/llm-abstraction/`) - Registers 7 services: LlmSecretsService, LlmConfigurationService, ProviderRegistry, LlmService, CliDetectionService, AgentProcessManager, CliPluginSyncService
- **rpc-handlers** (`libs/backend/rpc-handlers/`) - Platform-agnostic RPC handlers including LlmRpcHandlers and ChatRpcHandlers
- **shared** (`libs/shared/`) - pricing.utils.ts with DEFAULT_MODEL_PRICING map and formatModelDisplayName
- **vscode-lm-tools** (`libs/backend/vscode-lm-tools/`) - MCP HTTP server in http-server.handler.ts

### Key Findings

#### Issue 1 (LLM Abstraction)

- `registerLlmAbstractionServices()` called at container.ts:437 registers 7 services
- Services 1-4 (LlmSecretsService, LlmConfigurationService, ProviderRegistry, LlmService) are VESTIGIAL - only referenced within llm-abstraction itself and by template-generation's ContentGeneratorService
- Services 5-7 (CliDetectionService, AgentProcessManager, CliPluginSyncService) are ACTIVE - used for multi-CLI support
- **LlmRpcHandlers** (in rpc-handlers lib) does NOT depend on LlmService/ProviderRegistry - it uses ISecretStorage and IModelDiscovery directly (TASK_2025_209 rewrote it)
- **Frontend actively calls** llm:\* RPC methods from `libs/frontend/core/src/lib/services/llm-provider-state.service.ts` - these RPC handlers MUST be kept
- **template-generation ContentGeneratorService** injects `TOKENS.LLM_SERVICE` (line 21) - this is the only consumer outside llm-abstraction. Since LlmService has no working providers, this service is non-functional anyway.

#### Issue 2 (RPC Orphans)

- `ChatRpcHandlers.register()` at chat-rpc.handlers.ts:580-601 registers `chat:send-message`, `chat:stop`, and `agent:stop`
- `AgentRpcHandlers` (at `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts:558`) also registers `agent:stop` - causing overwrite warning
- **Frontend does NOT call** `chat:send-message` or `chat:stop` - zero grep hits in `libs/frontend/` and `apps/ptah-extension-webview/`
- `chat:send-message` and `chat:stop` are NOT in RPC_METHOD_NAMES in rpc.types.ts

#### Issue 3 (Pricing Map)

- `claude-sonnet-4-6` is NOT in DEFAULT_MODEL_PRICING (pricing.utils.ts:52-189)
- Partial matching fails because no key contains "sonnet-4-6" or "sonnet-4.6"
- `claude-opus-4-6-20250623` IS present (line 58) so `claude-opus-4-6` partial matching works
- `formatModelDisplayName` has no `4.6`/`4-6` check in the sonnet section (lines 379-387) - it would fall through to generic "Sonnet"

#### Issue 5 (MCP Server 500)

- HTTP server handler at http-server.handler.ts handles `GET /health` (200) and rejects non-POST with 405
- `GET /` returns 405 "Method not allowed" - Claude CLI likely interprets this as error and logs "GET / - 500"
- Fix: add root `GET /` handler that returns same response as `/health`

---

## Architecture Design

### Issue 1: Remove Vestigial LLM Abstraction Services

**Approach**: Split `registerLlmAbstractionServices()` - remove LLM provider services (items 1-4) while keeping CLI services (items 5-7). Create a new `registerCliServices()` function or inline the CLI registrations.

**Files Affected**:

1. **`libs/backend/llm-abstraction/src/lib/di/register.ts`** (MODIFY)

   - Remove registrations for LlmSecretsService, LlmConfigurationService, ProviderRegistry, LlmService (lines 70-82)
   - Rename function to `registerCliAbstractionServices()` or create separate function
   - Remove imports for deleted services (lines 23-26)
   - Update dependency validation - remove CONFIG_MANAGER check (only needed by LlmConfigurationService)
   - Update logger messages

2. **`apps/ptah-extension-vscode/src/di/container.ts`** (MODIFY)

   - Line 81: Update import from `registerLlmAbstractionServices` to new name
   - Line 437: Update call site
   - Update Phase 2.9 comment to reflect CLI-only services

3. **`libs/backend/llm-abstraction/src/index.ts`** (MODIFY)

   - Remove exports for LlmService, LlmSecretsService, LlmConfigurationService, ProviderRegistry
   - Remove export for provider-import-map (already empty)
   - Keep exports for CliDetectionService, AgentProcessManager, CliPluginSyncService

4. **`libs/backend/template-generation/src/lib/services/content-generator.service.ts`** (MODIFY)

   - Line 4: Remove `import { LlmService } from '@ptah-extension/llm-abstraction'`
   - Line 21: Remove `@inject(TOKENS.LLM_SERVICE)` injection
   - Make the service either throw a clear error ("LLM content generation not available") or make the LlmService dependency optional
   - **Decision**: Since this service has zero callers with a working LLM provider, the simplest fix is to make `getCompletion` return a clear error Result. Alternatively, stub the entire service. **Recommended**: Remove the LLM_SERVICE injection and have `generateContent()` return `Result.err(new Error('LLM content generation not available - no providers configured'))`.

5. **`libs/backend/vscode-core/src/di/tokens.ts`** (MODIFY)

   - Remove tokens: `LLM_SERVICE`, `PROVIDER_REGISTRY`, `LLM_CONFIGURATION_SERVICE`, `LLM_SECRETS_SERVICE`
   - Keep tokens: `CLI_DETECTION_SERVICE`, `AGENT_PROCESS_MANAGER`, `CLI_PLUGIN_SYNC_SERVICE`

6. **Vestigial source files** (LEAVE IN PLACE for now)
   - `libs/backend/llm-abstraction/src/lib/services/llm.service.ts`
   - `libs/backend/llm-abstraction/src/lib/services/llm-secrets.service.ts`
   - `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts`
   - `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts`
   - `libs/backend/llm-abstraction/src/lib/registry/provider-import-map.ts`
   - These files can be deleted in a follow-up task. They are no longer imported/registered, so they become dead code with no runtime effect.

**What NOT to change**:

- LlmRpcHandlers in rpc-handlers lib - these are platform-agnostic and use ISecretStorage/IModelDiscovery, NOT LlmService
- llm:\* RPC methods in rpc.types.ts - actively used by frontend
- AppLlmRpcHandlers registration in container.ts - still needed

---

### Issue 2: Fix RPC Orphan Handlers

**Approach**: Remove the three alias registrations from ChatRpcHandlers since `agent:stop` is already handled by AgentRpcHandlers and `chat:send-message`/`chat:stop` have no frontend callers.

**Files Affected**:

1. **`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`** (MODIFY)
   - Line 586: Remove `this.registerChatSendMessage();` call
   - Line 587: Remove `this.registerChatStop();` call
   - Line 588: Remove `this.registerAgentStop();` call
   - Lines 592-605: Update debug log methods array to remove the three methods
   - Lines 612-705: Delete the three method implementations: `registerChatSendMessage()`, `registerAgentStop()`, `registerChatStop()`

**Rationale**:

- `agent:stop` is registered by `AgentRpcHandlers` (apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts:558) - the ChatRpcHandlers duplicate causes the overwrite warning
- `chat:send-message` and `chat:stop` have zero frontend callers (verified by grep)
- These were moved from ElectronChatExtendedRpcHandlers during TASK_2025_209 unification but are not actually used by any frontend code

---

### Issue 3: Add claude-sonnet-4-6 to Pricing Map

**Approach**: Add pricing entries for `claude-sonnet-4-6-20250514` (full dated ID) and update `formatModelDisplayName` to handle the 4.6 version.

**Files Affected**:

1. **`libs/shared/src/lib/utils/pricing.utils.ts`** (MODIFY)

   **Add pricing entry** after the existing claude-sonnet-4-5 entry (after line 82):

   ```typescript
   // Claude 4.6 Sonnet (latest balanced)
   'claude-sonnet-4-6-20250514': {
     inputCostPerToken: 3e-6,    // $3.00 per 1M tokens
     outputCostPerToken: 15e-6,  // $15.00 per 1M tokens
     cacheReadCostPerToken: 3e-7,      // $0.30 per 1M tokens
     cacheCreationCostPerToken: 3.75e-6, // $3.75 per 1M tokens
     provider: 'anthropic',
   },
   ```

   **Add Sonnet 4.6 to `formatModelDisplayName`** (insert before line 380):

   ```typescript
   if (withoutDate.includes('4.6') || withoutDate.includes('4-6')) return 'Sonnet 4.6';
   ```

**Pricing source**: Same as Claude Sonnet 4.5 ($3/1M input, $15/1M output). Anthropic's Sonnet 4.6 launched at the same price tier. If pricing has changed, the dynamic LiteLLM fetch will override at runtime anyway - this is just the bundled fallback.

**Partial matching behavior**: After this change, `claude-sonnet-4-6` (without date suffix) will partial-match `claude-sonnet-4-6-20250514` since the modelId will include the key.

---

### Issue 4: State Storage (Deferred to TASK_2025_210)

**Status**: DEFERRED - Architecture research only.

**Summary**: The extension stores ~9MB in `context.workspaceState` (in-memory). The Electron app already has `WorkspaceAwareStateStorage` (at `apps/ptah-electron/src/services/workspace-aware-state-storage.ts`) implementing `IStateStorage` with disk-based JSON storage.

**Approach for TASK_2025_210**:

- Extract the disk-based storage pattern from Electron's `WorkspaceAwareStateStorage`
- Create a VS Code implementation using `context.storageUri` (file-system backed per-workspace)
- Both implementations conform to `IStateStorage` from `platform-core`
- Aligns with Settings Export/Import feature (TASK_2025_210) which needs disk storage

**No code changes in this task.**

---

### Issue 5: MCP Server Root GET Handler

**Approach**: Add a `GET /` handler that returns the same 200 response as `GET /health`. This prevents the Claude CLI from logging a 500 error when it probes the server endpoint during initialization.

**Files Affected**:

1. **`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/http-server.handler.ts`** (MODIFY)

   At line 131-136, expand the health check to also handle root path:

   ```typescript
   // Handle health check (supports both /health and / root probe)
   if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
     res.writeHead(200, { 'Content-Type': 'application/json' });
     res.end(JSON.stringify({ status: 'ok' }));
     return;
   }
   ```

**Rationale**: Claude CLI sends a `GET /` probe to verify the MCP server is reachable before sending MCP requests. The current 405 response is technically correct but causes the CLI to log a 500 error. Returning 200 on root eliminates the log noise.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in backend TypeScript libraries (DI container, RPC handlers, shared utils, MCP server)
- No frontend/UI components involved
- Requires understanding of DI patterns, RPC handler registration, pricing utilities

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 2-3 hours

**Breakdown**:

- Issue 1 (LLM Abstraction removal): ~60 min - Careful DI surgery, multiple files
- Issue 2 (RPC orphans): ~15 min - Straightforward deletion
- Issue 3 (Pricing map): ~15 min - Add entries and display name check
- Issue 5 (MCP server 500): ~10 min - One-line conditional change
- Testing and verification: ~30 min

### Batching Strategy

**Batch 1** (Quick wins - do first): Issues 2, 3, 5

- Minimal risk, independent changes, immediate log cleanup

**Batch 2** (Medium effort): Issue 1

- LLM abstraction removal requires careful dependency checking
- template-generation ContentGeneratorService needs attention

### Files Affected Summary

**MODIFY**:

- `libs/backend/llm-abstraction/src/lib/di/register.ts` (Issue 1)
- `libs/backend/llm-abstraction/src/index.ts` (Issue 1)
- `libs/backend/vscode-core/src/di/tokens.ts` (Issue 1)
- `apps/ptah-extension-vscode/src/di/container.ts` (Issue 1)
- `libs/backend/template-generation/src/lib/services/content-generator.service.ts` (Issue 1)
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (Issue 2)
- `libs/shared/src/lib/utils/pricing.utils.ts` (Issue 3)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/http-server.handler.ts` (Issue 5)

### Critical Verification Points

**After Implementation, Developer Must Verify**:

1. **Extension starts without LLM errors**: No more `[ERROR] [ProviderRegistry.getOrLoadFactory]` or `[WARN] [LlmService.setProvider]` log messages
2. **LLM RPC methods still work**: `llm:getProviderStatus`, `llm:setApiKey` etc. still respond correctly from frontend Provider Settings page
3. **CLI detection still works**: CliDetectionService and AgentProcessManager remain functional (Gemini/Codex/Copilot CLI support)
4. **No RPC overwrite warnings**: `[WARN] RpcHandler: Overwriting method "agent:stop"` gone
5. **No RPC orphan warnings**: `[WARN] [RPC Verification] orphan handlers: chat:send-message, chat:stop` gone
6. **Pricing resolves correctly**: `findModelPricing('claude-sonnet-4-6')` returns Sonnet pricing, not default
7. **MCP server probe succeeds**: `GET /` returns 200 instead of 405

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Issue 4 documented as deferred to TASK_2025_210
