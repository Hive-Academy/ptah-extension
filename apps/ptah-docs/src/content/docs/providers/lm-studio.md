---
title: LM Studio
description: Run local models through LM Studio's OpenAI-compatible server.
---

LM Studio runs models on your own machine and serves them over an
OpenAI-compatible HTTP API. Ptah talks to that API through its translation
proxy, so any model you load in LM Studio becomes available in the model picker.

Nothing leaves your machine. There is no API key and no account.

## What you need

- [LM Studio](https://lmstudio.ai) installed.
- At least one model downloaded inside LM Studio.
- LM Studio's **local server** running.

## Setup

1. Open LM Studio and load a model.
2. Start the local server. LM Studio listens on `http://localhost:1234` by default.
3. In Ptah, open **Settings → Providers → LM Studio**.
4. Leave the key field alone. LM Studio needs no credential.
5. Click **Test connection**.

## Models

LM Studio has **no static model list** in Ptah. The catalog is fetched live from
LM Studio's `/v1/models` endpoint, so the picker shows exactly the models you
have loaded — no more, no less.

Load a new model in LM Studio and it appears in Ptah's picker on the next
refresh. Unload one and it disappears.

## Model tiers

Ptah maps three tier words — `opus`, `sonnet`, and `haiku` — onto real model ids
so that "Default (recommended)" resolves to something your endpoint can serve.

LM Studio ships **no tier map**, deliberately. Ptah does not know which of your
local models is the strong one. Instead it derives the mapping from your live
catalog, ranking by context length.

If the derived mapping is wrong for your setup, set the tiers explicitly from the
model picker. An explicit choice always outranks the derived one.

## A different endpoint

To use a non-default port or a remote LM Studio instance, set the base URL:

```bash
ptah provider base-url set http://192.168.1.20:1234/v1 --provider lm-studio
```

Or edit it in **Settings → Providers → LM Studio**.

## Cost

`$0`. Ptah reports zero cost for LM Studio because the inference runs on your
hardware.

## Troubleshooting

**"Connection refused"** — LM Studio's local server is not running. Start it from
the server tab in LM Studio, not just the chat tab.

**The model picker is empty** — Ptah reads the catalog from `/v1/models`. If that
endpoint is unreachable, there is nothing to list. Confirm the server is up and
the base URL matches.

**A 404 on the first message** — the tier word did not resolve to a servable
model. This happens when `/v1/models` is down while inference is up. Pick a model
explicitly instead of leaving it on "Default".

**Slow first token** — a large model on modest hardware is simply slow. Try a
smaller quantization, or shorten your context.

## Related

- [Ollama](/providers/ollama/) — the other local-model path
- [Switching providers](/providers/switching/)
