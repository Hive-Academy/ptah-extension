# Batch 50b, stream A (Advanced side): Gate V 50 fixes, TASK_2026_555

Author: in-process frontend-developer. Worktree `task-555-advanced-search-voice`, head e2032e30a, uncommitted.
Sources: `gate-v50-code-logic-review-42-44.md` (R), `gate-v50-code-logic-review-lanes.md` (L), `visual-review-gate-v50.md` (V),
plus the Gate V 50 user decision on Agent behaviour row wrapping (V M1).

Paths below are relative to `libs/frontend/chat/src/lib/settings/`. Line numbers are in the working tree after this batch.

## Findings → fixes → specs

| Finding | Fix (file:line) | Spec |
| --- | --- | --- |
| R Serious 1: stale-file "Replace it" loop | On `STALE_FILE` the editor re-reads the file (`output-style/output-style-editor.component.ts:740` `readCurrentFile`) and shows its own prompt (`:190`): copy and buttons agree ("Reload" / "Overwrite" / "Cancel"). Overwrite sends the file's current mtime and length with `overwrite` (`:704`, stamp chosen in `buildParams`); Reload asks "Discard your edits and load the current file?" before the form takes the fresh file (`reloaded` linked signal). A failed re-read says so and offers only Close. FILE_EXISTS keeps "Replace it" / "Keep both". | `output-style-editor.component.spec.ts` › "stale file conflict (Serious 1)" (4 tests) |
| R Serious 2A: parity confirm hidden in a closed `<details>` | The section opens itself when a confirm is pending or a warning arrives (`output-style/output-style-parity-section.component.ts:228`); collapsing it with a confirm pending cancels it and the radios go back to the saved style (`:237`, list `output-style/output-style-list.component.ts:596`). | `output-style-list.component.spec.ts` › "parity section visibility and dismissal" |
| R Serious 2B: parity write failed, toast only "Saved" | A selection saved with a failed parity write returns the fixed sentence "Your style is active in Ptah, but the settings file for the command line could not be updated." as an alert toast (`output-style/output-style-config.component.ts:39`, `:169`); the warning panel opens too (above). | `output-style-config.component.spec.ts` (new) › "parity outcome in the toast" |
| R Serious 3: MCP card writes defaults over the stored list | `loadState` (`pro-features/mcp-port-config.component.ts:247`); `loadConfig` sets `failed` on RPC failure, missing data or throw (`:305`); fixed alert "Could not load the MCP and browser settings." with Retry (`:67`); port, Save, namespaces and Allow localhost are disabled until loaded, and every write entry point returns early when not loaded. | `mcp-port-config.component.spec.ts` › 4 "Serious 3" tests + "keeps the controls disabled until the read answers" |
| R Moderate 4: banner guesses the operation from words | Store `error: string` replaced by `failedOperation` (`output-style/output-style.store.ts:80` type, all writers tag their op; copy is tagged `copy` through `writeFile` `:364`); list maps the tag to a fixed sentence (`output-style/output-style-list.component.ts:100`); returning from the editor clears `save`/`open` only (`output-style-config.component.ts:236`, store `dismissError(only)` `:326`). | store spec › "failure tagging (Moderate 4)"; list spec › 6 `it.each` cases; config spec › "clears only the editor session failures" |
| R Moderate 5: failed port save blocks retry | `saveError` signal separate from validation (`pro-features/mcp-port-config.component.ts:256`), shown in the same alert line, cleared on input; Save is not gated by it. | mcp spec › "Moderate 5: a failed save leaves Save enabled…" |
| R Moderate 6: active radio rewrites | Early return when the clicked style is active (`output-style/output-style-list.component.ts:565`). With parity ticked it still asks once if that tier was never written by a selection (or the last parity write failed), then does nothing. | list spec › "same-selection guard (Moderate 6)" (2 tests) |
| R Moderate 7a: regenerate confirm focus / Esc | Cancel focused on open, Esc handled on the group with `stopPropagation`, focus returns to Regenerate (`pro-features/system-prompt-drawer.component.ts:421`). | drawer spec › "takes focus on Cancel; Esc closes only the confirm…" |
| R Moderate 7b: parity confirm focus / Esc | Cancel focused on open, Esc local with `stopPropagation` (`output-style-parity-section.component.ts:245`), focus moves to the saved style's radio. | list spec › "Esc on the confirm cancels it, stops there and focuses the saved radio" |
| R Moderate 7c: conflict dialog focus / Esc | Each inline dialog marks its safe choice `#safeChoice`; one effect focuses it (`output-style-editor.component.ts:627`); Esc closes the prompt only. | editor spec › "the replace prompt takes focus…" |
| R Moderate 7d: Esc / backdrop drop a dirty draft | `dirty` (`output-style-editor.component.ts:574`); drawer `closed`, the close button and Cancel go through `requestClose` (`:635`), which shows "Discard your changes to this style?" (Discard changes / Keep editing, Esc = keep editing). | editor spec › "dirty draft guard (Moderate 7)" (2 tests) |
| R Moderate 7e: focus lost after save | Editor emits the saved name; the config focuses that row's Edit button after render, else "New style" (`output-style-config.component.ts:228`). | config spec › 2 focus tests |
| R Moderate 8 + L FM-3: "Saved" next to a stale checkbox | `loadPromptStatus` returns a boolean; when the re-read after a successful write fails, the written value is applied locally and the fixed load error stays (`pro-features/agent-behaviour-section.component.ts:417`). | agent-behaviour spec › "Moderate 8 / FM-3…" |
| R Moderate 9 + L Serious 1: status `error` shown as "run the wizard" | Both readers treat `result.data.error` as a load failure (`agent-behaviour-section.component.ts:383`, `system-prompt-drawer.component.ts:392`) with Retry (`agent-behaviour…:111`, drawer `:108`). The drawer's empty state needs a successful read (`:245`); the card note says "The system prompt status is not loaded yet." until one succeeds (`:301`). | agent-behaviour spec › "lane Serious 1…"; drawer spec › "a host-reported status error…", "a failed transport read also hides the empty state" |
| R Moderate 9: regenerate timeout | An unanswered regenerate (transport failure, timeout, throw) re-reads the status, shows the fixed note "The regeneration did not answer in time and may still be running…" with Check again, and blocks Regenerate (`system-prompt-drawer.component.ts:433`, `:474`). The block lifts when a newer `generatedAt` appears (emits `changed`) or when a check comes ≥ 240 s after the start (then the fixed failure sentence). A host `{success:false}` is unchanged (no re-read). No timers. | drawer spec › "unanswered regenerate" (3 tests) |
| R Minor 10a: `selectedModel` never cleared | Cleared in `finally` (`pro-features/vscode-lm-config.component.ts:236`); the select element is put back on the saved model after the write (`:188`). | LM spec › 2 "Minor 10" tests |
| R Minor 10b: Undo writes an empty model | No Undo when there was no previous model (`:220`); see deviation 3. | LM spec › "with no previous model there is no Undo…" |
| R Minor 11: empty / malformed import file | Errors with nothing imported → "The file is not a Ptah settings export." (`advanced-settings.component.ts:240`); partial imports keep "Some settings could not be imported." | advanced spec › "Minor 11…" (partial case test updated to `imported: ['config:a']`) |
| R Minor 13: duplicate `getStatus`; "Invalid Date" | `ngOnInit` removed, the open effect is the only load (`system-prompt-drawer.component.ts:376`); unparseable timestamps are omitted (`:355`). | drawer spec › "reads the status once…", "omits an unparseable timestamp…" |
| R Minor 15: no feedback after download | "Saved to the chosen file." `role="status"` only on host `success:true` (`system-prompt-drawer.component.ts:508`). | drawer spec › "shows a saved line only after…" |
| V D1: coloured 10 px text in the editor | Name and description errors: `text-xs text-base-content` + `text-error` icon (`output-style-editor.component.ts:257`, `:297`); coding-instructions OFF warning: `text-xs text-base-content` + `text-warning` icon (`:373`). Description error now has an id and `aria-describedby`. | editor spec › "deviation 6 text colour (D1)" (2 tests) |
| V D2: "Active for all sessions" 2.8–3.1:1 | `opacity-70` removed; `text-base-content-muted` alone (`agent-behaviour-section.component.ts:153`), the token `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts` holds at ≥ 4.5:1 on base-100 in both anubis themes. | agent-behaviour spec › "D2…" |
| V D5: delete confirm shape and placement | Own `<tr><td colspan="5">` under the style row (`output-style-list.component.ts:362`), `rounded border border-base-300 p-2` panel, `btn btn-outline btn-xs border-error text-base-content` Delete, ghost Cancel; no red-tinted panel. Focus/Esc behaviour unchanged. | list spec › "renders the delete confirm in its own full-width row…" |
| V M4: built-in note on every row | Built-in badge `title` (`output-style-list.component.ts:293`) + one footnote under the table (`:404`); plugin rows keep their own note (it names the plugin); disabled Edit/Delete titles still explain. | list spec › "states the built-in note once…" |
| V M5: import confirm pushes the badges down | The confirm replaces Export / Import inside the header action row (`advanced-settings.component.ts:60`), so nothing is inserted above the badges; focus returns to Import after the import finishes (`:280`). See deviation 1. | advanced spec › "M5…", "returns focus to Import once the confirmed import finishes"; Batch 49b Esc test updated (the trigger is re-created) |
| V m3: Allow localhost confirm colour | `border-warning` → `border-error` (`pro-features/mcp-port-config.component.ts:203`); the parity confirm button moved from solid `btn-warning` to the same outline (`output-style-parity-section.component.ts:144`). | mcp spec › "m3…"; list spec › "uses the outline confirm button…" |
| V M1 (user decision): no Agent behaviour row may wrap | Every row note is one `truncate` line in a `max-w-0 w-full` cell with the full text as `title`; the text stays in the DOM, and each checkbox / effort trigger points `aria-describedby` at its note (`agent-behaviour-section.component.ts:55` constants, `:242` Ultracode). Status cells are `whitespace-nowrap`. The Ultracode note is plain text now (the `<code>` styling is gone, the wording is unchanged). | agent-behaviour spec › "M1: one-line row descriptions" |

## Counts

- Findings fixed: 3 Serious (R) + 1 Serious (L) + 6 Moderate (R 4-9; L FM-3 folded into 8) + 4 Minor (R 10, 11, 13, 15) + 7 visual (D1, D2, D5, M4, M5, m3, M1) = 21.
- Files: 10 source + 9 spec (1 new: `output-style/output-style-config.component.spec.ts`).
- Tests: 205 in the 9 owned suites, all passing (148 in 8 suites before; net +57, existing tests that read `store.error` / `validationError` / the old import copy were updated to the new API).

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2 output-style system-prompt-drawer agent-behaviour-section mcp-port-config vscode-lm-config advanced-settings.component` → 9 suites passed, 205 tests passed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2 --skip-nx-cache` → "Successfully ran targets typecheck, lint".
- `npx eslint` over every owned source and spec file → 0 problems (the editor first hit `max-lines` 718; the new dialog markup was compacted, no extraction).
- Not run (team leader): builds, Playwright. The harness fixtures answer `agent:getConfig` and `enhancedPrompts:getStatus`, so the MCP and drawer gates should not block the scenes; the Esc scene opener for Import re-resolves `getByRole('button', { name: 'Import settings' })` after close.

## Deviations

1. **M5 placement.** The `membership-notices` slot sits above the badges inside `license/license-status-card.component.ts` (not my file). Instead of moving the slot, the confirm renders in the `membership-actions` row in place of Export / Import, with a short visible question ("Replace your settings from a file?") and the full warning as an sr-only `aria-describedby`. Card height is stable unless the header action row wraps at a narrow width; needs the visual re-check.
2. **Serious 2B toast tone.** A failed parity write is an alert toast with the existing fixed parity sentence, although the selection itself saved and is not reverted (§4.1). This is the only way to avoid a bare "Saved" without changing `SettingsSaveFeedbackService` (not mine).
3. **Minor 10b.** There is no RPC to clear the VS Code LM default (`llm:setDefaultModel` stores `model ?? ''`), so "restore no default" cannot be written honestly; Undo is not offered when there was no previous model.
4. **Moderate 6 with parity.** The active radio still asks once when parity is ticked and its file was never written for the chosen tier (the review's "parity newly requested" case); otherwise it does nothing.
5. **Moderate 7d scope.** The discard prompt also guards the drawer's close button and the footer Cancel, not only Esc and backdrop.
6. **API changes inside the section.** `OutputStyleStore.error` (string) → `failedOperation` (tag); the editor's `saved` output now carries the saved name. Only `output-style-config` consumed either; no other references exist.

## Out of scope, not touched

- R 12 (docs table line), R 14 (Undo of "Allow localhost off" skips the confirm), R 16 ("Copy to this project" overwrites without a confirm) — not in this batch's list.
- V D3, D4, M2, M3, m1 and L FM-2, FM-4, FM-5 belong to the other developer's files (license, web search, ElevenLabs, go vet). V D6 (shared muted token, 4.45:1 table headers) and M6 (512 vs 460 px drawer) are user decisions.
- The parity warning body text is still `text-[11px]` / `text-[10px]` base-content (not coloured, not in D1); raise it to 12 px if the 12 px minimum is meant for all helper text.

## Follow-up (coordinator, 2026-10-02): 12 px helper text

Deviations 1-5 were accepted for the Gate V 50 re-check.

| Item | Fix | Spec |
| --- | --- | --- |
| Parity warning body | `text-[11px]` → `text-xs text-base-content`; its sub-line `text-[10px]` → `text-xs` (`output-style/output-style-parity-section.component.ts:186-187`) | list spec › "reports a parity failure as a warning…" now also asserts no `text-[10px]` / `text-[11px]` anywhere in the list + parity section, and `text-xs text-base-content` on the warning body |
| All other 10-11 px helper text and labels | Every `text-[10px]` / `text-[11px]` → `text-xs` in `output-style/*.component.ts` (editor hints, field labels, tier explanations, rebind / save notes; list shadow / plugin notes, built-in footnote, invalid-file block, footer note; config "N available"; parity labels and hints), `system-prompt-drawer` (progress line), `agent-behaviour-section` (the four row notes, "Reasoning effort" popover heading, "Pins X-High while on"), `mcp-port-config` (restart hint) | agent-behaviour spec › "M1: one-line row descriptions" also asserts `text-xs` on each note |
| Agent behaviour rows stay one line | Unchanged mechanism: the notes are still `truncate` in `max-w-0 w-full` cells with the full text as `title`; the status cells are `whitespace-nowrap` | same M1 spec |

Kept as is: the effort popover's six choice buttons (`btn btn-xs text-[10px]` in a fixed 3-column grid in a `w-56` popover; button labels, not helper text). Secondary helper lines keep `text-base-content-muted` (the base-content secondary tier, ≥ 4.5:1 per `base-content-muted.spec.ts`); none use a status colour.

Verification:
- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2 output-style system-prompt-drawer agent-behaviour-section mcp-port-config` → 7 suites, 177 tests passed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2 --skip-nx-cache` → succeeded; `npx eslint` on `output-style/` and `pro-features/` → 0 problems.
- Visual re-check needed: at 12 px the Agent behaviour notes truncate earlier, and the MCP restart hint (`whitespace-nowrap`) may wrap onto its own line in the flex-wrap policy bar.
