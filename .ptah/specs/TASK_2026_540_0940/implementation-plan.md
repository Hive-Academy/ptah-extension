# Implementation Plan - TASK_2026_540_0940

## Revision 3 overrides (orchestrator, 2026-09-23) - BINDING, read first

Revision 2 below stands, EXCEPT where these overrides apply. Each override comes from the internal re-review
(`plan-review.md` section "Re-review (revision 2)", findings R2-1 to R2-6), which has the file:line evidence.
Where revision 2 text conflicts with this section, this section wins.

1. **Remount mechanism (R2-1) - replaces Decision 2 item 5 (the keyed `@for` around `ptah-app-shell`).**
   Do NOT key or re-create the `ptah-app-shell` host (it would destroy the component-scoped `CanvasStore` of the
   always-mounted `chat` surface and re-arm the app-shell auth redirect). Instead:
   - Keep `_configurationSurfaceRemountTick` in `AppStateManager`, bumped in the `switchWorkspace` stay-branch.
   - Add `remountActiveSurface()` to `SurfaceRouterService` (`libs/frontend/core/src/lib/routing/surface-router.service.ts`):
     `const ctx = inject(ChildrenOutletContexts).getContext(PRIMARY_OUTLET)`; if `ctx?.outlet?.isActivated && ctx.route`,
     keep `route = ctx.route` and `injector = ctx.injector`, call `ctx.outlet.deactivate()`, then
     `ctx.outlet.activateWith(route, injector)`; otherwise do nothing. No navigation, same URL, child contexts retained.
   - `ElectronShellComponent` has an effect that reads the tick, skips `0`, and calls `remountActiveSurface()` inside
     `untracked`. Never call it synchronously inside `switchWorkspace` (`workspaceInfo` is set only after the
     coordinator returns, `electron-layout.service.ts:486-503`).
   - `surface-router.service.ts` and `surface-router.service.spec.ts` join the core batch. Spec (use the
     `surface-router-testing.ts` harness): new component instance, same URL, no `NavigationStart`; plus a child-route
     variant (component-bearing parent with a child `<router-outlet>`).
   - Update meaning for Risks, Data flow and the TASK_2026_533 note: the remount is an outlet re-activation of the
     routed component only; the child-route URL is preserved.
2. **Batches (R2-2).** `batches.md` must be re-derived from this plan (revision 2 + these overrides) before any executor runs.
3. **Focus after remount (R2-4).** Move focus to the `tabindex="-1"` host only when `document.activeElement` is
   `document.body`, is disconnected, or was inside the re-created surface (record `host.contains(activeElement)` before
   the remount). Add `outline-none` to the host wrapper.
4. **activity-placement spec (R2-5).** No tab-count re-pin exists. Only extend the stub (`:86-92`) with
   `openConfigurationSurface`, `configurationSurfaceRemountTick`, and a writable-signal `hasWorkspaceFolders`.
5. **Finding 5 test (R2-6).** Pin the NON-configuration case as accepted behaviour (last workspace closed, then
   "Back to welcome" -> `chat` re-grants the owner and re-seeds the closed path's slice). Keep the configuration case
   as a second assertion.
6. **Smaller items.** Add `RouterOutlet` to `ElectronShellComponent` `imports` (branch 2 bare outlet); the gate spec
   keeps the real import or uses `provideRouter([])`. Optional: skip the `_configurationSurfaces` update when
   `openSurface` is unchanged. Pin "first folder opened while the bare outlet shows a surface" in the gate spec.

## Summary

Electron shell only. Three changes, one seam each:

1. **Menu.** One new `GlobalConfigMenuComponent` (chat lib) mounts in the Electron navbar's global-actions cluster, next to the theme toggle. It opens a `ptah-native-dropdown` listing Thoth, Setup hub, Marketplace, Settings, following the `background-agent-strip.component.ts:292-389` menu precedent, plus the arrow-key roving that precedent lacks.
2. **State.** `AppStateManager` gains one global, NOT workspace-partitioned `_configurationSurfaces` signal, on the `_layoutMode` precedent (`app-state.service.ts:292-302`). Its shape is `{ openSurface, perSurface }` — `perSurface` is the typed per-key slot structure TASK_2026_533 fills with `marketplaceRoute`. The constructor effect writes `openSurface` unconditionally, before the ownership check; slice stamping refuses the four configuration ids. A workspace switch while a configuration surface is open **stays on that surface**: no restore navigation, no slice stamp — and the surface component is **re-created** against the new workspace through `SurfaceRouterService.remountActiveSurface()` — the primary outlet deactivates and re-activates its stored route (Decision 1 + Decision 2, Revision 3 override 1) — so it shows fresh data at the same URL.
3. **Tab row.** The Electron tab row drops the four configuration tabs and renders Chat, [Apps slot reserved], Tasks, Tribunal, Analytics. Labels Chat and Analytics replace Canvas and Dashboard.

The pre-workspace render path is a three-branch gate in `electron-shell.component.ts`: welcome when no workspace is open AND no configuration surface is open; a **bare** `<router-outlet />` when no workspace is open and a configuration surface is open; the 3-panel area with `ptah-app-shell` when a workspace exists. `app-shell.component.ts/.html` change not at all. A small "Back to welcome" button in the same navbar cluster returns the workspace-less user to the welcome screen.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_540_0940/task-description.md` (APPROVED, 21 criteria; all citations below were re-verified against this worktree and match unless noted).
- Review used: `.ptah/specs/TASK_2026_540_0940/plan-review.md` (verdict APPROVE WITH FIXES, 11 findings; findings 1-3 MAJOR). All findings are folded into this revision — see the Revision log.
- User decisions used: two final decisions supplied with the revision brief — (1) the pre-workspace branch renders a bare outlet, not `ptah-app-shell`; (2) a workspace switch while a configuration surface is open keeps the surface on screen AND re-creates its component.
- Decisions used: `.ptah/specs/TASK_2026_540_0940/context.md` ("Conversation Summary": merge order 540→533, generic per-surface slot request, Marketplace header question).
- Design used: `.ptah/specs/TASK_2026_492_0bcc/design-spec.md:11-24, 37-49` (nav sets, mount policy — all four configuration surfaces "Stays mounted: No") and `:63-76` ("Focus ownership under retention" — the shell moves focus to the surface host, rendered with `tabindex="-1"`, after each navigation).
- Parallel task: `.ptah/specs/TASK_2026_533_marketplace_redesign/implementation-plan.md` D1 (`:91-127`) and D2 (`:129-164`) only.
- Corrections applied: none from the task-description; plan-review.md findings 1-11 applied as written (user decisions resolve findings 2 and 3).
- Missing decision-critical input: none. The pre-workspace render path and the switch-while-open behaviour are resolved (user decisions 1 and 2, Decisions 1-2 below).

Fixed constraints (not reopened): Electron only; no change to `webview-surface.types.ts`, route paths or eagerness; no `[class.hidden]` block, no `data: { retain: true }`, no RouteReuseStrategy (that slot is owned by TASK_2026_524 batch 3); the Marketplace menu item navigates to the bare `marketplace` root; the remount must not change VS Code visible behaviour; cross-lib imports only through package barrels; standalone/OnPush/signals/inject; Tailwind/daisyui tokens; no new CDK usage.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Tab row renders 8 tabs inside `@if (layout.hasWorkspaceFolders())`; four are configuration tabs | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:122-213` | The four tab buttons and their handlers (`:386-407`) move into the menu; the row keeps `role="tablist"`/`role="tab"`/`aria-selected` (criterion 13) |
| Global-actions cluster with theme toggle renders **above** the workspace gate, in a `no-drag` div | `electron-shell.component.ts:218-227`, gate at `:232`, `no-drag` CSS `:88-94` | The menu trigger mounts here: pre-workspace reachable (criterion 4) and macOS-click-safe (criterion 8) by construction |
| Router outlet lives in `AppShellComponent`, wrapped in a sizing box hidden on chat | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:47-49` (`[class.hidden]="!isStandaloneView()"`), chrome at `:53`, wrapper rationale at `:39-45` | 540 does NOT touch this file. Pre-workspace, a configuration surface renders through a bare outlet in `electron-shell.component.ts` instead; post-workspace it renders wherever `ptah-app-shell` renders |
| Router outlet lifecycle: `RouterOutlet.ngOnDestroy` → `onChildOutletDestroyed` clears `outlet`/`attachRef` but KEEPS `context.route`; a newly created outlet's `ngOnInit` → `initializeOutletWithName` re-activates the stored route via `activateWith(context.route, context.injector)` — new component instance, NO navigation, same URL | `node_modules/@angular/router/fesm2022/_router-chunk.mjs:1738-1743`, `:1747-1763`, `:1277-1283` | The remount mechanism (Decision 2): destroying and re-creating the outlet host re-creates the routed component at the same URL without a navigation and without RouteReuseStrategy |
| Router activation: `context.route = future` is stored even when no outlet exists in the DOM; `activateWith` runs only inside `if (context.outlet)` | `_router-chunk.mjs:2315-2318` | A navigation that lands while no outlet exists (pre-workspace, welcome branch) still succeeds; the outlet that appears later re-activates the stored route — this is the branch-1→branch-2 and branch-2→branch-3 flip |
| `isStandaloneView` derives from Router-derived `currentView` | `app-shell.component.ts:165-167` | No template change needed in `app-shell.component.html`; showing a config surface post-workspace hides the shared chrome automatically |
| `_layoutMode` is the precedent signal commented "Deliberately NOT workspace-partitioned" | `libs/frontend/core/src/lib/services/app-state.service.ts:292-302` | Criterion 14's template for the new signal, comment included |
| `_viewSlices` keyed by workspace path; `ViewSlice` carries `currentView` memory | `app-state.service.ts:214-229, 277-287` | The four configuration surfaces must never be stamped here (criterion 14) |
| The constructor effect stamps the settled surface; the ownership check (`_settlementOwner !== owner`) governs it | `app-state.service.ts:399-409` | This effect becomes the SINGLE global-write seam: the `openSurface` write goes first and unconditionally, the slice stamp stays ownership-gated (finding 1) |
| `recordSettledSurface` keeps its four drop guards and the owner re-grant (`:456`), then stamps the slice | `app-state.service.ts:442-458` | Slice-stamp + re-grant only. It needs NO global write: every landed navigation also runs the constructor effect, which is the single global writer |
| `openViewInActiveSlice` is the single slice-write funnel — used by the effect (`:407`), `recordSettledSurface` (`:457`) and the outgoing stamp in `switchWorkspace` (`:678`) | `app-state.service.ts:639-647` | ONE refusal guard here (early return for configuration ids) covers all three callers, including the outgoing stamp (finding 1; review instruction 1) |
| `switchWorkspace` stamps the outgoing slice, nulls `_settlementOwner`, migrates the bootstrap slice, then navigates to the new slice's remembered view | `app-state.service.ts:660-717` (stamp `:677-679`, owner `:683`, migration `:686-701`, restore `:714-716`) | The stay-branch goes here: condition on `isConfigurationSurface(this.currentView())` (Router truth), keep the migration verbatim, skip the restore, set the owner to `newPath`, bump the remount tick |
| `switchWorkspace`'s only production caller is `WorkspaceCoordinatorService` | `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:172` (verified by grep; every other hit is a spec) | The stay-branch and the remount tick are Electron-only by construction — the VS Code webview never calls `switchWorkspace`, so VS Code visible behaviour cannot change |
| `coordinateWorkspaceCleared` never calls `switchWorkspace` | `libs/frontend/core/src/lib/services/electron-layout.service.ts:371-380` (plan-review.md, verified) | Closing the last workspace leaves `_settlementOwner` null; the unconditional effect write is what keeps the menu honest then |
| `currentView` is a computed off `SurfaceRouterService.currentSurface()`; every service write funnels through `requestSurface`; `'already-there'` counts as landed | `app-state.service.ts:481-483, 419-428, 754-758`; `libs/frontend/core/src/lib/routing/surface-router.service.ts:44-48, 84-86, 114-141` | Entry points keep working unchanged (criterion 18); only the recording of a settlement changes |
| `canSwitchViews` gates every write (`!isLoading && isConnected`) | `app-state.service.ts:527-529` | Menu items inherit the same guard as the removed tabs |
| `SWITCH_VIEW` host wire goes `handleMessage → handleViewSwitch → requestSurface` | `app-state.service.ts:244-268, 810-814` | Host commands update the global state through the same seam (criterion 18) |
| Config-surface routes already exist, unchanged eagerness | `apps/ptah-extension-webview/src/app/app.routes.ts:80-85, 106-133` | No route edits at all (criterion 20) |
| NativeDropdown: `isOpen` input, `closed`/`opened` outputs, `panelRole` input, backdrop click-outside; **no keyboard handling** (only a `document:click` host listener); `opened` fires only after Floating UI positioning | `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts:118, 155-157, 162-168, 192-205, 223-228, 103` | Menu component owns all keyboard behaviour (criterion 6); `panelRole=null` for action buttons; unit specs must fire `opened` via `triggerEventHandler` (finding 11) |
| Menu precedent: `ptah-native-dropdown` with `[panelRole]="null"`, trigger `aria-expanded`+`aria-label`, `(opened)` focuses first item, panel `(keydown.escape)` closes and refocuses trigger; **no arrow keys** | `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:292-321, 516-534` | Copy this pattern verbatim, add arrow-key roving; on ITEM activation also close and refocus the trigger (finding 11 — panel destruction otherwise leaves focus on `body`) |
| `hasWorkspaceFolders` is `workspaceFolders().length > 0` | `libs/frontend/core/src/lib/services/electron-layout.service.ts:91-93` | The three-branch gate uses the existing signal; no new layout state |
| Center panel renders `<ptah-app-shell class="h-full w-full" />`; the component already runs an `effect()` in its constructor; the template uses no `viewChild` today | `electron-shell.component.ts:264`, `:343` | The focus-effect host wraps `:264`; the remount effect joins the existing constructor effect |
| Thoth renders its own `<h1>Thoth</h1>` | `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:84` | No header needed for Thoth |
| Setup hub renders its own `<h1>Setup Hub</h1>`; its non-config buttons call `setCurrentView('setup-wizard' \| 'harness-builder' \| 'tribunal')` | `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts:217, 1295-1305, 1316-1318` | No header needed for Setup hub; pre-workspace, those buttons land on a non-config surface → the gate returns to welcome while the Router stays on target (finding 6 — state as designed, gate test pins it) |
| Settings renders its own `<h1>Settings</h1>` | `libs/frontend/chat/src/lib/settings/settings.component.html:30` | No header needed for Settings |
| Marketplace hub has **no** `<h1>` or visible title | `libs/frontend/marketplace/src/lib/marketplace-hub.component.ts` (verified by grep) | Marketplace needs a header — answered YES for TASK_2026_533 (Decision 3) |
| `openViews` has no production consumer (a comment references it at `workspace-coordinator.service.ts:152`) | plan-review.md finding 10 (verified) | Removing config ids from `openViews` is low-blast-radius: nothing production reads it |
| Lucide icon imports in `electron-shell.component.ts`: `Settings` `:30`, `Wrench` `:37`, `Store` `:38`, `RadioTower` `:39`; unused icon fields at `:368-371` | `electron-shell.component.ts:28-42, 368-371` | Menu items reuse the verified imports; the trigger uses `SlidersHorizontal` — verified export of `lucide-angular` (`node_modules/lucide-angular/icons/lucide-icons.d.ts` exports `Menu` and `SlidersHorizontal`; re-exported through `public-api.d.ts`) — distinct from the Settings item glyph (finding 11) |
| Unit specs pin `'settings'` as a per-workspace fixture | `libs/frontend/core/src/lib/services/app-state.service.spec.ts:289-408, 542-651, 735-756, 808-813` (e.g. `:735-751` asserts A→B does not leak A's `'settings'`) | Re-pin those fixtures to still-partitioned ids (Decision 5) |
| E2e navigates by `switchView` messages, so `ui.goto` survives; but `ui-driver.ts:325-330` clicks the Canvas tab, and 11 showcase scenes click removed/renamed tabs; `chat-code-edit.scene.ts:179-181` carries `[title="Orchestra Canvas"]` | `apps/ptah-electron-e2e/src/support/ui-driver.ts:317-354`; scenes listed in Test plan | Selector updates are mechanical; scenes need a shared menu-click helper |
| Webview-e2e-harness navigates by injected `switchView` and asserts the tablist element, not tab names | `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts:368`, `activity-ticker.e2e.spec.ts:126` (selects `[role="tablist"].electron-tabs`) | Keep the `electron-tabs` class + `role="tablist"`; run the harness e2e to verify |
| `AppStateManager` and friends re-export through the services barrel | `libs/frontend/core/src/lib/services/index.ts:7` (`export * from './app-state.service'`) | New types exported from `app-state.service.ts` reach `@ptah-extension/core` consumers with no barrel edit |
| Nx project names | `libs/frontend/core/project.json` → `@ptah-extension/core`; `libs/frontend/chat/project.json` → `@ptah-extension/chat`; `apps/ptah-electron-e2e/project.json` → `ptah-electron-e2e` | Scoped verification commands per batch |

## Design decisions

### Decision 1 — Global configuration state, the write seam, and the stay-branch

**Chosen approach — state.**

Add to `app-state.service.ts` (exported through the existing barrel at `services/index.ts:7`):

```ts
export type ConfigurationSurfaceId = Extract<
  ViewType,
  'thoth' | 'setup-hub' | 'marketplace' | 'settings'
>;

export const CONFIGURATION_SURFACE_IDS: readonly ConfigurationSurfaceId[] = [
  'thoth', 'setup-hub', 'marketplace', 'settings',
];

export function isConfigurationSurface(
  view: ViewType,
): view is ConfigurationSurfaceId;

/**
 * Per-surface global slot, typed per key. 540 owns no surface-global state of
 * its own, so every member starts as an empty record. A task that needs state
 * which is global to the surface (not per-workspace) narrows its member with
 * its own interface. TASK_2026_533 narrows the marketplace member with
 * `marketplaceRoute: MarketplaceRoute | null` — a member narrowing, not a
 * reshape of this interface.
 */
export interface ConfigurationSurfaceSlots {
  /** Reserved; no 540-owned Thoth-global state. */
  readonly thoth: Readonly<Record<string, never>>;
  /** Reserved; no 540-owned Setup-hub-global state. */
  readonly 'setup-hub': Readonly<Record<string, never>>;
  /** TASK_2026_533 adds its marketplaceRoute here. */
  readonly marketplace: Readonly<Record<string, never>>;
  /** Reserved; no 540-owned Settings-global state. */
  readonly settings: Readonly<Record<string, never>>;
}

export interface ConfigurationSurfacesState {
  /** The configuration surface currently open, or null when none is. */
  readonly openSurface: ConfigurationSurfaceId | null;
  /** Extension point for surface-global state — see TASK_2026_533. */
  readonly perSurface: ConfigurationSurfaceSlots;
}
```

In `AppStateManager`, next to `_layoutMode` (`app-state.service.ts:302`), a private signal with a comment in the `_layoutMode` style (criterion 14 requires the explanatory comment):

```ts
/**
 * Deliberately NOT workspace-partitioned. The four configuration surfaces
 * (thoth, setup-hub, marketplace, settings) apply regardless of which
 * workspace is active, so their open state is one global fact — the same
 * reasoning as _layoutMode above. The constructor effect writes openSurface
 * unconditionally from the Router's surface; slice stamping refuses these
 * ids (see openViewInActiveSlice); switchWorkspace leaves them on screen
 * and bumps _configurationSurfaceRemountTick so the Electron shell
 * re-creates the routed component against the new workspace.
 */
private readonly _configurationSurfaces = signal<ConfigurationSurfacesState>({
  openSurface: null,
  perSurface: { thoth: {}, 'setup-hub': {}, marketplace: {}, settings: {} },
});
```

Public surface: `readonly configurationSurfaces = this._configurationSurfaces.asReadonly();` and a computed `readonly openConfigurationSurface = computed(() => this._configurationSurfaces().openSurface);`.

**No slot writer ships in 540.** The previous draft's untyped `updateConfigurationSurfaceSlot` is dropped (review finding 8): it has no caller in this task. TASK_2026_533 adds its own typed writer together with its first caller, so no dead API lands.

**Write seam (review finding 1).** One rule replaces the previous draft's `recordSettledView` routing method:

1. **The global write lives in the constructor effect, first and unconditionally** — before the ownership check:

```ts
effect(() => {
  const surface = this.surfaceRouter.currentSurface();
  untracked(() => {
    // Global write FIRST, UNCONDITIONALLY. openSurface tracks the surface
    // the Router shows even when no workspace owns the settlement (a switch
    // is in flight, or the last workspace was closed). The menu and the
    // Electron gate read this value; a stale value lies to both.
    this._configurationSurfaces.update((state) => ({
      ...state,
      openSurface: isConfigurationSurface(surface) ? surface : null,
    }));
    // Slice stamping stays ownership-gated, exactly as today.
    const owner = this._activeWorkspacePath();
    if (this._settlementOwner !== owner) return;
    this.openViewInActiveSlice(surface);
  });
});
```

   Why first: `_settlementOwner` is null from the start of a switch until the restore settles (`:683`, re-granted at `:456`) and after `removeWorkspaceState` (`:741-743`). An owner-gated global write leaves `openSurface` stale exactly then — the review's failure scenario: close the last workspace while Settings is open, then navigate from the harness; the menu would still highlight Settings while another surface shows. The effect is a root effect, so it flushes before the view refresh; the gate in Decision 2 flips in the same tick.

2. **`openViewInActiveSlice` refuses configuration ids** — the single slice-write funnel, one guard covering all three callers (effect `:407`, `recordSettledSurface` `:457`, outgoing stamp `:678`):

```ts
private openViewInActiveSlice(view: ViewType): void {
  // Slices never track the four configuration surfaces: they are global
  // (recorded in _configurationSurfaces), so a slice that received one would
  // leak a global surface into per-workspace memory. This guard also covers
  // the outgoing-workspace stamp in switchWorkspace.
  if (isConfigurationSurface(view)) return;
  this.updateActiveViewSlice((slice) => ({ /* existing body, unchanged */ }));
}
```

3. **`recordSettledSurface` (`:442-458`) keeps its guards and the owner re-grant (`:456`) and needs no other change**: its slice write goes through the refusing funnel. It performs NO global write — every landed navigation also changes `currentSurface()`, which runs the constructor effect, the single global writer. `'already-there'` (`surface-router.service.ts:44-48`) changes nothing and needs nothing: the surface was already current, and the effect already recorded it.

Because the effect is the single global writer and it is Router-derived, `openSurface` and the screen cannot disagree, and every existing entry point (`setCurrentView` `:754-758`, `handleViewSwitch` `:810-814`, `handleInitialData` `:799-808`, `openSettingsTab` `:1110-1114`, `openSkillsDivergedClones` `:835-840`, host `SWITCH_VIEW` `:258-268`, and direct `navigateToSurface` calls) updates the same global state (criteria 16, 18) with zero changes at the call sites.

**Workspace switch — the stay-branch (user decision 2).** In `switchWorkspace` (`:660-717`), branch on Router truth, not on the signal:

```ts
switchWorkspace(newPath: string): void {
  const previousPath = this._activeWorkspacePath();
  if (previousPath === newPath) return;                    // :662, unchanged

  // Router truth: this must match what is on screen.
  const staying = isConfigurationSurface(this.currentView());

  // :677-679, unchanged: the ownership-gated outgoing stamp. When a
  // configuration surface is on screen, openViewInActiveSlice refuses the
  // stamp, so the outgoing slice keeps the code-workspace surface the user
  // left before opening the configuration surface.
  if (this._settlementOwner === previousPath) {
    this.openViewInActiveSlice(this.currentView());
  }

  this._settlementOwner = staying ? newPath : null;        // :683, widened
  this._activeWorkspacePath.set(newPath);                  // :684, unchanged

  // …bootstrap-slice migration :686-701, verbatim…

  if (staying) {
    // Stay on the configuration surface: no restore navigation. Bump the
    // remount tick so the Electron shell re-creates the routed component
    // against the new workspace — same URL, new component instance
    // (Decision 2). The VS Code webview never reaches this branch.
    this._configurationSurfaceRemountTick.update((t) => t + 1);
    return;
  }

  this.requestSurface(                                     // :714-716, unchanged
    this._viewSlices().get(newPath)?.currentView ?? DEFAULT_SURFACE_ID,
  );
}
```

The new signal, next to `_configurationSurfaces`:

```ts
/**
 * Monotonic counter, deliberately NOT workspace-partitioned. Bumped once per
 * workspace switch that lands while a configuration surface stays on screen.
 * The Electron shell's effect on this value calls
 * SurfaceRouterService.remountActiveSurface(), which deactivates and
 * re-activates the primary outlet's stored route — only the routed component
 * is re-created, against the new workspace, at the same URL, with no
 * navigation.
 * Electron-only by construction: switchWorkspace's only production caller is
 * WorkspaceCoordinatorService (workspace-coordinator.service.ts:172), which
 * the Electron layout drives; the VS Code webview never switches workspaces,
 * so the tick stays at 0 there and no remount is triggered.
 */
private readonly _configurationSurfaceRemountTick = signal(0);
readonly configurationSurfaceRemountTick =
  this._configurationSurfaceRemountTick.asReadonly();
```

`_settlementOwner = newPath` in the stay-branch replaces the null-then-regrant sequence (`:683` + `:456`) because no navigation settles there; leaving the owner null would make the constructor effect drop legitimate slice stamps for later external navigations (`Location.back()`).

**What the user sees after a switch while a configuration surface is open.** The surface stays on screen and its component is re-created against the new workspace (Decision 2's outlet remount, Revision 3 override 1). The workspace sidebar switches to the new workspace; no tab in the row is active; the menu trigger keeps its active indication. Config-surface BACK buttons still go to chat (`settings.component.ts:182`, `thoth-shell.component.ts:273`, marketplace hub `:159` — finding 7), and the new workspace's remembered surface is served only when a later switch lands on B through the restore at `:714-716` (finding 7). Tab clicks navigate to the clicked surface through the ordinary path.

**Rationale.** Criterion 15 requires the global state to read the same before and after a switch. Nothing navigates in the stay-branch, so the effect does not re-run, so `openSurface` is identical by construction — and now the visible surface and its data match the new workspace too, which is what user decision 2 adds. The outgoing slice stays honest: it keeps the code-workspace surface the user was on before opening the configuration surface.

**Rejected alternatives.**

- *Owner-gated global write (previous draft).* Rejected: review finding 1's failure scenario — the owner is null exactly when the most surprising switches and closes happen, and the menu then lies.
- *A `recordSettledView` routing method called from both settlement sites (previous draft).* Rejected: two global writers (effect + method) can disagree under `'already-there'`; one effect is the single writer.
- *Restore-navigate on switch, keep the global signal as a sticky "last opened" memory.* Rejected: `openSurface` would then mean two things, and the menu would highlight a surface that is not on screen.
- *Derive `openSurface` as a computed off `currentView`.* Rejected: a workspace switch that restore-navigates to `chat` would flip the derived value, failing criterion 15 by construction, and there would be no place for 533's per-surface slots.
- *Keep the surface mounted with stale per-workspace data (review finding 3's original audit).* Rejected by user decision 2: the surface must show fresh data for the new workspace.
- *Un-partition `thothActiveTab`/`marketplaceActiveProvider` too.* Rejected: installed content is per-workspace (`app-state.service.ts:517-524`), scope item 3 covers only the open state, and criterion 17 pins the other partitioned behaviour. 533's D2 keeps `marketplaceRoute` slice-based on its own branch; if it moves it to the global slot on rebase, the typed marketplace member absorbs it without reshaping.

**Effect on existing code.** `openViews` no longer lists the four configuration surfaces — a direct consequence of criterion 14; `openViews` has no production consumer (comment only at `workspace-coordinator.service.ts:152`), so VS Code is untouched (criterion 19's entry points at `app-shell.component.ts:336-364` keep working). `closeView` (`:761-775`) needs no change: config ids never enter `openViews`, and its fallback still navigates to chat if ever hit. `removeWorkspaceState` (`:725-744`) unchanged. `setCurrentView` (`:754-758`) is byte-identical.

### Decision 2 — Pre-workspace render path, the surface remount, and focus

All edits in `electron-shell.component.ts` only. `app-shell.component.ts/.html` change nothing (user decision 1).

**1. Three-branch gate.** Replace the two-branch gate at `:232`:

```
@if (!layout.hasWorkspaceFolders() && appState.openConfigurationSurface() === null) {
  <ptah-electron-welcome class="flex-1" />
} @else if (!layout.hasWorkspaceFolders()) {
  <!-- No workspace and a configuration surface is open. Render the routed
       surface through a BARE primary outlet — not ptah-app-shell, whose
       canvas hydration and auth-redirect effects assume a workspace. The
       branches are mutually exclusive, so exactly one primary outlet
       exists at any time. A navigation that lands while the welcome branch
       (no outlet) is showing is stored by the Router and re-activated when
       this outlet appears. -->
  <div class="h-full w-full"><router-outlet /></div>
} @else {
  <!-- A workspace exists: the 3-panel area, unchanged. -->
  …existing area…
}
```

- Branch 1 needs no `[class.hidden]` or extra gates: it shows only when no workspace exists AND no configuration surface is open.
- Branch 2 is reached only when a configuration surface is open, so the bare outlet always has a route to show. This is why the previous draft's four inner `hasWorkspaceFolders()` extensions to the sidebar/resize-handle/editor-panel/git-dock blocks are no longer needed: the 3-panel area renders only when a workspace exists.
- Add `RouterOutlet` to the component's `imports` array (`:63-73`; the file imports no `@angular/router` symbol today — `NgComponentOutlet` at `:27` is `@angular/common`).

**2. First folder opens while a configuration surface is shown.** The gate flips from branch 2 to branch 3: the bare outlet is destroyed, and `ptah-app-shell` (in the center-panel host below) is created. The destroyed outlet's stored route survives (`_router-chunk.mjs:1277-1283`), and the new outlet inside `ptah-app-shell` re-activates it — same URL, fresh component (`:1747-1763`). If `switchWorkspace` runs for that first folder and the surface is a configuration surface, the stay-branch bumps the remount tick; the bump is harmless — the branch flip already re-created the area, and at most the effect's remount re-activates the new outlet's stored route once more (churn, not breakage).

**3. Closing the last workspace while a configuration surface is shown.** `coordinateWorkspaceCleared` never calls `switchWorkspace` (`electron-layout.service.ts:371-380`), so only `hasWorkspaceFolders()` flips: branch 3 → branch 2. The bare outlet re-creates and re-activates the stored route — the surface stays on screen; the "Back to welcome" button shows; `openSurface` is untouched (the effect writes it unconditionally, Decision 1).

**4. Return to welcome (criterion 5).** A small icon button in the same global-actions cluster (`:223-227`), rendered only when `!layout.hasWorkspaceFolders() && appState.openConfigurationSurface() !== null`, labelled "Back to welcome" (`aria-label`), calling `appState.setCurrentView('chat')`. The chat settlement makes the effect write `openSurface = null`, the gate flips to branch 1, and the welcome screen shows again. The button sits inside the existing `no-drag` div, so it shares the menu's macOS safety (criterion 8's mechanism).

**5. Remount of the open configuration surface (user decision 2; the keyed `@for` host originally specified here is superseded by Revision 3 overrides, override 1).** What shipped: the center-panel `ptah-app-shell` stays UN-KEYED, inside a `tabindex="-1"` `outline-none` host (`#configurationSurfaceHost`, `data-test="configuration-surface-host"`, read through a `viewChild` signal), and `ElectronShellComponent`'s constructor effect on `appState.configurationSurfaceRemountTick()` (`electron-shell.component.ts:331-353`) calls `SurfaceRouterService.remountActiveSurface()` inside `untracked`. The effect holds `lastHandledTick` from construction (a non-zero tick already present at construction triggers nothing), reacts only to a tick change (never to `0`), and first returns while `surfaceRouter.pendingSurface()` is non-null — a navigation in flight means this tick's remount is SKIPPED, not deferred. `remountActiveSurface()` (`libs/frontend/core/src/lib/routing/surface-router.service.ts:165-173`) reads the primary outlet's context; when the outlet is activated and a route is stored it captures `route` and `injector` BEFORE `ctx.outlet.deactivate()`, then calls `ctx.outlet.activateWith(route, injector)` — **a new routed-component instance at the same URL, with no navigation**, child outlets re-activating from their retained contexts. With no outlet or none activated (the component-less `chat` route) it is a no-op. No RouteReuseStrategy, no `[class.hidden]`, no `retain: true`. Only the routed component is re-created — the always-mounted `chat` surface's component-scoped `CanvasStore` survives and the app-shell auth redirect is not re-armed (override 1's rationale).

- Marketplace child routes (TASK_2026_533): the re-activated stored route is the whole activated tree, child outlets included. The URL and Router state are untouched, so the remount lands on the same child-route URL.
- The remount re-creates the routed surface component only, so it re-reads workspace state against the NEW workspace — which is what user decision 2 asks for.
- VS Code invisible by construction: the tick is written only in `switchWorkspace`'s stay-branch (only production caller `workspace-coordinator.service.ts:172`, Electron-driven) and consumed only by `ElectronShellComponent`, which the VS Code webview never mounts. No shared code path can observe it.

**6. Focus after the remount (superseded by Revision 3 overrides, override 3 — focus is conditional).** Per "Focus ownership" (`design-spec.md:63-76`) the host keeps `tabindex="-1"` plus `outline-none`, so it takes focus without entering the tab order. In the shipped effect (`electron-shell.component.ts:331-353`): after the `pendingSurface()` check, the shell records `document.activeElement` and whether that element was inside the host BEFORE calling `remountActiveSurface()`, and registers `afterNextRender` to focus the (re-read) host ONLY when the pre-remount focus was `document.body`, was disconnected, or was inside the host. A live control outside the host keeps its focus.

**Rejected alternatives for the remount mechanism** (user decision 2 required an evaluation of at least three; these evaluated the keyed-host design, which Revision 3 override 1 then replaced with the outlet remount):

- *Key `app-shell`'s outlet wrapper instead (`app-shell.component.html:47-49`).* Rejected: a shared-file change, which user decision 1 forbids — the pre-workspace path must not force `AppShellComponent` edits, and this one would too.
- *Key on `activeWorkspacePath` while a configuration surface is open* (e.g. a computed `openSurface ? path : 'static'`). Rejected: the key changes on every configuration-surface OPEN as well as on every switch — `openSurface` flips on every menu navigation — so the canvas would be destroyed each time the user opens Settings or Marketplace, not just on workspace switches. The monotonic tick changes only at switch-while-open moments.
- *Navigate away and back.* Rejected: the "away" step clears `openSurface` (Decision 1's effect), which flips the gate to the welcome branch — a transient wrong surface flashes pre-workspace. And the "back" step can only target the bare `marketplace` root, not the same child-route URL TASK_2026_533 lands on.
- *Router-native remount: `onSameUrlNavigation: 'reload'`.* Rejected: it re-runs guards and resolvers but the default reuse strategy keeps the component instance; a true remount requires a custom `RouteReuseStrategy`, which TASK_2026_524 batch 3 owns and this task must not add.

**Rationale.** The three-branch gate gives the pre-workspace path one outlet of its own, so `AppShellComponent` — canvas hydration, auth redirect, construction order — never mounts without a workspace (the previous draft's assumption A1 is gone by construction). The outlet remount is Router-native (public `RouterOutlet` API), Electron-only, and lands on the same URL for every route shape, including 533's child routes.

### Decision 3 — Active-surface indication

**Chosen approach.** Yes — the menu indicates the active surface, and no 540-owned headers are added:

- The trigger gets a highlighted state when `openConfigurationSurface() !== null` (e.g. `text-primary`/`bg-base-300` Tailwind/daisyui tokens), so the icon button itself signals "a configuration surface is open".
- The open surface's menu item gets `aria-current="true"` plus a visual highlight class.

**Per-surface header answers (verified by grep):**

| Surface | Own visible title | Header needed in 540? |
| --- | --- | --- |
| Thoth | `<h1>Thoth</h1>` — `thoth-shell.component.ts:84` | No |
| Setup hub | `<h1>Setup Hub</h1>` — `setup-hub.component.ts:217` | No |
| Settings | `<h1>Settings</h1>` — `settings.component.html:30` | No |
| Marketplace | none found in `marketplace-hub.component.ts` | **Yes — TASK_2026_533 must render its breadcrumb header in Electron. Clear answer: YES.** |

540 does not add a Marketplace header (533's `MarketplaceShellComponent` owns the surface chrome and lands second); until 533 lands, the menu trigger highlight plus the item's `aria-current` are the indication, which is what criterion 6's ARIA requirement asks for.

### Decision 4 — Keyboard and ARIA contract

`ptah-native-dropdown` has no keyboard handling (verified: its only host listener is `document:click`, `native-dropdown.component.ts:103`). The menu component therefore owns the full contract, following the `background-agent-strip.component.ts:292-321, 516-534` precedent and adding two pieces:

- **Trigger**: `<button type="button" trigger>` — natively focusable; Enter and Space open it via its `(click)` toggle (criterion 6). `[attr.aria-expanded]` bound to the open signal; `[attr.aria-label]="'Configuration'"` (accessible name, criterion 6; precedent `:306-307`). Icon `SlidersHorizontal` (verified lucide-angular export, distinct from the Settings item's gear — finding 11), `aria-hidden="true"`.
- **Panel**: `panelRole` passed `null` — a panel of action buttons, per the component's own doc (`native-dropdown.component.ts:152-157`). `(keydown.escape)` on the panel content closes and refocuses the trigger (precedent `:321` + `:520-523`). `(opened)` focuses the first item (precedent `:298` + `:532-534`) — `opened` fires only after Floating UI positioning (`:192-205`), so the focus call is correctly timed; unit specs must fire it with `DebugElement.triggerEventHandler('opened')` because a plain click does not reach it (finding 11).
- **Arrow keys (added by this component)**: `(keydown.arrowdown)` / `(keydown.arrowup)` on the panel container move DOM focus between the four item buttons (`preventDefault()`, wrap at both ends). Buttons are natively focusable and Enter-activatable, which satisfies criterion 6's "Enter shall activate the focused item" without extra code.
- **Closing**: item click → close + navigate + **refocus the trigger** (finding 11: destroying the panel otherwise leaves focus on `body`); backdrop click → `closed` output; Escape → panel handler. All three wire the `closed` output to the open signal (criterion 7).
- **Active item**: `[attr.aria-current]="openConfigurationSurface() === item.id ? 'true' : null"` (Decision 3).

### Decision 5 — Spec fixtures and e2e selectors

**Unit fixtures.** `app-state.service.spec.ts` uses `'settings'` (and once `'thoth'`/`'marketplace'`, `:919-928`) as the per-workspace fixture. Every partitioned-behaviour assertion that uses a configuration id must be re-pinned to a still-partitioned id (`'analytics'`, `'tasks'`, `'tribunal'`), keeping the assertion's meaning: `:289-308` (stamp + restore), `:328-370` (ownership family), `:542-549` (slice fixture literal `currentView: 'settings'`), `:636-651` (openViews content), `:735-756` (A→B→A ownership, the requirement's named example), `:808-813` (openViews exclusion). `:227-232` (a list containing the four ids) stays valid — the ids still exist as surfaces. `:919-928` exercises `closeView` on `thoth`/`marketplace`: with config ids no longer entering `openViews`, re-pin to `'tribunal'`/`'tasks'` or assert the new no-op-then-chat-fallback behaviour explicitly.

**E2e selectors** (all in `apps/ptah-electron-e2e`):

| File:line | Today | Change |
| --- | --- | --- |
| `support/ui-driver.ts:325-330` | `getByRole('tab', { name: 'Canvas' })` / `[title="Orchestra Canvas"]` | Rename to the Chat tab (`name: 'Chat'`, `[title="Chat"]`) — the switchView push already lands the surface; the click is belt-and-braces |
| `showcase/_harness/prewarm.ts:29-48, 56-73, 81-106` | Tab-restore by `title`; `activeNavTitle` returns null for configuration surfaces (`:32-39`) | Add a menu-based helper (open trigger, click item, close) and route the four configuration surfaces through it; the helper RESTORES the originating configuration surface through the menu, because `activeNavTitle` cannot; tab-title restore keeps working for the four remaining tabs; keep the silent/guarded prewarm rules (`:15-25`) |
| Scenes clicking removed tabs: `thoth-tour.scene.ts:107`, `skills-tour.scene.ts:68`, `gateway-tour.scene.ts:86`, `cron-tour.scene.ts:64`, `memory-recall.scene.ts:63`, `setup-wizard-tour.scene.ts:49`, `settings-tour.scene.ts:85`, `marketplace-tour.scene.ts:97` | `getByRole('tab', { name: … })` | Navigate via the shared menu helper |
| Scenes clicking renamed tabs: `canvas-orchestra.scene.ts:44`, `chat-code-edit.scene.ts:179-181` (Canvas→Chat; `[title="Orchestra Canvas"]`), `dashboard-tour.scene.ts:53` (Dashboard→Analytics) | tab names | Rename |
| `tribunal-tour.scene.ts:48` | Tribunal tab | Unchanged — tab remains |

The menu component ships `data-test="config-menu-trigger"` and `data-test="config-menu-item-<surface-id>"` so e2e never depends on labels (repo convention: `data-test`, e.g. `background-agent-strip.component.ts:305,327`).

`libs/frontend/webview-e2e-harness`: no change expected — `skills-lane-pickers.e2e.spec.ts:368` injects `switchView` and `activity-ticker.e2e.spec.ts:126` asserts `[role="tablist"].electron-tabs` (still present with four tabs). Keep the `electron-tabs` class + `role="tablist"`. Verify by running `npx nx run @ptah-extension/webview-e2e-harness:e2e` (boot-progress and activity-ticker scenarios both mount `ElectronShellComponent`).

## Component specifications

### 1. GlobalConfigMenuComponent (CREATE)

- Purpose: the global configuration menu — trigger, dropdown, four items, keyboard contract, active indication.
- Responsibilities: open/close state; item selection (navigate + Thoth first-run dismissal + close + refocus trigger); arrow-key roving; Escape/backdrop close with focus return; active-surface highlight and `aria-current`. Item selection calls `appState.setCurrentView(id)` — no other method — so the no-op rule TASK_2026_533 adds to `setCurrentView` in its Batch 18 will apply to menu clicks; the Thoth first-run dismissal (`app-state.service.ts:873`, the `electron-shell.component.ts:394-399` behaviour) runs BEFORE that call, so the rule cannot block it (see Extension points).
- Verified contracts: `NativeDropdownComponent` inputs/outputs (`native-dropdown.component.ts:118, 155-157, 162-168, 192-205, 223-228`); `AppStateManager.setCurrentView` (`app-state.service.ts:754-758`); `openConfigurationSurface` (new, Decision 1); `thothFirstRunDismissed`/`dismissThothFirstRun` (`app-state.service.ts:526`); menu precedent (`background-agent-strip.component.ts:292-321, 516-534`).
- Dependencies: `@ptah-extension/core` (AppStateManager), `@ptah-extension/ui` (NativeDropdownComponent via barrel `libs/frontend/ui/src/index.ts:32`), `lucide-angular` icons. Direction: chat → core/ui, the same direction `electron-shell.component.ts:43-56` already uses. No chat-ui import (keeps the smart/dumb split: this is a smart component in `chat`).
- Items (order, criterion 1): Thoth (`thoth`, title "Thoth — agentic platform"), Setup hub (`setup-hub`), Marketplace (`marketplace`), Settings (`settings`). Icons: reuse the verified lucide imports `RadioTower`, `Wrench`, `Store`, `Settings` (`electron-shell.component.ts:30, 37-39`); trigger icon `SlidersHorizontal` (verified `lucide-angular` export — distinct glyph from the Settings item, finding 11).
- Failure behaviour: `setCurrentView` no-ops while `canSwitchViews()` is false (`app-state.service.ts:527-529, 754-758`) — the menu closes and nothing navigates, exactly like the removed tabs; a failed lazy chunk leaves `openSurface` unchanged (the settlement effect never runs, Decision 1), so the menu keeps indicating the previous truth.
- Verification seam: component spec (open/close, keyboard, aria, navigation calls, first-run dismissal, focus return on all close paths); e2e via the `data-test` hooks.
- Files: CREATE `libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.ts`, CREATE `libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.spec.ts`.

### 2. AppStateManager global configuration state (MODIFY)

- Purpose: the one global store for the four configuration surfaces, the single write seam, the stay-branch and the remount tick (Decision 1 in full).
- Responsibilities: types + `CONFIGURATION_SURFACE_IDS` + `isConfigurationSurface`; typed `ConfigurationSurfaceSlots`; `_configurationSurfaces` signal with precedent comment; `configurationSurfaces`/`openConfigurationSurface` readonly exports; the constructor effect's unconditional global write before the ownership check; `openViewInActiveSlice`'s configuration-id refusal; `switchWorkspace` stay-branch + `_configurationSurfaceRemountTick` + `configurationSurfaceRemountTick` readonly export. NO slot writer (533 adds its own typed writer with its first caller).
- Verified contracts: every line cited in the evidence table for `app-state.service.ts`.
- Failure behaviour: unchanged guards (`canSwitchViews`, generation, ownership) — a dropped settlement changes neither the slices nor the global signal; the stay-branch transfers ownership synchronously so no settlement re-grant is needed.
- Verification seam: `app-state.service.spec.ts` (Decision 5 re-pins + the new cases in the Test plan).
- Files: MODIFY `libs/frontend/core/src/lib/services/app-state.service.ts`, MODIFY `libs/frontend/core/src/lib/services/app-state.service.spec.ts`.

### 3. ElectronShellComponent (MODIFY)

- Purpose: mount the menu; apply the code-workspace tab set; the three-branch gate with the bare pre-workspace outlet; the remount effect and conditional post-remount focus; back-to-welcome.
- Responsibilities: remove the four configuration tab buttons (`:146-156, 179-211`) and handlers `openThoth/openSetupHub/openMarketplace/openSettings` (`:386-407`); relabel Canvas→Chat (title "Chat") and Dashboard→Analytics (title "Analytics"); order Chat, `<!-- Apps tab (TASK_2026_494) renders between Chat and Tasks -->`, Tasks, Tribunal, Analytics; keep `onCanvasTab` (`:381-384`), `openDashboard`, `openTribunal`, `openTasks` unchanged (criteria 11, 12); keep `role="tablist"`/`role="tab"`/`aria-selected`, the `electron-tabs` class and the `:122` gate (criterion 13; `activity-ticker.e2e.spec.ts:126` selects `[role="tablist"].electron-tabs`); mount `<ptah-global-config-menu />` in the cluster immediately left of `<ptah-theme-toggle />` (`:223-227`); the three-branch gate, the remount effect (`SurfaceRouterService.remountActiveSurface()` on a tick change, with the conditional post-remount focus) and the back-to-welcome button per Decision 2 (items 5-6, superseded by Revision 3 overrides 1 and 3); delete the icon fields that become unused (`WrenchIcon`, `StoreIcon`, `RadioTowerIcon` after the tabs move into the menu — they move to the menu component; the already-unused `ZapIcon`, `BotIcon`, `GitBranchIcon`, `SparklesIcon` at `:368-371` are deleted as dead code; `SettingsIcon`/`BarChart3Icon` stay on the menu component's items / the Analytics tab respectively).
- Verified contracts: `electron-shell.component.ts:88-94, 122-232, 240-312, 381-415, 264, 343`; `hasWorkspaceFolders` (`electron-layout.service.ts:91-93`); `openConfigurationSurface` and `configurationSurfaceRemountTick` (new); Router outlet lifecycle (`_router-chunk.mjs:1738-1743, 1747-1763, 1277-1283, 2315-2318`).
- Failure behaviour: pre-workspace rendering of a config surface cannot fail closed — if a lazy chunk fails, `openSurface` stays null and the welcome screen remains, which is the honest fallback. A remount CAN fail: `remountActiveSurface()` re-creates the routed component, and the re-created component's constructor or `ngOnInit` can throw; the method does not catch it and the shell's effect adds no handler, so the error propagates out of the effect and surfaces through Angular's `ErrorHandler` — like any route activation (see Failure behaviour).
- Verification seam: `electron-shell.activity-placement.spec.ts` (extend the `appStateStub` at `:86-92` with `openConfigurationSurface` and `configurationSurfaceRemountTick` — a real break otherwise — and re-pin the tab-count assertions at `:130, 135, 142` from 8 tabs to 4); NEW `electron-shell.config-gate.spec.ts` (Test plan); the notification-center spec is a source-grep spec (`electron-shell.notification-center.spec.ts:5-15`) and is unaffected — verify only, no edit; e2e.
- Files: MODIFY `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`; MODIFY `libs/frontend/chat/src/lib/components/templates/electron-shell.activity-placement.spec.ts`; CREATE `libs/frontend/chat/src/lib/components/templates/electron-shell.config-gate.spec.ts`.

### 4. E2e support and scenes (MODIFY)

- Purpose: keep the Electron e2e suite green after the tab removals/renames (Decision 5 table).
- Responsibilities: `ui-driver.ts` Canvas selector rename; `prewarm.ts` menu helper with originating-surface restore; 11 scene files updated to the helper or new labels.
- Files: MODIFY `apps/ptah-electron-e2e/src/support/ui-driver.ts`, `apps/ptah-electron-e2e/src/showcase/_harness/prewarm.ts`, and the scene files listed in the Decision 5 table.

## Data flow

1. Menu item click → `GlobalConfigMenuComponent.selectItem(id)` → close menu + refocus trigger → (Thoth only) `dismissThothFirstRun()` → `appState.setCurrentView(id)`.
2. `setCurrentView` (`app-state.service.ts:754-758`, unchanged) → `canSwitchViews` guard → `requestSurface` (`:419-428`) → `SurfaceRouterService.navigateToSurface` (`surface-router.service.ts:114-141`) → Router.
3. `NavigationEnd` → `currentSurface()` changes → the constructor effect (`:399-409`): (a) unconditional global write `openSurface = isConfigurationSurface(surface) ? surface : null`; (b) ownership-gated slice write through `openViewInActiveSlice`, which refuses configuration ids. Service-started navigations additionally run `recordSettledSurface` (`:442-458`): drop guards, owner re-grant, slice write through the same refusing funnel — no global write there; the effect is the single global writer.
4. Readers: menu trigger highlight and item `aria-current` (`openConfigurationSurface`); the three-branch gate and back-to-welcome visibility (Decision 2); the remount effect (`configurationSurfaceRemountTick`).
5. Workspace switch while a configuration surface is open: stay-branch (Decision 1) → tick bump → the shell's effect skips while `pendingSurface()` is non-null, otherwise calls `SurfaceRouterService.remountActiveSurface()` → the outlet deactivates and re-activates its stored route (new routed-component instance, same URL, child contexts retained) → after the next render, focus moves to the host only under Decision 2 item 6's conditions.
6. Host wire unchanged: `SWITCH_VIEW` → `handleMessage` (`:258-268`) → `handleViewSwitch` → step 2; `initialView` → `App.handleInitialView` → `SurfaceRouterService` directly → step 3's constructor effect.

## Failure behaviour

- **Disconnected/loading menu click**: `setCurrentView` no-ops (guard at `:754-758`); menu closes; screen unchanged. Same as the removed tabs.
- **Lazy chunk failure** (thoth, setup-hub, marketplace are `loadComponent`, `app.routes.ts:106-133`): `navigateToSurface` returns `'failed'`, the settlement effect never runs, `openSurface` keeps its previous value, the previous surface stays on screen. The menu never claims a surface that did not land.
- **Workspace switch while a configuration surface is open**: stay-branch — no navigation to fail; `_settlementOwner` transferred synchronously; `remountActiveSurface()` re-creates the surface. If the remounted surface still shows stale data for the new workspace, that indicates a service-level cache in that pane's lib (see Risks, A2). The remount itself is not guaranteed error-free: the re-created component's constructor or `ngOnInit` can throw, `remountActiveSurface()` does not catch it, and the shell's effect adds no handler — the error surfaces through Angular's `ErrorHandler`, like any route activation.
- **In-flight navigation when the switch lands** (review finding 4, accepted): a code-workspace navigation started under the previous workspace (e.g. the user clicked Chat, then switched within the debounce window) can land after the stay-branch ran. `recordSettledSurface` drops it by workspace mismatch (`:450`), but the constructor effect stamps the landed surface onto the incoming workspace's slice (the owner now matches). Accepted: the screen shows the landed surface and the slice says the same, so state and screen agree. Pinned by a spec case so a later change is deliberate.
- **Closed last workspace, then a navigation** (review finding 5, accepted): `removeWorkspaceState` (`:725-744`) deletes the slice and nulls the owner; a later configuration-surface settlement is refused by the slice guard (no re-creation) and recorded only in the global state. Benign. Pinned by a spec case.
- **Menu open + backdrop click / Escape / item click**: `closed` output → open signal false; Escape and item click additionally return focus to the trigger.
- **First folder opens while a configuration surface is shown**: branch flip re-activates the stored route (Decision 2.2); the stay-branch's tick bump is harmless in the same flush.

## Test plan

Unit (Jest, per project):

- `global-config-menu.component.spec.ts` (new): renders exactly four items in order (criterion 1); trigger accessible name + `aria-expanded` (criterion 6); click opens; item click calls `setCurrentView` with the right id, closes and refocuses the trigger (criteria 2, 7); Thoth item dismisses the first-run hint once, BEFORE `setCurrentView` (criterion 3); Escape closes and refocuses the trigger (criterion 6); arrow down/up move focus with wrap (criterion 6); backdrop click closes (criterion 7); `aria-current` and trigger highlight reflect `openConfigurationSurface` (Decision 3). Fire `opened` via `DebugElement.triggerEventHandler('opened')` — the component emits it only after Floating UI positioning (`native-dropdown.component.ts:192-205`), which a plain click does not reach in a unit test.
- `app-state.service.spec.ts` (modify): re-pin per Decision 5; new cases —
  - a configuration-surface settlement (via `setCurrentView` and via a direct `surfaceRouter.navigateToSurface` — the external-navigation case was missing, review finding 9) updates `openConfigurationSurface` and leaves every slice's `currentView`/`openViews` untouched (criteria 14, 16, 17);
  - `openConfigurationSurface` reads identically before and after `switchWorkspace` while a configuration surface is open (criterion 15);
  - `switchWorkspace` while on `'settings'` starts NO navigation (spy on `requestSurface`/`navigateToSurface`), sets `_settlementOwner` to the new path, bumps `configurationSurfaceRemountTick` exactly once, and runs the bootstrap migration;
  - `SWITCH_VIEW` message, `openSettingsTab`, `openSkillsDivergedClones` and a direct `navigateToSurface` each end with the correct global state (criterion 16, 18);
  - owner-null case: `removeWorkspaceState`, then an external navigation to a configuration surface — `openConfigurationSurface` still updates (finding 1's core scenario, previously uncovered);
  - finding 4 case: a code-workspace navigation that lands after the stay-branch stamps the incoming slice (accepted behaviour, pinned);
  - finding 5 case: `removeWorkspaceState`, then a configuration-surface settlement does not re-create the deleted slice;
  - still-partitioned ids keep every existing behaviour (criterion 17).
- `electron-shell.config-gate.spec.ts` (new): welcome shows when no workspace and `openConfigurationSurface()` is null; bare `<router-outlet />` (and NO `ptah-app-shell`, NO `ptah-electron-welcome`) when no workspace and a surface is open; the 3-panel area with `ptah-app-shell` when a workspace exists; first-folder-open with a surface showing flips branch 2 → branch 3 and the routed surface stays; a tick bump calls the (stubbed) `SurfaceRouterService.remountActiveSurface()` exactly once — tick `0` and a repeat of the same value never call it, and neither does a non-zero tick already present at construction; a bump while `pendingSurface()` is non-null skips the remount (this tick's remount is skipped, not deferred; the next bump after it returns to `null` remounts once); focus moves to the `tabindex="-1"` host only when the pre-remount focus was `document.body`, disconnected, or inside the host, and stays on a live control outside the host otherwise; close-last-workspace with a surface showing flips branch 3 → branch 2 and the surface stays; back-to-welcome navigates and returns the welcome screen (criterion 5); the menu trigger renders when `hasWorkspaceFolders()` is false (criterion 4); setup-hub non-config buttons pre-workspace return to the welcome branch while the Router stays on the target surface (finding 6 — designed behaviour, pinned).
- `electron-shell.activity-placement.spec.ts`: extend the `appStateStub` (`:86-92`) with `openConfigurationSurface` and `configurationSurfaceRemountTick`; re-pin the three tab-count cases (`:130, 135, 142`) from 8 to 4.
- `electron-shell.notification-center.spec.ts`: source-grep spec (`:5-15`); unaffected. Verify only.

E2e (Playwright):

- `ui-driver.ts` selector rename; a `goto` path through the menu is optional (switchView already covers it) but the showcase helper is required.
- Scene updates per the Decision 5 table; one shared helper (in `prewarm.ts` or the harness) opens the menu by `data-test="config-menu-trigger"` and clicks `data-test="config-menu-item-<id>"`; the helper restores the originating configuration surface through the menu (`activeNavTitle` returns null for config surfaces, `prewarm.ts:32-39`); keep the silent/guarded prewarm rules (`prewarm.ts:15-25`).
- Guard greps on ADDED lines only: `git diff origin/main...HEAD -U0 | grep '^+' | grep -E 'class\.hidden|retain: *true'` returns empty (criterion 21); `git diff origin/main...HEAD --name-only` contains neither `webview-surface.types.ts` nor `app.routes.ts` (criterion 20).
- Commands: per batch below; harness via `npx nx run @ptah-extension/webview-e2e-harness:e2e` (boot-progress, activity-ticker); `ptah-electron-e2e` targets: lint, typecheck, e2e, showcase, e2e:nightly.

Manual (run in the Electron app, recorded in the batch report):

- macOS title-bar: click the trigger, each item, and the backdrop with the pointer at the navbar (criterion 8); ALSO check that the open menu's backdrop (`fixed inset-0`, `native-dropdown.component.ts:223-228`) does not break the title-bar drag region or swallow navbar clicks that should close the menu (finding 11).
- Remount fresh-data spot check (A2, slimmed): for each of the four surfaces, open it, switch workspaces, and confirm the re-created surface shows the new workspace's data — Settings providers, Thoth memory tab (it already reloads on `workspaceInfo`, `memory-curator-tab.component.ts:418-428`), Marketplace, Setup hub. A stale pane indicates a service-level cache in that pane's lib (Risks).
- First-folder-open and close-last-workspace with a configuration surface showing: confirm the branch flips described in Decision 2.

## Extension points

- **TASK_2026_533** (merges after 540, rebases onto it): the `perSurface` record is the typed slot structure the coordination session asked for. 533 narrows the marketplace member of `ConfigurationSurfaceSlots` with `marketplaceRoute: MarketplaceRoute | null` and adds its own typed writer together with its first caller (540 ships no writer). 533's menu item keeps navigating to the bare `marketplace` root (fixed decision); its root redirect then restores the last page. 533 must show its breadcrumb header in Electron — Decision 3's clear YES.
- **Note to TASK_2026_533 (Batch 18 / its plan C1) — answers for your rebase.** This task does not implement your rule; it states the three facts you asked for:
  1. **`setCurrentView` (`app-state.service.ts:754-758`): 540 does NOT change it — byte-identical.** Add your no-op rule ("do nothing when `view` is already the current surface, no navigation is pending, and `_settlementOwner` is the active workspace") as written. `currentView` stays a computed off the Router (`:481-483`), so your "already the current surface" check reads the same value it does today.
  2. **Settlement logic: 540 DOES change the recording, not the ownership mechanics.** The global `openSurface` write now lives in the CONSTRUCTOR EFFECT (`app-state.service.ts:399-409`), unconditionally and BEFORE the ownership check — one global writer, Router-derived. `recordSettledSurface` (`:442-458`) keeps its guards and the owner re-grant (`:456`) and performs NO global write. The single slice-write funnel `openViewInActiveSlice` (`:639-647`) REFUSES the four configuration ids (early return), which also covers the outgoing stamp in `switchWorkspace` (`:678`). There is no `recordSettledView` method. Your rule reads `currentView` and `_settlementOwner` exactly as today. When you fold the rule in, keep this shape: a marketplace settlement writes `openSurface` through the effect (never through a slice), and your `marketplaceRoute` goes through your own typed writer into `perSurface.marketplace`.
  3. **`switchWorkspace` (`app-state.service.ts:660-717`): 540 DOES change it — one branch only.** After the same-path guard (`:662`), the branch runs when `isConfigurationSurface(this.currentView())` (Router truth): the outgoing stamp at `:677-679` runs as-is (the funnel refuses the config id), `_settlementOwner` is set to `newPath` (no navigation settles to re-grant it), the bootstrap-slice migration (`:686-701`) runs verbatim, `_configurationSurfaceRemountTick` is bumped once, and the restore navigation (`:714-716`) is SKIPPED. For every non-configuration surface the existing path runs untouched, so your requirement that `switchWorkspace` still re-navigates holds for those surfaces. When `marketplace` (or any of its child routes — `currentSurface` reads only the first segment) is open, the stay-branch applies: there is NO re-navigation on a workspace switch, the open Marketplace page stays on screen, AND its component is re-created at the same URL — `ElectronShellComponent`'s effect on the remount tick calls `SurfaceRouterService.remountActiveSurface()` (Revision 3 override 1; the call is skipped while `pendingSurface()` is non-null), which captures the activated primary outlet's stored `route`/`injector`, deactivates the outlet, and calls `activateWith` — only the routed component is re-created, and child outlets re-activate from their retained contexts. Your child-route URL is preserved. (Orchestrator correction, 2026-09-23, preserved and extended with the remount.)
  4. **Menu items call `appState.setCurrentView(id)` — no other method.** With your rule, a re-click on the currently open configuration surface becomes a no-op. 540 confirms this is acceptable for `thoth`, `setup-hub` and `settings`: today a re-click on the open surface already changes no URL (`navigateToSurface` returns `'already-there'`, `surface-router.service.ts:44-48`), so the only work the rule removes is a redundant re-stamp, and the component stays mounted either way because no navigation destroys it. One ordering fact your rebase must keep: the menu component dismisses the Thoth first-run hint (`app-state.service.ts:873`) BEFORE it calls `setCurrentView` (criterion 3), so the no-op rule cannot block the dismissal.
- **TASK_2026_524** (batch 3, RouteReuseStrategy owner): 540 adds no reuse strategy. The remount deliberately avoids your slot: it works through the Router's own outlet re-activation (`SurfaceRouterService.remountActiveSurface()`, Revision 3 override 1) — no keyed blocks. Your batch stays free to land its strategy without conflicts from this task.
- **TASK_2026_494** (Apps tab): the tab row carries one comment marking the Apps slot between Chat and Tasks. 494 replaces the comment with the tab button; nothing else in the row moves.

## Suggested batches

File-disjoint, each ≤6 files, ≤2 libs. The team-leader re-derives ordering; the only hard constraint is that Batch A's `app-state.service.ts` exports must exist before Batch B compiles, and the e2e helper (C1) before the scene batches.

- **Batch A — core state** (lib: `@ptah-extension/core`): `app-state.service.ts`, `app-state.service.spec.ts`. Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core`.
- **Batch B — Electron shell + menu** (lib: `@ptah-extension/chat`): `global-config-menu.component.ts`, `global-config-menu.component.spec.ts`, `electron-shell.component.ts`, `electron-shell.activity-placement.spec.ts` (stub extension + re-pins), `electron-shell.config-gate.spec.ts` (NEW). The notification-center spec is NOT in the batch (source-grep spec, unaffected). Verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`.
- **Batch C1 — e2e driver + Thoth-family scenes** (app: `ptah-electron-e2e`): `support/ui-driver.ts`, `showcase/_harness/prewarm.ts`, `showcase/thoth-tour.scene.ts`, `showcase/skills-tour.scene.ts`, `showcase/gateway-tour.scene.ts`, `showcase/cron-tour.scene.ts`. Verify: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`.
- **Batch C2 — e2e remaining configuration scenes** (app: `ptah-electron-e2e`): `showcase/memory-recall.scene.ts`, `showcase/setup-wizard-tour.scene.ts`, `showcase/settings-tour.scene.ts`, `showcase/marketplace-tour.scene.ts`, `showcase/dashboard-tour.scene.ts`. Verify: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`.
- **Batch C3 — e2e renamed-tab scenes** (app: `ptah-electron-e2e`): `showcase/canvas-orchestra.scene.ts`, `showcase/chat-code-edit.scene.ts`. Verify: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`.

Full-suite gate before completion: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core,@ptah-extension/chat,ptah-electron-e2e,@ptah-extension/webview-e2e-harness`, plus `npx nx run @ptah-extension/webview-e2e-harness:e2e` (boot-progress, activity-ticker) and the Electron Playwright run per the repo's e2e target. Run the A2 remount spot check and the Decision 2 branch-flip checks in the Electron app and record them in the batch report.

## Risks

| Risk | Mitigation |
| --- | --- |
| The remount destroys `AppShellComponent` state (canvas tiles, panel sizes) on a switch while a configuration surface is open | Accepted by design: all four configuration surfaces are "Stays mounted: No" (`design-spec.md:37-49`), and the canvas re-hydrates against the NEW workspace, which is the requested behaviour (`orchestra-canvas.component.ts:334-338`) |
| A re-created surface still shows stale per-workspace data — a service-level cache, not a remount failure (A2, slimmed) | Spot check all four surfaces after a switch (Test plan, manual). Example: `providers-settings-state.service.ts:1060-1065` guards writes by scope but can display stale values — a fix belongs in that pane's lib, in a separate batch. Thoth's memory tab already reloads on `workspaceInfo` (`memory-curator-tab.component.ts:418-428`) |
| In-flight navigation under the debounce window stamps the incoming workspace's slice after the stay-branch (finding 4) | Accepted: screen and slice agree; pinned by a spec case so a later change is deliberate |
| Deleted-slice re-creation paths after `removeWorkspaceState` (finding 5) | Benign with the funnel refusal; pinned by a spec case |
| macOS: the dropdown backdrop (`fixed inset-0`) may overlie the titlebar-drag navbar while the menu is open (finding 11) | Manual check in the batch report; if the backdrop blocks the drag region while open, that is a menu-open-only state and accepted |
| Label/title renames (Canvas→Chat, Dashboard→Analytics) ripple into selectors beyond those grepped (`[title="Orchestra Canvas"]` was found at `ui-driver.ts:327` and `chat-code-edit.scene.ts:179-181`; others may exist) | The implementer greps `apps/ptah-electron-e2e` for `Orchestra Canvas`, `Canvas'`, `Dashboard'` after the shell edit and updates any missed hit |
| Showcase scenes depend on tab-driven visual beats (camera framing on the tab strip) | Scene authors keep the beat but reach the surface through the menu; the prewarm helper preserves the silent/guarded rules (`prewarm.ts:15-25`) |

## Acceptance-criteria coverage

| Criterion | Covered by |
| --- | --- |
| 1-3 | GlobalConfigMenuComponent (items, order, navigation, Thoth hint) |
| 4, 5 | Three-branch gate + menu placement above the gate; bare outlet branch; back-to-welcome |
| 6, 7 | GlobalConfigMenuComponent keyboard/ARIA contract (Decision 4) |
| 8 | Menu and back button inside the existing `no-drag` cluster (`electron-shell.component.ts:88-94, 223-227`) |
| 9-13 | ElectronShellComponent tab row edits |
| 14-17 | AppStateManager: effect write seam, funnel refusal, stay-branch + tick, typed slots, spec re-pins |
| 18 | No call-site changes; the constructor effect is the single settlement seam (Decision 1) |
| 19 | `app-shell.component.*` untouched entirely (user decision 1); `openViews` has no production consumer |
| 20 | Neither file is in any batch; name-only diff guard in Test plan |
| 21 | No new `[class.hidden]` or `retain: true`; outlet remount via `SurfaceRouterService.remountActiveSurface()` instead; added-lines grep guard in Test plan |

## Revision log

Revision 2 (2026-09-23), driven by `plan-review.md` (verdict APPROVE WITH FIXES, 11 findings) and two final user decisions:

- **Finding 1 (MAJOR)** — the global `openSurface` write moved from an owner-gated `recordSettledView` routing method into the constructor effect, first and unconditionally; `openViewInActiveSlice` refuses configuration ids as the single slice funnel; `recordSettledSurface` keeps guards + re-grant only; the untyped slot writer was dropped. Reason: an owner-gated global write leaves `openSurface` stale exactly when the owner is null (switch in flight, last workspace closed).
- **Finding 2 (MAJOR) + user decision 1** — the pre-workspace branch now renders a bare `<router-outlet />` instead of `ptah-app-shell`; the gate became three mutually exclusive branches; `app-shell.component.*` is untouched; assumption A1 is deleted (its risks are gone by construction); the previous draft's four inner `hasWorkspaceFolders()` gate extensions became unnecessary.
- **Finding 3 (MAJOR) + user decision 2** — a workspace switch while a configuration surface is open now keeps the surface on screen AND re-creates its component: a `_configurationSurfaceRemountTick` signal in `AppStateManager`, bumped at the end of the stay-branch, consumed by a keyed `@for` host in `ElectronShellComponent`; focus moves to a `tabindex="-1"` host after the remount (`design-spec.md:63-76`). Mechanism verified against Angular Router source (`_router-chunk.mjs`); three alternatives evaluated and rejected in Decision 2. A2 slimmed to a fresh-data spot check. Extension points item 3 (the orchestrator correction) preserved and extended with the remount-at-same-URL fact; item 2 rewritten for the new write seam.
- **Findings 4, 5** — accepted behaviours documented in Failure behaviour and pinned by new spec cases.
- **Finding 6** — setup-hub non-config buttons pre-workspace stated as designed (`setup-hub.component.ts:1295-1305, 1316-1318`), pinned by a config-gate spec case.
- **Finding 7** — wording corrected: tab clicks navigate to the clicked surface; back buttons go to chat; B's remembered surface is served only on a later switch into B.
- **Finding 8** — `ConfigurationSurfaceSlots` is a typed per-key interface; the untyped `updateConfigurationSurfaceSlot` writer dropped (no caller in 540).
- **Finding 9** — test seams regrouped: activity-placement stub extension, NEW `electron-shell.config-gate.spec.ts`, the two missing core cases (direct `navigateToSurface`; owner-null after `removeWorkspaceState`), notification-center spec out of Batch B; review "Instructions for implementers" folded into the component specs, Test plan and batches.
- **Finding 10** — citations corrected (lucide imports `:30, 37-39`; ui barrel `index.ts:32`; `chat-code-edit.scene.ts:179-181`); the `openViews` no-production-consumer fact recorded; the already-unused icon fields deleted as dead code.
- **Finding 11** — keyboard/focus details added: `opened` fired via `triggerEventHandler` in specs; item activation closes and refocuses the trigger; macOS backdrop-over-titlebar manual check; trigger glyph `SlidersHorizontal` (verified export), distinct from the Settings item.
- Batches regrouped (Batch B = 5 files, notification-center spec removed); verification commands updated with the harness e2e run and the added-lines guard greps; a TASK_2026_524 note added (the remount deliberately avoids the RouteReuseStrategy slot).