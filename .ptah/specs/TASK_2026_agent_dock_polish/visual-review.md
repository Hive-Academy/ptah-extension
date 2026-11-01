# Visual Review - TASK_2026_agent_dock_polish

## Summary

| Metric            | Value                                         |
| ----------------- | --------------------------------------------- |
| Overall score     | 8/10                                          |
| Assessment        | APPROVED                                      |
| Visual breaking   | 0                                             |
| Serious           | 0                                             |
| Moderate          | 2                                             |
| Viewports tested  | 1 (Electron window 1201x801, dock width 746px) |
| Components tested | canvas-lane-tabs dock, agent-dock-menu        |

## Environment

- Real Electron app, built bundle `dist/apps/ptah-electron/main.mjs` of the `agent-dock-polish` worktree (already built, not rebuilt by me). Playwright `_electron` via `launchPtah`, `--force-prefers-no-reduced-motion`, isolated profile and DB.
- No real provider: agents were created by pushing `chat:chunk` events (`tool_start` Task + `agent_start`, then `agent_status pending` for queued, `agent_completed` with `completed`/`failed`/`stopped`) and a `permission:request` with `agentToolCallId` for waiting. All six states (running, waiting, failed, queued, done, stopped) were produced.
- Script `%TEMP%\ptah-visual-test\dock\dock.spec.ts`; screenshots and `results.json` in `%TEMP%\ptah-visual-test\dock\shots\`.
- Themes: dark `ptah-glass`, light `ptah-glass-light`. I also swapped `data-theme` to `anubis` / `anubis-light`, but `data-glass` stayed `on`, so those are not true non-glass renders.
- Scenarios: A = small roster (Orchestrator + running + done + stopped), B = large roster (Orchestrator + 10 agents: 2 running, waiting, failed, 2 queued, 2 done, 2 stopped).

## Check results

| Check | Result | Evidence |
|-------|--------|----------|
| More top padding on the dock | PASS | Computed `padding-top` 4px, `padding-bottom` 2px (was `py-0.5` = 2px top; diff: `pt-1` + `pb-0.5`). Dock height 34.7px. Shots `A_small_dark.png`, `B_large_dark.png`. |
| Left-to-right gradient background | PASS | Computed `background-image: linear-gradient(to right, oklch(... / 0.07), rgba(0,0,0,0) 80%)`. Tint colour follows the theme (light tint on dark, dark tint on light). The 7% alpha is subtle: visible but faint in `B_large_dark.png` / `B_large_light.png`. |
| Finished agents (done/stopped) move into the dropdown | PASS | A: inline tabs = Orchestrator + alpha-run only; trigger "2 more agents"; bravo-done and charlie-stopped are only in the menu. B: inline = Orchestrator, alpha(running), delta(failed), echo(queued), foxtrot(running), india(waiting), juliet(queued); trigger "4 more agents"; golf-done, hotel-stopped (and bravo, charlie) not inline. |
| Dropdown is a flat list ordered running, waiting, failed, queued, done, stopped, no kind headings | PASS | B menu items in order: Orchestrator (running), alpha-run, foxtrot-run (running), india-waiting, delta-failed, echo-queued, juliet-queued, bravo-done, golf-done, charlie-stopped, hotel-stopped. Dock order is kept within a status. No heading rows, only `menuitemradio` entries. Shots `B_large_menu_dark.png`, `B_large_menu_light.png`, `A_small_menu_dark.png`, `A_small_menu_light.png`. |

## Findings by severity

### Moderate and minor

1. Count versus content mismatch. File: `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts` (`triggerLabel` uses `hidden().length`, list uses `orderedAgents()` = all agents). The trigger says "4 more agents" (B) / "2 more agents" (A), but the menu lists 11 / 4 entries, including the Orchestrator and agents already visible inline. Screenshot `B_large_menu_dark.png`. Either list only the hidden ones, or word the label as a total. Possibly intentional ("every agent") but "more" implies only the hidden ones.
2. In `B_large_menu_dark.png` and `B_large_menu_light.png` the last menu row (hotel-stopped) is cut off at the bottom of the scroll area at 11 entries; it needs a scroll. Expected for a scrolling menu, but the cut-off row has no fade or affordance beyond the small arrow.

Minor: gradient is faint (7% alpha, 80% stop) and may be hard to see on some themes; judge in `A_small_light.png`.

## Prototype fidelity

- Approved prototype: none found in the task folder for this change. Fidelity: NOT APPLICABLE.
- Before/after: no base-commit capture was supplied, so no pixel comparison. Padding "before" value taken from `git diff` (`py-0.5` -> `pt-1 pb-0.5`).

## Viewport results

| Screen | Elements | Status | Screenshot |
|--------|----------|--------|------------|
| 1201x801, dock 746px, dark | dock, chips, menu | PASS | `A_small_dark.png`, `B_large_dark.png` |
| 1201x801, light | dock, chips, menu | PASS | `A_small_light.png`, `B_large_light.png` |
| Narrow (<480px), rail variant | not opened | NOT-TESTED | Not requested; the compact count badge and rail variant were not exercised. |

## Component and interaction results

| Component | States tested | Status | Screenshot |
|-----------|---------------|--------|------------|
| Dock chips | running, waiting, failed, queued (unnamed icon chips when roster > 5; named chips when roster <= 5) | PASS | `B_large_dark.png`, `A_small_dark.png` |
| Dock menu | closed, open, dark + light | PASS | `*_menu_*.png` |
| Hover card, keyboard focus freeze, Tab order | not exercised | NOT-TESTED | |

## Design system compliance

Gradient uses the `--bc` token via `oklch(var(--bc) / 0.07)` (source), not a hex value.

## Accessibility audit

Chip `aria-label`s carry name, kind and status (for example "india-waiting, Sub-agent, waiting"); trigger label "N more agents". Contrast and target sizes not measured at runtime.

## Visual performance

Not measured.

## Not produced / not tested

- Non-glass theme render (`data-glass` was `on` for all runs).
- Narrow widths, rail layout, keyboard interaction in the dock (the new focus-freeze logic).

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (all four requested behaviours measured on a real build with all six states; one viewport only).
- Key concern: the "N more agents" label does not match the full list shown in the menu.

## Re-test (correction)

Rebuilt dist (renderer `index.html` mtime 23:36:48Z, after the required 23:35Z). Same harness and scripts as before (`%TEMP%\ptah-visual-test\dock\`), plus a narrow scenario C (window resized to 820 px, dock 366 px).

| Check | Result | Evidence |
|-------|--------|----------|
| Count equals menu rows, 4-agent roster | PASS | Trigger "2 more agents"; menu rows: bravo-done, charlie-stopped (2). |
| Count equals menu rows, 11-agent roster (dock 746 px) | PASS | Trigger "4 more agents"; menu rows: bravo-done, golf-done, charlie-stopped, hotel-stopped (4). |
| No inline agent in the menu | PASS | Inline tabs (Orchestrator, alpha-run, delta-failed, echo-queued, foxtrot-run, india-waiting, juliet-queued) appear in none of the menus; the Orchestrator is no longer listed. |
| Finished agents in the menu | PASS | All done/stopped agents are menu-only in A and B. |
| Order running -> waiting -> failed -> queued -> done -> stopped | PASS | B menu: done, done, stopped, stopped. Scenario C (366 px, inline = Orchestrator, delta-failed, india-waiting): "8 more agents", 8 rows in order alpha-run, foxtrot-run (running), echo-queued, juliet-queued (queued), bravo-done, golf-done (done), charlie-stopped, hotel-stopped (stopped). Mixed statuses confirmed; no kind headings. `C_narrow_menu_dark.png`, `B_large_menu_dark.png`, `A_small_menu_dark.png`. |
| Padding / gradient regression | PASS | padding-top 4 px; `linear-gradient(to right, ... / 0.07, transparent 80%)`. |

Not covered: waiting/failed rows inside the menu (they stayed inline at these widths; ranking against inline-first selection is by design), true non-glass render, keyboard focus-freeze.

The earlier moderate finding (count versus content mismatch) is resolved. Verdict: APPROVE, confidence HIGH for the correction.
