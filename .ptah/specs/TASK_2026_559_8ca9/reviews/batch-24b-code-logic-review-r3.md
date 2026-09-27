# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Review **r3**, Batch **24b / 24r**, after revision round 2. Source remained read-only; no git operations were performed.

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 |

The blocking single-file endpoint gap and initial-session write race are fixed. Recursive reduction now preserves nulls, but its promised ordering still has two reproducible gaps for aggregated results. These are Moderate: the affected response is explicitly truncated with an exact raw spool, and direct code-index tool shapes already put their bounded qualifications before hits. This supports 7 rather than 6 (no remaining Blocking/Serious issue), but not 8 (recursive ordering is not reliable for all supported inputs).

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`:

- **I** — `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`
- **N** — `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`
- **J** — `libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts`
- **B** — `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- **C** — `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts`
- **D** — `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- **RPC** — `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`

Inputs: r2 archive; executor report revision-round-2 section and retained earlier review context; context.md; Batch 24b requirements and referenced language-plan accounting/shape sections; Batch 22 coverage contract; production indexer, namespace and JSON reducer, their surrounding contracts and regression specs. No applicable AGENTS.md or task-specific style-review document was found in the inspected locations. Native reads were used because no Ptah source-reading tool was listed. The large description builder was reviewed at its changed code-index builders and shared legend, not as an unrelated all-tools redesign.

## r2 findings status

| Finding | Status | Evidence / independent probe |
| --- | --- | --- |
| R2-B1: single-file reindex unqualified | FIXED | I:293 constructs its own one-file coverage; I:902 returns it; N:484 places it first. Real indexer + namespace returned recovered => clean:false, failed:1, failedByReason.parse:1, errors:1; unknown => clean:false, unchecked:1. Both were tested before any root census. |
| R2-M1: first write before root record | FIXED | I:371 stores pending writes independently; I:655 increments before the lock; I:663 removes the final count. Held `/ws/build/manual.ts` insertion while the first full run completed `/ws/b.ts`: coverage now reports updating. |
| R2-M2: preservation root-only | PARTIALLY FIXED | J:169 recursively prunes with preservation context and copies protected values whole. Nested objects/array elements retain every null. Pretty nested input and homogeneous result tables put coverage first. Equal-size and heterogeneous-table ordering remain R3-M1/R3-M2 below. |
| Reason legend only in source | FIXED | D:1779 shared agent-facing legend is used by both builders (D:1791,1826). Extracted actual builders measured search 882 chars and reindex 859, both below 1,000; description specs pass. |

Single-file positive/skip probes also passed: `/ws/a.ts` => analyzed:1, clean:true; `/ws/a.spec.ts` => excluded:1, clean:false, no symbols. The one-file clean result qualifies that named file, not the unknown root census (I:589,293).

## Earlier fixes and 24r checks

- **Unknown coverage survives the real budget path.** A 300-hit result was **93,376 characters / 19,614 input tokens → 1,749 returned tokens**. The reduced first line contained clean:false, its reason, and all three null fields (unrecognised, nonSource, excluded), followed by index metadata. It was explicitly truncated. B:100 supplies the protected keys; J:169 preserves their values; C:331 recomputes the verdict. The test used the real reducer, budget and tokenizer.
- **Purge stays qualified.** Independent real-indexer/store-adapter probe invalidated before purge and observed incomplete afterward. Invalidating a held full run also ended incomplete. Production RPC still calls invalidation before deletion (RPC:505–507); I:565 invalidates every live run and settled state. The RPC purge regression suite passed within the owner project's test run.
- **Pending/superseded writes and bounds remain covered.** I:458 checks pending mutations and runs; I:630 serializes same-file writes; I:610 caps per-file bookkeeping; I:698 applies the skip filter before the cap. Existing specs at `code-symbol-indexer.service.spec.ts:664,767,822,856` passed, including the 2,001st update and superseded run. I:751 records unreadable/over-1-MiB discoveries as failures.
- **Failure accounting remains honest.** Actual discovery with an EPERM stat adapter yielded analyzed:1, failed:1, failedByReason.read:1. Recovered-only full indexing now triggers the all-files-errored guard and leaves incomplete/failed:1; unknown quality gives unchecked:1. I:268 and I:1078 carry these distinctions; a failed insert remains failed/write (I:1051).
- **Unsupported Kotlin touches nothing.** Real namespace/indexer probes returned unsupported-language for both `.kt` search and reindex, with zero rows touched. N:579 rejects the unsupported extension before either search or file indexing.
- **Generic util boundary.** J imports only reducer types and matches caller-provided strings; it contains no production language-domain imports or hardcoded coverage/status keys. The domain key list remains in B:100. Recursive preservation does not require a util-to-core dependency.
- **Unbounded protected subtrees cannot bypass the final response budget.** A nested 100-row array with an oversized protected object per row reduced to a table but still returned only **1,841 tokens / 4,145 chars**, explicitly truncated, with the raw spool byte-for-byte equal to input. Other nested probes returned 1,978–1,979 tokens. Protection is not a promise that arbitrarily large values or every later array element fits inline: final fitting still runs after reduction (B:246 onward). No producer-sized coverage overflow was established.
- **1,000-character boundary.** Current size specs pass and pin the measured envelope to exactly 1,000 (`workspace-intelligence/src/ast/language-registry.spec.ts:226–241`). Zero headroom is acceptable under the explicit ruling, provided contract changes update this guard. As recorded in r2, the enumeration uses MAX/null rather than all consistent zero combinations; it is a measured guard, not a universal mathematical proof. No new valid-producer counterexample was found.
- **Batch 5/6 behavior.** This revision changes accounting/response qualification, not the symbol query algorithm. Namespace freshness admission/latch and governor flags remain at N:264–287, indexer governor handling at I:837. Indexer and namespace suites passed, including lazy-run and same-file behavior. Exact-name SQL recall was not independently re-benchmarked; no search-store algorithm changed in this round.

## New defects / failure modes

### R3-M1 — Moderate: equal-size compaction discards protected-key ordering

- **File:** J:102–103, after recursive preservation at J:169–189.
- **Trigger:** A compact JSON result has a bounded coverage object after a large sibling payload, with no empty fields or table conversion that would shorten the document. Example: `{results:[{text:largeText,coverage}]}`. The input is already compact, as execute_code serialization commonly is.
- **Symptom:** Pruning correctly moves coverage first, but the length check discards that result because reordering preserves length. `json-unchanged` restores the original payload-first text. The final response cuts before clean:false and the null qualifiers.
- **Evidence:** Temporary real reducer/budget probe using 30,000 characters of text returned json-unchanged, 1,978 tokens, no inline verdict or unknown field. Pretty-printing the same shape caused json-compact and a coverage-first prefix, establishing the guard as the cause. The full raw spool was exact.
- **Impact/current handling:** Aggregated results lose the intended status-first visibility despite requesting preserveKeys. A truncation trailer remains, so this does not establish a false clean answer or data loss. Direct index search/reindex producers are already qualified before payloads.
- **Recommendation:** Allow a non-growing equal-size result when protected-key reordering changed the output. Retain the no-growth rule and existing parse-loss guards. Add an already-compact nested/array fixture through the final budget path; pretty-only fixtures miss this case.

### R3-M2 — Moderate: table columns inherit the first row's omissions

- **File:** J:204,230–255; specifically keys.push at J:244.
- **Trigger:** A table-shaped result array has a first row without a protected key, and a later row with coverage plus a large payload. Probe: three rows sharing text/id, with coverage only in rows two and three.
- **Symptom:** Columns are `|text|id|coverage|`, contradicting the protected-columns-first guarantee (J:19–20). A cut inside row two's text drops that row's coverage even though it could have fitted at the beginning of the row.
- **Evidence:** The real reducer emitted that header; the real budget returned 1,978 tokens with no clean:false/null qualifier visible. Raw spool was exact. The homogeneous-table counterpart starts `|coverage|text|` and retains nulls. `asTable` receives no preservation order; it unions keys in first-encounter order across rows.
- **Impact/current handling:** An uncommon heterogeneous aggregate loses inline qualification at a cut. This is an ordering/observability limitation, not null pruning or an unbounded response. Existing all-rows-have-coverage regression (`json.reducer.spec.ts:440`) cannot expose it.
- **Recommendation:** Pass ordered preserveKeys into table construction and stably partition/reorder the completed column union by that order before rendering. Test absent protected keys in early rows and multiple protected keys introduced in different rows.

## Blocking issues

None established in r3.

## Serious issues

None established in r3.

## Five logic questions

1. **How does this fail silently?** The remaining qualification loss is R3-M1/R3-M2 (J:102,244), but truncation and an exact spool disclose omitted content. The direct single-file false-success path is fixed at I:902/N:484.
2. **What user action produces unexpected behavior?** Returning mixed or already-compact coverage-bearing arrays from execute_code can move qualifications behind the final cut; the two fixtures above reproduce it. Reindexing while the first census runs now correctly reports updating (I:655,458).
3. **What input produces a wrong answer?** Recovered/unknown parses no longer masquerade as a clean single-file result (I:268,293,1078). Heterogeneous JSON row shapes produce the wrong promised column order (J:244), not changed cell values.
4. **What happens when a dependency fails?** Read/parse/write failures qualify the file; discovery/aborted full runs remain incomplete (I:423,730,949,976,1051). Spool/budget handling stays bounded and reports withheld content (B:228 onward). EPERM, partial parse and held-write paths were injected independently.
5. **What is missing from the requirements?** Generic preserveKeys needs an explicit equal-size-reordering policy and a global table-column ordering rule (J:102,230). Arbitrary aggregates also cannot promise all per-result statuses inline; preservation must remain distinct from fitting every result in the final window.

## Data flow

1. Namespace validates unsupported file language before search/reindex — OK (N:354,475,579).
2. Indexer serializes writes, counts quality and tracks live mutations — OK for tested overlap/failure paths (I:630,649,268).
3. Namespace returns the single-file census or root coverage before hits — OK (N:391,484).
4. JSON reduction retains protected values recursively — null preservation OK; ordering PARTIAL (J:169; R3-M1/R3-M2).
5. Final budget measures and cuts, spooling the raw response — OK in normal, nested and oversized-protection probes (B:246 onward).

## Requirements fulfilment and edge cases

| Requirement / case | Status | Evidence / remaining concern |
| --- | --- | --- |
| Single-file recovered, unknown, skipped, clean | COMPLETE | Independent namespace probes; I:293,902 |
| First pending write before first census | COMPLETE | Held-write probe; I:655,458 |
| Nested null preservation | COMPLETE | Real recursive reducer probes; J:169 |
| Protected fields/columns first in all supported shapes | PARTIAL | R3-M1/R3-M2 |
| Huge preserved values remain within final budget | COMPLETE | 100-row nested probe, exact spool; B:246 |
| Code-index description legend and length | COMPLETE | Actual builders: 882/859 chars; D:1779 |
| Updating, incomplete, unknown, truncated | COMPLETE for tested paths | Prior regression suite and independent probes; I:436–525 |
| Same-file serialization and per-file cap | COMPLETE | Passing overlap/2,001st-update specs; I:610,630 |
| Unsupported .kt no-op | COMPLETE | Explicit answer, zero rows; N:579 |
| Coverage envelope <=1,000 | COMPLETE measured guard | Passing size spec; universal-proof limitation above |
| Batch 2b reducer compatibility / Task 20.3 bench | COMPLETE | Entire reducer suite passed, including reducers.bench.spec.ts |

## Verification

Run once, with NX_ISOLATE_PLUGINS=false, --skip-nx-cache, --parallel=2, --output-style=static:

`node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers @ptah-extension/rpc-handlers`

| Project | Tests | Lint / typecheck |
| --- | --- | --- |
| platform-core | 44 suites; 856 passed, 4 todo | PASS / PASS |
| workspace-intelligence | 48 suites; 1,477 passed | PASS / PASS |
| vscode-lm-tools | 70 suites; 1,996 passed | PASS / PASS |
| tool-output-reducers | 9 suites; 492 passed | PASS / PASS |
| rpc-handlers | 111 suites passed, 1 failed; 3,275 passed, 4 skipped, 1 failed | PASS / PASS |

Only failing target: rpc-handlers:test. Failure is the user-identified out-of-scope harness fixture: `harness-skill-selection-rpc.service.spec.ts:113`, expected `%TEMP%` harness state absent, found present. A worker teardown warning also appeared. No suite was rerun. Nx labelled platform-core:test flaky, but its current run passed; no new batch defect is inferred from that label.

`degradation-audit:lint`: PASS, **TOTAL 300**. `ptah-electron:validate-deps`: Nx reported PASS, including its dependency. The combined PowerShell wrapper returned 1 despite both targets' success summaries; this is recorded rather than presented as a clean wrapper exit.

Scoped Ptah diagnostics returned **Unavailable**, reporting compiler still running after 45 seconds, not zero diagnostics. Scoped CLI typechecks above independently passed.

Probes ran from OS-temp .cjs files, loaded actual TypeScript implementations through transpilation, and controlled AST/discovery/sink dependencies. They are not a native SQLite/WASM integration test. Budget probes used the real reducer/tokenizer/budget and mkdtemp spool roots, checked exact raw content, and removed only those roots. Main log: `C:/Users/abdal/AppData/Local/Temp/ptah-24r-r3-checks.log`. Review probes: `ptah-24r-r3-main.cjs`, `ptah-24r-reindex.cjs`, `ptah-24r-initial-write.cjs`, `ptah-24r-r3-nested.cjs`, `ptah-24r-r3-extra.cjs` in that directory. The first nested-probe launch failed during temporary script assembly; it was corrected before recording results, without modifying source or rerunning any suite.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the scoped r2 fixes and reproduced reducer limitations; MEDIUM for untouched surrounding integrations.
- Top risk: callers may overinterpret recursive preservation as guaranteed inline qualification for every aggregate, despite R3-M1/R3-M2 and ordinary truncation.
- What a robust implementation would add: equal-size ordering retention and globally ordered protected table columns, each pinned through the final budget. These Moderate follow-ups do not meet the contract's Blocking/Serious threshold for REVISE.
