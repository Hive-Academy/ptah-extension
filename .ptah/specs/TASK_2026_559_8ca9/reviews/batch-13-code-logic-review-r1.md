# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 13, revision 1, Lane A. Reviewed the on-disk agent read/status implementation in `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`, supplied base HEAD `e29289a85`. No source edits or git operations.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 3              |
| Moderate issues     | 0              |
| Failure modes found | 4              |

The default HTTP read drops the newest output under normal line widths, retaining a range that says the final line is shown. Mixed-stream ranges are also incorrect before budgeting. The production stdio path bypasses both the status throttle and read budget. All requested scoped checks passed, but current tests do not reject these behaviors.

4/10 rather than 5–6: these affect probable core paths, not just unusual inputs. Above 1–2: offset plumbing, caller isolation, terminal/error handling, and service window selection work. The HTTP spool preserves the missing tail, mitigating permanent loss without making the visible result truthful.

Inputs: `context.md` Decisions 2/4/17; Batch 12/13 in `batches.md`; `batch-13-executor-report.md`; `research/agent-task-harness.md`; `.github/copilot-instructions.md`. `ptah_search_files` and native discovery found no `AGENTS.md`. The original `implementation-plan.md`, `task-description.md`, and `code-style-review.md` are absent; the task uses plan-free batches. The language plan is unrelated. No style findings are included.

Source shorthand below resolves to these exact worktree-relative files:

- **PD:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- **FMT:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
- **DESC:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- **BUDGET:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- **STDIO:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts`
- **SERVER:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.ts`
- **CLI:** `apps/ptah-cli/src/cli/commands/mcp-serve.ts`
- **SERVICE:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- **NS:** `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
- **PD-SPEC:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`

## Five logic questions

### 1. How does this fail silently?

The default tail can lose the final failure while its header says the final line is displayed (`PD:1123`, `PD:3084`, `BUDGET:430`, `FMT:1262`; F1). The generic trailer discloses a partial cut, but neither its direction nor the false range. With exactly 200 lines, the result still says `Lines: 200 of 200 | Truncated: No`, without an omitted-lines notice (`FMT:1221`, `FMT:1226`). The `truncated` flag correctly retains its buffer-capacity meaning; the defect is failing to reconcile displayed counts/ranges after a separate budget cut.

### 2. What user action produces unexpected behaviour?

Reading once after agent completion can hide the final result/error (F1). Repeated status calls through `ptah mcp-serve` always return full bodies (`STDIO:336`, F2). The same default read over stdio exceeds both result limits (`STDIO:369`, F4).

### 3. What input data produces a wrong answer?

Both streams containing output causes false paging coordinates (`SERVICE:939`, `FMT:1262`, F3). With 300 lines per stream, `offset:100, tail:2` shows stdout 101–102 and stderr 101–102, but says `Showing lines 101-104 of 600`. Ordinary 200-character lines also trigger F1/F4; malformed input is unnecessary.

### 4. What happens when a dependency fails?

HTTP awaits status/read before the throttle/formatter (`PD:1098`, `PD:1120`); rejection becomes `isError:true` (`PD:2301`, `PD:2322`). Stdio catches lookup failures (`STDIO:340`, `STDIO:376`). The existing error-after-success test covers HTTP (`PD-SPEC:5829`). Spool failure is reported without inventing a saved path (`BUDGET:401`, `BUDGET:544`). Invalid read arguments fail before service access (`PD:1108`, `STDIO:354`). There is no new dependency timeout or output-shape validator; live-runtime hangs and malformed typed results were not fault-injected, and are not asserted as new defects.

### 5. What is missing that the requirements never mentioned?

Service windows must remain coherent after the final token/character budget: a line limit is insufficient (`SERVICE:915`, `BUDGET:430`, F1/F4). Displayed coordinates must match the service's per-stream offset (`SERVICE:931`, `FMT:1262`, F3). Equivalent stdio tools need the same policy, because that route bypasses `handleMCPRequest` (`SERVER:219`, `CLI:359`, F2/F4).

## Failure modes

### 1. F1 — BLOCKING: default tail drops its newest lines while claiming they are shown

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1123`; downstream `BUDGET:430`, `FMT:1262`.
- Trigger: default `ptah_agent_read({agentId})` over 5,000 stdout lines. Each of the selected last 200 lines is 200 characters; line 5,000 contains a final failure sentinel.
- Symptom: response contains line markers **4801–4837 only**, yet says `Showing lines 4801-5000 of 5000 (4800 omitted; pass offset/tail to page)`. `FINAL_FAILURE` is absent.
- Evidence: the real HTTP dispatcher/formatter/budget probe returned **7,788 chars / 1,900 tokens**, **37** visible line markers. The spool retained the final failure. A second probe with exactly 200 lines returned **7,913 chars / 1,923 tokens**, omitted the final failure, displayed `Lines: 200 of 200 | Truncated: No`, and had no `Showing lines` warning.
- Current handling: agent reads are `preformatted` (`BUDGET:90`), bypassing the error-preserving log reducer. The generic fitter keeps a prefix (`BUDGET:430`, `BUDGET:436`, `BUDGET:441`) of the already selected tail. Counts/ranges were rendered earlier (`FMT:1221`, `FMT:1227`). The trailer states partial output and supplies a spool path, but does not correct the range.
- Impact: a caller following the read-once completion contract can see successful progress, miss the final failure/result, and be told the final line was shown. This is blocking misleading output. Spooling mitigates permanent data loss; it does not satisfy the tail contract.
- Recommendation: make the read window/formatter budget-aware. Tail reads must retain the newest fitting lines of each stream, reserve metadata/trailer costs, and calculate the visible counts/ranges afterward. Forward pages need an honest continuation offset. Preserve stderr too. An individually over-budget final line needs explicit partial-line disclosure and recovery. A smaller fixed line count alone cannot handle varying widths.
- Regression: assert a final failure sentinel survives the final response and the reported ranges match actual visible lines. Cover both streams and exactly-200-line input. `PD-SPEC:5965` only asserts limits, spool existence, and the stale pre-cut range; it accepts the defect.

### 2. F2 — SERIOUS: stdio agent_status bypasses the repeat throttle

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:336`.
- Trigger: the same external MCP caller checks the same running agent twice within 60 seconds.
- Symptom: both responses contain the complete status body and structured agent data. The probe produced identical **147-character** Markdown bodies, each containing `## Agent Status`.
- Evidence: `STDIO:336` directly formats each lookup; `SERVER:219` returns that response; `CLI:359` dispatches it and `CLI:371` forwards the result. This is the production `ptah mcp-serve` path. It creates a host session ID (`CLI:169`, `CLI:177`), and already passes identity to the dispatcher (`SERVER:313`, `SERVER:328`).
- Current handling: suppression exists only at `PD:2429`. The namespace delegates status directly (`NS:319`). The executor labels this deferred.
- Impact: the ONE-OFF/token-saving behavior remains absent on a supported agent-facing transport; repeated polls keep the original behavior indefinitely.
- Recommendation: share the policy between transports using caller+agent identity, with a connection identity when appropriate. A suppressed stdio answer must not retain the full agent object in structured content. Preserve full terminal/error/session-change answers. Give completion-notification guidance only where the host can receive that notification; otherwise provide honest retry guidance.
- Regression: two calls through `StdioMcpServerService.handleToolsCall`; then caller isolation, expiry, changed CLI session ID, terminal state, and rejection. This is an unclosed transport requirement, not a claim that the new HTTP throttle regressed stdio.

### 3. F3 — SERIOUS: combined counts are falsely presented as a contiguous range

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1262`.
- Trigger: stdout and stderr both contain output, and the window omits lines.
- Symptom: with 300 lines per stream and `offset:100, tail:2`, actual windows are stdout 101–102 and stderr 101–102; output claims `Showing lines 101-104 of 600`. Default tails of 200 per stream similarly claim 201–600 instead of two independent 101–300 ranges.
- Evidence: the service slices streams separately (`SERVICE:931`, `SERVICE:939`), then sums totals (`SERVICE:942`). `FMT:1262` derives one interval from those sums. The real formatter probe reproduced the exact false forward-range text.
- Current handling: JSDoc says approximate (`FMT:1214`), but the returned text does not. The added formatter window test uses empty stderr (`mcp-response-formatter.spec.ts:1305`, in the same directory as FMT).
- Impact: callers get incorrect paging coordinates and can skip or repeat output when choosing the next offset from the displayed endpoint. Both transports are affected, even below budget. Unlike F1 this defect concerns addressing metadata; the selected stream text itself is still present.
- Recommendation: add per-stream totals/start/end to `AgentOutput` and show separate ranges, or report combined counts without asserting an exact contiguous interval. At minimum disclose the approximation to the caller and explain that offset applies independently per stream. A source comment does not disclose it.
- Regression: both streams longer than the window, unequal lengths, and offset past one stream's end; default and forward modes. No fabricated combined interval should be emitted.

### 4. F4 — SERIOUS: stdio agent_read bypasses the result budget

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:369`.
- Trigger: the same default 200-line, 200-character-per-line window over stdio.
- Symptom: final returned text is **40,366 chars / 9,631 tokens**, exceeding 8,000 chars and 2,000 tokens. Structured data/JSON add further wire bytes.
- Evidence: `STDIO:369` calls `toolSuccess` directly; `STDIO:121` creates the unbudgeted envelope. `SERVER:219` returns it unchanged and `CLI:371` forwards the result. The probe exercised the real stdio dispatcher/formatter. No later budget step exists along this inspected route.
- Current handling: service line-windowing is the only bound. The HTTP test (`PD-SPEC:5965`) does not exercise stdio.
- Impact: ordinary output still costs almost five times the intended token allowance for external callers. Longer individual lines increase the discrepancy. Decision 2's output budget is not met end to end.
- Recommendation: share budget-aware agent-read rendering with HTTP, including recovery/spooling policy. Normalize the stdio name: `agent_read` is not the `ptah_agent_read` key in the content-hint map. Preserve the tail as required by F1, and make structured counts agree with visible output.
- Regression: measure returned stdio content plus relevant structured data, using the same long-line/final-sentinel fixture and both limits. This is pre-existing missing budget wiring exposed by the batch's end-to-end acceptance, not a regression caused by adding offset.

## Blocking issues

F1: final output is lost from the default HTTP response, while the displayed range says it is present. Evidence and correction are in finding 1.

## Serious issues

F2: missing stdio suppression. F3: false mixed-stream coordinates. F4: missing stdio budget. Evidence and corrections are in findings 2–4.

## Moderate and minor issues

No additional scored defects. The following checks and boundaries are recorded explicitly:

- HTTP `tail`/`offset` strings and negatives now fail before service access (`PD:598`, `PD:1108`). Finite nonnegative fractions still reach service flooring (`SERVICE:913`). Numeric valid callers retain behavior; malformed callers that previously received zero-clamped output now receive visible errors. This is intentional validation tightening, not a separate defect.
- Stdio's strict read schema now accepts integer offset (`STDIO:57`). It retains its positive-integer tail rule and rejects fractional offset. The common description uses `number` (`DESC:724`, `DESC:729`); schema harmonization is desirable, but fractional line inputs are not a separate probable-path finding here.
- Anonymous/workspace-only HTTP callers can poll freely (`PD:2455`). This exemption is acceptable for caller-specific response deduplication: without stable identity they must not suppress one another. This is not an abuse-rate limiter or authentication boundary.
- The map prunes entries at 60 seconds and on a backwards clock (`PD:2441`), removes terminal entries (`PD:2464`), and is weakly owned per API (`PD:2412`). It meets the specified TTL policy, though not a hard peak-cardinality bound within 60 seconds. No timers/listeners are added.
- The key is caller+agent (`PD:2463`); status and CLI session ID form the fingerprint (`PD:2468`). Suppressed calls do not extend the window (`PD:2470`). Lookup errors occur before the policy (`PD:1098`). Existing scoped specs verify identity separation, changes, expiry, terminal state, and rejection (`PD-SPEC:5719`).

## Data flow

1. **OK:** tool declaration advertises default/offset (`DESC:704`); HTTP and stdio validate (`PD:1108`, `STDIO:354`). Compatibility differences are recorded above.
2. **OK:** both transports pass all three read parameters (`PD:1120`, `STDIO:364`); `NS:324` forwards them to `readOutput`. API `types.ts:281` includes offset.
3. **OK:** the service selects independent stream tails/forward windows (`SERVICE:915`, `SERVICE:917`) and combines counts (`SERVICE:942`).
4. **F3:** rendering invents combined coordinates (`FMT:1262`).
5. **F1:** HTTP applies budget after rendering (`PD:3084`); prefix fitting drops the desired end (`BUDGET:430`). Spool holds the selected full window (`BUDGET:265`), not all 5,000 service-buffer lines.
6. **F4:** stdio skips budgeting (`STDIO:369`, `SERVER:219`, `CLI:371`).
7. **OK on identified HTTP / F2 on stdio:** fresh status is obtained first (`PD:1098`); repeated bodies are suppressed at `PD:2429`. Stdio formats every call directly (`STDIO:336`).

## Requirements fulfilment

| Requirement                                         | Status           | Gap / evidence                                                                              |
| --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| Offset across namespace, HTTP, stdio                | COMPLETE         | `PD:1120`, `STDIO:364`, `NS:324`; scoped specs pass                                         |
| Default tail never hides the end                    | PARTIAL          | Service selects tail; HTTP budget drops its end: F1                                         |
| Show totalLines/omittedLines                        | PARTIAL          | Present at `FMT:1221`, `STDIO:372`; not reconciled after HTTP budget: F1                    |
| Honest displayed window                             | PARTIAL          | Single-stream pre-budget case works; F1/F3 remain                                           |
| Describe 200-line default and offset                | COMPLETE         | `DESC:708`, `DESC:729`; practical budget behavior must be reflected after F1 fix            |
| Repeat status within 60 seconds returns one line    | PARTIAL          | Identified HTTP only: F2                                                                    |
| Changes, terminal state, lookup errors stay visible | COMPLETE on HTTP | `PD:2464`, `PD:2468`, `PD:2301`; scoped specs pass                                          |
| Caller isolation / anonymous exemption              | COMPLETE on HTTP | `PD:2448`, `PD:2463`, `PD-SPEC:5843`, `PD-SPEC:5861`                                        |
| Prune entries older than 60 seconds                 | COMPLETE         | `PD:2441`                                                                                   |
| End-to-end character/token budget                   | PARTIAL          | HTTP numerically fits but loses tail; stdio exceeds both: F1/F4                             |
| Temp spool test hygiene                             | COMPLETE         | `PD-SPEC:5880` mkdtemp; `PD-SPEC:5884` cleanup; independently checked                       |
| Regression guards prove intended behavior           | PARTIAL          | Tests pass with F1–F4 present; author-reported fails-before history not independently rerun |

Implicit requirements not addressed: shared transport policy, preservation of newest/error-bearing output after the final budget, and per-stream paging coordinates.

## Edge cases

| Case                           | Handled            | How                                             | Concern                          |
| ------------------------------ | ------------------ | ----------------------------------------------- | -------------------------------- |
| Empty output                   | YES                | `FMT:1240` checks total zero                    | No new defect                    |
| Offset past end                | YES                | `SERVICE:921`, `FMT:1254`                       | Not mislabeled as no output yet  |
| Short single stream            | YES                | Unchanged within budget                         | Scoped checks pass               |
| Ordinary long lines            | NO                 | Prefix cut of tail                              | F1                               |
| Both streams non-empty         | NO                 | Independent windows, combined range             | F3                               |
| Repeated identified HTTP calls | YES                | Fixed 60-second window                          | Fresh lookup preserves changes   |
| Terminal/error/session change  | YES on HTTP        | Full body or error                              | Stdio suppression absent, F2     |
| Anonymous HTTP calls           | YES, exempt        | No shared anonymous key                         | Polling possible by design       |
| Caller churn                   | PARTIAL            | TTL pruning and weak API ownership              | No hard peak-size cap            |
| Default stdio read             | NO                 | Only a line bound                               | F4                               |
| Spool failure                  | YES for disclosure | Failure trailer                                 | Not independently fault-injected |
| Hung/malformed service result  | NOT VERIFIED       | Awaited typed API, no new timeout/output schema | Residual runtime uncertainty     |

## Verification

Commands were run once, scoped as requested, using PowerShell `Select-Object -Last` instead of Unix `tail`:

| Check                                                                                     | Result                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache` | PASS: all three targets; 31.6 seconds; process exit 0. PowerShell wrapped native stderr in a `NativeCommandError` record, but Nx completed successfully. |
| `nx run degradation-audit:lint --skip-nx-cache`                                           | PASS; TOTAL 300                                                                                                                                          |
| `nx run ptah-electron:validate-deps --skip-nx-cache`                                      | PASS                                                                                                                                                     |
| `ptah_get_diagnostics`, absolute changed dispatcher path                                  | typescript-compiler: 0 errors, 0 warnings                                                                                                                |
| `node C:/Users/abdal/AppData/Local/Temp/ptah-b13-review-probe.cjs`                        | Reproduced F1–F4; HTTP control suppressed its second status call                                                                                         |

Probe methodology: esbuild loaded the real worktree formatter, HTTP dispatcher, stdio dispatcher, budget, reducer and token counter. Only unrelated agent-runtime error classes/constants and the unrelated SDK instruction string were stubbed. The agent API supplied deterministic windowed output/status. Thus this tests handler-to-final-response budgeting, not a live process or HTTP socket. An initial probe-only module filename error was corrected before successful execution. No repository source was modified.

Fixture: 5,000 distinct 200-character lines with a final failure sentinel; default window is last 200. A second fixture uses exactly 200 lines. Token measurements use `countTokensPiecewise` on returned text. HTTP spool root uses OS-temp `mkdtemp`, with parent/name validation before `finally` cleanup. Both successful probe runs reported cleanup; a subsequent `ptah-b13-*` directory scan was empty. The temporary probe script remains for reproduction and is not a repository deliverable.

Current regression gaps: `PD-SPEC:5965` asserts limits, stale pre-cut range and spool placement, but not final-output preservation. The new formatter window test uses empty stderr (`mcp-response-formatter.spec.ts:1305` in FMT's directory). The stdio read test uses only two short lines (`stdio-mcp-server.service.spec.ts:349` in SERVER's directory). Their passing cannot refute the probes. No tests were added in this read-only review, and no baseline checkout/fails-before rerun was attempted.

Scope: agent read/status flows, declarations/types, complete agent namespace and stdio dispatcher, relevant shared formatter/budget/spec behavior, and transport exits. Unrelated tool-handler bodies in the large shared dispatcher/formatter/catalog were not audited end to end; this verdict does not approve those tools. No live agent was spawned. Cancellation/disconnect, malformed typed results, and dependency timeout fault injection remain unverified.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for reproduced defects and routing evidence; MEDIUM for unexercised live-runtime failure behavior.
- Top risk: a routine default read hides the final failure while claiming that final line is displayed.
- What a robust implementation would add: shared budget-aware stream rendering that keeps newest output; honest post-budget counts and ranges; stdio throttle/budget enforcement; cross-transport tests for the final sentinel, actual coordinates, and final response limits.
