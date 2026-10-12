# Batch 19 report — C4 turn summary model and chip

Executor: frontend-developer. Worktree `W` = `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`.
No git commands were run. `batches.md`, `decisions.md` and `libs/frontend/chat-ui/src/index.ts` were not touched.

## Task 19.1 — summary model: COMPLETE

Files (CREATE):

- `W\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary.model.ts`
- `W\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary.model.spec.ts`

What `buildTurnSummaryModel(snapshot, marks?)` does (pure, no Angular, no renderer):

- It returns `null` when the snapshot is `null` or not `terminal` (never built during streaming, R6.7). It also
  returns `null` when the turn changed no files and ran no test command (R6.4). A `pending` diff counts as no files
  until the change set arrives. The caller recomputes then.
- Cards in order: Files, Lines, Tokens, Cost, Duration, Tests, exposed both as named fields and as the ordered
  `cards` array. Files and Tests are `null`/omitted when there is nothing to show (R6.4). Lines is omitted together
  with Files (see deviations).
- Values equal the resolver's (`ptah-ui-resolver.ts` `scalarValue`):
  - Files is `$diff.files`, or `unavailable` when counts are unavailable.
  - Lines is `$diff.additions` / `$diff.deletions`.
  - Tokens is `$usage.input` / `$usage.output`.
  - Cost is `formatUsdCost(...) ?? 'unavailable'`. A real 0 stays `$0.0000`, never "unavailable".
  - Duration is `formatDurationMs`.
  - Tests is `$tests` summary counts plus `running`.
  - A missing source reads `pending` or `unavailable`, never 0.
- R6.3 flags: `incomplete`, `testsInBackground`, `countsUnavailable`, `baselineMissing`, `truncatedCount`, and the
  conflicted and reconciled counts.
- Files card (change-set capabilities, R6.8):
  - the `changeSet` itself, for the Open file and Review actions;
  - per-row `state` (conflicted wins over reconciled), from `TurnSummaryMarks`. This is plain data with the same
    shape as chat's `ChangeSetMarks`, so chat can pass `store.marksFor(set)`;
  - per-row `counts` from the change-set card's own `formatFileCounts` (`binary`, `?`, `+0 −0`).
- Tests card (every tests-row capability):
  - `label` (the ported `outcomeLabel`, exported as `turnTestsOutcomeLabel`);
  - `ariaLabel` with the " (incomplete)" suffix;
  - `polarity` set to `bad` when any run failed, `good` otherwise (decision #51);
  - run rows with `label` (the project, or the outcome word), `command`, `project`, `outcomeName` (the icon's
    accessible name), `tone` (the precomputed colour cue), and `failures`.

Evidence: `turn-summary.model.spec.ts`, which is part of the 69 passing tests below. The "values equal the resolver"
cases compile a real `ptah-ui` block that binds all 11 scalar fields. They run `resolvePtahUi` on the same snapshot
and compare the result with the model's values, for 4 fixtures: populated, counts unavailable, usage unavailable,
and zero cost.

## Task 19.2 — summary chip and entry export: COMPLETE

Files:

- CREATE `W\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.ts`
- CREATE `W\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-summary-chip.component.spec.ts`
- MODIFY `W\libs\frontend\chat-ui\src\turn-recap.ts`: adds `TurnSummaryChipComponent`, `buildTurnSummaryModel`,
  `turnTestsOutcomeLabel` and the model types. The `TurnTestsRowComponent` export is kept for Batch 24.

`ptah-turn-summary-chip`:

- Standalone, OnPush, with signal inputs `summary` (required) and `openable` (default true), and output `open`.
- Collapsed by default (R9.4). It shows an icon, "Turn summary", and metric pills that wrap at narrow widths (R9.6),
  for example "3 files", "+42", "−7", "2 tests passed", "1 test failed", "1 test running in background",
  "tests unknown", "incomplete".
- Expanded, it shows mini cards and an "Open in panel" button. The cards are Files, Lines, Tokens, Cost, Time and
  Tests. Files, Lines and Tests appear only when present. Counts unavailable reads "?" with "counts unavailable".
- Totals only, never a file list (R6.9).
- The ARIA follows the display chip pattern:
  - the toggle carries `aria-expanded` and `aria-controls`;
  - the region carries `aria-labelledby`, and is `inert` while collapsed;
  - Escape collapses the chip and refocuses the toggle;
  - the section `aria-label` holds the totals plus "(incomplete)";
  - there is no live region.
- The warm hero gradient (decision #13) is `secondary @12%` into `base-200` at 135 deg, a literal copy of
  design-spec section 1.
- No renderer or declarative-dashboard import. A spec reads both source files to confirm this.
- Pill colours use the existing `diff-add-text` / `diff-del-text` AA overrides and DaisyUI `badge-*` classes.
  Motion runs only under `prefers-reduced-motion: no-preference`. There are no timers or observers.

## Tests-row spec cases ported (`turn-tests-row.component.spec.ts`)

| Tests-row case | Ported to |
| -------------- | --------- |
| renders nothing for an empty list | model spec "turn with no test command has no Tests card"; R6.4 null cases |
| shows the right counts for a mixed list | model spec "shows the right counts for a mixed list"; chip spec "spells failed, running and unknown runs as words" |
| shows just "unknown" for an all-unknown list | model spec (label `unknown`); chip spec ("tests unknown") |
| lists each run in execution order as outcome word plus command | model spec (same name) |
| spells the %s outcome as text, never colour alone (it.each) | model spec (same name; `label` and `outcomeName`) |
| styles the %s row with its precomputed class (it.each) | model spec "precomputes the %s row tone" (`success`/`error`/`info`/`muted`); Batch 21 maps tone to class |
| marks an aborted turn "(incomplete)" only when told | model spec (same name, `incomplete` and `ariaLabel`); chip spec (same name, "incomplete" pill) |
| labels the section with the outcome and is not a live region | model spec (`ariaLabel`); chip spec (section `aria-label`, no `role`, no `[aria-live]` or `[role=status]`) |
| gives each recap body a distinct id referenced by its own header | chip spec "gives each chip a distinct region id referenced by its own toggle" |
| renders no file or +/- counts content | model spec "carries no file or +/- counts content in the Tests card"; chip spec "never lists files, even expanded" (R6.9; the chip shows +/- totals by design) |
| has no axe violations with a mixed, incomplete list | chip spec axe, collapsed and expanded |

Added beyond the port:

- running label and `testsInBackground`;
- Nx project label with full command and failure lines;
- polarity `bad` (decision #51).

The tests-row render-only pieces belong to Batch 21 (`turn-summary.component.spec.ts`, plan:786-793). These are the
`<details>` "Full command" element, the failure-line list markup and the icons. The model carries their data and
asserts it.

## Verification (CLAUDE.md memory-safe; Batch 19 command)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap --coverage=false --maxWorkers=2`
  → `Test Suites: 3 passed, 3 total; Tests: 69 passed, 69 total`. The 3 suites are the model spec, the chip spec and
  the unchanged tests-row spec. The command-line `--moduleNameMapper` was not needed.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` → "Successfully ran target typecheck".
- `npx nx lint @ptah-extension/chat-ui --parallel=1` → 0 errors and 10 warnings, all baseline; none is in a batch
  file.
- `ptah_get_diagnostics` on both spec files: 0 errors. The 8 errors it lists are pre-existing ones in sibling files
  this batch did not touch.
- Prettier was applied to the batch files. A grep found no TODO, FIXME or timer markers.

## Risks handled

- **Parity loss when the tests row leaves (decisions #5, #10).** Every `turn-tests-row.component.spec.ts` case is
  ported, as the table above shows. The tests row and its spec are untouched and still pass. Batch 24 deletes them.
- **"(incomplete)" for aborted turns.**
  - The model carries `snapshot.incomplete`, which is true for an error or interrupted status, or a non-terminal test
    (`turn-sources.utils.ts:56-65`).
  - The Tests `ariaLabel` gets the " (incomplete)" suffix.
  - The chip shows a warning "incomplete" pill and the section label ends "(incomplete)".
  - An aborted turn without tests is still flagged.
- **Tests stat reading as failing (decision #51).** `tests.polarity === 'bad'` whenever a run failed, so Batch 21 can
  pass it to the stat trend.
- **Eager bundle (D14).**
  - The chip and the model sit only in the lazy `turn-recap` entry; `index.ts` is unchanged.
  - Neither file imports the renderer or the declarative-dashboard library, and a spec asserts this.

## Plan deviations and points for a ruling

1. **Lines card omitted with Files.** R6.4 names only Files and Tests as omitted. A turn with no files would
   otherwise show "+0 −0", and design-spec section 5 says "a card with nothing to show is omitted". Ruling requested.
2. **`openable` input on the chip.** This input is not in the plan's chip contract, which has only the output `open`.
   It is added for the plan's own failure behaviour (component 7: "No dock store … the chips show the unavailable
   state"). When `false`, "Open in panel" is disabled and described by "Display panel unavailable". Batch 24 binds it.
3. **`formatFileCounts` reuse.** The model imports `formatFileCounts` from `change-set-card.component.ts`, as parity
   section 2 requires ("reuse the same formatter"). That module also declares the card component. Both sit in lazy
   entries, so the eager closure is unaffected. If Batch 32's gate prefers it, the formatter could move to a plain
   util file outside this batch's ownership.
4. **Counts-unavailable display.** The model's Files value is `unavailable`, matching the resolver. The chip shows
   "?" plus "counts unavailable", per the design-spec R6.3 table. In the collapsed line it shows "files changed" and
   "counts unavailable".
5. **Gradient on the chip.** The prototype chip uses flat `base-200`. The batch requirement "warm gradient kept
   (decisions #13)" was applied to the chip with the design-spec hero values. Batch 33 visual review should confirm
   this.

## Out-of-scope observations

- None in the batch area.
