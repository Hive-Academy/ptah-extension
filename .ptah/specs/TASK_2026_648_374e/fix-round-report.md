# Fix-round report — TASK_2026_648_374e

## Changed files

- `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts`
- `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.spec.ts`

## Fix

`conductor-tile.component.ts:212-218` registers the current correlation ID in an Angular effect and captures that same ID for cleanup. A correlation change unregisters A before registering B; component destruction unregisters B. Registration was removed from `ngOnInit` and unregistration from `ngOnDestroy`; child injector creation and destruction remain in those hooks.

## Tests added

- `conductor-tile.component.spec.ts:157`: A at creation, A cleanup before B registration on change, B cleanup on destruction, and no unregister for an unregistered ID.
- `conductor-tile.component.spec.ts:188`: null correlation makes neither visibility call, including at destruction.

No existing assertions needed adjustment.

## Verification

| Command | Passed | Failed |
| --- | ---: | ---: |
| `npx prettier --write` on the two changed files | 2 files | 0 |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/tribunal-panel --parallel=1` | 2 targets | 0 |
| `npx nx test @ptah-extension/tribunal-panel --parallel=1 --maxWorkers=2` | 17 suites, 338 tests | 0 suites, 0 tests |

Scoped `ptah_get_diagnostics` returned unavailable after its 45-second TypeScript timeout; the requested Nx typecheck passed. Nx also reported an unrelated Nx Cloud 401 while all local targets succeeded.

## Decisions

- **Use a component effect with cleanup.** Options were lifecycle-hook registration or effect-based registration. `SessionEmbedComponent` already uses the effect pattern, and `TribunalRunService.prepare` can replace the correlation ID while the tile remains mounted. This is reversible within the component.
- **Test call order and the null case.** The reference-counted visibility API requires a matching unregister for each registered ID. These focused assertions exercise that contract without changing the mock service. This is reversible.

## Deviations

None. No existing behavior or test expectation was changed beyond the requested visibility lifetime fix.
