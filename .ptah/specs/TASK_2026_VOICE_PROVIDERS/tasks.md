# Development Tasks — TASK_2026_VOICE_PROVIDERS

**Total Batches**: 7 (+ 6.5, 7.5) | **Status**: ✅ IMPLEMENTATION COMPLETE — all batches verified + committed
**Feature**: Voice provider ports (local Kokoro/Whisper isolated in Electron `utilityProcess` + ElevenLabs TTS/STT) + `onnxruntime-node@1.20.1` pin.
**Source of truth**: `implementation-plan.md` §10 (file inventory), §11 (test strategy), §12 (batch sequencing), §13 (decisions). Decompose — do NOT redesign.

> **CLI delegation is DISABLED for this task** (Checkpoint 0.1). Every batch executor is a **Task-tool sub-agent**. Execution mode is **sequential between batches** (hard dependency chain). Parallelism, where safe, is noted per-batch as two file-disjoint sub-agent invocations inside the same batch.

---

## Status Legend

| Icon           | Meaning                         | Who Sets              |
| -------------- | ------------------------------- | --------------------- |
| ⏸️ PENDING     | Not started                     | team-leader (initial) |
| 🔄 IN PROGRESS | Assigned to a sub-agent         | team-leader           |
| 🔄 IMPLEMENTED | Sub-agent done, awaiting verify | developer sub-agent   |
| ✅ COMPLETE    | Verified + reviewed + committed | team-leader           |
| ❌ FAILED      | Verification failed             | team-leader           |

## Progress Table

| Batch | Name                                               | Executor                                 | FRs                           | Depends On | Status                                          | Commit                                  |
| ----- | -------------------------------------------------- | ---------------------------------------- | ----------------------------- | ---------- | ----------------------------------------------- | --------------------------------------- |
| 1     | Pin + spike                                        | backend-developer                        | FR-3                          | —          | ✅ COMPLETE (verified)                          | committed in d2fa6b8e1                  |
| 2     | voice-contracts lib                                | backend-developer                        | FR-1                          | 1          | ✅ COMPLETE (verified)                          | committed in d2fa6b8e1                  |
| 3     | voice-providers local path + reroute               | backend-developer + senior-tester (3.6)  | FR-2, FR-4, FR-9              | 2          | ✅ COMPLETE (verified, committed)               | d2fa6b8e1 + specs/factory in c35b10e43  |
| 4     | ElevenLabs adapters                                | backend-developer                        | FR-5                          | 3          | ✅ COMPLETE (verified, committed)               | c35b10e43                               |
| 5     | RPC + push surface                                 | backend-developer                        | FR-8, FR-7 (backend)          | 4          | ✅ COMPLETE (verified, committed)               | fe673f7de                               |
| 6     | Frontend voice settings                            | frontend-developer                       | FR-6, FR-7 (UI)               | 5          | ✅ COMPLETE (verified, committed)               | fa4628ae0                               |
| 6.5   | FR-4.1 local-TTS custom model source (gap closure) | backend + frontend developer             | FR-4.1                        | 6          | ✅ COMPLETE (verified, committed)               | fffb075d9                               |
| 7     | QA gates                                           | senior-tester (+ modernization-detector) | FR-2.4, FR-3.2, FR-9.4, R5/R6 | 6          | ✅ COMPLETE (PASS automated; 1 manual residual) | test-report.md / future-enhancements.md |
| 7.5   | Packaging fix (electron-builder onnx traversal)    | devops-engineer                          | FR-3.2 (packaging)            | 7          | ✅ COMPLETE (verified, committed)               | f882aab2b                               |

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS (all risks pre-addressed by the architect in §3/§11/§13; tracked here for developer attention).

### Assumptions Verified (from plan evidence)

- ✅ `voice:` prefix already in `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:78`) — no runtime allowlist edit needed; verify only (FR-8.3, D3).
- ✅ `embedder-worker` isolation pattern + `build-embedder-worker` Nx target exist as templates for the voice worker (§0, R-D1).
- ✅ `ITokenVault` / `ElectronSafeStorageVault` in-tree; same instance can be dual-registered under `VOICE_CONTRACT_TOKENS.VOICE_TOKEN_VAULT` via structural typing (D4).
- ✅ electron-builder `files: '**/*'` auto-ships `*.mjs`; no yml change for `voice-worker.mjs` (§3 packaging).

### Risks Identified (carry into the noted batch)

| Risk                                                                                                                                               | Severity             | Mitigation (batch)                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R2 — override fails to propagate to generatePackageJson dist manifest → installed app ships 1.21.0                                                 | CRITICAL             | Batch 1: `patch-dist-overrides.js` (build) + `verify-packed-onnx.js` (package). Batch 7: packaged-app assert.                               |
| R1 — ORT 1.20.1 API drift vs `@huggingface/transformers 3.8.1` breaks embedder/voice                                                               | HIGH                 | Batch 1 spike: run existing embedder + voice suites against the downgrade BEFORE any adapter work.                                          |
| R6 — secret leakage via ElevenLabs error/catch paths                                                                                               | HIGH                 | Batch 4: single sanitizing `mapElevenLabsError` chokepoint; assert `xi-api-key` absent from thrown messages. Batch 7: catch-path review.    |
| FR-2.2 — worker respawn / crash-loop / idle teardown timing                                                                                        | MED                  | Batch 3: no permanent `workerFailed` flag; reject-pending-on-exit + respawn-on-next-request + ≥3-exits/60s backoff.                         |
| Progress-key contract — UI keys download progress by model name + `'tts'` sentinel (`voice-config.component.ts:62`, `voice-rpc.handlers.ts:62-68`) | MED                  | Batch 3/5: preserve `voice:modelDownloadProgress` payload `{model, percent}` + `'tts'` sentinel exactly.                                    |
| Degraded runtimes (VS Code/CLI) — missing worker factory / vault must not crash                                                                    | MED                  | Batch 3: `{ isOptional: true }` injection → `capability.available=false` + `isReady` reason; `voice:listProviders` reflects unavailability. |
| R5 — marketplace scanner: `elevenlabs` strings in non-JS files                                                                                     | CRITICAL (burned ID) | Settings stay in `~/.ptah/settings.json`, never `package.json contributes`. Batch 7: VSIX payload audit.                                    |

### Blockers Found

None. §13 records all design decisions as resolved; no architect revision required.

---

## Batch 1: Pin + Spike ✅ VERIFIED — COMMIT DEFERRED

> **Commit deferred (user decision).** Batch 1 passed independent team-leader verification (`npm ls onnxruntime-node` → 1.20.1 overridden; typecheck green; scripts mirror pattern files). Commit is blocked only by a pre-existing, unrelated `di-lint` failure in uncommitted knowledge-agent WIP (`vscode-lm-tools/.../ptah-api-builder.service.ts:350` injects `KNOWLEDGE_AGENT_TOKEN` with no `register*.ts` binding) that the `nx affected lint` pre-commit hook picks up. Per user decision "continue, commit later" — do NOT bypass the hook, do NOT touch the knowledge-agent files. Batch 1 + 2 (+ subsequent) land in a combined commit pass once the WIP stops failing di-lint.

**Recommended Executor**: `backend-developer` (Task-tool sub-agent)
**Fallback Executor**: `backend-developer` (re-invoke with reviewer notes)
**Execution Mode**: sequential (single sub-agent — tasks are tightly coupled through `package.json` + `project.json` + the install/spike gate)
**Rationale**: Dependency/build-config surgery on shared manifests with a regression-gate spike; must land as one coherent, verifiable unit. Not parallel-eligible (shared `project.json`, shared install root).
**FRs**: FR-3 (3.1, 3.2, 3.3) | **Dependencies**: None
**Goal**: Ship the `onnxruntime-node@1.20.1` defense-in-depth pin end-to-end (dev tree + packaged manifest propagation) with a regression spike proving `@huggingface/transformers 3.8.1` is unaffected. No behavior change.

### Task 1.1: Root + app override + install ✅ COMPLETE

**Files**: `D:\projects\ptah-extension\package.json` (extend `overrides` block ~:260-270), `D:\projects\ptah-extension\apps\ptah-electron\package.json` (add `overrides: { "onnxruntime-node": "1.20.1" }`)
**Spec Reference**: implementation-plan.md §6 (1,2); FR-3.1, FR-3.2
**Acceptance**: after `npm install`, `npm ls onnxruntime-node` resolves 1.20.1 everywhere (incl. under `@huggingface/transformers@3.8.1`).

### Task 1.2: Dist-manifest propagation + post-pack verifier scripts ✅ COMPLETE

**Files (CREATE)**: `D:\projects\ptah-extension\apps\ptah-electron\scripts\patch-dist-overrides.js`, `D:\projects\ptah-extension\apps\ptah-electron\scripts\verify-packed-onnx.js`
**Spec Reference**: implementation-plan.md §6 (2); FR-3.2, R2
**Pattern to Follow**: `patch-sqlite3-tar.js`, `verify-packed-native.js`, `verify-packed-wasm.js` (already in the `build`/`package` command lists).
**Acceptance**: `patch-dist-overrides.js` asserts/injects `overrides` into `dist/apps/ptah-electron/package.json` (exit non-zero if manifest missing); `verify-packed-onnx.js` reads packaged `app.asar.unpacked/node_modules/onnxruntime-node/package.json` and fails unless `version === '1.20.1'`.

### Task 1.3: Wire scripts into Nx targets ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\project.json`
**Spec Reference**: implementation-plan.md §6 (2); §10 MODIFY row 3
**Depends On**: Task 1.2
**Acceptance**: `patch-dist-overrides.js` runs in `build` command list (alongside `patch-sqlite3-tar.js`); `verify-packed-onnx.js` appended to `package` after electron-builder.

### Task 1.4: Regression spike (R1 gate) ✅ COMPLETE

**Spec Reference**: implementation-plan.md §6 (3); FR-3.3, R1
**Acceptance**: existing embedder-worker + voice spec suites pass against the 1.20.1 downgrade. Document outcome in the implementation report. If a genuine API regression surfaces → STOP and return BLOCKER to orchestrator (architect revision).

**Batch 1 Verification**:

- `npm ls onnxruntime-node` → 1.20.1 (paste output in report)
- `npx nx typecheck ptah-electron` green
- `npx nx lint ptah-electron` green
- Existing embedder + voice suites pass: `npx nx test memory-curator` + `npx nx test messaging-gateway`
- code-logic-reviewer approved

---

## Batch 2: voice-contracts Lib ✅ COMPLETE (verified, commit deferred)

**Recommended Executor**: `backend-developer` (Task-tool sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential (single sub-agent). Port files are file-disjoint, but the lib is small (~10 files) and shares one barrel + `project.json`; splitting adds coordination cost with no throughput gain.
**Rationale**: Zero-dep contracts lib mirroring `memory-contracts` exactly — mechanical scaffolding + type authoring; one concern, one owner.
**FRs**: FR-1 (1.1–1.5) | **Dependencies**: Batch 1
**Goal**: Create `libs/backend/voice-contracts` — TypeScript ports + capability + event surface + error taxonomy + tokens, **zero workspace/external runtime deps**, never imported by frontend libs.

### Task 2.1: Lib scaffolding ✅ COMPLETE

**Files (CREATE)**: `D:\projects\ptah-extension\libs\backend\voice-contracts\{project.json, tsconfig*.json, jest.config.ts, eslint config}`, `src\index.ts`
**Spec Reference**: implementation-plan.md §2, §10 CREATE voice-contracts; FR-1.1, FR-1.5
**Pattern to Follow**: `libs/backend/memory-contracts` (clone project.json/tsconfig, identical tags/boundaries).
**Acceptance**: `nx graph` shows voice-contracts importing no other workspace lib; lint boundaries allow backend+apps import, forbid frontend import.

### Task 2.2: Port + type definitions ✅ COMPLETE

**Files (CREATE)**: `src\lib\voice-provider.types.ts`, `src\lib\tts-provider.port.ts`, `src\lib\stt-provider.port.ts`, `src\lib\voice-events.port.ts`, `src\lib\voice-selector.port.ts`, `src\lib\voice-token-vault.port.ts` (all under `D:\projects\ptah-extension\libs\backend\voice-contracts\`)
**Spec Reference**: implementation-plan.md §2 (exact shapes: VoiceProviderId, VoiceProviderCapability, VoiceModelSpec, Synthesize/Transcribe req/result, VoiceInfo, VoiceReadiness, ITextToSpeechProvider, ISpeechToTextProvider, VoiceDownloadEvent/IVoiceDownloadEventSource, IVoiceProviderRegistry/Selector, IVoiceTokenVault); FR-1.2, FR-1.3, FR-1.4; D4
**Depends On**: Task 2.1
**Validation Notes**: `IVoiceTokenVault` is a **structural twin** of `ITokenVault` (3 methods) — do NOT import from messaging-gateway.

### Task 2.3: Error taxonomy + moved constants + tokens ✅ COMPLETE

**Files (CREATE)**: `src\lib\voice-provider-error.ts` (VoiceProviderError, VoiceErrorCategory, `isVoiceProviderError`, moved `VOICE_ASSETS_UNAVAILABLE`/`VOICE_ASSETS_REMEDIATION` constants), `src\lib\tokens.ts` (`VOICE_CONTRACT_TOKENS`)
**Spec Reference**: implementation-plan.md §2 (voice-provider-error.ts, tokens.ts); FR-1.1
**Depends On**: Task 2.1
**Validation Notes**: `VOICE_ASSETS_*` constants relocate here so `rpc-handlers` keeps its `code`/`remediation` response contract without importing messaging-gateway. Tokens use `Symbol.for('Ptah…')` UPPER_SNAKE convention.

### Task 2.4: Barrel export + CLAUDE.md ✅ COMPLETE

**Files**: `src\index.ts`, new `D:\projects\ptah-extension\libs\backend\voice-contracts\CLAUDE.md`
**Spec Reference**: §10 note "add CLAUDE.md files for the two new libs (repo convention)"

**Batch 2 Verification**:

- `npx nx build voice-contracts` green
- `npx nx typecheck voice-contracts` + `npx nx lint voice-contracts` green (boundary lint confirms zero-dep)
- `nx graph` confirms no outbound workspace edges
- code-logic-reviewer approved

---

## Batch 3: voice-providers Local Path + Reroute ✅ COMPLETE (verified)

> **Commit status:** Batch 3 (3.1–3.5) + Batches 1–2 were committed in `d2fa6b8e1` (swept in alongside the user's now-committed knowledge-agent WIP — this resolved the earlier di-lint deferral blocker). The Task 3.6 spec files + the factory esbuild fix committed in `c35b10e43` (together with Batch 4).
>
> **✅ RESOLVED — Batch 3 factory esbuild fix (committed in `c35b10e43`):** `build-main:production` esbuild rejected `import { utilityProcess } from 'electron'` in `apps/ptah-electron/src/services/platform/electron-voice-worker-factory.ts` (esbuild's electron CJS-external allow-list has no named `utilityProcess` export). Fixed via CJS default-import interop: `import electron, { type UtilityProcess } from 'electron'; const { utilityProcess } = electron;`. Verified `build-main:production` green.
>
> **Orchestrator recovery wiring fixes (verified, part of Batch 3):**
>
> 1. `apps/ptah-electron/tsconfig.build.json` — added `@ptah-extension/voice-contracts` + `@ptah-extension/voice-providers` to the local `paths` override (that file replaces base paths wholesale; `build-voice-worker` esbuild couldn't resolve voice-contracts without it). Verified present, build-voice-worker green (24KB `voice-worker.mjs`).
> 2. `libs/backend/rpc-handlers/package.json` — added the two voice workspace deps (`@nx/dependency-checks` required them after the reroute). Verified present, lint clean.

**Recommended Executor**: `backend-developer` (Task-tool sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential, **single sub-agent** — this batch is the critical path and the move + reroute must land **atomically** (no dual path). Do NOT split: deleting messaging-gateway voice files while rerouting consumers is a flag-day that cannot be safely parallelized.
**Rationale**: Largest, highest-risk batch (§12). Cross-file refactor + file moves + DI wiring + build-target authoring — architecture-sensitive, must stay coherent under one owner. `senior-tester` support recommended AFTER this batch is green to harden worker-client respawn/idle-teardown specs.
**FRs**: FR-2 (2.1–2.5), FR-4 (4.1–4.4), FR-9 (9.1, 9.4) | **Dependencies**: Batch 2
**Goal**: Create `libs/backend/voice-providers` local path (worker isolation via Electron `utilityProcess`), move pipelines out of messaging-gateway, wire the Electron factory/build target, and reroute the existing 8 RPC methods + gateway voice notes — no dual path.

### Task 3.1: Worker core + moved pipelines + protocol ✅ COMPLETE

**Files (CREATE)**: `D:\projects\ptah-extension\libs\backend\voice-providers\src\lib\worker\{voice-worker.ts, voice-worker-core.ts, voice-worker-protocol.ts, whisper-pipeline.ts, kokoro-pipeline.ts, ffmpeg-decode.ts}` + lib scaffolding (`project.json`, tsconfig\*, jest, eslint, `src\index.ts`)
**Spec Reference**: implementation-plan.md §3 (worker entry, protocol, D2), §4 (deps), §10 CREATE voice-providers; FR-2.1, FR-2.3, FR-4.1–4.4
**Pattern to Follow**: `embedder-worker.ts` / `embedder-worker-client.ts` (id-correlated protocol, `workerData`-style init).
**Validation Notes**: Pipelines move from `WhisperTranscriber`/`KokoroSynthesizer`/`FfmpegDecoder` as **plain classes** (no tsyringe/EventEmitter; progress via injected callback). Preserve: per-file byte progress aggregation, `isModuleNotFound`→assets-unavailable, kokoro `isVoiceBinNotFound`, transcript cleanup regex, ffmpeg path-safety/flag-injection/realpath guards. Extend for `VoiceModelSpec` `hf`/`dir` → `model-invalid` errors naming the failing source. Worker entry reads config only from the `init` message.

### Task 3.2: Worker client + host port + local adapters + model settings ✅ COMPLETE

**Files (CREATE)**: `src\lib\local\{voice-worker-client.ts, worker-process.port.ts, local-stt-provider.ts, local-tts-provider.ts, model-paths.ts, model-settings.ts}`
**Spec Reference**: implementation-plan.md §3 (client lifecycle), §4 (local adapters); FR-2.2, FR-2.3, FR-4, FR-9.1
**Depends On**: Task 3.1
**Validation Notes**: Client lifecycle — lazy spawn, stay warm, idle teardown timer (5 min, constructor-configurable), reject-pending-on-`exit` with `VoiceProviderError('process-crashed','local')`, **no permanent `workerFailed` flag** (respawn on next request), crash-loop guard (≥3 exits/60s → refuse 30s). `IVoiceWorkerProcessFactory`/`IVoiceTokenVault` injected `{ isOptional: true }` → degraded capability when absent. `isReady`/model-download fs checks stay main-side. Preserve `voice:modelDownloadProgress` `{model, percent}` payload + `'tts'` sentinel.

### Task 3.3: Registry + selector + secret store + DI register ✅ COMPLETE

**Files (CREATE)**: `src\lib\{voice-provider-registry.ts, voice-provider-selector.ts, voice-secret-store.ts}`, `src\lib\di\{tokens.ts, register.ts}`, `src\index.ts` (barrel), new `libs\backend\voice-providers\CLAUDE.md`
**Spec Reference**: implementation-plan.md §4 (registry/selector, secret store, di); FR-2.3, FR-4.4
**Depends On**: Task 3.2
**Validation Notes**: Selector reads/writes `voice.ttsProvider`/`voice.sttProvider` (default `'local'`) via `IWorkspaceProvider` write-capability probe; selecting unavailable provider throws at call time. Secret store: ciphertext under `voice.elevenlabs.apiKeyCipher`, decrypt-null → `auth` "re-enter key"; plaintext never logged / never returned by any RPC-reachable getter. `registerVoiceProviderServices` registers registry+selector under `VOICE_CONTRACT_TOKENS` port tokens.

### Task 3.4: Electron worker factory + build target + DI wiring + disposal ✅ COMPLETE

**Files (CREATE)**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-voice-worker-factory.ts`, `apps\ptah-electron\tsconfig.voice-worker.json`
**Files (MODIFY)**: `apps\ptah-electron\project.json` (new `build-voice-worker` target mirroring `build-embedder-worker`; wire into `build`/`build-dev`/`serve`/`serve:watch`), `apps\ptah-electron\src\di\phase-2-libraries.ts` (register `VOICE_WORKER_PATH` from `__dirname`, factory, vault twin, call `registerVoiceProviderServices`; shrink `configureElectronVoiceAssets`), `apps\ptah-electron\src\main.ts` (`will-quit` disposal, LIFO)
**Spec Reference**: implementation-plan.md §3 (build+packaging, factory), §9 DI wiring; FR-2.1, FR-2.5
**Depends On**: Task 3.3
**Validation Notes**: `build-voice-worker` byte-for-byte mirrors `build-embedder-worker` (`format: esm`, `external: ['@huggingface/transformers','kokoro-js']`, output `voice-worker.mjs`). No electron-builder.yml change (`files: '**/*'` ships it). Factory wraps `utilityProcess.fork(path, [], { serviceName: 'ptah-voice-worker' })` + sends `init` immediately.

### Task 3.5: Reroute consumers + delete messaging-gateway voice files ✅ COMPLETE

**Files (MODIFY)**: `libs\backend\rpc-handlers\src\lib\handlers\voice-rpc.handlers.ts` (swap 3 concrete injections for `@inject(VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_SELECTOR)`; reroute existing **8** methods only), `libs\backend\messaging-gateway\src\lib\gateway.service.ts` (inject selector, reroute `:873-880`, `bridgeVoiceDownloadEvents`), `libs\backend\messaging-gateway\src\lib\di\{tokens.ts, register.ts}` + `src\index.ts` (remove 3 voice tokens/registrations/exports; depend on voice-contracts), `libs\backend\messaging-gateway\CLAUDE.md`
**Files (DELETE, logic moved)**: `libs\backend\messaging-gateway\src\lib\voice\{whisper-transcriber.ts, kokoro-synthesizer.ts, ffmpeg-decoder.ts, voice-assets-error.ts, resolve-whisper-model.ts}` + their 4 spec files
**Files (MODIFY specs)**: `voice-rpc.handlers.spec.ts` (fake selector/providers), `gateway.service.spec.ts` (fake STT port)
**Spec Reference**: implementation-plan.md §7 (existing 8 methods), §9 (consumer routing), §10 MODIFY/DELETE; FR-9.1, FR-9.4
**Depends On**: Task 3.4
**Validation Notes**: Existing 8 methods keep exact wire shapes; new 6 methods are **Batch 5**, not here. Local assets errors keep `code: VOICE_ASSETS_UNAVAILABLE` + remediation. FR-9.4 interim check: `WhisperTranscriber|KokoroSynthesizer|FfmpegDecoder` grep returns hits only inside voice-providers.

### Task 3.6: Worker-side + client specs (senior-tester assist) ✅ COMPLETE

**Files (CREATE)**: `voice-worker-core.spec.ts`, `whisper-pipeline.spec.ts`, `kokoro-pipeline.spec.ts` (adapted from moved specs), `voice-worker-client.spec.ts`, `voice-provider-selector.spec.ts`, `voice-secret-store.spec.ts`
**Spec Reference**: implementation-plan.md §11 (Pipelines / Worker core / Worker client / Secret store & selector rows)
**Depends On**: Task 3.5
**Validation Notes**: Cover respawn-after-exit, idle teardown with fake timers, crash-loop backoff, `VoiceModelSpec` hf/dir + `model-invalid` naming, ciphertext-only persistence, decrypt-null→auth, default-local + persist-switch.

**Batch 3 Verification**:

- `npx nx typecheck voice-providers rpc-handlers messaging-gateway ptah-electron` green
- `npx nx lint voice-providers rpc-handlers messaging-gateway ptah-electron` green
- `npx nx test voice-providers messaging-gateway rpc-handlers` green
- `npx nx run ptah-electron:build-voice-worker` produces `voice-worker.mjs`
- FR-9.4 grep: `WhisperTranscriber|KokoroSynthesizer|FfmpegDecoder` only inside voice-providers
- code-logic-reviewer approved (focus: no stubs, respawn logic real, no plaintext key paths)

---

## Batch 4: ElevenLabs Adapters ✅ COMPLETE (verified, committed c35b10e43)

**Recommended Executor**: `backend-developer` (Task-tool sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential (single sub-agent). Tasks share `elevenlabs-client.ts` + `elevenlabs.schema.ts` (both adapters depend on the client/error-mapper), so not file-disjoint enough for parallel invocation.
**Rationale**: Security-critical cloud adapter with one reviewed error chokepoint (R6) — cohesion matters more than parallelism. Registered into the registry but unreachable from UI until Batch 5 (selector defaults to local).
**FRs**: FR-5 (5.1–5.7) | **Dependencies**: Batch 3
**Goal**: Fetch-based ElevenLabs TTS + STT (Scribe) adapters behind the FR-1 ports, Zod-validated at the HTTP boundary, with a single sanitizing error mapper — no native deps, no process isolation.

### Task 4.1: HTTP core + Zod schemas + error mapper ✅ COMPLETE

**Files (CREATE)**: `D:\projects\ptah-extension\libs\backend\voice-providers\src\lib\elevenlabs\{elevenlabs-client.ts, elevenlabs.schema.ts}`
**Spec Reference**: implementation-plan.md §5 (elevenlabs-client, schema, mapElevenLabsError); FR-5.5, R4, R6; NFR security
**Validation Notes**: `xi-api-key` header from `VoiceSecretStore`; `AbortSignal.timeout` (30s synth/transcribe, 10s list/test). `mapElevenLabsError` is the **single reviewed chokepoint**: 401/403→auth (unless `quota_exceeded`→quota), 402/429→quota, TypeError/AbortError→network, else `provider-error` with generic `"ElevenLabs request failed (HTTP <status>)"`. Messages contain NO bodies/headers/key material. Zod `looseObject` schemas so vendor drift fails loudly.

### Task 4.2: TTS + STT adapters + registry registration ✅ COMPLETE

**Files (CREATE)**: `src\lib\elevenlabs\{elevenlabs-tts-provider.ts, elevenlabs-stt-provider.ts}`
**Files (MODIFY)**: `src\lib\voice-provider-registry.ts` + `src\lib\di\{tokens.ts, register.ts}` (register the two cloud adapters)
**Spec Reference**: implementation-plan.md §5 (tts-provider, stt-provider, key management); FR-5.1, FR-5.2, FR-5.3, FR-5.6
**Depends On**: Task 4.1
**Validation Notes**: TTS `POST /v1/text-to-speech/{voiceId}?output_format=…`; mimeType from format (`audio/mpeg` mp3, `audio/ogg` opus). STT Scribe `POST /v1/speech-to-text` multipart (`FormData`+`Blob`), encoded recording uploads as-is (no ffmpeg). `listVoices` `GET /v1/voices`. Capability `{ id:'elevenlabs', kind:'cloud', requiresApiKey:true, requiresDownload:false, available: vaultPresent }`. `downloadModel` no-op `{ alreadyPresent:true }`.

### Task 4.3: ElevenLabs specs ✅ COMPLETE

**Files (CREATE)**: `elevenlabs-client.spec.ts`, `elevenlabs-tts-provider.spec.ts`, `elevenlabs-stt-provider.spec.ts` (or a consolidated `elevenlabs-*.spec.ts` set)
**Spec Reference**: implementation-plan.md §11 (ElevenLabs adapters row)
**Depends On**: Task 4.2
**Validation Notes**: Mocked global `fetch`: TTS URL/query/format/headers, voices parse, Scribe multipart fields, full error-mapping table, **assert `xi-api-key` value absent from `error.message`** (R6 regression), Zod drift failure.

**Batch 4 Verification**:

- `npx nx typecheck voice-providers` + `npx nx lint voice-providers` green
- `npx nx test voice-providers` green (incl. no-leakage assertions)
- code-logic-reviewer approved (mandatory focus: every `catch` path sanitized, no key/body in thrown messages — R6)

---

## Batch 5: RPC + Push Surface ✅ COMPLETE (verified, committed fe673f7de)

**Recommended Executor**: `backend-developer` (Task-tool sub-agent)
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential (single sub-agent). Shared-types edits (`rpc.types.ts`) and handler edits are interdependent (compile-time coverage assertion couples `METHODS` tuple ↔ method map); parallel split would race the same files.
**Rationale**: Dual-registration correctness across `libs/shared` + `rpc-handlers` + Zod schemas is a single compile-time contract; must be authored coherently.
**FRs**: FR-8 (8.1–8.4), FR-7 backend (7.1, 7.3) | **Dependencies**: Batch 4
**Goal**: Add the 6 new `voice:` methods (provider-agnostic), extend shared types + Zod schemas, add the `VOICE_PROVIDER_ERROR` push message, and broadcast cloud-category failures — no `ALLOWED_METHOD_PREFIXES` edit (`voice:` already covered; verify).

### Task 5.1: Shared RPC types + push message contract ✅ COMPLETE

**Files (MODIFY)**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (6 method-map entries after :1599; param/result DTOs after :2215; literal method-presence map :2625-2632; extend `VoiceSetConfigParams` with optional `modelSource`/`customModel`), `libs\shared\src\lib\types\messages\{message-constants.ts, voice.ts, payload-map.ts}` (`VOICE_PROVIDER_ERROR: 'voice:providerError'` + `VoiceProviderErrorPayload`)
**Spec Reference**: implementation-plan.md §7 (method inventory, dual-registration checklist, FR-7 push channel); FR-8.2, FR-8.3
**Validation Notes**: Append-only protocol additions. New methods: `voice:listProviders`, `voice:listVoices`, `voice:getProviderConfig`, `voice:setProviderConfig`, `voice:setApiKey`, `voice:testConnection`. `voice:getProviderConfig` result carries **no key material** (only `apiKeyConfigured: boolean`).

### Task 5.2: Handler methods + Zod schemas + broadcast ✅ COMPLETE

**Files (MODIFY)**: `libs\backend\rpc-handlers\src\lib\handlers\voice-rpc.handlers.ts` (implement 6 methods via registry/selector; extend `METHODS` tuple; FR-7 broadcast on cloud-category transcribe/synthesize failures), `libs\backend\rpc-handlers\src\lib\handlers\voice-rpc.schema.ts` (Zod for new methods + extended setConfig)
**Spec Reference**: implementation-plan.md §7 (new-6 table, FR-7 broadcast); FR-8.1, FR-8.4, FR-7.1, FR-7.3
**Depends On**: Task 5.1
**Validation Notes**: `METHODS.length` must equal 14 (register-all coverage assertion). Cloud failures → `{ ok:false, error, code:'VOICE_PROVIDER_ERROR', category, providerId }` AND broadcast `voice:providerError`; local assets errors keep `VOICE_ASSETS_UNAVAILABLE`. **No retry, no substitution** — error result still returns to caller. Verify `voice:` present in `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:78`) — do NOT edit unless a non-`voice:` method is added.

### Task 5.3: RPC handler specs ✅ COMPLETE

**Files (MODIFY)**: `voice-rpc.handlers.spec.ts`
**Spec Reference**: implementation-plan.md §11 (RPC handlers row)
**Depends On**: Task 5.2
**Validation Notes**: 14 methods registered = `METHODS.length`; `voice:getProviderConfig` response has no `apiKey`/cipher fields (security regression); FR-7 broadcast fired on cloud-category failure and NOT on local failure; Zod rejection per new schema.

**Batch 5 Verification**:

- `npx nx typecheck rpc-handlers shared` green (register-all coverage assertion passes)
- `npx nx lint rpc-handlers shared` green
- `npx nx test rpc-handlers shared` green
- code-logic-reviewer approved (focus: no key material in `getProviderConfig`, broadcast fires only on cloud failure)

---

## Batch 6: Frontend Voice Settings ✅ COMPLETE (verified, committed fa4628ae0)

> **✅ FR-4.1 GAP CLOSED (Batch 6.5, committed `fffb075d9`):** local TTS (Kokoro) custom-model source (HF id / local dir) is now fully wired. 6.5a (backend) — `VoiceSetTtsConfigParams` + `TtsConfigDto` gained optional `modelSource`/`customModel` (append-only); `setTtsConfig` persists `voice` + `voice.kokoroModelSource`/`voice.kokoroCustomModel`; `getTtsConfig` round-trips them; Zod schema extended. 6.5b (frontend) — `local-tts-panel` gained the Curated/HF/Local-folder source toggle + validated custom input (`customModelValid` byte-identical to `local-stt-panel`), seeded from `voice:getTtsConfig`. **FR-4.1 now complete for BOTH STT and TTS.** Verified: rpc-handlers 1267 / chat 580, di-lint OK, webview production build green.

**Recommended Executor**: `frontend-developer` (Task-tool sub-agent)
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential (single sub-agent) with an **optional parallel split**: the 3 provider panels (`local-stt-panel`, `local-tts-panel`, `elevenlabs-panel`) are file-disjoint and could be authored by two concurrent frontend-developer invocations — BUT the container rewrite (`voice-config.component.ts`) and the error service/toast + `MESSAGE_HANDLERS` registration must land first/coherently. Recommend single sub-agent unless the orchestrator wants a panels-only parallel pass after the container lands.
**Rationale**: Angular signals/OnPush component work in one existing home (`settings/ptah-ai/`); tight visual/state cohesion favors one owner. Backend↔frontend isolation: shared types only.
**FRs**: FR-6 (6.1–6.6), FR-7 UI (7.2, 7.4) | **Dependencies**: Batch 5
**Goal**: Rewrite the voice settings surface as a provider container + 3 per-provider panels, add the provider-error service + switch-to-local toast, register the new message handler — no legacy panel left behind.

### Task 6.1: Container rewrite ✅ COMPLETE

**File (MODIFY, rewrite in place)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\voice-config.component.ts` (+ spec)
**Spec Reference**: implementation-plan.md §8 (voice-config container); FR-6.1, FR-6.2, FR-6.6
**Validation Notes**: On init calls `voice:listProviders` + `voice:getProviderConfig`; two labelled provider `<select>`s (STT/TTS) from backend list (disabled + `unavailableReason` tooltip when `available:false`); `@switch` renders exactly one panel per direction; provider change → `voice:setProviderConfig` with optimistic-revert. Signals + `inject()`, OnPush, new control flow, no `[innerHTML]`.

### Task 6.2: Provider panels (parallel-eligible trio) ✅ COMPLETE (FR-4.1 TTS custom-source closed in Batch 6.5 / fffb075d9)

**Files (CREATE)**: `src\lib\settings\ptah-ai\{local-stt-panel.component.ts, local-tts-panel.component.ts, elevenlabs-panel.component.ts}` (+ specs)
**Spec Reference**: implementation-plan.md §8 (local-stt-panel, local-tts-panel, elevenlabs-panel); FR-6.2, FR-6.3, FR-6.4, FR-4.1, FR-5.3
**Depends On**: Task 6.1 (needs container `@switch` contract)
**Validation Notes**: local-stt — curated model select + source toggle (Curated/HF/Local folder) + validated custom input; download progress via `VoiceDownloadProgressService` keyed by model name. local-tts — voices via `voice:listVoices {providerId:'local'}`, custom source, preview + `'tts'` progress sentinel preserved. elevenlabs — masked key (`type=password`, "Configured ●●●", never a value), Test-connection button (pending/inline result via `voice:testConnection`), Save → `voice:setApiKey`, voice dropdown via `voice:listVoices {providerId:'elevenlabs'}`, TTS model + output-format + STT-model selects, NO download UI.

### Task 6.3: Error service + switch-to-local toast + handler registration ✅ COMPLETE

**Files (CREATE)**: `src\lib\services\voice-provider-error.service.ts` (+ spec), `src\lib\...\molecules\notifications\voice-provider-error-toast.component.ts` (+ spec)
**Files (MODIFY)**: webview `MESSAGE_HANDLERS` registration site in `D:\projects\ptah-extension\apps\ptah-extension-webview` (add `VoiceProviderErrorService`)
**Spec Reference**: implementation-plan.md §8 (voice-provider-error.service, error-toast, MESSAGE_HANDLERS); FR-7.2, FR-7.4
**Depends On**: Task 6.1
**Validation Notes**: Service is a `MessageHandler` for `MESSAGE_TYPES.VOICE_PROVIDER_ERROR` exposing `latestError` signal + `dismiss()` (mirror `VoiceDownloadProgressService`). Toast: categorized message + **"Switch to local"** → `voice:setProviderConfig { [direction]Provider:'local' }` → dismiss + re-read `voice:getProviderConfig`. Never auto-applies (FR-7.3).

**Batch 6 Verification**:

- `npx nx typecheck chat` (+ webview host) green
- `npx nx lint chat` green (OnPush + no `[innerHTML]` confirmed)
- `npx nx test chat` green (masked-key-never-displays, panel-switch, switch-to-local invokes RPC + dismisses)
- code-logic-reviewer approved

---

## Batch 7: QA Gates ⏸️ PENDING

**Recommended Executor**: `senior-tester` (Task-tool sub-agent), with `modernization-detector` (Task-tool sub-agent) for the future-enhancements deliverable
**Fallback Executor**: `senior-tester`
**Execution Mode**: sequential. Within the batch, the senior-tester QA work and the modernization-detector scan are file-disjoint and **parallel-eligible** — the orchestrator may spawn both concurrently.
**Rationale**: Terminal QA/verification + secret-leak review + modernization scan; no product code authored (findings/reports only).
**FRs**: FR-2.4 (crash regression), FR-3.2 (packaged pin), FR-9.4 (grep audit), R5 (marketplace), R6 (secret review) | **Dependencies**: Batch 6
**Goal**: Prove the headline crash scenario is fixed on a packaged build, verify the pin propagated, audit for secret leakage + trademark strings, and record the user-requested follow-up.

### Task 7.1: Crash-regression gate (FR-2.4 headline) ⏸️ PENDING

**Spec Reference**: implementation-plan.md §11 (Crash regression row); FR-2.4, FR-2.2
**Acceptance**: On a **packaged** build — (a) start workspace indexing (embedder active) → loop `voice:transcribe` + `voice:synthesize` 2+ min → app alive, `%APPDATA%\Ptah\logs` shows no truncated/silent-abort; (b) kill the voice `utilityProcess` mid-request → in-flight request returns structured `process-crashed` error, next request succeeds (respawn).

### Task 7.2: Packaged-app pin + payload verification ⏸️ PENDING

**Spec Reference**: implementation-plan.md §6, §11 (Pin verification), R2, R5; FR-3.2
**Acceptance**: `verify-packed-onnx.js` passes (packaged onnxruntime-node === 1.20.1); `voice-worker.mjs` present in packaged app; kokoro voices `extraResources` present; `npm ls onnxruntime-node` → 1.20.1 documented. VSIX payload audit: `elevenlabs` string appears only in TS/JS sources + `~/.ptah/settings.json`, never in `package.json contributes` or VSIX markdown/manifest (R5 — burned-ID gate).

### Task 7.3: Secret-leak review + FR-9.4 grep audit ⏸️ PENDING

**Spec Reference**: implementation-plan.md §9 (FR-9.4), §11, R6; NFR security
**Acceptance**: Review all ElevenLabs `catch` paths — no key/body/header in thrown messages, logs, or RPC responses (R6). FR-9.4 grep: `WhisperTranscriber|KokoroSynthesizer|FfmpegDecoder` returns hits only inside `libs/backend/voice-providers`.

### Task 7.4: Test report + future-enhancements (modernization-detector) ⏸️ PENDING

**Files (CREATE)**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_VOICE_PROVIDERS\test-report.md` (senior-tester), `D:\projects\ptah-extension\.ptah\specs\TASK_2026_VOICE_PROVIDERS\future-enhancements.md` (modernization-detector)
**Spec Reference**: Out-of-scope list (streaming TTS, other vendors) + D7
**Acceptance**: `test-report.md` summarizes all gates above with pass/fail evidence. `future-enhancements.md` MUST include the user-requested follow-up verbatim: **"Migrate memory embedder from worker_threads to utilityProcess reusing the voice worker process-factory pattern"** — plus streaming-TTS playback, PCM output formats, and additional cloud vendors as adapter-sized items.

**Batch 7 Verification**:

- All QA gates green in `test-report.md`
- `future-enhancements.md` contains the embedder-migration follow-up (required)
- Orchestrator advances to MODE 3 completion / user QA choice

---

## Executor Dispatch Notes (for orchestrator)

- **All executors are Task-tool sub-agents** — CLI delegation disabled. Never `ptah_agent_spawn`.
- **Sequential between batches**: do not start Batch N+1 until team-leader marks Batch N ✅ COMPLETE (verified + reviewed + committed).
- **team-leader owns git** — sub-agents never commit; each batch commits only after a `NEEDS REVIEW` → `code-logic-reviewer` → APPROVED cycle.
- **Batch 3 is the critical path** — highest risk, must land atomically; budget accordingly. `senior-tester` may assist on Task 3.6 specs after the batch is functionally green.
- **Optional intra-batch parallelism** (two concurrent same-type sub-agents on file-disjoint work): Batch 6 panels trio (after container), Batch 7 senior-tester + modernization-detector. All other batches: single sub-agent.

---

## FINAL SUMMARY — ✅ IMPLEMENTATION COMPLETE (MODE 3 close-out)

**TASK_2026_VOICE_PROVIDERS** delivered end-to-end: voice is now a ports-and-adapters surface (local Kokoro/Whisper isolated in an Electron `utilityProcess`, ElevenLabs TTS + Scribe STT as bring-your-own-key cloud provider), with the `onnxruntime-node@1.20.1` crash-fix pin propagated through dev tree **and** packaged app.

### Committed increments (8)

| #   | Commit      | What shipped                                                                                                                                                                                                                      |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `d2fa6b8e1` | Batch 1 (onnx 1.20.1 pin + verifier scripts, FR-3) + Batch 2 (voice-contracts zero-dep lib, FR-1) + Batch 3 core (voice-providers local path, worker isolation, reroute, FR-2/4/9) — swept in with the user's knowledge-agent WIP |
| 2   | `c35b10e43` | Batch 4 (ElevenLabs TTS + Scribe STT adapters, FR-5) + Batch 3.6 process-isolation specs + Batch 3 factory esbuild fix (`utilityProcess` CJS interop)                                                                             |
| 3   | `fe673f7de` | Batch 5 (6 provider-agnostic `voice:` RPC methods + `voice:providerError` push channel, FR-8 + FR-7 backend)                                                                                                                      |
| 4   | `fa4628ae0` | Batch 6 (provider-based voice settings UI + ElevenLabs panel + switch-to-local toast, FR-6 + FR-7 UI)                                                                                                                             |
| 5   | `fffb075d9` | Batch 6.5 (local-TTS custom model source — HF id / local dir — closing the FR-4.1 gap; STT + TTS now at parity)                                                                                                                   |
| 6   | `f882aab2b` | Batch 7.5 (packaging fix: reconcile onnxruntime-node declared dep for electron-builder's traversal collector; + messaging-gateway CLAUDE.md/externals cleanup)                                                                    |

_(Batch 7 QA gates produced `test-report.md` + `future-enhancements.md` — reports, not code commits. `future-enhancements.md` records the user-requested follow-up: "Migrate memory embedder from worker_threads to utilityProcess reusing the voice worker process-factory pattern.")_

### QA verdict: **PASS (automated)**

- All automated gates green across the chain: `di-lint OK` (1217 inject sites / 530 tokens), `build-main:production`, `verify-packed-onnx.js` (packaged onnxruntime-node = 1.20.1, exit 0), `npm ls onnxruntime-node` → 1.20.1 overridden, typecheck + lint + tests on voice-contracts / voice-providers / rpc-handlers / messaging-gateway / chat / shared / ptah-electron, webview production build.
- FR-9.4 grep audit clean (`WhisperTranscriber|KokoroSynthesizer|FfmpegDecoder` only inside voice-providers). R6 secret-leak review passed (ElevenLabs error chokepoint, no key/body in thrown messages; `getProviderConfig` exposes only `apiKeyConfigured`). FR-4.1 complete for both STT and TTS.

### Residuals — USER-MUST-RUN (not code blockers)

1. **Manual FR-2.4 crash-regression protocol** (per `test-report.md` §7): on a real packaged/installed build, run concurrent memory indexing + a `voice:transcribe`/`voice:synthesize` loop for 2+ min and confirm no silent native abort in `%APPDATA%\Ptah\logs`, plus the kill-voice-`utilityProcess`-mid-request → `process-crashed` + respawn scenario. Requires an installed build to exercise.
2. **Signed-installer prerequisite (Windows local dev only):** `nx package ptah-electron` now proceeds past the onnx traversal-collector abort and produces `win-unpacked` with the correct pin, but full installer generation needs Windows **Developer Mode** (or an elevated shell) so electron-builder can 7z-extract `winCodeSign-2.6.0.7z` (symlink privilege). Pre-existing, unrelated to this task; CI Windows runners already satisfy it.
