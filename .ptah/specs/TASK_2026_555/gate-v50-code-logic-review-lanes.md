# Code Logic Review — `TASK_2026_555` Gate V 50 (Advanced / Search & Voice tabs)

**Reviewer:** antigravity CLI lane (cross-side: authors were opencode, Glm and in-process)  
**Scope:** Commits for Batches 39 (`f316580ea`), 40 (`0e5cb4d38`), 41 (`81caf233a`), 45 (`40f4bc821`), 46 (`795fb435a`), 47 (`bd4c5c6a3`), 48 (`df3cf51a5`), 40b (`011961e9e`), 43b (`1de289ccd`), 45b (`0947cea9e`), 49b (`4fad78694`), 50a (`e2032e30a`).  
**Score:** 8/10  
**Verdict:** APPROVED WITH NOTES  

---

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED WITH NOTES                  |
| Blocking issues     | 0                                    |
| Serious issues      | 1                                    |
| Moderate issues     | 2                                    |
| Minor issues        | 2                                    |
| Failure modes found | 5                                    |

Score justification: The implementation is structurally sound, rigorously tested (44 Jest test suites, 986 unit tests passing), strictly adheres to D15 across all primary save and revert paths, eliminates visible host error text via fixed sentences (F1), safely enforces verify-then-save for credentials, and correctly isolates Electron-only surfaces from VS Code. An 8 separates this implementation from 9-10 because of an edge-case silent failure when `enhancedPrompts:getStatus` returns an error payload inside an RPC success response, and minor focus management gaps in the Log Out inline confirmation.

---

## Five Logic Questions

### 1. How does this fail silently?
- [`libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:351-360`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L351-L360): `loadPromptStatus()` queries `enhancedPrompts:getStatus`. The backend handler (`enhanced-prompts-rpc.handlers.ts:185-192`) catches server errors and returns `{ enabled: false, hasGeneratedPrompt: false, generatedAt: null, detectedStack: null, cacheValid: false, error: '...' }` inside an RPC success. `loadPromptStatus()` checks only `result.isSuccess()`, treats this fallback as a valid state, sets `promptLoadError` to `null`, and sets `promptStatus` to the zeroed object. Consequently, `promptToggleDisabled()` evaluates to `true`, and the user is told "Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project" despite having a prompt on disk, silently concealing the server-side query error.

### 2. What user action produces unexpected behaviour?
- [`libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts:387-437`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts#L387-L437): When the user clicks "Log Out", the inline confirmation opens. Pressing `Escape` does not close it (unlike all other inline confirms in the redesign). If the user clicks "Cancel", focus is not returned to the "Log Out" button or any opener, leaving focus lost at `document.body`.

### 3. What input data produces a wrong answer?
- [`libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:378-389`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L378-L389): When `writePromptMode(enabled)` succeeds at the RPC layer, it invokes `await this.loadPromptStatus()`. If `loadPromptStatus()` resolves with an error fallback (as described in Question 1), `writePromptMode` still returns `{ ok: true }`. The toast states "Saved system prompt mode.", while the UI checkbox resets to unchecked/disabled.

### 4. What happens when a dependency fails?
- When transport or backend RPC fails across `web-search`, `voice-config`, `elevenlabs-panel`, `local-stt-panel`, `local-tts-panel`, and `go-vet-consent-config`, the components catch the failure, revert optimistic UI values to the previously saved state (D15), and surface standardized fixed error sentences (F1). Host error messages and stack traces never reach visible text or toast notifications.

### 5. What is missing that the requirements never mentioned?
- `license-status-card.component.ts` was not upgraded with the Batch 49b standardized inline confirmation behavior (Cancel auto-focus, Esc dismissal with `stopPropagation()`, and opener focus restoration).

---

## Failure Modes

### FM-1: `enhancedPrompts:getStatus` Internal Error Masked as Zero State
- **Trigger:** Backend failure during `getStatus` resolution (e.g. workspace filesystem permissions, corrupted prompt metadata, or transient I/O failure).
- **Symptom:** UI displays no error banner; system prompt checkbox is disabled with guidance to run the Setup Wizard, misleading the user into believing no prompt exists.
- **Evidence:** [`libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:351-360`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L351-L360) and [`libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:185-192`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts#L185-L192).
- **Current handling:** Checks only `result.isSuccess()`, ignoring `result.data.error`.
- **Recommendation:** Check `if (result.isSuccess() && !result.data.error)`; if `result.data.error` is present, populate `this.promptLoadError.set(PROMPT_STATUS_LOAD_FAILED)`.

### FM-2: Focus Lost and Inoperable Escape on Log Out Confirmation
- **Trigger:** Opening the "Log Out" inline confirmation and pressing `Escape` or clicking "Cancel".
- **Symptom:** Escape does not dismiss the confirmation; clicking Cancel closes the confirmation but leaves focus stranded on `document.body`.
- **Evidence:** [`libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts:387-437, 616-620`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts#L387-L437).
- **Current handling:** No `@keydown.escape` listener; Cancel button is not focused on mount; `cancelLogout()` resets `confirmingLogout` without restoring focus to the trigger button.
- **Recommendation:** Add `(keydown.escape)="cancelLogout($event)"`, auto-focus the Cancel button using `viewChild` and `effect()`, and restore focus to the Log Out button upon cancellation.

### FM-3: False Success Feedback When Refresh Fails After `writePromptMode`
- **Trigger:** `enhancedPrompts:setEnabled` succeeds, but the subsequent `loadPromptStatus()` call fails.
- **Symptom:** Toast alerts "Saved system prompt mode.", yet the toggle remains disabled and unchecked.
- **Evidence:** [`libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:378-389`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L378-L389).
- **Current handling:** Ignores the outcome of `loadPromptStatus()` and unconditionally returns `{ ok: true }`.
- **Recommendation:** Ensure `writePromptMode` checks that `this.promptEnabled() === enabled` after reloading before returning `{ ok: true }`.

### FM-4: Unstopped Event Bubbling on `go-vet` Escape Dismissal
- **Trigger:** Pressing `Escape` while the "Confirm go vet consent" confirmation is open.
- **Symptom:** Confirm closes, but `cancelEnable()` does not call `event.stopPropagation()`. Any enclosing container listening for Escape also receives the keydown event.
- **Evidence:** [`libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:256, 467-472`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts#L256).
- **Current handling:** `(keydown.escape)="cancelEnable()"` takes no event argument.
- **Recommendation:** Update to `(keydown.escape)="cancelEnable($event)"` and invoke `event?.stopPropagation()`, aligning with Batch 49b standards.

### FM-5: Remote Alert Placement on Failed Web Search Key Clear
- **Trigger:** `deleteApiKey` fails on `webSearch:deleteApiKey`.
- **Symptom:** The inline confirm group remains open (`confirmingClear` stays set), but the failure message is placed in `this.errorMessage`, which renders at the top of the card rather than inside the inline confirm group.
- **Evidence:** [`libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts:135-141, 501-519`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts#L135-L141).
- **Current handling:** `this.errorMessage.set(result.message)` populates the card-level alert.
- **Recommendation:** Render the failure message inline within the `[role="group"]` confirmation box so it is immediately visible to the user.

---

## Blocking Issues

*None.* No data corruption, credential leaks, unhandled exceptions, or catastrophic failures were identified.

---

## Serious Issues

### 1. Silent Error Concealment in `loadPromptStatus`
- **File:** [`libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:351-360`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L351-L360)
- **Scenario:** Backend `enhancedPrompts:getStatus` catches a filesystem or parsing error and returns an error payload inside a successful RPC response (`result.isSuccess() === true`).
- **Impact:** The UI silently swallows the error, hides the load error alert, and displays a disabled toggle prompting the user to run the Setup Wizard, masking existing prompt configuration.
- **Fix:** Update `loadPromptStatus()` to check `!result.data.error` before committing `result.data`, setting `this.promptLoadError.set(PROMPT_STATUS_LOAD_FAILED)` otherwise.

---

## Moderate and Minor Issues

- **[Moderate]** Log Out inline confirmation lacks auto-focus on Cancel, lacks an Esc handler, and loses focus on cancel: [`license-status-card.component.ts:387-437, 616-620`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts#L387-L437).
- **[Moderate]** `writePromptMode` returns `{ ok: true }` even if the subsequent `loadPromptStatus()` fails, producing contradictory UI and toast states: [`agent-behaviour-section.component.ts:378-389`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L378-L389).
- **[Minor]** `go-vet-consent-config.component.ts:256` does not pass the keydown event to `cancelEnable()` or call `stopPropagation()`.
- **[Minor]** Web search API key deletion failure renders at the card header alert rather than within the confirmation row: [`web-search-config.component.ts:513`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts#L513).

---

## Data Flow

1. **User Action:** User toggles control or inputs credentials across Advanced or Search & Voice tabs. -> *OK*
2. **Pre-Save Validation / Confirmation:**
   - Single short choices / checkboxes proceed immediately via `SettingsSaveFeedbackService.saveGeneric`. -> *OK*
   - Credential inputs (ElevenLabs) require passing connection test before save button unlocks (verify-then-save). -> *OK*
   - Destructive / high-impact actions (Log out, Clear key, Import, Allow localhost, go vet) open inline confirm (`role="group"`). -> *GAP: Log Out confirm missing Esc / focus return*.
3. **RPC Dispatch:** Request is sent to backend handler. -> *OK*
4. **Result Verification (D15):** Both `result.isSuccess()` AND inner flags (`result.data.success` / `result.data.ok`) are inspected. -> *GAP: `loadPromptStatus` misses `result.data.error`*.
5. **UI Update / Revert:** On success, signal updates and scope-less toast appears ("Saved {label}."). On failure, optimistic control is reverted to previous state and alert toast/inline alert is displayed with fixed sentence (F1). -> *OK*
6. **Undo Handling:** Toast presents Undo for restorable actions (S-sel). Undo executes as a real write of the previous value. -> *OK*

---

## Requirements Fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| D15: "Saved" only after write's own result (`isSuccess()` + inner flag); failed write reverts control | COMPLETE | Handled across all save paths (Batch 39, 41, 45, 46, 47, 48, 49b). |
| Fixed sentences (F1): No host error text in visible UI or toasts | COMPLETE | All host text converted to fixed sentences (Batch 40b, 43b, 45b, 48). |
| Verify-then-save (G13): ElevenLabs key requires passing test before save | COMPLETE | Verified in `elevenlabs-panel.component.ts:434-441`. |
| Single primary action per card (BRIEF #4) | COMPLETE | Verified across Membership, Output style, Web search, Voice engines. |
| Electron-only sections hidden on VS Code | COMPLETE | `VoiceConfig` and `GoVetConsentConfig` strictly gated by `isElectron` in `search-voice-settings.component.ts`. |
| Inline confirm for destructive actions (P8) | PARTIAL | Log Out confirm lacks Esc handler and focus management. |
| Preserved capabilities (Pattern Map §4) | COMPLETE | All capabilities preserved or explicitly replaced. |
| Deferral and bundle budget (§8) | COMPLETE | `@defer (on immediate)` correctly implemented on both tabs; child components unexported from main barrel. |

Implicit requirements not addressed: None.

---

## Edge Cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Multiple rapid clicks while saving in flight | YES | `feedback.saving()` disables interactive controls and guards entry points with `SAVE_REFUSED_MESSAGE`. | None. |
| Backend returns `{ success: false }` inside a successful RPC | YES | Components check both `isSuccess()` and inner success flags. | `loadPromptStatus` edge case noted in FM-1. |
| User cancels file dialog on Import | YES | Electron checks `result.data.cancelled` and exits without error notification. | None. |
| Draft key modified after connection test passed | YES | Any draft input change immediately clears `verifiedKey`, locking Save button. | None. |
| Output style activation fails after radio selection | YES | `syncActiveRadios()` resynchronizes native radio elements to saved store state. | None. |
| Drawer footer covered by toast | YES | Pure CSS rule lifts toast to `bottom-28` while drawer dialog is active. | None. |

---

## Checked and Fine

- **`SettingsSaveFeedbackService.saveGeneric` (G2):** Clean async flow, D3 saving locks shared with Providers tab, scope-less toast wording ("Saved {label}."), real Undo execution through identical entry point, failure prevention.
- **Web Search matrix (`WebSearchConfigComponent`):** Accurate provider status reporting, key clearing confirm, slider range handling, test connection error mapping.
- **Voice Engines & Drawer (`VoiceConfigComponent`, `VoiceDetailsDrawerComponent`):** Provider switching with Undo, lazy drawer mounting, direction tab synchronisation.
- **Local STT & TTS Panels (`LocalSttPanelComponent`, `LocalTtsPanelComponent`):** Curated vs custom source handling, download progress bar tracking via `VoiceDownloadProgressService`, validation regex enforcement.
- **Output Style Parity Warning (`OutputStyleStore`):** Parity write failures isolated from active style selection; JSON parser exceptions suppressed in favor of clean user-facing path messages.
- **Diagnostic / Build / Test Integrity:** Zero TypeScript diagnostics in all changed files; 44 of 44 Jest test suites and 986 unit tests pass.

---

## Verdict

- **Recommendation:** APPROVED WITH NOTES
- **Confidence:** HIGH
- **Top risk:** Backend status check errors on enhanced prompts may silently present as an uninitialized prompt state to the user.
- **What a robust implementation would add:**
  1. Inspect `result.data.error` in `loadPromptStatus()` and surface an inline load alert if present.
  2. Implement standardized Esc listener and focus restoration on the Log Out inline confirm in `license-status-card.component.ts`.
  3. Propagate `$event.stopPropagation()` on `go-vet-consent-config.component.ts` Esc keydown.


---

## Re-check round 1 (7e70f3a80)

**Reviewer:** antigravity CLI lane  
**Commit checked:** `7e70f3a80` (Batch 50b)  
**Score:** 10/10  
**Verdict:** APPROVED  

### Finding → Verification Matrix

| Finding ID | Previous Severity | Title | Status | Evidence (`file:line`) | Verification Notes |
|---|---|---|---|---|---|
| **Serious 1 / FM-1** | Serious | `loadPromptStatus` silent error concealment | **FIXED** | [`agent-behaviour-section.component.ts:383-395`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L383-L395) | `loadPromptStatus()` now explicitly validates `result.isSuccess() && !result.data.error`. When `result.data.error` is present or the transport throws, it sets `promptLoadError` to `PROMPT_STATUS_LOAD_FAILED` with an inline Retry button, prevents zeroed metadata corruption of `promptStatus`, and falls back to `PROMPT_NOTE_UNKNOWN` ("The system prompt status is not loaded yet.") instead of misleadingly prompting to run the Setup Wizard. Verified by `agent-behaviour-section.component.spec.ts:360-395`. |
| **Moderate 2 / FM-2** | Moderate | Log Out inline confirm focus loss & Esc handling | **FIXED** | [`license-status-card.component.ts:378, 399, 435, 470, 641-649`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts#L378) | Standardized to the Batch 49b P8 confirm pattern: `#logoutCancel` is auto-focused via `effect()` on open; `(keydown.escape)="cancelLogout($event)"` is attached to `role="group"`; `cancelLogout(event?)` verifies the confirm is open and not in-flight, stops propagation, closes the prompt, and restores focus to `#logoutButton` via `afterNextRender()`. Verified by `license-status-card.component.spec.ts:197-248`. |
| **Moderate 3 / FM-3** | Moderate | False success feedback when refresh fails after `writePromptMode` | **FIXED** | [`agent-behaviour-section.component.ts:417-430`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts#L417-L430) | `loadPromptStatus()` now returns a `boolean` indicating refresh success. If the subsequent status re-read fails after `enhancedPrompts:setEnabled` succeeds, `writePromptMode` updates `promptStatus` locally with `{ ...status, enabled }` so the checkbox and badge agree with the "Saved" toast while preserving the inline load error alert with Retry. Verified by `agent-behaviour-section.component.spec.ts:402-429`. |
| **Minor 4 / FM-4** | Minor | Unstopped event bubbling on `go-vet` Escape dismissal | **FIXED** | [`go-vet-consent-config.component.ts:267, 468-473`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts#L267) | `(keydown.escape)="cancelEnable($event)"` now passes the event, and `cancelEnable(event?)` invokes `event?.stopPropagation()` when `confirmingRoot() !== null`. Verified by `go-vet-consent-config.component.spec.ts:546-565`. |
| **Minor 5 / FM-5** | Minor | Remote alert placement on failed Web Search key clear | **FIXED** | [`web-search-config.component.ts:264-270, 501-537`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-advanced-search-voice/libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts#L264-L270) | Replaced card-level alert assignment with a dedicated `clearError` signal rendered as a `role="alert"` element directly inside the open `role="group"` confirmation box (`settings-web-search-clear-error-<id>`). `requestClear()` and `cancelClear()` reset `clearError`. Verified by `web-search-config.component.spec.ts:376-415`. |

### New Defects Check

- **Scope inspected:** All files modified in commit `7e70f3a80` across Stream A (Advanced) and Stream B (Search & Voice + membership).
- **Diagnostics:** 0 errors across all touched components (`ptah_get_diagnostics`).
- **Tests:** 10 of 10 targeted test suites (297 tests) passing; workspace test suite passing with 0 failures.
- **Findings:** No new logic, accessibility, D15, or contrast defects introduced by these fixes.

### Final Assessment

- **Score:** 10/10
- **Verdict:** APPROVED
- **Conclusion:** All five logic review findings have been completely resolved with precise file:line implementations and comprehensive unit spec coverage. The Advanced and Search & Voice tabs are fully verified and ready for gate closure.
