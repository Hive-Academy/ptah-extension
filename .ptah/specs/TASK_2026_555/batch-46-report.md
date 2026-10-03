# Batch 46 report — Voice: engines matrix + drawer D-VOICE shell (AS)

Author: in-process frontend-developer (Search & Voice owner)

Worktree `D:\projects\ptah-extension\.claude-worktrees\task-555-advanced-search-voice`, on top of 40f4bc821. Nothing is
committed or staged. I did not touch the Glm lane's Batch 41 files (`pro-features/*`, `advanced-settings.component.ts`
and its spec, `settings.component.html`, `services/ultracode-state.service*`).

## Files

| File | Change |
|---|---|
| `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.ts` | MODIFIED: stacked selects + inline panels → P2 card with a P4 "Voice engines" matrix; the drawer goes in a `@defer` block (356 lines) |
| `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.spec.ts` | MODIFIED: rewritten, 9 specs |
| `libs/frontend/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.ts` | CREATED: drawer D-VOICE (P6) with one tab per direction, mounting the existing panels unchanged (113 lines) |
| `libs/frontend/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.spec.ts` | CREATED: 6 specs (panels stubbed) |
| `libs/frontend/chat/src/lib/settings/search-voice-settings.component.ts` | **Not changed** (see deviation 1) |

The panel components (`local-stt-panel`, `local-tts-panel`, `elevenlabs-panel`) are untouched. They belong to Batches 47 and 48.

## Rows met

| Row | Implementation (`voice-config.component.ts` unless noted) |
|---|---|
| V9 description | P2 card `card bg-base-200 border border-base-300 p-3`, `h2` "Voice engines" (`text-xs font-bold uppercase tracking-wider text-base-content`). The description copy is unchanged, as a muted sub-line (`:86-90`). |
| V10 STT provider | P4 `table table-xs` (`:107`), row "Speech-to-text". The Provider cell is a `btn btn-ghost btn-xs` trigger with a chevron (`:124-131`). It opens a P5 `ptah-native-popover` with a `role="radiogroup"` of `role="radio"` buttons (`:134`). **An unavailable provider stays disabled and its reason is now visible text** ("Unavailable: API key not configured", `:150`), linked with `aria-describedby`. Before this change the reason was only in `title`. Choosing a provider saves on selection (S-sel) through `saveGeneric` with Undo (`chooseProvider :296`, `writeProvider :317`). A confirmed write re-reads `voice:getProviderConfig`, as before. |
| V11 TTS provider | Same as V10 on the "Text-to-speech" row. |
| V12 status | Derived, read-only Status badge (`badge badge-outline badge-sm text-base-content`, colour only on the dot, `:163-168`): local → "Ready" / "Not downloaded" (`sttDownloaded` / `ttsDownloaded`); ElevenLabs → "Ready" / "No key" (`apiKeyConfigured`). No new data. |
| Model / Voice cell | Read-only for now: curated Whisper model, or the custom HF id / folder (with a "No … set" fallback); ElevenLabs STT model id; Kokoro voice; ElevenLabs voice id or "No voice chosen". The P5 pickers for this cell are V14/V17/V23-V25 (Batches 47/48). |
| P6 drawer D-VOICE | `voice-details-drawer.component.ts`. `ptah-native-drawer` (`w-full max-w-lg`, `aria-label="Voice engine details"`) plus `ptah-native-tab-group` "Speech-to-text | Text-to-speech". The tab is preselected by the row's Details button, and switching tabs is two-way (`model()`). Each tab renders exactly the active provider's existing panel (`@switch`, the same mapping as before). The footer has Close only, with "Each control saves itself. Esc to close" (deviation #3). Panel `(changed)` → the parent re-reads the config. Focus returns to the Details button on close (`NativeDrawerComponent`). |
| States | Loading (`role="status"`, `voice-config-loading`) is kept. Load error is an inline `role="alert"` with `text-base-content` text and a red icon/border (formerly `text-error` text, deviation 6). The matrix is hidden when no config could be read. |

D15: `writeProvider` shows the new provider while the write runs. It returns `ok:true` only for `isSuccess() && data.ok`. On any other result it puts the previous provider back, sets the inline alert and returns the host's message, so `saveGeneric` raises an alert toast and never shows "Saved". D3: the provider triggers and options are disabled while `feedback.saving()`. OnPush on both components; no `[innerHTML]`; every catch is `catch (error: unknown)`; no new `as any` or `@ts-ignore`.

Bundle: the panels now load only through the drawer, which sits in `@defer (when drawerDirection() !== null)`. So `voice-config` no longer imports `LocalSttPanelComponent`, `LocalTtsPanelComponent` or `ElevenLabsPanelComponent` eagerly, which is a net *removal* from the eager graph. The only new eager import is `NativePopoverComponent`, which is already in the initial bundle (`web-search-config`, the Providers popovers). The new lucide icons (`Check`, `ChevronDown`, `ChevronRight`, `AlertCircle`) are already used by eagerly loaded Providers/settings components. `NativeDrawerComponent` and `NativeTabGroupComponent` are only reached through the deferred drawer. I did not run a build (Gate G is the team-leader's), so the byte delta is unmeasured.

## Preserve list (map §4 "Voice" rows)

| Capability | Where now |
|---|---|
| STT and TTS provider selection | matrix Provider cell → P5 popover |
| Unavailable-with-reason | disabled radio + visible "Unavailable: {reason}" text (stronger than the old `title`) |
| Optimistic switch with revert + config re-read on success | `writeProvider` (now with toast + Undo) |
| Loading / error states | kept, restyled |
| Local STT panel (source, model, custom id/path, download + progress) | drawer tab "Speech-to-text" when local (unchanged panel) |
| Local TTS panel (source, voice, custom, preview `local-tts-preview-btn`, download) | drawer tab "Text-to-speech" when local (unchanged panel) |
| ElevenLabs panel per direction (key, test, voices, models, format) | drawer tab for the direction that uses ElevenLabs (unchanged panel) |
| Electron-only visibility | unchanged: the shell still renders `<ptah-voice-config />` only when `isElectron` (`search-voice-settings.component.ts:22-25`), and its spec still asserts hidden on VS Code |
| Selector `ptah-voice-config` | kept |

Selectors: the old `voice-stt-provider-select` / `voice-tts-provider-select` testids belonged to `<select>` elements that no longer exist. `git grep` finds no use outside this component and its spec (no harness, e2e or showcase reference), so they are replaced by `voice-provider-btn-{stt|tts}` and `voice-provider-option-{dir}-{id}`. Other new testids: `voice-engines-matrix`, `voice-engine-row-*`, `-model-*`, `-status-*`, `-details-*`, `voice-provider-reason-*`, `voice-details-drawer`, `voice-details-subtitle`, `voice-details-close`. `voice-config-error` and `voice-config-loading` are kept.

## Persisted-settings writes (feeds Task 37.2)

There is no new write path. The only write made by this batch's own code is unchanged:

| Control | RPC | Store key | Runtime reader |
|---|---|---|---|
| STT provider | `voice:setProviderConfig {sttProvider}` (`voice-rpc.handlers.ts:717-760`, Zod-parsed) → `VoiceProviderSelector.setProvider('stt')` | `ptah.voice.sttProvider` (`voice-provider-selector.ts:25`, workspace `setConfiguration`) | `activeProviderId` / `activeStt()` (`voice-provider-selector.ts:40-62`), used by `voice:transcribe` (`voice-rpc.handlers.ts:873`) and the messaging gateway (`gateway.service.ts:936`) |
| TTS provider | `voice:setProviderConfig {ttsProvider}` | `ptah.voice.ttsProvider` (`:24`) | `activeTts()`, used by `voice:synthesize` (`voice-rpc.handlers.ts:487`) |

The panels' writes (`voice:setConfig`, `voice:setTtsConfig`, `voice:setApiKey`, ElevenLabs `setProviderConfig`) are unchanged and are traced in Batches 47/48.

## Verify (tails)

```
npx nx run @ptah-extension/chat:typecheck --skip-nx-cache
  warning NG8107 … peer-session-send-dialog.component.ts:181 (pre-existing, unrelated)
  Successfully ran target typecheck for project @ptah-extension/chat

npx nx run @ptah-extension/chat:lint
  ✖ 30 problems (0 errors, 30 warnings)   — none in a Batch 46 file (same 30 as Batch 45)
  Successfully ran target lint for project @ptah-extension/chat

npx nx run @ptah-extension/chat:test -- --maxWorkers=2 --testPathPatterns="voice|search-voice"
  (the filter was not applied: all 130 suites ran)
  Test Suites: 2 failed, 128 passed, 130 total
  Tests:       2 failed, 2 skipped, 2147 passed, 2151 total
  FAIL message-sender.service.spec.ts › ultracode keyword injection › prefixes the outgoing prompt with `ultracode:`
  FAIL cli-agent-output.component.spec.ts › renders replacement text when coalescing … (80.76 s under load)

npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2 <voice-config spec> <voice-details-drawer spec> <search-voice-settings spec>
  Test Suites: 3 passed, 3 total
  Tests:       17 passed, 17 total
```

The two failures are outside Batch 46:

- `message-sender.service.spec` exercises the ultracode path that the Glm lane is changing right now (uncommitted `services/ultracode-state.service.ts` + spec).
- `cli-agent-output.component.spec` took 80 s while four lanes shared the machine. It passed in my earlier full run (130/130 passed, 2146 tests, before the Glm edits landed).

A later run also showed `pro-features/agent-behaviour-section.component.spec.ts` (Glm's new Batch 41 file) failing 8 tests. That file is in Glm's ownership and I did not touch it. The team-leader should re-run once Batch 41 settles.

About the filter: on this target, `--testPathPatterns` and the positional pattern were both ignored, and all suites ran (in Batch 45 the same flag filtered to 4 suites). I listed the files explicitly to get a clean voice-only result.

Not run, per instructions: webview build / bundle budget, Playwright, Gate G, captures.

## Deviations

1. **`search-voice-settings.component.ts` not modified.** The batch lists it. But the drawer's state (open direction, config, reload) belongs to `voice-config`, so the drawer mounts there. The shell's only voice concern, Electron-only visibility, needs no change. Editing it only to satisfy the file list would add churn and could clash with Glm's `@defer` work on the tab shells. The old `mt-4` host margin (doubled by the shell's `space-y-4`) was removed in `voice-config` itself.
2. **Model / Voice cell is read-only in this batch.** The map gives its P5 pickers to V14/V17/V23-V25, which are Batches 47/48. Until then the value is changed in the drawer, as before.
3. **One drawer tab per direction, even when both directions use ElevenLabs.** The ElevenLabs panel is mounted per direction, the same as before (key block on each). V21's "one key block serves both tabs" is Batch 48.
4. **Provider labels** come from `voice:listProviders` (e.g. "Local (Whisper / Kokoro)"). The drawer subtitle uses the short forms "Local" / "ElevenLabs".
5. **Undo** writes the previous provider even when that provider has since become unavailable. The host then refuses, and the refusal surfaces as an alert toast (D15). No client-side pre-check was added.

## Copy for user review

- Card: heading "Voice engines"; sub-line unchanged ("Pick the speech-to-text and text-to-speech engines used by the chat mic and messaging-gateway voice notes. Local engines run offline; cloud engines require an API key.").
- Matrix: headers "Direction / Provider / Model / Voice / Status / Details"; rows "Speech-to-text", "Text-to-speech"; status "Ready" / "Not downloaded" / "No key"; model fallbacks "No Hugging Face model set", "No model folder set", "No voice chosen".
- Provider popover: title "{Direction} provider"; unavailable line "Unavailable: {host reason}" (fallback "not available on this machine").
- Toasts: "Saved speech-to-text provider." / "Saved text-to-speech provider." (+ Undo); failures show the host message, or "Failed to switch voice provider".
- Drawer: title "Voice engines"; subtitle "Speech-to-text: {Local|ElevenLabs} · Text-to-speech: {Local|ElevenLabs}"; tabs "Speech-to-text | Text-to-speech"; footer "Each control saves itself. Esc to close" + "Close".
- Details button accessible name: "{Direction} details: model, download and source" / "… voice, preview and download".
