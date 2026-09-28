# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 13, review **r2**, after revision round 1. Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. Source was read-only; no git operations, source edits, staging, or commits were performed.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 0              |
| Failure modes found | 2              |

The four original reproductions are corrected: normal tail reads preserve the final failure, mixed streams have independent ranges, stdio status repeats are suppressed, and stdio text fits the result budget. Two long-line cases remain: the native read tool cannot recover a partial line's middle, and one oversized stream unnecessarily truncates the other stream's otherwise fitting final line. Both have concrete reproductions below.

6/10 rather than 4/10: the ordinary read/status flows and transport parity now work, and the new guards exercise the original failures. Below 7–8: long agent output lines can still hide diagnostic content through the normal native read path, including a final failure that could fit inline. Partial output is explicitly disclosed, so these are Serious rather than Blocking silent-completeness defects.

Inputs retained from r1: task `context.md` Decisions 2/4/17, Batch 12/13 in `batches.md`, research contract, repository review instructions, and archived r1. Newly read: `batch-13-executor-report.md`, section `Revision round 1 (r1 REVISE 4/10)`, the complete new renderer/spec/throttle, stdio dispatcher, service/type additions, and affected transport/spec paths. No new instruction file was supplied. Unrelated bodies in the large multi-tool dispatcher/catalog/formatter were not audited end to end; no approval of unrelated tools is implied.

Source shorthand (worktree-relative):

- **VIEW:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-read.view.ts`
- **VIEW-SPEC:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-read.view.spec.ts`
- **THROTTLE:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-status-throttle.ts`
- **PD:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- **PD-SPEC:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- **STDIO:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts`
- **STDIO-SPEC:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts`
- **SERVICE:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- **OUTPUT:** `libs/shared/src/lib/types/agent-process.types.ts`
- **BUFFER:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.ts`

## r1 findings status

| r1 finding                                                           | r2 status                                                             | Evidence                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1/F1: generic budget cut drops newest output, retaining false range | Original reproduction FIXED; long-line concerns remain as R2-S1/R2-S2 | `VIEW:82`, `VIEW:168`, `PD:1124`: selection precedes the generic budget and keeps the tail. 5,000 × 200-char fixture returns lines 4963–5000 with FINAL_FAILURE, 7,802 chars / 1,879 tokens; exactly-200 fixture returns lines 162–200, 7,998 chars / 1,843 tokens. No cut trailer or spool.             |
| S1/F2: stdio status unthrottled                                      | FIXED                                                                 | `STDIO:344` invokes shared policy; `THROTTLE:60`. Repeated call returns a short line and only agentId/status/unchangedSince structured data. Expiry, session change, terminal status, and errors pass independent probes.                                                                                |
| S2/F3: false mixed-stream ranges                                     | FIXED                                                                 | `OUTPUT:222`, `SERVICE:951`, `VIEW:70`, `VIEW:146`, `VIEW:209`. For 300 lines per stream, offset 100/tail 2 displays separate 101–102 ranges, each of 300; total shown is 4 of 600.                                                                                                                      |
| S3/F4: stdio read unbudgeted                                         | FIXED for the established text-result budget                          | `STDIO:404` uses the same renderer and canonical `ptah_agent_read` budget. The original fixtures produce exactly the HTTP text and visible counts. Their text plus serialized structured metadata measured 1,957 / 1,916 tokens respectively. The text bound is not a JSON wire-envelope size guarantee. |

The new tests now assert final markers and actual range endpoints (`PD-SPEC:6030`, `STDIO-SPEC:547`), rather than accepting a pre-budget interval. The author reports seven fails-before tests; historical code was not restored or rerun by this reviewer.

## Five logic questions

### 1. How does this fail silently?

No recurrence of the original false full-tail claim was found in the r1 fixtures. Partial-line loss is now disclosed, but the recovery instruction is ineffective for the omitted middle (`VIEW:215`, R2-S1). A peer stream can remove a fitting final failure prefix (`VIEW:90`, R2-S2); the returned partial notice does not restore that diagnostic information.

### 2. What user action produces unexpected behaviour?

Following `pass offset/tail to page` on a large single line only alternates between its prefix, suffix, and an empty page (`SERVICE:931`, `VIEW:189`). Reading a short final result alongside an oversized peer stream can lose that result's leading failure marker, even though it fits on its own and could fit with a smaller peer excerpt (`VIEW:82`, `VIEW:90`).

### 3. What input data produces a wrong answer?

Long single-line output such as serialized diagnostics/JSON triggers R2-S1. A 1,892-character final stdout line and one 30,008-character stderr line trigger R2-S2. Ordinary mixed streams and 200-character-line tail fixtures now produce accurate coordinates (`VIEW:171`, `VIEW:209`).

### 4. What happens when a dependency fails?

Both transports await status before suppressing its body (`PD:1099`, `STDIO:344`), so lookup errors remain tool errors rather than cached success. The independent stdio error-after-success probe returned isError:true; terminal and changed-session results remained full. Read failures are caught (`STDIO:418` and the HTTP tool catch). A spool failure cannot currently be observed for renderer partials because no spool is attempted (R2-S1). Live-process hangs, transport cancellation, and malformed typed return objects were not fault-injected.

### 5. What is missing that the requirements never mentioned?

Once the renderer clips within a line, line offsets alone no longer provide lossless recovery. Character-level continuation or full-output spooling is necessary (`VIEW:188`, `VIEW:215`). Also, budget allocation must distinguish a stream requiring partial output from a peer whose whole final line fits, instead of forcing both through the same partial-character count (`VIEW:90`, `VIEW:125`).

## Failure modes / new defects

### R2-S1 — SERIOUS: omitted middle of a partial line cannot be recovered through agent_read

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-read.view.ts:90`; also `VIEW:189`, `VIEW:215`, `PD:1124`, `STDIO:404`.
- Trigger: a single 40,026-character stdout line: `BEGIN ` + 20,000 `a` characters + `MIDDLE_FAILURE` + 20,000 `b` characters + ` END`.
- Symptom: default read returns only the last 1,939 characters. `offset:0, tail:1` returns only the first 1,944 characters. Neither contains MIDDLE_FAILURE. `offset:1, tail:1` returns no lines. No `.ptah` spool directory is created.
- Evidence: independent probes through the real HTTP dispatcher/renderer/budget measured 2,117 chars / 2,000 tokens for the default suffix and 2,123 chars / 2,000 tokens for the forward prefix. Both tell the caller to use offset/tail to page. The shared stdio renderer has the same behavior. Changing tail cannot subdivide this one line; changing the line offset skips it.
- Current handling: `VIEW:90` clips to edge characters; `VIEW:215` still gives only line-paging guidance. The already-short text is sent to the HTTP generic budget (`PD:1124`), which cannot spool content it was never given. Stdio likewise sees only the rendered view (`STDIO:404`). The module's claim that offset/tail reach every line does not make every character reachable.
- Impact: content in the middle of a long diagnostic/result line is inaccessible through the advertised native read interface. This contradicts Decision 7's full-output recovery intent and regresses the r1 spool's ability to recover the selected full window. This is not a claim of permanent deletion from the agent's backing buffer or that no other low-level API exists; the tool's advertised recovery path is broken.
- Recommendation: spool the unabridged selected stream/window whenever even one line is clipped, with a trustworthy locator inside the final budget, or add a real stream+line+character cursor. Retain the inline tail. Do not claim line paging recovers a partial line's omitted characters. Recoverable whole-line omissions can continue using ordinary offsets.
- Regression required: place a unique marker in the middle of an over-budget line. Follow the returned continuation or read its returned spool and prove the marker is reachable. Test both transports and spool-write failure disclosure. The existing oversized-line test (`PD-SPEC:6066`) only checks a marker placed at the very end and explicitly expects no spool through `expectFitsUntouched` (`PD-SPEC:6018`).

### R2-S2 — SERIOUS: shared partial cap discards a peer stream's otherwise fitting final failure

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-read.view.ts:82`; also `VIEW:90`, `VIEW:125`, `VIEW:188`.
- Trigger: stdout's only/final line is `FINAL_FAILURE ` + `summary details; ` repeated 110 times + ` OUT_END` (1,892 characters). Stderr's only/final line is 30,000 `y` characters + ` ERR_END` (30,008 characters).
- Symptom: stdout alone returns in full, including FINAL_FAILURE, at **1,978 chars / 366 tokens**. Adding stderr makes the renderer return only the last **1,617 characters of each line**, at **3,525 chars / 2,000 tokens**. FINAL_FAILURE disappears from stdout even though its complete final line can fit alongside a smaller stderr excerpt.
- Evidence: independent real-dispatcher probe; the text explicitly labels both as partial. A feasibility control preserving all stdout and only the final 408 stderr characters was 2,408 chars / 476 tokens before adding a partial-stderr notice, leaving ample room for that notice. This control is an allocation demonstration, not a claim the current renderer emits that corrected view. Standard 200-character final lines with a huge peer were also tested in both directions: those final markers survived; total starvation is not universal.
- Current handling: one `keep` applies to both streams. If one whole line from each cannot fit, both drop to keep=0 and share the same `partialChars` (`VIEW:82`, `VIEW:90`, `VIEW:125`). There is no mixed candidate with a whole final stdout line and partial stderr, or vice versa.
- Impact: a noisy stream unnecessarily hides the error/result-bearing portion of the other stream's final line. This is a significant default-read failure, not just cosmetic budget underutilization. The literal last characters still survive and the partial read is disclosed; the failure marker at the start of the final line does not. Paging to the line prefix may recover it, but defeats the required read-once final-result behavior.
- Recommendation: allocate stream budgets independently. First preserve each fitting whole edge line; truncate only the stream whose edge line requires it, using residual budget with honest per-stream ranges/partial metadata. Fill additional lines afterward. A fix for R2-S1 alone would supply recovery but leave this avoidable inline loss.
- Regression required: the asymmetric fixture above, then swap streams. Assert the short stream's entire final line and FINAL_FAILURE survive while the oversized peer has a truthful partial representation, with both final text limits honored. `VIEW-SPEC:112` uses similarly sized stream lines and does not expose this case.

## Blocking issues

None found in this revision. The reproduced new partial losses are disclosed; neither reproduces r1's false complete-range claim.

## Serious issues

R2-S1: no native recovery for a partial line's middle. R2-S2: avoidable truncation of a fitting final line due to its peer. Evidence and concrete corrections are above.

## Moderate and minor issues

No additional scored defects. The shared line cap does reduce the number of short lines when the other stream is verbose. That alone is consistent with a bounded window and honest omission; the scored issue is the stronger, reproduced loss of a fitting final failure line in the partial fallback.

## Shared type, capacity, and throttle checks

- `AgentOutput.stdoutTotalLines` / `stderrTotalLines` are required additive fields (`OUTPUT:222`, `OUTPUT:224`). The sole production readOutput producer assigns them from the same parsed windows used for totalLines (`SERVICE:939`, `SERVICE:951`). Repository searches for exact `AgentOutput`, the new fields, and production readOutput calls found no frontend constructor of this type. Frontend streaming uses the distinct `AgentOutputDelta` contract. No remaining formatAgentRead reference was found. The namespace forwards the object; the three affected projects' tests/typechecks pass. This is repository-consumer evidence, not a promise about unknown external TypeScript consumers implementing the exported interface themselves.
- Totals describe parsed retained buffer contents, not all output ever emitted (`SERVICE:906`, `SERVICE:919`). Capacity trimming changes the stored buffer and sets truncated (`BUFFER:66`, `BUFFER:73`). A source-method probe exercised the actual readOutput method and actual count/tail/trim helper code with minimal manager state: empty totals 0/0, newline/partial-line totals 2/1, blank-line totals 3/2, and capacity-trimmed totals **9,709 stdout + 2 stderr = 9,711**, shown 202, truncated true. Totals remained unchanged by forward paging. No new off-by-one or loss of the capacity flag was found.
- `THROTTLE:67` uses a WeakMap per API owner; `THROTTLE:72` prunes entries aged at least 60 seconds or dated in the future. Caller+agent keys remain independent (`THROTTLE:88`); status/session fingerprints are checked (`THROTTLE:93`); terminal calls delete entries (`THROTTLE:89`). Short calls do not refresh timestamps. No timer/listener is introduced. This meets the specified TTL pruning contract, not a hard cardinality bound for an arbitrarily busy 60-second interval.
- HTTP and stdio pass the API owner and transport identity (`PD:2408`, `STDIO:346`). A cross-transport probe using the same API object and caller identity correctly suppressed the stdio repeat after an HTTP full response. Different server API objects remain isolated by design. Expiry, new CLI session ID, terminal status, and a rejected lookup passed. Anonymous calls returned full bodies. Stdio's short structured response contains no full agent body, and its wording gives a retry time rather than promising a completion notification the host cannot receive.

## Data flow

1. **OK:** validated tail/offset reach the service through both dispatchers; type additions are populated after adapter parsing (`SERVICE:906`, `SERVICE:951`).
2. **OK:** per-stream start positions derive from total minus selected length for tail, or normalized offset for forward (`VIEW:94`).
3. **OK for ordinary lines:** renderer finds a fitting whole-line window before generic HTTP budgeting (`VIEW:82`, `PD:1124`). Exact stream ranges/counts are generated from the actual selection (`VIEW:171`, `VIEW:209`).
4. **R2-S2:** when the combined edge lines do not fit, one shared character allowance replaces both streams with partial lines (`VIEW:90`, `VIEW:125`).
5. **R2-S1:** partial text replaces the raw line before the final response budget, with only line-based recovery guidance (`VIEW:189`, `VIEW:215`).
6. **OK:** stdio uses the canonical budget and visible structured counts (`STDIO:404`); both status paths use the shared policy before choosing a full or short response (`THROTTLE:60`).

## Requirements fulfilment

| Requirement                                      | Status                          | Evidence / gap                                                                       |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| Offset/default-window plumbing                   | COMPLETE                        | `PD:1121`, `STDIO:397`, `SERVICE:915`; original routing guards pass                  |
| Retain newest final output under budget          | PARTIAL                         | Ordinary r1 fixtures fixed; fitting peer's final failure can still be clipped, R2-S2 |
| Exact independent stream ranges                  | COMPLETE for reproduced cases   | `VIEW:171`, `VIEW:209`; original mixed-stream probe passes                           |
| Recover omitted content                          | PARTIAL                         | Whole lines page; partial-line middle cannot, R2-S1                                  |
| Per-stream service totals and capacity semantics | COMPLETE                        | `SERVICE:951`, source-method capacity probe, three-project checks                    |
| HTTP/stdio status repeat policy                  | COMPLETE for tested cases       | shared `THROTTLE:60`; identity/expiry/change/error probes                            |
| Bounded map retention                            | COMPLETE per specified TTL rule | `THROTTLE:72`; weak owner, no timer                                                  |
| HTTP/stdio text limits                           | COMPLETE for probes             | shared renderer; returned text measured in chars and tokens                          |
| Guards against asymmetric partial-line loss      | MISSING                         | R2-S2 fixture not covered by equal-width tests                                       |
| Spool test hygiene                               | COMPLETE                        | `PD-SPEC:5880`, `PD-SPEC:5884`; probe mkdtemp roots cleaned                          |
| Nine unrelated formatting edits restored         | NOT VERIFIED                    | Role forbids git operations; see verification limitation                             |

Implicit requirements not addressed: lossless character-level recovery after partial-line rendering, and preserving a fitting stream's final line independently of an oversized peer.

## Edge cases

| Case                                                       | Handled                  | Evidence / concern                                                   |
| ---------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| 5,000 × 200-char output                                    | YES                      | Final marker retained, exact 4963–5000, within text limits           |
| Exactly 200 × 200-char output                              | YES                      | Final marker retained, exact 162–200; reduced count disclosed        |
| Mixed streams, forward window                              | YES                      | Separate 101–102 ranges of 300                                       |
| Empty/trailing-newline/blank-line/capacity-trimmed buffers | YES                      | Source-method probe agrees with independently counted retained lines |
| Huge peer plus 200-char final line                         | YES in both directions   | Both edge markers retained; context narrowed honestly                |
| Huge peer plus otherwise fitting 1,892-char final line     | NO                       | R2-S2                                                                |
| Marker in middle of 40,026-char line                       | NO                       | R2-S1; prefix/suffix/next-line requests cannot retrieve it           |
| Repeated/expired/session-changed/terminal/error status     | YES in probes            | Full/short/error behavior preserved                                  |
| Anonymous caller                                           | YES, deliberately exempt | Full answers; no shared anonymous throttle bucket                    |
| Live dependency timeout/cancellation/malformed result      | NOT VERIFIED             | No live subprocess fault injection; no new timeout contract          |

## Verification

Independent commands, each run once with one completion read; PowerShell `Select-Object -Last` substitutes for Unix tail:

| Check                                                                                                                                              | Result                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime @ptah-extension/shared --skip-nx-cache` | PASS: all nine targets, process exit 0, Nx duration 1m 19s                                                                               |
| `nx run degradation-audit:lint --skip-nx-cache`                                                                                                    | PASS, TOTAL 300                                                                                                                          |
| `nx run ptah-electron:validate-deps --skip-nx-cache`                                                                                               | PASS                                                                                                                                     |
| Scoped `ptah_get_diagnostics` on VIEW/SERVICE/OUTPUT                                                                                               | Unavailable after 45 seconds; one cache retry also unavailable. No clean diagnostic result is claimed. Independent Nx typechecks passed. |
| `node C:/Users/abdal/AppData/Local/Temp/ptah-b13-review-r2.cjs`                                                                                    | Original probes pass; R2-S1/R2-S2 reproduced; throttle controls pass                                                                     |
| `node C:/Users/abdal/AppData/Local/Temp/ptah-b13-r2-capacity.cjs`                                                                                  | Totals correct for all four retained-buffer cases and forward paging                                                                     |

The main probe bundles actual worktree renderer, dispatchers, budget and token counter; it stubs the agent API and unrelated runtime error classes/SDK instruction string. It does not spawn an agent or run a network server. The capacity probe extracts the actual readOutput method and helper implementations from source into a temporary minimal class; it is not a full DI/runtime test. Temporary probe files remain in the OS temp directory for reproduction. All main-probe mkdtemp roots were validated before cleanup and reported removed in finally. No spool directory was produced by the successful renderer outputs; for partial lines this is the R2-S1 recovery gap, not a hygiene success that excuses the gap.

Budget measurements apply to the returned text using the repository's countTokensPiecewise definition, matching its text-budget helper. Representative stdio text+structured token totals were also measured above. The renderer budgets text only; JSON framing and metadata are not claimed to fit inside the same character ceiling.

The requested git status/diff-stat check was **not performed**: the governing reviewer role prohibits git operations. The author's claim that nine unrelated formatter edits were restored is therefore unverified here; file timestamps alone would not establish byte-for-byte restoration. This is a verification limitation, not an invented unrelated-change finding. No source change was made by this reviewer. No historical checkout, fails-before rerun, or live timeout/disconnect test was performed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the two reproduced defects and r1 probe results; MEDIUM for unexercised live-runtime failure behavior and consumer coverage beyond this repository.
- Top risk: partial rendering either makes the important middle of a long result unreachable through agent_read or needlessly removes a fitting final failure because the peer stream is oversized.
- What a robust implementation would add: a lossless recovery locator/cursor for partial lines; independent stream allocation preserving fitting whole edge lines; asymmetric and middle-marker regressions on both transports.
