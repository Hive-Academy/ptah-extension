---
title: Web search
description: Ground conversations with live web results via Tavily, Serper, or Exa.
sidebar:
  order: 9
---

# Web search

Ptah exposes the `ptah_web_search` tool to agents so they can ground answers in live web results. You can configure multiple search providers — Tavily, Serper, or Exa — and Ptah queries all selected providers at once in parallel, merging and de-duplicating their results.

## What you need

API keys for the search providers you wish to use (you can configure one, two, or all three):

- **Tavily** — [tavily.com](https://tavily.com/) (recommended default, generous free tier).
- **Serper** — [serper.dev](https://serper.dev/) (Google-backed results, fast).
- **Exa** — [exa.ai](https://exa.ai/) (neural search, high-quality long-form results).

## Configuration

Configure web search providers from the settings interface:

1. Open **Settings → Web Search**.
2. Select one or more providers using the checkboxes. At least one provider must remain selected.
3. Paste the API key for each enabled provider. Each key is stored in encrypted `safeStorage` under `ptah.webSearch.apiKey.<provider>`.
4. Click **Test** to test all configured providers in parallel.

You can store keys for all three providers at once and enable any combination of them.

### Settings keys & backwards compatibility

- `ptah.webSearch.providers` (`string[]`): The list of enabled provider names (e.g. `["tavily", "serper"]`). If not explicitly set or empty, Ptah falls back to reading the legacy single-string `ptah.webSearch.provider` setting from existing installs, or defaults to `["tavily"]`. No re-configuration is required for existing setups.
- `ptah.webSearch.apiKey.<provider>`: Secret storage key for each provider's credential.
- `ptah.webSearch.maxResults` (`number`): Maximum number of merged results returned to the agent.

## How multi-provider search works

When an agent triggers a web search:

- **Parallel querying**: Ptah queries every selected provider simultaneously in parallel.
- **Failure isolation**: Providers fail independently. If one provider fails (for example, Tavily times out or hits quota limits) while Serper succeeds, the search **succeeds** with Serper's results. Total search failure occurs only if every selected provider fails.
- **Per-provider status reporting**: Every search returns a status breakdown for each selected provider, including duration, result count, and for any failure, the exact failure reason (`missing-api-key`, `timeout`, or `provider-error`) alongside a human-readable message.
- **URL de-duplication & source attribution**: Results from all providers are merged in selection order and de-duplicated by normalized URL (canonicalizing hostnames and stripping fragments and trailing slashes). If a URL is returned by more than one provider, it appears once in the merged list and names every provider that returned it under its sources.
- **Agent re-assessment**: The `ptah_web_search` MCP tool accepts an optional `providers` argument (e.g. `["serper"]`) that temporarily overrides the configured set for a single call. If an agent sees a provider fail in the status breakdown, it can re-assess the search and retry using only the providers that succeeded.

## Verifying it works

1. Open the chat.
2. Ask: `Search the web for the latest Claude Sonnet release notes and summarize the top change.`
3. The agent calls the `ptah_web_search` tool. In the [Execution Tree](/chat/execution-tree/), you'll see a **tool call** node with the per-provider status breakdown, source attribution tags, and the merged result URLs.

## Troubleshooting

- **Provider failure reported in status**:
  - `missing-api-key` — check that the provider's API key is configured in **Settings → Web Search**.
  - `timeout` — upstream provider did not respond within the timeout window. If another provider succeeded, its results are still returned.
  - `provider-error` (`401 Unauthorized` or quota exhaustion) — wrong or revoked key, or exceeded quota. Regenerate the key in the provider's dashboard or check your quota balance.
- **Total search failure** — a search fails completely only when every selected provider fails. Check that at least one provider has a valid key and available quota.
- **Empty results or rate limits on one provider** — Tavily's free tier rate-limits aggressively. Enabling multiple providers (such as Tavily and Serper together) provides automatic redundancy.
- **Tool not used** — models sometimes answer from memory. Tell the model explicitly to use web search, or raise the [effort level](/chat/effort-levels/).
- **SSL / proxy errors** — if you're on a corporate network with SSL inspection, add your CA bundle to the system trust store. Ptah uses the OS trust store on all platforms.

:::tip
Tavily is the default because its tier is forgiving and its results are research-friendly. If you need SERP-style results (featured snippets, related questions), Serper is a better fit. Enabling multiple providers combines their strengths while providing automatic redundancy if one provider encounters rate limits or downtime.
:::
