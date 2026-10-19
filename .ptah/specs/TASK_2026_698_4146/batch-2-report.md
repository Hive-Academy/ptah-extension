# Batch 2 report — estimated cache countdown

## Files changed

- `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts`: sanitize the selected snapshot's optional cache with the shared parser.
- `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.spec.ts`: cover selected-tab cache, tab isolation, invalid/transcript-only snapshots and availability.
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts`: add nullable cache to inspector inputs.
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/cache-countdown-clock.service.ts` and `.spec.ts`: one root-provided, visibility-aware, reference-counted clock and lifecycle tests.
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.ts` and `.spec.ts`: responsive SESSION tile with expiry, idle countdown, estimate explanation and boundary tests.
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts` and `.spec.ts`: conditionally mount the cache tile and test mount, removal and session switching.

## Behaviour

The tile appears only when the selected snapshot has a valid cache projection. Expiry uses the required rounded-up minute estimate and changes to `Cache expired` at the deadline. The armed idle line rounds up, reaches zero at fire time, and disappears 60 seconds later. The clock samples at mount and when the page becomes visible, uses one interval for all mounted tiles, and releases the interval and visibility listener with the last tile. The tile uses the existing SESSION grid colors and border classes, spans both columns, and explains that server eviction may occur early in its title and accessible label.

## Verification

- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/chat-ui --parallel=1`: passed.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/chat --parallel=1`: passed.
- `NX_NO_CLOUD=true npx nx test @ptah-extension/chat-ui --parallel=1 --coverage=false --maxWorkers=2`: passed, 77 suites and 1,441 tests.
- `NX_NO_CLOUD=true npx nx test @ptah-extension/chat --parallel=1 --coverage=false --maxWorkers=2`: passed, 245 suites, 4,419 tests passed and 2 skipped.
- `NX_NO_CLOUD=true npx nx lint @ptah-extension/chat-ui --parallel=1`: passed, 0 errors and 7 warnings.
- `NX_NO_CLOUD=true npx nx lint @ptah-extension/chat --parallel=1`: passed, 0 errors and 65 warnings.

The scoped `ptah_get_diagnostics` call returned unavailable after its TypeScript timeout; both project typechecks succeeded afterward. Both Jest runs reported a worker shutdown warning despite passing. The separate dark/light screenshot review belongs to the orchestrator per the approved plan and was not done in this batch.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Sanitize cache in `injectSessionStatsSource` and pass it as nullable inspector input. | Sanitize at source; sanitize within tile. | The source already selects the scoped tab or active ChatStore snapshot, while `parseSessionStatsCache` is exported from `@ptah-extension/shared`. This preserves existing selection and accounting. | Yes. |
| Keep the clock root-provided and acquire it only while a cache tile is mounted. | Per-tile interval; shared ref-counted service. | Batch 2 explicitly requires one interval and a ref-counted visibility listener. | Yes. |
| Place cache in a two-column SESSION grid tile. | One-column tile; two-column tile. | The existing Context and Model tiles span both columns; the countdown and explanatory idle line need the same narrow-width space. | Yes. |
