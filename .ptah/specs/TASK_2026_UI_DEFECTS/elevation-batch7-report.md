# Design elevation — Batch 7 report

## Delivered

Batch 7 completes the remaining high-visibility feature screens and hand-rolled
floating panels in scope. The changes use the Batch 0 `surface-*` contract;
no structural surface is combined with a `bg-base-*` fill. Status colours and
all existing keyboard/focus behaviour remain unchanged.

| Library                | Before → after                                                                                                                                                                                                                                                                                                                                                         | Test IDs / notes                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cron-scheduler-ui`    | `cron-scheduler-tab.component.ts:100-330` raw header, translucent `bg-base-200` stats and job editor → `surface-1` header/editor and `surface-2` statistics; `cron-job-detail-drawer.component.ts:106` prompt inset → `bg-surface-2`.                                                                                                                                  | Added `cron-scheduler-section`; retained `cron-form`, scope, and new-job IDs.                                 |
| `messaging-gateway-ui` | `messaging-gateway-tab.component.ts:70-316` raw/translucent shell → `surface-1` title/config sections and `surface-2` stats/read-only inset; `gateway-platform-pane.component.ts:53-113` configuration cards → `surface-2`; selected platform tile and setup drawer (`gateway-platform-tabs.component.ts:43-47`, `gateway-setup-guide.component.ts:19`) → `surface-3`. | Added `messaging-gateway-section`; retained platform and status IDs. Error status fill remains `bg-error/10`. |
| `workspace-indexing`   | `workspace-indexing.component.html:10` secondary-tinted structural wrapper → `surface-1`.                                                                                                                                                                                                                                                                              | Added `workspace-indexing-section`.                                                                           |
| `notification-center`  | `notification-center.component.ts:65` base fill + shadow panel → `surface-3`.                                                                                                                                                                                                                                                                                          | Retained `notification-center-panel`.                                                                         |
| `git-ui`               | `stash-popover.component.ts:60` base fill + shadow popover → `surface-3`.                                                                                                                                                                                                                                                                                              | Retained `stash-popover`.                                                                                     |
| `canvas`               | `orchestra-canvas.component.ts:86,140,212` dock/popovers and `canvas-layout-controls.component.ts:67,83` control/popup → surface-1/2 control hierarchy and `surface-3` floating panels.                                                                                                                                                                                | Retained `canvas-dock` and existing control test hooks.                                                       |
| `tasks-ui`             | `task-command-palette.component.ts:98` base fill + shadow command palette → `surface-3`.                                                                                                                                                                                                                                                                               | Existing palette behaviour and active-option status fill retained.                                            |

## Specs and verification

All requested focused Jest commands used `--coverage=false --maxWorkers=2`.
All changed projects used `npx nx typecheck <project> --parallel=1`.

| Project                                | Focused Jest result       | Typecheck                                                                                                            |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@ptah-extension/cron-scheduler-ui`    | 1 suite, 3 tests passed   | passed                                                                                                               |
| `@ptah-extension/messaging-gateway-ui` | 2 suites, 47 tests passed | passed                                                                                                               |
| `@ptah-extension/workspace-indexing`   | 1 suite, 25 tests passed  | passed                                                                                                               |
| `@ptah-extension/notification-center`  | 1 suite, 8 tests passed   | passed                                                                                                               |
| `@ptah-extension/git-ui`               | 1 suite, 15 tests passed  | passed                                                                                                               |
| `@ptah-extension/canvas`               | 2 suites, 38 tests passed | passed (existing unrelated Angular optional-chain warning from `chat/.../peer-session-send-dialog.component.ts:181`) |
| `@ptah-extension/tasks-ui`             | 1 suite, 25 tests passed  | passed                                                                                                               |

Nx emitted its existing Cloud free-plan 401 notice during typechecks; no typecheck failed.

## Remaining backlog

The remaining matches are lower-visibility or large multi-step flows. They were
not shallowly edited in this batch:

- `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`
- `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.ts`
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`
- `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts`
- `libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts`
- `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts`
- `libs/frontend/tribunal-panel/src/lib/wizard/step-run.component.ts`
- `libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.ts`
- `libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.ts`
- `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts`
- `libs/frontend/tribunal-panel/src/lib/components/crucible-verdict-panel.component.ts`
- `libs/frontend/git-ui/src/lib/commit/commit-composer.component.ts`
- `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts`
- `libs/frontend/git-ui/src/lib/branch-picker/branch-details-popover.component.ts`
- `libs/frontend/git-ui/src/lib/review-canvas/changed-file-tree.component.ts`
- `libs/frontend/git-ui/src/lib/review-canvas/hunk-toolbar.component.ts`
- `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts`
- `libs/frontend/canvas/src/lib/tile-agent-mini-panel.component.ts`
- `libs/frontend/canvas/src/lib/tile-agent-indicator.component.ts`
- `libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.ts`
- `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/cards/enhanced-prompts-summary-card.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`
