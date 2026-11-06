
## Changes

Files changed: `libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts`, `capability-matrix.store.spec.ts`, `libs/backend/lane-routing/src/lib/route-decide.service.ts`, `libs/backend/lane-routing/src/index.ts`, `libs/backend/rpc-handlers/src/lib/handlers/capability-matrix-rpc.handlers.ts`, `capability-matrix-rpc.handlers.spec.ts`, `capability-matrix-rpc.schema.ts`, `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`, `libs/shared/src/lib/types/rpc/rpc-capability-matrix.types.ts`, `libs/frontend/chat/src/lib/settings/ptah-ai/lane-rotation-setting.component.ts`, and `lane-rotation-setting.component.spec.ts`.

- `lane-routing`: `CapabilityMatrixStore.readMergedView()` returns the merged user/local/seed view with source, sample counts and explicit `unknown` cells. It reuses recent routing outcome queries for local derivation. Exported the view types and read port, plus `RotationStateReader` and `RotationPick`, through the public index. A matrix store regression test checks an unknown cell and local sample count.
- `rpc-handlers`: `agent:getCapabilityMatrix` resolves a typed matrix read port; missing registration still fails with `PERSISTENCE_UNAVAILABLE`. The response includes optional `lastPicks` from the typed route service read port. Zod parses matrix and rotation picks. Removed duck typing and corrected the host manifest comment. A handler test checks last picks.
- `shared`: added optional `lastPicks` to the capability matrix result. No new RPC method was registered.
- `chat`: the Electron rotation setting displays saved last picks. Its component test checks the display. The capability matrix component already uses standalone OnPush signals and renders typed scores, sample counts and unrated cells without `innerHTML`; no edit was needed.

## Verification

- `npm run verify -- -p @ptah-extension/lane-routing,@ptah-extension/rpc-handlers,@ptah-extension/chat,@ptah-extension/shared`: lint/typecheck `NX 8 tasks: 8 succeeded`; test `NX 4 tasks: 3 succeeded, 1 failed` (`@ptah-extension/rpc-handlers:test`). The run exited 1.
- The saved Nx output for `rpc-handlers:test` reports `Test Suites: 13 failed, 222 passed, 235 total` and `Tests: 36 failed, 8 skipped, 6160 passed, 6204 total`. `capability-matrix-rpc.handlers.spec.ts` is absent from the failure list; its new rotation assertion passed. The failing suites are unrelated to the changed handler: e.g. `skills-synthesis-rpc.handlers.spec.ts` resolves a temporary harness root to the Temp parent, `install-scope-migration.service.spec.ts` cannot create Windows symlinks (`EPERM`), and `session-folder.spec.ts` similarly fails on symlink creation. R2's earlier report already documents the skills-synthesis temporary-root failure. These are pre-existing environment/test failures; none exercises the capability matrix handler.
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns=capability-matrix-rpc.handlers.spec.ts --coverage=false --maxWorkers=2`: `NX 1 task: 1 succeeded`; exit code 0. Nx's dynamic output style printed task counts rather than the requested `Running target ... for N projects` header; the commands explicitly name four and one project respectively, and the summaries confirm four and one test tasks.
- Scoped `ptah_get_diagnostics` on the changed routing, handler and rotation component files was unavailable after 45 seconds; the subsequent Nx typecheck passed.

## Decisions

- Last picks travel in the existing `agent:getCapabilityMatrix` response because both values are read-only data for the Electron settings section. This avoids a new manifest and RPC surface entry. It is additive and reversible.
- The matrix reader uses the store's last outcome queries. The outcome reader requires lane IDs and offers no all-lanes read. Before any route has supplied lane IDs, the view contains user and seed cells; later reads include local derivation for those lanes. This choice is reversible if an all-lanes outcome read is added.
- An unavailable matrix store fails closed; an unavailable rotation read leaves out `lastPicks` while preserving the matrix result.

## Limits

- The host skill-loading tool was not available to this lane, so `angular-frontend-patterns` could not be loaded. Existing component conventions were followed.
- No separate `routing:getRotation` RPC or Electron `rpc-surface.spec.ts` change was needed because picks are included in the existing capability matrix response.

