---
title: Web search
description: Ground conversations with live web results from Tavily, Serper, or Exa.
sidebar:
  order: 9
---

# Web search

Ptah gives agents the `ptah_web_search` tool, so they can use live web results. You can configure Tavily, Serper, and Exa. Ptah queries all selected providers in parallel and merges their results.

## What you need

An API key for each provider that you want to use:

- **Tavily** — [tavily.com](https://tavily.com/)
- **Serper** — [serper.dev](https://serper.dev/) (Google Search API)
- **Exa** — [exa.ai](https://exa.ai/)

## Configure

1. Open **Settings → Search & Voice**.
2. Select one or more providers. At least one provider must stay selected.
3. Paste the API key of each selected provider.
4. Test the providers.

Ptah stores each key in encrypted storage as `ptah.webSearch.apiKey.<provider>`.

### Settings keys

- `ptah.webSearch.providers` (`string[]`) — the selected providers, for example `["tavily", "serper"]`. Ptah also reads the older single value `ptah.webSearch.provider`.
- `ptah.webSearch.maxResults` (`number`, default `5`) — the maximum number of merged results.

## How a search works

- **In parallel** — Ptah queries every selected provider at the same time.
- **Isolated failures** — if one provider fails, the results of the others are still returned. The search fails only when every selected provider fails.
- **Status for each provider** — each search reports the duration, the result count, and the failure reason of each provider: `missing-api-key`, `timeout`, or `provider-error`.
- **Merged results** — results are merged and duplicate URLs are removed. A URL that more than one provider returned shows all of its sources.
- **Override for one call** — the tool accepts an optional `providers` argument, for example `["serper"]`. An agent can use it to retry with only the providers that worked.

## Verify that it works

1. Open a chat.
2. Ask the agent to search the web for a recent topic.
3. In the [Execution Tree](/chat/execution-tree/), find the `ptah_web_search` tool call with its status for each provider.

## Troubleshooting

- **`missing-api-key`** — add the key in **Settings → Search & Voice**.
- **`timeout`** — the provider did not answer in time. Results from other providers are still returned.
- **`provider-error`** — the key is wrong or revoked, or the quota is used. Examine the provider dashboard.
- **The tool is not used** — tell the agent to search the web.
- **TLS or proxy errors** — on a network with TLS inspection, add your CA certificate to the system trust store.
