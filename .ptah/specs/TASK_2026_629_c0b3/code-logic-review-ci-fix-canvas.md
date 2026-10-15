# Code Logic Review: canvas round 2 CI fixes (PR #730)

Review family: Claude reviewing codex.
Scope: round 2 of `git diff -- libs/frontend/canvas` (uncommitted). Files read in full or in the
relevant regions: `canvas-rail-keyboard.ts`, `canvas-rail-board.component.ts`,
`canvas-focus-area.component.ts`, `canvas-rail.component.ts` (toggle, keyboard),
`canvas-layout.service.ts`, `orchestra-canvas.component.ts` (viewport and key host), the specs
in the diff, and the e2e specs named in the brief (read only). I did not re-run the codex
checks. I cite the report's pass counts (78/78, 10/10, 18/18) as unverified by me. I ran no checks.

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVE-WITH-FIXES |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 2 |
| Minor | 4 |

## Findings

### 1. Serious: the Rail collapse toggle is dead while auto-collapsed, and it silently flips the persisted state

- File: `canvas-rail-board.component.ts:672-678` (`toggleCollapse`); `canvas-rail.component.ts:110-113`
  (button); `:291-295` (`effectiveCollapsed`).
- Scenario: the canvas is narrower than 640 px (a VS Code sidebar, or a Git review dock open) and
  the persisted `railCollapsed` is `false`.
  - `effectiveCollapsed` is `true`, so the Rail shows its 56 px form and the toggle reads
    "Expand rail" with `›`.
  - The user clicks it. `toggleCollapse` writes `!board().railCollapsed`, so the persisted value
    becomes `true`. `effectiveCollapsed` was already `true`, so nothing changes on screen and the
    label stays "Expand rail".
  - A second click flips it back, again with no visible change.
- Impact:
  - The user can never expand the Rail below 640 px. That is the intended outcome, but the
    control advertises an action it cannot perform and gives no feedback.
  - Each click rewrites the persisted preference. After one "Expand" click and a window widening,
    the Rail comes back collapsed, which is the opposite of what the user asked for.
  - The button has no `aria-expanded` at all, only a changing `aria-label`. The state a screen
    reader hears ("Expand rail") is true, but activating it does nothing.
- Precedent: the existing "sm band with details open" auto-collapse (`:295`) has the same dead
  toggle. This change makes it far more common, because it now covers every width below 640.
- Fix: pass the auto condition to `ptah-canvas-rail` (for example `[autoCollapsed]`), and when it
  is true render the toggle `disabled` with a `title`/`aria-describedby` ("Widen the window to
  expand the Rail"). The board's `toggleCollapse` should also return early while
  `effectiveCollapsed() && !board().railCollapsed`. Add a spec that clicking the toggle at width
  639 does not call `store.setRailCollapsed`. The current spec only proves that resizing does not
  write (`canvas-rail-board.component.spec.ts:709-720`).

### 2. Moderate: the empty-board section can clip the new setup card

- File: `canvas-rail-board.component.ts:107-131` (the section), `:140` (the card).
- Scenario: a short window or webview, no sessions. The section is `flex flex-col items-center
  justify-center` with no `overflow-y-auto`, and its parent is `overflow-hidden`
  (`session-viewport`). The card is a skills warning, an Intelligent Project Setup card, and the
  heading and button above them. When the content is taller than the pane, `justify-center`
  clips the top and bottom, and the "Open Marketplace Skills" button may be unreachable.
- Impact: the removed `canvas-empty-state` had `overflow-y-auto` and an inner `my-auto` for exactly
  this case (`git show main:libs/frontend/canvas/src/lib/canvas-empty-state.component.ts`, lines
  27-30). This is a small regression of that safety.
- Fix: add `overflow-y-auto` to the section and `my-auto` on an inner wrapper, or use `min-h-0
  overflow-y-auto` with `justify-start` plus `my-auto`.

### 3. Moderate: narrow widths below 640 still lose the pane when details are open or the window is very small

- File: `canvas-rail-board.component.ts:180-211` (the details `aside` is `w-[288px] shrink-0`;
  the "Open details" button is `w-11`).
- Scenario:
  - With details open and a width of at most about 344 px (56 Rail + 288 aside), the pane has 0
    width.
  - At the 175 px seen in CI failure 4f, the collapsed Rail (56) plus the details button (44)
    leave about 75 px for the pane.
- Impact: the 640 px threshold fixes the "272 px Rail swallows everything" case, but the details
  column and button are not scaled down, so very narrow canvases are still cramped. The failure
  4f link click depends on Playwright scrolling the link into view inside the
  `overflow-x-auto` pane container, which should work, but I could not run it.
- Fix (follow-up, not a blocker): below about 400 px, hide the 44 px button and make the details
  aside an overlay, as split mode already does (`w-[min(360px,100%)]`).

### 4. Minor: no scroll re-anchor and a one-frame full-width flash

- File: `canvas-rail-board.component.ts:289-295`, `:411-415` (`anchor` only runs on band change).
  The user-driven toggle does call `anchor()` (`:677`). The auto-collapse crossing 640 does not,
  and card height changes between expanded and 56 px, so the focused card can leave the viewport
  after a resize.
- `containerWidth` starts at 0 and is set only after the ResizeObserver plus a
  `requestAnimationFrame` (`canvas-layout.service.ts:42-52`), so a narrow window first paints the
  272 px Rail for a frame and then collapses. This is cosmetic. It is not a feedback loop.
  `checkRailGeometry` resets its baseline on the changed `density|collapsed` key
  (`canvas-rail-geometry.ts:31`), so no `railShifts` are counted.

### 5. Minor: the "no nested landmark" board test is vacuous

- File: `canvas-rail-board.component.spec.ts:1292` asserts that the wrapper has no descendant with
  the same label, but the board spec uses `FocusStub`, which never renders a label. The real
  guarantee is the focus-area spec (`canvas-focus-area.component.spec.ts:276`, which checks that
  the inner `<section>` has no `aria-label`). That is enough, but the board assertion adds
  nothing.

### 6. Minor: the keyboard guard is horizontal-only, as decided

- File: `canvas-rail-keyboard.ts:64-80`. It is correct for the decision (#129):
  - Vertical-only scrollers no longer swallow ArrowLeft/Right.
  - Body and `documentElement` targets skip the guard.
  - Targets outside `ctx.host` are ignored.
  - An optional `host` that is missing skips the containment check and walks to the document
    root. `canvas-rail.component.ts:292` passes no `host`, but it only reaches the non-card
    branch from the list gap, which is harmless. `orchestra-canvas.component.ts:265` passes the
    viewport.
- Residual: other arrow-consuming widgets inside a pane (a slider or radio group that is not an
  `input`, `role="menu"` and `role="dialog"` are already ignored) would still lose to board
  navigation. That is pre-existing behaviour and out of scope.

### 7. Minor: one file went stale during the review

- `canvas-rail-board.component.ts` changed line numbers during my reading. The earlier region
  shows the card at line 131 and the later one at 140, which suggests another writer is
  formatting or editing the file. Line numbers above are approximate for the later part of the
  file.

## Answers to the brief's checks

1. Auto-collapse below 640 px:
   - Display-only: yes. `effectiveCollapsed` is a derived `computed` and the persisted
     `railCollapsed` is untouched (`:291-295`; spec `:709-720` asserts `setRailCollapsed` is not
     called).
   - Unmeasured: `containerWidth() > 0` guards 0, so unmeasured stays expanded. Boundary values
     0, 639, 640 are tested.
   - Feedback loop: none. The measured element is `session-viewport`
     (`orchestra-canvas.component.ts:229-232` and `layoutService.observe`), the outer container.
     The Rail width does not affect it.
   - Toggle and `aria-expanded`: see finding 1. This is the one real defect. There is no
     `aria-expanded` anywhere on the toggle.
   - Split and stack: `splitStacked` is `containerWidth < 1440`, so it is always stacked below
     1440. Split panes keep `min-w-[360px]` / `min-h-[400px]` and the container scrolls
     horizontally, so a collapsed Rail simply gives them more room. In split mode there is no
     details column, so the collapsed Rail composes cleanly. The details column at narrow widths
     is finding 3.
2. One `Focused session: <title>` landmark per pane: yes. The label is only on the board's pane
   wrapper (`:142`/`:151` region, `[attr.aria-label]="paneLabel(side, id)"`). The inner `<section>`
   has no name, so it is not a landmark. Split mode uses `Left/Right/Top/Bottom session: ...`, one
   per pane. Screen readers still get a label. `paneLabel` stays on the board for the announcements
   (`:611`). No other product code binds `[paneLabel]` (grep).
3. Setup card: only inside `canvas-rail-empty-board` (`:140`). There is no duplicate with
   `chat-empty-state`, because that empty state renders only in `ChatView` when no tab exists
   (`chat-view.component.html:96-100`), and the empty board does not mount a `ChatView`. The first
   button in the section is still "New session", so the existing selector in the spec
   (`[data-testid="canvas-rail-empty-board"] button`) is unaffected. The overflow regression is
   finding 2.
4. Horizontal-only guard: correct, covered by three new specs. See finding 6.

## Do the product changes make the CI failures pass?

I cannot run e2e (forbidden), so this is a static judgement.

- 3a plan-limits `stats strip` (6 tests): likely pass. The spec edit
  (`plan-limits-visual.e2e.spec.ts:116`, `ptah-canvas-focus-area`) matches the Rail DOM. At the
  tested widths 280/360/440 the Rail now auto-collapses to 56 px, so the pane gets about 180, 260
  and 340 px minus the 44 px details button, instead of the 124 px or zero the report feared.
  The strip should be visible and the "Close panel" click should land. Confidence medium: the
  first-render width flash and the agent-monitor panel at about 180 px are not provable
  statically. The `strip` locator is `toBeVisible`, which does not need the pane fully in view.
- 3b marketplace D2 "Open Marketplace Skills": likely pass. `CanvasHost` hydrates the implicit
  workspace on construction (`orchestra-canvas.component.ts:332`), so a board mounts and the empty
  board shows the setup card (`!hasConfiguredSkills()` renders the button). The button is visible
  as long as the section is not clipped (finding 2), and the e2e viewport is large enough.
- 4a `canvas.spec.ts:65`: passes. `getByRole('region', { name: 'Focused session' })` now resolves
  one element, the pane wrapper (`canvas.spec.ts:74`).
- 4f `agent-file-links.spec.ts:134`: probable pass, medium-low confidence. In the CI artifacts the
  canvas was about 175 px wide, so the new rule collapses the Rail to 56 px and the pane gets
  about 75 px next to the 44 px details button. The link `b` sits in a pane that is now inside the
  viewport and scrollable (`overflow-x-auto` container), so Playwright's scroll-into-view should
  reach it and the hit test should hit the anchor, not `session-viewport`. The pane is still
  very cramped (finding 3), so a minimum-content overflow could still clip it. If it does not
  pass, the next step is finding 3's overlay.

## Five logic questions

1. Silent failure: the Rail toggle in finding 1. It reports success and changes the persisted
   preference without any visible effect.
2. Unexpected user action: clicking "Expand rail" below 640 px (finding 1); opening details in a
   very narrow canvas (finding 3).
3. Wrong output from input data: a width of exactly 0 (unmeasured) leaves the full Rail by design.
   Fractional widths are floored by the layout service. No wrong-answer path found.
4. Dependency failure: `ResizeObserver` never firing leaves the width at 0, so the Rail stays
   expanded, which is the old behaviour. No new dependency was added except
   `ProjectSetupCardComponent`, which injects its own services and was already used by the
   deleted empty state.
5. Missing: a disabled/explained toggle (finding 1), overflow on the empty board (finding 2), and
   scroll re-anchoring on auto-collapse (finding 4).

## Verdict

- Recommendation: APPROVE-WITH-FIXES. The five round-2 items do what the decisions (#128, #129)
  require and fix the stated CI causes. Fix finding 1 (and add a spec for the toggle at width 639);
  fix finding 2 with one class change; findings 3-7 are follow-ups.
- Confidence: MEDIUM-HIGH on the code logic, MEDIUM on the e2e outcomes (static reading only).
- Top risk: the Rail toggle button looks active below 640 px but only rewrites the saved
  preference.
