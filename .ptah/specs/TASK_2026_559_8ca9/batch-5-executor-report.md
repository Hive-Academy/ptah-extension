# Batch 5 executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent). Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.
No git operations were run.

## Files

- MODIFIED `libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts`: new `CodeIndexFreshness` type and an OPTIONAL `getIndexFreshness?(workspaceRoot: string): Promise<CodeIndexFreshness>` on `ICodeSymbolReader`
- MODIFIED `libs/backend/memory-contracts/src/index.ts`: exports the `CodeIndexFreshness` type. Batch 6 (`code-namespace.builder.ts` in vscode-lm-tools) needs it
- MODIFIED `libs/backend/memory-curator/src/lib/code-symbol.store.ts`: adds `getIndexFreshness`, the exact-name candidate list (`exactNameSymbols`), 3-list RRF fusion, and the `CODE_SEARCH_MAX_TOP_K` / `EXACT_NAME_RRF_WEIGHT` constants
- MODIFIED `libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts`: 3 stub-SQL tests, which run everywhere, and 8 native in-memory tests

## Task 5.1: optional `getIndexFreshness`. COMPLETE

- Port: `getIndexFreshness?(workspaceRoot: string): Promise<{ symbolCount: number; newestUpdatedAt: number | null }>` (named type `CodeIndexFreshness`). The JSDoc says that an absent method means "unknown freshness" and never "stale"
- Store: follows the `count()` pattern (one inline prepared statement)
  `SELECT COUNT(*) AS n, MAX(updated_at) AS newest FROM code_symbols WHERE workspace_root = ?`.
  It returns `newestUpdatedAt: null` whenever the count is 0 or the max is not a number
- Scoping: `workspace_root = ?` with a required string. There is no tri-state here because the port takes a single root

## Task 5.2: exact-name candidate list and recall guard. COMPLETE

- `exactNameSymbols(query, limit, workspaceRoot)` runs one statement:
  `WHERE cs.symbol_name = ? COLLATE NOCASE [AND cs.workspace_root = ?] ORDER BY (cs.symbol_name = ?) DESC, cs.file_path, cs.rowid LIMIT ?`.
  If any case-sensitive row exists, only those rows are kept. Otherwise the case-insensitive rows are the fallback
- A query that contains whitespace skips the lookup, because a symbol name cannot contain whitespace. Natural-language queries therefore fuse exactly as before. For a single-token query with no exact row, the exact list is empty, and the fusion input and insertion order are identical to before. BM25 and vector code is untouched
- Fusion: `rrfFuseSymbols(exact, bm25, vec, …)` with weight `EXACT_NAME_RRF_WEIGHT = 3`. The derivation is in a code comment. BM25 and vector weights sum to 1, so a non-exact row scores at most 1/26. The worst exact row (index 49, topK capped at 50) scores at least 3/75 = 0.04, so every exact-name row outranks every non-exact row. The topK clamp literal `50` is now `CODE_SEARCH_MAX_TOP_K` so that the derivation is tied to it
- Workspace scoping: the exact list uses the same `workspaceRoot ? 'AND cs.workspace_root = ?' : ''` rule as the BM25 and vector lists. A spec pins it both as SQL shape and as behaviour

### Recall guard (in-memory better-sqlite3 plus sqlite-vec, `new SqliteConnectionService(':memory:')`)

- 14 target declarations, including `handleToolsList`, `createToolSuccessResponse`, `createToolErrorResponse`, `buildToolSet`, `resolveCaller`, `ensureIndexFresh`, `getIndexFreshness`, `SqliteConnectionService` and `McpCaller`. They are seeded alongside 6 short caller/test distractors that repeat the names, which is the real-world BM25 failure mode
- Asserts recall@1 = 100% (it lists every miss as `name@rank`) and recall@5 >= 90%
- The natural-language query `validates the session token for a user` returns `login` in the top 5
- `getIndexFreshness`: empty → `{0, null}`. After inserts at `Date.now` = 1000/1000/5000, with another workspace at 9000, the result is `{3, 5000}`. An unknown root gives `{0, null}`

### Regression proof (run, then restored)

| Mutation                                              | Result                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact list disabled (`exactNameSymbols` returns `[]`) | 4 failed / 26 passed. Recall@1 misses: `handleToolsList@3, createToolErrorResponse@2, resolveCaller@3, indexWorkspace@2, parseSubject@2, McpCaller@2, getIndexFreshness@3` (7/14 = 50% recall@1). The same-name, case, and SQL-shape tests also fail                                                                                                                                       |
| `EXACT_NAME_RRF_WEIGHT = 0.5`                         | Before the worst-case test was added, the suite still passed: each declaration also earns its own BM25 share. So I added "at the maximum topK, 50 same-name rows outrank a distractor that tops both BM25 and vector lists". The distractor gets vector rank 1 through the deterministic embedder (same text length at batch index 0) and is the only BM25 match. With that test: 1 failed |
| `EXACT_NAME_RRF_WEIGHT = 2`                           | 1 failed (the worst-case test)                                                                                                                                                                                                                                                                                                                                                             |
| Restored `= 3`                                        | 31 / 31 passed                                                                                                                                                                                                                                                                                                                                                                             |

## Edge cases from the validation section

| Edge case                                 | Handling                                                                                                                                                | Evidence                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty index                               | `{ symbolCount: 0, newestUpdatedAt: null }`; the exact list returns `[]`                                                                                | freshness native test; stub-SQL test                                                                                                                                             |
| Missing `updated_at`                      | The column is `NOT NULL` (0013 migration), so the max is NULL only with zero rows. The code still maps any non-number max (or a count of 0) to `null`   | stub-SQL test (a row without `newest` gives `null`)                                                                                                                              |
| Many rows with the same name across files | Every exact row outranks every non-exact row by construction; ties order by `file_path` and then by BM25/vector contribution                            | "every row sharing the exact name…" (6 files) and the 50-row worst-case test                                                                                                     |
| Names colliding case-insensitively        | A case-sensitive match wins. If there is none, all case-insensitive matches lead the ranking. `COLLATE NOCASE` folds ASCII only, which fits identifiers | "case-sensitive exact match wins…" (`handleToolsList` / `HandleToolsList` / `HANDLETOOLSLIST`)                                                                                   |
| SQL special characters                    | The query is a bound parameter, and `=` has no wildcards, so `%`, `_`, `'`, `"` and `;--` are literal                                                   | "SQL special characters…": `foo_bar` ranks its own row first and does not match `fooXbar`; `foo%`, `foo'bar` and an injection string give no exact-tier row; the table is intact |

## Risk handling

- RISK "required method breaks test doubles": the method is optional. Every `ICodeSymbolReader` consumer and test double typechecks unchanged: `agent-sdk`, `vscode-lm-tools`, `ptah-electron`. `CodeSymbolStore` is the only real implementer (grep for `ICodeSymbolReader` across `libs`/`apps`)
- "Guard must fail on regression": demonstrated above for removal and for down-weighting
- Index on `symbol_name`: none exists (0013: indexes on `workspace_root`, `(workspace_root, file_path)` and `subject`). `EXPLAIN QUERY PLAN` on the real schema shows that the exact lookup and the freshness aggregate both run `SEARCH … USING INDEX idx_code_symbols_workspace (workspace_root=?)`, which reads that workspace's rows. That is a bounded per-workspace scan, the same cost class as `count()`. A dedicated index would need a new append-only migration in `persistence-sqlite`, which is outside this batch's files, so I did not add one. Follow-up: `CREATE INDEX idx_code_symbols_name ON code_symbols(workspace_root, symbol_name COLLATE NOCASE)` in a new migration, if large workspaces show latency. An unscoped exact lookup (no `workspaceRoot`) scans the whole table, as the unscoped BM25 join already does

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/memory-curator @ptah-extension/memory-contracts --skip-nx-cache --parallel=2` → memory-contracts:typecheck, memory-curator:lint, memory-curator:test and memory-curator:typecheck all pass ("Successfully ran targets test, lint, typecheck for 2 projects")
- memory-contracts has no `test` target, and its lint target is named `eslint:lint`, so `-t=lint` skips it. I ran `nx run @ptah-extension/memory-contracts:eslint:lint --skip-nx-cache` separately, and it passed
- Spec file directly (jest, memory-curator config): 31 passed, 0 skipped. The native tests execute on this machine
- `nx run-many -t=typecheck -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools ptah-electron` → all 3 pass
- `prettier --check` on the 4 changed files passes. ESLint on the changed files: 0 errors, 1 warning (`no-useless-assignment` on the existing `nativeAvailable` probe, which I did not touch)

## Deviations

- Prettier `--write` on `code-symbol.store.ts` also reflowed one existing line in `insertBatch` (`as | {rowid} | undefined` → `as {rowid} | undefined`). HEAD was already non-conformant with the installed Prettier there. The change is formatter output only, with no behaviour change
- I added a `CODE_SEARCH_MAX_TOP_K` constant in place of the `50` literal in `searchSymbols` (same value), so that the weight derivation references it
- The native tests keep the file's existing native gate (`maybe`). Where `better-sqlite3` is built for the Electron ABI they skip, so the 3 stub-SQL tests (freshness SQL shape, exact lookup SQL shape and scoping, whitespace skip) always run

## Out-of-scope observations

- The `symbol_name` index follow-up above
- The recall guard runs against the deterministic test embedder. Real embedder behaviour is covered by the fusion bound, not by this spec

## Revision round 1

Review: `reviews/batch-5-code-logic-review-r1.md` (REVISE 6/10, M1 and M2 moderate). Nothing else changed.

### M1: Unicode case-insensitive fallback

- `libs/backend/memory-curator/src/lib/code-symbol.store.ts`: `exactNameSymbols` now runs a case-sensitive `symbol_name = ?` lookup (workspace-scoped, bound, `LIMIT`). Only when that finds nothing does it call the new `foldedNameSymbols`. That method compares `symbol_name.toLowerCase()` with `query.toLowerCase()` in JS. `toLowerCase` is the Unicode default mapping and does not depend on the host locale. `COLLATE NOCASE` is gone.
- To keep the cost bounded, SQL first filters rows by `length(cs.symbol_name) BETWEEN ? AND ?` (bound values) plus the workspace predicate. Rows stream through `iterate` in file-path order, and the scan stops after `limit` matches. The window relies on one invariant, checked over every code point on Node v24.15.0: lowercasing never shortens a string, and only U+0130 lengthens (by one). So a match has between `L - d` and `L` characters, where `d` counts `i`+U+0307 pairs in the lowered query.
- Why not a registered SQLite function: `SqliteDatabase` in persistence-sqlite has no `function` member, and no store in the repository registers one. Adding it would have meant changing a persistence-sqlite interface and its fakes, and managing registration for each connection. The JS comparison needs no change to persistence-sqlite and no migration. Its scan cost matches the old NOCASE query, which the reviewer's EXPLAIN shows was already a workspace scan.
- Folding policy, pinned by specs: `Äpfel` = `äpfel` = `ÄPFEL`, and `ẞ` (U+1E9E) matches `ß`. There is no full case folding, so `STRASSE` does not match `straße`. `İ` lowers to `i`+U+0307, so `İNDEX` and `i̇ndex` match `İndex` but not `index`. `INDEX` matches `index` only. Dotless `ı` matches neither.

### M2: recall guard cannot skip in CI

- `code-symbol.store.spec.ts`: this follows the probe-error pattern in `persistence-sqlite/src/lib/sqlite-connection.realbinary.spec.ts`. The probe now records its error. When `CI` is set (and is not `''` or `'false'`; GitHub Actions sets `CI=true`), `maybe` is `it`, so no native-gated test can skip. A new test, `native better-sqlite3 + sqlite-vec are loadable (required when CI is set)`, fails and reports the probe cause. A local run without CI still skips, and writes a stderr message that names the recall guard.

### Specs added or changed

- SQL shape: the existing exact-lookup spec now asserts `cs.symbol_name = ?` with no NOCASE and binds `['handleToolsList', '/ws/a', 5]`. The whitespace spec also asserts there is no length-window query. New: `with no case-sensitive row, the Unicode fallback binds a length window and the workspace` (binds `[5, 6, '/ws/a']` for `İNDEX`). The stub gained `iterate`.
- Native (in-memory): `a non-ASCII case variant reaches the exact tier over a caller (Äpfel / äpfel)`. This is the reviewer's fixture plus an identical-case `äpfel` in another workspace. It then adds an identical-case `äpfel` to WS and checks that it takes the tier. Also new: `case folding is the locale-independent toLowerCase mapping (sharp s, Turkish I)`.
- New: `native better-sqlite3 + sqlite-vec are loadable (required when CI is set)`.

### Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/memory-curator @ptah-extension/memory-contracts --skip-nx-cache --parallel=2`: "Successfully ran targets test, lint, typecheck for 2 projects".
- `node_modules/.bin/nx run @ptah-extension/memory-contracts:eslint:lint --skip-nx-cache`: succeeded.
- `CI=true jest -c libs/backend/memory-curator/jest.config.ts code-symbol.store.spec --json`: 35 passed, 0 pending. The recall guard, the two Unicode specs, the readiness test and the fallback SQL-shape spec all show `passed`.
- persistence-sqlite was not touched.

## Bounded correction (round 2 review)

Review: `reviews/batch-5-code-logic-review-r2.md` (REVISE 7/10; r1 M1 and M2 fixed; new M3 moderate: an exact-case miss sent every same-length workspace row through the JS `toLowerCase` scan, ~172 ms at 100k rows against ~18 ms for the r1 NOCASE SQL). Only `code-symbol.store.ts` and its spec changed.

### Fix

- `exactNameSymbols`: the identical-case `symbol_name = ?` lookup still runs first and still wins when it finds anything.
- On a miss with a pure-ASCII query (`ASCII_ONLY = /^\p{ASCII}*$/u`), the store runs the SQL `symbol_name = ? COLLATE NOCASE` lookup. It keeps the workspace filter, the bound parameter, file-path ordering and `LIMIT`. There is no JS scan. Both SQL lookups share one method, `nameEqualsSymbols(collation, ...)`.
- A query with any non-ASCII character still takes `foldedNameSymbols`, with these changes. The scan now selects only `rowid` and `symbol_name`. It still keeps the length window, file-path order, workspace scope, the early stop at `limit` and the iterator close on `break`. Full rows are fetched afterwards only for the matched rowids (`rowid IN (...)`, at most `limit`), in the same order. Nothing is cut off before matching.
- Known gap, documented and pinned: U+212A KELVIN SIGN lowers to ASCII `k` under `toLowerCase()`, but SQLite `NOCASE` does not fold it. So the ASCII query `kelvin` no longer finds a stored `Kelvin`. That name's identical spelling still reaches the exact tier.

### Specs

- SQL shape (stub): `an ASCII case-insensitive miss uses SQL NOCASE and never the JS scan`. It checks for `COLLATE NOCASE`, the workspace filter and `LIMIT`, the bindings `['transactions', '/ws/a', 5]`, and that no length-window query runs. The existing `with no case-sensitive row, the Unicode fallback binds a length window and the workspace` now also checks that the scan does not select `cs.text` and that NOCASE is not used.
- Native (in-memory, with a prepare/iterate spy through `spyOnQueries`):
  - `bounded work: an ASCII single-token miss in a 20k-symbol workspace never enters the JS scan`. It seeds 20,000 names of 12 characters, the r2 worst case. For a `transactions` miss, the NOCASE query is prepared, no length-window query is prepared, and `iterate()` is called zero times. `SYMBOL012345` finds `symbol012345` through the same path. The check uses no wall-clock timing.
  - `an ASCII case variant (HandleToolsList -> handleToolsList) is found through SQL NOCASE`: the result is rank 1 and in the exact tier, stays inside the workspace, and uses NOCASE with no iterate.
  - `documented gap: an ASCII query does not match a stored name with U+212A KELVIN SIGN`.
  - `a non-ASCII case variant reaches the exact tier over a caller (Äpfel / äpfel)` now also checks for exactly one length-window `iterate()` and no NOCASE. `case folding is the locale-independent toLowerCase mapping (sharp s, Turkish I)` now checks which path serves each query: `STRAẞE`, `İNDEX`, `i̇ndex` and `ındex` use the JS scan, and `STRASSE` and `INDEX` use NOCASE. All earlier expected results are unchanged.

### Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/memory-curator @ptah-extension/memory-contracts --skip-nx-cache --parallel=2`: "Successfully ran targets test, lint, typecheck for 2 projects", exit 0.
- `node_modules/.bin/nx run @ptah-extension/memory-contracts:eslint:lint --skip-nx-cache`: "Successfully ran target eslint:lint", exit 0.
- `CI=true jest -c libs/backend/memory-curator/jest.config.ts code-symbol.store.spec --json`: 39 passed, 0 pending, 0 failed.
- `ptah_get_diagnostics` on the store and spec: 0 errors.

### Follow-up (out of this batch)

- Add an indexed lowercase-key column to `code_symbols`, for example `symbol_name_lower` holding the JS default lowercase, with an index on `(workspace_root, symbol_name_lower)`. This needs a persistence-sqlite migration that backfills existing rows, and the sink/upsert must keep the column up to date. The case-insensitive tier then becomes an O(log N) lookup for every query, ASCII or not. That removes the remaining O(workspace) JS scan on a non-ASCII miss and the U+212A NOCASE gap. The key policy must be tied to the runtime's Unicode version, or the column rebuilt when that version changes.
