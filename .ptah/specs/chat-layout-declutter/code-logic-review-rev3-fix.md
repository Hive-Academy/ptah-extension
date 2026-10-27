# Code-logic review — Revision 3 fixes (working tree)

**Scope**: the fix delta after `code-logic-review-rev3.md` — the new `focusRailExpand()` path in
`canvas-inspector-dock.component.ts`, its regression test, the "Close session" scoping in the three
showcase scenes, and the disputed `send-to-messaging` tooltip. Rev3 context reused; everything not
named above keeps the rev3 assessment. No builds, tests or e2e were run here; the coordinator's
verify run (canvas 476 tests, typechecks, only pre-existing lint) is the execution evidence.

**Verdict: APPROVED** — 1 blocking resolved, 2 minor resolved (one by accepting the rebuttal), 0 new defects.

---

## Finding 1 (blocking) — RESOLVED

`closeCompactSheet()` now routes focus through the new private `focusRailExpand()`
(`canvas-inspector-dock.component.ts:391-396`), and `closeDock()` does the same
(`:491-497`). `focusRailExpand()` (`:402-421`) queries
`[data-inspector-rail] [data-inspector-expand]`; if absent it installs a `MutationObserver` on
`root()` and focuses the control when it mounts, but only if focus has not moved
(`:417`: `!active || active === doc.body || !active.isConnected`).

- **Correctness of the selector.** The target exists in both places that can render it: the real
  rail template (`session-inspector.component.html:6-13`, `data-inspector-expand` on the button
  inside the `presentation() === 'rail'` branch) and the spec's `InspectorStub`
  (`canvas-inspector-dock.component.spec.ts:30-35`). `data-inspector-rail` is on the
  `ptah-session-inspector` host (`canvas-inspector-dock.component.ts:141`), and the button is a
  descendant — the query can only match the real target.
- **The rev3 failure mode is closed.** While the sheet is open, the outer guard at `:130`
  destroys the rail defer block; the sheet close re-creates it in `@loading`. The one-shot
  `afterNextRender` therefore cannot find the button, and the observer covers the gap. The
  cold-load edge rev3 flagged for `closeDock()` is covered by the same observer, so both call
  sites now survive a slow or destroyed defer block.
- **No focus stealing.** The observer focuses only when `activeElement` is null, `<body>` or a
  disconnected node (`:417`) — i.e. nothing else holds focus. A user who clicked into the chat
  or focused any element keeps it; the observer then stops without focusing. This matches the
  "only move focus the user has not moved elsewhere" contract of the pre-existing `focusDock()`
  observer (`:536-544`).
- **Observer lifecycle.** The shared `detailsFocusObserver` field cannot hold two observers:
  every path that starts or changes a focus surface stops it first — `focusDetailsShell()`
  (`:361`), `focusRailExpand()` (`:403`), `toggleDetails()` (`:481`), `closeDock()` (`:492`),
  `handOffInspector()` (`:510`), `focusDock()` (`:522`) — and destroy stops it (`:339`). No
  interference with `focusDetailsShell`/`focusDock`: the sheet-open and rail-wait states are
  mutually exclusive (sheet open means the rail is unmounted, `:130`), so at most one of the
  three observers is ever live. The harmful-looking case — observer waiting while the user
  re-opens the sheet or dock — is impossible to reach: both actions pass through a path that
  stops it (`expandInspector` → `focusDetailsShell`/`focusDock`; `toggleDetails`; `handOffInspector`).
  Worst case (defer chunk never loads), the observer idles until destroy running one
  `querySelector` per mutation on a subtree observer — the same bounded-silence class rev3
  already accepted for `focusDock()` and `restoreBoardFocus` (`canvas-board-focus.ts:48-64`).
  Not harmful.
- **Stale `root`.** Not a defect: `root` is `boardElement = this.host.nativeElement`
  (`canvas-rail-board.component.ts:409`, passed at `:347`), stable for the dock component's
  lifetime, so the captured `root`/`doc` cannot go stale.
- **The test discriminates.** `canvas-inspector-dock.component.spec.ts:207-226` does **not**
  call `completeDeferBlocks` before `closeCompactSheet()`; it asserts the rail is absent and
  focus on `<body>` after the close render (`:220-221`), then completes the defer blocks
  (`:222`) and asserts focus landed on the expand control (`:224`). The `setTimeout(0)` at
  `:223` yields for the MutationObserver microtask before the assertion. On the old one-shot
  code no observer exists, so after `completeDeferBlocks` nothing focuses the button and
  `document.activeElement` stays `<body>` — line 224 fails. The pre-assertions (`:220-221`)
  pass on old and new code by design; the regression signal is line 224. The test's ordering
  (sheet open destroys the rail block; close re-creates it loading) models the production
  interleaving rev3 described.

## Finding 2 (minor) — RESOLVED

All three showcase scenes scope the stale-session cleanup to the sidebar before the group/button
lookup: `canvas-orchestra.scene.ts:126-129`, `chat-code-edit.scene.ts:222-225`,
`lane-console-review.scene.ts:102-106` (`.locator('[data-inspector-rail], [data-inspector-dock]')`).

- **The misfire is eliminated.** `data-inspector-rail` and `data-inspector-dock` exist only on
  the sidebar surfaces (`canvas-inspector-dock.component.ts:141`, `:198`; repo-wide grep finds
  no other element carrying either attribute). The panes' floating "Session controls" groups
  (`canvas-focus-header.component.ts:37`) render inside the pane sections, outside both, so the
  split-view wrong-pane close from rev3 can no longer happen.
- **The templates match the locator.** Both sidebar surfaces contain the group with Close
  session: the rail projects the header through the `inspectorRailControls` slot
  (`canvas-inspector-dock.component.ts:151` → `session-inspector.component.html:27`), the dock
  through `inspectorControls` (`:218` → `session-inspector.component.html:125`), and the Close
  session button renders unconditionally inside the group (`canvas-focus-header.component.ts:146-154`).
- **Rail and dock are mutually exclusive.** The rail renders under `!dockOpen()` (`:137`) and
  the dock under `dockOpen()` (`:165`), so the locator matches at most one surface and `.first()`
  is harmless. During a defer `@loading` the group is absent — the guarded scenes return via the
  `visible()` check instead of clicking a stale node.
- **Intent preserved.** The scenes still close the *focused* session from the sidebar, which
  after the card click is the stale session (the design the scene comments state,
  `canvas-orchestra.scene.ts:124`). Residual assumption: the card click focuses the stale
  session before the cleanup runs — unchanged by this fix, and the failure mode is now a
  swallowed no-op, not closing a live session.

## Finding 3 (minor, disputed) — ACCEPTED, no change needed

The rebuttal holds. The icon button is disabled exactly when hand-off is unavailable
(`send-to-messaging.component.ts:117`, `[disabled]="!canHandOff()"`), and a disabled form control
does not dispatch mouse events in any engine (HTML spec: disabled buttons are non-interactive),
so a `title` on the button itself would show **no** tooltip in the one state where the
explanation matters. The wrapping `<span trigger [title]="triggerTooltip()">` (`:112`) shows the
tooltip in both the enabled and disabled case, because hover over the wrapped button resolves to
the ancestor span's title. The accessible name is independent of the tooltip: the icon variant
carries `aria-label="Hand off session"` (`:118`), the text variant
`[attr.aria-label]="HANDOFF_LABEL"` (`:131`). Rev3's suggested fix (title on the button) would
have introduced a tooltip regression for the disabled state, so the current arrangement is the
better behavior. Rev3's future re-parenting note stays a note; it was never a behavior break.

---

## New defects

None found in the fix delta. Checks run on the delta:

- Observer double-registration and cross-talk between the three focus helpers — ruled out (see
  Finding 1 lifecycle trace; every entry point stops the shared observer first).
- Focus stealing from a stale observer firing late (e.g. the rail mounts for a *newly* focused
  session while the observer from an old close waits) — benign: it fires only when focus is on
  `<body>`/null/disconnected, and in that state focusing the rail expand is the intended restore.
  If the user re-opened any surface in between, that path already stopped the observer.
- `afterNextRender` firing after component destroy — Angular ties the callback to the injected
  injector (`{ injector: this.injector }`, `:395`, `:496`), so a destroyed component drops it.
- Scene cleanup under compact widths (< 400 px: neither rail nor dock matches) — the guarded
  scenes no-op; `lane-console-review.scene.ts` would time out at its click, but the showcase
  pipeline records at desktop widths only, and that shape predates the fix.

## The five logic questions (fix delta)

1. **Silent failure?** If the defer chunk never loads, the observer idles silently and focus
   stays on `<body>` — bounded, component-lifetime only, same class rev3 accepted for
   `restoreBoardFocus`.
2. **Unexpected user action?** Close the sheet, then click elsewhere before the rail mounts:
   focus is deliberately not restored — intended no-steal behavior.
3. **Wrong answer rather than error?** None found; the selector matches exactly one element
   (`data-inspector-expand` exists only in the rail branch, `session-inspector.component.html:9`,
   and the spec stub mirrors it).
4. **Dependency failure/odd shape?** Slow or destroyed defer block is the covered case. The
   scene locators degrade to a no-op instead of a wrong click.
5. **Missing?** No test pins the `closeDock()` cold-load observer path specifically (the new test
   covers the sheet path only). The sheet and dock paths share `focusRailExpand()`, so the risk
   is low; noted, not a defect.

## Decisions

- **Verdict APPROVED, not APPROVED WITH FIXES.** The blocking finding is resolved with a
  discriminating regression test; finding 2 is resolved; finding 3's rebuttal is accepted with
  evidence. No new defects. Options: APPROVED / APPROVED WITH FIXES (the cold-load test gap) —
  the gap shares the code path under test, so it does not gate.
- **Did not re-run verification.** The objective forbids builds/tests; the coordinator's verify
  run (all four projects, canvas 476 tests, typechecks green, lint identical to main) is taken
  as execution evidence. The e2e suite itself remains unrun, as in rev3.

## Could not check

- Real-browser MutationObserver timing (analyzed as microtask-before-timer; the test's
  `setTimeout(0)` yield matches that contract, and the coordinator's passing canvas suite
  executed the test in jsdom).
- The showcase scenes at runtime — static review only, as in rev3.