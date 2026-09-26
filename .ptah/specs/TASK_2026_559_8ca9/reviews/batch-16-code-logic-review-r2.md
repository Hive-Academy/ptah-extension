# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 16, review r2 after revision round 1, Lane A. Date: 2026-09-26.

| Metric              | Value                            |
| ------------------- | -------------------------------- |
| Overall score       | 8/10                             |
| Assessment          | APPROVED                         |
| Blocking issues     | 0                                |
| Serious issues      | 0                                |
| Moderate issues     | 0                                |
| Failure modes found | 0 new; both r1 findings resolved |

The six r1 authoring gaps are now explained by the generated help, and the checker rejects prototype-named unknown keys. Scoped tests, lint, typecheck, diagnostics, degradation audit and Electron dependency validation pass. The score is 8 rather than 9–10 because the drift guards remain syntactic safeguards, not proof of semantic completeness, and this review did not launch all three packaged applications.

All paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`:

- `M`: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core`
- `N`: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders`
- `C`: `libs/shared/src/mcp-apps-contracts`

Scope: the original four Batch 16 files plus new `N/dashboard-contract-help.ts`, and the executor report's Revision round 1. The new renderer and revised spec were read in full; original files and the enforcement/routing paths retain the full-file review context from r1. The unchanged contract, package/build configuration and sandbox path were cross-checked where material. No source edits or git operations were performed. No independent HEAD diff was obtained; scope and unchanged-source claims rely on the supplied inventory. Task metadata and unrelated language-plan work were not edited. Repository instruction discovery from r1 found no AGENTS.md; no additional instruction file was supplied for r2.

## r1 findings status

| Finding                                                 | Status   | Evidence and validation                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 Serious — help omitted Zod-enforced authoring rules  | RESOLVED | `N/dashboard-contract-help.ts:87` converts actual Zod schemas; :151 preserves required/optional fields; :181 renders patterns; :229 names nested shapes. Conditional URL and data-source rules are explicit at :47. The six original rejection probes still fail Zod as intended, but every rejection is now explained in help. Correcting each according to help produces six accepted controls. Regression assertions are at `M/dashboard-propose-spec.tool.spec.ts:570`. |
| M1 Moderate — checker accepted inherited property names | RESOLVED | `M/dashboard-propose-spec.tool.spec.ts:184` uses own-property checks for both required membership and declared properties. The original JSON `toString` extra-key probe now returns `$: unexpected key toString`. Tests at :704 cover constructor, **proto**, toString, hasOwnProperty and valueOf; :719 covers a nested envelope key; :729 adds ordinary negative controls.                                                                                                |

## New defects

No R2 defect established. No quota-driven findings are added. The limitations below constrain confidence; they are not demonstrated current runtime failures.

## Five logic questions

### 1. How does this fail silently?

No new success-looking failure was reproduced. The previous checker false acceptance is fixed (`M/dashboard-propose-spec.tool.spec.ts:184`). Runtime enforcement still precedes rendering and dispatch (`N/dashboard-namespace.builder.ts:265`). The renderer returns unknown-keyword diagnostics (`N/dashboard-contract-help.ts:294`) and the suite asserts they are empty (`M/dashboard-propose-spec.tool.spec.ts:511`). This assertion is a development guard, not runtime error reporting or a universal proof that every possible future schema is expressible.

### 2. What user action produces unexpected behaviour?

None established on the reviewed common authoring paths. Help now documents slug ids, numeric delta/y, alignment choices, rich-text detail and the conditional action URL. The six r1 inputs still correctly reject, while help-corrected inputs all accept. Evidence: generated field rendering at `N/dashboard-contract-help.ts:151`, primitive rendering at :181/:199, and URL rule at :52; the paired rejection tests start at `M/dashboard-propose-spec.tool.spec.ts:570`.

### 3. What input data produces a wrong answer?

No new production wrong-answer input found. Prototype-named JSON keys no longer fool the structural checker (`M/dashboard-propose-spec.tool.spec.ts:190`). Empty/missing input, wrong types, unknown version, low revision and empty components are pinned at :729. The advertised outline intentionally accepts more than Zod: nested restrictions are delegated to help, as authorized by Task 16.1 (`M/dashboard-propose-spec.tool.ts:110`). That is not itself schema drift.

### 4. What happens when a dependency fails?

The new dependency usage is the existing Zod 4 package's `z.toJSONSchema`, not zod-to-json-schema or a network operation (`N/dashboard-contract-help.ts:22`, :88). Generation occurs once during module initialization (`N/system-namespace.builders.ts:39`). An incompatible future schema/converter could throw during module load; current schemas and installed Zod execute successfully in the test suite and independent probe. There is no new catch that converts such a failure into misleading help. Existing dashboard delivery failures remain errors, and deliberate no-surface hosts retain text output (`M/protocol-dispatcher.ts:1908`, :1918, :1930; `N/dashboard-namespace.builder.ts:143`).

### 5. What is missing that the requirements never mentioned?

A refinement-site counter cannot prove that existing refinement bodies still match their prose. `M/dashboard-propose-spec.tool.spec.ts:561` pins seven literal call sites; :562 separately pins seven rule entries. These are not a one-to-one semantic mapping: some entries combine multiple refinements and one describes the byte budget. A rule changed inside an existing callback would need an explicit regression test/review. Current callbacks were compared with the prose at `N/dashboard-contract-help.ts:47`; the current data-source, chart-total, table-width, action-URL and tree checks are represented.

## Refinement guard sensitivity

The guard is real for the requested case. The exact regex used at `M/dashboard-propose-spec.tool.spec.ts:561` reports 7 on the current source. Appending a syntactically ordinary eighth `.refine(...)` to an in-memory copy reports 8, which fails the unchanged `toHaveLength(7)` assertion. Neither source nor test files were mutated.

Limit: this is a textual tripwire. It does not prove a newly documented rule is correct, detect a changed existing callback, or cover every alternative formatting/construction of refinements. The schema walk at :489 also checks names/values/patterns globally rather than verifying a path-by-path semantic contract. The actual rendered output was inspected in addition to trusting those tests.

## Schema and help coverage

| Contract area                                                                                | Evidence                                    | Result                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Arguments/envelope, required keys, versions, positive revision, timestamp, title             | `N/dashboard-contract-help.ts:219`, :279    | Rendered from the same input schema; date-time expressed as ISO with Z/offset.                                           |
| All five kinds and recursive shared fields                                                   | :247, :267, :282                            | Required status preserved when extracting shared fields; children refer to the declared DashboardComponent.              |
| Stat value/unit/delta; chart series and x/y; table columns/rows/alignment; list items/detail | :229, :267                                  | Types, enums, named nested objects and array bounds present in the inspected output.                                     |
| Actions, Text, DataRef, Series, Column, ListItem                                             | :229, :289                                  | All named shapes defined; no dangling current reference.                                                                 |
| Closed objects and default string budget                                                     | `N/system-namespace.builders.ts:74`         | Stated globally; params record explicitly shows its permitted dynamic keys and scalar values.                            |
| Non-schema rules and byte budget                                                             | `N/dashboard-contract-help.ts:47`           | XOR data sources, chart point sum, row width, URL conditional/scheme, total count/depth/uniqueness and bytes documented. |
| Broader valid fixtures                                                                       | `M/dashboard-propose-spec.tool.spec.ts:243` | Bar-chart, reference variants, optional alignment/unit/delta/params now included and pass.                               |

No remaining common-case omission comparable to r1 S1 was established. This is not a claim that prose duplicates every low-level parser nuance of ISO dates, URL parsing or numeric representation.

## Runtime, packaging and cost

- The real help builder is installed on PtahAPI (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:880`). execute_code passes that API into the engine (`M/protocol-dispatcher.ts:3183`); the bridge exposes it (`M/code-execution.engine.ts:284`, :294). The exact `return ptah.help('dashboard')` returned the new text through the real engine in an OS-temp probe. No schema or Zod object crosses into the sandbox; the caller receives text.
- Zod is already pinned to 4.6.5 in the root package (`package.json:197`), Electron runtime package (`apps/ptah-electron/package.json:54`) and CLI runtime package (`apps/ptah-cli/package.json:90`). Electron/CLI externalize it (`apps/ptah-electron/project.json:64`, `apps/ptah-cli/project.json:61`). VS Code bundles third-party dependencies and does not externalize Zod (`apps/ptah-extension-vscode/project.json:26`, :27, :36). No new converter package is required.
- Electron validate-deps depends on build-main (`apps/ptah-electron/project.json:408`) and passed against the bundle. No import-like `from "<word>"` problem was found in the new text.
- Generation is once per module load, not per help call (`N/system-namespace.builders.ts:39`). The current bounded schema is rendered synchronously; 100 direct generations took approximately 360–400 ms in the local probe, roughly 3.6–4 ms each. This is a diagnostic sample, not a production performance guarantee. No timers, listeners, accumulated cache or input-driven growth are introduced.
- The tool remains 1,539 characters. The local transpile probe measured help at 4,958 characters versus the author's 4,953; either is on-demand and below the task's default 8k character budget. Only the tool definition has a 3,000-character acceptance ceiling.
- Packaged VS Code, Electron and CLI processes were not each launched. Evidence is source wiring, the real sandbox/source probe, package configuration and the requested Electron build/dependency check, not a three-host installation test.

## Data flow

1. OK — tools/list builds the compact schema and execute_code entry (`M/protocol-dispatcher.ts:396`, :410).
2. OK — module initialization derives help shape from Zod once (`N/system-namespace.builders.ts:39`; `N/dashboard-contract-help.ts:219`).
3. OK — help combines generated structural detail with explicit refinement rules (`N/system-namespace.builders.ts:78`, :81).
4. OK — execute_code returns the topic through the API bridge (`M/protocol-dispatcher.ts:3183`).
5. OK — proposal validation still runs before render/broadcast (`N/dashboard-namespace.builder.ts:265`, :280, :283).
6. OK — rejection/delivery failure remain error results; accepted output remains text (`M/protocol-dispatcher.ts:1908`, :1918, :1930).

## Requirements fulfilment

| Requirement                                                      | Status             | Evidence / limits                                                                                             |
| ---------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| 16.1 minimal ref-free advertised schema, top-level required keys | COMPLETE           | `M/dashboard-propose-spec.tool.ts:43`; assertions at spec :356/:366.                                          |
| 16.1 tool JSON <= 3,000 chars                                    | COMPLETE           | Independent measurement 1,539; spec :340 passes.                                                              |
| 16.1 reachable detailed dashboard help                           | COMPLETE           | Generated content and sandbox probe; r1 S1 resolved.                                                          |
| 16.1 Zod enforcement and valid/invalid fixture guards            | COMPLETE           | Expanded fixtures pass; r1 M1 fixed; production validator unchanged in supplied scope.                        |
| 16.2 dated surface growth guards                                 | COMPLETE           | `M/surface-tools.spec.ts:61`/ :62 retain 65,190/2,141 dated 2026-09-26; :87/:88 pin 68,449/2,248. Tests pass. |
| surface-tools.ts unchanged                                       | REPORTED UNCHANGED | No git comparison performed under read-only reviewer rules.                                                   |

## Edge cases

| Case                                              | Handled         | Evidence / remaining concern                                                                            |
| ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| Missing/wrong primitive/enumeration inputs        | YES             | Checker negatives at `M/dashboard-propose-spec.tool.spec.ts:729`; production Zod remains authoritative. |
| Prototype-named unknown keys                      | YES             | Own-property logic at :184 and negative cases at :704/:719.                                             |
| Empty table columns, short rows, XOR data sources | YES             | Documented and rejection cases at :645/:655/:660.                                                       |
| Nested nodes and reference data                   | YES             | Recursive schema rendered; valid fixtures at :243/:285.                                                 |
| Repeated help calls                               | YES             | Cached module-level string, no regeneration or resource accumulation.                                   |
| New eighth ordinary refinement                    | YES, test fails | Exact counter changes 7 to 8; semantic edits inside existing callbacks remain a review responsibility.  |
| Converter failure after future contract changes   | Not suppressed  | Could fail module initialization; current conversion passes.                                            |

## Failure modes / issue sections

No new failure mode substantiated. No Blocking, Serious, Moderate or Minor issue is being raised. Current scope and residual uncertainty are documented above rather than presenting test success as universal correctness.

## Verification

Commands executed once in the assigned worktree, output tailed:

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: PASS, exit 0, 26.8 seconds.
- `nx run degradation-audit:lint --skip-nx-cache`: PASS, exit 0; TOTAL 300.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: PASS, exit 0, including its build-main dependency; all external imports covered.
- Scoped `ptah_get_diagnostics` for new dashboard-contract-help.ts: TypeScript compiler, zero errors/warnings.
- OS-temp source probe: all six r1 invalid payloads remain rejected; their six help-corrected counterparts all accepted; original toString checker bypass now rejected; real sandbox help reached; tool 1,539 chars; help 4,958 chars; unhandledKeywords empty.
- In-memory refinement-site sensitivity check: current 7; eighth ordinary refine produces 8. No production file modified and no mutation-test suite falsely claimed.
- The author's reported fails-before results were read but not independently rerun against old source. No source rollback, checkout, staging, commit or stash occurred. Probe files remained under OS temp; only this deliverable was overwritten in the worktree.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for resolving S1/M1 and the current authoring contract; MEDIUM for complete packaged-host integration.
- Top risk: future semantic changes inside existing refinements can outgrow their prose without changing the syntactic counter.
- What a robust implementation would add: when refinements change, paired valid/rejected fixtures for the actual new behaviour; periodic packaged-host smoke coverage. Neither is an outstanding fix required for this batch.
