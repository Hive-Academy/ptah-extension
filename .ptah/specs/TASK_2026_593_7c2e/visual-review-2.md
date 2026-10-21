# Electron visual run 2 — TASK_2026_593 / PR #795

**Verdict: REVISE · 5/10.** The built Electron renderer yielded eight usable dark-theme captures at 1440×900. The populated panel, badge, stack, and empty state are visible, but the snackbar placement and two panel styles depart from the prototype. The remaining 14 shots failed in the capture harness, so light theme, 800 px, and a routed live permission cannot be signed off. This is a real-gap score rather than 7–8 because a three-card stack obscures the Stats pane; it is above 3–4 because the dark panel and empty state render and the badge count is coherent. **Severity counts: 0 critical, 1 major, 2 moderate, 0 minor.**

## Basis and coverage

- Built `ptah-electron` once successfully with `NX_DAEMON=false npx nx build ptah-electron --parallel=1`, then ran `copy-renderer.js`. The capture launched `dist/apps/ptah-electron/main.mjs` with the copied renderer, so these are current-code screenshots.
- Generated all 27 reference PNGs with `prototype/capture-screenshots.js`, following its README. Compared every successful capture directly with the matching prototype PNG. The prototype's simplified board and chrome are illustrative; notification placement, row borders, header hierarchy and actions are the comparison points. Expectations come from `design-spec.md:29-39,69-75`, `decisions.md:15,20`, and `prototype/README.md`.
- `capture-results-2.json`: **8/22 successful shots, 17 recorded errors**. The first run stopped before captures because `page.viewportSize()` was null. The single allowed rerun followed the script fix below. The successful captures are all dark, 1440×900. No 800 px or light production viewport was captured.
- The script's recorded limitations: lane permission was projected through `attention:changed` because no live agent existed; the git warning source could not be routed; failed-turn coverage used a real voice provider error because the new tab had no backend Claude session. The dark permission, question and lane rows also use synthetic `target: null` projections.

## Shot-by-shot comparison

Paths in this table are under `visual-check/`; prototype matches are under `prototype/screenshots/` with the same name unless stated.

| Shot file | Prototype match | Finding / capture outcome |
| --- | --- | --- |
| `dark-snackbar-permission.png` | Partial | Opaque card and short title; synthetic context reads “Permission: Bash · Unknown workspace”, action is disabled “Show in canvas”; card covers Stats pane. |
| `dark-snackbar-question.png` | Partial | “Unknown workspace” shown without duplicate title; no provider/session context in null-target fixture; card covers Stats pane. |
| `dark-snackbar-lane.png` | Partial | Lane title and “Lane permission: Bash · Unknown workspace” shown; “Show in canvas” disabled; card covers Stats pane. |
| `dark-snackbar-failure.png` | Partial | Opaque red-edged failure and usable “Switch to local”; real voice error text differs from prototype fixture; card covers Stats pane. |
| `dark-snackbar-stack.png` | No | Three visible cards and `+3 more` work, badge shows 5, but cards cover the Stats pane. Prototype's five-item fixture shows `+2 more`; run included a sixth voice failure. |
| `dark-bell-badge.png` | Partial | Badge shows 5 for five unresolved projected requests. Prototype close-up shows 3 for its fixture; counts are consistent with each fixture. Full-frame capture, unlike prototype crop. |
| `dark-panel.png` | No | Five Needs you rows plus Recent notices appear and Clear all notices is visible. Orange full-row borders and “Needs you 5” differ from approved prototype. Panel scrolls at 70vh, leaving the Recent row partly below fold. |
| `dark-panel-empty.png` | Yes, for state | “All clear / Nothing needs your attention” appears, badge is gone, Clear all notices is disabled. Check icon color differs, but text and state match. |
| `dark-panel-clear-all.png` | No direct counterpart | **No PNG.** Script asserted that “Text-to-speech failed” remained after Clear all; this broad text query cannot distinguish panel history from another surface. Clearance is unverified. |
| `dark-800.png` | `dark-800.png` | **No PNG.** Snackbar locator timed out after the panel failed to close; do not infer an 800 px layout result. |
| `dark-snackbar-permission-live.png` | `dark-snackbar-permission.png` | **No PNG.** Script timed out waiting for Electron blur / document focus loss before injecting the live request. Workspace and session name on a routed permission remain unverified. |
| `light-snackbar-permission.png` | `light-snackbar-permission.png` | **No PNG.** Theme switch failed; assertion still read `anubis/dark`. |
| `light-snackbar-question.png` | `light-snackbar-question.png` | **No PNG.** Same theme failure. |
| `light-snackbar-lane.png` | No light lane reference | **No PNG.** Same theme failure. |
| `light-snackbar-failure.png` | `light-snackbar-failure.png` | **No PNG.** Same theme failure. |
| `light-snackbar-stack.png` | `light-snackbar-stack.png` | **No PNG.** Same theme failure. |
| `light-bell-badge.png` | No light badge reference | **No PNG.** Same theme failure. |
| `light-panel.png` | `light-panel.png` | **No PNG.** Same theme failure. |
| `light-panel-clear-all.png` | No direct counterpart | **No PNG.** Same theme failure; clearance unverified. |
| `light-panel-empty.png` | `light-panel-empty.png` | **No PNG.** Same theme failure. |
| `light-800.png` | `light-800.png` | **No PNG.** Same theme failure. |
| `light-snackbar-permission-live.png` | `light-snackbar-permission.png` | **No PNG.** Electron blur / focus-loss timeout, with theme already unverified. |

## Requested checks

**(a) Context.** The three synthetic null-target cards and panel rows show **“Unknown workspace”**, as required; they do not duplicate their titles. Permission and lane context retain “Permission: Bash” / “Lane permission: Bash” rather than a `Tool: Bash` field. Provider and session are absent because the fixture supplies only kind and title (`shoot-populated.cjs:37-41`); `chat-attention-host-message-handler.service.ts:179-195` can infer provider only from a resolved local owner. Therefore these screenshots establish the unknown-workspace fallback, but cannot validate a populated provider/session context. The live permission shot failed before injection, so “workspace” and “Attention capture” on a routed request are **unverified**.

**(b) Actions.** Synthetic chat-owned rows say **“Show in canvas”**, never “Open” (card and panel screenshots). They are visibly disabled because `target: null`; `chat-attention-host-message-handler.service.ts:203-215` supplies “Target unavailable”. This fixture cannot validate Allow/Deny/Open on a real request.

**(c) Opacity.** `snackbarStyle` recorded five successful dark cards: permission, question, lane, failure and stack. Each has `backgroundColor: oklch(0.259365 0.0207655 284.872)`, card `opacity: 1`, and **all nine recorded ancestors at opacity 1**. The screenshots show an opaque surface. The earlier see-through appearance is consistent with an entrance frame: `notification-snackbar.component.ts:22-24` animates from opacity 0 to 1 over 120 ms. It is not a persistent transparent card in these captures. No light-theme opacity value was collected.

**(d) Bell/panel/clear/empty/800.** The bell shows 5 for five projected requests. The panel lists five Needs you rows, a Recent voice failure, and the Clear all notices control. The empty shot shows “All clear” and a disabled Clear control. The script's Clear all assertion failed, and panel closure then failed; the 800 px snackbar did not render for capture. Do not treat Clear all or 800 px as passing.

**(e) Known style differences.** Recommend **fix**, not approved deviation, for both: `decisions.md` contains no approval of these substitutions. In `notification-center.component.ts:70`, replace `border-warning` with the neutral row border `border-base-300`, retaining the orange icon at line 74. At lines 65–67, make the heading uppercase with compact tracking and muted text, and push the count to the right (`h3` with `flex-1 uppercase tracking-wide text-base-content-muted`; count span `ml-auto`). The approved prototype `dark-panel.png` shows neutral row outlines and “NEEDS YOU” with the count at the far edge.

## Defects

1. **Major — snackbar stack obscures the Stats pane.** In `dark-snackbar-stack.png`, the three cards span approximately x=1076–1424 and y=65–427 over the right Stats pane, covering its Session and Agents content and controls. The approved prototype `dark-snackbar-stack.png` reserves clear board space beneath the cards. `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` fixes the host to `right: 1rem` relative to the whole window. Position the host relative to the canvas content boundary, or reserve its 348 px column in the Electron shell, while retaining the 900 px collapse rule at line 25.
2. **Moderate — Needs you rows use a full orange border.** `dark-panel.png` shows orange rectangles around all five rows versus the prototype's neutral borders with orange icons. `libs/frontend/notification-center/src/lib/notification-center.component.ts:70`: change `border-warning` to `border-base-300`; keep `text-state-need` at line 74.
3. **Moderate — section heading loses prototype hierarchy.** `dark-panel.png` reads “Needs you 5” as a single left-aligned cluster; the prototype reads “NEEDS YOU” with 3 right-aligned. `libs/frontend/notification-center/src/lib/notification-center.component.ts:65-67`: style the heading uppercase with tracking and `flex-1`, then align the count to the right with `ml-auto`.

The disabled synthetic actions and missing provider/session on `target: null` are fixture-limited observations, not additional interface defects. The Clear all script assertion and light-theme selector failure require capture-harness diagnosis before visual approval; neither has a supporting defect screenshot.

## Best evidence PNGs

- `visual-check/dark-snackbar-permission.png` — null-target context and disabled Show in canvas.
- `visual-check/dark-snackbar-stack.png` — stack, overflow, badge, and Stats occlusion.
- `visual-check/dark-snackbar-failure.png` — opaque failure card and recovery action.
- `visual-check/dark-panel.png` — Needs you styling and Clear all control.
- `visual-check/dark-panel-empty.png` — empty state and disabled Clear all.
- `prototype/screenshots/dark-panel.png` — approved panel border and heading reference.

## Script and cleanup

Changed only `visual-check/shoot-populated.cjs:82`: replaced `page.viewportSize().width` with `await page.evaluate(() => window.innerWidth)` because Electron's first window reported a null Playwright viewport before explicit `setViewportSize`. Reran once, as permitted. The capture output reports `portFreeAfter: true` and `tempRemoved: true`; an independent final check found port **9347 free** and no `%TEMP%/ptah-attention-populated-*` directory. No application code was edited.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Mark REVISE and score 5/10 | PASS would imply light, 800 px and routed permission coverage that did not occur; screenshot-backed stack occlusion and two unapproved panel deviations remain. | Yes |
| Recommend fixing both known style differences | The generated approved prototype shows neutral row borders and a right-aligned heading count; `design-spec.md:37,71` asks for its hierarchy, and `decisions.md` does not approve a change. | Yes |
| Do not claim a Clear all product defect | `NotificationService.clearAll()` hides recent entries (`notification.service.ts:180-189`), while the script used a page-wide text query (`shoot-populated.cjs:231`) and produced no post-clear PNG. | Yes |
