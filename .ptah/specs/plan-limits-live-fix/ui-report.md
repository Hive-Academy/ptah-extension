# Plan limits — UI layout fix (frontend)

Stack: Angular standalone + OnPush + signals, Tailwind 3 + DaisyUI 4 (component styles in
`styles: []`, container queries on `li.row`). No backend file touched; no data shape changed.

## Files changed

- MODIFIED `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html` — `<ptah-provider-account-card />` placed directly under the "Convene a Tribunal" banner, above harness / skill-selection / analytics cards.
- MODIFIED `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.ts` — imports `ProviderAccountCardComponent`; doc note on placement.
- MODIFIED `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html` / `.ts` — removed the embedded "Provider accounts & plan limits" block, its import and `nearLimitPercent`; subtitle now "Cost and tokens for sessions in this workspace."
- MODIFIED `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` — the card is now its own `surface-1` section (`data-testid="dashboard-section-provider-accounts"`, `aria-labelledby` an `h3` "Provider accounts & plan limits" + the 90% tick explanation). Removed the unused `commonSources` view field (sources now render per window cell).
- MODIFIED `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-row.component.ts` — new single row grid (below).
- MODIFIED specs: `provider-account-card.component.spec.ts`, `analytics-card.component.spec.ts`, `harness-card/harness-card.spec.ts` (stub for the new grid child).
- CREATED `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.layout.spec.ts` — pins section order (Tribunal → plan limits → analytics) and that analytics no longer embeds the card.

## New row layout

Row (`section.owner-row`, container `row` = the hosting `li`):

| Row width | `grid-template-columns`    | areas                                            |
| --------- | -------------------------- | ------------------------------------------------ |
| < 720px   | `minmax(0,1fr) 2rem`       | `identity actions` / `body body` / `below below` |
| ≥ 720px   | `15rem minmax(0,1fr) 2rem` | `identity body actions` / `. below .`            |

- **identity** (fixed 15rem when wide): 36px tinted mark box, title `h5.truncate` with `title` tooltip, ONE subtitle line `p.truncate` with tooltip. No chips here any more.
- **body** = windows area, same template for every provider: `repeat(N, minmax(0,1fr))`, N = 1 (<520px), 2 (≥520px), 3 (≥900px); gap `0.75rem 1.25rem`.
- **window cell** (`.win`): `grid-template-columns: minmax(0,1fr) minmax(0,max-content)`, areas `name value` / `bar bar` / `meta meta`. Label truncates (tooltip); value is `tabular-nums`, right-aligned, nowrap (percent only when the value is a known percent — unknown shows "Used: unknown" and a hatched track, never 0%). Meter row; meta row = state chip, limit line, reset lines, note, source chips.
- **actions** (2rem): refresh button (aria-label "Refresh <owner> usage").
- **below** (under the body column): owner evidence, cooldown, Codex activity.

## How each provider state renders

- **Claude / any owner with windows**: one `.win` cell per window in the body grid; percent right column; meter; reset + source chips beneath. A warning status (e.g. stale "◷ Cached data") adds a status line spanning the body above the cells, bordered in warning tone.
- **Grok single window**: one cell in column 1 — same width/columns as Claude's cells, so values align vertically.
- **OpenCode local usage**: status line (chip "○ No usage source" + reason, e.g. "Local usage only") spanning the body, then a window-like local-usage cell (label | — / value `tokens · $cost` in the meter row / range + "Local CLI accounting" in meta) in column 1. No longer right-aligned at the far edge.
- **Antigravity / Codex unavailable, Ollama key problem, sign in, no usage source**: one `.status-line` (`grid-column: 1 / -1`, flex, `gap .25rem .5rem`, min-height = mark box so it centres on the identity line) inside the body: status badge + reason + optional inline action ("Go to chat", "Add key"). `role="status"` on the line; sr-only "does not report plan usage" text for no-usage-source.
- **Status/state chips**: `inline-flex gap-1 whitespace-nowrap`; glyph `aria-hidden`, text in its own span — glyph and word no longer collide ("○No usage source" fixed: the old trailing space was trimmed inside DaisyUI's inline-flex badge).
- **Long titles** ("Ollama Cloud (owner unknown) (key unavailable) · 229f"): single-line ellipsis, full text in the `title` tooltip; the row's aria-label still carries the full name.

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts <provider-account-card, analytics-card, dashboard-grid, harness-card> --coverage=false --maxWorkers=2` → 5 suites, 86 tests passed.
- `npx nx test dashboard --parallel=1 --maxWorkers=2 --coverage=false` → 13 suites, 173 tests passed.
- `npx nx typecheck dashboard --parallel=1` → Successfully ran target typecheck.
- `npx nx lint dashboard --parallel=1` → 0 errors, 1 pre-existing warning in `provider-accent.ts` (file not touched).
- Not run (forbidden here): build/serve/e2e. `webview-e2e-harness` plan-limits visual spec selectors (`ptah-provider-account-card`, `provider-account-section`, `cooldown`, `refresh-failed`, Refresh button name) are unchanged; its screenshots will differ by design.
- No live visual check in Electron was possible from this lane; the layout should be eyeballed in the Dashboard.
