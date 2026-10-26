# Visual re-check - TASK_2026_719_4f64 (D1 and D3)

Verdict: APPROVED (D1 and D3 fixed). One new Moderate observation (N1), no Serious or Breaking.

## Environment

- Electron only. Worktree `claude-named-accounts`, uncommitted tree on HEAD ebfddbfd6 (includes the D1/D3 fixes).
- Rebuilt: `NX_DAEMON=false node scripts/verify.mjs --exec --task visual-recheck-build -- npx nx build ptah-electron` (EXIT 0, log `screenshots/build-recheck.log`), then `apps/ptah-electron/scripts/copy-renderer.js`. The first attempt was killed by my own background timeout while queued; the second one ran. `dist/.../main.mjs` 04:16, `renderer/index.html` 04:22.
- Harness: `screenshots/recheck-capture.mjs` (copy of `capture.mjs`; lane scene now selects each lane tab and measures `ptah-execution-header`; adds a codex lane). Playwright `_electron.launch`, PTAH_E2E=1, temp user-data-dir and PTAH_DB_PATH, faked RPC, no real sign-in or Claude process.
- Window 1400x900, themes `ptah-glass` (dark) and `ptah-glass-light` (light). Audit selection, not a support contract.
- Screenshots use the `recheck-` prefix in `screenshots/`. Data: `recheck-d1-all.json`, `recheck-s5-geometry.json`, `recheck-s2-measure.json`.

## D1: lane account badge on the flat lane surface - FIXED

The flat lane view is reached by clicking a lane tab (`[role=tablist][aria-label=Lanes] [role=tab]`). Selector `ptah-execution-header [data-test="execution-header-row"] [data-testid="lane-account"]`. The badge now renders. Pass/fail per lane (dark and light the same text):

| Lane | Rendered text | `title` | Badge width | Result |
| --- | --- | --- | --- | --- |
| named (Work) | "Account: Work" | "Account: Work" | 79.9px | pass |
| long label (56 chars) | "Account: Client Acme Corp pr..." (truncated) | full "Account: Client Acme Corp production research team shared account" | 160px = max-width 160px = 10rem (root 16px); inner `scrollWidth` > `clientWidth`, `truncated: true` | pass |
| default | "Default" | "Default" | 44px | pass |
| removed profile | "Removed account" | "Removed account" | 95px | pass |
| codex (non-Claude) | no badge (`lane-account` absent) | - | - | pass |

- No profile id (`acct_`) appears in any header text (`hasProfileId: false` in all six lanes, both themes).
- Screenshots: `recheck-d1-header-tab1-dark.png`, `-tab1-light`, `-tab2-dark/light` (long), `-tab3-*` (default), `-tab4-*` (removed), `-tab5-*` (codex, no badge); full window `recheck-d1-tab{0..5}-{dark,light}.png`.
- Card presentation (`ptah-agent-card-header`) count is 0 on this surface, so it is still not reachable in Electron. It is covered by unit tests only (see Not checked).
- Contrast (measured from pixels, the DOM colour chain is unreliable here because of alpha layers): dark badge text about 14.4-15.1:1 on rgb(22,25,29); light about 11.6-14.5:1 on rgb(246,243,253). Passes AA 4.5:1. Text is 10px (guidance only, same as the existing card badge; Minor).
- Focus: the badge is a non-interactive span (no tabindex), so it adds no tab stop. Not tab-walked in this run; the neighbouring Details button is unchanged in size (62.5x24).
- Layout shift: with the Details panel toggled on the named lane, badge x/y/w/h are identical before and after (750,182,79.9x16) and the header row stays 35px (`recheck-d1-details-open-dark.png`, `recheck-d1-all.json` `shift`).

### N1 (Moderate, new): header row wraps for long and "Removed account" badges

The header row in a 560px-wide lane header is 35px for named, default and codex lanes, but 63px for the long-label lane and the "Removed account" lane (`recheck-d1-all.json` `row.h`). In the long-label case the Details toggle moves to a second line (Details at y=209); in the removed case the small red stop square drops to the second line. See `recheck-d1-header-tab2-dark.png` and `recheck-d1-header-tab4-dark.png`. Not a shift within one lane (stable per lane), nothing clipped or overlapping, so it is not Serious. Possible fix: `flex-nowrap` on the row or a smaller cap on the flat header badge, at the owner's discretion. Selector: `ptah-execution-header [data-test="execution-header-row"]`. The `execution-header-meta` selector matched nothing in the measured DOM (`meta: null`), so I could not measure the meta text itself.

## D3: session row account label cap - FIXED

`recheck-s5-geometry.json`, selector `[data-testid="session-row-meta"] [data-testid="session-row-account"]`:

- Long label: width 160px (max-width 160px = 10rem), `scrollWidth` 362, `truncated: true`, shown as "Account: Client Acme Corp ..." (`recheck-s5-session-list-light.png`, `-dark.png`). `title` is the full "Account: Client Acme Corp production research team shared account".
- Other rows: "Account: Work" 76.9px, "Default" 37.4px, "Removed account", none truncated, row height 52px unchanged (it was 52px before), no overflow of the meta line.
- Colour `oklch(0.90 0.007 268)` in dark, readable in light in the screenshot.

## Regression look (screens 1 to 3)

- Drawer pending copy: `recheck-s1-access-text.txt` is identical to `after-s1-access-text.txt`; screenshots `recheck-s1-drawer-pending-{dark,light}.png` unchanged in layout.
- Fallback block: `recheck-s2-access-text.txt` identical to the earlier capture; Copy 59.4x32 and Check status 94.1x32 px, no horizontal overflow in the drawer or script, "Script copied." status present (`recheck-s2-measure.json`; `recheck-s2-drawer-fallback-*`, focus shots present).
- Accounts section: `recheck-accounts-section-text.txt` identical to `after-accounts-section-text.txt`; `routing-held` count 0.
- D2 (profile id in the Accounts section) is unchanged and was out of scope.

## Not checked

- Card presentation badge in Electron (`ptah-agent-card-header` never renders on this surface); unit-tested only.
- Full Tab-key walk of the new header, hover/active states, narrow (about 400px) widths, reduced motion, Performance-API layout shift.
- Real RPC data: everything is mocked.
- VS Code and TUI hosts (out of scope).

## Verdict

APPROVED. Confidence: HIGH for D1 and D3 and the regression screens; MEDIUM for focus and layout of N1 (single window width 1400px).
