# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 18, r1, Lane A: corrected evaluate-value spooling and result cap. The normal production path preserves the full stringified value and returns a bounded answer with its recovery trailer. One moderate long-path exception remains; no Blocking or Serious defect was established.

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

The score reflects successful real-spool and downstream-budget probes, scoped checks, and host-root enforcement. It is below 9 because the stated no-second-cut guarantee fails for a valid but unusually long Unicode spool root, and an exact HEAD differential was not performed. It is above the 5–6 band because ordinary large and multibyte responses retain both their complete recovery artifact and visible guidance, including a real filesystem failure case.

Scope: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/` files `mcp-response-formatter.ts`, `mcp-response-formatter-extra.spec.ts`, the evaluate dispatch and shared response path in `protocol-dispatcher.ts`, and the relevant dispatcher regression/trust tests. Supporting paths examined: `tool-result-budget.ts`, reducer token measurement, browser namespace/capability evaluation, and execute-code serialization. References below to these filenames are relative to that mcp-core directory unless a different path is given. Approval concerns Batch 18, not every unrelated tool implemented in the shared dispatcher.

Inputs: Batch 18 only from `batches.md`; context Decisions 2, 7 and 17; executor report including its superseding correction; browser research section 4; task metadata read without modification. No `task-description.md`, main `implementation-plan.md`, or `code-style-review.md` exists in the task folder. The separate language implementation plan is outside this batch. `ptah_search_files` returned zero AGENTS.md files; native hidden-file search also found none. Native reads were used because no direct file-read tool is listed.

## Five logic questions

### 1. How does this fail silently?

No new silent loss was established on the normal path: `mcp-response-formatter.ts:1718` passes the complete stringified value to the spool before slicing; `tool-result-budget.ts:526` writes that string as UTF-8. Failed saves are explicitly named by `mcp-response-formatter.ts:1641`. Finding 1 removes the evaluate-specific guidance from the final answer, but the generic reduction notice remains and the full value still exists in the first spool.

### 2. What user action produces unexpected behaviour?

Opening a deeply nested Unicode workspace and evaluating a large string triggers Finding 1. The formatter reserves no bounded representation of the absolute spool locator (`mcp-response-formatter.ts:1640`), so the locator itself can exhaust the token budget. Ordinary 100 KB, 10 MB and multibyte values did not trigger a second cut.

### 3. What input data produces a wrong answer?

No wrong value/count was established for normal string/object inputs: the retained prefix and dropped UTF-16-unit count come from the same `valueStr` (`mcp-response-formatter.ts:1721`). Primitive conversion remains `String(value)` and object conversion remains pretty JSON (`mcp-response-formatter.ts:1698`). Circular objects still produce `[Unable to serialize result]` through the fallback (`mcp-response-formatter.ts:1732`, `mcp-response-formatter.ts:1980`); this is the documented prior behavior, not a newly invented representation.

### 4. What happens when a dependency fails?

A real `.ptah` file blocking creation of the spool directory returned an inline `full value could not be saved: ENOTDIR` notice, without throwing, and the answer still fit both limits. The writer catches filesystem errors and returns a classified failure (`tool-result-budget.ts:540`). Host-folder lookup failures are guarded and fall back to system temp (`protocol-dispatcher.ts:3058`). Browser capability failures are converted to an error result by `namespace-builders/browser-namespace.builder.ts:354`, then the existing error rendering remains at `mcp-response-formatter.ts:1690`. An arbitrary rejecting replacement spool callback is not the production contract: the wired callback uses the existing nonthrowing writer (`protocol-dispatcher.ts:1519`).

### 5. What is missing that the requirements never mentioned?

A bounded locator policy is needed when the recovery path itself exceeds the response budget (Finding 1). The shared budget layer already has a relative-locator strategy (`tool-result-budget.ts:386`); the new evaluate trailer does not. Also, token counts are not monotonic in prefix length, as documented by `libs/backend/tool-output-reducers/src/lib/token-measure.ts:112`; this review does not claim the binary search proves a globally longest prefix. No ordinary-path budget failure was reproduced in 120 varied multibyte boundary probes, so that uncertainty is not promoted to a separate defect.

## Failure modes

### 1. Moderate — a long Unicode spool path removes the evaluate trailer and causes a second spool

- Trigger: a host-owned spool root containing 30 directory components, each `String.fromCodePoint(0x9f98).repeat(40) + index`, and an evaluate value of `'x'.repeat(102400)`. A real filesystem probe created and wrote this tree successfully on this Windows host. Root length was 1,329 UTF-16 units.
- Symptom: the formatter returns 1,549 chars but 2,544 measured tokens. The downstream budget reduces this to 225 chars / 64 tokens, omits the entire code block, removes `for page content use ptah_browser_content with a selector`, and writes a second spool. Its visible locator names the formatted intermediate output rather than the raw-value file.
- Evidence: `mcp-response-formatter.ts:1640` always emits the full absolute path; `mcp-response-formatter.ts:1653` assumes zero is fitting without testing it; `mcp-response-formatter.ts:1730` returns that unchecked zero-prefix rendering. The over-budget answer reaches reduction and another write at `tool-result-budget.ts:255` and `tool-result-budget.ts:265`.
- Current handling: the original raw-value file remains byte-equal to the full value. The second file contains the original locator, so recovery requires an extra read. This is the pathological-path exception already disclosed in the executor correction; the probe confirms it is reachable with valid filesystem paths.
- Recommendation: choose a bounded, root-relative locator before fitting, including a clear root label; verify the zero-prefix trailer and the final surrogate-safe rendering. Retain a direct locator to the original value and keep the generic budget step on its unchanged fast path. Add a token-heavy-path regression that checks one spool, visible guidance, and byte-equal value recovery.

## Blocking issues

None established in Batch 18.

## Serious issues

None established in Batch 18.

## Moderate and minor issues

Finding 1 only. Severity is Moderate because it requires an unusually deep/token-heavy host path, and the raw value remains recoverable. It is not classified as data loss or a probable ordinary-path failure.

## Data flow

1. **OK:** evaluate arguments reach the browser namespace and the result is awaited (`protocol-dispatcher.ts:1510`). The formatter is called only here in production; repository search found no second production caller.
2. **OK:** serialize the value once using the established object/primitive rules (`mcp-response-formatter.ts:1698`). Short primitives and fitting fenced results return without spooling (`mcp-response-formatter.ts:1707`, `mcp-response-formatter.ts:1714`).
3. **OK:** resolve the spool root from host folders, accepting a caller declaration only when it canonicalizes to a host folder (`protocol-dispatcher.ts:3044`). No session-aware workspace lookup determines this write location.
4. **OK:** spool the complete value before slicing (`mcp-response-formatter.ts:1718`); exclusive-create writes avoid overwriting another call, and partial-write cleanup is attempted (`tool-result-budget.ts:526`).
5. **Finding 1:** render a fitting prefix plus notice; the absolute locator is not bounded and the zero-prefix result is not verified (`mcp-response-formatter.ts:1724`). Surrogate-pair adjustment is present at `mcp-response-formatter.ts:1667`.
6. **OK normally:** final budgeting uses the same piecewise token measure and leaves fitting text unchanged (`protocol-dispatcher.ts:2997`, `protocol-dispatcher.ts:3018`). Finding 1 takes the slower reducer/spool path instead.
7. **OK:** the transcript callback receives the same final text as the response (`protocol-dispatcher.ts:2966`).

The execute-code path does not call this formatter: it serializes its own result and applies the shared budget (`protocol-dispatcher.ts:3197`, `protocol-dispatcher.ts:3227`). Its pre-existing 50 KiB serialization cut remains (`code-execution.engine.ts:500`); this batch neither adds that loss nor repairs it. Do not interpret this approval as a full-raw-spool guarantee for arbitrary execute-code results.

## Requirements fulfilment

| Requirement                                                | Status   | Gap                                                                                                                                                           |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete stringified evaluate value spooled before cutting | COMPLETE | Real UTF-8 byte equality verified; formatter line 1718 and writer line 526                                                                                    |
| Host-owned spool root                                      | COMPLETE | Dispatcher line 1519 uses resolver line 3044; existing trust tests cover unknown roots, subfolders, junctions and UNC declarations                            |
| Honest nonthrowing filesystem failure                      | COMPLETE | Actual ENOTDIR probe; formatter line 1641 and writer line 540                                                                                                 |
| 8,000 chars and 2,000 tokens at the MCP boundary           | COMPLETE | Scoped integration test and independent probes; shared layer still caps Finding 1                                                                             |
| Evaluate hint survives; no second spool/trailer            | PARTIAL  | Normal roots pass; Finding 1                                                                                                                                  |
| Below-budget rendering and no spool                        | COMPLETE | Existing guards plus direct null/undefined/function/Symbol/BigInt/object/empty/150-char probes; exact historical HEAD differential not independently verified |
| Surrogate pairs never split at the formatter cut           | COMPLETE | Existing 12-cut-point spec and additional multibyte probes; formatter line 1667                                                                               |
| Async signature wired through all formatter callers        | COMPLETE | Sole production caller awaits it at dispatcher line 1515                                                                                                      |
| No problematic dependency-like wording in new notice       | COMPLETE | Notice at formatter line 1642; validate-deps passed                                                                                                           |

Implicit requirement not fully addressed: bounded recovery locators for unusually long host paths (Finding 1).

## Edge cases

| Case                                  | Handled                | How                                                       | Concern                                                                           |
| ------------------------------------- | ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Empty, null, undefined                | YES                    | Existing String/JSON branches; no spool in direct probe   | None introduced                                                                   |
| Function, Symbol, primitive BigInt    | YES                    | String conversion; direct probe                           | Real browser transport may have its own serialization limits                      |
| Circular value                        | YES, as before         | Serialization placeholder                                 | No raw representation is promised for an unserializable object                    |
| 100 KB / 10 MB ASCII                  | YES                    | Complete real spool, bounded prefix                       | Conservative upper-bound token count keeps fewer chars than exact BPE might allow |
| Multibyte content                     | YES                    | Real spool byte equality and 2,000-token final result     | None reproduced at ordinary paths                                                 |
| Filesystem refuses directory creation | YES                    | ENOTDIR notice retained within budget                     | Raw value cannot be saved, explicitly stated                                      |
| Repeated/concurrent writes            | YES by existing writer | Exclusive-create plus fresh-name retries, writer line 526 | No new concurrency stress test performed                                          |
| Extremely long/token-heavy host root  | NO                     | Generic fallback reduces again                            | Finding 1                                                                         |

## Verification

All requested checks ran once, with cache skipped and only their tail returned:

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: all three targets passed; 47.6 s.
- `nx run degradation-audit:lint --skip-nx-cache`: passed; TOTAL 300.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: passed, including its prerequisite.
- Scoped `ptah_get_diagnostics`: reported unavailable because the compiler was still running at 45 s. No polling retry; the independent scoped Nx typecheck above passed.

Independent Node probes loaded the current TypeScript formatter, real spool/budget implementation and real token measurement using temporary transpilation. Only the unrelated surface-limit alias was stubbed. No repository source was edited.

| Value                           | Returned chars | Exact tokens | Piecewise count | Budget unchanged | Spool byte-equal |
| ------------------------------- | -------------: | -----------: | --------------: | ---------------- | ---------------- |
| 100 KB ASCII                    |          2,183 |          327 |           2,000 | YES              | YES              |
| 10 MB ASCII                     |          2,184 |          327 |           2,000 | YES              | YES              |
| `漢字😀é` repeated 20,000 times |          2,663 |        2,000 |           2,000 | YES              | YES              |

These three calls created exactly three spool files. Another 120 varied multibyte/path-length cases produced no over-budget formatter result. The separate real long-root probe reproduced Finding 1 with two spool files; the real ENOTDIR probe stayed within budget and did not throw.

Temporary probe scripts: `C:/Users/abdal/AppData/Local/Temp/ptah-b18-review.cjs` and `C:/Users/abdal/AppData/Local/Temp/ptah-b18-path-review.cjs` (the latter uses Unicode code-point construction to avoid shell-encoding ambiguity). They are review probes, not committed regressions.

Limitations: no live CDP/browser session was exercised. Exact `git show HEAD:<path>` comparison was not performed because this reviewer role prohibits git operations; historical byte identity is supported by the executor's baseline evidence and current rendering guards, not claimed as an independent HEAD differential. No source edits, staging, commits or task-state changes were made.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Top risk: an unusually token-heavy host path causes a second spool and hides the direct raw-value locator and evaluate guidance (Finding 1).
- What a robust implementation would add: a bounded relative locator, final whole-response verification after surrogate adjustment, and a regression covering the long-path case. Retain full-value spooling before any truncation.

Approval follows the requested gate: zero Blocking or Serious issues. Finding 1 remains a recorded Moderate exception.
