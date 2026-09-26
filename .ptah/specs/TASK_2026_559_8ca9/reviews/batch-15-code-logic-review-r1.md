# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 15, r1, Lane A. Source-read-only review of the four files named in the executor report.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 1              |
| Moderate issues     | 3              |
| Failure modes found | 5              |

Invalid summaries remain visibly invalid and check caps preserve the full-set verdict. However, the claimed 7,460-character default page still fails the real MCP token budget; renamed tasks can disappear during traversal. This is above 3–4 because the ordinary namespace paging/filter/full-row/check paths work and scoped checks pass, but below 7–8 because a normal default response is not a complete page at the actual MCP boundary.

Paths below are relative to the supplied worktree. Abbreviations:

- **N**: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts
- **NS**: the colocated tasks-namespace.builder.spec.ts
- **D**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts
- **P**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- **B**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts
- **H**: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts

Read the complete four reviewed source/spec files, Batch 15 only, context Decisions 2/4/17, executor report and referenced task-list/check research. No task-description.md, general implementation-plan.md or current code-style-review.md exists in this task folder; the language-specific plans are unrelated. ptah_search_files returned no instruction files, and local searches also found none. Used the supplied project guidance and nearby namespace/index patterns. No git operations were run, so the stated base HEAD and historical differential were not independently verified.

## Five logic questions

### 1. How does this fail silently?

A folder renamed across an equal-date cursor boundary is omitted or revisited without warning (F2, N:432/N:674). A fabricated shape-correct cursor can return a successful empty page (F3, N:451).

The default summary does **not** hide invalidity: N:470 emits frontmatterValid:false. The parser derives the flag from issue count at libs/backend/task-specs/src/lib/task-frontmatter.ts:527, and graph validation recomputes it at task-scanner.service.ts:204. NS:520 pins the summary flag.

### 2. What user action produces unexpected behaviour?

A default MCP list on the supplied realistic fixture produces cut JSON despite paging (F1, N:675/P:2253/B:241). Renaming an equal-date or undated task between pages changes its pagination position (F2). Calling the advertised API-discovery mechanism with ptah.help('tasks') produces “Topic 'tasks' not found” (F5, H:634).

### 3. What input data produces a wrong answer?

Valid date strings with different UTC offsets are ordered lexically rather than chronologically (F4, N:429). Invented cursor keys can exclude every task without a refusal (F3, N:237/N:451). Large titles, relations and full rows exacerbate F1 because selection is by row count alone (N:675).

### 4. What happens when a dependency fails?

Thrown index.list failures become {ok:false,error} (N:690/N:727); missing services are reported (N:656/N:698). The new catch only wraps decoding/JSON parsing (N:441), returning null that becomes INVALID_CURSOR (N:645). Its reported audit marker is justified; it does not swallow index failures. Its acceptance rules remain too permissive (F3).

Inherited risk, not counted as a new Batch 15 defect: TaskIndexService.list catches store failures and returns a default empty tasks array (libs/backend/task-specs/src/lib/task-index.service.ts:316–336); list/check cannot distinguish that from a genuinely empty tree. Hung dependencies have no namespace-local timeout. Typed namespace errors also use the existing MCP success-envelope helper (P:2253/P:2962), not isError:true; the executor's “tool error” means a JSON ok:false payload.

### 5. What is missing that the requirements never mentioned?

The char-only fixture assertion ignores the existing 2,000-token transport limit (NS:502/B:48). No stable identity/snapshot defines rename handling (N:423). There is no continuation for check's omitted entries (N:721–724): consistent with the explicit cap-only requirement, but excluded folders beyond 50 cannot be enumerated through this method. Task help is absent (F5).

## Failure modes

### 1. F1 — Default page is cut inside a row — Serious

- Trigger: Call the default MCP list with the executor's 150-task fixture.
- Symptom: The 25-row JSON is **7,460 characters / 2,493 tokens**. Running the real budget implementation returns truncated:true, 1,977 tokens, invalid JSON and only 19 visible row starts. The cursor still points after row 25. Following it without recovering the spool misses the rest of that page.
- Evidence: N:675 slices solely by row count; N:682 encodes the last selected row. NS:502 checks only chars. P:2253 budgets the JSON; B:48 sets 2,000 tokens, B:91 selects preformatted content, B:241 checks token size before the cut/spool path.
- Current handling: Full raw data is spooled and truncation is disclosed. This is recoverable, but defeats natural-row paging on the normal default call.
- Recommendation: Fit complete serialized rows against both char and token limits, minting the cursor after the last actually returned row. Treat 25 as a maximum default. Define explicit recovery for an oversized single row; test summary/full through the actual MCP budget with this fixture.

### 2. F2 — Rename silently skips or repeats a task — Blocking

- Trigger: Start with undated TASK_2026_100, TASK_2026_200, TASK_2026_300. Fetch one row, then rename unseen 300 to 050 and continue. Conversely, fetch two rows, rename seen 100 to 250 and continue.
- Symptom: First case returns only 200 and ends, silently omitting the renamed task. Second case returns 250 plus 300, revisiting the same underlying task. There is no invalidation/restart signal.
- Evidence: N:432 uses the mutable folder ID as tie-breaker; N:674 discards keys before the cursor. Folder ID is assigned at libs/backend/task-specs/src/lib/task-frontmatter.ts:511 and specified at libs/shared/src/lib/types/task-spec.types.ts:142. NS:648 tests additions/deletions, never renames.
- Current handling: Stateless keyset continuation has no stable identity or generation. N:412 claims no repeated rows and only caveats created changes, not ID changes.
- Recommendation: Use stable traversal identity/snapshot, or detect invalidating changes and return an explicit restart error. Add both rename directions as regression tests. Treating rename as deletion plus creation is a weaker contract that needs explicit agreement/disclosure; it does not meet the requested rename guarantee.
- Severity rationale: This is silent omission from an apparently successful completed traversal, the Blocking category in the review rubric, even though it requires a concurrent rename.

### 3. F3 — Corrupted and fabricated cursors are accepted — Moderate

- Trigger: Insert ! inside a genuine cursor, or base64url-encode {"v":1,"c":null,"id":"zzzz"}.
- Symptom: The corrupted cursor succeeds; the fabricated one returns ok:true,count:0,total:3,tasks:[] instead of INVALID_CURSOR.
- Evidence: N:444 uses permissive Buffer decoding; N:237/N:451 check only JSON shape, not issuance. N:645 claims rejection of values not returned by the tool.
- Current handling: Wrong JSON/shape/version are refused. Empty/overlong cursor strings yield INVALID_ARGS instead (N:230/N:634), not the requested uniform INVALID_CURSOR.
- Recommendation: Validate canonical base64url and payload values; authenticate/version cursors or use an issued-token registry if forged values must be rejected. Preserve issued cursors after anchor deletion/past end. Add corrupted-encoding, tampered-payload, empty and overlong regression cases with exact agreed codes.
- Severity rationale: An invalid-input edge, not evidence of unauthorized data access.

### 4. F4 — Newest-created ordering is not chronological for accepted dates — Moderate

- Trigger: A has created 2026-09-26T10:00:00+02:00 (08:00Z), B has 2026-09-26T09:00:00Z (09:00Z).
- Symptom: A appears first although B is newer; limit:1 returns the wrong “newest” task.
- Evidence: N:429 compares strings; D:220 promises newest-created first. libs/backend/task-specs/src/lib/task-frontmatter.ts:128–131 accepts parseable strings and preserves them without UTC normalization.
- Current handling: Same-format canonical UTC strings work. The index store already had lexical ordering; the new namespace now owns and advertises the same behavior.
- Recommendation: Normalize dates to instants for sort and cursor keys, with ID ties on equal instants. Test offsets, date-only values and equivalent timestamps.

### 5. F5 — Execute-code task contract is undiscoverable through help — Moderate

- Trigger: Follow execute-code's instruction to call ptah.help('tasks') when building a task query.
- Symptom: The topic is missing, so the advertised discovery API cannot explain paging, count vs total, sparse summary rows or full mode.
- Evidence: D:1933 directs callers to ptah.help(topic); H:45's map has no tasks topic and H:634 returns the missing-topic message. ptah-api-builder.service.ts:810 exposes tasks and :880 installs this help implementation. D:222 mentions total but never explicitly defines the changed count.
- Current handling: Direct MCP task descriptions explain paging/full rows. Searching libs/apps found no existing production namespace consumer relying on count=total. This is a contract-discovery gap, not an established broken production caller.
- Recommendation: Add task help covering list/check arguments/results, count/page vs total, omitted empty arrays/true validity, invalidity signaling and cursor/filter semantics. Pin help discovery in a test. Keep shared prompt constants unchanged under Decision 4.

## Blocking issues

F2 — N:432/N:674: renamed task silently missing from completed traversal. Add stable traversal identity or honest invalidation.

## Serious issues

F1 — N:675/N:682: the ordinary default fixture fails the actual response budget. Add whole-row budget-aware paging and transport regression coverage.

## Moderate and minor issues

F3 (N:444/N:451), F4 (N:429), F5 (H:45/H:634).

Coverage note, not another failure mode: NS:590 tests filter forwarding, not filtered continuation. The independent same-filter continuation probe passed; add a persistent test covering filtering plus cursor and equal-time ordering.

## Data flow

1. **OK:** Task tools register at P:402; execute-code injects the same namespace at ptah-api-builder.service.ts:810. RPC list bypasses it and calls the index at libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:635.
2. **GAP F3:** Zod validates args (N:219), then cursor decoding checks shape without canonical encoding or issuance (N:441).
3. **OK with inherited uncertainty:** ready resolves services/root and warms the index (N:482). Thrown list errors are reported; store-swallowed failures remain indistinguishable.
4. **OK / F2,F4:** Only status/type reach the index (N:664). Sort/keyset operations (N:668–674) are stable for unchanged keys, not renamed rows or chronological mixed-format dates.
5. **OK / F1:** Projection preserves invalidity (N:470) and full rows (N:688), but selection ignores serialized token size (N:675).
6. **OK at namespace boundary:** count=page length, total=filtered count and nextCursor is absent at end (N:679–682).
7. **F1:** MCP serialization enters separate token-aware budgeting (P:2968), cutting a page inside a row.
8. **OK:** Check collects invalid rows, computes verdict/full totals, then caps both lists (N:706–724).

## Requirements fulfilment

| Requirement                                | Status   | Gap                                                                 |
| ------------------------------------------ | -------- | ------------------------------------------------------------------- |
| Default 25/max 200, summary/full           | COMPLETE | N:219/N:688                                                         |
| Default response fits delivery budget      | PARTIAL  | Char test passes, real 2,000-token cap fails (F1)                   |
| Invalid summaries visibly invalid          | COMPLETE | N:470, NS:520                                                       |
| Count consumer audit                       | COMPLETE | No total-dependent namespace consumer found; RPC/CLI paths separate |
| Stable newest-first order                  | PARTIAL  | ID ties stable; mixed-format dates wrong (F4)                       |
| Add/remove stability for unchanged keys    | COMPLETE | N:674, NS:648                                                       |
| Rename stability                           | MISSING  | F2                                                                  |
| Malformed/forged cursor refusal            | PARTIAL  | F3                                                                  |
| Past-end empty page                        | COMPLETE | N:675–682, NS:604                                                   |
| Status/type filtering with continuation    | COMPLETE | Forwarding and independent filtered probe pass                      |
| Check caps/totals/full-set verdict         | COMPLETE | N:719–724, NS:741/761/780                                           |
| Direct descriptions explain full rows/caps | COMPLETE | D:224–225/D:270–272                                                 |
| Help/execute-code consistency              | PARTIAL  | F5                                                                  |
| New catch reports parse failure            | COMPLETE | N:441/N:645; strict acceptance is F3                                |

Implicit requirements not addressed: complete rows after transport budgeting, stable rename identity and discoverable execute-code semantics. Cursor is not filter-bound: changing filters continues after the old key in the new set (N:664–674). Document that it is not a fresh search or snapshot across changing predicates.

## Edge cases

| Case                        | Handled | How                                       | Concern                                    |
| --------------------------- | ------- | ----------------------------------------- | ------------------------------------------ |
| Empty/past end              | YES     | Empty page/current total/no cursor, N:675 | Inherited store-failure ambiguity          |
| Equal/null dates            | YES     | ID tie-break/null last, N:425             | Rename changes key                         |
| Added/deleted other rows    | YES     | Keyset avoids shifted offsets             | Earlier new keys intentionally excluded    |
| Renamed task                | NO      | Live key changes                          | F2                                         |
| Bad JSON/version            | YES     | Typed namespace error, N:645              | MCP isError remains unset                  |
| Corrupted/forged cursor     | NO      | Permissive decoder/shape only             | F3                                         |
| Mixed offsets               | NO      | Lexical comparison                        | F4                                         |
| Invalid summary             | YES     | false validity flag                       | Details available via full/get             |
| Over 50 invalid/excluded    | YES     | Full totals/verdict then slice            | No continuation; issues per task unbounded |
| Token-dense/full/large page | NO      | Generic cut/spool                         | F1                                         |
| Same filters across pages   | YES     | Filter then keyset                        | Not a status snapshot                      |
| Failed/hung dependency      | PARTIAL | Rejection caught; no local timeout        | Index can swallow store failure            |

## Verification

All requested commands ran once, with scoped tails and one completion read per command:

- nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache: **PASS**, all three targets, ~61 seconds.
- nx run degradation-audit:lint --skip-nx-cache: **PASS**, TOTAL 300 unsuppressed sites.
- nx run ptah-electron:validate-deps --skip-nx-cache: **PASS**.
- ptah_get_diagnostics scoped to the two changed production paths: TypeScript compiler, **0 errors / 0 warnings**.

Independent Node probes lived only under OS temp. The namespace probe transpiles the actual reviewed file, stubs unrelated shared-schema imports, and injects an in-memory index. It demonstrated corrupted/forged cursor acceptance, both rename cases and mixed-offset ordering, and confirmed same-filter continuation (A then C, total 2). It does not exercise SQLite or disk watchers.

The budget probe bundled the actual applyToolResultBudget implementation and its real reducer/tokenizer dependencies. Reconstructing the exact spec fixture measured **7,460 chars / 2,493 tokens → truncated:true / 1,977 returned tokens / invalid JSON / 19 visible row starts / spool present**. Temp scripts: b15-review-probe.cjs, b15-size-probe.cjs, b15-budget-probe.cjs in the OS temp directory; generated bundle/spool also remain there.

No source regression tests were added because the review is source-read-only. Passing existing checks therefore do not refute these uncovered cases. No live task data or task states were changed. No current style review existed to duplicate. No live index failure injection or historical source differential was performed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for namespace/budget behavior; MEDIUM for full runtime behavior without live index/watcher failure injection.
- Top risk: The MCP response cuts during row 19 while its cursor advances beyond row 25.
- What a robust implementation would add: token-and-char-aware whole-row paging, oversized-row recovery, rename-safe traversal or explicit invalidation, strict cursor validation, normalized time keys, task help and failing-before regressions at the MCP response boundary.
