# Batch 3 Tests Report — TASK_2026_VOICE_PROVIDERS (Task 3.6)

## Scope

Batch 3 backend-developer landed the local voice path (worker isolation via
Electron `utilityProcess`, moved/de-DI'd pipelines, worker client, registry/
selector, secret store, DI wiring) with green typecheck/build/lint but no
specs, and left `voice-rpc.handlers.spec.ts` broken (still importing the
deleted messaging-gateway concrete classes with the old 7-arg constructor).
This task closes both gaps.

## Job 1 — Fixed the rerouted spec

**File**: `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.spec.ts` (full rewrite)

- Removed all imports of `FfmpegDecoder` / `WhisperTranscriber` /
  `KokoroSynthesizer` / `VoiceAssetsUnavailableError` from
  `@ptah-extension/messaging-gateway` (those symbols no longer exist there).
- Rebuilt the harness around the new 6-arg constructor
  `(logger, rpcHandler, workspace, selector, registry, webviewManager)`.
- Added fakes for `IVoiceProviderSelector` (`activeTts`/`activeStt` returning
  fake TTS/STT providers, `downloadEvents`) and `IVoiceProviderRegistry`
  (`getTts('local')`/`getStt('local')`), plus a `FakeDownloadEvents` helper
  (`onDownload`/`emit`/`listenerCount`) that stands in for the worker-client's
  `IVoiceDownloadEventSource` so tests can drive `download-progress` ticks
  directly, mirroring the old `whisper.on`/`kokoro.on` capture pattern at the
  new port boundary.
- `VOICE_ASSETS_UNAVAILABLE` / `VOICE_ASSETS_REMEDIATION` /
  `VoiceProviderError` / `isVoiceProviderError` now imported from
  `@ptah-extension/voice-contracts`.
- Preserved all 8 methods' exact wire-result shapes (`voice:transcribe`,
  `voice:getConfig`, `voice:setConfig`, `voice:downloadModel`,
  `voice:getTtsConfig`, `voice:setTtsConfig`, `voice:downloadTtsModel`,
  `voice:synthesize`), the `voice:modelDownloadProgress` broadcast with
  `{model, percent}` (incl. the `'tts'` sentinel), and the
  `VOICE_ASSETS_UNAVAILABLE` `code` + `remediation` contract on
  local-assets-missing.
- Dropped tests that asserted implementation details that moved out of the
  RPC layer in the reroute (ffmpeg decode call, `whisper.configure`/
  `kokoro.configure` calls) — those now live inside `LocalSttProvider`/
  `LocalTtsProvider`/the worker pipelines, which Job 2 covers directly.
  Replaced the old "ignore a different model's progress tick" assertion with
  "ignore a different-**direction** progress tick" since the real handler
  code (read from source, not assumed) filters `download:*` events by
  `evt.direction` only, not by `evt.model` — the closure `model`/`'tts'`
  sentinel is what gets broadcast regardless of `evt.model`.
- Added a couple of small regression tests beyond the original set: a
  non-`assets-unavailable` `VoiceProviderError` category does **not** get the
  `VOICE_ASSETS_UNAVAILABLE` code (`process-crashed` passthrough), and
  `voice:synthesize` passes the provider's `mimeType` through unmodified
  (forward-looking coverage for cloud audio, even though ElevenLabs lands in
  Batch 4).

Full rpc-handlers suite: **62 test suites, 1243 passed / 2 skipped, 0
failed** (`npx nx test rpc-handlers`).

## Job 2 — New Task 3.6 specs

All colocated with sources under `libs/backend/voice-providers/src/lib/`.

| File                                | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker/voice-worker-core.spec.ts`  | 15    | id-correlated protocol dispatch (init/transcribe/synthesize/download/dispose/unknown-type), error category serialization (`VoiceProviderError` category passthrough vs. plain-`Error` → `provider-error` default), download-progress forwarding keyed by model display name (curated/hf/dir), "not initialized" error before `init`, interleaved-request id correlation                                                                                                                                                                                                                                                                                                                                                                                                               |
| `worker/whisper-pipeline.spec.ts`   | 19    | `whisperModelIdFor` curated→Xenova mapping + `large-v3-turbo`→onnx-community override, transcript bracket-stripping/trim (string and `{text}` result shapes), `VoiceModelSpec` hf (repo id verbatim)/dir (`allowLocalModels`+`localModelPath`) resolution, pipeline caching + reload-on-spec-change + retry-after-failure, per-file byte-progress aggregation monotonicity + 99% clamp + raw-`progress`-field fallback, `model-invalid` wrapping naming the failing hf repo/dir (and NOT wrapping curated failures), `VoiceProviderError` passthrough (assets-unavailable) unchanged                                                                                                                                                                                                  |
| `worker/kokoro-pipeline.spec.ts`    | 15    | default-voice fallback, empty-curated-name→`DEFAULT_KOKORO_MODEL_ID`, hf/dir resolution, dtype-aware cache key, per-file progress aggregation, `voices/<name>.bin` ENOENT→assets-unavailable naming the voice (and non-matching ENOENT paths passed through unmapped), `model-invalid` wrapping for hf/dir (not curated), `VoiceProviderError` passthrough                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `local/voice-worker-client.spec.ts` | 15    | request/response round trip (transcribe/synthesize/downloadStt/downloadTts), ok:false→`VoiceProviderError` with worker-supplied category, download-progress fan-out (+ listener disposal), **respawn after exit** (pending rejected `process-crashed`, next call spawns fresh — both crash exit and clean exit code 0, proving no permanent failed flag), **idle teardown with fake timers** (spawn→settle→arm→fire→kill+dispose-message; timer cancellation + re-arm when a new request lands before it fires, verified with two separate `advanceTimersByTime` steps), **crash-loop backoff** (3 exits in-window → 4th request refused without a new spawn), `dispose()` idempotency, `available` getter + `assets-unavailable` when no factory is registered (VS Code/CLI degrade) |
| `voice-provider-selector.spec.ts`   | 11    | default `'local'` for both directions, explicit `'elevenlabs'` resolution, defensive fallback to `'local'` on an unrecognized stored value, independent tts/stt keys, `activeTts`/`activeStt` resolve via `registry.getTts/getStt('local')`, **selecting an unavailable provider throws at call time** with `category: 'provider-error'` + the offending `providerId`, `setProvider` persists via the workspace write-capability probe and is reflected by the next `activeProviderId` read, no-op (no throw) when `setConfiguration` is absent, `downloadEvents` exposed as the injected instance                                                                                                                                                                                    |
| `voice-secret-store.spec.ts`        | 13    | `isConfigured` without decrypting, ciphertext-only persistence under `voice.elevenlabs.apiKeyCipher`, `setKey`/`getKey` round trip via the vault, **decrypt-null → `getKey` returns null while `isConfigured` stays true** (the "re-enter your API key" UX path), decrypt-throw is caught and logged **without leaking plaintext**, `getKey` returns null when no vault is registered, empty-string `setKey`/`clearKey` clear the cipher, failure modes (`setKey` throws with no vault; throws for a provider with no cipher-key mapping), and a dedicated **plaintext-never-logged** regression scanning every logger call across `setKey`/`getKey`/`isConfigured`                                                                                                                   |

**Totals**: 6 new spec files, 88 tests, all passing.

### Notable implementation-driven test decisions (read source before writing tests)

- `VoiceWorkerCore`'s `download-progress` broadcast for `voice:downloadModel`
  is keyed by direction only (`evt.direction !== 'stt' → ignore`), not by
  model name — carried this exact filtering behavior into both the rpc-handlers
  fix (Job 1) and is implicitly exercised via the client's pass-through in Job 2.
- `WhisperPipeline`/`KokoroPipeline`'s `MODULE_NOT_FOUND` → `assets-unavailable`
  mapping lives **only** inside the un-exported `defaultPipelineFactory`
  (the real dynamic-import wrapper), not in `ensurePipeline()` itself.
  Since both `@huggingface/transformers` and `kokoro-js` are actually present
  in `node_modules` (used by other subsystems), a MODULE_NOT_FOUND path isn't
  naturally reachable through the public seam without loading real ONNX.
  Tests instead assert the seam that IS under this class's control: a
  `VoiceProviderError` thrown by the injected `pipelineFactory` propagates
  **verbatim** (not re-wrapped as `model-invalid`), for both curated and
  hf/dir specs. This is the correct unit boundary — `defaultPipelineFactory`'s
  own MODULE_NOT_FOUND mapping is production code with no test seam and was
  left as-is per instructions (no production changes beyond trivial wiring).

## Verification

```
npx nx test rpc-handlers        → 62 suites, 1243 passed / 2 skipped, 0 failed
npx nx test voice-providers     → 6 suites, 88 passed, 0 failed
npx tsc --noEmit --project libs/backend/voice-providers/tsconfig.spec.json  → clean
npx tsc --noEmit --project libs/backend/rpc-handlers/tsconfig.spec.json    → clean
npx nx run-many -t typecheck -p voice-providers rpc-handlers → both green (lib-only tsconfig; spec tsconfigs verified separately above since the typecheck target only compiles tsconfig.lib.json, which excludes *.spec.ts)
npx nx lint voice-providers     → 0 problems
npx nx lint rpc-handlers        → 0 errors, 9 pre-existing warnings (all in files untouched by this task)
grep -rnE "WhisperTranscriber|KokoroSynthesizer|FfmpegDecoder" libs apps | grep -v voice-providers → no hits (FR-9.4 clean)
```

## IMPL BUG flags

None found. Read every source file under test before writing specs
(`voice-worker-core.ts`, `whisper-pipeline.ts`, `kokoro-pipeline.ts`,
`voice-worker-client.ts`, `worker-process.port.ts`,
`voice-provider-selector.ts`, `voice-secret-store.ts`,
`voice-provider-registry.ts`, `local-stt-provider.ts`,
`local-tts-provider.ts`, `model-settings.ts`, `model-paths.ts`,
`voice-rpc.handlers.ts`) — behavior matched the implementation plan
(§3/§4/§11) and the task validation notes in every case tested (respawn/no
permanent failed flag, idle teardown + cancellation, crash-loop guard,
`VoiceModelSpec` hf/dir handling + `model-invalid` naming, ciphertext-only
persistence, decrypt-null → auth-style degrade, default-local +
persist-switch, unavailable-provider-throws-at-call-time). No stubs,
placeholders, or dummy logic encountered.

## Not covered here (explicitly out of scope for Task 3.6 / Batch 3)

- ElevenLabs adapters + specs — Batch 4.
- The 6 new `voice:*` RPC methods — Batch 5.
- Frontend component specs — Batch 6.
- `gateway.service.spec.ts` fake-STT-port rework — this was listed under
  Task 3.5 (backend-developer), not 3.6; not touched here. Sanity-checked
  anyway: `npx nx test messaging-gateway` → 11 suites passed (1 skipped),
  192 passed / 32 skipped, 0 failed — Task 3.5's rework was already done
  correctly and needed no fix.
- `build-voice-worker` esbuild target / packaged `voice-worker.mjs`
  verification — Batch 3 Task 3.4 concern, not assigned to senior-tester
  here.
