# Electron visual review — TASK_2026_707

## Summary

| PR | Verdict | Score | Visual breaking | Serious | Moderate | Coverage |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| #784 plan-limit tiles | **FAIL** | 5/10 | 0 | 2 | 0 | Rendered Electron section, dark and light, 795 × 735 window; six live account tiles |
| #787 usage dashboard | **FAIL — build blocked** | Not scored | — | — | — | No rendered review; fresh Electron build failed |

PR #784's tiles are compact, but the rows are visibly different heights and the Ollama empty state repeats the same message. Those are direct misses against the requested uniform tiles and notices without duplicate text. The score is above the 3–4 band because the six tiles remain contained and the section is usable; it is below the 7–8 band because both defects are in the feature's central acceptance criteria. PR #787 receives no visual score because no fresh bundle could be launched.

## Environment and launch commands

- PR #784 worktree: `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles`.
- With `NX_DAEMON=false` and `NX_NO_CLOUD=true`, `npx nx build-dev ptah-electron --parallel=1` **passed**, then `npx nx copy-renderer-dev ptah-electron --parallel=1` **passed** and copied that worktree's webview renderer into `dist/apps/ptah-electron/renderer`.
- Launched from that worktree with `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9335 dist/apps/ptah-electron/main.mjs`; Electron PID **36848**. Connected through `playwright-core` `chromium.connectOverCDP('http://127.0.0.1:9335')` to the app's `file:///D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/dist/apps/ptah-electron/renderer/index.html`. Opened Analytics, waited for six tiles, then set the documented DaisyUI `html[data-theme]` to `anubis` and `anubis-light`. Captured the full plan-limits section. Closed **only PID 36848 and its children** with `taskkill /PID 36848 /T /F`.
- PR #787 worktree: `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard`. With the same Nx environment, `npx nx build-dev ptah-electron --parallel=1` **failed** during `ptah-electron:build-main:development`: `libs/backend/rpc-handlers/src/lib/handlers/analytics-rpc.handlers.ts:17:39: ERROR: Could not resolve "@ptah-extension/usage-analytics"`. The import is at [analytics-rpc.handlers.ts](../../../libs/backend/rpc-handlers/src/lib/handlers/analytics-rpc.handlers.ts) line 17; `tsconfig.base.json` line 26 declares the alias. `copy-renderer-dev` and Electron launch were not run for PR #787. Any pre-existing renderer would be stale evidence.

## Screenshots

| File | PR | Theme | State | Evidence |
| --- | --- | --- | --- | --- |
| [pr784-tiles-dark.png](visual/pr784-tiles-dark.png) | #784 | Anubis dark | Six loaded account tiles; plan bar, unavailable, and missing-key states | Full section at 795 × 735 Electron viewport |
| [pr784-tiles-light.png](visual/pr784-tiles-light.png) | #784 | Anubis light | Same six loaded tiles | Full section at 795 × 735 Electron viewport |

## Findings

### 1. Tile rows have visibly different heights — Serious

- **Evidence:** [dark](visual/pr784-tiles-dark.png), [light](visual/pr784-tiles-light.png), 795 × 735. Playwright measured the six tile heights in grid order as **128, 128, 102, 102, 112, 112 px**. The first row is 26 px taller than the second (about 25%).
- **Cause:** [provider-account-card.component.ts](../../../../plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts) lines 62–70 use a grid with `align-items: stretch`, which equalizes tiles **within** each row but does not give rows a common height. The source comment at lines 55–57 claims all rows are equal height.
- **Impact:** The tile field changes vertical position by row and the section reads as uneven, contrary to the requested uniform tile grid.
- **Suggested fix:** Apply one compact row height or a shared minimum to all tile cells, and verify that the longest live content still fits without clipping.

### 2. Ollama's missing-key message is repeated — Serious

- **Evidence:** [dark](visual/pr784-tiles-dark.png), [light](visual/pr784-tiles-light.png), 795 × 735. The Ollama Cloud tile shows “No API key configured” in both the full-width status pill and the bottom status line before “Add key.” The captured tile text contains that exact phrase twice.
- **Cause:** [provider-account-tile.component.html](../../../../plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html) lines 73–85 render `statusPill`; lines 123–151 also render `statusChip` and `action` without suppressing a repeated message. The view model supplies both for this state.
- **Impact:** The one useful next action is crowded by redundant state copy, contrary to the requested single notice.
- **Suggested fix:** Let the missing-key pill carry the reason and keep only the “Add key” action in the footer, or deduplicate the two status strings in the view model.

## Viewport, state, and interaction coverage

| Surface | Opened state | Result | Screenshot |
| --- | --- | --- | --- |
| #784 plan-limits section | 795 × 735, dark and light; six live owner tiles | Two serious findings; no tile container overflow reported by `scrollWidth > clientWidth` for the six tile elements | Both #784 screenshots |
| #784 account data shapes | OpenCode and Codex quota bars; Claude and Provider CLI unsupported; Antigravity unavailable; Ollama missing key | Present in both themes | Both #784 screenshots |
| #787 Usage and Sessions tabs | None | Blocked by fresh build failure | None |

The screenshots are of the complete plan-limits section; the app's internal scroll layout prevents a page-level `fullPage` image from proving that section, so the section element itself was captured. The screenshot viewport is the Electron window's actual 795 × 735 content size. No other viewport or browser was opened, so no broader responsive or cross-browser pass is claimed. No prototype was present in this task folder; the comparison target was the task's stated compact, uniform tiles and notice behavior. No baseline build from before either PR was established.

For PR #784, refresh buttons, the “Add key” action, keyboard focus, contrast ratios, and loading transitions were not exercised. For PR #787, cost summary, KPI strip, chart Cost/Tokens toggle, day hover/focus readout, Model/Day breakdown, cost-quality and unpriced states, Sessions tab, overflow, and both themes remain unreviewed. No accessibility or visual performance verdict is inferred for those states.

## Decisions

1. **Use the live Electron account data and the actual 795 × 735 content window.** Options were live accounts or injected fixture data. The running app exposed six distinct owners with quota, unavailable, and missing-key states, so live data gave reproducible evidence without changing source or RPC responses. Reversible: yes.
2. **Capture the plan-limits section element in both themes.** Options were a viewport screenshot or a section screenshot. The section reaches the bottom of the internal scroll viewport, and the section capture includes all six tiles. Reversible: yes.
3. **Stop PR #787 visual testing after its build failure.** Options were reviewing a pre-existing renderer or requiring the current branch's successful build. The failing main bundle prevents confirming that a renderer represents this PR. Reversible: yes, after the build is repaired.

## Verdict

- **PR #784: FAIL / needs revision.** Two serious visual defects at the only Electron viewport tested; confidence **medium** because the findings are screenshot-backed but responsive and interaction states remain untested.
- **PR #787: FAIL / unreviewable.** Fix the unresolved `@ptah-extension/usage-analytics` Electron main build, then repeat the requested dark/light Usage and Sessions review against a fresh bundle. No visual issue is asserted for PR #787.
