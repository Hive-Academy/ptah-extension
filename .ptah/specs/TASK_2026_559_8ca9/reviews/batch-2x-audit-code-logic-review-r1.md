# Code Logic Review — TASK_2026_559_8ca9

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Batch               | 2x-audit — unstaged remediation only |
| Overall score       | 5/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Verdict             | REVISE                               |
| Blocking issues     | 1                                    |
| Serious issues      | 1                                    |
| Moderate issues     | 0                                    |
| Failure modes found | 2                                    |

The build remediation and marker placement work. The only executable production change, the warning at protocol-dispatcher.ts:2407, introduces unrestricted error-text logging and a new escape from the guarded spool-root fallback. These regressions prevent the sound 7–8 band; the otherwise working scoped changes and passing checks distinguish this from foundational 1–4 failures.

Scope: the ten user-named unstaged files. The four staged Batch 5 files were excluded. Read the executor report, context, task carrier and relevant batch contracts; traced the production code, tests, parser, logger and build dependencies. No task-description.md, implementation-plan.md or code-style-review.md was present in the task folder. ptah_search_files("**/AGENTS.md") returned zero files; native discovery also found no AGENTS.md/CLAUDE.md. No source edits, staging operations or raw session-log reads were performed.

Paths are repository-relative. Below, mcp/ means libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/ and reducers/ means libs/backend/tool-output-reducers/src/lib/.

## Five logic questions

### 1. How does this fail silently?

An ordinary provider-failure response still looks successful while its error message is copied verbatim into the warning at mcp/protocol-dispatcher.ts:2408. A path or credential reaches the log without indication to the caller (B1). The intended fallback is legitimate: resolveSpoolRoot selects system temp at line 2395, not a caller-declared directory.

Other declarations describe intended detection/fallback or reporting of the primary failure; see the per-site audit.

### 2. What user action produces unexpected behaviour?

An over-budget successful tool call while the workspace provider and warning sink fail becomes a tool error instead of a capped result with a temp-file locator. Root resolution happens before applyToolResultBudget is entered (mcp/protocol-dispatcher.ts:2351). The new warning throws at line 2407; the individual-tool catch reports failure at line 2167 (S1). Small responses avoid root lookup at line 2338.

### 3. What input data produces a wrong answer?

A provider throwing Object.create(null), or an Error with a throwing message getter, prevents knownWorkspaceFolders from returning [] (mcp/protocol-dispatcher.ts:2408). The caller receives failure for an operation that already succeeded. An ordinary Error with a private path/token produces B1. In-memory probes of the actual extracted function reproduced these cases.

No semantic changes were found in reduce-output.ts or tool-result-budget.ts: TypeScript AST structure, including literal values, matches the index versions after ignoring trivia.

### 4. What happens when a dependency fails?

- JSON rejection returns false and continues detection (reducers/content-detector.ts:118).
- Parser rejection returns null, taking the code-to-log fallback (mcp/code-outliner.adapter.ts:176; reducers/reducers/code.reducer.ts:129).
- Tokenizer precheck rejection delegates to the guarded budget helper (mcp/protocol-dispatcher.ts:2365; mcp/tool-result-budget.ts:210).
- Write failure is rethrown after best-effort cleanup, converted to a safe failure reason, and included in the trailer (mcp/tool-result-budget.ts:511, :525, :405).
- Workspace-provider failure works with an ordinary Error and functioning logger; logging/coercion failure escapes (mcp/protocol-dispatcher.ts:2407, S1).
- Generated Electron main imports marked and gpt-tokenizer using ESM; its compatibility shim does not rewrite these imports (apps/ptah-electron/project.json:27; apps/ptah-electron/esbuild.config.cjs:76).

### 5. What is missing that the requirements never mentioned?

The warning needs the observer isolation already established at mcp/protocol-dispatcher.ts:2505. Logging is a fallible dependency; thrown values are not necessarily safely coercible. The new test at mcp/protocol-dispatcher.spec.ts:2663 does not cover hostile exceptions or a failing warning sink. Privacy was explicitly requested and is an unmet requirement, not additional scope.

## Failure modes

### B1 — Provider error text exposes paths and secrets

- Trigger: workspace provider throws an Error or string containing a private path/token.
- Symptom: tool succeeds but its warning records that content verbatim.
- Evidence: mcp/protocol-dispatcher.ts:2408. Nearby safe classification deliberately avoids messages because they can carry paths/content (reducers/reduce-output.ts:153; mcp/tool-result-budget.ts:176).
- Current handling: unrestricted error.message / String(error) interpolation.
- Recommendation: constant warning, or guarded allowlisted classification; do not serialize the thrown value.

### S1 — Diagnostic failure replaces a successful result and prevents spooling

- Trigger: provider failure followed by a throwing warning sink, a throwing message getter, or a non-coercible exception.
- Symptom: no temp spool is created; ordinary tools return isError:true for an operation that succeeded. The execute_code success path can reach the outer JSON-RPC error handler.
- Evidence: mcp/protocol-dispatcher.ts:2407, :2351, :2148, :2562, :257.
- Current handling: warning invocation/interpolation lack protection; return [] is never reached.
- Recommendation: put the warning through runObserver, use constant/safely classified content, and return [] regardless of diagnostic failure.

## Blocking issues

### B1 — Raw error details violate the no-path/no-secret requirement

- File: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:2408.
- Scenario: provider throws new Error('C:/private/SYNTHETIC_SECRET_123').
- Impact: private diagnostic content enters logs. The direct reproduction confirmed that the captured warning contains the marker.
- Fix: emit a constant warning. Add Error/string privacy cases asserting no log contains the marker and temp spooling succeeds.

## Serious issues

### S1 — New warning breaks the established fallback contract

- File: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:2407.
- Scenario: provider throws and logger.warn throws; independently, a null-prototype value or hostile message getter fails during interpolation.
- Impact: a previously recoverable dependency error suppresses successful tool output and its raw spool. A caller can retry an already completed operation after receiving failure.
- Fix: protect the diagnostic with runObserver (:2505), including any classification inside its callback. Verify successful capped response, raw temp-file contents and refusal of unknown caller roots under each failure.

Reproduction extracted the actual function through TypeScript AST and transpiled it in memory with injected provider/logger stubs. Results: ordinary Error leaked the synthetic marker; null-prototype value threw "Cannot convert object to primitive value"; hostile getter threw "getter failure"; failing logger threw "logger failure". No test/source file was written.

## Moderate and minor issues

No moderate issue found.

Minor: the new outliner reason says null makes the code reducer "keep its plain cut" (mcp/code-outliner.adapter.ts:178). The actual immediate fallback calls reduceLog, which can select/deduplicate lines (reducers/reducers/code.reducer.ts:129, :161); the outer budget cuts if necessary. Describe that fallback accurately. This is not an additional runtime failure mode.

## Per-site declaration audit

All eight markers attach in supported locations: leading catch-body comments or, for promise.catch, directly above the containing statement. Scanner contract: tools/degradation-audit/check-degradation.ts:27. Executed lint passes without bare/orphaned suppression errors. Baseline is byte-equal to the index and has no unstaged diff.

| Site                             | Assessment                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reducers/content-detector.ts:119 | Honest optional predicate: invalid JSON continues sniffing.                                                                                                                                           |
| reducers/reduce-output.ts:273    | Honest classification of a failure already sent to logLine at :155. Reporting remains best effort through the optional output channel.                                                                |
| mcp/code-outliner.adapter.ts:177 | Optional outlining is honest; correct the minor fallback wording. Parser query errors reach _handleAndLogError (libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:650, :919). |
| mcp/protocol-dispatcher.ts:2366  | Honest optional fast-path check; null delegates to the guarded helper. A successful retry need not log a transient precheck failure.                                                                  |
| mcp/protocol-dispatcher.ts:2405  | Reports a real failure, but B1/S1 violate privacy and claimed continued spooling.                                                                                                                     |
| mcp/tool-result-budget.ts:515    | Cleanup is intentionally best effort. Reason explicitly identifies the original write error as rethrown/reported; it does not claim the secondary unlink failure is reported.                         |
| mcp/tool-result-budget.ts:651    | Honest: unreadable errno falls back to safe error-name reporting at :525.                                                                                                                             |
| mcp/tool-result-budget.ts:668    | Honest: hostile name getter becomes Error; trailer/log still reports primary failure.                                                                                                                 |

No baseline increase is needed to fix B1/S1.

## Data flow

1. OK: tool text reaches createToolSuccessResponse (mcp/protocol-dispatcher.ts:2302); within-budget responses bypass root lookup (:2338).
2. OK: large output consults host-owned folders (:2387); a declared root must exactly match a canonical known folder (:2390, :2420).
3. GAP B1/S1: provider catch invokes unrestricted, unguarded diagnostics (:2407), which can prevent the empty-list/temp fallback (:2395).
4. OK: reduction, raw spooling and final fitting remain unchanged (mcp/tool-result-budget.ts:254, :263, :265).
5. OK: exclusive writes and bounded collision retries preserve existing files; failures reach the trailer (:507, :510, :525, :405).
6. OK: final response/transcript use budgeted text with isolated observers (mcp/protocol-dispatcher.ts:2308, :2315).
7. OK: source-barrel aliases resolve reducers; generated main outputs use ESM imports for runtime packages.

## Build/runtime assessment

- Aliases follow neighboring source-barrel paths: apps/ptah-electron/tsconfig.build.json:50, apps/ptah-cli/tsconfig.build.json:47, apps/ptah-tui/tsconfig.build.json:47.
- Electron main is explicitly ESM/main.mjs (apps/ptah-electron/project.json:25, :27). Banner provides require for compatibility; the named-import rewrite plugin applies only to electron (apps/ptah-electron/esbuild.config.cjs:76).
- Inspected generated Electron main AST: marked uses a static Lexer/getDefaults import, gpt-tokenizer uses static encode imports, with no require/call-expression loads of either package. Existing uuid imports use the same ESM pattern. Adding marked to externals therefore does not introduce the proposed require(ESM) crash.
- Generated CLI and TUI main/tui ASTs likewise use native ESM imports for both packages, without require calls. Config: apps/ptah-cli/project.json:28, :67, :70; apps/ptah-tui/project.json:18, :55, :58. Runtime dependencies: apps/ptah-cli/package.json:70, :78. TUI shares that dist directory.
- VS Code uses ESM with thirdParty bundling (apps/ptah-extension-vscode/project.json:23, :27, :36). Its inspected generated main has no external import/require load for either package. Source imports: reducers/reducers/markdown.reducer.ts:30; reducers/token-measure.ts:8.
- Local ESM smoke test successfully invoked marked Lexer and gpt-tokenizer encode. Electron validate-deps passed; dependencies exist in apps/ptah-electron/package.json:34, :42.
- Executor rationale implying ESM-only code inherently cannot be bundled here is inaccurate: the main output is ESM. The actual externalization is nevertheless compatible with the existing loading/manifest pattern.

Residual uncertainty: no packaged Electron/VS Code GUI or isolated CLI tarball was launched. Existing CLI/TUI/VS Code dist artifacts were inspected, not independently rebuilt. The requested Electron validation and source configuration support the loading conclusion; dependency validation is not an application startup test.

## Requirements fulfilment

| Requirement                              | Status                          | Gap                                                  |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| Honest declarations/recognized placement | PARTIAL                         | Warning B1/S1; minor outliner reason correction      |
| Baseline unchanged                       | COMPLETE                        | Byte-equal to index                                  |
| Warning contains no paths/secrets        | MISSING                         | B1                                                   |
| Host-owned spool-root fallback preserved | PARTIAL                         | Trust rules unchanged; diagnostics can stop fallback |
| Formatting-only reducer/budget changes   | COMPLETE                        | ASTs identical ignoring trivia                       |
| Three build aliases                      | COMPLETE                        | Source-barrel paths preserved                        |
| marked/tokenizer ESM loading             | COMPLETE at config/bundle level | Packaged startup untested                            |
| Three requested Nx checks                | COMPLETE                        | All passed                                           |
| Literal pre-commit sequence              | PARTIAL                         | Read-only/scoped equivalents used                    |

Implicit requirement missed: observers must not replace successful responses (mcp/protocol-dispatcher.ts:2499).

## Edge cases

| Case                               | Handled | How                                           | Concern                                                     |
| ---------------------------------- | ------- | --------------------------------------------- | ----------------------------------------------------------- |
| Absent provider / no folders       | YES     | Empty list → temp, dispatcher:2401 / :2395    | Header inaccurately says absence is logged; only throws log |
| Ordinary provider Error            | YES     | Warn/temp fallback, spec:2663                 | B1 leaks error text                                         |
| Private message                    | NO      | Raw interpolation, dispatcher:2408            | B1                                                          |
| Throwing warning sink              | NO      | Escapes dispatcher:2407                       | S1                                                          |
| Hostile getter/non-coercible error | NO      | Escapes dispatcher:2408                       | S1                                                          |
| Unknown/UNC declared root          | YES     | Known-folder matching, dispatcher:2425        | Trust rules unchanged                                       |
| Malformed JSON                     | YES     | Predicate false, detector:118                 | Intentional                                                 |
| Missing parser/grammar             | YES     | Optional null, adapter:176                    | Log fallback before cut                                     |
| Spool write failure/collision      | YES     | Safe trailer/bounded retry, budget:511 / :525 | Cleanup best effort                                         |
| Hostile name/code getter           | YES     | Safe classification, budget:650 / :667        | No raw message echoed                                       |

## Verification

Executed from the requested worktree:

- nx run degradation-audit:lint --skip-nx-cache: exit 0; 300 unsuppressed sites globally, ratchet passes.
- nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools --skip-nx-cache: exit 0, all six targets passed (39.3 seconds). No real-port EACCES failure occurred.
- nx run ptah-electron:validate-deps --skip-nx-cache: exit 0; all external imports covered by package dependencies.
- ptah_get_diagnostics scoped to the changed libraries: zero errors/warnings.
- nx format:check --files=<the ten scoped files>: exit 0.
- TypeScript AST equivalence for reduce-output.ts and tool-result-budget.ts: both identical ignoring trivia. Initial emitted-text equality differed due to retained layout; AST comparison resolved that without treating formatting as semantics.
- In-memory fault injection and generated-bundle AST inspection: results above.

Commands used node_modules/.bin/nx. The literal hook was not run: .lintstagedrc.mjs:5 formats files, line 10 runs affected lint, and .husky/pre-commit:19 invokes lint-staged, which manipulates staged/unstaged content. Those mutations conflict with this read-only review and Batch 5 exclusion. Format:check, two-project lint, and explicit validate-deps (.husky/pre-commit:44) exercise relevant steps without index changes or workspace-wide lint.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for B1/S1 and scoped changes; packaged startup remains unexecuted.
- Top risk: the new warning leaks provider error text and can replace a successful result with failure before raw output is spooled.
- What a robust implementation would add: a constant/safely classified warning inside runObserver; privacy and hostile-error/logger regression cases preserving successful response and temp spooling; accurate outliner fallback wording.
