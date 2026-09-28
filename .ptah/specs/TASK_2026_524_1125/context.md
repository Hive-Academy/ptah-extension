# Context

## User intent

The application started as a VS Code extension. The Angular Router did not work
in the webview at that time, so navigation became a signal write and the
"never use Angular Router" rule was written into three files. Since then it has
stayed hard to design a proper page model, session history and a lazy-loading
mechanism. The question asked on 2026-09-22 was whether the current package set
and host setup can support routing now. They can.

## Evidence

Three read-only CLI lanes produced the reports in this task folder, on
2026-09-22:

- `host-constraints.md` (codex) — host feasibility per location strategy.
- `current-navigation.md` (claude cli) — the present navigation and session state.
- `package-capability.md` (antigravity) — installed packages, build and chunking.

Findings verified by hand afterwards:

1. `@angular/router` is a direct dependency at **22.1.7** (`package.json:98`).
   The installed stack is Angular 22.1.7, Nx 23.2.1, TypeScript 6.0.3,
   Electron 44.4.3. Every carrier and report written before commit `7917b193a`
   says Angular 21, Nx 22.6, TypeScript 5.9 and Electron 40, because the
   instruction files said so. Trust `package.json`, not the older prose.
2. `BrowserPlatformLocation.pushState` forwards straight to `history.pushState`
   with no guard (`node_modules/@angular/common/fesm2022/_platform_location-chunk.mjs:100-102`).
3. `withHashLocation()` is **not** an escape from the History API.
   `HashLocationStrategy.pushState` also calls `platformLocation.pushState`
   (`node_modules/@angular/common/fesm2022/_common_module-chunk.mjs:42-45`). It
   never assigns `location.hash`.
4. `PathLocationStrategy` fails in Electron. The renderer loads through
   `mainWindow.loadFile(...)` (`apps/ptah-electron/src/activation/post-window.ts:84-85`)
   with `<base href="./">`, and the HTML specification rejects a changed `file:`
   pathname.
5. A custom in-memory `PlatformLocation` works in both hosts by construction.
   `Location` forwards every state change to the injected platform location
   (`node_modules/@angular/common/fesm2022/_location-chunk.mjs:93,97`), and
   Angular's own `MockPlatformLocation` proves the seam. Do **not** import that
   testing class into product code.
6. The blocker in the repository is unproven. `WebviewErrorHandler`
   (`apps/ptah-extension-webview/src/app/app.config.ts:86-102`) is defensive
   code with no incident, test or exception behind it. The VS Code desktop host
   registers `vscode-webview` as a standard, secure scheme, so Chromium permits
   path and query rewrites there. Nobody has measured it, so treat a visible URL
   as unverified, not as available.
7. Lazy loading already works. `LazyViewService.resolveWhen` is trigger-gated
   for five surfaces, `thoth` uses a native `@defer` block, and the build emits
   17 chunk files. Both copy steps are recursive
   (`apps/ptah-extension-vscode/scripts/copy-webview.js:16-28`,
   `apps/ptah-electron/scripts/copy-renderer.js:48-71`), so route chunks ship
   with no packaging change.
8. Three allow-lists gate view names and they disagree.
   `App.handleInitialView` has 8 entries (`apps/ptah-extension-webview/src/app/app.ts:124-133`),
   `AppStateManager.handleMessage` has 13 (`libs/frontend/core/src/lib/services/app-state.service.ts:221-235`),
   and `ViewType` has 13, of which `command-builder` and `context-tree` have no
   render branch at all.
9. `TabId` is a persisted UUID v4 per workspace. It is already a valid URL
   segment. Nothing persists a URL: `getState`/`setState` never writes one, and
   no `registerWebviewPanelSerializer` call exists in the extension.

## Scope

1. A custom `PlatformLocation` provider in
   `apps/ptah-extension-webview/src/app/app.config.ts`. It holds a logical URL,
   a base, state and pop subscriptions. It touches `window.history` nowhere.
2. `provideRouter(routes, withComponentInputBinding(), withDisabledInitialNavigation())`.
   The first navigation is seeded from `window.ptahConfig.initialView`, so the
   host deep link and the Router do not race.
3. One route table for the standalone surfaces, replacing the
   `@switch (currentView())` block in `AppShellComponent` and the three
   allow-lists. Each surface keeps a stable route id. Resolve
   `command-builder` and `context-tree` — route them or delete them.
4. Route-level `loadComponent` replaces `LazyViewService.resolveWhen` and the
   five lazy-view DI tokens.
5. The logical URL is persisted through `vscode.setState` and restored in the
   boot path, so a reload returns to the same surface.
6. A `registerWebviewPanelSerializer` registration in
   `apps/ptah-extension-vscode`, so a VS Code restart restores the panel and its
   route.
7. The active `TabId` becomes a route parameter for the chat surface. Tab and
   session ownership stays in `TabManagerService`.
8. Update the one remaining place that states the old rule: the class doc block
   at `libs/frontend/core/src/lib/services/webview-navigation.service.ts:13-22`.
   It reads "CRITICAL: This service completely avoids Angular Router and History
   API which are incompatible with VS Code webviews due to security
   restrictions." The claim is false as written, and the service itself is
   deleted by this task. Two other copies of the rule lived in
   `libs/frontend/core/CLAUDE.md` and `apps/ptah-extension-webview/CLAUDE.md`;
   commit `7917b193a` deleted all 66 instruction files, so those copies are
   already gone. Do not recreate them.

9. Separate the three concerns that `currentView()` collapses today. See
   "Target architecture" below. The Router owns the addressed surface, a
   `computed` owns visibility, and an explicit activity contract owns liveness.
10. A `SURFACE_ACTIVE` signal token, provided per route, that every expensive
    consumer reads so a mounted-but-invisible surface can pause its work.
11. A workspace-keyed `RouteReuseStrategy`, so a retained surface leaves change
    detection and the DOM while keeping its instance and its component-scoped
    DI. This replaces the `[class.hidden]` pattern.

## Target architecture

### The pattern being replaced

`[class.hidden]` appears at two nesting levels in
`libs/frontend/chat/src/lib/components/templates/app-shell.component.html`:

- Line 135 hides the whole shared chrome when a standalone surface is active.
  The standalone surface renders on top through `@switch` (lines 18-131).
- Lines 687 and 712 keep the canvas grid and the single chat view **both**
  rendered, toggled by CSS.

The reason is component-scoped DI. `OrchestraCanvasComponent` declares
`providers: [CanvasStore, CanvasLayoutService, CanvasLayoutPersistenceService,
CanvasRenderMetricsService, …]` (`orchestra-canvas.component.ts:63-67`).
`@switch` and `@if` destroy, and destroying that component destroys the store,
the gridstack instance and the tile-to-session bindings. CSS hiding was the only
lever available.

### Why CSS hiding is the worst of the three options

A surface can be in one of three conditions, and they are not the same thing.

| Condition                  | In the DOM | In change detection | Instance and DI alive | State survives |
| -------------------------- | ---------- | ------------------- | --------------------- | -------------- |
| `@switch` case not matched | no         | no                  | no                    | no             |
| `[class.hidden]` (today)   | yes        | **yes**             | yes                   | yes            |
| Router detached view       | no         | **no**              | yes                   | yes            |

`display: none` removes a tree from layout and paint. It does not remove it from
Angular's view hierarchy. Under `OnPush` with signals, a hidden component is
still re-checked when its own signal dependencies change, and it still performs
its DOM writes. While the user reads Settings, a streaming transcript behind the
hidden chrome keeps ingesting `chat:chunk` events, re-rendering bubbles, and
running `marked` plus DOMPurify. The compositor discards every pixel.

Two further hazards, both specific to this application:

1. **Measurement returns zero in a hidden tree.** `getBoundingClientRect` gives
   zeros under `display: none`, so gridstack and Monaco must re-measure on
   unhide. This is the cause of tiles collapsing after a return from Settings.
2. **`IntersectionObserver` reports nothing while hidden.** The transcript uses
   observer-driven windowing and retention. Every slot reads as not
   intersecting for the whole hidden period, then a burst arrives on unhide.

### What the Router adds

The Router does not have to destroy anything. `RouteReuseStrategy` detaches a
view: it leaves the DOM and change detection, while the component instance, its
component-scoped injector and its signals stay alive. `CanvasStore` survives and
nothing is re-checked. That is better than `[class.hidden]` on both axes.

```ts
class PtahReuseStrategy extends BaseRouteReuseStrategy {
  private readonly held = new Map<string, DetachedRouteHandle>();
  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return route.data['retain'] === true;
  }
  // store / shouldAttach / retrieve keyed by this.key(route)
}
```

**The reuse key must include the normalized workspace root.**
`RouteReuseStrategy` is one app-wide service, and the naive key is the route
config. This application partitions view state per workspace path
(`app-state.service.ts:244-262`) and Electron keeps several roots open. Use
`normalizeWorkspaceRoot` from `@ptah-extension/shared`, the same key the boot
latch and the agent registry already use. Keyed by route alone, a workspace
switch re-attaches the previous workspace's canvas.

### The three collapsed concerns

`currentView()` answers three independent questions at once. That is why CSS
hiding was necessary: one lever, and `@switch` welds visibility to lifecycle.

| Question                   | Owner after this task         | Owner today           |
| -------------------------- | ----------------------------- | --------------------- |
| Which surface is addressed | the Router URL                | `currentView()`       |
| Which surface is visible   | a `computed` from the URL     | `currentView()`       |
| Which surface is alive     | an explicit activity contract | `@switch`, implicitly |

### The activity contract

Today a hidden component cannot know that it is hidden, which is why the cost is
unmanaged. Provide the knowledge:

```ts
export const SURFACE_ACTIVE = new InjectionToken<Signal<boolean>>('SURFACE_ACTIVE');

// per route
{ path: 'chat/:tabId', loadComponent: …, data: { retain: true },
  providers: [{ provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('chat') }] }
```

Consumers that must read it:

| Consumer                               | Behavior when not active                       |
| -------------------------------------- | ---------------------------------------------- |
| transcript rAF throttle                | stop scheduling frames                         |
| markdown render (`marked` + DOMPurify) | hold the raw text, parse on activation         |
| `IntersectionObserver` windowing       | disconnect, seed the mount set on activation   |
| gridstack                              | skip `layout()`, re-measure once on activation |
| `CanvasRenderMetricsService`           | already present — use it to measure the win    |

**A detached view receives no `ngOnDestroy`.** The Router stops change
detection, not background work. Timers, effects and RPC subscriptions keep
running unless a surface reads its own activity signal. The reuse strategy and
`SURFACE_ACTIVE` must therefore land together, or one silent cost is traded for
another.

### What the route table absorbs

| Today                                                                                                                 | After                                                    |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `@switch` with 9 near-identical `@case` blocks, each an `*ngComponentOutlet` plus a spinner `@else` (about 115 lines) | `<router-outlet />`                                      |
| 5 lazy-view DI tokens plus `LazyViewService.resolveWhen`                                                              | `loadComponent` per route                                |
| 3 disagreeing `initialView` allow-lists (8, 13 and 13 entries)                                                        | one route table                                          |
| `@defer (on immediate)` for `thoth`                                                                                   | a lazy route, like every other                           |
| `ViewSlice.thothActiveTab`, `marketplaceActiveProvider`                                                               | child routes, so sub-state is addressable and restorable |

Retention also becomes explicit. Today the policy is accidental: chat and canvas
are retained forever and every other surface is destroyed at once. With
`data: { retain: true }` plus an eviction rule in `store()`, the policy is
chosen — for example retain the chat surface and the two most recent others.

## Batch outline

The batches are ordered so that each one is reversible and measurable before the
next raises the risk. Do not reorder 2 and 3.

1. **Router foundation.** In-memory `PlatformLocation`, `provideRouter` with
   `withDisabledInitialNavigation()`, and a route table covering only the
   surfaces that `@switch` **already destroys**. Delete `LazyViewService`, the
   five lazy-view tokens and the three allow-lists. Keep `[class.hidden]` for
   chat and canvas untouched. Behavioral risk is near zero, because the routed
   surfaces have no state to lose.
2. **Activity contract.** Add `SURFACE_ACTIVE` and the five consumer branches.
   Keep `[class.hidden]`. Measure with `CanvasRenderMetricsService`. This batch
   captures most of the performance win on its own and is fully reversible.
3. **Detach.** Replace the CSS hiding with the workspace-keyed
   `RouteReuseStrategy`. Verify that `CanvasStore`, the gridstack layout and the
   tile-to-session bindings survive a navigation round trip.
4. **Addressable sub-state.** Child routes for the Thoth sub-tab and the
   Marketplace provider. Persist the logical URL through `vscode.setState`, and
   add `registerWebviewPanelSerializer`.

The first pull request carries **batch 1 only**. Batch 2 follows next, then 3
and 4, each in its own pull request. A reuse-strategy rewrite of a 719-line
shell in the same pull request as the route table would not be reviewable.

**Batch 1 must keep every route id in one exported constant.**
TASK_2026_492_0bcc will remap the surfaces into two navigation sets, so the
remap has to be a single edit. This is what makes it safe to run batch 1 and
that design specification at the same time: batch 1 replaces the _mechanism_
under today's ids, and 492 decides the _structure_ those ids take later.

## Out of scope

- A visible URL. Path and hash strategies stay unverified. If a visible URL is
  wanted later, run the probe named below first.
- Moving tab, conversation or session state into route parameters beyond the
  active `TabId`.
- The missing VS Code webview CSP. That is a separate defect, described below.
- Any change to `libs/web` or `apps/ptah-landing-page`, which already route.

## Constraints

- Do **not** route the chat and canvas content area. Its
  `[class.hidden]` always-mounted pattern is deliberate and protects
  `CanvasStore` from destruction
  (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:683-715`).
  A route outlet swap would destroy state that a rewrite then has to restore by
  hand.
- `MESSAGE_TYPES.SWITCH_VIEW` stays. The host still needs a way to command a
  view change from outside Angular. Only its receiver changes.
- Route guards and every symbol named in the route table live in
  `@ptah-extension/core`. `@nx/enforce-module-boundaries` forbids a static
  import out of a lazy library, and `apps/ptah-landing-page/src/app/app.routes.ts:82-87`
  documents the same trap.
- `ChangeDetectionStrategy.OnPush` stays mandatory. The webview shell keeps
  Zone. The Router behaves the same under Zone and zoneless.

## Relationship to TASK_2026_492_0bcc

TASK_2026_492_0bcc is a design specification and it writes no product code, so
this work is a sibling rather than part of it. The two meet at one point: 492
defines two navigation sets (code workspace and space) and the location of the
global configuration area. That is the shape of the route table.

Order: 492 first. If this task lands first against today's 13 `ViewType`
entries, the route table is cut twice. 492 should therefore give every surface a
stable addressable id, and this task should consume those ids rather than invent
its own. A cross-reference is recorded in `TASK_2026_492_0bcc/context.md`.

## Acceptance criteria

1. Navigation between every standalone surface works in the VS Code webview and
   in the Electron renderer, with no `SecurityError` and no `window.history`
   call. A test asserts that the provided `PlatformLocation` is the in-memory
   one.
2. `Router.navigate` back and forward work within one session.
3. A webview reload returns to the surface and chat tab that were active.
4. A VS Code restart restores the panel and its route.
5. One list of surface ids exists. The 8-entry and 13-entry allow-lists are
   gone, and `command-builder` and `context-tree` are either routed or deleted.
6. Deferred surfaces still load as separate chunks, and the chunk count does not
   fall. The canvas and the setup wizard stay eager for the reasons recorded in
   `app.config.ts:146-155`.
7. `CanvasStore` survives every navigation that does not leave the chat surface.
8. `nx run-many -t test lint typecheck` passes for every touched project. Never
   use `nx test projA projB`, which silently runs nothing.

## Risks

- **A route outlet destroys a component that used to stay mounted.** This is the
  main risk. Keep the always-mounted surfaces outside the outlet.
- **The setup wizard panel is a launch surface.** `ptah.setupAgents` opens a
  dedicated panel hardcoded to `initialView: 'setup-wizard'`
  (`libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts:153`).
  It must land on that route with no extra paint.
- **Initial navigation race.** Without `withDisabledInitialNavigation()` the
  Router resolves an empty URL before the host deep link is read.
- **Router state and `AppStateManager` state can disagree.** One owner only. The
  Router owns the surface, `AppStateManager` keeps what is not navigation.

## Open probe, if a visible URL is ever wanted

Inside a live VS Code panel, record `location.href`, `document.baseURI`, the
effective CSP and the origin. Then call `history.pushState` with a path and with
`#/route`. Repeat in Electron, comparing `<base href="./">` against a
document-preserving base. No lane could run this under a read-only scope.

## Separate defect found on the way

The VS Code webview ships with **no application CSP** on the normal path.
`WebviewHtmlGenerator` replaces the literal string `'<meta charset="utf-8">'`
(`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:137-140`),
but the document contains `<meta charset="utf-8" />`
(`apps/ptah-extension-webview/src/index.html:4`) and the build emits
`<meta charset="utf-8"/>`. The replacement can never match. The inline
theme-boot script at `src/index.html:50` carries no nonce and still runs, which
confirms no policy is enforced. VS Code logs `no-csp-found` and substitutes
nothing. `TASK_2026_491_e0da` did the Electron half of this work and is `done`.
This needs its own carrier. Repairing the match will make the nonce question
real for the lazy chunks, so the two halves must be fixed together.

## Resume point (status audit 2026-09-26)

Status: PARTIAL. Batches 1-2 of 4 are merged on main. No open branch.

Shipped:

- Batch 1 — PR #564 (`96e3a01d0`): `memory-platform-location.ts`, the route table in `apps/ptah-extension-webview/src/app/app.routes.ts`, `surface-routes.ts`, `surface-router.service.ts`. `LazyViewService` removed.
- Batch 2 — PR #574 (`11654e367`): `surface-active.ts` and `surface-active.directive.ts`. Canvas gating was taken back out in `f25e00228`.
- Marketplace child routes arrived through TASK_2026_524_mkpl.

Remaining targets:

- [ ] Batch 3 — `RouteReuseStrategy` replaces the `[class.hidden]` keep-mounted pattern. `app.routes.ts` and `app.config.ts` still mark it "batch 3".
- [ ] Batch 4 — Thoth sub-tab child routes (`thoth` is a flat route today).
- [ ] Batch 4 — persist the logical URL through `vscode.setState`.
- [ ] Batch 4 — `registerWebviewPanelSerializer`.
- [ ] Acceptance 3 and 4 (reload and restart restore surface and tab), and a dedicated check for acceptance 7 (`CanvasStore` survives navigation).
- [ ] Add `batches.md` and `test-report.md` for the remaining batches.
