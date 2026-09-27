# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

**Batch 22c, r1 — compact coverage, User Decision 21.** Reviewed the Lane H implementation against the authoritative Batch 22c entry and Decision 21 in the task-559-mcp-tool-contract worktree. Source was read-only; no git operations were performed.

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 new |
| Failure modes found | 0 new |

The serializer recomputes the verdict, retains every unknown qualifier in a qualified answer, and is wired into every current MCP path emitting LanguageCoverage. Independent real-tokenizer probes met the 40/120-token small-answer caps, including realistic cold-index and resolver-failure cases. Scoped verification passed. The evidence supports 8 rather than 7 because no new reproducible logic gap remains; it does not support 9 because this is bounded adapter/probe evidence, the pending cross-lane merge has not been verified, and known generic reducer ordering limitations remain outside this batch.

Evidence paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`:

- **C**: `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts`
- **P**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- **A**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`
- **D**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- **J**: `libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts`
- **B**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`

Inputs included the executor report, authoritative task context Decision 21 (`context.md:63`) and Batch 22c (`batches.md:3432`), retained 24b/24r review context, complete coverage contract and AST namespace, changed dispatcher helpers/call branches, reducer preservation path, description builders and relevant specs. Large dispatcher/description subsystems were traced at the changed consumers, not re-reviewed as unrelated whole-tool implementations. No applicable AGENTS.md or task-specific style review was found in the inspected locations. Native reads were used because no Ptah source-reading tool was listed; diagnostics used Ptah.

## Numbered defects / failure modes

**No new defect established.** In particular:

1. **Null-only qualification survives.** Setting each of unchecked, failed, unsupported, unrecognised and omittedByCap to null, individually, produced clean:false, a nonempty reasons array, and the explicit null. C:441 recomputes the verdict before omission; C:455–457 drops only numeric zero. A 288-case probe varied census, state, count key and 0/1/null and found no disagreement with isCleanAnswer or lost null in a qualified result. Resolution nulls follow the same rule at C:402–414; the corresponding specs pass.
2. **Clean minimalism follows the explicit decision.** C:442–443 returns only clean/analyzed. This intentionally omits nonSource, excluded:null, external resolution counts, approximations and checks when they do not qualify the existing clean rule. It is not lossless encoding of the full in-memory object, and “omitted = 0” must be read as the qualified-form rule. The actual agent legend makes that distinction (D:1781); the current producers still expose the relevant request/file/page context outside coverage, as detailed below. This is not treated as a violation of the decision's explicit clean-only shape.
3. **No current old-shape MCP emission was found.** P:2009,2140,2174,2263,2896 cover the six current tools. A:193,278 cover the embedded AST error blocks. Typed execute_code results remain full by the accepted exception. Diagnostic formatter fields also named coverage are counts of diagnostic coverage failures, not LanguageCoverage, and must not be passed through this serializer.

No Blocking or Serious issues were established. No new Moderate or Minor defect is counted. The following are limits/follow-ups, not invented failures:

- Graph and AST descriptions do not include the compact reading legend (D:1661,1726,1750,1923); only the two code-index descriptions do. A future shared-help addition would make omissions easier to interpret consistently. clean:false and explicit reasons/nulls remain present, so no false-clean result was demonstrated.
- The existing 24r r3 findings remain: J:102 can discard equal-size reordering, and J:244 builds table columns by first occurrence. This batch does not change them or claim to fix them. Null values are still retained in the reducer; a final cut can hide a late aggregate's whole block. The ordinary direct tool shapes and the nested probe below kept compact coverage verbatim. Do not interpret preservation as a guarantee that every arbitrarily late aggregate fits inline.

## Tool coverage and measured overhead

Overhead is the exact o200k count from gpt-tokenizer of JSON with coverage minus the same answer without coverage, including the coverage key and punctuation. Probes invoked the actual compactCoverage and extracted actual dispatcher helpers. Fixtures used twelve dependent paths, realistic dependency paths, two symbol-index file entries, a single-file AST response, a code hit with freshness metadata, and a single-file reindex response. Full dispatcher integration was exercised by the scoped suite.

| Tool | Serializer used? | Clean overhead | Qualified overhead |
| --- | --- | ---: | ---: |
| ptah_get_dependents | Yes: graphFileAnswer, P:2896 | 11 | 63 |
| ptah_get_dependencies | Yes: graphFileAnswer, P:2896 | 11 | 63 |
| ptah_get_symbol_index | Yes: page completeness header, P:2263 | 11 | 63 |
| ptah_ast_analyze | Yes: withCompactCoverage, P:2009 | 11 | 25 |
| ptah_code_search_symbols | Yes when coverage present, P:2140 | 11* | 34 |
| ptah_code_reindex | Yes on single-file coverage result, P:2174 | 11 | 25 |
| AST unsupported/export-query error blocks | Yes: A:193,278 | N/A | Same serializer; explicit error/status remains |
| execute_code typed API | Full shape intentionally retained | Exempt | Exempt |

The graph qualified case has 128 analyzed files, two unsupported Python files, three unrecognised files, 41 non-source files, excluded:null and 57 external imports. AST/reindex qualified cases use a recovered parse with failed:1 and failedByReason.parse:1. Search uses its normal unrecognised/nonSource/excluded nulls. *The clean search measurement exercises the serializer branch; the current root index normally stays qualified because its discovery cannot enumerate unrecognised files.*

Additional realistic small-answer probes:

| Scenario | Added tokens | Result |
| --- | ---: | --- |
| Cold graph, all counts unknown | 71 | clean:false, census?, explicit nulls |
| Cold code index while updating | 83 | clean:false, census?/updating, explicit nulls |
| One failed file read among 128 | 34 | clean:false, failedByReason.read:1 |
| Partial resolver, two unresolved internal imports | 56 | clean:false, both reasons and approximation |
| Only unrecognised count unknown | 29 | clean:false, unrecognised?, unrecognised:null |

All measured clean cases are below 40 and all these typical qualified cases below 120. The 120-token cap is a typical-small-answer requirement, not a cap on every possible saturated qualified block. No claim is made that every real repository response was sampled.

## Can the agent tell what was covered?

- **Dependency queries:** P:2892–2898 keeps count, cap metadata, fileInGraph and the resolved file beside the compact block. A clean graph coverage cannot erase fileInGraph:false. Coverage describes the answering graph, not the length of the returned dependency list; the requested file and graph qualification remain separate. Existing answering-graph and membership specs passed.
- **Symbol index:** P:2253 explicitly obtains merged graph coverage; P:2955–2965 retains count/total/offset/nextOffset and file entries. analyzed is the graph census, not page size. Compact serialization does not remove the paging or cap signals.
- **AST:** A:99–102 retains file and language beside coverage; parseStatus/error-node fields remain at A:96–98. analyzed:1 describes the explicit file. Structural analysis is not newly claimed to be a type check.
- **Code search:** the namespace still returns index freshness and coverage ahead of hits (`code-namespace.builder.ts:396–399`); P:2910 preserves key positions while replacing only coverage. The request supplies any file filter. This batch does not create a new file-level census for that filter.
- **Single-file reindex:** the requested absolute path identifies the one-file operation, and filesScanned/symbolsIndexed/errors remain. Full-workspace reindex returns its existing background-start acknowledgement, not a completed coverage claim (P:2174; `code-namespace.builder.ts:501` onward).

SupportedLanguages is a capability list, not an enumeration of files actually analyzed. Removing it on clean answers does not itself conceal which requested file/page was processed. Future consumers that rely on checks or approximations to distinguish types of analysis must preserve that distinction outside the minimal clean block or revisit the decision; current diagnostic/LSP language coverage integrations are not established by this batch.

## Reducer and budget evidence

The actual compact index block was fed through the real reducer, tokenizer, budget and raw spool path:

| Probe | Raw chars | Returned tokens | Compact block retained verbatim? | Raw spool exact? |
| --- | ---: | ---: | --- | --- |
| Direct result, 300 hits | 69,323 | 1,311 | Yes, reduced and final | Yes |
| Nested results array, compact block per result | 69,607 | 1,337 | Yes, reduced and final | Yes |

J:169–189 copies the protected value without pruning its nulls, including when it occurs in an array element. B:100 supplies the protected key list. No new utility-domain dependency or reducer change was introduced by this serializer. The existing exact compact-block budget regression is at `tool-result-budget.spec.ts:593` onward and passed. The full reducer suite, including the Task 20.3 benchmark, passed.

The current worst-case enumerator, independently loaded with the actual serializer, measured **997 characters**. The corresponding compact/full pins are tested at `workspace-intelligence/src/ast/language-registry.spec.ts:260` onward. This is a measured closed-fixture envelope, not a promise over malformed runtime objects or future schema additions. The merge with unsupported-syntax must remeasure it, as the authoritative batch explicitly requires.

## Legend and description budgets

The agent-facing legend at D:1780–1781 is accurate for the two forms: clean contains analyzed; otherwise omitted counts mean zero and null means unknown. Reasons retain their established semantics. A stale/updating census is qualified even if every known count is zero (C:299 onward).

Actual extracted builder lengths:

| Description | Characters |
| --- | ---: |
| code search | 972 |
| code reindex | 949 |
| AST analyze | 448 |
| dependents | 647 |
| dependencies | 617 |
| symbol index | 944 |

All are below 1,000; the description budget specs passed. The code-search description has only 28 characters of remaining headroom, so future help additions require deliberate shortening elsewhere.

## Five logic questions

1. **How does this fail silently?** No new path established: null qualifiers keep clean:false/reasons (C:441,457), and compact blocks survive the tested reduction path (J:169). The two pre-existing aggregate ordering limitations are explicitly retained above.
2. **What user action produces unexpected behavior?** None newly reproduced. Named-file queries, paged symbol queries and single-file reindex preserve their surrounding scope/status fields (P:2892,2955; A:99). Unsupported and building/error branches continue to disclose their condition instead of inventing coverage.
3. **What input data produces a wrong answer?** No supported CoverageFields input in the 288-case probe changed the clean predicate or lost a qualified null. Stale embedded verdicts are recomputed (C:441). Clean non-qualifying information is deliberately omitted under Decision 21, not reconstructed from absent fields.
4. **What happens when a dependency fails?** The serializer is pure and introduces no I/O. Read/parse/index failures retain the producers' qualification/error paths; AST error blocks are compacted at A:193,278. Final budget/spooling behavior remains owned by B, with raw preservation checked independently.
5. **What is missing that the requirements never mentioned?** Minimal clean coverage cannot encode analysis modality, approximation details or an explicit list of analyzed files. Existing tools retain sufficient file/page context, but later diagnostics/LSP integrations must not equate a syntax check with a type check merely because both serialize to clean:true. This is a future integration constraint, not a current new defect.

## Data flow

1. Existing producers build full LanguageCoverage and compute/merge counts — unchanged, OK.
2. Direct MCP dispatcher/error boundary invokes compactCoverage — all current full-shape emitters found are covered (P:2009,2140,2174,2263,2896; A:193,278).
3. Serializer recomputes verdict and omits only allowed fields — OK for measured valid inputs (C:437–481).
4. Protected JSON fields survive reduction verbatim — OK in direct/nested probes; known aggregate ordering caveats remain (J:169,102,244).
5. Final budget/spool bounds output — OK in the real pipeline probes; typed execute_code remains the approved full-shape exception.

## Requirements fulfilment / edge cases

| Requirement or edge case | Status | Evidence / limit |
| --- | --- | --- |
| Clean exact two-field shape | COMPLETE | C:442–443; clean/null-analyzed specs |
| Qualified verdict/reasons and zero omission | COMPLETE | C:441–481; 288-case probe |
| Unknown null buckets retained when qualified | COMPLETE | C:457; null-only probes and nested reduction |
| Existing isCleanAnswer semantics unchanged | COMPLETE | Same predicate used by serializer; C:441 |
| All current LanguageCoverage MCP consumers | COMPLETE | Six tools plus two AST error blocks audited |
| Typed execute_code full shape | ACCEPTED EXCEPTION | Namespace contracts unchanged, per orchestrator ruling |
| 40/120 token caps | COMPLETE for typical answers | Exact tokenizer deltas above; dispatcher spec |
| Compact worst case <=1,000 | COMPLETE measured guard | 997 independently reproduced |
| Agent legend under description budget | COMPLETE | 972/949, specs pass |
| Null-only, stale/updating, empty result | HANDLED | Explicit verdict/reasons survive; original scope metadata retained |
| Post-merge unsupported-syntax / Batch 20.2 SIZE checks | NOT YET APPLICABLE | Required after lane merge; not claimed complete here |

## Verification

Executed once with NX_ISOLATE_PLUGINS=false, --skip-nx-cache, --parallel=2, --output-style=static:

`node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers`

| Project | Tests | Lint | Typecheck |
| --- | --- | --- | --- |
| platform-core | 46 suites; 967 passed, 4 todo | PASS | PASS |
| workspace-intelligence | 48 suites; 1,493 passed, 1 skipped | PASS | PASS |
| vscode-lm-tools | 70 suites; 2,044 passed | PASS | PASS |
| tool-output-reducers | 9 suites; 492 passed | PASS | PASS |

Nx reported all 12 targets successful. There were lint warnings and a vscode-lm-tools worker teardown warning, but no failing test. The PowerShell wrapper returned 1 despite the Nx success summary; report the target results rather than treating that wrapper exit as a test failure or concealing it. No failed suite was rerun.

- `degradation-audit:lint`: PASS, **TOTAL 300**.
- `ptah-electron:validate-deps`: PASS, including its dependency target. Combined wrapper likewise returned 1 despite both success summaries.
- Scoped Ptah diagnostics, contract and dispatcher: **typescript-compiler, 0 errors / 0 warnings**.
- Main verification log: `C:/Users/abdal/AppData/Local/Temp/ptah-22c-review.log`.
- Independent probes: `ptah-22c-probe.cjs` and `ptah-22c-extra.cjs` in that temp directory. Temporary script extraction initially omitted a description constant; that probe harness was corrected before recording completed measurements. Production source was never edited.

Probes transpiled the actual pure contract and extracted actual dispatcher/description helper functions, using representative answer data. They did not boot Electron or a native SQLite/WASM integration. Each spool used a mkdtemp directory, checked exact raw content and removed only its own root. The task-worktree post-merge bench and unsupported-syntax reconciliation were not run because this Lane H worktree is not that merged implementation; they remain the explicit integration gate in Batch 22c.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for this compact serializer and its current MCP wiring.
- Top risk: future consumers may lose meaningful check/approximation context if they rely solely on the deliberately minimal clean block.
- What a robust integration would add: preserve modality outside coverage when needed, expose compact reading rules in shared graph/AST help, and run the mandated unsupported-syntax plus realistic dependents/symbol-index SIZE checks after merge. These are integration constraints/follow-ups, not a demonstrated Blocking or Serious defect in Batch 22c r1.
