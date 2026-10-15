# Visual Review - TASK_2026_648

## Verdict: PASS WITH NOTES (7.5/10, confidence MEDIUM-HIGH)

No visual-breaking and no serious defects. Three moderate and two minor notes, none of them blocking.
The canvas session embed, the reference-counted visible-tab registration and the workflow badge all
behaved correctly in the running Electron build.

| Metric            | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Visual breaking   | 0                                                              |
| Serious           | 0                                                              |
| Moderate          | 3                                                              |
| Minor             | 2                                                              |
| Viewport tested   | 1 (1184x735 CSS px, the Electron window, DPR 1)                |
| Screenshots taken | 33 PNG, in `visual-review/`                                    |
| Themes            | Anubis (dark, the starting theme) and Anubis Light             |

## Environment

- Build verified: the app was already running as the built Electron development build. The renderer
  URL is `file:///D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/dist/apps/ptah-electron/renderer/index.html`,
  which is this worktree's `dist`. I attached over CDP at `http://127.0.0.1:9333` and did not start,
  rebuild or close the app. Evidence that the bundle contains the change under review:
  `ptah-session-embed` and `ptah-workflow-badge` exist in the DOM, and `tabManager.setWorkflow`,
  `visibleTabOwners` and `workflowIndex` exist on `TabManagerService`.
- Driver scripts are in `%TEMP%\ptah-648-visual\` (outside the repo). Screenshots are in
  `.ptah/specs/TASK_2026_648_374e/visual-review/`.
- Viewport: Electron cannot resize through CDP (`Browser.getWindowForTarget` is not implemented), so
  there was no responsive sweep. The window stayed at 1184x735. I collapsed the Workspaces and
  Sessions panels to widen the canvas and reach the expanded Rail. That sample is an audit selection,
  not a support contract.
- Starting state: theme `anubis`, layout `grid`, both side panels open, active tab S2. All of it was
  restored at the end (`Z-final-restored-state-dark.png`).
- Electron forces `layoutMode = 'grid'` in `electron-shell.component.ts:438`. The single layout has
  no UI there, so "normal chat" in Electron is the canvas. I also switched `appState.layoutMode` to
  `single` through the dev API to inspect the tab bar, then restored `grid`.

## Results of checks A-G

| Check | Result | Evidence |
| ----- | ------ | -------- |
| A. Normal chat | PASS (with a caveat) | `A1-new-session-canvas-dark`, `A2-new-session-created-dark`, `A3-send-OK-dark-streaming`, `A3-send-OK-dark-after` |
| B. Canvas rail and split | PASS | `B1-canvas-focus-dark`, `B2a-panels-collapsed-dark`, `B3a-rail-card-menu-dark`, `B4-split-two-panes-dark`, `B5-send-YES-split-dark-streaming`, `B5-send-YES-split-dark-after`, `B6-split-with-badge-sidebar-light` |
| C. Badges | PASS (3 moderate and 1 minor notes) | `C1-tagged-split-dark`, `C2-rail-card-badge-dark/light`, `C2b-*-crop-dark/light`, `C3-sidebar-badge-dark`, `C4-single-layout-tabbar-dark/light`, `C4b-tabbar-crop-dark`, `B1-canvas-focus-badge-dark/light`, `C5-focus-header-badge-crop-light` |
| D. Delete cleanup | PASS | `D1-before-delete-dark`, `D2-delete-confirm-dark`, `D3-after-delete-dark` |
| E. Tribunal | PASS | `E-tribunal-dark`, `E-tribunal-light` |
| F. Themes | PASS (partial light coverage, see "Not done") | light and dark pairs as listed above |
| G. Console | PASS | No new errors. Two warnings, both pre-existing (details below) |

### A. Normal chat (executed in the canvas, Electron's only layout)

- Created session "VR648-test" with the New Session button (`aria-label="Add new session tile"`) and
  the naming popover. The tab was `status: fresh` with no session id and registered as visible.
- Sent exactly `Reply with the single word OK.` The sampled state went to `streaming` (tab in
  `streamingTabIds`, header chip "running") and a button with `aria-label="Stop generating"` was
  present, and the composer showed the red stop square (`A3-send-OK-dark-streaming`). It ended in
  `loaded` after about 8 s with "OK" rendered, token and cost chips shown (6 tokens, $0.35), the
  Stop control gone and the composer empty and usable (`A3-send-OK-dark-after`). The sidebar row
  "VR648-test, Just now" appeared on its own.
- Caveat: the reply was one word, so I could not observe incremental text growth. What I saw was
  the live transition streaming to done and the final content in the pane without any reload.
- A new notification badge appeared (1, then 2). That is expected and unrelated.

### B. Canvas rail and split

- DOM, focused pane: `ptah-canvas-detail-transcript > ptah-session-embed > ptah-chat-view` (verified
  through `firstElementChild` at each level). There was exactly 1 `ptah-chat-view` per pane.
- A second `ptah-chat-view` exists in `ptah-app-shell` under `div.h-full.hidden`
  (`offsetParent === null`, 0x0). It is the hidden single-layout host and is pre-existing by design
  (`app-shell.component.html:835-837`). It registers no visibility: `visibleTabOwners` held only the
  canvas pane's tab (owner count 1).
- Split: Rail card menu "Session actions" then "Open beside" (S2 beside VR648-test). The result was
  2 `ptah-canvas-detail-transcript`, each with `ptah-session-embed > ptah-chat-view`, one chat view
  per pane (`B4-split-two-panes-dark`). `visibleTabOwners` held both tabs at count 1 each. The panes
  stack vertically (container narrower than 1440), each 806x400 px, divider
  `data-pane-divider="horizontal"`, no horizontal scroll.
- Live streaming in a split pane (the visible-tab registration proof): sent exactly
  `Reply with the single word YES.` in pane 1 (VR648-test). Status went `streaming` to `loaded`, the
  header chip showed "running", the Stop control appeared, skeleton bubbles showed while streaming,
  and "YES" rendered in that pane when it finished (`B5-send-YES-split-dark-streaming`, `...-after`).
  The other pane stayed untouched.
- Ref-counting lifecycle, observed in `visibleTabOwners`: open split gives {A:1, B:1}. "Close split"
  gives {B:1} (the closed pane's registration was released and nothing leaked). Clicking another card
  swaps the registration to that tab (count 1). Switching to the single layout gives {} (the single
  host does not register, and `BatchedUpdateService.canFlush` falls back to the active tab when the
  set is empty, `batched-update.service.ts:171-178`). Switching back to grid restores the canvas
  registrations. Deleting the session leaves only the surviving focused tab registered.

### C. Badges (tag applied with `tabManager.setWorkflow(tabId, 'harness-configure')` plus `ng.applyChanges`)

| Surface | Result | Evidence |
| ------- | ------ | -------- |
| Tab bar (single layout only, VS Code layout) | PASS. The badge renders left of the title. Neighbouring untagged tabs are unchanged | `C4-single-layout-tabbar-dark/light`, `C4b-tabbar-crop-dark` |
| Sidebar session row | PASS. The row shows the badge after the session has an SDK session id (`c42bf470...`). Tagged row 55 px, untagged rows all 46 px, unchanged | `C3-sidebar-badge-dark`, `B6-split-with-badge-sidebar-light` |
| Canvas rail card (expanded) | PASS. Card height is identical (174 px) to untagged cards because the badge is absolutely positioned (`bottom-1 left-2`). Placement notes in M1 | `C2-rail-card-badge-dark/light`, `C2b-...-crop-*` |
| Canvas focus header | PASS. The badge is its own element in `ptah-canvas-focus-header`, between the title and the state chip. The 48 px header height is unchanged | `B1-canvas-focus-badge-dark/light`, `C5-focus-header-badge-crop-light` |
| Untagged sessions | PASS. All 6 other `ptah-workflow-badge` hosts (9 in the DOM with the split open, 3 of them tagged) rendered `<!--container-->` with offsetWidth/Height 0x0. They have no `span`, no gap and no layout change. The untagged S2 header in `B1-canvas-focus-badge-light` (before refocus) matches `00-initial-state` | |

- Accessible label: the `span` carries `aria-label="Workflow: Configure Harness"` in every location
  (read from the DOM).
- Contrast of the badge text (measured through `getComputedStyle` plus canvas, WCAG 2.x):
  dark #E8E6E1 on #1A1A20 is 13.89:1 (against the parent surface 12.46 to 14.86:1). Light #291334 on
  #EFEAE6 is 14.21:1 (against the parent 13.33:1). Both pass AA 4.5:1 by a wide margin. The badge
  border is `base-content/20`, subtle, but it is decoration, not a required component boundary.
- After deleting the session: 0 badges remain, `workflowIndex.entries` is `{}`, and the sidebar
  rows are back to the 5 originals.

### D. Delete cleanup

The session was identified with certainty. I created it and named it "VR648-test", the name was
unique, and the confirmation dialog repeated `Are you sure you want to delete "VR648-test"?`
(`D2-delete-confirm-dark`). I used `button[aria-label="Delete session: VR648-test"]` and confirmed
Delete. Afterwards the sidebar had 5 rows (S2, S4, "can you generate html stats...", S1, S3), the tab
was gone, `tabManager.tabs()` had 3 entries, the rail had 3 tiles, the workflow index was empty, and the
focus moved to an existing session (`D3-after-delete-dark`). No other session was touched.

### E. Tribunal

`ptah-tribunal-page` with `ptah-tribunal-empty-state` rendered ("Convene a Tribunal", Council, Forge
and Race cards, primary CTA) in both themes. No error alerts in the DOM. I did not start a run. I
returned to the Chat tab afterwards and the canvas came back (`E-tribunal-dark`, `E-tribunal-light`).

### G. Console (captured live with `page.on('console'/'pageerror')` from the start of the session)

- Errors: 0. Page errors: 0.
- Warnings (not new, not in the areas under review):
  - `NG0956` ("tracking expression caused re-creation of the entire collection of size 1"), 4 times,
    each time the focused tab changed (new session, close split, card click, sidebar click). Source:
    `canvas-lane-view.component.ts:73`, `@for (key of [tabId() + ':' + laneKey()]; track key)`. It is a
    deliberate re-key idiom from commit `19db607e8` (batch R9f). `git diff main` shows this file is not
    changed by TASK_2026_648. Dev-mode only.
  - `[Pricing] Model 'claude-opus-5-5' not found in pricing map` (pricing data, unrelated).
- Nothing mentioning session-embed, workflow badge, tab manager or canvas registration.

## Findings by severity

### Visual breaking

None.

### Serious

None.

### Moderate and minor

1. **Moderate, M1: Rail card badge sits flush on the stats row and bottom edge.**
   Element: `ptah-workflow-badge` inside the rail card, `class="absolute bottom-1 left-2 z-10"`
   (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:134-138`). Measured at 1184
   px wide: badge span at x80,y623, 90x14. Stats line "ctx 4% ... +3676 -0" at y607-623, so the gap is
   0 px. The badge host is 21 px tall (y618-639), so it overlaps the bottom 5 px of the stats row's hit
   area and sits 4 px above the card border. The badge's left edge (x80) is 7 px outside the text
   column (stats text starts x87). It also visually crowds "$0...." (which is truncated, but that
   truncation is pre-existing and also affects untagged rows with cost). Screenshots:
   `C2-rail-card-badge-dark.png`, `C2b-rail-card-badge-crop-dark.png`, `C2b-...-light.png`. Fix: put the
   badge in the flow (inside the compact card's header or footer row) or reserve a row, and align it to
   the card's text inset.
2. **Moderate, M2: Tab bar badge consumes about 45% of a tab and truncates the title.**
   In single layout (`ptah-tab-bar`, `tab-bar.component.ts:105`, slot `tabItemLeading`) the badge is
   91x14 px inside a 200 px tab. The title "VR648-test" got 35 px of the 66 px it needs and renders
   "VR6..." (measured `scrollWidth 66`, `clientWidth 35`; `C4b-tabbar-crop-dark.png`,
   `C4-single-layout-tabbar-light.png`). Real workflow tabs will have longer titles, so the title will
   be unreadable except through the tooltip. Fix: abbreviate the tab-bar badge (icon or 1-2 word label),
   or cap the badge and let the title keep a minimum width. This only affects the single layout (VS
   Code); Electron has no tab bar.
3. **Moderate, M3: Badge text is 9 px.** Computed `font-size: 9px` for every badge instance
   (`workflow-badge.component.ts`, `badge badge-xs`). WCAG has no minimum text size, and the
   contrast is high (13.9:1 and 14.2:1), so this is not an AA failure. By vendor guidance (about 11-12
   px minimum for UI text) it is small, and it is the only label that identifies the workflow. Fix:
   use `badge-sm` (about 12 px) if the layout allows it, together with M1 and M2.
4. **Minor, m1: `aria-label` on a role-less span.** The badge is a generic `span` with
   `aria-label="Workflow: Configure Harness"` (`workflow-badge.component.ts`). The ARIA spec does not
   allow naming a generic element, so some screen readers will ignore the label and read only the
   visible text "Configure Harness". The label text matches the requested string. Fix: add
   `role="status"` or `role="img"`, or drop the aria-label and use visually hidden prefix text.
5. **Minor, m2: after "Open beside" the top pane's transcript is not scrolled to the bottom.**
   The VR648-test pane showed only the user message and not Claude's "OK" reply (scroller
   `scrollTop 0`, `scrollHeight 287`, `clientHeight 105`; the other pane was at the bottom). The
   pane shrank from 574 px to 400 px, leaving 105 px of transcript. I had no pre-change build to
   compare, so I cannot tell if this regression is new or pre-existing resize behaviour. It is the
   one item worth a quick manual check against `main`. Screenshot: `B4-split-two-panes-dark.png`. With the
   window at 735 px the split leaves about 105-114 px of transcript per pane, which is cramped (the
   pane `min-h-[400px]` is by design).

Observations (not defects): the rail `button.rc-select` is covered by `ptah-compact-rail-card` on
every card (`elementFromPoint` returns the card host), so synthetic clicks on the button time out
while real mouse clicks on the card work. This is the same for untagged cards, so it is not caused
by this change.

## Prototype fidelity

- Approved prototype: None found for this task folder (no `prototype/` directory was used or
  required, since the task adds no new surface other than a conditional badge).
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison: no base-commit build was available. In its place I compared the running app
  against the untagged baseline in the same session. `ptah-canvas-detail-transcript` renders the same
  transcript, composer, stats bar and lane tabs as `00-initial-state.png` (the state when I began,
  before any interaction), in dark (`00-initial-state.png`, `A3-send-OK-dark-after.png`,
  `B1-canvas-focus-dark.png`) and light (`B1-canvas-focus-badge-light.png`, `C2-rail-card-badge-light.png`).
  No visual change attributable to `ptah-session-embed` was seen. Residual uncertainty: no true
  pixel diff against the base commit.

## Viewport results

| Viewport | Screen | Status | Screenshot |
| -------- | ------ | ------ | ---------- |
| 1184x735 | Canvas, panels open (rail collapsed) | OK | `A2-new-session-created-dark`, `D3-after-delete-dark` |
| 1184x735 | Canvas, panels collapsed (rail expanded) | OK | `B2a-panels-collapsed-dark`, `C2-rail-card-badge-*` |
| 1184x735 | Canvas split (stacked) | OK, m2 | `B4-split-two-panes-dark`, `B6-split-with-badge-sidebar-light` |
| 1184x735 | Single layout (tab bar) | OK, M2 | `C4-single-layout-tabbar-dark/light` |
| 1184x735 | Tribunal | OK | `E-tribunal-dark/light` |
| other widths | not opened | NOT DONE (see below) | |

## Component and interaction results

| Component | States tested | Status |
| --------- | ------------- | ------ |
| ptah-session-embed / ptah-chat-view (canvas) | idle, streaming (Stop control), done, split (2 panes) | PASS |
| ptah-workflow-badge | untagged (0x0, empty), tagged x4 surfaces, dark and light | PASS (M1-M3, m1) |
| Rail card actions menu | open ("Open beside", "Move up" disabled, "Move down") | PASS |
| Split menu | "Close split" | PASS |
| Delete session confirm dialog | shown, confirmed | PASS |
| Theme toggle | Anubis, Anubis Light, Anubis | PASS |

I did not run a full Tab-order focus pass; this task changes no focusable controls.

## Design system compliance

The badge uses the existing daisyUI `badge badge-ghost badge-xs` with `border-base-content/20` and
`text-base-content` theme tokens. It resolved to the theme palette in both themes (no hard-coded
hex). Only the 9 px size (M3) is off the usual body scale. Source for the expectation: the
repository's daisyUI/Tailwind usage in neighbouring components, with no separate design-spec in the
task folder.

## Accessibility audit

- Contrast: see C (13.89:1 dark, 14.21:1 light).
- Target size: the badge is non-interactive, so there is no target-size requirement.
- Semantics: m1.
- Standard applied: WCAG 2.2 AA (the repository declares no other standard).

## Visual performance

No layout shifts were observed when the badge appeared (tagged row grows 9 px by design in the
sidebar). The rail card and focus header heights were unchanged. Streaming rendered skeleton
bubbles first, then the final message, with no flicker. NG0956 warnings (G) flag a one-item list
re-creation on each focus change, which is pre-existing.

## Not done

- A's streaming screenshot in light, and light screenshots of the new-session and mid-stream states.
  The prompt budget was capped (one prompt in A, one in B). The light theme was covered with
  post-state screenshots only (focus, split, rail, sidebar, tab bar, Tribunal).
- Responsive sweep: the Electron window could not be resized through CDP, so only 1184x735 was
  reviewed. Expanding the Rail needs a wider canvas than that (the toggle reports "Widen the canvas"
  until the side panels are collapsed).
- A true before/after against the base commit (no base build was provided).
- Incremental token-by-token growth: the replies were one word.
- Focus-ring and keyboard tab-order pass.
- The single-layout A flow (a prompt sent in the single layout). Single layout has no UI in
  Electron. I only checked tab bar rendering and registration there.

## Verdict

- Recommendation: APPROVE (PASS WITH NOTES)
- Confidence: MEDIUM-HIGH. The visible-tab registration, the embed DOM, the badge in all four
  locations, the untagged no-badge path and the delete cleanup were all verified in the running app.
  The gaps are the single viewport and the missing base-commit comparison.
- Key concern: the tab-bar badge (M2) and the rail card badge placement (M1) are the only
  visible rough edges, and m2 (top pane transcript not scrolled to the end after splitting) is worth a
  quick check against `main`.
