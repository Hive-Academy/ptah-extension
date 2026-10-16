# B4b report — route and host height contract

## Files changed

- `apps/ptah-extension-webview/src/app/app.routes.ts`: added lazy `harness-builder/:mode/:tabId` beside the existing bare builder route, with the same `SURFACE_ACTIVE` provider. Setup Hub remains registered.
- `apps/ptah-extension-webview/src/app/app.routes.spec.ts` (new): checks both builder modes, route parameters, lazy component resolution, settled URL persistence and route restoration, `SURFACE_ACTIVE`, and the Electron height classes.
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`: added `min-h-0` to the outer content row and configuration surface host.

## Decisions

- Kept the bare `harness-builder` route so a missing parameter can reach the page's safe session-missing state. The new parameterized route is first, and the route parameters remain the binding authority. Evidence: design-spec §11 note 6, implementation-plan line 21, and the existing bare route. Reversible: yes.
- Reused the existing `SurfaceRoutePersistence` contract rather than adding route state. It records the settled URL, including both parameters. Evidence: `surface-route-persistence.ts` and `surface-router.service.ts`. Reversible: yes.

## Verification

- Inspected the changed route and shell markup and resolved the spec's shell source path inside the worktree.
- Automated tests, Nx, TypeScript diagnostics, lint and builds were not run, per the batch instruction. The orchestrator owns those checks.

## Not done

- Builder page parameter validation and sidebar scroll body are owned by B4a/B4c. Actual short-window scrolling still needs the planned visual review.

## Fix round

- Cause: the route spec supplied `panelId: 'builder-route-test'`, which the shared route-state parser rejects. `SurfaceRoutePersistence.persist` validates the complete record at `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:69-84` and skips `setState` when validation returns `null`. The allowed panel IDs are defined in `libs/shared/src/lib/types/webview-route-state.ts:31-37,180-189`.
- Changed the spec host fixture to `ptah.panel.builder-route-test`, a valid editor panel ID. The assertion still requires the persisted route to contain both the mode and tab ID. No production change was needed.
- Focused verification: `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/app.routes.spec.ts --coverage=false --maxWorkers=2` passed (4/4 tests). The orchestrator reported typecheck and lint passed for both affected projects.
