# Batch 48 report — ElevenLabs panel + go vet card (V21-V29)

Author: in-process frontend-developer (same-side; Glm lane out of quota). Resumed after the
previous process exited mid-batch; the partial work on disk was kept and finished.

Paths below are relative to `libs/frontend/chat/src/lib/settings/ptah-ai/` unless stated.

## Files

- MODIFIED `elevenlabs-panel.component.ts` (671 lines) — P4 `table-xs` rows, G13 verify-then-save
  key flow, P8 inline Clear confirm, S-sel selections with Undo, fixed failure sentences.
- MODIFIED `elevenlabs-panel.component.spec.ts` — G13, F1, D15, P8 and Undo coverage.
- CREATED `elevenlabs-select-rows.ts` (69 lines) — the fixed-option rows (TTS model, output format,
  STT model) and their option lists. They were moved out of the component to keep it under the
  700-line cap. This follows the local row-data precedent in `cli-matrix-rows.ts`.
- MODIFIED `go-vet-consent-config.component.ts` (566 lines) — P2 card, P4 rows, P10 badge, P8
  confirm. The switch, stale reasons, error map and Electron-only mount are kept.
- MODIFIED `go-vet-consent-config.component.spec.ts` — V26-V29 and F1 coverage.

No files from Batch 42 (`pro-features/*`, `advanced-settings.*`), 43 (`output-style/*`) or
47 (`local-*-panel`) were touched by this batch.

## V21-V29 evidence

| ID | Requirement | Source | Spec |
| --- | --- | --- | --- |
| V21 | Key status, Save gated on a passing probe of the draft (G13); key never saved on a failed probe | `elevenlabs-panel.component.ts:181-279`, `canSaveKey` :438-441, `saveKey` :503-523 (guard :505) | spec :153, :192, :251, :265 |
| V21 | Clear: inline confirm first (Cancel focused, Esc closes), no Undo | template :144-177, `clearKey` :536-553 (`undo: null` :551) | spec :341, :365, :381, :407 |
| V22 | Test connection: probes the draft or the stored key; one fixed sentence per category | `TEST_CATEGORY_MESSAGE` :54-65, `testConnection` :473-500 | spec :192, :214, :233, :284, :300 |
| V23 | Voice select, saveGeneric with Undo = previous voice; no Undo when unset | template :283-349, `saveSelection` :592-613 | spec :479, :507, :534, :554 |
| V24/V25 | TTS model, output format, STT model through one `@for` over `elevenlabs-select-rows.ts` | template :351-378, `onSelectionChange` :583 | spec :534, :554, :607 |
| V26 | P2 card + P4 rows (root, Go binary) | `go-vet-consent-config.component.ts:80-144` | spec :145, :484 |
| V27 | `role="switch"` + `aria-checked`, 24 px hit target, P10 badge (text stays base-content) | :156-192 | spec :261, :484 |
| V28 | Enable confirm names the exact root; Cancel focused; Esc cancels; focus returns to the switch | :257-306, `openConfirm`/`cancelEnable` :465-480 | spec :197, :232, :248, :508 |
| V29 | Stale reason kept in the card | `STALE_REASON_TEXT` :30-35, template :208-225 | spec :179 |

Electron-only visibility: `../search-voice-settings.component.ts:24` mounts the card inside
`@if (isElectron)` (asserted in `../search-voice-settings.component.spec.ts:43,50`). The card also
renders nothing on `supported: false` (spec :158).

## Persisted writes (RPC → store key → reader)

All paths here are under `libs/backend/`.

- `voice:setApiKey` → `VoiceSecretStore.setKey` (`rpc-handlers/.../voice-rpc.handlers.ts:783`) →
  ciphertext at `voice.elevenlabs.apiKeyCipher` (`voice-providers/src/lib/voice-secret-store.ts`
  `CIPHER_KEYS`). An empty string clears it. Read by `elevenlabs-client.ts:208` (`getKey`) and
  shown in the UI as `apiKeyConfigured` (`voice-rpc.handlers.ts:693`).
- `voice:setProviderConfig {elevenlabs:{voiceId|ttsModelId|outputFormat|sttModelId}}` →
  `writeConfiguration` (`voice-rpc.handlers.ts:734-752`) → `voice.elevenlabs.voiceId` /
  `.ttsModelId` / `.outputFormat` / `.sttModelId` (`:124-127`). Read by
  `voice-providers/src/lib/elevenlabs/elevenlabs-tts-provider.ts:73-76` and
  `elevenlabs-stt-provider.ts:61`, and echoed back by `voice:getConfig` (`voice-rpc.handlers.ts:694+`).
- `voice:testConnection` — a probe only, nothing is persisted.
- `diagnostics:go-vet-consent-set` → `GoVetConsentStore.grant/revoke`
  (`rpc-handlers/.../diagnostics-consent-rpc.handlers.ts:222-224`, read back with rollback
  :240-259) → per-root record `<sha256(root)[0..32]>.json`
  (`workspace-intelligence/src/diagnostics/external-checkers/go-vet-consent-store.ts:314-318`).
  Read by `go-vet-checker.ts:610,680`.

## D15 fixes

- ElevenLabs writes report success only when the write's own result is `isSuccess() && data.ok`
  (`attempt`, :653-670). On RPC errors, `{ok:false}` results and throws, the select reverts to its
  previous value (`writeSelection` :615-634). Each failure raises an alert toast with
  `canUndo:false` plus the inline `role="alert"` with a fixed sentence (spec :554 suite).
- Clear keeps the confirm open on failure. A key Save failure keeps the verified draft so the user
  can retry.
- go vet: the optimistic switch reverts and the card re-reads the host after every failed SET
  (`fail` :526-531). Success is shown only from the host read-back (`applyReadBack`).

## No host error text (F1)

Every visible failure is a fixed constant: `elevenlabs-panel.component.ts:45-65`, and
`go-vet-consent-config.component.ts:38-54` (one sentence per `DiagnosticsGoVetConsentSetError`
code, plus the transport and load sentences). The specs feed `'host detail'` / `'secret host
detail'` through RPC errors, throws and `{ok:false,error}`, then assert that it is absent from the
alert, the toast and the whole element (`elevenlabs-panel.component.spec.ts` HOST_FAILURES :43-45,
used at :233, :300, :407, :456, :554; `go-vet-consent-config.component.spec.ts:531-570`). No
backend-constant exception was needed.

## Testids

None were removed (checked against HEAD). New testids: `elevenlabs-panel-table`,
`elevenlabs-key-hint`, `elevenlabs-key-visibility`, `elevenlabs-clear-group`,
`elevenlabs-clear-confirm`, `elevenlabs-clear-cancel`, `elevenlabs-voices-retry`,
`go-vet-consent-table`. Three bindings moved from static to `[attr.data-testid]`, but each still
renders the same value: `elevenlabs-key-configured` / `elevenlabs-key-missing`, and
`elevenlabs-tts-model-select` / `-output-format-select` / `-stt-model-select`. No harness or e2e
selector update was needed.

## Checks

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat` → "Successfully ran targets typecheck, lint
  for project @ptah-extension/chat". Re-run with `--skip-nx-cache` after the final spec edit
  passed too, exit 0.
- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` on elevenlabs-panel,
  go-vet-consent-config, voice-config, voice-details-drawer → 4 suites, 85 tests passed.
  The first run had 9 failures; the cause and fix are under Deviations.

## Counts

- Non-spec lines: elevenlabs-panel 671, elevenlabs-select-rows 69, go-vet-consent-config 566
  (all within the 700 cap).
- No new `as any` or `@ts-ignore`. Catch blocks that do not read the error use the bare `catch {}`
  form, as the sibling Batch 47 panels do. That form has no binding, so there is nothing to
  annotate as `unknown`.

## Deviations

- Added `elevenlabs-select-rows.ts`, which the batch did not list. Without it the component was
  747 lines. The three fixed-option rows now render from one `@for`. Each id, testid and toast
  label is derived from the row, and the rendered output is unchanged.
- The spec now reads `component.voiceId` / `component.selection[key]` instead of the removed
  per-field signals (`ttsModelId`, `outputFormat`, `sttModelId`).

## Copy for user review

- Key hint: "Test the key first; Save turns on once the test passes." / "Stored encrypted on this
  machine."
- Probe: "Connection works." / "Authentication: ElevenLabs rejected the key." / "Quota: the
  ElevenLabs account is out of credits or rate-limited." / "Network: could not reach ElevenLabs." /
  "Provider error: ElevenLabs could not complete the test." / "The connection test failed."
- Clear confirm: "Clear the stored ElevenLabs key from this machine? ElevenLabs voice stops working
  until a key is added."
- Failures: "Could not save the ElevenLabs API key." / "Could not clear the ElevenLabs API key." /
  "Could not save the ElevenLabs settings." / "Could not load your ElevenLabs voices."
- go vet confirm: "Allow go vet to run in this folder?" + root. Stale: "Consent is out of date:
  {reason}. go vet does not run until you turn it on again." Badge: On / Off / Out of date /
  Confirm to enable / Saving…

## Revise round 1 (visual)

Source: orchestrator capture check of `screenshots/angular/current-go-vet-electron-*` and
`current-search-voice-*`. No build, Playwright, screenshots or git writes. `pro-features/*`,
`output-style/*` and `advanced-settings.*` not touched.

**V6 — go vet consent switch** (`go-vet-consent-config.component.ts`, now 568 lines)
- The control is a daisyUI `toggle toggle-sm toggle-primary` (:185) with a visible focus
  outline, replacing the `checkbox checkbox-xs`. `role="switch"`, `aria-checked`, the
  24×24 px `go-vet-consent-toggle-target` hit area, the enable confirm naming the root and every
  `go-vet-consent-*` testid are unchanged.
- The "Off" outline badge is gone: `go-vet-consent-state` is now a plain `text-base-content`
  text state with the status dot (:160); labels unchanged (On / Off / Out of date / Confirm to
  enable / Saving…).
- The switch row is one `<td colspan="2">` (:148) holding the label (`whitespace-nowrap`, :152)
  and the state + switch, so "Allow go vet in this workspace" reads on one line. The Workspace /
  Go binary rows keep their `w-24` row-header column and alignment.

**V7 — ElevenLabs voice name** (`voice-config.component.ts`, Batch 46 file, touched for V7 only;
now 399 lines; + `voice-config.component.spec.ts`)
- No shared voice-list state exists: `elevenlabs-panel` keeps `voices` as a component signal and
  is only mounted inside the lazy drawer. So voice-config does its own light read:
  `voice:listVoices {providerId:'elevenlabs'}` (`loadVoiceNames`, :316), triggered by an effect
  (:269) only when the TTS provider is ElevenLabs, a key is configured and a voice id is set;
  guarded to one call per component instance (tab visit), so config re-reads after drawer
  changes do not repeat it.
- The cell (`elevenLabsVoiceCell`, :327) shows the voice's `label` ("Sarah"). When the list has
  not loaded, failed (result or transport) or does not contain the id, it shows "Custom voice"
  with the id in `title` (:166). No failure text is shown in the row. No voice id: "No voice
  chosen" as before. Local values (`base.en`, `af_heart`, custom model) unchanged, no tooltip.

**Specs**
- go-vet: the V26/V27 render test now asserts `toggle` / `toggle-sm`, no `checkbox`, no `badge` on
  the state, the dot present, `colspan="2"` on the switch row, `whitespace-nowrap` label, and row
  headers exactly `['Workspace', 'Go binary']`.
- voice-config: +5 tests — name shown from exactly one `voice:listVoices` read, no second read
  after `reloadConfig()`; "Custom voice" + id tooltip for list failure / transport failure / id
  not in list (`it.each`, host error text not rendered); Local TTS makes no list read and keeps
  `af_heart` / `base.en`.

**Verification**
- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` on go-vet-consent-config,
  elevenlabs-panel, voice-config, voice-details-drawer → 4 suites passed, 90 tests passed
  (was 85; +5 voice-config).
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` → "Successfully ran
  targets typecheck, lint"; no warning or error lines in the output.

**Team-leader finding — host text in the voice engines alert** (`voice-config.component.ts` +
spec, Batch 46 code carried in the 48 commit)
- `errorText()` removed. Every visible failure is now one fixed sentence per action, used for
  the inline `voice-config-error` alert and for the save toast: `voice:listProviders` → "Could
  not load the voice engines."; `voice:getProviderConfig` → "Could not load the voice
  settings."; `voice:setProviderConfig` → "Could not save the speech-to-text engine." /
  "Could not save the text-to-speech engine." (by direction, also the Undo write). RPC failure
  (`result.error`), `{ ok:false, error }` and a thrown Error all map to the same sentence; no
  `result.data.error`, `result.error` or `error.message` reaches the UI.
- Spec: `HOST_FAILURES` (RPC failure, `{ ok:false, error:'host detail' }`, thrown
  `Error('host detail')`) × {provider write, config read, provider list} = 9 `it.each` cases,
  each asserting the exact fixed sentence and that "host detail" is not rendered (write cases
  also assert the toast). The D15 revert test now expects the fixed TTS sentence. The two old
  tests that asserted host text were replaced.
- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` (go-vet-consent-config,
  elevenlabs-panel, voice-config, voice-details-drawer) → 4 suites passed, 97 tests passed
  (90 − 2 replaced + 9 new).
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` → "Successfully ran
  targets typecheck, lint"; no warning or error lines.
- Out of scope, not touched: `web-search-config.component.ts:82` has the same `errorText()`
  pattern (used :368, :531, :589, :603, :619).
