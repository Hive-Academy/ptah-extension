# Batch 6.5a — FR-4.1 TTS custom-model RPC surface

## Goal

Close the FR-4.1 asymmetry: local STT (Whisper) already exposed a user-provided
custom model source via RPC; local TTS (Kokoro) did not. The voice-providers
backend resolution already existed (`resolveTtsModelSpec` reading
`voice.kokoroModelSource` / `voice.kokoroCustomModel`). This batch added ONLY the
RPC write/read surface, mirroring exactly how the STT side was wired in Batch 5.
No backend resolution logic was touched; no frontend was touched.

## Changes (mirroring the STT pattern)

### 1. `libs/shared/src/lib/types/rpc.types.ts` (append-only)

- `TtsConfigDto` (read-back DTO) extended with:
  - `modelSource: 'curated' | 'hf' | 'dir'`
  - `customModel?: string`
    Mirrors `VoiceProviderConfigLocalDto` STT fields.
- `VoiceSetTtsConfigParams` (write params) extended with:
  - `modelSource?: 'curated' | 'hf' | 'dir'`
  - `customModel?: string`
    Mirrors `VoiceSetConfigParams`. Existing `voice: string` field untouched.

### 2. `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.schema.ts`

- `VoiceSetTtsConfigParamsSchema` extended with `modelSource: MODEL_SOURCE.optional()`
  and `customModel: CUSTOM_MODEL.optional()`, reusing the same `MODEL_SOURCE`
  enum (`['curated','hf','dir']`) and `CUSTOM_MODEL` string bound already defined
  for the STT `setConfig` schema. No cross-field refinement added — the STT
  `setConfig` schema has none, so none was mirrored.

### 3. `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts`

- Imported `VOICE_KOKORO_MODEL_SOURCE_KEY` + `VOICE_KOKORO_CUSTOM_MODEL_KEY` from
  `@ptah-extension/voice-providers` (already exported from its barrel).
- `getTtsConfig`: now reads the two kokoro keys back into the extended DTO via the
  existing `readModelSource(...)` (defaults `'curated'`) and `readOptionalConfig(...)`
  (`undefined` when blank) helpers — identical read pattern to `getProviderConfig`'s
  STT `local` block.
- `setTtsConfig`: still persists `voice.ttsVoice`, and now conditionally persists
  `voice.kokoroModelSource` / `voice.kokoroCustomModel` via the SAME
  `writeConfiguration('ptah', key, value)` path `setConfig` uses. Keys are only
  written when supplied (`!== undefined`) so a bad custom source never clobbers the
  last-known-good curated config (FR-4.4 recoverability — mirrors STT `setConfig`).

### Settings keys persisted / read

- `voice.kokoroModelSource` (`VOICE_KOKORO_MODEL_SOURCE_KEY`) — `'curated'|'hf'|'dir'`
- `voice.kokoroCustomModel` (`VOICE_KOKORO_CUSTOM_MODEL_KEY`) — HF repo id / local dir

### Read-back DTO fields (`TtsConfigDto`)

- `voice` (existing), `downloaded` (existing), `modelSource` (new), `customModel?` (new)

### 4. `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.spec.ts`

- `StoredSettings` + the fake `getConfiguration`/`setConfiguration` extended to
  round-trip the two kokoro keys.
- Updated the existing `getTtsConfig` `toEqual` assertion to include
  `modelSource: 'curated'`.
- Added tests:
  - getTtsConfig reads back `modelSource: 'hf'` + `customModel` from stored keys.
  - getTtsConfig defaults `modelSource` to `'curated'` / `customModel` undefined when unset.
  - setTtsConfig leaves kokoro keys untouched when absent (FR-4.4).
  - setTtsConfig persists `voice.kokoroModelSource` + `voice.kokoroCustomModel` when supplied.
  - setTtsConfig Zod-rejects an invalid `modelSource` without writing.

## Verification (all green)

| Command                                                                           | Result                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `nx run-many -t typecheck -p @ptah-extension/rpc-handlers @ptah-extension/shared` | Successfully ran for 2 projects                                                             |
| `nx run-many -t lint -p @ptah-extension/rpc-handlers @ptah-extension/shared`      | Success — 0 errors (9 pre-existing warnings, none in touched files)                         |
| `nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/shared`      | shared: 403 passed / 23 suites; rpc-handlers: 1267 passed, 2 skipped / 62 suites            |
| `nx run di-lint:lint`                                                             | di-lint OK: 1217 @inject sites resolve (530 tokens)                                         |
| `nx run ptah-electron:build-main:production`                                      | Successfully ran build-main + 22 deps (import.meta cjs warnings are pre-existing/unrelated) |

Note: `nx typecheck rpc-handlers shared` (space-separated) fails because Nx passes
the 2nd project name to `tsc` (`TS5042`); used `run-many` for multi-project targets.

## Out of scope (untouched)

- Backend resolution (`resolveTtsModelSpec`) — already works.
- Frontend local-tts panel toggle — Batch 6.5b.
- RPC dual-registration guard — no NEW namespace/method added (`voice:setTtsConfig`
  and `voice:getTtsConfig` already registered), so no `ALLOWED_METHOD_PREFIXES` edit needed.
