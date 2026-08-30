---
title: Requesty
description: Routed multi-model access over a native Anthropic-compatible passthrough.
---

[Requesty](https://requesty.ai) is a router. One key reaches many models across
many vendors, and Requesty picks the upstream.

Requesty is a **passthrough** provider. Its router speaks the native Anthropic
Messages protocol, so Ptah sends requests straight through with no translation
layer in between. That makes it one of the lowest-overhead multi-model paths in
Ptah — unlike OpenRouter and Sakana, which need a local translation proxy.

## What you need

An API key from [app.requesty.ai/api-keys](https://app.requesty.ai/api-keys).

## Setup

1. Open **Settings → Providers → Requesty**.
2. Paste your API key.
3. Click **Test connection**.

Or from the CLI:

```bash
ptah provider set-key --provider requesty --key <your-key>
ptah provider default set requesty
```

The key is stored in the operating system's secure credential store, never in a
settings file.

:::note[No key prefix check]
Ptah does not validate the shape of a Requesty key. Requesty's own documentation
disagrees with itself about the prefix — a blog post shows `rqy_…` while the
quickstart shows `sk-…`. Encoding either would reject half of all real keys, so
Ptah encodes neither and lets the connection test be the judge.
:::

## Models

Requesty has **no static model list** in Ptah. The catalog comes live from
Requesty's `/v1/models` endpoint, so the picker always shows what your account
can actually reach.

## Model tiers

Ptah maps the tier words `opus`, `sonnet`, and `haiku` onto real model ids.

Requesty ships **no tier map**, deliberately. The only model slug in Requesty's
documentation appears on its OpenAI-compatible lane, not on the Anthropic
passthrough lane that Ptah uses. Shipping an unverified id as a default would
silently break every "Default (recommended)" selection.

Instead, Ptah derives the mapping from your live catalog. If that derivation
picks wrong, set the tiers explicitly from the model picker:

```bash
ptah provider tier set --tier opus --model <model-id>
```

An explicit choice always outranks a derived one.

## Cost

Requesty bills you directly. Ptah reports what the router reports.

## Troubleshooting

**A 404 on the first message** — the tier word did not resolve to a servable
model id. Pick a model explicitly rather than leaving it on "Default", or set the
tier map as shown above.

**"Unauthorized"** — the key is wrong or revoked. Regenerate it at
[app.requesty.ai/api-keys](https://app.requesty.ai/api-keys) and re-paste it.

## Related

- [OpenRouter](/providers/openrouter/) — the other multi-model router
- [Switching providers](/providers/switching/)
