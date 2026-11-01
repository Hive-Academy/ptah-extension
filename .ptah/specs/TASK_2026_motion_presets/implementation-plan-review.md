REVISE

## Findings

1. **Blocking — Inventory / Marketplace adoption (§M8–M11, component 5): nested route switches are not all covered.** `listWithDetail` reuses the same detail route configuration when `:serverRef`, `:connectorId`, or `:skillRef` changes (`libs/frontend/marketplace/src/lib/routes/marketplace.routes.ts:86-100`). The plan replays only docked server/skill detail. Connector full-page and drawer outlets (`pages/connectors/connectors-page.component.html:16,298`), server drawer (`pages/servers/provider-list-view.component.html:147`), and skill drawer (`pages/skills/installed-skills-page.component.ts:413`) have no local stage or replay key. Reused detail hosts receive no new `animate.enter`. Their absolute leave also lacks a local containing stage; in a drawer it can cover the header (`libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts:80-114`). Add a stage and param-change animation for every nested outlet and placement. Test A→B params and list→detail→list.

2. **Blocking — Presets / Top-level surfaces (§250–262): three presets collapse to Fade.** The mapping gives `fade`, `rise`, and `scale` the same `ptahPageIn` opacity animation; the installed rule is opacity-only (`apps/ptah-extension-webview/src/styles.css:815-823`). This does not meet the request that the chosen preset apply consistently to top-level surfaces, child routes and panels. Specify distinct, glass-safe top-level behavior for each preset, or secure an explicit product decision accepting these equivalents. Preserve the root-only snapshot glass constraint (`styles.css:785-790`).

3. **Blocking — Glass behavior (§233–248): the fallback changes or removes the chosen animation.** The proposed `:has()` rule makes Fade a 6px rise and gives every glass-bearing panel an immediate leave. This conflicts with consistent preset semantics and full switch motion. Avoiding opacity on an ancestor of the `::after` blur is justified (`apps/ptah-extension-webview/src/styles.css:2888-2918`), but the exception needs a per-preset glass-safe visual contract, including exits, or explicit user acceptance. Verify blur during the entire motion.

4. **Serious — Inventory / Settings (§S6, component 6): a user-driven sub-panel switch is excluded.** The provider setup wizard switches entire step bodies with `@switch (step())` (`libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:437-439`); Back/Continue change that state (`:1370`, `:1397`). Calling it load state and deferring it to Open questions misses “every” Settings sub-panel switch. Include wizard steps or obtain a narrower scope decision. The admitted `@defer` placeholder-to-content cut (§429, §550) also requires a first-visit visual check and remedy if the actual tab body pops in.

5. **Serious — Stage directive (§338–372): replay cleanup can fire on a descendant's animation.** The proposed `{ once: true }` `animationend` listener does not check `event.target`; that event bubbles. Angular's own runner filters events whose target is not the animated element (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:14534-14546`). A child animation can remove `ptah-motion-enter` too early. Filter by target and animation name; handle cancellation or no-animation cleanup. Test a child event followed by the panel event.

6. **Serious — Mechanism / B4 spike (§144–158, §403, §541–558): router-host leave is unresolved but the fallback is declared acceptable.** Router deactivation calls `activated.destroy()` (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:1516-1522`). Core detaches the view and can retain leaving nodes (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:6482-6500,4852-4863`), but that does not prove every routed host's leave or asserted `[old][new]` overlap. Keep the Electron spike, make success a gate, and specify a working alternative if host leave fails; do not silently accept enter-only. For `@switch`/`@if`, wrappers in the owning template are the right approach: the runtime runs leave on the element itself (`:14488-14520`) and checks its animation on the next frame (`:14528-14571`). Verify under OnPush/zoneless.

7. **Serious — Batches / verification (§519–543): the focused Jest flags are forwarded while lint and typecheck are also requested, and the visual matrix is incomplete.** `scripts/verify.mjs:79-88` defaults to `lint,test,typecheck` and appends passthrough args to Nx. B5/B7 pass `--testPathPatterns` without `-t test`. Use `-t test` for focused tests and a separate full project verify. The final Electron review samples only three styles (§538), while the quality requirement says every hooked row works with all six (§495–498). Cover all six across representative top-level, child-route, param-reuse, tab, glass and reduced-motion cases, including rapid switches and first-time deferred content.

8. **Minor — Stage direction (§357–360, A2): route timing remains an assumption.** Marketplace `route()` updates on `NavigationEnd` (`libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts:188-202`), while Angular queues animation classes during view changes (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:14488-14520`). Derive direction before activation or make the proposed Electron timing check a gate with a specified fallback.

## Lane-introduced constraints

The plan adds these choices beyond the user's request:

- Exactly six styles and `rise` as default (§180–189).
- Root-only View Transitions, unmoving chrome, clip-path wipes for slides, and shared fade for rise/scale at top level (§250–262). Root-only glass protection has evidence; the preset mapping is a lane choice.
- Fade becomes rise and glass-bearing leaves cut (§233–248); no acceptance of these exceptions is recorded.
- Provider wizard steps and responsive docked/drawer placement are excluded (§102, §113, §605). The wizard exclusion affects the stated Settings scope.
- Session-tab transcript switching is included now (§445–456), although the explicit chat request is for later staggered message enter/leave. This must not constrain future per-message motion.
- The picker is Electron-only and there is no seventh “None” style (§273–286, §605); Electron-first does not require permanent VS Code exclusion.
- B8 waits for the Motion-preference lane to **commit** (§521, §553, §572). Waiting for file ownership to clear is needed; a commit is an extra gate.
- No `@angular/animations`, no host branching, only one new abstraction, and no new duration tokens (§28, §511–514) are implementation preferences.

## Required changes

1. Complete Marketplace nested-outlet staging and param replay for docked, drawer and full-page paths.
2. Reconcile top-level and glass behavior with consistent preset semantics; remove silent substitutions and cut exits or record explicit accepted exceptions.
3. Include Settings wizard steps and resolve first-visit deferred-content behavior.
4. Make routed-host leave a proven gate with a fallback, and fix replay listener cleanup.
5. Correct project-scoped verify commands and expand the visual matrix to all six styles and missing paths.

## Notes

- `ptahMotionStage` in `@ptah-extension/ui` fits the dependency direction. UI is `scope:webview,type:ui`; Marketplace, Chat, Chat UI and Thoth Shell are `scope:webview,type:feature` (`libs/frontend/ui/project.json:6`, `libs/frontend/marketplace/project.json:6`, `libs/frontend/chat/project.json:6`, `libs/frontend/thoth-shell/project.json:6`; `eslint.config.mjs:303-304,415-422,429-430`). Export only through the UI public barrel. No new library/tag is needed.
- Renderer state plus localStorage pre-paint hint follows the scene pattern (`libs/frontend/core/src/lib/services/theme.service.ts:360-371`; `apps/ptah-extension-webview/src/index.html:137-143`) and suits an instant renderer-only preset. Keep validation and parity tests.
- Angular removes an element after its own longest animation or fallback (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:14528-14571`); jsdom's missing `getAnimations` explains why source-only tests cannot prove visual motion (`:4073-4076`). Electron evidence is necessary.
- `ptah-vt-active` is set synchronously before capture (`libs/frontend/core/src/lib/routing/surface-view-transitions.ts:63-68`). Set direction there too, as the plan says; `updateCallbackDone.then()` is too late.
- B1/B2/B3 are file-disjoint and B5/B7 touch different Chat files. Same-project verifies should be sequential, one heavy check at a time. Opt-in classes leave room for later staggered chat-message motion.
- Review was read-only apart from this deliverable. No build, serve, e2e, workspace-wide check or UI screenshot was run. `rg` failed with Access denied, so searches used PowerShell `Select-String`. The local `angular-frontend-patterns` and `nx-workspace-architect` skills were read after the skill search API returned no match.

## Re-review (round 1)

REVISE

### Findings

1. **Blocking — Route-stage event timing (plan §3b:414, §5:455-456, A2:640).** The proposed test asserts `data-motion-dir` inside an `ActivationStart` subscription, but Angular emits `ActivationStart` while running guards (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:2585-2595`), before `ResolveEnd` is emitted in the later resolver phase (`:3939-3967`). The stage cannot set direction from `ResolveEnd` by that assertion point. `ResolveEnd` is also skipped when `canActivateChecks.length === 0` (`:3953-3955`), so it is not an unconditional navigation hook. Its ordering before actual outlet activation is sound (`:4014-4032`); the test and event contract still need to account for both facts.

2. **Blocking — Route-stage composition (plan §3:370-386, §3b:408-417).** The route directive says it sets the host `MotionStageDirective` index and passes a key to `motionReplayKey`, but the shared directive declares both as `input()` signals. Angular defines `InputSignal` as non-writable and updated by a binding (`node_modules/@angular/core/types/core.d.ts:90-106`). `hostDirectives: [MotionStageDirective]` alone supplies no binding or setter for the sibling directive. The specified design cannot compile as a direct `.set()` call or deliver the route-derived index/replay through the stated inputs. Give the shared stage an explicit imperative API backed by writable internal signals, or bind its exposed inputs through a concrete wrapper component. Test both direction and A→B replay through the actual API.

3. **Serious — Nested detail key timing (plan §3b:410,414-415, §5:446-449).** The route-stage contract requires a pure function of the target URL, but the six call sites are described as mappings that read `serverRef`, `detailId`, or `openRef`. Those values are updated on `NavigationEnd` in `provider-list-view.component.ts:399,456-460`, `connectors-page.component.ts:224-229`, and `installed-skills-page.component.ts:539-542`. At `ResolveEnd` they still describe the old detail, so a mapping implemented as written cannot prepare a changed key or clone for A→B. Define URL parsing for each detail route (including encoded params) and prove A→B keys differ at the pre-activation event in the route-stage spec.

4. **Serious — Leave-clone cleanup (plan §181:195-200, §3b:421-426).** The fallback removes a clone on matching animation events, a no-animation check on the next frame, cancellation, or directive destruction, but it does not explicitly dispose the previous clone when a second successful navigation reaches `ResolveEnd`. The plan promises at most one pending clone per stage (§567), and the visual matrix includes rapid switching (§624). Add replacement cleanup before creating a new clone and a bounded completion fallback if its animation event is lost. Angular's own leave runner uses a duration-based fallback (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:14554-14569`). Test two route changes before the first clone finishes.

### Required changes

1. Correct the event ordering claim and assertion; choose a guaranteed pre-activation event for route-key changes or prove the `ResolveEnd` condition for every relevant route transition.
2. Specify a writable integration between `ptahMotionRouteStage` and `ptahMotionStage`, and make detail keys derive from the target URL at that event.
3. Complete clone replacement and timeout cleanup, with a rapid-navigation test.

### Notes

- Round 0 findings 2 and 3 are closed by `user-decisions.md` items 2 and 3. The plan now reflects the accepted plain root crossfade and glass transform-only entrance/cut exit (§270-291).
- Round 0 findings 1, 4, 5, 6 and 7 have concrete revisions: six nested outlets (§446-450), wizard and deferred content (§480-496), filtered replay listeners (§381-400), a gated leave fallback (§181-202), and targeted verify commands plus a six-preset matrix (§584-625). Finding 8's intended pre-activation direction is valid in principle, subject to findings 1-3 above.
- The UI library placement follows `libs/frontend/ui/project.json:6` and `eslint.config.mjs:303-304,415-422,429-430`; batches list disjoint edit sets, with same-project verification sequenced. The local Angular and Nx skills were read. This re-review did not run tests or change source or plan files.

## Re-review (round 2)

REVISE

### Findings

1. **Serious — Marketplace detail-to-list exits (plan §5:582-590, §3b:518-537).** The nested route stage is inside `@if (detailOpen())` in `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.html:129-150` and inside `@if (openRef() !== null)` in `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts:390-416`. Closing the detail removes the inspector or drawer together with that stage, so the routed host's `animate.leave` and a stage-owned clone cannot provide a visible leave. The plan says these containers keep their own motion, but `libs/frontend/marketplace/src/lib/ui/docked-inspector.component.ts:30-73` has no animation, and `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts:66-123,176-186` defines only entrance animation. The Marketplace shell key intentionally drops detail IDs (`libs/frontend/marketplace/src/lib/shell/marketplace-route-url.ts:27-40`), so it does not animate the list return either. This leaves detail→list cuts outside the user-approved *glass-panel* cut exception, especially in non-glass themes, and contradicts the plan's every-child-route claim. Keep an exit-capable owner alive through the transition, or add an owner-level leave with the approved glass exception; cover docked and drawer detail→list in the Electron matrix and an owning-template test.

### Required changes

1. Specify and implement detail→list exit motion at the owner of each conditional inspector/drawer, including the non-glass preset behavior. State how the owner survives long enough for the exit and how glass uses the user-approved cut.

### Notes

- Round-1 findings 1-4 are closed in the revised contract. `GuardsCheckEnd` follows guards and precedes activation; `ResolveEnd` can be skipped (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:3939-3966,4012-4032`). The stage's imperative methods avoid writes to `InputSignal`s (plan §3:377-405), target-snapshot route configs and params avoid `NavigationEnd` page signals (plan §3b:500-516; `libs/frontend/marketplace/src/lib/routes/marketplace.routes.ts:86-100`), and the clone now has replacement and bounded cleanup (plan §3b:518-537). The `ActivationEnd` assertion is after `ActivateRoutes` (`_router-chunk.mjs:2305-2310`).
- **Minor implementation note:** guard `outlet.activatedRoute` behind `outlet.isActivated` when computing `replaces` (plan §3b:486-488); Angular throws on an inactive outlet (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:1483-1492`). The plan already says an inactive outlet never clones (§3b:542); apply that guard before reading the route.
- The explicit user choices in `user-decisions.md` remain settled. No source, plan, git state, build, serve, e2e, or workspace-wide check was changed or run. No live UI claim is made from this read-only review. A CLI skill invocation mechanism was not exposed in this lane; the earlier review records reading the local Angular and Nx skills.
