---
title: Ollama
description: Run local models with Ollama, or cloud models with Ollama Cloud.
sidebar:
  order: 6
---

# Ollama

Ollama runs open-weight models on your own machine. Ptah talks to the Ollama server on your machine, so local models work offline.

## What you need

- [Ollama](https://ollama.com/download) installed and running.
- At least one model pulled, for example `ollama pull <model>`.
- Enough memory for the model.

## Connect

1. Make sure that Ollama runs. Ptah uses `http://127.0.0.1:11434`.
2. Open **Settings → Providers**.
3. Click **Connect provider**, then **Connect** next to **Ollama**. No key is necessary.
4. Select a model in the model picker.

Ptah has a default tier map for Ollama. To change it, open the connection and select **Models & Tiers**.

To use Ollama on another machine, add a [custom endpoint](/providers/#custom-endpoint).

## Ollama Cloud

**Ollama Cloud** is a separate connection in the same list. It runs models on cloud GPUs.

- Paste an ollama.com API key to connect directly to ollama.com. Then you do not need a local Ollama.
- Without a key, requests go through your local Ollama, which must be signed in to ollama.com.

## Verify that it works

1. Open a chat and select an Ollama model.
2. Send a prompt.
3. Make sure that the response streams. Local inference shows a cost of $0.

## Troubleshooting

- **`connection refused`** — Ollama is not running. Start it with `ollama serve` or from the Ollama tray app.
- **The model list is empty** — run `ollama list`. If it is empty, pull a model.
- **`model requires more memory`** — the model is too large for your machine. Use a smaller or quantized model.
- **Tool calls are ignored** — the model does not support tool use. Use a model with tool support.
