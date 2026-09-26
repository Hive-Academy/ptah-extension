# Code Logic Review — TASK_2026_559_8ca9

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 1              |
| Failure modes found | 1              |

**Batch 6 round 2: REVISE.** Both round-1 defects are fixed. One separate, reproduced status defect remains: search reports no reindex in flight when its optional freshness read fails during a pending run. Actual admission remains protected. This bounded observability gap warrants 7 rather than 8; working concurrency, isolation and registration distinguish it from 5–6.

Paths are relative to D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract. CE = libs/backend/vscode-lm-tools/src/lib/code-execution; NS = CE/namespace-builders; MCP = CE/mcp-core.

## Round-1 findings

| Finding                                                          | Status | Evidence and independent reproduction                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: execute_code definitions bypass freshness                    | FIXED  | NS/ide-namespace.builder.ts:226 invokes the shared hook; CE/ptah-api-builder.service.ts:613 wires it. Actual execution engine and builders produced result=[], reads=1, runs=1, definitions=1 for a definition lookup.                                                  |
| M2: explicit admission acknowledgment lost on advisory rejection | FIXED  | NS/code-namespace.builder.ts:173 isolates advisory failure; :397 admits before reading; :406 uses the actual latch. Rejecting-reader reproduction returned started=true then started=false, both with null count/age and reindexInFlight=true; exactly one pending run. |

## Verification and scope

- Requested Nx test, lint and typecheck for @ptah-extension/vscode-lm-tools with --skip-nx-cache: all passed, 25.8 seconds. Nx suppressed successful task logs; no independently observed test-count claim.
- Requested degradation-audit:lint with --skip-nx-cache: passed, 10.6 seconds.
- Scoped ptah_get_diagnostics: TypeScript compiler reported zero errors/warnings.
- Independent reproductions transpiled actual source in memory using the installed TypeScript compiler, including the real executeCode engine. Only platform capability, reader, indexer and logger boundaries were doubles. No real databases or raw session logs were accessed.
- The failed-proxy reproduction initially used deepStrictEqual on a VM-produced array, causing a cross-realm harness assertion failure. Comparing its JSON value corrected the harness and proved lookup isolation; it was not a product defect.
- Read the r1 review, executor report including revision, Batch 6, Decisions 1/4 and risk refinement. Read both namespace implementations in full; inspected composition, transports, registration, descriptions and relevant regression paths. This review concerns Batch 6 behavior, not unrelated large-dispatcher handlers.
- No task-description, implementation-plan or code-style-review file was present in the discovered task folder. ptah_search_files found no AGENTS.md. No direct file-read tool was listed; native reads were used.
- No git operations under the reviewer restriction. Independent uncommitted-diff inventory and historical byte identity of frozen prompt constants remain unverified. Only this deliverable was written.

## Five logic questions

### 1. How does this fail silently?

Failed freshness reading hardcodes reindexInFlight=false despite a pending local run (NS/code-namespace.builder.ts:277). Search returns that status with ordinary hits (:286, :311). The advisory failure is logged; the inaccurate status is F1 below.

### 2. What user action produces unexpected behaviour?

Start a full reindex and search while its freshness reader rejects. Search says no run is active, while another explicit reindex says one is active (NS/code-namespace.builder.ts:277, :406). Execute_code definitions now activate the shared freshness hook (NS/ide-namespace.builder.ts:226).

### 3. What input data produces a wrong answer?

An empty index, a pending indexer promise, then a rejected freshness read with a successful empty search page produce the wrong execution status (NS/code-namespace.builder.ts:273). Count-zero/null-age handling itself is correct (:192–:204). No malformed production payload defect is claimed.

### 4. What happens when a dependency fails?

Explicit advisory rejection preserves admission (:173, :401). Background rejection clears the latch and logs fixed text (:220–:230). The deferred definition hook catches a failed namespace proxy (:429–:436): actual execution-engine reproduction returned [], called the definition provider once and logged fixed text. Search freshness rejection remains F1.

### 5. What is missing that the requirements never mentioned?

Unknown database freshness must be distinguished from independently known local execution state (NS/code-namespace.builder.ts:145, :277). Namespace-local coordination and lack of durable completion history remain r1 residual limits (:145, :216–:220); neither was reproduced as corruption or counted as another defect.

## Failure modes

### F1 — Search loses known in-flight state on advisory read failure (Moderate)

- Trigger: admit a full reindex whose indexer promise remains pending; make getIndexFreshness reject; call searchSymbols.
- Symptom: successful search reports index.reindexInFlight=false while the same namespace/root is still indexing. A caller waiting on that documented status can prematurely conclude work finished.
- Evidence: NS/code-namespace.builder.ts:277 hardcodes false; :286 consumes it and :311 returns it. The real latch is set at :216 and clears only at :220. Explicit reindex correctly reads it at :406.
- Current handling: logs advisory failure and replaces all reported status, including independently known execution state. Actual admission remains protected.
- Reproduction using actual namespace source: initial reindex returned {started:true,symbolCount:0,indexAgeMs:null,reindexInFlight:true}; search after reader rejection returned {hits:[],bm25Only:false,index:{symbolCount:null,indexAgeMs:null,reindexStarted:false,reindexInFlight:false}}; explicit reindex with that same rejecting reader returned {started:false,symbolCount:null,indexAgeMs:null,reindexInFlight:true}. Actual indexer invocation count remained 1 and its promise never settled.
- Recommendation: capture the searched root before the freshness await and retain inFlight.has(root) in the failure response. Leave count/age null and reindexStarted false. Do not schedule another run or resolve a different root after failure. Add pending-run/rejecting-reader regression coverage for search and ensureIndexFresh.
- Severity: bounded status/observability error, not data loss, duplicate indexing or a false completion acknowledgment. Separate from fixed explicit-reindex M2.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

- F1 (Moderate): NS/code-namespace.builder.ts:277. Preserve the known latch state when freshness is unknown; reproduction and correction above.
- No other reproduced defects counted.

## Data flow

1. **OK — host gating:** MCP/protocol-dispatcher.ts:407 lists definitions only with IDE capabilities and the IDE group enabled. HTTP derives the flag from the same optional capability dependency (CE/mcp-http/http-mcp-server.service.ts:297, :377). VS Code registers it at apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:126; Electron at apps/ptah-electron/src/di/phase-3-storage.ts:189. CLI without this registration uses the false gate. CLI stdio separately lists eight agent/session tools, without definitions (CE/mcp-stdio/tool-builders.ts:33; CE/mcp-stdio/stdio-mcp-server.service.ts:132).
2. **OK — fallback deviation:** the no-capability stub returns [] without consulting the index (NS/ide-namespace.builder.ts:345). It is not advertised as ptah_lsp_definitions on those hosts. A raw unadvertised tools/call can still reach the dispatcher case (MCP/protocol-dispatcher.ts:937), and execute_code can access the stub. Neither is an index-backed lookup. Omitting the hook therefore leaves no supported index-consuming definition provider stale. Independent stub reproduction returned [], hookCalls=0; no defect counted.
3. **OK — composition order:** session-aware dependencies precede code (CE/ptah-api-builder.service.ts:521, :568). Code construction captures getters and creates closure state (NS/code-namespace.builder.ts:131–:146), without invoking other namespaces. The same code object is wired into IDE and returned at CE/ptah-api-builder.service.ts:809. Safe-build returns a throwing proxy (:896–:921), accessed only inside the caught hook promise chain. Independent proxy reproduction passed; no build-order dependency break found.
4. **OK — root and admission:** CE/ptah-api-builder.service.ts:979 omits the caller-declared tier, using recorded sessions/platform folders. NS/code-namespace.builder.ts:154 requires exact membership. The latch is set synchronously before scheduling (:216), with a 24h start throttle (:258). Concurrent and pending-past-24h regressions passed (NS/code-namespace.builder.spec.ts:248, :273).
5. **OK — governor:** lazy runs use userInitiated=false (NS/code-namespace.builder.ts:247); explicit runs use true (:399). Neither awaits indexWorkspace (:218). The indexer yields before each background batch (libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:239, :242).
6. **OK — shared definition path:** direct tools delegate at MCP/protocol-dispatcher.ts:945; execute_code reaches the same namespace hook (NS/ide-namespace.builder.ts:226). No duplicate dispatcher hook remains.
7. **PARTIAL — status:** explicit acknowledgment is fixed; search advisory failure loses known in-flight state (F1).
8. **OK — registration:** reindex follows search in the code group (MCP/protocol-dispatcher.ts:465), inherits definition-derived telemetry (:491) and budgets (:625), and stays outside eager sets (:505–:522). Relevant registration/schema guards passed (MCP/protocol-dispatcher.spec.ts:3213, :3237; MCP/tool-description.builder.spec.ts:35). Return documentation is updated at CE/ptah-system-prompt.constant.ts:338; catalog row at apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/internal-mcp.md:193.
9. **OK — degradation:** advisory, background and hook catches have audit markers and fixed-text logs (NS/code-namespace.builder.ts:179, :222, :432). Injected secret-bearing read/build errors did not appear in captured messages.

## Requirements fulfilment

| Requirement                                                  | Status   | Gap                                                          |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------ |
| Governed lazy refresh for empty or older-than-24h index      | COMPLETE | NS/code-namespace.builder.ts:202, :247                       |
| Shared definition behavior                                   | COMPLETE | M1 fixed                                                     |
| Explicit acknowledgment despite advisory rejection           | COMPLETE | M2 fixed                                                     |
| Host-owned root, latch, start throttle                       | COMPLETE | NS/code-namespace.builder.ts:154, :216, :258                 |
| No awaited full indexWorkspace                               | COMPLETE | Deferred chain at :218                                       |
| Accurate status attached to search                           | PARTIAL  | F1                                                           |
| Single-file path remains awaited                             | COMPLETE | NS/code-namespace.builder.ts:380                             |
| Gating, telemetry, non-eager registration, description guard | COMPLETE | Data flow items 1 and 8                                      |
| Frozen constants byte identity                               | PARTIAL  | Historical comparison not performed under no-git restriction |

The approved per-workspace 24h refinement (batches.md:90) differs from literal once-per-session wording; not a new finding. Missing indexer still permits measured freshness without starting work (NS/code-namespace.builder.ts:240–:254), as accepted in r1. Implicit requirements not addressed: cross-entry-point coordination and durable background completion history; neither counted without a reproduced defect.

## Edge cases

| Case                                          | Handled             | How                            | Concern                                |
| --------------------------------------------- | ------------------- | ------------------------------ | -------------------------------------- |
| Empty index/null age                          | YES                 | Count-zero stale rule          | NS/code-namespace.builder.ts:202       |
| Fresh or nonempty/null timestamp              | YES                 | No age-based trigger           | :192, :204                             |
| Concurrent calls/pending past 24h             | YES                 | Latch and throttle             | :243, :245                             |
| Rejected indexer                              | YES                 | finally clears; catch observes | :220                                   |
| Explicit call during run with rejected reader | YES                 | Actual latch preserved         | :406                                   |
| Search during run with rejected reader        | NO                  | False inactive status          | F1                                     |
| Failed code proxy                             | YES                 | Deferred caught hook           | :429                                   |
| No IDE capabilities                           | YES for this change | Tool not listed; inert stub    | MCP/protocol-dispatcher.ts:407         |
| Unrecorded caller root                        | YES                 | Indexing refused               | NS/code-namespace.builder.ts:154, :373 |

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for M1/M2 resolution and F1 reproduction; **MEDIUM** for broader integration scope.
- Top risk: callers can read an active reindex as inactive when the advisory query fails.
- What a robust implementation would add: preserve local in-flight state independently of database freshness, with a pending-run/rejecting-reader search regression.
