# Context

## User intent

> "Every now and then a new token router / provider appears — OpenRouter,
> TokenRouter, Requesty — and making an official integration for each one is a
> hassle. Can we allow a provider authentication option similar to OpenRouter,
> but where the user adds the base URL and model tiers via free-input forms?
> Separately, I'd like first-class support for Requesty since it pairs with
> OpenRouter."

The trigger surface is the **Authentication** card in Settings → Providers: a
fixed grid of eleven provider tiles (Claude, OpenRouter, Moonshot, Z.AI,
Copilot, Codex, Ollama, Ollama Cloud, LM Studio, Claude Subscription, Sakana),
each with a key input, a help link, and a global/workspace scope toggle.

## Position taken in discussion

**Custom provider and "first-class Requesty" are the same code path.** Moonshot
and Z.AI are already pure data entries in the registry with zero supporting
code, which proves a new gateway costs a const, not an integration — the gap is
only that the const has to be written by us and shipped in a release. So: open
the registry to user-defined entries first, then ship Requesty and TokenRouter
as *seeded* entries riding that same path. A preset becomes a data decision.

## The lane distinction (must be surfaced in the form)

The registry already encodes two shapes, and a custom provider has to declare
which one it is. This is a radio, never a free-text protocol field.

| Lane | Registry shape | Existing exemplars |
|------|----------------|--------------------|
| Anthropic-compatible | `requiresProxy: false` — set `ANTHROPIC_BASE_URL` + auth token, no local proxy | Moonshot, Z.AI |
| OpenAI-compatible | `requiresProxy: true` — route through `TranslationProxyBase` on 127.0.0.1 | OpenRouter, Sakana |

Preliminary read from a web sweep, to be confirmed by the research phase:

- **TokenRouter** — OpenAI-compatible, exposes `GET /v1/models`, uses
  `vendor/model` slugs. Byte-identical in shape to OpenRouter → lane 2.
- **Requesty** — publishes Claude Code integration docs, which implies an
  Anthropic-compatible route exists → likely lane 1, which is both cheaper and
  higher fidelity (no translation loss). **Not verified.** If Requesty only
  offers OpenAI-compatible, it lands in lane 2 and the preset is trivial either
  way; the lane choice only changes fidelity, not feasibility.

## Code seams found (survey, not a plan)

Most of the machinery is already generic. The blockers are enumerations:

1. `libs/shared/src/lib/providers/provider-registry.ts:153` — `ANTHROPIC_PROVIDERS`
   is `as const`; `AnthropicProviderId` at `:452` is a hand-written union.
   `getAnthropicProvider()` (`:476`) is the single chokepoint every consumer
   funnels through, so merging user-defined entries has one insertion point —
   but the id type stops being closed, which ripples through typing.
2. `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:68` —
   `proxyProviders` is a hardcoded id → proxy-instance array (OpenRouter,
   Sakana). Custom OpenAI-compatible entries need a proxy resolved per-id.
3. `libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-translation-proxy.ts:30` —
   endpoint is a module const. Generalize into a base-URL-driven proxy;
   OpenRouter becomes a subclass that adds its ranking headers.
4. `libs/backend/platform-core/src/file-settings-keys.ts` — `provider.<id>.baseUrl`
   (`:350`) and scoped tiers (`:360`) already route by regex, but
   `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` (`:26`) and the unscoped
   `provider.<id>.modelTier.*` entries (`:80`) are enumerated per provider.
   Without the same regex treatment, custom-provider tier writes are discarded
   silently — no error, no warning (the documented failure mode of this file).

Already generic, no change expected: `authSecrets.getProviderKey(providerId)`
is id-keyed; `defaultTiers` + the model-mapping dialog are provider-agnostic;
`ProviderModelsService` populates the tier dropdowns from `modelsEndpoint`, so
free-text tier entry is the *fallback* for gateways without `/v1/models`, not
the design.

## Three consequences that need a decision before code

- **Cost display goes dark.** `OpenRouterPricingService` is provider-specific. A
  custom endpoint has no pricing source, so session cost silently reads $0.
  Either label it "cost unavailable" or let the form take per-1M input/output
  prices.
- **The auth copy stops being unconditionally true.** "Runs 100% locally — your
  credentials go directly from this machine to the AI provider — no proxies, no
  Ptah servers involved" holds today because every base URL is one we shipped.
  A user-typed host needs its own warning line on the custom card.
- **Compatibility is a promise we cannot keep.** OpenAI-compatible gateways
  diverge on tool-calling, streaming deltas, and cache-token fields. "Save &
  Test Connection" must probe for real (`/v1/models` plus a one-token
  tool-call round-trip), or every gateway quirk arrives as a Ptah bug report.

## Scope note

Research first. No implementation until `./research.md` lands and the lane
assignment for Requesty is confirmed from primary docs.
