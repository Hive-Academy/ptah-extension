# Phase 6: surfacing `loadError` (re-review fix round 1, item 2)

**Verdict**: Fixed. A failed pull while a snapshot is held now shows a neutral `role="status"` notice on the chat stats strip and on the dashboard provider account card. All 17 scoped typecheck, test and lint targets pass.

## What changed

The notice text is "Refresh failed — showing last observed data (observed <time>)". The time is the newest host observation among the owners in the held snapshot: the latest `windowObservedAt` of any window, or the latest `observedAt` of any owner evidence. It is formatted with the shared `formatLocalAbsolute` and the surface's explicit `LocalTimeOptions` (host zone plus `LOCALE_ID`). If no held owner has an observation, the time clause is left out. No browser timestamp is used, the host snapshot is not changed, and the age-based window classification is unchanged; a spec asserts the tiles and rows are identical with and without the error.

The notice is hidden in these cases:
- A pull or push succeeds. The store already clears `loadError` in `apply()`, and both surfaces derive the notice from that signal.
- Nothing is held. The empty placeholder has no owners, so the "Account usage unavailable" text and the null strip cover that case instead.

Styling: an `info` left border with `text-base-content-muted` text. There are no `text-base-content/NN` classes and no warning or error tone.

### Chat (chat-ui does not import the store; the error is passed in as data)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-limit-view-model.types.ts`: adds `refreshFailed?: boolean` to the input and `refreshNotice?: string` to the view model.
- MODIFIED `...\chat-ui\src\lib\molecules\session\plan-limits\stats-limit-view-model.ts`: adds `refreshFailedNotice()` and `newestObservation()`.
- MODIFIED `...\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts`: renders `<p role="status" data-testid="limits-refresh-failed">` at the top of `.stats-grid`, so the notice shows in both the collapsed and the expanded layout.
- MODIFIED `...\chat\src\lib\components\templates\chat-view.component.ts`: passes `refreshFailed: this._planLimits.loadError()` into `buildStatsLimitViewModel`.

### Dashboard
- MODIFIED `...\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts`: adds a `refreshNotice` computed and an exported pure `refreshFailedNotice(snapshot, now, time)`. The `<p role="status" data-testid="refresh-failed">` sits directly above the retained sections.

### Specs
- `stats-limit-view-model.spec.ts`: the notice uses the newest observation in local time; the states are unchanged; there is no notice after a good read, when the error is cleared, or with no owners; the time is omitted when nothing was observed.
- `session-stats-summary.component.spec.ts`: the notice shows with `role=status` and neutral classes in both layouts, is hidden after the next good view model, and is absent when `limits` is null.
- `chat-view.component.spec.ts`: the stub gains `loadError`. A wiring test checks the notice appears on error and clears when the error clears.
- `provider-account-card.component.spec.ts`: the fake store gains `loadError`. Tests cover:
  - the notice shows with the local observation time, above the sections;
  - the rows are unchanged;
  - it hides after success;
  - it is absent on the empty placeholder;
  - through the REAL store, a failed Refresh shows the notice and a later `planLimits:changed` push clears it.

### Harness (scenario plus fixtures only)
- `plan-limits.fixtures.ts`:
  - `provider:getPlanLimits` is now a resolver that reads a `PlanLimitsRpcControl { failPulls }` switch and returns the existing `rpcError(...)` once the switch is armed. Before that it returns the same snapshot as before.
  - Adds `PULL_TRIGGER_MESSAGE`, a spawn on a new Codex owner. The chat view has no Refresh button; a widened owner-key scope is its only trigger for a pull.
- `plan-limits-visual.e2e.spec.ts`: adds two new captures:
  - `stats-strip-refresh-failed-collapsed-<theme>-<width>.png`: the chat strip, collapsed, with the at-limit alert still shown.
  - `dashboard-card-refresh-failed-<theme>-<width>.png`: the card after its first section's Refresh fails; the section count is unchanged.

No other scenario or settings file was touched.

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/dashboard ptah-extension-webview @ptah-extension/webview-e2e-harness` was run in the foreground. Result: "Successfully ran targets typecheck, test, lint for 6 projects", 17 of 17 tasks, with core test and lint served from cache. The Nx Cloud 401 notice is unrelated.

`@ptah-extension/webview-e2e-harness` has no `test` target; only its typecheck and lint ran. The Playwright scenario was **not executed**: it needs `dist/apps/ptah-extension-webview` built from this tree. The new captures have not been produced yet.

## Observations
- The observation-time helper exists in two places: `chat-ui` `newestObservation` and the dashboard's `refreshFailedNotice`. They are kept separate because they are two separate contexts.
- The chat notice covers every owner in the held snapshot, not only the session's own owner. This matches the "last observed data" wording, since the strip's lane tiles also read other owners.
