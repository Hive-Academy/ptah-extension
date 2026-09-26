# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Review r2 covers Batch 24b and the new Batch 24r. Source remained read-only; no git operations were run.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 3 |

The original top-level reduction, purge, unreadable-file, and parse-count probes now disclose their limitations correctly. One blocking endpoint gap remains: a single-file reindex of a recovered/unknown parse still reports zero errors and no qualification. There is also an initial-session pending-write race and a nested-result preservation limitation. This is above r1's 4/10 because the main coverage mechanisms now work; it is below 7–8 because a directly exposed language-bound tool still produces a misleading success-looking result, and verification is not fully green.

All evidence paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`:

- **I**: `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`
- **N**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`
- **D**: `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`
- **C**: `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts`
- **J**: `libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts`
- **B**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- **RPC**: `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`

Inputs: r1 archive and retained review context; executor report's 24r, revision-round-1, residual, and orchestrator-ruling sections; current production paths and relevant regression specs. No new repository instruction or task-specific style-review document was identified. Native reads were used because no Ptah source-reading tool was listed; diagnostics used Ptah. Large unchanged surrounding files were not re-reviewed as whole subsystems; this verdict concerns the named changes and their traced boundaries.

## r1 findings status

| r1 finding | r2 status | Evidence and observed result |
| --- | --- | --- |
| B1: reducer removes null coverage | FIXED for top-level tool results | J:79 separates preserved fields before pruning; B:100 supplies coverage/status/index/parseStatus; C:331 recomputes a leading verdict. Real 300-hit budget probe retained every null and clean:false. Nested limitation is R2-M2. |
| B2: purgeJunk leaves coverage current | FIXED on the production RPC path | RPC:505 invalidates before deletion, after authorization; I:509 invalidates settled coverage and every live run. Probe returned incomplete after purge, including a run purged while pending. |
| S1: pending/superseded writes appear current | PARTIAL | I:402 checks pending writes and all runs; ordinary held per-file insertion now reports updating. I:597 does not track a write begun before the first root record; R2-M1. |
| S2: EPERM/EBUSY skipped from census | FIXED | D:457 reports skipped stat entries; I:665 feeds them into normal classification; I:710 records failed/read. Real generator + stat-failure adapter produced analyzed:1, failed:1, failedByReason.read:1. |
| S3: recovered/unknown parses counted analyzed | FIXED in coverage, PARTIAL end to end | I:270 maps recovered to failed/parse and unknown to unchecked; I:420 counts them separately. The single-file response discards that outcome and still reports errors:0; R2-B1. |

Additional checks: the `.kt` search and reindex probes both returned `unsupported-language`, with no symbol rows touched (N:352,472). Same-file locking remains at I:567; superseded runs remain in runsInProgress until settlement at I:526. Existing abort, skip-before-cap, 1 MiB accounting, bounded per-file tracking, and governor tests are in the passing workspace-intelligence suite. Optional purge injection uses the same singleton token registered at `workspace-intelligence/src/di/register.ts:198`; RPC regression specs cover invalidation ordering, partial failure, and refused purge (`memory-rpc.handlers.spec.ts:1506` onward).

## 24r findings

### Generic preservation and budget

The production util API is generic: `ReduceContext.preserveKeys` is a string-key option (`tool-output-reducers/src/lib/reducer.types.ts:30`), J:151 uses keys supplied by its caller, and `reduce-output.ts:154` passes the option through. No language-domain imports or coverage-specific key matching were added to the util implementation. Coverage examples in tests do not constitute a production dependency.

The exact r1-shaped top-level case now passes independently: **93,376 characters / 19,614 input tokens → 1,748 returned tokens**, reducer `json-compact`, truncated. The first line starts with coverage and retains `clean:false,reasons:["unrecognised?"],census:"complete",state:"current"`, every known qualifier zero, and `unrecognised:null,nonSource:null,excluded:null`. The original probe fixture gained the new verdict, so its byte/token count differs slightly from r1. The raw spool was written under a mkdtemp root and removed afterward.

Preserved values themselves have **no individual size bound**, but the final answer does: B's normal final fitting/cutting still runs after reduction. A 30,000-character top-level status value returned 1,980 tokens / 4,149 characters; the leading normal coverage survived. A deliberately oversized synthetic coverage value with a payload before its verdict also stayed at 1,980 tokens, but its late verdict was cut. Thus preservation does not bypass the hard budget, and it does not guarantee arbitrary preserved values survive whole. That synthetic coverage is not emitted by the bounded current producers; it is a limit of the generic API, not an additional production defect. J:18's claim that a later cut never reaches a preserved value should be read as conditional on bounded producer values.

Nested keys are not protected; see R2-M2. The current API explicitly says top-level, so this does not invalidate the successful top-level 24b fix, but 24r must not be represented as recursive protection for aggregated results.

### Reason codes and the 1,000-character ruling

The shortened codes are explained in source at C:200–208, including `?` for unknown and `stale` for incomplete. They are **not documented in the inspected agent-facing tool descriptions/help**: `mcp-core/tool-description.builder.ts:1782` describes index freshness but not these codes or the saturation sentinel. `clean:false` plus the preserved null/state fields makes the top-level output unambiguous about not being clean; the abbreviations alone are not a complete help contract. Minor follow-up: add a compact legend in shared language-tool help/24c, including “999999 means at least this many.” This need not enlarge each coverage object.

Zero headroom alone is not a runtime blocker: the fixed schema is guarded and the current size spec passed (`workspace-intelligence/src/ast/language-registry.spec.ts:228–241`). However, the test enumerates only MAX/null, not zero, for qualifier counts (`:180–197`); it is not a proof over all type-shaped inputs. An expanded temporary enumeration of 314,928 combinations found a 1,001-character shape after zero counts expose the longer resolution reasons. **That shape retained saturated failed/unsupported breakdowns while their totals were zero**, so it is internally inconsistent and is not evidence that a current correct producer exceeds the bound. I do not count it as a production defect. Strengthen the guard with zero values and consistency rules before treating “exactly 1,000” as an unconditional maximum; any new field/code must be paid for or the bound deliberately revised.

Batch 2b JSON/Markdown specs and Task 20.3 reducers.bench are included in the passing reducer suite: 9 suites, 489 tests. No failed suite was rerun.

## New defects / failure modes

### R2-B1 — Blocking: single-file reindex hides recovered/unknown parse quality

- **Trigger:** Call `ptah_code_reindex`/`ptah.code.reindex` with a supported file whose analysis Result is Ok but parseStatus is recovered or unknown, with zero extracted symbols.
- **Symptom:** Both cases return `{filesScanned:1,symbolsIndexed:0,errors:0,durationMs:...}`. There is no coverage, parseStatus, unchecked count, or reason. The caller cannot distinguish failed/unknown analysis from a successfully indexed symbol-free file.
- **Evidence:** I:1002 unconditionally returns errors:0 beside `outcomeOfParse(insights.parseStatus)` at I:1004. I:834–836 strips the outcome from reindexFile. N:482–487 returns only those statistics. The dispatcher sends this result down its success path (`mcp-core/protocol-dispatcher.ts:2144–2153`). The real parser can return an Ok recovered tree (`workspace-intelligence/src/ast/tree-sitter-parser.service.ts:646,679`), and `ast-analysis.service.ts:128` preserves its quality.
- **Reproduction:** Real indexer + real namespace with controlled AST/sink adapters, once with recovered and once with unknown: both returned filesScanned:1, symbolsIndexed:0, errors:0. This also occurs in a new session, where no root census exists to recover the per-file outcome from a later coverage read.
- **Current handling:** Search coverage correctly records failed/parse or unchecked after a census exists, but this does not qualify the reindex response the agent just received. I:915 clears prior symbols before replacement, so partial/empty extraction may also remove existing recall.
- **Impact:** A language-bound action reports a success-looking empty result for analysis it knows was failed or unchecked. This is the remaining end-to-end part of r1 S3, not a request to abandon partial-symbol recall.
- **Recommendation:** Carry the per-file quality outcome through reindexFile and ReindexResult. Return a bounded explicit parseStatus/coverage or equivalent qualification, and make errors reflect recovered parse failure rather than reporting zero. Unknown must be disclosed even if it is not classified as an execution error. Pin both cases through the real namespace/dispatcher response, including the no-census session.

### R2-M1 — Moderate: a pending write begun before the first census is never counted

- **Trigger:** In a new session, explicitly reindex `/ws/build/manual.ts` and hold its insert. While it is pending, run the first full workspace index; normal discovery excludes build and processes `/ws/b.ts`, so that run can finish without waiting on the manual file's lock.
- **Symptom:** Coverage becomes complete/current while the first per-file write is still between deletion and insertion. It reports no updating reason.
- **Evidence:** I:596 fetches the root record once; I:597 increments only if it already exists. I:480–488 later creates the root with pendingWrites:0. I:402 therefore sees no outstanding mutation after the full run settles. Single-file indexing does not apply directory exclusions (I:825), whereas workspace discovery excludes build (`file-indexing/workspace-default-excludes.ts:20`).
- **Reproduction:** Held the real indexer's first manual-file insert; completed a full run over b.ts. Rows contained only b.ts; coverage was `clean:false,reasons:["unrecognised?"],census:"complete",state:"current",analyzed:1`. Releasing the held insert ended the operation normally.
- **Current handling:** The ordinary post-census pending-write regression passes. Here the counter is absent at entry and never enrolled into the newly created root record. Clean remains false for the generic unrecognised qualifier, so this is an uncommon freshness gap rather than a new clean:true claim.
- **Recommendation:** Maintain pending mutations independently of census existence, or create an unknown bookkeeping record when the first per-file write starts. Creating bookkeeping must not promote the census from unknown. Add this first-write/first-run overlap test.

### R2-M2 — Moderate: nested coverage still loses null fields and protection from cuts

- **Trigger:** A structured tool/execute_code result wraps coverage-bearing values under `results` or returns an array, instead of exposing coverage at the document root.
- **Symptom:** Null fields inside nested coverage disappear. If a preceding payload consumes the output window, the nested clean:false verdict is absent from the inline result as well.
- **Evidence:** J:154 declines array documents and J:159 inspects only own root keys. Remaining values pass through recursive prune at J:200–211, without preservation context. B:100 supplies only root key names. `mcp-core/code-execution.engine.ts:493` serializes arbitrary returned objects; `protocol-dispatcher.ts:3254,3284` sends that text through the ordinary budget path.
- **Reproduction:** `{results:[{coverage,...},{coverage,...},{coverage,...}]}` became a table whose coverage cells retained clean:false/reasons but lost unrecognised/nonSource/excluded nulls. A separate bounded-input `{results:[{hits:[{text:largeText}],coverage}]}` probe returned 1,981 tokens with neither the verdict nor the unknown field visible. These were real reducer/budget calls; the wrapping object was synthetic, not a claim that direct code_search_symbols uses this shape.
- **Current handling:** Root coverage is preserved; nested qualifiers can still survive as clean:false/reasons when early enough. A truncation trailer and full spool remain available. Therefore this is a cross-cutting observability gap, not the original top-level false-clean blocker.
- **Recommendation:** Either support generic recursive/path-based preservation, with bounded per-result summaries before payloads, or explicitly constrain 24r's guarantee to root-shaped tools and add a caller-side policy for aggregated language results. Preserve null meaning recursively even where not every result can fit inline. Add nested-object and array-document regressions.

## Blocking issues

R2-B1, I:1002 / N:482: a known failed/unknown parse produces an unqualified zero-error single-file reindex response.

## Serious issues

None newly established.

## Moderate and minor issues

R2-M1 and R2-M2 above. Minor follow-ups: publish the reason/saturation legend (`tool-description.builder.ts:1782`, C:200); expand the size guard's zero-count domain with consistency constraints (`language-registry.spec.ts:180`). Neither minor item is counted as an additional failure mode.

## Five logic questions

1. **How does this fail silently?** Reindex discards its known parse outcome and returns errors:0 (I:1002; R2-B1). Nested null fields are still pruned (J:209; R2-M2).
2. **What user action produces unexpected behaviour?** Explicit single-file reindex of broken source (N:478); a first-session manual reindex overlapping the first full run (I:597; R2-M1).
3. **What input data produces a wrong answer?** Recovered/unknown Ok analysis with empty extraction gives an indistinguishable zero-error empty response (I:1004). Wrapped coverage loses semantic nulls (J:154,209).
4. **What happens when a dependency fails?** Stat EPERM/EBUSY now counts failed/read (D:457; I:710); purge failure retains prior invalidation (RPC:505); sink failures are recorded (I:983). The final budget bounds huge preserved values, but may cut their contents (B:281 onward).
5. **What is missing that requirements did not spell out?** Per-file quality in the reindex response, bookkeeping before the first census, and an aggregation policy for nested coverage. Evidence is the three findings above; an agent-facing abbreviation legend is also absent from the inspected description at tool-description.builder.ts:1782.

## Data flow

1. Extension gate → unsupported answer: **OK**, N:352,472; .kt touches no rows.
2. Freshness → governed lazy full run: **OK within tested scope**, N:251; no await of the run and existing governor tests pass.
3. Discovery → census: **r1 repair verified**, D:457 → I:665; unreadable entries now reach the accounting.
4. Parse → rows → coverage: **coverage repaired**, I:270,1004; **reindex response gap**, I:834 → N:482.
5. Mutation → live state: **ordinary pending/purge paths repaired**, I:402,509; **first-session gap**, I:597.
6. Coverage → verdict → reduction: **top-level repaired**, C:331 → B:100 → J:79; **nested limitation**, J:154.
7. Reduction → spool/cut → agent: **hard budget holds** in large/oversized-preservation probes; preservation is not an unlimited output guarantee.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| r1 B1 top-level null coverage and explicit qualifier | COMPLETE | 93k-character real budget probe, B:100 / J:79 |
| purge before/delete-failure/in-progress invalidation | COMPLETE | RPC:505 / I:509; regressions and probes |
| all pending writes/superseded runs updating | PARTIAL | Normal paths repaired; R2-M1 |
| stat failure and recovered/unknown coverage buckets | COMPLETE | D:457 / I:270; probes |
| single-file reindex honest about parse quality | MISSING | R2-B1 |
| generic util preservation without domain coupling | COMPLETE | reducer.types.ts:30 / J:151 |
| nested coverage preservation | PARTIAL | Explicit root-only implementation; R2-M2 |
| final token and character ceilings | COMPLETE in tested cases | 1,748 / 1,980 / 1,981-token probes |
| 1,000-character coverage guard | COMPLETE for committed fixture domain | Passing spec; zero-count/consistency caveat above |
| reason codes understandable and documented to agent | PARTIAL | clean:false + original fields clear; legend exists only in source |
| Batch 2b and Task 20.3 regression suites | COMPLETE | 9 reducer suites / 489 tests pass |
| Batch 5/6 index behavior | PARTIAL verification | Existing indexer/namespace tests pass; native SQLite exact-name recall not independently rerun |

Implicit requirements not fully addressed: per-file result qualification; initial-session mutation tracking; nested-result policy.

## Edge cases

| Case | Handled | Evidence / remaining concern |
| --- | --- | --- |
| New session, no full run | YES | Unknown coverage, I:395 |
| Post-census held insert | YES | Updating in probe, I:402 |
| Pre-census held insert crossing first run | NO | R2-M1 |
| Purge while full run pending | YES | Final incomplete in probe, I:529 |
| Stat EPERM/EBUSY | YES | D:457 / I:665 |
| Recovered/unknown parse in later search coverage | YES | Failed/unchecked in probe, I:270 |
| Recovered/unknown parse in reindex response | NO | R2-B1 |
| Unsupported .kt | YES | Explicit unsupported answer, zero rows touched |
| Huge root preserved field | YES for budget | Final cut bounds it; whole value need not survive |
| Nested coverage | NO for full preservation | R2-M2 |

## Verification

Ran once, uncached, with `NX_ISOLATE_PLUGINS=false`:

`nx run-many -t=test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers @ptah-extension/rpc-handlers --parallel=2 --output-style=static --skip-nx-cache`

**13 of 15 tasks passed; 2 test targets failed.** All five lint and typecheck targets passed. Results:

- platform-core: 44 suites, 856 passed / 4 todo. The pre-existing perf smoke flake did not fail this run; noted only.
- workspace-intelligence: 48 suites, 1,475 passed.
- tool-output-reducers: 9 suites, 489 passed, including JSON, Markdown, and reducers.bench.
- vscode-lm-tools: 69 suites passed / 1 failed; 1,991 tests passed / 1 failed. Failure: `mcp-http/http-server.handler.spec.ts:254`, port-collision case, EADDRINUSE on localhost plus 5-second timeout. No source attribution to this batch established; not silently waived as pre-existing.
- rpc-handlers: 110 suites passed / 2 failed; 3,274 tests passed / 2 failed / 4 skipped. Known out-of-scope harness selection failure at `harness-skill-selection-rpc.service.spec.ts:113` was observed. Additional failure: `voice-rpc.handlers.spec.ts:284`, temp-file cleanup test exceeded 5 seconds. Not established as caused by this batch or as pre-existing. Memory RPC regressions were not among failures.
- Some Jest workers reported forced exit/open-handle warnings. No failed suite was rerun.

Other checks, each run once:

- `degradation-audit:lint`: success, **TOTAL 300**.
- `ptah-electron:validate-deps`: success, including its dependency target.
- Ptah diagnostics scoped to the changed contract and reducer: **0 errors, 0 warnings**. The full scoped typechecks above cover all five owner projects.
- Verification log: `C:/Users/abdal/AppData/Local/Temp/ptah-24r-checks.log`. The PowerShell wrappers for successful audit/dependency commands returned 1 despite explicit Nx success summaries; the 15-task run itself genuinely reported failure.

Temporary probes (no repository source writes): `ptah-24r-review.cjs`, `ptah-24r-probes.cjs`, `ptah-24r-reindex.cjs`, `ptah-24r-initial-write.cjs`, and `ptah-24r-size.cjs`, all under `C:/Users/abdal/AppData/Local/Temp/`. They transpile actual reviewed methods and inject controlled registry/DI, filesystem, AST, sink, and SQL-statement adapters. Budget/reducer/tokenizer code is real. Spools used mkdtemp roots with bounded cleanup. The purge probe explicitly calls the invalidation seam before the real purge method; RPC ordering is independently covered by its source and passing regressions. These probes do not claim native SQLite, real WASM malformed-source, or full application DI integration testing.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the demonstrated endpoint/accounting findings; MEDIUM for attribution of unrelated suite failures.
- Top risk: an agent receives a zero-error single-file reindex result for a parse known to be failed or unchecked.
- What a robust implementation would add: per-file quality in reindex responses, mutation bookkeeping before census creation, a bounded nested-coverage policy, and the associated boundary regressions. Publish the abbreviation legend and strengthen the size fixture without confusing malformed shapes with production overruns.

