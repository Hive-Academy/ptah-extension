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
- **Tier derivation** — turning a provider's own live catalogue into opus/sonnet/haiku ids (`model-tier-derivation.ts`). See "Tier derivation" below; it is a real concern of this lib, not an implementation detail of one service.
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
- `src/lib/model-tier-derivation.ts` — `deriveTiersFromCatalog`, the pure catalogue→tier rule (see below). Deliberately **not** in the lib barrel: its callers are all inside this lib and import it relatively, and exporting it would invite a caller that has a catalogue but not this lib's precedence rules.
- `src/lib/di/{tokens,register}.ts` — `AUTH_PROVIDERS_TOKENS` + `registerAuthProvidersServices`

## Tier derivation

`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` is how a tier-shaped value
(`'default'`, `'opus'`, a dated `claude-*` id) becomes an id a non-Anthropic
endpoint can actually serve. `ModelResolver.resolve` reads those three vars and
substitutes nothing else — so **whatever fails to populate them is where the bug
is**, and `resolve` is never where it gets fixed. `resolve` returns `string`
synchronously and is reached from five sync call sites, three of them
session-history reads; it cannot become async and it must not grow a failure
mode (TASK_2026_262 Q2, argued and declined).

### The rule: `deriveTiersFromCatalog` (`src/lib/model-tier-derivation.ts`)

An exported **pure function**: `ProviderModelInfo[]` in, `{opus?, sonnet?,
haiku?}` out. Deterministic, total, no I/O, no clock, no throw. Every string it
returns is `===` an `id` on an entry of the input array, which is what makes
"no invented model ids" true by construction rather than by review. An
unreadable catalogue returns `{}` — never a guess, because a wrong-but-servable
model is worse than a 404 precisely because it is silent.

**Why a module and not a private method on `ProviderModelsService`.** Three
writers need the same rule, and a rule copied is a rule that will diverge. The
function also has no business with the service's I/O, caching, logger or env
mutation — it is arithmetic on an array, and it earns a test surface that needs
none of those. Read the file's docblock before changing the rule; it states the
reasoning so you can disagree with it on purpose.

**Context length is the ordinal key, deliberately, and price is not.** Price is
the more intuitive capability proxy and it is the wrong one: ranking by price
means the top tier gets selected **because it is expensive**, so on a ~200-model
router a user's first message silently goes to whatever the priciest listing
happens to be. Context length cannot make that mistake. Its own failure mode — a
small long-context model out-ranking a large short-context one — is
quality-only and the user reverses it by picking a model. Do not "improve" this
to price without engaging with that.

The nominal pass (a model whose id/name names the tier on a word boundary) runs
first and is what fires for `openrouter` and `requesty` in practice. The ordinal
pass only fills what the nominal pass left. Where fewer than two distinct
context lengths exist there is nothing to rank by, so every unset tier gets one
id rather than a spread invented from the alphabet — that branch is reached by
uniform-metadata catalogues, i.e. local ones, which is a fall-out of the data
and **not** a provider branch. No provider id appears anywhere in the file, and
none may be added.

### FOUR sites populate or read the tier vars — this is the load-bearing fact

Three sites **write** the tier env vars, each with its own copy of the same
precedence chain (`user pick ?? registry defaultTiers ?? live-derived`), and one
**reads** them:

| #   | Site                                                  | Writes into                            | Why it is separate                                                          |
| --- | ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `ProviderModelsService.applyPersistedTiers`           | shared `authEnv` **and** `process.env` | the ambient chat session                                                    |
| 2   | `WorkspaceProviderProfileResolver.applyProviderTiers` | a per-workspace **snapshot** env       | must not disturb the live session, so it cannot use #1                      |
| 3   | `ProviderAuthResolver.buildTierValues`                | a lane / curator **override** env      | `buildLaneEnv` deletes #1's write — see below                               |
| 4   | `ModelResolver.resolve`                               | — reads only                           | sync, shared, no failure channel; deliberately has no derivation of its own |

All three writers go through **one** accessor,
`ProviderModelsService.getLiveDerivedTiers(providerId)`, rather than calling
`deriveTiersFromCatalog` directly. Two things have to agree between them, not
one: the **rule** (which id is opus) and the **source** (in-memory `modelCache`
→ persisted `provider.<id>.modelCatalog`, and **never** `staticModels`, which is
a repo literal frozen at release time). Sharing only the rule would let each
writer pick its own source, and a disagreement there is invisible — both sides
look correct in isolation.

**If you add a fifth site, wire the derivation into it.** A new writer that
stops at `persisted ?? defaults` silently reverts to the original bug on
whatever path it serves, and it will look fine in review because that two-link
chain is what the other three used to say. This is not hypothetical caution:
TASK_2026_262 found writers #2 and #3 only by going to look for them, **one
batch apart** — #2 during planning, #3 only after tracing the lane path by hand
in the batch that was supposed to be a no-op verification. Nothing detects a
missing link automatically; the failure is a 404 from the provider.

### Why a lane needs its own link rather than inheriting the ambient one

`ProviderAuthResolver.buildLaneEnv` **blanks every `ALL_TIER_ENV_KEYS` entry out
of the ambient env by design** — background work must not inherit the chat
provider's tier mapping, or a lane pinned to a different provider gets ids that
provider cannot serve. The blanking assigns `undefined`, never `delete`s,
because the consumer rebuilds the env as `{ ...process.env, ...override }`
(never serialize or normalize a lane env, or the keys re-leak). The consequence
for tiers: **writer #1's value arrives on the lane path only to be deleted**, so
`buildTierValues` layers its own tier values back on top and needs the
live-derived link independently. A fix applied only to the chat path reaches a
lane and is thrown away — which is exactly what happened, and why the lane
mapping was empty for a lane pinned to `openrouter`, `lm-studio` or `requesty`.

Two properties there are deliberate: the derivation is asked for the **resolved**
provider, never the active one (leaking the active one would give an LM Studio
lane OpenRouter's ids), and the write is snapshot-only — a lane must never
mutate global `AuthEnv` or `process.env`.

### What did NOT change

The registry. **3 of the 11 `ANTHROPIC_PROVIDERS` entries still declare no
`defaultTiers` — `openrouter`, `lm-studio`, `requesty` — and that figure is
correct and must not be "fixed".** Each omission is deliberate and documented,
and adding a tier map to any of them would ship unverified ids as defaults. What
TASK_2026_262 changed is the fallback **below** `defaultTiers`, never
`defaultTiers` itself. The set is pinned, derived from the registry, in
`auth/model-resolver.spec.ts`.

`requesty-provider-entry.ts:19-23` says tiers "come from the live model list
instead". That sentence was **aspirational until TASK_2026_262 and is now
implemented** — it describes `deriveTiersFromCatalog` and the three writers
above. Read it as a spec that is met, not as a TODO.

### Precedence, and the one thing that violates it

`user pick ?? registry defaultTiers ?? live-derived`, in exactly that order, at
all three writers. A user's pick is a choice and a registry map is a verified
statement by whoever added the entry; a heuristic over a live list outranks
neither. The derivation is consulted **lazily**, so a provider whose static data
covers all three tiers never reads a catalogue.

**Known violation, not introduced here**: `ProviderModelsService.autoResolveDefaultTiers`
runs a claude-only version of the nominal pass and persists the result through
`setModelTier` — i.e. into the **user-choice slot**, the top of the chain. That
conflates "we guessed this" with "the user chose this", and the guess then
outranks a `defaultTiers` map the registry might gain later. It also writes tier
env vars for whichever provider was fetched with no activeness guard. Deleting
it in favour of the read-time rule is the recommended fix — a value that is
never persisted can be re-derived when the catalogue changes, whereas a
persisted guess is permanent.

### Freshness

The catalogue read is **synchronous** on every resolution path — in-memory cache,
then persisted catalogue, never the network. `applyPersistedTiers` fires a
fire-and-forget refresh when a tier is still unset, which fetches, persists, and
re-applies. Failures are swallowed and logged; a refresh must never throw or
block a resolution path, and `tierRefreshInFlight` bounds it to one per
activation so a re-application cannot schedule a refresh of its own.

Residual, accepted and recorded rather than fixed: a message sent inside the
refresh window, or a local server whose `/v1/models` is down while inference is
up, still sends the tier word verbatim and gets a provider 404.
`ModelResolver.warnUnservableTierValue` is kept **deliberately un-narrowed** as
the only signal for that window — narrowing it hides the measurement anyone
re-opening the error-channel question would need. Nothing retries on a timer, by
design; the next provider activation retries.

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
