# Electron visual review — TASK_2026_593_7c2e

## Summary

| Metric | Result |
| --- | --- |
| Verdict | **REVISE** |
| Score | **4/10** |
| Visual breaking | **3** |
| Serious / moderate / minor | **0 / 0 / 0** |
| Captures | **24/24 successful**, dark and light |
| Viewports opened | **1440 × 900**, **800 × 900** |

The build follows the approved card anatomy in the snackbar and bell: kind label with state icon and narrow accent, session title, workspace chip, detail when available, one filled primary action on the routed live permission, and no full state-colored border. The three issues below affect the rail action hierarchy and Stats visibility. A 7–8 score would require the approved rail hierarchy and unobstructed content; a 1–2 score would imply the attention surfaces or routing were broadly unusable, which the live rail and bell captures do not show.

## Environment and evidence

- Fresh `NX_DAEMON=false npx nx build ptah-electron --parallel=1` succeeded; `copy-renderer.js` copied its renderer into `dist/apps/ptah-electron/renderer`. The capture launched that built Electron entry and verified the `file:…/renderer/index.html` window before taking shots. The script's CDP port was 9347.
- Approved reference: [design-spec.md](design-spec.md), [attention.html](prototype/attention.html), [full.png](prototype/screenshots/full.png). The design spec points to `apps/ptah-extension-webview/src/styles.css` and `tailwind.config.js` for surface, theme and state colors.
- Capture manifest: [capture-results-2.json](../visual-check/capture-results-2.json). The live bell panel contains one Needs You row in each theme; the saved text includes **Attention capture**, **workspace**, **Tool: Bash**, **Allow**, **Deny**, and **Show in canvas**.
- Best three result images: [dark rail](../visual-check/dark-rail-needs-you.png), [dark stack over Stats](../visual-check/dark-snackbar-stack.png), [light live bell panel](../visual-check/light-panel-permission-live.png).

## Findings by severity

### Visual breaking 1 — Rail primary action loses its hierarchy

- **Evidence:** [dark rail](../visual-check/dark-rail-needs-you.png) and [light rail](../visual-check/light-rail-needs-you.png), 1440 × 900. The queue's **Allow**, **Deny**, and **Show in canvas** all appear as plain text controls. The tab card repeats this treatment. The approved [prototype](prototype/screenshots/full.png) shows one filled primary action per request.
- **Cause:** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:202-203` applies `btn-ghost` unconditionally, then adds `btn-primary`. The tab action does the same in `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:172`.
- **Impact:** A pending permission has no visually dominant response in the rail, despite the approved action hierarchy.
- **Fix:** Apply `btn-primary` and `btn-ghost` as mutually exclusive classes, using `isPrimaryAttentionAction` in both rail surfaces.

### Visual breaking 2 — “Needs you” appears outside the tab card

- **Evidence:** [dark rail](../visual-check/dark-rail-needs-you.png) and [light rail](../visual-check/light-rail-needs-you.png), 1440 × 900. The session card's visible frame ends above the “Needs you / Tool: Bash” line and its actions. In the approved [prototype](prototype/screenshots/full.png), the chip and request detail sit inside the compact session card.
- **Cause:** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:152-166` renders the attention block as a sibling after `<ptah-compact-session-card>`; the host height addition at line 73 increases the list item's height but does not extend the card surface around that sibling.
- **Impact:** The request looks detached from the session it belongs to, weakening the intended session association.
- **Fix:** Put the attention block inside the card's framed surface, or wrap the card and attention block in a shared framed container while retaining the current action behavior.

### Visual breaking 3 — Stacked snackbars cover Stats content

- **Evidence:** [dark stack](../visual-check/dark-snackbar-stack.png) and [light stack](../visual-check/light-snackbar-stack.png), 1440 × 900. Three cards occupy the upper right Stats pane and obscure its Session, Context, Tokens/Cost, and Agents area. At 800 × 900, [dark](../visual-check/dark-800.png) and [light](../visual-check/light-800.png) show the single card crossing the session header and its controls.
- **Cause:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` fixes the stack at the upper right with `z-index: 60`, independently of the Stats pane. The 3/1 card cap at lines 96–105 limits stack size but not overlap.
- **Impact:** The overlay blocks visible session information and controls while notices remain on screen.
- **Fix:** Reserve a safe region for the stack or place it in a region that does not cover active Stats and header controls at these widths. Recheck both 1440 and 800 widths with three pending notices.

## Per-check results

| Check | Result and evidence |
| --- | --- |
| Card anatomy, dark/light | Kind label, icon, narrow accent, title, workspace chip and safe detail appear in [dark live bell](../visual-check/dark-panel-permission-live.png), [light live bell](../visual-check/light-panel-permission-live.png), [dark snackbar](../visual-check/dark-snackbar-permission.png), and [light failure](../visual-check/light-snackbar-failure.png). The routed live card has one filled **Allow** action. Provider is omitted when the synthetic request supplies none, as the spec allows. |
| Missing session and disabled state | Injected `target: null` rows show **Session unavailable**, **Workspace unavailable**, a disabled **Show in canvas**, and **Target unavailable** in [dark stack](../visual-check/dark-snackbar-stack.png) and [light bell](../visual-check/light-panel.png). They do not enter the rail, as designed. Disabled text remains legible in these captures; no numerical contrast measurement was made. |
| Rail queue and tab | Live `permission:request` appears above the session cards and the tab has a “Needs you” marker in [dark rail](../visual-check/dark-rail-needs-you.png) and [light rail](../visual-check/light-rail-needs-you.png). Placement and action hierarchy have the defects above. |
| Bell panel | The routed live request appears with three enabled actions in [dark live bell](../visual-check/dark-panel-permission-live.png) and [light live bell](../visual-check/light-panel-permission-live.png). The initial exact-text assertion used an outdated “Permission: Bash” label; the current card uses **PERMISSION REQUIRED** and **Attention capture**. The rerun saved the panel and its row count instead. |
| Snackbar count and occlusion | Three visible at 1440 × 900 in [dark stack](../visual-check/dark-snackbar-stack.png) and [light stack](../visual-check/light-snackbar-stack.png); one at 800 × 900 in [dark 800](../visual-check/dark-800.png) and [light 800](../visual-check/light-800.png). Occlusion remains. |
| Live snackbar on Tasks | After switching to Tasks and sending a second routed live permission, no snackbar appeared within five seconds in either theme. The script skipped `{theme}-snackbar-live.png` and recorded the suppression in the manifest. The routed item was still proven in the rail and bell. |

## Prototype fidelity, accessibility, and limits

The snackbar and bell card choices follow the approved prototype's surface and accent treatment. The rail differs in the two ways cited above. No project component ban or substitution of badge/tooltips with text buttons was observed in the captured attention cards. The scripted captures verify visible enabled and disabled actions, but do not establish keyboard focus order, numerical contrast, layout shift, or a 400 px breakpoint. The approved [full.png](prototype/screenshots/full.png) was the visual comparison source; the opened application widths were 1440 and 800 px.

## Script changes and cleanup

- Extended [shoot-populated.cjs](../visual-check/shoot-populated.cjs) to capture `{theme}-rail-needs-you.png`, save live bell text and row counts, switch to Tasks, wait up to five seconds for a live snackbar, and record a skip when absent. The first run had 22/24 successful images because its old bell label assertion timed out; one permitted rerun produced **24/24**, **0 errors**.
- Script cleanup reported `portFreeAfter=true` and `tempRemoved=true`; independent checks found port 9347 free and no `%TEMP%/ptah-attention-populated-*` directory. `build.log` was removed. No application code was edited. Scoped Ptah diagnostics for the changed `.cjs` did not complete within its timeout, so the successful script execution is the available syntax/run evidence.

## Decisions

- **Decision:** Treat the rail's missing filled primary button and detached tab marker as approved-prototype deviations. **Alternatives:** accept the rail variation or request a design change. **Evidence:** paired dark/light rail shots and [full.png](prototype/screenshots/full.png). **Reversible:** yes.
- **Decision:** Record the absent Tasks snackbar as a capture limitation, not a proven visual defect. **Alternatives:** infer a notification logic failure. **Evidence:** rail and bell prove the routed item, while the script recorded suppression after five seconds; there is no screenshot of a rendered snackbar state. **Reversible:** yes.

## Verdict

**REVISE, 4/10.** Fix the three visual-breaking issues and repeat the rail and snackbar captures. Confidence is high for the photographed 1440 and 800 px states, and limited for untested narrow widths and keyboard behavior.
