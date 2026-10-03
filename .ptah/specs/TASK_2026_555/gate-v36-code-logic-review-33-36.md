# Code Logic Review — `TASK_2026_555` (Batches 33–36: Agent Orchestration)

**Reviewer:** antigravity CLI lane (cross-side of in-process authors)  
**Date:** 2026-10-02  
**Worktree:** `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign` (HEAD `e75a1cf31`)  
**Scope:** Batches 33–36 (Policy bar, PtahCliConfig retirement & CLI matrix parity, Background roles table & consumer rows, Orchestration scenes & fold gate)

---

## Summary

| Metric              | Value                 |
| ------------------- | --------------------- |
| Overall score       | 8/10                  |
| Assessment          | APPROVED WITH NOTES   |
| Blocking issues     | 0                     |
| Serious issues      | 1                     |
| Moderate issues     | 2                     |
| Minor issues        | 1                     |
| Failure modes found | 4                     |

### Score Separation
- **8/10 vs 9–10:** While core D15 invariants, atomicity of `PtahCliConfig` removal, and unit/harness coverage are exemplary, 1 serious silent failure mode (unhandled `saveTimeout` failure feedback) and 2 moderate edge cases (ignored repeated deep links on the same tab; trigger button focus loss when closing role popover during save) prevent a top-band score.
- **8/10 vs 5–6:** There are no data-loss risks, zero blocking defects, zero TypeScript errors in changed files, complete absence of stubs or regressions against `parity-inventory.md`, and all 203 targeted tests pass cleanly.

---

## Five Logic Questions

### 1. How does this fail silently?
- **Enhancement timeout save failure ([`provider-consumer-assignments.component.ts:374-384`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L374-L384)):** If `state.saveSettings(...)` fails or is refused (`accepted === false` or `commit().status !== 'saved'`), `saveTimeout()` simply does nothing. It does not route through `SettingsSaveFeedbackService` (no toast alert), nor does the template render an inline save error (the only error displayed is `timeoutValidationError`, which evaluates client-side bounds). The user clicks "Save limit", the save fails, but no visual feedback explains the failure; the modal/input simply stays open without confirmation or error.
- **Popover order error mask ([`agent-orchestration-config.component.ts:279`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts#L279)):** In `savePreferredOrder()`, if a save is refused because another save is in flight (`feedback.save()` returns early without modifying `state.commit()`), and `state.commit().status` was already `'saved'` from a preceding write, `this.state.commit().status !== 'saved'` evaluates to `false`. While the toast displays the refusal alert, the inline popover error `ORDER_NOT_SAVED` is not set.

### 2. What user action produces unexpected behaviour?
- **Re-triggering a deep link to the same role without switching tabs ([`settings.component.ts:187-205`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/settings.component.ts#L187-L205), [`orchestration-settings.component.ts:119-125`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts#L119-L125), [`provider-consumer-assignments.component.ts:242-251`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L242-L251)):** If a user arrives via deep link to a role (e.g. `judge`), closes the popover via Esc, and subsequently clicks another deep link targeting `judge` while remaining on the Orchestration tab, the request is completely ignored. Because `orchestrationTarget` in `SettingsComponent` was not cleared on popover dismissal, the signal value is identical (`'judge' === 'judge'`), no change notification fires, and the role popover fails to re-open.
- **Closing a role popover via Esc while save is in flight ([`provider-consumer-assignments.component.ts:86, 304-311`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L86)):** If the user selects a model and presses Esc while the write is saving, the popover unmounts and `cancelEdit()` runs `afterNextRender` to focus the trigger button `consumer-edit-${id}`. Because the trigger button is natively `[disabled]="busy()"`, the DOM ignores `focus()`, and focus drops to `document.body`.

### 3. What input data produces a wrong answer?
- **Enhancement timeout NaN or float handling ([`provider-consumer-assignments.component.ts:371, 376-378`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L371)):** `onTimeoutInput` takes `(event.target as HTMLInputElement).valueAsNumber`. `isTimeoutSaveDisabled` checks `timeoutValidationError() !== null`, but `valueAsNumber` on an empty or invalid string produces `NaN`. In `timeoutValidationError`, `isNaN(sec)` returns true and shows `"Must be between..."`, which disables the button. Floating point seconds (e.g., `12.5`) pass client validation and multiply to `12500` ms, which is sent to the backend. While the backend handles ms numbers, an explicit `Math.round()` on save is cleaner.

### 4. What happens when a dependency fails?
- **Re-detect CLIs failure ([`agent-orchestration-config.component.ts:251-260`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts#L251-L260)):** Correctly caught. A failed RPC or thrown error sets `detectFailed.set(true)`, which renders a fixed sentence `"Could not re-detect CLI agents. Your saved settings have not changed."` without leaking raw host error strings.
- **Provider connection check in matrix ([`cli-orchestration-matrix.component.ts:477`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts#L477)):** `testResult()` renders `Test failed: ${row.lastTest.reason ?? 'the host gave no reason.'}`. Verified that `reason` originates from backend `ptahCliRegistry.testConnection`, which sanitizes error text via `sanitizeErrorMessage` (Batch 12b), satisfying the fixed/sanitized sentence requirement.
- **Unreachable / unready background provider ([`provider-consumer-assignments.component.ts:316`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L316)):** Correctly blocks saves. The draft remains in the picker with an alert (`role="alert"`) ending in `" Not saved."` and a `"Set up {provider}"` button. No write is executed.

### 5. What is missing that the requirements never mentioned?
- **Clearing active deep-link target upon popover or modal close:** The requirements specified that leaving a tab and returning must not re-open the deep link (handled in `setActiveTab` by resetting targets). However, they did not specify how a deep link target is consumed when the user closes the modal/popover *within the same tab session*, leading to the sticky signal issue identified in Question 2.

---

## Failure Modes

### FM-1: Silent Failure on Enhancement Time Limit Save
- **Trigger:** User edits enhancement time limit and clicks "Save limit", but the state service rejects the write or the backend returns `success: false`.
- **Symptom:** No toast appears, no alert renders. The edit form stays visible with no explanation.
- **Evidence:** [`provider-consumer-assignments.component.ts:374-384`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L374-L384)
- **Current handling:** `if (accepted && this.state.commit().status === 'saved')` gates the success action, but no `else` branch handles errors.
- **Recommendation:** Route `saveTimeout` through `SettingsSaveFeedbackService.save()` or set an inline error signal to display under the input if the commit fails.

### FM-2: Sticky In-Tab Deep Link Target
- **Trigger:** User opens a role via deep link, dismisses it with Esc or Cancel, and subsequently clicks another deep link targeting the same role without switching tabs.
- **Symptom:** The popover does not re-open; nothing happens on screen.
- **Evidence:** [`settings.component.ts:196-199`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/settings.component.ts#L196-L199), [`provider-consumer-assignments.component.ts:245-250`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L245-L250)
- **Current handling:** `orchestrationTarget` is only cleared in `setActiveTab` when `next !== activeSettingsTab`. `initialEditingConsumerId` only applies when `deepLinkId !== this.appliedDeepLinkId`.
- **Recommendation:** Clear `orchestrationTarget` in `SettingsComponent` once consumed, or emit an output when the target popover opens/closes to reset the pending target.

### FM-3: Focus Dropped to Body on Popover Dismissal During Save
- **Trigger:** User selects a provider/model in the role popover and presses Esc while the save operation is resolving.
- **Symptom:** Popover closes, but focus drops to `document.body` instead of the trigger cell button.
- **Evidence:** [`provider-consumer-assignments.component.ts:86, 309`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L86)
- **Current handling:** The trigger button has `[disabled]="busy()"`. When `afterNextRender` calls `focus()`, the button is still disabled and rejects focus.
- **Recommendation:** Use `[attr.aria-disabled]="busy() ? 'true' : null"` and CSS pointer-events on the cell button (matching the Batch 36 order popover fix in `agent-orchestration-config.component.ts:99`).

### FM-4: Order Error Popover Notice Masked by Prior Commit State
- **Trigger:** User moves an agent order while another save is in flight.
- **Symptom:** Toast alerts "Another change is still saving", but the inline error inside the popover is omitted.
- **Evidence:** [`agent-orchestration-config.component.ts:279`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts#L279)
- **Current handling:** Checks `if (this.state.commit().status !== 'saved')`. If a previous save was `'saved'`, this condition evaluates to false.
- **Recommendation:** Check the boolean result of `this.feedback.save(...)` or track local save success explicitly.

---

## Blocking Issues
*None identified.*

---

## Serious Issues

### S-1: Enhancement Time Limit Save Failure Provides No User Feedback
- **File:** [`libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:374-384`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L374-L384)
- **Scenario:** The user changes the enhancement time limit and clicks "Save limit". If the network drops, another save blocks it, or backend validation fails, `saveSettings` returns `false`.
- **Impact:** The UI remains stuck in editing mode with the "Save limit" button re-enabled, giving zero feedback as to why the save was not applied. Violates D15 observability principles.
- **Fix:** Either route the save through `SettingsSaveFeedbackService.save()` to provide a status/alert toast with Undo, or set a local `timeoutSaveError` signal rendered as `role="alert"` in the editor template.

---

## Moderate and Minor Issues

### M-1: In-Tab Deep Link to Same Role Ignored After Dismissal
- **File:** [`libs/frontend/chat/src/lib/settings/settings.component.ts:196-199`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/settings.component.ts#L196-L199)
- **Scenario:** Deep-linking to role `judge` sets `orchestrationTarget('judge')`. If the user closes the popover via Esc and triggers the deep link again without leaving the Orchestration tab, the signal does not fire a change notification.
- **Impact:** Secondary deep links fail to activate when clicked from within the open settings session.
- **Fix:** In `SettingsComponent.applyPendingTab()`, clear `orchestrationTarget` before setting the new target if it matches, or provide a consumption callback from `OrchestrationSettingsComponent`.

### M-2: Popover Dismissal During Save Drops Focus to Document Body
- **File:** [`libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:86, 309`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts#L86)
- **Scenario:** User selects a provider/model and presses Esc while the request is in flight.
- **Impact:** Trigger button is `disabled="true"` during save; `afterNextRender` focus fails, leaving keyboard focus on `body`.
- **Fix:** Replace `[disabled]="busy()"` on the trigger button with `[attr.aria-disabled]="busy() ? 'true' : null"` and guard `toggleEdit()` against `busy()`.

### m-1: Stale Commit State Can Mask Order Popover Inline Alert
- **File:** [`libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:279`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts#L279)
- **Scenario:** Refused order move when prior commit was `'saved'` does not show `ORDER_NOT_SAVED` inside popover.
- **Impact:** User sees toast alert but popover does not show the inline explanation.
- **Fix:** Have `SettingsSaveFeedbackService.save()` return a status boolean indicating if the specific write succeeded, and check that return value.

---

## Checked and Fine List

1. **`PtahCliConfig` Complete Retirement (Batch 34 / D14 Atomic Deletion):**
   - Zero occurrences of `PtahCliConfigComponent` or `ptah-cli-config` remain in `libs` or `apps` (excluding the 2 expected backend persistence imports in `cli-agent-runtime`).
   - All 18 capabilities from `parity-inventory.md` §3 (Add, Edit, Delete, Test, Model Count, Copilot Login, Keyless Hints, Show/Hide Key, Status Badges, Per-Instance Model, Delegated Models & Efforts, Cursor Key, etc.) are verified present across the CLI matrix, modals, and popovers.
   - `cli-agents` routing target in `SettingsComponent` correctly focuses `[data-testid="cli-matrix"]`.
2. **D15 Compliance in Policy Bar (Batch 33):**
   - Max concurrent slider bounds (1–20) enforced; dragging shows live preview badge without writing; release saves with Undo; `finally` resets thumb to the read-back value if save fails or is rejected.
   - Preferred order moves save the entire order through `SettingsSaveFeedbackService` with Undo. Reordering is strictly disabled when saving (D3) or when lists are unloaded.
   - Re-detect CLI agents sets `detectDone` / `detectFailed` with fixed sentences only (`DETECT_FAILED`); no host error strings leak to the client.
3. **Order Popover Focus & Esc Preservation (Batch 36 / commit `6384f0a22`):**
   - Move buttons use `[attr.aria-disabled]="canReorder() ? null : 'true'"` rather than native `disabled` during save operations.
   - Button retains focus during the 100–300 ms save window, ensuring Esc keypresses close the popover cleanly rather than being lost to `body`.
4. **Role Popovers & Readiness Validation (Batch 35):**
   - `assignmentSaved` event is strictly gated on the write's own successful execution (`accepted && this.state.commit().status === 'saved'`).
   - Unready providers (blocking status) immediately halt execution before `saveDraft()` is called; no settings are written and a warning banner with `" Not saved."` is rendered.
5. **Setup Deep-Link Flow (Batch 35):**
   - Clicking `"Set up {provider}"` emits `setupProviderRequested`, which calls `appState.requestSettingsTab({ tab: 'providers', providerId })`.
   - Settings switches to the Providers tab and opens the wizard for `providerId`. `requestedProviderConsumed` properly clears the request on mount, preventing reopen loops.
6. **Background Roles `<details>` & Tab Switching (Batches 33, 35, 36):**
   - Roles container is wrapped in `<details data-testid="background-roles-details">` closed by default (Deviation 4).
   - Deep-linking to any role or `background-models` expands the `<details>` and focuses the section.
   - Leaving the tab and returning via `setActiveTab()` resets `orchestrationTarget` and `providersTarget` to `null`, ensuring returning visits keep roles closed.
   - When role data is still loading, deep-link effect gracefully waits for `row.loaded` before calling `toggleEdit()`.
7. **Clean Diagnostics & Tests:**
   - `ptah_get_diagnostics` confirms 0 errors and 0 warnings across all changed files.
   - Targeted Jest test run passes 6/6 suites and 203/203 tests.

---

## Data Flow

1. **User interacts with Max Concurrent Slider:**
   - Input drag &rarr; `previewMaxConcurrent` updates `draft` signal &rarr; UI badge reflects live number without writing `[OK]`
   - Release &rarr; `saveMaxConcurrent` triggers &rarr; calls `feedback.save` &rarr; `state.saveSettings` dispatches `agent:setConfig` &rarr; `finally` syncs slider position to `state.orchestration().data.maxConcurrentAgents` `[OK]`
2. **User moves Agent Order in Popover:**
   - Click ▲/▼ &rarr; `canReorder()` check &rarr; buttons set to `aria-disabled` &rarr; `savePreferredOrder` invokes `feedback.save` with Undo patch &rarr; `afterNextRender` restores focus to moved button `[OK]`
   - Refusal or failure &rarr; UI chips retain read-back order &rarr; popover shows inline `ORDER_NOT_SAVED` (subject to m-1) `[OK]`
3. **User reassigns Background Role in Table:**
   - Click role cell &rarr; opens `NativePopoverComponent` with `ProviderModelPickerComponent` &rarr; selection change checks `draftProviderReadiness().blocking` `[OK]`
   - If blocked &rarr; write aborted; alert displayed with setup button &rarr; click setup emits `setupProviderRequested` &rarr; lands on Providers wizard `[OK]`
   - If ready &rarr; `saveDraft` calls `feedback.save` &rarr; `writeAssignment` emits `assignmentSaved` only on verified save &rarr; triggers `state.refresh()` `[OK]`
4. **User edits Enhancement Time Limit:**
   - Click "Edit limit" &rarr; opens inline input seeded with `timeoutEffectiveSec` &rarr; input validates range &rarr; click "Save limit" invokes `saveTimeout` `[OK]`
   - Write succeeds &rarr; emits `timeoutSaved` and closes editor `[OK]`
   - Write fails &rarr; **silent failure: editor remains open without error feedback** `[GAP: S-1]`

---

## Requirements Fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Policy bar (max concurrent, preferred order, re-detect) | COMPLETE | None |
| D15 save feedback and Undo on policy changes | COMPLETE | Minor error masking edge case (m-1) |
| Retire `PtahCliConfigComponent` atomically (D14) | COMPLETE | None; full parity maintained |
| Roles table restyle (`table-xs`, popover reassignment, chips) | COMPLETE | Silent failure on timeout save (S-1); focus loss on save Esc (M-2) |
| Setup deep-link rewired to Providers wizard | COMPLETE | None |
| Deep-link targets cleared on tab switch | COMPLETE | In-tab repeat deep link ignored (M-1) |
| Electron fold ratchet flag & measurement logging | COMPLETE | Summary at 779px logged as `fold-pending` awaiting Gate V 36 decision |

---

## Edge Cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Re-ordering clicked rapidly | YES | `canReorder()` guards check and buttons set `aria-disabled` | None |
| Esc pressed while order move saves | YES | Buttons keep focus via `aria-disabled` (commit `6384f0a22`) | Popover closes cleanly |
| Esc pressed while role assignment saves | PARTIAL | Popover closes, but trigger button is disabled | Focus drops to body (M-2) |
| Role deep link arrives before data loads | YES | Effect observes `this.rows().find()?.loaded` and defers `toggleEdit()` | None |
| Role deep link arrives twice within same tab | NO | Signal value unchanged; second click ignored | Fails to re-open popover (M-1) |
| Provider unready or unauthenticated | YES | `providerReadiness().blocking` blocks write before dispatch | None |
| Time limit save rejected by server | NO | Form stays open with no alert | Silent failure (S-1) |

---

## Verdict

- **Recommendation:** APPROVE WITH NOTES
- **Confidence:** HIGH
- **Top risk:** User changing enhancement time limit under degraded connectivity or conflict assumes the change saved because no error is shown.
- **What a robust implementation would add:**
  1. Wrap `saveTimeout()` in `SettingsSaveFeedbackService.save()` or bind an inline error alert.
  2. Clear `orchestrationTarget` in `SettingsComponent` when consumed so identical subsequent deep links can re-trigger.
  3. Change `[disabled]="busy()"` on role cell trigger buttons to `[attr.aria-disabled]` to prevent focus drop on Esc.

---

## Re-check (2026-10-02, code-logic-reviewer subagent — same-side, disclosed: the original reviewer lane (antigravity) is out of quota and no CLI lane is available)

Method: read the 36b diff on disk (read-only), the files each finding touched in full, and every caller of the new `SettingsSaveFeedbackService.save()` return value. No build, Playwright or Jest was run; spec claims in the fix reports were not re-executed.

| Finding | Status | Evidence |
| --- | --- | --- |
| S-1 / FM-1 (timeout save fails silently) | FIXED | `provider-consumer-assignments.component.ts:399-425`: `saveTimeout()` goes through `feedback.save()` (toast + Undo). `saved` is set inside its own `write()` from `accepted && commit().status === 'saved'` (`:407-410`). On refused/failed/throw the editor stays open, the draft and the input go back to the saved limit (`:419-423`), and a fixed `role="alert"` sentence shows (`:23`, `:193-195`; cleared on typing `:390`, Cancel `:385`, re-open `:377`). `timeoutSaved` is emitted only on a confirmed write (`:431`). `Math.round` on ms (`:429`) also settles Q3. No host text. |
| M-1 / FM-2 (repeat in-tab deep link ignored) | FIXED | Consumption path: `provider-consumer-assignments.component.ts:230,262-263` emits `deepLinkOpened` and never toggles an open popover shut; `orchestration-settings.component.ts:99,137-148` emits `focusTargetConsumed` once the section is focused and (for a role) the popover is open, in either order; `settings.component.html:151` binds it to `orchestrationTarget.set(null)`. A repeat is null then `judge` and applies again; the consumer effect clears `appliedDeepLinkId` on null (`:256`). The tab-switch reset and the Batch 35 "later visit opens nothing" rule are intact (`settings.component.ts:195-219`). Non-role targets (`cli-agents`, `background-models`) are consumed too (role `null`). |
| M-2 / FM-3 (focus drops to body on Esc during a save) | FIXED | Trigger is `[attr.aria-disabled]`, never native `disabled` (`provider-consumer-assignments.component.ts:91`, CELL `aria-disabled:` styles `:20`); `toggleEdit()` refuses to open while busy (`:314`); the deep-link effect waits for the save to end (`:259`). `cancelEdit()` focus restore (`:326`) now works. |
| m-1 / FM-4 (stale `commit()` hides the order popover error) | FIXED | `agent-orchestration-config.component.ts:274-286`: `saved` is computed inside the move's own `write()`; `orderError` follows it, not `commit()`. Covers refused, failed and throw. |

### New findings from the 36b lines

None blocking or serious. Checked and fine:

- `SettingsSaveFeedbackService.save()` returns `'saved' | 'failed' | 'refused'` (`feedback/settings-save-feedback.service.ts:29,76-120`). `'saved'` only when `write()` resolved true and the commit it produced is `saved`; a throw gives `failed`, `write() === false` gives `refused`. Toast text is fixed copy or `commit.message`. `commit.message` is set only from fixed strings in `providers-commit.service.ts` (`:314`, `:366`; `:390` states RPC text never enters state), so no host `error.message` reaches a toast.
- Callers that use the value, each correct: `add-cli-instance-modal.component.ts:343-346` (closes only on `saved`, same open session; a `failed`+`blocked` commit refreshes the context), `cli-tier-mapping-modal.component.ts:257,292-297` (manual field closes only on `saved`), `cli-model-effort-popover.component.ts:224-240` (`afterSave`: close on `saved`, refresh context on `failed`+`blocked`), `cli-orchestration-matrix.component.ts:628-634` (delete confirm cleared only on `saved`; a refused or failed delete keeps the confirm and the toast alerts). Callers that discard the value (`toggle`, `saveMaxConcurrent`, `models-tiers-tab`, `main-agent-reassign-popover`, `copilot-auto-approve-toggle`) either track their own outcome inside `write()` or only need the toast, and none claim success from it.
- `testCliConnection` now clears the prior result before the call, uses a 45 s timeout and maps only the registry's fixed strings to fixed copy; anything else becomes `reason: null` (`providers-settings-state.service.ts:75-83,266-286`). This closes the "host reason text" note in the original Q4 (`cli-orchestration-matrix.component.ts` rendered `lastTest.reason`; it is now fixed copy or the "host gave no reason" fallback). `clearCliTest` guards a stale in-flight run via the generation bump.
- Cursor key popover (`cursor-credential-popover.component.ts:125-131,145-165`): "Key stored, not verified." (user-accepted deviation), toast announce after the write's own outcome. Its failure text appends `outcome.message`, which is a fixed `DRAWER_WRITE_*` string or `commit.message` (fixed), not host text. The typed key is dropped only on `saved`.

### Notes (Moderate or Minor, not blocking)

- N-1 (Minor): `saveDraft()` (`provider-consumer-assignments.component.ts:346-360`) ignores the new `save()` result and resets the picker from `commit().status !== 'saved'` (`:359`). A `failed` result from a throwing `write()` after an earlier `saved` commit would leave the unsaved draft showing in the picker (toast still alerts). Refusal while another save runs is safe (commit is `saving`). Pattern differs from S-1 and m-1, where the own-outcome rule was applied; use the returned `'saved'` here too.
- N-2 (Minor): `saveTimeout` shows `TIMEOUT_NOT_SAVED` ("The limit shown is the saved one.") also when the save was refused before it ran because another save was in flight (`:405-424`); the toast gives the real cause, so this is wording only.
- N-3 (Minor, carried): the 36b fold round 2 truncates provider names in Electron (full name in `title`); this is disclosed and user-visible only, with no logic risk.

Residual uncertainty: the fix reports claim 943 passing Jest tests and 45 passing Playwright cases; I did not re-run them. The repeated in-tab deep link (M-1) has Jest coverage only (the matrix report notes no Playwright scene).

**Verdict: APPROVED WITH NOTES — 8.5/10.** All four findings (S-1, M-1, M-2, m-1) are fixed on disk with their own-result gating; no finding is open or covered by a user decision. The notes are N-1 (use the new `save()` result in `saveDraft`) and the unexecuted-test caveat above.
