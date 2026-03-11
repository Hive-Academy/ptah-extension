# Development Tasks - TASK_2025_186

**Total Tasks**: 14 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- AnthropicProvider interface in `anthropic-provider-registry.ts` (line 60-83): Confirmed. Does NOT have `authType` or `requiresProxy` fields yet -- plan correctly identifies these need to be added.
- AuthManager `configureAnthropicProvider()` (line 268-336): Confirmed. Currently only checks `getProviderKey()` from SecretStorage. OAuth branch must be added.
- DI tokens pattern (line 30-101 in tokens.ts): Confirmed. Uses `Symbol.for()` convention.
- DI registration pattern (line 72-359 in register.ts): Confirmed. Singleton lifecycle, imports from barrel files.
- `ptah-cli/index.ts` barrel pattern (line 1-24): Confirmed. Simple re-exports, good pattern to follow for `copilot-provider/index.ts`.
- Frontend `AVAILABLE_PROVIDERS` (line 43-59 in ptah-cli-config.component.ts): Confirmed. Static array of `ProviderOption` objects.
- Existing Copilot model list (`COPILOT_MODELS` at line 259-277 in copilot-sdk.adapter.ts): Confirmed. Contains Claude models with IDs like `claude-sonnet-4.6`, `claude-opus-4.6`, etc.
- AuthEnv interface (shared lib): Confirmed. Only has `ANTHROPIC_*` and `CLAUDE_CODE_OAUTH_TOKEN` fields. No changes needed -- proxy sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` which are already supported.

### Risks Identified

| Risk                                                                                                                                                           | Severity | Mitigation                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copilot API speaks OpenAI protocol, NOT Anthropic Messages API (context.md says Anthropic, implementation-plan.md says OpenAI -- plan is correct)              | HIGH     | Plan correctly uses translation proxy. Context.md is misleading but plan addresses it.                                                                                  |
| Token exchange endpoint `api.github.com/copilot_internal/v2/token` is undocumented                                                                             | HIGH     | Follow OpenCode reference implementation pattern. Add graceful error handling.                                                                                          |
| Rate limits may make this impractical (OpenCode disabled it)                                                                                                   | MEDIUM   | Warning in UI, graceful error messages. Provider is easy to discard (single folder).                                                                                    |
| `as const satisfies` on ANTHROPIC_PROVIDERS array (line 269) -- adding Copilot entry requires careful type handling since provider entry has dynamic `baseUrl` | MEDIUM   | Copilot entry will NOT be added to `as const` array. Instead, use a separate registration function or conditional append since `baseUrl` is set dynamically at runtime. |
| vscode.authentication scope for Copilot -- `['copilot']` scope may not be correct                                                                              | MEDIUM   | Verify against VS Code API docs. Fallback: use `['read:user']` scope which is known to work.                                                                            |

### Edge Cases to Handle

- [ ] Token expiry mid-request -> Handled in Task 2.1 (proxy retries on 401)
- [ ] Proxy port conflict -> Handled in Task 2.1 (dynamic port with port 0)
- [ ] User not signed into GitHub in VS Code -> Handled in Task 1.2 (graceful auth failure)
- [ ] Copilot subscription not active -> Handled in Task 1.2 (clear error message)
- [ ] Multiple concurrent requests through proxy -> Handled in Task 2.1 (stateless per-request)

---

## Batch 1: Backend Core (copilot-provider/ folder) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: None
**Commit**: e0546c97

### Task 1.1: Create copilot-provider.types.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-provider.types.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md lines 54-89

**Quality Requirements**:

- All types for the module in one file (isolation)
- Export interfaces: `CopilotTokenResponse`, `CopilotAuthState`, `ICopilotTranslationProxy`, `ICopilotAuthService`
- Include JSDoc on every interface and field
- `CopilotTokenResponse`: `token: string`, `expires_at: number`, `endpoints?: { api: string }`
- `CopilotAuthState`: `githubToken: string`, `bearerToken: string`, `expiresAt: number`, `apiEndpoint: string` (default `https://api.githubcopilot.com`)
- `ICopilotTranslationProxy`: `start(): Promise<{ port: number; url: string }>`, `stop(): Promise<void>`, `isRunning(): boolean`, `getUrl(): string | undefined`
- `ICopilotAuthService`: `login(): Promise<boolean>`, `isAuthenticated(): Promise<boolean>`, `getAuthState(): Promise<CopilotAuthState | null>`, `getHeaders(): Promise<Record<string, string>>`, `logout(): Promise<void>`
- Also add OpenAI/Anthropic protocol types needed by translators: `OpenAIChatCompletionsRequest`, `OpenAIStreamChunk`, `AnthropicMessagesRequest` (simplified -- only fields we need for translation, not full SDK types)

**Implementation Details**:

- Pure type definitions, no runtime code
- Follow existing type file patterns in the codebase

---

### Task 1.2: Create copilot-auth.service.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md lines 92-116
**Pattern to Follow**: `auth-manager.ts` lines 293-294 (token logging pattern -- log length/prefix only, never the token itself)

**Quality Requirements**:

- Injectable service with `@injectable()` decorator
- Constructor injects `TOKENS.LOGGER` from `@ptah-extension/vscode-core`
- Implements `ICopilotAuthService` from `copilot-provider.types.ts`
- Uses `vscode.authentication.getSession('github', ['copilot'], { createIfNone: true })` for login
- Token exchange: `GET https://api.github.com/copilot_internal/v2/token` with `Authorization: token ${githubToken}`
- Cache `CopilotAuthState` in memory with `expiresAt` tracking
- Auto-refresh when token has less than 5 minutes remaining
- `getHeaders()` returns all required Copilot headers per implementation-plan.md lines 101-112
- Security: NEVER log full tokens -- log `token.length` and first 8 chars only
- `logout()` clears cached state

**Validation Notes**:

- The `['copilot']` scope may need adjustment -- add a fallback try with `['read:user']` if the first attempt fails
- Handle `vscode.authentication` errors gracefully (user cancellation, no GitHub sign-in)

**Implementation Details**:

- Imports: `vscode`, `tsyringe` (`injectable`, `inject`), `@ptah-extension/vscode-core` (Logger, TOKENS)
- Use `https` module or `fetch` (Node 18+ available) for token exchange HTTP call
- Store state as private field: `private authState: CopilotAuthState | null = null`

---

### Task 1.3: Create copilot-request-translator.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-request-translator.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md lines 117-143

**Quality Requirements**:

- Pure function module (NO class, NO state) -- easy to unit test
- Export: `translateAnthropicToOpenAI(anthropicRequest: AnthropicMessagesRequest): OpenAIChatCompletionsRequest`
- Translation rules per the table in implementation-plan.md lines 129-142:
  - `model` -> pass through
  - `max_tokens` -> `max_tokens`
  - `system` (top-level string or array of content blocks) -> `messages[0]` with `role: 'system'`
  - `messages[].content` text blocks -> flatten to string content
  - `messages[].content` image blocks -> `image_url` parts with `data:` URI
  - `messages[].content` tool_result blocks -> `role: 'tool'` messages with `tool_call_id`
  - `messages[].content` tool_use blocks in assistant messages -> `tool_calls` array in assistant message
  - `tools[].name` + `input_schema` -> `tools[].function` format
  - `tool_choice` -> translate format differences
  - `stream: true` -> direct pass
  - Strip: `thinking`, `metadata`, `cache_control`
- Helper functions should be exported for testing: `translateSystemPrompt`, `translateMessages`, `translateTools`

**Implementation Details**:

- Import types from `copilot-provider.types.ts`
- No external dependencies beyond types
- Handle edge cases: empty messages array, missing system prompt, tool_use with no tools defined

---

### Task 1.4: Create copilot-response-translator.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-response-translator.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md lines 144-173

**Quality Requirements**:

- Stateful class: `CopilotResponseTranslator` (tracks content block indices, tool call accumulation)
- Constructor: `constructor(model: string, requestId: string)`
- Method: `translateChunk(openaiChunk: OpenAIStreamChunk): string[]` -- returns array of SSE event strings
- Method: `finalize(): string[]` -- emit final events on stream end
- Translation rules per implementation-plan.md lines 160-168:
  - First chunk -> `message_start` + `content_block_start` events
  - `delta.content` -> `content_block_delta` with `text_delta` type
  - `delta.tool_calls` -> accumulate, then emit `content_block_start` (tool_use) + `content_block_delta` (input_json_delta)
  - `finish_reason` -> `content_block_stop` + `message_delta` + `message_stop`
  - `usage` -> include in `message_start` and `message_delta`
- SSE format: each returned string is `event: <type>\ndata: <json>\n\n`
- Edge cases (line 170-173):
  - Multi-tool-use: accumulate `tool_calls` deltas by index before emitting
  - Track content block index (incrementing for each new block)
  - Generate unique IDs for tool*use blocks (e.g., `toolu*${requestId}_${index}`)

**Implementation Details**:

- Private fields: `blockIndex: number`, `messageStartSent: boolean`, `toolCallBuffers: Map<number, {...}>`, `inputTokens: number`, `outputTokens: number`
- Each SSE event string formatted as: `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
- Follow Anthropic streaming event format exactly (message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop)

---

### Task 1.5: Create copilot-provider-entry.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-provider-entry.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md lines 196-217

**Quality Requirements**:

- Export `COPILOT_PROVIDER_ENTRY` constant conforming to `AnthropicProvider` interface (imported from `../helpers/anthropic-provider-registry`)
- Static data only -- no logic
- Fields:
  - `id: 'github-copilot'`
  - `name: 'GitHub Copilot'`
  - `baseUrl: ''` (set dynamically to proxy URL at runtime)
  - `authEnvVar: 'ANTHROPIC_AUTH_TOKEN'`
  - `authType: 'oauth'` (new field on interface)
  - `requiresProxy: true` (new field on interface)
  - `keyPrefix: ''`
  - `helpUrl: 'https://github.com/features/copilot'`
  - `description: 'Claude models via GitHub Copilot subscription'`
  - `keyPlaceholder: 'Authenticated via GitHub'`
  - `maskedKeyDisplay: 'GitHub Copilot (connected)'`
  - `staticModels`: Claude models from COPILOT_MODELS constant (filter to Claude only):
    - `claude-sonnet-4.6` (200K context)
    - `claude-opus-4.6` (200K context)
    - `claude-opus-4.5` (200K context)
    - `claude-sonnet-4.5` (200K context)
    - `claude-sonnet-4` (200K context)
    - `claude-haiku-4.5` (200K context)
      All with `supportsToolUse: true`, context 200000. Pricing can be 0 (Copilot subscription).

**Implementation Details**:

- Import `AnthropicProvider`, `ProviderStaticModel` from `../helpers/anthropic-provider-registry`
- The `authType` and `requiresProxy` fields will be added to the interface in Batch 2

**Validation Notes**:

- This task creates the entry, but the `AnthropicProvider` interface extension happens in Batch 2. The new fields will use optional typing (`authType?: ...`) so this file compiles even before Batch 2.

---

### Task 1.6: Create copilot-provider/index.ts barrel -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\index.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md lines 219-228
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\index.ts`

**Quality Requirements**:

- Barrel file exporting the public API of the copilot-provider module
- Exports:
  - `CopilotAuthService` from `./copilot-auth.service`
  - `CopilotResponseTranslator` from `./copilot-response-translator`
  - `translateAnthropicToOpenAI` (and helper functions) from `./copilot-request-translator`
  - `COPILOT_PROVIDER_ENTRY` from `./copilot-provider-entry`
  - Type exports: `ICopilotAuthService`, `ICopilotTranslationProxy`, `CopilotAuthState`, `CopilotTokenResponse` from `./copilot-provider.types`
- NOTE: `CopilotTranslationProxy` is NOT exported here yet (created in Batch 2 Task 2.1)

**Implementation Details**:

- Follow the exact pattern from `ptah-cli/index.ts`
- Use `export type` for interface/type-only exports

---

**Batch 1 Verification**:

- All 6 files exist at paths under `copilot-provider/`
- TypeScript compiles without errors: `npx nx run agent-sdk:typecheck`
- code-logic-reviewer approved (no stubs, TODOs, placeholders)
- Types are comprehensive and well-documented
- Pure functions are stateless, class has proper state management
- Auth service handles all error cases gracefully

---

## Batch 2: Backend Integration (Proxy + Registry + DI) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1
**Commit**: e6204fd0

### Task 2.1: Create copilot-translation-proxy.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-translation-proxy.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md lines 175-195

**Quality Requirements**:

- Injectable class implementing `ICopilotTranslationProxy`
- Constructor injects: `TOKENS.LOGGER`, `SDK_COPILOT_AUTH` token (CopilotAuthService)
- Lifecycle: `start()` -> create `http.createServer`, listen on port 0 (dynamic), return `{ port, url }`
- `stop()` -> close server, clean up
- `isRunning()` -> boolean
- `getUrl()` -> `http://localhost:${port}` or undefined
- Request handling for `POST /v1/messages`:
  1. Parse Anthropic request body from incoming request
  2. Call `translateAnthropicToOpenAI()` from request translator
  3. Get headers from `copilotAuth.getHeaders()`
  4. Forward to `https://api.githubcopilot.com/chat/completions` using `https` module
  5. If streaming: pipe through `CopilotResponseTranslator`, write Anthropic SSE back
  6. If non-streaming: translate full response, return Anthropic JSON
  7. Handle errors: 401 -> refresh token + retry once, 429 -> Anthropic `overloaded_error` format
- Also serve: `GET /v1/models` -> return Copilot's available models in Anthropic format
- Health check: `GET /health` -> `{ status: 'ok' }`

**Implementation Details**:

- Imports: `http`, `https`, `tsyringe`, types from `./copilot-provider.types`, translators from siblings
- Use `http.createServer` (NOT express -- keep lightweight, no extra dependencies)
- For streaming: set `Transfer-Encoding: chunked`, `Content-Type: text/event-stream`
- Generate unique `requestId` per request (for response translator)
- Parse body manually: collect chunks, `JSON.parse(Buffer.concat(chunks).toString())`

**Validation Notes**:

- Port 0 lets OS assign a free port -- eliminates port conflict risk
- Each request creates a new `CopilotResponseTranslator` instance (stateful per-request)
- 401 retry: call `copilotAuth.login()` then retry the request once

---

### Task 2.2: Extend AnthropicProvider interface + add Copilot to registry -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\anthropic-provider-registry.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md lines 234-241

**Quality Requirements**:

- Add TWO optional fields to `AnthropicProvider` interface (line 60-83):
  - `authType?: 'apiKey' | 'oauth'` -- defaults to 'apiKey' behavior if not set
  - `requiresProxy?: boolean` -- defaults to false if not set
- Import `COPILOT_PROVIDER_ENTRY` from `../copilot-provider`
- Register Copilot provider: Since `ANTHROPIC_PROVIDERS` is `as const satisfies`, we CANNOT add a dynamic entry to it. Instead:
  - Keep `ANTHROPIC_PROVIDERS` as-is (static, compile-time providers)
  - Create a new `ALL_PROVIDERS` array that combines static + dynamic providers
  - OR: Add a `registerProvider()` function that appends to a mutable registry
  - Recommended approach: Add `COPILOT_PROVIDER_ENTRY` directly to the `ANTHROPIC_PROVIDERS` array (remove `as const` constraint or use a mutable copy). The simplest approach is to change the array to `const ANTHROPIC_PROVIDERS: AnthropicProvider[] = [...]` and push the Copilot entry.
- Update `getAnthropicProvider()`, `getProviderBaseUrl()`, `getProviderAuthEnvVar()` to work with the updated array

**Implementation Details**:

- The `as const satisfies readonly AnthropicProvider[]` on line 269 must be changed to just `AnthropicProvider[]` to allow the Copilot entry (which has `authType` and `requiresProxy`)
- `AnthropicProviderId` type union on line 272 derived from `as const` will need to become `string` or be manually defined
- Import: `import { COPILOT_PROVIDER_ENTRY } from '../copilot-provider';`
- Add Copilot as last entry in the array

**Validation Notes**:

- RISK: Changing `as const` may break downstream type narrowing. Check if `AnthropicProviderId` is used elsewhere for literal type checking.

---

### Task 2.3: Add OAuth branch to AuthManager -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\auth-manager.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md lines 243-252

**Quality Requirements**:

- Add constructor injections for `CopilotAuthService` and `CopilotTranslationProxy` via new DI tokens
- Modify `configureAnthropicProvider()` method (line 268-336):
  - After getting `providerId` and `provider`, check `provider.requiresProxy && provider.authType === 'oauth'`
  - If OAuth provider:
    1. Call `copilotAuth.isAuthenticated()` -- if not, try `copilotAuth.login()`
    2. If still not authenticated, return `{ configured: false, details: [] }`
    3. Call `copilotProxy.start()` to get proxy URL
    4. Set `this.authEnv.ANTHROPIC_BASE_URL = proxyUrl`
    5. Set `this.authEnv.ANTHROPIC_AUTH_TOKEN = 'copilot-proxy-managed'` (placeholder -- proxy handles real auth)
    6. Apply tier mappings and seed pricing
    7. Return success details
  - Else: existing API key flow (unchanged)
- The new injections should use `@inject(SDK_TOKENS.SDK_COPILOT_AUTH)` and `@inject(SDK_TOKENS.SDK_COPILOT_PROXY)`
- Make injections optional with `@optional()` from tsyringe so AuthManager still works if Copilot provider is not registered

**Implementation Details**:

- Import: `CopilotAuthService` from `../copilot-provider`, `CopilotTranslationProxy` (when available)
- Use tsyringe `@optional()` decorator for both new constructor params
- Add to `clearAuthentication()`: if proxy is running, stop it

---

### Task 2.4: Add DI tokens for Copilot services -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
**Action**: MODIFY

**Quality Requirements**:

- Add two new tokens to `SDK_TOKENS` object:
  - `SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth')` -- CopilotAuthService
  - `SDK_COPILOT_PROXY: Symbol.for('SdkCopilotProxy')` -- CopilotTranslationProxy
- Add comment: `/** Copilot Provider Services (TASK_2025_186) */`
- Follow existing naming convention and `Symbol.for()` pattern

**Implementation Details**:

- Add after the `SDK_SLASH_COMMAND_INTERCEPTOR` entry (line 100)
- Ensure `Symbol.for()` descriptions are globally unique

---

### Task 2.5: Register Copilot services in DI container -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
**Action**: MODIFY

**Quality Requirements**:

- Import `CopilotAuthService` and `CopilotTranslationProxy` from `../copilot-provider`
- Register both as singletons:
  ```
  container.register(SDK_TOKENS.SDK_COPILOT_AUTH, { useClass: CopilotAuthService }, { lifecycle: Lifecycle.Singleton });
  container.register(SDK_TOKENS.SDK_COPILOT_PROXY, { useClass: CopilotTranslationProxy }, { lifecycle: Lifecycle.Singleton });
  ```
- Add section comment: `// Copilot Provider Services (TASK_2025_186)`
- Place before the "Main Adapter" section (before line 346)
- Update barrel export in `copilot-provider/index.ts` to also export `CopilotTranslationProxy` (now that it exists)

**Implementation Details**:

- Follow exact pattern of existing registrations
- Both services must be registered before `SdkAgentAdapter` (which depends on AuthManager which now depends on these)

---

**Batch 2 Verification**:

- All files compile: `npx nx run agent-sdk:typecheck`
- Proxy starts and serves health check endpoint
- AnthropicProvider interface has new optional fields
- AuthManager handles both OAuth and API key flows
- DI container resolves all new tokens
- code-logic-reviewer approved

---

## Batch 3: Frontend + RPC -- COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2
**Commit**: dbad8f6a

### Task 3.1: Add GitHub Copilot to frontend AVAILABLE_PROVIDERS -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md lines 259-264

**Quality Requirements**:

- Add `github-copilot` to the `AVAILABLE_PROVIDERS` array (line 43-59):
  ```
  { id: 'github-copilot', name: 'GitHub Copilot', description: 'Claude models via GitHub Copilot subscription' }
  ```
- When `github-copilot` is selected as provider in the add form:
  - Hide the API key input field (Copilot uses OAuth, not API keys)
  - Show a "Login with GitHub" button instead
  - The button calls RPC `auth:copilotLogin`
  - After successful login, show "Connected as {username}" status
  - Update `canCreate` computed to allow creation without API key when provider is `github-copilot`
- Add new signals:
  - `copilotLoginStatus: signal<'idle' | 'logging-in' | 'connected' | 'error'>('idle')`
  - `copilotUsername: signal<string | null>(null)`
- Add new method:
  - `async loginWithGitHub(): Promise<void>` -- calls `auth:copilotLogin` RPC, updates status
- Check copilot status on provider change: when user selects `github-copilot`, call `auth:copilotStatus` RPC to check if already connected

**Implementation Details**:

- Imports: add `Github` icon from `lucide-angular` (or use existing `Plug` icon)
- Template changes: wrap API key input in `@if (newAgentProvider() !== 'github-copilot')` block
- Add GitHub login button: `@if (newAgentProvider() === 'github-copilot')` block
- The create call for github-copilot should pass `apiKey: 'copilot-oauth'` as a placeholder (the backend proxy manages real auth)

---

### Task 3.2: Create Copilot auth RPC handlers -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md lines 266-268

**Quality Requirements**:

- Add two new RPC handlers in the existing `AuthRpcHandlers` class:
  - `auth:copilotLogin` -> triggers Copilot OAuth login flow
    - Resolve `CopilotAuthService` from DI container using `SDK_TOKENS.SDK_COPILOT_AUTH`
    - Call `copilotAuth.login()`
    - Return `{ success: boolean, username?: string, error?: string }`
  - `auth:copilotStatus` -> check if Copilot is already authenticated
    - Resolve `CopilotAuthService` from DI container
    - Call `copilotAuth.isAuthenticated()`
    - Return `{ authenticated: boolean, username?: string }`
- Inject `SDK_TOKENS.SDK_COPILOT_AUTH` in constructor (optional injection with `@optional()`)
- Register both handlers in the `registerHandlers()` method

**Implementation Details**:

- Import `SDK_TOKENS` from `@ptah-extension/agent-sdk`
- Import `CopilotAuthService` type from `@ptah-extension/agent-sdk`
- For username: extract from the GitHub auth session (`session.account.label`)
- Handle case where CopilotAuthService is not available (return error gracefully)

---

### Task 3.3: Export Copilot provider from agent-sdk barrel -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`
**Action**: MODIFY

**Quality Requirements**:

- Add exports for the copilot-provider module:
  - `export { CopilotAuthService, CopilotTranslationProxy, COPILOT_PROVIDER_ENTRY } from './lib/copilot-provider';`
  - `export type { ICopilotAuthService, ICopilotTranslationProxy, CopilotAuthState } from './lib/copilot-provider';`
- Place after the existing ptah-cli exports (around line 176)
- Add section comment: `// Copilot Provider (TASK_2025_186)`

**Implementation Details**:

- Follow existing export patterns in the file
- Use `export type` for interface-only exports

---

**Batch 3 Verification**:

- Frontend compiles: `npx nx build ptah-extension-webview`
- Backend compiles: `npx nx run agent-sdk:typecheck`
- RPC handlers respond to `auth:copilotLogin` and `auth:copilotStatus`
- Settings UI shows GitHub Copilot option with login button
- code-logic-reviewer approved
