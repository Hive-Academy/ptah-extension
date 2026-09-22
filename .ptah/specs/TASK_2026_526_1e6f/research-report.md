# Research — OpenCode Zen and OpenCode Go as Ptah auth providers

Gathered 2026-09-22. Sources: the vendor docs at `https://opencode.ai/docs/zen/`
and `https://opencode.ai/docs/go/`, and a live probe of the opencode 2.0.12
background service on this machine (`GET /api/model`, 103 entries).

Not verified: a real inference request. That needs a paid key, which this
session does not have. Everything below is endpoint shape and routing, not a
successful completion.

## The two subscriptions

| | Zen | Go |
| --- | --- | --- |
| Billing | pay as you go | $10/month subscription |
| Key | `OPENCODE_API_KEY` from the Zen console | separate key from the Go console |
| Base | `https://opencode.ai/zen/v1` | `https://opencode.ai/zen/go/v1` |
| Auth header | `Authorization: Bearer <key>` | same |

They are separate products with separate keys, so they are **two provider
entries**, not one. The path is the only difference in the base URL.

`GET https://opencode.ai/zen/v1/models` answers unauthenticated with a standard
OpenAI list envelope (`{"object":"list","data":[{"id","object","created","owned_by"}]}`),
76 entries. Verified. That is a usable `modelsEndpoint`.

## The routing problem

One key, one console, **four upstream protocols**. A model id alone decides
which. Ptah's `AnthropicProvider` carries a single `baseUrl` and a single
`requiresProxy` flag, so a naive entry cannot express this.

### Zen — `https://opencode.ai/zen/v1`

| Suffix | Protocol | Count | Models |
| --- | --- | --- | --- |
| `/messages` | Anthropic Messages | 16 | claude-fable-5-1, claude-fable-5, claude-opus-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-opus-4-5, claude-sonnet-5, claude-sonnet-4-6, claude-sonnet-4-5, claude-haiku-4-5, qwen3.8-flash, qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.5-plus |
| `/chat/completions` | OpenAI chat | 22 | deepseek-v4.1-flash, deepseek-v4-pro, deepseek-v4-flash, deepseek-v4-flash-vision-exp, minimax-m3, minimax-m2.7, minimax-m2.5, glm-5.3-flash, glm-5.3, glm-5.2, glm-5.1, glm-5, kimi-k2.5, kimi-k2.6, kimi-k2.7-code, kimi-k3, big-pickle, mimo-v2.6-flash-free, mimo-v2.5-free, ling-3.0-flash-fin-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free |
| `/responses` | OpenAI Responses | 28 | gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2, gpt-5.2-codex, gpt-5.1, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5, gpt-5-codex, gpt-5-nano, grok-4.7, grok-4.6, grok-4.5, grok-build-0.1, muse-spark-1.3, muse-spark-1.2, muse-spark-1.3-contributor-free |
| `/models/{id}` | Google generateContent | 7 | gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.1-pro, gemini-3-flash |
| `/systemone` | Jev structured judgment | 2 | jev-1.13, jev-1.13-free |

### Go — `https://opencode.ai/zen/go/v1`

| Suffix | Protocol | Count | Models |
| --- | --- | --- | --- |
| `/messages` | Anthropic Messages | 8 | minimax-m3, minimax-m2.7, minimax-m2.5, qwen3.8-max, qwen3.8-flash, qwen3.7-max, qwen3.7-plus, qwen3.6-plus |
| `/chat/completions` | OpenAI chat | 18 | glm-5.3-flash, glm-5.3, glm-5.2, glm-5.1, kimi-k3, kimi-k2.7-code, kimi-k2.6, longcat-2.0, deepseek-v4.1-flash, deepseek-v4-pro, deepseek-v4-flash, deepseek-v4-flash-vision-exp, mimo-v2.6-flash, mimo-v2.6-pro, mimo-v2.5, mimo-v2.5-pro, hy4-preview, hy3 |
| `/responses` | OpenAI Responses | 5 | grok-4.7, grok-4.6, gpt-5.6-luna, muse-spark-1.3-contributor, muse-spark-1.2-contributor |

**Note the model-id collisions across subscriptions.** `glm-5.3`, `kimi-k3`,
`minimax-m3`, `qwen3.7-max` and `deepseek-v4-pro` exist in BOTH Zen and Go, and
`minimax-*` sits on `/chat/completions` in Zen but on `/messages` in Go. A
routing table keyed on model id alone is therefore wrong — it must be keyed on
`(provider entry, model id)`.

## What Ptah already has

`libs/backend/auth-providers/src/lib/translation/` ships translators for two of
the four protocols, and both are in production use:

- `request-translator.ts` / `response-translator.ts` — Anthropic Messages to
  OpenAI chat completions. Used by OpenRouter and Sakana.
- `responses-request-translator.ts`, `responses-stream-translator.ts`,
  `responses-stream-collector.ts` — Anthropic Messages to OpenAI Responses.
  Used by Codex.
- `translation-proxy-base.ts` — the shared local proxy with `onAuthFailure`,
  `getStaticModels` and header injection hooks.

There is **no Google generateContent translator**, so the 7 Gemini ids are not
reachable without new translation work. `/systemone` is a structured-judgment
API, not a chat protocol, and does not belong behind a Messages-shaped provider
at all.

Closest existing precedent for the shape needed here: `SakanaTranslationProxy`
(118 lines) + `sakana-proxy.factory.ts` (63) + `sakana-auth.service.ts` (68) +
`sakana-provider.types.ts` (38) + `sakana-provider-entry.ts` (89). That is the
whole cost of one `apiKey` + `requiresProxy` provider today — but Sakana speaks
one protocol, and this needs three.

## The question the design must answer

`AnthropicProvider` (`libs/shared/src/lib/providers/provider-registry.ts:69`)
has one `baseUrl` and one boolean `requiresProxy`. Three candidate shapes:

1. **One entry per subscription, proxy routes per model id.** One tile, one key
   slot, one settings row per subscription. The proxy reads the active model
   from the inbound request and picks suffix + translator. Needs a per-entry
   model-to-protocol table, and a decision about what a proxy does with an
   unknown id.
2. **One entry per subscription per protocol.** Six tiles, six key slots for two
   keys. No new abstraction, bad UX, and the tier picker would fragment.
3. **Extend `AnthropicProvider` with an optional protocol map** and let the
   existing proxy factory consume it. Shifts the table into `libs/shared` where
   the model list already lives.

Shape 1 or 3. Picking between them, and deciding where the model-to-protocol
table is maintained (hand-written, or derived from `/zen/v1/models`, which does
NOT report protocol), is the architecture decision this task exists to make.

## Open items for the design

- Where the protocol table lives, and how it stays current as OpenCode adds
  models. `/v1/models` returns ids only — no protocol, no capabilities, no cost.
- What happens on an unknown model id: refuse, or default to one lane.
- Whether `defaultTiers` map to Claude ids on Zen (`claude-opus-5` /
  `claude-sonnet-5` / `claude-haiku-4-5`, all native Messages, no proxy) and to
  the strongest Go ids on Go (`glm-5.3` / `kimi-k3` are chat-completions).
- Pricing. Go is a flat $10/month, so it is a `pricingModel: 'subscription'`
  entry and must stay OUT of the shared pricing map per the rule at
  `provider-registry.ts:113`. Zen is usage-billed and the docs publish rates.
- Gemini and Jev: recommend explicitly excluding both from this task, and say so
  in the entry's description so the gap is visible rather than surprising.
