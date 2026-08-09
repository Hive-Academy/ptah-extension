# TASK_2026_VOICE_PROVIDERS — Context

## User Intent

Abstract the voice (TTS/STT) stack behind provider ports so users bring their own models/providers instead of the app hard-wiring Kokoro/Whisper, add ElevenLabs (TTS + STT/Scribe) as an enhancement for users with their own subscription, and move local ONNX voice execution off the Electron main thread.

## Origin

Investigation on 2026-07-12 confirmed the Electron app hard-crashes (silent native abort, no JS error) on voice operations: `onnxruntime-node 1.21.0` has a fatal V8 thread-safety bug (`HandleScope` abort — huggingface/transformers.js#1292, microsoft/onnxruntime#24486) triggered when the memory embedder worker thread and main-thread voice pipelines (Whisper/Kokoro) use the ONNX native binding concurrently. Evidence: `%APPDATA%\Ptah\logs\Ptah Electron-2026-07-12.log` — log stops silently at 2026-07-11T21:09:01 after voice model download at 21:06:22. Installed app ships onnxruntime-node 1.21.0 (pinned by @huggingface/transformers 3.8.1). 1.20.1 confirmed unaffected upstream.

## Approved Scope

1. New zero-dep `libs/backend/voice-contracts` lib: `ITextToSpeechProvider` / `ISpeechToTextProvider` ports + capability descriptors (requiresDownload, requiresApiKey, local|cloud), readiness/download-progress event surface.
2. Local provider adapters wrapping existing `WhisperTranscriber` / `KokoroSynthesizer`, with ONNX execution moved OUT of the Electron main thread into an Electron `utilityProcess` (or worker, mirroring the memory embedder `embedder-worker.mjs` pattern). This also isolates/fixes the onnxruntime-node crash. Include onnxruntime-node pin/downgrade to 1.20.1 via package.json overrides as defense-in-depth (must propagate to the electron-builder generated package.json — `generatePackageJson: true`).
3. User-provided local models: expose Whisper/Kokoro-compatible model id (HF repo) or local directory in settings instead of only curated defaults.
4. ElevenLabs provider (fetch-based, no native deps): TTS (`POST /v1/text-to-speech/{voice_id}`, `GET /v1/voices` for user's voices) AND STT (Scribe). Premium enhancement — user supplies their own API key.
5. Settings: provider selection (`voice.ttsProvider`, `voice.sttProvider`), per-provider options (voice id, model id, output format). API key stored via `ITokenVault` (`ElectronSafeStorageVault`) — NEVER plaintext in settings.json.
6. Error surfacing: cloud provider failure (quota/invalid key/offline) surfaces the error with a one-click "switch to local" fallback affordance (tooltip/action). NO silent fallback.
7. Provider-agnostic `voice:` RPC routing; dual-registration rule applies (shared rpc.types.ts + ALLOWED_METHOD_PREFIXES — `voice:` prefix already allowlisted). New methods likely: voice:listProviders, voice:listVoices, provider config get/set.

## User Decisions (Checkpoint 0.1 / scope)

- CLI agent delegation: **DISABLED** — all implementation via Task-tool sub-agents only.
- ElevenLabs scope: **TTS + STT (Scribe)**.
- Local Kokoro/Whisper remain the free/offline default; ElevenLabs is opt-in enhancement.
- No silent fallback on cloud errors (explicit user action to switch).

## Strategy

- Task type: FEATURE
- Pattern: Full (PM → Architect → Team-Leader → QA)
- cli_delegation: disabled

## Key Code References

- `libs/backend/messaging-gateway/src/lib/voice/{whisper-transcriber,kokoro-synthesizer,ffmpeg-decoder,voice-assets-error}.ts` — current voice impl (main-thread ONNX via dynamic import)
- `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts` — RPC surface, injects concrete classes via GATEWAY_TOKENS (lines ~97-112)
- `apps/ptah-electron/src/di/phase-2-libraries.ts:261-301` — `configureElectronVoiceAssets` (ffmpeg path, modelCacheDir wiring)
- `libs/backend/memory-curator/src/lib/embedder/embedder-worker{-client}.ts` + `apps/ptah-electron` `build-embedder-worker` target — the worker isolation pattern to mirror
- `libs/backend/memory-contracts` — the zero-dep contracts lib pattern to mirror
- `libs/frontend/.../voice-config.component.ts` — settings UI (whisper model picker, TTS voice picker, download progress)
- `libs/backend/messaging-gateway/src/lib/token-vault.interface.ts` + `apps/ptah-electron/src/services/platform/electron-safe-storage-vault.ts` — API key storage path
