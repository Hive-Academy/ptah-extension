# P2 review fix gate 2

## New Finding 4 and Per-Finding Status 7

- Fresh install: `review:getBotIdentity` now uses the default repository and persists the verified gate (`review-rpc.handlers.ts:90-93`). `ReviewSettingsStore.setLiveGate` seeds default settings if no row exists (`review-settings.store.ts:96-107`). Regression: `review-rpc.handlers.spec.ts:55-65`.
- First live save: `review:updateSettings` validates the gate, saves settings, then records the attestation; repository-change invalidation is guarded by `old` (`review-rpc.handlers.ts:157-175`). Regression: `review-rpc.handlers.spec.ts:67-87`.
- Token replacement: the drawer opens the live permission confirmation when an active live draft receives a new token (`review-settings-drawer.component.ts:109-114`). The store falls back to the first allowlisted maintainer login for a blank attestor field (`review-runs.store.ts:174`). Regression: `review-settings-drawer.component.spec.ts:43-62` and the existing token-clear host test.

## Three UI Jest failures

- Live rerun spec now acknowledges the permission checkbox before clicking the disabled confirmation button (`review-run-detail.component.spec.ts:42-43`). The component behavior was correct.
- Drawer specs provide `tokenStorage`, `attestorLogin`, and `liveAttested` signal mocks consumed by the component (`review-settings-drawer.component.spec.ts:8,23`). The component behavior was correct.

## Verification

- Frontend Jest: 7 suites passed, 23 tests passed, full suite with `--runInBand`.
- RPC review Jest: 1 suite passed, 27 tests passed, exact review spec path with `--runInBand`.
- Electron Jest, full requested 10 paths: 8 suites passed, 2 failed; 81 tests passed, 4 failed. The three DI failures were caused by listing publication services in `EXPECTED_RESOLVABLE` for the shared-handler-only minimal container. Removed those entries (`apps/ptah-electron/src/di/expected-resolvable.ts:25-32,46-52`); targeted `container.smoke.spec.ts` rerun passed all 50 tests, but Jest exited 1 afterward because an unrelated asynchronous SQLite session usage sink required `better-sqlite3` after teardown. The remaining full-run failure is `review-command-runner.spec.ts:31`, where the sandbox rejected spawning `node --version` with `EPERM`.
- Frontend `tsconfig.lib.json`: passed.
- Frontend `tsconfig.spec.json`: failed only on unchanged `libs/shared` BigInt literals because the spec target is below ES2020.
- RPC handlers `tsconfig.lib.json`: passed.
- RPC handlers `tsconfig.spec.json`: passed.

The first unmodified UI Jest command failed before tests with worker `spawn EPERM`; the in-band rerun passed. A broad positional `review` pattern also matched all RPC specs because this worktree path contains `ptah-review-p2`; unrelated install-scope specs hit Windows `EPERM`, so the review spec was rerun by exact path.

Skill discovery: no matching `SKILL.md` was found in the workspace, so the project Angular guidance was applied directly. No publication, stage, lane, or SQLite repository files owned by the other lane were edited.
