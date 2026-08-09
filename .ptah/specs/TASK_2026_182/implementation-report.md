# TASK_2026_182 — Implementation report

## Self-skipping projects discovered

A project is included when its test suite gates whole `describe`/`it` blocks on
whether a native-ABI addon (`better-sqlite3`, `sqlite-vec`, etc.) can load.

The list was proven by grepping the repo for the guard patterns. A file that
uses one of these guards belongs to the project that owns its `jest.config.ts`.

```bash
# Variable used by the guard
grep -R "nativeAvailable" --include="*.spec.ts" D:/projects/ptah-extension

# better-sqlite3 probe used as a describe/it gate
grep -R "loadBetterSqlite3\|Database ? describe : describe.skip\|Database ? it : it.skip" --include="*.spec.ts" D:/projects/ptah-extension
```

The first grep found `nativeAvailable` guards in these projects:

- `apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts`
- `libs/backend/memory-curator/**/*.spec.ts`
- `libs/backend/messaging-gateway/**/*.spec.ts`
- `libs/backend/persistence-sqlite/**/*.spec.ts`
- `libs/backend/skill-synthesis/**/*.spec.ts`

The second grep found the `loadBetterSqlite3()` / `Database` guard in:

- `libs/backend/persistence-sqlite/**/*.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`
- `libs/backend/task-specs/src/lib/task-index.store.spec.ts`

No other project in the workspace has a top-level test gate driven by a native
ABI module (`better-sqlite3`, `sqlite-vec`, `node-pty`, `onnxruntime-node`, or
similar).

### Full list of native-ABI self-skipping projects

1. `persistence-sqlite`
2. `task-specs`
3. `rpc-handlers`
4. `messaging-gateway`
5. `skill-synthesis`
6. `memory-curator`
7. `ptah-electron`

## Files changed

- `D:/projects/ptah-extension/scripts/native-abi-projects.json` — new single
  source of truth for the native-ABI project list.
- `D:/projects/ptah-extension/scripts/test-native.mjs` — reads the list from the
  JSON file, resolves jest configs for both `libs/backend/<project>` and
  `apps/<project>`, and uses a per-project Jest cache directory to avoid the
  shared-cache EPERM flakiness described in the task context.
- `D:/projects/ptah-extension/.ptah/specs/TASK_2026_182/task.md` — status set
  to `done`.

No library source files were changed. The blocked paths
(`libs/frontend/ui/**`, `libs/api/**`, `libs/web/**`,
`apps/ptah-license-server/**`) were not touched.

## Runner output — before

Command: `node scripts/test-native.mjs` (before the fix).

```text
[test:native] persistence-sqlite — electron-as-node (ABI-matched)
Test Suites: 18 passed, 18 total
Tests:       145 passed, 145 total

[test:native] task-specs — electron-as-node (ABI-matched)
Test Suites: 14 passed, 14 total
Tests:       380 passed, 380 total
```

Only `persistence-sqlite` and `task-specs` were executed; `rpc-handlers`,
`messaging-gateway`, `skill-synthesis`, `memory-curator`, and `ptah-electron`
were not in the hardcoded `DEFAULT_PROJECTS` array, and `ptah-electron` was
unreachable anyway because the script only looked under `libs/backend/<project>`.

## Runner output — after

Command: `node scripts/test-native.mjs` (after the fix).

```text
[test:native] persistence-sqlite — electron-as-node (ABI-matched)
Test Suites: 18 passed, 18 total
Tests:       145 passed, 145 total

[test:native] task-specs — electron-as-node (ABI-matched)
Test Suites: 14 passed, 14 total
Tests:       380 passed, 380 total

[test:native] rpc-handlers — electron-as-node (ABI-matched)
Test Suites: 71 passed, 71 total
Tests:       2 skipped, 1632 passed, 1634 total

[test:native] messaging-gateway — electron-as-node (ABI-matched)
Test Suites: 12 passed, 12 total
Tests:       224 passed, 224 total

[test:native] skill-synthesis — electron-as-node (ABI-matched)
Test Suites: 29 passed, 29 total
Tests:       380 passed, 380 total

[test:native] memory-curator — electron-as-node (ABI-matched)
Test Suites: 24 passed, 24 total
Tests:       369 passed, 369 total

[test:native] ptah-electron — electron-as-node (ABI-matched)
Test Suites: 13 passed, 13 total
Tests:       139 passed, 139 total
```

All seven projects now run under the ABI-matched Electron Node runner.

## Proof that a newly-covered project actually ran

`messaging-gateway` was not executed by the default runner before the change.
After the change it is taken from the shared list and resolved through the new
`apps/` + `libs/backend/` config lookup. Its full suite executed:

```text
[test:native] messaging-gateway — electron-as-node (ABI-matched)
Test Suites: 12 passed, 12 total
Tests:       224 passed, 224 total
```

`ptah-electron` also demonstrates the fixed app-path resolution: the runner now
finds `apps/ptah-electron/jest.config.ts` and executes its integration suite
(`wizard-seed.integration.spec.ts`), which previously could not even be named.

## Notes

- The first after-run hit the known Jest shared-cache `EPERM` flakiness on
  `skill-synthesis`. The runner now passes a per-project `--cacheDirectory`
  under `node_modules/.cache/test-native/<project>` and deletes it before each
  run, which isolates the cache and prevents cross-process contention. The
  re-run passed cleanly.
- Full logs are saved in the gitignored task folder:
  - `D:/projects/ptah-extension/.ptah/specs/TASK_2026_182/before-list.log`
  - `D:/projects/ptah-extension/.ptah/specs/TASK_2026_182/before-run.log`
  - `D:/projects/ptah-extension/.ptah/specs/TASK_2026_182/after-list.log`
  - `D:/projects/ptah-extension/.ptah/specs/TASK_2026_182/after-run.log`
