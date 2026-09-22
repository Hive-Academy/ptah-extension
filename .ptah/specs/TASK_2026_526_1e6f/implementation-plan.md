# Implementation Plan - TASK_2026_526

## Inputs and constraints

- Requirements used: the caller's design-only brief; `.ptah/specs/TASK_2026_526_1e6f/task.md:22`; `.ptah/specs/TASK_2026_526_1e6f/research-report.md`, read first and accepted as the endpoint/model/protocol authority.
- Repository instructions used: `CONVENTIONS.md:42` (barrels), `CONVENTIONS.md:54` (DI), `CONVENTIONS.md:103` (layers), and `CONTRIBUTING.md:25`. Ptah search and a hidden-file CLI search found no applicable AGENTS.md or CLAUDE.md.
- Corrections applied: `libs/backend/auth-providers/src/lib/di/tokens.ts:1` is now a re-export; definitions belong in auth-providers-tokens. The requested provider-mark file is absent in this worktree; see Open questions.
- Design handoff used: none.
- Missing decision-critical input: the frontend provider-mark contract cannot be confirmed because neither its file nor its component exists here. This blocks finalizing that mark integration, not the routing architecture. No capability or numeric price evidence is supplied; the design preserves unknown metadata instead of inventing it.
- All source citations below are relative to `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39`. The Files table uses absolute paths.
- This document is the only artifact produced. No production edits, builds, tests, network calls, commits, or history changes were performed.
- **Verified (research):** separate keys, bases, Bearer authentication, and billing are specified at `research-report.md:15`–`18`, relative to this task folder. The report explicitly does not verify successful inference (`research-report.md:7`).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Verified: a provider has one base URL, one proxy flag, optional static models and tier defaults | `libs/shared/src/lib/providers/provider-registry.ts:69`, `:89`, `:104`, `:128` | A local proxy may represent all upstream lanes while the registry retains one subscription entry. |
| Verified: Sakana combines API-key auth and a proxy | `libs/shared/src/lib/providers/entries/sakana-provider-entry.ts:73` | Reuse this entry/auth/lifecycle pattern. |
| Verified: Sakana gets keys by provider ID and emits Bearer headers | `libs/backend/auth-providers/src/lib/providers/sakana/sakana-auth.service.ts:38`, `:51` | Bind each subscription's auth service permanently to its own provider ID. |
| Verified: per-key factory owns an isolated auth object; caller stops the proxy | `libs/backend/auth-providers/src/lib/providers/sakana/sakana-proxy.factory.ts:25`, `:57` | Per-agent and workspace instances must not share mutable credentials. |
| Verified: base dispatcher only chooses Chat or Responses | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:363`, `:457` | A third native lane needs a real dispatch change, not just registry literals. |
| Verified: common forwarding owns auth, quota, timeout and cancellation | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:574`, `:699`, `:732`, `:830`, `:855` | Native forwarding belongs inside this transport lifecycle. |
| Verified: Codex selects Responses, with a separate host-specific forced-SSE rule | `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts:130`, `:135` | Reuse Responses translation; do not inherit Codex OAuth or force OpenCode SSE. |
| Verified: global auth enumerates proxy bindings explicitly | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:113` | DI registration alone does not make a new proxy reachable. |
| Verified: workspace pooling and per-agent CLI creation also dispatch explicitly | `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:244`; `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1277` | Both dispatchers need OpenCode bindings. |
| Verified: subscription providers are skipped when seeding shared pricing | `libs/shared/src/lib/providers/provider-registry.ts:113`, `:891` | Go must be subscription-billed and must never seed zero rates. |
| Verified: dynamic/persisted catalogs can precede static fallback | `libs/backend/auth-providers/src/lib/provider-models.service.ts:244`, `:297`, `:324` | OpenCode must return its reviewed supported set before those generic paths. |
| Verified: auth tiles currently render inline Lucide icons | `libs/frontend/chat/src/lib/settings/auth/auth-config.component.html:60` | There is no verified provider-mark data contract to extend in this checkout. |

## Decision

Choose **candidate 1: one built-in entry per subscription, with one provider-bound proxy class routing each request by model ID**. Register `opencode-zen` and `opencode-go`, each with `authType: 'apiKey'` and `requiresProxy: true`; leave `AnthropicProvider` unchanged. Store the reviewed routing data as a pure, OpenCode-specific constant in shared, without attaching a generic protocol map to every provider. Reject six per-protocol entries because they duplicate two credentials across six settings identities and fragment tier choices; reject candidate 3's optional registry protocol map because no generic factory currently consumes one—the actual consumers are explicit global, workspace and CLI dispatchers cited above—and broadening that public registry contract would not remove the required transport and lifecycle work. Native Messages stays behind the same local proxy, with no request/response protocol translation; bypassing it would require the auth environment to change when individual requests change models, whereas the verified strategy configures one proxy URL for the provider (`libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:371`).

## Architecture decision

- Chosen approach: two stable provider identities; one `OpenCodeTranslationProxy` implementation instantiated with an immutable subscription ID; three request-local lanes.
- Rationale: serves the two-key requirement without changing the registry interface, preserves Sakana's lifecycle, and directly reuses the base's Chat and Responses paths. The shared table is pure data, permitted by the shared leaf boundary (`CONVENTIONS.md:105`; `libs/shared/src/lib/providers/provider-registry.ts:667`).
- Rejected alternatives: native SDK bypass would mix direct and proxy credentials in one provider session; a separate standalone HTTP server would duplicate base cancellation/error/quota machinery; inferring lanes from names would misroute `minimax-m3` (`research-report.md:51`).
- Assumptions: exact vendor capability metadata and live inference compatibility remain unverified; the missing frontend mark contract requires the question below. No assumption is needed for model routing.
- Effect on existing code: replace the boolean protocol hook in place with an explicit three-lane selector and migrate its current overrides. Preserve current protocol choices for all existing providers. Replace the two hardcoded constructor proxy dependencies with one typed binding collection; do not retain a second registry beside it.
- Explicit exclusions: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro`, and `gemini-3-flash` use Google generateContent at `/zen/v1/models/{id}`; Ptah has no translator for that protocol. `jev-1.13` and `jev-1.13-free` use `/zen/v1/systemone`, a structured-judgment API that is not chat. These nine IDs are excluded from discovery, tiers and routing, for the reasons verified in `research-report.md:40` and `:70`. No new translator is in scope.

## Contracts

All signatures marked **Proposed** are design contracts, not assertions that those symbols already exist.

### Registry and catalog

**Verified current excerpt; unchanged:** `libs/shared/src/lib/providers/provider-registry.ts:69`, `:89`, `:98`, `:104`, `:122`, `:128`:

~~~ts
export interface AnthropicProvider {
  id: string;
  name: string;
  baseUrl: string;
  authEnvVar: ProviderAuthEnvVar;
  // Other existing fields remain unchanged.
  modelsEndpoint?: string;
  staticModels?: ProviderStaticModel[];
  authType?: 'apiKey' | 'oauth' | 'none';
  requiresProxy?: boolean;
  pricingModel?: 'usage' | 'subscription';
  defaultTiers?: {
    readonly sonnet: string;
    readonly opus: string;
    readonly haiku: string;
  };
}
~~~

**Verified current union to change:** `libs/shared/src/lib/providers/provider-registry.ts:478`:

~~~ts
export type AnthropicProviderId =
  | 'openrouter' | 'moonshot' | 'z-ai' | 'github-copilot'
  | 'openai-codex' | 'ollama' | 'ollama-cloud' | 'lm-studio'
  | 'claude-cli' | 'sakana' | 'requesty';
~~~

**Proposed replacement:** same union plus `'opencode-zen' | 'opencode-go'`. The registry array receives both entries at its existing entry boundary (`provider-registry.ts:464`).

**Proposed new shared contracts**, in `opencode-model-routes.ts`:

~~~ts
export type OpenCodeProviderId = 'opencode-zen' | 'opencode-go';
export type OpenCodeProtocol = 'messages' | 'chat/completions' | 'responses';
export type OpenCodeModelRoutes = Readonly<
  Record<OpenCodeProviderId, Readonly<Record<string, OpenCodeProtocol>>>
>;

export const OPENCODE_MODEL_ROUTES: OpenCodeModelRoutes;
export function isOpenCodeProviderId(id: string): id is OpenCodeProviderId;
export function getOpenCodeModelProtocol(
  providerId: OpenCodeProviderId,
  modelId: string,
): OpenCodeProtocol | undefined;
~~~

Use an own-property lookup, not a truthy plain-object lookup: `constructor`, `toString` and `__proto__` must all be unsupported IDs. No lowercasing, prefix guessing, suffix stripping, or cross-subscription search. Freeze/restrict table mutation. The entry module exports `OPENCODE_ZEN_PROVIDER_ENTRY`, `OPENCODE_GO_PROVIDER_ENTRY` and both tier constants; each entry satisfies the existing provider interface. Export through `libs/shared/src/lib/providers/index.ts`; the public shared barrel already forwards that module (`libs/shared/src/index.ts:58`).

### Proxy dispatch and native transport

**Verified current hook to replace:** `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:457`:

~~~ts
protected shouldUseResponsesApi(_modelId: string): boolean {
  return false;
}
~~~

**Proposed replacement in the same class:**

~~~ts
protected resolveUpstreamProtocol(
  modelId: string,
): 'messages' | 'chat/completions' | 'responses' | undefined;
// Base default: 'chat/completions'.
// Undefined: known provider refuses this model; send HTTP 400, no upstream call.
~~~

Migrate actual overrides: Codex returns `'responses'` (`codex-translation-proxy.ts:130`); Copilot, OpenRouter and Sakana return `'chat/completions'` (`copilot-translation-proxy.ts:108`, `openrouter-translation-proxy.ts:102`, `sakana-translation-proxy.ts:107`). Custom OpenAI inherits the default (`custom-openai-translation-proxy.ts:27`). Remove the old hook and update tests; do not leave a compatibility forwarding method. LSP references were requested; they reported the main-checkout paths, so the migration list was additionally checked with local worktree text search and source reads.

**Verified current configuration to extend:** `translation-proxy-base.ts:53`:

~~~ts
export interface TranslationProxyConfig {
  name: string;
  modelPrefix: string;
  completionsPath: string;
  responsesPath?: string;
}
~~~

**Proposed:** preserve those fields and add `messagesPath?: string`, default `'/messages'`. OpenCode explicitly sets the three suffixes, with empty `modelPrefix`. The transport must concatenate paths using the existing `buildUpstreamUrl(baseEndpoint: string, path: string): URL` (`translation-proxy-helpers.ts:116`), preserving both `/zen/v1` and `/zen/go/v1`.

**Proposed new protected error hooks** in the base, overridden by OpenCode:

~~~ts
protected getAuthFailureMessage(): string;
protected getUpstreamErrorMessage(status: number, body: string): string;
~~~

Base defaults retain current messages; OpenCode returns sanitized, subscription-specific remediation and status text. Both the upstream error log and client error use the formatted message for OpenCode, not the raw upstream body. Current hardcoded auth and upstream messages are at `translation-proxy-base.ts:710` and `:777`; these are implementation replacements, not public signature changes.

**Proposed native lane mechanics:** validate a JSON object with a nonempty string model before normalization. Preserve all original body fields; normalize only explicit `default/sonnet/opus/haiku` aliases. If a concrete native model ID was supplied, preserve the raw request body bytes; if a tier alias was supplied, reserialize the full object after replacing only `model`. Branch before either translator. Pass the native body to the existing private `forwardToApi` transport with new private parameters for allowlisted inbound protocol headers and native success handling. Forward only `anthropic-version` and `anthropic-beta` from the incoming SDK request; a missing version is an explicit 400 for this lane, rather than inventing a vendor version. Auth headers always come from the bound auth service and override client auth. Never forward incoming `Authorization`, `x-api-key`, `Host`, cookies or hop-by-hop headers.

Native 2xx responses relay JSON/SSE bytes unchanged, including usage, tool blocks, thinking, cache metadata and native error events. Stream through Node backpressure without collecting the complete SSE response. Forward only needed response headers (`content-type`, `cache-control`, `request-id`); do not copy upstream transfer/content-length headers when framing changes. The same transport owns abort, timeout, quota and error handling for all lanes. An upstream abort/close before completion must fail/terminate the client response, never look like a clean message completion. Catch failures inside the existing success-dispatch paths, including after headers have been sent.

The base is already over 1,000 lines (`translation-proxy-base.ts:1202`). This is a deliberate narrow extension of its current transport responsibility, not a reason to build a second proxy. Keep native response relay as cohesive private methods in the existing base; do not fragment a handful of handlers into generic helpers.

**Verified unchanged lifecycle:** `ITranslationProxy` at `libs/backend/auth-providers/src/lib/translation/openai-translation.types.ts:15`:

~~~ts
interface ITranslationProxy {
  start(): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getUrl(): string | undefined;
}
~~~

### OpenCode auth, factories and DI

**Proposed** `opencode-provider.types.ts`:

~~~ts
export interface IOpenCodeAuthService {
  isAuthenticated(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  getHeaders(): Promise<Record<string, string>>;
}
export const OPENCODE_PROXY_TOKEN_PLACEHOLDER = 'opencode-proxy-token';
~~~

Same method shape as the verified `ISakanaAuthService` (`sakana-provider.types.ts:22`). This placeholder is SDK-to-local-proxy metadata, not an upstream key or a localhost access-control credential.

**Proposed constructors/factory:**

~~~ts
export class OpenCodeAuthService implements IOpenCodeAuthService {
  constructor(providerId: OpenCodeProviderId, authSecrets: IAuthSecretsService);
  isAuthenticated(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  getHeaders(): Promise<Record<string, string>>;
}

export class OpenCodeTranslationProxy extends TranslationProxyBase {
  constructor(
    logger: Logger,
    providerId: OpenCodeProviderId,
    auth: IOpenCodeAuthService,
  );
  // Implements the existing abstract hooks and the new selector/error hooks.
}

export function createOpenCodeProxyForKey(
  providerId: OpenCodeProviderId,
  apiKey: string,
  logger: Logger,
): OpenCodeTranslationProxy;
~~~

`IAuthSecretsService.getProviderKey(providerId: string): Promise<string | undefined>` is verified at `libs/backend/vscode-core/src/services/auth-secrets.service.ts:82` and exported at `libs/backend/vscode-core/src/index.ts:76`. Trim keys, never read the other subscription's key as fallback, never refresh API keys. Missing keys use the existing `SdkError` convention (`sakana-auth.service.ts:54`; definition `libs/backend/agent-sdk/src/lib/errors/sdk.error.ts:15` and barrel `libs/backend/agent-sdk/src/index.ts:93`). Auth service needs no new logger; the proxy receives the logger already required by the base (`translation-proxy-base.ts:108`). This creates no new backend library and no new runtime adapter dependency.

**Proposed tokens**, added to the actual token owner `libs/backend/auth-providers-tokens/src/lib/tokens.ts` alongside the existing Sakana tokens (`:29`):

~~~ts
SDK_OPENCODE_ZEN_AUTH: Symbol.for('SdkOpenCodeZenAuth'),
SDK_OPENCODE_ZEN_PROXY: Symbol.for('SdkOpenCodeZenProxy'),
SDK_OPENCODE_GO_AUTH: Symbol.for('SdkOpenCodeGoAuth'),
SDK_OPENCODE_GO_PROXY: Symbol.for('SdkOpenCodeGoProxy'),
SDK_API_KEY_PROXY_BINDINGS: Symbol.for('SdkApiKeyProxyBindings'),
~~~

`libs/backend/auth-providers/src/lib/di/tokens.ts:1` remains an unchanged re-export; do not duplicate tokens there.

**Proposed registration:** `register-providers.ts` registers two cached factories for the auth class, one per immutable ID, and two cached proxy factories using the corresponding auth token. Use `instanceCachingFactory`, already imported/used at `register-providers.ts:13` and `:48`; do not combine a factory with tsyringe lifecycle options (`:45`). Factories construct objects only; they do not start servers or fetch models. Existing library registration invokes `registerProviders` before registering the API-key strategy (`libs/backend/auth-providers/src/lib/di/register.ts:55`).

Avoid growing the API-key strategy beyond its existing eight dependencies. **Proposed new type** in existing `auth/auth-strategy.types.ts`:

~~~ts
export interface ApiKeyProxyBinding {
  readonly providerId: string;
  readonly proxy: ITranslationProxy;
  readonly placeholder: string;
}
~~~

Register `SDK_API_KEY_PROXY_BINDINGS` with a cached factory returning a readonly array for OpenRouter, Sakana, Zen and Go. Resolve existing singleton tokens for the first two, and the new singleton tokens for the latter two. The binding collection replaces the getter's hardcoded array, retaining the same data contract currently at `api-key.strategy.ts:113`.

**Verified current constructor to change**, type-level signature from `api-key.strategy.ts:82` (parameter decorators omitted):

~~~ts
constructor(
  logger: Logger,
  config: ConfigManager,
  authSecrets: IAuthSecretsService,
  providerModels: ProviderModelsService,
  authEnv: AuthEnv,
  openRouterProxy: ITranslationProxy,
  sakanaProxy: ITranslationProxy,
  sentryService: SentryService,
);
~~~

**Proposed replacement:**

~~~ts
constructor(
  logger: Logger,
  config: ConfigManager,
  authSecrets: IAuthSecretsService,
  providerModels: ProviderModelsService,
  authEnv: AuthEnv,
  builtInProxyProviders: readonly ApiKeyProxyBinding[],
  sentryService: SentryService,
);
~~~

Inject the binding token at the new parameter. Keep strategy name, `configure`, `teardown`, and existing tokens. Verified direct-construction test seam: `api-key.strategy.spec.ts:219`. The collection is one registration value, not another service or dynamic plugin architecture.

### Catalog and frontend boundaries

No existing `ProviderStaticModel` or `ProviderModelInfo` signature changes: required `contextLength` and `supportsToolUse` are verified at `provider-registry.ts:38` and `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:50`.

**Decision:** publish static supported IDs only in this release; omit `modelsEndpoint` on both OpenCode entries. Zen's endpoint is usable for ID discovery (`research-report.md:23`), but is not a capability or protocol authority (`:104`). Static listing also avoids asserting a Go models endpoint that the report does not verify.

Generate each entry's `staticModels` from its own routing-map keys, with `name: id`, a description identifying the subscription and unverified metadata, `contextLength: 0` and `supportsToolUse: false` until independent capability evidence exists. Here false means “not reported/verified,” as the existing dynamic transform already does (`provider-models.service.ts:1084`). Omit all cost/capability fields. This deliberately means `toolUseOnly: true` returns no unverified models; ordinary listing and tier defaults still work. Do not seed fictitious context sizes or claim that every routable model has working tools. The existing picker already describes this case as “does not report tool-use support” (`libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:294`).

Add an OpenCode-specific static-catalog branch before generic dynamic/cache/persisted resolution in `ProviderModelsService.fetchModels`; preserve its current signature (`provider-models.service.ts:235`). This branch always projects the entry's reviewed static set and honors the existing tool-use filter. It neither reads network-discovered IDs nor trusts old persisted IDs to expand supported routes. A later reviewed catalog update may add capability evidence without changing this architecture.

**Frontend mismatch, unresolved:** the requested `libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts` does not exist, and `ptah_search_files("**/*provider*mark*")` plus local filesystem search found no replacement. Native exports end with model and peer-session pickers (`libs/frontend/ui/src/lib/native/index.ts:27`); auth tiles currently use inline Lucide branches (`auth-config.component.html:60`). Consequently this plan does **not** invent an “existing” SVG field, map name, input, asset format or renderer. The mark integration is a prerequisite-dependent item in Files and Open questions.

## Component specifications

### 1. OpenCode subscription catalog

- Purpose: own stable IDs, entry display data, tiers and the reviewed protocol table.
- Responsibilities: publish two entries and 97 supported provider/model pairs; reject foreign/unknown IDs through the pure lookup; preserve unknown capability/cost data.
- Verified contracts and entry points: `provider-registry.ts:38`, `:69`, `:478`; `libs/shared/src/lib/providers/index.ts:28`.
- Dependencies: pure shared values only; consumers import `@ptah-extension/shared` through its barrel (`libs/shared/src/index.ts:58`).
- Integration points: registry, model service and OpenCode proxy read the same table/entries.
- Failure behaviour: lookup returns undefined; static model generation cannot introduce a model absent from the table.
- Quality requirements: no I/O, exact subscription scoping, immutable data.
- Verification seam: pure catalog tests, counts, exclusions, alias targets, subscription-pricing seeding.
- Files: group Catalog in Files.

### 2. Three-lane transport

- Purpose: dispatch a normalized Messages request to one upstream protocol and return Messages-shaped output.
- Responsibilities: explicit selector, native passthrough, shared auth/error/quota/timeout/cancellation; migrate existing overrides.
- Verified contracts and entry points: `translation-proxy-base.ts:343`, `:574`; request translators at `request-translator.ts:51` and `responses-request-translator.ts:129`.
- Dependencies: existing Node transport and internal translators, no provider-specific IDs in the base.
- Integration points: OpenCode overrides protocol selection; existing providers retain their prior lane.
- Failure behaviour: validate before translation; unknown routes return 400; transport errors obey Failure behaviour below.
- Quality requirements: request-local routing, no mutable current-lane field; no buffered full native SSE; preserve native body fields and response bytes.
- Verification seam: localhost fake upstream verifies request path, auth, body, stream bytes and abort propagation.
- Files: group Transport.

### 3. OpenCode authentication and provider proxy

- Purpose: bind a proxy to one product's base, key source and route table.
- Responsibilities: pure tier normalization, strict lookup, per-ID auth, key-bound factory, actionable API-key errors.
- Verified contracts and entry points: Sakana proxy constructor/hooks (`sakana-translation-proxy.ts:34`), auth (`sakana-auth.service.ts:31`), factory (`sakana-proxy.factory.ts:57`).
- Dependencies: shared catalog through alias; existing base internally; secret interface through the vscode-core public barrel. No new direct VS Code imports.
- Integration points: global cached DI instances, workspace factories and per-agent CLI factories.
- Failure behaviour: no refresh, cross-product fallback, endpoint inference, or model fallback.
- Quality requirements: immutable ID per instance; never log keys or request bodies; endpoint is the built-in URL.
- Verification seam: two subscriptions with the same model and distinct fake credentials; parallel per-key instances.
- Files: group OpenCode runtime.

### 4. Auth lifecycle and model discovery integration

- Purpose: make both built-ins reachable through every existing relevant auth path.
- Responsibilities: DI bindings, strategy lifecycle, workspace pool key invalidation, CLI proxy creation, reviewed static model output.
- Verified contracts and entry points: `api-key.strategy.ts:145`; `provider-proxy-pool.ts:145`; `ptah-cli-registry.ts:1209`; `provider-models.service.ts:235`.
- Dependencies: same existing auth-providers/CLI boundary; CLI imports only the public auth-providers barrel (`libs/backend/auth-providers/src/index.ts:117`).
- Integration points: SDK env uses local URL plus placeholder; tiers remain provider-scoped.
- Failure behaviour: global missing key gives configured=false; existing workspace acquisition failures retain the explicitly documented global-auth fallback; per-agent proxy startup propagates failure, never sends an OpenCode request directly.
- Quality requirements: strategy has seven dependencies after the binding change; no shared per-agent key; stop owned proxies on teardown/stream completion.
- Verification seam: strategy constructor tests, pool acquisition/key rotation, CLI captured SDK environment.
- Files: groups Registration, Workspace/catalog integration, CLI integration.

### 5. Frontend exposure and mark prerequisite

- Purpose: expose two separate subscription choices and an appropriate provider mark.
- Responsibilities: add both CLI-form options; show separate labels/key inputs; finish mark integration only against its real contract.
- Verified contracts and entry points: `ProviderOption` (`ptah-cli-config.component.ts:39`), its list (`:64`), auth key input (`auth-config.component.ts:106`), tile label (`auth-config.component.html:118`).
- Dependencies: frontend UI/shared only, never backend.
- Integration points: two IDs in existing settings; mark path is unresolved, not a fictitious existing component.
- Failure behaviour: no misleading connected badge from ID-only discovery; existing generic icon remains until the mark prerequisite is resolved.
- Quality requirements: preserve standalone/OnPush conventions (`auth-config.component.ts:69`); accessible labels distinguish Zen/Go even if their eventual artwork is shared; no HTML injection or remote asset request.
- Verification seam: existing auth component specs plus a CLI-form option test; mark tests depend on the restored/provided contract.
- Files: group Frontend.

## Files

Paths below are absolute. CREATE/MODIFY are proposed implementation work; only this plan is written now. Groups are ownership boundaries, not numbered execution batches. Exact independence and executor recommendations are in Team-leader handoff.

| Group | Action | File | Change |
| --- | --- | --- | --- |
| Catalog | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/shared/src/lib/providers/entries/opencode-model-routes.ts` | Pure scoped route map, protocol/ID types and exact lookup. |
| Catalog | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/shared/src/lib/providers/entries/opencode-provider-entry.ts` | Two entries, explicit tiers and static IDs derived from routes. |
| Catalog | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/shared/src/lib/providers/entries/opencode-provider-entry.spec.ts` | Table integrity, exclusions, defaults, unknowns and pricing guard. |
| Catalog | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/shared/src/lib/providers/provider-registry.ts` | Import/register two entries and extend ID union; no interface changes. |
| Catalog | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/shared/src/lib/providers/index.ts` | Named exports for entries, routes and their types/functions. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts` | Replace selector, add native lane/config/error hooks and guarded native relay. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts` | Migrate hook; test native JSON/SSE, validation, headers, errors, cancellation and existing lanes. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts` | Replace selector override with Responses; keep host-specific forced streaming. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/copilot/copilot-translation-proxy.ts` | Replace selector override with Chat. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-translation-proxy.ts` | Replace selector override with Chat. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/sakana/sakana-translation-proxy.ts` | Replace selector override with Chat. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/sakana/sakana-translation-proxy.spec.ts` | Migrate protected-hook assertions. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/custom/custom-openai-translation-proxy.ts` | Update documented inherited hook name. |
| Transport | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/custom/custom-openai-translation-proxy.spec.ts` | Assert inherited Chat selector through the new hook. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/opencode-provider.types.ts` | Auth contract and one local placeholder constant. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/opencode-auth.service.ts` | Immutable provider-ID secret reader and Bearer header builder. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/opencode-translation-proxy.ts` | One subclass implements all product-specific hooks. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/opencode-proxy.factory.ts` | Fresh key-bound proxy for a supplied subscription/key. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/index.ts` | Internal named provider exports. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/opencode-auth.service.spec.ts` | Trim/missing-key/product separation/header tests. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/opencode-translation-proxy.spec.ts` | Exact per-product routing, tier aliases, all three HTTP lanes and isolation. |
| OpenCode runtime | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/opencode/opencode-proxy.factory.spec.ts` | Distinct bound keys, immutable product and independent lifecycle. |
| OpenCode runtime | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/index.ts` | Public factory/placeholder exports needed by CLI; do not export internal helpers. |
| Registration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers-tokens/src/lib/tokens.ts` | Four OpenCode tokens and the built-in API-key binding token. |
| Registration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/register-providers.ts` | Cached auth/proxy factories and complete API-key proxy binding array. |
| Registration | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/providers/register-providers.spec.ts` | Resolve tokens; assert per-ID singleton identity and complete bindings without starting servers. |
| Registration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/auth/auth-strategy.types.ts` | Add internal typed ApiKeyProxyBinding contract. |
| Registration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts` | Inject binding collection in place of two proxy dependencies/getter. |
| Registration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts` | Adapt constructor harness; cover both providers, switching and missing keys. |
| Workspace/catalog integration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts` | Add both product cases with provider-scoped key fingerprint and fresh key-bound factory. |
| Workspace/catalog integration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.spec.ts` | Reuse, isolation, rotation, missing key and stop behaviour. |
| Workspace/catalog integration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/provider-models.service.ts` | Authoritative static branch for OpenCode before all dynamic/persisted paths. |
| Workspace/catalog integration | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/auth-providers/src/lib/provider-models.opencode.spec.ts` | Exact reviewed set; no discovery/auth inference; honest unknown metadata. |
| CLI integration | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts` | Recognize both IDs, call public key-bound factory, reuse existing teardown. |
| CLI integration | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-opencode-proxy.spec.ts` | Spawn-environment parity, per-agent keys and stop-on-completion/error. |
| Frontend | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts` | Add Zen and Go to the existing explicit ProviderOption list. |
| Frontend | CREATE | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.opencode.spec.ts` | Both product IDs/labels and independent API-key form semantics. |
| Frontend | MODIFY | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/frontend/chat/src/lib/settings/auth/auth-config.component.spec.ts` | Registry-driven tiles/key selection remain distinct for Zen and Go. |
| Frontend prerequisite | MODIFY after prerequisite is supplied | `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39/libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts` | Add two IDs using the actual data contract; file is absent here, so this modification is blocked. |

No rewrite files are proposed. The following named paths deliberately require **no edit**: `libs/backend/auth-providers/src/lib/di/tokens.ts` (re-export), `libs/shared/src/index.ts` (already forwards providers), and both request translators (already serve the required protocols). The mark's eventual consumer/test file list cannot be honestly completed until its prerequisite is supplied; do not silently substitute a new component architecture.

## Data

**Proposed registry values:** common fields `authType: 'apiKey'`, `authEnvVar: 'ANTHROPIC_AUTH_TOKEN'`, `requiresProxy: true`, `isLocal: false`, `keyPrefix: ''`, `maskedKeyDisplay: '••••••••'`. No environment variable automatically shares a Zen key with Go.

| ID | Name | baseUrl | pricingModel | helpUrl / key placeholder |
| --- | --- | --- | --- | --- |
| `opencode-zen` | OpenCode Zen | `https://opencode.ai/zen/v1` | `usage` | `https://opencode.ai/docs/zen/` / “Enter OpenCode Zen API key…” |
| `opencode-go` | OpenCode Go | `https://opencode.ai/zen/go/v1` | `subscription` | `https://opencode.ai/docs/go/` / “Enter OpenCode Go API key…” |

Help links are the report's source documentation (`research-report.md:3`); no console-key URL is guessed. Zen description: “Usage-billed OpenCode models via Messages, Chat Completions and Responses. Gemini and Jev are not supported.” Go description: “OpenCode Go, $10/month with a separate Go key. Messages, Chat Completions and Responses; Gemini and Jev are not supported.”

**Proposed default tiers**, all IDs copied from the report's supported rows (`research-report.md:37` and `:48`):

~~~ts
export const OPENCODE_ZEN_DEFAULT_TIERS = {
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  haiku: 'claude-haiku-4-5',
} as const;

export const OPENCODE_GO_DEFAULT_TIERS = {
  sonnet: 'glm-5.3',
  opus: 'kimi-k3',
  haiku: 'glm-5.3-flash',
} as const;
~~~

These are product defaults, not a verified comparative benchmark: the report supports availability/protocol, not relative quality. All Zen defaults route native Messages; all Go defaults route Chat. Users can map supported Responses/native Go IDs into any tier. Only literal `default`/`sonnet`/`opus`/`haiku` aliases are normalized, using these maps; do not copy Codex's broad `claude-*` remapping (`codex-translation-proxy.ts:93`).

**Proposed stored routing table**, exact provider-entry/model-ID shape. Source: `research-report.md:37`–`39` and `:47`–`49`. Keys total 66 Zen and 31 Go. Store these constants in `libs/shared/src/lib/providers/entries/opencode-model-routes.ts`:

~~~ts
export const OPENCODE_MODEL_ROUTES = {
  'opencode-zen': {
    'claude-fable-5-1': 'messages',
    'claude-fable-5': 'messages',
    'claude-opus-5': 'messages',
    'claude-opus-4-8': 'messages',
    'claude-opus-4-7': 'messages',
    'claude-opus-4-6': 'messages',
    'claude-opus-4-5': 'messages',
    'claude-sonnet-5': 'messages',
    'claude-sonnet-4-6': 'messages',
    'claude-sonnet-4-5': 'messages',
    'claude-haiku-4-5': 'messages',
    'qwen3.8-flash': 'messages',
    'qwen3.7-max': 'messages',
    'qwen3.7-plus': 'messages',
    'qwen3.6-plus': 'messages',
    'qwen3.5-plus': 'messages',

    'deepseek-v4.1-flash': 'chat/completions',
    'deepseek-v4-pro': 'chat/completions',
    'deepseek-v4-flash': 'chat/completions',
    'deepseek-v4-flash-vision-exp': 'chat/completions',
    'minimax-m3': 'chat/completions',
    'minimax-m2.7': 'chat/completions',
    'minimax-m2.5': 'chat/completions',
    'glm-5.3-flash': 'chat/completions',
    'glm-5.3': 'chat/completions',
    'glm-5.2': 'chat/completions',
    'glm-5.1': 'chat/completions',
    'glm-5': 'chat/completions',
    'kimi-k2.5': 'chat/completions',
    'kimi-k2.6': 'chat/completions',
    'kimi-k2.7-code': 'chat/completions',
    'kimi-k3': 'chat/completions',
    'big-pickle': 'chat/completions',
    'mimo-v2.6-flash-free': 'chat/completions',
    'mimo-v2.5-free': 'chat/completions',
    'ling-3.0-flash-fin-free': 'chat/completions',
    'nemotron-3-ultra-free': 'chat/completions',
    'nemotron-3.5-lightning-free': 'chat/completions',

    'gpt-6-astra': 'responses',
    'gpt-5.6-sol': 'responses',
    'gpt-5.6-terra': 'responses',
    'gpt-5.6-luna': 'responses',
    'gpt-5.5': 'responses',
    'gpt-5.5-pro': 'responses',
    'gpt-5.4': 'responses',
    'gpt-5.4-pro': 'responses',
    'gpt-5.4-mini': 'responses',
    'gpt-5.4-nano': 'responses',
    'gpt-5.3-codex': 'responses',
    'gpt-5.3-codex-spark': 'responses',
    'gpt-5.2': 'responses',
    'gpt-5.2-codex': 'responses',
    'gpt-5.1': 'responses',
    'gpt-5.1-codex': 'responses',
    'gpt-5.1-codex-max': 'responses',
    'gpt-5.1-codex-mini': 'responses',
    'gpt-5': 'responses',
    'gpt-5-codex': 'responses',
    'gpt-5-nano': 'responses',
    'grok-4.7': 'responses',
    'grok-4.6': 'responses',
    'grok-4.5': 'responses',
    'grok-build-0.1': 'responses',
    'muse-spark-1.3': 'responses',
    'muse-spark-1.2': 'responses',
    'muse-spark-1.3-contributor-free': 'responses',
  },
  'opencode-go': {
    'minimax-m3': 'messages',
    'minimax-m2.7': 'messages',
    'minimax-m2.5': 'messages',
    'qwen3.8-max': 'messages',
    'qwen3.8-flash': 'messages',
    'qwen3.7-max': 'messages',
    'qwen3.7-plus': 'messages',
    'qwen3.6-plus': 'messages',

    'glm-5.3-flash': 'chat/completions',
    'glm-5.3': 'chat/completions',
    'glm-5.2': 'chat/completions',
    'glm-5.1': 'chat/completions',
    'kimi-k3': 'chat/completions',
    'kimi-k2.7-code': 'chat/completions',
    'kimi-k2.6': 'chat/completions',
    'longcat-2.0': 'chat/completions',
    'deepseek-v4.1-flash': 'chat/completions',
    'deepseek-v4-pro': 'chat/completions',
    'deepseek-v4-flash': 'chat/completions',
    'deepseek-v4-flash-vision-exp': 'chat/completions',
    'mimo-v2.6-flash': 'chat/completions',
    'mimo-v2.6-pro': 'chat/completions',
    'mimo-v2.5': 'chat/completions',
    'mimo-v2.5-pro': 'chat/completions',
    'hy4-preview': 'chat/completions',
    'hy3': 'chat/completions',

    'grok-4.7': 'responses',
    'grok-4.6': 'responses',
    'gpt-5.6-luna': 'responses',
    'muse-spark-1.3-contributor': 'responses',
    'muse-spark-1.2-contributor': 'responses',
  },
} as const satisfies OpenCodeModelRoutes;
~~~

**Maintenance decision:** this is a reviewed, versioned release snapshot dated 2026-09-22. A maintainer adds/removes/changes a row only with protocol evidence for that exact subscription and a routing regression fixture. Updating the set of IDs from `/models` cannot update this table automatically; unknown new IDs remain unavailable until reviewed. Catalog and route data never diverge because static model IDs derive from this map. No shared-module network/file operation and no runtime remote configuration download.

**Pricing decision:** Go is explicitly `pricingModel: 'subscription'`; do not add any Go entries to the shared pricing map, including zero-valued ones. Verified guard: `provider-registry.ts:891`. Token totals may still be priced by the existing catalog and labeled subscription-covered; the flag does not make model rates zero (`provider-registry.ts:113`). Zen is explicitly `pricingModel: 'usage'`. This report supplies no numeric Zen rates, so leave all four optional cost fields absent, as the Sakana entry does for unavailable pricing (`sakana-provider-entry.ts:16`). Do not substitute Go's flat monthly fee for a token price. Existing fallback valuation is not proof of the actual Zen bill. A separately evidenced pricing-data update is required for vendor-exact estimates; adding a pricing fetcher or scraping documentation is outside this no-network design task.

## Integration architecture

- **Data flow:** settings select `opencode-zen`/`opencode-go` → existing API-key strategy reads that ID's secret → selected cached local proxy starts → SDK receives local `ANTHROPIC_BASE_URL` plus placeholder → inbound model aliases normalize → exact `(providerId, modelId)` lookup → chosen native/Chat/Responses lane → fixed product URL with Bearer key → native relay or existing response translator → SDK. Existing proxy configuration performs this env substitution at `api-key.strategy.ts:371`; existing CLI substitution is at `ptah-cli-registry.ts:1245`.
- **Native lane:** fixed base + `/messages`; no translation.
- **Chat lane:** fixed base + `/chat/completions`; existing `translateAnthropicToOpenAI` (`request-translator.ts:51`), then existing base response handlers (`translation-proxy-base.ts:486`).
- **Responses lane:** fixed base + `/responses`; existing `translateAnthropicToResponses` (`responses-request-translator.ts:129`), then existing streaming/non-streaming handlers (`translation-proxy-base.ts:528`). Retain the existing translator's `store: false` and caller streaming flag (`responses-request-translator.ts:149`). Do not advertise preservation of unsupported fields: that translator explicitly strips thinking/cache/tool-choice (`:125`). No new OpenCode-specific Responses dialect is assumed.
- **State/persistence:** registry/table are read-only module data. Global auth instances read the matching current secret per request. Factory-created instances retain only their supplied trimmed key, with caller-owned lifetime. Workspace pool identity remains workspace+provider (`provider-proxy-pool.ts:131`); product+key fingerprint invalidates stale key-bound proxies (`:159`). Use a separate OpenCode key variable captured in `acquire` and a closure/factory branch there, or keep it with the method's existing key-bound credential state without adding a public API. Never mutate an existing proxy's ID/base/lane.
- **External boundaries:** SDK request JSON and headers are untrusted; accept an object, nonempty model and expected Messages body before translating. Fixed registry HTTPS URLs prevent inbound requests from specifying an upstream host. Unknown/excluded IDs are rejected before retrieving a key or opening an upstream connection. Model lookup rejects inherited object properties.
- **Failure/rollback:** no storage schema migration; no key copying. Existing workspace inability to acquire a proxy returns undefined and explicitly falls back to global auth (`workspace-provider-profile-resolver.ts:297`); preserve and test that existing policy, and ensure it cannot fall through to a direct OpenCode base. A running OpenCode proxy never changes product or model lane after an error. CLI factories are recognized for both IDs so they never hit the direct-URL fallback currently at `ptah-cli-registry.ts:1228`.
- **Observability:** log provider ID, lane, model ID, status and request ID without keys, prompts or raw upstream bodies. Reuse quota/timing ownership in `translation-proxy-base.ts:616` and `:732`. Native response usage remains intact for SDK accounting; do not translate it through Responses usage conversion or claim new native token-level timing metrics.

## Failure behaviour

| Trigger | Proposed transport/strategy result | What the user sees |
| --- | --- | --- |
| Unknown ID, ID from only the other subscription, or excluded Gemini/Jev | 400 `invalid_request_error` before any upstream request; no fallback lane/model | “Model '<id>' is not supported by OpenCode Zen/Go in this Ptah version. Choose a listed model or update Ptah.” Excluded IDs additionally identify unsupported protocol. |
| Missing/non-string model, invalid JSON/object, malformed Messages envelope | 400; existing body-size failure remains 413 (`translation-proxy-base.ts:350`) | A concise invalid-request reason; no unhandled TypeError or misleading internal error. |
| Missing native `anthropic-version` | 400 before native request | A protocol-header error identifying the missing version; implementer verifies SDK supplies it in parity tests. |
| No configured key | Global strategy returns `configured: false` (`api-key.strategy.ts:380`); request-time missing key becomes 401 via existing base (`translation-proxy-base.ts:650`) | “No OpenCode Zen/Go API key configured. Add one in Settings.” |
| Upstream 401 | Auth hook returns false; no refresh, retry or subscription fallback | “OpenCode Zen/Go rejected the API key. Update that subscription's key in Settings > Authentication.” |
| Upstream 403 | Preserve HTTP 403 with sanitized `api_error`; no key refresh | “OpenCode Zen/Go denied this request (403). Check access for this subscription and model.” |
| Upstream 429 | Existing `rate_limit_error`, Retry-After and provider-keyed cooldown (`translation-proxy-base.ts:732`) | Product-specific wait/retry message. Zen and Go cooldowns stay separate. |
| Other upstream 4xx, including billing failure | Preserve status, sanitized `api_error`; no automatic resubmission | Product and status, with “Check your subscription/balance, model selection and request.” Raw vendor payloads are not displayed. |
| Upstream 5xx | Preserve status, sanitized `api_error`; no cross-lane retry | Product and status, “The provider could not complete the request. Try again later.” |
| Timeout/network error before response | Existing timeout 504/network communication error; no lane retry (`translation-proxy-base.ts:830`, `:423`) | Timeout or provider-communication failure. |
| Abort/malformed stream after headers | Terminate the stream as failed; native upstream error events relay unchanged; never emit a second JSON response or invented success stop | SDK surfaces interrupted/upstream-error turn; logs identify request and lane. |
| Static model list loads successfully | Display catalog; do not treat listing as successful authentication | “Configured” still means key presence, consistent with existing tile behavior (`auth-config.component.html:104`); inference failure remains actionable. |

The wording above is required proxy/strategy error content. **Assumption:** the host's final chat-error rendering preserves enough of that message to be actionable; verify in extension/Electron/CLI smoke tests rather than claiming a particular toast/component already renders it.

## Architecture-level quality requirements

- Functional: exactly two provider identities, 66 Zen routes and 31 Go routes; correct three-lane routing in both stream modes; no unknown/excluded ID forwarded; per-product defaults all exist in the table.
- Performance: one local hop per call, constant-time route lookup; no extra model-discovery/auth-validation call per inference; native SSE remains backpressure-aware. Keep existing 600-second upstream timeout (`translation-proxy-base.ts:145`).
- Security: keys scoped by immutable provider identity; no cross-product fallback; incoming local placeholder never forwarded; static HTTPS destinations; no raw secret/body logging; no new unsafe casts or suppression directives.
- Maintainability: use package aliases/barrels across libraries; shared contains only types/constants/pure functions; existing base owns lifecycle; one replacement selector with no old hook left behind.
- Testability: localhost fake upstream and mocked secrets exercise routing, stream fidelity, isolation and failures without paid credentials. Real tool-call compatibility remains a separate release validation question because the research explicitly lacks inference evidence (`research-report.md:7`).

## Verification

These are **commands for the implementer**, not commands executed during this design task.

| Piece | Behavioural proof | Verified Nx targets |
| --- | --- | --- |
| Catalog/registry/pricing | Every research row copied once; counts by lane 16/22/28 and 8/18/5; exact case/own-key lookup; both defaults valid; nine exclusions; Go seeding never mutates another provider's price | `@ptah-extension/shared:test`, `:lint`, `:typecheck` (`libs/shared/project.json:19`) |
| Transport/provider runtime | Fake upstream asserts all six base+suffix combinations, Bearer auth, no doubled/dropped v1/go paths; native exact fields/bytes; text + tool-call + usage for translated streaming and non-streaming; unknown IDs create zero requests; 401/403/429/5xx, timeout, truncated stream, concurrent mixed lanes | `@ptah-extension/auth-providers:test`, `:lint`, `:typecheck` (`libs/backend/auth-providers/project.json:27`) |
| Existing-provider regression | Codex still Responses; host-specific forced SSE unchanged; Sakana/OpenRouter/Copilot/custom remain Chat; no direct-path change for Moonshot/Z.AI | Same auth-providers targets; existing base/Sakana tests are verified at `translation-proxy-base.spec.ts:50` and `sakana-translation-proxy.spec.ts:24` |
| Registration | Cache factories resolve each product independently; strategy gets four bindings, tokens are stable Symbol.for values; no constructor network/server side effects | Auth-providers targets plus `@ptah-extension/auth-providers-tokens:typecheck` (`libs/backend/auth-providers-tokens/project.json:18`); do not invent a tokens:test target |
| Workspace/global/CLI | Switch Zen↔Go stops only owned global proxies; pooled requests isolate workspace/product; key rotation replaces pool instance; absent key retains documented fallback; two CLI agents have different keys/ports and cleanup on success/error/cancel | Auth-providers targets plus `@ptah-extension/cli-agent-runtime:test`, `:lint`, `:typecheck` (`libs/backend/cli-agent-runtime/project.json:20`) |
| Model discovery | Exact route-derived list with and without key/offline; injected/persisted unknown IDs cannot expand it; no GET /models; tool-only filtering does not assert unknown support | Auth-providers targets |
| Frontend | Zen/Go labels and key slots distinct; tier IDs preserved; explicit CLI list includes both; mark integration only tested after its real contract is supplied | `@ptah-extension/chat:test`, `:lint`, `:typecheck` (`libs/frontend/chat/project.json:9`); mark prerequisite later uses `@ptah-extension/ui:test`, `:lint`, `:typecheck` (`libs/frontend/ui/project.json:24`) |

Example invocations: `npx nx run @ptah-extension/auth-providers:test --runInBand` and `npx nx run @ptah-extension/shared:typecheck`. Use the same `nx run <project>:<target>` form for the targets in the table. No builds are required to validate the design document.

The CLI regression should follow the existing test that reaches the real spawn boundary and captures SDK env (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-sakana-proxy.spec.ts:13`), not only call private route helpers. For `minimax-m3`, prove that simultaneous Zen and Go requests hit Chat and Messages respectively with different keys; add the same assertions for `minimax-m2.7` and `minimax-m2.5`.

A later authorized, credentialed smoke test must verify each subscription/lane with text, a tool round trip, streaming and non-streaming in supported host runtimes. This plan does not claim those calls succeeded. Mock tests establish Ptah routing and translation, not vendor entitlement/capability.

## Team-leader handoff

- Recommended executors: backend-developer for Catalog, Transport, OpenCode runtime, Registration, Workspace/catalog integration and CLI integration; frontend-developer for Frontend once the mark contract is resolved; senior-tester for the named behavioural seams after implementation. No production work was delegated or performed here.
- Complexity: **HIGH**. Registry data is simple; native streaming through a shared base and three independent auth lifecycles carry the regression risk.
- Dependencies and ordering: Catalog and Transport are independently authorable. OpenCode runtime consumes their agreed signatures. Registration and workspace/CLI integration consume the OpenCode factory. Frontend CLI options depend only on stable provider IDs; provider-mark work depends on missing source/design evidence.
- Parallel-safe work: the file groups in Files are disjoint. Catalog and Transport are independent; CLI integration, Registration and Workspace/catalog integration can be authored independently after contracts settle; Frontend's CLI-form work is independent of transport. Tests attached to a group remain with that group's file owner.
- Files affected: complete settled CREATE/MODIFY inventory is in Files; no REWRITE. The missing mark prerequisite is explicitly not represented as a verified existing file. Its final consumer files must be added to the handoff after that question is answered.
- Verification points: preserve current lane semantics during selector replacement, exact provider+model lookup, pricing subscription guard, separate DI/key identities, public factory barrel export, full SDK-env parity and proxy teardown. Run only the actual project targets listed above during implementation.
- Design completion limits: architecture, tables, core files and test seams are specified; the frontend mark schema and real inference/capability/vendor-price evidence are not verified.

## Open questions

1. **Can the caller supply or restore the intended provider-mark component and `provider-marks.data.ts` contract before frontend implementation?** Yes: add both product IDs to that actual format and complete the frontend file/test inventory. No: a separate small design decision is needed for introducing a mark renderer into the current inline-Lucide UI; this plan does not invent its API.
2. **Can authorized inference/tool-use evidence be supplied before labeling any OpenCode model as tool-capable?** Yes: populate only evidenced capability fields and run the release smoke matrix. No: retain the conservative unknown-metadata projection (`supportsToolUse: false`, no capability allowlist); tool-only lists will exclude these unverified models.
3. **Can a dated Zen per-token pricing table be supplied without changing this task's no-network constraint?** Yes: a follow-up data change can add evidenced Zen rates. No: keep usage billing and omit exact rates; do not represent generic catalog estimates as verified Zen charges.

These questions do not reopen the chosen two-entry architecture. Only question 1 blocks the requested mark touchpoint; questions 2 and 3 have explicit conservative defaults.

