# Implementation Plan - TASK_2025_193: Codex Translation Proxy Support

## Codebase Investigation Summary

### Libraries Analyzed

- **agent-sdk/copilot-provider/** - 7 files: auth, request translator, response translator, proxy server, types, provider entry, barrel exports
- **agent-sdk/helpers/anthropic-provider-registry.ts** - Provider registry with `AnthropicProvider` interface, `ANTHROPIC_PROVIDERS` array
- **agent-sdk/helpers/auth-manager.ts** - Authentication orchestration with OAuth provider flow (`configureOAuthProvider`)
- **agent-sdk/di/tokens.ts** - DI tokens including `SDK_COPILOT_AUTH`, `SDK_COPILOT_PROXY`
- **agent-sdk/di/register.ts** - Service registration including Copilot services
- **llm-abstraction/cli-adapters/codex-cli.adapter.ts** - Codex CLI adapter with auth resolution from `~/.codex/auth.json`, OAuth token refresh
- **infra-test/test-codex-models.ts** - Codex model test hitting `chatgpt.com/backend-api/codex/models`

### Key Patterns Verified

**Translation Proxy Pattern** (copilot-translation-proxy.ts):

- `@injectable()` class with `@inject(TOKENS.LOGGER)` and `@inject(SDK_TOKENS.SDK_COPILOT_AUTH)`
- Implements `ICopilotTranslationProxy` interface
- Creates `http.Server` on port 0, routes `/v1/messages` (POST), `/v1/models` (GET), `/health` (GET)
- Uses `translateAnthropicToOpenAI()` for request translation, `CopilotResponseTranslator` for response translation
- Forwards to upstream API via `https.request()` with auth headers from auth service
- Handles 401 retry, 429 rate limiting, streaming + non-streaming responses

**Auth Service Pattern** (copilot-auth.service.ts):

- `@injectable()` with `@inject(TOKENS.LOGGER)`
- Implements `ICopilotAuthService` interface (login, isAuthenticated, getAuthState, getHeaders, logout)
- Returns `Record<string, string>` from `getHeaders()` for proxy to use

**Provider Entry Pattern** (copilot-provider-entry.ts):

- Const `COPILOT_PROVIDER_ENTRY: AnthropicProvider` with `authType: 'oauth'`, `requiresProxy: true`
- Static models array with `ProviderStaticModel[]`
- Default tier mappings const

**Auth Manager OAuth Flow** (auth-manager.ts:363-432):

- `configureOAuthProvider()` method handles `provider.requiresProxy && provider.authType === 'oauth'`
- Currently hardcoded to use `this.copilotAuth` and `this.copilotProxy` injected services
- Needs generalization to support multiple OAuth proxy providers

**Codex Auth** (codex-cli.adapter.ts:298-318, test-codex-models.ts:34-132):

- Reads `~/.codex/auth.json` with structure: `{ OPENAI_API_KEY?, tokens?: { access_token, refresh_token } }`
- API key takes priority over OAuth tokens
- OAuth refresh via `https://auth.openai.com/oauth/token` with client_id `app_EMoamEEZ73f0CkXaXp7hrann`
- Token expiry at ~50 min, proactive refresh

**Codex API Endpoint** (test-codex-models.ts:196):

- `https://chatgpt.com/backend-api/codex/models?client_version={version}` for model listing
- Chat completions endpoint: `https://api.chatgpt.com/v1/chat/completions` (standard OpenAI format -- needs verification)

**Request Translator Model Prefix** (copilot-request-translator.ts:57-61):

- Copilot adds `capi:` prefix to model IDs
- Codex likely needs NO prefix (sends model IDs as-is to chatgpt.com backend)

## Architecture Design

### Design Philosophy

**Approach**: Extract shared OpenAI translation infrastructure, then create thin Codex-specific implementations.

The request/response translators and protocol types are genuinely protocol-level (Anthropic <-> OpenAI) with zero Copilot-specific logic. The only Copilot-specific part is the `capi:` model prefix in the request translator. This can be parameterized.

### Component Architecture

```
libs/backend/agent-sdk/src/lib/
  openai-translation/          <-- NEW: Shared module
    index.ts                   <-- Barrel exports
    openai-translation.types.ts  <-- All protocol types (moved from copilot-provider.types.ts)
    request-translator.ts      <-- Pure functions (moved from copilot-request-translator.ts)
    response-translator.ts     <-- Stateful class (moved from copilot-response-translator.ts)
    translation-proxy-base.ts  <-- Abstract base class for proxy servers

  copilot-provider/            <-- MODIFIED: Uses shared module
    copilot-auth.service.ts    <-- Unchanged
    copilot-provider-entry.ts  <-- Unchanged
    copilot-provider.types.ts  <-- Reduced: Only Copilot-specific types (auth state, sentinels)
    copilot-translation-proxy.ts  <-- MODIFIED: extends base, adds Copilot-specific config
    index.ts                   <-- MODIFIED: Re-export paths adjusted

  codex-provider/              <-- NEW: Codex provider module
    index.ts                   <-- Barrel exports
    codex-auth.service.ts      <-- Reads ~/.codex/auth.json, handles OAuth refresh
    codex-provider-entry.ts    <-- Provider registry entry with static models
    codex-provider.types.ts    <-- Codex-specific types (auth file shape, sentinels)
    codex-translation-proxy.ts <-- Extends base, adds Codex-specific config

  helpers/
    anthropic-provider-registry.ts  <-- MODIFIED: Add CODEX_PROVIDER_ENTRY
    auth-manager.ts                 <-- MODIFIED: Generalize OAuth provider flow

  di/
    tokens.ts                  <-- MODIFIED: Add SDK_CODEX_AUTH, SDK_CODEX_PROXY
    register.ts                <-- MODIFIED: Register Codex services
```

### Component Specifications

#### Component 1: Shared OpenAI Translation Module

**Purpose**: Extract protocol-level Anthropic <-> OpenAI translation logic into a provider-agnostic shared module.

**Pattern**: Move + parameterize. The existing copilot-request-translator.ts, copilot-response-translator.ts, and protocol types from copilot-provider.types.ts are moved with minimal changes.

**Evidence**:

- copilot-request-translator.ts imports only from copilot-provider.types.ts (line 11-27) -- no Copilot-specific deps
- copilot-response-translator.ts imports only from copilot-provider.types.ts (line 16-20) -- no Copilot-specific deps
- The ONLY Copilot-specific code in request-translator.ts is the `capi:` model prefix (line 59-61)

**Key Changes**:

1. **request-translator.ts**: Add optional `modelPrefix` parameter to `translateAnthropicToOpenAI()`:

   ```typescript
   export function translateAnthropicToOpenAI(anthropicRequest: AnthropicMessagesRequest, options?: { modelPrefix?: string }): OpenAIChatCompletionsRequest;
   ```

   Default behavior: no prefix. Copilot passes `{ modelPrefix: 'capi:' }`.

2. **response-translator.ts**: Rename class from `CopilotResponseTranslator` to `OpenAIResponseTranslator`. Zero logic changes.

3. **openai-translation.types.ts**: Move all OpenAI + Anthropic protocol types from copilot-provider.types.ts. Keep Copilot-specific types (CopilotAuthState, sentinels) in copilot-provider.types.ts.

4. **translation-proxy-base.ts**: Extract the reusable HTTP server scaffolding from CopilotTranslationProxy into an abstract base class:

   ```typescript
   export interface TranslationProxyConfig {
     /** Display name for logging (e.g., 'Copilot', 'Codex') */
     name: string;
     /** Model prefix to add during translation (e.g., 'capi:' for Copilot, '' for Codex) */
     modelPrefix: string;
   }

   export abstract class TranslationProxyBase implements ITranslationProxy {
     // Shared: start(), stop(), isRunning(), getUrl()
     // Shared: handleRequest routing, readBody, sendJson, sendErrorResponse
     // Shared: handleStreamingResponse, handleNonStreamingResponse
     // Abstract: getApiEndpoint(), getHeaders(), onAuthFailure()
   }
   ```

**Files**:

- `openai-translation/openai-translation.types.ts` (CREATE -- moved from copilot-provider.types.ts lines 87-304)
- `openai-translation/request-translator.ts` (CREATE -- moved from copilot-request-translator.ts, parameterized)
- `openai-translation/response-translator.ts` (CREATE -- moved from copilot-response-translator.ts, renamed)
- `openai-translation/translation-proxy-base.ts` (CREATE -- extracted from copilot-translation-proxy.ts)
- `openai-translation/index.ts` (CREATE)

#### Component 2: Refactored Copilot Provider

**Purpose**: Update Copilot provider to import from shared module instead of having its own copies.

**Pattern**: Import redirection + thin subclass.

**Evidence**: copilot-translation-proxy.ts (742 lines) -- most logic is generic HTTP proxy scaffolding.

**Key Changes**:

1. **copilot-provider.types.ts**: Remove OpenAI/Anthropic protocol types (moved to shared), keep only:

   - `COPILOT_PROXY_TOKEN_PLACEHOLDER`, `COPILOT_OAUTH_SENTINEL` constants
   - `CopilotTokenResponse`, `CopilotAuthState` interfaces
   - `ICopilotAuthService` interface
   - Re-export `ITranslationProxy` (renamed from `ICopilotTranslationProxy`) from shared module

2. **copilot-translation-proxy.ts**: Becomes a thin class extending `TranslationProxyBase`:

   ```typescript
   export class CopilotTranslationProxy extends TranslationProxyBase {
     constructor(logger, copilotAuth) {
       super(logger, { name: 'Copilot', modelPrefix: 'capi:' });
     }
     protected async getApiEndpoint(): Promise<string> {
       /* from copilotAuth */
     }
     protected async getHeaders(): Promise<Record<string, string>> {
       /* from copilotAuth */
     }
     protected async onAuthFailure(): Promise<boolean> {
       /* copilotAuth.login() */
     }
     protected getStaticModels() {
       return COPILOT_PROVIDER_ENTRY.staticModels;
     }
   }
   ```

3. **index.ts**: Update re-exports to point to shared module for protocol types. Maintain backward compatibility for existing consumers.

**Files**:

- `copilot-provider/copilot-provider.types.ts` (MODIFY -- remove protocol types, add re-exports)
- `copilot-provider/copilot-translation-proxy.ts` (REWRITE -- thin subclass of TranslationProxyBase)
- `copilot-provider/copilot-request-translator.ts` (DELETE -- moved to shared)
- `copilot-provider/copilot-response-translator.ts` (DELETE -- moved to shared)
- `copilot-provider/index.ts` (MODIFY -- update exports)

#### Component 3: Codex Auth Service

**Purpose**: Read and manage Codex authentication tokens from `~/.codex/auth.json`.

**Pattern**: Follows `ICopilotAuthService` interface pattern but with file-based auth instead of VS Code OAuth.

**Evidence**:

- codex-cli.adapter.ts:164-175 defines `CodexAuthFile` interface
- codex-cli.adapter.ts:298-318 implements `resolveAccessToken()` with API key priority and OAuth refresh
- codex-cli.adapter.ts:338-407 implements `doRefreshAccessToken()` with atomic file writes
- test-codex-models.ts:44-132 shows auth file structure and token resolution

**Implementation**:

```typescript
export interface ICodexAuthService {
  isAuthenticated(): Promise<boolean>;
  getHeaders(): Promise<Record<string, string>>;
  getApiEndpoint(): string;
  ensureTokensFresh(): Promise<boolean>;
}

@injectable()
export class CodexAuthService implements ICodexAuthService {
  // Reads ~/.codex/auth.json
  // Priority: OPENAI_API_KEY > tokens.access_token
  // Proactive refresh if token > 50 min old
  // getHeaders() returns: { Authorization: 'Bearer <token>', Content-Type: 'application/json' }
  // getApiEndpoint() returns: 'https://api.chatgpt.com' (or 'https://chatgpt.com/backend-api')
}
```

**Key difference from CopilotAuthService**: No `login()` method -- Codex auth is configured externally via `codex` CLI. If no auth found, returns clear error message.

**Files**:

- `codex-provider/codex-auth.service.ts` (CREATE)
- `codex-provider/codex-provider.types.ts` (CREATE -- CodexAuthFile interface, sentinels)

#### Component 4: Codex Translation Proxy

**Purpose**: Thin proxy extending `TranslationProxyBase` with Codex-specific configuration.

**Pattern**: Same as refactored CopilotTranslationProxy -- extend base class with provider-specific auth/endpoint.

**Evidence**: The translation protocol is identical (both use OpenAI Chat Completions format).

**Implementation**:

```typescript
@injectable()
export class CodexTranslationProxy extends TranslationProxyBase {
  constructor(logger, codexAuth) {
    super(logger, { name: 'Codex', modelPrefix: '' }); // No model prefix for Codex
  }
  protected async getApiEndpoint(): Promise<string> {
    return this.codexAuth.getApiEndpoint();
  }
  protected async getHeaders(): Promise<Record<string, string>> {
    return this.codexAuth.getHeaders();
  }
  protected async onAuthFailure(): Promise<boolean> {
    return this.codexAuth.ensureTokensFresh();
  }
  protected getStaticModels() {
    return CODEX_PROVIDER_ENTRY.staticModels;
  }
}
```

**API Endpoint Investigation Note**: The exact Codex chat completions endpoint needs verification. Candidates:

- `https://api.chatgpt.com/v1/chat/completions` (most likely -- standard OpenAI format)
- `https://chatgpt.com/backend-api/v1/chat/completions`

The infra-test `test-codex-models.ts` uses `https://chatgpt.com/backend-api/codex/models` for model listing. The chat completions path likely follows the standard `/v1/chat/completions` convention. This should be verified during implementation with a quick test.

**Files**:

- `codex-provider/codex-translation-proxy.ts` (CREATE)

#### Component 5: Codex Provider Entry

**Purpose**: Provider registry entry with static Codex models.

**Pattern**: Same as `COPILOT_PROVIDER_ENTRY` (copilot-provider-entry.ts).

**Evidence**:

- codex-cli.adapter.ts:267-274 defines `SUPPORTED_MODELS` list
- copilot-provider-entry.ts shows the `AnthropicProvider` interface pattern

**Implementation**:

```typescript
const CODEX_STATIC_MODELS: ProviderStaticModel[] = [
  { id: 'gpt-5.4', name: 'GPT 5.4', contextLength: 128000, supportsToolUse: true, inputCostPerToken: 0, outputCostPerToken: 0 },
  { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex', contextLength: 128000, supportsToolUse: true, inputCostPerToken: 0, outputCostPerToken: 0 },
  { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex', contextLength: 128000, supportsToolUse: true, inputCostPerToken: 0, outputCostPerToken: 0 },
  { id: 'gpt-5.2', name: 'GPT 5.2', contextLength: 128000, supportsToolUse: true, inputCostPerToken: 0, outputCostPerToken: 0 },
  { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max', contextLength: 128000, supportsToolUse: true, inputCostPerToken: 0, outputCostPerToken: 0 },
  { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini', contextLength: 128000, supportsToolUse: true, inputCostPerToken: 0, outputCostPerToken: 0 },
];

export const CODEX_DEFAULT_TIERS = {
  sonnet: 'gpt-5.3-codex',
  opus: 'gpt-5.4',
  haiku: 'gpt-5.1-codex-mini',
} as const;

export const CODEX_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'openai-codex',
  name: 'OpenAI Codex',
  baseUrl: '',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'oauth',
  requiresProxy: true,
  keyPrefix: '',
  helpUrl: 'https://chatgpt.com/codex',
  description: 'GPT models via OpenAI Codex subscription',
  keyPlaceholder: 'Authenticated via Codex CLI',
  maskedKeyDisplay: 'Codex (connected)',
  staticModels: CODEX_STATIC_MODELS,
};
```

**Files**:

- `codex-provider/codex-provider-entry.ts` (CREATE)

#### Component 6: Provider Registry + Auth Manager Integration

**Purpose**: Wire Codex into the provider registry and generalize the auth-manager OAuth flow.

**Pattern**: Extend existing patterns.

**Key Changes**:

**anthropic-provider-registry.ts**:

- Import `CODEX_PROVIDER_ENTRY` from `../codex-provider`
- Add to `ANTHROPIC_PROVIDERS` array
- Add `'openai-codex'` to `AnthropicProviderId` union type

**auth-manager.ts**:

- Currently hardcoded to Copilot: injects `SDK_COPILOT_AUTH` and `SDK_COPILOT_PROXY` directly
- Needs generalization: inject Codex auth + proxy too
- `configureOAuthProvider()` needs to dispatch based on `provider.id`:
  ```typescript
  private async configureOAuthProvider(provider: AnthropicProvider): Promise<AuthResult> {
    if (provider.id === 'github-copilot') {
      return this.configureCopilotOAuth(provider);
    } else if (provider.id === 'openai-codex') {
      return this.configureCodexOAuth(provider);
    }
    // ...
  }
  ```

**tokens.ts**:

- Add `SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth')` and `SDK_CODEX_PROXY: Symbol.for('SdkCodexProxy')`

**register.ts**:

- Register `CodexAuthService` and `CodexTranslationProxy` as singletons

**Files**:

- `helpers/anthropic-provider-registry.ts` (MODIFY)
- `helpers/auth-manager.ts` (MODIFY)
- `di/tokens.ts` (MODIFY)
- `di/register.ts` (MODIFY)
- `src/index.ts` (MODIFY -- add Codex exports)

#### Component 7: Barrel Exports

**Purpose**: Ensure all new/moved types are properly exported.

**Files**:

- `codex-provider/index.ts` (CREATE)
- `openai-translation/index.ts` (CREATE)
- `src/index.ts` (MODIFY -- add Codex and shared translation exports)

## Batch Grouping

### Batch 1: Extract Shared OpenAI Translation Module

**Files**: 5 new files in `openai-translation/`
**Risk**: Low -- pure move + minor parameterization
**Test**: Existing Copilot tests should still pass (import paths updated)

### Batch 2: Refactor Copilot to Use Shared Module

**Files**: 2 deleted, 3 modified in `copilot-provider/`
**Risk**: Medium -- existing consumers import from `copilot-provider`
**Mitigation**: Keep re-exports in `copilot-provider/index.ts` for backward compat
**Test**: Run existing Copilot provider tests

### Batch 3: Create Codex Provider

**Files**: 5 new files in `codex-provider/`, 4 modified integration files
**Risk**: Low -- new code, no existing behavior changed
**Test**: Manual test with `~/.codex/auth.json` if available

### Batch 4: Wire Up + Test

**Files**: Modifications to registry, auth-manager, tokens, register, index
**Risk**: Low-Medium -- auth-manager generalization touches critical path
**Test**: Full typecheck, verify both Copilot and Codex providers work

## Risk Assessment

| Risk                                    | Likelihood | Impact | Mitigation                                                           |
| --------------------------------------- | ---------- | ------ | -------------------------------------------------------------------- |
| Codex API endpoint wrong                | Medium     | Low    | Test with infra-test, easy to fix endpoint URL                       |
| Model prefix assumption wrong           | Low        | Low    | Parameterized, easy to adjust                                        |
| Copilot regression from refactor        | Low        | High   | Keep re-exports, run existing tests                                  |
| Auth-manager generalization breaks flow | Low        | High   | Add Codex alongside existing Copilot code, don't remove Copilot path |
| OAuth token refresh race condition      | Low        | Medium | Reuse proven refresh logic from CodexCliAdapter                      |

## Testing Strategy

1. **Type checking**: `npm run typecheck:all` after each batch
2. **Copilot regression**: Verify existing Copilot OAuth flow still works after refactoring
3. **Codex auth**: Manual test with `~/.codex/auth.json` present/absent
4. **Codex proxy**: Test with infra-test script against chatgpt.com backend
5. **Provider registry**: Verify `getAnthropicProvider('openai-codex')` returns correct entry
6. **UI**: Verify Codex appears in provider dropdown in webview settings

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in backend libraries (agent-sdk)
- Node.js HTTP server, authentication, DI wiring
- No frontend/UI changes (provider dropdown auto-populates from registry)
- TypeScript refactoring and module extraction

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Batch 1 (Extract shared module): ~1.5 hours
- Batch 2 (Refactor Copilot): ~1 hour
- Batch 3 (Create Codex provider): ~1.5 hours
- Batch 4 (Wire up + test): ~1 hour

### Files Affected Summary

**CREATE** (10 files):

- `libs/backend/agent-sdk/src/lib/openai-translation/openai-translation.types.ts`
- `libs/backend/agent-sdk/src/lib/openai-translation/request-translator.ts`
- `libs/backend/agent-sdk/src/lib/openai-translation/response-translator.ts`
- `libs/backend/agent-sdk/src/lib/openai-translation/translation-proxy-base.ts`
- `libs/backend/agent-sdk/src/lib/openai-translation/index.ts`
- `libs/backend/agent-sdk/src/lib/codex-provider/codex-auth.service.ts`
- `libs/backend/agent-sdk/src/lib/codex-provider/codex-provider-entry.ts`
- `libs/backend/agent-sdk/src/lib/codex-provider/codex-provider.types.ts`
- `libs/backend/agent-sdk/src/lib/codex-provider/codex-translation-proxy.ts`
- `libs/backend/agent-sdk/src/lib/codex-provider/index.ts`

**MODIFY** (7 files):

- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-provider.types.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-translation-proxy.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/index.ts`
- `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts`
- `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/index.ts`

**DELETE** (2 files):

- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-request-translator.ts` (moved to shared)
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-response-translator.ts` (moved to shared)

### Critical Verification Points

**Before implementation, developer must verify**:

1. **All imports exist**:

   - `AnthropicProvider`, `ProviderStaticModel` from `helpers/anthropic-provider-registry.ts` (verified: lines 30-96)
   - `Logger`, `TOKENS` from `@ptah-extension/vscode-core` (verified: copilot-auth.service.ts:13)
   - `SDK_TOKENS` from `../di/tokens` (verified: copilot-translation-proxy.ts:31)

2. **Codex API endpoint**: Test `https://api.chatgpt.com/v1/chat/completions` with a valid Codex auth token before hardcoding

3. **No model prefix needed**: Verify Codex models work without prefix by testing with infra-test

4. **Auth file structure**: Confirm `~/.codex/auth.json` structure matches `CodexAuthFile` interface from codex-cli.adapter.ts:164-175
