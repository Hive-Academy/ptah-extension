# Batch 68 axe sweep (Electron renderer, axe-core, dark + light)

Policy: critical/serious fail; moderate/minor reported. Surfaces audited at rest (pointer parked at 2,2).

| surface | dark | light | rules (blocking) |
|---|---|---|---|
| change-set-card | 0 | 0 | - |
| commit-composer-failure | 0 | 0 | - |
| commit-composer-idle | 0 | 0 | - |
| commit-composer-running | 0 | 0 | - |
| conflict-banner | 0 | 1 | color-contrast |
| history-timeline | 0 | 0 | - |
| review-canvas | 1 | 2 | aria-command-name, color-contrast |
| review-header | 0 | 0 | - |
| review-shell | 0 | 1 | color-contrast |
| spot-editor-editable | 1 | 1 | scrollable-region-focusable |
| spot-editor-readonly | 1 | 1 | scrollable-region-focusable |
| task-view-pr | 1 | 1 | color-contrast |
| task-view-quiet | 1 | 1 | color-contrast |

## After the Batch 68 fixes (orchestrator-recorded; per-surface files rewritten by the re-runs)

| Surface | Before (dark / light) | After (dark / light) |
|---|---|---|
| conflict-banner | 0 / 1 | 0 / 0 |
| review-canvas | 1 / 2 | 0 / 0 |
| review-shell | 0 / 1 | 0 / 0 |
| spot-editor-editable | 1 / 1 | 0 / 0 |
| spot-editor-readonly | 1 / 1 | 0 / 0 |
| task-view-pr | 1 / 1 | 0 / 0 |
| task-view-quiet | 1 / 1 | 0 / 0 |
| review-header, history-timeline, commit-composer ×3 | 0 / 0 | 0 / 0 |
| change-set-card | 0 / 0 | not re-run |

Counts are critical + serious. Known gaps outside the axe rules hit by the fixtures: `pierre-dark` comment tokens
measure 2.9-3.3 (no comment in the fixture), and Pierre's expand buttons are `div role="button"` without a tab stop.
