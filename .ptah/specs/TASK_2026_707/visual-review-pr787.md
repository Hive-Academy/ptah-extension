# PR #787 Electron visual review — TASK_2026_707

## Verdict

**FAIL (6/10): 1 visual-breaking, 0 serious, 2 moderate findings.** Usage and Sessions render from the fresh PR #787 bundle in both themes. The provider marks overlap their labels and the next row in the cost summary at the Electron window's 795 × 735 viewport. The chart controls, focused day readout, Day breakdown, partial-source notice, and an empty range were observed. The score stays above the 3–4 band because those primary interactions work; it stays below the 7–8 band because a central data row visibly overlaps.

## Launch and evidence environment

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard` (PR #787). With `NX_DAEMON=false` and `NX_NO_CLOUD=true`, ran `npx nx build-dev ptah-electron --parallel=1` (**passed**) and then `npx nx copy-renderer-dev ptah-electron --parallel=1` (**passed**; copied the worktree's webview into `dist/apps/ptah-electron/renderer`).
- Launched from that worktree with `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9335 dist/apps/ptah-electron/main.mjs`. Recorded Electron PID **25944**. Connected with `playwright-core` `chromium.connectOverCDP('http://127.0.0.1:9335')` to `file:///D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/dist/apps/ptah-electron/renderer/index.html`.
- Opened Analytics and selected the existing `D:\projects\ptah-final-run-ws` workspace so the Usage RPC could load live data. The default 30 day range loaded $3.82 of recorded raw token cost, Anthropic and Codex provider rows, and a partial-source notice. Switched themes through the app's documented DaisyUI `html[data-theme]` values `anubis` and `anubis-light`. The actual Electron content viewport was **795 × 735**. Captures use viewport screenshots at appropriate positions in the dashboard's internal scroll container (`ptah-dashboard-grid`); the empty card fits and was captured as an element.
- Checked an existing workspace with no facts for the empty-range state, then returned to `ptah-final-run-ws`. Closed only the Electron process started for this review with `taskkill /PID 25944 /T /F`.

## Screenshot table

| File | Theme | Rendered state | Range |
| --- | --- | --- | --- |
| [pr787-usage-dark.png](visual/pr787-usage-dark.png) | Dark | Usage top: cost, partial sources, provider rows, chart | 30d |
| [pr787-usage-light.png](visual/pr787-usage-light.png) | Light | Same loaded Usage top | 30d |
| [pr787-usage-chart-readout-dark.png](visual/pr787-usage-chart-readout-dark.png) | Dark | Focused Oct 13 chart column, per-provider cost readout | 30d |
| [pr787-usage-tokens-light.png](visual/pr787-usage-tokens-light.png) | Light | Tokens toggle and focused Oct 13 token readout | 30d |
| [pr787-breakdown-day-dark.png](visual/pr787-breakdown-day-dark.png) | Dark | Day breakdown and cost-quality panel | 7d |
| [pr787-sessions-dark.png](visual/pr787-sessions-dark.png) | Dark | Sessions tab with nine loaded sessions and aggregate cards | Session range 2 weeks |
| [pr787-usage-empty-dark.png](visual/pr787-usage-empty-dark.png) | Dark | Empty-range message in an existing workspace with no usage | 7d |

## Numbered findings

### 1. Provider marks overlap labels and adjacent rows — Visual breaking

- **Screenshot and viewport:** [dark Usage](visual/pr787-usage-dark.png) and [light Usage](visual/pr787-usage-light.png), 795 × 735. The Anthropic and Codex marks run into their provider names. The second mark reaches into the first row's area.
- **Reproducible measurement:** The provider mark is allocated a 16 × 16 px slot, but its SVG renders at 24 × 24 px inside a 32 × 32 px box. In the live DOM, one icon spans x=293–317 while its provider label begins at x=313, a **4 px text overlap**. The row is 16 px tall with 8 px row gap, while the SVG extends 12 px below the row's top, so adjacent rows can also overlap.
- **Source:** [usage-cost-summary.component.ts](../../../libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-cost-summary.component.ts) lines 71–83 sets `ptah-provider-mark` to `h-4 w-4` but does not constrain the primitive's larger internal box.
- **Impact:** Provider identity text is harder to read in the primary cost comparison, in both themes.
- **Fix direction:** Size the primitive's internal mark to the slot or give the row a large enough mark box and row height, then recheck label and row rectangles.

### 2. Usage is repeated as adjacent headings — Moderate

- **Screenshot and viewport:** [dark Usage](visual/pr787-usage-dark.png) and [light Usage](visual/pr787-usage-light.png), 795 × 735. The card opens with “Usage” in its header, then repeats “Usage” on the next line before the date/range controls.
- **Source:** [analytics-card.component.html](../../../libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html) lines 6–9 and [usage-dashboard.component.html](../../../libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html) lines 3–8 each render an `h3` for this tab.
- **Impact:** The duplicate heading consumes vertical space and weakens the title/date hierarchy in a short Electron window.
- **Fix direction:** Use the outer card heading once; put the date span beside or under that heading and keep range controls in the content row.

### 3. Chart axis labels are very small — Moderate

- **Screenshot and viewport:** [dark chart readout](visual/pr787-usage-chart-readout-dark.png) and [light Tokens chart](visual/pr787-usage-tokens-light.png), 795 × 735. Axis dates and values are visibly harder to read than the adjacent 12 px readout.
- **Source:** [stacked-area-chart.component.html](../../../libs/frontend/dashboard/src/lib/components/usage-dashboard/stacked-area-chart.component.html) lines 67–75 and 119–128 set both axes to `text-[9px] opacity-60`.
- **Impact:** A user must rely on the day focus readout for exact values; even the axis context is difficult at the app's actual window size.
- **Fix direction:** Raise the axis label size and adjust label density or plot padding to retain fit.

## Behavior and coverage

| Check | Observed result | Evidence |
| --- | --- | --- |
| Cost chart day focus | Focusing Oct 13 displayed “Oct 13 — $2.4”, Anthropic $2.3, Codex $0.1; the focused column had a visible outline | [readout screenshot](visual/pr787-usage-chart-readout-dark.png), SVG focusable columns in [stacked-area-chart.component.html](../../../libs/frontend/dashboard/src/lib/components/usage-dashboard/stacked-area-chart.component.html) lines 131–147 |
| Tokens toggle | Selecting Tokens changed the focused readout to 2.6M total, Anthropic 2.4M, Codex 189.9K | [Tokens screenshot](visual/pr787-usage-tokens-light.png) |
| Day breakdown | Model/Day control switched to seven Day rows; Oct 16 and 17 showed $1.20 and $0.25 with shares 82.9% and 17.1%; zero-usage days showed em dashes for cost/share | [Day screenshot](visual/pr787-breakdown-day-dark.png) |
| Cost-quality and partial sources | 7d panel showed 0% provider reported, 100% model priced, 0% unpriced; 30d top showed “partial” plus Codex, Antigravity and Ollama Cloud source notes | [Day screenshot](visual/pr787-breakdown-day-dark.png), [dark Usage](visual/pr787-usage-dark.png) |
| Sessions tab | Switched successfully; nine sessions, aggregate cards and session cards rendered | [Sessions screenshot](visual/pr787-sessions-dark.png) |
| Empty range | An existing workspace with no usage showed “No usage in this range. Start a chat to see provider usage, tokens and cost.” | [empty screenshot](visual/pr787-usage-empty-dark.png) |
| Contrast | Computed muted source-note text versus its surface measured **5.71:1 dark** and **5.48:1 light**; main total measured **14.03:1 dark** and **14.44:1 light**. These sampled text pairs exceed 4.5:1. | [dark Usage](visual/pr787-usage-dark.png), [light Usage](visual/pr787-usage-light.png) |

The chart and Day table stayed within the 647 px content width at this opened viewport; the provider mark overflow above is the observed clipping/overlap. No additional viewport or browser was opened, so responsive and cross-browser behavior remain unverified. The live workspaces sampled contained **zero unpriced facts**; the “at least” total and “Share of known cost” branch did not render, and their wording and layout are **not visually verified**. This report makes no pass claim for that state. A fresh load did show partial-source notices, and the empty and populated states were both captured. No approved prototype was present in the task folder for a prototype comparison.

## Decisions

1. **Use an existing workspace with live facts.** Options: review the initial no-workspace error, or select a workspace the app already lists. The Usage RPC required an open workspace; selecting `ptah-final-run-ws` produced a real populated dashboard without modifying source or data. Reversible: yes.
2. **Capture viewport positions within the internal scroll container.** Options: element screenshot of the 1145 px analytics card, or viewport screenshots after scrolling `ptah-dashboard-grid`. The tall element capture clipped and included blank areas; viewport captures show the actual 795 × 735 Electron rendering. Reversible: yes.
3. **Use 30d for chart comparisons and 7d for the Day table.** The 30d view had two providers and a focused day with both values; 7d displayed the full Day table and quality panel in one viewport screenshot. Reversible: yes.
4. **Leave unpriced/lower-bound visual fidelity unscored.** The sampled live workspaces had 0% unpriced usage, and injecting facts would cease to be a review of the running app's live state. Reversible: yes when a workspace with unpriced facts is available.
