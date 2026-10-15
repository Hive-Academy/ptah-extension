# Layout design spec: "Rail" board mode (TASK_2026_629_c0b3)

Status: proposal for Gate 1.7, revision 1 (decisions.md rows 43-44 are binding input; review: `layout-design-spec-review.md` Part A).
Prototype: `prototypes/02-focus-rail.html` (every number below is implemented there; the architect decides the code).
Evidence for the problem: `final-run-review.md` F4, F10; `r2-03-wide.png`, `r2-04-detail.png`.
Design system: DaisyUI themes `anubis` / `anubis-light`, real values from `apps/ptah-extension-webview/tailwind.config.js:97-105`
(dark base `#131317/#1a1a20/#242430`, content `#e8e6e1`) and `:165-170` (light OKLCH base/content); the prototype now uses them.
Requirement changes: AC 1.4 and the "1-2 sessions behave as today" NFR apply to **Grid mode only** (D9). Rail keeps AC 1.4's intent
(section 2). The layout record becomes **v3** (section 7).

## 1. Layout model

Three slots in one row plus a fixed rail header and footer. Widths follow the **canvas width** (the area left after side panels, a
container query, not the window).

| Canvas width | Rail | Focus area | Details column |
|---|---|---|---|
| >= 1760 (1920 window) | 304 | 1fr (~1250+) | 360 |
| 1280-1759 (1280, 1600 window) | 304 | 1fr (>= 656) | 320 |
| 1120-1279 | 288 | 1fr (>= 536) | 296 |
| < 1120 (e.g. 920 with side panels) | 272 | 1fr (>= 604) | 44 strip, expands to 288 |

- Rail width is fixed per row, never user-resized. User may collapse it to **56 px** (state dot + index, tooltip), persisted per workspace.
- Below 1120 the details column is a 44 px strip. Opening it pushes (never overlays the transcript) and auto-collapses the rail to 56 so the
  focus area stays >= 576 px; closing restores it.
- Focus area: header 48 (title, branch chip, model chip, state pill, Stop, Compact/Full, overflow menu, close), lane tab strip 35, panel fills.
  **Narrow fallback (canvas < 1280):** header buttons become icon-only (`aria-label` + `title`, the word is hidden), the model chip is hidden,
  branch chip truncates at 170 px, title truncates; the header is `nowrap`, one line at 920 px. Transcript max width 980 px.
- Overflow menu (`role="menu"`, "..." button in the focus header): **Send to messaging** (proposal, Q4). Esc closes it and returns focus to the button.
- Details column: existing session details; header 48; body scrolls alone.
- Rail: header **72 px fixed** (title row 28 + chips row 28, `overflow:hidden`), list (scrolls), footer **84 px fixed** (New session 30 + reason text).
- **Jump chips, one line, never taller than the header:** `nowrap`, 28 px, count-only chips (dot + count; words only for `needs you` and `error`),
  `aria-label` "3 running, jump to the next one"; horizontal scroll with a right fade as the last resort. Header height does not change with the
  number of states (5 groups incl. Idle fit at 272 px: 80+58+36+36+36 = 246 plus gaps, verified in the prototype at 9 and 12 sessions).
- **Rail card: 176 px high, 8 px gap, 8 px list padding**, 1 px border, radius 10, 4 px state bar. Fixed zones:

| Zone | Height | Content |
|---|---|---|
| Head | 26 | state dot, title (truncate, selectable), state pill (word in base-content on a tint) |
| Meta | 16 | `branch` (mono, truncate), model, elapsed |
| NOW | 20 | "Now" + current activity (truncate, selectable) |
| Lanes | 70 | label row 16 (summary, `+N more` button) + 54 for **3 lane rows of 18, each a real `<button>`** |
| Callout | (replaces the 54) | 52: line 18 (agent asks to run `cmd` / error) selectable + actions 24: Allow, Deny, Open (error: Retry, Show output) |
| Metrics | 22 | todos `d/t` (+ mini bar >= 1120 canvas; em dash + title "Todos not reported by this session"), `ctx %`, cost, git `+a -d` |

- Metric slots: columns `1.1fr .8fr .8fr max-content`. **The git slot is `max-content` and never clipped**, so `+176 -60` shows both values
  at 920 px; below 1120 the todo mini bar is dropped first. Git title: "Uncommitted changes in the whole folder".
- Rail scroll: the list scrolls vertically (`scrollbar-gutter: stable`, no horizontal scroll). ~4 cards visible at 1000 px window height; 12
  sessions need 2208 px; up to 19-20 cards scroll the same way (no paging).

## 2. Focus model and no-shift guarantees

**No-shift contract (restated):** *card order and card height never change; slot widths change only at breakpoints and on a user panel toggle
(rail collapse, details strip).* Vertical position of a card changes only when a card is added after it, or when the user closes a card above it.

Getting focus: (1) click a card (rule below); (2) rail keys Up/Down/Home/End (selection follows focus; one live mount per move);
(3) Left/Right outside inputs, tabs, menus, dialogs; (4) queue "Open session"; (5) a chip jumps to the next session of that state;
(6) a lane row button focuses the session **and** selects that lane tab; (7) New session takes focus; (8) external focus/notification outcomes.

Focused card: 1 px gold border + inner gold shadow (box unchanged), `s3` background, `aria-current="true"` on its select button.

**Click and selection rule (parity row 43, F6 guard `canvas-tile.component.ts:692-727`):** card text (title, NOW, callout command) stays
selectable (no `pointer-events:none`, no overlay button). A click focuses the session only if (a) `getSelection()` is collapsed or outside the
card, and (b) the target is not a control (button, link, input). A drag that ends in a non-collapsed selection inside the card does **not**
focus it. Re-render of a card is skipped while a text selection is inside it (unless rule below applies).

**Stale callout rule:** when a permission or error is resolved elsewhere (queue, another window of the app), the card repaints even if its
Allow button has keyboard focus; focus moves to the card's select button (a surviving control); Allow/Deny handlers re-check
`session.permission` and do nothing when it is already gone (no duplicate action). A selection or focus never defers a callout change.

| Event | Order/height change | Rule |
|---|---|---|
| Focus change | none | only the marker moves; focus area and details swap content |
| State change (Running, Needs you, Error, Done, Idle) | none | repaint in place: bar, pill, callout inside the fixed 54 zone |
| Callout appears / resolves | none | replaces the 3 lane rows inside the same zone |
| Todos, cost, git, elapsed | none | fixed slots, truncate |
| Session added | none for existing | appends at the end; scroll offset kept; if user-created it takes focus and scrolls into view |
| Lane count change | none | capped 3 rows + `+N more` |
| Queue open, Allow/Deny | none | popover above the dock |
| Side panel opens, details strip, rail collapse, canvas resize | none (widths only) | **scroll anchor:** the focused card is re-scrolled into view (`block: nearest`, instant) |
| User closes a session | cards below move up one slot | user-initiated; focus goes to the next card (else previous) |
| Session ends / crashes | none | card stays (Done / Error); never removed automatically |

**Ordering rule (settled, Q1):** stable oldest-first, **never regrouped**; state by bar + pill; chips jump. A "sort by state" toggle is a later
option (it would intentionally move slots). Prototype proof: the counter "Card order/height changes since last add/close" compares card order,
tops (scroll-compensated) and heights plus header/tab heights; it is **not reset** by focus, rail collapse (separate baseline per
presentation), details toggle or width change. Simulate buttons raise permission/error/finish on another session; the counter stays 0.

## 3. Lane detail and the old detail row

- Lane tabs are a `role="tablist"` strip under the focus header: `Orchestrator`, then `SUB-AGENTS`, `CLI LANES`, `BACKGROUND`, one tab per lane
  with status dot; the panel is `role="tabpanel"`. Exactly one view is mounted (section 4 contract).
- The selected tab is **per tab id** (a map), restored when focus swaps back. If the selected lane disappears, fall back to Orchestrator.
- The detail row is not needed in Rail (`canvas-detail-geometry`, `--ptah-detail-h`, translate math stay Grid-only).
- "Wrap up & hand off" is inside the chat view above the composer and moves with the live view. Stop, Compact/Full, overflow, close act on the
  focused session. Drafts: saved before a swap (section 4).

## 4. Live view and mount contract (design requirements; the architect designs the code)

Evidence the current code does not give this for free: retained workspaces keep a mounted grid each (`orchestra-canvas.component.ts:232-251`);
the grid mounts tiles with `@for` (`canvas-workspace-grid.component.ts:111-138`); the detail service holds one `_laneKey`, reset on close
(`canvas-detail.service.ts:9-41`).

1. In Rail mode there is **exactly one mounted live `ChatView` and at most one lane panel** per app: the focused session of the **active**
   workspace. They are mutually exclusive in the one focus panel.
2. A hidden workspace mounts **nothing live**: only its rail cards stay (paused sampling, tab deregistered via `SURFACE_ACTIVE` /
   `SESSION_FOCUSED` gating); `RETAINED_WORKSPACE_CAP = 4` unchanged.
3. Lane selection is keyed by tab id (a map), not one global key; swapping back restores that tab's lane.
4. Before a swap the composer draft is flushed to `ComposerDraftStore` (root-scoped, keyed by tab id, cleared on tab close;
   `composer-draft.store.ts:19-51`); the new composer restores its own.
5. A swap destroys the previous child injector, subscriptions and visible-tab registration (same release path as `canvas-tile.component.ts:662-665`);
   one `buildTree` per published snapshot applies to the single focused view (row 40).
6. Grid mode mounts its own tiles exactly as today; only one board mode is mounted per workspace at a time.

## 5. States and accessibility

| Situation | Rail | Focus / details |
|---|---|---|
| 0 sessions | "No sessions yet", New session enabled, chips "No sessions" | "No session in focus", slots keep size |
| 1 / 2 / 3 sessions | 1 / 2 / 3 cards (3 x 184 = 552 fits at 1000 px) | one live view, never two |
| 9 / 12 sessions | scrolls after ~4 cards; meter `n / 9 running` | unchanged |
| Cap reached | meter amber; New session `aria-disabled`, reason "9 of 9 sessions are running. Finish or stop one to start another. Nothing was stopped."; same guard on resume / wrap-up | composer guard unchanged |
| Running / Needs you / Error / Done / Idle | bar + pill + (callout / "Waiting for a prompt") | Stop only while running |
| Todos unknown | em dash, title "Todos not reported by this session" | details same label |
| Light / dark | `data-theme` `anubis-light` / `anubis`, same geometry | |

- Landmarks: rail `aside[aria-label=Sessions]`, focus `section`, details `aside`. Polite live region announces Needs you / Error transitions.
- Rail is `role="list"` (not `listbox`: cards contain buttons). Each card has a roving **select button** (`aria-label` "<title>, <state>, in focus",
  `aria-current`), no pointer events (see section 2).
- **Keyboard order:** app bar (Board toggle, queue) then rail header (collapse, chips) then rail: one stop on the focused card; Up/Down/Home/End
  move and activate from the select button **and from any button inside a card**; Tab from the card goes to its Allow / Deny / Open or its three
  **lane buttons** (Enter/Space opens that lane; Esc returns to the card select button); other cards' inner buttons are `tabindex=-1`;
  then New session, focus header (Stop, Compact, overflow, close), the lane tablist (one stop; Left/Right/Home/End), transcript, composer, details.
- **Esc (settled, Q3):** closes the overflow menu or the queue first, and returns focus to the selected rail card; from the focus area it returns
  focus to the selected rail card. It never changes selection or geometry.
- Focus ring: 2 px `--ring` (= base-content) outline, 2 px offset, on the card (`:has(.rc-select:focus-visible)`) and on every button; distinct from the gold marker.
- Queue: button `aria-haspopup="dialog" aria-expanded aria-controls`; popover `role="dialog" aria-label="Sessions that need you"`.
- Disabled New session: `aria-disabled` + `aria-describedby` (stays focusable).

**Contrast (WCAG 2.2 AA; 1.4.3 text 4.5:1, 1.4.11 UI 3:1), recomputed on the REAL tokens** (sRGB luminance; light OKLCH converted, gamut-clipped):

| Pair | anubis (b1/b2/b3) | anubis-light (b1/b2/b3) |
|---|---|---|
| base-content text | 14.9 / 13.9 / 12.3 | 15.9 / 14.2 / 13.2 |
| muted (`--bcm`) text | 6.05 / 5.65 / 5.00 | 6.04 / 5.39 / 5.01 |
| gold marker (secondary) | 8.8 / 8.2 / 7.3 | 4.1 / 3.7 / 3.4 |
| state dot/bar, real fills run/need/err/done | 5.0-4.2 / 6.6-5.5 / 3.8-3.2 / 5.6-4.7 | **fail**: 2.6-2.0 / 2.5-2.1 / 3.6-3.0 / 2.4-2.0 |
| light state ink (proposed new tokens `#2a56c6 #8f5200 #b4232a #13713a`) | n/a | 6.1-5.0 / 5.8-4.8 / 6.1-5.1 / 5.7-4.7 |
| base-content on 14 % state tint (pill, callout), any state | >= 10.0 | >= 10.9 |
| muted on 14 % state tint | 4.1-5.1 | 4.4-4.8 |

  Rules from the measurements: (1) state text is always base-content, never the state colour; (2) **no muted text on tinted surfaces** (callout, pill:
  4.09 dark need-on-s3, 4.12-4.42 light fail 4.5); (3) in light the real info/warning/error/success fills cannot be bar/dot colours, so the theme
  needs darker state-ink tokens (proposed above, **needs Electron confirmation**); (4) dark error fill is 3.2:1 on s3, enough for UI only.
  Still **needs Electron confirmation**: computed `--bcm` after gamut clipping, DaisyUI hover/focus mixes, tint composites over real surfaces, focus ring and callout border pairs in the built app.

## 6. Parity table (parity-inventory-layout.md rows 1-44)

| # | Capability | Rail location | Grid |
|---|---|---|---|
| 1 | Layout menu in the dock | Replaced by the Board toggle | today's menu |
| 2-7 | Presets, lock, drag, width spans, row breaks, layout focus | Grid only | yes |
| 8 | User compact/full toggle | Focus header (icon-only below 1280) | yes |
| 9 | Compact height stepper | Grid only | yes |
| 10 | Stored view mode vs automatic card | Rail never writes `viewMode` (AC 1.5) | yes |
| 11-12 | `focusTile`, effective focus | `setFocus`; never empty if a session exists | yes |
| 13-14 | Auto card at 3+, detail makes all cards | Moot: one live view at any count; `CANVAS_LIVE_BUDGET` stays for Grid | yes |
| 15-16 | 1-2 tiles side by side, singleton modes | Grid only | yes |
| 17-18 | Hidden workspaces mounted / paused | Cards stay, nothing live mounted (section 4) | yes |
| 19 | Persisted layout | v3 contract (section 7) | yes |
| 20 | Hydration, adoption, session requests | Adopted tabs append; outcomes map to section 2 | yes |
| 21-23 | Detail open/close, geometry, locks grid | Not needed (no detail row) | yes |
| 24 | Esc, Left/Right in detail | Left/Right and Up/Down move focus; Esc returns to selected card / closes queue | yes |
| 25-27 | Lane tabs, card lane row, detail transcript + details | Tab strip, lane buttons on cards, focus panel + details column | detail row |
| 28 | Needs-you queue | App bar button + popover (Allow/Deny/Open session), card callouts, chips | yes |
| 29-30 | Cap 9, New Session gate + reason, send guard | Rail footer (`aria-disabled` + reason), meter; guard in focus composer | yes |
| 31 | Hard bound 20 | Rail scrolls | yes |
| 32 | Hand off banner | Inside the live chat view | yes |
| 33 | Tile close | Focus header close | tile x |
| 34 | Tile header actions | Label/pill, lane tabs + card lanes, Compact, close; **Send to messaging in the overflow menu** (Q4) | yes |
| 35 | Drafts per tab | Saved before a swap (section 4) | yes |
| 36-38 | Scroll, unfocused animation pause, effort/model freeze | Independent scroll areas; cards have no decorative animation; freeze on focus mount | yes |
| 39 | BL release (nodes, injectors) | **Grid:** Gridstack engine release stays (`canvas-grid-release.ts`). **Rail:** contract is "no detached `ptah-canvas-tile` / lane panel / child injector after a swap or close" via component and injector release; **no Gridstack node promise in Rail** | engine release |
| 40 | One `buildTree` per published snapshot | The single focused live view | per tile |
| 41 | Render metrics | Rail board host exposes the same counters (`data-canvas-*`), and the mode in use | grid host |
| 42 | Dock ticker, header message, empty state | Shared dock unchanged; Rail zero state = "No sessions yet" + empty focus placeholder | empty board |
| 43 | Card keyboard / click / text-selection | Rail card (section 2): role/roving button, Enter/Space, ignore controls, ignore active selection | tile |
| 44 | Workspace prune / cross-workspace close | Same effects in both modes: closed tab removes its card from any workspace; `reset` ignored; removed workspace prunes once | same |

## 7. Board mode switch and persistence (v3 layout-record requirement)

- Control: app bar, segmented "Board" **Rail | Grid** (`aria-pressed`), before the queue; default Rail.
- **Design contract for a v3 layout record** (the architect decides the code; current state: versions 1/2 accepted, writes v2,
  `canvas-layout-persistence.service.ts:29-51,179-209,265-283`; store keeps only tile/focus per workspace, `canvas.store.ts:116-151,261`):
  1. Per-workspace `boardMode` (`rail|grid`), plus `railCollapsed` and the rail scroll offset (restore best effort).
  2. A v1/v2 record loads as **Rail** (mode absent); its Grid tile intent is kept as is.
  3. Grid tile intent (order, spans, row breaks, compact heights, lock) is **preserved untouched while in Rail**; Rail never writes it.
  4. **No write before hydration** completes (same rule as today); a failed write is surfaced, not silent.
  5. A record with an unknown **newer version** is read-only (as today): the mode shows but is not persisted, with a visible note.
  6. Hidden workspaces keep their own mode.
- Carried across a switch: focused session (becomes the focused tile), per-tab lane selection, drafts, running-cap state, queue, rail collapsed/scroll.
  Not carried: nothing is recomputed from Rail into Grid. A switch never stops, closes or reloads a session. Geometry change is user-initiated.

## Proposed Removals

none. Rows 2-7, 9, 15-16 exist only in Grid (D9); nothing from the inventory is dropped.

## Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| D1 | Card 176 px, 3-row lanes zone | 140, 176, 240 | 01-board content needs ~156 + padding; 240 shows ~3 cards at 1000 px | yes |
| D2 | Stable order + bar + jump chips (Q1 settled) | stable, deferred regroup, immediate regroup | regroup moves cards under the cursor; AC 6.7 | yes |
| D3 | Lane tabs in the focus header | focus header, details column, card sub-list | row 25, one tab stop | yes |
| D4 | `role="list"` + roving select button | listbox, list | option cannot contain buttons | yes |
| D5 | Selection follows focus on arrows | follow, manual | row 24 | yes |
| D6 | Fixed widths by canvas width | splitter, fixed | row 43 asks for fixed slots | yes |
| D7 | Details strip pushes below 1120, rail auto-collapses | overlay, push | do not overlay the transcript | yes |
| D8 | New sessions append | append, insert top | no existing card moves | yes |
| D9 | Rail from session 1; AC 1.4 and 1-2 NFR become Grid-only | keep side-by-side in Rail | row 44 | no (changes ACs) |
| D10 | `boardMode` per workspace in a v3 record | global, per workspace | hidden workspaces keep records | yes |
| D11 | Card is click-to-focus with a selection guard, no overlay | overlay button, guard | F6 / row 43 | yes |
| D12 | Esc returns to the selected rail card (Q3 settled) | unbound, return | existing detail-key behaviour | yes |
| D13 | Remeasure contrast on real tokens (Q6 settled) | prototype tokens, real tokens | finding 10 | yes |

## Open questions (for the user)

1. Q2: a second dense 96 px card mode at 12+ sessions? **User answer (Gate 1.7, decisions row 52): add it** as a user toggle (row 53, section "Dense mode").
2. Q4: "Send to messaging" in the focus-header overflow menu (prototype proposal) or as an icon button? Recommended: overflow menu.
3. Q5: direct close on non-focused cards (hover x)? Recommended: defer; focus-header close covers row 33 without accidental closes.

## Revision 1

| # | Finding | What changed |
|---|---|---|
| 1 | Parity rows 39-44 missing | Table now covers 1-44; rows 39-44 have destinations; row 39 states no Gridstack promise in Rail |
| 2 | Lane rows not keyboard reachable | Each lane row is a real `<button>` (aria-label), in the roving order, Enter/Space, Esc, Up/Down; prototype updated |
| 3 | Text selection regression | Overlay and `pointer-events:none` removed; selectable text; selection guard + control guard on click; patch skips while a selection is inside |
| 4 | Chips overflow header | One-line fixed 28 px chips, count-only, scroll + fade; header overflow hidden; verified 9 and 12 sessions |
| 5 | 920 px | Git slot `max-content`, mini bar dropped < 1120; header icon-only < 1280, nowrap; overflow menu added |
| 6 | Persistence contract | Section 7 v3 requirements (default Rail for v1/v2, Grid intent untouched, no write before hydration, newer version read-only) |
| 7 | One live view | Section 4 design requirements with the review's file:line evidence |
| 8 | No-shift boundary | Restated; scroll anchor after panel toggles; counter no longer resets on rail toggle, separate baselines |
| 9 | Stale callout | Rule in section 2; prototype reconciles, refocuses select button, guards duplicate actions |
| 10 | Contrast on real tokens | Prototype tokens replaced with real `anubis` / `anubis-light`; ratios recomputed; light state fills fail, ink tokens proposed; Electron items listed |

## Revision 2

Rules added (they bind the implementation, not only the prototype):

- **Roving order after every focus move.** Inner buttons of the focused card are tabbable (`tabindex=0`); inner buttons of every other card are `tabindex=-1`. This is updated on every pass, separately from the card HTML diff.
- **Actions bind to the request id shown.** Every permission and error request has an id. The card repaint key includes it. Allow, Deny and Retry carry the id that is displayed and act only while that id is still the current request; otherwise the surface repaints at once and the click does nothing (announced politely). A replacement request never inherits the old command text's approval.
- **Focus header is patched in place.** Text and state (title, branch, model, pill) change without replacing controls. The control set is rebuilt only when it changes (session, compact, Stop shown); then focus returns to the control with the same key, else to Compact. Stop / Compact / overflow / Close never lose keyboard focus on a sample.
- **Queue reconciles by request id.** Items are keyed `session id | request id`. Surviving items keep their buttons and focus. A replaced or resolved item is removed at once; focus moves to a surviving control in the queue, else to the queue button (the popover closes when it is empty). Actions bind to the shown request id (same rule).
- **Lane tab strip overflow.** The strip stays one line at 35 px. It scrolls horizontally with no scrollbar and a 32 px edge fade on each cut side. The selected tab is always scrolled into view (also after a width change). Tablist keyboard model unchanged: one tab stop, Left/Right/Home/End, selection scrolled into view.

| Item | What changed | Prototype line(s) |
|---|---|---|
| Re-review #2 (roving tabindex) | `syncTabs` runs on every `patchCard` pass before the HTML-diff early return, and again after a repaint | `02-focus-rail.html:388,396,399` |
| Re-review #9 (replacement permission) | Request ids (`reqKey`); repaint key includes the id; Allow / Deny / Retry carry `data-rid`; `stale()` repaints and does nothing when the id is not current | `:322-330,344,347,377,591` |
| N1 (header focus loss) | `renderHeader` patches text and pill in place; rebuilds only on key change and restores focus by `data-h` key | `:467-496` |
| N2 (queue skip, wrong action) | `renderQueue` reconciles items by `session\|request id`, no skip while focused; focus to a surviving control, else the queue button; click handler checks the shown key | `:532-570,572` |
| Tab strip at 920 px | Horizontal scroll, hidden scrollbar, edge fades, selected tab revealed (render and resize); strip stays 35 px | CSS `:158-165`, `:439-465` |
| Re-review #10 (contrast) | Unchanged by design | n/a |

Still **needs Electron confirmation** (unchanged): computed `--bcm` after gamut clipping, DaisyUI hover/focus mixes, tint composites over real surfaces, focus ring and callout border pairs, and the new tab-strip edge fades over `--s1` in both themes.


## Dense mode (Gate 1.7 addendum)

Source: `decisions.md` rows 52 (Q2: ADD a dense 96 px card mode) and 53 (binding rules). This resolves Q2 above (the recommendation "no" is overridden by the user). Prototype: `prototypes/02-focus-rail.html`, rail attribute `data-density="comfortable|dense"`, toggle `#toggle-density`. Comfortable mode is unchanged. Measured with `.ptah/tmp/final-run/proto-rail-dense.mjs` (12 sessions, one permission, two errors, 1600 px and 920 px, both themes).

### Dense zone table (card = 96 px, gap 8 px, order stable)

Card box: `box-sizing: border-box`, 1 px border, padding 4 px top and bottom (inner 86 px), 10 px right, 14 px left (4 px state bar). Rows are a fixed grid `26 / 20 / 22 / 18`, so a state change repaints and never reflows.

| Zone | Height | Content | Source in comfortable card | Notes |
|---|---|---|---|---|
| Head | 26 | State dot, title (ellipsis), state pill | Same zone | Pill word is `--text` on the state tint; the state colour is only the dot, the 4 px bar and the tint. |
| Now | 20 | `Now` label + activity. Permission: `Waiting · <agent>`. Error: `Stopped · a lane failed`. Idle: `Waiting for a prompt` | Same zone | Branch and model move to the card tooltip (`title`: `Title · ⑂ branch · model`) and to the select button's accessible name (`, branch <name>`). |
| Request or lanes line | 22 | EITHER the callout OR the lane summary (never both) | Callout 52 px zone / lanes zone 70 px | See below. |
| Metrics | 18 | `☑ done/total` (or `—`), `ctx n%`, cost, git `+a −d` | Same zone, without the todo mini bar | Git slot is `max-content` and `overflow: visible`: never clipped (measured: 0 clipped at 1600 and 920 px). |

Callout line (permission): ring + tint in the state colour, text `<code>cmd</code>` in `--text` (ellipsis; the full sentence `agent asks to run cmd` is the line tooltip), then three compact buttons `Allow`, `Deny`, `Open` (visual 18 px high, 39-41 px wide). The agent name is already in the Now line, so the line gives its width to the command. Callout line (error): error text (ellipsis, full text in the tooltip) + `Retry`, `Output`.

Lane summary line: `Lanes` label + `3 running · 1 waiting` (same `laneSummary` text as comfortable; ellipsis, full text in the tooltip) and a `+N` button (N = number of lanes of the session, `aria-label` "Open the N lanes of <title>") that selects the card and opens the lane tabs (same action as the comfortable "+N more"). Idle session: `Lanes none yet`, no button.

Dropped from comfortable and why:

| Dropped | Reason | Where the user still gets it |
|---|---|---|
| Meta row (branch, model, elapsed) | 16 px, low value while scanning | Branch and model in the card tooltip and in the focus header; elapsed in the details column. |
| Up to 3 lane rows | 54 px | Lane summary counts + `+N` to the lane tabs; the focus area lane tab strip. |
| Todo mini progress bar | Decoration; the number stays | Details column. |
| "Show N" / "+N more" wording | One `+N` button replaces both | n/a |

### Toggle rule

- A USER control only: a small icon toggle (`≡`) in the rail header title row, directly after the collapse button, `aria-pressed`, accessible name "Dense cards", visible pressed state (gold tint + 1 px gold ring) and an announcement "Dense cards on / off". Never changed by session count, canvas width or any event.
- The rail header stays 72 px. The toggle sits in the title row; the five state chips live in their own 28 px row, so nothing competes for width. Measured at 272 px rail width: header 72 px, chip row 28 px, toggle 22 x 22 px at x = 41, dark and light; chips keep scroll + fade as today.
- Hidden while the rail is collapsed (56 px strip); the stored preference is kept and applies when the rail is expanded again. Collapsed cards stay 56 px in both densities.
- Hint: at 12 or more sessions, while the density is comfortable, the toggle shows a 6 px gold dot, its tooltip reads "Dense cards: fits more sessions on screen" and an `aria-describedby` text says the same. No layout change, no automatic switch, no toast.
- Persistence: per workspace in the v3 layout record, field `railDensity: 'comfortable' | 'dense'`, default `comfortable`, an unknown value reads as `comfortable`. Written only by this toggle, ignored by Grid mode. (Prototype: `localStorage proto.rail.density`.)
- Switching density is a USER geometry change, like the panel toggles of section 2: every card changes height at once, order does not change, the focused card is scrolled into view with the same anchor rule (`scrollIntoView({block:'nearest'})` after the layout pass), and the shift counter baseline is reset for the new density. Inside each density the no-shift contract holds unchanged: every card is exactly 176 px (comfortable) or exactly 96 px (dense), the gap is 8 px, and a state change, a stream sample, a new callout or a replaced request never changes a height. Measured: one height value per density, shift counter 0 across samples, toggle on and off by keyboard, and the focused last card stayed in view both ways.
- The toggle forces one repaint of all card bodies, so it is the only repaint allowed to ignore the text-selection and pointer-press guards; keyboard focus on the toggle is not moved.

### Keyboard and accessibility notes

- Same model as comfortable: the card is a `li` in a `role="list"`, one roving select button per card (`tabindex 0` only on the focused card; name = title, state, branch, "asks permission", "in focus"). Up / Down / Home / End move the selection, Esc inside a card returns focus to its select button.
- Inner buttons (`Allow`, `Deny`, `Open`, `Retry`, `Output`, `+N`) are `tabindex 0` only in the focused card and `-1` in all others (`syncTabs` on every pass). Dense callouts stay actionable for every card by pointer, and by keyboard after selecting the card or from the app bar queue.
- Actions bind to the shown request id (`data-rid`); a handler acts only while that id is current, otherwise it repaints and announces "That request changed. Review the new one." Verified in dense: an Allow carrying a stale id is refused and the callout stays.
- Compact buttons keep their visible word at the start of the accessible name (WCAG 2.5.3): "Allow <agent> to run <cmd>", "Deny <agent> running <cmd>", "Open <title>", "Output of the failed lane".
- Target size (WCAG 2.5.8, 24 px): the 18 px buttons carry a `::after` hit area 24 px high; `+N` is 20 px with a 24 px hit area; widths are at least 39 px; horizontal gaps are 4 px, so hit areas of neighbours do not overlap. The toggle is a 22 px icon button like the collapse button (same pattern as comfortable; Electron to confirm).
- Text selection guard (F6) unchanged: `.rc-select` has no pointer events, card text is selectable, a click that ends a selection never changes focus.

### Contrast notes (prototype tokens, composited over the real card surface)

Rule: no muted text on a state tint. Every string inside a callout, and the state pill, is `--text`; muted text (`--muted`) appears only on the plain card surface (`--s2`) or the focused surface (`--s3`).

| Pair | Dark | Light |
|---|---|---|
| Callout command text on need tint | 10.05:1 | 10.97:1 |
| Callout error text on error tint | 12.59:1 | 11.77:1 |
| Allow label on its green tint | 8.63:1 | 9.47:1 |
| Deny / Open / Retry / `+N` labels (`--text`) | 13.89:1 | 14.21:1 |
| Pill on needs tint | 10.05:1 | 10.97:1 |
| Now line, lane summary, metrics (muted on `--s2`) | 5.65:1 | 5.39:1 |
| Same text on the focused card (muted on `--s3`) | 5.00:1 | 5.01:1 |

Criterion: WCAG 2.2 AA, 1.4.3 (4.5:1 for text) and 1.4.11 (3:1 for the callout ring and the state bar; the light state inks of Revision 1 apply). All text pairs pass. The Now line on a callout card is muted on `--s2` (5.0:1), not on the tint. Electron confirmation of the composites over the real tokens stays with the re-check (decisions row 51, item #10).

### Decisions

| # | Decision | Evidence / reason |
|---|---|---|
| D1 | Dense card = head 26 + Now 20 + callout-or-lanes 22 + metrics 18, padding 4, border 1 | Sum is exactly 96; verified with 12 cards: one height (96), gap 8, dark, light, 920 px |
| D2 | The callout and the lane summary share one 22 px line; a callout replaces the summary | The comfortable card already treats lanes and callout as exclusive; a request outranks lane counts |
| D3 | The callout shows the command only; the agent name stays in the Now line | At 272 px about 70 px remain after three buttons; repeating the agent would truncate the command to nothing |
| D4 | `Open` stays in the callout | Parity with comfortable and the queue popover; it is the keyboard route from a callout to the focus area |
| D5 | Branch and model go to a tooltip and the accessible name; elapsed is dropped from the card | Not needed to scan for attention; a `title` that changes every second would close the tooltip |
| D6 | One `+N` button (lane count) opens the lane tabs | Replaces the lane rows without losing the route to any lane |
| D7 | Todo mini bar dropped, number kept | 18 px row; the number carries the information |
| D8 | Toggle sits in the title row next to the collapse button, not in the chip row | The five chips already use the full chip row; the title row has about 90 px free |
| D9 | The 12+ hint is a dot + tooltip + SR text, shown only while comfortable | Row 53 allows a hint and forbids an automatic switch |
| D10 | Density is not applied in the collapsed rail | The strip has no card body; the preference is kept |
| D11 | Buttons are 18 px visual with a 24 px hit area | Keeps four zones in 96 px while meeting 2.5.8 |

### Parity table

No parity row changes status, so the table is not edited. Rows 25-27 ("card lane row") keep their capability in dense mode: every lane is one click away through `+N` and the lane tab strip. Rows 28, 43 and 44 (callouts, card keyboard model, text selection) behave identically.

### Requirements for the architect

1. Add `railDensity` to the v3 per-workspace layout record (default `comfortable`; unknown reads as `comfortable`); write it only from the toggle.
2. Card height comes from one density-keyed constant pair (176 / 96); the list, the shift guard and the scroll anchor all read it, never a literal.
3. The density switch forces one repaint of all card bodies and one scroll-anchor pass, and resets the geometry baseline (one baseline per density and per collapsed state).
4. Dense callout buttons need an accessible name that starts with the visible label.
5. Electron re-check: measure the dense card at 272 and 288 px rail widths with long titles, a long command, large git values and the 920 px layout; confirm the pairs above on real tokens.
