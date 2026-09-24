# Batches 2 and 3 - Glm review

Outside code-logic review (Glm) for Batches 2 (commit 378e97f82) and 3 (commit a8f8e2c69).
Scope: behavioural correctness only. No code was edited. Verified against the installed
`@angular/router` 22.1.7 (`node_modules/@angular/router/fesm2022/_router-chunk.mjs`) and the
installed `@ptah-extension/ui` primitive.

Evidence runs (this review, scoped):

- `npx nx test @ptah-extension/core --testPathPatterns=surface-router` — 1 suite, 29/29 passed.
- `npx nx test @ptah-extension/chat --testPathPatterns=global-config-menu` — exit 0; full chat
  project run: 98 suites, 1526 passed, 2 skipped (pre-existing), 0 failed. This subsumes the menu
  spec and the untouched `workspace-coordinator.service.spec.ts` assumption.

## Batch 2

Verdict: ACCEPT ; Score: 9/10

The mechanism is verified against the installed Router source, not just the tests:

- `OutletContext.injector` is a getter over `route.snapshot._environmentInjector` with a
  `rootInjector` fallback (`_router-chunk.mjs:1255-1257`), and the Router's own activation path
  passes exactly `context.injector` into `activateWith` (`_router-chunk.mjs:2317`). The captured
  value is therefore the same injector the Router itself would use.
- `RouterOutlet.deactivate()` (`_router-chunk.mjs:1797-1805`) destroys the component, clears only
  the outlet's own `activated`/`_activatedRoute`, and emits `(deactivate)`. It does NOT clear the
  context's `route`. `activateWith` (`:1806-1824`) throws 4013 only when already activated, which
  the preceding `deactivate()` makes impossible. The re-created component is created with the same
  snapshot and the captured environment injector.
- The "child outlets re-activate from retained contexts" claim is real Router behaviour:
  destroying the parent runs the child outlet's `ngOnDestroy` → `onChildOutletDestroyed`
  (`:1277-1283`), which nulls `outlet`/`attachRef` but RETAINS `context.route`. When the
  re-created parent instantiates its child `<router-outlet>`, `initializeOutletWithName`
  (`:1750-1763`) sees the retained `context.route` and calls
  `activateWith(context.route, context.injector)` — the Router's own outlet-recreation path.
  The remount therefore replicates first-party behaviour; it is not an unsupported trick.
- No-op guards: `getContext(PRIMARY_OUTLET)` returns `null` or a context whose `outlet` is null
  (`ChildrenOutletContexts.getContext`, `:1300-1302`); component-less routes never activate the
  outlet (`isActivated` false). Both no-op cases are guarded and pinned by the spec.
- No `RouteReuseStrategy` is provided anywhere in `apps/` or `libs/` (all three grep hits are
  comments), so the direct `activateWith` cannot collide with detached-`attachRef` semantics.

The spec proves the claims it makes: new instance without `NavigationStart`, same URL including
query and fragment, parent + child re-created at the same child URL, and both no-op cases, on a
real Router and real `RouterOutlet`.

Numbered findings:

1. MINOR — `libs/frontend/core/src/lib/routing/surface-router.service.ts:165-173`. The JSDoc
   documents the pending-navigation rule and the switchWorkspace timing rule, but does not state
   the method's throw behaviour: an error thrown by the re-created component's constructor or
   `ngOnInit` propagates to the caller of `remountActiveSurface()` (the Router does not wrap
   `activateWith`). Failure scenario: the Batch 4 effect calls it inside `untracked`; a throwing
   surface constructor makes the effect itself throw, and the tick effect dies for the session.
   Fix: one JSDoc sentence ("Errors thrown by the re-created component propagate to the caller;
   any boundary belongs at the call site"), so the Batch 4 rule is also readable at the method.
   The rule already exists in `batches.md` Task 4.1 rule 3, so this is a documentation gap, not a
   behaviour gap.

2. MINOR — `surface-router.service.ts:157-158` claims `(activate)`/`(deactivate)` fire on every
   remount. True from source (`_router-chunk.mjs:1803`, `:1823`), but no spec pins it. Failure
   scenario: a future refactor of the method (for example swapping to `detach`/`attach`) would
   silently change the output contract that the Batch 4 shell may bind. Fix: assert the two
   outputs on the host `<router-outlet (activate)="…" (deactivate)="…">` in one existing remount
   case.

3. MINOR (informational, already recorded in `batches.md` Batch 2 outcome) — the
   capture-before-`deactivate()` order at `:169-171` is defensive, not load-bearing:
   `RouterOutlet.deactivate()` clears neither `ctx.route` nor `ctx.injector` (getter over
   `ctx.route`, `_router-chunk.mjs:1255-1257`), so both reads give identical values before or
   after. No fix required; do not remove the order either. The missing `loadChildren` case stays
   correctly deferred to TASK_2026_533 — the mechanism does not vary by eager or lazy route
   (`injector` comes from the same snapshot getter either way).

## Batch 3

Verdict: ACCEPT ; Score: 9/10

Verified against the contract (`batches.md` Task 3.1, task-description criteria 1, 2, 3, 6, 7),
the primitive, the removed handler, and the real `AppStateManager` seams:

- Criteria 1 and the item contract: four items in order Thoth, Setup hub, Marketplace, Settings
  (`global-config-menu.component.ts:100-113`), pinned by the spec including `data-test` hooks,
  `type="button"` on every item, and `panelRole` null leaving `.dropdown-panel` role-less
  (spec case 1).
- Criterion 2: `selectItem` calls `setCurrentView(id)` as the only navigation method
  (`global-config-menu.component.ts:155-159`); no `navigateToSurface`, no `Router`. The
  `canSwitchViews()` gate is enforced inside the real `AppStateManager.setCurrentView`
  (`app-state.service.ts:902-906`), so a gated click still closes the menu and navigates nowhere —
  the correct delegation, not a duplicated gate.
- Criterion 3: dismissal reproduces the removed `openThoth()` handler exactly — guard
  `!thothFirstRunDismissed()`, then `dismissThothFirstRun()`, then `setCurrentView('thoth')`
  (component `:155-158`; removed handler verified at `a8f8e2c69~1` `electron-shell.component.ts`
  `openThoth()`). The spec pins the order with `invocationCallOrder` and the once-only and
  already-dismissed cases.
- Criterion 6: trigger is a native focusable `<button>` with `aria-label="Configuration"`; Enter
  and Space open it through the native click path; arrow roving with `preventDefault()` and wrap
  both ends (`moveFocus`, `:143-153`); Enter activates the focused item natively; Escape on the
  panel closes and refocuses the trigger; `[panelRole]="null"` matches the repository pattern for
  plain action-button panels (`native-dropdown.component.ts:153-157`). The spec pins each of
  these on real DOM events, including `defaultPrevented`.
- Criterion 7: item activation, backdrop click and Escape all close; `(closed)` is wired to
  `closeMenu` (`native-dropdown.component.ts:223-228` emits `closed` on backdrop click with
  `closeOnBackdropClick`). The backdrop-refocus breadth beyond the plan's literal wording is the
  already-accepted Batch 3 outcome and is not re-flagged.
- State handling: `openConfigurationSurface` is a `computed` signal on the real service
  (`app-state.service.ts:596-598`); the component stores it directly and reads it in the template,
  with `OnPush`, `inject()`, and `signal(false)` for `isOpen`. `aria-current`, the item highlight
  and the trigger highlight all derive from that one signal, and the spec sweeps all five values
  through it, including the settled-state case after a no-op navigation.
- Imports only via barrels: `AppStateManager`/`ConfigurationSurfaceId` via
  `@ptah-extension/core` (`libs/frontend/core/src/index.ts:1` → `lib/services/index.ts:7`),
  `NativeDropdownComponent` via `@ptah-extension/ui` (`libs/frontend/ui/src/index.ts:32` →
  `./lib/native`), icons from `lucide-angular` (all five names present in
  `node_modules/lucide-angular/fesm2015/lucide-angular.mjs`). No CDK, no chat-ui import.

Numbered findings:

1. MINOR — `global-config-menu.component.ts:131-137` (panel `content` div). The keydown handlers
   (Escape, arrows) sit on the panel, but focus stays on the trigger until the dropdown's
   `opened` output fires, which happens only after an async `await this.floatingUI.position(...)`
   (`native-dropdown.component.ts:203-216`). Failure scenario: a keyboard user presses Escape or
   ArrowDown in the window between the click and the positioning resolution; nothing happens,
   and the menu stays open with focus on the trigger. The window is one microtask plus a
   positioning pass, and the precedent (`background-agent-strip.component.ts:321`) shares the
   property, so this is a pattern-level gap, not a regression. Fix (any later hardening task,
   not this batch): also close on `(keydown.escape)` on the trigger, or move focus into the panel
   synchronously on open and let `opened` only position.

2. MINOR — `global-config-menu.component.ts:38-53` (trigger). The trigger has `aria-expanded` but
   no `aria-haspopup`, and the role-less panel with arrow roving is not announced as a menu by
   screen readers. Criterion 6 only requires the accessible name, the keyboard operation and the
   repository's `panelRole` pattern, all of which hold, and the precedent omits `aria-haspopup`
   too (`background-agent-strip.component.ts:306-307`). Recorded so a later accessibility pass
   can add `aria-haspopup="true"` on both components at once. No fix in this batch.

3. MINOR (informational) — spec case 2 (`global-config-menu.component.spec.ts`, "reflects click
   toggles in aria-expanded") closes the open menu by clicking the trigger, but in the real DOM
   the `fixed inset-0 z-40` backdrop (`native-dropdown.component.ts:74-81`) overlays the trigger
   while open, so that exact path is served by the backdrop click instead. Both paths converge on
   the closed state with `aria-expanded="false"`, so user-visible behaviour is correct; only the
   proven branch differs from the live one. No fix required; noted so nobody reads the case as
   proof of the live toggle branch.

No Blocking or Serious issues were found in either batch. The residual uncertainty: neither
batch was exercised in the live Electron app (lanes cannot drive it); the manual Batch 4 checks
(fresh data per surface, macOS backdrop over the title bar) remain the live verification, and
the remount under a lazy `loadChildren` route stays deferred to TASK_2026_533 as recorded.