# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Requested verdict   | REVISE         |
| Blocking issues     | 1              |
| Serious issues      | 1              |
| Moderate issues     | 1              |
| Failure modes found | 3              |

Round 2, Batch 9, 2026-09-26. F2 is explicitly excluded from this verdict by context.md:49 (User Decision 14). Ordinary oversized-symbol entries are now recoverable, and scoped checks pass. However, the cap disclosure still fails two result paths and an oversized metadata envelope still breaks JSON. That separates this from the sound 7–8 band; the working pager, trusted spool routing and tested coverage lifecycle separate it from the significant-problems 3–4 band.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. `CE/` abbreviates `libs/backend/vscode-lm-tools/src/lib/code-execution/`; `DG` means `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`.

## Round 1 findings

| Finding                         | Status                                                        | Evidence                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| F1: oversized entry breaks JSON | not fixed (ordinary-symbol case fixed; metadata edge remains) | CE/mcp-core/protocol-dispatcher.ts:2429 now spools the entry; :2442 still returns metadata without checking it fits. R2-M1 below. |
| F2: cold build blocks call      | moved-to-9b                                                   | context.md:49; awaited construction remains at CE/mcp-core/protocol-dispatcher.ts:2332. Not counted or used to request revision.  |
| F3: silent graph cap            | not fixed (single-root small responses fixed)                 | R2-B1 and R2-S1 below; coverage storage/lifecycle itself works.                                                                   |

## Five logic questions

### 1. How does this fail silently?

A query for an absolute file in cached root B can return B's incomplete graph answer with root A's complete coverage, omitting the warning entirely (dispatcher:1975/:2001; DG:486). See R2-B1.

### 2. What user action produces unexpected behaviour?

Querying a heavily imported module or a module with a large transitive dependency set loses the graph-cap disclosure after the generic budget cuts the list (dispatcher:1972/:1998; tool-result-budget.ts:267). See R2-S1. Paging a very deeply nested file can still return invalid JSON (dispatcher:2442), R2-M1.

### 3. What input data produces a wrong answer?

Two cached roots with different cap coverage produce mismatched metadata for absolute cross-root queries (R2-B1). A 6,485-character file path produced an over-budget zero-symbol envelope: 6,613 characters but 2,473 tokens, proving that the residual is not limited to paths plus spool paths exceeding 8,000 characters (R2-M1).

### 4. What happens when a dependency fails?

Ordinary spool failure is explicitly represented by symbolsFileError, and paging advances (dispatcher:2436; protocol-dispatcher.spec.ts:3773). The successful spool uses the same host-owned resolveSpoolRoot as the generic budget (dispatcher:2151/:2550/:2583), and spoolToolText delegates to the existing exclusive-create/prune implementation (tool-result-budget.ts:502). The reproduction of R2-S1 injected EACCES only at mkdir; no real permission failure is reported as a defect. With a long metadata envelope, even the explicit error cannot fit and the generic cut breaks JSON. Cold-build waiting belongs to Batch 9b.

### 5. What is missing that the requirements never mentioned?

Coverage must follow the graph selected for the queried file, not merely the current session, and mandatory completeness metadata must survive the final budget boundary. Neither is exercised by the new small, single-root dispatcher coverage fixtures (protocol-dispatcher.spec.ts:977). Enumeration also needs an explicit large-workspace resource policy; see the unscored observation below.

## Failure modes

### R2-B1 — Coverage is taken from the wrong cached graph (Blocking)

- Trigger: session root A is complete; cached root B is capped; call either dependency tool with an absolute file under B.
- Symptom: B's answer has no incomplete/graphedFiles/discoveredFiles fields. Reversing the coverages gives a false warning with A's counts on a complete B answer.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:1975 and :2001 pass graphRoot from the session; :2468 preserves absolute file arguments. DG:486 selects the graph by longest matching file-root prefix, independently of that session root.
- Current handling: getCoverage(A) is used even though dependency traversal uses B.
- Reproduction: in-memory transpilation of the actual DependencyGraphService, with stubbed parser/file reads, built A with one file and B with one file/discoveredFiles=5001. Actual findGraphEntryForFile('C:/b/b.ts') selected C:/b; actual graphCompleteness(api,'C:/a') returned {}; getCoverage('C:/b') was {graphedFiles:1,discoveredFiles:5001}.
- Recommendation: obtain the dependency answer and coverage from the same selected graph/root; cover both coverage directions and nested roots.

### R2-S1 — Result budgeting removes the new cap disclosure (Serious)

- Trigger: a capped graph yields a dependency/dependent list exceeding the result budget.
- Symptom: the inline result has a generic partial-output trailer but none of the three graph-cap fields. If spooling fails, those fields cannot be recovered from the named output either.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:1972/:1975 and :1998/:2001 serialize the large array before completeness. CE/mcp-core/tool-result-budget.ts:267 cuts a prefix; scalar-string arrays are not reduced into a table.
- Current handling: disclosure is appended at the end of JSON before generic budgeting. The generic partial-result warning describes output truncation, not the independently incomplete graph.
- Reproduction: actual applyToolResultBudget and actual reducer/token modules, with filesystem mkdir injected to throw EACCES. For each tool, 1,500 paths C:/ws/lib/module-N.ts with coverage 5000/6000 produced ~39,500 raw characters. Returned text was 5,576/5,571 characters; neither incomplete nor graphedFiles was present. The full-output save failure was honestly reported, but graph coverage was lost.
- Recommendation: serialize the three completeness fields before potentially large lists, or preserve them in a bounded result envelope through budgeting; test both tools with long lists and spool failure. This finding does not demand JSON paging for those two unpaged tools.

### R2-M1 — Oversized metadata still violates the JSON-page contract (Moderate)

- Trigger: file metadata alone exceeds either budget, even when symbols is empty and spooling fails.
- Symptom: the renderer returns over-budget JSON which the generic preformatted budget cuts into unparsable text.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:2442 returns oversized(largestFitting(...)); :2450 assumes fits(0). No fallback verifies the zero-symbol envelope. CE/mcp-core/tool-result-budget.ts:89 applies the preformatted cut.
- Current handling: largestFitting returns zero even when zero does not fit.
- Reproduction: actual renderer extracted via TypeScript AST and actual budget/reducer modules; file = 'C:/' + Array(810).fill('deepabc').join('/') + '.ts', symbols=['S'], spool returns {failure:'EACCES'}. Path=6485 chars; rendered envelope=6613 chars/2473 tokens; fitsBudget=false. Final budgeted text=5252 chars; JSON.parse fails. No filesystem creation or source modification was needed.
- Recommendation: check the metadata-only envelope before binary search. Provide bounded file/spool locators with explicit recovery metadata, or a bounded valid JSON error when no recoverable locator can fit. Never pass an over-budget page to the generic text cut.
- Judgment: a real reproduced contract defect, but Moderate because it requires an unusual long-path input. The token ceiling makes it broader than the executor's stated >8000-character case.

## Blocking issues

R2-B1: dispatcher:1975/:2001. A capped negative answer is presented without the required warning when querying another cached root. Couple coverage selection to dependency graph selection.

## Serious issues

R2-S1: dispatcher:1975/:2001; tool-result-budget.ts:267. Large lists remove required coverage fields. Put completeness before the unbounded list and verify the delivered result, including spool failure.

## Moderate and minor issues

R2-M1: dispatcher:2442/:2450. The metadata-only envelope must be checked against both limits. No additional minor defect is asserted.

## Data flow

1. Arguments -> parseSymbolIndexQuery: OK. Limit bounds, safe-integer offset, traversal and drive-relative rejection happen before graph construction (symbol-index-query.ts:50; dispatcher:2134).
2. Discovery -> capped graph: correctly lists matches then parses at most 5000, passing the discovered count (dispatcher:2319/:2332). Cold waiting is moved to 9b.
3. Coverage publication -> eviction: OK for root keys. Stored with graph at DG:225/:228, normalized on read at :413, removed by evict/retainOnly/clear at :435/:454/:466.
4. Namespace -> optional page: old root-only calls retain unpaged arrays; explicit queries validate/filter/sort/slice (analysis-namespace.builders.ts:405; symbol-index-query.ts:129).
5. Page -> oversized entry: ordinary entry spooled in full, prefix symbols retained, count/nextOffset advance (dispatcher:2407/:2429). Gap: metadata-only fit, R2-M1.
6. Dependency query -> coverage: gap R2-B1.
7. Serialization -> delivered budgeted text: fitting symbol pages pass unchanged; dependency completeness can be cut, R2-S1.

## Requirements fulfilment

| Requirement                                             | Status                                         | Gap                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oversized entry middle/final/alone, recoverable symbols | PARTIAL                                        | Ordinary cases covered by passing specs at protocol-dispatcher.spec.ts:3702/:3740/:3764; metadata edge R2-M1                                                                                                                                                   |
| Explicit spool failure, paging advances                 | COMPLETE for ordinary metadata                 | Passing spec :3773; long metadata separately fails                                                                                                                                                                                                             |
| Host-owned spool root                                   | COMPLETE                                       | Dispatcher:2151 uses resolveSpoolRoot(:2583), same as generic budget; no caller root passed directly                                                                                                                                                           |
| Cap warning on all three tools                          | PARTIAL                                        | R2-B1/R2-S1; symbol-page warning is placed before files (:2414)                                                                                                                                                                                                |
| Coverage eviction and per-root storage                  | COMPLETE                                       | DG:225/:411/:432/:448/:463; service coverage specs :250–312                                                                                                                                                                                                    |
| Shared buildGraph signature compatibility               | COMPLETE for located callers                   | Optional fourth service arg preserves tsconfigPaths third arg. Only production service invocation found in analysis-namespace.builders.ts:437; namespace callers at dispatcher:2332 remain compatible. Runtime execute_code callers retain optional arguments. |
| Paging/input/backward compatibility                     | COMPLETE for fixed index and ordinary metadata | Namespace paging specs :676 onward; parser and continuation paths inspected; scoped suite passed                                                                                                                                                               |
| Descriptions/help                                       | PARTIAL                                        | Defaults/overloads are documented (tool-description.builder.ts:1860; system-namespace.builders.ts:325; ptah-system-prompt.constant.ts:76); unconditional disclosure/page claims still fail above. Description-size specs passed.                               |
| Frozen constants and LSP/enrich blocks untouched        | Not independently established                  | Executor reports unchanged; no git operations performed under reviewer role restriction                                                                                                                                                                        |

Implicit requirements not addressed: final-budget preservation of mandatory graph metadata and graph-selection consistency.

## Edge cases

| Case                                 | Handled                | How                                        | Concern                                         |
| ------------------------------------ | ---------------------- | ------------------------------------------ | ----------------------------------------------- |
| Empty filter / past-end offset       | YES                    | Empty page, no nextOffset                  | Subject to disclosed graph cap                  |
| Invalid paging input                 | YES                    | Fixed errors before graph work             | Scoped suite passed                             |
| Oversized symbols middle/final/alone | YES                    | Single-file spool envelope                 | Path metadata must fit                          |
| Spool fails                          | YES for ordinary paths | symbolsFileError and progress              | R2-M1 for very long metadata                    |
| Metadata exceeds token/char budget   | NO                     | Assumed fitting baseline                   | R2-M1                                           |
| Cross-root absolute query            | NO                     | Result and coverage choose different roots | R2-B1                                           |
| Large dependency list                | NO for cap disclosure  | Generic prefix cut                         | R2-S1                                           |
| Evict/retainOnly/clear               | YES                    | Coverage removed with graphs               | Tested lifecycle                                |
| 100k+ discovered paths               | Resource cost remains  | Entire match list materialized before cap  | No measured crash/timeout; not a defect finding |

### Enumeration resource observation (not a scored defect)

Yes, findFiles loads all matching paths before the 5000-file slice. CLI already materializes fast-glob's full array before its provider slice (platform-cli/src/implementations/cli-file-system-provider.ts:128–135); Electron does likewise (:126–134). The changed unlimited request additionally sends all matches through namespace relative-path map/filter (CE/namespace-builders/core-namespace.builders.ts:154–164) and keeps that discovered array across the awaited build (dispatcher:2319–2336). VS Code now requests effectively unlimited URI results (platform-vscode/src/implementations/vscode-file-system-provider.ts:170). Thus path memory is O(all matches), parsing stays capped, and traversal/normalization latency can grow. No 100k-file performance measurement or OOM was reproduced; do not infer one. A streaming count while retaining only the selected paths would bound retained path storage.

## Verification and limits

- Requested root command `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: all six targets succeeded; 1m30s. Run once, one completion read.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: succeeded; TOTAL 300; 13.8s. Run once, one completion read.
- Scoped ptah_get_diagnostics for the dispatcher and graph-service files: typescript-compiler, zero errors/warnings.
- Independent read-only Node probes transpiled current sources in memory. Filesystem/AST dependencies were stubbed only where stated; budget and token logic were real. These were deterministic behavioral probes, not production filesystem/transport end-to-end runs.
- Read the task context, Batch 9 plan/evidence and r1 review; task-description.md, implementation-plan.md and current code-style-review.md are absent. No applicable AGENTS.md/CLAUDE.md was found in the searched paths. No raw .jsonl/.sqlite logs were read; no git operations or reviewed-source edits were performed.
- ptah file-read tool is not listed; native reads/search were used. Full parser and graph-service logic plus relevant dispatcher, namespace, budget, type, description, help and regression-test paths were examined. Large unrelated shared-file implementations are outside this verdict; this is not approval of those files in full. Frozen-region unchanged claims are attributed to executor evidence, not independently diff-certified.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the three reproduced failures; enumeration impact is unmeasured.
- Top risk: an absolute query in another cached workspace returns an incomplete graph answer without the warning required by Decision 14.
- What a robust implementation would add: graph-selected coverage, completeness preserved before large lists, and a bounded JSON fallback when metadata alone cannot fit. Keep cold-build orchestration in Batch 9b.
