# Implementation Plan — TASK_2026_VOICE_PROVIDERS

Voice provider ports (local Kokoro/Whisper + ElevenLabs), process-isolated ONNX execution, onnxruntime-node 1.20.1 pin.

**Authoritative requirements**: `task-description.md` + `context.md` in this folder. This plan maps FR-1..FR-9 to concrete components with codebase evidence. All cited files were read during investigation.

---

## 0. Codebase Investigation Summary

### Current voice stack (to be replaced, no dual path)

| Concern             | Where today                                                                                                                                                                                                                                | Evidence                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| STT pipeline        | `WhisperTranscriber` (tsyringe `@injectable`, EventEmitter, injectable pipeline factory, per-file byte progress aggregation)                                                                                                               | `libs/backend/messaging-gateway/src/lib/voice/whisper-transcriber.ts:144-333`                                                           |
| TTS pipeline        | `KokoroSynthesizer` (same shape; kokoro-js via dynamic import; `isVoiceBinNotFound` ENOENT mapping)                                                                                                                                        | `libs/backend/messaging-gateway/src/lib/voice/kokoro-synthesizer.ts:152-347`                                                            |
| Audio decode        | `FfmpegDecoder.decodeToPcm16` (ffmpeg-static spawn, flag-injection guards)                                                                                                                                                                 | `.../voice/ffmpeg-decoder.ts:41-148`                                                                                                    |
| Typed error         | `VoiceAssetsUnavailableError` (`code: 'VOICE_ASSETS_UNAVAILABLE'` + `remediation`)                                                                                                                                                         | `.../voice/voice-assets-error.ts:1-58`                                                                                                  |
| Model setting       | `resolveWhisperModel` (`voice.whisperModel` → legacy `gateway.voice.whisperModel` → `base.en`)                                                                                                                                             | `.../voice/resolve-whisper-model.ts`                                                                                                    |
| RPC surface         | `VoiceRpcHandlers` — 8 methods, injects concrete classes via `GATEWAY_TOKENS.GATEWAY_{FFMPEG_DECODER,WHISPER_TRANSCRIBER,KOKORO_SYNTHESIZER}`                                                                                              | `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts:86-113`                                                               |
| Gateway voice notes | `GatewayService` injects `WhisperTranscriber` **by class** (`@inject(WhisperTranscriber)`) and `FfmpegDecoder`; transcribes at `gateway.service.ts:873-880`; `bridgeWhisperEvents()` re-emits download events on `gateway:event` (`:1126`) | `libs/backend/messaging-gateway/src/lib/gateway.service.ts:55-60,190,873,1126`                                                          |
| Electron wiring     | `configureElectronVoiceAssets` — ffmpeg path from `app.asar.unpacked`, `modelCacheDir = ~/.ptah/models`                                                                                                                                    | `apps/ptah-electron/src/di/phase-2-libraries.ts:261-301`                                                                                |
| Settings UI         | `VoiceConfigComponent` (signals, OnPush, curated Whisper/Kokoro lists, download progress via `VoiceDownloadProgressService`)                                                                                                               | `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.ts`                                                                 |
| Progress push       | `MESSAGE_TYPES.VOICE_MODEL_DOWNLOAD_PROGRESS = 'voice:modelDownloadProgress'`; frontend handler service in `MESSAGE_HANDLERS` multi-provider                                                                                               | `libs/shared/src/lib/types/messages/message-constants.ts:157`; `libs/frontend/chat/src/lib/services/voice-download-progress.service.ts` |

`KokoroSynthesizer`/`WhisperTranscriber`/`FfmpegDecoder` have **no consumers outside** messaging-gateway internals, `voice-rpc.handlers.ts`, and `phase-2-libraries.ts` (verified by workspace grep — 16 files, all in those three areas + specs). Narration/voice-over and chat mic both go through the `voice:` RPC surface.

### Patterns to mirror

- **Zero-dep contracts lib**: `libs/backend/memory-contracts` — types + `Symbol.for` token registry only, no internal/external deps (`libs/backend/memory-contracts/src/index.ts`, its CLAUDE.md).
- **Worker isolation**: `EmbedderWorkerClient` (main-side proxy, pending-request map keyed by id, progress passthrough messages, worker path via DI token `PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH`) + `embedder-worker.ts` entry bundled by the `build-embedder-worker` esbuild target (`format: esm`, `bundle: true`, `external: ['@huggingface/transformers']`, output `embedder-worker.mjs` in `dist/apps/ptah-electron`) — `libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.ts`, `apps/ptah-electron/project.json:135-157`. Worker path registered in DI from `__dirname` (`phase-2-libraries.ts:111-119`).
- **Host-implemented port precedent**: `GATEWAY_SESSION_LISTER` / `GATEWAY_SESSION_ACTIVITY_PROBE` are ports declared in a lib and implemented/registered by `apps/ptah-electron` (messaging-gateway CLAUDE.md).
- **Secret storage**: `ITokenVault` (encrypt/decrypt/isEncryptionAvailable) with `ElectronSafeStorageVault` (safeStorage + AES-256-GCM fallback); ciphertext at rest in `~/.ptah/settings.json`; decrypt failure → `null` → "re-enter key" UX (`libs/backend/messaging-gateway/src/lib/token-vault.interface.ts`, `apps/ptah-electron/src/services/platform/electron-safe-storage-vault.ts`).
- **Dual registration**: `voice:` prefix already in `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:78`) — **no runtime allowlist change needed**; compile-time additions go in `rpc.types.ts` (method map `:1568-1599`, param/result types `:2141-2215`, literal method-presence map `:2625-2632`) and `VoiceRpcHandlers.METHODS`.
- **Packaging**: electron-builder `files: '**/*'` picks up any `*.mjs` in `dist/apps/ptah-electron` automatically (embedder-worker.mjs ships with no explicit entry); `onnxruntime-node` + `@huggingface/transformers` + `ffmpeg-static` already `asarUnpack`ed; kokoro-js `voices/*.bin` copied via `extraResources` (`apps/ptah-electron/electron-builder.yml`). `apps/ptah-electron/package.json` is the hand-maintained dependency manifest checked by `scripts/validate-deps.js`; `build-main` uses `generatePackageJson: true` (`project.json:22`), and the `package` target already runs post-pack verify scripts (`verify-packed-native.js`, `verify-packed-wasm.js`) — precedent for a new onnx-version verifier.

---

## 1. Architecture Overview

```
                         libs/backend/voice-contracts          (NEW, zero-dep)
                         ports + capability + errors + tokens
                          ▲            ▲                ▲
            ┌─────────────┘            │                └───────────────┐
libs/backend/messaging-gateway   libs/backend/rpc-handlers    libs/backend/voice-providers (NEW)
(GatewayService uses STT port)   (VoiceRpcHandlers uses       ├─ local/  worker client + adapters
                                  selector port)              ├─ elevenlabs/ fetch adapters
                                                              ├─ registry + selector + secret store
                                                              └─ worker/ voice-worker entry (bundled
                                                                 separately, runs Whisper+Kokoro ONNX)
                                                                        ▲ host ports
                                                    apps/ptah-electron: utilityProcess factory,
                                                    worker path, vault, ffmpeg path, cache dir
```

- **Direct replacement**: `src/lib/voice/*` moves out of messaging-gateway into `voice-providers`; the three `GATEWAY_TOKENS` voice tokens and the class injections are deleted, not deprecated.
- **Frontend** talks only to `voice:` RPC + push messages; new types live in `libs/shared`.

---

## 2. Component 1 — `libs/backend/voice-contracts` (FR-1)

New buildable lib mirroring `memory-contracts` exactly (project.json/tsconfig copied from it; tags/boundaries identical pattern). **Zero workspace/external runtime deps.** Never imported by frontend libs.

### Files

```
libs/backend/voice-contracts/
├── src/index.ts
├── src/lib/voice-provider.types.ts     # ids, capability, options, requests/results
├── src/lib/tts-provider.port.ts        # ITextToSpeechProvider
├── src/lib/stt-provider.port.ts        # ISpeechToTextProvider
├── src/lib/voice-events.port.ts        # download/readiness event surface
├── src/lib/voice-selector.port.ts      # IVoiceProviderSelector / IVoiceProviderRegistry
├── src/lib/voice-token-vault.port.ts   # IVoiceTokenVault (structural twin, see D4)
├── src/lib/voice-provider-error.ts     # typed error taxonomy
└── src/lib/tokens.ts                   # VOICE_CONTRACT_TOKENS
```

### Contracts (exact shapes)

```ts
// voice-provider.types.ts
export type VoiceProviderId = 'local' | 'elevenlabs';
export type VoiceDirection = 'tts' | 'stt';

export interface VoiceProviderCapability {
  readonly id: VoiceProviderId;
  readonly label: string; // 'Local (Whisper / Kokoro)', 'ElevenLabs'
  readonly kind: 'local' | 'cloud';
  readonly requiresDownload: boolean;
  readonly requiresApiKey: boolean;
  readonly supports: { readonly tts: boolean; readonly stt: boolean };
  /** False on runtimes missing prerequisites (no worker factory / no vault). NFR: VS Code/CLI degrade. */
  readonly available: boolean;
  /** Human reason when available=false (e.g. VOICE_ASSETS_REMEDIATION text). */
  readonly unavailableReason?: string;
}

/** FR-4 — user model source, per direction. */
export type VoiceModelSpec =
  | { readonly kind: 'curated'; readonly name: string } // e.g. 'base.en', default Kokoro repo
  | { readonly kind: 'hf'; readonly repoId: string } // user HF repo id
  | { readonly kind: 'dir'; readonly path: string }; // local model directory (absolute)

export interface SynthesizeRequest {
  readonly text: string;
  /** Provider-interpreted voice id (Kokoro 'af_heart' / ElevenLabs voice_id). */
  readonly voice?: string;
}
export interface SynthesizeResult {
  readonly audio: Uint8Array;
  readonly mimeType: string; // 'audio/wav' local, 'audio/mpeg' ElevenLabs mp3
  readonly sampleRate?: number;
}
export interface TranscribeRequest {
  /** Absolute path to the encoded recording (webm/ogg/mp4/wav). Providers own decode. */
  readonly audioPath: string;
  readonly mimeType: string;
}
export interface TranscribeResult {
  readonly text: string;
}

export interface VoiceInfo {
  // FR-5.3 voice list
  readonly id: string;
  readonly label: string;
  readonly category?: string;
}
export interface VoiceReadiness {
  readonly ready: boolean;
  /** 'model-not-downloaded' | 'api-key-missing' | 'unavailable' | undefined when ready */
  readonly reason?: string;
}
```

```ts
// tts-provider.port.ts / stt-provider.port.ts
export interface ITextToSpeechProvider {
  readonly capability: VoiceProviderCapability;
  isReady(): Promise<VoiceReadiness>;
  synthesize(req: SynthesizeRequest): Promise<SynthesizeResult>;
  /** Cloud providers list account voices; local providers return the curated set. */
  listVoices(): Promise<readonly VoiceInfo[]>;
  /** Local only: eagerly pull model assets. No-op ({alreadyPresent:true}) for cloud. */
  downloadModel(): Promise<{ alreadyPresent: boolean }>;
}
export interface ISpeechToTextProvider {
  readonly capability: VoiceProviderCapability;
  isReady(): Promise<VoiceReadiness>;
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>;
  downloadModel(model?: string): Promise<{ alreadyPresent: boolean }>;
}
```

```ts
// voice-events.port.ts — FR-1.4 provider-agnostic download/readiness events
export type VoiceDownloadEvent = { readonly kind: 'download:start'; readonly direction: VoiceDirection; readonly model: string } | { readonly kind: 'download:progress'; readonly direction: VoiceDirection; readonly model: string; readonly percent: number } | { readonly kind: 'download:complete'; readonly direction: VoiceDirection; readonly model: string } | { readonly kind: 'download:error'; readonly direction: VoiceDirection; readonly model: string; readonly error: string };

export interface VoiceEventDisposable {
  dispose(): void;
}
export interface IVoiceDownloadEventSource {
  onDownload(listener: (e: VoiceDownloadEvent) => void): VoiceEventDisposable;
}
```

(Mirrors `EmbedderWorkerClient.onPipelineProgress` returning a `Disposable` — `embedder-worker-client.ts:173-180` — instead of raw EventEmitter, so consumers stay concrete-class-free.)

```ts
// voice-selector.port.ts
export interface IVoiceProviderRegistry {
  listProviders(): readonly VoiceProviderCapability[];
  getTts(id: VoiceProviderId): ITextToSpeechProvider; // throws VoiceProviderError('unknown-provider')
  getStt(id: VoiceProviderId): ISpeechToTextProvider;
}
export interface IVoiceProviderSelector {
  /** Resolves settings voice.ttsProvider / voice.sttProvider (default 'local') to the active port. */
  activeTts(): ITextToSpeechProvider;
  activeStt(): ISpeechToTextProvider;
  activeProviderId(direction: VoiceDirection): VoiceProviderId;
  /** FR-7.2/7.4 one-click switch: persists the setting. */
  setProvider(direction: VoiceDirection, id: VoiceProviderId): Promise<void>;
  /** Download event surface of the local providers (progress bridging). */
  readonly downloadEvents: IVoiceDownloadEventSource;
}
```

```ts
// voice-provider-error.ts — error taxonomy (FR-7.1, NFR security)
export type VoiceErrorCategory =
  | 'auth' // 401/403, invalid/expired key
  | 'quota' // 402/429 or provider quota_exceeded detail
  | 'network' // fetch TypeError, abort/timeout, offline
  | 'assets-unavailable' // local runtime deps missing (keeps VOICE_ASSETS_UNAVAILABLE semantics)
  | 'model-invalid' // FR-4.3/4.4 bad HF repo / local dir
  | 'process-crashed' // FR-2.2 worker died mid-request
  | 'provider-error'; // sanitized other

export class VoiceProviderError extends Error {
  readonly code = 'VOICE_PROVIDER_ERROR';
  constructor(
    readonly category: VoiceErrorCategory,
    readonly providerId: VoiceProviderId,
    message: string, // ALWAYS sanitized — never raw response bodies/headers
    readonly remediation?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'VoiceProviderError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}
export function isVoiceProviderError(e: unknown): e is VoiceProviderError {
  /* code check like isVoiceAssetsUnavailable */
}
```

Note: FR-1.1 says "interfaces/types/DI token symbols"; the tokens already require runtime values (`Symbol.for`), and `memory-contracts` sets the precedent that small runtime values are fine as long as the lib has **zero dependencies**. The error class carries no deps. `VOICE_ASSETS_UNAVAILABLE`/`VOICE_ASSETS_REMEDIATION` constants also move here (currently in messaging-gateway) so `rpc-handlers` keeps its existing response `code`/`remediation` contract (`VoiceTranscribeResult` at `rpc.types.ts:2148-2150`) without importing messaging-gateway.

```ts
// tokens.ts — UPPER_SNAKE Symbol.for, Ptah-prefixed unique descriptions (GATEWAY_TOKENS convention, tokens.ts:1-8)
export const VOICE_CONTRACT_TOKENS = {
  VOICE_PROVIDER_REGISTRY: Symbol.for('PtahVoiceProviderRegistry'),
  VOICE_PROVIDER_SELECTOR: Symbol.for('PtahVoiceProviderSelector'),
  VOICE_TOKEN_VAULT: Symbol.for('PtahVoiceTokenVault'),
} as const;
```

### Decision D4 — `IVoiceTokenVault` structural twin

`ITokenVault` lives in messaging-gateway; importing it from `voice-providers` would create a `voice-providers → messaging-gateway` edge dragging grammy/discord.js/@slack/bolt into the voice dep graph and violating one-concern-per-lib. `IVoiceTokenVault` in voice-contracts declares the **identical structural shape** (`isEncryptionAvailable/encrypt/decrypt` — 3 methods, `token-vault.interface.ts:13-20`); `apps/ptah-electron` registers the **same `ElectronSafeStorageVault` instance** under both `GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT` and `VOICE_CONTRACT_TOKENS.VOICE_TOKEN_VAULT` (TypeScript structural typing — no adapter class needed). Recorded tradeoff: a 3-method interface twin beats a cross-domain lib dependency.

---

## 3. Component 2 — Voice worker process isolation (FR-2)

### Decision D1 — Electron `utilityProcess`, not `worker_threads`

| Criterion                 | worker_threads (embedder today)                                                                                                                                                                                         | utilityProcess (chosen)                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash isolation           | Same OS process. A native `abort()` (the exact HandleScope failure mode — silent native abort, no JS error, log just stops per context.md) kills **the whole app**. `Worker.on('error')` never fires for native aborts. | Separate OS process. Native abort kills only the child; main gets `exit` event → structured error + respawn (FR-2.2).                                                                                                                                 |
| Fixes the concurrency bug | **No.** Embedder worker + a voice worker thread still share one loaded `onnxruntime_binding.node` in-process — 1.21.0's cross-thread bug remains reachable.                                                             | **Yes structurally.** Separate process = separate ONNX native instance; embedder and voice can never contend (FR-2.4), independent of the 1.20.1 pin.                                                                                                 |
| ABI / native loading      | N-API prebuilt, works.                                                                                                                                                                                                  | Same — utilityProcess runs Electron's bundled Node with asar support; `.node` loads redirect to `app.asar.unpacked` exactly as they do for the embedder (electron-builder.yml already unpacks `onnxruntime-node/**`, `@huggingface/transformers/**`). |
| Bundling                  | esbuild ESM bundle (`build-embedder-worker`).                                                                                                                                                                           | Identical esbuild target; `utilityProcess.fork(path)` accepts the `.mjs` entry (ESM supported since Electron 28; app is Electron 40).                                                                                                                 |
| Dev-mode path             | `__dirname/embedder-worker.mjs` (`phase-2-libraries.ts:111-119`).                                                                                                                                                       | Same resolution, `__dirname/voice-worker.mjs`.                                                                                                                                                                                                        |
| Lib purity                | `node:worker_threads` importable in backend libs.                                                                                                                                                                       | `electron` is NOT importable in backend libs → spawn goes behind a **host-implemented port** (precedent: `GATEWAY_SESSION_LISTER`).                                                                                                                   |
| Memory (R7)               | Thread shares heap budget.                                                                                                                                                                                              | Own process; mitigated with lazy spawn + idle teardown (below).                                                                                                                                                                                       |

FR-2.1 prefers utilityProcess; analysis confirms it — worker_threads would not even fix the crash. **Do not migrate the embedder** in this task (out of scope; the 1.20.1 pin protects it).

### Worker entry: `libs/backend/voice-providers/src/lib/worker/voice-worker.ts`

Thin shell over a pure core (testability — the embedder worker is untested because logic lives in the entry; we avoid that):

- `voice-worker-core.ts` — pure request dispatcher, pipelines injected. Handles the protocol below.
- `whisper-pipeline.ts` / `kokoro-pipeline.ts` — the pipeline-management logic **moved** from `WhisperTranscriber`/`KokoroSynthesizer` (`ensurePipeline`, per-file byte progress aggregation `handlePipelineProgress`, dynamic-import factories with `isModuleNotFound` → assets-unavailable mapping, kokoro `isVoiceBinNotFound` mapping) as **plain classes without tsyringe/EventEmitter** (progress via injected callback). Extended for FR-4 `VoiceModelSpec`: `kind:'hf'` uses the repo id verbatim through the same cache pipeline; `kind:'dir'` sets `env.allowLocalModels = true` + `env.localModelPath` and loads from the directory with no network; load failures map to `VoiceProviderError('model-invalid', 'local', ...)` naming the failing source (FR-4.3/4.4).
- `ffmpeg decode` runs **inside the worker** (move `ffmpeg-decoder.ts` logic; ffmpeg binary path arrives in the init message). Rationale: input crosses IPC as a small temp-file path instead of multi-MB PCM.
- Entry reads nothing from workspace DI; config arrives via the init message (mirrors `workerData.modelCacheDir`, `embedder-worker.ts:32-33`).

**Protocol** (typed in `voice-worker-protocol.ts`, shared by entry + client, id-correlated like the embedder protocol):

```ts
// main → worker
| { type: 'init'; ffmpegPath: string | null; modelCacheDir: string | null }
| { id, type: 'stt:transcribe'; audioPath: string; model: VoiceModelSpec }
| { id, type: 'tts:synthesize'; text: string; voice: string; model: VoiceModelSpec; dtype: string }
| { id, type: 'stt:download'; model: VoiceModelSpec }
| { id, type: 'tts:download'; model: VoiceModelSpec }
| { id, type: 'dispose' }
// worker → main
| { id, ok: true; text: string }
| { id, ok: true; wav: Uint8Array; sampleRate: number }
| { id, ok: true; alreadyPresent: boolean }
| { id, ok: false; error: string; category: VoiceErrorCategory }
| { type: 'download-progress'; direction: 'tts'|'stt'; model: string;
    kind: 'download:start'|'download:progress'|'download:complete'|'download:error'; percent?: number; error?: string }
```

### Decision D2 — audio transfer strategy

- **STT input: temp-file path.** The recording already exists as a file in both consumer paths (RPC handler writes `os.tmpdir()/ptah-voice-*.webm` — `voice-rpc.handlers.ts:419-425`; gateway voice notes arrive as `msg.voicePath` — `gateway.service.ts:873`). Passing the path avoids double-shipping up to 25 MB (schema cap) through structured clone, and ffmpeg-in-worker means decoded PCM (~3.8 MB/min) never crosses IPC at all. The worker re-applies `FfmpegDecoder`'s absolute-path/flag-injection/realpath guards.
- **TTS output: structured-clone `Uint8Array`.** WAV bytes are bounded by the 5 000-char text limit (`voice-rpc.schema.ts:69-75`) — low single-digit MB worst case; `MessagePortMain.postMessage` structured-clones typed arrays fine (embedder precedent ships `number[][]` vectors the same way). No temp-file lifecycle/cleanup risk for output.

### Client: `voice-worker-client.ts` (main process, in voice-providers)

Mirrors `EmbedderWorkerClient` (pending map, id counter, progress fan-out) with these deltas:

- Spawns via the host port instead of `new Worker(...)`:

```ts
// worker-process.port.ts (in voice-providers — host-implemented like GATEWAY_SESSION_LISTER)
export interface IVoiceWorkerProcess {
  postMessage(msg: unknown): void;
  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  kill(): void;
}
export interface IVoiceWorkerProcessFactory {
  spawn(): IVoiceWorkerProcess;
}
```

Electron impl (`apps/ptah-electron`) wraps `utilityProcess.fork(voiceWorkerPath, [], { serviceName: 'ptah-voice-worker' })` and sends `init` immediately after spawn (ffmpeg path + modelCacheDir computed exactly as `configureElectronVoiceAssets` does today, `phase-2-libraries.ts:265-274`).

- **Lifecycle (FR-2.2 + R7):** lazy spawn on first request; stays warm between requests (latency NFR); **idle teardown** — a timer (default 5 min, constructor-configurable) armed when in-flight count hits 0, cancelled on the next request; on fire → `dispose` message then `kill()`. On `exit`: reject all pending with `VoiceProviderError('process-crashed', 'local', ...)`, clear the ref — **no permanent `workerFailed` flag** (deliberate difference from `EmbedderWorkerClient:195-196`; FR-2.2 requires respawn on next request). Crash-loop guard: ≥3 exits within 60 s → refuse spawn for 30 s with `process-crashed` + remediation text.
- Progress messages re-emitted through `IVoiceDownloadEventSource`.
- Registered as `will-quit` disposable in `apps/ptah-electron/src/main.ts` (LIFO cleanup rule, ptah-electron CLAUDE.md).

### Build + packaging (FR-2.5)

- New Nx target `build-voice-worker` in `apps/ptah-electron/project.json`, byte-for-byte mirroring `build-embedder-worker` (`:135-157`): main `libs/backend/voice-providers/src/lib/worker/voice-worker.ts`, output `voice-worker.mjs`, `format: esm`, `external: ['@huggingface/transformers', 'kokoro-js']` (dynamic-imported at runtime from node_modules, exactly like today's opaque module ids — `whisper-transcriber.ts:110-112`, `kokoro-synthesizer.ts:96-102`). Add a `tsconfig.voice-worker.json` cloned from `tsconfig.embedder-worker.json`.
- Wire into `build.dependsOn`, `build-dev`, `serve`, `serve:watch` command lists alongside `build-embedder-worker` (`project.json:158-231`).
- electron-builder: **no yml change needed** — `files: '**/*'` ships `voice-worker.mjs` from the project dir (embedder precedent); kokoro voices `extraResources` and all needed `asarUnpack` entries already exist.
- Worker path DI: `VOICE_TOKENS.VOICE_WORKER_PATH` registered in `phase-2-libraries.ts` from `__dirname/voice-worker.mjs` (mirror `:111-119`).

### Runtime degradation (VS Code / CLI)

`IVoiceWorkerProcessFactory` and `IVoiceTokenVault` are **optionally injected** (`{ isOptional: true }` precedent: `EmbedderWorkerClient` cache-dir injection, `embedder-worker-client.ts:103-104`). Missing factory → local providers report `capability.available = false` / `isReady() = { ready:false, reason:'unavailable' }` and operations throw `VoiceProviderError('assets-unavailable', ...)` carrying the existing remediation text. Missing vault → ElevenLabs unavailable. `voice:listProviders` therefore reflects unavailability on non-Electron runtimes without crashes (NFR Runtimes). The VS Code app keeps registering `VoiceRpcHandlers` (as today, `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts:36,99,143`) — behavior matches today's assets-unavailable responses.

---

## 4. Component 3 — `libs/backend/voice-providers` lib (FR-2.3, FR-4, adapter home decision)

### Decision D3 — one new lib hosting all provider adapters

Options considered: (a) keep adapters in messaging-gateway — rejected: gateway is Track-4 messaging, voice would bloat it further and force rpc-handlers/electron to import messaging concerns for voice; (b) one lib per provider (`voice-local`, `voice-elevenlabs`) — rejected as over-fragmentation for ~15 files; (c) **`libs/backend/voice-providers`** hosting local + ElevenLabs adapters + registry/selector + worker plumbing — chosen. Precedent: messaging-gateway hosts three platform adapters behind `IMessagingAdapter` in one lib (its CLAUDE.md); "voice provider implementations" is the single concern. messaging-gateway sheds `src/lib/voice/` entirely and depends only on `voice-contracts`.

**Dependencies**: internal — `voice-contracts`, `platform-core` (IWorkspaceProvider), `vscode-core` (Logger TOKENS). External — `tsyringe`, `zod`. **No** messaging-gateway, no electron.

### Local adapters (FR-2.3, FR-4)

- `local/local-stt-provider.ts` — `WhisperSttProvider implements ISpeechToTextProvider`:
  - capability `{ id:'local', kind:'local', requiresDownload:true, requiresApiKey:false, supports:{tts:true,stt:true}, available: !!workerFactory }`.
  - `transcribe({audioPath})` → resolve `VoiceModelSpec` from settings (below) → `workerClient.transcribe(...)`. Transcript cleanup (`replace(/\[[^\]]+\]/g,'').trim()`, `whisper-transcriber.ts:253`) stays worker-side with the pipeline.
  - `isReady`/`isModelDownloaded` stay **main-side** (pure fs check against `modelCacheDir` + model-id path math moved from `whisper-transcriber.ts:182-196` into `local/model-paths.ts`) — no worker spawn just to render a badge.
  - `downloadModel(model?)` → worker `stt:download`; download events flow through the client's event source keyed with the model name (preserves `voice:modelDownloadProgress` payload shape `{model, percent}` and the `'tts'` sentinel used by the UI — `voice-rpc.handlers.ts:62-68`, `voice-config.component.ts:62`).
- `local/local-tts-provider.ts` — `KokoroTtsProvider implements ITextToSpeechProvider`: same shape; `listVoices()` returns the curated Kokoro set (moved from the frontend component's hardcoded lists into the backend so FR-6.1's "listed from the backend, not hardcoded in the UI" holds for voices too).
- `local/model-settings.ts` — settings→`VoiceModelSpec` resolution:
  - STT: `voice.whisperModelSource` (`'curated'|'hf'|'dir'`, default curated) + `voice.whisperModel` (curated name, kept, with `resolveWhisperModel` legacy fallback moved here) + `voice.whisperCustomModel` (repo id or absolute dir).
  - TTS: `voice.kokoroModelSource` + `voice.kokoroCustomModel`; `voice.ttsVoice` (kept).
  - FR-4.4 recoverability: setting a bad custom source never mutates the last-known-good curated value — switching source back to `'curated'` always restores a working config; errors identify the failing source string.
- Old files **deleted** from messaging-gateway: `whisper-transcriber.ts`, `kokoro-synthesizer.ts`, `ffmpeg-decoder.ts`, `voice-assets-error.ts`, `resolve-whisper-model.ts` (+ specs move/adapt), exports removed from `src/index.ts`, tokens `GATEWAY_WHISPER_TRANSCRIBER`/`GATEWAY_KOKORO_SYNTHESIZER`/`GATEWAY_FFMPEG_DECODER` removed from `di/tokens.ts`/`di/register.ts` (FR-9.4).

### Registry / selector

- `voice-provider-registry.ts` — constructor-collects the four adapters; `listProviders()` merges TTS/STT capability into per-provider descriptors.
- `voice-provider-selector.ts` — implements `IVoiceProviderSelector`; reads/writes `voice.ttsProvider`/`voice.sttProvider` via `IWorkspaceProvider.getConfiguration`/`setConfiguration` (write-capability probe pattern as in `voice-rpc.handlers.ts:387-404`); default `'local'`; selecting an unavailable provider throws `VoiceProviderError('provider-error', ...)` at call time with a clear message. Exposes merged `downloadEvents` from both local providers.
- `voice-secret-store.ts` — `getKey(providerId)`, `setKey(providerId, plaintext)`, `clearKey(providerId)`, `isConfigured(providerId)`. Storage: ciphertext under settings key `voice.elevenlabs.apiKeyCipher` via `IWorkspaceProvider` + encrypt/decrypt via `IVoiceTokenVault` (gateway token storage pattern — vault docblock, `token-vault.interface.ts:2-4`). Decrypt-failure (`null`) → `isConfigured` true but `getKey` null → surfaced as `auth` category with "re-enter your API key" remediation (established D2 UX). **Plaintext never logged, never returned by any getter reachable from RPC.**
- `di/tokens.ts` (`VOICE_TOKENS`: `VOICE_WORKER_PROCESS_FACTORY`, `VOICE_WORKER_PATH`, `VOICE_WORKER_CLIENT`, `VOICE_SECRET_STORE`, `LOCAL_TTS_PROVIDER`, `LOCAL_STT_PROVIDER`, `ELEVENLABS_TTS_PROVIDER`, `ELEVENLABS_STT_PROVIDER`) + `di/register.ts` (`registerVoiceProviderServices(container)`) — one register.ts per lib rule; registers registry + selector under the `VOICE_CONTRACT_TOKENS` port tokens.

---

## 5. Component 4 — ElevenLabs adapters (FR-5)

`elevenlabs/` inside voice-providers. Fetch-based, zero native deps, no process isolation (FR-5.6). Capability: `{ id:'elevenlabs', kind:'cloud', requiresDownload:false, requiresApiKey:true, supports:{tts:true, stt:true}, available: vaultPresent }`.

### `elevenlabs-client.ts` — shared HTTP core

- Base `https://api.elevenlabs.io`; header `xi-api-key: <key from VoiceSecretStore>`; `AbortSignal.timeout` (30 s synth/transcribe, 10 s list/test).
- **Zod at the HTTP boundary** (NFR): response schemas in `elevenlabs.schema.ts`, parsed with lenient objects (`z.looseObject`/pick known fields) so vendor drift fails loudly and locally (R4):
  - `VoicesResponseSchema`: `{ voices: Array<{ voice_id: string, name: string, category?: string }> }`
  - `SttResponseSchema`: `{ text: string, language_code?: string }`
  - `ErrorBodySchema`: `{ detail?: { status?: string, message?: string } }` (parsed best-effort for categorization only — **never** forwarded verbatim).
- `mapElevenLabsError(status, parsedDetail, cause)` — single reviewed chokepoint (R6):
  - `401`/`403` → `auth` (except `detail.status === 'quota_exceeded'` → `quota`)
  - `402`, `429` → `quota`
  - fetch `TypeError` / `AbortError` → `network`
  - anything else → `provider-error` with generic message `"ElevenLabs request failed (HTTP <status>)"`.
  - Messages contain **no response bodies, no headers, no key material**; `catch (error: unknown)` + `instanceof` narrowing throughout.

### `elevenlabs-tts-provider.ts`

- `synthesize`: `POST /v1/text-to-speech/{voiceId}?output_format={fmt}` body `{ text, model_id }`; voiceId/modelId/format from provider config (below), request-level `voice` override wins. Response bytes → `{ audio, mimeType }` (`audio/mpeg` for `mp3_*`, `audio/ogg` for `opus_*`).
- Options surface (settings, non-secret): `voice.elevenlabs.voiceId`, `voice.elevenlabs.ttsModelId` (default `eleven_multilingual_v2`; curated choices `eleven_multilingual_v2`, `eleven_flash_v2_5`, `eleven_turbo_v2_5`), `voice.elevenlabs.outputFormat` (default `mp3_44100_128`; curated `mp3_22050_32`, `mp3_44100_64`, `mp3_44100_128`, `mp3_44100_192`). MP3/Opus only in v1 — `Audio` element playback and gateway attachments handle them; PCM formats deferred (would need WAV wrapping).
- `listVoices`: `GET /v1/voices` → `VoiceInfo[]` (FR-5.3).
- `downloadModel`: `{ alreadyPresent: true }` no-op.

### `elevenlabs-stt-provider.ts` (Scribe)

- `transcribe({audioPath, mimeType})`: read file → `POST /v1/speech-to-text` multipart (`FormData` + `Blob`, Node 20 globals): fields `model_id` (= `voice.elevenlabs.sttModelId`, default `scribe_v1`) and `file`. Parse via `SttResponseSchema` → `{ text }`.
- ffmpeg not involved — the encoded recording uploads as-is.

### Key management (FR-5.4, FR-6.3)

- Vault flow: RPC `voice:setApiKey` → Zod-validate → `VoiceSecretStore.setKey('elevenlabs', key)` → encrypt via `ElectronSafeStorageVault` instance → ciphertext to `voice.elevenlabs.apiKeyCipher` in `~/.ptah/settings.json`. Empty-string key = clear.
- `voice:testConnection` → `GET /v1/user` with the stored (or just-submitted, pre-save) key; result `{ ok } | { ok:false, category, error }` — doubles as the live contract probe (R4).
- `voice:getProviderConfig` returns only `apiKeyConfigured: boolean` — the key never round-trips (FR-6.3); marketplace note (R5): the string `elevenlabs` appears only in TS/JS sources and `~/.ptah/settings.json`, never in `package.json contributes` or VSIX markdown.

---

## 6. Component 5 — onnxruntime-node 1.20.1 pin (FR-3)

1. **Root `package.json`**: extend the existing `overrides` block (`package.json:260-270` — precedent entries for zod/dompurify/tar) with `"onnxruntime-node": "1.20.1"`. Verify: `npm ls onnxruntime-node` resolves 1.20.1 everywhere incl. under `@huggingface/transformers@3.8.1` (which pins 1.21.0 — npm overrides supersede). Then `nx rebuild-native ptah-electron` unaffected (onnxruntime ships N-API prebuilts; no Electron rebuild).
2. **Packaged-app propagation (FR-3.2, R2)**: electron-builder (`--project dist/apps/ptah-electron`) installs production deps from the **generated** `dist/apps/ptah-electron/package.json` (`generatePackageJson: true`, `project.json:22`; hand-maintained base manifest `apps/ptah-electron/package.json` — the file `validate-deps.js:21` checks). npm applies `overrides` only from the install root — so the override **must exist in the generated manifest**:
   - Add `"overrides": { "onnxruntime-node": "1.20.1" }` to `apps/ptah-electron/package.json` (Nx merges the project manifest's fields into the generated one — `name`/`main`/`author` already flow through this path).
   - **Belt-and-braces enforcement**: new `apps/ptah-electron/scripts/patch-dist-overrides.js` run in the `build` target command list (precedent: `patch-sqlite3-tar.js` already runs there, `project.json:167-171`) — asserts/injects the overrides field into `dist/apps/ptah-electron/package.json`, exiting non-zero if the manifest is missing.
   - **Post-pack verification**: new `apps/ptah-electron/scripts/verify-packed-onnx.js` appended to the `package` target after electron-builder (precedent: `verify-packed-native.js`, `verify-packed-wasm.js`, `project.json:236-241`) — reads the packaged app's `app.asar.unpacked/node_modules/onnxruntime-node/package.json` and fails unless `version === '1.20.1'`.
3. **Regression gate (FR-3.3, R1)**: run existing embedder + voice spec suites against the downgrade **first** (Batch 1) before any adapter work; `@huggingface/transformers` 3.8.1 API surface is unchanged between ORT 1.20.1/1.21.0 per upstream issue threads, but the spike is cheap insurance.
4. **Rollback note**: remove the two `overrides` entries + `npm install` + delete the two scripts; isolation (FR-2) remains the primary fix, so rollback of the pin alone does not reintroduce the crash path once utilityProcess ships.

---

## 7. Component 6 — RPC surface + settings (FR-8)

### Method inventory

**Existing 8 (kept, rerouted through ports — FR-8.1)**: request/response shapes unchanged (`rpc.types.ts:2141-2215`); `VoiceRpcHandlers` constructor swaps `FfmpegDecoder`/`WhisperTranscriber`/`KokoroSynthesizer` injections (`voice-rpc.handlers.ts:103-108`) for `@inject(VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_SELECTOR)`.

- `voice:transcribe` — keep temp-file write + mime map (`:70-83,419-425`); then `selector.activeStt().transcribe({ audioPath, mimeType })`. ffmpeg injection deleted.
- `voice:synthesize` — `selector.activeTts().synthesize({ text, voice })`; base64-encode result; `mimeType` now comes from the provider result (local `audio/wav`, ElevenLabs `audio/mpeg`) — frontend already passes it to `Blob` (`voice-config.component.ts:607-611`), so cloud audio plays unmodified.
- `voice:getConfig`/`setConfig`/`downloadModel`/`getTtsConfig`/`setTtsConfig`/`downloadTtsModel` — reroute to local providers via registry (`registry.getStt('local')` etc.); `VoiceSetConfigParams` extended with optional `modelSource?: 'curated'|'hf'|'dir'` and `customModel?: string` (FR-4.1) — optional fields keep the wire compatible.
- Cloud failures in transcribe/synthesize: map `VoiceProviderError` to `{ ok:false, error, code:'VOICE_PROVIDER_ERROR', category, providerId }` AND broadcast the FR-7 push message (below). Local assets errors keep `code: VOICE_ASSETS_UNAVAILABLE` + remediation exactly as today (`:437-447`).

**New 6 (all `voice:` prefix — runtime allowlist already covers, `rpc-handler.ts:78`; verify only)**:

| Method                    | Params (Zod in `voice-rpc.schema.ts`)                                                                                     | Result                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `voice:listProviders`     | `{}`                                                                                                                      | `{ ok: true; providers: VoiceProviderCapabilityDto[]; active: { tts: string; stt: string } }`                                                                                                                                                                            |
| `voice:listVoices`        | `{ providerId: 'local'\|'elevenlabs' }`                                                                                   | `{ ok: true; voices: VoiceInfoDto[] } \| { ok:false; error; category? }`                                                                                                                                                                                                 |
| `voice:getProviderConfig` | `{}`                                                                                                                      | `{ ok: true; config: { ttsProvider; sttProvider; local: { whisperModel; modelSource; customModel?; sttDownloaded; ttsDownloaded; ttsVoice }; elevenlabs: { apiKeyConfigured: boolean; voiceId?; ttsModelId; outputFormat; sttModelId } } }` — **never any key material** |
| `voice:setProviderConfig` | `{ ttsProvider?; sttProvider?; elevenlabs?: { voiceId?; ttsModelId?; outputFormat?; sttModelId? } }` (strict enums/regex) | `{ ok } \| { ok:false; error }` — also the FR-7.2 switch-to-local endpoint                                                                                                                                                                                               |
| `voice:setApiKey`         | `{ providerId: 'elevenlabs'; apiKey: string (min 1, max 256) \| '' to clear }`                                            | `{ ok } \| { ok:false; error }`                                                                                                                                                                                                                                          |
| `voice:testConnection`    | `{ providerId: 'elevenlabs'; apiKey?: string }` (optional pre-save probe)                                                 | `{ ok: true } \| { ok:false; category; error }`                                                                                                                                                                                                                          |

**Dual-registration checklist (FR-8.3/8.4)**: (1) `rpc.types.ts` — add 6 entries to the method map (after `:1599`), param/result interfaces (after `:2215`), and the literal method-presence map (`:2625-2632`); (2) `VoiceRpcHandlers.METHODS` tuple extended → `register-all.ts` compile-time coverage assertion passes; (3) runtime prefix `voice:` verified present — no `ALLOWED_METHOD_PREFIXES` edit; (4) every new method Zod-validates params (`safeParse` + first-issue message pattern, existing handler style).

### Settings keys (non-secret, `~/.ptah/settings.json` under `ptah` section — FR-6.5)

`voice.ttsProvider`, `voice.sttProvider` (`'local'|'elevenlabs'`, default `'local'`), `voice.whisperModel` (existing), `voice.whisperModelSource`, `voice.whisperCustomModel`, `voice.kokoroModelSource`, `voice.kokoroCustomModel`, `voice.ttsVoice` (existing), `voice.elevenlabs.voiceId`, `voice.elevenlabs.ttsModelId`, `voice.elevenlabs.outputFormat`, `voice.elevenlabs.sttModelId`. Secret: `voice.elevenlabs.apiKeyCipher` (ciphertext only). None of these touch `package.json contributes.configuration` (marketplace rule, R5).

### FR-7 push channel

- `libs/shared/src/lib/types/messages/message-constants.ts`: add `VOICE_PROVIDER_ERROR: 'voice:providerError'` (append-only protocol) + payload in `messages/voice.ts` + `payload-map.ts` entry:

```ts
export interface VoiceProviderErrorPayload {
  readonly direction: 'tts' | 'stt';
  readonly providerId: string;
  readonly category: 'auth' | 'quota' | 'network' | 'provider-error';
  readonly message: string; // sanitized
}
```

- Broadcast from `VoiceRpcHandlers` (cloud-category failures of transcribe/synthesize) and from `GatewayService`'s voice-note catch path via the existing `webviewManager.broadcastMessage` pattern (`voice-rpc.handlers.ts:216-222`). **No retry, no substitution** — the error result still returns to the caller (FR-7.3).

---

## 8. Component 7 — Frontend (FR-6, FR-7)

All in `libs/frontend/chat/src/lib/settings/ptah-ai/` (existing home) + `services/`. Signals + `inject()`, OnPush, new control flow, no `[innerHTML]`, shared types only (frontend↔backend isolation). Replaces the current single component — no legacy panel left (FR-6.6).

- **`voice-config.component.ts` (rewrite in place)** — container: on init calls `voice:listProviders` + `voice:getProviderConfig`; renders two labelled provider `<select>`s (STT / TTS) populated from the backend list (disabled options with `unavailableReason` tooltip when `available:false`); `@switch` on selection renders exactly one panel per direction (FR-6.2). Provider change → `voice:setProviderConfig` with optimistic-revert pattern (existing style, `voice-config.component.ts:405-438`).
- **`local-stt-panel.component.ts`** — extracted from today's Whisper section: curated model select (existing option lists) **plus** a source toggle (Curated / HF repo id / Local folder) with a validated text input for custom id/path (FR-4.1); download button + progress bar unchanged, still driven by `VoiceDownloadProgressService` keyed by model name.
- **`local-tts-panel.component.ts`** — extracted Kokoro section: voice list now fetched via `voice:listVoices {providerId:'local'}` instead of the hardcoded arrays; custom model source controls; preview + download preserved (TTS sentinel `'tts'` progress key unchanged).
- **`elevenlabs-panel.component.ts`** — per direction: masked key input (`type="password"`, shows "Configured ●●●" state from `apiKeyConfigured`, never a value); **Test connection** button (pending state, inline success/categorized failure) calling `voice:testConnection` (optionally with the unsaved key); Save key → `voice:setApiKey`; voice dropdown populated from `voice:listVoices {providerId:'elevenlabs'}` (fetch on panel open when key configured, with loading/error states); TTS model + output-format selects; STT model select (scribe_v1). No download UI (FR-6.4). All async actions keep the UI responsive with visible pending signals (NFR).
- **`voice-provider-error.service.ts` (new, `services/`)** — `MessageHandler` for `MESSAGE_TYPES.VOICE_PROVIDER_ERROR` exposing `latestError` signal + `dismiss()` (mirror `VoiceDownloadProgressService`; register in the webview `MESSAGE_HANDLERS` multi-provider alongside it).
- **Switch-to-local affordance (FR-7.2/7.4)** — `voice-provider-error-toast.component.ts` rendered in the chat notifications area (existing `molecules/notifications/` surface): categorized message + **"Switch to local"** button → `voice:setProviderConfig { [direction]Provider: 'local' }` → on success dismiss + refresh settings state (settings UI reflects the change because it re-reads `voice:getProviderConfig`). The same categorized error + action also renders inline at point-of-use for in-flight RPC failures (mic button error state, TTS preview error line) using the `category` field on the RPC error result. Never auto-applies (FR-7.3).

---

## 9. Component 8 — Consumer routing (FR-9)

- **Chat mic** — `voice:transcribe` handler rerouted (Component 6). No frontend change to the mic path.
- **Gateway voice notes** — `GatewayService`: delete `FfmpegDecoder`/`WhisperTranscriber` imports + class injections (`gateway.service.ts:55-60,190`); inject `IVoiceProviderSelector` via `VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_SELECTOR`; `:873-880` becomes `selector.activeStt().transcribe({ audioPath: msg.voicePath, mimeType: 'audio/ogg' })` (ffmpeg decode now provider-internal). `bridgeWhisperEvents()` (`:1126`) re-implemented as `bridgeVoiceDownloadEvents()` subscribing `selector.downloadEvents.onDownload(...)` and re-emitting the same `gateway:event` payloads (`voice-model-download` kinds preserved).
- **Narration / voice-over** — already consumes `voice:synthesize` (no direct Kokoro consumers exist outside the files above — verified by grep); inherits provider routing automatically.
- **FR-9.4 exit criterion**: repo-wide grep for `WhisperTranscriber|KokoroSynthesizer|FfmpegDecoder` returns hits only inside `libs/backend/voice-providers` (adapters/worker/pipelines/specs).
- **DI wiring (apps/ptah-electron)**: in `phase-2-libraries.ts` — register `VOICE_TOKENS.VOICE_WORKER_PATH` (from `__dirname`), `VOICE_TOKENS.VOICE_WORKER_PROCESS_FACTORY` (`ElectronVoiceWorkerFactory`, new file under `src/services/platform/`), `VOICE_CONTRACT_TOKENS.VOICE_TOKEN_VAULT` (same `ElectronSafeStorageVault` instance as the gateway vault), then `registerVoiceProviderServices(container)`; `configureElectronVoiceAssets` shrinks to computing ffmpeg path + cache dir passed to the factory's init config (`:261-301` reworked). `phase-4-handlers.ts:110` unchanged (`VoiceRpcHandlers` singleton resolves new deps from the container). VS Code/CLI: call `registerVoiceProviderServices` where messaging-gateway services register today — factory/vault absent → degraded capabilities.

---

## 10. File-Level Change Inventory

### CREATE — `libs/backend/voice-contracts` (10)

| File                                                                          | Purpose                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `project.json`, `tsconfig*.json`, `jest.config.ts`, `.eslintrc/eslint.config` | Lib scaffolding cloned from memory-contracts                         |
| `src/index.ts`                                                                | Barrel                                                               |
| `src/lib/voice-provider.types.ts`                                             | Ids, capability, `VoiceModelSpec`, request/result DTOs               |
| `src/lib/tts-provider.port.ts` / `src/lib/stt-provider.port.ts`               | `ITextToSpeechProvider` / `ISpeechToTextProvider`                    |
| `src/lib/voice-events.port.ts`                                                | `VoiceDownloadEvent`, `IVoiceDownloadEventSource`                    |
| `src/lib/voice-selector.port.ts`                                              | `IVoiceProviderRegistry`, `IVoiceProviderSelector`                   |
| `src/lib/voice-token-vault.port.ts`                                           | `IVoiceTokenVault`                                                   |
| `src/lib/voice-provider-error.ts`                                             | `VoiceProviderError`, categories, `VOICE_ASSETS_*` constants (moved) |
| `src/lib/tokens.ts`                                                           | `VOICE_CONTRACT_TOKENS`                                              |

### CREATE — `libs/backend/voice-providers` (≈20)

| File                                                                                                                                                                                                                                         | Purpose                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| scaffolding (`project.json` etc.)                                                                                                                                                                                                            | Buildable backend lib                                                                         |
| `src/index.ts`                                                                                                                                                                                                                               | Barrel (adapters, tokens, register, protocol types)                                           |
| `src/lib/worker/voice-worker.ts`                                                                                                                                                                                                             | utilityProcess entry (thin shell; bundled to `voice-worker.mjs`)                              |
| `src/lib/worker/voice-worker-core.ts`                                                                                                                                                                                                        | Pure protocol dispatcher (injected pipelines — unit-testable)                                 |
| `src/lib/worker/voice-worker-protocol.ts`                                                                                                                                                                                                    | Typed message protocol shared by entry + client                                               |
| `src/lib/worker/whisper-pipeline.ts`                                                                                                                                                                                                         | Moved/de-DI'd `WhisperTranscriber` pipeline + progress aggregation + `VoiceModelSpec` support |
| `src/lib/worker/kokoro-pipeline.ts`                                                                                                                                                                                                          | Moved/de-DI'd `KokoroSynthesizer` pipeline (+ voice-bin ENOENT mapping)                       |
| `src/lib/worker/ffmpeg-decode.ts`                                                                                                                                                                                                            | Moved `FfmpegDecoder` decode logic (path-safety guards preserved)                             |
| `src/lib/local/voice-worker-client.ts`                                                                                                                                                                                                       | Main-side proxy: pending map, respawn, idle teardown, progress fan-out                        |
| `src/lib/local/worker-process.port.ts`                                                                                                                                                                                                       | `IVoiceWorkerProcess(Factory)` host port                                                      |
| `src/lib/local/local-stt-provider.ts` / `local-tts-provider.ts`                                                                                                                                                                              | Port adapters wrapping the worker client                                                      |
| `src/lib/local/model-paths.ts`                                                                                                                                                                                                               | `isModelDownloaded` fs math (moved from transcriber/synthesizer)                              |
| `src/lib/local/model-settings.ts`                                                                                                                                                                                                            | Settings → `VoiceModelSpec` (incl. moved `resolve-whisper-model` fallback)                    |
| `src/lib/elevenlabs/elevenlabs-client.ts`                                                                                                                                                                                                    | fetch core, timeouts, `mapElevenLabsError` (R6 chokepoint)                                    |
| `src/lib/elevenlabs/elevenlabs.schema.ts`                                                                                                                                                                                                    | Zod response schemas                                                                          |
| `src/lib/elevenlabs/elevenlabs-tts-provider.ts` / `elevenlabs-stt-provider.ts`                                                                                                                                                               | Cloud adapters                                                                                |
| `src/lib/voice-provider-registry.ts` / `voice-provider-selector.ts`                                                                                                                                                                          | Registry + settings-backed selector                                                           |
| `src/lib/voice-secret-store.ts`                                                                                                                                                                                                              | Vault-backed key store (`voice.elevenlabs.apiKeyCipher`)                                      |
| `src/lib/di/tokens.ts` / `src/lib/di/register.ts`                                                                                                                                                                                            | `VOICE_TOKENS` + `registerVoiceProviderServices`                                              |
| specs: `voice-worker-core.spec.ts`, `whisper-pipeline.spec.ts`, `kokoro-pipeline.spec.ts` (adapted from moved specs), `voice-worker-client.spec.ts`, `elevenlabs-*.spec.ts`, `voice-provider-selector.spec.ts`, `voice-secret-store.spec.ts` | Test suite (§11)                                                                              |

### CREATE — apps + scripts (5)

| File                                                                                                                                                                                                                     | Purpose                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `apps/ptah-electron/src/services/platform/electron-voice-worker-factory.ts`                                                                                                                                              | `utilityProcess.fork` impl of `IVoiceWorkerProcessFactory` (+ init message with ffmpeg path/cache dir) |
| `apps/ptah-electron/tsconfig.voice-worker.json`                                                                                                                                                                          | Clone of `tsconfig.embedder-worker.json`                                                               |
| `apps/ptah-electron/scripts/patch-dist-overrides.js`                                                                                                                                                                     | Assert/inject `overrides` into generated dist package.json                                             |
| `apps/ptah-electron/scripts/verify-packed-onnx.js`                                                                                                                                                                       | Post-pack assert onnxruntime-node 1.20.1 in packaged app                                               |
| `libs/frontend/chat/src/lib/settings/ptah-ai/{local-stt-panel,local-tts-panel,elevenlabs-panel}.component.ts` + `services/voice-provider-error.service.ts` + `.../notifications/voice-provider-error-toast.component.ts` | FR-6/FR-7 UI (5 files, + specs)                                                                        |

### MODIFY (15)

| File                                                                              | Change                                                                                                                                                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (root)                                                             | `overrides["onnxruntime-node"] = "1.20.1"`                                                                                                                       |
| `apps/ptah-electron/package.json`                                                 | Same `overrides` block (propagates via generatePackageJson)                                                                                                      |
| `apps/ptah-electron/project.json`                                                 | New `build-voice-worker` target; wire into `build`/`build-dev`/`serve`/`serve:watch`; `patch-dist-overrides.js` in `build`; `verify-packed-onnx.js` in `package` |
| `apps/ptah-electron/src/di/phase-2-libraries.ts`                                  | Register worker path/factory/vault twin + `registerVoiceProviderServices`; rework `configureElectronVoiceAssets`                                                 |
| `apps/ptah-electron/src/main.ts`                                                  | `will-quit` disposal of the voice worker client                                                                                                                  |
| `libs/backend/messaging-gateway/src/lib/gateway.service.ts`                       | Inject selector port; reroute `:873-880`; `bridgeVoiceDownloadEvents`                                                                                            |
| `libs/backend/messaging-gateway/src/lib/di/{tokens,register}.ts` + `src/index.ts` | Remove 3 voice tokens/registrations/exports; depend on voice-contracts                                                                                           |
| `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts`                | Selector injection; reroute 8 methods; add 6 methods; FR-7 broadcast                                                                                             |
| `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.schema.ts`                  | Schemas for new methods + extended setConfig                                                                                                                     |
| `libs/shared/src/lib/types/rpc.types.ts`                                          | 6 new method-map entries + DTOs + literal map entries; extend `VoiceSetConfigParams`                                                                             |
| `libs/shared/src/lib/types/messages/{message-constants,voice,payload-map}.ts`     | `VOICE_PROVIDER_ERROR` push type + payload                                                                                                                       |
| `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.ts` (+spec)   | Rewrite as provider container                                                                                                                                    |
| webview `MESSAGE_HANDLERS` registration site (`apps/ptah-extension-webview`)      | Add `VoiceProviderErrorService`                                                                                                                                  |
| `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.spec.ts`           | Rework against fake selector/providers                                                                                                                           |
| `libs/backend/messaging-gateway/src/lib/gateway.service.spec.ts`                  | Fake STT port instead of whisper/ffmpeg fakes                                                                                                                    |

### DELETE (moved) — from `libs/backend/messaging-gateway/src/lib/voice/`

`whisper-transcriber.ts`, `kokoro-synthesizer.ts`, `ffmpeg-decoder.ts`, `voice-assets-error.ts`, `resolve-whisper-model.ts` + their 4 spec files (logic and specs relocate to voice-providers/voice-contracts as listed above).

Also update `libs/backend/messaging-gateway/CLAUDE.md` and add CLAUDE.md files for the two new libs (repo convention).

---

## 11. Test Strategy

| Seam                                            | Tests                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pipelines** (worker-side)                     | Existing `whisper-transcriber.spec.ts` / `kokoro-synthesizer.spec.ts` fake-pipeline-factory suites adapted to the de-DI'd pipeline classes: progress aggregation monotonicity, model-repo overrides (`large-v3-turbo` → onnx-community), assets-unavailable mapping, voice-bin ENOENT mapping, **new**: `VoiceModelSpec` hf/dir handling + `model-invalid` errors naming the source                              |
| **Worker core**                                 | `voice-worker-core.spec.ts` — protocol contract tests with injected fake pipelines/ffmpeg: id correlation, error category serialization, dispose, unknown-type response. Protocol types imported by both entry and client guarantee compile-level contract parity                                                                                                                                                |
| **Worker client**                               | Fake `IVoiceWorkerProcess` (message loopback): request/response, progress fan-out, **respawn after exit** (pending rejected with `process-crashed`, next call spawns fresh — FR-2.2), idle teardown with fake timers (spawn → idle → dispose+kill; timer cancelled by in-flight request), crash-loop backoff                                                                                                     |
| **ElevenLabs adapters**                         | Mocked global fetch: TTS happy path (URL/query/output format/headers), voices list parse, Scribe multipart fields, error mapping table (401→auth, 401+quota_exceeded→quota, 402/429→quota, TypeError→network, 500→provider-error), **no key/body leakage in thrown messages** (assert `xi-api-key` value absent from `error.message`), Zod drift failure                                                         |
| **Secret store / selector**                     | Fake vault + fake workspace provider: ciphertext-only persistence, decrypt-null → auth remediation, default 'local', switch persists, unavailable-provider selection error                                                                                                                                                                                                                                       |
| **RPC handlers**                                | Extend existing spec harness (fake selector + fake providers): all 14 methods registered = `METHODS.length`; reroute assertions (no ffmpeg/whisper/kokoro doubles remain); `voice:getProviderConfig` response contains **no `apiKey`/cipher fields** (security regression test); FR-7 broadcast fired on cloud-category failure and NOT on local failure; Zod rejections for each new schema                     |
| **Gateway**                                     | Voice-note path uses the STT port fake; download-event bridge re-emits `gateway:event` payloads unchanged                                                                                                                                                                                                                                                                                                        |
| **Frontend**                                    | Component specs: provider dropdowns from backend list, panel switching, masked key input never displays stored value, test-connection pending/success/categorized-failure states, switch-to-local toast invokes `voice:setProviderConfig` and dismisses                                                                                                                                                          |
| **Pin verification**                            | `patch-dist-overrides.js` + `verify-packed-onnx.js` executed in CI package job; dev check `npm ls onnxruntime-node` documented in QA checklist                                                                                                                                                                                                                                                                   |
| **Crash regression (FR-2.4, headline QA gate)** | Manual/e2e script on packaged build: start workspace indexing (embedder active) → run `voice:transcribe` + `voice:synthesize` in a loop for 2+ min → assert app alive and `%APPDATA%\Ptah\logs` shows no truncated log/silent abort. Second scenario: kill the voice utilityProcess mid-request via Task Manager → in-flight request returns structured `process-crashed` error, next request succeeds (respawn) |

---

## 12. Sequencing / Implementation Batches

Ordered by dependency; each batch leaves the tree green (build + lint + typecheck + tests).

1. **Batch 1 — Pin + spike (FR-3, R1/R2)**: root + app `overrides`, `npm install`, run existing embedder/voice suites, `patch-dist-overrides.js`, `verify-packed-onnx.js`, project.json wiring for both scripts. _No behavior change; ships the defense-in-depth fix immediately._
2. **Batch 2 — voice-contracts lib (FR-1)**: full lib + tokens + error taxonomy. Nothing consumes it yet.
3. **Batch 3 — voice-providers local path (FR-2, FR-4)**: pipelines moved/de-DI'd, worker entry/core/protocol, worker client, host port, local adapters, model settings, registry/selector, secret store, DI register; `build-voice-worker` target + electron factory + `phase-2-libraries.ts` wiring + `main.ts` disposal; **delete** messaging-gateway voice files and reroute `gateway.service.ts` + `voice-rpc.handlers.ts` (existing 8 methods only). This is the largest batch because the move + reroute must land atomically (no dual path).
4. **Batch 4 — ElevenLabs (FR-5)**: client/schemas/adapters, registered into registry; still unreachable from UI until Batch 5 (selector defaults to local).
5. **Batch 5 — RPC + push surface (FR-8, FR-7 backend)**: 6 new methods, shared types, Zod schemas, `VOICE_PROVIDER_ERROR` message type, handler broadcasts.
6. **Batch 6 — Frontend (FR-6, FR-7 UI)**: voice-config rewrite + 3 panels + error service/toast + MESSAGE_HANDLERS registration.
7. **Batch 7 — QA gates**: crash regression script, packaged-app verification (onnx version + voice-worker.mjs presence + kokoro voices dir), secret-leak review of all ElevenLabs catch paths (R6), FR-9.4 grep audit, VSIX payload audit for `elevenlabs` strings in non-JS files (R5).

**Developer type**: backend-developer for Batches 1–5, frontend-developer for Batch 6, senior-tester for Batch 7. Complexity: HIGH overall (Batch 3 is the critical path).

---

## 13. Decisions Recorded (no clarifications needed)

| #   | Decision                                                                                      | Rationale anchor                                                                                                      |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| D1  | `utilityProcess` over `worker_threads`                                                        | worker_threads cannot deliver FR-2.2 crash isolation nor fix FR-2.4 (shared in-process ONNX binding); §3 table        |
| D2  | STT input = temp-file path (ffmpeg in worker); TTS output = structured-clone bytes            | Existing file-based flows at both call sites; IPC payload minimization; §3                                            |
| D3  | Single `voice-providers` lib for all adapters + selector; voice files leave messaging-gateway | messaging-gateway multi-adapter precedent; one concern = "voice provider implementations"; direct-replacement mandate |
| D4  | `IVoiceTokenVault` structural twin in contracts; same vault instance dual-registered          | Avoids voice→messaging dependency edge; 3-method duplication is the lesser evil                                       |
| D5  | Keep the existing 8 RPC methods' wire shapes, add 6 new methods                               | FR-8.1 mandates rerouting existing methods; avoids frontend flag-day beyond the settings component rewrite            |
| D6  | ElevenLabs output formats limited to mp3/opus curated list in v1                              | Direct `Audio`-element playability; PCM would need WAV wrapping (future)                                              |
| D7  | Embedder worker stays on worker_threads this task                                             | Out of scope; protected by the 1.20.1 pin; voice moving out of process removes the concurrency pair                   |
