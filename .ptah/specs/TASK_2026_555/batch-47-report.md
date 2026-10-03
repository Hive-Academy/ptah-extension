# TASK_2026_555 — Batch 47 report — Voice local STT/TTS panels reflowed for the drawer + D15 fixes (V13-V20)

Owner: Search & Voice owner (frontend-developer). Branch `feat/task-555-advanced-search-voice`, on top of `795fb435a` (Batch 46). No git commands run; working tree left dirty.

## Files changed

All under `libs/frontend/chat/src/lib/settings/ptah-ai/`:

- MODIFIED `local-stt-panel.component.ts` (464 lines) — `table table-xs` reflow for drawer D-VOICE; all saves moved to `SettingsSaveFeedbackService.saveGeneric`; D15 fixes; "Saved" chip removed; alert restyle.
- MODIFIED `local-stt-panel.component.spec.ts` (285 lines) — rewritten per the web-search spec pattern (feedback service + `RpcResult` mocks + microtask `settle()`); 11 tests.
- MODIFIED `local-tts-panel.component.ts` (608 lines) — same reflow; voice-only write payload; saved-source tracking for the Curated-return Undo; D15 fixes; "Saved" chip removed.
- MODIFIED `local-tts-panel.component.spec.ts` (399 lines) — same rewrite; 13 tests.

NOT touched: `voice-config.component.ts` / `voice-details-drawer.component.ts` (Batch 46, committed) — the panels keep the same `config` required input and `changed` output, so the drawer wiring is unchanged and its spec still passes. No harness/e2e selector updates needed: `local-stt|local-tts` has no matches in `libs/frontend/webview-e2e-harness` or `apps/ptah-electron-e2e`, and no testid was renamed — the only removed testids (`local-stt-saved`, `local-tts-saved`) had no references outside the two panels (grep confirms; remaining hits are the new specs asserting the chips are gone).

## How each V13-V20 capability is kept (file:line)

**V13 — source toggle (Curated / HF repo id / Local folder).** Segmented radiogroup (`role="radiogroup"`/`role="radio"`/`aria-checked`) and `local-stt-source-*` / `local-tts-source-*` testids unchanged: STT `local-stt-panel.component.ts:97-115`, TTS `local-tts-panel.component.ts:103-121`. Non-curated clicks are local-only drafts (S-explicit, committed by the row's Save button); clicking Curated saves immediately with Undo: STT `onSourceChange` `local-stt-panel.component.ts:347-365` + `writeSource` `:408-422`; TTS `onSourceChange` `local-tts-panel.component.ts:440-463` + `writeSource` `:521-543`, with the previous source/custom captured from backend truth (STT: the `config` input; TTS: `savedSource`/`savedCustom` `:346-347`, seeded by `loadTtsConfig` `:417-434` because the input DTO's `modelSource`/`customModel` are the Whisper/STT fields).

**V14 — Whisper model select (D15 defect fixed).** `local-stt-model-select` testid, English/Multilingual optgroups and size hints kept (`local-stt-panel.component.ts:128-157`). Save on selection via `saveGeneric` with Undo: `onModelChange` `:368-380` (`writeModel` `:424-435`, Undo = previous model). A failed write now reverts `selectedModel` and resets the DOM select (`:379`, `:433`).

**V15 — custom id/path validation (S-explicit, no Undo).** `HF_REPO_ID_RE` kept (`:44`), placeholder, `input-error` border and `local-stt-custom-*` testids kept (`:161-204`; TTS `:131-190`). Save disabled while invalid or saving. On failure the draft stays in the field for retry (Batch 45 key-editor precedent) and the failure shows inline + as an alert toast; `undo: null` (STT `:391-405`; TTS `:468-486`). Hint text is now `text-base-content` with a coloured `AlertCircle` icon (`text-error`) per Deviation 6.

**V16/V19 — download with progress.** Logic unchanged: `voice:downloadModel {model: downloadKey()}` with the 30-minute timeout (`local-stt-panel.component.ts:466-494`), `voice:downloadTtsModel` (`local-tts-panel.component.ts:570-598`), progress via `VoiceDownloadProgressService` with the TTS sentinel `'tts'` unchanged (`:29`, `ttsDownloadPercent` `:382-386`). G5 kept: the `progress progress-primary` bar in the drawer row (STT `:220-225`, TTS `:239-243`). Download status restyled to an outline badge with a coloured dot (`bg-success` Downloaded / `bg-warning` Not downloaded), label text `text-base-content` (STT `:239-260`, TTS `:256-278`).

**V17 — Kokoro voice (S-sel + Undo).** `local-tts-voice-select` and `local-tts-voices-loading` testids kept (`local-tts-panel.component.ts:200-215`, `:196`); backend voice list + optgroups unchanged. Save on selection via `saveGeneric` with Undo: `onVoiceChange` `:491-503` (`writeVoice` `:510-519`, Undo = previous voice). A failed write reverts `selectedVoice` and the DOM select (`:501`, `:517`).

**V18 — preview.** Unchanged: `voice:synthesize` + `playAudio` (`local-tts-panel.component.ts:600-626`, `:628-639`), `data-testid="local-tts-preview-btn"` kept (`:284`).

**V20 — "Saved" chips replaced by the toast.** `savedRecently` signals, the chips (`local-stt-saved` / `local-tts-saved`) and the `CheckCircle` imports are gone from both panels. Selections toast with Undo via `saveGeneric`: "Saved speech-to-text model." / "Saved speech-to-text model source." / "Saved text-to-speech voice." / "Saved text-to-speech model source."; custom-source saves (S-explicit) toast without Undo.

## Persisted writes changed (RPC → store key → runtime reader)

No new write paths; the feedback/revert handling changed and one payload changed.

1. STT model / source / custom: RPC `voice:setConfig` (`libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts:562-605`) → `writeConfiguration` → `provider.setConfiguration('ptah', key, value)` (`:607-624`) → store keys `ptah.voice.whisperModel` / `ptah.voice.whisperModelSource` / `ptah.voice.whisperCustomModel` (`libs/backend/voice-providers/src/lib/local/model-settings.ts`) → readers `resolveWhisperModel` (`model-settings.ts:52`) and the STT provider's model resolution (`local-stt-provider.ts:81`).
2. TTS voice / source / custom: RPC `voice:setTtsConfig` (`voice-rpc.handlers.ts:392-432`) → same `writeConfiguration` path → store keys `ptah.voice.ttsVoice` / `ptah.voice.kokoroModelSource` / `ptah.voice.kokoroCustomModel` → readers `resolveTtsVoice` (`model-settings.ts:84`) and the TTS provider (`local-tts-provider.ts:96,124`).
3. **Payload change (deviation 1)**: a voice change now writes `{ voice }` only. `VoiceSetTtsConfigParamsSchema` requires only `voice`; the handler leaves absent optional keys untouched, so the Kokoro source keys are never modified by a voice write. Previously a voice change sent `modelSource` (and `customModel` when a non-curated source was active), which persisted an unsaved source draft as a side effect. Source writes still send `{ voice, modelSource, customModel? }` deliberately.
4. Downloads (`voice:downloadModel`, `voice:downloadTtsModel`) are actions on model files, not configuration; no store keys.

## D15 fixes made

- **STT model write (V14) — the batch's named defect**: previously set the signal and never reverted on failure; the failure only set `errorMessage`. Now `writeModel` reverts `selectedModel` on a failed write and the handler resets the DOM select, plus the alert toast.
- **STT/TTS Curated-return writes**: previously no revert on failure; now revert the `source` signal and raise the alert toast.
- **Inner-result check**: "Saved" is decided by `result.isSuccess() && result.data.ok` (`local-stt-panel.component.ts:451`, `local-tts-panel.component.ts:555`), never by a local flag.
- **Alert restyle (Deviation 6)**: the error line became a real `role="alert"` block — `rounded border border-error/40 p-2 text-xs text-base-content` with a coloured `AlertCircle` (`text-error`) icon; colour lives only on the icon/dot/border (STT `:73-86`, TTS `:78-91`).
- **D3**: every save trigger (`[disabled]="saving()"`) and the selects bind to `feedback.saving` (`readonly saving = this.feedback.saving` — STT `:304`, TTS `:335`), so triggers are disabled while any settings write is in flight.

## Checks (allowed commands only)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat` — **both succeeded** (lint √, typecheck √; run duration 1 m 40 s; no passthrough flags).
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/ptah-ai/local-stt-panel.component.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/local-tts-panel.component.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.spec.ts --maxWorkers=2` — **4 suites, 38 tests, all passed** (43.9 s). Included the Batch 46 voice-config and drawer specs because the voice-config spec mounts the real TTS panel in its drawer defer block. Jest printed the known "worker process has failed to exit gracefully" warning (toast-timer teardown class; both specs call `feedback.dismiss()` in `afterEach`, same as the web-search spec) — not a failure.
- Not run (out of Batch 47 scope per assignment): nx build, bundle check, Gate G, Playwright, captures.

## Deviations

1. **Voice-only TTS voice payload** (see write trace above). Behaviour change, schema-valid, consistent with FR-4.4; the old side-effect write was the reason a voice change could persist an unsaved source draft. Flag for the Gate V 50 review.
2. **Curated click while the backend is already on Curated = draft abandon, not a write.** The old code always persisted on the Curated click (a redundant no-op write plus a toast). Now the panel just switches the view back: no RPC, no toast. Applies to both panels (STT `:354-357`, TTS `:453-455`).
3. **Custom-source save failure keeps the draft** in the field so the user can retry, instead of reverting to the saved value (Batch 45 key-editor precedent). No Undo for those writes (S-explicit per pattern map).
4. **Toast labels lower-cased** (Batch 45 deviation 7 precedent): "Saved speech-to-text model.", "Saved speech-to-text model source.", "Saved text-to-speech voice.", "Saved text-to-speech model source." — see copy review below.
5. **TTS row order** in the drawer: Source / Custom model (rendered only for non-curated sources) / Voice / Download. The visible "Voice" `<label for>` became the table row header plus `aria-label` on the select (same for the STT model select and custom input). Screen-reader labels preserved.
6. Fallback error strings kept from the old code ("Failed to save voice configuration" / "Failed to save TTS configuration"), so no copy change beyond the restyle.

## Copy for user review (Gate V 50)

- Toast labels in deviation 4 — in particular "Saved speech-to-text model source." / "Saved text-to-speech model source." being reused for both the Curated-return save and the custom id/path Save button.
- Curated-return with no feedback when the backend is already Curated (deviation 2): the view switches silently.
- Kept copy, restyle only: the intro sentences above each table, the validation hints ("Enter a valid HuggingFace repo id (owner/name)." / "Enter an absolute folder path."), the download badges ("Downloaded" / "Not downloaded") and the "Ready"/"Download"/"Preview"/"Playing…" button labels.

## Out-of-scope observations (not touched)

- `elevenlabs-panel.component.ts` still uses the old inline "Saved"/`CheckCircle` pattern (Batch 48 owns it).
- `web-search-config.component.ts:13` still imports `CheckCircle` for its own success/error icons — its rows show `{ok:false}` results; not a Batch 47 concern.
- The TTS panel's `savedSource` defaults to `curated` until `voice:getTtsConfig` answers; a Curated click inside that first round-trip window is treated as a draft abandon. The old code had the same class of race (it wrote whatever `source()` held); low impact, noted for completeness.
## Revise round 1

Finding F1: the visible alert (and the alert toast) must never show raw host error text (`result.error`, `result.data.error`, `error.message`); each action gets one fixed sentence.

Glm lane stopped at the Ollama weekly limit; finished in-process (same-side for this part).

### What the Glm lane changed

- `local-stt-panel.component.ts`: added `SAVE_FAILED_MESSAGE` ("Could not save the voice configuration.") and `DOWNLOAD_FAILED_MESSAGE` ("Could not download the voice model.") (`:44-45`), removed the `errorText` helper. `setConfig` (`:442-460`) and `downloadModel` (`:462-484`) now set only those constants on every failure branch (RPC error, `{ok:false}`, thrown) and use bare `catch {}`.
- `local-tts-panel.component.ts`: added `SAVE_FAILED_MESSAGE`, `LOAD_VOICES_FAILED_MESSAGE`, `DOWNLOAD_FAILED_MESSAGE`, `PREVIEW_FAILED_MESSAGE` (`:29-32`), removed `errorText`. `loadVoices` (`:394-410`), `setTtsConfig` (`:542-560`), `downloadTtsModel` (`:562-584`) and `previewVoice` (`:586-606`) set only those constants.
- Specs: save F1 tests for a thrown `Error('secret host detail')` and `{ok:false, error:'host detail'}` in both panels; `not.toContain('disk full')` added to the RPC-error save tests; a single-shape (RPC error) download test (STT) and load-voices test (TTS).

### What I verified and changed

- Audit of both panels, every path that writes `errorMessage` or reaches a toast: all use the fixed constants. `saveGeneric`'s `message` comes only from `WriteResult`, and each `WriteResult` failure is `{ ok: false, message: SAVE_FAILED_MESSAGE }` (STT `:455`, `:458`; TTS `:555`, `:558`). `saveGeneric` itself only shows `result.message` or its own fixed strings (`settings-save-feedback.service.ts:126-137`). `loadTtsConfig` failures are silent (no message). **No path is left that shows host text, and no backend `{success:false}` string is kept**, so I list no backend constants.
- No production code change was needed.
- Specs added or strengthened (mine):
  - STT: the single download failure test became `it.each` over three shapes (RPC error, thrown `Error('secret host detail')`, `{ok:false, error:'host detail'}`). Each one asserts that the `role="alert"` text is exactly "Could not download the voice model." and that no `host detail` appears anywhere in the panel.
  - TTS: a shared `HOST_FAILURES` table (same three shapes) plus an `expectFixedAlert` helper that checks `role="alert"`, the exact sentence and that `host detail` is absent. I used them for load voices (it replaces the single-shape test), download (new: there was none) and preview (new: there was none; it also asserts `isPreviewing` resets).
  - Both panels: the thrown and `{ok:false}` save tests now also assert that the visible alert text is exactly the fixed save sentence (before, they checked only the toast).
- Coverage matrix (fixed sentence shown, host text absent, all three failure shapes): STT save ✓, STT download ✓; TTS save ✓, TTS load voices ✓, TTS download ✓, TTS preview ✓. STT has no load-voices or preview path.

### Counts

- Spec tests: STT 11 (original Batch 47) → 14 (Glm) → **16**; TTS 13 → 15 (Glm) → **23**. Both panels: **39**.

### Checks

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat`: **both succeeded** (typecheck ran fresh; Nx served lint from its cache, "existing outputs match the cache"; run duration 50.8 s).
- `npx jest -c libs/frontend/chat/jest.config.ts …local-stt-panel… …local-tts-panel… …voice-config… …voice-details-drawer… --maxWorkers=2`: **4 suites passed, 54 tests passed** (21.8 s). That is 39 panel tests plus 15 in the voice-config and drawer specs.
- Not run (forbidden): nx build, Playwright, screenshots.

### Copy for user review

- The new fixed sentences: "Could not save the voice configuration." (STT save), "Could not download the voice model." (STT download), "Could not save the text-to-speech configuration.", "Could not load the voices.", "Could not download the text-to-speech model.", "Could not play the preview." These replace deviation 6 above: the old fallback strings "Failed to save voice configuration" / "Failed to save TTS configuration" are gone.
