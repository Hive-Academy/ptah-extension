# Requirements Document — TASK_2026_VOICE_PROVIDERS

## Introduction

Ptah's voice stack (speech-to-text for chat mic + gateway voice notes, text-to-speech for narration/voice-over) is currently hard-wired to two local ONNX pipelines — `WhisperTranscriber` (STT) and `KokoroSynthesizer` (TTS) in `libs/backend/messaging-gateway/src/lib/voice/` — executed **on the Electron main thread** via dynamic import of `@huggingface/transformers`.

This task delivers three business outcomes:

1. **Crash elimination (P0 reliability).** `onnxruntime-node 1.21.0` (pinned by `@huggingface/transformers 3.8.1`) has a fatal V8 thread-safety bug (`HandleScope` abort — huggingface/transformers.js#1292, microsoft/onnxruntime#24486). When the memory embedder worker and main-thread voice pipelines use the ONNX native binding concurrently, the Electron app silently hard-crashes (confirmed 2026-07-12 via `%APPDATA%\Ptah\logs`). Voice ONNX execution moves off the main thread into an isolated process (Electron `utilityProcess` preferred, mirroring the memory embedder `embedder-worker.mjs` pattern), with an `onnxruntime-node` 1.20.1 override as defense-in-depth.
2. **Provider abstraction (user choice).** Voice becomes a ports-and-adapters surface (`ITextToSpeechProvider` / `ISpeechToTextProvider` in a new zero-dep `libs/backend/voice-contracts` lib, mirroring `memory-contracts`). Users can supply their own Whisper/Kokoro-compatible model (HF repo id or local directory) instead of being limited to curated defaults. Local Kokoro/Whisper remain the free/offline default.
3. **ElevenLabs premium enhancement (bring-your-own-key).** Users with their own ElevenLabs subscription can use ElevenLabs TTS and STT (Scribe) for narration, voice-over, and transcription. API keys are stored encrypted via `ITokenVault` — never plaintext. Cloud failures surface explicitly with a one-click "switch to local" affordance; there is **no silent fallback**.

This is a direct replacement of the current hard-wired voice wiring — the concrete classes are wrapped behind provider ports and all consumers (RPC handlers, gateway voice notes, chat mic, narration) route through the ports. No parallel legacy path is retained.

**Authoritative scope source**: `context.md` in this task folder. User decisions locked at Checkpoint 0.1: ElevenLabs scope = TTS + STT (Scribe); no silent fallback; CLI agent delegation disabled (Task-tool sub-agents only).

---

## Functional Requirements

### FR-1: Voice provider contracts library (`libs/backend/voice-contracts`)

**User Story:** As a Ptah developer, I want voice capabilities defined as runtime-agnostic ports in a zero-dependency contracts lib, so that any provider (local ONNX, cloud API, future vendors) plugs in behind stable interfaces.

#### Acceptance Criteria

1. WHEN the workspace is built THEN a new lib `libs/backend/voice-contracts` SHALL exist, containing only TypeScript interfaces/types/DI token symbols with **zero runtime dependencies** (mirroring `libs/backend/memory-contracts`).
2. WHEN a provider is implemented THEN it SHALL conform to `ITextToSpeechProvider` and/or `ISpeechToTextProvider` port interfaces covering, at minimum: synthesize (text → audio), transcribe (audio → text), readiness query, and provider-specific option passing (voice id, model id, output format).
3. WHEN a consumer inspects a provider THEN a **capability descriptor** SHALL be available declaring at minimum: `local | cloud` kind, `requiresDownload`, `requiresApiKey`, and supported directions (TTS/STT).
4. WHEN a local provider downloads model assets THEN the ports SHALL expose a readiness/download-progress event surface that consumers can subscribe to without knowing the concrete provider.
5. WHEN dependency rules are checked (`nx graph` / lint boundaries) THEN `voice-contracts` SHALL be importable by backend libs and apps, SHALL import no other workspace lib, and SHALL NOT be imported by frontend libs.

### FR-2: Local providers isolated in a dedicated process

**User Story:** As an Electron app user, I want local voice transcription and synthesis to run outside the main process, so that ONNX native faults can never crash the whole application.

#### Acceptance Criteria

1. WHEN the local STT (Whisper) or TTS (Kokoro) provider executes ONNX inference THEN that execution SHALL occur in an isolated process — Electron `utilityProcess` preferred, or a worker if the architect determines parity — mirroring the existing `embedder-worker.mjs` pattern (`libs/backend/memory-curator/src/lib/embedder/embedder-worker{-client}.ts` + the `build-embedder-worker` Nx target in `apps/ptah-electron`).
2. WHEN the isolated voice process crashes or exits abnormally THEN the main process SHALL remain alive, the in-flight voice request SHALL fail with a structured, user-visible error, and a subsequent voice request SHALL be able to respawn the process.
3. WHEN local adapters are introduced THEN they SHALL wrap the existing `WhisperTranscriber` / `KokoroSynthesizer` behavior (model resolution, ffmpeg decode path, cache dir wiring per `apps/ptah-electron/src/di/phase-2-libraries.ts` `configureElectronVoiceAssets`) behind the FR-1 ports — feature parity with today's transcription/synthesis quality and formats.
4. WHEN memory embedding (embedder worker) and voice operations run concurrently THEN the app SHALL NOT abort (the 2026-07-12 crash scenario SHALL be reproducible-then-fixed: voice note transcription + narration during active memory indexing completes without a silent native abort).
5. WHEN the packaged Electron app is built THEN the isolated voice process entry SHALL be bundled and shipped by electron-builder the same way the embedder worker is (dedicated build target + inclusion in the packaged app).

### FR-3: onnxruntime-node pinned to 1.20.1 (defense-in-depth)

**User Story:** As a Ptah maintainer, I want the workspace to force `onnxruntime-node@1.20.1` (last version unaffected by the HandleScope bug), so that even in-process ONNX usage cannot hit the 1.21.0 thread-safety abort.

#### Acceptance Criteria

1. WHEN dependencies are installed THEN the root `package.json` SHALL carry an override pinning `onnxruntime-node` to `1.20.1`, and `npm ls onnxruntime-node` SHALL resolve exactly 1.20.1 everywhere (including under `@huggingface/transformers`).
2. WHEN the Electron app is packaged THEN the override SHALL propagate into the **electron-builder generated package.json** (the build uses `generatePackageJson: true`) so the installed app also resolves 1.20.1 — verified by inspecting the packaged app's `node_modules`/generated manifest.
3. WHEN existing embedder-worker and voice flows run against 1.20.1 THEN they SHALL pass their existing tests (no API regressions from the downgrade with `@huggingface/transformers 3.8.1`).

### FR-4: User-provided local models

**User Story:** As a user, I want to point Ptah at my own Whisper/Kokoro-compatible model — a Hugging Face repo id or a local directory — so that I control model size, language coverage, and offline availability instead of being limited to the curated defaults.

#### Acceptance Criteria

1. WHEN the user configures STT or TTS THEN settings SHALL accept, per direction: a curated default (current behavior), a custom HF repo id, or a local filesystem path to a compatible model directory.
2. WHEN a custom HF repo id is set THEN the local provider SHALL download/cache it through the same asset pipeline as curated models, emitting the FR-1 download-progress events.
3. WHEN a local path is set THEN the provider SHALL load from that directory without network access, and SHALL surface a structured error (not a crash) if the directory is missing or incompatible.
4. WHEN an invalid/incompatible model is configured THEN the error SHALL identify the failing model source and the previous working configuration SHALL remain recoverable (setting a bad model never bricks voice permanently).

### FR-5: ElevenLabs provider (TTS + STT/Scribe)

**User Story:** As a user with an ElevenLabs subscription, I want to plug in my API key and use my ElevenLabs voices/models for Ptah's narration, voice-over, and transcription, so that I get premium voice quality without Ptah shipping or proxying those models.

#### Acceptance Criteria

1. WHEN the ElevenLabs TTS provider is selected and configured THEN synthesis SHALL call the ElevenLabs API (`POST /v1/text-to-speech/{voice_id}`) using the user's key, honoring configured voice id, model id, and output-format options.
2. WHEN the ElevenLabs STT provider is selected THEN transcription SHALL use the ElevenLabs Scribe STT API with the user's key.
3. WHEN the user opens voice settings with a valid key THEN the UI SHALL list the user's available voices via `GET /v1/voices` for voice-id selection.
4. WHEN the API key is saved THEN it SHALL be encrypted via `ITokenVault` (`ElectronSafeStorageVault` on Electron) and stored only as ciphertext — NEVER plaintext in `~/.ptah/settings.json`, logs, or RPC payloads returned to the frontend.
5. WHEN the provider is implemented THEN it SHALL be fetch-based with **no native dependencies** and SHALL declare capability `cloud`, `requiresApiKey: true`, `requiresDownload: false` per FR-1.
6. WHEN the ElevenLabs provider is used THEN it SHALL run without any process-isolation requirement (no ONNX involvement) but still route through the same FR-1 ports as local providers.
7. WHEN ElevenLabs is not configured THEN local Kokoro/Whisper SHALL remain the default; ElevenLabs is strictly opt-in.

### FR-6: Provider selection settings + UI

**User Story:** As a user, I want a settings surface where I pick my STT and TTS providers independently and configure each provider's options — including secure API-key entry with verification — so that switching providers is self-service and safe.

#### Acceptance Criteria

1. WHEN voice settings load THEN independent provider selections SHALL exist for STT and TTS (settings keys `voice.sttProvider`, `voice.ttsProvider`), listing available providers from the backend (not hardcoded in the UI).
2. WHEN a provider is selected THEN a per-provider option panel SHALL render only that provider's relevant options: local — model picker (curated + custom id/path per FR-4), Kokoro voice picker; ElevenLabs — voice id (from FR-5.3 voice list), model id, output format.
3. WHEN the user enters an API key THEN the input SHALL be masked, the stored key SHALL never round-trip back to the UI in plaintext (display masked/"configured" state only), and a **Test connection** action SHALL verify the key against the provider and report success/failure inline.
4. WHEN a local provider needs a model download THEN the existing download-progress UX (progress bar in `voice-config.component.ts`, driven by `voice:modelDownloadProgress` broadcasts) SHALL be preserved for local providers; cloud providers SHALL show no download UI.
5. WHEN settings are persisted THEN non-secret provider config SHALL live in the existing settings store (`~/.ptah/settings.json` via `IWorkspaceProvider.getConfiguration()` pattern) and secrets SHALL follow FR-5.4.
6. WHEN the settings UI is built THEN it SHALL extend/replace the existing `libs/frontend/.../settings/ptah-ai/voice-config.component.ts` surface as a single coherent voice section (no duplicate legacy panel left behind).

### FR-7: Explicit cloud-error surfacing with one-click switch-to-local (no silent fallback)

**User Story:** As a user, I want to be told clearly when my cloud voice provider fails (invalid key, quota exhausted, offline) and be offered a one-click switch to the local provider, so that I stay in control of which provider is used and never get silently degraded output.

#### Acceptance Criteria

1. WHEN an ElevenLabs (or any cloud) voice call fails THEN the failure SHALL surface to the user at the point of use with a categorized reason (auth/invalid key, quota/rate limit, network/offline, other) — mapped from the API response, not raw response bodies.
2. WHEN a cloud failure is surfaced THEN the affordance SHALL include a one-click **"Switch to local"** action that updates the corresponding provider setting (STT or TTS) and allows the user to retry.
3. WHEN a cloud provider fails THEN the system SHALL NOT automatically retry against the local provider or transparently substitute output — no silent fallback under any circumstance.
4. WHEN the user activates "Switch to local" THEN the setting change SHALL persist (not just apply to the failed request) and the settings UI SHALL reflect the new selection.

### FR-8: Provider-agnostic `voice:` RPC surface (dual-registration)

**User Story:** As a frontend developer, I want all voice operations to go through provider-agnostic `voice:` RPC methods, so that the webview never knows or cares which provider executes a request.

#### Acceptance Criteria

1. WHEN the RPC surface is updated THEN existing methods (`voice:transcribe`, `voice:synthesize`, config get/set, `voice:downloadModel` / `voice:downloadTtsModel`) SHALL route through the FR-1 ports and resolve the active provider from settings — with request/response shapes free of provider-specific leakage (provider-specific options travel as typed provider config, not as top-level Whisper/Kokoro fields).
2. WHEN new capabilities are exposed THEN new methods SHALL exist at minimum for: listing available providers with capability descriptors (`voice:listProviders`), listing a provider's voices (`voice:listVoices`, e.g. ElevenLabs voices), and getting/setting per-provider configuration (including secure key set + test-connection support).
3. WHEN any new RPC method is added THEN the **dual-registration rule** SHALL be satisfied: method name added to `RpcMethodName` in `libs/shared/src/lib/types/rpc.types.ts` (compile-time) AND its prefix present in `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (runtime — note `voice:` is already allowlisted; verify rather than assume for any non-`voice:` additions).
4. WHEN `register-all.ts` compile-time coverage assertions run THEN the updated `VoiceRpcHandlers.METHODS` tuple SHALL satisfy them, and every new method SHALL validate params with a Zod schema in `voice-rpc.schema.ts`.

### FR-9: All voice consumers route through the ports

**User Story:** As a user, I want every voice feature — gateway voice notes (Telegram/Discord/Slack), the chat mic, and narration/voice-over playback — to honor my selected providers, so that provider choice applies consistently across the product.

#### Acceptance Criteria

1. WHEN a gateway voice note arrives THEN its transcription SHALL execute via the configured STT provider port (ffmpeg decode preserved for local pipeline needs), not via a direct `WhisperTranscriber` reference.
2. WHEN the chat mic captures audio THEN `voice:transcribe` SHALL use the configured STT provider.
3. WHEN narration/voice-over synthesizes speech THEN `voice:synthesize` SHALL use the configured TTS provider (voice id/model/format from that provider's config).
4. WHEN the refactor is complete THEN no consumer outside the local adapters SHALL inject `WhisperTranscriber` / `KokoroSynthesizer` concrete classes directly (the current `GATEWAY_TOKENS` direct injections in `voice-rpc.handlers.ts` and gateway wiring SHALL be replaced by port tokens) — direct replacement, no dual path.

---

## Non-Functional Requirements

### Architecture & Boundaries

- **Hexagonal rule**: backend code depends on `voice-contracts` ports; concrete adapters are separately registered. Frontend libs MUST NOT import backend libs (and vice versa); `libs/shared` is the only bridge for RPC types/messages.
- **Runtimes**: Electron gets full functionality (local isolated-process providers + ElevenLabs). VS Code and CLI degrade gracefully — voice today is Electron-only (`voice-rpc.handlers.ts` header: "Electron-only"); on non-Electron runtimes the provider list/capabilities SHALL reflect unavailability without crashes or dangling UI. The contracts lib itself SHALL be runtime-agnostic.
- **DI**: tsyringe with `Symbol.for(...)` `UPPER_SNAKE` tokens; one `register.ts` per new lib.

### Validation & Type Safety

- Zod validation for every RPC method's params at the boundary (`voice-rpc.schema.ts` pattern), including new provider-config and key-management methods.
- `catch (error: unknown)` with `instanceof Error` narrowing throughout; no `@ts-ignore`.
- Zod (or equivalent structured parsing) at the ElevenLabs HTTP response boundary — cloud responses are external input.

### Security

- API keys only ever transit set-key/test-connection request paths; stored exclusively as `ITokenVault` ciphertext; never logged, never included in `voice:getConfig`-style responses, never echoed to the webview.
- Error surfaces (FR-7) expose categorized, sanitized messages — never raw ElevenLabs response bodies or headers that could contain key material; never raw `error.message` from HTTP layers passed through to the UI verbatim.

### Frontend

- Angular: signals + `inject()`, `ChangeDetectionStrategy.OnPush` mandatory, new control flow; no `[innerHTML]`.
- Settings UI remains responsive during model downloads and test-connection calls (async with visible pending state).

### Reliability & Performance

- Voice process isolation: a crash in the voice process never takes down Electron main; respawn on next request.
- Local transcription/synthesis latency SHALL NOT regress materially versus current main-thread execution (IPC + process-spawn overhead amortized; the process may stay warm between requests — architect's call).
- Model downloads remain resumable/idempotent to the same degree as today, with progress events at least as granular as the current `voice:modelDownloadProgress` stream.

---

## Out of Scope

- Other cloud TTS/STT vendors (OpenAI TTS, Azure, Google, PlayHT, etc.) — the ports must make them possible later, but no adapter beyond ElevenLabs ships now.
- ElevenLabs voice cloning / voice management UI (creating, editing, deleting voices) — voice **selection** only.
- Streaming TTS playback (chunked audio streaming during synthesis) — listed as future enhancement; current request/response synthesis parity is sufficient.
- Automatic/silent provider fallback logic of any kind (explicitly rejected by user decision).
- Ptah-proxied ElevenLabs access (Ptah relaying calls through its own account/keys) — strictly bring-your-own-key.
- CLI agent delegation for implementation (workflow decision: Task-tool sub-agents only).
- Upgrading `@huggingface/transformers` beyond 3.8.1 or migrating to a different ONNX runtime — the fix is isolation + 1.20.1 pin.
- Telegram/Slack command-plane parity or other messaging-gateway features unrelated to voice routing.

---

## Risks & Dependencies

| #   | Risk / Dependency                                                                                                                                                                                                                                                                                                                                                                                                        | Probability | Impact                                      | Mitigation                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **onnxruntime-node 1.20.1 incompatibility** with `@huggingface/transformers 3.8.1` API surface (downgrade breaks embedder or voice pipelines)                                                                                                                                                                                                                                                                            | Medium      | High                                        | Verify upstream compat matrix early (spike before adapter work); existing embedder + voice tests as regression gate; isolation (FR-2) is the primary fix, the pin is defense-in-depth    |
| R2  | **Override fails to propagate** to electron-builder's `generatePackageJson: true` output — installed app silently ships 1.21.0 again                                                                                                                                                                                                                                                                                     | Medium      | Critical                                    | Explicit acceptance criterion FR-3.2; add a packaged-app verification step (inspect generated manifest/node_modules) to QA checklist                                                     |
| R3  | **utilityProcess IPC audio transfer** — large audio buffers (voice notes, synthesized WAV) over IPC add latency or hit serialization limits                                                                                                                                                                                                                                                                              | Medium      | Medium                                      | Mirror embedder-worker transfer patterns; architect to choose transferable/temp-file strategy; latency NFR as gate                                                                       |
| R4  | **ElevenLabs API changes** (endpoints, Scribe STT contract, voice-list schema, rate-limit semantics)                                                                                                                                                                                                                                                                                                                     | Low–Medium  | Medium                                      | Fetch-based adapter isolated behind the port; Zod-parse responses so drift fails loudly and locally; test-connection action doubles as a live contract probe                             |
| R5  | **Marketplace scanner** — trademark rules block `copilot/codex/claude/openai/anthropic` in non-JS files; `elevenlabs` is NOT on that list, but any new non-JS strings must be checked. Voice settings already live in `~/.ptah/settings.json` (not `package.json contributes.configuration`) per existing pattern — keep it that way; verify no `elevenlabs` strings land in VSIX markdown/manifest files before publish | Low         | Critical (burned extension ID is permanent) | New provider settings go only in `~/.ptah/settings.json`; VSIX payload audit before any marketplace publish; note voice is Electron-centric so extension exposure should be nil — verify |
| R6  | **Secret leakage via error paths** — ElevenLabs error responses or fetch errors carrying auth headers/keys into logs or UI                                                                                                                                                                                                                                                                                               | Medium      | High                                        | NFR security requirements; sanitizing error mapper is a reviewed chokepoint; code review gate on all `catch` paths in the ElevenLabs adapter                                             |
| R7  | **Concurrent process contention** — embedder utilityProcess + voice utilityProcess both loading ONNX/models (memory footprint on low-RAM machines)                                                                                                                                                                                                                                                                       | Low         | Medium                                      | Lazy spawn + idle teardown policy (architect decision); document memory expectations                                                                                                     |
| R8  | **User-supplied model incompatibility** (arbitrary HF repos/local dirs that transformers.js can't load)                                                                                                                                                                                                                                                                                                                  | High        | Low                                         | FR-4.3/4.4 structured errors + recoverable config; curated defaults remain one click away                                                                                                |
| D1  | Dependency: existing `embedder-worker` pattern and `build-embedder-worker` Nx target (template for FR-2)                                                                                                                                                                                                                                                                                                                 | —           | —                                           | Already in-tree (`libs/backend/memory-curator`, `apps/ptah-electron`)                                                                                                                    |
| D2  | Dependency: `ITokenVault` + `ElectronSafeStorageVault` (FR-5 key storage)                                                                                                                                                                                                                                                                                                                                                | —           | —                                           | Already in-tree; decrypt-failure → "re-enter key" UX pattern already established                                                                                                         |
| D3  | Dependency: `voice:` prefix already present in `ALLOWED_METHOD_PREFIXES`                                                                                                                                                                                                                                                                                                                                                 | —           | —                                           | Verify at implementation time; only new non-`voice:` prefixes would need runtime allowlisting                                                                                            |

---

## Stakeholder Notes

- **End users (free/offline)**: unchanged default experience, now crash-free; gain custom-model freedom.
- **End users (ElevenLabs subscribers)**: opt-in premium voice quality with their own account; explicit, respectful failure handling.
- **Maintainers**: single voice chokepoint (ports) replaces scattered concrete injections; future vendors are adapter-sized work.
- **QA**: crash scenario (concurrent embedder + voice) is the headline regression test; packaged-app override verification (R2) and secret-leak review (R6) are mandatory gates.

## Success Metrics

- Zero silent native aborts in Electron logs during concurrent memory-indexing + voice operations (previously reproducible).
- `npm ls onnxruntime-node` → 1.20.1 in dev tree AND packaged app.
- All voice consumers resolve providers via ports (no direct `WhisperTranscriber`/`KokoroSynthesizer` injection outside local adapters).
- ElevenLabs happy path: key entry → test connection → voice list → synthesis/transcription, with key never appearing in settings.json plaintext, logs, or RPC responses.
- Cloud failure path: visible categorized error + working one-click switch-to-local; no automatic substitution observed in tests.
