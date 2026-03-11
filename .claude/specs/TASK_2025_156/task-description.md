# Requirements Document - TASK_2025_156

## Introduction

Ptah Extension currently implements Google Gemini access via a custom `GoogleOAuthService` that embeds Ptah's own Google Cloud OAuth client ID and secret. This approach requires publishing and verifying a Google Cloud application -- an unnecessary burden that the user wants to eliminate entirely.

The strategic goal is to adopt the same pattern already proven with Claude Agent SDK: **reuse credentials from subscription-based CLI tools** that the user has already authenticated. Gemini CLI (`@google/gemini-cli-core`) uses Google's own public OAuth client ID with PKCE (no client secret needed), and OpenAI Codex CLI (`@openai/codex-sdk`) uses ChatGPT OAuth. Both cache tokens locally, and both provide SDK packages that allow host applications to reuse those cached credentials.

This task replaces the custom Google OAuth flow with Gemini CLI credential reuse, adds a new OpenAI Codex CLI auth integration, and updates all dependent services and UI accordingly.

### Architecture Target

```
Claude Agent SDK    <- Claude Pro/Max subscription   (EXISTING, working)
@google/gemini-cli-core <- Google AI Pro Plan (Gemini CLI auth) (NEW - replaces custom OAuth)
@openai/codex-sdk   <- ChatGPT Plus/Pro (Codex CLI auth)      (NEW)
VS Code LM API      <- Copilot subscription                   (EXISTING, working)
    |
Ptah Provider Abstraction (ILlmProvider)
    |
Ptah MCP Server (ptah.ai.chat, ptah.image.generate)
```

---

## Codebase Investigation Summary

### Current GoogleOAuthService Dependency Chain

The following files directly depend on `GoogleOAuthService` or the `TOKENS.GOOGLE_OAUTH_SERVICE` DI token:

| File                                                                                       | Dependency Type                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/google-oauth.service.ts`                    | **Implementation** -- full PKCE flow with embedded client ID/secret                                       |
| `libs/backend/llm-abstraction/src/lib/di/register.ts`                                      | DI registration as singleton                                                                              |
| `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts`               | Injects `GOOGLE_OAUTH_SERVICE` to check `hasOAuthToken()` for provider availability                       |
| `libs/backend/vscode-core/src/di/tokens.ts`                                                | Defines `GOOGLE_OAUTH_SERVICE` token                                                                      |
| `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts`                                     | Injects `GOOGLE_OAUTH_SERVICE` for sign-in/sign-out/status RPC methods and model listing with OAuth token |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/services/image-generation.service.ts` | Injects `GOOGLE_OAUTH_SERVICE` for OAuth token-based image generation                                     |
| `apps/ptah-extension-vscode/src/services/google-auth-provider.ts`                          | Wraps `GoogleOAuthService` as VS Code `AuthenticationProvider` for Accounts menu                          |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/llm-rpc.handlers.ts`                 | Registers RPC methods: `llm:googleOAuthSignIn`, `llm:googleOAuthSignOut`, `llm:getGoogleOAuthStatus`      |
| `libs/frontend/core/src/lib/services/llm-provider-state.service.ts`                        | Frontend state signals for Google OAuth (sign-in/sign-out, email, loading)                                |
| `libs/frontend/chat/src/lib/settings/llm-providers-config.component.ts`                    | UI buttons for "Login with Google" / "Sign out"                                                           |
| `libs/frontend/chat/src/lib/settings/llm-providers-config.component.html`                  | Template with Google OAuth section                                                                        |

### Existing Pattern Reference: Claude Agent SDK

The Claude Agent SDK integration (`libs/backend/agent-sdk/`) demonstrates the target pattern:

- User authenticates Claude CLI externally (has Claude Pro/Max subscription)
- Ptah discovers and reuses the cached authentication
- No Ptah-owned credentials required

### ESM Dynamic Loading Pattern

The codebase already handles ESM-only packages via dynamic import + caching:

- `libs/backend/llm-abstraction/src/lib/providers/google-genai-loader.ts` -- loads `@google/genai`
- Similar `sdk-module-loader.ts` pattern in `agent-sdk`
- Both are bundled by Webpack with ESM/CJS interop

### Provider Registry Architecture

- `LlmProviderName` type: `'openai' | 'google-genai' | 'vscode-lm'` (in `provider-types.ts`)
- `PROVIDER_IMPORT_MAP` in `provider-import-map.ts` maps each provider to a lazy-loaded factory
- `ProviderRegistry` resolves API keys from `LlmSecretsService` and creates providers on demand
- Currently, Google OAuth tokens bypass the registry (handled separately in `LlmConfigurationService` and `ImageGenerationService`)

---

## Requirements

### Requirement 1: Replace Custom Google OAuth with Gemini CLI Credential Reuse

**User Story:** As a Ptah user with a Google AI Pro subscription, I want Ptah to reuse my Gemini CLI authentication credentials, so that I do not need to go through a separate OAuth flow or require Ptah to have its own published Google Cloud application.

#### Acceptance Criteria

1. WHEN the user has authenticated via Gemini CLI (`@google/gemini-cli-core`) THEN Ptah SHALL detect the cached OAuth credentials at the platform-appropriate path (`~/.gemini/oauth_creds.json` on Linux/macOS, `%APPDATA%\.gemini\oauth_creds.json` on Windows) and mark Google Gemini as "configured".

2. WHEN Ptah needs a Google access token for API calls THEN it SHALL use the `@google/gemini-cli-core` auth module (with `authType: 'oauth-personal'`) to obtain a valid access token, including automatic refresh of expired tokens.

3. WHEN the user has NOT installed or authenticated Gemini CLI THEN Ptah SHALL show a clear message in the settings UI explaining that Gemini CLI authentication is required, with a link or instructions to install and authenticate (`npx @google/gemini-cli`).

4. WHEN a Gemini CLI access token is available THEN the `GoogleGenAIProvider` SHALL use it via Bearer token header (existing `createGoogleGenAIClient` with `accessToken` parameter), maintaining full compatibility with text completion, structured output, and image generation.

5. WHEN the user also has a BYOK API key configured for `google-genai` THEN the API key SHALL take precedence over CLI credentials (matching the existing behavior where API key is checked first).

6. WHEN the `GoogleOAuthService` is removed THEN all references to Ptah's embedded `CLIENT_ID` (`610612255669-...`) and `CLIENT_SECRET` SHALL be deleted from the codebase, and the local HTTP redirect server logic SHALL be removed.

7. WHEN the `@google/gemini-cli-core` package is loaded THEN it SHALL use the same dynamic import + caching pattern as `google-genai-loader.ts` (ESM-only package in CJS extension host).

### Requirement 2: Add OpenAI Codex CLI Auth Integration

**User Story:** As a Ptah user with a ChatGPT Plus/Pro subscription, I want Ptah to reuse my OpenAI Codex CLI authentication credentials, so that I can use OpenAI models without providing a separate API key.

#### Acceptance Criteria

1. WHEN the user has authenticated via Codex CLI (`@openai/codex-sdk`) THEN Ptah SHALL detect the cached OAuth credentials at the platform-appropriate path (`~/.codex/auth.json` or OS keyring) and mark OpenAI as "configured".

2. WHEN Ptah needs an OpenAI access token THEN it SHALL use the `@openai/codex-sdk` auth module to obtain a valid token, supporting automatic refresh.

3. WHEN the user has NOT installed or authenticated Codex CLI THEN Ptah SHALL show an informational message in the settings UI with instructions to install and authenticate.

4. WHEN a Codex CLI access token is available THEN the `OpenAIProvider` SHALL use it as a Bearer token for API calls.

5. WHEN the user also has a BYOK API key configured for `openai` THEN the API key SHALL take precedence over CLI credentials.

6. WHEN the `@openai/codex-sdk` package is loaded THEN it SHALL use the same dynamic import + caching pattern as other ESM packages.

### Requirement 3: Refactor Auth Token Abstraction Layer

**User Story:** As a developer maintaining Ptah, I want a unified CLI auth service that abstracts Gemini CLI and Codex CLI credential discovery, so that the provider registry and configuration service have a clean interface for checking auth availability and obtaining tokens.

#### Acceptance Criteria

1. WHEN a new `CliAuthService` (or equivalent) is created THEN it SHALL provide a unified interface:

   - `hasCliAuth(provider: LlmProviderName): Promise<boolean>` -- check if CLI credentials exist
   - `getCliAccessToken(provider: LlmProviderName): Promise<string | undefined>` -- get a valid access token
   - `getCliAccountInfo(provider: LlmProviderName): Promise<{ email?: string } | undefined>` -- get user info for UI display

2. WHEN `LlmConfigurationService.getAvailableProviders()` is called THEN it SHALL check CLI auth availability (replacing the current `googleOAuth.hasOAuthToken()` check) for both `google-genai` and `openai`.

3. WHEN `LlmConfigurationService.getAllProviders()` determines `isConfigured` THEN a provider SHALL be considered configured if EITHER a BYOK API key OR CLI auth credentials exist.

4. WHEN the `ProviderRegistry.createProvider()` is called for a provider with CLI auth but no API key THEN it SHALL obtain the access token from `CliAuthService` and pass it to the provider factory.

5. WHEN `ImageGenerationService.isAvailable()` is called THEN it SHALL check CLI auth availability for `google-genai` (replacing direct `GoogleOAuthService` dependency).

### Requirement 4: Update DI Token and Registration

**User Story:** As a developer maintaining Ptah, I want the DI container to reflect the new CLI auth architecture, so that services are properly wired and the old Google OAuth token is cleanly removed.

#### Acceptance Criteria

1. WHEN the DI container is initialized THEN `TOKENS.GOOGLE_OAUTH_SERVICE` SHALL be replaced with a new token (e.g., `TOKENS.CLI_AUTH_SERVICE`) pointing to the unified `CliAuthService`.

2. WHEN `registerLlmAbstractionServices()` is called THEN it SHALL register `CliAuthService` as a singleton (replacing `GoogleOAuthService` registration).

3. WHEN any service previously injecting `TOKENS.GOOGLE_OAUTH_SERVICE` is updated THEN it SHALL inject the new `CLI_AUTH_SERVICE` token instead.

4. WHEN `PtahGoogleAuthProvider` (VS Code Accounts menu integration) is updated THEN it SHALL use `CliAuthService` to check Gemini CLI credentials for the Accounts panel, OR be removed if the Gemini CLI pattern makes the VS Code Accounts integration unnecessary.

### Requirement 5: Update Frontend Settings UI

**User Story:** As a Ptah user, I want the settings UI to clearly show my CLI authentication status for Google Gemini and OpenAI, so that I know whether my subscription credentials are being used.

#### Acceptance Criteria

1. WHEN the Google Gemini provider card is rendered THEN it SHALL show CLI auth status ("Authenticated via Gemini CLI" with email if available) instead of the current "Login with Google" button.

2. WHEN the Google Gemini provider does NOT have CLI auth THEN the UI SHALL show instructions: "Authenticate via Gemini CLI: `npx @google/gemini-cli`" with an "or use an API key" fallback.

3. WHEN the OpenAI provider card is rendered and Codex CLI auth is detected THEN it SHALL show "Authenticated via Codex CLI" with appropriate status indicator.

4. WHEN the OpenAI provider does NOT have CLI auth THEN the UI SHALL show instructions: "Authenticate via Codex CLI: `npx @openai/codex`" with an "or use an API key" fallback.

5. WHEN a provider has both CLI auth and BYOK API key THEN the UI SHALL indicate that the API key takes precedence, with a clear visual distinction.

6. WHEN the frontend calls RPC methods THEN the `llm:googleOAuthSignIn` / `llm:googleOAuthSignOut` RPC methods SHALL be replaced with a `llm:getCliAuthStatus` method that returns CLI auth status for all providers.

7. WHEN `LlmProviderStateService` loads provider status THEN the Google OAuth-specific signals (`_googleOAuthSignedIn`, `_googleOAuthEmail`, `_googleOAuthLoading`) SHALL be replaced with generic CLI auth status signals per provider.

### Requirement 6: Update RPC Handlers

**User Story:** As a developer maintaining Ptah, I want the RPC layer to expose CLI auth status instead of Google OAuth-specific methods, so that the frontend has a clean interface for all CLI-based auth providers.

#### Acceptance Criteria

1. WHEN RPC methods are registered THEN the following methods SHALL be removed:

   - `llm:googleOAuthSignIn`
   - `llm:googleOAuthSignOut`
   - `llm:getGoogleOAuthStatus`

2. WHEN RPC methods are registered THEN the following method SHALL be added:

   - `llm:getCliAuthStatus` -- returns `{ providers: Array<{ provider: LlmProviderName; isAuthenticated: boolean; email?: string; cliName: string }> }`

3. WHEN `llm:getProviderStatus` returns provider data THEN it SHALL include `hasCliAuth: boolean` and `cliAuthEmail?: string` fields (replacing `hasOAuthToken` and `oauthAccountEmail`).

4. WHEN `llm:listProviderModels` is called for a provider with CLI auth THEN it SHALL use the CLI auth token for the API call (replacing the current OAuth token path).

### Requirement 7: Webpack Configuration for ESM Packages

**User Story:** As a developer building Ptah, I want the Webpack configuration to properly bundle the new ESM-only CLI packages, so that dynamic imports work correctly in the VS Code extension host.

#### Acceptance Criteria

1. WHEN `@google/gemini-cli-core` is imported dynamically THEN Webpack SHALL bundle it (not externalize), matching the pattern used for `@google/genai`.

2. WHEN `@openai/codex-sdk` is imported dynamically THEN Webpack SHALL bundle it (not externalize), matching the existing ESM handling pattern.

3. WHEN the extension is built THEN the new packages SHALL not cause bundle errors or runtime import failures.

### Requirement 8: Image Generation Service Update

**User Story:** As a Ptah user, I want image generation to work seamlessly with Gemini CLI credentials, so that I can generate images without a separate Google API key.

#### Acceptance Criteria

1. WHEN `ImageGenerationService.isAvailable()` is called THEN it SHALL check `CliAuthService.hasCliAuth('google-genai')` (replacing `googleOAuth.hasOAuthToken()`).

2. WHEN `ImageGenerationService.generateImage()` needs credentials THEN it SHALL obtain the access token from `CliAuthService.getCliAccessToken('google-genai')` (replacing `googleOAuth.getAccessToken()`).

3. WHEN the access token source changes (CLI auth vs API key) THEN the cached `GoogleGenAI` instance SHALL be invalidated and recreated (existing credential staleness detection continues to work).

---

## Non-Functional Requirements

### Performance Requirements

- **Token Retrieval**: CLI auth token retrieval (file read + potential refresh) SHALL complete in under 500ms for 95% of requests.
- **SDK Loading**: First-time dynamic import of `@google/gemini-cli-core` and `@openai/codex-sdk` SHALL complete in under 200ms (cached thereafter).
- **Bundle Size**: New dependencies SHALL add no more than 200KB to the extension bundle (combined).

### Security Requirements

- **No Embedded Credentials**: The codebase SHALL contain zero Ptah-owned OAuth client IDs or client secrets after this change.
- **Token Isolation**: CLI tokens are read-only; Ptah SHALL NOT write to or modify CLI credential files.
- **Secret Storage**: BYOK API keys continue to use VS Code SecretStorage (encrypted). CLI tokens are managed by their respective CLIs.

### Reliability Requirements

- **Graceful Degradation**: If CLI auth fails (expired, revoked, file missing), Ptah SHALL fall back to BYOK API key if available, or show a clear error message.
- **No Breaking Changes for API Key Users**: Users who currently use BYOK API keys SHALL experience zero disruption. API key flow continues to work unchanged.
- **Token Refresh**: Expired CLI tokens SHALL be refreshed automatically by the CLI SDK's auth module. Ptah SHALL NOT implement its own refresh logic.

### Cross-Platform Requirements

- **Credential Discovery**: Credential file paths SHALL be resolved using platform-appropriate logic:
  - Linux/macOS: `~/.gemini/oauth_creds.json`, `~/.codex/auth.json`
  - Windows: `%APPDATA%\.gemini\oauth_creds.json`, `%APPDATA%\.codex\auth.json`
- **Path Resolution**: Use `os.homedir()` or SDK-provided path resolution (preferred).

---

## Risk Assessment

### Technical Risks

| Risk                                                                 | Probability | Impact | Mitigation                                                                                                                             |
| -------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@google/gemini-cli-core` auth API is unstable or undocumented       | Medium      | High   | Research community implementations (ai-sdk-provider-gemini-cli, Roo-Code) that already use this pattern. Pin to specific version.      |
| `@openai/codex-sdk` auth module may not support external token reuse | Medium      | High   | Confirm SDK supports "external auth mode" before implementation. If blocked, defer OpenAI Codex integration and ship Gemini CLI first. |
| ESM bundling issues with new packages in Webpack                     | Low         | Medium | Follow existing proven pattern from `@google/genai` and Claude Agent SDK loaders. Test build early.                                    |
| CLI credential file format changes between versions                  | Low         | Medium | Use SDK auth modules (not raw file parsing) for credential access. SDKs handle their own format evolution.                             |
| Token refresh race conditions                                        | Low         | Medium | Use SDK-provided auth (which handles refresh internally). Add mutex/caching at Ptah's `CliAuthService` level.                          |

### Business Risks

| Risk                                                              | Probability | Impact | Mitigation                                                                                  |
| ----------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------- |
| Users confused by removal of "Login with Google" button           | Medium      | Low    | Clear UI messaging explaining CLI auth. Migration guide in changelog.                       |
| Users who only used Google OAuth (no CLI, no API key) lose access | Medium      | Medium | Document migration path: install Gemini CLI + authenticate. Show one-time migration notice. |

---

## Out of Scope

The following items are explicitly NOT part of this task:

1. **Claude Agent SDK changes** -- The existing Claude auth integration is working and will not be modified.
2. **VS Code LM API changes** -- The VS Code Language Model provider is unaffected.
3. **Anthropic or OpenRouter providers** -- These were already removed in TASK_2025_155.
4. **Streaming support changes** -- Provider streaming behavior is not affected by auth changes.
5. **New provider additions** -- Only existing providers (openai, google-genai) are modified.
6. **Gemini CLI or Codex CLI installation/management** -- Ptah does not install or manage CLI tools; it only reuses their credentials.
7. **License server changes** -- No backend infrastructure changes.
8. **Unit test updates for removed GoogleOAuthService** -- Test updates follow implementation, not scoped separately.
9. **Google Cloud app publishing** -- This is exactly what we are eliminating.

---

## Dependencies and Constraints

### New NPM Dependencies

| Package                   | Purpose                | ESM-Only? | Estimated Size |
| ------------------------- | ---------------------- | --------- | -------------- |
| `@google/gemini-cli-core` | Gemini CLI auth module | Yes       | ~50-100KB      |
| `@openai/codex-sdk`       | Codex CLI auth module  | Yes (TBD) | ~50-100KB      |

### Constraint: SDK API Availability

The exact auth APIs for both packages need to be confirmed during implementation:

- `@google/gemini-cli-core`: Expected `authType: 'oauth-personal'` for cached credential reuse
- `@openai/codex-sdk`: Expected "external auth mode" for token passthrough

If either SDK does not support the expected auth pattern, the implementation for that provider should be deferred (not blocked) while the other proceeds.

### Constraint: Phased Delivery

Recommended implementation order:

1. Phase 1: Gemini CLI auth (replaces GoogleOAuthService) -- highest priority, removes embedded credentials
2. Phase 2: OpenAI Codex CLI auth -- additive, lower risk
3. Phase 3: Frontend UI updates and cleanup -- depends on Phase 1+2

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder                        | Impact | Involvement      | Success Criteria                             |
| ---------------------------------- | ------ | ---------------- | -------------------------------------------- |
| Ptah Users (Google AI subscribers) | High   | Testing/Feedback | Seamless auth via Gemini CLI credentials     |
| Ptah Users (ChatGPT subscribers)   | High   | Testing/Feedback | New auth option via Codex CLI credentials    |
| Ptah Users (BYOK API key users)    | Low    | None             | Zero disruption to existing API key workflow |
| Extension Developer (maintainer)   | High   | Implementation   | No embedded secrets, clean architecture      |

### Secondary Stakeholders

| Stakeholder             | Impact | Involvement | Success Criteria                       |
| ----------------------- | ------ | ----------- | -------------------------------------- |
| Google Cloud compliance | Medium | None        | No published Google Cloud app required |
| VS Code Marketplace     | Low    | None        | Extension continues to pass review     |

---

## Success Metrics

1. **Zero embedded secrets**: No OAuth client IDs or secrets in the shipped extension code.
2. **CLI auth detection rate**: 100% of users with authenticated Gemini CLI / Codex CLI are auto-detected.
3. **BYOK API key continuity**: 100% of existing API key users experience zero behavior change.
4. **Token refresh reliability**: Access token refresh via CLI SDKs succeeds on first attempt for 99%+ of cases.
5. **Build size impact**: Total bundle size increase under 200KB.
