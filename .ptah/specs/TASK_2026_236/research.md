# Research — TASK_2026_236: User-defined provider entries + Requesty/TokenRouter presets

## Executive summary

Feasible, and cheaper than context.md estimated. The registry insertion point
(`getAnthropicProvider`) is real, but the feared typing blast radius is not —
`AnthropicProviderId` is used almost nowhere as a type constraint (3 hits
total in the whole repo, 2 of them the definition itself). The **actual**
biggest risk is a hard runtime wall context.md never mentions: `auth-rpc.schema.ts:41`
builds a `z.enum(ANTHROPIC_PROVIDERS.map(p => p.id))` at module load, so
`auth:saveSettings` rejects any provider id outside the static registry today,
unconditionally — before any typing question even matters. The second-biggest
risk is that **7 call sites enumerate `ANTHROPIC_PROVIDERS` directly** (not
through `getAnthropicProvider`) to build lists (tile grids, key-status scans,
did-you-mean suggestions); every one needs to switch to a new merged-list
accessor, or user-defined entries will silently not appear in some surfaces
while working in others. Requesty lands in **lane 1** (Anthropic-compatible,
`requiresProxy: false`) — confirmed from `docs.requesty.ai`, not inferred.
TokenRouter's exact REST shape (base URL, `/v1/models`, model-slug format) is
**not verifiable from primary docs** — treat every claim about it as
provisional pending a live account.

## Vendor findings table

| Vendor          | Anthropic-compat lane                                                                                                                                                                            | OpenAI-compat lane                                                                                                                                                                                                                                                          | Key prefix                                                                                                        | Tool calling                                                                                                                                   | Cost per response                                                                                                   | Source                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requesty**    | Yes — `ANTHROPIC_BASE_URL=https://router.requesty.ai`, Bearer via `ANTHROPIC_AUTH_TOKEN`, preserves `ANTHROPIC_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` (native Messages passthrough, not translated) | Yes — `https://router.requesty.ai/v1` (EU: `https://router.eu.requesty.ai/v1`), drop-in OpenAI SDK base URL, `provider/model` slugs (e.g. `anthropic/claude-sonnet-4-5-20250514`)                                                                                           | Inconsistent across docs — blog shows `rqy_...`, quickstart example shows `sk-...`. **Do not hardcode a prefix.** | Not documented on the pages fetched (OpenAI-compat claims "all OpenAI SDK features" incl. function calling, but no explicit confirmation seen) | **Yes, on the OpenAI-compat lane**: `usage.cost` (USD) returned on every non-streaming response per quickstart docs | [docs.requesty.ai/integrations/claude-code](https://docs.requesty.ai/integrations/claude-code), [docs.requesty.ai/quickstart](https://docs.requesty.ai/quickstart)                                                   |
| **TokenRouter** | Not found in any primary doc                                                                                                                                                                     | Claimed OpenAI-compatible; Python SDK (`docs.tokenrouter.io`) shows `client.responses.create(model="gpt-4o:quality", ...)` — a **`model:policy` slug**, not `vendor/model`. Whether a raw REST `/v1/chat/completions` + `/v1/models` exists behind this SDK is unconfirmed. | `tr_...` confirmed from SDK docs                                                                                  | Not confirmed                                                                                                                                  | Not confirmed                                                                                                       | See "Could not verify" below                                                                                                                                                                                         |
| **LiteLLM**     | Yes — native `/anthropic/v1/messages` passthrough (lane 1 fit)                                                                                                                                   | Yes — `/v1/chat/completions` (lane 2 fit)                                                                                                                                                                                                                                   | User-defined (self-hosted proxy, admin sets the virtual key)                                                      | Documented                                                                                                                                     | Proxy has its own cost-tracking; not the same shape as Requesty's per-response field                                | [docs.litellm.ai/docs/pass_through/anthropic_completion](https://docs.litellm.ai/docs/pass_through/anthropic_completion), [docs.litellm.ai/docs/anthropic_unified/](https://docs.litellm.ai/docs/anthropic_unified/) |
| **vLLM**        | No — OpenAI-compat only                                                                                                                                                                          | Yes — `/v1/chat/completions`, requires `--enable-auto-tool-choice --tool-call-parser <parser>` for tool calling to work at all                                                                                                                                              | N/A (self-hosted, no key by default)                                                                              | Conditional on server flags, not universal                                                                                                     | No                                                                                                                  | [docs.vllm.ai/en/stable/serving/integrations/claude_code/](https://docs.vllm.ai/en/stable/serving/integrations/claude_code/)                                                                                         |

Both LiteLLM and vLLM fit the existing two-lane taxonomy cleanly — no new lane
needed. vLLM is meaningfully riskier as a "Save & Test Connection" target
because tool-calling is opt-in server config, not a given.

## Verified seam inventory

Context.md's four seams, verified, corrected, and extended with two seams it
missed entirely.

**Seam 1 — `getAnthropicProvider(id)` is the by-id chokepoint.** Confirmed
correct: `libs/shared/src/lib/providers/provider-registry.ts:476`. ~30
call sites across `auth-providers`, `agent-sdk`, `rpc-handlers`,
`cli-agent-runtime`, `memory-curator-ui` all resolve through this one
function. Making it merge-aware (registry + user-defined map) fixes all of
them in one change. **Blast radius: small, one function.**

**Seam 1b — NOT in context.md: `ANTHROPIC_PROVIDERS` (the array) is
independently enumerated at 7 call sites that bypass `getAnthropicProvider`
entirely.** These build "list all providers" views and will NOT see
user-defined entries even after Seam 1 is fixed, because they never call
`getAnthropicProvider`:

- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.schema.ts:41` — **hard
  blocker**, see Seam 5 below.
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:230` —
  scans every registry id for `hasProviderKey` inside `auth:getAuthStatus`.
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:237` —
  `availableProviders = ANTHROPIC_PROVIDERS.map(...)`, the read model that
  populates the webview/TUI tile grid via `auth:getAuthStatus`. **This is the
  actual UI insertion point**, not the tile template (see Surface checklist).
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:748` —
  `auth:getApiKeyStatus`, same pattern.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:169` —
  `getActiveProviderId()` reverse-matches an active `ANTHROPIC_BASE_URL` back
  to a provider id by scanning every registry entry's hostname. Degrades
  gracefully (returns `null`) if a custom entry isn't in the scanned set —
  not a hard blocker, but breaks the "model identity" system-prompt injection
  for custom-provider sessions if left unfixed.
- `apps/ptah-cli/src/cli/commands/auth.ts:881` — `validIds` for `ptah auth
set-anthropic-route`'s did-you-mean suggestion list. Self-heals once the
  merged accessor is used.
- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/curator-model-picker.component.ts:135` —
  separate surface (memory curator's judge-model picker), same pattern.

**Recommendation**: introduce one new accessor, e.g. `getAllAnthropicProviders(): AnthropicProvider[]`
(returns `[...ANTHROPIC_PROVIDERS, ...userDefinedEntries]`), and grep-replace
every direct `ANTHROPIC_PROVIDERS` iteration above to call it instead. That
becomes the second chokepoint, symmetric with `getAnthropicProvider(id)`.

**Seam 2 — `ApiKeyStrategy.proxyProviders` hardcodes OpenRouter + Sakana.**
Confirmed at `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:68-85`.
Correct as described: a `ReadonlyArray<{providerId, proxy, placeholder}>`
built from two DI-injected proxy instances. The gating check just above it
(`:99`, `getAnthropicProvider(providerId)?.requiresProxy === true`) is
**already** registry-driven — only the proxy _instance_ resolution is
hardcoded. A custom OpenAI-compat entry needs a proxy instance constructed
per-id at runtime (not two DI singletons), which is a different shape than
today's array — this is real implementation work, not just a data change.
**Blast radius: one class, `configureProxyProvider`/`stopProxyIfRunning`.**

**Seam 3 — `OpenRouterTranslationProxy`'s endpoint is a module const.**
Confirmed at `libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-translation-proxy.ts:30`.
`TranslationProxyBase` (`libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:61-99`)
is **already** fully base-URL/header-driven: subclasses implement
`getApiEndpoint()`, `getHeaders()`, `onAuthFailure()`, `getStaticModels()`,
plus a `TranslationProxyConfig` (`name`, `modelPrefix`, `completionsPath`,
optional `responsesPath`). A generic `CustomOpenAiTranslationProxy` that
takes `{baseUrl, apiKey}` at construction time and implements those four
methods trivially is a small subclass — maybe 40 lines. OpenRouter's ranking
headers (`OpenRouterAuthService.getHeaders()`,
`libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-auth.service.ts:64-81`)
are just two extra static headers merged into the Bearer header — this
pattern survives as an optional override, confirmed. Sakana was not
inspected in depth but follows the same subclass shape
(`providers/sakana/sakana-translation-proxy.ts`). **Blast radius: one new
generic subclass + wiring it into the (rebuilt) Seam 2 proxy-instance
resolution.**

**Seam 4 — `file-settings-keys.ts` enumerations.** Partially wrong in
context.md — two of the four key families described there are **already
regex-based, not enumerated**:

- `provider.<id>.baseUrl` — already generic via
  `PROVIDER_BASE_URL_PATTERN = /^provider\.[a-z0-9-]+\.baseUrl$/`
  (`libs/backend/platform-core/src/file-settings-keys.ts:350`). Works for any
  id today, custom or not.
- `provider.<id>.(mainAgent|cliAgent).modelTier.(sonnet|opus|haiku)` —
  already generic via `PROVIDER_SCOPED_TIER_PATTERN` (`:360-361`). Also
  works today.

What is genuinely still enumerated, confirming context.md:

- `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` (`:26-37`) — 9 hardcoded auth-key
  strings (`thirdParty.openrouter`, `thirdParty.moonshot`, …), which drives
  the `provider.<authKey>.selectedModel` / `.reasoningEffort` file-routing
  set built at `:180-183`. A custom entry's `thirdParty.<custom-id>` key is
  NOT in this list, so those two settings silently fail to persist (the
  documented failure mode of this file — `vscode.workspace.getConfiguration`
  has no schema for it and the write is dropped with no error).
- The **unscoped** `provider.<id>.modelTier.*` entries at `:73-97` and their
  defaults at `:225-249` — legacy/unscoped tier keys, still enumerated per
  provider (the scoped ones at `:360-361` superseded these but they were not
  removed).
- `libs/backend/settings-core/src/schema/provider-schema.ts:17-28` —
  `KNOWN_PROVIDER_AUTH_KEYS`, the sibling list that MUST (per its own
  comment) stay in lockstep with `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` because
  `settings-core` cannot import `platform-core`'s list (circular dep). A
  custom-provider fix touches **both** lists or they drift.

**Seam 5 — NOT in context.md, hard runtime blocker: the Zod enum at
`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.schema.ts:41`.**

```ts
anthropicProviderId: z
  .enum(ANTHROPIC_PROVIDERS.map((p) => p.id) as [string, ...string[]])
  .optional(),
```

This is evaluated **once, at module load**, from the static array. Every
`auth:saveSettings` call with a provider id outside the static 8 ids is
rejected at the RPC boundary with a Zod error, regardless of what
`getAnthropicProvider()` does. This is the single change that most directly
gates "can a user actually select a custom provider id" — fixing Seam 1
without fixing this does nothing observable. Fix: either drop the `.enum()`
for a `.string().min(1)` + a runtime lookup against the merged provider list
inside the handler (matches how `llm:setProviderBaseUrl` already validates
inline, see below), or rebuild the enum dynamically per-request instead of
at module load.

## The open-set typing problem — smaller than feared

`AnthropicProviderId` (the hand-written union at `provider-registry.ts:452-462`)
has exactly **3** references in the entire repo:

1. Its own definition.
2. `export const DEFAULT_PROVIDER_ID: AnthropicProviderId = 'openrouter'` —
   an annotation on a still-valid literal; needs zero change.
3. A type-only re-export in `libs/backend/agent-sdk/src/index.ts:155`.

No exhaustive `switch`, no `assertNever`, no `Record<AnthropicProviderId, ...>`
map exists anywhere (searched explicitly). The `AnthropicProvider` interface
itself already types `id: string` (`:67`), not the union — the union is
purely decorative on top of an already-open shape. Two unrelated `ProviderId`
types exist elsewhere (`libs/shared/src/lib/types/ai-provider.types.ts:12`,
scoped to CLI-agent health tracking — `'claude-cli' | 'vscode-lm' | 'ptah-cli'`;
`libs/backend/voice-providers/.../voice-secret-store.ts:21`, voice providers)
— **neither is in this feature's blast radius**, do not touch them.

Every UI classification function inspected is already data-driven, not
enum-switched, and needs no change for custom ids:

- `apps/ptah-tui/src/components/settings/provider-form.ts:62-84` —
  `resolveProviderFormKind` is an if/else chain over `provider.authType` /
  `provider.isLocal` / `provider.supportsOptionalApiKey` flags, falling
  through to `'api-key'` for anything unrecognized. A custom entry with
  `authType: 'apiKey'` classifies correctly with zero changes.
- `libs/frontend/chat/src/lib/settings/auth/auth-config.component.html:42-76` —
  the tile grid is `@for (provider of authState.availableProviders(); ...)`,
  already dynamic. The icon `@if` chain falls through to a generic globe icon
  (`:74-75`) for any unrecognized id. **The "fixed grid of eleven tiles" framing
  in context.md is about the data source being fixed (8 registry entries + 3
  synthetic), not the template being hardcoded** — the template already
  renders whatever `availableProviders()` contains.
- `apps/ptah-cli/src/cli/commands/provider.ts` — `provider?: string` (not
  typed to the union), `ProviderTier = 'sonnet' | 'opus' | 'haiku' | string`
  (already open), `base-url set <provider> <url>` already accepts arbitrary
  provider ids server-side.
- `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:149-156` —
  `LlmProviderName` is already `string` with an explicit comment: `// Allow
future providers without type updates`.

**Options for `AnthropicProviderId` itself**, ranked:

1. **(Recommended)** Leave it as-is for the 8 seeded/built-in ids, keep using
   plain `string` everywhere a provider id crosses a boundary (which is
   already the case almost everywhere). It documents the built-in set for
   IDE autocomplete without constraining anything at runtime. Zero
   migration cost — nothing depends on it being closed today.
2. Widen it to `AnthropicProviderId | (string & {})` (the TS "open string
   union" idiom) to keep autocomplete for built-ins while accepting
   arbitrary strings. Marginal benefit over option 1 given how little the
   type is actually consumed; adds a mildly confusing type to a codebase
   that otherwise favors plain `string` for provider ids everywhere else
   (`getAnthropicProvider(id: string)`, `LlmProviderName = string`).
3. Delete the type entirely, keep only `DEFAULT_PROVIDER_ID: string`. Loses
   the (currently unused) documentation value of option 1 for no gain.

Recommendation: **Option 1.** The type is not the risk; Seam 1b and Seam 5
are.

## Storage shape recommendation

User-defined entries persist in `~/.ptah/settings.json` (via
`PtahFileSettingsManager`), NOT in the `settings-core` schema tree — they
need a genuinely dynamic, id-keyed collection, which `settings-core`'s
`defineSetting()` pattern (one static key per setting) isn't built for.
`file-settings-keys.ts` already has the precedent: an explicit `Set` of
known keys plus regex escape hatches for dynamic id-suffixed keys
(`PROVIDER_BASE_URL_PATTERN`, `PROVIDER_SCOPED_TIER_PATTERN`). Extend that
same escape-hatch style with one more entry, a single JSON blob rather than
N more per-field regexes:

```json
{
  "provider.custom.entries": [
    {
      "id": "custom-requesty-eu",
      "name": "Requesty (EU)",
      "baseUrl": "https://router.eu.requesty.ai",
      "lane": "anthropic",
      "authEnvVar": "ANTHROPIC_AUTH_TOKEN",
      "keyPrefix": "",
      "helpUrl": "https://app.requesty.ai/api-keys",
      "modelsEndpoint": null,
      "defaultTiers": {
        "sonnet": "anthropic/claude-sonnet-4-5-20250514",
        "opus": "anthropic/claude-opus-4-6",
        "haiku": "anthropic/claude-haiku-4-5"
      },
      "pricing": null,
      "createdAt": "2026-08-12T00:00:00.000Z"
    },
    {
      "id": "my-vllm-box",
      "name": "My vLLM Box",
      "baseUrl": "http://192.168.1.50:8000",
      "lane": "openai",
      "authEnvVar": "ANTHROPIC_AUTH_TOKEN",
      "keyPrefix": "",
      "helpUrl": "",
      "modelsEndpoint": "http://192.168.1.50:8000/v1/models",
      "defaultTiers": null,
      "pricing": null,
      "createdAt": "2026-08-12T00:05:00.000Z"
    }
  ]
}
```

Field mapping to the existing `AnthropicProvider` interface
(`provider-registry.ts:65-144`): `lane: 'anthropic'` → `requiresProxy: false`;
`lane: 'openai'` → `requiresProxy: true`. This is the radio the context.md
already called for — store it as an explicit enum, never re-derive it from
the URL shape.

**API key storage**: reuse `AuthSecretsService.getProviderKey(providerId)` /
`setProviderKey` unchanged (`libs/backend/vscode-core/src/services/auth-secrets.service.ts:256-302`).
It's already `providerId: string`-keyed against VS Code `SecretStorage` at
`ptah.auth.provider.<providerId>` — a custom entry's id (e.g.
`custom-requesty-eu`) slots in with zero new code. **Never put the key in
`provider.custom.entries`** — that JSON blob is non-secret metadata only,
same separation the registry already enforces for the 8 built-ins (registry
entries carry no secrets; keys live exclusively in `SecretStorage`).

`getAnthropicProvider()` becomes: look up the static `ANTHROPIC_PROVIDERS`
array first, then fall back to a merge of `provider.custom.entries` (read
once at auth-manager construction / config-change, not per call — this file
is read synchronously off disk on every `ConfigManager.get()` per its
existing contract, so cache appropriately). `getAllAnthropicProviders()`
(the new Seam 1b accessor) returns the concatenation.

## Surface checklist

- **Webview (`libs/frontend/chat/.../settings/auth/`)**: tile grid needs
  zero template change (already data-driven, confirmed above). Needs: (1) an
  "Add custom provider" tile/button that opens a new form component (lane
  radio, base URL, optional `/v1/models` URL, help URL, key input, tier
  mapping); (2) an edit/delete affordance for existing custom entries
  (built-ins have neither and shouldn't gain them); (3) `AuthStateService`
  (`libs/frontend/core/src/lib/services/auth-state.service.ts`) needs CRUD
  methods backed by new RPC calls, not just the read-only
  `_availableProviders` signal it has today.
- **TUI (`apps/ptah-tui/src/components/settings/provider-form.ts` +
  whatever renders the tile list)**: `resolveProviderFormKind` needs no
  change (confirmed above); the tile-list source is the same
  `auth:getAuthStatus` response as the webview, so Seam 1b fixes both at
  once. Needs its own "add custom provider" flow — Ink form UX distinct from
  the webview's, not shared code.
- **CLI (`apps/ptah-cli/src/cli/commands/provider.ts` /
  `auth.ts`)**: least work of any surface — `provider?: string` and
  `ProviderTier = ... | string` are already open, and `base-url set` already
  accepts arbitrary ids. Needs new sub-commands to CRUD the
  `provider.custom.entries` blob (e.g. `provider custom add/remove/list`)
  wired to new RPC methods; `auth.ts:881`'s did-you-mean `validIds` list
  self-heals once it sources from the merged accessor (Seam 1b fix).
- **RPC contracts** (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts` +
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts:40-55`
  `ALLOWED_METHOD_PREFIXES`): **no new namespace needed** — `provider:` and
  `llm:` prefixes already exist and are allowlisted
  (`rpc-handler.ts:46`, `:54`). New methods like `provider:addCustomEntry`,
  `provider:updateCustomEntry`, `provider:removeCustomEntry`,
  `provider:listCustomEntries` register under the existing `provider:`
  prefix with zero runtime-guard change — only the compile-time
  `RpcMethodName` union in `rpc.types.ts` needs the four new literals. The
  dual-registration rule from `CLAUDE.md` only bites if a genuinely new
  prefix is introduced, which this feature does not require.

## Open decisions for the user

1. **Pricing for custom entries — show "unavailable" or accept manual
   per-1M rates in the form?**
   `OpenRouterPricingService` (`libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts`)
   is fetched, parsed, and keyed entirely around OpenRouter's specific
   `/v1/models` response shape (`pricing.prompt`, `pricing.completion`,
   `pricing.input_cache_read`, `pricing.input_cache_write` — all
   OpenRouter-specific field names) — it cannot be pointed at an arbitrary
   `modelsEndpoint` and "just work" generically, because there is no
   standard for how a `/v1/models` response encodes pricing (Requesty's
   OpenAI-compat lane returns cost only in the **completion response**
   `usage.cost` field, not from `/v1/models` at all — a structurally
   different mechanism the pricing service doesn't touch). **Recommended
   default: show "cost unavailable" for custom entries** by default, with an
   optional per-1M input/output price pair in the add-entry form
   (`pricing: null` in the storage shape above) that the user can fill in
   manually to unlock cost display — same shape as the existing
   `staticModels[].inputCostPerToken` fields Moonshot/Z.AI already use.
2. **Security copy — does the "no proxies, no Ptah servers" line need a
   conditional variant?**
   Recommended default: yes — render a distinct line on the custom-entry
   card only ("Requests go directly from this machine to `<host>` — Ptah
   does not operate, vet, or log traffic through this endpoint"), leave the
   unconditional copy on the 8 built-in tiles untouched, since every one of
   those base URLs ships in Ptah's own code today and the audit claim is
   still true for them.
3. **"Save & Test Connection" depth for custom entries — probe or trust?**
   Concrete finding, not a guess: **today's `auth:testConnection`
   (`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:444-501`)
   does not make a network call to the provider at all.** It polls
   `sdkAdapter.getHealth()` (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:397-399`),
   which reflects local SDK-adapter initialization state, not a verified
   round-trip to the remote endpoint. This is already a latent gap for the 8
   built-in providers (a wrong API key or unreachable host doesn't fail
   "Save & Test" until the first real chat turn) — it becomes actively
   dangerous once the base URL itself is user-typed and could be a typo, an
   unreachable LAN host, or (worst case) something that isn't an LLM gateway
   at all. Recommended default: for custom entries specifically, "Save &
   Test" should perform one real tool-call round-trip (a single-token
   request with a trivial tool definition) through whichever lane the entry
   declares, timing out at ~10s, because a `/v1/models` GET alone does not
   prove tool-calling works and tool-calling is the one thing every agent
   turn depends on. Cost: one cheap token exchange per test click, borne by
   the user's own key.
4. **Scheme/loopback validation for the base URL — what already exists?**
   Confirmed: `llm:setProviderBaseUrl`
   (`libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts:685-720`)
   already validates the URL is parseable and restricts the scheme to
   `http:`/`https:`. It does **not** restrict host (any hostname or IP,
   loopback or not, is accepted), does not follow-and-check redirects, and
   is not SSRF-hardened. The CLI's `provider base-url set` path
   (`apps/ptah-cli/src/cli/commands/provider.ts:214-217`) does even less —
   just a non-empty trim, no scheme check at all (validation happens
   server-side in the RPC handler, not client-side in the CLI command).
   Recommended default: reuse the existing scheme check as-is (already
   correctly permissive for local gateways over `http://`), add no
   loopback-only restriction (local vLLM/LiteLLM boxes are a stated use
   case and are not necessarily on `127.0.0.1` — LAN IPs are normal), and do
   not attempt redirect-chain validation for v1 — flag it as a known gap
   rather than building SSRF protection speculatively.

## Could not verify

- **TokenRouter's actual REST API shape.** `docs.tokenrouter.io`'s Python
  SDK shows a `client.responses.create(model="gpt-4o:quality", ...)`
  call — a `model:policy` slug format, not the `vendor/model` OpenRouter-style
  format context.md assumed. Whether a raw `GET /v1/models` /
  `POST /v1/chat/completions` REST surface exists underneath this SDK
  (as opposed to a proprietary `/responses` abstraction) is unconfirmed.
  `www.tokenrouter.com/docs/` returned HTTP 403 to automated fetch (bot
  protection) on every path tried, including the dedicated
  "Management API Documentation" and "Feature Guide" pages. There also
  appear to be **three distinct domains** (`tokenrouter.com`,
  `tokenrouter.io`, `tokenrouter.me`) referencing what may or may not be the
  same product — this needs a human with a live account to resolve before
  the preset ships, not another automated search pass.
- Requesty's tool-calling and prompt-caching field support — the fetched
  pages assert "all OpenAI SDK features" for the OpenAI-compat lane but
  never explicitly confirm function calling or cache-control fields in a
  worked example.
- Requesty's actual key prefix — two Requesty-owned pages disagree (`rqy_`
  in a blog post vs `sk-` in the quickstart example). Do not encode a
  `keyPrefix` for the Requesty preset; leave it `''` like Moonshot/Z.AI.
- Whether Sakana's proxy subclass (`providers/sakana/sakana-translation-proxy.ts`)
  has any config beyond what OpenRouter's does — not read in this pass;
  worth a direct read before generalizing Seam 3, since the research task
  named it explicitly as a "must survive as a subclass" case.
