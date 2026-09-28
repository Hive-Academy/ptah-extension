# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 11, r1. Review of the six source/spec files named in `batch-11-executor-report.md`, plus the provider, namespace, reducer/budget paths and the requested Batch 10 detector spec. No source edits or git operations were performed.

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Minor issues        | 1        |
| Failure modes found | 2        |

The requested probe/slice and reason deduplication work, including case variants, and the normal project checks pass. The score is in the sound band rather than 5–6 because no realistic successful result was shown to lose or misstate information through these changes. It is below 8–10 because the published input contract disagrees with the new validator and a requested adjacent regression test demonstrably fails with modest added disk latency.

Paths below are relative to this worktree. `MCP` abbreviates `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`; `WI` abbreviates `libs/backend/workspace-intelligence/src/`.

## Five logic questions

### 1. How does this fail silently?

No new silent failure established in the reviewed production paths. `MCP/protocol-dispatcher.ts:919` requests one extra result and `:922` slices and computes availability from the unsliced array. `MCP/mcp-response-formatter.ts:442` labels that result “more than N”, avoiding a false exact count. A provider rejection reaches the existing `isError: true` catch at `MCP/protocol-dispatcher.ts:2255` rather than becoming an empty successful search.

A provider silently imposing its own smaller cap would remain indistinguishable from a complete result: the port returns only `string[]` (`libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:113`). No such extra cap was found in the shipped adapter implementations; this is a residual contract limitation, not an invented Batch 11 defect.

### 2. What user action produces unexpected behaviour?

A schema-valid direct MCP call with `limit: 0`, a negative number or a fraction now returns a tool error, although discovery still publishes `type: 'number'` with no minimum (`MCP/tool-description.builder.ts:351`). See defect 1. Positive integer callers retain their behavior; omitted/null limits retain 50 (`MCP/protocol-dispatcher.ts:906`, `:2347`).

### 3. What input data produces a wrong answer?

No new wrong score or reason set established. Query normalization precedes keyword matching (`WI/context-analysis/file-relevance-scorer.service.ts:69`), and only the returned reasons are deduplicated after scoring (`:136–147`). `auth auth token` still scores 40, `auth token` 30, and case variants yield one identical filename reason, pinned at `WI/context-analysis/file-relevance-scorer.service.spec.ts:564`, `:574`, `:582`.

### 4. What happens when a dependency fails?

Empty/non-string patterns are rejected before provider invocation (`MCP/protocol-dispatcher.ts:903`); filesystem rejections propagate through `namespace-builders/core-namespace.builders.ts:151` into the tool-error catch. A malformed non-array provider result normally fails at the namespace `.map` or dispatcher `.slice`, also visibly. There is no new timeout/cancellation mechanism: a provider that never settles still holds the call, as before. Budget reduction errors fall back to raw/cut output, and spool failures are named in the trailer (`MCP/tool-result-budget.ts:212`, `:401`, `:589`).

Dependency latency also causes the detector test failure in defect 2. Its assertions need no wall-clock performance guarantee.

### 5. What is missing that the requirements never mentioned?

The extra limit validation needs a matching discoverable schema (defect 1). Tests need an automated assertion at the final reducer/budget boundary, rather than only notice ordering (defect 3). A future independently capped provider needs completeness metadata; the existing array port cannot reveal a hidden cap (`file-system-provider.interface.ts:113`). That hypothetical provider extension is not a blocker for these adapters.

## Failure modes / numbered defects

### 1. Moderate — published limit schema accepts values rejected by the handler

- Trigger: a direct MCP client follows `tools/list` and submits `limit: 0`, `-1` or `2.5`.
- Symptom: an input allowed by the published schema now yields `Error: "limit" must be a positive integer.`
- Evidence: `MCP/tool-description.builder.ts:351–354` advertises an unrestricted number; `MCP/protocol-dispatcher.ts:906–915` requires a positive safe integer. The rejection behavior is deliberately pinned at `MCP/protocol-dispatcher.spec.ts:991`.
- Current handling / compatibility: this is an explicit, recoverable rejection, not silent data loss. The pre-change forwarding described in `research/workspace-files.md:142` passed `limit ?? 50` through. The current Electron/CLI adapters demonstrate the old coercion semantics: zero requests all results through a falsy check, a fraction is truncated by `slice`, a negative value slices from the end, and a numeric string is coerced (`libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:134`; CLI equivalent `:135`). Numeric strings were already outside the MCP number schema; rejecting them is appropriate. No in-repository dependency on those exceptional direct-MCP inputs was found in the inspected callers/specs, and external caller usage cannot be established from this tree.
- `execute_code` is unaffected: `ptah.search.findFiles` calls the namespace directly, whose default remains 20 and which forwards its limit (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts:149–158`). It does not route through this new validator.
- Recommendation: retain explicit validation, publish `type: 'integer'`, `minimum: 1` and the supported numeric ceiling, and describe the positive-integer rule. Add a schema/handler agreement regression. State the direct-MCP compatibility tightening in the change notes; do not claim all formerly accepted inputs are unchanged.

### 2. Moderate — Batch 10 real-disk cap test can time out under load

- Trigger: approximately 30 ms extra latency on each fixture file read, as can occur when parallel Nx workers contend for disk/CPU.
- Symptom: the inspection-cap assertion fails with `Exceeded timeout of 5000 ms for a test`, despite no functional defect in project detection. The stack includes the executor-reported outer location `project-detector.service.spec.ts:504:1`.
- Evidence: `WI/project-analysis/project-detector.service.spec.ts:748–765` creates 206 extra projects plus the four base projects, then awaits composition without a per-test timeout. `WI/project-analysis/project-detector.service.ts:21` sets the cap to 200; `:390–394` inspects those projects serially. Reads use real async disk I/O at `WI/project-analysis/project-detector.service.spec.ts:1013–1015`. The project config (`libs/backend/workspace-intelligence/jest.config.ts:1`) and root `jest.preset.js:4` set no test timeout; the installed Jest default is 5,000 ms (`node_modules/jest-config/build/index.js:522`).
- Current handling: no allowance for this integration fixture's disk cost. Cleanup deletes the fixture immediately at `WI/project-analysis/project-detector.service.spec.ts:573`; Jest timeouts do not cancel an outstanding async composition.
- Reproduction: a temp-only Jest setup wrapped `fs.promises.readFile`, adding 30 ms only for `ptah-monorepo-fixture-` paths. Scoped Nx run selected only `r1 B1: counts every project`; result: 1 failed, 56 skipped, exact 5,000 ms timeout at `:748:5` with outer `:504:1`. Ordinary scoped verification passed before this injected-latency run.
- Recommendation: keep a real-disk smoke test with a generous explicit integration timeout; exercise the 200-project cap via a deterministic in-memory provider, or provide a suitable timeout for the large disk fixture. Avoid interpreting a timeout as a functional regression. This demonstrates susceptibility, not definitive attribution of the executor's earlier failure whose full error was not retained.

### 3. Minor — notice survival is not pinned through the budget/reducer

- Evidence: `MCP/mcp-response-formatter-extra.spec.ts:41` checks only that the notice precedes `f0.ts`; new dispatcher cases at `MCP/protocol-dispatcher.spec.ts:899–959` use short results that fit the budget.
- Gap: these tests do not guard the stated reason for notice placement against a later reducer change. Generic budget tests are not an assertion about this notice.
- Recommendation: add a dispatcher-level oversized search regression with a temp spool root, asserting the notice in final content and exact preservation of formatted raw output in the spool. Pin both Markdown reduction and plain-cut behavior. This is a coverage improvement, not a demonstrated production failure: independent probes passed both paths.

## Blocking issues

None found in the reviewed Batch 11 behavior.

## Serious issues

None found. The input mismatch is a visible, recoverable error, and the reproduced timeout is a test-only issue in unchanged Batch 10 code.

## Moderate and minor issues

Defects 1–3 above are the complete findings: two Moderate, one Minor. No style/naming findings are included.

## Data flow

1. **OK:** tool discovery registers `buildSearchFilesTool` (`MCP/protocol-dispatcher.ts:390`), so the handler is reachable in all runtime families. **Gap:** limit schema, defect 1.
2. **OK:** dispatcher validates the pattern and limit, defaults to 50, asks for N+1, slices to N, and derives availability before slicing (`MCP/protocol-dispatcher.ts:903–922`). Calls are local and independent; no new shared state, timer or resource is introduced.
3. **OK:** namespace resolves the root per call, forwards excludes and the exact requested maximum, then normalizes paths (`namespace-builders/core-namespace.builders.ts:149–158`). Electron/CLI use `slice(0,maxResults)` after glob discovery (`electron-file-system-provider.ts:120–135`, `cli-file-system-provider.ts:122–135`); VS Code forwards that maximum directly (`vscode-file-system-provider.ts:153–175`). No extra lower cap appears in this code. If an external provider adds one, absence of the notice cannot establish completeness.
4. **OK:** formatter places a bounded count/notice paragraph before the list (`MCP/mcp-response-formatter.ts:441–451`). This is a `Found:` paragraph, not a Markdown heading, but it fits before the large list in the existing reducer.
5. **OK, probed:** success response budgets text and sends the same text to the callback (`MCP/protocol-dispatcher.ts:2948–2966`). `tool-result-budget.ts:255` invokes the reducer, `:267` spools raw formatted text, and `:423` cuts a prefix if necessary. The small notice survives both tested paths.
6. **OK:** relevance entry maps scorer reasons unchanged (`namespace-builders/analysis-namespace.builders.ts:351–368`). Scorer still accumulates and caps scores, then creates an insertion-ordered Set of reason strings (`WI/context-analysis/file-relevance-scorer.service.ts:69`, `:136–147`). Repeated query terms still affect ranking as required; no keyword deduplication changes the score.

## Requirements fulfilment

| Requirement                                   | Status                        | Evidence / gap                                                                                  |
| --------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| 11.1 request N+1 and slice to N               | COMPLETE                      | Dispatcher :919–922; specs :899, :952                                                           |
| Exact limit and under-limit do not claim more | COMPLETE                      | Dispatcher specs :927, :939                                                                     |
| More results produce actionable notice        | COMPLETE                      | Formatter :442–445; default-50 spec :916                                                        |
| Empty/non-string pattern is a tool error      | COMPLETE                      | Dispatcher :903–905; spec :971                                                                  |
| Judge additional limit validation/default     | PARTIAL                       | Default 50 and visible validation work; discovery contract mismatch, defect 1                   |
| Notice preserved through reduction/budget     | COMPLETE                      | Independent 1,000/10,000-file probes; durable regression missing, defect 3                      |
| Truth of notice under provider caps           | COMPLETE for shipped adapters | No hidden lower cap found; array contract cannot expose an independently capped future provider |
| 11.2 each matched term listed once            | COMPLETE                      | Scorer :139; spec :564, :582, :589                                                              |
| Scores unchanged                              | COMPLETE                      | Score pinned at 40/30 and export case 60, spec :574, :607                                       |
| Inspect transient detector spec failure       | COMPLETE                      | Load sensitivity reproduced, defect 2                                                           |
| Scoped checks, audit and validate-deps        | COMPLETE                      | All requested ordinary checks passed                                                            |

Implicit requirements not fully addressed: discoverable limit constraints and a permanent notice-through-budget regression.

## Edge cases

| Case                                           | Handled | How / concern                                                           |
| ---------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| Empty or whitespace-only pattern               | YES     | Tool error before provider; valid nonempty glob is not trimmed          |
| Non-string/missing pattern                     | YES     | Same visible tool error                                                 |
| Missing/null limit                             | YES     | 50, provider receives 51                                                |
| Zero/negative/fraction/string/NaN limit        | YES     | Explicit rejection; schema mismatch remains                             |
| No matches                                     | YES     | Zero-count formatter branch, :428                                       |
| Exactly N / fewer than N                       | YES     | No false truncation notice                                              |
| Provider over-returns                          | YES     | Slice caps output and indicates more                                    |
| Provider silently returns a smaller capped set | NO      | No completeness metadata; no shipped lower cap found                    |
| Provider rejection/malformed non-array         | YES     | Error propagates; not a successful empty search                         |
| Hung provider                                  | NO      | Existing await has no new cancellation/timeout                          |
| Oversized list                                 | YES     | Notice remains; full formatted list spooled in tested reducer/cut paths |
| Repeated/case-variant query words              | YES     | Lowercase first, dedupe final strings                                   |
| Same exported symbol matches several words     | YES     | One reason, unchanged capped symbol score                               |
| Empty query/file list                          | YES     | Existing baseline/empty behavior unchanged                              |
| Concurrent or repeated calls                   | YES     | No new shared mutable state in these edits                              |
| Loaded filesystem during detector test         | NO      | Reproduced 5-second test timeout                                        |

## Verification performed

- Direct `ptah_get_diagnostics`, scoped to the two production project paths: TypeScript compiler reported 0 errors, 0 warnings.
- Ran `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: all six tasks passed. Nx also reported workspace-intelligence:test as a flaky task. Output logged in OS temp (`task559-b11-review-verification.txt`).
- Ran `nx run degradation-audit:lint --skip-nx-cache`: passed, TOTAL 300 unsuppressed sites.
- Ran `nx run ptah-electron:validate-deps --skip-nx-cache`: passed with its dependency task. The combined PowerShell wrapper had exit code 1 despite the explicit Nx success reports; verification here uses each target's printed result.
- Bundled the actual formatter and budget code with esbuild in OS temp and ran three probes: 50 results / 3,870 raw chars returned unchanged; 1,000 results / 78,776 raw chars reduced by `markdown-outline` to 302 chars; 10,000 results / 816,779 raw chars cut to 7,031 chars. Notice survived all three. Both oversized outputs had byte-equal formatted raw spools. The outline may omit the entire list but names the full-output spool, as designed.
- Delayed-I/O negative probe: actual detector spec selected via scoped Nx target, temporary config/setup only, 30 ms added per fixture read. Reproduced the 5,000 ms timeout; 1 failed / 56 skipped. Evidence: OS-temp `task559-b11-slow-io.log`. An initial setupFilesAfterEnv CLI attempt failed configuration parsing before running any test; the temp-config invocation resolved it.
- Read Batch 11 and the later-batches note, the executor report, context Decisions 2/4/17, and the referenced search fix design. No task-description, implementation-plan or code-style-review document was present in the discovered task-folder inventory. No AGENTS.md/CLAUDE.md was found in the worktree root or scoped library tree. No live external MCP client compatibility test was performed; legacy behavior is inferred from the documented old forwarding and adapter code, not from a git diff.
- Probes/config/logs stayed under OS temp. Only this review document was written in the worktree; no source/spec/test file was changed.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for Batch 11 logic; MEDIUM for identifying the executor's exact earlier transient failure.
- Top risk: the newly enforced limit domain is narrower than the domain published to MCP callers.
- What a robust implementation would add: matching integer/minimum schema and compatibility note; a durable oversized-search regression; deterministic cap coverage plus a suitable timeout for disk-based detector fixtures.

Approval follows the requested gate: no Blocking or Serious defect. Moderate and Minor findings remain actionable and should receive regression coverage when fixed.
