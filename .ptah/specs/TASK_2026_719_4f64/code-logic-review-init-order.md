# Init-order logic and security review

**Score: 4/10 — REVISE.** Two Blocking findings; zero Serious or Moderate findings; two material failure modes. The first-turn ordering and later-turn gates address the reported deadlock, but the tool-execution boundary is bypassable and main-chat disposal is not terminal. Those security failures prevent a 5–6 score; the implemented identity/init/persistence ordering and focused regressions distinguish this from a fundamentally absent implementation.

Scope: saved six-file `bugfix-init-order.diff`, the three touched production files, changed tests and their fixtures, permission-option construction, prompt-gate behavior, task requirements, and both Session 11 report sections. Paths below are relative to the worktree. Abbreviations:

- **Lane:** `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
- **Main:** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- **Adapter:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
- **Options:** `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`
- **Main spec:** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- **Lane spec:** `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`
- **Adapter spec:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`
- **Report:** `.ptah/specs/TASK_2026_719_4f64/bugfix-init-order-report.md`

## Findings

### F1 — Blocking: permission auto-approval bypasses the admission hold

**Evidence:** Lane:766 installs the hold solely in `canUseTool`; Main:835 does likewise. Lane:783 releases the first prompt before binding at Lane:815. Options:262 maps YOLO to `bypassPermissions`, and Options:270 returns that mode with `allowDangerouslySkipPermissions: true`. Existing hooks are simply passed through at Options:237.

The installed SDK explicitly states that `bypassPermissions` auto-approves tools before consulting `canUseTool`; bare `allowedTools` entries and settings allow rules can also shadow the callback. Its diagnostic recommends `PreToolUse` for gating every tool call (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:209`, function `bVe`, warning code `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`). This is local dependency evidence, not an assumption about SDK permission semantics.

**Failure scenario:** Start a named YOLO lane whose first prompt requests a file write or shell command. Identity succeeds and the first prompt reaches the child. Init succeeds, but binding persistence is slow or subsequently rejects. The SDK auto-approves the tool without invoking the new callback, allowing side effects before admission and potentially before the run is refused. Settings-based auto-approval exposes the same structural weakness in main chat. Denying a manually invoked callback does not prevent SDK paths that skip it. **Invariant 3 fails.**

**Suggested fix:** Chain an admission-enforcing `PreToolUse` hook with existing hooks: deny before verified init, await the terminal admission decision afterward, and deny on refusal/abort/deadline/disposal. Ensure existing permission modes and allow rules cannot bypass that hook. Add coverage for actual auto-approval dispatch, including YOLO and settings-allowed tools, with persistence held and then failed.

### F2 — Blocking: main-chat disposal does not revoke admission or held tool calls

**Evidence:** Main:913 closes gates and the child, removes the abort listener, and settles the reservation, but neither aborts the controller nor records a disposed state. The admission resolver is local to `launch` (Main:824); disposal cannot settle it false. The tool wrapper checks only init/admission/controller state (Main:835). `wait` checks only abort/deadline (Main:704), and launch unconditionally settles success after its final identity read (Main:876). Later-turn identity refusal also enters this non-aborting disposal path (Main:832).

**Failure scenario:** Hold the final identity read after metadata is saved, invoke a tool callback so it awaits admission, then dispose the flow. Let the already-pending identity read resolve successfully. No disposed/abort check prevents `settleAdmission(true)`, returning the query proxy and delegating the held permission request even though the child/gates were closed and reservation settlement began. Independently, after successful admission, disposal leaves the wrapper able to delegate subsequent/in-flight requests because admission remains true and the controller need not be aborted. A later-turn identity refusal uses this same path. If the dependency never resolves, a held request waits for the ordinary deadline rather than being denied by disposal. **Invariant 3 fails; terminal output/admission handling is also compromised.**

**Suggested fix:** Establish an idempotent terminal state synchronously at disposal entry; settle admission false, cancel outstanding waits, and recheck terminal state before publishing success/output or delegating tools. Preserve existing reservation ownership/termination rules. Test direct disposal while a tool is held and a dependency later succeeds, plus disposal and later-turn refusal after admission. Controller-abort tests alone do not cover this.

## Five logic questions

1. **Silent failure:** A tool can execute while the run appears unadmitted and subsequently reports refusal (F1; Lane:766, Options:270).
2. **Unexpected user action:** A named YOLO prompt requesting a tool bypasses the new hold; a later-turn identity refusal can leave permission delegation live (F1/F2; Main:832).
3. **Wrong-answer input:** An otherwise valid request with an auto-approving permission configuration receives a tool-allow decision before admission instead of a refusal/hold (Options:262; SDK:209). Invalid init version/key-source payloads are explicitly rejected before binding (Lane:792; Main:850).
4. **Dependency failure/timeout/malformed result:** Init/storage/identity awaits normally route through refusal and deadline handling, but late success after disposal can still advance main admission (Main:704, Main:865, Main:893, F2). The issue is terminal-state handling, not an established infinite wait.
5. **Missing requirement detail:** Permission-mode bypass semantics and direct disposal as a terminal transition need explicit acceptance tests. Both are necessary to implement the already stated invariant 3; they do not require expanding product scope.

## Data flow and invariant assessment

| Invariant | Evidence and assessment |
| --- | --- |
| 1: Same-child proof before first prompt | Lane:777 precedes Lane:783; Main:840 precedes Main:842. The code awaits proof completion. |
| 2: Later turns held and revalidated | Lane:717 skips validation only for the exact released message object; Lane:910 validates enqueue. Main:631 holds after the first yield until commit, with subsequent verification at Main:832. The supplied main async generator serializes concurrent pulls. |
| 3: Tool admission and terminal denial | **Fails F1/F2.** Callback-level sequencing cannot establish execution-level admission. Lane disposal does mark disposed and abort (Lane:927); main disposal does not (Main:913). |
| 4: Output withheld | Normal launch returns/exposes the buffered query only after admission (Lane:871, Lane:876; Main:877, Main:883). F2 defeats the terminal guarantee on late completion. |
| 5: Binding only after verified init | Init checks precede binding (Lane:792, Lane:815; Main:850, Main:865). Init refusal/deadline retains the existing refusal/settlement paths. |
| 6: First message exactly once | Adapter passes the first turn into launch at Adapter:200; ambient-only seeding is at Adapter:220. Main gate yields its source first item once (Main:631); its regression checks one source event (Main spec:293). |
| 7: Fixed refusal logs | Adapter:278 uses fixed refusal fields/codes; Main:895 converts refusal before propagating. No new catch block requiring a new degradation-audit marker was identified in this diff. |

## Test and Session 11 assessment

- **The revised “yielded 1” expectation is correct after successful identity proof.** Init failure or later persistence failure now occurs after first-turn release. Main spec:217 defines the post-proof checkpoints, and Main spec:444 and Main spec:454 exercise failure/cancellation with the init-after-first-turn fixture. Zero later turns remains the relevant failure assertion.
- **The ordering assertions are weaker than their names suggest.** Main spec:274 compares an identity event recorded at function entry (Main spec:89, Main spec:164), not successful completion. Adapter spec:774 likewise compares invocation order. Lane spec:1101 checks prompt/commit/attach events without recording proof completion. Add a paused identity read and assert zero prompt consumption until it succeeds. Existing rejection cases and the awaited production code support the intended order, but these individual assertions do not prove it.
- **Held-tool failure coverage is incomplete.** Main spec:229 tests a successful hold, while Main spec:220 invokes a fresh callback after refusal. Adapter spec:789 checks pending/settled timing, but its base callback denies (Adapter spec:54), so settlement alone does not prove successful delegation. Neither pattern proves disposal denies an already-held request. Direct callback invocation also misses F1.
- **Early-output coverage is limited.** Lane spec:1053 emits init before its assistant fixture; Lane spec:1104 consumes output after admission. This does not independently prove buffering of assistant/stream events that arrive before init or while persistence is pending.
- **Old-versus-new evidence is credible for the modeled deadlock, not a live proof.** Report:101 reports the lane old-code failures; Report:214 reports 30 failed/64 passed for old main code. The highlighted main test waits for commit entry (Main spec:271), which old code never reaches, so its 5-second timeout is consistent with the deadlock but is not a precise bounded ordering assertion. The other 29 failures are not 29 independently demonstrated defects.
- **The green/live claims need qualification.** Report:153 says “FIXED and GREEN,” but Report:160 incorrectly includes disposal among paths guaranteed to settle a held call false (F2). Report:220 reports 169 targeted and Report:222 reports 4,118 project tests passing; these results were not rerun or independently verified here. Report:230 correctly acknowledges that CLI 2.1.278 behavior is modeled rather than live-proven.

## Verification and decisions

Static review only: no builds, tests, git commands, source edits, or live runs. Scoped `ptah_get_diagnostics` did not return diagnostics within its 45-second window, leaving the three production paths unchecked by that service. AST tools supplied structure; a zero-result `ptah_code_search_symbols` lookup for `createNamedAccountPromptGate` was followed by a native search. No existing `code-style-review.md` was found.

**Decision:** Treat installed SDK auto-approval behavior and direct disposal as part of the security contract, rather than assuming every tool calls `canUseTool` or every disposal follows an abort. Evidence: SDK:209, Options:270, Main:913, and invariants 3–4. This review judgment is reversible on contrary execution-path evidence; no product behavior was changed.

**Verdict: REVISE.** Resolve F1 and F2, then verify terminal held-tool denial and permission auto-approval paths. The report's passing-suite claims alone do not establish these guarantees.

