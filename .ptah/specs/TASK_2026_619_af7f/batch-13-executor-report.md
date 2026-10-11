## Summary

Electron and the long-lived CLI tier now start one governed background `indexWorkspace` at boot and refresh the symbol index from `IWorkspaceWatcher`. Boot does not await the run. A burst at or above 25 paths, or an overflow or truncated batch, becomes one full run. A run already in flight queues at most one follow-up. A delete removes that file's rows through `ISymbolSink.deleteSymbolsForFile`. `dispose()` is idempotent.

## Files changed (absolute paths)

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.spec.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\boot-thoth-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\boot-thoth-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\index.ts` (59 lines)
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts`

No `project.json` or tag change. `thoth-runtime` is `type:feature` and already imports `@ptah-extension/workspace-intelligence`. The new imports (`platform-core`, `memory-contracts`) are `type:core`, which `type:feature` may depend on (`eslint.config.mjs` depConstraints).

## Criteria met (file:line for each requirement)

- Governed background full run at boot, not awaited: `workspace-index-lifecycle.ts:164-168` calls `requestFullRun()` and returns; `requestFullRun` at `270-272` passes only `{ signal }`, so `userInitiated` stays unset and `CodeSymbolIndexer.indexWorkspace` keeps its governor (`code-symbol-indexer.service.ts:67-74`). Boot calls `lifecycle.start()` at `boot-thoth-runtime.ts:567` with no `await`. CLI calls `startWorkspaceIndex` at `thoth-runtime.ts:152` with no `await`, before the existing awaited subsystem starts.
- One failure logged once: a rejected `indexWorkspace` hits one `catch` at `workspace-index-lifecycle.ts:281-286` and `onError` once. Boot prints that through `console.warn` at `boot-thoth-runtime.ts:560-565`. CLI uses `logger.warn` at `thoth-runtime.ts:256-259`. AbortError is not logged (`283-284`).
- Debounced per-file `reindexFile`: `schedule` at `workspace-index-lifecycle.ts:213-236`, default 500 ms (`59`).
- Storm coalescing, one full run: overflow, truncated, or `changes.length >= 25` calls `requestFullRun` at `201-208`. Default threshold `62-65`. Watch batch interval 750 ms (`73-77`, `123`) so a parcel burst is one overflow.
- In-flight run queues at most one follow-up: `262-264` and `289-293`.
- Delete removes rows: `apply` at `244-248` calls `deleteSymbolsForFile`. The concrete indexer has no public delete. `workspaceSymbolIndexFrom` at `91-104` forwards to `ISymbolSink.deleteSymbolsForFile`.
- Idempotent `dispose()`: `187-198` returns on the second call, clears timers, disposes the subscription once, aborts the run.
- No vscode import. VS Code `wire-runtime.ts` was not edited.
- Electron shutdown already calls `refs.symbolWatcher.close()` (`apps/ptah-electron/src/activation/shutdown.ts:222`). Boot stores a `close()` that disposes the lifecycle at `boot-thoth-runtime.ts:571-576`. The host abort signal also disposes (`568-570`).
- CLI runtime tier only: `thoth-runtime.ts:144-152` returns on `oneshot` before `startWorkspaceIndex`. `disposeThoth` disposes it at `179-181` before SQLite close.
- Barrel export: `libs/backend/thoth-runtime/src/index.ts:53-58`.
- `IWorkspaceWatcher` is bound on both hosts when a watch host is supplied. Electron always supplies one (`apps/ptah-electron/src/di/phase-0-platform.ts:46-51` into `platform-electron/src/registration.ts:189-194`). CLI always supplies one (`cli-engine/src/lib/container.ts:403-406` into `platform-cli/src/registration.ts:111-116`). No adapter was added.

## Write-path trace (watcher event -> indexer -> store)

1. `IWorkspaceWatcher.watch` delivers a `WorkspaceChangeBatch` to `WorkspaceIndexLifecycleService.onBatch`.
2. A create or update, after the 500 ms debounce and path normalization (`normalizeSymbolPath`), calls `CodeSymbolIndexer.reindexFile`. That method calls `indexFileRecorded` and `ISymbolSink.replaceFileSymbols` (one transaction in `CodeSymbolStore`).
3. A delete calls `ISymbolSink.deleteSymbolsForFile` (`memory-contracts` `symbol-sink.port.ts:24`). `MemoryStoreSymbolSink.deleteSymbolsForFile` (`symbol-sink.adapter.ts:32-34`) calls `CodeSymbolStore.deleteByFile` (`code-symbol.store.ts:282-284`), which deletes that file's `code_symbols` rows (and the vec rows the store already deletes with them).
4. A full run calls `CodeSymbolIndexer.indexWorkspace` without `userInitiated`. The indexer waits on the governor per batch and, on a complete run, `purgeMissing` drops rows whose paths are gone.
5. Both boots resolve `CODE_SYMBOL_INDEXER` (`Symbol.for('PtahCodeSymbolIndexer')`) and, when registered, `MEMORY_CONTRACT_TOKENS.SYMBOL_SINK`. CLI registers that sink in `register-thoth-libraries.ts:228-232`. The memory-curator register binds the same token to `MemoryStoreSymbolSink`.

## Tests added

- `workspace-index-lifecycle.spec.ts`: boot returns before the run settles and omits `userInitiated`; one rejection logs once; repeated events on one file become one `reindexFile`; a 3-path storm and an overflow each start one full run; events during an in-flight run produce one follow-up and no per-file reindex; a delete (last kind in the debounce window) calls `deleteSymbolsForFile` with forward slashes; `dispose` twice unsubscribes once, aborts the signal, and drops timers; the sink adapter normalizes a Windows path and returns 0 when no sink is bound.
- `boot-thoth-runtime.spec.ts`: background index is not awaited; `symbolWatcher.close()` is safe twice; one failure logs once; a closed SQLite connection does not call `indexWorkspace`. The existing RPC run-deps test still expects `userInitiated: true` on the click path only.
- `cli-engine` `thoth-runtime.spec.ts`: runtime tier starts `indexWorkspace` and `watch` without awaiting, and `disposeThoth` unsubscribes once even when called twice; oneshot does neither; one runtime failure logs once.

## Checks run (command + last lines)

- `node D:\projects\ptah-extension\node_modules\jest\bin\jest.js -c libs/backend/thoth-runtime/jest.config.ts libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.spec.ts libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts --coverage=false --maxWorkers=2`
  - Lifecycle suite: `PASS` `Tests: 9 passed`. The same invocation exited 1 because the boot suite could not resolve `marked` from the worktree `node_modules` (preset maps `^marked$` to `<rootDir>/node_modules/marked/lib/marked.umd.js`).
- Boot suite retried with `--moduleNameMapper` `^marked$` -> `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js` (plus the project's vscode and wasm mappers), via `node` so PowerShell did not strip the JSON:
  - `PASS libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts` `Tests: 28 passed, 28 total` exit 0.
- `node .../jest.js -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts --coverage=false --maxWorkers=2` with the same marked mapper:
  - `PASS` `Tests: 25 passed, 25 total` exit 0. Includes `activateThoth workspace index` (2) and the existing runtime/oneshot cases.
- `node D:\projects\ptah-extension\node_modules\nx\dist\bin\nx.js typecheck @ptah-extension/thoth-runtime --parallel=1` — `Successfully ran target typecheck` exit 0.
- `node .../nx.js typecheck @ptah-extension/cli-engine --parallel=1` — `Successfully ran target typecheck` exit 0.
- `node .../nx.js lint @ptah-extension/thoth-runtime --parallel=1` — `All files pass linting` exit 0.
- `node .../nx.js lint @ptah-extension/cli-engine --parallel=1` — exit 0. Two pre-existing warnings in `cli-adapters.ts` and `cli-webview-manager-adapter.spec.ts`, neither file touched here. 0 errors.
- `prettier --check` on the seven paths above — `All matched files use Prettier code style!` exit 0.
- `ptah_get_diagnostics` on the edited sources returned unavailable twice: `TypeScript check still running after 45s`. `nx typecheck` is the completed check.

## Decisions (decision, options, evidence, reversible)

- CLI "full" means the `runtime` tier, not `withEngine` `mode: 'full'`. Options: start on `mode === 'full'`, or start on `tier === 'runtime'`. Evidence: `with-engine.ts:147-179` — `mode` is RPC depth and `thoth` defaults to `'off'`; `apps/ptah-cli/src/cli/commands/thoth-command-shared.ts` uses `mode: 'full'` with `thoth: 'oneshot'` for commands that exit immediately; `interact.ts:280` uses `thoth: 'runtime'`. Starting on `mode === 'full'` would index one-shot commands. Reversible: move the `startWorkspaceIndex` call if a later batch wants another gate.
- Delete goes through the sink, not a new indexer method. Options: add `CodeSymbolIndexer.deleteFile` (out of the file list; store already has `deleteByFile`), or adapt `ISymbolSink.deleteSymbolsForFile`. Evidence: indexer public methods are `indexWorkspace`, `getCoverage`, `reindexFile` (`code-symbol-indexer.service.ts`). `reindexFile` on a missing file returns a read failure and leaves rows (`1101-1114`). Reversible: point `deleteSymbolsForFile` at an indexer method when one exists.
- Electron dispose reuses `symbolWatcher.close()`. Options: add a field on `ThothRuntimeRefs` (would not be closed unless `shutdown.ts` changed, which this batch cannot), or implement `close()` on the existing field. Evidence: `shutdown.ts:222` and `boot-heavy-services.ts:183`. Reversible: replace the cast when Batch 14 or a types edit gives the ref its own disposable.
- The service depends on a narrow `WorkspaceSymbolIndex` plus `IWorkspaceWatcher`, constructed with `new` at the two boot sites. No new DI token. Evidence: boot already resolves `CODE_SYMBOL_INDEXER` in place. Reversible: register a token next to that resolve.

## Not done

- VS Code `wire-runtime.ts` is unchanged. Batch 14 owns that swap. VS Code does not call `bootThothRuntime`, so this batch does not double-index saves.
- This lane did not run the lifecycle smoke (live workspace scan). `ptah_get_diagnostics` did not finish in the first lane; Revision 2 used `nx typecheck` instead.
- `ptah mcp-serve` and the bench host were not edited in Revision 2. They already pass `workspaceIndex: true` (Revision 1). Revision 2 stops `withEngine` from awaiting SQLite open on that path.
- No second extension list was added. `classifyFileForCoverage` is already exported from `@ptah-extension/workspace-intelligence`. The workspace-intelligence barrel was not modified.

## Revision 1 — mcp-serve and bench host

### Design choice

`withEngine` is the only start site for every engine host. It sets `startIndex = opts.workspaceIndex ?? (thoth === 'runtime')` (`with-engine.ts:381`), calls `activateThoth` with `{ workspaceIndex: false }` (`with-engine.ts:386-388`) so the runtime tier cannot start a second copy, then calls `startWorkspaceIndexLifecycle` once (`with-engine.ts:399-405`). The `await` there is only `openAndMigrate` when SQLite is still closed (`cli-workspace-index.ts:49-50`). `lifecycle.start()` is not awaited (`cli-workspace-index.ts:109`). Dispose runs in `withEngine`'s `finally` before `disposeThoth` (`with-engine.ts:418-434`). SQLite is closed on that dispose only when this call opened it (`cli-workspace-index.ts:66-70`).

Direct `activateThoth(container, 'runtime', logger)` with no fourth argument still starts the index (`thoth-runtime.ts:160-164` → `startWorkspaceIndex` at `thoth-runtime.ts:240-248`) so the existing tier spec stays green. `withEngine` never takes that branch.

`mcp-serve` stays on thoth `'off'` (`mcp-serve.ts:260` does not set `thoth`). `activateThoth` is not called, so cron, gateways, skill synthesis, and the memory curator do not start. The bench host keeps `thoth: 'oneshot'` and adds `workspaceIndex: true` (`bench-host-boot.ts:423-426`).

The starter moved from `thoth-runtime.ts` into `cli-workspace-index.ts` and is re-exported (`thoth-runtime.ts:56`). `thoth-runtime.ts` had crossed `max-lines` 700 (711 counted). After the move, cli-engine lint is 0 errors.

### Files

- `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`
- `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts`
- `libs/backend/cli-engine/src/lib/bootstrap/cli-workspace-index.ts` (new; the single starter)
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` (re-export; runtime-tier start gated)
- `apps/ptah-cli/src/cli/commands/mcp-serve.ts`
- `apps/ptah-cli/src/cli/commands/mcp-serve.spec.ts`
- `tools/mcp-bench/src/transport/bench-host-boot.ts`
- `tools/mcp-bench/src/transport/bench-host-boot.spec.ts`

### Criteria

- Option `workspaceIndex?: boolean` defaults true only for thoth `'runtime'`: `with-engine.ts:183-188`, `with-engine.ts:381`.
- One start, no double start on runtime: `with-engine.ts:386-388` passes `workspaceIndex: false`; `with-engine.spec.ts:1213-1229` expects that fourth argument, one `startWorkspaceIndexLifecycle` call, and one dispose.
- Oneshot and off with `workspaceIndex: true` start once and dispose on shutdown: `with-engine.spec.ts:1232-1262`. Off does not call `activateThoth` or `disposeThoth` (`with-engine.spec.ts:1257-1262`).
- Default oneshot and default or explicit off do not start: `with-engine.spec.ts:1166-1177`, `1180-1189`, `1192-1205`.
- Dispose on every tier: `with-engine.ts:418-420`. Handles opened by oneshot or runtime still close in `disposeThoth`.
- Scan is not awaited. `cli-workspace-index.ts:109` calls `lifecycle.start()` and returns.
- mcp-serve passes the option and does not start the rest of thoth: `mcp-serve.ts:260`; spec `mcp-serve.spec.ts:769-773`.
- Bench host passes the option and keeps oneshot: `bench-host-boot.ts:423-426`; exact call `bench-host-boot.spec.ts:204-213`; `toMatchObject` at `bench-host-boot.spec.ts:368-372` still requires `thoth: 'oneshot'`.

### Tests

- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts` — 25 passed (re-run after the move). Exit 0.
- `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts` — 53 passed. Exit 0. Ran before the extract; the spec mocks `./thoth-runtime.js`, and typecheck covers the re-export.
- `apps/ptah-cli/src/cli/commands/mcp-serve.spec.ts` — 20 passed. Exit 0.
- `tools/mcp-bench/src/transport/bench-host-boot.spec.ts` — 22 passed. Exit 0. `RG_PATH` set to `D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe`.

### Checks

- `nx typecheck @ptah-extension/cli-engine` — `Successfully ran target typecheck` (again after the extract, run duration 17.5s). Exit 0.
- `nx typecheck ptah-cli` — `Successfully ran target typecheck for project ptah-cli` (15.4s). Exit 0.
- `nx typecheck mcp-bench` — `Successfully ran target typecheck for project mcp-bench` (15.0s). Exit 0.
- `nx lint @ptah-extension/cli-engine --parallel=1` — exit 0. `Successfully ran target lint`. 0 errors, 2 pre-existing warnings (`cli-adapters.ts:249`, `cli-webview-manager-adapter.spec.ts:159`). The `thoth-runtime.ts` max-lines warning is gone.
- `nx lint ptah-cli --parallel=1` — exit 0. `Successfully ran target lint for project ptah-cli`. 0 errors, 135 pre-existing warnings.
- `nx lint mcp-bench --parallel=1` — exit 0. `Successfully ran target lint for project mcp-bench`. 0 errors, 2 warnings in files this revision did not edit (`scip-cross-check.ts`, `bench-host-process.spec.ts`).
- `prettier --check` on the eight revision files — `All matched files use Prettier code style!` Exit 0.

## Revision 2

Code-logic review `code-logic-review-b13.md` was REVISE 5/10. Three moderate defects. No workspace-intelligence barrel change: `classifyFileForCoverage` is already exported.

### 1. Directory delete

A delete whose path is not an indexer source file (`classifyFileForCoverage(path, 'codeIndex') !== 'eligible'`, the same predicate as defect 3) no longer calls `deleteSymbolsForFile`. The batch sets one flag and `requestFullRun()` once, so a burst is one census. The census purges descendants. A supported-extension delete still takes the per-file path.

- Filter and coalesce: `libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts:241-270` (`unsupportedDelete` at 244, set at 251-253, single `requestFullRun` at 258-266).
- Predicate: `workspace-index-lifecycle.ts:88-96`.
- Supported delete kept: `workspace-index-lifecycle.ts:301`.
- Test: `workspace-index-lifecycle.spec.ts:251` — one directory delete is one `indexWorkspace` and zero `deleteSymbolsForFile`; three directory deletes in the next batch are one `indexWorkspace` and zero per-file deletes.

### 2. mcp-serve must not await SQLite open

`startWorkspaceIndexLifecycle` is synchronous. It returns a dispose handle and runs `openAndMigrate` (only when the connection is closed) then `attachWorkspaceIndex` / `lifecycle.start()` on a background promise (`cli-workspace-index.ts:32-112`). `withEngine` assigns that handle and does not await it (`with-engine.ts:399-405`). `dispose()` before the promise settles sets a flag checked after `await openAndMigrate` (`cli-workspace-index.ts:85-98`) so `start()` never runs, and closes SQLite only if this call opened it. An open rejection is logged once (`cli-workspace-index.ts:42-47` and `81-83`; the outer `pending.catch` uses the same flag). The runtime tier's own `openAndMigrate` in `activateThoth` is unchanged.

- Tests: `with-engine.spec.ts:1250` — serving callback returns `'ready'` while the starter's promise never settles (2 ms; a 250 ms race). `cli-workspace-index.spec.ts:64` — dispose before `openAndMigrate` resolves, `indexWorkspace` never called, `close` once. `cli-workspace-index.spec.ts:82` — open rejection logged once, handle already returned, `indexWorkspace` never called.

### 3. Watcher filter before scheduling

Events are filtered before the storm count. Database artifacts are the file at `databasePath` plus its `-wal`, `-shm`, and `-journal` siblings (`workspace-index-lifecycle.ts:98-112`), dropped for every kind, so they do not count toward the storm threshold and a database delete does not become a full run. Non-delete events that are not indexer source paths are dropped the same way. `.ts` updates still debounce to `reindexFile`.

`WorkspaceIndexLifecycleService` has no container. The option is `databasePath` (`workspace-index-lifecycle.ts:49-56`). Hosts pass `SqliteConnectionService.dbPath`, which both call sites can already resolve: `boot-thoth-runtime.ts:79-90` and `:580`; `cli-workspace-index.ts:160-172` and `:138`. `:memory:` excludes nothing.

- Test: `workspace-index-lifecycle.spec.ts:279` — sqlite, `-wal`, `-shm`, `-journal`, and a sqlite delete, plus three `.md` updates (storm threshold 3), schedule nothing; a `.ts` update calls `reindexFile` once.

### Checks

- Jest thoth-runtime `workspace-index-lifecycle.spec.ts` + `boot-thoth-runtime.spec.ts`: `Test Suites: 2 passed, 2 total` / `Tests: 39 passed, 39 total`. Exit 0.
- Jest cli-engine `with-engine.spec.ts` + `cli-workspace-index.spec.ts` after Prettier: `Test Suites: 2 passed, 2 total` / `Tests: 56 passed, 56 total`. Exit 0. (`with-engine.spec.ts` alone before that was `Tests: 54 passed`.)
- `nx typecheck @ptah-extension/thoth-runtime --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/thoth-runtime`. Exit 0.
- `nx typecheck @ptah-extension/cli-engine --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/cli-engine`. Exit 0. Specs are not in `tsconfig.lib.json`; ts-jest compiled them.
- `nx lint @ptah-extension/thoth-runtime --parallel=1`: `✔ All files pass linting` / `Successfully ran target lint`. Exit 0.
- `nx lint @ptah-extension/cli-engine --parallel=1` after the spec cleanup: `✖ 2 problems (0 errors, 2 warnings)` in `cli-adapters.ts:249` and `cli-webview-manager-adapter.spec.ts:159` (not this revision) / `Successfully ran target lint`. Exit 0.
- `prettier --check` on the seven Revision 2 files: `All matched files use Prettier code style!` Exit 0.

Jest used `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js` with `--coverage=false --maxWorkers=2` and `moduleNameMapper` pointing `marked` at `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js` (the worktree has no `marked` package). ptah-cli and mcp-bench were not edited and were not typechecked or linted in this revision.

## Bounded correction (post-cap)

A non-source delete is no longer a full census by itself. In `onBatch` (`workspace-index-lifecycle.ts:264-293`), a delete that `isIndexerSourcePath` rejects is dropped when `extname(basename(path))` is non-empty (a file such as `README.md` or `notes.json`, which has no symbol rows). Only an extension-less delete (`.gitignore`, `Makefile`, `src`) sets `directoryDelete`. The comment at `workspace-index-lifecycle.ts:269-273` records the trade-off: a deleted directory whose name contains a dot keeps its rows until the next full run.

`directoryDelete` does not call `requestFullRun()` directly. `requestDeleteFullRun` (`workspace-index-lifecycle.ts:304-318`) allows one delete-triggered census per `deleteRunCooldownMs` (option at `workspace-index-lifecycle.ts:56-61`, default `30_000` at `workspace-index-lifecycle.ts:66-67`). A request inside the window arms one trailing timer; repeats before it fires do not add another. `dispose` clears that timer (`workspace-index-lifecycle.ts:249-251`). Overflow, truncated, and storm batches still call `requestFullRun()` immediately (`workspace-index-lifecycle.ts:281-288`).

### Tests

`workspace-index-lifecycle.spec.ts` (fake timers):

- `315` — `README.md` and `notes.json` deletes schedule nothing, including across 30s; `.gitignore` delete is one `indexWorkspace`.
- `339` — three extension-less deletes in separate batches inside the cooldown: one immediate run plus one trailing run at 30s (still one call at 29_999ms).
- `359` — `dispose` during the cooldown: advancing 30s does not start the trailing run.
- The earlier directory-burst test advances 30s (`spec.ts:264`) before its second batch so that batch is a new window and still one immediate run.

### Checks

- Jest `workspace-index-lifecycle.spec.ts` + `boot-thoth-runtime.spec.ts`: `Test Suites: 2 passed, 2 total` / `Tests: 42 passed, 42 total`. Exit 0.
- `npx --prefix D:\projects\ptah-extension nx typecheck @ptah-extension/thoth-runtime --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/thoth-runtime`. Exit 0.
- `npx --prefix D:\projects\ptah-extension nx lint @ptah-extension/thoth-runtime --parallel=1`: `✔ All files pass linting` / `Successfully ran target lint for project @ptah-extension/thoth-runtime`. Exit 0.
- `prettier --check` on the two files: `All matched files use Prettier code style!` Exit 0.

Only `workspace-index-lifecycle.ts` and `workspace-index-lifecycle.spec.ts` were edited. No bench, build, or `nx run-many`.

## User-authorized fix (mixed batch)

`onBatch` no longer returns after a directory delete. `requestDeleteFullRun()` still runs, and every kept source change is scheduled (`workspace-index-lifecycle.ts:290-295`). Overflow, truncated, and storm batches still return after `requestFullRun()` (`workspace-index-lifecycle.ts:281-288`).

Test `workspace-index-lifecycle.spec.ts:375`: inside the cooldown, one batch with an extension-less delete and a `.ts` update reindexes that file after the 500 ms debounce, before any trailing census, and the trailing full run still fires once at 30 s.

### Checks

- Jest `workspace-index-lifecycle.spec.ts`: `Test Suites: 1 passed, 1 total` / `Tests: 15 passed, 15 total`. Exit 0.
- `prettier --check` on the two files: `All matched files use Prettier code style!` Exit 0.

Typecheck and lint were not run; the orchestrator runs them after the bench. No bench, build, or `nx run-many`.
