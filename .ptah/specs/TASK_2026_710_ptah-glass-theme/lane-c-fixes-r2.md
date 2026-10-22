# Lane C glass theme fixes, revision 2

## R1 — Component fills after utility overrides

- `apps/ptah-extension-webview/src/styles.css:3094-3154`: Reasserted the input/select/textarea, button, card, menu, badge, alert, and overlay backgrounds after the unlayered `bg-*` overrides. The form rule restores the new-session input fill. The menu rule excludes dropdown overlays, and explicit surface roles retain their own fills. Disabled, outline, hover, semantic badge, and semantic alert states retain their recipes.
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:117-119`: Gave the VS Code navbar the `bar` role.
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:271-276`: Gave the new-session popover the `overlay` role, which uses the denser overlay fill instead of the `bg-base-200` tile fill.

Same-element component and plain `bg-base-100`, `bg-base-200`, `bg-base-300`, `bg-surface-0`, or `bg-surface-1` utility combinations found by the webview source scan (line numbers are the source elements, not new edits):

| Recipe | Elements found |
| --- | --- |
| Input/select | `canvas/orchestra-canvas.component.ts:132`, `canvas/canvas-rail/canvas-rail-card.component.ts:297`, `chat/components/templates/app-shell.component.html:285`, `chat/settings/providers/decision-model-key-field.component.ts:20-21`, `chat/settings/providers/providers-settings.component.ts:235`, `chat/settings/providers/provider-setup-wizard.component.ts:449,530,679,798,826,859,887,920,947`, `chat/settings/providers/provider-consumer-assignments.component.ts:429`, `chat/settings/providers/main-agent-reassign-popover.component.ts:27`, `ui/native/provider-model-picker/provider-model-search-field.component.ts:93`, `ui/native/provider-model-picker/provider-model-picker.component.ts:203,248,353`, `chat/components/molecules/previous-sessions-toolbar/previous-sessions-toolbar.component.ts:69,151,166`, `chat/components/molecules/session-list-row/session-list-row.component.ts:161`, `chat/components/molecules/session-filter-bar/session-filter-bar.component.ts:117,231,287,301`. |
| Button | `chat/settings/ptah-ai/orchestration-settings.component.ts:39`, `chat/settings/providers/providers-settings.component.ts:68`, `chat/settings/providers/provider-setup-wizard.component.ts:413,612,653,661,736,765,781,1083,1162,1331`, `tasks-ui/components/bulk/task-bulk-bar.component.ts:171`, `command-center/components/command-center-header.component.ts:23`, `chat/components/molecules/setup-plugins/project-setup-card.component.ts:26-28`. |
| Card | `chat/settings/ptah-ai/web-search-config.component.ts:111`, `voice-config.component.ts:89`, `go-vet-consent-config.component.ts:82`, `chat/settings/pro-features/vscode-lm-config.component.ts:39`, `mcp-port-config.component.ts:53`, `agent-behaviour-section.component.ts:95`, `chat/settings/output-style/output-style-config.component.ts:54`, `chat/settings/license/license-status-card.component.ts:70`, `declarative-dashboard/components/surface-layout.component.ts:166,211`, `dashboard-table.component.ts:34`, `dashboard-list.component.ts:31`, `dashboard-chart.component.ts:19`, `tasks-ui/components/board/task-card.component.ts:142`, `setup-wizard/components/generation-progress.component.ts:67,87,129,182`, `chat-ui/molecules/session/session-cost-summary.component.ts:24`. |
| Badge/alert | `chat/settings/ptah-ai/cli-orchestration-matrix.component.ts:383,391`, `chat/settings/providers/decision-model-row.component.ts:126`, `provider-consumer-assignments.component.ts:143`, `provider-connection-card.component.ts:84`, `chat/components/file-suggestions/file-tag.component.ts:23`, `declarative-dashboard/components/dashboard-alert.component.ts:16,21,26,31`, `command-center/components/command-center-page.component.html:18`. |
| Menu overlay | `tasks-ui/components/filter/task-filter-bar.component.ts:144`, `tasks-ui/components/board/task-card.component.ts:261,598`, `git-ui/open-in/open-in-button.component.ts:108`. |

Paths in the table are relative to `libs/frontend/`. No exact `textarea` or `modal-box` plus plain listed background utility appeared in the same-line scan; the CSS handles them if present. The new-session popover is listed separately above because it has no DaisyUI recipe class.

## R2 — Electron center card and resize gutter

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:111-132,374-381`: Gave the center chat column a `chrome` role and the same radius and clipping as the other shell panes. Replaced the body flex gap with 8px margins between cards. When the Git dock is open, the 6px resize handle has 1px margin on either side, so it occupies one 8px gutter and remains the drag target. All spacing rules are gated on glass.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:22,149,212,349`: Removed the inner canvas board's `chrome` role in Electron; it retains that role in other hosts.

## R3 — Gold accent on first paint

- `apps/ptah-extension-webview/src/index.html:58,97-103`: Added `gold` to the valid stored state accents. A valid state `gold` now blocks a stale localStorage rose/moonstone hint, while only rose and moonstone set `data-accent`.

## R4 — Electron header tab strip

- `apps/ptah-extension-webview/src/styles.css:2507-2531`: Made inactive lifted tabs transparent with no bottom border, styled the selected tab as a rounded glass plate, and removed DaisyUI's active-tab corner pseudo-elements. The original active accent text color remains. DaisyUI's installed `styled.css:4672-4721` identifies the bottom border and the wide `::before` radial-gradient geometry that painted the strip.

## Decisions

- The Electron shell owns the center `chrome` card. The inner canvas board drops that role only in Electron, preserving its existing treatment in VS Code.
- The resize handle remains 6px wide with 1px of clear space on each side; adjacent panes supply the other 8px gutters. Non-glass layout stays flush.
- Verification was static source inspection, installed DaisyUI CSS inspection, screenshot review, and `git diff --check`. Nx, Jest, TypeScript, lint, build, serve, and runtime visual checks were not run under the lane rules. No known R1–R4 implementation item remains undone.

## Files modified in this revision

- `apps/ptah-extension-webview/src/styles.css`
- `apps/ptah-extension-webview/src/index.html`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- `.ptah/specs/TASK_2026_710_ptah-glass-theme/lane-c-fixes-r2.md`
