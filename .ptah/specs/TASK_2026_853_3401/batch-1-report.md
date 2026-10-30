# Batch 1 report: display-panel missing-artifact text and Retry

## Files changed

- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts`
  - New output `retryArtifacts = output<void>()`.
  - The missing-artifact notice (selected `artifact:<id>` not in `artifacts`) now reads
    "This artifact is not available. It may have been deleted, or the list did not load." with a
    `type="button"` Retry that emits `retryArtifacts`.
  - One `<ng-template #missingNotice>` rendered by `NgTemplateOutlet` in both branches (empty strip and
    non-empty body), so both branches share markup, `role="alert"` and the testid
    `display-panel-artifact-missing` (the empty branch used the viewer's testid `artifact-viewer-error` before).
  - Doc comment updated. No change to `missingArtifact`, `activeKey`, the one-live-viewer rule, or the
    artifact viewer / sandbox / bridge (TASK_2026_710 preserved).
- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.spec.ts`
  - Tightened "shows an error for an artifact absent from this tab": exactly one alert, new text, old text
    gone, no iframe.
  - New: Retry emits `retryArtifacts` once and emits no selection change.
  - New: with other items present, one notice, no selected tab, no visible tabpanel, no iframe.
  - New: the notice goes away once the selected artifact arrives in `artifacts`; its tab is selected and one viewer mounts.
  - New: axe has no violations with the notice (same rule set as the existing axe case).

## Decisions

- Reused one template through `NgTemplateOutlet` instead of two copies of the markup. Options: duplicate
  markup or move the notice above the strip. Evidence: `NgTemplateOutlet` is already used in chat-ui
  (`plan-limit-tile.component.ts`). Reversible.
- The "viewer 404" half of plan A.4 is not in this file. `ArtifactViewerComponent` already shows its own
  alert and Retry on load failure (`artifact-viewer.component.ts:94-102`). That file is outside batch 1, so it was not changed.

## Wiring needed by other batches

- Hosts of `<ptah-display-panel>` (display sheet in batch 11, `command-rail-display.component.ts` in batch 2,
  the detached window in batch 9) bind `(retryArtifacts)` to `ArtifactStore.reload(tabId)`.

## Verification

- `npm run verify -- -p @ptah-extension/chat-ui`: `3 tasks: 2 succeeded, 1 failed` (lint and typecheck
  passed; test failed).
- The test failure: `Test Suites: 12 failed, 88 passed, 100 total` / `Tests: 1371 passed, 1371 total`.
  All 12 failing suites fail to run with `Could not locate module marked mapped as:
  <worktree>\node_modules\marked\lib\marked.umd.js`. This worktree has no `node_modules`; `marked` exists only in
  the main checkout. This is an environment issue that this change did not cause, and every test that ran passed.
- `npm run verify -- -t test -p @ptah-extension/chat-ui -- --testPathPatterns=display-panel.component`:
  `Test Suites: 1 passed, 1 total` / `Tests: 25 passed, 25 total`.
- `ptah_get_diagnostics` on both files: no diagnostics.
