# Batch 39 report — TASK_2026_555

## Summary

Implemented the foundation for the Advanced and Search & Voice tabs:

- Added a generic save entry to `SettingsSaveFeedbackService` (G2) for settings that do not flow through `ProvidersSettingsStateService`.
- Created `AdvancedSettingsComponent` and `SearchVoiceSettingsComponent` shells that host the existing child components unchanged.
- Moved the Data Portability (Export/Import) logic from `SettingsComponent` into the Advanced shell.
- Updated `SettingsComponent` to mount the new shells and kept the deep-link tab ids `pro-features` and `tools` working.
- Added unit specs for the generic save entry and both new shells.

All verification commands for `@ptah-extension/chat` passed.

## Acceptance criteria

### 1. Generic save entry on `SettingsSaveFeedbackService`

**Status: PASS**

- New interface `SettingsGenericSaveRequest` added at `libs/frontend/chat/src/lib/settings/feedback/settings-save-feedback.service.ts:17-25`.
- `saveGeneric()` added at `:117-145`. It takes `write: () => Promise<{ok:true}|{ok:false,message:string}>`, an optional `undo`, and a `label`.
- Success toast is scope-less: `"Saved {label}."` (`:142`).
- Failure path shows the writer's message and never shows "Saved" (`:136-138`).
- D3 disable-while-saving is shared with the Providers entry via `saving = computed(() => state.commit().status === 'saving' || genericSaving())` (`:63`).
- 8 s toast timer reused from `SETTINGS_TOAST_TIMEOUT_MS` (`:34`, `:177`).
- The existing Providers `save()` entry is unchanged; all existing specs stay green.
- Undo runs through the same generic path (`undo()` at `:152-165` dispatches by `'scope' in request`).

Evidence per rule:

| Rule | Evidence |
|---|---|
| Scope-less toast | `settings-save-feedback.service.ts:142` |
| D3 disable while saving | `settings-save-feedback.service.ts:63`, `:118-120` |
| 8 s timer | `settings-save-feedback.service.ts:34`, `:177` |
| Failed write never shows "Saved" | `settings-save-feedback.service.ts:136-138` |
| Undo is a real second write | `settings-save-feedback.service.ts:152-165` |

### 2. Existing Providers entry unchanged and specs green

**Status: PASS**

- `save()` body and `SettingsSaveRequest` interface are unchanged except for the `show()` signature widening to accept the union undo request.
- Existing `SettingsSaveFeedbackService` specs pass as part of the full chat test run (127 suites passed).

### 3. `AdvancedSettingsComponent` and `SearchVoiceSettingsComponent` shells host existing children unchanged

**Status: PASS**

- `AdvancedSettingsComponent` created at `libs/frontend/chat/src/lib/settings/advanced-settings.component.ts`.
  - Imports unchanged: `LicenseStatusCardComponent`, `EnhancedPromptsConfigComponent`, `OutputStyleConfigComponent`, `WorkflowsConfigComponent`, `McpPortConfigComponent`, `VscodeLmConfigComponent` (`:27-36`).
  - Template mounts them in the same order as before (`:43-83`).
- `SearchVoiceSettingsComponent` created at `libs/frontend/chat/src/lib/settings/search-voice-settings.component.ts`.
  - Imports unchanged: `WebSearchConfigComponent`, `VoiceConfigComponent`, `GoVetConsentConfigComponent` (`:20`).
  - Electron-only guard for voice/go-vet preserved (`:25-28`).
- Both shells use `ChangeDetectionStrategy.OnPush` (`advanced-settings.component.ts:24`, `search-voice-settings.component.ts:18`).
- Both use standalone components, signals, and `inject()`.

### 4. Deep-link tab ids `pro-features` and `tools` stay working

**Status: PASS**

- `settings.component.ts` still routes `pro-features` and `tools` to `setActiveTab(pending.tab)` in the fallback branch (`:177-180`).
- Tab bar buttons still use those ids for `[class.tab-active]` and `(click)` (`settings.component.html:71-96`).
- `settings.component.spec.ts` already has tests landing on `pro-features` and `tools` with no section; they passed.

### 5. Export/Import moved with their logic; `aria-label="Export settings"` kept

**Status: PASS**

- Export/Import methods moved from `settings.component.ts:227-261` to `advanced-settings.component.ts:68-104`.
- Platform-aware RPC logic is identical (VS Code uses `command:execute ptah.exportSettings` / `ptah.importSettings`; Electron uses `settings:export` / `settings:import`).
- `aria-label="Export settings"` and `aria-label="Import settings"` preserved (`advanced-settings.component.ts:53`, `:65`).
- Export/Import `data-testid` is not present today; the capability is preserved by the aria-labels and button text.

### 6. Angular rules followed

**Status: PASS**

- Standalone components: yes.
- `ChangeDetectionStrategy.OnPush`: yes on both shells.
- Signals + `inject()`: yes.
- No `[innerHTML]`: no raw HTML binding added.
- No new `as any` or `@ts-ignore`: grep over `libs/frontend/chat/src/lib/settings` returned none.
- Non-spec files ≤ 700 lines:
  - `settings-save-feedback.service.ts`: 184 lines
  - `advanced-settings.component.ts`: 138 lines
  - `search-voice-settings.component.ts`: 32 lines
  - `settings.component.ts`: 206 lines
  - `settings.component.html`: 172 lines
- Cross-lib imports only via package barrels: yes (`@ptah-extension/core`, `@ptah-extension/ui`, `@ptah-extension/shared`).
- Text colour stays `text-base-content`: new markup uses `text-base-content` for text; colour only on icons (`text-secondary`) and badges.

### 7. Bundle budget

**Status: PASS (by construction)**

- `settings.component` does not use `@defer` for tab shells today; the new shells are eagerly imported like the children they replace.
- No new heavy dependencies were added; the same child components are imported, just via the shells.
- The full webview build was not run (per instructions: team-leader runs Gate G). Typecheck/lint confirm no import errors.

## Preserve-list check (pattern map §4)

| Capability | Verdict | New location |
|---|---|---|
| Membership badge, status, user identity, plan text | stays | `advanced-settings.component.ts:45` -> `<ptah-license-status-card />` |
| Key-not-active warning + re-enter | stays | inside `<ptah-license-status-card />` |
| Log out (confirm) | stays | inside `<ptah-license-status-card />` |
| Enter membership key + format check + server verify | stays | inside `<ptah-license-status-card />` |
| Create Account / Manage / Explore Builders | stays | inside `<ptah-license-status-card />` |
| Export settings / Import settings | moves | `advanced-settings.component.ts:48-81` |
| Enhanced system prompt on/off | stays | `advanced-settings.component.ts:73` -> `<ptah-enhanced-prompts-config />` |
| Ptah Enhanced / Default status text | stays | inside `<ptah-enhanced-prompts-config />` |
| Generated-at, detected stack, view prompt, regenerate, download, empty-state guidance | stays | inside `<ptah-enhanced-prompts-config />` |
| Output style: pick active, clear selection, new, edit, delete, invalid-file list + rewrite, collision / fallback / missing-active banners, copy to project | stays | `advanced-settings.component.ts:74` -> `<ptah-output-style-config />` |
| Output style CLI parity | stays | inside `<ptah-output-style-config />` |
| Reasoning effort (6 choices incl. SDK default) | stays | inside `<ptah-enhanced-prompts-config />` / workflows |
| Dynamic workflows on/off | stays | `advanced-settings.component.ts:75` -> `<ptah-workflows-config />` |
| Ultracode on/off (+ restore previous effort) | stays | inside `<ptah-workflows-config />` |
| MCP port edit with validation and restart note | stays | `advanced-settings.component.ts:76` -> `<ptah-mcp-port-config />` |
| MCP namespace toggles (5) | stays | inside `<ptah-mcp-port-config />` |
| Browser "Allow localhost" | stays | inside `<ptah-mcp-port-config />` |
| VS Code LM model, Default / Configured badges, capabilities, set default, no-key note | stays | `advanced-settings.component.ts:77` -> `<ptah-vscode-lm-config />` |
| CLI re-detect after LM model change | stays | `settings.component.ts:203-205` via `(modelChanged)` from Advanced shell |
| Web search: multi-provider select, per-provider key set/update/clear, key-status badges, signup links, test-all, max results | stays | `search-voice-settings.component.ts:24` -> `<ptah-web-search-config />` |
| Voice: STT provider and TTS provider selection incl. unavailable-with-reason | stays | `search-voice-settings.component.ts:26` -> `<ptah-voice-config />` |
| Local STT/TTS panels, ElevenLabs, go vet consent | stays | inside `<ptah-voice-config />` / `<ptah-go-vet-consent-config />` |
| Deep-link `PendingSettingsTab` tab ids `pro-features` and `tools` | stays | `settings.component.ts:134-136`, `:177-180`, `settings.component.html:71-96` |
| `ptah-license-status-card` selector | stays | unchanged |
| `aria-label="Export settings"` | stays | `advanced-settings.component.ts:53` |
| `ptah-vscode-lm-config` selector | stays | `advanced-settings.component.ts:77` |
| `ptah-web-search-config` selector | stays | `search-voice-settings.component.ts:24` |
| `settings-toggle-web-search-provider-*` testids | stays | inside `<ptah-web-search-config />` |
| `local-tts-preview-btn` testid | stays | inside `<ptah-voice-config />` |
| `go-vet-consent-*` testids | stays | inside `<ptah-go-vet-consent-config />` |

## Specs added

- `libs/frontend/chat/src/lib/settings/feedback/settings-save-feedback.service.spec.ts`
  - Added `describe('saveGeneric (G2)', …)` block with 10 specs:
    - success + Undo
    - no Undo when request has none
    - failed write shows failure message
    - write throw reports unconfirmed
    - re-entry blocked during generic save
    - re-entry blocked during Providers commit
    - Undo performs second real write
    - failed Undo reports failure
    - m1: Undo while another save is in flight keeps toast and runs once save ends
- `libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts`
  - 6 specs: mounts children in order, Export/Import aria-labels and RPC calls in VS Code and Electron, modelChanged forwarding, disables Export while exporting.
- `libs/frontend/chat/src/lib/settings/search-voice-settings.component.spec.ts`
  - 2 specs: web search in VS Code with voice/go-vet hidden; all three in Electron.

## Verify results

| Command | Result |
|---|---|
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat` | PASS (lint 0 errors; typecheck 0 errors; 1 pre-existing warning in unrelated file) |
| `npx nx test @ptah-extension/chat -- --maxWorkers=2` | PASS — Test Suites: 127 passed, 127 total; Tests: 2 skipped, 2099 passed, 2101 total |

No Gate G / webview build or Playwright run was performed (per task instructions, the team-leader runs Gate G).

## Deviations

None. The implementation follows the Batch 39 spec, the pattern map §8 row 39, §5 G2, §9 items 1 and 8, and §4 preserve list.

## Out-of-scope observations

- The `openPricing()` method on `SettingsComponent` was unused and referenced the removed `ClaudeRpcService` injection, so it was removed. The same capability exists on `license-status-card.component.ts`.
- The Data Portability card is currently a standalone bordered card inside the Advanced shell. Batch 40 will fold it into the "Membership & data" card as described in the pattern map.
- No visual gate captures were produced for these tabs because Gate V for Advanced / Search & Voice is Batch 50.

## Clarifications Needed

None.
