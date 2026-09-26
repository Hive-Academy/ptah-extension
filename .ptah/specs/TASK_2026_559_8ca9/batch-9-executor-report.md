# Batch 9 executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent). No git operations were run.

## Task 9.1 — Paging and filtering at the namespace and tool: COMPLETE

### What changed

- `namespace-builders/symbol-index-query.ts` (NEW). This module has no dependencies. It holds:
  - `SYMBOL_INDEX_DEFAULT_LIMIT = 30` and `SYMBOL_INDEX_MAX_LIMIT = 1000`.
  - `parseSymbolIndexQuery`, which validates the arguments. Its errors are fixed text and never echo a value.
  - `pageSymbolIndex`, which filters by prefix, sorts by path and slices out one page.
- `namespace-builders/analysis-namespace.builders.ts`: `getSymbolIndex` is now overloaded.
  - `getSymbolIndex(root?)` returns the unpaged array in index order, exactly as before. This keeps existing `execute_code` callers working.
  - `getSymbolIndex(root, query)` returns `{ files, count, total, offset, nextOffset? }`. An invalid query throws a `RangeError`.
  - The existing catch was moved unchanged into a `readSymbolEntries` helper, with its `degradation-audit:` marker kept. No catch was added.
- `types.ts`: added the overloaded `getSymbolIndex` signature and the `SymbolIndexEntry`, `SymbolIndexQuery` and `SymbolIndexPage` types.
- `mcp-core/protocol-dispatcher.ts`, case `ptah_get_symbol_index`:
  - It validates the arguments **before** `ensureDependencyGraphBuilt`, so a bad argument never triggers the minutes-long cold build.
  - It then calls the namespace with the parsed query and renders the page with `renderSymbolIndexPage`.
- `mcp-core/tool-description.builder.ts` (`buildGetSymbolIndexTool` only):
  - The schema gains `pathPrefix` (string), `limit` (integer 1-1000) and `offset` (integer ≥ 0). All three are optional.
  - The description states the defaults, the response shape, the `nextOffset` protocol, the early page end, and that the first build can take minutes. It is 624 chars, under the 1,000 budget. The `ptah_lsp_*` and `ptah_context_enrich_file` blocks were not touched (diff hunks are at :9 and :1851-1874 only).

### How the arguments are validated at the MCP boundary

| Input                                                        | Result                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `limit` not an integer, < 1, > 1000, or a string             | error `"limit" must be an integer from 1 to 1000.`                                                             |
| `offset` negative, fractional or not a number                | error `"offset" must be a non-negative integer.`                                                               |
| `pathPrefix` not a string                                    | error                                                                                                          |
| any `..` segment, after `\` → `/` (so `libs\..\x` is caught) | error                                                                                                          |
| drive-relative `C:dir`                                       | error                                                                                                          |
| `null` / absent                                              | the default                                                                                                    |
| `\` separators                                               | treated as `/`; `//` and `./` are folded (`path.posix.normalize`); a UNC `//server` keeps its leading `//`     |
| relative prefix                                              | resolved against the `workspaceRoot` argument, else the session provider root; with no root it matches nothing |
| absolute prefix (`/…`, `C:/…`, UNC)                          | used as given                                                                                                  |
| case                                                         | a Windows prefix (drive letter or UNC) matches case-insensitively; a POSIX prefix matches exactly              |
| prefix that matches nothing                                  | `{ files: [], count: 0, total: 0, offset }`, with no `nextOffset`                                              |

### Default page size

The default was lowered from 200 to **30**. The numbers below were measured on this worktree's real index, taken from the Task 9.2 run: 2,652 entries, absolute paths averaging 134.6 chars, and symbols per file of p50 1, p90 8, p99 108, max 686.

| Entries in the first page | Chars  | Tokens                   |
| ------------------------- | ------ | ------------------------ |
| 200                       | 39,053 | 10,048                   |
| 50                        | 8,713  | 2,300 (over both limits) |
| 40                        | 7,079  | 1,862                    |
| 30                        | 5,581  | 1,454                    |

The budget is 2,000 tokens and 8,000 chars (Batch 2e, `tool-result-budget.ts`), so the token limit is the one that binds.

### Budget interaction (Batches 2e/2f)

- `ptah_get_symbol_index` is already hinted `preformatted` in `TOOL_CONTENT_HINTS` (`tool-result-budget.ts:89`). That matches the Batch 2 amendment ("the paged tools of Batches 9/13/15 are hinted `preformatted`"). No change was needed.
- **A fixed page size does not keep every page under budget on this repository.** At a fixed count, the share of pages over budget was:
  - 20: 21 of 133
  - 30: 45 of 89
  - 50: 53 of 54

  A preformatted page over budget gets the mid-line cut, which leaves invalid JSON. That contradicts the plan's risk-table mitigation "the paging batches keep the paged tools under budget so they never hit the cut".

- The dispatcher therefore renders the page with `renderSymbolIndexPage`:
  - It keeps the longest leading run of entries whose JSON passes `fitsBudget` against `getToolResultBudget('ptah_get_symbol_index')`. This is the same test `applyToolResultBudget` applies, so a fitting page is returned byte-for-byte.
  - It recomputes `count` and `nextOffset` from what it kept.
  - It always keeps at least one entry, so paging always advances.
  - The paging fields are serialised first (`count, total, offset, nextOffset, files`). If one entry alone is over the budget, the budget's cut and spool therefore still keep `nextOffset`.
  - The description says a page "also ends early when more entries would exceed the result size limit".
- The `execute_code` namespace path has no such early end, because the budget does not apply to it.
- Server instructions (Batch 4): the derived row `Finding where a symbol is exported -> ptah_get_symbol_index` is still true and needs no change. It is derived from the frozen `ptah-core-prompt.ts`, which was not touched.

### Specs added

`analysis-namespace.builders.spec.ts`, suite "getSymbolIndex paging", 10 tests on a synthetic 3,000-entry index inserted in reverse order:

- An unpaged call passing only `workspaceRoot` still returns the array in index order.
- The default page has 30 entries, `total` 3000, `nextOffset` 30, and is ordered by path.
- A relative prefix filter gives `total` 300.
- Separators, case, `./`, an absolute prefix and a doubled slash all give the same page.
- A POSIX prefix is case-sensitive; a UNC prefix is not.
- A prefix that matches nothing gives an empty page.
- A relative prefix with no known root gives an empty page.
- Following `nextOffset` visits all 3,000 entries, in order, in 5 pages.
- The last page has no `nextOffset`, and an offset past the end gives an empty page.
- Invalid queries throw a `RangeError` (6 cases).

`protocol-dispatcher.spec.ts`, suite "ptah_get_symbol_index paging (Batch 9)", 16 tests:

- **A default call on a 2,655-file fixture** with worktree-length paths:
  - it stays within 8,000 chars and 2,000 tokens (`countTokensPiecewise`);
  - it has no `[reduced:` trailer;
  - it returns `count` 30, `total` 2655 and `nextOffset` 30, sorted.
- No arguments → the namespace is called with `(undefined, { limit: 30, offset: 0 })`.
- A normalised prefix, the limit and the offset are passed to the namespace.
- A heavy page ends early; `count` and `nextOffset` are recomputed; the second page continues at the right entry, within budget.
- A single entry over the budget is kept alone, and the cut text starts with `{"count":1,"total":2,"offset":0,"nextOffset":1,`.
- A prefix that matches nothing gives an empty page.
- 10 rejection cases: none of them calls `getInfo` or the namespace.

`tool-description.builder.spec.ts`, 2 tests:

- The description is under the budget and states `limit 30 (max 1000), offset 0`, `nextOffset` and the early page end.
- The schema has only the optional `pathPrefix`, `limit` and `offset`, with the integer bounds.

## Task 9.2 — Cold first-call latency measurement: COMPLETE

- Method: a local spec was written temporarily at `libs/backend/workspace-intelligence/src/ast/zz-batch9-cold-graph.local.spec.ts` and **deleted after the run**. It was never committed.
  - It reproduces `ensureDependencyGraphBuilt` exactly: `isBuilt(root)` is false, then fast-glob `**/*.{ts,tsx,js,jsx}` with `DEFAULT_WORKSPACE_EXCLUDES` and `dot: true`, as `ElectronFileSystemProvider.findFiles` does, then `.slice(0, 5000)`, then `buildGraph(absolute paths, root)`.
  - It uses a real `TreeSitterParserService`, `AstAnalysisService` and `DependencyGraphService`. The file system is an `fs.promises.readFile` stand-in. The WASM loading shims are the same ones as in `csharp-grammar.integration.spec.ts`.
  - Command: `node_modules/.bin/jest -c libs/backend/workspace-intelligence/jest.config.ts <spec> --maxWorkers=1`.
  - Raw numbers were kept outside the repo, in `%TEMP%/batch9-cold-graph.json`.
- Results on this worktree:

  | Measure                            | Value                    |
  | ---------------------------------- | ------------------------ |
  | Glob matches                       | 5,354                    |
  | Files passed (after the 5,000 cap) | 5,000                    |
  | Graph nodes                        | 5,000                    |
  | Symbol-index entries               | 2,652                    |
  | Unresolved imports                 | 39,182                   |
  | findFiles                          | 346 ms                   |
  | buildGraph                         | 224,693 ms               |
  | **Total cold**                     | **225,040 ms (≈ 225 s)** |

- Verdict: **225 s is well over a 60 s client timeout**, and above the 124.8 s audit figure.
  - Caveats: this was measured under Jest (ts-jest transpiled sources), on a machine shared with other agents. The run includes the lazy grammar load.
  - The glob found 5,354 files but only the first 5,000 are graphed, so 354 files are silently missing from the index.
  - Under the batch rule, **no pre-warm code was written**. The measurement says the client does time out, so pre-warm (or an off-thread or background build) now meets the plan's own condition for coming back into scope. The decision belongs to the team-leader or user.

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → "Successfully ran targets test, lint, typecheck for project @ptah-extension/vscode-lm-tools".
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`, TOTAL 300, success. The two reported sites (`getDependencies` and `getDependents`) are the pre-existing ones.
- `prettier --check` on the 8 changed or new source files → "All matched files use Prettier code style!".
- No TODO, FIXME, placeholder or stub markers were added.

## Deviations

1. **New file `symbol-index-query.ts`**, which the batch did not list. The dispatcher and the description builder need the limits and the validator. Importing them from `analysis-namespace.builders.ts` loads the `@ptah-extension/workspace-intelligence` barrel, and with it tsyringe: `tool-description.builder.spec.ts` failed with "tsyringe requires a reflect polyfill". A dependency-free module avoids that. There is precedent for mcp-core importing from namespace-builders (`surface-tool-handlers.ts:17`).
2. **`types.ts` was modified**, which the batch did not list. The `DependenciesNamespace.getSymbolIndex` contract lives there.
3. **The default is 30, not 200**, as the batch allows. There is also a budget-aware early page end in the dispatcher, because a fixed count alone puts 45 of 89 pages over budget on this repository (see above).
4. The tool keeps calling the namespace with no workspace root, as before, so several open workspaces still give the merged index. A relative `pathPrefix` resolves against the session provider root.

## Out-of-scope observations (not touched)

- `ptah-system-prompt.constant.ts:76` still says `### ptah_get_symbol_index (no parameters)`. It is now stale, but it is a frozen shared prompt constant (User Decision 4; Batch 7 treated this file as frozen).
- `system-namespace.builders.ts:328`: the `ptah.help()` text lists `getSymbolIndex()` without the new optional `query` argument.
- The 5,000-file cap in `ensureDependencyGraphBuilt` drops 354 of 5,354 files on this worktree without saying so.
- Absolute paths make up about 45% of each entry on this worktree (a 70-char root). Workspace-relative `file` values in the MCP page would roughly double the entries per page, but that is a response-content change nobody asked for.

## Revision round 1 (review `reviews/batch-9-code-logic-review-r1.md`, User Decision 14)

Scope per Decision 14: fix F1, disclose F3 (the cap), fix the two stale help texts. F2 (cold-build blocking) is left to the new Batch 9b; no background build or pre-warm code was written.

### F1 — oversized entry broke the page envelope (fixed)

`renderSymbolIndexPage` (`mcp-core/protocol-dispatcher.ts`) is now async and always returns one valid JSON value within the tool budget, measured by the same `fitsBudget` test the budget step applies, so the budget step returns it unchanged:

- the whole page when it fits; else the longest leading run that fits (`count` and `nextOffset` recomputed, as before);
- else (the first entry alone is over the budget) that entry alone as `{ file, symbolCount, truncated: true, symbolsFile | symbolsFileError, symbols }`. The full entry (`{file, symbols}` JSON) is saved through the new `spoolToolText` export of `tool-result-budget.ts` (same spool directory, naming, exclusive create and pruning as the budget spool; never throws). `symbols` keeps as many leading names as fit (binary search). `nextOffset` moves past the entry, so paging always advances. A spool failure is named inside the envelope as `symbolsFileError` (errno code or built-in error name, as the budget trailer does).
- The `len <= 1` early return that sent a lone oversized entry to the generic cut is gone.
- Residual: a record whose file path plus spool path alone exceed 8,000 chars still reaches the cut. This needs paths of several thousand chars.

### F3 — silent 5,000-file graph cap (disclosed, cap value unchanged)

- `DependencyGraphService` (workspace-intelligence) stores a `GraphCoverage { graphedFiles, discoveredFiles }` per root. `buildGraph` has a new optional 4th parameter `discoveredFiles`; the default is `filePaths.length`, and a value that is not a safe integer or is below the graphed count is ignored. `getCoverage(root?)` reads it (no root gives the sum, like the merged symbol index). It is evicted with the graph (`evict`, `retainOnly`, `clear`). `GraphCoverage` is exported from the barrel.
- The namespace (`types.ts`, `analysis-namespace.builders.ts`) adds an optional `buildGraph(…, discoveredFiles?)` and `getGraphCoverage(root?)`. This is additive, so execute_code callers passing only `workspaceRoot` are unchanged.
- Dispatcher: `ensureDependencyGraphBuilt` lists every matching file (`findFiles(…, Number.MAX_SAFE_INTEGER)`; the cap bounds parsing, not listing), graphs the first `DEPENDENCY_GRAPH_FILE_CAP = 5000` in the same order as before, and passes the discovered count. It now returns the root. `graphCompleteness` adds `incomplete: true, graphedFiles, discoveredFiles` to the results of `ptah_get_dependents` and `ptah_get_dependencies` (session root) and to the `ptah_get_symbol_index` page (merged scope). These fields are only added when files were dropped; otherwise they are absent.
- Descriptions: one shared `INCOMPLETE_GRAPH_NOTE` sentence was appended to the three per-tool descriptions (all < 1,000 chars, asserted). The symbol-index description also documents the oversized-file form. Frozen constants (`ptah-core-prompt.ts`, `NATIVE_AGENT_TOOL_POLICY`) and the `ptah_lsp_*` / `ptah_context_enrich_file` blocks were not touched.

### Help text

- `ptah-system-prompt.constant.ts:76`: `ptah_get_symbol_index { pathPrefix?, limit?, offset? }`, with paging and the incomplete flag. The round-0 report called this file frozen; it is not one of the frozen constants.
- `system-namespace.builders.ts` `ptah.help('dependencies')`: now covers both `getSymbolIndex` overloads, `buildGraph`'s `discoveredFiles?` and `getGraphCoverage`.

### Specs added or changed

- `protocol-dispatcher.spec.ts`: the old "keeps one entry … cut keeps the paging fields" spec was replaced by:
  - "returns an oversized entry in the middle as valid JSON, and paging continues past it with its symbols recoverable"
  - "returns an oversized final entry as valid JSON with no nextOffset, its symbols recoverable"
  - "returns a lone oversized entry as valid JSON"
  - "names the spool failure inside a valid page when the symbols cannot be saved"
  - "adds no completeness fields when the graph covers every discovered file"
  - "says incomplete, with both counts, when the graph cap dropped files"
  - "keeps the completeness fields on an empty page"
  - "discovers every source file, graphs the first 5,000 and passes the discovered count"
  - `%s graph completeness` × {dependents, dependencies}: complete, unknown and capped cases
  - The existing buildGraph-args spec now expects the discovered count.
- `tool-description.builder.spec.ts`: "states how a file too large on its own is returned and recovered"; `%s graph completeness` × 3 tools.
- `analysis-namespace.builders.spec.ts`: "buildGraph forwards the discovered-file count; getGraphCoverage reads it back".
- `dependency-graph.service.spec.ts`: a "coverage" describe (none before build, complete default, capped count kept, invalid counts ignored ×3, sum and eviction).

### Verification (revision round 1)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2` → Successfully ran targets test, lint, typecheck for 2 projects (vscode-lm-tools 69 suites / 1,705 tests; workspace-intelligence 45 suites / 1,193 tests).
- `nx run degradation-audit:lint --skip-nx-cache` → success; `vscode-lm-tools: 2 ok (baseline 2)`, `workspace-intelligence: 1 ok (baseline 1)`, TOTAL 300. No catch was added.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success (shared service signature changed).
- `prettier --check` on the 13 changed files → all formatted.

## Bounded correction (round 2 review)

Scope: R2-B1, R2-S1 and R2-M1 of `reviews/batch-9-code-logic-review-r2.md` only. F2 (background cold build) stays in Batch 9b; no code for it was written.

### R2-B1 (blocking): coverage from the graph that answered

- `dependency-graph.service.ts`: new `getCoverageForFile(filePath)` selects the graph with the same `findGraphEntryForFile` routing `getDependencies`/`getDependents` use (sole graph, else longest root prefix, so nested roots resolve to the inner root) and returns that root's coverage.
- `types.ts` / `analysis-namespace.builders.ts`: additive namespace method `getGraphCoverageForFile(file)`, resolving the path exactly as `getDependencies`/`getDependents` do (shared `isAbsoluteFileArg`); a relative path with no open workspace returns `undefined` (the dependency calls answer `[]` there) without a new catch.
- `protocol-dispatcher.ts`: both dependency tools take the list and `getGraphCoverageForFile(resolvedFile)` in one `Promise.all`, so both read the graph service in the same turn; the session root is no longer used for coverage. `ensureDependencyGraphBuilt` returns `void` (its root was used only for coverage); `graphCompleteness` is now a pure function of a coverage value. `ptah_get_symbol_index` keeps the merged `getGraphCoverage(undefined)`.
- `system-namespace.builders.ts`: `ptah.help('dependencies')` lists `getGraphCoverageForFile`.

### R2-S1 (serious): completeness survives the budget cut

- `protocol-dispatcher.ts`: both dependency tools serialize `file, count, incomplete?, graphedFiles?, discoveredFiles?` before the list, so the budget's prefix cut keeps them. No paging was added.

### R2-M1 (moderate): metadata-only envelope checked first

- `renderSymbolIndexPage`: the zero-symbol oversized envelope is checked with `fitsBudget` (chars and tokens, the budget's own test) before the binary search. When it does not fit, the page is a fixed-size valid JSON object: `count: 0`, `total`, `offset`, `nextOffset` past the entry (absent on the last), the completeness fields, `files: []`, a fixed `error` text, and `symbolsFile`/`symbolsFileError` only when that still fits. No over-budget page reaches the generic cut. `largestFitting`'s doc no longer claims `fits(0)` is assumed.

### Regression specs

- `dependency-graph.service.spec.ts`: "reports the coverage of the graph a file query is routed to, in both directions"; "reports the nested graph coverage for a file under a nested root".
- `analysis-namespace.builders.spec.ts`: "getGraphCoverageForFile routes the path resolved as getDependents resolves it".
- `protocol-dispatcher.spec.ts` (real `DependencyGraphService` + real namespace, parser/file reads stubbed), `%s coverage of the answering graph` × {dependents, dependencies}: "reports root B's cap for a file under B while the session root A is complete"; "reports no cap for a complete root B while the session root A is capped"; "reports the nested root for a file under it, and the outer root elsewhere".
- `protocol-dispatcher.spec.ts`, `%s completeness through the result budget` × {dependents, dependencies}: "keeps incomplete and both counts when the full output is saved" / "... cannot be saved" (1,500 paths, coverage 5,000/6,000, real budget; the list is cut, the fields are present).
- `protocol-dispatcher.spec.ts` (symbol-index paging): "skips an entry whose metadata alone is over the budget with a valid JSON error, and paging advances (spool fails)" (the reviewer's 810 × `deepabc` path; JSON.parse succeeds, second page returns the next entry); "names the saved entry when a metadata-only-oversized entry was spooled".
- Existing completeness specs now mock `getGraphCoverageForFile` and assert it receives the resolved file.

### Verification (bounded correction)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2` → Successfully ran targets test, lint, typecheck for 2 projects.
- Targeted jest run of the new/changed specs: 19 passed (vscode-lm-tools), 2 passed (workspace-intelligence).
- `nx run degradation-audit:lint --skip-nx-cache` → success; `vscode-lm-tools: 2 ok (baseline 2)`, `workspace-intelligence: 1 ok (baseline 1)`, TOTAL 300. No catch added.
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success (namespace type and service gained a method).
- `prettier --check` on the 8 changed source/spec files → all formatted.
