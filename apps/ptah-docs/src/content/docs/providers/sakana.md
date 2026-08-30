---
title: Sakana (Fugu)
description: Sakana AI's Fugu models, reached through Ptah's translation proxy.
---

[Sakana AI](https://sakana.ai) serves its **Fugu** model family over an
OpenAI-compatible API. Ptah converts between the Anthropic Messages protocol and
OpenAI Chat Completions with a local translation proxy, so Fugu behaves like any
other provider in the model picker.

## What you need

An API key from [console.sakana.ai/api-keys](https://console.sakana.ai/api-keys).

## Setup

1. Open **Settings → Providers → Sakana (Fugu)**.
2. Paste your API key.
3. Click **Test connection**.

Or from the CLI:

```bash
ptah provider set-key --provider sakana --key <your-key>
ptah provider default set sakana
```

The key is stored in the operating system's secure credential store.

## Models

| Model          | Role                      | Context |
| -------------- | ------------------------- | ------- |
| **Fugu**       | Default routing model.    | 200K    |
| **Fugu Ultra** | Highest-capability model. | 200K    |

Both support tool use.

Ptah also fetches the live catalog from Sakana's `/v1/models` endpoint, so dated
aliases such as `fugu-ultra-20260615` appear in the picker as Sakana publishes
them. The two models above are the offline fallback and the source of the
tool-use metadata that the OpenAI-style `/v1/models` response omits.

## Model tiers

Sakana ships a verified tier map:

| Tier     | Model        |
| -------- | ------------ |
| `opus`   | `fugu-ultra` |
| `sonnet` | `fugu`       |
| `haiku`  | `fugu`       |

Fugu ids do not name a tier, so this explicit map is what makes "Default
(recommended)" resolve correctly. You can override any slot from the model
picker, or from the CLI:

```bash
ptah provider tier set --tier opus --model fugu-ultra
```

## Cost

Sakana does not publish pricing, so Ptah ships **no cost data** for Fugu models.
The cost bar reports zero rather than guessing. Check your Sakana console for
actual spend.

## Troubleshooting

**"Unauthorized"** — the key is wrong or revoked. Regenerate it in the Sakana
console and re-paste it.

**Tool calls behave oddly** — Sakana runs behind a translation proxy, so tool
calls cross a protocol boundary. If a tool result looks malformed, report it with
the [execution tree](/chat/execution-tree/) attached.

**The cost bar reads $0** — that is expected. Sakana's pricing is unpublished, so
Ptah records no rates for it.

## Related

- [Providers overview](/providers/)
- [Cost and tokens](/chat/cost-and-tokens/)
