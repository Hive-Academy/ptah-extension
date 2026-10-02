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
