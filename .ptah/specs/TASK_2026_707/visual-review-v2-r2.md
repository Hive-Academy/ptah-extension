# Dashboard v2 Electron visual re-review, round 2

## Verdict

**PASS WITH NOTES — 7/10.** All five previously reported visual defects are fixed in the populated Electron renderer. One **moderate** cold-load finding remains: the first launch stayed at two of six plan cells and a Usage error until manual refresh/retry. Issue counts: **0 visual breaking, 0 serious, 1 moderate, 0 minor**. The complete layout and interactions warrant the 7–8 band; the cold-load failure keeps it below 9–10. It stays above 5–6 because the page recovers through visible controls and all populated-state checks passed.

## Environment and evidence

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard`, uncommitted `feat/usage-dashboard-polish`. Fresh `npx nx build-dev ptah-electron --parallel=1` and `npx nx copy-renderer-dev ptah-electron --parallel=1` both succeeded before Electron launched from this worktree's `dist/apps/ptah-electron/main.mjs` on CDP port 9335.
- The renderer URL was `file:///D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/dist/apps/ptah-electron/renderer/index.html`. The selected workspace was `ptah-final-run-ws`. CDP set the **actual renderer CSS viewport** to 1920×1080 or 1440×900 inside Electron; native OS window bounds were not measured.
- Each Analytics full-page image was stitched from successive viewport screenshots while `ptah-dashboard-grid` scrolled at its ordinary height and width. Its width was never expanded. This preserves the container-query breakpoint. Detail screenshots show the live layout directly.
- No approved `prototype/` exists in this task folder. Compared with the previous review's `visual/v2/` captures and its written findings. Marketplace > Skills & Plugins was checked at 1920 in both themes. No source files were edited.

## Five previous findings

| # | Result | Live measurement and screenshot | Source |
| --- | --- | --- | --- |
| 1. Plan-limit grid | **Fixed** | Six cells; 1920 dark/light: `382.167px` × 4 columns within a 1552.67px grid. 1440 dark/light: `352.219px` × 3 within 1072.67px. No body horizontal overflow. [1920 dark](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-limits-dark.png), [1920 light](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-limits-light.png), [1440 dark](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/full-1440x900-dark.png), [1440 light](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/full-1440x900-light.png). | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:57-77` |
| 2. Partial badge keyboard tooltip | **Fixed** | Focus added `tooltip-open`; the tooltip pseudo-element opacity reached 0.94 dark / 0.64 light at the sampled animation instant and the full source text was visible. `aria-describedby` points to the same source text. [Dark](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-partial-focus-dark.png), [light](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-partial-focus-light.png). | `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html:42-55` |
| 3. Harness badge popover | **Fixed** | At 1920, dark `clientWidth=310, scrollWidth=310`; light `309=309`. After scrolling to the bottom, both “Move these aside…” and “Reconcile now” were wholly inside the 320px dialog rectangle in both themes. [Dark](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-harness-badge-dark.png), [light](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-harness-badge-light.png). | `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:188-210` |
| 4. Grok label | **Fixed** | The populated fourth cell reads “Grok CLI login · 26e8,” with its weekly quota. [1920 dark](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-limits-dark.png), [1440 light](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/full-1440x900-light.png). | `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:98` |
| 5. Daily chart scale | **Fixed** | Axis labels computed `11px` at all four width/theme combinations. SVG chart height was `260px` at 1920 and `220px` at 1440. Focusing the Oct 13 column showed “Oct 13 — $2.4; Anthropic $2.3; Codex $0.099” in both themes. [Dark](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-chart-dark.png), [light](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-chart-light.png). | `libs/frontend/dashboard/src/lib/components/usage-dashboard/stacked-bar-chart.component.html:33-40,127-135` |

## Cold-load timing and new finding

**Moderate — incomplete cold load hides four account cells and Usage data.** On the timed Electron relaunch to Analytics, the first plan cells appeared at **40.5 seconds** (two cells). The roster was still **two of six at 105.8 seconds**, so there is no measured automatic “all cells” time. Usage displayed “Could not load usage data.” A manual tile refresh produced all six cells **24.3 seconds after the click**; “Retry” separately populated Usage. The earlier launch showed the same two-cell/error state, so this was reproduced. [Timed incomplete state](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/cold-incomplete-dark.png); [earlier incomplete state](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/probe.png); [recovered roster](D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-limits-dark.png). The plan-card load is triggered by the provider watcher at `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:207-211`; Usage exposes its retry path at `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html:70-78`. The observed state establishes the failure; the specific backend cause was not diagnosed here. **Impact:** users may believe only two accounts exist and cannot see analytics without manual recovery.

## Other checks and limits

- All four populated Analytics views showed the KPI strip, 30-day chart, cost share, provider bars, breakdown, Top 5, and provenance row. The 1920 grid aligned in four columns; the 1440 grid aligned in three. No body horizontal overflow was measured. Chart focus readout, partial badge focus, and both harness actions were checked in dark and light. Screenshots support the visual alignment and color review; numeric contrast ratios and native window resize behavior remain unmeasured.
- The cold load was observed with this workspace's changing local provider data. The all-cell timing is a **manual recovery time**, not an automatic cold-load completion time. No repair or reconcile action was invoked.
- Source expectations came from `batch-v2-visual-fix.md` and the five prior findings in `visual-review-v2.md`. No approved prototype was available for fidelity comparison.

## Screenshot inventory

All PNG paths are absolute:

1. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/full-1920x1080-dark.png`
2. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/full-1920x1080-light.png`
3. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/full-1440x900-dark.png`
4. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/full-1440x900-light.png`
5. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-limits-dark.png`
6. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-limits-light.png`
7. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-chart-dark.png`
8. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-chart-light.png`
9. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-partial-focus-dark.png`
10. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-partial-focus-light.png`
11. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-harness-badge-dark.png`
12. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/detail-harness-badge-light.png`
13. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/cold-incomplete-dark.png`
14. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2r2/probe.png`

## Cleanup

Only the recorded Electron process trees were stopped: root PIDs 33776, 23424 and 33200 with their descendants. Temporary `.cjs` capture scripts were removed. The shell policy rejected cleanup of `visual-v2r2-build.log`, `visual-v2r2-copy.log`, and `visual/v2r2/probe.png`; the two logs and listed probe image remain. The logs are build artifacts for this review, not source changes.

## Decisions

| Decision | Evidence and alternatives | Reversible |
| --- | --- | --- |
| Use CSS viewport emulation inside Electron for the width sweep | Electron's CDP endpoint did not expose `Browser.getWindowForTarget`; computed `innerWidth/innerHeight` matched each target, and the scroll container stayed at ordinary width. Native window bounds were not represented as tested. | Yes |
| Count cold loading as a moderate new finding | Two cells and Usage error persisted to 105.8 seconds, while manual controls recovered the page. Treating the later recovered view as automatic cold completion would misstate the observed behavior. | Yes |
| Leave harness repair untouched | The visual task authorized inspecting the popover and its actions, while repair would move user files. | Yes |
