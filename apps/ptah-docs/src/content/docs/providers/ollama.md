---
title: Ollama
description: Run local models with Ollama — offline, private, free.
sidebar:
  order: 6
---

# Ollama (local)

Ollama lets you run capable open-weight models locally. Ptah talks to Ollama's HTTP server on your machine, so chat works fully offline and no traffic leaves your network.

## What you need

- [Ollama installed](https://ollama.com/download) on your machine.
- At least one model pulled locally.
- Sufficient VRAM / RAM for the model (a 7B model needs ~8GB, a 70B model needs 48GB+ or quantization).

## Pulling a model

```bash
# Small, fast, good for chat
ollama pull llama3.2

# Strong reasoning
ollama pull qwen2.5-coder:32b

# Anthropic-compatible schema (works best with Ptah)
ollama pull gpt-oss
```

:::tip
Ptah integrates most cleanly with models that speak the **Anthropic-native message schema**. Models that only expose the OpenAI chat-completions schema work, but tool use may be limited.
:::

## Configuration

1. Make sure Ollama is running. Verify with:

   ```bash
   curl http://localhost:11434/api/tags
   ```

2. Open **Settings → Providers → Ollama** in Ptah.
3. Confirm the server URL. The default is `http://localhost:11434`.
4. Click **Refresh models** — Ptah lists every model `ollama list` reports.
5. Pick a default model.

No API key is required for local Ollama.

### Ollama Cloud

If you use Ollama Cloud, switch the provider to **Ollama Cloud** in the same settings pane and paste your Ollama Cloud auth token. The token is stored in encrypted `safeStorage`.

## Verifying it works

1. Open the chat and pick any Ollama model.
2. Send a prompt.
3. You should see streaming output and a **$0 cost** (local inference). In the [Execution Tree](/chat/execution-tree/), the model field should show your local model name.

## Troubleshooting

- **`connection refused`** — Ollama isn't running. Start it with `ollama serve` or from the Ollama tray app.
- **Models list is empty** — run `ollama list` in a terminal. If empty, pull a model with `ollama pull <model>`.
- **`model requires more memory`** — the model is too big for your machine. Try a smaller variant or a quantized tag (`:q4_K_M`).
- **Tool calls are ignored** — the model probably doesn't support tool use. Switch to a model advertised with tool support (e.g. `qwen2.5-coder`, `gpt-oss`).
- **Custom server URL** — if you run Ollama on another machine on your LAN, change the URL in Settings to `http://<host>:11434`.

:::note[Privacy]
Local Ollama is the only provider where your prompts and code never leave your machine. If privacy is a hard requirement, use it as your default provider and restrict sub-agent spawning to `ollama`-only by disabling the others in `agentOrchestration.disabledClis`.
:::
