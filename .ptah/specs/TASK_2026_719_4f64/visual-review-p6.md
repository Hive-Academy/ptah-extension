# Visual Review P6 - TASK_2026_719_4f64

## Summary

| Metric            | Value                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| Overall score     | 8/10                                                                                   |
| Assessment        | REVISE (0 breaking; 2 serious, which are small fixes)                                  |
| Visual breaking   | 0                                                                                      |
| Serious           | 2                                                                                      |
| Moderate / minor  | 5                                                                                      |
| Viewports tested  | 520, 360, 320, 245 CSS px at zoom 1; 520 and 245 CSS px at real zoom 200%; dark and light |
| Screenshots taken | about 190 (`screenshots/p6-*.png`), plus `p6-results-all.json`, `p6-results-zoom.json`, `p6-results-toast.json` |
| Components tested | main popover Account field, Claude lane account cell and menu, Accounts tab (list, detail), toast over drawer |

## Environment

- Build under review: `dist/apps/ptah-electron/main.mjs`, built 22:08 on 2026-10-26, launched as my own Electron instance through the harness `screenshots/p6-capture.mjs` (adapted from `p5-capture3.mjs`). The user's running instance was not touched. The RPC is faked. No sign-in happened and no credentials or console text were read.
- Scenarios: `zero` (0 named accounts), `two` (Work signed in, a 52-character label signed out; chat on Work, lanes on the signed-out one), `removed` (stored selection points at a deleted account), `pending` (sign-in in flight; chat and lanes on the existing login).
- Widths: 520, 360, 320, 245 at zoom 1, and 520 and 245 at real `webContents.setZoomFactor(2)` (CSS viewport stays 520/245). Dark = `ptah-glass`, light = `ptah-glass-light`.
- Zoom screenshots (`p6-two-*z2-*`) were re-taken with `capturePage` in `p6-zoomcap.mjs`, because Playwright screenshots crop at zoom 2. Overflow numbers come from `p6-results-zoom.json`.
- Expectations come from `design-spec-p6.md`, `implementation-plan-p6.md` (criteria 9, 13, 22), `prototype/p6/index.html`, and WCAG 2.2 AA (contrast 4.5:1 / 3:1, target size 2.5.8 = 24 px). The repo declares no other standard.
- Not tested: signing in, real Claude calls, the Save write path, AT announcements with a real screen reader. The old P5 build was not compared.

## Findings by severity

### Visual breaking

None. No horizontal page scroll at any width or zoom (`docSW == vw` in every record), and no clipped or overlapping P6 element in the accounts tab, lane menu or popover Account field.

### Serious

#### 1. Lane Account trigger is 16 px tall (below the 24 px target size)

- File: `libs/frontend/chat/src/lib/settings/ptah-ai/claude-lane-account-cell.component.ts:33` (`CELL`: `inline-flex ... px-1 text-xs`, no `min-h`).
- Viewports: all (520/360/320/245, zoom 1 and 2), `two`, `removed` and `pending` scenarios.
- Screenshot: `p6-two-520-lane-dark.png`, `p6-two-520-lane-light.png`; measured in `p6-results-all.json` (`laneGeom.trigger = [108,316,16]`; audit `smallTargets` 208x16).
- Problem: the trigger is 208x16 px. The "Ready" badge and the terminal button sit about 19 px below its centre, so the 24 px-circle spacing exception of WCAG 2.5.8 does not apply either. The menu items are 32 px tall (`ITEM`, `min-h-8`), so the trigger is the outlier.
- Impact: harder to hit by pointer; AA target-size fail.
- Fix: add `min-h-6` (or `min-h-8` like the Manage chevron, 32x32) and `py-0.5` to `CELL`. Keep `max-w-[13rem]` and the truncation.

#### 2. Main popover overflows horizontally at 245 px, and the Close (x) button is clipped

- File: `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:98-108` (popover `w-[19rem] max-w-[calc(100vw-2rem)]`, header row with `Check connection` + `btn-square` Close).
- Viewports: 245 at zoom 1 and zoom 2; all four scenarios, including `zero`, which has no Account field, so the Account field is not the cause.
- Screenshot: `p6-two-245-popover-dark.png`, `p6-two-245z2-popover-dark.png`.
- Problem: popover root `clientW 214, scrollW 242`. Close sits at x 235-259 while the viewport is 246. The popover shows a horizontal scrollbar and the x is out of view. The Account select itself fits (180 px, `right 209` against popover `right 231`).
- Impact: the x cannot be seen at 245 px. Cancel, Save and Escape still work, so it is not blocking.
- Fix: let the header wrap (`flex-wrap`, `min-w-0` on the title) so `Check connection` and Close stack under 260 px, as the title already wraps. This is likely older than P6, but it is on a P6 surface and the plan lists 245 px as supported.

### Moderate and minor

1. Moderate: the "Used by" chips are 10 px text (`badge-sm`, 31x16 and 38x16 px) at every width. Contrast is fine (dark 11.9:1, light 6.49:1), but 10 px is small and the chips are not interactive. `providers/accounts/accounts-tab.component.ts:216`. Fix: `text-xs` on the chip. `p6-two-520z2-accounts-dark.png` shows them readable at 200%.
2. Moderate: in the light theme the account row cards lose their border and the chips lose their pill outline (rows read as bare text; dark keeps a 1 px edge). `p6-zero-360-accounts-light.png`, `p6-two-320-accounts-light.png`. The prototype rows use `border: 1px solid var(--edge)` (`prototype/p6/index.html:50`). Fix: use a stronger border token in `ptah-glass-light` for row cards and `badge-ghost`.
3. Moderate: at 320 and 245 the "Sign in" button and chevron wrap to a third line under the avatar, left-aligned (`p6-two-320-accounts-light.png`, `p6-two-320-accounts-dark.png`). Usable, but the row loses the right-aligned action column. `accounts-tab.component.ts` row layout (around lines 205-240).
4. Moderate: the lane cell sits in a horizontally scrolling matrix at every width (row `78-694` at 520, `5-622` at 245), so the Model and Effort cells need a scroll to reach. The 208 px cell does not push them (criterion 9 holds), but the matrix was already scroll-based. The cell truncates with an ellipsis and carries the full name in `title` and `aria-label`.
5. Minor: the audit flags `Save` (1.31:1) and `Sign in` (1.04:1) in dark. This is a false positive: the audit reads a gradient gold background as the theme colour. The screenshots show dark text on gold (about 9:1 by eye). No action. The same applies to the "all 1.02" contrast list at `two-320` light; the screenshot `p6-two-320-accounts-light.png` renders correctly, so it was a measurement taken mid-transition.
6. Minor: in the popover, the "Save to" select renders as an empty dark bar in every capture. It is a faked-RPC artifact (the config scope is not mocked), not a P6 defect.
7. Minor (shell, not P6): at 245 px the whole app shell is wider than the window, so the page header and right-hand panels are cut off (`p6-two-245-lane-dark.png`). The settings content is reachable only through scripted clicks, because Playwright cannot scroll to the clipped tab buttons.

## Prototype fidelity

- Approved prototype: `prototype/p6/index.html` (plus `prototype/p6/shots/A*.png`, `L1`).
- Fidelity assessment: MATCHES for structure and component choice; DEVIATES slightly in light-theme border treatment (moderate 2).
- Account field in the popover: label + native select + `Sign in` link (not shown in these captures because every shown stored account state has no signed-out stored one in the popover), `(sign in first)` disabled options, `⚠ Removed account` disabled selected option with an `sr-only` sentence and `aria-invalid="true"`: all present (`p6-removed-360-popover-light.png`). Option order: `Existing Claude login`, named accounts, matching the spec.
- Lane cell: "Account" label + mono trigger with a chevron under the agent name; stored signed-out shows `(not signed in)`; removed shows `⚠ Removed account`; the menu is a `menu` of `menuitemradio` with the checked item disabled (`p6-two-245-lane-menu-dark.png`).
- Accounts tab: the existing login first, then named rows; "Used by" chips (Chat, Lanes); Manage chevron on every named row; Sign in only on the signed-out row; `Signing in…` spinner on the pending row, with Manage kept (`p6-pending-360-accounts-dark.png`); no visible helper sentences. `Last checked just now.` appears in `innerText` only as `sr-only` text (criterion 19).
- Zero named accounts: the popover Account field is absent and the lane cell renders nothing (width 0), consistent with P6-1.
- Before/after comparison: not applicable (a prototype exists).

## Viewport results

| Screen | Widths | Status | Evidence |
| ------ | ------ | ------ | -------- |
| Main popover (zero / two / removed / pending) | 520, 360, 320 | pass, no overflow, select 254-270 px | `p6-*-{520,360,320}-popover-{dark,light}.png` |
| Main popover | 245 | Serious 2 (header overflow, x clipped); select fits | `p6-*-245-popover-*.png` |
| Lane cell and menu | 520, 360, 320, 245 | pass for criterion 9 (cell 208 px max, ellipsis, menu inside viewport: 17-231 at 245); Serious 1 for height | `p6-*-lane-*`, `p6-*-lane-menu-*` |
| Accounts tab list | 520, 360, 320, 245 | pass (row `sw == cw`, no clipping) | `p6-*-accounts-*` |
| Account detail (one flat panel) | 520-245 | pass, no overflow; text: back arrow, name, state, Sign out, Check status, Name, Remove account | `p6-two-*-detail-*`, `p6-pending-*-detail-*` |
| 200% zoom: popover, lane menu, Accounts tab | 520, 245 | pass for the Accounts tab and lane menu; popover shows Serious 2 at 245 only | `p6-two-520z2-*`, `p6-two-245z2-*` |

Criterion 22 (real 200% zoom, no clipping or horizontal scroll): pass at 520; at 245 only the popover header issue.
Criterion 9: pass (cell never wider than 208 px, model/effort cells not pushed).
Criterion 13: pass (no visible helper sentences; row `px-4 py-3`, `space-y-3` visible in the captures; I did not read the class names).

## Component and interaction results

| Component | States tested | Status | Evidence |
| --------- | ------------- | ------ | -------- |
| Popover Account select | default, Tab/focus-visible, removed (`aria-invalid`), 245/200% | pass: 2 px ring `oklch(0.96)` plus a 5 px glow, `:focus-visible` true | `p6-two-520-popover-focus-*.png` |
| Popover tab order | 10 stops | Tab leaves the select toward model search, effort buttons, Cancel (reachable) | `results-all.json` `popTabs` |
| Lane trigger | focus-visible, Enter opens menu, first item focused, Escape closes and returns focus to the trigger | pass | `p6-two-520-lane-focus-*`, `-lane-menu-*` |
| Lane menu items | 32 px (48-64 px for the long name), checked item disabled | pass | `laneMenu` in results |
| Accounts tab chips / Manage / Sign in | Tab order: tabpanel, Add, Manage, Sign in, Manage, Close; Manage 32x32 | pass | `p6-two-520-accounts-kbd-*` |
| Pending row | spinner + `Signing in…`, Manage kept, no Sign in | pass | `p6-pending-360-accounts-dark.png` |
| Add form duplicate name | alert toast, input keeps focus ring | pass | `p6-toast-over-drawer-360-dark.png` |

## Design system compliance

- Chips: expected a readable badge, observed `badge-sm` 10 px (moderate 1).
- Light-theme row card and chip border: expected `--edge` equivalent, observed none (moderate 2).
- Other values (gold primary, mono trigger, rounded-3xl cards) match the dark theme and the prototype.

## Accessibility audit

- Contrast (measured, text only; gradient buttons excluded as false positives): popover light min 5.35:1; lane cell dark min 11.7:1, light 5.93:1; drawer dark min 11.9:1, light 6.49:1.
- Targets: Manage 32x32, menu items 32 px, popover select 32 px; the lane trigger 16 px (Serious 1).
- Focus: visible 2 px ring on the popover select and lane trigger, and a glow; Escape returns focus to the lane trigger; Tab walks in a sensible order.
- Live regions (open point from P1): the two `sr-only` regions (`settings-toast-live-status`, `settings-toast-live-alert`) are outside the drawer, but the drawer is `popover="manual"` with `role="dialog" aria-modal="true"` (`libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts:69, 84-85`), not `showModal()`. So the page is not made inert: the regions have no `inert` or `aria-hidden` ancestor, and the alert region updated with "That name is already used." while the drawer was open. The visible toast is its own later popover and renders above the drawer (`p6-toast-over-drawer-360-dark.png`). The drawer case is NOT affected for inertness. Residual risk: `aria-modal="true"` makes some screen readers hide content outside the dialog; I could not test that with a screen reader. The Remove confirmation (a real `<dialog>` with `showModal()`) does make the page inert; a toast fired while it is open would not be announced, but P6's remove flow closes the dialog first (not exercised here).

## Visual performance

- No layout movement observed between Providers, Orchestration and the drawer in any scenario.
- The lane cell and popover select render with the first snapshot; no loading state was observed because the fake RPC answers immediately. Slow-answer states were not tested.

## Verdict

- Recommendation: REVISE (small fixes: lane trigger height, popover header wrapping; chips and light borders are moderate).
- Confidence: HIGH for geometry, overflow and zoom; MEDIUM for screen-reader announcement behaviour (not tested with AT).
- Key concern: the lane Account trigger is 16 px tall, under the 24 px target size (`claude-lane-account-cell.component.ts:33`).
