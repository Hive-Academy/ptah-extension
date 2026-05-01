---
title: Web search
description: Ground conversations with live web results via Tavily, Serper, or Exa.
sidebar:
  order: 9
---

# Web search

Ptah exposes a `WebSearch` tool to agents so they can ground answers in live web results. You pick one of three search providers — Tavily, Serper, or Exa — and supply an API key.

## What you need

- An API key from one of:
  - **Tavily** — [tavily.com](https://tavily.com/) (recommended default, generous free tier).
  - **Serper** — [serper.dev](https://serper.dev/) (Google-backed results, fast).
  - **Exa** — [exa.ai](https://exa.ai/) (neural search, high-quality long-form results).

## Configuration

Each provider is configured the same way:

1. Open **Settings → Web Search**.
2. Pick the provider.
3. Paste your API key. It's stored in encrypted `safeStorage` under `ptah.webSearch.apiKey.<provider>`.
4. Click **Test** to run a sample query end-to-end.

You can store keys for multiple providers. Only one is active at a time — change the active provider from the same settings page at any moment.

## Verifying it works

1. Open the chat.
2. Ask: `Search the web for the latest Claude Sonnet release notes and summarize the top change.`
3. The agent should call the `WebSearch` tool. In the [Execution Tree](/chat/execution-tree/), you'll see a **tool call** node with the provider's name and the returned URLs.

## Troubleshooting

- **`401 Unauthorized`** — wrong or revoked key. Regenerate in the provider's dashboard.
- **Empty results on valid queries** — Tavily's free tier rate-limits aggressively. Check the provider dashboard for quota. Serper and Exa have different quotas — switching providers often resolves it.
- **Tool not used** — models sometimes answer from memory. Tell the model explicitly to use web search, or raise the [effort level](/chat/effort-levels/).
- **SSL / proxy errors** — if you're on a corporate network with SSL inspection, add your CA bundle to the system trust store. Ptah uses the OS trust store on all platforms.

:::tip
Tavily is the default because its tier is forgiving and its results are research-friendly. If you need SERP-style results (featured snippets, related questions), Serper is a better fit.
:::
