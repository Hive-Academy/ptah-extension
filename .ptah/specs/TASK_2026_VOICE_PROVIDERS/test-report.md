# Test Report — TASK_2026_VOICE_PROVIDERS (Batch 7 QA Sign-Off)

**Verdict: CONCERNS**

One CRITICAL, reproducible defect found in gate 3 (packaged-build pin verification): `nx package ptah-electron` currently **fails to produce a packaged app at all** with the `onnxruntime-node@1.20.1` override in place. Every other gate is green. All automated test suites pass. The defect blocks FR-3.2 sign-off and, transitively, the manual FR-2.4 crash-regression protocol (which requires a packaged/installed build) until fixed.

---

## 1. Full affected test + gate sweep

Command: `npx nx run-many -t test -p voice-contracts voice-providers rpc-handlers messaging-gateway shared chat`

| Project             | Suites                     | Tests                  | Result                                                                                                                                                  |
| ------------------- | -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice-contracts`   | —                          | —                      | No `test` target (zero-dep types-only lib — same convention as `memory-contracts`, verified: neither project.json declares a `test` target). Not a gap. |
| `voice-providers`   | 9 passed                   | 124 passed             | PASS                                                                                                                                                    |
| `rpc-handlers`      | 62 passed                  | 1267 passed, 2 skipped | PASS                                                                                                                                                    |
| `messaging-gateway` | 11 passed, 1 skipped suite | 192 passed, 32 skipped | PASS                                                                                                                                                    |
| `shared`            | 23 passed                  | 403 passed             | PASS                                                                                                                                                    |
| `chat`              | 44 passed                  | 580 passed, 2 skipped  | PASS                                                                                                                                                    |

Skip audit (to rule out hidden voice regressions): the skipped messaging-gateway suite/tests are pre-existing environment-conditional guards unrelated to voice — `workspace-resolution.spec.ts:10` (`process.platform === 'win32' ? it : it.skip`), `conversation.store.spec.ts:34` / `binding.store.spec.ts:46` (`nativeAvailable ? describe : describe.skip`, native SQLite binding gate). The 2 skipped in `rpc-handlers`/`chat` are likewise pre-existing and not voice-related (spot-checked, no `voice`/`elevenlabs` string in the skip names).

Other gates:

- `npx nx run di-lint:lint` → **PASS**: `di-lint OK: 1217 @inject sites all resolve to a registered token (530 tokens)`
- `npx nx run ptah-electron:build-main:production` → **PASS** (cached green, 23/23 tasks)
- `npx nx run ptah-electron:build-voice-worker` → **PASS**; confirmed `dist/apps/ptah-electron/voice-worker.mjs` exists (24,684 bytes, freshly built)
- `npm ls onnxruntime-node` → `@huggingface/transformers@3.8.1 └─ onnxruntime-node@1.20.1 overridden` — pin resolves correctly in the dev tree.
- Root `package.json:268` and `apps/ptah-electron/package.json:54-56` both carry `"onnxruntime-node": "1.20.1"` in `overrides`.
- `apps/ptah-electron/project.json`: confirmed `patch-dist-overrides.js` wired into `build` (line ~197), `build-voice-worker` wired into `build`/`build-dev`/`serve`/`serve:watch` dependency chains, `verify-packed-onnx.js` wired into `package` after electron-builder (line ~272).

**Automated-verified.**

---

## 2. Respawn/crash-isolation (automated proxy for "kill mid-request")

File: `libs/backend/voice-providers/src/lib/local/voice-worker-client.spec.ts` (all assertions confirmed present and passing as part of the sweep above).

Confirmed coverage:

- `describe('respawn after exit (FR-2.2)')` — in-flight request rejects with `{ category: 'process-crashed', providerId: 'local' }` on worker `exit`; the very next `.transcribe()` call spawns a **fresh** worker (`workers` array grows to a 2nd entry) and resolves normally. Also asserts a _clean_ exit (code 0) still respawns — no permanent `workerFailed` flag (deliberate FR-2.2 requirement).
- `describe('idle teardown (FR-2.2 + R7)')` — fake-timer tests: worker torn down (`dispose` message + `kill()`) after the idle window once in-flight settles; a new request before the timer fires cancels it and reuses the warm worker.
- `describe('crash-loop backoff')` — 3 exits within the crash-loop window → the 4th request is refused with `process-crashed` **without spawning a new worker** (verified `workers` stays at length 3).
- `describe('dispose')` — rejects pending requests, kills the worker, idempotent on double-dispose.
- `describe('unavailable runtime (no worker factory)')` — degrades to `assets-unavailable` instead of attempting a spawn (VS Code/CLI parity).

This is a legitimate, thorough automated proxy for "kill the process mid-request → in-flight rejects with `process-crashed`, next request respawns, crash-loop backoff." **Automated-verified**, but it is a unit-level proxy against a **fake** `IVoiceWorkerProcess` (message loopback) — it does not exercise a real `utilityProcess.fork()` or an actual native ONNX abort. The real-process variant is covered in §7 (USER-MUST-VERIFY).

---

## 3. Packaged-pin verification — **CONCERNS (defect found)**

### 3a. Static review of the verifier scripts — PASS

- `apps/ptah-electron/scripts/verify-packed-onnx.js`: recursively walks `dist/release/**/app.asar.unpacked/node_modules/**/onnxruntime-node/package.json`, asserts `version === '1.20.1'` for every manifest found, exits non-zero (with a clear remediation message) on any mismatch or if zero manifests are found. Logic is correct and mirrors the `verify-packed-native.js`/`verify-packed-wasm.js` precedent.
- `apps/ptah-electron/scripts/patch-dist-overrides.js`: asserts/injects `overrides.onnxruntime-node = "1.20.1"` into the **generated** `dist/apps/ptah-electron/package.json`, exits non-zero if that manifest is missing. Logic is correct.

### 3b. Actual packaged-build attempt — **FAIL**

Ran `npx nx package ptah-electron` (native rebuild skipped — `better-sqlite3` already built for Electron ABI 143; webview + main + voice-worker + embedder-worker builds all succeeded; `patch-dist-overrides.js` confirmed the pin already present in the generated manifest). electron-builder itself then failed **before** `verify-packed-onnx.js` ever ran:

```
• using manual traversal of node_modules to build dependency tree
⨯ production dependency not found  parent=@huggingface/transformers dependency=onnxruntime-node version=1.21.0
⨯ Production dependency onnxruntime-node not found for package @huggingface/transformers
    at node_modules/app-builder-lib/src/node-module-collector/traversalNodeModulesCollector.ts:119
Warning: command "electron-builder --config electron-builder.yml --project dist/apps/ptah-electron" exited with non-zero status code
```

**Root cause (verified by inspection, not guesswork):**

- `node_modules/@huggingface/transformers/package.json` still declares `"onnxruntime-node": "1.21.0"` in its own `dependencies` (npm `overrides` rewrites the _resolved_ version, not the dependent's own manifest text — this is correct/expected npm behavior).
- The only physical `onnxruntime-node` install on disk is `node_modules/@huggingface/transformers/node_modules/onnxruntime-node@1.20.1` (confirmed via `cat package.json` → `"version": "1.20.1"`). There is **no** `node_modules/onnxruntime-node` at root at all (npm didn't need to hoist it since the override made 1.20.1 the sole version in the whole tree, fully nested under `transformers`).
- `npm ls onnxruntime-node` resolves this fine (npm's own resolver understands overrides). But electron-builder's **`traversalNodeModulesCollector`** (used here because there's no `pm=npm`-detectable lockfile situation it can use directly — the log shows it tried `pm=npm` first, then fell back to `pm=traversal`) walks each dependency's **own declared version string** and looks for a literal matching folder/version — it has no concept of npm `overrides`. Since it wants a package satisfying the literally-declared `"1.21.0"` and only `1.20.1` physically exists, it reports "production dependency not found" and aborts the entire package step.
- This is **not flaky** — it is a deterministic mismatch between (a) the intentionally-overridden physical install and (b) electron-builder's version-literal traversal algorithm. It reproduces every time `nx package ptah-electron` is run with the current override in place.

**Impact:** `verify-packed-onnx.js` never gets a chance to run — the packaging pipeline itself is broken by the pin, not just unverified. This is a genuine regression the R2/FR-3.2 mitigation did not anticipate (Batch 1's regression spike ran `npm ls` + typecheck + existing test suites, but never attempted a full `nx package`). **This must be fixed before this feature can ship a real release build.**

**Repro command:** `npx nx package ptah-electron` (from repo root, after `npx nx build ptah-electron` has produced `dist/apps/ptah-electron`).
**Failing file (electron-builder internal, for context only — not ours to patch)**: `app-builder-lib/src/node-module-collector/traversalNodeModulesCollector.ts:119`.
**Our files implicated**: the `overrides` entries in `package.json:268` (root) and `apps/ptah-electron/package.json:54-56`, and by extension `apps/ptah-electron/scripts/patch-dist-overrides.js` (which correctly does its job — the failure is downstream of it, in electron-builder itself).

Suggested directions for the fix (for the orchestrator/architect to evaluate, not applied here): electron-builder supports specifying `nodeModulesCollector`/`pm` behavior, or the override could be paired with a physical duplication step so a `1.21.0`-labeled copy also exists on disk, or `npm install` could be run with a lockfile electron-builder's `pm=npm` path can consume directly (avoiding the `traversal` fallback). Root-causing which of these electron-builder actually needs is architecture work, not QA.

**Other 3b sub-checks** (kokoro voices `extraResources`, `voice-worker.mjs` presence) could not be completed because packaging never reached the asar-assembly stage. `voice-worker.mjs` presence in the **build** output (pre-package) is confirmed independently in §1.

**Automated-attempted, FAILED — this is the headline CONCERNS item.**

---

## 4. FR-9.4 grep audit

Command: `grep -rn "WhisperTranscriber|KokoroSynthesizer|FfmpegDecoder"` repo-wide.

Hits (7 files), all inside `libs/backend/voice-providers` **except one**:

- `libs/backend/voice-providers/src/lib/worker/whisper-pipeline.ts` / `.spec.ts` — expected (moved pipeline, doc comment references the old class name for provenance)
- `libs/backend/voice-providers/src/lib/worker/kokoro-pipeline.ts` / `.spec.ts` — expected
- `libs/backend/voice-providers/src/lib/worker/ffmpeg-decode.ts` — expected
- `libs/backend/voice-providers/src/lib/local/model-paths.ts` — expected (doc comment)
- **`libs/backend/messaging-gateway/CLAUDE.md`** — **stale documentation**, NOT code. Lines 7, 20, 31, 48, 56, 61 still describe `FfmpegDecoder`/`WhisperTranscriber` as belonging to messaging-gateway ("Voice: `FfmpegDecoder`, `WhisperTranscriber`", listed in Public API/Internal Structure/Dependencies/Guidelines) — this contradicts the actual Batch 3 move. Confirmed via `git log` that this file has not been touched since `c439fb9bd` (predates the voice-providers work entirely) — Task 3.5's explicit acceptance item "update `libs/backend/messaging-gateway/CLAUDE.md`" was not done.

No runtime/functional impact — grep confirms zero source-code references to the concrete classes outside `voice-providers`. This is a documentation-accuracy gap only.

**Secondary minor finding (same root cause, also doc/build-config, not functional)**: `libs/backend/messaging-gateway/project.json:23-27` still lists `ffmpeg-static`, `@huggingface/transformers`, `onnxruntime-node` as `esbuild` externals even though `grep -rn` confirms zero imports of those packages remain in `libs/backend/messaging-gateway/src`. `nx lint messaging-gateway` passes clean (the `@nx/dependency-checks` rule does not flag unused-but-declared externals), so this is inert leftover config, not a lint/build failure — but it should be cleaned up alongside the CLAUDE.md fix.

**Automated-verified, minor CONCERNS (docs/config staleness, non-blocking).**

---

## 5. R6 secret-leak review

Reviewed every `catch`/throw path in `libs/backend/voice-providers/src/lib/elevenlabs/{elevenlabs-client.ts, elevenlabs-tts-provider.ts, elevenlabs-stt-provider.ts}` and the `mapElevenLabsError` chokepoint.

- `mapElevenLabsError` is the single error factory on every ElevenLabs failure path (network/auth/quota/provider-error). All messages are hardcoded, generic strings (`"ElevenLabs rejected the API key (authentication failed)."`, `"ElevenLabs request failed (HTTP <status>)."`, etc.) — never a response body, header, or key.
- `fetchOk()` catches transport failures and funnels them through `mapElevenLabsError({ cause: error })` — no raw error text surfaced.
- `toHttpError()` reads the error body **best-effort, for categorization only** (`ErrorBodySchema.safeParse`); the parsed `detail` is only used to pick a category (`quota_exceeded` → `quota`), never interpolated into a thrown message.
- The one `logger.debug` call in `fetchOk` logs only `{ path }` (voice id + output-format query string — no key material, confirmed by reading the call site).
- `VoiceSecretStore.getKey()` catches decrypt failures, logs `{ providerId, error: error.message }` (the _vault's_ error message, never the ciphertext or plaintext) and returns `null` → callers surface `auth`/"re-enter your API key".
- `ElevenLabsSttProvider.transcribe()`'s file-read catch throws a fully generic `"Could not read the recording to transcribe."` — the raw fs error is attached only as `cause` (not stringified into the message).
- Confirmed `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.spec.ts` has a dedicated `describe('R6 — xi-api-key never appears in a thrown message')` block plus per-call assertions (`expect(init.headers['xi-api-key']).toBe(API_KEY)`) proving the key is sent as a header and never echoed back in any error.

`voice:getProviderConfig` (`libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts:665-706`) returns `elevenlabs.apiKeyConfigured: boolean` only (`this.secretStore.isConfigured('elevenlabs')`) — no `apiKey`/cipher field anywhere in the returned object. `VoiceSecretStore.getKey()`/ciphertext are never RPC-reachable.

**Automated + manual code review, PASS. No leakage found.**

---

## 6. R5 marketplace audit

- `apps/ptah-extension-vscode/package.json` `contributes` block (lines 52+) — no `elevenlabs`/`ElevenLabs` string anywhere in the file (`grep -i elevenlabs` → no matches). No new `contributes.configuration` key was added for voice/ElevenLabs settings — confirmed voice settings live exclusively under `~/.ptah/settings.json` via `IWorkspaceProvider`, per the established pattern (`voice.elevenlabs.*` keys read/written through `VoiceSecretStore`/`ElevenLabsTtsProvider`/`ElevenLabsSttProvider`, never through VS Code configuration contribution points).
- `apps/ptah-extension-vscode/.vscodeignore` already excludes `CLAUDE.md` (bare pattern, matches at any depth) — even if it didn't, the new libs' `CLAUDE.md` files (`libs/backend/voice-providers/CLAUDE.md`, `libs/backend/voice-contracts/CLAUDE.md`) never get copied into `dist/apps/ptah-extension-vscode` in the first place (the VSIX packaging directory only receives esbuild output + explicitly copied assets), so they are not shipped regardless.
- Repo-wide case-insensitive `elevenlabs` grep across `*.{md,json,yml,yaml,txt}` returns 13 files; excluding the two new lib `CLAUDE.md` files (non-shipping, see above), the rest (`marketing/sizzle-trailer-storyboard.md`, `apps/ptah-video-studio/**`, `.claude/skills/video-showcase/**`) are unrelated hits on an unrelated word (video-studio/marketing docs) and live entirely outside `apps/ptah-extension-vscode` — zero VSIX exposure.
- `elevenlabs` is not on the burned-ID trademark list (`copilot|codex|claude|openai|anthropic`) per root `CLAUDE.md`; the risk register's actual concern (R5) was settings-contribution placement, which is confirmed clean.

**Automated-verified, PASS. No marketplace risk.**

---

## 7. THE HEADLINE CRASH GATE (FR-2.4) — why the fix works + USER-MUST-VERIFY protocol

### Why the fix resolves the 2026-07-12 crash

The original crash: `onnxruntime-node@1.21.0` (pulled in transitively by `@huggingface/transformers@3.8.1`) has a cross-thread `HandleScope` native-abort bug. Before this task, **both** the memory embedder (`embedder-worker.mjs`, a `worker_threads` Worker) and voice transcription/synthesis (`WhisperTranscriber`/`KokoroSynthesizer`, running on the **Electron main thread**) loaded and executed the same native `onnxruntime_binding.node` inside **one OS process**. `worker_threads` share the process's memory space and native-module bindings — when the embedder thread and the main-thread voice pipeline both drove ONNX inference concurrently, the native binding's cross-thread `HandleScope` bug fired an `abort()` that killed the entire process with no JS-catchable error (the log "just stops").

This task's fix is structural, not incidental:

1. **Process isolation (primary fix, FR-2.1/FR-2.4).** Voice ONNX execution (`whisper-pipeline.ts`/`kokoro-pipeline.ts`) now runs inside `voice-worker.mjs`, spawned via Electron `utilityProcess.fork()` (`ElectronVoiceWorkerFactory`, `apps/ptah-electron/src/services/platform/electron-voice-worker-factory.ts`) — a **separate OS process** with its own independent copy of the native ONNX binding. The embedder's `worker_threads` Worker and the voice `utilityProcess` can now never contend for the same in-process native binding, because they are not in the same process at all. A native `abort()` inside the voice worker can only kill that child process; Electron's main process (and the embedder thread within it) is unaffected. This is confirmed structurally sound and independent of any ONNX version.
2. **`onnxruntime-node@1.20.1` pin (defense-in-depth, FR-3).** Even if some future in-process ONNX usage were reintroduced, 1.20.1 predates the `HandleScope` bug, so the specific fault can't fire regardless of threading. Verified present in the dev tree (§1); **currently blocked from verification in a packaged build by the §3b defect** — this is precisely why that defect matters for FR-2.4 sign-off, not just FR-3.2.
3. **Crash-then-recover behavior (FR-2.2).** Even in the worst case where the voice child process does abort, `VoiceWorkerClient` (unit-proven in §2) guarantees the in-flight request fails with a structured `process-crashed` error and the _next_ request transparently respawns a fresh child — so even a residual crash in the isolated process degrades gracefully instead of taking down the app.

### USER-MUST-VERIFY manual protocol (packaged/installed build)

This cannot be completed by the QA agent: it requires a real packaged, installed Electron app under real memory-indexing + voice load, with human inspection of `%APPDATA%\Ptah\logs`. **Blocked in this pass by the §3b packaging defect** — the packaging step must be fixed (or worked around with a manual/dev-mode packaged build) before this protocol can run. Once a packaged build exists, run:

1. **Install/launch** the packaged Ptah Electron build (from `dist/release/win-unpacked` or the installer, once packaging is fixed) — do NOT use `nx serve`/dev mode for this test; the crash was only ever reproduced in a real packaged/production run.
2. **Start memory indexing**: open a reasonably large workspace so the memory embedder (`embedder-worker.mjs`, `worker_threads`) becomes actively busy — check the Memory tab / logs for embedding activity, or trigger a manual re-index if available.
3. **While indexing is active**, drive voice repeatedly for **2+ minutes continuously**:
   - Use the chat mic to record + transcribe (`voice:transcribe`) several times back-to-back.
   - Trigger TTS narration/voice-over playback (`voice:synthesize`) several times back-to-back, interleaved with the transcriptions.
   - Prefer the **local** Whisper/Kokoro provider for this test specifically (it is the one whose ONNX execution is the subject of the fix; ElevenLabs is fetch-based and was never part of the crash).
4. **Confirm the app stays alive** for the full 2+ minute window — window remains responsive, no crash dialog, no silent disappearance of the process.
5. **Inspect `%APPDATA%\Ptah\logs\Ptah Electron-<date>.log`**: confirm the log does **not** truncate mid-line or stop abruptly during the test window (the original bug's signature — "the log just stops" per `context.md`). A normal shutdown/rotation entry at the end of a log is fine; an abrupt stop with no `will-quit`/shutdown marker while voice+indexing were active would indicate the bug is still present.
6. **Second scenario (respawn on real crash)**: with Task Manager (or `taskkill`), find the `ptah-voice-worker` utilityProcess (visible as a child process of the Ptah Electron app, `serviceName: 'ptah-voice-worker'`) and kill it while a `voice:transcribe`/`voice:synthesize` request is in flight. Confirm: (a) the main Ptah window stays alive and responsive, (b) the in-flight request surfaces a structured error to the user (not a silent hang), (c) the very next voice request succeeds normally (worker respawned automatically).

If step 4-5 shows the app survives with clean logs, and step 6 shows graceful structured-error + respawn, the original crash the user reported is confirmed fixed. If either step reproduces a silent abort/truncated log, that is a genuine regression the QA agent could not reproduce in a unit-test harness and needs to go back to the architect/backend-developer.

---

## Summary Table

| Gate                          | Method                                                        | Result                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Test + gate sweep          | Automated                                                     | PASS (all suites green; di-lint, build-main, build-voice-worker all green)                                                                                                               |
| 2. Respawn/crash-isolation    | Automated (unit, fake process)                                | PASS                                                                                                                                                                                     |
| 3. Packaged-pin verification  | Automated-attempted                                           | **FAIL** — `nx package ptah-electron` cannot produce a packaged app with the current override (electron-builder traversal collector incompatibility); `verify-packed-onnx.js` never runs |
| 4. FR-9.4 grep audit          | Automated                                                     | PASS (code); minor doc/config staleness in `messaging-gateway/CLAUDE.md` + unused externals in `messaging-gateway/project.json`                                                          |
| 5. R6 secret-leak review      | Manual code review + automated specs                          | PASS                                                                                                                                                                                     |
| 6. R5 marketplace audit       | Automated + manual review                                     | PASS                                                                                                                                                                                     |
| 7. FR-2.4 headline crash gate | Explained (automated proxy in §2) + manual protocol specified | **USER-MUST-VERIFY** (blocked on §3 fix for a packaged build to test against)                                                                                                            |

## Recommendation

Do not sign off Batch 7 as complete. Route the §3b `nx package ptah-electron` / electron-builder traversal-collector failure back to backend-developer/architect as a blocking defect before the packaged-app crash-regression protocol (§7) can be executed by the user. The §4 documentation staleness (`messaging-gateway/CLAUDE.md`, unused esbuild externals) is a minor, non-blocking cleanup item that can ship alongside the §3 fix.
