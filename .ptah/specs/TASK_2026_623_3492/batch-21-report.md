# Batch 21 report: C6 display panel and turn summary cards

Executor: frontend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. No git
commands were run.

## Tasks

### Task 21.1: display panel component, COMPLETE

`ptah-display-panel` (`DisplayPanelComponent`) is the presentational body of the Displays tabpanel. Its inputs come from the
dock store: `surfaces`, `summary`, `selectedKey`, `pinned`, `viewStates` (a `ReadonlyMap<surfaceKey, SurfaceViewState>`)
and `actionError`. Its outputs are `selectedKeyChange`, `viewStateChange({surfaceKey, viewState})`, `openFile(path)` and
`review()`. It also exports `DISPLAY_PANEL_SUMMARY_KEY = 'summary'` and `DisplayPanelViewStateChange`.

- **R1.13 strip and body.** The strip is a `role="tablist"` (`aria-label="Displays"`). The summary pill comes first,
  then the surfaces in the published order (decision #79). Pills are 28 px tall and at most 180 px wide, with an
  ellipsis and the full title in `title`. Untitled surfaces read "Display".
- **R1.13 tabpanels.** Each pill has a `role="tabpanel"` with `aria-labelledby` and `tabindex=0`. Only the selected
  tabpanel is shown; the others are `hidden`.
- **R1.13 summary panel.** It hosts `ptah-turn-summary`.
- **R1.13 surface panels.** Each one hosts `ptah-surface-renderer` with `layoutWidth="container"` and the read-only
  interaction (R2.12).
- **Design section 8, assertions 6-9.** Exactly one tab is selected, with a roving tabindex. Arrows wrap and Home/End
  jump. Activation is automatic and focus follows the newly selected tab. A changed surface's pill shows a visually
  hidden "New: " prefix and an `aria-hidden` gold dot. The dot pulses twice using transform and opacity only, and only
  under `prefers-reduced-motion: no-preference`.
- **Decision #79 (R1.6), unpinned.** The target is the surface with the highest `updatedSeq`, not the last one in
  order. The panel selects it, emits `selectedKeyChange`, and after the next render scrolls its pill into view
  (`block/inline: 'nearest'`) and resets the body scroll to the top.
- **Decision #79 (R1.6), pinned.** Selection, scroll and focus do not change; only the dot appears.
- **First read.** Surfaces already present at mount do not count as new and do not move anything.
- **R1.7.** No code path moves focus on an update.
- **Decision #74, view state.** `viewState` is bound to `viewStates.get(key)`. When there is no entry, the panel uses
  one frozen empty object, so the renderer does not reset on every change detection. `viewStateChange` is forwarded
  keyed by surface. The panel never prunes view state.
- **Failure behaviour.** `renderFailed` shows "Could not display this surface." in that surface's tabpanel only. The
  failure is keyed by `fenceKey`, so a newer version renders again.
- **Empty state.** It shows an icon, "Nothing to show yet" and one sentence.
- **Cost.** The panel uses no timer, observer or poll. It uses two effects: one for the newest-surface rule and one
  for the seen map.

### Task 21.2: turn summary cards, COMPLETE

`ptah-turn-summary` (`TurnSummaryComponent`) builds from `buildTurnSummaryModel` and renders `model.cards` in order. It
adds no omission logic of its own (decision #66).

- **Hero gradient (#13).** The host-built section has the hero gradient: `secondary` at 12% into the card colour at
  135 deg. The card colour is `base-200` in dark and `base-100` in light.
- **Section head.** The head shows a `Host` pill with a pin icon and an "incomplete" warning pill. The section is a
  collapsible `section`, open by default.
- **Grid (R9.6).** The host is an `inline-size` container (`ts`). The grid has 1 column below 400 px, 2 from 400 px
  and 3 from 700 px. An expanded card spans the row, and at 700 px or wider it splits 38% / detail.
- **Cards (R9).** Every card is a `<button aria-expanded aria-controls>` toggle and is collapsed by default. The
  collapsed region is `inert` and `visibility:hidden`. Escape collapses the card and refocuses its toggle; Escape at
  section level collapses the section.
- **Forced open.** A conflict forces Files open until the user toggles it.
- **Counts unavailable (#69).** Files and Lines read "?" with a neutral "counts unavailable" pill. Cost keeps the word
  "unavailable" (with a neutral "not reported" pill). A real 0 cost stays a number.
- **Tests (#51).** The run-row `tone` maps to the tests-row classes (`diff-add-text`, `diff-del-text`, `text-info`,
  muted). `tests.polarity` is surfaced as `data-polarity` on the Tests card, which draws the error-tinted border.
- **Files detail (parity section 2).** Rows show:
  - the status badge (`ptah-file-status-badge`, which has an accessible name; `U` when conflicted);
  - the directory muted and the file name bold, with the full path in `title`;
  - "renamed from …";
  - the counts from `formatFileCounts` (`?`, `binary`, or `+0 −0` only when both are 0);
  - a Review/Resolve action whose accessible name includes the file name.

  The footer has Review all, 50 rows per page with "Show more", and "+N more files not listed". Reconciled files go
  in a native `<details>` "No longer changes HEAD (n)". There are also the baseline-missing note and the
  counts-unavailable sentence.
- **Action error (R6.8).** `actionError` renders as `role="alert"` inside the Files card but outside its collapsible
  region, so it is never hidden.
- **Tests detail (parity section 1).** It shows a passed-share `progress` with a text percentage. Each run row has an
  outcome icon with an accessible name, the run label (project or outcome), an "Outcome · project" line, the failure
  lines, and a `<details>` "Full command".

### Task 21.3: summary chip back to flat `base-200`, COMPLETE

- **What changed.** The `.ts-hero` `linear-gradient` rule and its doc comment are removed from
  `turn-summary-chip.component.ts`. The chip `<section>` now has the class `bg-base-200`. Nothing else changed.
- **Spec.** The chip spec had no gradient assertion. I added the case "is flat base-200 with no hero gradient": the
  class is present, and the source has no `linear-gradient` and no `ts-hero`.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-panel.component.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-panel.component.spec.ts` (18 tests)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary.component.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary.component.spec.ts` (26 tests)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary-files.component.ts` (deviation 1)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\turn-summary-tests.component.ts` (deviation 1)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.spec.ts`

`src/index.ts`, `src/display-panel.ts`, `batches.md`, `decisions.md` and `task.md` are untouched.

## Verification (Batch 21 verification line, worktree, command-line `--moduleNameMapper` for `^vscode$` / `^marked$`)

- **Jest.** `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/display-panel
  libs/frontend/chat-ui/src/lib/molecules/turn-recap --coverage=false --maxWorkers=2 --moduleNameMapper=...`
  - Result: Test Suites 7 passed, 7 total. Tests 147 passed, 147 total.
  - Suites: panel, summary, sync, surfaces, chip, model and tests-row.
- **Typecheck.** `npx nx typecheck @ptah-extension/chat-ui --parallel=1` succeeded.
- **Lint.** `npx nx lint @ptah-extension/chat-ui --parallel=1` reported 0 errors and 10 warnings. That is the same
  baseline count as Batches 19 and 20, and none of the warnings is in a batch file.
- **Diagnostics.** `ptah_get_diagnostics` on the three spec files reported 0 errors in the requested files. The sibling
  errors it listed are in files this batch did not touch: `streaming-quotes.component.spec.ts`,
  `compact-session-activity.component.spec.ts`, core `mock-rpc-service.ts` and shared `capability-id-codec.ts`.
- **Marker grep.** No TODO, FIXME or placeholder markers, and no `setTimeout`, `setInterval` or `*Observer(` in the
  batch files.

## Risks and edge cases handled

- **Agents-tab empty state (decision #11).** It is not in this panel: the Agents tabpanel belongs to the dock (Task
  25.1). The Displays empty state "Nothing to show yet" is covered (R1.13 spec, plus axe on the empty state).
- **Grid at 300 px is one column (R3.5 / R9.6).** The summary grid is 1 column below 400 px under a container query,
  not a viewport query. The spec pins the 1/2/3 rules and the full-row span. jsdom cannot evaluate `@container`, so real
  widths are left for V1 (Batch 33).
- **Aborted turn "(incomplete)".**
  - The section head shows an "incomplete" warning pill.
  - A `role="note"` sentence follows it.
  - The Tests card gets an "incomplete" pill.
  - The Tests sr text carries the model's "(incomplete)" label.
  - Spec: "marks an aborted turn 'incomplete'".
- **Cost "unavailable, never $0".** Spec: unavailable reads "unavailable", and a real 0 reads "$0.0000".
- **Eager bundle growth (D14).** The summary, files and tests components import neither the renderer nor
  `declarative-dashboard`; a spec checks this. The panel imports the renderer only inside the lazy `display-panel`
  folder.
- **Parity loss (decisions #5, #10).**
  - Tests-row capabilities ported, with specs: outcome icon names, run label, failure lines, `<details>` command,
    label and unknown cases, incomplete.
  - Change-set card capabilities ported, with specs: status badge name, rename origin, binary / `?` / `+0 −0`,
    conflicted `U` and Resolve, reconciled group, 51-file paging, truncated, baseline missing, counts unavailable,
    actions, inline alert, conflict forces open.
- **Auto-open and focus (R1.6, R1.7).**
  - Pinned spec: no selection change, no scroll call and no focus change.
  - Unpinned spec: focus stays on an outside element while the panel selects and scrolls.
  - Mount spec: no dot and no movement.
- **View state never pruned in the panel (decision #74).** Spec: a write is forwarded with its key, and the stored
  object is passed through by identity.

## Plan deviations (numbered for a ruling)

1. **Two extra files in the batch folder.** `turn-summary-files.component.ts` and `turn-summary-tests.component.ts`
   are not on Task 21.2's file list.
   - After formatting, the single `turn-summary.component.ts` reached 979 lines and tripped the repository
     `max-lines` (700) lint warning. It was the only new warning.
   - I split the Files detail and the Tests detail into presentational children with one responsibility each. The
     parent keeps the section, the grid, the heads and the simple key-value details (635 lines).
   - The children are not exported, and the spec drives them through the parent.
   - Lint is back to the baseline of 10 warnings.
2. **One per-row action instead of "Open file" plus "Review".** The design shows two actions per row.
   - `ChangeSetActionsService` has one per-file operation, `openFile(changeSet, path)`. Parity section 2 maps "File row
     opens the file in review" to it, and plan:753 lists the outputs `openFile(path)` and `review()`.
   - Each row therefore has one action: "Review" (accessible name "Show <file> in review"), or "Resolve" when
     conflicted ("Resolve <file>"). This matches the change-set card's row titles (`CSC:533`).
   - "Review all" emits `review()`.
   - A separate "Open file in editor" would need a new output and service path the plan does not define.
3. **No `openScm` output.** Plan:753 lists `openScm()`, but "Open Source Control" is VS Code-only. Parity section 2
   keeps it "unchanged" in the VS Code change-set card, and the panel exists only in Electron (R1.14). A button that
   can never render would be dead code, so it is not added.
4. **No sparklines or trend pills on the summary stat cards.** The prototype shows a 7-bar sparkline and pills such as
   "3 new", "+316 net", "12%" and "vs 3m 40s". `TurnSummaryModel` carries one turn's values and no series or baseline,
   so these could only be invented data. The cards show label, number and unit, plus the R6.3 state pills.
   Decision #51's polarity reaches the Tests card through `data-polarity="bad"` (error-tinted border) and the error
   "N failed" pill.
5. **Lines, Tokens, Cost and Duration expand.** R6.1's table says these expand to "(none)". Design section 5 and R9
   ("every card is collapsible") give them an expanded key-value detail, and I followed the design:
   - Lines: Added/Removed, or the counts-unavailable sentence.
   - Tokens: Input/Output.
   - Cost: Turn cost, plus a sentence when it is unavailable.
   - Duration: Elapsed.

   The prototype's extra rows (cache read, per-model cost, tools-versus-model split, slowest tool) are not in the model
   and are omitted.
6. **No stacked layout at narrow widths.** Design section 2 left the stacked layout as an implementation choice. The
   strip is always shown and scrolls horizontally inside itself, so the R1.6 behaviour is "select and scroll into view"
   at every width.
7. **The section subtitle reads "host-built" only.** The prototype's "Turn 12 · finished 2 min ago" needs a turn
   number and finish time that are not in the model or the plan inputs.
8. **Integration gap for the team-leader.** `libs/frontend/chat-ui/src/display-panel.ts` still exports only the sync
   and the pure functions.
   - The dock (Task 25.1) needs `DisplayPanelComponent`, `DISPLAY_PANEL_SUMMARY_KEY` and
     `DisplayPanelViewStateChange` from `@ptah-extension/chat-ui/display-panel`.
   - No batch lists that file after Batch 20, and it is outside Batch 21's ownership, so I did not edit it.
   - Proposed: add the three exports to Task 25.1, or to a one-line follow-on in this phase.

## Out-of-scope observations

- Sibling type errors reported by the diagnostics tool are pre-existing and outside this batch (listed above).
