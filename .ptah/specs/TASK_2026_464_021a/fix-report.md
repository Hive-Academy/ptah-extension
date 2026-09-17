# TASK_2026_464 Fix Report

## Changes

1. Added a named 120,000 ms timeout for the `tasks:reindex` RPC call in `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:56` and applied it at `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1557`. Coverage: `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts:286`.
2. Replaced the per-carrier `exists` plus `readFile` pair with one `readFile`, mapping Electron/Node `ENOENT` and VS Code `FileNotFound` to `no_carrier` while retaining `unreadable` for other failures in `libs/backend/task-specs/src/lib/task-scanner.service.ts:71` and `libs/backend/task-specs/src/lib/task-scanner.service.ts:214`. Coverage: `libs/backend/task-specs/src/lib/task-scanner.service.spec.ts:93`.
3. Added an eight-worker inline scan pool that writes results into their original folder indexes, preserving deterministic task/exclusion order and leaving the existing `knownFolders` and cross-file merge passes intact in `libs/backend/task-specs/src/lib/task-scanner.service.ts:69` and `libs/backend/task-specs/src/lib/task-scanner.service.ts:133`. Coverage verifies one carrier read per folder, concurrency greater than one and no greater than eight, and stable output order at `libs/backend/task-specs/src/lib/task-scanner.service.spec.ts:111`.
4. Changed lazy start to return its rebuild result. `reindex()` now reuses a just-completed successful start rebuild, but performs the explicit rebuild when start did not write the index, and emits `reason: 'reindex'` in either successful path at `libs/backend/task-specs/src/lib/task-index.service.ts:161` and `libs/backend/task-specs/src/lib/task-index.service.ts:270`. Coverage pins one scan plus the emitted event at `libs/backend/task-specs/src/lib/task-index.service.spec.ts:586`.
5. Kept the explicit successful-reindex `loadBoard()` call at `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1565`. It runs after the reindex RPC returns and deliberately uses the non-coalescing post-write fetch path. Coverage asserts both the 120,000 ms reindex timeout and the subsequent `tasks:board` reload at `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts:286`.
6. Added or updated focused specs for the timeout, explicit board reload, both adapter missing-file codes, bounded/order-preserving scanning, and start-rebuild reuse in the three permitted spec files listed above.

## Decisions

- Item 2: One-call missing-carrier detection is reliable on both target adapters. Electron delegates directly to `fs/promises.readFile` (`libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:23`), which reports missing paths as `ENOENT`. VS Code delegates to `vscode.workspace.fs.readFile` (`libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts:53`), whose `FileSystemError` exposes the stable `code` property and reports missing reads as `FileNotFound` (`node_modules/@types/vscode/index.d.ts:9506`, `node_modules/@types/vscode/index.d.ts:9553`). Therefore the carrier-level `exists()` call was removed.
- Item 5: Kept the explicit post-success `loadBoard()`. The push path calls coalescing `refreshBoard`, so it may join a board request that began before the reindex; `loadBoard()` intentionally never joins an in-flight request and guarantees an authoritative post-write fetch. Pushes can also be dropped during a bulk action or while no Tasks surface is mounted. The explicit reload happens only after the reindex RPC has returned, so it does not consume the reindex timeout budget.

## Review round 1

- Restored `await this.loadBoard()` after successful reindex and revised the focused Tasks store spec to require the explicit board reload alongside the 120,000 ms RPC timeout.
- Expanded verification to the two direct projects plus `@ptah-extension/rpc-handlers` and `@ptah-extension/vscode-lm-tools`, covering consumers of `TaskIndexService.ensureStarted` and scanner behavior. All consumer tests and typechecks passed; no consumer spec required modification.
- The four-project test run reported existing Jest worker force-exit warnings for Tasks UI and VS Code LM Tools, but every suite and test passed and Nx returned success.

## Verification

- PASS — `npx nx run-many -t test -p @ptah-extension/task-specs @ptah-extension/tasks-ui @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools`

  ```text
  NX   Running target test for 4 projects:
  - @ptah-extension/task-specs
  - @ptah-extension/tasks-ui
  - @ptah-extension/rpc-handlers
  - @ptah-extension/vscode-lm-tools
  Test Suites: 18 passed, 18 total
  Tests:       23 skipped, 493 passed, 516 total
  Test Suites: 17 passed, 17 total
  Tests:       588 passed, 588 total
  Test Suites: 50 passed, 50 total
  Tests:       1161 passed, 1161 total
  Test Suites: 101 passed, 101 total
  Tests:       33 skipped, 3018 passed, 3051 total
  NX   Successfully ran target test for 4 projects
  Nx read the output from the cache instead of running the command for 1 out of 4 tasks.
  ```

- PASS — `npx nx run-many -t typecheck -p @ptah-extension/task-specs @ptah-extension/tasks-ui @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools`

  ```text
  NX   Running target typecheck for 4 projects:
  - @ptah-extension/task-specs
  - @ptah-extension/tasks-ui
  - @ptah-extension/rpc-handlers
  - @ptah-extension/vscode-lm-tools
  > tsc --noEmit --project libs/backend/task-specs/tsconfig.lib.json
  > tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json
  > tsc --noEmit --project libs/backend/rpc-handlers/tsconfig.lib.json
  > npx ngc --noEmit --project libs/frontend/tasks-ui/tsconfig.lib.json
  NX   Successfully ran target typecheck for 4 projects
  ```

- PASS — `npx nx run-many -t lint -p @ptah-extension/task-specs @ptah-extension/tasks-ui`

  ```text
  NX   Running target lint for 2 projects:
  - @ptah-extension/task-specs
  - @ptah-extension/tasks-ui
  @ptah-extension/task-specs: 1 problem (0 errors, 1 warning)
  @ptah-extension/tasks-ui: 3 problems (0 errors, 3 warnings)
  NX   Successfully ran target lint for 2 projects
  Nx read the output from the cache instead of running the command for 1 out of 2 tasks.
  ```
