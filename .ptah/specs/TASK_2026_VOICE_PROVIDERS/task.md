---
id: TASK_2026_VOICE_PROVIDERS
status: done
type: FEATURE
title: Abstract the voice stack behind provider ports and add ElevenLabs
depends_on: []
created: '2026-08-09T15:26:27.188Z'
updated: '2026-08-09T15:26:27.211Z'
status_inferred: true
description: >-
  A zero-dep voice-contracts lib (ITextToSpeechProvider /
  ISpeechToTextProvider), local Whisper/Kokoro adapters moved off the Electron
  main thread into a utilityProcess to escape the onnxruntime-node HandleScope
  abort, user-supplied model ids, an ElevenLabs TTS + Scribe STT provider behind
  the user own key, and provider-agnostic voice: RPC with explicit
  no-silent-fallback error surfacing.
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Abstract the voice stack behind provider ports and add ElevenLabs

Full context, plan and discussion live in [./context.md](./context.md).
