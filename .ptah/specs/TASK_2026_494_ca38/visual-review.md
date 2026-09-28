# Visual Review - TASK_2026_494_ca38 (Apps page)

## Summary

| Metric             | Value                                           |
| ------------------- | ----------------------------------------------- |
| Overall score        | 6/10                                             |
| Assessment            | NEEDS_REVISION                                   |
| Visual breaking       | 1                                                 |
| Serious               | 2                                                 |
| Moderate              | 2 (plus 2 cosmetic items noted and accepted, no action needed) |
| Viewports tested      | 1440x900, 1024x800, ~606px band (searched 500-620px, sidebar collapsed), 420x800 |
| Screenshots taken     | 29                                                |
| Components tested     | Electron shell tab row, Apps composer/transcript, surface switcher, stat/chart/table/list dashboard, form (text/select/radio/checkbox + submit), splitter, empty/fallback/eviction states |

## Environment

- Build verified: `dist/apps/ptah-extension-webview/browser` (built 2026-09-26 00:48:23, after the last source-affecting commit `9cc979b06` "batch 17" at 00:41:46; HEAD `46fbd2b66` is a docs-only commit). Confirmed via `git log --oneline -- apps/ptah-extension-webview libs/frontend/mcp-apps-page ...` and file timestamps — no rebuild was needed.
- Base URL: a local static server (`http://127.0.0.1:<port>`) serving that build directory, started by a capture script written for this review at `.ptah/specs/TASK_2026_494_ca38/visual/apps-visual.e2e.spec.ts` (config: `.ptah/specs/TASK_2026_494_ca38/visual/playwright.config.ts`; both under the task folder, nothing added under `libs/`). Chromium via Playwright 1.63.0.
- The webview was booted as an **Electron host** (`window.ptahConfig.isElectron = true`, the exact shape `apps/ptah-electron/src/preload.ts:34-47` injects), matching the harness's own precedent (`libs/frontend/webview-e2e-harness/src/lib/scenarios/boot/boot-progress.e2e.spec.ts`, `.../thoth/skills-lane-pickers.e2e.spec.ts`). Every RPC (`workspace:getInfo`, `chat:start`, `chat:continue`, `chat:abort`, `surface:change`, `surface:select`, `surface:action`, `surface:operation`) was answered by a scripted auto-responder over the generic `postMessage` transport; `surface:updated` pushes were built to the `SurfaceEnvelope`/`SurfaceChange` shapes in `libs/shared/src/mcp-apps-contracts/surface.types.ts`, cross-checked against `libs/shared/src/testing/fixtures/surface.ts` and `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md`.
- Viewports covered: 1440x900 (primary), 1024x800, a searched sweep of 500/520/540/560/580/600/620 (outer viewport, Workspaces sidebar collapsed) to locate the true 481-605px **container** width band, and 420x800 (stacked). See "481-605px band" below for why outer viewport != container width.
- Themes: `anubis` (dark, default) and `anubis-light` (forced via `document.documentElement.setAttribute('data-theme', ...)`, the same DOM effect `ThemeService` drives).

## Findings by severity

### Visual breaking

#### 1. The header's right-side action cluster (Configuration, Theme, Notifications) is not visible at a 420px viewport, and the last tab is at the very edge

- File: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:100-215` (navbar: logo, `flex-1` spacer, `role="tablist"` five-tab row, `flex-1` spacer, then the `ptah-global-config-menu` / `ptah-theme-toggle` / `ptah-notification-center` cluster — all plain flex children, no `flex-shrink-0`, `overflow-x-auto`, or a narrow-width fallback such as a menu button)
- Viewports affected: 420px (the design's own documented "embedded sidebar" width; `prototype/README.md` "Viewports demonstrated: ... embedded sidebar (~420-container toggle)")
- Screenshot: `stacked-420-dark.png`, `stacked-420-light.png`, `header-420-dark.png`
- Problem: at a full 420px viewport (Workspaces sidebar already collapsed via its own toggle), the top navbar shows the Ptah logo and all five tabs (`Chat Apps Tasks Tribunal Analytics`), but the Configuration/Theme/Notifications icon cluster that normally sits at the far right is not rendered anywhere on screen. Confirmed by direct measurement, not inference: `document.documentElement.scrollWidth === document.documentElement.clientWidth === 420` (no page-level horizontal scroll), but the **navbar row itself** has `scrollWidth: 536` vs. `clientWidth: 420` — 116px of its own content is clipped. The Configuration button's `getBoundingClientRect()` puts it at `x: 449.7` and the Notifications button at `x: 511.7`, both past the visible 420px edge, each still `display`/`visibility`/`opacity` normal (they are laid out and painted, just positioned off the clipped edge with no scrollbar to reach them).
- Impact: at the narrowest width this task's own documented viewport list targets, the user cannot reach the configuration menu, the theme toggle, or notifications while the Apps tab (or any tab) is open. This is exactly the kind of regression the R10 checklist's "the five-tab row at narrow widths" item exists to catch — B17 widened the row from four tabs to five (`batch-17-report.md`: "tab-row pin now expects the five tabs Chat, Apps, Tasks, Tribunal, Analytics"), and this review's evidence shows that widened row no longer leaves room for the icon cluster at 420px.
- Fix: give the navbar tab row an explicit `flex-shrink-0` (or convert the five tabs to a horizontally scrollable strip, `overflow-x-auto`) so it cannot silently displace its siblings, and re-verify at 420px that the icon cluster keeps a fixed non-shrinking slot (or collapses into an explicit overflow menu instead of disappearing). Whether the same problem exists with four tabs (pre-existing) or is new at five was not re-tested with the Apps tab hidden — worth a quick A/B before scoping the fix.

### Serious

#### 2. Below 606px container width, the surface panel drops to 250-310px, well under its own documented 360px minimum — confirms option (a) of the R10 481-605px question

- File: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:49-51` (`SPLIT_HANDLE_WIDTH = 6`, `SURFACE_MIN_WIDTH = 360`, `STACKED_MAX_WIDTH = 480`) and `:297-306` (`splitMaxWidth` computed: `max(splitMinWidth, min(staticMax, containerWidth - handleWidth - SURFACE_MIN_WIDTH))`, where `splitMinWidth = layout.appsSplitMinWidth = 240`)
- Viewports affected: container widths 481-605px (searched outer viewports 560-620px with the Workspaces sidebar collapsed)
- Screenshot: `narrow-band-580-dark.png` (containerWidth 516px), console evidence in the review run log (reproduced below)
- Problem: the class doc for `AppsPageComponent` states the splitter "clamps so the surface panel keeps >= 360px." The clamp math does keep the *conversation* column's own floor (`splitMinWidth = 240`), but when `containerWidth - 6 - 360 < 240` (i.e. `containerWidth < 606`), `splitMaxWidth` resolves to `240` (the conversation floor) rather than the narrower `containerWidth - 6 - 360` figure — so the conversation column stays at its 240px floor and the **surface panel absorbs the entire shortfall**, landing well under 360px:
  | Outer viewport (sidebar collapsed) | Measured container width | Conversation | Splitter | Surface panel |
  | --- | --- | --- | --- | --- |
  | 540px | 476px | stacked (single column) | — | — |
  | 560px | 496px | 240px | 6px | **250px** |
  | 580px | 516px | 240px | 6px | **270px** |
  | 600px | 536px | 240px | 6px | **290px** |
  | 620px | 556px | 240px | 6px | **310px** |
  This matches — and sharpens — the batches.md carry-over note ("Container widths of 481-605px give the panel only 115-239px: DEFERRED to the R10 visual review"); this run's own numbers (250-310px) land a bit higher than that earlier estimate but are still 50-110px short of the component's own stated 360px floor.
- Impact: in the entire 481-605px container-width band, the surface panel — the half of the page actually showing the dashboard/form — renders at 60-85% of its designed minimum width, cramming stat tiles, tables and forms into a column narrower than intended, while the conversation column keeps its full 240px regardless.
- Fix: **this is direct evidence for R10 option (a)** — raise the stacking breakpoint from 480px to ~606px (`STACKED_MAX_WIDTH` and the matching `@container apps-page (max-width: 480px)` rule in the same file, plus `apps-surface-panel.component.ts:158`'s `@container apps-surface (max-width: 480px)`), so the two-column layout never renders below the width where both documented minimums (240 conversation + 6 handle + 360 surface = 606) actually fit. Below 606px the page would stack instead, which is already a working, tested state (see `stacked-420-dark.png`).

#### 3. Splitter/stacking mismatch at the exact 480px container-width boundary (intermittent)

- File: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:291-295` (`stacked` computed, driven by a `ResizeObserver` callback) vs. the CSS `@container apps-page (max-width: 480px)` rule (`:104-121`, evaluated synchronously by the browser's own layout, not by Angular)
- Viewports affected: container widths just above the 480px stacking threshold (outer viewport 560-580px with the sidebar collapsed) — reproduced in 3 of 4 capture runs, at a slightly different exact width each time (560px in two runs, 580px in the third), never reproduced at the same width twice in a row
- Screenshot: `narrow-band-boundary-560-settled-dark.png` (a clean run); review-log evidence from a reproducing run: `viewport=580 containerWidth=516 {"conversationWidth":240,"surfaceWidth":0,"gridTemplateColumns":"240px 0px 276px","splitterVisible":false}`
- Problem: `stacked()` is computed from a `ResizeObserver`-reported width (async, one JS task behind actual layout), while the CSS container query that also reacts to the page's inline size is synchronous with layout. At container widths just above the 480px stacking threshold, this review's script repeatedly (though not deterministically, and not at a fixed exact width) observed a torn frame: the splitter handle was removed from the DOM (Angular's `stacked()` signal said "stacked," hiding it via `@if (!stacked())`) while the CSS grid template still showed three tracks with the surface-panel track collapsed to 0px (the browser's container query said "not stacked," but no explicit width was ever set because the splitter handle it would size against wasn't there). A 300ms settle wait did not change the torn state once it occurred. The varying width at which it triggers across runs (560px twice, 580px once) points at timing (event-loop/paint scheduling) rather than a fixed pixel value, consistent with an async/sync race rather than a CSS math error.
- Impact: a user resizing the window (or the embedded sidebar) through this exact width may, intermittently, see the surface panel collapse to 0px width for a frame — not a crash, but a real, if narrow and hard-to-reliably-reproduce, layout glitch right at the boundary this review's own item 2 recommends moving.
- Fix: likely resolved as a side effect of item 2 (moving the breakpoint to ~606px does not remove the underlying async/sync race, but changes where it can occur); if kept separate, consider deriving `stacked()` from the same `@container` value the CSS uses (e.g. `container-size` read via `getComputedStyle` synchronously in the resize handler, or a signal written inside a render-phase effect) rather than trusting the `ResizeObserver` callback's timing to match Angular's own change-detection tick.

### Moderate and minor

- **Stat tile density and delta phrasing deviate from the approved prototype** (already flagged and deferred to this review in `batches.md`: "Carried to the R10 visual gate: stat density (text-lg/p-3 vs the prototype's compact tile) and delta phrasing"). Confirmed: the real implementation's stat tiles (`dashboard-populated-dark-1440.png`) are large, full-width, stacked blocks ("DEPLOYS THIS WEEK" / "42 deploys" / "Change: +5"), versus the prototype's compact three-across row of small bordered cells (`prototype/screenshots/dark-populated-wide.png`). Delta phrasing also differs: the prototype shows a signed delta inline in the tile header ("Δ +1 vs last week"); the real page shows "Change: +5" as a separate line below the value. All stat values render in a single accent color (`text-primary`) rather than the prototype's per-tile tone, which batches.md notes is correct because "the contract has no tone field." This is a real, visible density/layout difference from the visual source of truth, not a new defect — recorded here per the R10 gate's own instruction to carry it forward. File: `libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts` (not modified in this review).
- **Nested `role="separator"`**: the splitter's `ariaSnapshot()` reads as `- separator "Resize the conversation column": - separator` — a bare, unlabeled child `separator` node inside the labeled parent one. File: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:247-270` (`role="separator"` on the outer `div`) wrapping `<ptah-electron-resize-handle>`, which appears to expose its own `role="separator"` internally (`ElectronResizeHandleComponent`, `libs/frontend/chat-ui`, not reviewed in detail here). A screen reader landing on the splitter is exposed to two separator stops for one control, one of them with no accessible name. Not visual-breaking, but worth a follow-up: either suppress the inner element's own role (it is purely visual/pointer-only) or move the `aria-*` attributes onto it instead of duplicating the wrapper.
- **AppWindow icon vs. the approved prototype**: cosmetic difference only (a different glyph than the prototype's hand-drawn SVG), already accepted per `batches.md` ("The `AppWindow` icon is ACCEPTED, as planned. The R10 visual review may revisit it."). No change recommended; screenshot: `apps-tab-unselected-dark-1440.png`.
- **`tabs-lifted` rendering**: the real compiled build shows the Apps tab as a bordered/boxed active state (`shell-chat-dark-1440.png`), distinct from the prototype's plain underline (which the prototype's own README documents as a CDN-fidelity workaround, explicitly not a request to drop `tabs-lifted` from the real component). Matches expectation; no finding.

## Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_494_ca38/prototype/index.html` (+ `states.html`, `screenshots/`).
- Fidelity assessment: **DEVIATES** (in the ways already disclosed and deferred to this review by `batches.md`, plus the new findings above).
- Deviations observed:
  - Stat tile density/delta phrasing (moderate, see above; already known/deferred).
  - `tabs-lifted` visual differs from the prototype by design (prototype-only CDN workaround; not a deviation from intent).
  - AppWindow icon differs from the prototype's hand-drawn SVG (accepted).
  - Empty-state copy matches verbatim: both prototype and build read "Ask for a dashboard or a form in the conversation to get started." (`empty-dark-1440.png` vs. `prototype/screenshots` empty state).
  - Eviction notice + rejected-fallback stacking matches the prototype's pattern (orange left-spine block, icon + text, `role="status"`/`role="alert"`-style presentation) — `eviction-notice-dark-1440.png`.
  - Surface switcher (`role="tablist"`, underline-style tabs) matches the prototype's switcher pattern.
  - The prototype has no splitter (added later, in B15/B20, after the prototype was approved) — no comparison possible there; reviewed against the code's own doc comments instead (see findings 2-3).
- Before/after comparison: not applicable — a prototype exists for this task.

## Viewport results

| Screen / state | Viewport | Status | Screenshot |
| --- | --- | --- | --- |
| Electron shell, Chat active | 1440x900 | Pass | `shell-chat-dark-1440.png` |
| Apps tab, empty state | 1440x900 | Pass | `empty-dark-1440.png` |
| Dashboard (stats, chart, table+pager, list) | 1440x900 | Pass (density deviation noted above) | `dashboard-populated-dark-1440.png` |
| Dashboard | 1024x800 | Pass | `dashboard-viewport-dark-1024.png` |
| Dashboard | 600 outer / measured 536 container | Two-column, surface panel 290px | `dashboard-viewport-dark-600.png` |
| Dashboard | 420x800 | Stacked; header icon cluster missing | `dashboard-viewport-dark-420.png` — **Visual breaking #1** |
| 481-605px container band | outer 560-620, sidebar collapsed | Surface panel 250-310px, under its 360px floor | `narrow-band-580-dark.png` — **Serious #2** |
| Stacking boundary (~480px) | outer 560 | Intermittent torn frame (2/4 runs) | `narrow-band-boundary-560-settled-dark.png` — **Serious #3** |
| Stacked layout | 420x800 | Pass, no page-level horizontal overflow | `stacked-420-dark.png`, `stacked-420-light.png` |
| Stacked layout | 420x800, light theme | Pass | `stacked-420-light.png` |
| Dashboard | 1440x900, light theme | Pass | `dashboard-populated-light-1440.png` |

## Component and interaction results

| Component | States tested | Status | Screenshot(s) |
| --- | --- | --- | --- |
| Electron tab row | default, Apps active, keyboard-focused | Pass at 1440; breaks at 420 (see finding 1) | `apps-tab-unselected-dark-1440.png`, `focus-tab-row-dark-1440.png` |
| Apps composer | empty, filled, sent (user bubble) | Pass | `empty-dark-1440.png`, `dashboard-populated-dark-1440.png` |
| Dashboard stat/chart/table/list | populated, chart Expand toggled, table page 2 | Pass (density deviation noted) | `dashboard-chart-expanded-dark-1440.png`, `dashboard-table-page2-dark-1440.png` |
| Surface switcher | 2 valid surfaces, 2 failed surfaces, rapid switch | Pass — fallback text present immediately after each switch in both directions, no empty/blank intermediate frame observed synchronously | `switcher-two-surfaces-dark-1440.png`, `two-failed-switcher-dark-1440.png` |
| Form (text/select/radio/checkbox) | default, typed+optimistic overlay, filled via echo, validation error, submit pending, submit sent | Pass | `form-surface-dark-1440.png`, `form-typed-optimistic-dark-1440.png`, `form-filled-dark-1440.png`, `form-validation-error-dark-1440.png`, `form-submit-sending-dark-1440.png`, `form-submit-sent-dark-1440.png` |
| Host rejection (invalid spec) | fallback text, `role` region | Pass | `host-rejection-dark-1440.png` |
| Eviction notice | notice + fallback together | Pass — reads clearly, consistent left-spine treatment | `eviction-notice-dark-1440.png` |
| Splitter | focused, keyboard-resized, mouse-dragged | Pass (after fixing this review's own read-timing race — see below) | `splitter-focused-dark-1440.png`, `splitter-keyboard-resized-dark-1440.png`, `splitter-dragged-dark-1440.png` |

Note: the splitter's `aria-valuenow` is bound to a zoneless-OnPush computed signal; this review's script initially read the attribute synchronously right after `page.keyboard.press()` and saw a stale, unchanged value on one run. Polling for the change (`expect.poll`) confirmed the real behavior is correct (360 -> 392 after two `ArrowRight` presses, +16px each). Recorded here so the same trap isn't mistaken for a product bug by a future automated check with the same synchronous-read pattern.

## Design system compliance

- "Sent" status text: `text-success` (`surface-layout.component.ts:68`). Matches the prototype's `index.html:592` (`status.classList.add('text-success')`) and the batches.md decision ("B15 made it green, per the prototype"). See Accessibility below for the measured ratio.
- Stat tile treatment: does not match the prototype's compact-tile spec (see Moderate findings) — a known, deferred deviation, not newly introduced.
- Rejected/error inline text: plain `text-base-content` with an icon + colored left spine, no colored body text — matches the prototype's `[lane-proposed]` "no color-only encoding" rule (`prototype/README.md` "Lane-introduced constraints"). Confirmed in `host-rejection-dark-1440.png` and `form-validation-error-dark-1440.png`.

## Accessibility audit

- **Contrast** ("Sent" status text, `text-success` on its enclosing surface): measured via a canvas-based CSS-color-to-RGB conversion (the theme resolves computed colors as `oklch(...)`, not `rgb(...)`, so a naive `rgb()` regex silently reports a false 1:1 ratio — caught and fixed during this review). Result: foreground `rgb(22,163,74)` on background `rgb(19,19,23)` = **5.62:1**, passing WCAG AA's 4.5:1 for normal text with margin. Close to the prototype's own cited figure (≈4.65:1 for `text-success` on `base-300`, `prototype/README.md` "Contrast, dark theme"); the small difference is expected since the two aren't on identical background layers.
- **Focus order / keyboard reachability**: the Apps tab is reachable by `Tab` from the shell header (`focus-tab-row-dark-1440.png`) and activates on click; this review did not separately confirm `Enter`/`Space` activation on the focused tab button (a gap — the code path is a plain `<button>`, which activates on both by native HTML semantics, but that assumption was not screenshotted here).
- **Semantic structure**: surface switcher uses `role="tablist"`/`role="tab"`/`aria-selected` (`apps-surface-panel.component.ts:166-190`); the splitter uses `role="separator"` with `aria-orientation`, `aria-valuenow/min/max`, `aria-controls`, `aria-label` (`apps-page.component.ts:247-263`) — all present and correct per the `ariaSnapshot()` read, aside from the nested-separator note under Moderate findings.
- **Target size**: not separately measured in this pass (no dedicated bounding-box sweep of every button against the 24x24 CSS px WCAG AA criterion) — a gap in this review's coverage, called out rather than assumed clean.
- **Escape-to-cancel a keyboard resize**: confirmed absent by reading the code (`apps-page.component.ts` has no `keydown.escape` handler on the separator, only `commitKeyResize()` on `keyup`/`blur`), consistent with the R10 checklist's "note only, not a requirement." Not exercised interactively.

## Visual performance

- No layout-shift measurement tooling (CLS) was run; this review relied on screenshot comparison only. The intermittent torn frame at the ~480px stacking boundary (Serious #3) is a layout-shift-adjacent finding, evidenced by a reproducible-but-not-always DOM/CSS mismatch rather than a CLS score.
- Surface-switch "no flash": verified only by asserting the fallback text was present in the DOM immediately (no `await` gap) after each switcher click in both directions — this proves no *stale-content* flash (never briefly showing the wrong surface's content), but does not prove the absence of a one-frame blank/white flash at the paint level, which would need video capture. Recorded as a residual gap, not a pass/fail claim beyond what was checked.

## What the harness could not show

- Splitter width persistence across a real Electron app restart (`ElectronLayoutService`'s persisted-state round trip) — this review only exercised the in-memory signal within one page load.
- The DevTools network check for Req 9.2 (already flagged in `batches.md` as open manual QA).
- The surface-tool permission prompt for `ptah_surface_update`/`ptah_surface_get_state` (`.ptah/specs/TASK_2026_538_3ccf/handoff-494.md` "A2 (open, manual QA check)") — this harness never reaches real MCP tool-call permission UI, since every RPC was a scripted stub.
- Real assistant/tool-call rendering in the Apps transcript (the review only exercised typed user bubbles and the client-stamped "Submitted: ..." bubble; no `chat:chunk` text/tool deltas were streamed to keep the script's surface simple).

## Verdict

- Recommendation: **REVISE**
- Confidence: HIGH for findings 1 and 2 (both reproduced consistently across the same script run and are traceable to specific file:line CSS/layout logic); MEDIUM for finding 3 (real but intermittent — reproduced in half of four attempts).
- Key concern: at a 420px viewport — a width this task's own prototype documents as a target ("embedded sidebar (~420-container toggle)") — the header's Configuration/Theme/Notification controls are not visible anywhere on screen, with no page-level horizontal scroll available to reach them. This is the highest-severity finding and should block merge until confirmed fixed or explicitly deferred by the coordinator with a tracked follow-up. The 481-605px container-width finding (Serious #2) is strong, direct evidence in favor of R10 option (a) — raising the stacking breakpoint to ~606px — over keeping the current 480px threshold.
