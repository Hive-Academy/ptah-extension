# Batch 2 Report - TASK_2026_540_0940

## Files changed

- `libs/frontend/core/src/lib/routing/surface-router.service.ts`
- `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts`
- `.ptah/specs/TASK_2026_540_0940/batch-2-report.md`

Batch 1's AppStateManager implementation and spec were not edited. The shared routing test harness was read only. No state-changing git commands were run.

## Task 2.1

- `surface-router.service.ts:4` imports `ChildrenOutletContexts`; the existing `PRIMARY_OUTLET` import is reused.
- `surface-router.service.ts:67` injects `ChildrenOutletContexts`.
- `surface-router.service.ts:145` documents the workspace-switch purpose, routed-component-only recreation, retained child contexts, unchanged URL without navigation, and the required effect timing after `workspaceInfo` is updated.
- `surface-router.service.ts:165` adds public `remountActiveSurface(): void`. It returns when there is no active outlet or route, captures the route and injector before deactivation, and activates the same route with that injector.
- `navigateToSurface`, `currentSurface`, and `pendingSurface` are unchanged. No `RouteReuseStrategy` was introduced.

Installed Angular Router is **22.1.7** (`node_modules/@angular/router/package.json:3`). Verified public signatures:

| API | Installed declaration evidence |
| --- | --- |
| `ChildrenOutletContexts` | `node_modules/@angular/router/types/router.d.ts:35` |
| `getContext(childName: string): OutletContext \| null` | `node_modules/@angular/router/types/router.d.ts:54` |
| `PRIMARY_OUTLET = "primary"` | `node_modules/@angular/router/types/_router_module-chunk.d.ts:1908` |
| `OutletContext.route: ActivatedRoute \| null` | `node_modules/@angular/router/types/router.d.ts:24` |
| `OutletContext.injector: EnvironmentInjector` getter | `node_modules/@angular/router/types/router.d.ts:27` |
| `RouterOutlet.deactivate(): void` | `node_modules/@angular/router/types/_router_module-chunk.d.ts:1107` |
| `RouterOutlet.activateWith(activatedRoute: ActivatedRoute, environmentInjector: EnvironmentInjector): void` | `node_modules/@angular/router/types/_router_module-chunk.d.ts:1108` |

Public runtime exports are verified at `node_modules/@angular/router/fesm2022/router.mjs:7`. The implementation destroys the current component at `_router-chunk.mjs:1797` and creates its replacement at `:1806`. Child outlet destruction retains the route and children (`:1277`); new outlets activate retained routes (`:1750`), and activation passes retained child contexts to the component injector (`:1814`). All signatures match the requested implementation; no adaptation was necessary.

## Task 2.2

`surface-router.service.spec.ts:289` adds `describe('remountActiveSurface')` with its own TestBed, `MemoryPlatformLocation`, `provideRouter(routes, withDisabledInitialNavigation())`, and standalone OnPush test components. Real `RouterOutlet` instances are used throughout; no outlet is mocked.

1. **re-creates the routed component at the same URL without NavigationStart** (`:316`): verifies the original activation, a new instance and construction count increment, preserved query/fragment URL, and no `NavigationStart` during remount. The event subscription is cleaned up in `finally`.
2. **re-creates the parent and child from retained contexts at the same child URL** (`:345`): verifies both instance identities change, both construction counts increment, and the full child URL remains unchanged.
3. **does nothing on a component-less route** (`:378`): navigates to `chat` with a real but inactive outlet; verifies no throw, no routed constructions, and unchanged URL.
4. **does nothing when no outlet is rendered** (`:397`): verifies no throw before navigation and after a component route has been addressed without rendering a host; no components are constructed.

No `.skip` or `.only` was added.

## Risks and edge cases

- **RA:** Both `ctx.route` and `ctx.injector` are captured at `surface-router.service.ts:169` before `deactivate()` at `:171`; this order is verified by code inspection. Activation uses those captured values. The real-router tests prove the outcomes (new instances, retained child contexts, unchanged URL), not the capture-before-deactivate order: `deactivate()` does not mutate `ctx.route` or `ctx.injector` in the installed Angular Router 22.1.7.
- No context, no rendered outlet, and an inactive outlet return without throwing. A missing route also returns before activation.
- The method intentionally does not navigate; URL query parameters and fragments survive as well as the route path.
- Callers must not invoke this synchronously from `AppStateManager.switchWorkspace`: the Electron shell's `configurationSurfaceRemountTick` effect must run after the coordinator returns and `workspaceInfo` is updated. This timing requirement is documented in the method JSDoc; shell integration belongs to a later batch.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core`

Initial run: FAIL (typecheck and lint passed; 32 test suites passed, one failed with two failures). The component-bearing tests attempted to read inactive outlets because the zone-based fixture needed explicit change detection. Added `fixture.detectChanges()` to initialize the host and render after navigation/remount, retaining `fixture.whenStable()` for async settling. The production implementation was unchanged.

Status: **PASS**, exit code 0. All three targets succeeded, with no cache hits. `git diff --check` also passed for the allowed files.

Tailed output from the corrected run:

```text
NX   Running targets typecheck, test, lint for project @ptah-extension/core:

- @ptah-extension/core


√  nx run @ptah-extension/core:typecheck
√  nx run @ptah-extension/core:test
√  nx run @ptah-extension/core:lint



 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/core


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/VbpCw1EKcn

  Run duration:      1m 24s
  Cache:             0/3 hit (0%)
  Critical path:     55.1s (1 task)
  Recoverable time:  29.3s (35% of the run)

  Recommendation: Increase parallelism to recover up to 29.3s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
```

## Open issues

none

## Revision 1

- Expanded `remountActiveSurface()` JSDoc to require callers to skip remounting while `pendingSurface()` is non-null, explaining wasted construction, possible flashing, and duplicate data fetches. Documented that outlet `(activate)`/`(deactivate)` outputs fire on every remount, not only on real navigations. No logic or test changes.
- Corrected the RA evidence claim: code inspection establishes capture-before-deactivate ordering; tests establish remount outcomes, because the installed Angular `deactivate()` does not mutate `ctx.route`/`ctx.injector`. Updated affected implementation line references.

Verification command: `npx nx run-many -t lint,typecheck -p @ptah-extension/core`

Status: **PASS**, exit code 0. The requested command ran once; both targets passed with no cache hits. `git diff --check` passed for the two revised files.

Tailed output:

```text
NX   Running targets lint, typecheck for project @ptah-extension/core:

- @ptah-extension/core


√  nx run @ptah-extension/core:lint
√  nx run @ptah-extension/core:typecheck



 NX   Successfully ran targets lint, typecheck for project @ptah-extension/core


Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/nS5keWmc6n

  Run duration:      14.6s
  Cache:             0/2 hit (0%)
  Critical path:     14.6s (1 task)
  Recoverable time:  <1ms
```
