# Electron dashboard v2 visual review

## Verdict

**FAIL — 5/10.** Four findings: **0 critical, 0 serious, 3 moderate, 1 minor**. The Usage layout and six compact plan cells are present, and the repair dialog opens, but the requested 1920 breakpoint, keyboard tooltip, and popover action fit are incomplete. This is the 5–6 band because the page remains usable while several explicit behaviors fail; the 7–8 band would require those behaviors to work. It is above the 3–4 band because the chart, tables, plan values, and core actions render without broad breakage.

## Environment and scope

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard`; Electron Chromium renderer served from this worktree's `dist/apps/ptah-electron/renderer/index.html`, CDP port **9335**. Fresh `npx nx build-dev ptah-electron --parallel=1` and `npx nx copy-renderer-dev ptah-electron --parallel=1` both succeeded before launch. No source files were edited.
- Checked Analytics at **1920×1080** and **1440×900** in **dark (`anubis`) and light (`anubis-light`)**; checked Marketplace > Skills & Plugins at 1920 in both themes. CDP emulated CSS viewport sizes inside Electron. Native window chrome and OS resize behavior were not assessed.
- Cold launch: the plan section first stopped showing its loading indicator and displayed two cells at **21.6 seconds** (`visual/v2/cold-load.json`). Additional account cells appeared after that first ready state. The complete six-cell roster was visible on later navigation and in all final detail screenshots; its exact cold completion time was not captured. No cell displayed a timeout status in the final six-cell view. The early two-cell state means the first-ready time is **not** the full-roster load time.
- The page scrolls inside `ptah-dashboard-grid`. Full-page images temporarily expanded the scroll container and restored styles afterward. Expansion changes the 1920 plan grid to four columns by crossing its 1600px container threshold. **Use `detail-limits-*` for the real, unexpanded breakpoint evidence**; the full images document all content, not the exact plan-grid column count.
- No `prototype/` exists in this task folder. Compared the approved written design in `dashboard-v2-investigation.md` (Design proposal) and prior `visual/r3/` captures. The project requires Electron inspection for this pass.
- Stopped only the recorded Electron PID **19204** and its eight direct children. Temporary capture scripts and the PID file were deleted. The command policy rejected `Remove-Item` for two temporary build logs, so `visual-v2-build.log` and `visual-v2-copy.log` remain in the task folder.

## Screenshots

All paths are absolute, under `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/`:

1. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/full-1920x1080-dark.png`
2. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/full-1920x1080-light.png`
3. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/full-1440x900-dark.png`
4. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/full-1440x900-light.png`
5. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-limits-dark.png`
6. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-limits-light.png`
7. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-kpis-dark.png`
8. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-kpis-light.png`
9. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-top5-dark.png`
10. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-top5-light.png`
11. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-partial-dark.png`
12. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-partial-light.png`
13. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-partial-focus-dark.png`
14. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-partial-focus-light.png`
15. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-harness-badge-dark.png`
16. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-harness-badge-light.png`
17. `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/visual/v2/detail-harness-repair-dark.png`

## Findings

1. **Moderate — the live 1920 grid has three columns instead of four.** With the ordinary scroll container, six owners occupy two rows of three at 1920; `detail-limits-dark.png` and `detail-limits-light.png` show the real layout. CDP computed `grid-template-columns: 512px 512px 512px` at 1920 and `352px 352px 352px` at 1440 (`visual/v2/measurements.json`). The four-column rule starts at a **1600px container** in `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:65-69`; the live content width remains below that threshold. This misses the approved four-at-1920 / three-at-1440 arrangement, leaving the second row half empty at 1920.

2. **Moderate — keyboard focus does not reveal the partial-source tooltip.** After keyboard `Shift+Tab` then `Tab` onto the `partial` badge, a visible focus outline appeared in both themes, but the source text remained hidden. The tooltip `::before` opacity was **0** in both themes while the badge was focused (`visual/v2/interaction.json`); see `detail-partial-focus-dark.png` and `detail-partial-focus-light.png`. Source status lines have been moved solely to this tooltip by `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html:43-51`, so sighted keyboard users cannot read them. The badge has an `aria-description` for assistive technology.

3. **Moderate — harness popover actions overflow horizontally.** At 1920 in both themes, scrolling the badge popover to its bottom shows “Move these aside…” and a clipped “Reconcile now” plus a horizontal scrollbar: `detail-harness-badge-dark.png`, `detail-harness-badge-light.png`. The dialog content is **308px client / 322px scroll width**; the Reconcile button's right edge was **1856px**, beyond the popover's **1853px** right edge (`visual/v2/interaction.json`). The fixed `w-80` scroll panel is at `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:101-107`, with the unwrapped action row at `:188-210`. The repair button does open its dialog (`detail-harness-repair-dark.png`), but both actions should remain fully readable without horizontal scrolling.

4. **Minor — one provider cell has a generic name.** The 24% weekly cell reads **“Provider CLI login · 26e8”** in both `detail-limits-*` screenshots. The approved roster calls for a recognizable Grok cell; this label leaves users to infer which account they are viewing from the icon. The tile displays the snapshot-derived `titleName` at `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html:11`; the mapping receives the owner label at `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:1032-1034`. The underlying provider identity for this particular owner was not independently verified, so the finding is the generic visible label rather than an asserted backend mapping error.

## Checks that passed and residual uncertainty

- All final Analytics captures show six cells: Claude, OpenCode CLI login/Go, Antigravity, Provider CLI login, Codex, and Ollama Cloud. The 95% OpenCode monthly state is amber; 24% and 16% weekly states are green. The Go cell shows three mini bars (5-hour/weekly/monthly), and its `resets 14d 13h` matches the primary monthly window's accessible reset text. Codex and the 24% cell also show matching weekly reset text. No cell's measured scroll width exceeded its own client width. Evidence: `detail-limits-*` and `visual/v2/measurements.json`.
- Both themes show one six-value KPI strip, full-width daily chart, side-by-side donut/provider bars and breakdown/Top 5 table, and a provenance row. The Top 5 model is **Opus 5.5**, with five rows. The removed Tribunal, Command Center, and harness cards are absent from the Analytics full-page captures. Evidence: `full-*`, `detail-kpis-*`, `detail-top5-*`; source mounting order in `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html:1-24`.
- The Marketplace popover has one blocked path on this machine and exposes “Move these aside…” beside “Reconcile now”; the repair dialog opened without performing a repair. Evidence: `detail-harness-badge-*`, `detail-harness-repair-dark.png`; conditional controls at `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:172-215`.
- Reviewed the populated 30-day Usage state. Empty Usage, empty Top 5, native window resizing, and other browser engines were not exercised. The early account snapshot and later six-cell state were both observed, but the exact elapsed time to the latter was not recorded.

## Decisions

| Decision | Evidence and alternatives | Reversible |
| --- | --- | --- |
| Use `ptah-final-run-ws` with real data | It was already selected and provided populated usage plus six account cells after loading; another workspace would change the content shape. | Yes |
| Treat unexpanded detail shots as breakpoint evidence | Expansion for full-page images crosses the 1600px container rule; the detail screenshots and computed grid columns agree on the live three-column layout. | Yes |
| Avoid a repair action | Opening the dialog proved the button path; moving blocked files is an outward filesystem change outside a visual review. | Yes |
