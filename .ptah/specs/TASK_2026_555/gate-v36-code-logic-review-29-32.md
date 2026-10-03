# Gate V 36 code-logic review, Batches 29-32b (part 1 of 2) — TASK_2026_555

**Reviewer disclosure:** same-side, disclosed — in-process subagent reviewing in-process authors; every CLI lane was unavailable (antigravity quota reset in 127 h, Glm weekly limit, opencode Unknown error, codex limited until 2026-10-03 20:10).

Worktree `task-555-settings-redesign`, head `e75a1cf31`. Commits: 29 `41b85393c`, 30 `07da3f4f6`, 31 `c04a85a4e`, 32 `b4c512eb3`, 32b `b1ef5eb50`. Part 2 (Batches 33-36) is in `gate-v36-code-logic-review-33-36.md` and is not repeated here.

Scope read in full at the current head: `ptah-ai/cli-matrix-rows.ts`, `cli-permission-notes.ts`, `cli-orchestration-matrix.component.ts`, `cli-model-effort-popover.component.ts`, `cursor-credential-popover.component.ts`, `copilot-auto-approve-toggle.component.ts`; `providers/add-cli-instance-modal.component.ts`, `cli-tier-mapping-modal.component.ts`; `libs/frontend/ui` `native-modal`, `native-autocomplete`, `provider-model-search-field` diffs. Traced into `settings-save-feedback.service.ts`, `providers-commit.service.ts`, `providers-settings-state.service.ts`, `providers-settings-sections.ts`, `drawer-write.ts`, `ptah-cli-rpc.handlers.ts`, `ptah-cli-registry.ts` (`createAgent`, `updateAgent`, `deleteAgent`, `testConnection`), `ptah-cli-registry.utils.ts` (`sanitizeErrorMessage`), `agent-rpc.handlers.ts` (Cursor key), `copilot-permission-bridge.ts`, `native-popover.component.ts`, `settings-toast.component.ts`.

Verification: the 8 spec suites for these units pass (145 tests, `jest -c libs/frontend/chat/jest.config.ts`, scoped). Nothing in a browser; findings that depend on rendering are marked "not browser-verified".

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | NEEDS_REVISION (two small, targeted fixes: S1 and S2; the rest are notes) |
| Blocking | 0 |
| Serious | 2 |
| Moderate | 7 |
| Minor | 6 |

Why 6 and not 7-8: the write paths are carefully built (D15 holds on every write I traced), but two paths show a wrong thing as fact. A failed Test can render as "Test passed", and a key typed for one provider can be submitted for another. Why not 4-5: neither is data loss, and both are small fixes.

## Findings

### S1 (Serious) — A failed or timed-out Test is shown as "Test passed" when the same row passed before

- File: `cli-orchestration-matrix.component.ts:472-483`, `providers-settings-state.service.ts:252-258`, `providers-settings-sections.ts:85-105`
- Scenario: Test instance A, it passes (`cliTest` = `{id:A, success:true, latencyMs:900}`). Later the key is revoked or the provider is slow, and Test A again. `testCliConnection` goes through `readSection(..., retainOnError = true)`. When the RPC throws or times out, the store becomes `status:'error'` and **keeps the previous data**. `cliMatrixRows` builds `lastTest` from that data, so `testResult` takes the first branch (`if (row.lastTest)`) and renders "Test passed in 900ms." with `role="status"`. The Status badge also keeps "Ready (900ms)". The "The test could not run" branch (line 479) only fires when `lastTest` is null, so it cannot fire for a repeat test of the same row. While the second test is loading, the old pass is also shown.
- Likely trigger: the host aborts at 30 s (`ptah-cli-registry.ts:503`) and the webview RPC default timeout is also 30 s (`claude-rpc.service.ts:135`). A slow provider hits the RPC timeout first.
- Impact: a silent failure that reads as success on a credential check.
- Fix: in `test()`, clear or version the result before the call (for example a `testRun` counter, or call the store with `retainOnError=false`), and have `testResult` treat `status:'error'` for the row being tested as "could not run" ahead of `lastTest`. Show nothing while `loading`. Also pass a timeout above the host's 30 s to `ptahCli:testConnection`, so a slow pass is not reported as "could not run".

### S2 (Serious) — A key typed for provider A is retained and sent when the user switches to provider B in the Add form

- File: `add-cli-instance-modal.component.ts:72` (`(change)="providerId.set(...)"`), `:226-237`, `:273-277`
- Scenario: Create, choose "OpenRouter" (required key), type its key (masked), then change the select to another provider.
  - If B shows no key field (`keyMode` `none`: local server or CLI login), `showKey()` is false, but `key()` is still set. Submit sends `apiKey: key`, so the hidden OpenRouter key is stored under the new instance's secret (`createAgent` stores whatever it gets).
  - If B is also keyed or optional, the masked field still holds A's key, and it will be sent to B's endpoint as its credential.
- Impact: a third-party credential is stored under, and transmitted to, the wrong vendor, with no visible cue. Wrong data, not an error.
- Fix: clear `key` (and `keyVisible`) in the provider select handler, and send `apiKey: showKey() ? key : ''` on create.

### M1 (Moderate) — The "sanitized at the registry" claim for the Test reason is only partly true

- File: `ptah-cli-rpc.handlers.ts:301-303`, `ptah-cli-registry.ts:549-561`, `ptah-cli-registry.utils.ts:110-126`, `cli-orchestration-matrix.component.ts:477`
- The handler's outer catch returns a fixed string. The registry's own result goes through unchanged: fixed strings, `Unknown provider: <id>`, or `sanitizeErrorMessage(<raw SDK or provider exception text>)`. That function is a pattern redactor, not an allow-list. It redacts `sk-/key-/token-` prefixes with 20 or more characters, any 40 or more character token, URLs containing `:` or `@`, and stack lines, and it caps the text at 500 characters.
- Raw provider text can still reach `error` and then the visible `Test failed: …` line. Examples: a key shorter than 40 characters without those prefixes (a Z.AI-style `<32hex>.<16>` key splits at the dot into two sub-40 pieces and passes), account or org names, request ids, local file paths, any message under 500 characters.
- The UI renders it by interpolation (no `innerHTML`), so this is disclosure, not injection. No new risk was added by Batch 30, but the comment at `cli-matrix-rows.ts` and the "sanitized reason" wording overstate it.
- Fix: map to fixed categories at the registry (auth rejected, network, timeout, no response, other) and show the category. Or keep the text only behind a "Details" disclosure.
- Not confirmed (pre-existing host logic): `testConnection` returns `success` on the first yielded SDK message (`:527-530`). If the SDK's init message precedes the first provider call, a bad key could pass. Worth a spike.

### M2 (Moderate) — Modals and popovers decide "saved" from shared `state.commit()` after `feedback.save`, not from that save's own result

- File: `add-cli-instance-modal.component.ts:280-283`, `cli-tier-mapping-modal.component.ts:231,257`, `cli-model-effort-popover.component.ts:239-243`, `cli-orchestration-matrix.component.ts:531`
- `SettingsSaveFeedbackService.save` returns early without calling `write()` when `saving()`, when `write()` resolves `false` (refused), and when it throws. In those cases `commit()` still describes an earlier `saved` commit. Each caller then reads `commit().status === 'saved'` and treats this attempt as landed: the Add modal closes and drops the form and key, the model popover closes, the delete confirm clears, and a manual tier field closes.
- Guards (`busy`, `canSubmit`) make the window narrow (a save from another source starting between the click and the call). Cursor and Copilot do this correctly (`runDrawerWrite`, `result.attempt`).
- Impact: low probability, but it is exactly the D15 stale-commit hazard the service's own comment names.
- Fix: have `feedback.save` return `'saved' | 'failed' | 'refused'` and have callers branch on that.

### M3 (Moderate) — Cursor popover is re-created when its row changes group, losing the outcome message and focus (not browser-verified)

- File: `cli-orchestration-matrix.component.ts:106-115,277-287`, `cursor-credential-popover.component.ts:112,120-128`
- The matrix renders rows inside `@for (group …)` / `@for (row …)`. After a successful Save key on the Uninstalled Cursor row, the commit refresh makes detection report Cursor installed, so the row leaves the Uninstalled `<tbody>` and is created in the Installed one. `openState` still says `{cursor, credentials}`, so a **new** popover instance opens, with a new `outcome` signal. "Key saved." is never shown, and no toast exists (Cursor bypasses the feedback service). The user sees only the badge flip to "Set". The new popover's `previousActiveElement` is `body`, so focus is lost on close. Removing the key does the reverse.
- Fix: render the credentials message from a matrix-level signal (or push a toast through the feedback service with `undo: null`), and restore focus to the new row's Credentials button after the move. The spec at `cli-orchestration-matrix.component.spec.ts:278-291` checks only that the button exists in each group, not the move.

### M4 (Moderate) — Cursor key is saved with no connection check (HANDOFF Gate V 36 item 6)

- File: `cursor-credential-popover.component.ts:138-148`, `providers-settings-state.service.ts:264-269`
- task.md line 71: "credentials still require a passing connection check". The write path is correct for what it does: the inner `success` is checked, and read-back compares `cursorApiKeyStored`. But "Key saved." and "Set" mean "stored", not "works". The Cursor adapter's "installed" detection only tests that a key resolves (`cursor-cli.adapter.ts:208-223`), so a wrong key flips the row to Installed and Ready. The same applies to Add instance: `ptahCli:create` stores the key unverified, and the Test button is manual.
- Smallest compliant behaviour that is not new host work:
  1. State it. Change the outcome text to "Key stored. Ptah cannot check Cursor keys yet; it is used on the next Cursor run."
  2. Show the status honestly: keep Cursor at Ready only with that note, or add a neutral "Key not verified" sub-badge.
  3. For Add instance, after a successful create, run `testCliConnection` on the new id and surface the result inline.
  4. Record the Cursor part as a deviation for the user at the gate.
- The real fix is a host verify RPC (a read-only Cursor SDK call). It needs a user decision, since it is host work.

### M5 (Moderate) — Tier modal shows "Loading this instance's tier mapping…" forever when `cliModels` failed

- File: `cli-tier-mapping-modal.component.ts:77-79,154-164`
- `mappings()` is `null` unless `cliModels().data[id]` exists. If the `cliModels` read errored with no retained data, the modal body is a permanent status line. The page's error alert and Retry sit behind the inert page. The catalogue error has its own Retry, but this one does not.
- Fix: when `state.cliModels().status === 'error'`, show an alert with Retry (`state.refreshCliModels()`). This is the "stale state after failed loads" item.

### M6 (Moderate) — Copilot "signed in" in the Add form can be stale, and the sign-in panel appears in Edit

- File: `add-cli-instance-modal.component.ts:198-212,220`, `:165-168`
- `signInSection` accepts any `externalAuth` data with `providerId === 'github-copilot'`. `signInAttempted` is reset on each open, but the shared store data is not. If the user signed in earlier (Providers tab, or an earlier open) and later signed out (`disconnectCopilot` does not reset that store, `providers-connection-setup.service.ts:353-358`), "Signed in" shows and Create is enabled without a current check. The instance is created with the `copilot-oauth` marker while Copilot is not authenticated.
- A better source exists: `connections()` already carries `copilotAuthenticated` (as `accountLabel`/`configured`).
- In Edit mode for a Copilot-backed instance, `keyMode` is `sign-in`, so the "Create is available once sign-in is confirmed" panel and a Login button appear on a form that only renames.
- Fix: derive `signedIn` from the connection row (or force a `getAuthStatus` read on open), and hide the sign-in panel when `editing()`.

### M7 (Moderate) — Edit with name + key can report "Not saved" after the rename was persisted

- File: `add-cli-instance-modal.component.ts:261-271`, `ptah-cli-registry.ts:360-367`
- `updateAgent` writes the config (rename) first and then the key. If the secret store throws, the handler returns the generic `success:false`. The modal then says "Could not save … Not saved: …name, …apiKey" while the new name is already on disk and the matrix shows it after refresh. The key itself is not lost: an empty key is never sent (`key.trim() ? {apiKey} : {}`), and `setProviderKey` trims. The edit path cannot wipe the stored key.
- Fix: acceptable to leave with a note; or split into two operations so the report is per field. `nameChanged` compares against the open-time snapshot, so a retry resends the same name harmlessly.

### M8 (Moderate) — The last Test result outlives the thing it tested

- File: `cli-matrix-rows.ts:217`, `cli-orchestration-matrix.component.ts:449-453`
- `lastTest` stays attached to the instance after a key replacement, rename, or tier change, so "Ready (900ms)" and "Test passed" describe the old credentials. Fix: clear `cliTest` for that id when a write touching that instance commits.

### M9 (Moderate) — Add form accepts duplicate or oversized names and any manual tier id

- File: `add-cli-instance-modal.component.ts:214-222`, `cli-tier-mapping-modal.component.ts:227-232`; the host `createAgent` has no uniqueness check
- Two instances named "Glm" are legal and indistinguishable in the matrix and in the delegation picker. The manual tier field takes any trimmed string with no length or whitespace check. Fix: warn on a duplicate name; reject whitespace inside a model id.

### Minor

1. `AddCliInstanceModalComponent` `hasStoredKey` is carried in `CliInstanceEditTarget` (`:15`, `cli-orchestration-matrix.component.ts:408`) and never used. Either use it ("a key is stored") or drop it.
2. After a successful create from the empty-state "Add Ptah CLI Instance" button (`cli-orchestration-matrix.component.ts:327`), that row disappears, so the dialog's focus return has no element and focus lands on `body`. Return focus to the header Add button in that case.
3. `SettingsSaveFeedbackService` shows raw field keys in failures: "Not saved: ptahCliAgents.<id>.tierMappings", "agentOrchestration.copilotAutoApprove" (`settings-save-feedback.service.ts:96-98`). Visible text should be labels.
4. Undo of a system on/off writes the whole `disabledClis` array captured at click time (`cli-orchestration-matrix.component.ts:508-513`). It would overwrite an unrelated `disabledClis` change made through another path in between. Writing the single inverse change is safer.
5. Matrix and Cursor popovers are `role="dialog"` but `NativePopoverComponent` has no Tab trap, so Tab leaves the popover into the page behind the transparent backdrop. It matches the other popovers (existing component), but the role claims more than it does. Esc after Undo (HANDOFF item 5) and the two-Esc tier field (item 8) are already known.
6. `native-modal` Tab wrap uses `FOCUSABLE` plus `[disabled]`; controls inside a `<fieldset disabled>` and radio groups are mis-ranked. Not reachable in the three current modals.

## Checked and fine

- **D15 on every write.** System on/off, instance on/off, delete, model, effort, instance model, Copilot, Cursor, create, update, tier: all go through `saveSettings`/`runCommit`. `ProvidersCommitService.settle` marks a write saved only when the RPC resolved and the inner flag is true (`agent:setConfig` `.success`, `ptahCli:* .success`), then runs read-back where one exists. `feedback.save` shows "Saved" only after `write()` resolved `true` and `commit().status === 'saved'`; a `false` or a throw shows an alert and no Undo. Toggles keep the checkbox on the saved value (`input.checked = row.enabled`) until read-back moves it, so a failed write reverts. No read-back exists for `ptahCli:create/update/delete`; the inner `success` is the proof, acceptable, and the refresh after the commit shows the result.
- **No host error text in toasts or the Cursor popover.** `requireRpcData` throws a fixed message; `settle` discards exception text; `runDrawerWrite` publishes fixed strings or `commit.message` (fixed). The only host-authored text reaching the page is the Test reason (M1).
- **Tier modal sends the full object.** `saveTier` copies the current mappings, sets or deletes the one tier, and calls `setCliInstanceTiers` (`cli-tier-mapping-modal.component.ts:244-258`). `cliInstanceTiersOperation` rebuilds all three tiers (trimmed, blanks omitted) and read-back compares all three. "Use inherited" and the Inherited row both call `saveTier(tier, '')`, which removes the key. Undo sends the previous full object. A deleted instance reads back as not saved. `registry.updateAgent` replaces `tierMappings` shallowly, so the full-object contract is required and met. A same-value pick is a no-op with no toast.
- **Copilot create gated on sign-in.** `canSubmit` requires `signedIn()` when `keyMode === 'sign-in'`; the `copilot-oauth` marker is applied in the commit service, not in the form. (Staleness of `signedIn`: M6.)
- **Edit cannot lose the key.** An empty replacement key is omitted from `params`; the host calls `setProviderKey` only when `apiKey !== undefined` (`ptah-cli-registry.ts:362`). Rename sends `name` only when changed. The provider is read-only in Edit. Undo is offered only for a pure rename (a replaced key cannot be restored).
- **Cursor credential popover.** Uses `runDrawerWrite`, so the outcome is this write's own. The typed key is cleared on a confirmed save, on destroy, and (add modal) on every open and close. A failed save keeps the key for retry. Host `agent:setConfig` trims the key and deletes on empty, and read-back checks `cursorApiKeyStored` (not env). The env-precedence note is shown.
- **Copilot toggle.** The `attempt` state machine (`skipped/threw/refused/started`) distinguishes refused, broken and committed; an unknown outcome makes the toggle indeterminate until a recheck. The permission copy matches `copilot-permission-bridge.ts` (readOnly auto-approves read tools/kinds and prompts for the rest; fullAuto approves all) and the host default (`true`).
- **Undo races.** `show()` replaces `undoRequest` on every feedback save, so an Undo always belongs to the latest feedback save; `undo()` keeps its request while a save is in flight and runs through `save()`, so it gets the same D15 treatment; the Undo button is disabled while `saving()`. Deleting and creating offer no Undo, which clears any earlier one.
- **Focus.** `NativeModalComponent` uses `showModal()`/`close()` (focus return to the opener is native); Esc is forwarded only. The Tab/Shift+Tab wrap handles first/last, an active element outside the panel, disabled and hidden controls, and a closed dialog; its spec covers all four. The hidden submit button is `tabindex=-1` and `hidden`, so it is not a stop. Footer toast buttons are inside the panel, so they are reachable. `NativePopoverComponent` stores and restores focus, closes on Esc and backdrop; the matrix gives the model/credential panels initial focus through `(opened)`. Spec'd.
- **Modal reopen state.** Both modals reset name, key, session and context on every open (`effect` + `untracked`), `session` guards a stale close, a blocked write refreshes `context`, and the footer toast exists only while open.
- **ui changes are opt-in.** `matchInputWidth`, `compact` (autocomplete) and `compact`, `placeholder` (search field) default to off or `null`. `selectedLabel` changes only when `compact()`. `placeholder() ?? selectedLabel()` equals the old binding by default. The one non-opt-in change is the `native-modal` Tab wrap; its other consumer, `provider-catalog-modal`, is a normal modal and benefits.
- **Matrix model (`cli-matrix-rows.ts`).** Unknown detected CLIs and Ptah instances in detection are skipped; duplicates are de-duplicated; the sort is stable with unranked ids last; Cursor's `sdk` version is hidden; Copilot unknown state is explicit rather than guessed; Cursor's Uninstalled row keeps Credentials. A null `cliModels` entry gives `selectedModel:null`, so the cell is absent rather than showing a fabricated default.
- **Failed loads in the matrix.** `noInstances` requires `cliAgents().status === 'ready'`; `loading` is true only with no data; the page shows per-section error alerts with Retry for cliAgents, cliModels and orchestration; the model popover shows its own catalogue error with Retry and disables the field while loading.
- **Stubs and standards.** No TODO, stub, `as any`, `@ts-ignore` or `[innerHTML]` in the reviewed non-spec files. All non-spec files are 700 lines or fewer (largest: matrix, 533). `catch` blocks that swallow are `catch {}` with a handled fallback (`loadModels`, `feedback.save`).
- **Scope rule (deviation 6).** Colour is on dots, badge borders and backgrounds; text is `text-base-content` throughout the reviewed templates.

## Five logic questions

1. **Silent failure:** S1 (failed test shown as pass), M3 (Cursor save confirmation lost on row move), M2 (stale `saved` closes a form).
2. **Unexpected user action:** switching provider after typing a key (S2); Edit on a Copilot instance showing a sign-in panel (M6); creating from the empty row then losing focus (Minor 2).
3. **Wrong answer from data:** a retained earlier test result (S1, M8); hidden key stored under another provider (S2); a wrong Cursor key reported "Set" and Installed (M4).
4. **Dependency failure:** RPC timeout on Test (S1); `cliModels` failure leaves the tier modal loading forever (M5); secret store failing after a rename (M7); the post-save refresh failing leaves `commit` saved with a fixed note (handled).
5. **Missing, not in the requirements:** a Cursor and a new-instance credential check (M4); duplicate-name guard (M9); label-based failure text (Minor 3).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Save only after `isSuccess()` and inner `success`; failure reverts and alerts (D15) | COMPLETE | M2 is the stale-commit variant on four callers |
| No host error text in visible text/toasts | PARTIAL | Test reason is pattern-redacted only (M1) |
| Tier modal sends full object; "Use inherited" removes the key | COMPLETE | M5 (failed load), M9 (manual id) |
| Copilot create disabled until signed in | PARTIAL | Staleness of "signed in" (M6) |
| Edit name/key does not lose the key or rename wrongly | COMPLETE | M7 (partial-write report) |
| Credentials need a passing check | MISSING for Cursor and for new instances | M4 |
| Focus trap and return in modals and popovers | PARTIAL | Modals complete; popovers have no Tab trap; two return-focus gaps (M3, Minor 2) |
| ui changes leave other consumers unchanged | COMPLETE | Modal Tab wrap applies to `provider-catalog-modal` by design |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Toggle while a save runs | YES | `busy()` disables; `feedback.save` refuses with an alert | none |
| Write refused or throws | PARTIAL | Alert from the service | M2: callers read stale commit |
| Undo after a newer save | YES | Newer save replaces the Undo | Minor 4 |
| Undo while another save runs | YES | Kept, alert, button disabled | none |
| Empty replacement key in Edit | YES | Omitted | none |
| Test twice, second fails | NO | Old pass retained | S1 |
| Provider switched after key typed | NO | Key retained | S2 |
| Row moves Uninstalled to Installed mid-popover | NO | Popover re-created | M3 |
| `cliModels` load fails, open Tiers | NO | Permanent loading line | M5 |
| Copilot signed out after earlier sign-in | NO | Stale `signedIn` | M6 |
| Orchestration not loaded, open popover | YES | "Settings are still loading" and disabled fields | none |
| Saved model not in catalogue | YES | Kept listed as "saved, not in the current list" | none |
| Unsupported saved effort | YES | Named in an alert, never offered | none |

## Verdict

- Recommendation: REVISE (NEEDS_REVISION)
- Confidence: HIGH on S1, S2, M1, M2, M5, M6 (read from code and the host); MEDIUM on M3 (derived from template structure, not browser-verified)
- Top risk: S1 reports "Test passed" for a test that failed or timed out.
- What a robust implementation would add: a per-run result for Test (cleared before the call, with an explicit "could not run" for errors and a timeout above the host's); clearing the key on provider change; `feedback.save` returning its own outcome; a matrix-level confirmation for Cursor that survives the row moving groups; a Retry state in the tier modal; deriving "signed in" from the connection; and an honest "stored, not verified" statement for credentials until a host verify RPC exists.

## Re-check (2026-10-02, code-logic-reviewer subagent — same-side, disclosed: the author was an in-process subagent and no CLI lane is available)

Scope: uncommitted Batch 36b diff over the files above, read at the current tree (matrix, add modal, tier modal, model/effort popover, Cursor popover, Copilot toggle, `settings-save-feedback.service.ts`, `providers-settings-state.service.ts`, `native-modal`), plus `providers-commit.service.ts` (field names, refresh order) and `providers-connection-setup.service.ts` (`cli-check`). Scoped Jest run: 5 suites (feedback, add modal, tier modal, matrix, Cursor popover), 119 passed. No browser or Playwright (another agent owns them). Paths are under `libs/frontend/`.

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 failed/timed-out Test shown as pass | FIXED | `core/.../providers-settings-state.service.ts:268-277` clears the store to `unloaded` and `cliTestRunId` before the call, reads with `retainOnError=false` (`readSection` then sets `data:null` on error, `providers-settings-sections.ts:100-105`), RPC timeout 45 s (`:76`) above the host's 30 s. `matrix:576-586` `testResult` returns null while this row runs, else the fresh `lastTest`, else "could not run" only for the last-tested row in `error`. |
| S2 key kept across provider switch | FIXED | `add:276-284` `selectProvider` calls `clearKey()`; `add:304` sends `''` when `showKey()` is false. |
| M1 host text in Test reason | FIXED | `state:78-82` allow-lists the three fixed registry strings (verified at `ptah-cli-registry.ts:480,492,542`); anything else becomes `reason:null`; the line is the fixed `CLI_TEST_FAILED` (`matrix:44,582`). Not addressed, and not a 36b item: the host's success-on-first-SDK-message question stays a spike. |
| M2 stale `commit()` read after save | FIXED for the four named callers | `feedback:75-119` returns `'saved' / 'failed' / 'refused'`; callers branch on it: `add:305-308`, `tier:257,296`, `popover:226,234,238-240`, `matrix:628-634`. `commit()` is read only after `'failed'` (blocked-context refresh, harmless). Other callers outside this review (e.g. `main-agent-reassign-popover.component.ts:378`, `provider-consumer-assignments.component.ts:359`) still read `commit()`; they belong to the other reviews. |
| M3 Cursor confirmation/focus lost on row move | FIXED (focus has a gap, N-2) | `cursor popover:157-161` announces every outcome through `feedback.announce` (toast, no Undo), which survives the popover being re-created. `matrix:505-508` `closeCredentials` refocuses the row's Credentials button after render. |
| M4 credentials stored, not checked | ACCEPTED (Cursor, user decision 2) / FIXED (Add) | Cursor reads "Key stored, not verified." (`cursor popover:128`). Add: `add:319,338` copy plus `created` output, `matrix:475-480` `onCreated` runs the new instance's Test. One gap: N-1. |
| M5 tier modal loads forever | FIXED | `tier:80-86,174-177,260-267`: fixed alert with Retry when `cliModels` is `error` or `ready` without this instance; loading line only while a read runs. |
| M6 stale Copilot "signed in"; panel in Edit | FIXED | `add:224-235` only this open's own `cli-check`/login counts (`signInAction` reset on open and on provider change); choosing Copilot runs `performExternalAuth(...,'cli-check')` (`add:280-283`; the action only reads `auth:getAuthStatus`, `connection-setup:153-164`); Edit shows the panel only while the connection reads `configured === false` and it does not gate Save (`add:240-252`). |
| M7 "Not saved" after rename landed | FIXED | Two `ptahCli:update` operations in one commit (`add:324-340`); `partialEditMessage` (`add:350-355`) matches the real field names (`providers-commit.service.ts:224-231`) and returns fixed copy. A failure shows an alert, never "Saved". |
| M8 last Test outlives its subject | FIXED | `state:281-287` `clearCliTest` drops the result and bumps the generation so an in-flight run is discarded; called from the edit write (`add:327`) and every tier write and its Undo (`tier:289`). Instance model change does not clear it, which is right: the host test uses a fixed model. |
| M9 duplicate names, any manual tier id | FIXED | `add:215-218` case-insensitive duplicate (self excluded), blocks `canSubmit`, `maxlength=80`; `tier:168-171` rejects whitespace and over 200 chars with a fixed alert. The host still has no uniqueness check, so two windows can race; acceptable. |
| Minor 1 unused `hasStoredKey` | FIXED | Removed (`add:12-17`, `matrix:462`). |
| Minor 2 focus after empty-state create | FIXED | `matrix:453-458,475-479`. |
| Minor 3 raw field keys in toasts | FIXED | `feedback:32-34,111-117`: dotted keys filtered, unknown-outcome sentence instead. |
| Minor 4 Undo overwrites `disabledClis` | FIXED | `matrix:612-615` computes this CLI's entry against the list at run time; system rows exist only when orchestration data is loaded, so the `?? []` cannot wipe the list. |
| Minor 5 popover Tab trap, Minor 6 fieldset wrap | ACCEPTED (not changed, noted in the fix report) | No new risk. |
| Extra: V36-1 `native-modal` inert while closed | OK | `native-modal:98-103,138-143`: `inert` lifted before `showModal()`, set after `close()`; `dialog.modal:not([open]){display:none}`. No path leaves an open dialog inert. |

### D15 and host-text checks on the 36b lines

- "Saved" only after the write's own result: `feedback.save` returns `'saved'` only when `write()` resolved `true` and the commit it produced is `saved` (`feedback:96-109`); the `successMessage` copy is used only on that branch, and Undo requests drop the fixed copy (`:105`). The inner `success` flag is checked in the commit service (`providers-commit.service.ts:241-248`).
- No host error text in visible text: the Test reason is allow-listed copy; the add, tier and popover messages are fixed sentences; `announce()` carries only the Cursor popover's own text (fixed lead plus the commit's fixed `message`).
- Failed write reverts and alerts: toggles keep `input.checked = row.enabled` (`matrix:607`); a refused or failed save shows the alert; the Add and tier modals stay open on `'failed'` and `'refused'`.

### New findings (none Blocking or Serious)

- **N-1 (Minor): the Add toast can promise a test that does not run.** `add:319` says "Testing the connection." for any create with a key, but `onCreated` (`matrix:475-477`) returns silently when `cliAgents()` has no entry with that name. That happens if the post-save refresh of `cliAgents` failed (the commit is still `saved` with a refresh note). Fix: word it so it does not promise, or show a fixed "could not start the test" line.
- **N-2 (Minor): focus is lost when a removed Cursor key moves the row into the collapsed Uninstalled group.** `matrix:505-508`: `close()` clears `openState`, so `uninstalledShown()` (`:435-438`) becomes false when the user had not expanded the group, the row leaves the DOM, and `focusAfterRender` finds nothing. Focus falls to `body`. Fix: when the target is absent, focus the group's disclosure button (`cli-matrix-uninstalled-toggle`).
- **N-3 (Minor): the Edit "partial" copy covers only one direction.** If the rename is rejected but the key saved, `partialEditMessage` returns `null` (`add:352`) and the alert says only "Could not save {name} instance." without saying the key was stored. It is an alert, never a false "Saved", so it is acceptable; a sentence "The key was saved. The name was not." would match M7.

No silent failure, stale "Saved", or host-text leak found in the 36b lines. Open items are the three minors above and the pre-existing, out-of-scope spike on the host's first-message success in `testConnection`.

**Verdict: APPROVED WITH NOTES, 8/10.** Both Serious findings and all seven Moderate ones are fixed on disk with matching specs (119/119 green on the five suites I ran); Cursor's unverified key is an accepted user decision. It is not 9 because of the three small gaps above, because other `commit()`-reading callers outside this review remain, and because the rendering-dependent fixes (focus after row move, fold) were not browser-checked here.
