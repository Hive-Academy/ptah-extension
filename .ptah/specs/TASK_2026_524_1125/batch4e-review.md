# Batch 4e cross-side review — REVISE

## Defects

1. **D6 tab history is violated** — `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:387` calls `SurfaceRouterService.navigateToSurface('thoth', [tabId])`. That service calls `router.navigateByUrl(targetTree)` without `replaceUrl` (`libs/frontend/core/src/lib/routing/surface-router.service.ts:250`). Start at `/thoth/memory`, click Skills, then press Back: the browser returns to `/thoth/memory`, cycling through tabs. Decision D6 (`implementation-plan.md:229-237`) requires a tab switch to replace the URL so Back leaves the surface. The §9 implementation prescription conflicts with D6 here; resolve the conflict in favor of the explicit history decision, and add a history assertion to the routed click spec (`thoth-shell.component.spec.ts:326`).

## Notes

- `restoreThothTab` uses `inject(AppStateManager)` inside Angular's `RedirectFunction` context. The `canMatch` guard rejects unknown tab segments; the wildcard redirects those paths to `memory`. The routed specs exercise direct, remembered, invalid, and reused-shell routes. No redirect loop is apparent.
- `NavigationEnd` gates the tab and memory update. `parseUrl(urlAfterRedirects)` checks the first primary path segment, so `/thothx` does not match and `/thoth/skills?x=1` still does. The constructor subscription uses `takeUntilDestroyed()` in an injection context. The shell is OnPush and the route tab is a signal.
- The idle-router seed write on remount is sound for the stated remount path: the existing snapshot is settled, the shell is recreated for the new workspace, and no `NavigationEnd` follows. A shell constructed during navigation defers the write until `NavigationEnd`.
- The new route imports the component in one direction; there is no route/component cycle. `@angular/router` is an Angular dependency, and `@ptah-extension/core/testing` appears in a spec only. The production dependency remains `@ptah-extension/core`.
- Review only. No tests, lint, typecheck, Nx, or build were run, per request; 4e2 is outside scope.
