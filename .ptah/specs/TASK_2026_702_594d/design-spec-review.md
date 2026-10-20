# Design review - TASK_2026_702_594d (cross-side reviewer, read-only)

Reviewed: context.md, decisions.md, task-description.md (AC10 at line 47), scope-change-1, design-spec.md,
parity-inventory.md, prototype README, `start-screen.html` (lifecycle JS at lines 297-312) and all 12
screenshots, against the user's current-screen screenshot.

## Verdict: REVISE (0 Blocking, 1 Serious, 5 Moderate, 4 Minor)

The design hits the user's headline goals. Only the single-chat screen (S1) is under-specified enough to
justify REVISE. Everything else can be fixed with small spec edits and does not need a prototype rework.

## Goal check

| Goal | Result | Evidence |
| --- | --- | --- |
| Exactly one primary New session | Pass | dark-empty.png: one filled blue hero button; rail "New session" is outlined, same as Previous sessions. Spec lines 36, 53. |
| No dock bar in any state | Pass | All 12 screenshots show the workspace starting directly under the tab band. Spec line 53 and parity rows for the dock, ticker and chip. |
| Beams visible but calm, dark and light | Mostly. Light passes, dark is faint (M1) | light-empty.png: five soft warm-gold pillars with no grey cast. dark-empty.png: about three dim shafts that fade out by y~340. |
| Text contrast >= 4.5:1 over beams | Pass, with a sampling caveat (M2) | Spec lines 58-71. Lowest value is dark hero text over the brightest beam at 5.78:1. |
| One surface-3 "Get ready" card, "N of 2 ready", Run setup uncounted | Pass | dark-partly.png shows "1 of 2 ready" with the Project scan row as an action only. |
| All ready -> Ready strip with three actions | Pass | dark-ready-recent.png and light-ready-recent.png show Run setup, Generate agents and Project guidance. |
| Recent sessions only from real data | Pass for production. The fixture issue is M5. | Spec line 44: `ChatStore.sessions`, hidden when loading or empty. |
| Rail and board copy do not contradict | Pass | "Board sessions / No sessions on this board" beside a Recent sessions row. Spec line 44. |
| Light looks like warm gold light | Pass | Constant gold RGB with energy as alpha (spec line 50). light-empty.png and light-partly.png show no grey smudges. |

## Findings

### Serious

**S1. Single-chat empty state has no real design.**
- Spec line 46 is one paragraph ("same checklist and Setup tools row ... preserve logo, title, tagline").
  No screenshot, no prototype state, no sizes.
- task-description AC10 (line 47) requires the checklist rows, actions and count to be readable and
  reachable with no horizontal overflow in a 280px VS Code sidebar.
- The board card is `max-width:588px` with a title row, a count pill, 30px icon + text + right-aligned
  action rows, and a Setup tools row. None of that fits in 280px without a layout change. The spec gives
  no narrow behaviour and does not say how the Ready strip collapses.
- Fix, in order of preference:
  1. Add a `?state=single-chat&width=280` fixture to the prototype and one screenshot each for dark and
     light.
  2. At minimum, specify in the spec the `<=360px` container behaviour: card inset 12px; header count
     pill wraps under the title; each row stacks (icon + text, then a full-width 11px action button);
     Setup tools buttons wrap to two lines or one column; Ready strip wraps to 2 lines with the three
     actions on a second row.
  3. State where the card sits relative to the logo, tagline and prompt suggestions, and that no
     Lightfall, hero or recent cards are added. This is already decided in the spec.
  4. Name the container query or breakpoint used. It must be container-based because the 280px is a
     panel width, not a viewport width.

### Moderate

**M1. Dark-theme beams are weaker than "clearly visible".**
- dark-empty.png shows narrow dim shafts that are near-invisible on the left and right. They are
  nearly gone behind the card. light-empty.png has five broad, clearly visible pillars.
- Dark and light feel like different effects. The "calm" part is satisfied. The "clearly visible" part
  is borderline in dark.
- Fix: raise dark `uRayStrength` (.5) and the canvas opacity (.82) until the outer shafts read. Target
  a gold peak around 25-30% over base-100, checked against the 4.5:1 text rule. Re-run
  `check-contrast.js` after the change.
- Keep the five shafts in both themes so they match.

**M2. The contrast claim has a sampling hole.**
- Spec line 71 samples beam luminance only "outside text and the button".
- dark-cap.png and dark-popover.png show a thin bright vertical line at x~873 running through the
  subtitle and the cap-reason text. This is the shader's centre-origin shaft (source "beam offset 0").
- Fix: either sample the pixels directly behind the text glyph boxes, or kill the hairline. Remove the
  centre origin from the spread term, or give the hero text column a `--b1` backing at 0.6 alpha.
  Re-measure, and keep the >= 4.5:1 result.

**M3. GPU and battery cost is undefined.**
- Spec lines 50 and 54 give the DPR cap of 1.5 and `powerPreference:'low-power'` in the prototype. They
  give no frame budget.
- The canvas is a 570px-tall full-width fbm fragment shader. It runs for as long as an empty board is on
  screen in an Electron window. The cost is unquantified.
- Fix: add to the spec a render-scale of 0.5-0.75 (beams are soft and blurred, so no visible loss), a
  30fps cap in the rAF loop, and an acceptance criterion such as "median GPU frame <= X ms at 1440x900 on
  integrated GPU, measured once in Electron". Also state that the canvas is capped at 570px height or the
  hero region only, not the full board scroll height.

**M4. Keyboard and screen reader notes are scattered and incomplete.**
- There is no a11y section in the spec. AC10 requires the focus order: primary action, checklist actions
  in row order, recent cards, then rail controls.
- In the prototype the `<aside class="rail">` comes before `<main>` in the DOM (html line 22 vs 23),
  so the tab order is rail first. That contradicts AC10.
- Other gaps: there is no live-region rule for the "N of 2 ready" change or for Ready strip appearance;
  there is no heading outline (h1 in the hero, h2 for Get ready and Recent sessions, rail h2); the
  layout-write-failure notice is `role=status` although it reports a failure.
- Fix: add a short "Keyboard and assistive technology" section with the focus order above, heading
  levels, `aria-live=polite` on the count, and `role=alert` for the layout-write-failure and newer-version
  notices (keep `status` for the create-limit `headerMessage`). Resolve the DOM order issue either with
  visual ordering (CSS `order`) or by stating in the spec that the rail follows the board in DOM order.

**M5. Populated-board fixture shows invented tile content.**
- dark-layout-warning-tiles.png shows tiles with a "Running/Idle" pill, descriptions like "Checking
  routes and contract changes across the workspace.", "Open session" buttons, and a "Current workspace /
  Board sessions / 3 sessions" heading.
- Real tiles are the existing session viewports; none of those fields is evidenced. The spec says
  "visual fixtures only" (line 17), but an implementer or later reviewer can read this as a redesign of
  tiles, which is out of scope.
- Fix: replace the fixture with a plain grey placeholder grid (or the real tile chrome) and label it
  "existing tile area". The only design target is the notice's position and width (see m2).

### Minor

**m1. Light theme: teal primary against warm gold beams.**
- light-empty.png: the `anubis-light` primary (`oklch(85% .138 181)`, teal) sits in the middle of
  gold pillars. It is the app token, so keep it. Add a one-line note in the spec that this is intentional
  and unchanged, so the implementer does not "fix" it.

**m2. Notice width does not match the grid below it on the populated board.**
- The notice is 588px wide, but the tile grid is 780px wide. In dark-layout-warning-tiles.png the notice
  floats narrower than its content. Use the content width on populated boards, or say explicitly that it
  stays 588px.

**m3. Agents "update available" and "loading" are not mapped to the count.**
- Spec line 39 lists the Agents states, but not whether "Update" counts as ready, or what the pill says
  while the state is loading (for example "0 of 2" would be a false claim).
- Fix: say that Update available counts as ready (with an Update action), and that the pill shows no
  number while either signal is loading or unknown. Skills is already "unknown" while loading.

**m4. 800px capture is not a full-window capture.**
- dark-800.png truncates the tab strip (Tribunal and Analytics are missing) and the top utility icons.
  The prototype chrome is only context, but the spec line 17 says "At 800px the board shows the entire
  checklist and both rail footer actions without horizontal clipping." The capture agrees with that
  statement. Just note that tab overflow is existing chrome behaviour, not part of this design.

## Parity and lifecycle (task items 2 and 3)

- **Parity map, spec lines 95-127.** Every non-removed row has a place: name popover states
  (anchor, Enter, Escape, Cancel, focus return), running-cap and tile-limit reasons (hero and rail,
  `aria-disabled`, `aria-describedby`; dark-cap.png), Previous sessions, Open Library, Configure,
  Run setup, Generate agents, Project guidance, and the three dock warnings as an inline notice
  (dark-layout-warning.png, dark-layout-warning-tiles.png; both empty and populated placement).
  Removals are exactly those approved in decisions #9 to #11. No gaps found.
- **Lightfall lifecycle, spec lines 50-54 and html lines 297-312.** The spec gives raw WebGL with no
  Three.js, an explicit "do not add Three.js" line, creation only when empty, on screen, visible and
  motion allowed, rAF stopped on `visibilitychange`, `IntersectionObserver`, populated board and
  reduced motion, a DPR cap of 1.5, static wash for reduced motion, GL init failure and context loss,
  and resource deletion on teardown. The prototype implements the pause, observer, reduced-motion and
  context-lost paths. The MIT notice file is specified as a plain `.txt` next to
  `brand-icons-notices.txt` with the full upstream text, and the prototype embeds the notice (html
  line 30). Implementable. Remaining gap: GPU cost (M3).
  One more note: the spec does not say what happens on `webglcontextrestored` (resume or stay on the
  static wash). Staying on the static wash is the safe choice. Say so.

## Visual quality, 800px, data honesty (task item 4)

- The card matches the app's `surface-3` style (raised, highlight, 12px radius). It replaces the two
  mismatched cards in the user's screenshot. Hierarchy is clear: emblem, serif heading, one primary
  button, one card, one quiet tools row.
- 800px: dark-800.png shows no clipping and both rail buttons are visible. The recent cards stack at
  <=850px per the spec.
- Data honesty: the production sources are named for every field. Prototype recent names and the
  tile fixtures are labelled fixtures. The only invented data in the images is the M5 tile content.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| REVISE rests on S1 only; M1-M5 are listed as fixes to apply in the same revision but do not block it | Approve with notes; REVISE | Reviewer rule: only Blocking or Serious justify REVISE; S1 breaks task-description AC10 | Yes |
| The teal light-theme primary is not a finding | Flag as clash; accept as app token | `tailwind.config.js` anubis-light primary, spec line 28 | Yes |

## Requested revision list (short)

1. S1: add the single-chat 280px design (prototype state, or at minimum the narrow-container rules).
2. M1: raise dark beam strength to match light; re-measure contrast.
3. M2: remove the centre hairline or measure behind the text.
4. M3: add render scale, a 30fps cap and a GPU acceptance check.
5. M4: add an a11y section and fix the DOM order versus AC10; `role=alert` for failure notices.
6. M5: replace the invented tile fixtures with a neutral placeholder.
7. Minor m1-m4 as text edits.


## Round 1 re-review

Verdict: APPROVED

0 Blocking, 0 Serious, 2 Moderate, 3 Minor. The Moderate items are spec and prototype tuning edits that can be applied
alongside Gate 1.7. Reviewed: `design-revision-1.md`, `design-spec.md`, `prototype/start-screen.html`, README,
`check-contrast.js`, `aurora-notices.txt`, `task-description.md` + scope-change-2, `decisions.md` #1-#12, and all 16
screenshots (dark and light).

### Round-0 findings

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| S1 | Single-chat screen at normal and 280px | Resolved | `dark-single-chat-280.png`, `dark-single-chat-ready-280.png`, `dark-single-chat.png`, `light-single-chat.png`: logo, tagline, card, rows stack with full-width actions, Setup tools stack, prompts below, no horizontal clipping. Spec lines 46-48 name the container query (`container-type:inline-size`, `<=360px`). |
| M1 | Dark beams too faint | Resolved | Beams no longer exist. `dark-empty.png` shows a visible, calm warm-gold aurora. Light is a separate issue, see N1. |
| M2 | Hairline through text | Not applicable, confirmed | The centre-origin shader shaft is gone with WebGL. The contrast script (`check-contrast.js:44-55`) now samples every pixel inside each text box. See N3 for the animation-phase gap. |
| M3 | GPU frame budget | Not applicable, confirmed | There is no WebGL, canvas or shader in `start-screen.html`. See N4 for the CSS repaint note. |
| M4 | DOM order, a11y section, live regions | Resolved | Spec lines 58-60. `<main>` precedes `<aside>` (html line 44), count has `aria-live`, `role=alert` for save/newer notices, `role=status` for create-limit. |
| M5 | Invented tile fixture | Resolved | `dark-layout-warning-tiles.png`: neutral dashed placeholder blocks only. |
| m1 | Teal light primary | Resolved | Spec line 34. Confirmed it is the real token: `tailwind.config.js:82-84` (`anubis` primary `#2563eb`) and `:154-160` (`anubis-light` primary `oklch(85% 0.138 181.071)`, content `oklch(36% 0.078 188.216)`). The prototype is correct, not an error. |
| m2 | Notice width vs grid | Resolved | The tiles screenshot shows the notice at the grid width (about 732px). |
| m3 | Agents update/loading vs count | Resolved | Spec line 43. |
| m4 | 800px tab overflow | Resolved | Spec line 17. |

### Aurora change (#12)

| Check | Result |
| --- | --- |
| CSS-only, no WebGL, canvas or JS animation loop | Pass. `start-screen.html:26-37`: gradients, blur, mask, one `@keyframes` (60s). JS only toggles a `paused` class (line 56). |
| `prefers-reduced-motion` honored | Pass. Line 36 removes the animation, and the matchMedia listener (lines 55-59) switches live. `dark-reduced.png` keeps the still gradient. |
| No runtime dependency on `@omnedia/ngx-aurora` | Pass. Spec lines 52 and 54; task-description lines 48 and 70 (no new npm dependency). |
| MIT notice planned | Pass. `aurora-notices.txt` is plain text with the full MIT text. task-description line 101 names the production path, the asset copies and the `extraResources` entry. |
| Dark and light | Dark pass. Light is faint (N1). |
| Hairline / GPU "not applicable" | Confirmed (see table). |

Orchestrator observations:
- Light Aurora is very faint: confirmed, see N1.
- Light primary teal vs dark blue: matches the app theme tokens (`tailwind.config.js:82` vs `:154`). Not a prototype error. Keep.

### Scope change 2 consistency

Consistent with the design and decisions #9-#12 on these points: the dock is fully removed (task-description lines 17, 38); the
popover anchors to the hero and the sidebar footer button (lines 17, 38); the dock warnings become an inline dismissable board
notice, not a snackbar (line 18 and decision #10; spec line 41 forbids fixed/absolute/sticky/snackbar). No dock bar appears in
any of the 16 screenshots; one filled primary New session sits on the board and the rail button is outlined. WebGL and Three.js
are mentioned only as exclusions (lines 48, 70). One inconsistency: N2.

### Contrast and token use

- No `text-base-content/NN` alpha class and no `color:` with alpha exists in the prototype. Text uses `--bc` and `--bcm`. Pass.
- `start-screen.html:10` has `[aria-disabled=true]{opacity:.62}` and `.row-action:disabled{opacity:.55}`. `aria-disabled`
  buttons are reset to opacity 1 (line 19), so the visible reason text keeps full contrast. `.row-action:disabled` is a
  native-disabled control (exempt), but it is an alpha dim that must not be copied into templates (N5).
- Hero, subtitle and cap-reason pairs are measured by pixel sampling: dark 9.80 / 10.55 / 12.11, light 15.09 / 15.65
  (spec lines 66-73). Pass at AA 4.5:1.
- Single-chat at 280px: usable. Every action is full width and reachable, nothing clipped, prompts follow the card.

### New findings

#### Blocking
None.

#### Serious
None.

#### Moderate

**N1. Light-theme Aurora is nearly invisible.**
- `light-empty.png`, `light-partly.png`, `light-ready-recent.png`: only a faint cream haze at the top edge. The brief is a
  visible but calm Aurora in both themes, and dark shows it clearly (`dark-empty.png`). Cause: the light stripe colour
  `#f8f1e5` (`start-screen.html:32`) is almost the same as base-100, and opacity is only .19 (line 33).
- Change: tune the light layer so a gold wash is perceptible (darker gold stops, opacity about .30-.35, and a stripe colour
  that differs more from `--b1`). Re-run `check-contrast.js` for light with the hero title, subtitle and `.row-state` text,
  and update spec line 52 (opacity values) and the contrast table.

**N2. The single-chat Aurora contradicts the approved scope text.**
- `task-description.md:33` lists "The Aurora hero and recent-session cards on the VS Code single-chat start screen" as out
  of scope and says that surface "receives only the shared checklist". `task-description.md:32` also excludes Aurora outside the
  initial empty board, and scope change 2 line 5 limits Aurora to "the empty board". The design puts a low-opacity Aurora behind
  the single-chat brand (spec lines 46, 52; `dark-single-chat*.png`). Decision #12 does not say it applies to both surfaces; the
  claim is only in `design-revision-1.md` (Decisions table, row 1).
- Change: either remove the single-chat Aurora from the design, prototype and screenshots, or have the orchestrator amend
  task-description lines 32-33 and decision #12 to include it. The documents must agree before the architect starts. It is a
  small reversible visual, not a capability removal.

#### Minor

**N3. Contrast is sampled at one animation phase.** `check-contrast.js:23-31` supports `AURORA_PHASE`, but the default run
sets none, and the 60s animation shifts the stripes across the board. Change: run at three or more phases (for example 0, 20
and 40s) in both themes and state "worst of N phases" in spec line 64.

**N4. Animation cost note.** A `background-position` animation on a `blur(10px)` layer with `mix-blend-mode:screen`
(`start-screen.html:29-30`) repaints on the main thread each frame and is not compositor-driven. It is cheap next to WebGL, but
the board stays open for hours. Change: add to the spec that the implementer checks CPU once in Electron and may use a
`transform`-based shift. Not a gate.

**N5. Hard-coded Aurora colours and prototype-only dims.** `start-screen.html:31-32` uses fixed hex stops (`#16130a`,
`#b28d29`, `#e8c75a`, `#9a7522`, `#f8f1e5`, `#e8ba66`, `#f3d9a3`, `#d49b4d`) beside `var(--s)`. Decision #12 says "tinted with
theme tokens"; spec line 52 discloses them as prototype tuning values. Change: state in the spec that production derives the
stops from `secondary` and `base-100` with `color-mix`, and that the `.62` / `.55` opacity rules are prototype-only and
must not become alpha text classes.

### User decisions needed

None. No capability removal beyond decisions #9-#11 (dock, ticker, chip), which the user already approved, appears in the
design or the screenshots.
