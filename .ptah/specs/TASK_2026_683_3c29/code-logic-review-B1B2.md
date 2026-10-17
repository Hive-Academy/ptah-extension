# Code Logic Review (B1, B2, B0 last pass) - TASK_2026_683_3c29

Reviewer: Claude (implementer: codex). Read-only. No test was run (heavy gate in progress), so every
spec claim below is from reading, not execution. Installed `@angular/router` is 22.1.7.

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | NEEDS_FIXES |
| B1 | 8/10, sound; 2 moderate items |
| B2 | 5/10, one serious unverified risk plus one timing gap |
| B0 (C, D) | 4/10, two assertions can falsely fail; the existing viewTransition probe is broken |

Counts: serious 3 (B2-1, B0-1, B0-2), moderate 5, minor 3.

---

## B1 - surface feature, tracker, wiring

Verified OK (evidence):

- `inject()` is legal: `createViewTransition` calls `runInInjectionContext(injector, () => onViewTransitionCreated(...))`
  with the root environment injector (`_router-chunk.mjs:3706-3712`). `inject(SurfaceTransitionTracker)`
  (providedIn root) resolves. The real-Router spec would throw NG0203 otherwise.
- `skipInitialTransition` is consumed by the first navigation that reaches `createViewTransition`
  (`_router-chunk.mjs:3677-3681`; `skipNextTransition` seeded at `_router_module-chunk.mjs:1837`). With
  `withDisabledInitialNavigation` that is the host `handleInitialView` navigation. Correct. Cancelled
  navigations do not consume it.
- Surface identity vs `app.routes.ts:78-195`: every top-level route is a single segment equal to a member of
  `SURFACE_ROUTE_IDS` (`webview-surface.types.ts:65-77`), so `from.firstChild.url[0].path` is right for chat
  (component-less + `''`/`:tabId` children), component and `loadComponent` routes, `loadChildren` thoth and
  marketplace, and matrix params (not in `UrlSegment.path`). `''` and `**` redirects are resolved before the
  target snapshot, so `to` is already `chat`. `apps` refused by `canMatch` falls to `**` -> chat. I found no
  surface change that is skipped and no same-surface navigation that animates today.
- Superseded transitions: `startViewTransition(B)` skips A, so A.finished resolves after `track(B)` ran
  synchronously (`current` is already B), so `settle(A)` is ignored and callbacks wait for B. If B is a skipped
  same-surface transition (never tracked), A is still skipped by the browser, A.finished resolves, A settles and
  flushes. No callback lost, none run twice (`callbacks` is swapped before the loop). Re-entrant
  `afterTransition` inside a callback runs synchronously (current is already cleared). Correct.
- Rejected `finished`: the two-arm `.then` handles it with no unhandled rejection. Router also attaches its own
  catches (`_router-chunk.mjs:3691-3703`).
- Nothing outside the Router calls `startViewTransition` (grep over apps/ and libs/: only specs and the e2e probe).
  `remountActiveSurface` and layout toggles do not navigate, so U3 holds.

### B1-1 (Moderate) A throwing `afterTransition` callback drops the remaining callbacks

- `surface-view-transitions.ts:~58-62` (`settle`): `for (const callback of callbacks) callback();` has no
  try/catch. One throw ends the loop, so every later queued callback is lost, and the throw happens inside a
  promise reaction (unhandled rejection). Contradicts plan component 2 "no callback is lost".
- Fix: wrap each call, `try { callback(); } catch (error) { console.error(...) }` (or report through the
  existing logger), and keep iterating. Add a spec: first callback throws, second still runs.

### B1-2 (Moderate) Dev builds log a console error for every skipped transition

- Router attaches `transition.ready.catch(console.error)` under `ngDevMode` (`_router-chunk.mjs:3691-3697`).
  `skipTransition()` rejects `ready` with `AbortError`, so every same-surface navigation (tab switch, Thoth tab,
  matrix change) and every reduced-motion navigation logs an error in a dev build. The e2e fixtures capture
  renderer console errors (`apps/ptah-electron-e2e/src/support/fixtures.ts:10`), so a dev-build e2e run could
  fail on noise. Production is unaffected.
- Fix: no public API avoids it. Record it in the batch report and make the e2e console-error filter ignore
  `AbortError: Transition was skipped`, or confirm the e2e build is production.

### B1-3 (Minor) Latent fragility of `firstChild.url[0]`

- `surface-view-transitions.ts:~17-18`. If a future top-level route uses `path: ''` with children (empty-path
  parent), `firstChild.url` is `[]`, every surface under it maps to `chat`, and chat <-> that surface is
  silently skipped. No such route exists now. Add one line to the file doc, or add a spec that walks
  `appRoutes` and asserts each top-level route has a non-empty single-segment path in `SURFACE_ROUTE_IDS`.

### B1-4 (Minor) Specs

- Real Router, real route shapes, real guard cancellation: good (`surface-view-transitions.spec.ts`). Only
  `document.startViewTransition` is stubbed, and the stub's `skipTransition` is a bare `jest.fn()` that does not
  resolve `finished` or abort the previous transition, so "rapid navigation" proves tracker bookkeeping, not the
  browser's supersede behaviour. Acceptable; say so.
- `webview-routing.spec.ts:993` pins `source.toContain('withSurfaceViewTransitions()')`. A commented-out line
  would pass. Minor; strip comments or match `/^\s*withSurfaceViewTransitions\(\),/m`.
- None of the new specs were executed.

---

## B2 - CSS and Electron naming

Verified OK:

- Exactly one `.ptah-vt-surface` per Electron shell state: welcome (`electron-shell.component.ts:271`) and the
  pre-workspace outlet wrapper (`:273`) are exclusive `@if/@else if` branches; the host (`:308`) is the `@else`.
  Nothing else in `apps/` or `libs/` carries the class or a `view-transition-name` (grep). Nested outlets:
  `ptah-app-shell` has its own outlet inside the named host, and the shell-level outlet is only in the
  pre-workspace branch, so no two named elements coexist. No `animate.leave` on these branches, so no old/new
  overlap in the DOM.
- VS Code: no name anywhere, so only the implicit `root` group exists; `::view-transition-old/new(root)` is a
  symmetric 180 ms cross-fade (old `1 -> 0`, new `0 -> 1`, same easing, default `plus-lighter` blend), no dip.
- Reduced motion: `animation: none !important` on group/old/new `(*)` (`styles.css` accessibility block) plus the
  JS `skipTransition()`. Both layers present.
- `::view-transition { pointer-events: none }` present; the overlay is inert for the whole transition.
- The Electron spec (`electron-shell.view-transition.spec.ts`) renders the real template for the three states.
  It overrides `imports: []` with `CUSTOM_ELEMENTS_SCHEMA`, so it proves the template only; a child component
  that carried the class would not be seen. Acceptable (grep shows none).

### B2-1 (Serious, verify first) A permanent `view-transition-name` may re-parent fixed/absolute UI inside the host

- `styles.css` `.ptah-vt-surface { view-transition-name: ptah-surface; }` is applied at all times to
  `#configurationSurfaceHost` (`electron-shell.component.ts:308`), the welcome host and the outlet wrapper.
- CSS View Transitions makes an element with a non-`none` `view-transition-name` a stacking context and (per
  spec text and, I believe, Chromium) a containing block for fixed and absolute descendants. If so, every
  `position: fixed` element inside `ptah-app-shell` in Electron is now positioned and clipped relative to the
  host (`overflow-hidden`), not the window. Candidates found by grep: the page toast `fixed bottom-6 right-6`
  (`settings-toast.component.ts:32`), `fixed inset-0 z-50` modals/command surfaces and drawers
  (`native-drawer-root`, several settings modals), and floating-ui `strategy: fixed` popovers
  (`libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts`), whose offset-parent logic does not know
  about this containing block, so dropdowns/popovers could land offset by the host's left/top. Native `<dialog>`
  (top layer) is unaffected. The sidebar/titlebar would also stay interactive under a "full-screen" backdrop.
- Neither the plan nor the batch report checked this; the spec cannot.
- Verify (one probe in Electron, ~1 minute): open a `fixed inset-0` surface or the settings toast with and
  without the class and compare `getBoundingClientRect()`.
- Fix if confirmed: name the element only while a transition animates. In `SurfaceTransitionTracker.track()` add
  a class (for example `ptah-vt-animating`) on `document.documentElement`, remove it in `settle()` (including
  the superseded path); CSS becomes `.ptah-vt-animating .ptah-vt-surface { view-transition-name: ptah-surface; }`.
  The class is added synchronously in the creating task, before the old state is captured, so the old
  snapshot is still named. Do not add it for skipped transitions. (`:root:active-view-transition` also works
  but applies to skipped transitions for one frame.) Update the shell spec accordingly.

### B2-2 (Moderate) The overlay outlives the 180/200 ms animations by about 50-70 ms

- `styles.css` sets durations only on `::view-transition-old/new`. The UA group animation
  (`::view-transition-group(*)`, default 0.25 s) is not overridden, and the transition does not finish until
  every pseudo-element animation ends. `SurfaceTransitionTracker.busy` and the deferred URL correction
  (component 5, B3) therefore wait about 250 ms, not 180-200 ms, and M1 timing checks will see a longer tail.
  Nothing is visible in the tail (old/new have ended; snapshot is the new state) but pointer-events are off and
  the page is a frozen snapshot.
- Fix: `::view-transition-group(root) { animation-duration: 180ms; }` and
  `::view-transition-group(ptah-surface) { animation-duration: var(--ptah-motion-in); }`.

### B2-3 (Minor) 120 ms old vs 200 ms new on the named group

- Different durations and easings on a `plus-lighter` pair mean the combined alpha dips (roughly 0.85 around
  60 ms), so the root-layer background shows through the hole for a few frames. It is by plan (Motion spec),
  not a defect; worth a glance in the M1 frame strip, in light theme especially.

### B2-4 (Minor) Welcome host display

- `<ptah-electron-welcome class="flex-1 ptah-vt-surface">` relies on being a flex item (blockified) for the name
  to apply; a custom element is `display: inline` by default. True today (parent is the column flex shell).

---

## B0 - last pass (`nav-session-motion.perf.spec.ts`)

Checked against `measurements/m0.json` (102 baseline windows), because M1 asserts compare to the same recorder.

### B0-1 (Serious) `viewTransition` probe is true in every baseline sample, so S1 assertions are vacuous and the S6 assertion always fails

- Probe: `nav-session-motion.perf.spec.ts:138,147`: `viewTransition: getComputedStyle(documentElement).viewTransitionName !== 'none' || ...`.
  In `m0.json` all 408 samples (102 windows x at0/at50/at100/at400), across S1 to S8, are `viewTransition: true`, with
  no view transition in the base build.
- Consequences in M1 (`:581-584`): the three `S1 ... transition` assertions and "return to Chat stays active at
  +100 ms" pass on the unchanged base (vacuous); `S6 view transitions absent` (`every(!viewTransition)`) fails on
  every S6 window regardless of the implementation (false fail).
- Fix: drop the computed-style term. Use `document.documentElement.matches(':active-view-transition')` (Chrome
  125+, Electron here is Chrome 152) or only the `pseudoElement?.startsWith('::view-transition')` animation test,
  and re-record M0 so the baseline shows false.

### B0-2 (Serious) D: `splitPaneAnimations > 0` at +50 ms is sampled too late

- `:566` (`S8 open: at50.splitPaneAnimations > 0`) and the reduced S6 `=== 0` check. In the recorded M0 the
  `at50` sample of the S8 open windows fired at 315 ms and 226 ms (`m0.json` `samples.at50.atMs`), and S4 at
  334-457 ms, because of long tasks. The planned pane animation is 180 ms and `animate.enter` removes it at the
  end, so by the time the sample runs the animation is gone: the positive check falsely fails, and the reduced
  `=== 0` check passes for the wrong reason (vacuous).
- The `getAnimations({ subtree: false })` + `effect.target === pane` filter itself is correct.
- Fix: record starts instead of sampling a point in time: add a capturing `animationstart` listener (and
  `getAnimations` right after the click's rAF) that logs events whose `target` is a split-pane `section`; assert
  on the recorded count. Same pattern for the entrance below.

### B0-3 (Moderate) C: `layoutShiftAll === 0` falsely fails for S4 first-open windows

- `:557`. Baseline `m0.json`: S4 `first-open-2` and `first-open-3` have `layoutShiftAll` 0.00466 and
  `first-open-1` 0.00009; all other non-split rows are 0. M1 will fail these three unless the later batches remove
  that shift, which is not a stated goal. The split exclusion is correct (split rows shift 0.028-0.047 in M0).
- Fix: assert `row.layoutShiftAll <= (baselineRow?.layoutShiftAll ?? 0) + 0.001` instead of `toBe(0)`, or add
  S4 to the exclusion list with a comment.

### B0-4 (Moderate) Entrance selector once B4 lands

- M0 summary: the probe targeted `.chat-msg-slot` while the animation ran on `.st-t[data-st-i]`
  (`chat-view.component.css:227-228`), so `placements` was empty. After B4 the plan puts the animation on the
  slot wrapper: `renderer.addClass(slot, 'ptah-turn-enter')` (`chat-transcript.component.ts:1143`) with keyframes
  `ptahTurnEnter` (`chat-transcript.component.css:1-7`) and `--i`. So M1 must use
  `.chat-msg-slot.ptah-turn-enter` (animation name `ptahTurnEnter`), not `.st-t`. Keep `.chat-msg-slot` for the
  placement query (`:107,161`) and add a negative assertion: zero running animations named `ptahStaggerUp` /
  targets matching `.st-t` (proves B5 removed CV-2.1).
- Same timing flaw as B0-2: `placementSample` (`:158-175`) reads `animationName/--i/animationDelay` from computed
  style at the sample moment, and the class is removed after the entrance (`:1449`). With S3/S4 samples at 330-450
  ms, `entrance exists` (`:569-573`) can falsely fail. Capture `animationstart` on the scroller (target slot, name,
  `--i`, `animationDelay`) from the click until +400 ms instead.

### B0 other

- Fix D reduced-motion gate scoping to split windows is right. Fix B (rearm) was not re-reviewed beyond this scope.

---

## Five logic questions (B1/B2)

1. Silent failure: a throwing queued callback is swallowed in a promise reaction and drops later callbacks
   (B1-1); the naming class silently re-parenting fixed UI (B2-1); two probes reporting wrong results (B0-1/2).
2. Unexpected user action: rapid page changes (handled), switching workspace mid-transition (no navigation, no
   transition), opening a modal then navigating (modal is in the snapshot; fine).
3. Wrong answer from data: an empty-path top-level parent route would classify as `chat` (B1-3).
4. Dependency failure: no `startViewTransition` falls back to the Router's `setTimeout` path; hidden document
   skips the transition and still runs the update callback; `finished` rejection handled.
5. Missing: dev-mode console noise from skipped transitions (B1-2); group duration (B2-2); an empirical check of
   fixed-descendant behaviour (B2-1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Component 1 (feature, identity, reduced motion) | COMPLETE | B1-3 fragility only |
| Component 2 (tracker) | PARTIAL | B1-1 throwing callback |
| Component 8 (app.config wiring) | COMPLETE | text-only pin |
| Component 3 (tokens, VT CSS) | PARTIAL | group duration (B2-2) |
| Component 4 (single name per state) | COMPLETE | B2-1 side effects unverified |
| B0 C, D assertions | PARTIAL | B0-2, B0-3; probe B0-1 |

## Verdict

NEEDS_FIXES. B1 is mergeable after B1-1. B2 should not be accepted until B2-1 is measured (or the name made
transient) and B2-2 is added. B0 assertions need B0-1 to B0-3 fixed before M1 can be trusted. Confidence: HIGH on B1
and on the B0 findings (baseline numbers read from `m0.json`); MEDIUM on B2-1 (spec/engine behaviour recalled, not
executed here).
