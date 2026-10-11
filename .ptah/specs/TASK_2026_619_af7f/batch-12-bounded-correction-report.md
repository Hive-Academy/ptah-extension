## Summary

`purgeJunk` and `purgeWorkspace` now follow the `deleteFileRows` vec protocol. Each call reconciles vec availability, then deletes matching `code_symbols_vec` rows before the symbol rows inside one SQLite transaction. When vec is unavailable and the purge deletes at least one symbol row, the same transaction writes the `code-symbols-vec-stale` marker. Return counts and the `workspaceRoot` tri-state are unchanged. No migration.

## Files changed

- `libs/backend/memory-curator/src/lib/code-symbol.store.ts`
- `libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts`

## Criteria met

1. Protocol matches `deleteFileRows`. `purgeJunk` calls `reconcileOrphanVecRows` at `code-symbol.store.ts:977`, selects rowids with the same `file_path LIKE ? ESCAPE '\'` predicate and `workspaceClause` binds (`:978-1005`), deletes `code_symbols_vec` by rowid (`:1006-1008`) before `code_symbols` (`:1010`), and runs every segment in one `db.transaction` (`:999-1018`). When vec is unavailable and `totalDeleted > 0`, it calls `markVecStale()` inside that transaction (`:1013`). Errors call `handleFatalWriteError` and rethrow (`:1019-1021`). `purgeWorkspace` does the same for `workspace_root = ?` (`:1025-1059`): reconcile `:1027`, select `:1028-1044`, vec delete `:1045-1047`, symbol delete `:1049`, marker `:1050`, fatal handler `:1056-1058`, one transaction `:1053-1055`.

2. Return values stay the deleted `code_symbols` change count (`purgeJunk` `:1014` and `:1018`; `purgeWorkspace` `:1051` and `:1055`). `purgeJunk` still takes `workspaceRoot?: string | null` (`:958`) and builds the predicate with `workspaceClause` (`:978-981`): `null` is `workspace_root IS NULL`, a string is `workspace_root IS ?`, `undefined` adds no workspace predicate. Existing SQL-shape tests (`code-symbol.store.spec.ts:231-249`) and the native tri-state test (`:728` area, still passing) were not rewritten because that SQL did not change.

3. Native-gated tests, same `maybe` gate as the vec-outage block: vec available — `purgeJunk` removes junk vec rows and keeps the others (`code-symbol.store.spec.ts:1845-1902`); `purgeWorkspace` removes that workspace's vec rows and keeps the other (`:1943-1997`). Vec unavailable — marker `code-symbols-vec-stale` is absent after a 0-row purge and present after a purge that deleted rows, for `purgeJunk` (`:1905-1940`) and `purgeWorkspace` (`:2000-2043`). The zero-row purge runs first so a leftover marker cannot satisfy the absence check.

4. No other behavior change and no new migration. Junk segments, LIKE escaping, and the public signatures are the same. Only these two files were edited.

## Tests added

- `purgeJunk deletes vec rows of junk symbols and leaves the others` (`code-symbol.store.spec.ts:1845-1902`)
- `purgeJunk during a vec outage writes the stale marker only when rows are deleted` (`:1905-1940`)
- `purgeWorkspace deletes vec rows of that workspace and leaves the others` (`:1943-1997`)
- `purgeWorkspace during a vec outage writes the stale marker only when rows are deleted` (`:2000-2043`)

Helpers next to the existing native helpers: `symbolRowid` (`:1640`), `vecEmbedding` (`:1651`), `staleMarkerCount` (`:1663`).

## Checks run

Jest argv (PowerShell stripped the JSON quotes when the same flags were passed through `npx`, so the process was `node D:\projects\ptah-extension\node_modules\jest\bin\jest.js` with this argv):

`jest -c libs/backend/memory-curator/jest.config.ts libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper={"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"<rootDir>/../../../__mocks__/vscode.ts"}`

Last lines:

```
PASS   memory-curator  libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts (9.513 s)
...
    √ purgeJunk deletes vec rows of junk symbols and leaves the others (102 ms)
    √ purgeJunk during a vec outage writes the stale marker only when rows are deleted (101 ms)
    √ purgeWorkspace deletes vec rows of that workspace and leaves the others (111 ms)
    √ purgeWorkspace during a vec outage writes the stale marker only when rows are deleted (100 ms)
...
Test Suites: 1 passed, 1 total
Tests:       52 passed, 52 total
Time:        9.857 s
```

Native-gated tests ran. The suite lists `√` for `native better-sqlite3 + sqlite-vec are loadable` and for every later native case, including the four new ones. None were skipped.

`npx nx typecheck @ptah-extension/memory-curator --parallel=1`

```
NX   Successfully ran target typecheck for project @ptah-extension/memory-curator
Run duration:      8.0s
```

`npx nx lint @ptah-extension/memory-curator --parallel=1`

```
✖ 26 problems (0 errors, 26 warnings)
NX   Successfully ran target lint for project @ptah-extension/memory-curator
```

The 26 warnings are in other files in the project (`quarantine.round-trip.spec.ts`, `boot-scan-runner.ts`, `memory-trigger.*`). None are in the two edited files. `ptah_get_diagnostics` on those two files reported 0 errors.

`npx prettier --check libs/backend/memory-curator/src/lib/code-symbol.store.ts libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts`

```
All matched files use Prettier code style!
```

## Decisions

- All junk-segment deletes share one transaction. A failure rolls the whole `purgeJunk` call back, then `handleFatalWriteError` runs and the error is rethrown. Previously each segment autocommitted.
- `markVecStale()` runs once per call when the summed `code_symbols` changes are greater than 0, not once per segment. `INSERT OR IGNORE` makes a per-segment write the same row; the acceptance text asks for the total.
- The outage tests assert that `code_symbols_vec` row counts stay put while the flag is false. `setVecAvailable` only flips the JS diagnostic; the extension is still loaded, so a mistaken vec `DELETE` would succeed and hide the bug if the tests only checked the marker.
- SQL-shape expectations were left as they are. With vec unavailable, the first prepared statement is still the symbol `DELETE`, and a 0-change stub does not prepare the marker insert.

## Not done

- No git commit, push, or working-tree cleanup.
- No separate test that a thrown statement calls `handleFatalWriteError`. The four required native cases pass; the catch blocks match `deleteFileRows`.
- `npx jest ...` could not be the process image: PowerShell removed the quotes inside `--moduleNameMapper` and Jest's `JSON.parse` failed. The Jest binary received the same arguments.
