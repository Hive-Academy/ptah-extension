# Batch 6 — Frontend Voice Settings — Implementation Report

**Task**: TASK_2026_VOICE_PROVIDERS · **Batch**: 6 (FR-6, FR-7 UI) · **Executor**: frontend-developer
**Status**: IMPLEMENTED (all verification gates green)
**Depends on**: Batch 5 (RPC + push surface — the new `voice:` methods, `MESSAGE_TYPES.VOICE_PROVIDER_ERROR`, and the provider-config DTOs it landed in `@ptah-extension/shared`).

---

## Files Created

| File                                                                                                         | Purpose                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/frontend/chat/src/lib/settings/ptah-ai/local-stt-panel.component.ts`                                   | Local Whisper (STT) panel: curated model select + Curated/HF/Local-folder source toggle + validated custom input; download + progress (Task 6.2) |
| `libs/frontend/chat/src/lib/settings/ptah-ai/local-stt-panel.component.spec.ts`                              | Spec                                                                                                                                             |
| `libs/frontend/chat/src/lib/settings/ptah-ai/local-tts-panel.component.ts`                                   | Local Kokoro (TTS) panel: voices from `voice:listVoices`, preview, download, `'tts'` sentinel (Task 6.2)                                         |
| `libs/frontend/chat/src/lib/settings/ptah-ai/local-tts-panel.component.spec.ts`                              | Spec                                                                                                                                             |
| `libs/frontend/chat/src/lib/settings/ptah-ai/elevenlabs-panel.component.ts`                                  | ElevenLabs cloud panel: masked key, test connection, voice/model/format selects, no download UI (Task 6.2)                                       |
| `libs/frontend/chat/src/lib/settings/ptah-ai/elevenlabs-panel.component.spec.ts`                             | Spec (incl. masked-key-never-displays)                                                                                                           |
| `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts`                                        | `MessageHandler` for `VOICE_PROVIDER_ERROR`; `latestError` signal + `dismiss()` (Task 6.3)                                                       |
| `libs/frontend/chat/src/lib/services/voice-provider-error.service.spec.ts`                                   | Spec                                                                                                                                             |
| `libs/frontend/chat/src/lib/components/molecules/notifications/voice-provider-error-toast.component.ts`      | Switch-to-local toast (Task 6.3)                                                                                                                 |
| `libs/frontend/chat/src/lib/components/molecules/notifications/voice-provider-error-toast.component.spec.ts` | Spec                                                                                                                                             |

## Files Modified

| File                                                                         | Change                                                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.ts`      | **Rewritten in place** as the provider container (Task 6.1). Legacy inline Whisper/Kokoro markup removed — moved into the panels (FR-6.6). |
| `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.spec.ts` | Rewritten to the new container contract.                                                                                                   |
| `libs/frontend/chat/src/lib/settings/index.ts`                               | Export the three panels.                                                                                                                   |
| `libs/frontend/chat/src/lib/services/index.ts`                               | Export `VoiceProviderErrorService` (needed by app.config).                                                                                 |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`     | Import + declare `VoiceProviderErrorToastComponent`.                                                                                       |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`   | Render `<ptah-voice-provider-error-toast />` in the notifications area.                                                                    |
| `apps/ptah-extension-webview/src/app/app.config.ts`                          | Register `VoiceProviderErrorService` in the `MESSAGE_HANDLERS` multi-provider alongside `VoiceDownloadProgressService` (Task 6.3).         |

---

## How each requirement is met

### Task 6.1 — Container (FR-6.1, FR-6.2, FR-6.6)

- `ngOnInit` fires `voice:listProviders` **and** `voice:getProviderConfig` in parallel.
- Two labelled `<select>`s — "Speech-to-Text Provider" and "Text-to-Speech Provider" — populated from the backend provider list, filtered by `supports.stt` / `supports.tts`.
- Unavailable providers render a **disabled** `<option>` with the `unavailableReason` as a `title` tooltip and an " (unavailable)" suffix (FR-6.2).
- `@switch` on the selected provider id renders **exactly one** panel per direction (`local-stt`/`elevenlabs` for STT; `local-tts`/`elevenlabs` for TTS).
- Provider change → `voice:setProviderConfig` using the optimistic-revert pattern carried over from the old file: the config signal flips immediately, reverts to the prior snapshot on failure, and re-reads `voice:getProviderConfig` on success so the panels reflect backend truth.
- No legacy Whisper/Kokoro markup remains inline (FR-6.6).

### Task 6.2 — Panels

- **local-stt-panel** (FR-4.1): curated English/Multilingual optgroups + a Curated/HF/Local-folder source toggle. The custom text input is validated (`owner/name` regex for HF; non-empty absolute path for `dir`) and Save is disabled until valid. Persists via `voice:setConfig { whisperModel, modelSource, customModel? }` (curated name always sent as the last-known-good value per the backend `resolveSttModelSpec` recoverability contract). Download button + progress bar are unchanged, driven by `VoiceDownloadProgressService` keyed by the model name (`downloadKey` = curated model or custom id/path).
- **local-tts-panel**: voice list fetched from `voice:listVoices { providerId: 'local' }` (no hardcoded arrays) and grouped into `<optgroup>`s by the DTO `category`. Preview (`voice:synthesize`) + download (`voice:downloadTtsModel`) preserved; the `'tts'` progress sentinel is unchanged.
- **elevenlabs-panel** (FR-5.3, FR-6.4): rendered per direction. Shared: masked key input + Test connection. TTS direction adds the voice dropdown (from `voice:listVoices { providerId: 'elevenlabs' }`, fetched on open when a key is configured, with loading/error/retry states), TTS-model and output-format selects. STT direction shows the `scribe_v1` model select. Key save → `voice:setApiKey`; selects → `voice:setProviderConfig { elevenlabs: {...} }`; test → `voice:testConnection` (optionally with the unsaved draft key). Every async action gates a visible pending signal (`isSavingKey`, `isTesting`, `isSavingConfig`, `isLoadingVoices`). **No download UI.**

### Task 6.3 — Error service + toast + registration (FR-7.2, FR-7.4, FR-7.3)

- `VoiceProviderErrorService` mirrors `VoiceDownloadProgressService`: `handledMessageTypes = [VOICE_PROVIDER_ERROR]`, captures the sanitized payload into a `latestError` signal, exposes `dismiss()`.
- `VoiceProviderErrorToastComponent` reads that signal, renders the direction + category badge + sanitized message, and a single **"Switch to local"** button → `voice:setProviderConfig { [direction]Provider: 'local' }` → on success re-reads `voice:getProviderConfig` and dismisses. It **never auto-applies** (FR-7.3) — the user must click; a separate dismiss button clears without switching.
- Registered in the webview `MESSAGE_HANDLERS` multi-provider and rendered once in the chat notifications surface.

---

## Security note — masked ElevenLabs key (R6, FR-5.3)

The panel only ever receives `apiKeyConfigured: boolean` from `voice:getProviderConfig` — the backend never sends key material to the frontend. The input is `type="password"` and its bound value is a local `keyDraft` signal that is **never seeded from any stored value** and is cleared to `''` immediately after a successful `voice:setApiKey`. The "Configured ●●●" indicator is derived purely from the boolean flag. A dedicated spec asserts the input is masked, is empty even when a key is configured, and that no `sk_`-shaped string appears anywhere in the rendered DOM.

---

## Angular / repo-rule compliance

- `ChangeDetectionStrategy.OnPush` on all four new components + the rewritten container.
- Signals + `computed()` + `linkedSignal()` (editable drafts seeded from inputs) + `inject()` only; no `BehaviorSubject`, no constructor DI.
- New control flow only (`@if` / `@switch` / `@for`).
- **No `[innerHTML]`** anywhere.
- Frontend↔backend isolation preserved: imports only from `@ptah-extension/shared` (DTOs + `MESSAGE_TYPES`) and `@ptah-extension/core` (`ClaudeRpcService`, `MessageHandler`); nothing from `libs/backend/*`.
- All RPC goes through the existing `ClaudeRpcService` the old voice-config used.
- kebab-case filenames; style matches the neighboring `resume-notification-banner` / old voice-config components.

---

## Verification outputs (all green)

- **`npx nx typecheck chat`** → `Successfully ran target typecheck`. Only a pre-existing NG8102 warning in `confirmation-dialog.component.ts` (untouched).
- **`npx nx lint chat`** → `Successfully ran target lint`; **0 errors**, 13 warnings — all in pre-existing untouched files (`chat-view.keepalive.spec.ts`, `session-loader.service.ts`, `auth-config.component.spec.ts`, `ptah-cli-config.component.ts`). None in Batch-6 files → confirms OnPush + no `[innerHTML]`.
- **`npx nx test chat`** → `Test Suites: 44 passed, 44 total · Tests: 2 skipped, 576 passed, 578 total`. Includes the required cases: masked-key-never-displays, provider panel-switch, switch-to-local invokes `voice:setProviderConfig` + re-reads config + dismisses, unavailable option disabled.
- **`npx nx build ptah-extension-webview`** → `Application bundle generation complete` / `Successfully ran target build`. Warnings are all pre-existing (initial-bundle budget, `message-bubble.component.css` budget, `@xterm/*` CommonJS, `confirmation-dialog` NG8102) — none from Batch-6 code. This production build exercised the new components' templates + DI wiring end-to-end.

---

## Clarifications / Decisions (non-blocking)

**Local-TTS "custom model source controls" omitted — no RPC backing in the Batch 5 contract.**
Plan §8 lists "custom model source controls" for `local-tts-panel`. The backend _settings resolver_ supports a Kokoro custom source (`resolveTtsModelSpec` reads `voice.kokoroModelSource` / `voice.kokoroCustomModel`), but **no RPC in the Batch 5 surface writes those keys**: `voice:setTtsConfig` accepts only `{ voice }`, `VoiceSetProviderConfigParams` exposes custom fields for `elevenlabs` only, and `VoiceProviderConfigLocalDto` returns Kokoro source/custom nothing to read back. Shipping the control would require a non-functional stub (violating the no-placeholder rule) or a backend/shared-type change that belongs to Batch 5, not this batch.

Decision: implemented `local-tts-panel` with the fully-wired controls (voice select from `voice:listVoices`, preview, download) and **omitted** the unbacked custom-source control. This is a reversible, conservative choice — not an irreversible UX guess — so I proceeded rather than stopping. If a Kokoro custom source is desired, it needs a small Batch-5-style follow-up: extend `VoiceSetProviderConfigParams.local` (or `VoiceSetTtsConfigParams`) + the Zod schema + the handler + `VoiceProviderConfigLocalDto`, after which a `<local-tts>` source toggle mirroring `local-stt-panel` can be added.
