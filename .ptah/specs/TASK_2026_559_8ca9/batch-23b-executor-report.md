# Batch 23b executor report — graph tools answer honestly; bounded discovery (Lane H)

Worktree `task-559-lane-h`, branch `fix/task-559-lane-h`, base HEAD `efea46119`. No git write was run (no
stage, commit, stash, reset, restore or checkout). The working tree is left dirty for the team-leader.

## Tasks completed

- **23b.1** `ptah.dependencies.discoverSourceFiles(root, limit)`: calls
  `IFileSystemProvider.findFiles(glob, [...DEFAULT_WORKSPACE_EXCLUDES, ...GRAPH_VENDOR_EXCLUDES], limit + 1, root)`,
  where the default limit is 50,000. The glob covers every recognised source extension, so unsupported languages
  are counted through the same bounded call. There are nine vendor globs. When a file exists past the limit the
  result is `truncated`, and the build then receives `censusLimit`, so the census reads `truncated`. `excluded`
  stays `null`. `fileSystemProvider` was added to the analysis deps in `ptah-api-builder.service.ts`, after the
  ASSUMPTION check: it was absent before this batch.
- **23b.2** Dispatcher:
  - `.py` and every other non-graph-capable file get the `unsupported-language` answer. That answer is a success,
    puts `status` first, starts no build and never returns `count:0`.
  - Dependents and dependencies answers now carry `count`, the Batch 9 cap fields, `fileInGraph`, `coverage`
    (verdict first), `file` (the graph's own spelling) and the list, in that order.
  - The symbol-index paginator carries `coverage` in its header on every page shape. Its multi-root merge is the
    service's `mergeGraphCoverages`.
  - The discovery glob at `:2679-2693` was replaced by `discoverSourceFiles`, and the dispatcher's own 5,000-file
    slice was removed. The service's fair parse cap now chooses the files.
  - `building` is still a success and `failed` is still an error.
- **Carried criteria R4-B1 and R4-M1** (User Decision 20): see the proof section below.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`:
  - queries resolve through the 23a path identity (`findNode` and the public `resolveNodePath`);
  - the node-identity index now keeps every node key per identity, so an ambiguous identity matches no query and
    an invalidation removes all of its nodes;
  - a root realpath lookup that fails for any reason other than the root being absent (ENOENT/ENOTDIR) is now
    disclosed in the coverage;
  - the dead `findGraphForFile` helper was deleted.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/workspace-intelligence/src/ast/graph-coverage.ts`: adds `identityUnavailableCoverage`, which sets `unchecked: null` (reason `unchecked?`, never clean).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/workspace-intelligence/src/index.ts`: exports `recognisedSourceExtensions` (D8, lane H barrel).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/workspace-intelligence/src/ast/dependency-graph.service.spec.ts`: adds the r4 describe with 11 specs.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`:
  - adds `GRAPH_VENDOR_EXCLUDES`, `GRAPH_CENSUS_LIMIT`, `discoverSourceFiles` and `unsupportedGraphLanguage`;
  - `buildGraph` passes `censusLimit` through;
  - `getGraphCoverage` and `getGraphCoverageForFile` return `coverage` (and `nodePath`). When no graph answers
    they return an unknown coverage instead of `undefined`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`:
  - the whole-module WI mock was removed; the real barrel loads under this jest config;
  - updated mocks;
  - new specs for unsupported files, discovery (including a real fast-glob vendor-tree FB), unknown coverage and
    the R4-B1 namespace probe.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`: new namespace members and the `GraphSourceDiscovery`, `GraphQueryCoverage` and `GraphFileCoverage` types.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`: adds `fileSystemProvider` to `analysisDeps`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`: adds `graphFileAnswer` and the unsupported answer, puts coverage in the symbol-index header, switches the build to bounded discovery, and removes `DEPENDENCY_GRAPH_FILE_CAP` and its local `toAbsoluteWorkspacePath`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`:
  - `graphToolStubs` and `CLEAN`/`QUALIFIED_GRAPH_COVERAGE` helpers;
  - the old mocks were migrated;
  - new FB specs are listed below.

## Stack observed

- NestJS-free tsyringe services in workspace-intelligence (`@injectable`, `TOKENS`, in `dependency-graph.service.ts`).
- Namespace builders are plain factories over a deps object (`analysis-namespace.builders.ts`), wired in
  `ptah-api-builder.service.ts` `analysisDeps`.
- Coverage uses the platform-core contract (`withCoverageVerdict`, `UnsupportedLanguageAnswer`,
  `language-coverage.interface.ts`) and the WI registry (`classifyFileForCoverage`, `supportedLanguagesFor`).
  The unsupported answer follows the pattern at `code-namespace.builder.ts:582-610`.
- The budget layer puts `coverage` and `status` in `PRESERVED_RESULT_KEYS` (`tool-result-budget.ts:100`).
- The dispatcher stays free of WI value imports, as the `symbol-index-query.ts` header asks.

## Proof: R4-B1 and R4-M1 are fixed (r4 probes as specs)

### R4-B1: Windows case-variant relative and absolute query paths

- **Before:** `getDependencies`/`getDependents` looked up the edge maps with the caller's spelling, so `pkg/a.ts`
  and `d:/repo/pkg/a.ts` returned `[]` with clean coverage.
- **After:** `DependencyGraphService.findNode` tries the exact key first. It then tries the unique node whose
  `graphPathIdentity` matches, which is case-folded on win32 only, with darwin and linux kept exact as in 23a.
  Last, it follows the file's real path re-rooted under the root's alias. That is the same identity and re-rooting
  that invalidation uses.
- Outputs keep the stored spelling, and an ambiguous folded identity selects no node.
- The namespace resolves relative paths with its existing join, and the dispatcher with its own join. Both then
  go through the service lookup, so there are no competing identity rules.
- `ptah_get_symbol_index` `pathPrefix` already folded Windows prefixes (`symbol-index-query.ts:138`). It is pinned
  by a spec that passes before and after, so it is not an FB.

Specs reproducing the probe. The A→B graph uses `D:/Repo/Pkg/A.ts` → `D:/Repo/Pkg/B.ts`, plus C for depth 2:

| Level | Spec | Before (base sources) | After |
| --- | --- | --- | --- |
| service | `R4-B1: a relative-joined variant …`, `R4-B1: an absolute variant …` (dependencies, depth 2, dependents) | FAIL: `[]` received, `[B]` expected | pass |
| namespace (reviewer's namespace probe) | `R4-B1 case-variant query paths (real graph service)`: relative `pkg/a.ts`, absolute `d:/repo/pkg/a.ts`, matching-case control | FAIL (3) | pass |
| dispatcher (real conversion) | `R4-B1 case-variant query paths through the dispatcher`: relative and absolute variants, control, file-not-in-graph | FAIL (4) | pass |
| service | `an ambiguous folded identity selects no node; an exact spelling still wins` | FAIL | pass |
| service (real junction) | `a query spelt through the real path finds the node of the alias root` | FAIL | pass |

### R4-M1: a root realpath failure dropped the junction identity silently

- **Before:** any rejection of `fs.promises.realpath(root)` became `undefined` with no qualifier.
- **After:** `realRootIdentity` returns `{ real, unavailable }`:
  - ENOENT or ENOTDIR (nothing on disk, so no alias can exist) and a UNC root (never resolved, by policy) stay
    clean;
  - any other code (EIO, EACCES, ELOOP, …) sets `unavailable`, and `publish()` stores
    `identityUnavailableCoverage(languages)`, which is `unchecked: null`, `clean: false` and `reasons[0]` `unchecked?`.
- It is published atomically with the graph, under the same generation fence.
- A later build whose lookup succeeds is clean again.
- The catch marker changed from `optional-capability` to `reported`, and the audit TOTAL is unchanged.

| Spec | Before | After |
| --- | --- | --- |
| `R4-M1: an EIO lookup is disclosed as unknown unchecked files, never clean` | FAIL (`unchecked` received `0`) | pass |
| `R4-M1 probe: parent and child alias roots built during EIO are not clean after a real-path invalidation` (real junction, EIO injected during both builds and restored before the invalidation: the reviewer's probe) | FAIL (`clean` received `true`) | pass |
| `a later build whose lookup succeeds is clean again` | FAIL | pass |
| `an absent root (ENOENT) proves no alias exists: coverage stays clean` (control) | pass | pass |

## Fails-before evidence (method)

1. Backed up the 7 modified sources to `%TEMP%`.
2. Wrote the HEAD versions (`git show HEAD:<path> > <path>`, read-only git).
3. Ran the new specs with a temporary jest config in `%TEMP%`. It is the lib config with ts-jest
   `diagnostics:false`, so the missing APIs fail as behaviour and not as a compile error.
4. Copied the sources back with a `cmp` check. `git diff --stat` was identical before and after (10 files,
   1540/266 before prettier).

Results on the base sources:

- **workspace-intelligence r4 describe:** 8 failed, 1 passed. The ENOENT control passes, and the off-win32 spec
  is skipped on Windows.
- **Namespace spec (new specs):** 22 failed, 1 passed. The pathPrefix pin passes on the base, as noted above.
- **Dispatcher (new specs):** 14 failed.
  - `builds the graph from bounded discovery: vendor trees excluded, other languages counted`
  - `%s for a file the graph cannot hold` ×4 (the FB "dependents of a python file is not a silent empty list")
  - `keeps fileInGraph and the qualified coverage ahead of a very long path and an oversized list` ×2
    (Decision 15 pattern, measured in tokens)
  - `carries the graph coverage in the page header, before files, on every page shape`
  - `builds from every file of a complete/truncated discovery` ×2
  - the R4-B1 dispatcher specs ×4

Some control specs fail on the base only because of an API that did not exist yet (`resolveNodePath`, `nodePath`).
The behavioural FBs are the variant specs, whose first assertion fails on `[]`.

## Verification (after)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2`:
  all 6 tasks succeeded. The known flakes did not trigger.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: both succeeded.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json
  dependencies." No `from "<word>"` appears in any new literal.
- `nx run degradation-audit:lint --skip-nx-cache`: `TOTAL 300 unsuppressed site(s)`. The one changed catch is
  marked `reported`.
- `prettier --check` on the 10 changed files: clean.
- The frozen prompt constants (`ptah-core-prompt.ts`, `NATIVE_AGENT_TOOL_POLICY`) are untouched. `git status
  --short` shows only the 10 files above, plus the pre-existing untracked `code-logic-review.md`, which is not mine.
- Budget: every new budget spec asserts `countTokensPiecewise(text) <= budget.tokens` through the real
  `createToolSuccessResponse` budget layer. Spool roots use `mkdtemp`.

## Plan deviations

1. **Files outside the entry's list.** `dependency-graph.service.ts` and its spec, `graph-coverage.ts` and
   `WI/index.ts` are all in lane H. The carried criteria (User Decision 20) require the service fix, and the
   discovery glob needs `recognisedSourceExtensions` in the barrel.
2. **Namespace `getGraphCoverage`/`getGraphCoverageForFile` never resolve `undefined`.** With no answering graph
   they return `{ coverage: <census 'unknown'> }` and no counts. This is how every graph answer carries coverage
   (unknown is never clean) without the dispatcher loading WI to build one. `graphCompleteness` and
   `isEmptyGraphSnapshot` read the optional counts, so their behaviour is unchanged.
3. **The dispatcher's 5,000 slice was removed.** Every discovered file (at most 50,000) goes to `buildGraph`, and
   23a's fair per-language cap reports `omittedByCap`. The Batch 9 fields keep their meaning.
4. **Answers of the unsupported kind** are broader than `.py`. Any file that is not graph-capable gets the answer:
   another language, `.mjs`, non-source and unrecognised files. None of them can ever be a graph node. Message
   subjects follow `code-namespace.builder.ts`.
5. **No tool description changed** (Decision 4). `INCOMPLETE_GRAPH_NOTE` and the Returns lists stay true. The new
   fields are 24c's to describe.

## Out-of-scope observations (not touched)

- The Electron and CLI `findFiles` (`fast-glob`, `electron-file-system-provider.ts:126-134`,
  `cli-file-system-provider.ts:128-135`) walk everything and then slice to `maxResults`. The vendor excludes do
  prune inside the walk, but the 50,001 limit bounds the result list, not the walk's time. VS Code bounds it
  natively.
- fast-glob matching is case-sensitive, so `Foo.TS` and `.R` files are not discovered. This predates the batch.
- Discovery globs recognised extensions only, as the plan specifies. Unrecognised code (`.vue`, `.sh`) is never
  discovered, so the graph census reports `unrecognised: 0` for it.
- A UNC root is never resolved (23a policy) and is not disclosed as `unavailable`. A mapped-drive alias of a UNC
  share would therefore still go unmatched.
- The `system-namespace.builders.ts:401-403` help text does not mention `coverage`, `nodePath` or the new
  namespace members, and says nothing false. It is a candidate for 24c.
- The service methods `getCoverage` and `getCoverageForFile` now have no production caller in vscode-lm-tools.
  They remain WI public API and are still used by specs.

## Revision round 1 (r1 REVISE 6/10)

Source: `reviews/batch-23b-code-logic-review-r1.md`. The carried R4-B1/R4-M1 probes passed in r1 and still pass.

### R1-B1: upper-case extensions vanished from a clean complete census

- **Fix:**
  - `analysis-namespace.builders.ts` builds the discovery glob with per-letter bracket classes: `ts` → `[tT][sS]`,
    `r` → `[rR]`, and `c++` → `[cC]++` (non-letters stay literal).
  - Bracket classes work in all three providers' globs (VS Code, and fast-glob in Electron/CLI), so no provider
    option is needed.
  - The registry already maps extensions case-insensitively (`languageForExtension`, `extensionHasCapability` and
    `classifyFileForCoverage` all lower-case), so `APP.TS` → typescript (eligible) and `analysis.R` → r
    (unsupported).
- **Counting:** every file discovery returns is classified by `selectGraphFiles` into analysed, unsupported,
  unrecognised or non-source, so none is dropped. As the reviewer accepted, discovery remains recognition-only.
- **Specs:**
  - namespace `discovers and counts upper-case extensions (APP.TS, analysis.R)`: this uses the adapters' exact
    fast-glob stream call, since vscode-lm-tools may not import the platform adapters (module boundaries).
  - The namespace glob-form assertion.
  - The dispatcher e2e `builds the graph from bounded discovery…` now includes `LIB.TS` and `analysis.R`.
  - Adapter pins in both **real** `CliFileSystemProvider` and `ElectronFileSystemProvider` specs:
    `findFiles (bounded|unbounded) matches upper- and mixed-case extensions through bracket classes`.

### R1-B2: canonical identity applied too late (symbol prefixes, multi-root routing)

- **Routing:** `findGraphEntryForFile` (used by queries, file coverage and the invalidation fallback) matches every
  cached graph using the identities invalidation uses: `fileIdentities`, lexical plus real path, compared against
  each root's key and real root.
  - The longest matching root identity wins; equal lengths go to the smaller key, so the build order never
    matters.
  - A real-target query therefore reaches the alias graph whatever other roots are cached.
- **Symbol prefix:** a new `DependencyGraphService.graphSpellingsOf(prefix)` re-roots the resolved prefix under
  every graph root that contains it, lexically or through the real path, and keeps any trailing `/`.
  - `pageSymbolIndex` accepts it as an optional fourth argument and matches an entry under any spelling.
  - The namespace passes the service's function, and stored output paths are unchanged.
- **Specs:**
  - namespace (real junction) `a real-target pathPrefix pages the same entries as the alias prefix` (includes a
    `pk/` sibling-boundary negative);
  - namespace `a real-target dependency query keeps answering after an unrelated root is cached` (the reviewer's
    Trigger B: coverage is clean/complete and `nodePath` is the alias spelling);
  - service `r1 B2: a real-path query reaches the alias graph with an unrelated root cached` in both build orders;
  - service `r1 B2: equally deep containing graphs are chosen deterministically` in both orders;
  - service `graphSpellingsOf re-roots a real-target prefix…`.

### R1-M1: discovery bounded the result, not the walk

- **Fix:** a new `collectBounded(source, limit)` (`platform-core/src/utils/bounded-collect.ts`, exported from the
  barrel) takes up to `limit` items of an async iterable. Leaving the `for await` loop calls the iterator's
  `return()`, which destroys a Node stream, and fast-glob's stream then destroys its walker.
- Both adapters now read `fg.stream(...)` through it whenever `maxResults > 0`. Unbounded calls keep the array API,
  so the behaviour is otherwise unchanged.
- It is shared the way `glob-watch-plan.ts` already is (the twin-adapter rule).
- **Specs:**
  - `bounded-collect.spec.ts` uses an endless async generator (exactly 3 pulls, then closed) and an endless
    Readable (destroyed, with reads ≤ limit + high-water mark).
  - Both real adapters: `findFiles with maxResults stops an endless walk at the limit`. `fast-glob.stream` is
    replaced by an endless instrumented Readable, a fake unbounded tree: the call returns 5 items, the stream is
    destroyed and reads stay bounded.

### Fails-before (r1)

- **Base:** the reviewed r0 state, meaning my r0 backups for the 7 r0 sources and HEAD for `symbol-index-query.ts`
  and both adapters. `collectBounded` was kept as test infrastructure.
- **Run:** the jest configs with `diagnostics:false`, then all files were restored with a `cmp` check.

| Area | Result on the r0 base |
| --- | --- |
| Service | 5 failed: both sibling-root orders, both deterministic-tie orders, `graphSpellingsOf` |
| Namespace | 4 failed: the upper-case discovery, the glob-form assertion, the real-target pathPrefix, the sibling-root dependency query |
| Dispatcher | the upper-case e2e failed (`analyzed`/`unsupported` counts) |
| CLI and Electron adapters | `stops an endless walk at the limit` failed in each (the array API never touched the stream) |
| Bracket-class adapter pins | pass on the base (the glob form was always supported); they are pins, not FBs |

`bounded-collect.spec.ts` is a new unit, so it has no base to fail against.

### Verification (after r1)

- **Scoped Nx run** for `@ptah-extension/{vscode-lm-tools,workspace-intelligence,platform-core,platform-cli,platform-electron}`
  with `test,lint,typecheck --skip-nx-cache --parallel=2`: every lint and typecheck target passed, and the
  vscode-lm-tools, WI, platform-core and platform-cli tests passed.
- **platform-electron:test** failed in three suites that fork real host processes from `dist/apps/ptah-electron/*`,
  which is not built in this lane worktree:
  - `workspace-watch-host.stress`
  - `workspace-watch-host.entry`
  - `electron-state-storage-worker-host`

  None of them imports the changed code (grep). Every other electron suite passes. One run also failed in the
  storage commit-store and platform-cli suites under load; both passed when re-run in isolation (commit-store
  78/78, platform-cli 225/225 + 3 todo).
- **Other checks:**
  - ptah-cli and ptah-electron typecheck passed.
  - validate-deps reports "All external imports are covered".
  - degradation-audit TOTAL 300 (no new catch).
  - prettier --check is clean on all changed files.
- **Files added in r1:**
  - `libs/backend/platform-core/src/utils/bounded-collect.ts` and its spec
  - `platform-core/src/index.ts` (export)
  - `symbol-index-query.ts`
  - both adapters and their specs

### Remaining notes

- Every multi-root query now does one synchronous realpath lookup, the same cost as one invalidation. A
  single-graph query does none.
- VS Code's `findFiles` is natively bounded by `maxResults`, and its glob supports bracket classes. VS Code was not
  exercised live here.

## Revision round 2 (r2 REVISE 6/10)

Source: `reviews/batch-23b-code-logic-review-r2.md`. The r1 and carried R4 probes still pass.

### R2-B1: a real-spelled ancestor prefix gave a clean empty page

- **Fix:** `DependencyGraphService.graphSpellingsOf` now maps a prefix to a graph root in both directions, using the
  identities invalidation uses (the prefix's lexical and real-path identities, each root's key and real root):
  - A prefix inside or equal to a root is re-rooted at the key (unchanged).
  - A prefix above a root, as a string prefix of `root + "/"` (the same comparison the symbol-index filter makes),
    adds `key + "/"`. This selects exactly that graph's nodes.
  - Only graphs whose root is reached this way contribute. An unrelated cached graph is never selected by a
    parent spelling, and a sibling name (`realx/`, `real/pk/`) selects nothing.
- **Specs:**
  - Namespace `r2 B1: ancestor, equal and descendant prefixes select the alias/pkg graph in both spellings`
    reproduces the reviewer's exact case: graph and session rooted at `alias/pkg` on a real junction, plus an
    unrelated second graph. It covers:
    - `real`, `real/`, `alias`, `alias/`, `real/pkg`, `real/pkg/`, `alias/pkg/` and `.` → both files;
    - `real/pkg/A` and `alias/pkg/A` → A only;
    - `realx/` and `real/pk/` → empty.
  - Service `r2 B1: graphSpellingsOf maps a real-spelled ancestor prefix to the alias/pkg root`.

### R2-M1: fast-glob buffered a whole directory before the limit was seen

- **Fix:** a new `walkGlobMatches(pattern, { exclude, cwd, dot })` in `platform-core/src/utils/bounded-glob-walk.ts`
  (exported). It uses the picomatch semantics platform-core already uses:
  - depth first, one `fs.promises.opendir` handle per level (`bufferSize: 32`), read entry by entry;
  - excluded directories pruned without being opened;
  - symbolic links followed, with a cycle guard that keeps only the current ancestor chain;
  - absolute patterns matched against absolute paths;
  - matches yielded one at a time.
- Both adapters now use `collectBounded(walkGlobMatches(...), maxResults)` whenever `maxResults > 0` (CLI
  `dot:false`, Electron `dot:true`, as their fast-glob options). Unbounded calls still use fast-glob's array API.
  Truncation is still disclosed upstream: discovery asks for limit + 1, so the census reads `truncated`.
- State held during a bounded call: one open handle, one real path and up to 32 buffered entries per depth level.
- **Specs:**
  - `bounded-glob-walk.spec.ts`:
    - parity with fast-glob on 5 pattern/exclude/dot combinations (dot directories, nested excludes,
      bracket-class extensions, static-base patterns);
    - the absolute pattern case;
    - excluded directories are never opened;
    - no loop through a junction to an ancestor;
    - the reviewer's case: a real 2,000-file flat directory with limit 5 reads at most 6 entries, opens 2 handles
      and closes 2.
  - Both **real adapters** have `findFiles with maxResults reads a bounded number of entries of a 2,000-file
    directory`, instrumented with a new `countDirectoryReads` probe in `@ptah-extension/platform-core/testing`.
  - The r1 mocked-stream adapter specs were replaced, and the r1 `collectBounded` spec remains.
- **Found while fixing:** `[cC]++` never matched `.c++`, because picomatch treats `+` after a class as an operator.
  The discovery glob now uses one-character classes for every non-letter (`[cC][+][+]`), pinned by the parity
  spec and by the namespace discovery spec (`engine.C++` → cpp, unsupported).

### Fails-before (r2)

- **Base:** r1 versions of `dependency-graph.service.ts`, `analysis-namespace.builders.ts` and both adapters (my
  r1 snapshot, formatting-only different from r1 final). The new walker and probe were kept as test infrastructure.
- **Run:** diagnostics-off jest configs, then all files were restored with a `cmp` check.

| Area | Result on the r1 base |
| --- | --- |
| Service | 1 failed: the `graphSpellingsOf` ancestor case |
| Namespace | 3 failed: the r2 B1 ancestor case, upper-case discovery now including `.C++`, and the glob form |
| CLI adapter | 1 failed: the 2,000-file spec (`entriesRead` 0, because the walk used fast-glob) |
| Electron adapter | 1 failed: the 2,000-file spec (same reason) |

### Electron test evidence (correction of my r1 claim)

My r1 statement that three platform-electron suites fail for lack of `dist/` was wrong:

- **Stress:** only `workspace-watch-host.stress` has that precondition.
- **Entry:** `workspace-watch-host.entry` builds its own bundle and times out on native watcher cases.
- **Storage:** the storage suites time out under load.

Full `npx jest -c libs/backend/platform-electron/jest.config.ts --ci` runs, one after another, on the same machine
(logs in `%TEMP%/b23b-r2-*.log`). lane-i is `task-559-lane-i` at Batch 24a, with no 23b code; it was used for
tests only and nothing there was edited.

| Run | Suites failed | Tests failed | Failing suites |
| --- | --- | --- | --- |
| lane-i run 1 | 1 | 3 | stress |
| lane-i run 2 | 2 | 4 | stress, **entry** |
| lane-h run 1 (with the old sequential 2,000-file fixture) | 3 | 6 | stress, entry, my `electron-file-system` spec (5 s timeout while writing the fixture) |
| lane-h run 2 | 5 | 11 | stress, entry, storage worker-host, worker-loop, legacy-scanner (load timeouts) |
| lane-h run 3 | 1 | 3 | stress only |
| lane-h without `electron-file-system.spec` | 2 | 3 | stress, **entry** |

- **Conclusions:**
  - `stress` fails identically everywhere; the missing bundle is a pre-existing precondition.
  - `entry` fails in lane-i without any 23b change, passes in lane-h run 3, and fails in lane-h even with my
    adapter spec excluded. It is a timing-sensitive native-watcher flake, not caused by the adapter change.
  - The storage suites fail only in a loaded run and never touch `findFiles`.
- **One real defect of mine, fixed:** the new 2,000-file adapter spec wrote its fixture sequentially and could
  exceed jest's 5 s default under full-suite load. It now writes in parallel chunks of 200 and has a 30 s timeout
  (both adapters). The last full lane-h run and the isolated file pass (26/26).
- **platform-cli full run:** lane-i 15/15 suites (222 tests + 3 todo); lane-h 15/15 suites (225 tests + 3 todo).

### Verification (after r2)

- **Scoped Nx run** for `@ptah-extension/{vscode-lm-tools,workspace-intelligence,platform-core,platform-cli}` with
  `test,lint,typecheck --skip-nx-cache --parallel=2` and `NX_DAEMON=false`, `NX_ISOLATE_PLUGINS=false`: all 12
  targets passed.
- `@ptah-extension/platform-electron`, `ptah-cli` and `ptah-electron` lint and typecheck: passed.
- **platform-electron tests:** see the table above.
- validate-deps: "All external imports are covered". Degradation audit: TOTAL 300 (the four new catches in the
  walker are marked `optional-capability`). Prettier is clean on every changed and new file.
- **Files added in r2:**
  - `platform-core/src/utils/bounded-glob-walk.ts` and its spec
  - `platform-core/src/testing/probes/count-directory-reads.ts`
  - `platform-core/src/testing/index.ts` (export)
- **Files changed in r2:**
  - `platform-core/src/index.ts`
  - `bounded-collect.ts` (doc)
  - both adapters and their specs
  - the service and its spec
  - the namespace and its spec
  - the dispatcher spec (its e2e provider now calls the adapters' bounded walk)

## Bounded correction (post-cap, after r3 REVISE 6/10)

Source: `reviews/batch-23b-code-logic-review-r3.md`. The r2 fixes and the carried R4 probes pass. The review
confirmed the `entry` Electron timeout is pre-existing, reproduced in lane-i.

### R3-B1: an unreadable directory became a clean, complete, empty census

- **Walker (`platform-core/src/utils/bounded-glob-walk.ts`):** every I/O failure is reported to a required
  `onFailure(code)`: `realpath` and `opendir` of a directory, a failure part-way through reading a directory, a
  link's `stat`, and a literal path's `stat`.
  - ENOENT alone is the benign race; fast-glob suppresses only ENOENT too.
  - The walk continues with the rest of the tree.
  - The four catch sites are now marked `reported`.
- **Adapters (CLI and Electron):** failures are tallied with `createFailureTally()`. When any failure was reported,
  the bounded `findFiles` rejects with the new `IncompleteFileSearchError`, which carries `matches` (what was
  found) and `failures` (`total`, `byCode`). Its message holds counts only, never a path. An unlimited call keeps
  fast-glob's own rejection. The `IFileSystemProvider.findFiles` doc states this.
- **Discovery → coverage:**
  - `discoverSourceFiles` catches only `IncompleteFileSearchError`. It keeps the partial files and returns
    `unreadable: { paths, byCode }`.
  - The dispatcher passes `censusUnknown: true` to `buildGraph`, and the namespace forwards it to the service.
  - `buildGraphCoverage` then publishes `census:'unknown'`, so `clean:false` with reasons led by `census?`.
  - Any other discovery failure still propagates to the build's `failed` status.
- **Specs:**
  - walker: subtree EIO/EACCES/EPERM recorded while the rest is still walked; root EIO; ENOENT is not a failure;
    literal `stat` EACCES.
  - both **real adapters**: `findFiles with maxResults rejects an unreadable subtree (EIO|EACCES|EPERM) as
    incomplete` (the matches keep `a.ts`, and the message has no path).
  - namespace: `an EIO opening a subtree|the root is returned as unreadable and the graph census is unknown`, run
    end to end through the adapter-equivalent call, the real namespace and the real graph service.
  - dispatcher: `builds with an unknown census when discovery reports unreadable paths`.

### R3-S1: a limited literal search returned []

- **Fix:** a pattern without glob syntax (`picomatch.scan().isGlob === false`) is a literal path. It gets one
  `stat`, as fast-glob's static reader does: a file that exists and is not excluded, whatever `dot` is.
- Also aligned with fast-glob:
  - a leading `./` is dropped;
  - excludes use the same `dot` as the pattern, as fast-glob's ignore filter does;
  - an absolute pattern is matched against absolute paths.
- A pattern without `**` or braces never descends below the depth its segments can match. This is also
  fast-glob's deep filter, and it pruned the reviewer's cost.
- Matching is still picomatch, the matcher fast-glob's micromatch is built on.
- **Specs:**
  - The walker parity table has 26 patterns × `dot` true/false, each against fast-glob with the adapters' options.
    It covers: literal relative, absolute, `./`, missing, a literal directory, a literal dot file, a literal
    excluded file; `**/package.json` with and without excludes; `*.json`; `*`; `src/*.ts`; `./src/*.ts`; braces;
    extglob `+(a|b)` and `!(a)`; the case-sensitive `*.TS`; classes; `**/.*`; the discovery glob; absolute globs.
  - A depth-pruning spec.
  - Both **real adapters** run a 15-pattern table where `findFiles` with a large limit must equal the unlimited
    search, including the reviewer's `package.json`.

### Cost (20,000-file flat directory, real CLI adapter, 3 runs each)

| Implementation | Bounded (limit 50,001) | Unlimited (fast-glob) |
| --- | --- | --- |
| First version | 270–378 ms | 92–177 ms |
| After making the walker cheap | 107–151 ms | 76–115 ms |

- Making it cheap meant handling entries inline (one generator per directory, not per entry), building
  relative and absolute spellings by concatenation, and raising the `opendir` buffer to 128.
- Limit 5 takes 2–4 ms. Correctness was not traded for speed: the parity tables pass.

### Fails-before (post-cap)

- **Base:** the r2 state:
  - r2 snapshots of both adapters, the namespace and the service;
  - the r0 snapshots of `graph-coverage.ts`, the dispatcher and `types.ts`, which r1 and r2 left unchanged;
  - the r2 walker **reconstructed** from the r2 edits, because it was never snapshotted.
- The only additions to that base were the new `IncompleteFileSearchError`/`createFailureTally` definitions, which
  the r2 walker never calls; they are test infrastructure only.
- **Run:** diagnostics-off jest configs, then everything was restored with a `cmp` check (identical diff stat).

| Area | Result on the r2 base |
| --- | --- |
| Walker | 14 failed: 8 literal-parity cases, the depth prune, 5 failure cases |
| CLI adapter | 7 failed: 4 literal parity cases, 3 unreadable-subtree rejections |
| Electron adapter | 7 failed: the same 7 cases |
| Namespace | 2 failed: EIO in a subtree and at the root |
| Dispatcher | 1 failed: `censusUnknown` |

### Verification (post-cap)

- **Scoped Nx run** for `@ptah-extension/{vscode-lm-tools,workspace-intelligence,platform-core,platform-cli}` with
  `test,lint,typecheck --skip-nx-cache --parallel=2` and `NX_DAEMON=false`, `NX_ISOLATE_PLUGINS=false`: all 12
  targets passed.
- `@ptah-extension/platform-electron`, `ptah-cli` and `ptah-electron` lint and typecheck: passed.
- **platform-electron full jest run:** 33 suites passed, 3 failed.
  - `workspace-watch-host.stress` fails on the pre-existing missing-bundle precondition.
  - `electron-state-storage-commit-store` and `electron-state-storage-worker-host` hit 5 s test timeouts under the
    loaded full run. Re-run in isolation they passed 106/106. Neither calls `findFiles`, and the same flake was
    seen in r2.
  - `electron-file-system.spec` (this batch) passed.
- validate-deps: "All external imports are covered". Degradation audit: TOTAL 300. Prettier is clean on every
  changed and new file.
- **Files changed post-cap:**
  - `platform-core`: `utils/bounded-glob-walk.ts` and its spec, `index.ts`, `interfaces/file-system-provider.interface.ts`
  - both adapters and their specs
  - `analysis-namespace.builders.ts` and its spec
  - `types.ts`
  - `protocol-dispatcher.ts` and its spec
  - `dependency-graph.service.ts`
  - `graph-coverage.ts`

## Narrow fix (Decision 23)

Source: `reviews/batch-23b-code-logic-review-r4-postcap.md` (R4-B1, R4-S1). Only one source file changed,
`platform-core/src/utils/bounded-glob-walk.ts`, plus specs.

### R4-B1: a nonexistent root gave a complete, clean, empty graph

- **Fix:** before any matching, the walker `stat`s the search root (`cwd`):
  - a stat failure with any code (ENOENT, EACCES, EPERM, EIO, ...) is reported to `onFailure`, and nothing is
    walked;
  - a root that is not a directory is reported as `ENOTDIR`.
- ENOENT stays exempt only for entries that vanish below the root during the walk.
- The adapters then reject with `IncompleteFileSearchError`, discovery returns `unreadable`, and the graph
  publishes `census:'unknown'` (`clean:false`, reason `census?`). `ptah_get_dependents` and
  `ptah_get_dependencies` answer `count:0, fileInGraph:false` with that unknown coverage, never a clean empty list.
- **Specs:**
  - walker: missing root (ENOENT); root is a file (ENOTDIR) for a glob and for a literal; root `stat`
    EACCES/EPERM/EIO.
  - both **real adapters**: `findFiles with maxResults rejects a missing root | a root that is a file as
    incomplete`.
  - dispatcher: `ptah_get_dependents|ptah_get_dependencies over a missing workspace root answers with an unknown
    census, never clean`, run through the real namespace, the real graph service and the adapters' bounded call
    over a real nonexistent path.

### R4-S1: escaped glob components returned [] with a limit

- **Fix:** the pattern's static part (`picomatch.scan().base`) is glob syntax. It is decoded
  (`\x` → `x`, as glob-parent does) only for the file-system calls: the literal `stat` and the walk's start
  directory. Matching keeps the escaped pattern through the same picomatch matcher.
- `scan({ unescape: true })` was not used, because it misclassifies an escaped brace as a literal.
- **Specs:**
  - The walker parity table against fast-glob adds 12 patterns × both `dot` settings, over Next.js-style
    `app/[id]/page.tsx`, `app/(group)/…` and `lit[1].ts` fixtures:
    - escaped literals, relative and absolute;
    - escaped static bases with `*`, `**/*` and `**/*.ts`;
    - an unescaped `app/[id]/page.tsx`, which is a character class in fast-glob too;
    - `app/*/page.tsx` and `**/*.tsx`.
  - Both **real adapters** add 5 escaped patterns to the bounded-vs-unlimited table and assert that the unlimited
    search finds the file, so parity cannot pass vacuously.

### Fails-before (Decision 23)

- **Base:** the post-cap walker (my post-cap snapshot); every other file was unchanged.
- **Run:** diagnostics-off configs, then the walker was restored with a `cmp` check (identical diff stat).

| Area | Result on the post-cap base |
| --- | --- |
| Walker | 23 failed: 18 escaped parity cases, the missing root, ENOTDIR on a literal, EACCES/EPERM/EIO on root stat |
| CLI adapter | 6 failed: 5 escaped parity cases, the missing root |
| Electron adapter | 6 failed: the same 6 cases |
| Dispatcher | 2 failed: both missing-root tool answers |

These are pins, not fails-before; they already passed on the base:

- the adapters' "root is a file" case (a file `cwd` already failed `opendir` with ENOTDIR, which was reported);
- the walker's ENOTDIR case for a glob.

### Verification (Decision 23)

- **Scoped Nx run** for `@ptah-extension/{vscode-lm-tools,workspace-intelligence,platform-core,platform-cli}` with
  `test,lint,typecheck --skip-nx-cache --parallel=2`: all 12 targets passed.
- platform-electron, ptah-cli and ptah-electron lint and typecheck: passed.
- **platform-electron full jest run:** 35 suites passed; only `workspace-watch-host.stress` failed, on the known
  missing-bundle precondition (645 tests passed, 3 failed).
- validate-deps: "All external imports are covered". Degradation audit: TOTAL 300 (the new root-stat catch is
  marked `reported`). Prettier is clean.
