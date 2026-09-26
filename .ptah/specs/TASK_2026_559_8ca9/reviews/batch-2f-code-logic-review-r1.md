# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 2 |
| Moderate issues | 1 |
| Failure modes found | 4 |

Scope: Batch 2f, the complete named dispatcher, dispatcher spec and HTTP service, with the committed budget helper and relevant transport, approval, parser and DI dependencies. Requirements were read from context.md (Decisions 2, 3, 7), batches.md (plan risks, 2e follow-ups, 2f notes/tasks), executor report and the requested research-report sections. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. Ptah file search returned no AGENTS.md; no direct file-read tool was listed, so native reads were used. No source edits, git operations or raw session-log reads were performed. Consequently the exact uncommitted diff was not independently established; this review covers the named current files and attributes deviations using the executor report.

The central text path works: the helper is awaited, the callback receives the returned text, and telemetry is associated with the response object (protocol-dispatcher.ts:2193, :2195, :2204). However the new automatic write trusts an arbitrary URL path, and some successful text still bypasses enforcement. This supports 5 rather than 7–8; working central enforcement, green checks and intact host wiring distinguish it from a fundamentally broken implementation.

Paths below are relative to the worktree. Unless otherwise qualified, dispatcher references mean `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`; helper references mean the adjacent `tool-result-budget.ts`.

## Verification

- Requested command from the worktree root: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`. Exit 0; all three targets successful; 40.6 seconds. Output was tailed. No workspace-wide checks.
- Scoped `ptah_get_diagnostics` on the two production files reported TypeScript compiler diagnostics: 0 errors, 0 warnings. The worktree-local Nx run is the stronger checkout-specific evidence.
- TypeScript AST traversal found **56** calls to createToolSuccessResponse, all direct children of await expressions. The report's 55 counts the individual-tool sites but omits the additional execute_code call at :2358. No double-helper route was found.
- Isolated in-memory probes transpiled the actual dispatcher and helper with TypeScript. Actual reducer/token modules and AsyncLocalStorage were loaded; unrelated dispatch dependencies were stubbed. Filesystem writes were intercepted, not performed. These reproduce the branches and write destinations, not packaged-host integration:
  - approval input containing 50,000 characters returned **50,050 characters**, success, zero spool writes.
  - a successful screenshot plus a throwing callback returned `isError:true`, text `Tool ptah_browser_screenshot failed: observer failed`, no image.
  - a throwing execute_code engine plus a throwing callback returned JSON-RPC `-32603`, message `observer failed`, replacing the engine error.
  - unknown tool name `D:/private/secret-token` appeared verbatim in the new telemetry's tool field.
  - caller root `D:/workspace/../outside` selected `D:\outside\.ptah\tmp\mcp-out\<generated>.txt`; `\\server\share` selected that UNC share's spool directory. Relative `../relative` selected system temp, even with a valid host workspace available.
- Existing specs exercise JSON/log spooling and callback equality (:2178), execute_code success (:2265), ordinary errors (:2316), image identity (:2380), browser pin (:2406), and metadata preservation/stability (:2472–2506). They do not cover the four findings below.

## Five logic questions

### 1. How does this fail silently?

The automatic spool destination is selected from caller attribution without workspace validation (dispatcher:2264–2266; helper:438–446). A normal success can therefore persist raw output outside the intended workspace (F1). Approval success is also returned unchanged despite its advertised 8,000-character maximum (dispatcher:737–752, :532–536; F2). Browser HTML omission itself is disclosed by an omission marker and spool trailer (spec:2434–2444), so it is not a new silent-loss finding.

### 2. What user action produces unexpected behaviour?

An oversized approval input exceeds the declared budget (F2). Capturing a screenshot while the transcript callback throws converts a completed capture into a failed tool response (dispatcher:1302, :2034–2055; F3). A caller selecting an arbitrary workspace URL changes where raw output is written (F1).

### 3. What input data produces a wrong answer?

A long approval input is echoed without enforcement (dispatcher:746–749). An arbitrary nonempty tool-name string becomes telemetry without sanitization (dispatcher:624–626, :665; F4). Dense text within the char ceiling is **not** a bypass: both dispatcher:2249 and helper:232 use the same bounded countTokensPiecewise function and token limit.

### 4. What happens when a dependency fails?

The budget helper handles reduction/spool failures with capped text and an explicit failure trailer (helper:216–222, :260–278, :492–494, :541–580). A failed workspace lookup falls back to temp (dispatcher:2268–2276). The ordinary success observer and telemetry logger are isolated (dispatcher:2194, :605, :2304); they do not wrap actual tool execution and therefore do not swallow its errors. The two unguarded callbacks behave differently: screenshot loses a success, while execute_code's error callback replaces an existing failure with a JSON-RPC error (F3). A logger throw permits only one attempted telemetry emission, not a guarantee that a line is persisted.

### 5. What is missing that the requirements never mentioned?

A trusted spool-root policy is missing: URL attribution is not filesystem authorization (http-server.handler.ts:264–269). Approval is a machine-readable control response whose updatedInput must remain intact; a generic reducer/trailer cannot safely be applied to it without defining an exception or a different protocol (approval-prompt.handler.ts:98–115). The privacy claim also needs an allowlisted telemetry tool identity (F4). These are contract gaps, not formatting concerns.

## Failure modes

### F1 — Unvalidated caller root becomes an automatic filesystem write (Blocking)

- Trigger: an oversized tool result on a request whose terminal /workspace/ URL segment names an arbitrary absolute path, a path with parent segments, or a UNC share.
- Symptom: raw output is persisted under that destination's .ptah/tmp/mcp-out directory with the host process's permissions.
- Evidence: http-server.handler.ts:305–312 decodes without workspace validation; :381 installs the value on the request. Dispatcher:2264–2266 gives it priority. Helper:438–446 only tests absoluteness and resolves the path; :475–480 creates the directory and writes raw text.
- Current handling: request ids are sanitized and files use exclusive creation, preventing filename traversal and ordinary overwrite. Neither protection confines the root. Relative roots fall back to temp; they do not traverse the workspace.
- Recommendation: derive spool roots from host/session-owned workspace records; validate declared roots against those records before use. Canonicalize approved roots, account for symlink/junction containment, and reject or fall back for unrecognized roots. Allow UNC only when it is an explicitly trusted workspace. Keep temp fallback and collision protection.
- Reproduction: intercepted actual helper writes selected D:\outside for D:/workspace/../outside, and selected \\server\share for a UNC root. No network connection or outside-worktree write was made.
- Impact boundary: this is not an arbitrary-file overwrite or a demonstrated remote privilege escalation. The transport is localhost and explicitly unauthenticated. It is a new automatic raw-output write to unverified local/network destinations; an attribution string must not silently authorize that side effect.

### F2 — Successful control/mixed responses bypass the declared text budget (Serious)

- Trigger: approval_prompt with a large input; alternatively a mixed screenshot response with oversized text metadata.
- Symptom: approval returns more than the newly advertised maximum, without reduction, spool reference or callback notification. Screenshot text also bypasses the text budget.
- Evidence: dispatcher:737–752 constructs approval success directly; :756 delegates to approval-prompt.handler.ts, whose :98–115 and :124–140 also build success directly. Dispatcher:1308–1323 directly returns screenshot image plus text. Metadata is stamped on every tool at dispatcher:532–536.
- Current handling: only the single-string helper path is budgeted. Images correctly remain untouched, but the entire image branch was exempted instead of only its image block. The approval telemetry's null counts acknowledge lack of measurement, not enforcement.
- Recommendation: define and document approval's machine-control exception and make its advertised metadata truthful; do not truncate updatedInput or append a trailer to JSON consumed by permission machinery. Centralize enforcement for model-facing successful text blocks, preserving image blocks and other response fields, with a shared total response budget. Add oversized approval and mixed/multiple-text-block coverage.
- Reproduction: Electron/no-webview branch returned 50,050 characters for a 50,000-character input, with no spool write.
- Qualification: current production constructors emit at most one text block per result. No existing multi-text-block producer was found; there is no aggregate enforcement ready for one. This is not evidence of a presently reachable second-text-block duplication bug.

### F3 — Unguarded observers replace screenshot success and execute_code failure (Serious)

- Trigger: onToolResult throws.
- Symptom: screenshot success becomes a tool error with no image; execute_code failure becomes a JSON-RPC internal error containing the observer failure instead of the actionable execution error.
- Evidence: dispatcher:1302 runs before screenshot response construction; :2034–2055 catches it as a tool failure. Dispatcher:2340 runs inside the execute_code catch without a guard; the outer handler at :234–246 converts the observer exception.
- Current handling: ordinary success observers are guarded at :2194, but these two remain direct calls. The execute_code error branch cannot break a successful execution because success now exits separately at :2358.
- Recommendation: use runObserver for both remaining callbacks (and the execute_code error logger at :2337), keeping the original result/error intact. Add throwing-observer regressions.
- Reproduction: actual dispatcher produced the two results recorded under Verification.
- Scope: these direct calls predate the batch, as the executor explicitly reports. They remain relevant to the requested success-preservation review; do not describe them as newly introduced regressions. No production setToolResultCallback caller was found in apps/libs, so the demonstrated trigger is the supported injected callback contract, not a claimed frequent live-host failure.

### F4 — Arbitrary request names enter supposedly content-free telemetry (Moderate)

- Trigger: a tools/call request uses a nonempty unknown tool name containing a path, secret-like value, newline, or a large string.
- Symptom: that value is logged verbatim in the new per-call debug record.
- Evidence: dispatcher:624–626 accepts every nonempty string, and :665 returns it in telemetry; dispatch rejects unknown names only later at :767.
- Current handling: arguments and result bodies are absent from this new record, and resultChars aggregates text only (:655–660). Tool identity itself is not restricted to registered names.
- Recommendation: map unknown names to a fixed unknown label; use known tool names from a static registry/allowlist. Do not log the rejected raw name in this telemetry.
- Reproduction: tool name D:/private/secret-token was emitted verbatim as tool.
- Impact: violates the requested no-content/no-paths/no-secrets property for malformed calls. This does not claim valid ordinary tool results leak through the new metric.

## Blocking issues

### F1 — Workspace attribution authorizes unconfined spooling

- File: protocol-dispatcher.ts:2264.
- Scenario: URL names an unapproved absolute or UNC root; ordinary output exceeds its budget.
- Impact: raw tool output is written outside the trusted workspace, potentially onto a network share.
- Fix: validate against trusted host/session workspace roots before passing spoolRoot; canonical containment and safe fallback as described in F1.

## Serious issues

### F2 — Universal budget declaration is not universally enforced

- File: protocol-dispatcher.ts:737.
- Scenario: approval input exceeds 8,000 chars; successful mixed response text skips the helper.
- Impact: consumers receive oversized success text under a false advertised maximum.
- Fix: resolve approval's control-response exception explicitly and budget successful model-facing text without changing image blocks.

### F3 — Observer failures replace the actual outcome

- File: protocol-dispatcher.ts:1302 and :2340.
- Scenario: callback throws on screenshot success or execute_code failure.
- Impact: image is lost or the real error is replaced.
- Fix: guard observer-only calls and retain original outcomes.

## Moderate and minor issues

- F4 (Moderate), protocol-dispatcher.ts:624: sanitize telemetry identity through a known-name allowlist.
- Coverage suggestions only, not additional failure modes: thrown dispatch/logger paths, token-dense under-char-limit input, trusted-root rejection, concurrent spools and mixed text/image budgeting are not covered by the new specs at protocol-dispatcher.spec.ts:2114–2509.

## Data flow

1. HTTP extracts caller attribution into the request — **GAP F1**: decoded root is not authenticated/validated (http-server.handler.ts:305–312, :381).
2. tools/call binds AsyncLocalStorage — **OK**: caller identity survives awaits without process-global root mutation (dispatcher:217–224; mcp-request-context.ts:44–49).
3. Dispatcher awaits tool work — **OK** for the audited success sites; errors retain their existing envelopes (dispatcher:704–720, :2034–2055).
4. Success text enters createToolSuccessResponse — **OK** at all 56 call sites; **GAP F2** for approval and screenshot text.
5. Pre-check applies both limits — **OK** and behaviorally identical to helper identity branch (dispatcher:2244–2253; helper:231–244). Under-budget input invokes applyToolResultBudget zero times; oversized input once. Thus literal “exactly once for every success” is not met, though the identity optimization is sound.
6. Oversized input resolves root, reduces, spools and fits trailer — **GAP F1** for root trust; budget/helper failures otherwise have explicit fallback (helper:246–278).
7. Callback receives budgeted text, then response is recorded — **OK** on central path (dispatcher:2193–2204); **GAP F3** on the two direct observer calls.
8. finally emits one dedicated result telemetry attempt — **OK** for response, error and thrown dispatch; **GAP F4** for raw name (dispatcher:603–611, :672–675). Existing request/debug and tool-specific log lines still exist; “one line” means one new result metric, not one total log call.
9. HTTP awaits its own response and sends its matching id — **OK** (http-server.handler.ts:383–386). Response-local WeakMap data cannot bleed across simultaneous calls.

Concurrency: callbacks now occur after reduction/spooling, so different calls may complete in a different order. They carry request ids, and neither dispatcher nor HTTP requires arrival-order delivery. AsyncLocalStorage keeps roots isolated; exclusive-create spool names prevent equal JSON-RPC ids overwriting each other (helper:455–480). Parser queryMulti awaits initialization before a synchronous parse/query section and deletes per-call trees/queries in finally (tree-sitter-parser.service.ts:561–660). No new ordering or resource-lifetime defect was established. Packaged-host behavior and live concurrent stress were not exercised.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Central text success and execute_code budgeting | PARTIAL | 56 calls awaited; approval and screenshot text bypass; identity pre-check avoids helper call |
| Callback sees model text | PARTIAL | Central helper yes; screenshot observer receives separate formatter output; approval no callback |
| Inline image unchanged (Decision 3) | COMPLETE | Image bytes unchanged at dispatcher:1314–1316; jpeg/re-encode work belongs to Batch 17 |
| Char/token pre-check equivalence | COMPLETE | Same length test and bounded counter as helper |
| Safe spool placement | PARTIAL | Required priority implemented, trust validation absent (F1) |
| One debug result metric including failures | COMPLETE | finally emits one attempt; counts null for unmeasured responses |
| Content/path/secret-free new metric | PARTIAL | Unvalidated tool name (F4) |
| tools/list metadata preservation and stability | COMPLETE | Spread preserves keys; stable table and order; specs:2492–2506 |
| Outliner wiring across hosts | COMPLETE | Static registrations and optional injection verified; packaged smoke remains unrun |
| Browser override pin with recoverable formatted output | COMPLETE | Spool byte-equality and trailer asserted; prior formatter cap remains |
| Async response ordering | COMPLETE | Awaited response-local flow; no new race established |

DI evidence: http-mcp-server.service.ts:290 injects the parser optionally as the last constructor argument; :296 constructs its outliner and :379 passes it to dispatch. workspace-intelligence/src/di/register.ts:172 registers the parser singleton. VS Code phase-2-libraries.ts:76 precedes LM tools at :116; Electron phase-2-libraries.ts:173 precedes phase-3-storage.ts:134; cli-engine/src/lib/container.ts:620 precedes :774. vscode-lm-tools/src/lib/di/register.ts:90 registers CodeExecutionMCP lazily. PtahAPIBuilder already requires this parser at :351. No registration or optional-position incompatibility found; executor's additional host typechecks are reported evidence, not independently repeated here.

Implicit requirements not addressed: trusted spool destinations; distinct handling of machine-control approval JSON; aggregate budget semantics for future multiple text blocks; allowlisted telemetry identity.

## Judgment of deviations 1–5

| Deviation | Judgment |
| --- | --- |
| 1 — HTTP service edit outside file list | ACCEPT. Necessary composition-root wiring, additive optional final parameter, existing shared parser registration in all hosts. No extra parser lifetime introduced. |
| 2 — Pre-check before applyToolResultBudget | ACCEPT behaviorally, not literally “exactly once.” It cannot accept text the current helper rejects: same UTF-16 ceiling and same bounded token function. Extra counting is restricted to inputs within the tool's char cap (default 8,000; browser 33,792; surface 548×1024 from shared surface-catalog.ts:117). Oversized-char input skips the pre-count; token-over-budget/under-char input adds a bounded pass. A lazy spool-root supplier in the helper would remove duplication if the literal single-entry invariant matters. |
| 3 — execute_code success callback guarded | ACCEPT change; REVISE remaining observer gap F3. Success is no longer inside the execution catch. Its remaining unguarded error callback replaces an error, not a success. Screenshot's unguarded callback does break success. |
| 4 — null counts for unbudgeted responses | ACCEPT for errors and images: honest unmeasured values, no recount. Does not justify unbudgeted approval/mixed text or F2. Exactly one dedicated metric attempt also covers throws; no guarantee when logger itself fails. |
| 5 — browser pin reduces without a final cut | ACCEPT within the explicitly deferred browser follow-up. Markdown omission has a marker and the formatted raw output has a spool reference, satisfying the new reduction's recoverability. It is not loss without a reference. |

The browser spool is **the formatter's capped output**, not the complete original page: mcp-response-formatter.ts:1473–1482 caps both sections before dispatcher:1446. Likewise serializeResult truncates at 50 KiB before dispatcher:2332 (code-execution.engine.ts:477, :500–505). These pre-existing limits prevent an end-to-end claim that all original page/execution data is recoverable. The new helper preserves its complete formatted input; do not present the pin as proof that the earlier caps satisfy Decision 7. Browser behavior is explicitly carried by the 2e follow-up, rather than counted again as a new 2f defect.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/short string | YES | Identity pre-check, exact returned text | Helper invoked zero times by design |
| Under chars, over tokens | YES | Same bounded counter rejects identity path | Dedicated dispatcher regression would help |
| Huge JSON/log | YES | Reduce, fit, spool, trailer | Existing tests verify default limits |
| Several text blocks | NO | No generic aggregate enforcement | No current multi-text producer; define before adding one |
| Image plus text | PARTIAL | Image remains byte-identical | Text bypass and throwing observer |
| Oversized approval JSON | NO | Echoed unchanged | 50,050-char reproduction |
| Relative caller root | YES | Helper falls back to temp | Does not retry available host workspace |
| Absolute parent traversal / UNC | NO | Resolved and used | F1 |
| Failed spool / reducer | YES | Explicit failure trailer / fallback | Raw output may be unavailable, honestly stated |
| Failed callback | PARTIAL | Central success guarded | F3 |
| Unknown name with sensitive text | NO | Raw name logged | F4 |
| Concurrent requests, repeated ids | YES | AsyncLocalStorage, response WeakMap, exclusive-create names | Static trace; no live stress test |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the reproduced branches and static wiring; MEDIUM for packaged-host/concurrency behavior.
- Top risk: arbitrary URL attribution controls the new automatic raw-output spool write.
- What a robust implementation would add: trusted-root validation; an explicit approval control-response contract with truthful metadata; text-only enforcement preserving mixed content; guards on the remaining observers; sanitized telemetry identity; targeted regressions for these failures.

