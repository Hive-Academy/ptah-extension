# Design review - TASK_2026_689_4d4f (Command Center scene: SVG/DOM redesign)

Reviewer: Anthropic-family reviewer of the codex design lane. Document gate only: no product code touched, no Nx/Jest/build/serve.
Method: read `context.md`, the reference image, `design-spec.md`, `prototype/index.html` + `README.md`; read the current scene code
(`libs/frontend/command-center/src/lib/scene/*`, `components/command-overlay.component.ts`, `command-center-page.component.ts`,
`command-work-list.component.ts`, `model/*`); rendered the prototype from `file://` in headless Chromium (playwright-core, helper scripts in
`%TEMP%/cc689/`), dark and light, at 900, 1100, 1440 and 400 px with 8 and 24 nodes; measured contrast, targets, tab order, reduced motion; queried the npm registry.
Screenshots: `.ptah/specs/TASK_2026_689_4d4f/review/*.png` (20 files).

## Verdict

| Metric   | Value          |
| -------- | -------------- |
| Score    | 5.5 / 10       |
| Verdict  | NEEDS_REVISION |
| Blocking | 2              |
| Serious  | 7              |
| Moderate | 7              |
| Minor    | 4              |

The spec is well-researched on tokens, contrast numbers, the ngxui decision and performance discipline. It fails the gate because (a) the prototype
only resembles the reference at one wide size, and loses the reference's defining connectors at the app's own default window; (b) the parity contract
is a coarse bullet list that omits several behaviours the current scene really has, and the prototype contradicts parts of it; (c) several
implementation-critical rules (plate placement, focus model, curve anchoring) are guesses.

## Blocking

### B1. The connector/ribbon look disappears below a 680 px scene container, which includes the default windows the spec itself lists (892x735, 900x800)

- Evidence: measured `#paths path` count: 0 at 900 px and 400 px viewports (stage 514 px / 366 px), 10 at 1100 and 1440. `drawPaths()` returns early for `w<680`
  (prototype script, `if(w<680)return`). Screenshots: `review/dark-900-24.png`, `review/dark-900-8.png`, `review/light-900-8.png`.
- At 900 px the scene is a small 160 px dial, a plain list, and a 2x2 card grid with no curves and no ribbons. It no longer shows the user's requested reference look
  (thin curves into the core, gradient ribbons out). The spec's own first two geometry rows are 892x735 and 900x800 (design-spec.md:21-22), so the main Electron size is the degraded case.
- Fix: keep connectors in the stacked layout (list above core with vertical curves into the top of the core, ribbons dropping to cards below), or raise the
  default stage width, or explicitly get user sign-off that the default window is a "no connectors" layout. Show it in the prototype and add the stacked
  connector geometry (anchor sides, control points) to the spec.

### B2. Selection-by-hover contradicts the parity contract and the prototype loses focus on every interaction

- Current code: hover only opens the node card after 150 ms and closes after 200 ms; it never changes the store selection (`command-overlay.component.ts:26-27,
60-62, 177-180`); selection happens on click/Enter/Space via `pin()` (`:62-64, 210-216`).
- Prototype: `mouseenter` sets `selected=n.id` (script `row()`), verified: hovering a row sets `aria-pressed=true` on it
  (measured, "hover pressed" list). So hover = selection, which also would drive the rail's "Selected work" card (`command-center-page.component.ts:288`) and the root highlighting.
- Prototype `render()` calls `replaceChildren()` on select, so focus is destroyed: after click `document.activeElement` had no label; after Escape focus stayed `null`
  (`hidePlate()` calls `trigger.focus()` on a removed node). The parity bullet "focus return" (design-spec.md:64) is therefore not demonstrated, and the approved
  artifact visually models behaviour the product must not have.
- Fix: model hover (open plate only) separate from selected/pinned; stable DOM so focus survives; focus returns to the row, else the work-list row
  (current fallback: `command-overlay.component.ts:228-244`, `focusWorkListRow`).

## Serious

### S1. Parity contract is incomplete and partly wrong against the current scene (cite = current code)

Missing from "Preserve list" (design-spec.md:61-71):

1. Scene visibility policy: up to 23 non-root nodes are placed, priority selected > failed/awaiting input > everything else > completed, ancestors pulled in,
   phases never placed (`scene-layout.ts:71-72, 74-81, 106`). The spec/prototype cap at 8/10 and sort awaiting > failed > running > rest with no selected/pinned
   guarantee in the prototype (script `render()`); `starting` is not ranked with running. The spec text promises pinned/selected stay in the eight (design-spec.md:13) but the prototype does not.
2. Overflow summary is split `+N completed · +M more` (`scene-layout.ts:111-114, 222-231`); spec has one `+N more`. Decide and record.
3. Tribunal specifics: lanes drawn as satellites of their tribunal, phase progress arc done/total (`scene-layout.ts:188-195, 250-262`; `command-scene-renderer.ts:390-403`).
   The prototype flattens lanes/phases into rows and the core counts phases as "active delegated work" (prototype shows "Tribunal phase" rows counted in the 9). A phase is not delegated work
   (`work-projection.ts:203-235`); the headline number double-counts a running tribunal plus its running phase.
4. Voice: the canvas draws a voice ring for 7 states (idle, listening, thinking, speaking, muted, stopped, error) and scales with input/output level
   (`command-scene-renderer.ts:407-451`; inputs `command-scene.component.ts:92-94`). The spec reduces voice to a caption plus one pulse, defines no mapping for muted/stopped/error/thinking, and does not use `inputLevel`/`outputLevel`, while the contract says "levels ... remain functional" (design-spec.md:70). Either specify the mapping (CSS var driving transform only) or record the removal as a user-reserved decision.
5. `canvasUnavailable` output and page fallback (`command-scene.component.ts:103,274-277`; `command-center-page.component.ts:165`; `command-center-page.controller.ts:87`) is dead after the swap: list it for removal and for test cleanup.
6. State-change screen-reader announcements live in the work list (`command-work-list.component.ts:33`); the scene must not add a second live region (prototype adds `#announcer` on selection). State this.
7. Page chrome copy "Select a sphere for status" (`command-center-page.component.ts:209`) becomes wrong; spec silent.
8. Running-state motion (rotating arc, `command-scene-renderer.ts:347-349`) is removed with no recorded decision.

### S2. Fidelity to the reference: the defining visual cues are missing

- Reference traits (see `references/reference-exposure-command-center.webp`): a ticked outer dial ring, a luminous inner core, source nodes at the end of every curve,
  thick saturated ribbons, glass cards. Prototype (`review/dark-1440-8.png`, `light-1440-8.png`): no tick ring at all (grep: no tick element; only two border rings and a gold arc),
  flat dark disc, no endpoint dots on curves, curves at 1.2 px/42% gold that measure 2.5:1 against the stage, ribbons 9-12 px at 25-45% opacity so the red/blue pop is gone,
  cards are opaque flat panels (no glass; the spec itself forbids backdrop blur at design-spec.md:51 yet allows it at :28).
- The four ribbons start from one point on the core edge and overlap into a knot (`review/light-1100-24.png`).
- Only ~7 curves for 8-10 visible rows; nested rows have no curve, so rows look unconnected.
- Fix: add a static SVG tick ring (60-120 `<line>`s generated once or a `stroke-dasharray` ring, no animation), endpoint dots, ribbon width/opacity up (14-22 px, 55-80% at core end), spread ribbon start points around the right arc, and choose one blur policy.

### S3. Curves detach from rows when the stream list scrolls or focus scrolls it

- Anchors are measured only on resize (spec design-spec.md:53; prototype `drawPaths()` on ResizeObserver/render). The list scrolls internally (`.stream-list{max-height:410px;overflow:auto}`, scrollHeight 469 vs 410 measured).
  After `scrollTop=140` rows moved ~47 px while curves stayed (`review/dark-1440-streams-scrolled.png`). Keyboard focus of a clipped row also scrolls it.
- Fix: either never scroll the list (cap rows to what fits, rest via overflow link) or recompute on `scroll`/`focusin` (rAF-coalesced), or draw curves to the list edge instead of per-row.

### S4. Node detail plate has no placement rule and covers the scene in the prototype

- "native popover/card" (design-spec.md:39) with no anchor rule. In the prototype the plate sits at a fixed spot over the core text and the "Other work" card
  (`review/dark-plate-1440.png`), shows the raw id ("extra:15"), and at <=410 px becomes `position:fixed` 90% wide. Current code anchors with Floating UI to the node (`command-overlay.component.ts:152-171, positioner`).
- Fix: specify anchor = the stream row (right side, flip to left, clamp to scene), z-order, max-width 256 px (current card is `w-64`), pointer bridge (current has one, `:85-88`), and whether Popover API or the existing `FloatingUIService` is used.

### S5. Focus/tab model is unspecified and the prototype gives a bad one

- Measured Tab sequence (dark, 24 nodes): 3 toolbar controls, then each of 10 stream rows as separate tab stops, `#overflow`, `#root-button`, then every one of the 24 rail rows as a separate tab stop.
  Production work list is a roving tabindex (`command-work-list.component.ts:44`: `tabindex` 0 on the active row only). The scene adds 10 stops before it.
- Fix: stream column = one roving tab stop with Up/Down (the prototype already has arrows) , core button and overflow link separate; state the DOM order (streams, core, overflow, cards) and that the rail list remains roving.

### S6. Internal contradictions in the geometry section prevent implementing without guessing

- design-spec.md:11 says the left column "shows every non-root node"; :13, :24 and :53 cap it at 6/8/10.
- :13 says narrow = "horizontally scrollable strip"; prototype is a vertical list in a 2-column grid; :17 says "the scene itself never scrolls" but :21 says status is reachable "by scroll within scene content" and at 400 px the prototype scene is `overflow:auto; max-height:450px` with the status cards cut mid-card (`review/dark-400-24.png`).
- :24 says 1100 px shows 6 rows and 246 px core; prototype shows 8 rows and a 200 px dial. :24 says 1440 core "minimum 310 px" and :26 says dial max 292 px.
- :26 says `min(30cqw, 292px)`; prototype uses `min(30vw,292px)` with min-width 210 px, so it follows the window, not the container, contradicting "respond to its own container" (:17).
- :28 says glass card with 12 px radius; prototype radius differs per theme only by variables, with box-shadows on the dial (13 px and 29 px rings) while :51/:59 say "one 8 px outer tint".
- Fix: one geometry table, authoritative, generated from the prototype's computed values; delete the other numbers.

### S7. Stream-list clipping at 24 nodes

- At 1440 px the 9th row is clipped mid-text and sits directly on the overflow link (`review/dark-1440-24.png`, rows "Dependency map"); at 1100 px 8 rows are counted but 7 are visible; at 900 px the last visible row is cut (`dark-900-24.png`). The hard cap of 10/8 is not what is rendered, so the "bounded DOM rows" budget in the spec is not demonstrated visually.

## Moderate

- M1. Type scale: spec says age 11/16 and section 11 px (design-spec.md:45); prototype uses 10 px for `.sub`, `.age`, `.gsub`, `.rstate` and 9 px for the card unit labels ("ACTIVE", "INPUT"), measured. Contrast is fine (5.1-5.7:1 everywhere, light 5.2-5.6:1), size is below the spec's own ramp. Raise to 11 px.
- M2. Reduced motion: the only transition is `transform/opacity .16s` on hover (verified: 0 running animations, `document.getAnimations()` = 0 under `reducedMotion: reduce`), but the spec's reveal and the voice pulse (design-spec.md:51) are not in the prototype, so they are untested. The current scene also reads `matchMedia` itself (`command-scene.component.ts:117`) while the store has its own `reducedMotion` flag (`command-center.store.ts:141`); say which one wins.
- M3. Status cards: `Other work` mixes queued/idle/unknown/failed/cancelled under one error-coloured ribbon (`.ribbon-other` uses `--err`); a neutral queued task then reads as an error. Use neutral ribbon plus a separate failed chip.
- M4. Dark-theme state dot contrast vs row: running 4.25:1, failed 4.15:1 (>=3:1 ok); but dots are 7 px and rely on color plus word, fine. The gold curve is 2.5:1 (<3:1, decorative, aria-hidden) - acceptable only if documented as decorative.
- M5. Stage chrome: the prototype keeps "01 / Voice command" and "Live orchestration" top text; the reference has the title top-left only. Fine, but the "Voice command" label implies a feature indicator; tie it to voice state.
- M6. Empty state (0 nodes) not captured; the spec has no empty-state copy for the scene and the core shows "0 active delegated work" with 4 zero cards. Current list shows guidance copy (`command-work-list.component.ts` empty item).
- M7. Per-row `aria-label` repeats kind, name, state, age (prototype), but visible text is split across 3 spans; confirm `aria-label` is not overriding visible text changes (WCAG 2.5.3 label-in-name is satisfied since name is first). OK, but ages in labels will cause chatty updates if the age ticks: do not live-announce age changes.

## Minor

- m1. `prefers-reduced-motion` block removes scroll smoothing; fine. The hover `translateX(2px)` on rows inside an `overflow:auto` list is clipped by the 4 px padding for the focus ring top/bottom (2 px padding) - rings of first/last rows clip vertically.
- m2. Prototype plate title "Tribunal phase · extra:15" exposes internal ids; use kind + provider only.
- m3. Prototype README states screenshots were unavailable; this review supplies them under `review/`.
- m4. Spec uses "[lane-proposed]" labels well; keep, but strip them once decided so the implementation plan is not ambiguous.

## Judged areas

### 1. Fidelity to the reference while showing the real data model

Partial. Data mapping is sensible and honest (no invented risk score; left = work streams, right = status groups, core = active delegated work). Visual fidelity is
approximate at 1440 px and weak below (B1, S2). The root core also lacks the reference's "delta" micro-metric; omit consciously.

### 2. Completeness/correctness of the parity contract

See S1 and B2. Correct bullets: selection by projected id, hover plate/pin/Escape, reduced motion, nine states, exhaustive list. Wrong or missing: items listed in S1.

### 3. Performance claims

Verified in the prototype CSS: no `filter`, no `backdrop-filter`, no `@keyframes`, no `will-change`; the only motion is a 0.16 s `transform/opacity` transition on rows/cards under `no-preference`;
paths are static `<path>`s (10 at wide widths, <=10 + 4 ribbons per spec) and the SVG is rebuilt with `replaceChildren()` per render, which Angular's keyed `@for` would not do. The claim holds;
caveats: the allowed "backdrop blur on four cards" (design-spec.md:28) contradicts "no backdrop blur" (:51); the prototype does not exercise the reveal animations; the voice pulse via
a pseudo-element is plausible but audio-level driven transforms are not covered. The 16 ms/32 ms interaction targets are unmeasured (spec itself says so).

### 4. Accessibility (measured)

Dark: stream name 12.5:1; muted `.sub`/`.age` 5.1:1; section title/meta 5.65:1; kicker orange 6.2:1; overflow link 12.5:1; focus ring `#f5d97d` vs row 11.2:1, vs stage 12.5:1.
Light: muted on stage 5.39:1; kicker `#8f5200` 5.21:1; gold-strong text 5.64:1; state dots 11-11.6:1 vs row. Spec's quoted numbers (12.5, 5.66/5.39, 5.61) match what rendered.
Targets: rows 42 px high, rail rows 44, overflow link 34x146, core button 218 px; all above 24x24 AA. Focus ring is `2px solid` offset 3px, visible on every control reached.
Gaps: tab-stop explosion (S5), focus lost on re-render (B2), text below ramp (M1), no labeled `region`/`list` semantics for the stream column (prototype uses `section` + buttons without list roles; add `role="list"` or `<ul>`), the dialog `role="dialog" aria-modal="false"` is non-modal and should return focus; reduced motion works (0 animations).

### 5. ngxui evaluation

Verified against the npm registry today (2026-10-17): `@omnedia/ngx-connection-beam@4.0.1`, `ngx-border-beam`, `ngx-number-ticker`, `ngx-electric-border`: MIT, peers `@angular/core ^21.0.0` + `@angular/common ^21.0.0`, dep `tslib`;
`ngx-orb`: same peers plus `ogl ^1.0.11`. Latest releases are 2025-11-29. Repo root `package.json:97` has `@angular/core 22.1.7`, so the peers do not satisfy (npm would raise ERESOLVE). The spec's claims are correct and the decision (local SVG/CSS, no dependency) is sound. Not verified: the ngxui.com site itself (JS-rendered) and whether the beam source works under Angular 22 anyway.

### 6. Implementability

Not yet. Tokens and component list are good (6 components, signals, `@for track node.id`). Missing or contradictory: geometry (S6), plate placement (S4), focus model (S5), curve anchor update rule (S3),
stacked connector geometry (B1), voice mapping (S1.4), an overflow taxonomy (S1.2), the empty state (M6), and which of the 4 status cards' counts include phases (S1.3). The prototype fixes none of these consistently.

## Required revisions before approval

1. Resolve B1/B2 in the prototype and spec.
2. Update the parity contract with S1 items; take the removals (voice level, running spin, canvas fallback) to the user explicitly as decisions.
3. Add tick ring, endpoint dots, ribbon weight/spread (S2), and a single geometry table (S6).
4. Define anchoring/scroll rule (S3), plate placement (S4), roving focus model (S5).
5. Raise 9-10 px text to the documented 11 px ramp (M1).

## Screenshots (best two for the user)

- Dark: `D:/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign/.ptah/specs/TASK_2026_689_4d4f/review/dark-1440-8.png`
- Light: `D:/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign/.ptah/specs/TASK_2026_689_4d4f/review/light-1440-8.png`

---

## Re-review (round 1)

Method as before: prototype from `file://` in headless Chromium (helpers in `%TEMP%/cc689b/`), dark and light at 1440, 1100, 900, 892, 400 (plus 340 for the fallback), 8 and 24 nodes, plus 32 and empty; hover vs select, focus/Escape, tab order, scroll redraw, voice states, reduced motion, contrast. No page errors in any run. Screenshots: `review/r2-*.png`. Revision notes (`design-revision-notes.md`) read; claims checked, not trusted.

### Per-finding status

| Id                                 | Status             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 connectors at default widths    | FIXED              | Curves, endpoint dots and 4 ribbons now render at 900/892/400 (stage 514/506/366) via a stacked layout (`r2-light-892-24.png`, `r2-dark-400-24.png`); no horizontal overflow at any size; no scene scroll (`sceneScroll` 0). Below 340 px scene the connectors are dropped as documented (0 paths at 340 viewport).                                                                                                                                                                                         |
| B2 hover vs select, focus          | FIXED              | Hovering row 3 opens the plate and leaves only the root `aria-pressed` (`r2-dark-1440-hover.png`). Arrow Down x2 + Enter selects, focus stays on the same row element, Escape closes and focus stays on the trigger. Rows are no longer rebuilt on select. Spec states 150/200 ms and the current-code citations.                                                                                                                                                                                           |
| S1 parity contract                 | FIXED              | Spec now covers the 23-node cap and priority, phase exclusion from counts, tribunal arc and lane cue, split overflow (`+7 completed · +1 more · View all work` on the 32-node sample, 23 rows), seven voice states with level scale (`--voice-scale` 1.025 at level 1; `r2-dark-1440-voice-*.png`), running arc, `canvasUnavailable` removal proposal, single live region (no `#announcer`), chrome copy. Decisions on voice/running motion are recorded as preserved, so no user-reserved removal remains. |
| S2 reference cues                  | FIXED              | 96-tick dial, endpoint dots, luminous core, 16/20 px saturated ribbons from four distinct start points, neutral grey Other ribbon, no backdrop blur (`r2-dark-1440-24.png` reads close to the reference).                                                                                                                                                                                                                                                                                                   |
| S3 curves vs scroll                | FIXED              | After `scrollTop=200` the endpoint-dot y positions equal the row midpoints exactly (11/11, `r2-dark-1440-scrolled.png`).                                                                                                                                                                                                                                                                                                                                                                                    |
| S4 plate placement                 | PARTIAL            | No overlap with dial or status cards at 1440/1100/900/400 (measured), labels not raw ids. At 1440 the pinned plate sits under the selected row and covers three neighbouring rows (`r2-dark-1440-pinned.png`); at the 340 px fallback it covers the dial (`r2-dark-340-plate.png`). Acceptable for a preview/pin card, but see M-R3.                                                                                                                                                                        |
| S5 focus model                     | FIXED              | Tab sequence: toolbar, one stop for the stream list, overflow link, core button, one stop for the rail, dock. Roving Up/Down works.                                                                                                                                                                                                                                                                                                                                                                         |
| S6 geometry contradictions         | FIXED              | Single table; measured fully visible rows 10/6/4/4/4 at 1440/1100/900/892/400 and dials 292/200/160 match the spec table.                                                                                                                                                                                                                                                                                                                                                                                   |
| S7 clipped rows                    | FIXED              | Viewport shows whole rows only; overflow link is outside the scroll area.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M1 type scale                      | FIXED              | No text below 11 px in the stage or rail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M2 reduced motion                  | FIXED              | `reducedMotion: reduce` leaves 0 running animations and `--voice-scale` 1 even at input level 1. Only motion is transform rotation (running dot, thinking ring) and a transform/opacity hover transition; no filter, backdrop-filter or box-shadow animation.                                                                                                                                                                                                                                               |
| M3 Other ribbon colour             | FIXED              | Neutral grey ribbon plus a separate red failed/cancelled chip.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M4 curve contrast                  | FIXED (documented) | Decorative-exemption sentence added to the spec.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M5 chrome text                     | FIXED              | "01 / Voice command" replaced by a live "Voice · state" caption.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M6 empty state                     | FIXED              | `r2-dark-1440-empty.png`: stage "No delegated work yet", rail copy present.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M7 live region                     | FIXED              | Spec keeps announcements in the work list and excludes ages from labels.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| m1 ring clipping of first/last row | NOT RE-VERIFIED    | Not visible in screenshots; keep as a plan item.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| m2 raw ids                         | FIXED              | Plate shows label, kind, state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| m3 screenshots                     | FIXED              | `review/r2-*.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| m4 lane-proposed labels            | OPEN (by design)   | Still labelled pending Gate 1.7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### New findings

#### Serious

- **N1. Dark-theme muted text on stream rows fails AA.** `.stream .sub` and `.age` (11 px) measure 4.26:1, and the `failed-chip` red measures 4.4:1 (rendered colour of `--bcm` over the new row fill `oklch(.2657 .022 285 / .55)` on the `#1a1a20` stage). Previously 5.1:1. Light theme has no failing pair. Fix: use a darker row fill (alpha under .3) or a lighter muted ink on rows, and a lighter red for the chip text; re-measure at 4.5:1 or better.

#### Moderate

- **M-R1. Stacked layout wire clutter.** At 892/900/400 the curves from the upper rows cross the text of rows below them (`r2-light-892-24.png`, `r2-dark-400-24.png`), and the ribbons cross each other before reaching the 2x2 cards (also `r2-light-1100-24.png`). Route curves to the stream list's right edge, or draw them only from the bottom visible row region, or reduce them to endpoint dots in stacked mode.
- **M-R2. Core text crowding at 160 px.** "Root session · running" plus "Voice · state" wraps to four lines and touches the ring strokes at 892/900/400 (`r2-light-892-24.png`). Drop the voice caption inside the dial at <=679 px (it is already in the stage header) or shorten the copy.
- **M-R3. Plate covers neighbouring rows** (see S4); prefer the right side of the row in stacked mode and a position that does not hide the next two rows.

#### Minor

- m-R1. "View all work" stays visible when the list is empty.
- m-R2. Tribunal row badge ("○●2/3") is cramped next to the age.

### Score and verdict

- Score: **7.5 / 10** (was 5.5). Both Blocking items and all prior Serious items are closed or acceptable; the prototype now resembles the reference at wide sizes and keeps the connector concept at the default window.
- Verdict: **NEEDS_REVISION**, solely because of the one new Serious item N1 (AA contrast on dark rows). It is a one-line token/alpha change; after it, the verdict would be APPROVED. M-R1 to M-R3 can go to the implementation plan as visual-check items.

### Best screenshots

- Dark: `D:/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign/.ptah/specs/TASK_2026_689_4d4f/review/r2-dark-1440-pinned.png`
- Light: `D:/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign/.ptah/specs/TASK_2026_689_4d4f/review/r2-light-1100-24.png`

---

## Re-review (round 2)

Same method (headless Chromium from `file://`, helpers in `%TEMP%/cc689b/`), dark and light at 1440, 1100, 900, 892, 400 and 340, 8/24/32/empty nodes. No page errors; no horizontal overflow; scene never scrolls. Screenshots: `review/r3-*.png`.

### Status of the round 1 items

| Item                          | Status                            | Evidence                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 dark contrast              | FIXED                             | Automated scan of every text node in stage and rail, both themes, lists no pair under 4.8:1 and nothing under 11 px. Dark row sub text is now `rgb(184,181,179)` (about 8:1 per the lane's composite; my scan reports no failing pair), failed chip is `#ff7979`. |
| S4 plate vs rows, dial, cards | PARTIAL                           | Plate intersects no visible row, dial or card at 1440/1100/900/400/340 (measured `hit: []`). But the new mechanism is a regression, see N2. The plate also lands far from its row (at 1440 about 500 px below the selected row, `r3-light-1440-plate.png`).       |
| M-R1 stacked wire routing     | FIXED                             | Curves leave a 24 px right gutter and bend under the list; no curve crosses row text at 892/900/400 (`r3-light-892-24.png`, `r3-dark-1100-plate.png`). Ribbons still pass beneath the translucent cards on their way to the far-side card (Moderate, M-R4 below). |
| M-R2 core text at 160 px      | FIXED                             | Voice caption hidden inside the 160 px dial, count 34 px; no text on the ring strokes (`r3-light-892-24.png`).                                                                                                                                                    |
| m1 first/last row focus ring  | FIXED                             | First row inset 7 px from the list top, last row 7 px from the bottom at 1440/1100/892 (ring reach 5 px); `r3-1440-focus-last.png` shows a complete ring.                                                                                                         |
| m-R1 empty "View all work"    | FIXED (per lane, not re-screened) | Prototype `build()` hides it when empty.                                                                                                                                                                                                                          |
| m-R2 tribunal badge crowding  | OPEN (Minor)                      | "○●2/3" is still tight next to the age.                                                                                                                                                                                                                           |
| m4 lane-proposed labels       | OPEN (by design)                  | Pending Gate 1.7 acceptance.                                                                                                                                                                                                                                      |

All earlier Blocking (B1, B2) and Serious (S1-S7) results from round 1 still hold: hover leaves only the root `aria-pressed`, Enter selects and keeps focus, Escape keeps focus on the trigger, endpoint dots equal row midpoints after scroll (11/11), 23 rows and `+7 completed · +1 more` on the 32-node sample, `--voice-scale` 1.025 at level 1 and 1 under reduced motion, 0 animations under reduced motion, one roving tab stop per list.

### New findings

#### Serious

- **N2. The detail plate's reserved space shifts the whole page on hover and is not released at 1100/892.** Hovering a stream row grows the stage by 187 px and moves the command dock down 187 px (1440: dock top 832 to 1019; 1100: 1113 to 1300; 892: 963 to 1150; `r3-dark-1100-hover-shift.png`). At 1440 it retracts after the pointer leaves; at 1100 and 892 it stays expanded after the plate closes (dock still at 1300 after 1.5 s and after a second hover/leave). A preview that reflows the page on every hover is a layout shift, and the stuck state is a defect. Fix: reserve space only for a pinned plate (not for the 150 ms hover preview, which can overlay a safe region or be skipped when no clear spot exists), and always release the reservation on close, Escape, outside click and selection change.

#### Moderate

- **M-R4. Ribbons cross under adjacent cards** in compact/stacked layouts (`r3-light-892-24.png`, `r3-dark-1100-plate.png`): the Finished and Other ribbons run diagonally beneath the In progress and Waiting cards, so they read as tangled. Route each ribbon to the nearest card edge, or order the origins to match the 2x2 order (left cards left, right cards right).
- **M-R5. Plate placement distance.** With the reserve-below strategy the plate can be 500 px from the row it describes (1440), which weakens the association. Consider anchoring beside the row in the stream gutter when the stream region allows, using the reserve only as a last resort.

### Open items (final list)

| Severity | Item                                                                        |
| -------- | --------------------------------------------------------------------------- |
| Serious  | N2 hover-preview layout shift and unreleased reserved space at 1100/892     |
| Moderate | M-R4 ribbon crossing under cards; M-R5 plate distance from its row          |
| Minor    | m-R2 tribunal badge crowding; m4 `[lane-proposed]` values awaiting Gate 1.7 |

### Score and verdict

- Score: **8 / 10** (was 7.5). Contrast, wire routing, core text and focus-ring items are closed; the prototype is a convincing, accessible match for the reference at all five sizes.
- Verdict: **NEEDS_REVISION**, only because of N2 (one Serious item with a small, contained fix: reserve space for the pinned plate only and always release it). No Blocking items remain. If the coordinator accepts N2 as an implementation-plan constraint ("hover preview must not reflow the page; pinned plate may reserve space and must release it"), the design is otherwise fit to proceed.

### Best screenshots

- Dark, about 1100 px, 24 nodes: `D:/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign/.ptah/specs/TASK_2026_689_4d4f/review/r3-dark-1100-24.png`
- Light, 1440 px, 24 nodes: `D:/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign/.ptah/specs/TASK_2026_689_4d4f/review/r3-light-1440-24.png`
