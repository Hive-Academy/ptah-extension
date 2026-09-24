# Batch 1 Report - TASK_2026_540_0940

## Files changed

- MODIFY `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\core\src\lib\services\app-state.service.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\core\src\lib\services\app-state.service.spec.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\.ptah\specs\TASK_2026_540_0940\batch-1-report.md`

## Task 1.1

All edits in `libs\frontend\core\src\lib\services\app-state.service.ts` (post-edit line numbers):

- `:57` — `export type ConfigurationSurfaceId = Extract<ViewType, 'thoth' | 'setup-hub' | 'marketplace' | 'settings'>` (new).
- `:62` — `export const CONFIGURATION_SURFACE_IDS` (new, order thoth, setup-hub, marketplace, settings).
- `:69-73` — `export function isConfigurationSurface(view): view is ConfigurationSurfaceId` (new; implemented via `.includes` over the id list, no stub).
- `:83-92` — `export interface ConfigurationSurfaceSlots` (new; each member `Readonly<Record<string, never>>`, with the plan's per-member reservation comments).
- `:94-99` — `export interface ConfigurationSurfacesState` (new; `openSurface` + `perSurface`).
- `:350-362` — `private readonly _configurationSurfaces = signal<ConfigurationSurfacesState>(...)` placed immediately after `_layoutMode`, carrying the plan's "Deliberately NOT workspace-partitioned" comment verbatim.
- `:364-380` — `private readonly _configurationSurfaceRemountTick = signal(0)`; doc comment rewritten for override 1: the Electron shell's effect calls `SurfaceRouterService.remountActiveSurface()` (outlet re-activation of the routed component only, same URL); there is NO keyed `ptah-app-shell` host.
- `:475-502` — constructor effect: inside `untracked`, the global write now runs FIRST and UNCONDITIONALLY — `openSurface = isConfigurationSurface(surface) ? surface : null`, skipped when unchanged (override 6) — then the existing ownership check and `openViewInActiveSlice` call run unchanged.
- `:527-540` — `recordSettledSurface` doc comment extended ("Slice-stamp and owner re-grant only … NO global write; the constructor effect is the single writer"). No logic change; the owner re-grant at `:555` (`this._settlementOwner = workspacePath`) is byte-identical.
- `:593-605` — public exports next to `layoutMode`: `configurationSurfaces` (asReadonly, `:594`), `openConfigurationSurface` (computed, `:596`), `configurationSurfaceRemountTick` (asReadonly, `:604`).
- `:750-766` — `openViewInActiveSlice`: doc comment rewritten (single slice-write funnel); early return `if (isConfigurationSurface(view)) return;` at `:761` covers all three callers (constructor effect, `recordSettledSurface`, outgoing stamp in `switchWorkspace`).
- `:770-857` — `switchWorkspace`: doc comment describes the stay-branch; `const staying = isConfigurationSurface(this.currentView())` at `:794` right after the same-path guard; the outgoing stamp (`:818-820`) kept as-is; `_settlementOwner = staying ? newPath : null` at `:823`; the bootstrap-slice migration block kept verbatim (`:826-842`); stay-branch at `:844-852` bumps the tick once and returns WITHOUT `requestSurface`; the existing restore navigation (`:854-856`) is unchanged for every other surface.
- `:357-386` — `_settlementOwner` doc comment updated: the stay-branch grants ownership to the incoming workspace directly instead of nulling it.
- `setCurrentView` (`:880-884`) is BYTE-IDENTICAL (no diff lines). No `recordSettledView`, no slot-writer method, no barrel edit (`services/index.ts:7` already re-exports the file). No dead code, no TODO/stub/placeholder.

## Task 1.2

Re-pinned ranges (confirmed on disk first; assertion meaning kept; no test deleted, no `.skip`/`.only`):

- `:285-296` ("setCurrentView navigates and adds the surface to openViews") — `'settings'` → `'analytics'` (call, `currentView` assertion, `openViews` arrayContaining).
- `:298-309` ("does not report the new surface before the navigation settles") — `'settings'` → `'analytics'` (both reads).
- `:324-336` ("closeView leaves the surface alone when closing a view the user is not on") — `'settings'` → `'tribunal'`.
- `:346-353` / `:355-362` (blocked while loading / disconnected) — `'settings'` → `'analytics'`.
- `:540-555` (`getStateSnapshot`) — `'settings'` → `'analytics'` (call and snapshot literal).
- `:632-653` ("partitions openViews, so a view opened in A is not open in B") — `'settings'` → `'tasks'` (both arrayContaining assertions).
- `:730-756` (A→B→A ownership, "does not stamp the outgoing surface…") — `'settings'` → `'tribunal'`, including the explanatory comment at `:746`.
- `:801-814` ("drops a superseded navigation rather than recording it") — `'settings'` → `'analytics'` (`openViews` exclusion stays meaningful).
- `:910-929` ("keeps the in-surface pointers independent of the view pointer") — `'thoth'` → `'tribunal'`, `'marketplace'` → `'tasks'` (navigations, `closeView`, final `currentView`).
- Stayed as-is per the plan: `:227-232` (normalizeInitialView list — the ids still exist as surfaces) and `:408` (`openSettingsTab` entry-point test). Also kept: `:364-374` (`openSkillsDivergedClones` must land on `'thoth'` — entry point, criterion 18).

New `describe('global configuration surfaces (TASK_2026_540)')` block with the 10 cases (spec header coverage comment updated to match):

1. `configuration settlements update openConfigurationSurface and leave every slice untouched` — both via `setCurrentView('settings')` AND a direct `surfaceRouter.navigateToSurface('marketplace')`; asserts B's slice `openViews` `['chat','tasks']` throughout and A's slice still restoring `'analytics'` after a roundtrip.
2. `reads identically before and after switchWorkspace while a configuration surface is open` — `'thoth'` before/after, `currentView` unchanged.
3. `switchWorkspace while on a configuration surface starts no navigation, bumps the tick exactly once, and keeps the outgoing slice` — `jest.spyOn(surfaceRouter, 'navigateToSurface')` sees zero calls; tick +1 exactly once; `currentView` stays `'settings'`; a later switch with a code-workspace surface on screen does NOT bump the tick, and A's slice restores `'tasks'`.
4. `stay-branch on the first switch out of the bootstrap sentinel still migrates the sentinel slice` — sentinel slice (with `'analytics'`) migrates onto `'/ws/a'`; the refused `'settings'` never enters it.
5. `SWITCH_VIEW message ends with the correct openConfigurationSurface` (`'marketplace'`), `openSettingsTab ends with the correct openConfigurationSurface` (`'settings'`), `openSkillsDivergedClones ends with the correct openConfigurationSurface` (`'thoth'`), `a direct navigateToSurface ends with the correct openConfigurationSurface` (`'setup-hub'`).
6. `owner null after removeWorkspaceState: an external configuration navigation still updates the global state` — `removeWorkspaceState('/ws/a')`, external `navigateToSurface('settings')` still sets `openConfigurationSurface`; a later external `'tasks'` navigation clears it to `null`.
7. `a failed navigation leaves openConfigurationSurface unchanged` — `router.navigateByUrl` spied to reject; `setCurrentView('marketplace')` settles as `'failed'`; `openConfigurationSurface` and `currentView` stay `'settings'`.
8. `finding 4: a navigation started before a stay-branch switch lands on the incoming workspace slice` — `setCurrentView('tasks')` started, `switchWorkspace('/ws/b')` runs before it lands; tick 1, `currentView` `'tasks'`, `openConfigurationSurface` `null`, B's slice stamped `['chat','tasks']` (accepted, pinned).
9. `finding 5: after closing the last workspace, chat re-grants the owner and re-seeds the slice; a configuration settlement does not` — first half pins the accepted `chat` case (re-grant proven by a subsequent EXTERNAL `'analytics'` navigation stamping the slice via the effect); second assertion: in the same closed-workspace state a `'settings'` settlement re-creates nothing (`openViews` `['chat']`, no `'settings'`).
10. Still-partitioned ids keep every existing behaviour (criterion 17) — the re-pinned suite above.

Harness: existing `provideSurfaceRouterTesting()` / `settleSurfaceNavigation()` from `libs\frontend\core\src\testing\surface-router-testing.ts` throughout; "no navigation" pinned via a `jest.spyOn` on `SurfaceRouterService.navigateToSurface`. No pinned behaviour mismatched the service, so the service was not touched to make a pin pass.

## Risks and edge cases

- **RC (finding-4 race)**: accepted per the plan — the constructor effect stamps the late-landing code-workspace surface onto the incoming workspace's slice (owner already transferred by the stay-branch), so state and screen agree; pinned by new case 8. No extra guard added (that would be a design change).
- **Edge case 1** (owner-null external navigation still updates `openSurface`): handled by the unconditional effect write; pinned by case 6.
- **Edge case 2** (lazy chunk failure leaves `openSurface` unchanged): the effect never runs because `currentSurface` never changes; pinned by case 7 with a rejected `navigateByUrl`.
- **Edge case 3** (switch while a configuration surface is open: no navigation, owner = new path, tick +1 exactly once, migration runs, outgoing slice keeps its code-workspace surface): pinned by cases 2, 3 and 4.
- **Edge case 4** (finding 4 in-flight stamp): pinned by case 8.
- **Edge case 5** (finding 5 / R2-6): the NON-configuration `chat` settlement re-grants the owner and re-seeds the closed path's slice (accepted, pinned as the primary assertion); the configuration settlement re-creates nothing (second assertion). Pinned by case 9.
- Surprise during implementation: none behavioural. One note — a re-granted owner after a configuration settlement is publicly indistinguishable from a re-seeded slice whose content equals `DEFAULT_VIEW_SLICE` (map membership is private); case 9 therefore proves the re-grant through a subsequent external navigation stamping the slice, and the configuration half pins content-level non-re-creation (`openViews` stays `['chat']`).

## Verification

Command (run once, from the worktree root):

```
npx nx run-many -t typecheck,test,lint -p @ptah-extension/core
```

Tail of output:

```
√  nx run @ptah-extension/core:typecheck
√  nx run @ptah-extension/core:test
√  nx run @ptah-extension/core:lint

 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/core

  Run duration:      27.8s
  Cache:             0/3 hit (0%)
```

PASS (exit code 0).

## Open issues

none
