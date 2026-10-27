# Revision 2 item 9 — Lane detail as DaisyUI structure

## Files

All under `libs/frontend/chat-ui/src/lib/molecules/session/`:

- CREATED `plan-limits/lane-detail.ts`: pure helpers. `runStatusBadge` (one status word), `formatRunStarted` (short `d MMM HH:mm` plus the full timestamp, falls back to UTC for an unknown zone), `laneRunColumns` (drops columns where every value is unknown) and `subgroupFootnote` (owner text and notes on one line, each phrase once, without "Limit unavailable").
- CREATED `plan-limits/lane-detail.spec.ts`: unit tests for the four helpers.
- MODIFIED `plan-limits/stats-limit-view-model.types.ts`:
  - `LaneRunRowModel` is now `{ runId, index, model: string | null, tokensText, costText, status: StatsChip, started?: LaneRunStarted }`. `label`, `stateText` and `startedText` are gone.
  - New types `LaneRunStarted` and `LaneRunColumns`.
  - `LaneSubgroupModel` gains `columns` and `footnote`.
  - `LaneUsageTileModel` gains `summary`.
  - The earlier `partial` change to `usageTotals` is kept.
- MODIFIED `plan-limits/lane-tiles.ts`:
  - Builds `summary` (known usage or "Usage unavailable", then face limit texts or "Limit unavailable"), `columns`, `footnote` and the new run rows.
  - Removes `runState`, which made the "Restored · completed" sentence.
  - The uncommitted `≥` partial-total markers are kept.
- MODIFIED `plan-limits/stats-tile.styles.ts`:
  - `laneRowClass` is replaced by `laneCollapseClass(tone, open)`.
  - New: `LANE_COLLAPSE_TITLE`, `LANE_ROW_GRID` (`grid grid-cols-[minmax(0,1fr)_5.5rem_7rem] items-center gap-x-2`) and `badgeClass(tone)` (DaisyUI `badge badge-xs`; tone only tints border and fill, text stays `text-base-content`).
- MODIFIED `plan-limits/lane-usage-tile.component.ts`: rebuilt template (see Structure).
- MODIFIED `plan-limits/lane-subtotal-tile.component.ts`: sits on `LANE_ROW_GRID` with the same insets as the lane title, so "Known subtotal" and its tokens line up with the lane name and usage columns.
- MODIFIED `plan-limits/lane-usage-tile.component.spec.ts`: rewritten for the new structure.
- MODIFIED `plan-limits/stats-limit-view-model.spec.ts`: covers status badge, started, footnote, summary, columns and `index`.
- MODIFIED `plan-limits/stats-limit-sections.spec.ts`: fixture gains `summary`.
- MODIFIED `session-stats-summary.component.spec.ts`: the `tileButton` selector also matches `> .collapse > button`.

`inspector-limits-lanes.component.ts` was not changed. Its `grid gap-2` list already stacks rows that now share `LANE_ROW_GRID`.

## Structure

- **Lane row:** a `div.collapse.collapse-arrow` with `collapse-open` or `collapse-close` set by the host (the open state stays in `StatsTileExpansionState`). It keeps the dashed lane accent and its own fill.
- **Title:** a `<button class="collapse-title">` with `aria-expanded` and `aria-controls`.
  - It holds one `LANE_ROW_GRID` row: lane name, usage (tokens, else the known cost, else a muted `—` labelled "Usage unavailable"), and the run status as `badge badge-xs badge-ghost`.
  - An at-limit or near-limit lane adds its limit badge under the status, so the alert shows while the row is closed.
  - The "lane · not in totals" caption appears only when the section header does not share it.
  - The focus ring is DaisyUI's `.collapse:has(.collapse-title:focus-visible)` outline in base-content.
- **Body (`collapse-content`, rendered only while open):**
  1. One muted summary line, plus deduplicated source chips. Example: `Usage unavailable · Limit unavailable`.
  2. For each owner + model-scope subgroup:
     - A heading with a state badge, only when there are several subgroups.
     - A `table table-xs` with columns `#`, Model, Tokens, Cost, Status (`badge badge-xs`) and Started (`d MMM HH:mm`, full timestamp in `title`). Number cells use `text-right tabular-nums`.
     - Model, Tokens, Cost and Started columns are dropped when every run's value is unknown.
     - The plan-tile link chips, window detail, evidence and cooldown lines, as before.
     - One footnote line: `lucide` `Info` icon with `text-xs text-base-content-muted`.
- **"Limit unavailable" appears once:** the summary states it, and the footnote removes that phrase from the owner text and notes.

## Verification

`npm run verify -- -p @ptah-extension/chat-ui -- --output-style=static`, run from the worktree root:

- Header: "Running targets lint, test, typecheck for project @ptah-extension/chat-ui".
- Test: 87 of 87 suites passed, 1606 of 1606 tests passed.
- Lint: 0 errors, 12 warnings. All warnings are existing `no-non-null-assertion` warnings in files I did not change.
- Typecheck: passed.
- Result: "Successfully ran targets lint, test, typecheck", exit 0.

The first run failed 7 tests. All were my own spec assertions or old selectors (class order, a fixture summary, `> button`). I fixed them and the second run is the result above.

`@ptah-extension/chat` was not run. Its only consumer, `chat-view.component.spec.ts`, reads `laneTiles[].subgroups[].ownerStatus` and `notes`, which did not change. No chat type broke.

## Open

- Not checked visually in Electron. The DaisyUI arrow is moved with `after:!top-[0.95rem] after:!end-2.5 after:!h-1.5 after:!w-1.5`, because DaisyUI's selector outranks a single utility. Worth checking on a screenshot.
- The status column is a fixed `7rem`. A long run chip ("Live · 2 of 3 running") is cut off, with the full text in `title`.
- Limit chips that are not alerts ("Room", "Last known · …") now appear only in the open summary line, not on the closed face.
- `ownerText` and `notes` stay in the view model (the chat spec and the view-model spec use them). The template now renders them only through `footnote`.
