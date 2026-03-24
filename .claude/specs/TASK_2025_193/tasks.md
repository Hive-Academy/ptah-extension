# Development Tasks - TASK_2025_193

**Total Tasks**: 17 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Request/response translators have zero Copilot-specific logic (only `capi:` prefix is Copilot-specific): VERIFIED in copilot-request-translator.ts lines 57-61
- `CopilotResponseTranslator` class has no Copilot-specific dependencies (imports only from types): VERIFIED in copilot-response-translator.ts lines 16-20
- `ICopilotTranslationProxy` interface is generic enough for reuse: VERIFIED in copilot-provider.types.ts lines 58-67
- Auth-manager `configureOAuthProvider` is currently hardcoded to Copilot: VERIFIED in auth-manager.ts lines 363-432 (uses `this.copilotAuth` and `this.copilotProxy` directly)
- CodexAuthFile interface matches existing codebase: VERIFIED in codex-cli.adapter.ts lines 164-175

### Risks Identified

| Risk                                                        | Severity | Mitigation                                                                      |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| Codex API chat completions endpoint unverified              | MEDIUM   | Use `https://api.chatgpt.com/v1/chat/completions` as default, make configurable |
| Copilot regression from import path changes                 | HIGH     | Keep backward-compatible re-exports in copilot-provider/index.ts                |
| Auth-manager generalization may break existing Copilot flow | HIGH     | Add Codex path alongside existing Copilot path, do not refactor Copilot code    |
| OAuth token refresh race with concurrent file writes        | LOW      | Reuse proven dedup pattern from CodexCliAdapter.refreshAccessToken              |

### Edge Cases to Handle

- [x] Empty or missing ~/.codex/auth.json file -> return clear error
- [x] API key takes priority over OAuth tokens in auth resolution
- [x] Token refresh deduplication (single-use refresh tokens)
- [x] Backward compatibility for existing copilot-provider consumers

---

## Batch 1: Extract Shared OpenAI Translation Module - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None
**Commit**: 912f49ac

### Task 1.1: Create shared OpenAI translation types - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\openai-translation\openai-translation.types.ts
**Spec Reference**: implementation-plan.md: Component 1, item 3
**Pattern to Follow**: copilot-provider/copilot-provider.types.ts lines 86-304

**Quality Requirements**:

- Move ALL OpenAI and Anthropic protocol types from copilot-provider.types.ts (lines 86-304)
- Include: OpenAIChatMessage, OpenAIContentPart, OpenAITextPart, OpenAIImagePart, OpenAIToolCall, OpenAIToolDefinition, OpenAIChatCompletionsRequest, OpenAIStreamChunk, OpenAIStreamChoice, OpenAIToolCallDelta, AnthropicContentBlock, AnthropicTextBlock, AnthropicImageBlock, AnthropicToolUseBlock, AnthropicToolResultBlock, AnthropicMessage, AnthropicSystemPrompt, AnthropicToolDefinition, AnthropicToolChoice, AnthropicMessagesRequest
- Add a generic `ITranslationProxy` interface (replaces `ICopilotTranslationProxy` -- same shape)
- Do NOT include Copilot-specific types (CopilotTokenResponse, CopilotAuthState, COPILOT_PROXY_TOKEN_PLACEHOLDER, COPILOT_OAUTH_SENTINEL, ICopilotAuthService)

**Implementation Details**:

- Pure type file, no runtime code
- Copy types verbatim from copilot-provider.types.ts lines 86-304
- Add `ITranslationProxy` interface with start/stop/isRunning/getUrl methods (same as ICopilotTranslationProxy)

---

### Task 1.2: Create shared request translator - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\openai-translation\request-translator.ts
**Spec Reference**: implementation-plan.md: Component 1, item 1
**Pattern to Follow**: copilot-provider/copilot-request-translator.ts (entire file)

**Quality Requirements**:

- Move entire content from copilot-request-translator.ts
- Change imports to reference `./openai-translation.types` instead of `./copilot-provider.types`
- Parameterize model prefix: add `options?: { modelPrefix?: string }` to `translateAnthropicToOpenAI()`
- Default behavior: NO prefix (pass model ID as-is)
- The `capi:` prefix logic should only apply when explicitly passed

**Implementation Details**:

- Replace lines 57-61 (hardcoded `capi:` prefix) with:
  ```typescript
  const prefix = options?.modelPrefix ?? '';
  const model = prefix && !anthropicRequest.model.startsWith(prefix) ? `${prefix}${anthropicRequest.model}` : anthropicRequest.model;
  ```
- All other functions remain identical
- Export all the same functions as the original

---

### Task 1.3: Create shared response translator - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\openai-translation\response-translator.ts
**Spec Reference**: implementation-plan.md: Component 1, item 2
**Pattern to Follow**: copilot-provider/copilot-response-translator.ts (entire file)

**Quality Requirements**:

- Move entire content from copilot-response-translator.ts
- Rename class from `CopilotResponseTranslator` to `OpenAIResponseTranslator`
- Change imports to reference `./openai-translation.types`
- Zero logic changes -- only rename and import path changes

**Implementation Details**:

- All internal types (ToolCallBuffer), sseEvent helper, and class methods stay identical
- Only the class name and import paths change

---

### Task 1.4: Create abstract translation proxy base class - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\openai-translation\translation-proxy-base.ts
**Spec Reference**: implementation-plan.md: Component 1, item 4
**Pattern to Follow**: copilot-provider/copilot-translation-proxy.ts (extract reusable parts)

**Quality Requirements**:

- Extract ALL reusable HTTP server logic from CopilotTranslationProxy into abstract base
- Must include: start(), stop(), isRunning(), getUrl(), handleRequest routing, readBody, sendJson, sendErrorResponse, handleStreamingResponse, handleNonStreamingResponse, generateRequestId, safeJsonParse
- Define abstract methods: getApiEndpoint(), getHeaders(), onAuthFailure(), getStaticModels()
- Accept `TranslationProxyConfig` with `name` (for logging) and `modelPrefix` (for request translation)

**Validation Notes**:

- This is the most critical task in Batch 1 -- the base class must preserve ALL existing behavior
- The forwardToUpstream method must be generic (not Copilot-specific): replace `forwardToCopilot` with `forwardToUpstream`
- Replace all `[CopilotProxy]` log prefixes with `[${this.config.name}Proxy]`
- Replace direct copilotAuth calls with abstract method calls
- Use `translateAnthropicToOpenAI(request, { modelPrefix: this.config.modelPrefix })` from shared module
- Use `OpenAIResponseTranslator` (renamed) from shared module
- Keep COPILOT_COMPLETIONS_PATH as a configurable abstract method `getCompletionsPath()` or hardcode `/v1/chat/completions` (standard OpenAI path)

**Implementation Details**:

- Imports: http, https, URL, injectable (NOT inject -- base class), Logger from vscode-core
- `TranslationProxyConfig` interface: `{ name: string; modelPrefix: string }`
- Constructor takes `logger: Logger` and `config: TranslationProxyConfig`
- Abstract methods:
  - `protected abstract getApiEndpoint(): Promise<string>`
  - `protected abstract getHeaders(): Promise<Record<string, string>>`
  - `protected abstract onAuthFailure(): Promise<boolean>`
  - `protected abstract getStaticModels(): Array<{ id: string }>`
  - `protected abstract getCompletionsPath(): string`

---

### Task 1.5: Create barrel exports for openai-translation module - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\openai-translation\index.ts
**Spec Reference**: implementation-plan.md: Component 7

**Quality Requirements**:

- Export all types from openai-translation.types.ts
- Export translateAnthropicToOpenAI and all helper functions from request-translator.ts
- Export OpenAIResponseTranslator from response-translator.ts
- Export TranslationProxyBase and TranslationProxyConfig from translation-proxy-base.ts
- Export ITranslationProxy interface

**Implementation Details**:

- Standard barrel export file
- Use `export { ... } from './...'` and `export type { ... } from './...'` patterns

---

**Batch 1 Verification**:

- All 5 files exist in openai-translation/ directory
- No build errors from the new module (types compile cleanly)
- No existing code depends on the new module yet (isolated creation)

---

## Batch 2: Refactor Copilot Provider to Use Shared Module - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1
**Commit**: 6181777a

### Task 2.1: Slim down copilot-provider.types.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-provider.types.ts
**Spec Reference**: implementation-plan.md: Component 2, item 1

**Quality Requirements**:

- Remove ALL OpenAI/Anthropic protocol types (lines 86-304) -- they now live in openai-translation
- Keep ONLY Copilot-specific types: COPILOT_PROXY_TOKEN_PLACEHOLDER, COPILOT_OAUTH_SENTINEL, CopilotTokenResponse, CopilotAuthState, ICopilotAuthService
- Re-export `ITranslationProxy` from openai-translation as `ICopilotTranslationProxy` for backward compatibility
- Re-export key protocol types (AnthropicMessagesRequest, OpenAIChatCompletionsRequest, OpenAIStreamChunk) for backward compatibility

**Validation Notes**:

- CRITICAL: Existing consumers import types from copilot-provider. All re-exports must maintain backward compatibility.

---

### Task 2.2: Rewrite CopilotTranslationProxy as thin subclass - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts
**Spec Reference**: implementation-plan.md: Component 2, item 2

**Quality Requirements**:

- Replace the 742-line monolith with a thin subclass of TranslationProxyBase
- Must implement all abstract methods: getApiEndpoint, getHeaders, onAuthFailure, getStaticModels, getCompletionsPath
- Keep @injectable() and @inject() decorators for DI
- Copilot completions path: `/chat/completions` (NOT `/v1/chat/completions`)
- Model prefix: `capi:`

**Implementation Details**:

- Constructor: `@inject(TOKENS.LOGGER) logger, @inject(SDK_TOKENS.SDK_COPILOT_AUTH) copilotAuth`
- Call `super(logger, { name: 'Copilot', modelPrefix: 'capi:' })`
- `getApiEndpoint()`: get from copilotAuth.getAuthState() -> apiEndpoint, fallback to `https://api.githubcopilot.com`
- `getHeaders()`: delegate to `this.copilotAuth.getHeaders()`
- `onAuthFailure()`: delegate to `this.copilotAuth.login()`
- `getStaticModels()`: return `COPILOT_PROVIDER_ENTRY.staticModels ?? []`
- `getCompletionsPath()`: return `/chat/completions`

---

### Task 2.3: Delete old translator files - COMPLETE

**Files**:

- DELETE: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-request-translator.ts
- DELETE: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-response-translator.ts

**Quality Requirements**:

- Delete both files (their code now lives in openai-translation/)
- Verify no other file directly imports from these paths (all should go through index.ts)

---

### Task 2.4: Update copilot-provider barrel exports - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\index.ts
**Spec Reference**: implementation-plan.md: Component 2, item 3

**Quality Requirements**:

- Remove exports of deleted files (copilot-request-translator, copilot-response-translator)
- Add re-exports from openai-translation for backward compatibility:
  - `export { OpenAIResponseTranslator as CopilotResponseTranslator } from '../openai-translation'`
  - `export { translateAnthropicToOpenAI, translateSystemPrompt, translateMessages, translateTools, translateToolChoice } from '../openai-translation'`
- Keep all existing exports (CopilotAuthService, CopilotTranslationProxy, COPILOT_PROVIDER_ENTRY, etc.)
- Keep type re-exports from copilot-provider.types.ts

---

**Batch 2 Verification**:

- All copilot-provider imports still resolve correctly
- Existing consumers (auth-manager.ts, register.ts, src/index.ts) continue to work
- Build passes: `npx nx build agent-sdk`
- No broken re-exports

---

## Batch 3: Create Codex Provider - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 (uses openai-translation)
**Commit**: 3794cfc6

### Task 3.1: Create Codex provider types - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-provider.types.ts
**Spec Reference**: implementation-plan.md: Component 3
**Pattern to Follow**: codex-cli.adapter.ts lines 164-175

**Quality Requirements**:

- Define `CodexAuthFile` interface matching the shape in codex-cli.adapter.ts
- Define `CODEX_PROXY_TOKEN_PLACEHOLDER` constant (similar to Copilot's)
- Define `CODEX_OAUTH_SENTINEL` constant
- Define `ICodexAuthService` interface with: isAuthenticated(), getHeaders(), getApiEndpoint(), ensureTokensFresh()
- No `login()` method -- Codex auth is managed externally via `codex` CLI

**Implementation Details**:

- CodexAuthFile: `{ auth_mode?, OPENAI_API_KEY?, tokens?: { access_token?, refresh_token?, id_token?, account_id? }, last_refresh? }`
- CODEX_PROXY_TOKEN_PLACEHOLDER = 'codex-proxy-managed'
- CODEX_OAUTH_SENTINEL = 'codex-oauth'

---

### Task 3.2: Create Codex auth service - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-auth.service.ts
**Spec Reference**: implementation-plan.md: Component 3
**Pattern to Follow**: codex-cli.adapter.ts lines 298-407 (auth resolution and refresh logic)

**Quality Requirements**:

- @injectable() class with @inject(TOKENS.LOGGER)
- Reads ~/.codex/auth.json for authentication
- API key (OPENAI_API_KEY) takes priority over OAuth tokens
- Proactive OAuth token refresh when token age > 50 minutes
- Deduplicate concurrent refresh attempts (single-use refresh tokens)
- Atomic file writes for token persistence (write to .tmp, then rename)
- getHeaders() returns: `{ Authorization: 'Bearer <token>', 'Content-Type': 'application/json' }`
- getApiEndpoint() returns: `https://api.chatgpt.com` (configurable)

**Validation Notes**:

- Reuse the proven refresh pattern from codex-cli.adapter.ts (doRefreshAccessToken)
- Use client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' for OAuth refresh
- Refresh URL: 'https://auth.openai.com/oauth/token'
- Handle missing auth file gracefully (return not-authenticated)

**Implementation Details**:

- Use Node's `fs/promises` for file I/O (readFile, writeFile, rename)
- Use `os.homedir()` for cross-platform home directory
- `ensureTokensFresh()` is the public entry point for proactive refresh
- Token max age: 50 minutes (50 _ 60 _ 1000 ms)

---

### Task 3.3: Create Codex provider entry - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-provider-entry.ts
**Spec Reference**: implementation-plan.md: Component 5
**Pattern to Follow**: copilot-provider/copilot-provider-entry.ts

**Quality Requirements**:

- Define CODEX_STATIC_MODELS array with models from codex-cli.adapter.ts SUPPORTED_MODELS
- Define CODEX_DEFAULT_TIERS mapping (sonnet -> gpt-5.3-codex, opus -> gpt-5.4, haiku -> gpt-5.1-codex-mini)
- Define CODEX_PROVIDER_ENTRY: AnthropicProvider with id: 'openai-codex', authType: 'oauth', requiresProxy: true

**Implementation Details**:

- Models: gpt-5.4, gpt-5.3-codex, gpt-5.2-codex, gpt-5.2, gpt-5.1-codex-max, gpt-5.1-codex-mini
- All with contextLength: 128000, supportsToolUse: true, cost: 0 (subscription)
- Import AnthropicProvider and ProviderStaticModel from helpers/anthropic-provider-registry

---

### Task 3.4: Create Codex translation proxy - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-translation-proxy.ts
**Spec Reference**: implementation-plan.md: Component 4
**Pattern to Follow**: Refactored CopilotTranslationProxy (from Batch 2)

**Quality Requirements**:

- @injectable() class extending TranslationProxyBase
- Constructor: @inject(TOKENS.LOGGER) logger, @inject(SDK_TOKENS.SDK_CODEX_AUTH) codexAuth
- Config: `{ name: 'Codex', modelPrefix: '' }` (no model prefix)
- Completions path: `/v1/chat/completions` (standard OpenAI path)

**Implementation Details**:

- `getApiEndpoint()`: delegate to `this.codexAuth.getApiEndpoint()`
- `getHeaders()`: delegate to `this.codexAuth.getHeaders()`
- `onAuthFailure()`: delegate to `this.codexAuth.ensureTokensFresh()`
- `getStaticModels()`: return `CODEX_PROVIDER_ENTRY.staticModels ?? []`
- `getCompletionsPath()`: return `/v1/chat/completions`

---

### Task 3.5: Create Codex provider barrel exports - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\index.ts

**Quality Requirements**:

- Export CodexAuthService, CodexTranslationProxy, CODEX_PROVIDER_ENTRY, CODEX_DEFAULT_TIERS
- Export type ICodexAuthService, CodexAuthFile
- Export CODEX_PROXY_TOKEN_PLACEHOLDER, CODEX_OAUTH_SENTINEL

---

**Batch 3 Verification**:

- All 5 files exist in codex-provider/ directory
- Types compile cleanly
- No integration with rest of codebase yet (isolated module)

---

## Batch 4: Wire Up Registry, Auth Manager, DI - COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 2, Batch 3
**Commit**: b4722208

### Task 4.1: Add Codex DI tokens and registration - COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts
- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts

**Quality Requirements**:

- Add to SDK_TOKENS: `SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth')`, `SDK_CODEX_PROXY: Symbol.for('SdkCodexProxy')`
- Register CodexAuthService and CodexTranslationProxy as singletons in registerSdkServices()
- Place registration BEFORE AuthManager (same pattern as Copilot services)

**Implementation Details**:

- Import CodexAuthService and CodexTranslationProxy from '../codex-provider'
- Add a new section comment: `// Codex Provider Services (TASK_2025_193)`
- Registration pattern: `container.register(SDK_TOKENS.SDK_CODEX_AUTH, { useClass: CodexAuthService }, { lifecycle: Lifecycle.Singleton })`

---

### Task 4.2: Wire Codex into provider registry and auth manager - COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\anthropic-provider-registry.ts
- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\auth-manager.ts

**Quality Requirements**:

- Registry: Import CODEX_PROVIDER_ENTRY, add to ANTHROPIC_PROVIDERS array, add 'openai-codex' to AnthropicProviderId union
- Auth manager: Add @inject(SDK_TOKENS.SDK_CODEX_AUTH) and @inject(SDK_TOKENS.SDK_CODEX_PROXY) to constructor
- Auth manager: Generalize configureOAuthProvider to dispatch based on provider.id:
  - 'github-copilot' -> use copilotAuth/copilotProxy (existing behavior, unchanged)
  - 'openai-codex' -> use codexAuth/codexProxy (new path)

**Validation Notes**:

- CRITICAL: Do NOT modify the existing Copilot path in configureOAuthProvider. Add Codex as a separate code path.
- The `configureOAuthProvider` method must dispatch based on provider.id
- Import CODEX_PROXY_TOKEN_PLACEHOLDER from codex-provider types

**Implementation Details**:

- Auth manager constructor gains 2 new injected params: codexAuth (ICodexAuthService), codexProxy (ITranslationProxy)
- Import ICodexAuthService from codex-provider types, ITranslationProxy from openai-translation types
- configureOAuthProvider becomes a dispatcher:
  ```
  if (provider.id === 'github-copilot') -> existing copilot flow (unchanged)
  else if (provider.id === 'openai-codex') -> new codex flow (similar but uses codexAuth/codexProxy/CODEX_PROXY_TOKEN_PLACEHOLDER)
  ```

---

### Task 4.3: Update library barrel exports - COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts

**Quality Requirements**:

- Add Codex provider exports section (same pattern as Copilot section)
- Add openai-translation exports section
- Export: CodexAuthService, CodexTranslationProxy, CODEX_PROVIDER_ENTRY, CODEX_DEFAULT_TIERS
- Export types: ICodexAuthService, CodexAuthFile
- Export from openai-translation: OpenAIResponseTranslator, TranslationProxyBase, translateAnthropicToOpenAI
- Export types from openai-translation: ITranslationProxy, TranslationProxyConfig, all protocol types

---

**Batch 4 Verification**:

- Full typecheck passes: `npx nx run agent-sdk:typecheck`
- Provider registry includes both github-copilot and openai-codex
- Auth manager handles both OAuth providers
- All new exports accessible from @ptah-extension/agent-sdk
