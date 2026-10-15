# Lane report: split pane headers (decision row 113)

Writer: Claude (frontend-developer). Base: HEAD 1548dde46 plus the uncommitted work of two
other changes, which this lane did not touch. Paths below are relative to
`libs/frontend/canvas/src/lib/canvas-rail/`.

## Requirement -> file:line -> spec case -> result

| Requirement (row 113) | Implementation file:line | Spec case | Result |
| --- | --- | --- | --- |
| Visible 1 px divider, vertical side by side (`border-l`) | `canvas-rail-board.component.ts:143-146` (`border-base-content/15` + `border-l` on the pane at visual position 2, `data-pane-divider="vertical"`) | board spec:1503 "side by side shows a vertical divider and markers 1/2 that follow visualOrder on swap" | PASS |
| Divider horizontal when stacked below 1440 px (`border-t`) | `canvas-rail-board.component.ts:145-146` | board spec:1536 "stacked panes use a horizontal divider on the bottom pane and Top/Bottom markers" | PASS |
| Small gap between panes | `canvas-rail-board.component.ts:139` (`gap-1` on the pane container, split only) | board spec:1503, :1536 (gap present), :1567 (absent in single focus) | PASS |
| Pane min sizes unchanged (`min-w-[360px]`, `min-h-[400px]`); no new horizontal scroll | `canvas-rail-board.component.ts:142` unchanged; the border is inside the box (Tailwind preflight `box-sizing: border-box`); side by side starts at 1440 px, so 2 x 360 + 4 px gap fits beside the rail | board spec:1503 (both panes keep both min classes after swap) | PASS |
| Active header accent: primary top bar via inset box-shadow, no height change | `canvas-focus-header.component.ts:18` (`.pane-active { box-shadow: inset 0 2px 0 0 oklch(var(--p)) }`), `:22` (split and active only), `:23` (`data-pane-active`) | header spec:155 "the active split header carries the primary accent and a filled marker; its title keeps full contrast" | PASS |
| Active title in primary color | Not applied: see Decisions D1. The primary accent is carried by the top bar and the filled marker (`bg-primary text-primary-content`, `:26-28`) | header spec:155 (title has no muted class; marker is `bg-primary`) | DEVIATION (contrast) |
| Inactive header quieter: muted title and meta chips, readable | `canvas-focus-header.component.ts:22` (`pane-quiet` hook class), `:31-33` (`text-base-content-muted` on title, branch and model chips), `:100` (`quiet()`) | header spec:169 "the inactive split header is quiet: muted title, meta chips and marker, no accent" | PASS |
| Only the active header carries the accent | `canvas-rail-board.component.ts:153` (existing `paneFocused = activeSide() === side`) -> `canvas-focus-area.component.ts:46` -> header `:22` | board spec:1551 "only the active pane is marked active, and activating the other pane moves it without remount"; header spec:184 "switching the active pane moves the accent without remounting the header" | PASS |
| Pane marker 1/2 at the start of the header, following `visualOrder` | `canvas-rail-board.component.ts:508-510` (`paneNumber`), `:155-156`; `canvas-focus-area.component.ts:47-48, 90-91`; header `:25-30` (first element of the header) | board spec:1503 (after Swap panes: right pane = 1 / Left, left pane = 2 / Right); header spec:155, :169 | PASS |
| Marker accessible label consistent with the R9x labels | `canvas-rail-board.component.ts:512-519` (`panePlace` now the single source for both the section label "Left session: ..." and the marker); header `:29` (digit `aria-hidden`, sr-only "Left pane 1" / "Bottom pane 2") | header spec:155, :169; board spec:1536 (Top/Bottom); existing R9x label case board spec:1332 "stacked swap keeps hosts and top-before-bottom Tab order" still green | PASS |
| Header height 48 px unchanged | `canvas-focus-header.component.ts:21` (`h-12` untouched; the bar is an inset shadow) | header spec:191 "both split headers keep the 48 px header height class" | PASS |
| Single focus looks as today | Every new class and the marker are gated on `splitDisplayed()` (header `:22-25`, `:100`; board `:139`, `:143-146`, `:155-156`) | header spec:197 "single focus has no marker, no accent, no quiet styling, even with a stale pane number"; board spec:1567 "single focus has no divider, gap or marker" | PASS |
| Activation unchanged (click/focusin, no remount) | No change to `activatePane` or the `(click)`/`(focusin)` bindings (`canvas-rail-board.component.ts:147`) | board spec:1551 (click activates, same hosts); focus-area spec:170 "forwards pane activity, visual number and place to the header without remounting it" | PASS |

## Tests: lines

All runs through `node .ptah/tmp/check-run.mjs`, from W, one at a time, output filtered
from `%TEMP%\629-check-<label>.log`.

- `hdr-1` `npx nx test @ptah-extension/canvas --testFile=canvas-focus-header.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       18 passed, 18 total`
- `hdr-2` `... --testFile=canvas-focus-area.component.spec.ts ...`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       10 passed, 10 total`
- `hdr-3` `... --testFile=canvas-rail-board.component.spec.ts ...`
  - `Test Suites: 1 failed, 1 total`
  - `Tests:       3 failed, 71 passed, 74 total`
  - The 3 failures are `real card click|Enter|Space selects the inactive split pane without
    losing either host`. All 3 fail with `NG0303: Can't bind to 'reserveActionCorner' since
    it isn't a known property of 'ptah-compact-session-card'`. They are not caused by this
    lane. The other change's uncommitted `canvas-rail-card.component.ts` now binds
    `[reserveActionCorner]="true"`, and the board spec's `SelectCardStub`
    (`canvas-rail-board.component.spec.ts:97`) does not declare that input. Every row 113
    case and every other R9w, R9x and phase-fix case in that file passes. I left the stub
    alone on purpose. It belongs to the rail-actions-inside change and should land with
    it, as one line in `SelectCardStub`: `readonly reserveActionCorner = input(false);`.
- `ptah_get_diagnostics` (the 3 changed component files): no diagnostics in the requested
  files. Sibling files have 7 errors that existed before this lane, in
  `orchestra-canvas.rail.spec.ts`, `core/src/testing/mock-rpc-service.ts` and
  `shared/.../capability-id-codec.ts`. None are in the files this lane touched.
- I did not run the full suite, typecheck, lint, build or e2e (per the lane rules).

## Decisions

- **D1: the active title keeps `base-content` and is not set to `text-primary`.** The binding
  contrast rule (>= 4.5:1, theme tokens) cannot be met by `text-primary` on `base-100` in
  either first-party theme:
  - anubis: primary `#2563eb` on base-100 `#131317` computes to about 3.6:1.
  - anubis-light: primary `oklch(85% 0.138 181)` on the cream base-100 computes to about 1.5:1.
  - Values are from `apps/ptah-extension-webview/tailwind.config.js:82,102,150,176`.

  The primary color is carried instead by the inset top bar and by the filled marker. The
  marker uses `bg-primary text-primary-content`: about 4.8:1 on anubis by computation, and
  6.99:1 on anubis-light per the config comment at `tailwind.config.js:155`. The active title
  stays full base-content. The inactive title drops to `text-base-content-muted`, so the two
  titles still differ visibly. The contrast rule outranks the color wish, so I resolved this
  without a clarification. The reviewer may contest it.
- **D2: muted tier.** The quiet header uses the repo's measured `text-base-content-muted`
  token, not an alpha such as `/60`. `styles.css:147-184` explains that no single alpha passes
  on every theme. The token is >= 5.0:1 on base-100/200/300 by construction (anubis 6.06:1 /
  5.66:1, anubis-light 6.03:1 / 5.39:1), so the muted title and the `bg-base-200` meta chips
  stay >= 4.5:1. The state chip keeps its state ink because it carries meaning.
- **D3: non-text contrast of the bar on anubis-light.** The 2 px primary bar on the cream header
  is a weak cue there (about 1.5:1). The active state is never conveyed by the bar alone:
  - the filled vs. outlined-muted marker
  - the full vs. muted title and chips
  - the existing ", active" in the pane's accessible name

  A theme-specific bar color would need a new token, which is out of scope. I am recording it
  here as a design follow-up.
- **D4: the inputs reuse existing names.** Board -> focus area already had `paneFocused`, and the
  header now takes it under the same name (default `true`). There are two new inputs on the
  focus area and the header: `paneNumber: 1 | 2 | null` and `panePlace: string`. The board
  sends `null` / `''` in single focus, and the header also gates the marker on
  `splitDisplayed()`. `panePlace(side)` is now the single source of the positional word, and
  `paneLabel` uses it, so the section label and the marker cannot drift apart.
- **D5: the divider sits on the pane at visual position 2** (`paneNumber(side) === 2`), not on
  a fixed side, so it follows Swap panes. Only classes change on the stable wrappers, so no host
  is remounted. `data-pane-divider` (`vertical` / `horizontal`) and the `pane-quiet` class are
  hooks for tests and review. `pane-quiet` has no CSS of its own; the muting comes from the
  token classes.
- **D6: marker semantics.** The digit is `aria-hidden`, and an sr-only span reads "Left pane 1"
  (or Right/Top/Bottom). This matches the positional words of the R9x section labels and avoids
  a `role` on a plain `span`.

## Clarifications Needed

None.

## Changed files (absolute)

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.ts: accent bar, quiet styling, 1/2 marker, `paneFocused`/`paneNumber`/`panePlace` inputs.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.spec.ts: 5 row 113 cases.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.ts: forwards `paneFocused`, `paneNumber`, `panePlace` to the header.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.spec.ts: header stub inputs and 1 forwarding case.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts: split gap, divider on visual pane 2, `paneNumber`/`panePlace`, `paneLabel` refactored onto `panePlace`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts: focus stub inputs and 4 row 113 cases.
- CREATED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\specs\TASK_2026_629_c0b3\lane-split-headers-report.md: this report.
