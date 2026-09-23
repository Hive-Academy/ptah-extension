# Batches - TASK_2026_540_0940

Total tasks: 23 | Batches: 7 | Complete: 3/7

Worktree root (every path below is under it): `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu`
Task folder: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\.ptah\specs\TASK_2026_540_0940`

Source of truth: `implementation-plan.md` revision 2 plus its "Revision 3 overrides" section (lines 3-36). The overrides win on
conflict. The plan-review.md "Instructions for implementers" (lines 171-216) and "Re-review (revision 2)" findings R2-1 to R2-6
are folded into the tasks below. This file replaces the revision-1 decomposition; no executor had run.

## Execution defaults (user-pinned roster, context.md)

- Roster change (user decision, 2026-09-23, recorded in context.md): OpenCode Go and Ollama Cloud hit usage limits.
  Batch 1 was implemented by `opencode`/`kimi-k3` before the limit. Batches 2-7 are implemented by the `codex` CLI lane.
  The `Glm` review lane is unavailable (429) until Ollama resets. Batch 1's outside review was done by `codex`
  (independent: Kimi implemented). From Batch 2 on, the reviews are an internal `code-logic-reviewer` subagent plus
  `Glm` when available. When `Glm` is unavailable, a `codex` outside review may stand in only for a batch `codex` did
  NOT implement; otherwise the internal review is the gate and the missing Glm verdict is recorded on the batch.
- Execution-order deviation (orchestrator): Batch 2 and Batch 3 were started before Batch 1 was committed. Both depend
  only on Batch 1's exports, which are verified. Each batch is still committed on its own, in batch order.
- (Original default, Batch 1 only) Implement: one CLI lane per batch, `opencode` with model `opencode-go/kimi-k3` (messaging: none). The lane runs the batch's
  tasks in order. Lane limits: 40 tool calls, 1200000 ms inactivity timeout. `deliverables` = the batch's files plus
  `batch-N-report.md` in the task folder. The report file is the lane's only account of its work.
- Fallback executor: `frontend-developer` subagent, same prompt.
- Review, every batch, both required before commit: (1) CLI lane `Glm` (ptah-cli, `ptahCliId: pc-355b645d-35af-4974-84cf-9cf961ea0164`,
  `modelTier: 'opus'`, code-logic-reviewer role) writes a "Batch N" section in `code-logic-review.md`; (2) an internal
  `code-logic-reviewer` subagent writes `batch-N-internal-review.md`. Revise cap: 2 rounds.
- Batches run one at a time, in order, each committed on its own after both verdicts. Every batch depends on the one
  before it: the core exports, then the remount API, then the menu component, then the shell's `data-test` hooks and
  labels, then the e2e helper.
- Lanes never run git. The team-leader runs every git command, including the added-lines guard greps. Never commit to
  main, never merge, never push.
- Batching choice recorded: the plan's "Batch A" (core, 4 files after R2-1) is split into Batch 1 (AppStateManager) and
  Batch 2 (SurfaceRouterService remount). Its "Batch B" is split into Batch 3 (menu) and Batch 4 (shell). Each lane then
  owns two or three tightly coupled files and stays well inside 40 tool calls. The design is unchanged; only the grouping differs.

## Plan validation

Status: PASSED WITH RISKS

Verified on disk (HEAD `2f798f0d5`, tree clean apart from the task folder; Angular Router 22.1.7):

- `app-state.service.ts` seams: constructor effect `:399-409`, `recordSettledSurface` `:442-458` (owner re-grant `:456`),
  `openViewInActiveSlice` `:639-647`, `switchWorkspace` `:660-717`, `removeWorkspaceState` `:725-744`, `setCurrentView` `:754-758`.
- `surface-router.service.ts` already imports `PRIMARY_OUTLET` and `Router`, is `providedIn: 'root'`, and is exported
  through `routing/index.ts` → `core/src/index.ts:42`. `ChildrenOutletContexts`, `OutletContext`, `PRIMARY_OUTLET` and
  `RouterOutlet` are public exports of `@angular/router` 22.1.7 (`fesm2022/router.mjs:7`).
- The spec harness is `libs/frontend/core/src/testing/surface-router-testing.ts`. Its `surfaceTestRoutes()` are
  **component-less** by design, so the remount spec must build its own component-bearing routes. It can reuse
  `MemoryPlatformLocation` and `settleSurfaceNavigation`.
- The `chat` route is component-less (`apps/ptah-extension-webview/src/app/app.routes.ts:66-71`). On `chat` the primary
  outlet is not activated, so `remountActiveSurface()` does nothing there.
- Remount timing: `WorkspaceCoordinatorService.switchWorkspace` calls `appState.switchWorkspace` (`:172`) before its first
  `await` (`:186`), and `ElectronLayoutService.coordinateWorkspaceSwitch` sets `workspaceInfo` synchronously right after it
  returns (`electron-layout.service.ts:487-503`). An effect-driven remount therefore constructs the surface against the
  new workspace, which is what override 1 requires.
- `electron-shell.component.ts`: tab row `:122-213`, cluster `:223-227`, gate `:232`, center panel `:263-265`, constructor
  effect `:343-359`, handlers `:381-415`, icon fields `:366-377`; no `@angular/router` import today.
- `electron-shell.activity-placement.spec.ts`: stub `:86-92`, override `set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] }` `:119-121`,
  cases `:130, 135, 142` (no tab counts).
- Nx targets: `@ptah-extension/core` and `@ptah-extension/chat` (typecheck, test, lint); `ptah-electron-e2e` (lint,
  typecheck, e2e, showcase, e2e:nightly); `@ptah-extension/webview-e2e-harness` (lint, typecheck, e2e).

Assumptions:

- `openViews` has no production reader (plan-review finding 10, re-verified by grep), so criterion 19 is unaffected — verified.
- `workspace-coordinator.service.spec.ts:511-541` (chat) uses the real `AppStateManager` and switches while on `'thoth'`;
  its assertions cover still-partitioned fields only, so it should pass under the stay-branch — unverified; checked by the
  Batch 3 and Batch 4 chat runs. The lane reports a failure there rather than editing that file.
- `RouterOutlet.deactivate()` followed by `activateWith(ctx.route, ctx.injector)` creates a new instance at the same URL
  with no navigation, and child outlets re-activate from retained contexts (plan-review R2-3 read of `_router-chunk.mjs`) —
  unverified at runtime; Task 2.2 proves it.
- Lanes cannot drive the Electron app, so the manual checks (Batch 4 verification) need the orchestrator or QA — recorded.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| RA. `remountActiveSurface()` relies on `OutletContext` (`outlet`, `route`, `injector`) plus `deactivate`/`activateWith`. They are public, but a misuse (for example capturing `ctx.route` after `deactivate`) throws or re-creates nothing. | MEDIUM | Task 2.1 captures `route` and `injector` BEFORE `deactivate()`. Task 2.2 pins a new instance, the same URL, no `NavigationStart`, the child-route variant, and the no-op cases (no outlet, not activated). |
| RB. First folder opened while the bare outlet shows a surface: the stay-branch tick bump and the gate flip (branch 2 → 3) land in the same pass. The shell effect may remount the bare-outlet component moments before the flip re-creates it again inside `ptah-app-shell`. That is churn, not breakage (plan-review re-review, "Rest of revision 2"). | LOW | Task 4.3 pins the flip: the routed surface stays and no error is thrown. |
| RC. Finding-4 race. A code-workspace navigation started under the outgoing workspace lands after the stay-branch, before the next change detection. The shell effect then remounts that surface (tasks, tribunal and analytics are component routes; chat is component-less, so nothing happens there). The surface is re-created against the new workspace: harmless, and consistent with the stamp finding 4 accepts. | LOW | Reviewers of Batch 1 and Batch 4 confirm; Task 1.2 pins the stamp. Narrowed since Batch 2: the shell effect skips or defers the remount while `pendingSurface()` is non-null (Task 4.1 rule 1, Task 4.3 case 11), so a navigation still in flight is never remounted early. |
| RD. A2 (plan): a re-created surface can still show stale data because of a service-level cache in its lib (for example `providers-settings-state.service.ts:1060-1065`). | MEDIUM | Manual fresh-data spot check on all four surfaces (Batch 4 verification). A stale pane becomes a separate batch owned by that pane's lib, raised to the orchestrator; it is not fixed inside this run. |
| RE. Focus theft after a remount (R2-4). | LOW | Task 4.1 moves focus only when `document.activeElement` is `body`, is disconnected, or was inside the host before the remount; `outline-none` on the host. Pinned in Task 4.3. |
| RF. The shell now injects `SurfaceRouterService`, and its specs override `imports: []`. The activity-placement spec may need a `SurfaceRouterService` stub, and the gate spec needs a real `RouterOutlet` or `provideRouter([])` (R2 "Rest"). | LOW | Tasks 4.2 and 4.3. |
| RG. macOS: the dropdown backdrop (`fixed inset-0`, `native-dropdown.component.ts:223-228`) overlies the `titlebar-drag` navbar while the menu is open (finding 11). | LOW | Manual check (Batch 4 verification). A drag region blocked only while the menu is open is accepted by the plan. |
| RH. The Electron Playwright suites are not run per batch (`ptah-electron-e2e` batches run lint and typecheck only). | MEDIUM | Completion gate: the Electron e2e run, recommended to QA. The harness e2e run is in Batch 4. |
| RJ. A tick bump that arrives while a navigation is in flight skips the remount (Task 4.1 rule 1). If that navigation is then cancelled or fails, the configuration surface stays on screen with the component built before the switch (possibly stale data, as in RD) until the user navigates. | LOW | Accepted (team-leader decision at Batch 4). The window is the debounce between a workspace click and a surface click. Covered by the RD manual fresh-data check; a later task can add deferral if it shows up. |
| RI. Scenes lose tab-driven camera beats (plan risk). | LOW | Task 5.1's Director-driven helper keeps a recorded click on the trigger and the item; prewarm stays silent. |

Edge cases:

- External navigation while `_settlementOwner` is null (after `removeWorkspaceState` of the active path) still updates `openSurface` — Task 1.1, pinned in 1.2.
- Lazy chunk failure: `currentSurface` does not change, so `openSurface` keeps its value — Task 1.1, pinned in 1.2.
- Switch while a configuration surface is open: no navigation, owner = new path, tick +1 exactly once, bootstrap migration still runs, outgoing slice keeps its code-workspace surface — Task 1.1, pinned in 1.2.
- Finding 4 (in-flight navigation stamps the incoming slice) — pinned in Task 1.2.
- Finding 5 (R2-6): last workspace closed, then `chat` re-grants the owner and re-seeds the closed path's slice (accepted); a configuration settlement re-creates nothing — pinned in Task 1.2.
- Remount with no outlet (welcome branch), or an outlet that is not activated (`chat`): no-op — Task 2.1, pinned in 2.2.
- Remount under a child route keeps the child URL and re-creates the child component — pinned in Task 2.2.
- Menu: click while `canSwitchViews()` is false (the menu closes, nothing navigates); re-click on the open surface; Thoth hint dismissed before `setCurrentView`; focus returns to the trigger after Escape and after item activation — Task 3.1, pinned in 3.2.
- Gate flips: 1 → 2 (menu item, no workspace), 2 → 1 (Back to welcome or the surface's own back button), 2 → 3 (first folder), 3 → 2 (last workspace closed), and a Setup hub non-configuration button with no workspace (back to welcome, while the Router stays on the target) — Task 4.1, pinned in 4.3.
- Prewarm starting on a configuration surface (no active tab): restore through the menu — Task 5.2.

## Batch 1: Core — AppStateManager global configuration state — COMPLETE (commit 78a3b0546)

- Recommended executor: CLI lane `opencode`, model `opencode-go/kimi-k3` (x1) — used
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: one service and its spec. The re-pins and the new cases depend on the exact write seam, so one executor does both, in order.
- Tasks: 2 | Depends on: none
- Deliverables: `libs\frontend\core\src\lib\services\app-state.service.ts`, `libs\frontend\core\src\lib\services\app-state.service.spec.ts`, `batch-1-report.md` (task folder)
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core`
- Reviewers: internal code-logic-reviewer (batch-1-internal-review.md) + outside review by `codex` standing in for Glm (429) ("Batch 1" in code-logic-review.md)

### Task 1.1: Global state, single global writer, slice refusal, stay-branch, remount tick — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\core\src\lib\services\app-state.service.ts` (MODIFY)
- Plan reference: implementation-plan.md:101-286 (Decision 1), :428-435 (Component 2), :452-469 (Data flow, Failure behaviour); overrides 1 and 6 (:9-24, :34-36); plan-review.md:173-178 (implementer instructions 1-2)
- Pattern to follow: `_layoutMode` and its comment, `app-state.service.ts:292-302`; the `asReadonly()`/`computed` exports in the same class.
- Quality requirements: criteria 14-18. `setCurrentView` (`:754-758`) stays byte-identical, because TASK_2026_533 folds its no-op rule into it. The owner re-grant at `:456` stays exactly as it is. No slot writer ships (plan :169). No barrel edit: `services/index.ts:7` already re-exports the file.
- Validation notes: RC. Edge cases 1-5 in the list above.
- Implementation details:
  - Export `ConfigurationSurfaceId`, `CONFIGURATION_SURFACE_IDS`, `isConfigurationSurface(view)`, the typed `ConfigurationSurfaceSlots` interface (each member `Readonly<Record<string, never>>`) and `ConfigurationSurfacesState`, exactly as in plan :107-146.
  - `_configurationSurfaces` signal with the comment at plan :150-164, placed right after `_layoutMode`. Public `configurationSurfaces` (asReadonly) and `openConfigurationSurface` (computed).
  - `_configurationSurfaceRemountTick = signal(0)` and a public `configurationSurfaceRemountTick` (asReadonly). Rewrite its doc comment (plan :255-265) for override 1: the Electron shell's effect calls `SurfaceRouterService.remountActiveSurface()`, which re-activates the outlet's routed component only; there is NO keyed `ptah-app-shell` host.
  - Constructor effect (plan :175-192): inside `untracked`, write `openSurface = isConfigurationSurface(surface) ? surface : null` FIRST and unconditionally, and skip the update when the value is unchanged (override 6). Then run the existing ownership check and the `openViewInActiveSlice` call.
  - `openViewInActiveSlice` returns early for configuration ids (plan :199-207). That one guard covers all three callers (`:407`, `:457`, `:678`).
  - `recordSettledSurface`: unchanged apart from comments. It performs no global write.
  - `switchWorkspace` (plan :216-249): `const staying = isConfigurationSurface(this.currentView())` read after the same-path guard; the outgoing stamp stays as it is; `_settlementOwner = staying ? newPath : null`; the migration block (`:686-701`) stays verbatim; if `staying`, bump the tick once and return without `requestSurface`.
  - Update the doc comments on `_settlementOwner`, `recordSettledSurface`, `openViewInActiveSlice` and `switchWorkspace` so they describe the new behaviour. No dead code, and no `recordSettledView` method.

### Task 1.2: Spec re-pins and the new global-state cases — COMPLETE

- Depends on: Task 1.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\core\src\lib\services\app-state.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:397-399 (Decision 5, unit fixtures), :476-484 (Test plan); override 5 (:31-33); plan-review.md:179-186 (instruction 3)
- Pattern to follow: the spec's existing `provideSurfaceRouterTesting()` / `settleSurfaceNavigation()` usage (harness `libs/frontend/core/src/testing/surface-router-testing.ts`); spy on `SurfaceRouterService.navigateToSurface` for "no navigation".
- Quality requirements: re-pins keep each assertion's meaning (moved to `'analytics'`, `'tasks'` or `'tribunal'`). No test deleted to get green. No `.skip` or `.only`.
- Validation notes: confirm each re-pin range on disk before editing — `:289-308`, `:328-370`, `:542-549`, `:636-651`, `:735-756`, `:808-813`, `:919-928` (`:227-232` and `:408` stay). Pin accepted behaviour; do not change the service to make a pin pass.
- Implementation details — new cases:
  1. A configuration settlement through `setCurrentView`, AND through a direct `navigateToSurface` (external path), updates `openConfigurationSurface` and leaves every slice's `currentView`/`openViews` untouched (criteria 14, 16, 17).
  2. `openConfigurationSurface()` reads the same before and after `switchWorkspace` while a configuration surface is open (criterion 15).
  3. `switchWorkspace` while on `'settings'` starts no navigation (spy), bumps `configurationSurfaceRemountTick` exactly once, keeps `currentView()` at `'settings'`, and leaves the outgoing slice on its previous code-workspace surface. A later switch with a code-workspace surface on screen (after navigating to one) does not bump the tick.
  4. The stay-branch on the first switch out of the bootstrap sentinel still migrates the sentinel slice.
  5. A `SWITCH_VIEW` message, `openSettingsTab`, `openSkillsDivergedClones` and a direct `navigateToSurface` each end with the correct `openConfigurationSurface` (criteria 16, 18).
  6. Owner null: `removeWorkspaceState(active)`, then an external `navigateToSurface('settings')` still sets `openConfigurationSurface`; a subsequent external navigation to `'tasks'` clears it to `null`.
  7. A failed navigation (a route that throws, or a spied `'failed'` result) leaves `openConfigurationSurface` unchanged.
  8. Finding 4: a code-workspace navigation started before a stay-branch switch lands afterwards and is stamped onto the incoming workspace's slice; `openConfigurationSurface` becomes `null` (accepted, pinned).
  9. Finding 5 (R2-6): after closing the last workspace (`removeWorkspaceState` of the active path), `setCurrentView('chat')` re-grants the owner and re-seeds that path's slice (accepted, pinned). Second assertion: a configuration settlement in the same state does NOT re-create the slice.
  10. Still-partitioned ids keep every existing behaviour (criterion 17): the re-pinned suite.

### Batch 1 verification

- Both files contain the work; `setCurrentView` has no diff lines (team-leader diff check); no `recordSettledView` or `updateConfigurationSurfaceSlot` symbol exists
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core` passes (tailed output quoted in `batch-1-report.md`)
- Both review verdicts accepting
- Edge cases 1-5 addressed

### Batch 1 outcome

- Executor: `opencode` / `kimi-k3` (`batch-1-report.md`). Files: `app-state.service.ts`, `app-state.service.spec.ts` only.
- Team-leader check on disk: the diff matches Task 1.1. The effect writes the global state first with an unchanged-value
  skip. `openViewInActiveSlice` returns early for configuration ids. The stay-branch sets `staying`, sets the owner, keeps
  the migration verbatim, bumps the tick once and returns. `setCurrentView` has no diff hunk; there is no
  `recordSettledView` and no slot writer.
- Orchestrator verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core --skip-nx-cache` PASS;
  `npx nx test @ptah-extension/chat --testPathPatterns=workspace-coordinator` PASS (35/35, the assumption check); no
  `it(` removed, 12 added.
- Reviews: internal code-logic-reviewer ACCEPT 9/10 (`batch-1-internal-review.md`); outside review by codex, standing in
  for Glm (429), ACCEPT WITH FIXES 8/10, one MINOR (`code-logic-review.md` "Batch 1").
- MINOR decision — ACCEPTED, not fixed. The finding: `app-state.service.spec.ts:1114, :1128` cannot tell whether the
  closed workspace's slice is present or absent in the private map. The reasons for accepting it:
  - The behaviour Task 1.2 case 9 pins is the ownership re-grant after closing the last workspace. The spec proves it
    through a later external navigation that stamps the slice.
  - Slice presence versus absence is not observable through any public API: `activeViewSlice` falls back to
    `DEFAULT_VIEW_SLICE`. It has no user-visible effect either: a re-seeded default slice and a missing slice both
    restore `chat`. Plan-review finding 5 already calls it benign.
  - Asserting the private `_viewSlices` map would couple the spec to an implementation detail to prove something no
    caller can see.
  - The production guard that prevents resurrection (`openViewInActiveSlice` refusal) was traced by both reviewers.
  - If a later task makes slice presence observable (a public API or persistence), that task adds the membership assertion.

## Batch 2: Core — SurfaceRouterService outlet remount — COMPLETE (commit 378e97f82)

- Recommended executor: CLI lane `codex` (x1)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: one new method and its spec in the same lib as Batch 1. It is kept separate so the Router-internals proof gets a whole lane and a focused review.
- Tasks: 2 | Depends on: Batch 1 (same lib; sequenced so the two core commits are separate)
- Deliverables: `libs\frontend\core\src\lib\routing\surface-router.service.ts`, `libs\frontend\core\src\lib\routing\surface-router.service.spec.ts`, `batch-2-report.md`
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core`
- Reviewers: internal code-logic-reviewer (batch-2-internal-review.md) + Glm lane ("Batch 2" in code-logic-review.md) when available; codex implemented, so codex cannot stand in

### Task 2.1: `remountActiveSurface()` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\core\src\lib\routing\surface-router.service.ts` (MODIFY)
- Plan reference: override 1 (implementation-plan.md:9-24); plan-review.md:242-266 (R2-1 fix), :288-295 (R2-3)
- Pattern to follow: the class's existing `inject()` fields and JSDoc style (the `navigateToSurface` and `pendingSurface` comments).
- Quality requirements: public method, `void`, never navigates, never throws for the "nothing to remount" cases; no RouteReuseStrategy; no change to `navigateToSurface`, `currentSurface` or `pendingSurface`.
- Validation notes: RA.
- Implementation details: `private readonly outletContexts = inject(ChildrenOutletContexts)`. `remountActiveSurface()`: `const ctx = this.outletContexts.getContext(PRIMARY_OUTLET)`. If `!ctx?.outlet?.isActivated || !ctx.route`, return. Otherwise capture `route = ctx.route` and `injector = ctx.injector` BEFORE `ctx.outlet.deactivate()`, then call `ctx.outlet.activateWith(route, injector)`. The JSDoc states: what it is for (the switch-while-open remount), that it re-creates only the routed component at the same URL, that child outlets re-activate from retained contexts, why there is no navigation, and that callers must not call it synchronously inside `switchWorkspace` (the `workspaceInfo` timing, `electron-layout.service.ts:486-503`).

### Task 2.2: Remount spec — COMPLETE

- Depends on: Task 2.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\core\src\lib\routing\surface-router.service.spec.ts` (MODIFY — add a `describe('remountActiveSurface')`)
- Plan reference: override 1 spec bullet (implementation-plan.md:20-22); plan-review.md:268-271
- Pattern to follow: the existing `describe` blocks in the same spec. The harness `surfaceTestRoutes()` is component-less, so this block configures its own routes: `{ provide: PlatformLocation, useClass: MemoryPlatformLocation }` plus `provideRouter(routes, withDisabledInitialNavigation())`, with small standalone test components that count constructions. Use a host component with a `<router-outlet />`, or `RouterTestingHarness`.
- Quality requirements: real Router activation; no mocking of `RouterOutlet`.
- Implementation details — cases:
  1. On a component route: after `remountActiveSurface()`, a NEW component instance exists (construction count +1, or instance identity differs), `router.url` is unchanged, and no `NavigationStart` was emitted (subscribe to `router.events`).
  2. Child-route variant: a component-bearing parent with a child `<router-outlet>` and a child route. After the remount the parent and child are both new instances and the child URL is unchanged.
  3. No-op: on a component-less route (as `chat` is), nothing is created and no error is thrown.
  4. No-op: with no outlet rendered (no host fixture), nothing is thrown.

### Batch 2 verification

- `remountActiveSurface` exists with the capture-before-deactivate order
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core` passes
- Both review verdicts accepting; RA addressed

### Batch 2 outcome

- Executor: `codex` (`batch-2-report.md`, including "Revision 1"). Files: `surface-router.service.ts`,
  `surface-router.service.spec.ts` only.
- Team-leader check on disk:
  - `remountActiveSurface()` injects `ChildrenOutletContexts`, returns early when there is no activated outlet or no
    stored route, captures `route` and `injector` before `deactivate()`, then calls `activateWith`.
  - No other method changed.
  - The spec adds `describe('remountActiveSurface')` with the four required cases (new instance, same URL and no
    `NavigationStart`; parent and child re-created at the same child URL; component-less no-op; no-outlet no-op) on a
    real Router and `RouterOutlet`.
  - The one deleted spec line is the old single-line router import, now expanded. No `.skip`, `.only` or TODO.
- Orchestrator verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core --skip-nx-cache` PASS
  before revision 1. Revision 1 is JSDoc-only (the method body is unchanged); lint and typecheck for core passed after it.
- Reviews:
  - Internal code-logic-reviewer: ACCEPT WITH FIXES 8/10 (`batch-2-internal-review.md`), 0 blocking, 0 serious.
    - MODERATE: the JSDoc did not warn about pending navigations. FIXED in revision 1: the JSDoc now says to skip the
      call while `pendingSurface()` is non-null, and that `(activate)`/`(deactivate)` fire on every remount.
    - MINOR: the report overstated the evidence for RA. FIXED in revision 1.
    - MINOR: no `loadChildren` test. ACCEPTED; it belongs to TASK_2026_533 once its marketplace `loadChildren` route
      lands, because the mechanism does not vary by eager or lazy route (the reviewer confirmed this in the Router source).
  - Glm verdict (received after commit, `batch-2-3-glm-review.md`): ACCEPT 9/10, 3 MINOR, all ACCEPTED with no new commit
    (orchestrator decision, team-leader concurs):
    - The JSDoc does not say that errors from the re-created component propagate. Batch 4 Task 4.1 rule 3 carries this
      at the call site.
    - The `(activate)`/`(deactivate)` claim is not pinned by a test. It is documentation only, and no listener exists.
    - The capture order is defensive, not load-bearing. This is the same point as the internal RA note above.
- RA: the capture-before-deactivate order is implemented. As the reviewer notes, today's tests prove the outcome but
  not the ordering itself; the order is kept as a defensive pattern. Recorded as addressed in code, not pinned by a test.
- Carried forward: the reviewer's call-site instructions are folded into Task 4.1.

## Batch 3: Chat — GlobalConfigMenuComponent — COMPLETE (commit a8f8e2c69)

- Recommended executor: CLI lane `codex` (x1)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: one new smart component and its spec. It needs Batch 1's `openConfigurationSurface`.
- Tasks: 2 | Depends on: Batch 1
- Deliverables: `libs\frontend\chat\src\lib\components\molecules\global-config-menu.component.ts`, `libs\frontend\chat\src\lib\components\molecules\global-config-menu.component.spec.ts`, `batch-3-report.md`
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`
- Reviewers: internal code-logic-reviewer (batch-3-internal-review.md) + Glm lane ("Batch 3" in code-logic-review.md) when available; codex implemented, so codex cannot stand in

### Task 3.1: GlobalConfigMenuComponent — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\molecules\global-config-menu.component.ts` (CREATE)
- Plan reference: implementation-plan.md:369-395 (Decisions 3, 4), :417-426 (Component 1), :454 (Data flow 1), :509 (the ordering fact for 533); plan-review.md:187-194 (instruction 4)
- Pattern to follow: `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:292-322` (dropdown markup, `trigger` and `content` slots, `[panelRole]="null"`, `(opened)`, panel `(keydown.escape)`) and `:516-534` (`toggleMenu`, `closeMenu(returnFocusTo)`, `focusFirstItem`).
- Quality requirements: criteria 1, 2, 3, 6, 7. Standalone, OnPush, `inject()`, signals. Tailwind/daisyui tokens. Imports only via `@ptah-extension/core`, `@ptah-extension/ui` and `lucide-angular`. No CDK, no chat-ui import.
- Validation notes: menu edge cases in the list above.
- Implementation details: selector `ptah-global-config-menu`; `isOpen = signal(false)`. Items in order: thoth ("Thoth", title "Thoth — agentic platform", `RadioTower`), setup-hub ("Setup hub", `Wrench`), marketplace ("Marketplace", `Store`), settings ("Settings", `Settings`). The trigger icon is `SlidersHorizontal`: confirm it is exported by `lucide-angular` (grep `node_modules/lucide-angular`) before use. Trigger: `type="button"`, `data-test="config-menu-trigger"`, `aria-label="Configuration"`, `[attr.aria-expanded]`, `(click)` toggle, and a highlight (`text-primary` / `bg-base-300`) when `openConfigurationSurface() !== null`. Panel `content` div: `(keydown.escape)` closes and refocuses the trigger; `(keydown.arrowdown)` / `(keydown.arrowup)` roving focus with `preventDefault()` and wrap. Items: `type="button"`, `data-test="config-menu-item-<id>"`, `[attr.aria-current]` = `'true'` or `null`, plus a highlight class. `selectItem(id, trigger)`: close, refocus the trigger, then for thoth only and only when `!thothFirstRunDismissed()` call `dismissThothFirstRun()`, then `setCurrentView(id)`, and no other navigation method. `(closed)` sets `isOpen` false; `(opened)` focuses the first item.

### Task 3.2: Menu spec — COMPLETE

- Depends on: Task 3.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\molecules\global-config-menu.component.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:475 (Test plan, menu)
- Pattern to follow: TestBed with an `AppStateManager` `useValue` stub whose `openConfigurationSurface` is a writable `signal` (compare `electron-shell.activity-placement.spec.ts:86-126`).
- Implementation details: fire `opened` with `DebugElement.triggerEventHandler('opened')` on the `ptah-native-dropdown` element (Floating UI does not run in jsdom). Cases: four items in order; accessible name and `aria-expanded` false → true; click opens; item click calls `setCurrentView(id)`, closes, and focuses the trigger; Thoth dismisses the hint once and BEFORE `setCurrentView` (check call order), and does not dismiss when already dismissed; Escape closes and focuses the trigger; ArrowDown/ArrowUp roving with wrap; the `closed` output closes; `aria-current` and the trigger highlight follow the signal.

### Batch 3 verification

- Both files exist with real logic
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat` passes, including the untouched `workspace-coordinator.service.spec.ts` (assumption)
- Both review verdicts accepting

### Batch 3 outcome

- Executor: `codex` (`batch-3-report.md`). New files: `global-config-menu.component.ts` and `global-config-menu.component.spec.ts` only.
- Team-leader check on disk (`global-config-menu.component.ts:1-160`):
  - Standalone and OnPush; `inject(AppStateManager)`; imports only `@ptah-extension/core`, `@ptah-extension/ui` and `lucide-angular`.
  - `[panelRole]="null"`; the trigger has `data-test="config-menu-trigger"`, `aria-label="Configuration"`, `aria-expanded` and the highlight on `openConfigurationSurface()`.
  - Items are in order Thoth, Setup hub, Marketplace, Settings, with `data-test="config-menu-item-<id>"` and `aria-current` set to `'true'` or `null`.
  - Escape and arrow-key roving (with wrap and `preventDefault`) are on the panel.
  - `selectItem` closes and refocuses the trigger, then dismisses the Thoth hint when not yet dismissed (`:155-157`), then calls `setCurrentView` (`:158`). No other navigation.
  - The trigger glyph is `SlidersHorizontal`.
- Orchestrator verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --skip-nx-cache` PASS. That run includes the untouched `workspace-coordinator.service.spec.ts`, so the assumption holds (verified).
- Review: internal code-logic-reviewer ACCEPT 9/10 (`batch-3-internal-review.md`), 0 blocking, 0 major. It confirms 16 spec executions, and that the ordering checks use `invocationCallOrder` inside mock implementations.
  - MINOR 1 — ACCEPTED as shipped. The backdrop close also refocuses the trigger (`:33`), which goes beyond the literal
    wording of implementation-plan.md:468 ("Escape and item click additionally return focus"). Reasons: the backdrop is
    `fixed inset-0 z-40`, so the click cannot have moved focus to another control; without the refocus, focus would fall
    to `body`, which is the problem plan-review finding 11 set out to avoid; and no criterion (6, 7) requires the
    narrower behaviour. The spec (`:203-210`) pins the shipped behaviour as intended. Plan wording :468 is superseded on
    this point; this entry is the record, so later reviewers should not re-flag it.
  - MINOR 2 — ACCEPTED, informational. If Floating UI positioning never resolves, `(opened)` never fires. That is a
    pre-existing property of `NativeDropdownComponent` shared with the `background-agent-strip` precedent, not a Batch 3
    defect. Belongs to any later task that hardens the primitive.
- Glm verdict (received after commit, `batch-2-3-glm-review.md`): ACCEPT 9/10, 3 MINOR, pattern-level, all ACCEPTED with no
  new commit (orchestrator decision, team-leader concurs):
  - The arrow keys do nothing until `(opened)` fires. This is the same inherited primitive property as MINOR 2.
  - There is no `aria-haspopup` on the trigger. `panelRole` is null (a panel of action buttons, not a menu role), which
    matches the precedent and criterion 6. A candidate for a later accessibility pass.
  - One spec branch cannot be reached behind the backdrop. This concerns test coverage only.
- Carried forward: the reviewer's "Instructions for Batch 4" are folded into Task 4.1.

## Batch 4: Chat — Electron shell: tab set, menu mount, three-branch gate, remount effect — IMPLEMENTED

- Recommended executor: CLI lane `codex` (x1)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: one template file plus its two specs. The tab, gate, outlet and effect edits all touch the same component.
- Tasks: 3 | Depends on: Batches 1, 2, 3
- Deliverables: `libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts`, `libs\frontend\chat\src\lib\components\templates\electron-shell.activity-placement.spec.ts`, `libs\frontend\chat\src\lib\components\templates\electron-shell.config-gate.spec.ts`, `batch-4-report.md`
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`, then the harness e2e `npx nx run @ptah-extension/webview-e2e-harness:e2e` (scenarios boot-progress and activity-ticker both mount `ElectronShellComponent`)
- Reviewers: internal code-logic-reviewer (batch-4-internal-review.md) + Glm lane ("Batch 4" in code-logic-review.md) when available; codex implemented, so codex cannot stand in

### Task 4.1: ElectronShellComponent — IMPLEMENTED

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts` (MODIFY)
- Plan reference: implementation-plan.md:288-320 (Decision 2 items 1-4), :437-444 (Component 3), :511 (Apps slot); overrides 1, 3, 6 (:9-28, :34-36); plan-review.md:195-200 (instruction 5), :297-305 (R2-4)
- Pattern to follow: the existing tab buttons `:124-145`; the `no-drag` cluster `:223-227`; the existing constructor `effect` `:343-359`.
- Quality requirements: criteria 4, 5, 8-13, 19-21. No edits to `app-shell.component.*`, `app.routes.ts` or `webview-surface.types.ts`. No `[class.hidden]`. No keyed `@for` around `ptah-app-shell` (override 1 replaces Decision 2 item 5).
- Validation notes: RB, RC, RE. Gate-flip edge cases. The Batch 2 reviewer's call-site instructions are binding
  (`batch-2-internal-review.md:138-143`):
  1. Never call `remountActiveSurface()` unconditionally from the tick effect. First check `surfaceRouter.pendingSurface()`
     (read inside `untracked`). If it is non-null (a navigation is in flight), SKIP this tick's remount; do not defer.
     Team-leader decision: a navigation that lands after the switch constructs its component against the new workspace
     anyway, so a deferred remount would only rebuild it a second time. The residual case (the in-flight navigation is
     cancelled or fails, and the configuration surface stays with data from before the switch) is accepted as risk RJ.
     Task 4.3 case 11 pins the skip.
  2. Call it only from the effect, inside `untracked`, reading the tick just to trigger it. Never call it inside
     `AppStateManager.switchWorkspace` (`workspaceInfo` is set after the coordinator returns, `electron-layout.service.ts:486-503`).
  3. `remountActiveSurface()` does not catch errors thrown by the re-created component's constructor or `ngOnInit`. Do not
     assume it does. Any defensive boundary belongs at the call site; if you add one, log with context and do not
     swallow silently.
  4. The outlet's `(activate)`/`(deactivate)` outputs also fire on every remount. Do not bind them on the outlet
     expecting navigation-only semantics.
  The Batch 3 reviewer's mounting instructions (`batch-3-internal-review.md:184-207`) are also binding:
  5. Import with `import { GlobalConfigMenuComponent } from '../molecules/global-config-menu.component';` (the same
     sibling-folder relative import `app-shell.component.ts:36` uses) and add it to `imports`. No barrel edit.
  6. Mount `<ptah-global-config-menu />` inside the existing `no-drag` global-actions cluster, immediately left of
     `<ptah-theme-toggle />`.
  7. Do NOT duplicate in the shell anything the menu already owns: the `canSwitchViews()` gate, the order of dismissing
     the Thoth hint before navigating, and focus return on backdrop, Escape and item. The shell's job is mounting, the
     three-branch gate, the back button, the tab row, and the remount/focus effect. Do not edit
     `global-config-menu.component.*` (outside this batch); its backdrop-refocus behaviour is accepted (Batch 3 outcome).
  8. Specs select the menu only by `data-test="config-menu-trigger"` / `data-test="config-menu-item-<id>"`.
- Implementation details:
  - Tab row, in order: Chat (`onCanvasTab()`, label "Chat", `title="Chat"`, `LayoutGrid`), then the comment `<!-- Apps tab (TASK_2026_494) renders between Chat and Tasks -->`, Tasks, Tribunal, Analytics (`openDashboard()`, label "Analytics", `title="Analytics"`, `BarChart3`). Keep `role="tablist"`, the `electron-tabs` class, `role="tab"`, `aria-selected`, and the `:122` gate.
  - Delete the Thoth, Setup, Marketplace and Settings tab buttons; the `openSettings`, `openThoth`, `openSetupHub` and `openMarketplace` handlers; and the unused icon fields and lucide imports (`Settings`, `Wrench`, `Store`, `RadioTower`, `Zap`, `Bot`, `GitBranch`, `Sparkles`). Keep only what the template still uses.
  - Mount `<ptah-global-config-menu />` in the `no-drag` cluster, immediately left of `<ptah-theme-toggle />` (relative import `../molecules/global-config-menu.component`).
  - Three-branch gate (plan :294-310): welcome when `!hasWorkspaceFolders() && openConfigurationSurface() === null`; `@else if (!hasWorkspaceFolders())` renders `<div class="h-full w-full"><router-outlet /></div>`; `@else` renders the existing 3-panel area. Add `RouterOutlet` to `imports`.
  - Center panel (`:263-265`): keep `ptah-app-shell` un-keyed. Give its wrapper `tabindex="-1"`, `outline-none` and `#configurationSurfaceHost`, read through a `viewChild` signal.
  - Effect (override 1 + 3): read `appState.configurationSurfaceRemountTick()`, skip `0`, and in `untracked`: return if `surfaceRouter.pendingSurface() !== null` (rule 1); then record `const active = document.activeElement` and `const wasInside = host?.contains(active)`, call `surfaceRouter.remountActiveSurface()` (inject `SurfaceRouterService` from `@ptah-extension/core`), then in a `queueMicrotask` focus the host only if `active === document.body`, or `!active?.isConnected`, or `wasInside`. Never call the remount synchronously from anything but this effect.
  - "Back to welcome" icon button in the `no-drag` cluster, rendered only when `!hasWorkspaceFolders() && openConfigurationSurface() !== null`: `type="button"`, `aria-label="Back to welcome"`, `data-test="config-back-to-welcome"`, `(click)` → `appState.setCurrentView('chat')`.

### Task 4.2: activity-placement spec stub — IMPLEMENTED

- Depends on: Task 4.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\electron-shell.activity-placement.spec.ts` (MODIFY)
- Plan reference: override 4 (implementation-plan.md:29-30); plan-review.md:307-311 (R2-5)
- Validation notes: RF. There is NO tab-count re-pin; the three cases at `:130, 135, 142` stay as they are.
- Implementation details: extend `appStateStub` (`:86-92`) with `openConfigurationSurface` (a signal, `null`) and `configurationSurfaceRemountTick` (a signal, `0`), and make `layoutStub.hasWorkspaceFolders` a writable signal (`true`). The shell now injects `SurfaceRouterService`, so add a `{ provide: SurfaceRouterService, useValue: { remountActiveSurface: jest.fn(), pendingSurface: () => null } }` stub. Nothing else.

### Task 4.3: config-gate spec — IMPLEMENTED

- Depends on: Task 4.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\electron-shell.config-gate.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:485 (Test plan, gate spec, apart from the keyed-`@for` wording, which override 1 replaces); overrides 3 and 6
- Pattern to follow: `electron-shell.activity-placement.spec.ts:69-128` (stubs, TestBed), with signal-backed stubs. Branch 2 needs a real `RouterOutlet`: keep the real import in the override (for example `set: { imports: [RouterOutlet], schemas: [CUSTOM_ELEMENTS_SCHEMA] }`) and provide `provideRouter([])` or small test routes. Stub `SurfaceRouterService` with `{ remountActiveSurface: jest.fn(), pendingSurface: jest.fn(() => null) }`.
- Implementation details — cases:
  1. No workspace and `openConfigurationSurface` null: `ptah-electron-welcome` renders; no `router-outlet`, no `ptah-app-shell`.
  2. No workspace and `'settings'` open: one `router-outlet`; no `ptah-app-shell`, no `ptah-electron-welcome`; the back button shows.
  3. Workspace open: the 3-panel area with `ptah-app-shell`; no back button; the tab row has exactly four `role="tab"` buttons titled Chat, Tasks, Tribunal, Analytics, in that order, inside `[role="tablist"].electron-tabs`.
  4. The menu host renders with no workspace (criterion 4), and the menu host and back button both sit inside a `.no-drag` element (criterion 8).
  5. The back button calls `setCurrentView('chat')`; setting `openConfigurationSurface` to null afterwards returns the welcome screen (criterion 5).
  6. Flip 2 → 3 (first folder while a surface is open): `hasWorkspaceFolders` true plus a tick bump gives `ptah-app-shell` and no bare outlet, with no error (RB).
  7. Flip 3 → 2 (last workspace closed while a surface is open): the bare outlet is back and the back button shows.
  8. Setup hub non-configuration target with no workspace (finding 6): `openConfigurationSurface` back to null gives the welcome screen (designed behaviour, pinned).
  9. Tick bump from 0 to 1 calls `remountActiveSurface` exactly once; tick 0 never calls it.
  10. Focus (RE): with focus on `body` the host receives focus after the bump; with focus on a live control outside the host (for example a navbar button) focus stays there.
  11. Pending navigation (Batch 2 reviewer instruction 1): with `pendingSurface()` stubbed to return `'tasks'`, a tick bump does NOT call `remountActiveSurface`. With it back to `null`, the next tick bump calls it once.

### Batch 4 verification

- Three files contain the work; the team-leader confirms no diff in `app-shell.component.*`
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat` passes
- `npx nx run @ptah-extension/webview-e2e-harness:e2e` passes (boot-progress and activity-ticker); output tailed in `batch-4-report.md`
- Both review verdicts accepting
- Manual checks (lanes cannot drive Electron; the orchestrator or QA runs them and the team-leader records the result
  here, or records "carried to QA" and the orchestrator tells the user): no folder → Settings → Back to welcome (also
  with no auth) keeps the welcome screen; close the last workspace while on Settings; open the first folder while on a
  configuration surface; switch workspaces on each of the four surfaces for the fresh-data check (RD); macOS trigger,
  items and backdrop over the title bar (criterion 8, RG)

### Batch 4 outcome

- Executor: `codex` (`batch-4-report.md`, including "Revision 1"). Files: `electron-shell.component.ts`,
  `electron-shell.activity-placement.spec.ts`, `electron-shell.config-gate.spec.ts` (new).
- Team-leader check on disk (`electron-shell.component.ts`):
  - Tab row `:123-171`: Chat, the Apps-slot comment, Tasks, Tribunal, Analytics, with `role="tablist"`, `.electron-tabs`,
    `role="tab"` and `aria-selected` kept. The Tasks and Tribunal titles were shortened to "Tasks" and "Tribunal" to match
    gate case 3. Nothing selects the old long titles apart from `app-shell.component.html` (VS Code path, untouched).
  - The four configuration tabs, their handlers and the unused icons are gone.
  - `no-drag` cluster `:181-203`: the back button (`data-test="config-back-to-welcome"`, shown with no workspace and a
    surface open), then `<ptah-global-config-menu />` left of the theme toggle.
  - Three-branch gate `:207-297`, with a bare `<router-outlet />` in branch 2.
  - Un-keyed `ptah-app-shell` in a `tabindex="-1"` `outline-none` host with `data-test="configuration-surface-host"`.
  - Effect `:331-353`: tracks the tick only, holds `lastHandledTick` from construction, skips `0`, runs `untracked`,
    returns while `pendingSurface()` is non-null, calls `remountActiveSurface()`, then focuses after `afterNextRender`
    under the three conditions.
  - Binding rules 1-8 were honoured (no remount elsewhere, no outlet `(activate)`/`(deactivate)` bindings, no menu
    logic duplicated).
  - The activity-placement spec diff is the stub extension only. The gate spec covers cases 1-11 plus the revision-1
    cases (15 tests). No `.skip`, `.only`, `as any` or `@ts-ignore`.
  - Guards: `app-shell.component.*`, `app.routes.ts` and `webview-surface.types.ts` are untouched. No added line has
    `class.hidden` or `retain: true`.
- Orchestrator verification after revision 1 (all `--skip-nx-cache`):
  - `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat` PASS.
  - `npx nx build ptah-extension-webview` PASS (fresh worktree dist).
  - `npx nx run @ptah-extension/webview-e2e-harness:e2e`: 71 passed, against the worktree dist. The lane's earlier
    harness run used the main checkout's bundle and does not count.
  - ESLint on the changed files: 0 errors, 6 warnings (`no-non-null-assertion`, spec files only).
- Reviews:
  - Internal code-logic-reviewer: APPROVE 8/10 (`batch-4-internal-review.md`), 2 MODERATE, both FIXED in revision 1:
    - Focus after the 2 → 3 flip now uses `afterNextRender` and re-reads the host, with a spec case.
    - Real route activation in the bare outlet now has a spec case.
  - Glm: ACCEPT 9/10 (`batch-4-glm-review.md`), 3 MINOR:
    - MINOR 1 (no remount on construction with a non-zero tick) FIXED: `lastHandledTick` `:331-336`, plus spec case 3 → 4.
    - MINOR 2 (host selector) FIXED: `data-test="configuration-surface-host"`.
    - MINOR 3 ACCEPTED: "Back to welcome" does nothing while `canSwitchViews()` is false, the same accepted behaviour as
      the menu and the removed tabs.
- Manual checks: NOT RUN, all five CARRIED TO QA. This session has no interactive Electron window, and the machine is
  Windows, so no macOS. The orchestrator tells the user at Gate 3. The checks:
  1. No folder open: Settings, then "Back to welcome", including with no auth.
  2. Close the last workspace while on Settings.
  3. Open the first folder while on a configuration surface.
  4. Fresh data after a switch on all four surfaces (RD, RJ).
  5. macOS title bar and backdrop (criterion 8, RG).

## Batch 5: E2e — menu helper, driver rename, Thoth-entry scenes — PENDING

- Recommended executor: CLI lane `codex` (x1)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: the helper is created first; the other five files consume it or sit in the same selector family.
- Tasks: 6 | Depends on: Batch 4 (`data-test` hooks, tab titles)
- Deliverables: `apps\ptah-electron-e2e\src\showcase\_harness\config-menu.ts`, `apps\ptah-electron-e2e\src\showcase\_harness\prewarm.ts`, `apps\ptah-electron-e2e\src\support\ui-driver.ts`, `apps\ptah-electron-e2e\src\showcase\thoth-tour.scene.ts`, `apps\ptah-electron-e2e\src\showcase\skills-tour.scene.ts`, `apps\ptah-electron-e2e\src\showcase\memory-recall.scene.ts`, `batch-5-report.md`
- Scoped verification: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`
- Reviewers: internal code-logic-reviewer (batch-5-internal-review.md) + Glm lane ("Batch 5" in code-logic-review.md) when available; codex implemented, so codex cannot stand in

### Task 5.1: Shared configuration-menu helper — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\_harness\config-menu.ts` (CREATE)
- Plan reference: implementation-plan.md:406-411, :492; plan-review.md:206-209 (instruction 7)
- Pattern to follow: `_harness/prewarm.ts` (guarded raw actions, `:15-25` rules); `import type { Director } from './director'` (as `thoth-tour.scene.ts:2` does).
- Implementation details: `export type ConfigSurfaceId = 'thoth' | 'setup-hub' | 'marketplace' | 'settings'`. `openConfigSurface(page, director, id)` uses `director.click` on `[data-test="config-menu-trigger"]`, waits for `[data-test="config-menu-item-<id>"]`, and `director.click`s it, so the camera beat is recorded. `openConfigSurfaceSilently(page, id)` does the same with raw clicks, visibility-guarded and error-swallowing. `activeConfigSurface(page)` returns the id carrying `aria-current="true"`, or null; it opens the menu silently and closes it with Escape. Selectors are `data-test` only, never labels.

### Task 5.2: Prewarm through the menu, with restore — PENDING

- Depends on: Task 5.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\_harness\prewarm.ts` (MODIFY)
- Implementation details: `prewarmThoth` enters Thoth via `openConfigSurfaceSilently(page, 'thoth')`. Before entering, capture both `activeNavTitle` and `activeConfigSurface`. On exit, restore by tab title when one was captured; otherwise, if a configuration surface was captured, restore it through the menu (`activeNavTitle` returns null for configuration surfaces, `:32-39`). `prewarmNavSurface` keeps working for the remaining tabs; update its doc comment. Keep the SILENT / GUARDED / NON-DESTRUCTIVE rules.

### Task 5.3: UI driver Chat rename — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\support\ui-driver.ts` (MODIFY)
- Implementation details: `:325-328` becomes `getByRole('tab', { name: 'Chat' })` `.or(locator('[title="Chat"]'))`; update the comment at `:320-323`. Nothing else.

### Task 5.4: thoth-tour scene — PENDING

- Depends on: Task 5.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\thoth-tour.scene.ts` (MODIFY)
- Implementation details: `goToThoth` (`:105-126`) calls `openConfigSurface(page, director, 'thoth')` in place of the candidate loop (`:106-122`); keep the `#thoth-tab-memory` wait; update the doc comment.

### Task 5.5: skills-tour scene — PENDING

- Depends on: Task 5.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\skills-tour.scene.ts` (MODIFY)
- Implementation details: replace the Thoth tab candidate block (`:68-70`) with `openConfigSurface(page, director, 'thoth')`; keep the following waits.

### Task 5.6: memory-recall scene — PENDING

- Depends on: Task 5.1
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\memory-recall.scene.ts` (MODIFY)
- Implementation details: `goToMemory` (`:61-78`) enters Thoth via `openConfigSurface(page, director, 'thoth')`; keep the memory-tab click and the panel wait.

### Batch 5 verification

- Six files contain the work; no `getByRole('tab', { name: 'Thoth' })` remains in them
- `npx nx run-many -t typecheck,lint -p ptah-electron-e2e` passes
- Both review verdicts accepting

## Batch 6: E2e — remaining configuration-surface scenes — PENDING

- Recommended executor: CLI lane `codex` (x1)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: five mechanical scene edits, all consuming the Batch 5 helper.
- Tasks: 5 | Depends on: Batch 5
- Deliverables: the five scene files below, `batch-6-report.md`
- Scoped verification: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`
- Reviewers: internal code-logic-reviewer (batch-6-internal-review.md) + Glm lane ("Batch 6" in code-logic-review.md) when available; codex implemented, so codex cannot stand in

In each file, replace the removed top-nav tab candidates with `openConfigSurface(page, director, <id>)` from
`./_harness/config-menu`. Keep every following wait and narration beat, and update doc comments that describe reaching
the surface through a top-nav tab.

### Task 6.1: gateway-tour (thoth) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\gateway-tour.scene.ts` (MODIFY) — block at `:86`

### Task 6.2: cron-tour (thoth) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\cron-tour.scene.ts` (MODIFY) — block at `:64-66`

### Task 6.3: setup-wizard-tour (setup-hub) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\setup-wizard-tour.scene.ts` (MODIFY) — block at `:49-50`

### Task 6.4: settings-tour (settings) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\settings-tour.scene.ts` (MODIFY) — block at `:85-87`, doc comment `:32`

### Task 6.5: marketplace-tour (marketplace) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\marketplace-tour.scene.ts` (MODIFY) — block at `:97-99`, doc comment `:31`
- Validation notes: `:115` and `:136` select the hub's own section tabs (`hub(page).getByRole('tab', …)`) — leave them unchanged.

### Batch 6 verification

- Five files edited; no top-nav tab selector for Thoth, Setup, Settings or Marketplace remains (inner hub tabs excepted)
- `npx nx run-many -t typecheck,lint -p ptah-electron-e2e` passes
- Both review verdicts accepting

## Batch 7: E2e — renamed-tab scenes, residual sweep, branch guard greps — PENDING

- Recommended executor: CLI lane `codex` (x1)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: three label renames. The batch runs last so its sweep sees every earlier edit, and it carries the branch-wide guard greps.
- Tasks: 3 | Depends on: Batch 4 (labels); ordered after Batch 6
- Deliverables: the three scene files below, `batch-7-report.md`
- Scoped verification: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`
- Reviewers: internal code-logic-reviewer (batch-7-internal-review.md) + Glm lane ("Batch 7" in code-logic-review.md) when available; codex implemented, so codex cannot stand in

### Task 7.1: canvas-orchestra scene — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\canvas-orchestra.scene.ts` (MODIFY)
- Implementation details: `:44-45` `name: 'Canvas'` becomes `name: 'Chat'`, and any `[title="Orchestra Canvas"]` becomes `[title="Chat"]`. Narration and headings are unchanged.

### Task 7.2: chat-code-edit scene — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\chat-code-edit.scene.ts` (MODIFY)
- Implementation details: `:179-181` Canvas becomes Chat and `[title="Orchestra Canvas"]` becomes `[title="Chat"]`; change the doc comment at `:15` only where it names the tab.

### Task 7.3: dashboard-tour scene and residual sweep — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\dashboard-tour.scene.ts` (MODIFY)
- Implementation details: `:53-56` Dashboard becomes Analytics (`name: 'Analytics'`, `[title="Analytics"]`). Then grep `apps/ptah-electron-e2e/src` and `libs/frontend/webview-e2e-harness/src` for `name: 'Canvas'`, `name: 'Dashboard'`, `title="Orchestra Canvas"`, `title="Session Analytics"`, and a top-nav `getByRole('tab', { name: 'Thoth' | 'Setup' | 'Settings' | 'Marketplace' })`. List every hit in `batch-7-report.md`. The canvas headings `landing-page-tour.scene.ts:242` and `specs/git/hunk-revert-top-layer.spec.ts:199` are expected and stay. Report other hits; do not edit them.

### Batch 7 verification

- Three files edited; sweep output in `batch-7-report.md`
- `npx nx run-many -t typecheck,lint -p ptah-electron-e2e` passes
- Branch guard greps, run by the team-leader over ADDED lines only (plan-review instruction 8):
  - `git diff origin/main -U0 | grep '^+' | grep -E 'class\.hidden|retain: *true'` returns nothing (criterion 21)
  - `git diff --name-only origin/main` lists neither `webview-surface.types.ts` nor `app.routes.ts` (criterion 20)
  - `git diff --name-only origin/main` lists no `app-shell.component.*` (user decision 1)
- Both review verdicts accepting

## Completion gate (Mode 3)

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core,@ptah-extension/chat,ptah-electron-e2e,@ptah-extension/webview-e2e-harness`
- `npx nx run @ptah-extension/webview-e2e-harness:e2e`; the Electron Playwright run (`ptah-electron-e2e:e2e`) recommended to QA
- Batch 4's manual checks recorded as run, or as carried to QA
- Tell TASK_2026_533 where the global write lives and that the remount is `SurfaceRouterService.remountActiveSurface()`
  (outlet re-activation, the child URL is preserved) — the orchestrator's message; 533 also wants to be told when 540 is merged (the merge is the user's action)
