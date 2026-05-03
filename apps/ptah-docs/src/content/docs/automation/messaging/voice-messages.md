---
title: Voice Messages
description: Send audio, get transcribed text into the agent.
---

# Voice Messages

When `gateway.voice.enabled = true` (the default), inbound voice notes and audio attachments are decoded with ffmpeg, transcribed by [`nodejs-whisper`](https://github.com/ChetanXpro/nodejs-whisper), and the transcript is sent to the agent as if you'd typed it.

## Pipeline

```text
Inbound audio attachment
        ↓
ffmpeg              → decode to 16kHz mono WAV
        ↓
nodejs-whisper      → local ASR transcription (no network)
        ↓
Transcript          → forwarded to the agent like a normal text message
```

## Why ffmpeg?

Telegram, Discord, and Slack deliver voice messages as compressed audio (Telegram uses OGG/Opus; Discord and Slack vary). Whisper needs a 16 kHz mono PCM WAV. ffmpeg does the conversion in one shot — resample, downmix, container swap.

## Requirements

- **ffmpeg** ships bundled with the Ptah desktop app via the [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) npm package — no separate install, no `PATH` setup. The pinned binary is platform-specific (Windows / macOS / Linux) and is selected automatically by `electron-builder` at packaging time.
- **whisper** model files are downloaded on first run by `nodejs-whisper` and cached locally under the user data directory.

:::note[Developers running from source]
When running `nx serve ptah-electron` from a fresh checkout, `npm install` pulls `ffmpeg-static` automatically. No manual ffmpeg install required.
:::

## Fallback

If the bundled ffmpeg binary is missing (corrupted install) or whisper fails to load, the gateway replies with a short "voice message ignored" notice on the same chat thread and drops the audio. It does **not** silently fail — you'll see the platform reply.

## Disabling

Set `gateway.voice.enabled = false` in **Settings → Messaging** to ignore audio attachments entirely. Text messages continue to work.

:::tip
For long voice memos, there's no length cap baked into the gateway — the bottleneck is whatever Whisper handles on your hardware. Expect a few seconds of latency per minute of audio on a modern laptop.
:::
