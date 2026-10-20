# PR #784 visual fix — compact uniform plan-limit tiles (TASK_2026_707)

All work is in the `plan-limit-tiles` worktree, branch `feat/plan-limit-tiles`.
Paths below are relative to that worktree root. Existing behavior is kept; the
test ids `provider-account-tile` and `tile-cooldown` are unchanged.

Files changed:

- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html`
- `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts`

## Criterion 1 — uniform rows

- Change: `provider-account-card.component.ts:56-74` — the `.tiles` grid gains
  `grid-auto-rows: 1fr` (line 71). Every implicit row now resolves to one
  shared height (the tallest tile's content), so the former 128/102/112 px mix
  becomes one uniform height and nothing clips; `align-items: stretch` fills
  each cell. The stale source comment that claimed equal rows from stretch
  alone was rewritten to name the real mechanism.
- Tests: none added (pure CSS grid sizing; the card spec's `ul.tiles` query
  still passes).

## Criterion 2 — one status message per tile

- Change: `plan-tile-view.model.ts:946-953` — the footer status chip is
  suppressed semantically, not by string equality: when the status pill is
  shown and the owner has no windows, the pill already names the status cause,
  so the chip would repeat the same status in other words. A window-ed owner
  keeps the chip, because there the pill names the window cause and the chip
  the status — two different facts. The footer keeps only a differing notice
  and the action, so:
  - Claude / Provider CLI API key: pill "No plan limits (API key)", footer
    chip "API key — no plan limits" dropped, footer hidden.
  - Ollama missing key: pill "No API key configured", chip dropped, footer
    keeps only "Add key".
  - Antigravity unavailable: pill "Open Antigravity to read local quota",
    chip "Usage unavailable" dropped.
- Tests added: `plan-tile-view.model.spec.ts:877-947` — the four required
  cases (Claude API key, Provider CLI API key, Ollama missing key with the
  `Add key` action kept, Antigravity unavailable) plus a window-ed stale owner
  that still keeps its chip. `provider-account-tile.component.spec.ts:430-456`
  — DOM-level: the whole footer is hidden for a window-less API-key owner, and
  the Ollama footer renders only the `Add key` button.

## Criterion 3 — visual grouping

- Change: `provider-account-tile.component.html:5` — the tile root gains
  `rounded-lg border border-base-content/10 p-2.5`, so each tile is a visible
  rounded cell and footer elements clearly belong to it. `base-content/10`
  is a theme token and stays subtle in dark and light.
- Tests: `provider-account-tile.component.spec.ts:389-396` asserts the border
  and rounding classes on the rendered tile.

## Criterion 4 — titles and the reset line

- Change: `plan-tile-view.model.ts:120-141` — new pure `tileTitleLines()`:
  the parenthesized qualifiers ("(owner unknown)", "(key unavailable)") are
  split out of the display label. `plan-tile-view.model.ts:959-960` stores
  them as `titleName` / `titleQualifier` on the view; the full `label` stays
  for aria-labels and tooltips.
- Change: `provider-account-tile.component.html:16-31` — the header renders
  line 1 as the name with the key suffix (still truncated if extreme), and
  the qualifiers as a smaller muted second line. The mark, plan badge and
  refresh button stay vertically aligned to the block, so the refresh no
  longer depends on title length.
- Change: `provider-account-tile.component.html:82-87` — the
  "Resets in … · N% used" line lost `truncate` and now wraps
  (`leading-snug`); "% used" is never cut off and the full fact (with the
  absolute date) stays in the bar tooltip.
- Tests added: `plan-tile-view.model.spec.ts:837-875` (plain label one line;
  qualifiers to line 2; the two lines built from an owner snapshot with the
  full label preserved) and `provider-account-tile.component.spec.ts:398-428`
  (DOM: two header lines, no truncation of the used value).

## Criterion 5 — chip icons

- Change: `plan-tile-view.model.ts:509-518` — `statusChip` now returns a
  semantic `PlanTileStatusChipIcon` kind (`key`, `cached`, `cli`,
  `cli-update`, `off`) instead of a `glyph` character; the mapping per status
  is in `plan-tile-view.model.ts:520-560`.
- Change: `provider-account-tile.component.ts:121-130` — the tile maps each
  kind to a small lucide icon (`KeyRound`, `Clock`, `Terminal`, `RefreshCw`,
  `CircleOff`), the pattern the dashboard lib already uses
  (`LucideAngularModule` + `[img]`). `provider-account-tile.component.html:143-152`
  renders it at `h-3 w-3` instead of the "–"/"○" text glyphs.
- Tests added: `provider-account-tile.component.spec.ts:458-470` — the kept
  chip renders the lucide icon and no longer starts with "–"/"○".

## Verification (Jest)

Command (the only heavy check run; lane rule forbade nx typecheck/lint/build):

```
npx jest -c libs/frontend/dashboard/jest.config.ts \
  libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts \
  libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts \
  libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts \
  --coverage=false --maxWorkers=1
```

Tail:

```
Test Suites: 3 passed, 3 total
Tests:       74 passed, 74 total
Snapshots:   0 total
Time:        13.32 s
```

74 tests: 60 existing (all still pass — including the "Claude account · cdef"
header text and the "Add key" action assertions) plus 14 new. The tile spec
compiles the component and its lucide imports, so the changed code type-checks
as far as Jest sees it.

## Decisions

1. **One shared row height via `grid-auto-rows: 1fr`, not a fixed size.**
   Options: a fixed compact row height, `minmax(0, 1fr)`, or `1fr`. A fixed
   height risks clipping the tallest real tile (the OpenCode tile needed
   128 px); `minmax(0, 1fr)` can shrink below content and clip. `1fr` gives
   every row the tallest tile's content height: uniform, compact, clip-free.
   Evidence: the review's measured 128/102/112 px row heights. Reversible.
2. **Chip suppression by owner shape, not string equality.** The pill and the
   chip both derive from `owner.status`; the semantic distinguishing fact is
   whether the pill carries the status cause (window-less owner) or the
   window cause (window-ed owner). Suppressing on windows/pill presence keeps
   the chip where it adds information (e.g. stale "Cached data" next to a
   window-cause pill). Evidence: `statusPill()` in the view model already
   branches on `windowsExist`. Reversible.
3. **Key suffix stays on line 1; only parenthesized qualifiers move to line 2.**
   Options: suffix with the qualifiers, or with the name. Keeping it with the
   name preserves the existing "Claude account · cdef" single-line header for
   unqualified owners (existing spec) and never adds a second line for them.
   Evidence: `ownerDisplayLabel()` appends the suffix after the qualifiers.
   Reversible.
4. **The reset line wraps; the visible text is not shortened.** Options: wrap,
   or drop the absolute date from the visible line. Wrapping keeps the full
   fact visible at every width and keeps the model untouched; the absolute
   date is already in `bar.title`. Reversible.
5. **Icons verified before use.** `KeyRound`, `Clock`, `Terminal`, `RefreshCw`
   and `CircleOff` were confirmed to exist in the installed
   `lucide-angular/icons` before import, and the DOM spec proves the rendered
   chip contains an icon element.

## Not done

- No Electron re-render or screenshots: the lane rule forbids build/serve/e2e.
  The uniform-row, border and title changes need the visual reviewer's pass in
  dark and light to be confirmed visually.
- No nx typecheck/lint for the dashboard project (lane rule); the Jest run over
  the three specs is the executed verification.
- `STATE_CHIPS` glyph characters in `plan-tile-view.model.ts:53-66` are
  pre-existing data that no template renders (only `.text` is read); left
  as-is because the criterion named the rendered footer chips.