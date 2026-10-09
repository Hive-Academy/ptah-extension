# Usage charts implementation report

## Design summary

Plan usage now has a compact, accessible progress visual wherever a usage window is already available. Provider-account cards use horizontal bars beside the existing percentage and reset copy; session plan tiles use a native progress bar below their percentage headline. Both use the established theme colours: normal below 75%, warning at 75% and above (including the existing 90% near-limit warning), and error only for an actual limit-reached state. Reset copy remains visible and its full absolute/relative form remains available in the session bar tooltip.

The expanded session-stat grid again has a small collapse icon in its header. It is deliberately outside the grid, so it cannot appear as an orphan stat tile.

No dashboard provider-specific history series is present in the current analytics view model. I therefore did not add a speculative sparkline or a backend read. The existing inline SVG sparkline in `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts` was inspected as the repository pattern, but is not reused without a source series.

## Files changed

- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts` — changed window meters to accessible progress bars and applied compact threshold colours while retaining owner, refresh, reset and source information.
- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.spec.ts` — updated progressbar semantics coverage.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.ts` — added native, labelled per-window progress bars with reset-time tooltip and threshold styling.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.spec.ts` — added usage-progress accessibility and threshold regression coverage.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.html` — restored the compact collapse control in the expanded stats-grid header, outside the tile grid.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.spec.ts` — verified the header collapse control and resulting collapsed state.

## Reused components and conventions

- Reused the existing provider-card bar structure and the session `PlanLimitTileModel.window.percent` data; no new shared primitive, state source, dependency or RPC was introduced.
- Followed the existing native `<progress>` pattern from the session budget banner, including an explicit accessible name and bounded value.
- Kept the established `surface-2`, DaisyUI `progress-*`, and semantic warning/error theme classes referenced by the elevation audit.

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts --coverage=false --maxWorkers=2` — passed, 34 tests.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts --coverage=false --maxWorkers=2` — passed, 42 tests.
- `npx nx typecheck @ptah-extension/dashboard --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` — passed.

Nx reported its disabled cloud-organization notice after both successful typechecks; it did not affect local verification.

## Decisions

- Kept 90% near-limit usage warning-coloured, matching the existing behaviour and preserve list; error colour indicates a confirmed limit-reached state.
- Did not add an expected-pace marker because the current window contract exposes reset time but not a reliable window start or duration.
- Did not add a sparkline because this dashboard surface has no provider-attributed usage history data to plot over the selected Range.
- Retained every status-only state as a single status chip and left its detailed explanation available through the existing title/accessible text path.

## Proposed Removals

None.

## Radial gauges

### What changed

- Dashboard provider-account windows now render as compact DaisyUI `radial-progress` gauges in a wrapping inner grid. Each gauge shows a clamped percentage, its window label, reset information, source chips and any existing state chip. The accessible value retains the precise existing usage text, and the reset tooltip retains the absolute reset time.
- Session plan-limit windows now render a smaller radial gauge beside the window label, account caption, percentage and reset text. Status-only and non-window tiles retain their existing compact text treatment; the expanded-grid header collapse icon remains unchanged.
- Both surfaces bind the untrusted numeric value only through Angular `[style.--value]`, clamped to 0–100. Gauges retain `role="progressbar"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and a per-window accessible label.
- DaisyUI semantic text colours drive the radial fill: `text-success` below 75%, `text-warning` at 75% or higher, and `text-error` only when the existing model has confirmed an error/limit-reached tone. `bg-base-300` provides the muted track in both light and dark themes.

### Files changed

- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts` — replaced horizontal usage bars with responsive, accessible radial gauges.
- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.spec.ts` — updated the provider gauge accessibility, threshold-colour and style-binding regression assertions.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.ts` — replaced the linear tile progress bar with a compact radial gauge beside label and reset copy.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.spec.ts` — updated focused radial-gauge and semantic-colour assertions.
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_UI_DEFECTS\usage-charts-report.md` — appended this radial-gauge report.

### Checks run

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts --coverage=false --maxWorkers=2` — passed, 34 tests.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts --coverage=false --maxWorkers=2` — passed, 42 tests.
- `npx nx typecheck @ptah-extension/dashboard --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` — passed after the final template layout change.

Nx emitted its existing disabled Cloud-organization notice after successful local checks; it did not affect verification.

### Decisions

- Used the repository's existing DaisyUI radial-progress convention from `dashboard-radial-progress.component.ts`, rather than adding a primitive or dependency.
- Kept the visible gauge centre to a concise rounded percentage, while preserving the exact usage text in the accessible value so amount-based windows do not lose information.
- Kept `text-success` below 75% to preserve the previous green normal-usage signal. The established 90% warning remains covered by the 75% warning threshold.
- Kept status-only accounts as a single status chip, with their detailed explanatory text in the existing title/accessible path.
- `ptah_agent_report` was not available in this lane's provided tool list, so no orchestrator report call could be made.

### Proposed Removals

None.
