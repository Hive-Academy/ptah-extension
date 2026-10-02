# Batch 54 report (visual-review "Batch 38 re-check 1")

Head at start: eeaa94951. No commit, no batches.md edit.

## 54.1 N1: busy controls keep focus

### Shared pattern

- NEW `libs/frontend/chat/src/lib/settings/feedback/busy-disabled.directive.ts`: `SettingsBusyDisabledDirective`, selector `[ptahBusyDisabled]`, standalone. It is the 36d/51.2 pattern in one place:
  - it sets `aria-disabled="true"` instead of native `disabled`, so focus stays on the control;
  - it sets `readonly` on text fields;
  - capture-phase guards cancel click, mousedown, keydown, change and input while busy. Tab and Escape pass through, so the user can still move focus and close the surface;
  - the listeners are removed on destroy.
- NEW `feedback/busy-disabled.directive.spec.ts` (3 tests):
  - busy: aria-disabled is set, native disabled is not, and focus is kept;
  - busy: events are cancelled while Tab and Esc pass;
  - idle: handlers run.
- NEW `feedback/busy-disabled.testing.ts`: the spec helper `isDisabledControl()`. It is true when a control is natively disabled or aria-disabled.
- `apps/ptah-extension-webview/src/styles.css`: the shared `:where(ptah-settings)` aria-disabled rule now also covers `:is(input, select, textarea)` (`cursor: not-allowed; opacity: .6`), so busy fields dim like busy buttons.
  - Spec: `settings-shared-styles.spec.ts`.

### Fixed: 64 controls switched from `[disabled]` to `[ptahBusyDisabled]`

Line numbers are the template lines at audit time.

| File (libs/frontend/chat/src/lib/settings/...) | Lines |
|---|---|
| output-style/output-style-editor | 182, 218, 452 |
| output-style/output-style-list | 162, 231, 287, 406 |
| output-style/output-style-parity-section | 145 |
| pro-features/agent-behaviour-section | 132, 195, 211, 236 |
| pro-features/mcp-port-config | 100, 143, 201 |
| pro-features/system-prompt-drawer | 265, 281 |
| pro-features/vscode-lm-config | 70, 93 |
| providers/cli-tier-mapping-modal | 97, 107 |
| providers/connection-drawer/advanced-tab | 104, 124, 147 |
| providers/connection-drawer/credentials-tab | 121, 146, 164, 171, 239, 241, 258 |
| providers/connection-drawer/models-tiers-tab | 80, 101 |
| providers/connection-drawer/overview-tab | 175 (N1, "Check connection") |
| providers/main-agent-reassign-popover | 70, 102, 119, 145 |
| providers/provider-consumer-assignments | 184 |
| providers/providers-settings | 86 |
| ptah-ai/agent-orchestration-config | 145 |
| ptah-ai/cli-model-effort-popover | 98 |
| ptah-ai/cli-orchestration-matrix | 138, 276, 285 |
| ptah-ai/copilot-auto-approve-toggle | 35, 45 |
| ptah-ai/elevenlabs-panel | 161, 335, 367 |
| ptah-ai/local-stt-panel | 110, 133, 181, 265 |
| ptah-ai/local-tts-panel | 118, 161, 208, 284, 298 |
| ptah-ai/voice-config | 147 |
| ptah-ai/web-search-config | 159, 236, 277, 296 |

One control has both kinds of disable. The matrix "On" toggle (`cli-orchestration-matrix` line 139):
- its busy/read-only state uses `[ptahBusyDisabled]="busy() || !canWrite()"`;
- an uninstalled system CLI keeps native `[disabled]`, because that is a permanent state and not a busy one.

The first capture run showed the Cursor row's toggle losing its disabled look (diff of 536 to 600 px). This split fixed it. A spec pins it: "Batch 54.1: an uninstalled CLI toggle stays natively disabled …".

### Not needed (audited, left natively disabled)

- **The control opens a surface and does not save while busy:**
  - output-style-config New;
  - output-style-list copy, edit and delete-open;
  - agent-behaviour effort popover open;
  - mcp-port localhost toggle (opens a confirm);
  - credentials sign-out-open, replace and delete-open;
  - main-agent provider select, rescope and save-to select;
  - consumer edit limit;
  - matrix add, model/effort cells, tiers, more menu and openAdd;
  - elevenlabs open-clear;
  - voice-config picker open;
  - web-search requestClear.

  Focus is on the save control while a save runs, not on these.
- **Cancel buttons (they never start a save):** mcp-port Cancel, main-agent reset (Cancel provider change), consumer timeout Cancel, providers-settings Cancel clear.
- **Disabled while the user's value is invalid or empty, not while a save runs:**
  - mcp-port input and timeout input;
  - elevenlabs, STT and TTS key and custom inputs.

  When the save runs, focus is on its Save button, which is fixed. The only Enter-to-save field (the web-search key) was never natively disabled.
- **Retry buttons (they do not set busy):** consumer Retry.
- **Settings toast Undo:** the toast is removed when undo runs. The control goes away; it is not disabled.
- **connection-detail-drawer "Edit in setup":** gated by loading or canEdit only, never by a running save.

### ui pickers (`libs/frontend/ui/src/lib/native/provider-model-picker/`)

- **`provider-model-search-field.component.ts`:**
  - when `disabled()`, the input is `readOnly` with `aria-disabled`, and the `aria-disabled:` cursor/opacity classes apply;
  - `onKeyDown` and `onInput` return early when disabled.
- **`provider-model-picker.component.ts`:**
  - the provider and model selects use `aria-disabled` while disabled;
  - `blockWhileDisabled()` cancels mousedown and keydown, except Tab and Escape;
  - `onProviderChange` and `onModelChange` revert a refused change;
  - the model select stays natively disabled only while the models list loads, because no save is running then.
- Specs updated in both files' `.spec.ts`, including a new test for a refused change.

### Knock-on fix

`cli-model-effort-popover.component.ts`: after the catalogue loads, the focus effect now handles a search field that already had focus. That field was focused while it was aria-disabled during loading. The effect now:
- accepts focus that is inside the popover root;
- blurs and refocuses the search field so its list opens.

Spec: "Batch 54.1: a search focused while it was still loading (aria-disabled) opens its list once the catalogue loads".

### Specs

- **Chat specs:** 22 chat specs now assert `isDisabledControl(...)`, 120 assertions in all.
  - Two assertions deliberately still check native `.disabled`, because they assert "not natively disabled": the consumer cell and the orchestration down button.
- **N1 unit test:** `overview-tab.component.spec.ts` has the test "N1 (Batch 54.1): while the check runs the focused button keeps focus".
- **Playwright scene:** `settings-providers.e2e.spec.ts` has the describe "the drawer check keeps focus (Batch 54.1, host)", run in both hosts. It does the following:
  1. Holds `auth:checkConnection` on a gated async override.
  2. Focuses Check and presses Enter.
  3. Asserts `aria-disabled=true`, native `disabled=false`, and that the button is focused.
  4. Releases the check, then asserts "Connected & verified", that `aria-disabled` is gone, and that the button is still focused.
  5. Presses Esc, which closes the drawer, and asserts focus is on the Moonshot card `[role="button"]`.

  It passed 6/6 with `--repeat-each=3`.
- **Existing main-agent model search scene:** it now expects focus to stay on the search after the save. It uses ArrowDown to reopen the list and no longer calls `input.focus()`.

## 54.2 native-autocomplete users outside Settings

- `native-autocomplete` is used only by `provider-model-search-field`. That field is used only in Settings:
  - the main-agent popover;
  - the CLI model/effort popover;
  - the tier mapping modal;
  - the provider-model picker in searchable mode (the instance picker).
- The drawer Models picker is not searchable.
- `ui/selection/autocomplete` mentions it only in a migration comment.
- **Setup wizard:** the tier pickers (`provider-setup-wizard.component.ts:1143`) are `ptah-provider-model-picker` in non-searchable mode, which renders native selects. No `disabled` is passed to them, so neither the 53.3 list-width change nor the 54.1 change applies.
- **Probe captures** (temporary probe spec, deleted afterwards): `%TEMP%\b54\wizard-tier-pickers-vscode.png` and `%TEMP%\b54\wizard-tier-pickers-electron.png`.
  - The select is 291 px wide in both hosts. It has no search field and is not disabled or aria-disabled.
  - Options: "Default (sovereigneg sonnet tier) | Kimi K2.5 · tool use | Kimi K2.7 Code · tool use | Kimi Lite".
  - No regression found; nothing changed.

## 54.3 Electron/anubis "Models & Tiers and Advanced"

- In the final folder run this test took 3.1 to 4.3 s across the four host/theme cases; Electron took 4.2 s and 4.1 s.
- In the 53.6 repeat runs it averaged 5.1 s, with a 6.5 s maximum.
- That is at most about 22 % of its 30 s timeout, which is under the 30 % bar, so no further split was made.
- **Slowest tests in the folder:**
  - Gate G reachability: 114 s and 96 s against a 600 s timeout (19 %);
  - advanced/search/voice: 6.7 to 6.9 s against 120 to 180 s timeouts.

## Verification

- `nx run-many -t typecheck,lint -p chat,ui,webview-e2e-harness,ptah-extension-webview`: success. Chat was re-run after the matrix toggle fix and succeeded.
- **Jest:**
  - chat, ui (101/101) and ptah-extension-webview passed;
  - the matrix spec was re-run after the fix and passed 50/50;
  - core was not touched.
- `nx build ptah-extension-webview`: exit 0, re-run after the matrix fix.
- **Gate G** (`settings-reachability.e2e.spec.ts`, `--workers=2`): 9 passed, re-run after the matrix fix.
- **Full settings folder (`--workers=2`):**
  - 124 passed, 2 skipped;
  - after the matrix fix, the "Orchestration matrix popovers" captures were re-run and passed 4/4.

## Captures

- Diffed against HEAD (a pixel counts when its summed channel difference is over 24).
- Before the matrix fix:
  - 4 `current-orchestration-popover-cursor-*` captures differed by 536 to 600 px. This was a regression (the uninstalled Cursor toggle lost its disabled look) and was fixed, not kept.
- After the fix:
  - every modified capture showed 0 px, except `current-live-orchestration-vscode-anubis-light` at 2 px of noise;
  - all 76 were restored by exact path with `git restore -- <path>`;
  - there are no `baseline-*` changes.
- No real visible change was kept: 54.1 changes the busy state only, and the captures do not show a save in progress.
