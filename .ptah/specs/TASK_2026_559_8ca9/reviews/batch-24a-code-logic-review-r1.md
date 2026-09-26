# Code Logic Review (r1) — Batch 24a, Lane I

## Summary

| Metric | Value |
|---|---|
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 (both Moderate) |

## Scope verified

Diff read in full: `tree-sitter-parser.service.ts` (+spec), `ast-analysis.interfaces.ts`, `ast-analysis.service.ts` (+spec), `ast-namespace.builder.ts` (+spec), `types.ts`, `session-root-divergence.spec.ts`. Cross-checked against the shared contract (`platform-core/interfaces/language-coverage.interface.ts`, `isCleanAnswer`) and the registry (`language-registry.ts:519` `classifyFileForCoverage`). Re-ran `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: 6/6 tasks green, matching the executor report.

## Probe table

| Input | parseStatus | coverage | Reads clean? |
|---|---|---|---|
| TS file, syntax error | `recovered` (tree-sitter-parser.service.ts:78-85) | `failed:1`, `failedByReason.parse:1` | No — `isCleanAnswer` false |
| `.kt`/`.xyz` (unrecognised/unsupported) | n/a — `readFileForAst` throws before analysis (ast-namespace.builder.ts:272-279) | `unsupported:1` or `unrecognised:1` embedded in thrown message | No — error, not a success payload |
| `.mjs` (registry-recognised, capability-less) | n/a — throws, `classifyFileForCoverage` → `unsupported` (language-registry.ts:528) | `unsupported:1`, `unsupportedByLanguage` | No |
| Huge file, clean | `ok` | `analyzed:1` | Yes, correctly |
| Empty file | `ok`, `errorNodeCount:0` (tree-sitter-parser.service.ts:590-597) | `analyzed:1` | Yes — matches spec 24a "clean and empty parses explicitly" |
| Metadata absent (legacy/other producer) | `unknown`, `errorNodeCount: null` | `unchecked:1` | No — `?? 'unknown'` defaults at ast-namespace.builder.ts:90 and ast-analysis.service.ts:128 |

## Five logic questions

**1. Silent failure?** None found in the scoped diff. Every path that would otherwise look clean (missing metadata, recovered parse, unsupported/unrecognised file) is explicitly downgraded via `?? 'unknown'` defaults or thrown errors before a success payload is built.

**2. Unexpected user action?** Calling `ast.queryExports` on a language without `publicSymbols` now throws instead of returning `[]` (ast-namespace.builder.ts:187-192), which is the intended behavior change (24a.2) but is a breaking response-shape change for any caller that relied on catching an empty array rather than a rejection — see Requirements/consumers below.

**3. Wrong-answer input?** None identified for the scoped files. `classifyFileForCoverage` and `fileCoverage` are consistent with the shared registry rules (unsupported outranks unrecognised outranks nonSource per language-registry.ts:509-541).

**4. Dependency failure/odd shape?** `queryMulti`'s `parseQuality` walk (tree-sitter-parser.service.ts:70-85) is a DFS that only recurses into subtrees whose `hasError` is true, so a clean large file exits after one O(1) check on the root — no full-tree walk. For an *error* tree, however, the cap (`errorNodeCount < 20`) is only checked between pops, not before pushing a node's children: a single ERROR node with a very large flat child list (e.g., a large minified file that fails to parse into one giant error blob) enqueues all of that node's children onto `pending` in one iteration before the count-based short-circuit can apply. This is a real but narrow memory/CPU exposure on the "huge file" + "malformed" combination named in the check list.

**5. Missing/unaddressed by requirements?** The four other AST sub-operations (`parse`, `queryFunctions`, `queryClasses`, `queryImports`) still return raw data with no `parseStatus`/`coverage` at all — a recovered parse for these still looks like an ordinary, complete result to a caller. This matches the batch's stated scope (batches.md Batch 24a: only `analyze` and the `queryExports` capability error), so it is not a defect of this batch, but it is a real requirements gap the plan left unaddressed for the next batch.

## Failure modes

### Unbounded per-generation enqueue in `parseQuality`

- Trigger: a very large source file whose root (or a shallow node) is an ERROR node with a very wide flat child list.
- Symptom: one iteration's `pending.push(...)` loop enqueues all of that node's children (not bounded by the 20-count cap) before the next pop reevaluates the loop condition; worst case is O(children of one node), not O(20).
- Evidence: tree-sitter-parser.service.ts:70-79 (`while (pending.length > 0 && errorNodeCount < 20)`, then unconditional `for (const child of node.children) pending.push(child)` inside the body).
- Current handling: none; cap is enforced only at the loop-condition granularity.
- Recommendation: break out of the inner `for` as soon as `errorNodeCount` reaches 20, or check the cap before each push.

### Sub-operations left without honesty signal

- Trigger: calling `ast.parse`, `queryFunctions`, `queryClasses`, or `queryImports` against a file with syntax errors.
- Symptom: caller gets structurally normal output (an `AstParseResult` or array) with no indication tree-sitter recovered from a parse error; a malformed file's partial function/class list is indistinguishable from a complete one.
- Evidence: ast-namespace.builder.ts:105-178 — none of these four handlers reference `parseQuality`/`coverage`.
- Current handling: out of this batch's declared scope (batches.md Batch 24a only requires `analyze` and the `queryExports` capability error).
- Recommendation: track for the next batch that extends the parse-status contract to these operations; not a blocker here.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: unbounded per-generation enqueue in `parseQuality` on pathological wide-and-flat error trees (tree-sitter-parser.service.ts:70-79).
- Moderate: `parse`/`queryFunctions`/`queryClasses`/`queryImports` remain silent on recovered parses (ast-namespace.builder.ts:105-178) — explicitly deferred by batches.md, tracked as a gap rather than a defect.
- Minor: `LanguageCoverage` is imported via an inline `import('@ptah-extension/platform-core')` type in types.ts:1108 rather than the top-level import block; functionally correct (type-only, erased at compile time, dependency already declared in package.json) but a style inconsistency — routed to code-style-reviewer territory, not scored here.

## Data flow

1. `queryMulti` parses content once, computes `parseQuality` from the same `tree.rootNode` used for query extraction (tree-sitter-parser.service.ts:643-653) — OK, single parse, no second classification.
2. Metadata is spread onto the same `Map` returned to callers via `Object.assign` (`QueryResults` type) — OK, no shared mutable state across calls (each call builds a fresh Map).
3. `AstAnalysisService.analyzeSource` copies `parseStatus`/`errorNodeCount`/`errorNodeCountCapped` from the map with `?? 'unknown'` / `?? null` / `?? false` defaults (ast-analysis.service.ts:128-131) — OK, defaults never claim clean.
4. `ast-namespace.builder.ts` `analyze` re-derives `parseStatus` with another `?? 'unknown'` guard and builds `coverage` via the shared `classifyFileForCoverage`/`supportedLanguagesFor`/`languageForExtension` — OK, reuses the contract, does not reimplement classification.
5. Response object literal orders `parseStatus, errorNodeCount, errorNodeCountCapped, coverage` before `file, language, functions, classes, imports, exports` (ast-namespace.builder.ts:91-102) — OK, matches "contract before unbounded fields," confirmed by the executor's own spec assertion `Object.keys(out).indexOf('coverage') < indexOf('file')`.
6. Unsupported/unrecognised files never reach the success path — `readFileForAst` throws before `analyzeSource` is called, with `fileCoverage` embedded in the thrown message (ast-namespace.builder.ts:272-279) — OK.

## Requirements fulfilment

| Requirement | Status | Gap |
|---|---|---|
| Recovered/unknown never reads as clean (24a.1) | COMPLETE | none found |
| Bounded ERROR/MISSING count | COMPLETE (with the per-generation enqueue caveat above) | see Failure modes |
| `queryExports` on capability-less language errors, not `[]` (24a.2) | COMPLETE | breaking change for existing callers — see below |
| Contract reused, not reimplemented | COMPLETE | none |
| types.ts single additive hunk (Lane A handoff) | COMPLETE | verified: one 8-line addition inside `AstCodeInsights`, nothing else touched |
| Mock handoff uses `jest.requireActual` correctly | COMPLETE | see below |

Implicit requirements not addressed: parse-status honesty for `parse`/`queryFunctions`/`queryClasses`/`queryImports` (explicitly out of this batch's scope per batches.md).

## Response-shape compatibility (consumers)

- `AstCodeInsights` (types.ts:1101) gained four required fields (`parseStatus`, `errorNodeCount`, `errorNodeCountCapped`, `coverage`) ahead of the existing `file`/`language`/... fields. This is additive at the JSON level (existing readers that only destructure `file`/`functions`/etc. are unaffected) but is a **type-level breaking change** for any TypeScript consumer with an existing literal/mock of `AstCodeInsights` missing the new required fields — the executor's own report confirms `ast-namespace.builder.spec.ts` needed updated expectations for exactly this reason.
- `queryExports` behavior change (returns error instead of `[]` for capability-less languages) is a behavioral break for any caller (MCP tool consumer, `execute_code` script) that treated an empty array as "no exports" for e.g. Python. This is the intended fix (25a.2, matching the "python queryExports is not a silent []" validation note) — correctly flagged as intentional in the executor report, not something this review disputes, but it is a real compatibility break worth naming for anyone downstream still expecting `[]`.

## Mock handoff correctness

`session-root-divergence.spec.ts:26-28` and `ast-namespace.builder.spec.ts` both add `import 'reflect-metadata'` before `jest.mock(..., () => ({ ...jest.requireActual(...), <overrides> }))`. `jest.requireActual` bypasses the mock factory recursion correctly (Jest hoists `jest.mock` but `requireActual` inside the factory reads the real module), and spreading it first means only the explicitly listed keys (`EXTENSION_LANGUAGE_MAP`, etc.) are overridden — `classifyFileForCoverage`, `hasCapability`, `languageForExtension`, `supportedLanguagesFor` come from the real registry, so a bug in those functions cannot be masked by a stale hand-written stub. Confirmed no other keys are redefined in a way that would shadow the real exports. This cannot hide a real failure: if the real module's export shape changed incompatibly, `jest.requireActual` would surface it at mock-construction time, not silently degrade.

## Edge cases

| Case | Handled | How | Concern |
|---|---|---|---|
| TS file with syntax error | YES | `recovered`, `failed:1` | none |
| `.kt`/unrecognised extension | YES | throws with `unrecognised`/coverage embedded | none |
| `.mjs` (recognized language, no capability) | YES | throws `unsupported` | none |
| Empty file | YES | `ok`, `errorNodeCount:0`, no tree allocated | none |
| Huge clean file | YES | O(1) short-circuit via root `hasError` | none |
| Huge malformed/wide-error file | PARTIAL | bounded final count, but per-generation enqueue can spike before the cap applies | Moderate — see Failure modes |
| Missing metadata (other producers of `CodeInsights`) | YES | defaults to `unknown`/`null`/`false` at both consumption points | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the unbounded per-generation child enqueue in `parseQuality` on a pathological wide/flat error tree (tree-sitter-parser.service.ts:70-79) — narrow, not a correctness bug, but worth a follow-up fix.
- What a robust implementation would add: cap enforcement inside the inner child-push loop (not just the outer while condition); extension of `parseStatus`/`coverage` honesty to `parse`/`queryFunctions`/`queryClasses`/`queryImports` in a follow-up batch.
