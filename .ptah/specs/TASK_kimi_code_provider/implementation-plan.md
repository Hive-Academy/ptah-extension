# Implementation Plan - TASK_kimi_code_provider

Replace the `moonshot` (Kimi Platform, pay-as-you-go) registry provider with one
`kimi-code` (Kimi Code subscription) registry provider. The harness stays the
Claude Agent SDK runtime (base URL + key). There is no shim, no alias and no data
migration.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\kimi-code-provider`
(branch `refactor/kimi-code-provider`). All paths below are relative to it.

## Inputs and constraints

- Requirements used: the spawner's prompt (decisions the user already made, the
  Kimi Code facts and the audit list). This folder has no `context.md` or
  `task-description.md`. The prompt carries every technical decision, so nothing
  is blocked.
- Corrections applied: none.
- Design handoff used: none (no visual change; the brand mark is reused, see D6).
- Missing decision-critical input: the live Kimi Code behaviour in three places
  (thinking, effort and adaptive-thinking acceptance, `[1m]` handling, the key
  prefix). These are recorded as assumptions A-1..A-4 with the check that
  resolves each one. None of them blocks implementation.
- Repository rules that apply: `CLAUDE.md` (scoped verification only, Electron
  first, keep every host compiling, never run build/serve/e2e).

## Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| D1 | `kimi-code` is an `entries/` file (`KIMI_CODE_PROVIDER_ENTRY`) in moonshot's array slot. It is not an inline literal. | inline literal / entry file | Newer providers use entry files: `libs/shared/src/lib/providers/entries/opencode-provider-entry.ts:130-147`, imported at `provider-registry.ts:24-37` | yes |
| D2 | Static models only. No `modelsEndpoint`. | keep `https://api.kimi.ai/coding/v1/models` / static | The dynamic fetch sends `Authorization: Bearer` (`provider-models.service.ts:539-548`), but Kimi Code authenticates with `x-api-key`. An endpoint that does not exist 404s on every refresh. It does fall back (`:390-398`), but it adds latency and log noise. A dynamic list would also replace the static `capabilities` (D4), because `mergeStaticMetadata` does not copy them (`:597-620`). OpenCode Go is the static-only precedent (`opencode-provider-entry.ts:20-21`). | yes |
| D3 | `pricingModel: 'subscription'`. No cost fields on any static model. | $0 cost fields / no cost fields | `seedStaticModelPricing` skips subscription providers and models without costs (`provider-registry.ts:872-882`). `findModelPricing` returns `null`, and the cost then renders as unavailable instead of a fake amount (`pricing.utils.ts:221-240`, `:404-410`). OpenCode Go uses the same shape (`opencode-provider-entry.ts:79-80`, `:144`). Seeding $0 is rejected because it would pin the bare id at zero for every provider (`provider-registry.ts:115-126`). | yes |
| D4 | Effort and thinking are declared through `ANTHROPIC_DEFAULT_<TIER>_MODEL_SUPPORTED_CAPABILITIES`, taken from a new `capabilities` field on `ProviderStaticModel`. | rely on runtime defaults / declare capabilities | The pinned CLI (`@anthropic-ai/claude-agent-sdk-win32-x64` `claude.exe`, SDK 0.3.278) gates effort per model in `V_(model)`. It reads the capability env override first (`lce(e,"effort")`, which matches `ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL` against the model id). Otherwise it falls to a family heuristic, and that heuristic does not recognise non-Claude ids. Ptah writes the capability var only from a LIVE catalog (`provider-models.service.ts:1060-1083`), so static-only providers (moonshot, z-ai) never send it today, and effort is silently dropped for them. This is the provider/model effort gate the prompt asked about. | yes |
| D5 | Default tiers: opus `k3.1-pro`, sonnet `k3`, haiku `kimi-for-coding`. These are the proposed defaults, kept. | as proposed / all `kimi-for-coding` | Every Ptah internal one-shot runs on the haiku tier (`commit-message-generator.service.ts:46`). The pinned CLI sends `thinking: false` on side queries for any model it does not flag `rejects_disabled_thinking` (`une()`/`z7e()` in `claude.exe`), and env cannot set that flag. So haiku must be a model that accepts thinking-off. That rules out `k3.1-pro`, and `kimi-for-coding` fits. Sonnet (the "Default" route) on `k3` degrades to K2.8 instead of returning 400. Opus is `k3.1-pro`, which is safe for main-loop turns, where thinking is on. Lowest-plan (Andante) users must remap opus and sonnet to `kimi-for-coding`. The model descriptions name the plan gate. | yes |
| D6 | Reuse the vendored Moonshot mark: `PROVIDER_BRAND_SLUGS['kimi-code'] = 'moonshot'`. Remove the `moonshot` provider-id key. | new Kimi art / reuse | The art key is the vendor (Moonshot AI makes Kimi). It is already vendored under MIT (`provider-brand-art.vendored.ts:7`, `:138`). New art means a new licence review. | yes |
| D7 | Leave `pricing.utils.ts:550` and `:609` (`moonshot\|zai` prefix regex) unchanged. | delete / keep | These regexes strip model-id namespace prefixes (`moonshot/...`) from catalog ids for display and context lookup. They are not provider routing. Kimi Code ids carry no prefix, so they never touch these regexes. | yes |
| D8 | No change to auto-compaction. | derive window from registry / leave | The brief assumed Ptah derives the compaction window from registry `contextLength`. It does not. The window is the user's `compaction.threshold` or the runtime's own choice (`compaction-config-provider.ts:147-190`, `auto-compact-control.ts:62-69`, class defaults all `null`). Static `contextLength` is deliberately never fed to the window registry (`provider-models.service.ts:233-255`). The runtime's unrecognised-model default (200K, `auto-compact-control.ts:65`) is below every Kimi Code window (≥262144), so it compacts early and never overflows. | yes |
| D9 | Stale `moonshot` data is inert, but must fail closed. Any code that would route an unknown built-in id to the default provider's URL refuses instead. | ignore / guard | See Component 3. Without the guard, a user whose settings still say `anthropicProviderId: "moonshot"` would send the old Moonshot key to OpenRouter's base URL. | yes |
| D10 | No default effort override for kimi-code. | add a per-provider default `high` / keep `medium` | The global default is `reasoningEffort: 'medium'` (`file-settings-keys.ts:319`). Kimi maps medium→high (prompt), which already matches the doc's recommended `high`. A per-provider default field would be a new abstraction for one provider. | yes |
| D11 | CLI `auth use` accepts `kimi-code` only. It gets no `kimi` alias and no `moonshot` alias. | add alias / none | The user ruled out aliases. `zai` is the only existing alias precedent (`auth.ts:758-759`), and nothing requires one here. | yes |
| D12 | `scripts/brand-icons/scanner-tokens.mjs`, `vendor-roster-drift.spec.ts` BANNED_BRANDS, `tools/mcp-bench/.../model-panel.ts` and `tools/hyperframes/...` stay unchanged. | — | These are vendor-name guards or model-vendor labels ("Moonshot" is Kimi's vendor), not provider ids. `scanner-tokens.mjs:34-35` already bans both `moonshot` and `kimi`. | yes |

## Codebase evidence

| Evidence | Location | Architectural implication |
|---|---|---|
| moonshot registry entry, `ANTHROPIC_AUTH_TOKEN`, `modelsEndpoint`, priced static models | `libs/shared/src/lib/providers/provider-registry.ts:197-263` | The block to delete |
| `AnthropicProviderId` union includes `'moonshot'` | `provider-registry.ts:339-352` | Replace with `'kimi-code'` |
| `ProviderAuthEnvVar` already supports `'ANTHROPIC_API_KEY'` ("future providers") | `provider-registry.ts:63-68` | kimi-code is the first built-in api-key-passthrough provider to use it |
| `isBuiltInProviderId` reserves registry ids from custom entries | `provider-registry.ts:394-397`, used at `:736` and `custom-provider-store.ts:265` | `kimi-code` becomes reserved, `moonshot` becomes free |
| `getProviderBaseUrl` falls back to OpenRouter's URL for unknown ids | `provider-registry.ts:819-831` | Root of the stale-id credential misroute (D9) |
| `isSubscriptionCoveredProvider` / `seedStaticModelPricing` | `provider-registry.ts:852-902` | Subscription flag plus no cost fields gives no fake spend |
| ApiKeyStrategy routes every non-proxy, non-anthropic id to `configureProviderApiKey`, which uses `getProviderBaseUrl` + `getProviderAuthEnvVar` + the stored key | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:102-138`, `:543-641`, `:657-661` | kimi-code works with no id branch. An unknown id misroutes. |
| Global path clears all auth vars before configure | `auth-manager.ts:49-53`, `:305-310` | Global env is clean for API_KEY providers |
| Workspace snapshot blanks only `ANTHROPIC_API_KEY`, then sets `authEnvVar` | `workspace-provider-profile-resolver.ts:320-334` | With `authEnvVar = API_KEY`, `ANTHROPIC_AUTH_TOKEN` is left unset |
| Session env is `{...process.env, ...buildTierEnvDefaults, ...effectiveAuthEnv}` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1331-1336` | An unset snapshot key inherits the global provider's `ANTHROPIC_AUTH_TOKEN` (a leak) |
| Lane env strips both auth vars and all tier keys | `provider-auth-resolver.ts:66-71`, `:495-501` | Lanes are already safe |
| Lane `resolve()` routes any unknown id to `resolveThirdPartyApiKey` (base URL fallback) | `provider-auth-resolver.ts:162-186`, `:243-262` | Needs the same fail-closed guard |
| Tier metadata (`_NAME`, `_DESCRIPTION`, `_SUPPORTED_CAPABILITIES`) is written only from the live catalog, and only for the active chat provider | `provider-models.service.ts:1043-1083`, `:777-781` | Static providers never declare capabilities (D4) |
| Workspace snapshot and lane tier builders write `_MODEL` only | `workspace-provider-profile-resolver.ts:484-509`, `provider-auth-resolver.ts:403-432` | Need the capability env too, for parity |
| Ptah CLI agents write `_MODEL` only | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1522-1539`, `:1544-1572` | Need the capability env too |
| `TIER_METADATA_ENV_VAR_MAP` / `ALL_TIER_ENV_KEYS` / `buildTierEnvDefaults` | `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:93-172` | Capability keys already flow into the spawn env and `buildSafeEnv` (`build-safe-env.ts:82-84`) |
| `ModelCapability` union | `libs/shared/src/lib/types/auth-env.types.ts:43-50` | Allowed values for the new static field |
| `ProviderModelInfo.capabilities` already exists | `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:70-78` | Static-to-info mapping can carry it |
| Static fallback mapping drops non-listed fields | `provider-models.service.ts:420-427` | Add `capabilities` |
| Only ollama discovery sets capabilities today | `providers/local/ollama-model-discovery.service.ts:460`, `:693` | Precedent for declaring them |
| Pinned CLI capability override: `wae` lists FABLE/OPUS/SONNET/HAIKU/CUSTOM env pairs. `kae()` matches the model id case-insensitively against `*_MODEL` and returns `caps.includes(cap)` | `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` (SDK 0.3.278) | Exact match on the tier model id is required |
| Pinned CLI thinking default `Nir()`: override, else `!model.includes("claude-3-")` (thinking on for kimi ids). Side-query thinking `une()`: `thinking:false` unless the model "rejects disabled thinking" | same binary | Drives D5 |
| Internal one-shots use the haiku tier | `libs/backend/agent-sdk/src/lib/commit-message/commit-message-generator.service.ts:46` | haiku must accept thinking-off |
| No Ptah code sends `thinking: {type:'disabled'}` or `MAX_THINKING_TOKENS` | `rg` over `libs`/`apps` (only the type at `libs/shared/src/lib/types/ai-provider.types.ts:121-124`; pass-through at `sdk-query-options-builder.ts:1386-1387`) | Ptah needs no fix for thinking-off. The only risk is the runtime's side queries (D5) |
| Draft probe model = live-derived sonnet, else `defaultTiers.sonnet` | `draft-verification.service.ts:601-614` | Connection check runs on `k3` |
| Compaction window not derived from registry | `compaction-config-provider.ts:147-190`; `auto-compact-control.ts:62-69` | D8 |
| Static `contextLength` never fed to the context-window registry | `provider-models.service.ts:233-255` | Context bar shows the runtime-reported window; accepted |
| Pricing lookup strips `[1m]` tags; context lookup does not | `pricing.utils.ts:252-272`, `:320-337`, `:455-457` | `k3.1-pro[1m]` is a distinct exact id |
| `getActiveProviderId` maps base-URL hostname to registry id | `sdk-query-options-builder.ts:183-213` | `api.kimi.ai` is unique, so the identity prompt and subscription flag resolve |
| Identity prompt uses `provider.name` | `sdk-query-options-builder.ts:144-175` | Prompt will say "provided by Kimi Code" |
| `isDirectAnthropic` is base-URL based | `libs/shared/src/lib/utils/auth-env.utils.ts:3-6` | API_KEY does not misclassify kimi-code as direct Anthropic |
| Anthropic-direct model fetcher keys on `!!authEnv.ANTHROPIC_API_KEY` only | `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:438-455`; `sdk-model-service.ts:955-990` | With kimi-code active, listing `anthropic` models would GET `api.kimi.ai/coding//v1/models` with the Kimi key. Guard with `isDirectAnthropic`. |
| Quota probe classifies a non-proxy route with an API key as `direct-key` | `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts:211-218` | Plan usage is out of scope. Recorded as a risk only |
| Built-in auth keys enumerated twice, plus a drift guard | `libs/backend/platform-core/src/file-settings-keys.ts:48-59`; `libs/backend/settings-core/src/schema/provider-schema.ts:30-41`; TC-19 at `settings-core.spec.ts:846-880` | Edit both lists in lockstep |
| Unscoped legacy tier keys plus `null` defaults for moonshot | `file-settings-keys.ts:158-161`, `:362-364` | Replace with kimi-code for parity with z-ai |
| Dynamic patterns already route any id | `file-settings-keys.ts:466`, `:485-486`, `:503-504`, `:514-521` | Stale `provider.moonshot.*` and `provider.thirdParty.moonshot.*` keys still route, so nothing crashes |
| Settings import skips unknown provider ids and all config keys | `libs/backend/agent-sdk/src/lib/settings-import.service.ts:96-118` | An old export containing moonshot imports cleanly |
| `KNOWN_PROVIDER_IDS`, `KNOWN_CONFIG_KEYS` | `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts:16`, `:108-110` | Swap moonshot for kimi-code |
| No zod schema validates the whole settings file. No `.strict()` in settings-core or platform-core | `rg "\.strict\(\)" libs/backend/settings-core/src libs/backend/platform-core/src` → no hits | Stale keys are never rejected |
| `PROVIDER_INFO` key-format table | `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts:57-80`, `:395-400` | Replace the moonshot row |
| `LlmProviderName` union | `rpc-providers.types.ts:326-333` | Replace the member |
| CLI `auth use` plan + help + init priority | `apps/ptah-cli/src/cli/commands/auth.ts:118-126`, `:752-757`, `:802-807`; `apps/ptah-cli/src/cli/router.ts:1097`; `apps/ptah-cli/src/cli/commands/init.ts:75-81` | Swap ids |
| Brand / accent / display-name maps | `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts:74-95`; `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-accent.ts:35`; `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-formatting.ts:130-157` | Swap ids. `providerDisplayName` title-cases unknown ids, so historical `moonshot` rows still read "Moonshot" |
| Settings UI is registry-driven (no provider-id literals in `libs/frontend/chat/src/lib/settings` or `libs/frontend/core/src/lib/services` outside specs, apart from the `'openrouter'` signal seed) | `rg` (`auth-state.service.ts:111`, `:181` only) | kimi-code gets the tier, effort, routing-map, scope-row and reassign-popover UI with no component change. Effort UI offers low..max (`main-agent-reassign-popover.component.ts:21`, `:231-232`) |
| Effort setting key per provider: `provider.<authKey>.reasoningEffort` | `libs/backend/settings-core/src/repositories/reasoning-settings.ts:24-42` | `provider.thirdParty.kimi-code.reasoningEffort` |
| No new DI token, service or RPC method | — | `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts` and surface-composition specs are unaffected |

## Architecture decision

- **Chosen approach:** a pure registry swap. One new `KIMI_CODE_PROVIDER_ENTRY` replaces the moonshot entry. The existing api-key passthrough path carries it unchanged, because `authEnvVar: 'ANTHROPIC_API_KEY'` is already honoured at every env construction site. On top of the swap come three small targeted hardening changes:
  1. The workspace snapshot blanks `ANTHROPIC_AUTH_TOKEN` explicitly.
  2. Unknown built-in ids fail closed in the two credential routers.
  3. Static models can declare `capabilities`, which are published as the tier `_SUPPORTED_CAPABILITIES` env on all four tier-env builders.
- **Rationale:** the registry header itself says "the registry drives all behavior" (`provider-registry.ts:175-181`). The UI, RPC, tier settings, effort settings and routing map are generic over the registry (see evidence). The three hardening changes are required, and each one is grounded:
  - Change 1 prevents leaking another provider's token to Kimi. Moonshot never hit this because it used AUTH_TOKEN.
  - Change 2 prevents sending a stale Moonshot key to OpenRouter.
  - Change 3 is the only way the pinned runtime will send effort to a non-Claude model id.
- **Rejected alternatives:**
  - Keeping `moonshot` as an alias: the user ruled it out.
  - A dynamic `modelsEndpoint`: see D2.
  - Seeding $0 pricing: see D3.
  - Setting `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1`: this is a process-wide flag. It would enable effort for every model in the session, including a mixed lane, and it does not declare thinking, so it is a blunter version of change 3.
  - A per-model `ANTHROPIC_CUSTOM_MODEL_OPTION`: it covers only one non-tier model. That is deferred, see Risks.
  - Changing `getProviderBaseUrl`'s fallback: it has many callers and is out of scope. A local guard is enough.
- **Assumptions:** listed below. Each one is resolved by a live smoke test against Kimi Code with a real subscription key, after the batches land and before merge. A unit test cannot verify any of them.
  - **A-1:** Kimi Code accepts the Claude Code thinking shape `thinking: {type:'enabled', budget_tokens}` together with `output_config.effort` for every listed model. **Check:** one turn each on opus, sonnet and haiku with effort `high` and `max`. Expect no 400.
  - **A-2:** `adaptive_thinking` is deliberately left out of the capability list, so the runtime sends `enabled` thinking. If Kimi documents or accepts `adaptive`, add it later. **Check:** same smoke test.
  - **A-3:** The runtime strips the `[1m]` suffix before the request and treats the window as 1M for `k3.1-pro[1m]`, as Kimi's doc implies by listing that id for Claude Code. **Check:** map opus to `k3.1-pro[1m]`, run one turn, and confirm no 404 or `model-unavailable`. Also confirm the capability match: effort is honoured when the tier env holds the bracketed id.
  - **A-4:** Kimi Code keys have no stable public prefix, so `keyPrefix: ''` is used. A wrong prefix would only log a warning (`api-key.strategy.ts:609-616`). **Check:** inspect a key from the Kimi Code console. If a fixed prefix exists, set `keyPrefix` and `keyPlaceholder`.
  - **A-5:** `kimi-for-coding` accepts `thinking: false`. Kimi's doc names only K3.1 Pro as rejecting it. **Check:** generate a commit message (a haiku-tier internal query) and a session title.
- **Effect on existing code:**
  - Removed: the moonshot registry block, all moonshot ids and keys, and the moonshot doc page.
  - Changed: one AuthEnv blanking line, two fail-closed guards, one shared helper, and capability wiring in four tier builders.
  - Left alone: compaction, pricing regexes, scanner and brand-guard tokens, the plan-usage probe, tribunal, lane routing and the DI graph.

## Component specifications

### 1. Kimi Code registry entry (shared contract)

- **Purpose:** define the single Kimi Code provider and its static model catalog.
- **Responsibilities:**
  - Add `KIMI_CODE_PROVIDER_ENTRY` and the model capability constant.
  - Add the optional `capabilities` field to `ProviderStaticModel`.
  - Add the `getStaticModelCapabilities(providerId, modelId)` lookup.
  - Remove the moonshot entry and union member.
- **Exact entry** (new file `libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts`):
  ```ts
  export const KIMI_CODE_MODEL_CAPABILITIES: readonly ModelCapability[] = [
    'thinking', 'interleaved_thinking', 'effort', 'xhigh_effort', 'max_effort',
  ];
  export const KIMI_CODE_PROVIDER_ENTRY: AnthropicProvider = {
    id: 'kimi-code',
    name: 'Kimi Code',
    baseUrl: 'https://api.kimi.ai/coding/',
    authEnvVar: 'ANTHROPIC_API_KEY',          // x-api-key, per Kimi Code docs
    authType: 'apiKey',
    requiresProxy: false,
    isLocal: false,
    keyPrefix: '',                            // A-4
    helpUrl: 'https://www.kimi.com/code',
    description: 'Kimi Code subscription (K3.1 Pro, K3, Kimi for Coding) via the Anthropic-compatible coding endpoint',
    keyPlaceholder: 'Enter Kimi Code API key...',
    maskedKeyDisplay: '••••••••••••',
    pricingModel: 'subscription',
    defaultTiers: { sonnet: 'k3', opus: 'k3.1-pro', haiku: 'kimi-for-coding' },
    staticModels: [ /* below; NO cost fields */ ],
  };
  ```
- **Static models.** Every model has `supportsToolUse: true` and `capabilities: KIMI_CODE_MODEL_CAPABILITIES`. The description must state the plan gate.

  | id | name | contextLength | description (plan gate) |
  |---|---|---|---|
  | `k3.1-pro` | K3.1 Pro | 262144 | Thinking-only flagship (256K). Plus/Moderato plan or higher |
  | `k3.1-pro[1m]` | K3.1 Pro (1M) | 1048576 | 1M-context K3.1 Pro. Pro/Allegretto plan or higher |
  | `k3.1-pro-highspeed` | K3.1 Pro Highspeed | 1048576 | Low-latency K3.1 Pro. Pro/Allegretto plan or higher |
  | `k3` | K3 | 262144 | K3 (up to 1M on higher plans). Plus plan or higher |
  | `k3-256k` | K3 256K | 262144 | K3 pinned to 256K. Plus plan or higher |
  | `kimi-for-coding` | Kimi for Coding | 1048576 | Available on every plan (Andante+) |
  | `kimi-for-coding-highspeed` | Kimi for Coding Highspeed | 262144 | Low-latency. Pro/Allegretto plan or higher |

- **Verified contracts and entry points:**
  - `AnthropicProvider` fields: `provider-registry.ts:73-173`.
  - `ProviderStaticModel`: `:42-61`. Add `capabilities?: readonly ModelCapability[]`, with a doc comment that repeats the allowlist warning from `rpc-providers.types.ts:70-77`.
  - `ModelCapability`: `auth-env.types.ts:43-50`.
  - `ANTHROPIC_PROVIDERS` array: `:182-333`. Replace the moonshot object (`:197-263`) with `KIMI_CODE_PROVIDER_ENTRY` in the same position.
  - `AnthropicProviderId`: `:339-352`.
  - New export `getStaticModelCapabilities(providerId: string, modelId: string): readonly ModelCapability[] | undefined`. It does an exact, case-insensitive id match on `getAnthropicProvider(providerId)?.staticModels`, the same matching rule the CLI uses.
  - Update the header comment (`:1-18`) and `ProviderAuthEnvVar` doc (`:63-67`), which currently says "future providers".
  - Export the new entry from the shared index only if the other entries are exported there. Assumption: check `libs/shared/src/index.ts` for `OPENCODE_GO_PROVIDER_ENTRY` and mirror it.
- **Dependencies:** shared → nothing new. Imports `type ModelCapability` from `../../types/auth-env.types`, which is the same lib.
- **Integration points:** every consumer of `getAnthropicProvider` and `ANTHROPIC_PROVIDERS` (RPC provider list, tier UI, ApiKeyStrategy, profile resolver, lane resolver, ptah-cli registry, TUI provider form).
- **Failure behaviour:** none at runtime. This is pure data.
- **Quality requirements:**
  - No cost fields.
  - The static list must contain the default tier ids (`k3.1-pro`, `k3`, `kimi-for-coding`).
- **Verification seam:** shared unit specs.
  - A registry spec asserts the kimi-code entry shape: `authEnvVar`, `baseUrl`, `pricingModel`, `defaultTiers`, every default tier present in `staticModels`, no cost field on any model, and no `moonshot` entry.
  - `getStaticModelCapabilities` returns the capability list for `k3` and `K3` (case-insensitive) and `undefined` for an unknown model or provider.
  - `isSubscriptionCoveredProvider('kimi-code') === true`.
  - `seedStaticModelPricing('kimi-code')` leaves `findModelPricing('k3')` null.
- **Files:**
  - CREATE `libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts`
  - MODIFY `libs/shared/src/lib/providers/provider-registry.ts`
  - MODIFY `libs/shared/src/lib/providers/entries/requesty-provider-entry.ts` (comment at :18)
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-providers.types.ts` (`LlmProviderName`, :329)
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-auth.types.ts` (comment :33)
  - MODIFY `libs/shared/src/lib/types/agent-process.types.ts` (comments :409-411)
  - MODIFY `libs/shared/src/lib/types/ptah-cli.types.ts` (comments :5, :18)
  - MODIFY `libs/shared/src/lib/types/auth-strategy.types.ts` (comments :5, :51, :89)
  - MODIFY the shared specs: `auth-strategy.types.spec.ts`, `provider-profile.types.spec.ts`, `utils/auth-env.utils.spec.ts`, `utils/lane-family.spec.ts`, `utils/pricing.utils.spec.ts`. These are mechanical: the id is an opaque sample, so use `'kimi-code'`.
  - CREATE or MODIFY the registry spec under `libs/shared/src/lib/providers/` (whichever spec currently covers `ANTHROPIC_PROVIDERS`; locate it with `ptah_search_files "libs/shared/src/lib/providers/*.spec.ts"`).
  - NOT changed: `libs/shared/src/lib/utils/pricing.utils.ts` (D7).

### 2. Settings key registries (platform-core, settings-core, agent-sdk export)

- **Purpose:** give kimi-code the same file-routed settings slots z-ai has, and drop moonshot's.
- **Responsibilities:**
  - In `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` (`file-settings-keys.ts:48-59`), replace `'thirdParty.moonshot'` with `'thirdParty.kimi-code'`. That yields `provider.thirdParty.kimi-code.selectedModel` and `.reasoningEffort`, with defaults `''` via `:447-452`.
  - In `FILE_BASED_SETTINGS_KEYS` (`:158-161`), replace the three unscoped legacy keys with `provider.kimi-code.modelTier.{opus,sonnet,haiku}`. Replace the matching `null` defaults at `:362-364`.
  - In `KNOWN_PROVIDER_AUTH_KEYS` (`provider-schema.ts:30-41`), replace the entry in lockstep, so the TC-19 drift guard (`settings-core.spec.ts:846-880`) stays green.
  - In `KNOWN_PROVIDER_IDS` (`settings-export.types.ts:16`), use `['openrouter', 'kimi-code', 'z-ai']`. In `KNOWN_CONFIG_KEYS` (`:108-110`), replace the three moonshot tier keys with kimi-code ones.
- **Stale-key handling (the prompt's question):** nothing rejects or crashes on stale keys, so no handling code is needed.
  - Stale `provider.thirdParty.moonshot.*` keys still match `PROVIDER_AUTH_MODEL_PATTERN` (`:503-504`), and `provider.moonshot.<scope>.modelTier.*` keys still match `PROVIDER_SCOPED_TIER_PATTERN` (`:485-486`). Both stay file-routed and inert.
  - Stale unscoped `provider.moonshot.modelTier.*` keys are no longer in the set. Nothing reads them after the registry swap, because the legacy read fallback is per active provider (`provider-models.service.ts:257-266`).
  - No settings validation uses `.strict()`. Import skips unknown provider ids (`settings-import.service.ts:100-105`).
  - The only live hazard is a stale `anthropicProviderId`, `llm.defaultProvider`, `memory.curatorProvider` or `skills.enhancement.provider` value of `moonshot`. Component 3 handles it.
- **Verified contracts:** cited above.
- **Dependencies:** platform-core must not import settings-core. The lists stay duplicated by design (`file-settings-keys.ts:34-37`).
- **Failure behaviour:** not applicable (data).
- **Verification seam:**
  - `file-settings-keys.spec.ts`: `isFileBasedSettingKey('provider.thirdParty.kimi-code.reasoningEffort')` and `isFileBasedSettingKey('provider.kimi-code.modelTier.opus')` are true. Also add a regression test that a stale `provider.thirdParty.moonshot.selectedModel` is still routed, not dropped.
  - TC-19.
  - settings-export and import specs, if they enumerate the ids.
- **Files:**
  - MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`
  - MODIFY `libs/backend/platform-core/src/file-settings-keys.spec.ts`
  - MODIFY `libs/backend/platform-core/src/settings-auth-key.spec.ts` (opaque sample, rename)
  - MODIFY `libs/backend/platform-core/src/provider-key-slots.spec.ts` (opaque sample, rename)
  - MODIFY `libs/backend/settings-core/src/schema/provider-schema.ts`
  - MODIFY `libs/backend/settings-core/src/settings-core.spec.ts` (:1083-1095, opaque sample, rename)
  - MODIFY `libs/backend/settings-core/src/repositories/custom-provider-store.spec.ts` (:262). Registry-coupled: assert `kimi-code` is reserved. Add one test that a custom entry with id `moonshot` is now accepted.
  - MODIFY `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`

### 3. Credential routing hardening (auth-providers)

- **Purpose:** kimi-code's key must reach Kimi through `x-api-key` only. A stale `moonshot` id must never route the old key to another vendor.
- **Responsibilities:**
  1. **Snapshot blanking.** In `WorkspaceProviderProfileResolver.buildDirectThirdPartyProfile`, set both `snapshot.ANTHROPIC_API_KEY = ''` and `snapshot.ANTHROPIC_AUTH_TOKEN = ''` before writing `snapshot[authEnvVar] = providerKey` (`workspace-provider-profile-resolver.ts:330-332`). Reason: the session env spreads `process.env` first (`sdk-query-options-builder.ts:1331-1336`). An unset AUTH_TOKEN would carry the global provider's token, for example OpenRouter's, to `api.kimi.ai` as `Authorization: Bearer`.
  2. **Fail-closed on an unknown id (global path).** In `ApiKeyStrategy.configureProviderApiKey` (`api-key.strategy.ts:543-556`), when `getAnthropicProvider(providerId)` is `undefined`, read no key and set no env. Return `{ configured: false, details: [], errorMessage: \`Provider '${providerId}' is not available in this version of Ptah. Choose a provider in Settings.\` }`. The same guard covers the env-snapshot fallback at `:559-588`.
  3. **Fail-closed on an unknown id (lane path).** In `ProviderAuthResolver.resolveThirdPartyApiKey` (`provider-auth-resolver.ts:243-262`), throw `ProviderAuthError(providerId, …same message…)` before reading the key when `getAnthropicProvider(providerId)` is `undefined`. This covers curator, skills and harness lanes whose stored provider is still `moonshot`.
  4. **Capability env, static fallback (active chat provider).** In `ProviderModelsService.applyTierMetadata` (`provider-models.service.ts:1060-1083`), resolve `model` from the live catalog first. When it is absent, fall back to the static entry from the registry (`name`, `description`, `capabilities`). In the static fallback list (`:420-427`), also map `capabilities: m.capabilities`.
     - Side effect: providers without capabilities (z-ai and others) now also get `_NAME`/`_DESCRIPTION` from their static list when no live catalog exists. That is display metadata only, consistent with the doc comment's intent. `_SUPPORTED_CAPABILITIES` stays unwritten for them because they declare no capabilities.
  5. **Capability env (workspace snapshot and lanes).** After the `_MODEL` writes in `applyProviderTiers` (`workspace-provider-profile-resolver.ts:503-508`) and `buildTierValues` (`provider-auth-resolver.ts:418-423`), add the tier capability env from Component 4's helper. Pass the resolved `{opus, sonnet, haiku}` ids.
  6. Update the comments that name Moonshot: `api-key.strategy.ts:6`, `:12`, `:541`, `:649`; `workspace-provider-profile-resolver.ts:17`, `:271`, `:321`; `provider-models.service.ts:9`, `:52`, `:151-152`, `:1134`.
- **Verified contracts and entry points:**
  - `AuthConfigureResult` with `errorMessage`: `api-key.strategy.ts:593-597` (existing shape).
  - `ProviderAuthError` is already thrown at `provider-auth-resolver.ts:247-252`.
  - `TIER_METADATA_ENV_VAR_MAP`: `sdk-model-service.ts:109-132`.
- **Dependencies:** auth-providers → agent-sdk (already imports `ALL_TIER_ENV_KEYS`, `provider-auth-resolver.ts:8`) and → shared. No new direction.
- **Integration points:** `AuthManager` surfaces `errorMessage` to the UI auth status (existing path). The lane error surfaces through the existing `ProviderAuthError` handling.
- **Failure behaviour:**
  - Unknown id: the user sees "not available … choose a provider". No network call is made and no secret is read.
  - Kimi 401: the existing classification from `draft-verification.service.ts` applies.
- **Quality requirements (security):**
  - No key is ever paired with a base URL from a different provider.
  - No secret appears in logs. Keep the existing `length`-only logging.
- **Verification seam:** `auth-providers` unit specs.
  - `api-key.strategy.spec.ts`:
    - `providerId='kimi-code'` sets `ANTHROPIC_BASE_URL='https://api.kimi.ai/coding/'` and `ANTHROPIC_API_KEY=<key>`, and leaves `ANTHROPIC_AUTH_TOKEN` unset.
    - `providerId='moonshot'` with a stored `moonshot` key returns `configured:false`, sets no `ANTHROPIC_BASE_URL`, and never calls `getProviderKey`. This is the regression test.
  - `workspace-provider-profile-resolver.spec.ts`: a kimi-code snapshot has `ANTHROPIC_AUTH_TOKEN === ''` and the API key set, and its capability env equals the joined list for the opus, sonnet and haiku ids.
  - `provider-auth-resolver.spec.ts`:
    - A lane for `kimi-code` gets `ANTHROPIC_API_KEY`, the kimi base URL and the capability env.
    - A lane for `moonshot` throws `ProviderAuthError` without reading the key.
  - `provider-models.service.spec.ts`: `applyTierMetadata` with no live catalog writes `ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES='thinking,interleaved_thinking,effort,xhigh_effort,max_effort'` for kimi-code, and writes no capability var for z-ai.
- **Files (production):**
  - MODIFY `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts`
  - MODIFY `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts`
  - MODIFY `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts`
  - MODIFY `libs/backend/auth-providers/src/lib/provider-models.service.ts`
- **Files (registry-coupled specs; re-derive against kimi-code values):**
  - `auth/strategies/api-key.strategy.spec.ts`
  - `auth/provider-auth-resolver.spec.ts`
  - `auth/workspace-provider-profile-resolver.spec.ts`
  - `auth/model-resolver.spec.ts`
  - `provider-models.service.spec.ts`
  - `provider-models-cross-provider-contamination.spec.ts`
  - `model-lists.live.spec.ts`
  - `auth/auth-manager.spec.ts`
- **Files (opaque-sample specs; mechanical rename to `kimi-code`, or to `z-ai` where the test asserts `ANTHROPIC_AUTH_TOKEN`):**
  - `auth/draft-verification.service.spec.ts`
  - `auth/workspace-llm-resolver.spec.ts` (asserts AUTH_TOKEN, so use z-ai)
  - `auth/effective-route.spec.ts`
  - `providers/openrouter/openrouter-pricing.service.spec.ts`
  - `quota/provider-owner.resolver.spec.ts`

### 4. Tier capability env helper and comment cleanup (agent-sdk)

- **Purpose:** one function that turns resolved tier ids into the `_SUPPORTED_CAPABILITIES` env, used by every tier-env builder.
- **Responsibilities:**
  - Add `buildStaticTierCapabilityEnv(providerId: string, tiers: Partial<Record<EnvMappedTier, string>>): AuthEnv` in `sdk-model-service.ts`, next to `TIER_METADATA_ENV_VAR_MAP` (`:109-142`).
  - For each tier with a model id, if `getStaticModelCapabilities(providerId, id)` returns a non-empty list, set `TIER_METADATA_ENV_VAR_MAP[tier].capabilities = list.join(',')`. Otherwise leave the key absent. Never write a partial or guessed list (`provider-models.service.ts:1055-1058`).
  - Export it via `libs/backend/agent-sdk/src/lib/helpers/index.ts` and `libs/backend/agent-sdk/src/index.ts`, in the same place `TIER_METADATA_ENV_VAR_MAP` is exported (`helpers/index.ts:219`, `index.ts:311`).
  - Update the comments naming Moonshot: `sdk-model-service.ts:47`, `:148`; `sdk-query-options-builder.ts:128-130`, `:144`, `:1678`.
- **Rationale for a shared helper:** there are four real callers (Components 3.4, 3.5×2 and 5), which meets the "third real use" bar.
- **Dependencies:** agent-sdk → shared (`getStaticModelCapabilities`). The direction already exists.
- **Failure behaviour:** returns `{}` when there is nothing to declare.
- **Verification seam:** a unit spec in `sdk-model-service.spec.ts` (or a new `tier-capability-env.spec.ts` in the same folder):
  - The kimi-code tiers yield three capability keys.
  - An unknown provider or model yields `{}`.
  - The `[1m]` id matches its own static entry exactly.
  - Also confirm that `buildTierEnvDefaults` forwards the keys (`:159-172`).
- **Files:**
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/index.ts`
  - MODIFY `libs/backend/agent-sdk/src/index.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (comments only)
  - Registry-coupled specs: `helpers/model-identity-prompt.spec.ts` (uses the real `getAnthropicProvider('moonshot')` and its three distinct tiers; switch to kimi-code, whose tiers `k3.1-pro`/`k3`/`kimi-for-coding` are also distinct), `helpers/sdk-query-runner.service.spec.ts`, `helpers/sdk-query-options-builder.spec.ts`, `helpers/sdk-query-options-builder.betas.spec.ts`, `sdk-agent-adapter.spec.ts`
  - Opaque-sample specs: `commit-message/commit-message-generator.service.spec.ts`, `curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts`, `helpers/build-safe-env.spec.ts`

### 5. Ptah CLI agent tier env (cli-agent-runtime)

- **Purpose:** Ptah CLI agents (the CLI agent pool and tribunal lanes) on kimi-code get the capability env, the same as the chat session.
- **Responsibilities:** in `PtahCliRegistry.applyTierEnv` (`ptah-cli-registry.ts:1522-1539`), after the `_MODEL` writes, merge `buildStaticTierCapabilityEnv(provider.id, effectiveTiers)` into `authEnv`. The key is already written through `authEnv[getProviderAuthEnvVar(...)]` (`:1568-1569`), so API_KEY works unchanged. `buildAuthEnv` starts from `createEmptyAuthEnv()` and the spawn uses `buildSafeEnv`, so no `process.env` leak is possible here.
- **Verification seam:**
  - `ptah-cli-registry-tiers.spec.ts`: a kimi-code agent config yields API_KEY plus the capability env.
  - The other `ptah-cli-registry-*.spec.ts` files mock `@ptah-extension/agent-sdk` with a local `moonshot` fixture (for example `ptah-cli-registry-capabilities.spec.ts:43-51`, `:70-75`). Rename that fixture to `z-ai`: it keeps `ANTHROPIC_AUTH_TOKEN` semantics, and the mocks must also export `buildStaticTierCapabilityEnv` (return `{}`).
- **Files:**
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
  - MODIFY all 10 `ptah-cli-registry-*.spec.ts` files that mention moonshot
  - MODIFY `cli-agents/agent-process-manager.service.spec.ts` (opaque sample)
  - MODIFY `cli-agents/cli-adapters/cli-adapter.utils.spec.ts` (opaque sample)

### 6. RPC handlers (rpc-handlers)

- **Purpose:** update the key-format table and guard the Anthropic-direct model fetcher.
- **Responsibilities:**
  - In `PROVIDER_INFO` (`llm-rpc-app.handlers.ts:70-74`), replace the moonshot row with `'kimi-code': { displayName: 'Kimi Code', envVar: 'KIMI_CODE_API_KEY', minLength: 10 }` (no `keyPrefix`, A-4).
  - In `registerAnthropicDirectFetcher` (`provider-rpc.handlers.ts:438-455`), compute `hasApiKey = !!this.authEnv.ANTHROPIC_API_KEY && isDirectAnthropic(this.authEnv)`. Without it, a kimi-code session listing `anthropic` models sends the Kimi key to `api.kimi.ai/coding//v1/models`.
  - Update the comments at `provider-rpc.handlers.ts:12`, `:499`, `:580`.
- **Verified contracts:** `isDirectAnthropic` is in `@ptah-extension/shared` (`auth-env.utils.ts:3-6`).
- **Failure behaviour:** the guarded fetcher falls through to SDK `supportedModels()` (`provider-rpc.handlers.ts:427-436`, existing fallback).
- **Verification seam:**
  - `llm-rpc-app.handlers.spec.ts`: `llm:validateApiKeyFormat` for `kimi-code` accepts an 11-character key.
  - `provider-rpc.handlers.spec.ts`: with the kimi-code base URL plus API_KEY, the anthropic fetcher does not call `getApiModels`. This is the regression test.
- **Files:**
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts`
  - Registry-coupled specs: `handlers/provider-rpc.handlers.spec.ts`, `handlers/provider-rpc.schema.spec.ts`, `handlers/provider-rpc.custom-entries.spec.ts`, `utils/custom-provider-probe.spec.ts`
  - Opaque-sample specs (rename): `handlers/llm-rpc-app.handlers.spec.ts`, `handlers/auth-rpc.handlers.check-connection.spec.ts`, `handlers/auth-rpc.handlers.key-hint.spec.ts`, `handlers/connection-check.spec.ts`, `handlers/agent-rpc.handlers.list-rows.spec.ts`, `utils/connection-check-recorder.spec.ts`, `utils/mask-key-hint.spec.ts`, `chat/ptah-cli/chat-ptah-cli.service.spec.ts`, `chat/session/chat-session-provider-profile.spec.ts`, `chat/streaming/chat-stream-broadcaster.service.spec.ts`, `harness/ai/harness-llm-runner.service.spec.ts`, `services/lane-model-listing.adapter.spec.ts`

### 7. Remaining backend libs (opaque samples and comments)

- **Purpose:** remove the rest of the moonshot mentions in backend libs.
- **Files:**
  - MODIFY `libs/backend/vscode-core/src/services/auth-secrets.service.ts` (comment :79)
  - MODIFY `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts`
  - MODIFY `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts`
  - MODIFY `libs/backend/cron-scheduler/src/lib/job-runner.spec.ts`
  - MODIFY `libs/backend/lane-routing/src/lib/ranking/hard-constraints.spec.ts`
  - NOT changed: `libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts` (D12)
- **Verification seam:** each project's tests.

### 8. CLI and TUI apps

- **Purpose:** headless and TUI surfaces accept `kimi-code`.
- **Responsibilities:**
  - `resolveAuthUsePlan` (`auth.ts:752-757`): replace `case 'moonshot'` with `case 'kimi-code'`, using the same plan shape as z-ai (`authMethod:'apiKey', defaultProvider:'kimi-code', anthropicProviderId:null`).
  - Update the doc comment `:124`, the error list `:805` and the router help `router.ts:1097`.
  - `API_KEY_PROVIDER_PRIORITY` (`init.ts:75-81`): replace `'moonshot'` with `'kimi-code'`.
  - README `:78`.
  - TUI `provider-form.ts:40` comment.
- **Verification seam:**
  - `auth.spec`, if one covers `auth use`: `auth use kimi-code` writes the plan, and `auth use moonshot` returns `UsageError`.
  - `provider-form.spec.ts:64`: registry-coupled, because it maps every registry id to a form kind. Replace the `moonshot` row with `'kimi-code': 'api-key'`.
- **Files:**
  - MODIFY `apps/ptah-cli/src/cli/commands/auth.ts`
  - MODIFY `apps/ptah-cli/src/cli/commands/init.ts`
  - MODIFY `apps/ptah-cli/src/cli/router.ts`
  - MODIFY `apps/ptah-cli/README.md`
  - MODIFY `apps/ptah-cli/src/test-utils/agent-sdk-mock.ts` (comment :15, plus its registry mock if it lists moonshot)
  - MODIFY `apps/ptah-cli/src/cli/commands/provider.spec.ts`
  - MODIFY `apps/ptah-cli/src/cli/commands/_string-distance.spec.ts` (opaque sample: keep a typo test, e.g. `suggestClosest('kimi-cod', ['openrouter','kimi-code','z-ai'])`)
  - MODIFY `apps/ptah-tui/src/components/settings/provider-form.ts`
  - MODIFY `apps/ptah-tui/src/components/settings/provider-form.spec.ts`
  - MODIFY `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts` (fixture rename; typecheck only, never run e2e)

### 9. Frontend brand, accent and label maps

- **Purpose:** the kimi-code tile shows the Moonshot vendor mark, an accent and a readable name.
- **Responsibilities:**
  - `PROVIDER_BRAND_SLUGS` (`brand-slugs.ts:88`): replace `moonshot: 'moonshot'` with `'kimi-code': 'moonshot'` (D6). The art entry `provider-brand-art.vendored.ts:138` stays.
  - `PROVIDER_ACCENTS` (`provider-accent.ts:35`): replace with `'kimi-code': '#4f46e5'`, and update the comment at `:10-13`.
  - `PROVIDER_DISPLAY_NAMES` (`usage-formatting.ts:144`): replace with `'kimi-code': 'Kimi Code'`. Historical `moonshot` usage rows still render "Moonshot" through the title-case fallback (`:149-157`).
  - Comment `provider-connection-card.component.ts:138`.
- **Quality requirements:** the mark renders in the Electron provider settings card. A visual check of that card in Electron only is optional.
- **Verification seam:**
  - `brand-slugs.spec.ts:420` asserts `'kimi-code' → 'moonshot'`.
  - The dashboard specs, if they assert the maps.
- **Files:**
  - MODIFY `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts`
  - MODIFY `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.spec.ts`
  - MODIFY `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-accent.ts`
  - MODIFY `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-formatting.ts`
  - MODIFY `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts` (comment)

### 10. Frontend specs and webview e2e harness (opaque samples)

- **Purpose:** the settings, tier, effort and routing UI already have parity because they are registry-driven. Only fixtures change.
- **Responsibilities:**
  - Rename `moonshot` to `kimi-code` in fixtures. Where a fixture lists Kimi model ids (`kimi-k2.x`), use the new static ids (`k3.1-pro`, `k3`, `kimi-for-coding`).
  - Where a fixture declares `authEnvVar`, set `'ANTHROPIC_API_KEY'` and the base URL `https://api.kimi.ai/coding/`.
  - Change the visual capture names (`settings-visual.e2e.spec.ts:47-58`) to `drawer-kimi-code*`, and the card label to `Kimi Code`.
- **Assumption:** the frontend tolerates a persisted active provider id that the providers list no longer contains (a stale `moonshot`). **Check:** in `providers-settings-state.service.spec.ts`, add one test where the persisted id is absent from the list. It must render without throwing and show no active card. If it throws, make the smallest fix in that service and report it.
- **Files (all MODIFY):**
  - Under `libs/frontend/chat/src/lib/`:
    - `services/chat-store/session-stats-aggregator.service.spec.ts`
    - `settings/providers/add-cli-instance-modal.component.spec.ts`
    - `settings/providers/connection-detail-drawer.component.spec.ts`
    - `settings/providers/connection-drawer/connection-kind.spec.ts`
    - `settings/providers/connection-drawer/credentials-tab.component.spec.ts`
    - `settings/providers/connection-drawer/models-tiers-tab.component.spec.ts`
    - `settings/providers/connection-usage.spec.ts`
    - `settings/providers/decision-model-row.view.spec.ts`
    - `settings/providers/provider-connection-card.component.spec.ts`
    - `settings/providers/provider-connection-card.state.spec.ts`
    - `settings/providers/provider-consumer-rows.spec.ts`
    - `settings/providers/providers-settings.component.spec.ts`
    - `settings/providers/routing-map.component.spec.ts`
    - `settings/ptah-ai/cli-matrix-rows.spec.ts`
    - `settings/ptah-ai/orchestration-settings.component.spec.ts`
    - `settings/settings.component.spec.ts`
  - Under `libs/frontend/core/src/lib/services/`:
    - `auth-state.service.spec.ts`
    - `providers-connection-setup.service.spec.ts`
    - `providers-settings-state.service.spec.ts`
  - `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.spec.ts`
  - Under `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/`:
    - `settings.fixtures.ts`
    - `settings-reachability.table.ts`
    - `settings-providers.e2e.spec.ts`
    - `settings-visual.e2e.spec.ts`
    - `settings-cli-matrix.entries.ts`

### 11. Documentation and shipped skill references

- **Purpose:** user-facing docs describe Kimi Code, not the Moonshot Platform.
- **Responsibilities:**
  - Rename `apps/ptah-docs/src/content/docs/providers/moonshot.md` to `kimi-code.md` (`git mv`) and rewrite it with:
    - the subscription model;
    - the console URL `https://www.kimi.com/code`;
    - the base URL;
    - the x-api-key auth;
    - the tier defaults and plan gates;
    - "cost shown as covered by subscription / unavailable";
    - the note that old Moonshot Platform keys do not work and must be replaced;
    - tier keys `provider.kimi-code.mainAgent.modelTier.*`.
  - Update the links and table rows in:
    - `providers/index.md:29`
    - `getting-started/signing-in.md:53`
    - `index.mdx:67`
    - `providers/openrouter.md:62` (keep "Moonshot" there only as a model vendor on OpenRouter, if accurate)
    - `chat/cost-and-tokens.md` (subscription note)
  - Check `apps/ptah-docs/astro.config.mjs` for an explicit sidebar slug `providers/moonshot`. If one exists, update it.
  - In both copies of `ptah-cli-usage/references/auth-and-providers.md:82-89` and `setup.md:138` (in `.claude/skills/...` and `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/...`), change the provider to `kimi-code`. Note that Kimi Code uses `ANTHROPIC_API_KEY` (x-api-key), not `ANTHROPIC_AUTH_TOKEN`. Keep the two copies identical.
  - Update `apps/ptah-video-studio/docs/feature-knowledge-base.md:65` and `apps/ptah-video-studio/scripts/record-tui.mjs:135` (comment).
- **Verification seam:**
  - `rg -i moonshot` over the docs shows only the intended model-vendor mentions.
  - No ptah-docs build is run (CLAUDE.md).
- **Files:** as listed (RENAME plus MODIFY).

## Integration architecture

- **Data flow:**
  1. The user saves the key in the provider setup wizard. It goes to `AuthSecretsService.setProviderKey('kimi-code', key)` (existing) and is stored as secret `ptah.auth.provider.kimi-code`.
  2. The user activates the provider, which sets `anthropicProviderId='kimi-code'`.
  3. `AuthManager` clears the auth vars (`auth-manager.ts:305-310`) and resolves `resolveStrategy('thirdParty', entry)`, which returns `'api-key'` (`auth-strategy.types.ts:65-93`).
  4. `ApiKeyStrategy.configureProviderApiKey` sets `ANTHROPIC_BASE_URL=https://api.kimi.ai/coding/` and `ANTHROPIC_API_KEY=key`.
  5. `switchActiveProvider` → `applyPersistedTiers` → `_MODEL` + `_NAME` + `_DESCRIPTION` + `_SUPPORTED_CAPABILITIES` (static fallback).
  6. The session env is assembled (`sdk-query-options-builder.ts:1331-1336`).
  7. The Claude Agent SDK runtime sends `x-api-key` and its own unchanged User-Agent to Kimi.
- **Effort flow:** the main-agent popover writes `provider.thirdParty.kimi-code.reasoningEffort` → `ReasoningSettings.effort` → `sessionConfig.effort` / `providerProfile.reasoningEffort` → `Options.effort`. The runtime honours it because the tier capability env lists `effort`, `xhigh_effort` and `max_effort`.
- **Workspace-isolated sessions:** a snapshot from `buildDirectThirdPartyProfile` (both auth vars blanked, then API_KEY set) plus the capability env.
- **Lanes:** `buildLaneEnv` (strips both auth vars) plus `resolveThirdPartyApiKey` (API_KEY plus capability env).
- **Ptah CLI agents:** `buildAuthEnv` plus `applyTierEnv` plus `buildSafeEnv`.
- **State or persistence:**
  - The secret lives in platform SecretStorage.
  - Non-secret keys (`provider.kimi-code.<scope>.modelTier.*`, `provider.thirdParty.kimi-code.{selectedModel,reasoningEffort}`, `provider.kimi-code.baseUrl` override) live in `~/.ptah/settings.json`.
  - The old secret `ptah.auth.provider.moonshot` and the old keys stay on disk unread. There is no migration and no deletion.
- **External boundaries:**
  - The only outbound host is `api.kimi.ai` (or a user `provider.kimi-code.baseUrl` override, already validated by `isValidProviderBaseUrl`).
  - No models-list call is made.
  - The User-Agent is untouched. Ptah adds none on this path; the `Ptah-Extension/1.0` UA exists only in `fetchDynamicModels` / OpenCode, which kimi-code never reaches.
- **Failure and rollback:**
  - A stale or unknown id fails closed (Component 3).
  - Kimi 401/403/404/429 use the existing draft-verification classification and the existing cooling-down gate (`provider-auth-resolver.ts`, `assertNotCoolingDown`).
  - A 400 from the thinking-off side query on `k3.1-pro` surfaces as a failed side query, not as a session crash. It is mitigated by D5 and is a known risk.
  - Rollback is a revert of the PR. No data shape changes.
- **Observability:**
  - Existing `[ApiKeyStrategy] Using Kimi Code (routing via …)` and `Set ANTHROPIC_BASE_URL=…, ANTHROPIC_API_KEY=<set>` logs (`api-key.strategy.ts:626-631`).
  - The fail-closed path must log at `warn` with the provider id, never the key.
  - `[Pricing] Model 'k3' not found … unavailable` warns once per id (`pricing.utils.ts:233-238`). That is expected for a subscription provider.

## Architecture-level quality requirements

- **Functional:**
  - The kimi-code tile appears in Settings → Providers with key entry, the Models & tiers tab (three tiers, seven static models), the reasoning-effort control (low..max) and routing-map rows.
  - Activation produces `ANTHROPIC_API_KEY` and never `ANTHROPIC_AUTH_TOKEN`.
  - Every tier has a model, haiku included.
  - The `_SUPPORTED_CAPABILITIES` env is present for each mapped tier on all four builders.
  - `moonshot` no longer appears in any provider list, CLI accepted list or settings key enumeration.
- **Performance:** no added network calls (static catalog).
- **Security:**
  - Stored keys are never sent to a different vendor's base URL.
  - The workspace snapshot never inherits a foreign `ANTHROPIC_AUTH_TOKEN`.
  - The Anthropic-direct fetcher never sends a third-party key.
  - No key appears in logs.
- **Maintainability:**
  - The two auth-key lists stay in lockstep (TC-19).
  - There is one capability helper with four callers.
  - No new DI tokens, RPC methods or project tags.
  - Dependency direction: shared ← agent-sdk ← auth-providers and cli-agent-runtime, unchanged.
- **Testability:** behaviour tests named in each component:
  - entry shape;
  - capability lookup;
  - API_KEY routing;
  - snapshot blanking;
  - fail-closed on `moonshot` (global and lane);
  - capability env on each builder;
  - Anthropic-direct fetcher guard;
  - CLI `auth use kimi-code` and the rejection of `moonshot`;
  - TUI form kind;
  - brand slug.

## Risks

1. **Side-query thinking-off on `k3.1-pro` (medium).** The runtime sends `thinking:false` for side queries on models not flagged as rejecting it, and env cannot set the flag. Any side query that runs on the opus-tier model returns 400. Mitigation: haiku is `kimi-for-coding` (A-5) and the default route is the sonnet tier (`k3`). Document it in `kimi-code.md`.
2. **Effort on non-tier models (low).** The capability env matches only ids held in a tier `_MODEL` var. A concrete model picked outside the three tiers (for example `k3-256k` as the selected main model) falls back to the runtime heuristic, and effort may be dropped. Possible follow-up: `ANTHROPIC_CUSTOM_MODEL_OPTION` (+ `_SUPPORTED_CAPABILITIES`), which the runtime already supports (`wae` list).
3. **FABLE tier unmapped (low).** The runtime knows `ANTHROPIC_DEFAULT_FABLE_MODEL`, but Ptah has three tiers only, and `THIRD_PARTY_SERVABLE_TIERS` hides Fable from the picker (`sdk-model-service.ts:55-60`). This matches every other third-party provider today. Not in scope.
4. **Context bar shows the runtime-reported window (low).** Static `contextLength` is not capacity evidence by design (`provider-models.service.ts:233-255`). The bar may show 200K for a 262K model.
5. **Same effort gap on z-ai and other static providers (pre-existing).** Effort is silently dropped for them today. Fixing it means declaring their capabilities, which is a separate task. Record it in future-enhancements.
6. **Quota probe classifies kimi-code as `direct-key` (pre-existing shape, new trigger).** `session-quota-probe.service.ts:211-218`. Plan usage is out of scope, so no change. Revisit it with the plan-usage tile task.
7. **User custom entry named `kimi-code` (low).** It becomes reserved and is reported as rejected by `setCustomProviderEntries` (`provider-registry.ts:736`). Affected users re-create it under another id.
8. **Orphaned Moonshot secret (accepted).** `ptah.auth.provider.moonshot` stays in SecretStorage, unread. Cleanup would be a separate, user-visible decision.
9. **VSIX scanner (low, unchanged exposure).** The shipped skill reference markdown already contains "Moonshot". Replacing it with "Kimi Code" keeps the same exposure. `scanner-tokens.mjs` already lists `kimi`.

## Team-leader handoff

- **Recommended executors** (work packages are file-disjoint; the team-leader may re-derive the order):

  | WP | Components | Executor | Why |
  |---|---|---|---|
  | WP-1 | 1 (shared registry + types + shared specs) | backend-developer | Contract every other package compiles against |
  | WP-2 | 2 (platform-core, settings-core, settings-export.types) | backend-developer | Settings key lockstep + TC-19 |
  | WP-3 | 4 (agent-sdk helper, exports, comments, agent-sdk specs) | backend-developer | Helper consumed by WP-4 and WP-5 |
  | WP-4 | 3 (auth-providers prod + specs) | backend-developer | Security-relevant routing |
  | WP-5 | 5 (cli-agent-runtime) | backend-developer | Ptah CLI agent env |
  | WP-6 | 6 (rpc-handlers) | backend-developer | Key table + fetcher guard |
  | WP-7 | 7 + 8 (other backend lib specs, ptah-cli, ptah-tui, electron-e2e spec) | backend-developer | App command surfaces |
  | WP-8 | 9 + 10 (frontend ui, dashboard, chat, core, tribunal-panel, e2e harness) | frontend-developer | Angular libs and fixtures |
  | WP-9 | 11 (docs + skill references) | technical-content-writer (or frontend-developer) | User docs |

- **Complexity:** MEDIUM. Most of the 136 files are mechanical renames. Three small security-relevant changes and one cross-lib helper carry the risk.
- **Dependencies and ordering:**
  - WP-1 comes first (the `AnthropicProviderId` union, `ProviderStaticModel.capabilities` and `getStaticModelCapabilities`).
  - WP-3 comes before WP-4 and WP-5, which import `buildStaticTierCapabilityEnv`.
  - WP-2, WP-6, WP-7, WP-8 and WP-9 depend only on WP-1.
- **Parallel-safe work:** after WP-1, WP-2, WP-3, WP-6, WP-7, WP-8 and WP-9 are file-disjoint and can run in parallel. After WP-3, WP-4 and WP-5 can run in parallel. Heavy checks still run one at a time (CLAUDE.md).
- **Files affected:**
  - CREATE:
    - `libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts`
    - optionally a tier-capability spec in `libs/backend/agent-sdk/src/lib/helpers/`
  - RENAME: `apps/ptah-docs/src/content/docs/providers/moonshot.md` → `kimi-code.md`
  - MODIFY: every file listed under Components 1-11.
  - NOT modified (deliberate):
    - `libs/shared/src/lib/utils/pricing.utils.ts`
    - `libs/frontend/ui/src/lib/native/brand-mark/provider-brand-art.vendored.ts`
    - `scripts/brand-icons/scanner-tokens.mjs`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts`
    - `tools/mcp-bench/src/memory-skills/labelling/model-panel.ts`
    - `tools/hyperframes/projects/agent-lanes-explainer/index.html`
    - `e2e-final2.log`
    - the DI guard specs (`container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, surface-composition)
- **Verification points:**
  - Contracts to honour: TC-19 lockstep. `CUSTOM_PROVIDER_ID_PATTERN` (`kimi-code` matches `^[a-z0-9][a-z0-9-]*$`, `provider-registry.ts:384`). Capability allowlist semantics (never write a partial list).
  - Final grep: `rg -i "moonshot" libs apps --glob '!*.log'` returns only D7/D12 exclusions, the brand-art vendor key and vendor-name prose.
  - Scoped commands. Per changed project, one at a time, with `--parallel=1`; for several projects use `npx nx run-many -t test -p A B --parallel=1` and confirm the header count. Never run build, serve, e2e or package.
    - WP-1: `npx nx test @ptah-extension/shared --parallel=1`; `npx nx typecheck @ptah-extension/shared`
    - WP-2: `npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/settings-core --parallel=1`; typecheck the same two
    - WP-3: `npx nx test @ptah-extension/agent-sdk --parallel=1`; `npx nx typecheck @ptah-extension/agent-sdk`
    - WP-4: `npx nx test @ptah-extension/auth-providers --parallel=1`; `npx nx typecheck @ptah-extension/auth-providers`
    - WP-5: `npx nx test @ptah-extension/cli-agent-runtime --parallel=1`; `npx nx typecheck @ptah-extension/cli-agent-runtime`
    - WP-6: `npx nx test @ptah-extension/rpc-handlers --parallel=1`; `npx nx typecheck @ptah-extension/rpc-handlers`
    - WP-7: `npx nx run-many -t test -p @ptah-extension/agent-generation @ptah-extension/cron-scheduler @ptah-extension/lane-routing @ptah-extension/vscode-core ptah-cli ptah-tui --parallel=1`; typecheck the same projects plus `npx nx typecheck ptah-electron-e2e`
    - WP-8: `npx nx run-many -t test -p @ptah-extension/ui @ptah-extension/dashboard @ptah-extension/chat @ptah-extension/core @ptah-extension/tribunal-panel --parallel=1`; typecheck the same projects plus `npx nx typecheck @ptah-extension/webview-e2e-harness` (typecheck only; it has no test target)
    - Host compile gate (shared lib changed): `npx nx typecheck ptah-electron` (priority), then `ptah-extension-vscode`, `ptah-cli` and `ptah-tui`, one at a time. Also `npx nx test ptah-electron --parallel=1` and `npx nx test ptah-extension-vscode --parallel=1`, because both depend on the changed libs.
    - WP-9: no command (no docs build).
  - After merge-ready, and before marking done: the live Kimi Code smoke test in Electron for A-1..A-5. Cover one turn per tier with effort `high` and `max`, a commit-message generation (haiku), the `[1m]` opus mapping, and the connection check.
