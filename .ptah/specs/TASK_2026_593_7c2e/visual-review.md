# Electron attention UI visual review — TASK_2026_593

| Metric | Result |
| --- | --- |
| Verdict | **REVISE** |
| Score | **5/10** |
| Defects | 0 visual breaking; 1 serious; 1 moderate |
| Real app viewport reviewed | 1440 × 900, dark and light |
| Real app screenshots | 4 |
| Confidence | Low for notification states; high for the empty panel |

The score reflects a clear structural mismatch in the empty panel and a measurable width difference. The rest of the requested attention states remain unverified; the evidence does not support a higher, broad approval or a lower conclusion about states that were never rendered.

## Evidence and comparison

The approved reference is `prototype/notifications.html` and its PNGs, with expected 348px snackbar and 340px panel widths stated in `prototype/README.md`. I opened each real screenshot and its matching prototype PNG. The real application used a fresh isolated profile with no workspace, so the surrounding welcome screen differs from the prototype's chat board; comparisons below concern the notification panel itself.

| State | Theme | Real screenshot | Prototype ref | Match? | Differences |
| --- | --- | --- | --- | --- | --- |
| Welcome baseline, panel closed | dark | [dark-baseline.png](visual-check/dark-baseline.png) | [dark-panel-empty.png](prototype/screenshots/dark-panel-empty.png) | Partial | Bell placement visible; prototype has chat board and the real isolated profile shows the welcome screen. |
| Empty panel | dark | [dark-panel-empty.png](visual-check/dark-panel-empty.png) | [dark-panel-empty.png](prototype/screenshots/dark-panel-empty.png) | **No** | Real panel is 320px wide and 206px high; prototype is approximately 340px wide and 256px high. Real panel retains separate empty Needs you and Recent notices sections; prototype centers an All clear state. |
| Welcome baseline, panel closed | light | [light-baseline.png](visual-check/light-baseline.png) | [light-panel-empty.png](prototype/screenshots/light-panel-empty.png) | Partial | Bell placement visible; background content differs because the isolated profile has no workspace. |
| Empty panel | light | [light-panel-empty.png](visual-check/light-panel-empty.png) | [light-panel-empty.png](prototype/screenshots/light-panel-empty.png) | **No** | Same panel structure and width difference; real disabled Clear all sits in the Recent notices section while prototype places Clear all notices in the header. |

## Defects

1. **Serious — Empty panel diverges from the approved empty state.** At 1440 × 900 in both themes, the prototype presents one centered All clear state and a header Clear all notices control. The real panel instead shows two empty section messages with a disabled Clear all beside Recent notices. This changes the panel's hierarchy and makes the empty state feel like two separate lists. Source: `libs/frontend/notification-center/src/lib/notification-center.component.ts:43-92`; screenshots: [dark real](visual-check/dark-panel-empty.png), [dark prototype](prototype/screenshots/dark-panel-empty.png), [light real](visual-check/light-panel-empty.png), [light prototype](prototype/screenshots/light-panel-empty.png).
2. **Moderate — Panel is 20px narrower than the approved reference.** Real bounding box is x=1106–1426, width 320px at 1440 × 900 in both themes; the prototype specifies 340px. The difference reduces room for request rows, though populated rows could not be inspected. Cause: `libs/frontend/notification-center/src/lib/notification-center.component.ts:40` (`w-80`). Evidence: the same dark and light empty-panel screenshots and `visual-check/capture-results.json`.

## Automatic checks

The capture script checked the two open empty panels at 1440 × 900. Both had `documentElement.scrollWidth <= innerWidth`, and `data-theme` was `anubis` and `anubis-light` respectively. Computed panel text contrast, sampled through canvas to convert computed OKLCH colors to sRGB, ranged from **5.07:1 to 14.86:1** in dark and **5.06:1 to 15.92:1** in light; both exceed 4.5:1. Escape closed the panel and returned focus to the bell in both themes. The measured panel box was 320 × 206px in both themes. Results: [capture-results.json](visual-check/capture-results.json).

Snackbar/composer and snackbar/tab collision checks were coded in [shoot.cjs](visual-check/shoot.cjs), but could not establish a pass: the isolated welcome screen has neither a composer nor a tab bar, and no notification card was rendered. No horizontal-overflow claim is made for the unvisited 800px viewport.

## States not produced

Permission snackbar, question snackbar, lane permission snackbar, five-request stack and `+N more`, failure snackbar, bell badge, populated Needs you/Recent panel, git warning, and 800 × 700 stack in both themes were **not captured**. The fresh profile had no live agent or git events. The production renderer exposes `__ngContext__` only as a numeric ID and has no `window.ng` API; the script's read-only component lookup therefore could not obtain `NotificationService` to inject test items. No production files were changed to add a hook. These are coverage limits, not reported visual defects. The 348px snackbar width, action buttons, provider/tool context, and Clear all behavior with notices remain unverified in the real app.

## Launch and cleanup

Ran the single authorized `npx nx build ptah-electron --parallel=1` (about 3m 7s). Nx Cloud emitted a disabled-organization 401 warning, while freshly dated `dist/apps/ptah-electron/main.mjs` and webview browser output were present. The build target did not copy the renderer, so the repository's `apps/ptah-electron/scripts/copy-renderer.js` copied the fresh webview output to `dist/apps/ptah-electron/renderer` without another build. [shoot.cjs](visual-check/shoot.cjs) launched that main bundle through Playwright `_electron`, with temporary HOME, USERPROFILE, APPDATA, LOCALAPPDATA, `--user-data-dir`, and `PTAH_DB_PATH`, plus remote debugging port **9347**. The last run used `C:\Users\abdal\AppData\Local\Temp\ptah-attention-visual-...`; the exact path is in `capture-results.json`. The app was closed, its launched process tree was targeted for cleanup, the temporary directory was removed, and port 9347 was confirmed free afterward. One Electron instance ran at a time.

## Decision

- **Decision:** Mark REVISE with score 5/10. **Options:** approve on the empty-panel checks, or require a revision and a populated-state capture. **Evidence:** the approved prototype differs in empty-state hierarchy and panel width; most requested states were unavailable in the isolated production renderer. **Reversible:** yes, after the panel is aligned and populated-state screenshots are captured.
