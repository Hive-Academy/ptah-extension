# Review Fixes - TASK_2025_186

**Total Tasks**: 15 | **Batches**: 2 | **Status**: 0/2 complete

---

## Batch 1: Proxy + Translator Hardening — PENDING

**Developer**: backend-developer
**Tasks**: 10 | **Dependencies**: None

### Task 1.1: Fix double message_stop emission — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-response-translator.ts`
**Action**: MODIFY

Add a `private finalized = false` guard flag.

- In `handleFinishReason()`: set `this.finalized = true` after emitting termination events
- In `finalize()`: check `if (this.finalized) return []` to skip duplicate emission
- Also make `toolCallBuffers` field `private readonly`

### Task 1.2: Add request body size limit — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: MODIFY

Add `MAX_BODY_SIZE = 50 * 1024 * 1024` (50MB) constant.
In `readBody()`: track accumulated size during `on('data')`. If exceeded, call `req.destroy()` and reject with error. Return 413 status to the client.

### Task 1.3: Add HTTPS request timeout — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: MODIFY

Add `timeout: 120_000` (2 minutes) to the `https.request()` options.
Handle the `'timeout'` event by calling `proxyReq.destroy()` and returning 504 Gateway Timeout to the client.

### Task 1.4: Add graceful server shutdown — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: MODIFY

In `stop()`: add a 5-second timeout. After timeout, force-close all connections via `server.closeAllConnections()` (Node 18+). Wrap in try/catch for environments without `closeAllConnections`.

### Task 1.5: Remove CORS wildcard — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: MODIFY

Remove `Access-Control-Allow-Origin: *` and all CORS headers from responses. Remove the OPTIONS handler. This is a Node-to-Node proxy — no browser CORS needed.

### Task 1.6: Single source of truth for model list — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: MODIFY

Remove the hardcoded `COPILOT_MODELS_RESPONSE` constant. Import `COPILOT_PROVIDER_ENTRY` from `./copilot-provider-entry` and derive the `/v1/models` response from `COPILOT_PROVIDER_ENTRY.staticModels`.

### Task 1.7: Propagate 429 Retry-After header — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: MODIFY

When Copilot returns 429: read `proxyRes.headers['retry-after']` and include it in the Anthropic error response message (e.g., "Rate limited. Retry after X seconds.").

### Task 1.8: Move module-level requestCounter into class — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: MODIFY

Move `let requestCounter = 0` from module scope into the `CopilotTranslationProxy` class as a private instance field.

### Task 1.9: Extract magic strings to named constants — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts` and `copilot-provider.types.ts`
**Action**: MODIFY

Create named constants:

- `COPILOT_PROXY_TOKEN_PLACEHOLDER = 'copilot-proxy-managed'` (used in auth-manager.ts)
- `COPILOT_OAUTH_SENTINEL = 'copilot-oauth'` (used in ptah-cli-config.component.ts)

Export from `copilot-provider.types.ts` and import where used.

### Task 1.10: Concurrent token refresh dedup — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts`
**Action**: MODIFY

Add a `private refreshPromise: Promise<boolean> | null = null` field.
In `refreshToken()`: if `this.refreshPromise` exists, return it. Otherwise create a new one, assign it, and clear after completion.

---

## Batch 2: Auth + DI Cleanup — PENDING

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1

### Task 2.1: Reduce describeToken to 4 chars — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts`
**Action**: MODIFY

Change `token.substring(0, 8)` to `token.substring(0, 4)` in `describeToken()`.

### Task 2.2: Inject extension version instead of hardcoded User-Agent — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts`
**Action**: MODIFY

Replace hardcoded `'ptah-extension/1.0.0'` with a version resolved from the DI container. Inject `TOKENS.EXTENSION_VERSION` or `TOKENS.EXTENSION_CONTEXT` and use `context.extension.packageJSON.version`. If not available via DI, use a constructor parameter with a default fallback.

### Task 2.3: Use interface types for DI injection — PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\auth-manager.ts`
**Action**: MODIFY

Change constructor parameter types from `CopilotAuthService` and `CopilotTranslationProxy` (concrete) to `ICopilotAuthService` and `ICopilotTranslationProxy` (interfaces). Update imports accordingly.

### Task 2.4: Remove misleading @optional() — PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts`
**Action**: MODIFY

Remove `@optional()` from the `CopilotAuthService` injection since it is unconditionally registered. Remove the defensive null checks (`if (!this.copilotAuth)`) that are now unreachable.

### Task 2.5: Use COPILOT_OAUTH_SENTINEL constant in frontend — PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts`
**Action**: MODIFY

Import `COPILOT_OAUTH_SENTINEL` from shared types or agent-sdk and replace the hardcoded `'copilot-oauth'` string in `createAgent()`.
