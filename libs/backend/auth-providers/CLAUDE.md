# @ptah-extension/auth-providers

[Back to Main](../../../CLAUDE.md)

## Purpose

Owns the entire authentication subsystem and per-provider integration tree extracted from `@ptah-extension/agent-sdk` (TASK_2026_123 Win 5). Hosts auth strategies, `AuthManager`, `ModelResolver`, `ProviderModelsService`, and the `providers/{copilot,codex,openrouter,local}/` trees including their auth services and translation proxies. `agent-sdk` consumes a single port (`IAuthEnvProvider`) — auth-providers depends on agent-sdk one-way, breaking the cycle that would otherwise form via the provider registry (now in `@ptah-extension/shared`).

## Boundaries

**Belongs here**:

- `auth/` — strategies (`api-key`, `oauth-proxy`, `local-native`, `local-proxy`), `AuthManager`, `ModelResolver`, `effective-route` resolver
- `providers/{copilot,codex,openrouter,local}/` — auth services, translation proxies, provider entry constants, `register-providers` helper
- `translation/` — Anthropic↔OpenAI translation infrastructure (`TranslationProxyBase`, `OpenAIResponseTranslator`, `translateAnthropicToOpenAI`, `ITranslationProxy`)
- `ProviderModelsService` + `DynamicModelFetcher`
- DI registration via `registerAuthProvidersServices` and `AUTH_PROVIDERS_TOKENS`

**Does NOT belong**:

- SDK adapter, session lifecycle, message transformation, permission handling (those stay in `agent-sdk`)
- Platform-specific code beyond what's already allowed for a `scope:extension` + `type:feature` lib (vscode-core OK; platform-{cli,electron,vscode} adapters NOT OK)
- RPC handlers (live in `rpc-handlers`)

## Public API

Batch 17 scaffold — surface is intentionally empty. Subsequent batches in Win 5 will export:

- Auth: `AuthManager`, `ModelResolver`, `IAuthStrategy`, `AuthConfigureResult`, `AuthConfigureContext`, `resolveEffectiveAuthRoute`, related types
- Providers: `CopilotAuthService`, `VscodeCopilotAuthService`, `CopilotTranslationProxy`, `CodexAuthService`, `CodexTranslationProxy`, `OpenRouterAuthService`, `OpenRouterTranslationProxy`, `OllamaModelDiscoveryService`, `LmStudioTranslationProxy`, related types and constants
- Translation: `TranslationProxyBase`, `OpenAIResponseTranslator`, `translateAnthropicToOpenAI`, `ITranslationProxy`, `TranslationProxyConfig`
- Models: `ProviderModelsService`, `DynamicModelFetcher`
- DI: `AUTH_PROVIDERS_TOKENS`, `registerAuthProvidersServices`

## Internal Structure

- `src/lib/auth/` — strategies + AuthManager + ModelResolver + effective-route
- `src/lib/providers/{copilot,codex,openrouter,local}/` — per-provider auth + translation proxies + entry helpers
- `src/lib/translation/` — Anthropic↔OpenAI translation infrastructure (moved from agent-sdk `providers/_shared/translation/`)
- `src/lib/provider-models.service.ts` — dynamic + static model resolution
- `src/lib/di/{tokens,register}.ts` — `AUTH_PROVIDERS_TOKENS` + `registerAuthProvidersServices`

## Dependencies

**Internal**: `@ptah-extension/agent-sdk` (public API only — `IAuthEnvProvider` port + helpers), `@ptah-extension/platform-core` (ports), `@ptah-extension/shared` (provider registry + auth types), `@ptah-extension/vscode-core` (Logger, ConfigManager, TOKENS)
**External**: `tsyringe`, `zod`, `axios`, `cross-spawn`, `which`, `uuid`

## Guidelines

- Depend on `agent-sdk` only via its public barrel — no deep imports.
- No imports from `platform-{cli,electron,vscode}` adapter libs.
- The provider registry lives in `@ptah-extension/shared` (moved there to break the cycle); import `ANTHROPIC_PROVIDERS`, `getAnthropicProvider`, etc. from there.
- `catch (error: unknown)`; narrow with `instanceof Error`.
- Boundary inputs validated via zod.

## Cross-Lib Rules

Used by `rpc-handlers` and app layers (`ptah-cli`, `ptah-electron`, `ptah-extension-vscode`). Forbidden imports: `platform-{cli,electron,vscode}`.
