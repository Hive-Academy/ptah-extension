# Visual Review - TASK_2026_699_833e

## Summary

| Metric            | Value                                                  |
| ----------------- | ------------------------------------------------------ |
| Overall score     | 7.5/10                                                 |
| Assessment        | NEEDS_REVISION                                         |
| Visual breaking   | 0                                                      |
| Serious           | 1                                                      |
| Moderate          | 3                                                      |
| Viewports tested  | 6 (760, 1030, 1100, 1216, 1440, 1500, 1920; 760 and 1440 with screenshots) |
| Screenshots taken | 20                                                     |
| Components tested | 6 (Stats tab, dock, resize handle, sheet and scrim, Plan Limits cards, header toggle and close) |

Score reasoning: the structure, sizing, clamping, floor, keyboard, focus return and card overflow all measure correct, which keeps this above the 5-6 band. One AA contrast failure on a new label, one partly clipped focus ring and a few small items keep it below 9. The 8 band needs no AA failure.

## Environment

- Build verified: `npx nx build ptah-extension-webview --configuration=development --parallel=1` ran from this worktree, then `apps/ptah-electron/scripts/copy-renderer.js` copied it to `dist/apps/ptah-electron/renderer`. The renderer bundle contains the `inspector-dock-width` storage key (checked with grep), so the build is the branch code. The main process, preload and workers were copied from the main checkout's existing `dist/apps/ptah-electron`. They are unchanged by this task, and the main checkout was only read.
- App: Electron dev app (NODE_ENV=development) launched from the worktree with `--remote-debugging-port=9391`, `--user-data-dir` and `APPDATA` under `.ptah/specs/TASK_2026_699_833e/.electron-userdata/`. Driven over CDP (a small node script, `cdp.js`).
- Base URL: `file:///.../dist/apps/ptah-electron/renderer/index.html`.
- Viewport method: CDP `Emulation.setDeviceMetricsOverride` (the page-level CDP target has no window-bounds API). Widths are viewport widths, so the left rail (32 px) is inside them. The `.cs-shell` is viewport minus 64 px at 1440 (1376 measured). This is an audit selection, not a support contract. Widths opened: 760, 1030, 1100, 1216, 1440, 1500, 1920.
- Themes: `anubis` (dark) and `anubis-light`.
- Surface: Electron forces canvas grid layout, and the inspector only mounts in the single-session chat view (`hostsInspector` is false inside a tile). To reach it I set layout mode to `single` through the AppState service (dev build `ng` API) and clicked "Full view". This is a review-only route, not a user path that exists in Electron today.
- Injected data: the profile had no plan-limit windows, so I set the PlanLimitsStore snapshot signal to a fixture with four windows. They are 5-hour (usage unknown), Weekly 50%, Weekly Sonnet 82%, and Monthly 97% with a deliberately 70-character label. All cards were expanded for the measurements. The fixture is not real account data.
- Cleanup: every process I started (launch.js node, 3 electron.exe) was stopped. Port 9391 has no listener.

## Findings by severity

### Visual breaking

None.

### Serious

#### 1. Open-state "Stats" tab label fails contrast (`text-primary` on the tab surface)

- File: `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts` (label class `text-primary` when `isOpen`). Used by `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:283-305`.
- Viewports affected: all widths where the tab is open (1440 docked, 760 sheet).
- Screenshot: `light-1440-open.png`, `light-tab-focus.png`, `light-760-open.png` (label barely visible), `dark-1440-open.png`.
- Problem: measured with the canvas-pixel method on the computed colors. The label is 10 px, weight 600, so it is not large text.
  - Light theme, open: `oklch(0.85 0.138 181)` on `rgb(234,230,227)` = 1.20:1.
  - Dark theme, open: `oklch(0.546 0.215 263)` on `rgb(24,24,28)` = 3.43:1.
  - Closed state is fine: 5.79:1 dark, 5.62:1 light.
  - At 760 the inert tab is also at `opacity-50` over the scrim, so it is lower still.
- Impact: the one control that closes or opens the dock loses its label in light theme exactly when it is the active control. WCAG 1.4.3 requires 4.5:1.
- Note: `design-spec.md` line 66 records the weak light contrast as "inherited, not changed" and the user approved the spec. It is still a defect on a new, user-requested label, and a one-class fix.
- Fix: for the open state use a text token that passes (for example `text-base-content`), and keep `text-primary` only on the 2 px active line.

### Moderate and minor

- **Stats tab keyboard focus ring is clipped to one edge (Moderate).** The tab button gets a 2 px outline (`oklch(0.766 0.139 91)` dark, `oklch(0.48 0.12 70)` light), but top, bottom and right are clipped by the slot and dock. Only the left edge shows (`light-tab-focus.png`, `dark-tab-focus.png`). It is visible, but not a full ring. The same state shows as a lone brown vertical line in `light-760-closed.png`. Fix: use an inset ring (`outline-offset: -2px`) on the tab.
- **Width readout covers the dock title while the handle is keyboard-focused (Moderate).** The "300 px" and "560 px" pill sits over "This" in "This session" (`dark-cards-300.png`, `dark-cards-max.png`). `design-spec.md` line 15 says the readout opens inside the dock, and the readout is not shown at rest. The overlap is still there during keyboard resize. Fix: move the readout to the vertical middle or the bottom of the handle.
- **Long plan-window label truncates with no wrap at narrow dock widths (Moderate).** At the 300 px dock the Monthly label is cut to "Monthly with a deliber..." (`dark-cards-300.png`). It has a `title` attribute, so it is recoverable by hover only. It is intentional `truncate`, and not an overflow, but the full text does not show at 300 or 336 px (sheet). I recorded it here because the plan asks for `break-words` guards. No overflow results either way.
- Minor: Escape does not close the docked dock (it only closes the modal sheet). Reasonable and matches the spec's Esc scope (drag restore), but it is an unannounced behavior. Escape pressed with focus inside the dock left it open at 1440 (measured `tabExpanded` true).
- Minor: at a 966 px shell (1030 viewport) the inspector uses the modal sheet, because the docked band needs 960 px for the main area. This is the documented band rule, and the width you get is the 336 sheet.

## Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_699_833e/prototype/index.html` (revision 3) and its 4 screenshots.
- Fidelity assessment: MATCHES, with one approved change.
- Deviations observed:
  - The Stats tab moved to the left (inner) edge of the dock and was renamed "Stats". The prototype screenshots show "Session" on the right edge. This is `decisions.md` row 13, a user instruction made after the prototype was approved. It is not a defect. The prototype was not updated for it.
  - The 760 sheet shows the tab to the left of the sheet, dimmed and inert (`dark-760-open.png`). This matches the row 13 intent.
  - Plan Limits cards match the prototype card structure. The center item (status text, progress bar, reset text) takes its own full-width row in each card. There is an 8 px bar, a disclosure chevron on window cards, and detail inside the card divided by a border. The prototype's "Local usage" card is not shown because the fixture had no local usage.
  - The handle is a zero-width slot (measured `.cs-dock-slot` width 0) with a 12 px hit area on the dock side only (`x` equals the dock `x`, `w` 12). The rest grip is visible and the focus ring is a solid 2 px `base-content` (`oklch(0.925 ...)` dark, `oklch(0.236 ...)` light). All of this matches the README.
  - The prototype uses a system font and static sample text. The real app has its own font and a real session header, so comparisons are structural, not pixel.
- Before/after comparison (no prototype): not applicable, a prototype exists.

## Viewport results

| Viewport (shell) | Screen | Checked | Status | Screenshot |
| --- | --- | --- | --- | --- |
| 1440 (1376) dark | dock open | tab x 976, dock 1008 w 400 (default for 1100-1499), main 944, no horizontal scroll (`scrollWidth` 1440) | pass | `dark-1440-open.png` |
| 1440 dark | dock closed | tab at right edge x 1376 w 32, main 1344 | pass | `dark-1440-closed.png` |
| 1440 light | open and closed | same geometry | pass | `light-1440-open.png`, `light-1440-closed.png` |
| 760 (696) dark and light | sheet open | sheet 336 wide at x 392, scrim covers 32-728, tab at x 360 with `inert` true and dimmed, no handle | pass (see Serious 1 for the label) | `dark-760-open.png`, `light-760-open.png` |
| 760 dark and light | sheet closed | tab at x 696, main 664 | pass | `dark-760-closed.png`, `light-760-closed.png` |
| 1030 (966) | opens as sheet | modal sheet 336, no handle | pass (band rule) | none |
| 1100 (1036) | dock | default 336, max 380, Home 300 | pass | none |
| 1216 (1152) | dock | default 400, max 496 | pass | none |
| 1500 (1436) | dock | default 400, max 560 | pass | none |
| 1920 (1856) | dock | default 448 (tier at shell 1500 and up), max 560 | pass | none |

Chat column floor: at the maximum dock width the main column was exactly 624 px at 1100 (dock 380) and 1216 (dock 496). The Stats tab slot (32 px) is reserved outside both numbers, so a 560 px dock needs a shell of at least 1216 px (viewport 1280), not 1184 px as the brief says. At 1440 the max is the 560 clamp (main 784). I recorded this because the brief's "1184" figure differs, and the code reserves the tab slot.

## Component and interaction results

| Component | States tested | Status | Evidence |
| --- | --- | --- | --- |
| Stats tab | default, hover (bg `oklch(.266 ...)/.8` dark, `oklch(.916 ...)/.8` light), keyboard focus, open, closed, inert in sheet, badge dot | works. Focus ring clipped (Moderate), open label contrast (Serious) | `*-tab-focus.png` |
| Resize handle | Home = 300, End = max, ArrowRight shrinks 16, Shift+ArrowRight shrinks 48, ArrowLeft grows 16, double-click resets to 400, `aria-valuemin` 300, `aria-valuemax` 560 (`aria-valuenow` follows) | pass | measured, `*-cards-300.png` |
| Handle drag | mouse drag left 160 px: 400 to 560. Drag 800 px left: stays 560 (main 784). Drag 700 px right: stays 300 (main 1044). Stored `ptah.inspector-dock-width.v1` was "560" after release. Escape during drag restored the previous width. | pass | `dark-drag-active.png`, `light-drag-active.png` |
| Focus return | close via header X at 1440: focus on "Toggle Stats panel" tab. Close via scrim at 760: focus on the tab. | pass | measured `activeElement` |
| Sheet and scrim | scrim click closes, tab inert while open | pass | `*-760-open.png` |
| Plan Limits cards | see table below | pass | `*-cards-*.png` |

Plan Limits overflow, measured with `scrollWidth` and `clientWidth` on every `ptah-plan-limit-tile` host and its first child card, all cards expanded:

| Dock | Inspector width | Card host sw/cw | Card sw/cw | Result |
| --- | --- | --- | --- | --- |
| 300 px dock (shell 1376) | 300 | 257/257 (4 cards) | 254/254 (4 cards) | no overflow. One `truncate` span clips by design (sw 395, cw 138 on the long Monthly label) |
| 560 px dock (shell 1376) | 560 | 517/517 | 514/514 | no overflow, nothing clipped |
| 760 sheet | 336 | 293/293 | 290/290 | no overflow. Same truncated label (sw 395, cw 174) |

The inspector's own scroller had `scrollWidth <= clientWidth` at all three (289/289, 549/549, 325/325), so there is no horizontal scroll. The same numbers held in both themes at 760 (light 300 and max shots are in the folder).

## Design system compliance

- No hex values were observed in the new surfaces. Colors are theme tokens (oklch values come from the theme and change with the theme).
- Handle rest grip and focus ring use `base-content` in both themes, as specified.
- Cards use the 8 px progress bar (`h-2`) from the README. Status colors are on borders and fills (orange border on the 82% and 97% cards), while text stays on `base-content` or muted tokens, per `stats-tile.styles.ts`.
- Not verified: pixel spacing against the 4 px grid beyond what the screenshots show.

## Accessibility audit

Criterion: WCAG 2.2 AA (the repo declares no other standard). 4.5:1 for normal text, 3:1 for UI components, 24x24 minimum target.

| Pair | Ratio | Result |
| --- | --- | --- |
| Stats label, closed, dark | 5.79 | pass |
| Stats label, closed, light | 5.62 | pass |
| Stats label, open, dark | 3.43 | FAIL (Serious 1) |
| Stats label, open, light | 1.20 | FAIL (Serious 1) |
| Dock title, `PLAN LIMITS` heading, dark / light | 14.86 / 15.92 | pass |
| Card title, dark / light | 14.03 / 14.44 | pass |
| Card reset text (11 px), dark / light | 5.71 / 5.48 | pass |
| Card chip text, dark / light | 14.03 / 14.44 | pass |

- Target size: Stats tab 32 x 808 px, handle hit area 12 x 808 px. Both are at or above 24 px in the short axis (the handle is 12 px wide; it has an exemption through the keyboard equivalent, and the arrow keys work).
- Focus: Tab order reached the Stats tab, the handle (`tabindex` 0, `role` separator, `aria-label` "Resize session details") and the dock controls. The handle focus ring is a solid 2 px outline and is visible (`dark-cards-300.png`). The tab ring is clipped (Moderate).
- Semantics: the tab has `aria-expanded` true or false and `aria-label` "Toggle Stats panel". The header toggle keeps `aria-controls="inspector"` (not changed). The sheet tab is `inert`.
- Not tested: screen reader output and forced-colors mode.

## Visual performance

- Layout shift: a `layout-shift` PerformanceObserver over three open, close and open cycles at 1440 recorded 0 entries (CLS 0). Caveat: the page was driven over CDP with emulated focus, so this shows no shift in that run and is not a field measurement.
- Content moves by design when the dock opens (tab slides from x 1376 to 976 and the chat column narrows from 1344 to 944). The slot keeps its 32 px so the tab does not jump in the 760 sheet.
- Loading: the dock mounts as a deferred chunk with a same-size placeholder (`@placeholder` block uses the same width), so no reflow was seen at open. I did not capture the placeholder frame.
- Not measured: animation frame timing for the 220 ms dock-in motion.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on geometry, clamping, floor, keyboard and overflow (all measured). MEDIUM on layout-shift (emulated run).
- Key concern: the open-state "Stats" label is 1.2:1 in the light theme and 3.4:1 in the dark theme. Change its text color (finding 1). The clipped focus ring, the readout covering the dock title and the truncated long label are lower priority.
- Cleanup confirmation: Electron and the CDP helper processes are stopped, and port 9391 is free. No source files were edited and nothing was committed. Helper scripts and the private profile remain in `.ptah/specs/TASK_2026_699_833e/.electron-userdata/`.
