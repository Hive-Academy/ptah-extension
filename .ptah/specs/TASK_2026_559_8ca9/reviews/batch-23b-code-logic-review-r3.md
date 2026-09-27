# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 23b, r3 after revision round 2. Reviewed in `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`. Source remained read-only; probes and fixtures were written under the OS temp directory. No git operations were used.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 2 |

Both r2 findings are fixed, and the carried Windows query/root-identity checks still pass. However, the replacement bounded walker silently converts directory I/O errors into a complete, clean empty census and breaks literal file searches with a result limit. These are independently reproduced production-path regressions, not inferred from failing tests. The score reflects working graph identity, bounded traversal and budget handling, but excludes the 7–8 band because ordinary file search and discovery failure handling remain incorrect.

References below are relative to this worktree unless stated otherwise. Scope included the complete new walker and its tests, both adapter implementations, the graph/prefix and namespace paths, symbol paging, the executor's revision report, the authoritative Batch 23b requirements and carried criteria, and the previously reviewed coverage/dispatcher paths. The new defects are in the shared walker; style issues are outside this review.

## r2 findings status

| Finding | Status | Evidence and impact |
| --- | --- | --- |
| R2-B1 — real ancestor prefix falsely returns no symbols | FIXED | `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts:1333` now maps prefixes above lexical and real roots. The exact mkdtemp junction repro returned both symbols for the alias parent, real parent and real root, each with count/total 2. |
| R2-M1 — per-directory fast-glob buffering survives a small result limit | FIXED for limited adapter calls | `libs/backend/platform-core/src/utils/bounded-glob-walk.ts:85` uses a directory buffer of 32 and async iteration; CLI `:135` and Electron `:133` route limited calls through it. On a real 2,000-file flat fixture, each adapter returned 5 after consuming 5 entries, opening and closing one handle. |

The original fast-glob probe still emits 2,000 entries and leaves `readableLength=1995` at the return of a limit-5 collection. That is a control demonstrating the old problem, not an outstanding defect in the new limited path, which no longer uses that stream.

For a prefix above two cached junction roots (`alias/pkg`, `alias/pkg2`), both real and alias parent prefixes map to both roots. An unrelated `realx` graph is excluded; `real/pk/` maps to none. The mapping is used against the existing symbol-entry set, then `pageSymbolIndex` sorts by file before paging (`symbol-index-query.ts:141`). It does not silently pick just one descendant root. Bare prefixes retain the existing textual-prefix semantics; a trailing separator expresses a directory boundary.

## Five logic questions

### 1. How does this fail silently?

A directory-open EIO is swallowed by `bounded-glob-walk.ts:88`; discovery then reports zero files and `truncated:false` (`analysis-namespace.builders.ts:624`). Building those results publishes `coverage.clean:true`, `census:'complete'`, `unchecked:0`. See R3-B1.

### 2. What user action produces unexpected behaviour?

An agent calls `ptah.search.findFiles('package.json')`. The namespace supplies its default limit of 20 (`core-namespace.builders.ts:149`), which selects the new walker. Its static pattern base is the file itself, and it tries to open that file as a directory (`bounded-glob-walk.ts:62,85`). The answer is empty. See R3-S1.

### 3. What input data produces a wrong answer?

An existing literal relative or absolute filename produces the R3-S1 false negative. Conversely, case variants and junction ancestor spellings now resolve correctly: `dependency-graph.service.ts:1333` and `symbol-index-query.ts:141` passed the case/alias probes. Returned dependency paths retained their stored `Pkg/A.ts` and `Pkg/B.ts` spelling.

### 4. What happens when a dependency fails?

Graph-root realpath failure still qualifies coverage via `dependency-graph.service.ts:217` and `graph-coverage.ts:354`; the carried EIO probe returns non-clean coverage with `unchecked?`. The NEW discovery walker has a different failure policy: it swallows realpath/opendir/stat errors (`bounded-glob-walk.ts:75,88,119`) without any failure signal. This defeats the graph's otherwise correct qualification when discovery fails but root identity succeeds.

### 5. What is missing that the requirements never mentioned?

Replacing fast-glob inside a general file-system port requires parity beyond source-discovery globs: literal patterns and non-ENOENT failures must retain their meaning. The new parity table in `bounded-glob-walk.spec.ts:46` covers dynamic globs, excludes and dotfiles, but not either reproduced case. The limited walk holds bounded per-directory state, not a universal time bound on directories or nonmatching entries (`bounded-glob-walk.ts:127`). That distinction remains relevant to sparse/remote trees; the measured flat-tree performance is not a guarantee for those trees.

## Failure modes / new defects

### R3-B1 — Blocking: directory I/O failure becomes a clean, complete empty graph

- **Trigger:** CLI or Electron source discovery encounters EIO/EACCES opening the root or a subtree. Root identity lookup can still succeed; directory listing permission and metadata/realpath access are separate operations.
- **Symptom:** The tool presents an incomplete or empty graph as clean. An agent can infer that a dependency/symbol does not exist when its directory was never read.
- **Evidence:** `libs/backend/platform-core/src/utils/bounded-glob-walk.ts:75` and `:88` catch all errors and return; the symlink stat catch at `:119` has the same policy. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:624` receives a normal empty array and at `:634` infers no truncation. Both adapters take this walker for discovery (`platform-cli/src/implementations/cli-file-system-provider.ts:135`; `platform-electron/src/implementations/electron-file-system-provider.ts:133`).
- **Independent reproduction:** `task559-23b-r3-new.cjs` creates a real temporary directory containing `APP.TS`, injects EIO only into `fs.promises.opendir`, calls the actual adapter through `discoverSourceFiles`, restores the dependency, and builds the returned files through the actual graph/namespace. Both platforms return `files:[]`, `truncated:false`, then `coverage:{clean:true,reasons:[],census:'complete',analyzed:0,unchecked:0,failed:0}`. Root identity remains available. This is distinct from the carried root-realpath EIO probe, which still passes.
- **Current handling:** Comments call this optional capability loss and incorrectly say fast-glob skips unreadable branches the same way. The installed fast-glob error filter (`node_modules/fast-glob/out/providers/filters/error.js:12`) suppresses ENOENT, or errors when explicitly configured with `suppressErrors`; these adapters do not enable that option.
- **Recommendation:** Preserve failure propagation for non-benign directory and link errors. The narrow correction is to rethrow EIO/EACCES rather than converting them to no matches; the existing discovery/build failure path can then report failure. If partial results are deliberately retained instead, the port must carry incomplete/error metadata through discovery into non-clean coverage. Add root and subtree error regression tests through the real adapter and graph answer path. Do not certify an unread census as complete.

### R3-S1 — Serious: limited literal file searches always miss existing files

- **Trigger:** A caller searches for a known literal file such as `package.json`, `src/a.ts`, or an absolute filename, with a positive result limit. The public search namespace defaults to such a limit.
- **Symptom:** CLI and Electron return `[]` for an existing file; the same adapter call without a limit returns the file. This breaks a normal file-location query and makes result semantics depend on whether a limit was supplied.
- **Evidence:** `libs/backend/platform-core/src/utils/bounded-glob-walk.ts:62` uses `picomatch.scan(pattern).base` as a directory unconditionally; `:134` starts walking it; `:85` calls opendir on the file and `:88` hides ENOTDIR. Public entry: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts:149-154`.
- **Independent reproduction:** In the same mkdtemp fixture, both real providers returned `limited:[]` for `findFiles('package.json', undefined, 5, root)`, versus the existing absolute file path for `findFiles('package.json', undefined, undefined, root)`. The fixture is `C:/Users/abdal/AppData/Local/Temp/task559-r3-new-RbgXif/package.json`.
- **Current handling:** The literal filename is treated as a directory; an implementation error is transformed into a normal empty list.
- **Recommendation:** Handle static file patterns explicitly using bounded stat/lstat semantics, or begin dynamic traversal at the correct containing directory and match the filename. Preserve only-files, excludes, absolute/relative spelling and symlink behavior. Add parity tests for literal relative and absolute files and missing files, including the default-limited public search namespace.

## Blocking issues

R3-B1 above: silent clean coverage after a failed directory census. No additional blocking findings.

## Serious issues

R3-S1 above: ordinary literal file queries are broken. No additional serious findings.

## Moderate and minor issues

None newly established. The performance and filesystem-order limits below are residual scope notes, not manufactured defects.

## Data flow

1. **PARTIAL:** Source-discovery namespace constructs case-inclusive language globs and vendor exclusions and requests one sentinel result past the 50,000 bound (`analysis-namespace.builders.ts:624`). Normal limits work; the walker currently loses failure information (R3-B1).
2. **PARTIAL:** CLI/Electron adapters choose bounded traversal for positive limits (`cli-file-system-provider.ts:135`, `electron-file-system-provider.ts:133`). Early close works; static pattern semantics do not (R3-S1).
3. **OK for successful discovery:** The graph accounts for a 5,000-file parse cap and 250,000-edge cap (`graph-coverage.ts:38,41`), resolver uncertainty (`:252`) and truncated census (`:253`).
4. **OK in reviewed paths:** Build generations fence publication (`dependency-graph.service.ts:403`); graph, coverage and root identity are installed in the synchronous publication section. Existing invalidation/lifecycle fixes remain intact. The defects above precede that accounting, so atomic publication cannot repair the missing census signal.
5. **OK:** Canonical query identity and prefix aliases feed sorted symbol paging (`dependency-graph.service.ts:1333`, `symbol-index-query.ts:141`). Parent-prefix and case probes pass.
6. **OK in tested budget cases:** Status/cap fields, `fileInGraph` and coverage survive real result-budget reduction; long payloads spool. The rerun produced 1,978-token answers for both graph query names while retaining all tested qualification fields.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| R2 real/alias ancestor prefixes | COMPLETE | Exact repro now returns both expected symbols; multi-root candidate and sibling exclusion probes pass. |
| R2 bounded per-directory buffering | COMPLETE | Both limited adapters consume 5 entries for 5 results and close the handle; directory buffer is 32. |
| Large/unlimited performance | COMPLETE for measured fixture | 20,000 flat files: current bounded limit 50,000 = 355 ms; current unlimited = 92 ms; lane-i old adapter = 90 ms. No pathological slowdown observed. |
| Carried R4-B1 Windows query identity | COMPLETE | Relative and absolute case/separator variants return the expected edges and stored spellings. |
| Carried R4-M1 root-realpath failure disclosure | COMPLETE | EIO qualification retained: clean false, reason unchecked?. |
| Discovery and graph-answer honesty | PARTIAL | R3-B1: directory-read failures bypass the qualification contract. |
| General file-search compatibility | PARTIAL | R3-S1: positive-limit literal patterns fail. |
| Batch 9/9b generation, background, empty/building/failed behavior | COMPLETE in reviewed/tested paths | No regression found in graph/dispatcher changes; scoped suites pass. Directory discovery error handling remains the new exception above. |
| Parse/edge/census caps and resolver qualification | COMPLETE for a successful census | Existing cap/context logic retained; no new loss identified. |
| Symbol paging and token-budget qualifications | COMPLETE in tested cases | Sorting/paging retained; real budget probe keeps coverage/fileInGraph/cap data at 1,978 tokens. |
| Electron pre-existing entry claim | VERIFIED | Independent lane-i entry-suite run reproduces native-watcher timeout without 23b. |

Implicit requirement exposed: replacing an established general glob implementation must preserve literal-file matching and observable I/O failure semantics.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Junction real ancestor above multiple cached roots | YES | Both eligible roots map; unrelated realx and real/pk/ do not. |
| Mixed Windows case and separator query spellings | YES | Carried dependency/dependent and namespace probes pass. |
| Root realpath EIO | YES | Coverage remains qualified, distinct from directory iteration failure. |
| Directory open EIO/EACCES | NO | R3-B1. |
| Existing literal pattern with maxResults | NO | R3-S1. |
| Flat directory much larger than result limit | YES | Five consumed entries; handle closed. |
| 20,000 matches / unlimited search | YES in fixture | Bounded path ~3.9x baseline but 355 ms total; unlimited path remains fast-glob. |
| Sparse, deep or remote trees | NOT benchmarked | A match cap is not a directory/time cap; state still scales with depth. No new severity assigned without a demonstrated regression. |
| Per-volume macOS case semantics | NOT retested | Previous documented limitation unchanged by this revision. |

## Verification

All probes are independent temporary Node scripts loading the actual TypeScript implementations with a minimal transpile loader. The graph analyzer is stubbed where the test concerns filesystem discovery/identity rather than parsing. No production files were edited. The only lane-i operation was the authorized scoped entry-suite test; baseline adapter code was read by the benchmark loader.

- **Scoped Nx:** `run-many -t=test,lint,typecheck` for workspace-intelligence, vscode-lm-tools, platform-core, platform-cli and platform-electron, with skip-nx-cache, parallel=2, NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. **14 targets passed; platform-electron:test failed.** Its result: 34 passed suites, 2 failed, 2 skipped; 618 tests passed, 5 failed, 4 skipped, 3 todo. Three failures are the missing stress-host bundle; two are entry watcher timeouts. Log: `%TEMP%/task559-23b-r3-review-workspace.log`.
- **Independent lane-i entry suite:** 11 passed / 1 failed. `nestedRepoDetection` timed out waiting for the first sync file, reproducing the same class of failure seen in lane-h. Log: `%TEMP%/task559-23b-r3-lane-i-entry.log`. The stress precondition is explicit at `platform-electron/src/workspace-watch/workspace-watch-host.stress.harness.ts:81`; the watcher timeout comes from `platform-core/src/testing/contracts/run-workspace-watcher-contract.ts:117`. These are not classified as new 23b defects.
- **Runtime checks:** ptah-cli and ptah-electron typechecks passed; validate-deps passed. Degradation audit passed with **TOTAL 300**. Its unchanged total does not prove the new suppressed-error branches are honest.
- **Diagnostics:** scoped ptah_get_diagnostics on bounded-glob-walk.ts returned TypeScript compiler diagnostics available: **0 errors, 0 warnings**.
- **Behavior probes rerun:** exact real-ancestor junction repro; carried case-relative/absolute namespace queries; carried root-realpath EIO; multiple-root ancestor/sibling mapping; 2,000-file bounded traversal; original fast-glob readableLength control; 20,000-file current/baseline timing; real budget layer with oversized graph answers; the two new regression probes.
- Main new probe: `%TEMP%/task559-23b-r3-new.cjs`; bounds/multiple-root probe: `%TEMP%/task559-23b-r3-bounds.cjs`. The baseline for timing is the lane-i CLI adapter without 23b, not a checkout or modification of HEAD. The timing is a single local flat-tree run, not a cross-platform performance claim.

Verification limitations: no cross-platform filesystem run or cold/network-volume benchmark was performed; full Electron tests cannot be called green. No source changes, staging, commits, stash/reset/restore/checkout or builds to manufacture a missing dist artifact were performed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the new bounded discovery walker turns unread directories into a clean, complete graph.
- What a robust implementation would add: non-benign filesystem-error propagation (or explicit incomplete-census metadata), static-file glob parity, and regression tests through the public search/discovery paths. Keep the now-working bounded consumption, alias-prefix mapping and carried qualification fixes.
