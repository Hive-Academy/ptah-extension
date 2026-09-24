# Batch 2 Internal Code-Logic Review — `TASK_2026_540_0940`

Scope: `git diff -- libs/frontend/core/src/lib/routing/surface-router.service.ts libs/frontend/core/src/lib/routing/surface-router.service.spec.ts` (codex lane, uncommitted at review time; Batch 1 is already committed at `78a3b0546` and used only as context for how `configurationSurfaceRemountTick` is produced).

Contract checked against: `implementation-plan.md:3-24` (Revision 3 override 1), `plan-review.md:226-266` (R2-1) and `:288-295` (R2-3), `batches.md:148-186` (Batch 2, Tasks 2.1/2.2, Risk RA), `batch-2-report.md`.

Angular Router installed: `22.1.7` (`node_modules/@angular/router/package.json:3`). All line citations below against `node_modules/@angular/router/fesm2022/_router-chunk.mjs` were re-read directly in this review, not taken from the report.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment           | ACCEPT WITH FIXES                    |
| Blocking issues     | 0                                     |
| Serious issues      | 0                                     |
| Moderate issues     | 1                                     |
| Failure modes found | 2                                     |

The implementation matches its contract exactly — line-for-line against the plan's pseudocode (`implementation-plan.md:13-16`) — and the Router-internals claims in `plan-review.md` R2-3 hold against the installed `22.1.7` source, re-verified independently in this review. The four spec cases are real, non-trivial and use genuine `RouterOutlet` activation, not a mock. The one gap worth fixing is that `remountActiveSurface()`'s own JSDoc doesn't warn a caller (Batch 4) about the one real timing hazard this mechanism has — a navigation in flight to a different surface — even though the class already exposes `pendingSurface()` for exactly this kind of guard.

## Five logic questions

### 1. How does this fail silently?

It mostly doesn't — `remountActiveSurface()` either recreates the component or is a documented no-op; there is no path that reports success while doing nothing wrong. The one silent-cost path: if a caller invokes it while `pendingSurface()` is non-null (a navigation to a *different* surface is in flight), the method will not error, not warn, and not skip — it will deactivate+reactivate the outgoing component anyway (`surface-router.service.ts:158-166`). The component that gets rebuilt is about to be torn down again microtasks later when the in-flight navigation lands, so its constructor/`ngOnInit` side effects (data fetches, IPC calls) run and are then instantly discarded. Nothing observes or logs this waste — see Failure mode 1.

### 2. What user action produces unexpected behaviour?

Fast, overlapping user actions: switching workspace (bumps `configurationSurfaceRemountTick`, Batch 1 evidence: `app-state.service.ts:264-268` per `git show 78a3b0546`) while also clicking a different surface in the just-added `GlobalConfigMenuComponent` (Batch 3, navigates via `navigateToSurface`, which is async and can be mid-flight for a lazy chunk). If Batch 4's shell effect fires `remountActiveSurface()` during that window, the user briefly gets a pointless extra construction of the surface they are navigating *away* from. Not data loss, not a stuck UI — just wasted work and a possible flash, described in more detail in Failure mode 1.

### 3. What input data produces a wrong answer?

None found for `remountActiveSurface()` itself — it reads no external input, only `ChildrenOutletContexts` state, and every branch (`ctx` null, `ctx.outlet` null, `isActivated` false, `ctx.route` null) is covered by the "return without throwing" guard and exercised by the spec's cases 3 and 4.

### 4. What happens when a dependency fails?

`ctx.outlet.deactivate()` and `ctx.outlet.activateWith(...)` are synchronous Angular Router calls with no I/O; `deactivate()` never throws (it no-ops if nothing is activated — `_router-chunk.mjs:1797-1804`), and `activateWith()` only throws `RuntimeError 4013` if the outlet is already activated (`:1806-1808`), which cannot happen here because `deactivate()` was just called synchronously on the same outlet with nothing able to run in between (single-threaded JS, no `await` in the method). If the recreated component's own constructor throws (e.g. an injected dependency fails), that propagates out of `remountActiveSurface()` uncaught — same as it would for any first-time route activation — and is not this method's contract to catch. Not a gap specific to this batch.

### 5. What is missing that the requirements never mentioned?

The plan and `batches.md` scope the pending-navigation interaction as an out-of-batch concern (`remountActiveSurface()` is a primitive; the decision of *when* to call it belongs to Batch 4's shell effect). That is a reasonable split, but neither this batch's JSDoc nor `batches.md` Batch 2 mentions that `pendingSurface()` (already on the same service, `surface-router.service.ts:102-106`, built for exactly this "is the user mid-navigation" question) should gate the call. Leaving that unsaid risks Batch 4 wiring the effect unguarded. See "Instructions for the Batch 4 implementer" below.

## Failure modes

### 1. Wasted/duplicate component construction when a navigation is in flight

- Trigger: `remountActiveSurface()` is called while `router.currentNavigation()` is non-null and heading to a route other than the one currently in the primary outlet (e.g. user clicks a different `GlobalConfigMenuComponent` item at nearly the same moment as a workspace switch).
- Symptom: the component the user is navigating away from is destroyed and immediately reconstructed (running its constructor/`ngOnInit` again — possible duplicate RPC/IPC calls, a visible flash), then destroyed for real a moment later when the pending navigation's `activateRoutes` phase runs (verified at `_router-chunk.mjs:2288-2320`: `deactivateRouteAndOutlet` at `:2261-2277` unconditionally tears down the outlet for routes leaving the tree, regardless of what is currently attached).
- Evidence: `surface-router.service.ts:158-166` has no check against `this.router.currentNavigation()` / `pendingSurface()`.
- Current handling: none — the method always proceeds if the outlet is currently activated.
- Recommendation: Batch 4's effect (or a future revision of this method) should skip the call when `pendingSurface() !== null` and, ideally, is not the surface already showing. This is not a Batch 2 defect against its own written contract (the contract explicitly delegates call-site timing to the Electron shell), but the primitive's JSDoc should say so explicitly rather than leaving it to be inferred. Not blocking; recommend adding one sentence to the JSDoc at `surface-router.service.ts:145-156` before this batch is folded into the branch.

### 2. `(activate)`/`(deactivate)` outlet outputs fire on every remount, not only on real navigation

- Trigger: any future code that binds `(activate)`/`(deactivate)` on the app's single `<router-outlet />` (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:48` — confirmed no such binding exists today).
- Symptom: a handler written assuming "this only fires on navigation" (e.g. analytics, scroll-restoration, focus management) would also fire on every workspace-switch remount, which is not a navigation.
- Evidence: `RouterOutlet.deactivate()` emits `deactivateEvents` and `activateWith()` emits `activateEvents` unconditionally (`_router-chunk.mjs:1797-1804`, `:1806-1824`); `remountActiveSurface()` calls both.
- Current handling: not applicable today (no listener exists), so no live bug.
- Recommendation: informational only — worth a one-line JSDoc note so a future author of an `(activate)`/`(deactivate)` handler on the outlet knows the remount will also trigger it. Not blocking.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### MODERATE — JSDoc does not warn callers about the pending-navigation hazard

- File: `surface-router.service.ts:145-156`
- The JSDoc documents the `switchWorkspace` timing hazard (`workspaceInfo` set after the coordinator returns) but says nothing about calling this during an in-flight navigation to a different surface, even though `pendingSurface()` exists on the same class specifically to answer "is a navigation in flight" (`:90-106`, written for `AppShellComponent`'s analogous timing problem). See Failure mode 1.
- Fix: add one paragraph to the JSDoc: callers should skip the call when `pendingSurface()` is non-null (or is a surface other than the one that would be remounted), to avoid recreating a component that a concurrent navigation is about to tear down anyway. This is cheap to add now and removes any ambiguity for whoever writes the Batch 4 effect.

### MINOR — "Risk RA" (capture-before-deactivate) is not actually exercised by any test

- File: `batches.md:165` ("Risk RA"), `batch-2-report.md:46` ("Both `ctx.route` and `ctx.injector` are captured... before `deactivate()`... The real-router tests cover replacement instances and retained child contexts").
- `RouterOutlet.deactivate()` (`_router-chunk.mjs:1797-1804`) only mutates `this.activated`/`this._activatedRoute` on the `RouterOutlet` instance; it never touches `OutletContext.route` or the `injector` getter (`OutletContext.injector` reads `this.route?.snapshot._environmentInjector`, `_router-chunk.mjs:1249-1257`), and `OutletContext.route` is owned by the Router's own `ChildrenOutletContexts`, not by the outlet. Reversing the implementation to capture `route`/`injector` *after* `ctx.outlet.deactivate()` would produce byte-identical values in every one of today's four test cases, because nothing in the synchronous call reassigns `ctx.route` in between. None of the four spec cases would fail if the capture order were reversed.
- Impact: none functionally — capture-before-deactivate is still the right defensive pattern (it protects against a future Angular version, or a future `(deactivate)` listener, that does mutate context state reentrant to `deactivateEvents`), and the implementation follows it correctly. The issue is that the report's claim that "the real-router tests cover" this specific risk (the capture ordering) overstates what the tests prove — they prove the *outcome* (new instance, retained child context, unchanged URL), not the ordering requirement itself.
- Fix: none required in code. If the team wants RA genuinely pinned, a unit test would need to stub `ctx.outlet.deactivate` to mutate `ctx.route` synchronously and assert the captured values were used — not necessary for this batch to be accepted, noting for completeness only.

### MINOR — No test exercises a `loadChildren` + redirect `''` child, the shape TASK_2026_533 will introduce

- The child-route spec case (`surface-router.service.spec.ts:345-376`) uses an eager, directly-addressed child (`{ path: 'marketplace', component: RemountParentComponent, children: [{ path: 'details', component: RemountSurfaceComponent }] }`), not a `loadChildren` tree with a `redirect: ''` child as TASK_2026_533 will add for the marketplace route.
- This is not a functional gap in the reviewed code: the remount mechanism operates purely on `ChildrenOutletContexts` state after settlement (`context.children` is retained regardless of how the child route was reached — direct path vs. resolved redirect vs. lazy chunk — confirmed by re-reading `_router-chunk.mjs:2288-2333`, which treats `context.children` identically for every route shape). It is a residual coverage gap worth naming since TASK_2026_533 is an explicit parallel dependency in the plan.
- Fix: optional — TASK_2026_533's own batches should add an integration-level assertion (not necessarily in this file) once its `loadChildren` route lands, confirming the remount survives the redirect. Not a reason to hold Batch 2.

## Data flow

1. `AppStateManager.switchWorkspace` stay-branch bumps `_configurationSurfaceRemountTick` after `workspaceInfo` is updated (Batch 1, committed `78a3b0546`) — OK, out of this batch's scope, used only as context.
2. (Future, Batch 4) An `ElectronShellComponent` effect reads `configurationSurfaceRemountTick`, skips the initial `0`, and calls `SurfaceRouterService.remountActiveSurface()` from `untracked` — not yet wired; this batch only adds the callee.
3. `remountActiveSurface()` reads `ChildrenOutletContexts.getContext(PRIMARY_OUTLET)` — OK, matches the public API (`ChildrenOutletContexts`/`getContext` verified public, `_router-chunk.mjs:1266-1320`).
4. Guard `!ctx?.outlet?.isActivated || !ctx.route` returns early for: no outlet ever registered, outlet registered but nothing activated, or (defensively) no stored route — OK, all three covered by spec cases 3 and 4.
5. `route`/`injector` captured from `ctx.route`/`ctx.injector` before mutation — OK functionally (see MINOR finding: the capture-before-deactivate ordering happens to be unnecessary for correctness today, given `deactivate()`'s actual scope, but is harmless and defensively correct).
6. `ctx.outlet.deactivate()` destroys the current component; `OutletContext.children` (nested outlet contexts) is untouched by this call — OK, verified directly (`_router-chunk.mjs:1797-1804` vs. the Router's own `deactivateRouteAndOutlet`, `:2261-2277`, which is the method that *would* clear `context.children` and is deliberately not what this code calls).
7. `ctx.outlet.activateWith(route, injector)` creates a fresh component instance at the same `ActivatedRoute`, using the same lazy-chunk `EnvironmentInjector` — OK, verified (`:1806-1824`); nested `<router-outlet>` in the new instance re-resolves `context.children` via its `OutletInjector`-provided `ChildrenOutletContexts`, re-activating the retained child route — OK, proven by the real-Router "parent and child" spec case, not merely asserted.
8. No navigation is triggered anywhere in this path — OK, proven by the `NavigationStart` assertion in spec case 1.

No step loses, duplicates, or reads stale data under the single call path this batch implements. The only residual concern is entirely about *when* a caller invokes step 3–7 relative to an unrelated in-flight navigation (Failure mode 1), which is a call-site concern deferred to Batch 4 by the plan's own design.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Task 2.1 — `remountActiveSurface()` per plan pseudocode | COMPLETE | none — matches `implementation-plan.md:13-16` line for line |
| No change to `navigateToSurface`/`currentSurface`/`pendingSurface` | COMPLETE | confirmed via diff — only additive changes |
| No `RouteReuseStrategy` introduced | COMPLETE | confirmed — no such import/usage |
| JSDoc: purpose, routed-component-only recreation, retained child contexts, no navigation, timing constraint | COMPLETE | accurate, but silent on the pending-navigation hazard (MODERATE finding above) |
| Task 2.2 — 4 spec cases (new instance, child retention, two no-ops) | COMPLETE | all four are real-Router, non-trivial, and would fail under a broken implementation |
| Risk RA (capture-before-deactivate) | PARTIAL | implemented correctly, but not actually load-bearing for any current test outcome (MINOR finding above) |
| Scoped verification (`typecheck,test,lint -p @ptah-extension/core`) | COMPLETE | re-ran the spec file in this review (33 suites, 874 tests, exit 0); `ptah_get_diagnostics` shows 95 pre-existing TypeScript errors elsewhere in `libs/frontend/core` (auth-state, electron-layout, message-router, mock-rpc specs) — none touch either reviewed file, and the scoped `nx typecheck` already reported PASS, so these are unrelated to Batch 2 |

Implicit requirements not addressed: guidance for Batch 4 on gating `remountActiveSurface()` against a pending navigation (see Instructions below).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| No outlet ever rendered | YES | `ctx` is `null`, optional chaining returns early | none |
| Outlet rendered, nothing activated | YES | `ctx.outlet.isActivated` false, returns early | none |
| Component-less current route (e.g. `chat`) | YES | same guard; spec case 3 | none |
| Parent + child route both routed | YES | spec case 2 proves both recreate from retained context | none |
| Query params + fragment on the URL | YES | spec cases 1 and 2 assert `router.url` unchanged including `?...#...` | none |
| `loadChildren` lazy chunk injector | YES (by construction, not by a lazy-specific test) | `ctx.injector` is the route snapshot's `_environmentInjector`, which is the lazy one per `OutletContext.injector` getter — verified in source, no lazy route exists in the spec's routes to exercise it directly | acceptable; general mechanism does not vary by eager/lazy, confirmed by reading the activation code path |
| Navigation in flight to a different surface when called | NO | not guarded in this method | delegated to Batch 4 by plan design; JSDoc should say so (MODERATE finding) |
| `(activate)`/`(deactivate)` template listeners | N/A today | no listeners exist on the app's outlet | informational only (Failure mode 2) |

## Verdict

- Recommendation: **APPROVE** (production code and tests are correct and match the contract) **WITH FIXES** (one JSDoc addition, not a logic change, and one evidence-precision correction to `batch-2-report.md`'s Risk RA claim — neither blocks merging this batch).
- Confidence: HIGH — every Router-internals claim in the plan and the report was independently re-read against the installed `22.1.7` source in this review, not taken on trust, and the spec was re-run (33 suites / 874 tests, exit 0).
- Top risk: an unguarded `remountActiveSurface()` call from the Batch 4 shell effect during a fast workspace-switch + surface-navigation race, causing a discarded duplicate component construction. Low severity (wasted work, not corruption or data loss) but easily prevented.
- What a robust implementation would add: (1) a JSDoc sentence steering Batch 4 to check `pendingSurface()` before calling; (2) optionally, a lazy-`loadChildren` integration case once TASK_2026_533 lands, to keep this method's test coverage matching its real call shape.

## Instructions the Batch 4 implementer (the shell effect calling `remountActiveSurface`) must follow

1. Do not call `remountActiveSurface()` unconditionally from the `configurationSurfaceRemountTick` effect. First check `surfaceRouter.pendingSurface()` (already public, `surface-router.service.ts:102-106`); if it is non-null — a navigation is in flight — either skip the remount for this tick or defer it until the navigation settles (e.g. re-check on the next `NavigationEnd`). This avoids Failure mode 1 (wasted/duplicate component construction, possible flash, possible duplicate IPC/data-fetch side effects from the discarded instance).
2. Confirm (as the plan already states) that the effect runs `untracked` and reads the tick only to trigger the call, never inside `AppStateManager.switchWorkspace` itself — `workspaceInfo` is set only after the coordinator returns (`electron-layout.service.ts:486-503`), so a synchronous call would build the surface against the stale workspace.
3. `remountActiveSurface()` is `void` and never throws for the no-op cases, but it does not catch exceptions thrown by the recreated component's own constructor/`ngOnInit`. If Batch 4 wants a defensive boundary around a bad configuration-surface component, that has to be added at the call site, not assumed from this method.
4. If a future revision of the shell adds `(activate)`/`(deactivate)` bindings to the app's single `<router-outlet />`, be aware those will also fire on every workspace-switch remount (Failure mode 2), not only on real navigation — write any such handler to tolerate that.
