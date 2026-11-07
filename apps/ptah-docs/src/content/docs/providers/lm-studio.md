---
title: LM Studio
description: Run local models through LM Studio's OpenAI-compatible server.
---

LM Studio runs models on your own machine and serves them over an OpenAI-compatible API. Ptah talks to that API through a translation proxy on your machine. Every model that you load in LM Studio becomes available in the model picker.

Nothing leaves your machine. There is no API key and no account.

## What you need

- [LM Studio](https://lmstudio.ai) installed.
- At least one model downloaded in LM Studio.
- The LM Studio local server running.

## Connect

1. Open LM Studio and load a model.
2. Start the local server. Ptah uses `http://localhost:1234/v1`.
3. In Ptah, open **Settings → Providers**.
4. Click **Connect provider**, then **Connect** next to **LM Studio**. No key is necessary.

To use a different port or a remote LM Studio server, add a [custom endpoint](/providers/#custom-endpoint) on the OpenAI-compatible lane.

## Models

Ptah reads the model list live from the LM Studio `/v1/models` endpoint. The picker shows the models that you loaded.

## Model tiers

LM Studio has no default tier map. Ptah derives the map from your live model list. If the result is wrong, open the connection, select **Models & Tiers**, and set the tiers. Your choice always has priority.

## Cost

Ptah shows a cost of $0, because the model runs on your hardware.

## Troubleshooting

- **"Connection refused"** — the LM Studio local server is not running. Start it in LM Studio.
- **The model picker is empty** — Ptah cannot reach `/v1/models`. Make sure that the server runs.
- **A 404 on the first message** — the tier did not resolve to a loaded model. Select a model in the picker instead of the default.

## Related

- [Ollama](/providers/ollama/) — the other local-model path
