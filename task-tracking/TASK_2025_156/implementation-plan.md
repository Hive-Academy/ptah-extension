# Implementation Plan - TASK_2025_156

# Replace Custom Google OAuth with CLI-Based Auth (Gemini CLI + Codex CLI)

## Codebase Investigation Summary

### Current GoogleOAuthService Dependency Chain (Verified)

| File                                                                                               | Role                                                                                   | Evidence                                     |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/google-oauth.service.ts`                            | Full PKCE OAuth with embedded CLIENT_ID/CLIENT_SECRET (lines 19-21)                    | **DELETE entirely**                          |
| `libs/backend/llm-abstraction/src/lib/di/register.ts:89`                                           | Registers `GoogleOAuthService` as singleton under `TOKENS.GOOGLE_OAUTH_SERVICE`        | **MODIFY**                                   |
| `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts:70-71`                 | Injects `GOOGLE_OAUTH_SERVICE`, calls `hasOAuthToken()` at lines 187, 228              | **MODIFY**                                   |
| `libs/backend/vscode-core/src/di/tokens.ts:121`                                                    | Defines `GOOGLE_OAUTH_SERVICE` token                                                   | **MODIFY** (replace with `CLI_AUTH_SERVICE`) |
| `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts:135-136`                                     | Injects `GOOGLE_OAUTH_SERVICE`, exposes sign-in/out/status RPC methods (lines 773-858) | **MODIFY**                                   |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/services/image-generation.service.ts:121-122` | Injects `GOOGLE_OAUTH_SERVICE`, calls `hasOAuthToken()` and `getAccessToken()`         | **MODIFY**                                   |
| `apps/ptah-extension-vscode/src/services/google-auth-provider.ts`                                  | VS Code `AuthenticationProvider` wrapper for Accounts menu                             | **DELETE entirely**                          |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/llm-rpc.handlers.ts:50-52,362-438`           | Registers `llm:googleOAuthSignIn/SignOut/Status` RPC methods                           | **MODIFY**                                   |
| `apps/ptah-extension-vscode/src/main.ts:16,382-396`                                                | Imports and registers `PtahGoogleAuthProvider`                                         | **MODIFY**                                   |
| `libs/frontend/core/src/lib/services/llm-provider-state.service.ts:79-87,412-526`                  | Google OAuth signals + `signInWithGoogle`/`signOutFromGoogle` methods                  | **MODIFY**                                   |
| `libs/frontend/chat/src/lib/settings/llm-providers-config.component.ts:347-357`                    | `onGoogleSignIn()`/`onGoogleSignOut()` methods                                         | **MODIFY**                                   |
| `libs/frontend/chat/src/lib/settings/llm-providers-config.component.html:143-196`                  | Google OAuth UI section (sign-in button, signed-in state)                              | **MODIFY**                                   |
| `libs/shared/src/lib/types/rpc.types.ts:1150-1176,1458-1469,1637-1639`                             | Google OAuth RPC type definitions                                                      | **MODIFY**                                   |
| `libs/backend/llm-abstraction/src/index.ts:69`                                                     | Exports `GoogleOAuthService`                                                           | **MODIFY**                                   |

### Existing Patterns Discovered

**ESM Dynamic Import Pattern** (verified at `google-genai-loader.ts:89-130`):

```typescript
let cachedConstructor: GoogleGenAIConstructor | null = null;

export async function loadGoogleGenAI(): Promise<GoogleGenAIConstructor> {
  if (cachedConstructor) return cachedConstructor;
  const module = await import('@google/genai');
  const Constructor = module.GoogleGenAI as GoogleGenAIConstructor;
  cachedConstructor = Constructor;
  return Constructor;
}
```

**Webpack Bundling Pattern** (verified at `webpack.config.js:50-59`):

```javascript
// Bundle @google/genai - it's ESM-only ("type": "module") and must be bundled
if (request.startsWith('@google/genai')) {
  return callback(); // Bundle it
}
```

**DI Token Pattern** (verified at `tokens.ts:121`):

```typescript
export const GOOGLE_OAUTH_SERVICE = Symbol.for('GoogleOAuthService');
```

**Provider Factory with OAuth Support** (verified at `google.ts:103-125`):

```typescript
export const createGoogleProviderWithOAuth = async (
  accessToken: string, model: string
): Promise<Result<ILlmProvider, LlmProviderError>> => { ... }
```

**Signal-Based Frontend State** (verified at `llm-provider-state.service.ts:79-87`):

```typescript
private readonly _googleOAuthSignedIn = signal(false);
private readonly _googleOAuthEmail = signal('');
private readonly _googleOAuthLoading = signal(false);
```

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Unified `CliAuthService` that wraps CLI SDK auth modules for both Gemini CLI and Codex CLI, following the same "CLI provides auth, Ptah orchestrates" pattern as Claude Agent SDK.

**Rationale**: The existing `GoogleOAuthService` maintains its own PKCE flow with embedded credentials. The new approach delegates all auth to CLI tools the user has already authenticated with. This eliminates the need for Ptah to manage Google Cloud credentials.

**Key Principle**: API key (BYOK) always takes precedence over CLI auth. CLI auth is the "subscription-based" fallback.

### Component Specifications

---

#### Component 1: Gemini CLI Auth Loader (`gemini-cli-loader.ts`)

**Purpose**: Dynamic import + caching for `@google/gemini-cli-core` (ESM-only package).

**Pattern**: Identical to `google-genai-loader.ts` (verified at `libs/backend/llm-abstraction/src/lib/providers/google-genai-loader.ts:89-130`)

**File**: `libs/backend/llm-abstraction/src/lib/services/gemini-cli-loader.ts` (CREATE)

**Implementation Pattern**:

```typescript
// Local type definitions for the auth surface we use
export interface GeminiCliAuthResult {
  accessToken: string;
  expiresAt?: number;
}

export interface GeminiCliAuthModule {
  // The exact API shape needs verification during implementation.
  // Expected: function that returns cached OAuth token with auto-refresh.
  getAccessToken(options: { authType: 'oauth-personal' }): Promise<GeminiCliAuthResult>;
  // Check if credentials file exists
  hasCredentials(): Promise<boolean>;
}

let cachedModule: GeminiCliAuthModule | null = null;

export async function loadGeminiCliAuth(): Promise<GeminiCliAuthModule> {
  if (cachedModule) return cachedModule;
  const module = await import('@google/gemini-cli-core');
  // Extract auth-related exports — exact shape TBD during implementation
  cachedModule = module as unknown as GeminiCliAuthModule;
  return cachedModule;
}

export function isGeminiCliAuthLoaded(): boolean {
  return cachedModule !== null;
}

export function clearGeminiCliAuthCache(): void {
  cachedModule = null;
}
```

**Quality Requirements**:

- Must follow exact same caching pattern as `google-genai-loader.ts`
- Must handle missing package gracefully (catch import error, return undefined)
- Must NOT modify CLI credential files (read-only access)

**ASSUMPTION**: The exact `@google/gemini-cli-core` auth API surface. The type definitions above are based on community implementations (ai-sdk-provider-gemini-cli, Roo-Code) and the task description's research findings. The developer MUST verify the actual API by reading the installed package's type declarations after `npm install`.

---

#### Component 2: Codex CLI Auth Loader (`codex-cli-loader.ts`)

**Purpose**: Dynamic import + caching for `@openai/codex-sdk` (ESM-only, TBD).

**Pattern**: Same as Component 1.

**File**: `libs/backend/llm-abstraction/src/lib/services/codex-cli-loader.ts` (CREATE)

**Implementation Pattern**:

```typescript
export interface CodexCliAuthResult {
  accessToken: string;
  expiresAt?: number;
}

export interface CodexCliAuthModule {
  // Expected: function that returns cached ChatGPT OAuth token
  getAccessToken(): Promise<CodexCliAuthResult>;
  hasCredentials(): Promise<boolean>;
}

let cachedModule: CodexCliAuthModule | null = null;

export async function loadCodexCliAuth(): Promise<CodexCliAuthModule> {
  if (cachedModule) return cachedModule;
  const module = await import('@openai/codex-sdk');
  cachedModule = module as unknown as CodexCliAuthModule;
  return cachedModule;
}
```

**ASSUMPTION**: The `@openai/codex-sdk` auth API. If the SDK does not support external auth mode, Phase 2 should be deferred (requirement from task description).

---

#### Component 3: CliAuthService (`cli-auth.service.ts`)

**Purpose**: Unified injectable service that abstracts CLI auth for all providers. Replaces `GoogleOAuthService`.

**Pattern**: tsyringe `@injectable()` singleton, same pattern as `GoogleOAuthService` (verified at `google-oauth.service.ts:49-61`)

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-auth.service.ts` (CREATE)

**Responsibilities**:

- Check if CLI credentials exist for a given provider
- Obtain valid access tokens (with SDK-managed auto-refresh)
- Retrieve account info (email) for UI display
- Cache access tokens in-memory with staleness detection

**DI Dependencies** (all verified):

- `TOKENS.LOGGER` (verified at `tokens.ts:58`)

**Implementation Pattern**:

```typescript
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { LlmProviderName } from '../types/provider-types';

@injectable()
export class CliAuthService {
  /** In-memory token cache per provider */
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.info('[CliAuthService.constructor] Service initialized');
  }

  /**
   * Check if CLI auth credentials exist for a provider.
   * @returns true if CLI credentials are detected
   */
  async hasCliAuth(provider: LlmProviderName): Promise<boolean> {
    if (provider === 'google-genai') {
      return this.hasGeminiCliAuth();
    }
    if (provider === 'openai') {
      return this.hasCodexCliAuth();
    }
    return false;
  }

  /**
   * Get a valid CLI access token for a provider.
   * Uses SDK auto-refresh — Ptah does NOT implement refresh logic.
   * @returns Access token string, or undefined if unavailable
   */
  async getCliAccessToken(provider: LlmProviderName): Promise<string | undefined> {
    if (provider === 'google-genai') {
      return this.getGeminiCliToken();
    }
    if (provider === 'openai') {
      return this.getCodexCliToken();
    }
    return undefined;
  }

  /**
   * Get account info for UI display.
   * @returns Object with email if available, or undefined
   */
  async getCliAccountInfo(provider: LlmProviderName): Promise<{ email?: string } | undefined> {
    // Implementation delegates to each CLI SDK's user info
    // For Gemini CLI: parse the cached creds file for email
    // For Codex CLI: parse the auth.json for account info
    // Exact implementation depends on SDK API surface
  }

  // --- Private: Gemini CLI ---

  private async hasGeminiCliAuth(): Promise<boolean> {
    try {
      const auth = await import(/* dynamic */ '@google/gemini-cli-core' as string);
      // Use SDK to check for cached credentials
      // Fallback: check file existence at platform-appropriate path
      return true; // if credentials found
    } catch {
      return false;
    }
  }

  private async getGeminiCliToken(): Promise<string | undefined> {
    // Check in-memory cache first
    const cached = this.tokenCache.get('google-genai');
    if (cached && Date.now() < cached.expiresAt - 300_000) {
      return cached.token;
    }

    try {
      // Use @google/gemini-cli-core auth module
      // authType: 'oauth-personal' for cached credential reuse
      const token = '...'; // from SDK
      this.tokenCache.set('google-genai', { token, expiresAt: Date.now() + 3300_000 });
      return token;
    } catch (error) {
      this.logger.warn('[CliAuthService] Gemini CLI token retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  // --- Private: Codex CLI ---

  private async hasCodexCliAuth(): Promise<boolean> {
    // Similar pattern — use @openai/codex-sdk
  }

  private async getCodexCliToken(): Promise<string | undefined> {
    // Similar pattern — use @openai/codex-sdk
  }
}
```

**Quality Requirements**:

- Must never throw — always return undefined on failure (graceful degradation)
- Must never write to CLI credential files (read-only)
- Must handle missing CLI packages gracefully (user hasn't installed Gemini CLI / Codex CLI)
- Token cache TTL: 55 minutes (matching current `TOKEN_CACHE_DURATION_SECONDS = 3300`)

---

#### Component 4: DI Token Update

**Purpose**: Replace `GOOGLE_OAUTH_SERVICE` token with `CLI_AUTH_SERVICE`.

**File**: `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY)

**Changes**:

```typescript
// REMOVE:
export const GOOGLE_OAUTH_SERVICE = Symbol.for('GoogleOAuthService');

// ADD:
export const CLI_AUTH_SERVICE = Symbol.for('CliAuthService');
```

And update the `TOKENS` object:

```typescript
// REMOVE from TOKENS:
GOOGLE_OAUTH_SERVICE,

// ADD to TOKENS:
CLI_AUTH_SERVICE,
```

**Evidence**: Token pattern at `tokens.ts:121`, TOKENS object at `tokens.ts:363`

---

#### Component 5: DI Registration Update

**Purpose**: Register `CliAuthService` instead of `GoogleOAuthService`.

**File**: `libs/backend/llm-abstraction/src/lib/di/register.ts` (MODIFY)

**Changes**:

```typescript
// REMOVE:
import { GoogleOAuthService } from '../services/google-oauth.service';
// ...
container.registerSingleton(TOKENS.GOOGLE_OAUTH_SERVICE, GoogleOAuthService);

// ADD:
import { CliAuthService } from '../services/cli-auth.service';
// ...
container.registerSingleton(TOKENS.CLI_AUTH_SERVICE, CliAuthService);
```

**Evidence**: Current registration at `register.ts:31,89`

---

#### Component 6: LlmConfigurationService Update

**Purpose**: Replace `GoogleOAuthService` injection with `CliAuthService`. Update `isConfigured` checks for both `google-genai` and `openai`.

**File**: `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts` (MODIFY)

**Changes to constructor** (line 70-71):

```typescript
// REMOVE:
@inject(TOKENS.GOOGLE_OAUTH_SERVICE)
private readonly googleOAuth: IGoogleOAuthService,

// ADD:
@inject(TOKENS.CLI_AUTH_SERVICE)
private readonly cliAuth: ICliAuthService,
```

**Changes to `getAvailableProviders()`** (lines 187-199):

```typescript
// REMOVE Google OAuth-specific block
// ADD generic CLI auth check for both google-genai and openai:
for (const provider of ['google-genai', 'openai'] as const) {
  const hasCliAuth = await this.cliAuth.hasCliAuth(provider);
  if (hasCliAuth && !configuredProviders.includes(provider)) {
    configs.push({
      provider,
      model: this.getDefaultModel(provider),
      isConfigured: true,
      displayName: this.getProviderDisplayName(provider),
    });
  }
}
```

**Changes to `getAllProviders()`** (lines 222-241):

```typescript
// REPLACE the google-genai special case with generic CLI auth check:
} else if (provider === 'google-genai' || provider === 'openai') {
  const hasCliAuth = await this.cliAuth.hasCliAuth(provider);
  const hasApiKey = await this.secrets.hasApiKey(provider);
  isConfigured = hasCliAuth || hasApiKey;
} else {
```

**Evidence**: Current implementation at `llm-configuration.service.ts:25-27,70-71,187-199,222-241`

---

#### Component 7: ProviderRegistry Update

**Purpose**: When creating a provider that has CLI auth but no API key, obtain token from `CliAuthService` and use the OAuth factory path.

**File**: `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts` (MODIFY)

**Changes to constructor**: Add `CliAuthService` injection:

```typescript
@inject(TOKENS.CLI_AUTH_SERVICE)
private readonly cliAuth: ICliAuthService,
```

**Changes to `createProviderInternal()`** (lines 129-205):
The current code at line 153 rejects providers without API keys. Modify to also check CLI auth:

```typescript
// REPLACE lines 152-167:
if (providerName !== 'vscode-lm') {
  const hasKey = await this.secrets.hasApiKey(providerName);
  const hasCliAuth = await this.cliAuth.hasCliAuth(providerName);
  if (!hasKey && !hasCliAuth) {
    const msg = `No API key or CLI auth configured for ${providerName}.`;
    return Result.err(new LlmProviderError(msg, 'API_KEY_MISSING', providerName));
  }
}
```

**Changes to `getApiKeyForProvider()`** (lines 352-378):
When no API key exists but CLI auth does, return a special sentinel or use a different factory path. The cleanest approach is to detect CLI auth in `createProviderInternal` and use the OAuth factory directly:

```typescript
// In createProviderInternal, after getOrLoadFactory:
const apiKey = await this.getApiKeyForProvider(providerName);

if (!apiKey && providerName !== 'vscode-lm') {
  // No API key — try CLI auth token
  const cliToken = await this.cliAuth.getCliAccessToken(providerName);
  if (cliToken) {
    // Use OAuth factory path for google-genai
    if (providerName === 'google-genai') {
      const { createGoogleProviderWithOAuth } = await import('@ptah-extension/llm-abstraction/google');
      return createGoogleProviderWithOAuth(cliToken, model);
    }
    // For openai, the token is passed as the API key (Bearer token)
    if (providerName === 'openai') {
      const factory = factoryResult.value!;
      return factory instanceof Promise ? await factory(cliToken, model) : factory(cliToken, model);
    }
  }
}
```

**Evidence**: Current API key check at `provider-registry.ts:152-167`, factory invocation at `provider-registry.ts:176-204`

---

#### Component 8: LlmRpcHandlers Update (vscode-core)

**Purpose**: Replace Google OAuth-specific methods with unified CLI auth status method.

**File**: `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` (MODIFY)

**Changes to constructor** (line 135-136):

```typescript
// REMOVE:
@inject(TOKENS.GOOGLE_OAUTH_SERVICE)
private readonly googleOAuth: IGoogleOAuthService,

// ADD:
@inject(TOKENS.CLI_AUTH_SERVICE)
private readonly cliAuth: ICliAuthService,
```

**Changes to `getProviderStatus()`** (lines 163-216):
Replace Google OAuth enrichment with generic CLI auth enrichment:

```typescript
// REMOVE lines 176-179 (Google OAuth status)
// ADD: CLI auth status for all providers
const cliAuthStatuses = new Map<string, { hasCliAuth: boolean; cliAuthEmail?: string }>();
for (const p of providers) {
  if (p.provider !== 'vscode-lm') {
    const hasCliAuth = await this.cliAuth.hasCliAuth(p.provider);
    const info = hasCliAuth ? await this.cliAuth.getCliAccountInfo(p.provider) : undefined;
    cliAuthStatuses.set(p.provider, {
      hasCliAuth,
      cliAuthEmail: info?.email,
    });
  }
}

// In statuses map, replace hasOAuthToken/oauthAccountEmail with:
const cliStatus = cliAuthStatuses.get(p.provider);
...(cliStatus ? {
  hasCliAuth: cliStatus.hasCliAuth,
  cliAuthEmail: cliStatus.cliAuthEmail,
} : {}),
```

**REMOVE these methods entirely** (lines 773-858):

- `googleOAuthSignIn()`
- `googleOAuthSignOut()`
- `getGoogleOAuthStatus()`

**ADD new method**:

```typescript
async getCliAuthStatus(): Promise<{
  providers: Array<{
    provider: LlmProviderName;
    isAuthenticated: boolean;
    email?: string;
    cliName: string;
  }>;
}> {
  const results = [];

  const geminiAuth = await this.cliAuth.hasCliAuth('google-genai');
  const geminiInfo = geminiAuth ? await this.cliAuth.getCliAccountInfo('google-genai') : undefined;
  results.push({
    provider: 'google-genai' as LlmProviderName,
    isAuthenticated: geminiAuth,
    email: geminiInfo?.email,
    cliName: 'Gemini CLI',
  });

  const codexAuth = await this.cliAuth.hasCliAuth('openai');
  const codexInfo = codexAuth ? await this.cliAuth.getCliAccountInfo('openai') : undefined;
  results.push({
    provider: 'openai' as LlmProviderName,
    isAuthenticated: codexAuth,
    email: codexInfo?.email,
    cliName: 'Codex CLI',
  });

  return { providers: results };
}
```

**Changes to `listProviderModels()`** (lines 510-573):
Replace OAuth token path with CLI auth token path:

```typescript
// REMOVE lines 545-556 (OAuth token model listing)
// ADD:
const cliToken = await this.cliAuth.getCliAccessToken(provider);
if (cliToken) {
  try {
    return await this.listGoogleModels(undefined, cliToken);
  } catch {
    return { models: [] };
  }
}
```

Also for openai provider, add CLI auth fallback when no API key:

```typescript
if (provider === 'openai') {
  const apiKey = await this.secretsService.getApiKey(provider);
  if (apiKey) {
    return await this.listOpenAIModels(apiKey);
  }
  const cliToken = await this.cliAuth.getCliAccessToken(provider);
  if (cliToken) {
    return await this.listOpenAIModels(cliToken);
  }
  return { models: [], error: `No API key or CLI auth configured for ${provider}` };
}
```

**Evidence**: Current OAuth usage at `llm-rpc-handlers.ts:135-136,176-179,545-556,773-858`

---

#### Component 9: App-Layer RPC Handler Update

**Purpose**: Replace Google OAuth RPC method registrations with `llm:getCliAuthStatus`.

**File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/llm-rpc.handlers.ts` (MODIFY)

**Changes to `register()` method** (lines 40-69):

```typescript
// REMOVE these calls:
this.registerGoogleOAuthSignIn();
this.registerGoogleOAuthSignOut();
this.registerGetGoogleOAuthStatus();

// ADD:
this.registerGetCliAuthStatus();
```

**REMOVE these methods** (lines 362-438):

- `registerGoogleOAuthSignIn()`
- `registerGoogleOAuthSignOut()`
- `registerGetGoogleOAuthStatus()`

**ADD new method**:

```typescript
private registerGetCliAuthStatus(): void {
  this.rpcHandler.registerMethod<
    Record<string, never>,
    { providers: Array<{ provider: LlmProviderName; isAuthenticated: boolean; email?: string; cliName: string }> }
  >('llm:getCliAuthStatus', async () => {
    const handlers = this.container.resolve<LlmRpcHandlersInterface>(TOKENS.LLM_RPC_HANDLERS);
    return await handlers.getCliAuthStatus();
  });
}
```

**Evidence**: Current registrations at `llm-rpc.handlers.ts:50-52,362-438`

---

#### Component 10: ImageGenerationService Update

**Purpose**: Replace `GoogleOAuthService` injection with `CliAuthService`.

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/services/image-generation.service.ts` (MODIFY)

**Changes to constructor** (lines 118-125):

```typescript
// REMOVE:
@inject(TOKENS.GOOGLE_OAUTH_SERVICE)
private readonly googleOAuth: IGoogleOAuthService,

// ADD:
@inject(TOKENS.CLI_AUTH_SERVICE)
private readonly cliAuth: ICliAuthService,
```

**Changes to `isAvailable()`** (lines 135-139):

```typescript
// REPLACE:
const hasOAuth = await this.googleOAuth.hasOAuthToken();
// WITH:
const hasCliAuth = await this.cliAuth.hasCliAuth('google-genai');
```

**Changes to `generateImage()`** (lines 180-183):

```typescript
// REPLACE:
const oauthToken = await this.googleOAuth.getAccessToken();
// WITH:
const cliToken = await this.cliAuth.getCliAccessToken('google-genai');
```

And update all subsequent references from `oauthToken` to `cliToken`.

**Evidence**: Current injection at `image-generation.service.ts:121-122`, usage at lines 136, 180

---

#### Component 11: PtahGoogleAuthProvider Removal

**Purpose**: Delete the VS Code Accounts menu integration. CLI auth doesn't need a VS Code AuthenticationProvider — credentials are managed externally by the CLI tools.

**File**: `apps/ptah-extension-vscode/src/services/google-auth-provider.ts` (DELETE)

**File**: `apps/ptah-extension-vscode/src/main.ts` (MODIFY)

**Changes to main.ts**:

```typescript
// REMOVE import:
import { PtahGoogleAuthProvider } from './services/google-auth-provider';

// REMOVE registration block (lines ~382-396):
// context.subscriptions.push(
//   vscode.authentication.registerAuthenticationProvider(
//     PtahGoogleAuthProvider.ID, ...
//   )
// );
```

**Evidence**: Import at `main.ts:16`, registration at `main.ts:382-396`

---

#### Component 12: Shared RPC Type Updates

**Purpose**: Remove Google OAuth RPC types, add CLI auth types.

**File**: `libs/shared/src/lib/types/rpc.types.ts` (MODIFY)

**REMOVE** (lines 1150-1176):

- `LlmGoogleOAuthSignInParams`
- `LlmGoogleOAuthSignInResponse`
- `LlmGoogleOAuthSignOutParams`
- `LlmGoogleOAuthSignOutResponse`
- `LlmGetGoogleOAuthStatusParams`
- `LlmGetGoogleOAuthStatusResponse`

**REMOVE from RPC method map** (lines 1458-1469):

- `'llm:googleOAuthSignIn'`
- `'llm:googleOAuthSignOut'`
- `'llm:getGoogleOAuthStatus'`

**REMOVE from RPC method name union** (lines 1637-1639):

- `'llm:googleOAuthSignIn'`
- `'llm:googleOAuthSignOut'`
- `'llm:getGoogleOAuthStatus'`

**ADD**:

```typescript
/** Parameters for llm:getCliAuthStatus RPC method */
export type LlmGetCliAuthStatusParams = Record<string, never>;

/** Response from llm:getCliAuthStatus RPC method */
export interface LlmGetCliAuthStatusResponse {
  providers: Array<{
    provider: LlmProviderName;
    isAuthenticated: boolean;
    email?: string;
    cliName: string;
  }>;
}
```

And add to the RPC method map:

```typescript
'llm:getCliAuthStatus': {
  params: LlmGetCliAuthStatusParams;
  result: LlmGetCliAuthStatusResponse;
};
```

---

#### Component 13: llm-abstraction Index Update

**Purpose**: Remove `GoogleOAuthService` export, add `CliAuthService` export.

**File**: `libs/backend/llm-abstraction/src/index.ts` (MODIFY)

**Changes**:

```typescript
// REMOVE:
export { GoogleOAuthService } from './lib/services/google-oauth.service';

// ADD:
export { CliAuthService } from './lib/services/cli-auth.service';
```

---

#### Component 14: Webpack Configuration Update

**Purpose**: Bundle new ESM-only CLI packages.

**File**: `apps/ptah-extension-vscode/webpack.config.js` (MODIFY)

**Add after the `@google/genai` block** (after line 59):

```javascript
// Bundle @google/gemini-cli-core - ESM-only, used for Gemini CLI auth reuse
if (request.startsWith('@google/gemini-cli-core')) {
  return callback(); // Bundle it
}

// Bundle @openai/codex-sdk - ESM-only, used for Codex CLI auth reuse
if (request.startsWith('@openai/codex-sdk')) {
  return callback(); // Bundle it
}
```

**Evidence**: Current ESM bundling pattern at `webpack.config.js:50-59`

---

#### Component 15: Frontend State Service Update

**Purpose**: Replace Google OAuth-specific signals with generic CLI auth signals per provider.

**File**: `libs/frontend/core/src/lib/services/llm-provider-state.service.ts` (MODIFY)

**REMOVE** (lines 79-87):

```typescript
private readonly _googleOAuthSignedIn = signal(false);
private readonly _googleOAuthEmail = signal('');
private readonly _googleOAuthLoading = signal(false);
```

**REMOVE public readonly signals** (lines 115-121):

```typescript
readonly googleOAuthSignedIn = ...;
readonly googleOAuthEmail = ...;
readonly googleOAuthLoading = ...;
```

**ADD**:

```typescript
/** CLI auth status per provider */
private readonly _cliAuthStatus = signal<
  Array<{
    provider: LlmProviderName;
    isAuthenticated: boolean;
    email?: string;
    cliName: string;
  }>
>([]);

readonly cliAuthStatus = this._cliAuthStatus.asReadonly();
```

**ADD computed helpers**:

```typescript
/** Check if a specific provider has CLI auth */
readonly hasCliAuth = (provider: LlmProviderName) =>
  this._cliAuthStatus().find(s => s.provider === provider)?.isAuthenticated ?? false;

/** Get CLI auth email for a provider */
readonly cliAuthEmail = (provider: LlmProviderName) =>
  this._cliAuthStatus().find(s => s.provider === provider)?.email ?? '';
```

**REPLACE `loadGoogleOAuthStatus()` method** (lines 416-433) with:

```typescript
private async loadCliAuthStatus(): Promise<void> {
  try {
    const result = await this.rpc.call(
      'llm:getCliAuthStatus',
      {} as Record<string, never>
    );
    if (result.isSuccess() && result.data) {
      this._cliAuthStatus.set(result.data.providers);
    }
  } catch (error) {
    console.error('[LlmProviderStateService] loadCliAuthStatus error:', error);
  }
}
```

**UPDATE `fetchProviderStatus()`** (line 223): Change `this.loadGoogleOAuthStatus()` to `this.loadCliAuthStatus()`.

**REMOVE methods** (lines 441-526):

- `signInWithGoogle()`
- `signOutFromGoogle()`

**Evidence**: Current signals at `llm-provider-state.service.ts:79-87,115-121`, methods at `441-526`

---

#### Component 16: Frontend Settings UI Update

**Purpose**: Replace Google OAuth sign-in/out UI with CLI auth status display and instructions.

**File**: `libs/frontend/chat/src/lib/settings/llm-providers-config.component.ts` (MODIFY)

**REMOVE methods** (lines 347-357):

- `onGoogleSignIn()`
- `onGoogleSignOut()`

**REMOVE icon imports** (lines 44-45):

- `LogIn`
- `LogOut`

**File**: `libs/frontend/chat/src/lib/settings/llm-providers-config.component.html` (MODIFY)

**REPLACE the Google OAuth section** (lines 143-196) with a generic CLI auth status section that works for both google-genai and openai:

```html
<!-- CLI Auth section (for providers that support CLI auth) -->
@if (provider.provider === 'google-genai' || provider.provider === 'openai') {
<div class="divider my-2"></div>

@if (llmState.hasCliAuth(provider.provider)) {
<!-- CLI auth detected -->
<div class="flex items-center gap-2">
  <lucide-angular [img]="CheckIcon" class="w-4 h-4 text-success" />
  <span class="text-sm font-medium text-success"> Authenticated via {{ provider.provider === 'google-genai' ? 'Gemini CLI' : 'Codex CLI' }} </span>
  @if (llmState.cliAuthEmail(provider.provider)) {
  <span class="text-xs text-base-content/60"> ({{ llmState.cliAuthEmail(provider.provider) }}) </span>
  }
</div>
} @else {
<!-- CLI auth not detected - show instructions -->
<div class="flex flex-col gap-1">
  <span class="text-xs text-base-content/50">
    @if (provider.provider === 'google-genai') { Authenticate via Gemini CLI: <code class="text-xs bg-base-300 px-1 rounded">npx @google/gemini-cli</code> } @else { Authenticate via Codex CLI: <code class="text-xs bg-base-300 px-1 rounded">npx @openai/codex</code>
    }
  </span>
</div>
<!-- "or" divider before API key section -->
<div class="divider my-1 text-xs text-base-content/40">or use an API key</div>
} }
```

**UPDATE the API key section condition** (line 199):

```html
<!-- REPLACE: -->
@if (provider.provider !== 'vscode-lm' && !(provider.provider === 'google-genai' && llmState.googleOAuthSignedIn()))

<!-- WITH: -->
@if (provider.provider !== 'vscode-lm' && !llmState.hasCliAuth(provider.provider))
```

This ensures the API key input is hidden when CLI auth is active for any provider (not just google-genai).

**Evidence**: Current UI at `llm-providers-config.component.html:143-199`

---

#### Component 17: GoogleOAuthService Deletion

**Purpose**: Remove the custom OAuth service entirely.

**File**: `libs/backend/llm-abstraction/src/lib/services/google-oauth.service.ts` (DELETE)

This file contains the embedded `CLIENT_ID` (line 19) and `CLIENT_SECRET` (line 21) that must be eliminated.

---

#### Component 18: NPM Dependencies

**Purpose**: Install new CLI auth packages.

**Changes to root `package.json`**:

```json
{
  "dependencies": {
    "@google/gemini-cli-core": "^0.1.0",
    "@openai/codex-sdk": "^0.1.0"
  }
}
```

**IMPORTANT**: The exact version numbers must be checked at install time. Pin to specific versions to mitigate API instability risk (per task risk assessment).

---

## Integration Architecture

### Data Flow: CLI Auth Token Path

```
User authenticates CLI externally (npx @google/gemini-cli)
  → CLI stores credentials at ~/.gemini/oauth_creds.json
  → Ptah activates, CliAuthService.hasCliAuth('google-genai') returns true
  → LlmConfigurationService marks google-genai as configured
  → Frontend shows "Authenticated via Gemini CLI"
  → When user sends a message:
    → ProviderRegistry.createProvider('google-genai', model)
    → No API key found → checks CliAuthService.getCliAccessToken('google-genai')
    → Gets access token from @google/gemini-cli-core (with auto-refresh)
    → Uses createGoogleProviderWithOAuth(token, model) to create provider
    → Provider makes API calls with Bearer token header
```

### Data Flow: BYOK API Key Path (Unchanged)

```
User enters API key in settings UI
  → LlmSecretsService stores in VS Code SecretStorage (encrypted)
  → ProviderRegistry.createProvider('google-genai', model)
  → API key found → uses createGoogleProvider(apiKey, model)
  → Provider makes API calls with API key parameter
```

### Precedence Rule

**API key ALWAYS takes precedence over CLI auth.** This is enforced at two levels:

1. `ProviderRegistry.createProviderInternal()`: checks API key first, only falls back to CLI auth
2. `ImageGenerationService.generateImage()`: checks API key first, only falls back to CLI token

---

## Webpack Configuration Summary

**New bundle rules** (add to `webpack.config.js`):

```javascript
// After line 59 (@google/genai block):
if (request.startsWith('@google/gemini-cli-core')) {
  return callback(); // Bundle it (ESM-only)
}
if (request.startsWith('@openai/codex-sdk')) {
  return callback(); // Bundle it (ESM-only)
}
```

---

## RPC Contract Changes

### Methods Removed

| Method                     | Payload                                                 | Replacement                                    |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `llm:googleOAuthSignIn`    | `Record<string, never>` → `{ success, email?, error? }` | **None** (no sign-in needed, CLI manages auth) |
| `llm:googleOAuthSignOut`   | `Record<string, never>` → `{ success, error? }`         | **None** (no sign-out needed)                  |
| `llm:getGoogleOAuthStatus` | `Record<string, never>` → `{ isSignedIn, email? }`      | `llm:getCliAuthStatus`                         |

### Methods Added

| Method                 | Params                  | Response                                                               |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `llm:getCliAuthStatus` | `Record<string, never>` | `{ providers: Array<{ provider, isAuthenticated, email?, cliName }> }` |

### Methods Modified

| Method                   | Change                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `llm:getProviderStatus`  | Response now includes `hasCliAuth: boolean` and `cliAuthEmail?: string` per provider (replacing `hasOAuthToken` and `oauthAccountEmail`) |
| `llm:listProviderModels` | For google-genai and openai: uses CLI auth token when no API key is configured                                                           |

---

## Frontend Signal Changes

### Signals Removed (LlmProviderStateService)

- `_googleOAuthSignedIn` / `googleOAuthSignedIn`
- `_googleOAuthEmail` / `googleOAuthEmail`
- `_googleOAuthLoading` / `googleOAuthLoading`

### Signals Added

- `_cliAuthStatus` / `cliAuthStatus`: `Array<{ provider, isAuthenticated, email?, cliName }>`

### Computed Helpers Added

- `hasCliAuth(provider)`: boolean
- `cliAuthEmail(provider)`: string

### Methods Removed

- `signInWithGoogle()`
- `signOutFromGoogle()`
- `loadGoogleOAuthStatus()`

### Methods Added

- `loadCliAuthStatus()`

---

## Phased Delivery & Batching

### Phase 1: Gemini CLI Auth (Replaces Google OAuth) - HIGH PRIORITY

**Batch 1.1: Foundation** (backend infrastructure)

1. Install `@google/gemini-cli-core` npm package
2. CREATE `libs/backend/llm-abstraction/src/lib/services/gemini-cli-loader.ts`
3. CREATE `libs/backend/llm-abstraction/src/lib/services/cli-auth.service.ts` (Gemini CLI only initially)
4. MODIFY `libs/backend/vscode-core/src/di/tokens.ts` — replace `GOOGLE_OAUTH_SERVICE` with `CLI_AUTH_SERVICE`
5. MODIFY `libs/backend/llm-abstraction/src/lib/di/register.ts` — register `CliAuthService`

**Batch 1.2: Backend service migration** (swap all consumers) 6. MODIFY `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts` — inject `CLI_AUTH_SERVICE` 7. MODIFY `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts` — inject `CLI_AUTH_SERVICE`, add CLI token path 8. MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/services/image-generation.service.ts` — inject `CLI_AUTH_SERVICE`

**Batch 1.3: RPC layer migration** 9. MODIFY `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` — replace OAuth methods with `getCliAuthStatus` 10. MODIFY `apps/ptah-extension-vscode/src/services/rpc/handlers/llm-rpc.handlers.ts` — register `llm:getCliAuthStatus` 11. MODIFY `libs/shared/src/lib/types/rpc.types.ts` — update RPC type definitions

**Batch 1.4: Cleanup** 12. DELETE `libs/backend/llm-abstraction/src/lib/services/google-oauth.service.ts` 13. DELETE `apps/ptah-extension-vscode/src/services/google-auth-provider.ts` 14. MODIFY `apps/ptah-extension-vscode/src/main.ts` — remove `PtahGoogleAuthProvider` registration 15. MODIFY `libs/backend/llm-abstraction/src/index.ts` — remove `GoogleOAuthService` export, add `CliAuthService` 16. MODIFY `apps/ptah-extension-vscode/webpack.config.js` — add `@google/gemini-cli-core` bundle rule

### Phase 2: OpenAI Codex CLI Auth - MEDIUM PRIORITY

**Batch 2.1: Codex CLI integration** 17. Install `@openai/codex-sdk` npm package 18. CREATE `libs/backend/llm-abstraction/src/lib/services/codex-cli-loader.ts` 19. MODIFY `libs/backend/llm-abstraction/src/lib/services/cli-auth.service.ts` — add Codex CLI methods 20. MODIFY `apps/ptah-extension-vscode/webpack.config.js` — add `@openai/codex-sdk` bundle rule

**Note**: If `@openai/codex-sdk` does not support the expected external auth pattern, defer this phase entirely. The `CliAuthService` is already designed with `hasCodexCliAuth`/`getCodexCliToken` returning `false`/`undefined` as graceful fallback.

### Phase 3: Frontend UI Update - DEPENDS ON Phase 1

**Batch 3.1: Frontend state + UI** 21. MODIFY `libs/frontend/core/src/lib/services/llm-provider-state.service.ts` — replace OAuth signals with CLI auth signals 22. MODIFY `libs/frontend/chat/src/lib/settings/llm-providers-config.component.ts` — remove OAuth methods 23. MODIFY `libs/frontend/chat/src/lib/settings/llm-providers-config.component.html` — replace OAuth UI with CLI auth status

---

## Files Affected Summary

### CREATE (4 files)

- `libs/backend/llm-abstraction/src/lib/services/gemini-cli-loader.ts`
- `libs/backend/llm-abstraction/src/lib/services/codex-cli-loader.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-auth.service.ts`

### DELETE (2 files)

- `libs/backend/llm-abstraction/src/lib/services/google-oauth.service.ts`
- `apps/ptah-extension-vscode/src/services/google-auth-provider.ts`

### MODIFY (13 files)

- `libs/backend/vscode-core/src/di/tokens.ts`
- `libs/backend/llm-abstraction/src/lib/di/register.ts`
- `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts`
- `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts`
- `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/image-generation.service.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/llm-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/main.ts`
- `apps/ptah-extension-vscode/webpack.config.js`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/backend/llm-abstraction/src/index.ts`
- `libs/frontend/core/src/lib/services/llm-provider-state.service.ts`
- `libs/frontend/chat/src/lib/settings/llm-providers-config.component.ts`
- `libs/frontend/chat/src/lib/settings/llm-providers-config.component.html`

### NPM INSTALL (2 packages)

- `@google/gemini-cli-core`
- `@openai/codex-sdk`

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (Phase 1+2), frontend-developer (Phase 3)

**Rationale**:

- Phase 1+2 are entirely backend: DI tokens, service creation, provider registry, RPC handlers, webpack config
- Phase 3 is entirely frontend: Angular signals, component template, service methods
- Backend work must complete before frontend (dependency)

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 8-12 hours

**Breakdown**:

- Phase 1 (Gemini CLI): 4-6 hours (includes SDK API discovery)
- Phase 2 (Codex CLI): 2-3 hours (pattern is established by Phase 1)
- Phase 3 (Frontend): 2-3 hours (straightforward signal/template changes)

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **`@google/gemini-cli-core` auth API surface**:

   - Install the package: `npm install @google/gemini-cli-core`
   - Read its TypeScript declarations to find the actual auth functions
   - The loader types in Component 1 are ASSUMPTIONS based on community usage
   - Verify: Does it export an `authenticate()` or `getAccessToken()` function?
   - Verify: Does it support `authType: 'oauth-personal'` for cached creds?

2. **`@openai/codex-sdk` auth API surface**:

   - Install the package: `npm install @openai/codex-sdk`
   - Read its TypeScript declarations for auth module
   - If no external auth mode exists, defer Phase 2

3. **All imports verified**:

   - `TOKENS.CLI_AUTH_SERVICE` — will be created in `tokens.ts`
   - `CliAuthService` — will be created in `cli-auth.service.ts`
   - `createGoogleProviderWithOAuth` — verified exists at `google.ts:103`
   - `loadGoogleGenAI` — verified exists at `google-genai-loader.ts:100`

4. **No hallucinated APIs**:

   - All decorators: `@injectable()`, `@inject()` — verified from tsyringe
   - All base patterns: ESM loader, DI registration, RPC handlers — verified from codebase
   - All token patterns: `Symbol.for()` — verified from `tokens.ts`

5. **Build verification**:
   - After Phase 1 Batch 1.4: run `npm run build:all` to verify no bundle errors
   - After Phase 2: run `npm run build:all` again
   - After Phase 3: run `npm run build:all` for final verification

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (ESM loader, DI tokens, RPC handlers, signals)
- [x] All existing imports/decorators verified as existing
- [x] Quality requirements defined per component
- [x] Integration points documented (data flow diagrams)
- [x] Files affected list complete (4 CREATE, 2 DELETE, 13 MODIFY)
- [x] Developer type recommended (backend + frontend)
- [x] Complexity assessed (HIGH, 8-12 hours)
- [x] Phased delivery with batching (3 phases, 7 batches)
- [x] SDK API assumptions clearly marked
- [x] No backward compatibility layers (direct replacement)
- [x] Webpack bundling rules specified
- [x] RPC contract changes documented
- [x] Frontend signal changes documented
