---
id: TASK_2026_236
status: in_review
type: FEATURE
title: >-
  User-defined Anthropic/OpenAI-compatible provider entries, with Requesty and
  TokenRouter shipped as presets on that same path
description: >-
  New LLM gateways (Requesty, TokenRouter, LiteLLM, vLLM, and whatever ships
  next quarter) all differ from OpenRouter by exactly three data points -- base
  URL, key prefix, help link -- yet each one currently costs a code change,
  because ANTHROPIC_PROVIDERS is an `as const` array and AnthropicProviderId is
  a hand-written union. Moonshot and Z.AI already prove the data-only case
  inside the registry, so the gap is not the provider model but the fact that
  users cannot add an entry themselves. This task opens the registry to
  user-defined entries carrying a base URL, an API key, a protocol lane
  (Anthropic-compatible passthrough vs OpenAI-compatible via
  TranslationProxyBase), an optional /v1/models endpoint for live model
  discovery, and per-tier model mappings; then ships Requesty and TokenRouter as
  seeded entries on that same path rather than as bespoke integrations. Three
  hardcoded enumerations block it -- ApiKeyStrategy.proxyProviders, the static
  endpoint in OpenRouterTranslationProxy, and the per-provider key lists in
  file-settings-keys -- and three consequences need a decision before code --
  cost display goes dark without a pricing source, the "no proxies, no Ptah
  servers" auth copy stops being unconditionally true once the user types a
  host, and Save & Test Connection has to actually probe tool-calling or every
  gateway quirk arrives as a Ptah bug. Research phase first; no code until the
  research doc lands.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-12T00:00:00.000Z
updated: 2026-08-12T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
Research output lands in `./research.md`.
