# Batch 4e2 cross-side review — round 1

**Verdict: APPROVE**

## Defects

None found in the 4e2 Thoth route-table wiring.

## Evidence

- `app.routes.ts:141-150` retains the `thoth` route's `SURFACE_ACTIVE` provider and loads `THOTH_ROUTES` with a dynamic barrel import. Angular's parent route injector remains available to the loaded shell and child routes. The app source has no static `@ptah-extension/thoth-shell` import.
- `thoth.routes.ts:36-45` supplies the shell, remembered-tab redirect, guarded `:tab`, and unknown-tab fallback. `webview-routing.spec.ts:421-464` navigates with the real app routes and checks `/thoth/memory`, `/thoth/cron`, `/thoth/skills`, and invalid-tab fallback. Its TestBed has no outlet, so it does not exercise shell construction or provider injection; those are library/Angular contracts, not demonstrated by this spec.
- `webview-routing.spec.ts:323-343` changes only the bare Thoth deep-link expectation to `/thoth/memory`, matching the new redirect; the other surface cases remain in the same loop. `:624-626` still compares the complete ordered top-level route list with `SURFACE_ROUTE_IDS`.
- `SurfaceRouterService.navigateToSurface` and `navigateToUrl` still catch lazy-load rejection and return `failed` (`surface-router.service.ts:152-153,172-184,266-275`).
- `SurfaceRoutePersistence` persists `NavigationEnd.urlAfterRedirects` (`surface-route-persistence.ts:48-55`), so once started it records the final `/thoth/<tab>` URL. Starting it before first navigation belongs to pending Batch 4d (`implementation-plan.md:604-620`); this batch does not claim that end-to-end persistence is already active.
- The 4c chat children and their assertions remain present. The Thoth changes do not alter the chat route or initializer.

Read-only review. No tests, lint, typecheck, Nx, or build run here; developer reported webview checks passing (17 suites, 413 tests).
