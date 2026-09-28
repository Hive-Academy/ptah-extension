# Batch 29a2 executor report — Lazy isolated grammar loading

- Executor: Claude `backend-developer` subagent (the spec's fallback executor), in the worktree
  `task-559-mcp-tool-contract` on branch `fix/task-559-mcp-tool-contract`. Base: HEAD **a01cc0d21**, which has 29a1
  and the Batch 27 harness. No git state was changed.
- Tasks: 29a2.1 (per-language latch and the too-large refusal) and 29a2.2 (manifest ↔ registry spec). Both are
  COMPLETE.

## Files

| Change   | File (under `libs/backend/workspace-intelligence/src/`) | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODIFIED | `ast/tree-sitter-parser.service.ts`                     | • `initialize()` now loads only the WASM runtime.<br>• Each grammar and its parser load on first use, behind a per-language promise latch (`languageLoads`).<br>• The grammar file comes from `GRAMMAR_FILE_MAP`; the inline list of five paths is gone.<br>• Concurrent first calls share one load and create one `Parser`.<br>• A grammar failure is latched for that language only, as `ParserRefusalError('grammar-unavailable')`.<br>• A runtime failure is not latched, so the next call retries it. It is also `grammar-unavailable`, because no grammar can load without the runtime.<br>• Sources over 1 MiB (UTF-8) are refused as `too-large` in `parse`, `query`, `queryMulti`, `parseAndCache` and `parseIncremental`, before anything loads.<br>• A refusal in `parseAndCache` or `parseIncremental` also drops that file's stale cached tree.<br>• `dispose()` frees the loaded parsers and bumps a generation counter. A load that finishes after dispose frees its parser and returns an error.<br>• The old `parserCache`, `languageGrammars`, `_getPreloadedGrammar`, `_getCachedParser`, `_createAndCacheParser` and `getOrCreateParser` were removed. |
| CREATED  | `ast/parser-refusal.ts`                                 | `MAX_PARSE_BYTES`, `ParserRefusalError`, `parserFailureReason()` (walks the `cause` chain) and `exceedsParseLimit()`. This is a separate module so that the coverage producers can classify a failure without importing the WASM module.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| MODIFIED | `ast/tree-sitter-parser.service.spec.ts`                | 11 new tests in `29a2 lazy isolated grammar loading`. The existing tests are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CREATED  | `ast/grammar-manifest.spec.ts`                          | Reads `scripts/tree-sitter-grammars.json` with `fs`. It checks that:<br>• the registry grammars equal the manifest's active grammar rows;<br>• `GRAMMAR_FILE_MAP` equals the registry;<br>• active rows are distinct;<br>• a drift self-test catches a mismatch in either direction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| MODIFIED | `ast/ast-analysis.service.ts`                           | The `queryMulti` error is re-wrapped with `{ cause }`, so a refusal survives the wrap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| MODIFIED | `ast/dependency-graph.service.ts`                       | One line: `recordFailure(parserFailureReason(error))` replaces the fixed `'parse'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| MODIFIED | `services/code-symbol-indexer.service.ts`               | One line: `failure(parserFailureReason(error))`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| MODIFIED | `diagnostics/language-aware-diagnostics-provider.ts`    | One line: `{ reason: parserFailureReason(parsed.error) }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| MODIFIED | `ast/tree-sitter.config.ts`                             | The stale comment about "until 29a2" was updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Plan deviations

1. **Four files beyond the spec's list (one-line consumer wiring), plus a new `parser-refusal.ts`.**
   - The spec requires "failure → `failed.grammar-unavailable` for that language only", and says a file over 1 MiB is
     `failed.too-large`.
   - The three coverage producers (graph, code index, syntax diagnostics) hard-coded `'parse'` for any parser error.
     `AstAnalysisService` also re-wrapped the error into a new `Error`, which lost its type.
   - Without these one-line edits, a broken grammar would still be honest (`failed.parse`, never a clean answer), but it
     would carry the wrong reason.
   - The helper lives in its own module because the first attempt imported it from the parser service. That pulled
     `wasm-bundle-dir` (`import.meta`) into the indexer and graph specs, which do not mock it, and 2 suites failed. The
     module split fixed this.
2. **A failed grammar stays failed until `dispose()`.** It is not retried on every file. This is a deliberate choice:
   it avoids re-reading a corrupt 5 MB grammar once per file during a workspace index. A runtime failure is still
   retried.
3. `.ptah/.../matrix/required-keys.ts` and the harness are untouched. 29a2 activates no key, so it needs no activation
   fragment.

## FB evidence (on base HEAD a01cc0d21)

- **How it was run.** A temporary FB-only spec, with no imports of new symbols, was run against
  `git show HEAD:…/tree-sitter-parser.service.ts` and then against the new file. The temp spec was deleted afterwards.
- **"A failing grammar does not disable the others".** The C# grammar load was made to reject.
  - HEAD: FAIL (`Expected: true / Received: false`). The whole `initialize()` failed with
    `WASM initialization failed … CS=…tree-sitter-c-sharp.wasm: corrupt grammar`, so the TypeScript parse failed too.
  - After: PASS.
- **"Over 1 MiB refused before any grammar load".**
  - HEAD: FAIL (the message had no `larger than`; HEAD had no refusal).
  - After: PASS.
  - Caveat: on HEAD this second case ran with the first case's leftover C# mock, but HEAD has no size check at all.
- **Result.** HEAD: `Tests: 2 failed, 2 total`. After: `Tests: 2 passed, 2 total`.
- **The committed tests** that pin this behaviour are in `tree-sitter-parser.service.spec.ts`:
  - `FB: a failing grammar does not disable the others`
  - `refuses a source over 1 MiB as too-large before loading anything`
  - `measures the limit in UTF-8 bytes, and exactly 1 MiB is accepted`
  - `concurrent first uses of a language share one load and one parser`
  - `a failed grammar stays failed … without re-reading it`
  - `a runtime failure is not latched`
  - `a too-large incremental re-parse drops the stale cached tree`
  - `a grammar load that finishes after dispose() frees its parser`
  - `parserFailureReason reads a refusal through re-wrapping causes`
- **The 24a `parseStatus` tests** are unchanged and pass.

## Latency (TS parse, real shipped WASM, Jest harness)

- **Setup.** A temporary bench spec (deleted afterwards) used real `web-tree-sitter` 0.27.0 and the
  `@vscode/tree-sitter-wasm` grammars. The source was an 80-line TS file with 40 functions and 40 classes, parsed with
  `queryMulti(src,'typescript',[])`.
- **What was measured.** `initialize()`, then the first TS call, then 30 warm calls.
- **Runs.** Six interleaved HEAD/AFTER pairs, taken on a shared machine with other agents running, so the absolute
  numbers are noisy.

| Metric (median of 6)                         | HEAD a01cc0d21     | After 29a2                                   |
| -------------------------------------------- | ------------------ | -------------------------------------------- |
| `initialize()`                               | 75 ms (30–216)     | 17 ms (12–23)                                |
| First TS call after init                     | 20 ms (8–57)       | 18 ms (12–62) (includes the TS grammar load) |
| **First call total (init + first TS parse)** | **95 ms** (43–273) | **34 ms** (26–85)                            |
| Warm call median                             | 2.0 ms (1.4–3.8)   | 1.8 ms (1.5–3.7)                             |
| RSS growth for the service                   | ~29 MB             | ~5–14 MB                                     |

HEAD's `initialize()` loaded all five grammars, including C# (5.1 MB). After 29a2 it loads only the runtime; the TS
grammar loads on the first TS call. Warm calls are unchanged, within noise.

## Packaged apps (grammars located at runtime)

- **Where grammars are looked up.** Both bundles resolve every WASM file as `resolveWasmPath(file)` =
  `<BUNDLE_DIR>/wasm/<file>` (`ast/wasm-bundle-dir.ts`, unchanged).
  - The runtime file is whatever `web-tree-sitter` asks `locateFile` for (`web-tree-sitter.wasm`); that is unchanged.
  - Grammar names now come from `GRAMMAR_FILE_MAP`.
- **What gets bundled.** `node scripts/copy-wasm.js <tmp>` copied exactly `tree-sitter-{c-sharp,go,javascript,python,typescript}.wasm`
  and `web-tree-sitter.wasm`. These are the manifest's active rows, and they equal `GRAMMAR_FILE_MAP`.
  `grammar-manifest.spec.ts` now pins that equality.
- **Packed verifiers:**
  - `node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test` → `CLI WASM self-test PASS`
  - `node apps/ptah-electron/scripts/verify-packed-wasm.js --self-test` → `Electron WASM self-test PASS`

## Verification (tail only)

**Scoped command:** `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache`
→ `Successfully ran targets test, lint, typecheck`.

- **Test:** `Test Suites: 55 passed, 55 total`; `Tests: 1 skipped, 1700 passed, 1701 total`. This includes
  `language-honesty.contract.spec.ts` (the Batch 27 harness and its required-keys snapshot, unchanged) and
  `language-registry.spec.ts` (parser grammar association r1 M1, unchanged).
- **Lint:** `0 errors, 65 warnings`.
  - Per-file warning counts are equal or lower than HEAD for every changed file. The parser service dropped from 3
    to 2 because the old parser-cache code was removed.
  - The remaining warnings on changed files are pre-existing: `max-lines` on three files, `no-non-null-assertion`, and
    an unused `error` in `parseIncremental`'s catch.
- **Typecheck:** pass.

**Other checks:**

- `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → `✅ All external imports are covered by package.json dependencies.`
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `degradation-audit: TOTAL 300 unsuppressed site(s)`;
  `libs/backend/workspace-intelligence: 1 ok (baseline 1)`.
- **Extra consumer regression check (projects not owned):**
  `nx run-many -t=test -p @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache`
  → `Successfully ran target test for 2 projects`.
  - vscode-lm-tools: 77/77 suites and 2332 tests passed.
  - ptah-electron: 54 of 55 suites passed and 1 skipped; 927 tests passed and 3 skipped.
- **Decision 4 check.** `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` (`cli-adapter.utils.ts`) are unchanged
  vs HEAD (`git diff --quiet`). `src/testing/**` (the harness and `required-keys.ts`) is unchanged.
- **validate-deps-safe fixtures.** The new specs contain no `from "x"`, `import("x")`, bare `import "x"` or
  `require("x")` string shapes.

## Out-of-scope observations

- The file header of `language-registry.spec.ts` (lines 17-18) still says "until Batch 29a2 makes the parser read the
  map". That is a stale comment in a spec this batch does not own.
- The consumer mapping is covered at the helper level: `parserFailureReason` is tested through a two-level `cause`
  chain, which is the shape `AstAnalysisService` produces. There is no dedicated consumer spec per producer (graph,
  indexer, diagnostics) asserting `failedByReason['grammar-unavailable']` for a single broken grammar. A later harness
  batch (27 or 38) could add one.
- The indexer's "all files errored and 0 symbols" throw (`code-symbol-indexer.service.ts:~843`) would still fire in a
  single-language workspace whose only grammar fails to load. This is pre-existing behaviour and was not changed.
- Untracked `.ptah/specs/TASK_2026_559_8ca9/code-logic-review.md` and `research/diagnostics-worktree-repro.ts` were
  already in the tree before this batch. They are not from 29a2 and were left alone.

## Fix round (review r1)

- **Scope.** This was a single fix round (User Decision 24). The review is `reviews/batch-29a2-code-logic-review-r1.md`
  (REVISE 6/10). The 29b review verifies these fixes. No git state was changed. Probes and copies were written under
  `%TEMP%` only.

### R29a2-01 (Serious): initialization and loads are bound to the service generation

**Fix** (`WI/ast/tree-sitter-parser.service.ts`):

- `initialize()` starts `_doInitialize(generation)`.
- If a runtime init from before a `dispose()` succeeds late, it returns a "disposed" error and does not set
  `isInitialized`.
- If it fails late, it clears `isInitialized` and `initPromise` only when its generation is still current. It can no
  longer clear the latch of a newer initialization.
- `prepare()` reads the generation synchronously, when it is called. `loadLanguage(language, generation)` then refuses
  an obsolete caller at two points:
  - before it calls `initialize()`, so an obsolete caller cannot start a new-lifetime initialization;
  - after the await, so it cannot start or join a new-lifetime grammar load.
- `_loadLanguage` checks the same generation that the caller captured.
- Every public parse path (`parse`, `query`, `queryMulti`, `parseAndCache`, `parseIncremental`) now runs its prepared
  result through `live(...)`. That refuses the parser if `dispose()` freed it between the preparation and the caller
  resuming.

**Regression specs** (`tree-sitter-parser.service.spec.ts`):

- `R29a2-01: a parse waiting on the runtime when dispose() runs never loads or keeps a parser` checks for an error, no
  `Language.load`, no `new Parser` and no parse.
- `R29a2-01: a pre-dispose runtime failure does not clear the newer initialization latch` covers the reviewer's
  A / dispose / B / reject A / follower schedule. It expects `Parser.init` to be called 2 times, and both B and the
  follower to succeed.
- `R29a2-01: the service reinitializes and parses normally after dispose()` expects init 2 times and load 2 times.

**Before the fix:** the round-1 parser source (reconstructed under `%TEMP%`) gave
`Tests: 2 failed, 24 passed, 26 total`. The two failures were the dispose-during-runtime-init spec and the stale-failure
latch spec. After the fix, all pass.

### R29a2-02 (Moderate): enrichment reports the real refusal reason

**Fix:**

- `context-enrichment.service.ts` now classifies a `queryMulti` error with `parserFailureReason`:
  - `grammar-unavailable` and `too-large` are returned as the full-content `reason`;
  - every other error stays `parse-failed`.
- Full content is still preserved.
- The `StructuralSummaryResult.reason` union and its doc gained both values.
- The `ptah_context_enrich_file` description now lists `'grammar-unavailable', 'too-large' (over 1 MiB)`.
  - My first, longer wording broke the per-tool description budget (1200 chars against a budget of 1175, caught by the
    `mcp-contract.sweep.spec.ts` "per-tool budget" test).
  - The shortened wording passes both the budget test and the tools/list size pin.

**Regression specs** (`context-enrichment.service.spec.ts`, real grammars):

- `returns full content with reason 'too-large' when the parser refuses a source over 1 MiB (R29a2-02)`
- `returns full content with reason 'grammar-unavailable' when the grammar cannot load (R29a2-02)`. This uses a fresh
  parser with `Language.load` rejected once.

**Before the fix:** the HEAD enrichment source gave `2 failed` (both new specs). After the fix, both pass.

### Stability: 4 mcp-contract bench timeouts and "slow empty build"

**Bench.**

- The four timed-out tests each ran a full real-grammar `DependencyGraphService.buildGraph` inside Jest's default 5 s
  per-test timeout:
  - `all 6 known files parse…`
  - `…complete coverage…`
  - `User Decision 21…`
  - `…symbol_index…`
- The fifth test in that group, `recalls every known dependent`, has the same pattern but did not time out.
- The fixture is TS/TSX only, and the shared parser's TypeScript grammar is already loaded by the earlier
  `ptah_ast_analyze` tests. So 29a2's lazy load does not fall inside those tests. The sensitivity is five full WASM
  parse runs of the same graph, each under a 5 s wall clock, when three projects' suites run on one machine.
- **Fix:** the default fixture graph is built once in a `beforeAll` (60 s hang guard) and shared by the five tests that
  read it. The alias test keeps its own build, with a 30 s hang guard.
- Not changed: the size and ratio assertions, and the file's `afterAll` CPU bound (< 30 s) and wall-clock bound
  (< 120 s). The work in the file went down (4 fewer graph builds).

**"Slow empty build"** (`protocol-dispatcher.spec.ts`, Batch 9b):

- This is the known load flake, already recorded in `batch-24c-executor-report.md` ("passes in isolation… recorded as a
  load flake").
- It is not caused by 29a2:
  - its `realSetup` uses a mocked `analyzeSource` (no parser at all);
  - discovery resolves `[]`, so nothing is ever parsed;
  - the timing depends on real `realpath` I/O against a `setImmediate`-based `flush()`.
- Not fixed, as instructed. It did not fail in either of the two requested runs. It failed once more (1 of 2332) in the
  extra third, static-output run used to collect counts.

### Verification

Command, run twice:
`node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache`

- **Run A (before the description was shortened):** failed on `ptah_context_enrich_file: description is 1200 chars,
budget is 1175`. This was my own regression. It is fixed, and those two tests were rechecked alone: 2 passed.
- **Final run 1:** exit 0, `Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on`
  (3m 15s).
- **Final run 2:** exit 0, same line (4m 1s).
- **Header counts** (a third, static-output test-only run, used only to collect counts):
  - workspace-intelligence: `Test Suites: 55 passed, 55 total`; `Tests: 1 skipped, 1705 passed, 1706 total`
  - ptah-electron: `Test Suites: 1 skipped, 54 passed, 54 of 55 total`; `Tests: 3 skipped, 927 passed, 930 total`
  - vscode-lm-tools: `Tests: 1 failed, 2331 passed, 2332 total`. The one failure was the known "slow empty build"
    flake above.
- **Lint:** 0 errors. Warning counts on the files touched in this round are equal to HEAD:
  - bench spec: 17 / 17
  - enrichment source: 0 / 0
  - enrichment spec: 0 / 0

**Files touched in this round:**

- `WI/ast/tree-sitter-parser.service.ts` and its spec
- `WI/context-analysis/context-enrichment.service.ts` and its spec
- `WI/testing/mcp-contract/mcp-contract.bench.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (one phrase)

**Housekeeping:** a `prettier --write` glob briefly reformatted three unrelated `context-analysis` files. They were
restored byte-for-byte from HEAD using read-only `git show`, and are clean in `git status`.
