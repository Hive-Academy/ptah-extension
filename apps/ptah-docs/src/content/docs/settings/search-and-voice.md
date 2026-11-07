---
title: Search & Voice
description: Choose the voice engines, and allow go vet for a workspace.
---

The **Search & Voice** tab of **Settings** has three sections: web search, **Voice engines**, and **Diagnostics: go vet**.

## Open the tab

1. Open **Settings**.
2. Click the **Search & Voice** tab.

## Web search

The web search section sets the search providers, their API keys, and the number of results. For the steps, see [Web search](/providers/web-search/).

## Voice engines

**Voice engines** sets the speech-to-text and text-to-speech engines. The chat microphone and the voice notes of the messaging gateway use these engines. Local engines run offline. Cloud engines need an API key.

The table has one row for each direction:

| Column | What it shows |
| ------ | ------------- |
| **Direction** | **Speech-to-text** or **Text-to-speech** |
| **Provider** | The engine for that direction: **Local** or **ElevenLabs** |
| **Model / Voice** | The model or the voice that the engine uses |
| **Status** | **Ready**, **Not downloaded**, or **No key** |
| **Details** | Opens the **Voice engines** drawer for that direction |

### Change the provider

1. Click the provider in the row.
2. Select a provider from the list.

The change saves when you select it. A provider that is not available shows the reason, for example **Unavailable: not available on this machine**.

### Local speech-to-text

The local speech-to-text engine uses a Whisper model. Curated models download to `~/.ptah/models/` on first use.

In the drawer, select the **Source** of the model:

- **Curated**: select a model from the **Whisper model** list. The default is `base.en`. The list includes models from `tiny` (fastest) to `large-v3-turbo` (most accurate).
- **HF repo id**: type the ID of a Hugging Face model, then click **Save**.
- **Local folder**: type the path of a model folder, then click **Save**.

Click **Download** to download the model. The drawer shows **Downloaded** or **Not downloaded**.

### Local text-to-speech

The local text-to-speech engine uses a Kokoro voice to read replies aloud. It runs locally. The model is about 80 MB and downloads to `~/.ptah/models/` on first use.

In the drawer, select a **Voice**. Click **Preview** to hear it. Click **Download** to download the model.

### ElevenLabs

ElevenLabs is a cloud engine. To use it, save an API key first:

1. Open the **Voice engines** drawer.
2. In **ElevenLabs (cloud)**, type the **API key**.
3. Click **Test connection**.
4. When the test passes, click **Save**.
5. In the **Voice engines** table, select **ElevenLabs** as the provider.

PtahCode stores the key encrypted on your computer. The key itself is never shown. Click **Clear key** to remove it.

For text-to-speech with ElevenLabs, select a **Voice** from the list, or type a voice ID and click **Use voice ID**.

## Diagnostics: go vet

This section controls whether the diagnostics tools of PtahCode can run `go vet` in the open workspace.

When it is on, the diagnostics tools run your installed Go toolchain (`go vet`) on the Go packages that they check. `go vet` reads the module source and the module cache, and writes the build cache. It does not run `go:generate`, tests, build scripts, custom vet tools, downloaded toolchains, network fetches, git, or C compilers.

:::caution
This consent is not a sandbox. It allows `go vet` to run in this folder only.
:::

The section shows:

| Row | What it shows |
| --- | ------------- |
| **Workspace** | The folder of the open workspace |
| **Go binary** | The Go binary that PtahCode found, or **none found on PATH** |
| **Allow `go vet` in this workspace** | The switch and its state: **On**, **Off**, or **Out of date** |

### Allow go vet

1. Open the workspace folder.
2. In **Diagnostics: go vet**, turn on **Allow `go vet` in this workspace**.
3. Read the folder path in the confirmation.
4. Click **Allow go vet**.

### When consent ends

Consent ends when the workspace folder moves, when it is replaced, or when the Go toolchain changes. The state then shows **Out of date**, and `go vet` does not run. To use it again, turn the switch on again.

## Related

- [Settings](/settings/)
- [Web search](/providers/web-search/)
