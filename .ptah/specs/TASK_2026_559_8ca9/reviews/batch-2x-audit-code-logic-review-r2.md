# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value                                  |
| ------------------- | -------------------------------------- |
| Batch               | 2x-audit, round 2                      |
| Overall score       | 8/10                                   |
| Assessment          | APPROVED                               |
| Verdict             | APPROVE                                |
| Blocking issues     | 0                                      |
| Serious issues      | 0                                      |
| Moderate issues     | 0                                      |
| Failure modes found | 0 remaining reproduced runtime defects |

Both round 1 runtime findings are fixed. The provider exception is never inspected or coerced; a fixed warning runs inside the existing observer guard, after which the empty-folder result selects system temp. Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:2408`, `:2409`, `:2415`, `:2395`, `:2509`. Independent fault injection and all three requested Nx checks passed.

The score is in the sound 7–8 band because the concrete privacy and result-preservation failures are closed and the requested verification passes. It is below 9–10 because exact unstaged-diff verification was unavailable under the review role's prohibition on Git operations, and packaged application startup was not exercised. These are review limits, not manufactured code defects.

Scope: the ten files identified by the round 1 review and executor report: six TypeScript files in the reducer/dispatcher path, three application build tsconfigs, and Electron project.json. The four staged Batch 5 files were not reviewed. Read the current scoped files, round 1 report, executor report, context, relevant batch contracts, audit scanner contract, and neighboring fallback/build code. Task-description.md, implementation-plan.md and code-style-review.md are absent from this task folder. `ptah_search_files("**/AGENTS.md")` returned zero files; native discovery also found none. No source/configuration edits or raw .jsonl/.sqlite session-log reads were performed. Only this review document was written; verification may generate ordinary build/test artifacts.

**Scope limitation:** the higher-priority role explicitly prohibits Git operations. Consequently, no `git diff` or index comparison was run. The ten-file unstaged scope and round 1 formatting-only/index-equality conclusions are attributed to the supplied review/report, not independently re-established in round 2. Approval applies to the identified remediation as observed; it does not certify that the entire current unstaged diff contains nothing else.

Paths below are repository-relative. `mcp/` means `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`; `reducers/` means `libs/backend/tool-output-reducers/src/lib/`.

## Round 1 findings

| Finding                                                                                   | Severity in r1     | Status    | Round 2 evidence                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1: warning logs raw provider error text, including private paths/secrets                 | Blocking           | fixed     | `mcp/protocol-dispatcher.ts:2408` discards the exception without inspecting it; `:2411` is constant text. Error and string secret probes produced no secret in captured warnings. Regression spec at `mcp/protocol-dispatcher.spec.ts:2691` passed in the requested suite.                       |
| S1: warning/coercion failure escapes before temp spooling, replacing success with failure | Serious            | fixed     | `mcp/protocol-dispatcher.ts:2409` invokes `runObserver`; its catch at `:2512` isolates the warning failure, and `:2415` still returns `[]`. All hostile-value/throwing-logger probes preserved the temp root. Real filesystem spool regression at `mcp/protocol-dispatcher.spec.ts:2720` passed. |
| Outliner reason says the reducer keeps a plain cut                                        | Minor wording note | not fixed | `mcp/code-outliner.adapter.ts:178` still has this wording; null actually enters the log fallback (`reducers/reducers/code.reducer.ts:129`, `:161`) before the outer cut. This remains an explanatory wording issue, not a reproduced runtime defect or a reason to revise this remediation.      |

## Five logic questions

### 1. How does this fail silently?

No remaining silent runtime failure was reproduced in the remediation. Provider failure attempts a fixed warning (`mcp/protocol-dispatcher.ts:2410`). If the logging sink itself fails, `runObserver` deliberately swallows that observer failure (`:2512`); it preserves the already successful operation. This best-effort diagnostic behavior matches neighboring observer handling (`:2308`, `:699`). A later spool-write failure is separately surfaced in the returned trailer (`mcp/tool-result-budget.ts:405`, `:525`), so choosing temp does not falsely imply a file was saved.

### 2. What user action produces unexpected behaviour?

The r1 trigger—an oversized successful tool result while the workspace provider and warning sink fail—no longer stops root selection. Root resolution returns system temp at `mcp/protocol-dispatcher.ts:2395`, and the caller enters the budget helper at `:2347`. The regression spec at `mcp/protocol-dispatcher.spec.ts:2720` verifies byte-equal raw spooling under the mocked system temp directory. No new unexpected action was reproduced. Small results bypass the provider (`mcp/protocol-dispatcher.ts:2338`).

### 3. What input data produces a wrong answer?

The previous non-coercible thrown object and throwing `message` getter no longer change the outcome: `void error` at `mcp/protocol-dispatcher.ts:2408` performs no coercion or property read. Error/string private-message probes and both hostile-value probes returned empty folders and the temp root, with and without a throwing logger. Caller-declared roots still require membership in host-owned folders (`:2424`, `:2429`); no new caller path is trusted by the fallback.

### 4. What happens when a dependency fails?

The workspace provider is synchronous by its port usage (`mcp/protocol-dispatcher.ts:2401`); exceptions and malformed non-array returns that throw during `.filter` reach the same guarded fallback. Warning-sink exceptions are isolated at `:2509`. Optional outlining returns null (`mcp/code-outliner.adapter.ts:176`), tokenizer precheck failure delegates to the budget helper (`mcp/protocol-dispatcher.ts:2365`), and write/classification failures produce safe trailer reasons (`mcp/tool-result-budget.ts:525`, `:650`, `:667`). No timeout or cancellation machinery was introduced in this batch.

### 5. What is missing that the requirements never mentioned?

No additional runtime requirement is needed to close B1/S1. Durable regression coverage for null-prototype throws and hostile getters would preserve the independent probe cases; current added specs cover an ordinary Error and a throwing logger (`mcp/protocol-dispatcher.spec.ts:2691`, `:2720`). These specs do not explicitly assert the response's `isError` flag, so the conclusion about response preservation also relies on the traced path through `createToolSuccessResponse` (`mcp/protocol-dispatcher.ts:2302`) and the guard at `:2509`.

## Failure modes

No remaining reproduced runtime defect in the identified remediation. The former privacy and observer-failure modes were injected into the actual current functions, extracted by TypeScript AST and transpiled in memory without writing source or test files. Eight combinations passed: Error containing a synthetic secret, string containing that secret, `Object.create(null)`, and an Error with a throwing `message` getter, each with a normal and throwing warning sink. Assertions verified `[]`, the system-temp root, an attempted warning, and absence of the synthetic secret.

Residual uncertainty: exact working-tree/index equivalence and packaged startup are not verified. Existing CLI/TUI bundles were inspected, not freshly rebuilt in this round. Tests and probes are not proof against every unrelated failure elsewhere in the dispatcher.

## Blocking issues

None remaining reproduced in scope. R1 B1 is fixed as documented above.

## Serious issues

None remaining reproduced in scope. R1 S1 is fixed as documented above.

## Moderate and minor issues

No moderate runtime issue found. The r1 outliner wording note remains in the tracking table and is not counted as a runtime failure mode.

## Per-site declaration audit

The scanner recognizes leading catch-body comments and comments above statements containing `.catch` (`tools/degradation-audit/check-degradation.ts:27`). The requested audit lint passed with 300 total unsuppressed sites, matching r1's reported total; no bare/orphaned-marker failure occurred.

| Site                               | Current assessment                                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reducers/content-detector.ts:119` | Honest optional predicate: invalid JSON returns false and other sniffers run.                                                                                                                                    |
| `reducers/reduce-output.ts:273`    | Honest safe classification: the primary reducer failure is reported through the guarded output channel at `:155`, `:230`.                                                                                        |
| `mcp/code-outliner.adapter.ts:177` | Honest optional outlining; wording qualification is recorded above.                                                                                                                                              |
| `mcp/protocol-dispatcher.ts:2366`  | Honest optional fast path: null delegates to the budget helper, whose failure path logs and returns a plain cut (`mcp/tool-result-budget.ts:217`).                                                               |
| `mcp/protocol-dispatcher.ts:2405`  | Recognized and materially honest: the provider failure attempts a warning, then temp fallback continues. Reporting is best effort if the diagnostic sink itself fails, consistent with `runObserver` at `:2509`. |
| `mcp/tool-result-budget.ts:515`    | Honest best-effort cleanup: the original write error is rethrown at `:518` and reported at `:525`, `:405`.                                                                                                       |
| `mcp/tool-result-budget.ts:651`    | Honest loss of only errno; safe error-name fallback still reports the primary failure at `:525`.                                                                                                                 |
| `mcp/tool-result-budget.ts:668`    | Honest fallback to the fixed Error classification; raw exception text is not exposed.                                                                                                                            |

## Data flow

1. OK — successful tool text enters `createToolSuccessResponse` (`mcp/protocol-dispatcher.ts:2302`).
2. OK — fitting output bypasses spool lookup (`:2338`); larger output resolves its root before applying the budget (`:2351`).
3. OK — host folder lookup filters invalid entries (`:2401`); provider exceptions attempt a constant guarded warning (`:2409`) and return an empty list (`:2415`).
4. OK — declared roots must match known folders; no known folder means system temp (`:2390`, `:2395`, `:2429`).
5. OK — budget reduction, raw spool and fitting remain connected (`mcp/tool-result-budget.ts:254`, `:263`, `:265`). Exclusive writes avoid replacing an existing spool, bounded retries handle collisions, and failure reasons reach the trailer (`:510`, `:503`, `:525`, `:405`).
6. OK — response and transcript use the same budgeted text, with observer isolation (`mcp/protocol-dispatcher.ts:2308`, `:2317`). The new guard allocates no timer, listener, subscription, or persistent cache (`:2409`).

## Build/runtime assessment

- Reducer source-barrel aliases exist in all three overriding path maps: `apps/ptah-electron/tsconfig.build.json:50`, `apps/ptah-cli/tsconfig.build.json:47`, `apps/ptah-tui/tsconfig.build.json:47`.
- Electron main remains ESM (`apps/ptah-electron/project.json:27`), with marked externalized at `:70`. Its compatibility plugin targets electron alone (`apps/ptah-electron/esbuild.config.cjs:76`), so it does not convert marked imports into CommonJS loads.
- Runtime manifests declare both packages (`apps/ptah-electron/package.json:34`, `:42`; `apps/ptah-cli/package.json:70`, `:78`). CLI/TUI externalize both and emit ESM (`apps/ptah-cli/project.json:28`, `:67`, `:70`; `apps/ptah-tui/project.json:18`, `:55`, `:58`). TUI uses the CLI output directory (`apps/ptah-tui/project.json:14`).
- AST inspection of generated Electron main, CLI main and TUI bundles found static imports of marked and gpt-tokenizer, and no call-expression loads of either. An ESM smoke probe successfully called marked Lexer.lex and gpt-tokenizer encode. Electron validate-deps passed with all external imports covered.
- R1's source/index AST-equivalence results for formatting-only changes in reduce-output.ts and tool-result-budget.ts remain prior-review evidence; they were not repeated without Git access. Current files and failure paths were read, and both projects' tests/lint/typechecks passed.

## Requirements fulfilment

| Requirement                                                  | Status   | Gap                                                                               |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| Close r1 B1 privacy leak                                     | COMPLETE | Fixed constant warning; Error/string probes pass                                  |
| Close r1 S1 result/spool regression                          | COMPLETE | Guarded diagnostic; hostile throws and logger probes pass; real-spool spec passes |
| Marker recognition and honest fallback                       | COMPLETE | Audit lint and source trace agree; reporting is best effort                       |
| Re-check other audit declarations                            | COMPLETE | Per-site assessment above; wording note persists                                  |
| Re-check build aliases/externals/validate-deps               | COMPLETE | Current config, generated import inspection and requested gate pass               |
| Exact unstaged-only diff and baseline/formatting equivalence | PARTIAL  | Supplied ten-file scope used; no Git operations permitted by role                 |
| No reproduced regression in scoped verification              | COMPLETE | All three requested commands pass                                                 |

Implicit requirements not addressed by the fix: none identified. The observer-isolation requirement that r1 missed is now met (`mcp/protocol-dispatcher.ts:2409`).

## Edge cases

| Case                                          | Handled | How                                                    | Concern                                                       |
| --------------------------------------------- | ------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Absent provider / empty folder list           | YES     | `mcp/protocol-dispatcher.ts:2401`, `:2395` select temp | Absence itself is not warned despite the older header wording |
| Provider Error/string with private content    | YES     | Constant warning `:2411`                               | Independent probes pass                                       |
| Null-prototype throw / hostile message getter | YES     | No inspection at `:2408`                               | Independent probes pass; no dedicated committed specs         |
| Warning sink throws                           | YES     | `runObserver` at `:2409`, `:2509`                      | Diagnostic lost deliberately; result preserved                |
| Unknown/UNC declared root                     | YES     | Empty-known shortcut/matching at `:2429`               | Existing trust specs passed                                   |
| Small output                                  | YES     | Fast path at `:2338`                                   | No provider lookup                                            |
| Parser unavailable                            | YES     | Adapter null at `mcp/code-outliner.adapter.ts:182`     | Log fallback precedes outer cut                               |
| Spool collision / write failure               | YES     | `mcp/tool-result-budget.ts:510`, `:525`                | Bounded retry / honest failure trailer                        |
| Hostile name/code getter                      | YES     | `mcp/tool-result-budget.ts:650`, `:667`                | Fixed safe classification                                     |

## Verification

Executed once from `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`, with tailed command output:

| Check                                                                                                                                            | Result                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`                                                                                | Exit 0; 300 unsuppressed sites; audit passes                                    |
| `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools --skip-nx-cache` | Exit 0; all six targets pass; 49.1 seconds                                      |
| `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`                                                                           | Exit 0; build-main dependency and validation pass; all external imports covered |
| Scoped `ptah_get_diagnostics` on dispatcher/reducer paths                                                                                        | typescript-compiler; 0 errors, 0 warnings                                       |
| In-memory repetitions of r1 fault injections                                                                                                     | Eight combinations pass; no coercion/leak/escape                                |
| Generated-bundle AST and ESM dependency smoke probe                                                                                              | Native ESM imports; Lexer and encode callable                                   |

No real-port EACCES occurred. No workspace-wide test/lint/build or mutating pre-commit hook was run. The PowerShell stderr wrapper printed a NativeCommandError label around Nx informational output, but the combined command exited 0 and Nx explicitly reported all six targets successful.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for closure of B1/S1; MEDIUM for the full declared batch because the exact unstaged diff was not independently inspected.
- Top risk: approval must not be extrapolated to unlisted working-tree changes or packaged application startup.
- What a robust implementation would add: permanent hostile-exception regression cases and explicit success-envelope assertions alongside the existing raw-spool check; accurate outliner fallback wording. None is a remaining reproduced runtime blocker for this remediation.
