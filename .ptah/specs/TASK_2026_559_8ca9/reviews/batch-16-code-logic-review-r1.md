# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 16, r1, Lane A. Review date: 2026-09-26.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 1              |
| Failure modes found | 2              |

The 1,539-character definition meets the size target, and validation remains fail-closed. However, the advertised schema now delegates essential authoring constraints to help that omits them. This separates the score from 7–8: common inputs cannot be reliably authored from the advertised contract and its designated help. It is above 3–4 because enforcement, routing, size guards and existing verification work; no production validation bypass was found.

Paths below are relative to this worktree. Abbreviations:

- `M` = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core`
- `N` = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders`
- `C` = `libs/shared/src/mcp-apps-contracts`

Scope: the four files named in the executor report, read in full: `M/dashboard-propose-spec.tool.ts`, its spec, `M/surface-tools.spec.ts`, and `N/system-namespace.builders.ts`. Supporting reads covered the complete Zod contract and dashboard namespace, catalog, fixture builders, help assembly, sandbox bridge, and dispatcher paths. Context Decisions 4 and 17 and Batch 16 were read. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder; the batch and its referenced research supply the design. `ptah_search_files` returned zero AGENTS.md files; local discovery also found none. There is no listed direct file-read or Write tool; native read/write commands were used. No source edits or git operations were performed. Consequently, the executor's HEAD measurements, removed-test descriptions and four-file change inventory were not independently diff-verified.

## Five logic questions

### 1. How does this fail silently?

The test checker can silently accept an unknown `toString` property on a closed argument object because it reads inherited properties from its schema property map (`M/dashboard-propose-spec.tool.spec.ts:178`). This creates false confidence in the drift check, not a production validation bypass. Runtime invalid component input remains visibly rejected before broadcast (`N/dashboard-namespace.builder.ts:265`, `M/protocol-dispatcher.ts:1908`).

### 2. What user action produces unexpected behaviour?

An agent reads the mandated help, then submits a stat with `delta: '+5%'`, a table with `align: 'start'`, or a list item with a string `detail`. All fit the under-specified help at `N/system-namespace.builders.ts:79`, `:82` and `:85`; Zod rejects the entire dashboard. The help calls itself the full contract at `:61`.

### 3. What input data produces a wrong answer?

An otherwise valid argument with an own JSON key `toString: 1` produces the wrong answer from the structural checker: zero violations despite `additionalProperties: false` (`M/dashboard-propose-spec.tool.spec.ts:178`). The same payload is rejected by Zod. Ordinary `extra: 1` is correctly rejected by the checker. No new production wrong-answer path was established.

### 4. What happens when a dependency fails?

Help is local static text, not a network dependency (`N/system-namespace.builders.ts:638`). The real sandbox successfully returned its 3,415-character dashboard topic in a temp probe. Delivery failures remain separate from accepted results (`N/dashboard-namespace.builder.ts:296`; `M/protocol-dispatcher.ts:1918`), and no attached surface is an intentional text-only success (`N/dashboard-namespace.builder.ts:143`, `:159`). The changed builder adds no async work, listeners or resources (`M/dashboard-propose-spec.tool.ts:104`). This review did not inject a live host failure or certify every pre-existing dispatcher failure path.

### 5. What is missing that the requirements never mentioned?

Once help is the only detailed contract, its nested types, conditional requirements, identifier syntax and enum values need executable authoring examples, not only substring checks (`M/dashboard-propose-spec.tool.spec.ts:393`). The fixture called “every kind” omits bar-chart: it uses `makeChart`, which constructs only line-chart (`libs/shared/src/testing/fixtures/dashboard-spec.ts:123`, `:133`). Referenced-data variants are also absent from `VALID_SPECS` (`M/dashboard-propose-spec.tool.spec.ts:208`). These are coverage limitations associated with finding 1, not additional counted failure modes.

## Failure modes

### 1. Serious — The replacement help does not describe the enforced contract

- Trigger: Follow the tool's mandatory help pointer and author an ordinary chart, stat, table, list, identifier or action using the documented field names.
- Symptom: The advertised schema accepts the payload, but Zod rejects the whole dashboard; the agent must infer constraints through failed calls.
- Evidence: `M/dashboard-propose-spec.tool.ts:110` delegates detail; `N/system-namespace.builders.ts:61` claims a full contract. `:79` omits unit/delta types; `:80` omits name/x/y types; `:82` omits the alignment enum and minimum column count; `:85` omits the detail shape; `:93` marks URL optional without explaining its action-dependent requirement/prohibition. No identifier grammar is given at `:72` or `:76`.
- Current handling: Zod still enforces slug syntax (`C/dashboard-spec.schemas.ts:76`), numeric delta (`:264`), numeric y (`:161`), alignment left/center/right (`:180`), rich-text detail (`:196`), and required URL for open-url / forbidden URL on other actions (`:124`). Neither the compact schema nor help conveys several of these rules.
- Reproduction: Temp probe against actual source found zero advertised-schema violations but Zod rejection for component id `Total users`, delta `+5%`, chart y `"3"`, alignment `start`, list detail `"detail"`, and open-url without URL. A valid control passed both checks. These examples are all-or-nothing rejections, not silent rendering errors.
- Recommendation: Complete the on-demand help with exact primitive types, enum alternatives, slug syntax, closed-object rule, action URL conditional, params value types, and optional fields/array limits. Keep the compact schema. Add table-driven help-guided valid examples and corresponding rejected examples, including all five kinds, data references and actions. Tests must fail on this r1 help, rather than merely asserting its current wording appears.

### 2. Moderate — Structural checker treats inherited schema properties as declared keys

- Trigger: Pass JSON with a property named `toString`, `constructor`, or another Object.prototype member into a closed object schema.
- Symptom: `conformsTo` returns no unknown-key violation, falsely reporting schema conformance.
- Evidence: `M/dashboard-propose-spec.tool.spec.ts:170` uses a normal object for the properties map; `:178` tests `properties[key]` rather than an own-property check. The inherited function is then passed into `conformsTo`, which finds no constraints. Required membership at `:175` also uses inherited membership.
- Current handling: The keyword allowlist at `:329` checks schema keywords, not correctness of checker semantics. The invalid fixture loop at `:351` invokes only Zod, so it does not detect this defect.
- Reproduction: JSON-parsed `{ spec: <valid spec>, toString: 1 }` returns `[]` from the checker and is rejected by Zod. Controls `{}`, `{spec:4}`, and `{spec:<valid>,extra:1}` correctly produce checker errors.
- Recommendation: Use own-property checks for schema properties and required keys. Add negative checker cases for missing keys, wrong types, bounds, enums, ordinary extra keys and prototype-named extra keys. No production change is needed for this finding.

## Blocking issues

None established within this batch.

## Serious issues

Finding 1, `N/system-namespace.builders.ts:79`: common help-guided inputs are rejected. Complete the delegated contract and pin authoring cases before acceptance.

## Moderate and minor issues

Finding 2, `M/dashboard-propose-spec.tool.spec.ts:178`: the checker falsely accepts certain unknown JSON keys. Correct own-property handling and add negative checker tests. Missing bar-chart/data-reference coverage is recorded under finding 1, without inflating the defect count.

## Data flow

1. OK — Tools/list constructs both execute_code and the dashboard definition unconditionally (`M/protocol-dispatcher.ts:396`, `:410`). No namespace toggle hides the required help access path.
2. GAP — The compact definition delegates component detail to help (`M/dashboard-propose-spec.tool.ts:110`); help is incomplete (finding 1).
3. OK — PtahAPI installs the actual help builder (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:880`). execute_code forwards that API into the engine (`M/protocol-dispatcher.ts:3183`); the engine describes it and builds the bridge (`M/code-execution.engine.ts:284`, `:294`). The exact instructed `return ptah.help('dashboard')` worked through the real engine in the temp probe.
4. OK — The dispatcher forwards spec and caller context to the namespace (`M/protocol-dispatcher.ts:1900`). The namespace validates before rendering/broadcast (`N/dashboard-namespace.builder.ts:265`, `:280`, `:283`). This batch does not alter validation.
5. OK — Rejected and delivery-failed outcomes become tool errors, accepted outcomes return text (`M/protocol-dispatcher.ts:1908`, `:1918`, `:1930`).
6. GAP — Tests check only successful advertised fixtures, while invalid fixtures exercise Zod alone (`M/dashboard-propose-spec.tool.spec.ts:337`, `:351`), leaving finding 2 undetected.

## Required fields and enum inventory

Every row is checked against `C/dashboard-spec.schemas.ts` and the advertised/help pair.

| Zod contract                                                                                                                                    | Location               | Advertised schema / help coverage                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arguments require spec; envelope requires schemaVersion, catalogVersion, specId, revision, generatedAt, title, components                       | :432, :493             | All required names advertised; envelope/argument objects closed. Version enums and positive integer revision advertised. ISO timestamp delegated to help :72. Slug grammar omitted.                                   |
| Text requires string text; optional format enum plain; strict object                                                                            | :97                    | Advertised title/description require text but do not type it. Help :89 says plain text; omitting format is safe, but the optional format field is undocumented.                                                       |
| Component requires id and kind; kinds stat, line-chart, bar-chart, table, list                                                                  | :219, :369             | Id/kind and enum advertised; optional shared fields and children delegated at help :76. Unique ids documented; slug syntax omitted.                                                                                   |
| Stat requires value string/number; unit string, delta number optional                                                                           | :258                   | Value type delegated correctly at help :79; unit/delta types omitted.                                                                                                                                                 |
| Both chart kinds require exactly one of series/data; series entries require name string and points; points require x string/number and y number | :158, :166, :269, :300 | XOR and required nested names delegated at help :80; scalar types omitted. Optional xLabel/yLabel omitted.                                                                                                            |
| Table requires nonempty columns; each column requires slug key, rich label; align enum left/center/right; exactly one of rows/data              | :175, :310             | Column names, scalar cells, width rule and XOR delegated at help :82. Alignment enum, slug grammar and nonempty columns omitted.                                                                                      |
| List requires exactly one of items/data; item requires rich text; detail rich text, URL string optional; ordered boolean optional               | :193, :340             | XOR and item text shape delegated at help :85; detail/ordered types omitted.                                                                                                                                          |
| Data requires slug resultId; optional nonnegative integer rowCount, boolean truncated                                                           | :149                   | resultId required name delegated at help :81; syntax and optional fields omitted.                                                                                                                                     |
| Action requires action enum and rich label; URL required for open-url and forbidden otherwise; params record values string/number/boolean       | :110                   | Names, complete action allowlist and URL scheme rule at help :93; conditional URL rule and params shape omitted.                                                                                                      |
| Components/tree/string/rows/columns/points/bytes limits; strict objects; actions and series arrays max 200                                      | :217, :223, :273, :452 | Numeric headline limits included through describeDashboardLimits at help :98. Strict nested objects and action/series count limits omitted; list items also use row limit but help does not explain that association. |

The schema's intentional permissiveness is authorized by Task 16.1. Finding 1 concerns detail lost from BOTH discovery surfaces, not failure to reproduce all of Zod in the compact schema.

## Requirements fulfilment

| Requirement                                              | Status                         | Gap                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.1 minimal ref-free top-level schema and required keys | COMPLETE                       | Current definition is 1,539 chars; no refs/definitions; required envelope key comparison exists (`M/dashboard-propose-spec.tool.spec.ts:312`).                       |
| 16.1 detailed contract via reachable dashboard help      | PARTIAL                        | Runtime path verified; content incomplete, finding 1.                                                                                                                |
| 16.1 Zod remains enforcement point                       | COMPLETE                       | Validation precedes delivery; production validator unchanged (`N/dashboard-namespace.builder.ts:265`).                                                               |
| 16.1 valid fixture checks and invalid Zod checks         | PARTIAL                        | Existing represented fixtures run; checker has finding 2, and extra branch coverage is incomplete.                                                                   |
| 16.2 dated baseline +5% guards                           | COMPLETE                       | 65,190/2,141 and 2026-09-26 at `M/surface-tools.spec.ts:61`; ceilings 68,449/2,248 pinned at :87. Independent HEAD measurement was outside permitted git operations. |
| 16.2 surface-tools.ts unchanged                          | PARTIAL (evidence limitation)  | Executor reports unchanged; no git comparison performed.                                                                                                             |
| Decisions 4/17                                           | COMPLETE within reviewed scope | Help amendment supports the approved delegation; scoped independent review and checks completed. No frozen prompt edit identified in reported scope.                 |

Implicit requirements not addressed: a genuinely complete, usable on-demand contract and negative self-tests for the structural checker.

## Removed specs and client compatibility

The executor reports removing generated-schema equality and named-definition/ref tests. Those assertions conflict with the approved ref-free design, so retaining them at the tool boundary would be incorrect. Recursive validation itself remains in `C/dashboard-spec.schemas.ts:369`; required envelope parity remains tested at `M/dashboard-propose-spec.tool.spec.ts:312`. The replacement loses automatic nested discoverability, which must now be supplied by help (finding 1).

Searches found no production consumer in libs/apps hard-coding `definitions.DashboardComponent` from the advertised dashboard tool. The current definition contains no dangling reference (`M/dashboard-propose-spec.tool.ts:43`). No specific client break is established. External schema-driven clients and every deployed host were not exercised; do not interpret the repository search as universal client certification.

## Edge cases

| Case                                          | Handled                          | How                                      | Concern                                        |
| --------------------------------------------- | -------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Empty/missing spec                            | YES                              | Invalid fixtures and runtime validator   | Checker rejects these controls too.            |
| Unknown versions/kind, revision below 1       | YES                              | Advertised enums/minimum and Zod         | Checker negatives should explicitly pin these. |
| Duplicate ids, missing stat value, unsafe URL | YES                              | Zod rejection fixtures                   | Help missing other common restrictions.        |
| Nested components/large inputs                | YES                              | Recursive validation and existing limits | Help does not describe every array limit.      |
| Repeated/concurrent proposals                 | Unchanged                        | Same namespace/store path                | No new state or race introduced by this batch. |
| Dependency failure/no surface                 | YES in inspected path            | Explicit failure outcome / text fallback | No live-host fault injection.                  |
| Prototype-named extra JSON key                | NO in checker                    | Incorrect inherited lookup               | Production Zod still rejects.                  |
| Bar-chart and referenced data authoring       | Not covered by new fixture table | Zod branches exist                       | Add representative valid cases.                |

## Verification

All commands ran once from the assigned worktree, with output tails and no source modifications:

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: PASS, exit 0 (32.6 s).
- `nx run degradation-audit:lint --skip-nx-cache`: PASS, exit 0; TOTAL 300.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: PASS, exit 0; all external imports covered. New help/description text contains no bare `from "<word>"` import-like phrase.
- Scoped `ptah_get_diagnostics` on the absolute dashboard tool path: TypeScript compiler provider, 0 errors, 0 warnings. Local Nx typecheck independently passed.
- Temp probe: actual TypeScript source transpiled in memory; actual Zod schemas and structural-checker code executed. Six help-gap payloads passed the advertised outline and failed Zod; valid control passed. Prototype-named extra key falsely passed the checker; ordinary missing/type/extra-key controls failed as expected.
- Temp probe: real buildHelpMethod plus real executeCode engine returned dashboard help, 3,415 characters. Unrelated imports were stubbed for loading; this proves sandbox method reachability, not a launched VS Code/Electron/CLI transport integration.
- Probe location: OS temp `ptah-b16-review.cjs`; no probe file created under the worktree.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the two reproduced defects; MEDIUM for external-client compatibility and HEAD change inventory.
- Top risk: Agents obeying the new help pointer still lack the constraints needed to build valid ordinary dashboards.
- What a robust implementation would add: complete nested authoring contract in help, representative valid/invalid examples for all kinds and action/data variants, and own-property-safe checker logic with negative tests.
