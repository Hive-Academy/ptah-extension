# Development Tasks - TASK_2025_156

**Total Tasks**: 23 | **Batches**: 7 | **Status**: 0/7 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `TOKENS.GOOGLE_OAUTH_SERVICE` defined at `tokens.ts:121`: Verified
- `GoogleOAuthService` registered at `register.ts:89`: Verified
- `LlmConfigurationService` injects `GOOGLE_OAUTH_SERVICE` at constructor line 70-71: Verified
- `LlmRpcHandlers` injects `GOOGLE_OAUTH_SERVICE` at constructor line 135-136: Verified
- `ProviderRegistry` does NOT currently inject `GOOGLE_OAUTH_SERVICE` (only `LLM_SECRETS_SERVICE` + `LOGGER`): Verified - plan correctly adds new injection
- `createGoogleProviderWithOAuth` exists at `google.ts:103`: Referenced in plan, verified via evidence
- ESM dynamic import + caching pattern established in `google-genai-loader.ts`: Verified
- `GoogleOAuthService` exported from `index.ts:69`: Verified
- `provider-registry.ts:152-167` rejects providers without API key (no CLI auth fallback exists): Verified

### Risks Identified

| Risk                                                                                                                                     | Severity | Mitigation                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `@google/gemini-cli-core` auth API surface is ASSUMED (not verified)                                                                     | HIGH     | Task 1.1 is SDK API verification - must complete before loader/service creation    |
| `@openai/codex-sdk` auth API surface is ASSUMED                                                                                          | HIGH     | Task 5.1 is SDK API verification - if blocked, defer Phase 2 entirely              |
| ESM bundling of new packages may fail in Webpack                                                                                         | MED      | Follow proven `@google/genai` pattern; build verification after each phase         |
| `ProviderRegistry.createProviderInternal()` currently passes apiKey directly to factory (line 180) - CLI token path needs different flow | MED      | Task 2.2 handles this; must use `createGoogleProviderWithOAuth` for CLI token path |
| Race condition: CLI token expires between `hasCliAuth()` and `getCliAccessToken()` calls                                                 | LOW      | SDK handles refresh internally; CliAuthService adds 5-min buffer on cache TTL      |

### Edge Cases to Handle

- [ ] CLI package not installed (import fails) -> hasCliAuth returns false, graceful degradation
- [ ] CLI credentials expired and refresh fails -> getCliAccessToken returns undefined, fall back to BYOK
- [ ] Both BYOK API key AND CLI auth present -> API key takes precedence (enforced in ProviderRegistry)
- [ ] User has never run Gemini/Codex CLI -> UI shows instructions, no errors thrown

---

## Batch 1: Foundation - npm Install + SDK Verification + Loaders + DI

**Status**: IN PROGRESS
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Install @google/gemini-cli-core and verify auth API surface

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\package.json`
**Spec Reference**: implementation-plan.md Component 18, Critical Verification Points

**Quality Requirements**:

- Run `npm install @google/gemini-cli-core` (pin to specific version found)
- After install, READ the package's TypeScript declarations to find actual auth functions
- Verify: Does it export `getAccessToken()` or `authenticate()` or similar?
- Verify: Does it support `authType: 'oauth-personal'` for cached credential reuse?
- Document actual API surface findings for Task 1.2 and 1.3

**Validation Notes**:

- This is the CRITICAL prerequisite. The loader and service implementations depend on real API shape
- If the package does not export usable auth functions, STOP and report blocker

**Implementation Details**:

- `npm install @google/gemini-cli-core`
- Read `node_modules/@google/gemini-cli-core/dist/` for type declarations
- Report back exact function signatures available

---

### Task 1.2: Create gemini-cli-loader.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\gemini-cli-loader.ts` (CREATE)
**Dependencies**: Task 1.1
**Spec Reference**: implementation-plan.md Component 1
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\google-genai-loader.ts`

**Quality Requirements**:

- Follow exact same caching pattern as `google-genai-loader.ts`
- Define local type interfaces for the auth surface (based on Task 1.1 findings)
- Handle missing package gracefully (catch import error, return undefined)
- Must NOT modify CLI credential files (read-only access)
- Export: `loadGeminiCliAuth()`, `isGeminiCliAuthLoaded()`, `clearGeminiCliAuthCache()`

**Implementation Details**:

- Dynamic import of `@google/gemini-cli-core`
- Cache the loaded module
- Local type definitions for the auth API surface
- Graceful error handling on import failure

---

### Task 1.3: Create cli-auth.service.ts (Gemini CLI only initially)

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-auth.service.ts` (CREATE)
**Dependencies**: Task 1.2
**Spec Reference**: implementation-plan.md Component 3
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\google-oauth.service.ts` (for DI pattern)

**Quality Requirements**:

- `@injectable()` singleton with `@inject(TOKENS.LOGGER)`
- Implement `hasCliAuth(provider)`, `getCliAccessToken(provider)`, `getCliAccountInfo(provider)`
- Gemini CLI methods fully implemented; Codex CLI methods return `false`/`undefined` (placeholder for Phase 2)
- Must never throw - always return undefined on failure
- Must never write to CLI credential files (read-only)
- Token cache TTL: 55 minutes (matching TOKEN_CACHE_DURATION_SECONDS = 3300)
- Handle missing CLI packages gracefully

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe; `TOKENS`, `Logger` from `@ptah-extension/vscode-core`
- Use `loadGeminiCliAuth()` from gemini-cli-loader.ts
- In-memory token cache with `Map<string, { token: string; expiresAt: number }>`
- 5-minute buffer on cache expiry check (Date.now() < expiresAt - 300_000)

---

### Task 1.4: Update DI token - replace GOOGLE_OAUTH_SERVICE with CLI_AUTH_SERVICE

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
**Dependencies**: None (can run in parallel with Task 1.2-1.3)
**Spec Reference**: implementation-plan.md Component 4

**Quality Requirements**:

- Remove `GOOGLE_OAUTH_SERVICE = Symbol.for('GoogleOAuthService')` at line 121
- Add `CLI_AUTH_SERVICE = Symbol.for('CliAuthService')` in same section
- Update TOKENS object: remove `GOOGLE_OAUTH_SERVICE`, add `CLI_AUTH_SERVICE`

**Implementation Details**:

- Edit tokens.ts line 121: replace symbol definition
- Edit TOKENS object (around line 363): swap the token reference

---

### Task 1.5: Update DI registration - register CliAuthService

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\di\register.ts`
**Dependencies**: Task 1.3, Task 1.4
**Spec Reference**: implementation-plan.md Component 5

**Quality Requirements**:

- Remove `GoogleOAuthService` import and registration (lines 31, 89)
- Add `CliAuthService` import from `../services/cli-auth.service`
- Register as singleton: `container.registerSingleton(TOKENS.CLI_AUTH_SERVICE, CliAuthService)`
- Update comment on line 91 to reference CliAuthService dependencies

**Implementation Details**:

- Replace import of GoogleOAuthService with CliAuthService
- Replace `container.registerSingleton(TOKENS.GOOGLE_OAUTH_SERVICE, GoogleOAuthService)` at line 89
- With `container.registerSingleton(TOKENS.CLI_AUTH_SERVICE, CliAuthService)`

---

**Batch 1 Verification**:

- All 3 new/modified files exist at paths
- `gemini-cli-loader.ts` follows caching pattern
- `cli-auth.service.ts` has proper DI decorators
- `tokens.ts` has `CLI_AUTH_SERVICE` token, no `GOOGLE_OAUTH_SERVICE`
- `register.ts` registers `CliAuthService`
- code-logic-reviewer approved

---

## Batch 2: Backend Service Migration (Swap All Consumers)

**Status**: IN PROGRESS
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Update LlmConfigurationService - inject CLI_AUTH_SERVICE

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm-configuration.service.ts`
**Dependencies**: Batch 1
**Spec Reference**: implementation-plan.md Component 6

**Quality Requirements**:

- Replace constructor injection: `TOKENS.GOOGLE_OAUTH_SERVICE` -> `TOKENS.CLI_AUTH_SERVICE`
- Replace type: `IGoogleOAuthService` -> `CliAuthService` (or ICliAuthService interface)
- Update `getAvailableProviders()` (lines 187-199): replace `googleOAuth.hasOAuthToken()` with `cliAuth.hasCliAuth()` for both google-genai and openai
- Update `getAllProviders()` (lines 222-241): replace google-genai special case with generic CLI auth check for both google-genai and openai
- API key always takes precedence over CLI auth

**Implementation Details**:

- Constructor line 70-71: swap injection token and type
- `getAvailableProviders()`: generic CLI auth check loop for `['google-genai', 'openai']`
- `getAllProviders()`: `isConfigured = hasCliAuth || hasApiKey` for google-genai and openai

---

### Task 2.2: Update ProviderRegistry - inject CLI_AUTH_SERVICE, add CLI token path

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\registry\provider-registry.ts`
**Dependencies**: Batch 1
**Spec Reference**: implementation-plan.md Component 7

**Quality Requirements**:

- Add `@inject(TOKENS.CLI_AUTH_SERVICE) private readonly cliAuth: CliAuthService` to constructor
- Modify `createProviderInternal()` lines 152-167: check both API key AND CLI auth before rejecting
- After factory loading (line 176): if no API key but CLI auth exists, use CLI token path
- For google-genai: use `createGoogleProviderWithOAuth(cliToken, model)`
- For openai: pass CLI token as API key to factory (Bearer token)
- API key ALWAYS takes precedence (check apiKey first)

**Validation Notes**:

- Currently factory is called at line 180 with `factory(apiKey, model)` - when using CLI token for google-genai, must use the OAuth factory path instead
- For openai, the CLI token can be passed as apiKey parameter directly

**Implementation Details**:

- Add import for `CliAuthService` or type
- Add constructor parameter with `@inject(TOKENS.CLI_AUTH_SERVICE)`
- Modify API key check block (lines 152-167): `!hasKey && !hasCliAuth` -> reject
- After line 176: if `!apiKey && providerName !== 'vscode-lm'`, try CLI token path

---

### Task 2.3: Update ImageGenerationService - inject CLI_AUTH_SERVICE

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\image-generation.service.ts`
**Dependencies**: Batch 1
**Spec Reference**: implementation-plan.md Component 10

**Quality Requirements**:

- Replace constructor injection: `TOKENS.GOOGLE_OAUTH_SERVICE` -> `TOKENS.CLI_AUTH_SERVICE`
- Replace `isAvailable()`: `googleOAuth.hasOAuthToken()` -> `cliAuth.hasCliAuth('google-genai')`
- Replace `generateImage()`: `googleOAuth.getAccessToken()` -> `cliAuth.getCliAccessToken('google-genai')`
- Update all subsequent `oauthToken` references to `cliToken`

**Implementation Details**:

- Constructor lines 121-122: swap injection token and type
- `isAvailable()` lines 135-139: replace OAuth check with CLI auth check
- `generateImage()` lines 180-183: replace OAuth token with CLI token

---

**Batch 2 Verification**:

- All 3 files modified with correct injections
- No remaining references to `GOOGLE_OAUTH_SERVICE` in modified files
- No remaining references to `googleOAuth` variable in modified files
- code-logic-reviewer approved

---

## Batch 3: RPC Layer Migration

**Status**: IN PROGRESS
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 2

### Task 3.1: Update LlmRpcHandlers (vscode-core) - replace OAuth methods with CLI auth

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\llm-rpc-handlers.ts`
**Dependencies**: Batch 2
**Spec Reference**: implementation-plan.md Component 8

**Quality Requirements**:

- Replace constructor injection (line 135-136): `GOOGLE_OAUTH_SERVICE` -> `CLI_AUTH_SERVICE`
- Update `getProviderStatus()` (lines 163-216): replace Google OAuth enrichment with generic CLI auth enrichment for all providers
- Replace `hasOAuthToken`/`oauthAccountEmail` fields with `hasCliAuth`/`cliAuthEmail` in provider status response
- REMOVE methods: `googleOAuthSignIn()`, `googleOAuthSignOut()`, `getGoogleOAuthStatus()` (lines 773-858)
- ADD method: `getCliAuthStatus()` returning status for all CLI-auth-capable providers
- Update `listProviderModels()` (lines 510-573): replace OAuth token path with CLI auth token path for both google-genai and openai

**Validation Notes**:

- This removes sign-in/sign-out methods entirely - CLI auth is managed externally
- The `getCliAuthStatus()` method returns an array of providers with their CLI auth state

**Implementation Details**:

- Constructor: swap injection token and type
- `getProviderStatus()`: loop over providers, check `cliAuth.hasCliAuth()` for non-vscode-lm providers
- Remove 3 old OAuth methods (~85 lines)
- Add `getCliAuthStatus()` method
- `listProviderModels()`: for google-genai and openai, try CLI token when no API key

---

### Task 3.2: Update App-Layer RPC Handlers - register llm:getCliAuthStatus

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\llm-rpc.handlers.ts`
**Dependencies**: Task 3.1
**Spec Reference**: implementation-plan.md Component 9

**Quality Requirements**:

- Remove registrations: `registerGoogleOAuthSignIn()`, `registerGoogleOAuthSignOut()`, `registerGetGoogleOAuthStatus()` (lines 50-52)
- Remove method implementations (lines 362-438)
- Add `registerGetCliAuthStatus()` registration call and method implementation
- New method delegates to `handlers.getCliAuthStatus()`

**Implementation Details**:

- In `register()` method (lines 40-69): remove 3 old calls, add 1 new call
- Delete 3 method implementations (~76 lines)
- Add `registerGetCliAuthStatus()` method using same RPC pattern

---

### Task 3.3: Update RPC type definitions

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Dependencies**: None (can run in parallel with 3.1-3.2)
**Spec Reference**: implementation-plan.md Component 12

**Quality Requirements**:

- REMOVE types (lines 1150-1176): `LlmGoogleOAuthSignInParams/Response`, `LlmGoogleOAuthSignOutParams/Response`, `LlmGetGoogleOAuthStatusParams/Response`
- REMOVE from RPC method map (lines 1458-1469): 3 Google OAuth method entries
- REMOVE from RPC method name union (lines 1637-1639): 3 Google OAuth method names
- ADD: `LlmGetCliAuthStatusParams`, `LlmGetCliAuthStatusResponse` types
- ADD to RPC method map: `'llm:getCliAuthStatus'` entry
- ADD to RPC method name union: `'llm:getCliAuthStatus'`

**Implementation Details**:

- New types: `LlmGetCliAuthStatusParams = Record<string, never>`
- New response: `LlmGetCliAuthStatusResponse` with `providers` array
- Each provider entry: `{ provider: LlmProviderName; isAuthenticated: boolean; email?: string; cliName: string }`

---

**Batch 3 Verification**:

- No remaining Google OAuth RPC methods in either handler file
- `rpc.types.ts` has no Google OAuth type references
- New `llm:getCliAuthStatus` type and method properly registered
- code-logic-reviewer approved

---

## Batch 4: Cleanup - Delete Old Files + Update Exports + Webpack

**Status**: IN PROGRESS
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 3

### Task 4.1: Delete google-oauth.service.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\google-oauth.service.ts` (DELETE)
**Spec Reference**: implementation-plan.md Component 17

**Quality Requirements**:

- Delete the entire file
- Verify no remaining imports of this file anywhere in the codebase
- This removes the embedded CLIENT_ID and CLIENT_SECRET

---

### Task 4.2: Delete google-auth-provider.ts + Remove from main.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\google-auth-provider.ts` (DELETE)
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts` (MODIFY)
**Spec Reference**: implementation-plan.md Component 11

**Quality Requirements**:

- Delete `google-auth-provider.ts` entirely
- In `main.ts`: remove import of `PtahGoogleAuthProvider` (line 16)
- In `main.ts`: remove the `vscode.authentication.registerAuthenticationProvider(...)` block (lines ~382-396)
- Verify no remaining references to `PtahGoogleAuthProvider` in codebase

---

### Task 4.3: Update llm-abstraction index.ts exports

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\index.ts`
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md Component 13

**Quality Requirements**:

- Remove: `export { GoogleOAuthService } from './lib/services/google-oauth.service'` (line 69)
- Add: `export { CliAuthService } from './lib/services/cli-auth.service'`

---

### Task 4.4: Update webpack.config.js - add @google/gemini-cli-core bundle rule

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\webpack.config.js`
**Spec Reference**: implementation-plan.md Component 14

**Quality Requirements**:

- Add after the `@google/genai` block (after line 59):
  ```javascript
  if (request.startsWith('@google/gemini-cli-core')) {
    return callback(); // Bundle it (ESM-only)
  }
  ```
- Follow exact same pattern as existing `@google/genai` bundling rule

---

**Batch 4 Verification**:

- `google-oauth.service.ts` deleted
- `google-auth-provider.ts` deleted
- `main.ts` has no PtahGoogleAuthProvider references
- `index.ts` exports CliAuthService, not GoogleOAuthService
- `webpack.config.js` has gemini-cli-core bundle rule
- Build passes: `npm run build:all`
- code-logic-reviewer approved

---

## Batch 5: OpenAI Codex CLI Auth (Phase 2)

**Status**: DEFERRED - BLOCKED (SDK does not support external auth/token reuse)
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 4

### Task 5.1: Install @openai/codex-sdk and verify auth API surface

**Status**: DEFERRED - BLOCKER FOUND
**File**: `D:\projects\ptah-extension\package.json`
**Spec Reference**: implementation-plan.md Component 18, Critical Verification Points

**SDK Verification Results (2026-02-20)**:

1. **Package exists**: `@openai/codex-sdk@0.104.0` on npm (published 2026-02-18)
2. **SDK purpose**: Agent execution SDK -- spawns Codex CLI binary as subprocess. NOT a credential/auth library.
3. **API surface**: Exports only `Codex` class (agent runner) and `Thread` class (conversation). The `CodexOptions` type accepts `apiKey?: string` as pass-through to CLI, but provides NO credential reading/loading functions.
4. **No auth exports**: No `getAccessToken()`, `loadCredentials()`, `authenticate()`, or any auth-related functions.
5. **Codex CLI is a compiled binary** (`@openai/codex` ships platform-specific Rust binaries) -- no importable JavaScript auth modules.
6. **`~/.codex/auth.json`** stores ChatGPT OAuth tokens (`access_token`, `refresh_token`, `id_token`), BUT these are OpenAI-internal OAuth tokens, NOT standard OpenAI API keys. They work with OpenAI's Responses API (internal to Codex) but are NOT interchangeable with Chat Completions API keys used by our `openai` SDK provider.
7. **Token refresh** requires OpenAI's internal OAuth endpoints (not publicly documented).
8. **Auth format instability**: The auth system "changed significantly since 0.23.0" per OpenAI maintainers.

**Conclusion**: `@openai/codex-sdk` does NOT support external auth/token reuse. The ChatGPT OAuth tokens stored by Codex CLI are not usable as OpenAI API keys for our provider. Package was installed for verification, then uninstalled.

**Graceful Degradation**: The existing `CliAuthService` stubs already handle this correctly:

- `hasCodexCliAuth()` returns `false`
- `getCodexCliToken()` returns `undefined`
- `getCodexCliAccountInfo()` returns `undefined`

---

### Task 5.2: Create codex-cli-loader.ts

**Status**: DEFERRED (blocked by Task 5.1)
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\codex-cli-loader.ts` (CREATE)
**Dependencies**: Task 5.1
**Spec Reference**: implementation-plan.md Component 2
**Pattern to Follow**: Task 1.2 (gemini-cli-loader.ts)

**Quality Requirements**:

- Same caching pattern as gemini-cli-loader.ts
- Local type definitions for Codex auth API (based on Task 5.1 findings)
- Graceful error handling on import failure
- Export: `loadCodexCliAuth()`, `isCodexCliAuthLoaded()`, `clearCodexCliAuthCache()`

---

### Task 5.3: Update cli-auth.service.ts - add Codex CLI methods

**Status**: DEFERRED (blocked by Task 5.1)
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-auth.service.ts` (MODIFY)
**Dependencies**: Task 5.2
**Spec Reference**: implementation-plan.md Component 3 (Codex section)

**Quality Requirements**:

- Replace placeholder `hasCodexCliAuth()` and `getCodexCliToken()` with real implementations
- Use `loadCodexCliAuth()` from codex-cli-loader.ts
- Same error handling and caching patterns as Gemini methods
- For openai, token is passed as Bearer token (same as API key parameter)

---

### Task 5.4: Update webpack.config.js - add @openai/codex-sdk bundle rule

**Status**: DEFERRED (blocked by Task 5.1)
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\webpack.config.js`
**Dependencies**: Task 5.1
**Spec Reference**: implementation-plan.md Component 14

**Quality Requirements**:

- Add after the gemini-cli-core block:
  ```javascript
  if (request.startsWith('@openai/codex-sdk')) {
    return callback(); // Bundle it (ESM-only)
  }
  ```

---

**Batch 5 Verification**:

- Task 5.1 BLOCKED: SDK does not support external auth pattern
- Batch DEFERRED per implementation-plan.md deferral clause
- Existing CliAuthService stubs provide graceful degradation (returns false/undefined)
- No code changes needed -- Phase 1 (Gemini CLI) remains fully functional

---

## Batch 6: Frontend State Update

**Status**: PENDING
**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 3 (RPC types must be finalized)

### Task 6.1: Update LlmProviderStateService - replace OAuth signals with CLI auth signals

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\llm-provider-state.service.ts`
**Dependencies**: Batch 3
**Spec Reference**: implementation-plan.md Component 15

**Quality Requirements**:

- REMOVE signals (lines 79-87): `_googleOAuthSignedIn`, `_googleOAuthEmail`, `_googleOAuthLoading`
- REMOVE public readonly signals (lines 115-121): `googleOAuthSignedIn`, `googleOAuthEmail`, `googleOAuthLoading`
- ADD: `_cliAuthStatus` signal with `Array<{ provider, isAuthenticated, email?, cliName }>`
- ADD: `cliAuthStatus` readonly signal
- ADD: `hasCliAuth(provider)` computed helper (returns boolean)
- ADD: `cliAuthEmail(provider)` computed helper (returns string)
- REPLACE `loadGoogleOAuthStatus()` (lines 416-433) with `loadCliAuthStatus()` calling `llm:getCliAuthStatus` RPC
- UPDATE `fetchProviderStatus()` (line 223): call `loadCliAuthStatus()` instead of `loadGoogleOAuthStatus()`
- REMOVE methods: `signInWithGoogle()`, `signOutFromGoogle()` (lines 441-526)

**Implementation Details**:

- Use `signal<Array<...>>([])` for initial empty state
- `hasCliAuth` and `cliAuthEmail` are methods that search the array, not computed signals
- RPC call: `this.rpc.call('llm:getCliAuthStatus', {})`

---

### Task 6.2: Update message-finalization.service.ts if it references OAuth signals

**Status**: IMPLEMENTED (no-op - file has no Google OAuth references)
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\message-finalization.service.ts`
**Dependencies**: Task 6.1

**Quality Requirements**:

- Check if this file references any Google OAuth signals from LlmProviderStateService
- If yes, update references to use new CLI auth signals
- If no references, mark as no-op complete

---

**Batch 6 Verification**:

- No remaining `googleOAuth` signal references in frontend services
- `cliAuthStatus` signal properly initialized
- `loadCliAuthStatus()` calls correct RPC method
- code-logic-reviewer approved

---

## Batch 7: Frontend UI Update

**Status**: IMPLEMENTED
**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 6

### Task 7.1: Update llm-providers-config.component.ts - remove OAuth methods

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\llm-providers-config.component.ts`
**Dependencies**: Batch 6
**Spec Reference**: implementation-plan.md Component 16

**Quality Requirements**:

- REMOVE methods: `onGoogleSignIn()`, `onGoogleSignOut()` (lines 347-357)
- REMOVE icon imports: `LogIn`, `LogOut` (lines 44-45) if only used for OAuth
- Verify no other references to removed methods in the component

---

### Task 7.2: Update llm-providers-config.component.html - CLI auth status UI

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\llm-providers-config.component.html`
**Dependencies**: Task 7.1
**Spec Reference**: implementation-plan.md Component 16

**Quality Requirements**:

- REPLACE Google OAuth section (lines 143-196) with generic CLI auth status section
- For both `google-genai` and `openai` providers: show CLI auth status when authenticated
- When not authenticated: show instructions (Gemini CLI / Codex CLI command)
- Include "or use an API key" divider when CLI auth not detected
- UPDATE API key section condition (line 199): hide API key input when CLI auth is active
- Use `llmState.hasCliAuth(provider.provider)` and `llmState.cliAuthEmail(provider.provider)`
- Use DaisyUI classes consistent with existing UI

**Implementation Details**:

- `@if (provider.provider === 'google-genai' || provider.provider === 'openai')` block
- Authenticated state: green check icon + "Authenticated via [CLI name]" + optional email
- Not authenticated: instructions with `<code>` block for CLI command
- Divider: `<div class="divider my-1 text-xs">or use an API key</div>`

---

**Batch 7 Verification**:

- No remaining Google OAuth UI elements in template
- CLI auth status displays correctly for both providers
- API key section conditionally hidden when CLI auth active
- Build passes: `npm run build:all`
- code-logic-reviewer approved

---

## Build Verification Checkpoints

| After Batch | Command             | Expected Result                                       |
| ----------- | ------------------- | ----------------------------------------------------- |
| Batch 4     | `npm run build:all` | Clean build, no bundle errors (Phase 1 complete)      |
| Batch 5     | `npm run build:all` | Clean build with Codex SDK bundled (Phase 2 complete) |
| Batch 7     | `npm run build:all` | Clean build, full feature complete                    |
