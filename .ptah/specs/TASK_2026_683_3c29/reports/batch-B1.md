# Batch B1: router surface transitions

## Files changed

- `libs/frontend/core/src/lib/routing/surface-view-transitions.ts` — adds the first-segment surface decision, reduced-motion guard, Router feature, and latest-transition tracker.
- `libs/frontend/core/src/lib/routing/surface-view-transitions.spec.ts` — exercises the real Router across the required route shapes and the tracker's completion paths.
- `libs/frontend/core/src/lib/routing/index.ts` — exports the feature, decision helper, and tracker through the public core entry point.
- `apps/ptah-extension-webview/src/app/app.config.ts` — wires the feature beside the initial-navigation features.
- `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` — pins the app-config feature call.

## Spec coverage

| Plan case | Spec case |
| --- | --- |
| Component 1: first navigation skipped | `skips the first navigation, then tracks chat to settings` |
| Component 1: chat → settings animated and tracked | same case |
| Component 1: `/chat` → `/chat/a`, `/chat/a` → `/chat/b` skipped | parameterized same-surface case |
| Component 1: Thoth child and Marketplace page changes skipped | parameterized same-surface case |
| Component 1: empty and wildcard redirects from chat skipped | parameterized `/chat/a` → `/` and `/unrecognised` cases; `/chat/a` ensures the redirect is a real navigation |
| Component 1: empty and wildcard redirects from settings animated | parameterized settings redirect case |
| Component 1: matrix parameter change skipped | `/settings;panel=x` → `/settings` case |
| Component 1: reduced motion skipped | `skips when reduced motion is preferred` |
| Component 1: rapid navigation and cancellation | `keeps the latest transition during rapid page changes`; `does not create a transition for a guard-cancelled navigation` |
| Component 2: synchronous idle callback; ordered busy callbacks; skipped completion | `runs idle callbacks synchronously and busy callbacks in order` |
| Component 2: rejected completion; latest transition wins | `flushes after a rejected finished promise`; rapid-navigation case |
| Component 8: composition pin | `app.config routing wiring` assertion in `webview-routing.spec.ts` |

## Verification

`ptah_get_diagnostics` was scoped to the five changed TypeScript files. It reported **no diagnostics in requested files** with clean coverage. The same compiler pass reported 106 errors in sibling files outside B1 ownership; these were not edited. No Nx, Jest, build, lint, or git command was run, per the active heavy-check restriction. The new specs therefore remain unexecuted in this lane.

Run these one at a time after the machine's current heavy check completes:

```text
npx nx test @ptah-extension/core --parallel=1
npx nx typecheck @ptah-extension/core --parallel=1
npx nx lint @ptah-extension/core --parallel=1
npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/webview-routing.spec.ts --coverage=false --maxWorkers=2
```

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the first consumed primary URL segment via `surfaceIdFromSegment` | `routeConfig.path`; first segment | Approved plan component 1 and existing `SurfaceRouterService.surfaceOf` matrix-parameter behavior | Yes |
| Keep the tracker on the latest transition and attach a two-outcome completion handler | `finished.finally` with a catch; `finished.then` with both handlers | Approved component 2 requires rejected `finished` to flush without creating an unhandled rejection | Yes |
| Start redirect skip probes from `/chat/a` | `/chat`; `/chat/a` | Redirecting from `/chat` back to `/chat` can be ignored as a same-URL navigation; a tab URL yields a real same-surface redirect | Yes |

## Clarifications Needed

None.
