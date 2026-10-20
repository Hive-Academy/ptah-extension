# Electron visual re-review — TASK_2026_707, round 2

## Verdict

| Surface | Verdict | Score | New findings |
| --- | --- | ---: | ---: |
| Provider accounts & plan limits | **PASS WITH NOTES** | 8/10 | 0 |
| Usage dashboard | **PASS WITH NOTES** | 8/10 | 0 |

The visible round 1 defects are resolved in the freshly built Electron renderer. The score is in the sound 7–8 band: the central layouts and interactions render correctly in both themes, but the live account set exposed only two plan tiles, and only the actual Electron window size was reviewed. This does not warrant a 9–10 exemplary score. No observed defect puts either surface in the 5–6 band.

## Build, launch, and coverage

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard`, branch under review with its uncommitted changes.
- Set `NX_DAEMON=false`, `NX_NO_CLOUD=true`; ran `npx nx build-dev ptah-electron --parallel=1` (**passed**) followed by `npx nx copy-renderer-dev ptah-electron --parallel=1` (**passed**, copied the freshly built webview renderer).
- Launched `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9335 dist/apps/ptah-electron/main.mjs` from the worktree. Recorded PID **31316**. Connected with `playwright-core` `chromium.connectOverCDP('http://127.0.0.1:9335')` to this worktree's `dist/apps/ptah-electron/renderer/index.html` page.
- Reviewed the existing `ptah-final-run-ws` workspace at the Electron content size **797 × 738 CSS px** (captured PNGs have 1.5 device pixel scaling). Set DaisyUI `html[data-theme]` to `anubis` and `anubis-light`. Allowed the Usage data to settle; the 30d total became **$3.82**. The chart and table states used 30d and 7d as indicated below.
- Closed **only PID 31316 and its children** with `taskkill /PID 31316 /T /F`.
- No `prototype/` files were found in this task folder, so comparison is to round 1 and the stated acceptance criteria. Only this Electron window was opened; other widths and browsers remain unverified.

## Screenshots

| Screenshot | Theme | Rendered evidence |
| --- | --- | --- |
| [tiles-dark.png](visual/r2/tiles-dark.png) | Dark | Loaded Claude and Ollama tiles, entire section |
| [tiles-light.png](visual/r2/tiles-light.png) | Light | Same tiles, entire section |
| [usage-dark.png](visual/r2/usage-dark.png) | Dark | Settled 30d Usage header, provider summary, donut, chart |
| [usage-light.png](visual/r2/usage-light.png) | Light | Same settled 30d state |
| [usage-readout-dark.png](visual/r2/usage-readout-dark.png) | Dark | Focused cost day; per-provider readout |
| [usage-tokens-dark.png](visual/r2/usage-tokens-dark.png) | Dark | Tokens chart and focused Oct 13 readout |
| [usage-donut-model-light.png](visual/r2/usage-donut-model-light.png) | Light | Model donut, $3.82 center and value/percent legend |
| [breakdown-day-light.png](visual/r2/breakdown-day-light.png) | Light | 7d Day breakdown with populated and zero days |
| [usage-kpis-light.png](visual/r2/usage-kpis-light.png) | Light | Cache savings and raw-cost multiplier |
| [sessions-light.png](visual/r2/sessions-light.png) | Light | Sessions tab after switching from Usage |

## Round 1 findings rechecked

| Round 1 finding | Result | Evidence |
| --- | --- | --- |
| Plan tiles had unequal row heights | **FIXED in the loaded set** | Both rendered tile sections measured **133.33, 133.33 CSS px**. Each had a **0.67 px border**, **8 px radius**, and no horizontal overflow. [Dark](visual/r2/tiles-dark.png), [light](visual/r2/tiles-light.png). The earlier six-state grid did not load here, so equality across three rows remains unverified. |
| Ollama repeated “No API key configured” | **FIXED** | The Ollama tile contains that phrase **once** and retains **Add key**. [Dark](visual/r2/tiles-dark.png), [light](visual/r2/tiles-light.png). |
| Provider marks overlapped labels and rows | **FIXED** | In the loaded 30d cost rows and Model table, each mark slot is **16 × 16 px** and the actual SVG is **14 × 14 px**, contained within the slot. The provider rows are separate and visually readable in [dark](visual/r2/usage-dark.png) and [light](visual/r2/usage-light.png). |
| Duplicate “Usage” headings | **FIXED** | The Usage card has one `h3` with “Usage”; the nearby Usage control is a tab label. [Dark](visual/r2/usage-dark.png), [light](visual/r2/usage-light.png). |
| Tiny chart axis labels | **FIXED** | Computed SVG axis label font sizes are **11 px**. Cost ticks in the settled 30d screenshot are $0, $1, $2, $3, $4; Tokens ticks are 0, 1M, 2M, 3M, 4M. [Cost](visual/r2/usage-readout-dark.png), [Tokens](visual/r2/usage-tokens-dark.png). |

## Additional acceptance checks

- The tiles show a muted, complete owner qualifier on line 2, a small refresh icon, a single status message, a subtle outer border, and the Ollama action. [Tiles dark](visual/r2/tiles-dark.png), [tiles light](visual/r2/tiles-light.png). No reset text, window chips, or multiple notices were present in the two loaded account states, so wrapping and 3-chip/2-notice limits were not visually exercised.
- The 30d chart uses stacked **rectangular bars**; the DOM had **4 nonzero bar rectangles** and **27 zero-day columns without bars**. Cost and Tokens controls have visible selected styling in [Usage dark](visual/r2/usage-dark.png) and [Tokens](visual/r2/usage-tokens-dark.png). A focused cost day shows a visible outline and per-provider values in [readout](visual/r2/usage-readout-dark.png); Tokens shows Oct 13 total **2.6M**, Anthropic **2.4M**, Codex **189.9K**.
- The new [Model donut](visual/r2/usage-donut-model-light.png) shows **$3.82** in the center and Model legend rows of **$3.72 / 97.4%** and **$0.10 / 2.6%**. The [Provider mode](visual/r2/usage-light.png) is also visible. The 7d [Day breakdown](visual/r2/breakdown-day-light.png) has seven rows, including Oct 16 **$1.20 / 82.9%** and Oct 17 **$0.25 / 17.1%**; zero days show dashes for cost/share.
- [Cache savings](visual/r2/usage-kpis-light.png) shows **$11.05** and “Cost before cache savings: **3.9x raw cost**” for 30d. The [Sessions tab](visual/r2/sessions-light.png) still opens with nine sessions and its aggregate cards.

## New findings

None in the reviewed states. The incomplete account-state and viewport coverage above is residual uncertainty, not an inferred defect.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Use the existing populated `ptah-final-run-ws` workspace | The app opened this workspace with live Usage facts, matching round 1's populated state; no data injection was needed. | Yes |
| Capture the Usage top as a viewport screenshot | Element capture of the tall internally scrolled card clipped the top and bottom. Viewport screenshots show what the actual Electron window displays; individual chart, tile, donut, KPI, and table screenshots preserve readable detail. | Yes |
| Re-capture after data settled | The first RPC state showed a temporary $0.10 lower bound before the settled 30d $3.82 result. Final Usage, donut, and interaction evidence uses the settled data. | Yes |
| Use 7d for the Day table | Its seven visible rows fit the evidence image and exercise zero and populated days; 30d remains the overview and chart range. | Yes |
