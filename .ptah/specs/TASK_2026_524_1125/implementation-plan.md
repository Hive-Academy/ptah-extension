# Implementation Plan - TASK_2026_524_1125 (Batches 3 and 4, webview half)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-524-batch3-4`,
branch `refactor/task-524-batch3-4-route-reuse`, based on main `69a2b835e`.
All `file:line` citations are against that tree. The host half (VS Code
`registerWebviewPanelSerializer`) is planned in `host-restore-plan.md`. This plan
defines the webview side and the contract under `## Host contract`.

## Inputs and constraints

- Requirements used: `context.md`, `completion-validation.md`,
  `implementation-note.md`, `batch2-surface-active-report.md`,
  `batch2-independent-review.md`, `TASK_2026_531_c4a8/{task,context,implementation-notes,test-report}.md`,
  `host-restore-plan.md` (parallel draft, read for reconciliation only).
- Corrections applied:
  - `TASK_2026_531_c4a8/task.md` still says `status: backlog`, but the work merged
    in PR #638 (merge `77f99a687`). Source confirms it:
    `libs/frontend/canvas/src/lib/canvas-layout.service.ts:9,56` injects
    `SURFACE_ACTIVE` and `canvas-workspace-grid.component.ts:208-210` combines it.
    The status field is not mine to change. This plan treats 531 as landed.
  - `context.md` lists `marketplaceActiveProvider` as Batch 4 sub-state. It no
    longer exists. Marketplace is already a routed tree with a page memory:
    `libs/frontend/marketplace/src/lib/routes/marketplace.routes.ts:79-84,119-168`
    and `AppStateManager.rememberMarketplaceRoute` / `openMarketplace`
    (`libs/frontend/core/src/lib/services/app-state.service.ts`, `rememberMarketplaceRoute`
    and `openMarketplace`, both after `:1095`). TASK_2026_533 did that work, so
    Batch 4 only uses it as the precedent for Thoth.
  - `@defer (on immediate)` for Thoth is gone. Batch 1 made it a lazy route
    (`apps/ptah-extension-webview/src/app/app.routes.ts:123-130`).
- Design handoff used: none (no UI change; behaviour only).
- Missing decision-critical input: TASK_2026_492_0bcc (navigation-set remap) has
  not landed. It does not block this work. The ids stay in `SURFACE_ROUTE_IDS`
  (`libs/shared/src/lib/types/webview-surface.types.ts:52-64`), and nothing here
  adds an id.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Shared chrome row is hidden, not destroyed, while a standalone surface shows | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:72` | This binding is the `[class.hidden]` that Batch 3 replaces |
| The outlet wrapper is hidden on chat | `app-shell.component.html:66-68` | An `@if` here would destroy the outlet and its routed component, so it stays CSS (see Preserve list) |
| Canvas and chat panes toggle on `layoutMode`, each behind `SurfaceActiveDirective` | `app-shell.component.html:782-783,811-812`; `libs/frontend/core/src/lib/routing/surface-active.directive.ts:22-27` | An in-chat toggle, not navigation. It is already activity-gated by layout mode |
| ONE `OrchestraCanvasComponent` holds every workspace's grid | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:63-67,185-191`; `canvas.store.ts:51,110,606` (`RETAINED_WORKSPACE_CAP = 4`) | A workspace-keyed chat instance would create one CanvasStore per workspace and bypass the store's own retention and cross-workspace prune (`orchestra-canvas.component.ts:458`) |
| The shell is deliberately never keyed | `app-state.service.ts:435-447` ("There is NO keyed `ptah-app-shell` host: keying the shell would destroy … `CanvasStore`") | Confirms the chat tree must stay a single instance |
| `ORCHESTRA_CANVAS_COMPONENT` is a value provider at the app root, injected by the chat shell | `apps/ptah-extension-webview/src/app/app.config.ts:236`; `app-shell.component.ts:218-219` | Unchanged by this plan. It stays the cycle break (chat must not import canvas) |
| `RouterOutlet.detach/attach` are `ViewContainerRef.detach()/insert()` | `node_modules/@angular/router/fesm2022/_router-chunk.mjs:1781-1793` | The "detached view" behaviour in context.md is a ViewContainerRef property, and can be reproduced for a non-routed tree without the Router |
| `destroyDetachedRouteHandle` and `BaseRouteReuseStrategy` are public in Angular 22.1.7 | `node_modules/@angular/router/types/_router_module-chunk.d.ts:1330,1338-1403` | Needed only if standalone retention is ever adopted (rejected below) |
| Edge-triggered canvas re-measure depends on observing the inactive state | `canvas-workspace-grid.component.ts:421-429` (`_wasVisible` latch), `canvas-layout.service.ts:69-82` (`wasActive` in `afterRenderEffect`), `:86-109` (observer ignores inactive or zero entries) | A detach that skips the inactive refresh pass would leave the latch set, and the grid would not re-measure on return. Detach must come after one inactive pass |
| After-render hooks run phase-major (earlyRead, write, mixedReadWrite, read across all sequences); registrations made during execution are deferred to the next pass | `node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:4306,4327-4358,4363-4375,4458-4464` | A same-pass `write` detach would run before the latch's `mixedReadWrite` hook. The detach is registered from a `read` fence and so lands in the next pass's `write` phase |
| Standalone surfaces are built around destroy-on-leave | `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:1100-1112` (attach/detach store + load per visit); `harness-builder-view.component.ts:658-662` (consumes a one-shot workflow request on every mount); `thoth-shell.component.ts:226-238` (window listeners released on destroy) | Retaining any of them changes behaviour (a stale board, a lost resume request, live listeners) unless its lifecycle is rewritten |
| Configuration surfaces re-mount on a workspace switch without navigating | `app-state.service.ts:415-424,876-935`; `surface-router.service.ts:188-196`; `electron-shell.component.ts:436-447` | Retaining a configuration surface would conflict with the remount path |
| Electron has two mutually exclusive outlets | `electron-shell.component.ts:268` (no-folder branch) and `:305` (`<ptah-app-shell>` containing the outlet) | A stored route handle could be reattached under a different outlet injector |
| Route sub-state precedent: shell route with a restore redirect and a page memory recorded on settle | `marketplace.routes.ts:79-84,119-168`; `marketplace-shell.component.ts:185-201` | Thoth reuses this pattern exactly |
| Thoth tab is a signal pointer in the per-workspace slice | `app-state.service.ts:54,310-322,711-712,1069-1074`; `thoth-shell.component.ts:296,303-307` | Becomes the memory behind `/thoth/:tab`, not the live truth |
| `openSkillsDivergedClones` switches tab by signal | `app-state.service.ts:1083-1088` | Must navigate instead, or it silently fails when Thoth is already open |
| Tabs are owned by `TabManagerService`; `switchTab` validates membership; `TabId` is UUID v4 | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:392,1270-1279`; `libs/shared/src/lib/types/branded.types.ts:191-205` | `chat/:tabId` is a projection. The URL never creates or owns a tab |
| Tab state persists per panel in localStorage, keyed by `ptahConfig.panelId` | `tab-manager.service.ts:371-380,637-660` | A restored VS Code panel restores its tabs only if it gets the same `panelId` (Host contract) |
| The boot path reads only `initialView` | `apps/ptah-extension-webview/src/app/app.ts:131-149` | Batch 4 adds the restore branch here |
| `VSCodeService.getState/setState` is a keyed, merging record | `libs/frontend/core/src/lib/services/vscode.service.ts:215-249`; `isConnected` at `:87-89` | The persisted route is one key in that record |
| The host injects `initialView` (null when unset) and `panelId`; reload drops `initialView` | `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:464-467`; `angular-webview.provider.ts:308-326` (reload passes `panelId`, no `initialView`); sidebar passes neither (`:78-81`) | A reload with state and no `initialView` must restore |
| Electron always sends `initialView: 'chat'` | `apps/ptah-electron/src/preload.ts:47`; `startup-config-ipc.ts:52,89` | A raw value cannot be read as "explicit" in Electron. This drives the seed rule |
| Electron `getState` is synchronous IPC over workspace storage; `setState` is asynchronous | `preload.ts:28-33`; `apps/ptah-electron/src/ipc/ipc-bridge.ts:130-132,510-543` | Restore works with no Electron change. The last write can race an immediate reload |
| App-level root starter precedent | `app.config.ts:195` (`provideAppInitializer(() => inject(AgentSessionAdoptionService).start())`) | Use for the tab-route sync |
| Spec route helper builds flat component-less routes | `libs/frontend/core/src/testing/surface-router-testing.ts:27-33` | Must gain the `chat/:tabId` and `thoth/:tab` shapes, or specs test a table production does not use |

## Decisions

### D1. Route the chat and canvas content area? — No. Detach the chrome without the Router.

- **Conflict.** context.md "Constraints" (`context.md:271-276`) forbids routing
  the chat and canvas content area. Batch 3 (`context.md:243-245`) says to replace
  the CSS hiding with a `RouteReuseStrategy`. Both cannot hold.
- **Options.**
  - (A) Make the chat chrome a routed `ChatSurfaceComponent` with
    `data.retain`, detached by a reuse strategy.
  - (B) Keep `[class.hidden]` and rely on `SURFACE_ACTIVE` only.
  - (C) Keep chat out of the Router. Detach the chrome row with the same
    primitive the Router uses (`ViewContainerRef.detach()/insert()`) through a
    small structural directive, `*ptahRetainWhile`.
- **Chosen: (C).**
  - It satisfies the constraint and the intent of Batch 3. The chrome leaves the
    DOM and change detection while its instance, its component-scoped DI and the
    canvas inside it stay alive. That is the "Router detached view" row of the
    `context.md:127-131` table.
  - Evidence: `RouterOutlet.detach()` is `this.location.detach()`
    (`_router-chunk.mjs:1781-1793`). Doing the same outside an outlet is the same
    mechanism.
- **Why (A) loses.**
  1. Workspace keying is wrong for chat. One canvas instance multiplexes
     workspaces (`orchestra-canvas.component.ts:185-191`;
     `canvas.store.ts:51,606`). A key that includes `normalizeWorkspaceRoot`
     would build one CanvasStore per workspace. That bypasses
     `RETAINED_WORKSPACE_CAP` and the cross-workspace prune. Without the key,
     (A) gains nothing over (C).
  2. (A) is a rewrite. The chrome's state (sidebar width, popovers, auth
     redirect) lives on `AppShellComponent` (`app-shell.component.ts:198-240,408-440`).
     `ElectronShellComponent` drives the sidebar divider through
     `viewChild(AppShellComponent)` (`electron-shell.component.ts:373,387-399`),
     which cannot reach a routed component.
  3. Electron has two outlets (`electron-shell.component.ts:268,305`). A
     detached chat handle could be reattached under the wrong outlet injector,
     and that handle would be holding the most valuable state in the app.
- **Why (B) loses.** It leaves the chrome in change detection, which is the cost
  Batch 3 exists to remove.
- **How CanvasStore and DI survive (AC7).**
  - `OrchestraCanvasComponent` is created by `*ngComponentOutlet` inside the
    retained embedded view (`app-shell.component.html:786`). Its node injector
    holds `CanvasStore`, `CanvasLayoutService`, `CanvasLayoutPersistenceService`
    and `CanvasRenderMetricsService` (`orchestra-canvas.component.ts:63-67`).
  - `ViewContainerRef.detach()` keeps the `ViewRef`, its child views, their node
    injectors and their providers. It only removes the nodes and unlinks the view
    from its container. Nothing is destroyed until the directive is destroyed,
    which happens only when `AppShellComponent` is destroyed. That is also when
    it is destroyed today.
  - `ORCHESTRA_CANVAS_COMPONENT` stays a root `useValue`
    (`app.config.ts:236`), read by `AppShellComponent`
    (`app-shell.component.ts:218-219`). The cycle break is untouched.
- **Reversibility: high.** It is one directive plus one template binding. Reverting
  restores `[class.hidden]` on the row.

### D2. Fold TASK_2026_531_c4a8 into Batch 3? — No. It has already landed.

- PR #638 (`77f99a687`) merged the canvas consumer:
  - `canvas-layout.service.ts:56,69-109`
  - `canvas-workspace-grid.component.ts:208-210,421-429,453-470`
- context.md requires the reuse step and `SURFACE_ACTIVE` to land together
  (`context.md:208-212`). That is now true for every consumer inside the tree
  Batch 3 detaches:
  - transcript, markdown and IntersectionObserver windowing (Batch 2, PR #574)
  - canvas grid and layout (PR #638)
- Batch 3 adds a requirement: **detach only after one inactive pass**
  (Lane-introduced constraint L2). Without it the edge-triggered consumers above
  never see `false`.
- Reversibility: not applicable.

### D3. Retention and eviction policy — no standalone retention. No `RouteReuseStrategy` is built.

- **Options.**
  - (a) A workspace-keyed `RouteReuseStrategy`:
    - opt-in through `data.retain`
    - LRU of 2
    - `destroyDetachedRouteHandle` on eviction
    - evict by workspace on `removeWorkspaceState`
  - (b) No standalone retention.
- **Chosen: (b).** No routed surface qualifies today.
  - **Configuration surfaces** (thoth, setup-hub, marketplace, settings) are
    global and re-mount through `remountActiveSurface` on a workspace switch
    (`app-state.service.ts:415-424,925-936`; `surface-router.service.ts:188-196`).
    A stored handle would bypass that.
  - **`tasks`** attaches its root store and reloads the board on every
    construction (`tasks-view.component.ts:1100-1112`). A retained instance
    would keep the store "attached", so pushes keep buying board scans that
    nothing renders. It would also show a board that never reloads.
  - **`harness-builder`** consumes a one-shot workflow request in `ngOnInit`
    (`harness-builder-view.component.ts:658-662`). A reattached instance never
    re-runs `ngOnInit`, so `HarnessWorkflowMessageHandler` resumes would be lost.
  - **`tribunal`** hosts Gridstack. Its internal resize handling on a detached
    (zero-size) tree is the hazard PR #638 had to fix for the canvas.
  - **`apps`** owns a `ResizeObserver` (`apps-page.component.ts:338-345`).
  - **`setup-wizard`** is a launch surface with live analysis observers.
  - No routed surface consumes `SURFACE_ACTIVE`. Its route providers exist
    (`app.routes.ts:74-167`), but they have no consumers in those libraries.
  - Under (a), the opt-in set would be empty. A strategy with nothing to retain
    is dead code.
- **Chat chrome policy.** One instance. It is created on first chat activation,
  retained for the life of `AppShellComponent`, and never evicted. That is
  today's lifetime, minus the eager build (see Preserve list, P1c).
- **Workspace keying.** It is not used anywhere. Chat must not be keyed (D1.1),
  and nothing else is retained. This is a deliberate departure from
  `context.md:166-172`, recorded as constraint L1.
- **Reversible: yes. The adoption trigger is recorded in L3.**
  - Adoption is additive: one `{ provide: RouteReuseStrategy, useClass }` in
    `app.config.ts` plus `data.retain` per route.
  - The prerequisite is per surface: convert its mount-time work to
    `SURFACE_ACTIVE` edges first.
  - If the owner overrules (b), the minimum safe form is (a), with two extra
    rules:
    - the key is captured at `store()` from the workspace of the last settled
      navigation, and at `retrieve()` from the live workspace, because a
      switch's restore navigation activates after the workspace pointer has
      moved (`app-state.service.ts:909,933`);
    - every eviction calls `destroyDetachedRouteHandle`, because a dropped
      handle is otherwise leaked, not destroyed.

### D4. One PR or two? — Two.

- **PR A, Batch 3 (3a and 3b).** Ships from this branch.
- **PR B, Batch 4 (4a–4f, including 4e2) plus host batch H1** from `host-restore-plan.md`.
  - Cut it from main after PR A merges, or stack it on this branch.
  - Batch 4 is file-disjoint from Batch 3, except the doc comments 3b edits in
    `app.routes.ts` and `app.config.ts`. Stacking is safe in either order if 3b
    lands first.
- **Evidence.** context.md wants each batch in its own PR, so a 3-and-4 shell
  rewrite stays reviewable (`context.md:250-252`). AC4 needs the webview restore
  (4a, 4b, 4d) and the host serializer (H1) in one PR to be testable end to end.
- **Reversibility: high.** It is a delivery choice only.

### D5. `initialView` and the restored URL — a new, explicit host deep link wins. Otherwise the restored URL wins.

- **The rule.** The persisted state carries `seed`, the raw host `initialView`
  that this webview consumed. Precedence at boot:
  1. `window.initialView`, the DevTools override, which is always explicit
     (`app.ts:132-137`);
  2. host `ptahConfig.initialView`, when it is non-null **and** differs from the
     persisted `seed` (or no state exists). This is a new deep link;
  3. the persisted route;
  4. `normalizeInitialView(host value)`, which falls back to `chat`.
- **Why.**
  - VS Code reloads an existing panel with the **same** HTML. The analytics
    panel's `initialView: 'analytics'` is still embedded
    (`webview-html-generator.ts:464-467`), so a plain "host wins when set" rule
    would break AC3 for every command-opened panel.
  - A new panel has no state, so its deep link always wins. The setup-wizard
    launch surface keeps its no-flash landing (`context.md:320-323`).
  - Electron always sends `'chat'` (`preload.ts:47`). After the first boot,
    `seed === 'chat'`, so Electron restores.
  - The rule meets the brief: an explicitly set deep link the webview has not
    consumed wins.
- **Former conflict with `host-restore-plan.md` ("A valid saved URL wins over
  the host's initialView") — resolved (R6).**
  - The difference is invisible to the host only if the serializer passes
    `initialView: null` on restore. That is a Host contract requirement, and
    the host plan now meets it (`host-restore-plan.md:28,30`).
  - The rejected alternative set `initialView` to the surface derived from the
    saved route. Rule 2 would then fire, and the URL's `:tabId`/`:tab`
    sub-path would be lost.
- **Reversibility: high.** It is one pure function, `resolveBootNavigation`.

### D6. Tab history semantics — a tab switch replaces the URL. A surface change pushes it.

- A tab switch uses `replaceUrl`.
- **Why.** Pushing would make Back cycle through tabs, which nothing in the task
  asks for. It would also flood the in-memory history on streaming tab churn.
- **Consequence.** Back from a standalone surface returns to
  `/chat/<tab active when chat was left>`. If that tab still exists, it becomes
  active again (Risk R5).
- **Reversibility: high.** It is one navigation flag.

## Architecture decision

- **Chosen approach.**
  - Batch 3:
    - a `RetainedViewDirective` (`*ptahRetainWhile`) in `@ptah-extension/core`
      routing replaces `[class.hidden]` on the app-shell chrome row;
    - the inner layout panes and the outlet wrapper keep their CSS toggles;
    - there is no `RouteReuseStrategy`.
  - Batch 4:
    - `chat/:tabId` as component-less child routes, kept in step with
      `TabManagerService` by a root sync service in `@ptah-extension/chat`;
    - Thoth as a lazily loaded route tree (`THOTH_ROUTES`) with `:tab` children
      and a restore redirect, copying `MARKETPLACE_ROUTES`;
    - the logical URL persisted under one `vscode.setState` key, whose shape and
      parser live in `@ptah-extension/shared` so the extension host validates
      identically;
    - a pure boot-precedence function that the existing boot path calls.
- **Rationale.** It covers every Batch 3 and Batch 4 requirement except
  workspace-keyed retention, which the evidence shows is harmful for chat and
  unused elsewhere (D1, D3). It reuses three established patterns:
  - the marketplace route tree;
  - the app-initializer starter;
  - shared contract types for host validation (`webview-surface.types.ts:1-20`).
- **Rejected alternatives.** Routed chat with a reuse strategy (D1-A). CSS plus
  activity only (D1-B). LRU standalone retention (D3-a). "Host always wins" or
  "state always wins" boot rules (D5). Pushing tab switches into history (D6).
- **Assumptions.**
  - **A1. Component-bound effects inside a detached embedded view do not run until
    reattached.** `afterRenderEffect` belongs here too.
    - Check: spec 3a-T7 pins the observed behaviour.
    - The design holds either way, because of the inactive pass (L2).
    - If A1 is true, canvas FIFO bridges such as
      `AppStateManager.canvasSessionRequests` drain on return instead of live
      (Preserve list P1f).
  - **A2. A signal `viewChild` over an element inside a container-detached view
    reads `undefined` until reinsert.**
    - Check: spec 3a-T6.
    - This makes `observeShellRowWidth` disconnect and reconnect
      (`app-shell.component.ts:425-429,579-587`).
  - **A3. A component-less child (`:tab`) under a routed component with no
    `<router-outlet>` activates without error.**
    - Check: spec 4e-T1. Marketplace list pages use component-less children
      (`marketplace.routes.ts:96-99`).
  - **A4. Gridstack has no `columnOpts` responsive breakpoints in the canvas
    options, so a zero-size detached tree does not trigger a column change.**
    - Check: read `gsOptions` in full (`canvas-workspace-grid.component.ts:214+`).
    - This is equal to today: `display:none` also yields zero size.
- **Effect on existing code.**
  - Replaced:
    - the `[class.hidden]` binding on the chrome row (`app-shell.component.html:72`);
    - the flat `thoth` route (`app.routes.ts:123-130`);
    - the flat `chat` route children (`app.routes.ts:69-78`);
    - Thoth's signal tab pointer as live truth (`thoth-shell.component.ts:296,303-307`);
    - the signal tab switch in `openSkillsDivergedClones` (`app-state.service.ts:1083-1088`);
    - the initial-view-only boot (`app.ts:131-149`).
  - Left alone:
    - `MemoryPlatformLocation`;
    - `SurfaceRouterService` result semantics;
    - `SURFACE_ACTIVE` and its consumers;
    - the canvas library;
    - the marketplace routes;
    - `remountActiveSurface`;
    - per-workspace surface memory;
    - `SWITCH_VIEW`.

## Component specifications

### 1. RetainedViewDirective (Batch 3a)

- **Purpose.** Keep one embedded view alive across a visibility condition. While
  the condition is false, the view is outside the DOM and outside change
  detection.
- **Responsibilities.**
  - Create the view on the first `true`.
  - On `true → false`:
    - synchronously set `display: none` on the view's root element nodes through
      `Renderer2.setStyle` (CSSOM, so CSP-safe);
    - start a **two-pass deferred detach** (L2). `detach()` removes DOM nodes
      (`_debug_node-chunk.mjs:6299-6319`), so it runs only in the `write`
      phase, and only in the render pass *after* the one in which the inactive
      state was observed:
      1. **Fence (pass N).** Register `afterNextRender({ read: fence })` with
         `{ injector: EnvironmentInjector }`. `fence` performs no DOM access. It
         checks the generation and, if still current, registers stage 2. The
         `read` phase (index 3) runs after `mixedReadWrite` (index 2), where the
         canvas latch `afterRenderEffect` runs (`canvas-layout.service.ts:73-82`;
         a single-function `afterRenderEffect` maps to `mixedReadWrite`, see
         `getHooks`, `_debug_node-chunk.mjs:4458-4464`). The grid's view `effect`
         latch (`canvas-workspace-grid.component.ts:422-429`) has already run
         during pass N's refresh, because the view is still attached then.
      2. **Detach (pass N+1).** `afterNextRender({ write: detach })`, same
         injector. A registration made while hooks execute is deferred to the
         next pass and the scheduler is notified
         (`_debug_node-chunk.mjs:4352-4358,4371-4375`). Phases run outer, sequences
         inner (`:4327-4343`), so a stage-2 `write` registered in pass N's
         `write` would *precede* the latch. That is why the fence exists.
         `detach` re-checks generation and condition, then calls
         `ViewContainerRef.detach()`.
      - The environment injector matters: `afterEveryRenderImpl` binds a
        sequence to a view when the injector yields a `ViewContext`
        (`_debug_node-chunk.mjs:4472-4476`). A view-bound registration made
        during execution is only picked up on that view's next refresh
        (`:4367-4370`), which may never come for a hidden subtree. Because
        `manualCleanup` is off, that injector's `DestroyRef` is the
        environment's, so the directive destroys the pending ref itself from its
        own `DestroyRef`.
  - On `false → true`:
    - increment the generation and `destroy()` the single pending
      `AfterRenderRef` (fence or detach, whichever is current). This cancels a
      detach at either stage;
    - if the view is detached, `insert()` it synchronously;
    - remove the inline `display`.
  - Never destroy the view except through the host's own destruction.
  - Expose nothing else.
- **Verified contracts and entry points.**
  - `ViewContainerRef.detach/insert`, as used by the Router
    (`_router-chunk.mjs:1781-1793`).
  - Sibling directive pattern and location:
    `libs/frontend/core/src/lib/routing/surface-active.directive.ts:6-28`.
  - Barrel: `libs/frontend/core/src/lib/routing/index.ts:36-37`, re-exported by
    `libs/frontend/core/src/index.ts:54`.
- **Dependencies.** `@angular/core` only. Direction: chat → core (already
  established, `app-shell.component.ts:71`).
- **Integration points.** `app-shell.component.html:72`, as
  `<div #shellRow *ptahRetainWhile="!isStandaloneView()" class="flex h-full bg-surface-0">`.
  `isStandaloneView` is unchanged (`app-shell.component.ts:198-200`).
- **Failure behaviour.**
  - It cannot fail at runtime: no I/O, no throw paths.
  - A true→false→true before stage 2 runs cancels the pending detach and
    leaves the view attached. This holds within one tick (fence pending) and
    between pass N and pass N+1 (detach pending). Stage callbacks also re-check
    the generation, so a ref destroyed mid-execution (`unregister` marks it
    `erroredOrDestroyed`, `_debug_node-chunk.mjs:4381-4386`) cannot act on a
    stale state.
  - If the host is destroyed while a detach is pending, the directive's
    `DestroyRef` destroys the pending `AfterRenderRef`.
  - **Assumption:** `SURFACE_ACTIVE` for the canvas becomes `false` in the same
    change-detection pass as the `ptahRetainWhile` condition, because both
    derive from the settled surface. Check: 3a-T12 asserts that the latch
    observes `false` while the nodes are still in `document`. If the two signals
    can settle in different passes, the fence must wait for one pass in which
    the probe reports inactive, not just one pass.
- **Quality requirements.**
  - At most one pending `afterNextRender` per directive instance. The fence
    hands over to the detach stage. It is released on supersede or destroy.
  - No DOM access in the `read`-phase fence. The only DOM mutations are the
    synchronous `display` toggle and the `write`-phase `detach()`.
  - No timers, observers or listeners.
  - The constructor count of the retained content's components is exactly 1
    across any number of round trips.
- **Verification seam.** A TestBed host component with a writable signal
  condition, plus a probe child that has a component provider, a view `effect`
  and an `afterRenderEffect`. See the Test plan, 3a-T1…T8 and T12…T14.
- **Files.**
  - CREATE `libs/frontend/core/src/lib/routing/retained-view.directive.ts`
  - CREATE `libs/frontend/core/src/lib/routing/retained-view.directive.spec.ts`
  - MODIFY `libs/frontend/core/src/lib/routing/index.ts` (export)

### 2. AppShell chrome row (Batch 3a)

- **Purpose.** Use component 1 for the chrome row instead of `[class.hidden]`.
- **Responsibilities.**
  - Template: replace `[class.hidden]="isStandaloneView()"` on `#shellRow`
    (`app-shell.component.html:72`) with `*ptahRetainWhile="!isStandaloneView()"`.
  - Rewrite the stale comments at `:30-37,71,776-778`.
  - Class: import `RetainedViewDirective` (`app-shell.component.ts:124-126`).
  - Update the `orchestraCanvasComponent` doc
    (`app-shell.component.ts:202-217`): "must stay mounted" becomes "retained
    detached".
  - Nothing else moves.
- **Verified contracts.**
  - `isStandaloneView`: `app-shell.component.ts:198-200`.
  - `shellRow` query and its effect: `:417`, `:425-429`, `:579-587`.
  - Electron sidebar-divider calls on the class: `electron-shell.component.ts:373-399`.
    These are class signals and are unaffected by detaching the template.
- **Dependencies.** Component 1.
- **Integration points.** Both shells:
  - VS Code via `app.html` (`<ptah-app-shell>`);
  - Electron via `electron-shell.component.ts:305`.
- **Failure behaviour.**
  - If the initial surface is standalone (for example the setup-wizard panel),
    the row is not built until the user first reaches chat. Canvas FIFO requests
    queue in `AppStateManager` until then (P1c, P1f).
  - Focus inside the row is lost on leave, as it is today with `display:none`.
- **Quality requirements.**
  - On a standalone surface, no chrome node is in `document`, and a signal change
    read by the chrome causes no DOM write.
  - Returning to chat re-shows the same canvas instance.
- **Verification seam.** A new spec that mounts `AppShellComponent` with
  `provideSurfaceRouterTesting()`. `ORCHESTRA_CANVAS_COMPONENT` is a stub
  component with a component-scoped probe provider. The spec round-trips
  chat → settings → chat. See 3a-T8…T10.
- **Files.**
  - MODIFY `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
  - MODIFY `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
  - CREATE `libs/frontend/chat/src/lib/components/templates/app-shell.retained-chrome.spec.ts`

### 3. Batch 3 documentation and e2e round trip (Batch 3b)

- **Purpose.** Remove the "batch 3 replaces this with a RouteReuseStrategy"
  claims, and pin AC7 against real Gridstack.
- **Responsibilities.**
  - Rewrite the doc comments in `app.routes.ts:33-40` and
    `app.config.ts:229-236` to state D1 and D3.
  - Update the comment in `webview-routing.spec.ts:566-568`.
  - Add an e2e case to `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`.
    It opens settings and returns to chat, then asserts:
    - the tile count is unchanged;
    - the `gs-y` row is unchanged;
    - `data-canvas-gesture-commits` and `data-canvas-layout-computations` did not
      reset, which proves the same `CanvasRenderMetricsService` instance. Both
      attributes are hosted per `TASK_2026_531/context.md:81-84`.
- **Failure behaviour.** n/a (documentation and test).
- **Verification seam.** The e2e runs on Linux CI only. `TASK_2026_531/context.md:72-79`
  records that e2e does not boot on Windows, and CLAUDE.md forbids running e2e
  locally.
- **Files.**
  - MODIFY `apps/ptah-extension-webview/src/app/app.routes.ts` (doc only)
  - MODIFY `apps/ptah-extension-webview/src/app/app.config.ts` (comment only)
  - MODIFY `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` (comment only)
  - MODIFY `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`

### 4. Webview route state contract (Batch 4a)

- **Purpose.** One dependency-free definition of the persisted route state, used
  by the renderer and the VS Code host.
- **Responsibilities.**
  - Export `WEBVIEW_ROUTE_STATE_KEY = 'ptahRoute'`.
  - Export `interface WebviewRouteState` (shape under `## Host contract`).
  - Export `parseWebviewRouteState(value: unknown): WebviewRouteState | null`,
    which reads `value` as the whole `getState()` record and validates
    `record[WEBVIEW_ROUTE_STATE_KEY]`.
- **Verified contracts.** Placement precedent: `webview-surface.types.ts:1-20`
  ("dependency-free … both the renderer and the extension host import it"),
  exported at `libs/shared/src/index.ts:22`.
- **Dependencies.** None.
- **Failure behaviour.** Any invalid input returns `null`. It never throws.
- **Quality requirements.** The validation rules are listed in `## Host
  contract`, and each rule has a spec case.
- **Files.**
  - CREATE `libs/shared/src/lib/types/webview-route-state.ts`
  - CREATE `libs/shared/src/lib/types/webview-route-state.spec.ts`
  - MODIFY `libs/shared/src/index.ts`

### 5. Boot precedence (Batch 4a)

- **Purpose.** Decide the first navigation as a pure function.
- **Responsibilities.**
  - `resolveBootNavigation(input) → BootPlan`, implementing D5.
  - Return the `seed` to persist:
    `hostInitialView ?? restored?.seed ?? null`. The DevTools override is never
    used as a seed.
- **Contract.**
  ```ts
  interface BootInput {
    devToolsOverride: string | undefined;            // window.initialView
    hostInitialView: string | null | undefined;      // ptahConfig.initialView
    restored: WebviewRouteState | null;              // parseWebviewRouteState(getState())
  }
  type BootPlan =
    | { kind: 'route'; route: string; seed: string | null }
    | { kind: 'surface'; rawView: string | undefined; seed: string | null };
  ```
- **Dependencies.** Shared (component 4).
- **Failure behaviour.** Total function. It has no I/O.
- **Files.**
  - CREATE `libs/frontend/core/src/lib/routing/boot-navigation.ts`
  - CREATE `libs/frontend/core/src/lib/routing/boot-navigation.spec.ts`
  - MODIFY `libs/frontend/core/src/lib/routing/index.ts`

### 6. SurfaceRouterService.navigateToUrl and route persistence (Batch 4b)

- **Purpose.** Navigate to a restored logical URL, and persist every settled URL.
- **Responsibilities.**
  - `SurfaceRouterService.navigateToUrl(route: string): Promise<SurfaceNavigationResult>`:
    - parse inside `try`; a parse throw is `failed`;
    - require that the primary first segment is a surface route id, using the
      existing private `surfaceOf` (`surface-router.service.ts:208-212`) plus
      `isSurfaceRouteId` on the raw segment, else `failed` without navigating;
    - map results exactly as `navigateToSurface` does (`:139-165`).
  - `SurfaceRoutePersistence` (root, core routing). `start(seed)`:
    - subscribes once to `Router.events` `NavigationEnd`;
    - writes `vscode.setState(WEBVIEW_ROUTE_STATE_KEY, { v: 1, route: urlAfterRedirects, seed, panelId: config().panelId ?? '' })`;
    - writes only when `vscodeService.isConnected()` (`vscode.service.ts:89`);
    - is idempotent: a second `start` is ignored.
  - `surfaceTestRoutes()` gains the production child shapes:
    - `chat`: `[{ path: '', children: [] }, { path: ':tabId', children: [] }]`;
    - `thoth`: `[{ path: '', pathMatch: 'full', redirectTo: 'memory' }, { path: ':tab', children: [] }]`.
- **Verified contracts.**
  - `SurfaceNavigationResult` and `surfaceNavigationLanded`:
    `surface-router.service.ts:40-48`.
  - `setState` merge: `vscode.service.ts:238-249`.
  - Test helper: `surface-router-testing.ts:27-33`.
- **Failure behaviour.**
  - `navigateToUrl` never rejects.
  - Persistence wraps `setState` in `try`/`catch`, logs one
    `console.warn('[SurfaceRoutePersistence] …')`, and continues. Navigation
    never depends on persistence.
- **Quality requirements.**
  - One subscription for the app's lifetime (root).
  - One write per settled navigation. Tab switches add one write each (D6),
    which is acceptable because they are user-paced.
- **Files.**
  - MODIFY `libs/frontend/core/src/lib/routing/surface-router.service.ts`
  - MODIFY `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts`
  - CREATE `libs/frontend/core/src/lib/routing/surface-route-persistence.ts`
  - CREATE `libs/frontend/core/src/lib/routing/surface-route-persistence.spec.ts`
  - MODIFY `libs/frontend/core/src/lib/routing/index.ts`
  - MODIFY `libs/frontend/core/src/testing/surface-router-testing.ts`

### 7. ChatTabRouteSync and the `chat/:tabId` route (Batch 4c)

- **Purpose.** Make the active tab addressable while `TabManagerService` stays
  the owner.
- **Route shape.** In `app.routes.ts`, `path: 'chat'` keeps its `providers` and
  becomes:
  `children: [{ path: '', children: [] }, { path: ':tabId', children: [] }]`.
  It stays component-less.
- **Responsibilities.** `ChatTabRouteSync` is root, in `@ptah-extension/chat`.
  `start()` is idempotent and installs two reactions:
  1. **URL → tab**, on `NavigationEnd`. If the settled surface is `chat`, read
     `segments[1]` of the parsed `urlAfterRedirects`.
     - When it is present and differs from `activeTabId()`, and both
       `TabId.validate` passes and `tabs()` contains it, call `switchTab(id)`.
     - Otherwise, replace the URL with
       `/chat/<activeTabId>`, or `/chat` when there is no active tab.
     - When it is absent and there is an active tab, replace the URL with
       `/chat/<activeTabId>`.
  2. **Tab → URL**, through an `effect` that tracks `activeTabId()` only, reading
     the rest through `untracked`. On change, when the current surface is `chat`,
     no navigation is pending (`SurfaceRouterService.pendingSurface() === null`),
     and the URL tab differs, call
     `router.navigate(['/chat', ...(id ? [id] : [])], { replaceUrl: true })`.
  - Never create, close or reorder tabs.
- **Verified contracts.**
  - `TabManagerService.activeTabId/tabs/switchTab`: `tab-manager.service.ts:391-392,1270-1279`.
  - `TabId.validate`: `branded.types.ts:200-202`.
  - `pendingSurface`: `surface-router.service.ts:101-105`.
  - Starter precedent: `app.config.ts:195`.
- **Dependencies.** chat → chat-state (existing,
  `agent-session-adoption.service.ts:11`). chat → core (existing). chat →
  `@angular/router`.
- **Integration points.**
  - `app.config.ts`: `provideAppInitializer(() => inject(ChatTabRouteSync).start())`.
  - `AppStateManager.setCurrentView('chat')` keeps landing on `/chat`, and
    reaction 1 completes it. `surfaceOf` reads only `segments[0]`
    (`surface-router.service.ts:208-212`), so `currentView` stays `chat`.
- **Failure behaviour.**
  - An unknown or invalid tab id in the URL never errors. The URL is corrected to
    the owner's active tab.
  - A failed replace navigation is ignored: the owner state is already correct,
    and the next settle re-reconciles.
- **Quality requirements.**
  - No loop. After either reaction runs, the other reaction's guard holds
    (`urlTab === activeTabId`).
  - At most one corrective navigation per settle.
- **Files.**
  - CREATE `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts`
  - CREATE `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts`
  - MODIFY `libs/frontend/chat/src/index.ts` (export)
  - MODIFY `apps/ptah-extension-webview/src/app/app.routes.ts` (chat children)
  - MODIFY `apps/ptah-extension-webview/src/app/app.config.ts` (initializer)
  - MODIFY `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`
    (update the chat-route shape test at `:566-573`; add a tabId round trip)

### 8. Boot restore wiring (Batch 4d)

- **Purpose.** Use components 4, 5 and 6 in the one place the first navigation
  happens.
- **Responsibilities.** `App.handleInitialView` (`app.ts:131-149`):
  1. read the override and the host value as today;
  2. `restored = parseWebviewRouteState(window.vscode?.getState())`. Read the raw
     record through `VSCodeService`; if it does not expose one, add a
     `getRawState(): unknown` passthrough. **Assumption**: the implementer
     confirms whether `getState<T>(key)` suffices, by passing the key and
     parsing the value instead;
  3. `plan = resolveBootNavigation(...)`;
  4. `surfaceRoutePersistence.start(plan.seed)` **before** navigating, so the
     first `NavigationEnd` is persisted;
  5. for `route`: `navigateToUrl`. If it did not land, warn and fall back to
     `navigateToSurface(normalizeInitialView(hostInitialView ?? undefined))`;
  6. for `surface`: the existing path.
- **Failure behaviour.** Every failure ends on a landed surface, `chat` at worst.
  None of them throws out of `ngOnInit`, so the error UI is not triggered by
  restore problems.
- **Files.**
  - MODIFY `apps/ptah-extension-webview/src/app/app.ts`
  - MODIFY `apps/ptah-extension-webview/src/app/app.spec.ts` (boot branches)
  - MODIFY `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`
    (restore integration under "initial navigation", `:305-375`)
  - (if needed) MODIFY `libs/frontend/core/src/lib/services/vscode.service.ts`
    plus its spec. That makes this sub-batch two projects and at most 5 files.

### 9. Thoth route tree (Batch 4e)

- **Purpose.** Make the Thoth tab addressable and restorable, using the
  marketplace pattern.
- **Responsibilities.**
  - `THOTH_ROUTES` in `@ptah-extension/thoth-shell`:
    ```ts
    [{ path: '', component: ThothShellComponent, children: [
      { path: '', pathMatch: 'full', redirectTo: restoreThothTab },  // RedirectFunction: inject(AppStateManager).thothActiveTab()
      { path: ':tab', canMatch: [thothTabSegment], children: [] },   // isThothTabId(segments[0]?.path)
      { path: '**', redirectTo: 'memory' },
    ]}]
    ```
    plus `THOTH_TAB_IDS` and `isThothTabId`, declared next to the existing
    `ThothActiveTabId` (`thoth-shell.component.ts:33`).
  - `app.routes.ts` `thoth`: keep `providers`, replace `loadComponent` with
    `loadChildren: () => import('@ptah-extension/thoth-shell').then(m => m.THOTH_ROUTES)`.
    This is the same chunk.
  - `ThothShellComponent`:
    - `activeTab` comes from the child route's `tab`. It is seeded synchronously
      from `ActivatedRoute.snapshot.firstChild`, which covers
      `remountActiveSurface` re-creating the shell with no navigation, and it is
      updated on each `NavigationEnd` whose URL is under `/thoth`;
    - on each settle, write memory through `appState.setThothActiveTab(tab)`.
      Settle-time only, never ahead of navigation (TASK_2026_317 rule,
      `marketplace-shell.component.ts:185-201`);
    - `selectTab(tab)` calls
      `void surfaceRouter.navigateToSurface('thoth', [tab])` plus the existing
      `thothStatus.refresh()`.
- **Verified contracts.**
  - Pattern: `marketplace.routes.ts:79-84,119-168`; app usage `app.routes.ts:131-140`.
  - Memory: `app-state.service.ts:711-712,1069-1074`.
  - Lazy-library import rule: `context.md:279-282`. The redirect and guard live in
    the lazy library itself and are reached only through `loadChildren`, as
    marketplace does.
- **Failure behaviour.** An invalid `:tab` falls to `**` and becomes
  `/thoth/memory`. A failed lazy load is reported as `failed` by
  `SurfaceRouterService` (`:159-165`), unchanged.
- **Files, split across two sub-batches so that each stays at or under the
  6-file cap and each is green on its own scoped verification.**
  - **4e, Thoth library (5 files, project `@ptah-extension/thoth-shell` only):**
    - CREATE `libs/frontend/thoth-shell/src/lib/thoth.routes.ts`
    - CREATE `libs/frontend/thoth-shell/src/lib/thoth.routes.spec.ts`
    - MODIFY `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts`
    - MODIFY `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts`
    - MODIFY `libs/frontend/thoth-shell/src/index.ts` (export `THOTH_ROUTES`,
      `THOTH_TAB_IDS`, `isThothTabId`)
    - The app table is not touched, so `webview-routing.spec.ts:584-595` (thoth in
      the `loadComponent` list) stays true and green. `THOTH_ROUTES` is exported
      but not yet wired.
  - **4e2, Thoth route-table wiring (2 files, project `ptah-extension-webview`
    only).** Depends on 4e, because it imports `THOTH_ROUTES` from the library
    barrel.
    - MODIFY `apps/ptah-extension-webview/src/app/app.routes.ts`: the `thoth`
      entry switches from `loadComponent` to `loadChildren`, keeping `providers`.
    - MODIFY `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:584-595`:
      remove `thoth` from the `loadComponent` list and add a `loadChildren`
      assertion that resolves `THOTH_ROUTES`.
    - The route-table change and its spec move together, so the spec can never
      be stale relative to the table.
  - Between 4e and 4e2, `selectTab` navigates to `/thoth/<tab>`, which the old
    table does not match. Both must therefore land in the same PR, with 4e2
    directly after 4e. 4e2 is not optional.

### 10. Diverged-clones deep link (Batch 4f)

- **Purpose.** Keep "open Skills with the diverged filter" working when Thoth is
  already open.
- **Responsibilities.** `openSkillsDivergedClones` (`app-state.service.ts:1083-1088`)
  becomes:
  - keep the `canSwitchViews()` guard;
  - `this.requestSurface('thoth', ['skills'])`;
  - `this._skillsDivergedRequest.set(this._activeWorkspacePath())`.
  It no longer calls `setThothActiveTab`, because the shell records the tab on
  settle.
- **Ordering.** It must ship in the same PR as, and after, 4e2. Until 4e2 wires
  the Thoth children into the app table, `/thoth/skills` matches nothing and
  falls back to chat.
- **Files.**
  - MODIFY `libs/frontend/core/src/lib/services/app-state.service.ts`
  - MODIFY `libs/frontend/core/src/lib/services/app-state.service.spec.ts`
    (existing tab tests around `:1161-1234`)

## Integration architecture

### Data flow: reload and restart restore (AC3, AC4)

1. **Write path, every settled navigation.**
   - The Router emits `NavigationEnd`.
   - `SurfaceRoutePersistence` calls
     `VSCodeService.setState('ptahRoute', { v:1, route, seed, panelId })`.
   - In VS Code, `vscode.setState` stores the record per webview.
   - In Electron, `set-state` IPC writes `webview-state` in workspace storage
     (`ipc-bridge.ts:533-543`).
2. **The webview unloads.** Causes: a VS Code reload, a hide without retain, a VS
   Code restart, or an Electron reload/restart.
3. **Host recreates the document.**
   - VS Code reload: the same HTML or a reload HTML, with `initialView` null or
     unchanged.
   - VS Code restart: the serializer adopts the panel and generates HTML with
     `initialView: null` and the `panelId` hint (Host contract).
   - Electron: a fresh renderer, `initialView: 'chat'`.
4. **Bootstrap.** `TabManagerService` loads tabs for `ptahConfig.panelId`
   (`tab-manager.service.ts:637-660`). The Router is idle
   (`withDisabledInitialNavigation`, `app.config.ts:177`).
5. **`App.handleInitialView`.**
   - Parse the restored state.
   - `resolveBootNavigation` chooses `route` (D5).
   - `SurfaceRoutePersistence.start(seed)`.
   - `navigateToUrl('/chat/<tabId>' | '/thoth/skills' | '/marketplace/servers/x' | …)`.
6. **The Router settles.**
   - `AppStateManager`'s effect stamps the bootstrap slice
     (`app-state.service.ts:556-578`), as today.
   - `ChatTabRouteSync` reaction 1 switches to `<tabId>` if it exists, or
     corrects the URL.
   - The Thoth shell seeds its tab from the child route.
   - Persistence writes the settled URL.
7. **`isReady`** → the shell renders. The chrome row is created only if the
   settled surface is chat (component 1).
8. **Electron only.** The first `workspace:switch` migrates the sentinel slice
   (`app-state.service.ts:911-926`) and requests the remembered surface's root.
   For chat, reaction 1 then completes `/chat/<active>` from the workspace's own
   restored active tab.

### Other properties

- **State and persistence ownership.**
  - The Router owns the live URL.
  - `TabManagerService` owns tabs and the active tab.
  - `AppStateManager` owns per-workspace surface and Thoth-tab memory, and the
    global marketplace page memory.
  - `vscode.setState['ptahRoute']` owns only the last settled URL, its seed and a
    panel hint, for the webview's lifetime and across restarts.
  - The chat chrome instance lives as long as `AppShellComponent`.
- **External boundaries.**
  - Restored state is untrusted input. It is validated by
    `parseWebviewRouteState` (shape) and `navigateToUrl` (grammar plus surface
    id).
  - Nothing builds a URL by string concatenation. Navigation uses
    `parseUrl`/`createUrlTree`, as `surface-router.service.ts:113-116` requires.
  - The host-side use of the same parser is specified in `## Host contract`.
- **Failure and rollback.** Every restore failure falls through to the
  `initialView` path, then to `chat`. Persistence failure never blocks
  navigation. Batch 3 has no data path to roll back.
- **Observability.** These use the existing `console.warn` channels, which e2e
  specs already grep for:
  - `[SurfaceRouterService] Navigation to … failed` (`surface-router.service.ts:160-163`);
  - a new `[App] Restored route … did not land: <result>`;
  - a new `[SurfaceRoutePersistence] setState failed`.
  - Canvas survival is observable through the `data-canvas-*` host attributes
    (component 3).

### Background work while the chrome is detached

The context requires this answer (`context.md:208-212`).

| Work | While detached | Mechanism |
| --- | --- | --- |
| Root streaming publication | paused | root `SURFACE_ACTIVE` = chat (`app.config.ts:146`); `batched-update.service.ts:42,53,135` |
| Transcript rAF, markdown parse, IntersectionObserver windowing | paused before detach | they observe `false` in the inactive pass (L2); Batch 2 consumers |
| Canvas ResizeObserver | delivers 0×0 or inactive entries, which are ignored | `canvas-layout.service.ts:90-96` |
| Gridstack geometry, latch reset, gesture cancel | observed in the inactive pass; re-measure once on return | `canvas-workspace-grid.component.ts:421-429,453-470`; `canvas-layout.service.ts:73-82` |
| Shell-row width observer | disconnected (query empties), reconnected on insert | A2; `app-shell.component.ts:425-429` |
| Component `effect`s inside the row (canvas request bridges, etc.) | paused until reinsert (A1) | FIFO bridges in `AppStateManager` keep requests |
| `PlanLimitsStore` scope of the chat view | still registered (no destroy) | `chat-view.component.ts:878-880`, unchanged from today |
| Root RPC handlers and stores (ChatStore, TabManager, StreamRouter) | running | Unchanged. They are not part of the view |

## Architecture-level quality requirements

- **Functional.**
  - AC7: across chat → any standalone → chat, the canvas component instance,
    its `CanvasStore` and its tile bindings are identical (3a-T9, 3b e2e).
  - AC3: after a reload with state, the settled URL equals the persisted URL when
    the URL is valid (4d-T1). That includes the `:tabId` when the tab exists.
  - AC4: covered with host H1. The surface is always restored. The tab is
    restored when the host honours the `panelId` hint.
  - An explicit new host deep link wins (4a-T3).
  - The Thoth tab is addressable, restorable, and switches without re-mounting
    the shell (4e-T2, T4).
- **Performance.**
  - On a standalone surface, the chrome contributes no DOM nodes and no
    change-detection passes (3a-T10).
  - Chunk count does not fall: `thoth` moves from `loadComponent` to
    `loadChildren` on the same library (AC6).
  - No timer is added. Each `RetainedViewDirective` holds at most one pending
    `afterNextRender`. DOM removal happens only in a `write` phase (3a-T14).
- **Security.**
  - Restored state is validated before use: length cap, `/`-rooted, no
    scheme/authority/backslash/control characters, and a known surface id.
  - The `panelId` hint is format-validated on both sides.
  - Nothing secret is persisted.
- **Maintainability.**
  - Route symbols in the app table come from eager libraries or through
    `loadChildren` (`context.md:279-282`).
  - The surface id list stays single (`SURFACE_ROUTE_IDS`).
  - `currentView` stays Router-derived. No optimistic mirrors (TASK_2026_317).
  - `ORCHESTRA_CANVAS_COMPONENT` stays the chat → canvas cycle break.
- **Testability.**
  - Every new unit has a focused spec.
  - The test route helper matches production's chat and thoth child shapes.
  - E2E asserts canvas survival on Linux CI.

## Test plan per sub-batch

- **3a**, `retained-view.directive.spec.ts`:
  - T1: nothing is created while the condition starts false.
  - T2: the first true creates and attaches the view.
  - T3: on true → false, the root is `display:none` before render. After render,
    its nodes are not in `document`. A signal change read in the retained
    template produces no DOM write.
  - T4: on false → true, the probe component constructor count stays 1, the
    provider instance is identical, the nodes are back, and the inline display
    is cleared.
  - T5: true → false → true within one tick (fence pending) never detaches.
  - T6: a host `viewChild` over an element in the view is `undefined` while
    detached and resolves after reinsert (A2).
  - T7: a probe view `effect` and an `afterRenderEffect` read `false` before
    detach. Then record whether a view effect runs while detached (pins A1).
  - T8: destroying the host destroys the probe exactly once. Destroying it while
    the fence or the detach stage is pending leaves no sequence that later
    touches the view.
  - T12 (latch before removal): the probe provides a `SURFACE_ACTIVE` signal
    tied to the host condition and carries an `afterRenderEffect` that mirrors
    `canvas-layout.service.ts:73-82`. When it reads `false`, it records
    `document.contains(probeRoot)`. Assert that the record is `true` (the latch
    saw inactive while the nodes were in the DOM) and that, after the next
    render, the nodes are gone.
  - T13 (rapid return, detach pending): flip true → false, let pass N run (fence
    has fired, detach registered), then flip back to true before pass N+1. Assert
    that the view is never detached, the nodes stay in `document`, and the
    constructor count stays 1.
  - T14 (phase legality): spy on `ViewContainerRef.detach` and record the
    `afterNextRender` spec that calls it. Assert that it is called only from a
    `write` hook, never from `read` or `earlyRead`.
- **3a**, `app-shell.retained-chrome.spec.ts`:
  - T9: with stub `ORCHESTRA_CANVAS_COMPONENT` carrying a component provider,
    chat → settings → chat keeps the same provider instance and one constructor
    call.
  - T10: on settings, `#shellRow` is absent from the DOM and the outlet wrapper
    is visible.
  - T11: with the initial surface `settings`, the stub canvas is not constructed
    until chat (P1c).
  - Existing `app-shell.*.spec.ts` and `electron-shell.*.spec.ts` must stay
    green unchanged.
- **3b:** e2e round-trip case in `canvas.spec.ts` (Linux CI). Existing
  `webview-routing.spec.ts` stays green.
- **4a**, `webview-route-state.spec.ts`:
  - valid record;
  - wrong `v`;
  - non-object;
  - `route` missing, not `/`-rooted, `//host`, `http:`, backslash, control
    character, or over 2048 characters;
  - `seed` too long;
  - `panelId` with an invalid character;
  - extra keys ignored.
- **4a**, `boot-navigation.spec.ts`:
  - T1: the override beats everything.
  - T2: no state → host value.
  - T3: host value ≠ seed → host wins.
  - T4: host value = seed → restore.
  - T5: host null → restore.
  - T6: Electron `'chat'` with seed `'chat'` → restore.
  - T7: seed carry-forward formula.
  - T8: no state and no host value → surface `undefined`.
- **4b:**
  - `surface-router.service.spec.ts`: `navigateToUrl` landed, already-there,
    unknown first segment, unparsable, and cancelled.
  - `surface-route-persistence.spec.ts`:
    - writes on `NavigationEnd`, with `urlAfterRedirects`;
    - no write when not connected;
    - `setState` throw → one warn and navigation unaffected;
    - double `start` writes once per navigation.
- **4c**, `chat-tab-route-sync.service.spec.ts`:
  - deep link to an existing tab → `switchTab`;
  - unknown or invalid id → URL corrected with `replaceUrl`;
  - `/chat` with an active tab → `/chat/<id>`;
  - a tab click → URL replaced, no history push (`MemoryPlatformLocation` length
    unchanged);
  - no loop (navigation count bounded);
  - pending navigation → no write;
  - workspace switch → URL follows the new active tab.
- **4c**, `webview-routing.spec.ts`: chat route shape, plus `/chat/<uuid>` keeps
  `currentView() === 'chat'` and the outlet empty.
- **4d:**
  - `app.spec.ts`: boot branches route / surface / fallback when the route does
    not land.
  - `webview-routing.spec.ts`:
    - a restore of `/settings` lands there;
    - a restore of `/apps` on VS Code lands on chat;
    - a setup-wizard fresh panel still lands on setup-wizard with state absent.
- **4e:**
  - `thoth.routes.spec.ts`:
    - T1: `/thoth/skills` activates the shell (A3);
    - T2: `/thoth` redirects to the memory value;
    - T3: `/thoth/bogus` → `/thoth/memory`;
    - T4: memory → skills reuses the shell instance.
  - `thoth-shell.component.spec.ts`:
    - `selectTab` navigates;
    - the tab is seeded from the snapshot on remount;
    - memory is written on settle only.
- **4e2**, `webview-routing.spec.ts`: thoth is `loadChildren` and resolves
  `THOTH_ROUTES`; it is absent from the `loadComponent` list; `/thoth/skills`
  lands with `currentView() === 'thoth'`. "declares exactly the surfaces in
  SURFACE_ROUTE_IDS" (`:534`) stays green.
- **4f**, `app-state.service.spec.ts`: `openSkillsDivergedClones` while already
  on `/thoth/memory` lands `/thoth/skills`. The request is consumed only for the
  raising workspace. It is gated by `canSwitchViews`.

## Verification commands (scoped; never workspace-wide; never build/serve/e2e locally)

One heavy check at a time. `--parallel=1`. For direct Jest, use
`--maxWorkers=2 --coverage=false`.

| Sub-batch | Command |
| --- | --- |
| 3a | `npx nx run-many -t test,lint,typecheck -p @ptah-extension/core @ptah-extension/chat --parallel=1` |
| 3b | `npx nx run-many -t test,lint,typecheck -p ptah-extension-webview --parallel=1`, then `npx nx run-many -t lint,typecheck -p ptah-electron-e2e --parallel=1` (e2e itself: Linux CI only) |
| 4a | `npx nx run-many -t test,lint,typecheck -p @ptah-extension/shared @ptah-extension/core --parallel=1` |
| 4b | `npx nx run-many -t test,lint,typecheck -p @ptah-extension/core --parallel=1` |
| 4c | `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1` |
| 4d | `npx nx run-many -t test,lint,typecheck -p ptah-extension-webview --parallel=1` (add `@ptah-extension/core` if `vscode.service.ts` changed) |
| 4e | `npx nx run-many -t test,lint,typecheck -p @ptah-extension/thoth-shell --parallel=1` |
| 4e2 | `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/webview-routing.spec.ts --coverage=false --maxWorkers=2`, then `npx nx run-many -t lint,typecheck -p ptah-extension-webview --parallel=1` |
| 4f | `npx nx run-many -t test,lint,typecheck -p @ptah-extension/core --parallel=1` |

- `@ptah-extension/shared` is consumed by Node hosts.
- After 4a, the host batch H1 runs its own scoped command (`host-restore-plan.md`).

## Host contract

This is the webview-side contract that `host-restore-plan.md` must meet.
The former reconciliation points (1 and 2) are now resolved in the host plan;
see R6.

- **State key.** `ptahRoute`, adopting the host plan's proposed name. It is one
  key inside the mergeable `vscode.setState` record (`vscode.service.ts:238-249`).
  Other keys (theme, layout, git-ui) are untouched.
- **Shape.** Defined once in `@ptah-extension/shared`:
  ```ts
  export const WEBVIEW_ROUTE_STATE_KEY = 'ptahRoute';
  export interface WebviewRouteState {
    readonly v: 1;
    /** Logical Angular URL as serialized by the Router: '/'-rooted, e.g.
     *  '/chat/550e8400-e29b-41d4-a716-446655440000', '/thoth/skills',
     *  '/marketplace/servers/smithery'. Max 2048 chars. Never a scheme,
     *  authority ('//'), backslash or control character. */
    readonly route: string;
    /** Raw host initialView this webview last consumed (D5); null if none.
     *  Max 64 chars. */
    readonly seed: string | null;
    /** ptahConfig.panelId at write time: '' (sidebar), 'electron-main',
     *  or 'ptah.panel.<uuid>'. Charset [A-Za-z0-9._-], max 128. A HINT. */
    readonly panelId: string;
  }
  export function parseWebviewRouteState(record: unknown): WebviewRouteState | null;
  ```
- **Webview writes.** One write after every settled navigation, including
  redirects and the corrective tab replaces. It writes only when the host bridge
  exists.
- **What the host passes back on restore (`deserializeWebviewPanel(panel, state)`).**
  1. **`initialView: null`. Required.** Do not derive a surface from `route`.
     - Under D5, any non-null value that differs from `seed` is treated as a new
       deep link. It would discard the `:tabId`/`:tab` sub-path.
     - **Reconciled.** `host-restore-plan.md` now omits the `initialView`
       option on deserialize, so `ptahConfig.initialView` is `null`
       (`host-restore-plan.md:28`), and its spec asserts it (`:30`). It no
       longer derives a fallback surface. The fallback lives inside the webview
       (D5, rule 4).
     - The host may use `route`'s first segment for the panel **title** only,
       via `parseWebviewRouteState` plus `isSurfaceRouteId`.
  2. **`panelId`.**
     - Reuse `state.ptahRoute.panelId` only if it matches
       `^ptah\.panel\.[0-9a-f-]{36}$` (UUID v4 per `TabId`/`crypto.randomUUID`)
       **and** no live panel holds it. Otherwise allocate a fresh one.
     - Reason: `TabManagerService` keys persisted tabs by `panelId`
       (`tab-manager.service.ts:371-380,637-660`). A fresh id restores the
       surface but not the tabs, so `/chat/<tabId>` degrades to `/chat`.
     - **Reconciled.** `host-restore-plan.md` adopts the validated-hint middle
       ground: reuse only after the shared parser, the stricter host regex and
       a live-ID collision check, and allocate a new ID otherwise
       (`host-restore-plan.md:54-55`; spec coverage `:30`). The id is never
       trusted unvalidated.
  3. **Do not modify the state record.** VS Code hands the same record back to
     the restored webview's `getState()`. The webview reads `route` and `seed`
     itself.
  4. Everything else is as for `createPanel`: options, HTML, message listener,
     queue, disposal. This is per the host plan.
- **Electron.** No host change is needed. `initialView` stays `'chat'`
  (`preload.ts:47`), and `seed` makes the restore win (D5). The risk that an
  asynchronous `set-state` races an immediate reload is accepted (R7).
- **Sidebar (`WebviewView`).** No serializer. `initialView` is absent, so restore
  applies (`angular-webview.provider.ts:78-81`).
- **The `ptah.setupWizard` panel.** Not serialized (host plan § Wizard boundary).
  Its in-panel reload still restores through the same key.

## Preserve list

Status values: stays / moves / proposed-removal.

| # | Capability today | Where | Status |
| --- | --- | --- | --- |
| P1a | Chat chrome, canvas and chat-view instances (and their component-scoped DI: `CanvasStore`, layout, persistence, metrics) survive navigation to any standalone surface | `app-shell.component.html:72`; `orchestra-canvas.component.ts:63-67` | **moves**: `*ptahRetainWhile` detach (D1) |
| P1b | Chrome is not visible while a standalone surface shows | `app-shell.component.html:72` | **moves**: detached (out of DOM and change detection) |
| P1c | Chrome (and canvas) are built eagerly at shell creation even when the first surface is standalone | `app-shell.component.html:72` | **proposed-removal**: built on first chat activation. It saves startup work on setup-wizard, analytics and settings-first panels, and Electron's launch surface is chat, so the 50-70 ms concern (`app.config.ts:229-236`) is unaffected. The implementer confirms with 3a-T11 |
| P1d | Sidebar width keeps its last measured value while hidden | `app-shell.component.ts:579-587` | **stays**: observer disconnects while detached and re-measures on insert |
| P1e | Activity-gated consumers see the inactive edge while hidden | Batch 2 and PR #638 consumers | **stays**: guaranteed by the inactive pass (L2) |
| P1f | Component effects in the chrome (canvas session/focus request bridges) run live while hidden | `orchestra-canvas.component.ts:366-423` | **moves**: they drain on return if A1 holds. The FIFO in `AppStateManager` preserves order. The behaviour is pinned by 3a-T7 |
| P1g | Electron sessions-divider drag adjusts the chat sidebar while a standalone surface shows | `electron-shell.component.ts:373-399` | **stays**: class-level signals |
| P1h | Focus inside the chrome is lost on leaving chat | n/a | **stays**: same as `display:none` |
| P2 | Outlet wrapper hidden on chat, so the outlet is never destroyed | `app-shell.component.html:66-68`; `app-shell.outlet-wrapper.spec.ts:67` | **stays**: an `@if` would destroy the outlet |
| P3 | Canvas pane vs chat pane toggled by `layoutMode`, both retained across toggles | `app-shell.component.html:782-783,811-812` | **stays**: an in-chat toggle that is already activity-gated. Detaching it would change Electron's `PlanLimitsStore` scope registration (`chat-view.component.ts:878-880`) and the canvas FIFO drain timing. It can be revisited with the same directive |
| P4 | Electron hides the header in grid mode | `app-shell.component.html:539` | **stays** |
| P5 | Thoth loaded lazily (formerly `@defer (on immediate)`, Batch 1 a lazy route) | `app.routes.ts:123-130` | **moves**: `loadChildren` → `THOTH_ROUTES`, same chunk |
| P6a | `ViewSlice.thothActiveTab` decides which tab shows | `thoth-shell.component.ts:296` | **moves**: the URL `/thoth/:tab` decides |
| P6b | The last Thoth tab is remembered per workspace and survives leaving Thoth | `app-state.service.ts:310-322,711-712,1069-1074` | **stays**: memory, written on settle and read by `restoreThothTab` |
| P6c | Thoth-tab memory migrates with the bootstrap slice and is dropped with a closed workspace | `app-state.service.ts:911-926`, `removeWorkspaceState` | **stays** |
| P6d | `openSkillsDivergedClones` opens Skills, even from another Thoth tab | `app-state.service.ts:1083-1088` | **moves**: `requestSurface('thoth', ['skills'])` (4f) |
| P6e | A tab switch does not re-mount the shell; it refreshes the status tiles | `thoth-shell.component.ts:303-307` | **stays**: same `:tab` route config is reused, and `refresh()` is kept |
| P6f | Thoth re-created against a new workspace on switch (remount) | `electron-shell.component.ts:436-447` | **stays**: the tab is seeded from the snapshot |
| P7 | `marketplaceActiveProvider` → page addressability and memory | already `MARKETPLACE_ROUTES` and `rememberMarketplaceRoute` (TASK_2026_533) | **stays**: untouched. It is restored via `ptahRoute` like any URL |
| P8 | Per-workspace surface memory and restore on a workspace switch | `app-state.service.ts:876-936` | **stays** |
| P9 | Host deep link lands with no chat flash (the setup-wizard launch surface) | `app.ts:131-149`; `app.config.ts:169-177` | **stays**: a fresh panel has no state, so the host wins (D5) |
| P10 | DevTools `window.initialView` override | `app.ts:132-137` | **stays**: highest precedence |
| P11 | Active tab restored after reload from `TabManagerService` localStorage | `tab-manager.service.ts:637-660` | **stays**: the URL is a projection |
| P12 | `SWITCH_VIEW` host command | `app-state.service.ts:355-379` | **stays** |

## Lane-introduced constraints

These rules were added by this plan; the task did not state them.

- **L1.** The chat chrome, and with it `OrchestraCanvasComponent`, is a single
  instance. It is never keyed by workspace, never duplicated, never routed.
  CanvasStore partitions workspaces internally.
- **L2.** A retained view is detached only after one change-detection and
  after-render pass in which `SURFACE_ACTIVE` is already `false`. It is hidden
  synchronously in that pass. The detach itself runs in the `write` phase of
  the following pass, never in `read` or `earlyRead`, and any return to `true`
  before then cancels it.
- **L3.** No routed surface is retained until three conditions hold. When they
  do, adopt a `RouteReuseStrategy` with these rules:
  - **Preconditions:**
    1. its mount-time work (loads, store attach, one-shot request consumption,
       window listeners) runs on `SURFACE_ACTIVE` edges instead;
    2. it is not a configuration surface;
    3. it owns no zero-size-sensitive observer without a gate.
  - **Rules for the strategy:**
    - key = route path + `normalizeWorkspaceRoot` captured at store time from the
      last settled navigation;
    - `destroyDetachedRouteHandle` on every eviction;
    - evict by workspace on `removeWorkspaceState`;
    - clear all handles when the hosting outlet is destroyed (Electron's two
      outlets).
- **L4.** A tab switch is a `replaceUrl` navigation. Surface changes push.
- **L5.** The persisted route state shape and parser live in
  `@ptah-extension/shared`. The webview and the host validate with the same
  function.
- **L6.** On restore, the host passes `initialView: null`. The `panelId` is a
  validated hint, never trusted blindly.
- **L7.** `TabManagerService` stays the owner of the active tab. The URL's
  `:tabId` is honoured only when it names an existing tab of the active
  workspace. Otherwise the URL is corrected, never the tabs.
- **L8.** Sub-state memory (Thoth tab) is written only after the Router settles,
  never ahead of a navigation (TASK_2026_317 rule).

## Risks

- **R1 (A1/A2).** Angular's handling of view effects and signal queries in a
  container-detached view is assumed, not cited. The design is robust either way
  (L2), but P1f's semantics depend on it. 3a-T6 and T7 pin it before 3a merges.
- **R2.** Lazy chrome creation (P1c) changes what exists at boot on
  standalone-first panels. Something root-level might implicitly depend on
  `ChatViewComponent` or the canvas being constructed. Mitigation: 3a-T11, plus
  the Electron shell specs. If it bites, construct eagerly but detached: create,
  insert, then run the L2 path.
- **R3.** Gridstack internal resize on a zero-size detached tree (A4). This is
  equal to today's `display:none`, but must be confirmed by the 3b e2e on Linux
  CI.
- **R4.** The spec helper (`surface-router-testing.ts`) diverges from production
  if 4c/4e change the route shapes without 4b's helper update. Ordering: 4b
  before 4c and 4e.
- **R5.** With D6, Back can re-activate the tab that was active when chat was
  left, if a host event changed the active tab while away.
- **R6. Resolved.** The host-plan disagreement on precedence and `panelId` is
  closed. `host-restore-plan.md` now passes `initialView: null` on deserialize
  (`host-restore-plan.md:28,30`) and reuses a persisted `panelId` only after it
  passes the shared parser, the stricter host regex and a live-panel collision
  check, allocating a fresh id otherwise (`host-restore-plan.md:54-55`). That
  matches Host contract points 1 and 2 and L6. No residual AC4 degradation is
  expected from the contract. The remaining AC4 dependency is H1 landing.
- **R7.** Electron `set-state` is asynchronous IPC. A reload within
  milliseconds of a navigation may restore the previous URL (`ipc-bridge.ts:533`;
  host plan, Findings). Accepted.
- **R8.** TASK_2026_492_0bcc may remap surface ids. Restored URLs from an older
  build that name a removed id fall back safely (`navigateToUrl` → `failed` →
  `initialView` path).
- **R9.** `webview-routing.spec.ts` is touched by 3b, 4c, 4d and 4e2. The edits
  are sequential, not parallel.

## Team-leader handoff

- **Recommended executors.** frontend-developer for every sub-batch (3a, 3b, 4a,
  4b, 4c, 4d, 4e, 4e2, 4f). They are all Angular webview or shared-contract code. The
  3b e2e case could go to senior-tester if preferred.
- **Complexity.** MEDIUM-HIGH. 3a is small in lines but sits on Angular view
  lifecycle semantics (R1). Batch 4 crosses five projects and one host contract.
- **Dependencies and ordering.**
  - PR A: 3a → 3b.
  - PR B:
    - 4a → 4b → 4c → 4e → 4e2 → 4d → 4f;
    - 4e2 depends on 4e (imports `THOTH_ROUTES` from the barrel) and must
      directly follow it in the same PR;
    - 4f depends on 4e2 (`/thoth/skills` must be routable);
    - 4c, 4e2 and 4d all edit `app.routes.ts` and/or `webview-routing.spec.ts`,
      so they are serialized (R9);
    - host H1 after 4a, because it imports the shared parser.
- **Parallel-safe work.** 4a can run in parallel with PR A. 4e (thoth-shell
  library only) is file-disjoint from 4c and may run in parallel with it. 4e2
  must wait for both 4c and 4e.
- **Files affected.**
  - CREATE:
    - `libs/frontend/core/src/lib/routing/retained-view.directive.ts`, `.spec.ts`
    - `libs/frontend/chat/src/lib/components/templates/app-shell.retained-chrome.spec.ts`
    - `libs/shared/src/lib/types/webview-route-state.ts`, `.spec.ts`
    - `libs/frontend/core/src/lib/routing/boot-navigation.ts`, `.spec.ts`
    - `libs/frontend/core/src/lib/routing/surface-route-persistence.ts`, `.spec.ts`
    - `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts`, `.spec.ts`
    - `libs/frontend/thoth-shell/src/lib/thoth.routes.ts`, `.spec.ts`
  - MODIFY:
    - `libs/frontend/core/src/lib/routing/index.ts`
    - `libs/frontend/chat/src/lib/components/templates/app-shell.component.{html,ts}`
    - `apps/ptah-extension-webview/src/app/{app.routes.ts,app.config.ts,app.ts,app.spec.ts,webview-routing.spec.ts}`
    - `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
    - `libs/shared/src/index.ts`
    - `libs/frontend/core/src/lib/routing/surface-router.service{,.spec}.ts`
    - `libs/frontend/core/src/testing/surface-router-testing.ts`
    - `libs/frontend/chat/src/index.ts`
    - `libs/frontend/thoth-shell/src/index.ts`
    - `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component{,.spec}.ts`
    - `libs/frontend/core/src/lib/services/app-state.service{,.spec}.ts`
    - optionally `libs/frontend/core/src/lib/services/vscode.service{,.spec}.ts`
  - REWRITE: none.
- **Verification points.**
  - Confirm A1–A4 via the named specs or reads before merging 3a, 4e and 3b.
  - Confirm that `RouterOutlet.detach` still maps to `location.detach()` at the
    installed version (`_router-chunk.mjs:1781`).
  - Confirm that `webview-routing.spec.ts` "declares exactly the surfaces in
    SURFACE_ROUTE_IDS" (`:534`) still passes. Top-level paths are unchanged.
  - Confirm the chunk count does not fall (AC6). This is a reasoning check only.
    The build is not run unless the user asks.
  - Run the scoped commands in the table above, one at a time.
