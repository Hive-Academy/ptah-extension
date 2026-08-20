# Batch 6.5b — FR-4.1 TTS Frontend (custom model source)

## Goal

Add the user-provided custom-model source control to the local **TTS** panel,
mirroring the local **STT** panel, wired to the Batch 6.5a backend RPC support
(`voice:setTtsConfig` now accepts optional `modelSource` + `customModel`;
`voice:getTtsConfig`'s `TtsConfigDto` now returns `modelSource` + `customModel`).

## Files changed (scope: local-tts panel + its spec only)

- `libs/frontend/chat/src/lib/settings/ptah-ai/local-tts-panel.component.ts`
- `libs/frontend/chat/src/lib/settings/ptah-ai/local-tts-panel.component.spec.ts`

No other files touched. No backend imports; imports only from
`@ptah-extension/shared`, `@ptah-extension/core`, and a frontend sibling service
(`VoiceDownloadProgressService`).

## What was added

1. **Source toggle** (Curated / HF repo id / Local folder) — identical
   `role="radiogroup"` + `btn-xs`/`btn-primary`/`btn-ghost` markup as STT, with
   `data-testid="local-tts-source-{curated|hf|dir}"`.
2. **Validated custom id/path input** — shown only when source is `hf`/`dir`
   (`data-testid="local-tts-custom-input"` + `local-tts-custom-save` +
   `local-tts-custom-hint`). Validation is byte-for-byte identical to STT:
   `HF_REPO_ID_RE = /^[\w.-]+\/[\w.-]+$/` required for `hf`, any non-empty value
   for `dir`.
3. **Initialization from `voice:getTtsConfig`** — a new `loadTtsConfig()` runs in
   `ngOnInit` in parallel with `loadVoices()` (`Promise.all`) and seeds the
   `source` + `customModel` signals from the returned `TtsConfigDto`.
4. **Persistence via `voice:setTtsConfig`** — a single `persist(voice,
modelSource, customModel?)` helper always sends the current `voice` alongside
   `modelSource` (and `customModel` when set), matching the task requirement
   `{ voice, modelSource, customModel }`. It returns a boolean so voice changes
   can optimistically revert on failure.

## How it mirrors the STT panel

| Concern             | STT panel                                                     | TTS panel (this batch)                                    |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Source type         | `type ModelSource = 'curated'\|'hf'\|'dir'`                   | same                                                      |
| Toggle markup       | `role=radiogroup` + `btn-xs` radios                           | same                                                      |
| HF validation       | `HF_REPO_ID_RE`                                               | same regex, same rule                                     |
| `customModelValid`  | non-empty; HF → regex                                         | identical                                                 |
| Custom input + Save | `input-error` on invalid, Save disabled until valid           | identical                                                 |
| Curated switch      | immediate always-recoverable persist                          | identical (`onSourceChange`)                              |
| Save wire shape     | `voice:setConfig { whisperModel, modelSource, customModel? }` | `voice:setTtsConfig { voice, modelSource, customModel? }` |
| `canDownload`       | `source==='curated' && !downloaded`                           | identical (gates the download button)                     |

**Key difference (intentional):** STT's `modelSource`/`customModel` live on the
`config` input (`VoiceProviderConfigLocalDto`) — but those fields are the
**Whisper/STT** source. The TTS model source is TTS-specific and is **not** on
that DTO, so it is read from `voice:getTtsConfig` instead of the input. The
`voice` still uses `linkedSignal(() => config().ttsVoice)` (parent re-reads on
`changed`), and `source`/`customModel` are plain signals seeded from
`getTtsConfig` and updated optimistically on save.

## Preserved (unchanged behavior)

- Voice list via `voice:listVoices { providerId: 'local' }`, grouped by
  `category` into `<optgroup>`s.
- Preview (`voice:synthesize` + `playAudio`) and the download button.
- TTS download-progress sentinel `TTS_PROGRESS_MODEL = 'tts'` — unchanged; the
  progress bar still keys off it.
- Download always calls `voice:downloadTtsModel` with empty params; it is now
  only enabled for the curated source (`canDownload`), mirroring STT.

## Constraints honored

- `ChangeDetectionStrategy.OnPush`, signals + `inject()`, new control flow
  (`@if`/`@for`), no `[innerHTML]`.
- kebab-case file naming, `catch (error: unknown)` with `instanceof Error`
  narrowing throughout.

## Spec coverage (local-tts-panel.component.spec.ts)

- Voice list fetch + `<optgroup>` rendering (existing, retained).
- Voice change persists `voice:setTtsConfig { voice, modelSource:'curated' }`
  (updated for the new payload).
- Read-back: `getTtsConfig` seeds `source='hf'` + `customModel` and renders the
  custom input pre-filled.
- HF source shows the custom input, validates repo-id shape, and saves
  `{ voice, modelSource:'hf', customModel }`.
- Switching back to curated persists `{ voice, modelSource:'curated' }` and
  hides the custom input.
- Download uses the `'tts'` sentinel (`voice:downloadTtsModel`, `{}` params).
- Download button disabled for non-curated sources (`canDownload === false`).

## Verification (all green)

- `npx nx typecheck chat` → **Success**. (One pre-existing NG8102 warning in
  `confirmation-dialog.component.ts`, unrelated to this batch.)
- `npx nx lint chat` → **Success**, 0 errors. 13 pre-existing warnings, all in
  other files; none in the two files changed here.
- `npx nx test chat --skip-nx-cache` → **Success**. 44 suites passed,
  580 passed / 2 skipped (582 total).
- `npx nx build ptah-extension-webview --configuration=production` →
  **Success**. Bundle generated to `dist/apps/ptah-extension-webview`
  (only pre-existing budget/xterm-CommonJS warnings).
