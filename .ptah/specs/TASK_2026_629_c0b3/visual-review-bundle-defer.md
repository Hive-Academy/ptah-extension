# Visual Review - TASK_2026_629_c0b3 - bundle `@defer (on idle)` round (session 13 r2)

`S` = `W\.ptah\tmp\final-run\shots\` (W = worktree root). "Before" = the renderer built from the previous head
(dist at 04:04, before this change). "After" = the rebuilt renderer with the three `@defer (on idle)` blocks.
I took fresh `before-s13defer-*` shots and measurements from the old build before rebuilding, so each delta below
is old build against new build on the same workspace, the same theme and the same window (1600x967), not against an
older shot.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Visual breaking | 0 |
| Serious | 0 |
| Moderate | 1 (transient layout shift when the queue control swaps in) |
| Minor | 1 (Rail "lanes" action does nothing before idle) |
| Viewport | 1600x967, dark (`anubis`) and light (`anubis-light`) |
| Screenshots | 14 after + 9 before in `S` (`after-s13defer-*`, `before-s13defer-*`) |
| Components tested | Session details aside, Session details dialog (split), lane tabs, needs-you queue control, Rail "lanes" action, empty board |

## Environment

- Build: `node .ptah/tmp/check-run.mjs defer-build -- npx nx run ptah-electron:build-dev` (exit 0, started 11:07:20, no wait for
  the lock) then `node .ptah/tmp/check-run.mjs defer-copy -- npx nx copy-renderer-dev ptah-electron --parallel=1` (exit 0).
  `dist/apps/ptah-electron/renderer/index.html` is 11:08:33, newer than the start. Logs: `%TEMP%\629-check-defer-build.log`,
  `%TEMP%\629-check-defer-copy.log`. The new bundle has `ptah-canvas-lane-tabs`, `ptah-canvas-needs-you-queue` and
  `ptah-canvas-session-details` as selectors in separate lazy chunks (`chunk-O5MYTA6J.js`, `chunk-QHSTMMOF.js`, `chunk-DODJ2EXK.js`).
- Launch: `launch.mjs` (CDP 9333). `D:\projects\ptah-final-run-ws` (sessions S2, S4, S3, S1 and the repo-stats one) and
  `D:\projects\ptah-s13-empty-ws` (empty board). No new folder or workspace was created; no git ran in the final-run workspace;
  no source file was edited; no state-changing git. The app is closed (no listener on 9333).
- Method: `getBoundingClientRect` over CDP on the host elements; a `PerformanceObserver` for `layout-shift` with sources plus a
  per-frame rect sampler (`requestAnimationFrame`) across a page reload; `requestIdleCallback` held back to photograph the placeholder
  state. Scripts: `S\..\sd-*.mjs`.

## Result table

Rects are `[x, y, w, h]` in CSS px. Delta = after minus before.

| Check | Before shot | After shot (dark / light) | Measurement | Result |
| --- | --- | --- | --- | --- |
| Rail board with Session details aside (single pane, 1600x967) | dark `before-s13defer-02-dark-rail.png`; light `before-s13defer-01-light-rail.png` | dark `after-s13defer-10-dark-rail.png`; light `after-s13defer-01-light-rail.png` | Rail aside `[346,77,288,890]`; focus area `[634,77,638,890]`; right aside `[1272,77,296,890]`; `ptah-canvas-session-details` `[1273,77,295,890]`. Identical before and after, both themes. Delta 0 px on x, y, w, h. No horizontal scroll (`scrollWidth` 1600 = `clientWidth`). | PASS |
| Focus area lane tabs | same shots as above (and `before-s13defer-03/04`) | dark `after-s13defer-12-dark-lanetabs-focus.png`; light `after-s13defer-04-light-lanetabs-focus.png` | `ptah-canvas-lane-tabs` host `[634,125,638,36]`, display `block`; "Orchestrator" tab `[642,125,103.48,36]`, "codex" tab `[821.39,125,66.69,36]`; the tab strip's siblings are the header `[634,77,638,48]` and the lane view `[634,161,638,806]`. Identical before and after in both themes. Delta 0 px. | PASS |
| Needs-you queue control and the dock controls | `before-s13defer-02` (dark), `before-s13defer-01` (light) | dark `after-s13defer-10`; light `after-s13defer-01` | Dark: "All clear" `[1392.58,46,53.13,24]`, "New Session" `[1453.7,46,102.3,24]`. Light: `[1390.58,46,53.13,24]` and `[1451.7,46,104.3,24]`. Identical before and after. Delta 0 px. (The 2 px dark/light difference is the same in the old build: the New Session button text width.) Footer controls (New session, Attach, Opus 5.5, High, Voice, Send, Full Auto, Peer) are unchanged at the same rects (they are eager). | PASS |
| Placeholder state (idle held back) | n/a (old build had no placeholders) | dark `after-s13defer-15-dark-placeholders.png` | Lane strip placeholder `[634,125,638,36]` (same rect as the loaded host); queue placeholder `[1393,46,53,24]` against the loaded `[1392.58,46,53.13,24]`; New Session stays at `[1454,46,102,24]`; details aside `[1272,77,296,890]` with the heading `Session details` at the same y as the loaded one (about 103 px). The aside only gets its content (Context, Tokens, ...) on load; nothing already on screen moves. | PASS for the placeholders' footprint |
| Empty board | dark `before-s13defer-07-dark-empty.png`; light `before-s13defer-08-light-empty.png` | dark `after-s13defer-21-dark-empty-board.png`; light `after-s13defer-20-light-empty-board.png` | Rail `[572,77,272,890]`; no focus area, lane tabs or details (nothing to defer). Queue `[1392.58,46,53.13,24]` dark / `[1390.58,46,53.13,24]` light, "New Session" `[1453.7,46,102.3,24]` / `[1451.7,46,104.3,24]`. Identical. Delta 0 px. The reload probe shows the queue already loaded by 409 ms with no layout shift on this board. | PASS |
| Split pane with the "Session details" dialog | `before-s13defer-05-light-split.png`, `before-s13defer-06-light-split-dialog.png` | light `after-s13defer-05/06`; dark `after-s13defer-13/14` | `role="dialog"` `aria-label="Session details"` `[1208,524.5,360,442.5]`; "Close details" button `[1209,524.5,92.66,32]`; inner `ptah-canvas-session-details` `[1209,556.5,349,442.5]`; same before and after, both themes. Opening it moves focus to "Close details". Clicking it removes the dialog and returns focus to the "Open details" button (before: same). Escape also closes it and returns focus to "Open details". Only one dialog node is present at any time. | PASS |
| Lane tabs keyboard focus (Rail "lanes" action, dense card "Open the 1 lanes of S2") | `before-s13defer-03-dark-dense-lanes.png` | dark `after-s13defer-11-dark-dense-lanes.png`; light `after-s13defer-03-light-dense-lanes.png` | After the click `document.activeElement` is the selected "Orchestrator" tab inside `ptah-canvas-lane-tabs` (`role=tab`, `aria-selected=true`), same as before. Arrow keys: Right goes to "codex", Left to "Orchestrator", End to "codex", Home to "Orchestrator"; roving `tabindex` 0/-1 correct. Identical to before in both themes. | PASS (after idle) |
| Same lanes action before idle (first 400 to 700 ms after load) | n/a | (no shot; scripted click at t = 540 and 727 ms in two runs) | The Rail card shows its lanes button before idle. The click happens while `ptah-canvas-lane-tabs` has no `[role=tab]` yet and the placeholder is still in place. `focus(id)` runs but `activeElement` stays `BODY` four seconds later, and the lane tabs finish mounting afterwards without taking focus. In the old build the tabs existed on first render. See Minor 1. | Deviates (narrow window) |
| First-load layout shift | n/a | `after-s13defer-02-light-after-reload.png` | Placeholders appear at about 700 ms, content at about 1130 to 1180 ms (about 430 ms of placeholders). Lane tab strip and the Details aside keep their rects through the swap, with no shift attributed to either. The queue control swap produced a transient shift in 2 of 4 runs (about 33 ms, CLS 0.021 and 0.035). See Moderate 1. | See finding |

## Findings by severity

### Visual breaking

None.

### Serious

None.

### Moderate

#### 1. The needs-you queue swap shifts the whole board 4 to 5 px for about two frames (intermittent)

- File: `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:112-121` (the `@defer` block and its placeholder); the inner template that
  fills in late is `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts:34-53` (`ptah-native-popover` projecting the trigger button).
- Viewport: 1600x967, dark and light (not theme dependent).
- Screenshot: `after-s13defer-02-light-after-reload.png` (final state); the shift is a one or two frame transient, so the evidence is the
  `layout-shift` entries, not a still frame.
- Problem: when the deferred chunk resolves, the placeholder (`span.btn.btn-xs` 53x24, invisible) is removed and the real host is inserted. For one
  or two rendered frames the host is `[1433,46,10,28]` and its `button.btn.btn-xs` is `[1431,43,16,30]` (no label yet, 30 px tall). Then it settles at
  `[1390,46,53,24]`. The 5 px height difference pushes `.session-viewport` from `[346,77,1222,890]` to `[346,81,1222,885]` and back
  (entries at t = 830 ms 0.0158 and t = 863 ms 0.0193 in one run; 1185 ms 0.0021 and 1195 ms 0.0193 in another). Other runs (2 of 4) had no
  queue-related entry at all, so the swap timing is a race. The old build rendered the host in the same pass as its parent, so it had no such frame.
  Total is 0.021 to 0.035 CLS, under the 0.1 "good" mark, so no layout break; it contradicts the expectation that the placeholders cause no layout shift.
- Impact: a roughly 30 ms flash (the board and "All clear" label jump about 5 px and the label is missing for a frame or two) once per load, on idle. No
  target moves under a click in practice (the window is under a tenth of a second and begins about a second after load).
- Fix: give the deferred host the same footprint as the placeholder before its inner popover renders, for example
  `<ptah-canvas-needs-you-queue class="inline-flex h-6 min-w-[53px] items-center">` inside the `@defer` block (or a `@loading` block that keeps the
  placeholder until the host has its label). Re-run the reload probe afterwards and expect no `layout-shift` source with `needs-you-queue`.

### Minor

#### 1. Rail "lanes" action is inert until idle

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:853-863` (`onLanesRequested`, which runs `afterNextRender` and
  focuses `[role="tab"][aria-selected="true"]`) against `canvas-focus-area.component.ts` (lane tabs now inside `@defer (on idle)`).
- Screenshot: none (focus state; measured as `activeElement` = `BODY`).
- Problem: a click on a Rail card's lanes button in the roughly 400 to 700 ms before the tabs mount (and any longer idle delay on a busy main thread,
  because `requestIdleCallback` has no timeout in Angular's `on idle`) does not move focus to the lane tabs. It focuses the session but the lane strip
  is still a blank `h-9` placeholder, and focus is not applied once the tabs arrive. The report from the fix lane lists this as a known first-mount risk.
- Impact: small. A human cannot click that fast right after load; a streaming session that keeps the main thread busy would stretch the window.
- Fix (optional): in `onLanesRequested`, retry the focus once the lane tabs host exists (for example wait for `ptah-canvas-lane-tabs` through
  a short `MutationObserver` or a `loaded` signal), or use `@defer (on idle; prefetch on idle)` with `on viewport`/`when` as an extra trigger so the tabs
  mount as soon as the focus area is shown.

## Prototype fidelity

- Approved prototype: no new surface in this round, so the before/after pass applies.
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison (no prototype):
  - Dark rail + details: `before-s13defer-02-dark-rail.png` against `after-s13defer-10-dark-rail.png`: no regression (all rects equal).
  - Light rail + details: `before-s13defer-01-light-rail.png` against `after-s13defer-01-light-rail.png`: no regression.
  - Dark lane tabs focus: `before-s13defer-03-dark-dense-lanes.png` against `after-s13defer-11-dark-dense-lanes.png`: no regression.
  - Light lane tabs focus: `before-s13defer-04-light-dense-lanes.png` / `before-s13defer-04-light-rail-normal.png` against `after-s13defer-03-light-dense-lanes.png` / `after-s13defer-04-light-lanetabs-focus.png`: no regression.
  - Light split + dialog: `before-s13defer-05/06` against `after-s13defer-05/06`: no regression.
  - Dark split + dialog: no old shot taken (the light pair has the same rects and the layout is theme independent); `after-s13defer-13/14` checked for the same rects.
  - Dark empty board: `before-s13defer-07-dark-empty.png` against `after-s13defer-21-dark-empty-board.png`: no regression.
  - Light empty board: `before-s13defer-08-light-empty.png` against `after-s13defer-20-light-empty-board.png`: no regression.

## Viewport results

| Viewport | Screens | Status |
| --- | --- | --- |
| 1600x967 dark | Rail + details, lane tabs, dock/queue, split + dialog, placeholders, empty board | PASS (one transient shift, Moderate 1) |
| 1600x967 light | same set | PASS (same transient) |

Other widths (1084, 984, `sm` band aside) were not opened in this round. The `sm`-band `aside` was reviewed in the previous round; its deferred
content has the same eager container and the same placeholder shape, but I did not measure it after the change, so I do not claim it.

## Component and interaction results

| Component | States tested | Status | Shot |
| --- | --- | --- | --- |
| Session details aside (right) | placeholder (held idle), loaded, both themes | PASS | `after-s13defer-15`, `-10`, `-01` |
| Session details dialog (split) | open, focus on "Close details", close by button, close by Escape, focus return | PASS | `after-s13defer-06`, `-14` |
| Lane tabs | placeholder, loaded, Right/Left/Home/End, roving tabindex, focus from the Rail lanes action | PASS (after idle); Minor 1 before idle | `after-s13defer-11`, `-12`, `-03`, `-04` |
| Needs-you queue control | placeholder (invisible, 53x24), loaded, empty board | PASS in steady state; Moderate 1 in transition | `after-s13defer-15`, `-21`, `-20` |
| Popover of the queue control | not opened (no pending requests in this workspace) | not tested | n/a |

## Design system compliance

No colour, type or spacing change. Rects and computed layout are identical, so tokens are unchanged. The queue placeholder is `invisible`
`aria-hidden`, so it adds no visible or announced text. The lane-tab and details placeholders are also `aria-hidden`.

## Accessibility audit

- Roles and names after load are unchanged: `role="dialog"` `aria-label="Session details"` with a "Close details" button; `role="tab"` lane tabs with
  roving tabindex and `aria-selected`.
- Focus order and return after closing the dialog are as before.
- Not re-measured (no colour or size change): contrast and target sizes.
- Reading order while placeholders show: the lane strip placeholder is `aria-hidden`, so the lane tabs appear in the accessibility tree only after load.

## Visual performance

- Placeholders on screen for about 430 ms after first paint (700 ms to about 1130 to 1180 ms in the reload probe).
- Layout shift: Moderate 1 (CLS 0.021 to 0.035 in 2 of 4 runs, none in the others); other shift entries on load (about 0.03 at 830 ms, the left rail
  and focus pane resizing, and a 0.0097 chat-scroll entry at about 3 to 5 s) come from code outside this change and also appear when no deferred
  block is involved.
- No janky motion or expensive effect added.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the steady state (every measured rect is identical in both themes, dialog and keyboard behaviour unchanged), MEDIUM on the
  transient (4 reload runs, race dependent).
- Score 8/10: nothing breaks and nothing in the loaded UI differs by a pixel; 1 point for the intermittent 5 px queue swap shift that contradicts the
  "no layout shift" expectation, and 1 point for the lanes action being inert before idle and the popover not being exercised.
- Key concern: the queue control's host has no footprint between the placeholder and its first rendered frame (Moderate 1).
