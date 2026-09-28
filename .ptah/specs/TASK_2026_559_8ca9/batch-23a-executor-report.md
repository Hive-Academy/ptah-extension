# Batch 23a executor report — Graph accounting, bounds, atomic publish (Lane H)

Worktree `task-559-lane-h`, branch `fix/task-559-lane-h`, base 186ba8cde (Batch 22). No git operations were run. Scope is the batch's 4 files, 1 lib. Tool response shapes did not change: the dispatcher and the namespace are untouched (23b).

## Changes

| File | Change |
| --- | --- |
| `WI/ast/graph-coverage.ts` (new) | Task 23a.1. Adds `GRAPH_PARSE_CAP` 5,000 and `GRAPH_EDGE_CAP` 250,000, plus these pure helpers: `selectGraphFiles`, `buildGraphCoverage`, `mergeGraphCoverages`, `saturatingSum` and `limitLanguageCounts`. Types: `GraphFileSelection`, `GraphResolutionCounts`, `GraphCoverageInput`, `UnsupportedLanguageKey` |
| `WI/ast/graph-coverage.spec.ts` (new, 21 tests) | Cap fairness, census buckets, the top-8 + `other` rule, saturation, and every multi-root merge rule |
| `WI/ast/dependency-graph.service.ts` | Task 23a.2. Eligible-only parsing, failures counted by reason, resolution tally, edge cap, and coverage published in `publish()` together with the graph |
| `WI/ast/dependency-graph.service.spec.ts` (+9 tests, 49 total) | The two FB specs plus coverage behaviour. The 40 existing tests (Batch 9 and 9b) are unchanged |

No barrel edit (D8). Nothing outside `ast/` imports the new symbols yet. 23b can use `GraphCoverage` (already exported) and `LanguageCoverage` (from platform-core), or add the barrel line when its consumer lands.

## Behaviour

- **Selection (`selectGraphFiles`)**
  - Every given file is classified with `classifyFileForCoverage(path, 'graphEdges')` into eligible, `unsupported` (with `unsupportedByLanguage`), `unrecognised` or `nonSource`.
  - Duplicate paths, with either separator, count once.
  - When more than 5,000 files are eligible, the cap is shared round-robin across languages. Languages go in `LANGUAGE_IDS` order, and each language's files go in code-unit path order.
  - The selection keeps the input order. Under the cap, the node order is therefore identical to before.
- **Parsing**
  - Only selected (graph-capable) files are parsed. Behaviour change: `.py/.go/.cs` files in the list used to be parsed into import-less nodes. They are now counted as `unsupported` and never parsed.
  - `parseFile` records `read` (read threw) or `parse` (analysis returned an error or threw). `grammar-unavailable` is recorded only on an unreachable guard.
  - Both new catches are `catch (error: unknown)` and carry `degradation-audit: reported` markers.
- **Linking**
  - Each import is tallied as an edge, `external` or `unresolvedInternal`. An import counts as internal when it is relative or absolute, or when a tsconfig `paths` pattern claims it.
  - `truncatedImports` is 0: there is one target per import until 32b.
  - When a new distinct edge would exceed 250,000, linking stops. The graph then gets `edgeCapHit: true` and a fixed-text info log.
- **`context`** is `'partial'`, with the approximation `resolver-context-partial`, when no tsconfig `paths` were supplied and at least one import was counted external. The reason: an alias import cannot be told apart from a package in that case.
  - The namespace passes `undefined` today (`analysis-namespace.builders.ts:453`), so every current TS graph is qualified until 32b reads tsconfig itself.
  - **Reviewer decision point.** This is deliberate honesty: a lib whose only importers use `@scope/x` would otherwise read as a clean "no dependents".
- **Atomic publish**
  - `publish(key, graph, report)` sets the graph and a `GraphCoverageReport { files, languages }` in one synchronous step, only while `isCurrent()` holds.
  - A superseded or evicted build publishes neither.
  - Eviction, `retainOnly` and `clear` drop the report together with the graph, as before.
- **Getters**
  - `getCoverage` and `getCoverageForFile` still return `{graphedFiles, discoveredFiles}`, now read from the same record.
  - New `getCoverageReport(root?)` and `getCoverageReportForFile(file)` return both parts from one publish. With no root, the file counts are summed (as before) and the language coverage goes through `mergeGraphCoverages`.
- **Batch 9 meanings**
  - `graphedFiles` is the list given to `buildGraph`, minus the files the service's own cap dropped. For today's callers this is equal to the old value: the dispatcher still pre-slices to 5,000 TS/JS files.
  - `discoveredFiles` is unchanged.
  - `discoveredFiles − listed` becomes part of `omittedByCap`.
- **Other coverage fields**
  - `excluded` is `null`: vendor trees are excluded inside discovery.
  - `unchecked` is 0.
  - New option `BuildGraphOptions.censusLimit` gives `census: 'truncated'` + `censusLimit`. 23b's bounded discovery sets it (50,001). Unset means `complete`.
- **Merge**
  - Counts are summed with saturation, and any `null` makes the sum `null`.
  - `census` and `state` take the worst value, and `censusLimit` takes the max.
  - Languages are unioned in `LANGUAGE_IDS` order.
  - Approximations are unioned under the priority rule. The roots' `approximationsOmitted` values are added, so the result is an upper bound.
  - `edgeCapHit` is ORed. `context` is `partial` if any root is partial or lacks a resolution; a missing resolution also makes the counts `null`.
  - `checks` becomes `mixed` when the roots differ.

## Fails-before

Each run used a temporary local revert, restored afterwards; the worktree diff was confirmed identical. The base service run used a temporary jest config in `/tmp` with ts diagnostics off, so tests fail individually instead of the whole suite failing to compile.

| Revert | Result |
| --- | --- |
| Base `dependency-graph.service.ts` (HEAD 186ba8cde) against the new service spec | 9 failed, 40 passed. **"edge cap is disclosed"** failed on the edge count (250,500 ≠ 250,000). **"superseded build publishes neither graph nor coverage"** failed: the base parsed the `.py` into a third node and had no report. The 7 other new tests failed with `getCoverageReport is not a function`. All 40 pre-existing tests passed |
| `selectGraphFiles` round-robin replaced by the old first-N-in-discovery-order cap | 3 failed, 18 passed: **"cap does not starve the second language"**, round-robin order, and order independence |

After restore, both specs pass: 70/70, with the service spec at about 3 s.

## Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache` (`NX_ISOLATE_PLUGINS=false`, `--parallel=2`): typecheck, lint and test all passed, and it printed "Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence". I ran it twice; the second run followed the marker edit.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: 2 successful tasks.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: workspace-intelligence "1 ok (baseline 1)", "TOTAL 300".
  - The first run showed 302, because the two new `return`ing catches were flagged. They are now marked `reported`, since the failure is disclosed in `failedByReason`.
- Sanity check outside scope: vscode-lm-tools `analysis-namespace.builders.spec` and `protocol-dispatcher.spec` (the graph consumers) pass, 310/310.
- `prettier --check` on the 4 changed files: clean.
- `ptah-core-prompt.ts` is unchanged (`git diff --quiet`). `NATIVE_AGENT_TOOL_POLICY` was not touched.
- `git status --short`: M `dependency-graph.service.ts`, M `dependency-graph.service.spec.ts`, ?? `graph-coverage.ts`, ?? `graph-coverage.spec.ts`. Also ?? `code-logic-review.md`, which is not mine and was present at start.

## Deviations

1. **Discovery bounds are 23b, not 23a.** The dispatch prompt mentions them (vendor excludes inside discovery, `discoverSourceFiles`), but the 23a entry scopes only accounting, caps and publish. Task 23b.1 owns `discoverSourceFiles` and `GRAPH_VENDOR_EXCLUDES`. 23a supplies the service-side hook, `censusLimit`.
2. **New `BuildGraphOptions.censusLimit`.** 23b's file list does not include the service, so the census input had to land here.
3. **Parsing unsupported languages stopped** (see Behaviour). Nothing consumed those nodes: `publicSymbols` and `graphEdges` are TS/JS only.

## Out-of-scope observations

- `invalidateFile` removes a node but leaves the published coverage as it was. That is pre-existing for the Batch 9 counts, and it is now also true of `analyzed`.
- The dispatcher still pre-slices the first 5,000 discovered TS/JS files (`protocol-dispatcher.ts:2699-2701`). The fair cap takes effect for MCP tools once 23b passes the full bounded list.
- The `approximationsOmitted` merge is an upper bound: the identities of omitted items are unknown, so duplicates across roots cannot be removed.

## Revision round 1 (r1 REVISE 5/10)

Review: `reviews/batch-23a-code-logic-review-r1.md`. The same 4 files changed. No git operations were run.

### B1: invalidation revokes the clean answer, in the same step as the graph change

- `invalidateFile` now calls `invalidateInGraph(key, graph, path)`. That call first replaces the root's report with `invalidatedCoverage(languages, wasAnalyzed)` and then removes the node and its edges. The whole thing is one synchronous step.
- `invalidatedCoverage` (new, in `graph-coverage.ts`):
  - An analysed node moves from `analyzed` to `unchecked`.
  - `resolution.context` becomes `'partial'` in every case, because the edges of the file and of its importers are gone.
  - A path that is not an analysed node moves no count, so the buckets stay disjoint. This covers a repeat invalidation and a new file. It still makes the context partial.
  - The report stays not clean until the next build publishes a fresh report.
- In-flight fence:
  - Each running build registers `{key, paths}` in `inFlightInvalidations`. It is removed in `finally`.
  - `invalidateFile` records the path for every running build whose root contains it.
  - Right after `publish`, in the same synchronous block, the build applies those invalidations to the graph it published. A build that may have read the old content therefore never publishes it as current.
  - Another root's invalidation does not touch the build.
- Batch 9 `files` counts are unchanged by invalidation. Generations and latches are untouched: invalidation does not supersede a build.

### B2: a supplied `paths` object no longer certifies resolution

This follows the reviewer's rule. New `classifyUnresolvedSpecifier(specifier, claimedByAlias)` sorts each unresolved import into one of three kinds:

| Kind | Specifiers | Effect |
| --- | --- | --- |
| `internal` | relative, absolute, package-local `#x` (package.json `imports`), or claimed by a supplied tsconfig pattern | counted `unresolvedInternal` |
| `external` | a `node:` builtin | counted external; proven without any context |
| `context-dependent` | any other bare specifier | counted external, and makes `context: 'partial'` |

- A `context-dependent` bare specifier includes a bare `fs`. With `baseUrl`, TypeScript looks for a local module first, so the reviewer's rule only accepts `node:` as proof.
- `context` is now `'partial'` exactly when some unresolved import is context-dependent. Whether `paths` was supplied no longer matters: the service reads no tsconfig or package manifest, so the absence of an alias mechanism is never proven. That inspection is 32b.

### M1: known-external graphs are clean

A graph whose only unresolved imports are `node:` builtins is `context: 'complete'`, with no approximation, and reads as clean.

**Deviation from the dispatch wording:** "bare package specifiers should not make a graph partial" contradicts the reviewer's exact rule ("Presence of some paths alone is insufficient ... do not assume absence from undefined"). Following the reviewer, a bare `lodash` stays partial until 32b can prove there is no alias. For this repository that is also correct: `tsconfig.base.json` declares `paths`.

### Minor (report wording)

My r0 note that Python/Go/C# nodes were "import-less" was wrong. Those languages do have import queries; what they lack is export queries. Dropping them from parsing loses no symbol-index entries. Their imports never produced edges, because only TS/JS are graph-capable.

### Specs added

- Service spec, 6 new tests (55 total):
  - `a supplied paths object never certifies resolution`, two cases: `{}` with `#b`, and an unrelated mapping with `utils/b`
  - `does not qualify a graph whose only unresolved import is a node: builtin`
  - `an invalidated file makes the coverage unclean with the graph change`
  - `an unknown file invalidated under a graph qualifies it without moving counts`
  - `applies an invalidation made during a running build to the graph it publishes`
- Graph-coverage spec, 13 new tests (34 total): a table of 11 specifiers for `classifyUnresolvedSpecifier`, and 2 `invalidatedCoverage` cases.
- One existing expectation changed: the `lodash` case with supplied `paths` is now `context: 'partial'`, which is the B2 rule.
- None of these specs spools, so no mkdtemp root was needed.

### Fails-before

Each was a temporary local revert to the r0 files. I restored the r1 files afterwards, confirmed them with `cmp`, and the specs were green.

| Revert | Result |
| --- | --- |
| r0 `dependency-graph.service.ts` against the r1 service spec (current `graph-coverage.ts`) | 7 failed, 48 passed: both `paths` cases, `node:` builtin, all three invalidation specs, and the updated `lodash` expectation |
| r0 `graph-coverage.ts` against the r1 graph-coverage spec | 13 failed, 21 passed (the new helpers are absent) |

After restore: 89/89 across both specs.

### Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache`: typecheck, lint and test all passed, and it printed "Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence".
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: workspace-intelligence "1 ok (baseline 1)", "TOTAL 300".
- `prettier --check` on the 4 files: clean.
- Sanity check: vscode-lm-tools `analysis-namespace.builders.spec` and `protocol-dispatcher.spec` pass, 310/310.
- `git status --short` (source): M `dependency-graph.service.ts`, M `dependency-graph.service.spec.ts`, ?? `graph-coverage.ts`, ?? `graph-coverage.spec.ts`.

### Residual (not in scope)

- An invalidation of a path outside every running build's root, while no graph is published, is not recorded. The sole-graph routing rule only applies once a graph exists.
- The 23b integration caveat stands: graph query output and coverage must be read in the same synchronous turn, or through a versioned snapshot.

## Revision round 2 (r2 REVISE 6/10)

Review: `reviews/batch-23a-code-logic-review-r2.md`. B2 and M1 are FIXED. The single-root B1 case is FIXED. One Blocking finding, R2-B1: overlapping cached roots. Only `dependency-graph.service.ts` and its spec changed. No git operations were run.

### Fix

`invalidateFile` now invalidates every published graph that could hold the file, in one synchronous call:

- **Which graphs:** those whose root contains the file (a parent root and a nested root alike), or that hold its node (explicit out-of-root lists).
- **How:** each graph goes through `invalidateInGraph`. That call replaces the graph's report and removes its node in one step.
- **Counts:** `analyzed → unchecked` moves only in graphs that held the node. A graph without the node only becomes `context: 'partial'`.
- **Fallback:** when no graph contains the path, the old routing applies (the sole graph), unchanged.
- **Unchanged:**
  - Query routing (`findGraphEntryForFile`).
  - Recording invalidations for every running build whose root contains the path, which already covered each overlapping root under its own generation fence.
  - Generations and latches.

### Specs (service spec: 59 tests)

`overlapping parent and nested roots (r2 B1)`. Parent `D:/repo` and child `D:/repo/pkg` both hold `pkg/a.ts` and `pkg/b.ts`, and `a.ts` has no imports when both graphs are built:

- **The reviewer's probe, run twice:** once with `evict(child)` and once with `retainOnly([parent])`. After `invalidateFile(pkg/a.ts)` both reports are not clean. After the child is dropped, `getDependents(b.ts)` is `[]`, and the parent's report for that file shows `analyzed 1, unchecked 1, context 'partial'` and is not clean.
- **A new nested file absent from both graphs:** both roots become not clean, with no bucket moved.
- **A sibling root that does not contain the file** stays clean.
- **Rebuild:** a later successful rebuild restoring clean coverage stays covered by the r1 specs.

### Fails-before

- **Revert:** the r1 `dependency-graph.service.ts` against the r2 spec (temporary local revert). I restored the r2 file afterwards and confirmed it with `cmp`.
- **Result:** 3 failed, 56 passed.
  - both probe variants
  - the new-nested-file case
- The sibling control passed on both, as expected.
- After restore: 93/93 across the two specs.

### Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache`: typecheck, lint and test all passed, and it printed "Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence".
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: workspace-intelligence "1 ok (baseline 1)", "TOTAL 300".
- `prettier --check` on the 4 files: clean.
- Sanity check: vscode-lm-tools `analysis-namespace.builders.spec` and `protocol-dispatcher.spec` pass, 310/310.
- None of the specs spools.
- `git status --short` (source): M `dependency-graph.service.ts`, M `dependency-graph.service.spec.ts`, ?? `graph-coverage.ts`, ?? `graph-coverage.spec.ts`.

## Bounded correction (post-cap, after r3 REVISE 6/10)

Review: `reviews/batch-23a-code-logic-review-r3.md`. R2-B1 is FIXED. One Blocking finding, R3-B1: root containment and keys were lexical and case-sensitive, so a Windows case variant or a junction/symlink alias missed both published and running graphs. Only `dependency-graph.service.ts` and its spec changed. No git operations were run.

### Fix: one path identity for root keys, containment and node lookup

- **`graphPathIdentity(path, caseInsensitive = win32)`** (new export of the service module). It extends the Batch 9b `graphRootKey` normalisation:
  - forward slashes
  - a win32 `\?\` / `\.\` prefix dropped
  - no trailing slash
  - case folded on win32 only
- **darwin keeps exact case (documented at `CASE_INSENSITIVE_PATHS`).** An APFS volume can be case-sensitive, and detecting that needs a probe on every volume. Symlink aliases are still matched on darwin, through the real path.
- **Root keys.**
  - `normalizeRoot` now returns this identity. Every cache is keyed through it: generations, graphs, coverage, symbol indexes, eviction and `retainOnly`.
  - `isUnderRoot` compares identities, so query routing follows the same rule.
  - Node keys keep their stored spelling; paths returned by queries are unchanged.
- **Real path of a root.**
  - `buildGraph` resolves it once per build (`fs.promises.realpath`, async, before parsing), right after registering its in-flight entry.
  - UNC roots are never resolved: touching a network share is a side effect.
  - On failure the lexical key is the only identity. The catch is marked `degradation-audit: optional-capability`.
  - At publish, the canonical identity is stored in `realRoots` when it differs from the key. It is dropped by `evict`, `retainOnly` and `clear`.
- **Invalidation (`invalidateFile`).**
  - Computes the file's identities once: the lexical identity, plus the real path through one `realpathSync.native` call. For a deleted file it uses the directory's real path plus the file name.
  - That is one or two filesystem calls per invalidation, never one per root, and never for UNC paths.
  - Then, synchronously for every published graph, `invalidateMatching` checks each root identity (the key and the stored real root) against each file identity.
  - A match is re-rooted at the key and looked up in a lazily built node-identity index (`WeakMap<graph, identity → stored node key>`). A file matched directly by an out-of-root node is also found.
  - Each matching root is qualified and its node removed in one step (`invalidateInGraph`). As in r1, `analyzed → unchecked` moves only when a node was found.
- **Running builds.** Every running build records the file's identities unconditionally. They are matched when the build publishes, once its real root is known, so an invalidation made before the root's realpath resolved is not lost. They are applied in the same synchronous block as `publish`.
- **Unchanged:** generations, the latch, and the all-root synchronous qualification.
- **Known limits (not in scope):**
  - Dependency queries still match node keys exactly: a case-variant query path is Batch 9b follow-up (e).
  - A darwin case variant is not matched (documented above).

### Specs (service spec: 64 tests; 98 across both specs)

Group `path identity (r3 B1)`:

- **`graphPathIdentity` unit:** fold on and off, backslashes, trailing separators, the `\?\` prefix.
- **The reviewer's probe (win32 only; `it.skip` elsewhere because folding is win32-only):** parent `D:/Repo` and child `D:/Repo/pkg`.
  - `invalidateFile('d:\repo\PKG\a.ts')` makes both reports `analyzed 1, unchecked 1`, not clean.
  - `evict('d:/REPO/pkg/')` then leaves the parent answering `[]`, not clean.
- **Cold build case variant (win32 only):** `invalidateFile('d:/REPO/Pkg/A.TS')` during a gated build of `D:/Repo`. The published report is not clean.
- **Control:** a backslash and trailing-slash spelling qualifies the root, while the sibling `D:/Repo2` stays clean.
- **Junction fixture (real filesystem):**
  - A temp directory from `fs.mkdtempSync(os.tmpdir())` holds `real/pkg/{a,b}.ts` and `alias`, a junction on win32 (a dir symlink elsewhere).
  - The fixture is built while the suite is collected. If the link cannot be created, the spec is `it.skip` with a logged reason, so it never passes silently.
  - The spec first asserts equal realpaths. It then builds parent and child through the alias, invalidates through the real path, and evicts the alias child.
  - Result: both reports are not clean, the parent answers `[]` and is not clean.
  - `afterAll` removes the temp directory; after the run, no `ptah-graph-alias-*` directory remains in `%TMP%`.
- On this host (win32) the fixture was created and all 5 specs ran; none were skipped.

### Fails-before

- **Revert:** the r2 `dependency-graph.service.ts` against the r3 spec (temporary local revert). I restored the r3 file afterwards and confirmed it with `cmp`.
- **Result:** 4 failed, 60 passed.
  - `graphPathIdentity` unit (the export is absent)
  - the case-variant probe
  - the cold-build case variant
  - the junction spec
- The separator/sibling control passed on both, as expected.
- After restore: 98/98 across the two specs.

### Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache`: typecheck, lint and test all passed, and it printed "Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence".
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2 projects".
- `ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: workspace-intelligence "1 ok (baseline 1)", "TOTAL 300". The three new catches are marked `optional-capability`.
- `prettier --check` on the 4 changed files: clean.
  - A directory-wide check also flags `ast.types.ts`. That file is unchanged vs HEAD, so the issue is pre-existing and not mine.
- Sanity check: vscode-lm-tools `analysis-namespace.builders.spec` and `protocol-dispatcher.spec` pass, 310/310.
- `git status --short` (source): M `dependency-graph.service.ts`, M `dependency-graph.service.spec.ts`, ?? `graph-coverage.ts`, ?? `graph-coverage.spec.ts`.
