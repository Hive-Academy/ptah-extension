# Batch 28b: compact searchable model picker in the Main Agent popover

The Main Agent popover's model `<select>` is replaced by the compact, one-row searchable model control from the ui
barrel. The Main Agent node now shows the full model value. The "popover search filters models" scene runs.

Results:

- **Full settings folder:** 120 passed and 6 skipped over `--repeat-each=3 --workers=2`. The only `fixme` left is the
  `main-model` deep link (× 2 hosts × 3).
- **Gate G:** 27/27 with `--repeat-each=3`.
- **Build:** no budget error. The initial bundle is +0.29 kB, and the popover is still its own lazy chunk.

Nothing is committed and no baseline image changed.

## Design choice (batches.md :1852-1854: "choose one, and record why")

**I exported `ProviderModelSearchFieldComponent` as the compact control**, rather than adding a `compact` variant to
`ProviderModelPickerComponent`. The reasons:

- **It is already the compact control.** It is the one-row, type-to-filter combobox the picker renders for
  `[searchable]="true"` (Batch 15/15b): `NativeAutocompleteComponent`, the per-instance listbox id and option id prefix,
  the reset-on-reopen active row, and the ARIA combobox pattern. The picker's card chrome (provider row, status, tier
  UI) is exactly what the 19rem popover must not have.
- **Size limit:** `provider-model-picker.component.ts` is 673 lines, so a variant there would cross the 700-line limit.
  The field is now 279 lines.
- **The full picker is unchanged.** `provider-model-picker.component.ts` has no diff, so the drawer Models & Tiers and
  wizard callers render the same output, and all 1191 lines of its spec pass unchanged.

The field gained three **opt-in** inputs. Their defaults keep the picker's output byte-for-byte, which a new spec
asserts:

- `inputId`: an `id` on the combobox, for a host `<label for>` (`provider-model-search-field.component.ts:148`,
  template `:92`).
- `includeDefault` (default `true`): a host that cannot save `''` hides the sentinel row (`:151`). The popover shows
  "Default (chosen by Claude)" only while no model is set, as the old select did.
- `pinnedOption`: an action row that is always last and never filtered (`:154`, used in `suggestions` `:196-217`). The
  popover pins **"Enter a model ID…" (#35)**, so it stays reachable even when the filter matches nothing.

**One behaviour fix in the field (`:268-271`):** while its list is open, **Esc stops propagating**. Esc now closes the
list only; the next Esc reaches the enclosing popover (or drawer) and closes it. Before, one Esc closed both, because
NativePopover and NativeDrawer close on the same key. It is a fix for the drawer's searchable tier pickers too.

**Barrel:** `libs/frontend/ui/src/lib/native/provider-model-picker/index.ts:15-18` exports
`ProviderModelSearchFieldComponent` and the `ProviderModelSearchOption` type. The chat lib imports them from
`@ptah-extension/ui`, with no deep import.

## Changed files

| Change | Path | What |
| --- | --- | --- |
| MODIFIED | `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.ts` (279) | `inputId`, `includeDefault`, `pinnedOption`; Esc stays in an open list; doc: now the exported compact control |
| MODIFIED | `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.spec.ts` | 5 specs, described below |
| MODIFIED | `libs/frontend/ui/src/lib/native/provider-model-picker/index.ts` | Barrel export |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts` (438) | The field replaces the `<select>` (template `:124-130`), described below |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts` | Specs moved to the combobox, described below |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts` (289) + spec | Full model and provider values: `break-words`, no `truncate` or `title` (`:138-146`) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts` | The popover-catalogue spec opens the combobox and reads `[role="option"]`; `scrollIntoView` stub |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-drawer.reach.ts` | `mainAgentModelInput`, `chooseMainAgentModel` (pick a list row by its exact text, optional filter) |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-providers.e2e.spec.ts` | Scenes, described below |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` | #35 reaches "Enter a model ID…" through the list (699 counted lines, no warning) |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-routing-map.entries.ts` | RM-1 checks the model combobox |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts` | The model-list state, described below |

That is 13 source paths across 3 libs, over the cap as batches.md :1863-1864 accepts. `provider-model-picker.component.ts`
and the wizard are unchanged. The 48 tracked `current-*.png` in the diff are the refreshed captures (they were tracked by
the Batch 28 commit); nothing is staged.

Details for the longer rows:

- **ui field spec (5 new):**
  - the defaults keep the picker output (sentinel first, no id, no pinned row);
  - `inputId`;
  - `includeDefault=false`;
  - a pinned row stays last when the filter matches nothing, and emits its id on ArrowDown/Enter;
  - Esc closes the open list without reaching a parent; a closed field lets Esc through.
- **Popover component changes:**
  - Options come from `searchOptions` (`:289`), which is `modelOptions` unchanged. The "[Tool: Yes|No]" marker is in
    every label, and "· not in current catalog" is kept. The field's own "Tool use" badge is off, so it is not shown
    twice.
  - `manualOption` "Enter a model ID…" is pinned last (`:186`).
  - The disabled rule is unchanged: busy, **M1 `!targetReady()`**, no driver, or catalogue loading ("Loading models…"
    label).
  - `closeManual` returns focus to the combobox.
- **Popover spec:**
  - The field is the model control, with `id` and `<label for>`.
  - Options with markers, the pinned manual row, and no default row while a model is set.
  - **Typing filters; Home / ArrowDown / ArrowUp move `aria-activedescendant`; Enter saves** (`config` write through
    `saveSettings`).
  - **The first Esc closes only the list; the second closes the popover.**
  - Not-in-catalog kept; #35 manual flow and focus return; M1 disabled checks on the combobox input.
  - A `scrollIntoView` stub for jsdom, as in the ui spec.
- **Providers scenes:**
  - The model-save scene picks "Kimi K2.5 [Tool: Yes]" and then "Kimi Lite [Tool: No]" through the list. The toast
    and Undo send a 2nd `config:model-switch`.
  - **"popover model search filters the models" is un-`fixme`d:**
    - it checks the combobox role and accessible name "Main agent model";
    - the full list is the default, 3 models with markers, then "Enter a model ID…";
    - "lite" leaves 1 model plus the pinned row, and "no-such-model" leaves only the pinned row;
    - Esc closes the list and not the popover;
    - Home and `aria-activedescendant`, then Enter, save "kimi-k2.7-code";
    - re-focus, then Esc closes the list and a second Esc closes the popover.
- **Visual spec, list state:**
  - The list is open and filtered ("kimi", 4 rows). **The list and the popover are both inside the viewport**, and the
    list is **on top** at every row (`assertPopoverOnTop` on the listbox).
  - It writes the capture `main-agent-model-search`.
  - Esc closes the list only.
  - **The manual-ID state is inside the viewport.**
  - The model row shows the full value (no overflow, the label on the value's first line, text
    "Default (chosen by Claude)").

## Quality requirements → evidence

| Requirement (batches.md :1869-1883) | Result | Evidence |
| --- | --- | --- |
| **Filters as you type** | Case-insensitive name and id match | ui field specs; popover spec; Providers scene (both hosts, ×3) |
| **Full keyboard support** | Arrows, Home/End, Enter; Esc closes the list first, then the popover | Popover spec; Providers scene; ui spec (Esc) |
| **Accessible name** | "Main agent model", plus `<label for="main-agent-model">` | Popover spec; Providers scene (`toHaveAccessibleName`) |
| **ARIA pattern** | Batch 15/15b: `role="combobox"`, `aria-controls`, `aria-activedescendant`, per-instance ids, reset on reopen | Unchanged field and autocomplete; existing specs green |
| **Keep "Enter a model ID…" (#35)** | Pinned last row, never filtered out | Gate G #35; popover #35 spec |
| **Keep the "[Tool: Yes\|No]" marker on every option** | In every label | Popover spec; Providers scene |
| **Keep "· not in current catalog"** | Still listed and selected | Popover spec |
| **Save on selection with toast and Undo (D2)** | Unchanged | Popover spec; Providers scene (2nd `config:model-switch`) |
| **M1 gating** | Combobox disabled until a Save-to target exists | Popover M1 specs (on the combobox input) |
| **Existing picker callers unchanged** | `provider-model-picker.component.ts` has no diff; its spec passes unchanged | ui 615/615 |
| **Main Agent node shows the full model value** | VS Code: "Default (chosen by / Claude)" on **2 lines**, beside "MODEL:"; Electron: 1 line. No truncation or overflow. | Visual `B28b routing-main-model-row`: vscode 2 lines, electron 1, overflow 0 in all four |
| **VS Code fold kept** | Card 5 ends at **590 px** (574 in the 28 revise), ≤ 660 | `B28 fold`: map 354, heading 398, card5 590 |
| **Electron per-host budget kept** | Tabs 123, map 503, heading 547 | `B28 fold`, unchanged |
| **Popover fully inside the viewport in every state** | Default, confirm and open list checked in all four runs; the manual field too | Visual spec, described below |
| **An open list is never clipped by the popover's scroll box** | The list is `position: fixed` (`floating-ui.service.ts:157-163`), outside the body's `overflow-y-auto` | `assertPopoverOnTop` on the listbox rows |

Popover positions per state:

- **Default:** 304×284/286 at (111,364) in VS Code and (305,378) in Electron.
- **Confirm:** 304×396 (VS Code) and 304×382 (Electron).
- **Open list:** the popover is unchanged, and the list is 210×154 at (123-124, 535-536) in VS Code and (317-318,
  549-550) in Electron.
- **Loading, error and outcome states:** not captured separately. They add rows to the same body and are covered by the
  Batch 28 `fitToViewport`, which re-fits on each of these state changes (`afterRenderEffect`).

## Verification

1. **Batch 17 command.** `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 (`%TEMP%\b28b-verify.log`).

   | Project | Tests | Change |
   | --- | --- | --- |
   | ui | **615/615** | +5 |
   | chat | **1997 passed + 2 skipped** | +2 net |
   | core | 1085 | 0 |
   | webview | 224 | 0 |

   Lint: 0 errors; warnings chat 30 / harness 41 / core 11, all unchanged.

   Before that full run, a targeted run had 4 red specs, diagnosed and fixed (test-only):
   - jsdom lacks `Element.scrollIntoView`, which the list calls for its active row. I added the ui spec's stub to the
     two chat specs.
   - After filtering, the active row carried over, so ArrowDown landed on the pinned row. The spec now uses Home and
     asserts `aria-activedescendant` at each step.
2. **Build.** `npx nx build ptah-extension-webview --skip-nx-cache` exited 0 with **no budget error** (`%TEMP%\b28b-build.log`).
   - Initial total: **before 975.78 kB, after 976.07 kB** over the 2.5 MB warning budget (3.48 MB), so **+0.29 kB
     eager**.
   - `main-agent-reassign-popover-component` is still its **own lazy chunk** at 18.07 kB (was 18.11 kB).
3. **Gate G.** `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed (2.1m)**, exit 0,
   both hosts (`%TEMP%\b28b-gateG.log`).
4. **Full settings folder: one diagnosed failure, then all green.**
   - **First run** (`--workers=2`): 39 passed, 2 skipped, **1 failed**. The failure was `reachability (vscode)` at
     **RUX-10**: `locator('[data-testid="connection-credentials"]') … element(s) not found` after 5 s
     (`%TEMP%\b28b-folder.log`).
   - It was the only failing entry. RUX-10 opens and closes three drawer Credentials tabs, and this batch did not touch
     it. It had just passed in all three Gate G repeats on the same build, and the Electron run of the same spec passed.
   - **Suspected cause:** drawer tab render timing under two-worker load.
   - **Re-run per execution default 7:** the whole folder with `--repeat-each=3 --workers=2` gave **120 passed, 6
     skipped, 0 failed (7.4m)**, exit 0 (`%TEMP%\b28b-folder3.log`). The only skips are the `main-model` deep-link
     `fixme` (× 2 hosts × 3). No crash and no 0xC0000409.
5. **Baselines.** `git status --short -- .ptah/specs/TASK_2026_555/screenshots/angular/ | grep -c baseline` gives **0**.

## Captures

All are `current-*` files in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`.

- **New:** `current-main-agent-model-search-vscode-anubis-1024x768.png`, `current-main-agent-model-search-vscode-anubis-light-1024x768.png`,
  `current-main-agent-model-search-electron-anubis-1024x768.png`, `current-main-agent-model-search-electron-anubis-light-1024x768.png`.
  Each shows the popover with the list open and filtered to "kimi": "Kimi K2.5 [Tool: Yes]" is active, then
  "Kimi K2.7 Code [Tool: Yes]", "Kimi Lite [Tool: No]", and "Enter a model ID…" last.
- **Refreshed:** `current-{providers,orchestration,main-agent-popover,main-agent-save-to,scope-popover,provider-catalog,drawer-*}-{vscode,electron}-{anubis,anubis-light}-1024x768.png`.
  `current-providers-vscode-*` shows "MODEL: Default (chosen by / Claude)" in full on two lines.

## Deviations and notes

1. **Compact control = the exported search field, not a picker variant.** The reasons are in the "Design choice"
   section. The field's new inputs are opt-in, and the picker is unchanged.
2. **"Enter a model ID…" is a pinned list row,** not a select option. It is always last, and stays visible even when the
   filter matches no model.
3. **The Esc behaviour change is in the shared field.** It stops an open list's Esc from also closing an enclosing
   popover or drawer. This also applies to the drawer's searchable tier pickers, where one Esc used to close both the
   list and the drawer.
4. **The list is narrower than the field** (210 px against a ~280 px field). It sizes to its content (the autocomplete
   panel's own rule). It is on screen and on top in every run. Matching the field width would be a change to
   `NativeAutocompleteComponent`; I did not make it and leave it to the visual review.
5. **Returning from the manual field opens the list.** Focus returns to the combobox, and focus opens the list (the
   field's existing rule, shared with the drawer). One Esc closes it.
6. **Main Agent node:** the model and provider values wrap (`break-words`) and are never truncated. The `title`
   fallback added at Gate V 28 is removed, because the value is now always shown whole. In VS Code the model row is 2
   lines, and the fold still holds.
7. **The remaining `fixme`:** the `main-model` deep link (no in-app trigger inside the settings harness; covered by unit
   specs), unchanged.
