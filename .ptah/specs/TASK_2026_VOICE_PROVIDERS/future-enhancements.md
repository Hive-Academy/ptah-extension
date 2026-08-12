# Future Enhancements — TASK_2026_VOICE_PROVIDERS

Backlog seed captured after the voice provider abstraction shipped (local Kokoro/Whisper in an isolated `utilityProcess`, ElevenLabs TTS+STT, provider-agnostic `voice:` RPC, settings UI). Each item is a candidate follow-up task, not a commitment — direct-replacement modernization only, no compatibility layers.

---

### 1. Migrate memory embedder from `worker_threads` to `utilityProcess` reusing the voice worker process-factory pattern

**Priority**: HIGH
**Effort**: Medium (1 lib touch + 1 app touch — same shape as the voice worker migration just completed)
**Dependencies**: None blocking — `IVoiceWorkerProcessFactory` + `build-voice-worker` + lifecycle code already exist as the template.

**Rationale**: The embedder (`libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.ts`) still spawns its ONNX pipeline via `node:worker_threads` (`import { Worker } from 'node:worker_threads'`, `embedder-worker-client.ts:11,199`) in the Electron **main process**. It is now the last ONNX consumer left on a worker_thread rather than a separate OS process — the voice pipelines (Whisper/Kokoro) were just moved off main into their own `utilityProcess` precisely because a native ONNX fault (`onnxruntime-node` HandleScope abort) inside a `worker_threads.Worker` shares the host process's heap/address space and **still takes the whole app down**; `Worker.on('error')` never fires for a native `abort()`. The embedder has exactly the same exposure today.

This task built the reusable scaffolding a migration would directly lift:

- `IVoiceWorkerProcessFactory` / `IVoiceWorkerProcess` host port (spawn/postMessage/on/kill) — generalizes trivially to an `IEmbedderWorkerProcessFactory` or a single shared `IUtilityProcessFactory`.
- The `build-voice-worker` esbuild Nx target (ESM bundle, `external: ['@huggingface/transformers']`, mirrors the old `build-embedder-worker` shape almost exactly) — an `apps/ptah-electron` build-target pattern ready to retarget at `embedder-worker.ts`.
- The spawn/respawn/idle-teardown/crash-loop-guard lifecycle in the voice worker client (lazy spawn, warm-between-requests, idle timer, `exit` → reject-pending-and-clear-ref, no permanent `workerFailed` flag) — directly reusable instead of the embedder's current no-respawn-on-crash posture.

Lower risk now than it would have been mid-task: the original crash trigger (embedder worker + main-thread voice pipeline contending for the same in-process `onnxruntime_binding.node`) is already structurally eliminated by moving voice out. So this migration is an **isolation-hardening improvement**, not a crash fix — the embedder's own native-abort blast radius (killing the app) is the only remaining risk, not the cross-component race.

**Reusable groundwork**: `IVoiceWorkerProcessFactory` port + Electron impl, `build-voice-worker` esbuild target + `tsconfig.voice-worker.json`, worker protocol/client lifecycle (`voice-worker-client.ts`), `will-quit` disposable registration pattern in `apps/ptah-electron/src/main.ts`.

---

### 2. Streaming TTS playback (chunked audio during synthesis)

**Priority**: MEDIUM
**Effort**: Medium-High (touches worker protocol, RPC contract, and playback UI)
**Rationale**: Explicitly deferred in `task-description.md` Out of Scope. Current synthesis is request/response (full WAV/MP3 buffer). Long narration text has a visible latency-to-first-audio gap. ElevenLabs supports a streaming synthesis endpoint natively; local Kokoro would need chunked-sentence synthesis. Would require a new transport (SSE-like push or MessagePort streaming) since the current `voice:synthesize` RPC + structured-clone `Uint8Array` model is all-or-nothing.

### 3. Additional PCM/output formats

**Priority**: LOW
**Effort**: Small
**Rationale**: ElevenLabs adapter currently only wires MP3/Opus output formats (`mp3_22050_32` … `mp3_44100_192`); PCM formats were deferred because they'd need WAV-wrapping before returning to the frontend `Blob` playback path. Low effort once someone needs raw PCM (e.g. for a future streaming path or DAW-style export).

### 4. Additional cloud vendors behind the same ports (OpenAI TTS, Azure, Google, PlayHT)

**Priority**: MEDIUM
**Effort**: Medium per vendor (adapter-sized, ~1 lib addition each — `voice-contracts` ports already designed for this)
**Rationale**: Explicitly out of scope this task ("the ports must make them possible later, but no adapter beyond ElevenLabs ships now" — `task-description.md`). `ITextToSpeechProvider`/`ISpeechToTextProvider` + `VoiceProviderCapability` in `libs/backend/voice-contracts` were deliberately designed vendor-agnostic; adding a vendor is: one adapter file set in `voice-providers/`, one capability descriptor, one registry entry, zero contract changes. `VoiceProviderId` union (`'local' | 'elevenlabs'`) would need extending — check no other exhaustive switches were left un-widened.

### 5. Voice-clone management UI for ElevenLabs (create/edit/delete voices)

**Priority**: LOW
**Effort**: Medium (new settings surface + ElevenLabs voice-management endpoints)
**Rationale**: Explicitly out of scope — "voice **selection** only" (`task-description.md`). Current `voice:listVoices` only surfaces the user's existing ElevenLabs voices via `GET /v1/voices`. Cloning/editing would add `POST /v1/voices/add` etc. and a dedicated management panel; natural next step for power users but non-trivial UI scope.

### 6. Per-workspace provider overrides

**Priority**: LOW
**Effort**: Small-Medium
**Rationale**: Voice provider/model settings currently live globally in `~/.ptah/settings.json`. A per-workspace override (e.g. a project that wants ElevenLabs narration while another stays local-only) isn't supported today. Would follow whatever precedent the workspace-config layer eventually adopts elsewhere in Ptah — not voice-specific work, so worth doing as part of a broader per-workspace settings initiative rather than in isolation.

### 7. Upgrade `@huggingface/transformers` past 3.8.1 / remove the 1.20.1 onnxruntime-node pin

**Priority**: MEDIUM (revisit periodically, not urgent)
**Effort**: Small (spike + regression run) once upstream is fixed
**Rationale**: Explicitly out of scope this task — "the fix is isolation + 1.20.1 pin" (`task-description.md`). Root `package.json` currently pins `"@huggingface/transformers": "3.8.1"` and overrides `"onnxruntime-node": "1.20.1"` (confirmed live in `package.json`) as defense-in-depth against the upstream HandleScope thread-safety abort (huggingface/transformers.js#1292, microsoft/onnxruntime#24486). Once upstream ships a fixed `onnxruntime-node` and `@huggingface/transformers` moves past 3.8.1 to consume it, both the version pin and the override (including its electron-builder `generatePackageJson` propagation + `verify-packed-onnx.js` check) can be removed. Track the upstream issues; this is a "delete two overrides + bump one dep" task once the fix lands, gated on regression-testing embedder + voice pipelines against the new version.

### 8. VS Code / CLI voice enablement (currently Electron-centric)

**Priority**: LOW
**Effort**: Medium-High (needs a non-Electron worker-isolation story or accepting main-thread execution there)
**Rationale**: Voice remains Electron-only by design this task — on VS Code/CLI, `IVoiceWorkerProcessFactory` and `IVoiceTokenVault` are optionally injected and absent, so `voice:listProviders` correctly reports `available: false` with a remediation reason rather than crashing (per NFR "Runtimes" in `task-description.md`). Bringing voice to VS Code/CLI would need either: (a) a non-Electron process-isolation primitive (`child_process.fork` host port implementing the same `IVoiceWorkerProcess` shape), or (b) accepting local ONNX voice runs in-process there with the 1.20.1 pin as the only protection (matches the embedder's current VS Code posture). ElevenLabs (fetch-only, no native deps) could ship to VS Code/CLI independently and sooner than local providers, since it doesn't need process isolation at all.

---

## Summary Table

| #   | Item                                                                   | Priority | Effort                    |
| --- | ---------------------------------------------------------------------- | -------- | ------------------------- |
| 1   | Migrate embedder worker_threads → utilityProcess (reuse voice pattern) | HIGH     | Medium                    |
| 2   | Streaming TTS playback                                                 | MEDIUM   | Medium-High               |
| 3   | Additional PCM/output formats                                          | LOW      | Small                     |
| 4   | Additional cloud vendors (OpenAI/Azure/Google/PlayHT)                  | MEDIUM   | Medium/vendor             |
| 5   | ElevenLabs voice-clone management UI                                   | LOW      | Medium                    |
| 6   | Per-workspace provider overrides                                       | LOW      | Small-Medium              |
| 7   | Upgrade transformers/remove onnxruntime pin                            | MEDIUM   | Small (post-upstream-fix) |
| 8   | VS Code/CLI voice enablement                                           | LOW      | Medium-High               |
