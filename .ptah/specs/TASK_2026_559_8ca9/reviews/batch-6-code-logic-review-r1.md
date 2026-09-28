# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 2              |
| Failure modes found | 2              |

**Batch 6 verdict: REVISE.** The scoped checks pass, and the main concurrency and root-selection mechanisms hold. Two reproduced gaps remain: execute_code definition lookups bypass freshness, and an advisory freshness failure replaces an already-started reindex acknowledgment with an error. These are bounded alternate-path/failure-path defects, placing this in the 7 band rather than 5–6; they prevent an 8 or approval.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. `CE` abbreviates `libs/backend/vscode-lm-tools/src/lib/code-execution`; `NS` is `CE/namespace-builders`; `MCP` is `CE/mcp-core`. These are path abbreviations, not separate files.

## Verification and limits

- Ran the requested `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: all three targets passed (24.4 seconds). Nx suppressed successful task logs; no independent test-count claim is made.
- Ran `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: passed (8.5 seconds).
- Scoped `ptah_get_diagnostics` to the changed namespace file: TypeScript compiler reported zero errors and warnings.
- Ran isolated in-memory reproductions using the actual source transpiled by the installed TypeScript compiler. The definition reproduction used the real `executeCode`, `buildIDENamespace`, and `buildCodeNamespace`; only platform capabilities/index services were doubles. No source, test, fixture, database, or session-log files were created or modified.
- Read the batch, decisions, executor report, and requested research sections. This is a targeted Batch 6 path review, not approval of every unrelated handler in the large dispatcher. No task-description, implementation-plan, or code-style-review document was present in the discovered task folder; `batches.md` identifies this as plan-free.
- `ptah_search_files` returned no AGENTS.md. No direct Ptah file-read tool was listed; native reads were used. No git operations were performed, as prohibited by the reviewer role. Therefore the requested historical byte-identity comparison of the frozen constants, and independent uncommitted-diff inventory, remain **unverified**. The executor's assertion of unchanged frozen files is not substituted for a byte comparison.

## Five logic questions

### 1. How does this fail silently?

The execute_code definition path returns its ordinary result without ever examining a stale/empty symbol index (F1). The new direct-tool hook is at `MCP/protocol-dispatcher.ts:944`, while the shared namespace delegates directly at `NS/ide-namespace.builder.ts:212`. An empty result can therefore persist across repeated execute_code definition calls.

### 2. What user action produces unexpected behaviour?

Calling `execute_code` with `ptah.ide.lsp.getDefinition(...)` instead of the direct `ptah_lsp_definitions` tool bypasses the new behavior (F1). Requesting a full reindex while the optional freshness reader rejects returns an error despite starting the run (F2; `NS/code-namespace.builder.ts:377`, `:379`, `:387`).

### 3. What input data produces a wrong answer?

An empty index plus a definition-only execute_code workflow never triggers a rebuild (F1). Empty count and null timestamp handling themselves are correct: zero is stale; a nonzero count with null timestamp is not aged (`NS/code-namespace.builder.ts:168`, `:176`). No malformed production freshness payload was reproduced, so no speculative shape-validation finding is raised.

### 4. What happens when a dependency fails?

Lazy freshness rejection logs fixed text and reports unknown; background indexer rejection clears the latch and is observed (`NS/code-namespace.builder.ts:198`, `:241`). Explicit full reindex instead lets the advisory read reject into the operation error return after scheduling work (F2). Missing freshness method never triggers (`:164`, `:218`); missing indexer never triggers (`:219`).

### 5. What is missing that the requirements never mentioned?

Full-run admission is local to one code namespace, not shared with boot/UI/watch indexing (`NS/code-namespace.builder.ts:145`; `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:207`; `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:485`). See the overlap judgment below. There is also no durable run-result/status history: the start acknowledgment is not a completion guarantee (`NS/code-namespace.builder.ts:196`). Neither observation alone is counted as a reproduced Batch 6 defect.

## Failure modes

### F1 — Definition lookup through execute_code bypasses lazy freshness (Moderate)

- Trigger: the first symbol operation is `execute_code` running `return await ptah.ide.lsp.getDefinition('/ws/a.ts', 1, 1)` on a host with IDE capabilities and an empty symbol index.
- Symptom: the definition provider runs, but no freshness read or lazy reindex occurs. Repeating this workflow never repairs the stale index.
- Evidence: `MCP/protocol-dispatcher.ts:944` places the hook only in the direct tool case; `CE/ptah-api-builder.service.ts:597` builds the IDE namespace without that hook; `NS/ide-namespace.builder.ts:210` validates and `:212` immediately delegates; the execute_code bridge invokes the namespace method directly at `MCP/code-execution.engine.ts:237`.
- Reproduction: actual execution-engine output was `{result:[], definitions:1, freshnessChecks:0, indexRuns:0}`. With the same API object, `return await ptah.code.searchSymbols('foo')` produced `{freshnessChecks:1,indexRuns:1}`. The fake reader returned `{symbolCount:0,newestUpdatedAt:null}` and the fake indexer recorded invocations.
- Current handling: direct definitions work; execute_code symbol search works; execute_code definitions do not share the behavior.
- Recommendation: put the fire-and-forget definition freshness hook at the shared namespace/composition boundary, then remove the redundant dispatcher hook. Preserve lookup success on advisory failure. Add a real execution-engine regression for the definition path as well as the search path.

### F2 — Advisory freshness failure replaces a successful start acknowledgment (Moderate)

- Trigger: full `reindex()` can start the indexer, but `getIndexFreshness` rejects independently.
- Symptom: the tool reports an error instead of `{started:true,...}` while background work continues. The caller cannot tell whether the operation started and may retry needlessly.
- Evidence: `NS/code-namespace.builder.ts:375` computes admission, `:377` schedules the run, `:379` awaits the optional read, and `:387` replaces the acknowledgment with the read error. `MCP/protocol-dispatcher.ts:2059` maps the error variant to a tool error.
- Reproduction: a pending fake `indexWorkspace` incremented `actualRunsStarted` while a reader threw `Error('freshness unavailable')`. Actual result: `{result:{error:'freshness unavailable'},actualRunsStarted:1}`. No indexer failure occurred.
- Current handling: the lazy path degrades read failure to unknown, but the explicit path does not. A stalled optional reader would also delay the acknowledgment; only the rejection case was dynamically reproduced.
- Recommendation: isolate advisory reads from run admission/result construction. Preserve `started` and the actual latch state, return null freshness on read failure, and log fixed text. Test both newly admitted and already-in-flight runs with a rejecting reader. Do not call `ensureIndexFresh()` as the fallback, since that could schedule a governed run instead of the explicit one.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

- **F1:** `MCP/protocol-dispatcher.ts:944`, `CE/ptah-api-builder.service.ts:597`, `NS/ide-namespace.builder.ts:212`. Shared behavior is only partially wired. Fix and verification are above.
- **F2:** `NS/code-namespace.builder.ts:377`, `:379`, `:387`. Preserve the start acknowledgment when advisory metadata fails. Fix and verification are above.

## Data flow

1. **OK — listing:** `MCP/protocol-dispatcher.ts:454` gates the code group; reindex follows symbol search. The dedicated registration spec at `MCP/protocol-dispatcher.spec.ts:3209` exercises gating/order. Reindex is not added to the eager sets.
2. **OK — budget/telemetry:** `MCP/protocol-dispatcher.ts:491` derives the telemetry allowlist from definitions; `:625` declares budgets for every applicable tool. The default remains 2,000 tokens/8,000 chars (`MCP/tool-result-budget.ts:48`, `:50`, `:101`), sufficient for the new small status object.
3. **OK — host root:** `CE/ptah-api-builder.service.ts:970` omits the caller-declared tier. Session lookup reads stored configuration (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:458`); active lookup reads the registry (`:435`). Provider roots/folders read host state (`libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:78`, `:86`; corresponding CLI methods `:72`, `:80`; VS Code methods `:67`, `:71`). The builder uses its injected platform provider, not the caller-aware wrapper (`CE/ptah-api-builder.service.ts:363`, `:523`, `:974`). A caller can select an existing session; it cannot declare an arbitrary root through this resolver tier.
4. **OK — admission:** `NS/code-namespace.builder.ts:194` sets the latch synchronously before invoking the indexer. The await of freshness occurs before admission, but the check-to-set segment has no await (`:217`–`:225`). Concurrent callers cannot interleave within it. Both success and rejection clear the latch (`:198`). Explicit calls use the same latch (`:375`).
5. **OK — scheduling:** lazy runs use `userInitiated:false` (`:225`); explicit full runs use true (`:377`). Neither awaits `indexWorkspace`. The indexer gates non-user work per batch (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:237`, `:240`).
6. **PARTIAL — entry paths:** search calls freshness internally (`NS/code-namespace.builder.ts:264`), covering direct and execute_code search. Direct definitions use the dispatcher hook. Execute_code definitions bypass it (F1).
7. **PARTIAL — reporting:** search includes index status; full reindex normally returns admission/freshness, but advisory failure discards admission (F2).

## Requirements fulfilment

| Requirement                                                   | Status   | Gap                                                                                                      |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Empty or older-than-24h lazy refresh, governed                | COMPLETE | `NS/code-namespace.builder.ts:176`, `:225`; no trigger from absent freshness method                      |
| Per-workspace latch and 24h minimum start gap                 | COMPLETE | `NS/code-namespace.builder.ts:145`, `:195`, `:236`                                                       |
| Literal first-call-per-session semantics                      | PARTIAL  | No session key/reset exists; see deviation judgment                                                      |
| Direct search and definitions trigger                         | COMPLETE | `NS/code-namespace.builder.ts:264`; `MCP/protocol-dispatcher.ts:944`                                     |
| execute_code parity                                           | PARTIAL  | Search covered; definition path missing (F1)                                                             |
| No tool awaits full indexWorkspace                            | COMPLETE | Promise chain at `NS/code-namespace.builder.ts:196`                                                      |
| Explicit in-flight response and reliable start acknowledgment | PARTIAL  | Normal contention works; advisory rejection loses response (F2)                                          |
| Host-recorded workspace root                                  | COMPLETE | `CE/ptah-api-builder.service.ts:968`; root equality guard at `NS/code-namespace.builder.ts:154`          |
| New tool gated, non-eager, budgeted, telemetry recognized     | COMPLETE | Definition-derived registration and budget application described above                                   |
| Absolute file argument validation in direct MCP tool          | COMPLETE | `MCP/protocol-dispatcher.ts:2045` uses host `path.isAbsolute`; relative/non-string cases covered         |
| Stable list and bounded truthful instructions                 | COMPLETE | Passing guards at `MCP/protocol-dispatcher.spec.ts:3012`, `:3039`; `MCP/server-instructions.spec.ts:100` |
| Frozen shared prompt byte identity                            | PARTIAL  | Historical comparison unverified under no-git reviewer constraint                                        |

Implicit requirements not addressed: shared coordination across indexing entry points and explicit completion/failure status for background runs. These are not asserted to be newly introduced defects.

## Edge cases

| Case                                    | Handled | How                                  | Concern                                            |
| --------------------------------------- | ------- | ------------------------------------ | -------------------------------------------------- |
| Empty index                             | YES     | Count zero is stale                  | Null age stays null                                |
| Nonzero count, null timestamp           | YES     | No age computed                      | No age-based trigger                               |
| Exactly 24h old                         | YES     | Strictly greater-than age test       | Consistent with “older than 24h”                   |
| Concurrent lazy calls                   | YES     | Atomic admission and per-root latch  | Namespace-local only                               |
| Run still pending after 24h             | YES     | Latch still blocks                   | Existing spec covers this                          |
| Rejected indexer run                    | YES     | finally clears; catch logs           | Lazy retry throttled for 24h as planned            |
| Explicit during lazy run                | YES     | started:false, in-flight true        | Does not promote the governed run                  |
| Missing reader/method                   | YES     | Unknown, no trigger                  | Optional contract retained                         |
| Missing indexer                         | YES     | No trigger                           | Reports known reader freshness rather than unknown |
| Rejected optional read on explicit call | NO      | Outer error return after start       | F2                                                 |
| execute_code definition-only session    | NO      | Delegates without hook               | F1                                                 |
| Caller-declared unrecorded root         | YES     | Exact host-list check refuses writes | Read-only freshness still possible                 |

## Deviation and overlap judgments

- **Search hook moved into the namespace:** justified. It covers execute_code search and avoids a second freshness read/result mismatch (`NS/code-namespace.builder.ts:264`). Apply the same principle to definitions (F1).
- **Session wording:** the implementation is not “once per session.” Maps are closure-local and keyed by root (`NS/code-namespace.builder.ts:145`), and every call reads freshness (`:213`). The isolated clock reproduction made three checks and two runs when the third call advanced beyond 24h, with no session transition. Conversely a new session on the same namespace/root inherits the throttle. This follows the expressly approved per-workspace 24h risk mitigation in `batches.md:90`; I do not count that approved refinement as a defect. Documentation should describe it accurately. It also means a failed lazy run is not immediately retried by opening another session.
- **Missing indexer:** a present reader still supplies count/age (`NS/code-namespace.builder.ts:229`), contrary to the review checklist's literal “unknown” wording. No run starts. Reporting measured freshness is honest and the executor declares this behavior; this is a contract discrepancy, not a reproduced wrong result.
- **Explicit userInitiated:true:** permitted by Task 6.1 and the existing indexer contract. It can consume CPU/embedding resources during an agent turn, but uses bounded indexer batches and the namespace latch. With fire-and-forget there is no longer a technical need to bypass the governor merely to avoid awaiting oneself; the comment at `NS/code-namespace.builder.ts:373` overstates that justification. Following the approved explicit-run policy is not a defect.
- **Production wiring addition:** justified; the raw platform provider and recorded sessions establish the host-owned root without the Batch 2f caller-aware API trap (`CE/ptah-api-builder.service.ts:968`).
- **Prompt/catalog additions:** correcting the newly changed return shape and documenting the new tool is justified (`CE/ptah-system-prompt.constant.ts:338`, `:367`; `MCP/tool-description.builder.ts:1739`). This file is not either named frozen constant. Historical byte identity remains unverified, as stated above. Pre-existing catalog totals are not elevated into a Batch 6 finding.
- **Absolute-only direct argument:** justified by the indexer contract; validation is at `MCP/protocol-dispatcher.ts:2045`. This is not a file-containment guarantee. An isolated real-indexer run accepted a foreign absolute file and labeled it with the selected workspace. The batch explicitly preserves the existing single-file path and only requires a host-owned root, so I do not classify that inherited behavior as a new Batch 6 security defect. Workspace-containment policy remains unspecified.
- **Degradation markers/logs:** the three new handlers actually report as their markers claim (`NS/code-namespace.builder.ts:199`, `:244`; `MCP/protocol-dispatcher.ts:2243`). Fixed message text omits paths; background metadata retains only error name and userInitiated. The scoped audit passed. No new path-bearing logger call was reproduced.
- **Overlap note:** the namespace latch cannot coordinate with unrelated indexer callers. The VS Code startup call at `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:207` can overlap a lazy run when SQLite/indexer are registered. However, `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:485` is inside the `runSymbols` callback installed on `IndexingRpcHandlers` at `:526`, not an immediate boot-time run. That portion of the executor note is inaccurate. Shared-run coordination is a moderate residual resource/concurrency risk, not a proven deadlock or a counted defect in this review. The store upserts by workspace/subject (`libs/backend/memory-curator/src/lib/code-symbol.store.ts:165`), so overlap alone does not prove duplicate rows. No production overlap corruption was reproduced.

## Verdict

- Recommendation: **REVISE**
- Confidence: **MEDIUM** overall; HIGH for the two isolated reproductions.
- Top risk: a definition-only execute_code workflow can keep returning results from a stale index without activating the promised repair.
- What a robust implementation would add: a shared definition freshness hook, advisory-read isolation that preserves explicit admission status, and regression tests for those two paths. Before final acceptance, independently verify the frozen constants against the baseline with an authorized read-only comparison.
