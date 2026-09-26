# Batch 24b executor report — Code index live coverage (Lane H)

Worktree `task-559-lane-h`, branch `fix/task-559-lane-h`, base e10c03a2d (Batches 13, 22, 23a and 24a merged). I ran no git write operations. `git show HEAD:<file>` was used read-only for the fails-before runs.

## Changes

| File | Change |
| --- | --- |
| `WI/services/code-symbol-indexer.service.ts` | Task 24b.1. Discovery comes from the registry, the skip filter now runs before the cap, and every eligible file lands in a bucket. Adds the live run state (`beginRun`, `settleRun`, `recordWrite`, `getCoverage`) and a per-file write lock |
| `WI/services/code-symbol-indexer.service.spec.ts` | +12 tests in `coverage — live index state (Batch 24b)`. The 12 existing tests are unchanged |
| `MCP/namespace-builders/code-namespace.builder.ts` | Task 24b.2. Search returns `{ index, coverage, bm25Only, hits }`. `UnsupportedLanguageAnswer` for search and reindex. The lazy run starts synchronously |
| `MCP/namespace-builders/code-namespace.builder.spec.ts` | +10 tests. One existing assertion changed from `result.hits` to `toMatchObject({ hits: [] })`, because the return type is now a union with `UnsupportedLanguageAnswer` |
| `WI/ast/language-registry.ts` | **Not in the batch file list.** Adds one export, `recognisedSourceExtensions()`. See Deviation 1 |

## Behaviour

### Accounting (24b.1)

- **Discovery**
  - Discovery asks for every extension a registry or recognised language claims (`recognisedSourceExtensions()`). The hand list `DEFAULT_EXTENSIONS` and the unused `extensions` option are deleted; no caller passed `extensions`, confirmed by grep.
  - Each file is classified with `classifyFileForCoverage(path, 'codeIndex')`:
    - `eligible` → indexed;
    - `unsupported` → counted, plus `unsupportedByLanguage` (top 8 + `other`, via `limitLanguageCounts`).
- **Skip filter and cap**
  - The skip filter now runs **before** the eligible-only stop at 2,000.
  - Past the cap, the run records `census: 'truncated'`, `censusLimit: 2000` and `omittedByCap: null`. Discovery stops there, so how many more files were eligible is unknown.
- **File size**
  - The stream is asked for every size (`maxFileSize: Number.MAX_SAFE_INTEGER`).
  - A file over 1 MiB is recorded as `failed` with reason `too-large` and is never read. Before this change, the stream's 1 MB default dropped such files without any count.
- **Failure reasons**
  - A read failure → `read`. An analyse error or an undefined result → `parse`.
  - A sink clear or insert failure counts in `failed` but has no `FailureReason`, so `failedByReason` leaves it out (documented at `FileOutcome`).
- **Buckets not observed:** `unrecognised`, `nonSource` and `excluded` are `null`. Discovery requests only recognised extensions, and ignored or default-excluded paths are dropped inside discovery. So the code-index coverage is never clean (see decision point D-a).

### Live state (24b.1)

- **Run start**
  - `indexWorkspace` calls `beginRun(root)` before its first `await`. It sets `updating` and drops the previous run's counts and the per-file record.
  - A newer run supersedes a running one. The older run's later writes go to the per-file record, and its end changes nothing.
- **Run end** (`try/finally`)
  - A normal return → `current`.
  - An abort, a discovery failure, or a thrown error (the "all files errored" guard) → `incomplete`.
  - `incomplete` stays until a run succeeds. `unchecked` is the selected files not yet written.
- **Per-file writes**
  - Every write (run or `reindexFile`) takes a per-file lock, keyed by `graphPathIdentity`. The file is read inside the lock. A per-file reindex and a run write of the same file therefore never interleave their clear and insert. Lock entries are removed when the last waiter finishes.
  - Every completed write gets a sequence number. Writes by the active run go to that run; all other writes go to the per-file `Map<identity, write>`, bounded at 2,000.
  - When coverage is read, the latest write of each file wins. This is how a per-file write during a run is folded into the run's accounting, and each file counts once.
  - Past 2,000 distinct per-file entries, the record stops growing and `census` becomes `truncated`. A file already tracked still updates.
  - A root with no record (new session) gets no per-file record. A per-file write never creates a census or promotes `unknown` or `incomplete`.
- **`getCoverage(root)`**
  - No record → `census: 'unknown'`, no `state`, counts `null`.
  - Running → `unknown` + `updating`.
  - Settled → the counts above.
  - Roots are keyed by `graphPathIdentity` (the Batch 23a identity), so `/workspace/` and `/workspace` share a record.
  - Counts saturate at `COVERAGE_COUNT_MAX`.
- **Sole writer check (grep, recorded as required)**
  - `sink.deleteSymbolsForFile` and `sink.insertSymbols` are called only by `code-symbol-indexer.service.ts`.
  - **However, the indexer is not the only thing that writes `code_symbols`.** The `memory:purgeJunk` RPC (`rpc-handlers/.../memory-rpc.handlers.ts:490` → `CodeSymbolStore.purgeJunk`, `memory-curator/src/lib/code-symbol.store.ts:597-630`) deletes rows whose path contains `/build/`, `/out/`, `/tmp/`, `/coverage/` and similar segments. Coverage does not see that delete.
  - `CodeSymbolStore.purgeWorkspace` (`:632`) has no production caller.
  - No snapshot claim is made: the doc on `getCoverage` says coverage describes runs and writes, not rows.

### Namespace (24b.2)

- **Search result shape**
  - `searchSymbols` returns `{ index, coverage, bm25Only, hits }`.
  - The error result is `{ index, coverage, bm25Only, error, hits: [] }`.
  - Coverage is read **after** `ensureIndexFresh`, so a run this call started reads `updating`.
  - With no indexer, coverage is `unknown`. A coverage read that throws degrades to `unknown`, with a fixed-text warn. That catch is new and marked `degradation-audit: reported`.
- **Unsupported language, search**
  - A search whose `filePath` extension names a recognised language without `codeIndex` (e.g. `.kt`) returns an `UnsupportedLanguageAnswer`.
  - Nothing is read: no freshness read, no lazy run, no search.
  - A filter with no recognised extension (a directory, a substring) still searches as before.
- **Unsupported language, reindex**
  - `reindex({ filePath })` of any non-indexable file (`.kt` → `kotlin`, `.zig` → `.zig`) returns an `UnsupportedLanguageAnswer`.
  - `reindexFile` is never called: no delete and no count.
  - The dispatcher's `'error' in result` check sends it down the success path, as the plan requires.
- **Lazy run start**
  - `startBackgroundRun` now calls `indexWorkspace` synchronously, inside a `new Promise` executor, so `beginRun` has run before it returns. A synchronous throw still becomes a rejection.
  - The chain stays fire-and-forget: the Batch 6 rule holds, and the full run is never awaited.
- **Message text:** no `from "<word>"` shape; `validate-deps` passes.

## Fails-before

Both runs used a temporary jest config in `%TEMP%\b24b`, with ts diagnostics off, so tests fail one by one instead of the whole suite failing to compile. For the namespace spec, I temporarily replaced the builder with `git show HEAD:<file>` and restored it afterwards; `cmp` confirmed the restore.

| Spec against base | Result |
| --- | --- |
| Indexer spec (base service) | **12 failed, 12 passed**. All 12 new tests failed; all 12 existing tests passed. Behavioural failures, not only the missing method: **"applies the skip filter before the eligible-only cap"** got `filesScanned` 0, expected 2. **"same-file overlap"** read `a.ts` twice before the run's write finished (received 2, expected 1). The FB tests "search during a run reports updating", "search after an aborted run reports incomplete" and "the 2,001st distinct per-file update" failed because `getCoverage` is absent |
| Namespace spec (base builder) | **10 failed, 30 passed**. All 10 new tests failed, including **"kt reindex is not filesScanned 1"**, **"search answers { index, coverage, bm25Only, hits }"**, **"Python stays searchable while Python queryExports errors"** (base returns no coverage) and **"a budget cut … never removes the coverage"** (base body has no `coverage`) |

After the change, all tests in both spec files pass (24 and 40), and the full suites pass through nx (see Verification).

A limitation I checked: reverting only the synchronous start in `startBackgroundRun` (back to `Promise.resolve().then(...)`) keeps all 40 namespace tests green. Every namespace caller awaits a freshness read, which drains the microtask before coverage is read, so the difference cannot be seen at the namespace surface. The synchronous `beginRun` is proven at the indexer ("search during a run reports updating" reads `updating` with no await after `indexWorkspace(...)`). The namespace code calls `indexWorkspace` synchronously by construction.

## Budget (tokens, measured through the real budget layer)

`applyToolResultBudget({ toolName: 'ptah_code_search_symbols', ... })` was given a 300-hit search result, with the spool going to an injected `mkdtempSync` root that is removed in `finally`.

- **Input:** raw 104,772 chars, which is 24,412 tokens.
- **Returned:** 1,969 tokens, within the budget of 2,000 tokens / 8,000 chars (reducer `json-compact`, truncated).
- **Coverage survived:** the body's `coverage` still has census, state, every non-null count and `unsupportedByLanguage`, and it comes before any `hits`.

## Verification (tails)

- `NX_ISOLATE_PLUGINS=false nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → "Successfully ran targets test, lint, typecheck for 2 projects" (6 tasks).
  - This includes the unchanged `protocol-dispatcher.spec` and `code-execution.engine.spec`. Their `{ indexWorkspace }`-only doubles go through the coverage fallback path.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron ptah-extension-vscode` → "Successfully ran target typecheck for 3 projects". The first run used `--skip-nx-cache`; I re-read the result line on a second run.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → vscode-lm-tools "2 ok (baseline 2)", workspace-intelligence "1 ok (baseline 1)", "TOTAL 300".
- `prettier --check` on the 5 changed files → clean.
- `ptah-core-prompt.ts` is unchanged (`git diff --quiet HEAD`). `NATIVE_AGENT_TOOL_POLICY`, the frozen prompt constants and the tool descriptions were not touched.
- `git status --short`: M the 5 files above. There is also `?? .ptah/specs/TASK_2026_559_8ca9/code-logic-review.md`, which was present at start and is not mine.

## Deviations

1. **`WI/ast/language-registry.ts`, outside the file list.**
   - "Discovery also streams recognised-unsupported extensions" needs the recognised extension list, and `RECOGNISED_LANGUAGE_EXTENSIONS` is private.
   - I added one read-only export, `recognisedSourceExtensions()`, in the same lib, instead of duplicating the list the registry calls "the only list".
   - No barrel edit: the indexer imports it relatively.
2. **`MCP/types.ts` unchanged.** `PtahAPI.code` is typed as `CodeNamespace`, imported from the builder, so the new shapes reach it with no edit.
3. **No new vendor list.** The existing vendor filters are `DEFAULT_WORKSPACE_EXCLUDES` and the ignore files, applied inside discovery, which is already before the stop. What changed is the order of the skip filter. The plan's extra vendor globs (`.venv`, `vendor`, `bin`, and so on) belong to 23b's `GRAPH_VENDOR_EXCLUDES`, and `bin/` would drop JavaScript CLI entry scripts from the index. **Decision point.**
4. **`omittedByCap: null` when truncated.** Discovery stops at the cap, so it has no count to report.

## Decision points for the reviewer

- **D-a.** `unrecognised` and `nonSource` are `null`, so the code-index coverage is never clean. Counting them would mean streaming every file, and the stream stats each file (the TASK_2026_344 cost). A `.vue` or `.sh` file can hold a symbol the index lacks, so `null` is the honest value.
- **D-b.** Sink write failures are counted in `failed` but have no reason key, because the closed `FailureReason` vocabulary has no `write`.

## Out-of-scope observations

- **The JSON reducer drops `null`-valued keys** (`json-compact`). In the budgeted body, `unrecognised`, `nonSource` and `excluded` disappear from `coverage` instead of reading `null`. `isCleanAnswer` still returns false (`undefined !== 0`), but the "unknown" signal is lost for a reader. This applies to every tool that carries coverage (tool-output-reducers; Lane A / 24c).
- **`memory:purgeJunk`** deletes `code_symbols` rows outside the indexer (see "Sole writer check").
- **`ptah_code_reindex` description** says "With filePath it reindexes that one file and returns its stats". Now it can also answer `unsupported-language`. The description is 24c's (registry-generated).
- **A skip-pattern file** (e.g. `a.spec.ts`) sent to `reindex({ filePath })` still returns `filesScanned: 1` with 0 symbols, because `reindexFile` skips it silently. This is pre-existing and not in the plan.
- **`reindexFile` has no 1 MiB limit**, unlike runs. This is pre-existing; 29a2 owns `too-large` in the parser.

## Batch 24r (reducer preserveKeys + explicit clean)

This is the orchestrator's design for r1 B1. It can be committed on its own, and it must be committed **before** the 24b files, because the indexer and the code namespace import `withCoverageVerdict`. Against HEAD it compiles without any 24b file.

### Exact file list (all under `<WT>/libs/backend/`)

| File | Change |
| --- | --- |
| `platform-core/src/interfaces/language-coverage.interface.ts` | See "Contract" below |
| `platform-core/src/interfaces/language-coverage.interface.spec.ts` | +5 tests (`withCoverageVerdict`). `CLEAN` is now typed `CoverageFields` |
| `platform-core/src/index.ts` | Exports the new symbols |
| `tool-output-reducers/src/lib/reducer.types.ts` | `ReduceContext.preserveKeys?: readonly string[]` |
| `tool-output-reducers/src/lib/reduce-output.ts` | `ReduceOutputOptions.preserveKeys`, passed through to the reducer |
| `tool-output-reducers/src/lib/reducers/json.reducer.ts` | Top-level preserved fields are kept verbatim and placed first, in list order. No null or empty dropping and no table rendering inside them; the rest is compacted as before. Adds a note `kept N field(s) verbatim and first` |
| `tool-output-reducers/src/lib/reducers/json.reducer.spec.ts` | +6 tests |
| `tool-output-reducers/src/lib/reduce-output.spec.ts` | +1 test (pipeline pass-through) |
| `vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts` | `PRESERVED_RESULT_KEYS = ['coverage','status','index','parseStatus']`, handed to `reduceOutput` for every tool |
| `vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.spec.ts` | +2 tests (end to end through the real budget layer) |
| `vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts` | `fileCoverage` returns `withCoverageVerdict(...)` |
| `workspace-intelligence/src/ast/graph-coverage.ts` | `buildGraphCoverage`, `invalidatedCoverage` and `mergeGraphCoverages` return verdicted coverage (a stale verdict is recomputed) |
| `workspace-intelligence/src/ast/graph-coverage.spec.ts`, `dependency-graph.service.spec.ts` | Two exact clean expectations gain `clean: true, reasons: []` |
| `workspace-intelligence/src/ast/language-registry.spec.ts` | Size contract, now enumerated (see Deviation R-1) |

### Contract (`language-coverage.interface.ts`)

- The measured fields become `CoverageFields`.
- `LanguageCoverage extends CoverageFields` with `clean: boolean` and `reasons: CoverageReason[]`, serialised **first**.
- `COVERAGE_REASONS` is a closed list of 20 codes, in priority order:
  - unknown state first: `census-unknown`, `updating`, `incomplete`, `census-truncated`;
  - then `unknown-*` codes for `null` counts;
  - then observed qualifiers;
  - then the resolution flags (`resolver-context-partial` last).
- `MAX_REPORTED_REASONS = 3`.
- `coverageReasons(fields)` gives every failed condition. `isCleanAnswer` is now `coverageReasons(...).length === 0`, so `clean` and `isCleanAnswer` cannot disagree; the existing negative cases still pass.
- `withCoverageVerdict(fields)` strips any stale verdict and returns `{ clean, reasons, ...fields }`.

### Deviation R-1: size bound (orchestrator decision needed)

The requested bound of 1,000 chars cannot hold once a verdict is added. I kept readable codes and set the bound to 1,100.

- **How it was measured:** the spec now enumerates 49,152 combinations: each count saturated or `null`, every census, every state, and every resolution qualifier. The fixture is not assumed to be the worst case; the verdict changes with each combination.
- **Measured values:**
  - The longest verdicted coverage is **1,046 chars**.
  - The fields alone are 983 chars, which leaves 17 chars under 1,000.
  - `"clean":false,"reasons":[]` alone takes 27, so no reason code fits.
- **What the spec asserts:** 1,046 is pinned, and the bound is `WORST_CASE_BOUND_CHARS = 1_100`. The contract header states both numbers.
- **Alternatives, if 1,000 must hold:**
  - (a) One short reason code. This fits only just.
  - (b) Lower `COVERAGE_COUNT_MAX` to 999,999. This saves about 25 chars; it is still over with three reasons, and changes a Batch 22 plan value.

### Fails-before (24r)

- **Method:** I temporarily swapped every 24r source file (plus the two 24b producers that import it) for its `git show HEAD` version. The FB jest configs in `%TEMP%\b24b` have ts diagnostics off. The files were restored afterwards and `cmp` confirmed each one.
- **Results:**
  - Contract spec: 5 failed, 30 passed.
  - Reducer specs: 5 failed, 62 passed. The 4 preserveKeys tests that change behaviour failed, plus the pipeline test. The "without preserveKeys behaves as before" and "array document ignored" guards passed.
  - Budget spec: 2 failed, 30 passed, including **"a reduced search result still shows coverage.clean:false and every null field"**.
  - Registry spec: the suite fails to run on base, because `withCoverageVerdict` is absent.
- **After the change:** all pass.

### End to end (real budget layer)

- The input was a 300-hit `ptah_code_search_symbols` result whose coverage is `complete`/`current` with every known qualifier 0 and `unrecognised: null` (the reviewer's case).
- The reduced body's first line starts `{"coverage":{"clean":false,"reasons":["unknown-unrecognised"],...` and is `toEqual` to the full coverage object, including `unrecognised`, `nonSource` and `excluded` all `null`. `index.indexAgeMs: null` also survives.
- The text stays within the 2,000-token / 8,000-char budget (independent tokenizer oracle `expectWithin`).
- The namespace budget test now uses the same clean-looking case.

### No regression

- The Batch 2b reducer specs (`json.reducer.spec`, `markdown.reducer.spec`) and `reducers.bench.spec.ts` (Task 20.3) all pass inside `@ptah-extension/tool-output-reducers:test`.
- Without `preserveKeys` the JSON reducer is byte-identical to before; a spec pins this.

## Revision round 1 (r1 REVISE 4/10)

Review: `reviews/batch-24b-code-logic-review-r1.md`. B1 is fixed by Batch 24r above. The files below are 24b's. Two files are outside the original 24b list; both are named by the review's recommendations.

| File | Change |
| --- | --- |
| `workspace-intelligence/src/services/code-symbol-indexer.service.ts` | B2, S1, S2 and S3 |
| `workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts` | +6 tests. The superseded-run test now expects `updating` while the older run is still going (S1). The first-run `toEqual` gains the verdict. AST doubles now carry `parseStatus: 'ok'` |
| `workspace-intelligence/src/file-indexing/workspace-indexer.service.ts` (**new to 24b**) | S2: `WorkspaceIndexOptions.onUnreadableEntry?(path)`, called by `indexWorkspaceStream` where it absorbs a per-entry stat failure. The fault tolerance and the one-per-run warn are unchanged |
| `vscode-lm-tools/.../namespace-builders/code-namespace.builder.ts` | S1: coverage is read before and after the awaited search (`spanningRead`). `unknownIndexCoverage` is verdicted |
| `vscode-lm-tools/.../namespace-builders/code-namespace.builder.spec.ts` | +2 tests (S1). The coverage helper is now verdicted. The budget test uses the B1 case |
| `rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts` (**new to 24b**) | B2: optional `@inject(CODE_SYMBOL_INDEXER, { isOptional: true })`, the `ptah-api-builder.service.ts:418` precedent. `invalidateCoverage(root)` is called before `purgeJunk`, after the authorization checks |
| `rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts` | +3 tests. `jest.mock` of the WI barrel for its token only (`chat-session-*.spec.ts` precedent) |

### B2: purge invalidates coverage

- **New `CodeSymbolIndexer.invalidateCoverage(root)`**
  - The settled state becomes `incomplete`.
  - Every run in progress (the superseded ones included) gets `invalidated = true`, so it settles `incomplete` even if it succeeds.
  - A root with no record stays `unknown`.
  - Only a full run that begins after the purge reports `current` again. A per-file reindex never does.
- **The RPC invalidates before the delete.** It therefore also covers a delete that throws part-way. A refused purge (bad params, unauthorised workspace) invalidates nothing.
- **Remaining raw writer:** `CodeSymbolStore.purgeWorkspace` still has no production caller (grep).

### S1: pending writes read `updating`

- `RootRecord.pendingWrites` counts file writes that are running or queued on the file lock. It is incremented before the lock wait and decremented in `finally`.
- `RootRecord.runsInProgress` holds every run from `beginRun` until it settles, superseded runs included.
- A settled `current` root reads `updating` while either is non-zero. The counts are kept, so the qualifier is added without losing data. `incomplete` stays `incomplete`.
- **Namespace side:**
  - Coverage is read before and after the reader.
  - If the first read was `updating` and the second is `current`, the answer stays `updating` (re-verdicted). The rows may have been read mid-change.
  - Otherwise the later read stands, so a write that started during the read is reported.

### S2: unstattable files are counted

- The stream reports each EPERM/EBUSY-skipped entry through `onUnreadableEntry`.
- The indexer classifies it like any discovered file:
  - eligible, not skipped, and under the cap → recorded as `failed` with reason `read`, never read;
  - unsupported → counted as `unsupported`.

### S3: parse quality

- Following the Batch 24a contract:
  - `parseStatus: 'ok'` → `analyzed`;
  - `recovered` → `failed` with reason `parse`;
  - `unknown` (or missing) → a new `unchecked` outcome, counted in `unchecked`.
- The symbols of a recovered parse are still written (recall); only the count is honest.

### Fails-before (r1)

- **Method:** I temporarily restored the pre-r1 indexer and namespace (r0 plus the 24r verdict wrap, saved before the r1 edits) and the HEAD `workspace-indexer.service.ts` and `memory-rpc.handlers.ts`. `cmp` confirmed the restore afterwards.
- **Results:**
  - **Indexer spec: 7 failed, 23 passed.** The failures are the updated superseded-run test and all 6 new r1 tests. They include the real-discovery EPERM test (`WorkspaceIndexerService` constructed with its real stream, a stat adapter throwing a wrapped EPERM) and the recovered/unknown parse test.
  - **Namespace spec: 2 failed, 40 passed.** Both S1 tests.
  - **Memory RPC spec: 2 failed, 68 passed.** "Invalidates the code index coverage before deleting" and "keeps the invalidation when the delete throws". The "never invalidates on a refused purge" guard passes on both, as expected.
- **After the change:** 30/30, 42/42 and 70/70.

## Verification (revision round 1 + 24r, tails)

- **Scoped test, lint and typecheck:** `NX_ISOLATE_PLUGINS=false nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/memory-curator --skip-nx-cache --parallel=2`.
  - 17 of 18 tasks pass. `rpc-handlers:test` fails on one spec: `harness-skill-selection-rpc.service.spec.ts` › "never writes state.json" (112 suites, 1 failed; 3,275 tests passed).
  - **That failure is pre-existing.** It fails identically with `platform-core` and `memory-rpc.handlers.ts` restored to HEAD (1 failed, 8 passed, restored afterwards). Its import graph reaches no changed file, apart from type and platform-core imports. It is a real-filesystem spec in `harness/selection`.
- **Host typecheck:** `nx run-many -t=typecheck -p ptah-cli ptah-electron ptah-extension-vscode --skip-nx-cache` → "Successfully ran target typecheck for 3 projects".
- **`ptah-electron:validate-deps`** → "All external imports are covered by package.json dependencies."
- **Degradation audit:** `degradation-audit:lint` → TOTAL 300. platform-core 7/7, rpc-handlers 1/1, vscode-lm-tools 2/2, workspace-intelligence 1/1. No new catch was added in this round.
- **Prettier:** `prettier --check` on all 23 changed files → clean.
- **Frozen files:** `ptah-core-prompt.ts` is unchanged; tool descriptions are untouched.
- **`git status --short`:** 23 modified source/spec files. Untracked: this report, `code-logic-review.md` (pre-existing) and `reviews/batch-24b-code-logic-review-r1.md` (the reviewer's).

## Residual (r1)

- A write that starts **and** finishes entirely inside one search read is not detectable. Both coverage reads say `current`, and there is no row generation counter. There is no snapshot claim either.
- `PRESERVED_RESULT_KEYS` applies to every tool's top-level keys. A tool whose top-level `index` or `status` value is large keeps it whole, and only the budget's final cut limits it.

## Orchestrator ruling (coverage ≤ 1,000)

**Ruling:** keep the plan's limit of 1,000 chars ("about 1,000 chars per response"), lower the saturation cap to 999,999, and keep up to 3 reasons. This replaces Deviation R-1 above.

### Change to the Batch 22 constant

`COVERAGE_COUNT_MAX` changes from **9,999,999 to 999,999** (`platform-core/src/interfaces/language-coverage.interface.ts`).

- **Why:** the verdict (`clean`, `reasons`) needs room inside the 1,000-char bound. The enumerated worst case has 25 saturated counts, so each digit removed saves 25 chars.
- **What a saturated count means now:** a count equal to the cap means "this many or more".
  - There is no separate saturation marker field. The capped value itself is the disclosure, and the constant's doc now says so.
  - The saturation specs use the constant, so they follow it and still pass: `graph-coverage.spec` "marks a truncated discovery and saturates every count", `saturatingSum` and the merge saturation test.

### The cap change alone was not enough

- With the new cap, the worst case measured **1,021** chars.
- I shortened the reason codes further, keeping at most 3 reasons:
  - an unknown (`null`) count or census is now written `<name>?`: `census?`, `unchecked?`, `failed?`, `unsupported?`, `unrecognised?`, `omitted?`, `resolution?`;
  - `census-truncated` → `truncated`;
  - the `incomplete` state's reason → `stale` (the orchestrator's own example code).
- The contract comment explains the `?` convention.
- The enumerated worst case, 49,152 combinations with the verdict included, now measures **exactly 1,000**. The spec asserts ≤ 1,000 and pins 1,000.
- **Headroom is zero.** Any new field or longer code must be paid for elsewhere.

### Verification

- **Scoped run:** `nx run-many "-t=test,lint,typecheck" -p platform-core workspace-intelligence vscode-lm-tools tool-output-reducers --skip-nx-cache --parallel=2`, run twice.
  - Every target passes except `platform-core:test`.
  - Its one failure is the timing test "Performance smoke — PtahFileSettingsManager › keeps per-write cost flat across 1000 sequential set() calls". It failed on both runs, while other lanes were running on the machine.
  - Run alone (`jest -t "Performance smoke"`) it passes: 2/2.
  - This batch does not touch `file-settings-manager`. It is a load-sensitive timing test, recorded here and not changed.
- **Degradation audit:** TOTAL 300.
- **Prettier:** `prettier --check` on all changed files → clean.
- **rpc-handlers:** the failing `harness-skill-selection-rpc.service.spec.ts` › "never writes state.json" is the known pre-existing `%TEMP%/.ptah` issue recorded in TASK_2026_561. Noted, not changed.

## Revision round 2 (r2 REVISE 6/10)

Review: `reviews/batch-24b-code-logic-review-r2.md`. The r1 findings and the top-level reducer case are FIXED. I no longer use shell-interpolated edit scripts: two edits in this round were damaged by shell and replacement-string expansion, and both were caught and repaired before verification.

### Files (24b unless marked 24r)

| File | Change |
| --- | --- |
| `workspace-intelligence/src/services/code-symbol-indexer.service.ts` | R2-B1 and R2-M1 |
| `workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts` | +2 tests |
| `vscode-lm-tools/.../namespace-builders/code-namespace.builder.ts` | R2-B1: `ReindexResult` gains `coverage` (first) |
| `vscode-lm-tools/.../namespace-builders/code-namespace.builder.spec.ts` | +1 test |
| `tool-output-reducers/src/lib/reducers/json.reducer.ts` (24r) | R2-M2: preserveKeys at any depth |
| `tool-output-reducers/src/lib/reducers/json.reducer.spec.ts` (24r) | +3 tests |
| `vscode-lm-tools/.../mcp-core/tool-description.builder.ts` (**new to 24b**) | Docs: a coverage legend on `ptah_code_search_symbols` and `ptah_code_reindex` |
| `vscode-lm-tools/.../mcp-core/tool-description.builder.spec.ts` (**new to 24b**) | +3 tests |

### R2-B1: a single-file reindex is never a bare success

- `CodeSymbolIndexer.reindexFile` now returns `SingleFileReindex { coverage, symbolsIndexed, errors, durationMs }`.
- `coverage` is a one-file census built through `withCoverageVerdict` (verdict first). It is always `census: 'complete'` and needs no root record, so it also works in a new session.
  - `ok` → `analyzed: 1`, `clean: true`;
  - `recovered` → `failed: 1`, `failedByReason: { parse: 1 }`, `reasons: ['failed']`, and `errors: 1` (a recovered parse now counts as an error in full runs too);
  - `unknown` (or missing) → `unchecked: 1`, `reasons: ['unchecked']`;
  - a skip-pattern file → `excluded: 1`, `reasons: ['excluded']` (this also fixes the r0 observation about a skipped file reporting `filesScanned: 1`);
  - a thrown analysis → `failed` with reason `parse`.
- The namespace returns `{ coverage, filesScanned, symbolsIndexed, errors, durationMs }` with coverage first. The dispatcher serialises it unchanged.

### R2-M1: pending writes are tracked before any root record exists

- `pendingWrites` moved out of `RootRecord` into an indexer-level `Map<rootIdentity, number>`.
- A write increments it at start (before the lock wait) whether or not the root has a record, and decrements it in `finally`. An entry is deleted at zero.
- A first full run that settles while a pre-census write is still pending reads `updating`.
- Creating the bookkeeping entry never creates a census: a root with no record stays `unknown`.

### R2-M2 (24r): preserveKeys at any depth

- The JSON reducer now applies `preserveKeys` in every object, not only the root:
  - a preserved key's value is copied verbatim (nulls and empties kept, never lifted into a table);
  - it is placed first among its siblings, in `preserveKeys` order, so it comes before unbounded siblings;
  - in a table (an array of results), rows put preserved columns first, and those cells are the verbatim JSON.
- The note counts every protected occurrence.
- The root-only helpers `splitPreserved`/`joinPreserved` are deleted; the recursion in `prune`/`extractTables` replaces them.
- **Limit:** the budget's final cut still reaches a late array element's nested coverage first. Only its sibling order is controlled.

### Docs: coverage legend (Decision 4: added true information)

- **One shared constant**, `COVERAGE_LEGEND`, is appended to both code-index tool descriptions: `clean` plus up to 3 `reasons`; `?` = unknown (null, never 0); `truncated`, `stale`, `updating`; a count of 999999 means that many or more.
- **Reindex description:** now also says a single file returns its own `coverage`, or status `unsupported-language`. The old "returns its stats" had become incomplete.
- **Budget:** both descriptions stay under the 1,000-char description budget, pinned by a spec.
- **Scope:** the other language-bound tool descriptions are 24c's (registry-generated), which can reuse the constant.

### Coverage size

The contract is unchanged in this round. The enumerated worst case is still **1,000** (≤ 1,000, pinned). A one-file coverage is far smaller.

### Fails-before (r2)

- **Method:** I temporarily restored the pre-r2 indexer and namespace (saved r1 copies), the 24r `json.reducer.ts` and the HEAD `tool-description.builder.ts`, using the FB configs. `cmp` confirmed the restore afterwards.
- **Results:**
  - Indexer spec: **2 failed**, 30 passed ("r2 B1 …", "r2 M1 …").
  - Namespace + description specs: **4 failed**, 78 passed (the r2 B1 namespace test and the 3 legend tests).
  - Reducer spec: **3 failed**, 38 passed (all 3 nested tests).
- **After the change:** all pass.

### Verification (tails)

- **Scoped run:** `nx run-many "-t=test,lint,typecheck" -p workspace-intelligence vscode-lm-tools tool-output-reducers platform-core rpc-handlers memory-curator --skip-nx-cache --parallel=2`.
  - 17 of 18 tasks pass.
  - `rpc-handlers:test` fails only on the known `harness-skill-selection` › "never writes state.json" (`%TEMP%/.ptah`, TASK_2026_561). I re-ran it once: same single failure (3,275 passed). Not changed.
- **Host typecheck:** ptah-cli, ptah-electron and ptah-extension-vscode → "Successfully ran target typecheck for 3 projects".
- **`ptah-electron:validate-deps`** → "All external imports are covered…".
- **Degradation audit:** TOTAL 300.
- **Prettier:** `prettier --check` on every changed file → clean.
  - A directory-wide `prettier --write` briefly reformatted 3 unrelated files (`corpus-namespace.builder.ts`, `dashboard-namespace.builder(.spec).ts`). I put each back to its HEAD content with `git show HEAD:<file> >`; they no longer appear in `git status`.
- **Frozen files:** `ptah-core-prompt.ts` is unchanged.
- **`git status --short`:** 25 modified files: the 23 from the r1/24r rounds plus `tool-description.builder.ts` and its spec. Untracked: this report, `code-logic-review.md` (pre-existing) and the two review files.

### Batch split update

`json.reducer.ts` and its spec remain 24r files. `tool-description.builder.ts` and its spec belong with 24b, because the legend describes 24b's reindex coverage. 24r still compiles on its own against HEAD: the reducer change has no 24b dependency.
