# Gate V 50 code-logic review, Batches 42-44 (+43b, 49b), TASK_2026_555

Reviewer: code-logic-reviewer subagent (cross-side of the antigravity lane)
Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-555-advanced-search-voice` (head e2032e30a)
Scope read in full: `libs/frontend/chat/src/lib/settings/` — `pro-features/{system-prompt-drawer,agent-behaviour-section,mcp-port-config,vscode-lm-config}.component.ts`, `output-style/{output-style-list,output-style-config,output-style-editor,output-style-parity-section}.component.ts`, `output-style/output-style.store.ts`, `advanced-settings.component.ts`, `feedback/settings-save-feedback.service.ts`. Also read: `NativeDrawerComponent`, `LlmProviderStateService.setDefaultModel/setDefaultProvider`, `ClaudeRpcService.call` timeout path, host `enhancedPrompts:download/regenerate`, `agent:setConfig`, `settings:import`, `output-style-file.writer.ts`.
Evidence run: `npx jest -c libs/frontend/chat/jest.config.ts system-prompt-drawer output-style-editor mcp-port-config vscode-lm-config` → 4 suites, 57 tests passed. No builds, no Playwright.

## Verdict

**Score 6/10 — NEEDS_REVISION** (no Blocking; 3 Serious, 6 Moderate, 7 Minor).

D15 itself holds almost everywhere: every write checks `isSuccess()` and the inner `success`/`ok`, failures revert and raise a fixed-text alert, host text is not rendered. The defects are in the flows around the writes: a conflict flow that cannot complete, a confirm and a warning hidden inside a closed `<details>`, and a config card that presents a failed read as real state and then writes over it. Score 6 and not 7-8 because one advertised flow (Replace it on a stale file) is broken and one path can destroy stored config; not 3-4 because no data is lost on the happy path and the ten focus rules are mostly met.

## Findings

### Serious

**1. Editor "Replace it" on a STALE_FILE conflict can never succeed (loops forever).**
- `output-style-editor.component.ts:562-582` and `:584-600`; backend `libs/backend/output-styles/src/lib/output-style-file.writer.ts:200-208` and `:448-483`.
- `persist()` treats `FILE_EXISTS` and `STALE_FILE` identically and offers "Replace it" → `confirmOverwrite()` → `persist(true)`. `buildParams` re-sends the same `expectedMtime`/`expectedByteLength` from the original draft. The host runs `isStale()` before and independently of `params.overwrite`, so the second save returns `STALE_FILE` again and the same dialog reappears.
- Scenario: user opens Edit on a project style, a teammate or git pull changes the file, user presses Save style → dialog; presses "Replace it" → dialog reappears, nothing written, no change in state. The only exit is Cancel, which discards the whole draft (Esc and backdrop do the same).
- Also contradictory copy: the dialog shows the host text "Nothing was written — reload the style and apply your edit again.", under buttons "Replace it" / "Keep both — I'll rename". "Keep both" is also wrong for a stale file.
- The unit spec only covers FILE_EXISTS (`output-style-editor.component.spec.ts:343-359`); STALE_FILE replace is untested.
- Fix: for `STALE_FILE`, either drop the stamps on confirm (omit `expectedMtime`/`expectedByteLength` when `overwrite` is true after a stale conflict) or show a different dialog ("Reload the file" / "Cancel") without Replace. Add a spec for the stale path.

**2. The parity confirm and the parity warning live inside a closed `<details>`; the pending radio looks selected while nothing is saved.**
- `output-style-parity-section.component.ts:54-58` (collapsed `<details>`, no `open`), confirm `:115-150`, warning `:163-189`; list `output-style-list.component.ts:543-551`, `:570-573`.
- Scenario A: user ticks the parity box, collapses the section, then clicks a style radio. `pendingParitySelection` is set, the native radio is already checked on screen, and the confirm is inside the collapsed details. Nothing is written, no prompt is visible, and the radio shows the unsaved style as active. The list never resyncs until Cancel or untick.
- Scenario B: the selection saves but the parity file write fails (read-only or malformed settings file). `saveGeneric` shows the toast "Saved output style." (true for the selection) and the failure sentence is inside the collapsed details. The user explicitly asked for a CLI file write and gets no visible sign it failed.
- Fix: open the `<details>` programmatically when a pending confirm or a parity warning exists (bind `[open]` to `parityEnabled() && (pending !== undefined || warning)`, or keep the confirm outside the details), and call `syncActiveRadios()` when the confirm opens.

**3. MCP & Browser card swallows a failed `agent:getConfig`, shows defaults as real state, and a namespace toggle then overwrites the stored list.**
- `mcp-port-config.component.ts:278-297` (silent `catch`, no `else` for `!isSuccess()`), `:365-411`.
- Scenario: the config read fails or times out. The card shows port 51820, all namespaces enabled, localhost unchecked, with no message. The user unticks "Git Worktree". `updated = [...[], 'git']`, written as `disabledMcpNamespaces: ['git']`, so previously disabled namespaces (for example browser) are silently re-enabled; the toast says "Saved Git Worktree namespace." The same applies to the port field and to Allow localhost, which can show Off while it is On.
- The sibling card handles the same RPC properly (`agent-behaviour-section.component.ts:363-375`, `loadErrors`), so this is also an inconsistency.
- Fix: track a load error, show an alert, and disable the controls (or the writes) until `loadConfig` succeeds.

### Moderate

**4. Stale or wrong error banner from `store.error` (fixed-text mapper guesses the operation by substring).**
- `output-style.store.ts:260` (`save` stores the raw host message), `:304`, `:172`; `output-style-list.component.ts:518-525`; `output-style-config.component.ts:213-222` (`showList` never clears the error).
- The mapper returns the delete sentence if the raw text contains "delete", the copy sentence if it contains "copy", else "Could not change the active output style." That sentence is wrong for: an editor save that fails (WRITE_FAILED, or a FILE_EXISTS/STALE_FILE conflict followed by "Keep both" or Cancel) — the drawer shows its own fixed sentence, but after it closes the list shows a red "Could not change the active output style." for an action the user never took; a Copy to this project whose save fails (host text `could not be written` has neither keyword); an Edit whose `outputStyle:get` fails ("Could not open that output style."); a failed list refresh.
- No host text leaks (D15 held), but the alert misreports the failing action.
- Fix: carry an operation tag in the store (`error = { op, ... }`) instead of substring matching, and clear `error` when the drawer closes.

**5. After a failed MCP port save the Save button is disabled, so the same port cannot be retried.**
- `mcp-port-config.component.ts:81` (`validationError() !== null` disables Save) with `:336` and `:339` (a failed write sets `validationError` to `COULD_NOT_SAVE_PORT`).
- Scenario: transient write failure on port 8080. The alert shows, Save is disabled, and the value is still dirty. The user must edit the number and change it back before Save re-enables. A write failure should not use the validation channel.
- Fix: keep a separate `saveError` signal that does not gate Save.

**6. Clicking the already-active radio rewrites the setting and shows "Saved".**
- `output-style-list.component.ts:543-551` (no `name === activeName` guard) vs the guarded `agent-behaviour-section.component.ts:315`.
- A click on a checked radio still fires `click`. Result: a redundant `outputStyle:activate` with a "Saved output style." toast and Undo; with parity on it also prompts and rewrites the CLI settings file for no change.
- Fix: return early when the selection equals the active one (and parity is not newly requested).

**7. Esc and focus gaps on three inline surfaces; unsaved editor draft is discarded by Esc or backdrop.**
- Regenerate confirm `system-prompt-drawer.component.ts:115-149`; parity confirm `output-style-parity-section.component.ts:115-150`; editor conflict dialog `output-style-editor.component.ts:146-172`.
- None takes focus on open or handles Esc. Inside a drawer, Esc reaches `NativeDrawerComponent.onPanelKeydown` and closes the whole drawer (`native-drawer.component.ts:200-208`) instead of dismissing the confirm. Batch 49b fixed Import, Delete and Allow localhost only; the elevenlabs fix shows these three are the same class of defect.
- The editor closes with Esc or a backdrop click and drops the whole draft (name, description, body) with no confirm. A stray click outside while writing a long body loses it.
- After a successful save the focus return fails: `store.save` calls `refresh()` (`output-style.store.ts:250`), the list table is replaced by the loading block and the opener (Edit button) is disconnected before the drawer is destroyed, so `restoreFocus()` (`native-drawer.component.ts:277-282`) skips it and focus lands on `body`.
- Fix: same pattern as 3a-3c (focus Cancel on open, `(keydown.escape)` with stopPropagation), and a dirty-draft guard on close.

**8. Prompt-mode toggle can say "Saved" while the badge and checkbox show the old value.**
- `agent-behaviour-section.component.ts:378-389`, `:309`.
- The write succeeds, then `loadPromptStatus()` fails (it swallows its own error) but `writePromptMode` still returns `{ ok: true }`. The toast says "Saved system prompt mode." while the checkbox is forced back to the stale status and a load-error banner appears. Contradicting signals; the user cannot tell the saved value.
- Fix: return `ok:false` or an "unconfirmed" message when the re-read fails, or apply the written value locally.

**9. Regenerate: client timeout is not a host stop, and a failed status read shows the "run the wizard" empty state.**
- `system-prompt-drawer.component.ts:353-376`, `:98-199`, `:321-338`.
- On the 120 s client timeout `ClaudeRpcService` resolves a failure (`claude-rpc.service.ts:158-167`), so the spinner clears correctly (finally at `:374`). The host keeps regenerating (no abort signal is passed), the drawer shows "Could not regenerate", the status is not re-read, and a retry starts a second concurrent regeneration. The stale prompt remains on screen until reopen.
- If `getStatus` fails on open, `status` is null, `hasGeneratedPrompt` is false, and the body shows "Run the Setup Wizard…" under the error alert. That points at the wrong remedy for a transient read failure.
- Fix: re-read the status after a timeout failure (or show "may still be running"), and gate the empty state on `status() !== null`.

### Minor

10. `vscode-lm-config.component.ts:169`, `:196`: `selectedModel` is set on selection and never cleared after success, so it masks later changes to the default model made elsewhere while the card stays mounted. `:216-218`: when no default exists, `previousModel` is `''` and the Undo writes an empty model.
11. `advanced-settings.component.ts:235-241`: an empty or malformed import file returns `errors` with nothing imported, but the message is "Some settings could not be imported." (implies partial success). Export failure remains silent (`:187-201`, noted as pre-existing in the user-review list).
12. D14 residue: `apps/ptah-docs/SCREENSHOTS.md:119` still lists `browser-settings.png` for the deleted component, although the shot was removed (`workspace-settings.shot.ts:72`). No code, selector or import reference to `enhanced-prompts-config` or `browser-settings` remains (checked with `git grep`; the only hits are comments, one `toBeNull` assertion and docs).
13. `system-prompt-drawer.component.ts:303-319`: when the drawer is created already open, the `effect` and `ngOnInit` both call `loadStatus()` (two `getStatus` calls). Harmless but duplicated. `:281-285`: an invalid timestamp renders "Invalid Date".
14. `mcp-port-config.component.ts:491-499`: Undo of "Allow localhost off" re-enables localhost without the confirm (an 8 s one-click revert of the user's own action; acceptable but note the asymmetry with the confirm-first rule).
15. `system-prompt-drawer.component.ts:383-404`: a successful download gives no feedback (only cancel and failure are handled), so the user cannot tell whether the file was written.
16. `output-style.store.ts:324-331` (pre-existing): "Copy to this project" saves with `overwrite: true` and no confirm, so it silently replaces an existing project style of the same name.

## Checked and fine

- D15, all writes: `agent-behaviour-section` (`:381`, `:405`), `mcp-port-config` (`:332`, `:384`, `:453`, `:477`), `vscode-lm-config` (via `setDefaultModel`/`setDefaultProvider`, which check `isSuccess() && data?.success`, `llm-provider-state.service.ts:307`, `:347`), output-style `activate`/`save`/`remove` (`output-style.store.ts:211`, `:249`, `:275`). Each requires transport success and the inner flag; failures return `ok:false` and raise an alert toast with a fixed sentence. Store `activate` rolls back to the previous object (`:217`).
- No host error text in visible text or toasts: drawer sentences are constants (`system-prompt-drawer.component.ts:26-29`); MCP and LM messages are exported constants; the list passes errors through the mapper; parity warnings pass only the proven-fixed codes (`output-style.store.ts:65-80`). Residual: the editor conflict dialog shows the backend's typed `FILE_EXISTS`/`STALE_FILE` message (fixed templates with a file name, no host path), and the repair notice shows `broken.error.message` (frontmatter parse text); both are by-design typed messages, not raw exceptions.
- Download cancel = no alert: the string `'Save cancelled by user'` matches the host exactly (`enhanced-prompts-rpc.handlers.ts:631`); `return` inside `try` still runs `finally`; other `success:false` and RPC failures alert.
- Regenerate: confirm first (`:115`, `requestRegenerate`), 120 s timeout is passed (`:361`), `isRegenerating` is cleared in `finally` on success, failure, throw and timeout, so no stuck spinner; no status re-read on failure; footer buttons disabled while running.
- Markdown preview only through `ptah-markdown-block` in both the drawer (`:186`) and the editor (`:343`); no `[innerHTML]`.
- Output-style radios vs store: failure/refusal/cancel resync through `syncActiveRadios` (`output-style-config.component.ts:179`, `list:572`, `:598`); radios are disabled while saving; shadowed rows cannot be chosen; Undo is a real write of the previous name; parity writes confirm first and pass `undo: null` (`config:165`); the parity request is excluded from the rollback decision (`store:211-214`).
- Editor flow otherwise: blank name or description never reaches RPC (`:556`); repair mode saves with overwrite on a file with no draft stamps (no stale check); rename of the active style is handled by the host with the in-form note; `FILE_EXISTS` replace path sends `overwrite:true` (spec `:343-359`).
- D14 deletions: `enhanced-prompts-config` and `browser-settings` have no remaining code, import, selector or e2e reference (see finding 12 for the docs-table line). Reachability selectors for `settings-toggle-browser-allow-localhost` exist in the harness and spec.
- MCP: port validation covers null/empty, non-integer, below 1024 and above 65535 on both input and save (`:299-320`); host also clamps (`agent-rpc.handlers.ts:373-377`); Undo restores `previousPort` and the displayed value (`:343-357`); the restart hint is static and always visible (`:87-89`); Allow localhost is confirm-first with the native checkbox forced back to unchecked (`:420-425`), disabled while confirming or saving, shows the saved value after success or failure, has Esc with stopPropagation and focus return, and has no Undo on enable.
- VS Code LM: `modelChanged` is emitted only inside the success branch of the write and of the Undo (`:206`, `:221`); a failed change resets `selectedModel` to the previous value; `savingModel` is cleared in `finally`; the parent handler is wired (`settings.component.html:162`, `advanced-settings.component.ts:155`).
- Esc and focus for drawers: both drawers use `NativeDrawerComponent` (Esc, backdrop, focus trap, focus restore on `isOpen=false` and on destroy). Delete confirm and Allow-localhost confirm and Import confirm: Cancel focused on open, Esc handled with stopPropagation, focus returns to the opener.
- Timers and disposal: no timers or listeners were added in these components; the toast timer is cleared in `clearTimer` and on `DestroyRef` (`settings-save-feedback.service.ts`); the `effect`s that focus Cancel have no leaks.
- Import outcome (Batch 44 fix): Electron path reads `cancelled` first (no report on cancel), reports from the write's own `errors`, and the transport failure and thrown paths produce a fixed alert (`advanced-settings.component.ts:229-274`); VS Code path reports only an execution failure.

## Five logic questions (condensed)

1. Silent failure: MCP config read failure (finding 3); parity write failure behind the collapsed details with a success toast (2); status re-read failure after a "saved" prompt-mode toggle (8); successful download with no feedback (15).
2. Unexpected user action: Replace it on a stale file (1); clicking the active radio (6); Esc inside a drawer confirm closes the drawer (7); backdrop click drops the editor draft (7).
3. Wrong answer from input data: none found for ports (validated both sides); empty previous VS Code LM model written on Undo (10).
4. Dependency failure: `getConfig` failure (3); `getStatus` failure shown as "run the wizard" (9); regenerate timeout leaving host work running (9).
5. Missing: dirty-draft guard in the editor; operation-tagged errors in the store; focus handling on three inline confirms; a stale-file path in the editor spec.

## What a robust implementation would add

- A stale-aware conflict dialog and spec (finding 1).
- The parity section open whenever it has something to say (finding 2).
- Load-error state plus gated writes for the MCP card (finding 3).
- An operation-tagged store error cleared on drawer close (finding 4).
- A `saveError` signal separate from validation (finding 5).
- A same-selection guard on radios (finding 6).
- The 49b Esc/focus pattern on the remaining three confirms and a dirty-draft guard (finding 7).
