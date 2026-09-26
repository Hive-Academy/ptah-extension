# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 15, review r2 after revision round 1, Lane A. The normal MCP response now preserves whole rows through the actual budget layer. Both reported rename directions are detected, dates sort by instant, and task help explains count versus total. Three cursor defects remain.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

The score rises from r1 because real summary/full walks preserve all 150 rows and the rename and help corrections work. It remains below 7–8 because completing a task while walking a status-filtered list can invalidate the next page, a probable active-workspace operation. The other two issues require forged input or long Unicode folder names.

Scope and evidence: reviewed the revised tasks namespace, its regression tests, task descriptions/tests, new help topic and containing system namespace file, dispatcher task-list wiring and regression, and the shared budget predicate/response path. Unchanged files/sections already examined in r1 retain that context. Scope of the verdict is Batch 15, not unrelated tools in the large shared dispatcher. Inputs are Batch 15, context Decisions 2/4/17, archived r1 and the executor report's Revision round 1 section. No new task-description.md, general implementation-plan.md or style-review artifact was provided; instruction-file discovery from r1 found none. No git operations or source edits were performed.

References use worktree-relative paths:

- **N** = libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts
- **NS** = the colocated tasks-namespace.builder.spec.ts
- **D** = libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts
- **P** = libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- **H** = libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts
- **B** = libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts

## r1 findings status

| r1 finding                            | Status                                                    | Evidence and remaining limitation                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1: rename skips/repeats a task       | ADDRESSED for the reported single-rename cases            | N:502/N:798 check the boundary date group's prefix. Both crossing directions now return INVALID_CURSOR. A rename that stays entirely in the unseen suffix continues; other date groups do not invalidate. New status-filter coupling is R2-S1. |
| S1: default page cut at 2,000 tokens  | ADDRESSED on actual normal and oversized-row paths tested | P:2256 passes the budget layer's predicate; N:844–852 fits whole rows. Summary walk: 8 pages/150 unique IDs; full walk: 25 pages/150 unique IDs; every output unchanged by the real budget layer.                                              |
| M1: forged/corrupted cursors accepted | PARTIAL                                                   | N:527–547 rejects noncanonical encoding, empty/overlong strings and bad JSON. The fingerprint is not proof of issuance; a schema-valid v2 forgery still succeeds (R2-M1).                                                                      |
| M2: mixed-offset lexical ordering     | ADDRESSED                                                 | N:477 parses instants; N:483 compares those instants with ID ties. NS:673 covers offsets, date-only values and equal instants while preserving authored date text.                                                                             |
| M3: help/count semantics absent       | ADDRESSED                                                 | H:144–177 adds tasks help; H:160 defines count/page versus total/filter set, H:161 distinguishes MCP fitting; D:223 also defines count/total. The topic regression is in NS near the end of the file.                                          |

## Five logic questions

### 1. How does this fail silently?

The remaining silent wrong-result scenario requires fabricated input: an accepted v2 cursor can claim a nonexistent position after all dated tasks and return ok:true with an empty page (R2-M1, N:798). Ordinary crossing renames now refuse rather than silently skipping/repeating. A status-filter mutation produces a visible refusal (R2-S1), not a false complete result.

Ordinary summary invalidity remains visible through frontmatterValid:false (N:590). An oversized row explicitly signals incomplete content via oversized:true and recovery guidance (N:571/N:830), so it should not be interpreted as healthy or complete.

### 2. What user action produces unexpected behaviour?

Page through backlog tasks, then complete a returned task before fetching the next page. The status filter removes it from the fingerprint input, so the valid cursor is rejected (R2-S1, N:785–798). A valid long Unicode folder name can make the tool issue a cursor it immediately refuses (R2-M2, N:522/N:529).

Unfiltered metadata/status updates and insertion of a genuinely newer task were independently verified to continue normally; the fingerprint does not hash status/title/updated or every already-returned row.

### 3. What input data produces a wrong answer?

A fabricated current-version cursor with an empty-group hash can suppress all dated tasks (R2-M1). Accepted long Unicode IDs break continuation (R2-M2). The r1 mixed-offset wrong ordering is fixed by instantOf (N:477).

### 4. What happens when a dependency fails?

The new fit predicate runs inside list's existing try/catch, so a predicate exception or rejected index read produces ok:false (N:853). Missing services are reported (N:775). The cursor parse catch (N:539–546) remains narrow and reported through INVALID_CURSOR; its audit marker is justified.

Inherited limitations, not new findings: ready swallows initial warm-up failure (N:617), while the concrete TaskIndexService.list can itself swallow store failures and return empty tasks (libs/backend/task-specs/src/lib/task-index.service.ts:316–336). No new timeout or cancellation mechanism is introduced. Typed refusals remain JSON payload errors through the existing MCP success envelope (P:2259), not protocol isError:true.

### 5. What is missing that the requirements never mentioned?

A fingerprint over a filtered view is not a stable identity check when status changes (R2-S1). A content hash is not authenticated issuance (R2-M1). Cursor encoding must fit its own accepted length for all supported folder IDs, not merely typical generated IDs (R2-M2).

The current callback-free execute-code namespace still returns up to 25 rows without applying a budget locally (N:844). That is intentional and disclosed for MCP in H:161; scripts can process each page themselves. Returning a raw large page through execute-code is not evidence of an unchanged final response—the separate generic execution result path still owns delivery.

## Failure modes / new defects

### 1. R2-S1 — A normal status change invalidates a filtered traversal — Serious

- File: N:785–798, with fingerprint membership at N:507.
- Trigger: Three undated tasks A, B, C are backlog. Call list({status:['backlog'],limit:1}), receiving A plus nextCursor. Update A to done. Call list with the unchanged cursor and same filter.
- Symptom: Returns ok:false,code:'INVALID_CURSOR' rather than B. No identity or sort key changed; the agent is doing the ordinary work of completing tasks while enumerating the rest.
- Evidence: The index is called with status/type at N:785; ordered is built solely from those filtered rows at N:789; groupFingerprint then hashes only the surviving IDs at N:507. A disappeared filter member is indistinguishable from a renamed/deleted folder at N:798.
- Current handling: Restart from the beginning. Repeated completion of page members can repeatedly force restarts; the result may blame renames/additions/removals even though only status changed. Type edits can cause the analogous effect for type-filtered walks.
- Recommendation: Compute the boundary identity fingerprint from a filter-independent index view while selecting page rows from the requested filter. Retain genuine rename detection and use a coherent same-read view, or add equivalent index support. Pin filtered traversal after changing status both on the anchor and another returned equal-time row, plus unfiltered status updates/newer inserts.
- Severity rationale: Visible failure on a likely active-workspace workflow, and the prompt explicitly requires status updates that do not change order to keep working.

### 2. R2-M1 — A v2 fingerprint is still forgeable — Moderate

- File: N:509, N:547, N:798.
- Trigger: In a workspace containing only dated tasks, submit the canonical base64url JSON payload {"v":2,"c":null,"id":"zzzz","h":"e3b0c44298fc1c14"}. The h value is the first 16 SHA-256 hex characters of the empty string.
- Symptom: The actual namespace returns ok:true,count:0,total:4,tasks:[] despite never issuing that cursor. A caller can also compute a nonempty fingerprint from known IDs; no secret or issued-token lookup exists.
- Evidence: N:509 hashes public joined IDs; N:547 validates shape only; N:798 compares the recomputed public hash. With no undated rows the hash is always the known empty hash. NS:641–645's “fabricated” examples still encode v:1, so they fail the version check and do not test a current-version forgery.
- Current handling: Canonical encoding/corrupted-character rejection is fixed, but the report's claim that a fabricated well-shaped key fails is false for this v2 payload.
- Recommendation: If issued-only/altered-cursor rejection remains the contract, use an authenticated payload or bounded issued-token mechanism. Keep snapshot/fingerprint validity separate from authenticity. Add a v2 forgery test with the correctly computed fingerprint, not an obsolete-version payload.
- Severity rationale: Incorrect handling of deliberately fabricated input; no unauthorized access or security boundary bypass was demonstrated.

### 3. R2-M2 — Tool-issued Unicode cursor exceeds its own decoder limit — Moderate

- File: N:235/N:522/N:529.
- Trigger: A task ID consisting of 'TASK_' plus 180 repetitions of U+6F22, dated newer than a second task. Call list({limit:1}), then return nextCursor unchanged.
- Symptom: The tool emits an **802-character** cursor and rejects it as INVALID_CURSOR because the maximum is 512. Restarting yields the same unusable cursor, so this traversal cannot advance.
- Evidence: encodeListCursor has no encoded-size bound at N:522; decodeListCursor rejects above 512 at N:529. TaskIdRefSchema has no size ceiling (libs/shared/src/lib/types/task-view.schemas.ts:26–29); its shared path guard permits this Unicode component (task-view.types.ts:60–70). This 185-code-unit folder component is within Windows' ordinary component-length limit.
- Current handling: The fixed fingerprint keeps growth independent of page number, but raw ID UTF-8/base64 expansion is still unbounded relative to the decoder's cap. The comment at N:234 saying a minted cursor is well under 200 chars is not true for all accepted IDs.
- Recommendation: Guarantee emitted tokens are accepted: use a bounded opaque key/lookup, or derive a safe cursor ceiling from the supported ID encoding and enforce it consistently. Avoid silently excluding existing tasks. Add an encode/decode round-trip with a valid long Unicode folder name and a following row.
- Severity rationale: Unusual but supported input causes a deterministic pagination dead end.

## Blocking issues

None established after the r1 rename correction. Crossing renames now explicitly invalidate the cursor (N:798); residual hand-edited created changes remain the disclosed limitation at N:470.

## Serious issues

R2-S1 only: filtered status updates invalidate otherwise unchanged traversal keys.

## Moderate and minor issues

R2-M1 and R2-M2. No naming/formatting/style findings are included.

Residual implementation uncertainty, not a manufactured defect: largestFitting assumes a monotone fit predicate (N:551), but serialized cursor overhead and tokenizer counts can vary. Every chosen non-stub page was measured fitting; no row loss or over-budget chosen page was reproduced. The fallback stub itself is returned without another fits check (N:852); tested realistic oversized rows produced a small fitting stub with guidance.

## Data flow

1. **OK:** P:2256 passes fitsBudget(text,getToolResultBudget(name)) into the namespace.
2. **OK / R2-M1,M2:** Argument and canonical decoder checks validate shape (N:223/N:527), but do not authenticate issuance or guarantee the encoder's output is within the cap.
3. **R2-S1:** The index is filtered before the identity fingerprint is computed (N:785–798).
4. **OK:** Tasks get parsed instant keys and deterministic ID ties (N:789/N:483).
5. **OK for tested renames:** Fingerprint mismatch produces INVALID_CURSOR instead of returning a misleading continuation (N:798).
6. **OK:** render creates count/total/cursor from exactly the selected rows (N:816–825).
7. **OK on measured delivery paths:** Whole-row pages are reduced to fit; an oversized single row gets a stub and ptah_task_get note (N:830/N:844–852).
8. **OK:** Shared response fast path uses the same token measurement/budget (P:3000 and libs/backend/tool-output-reducers/src/lib/token-measure.ts:177).
9. **OK:** check still computes invalidity/totals on the full collection before slicing both arrays to 50 (N:870–887).

## Requirements fulfilment

| Requirement                                    | Status                      | Evidence / gap                                                                                  |
| ---------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| r1 crossing rename cases refused               | COMPLETE                    | Independent seen/unseen crossing probes return INVALID_CURSOR                                   |
| Unseen rename staying after cursor is harmless | COMPLETE                    | Independent A,B,C -> A,B,D continuation returns B,D                                             |
| Normal updates/newer tasks do not invalidate   | PARTIAL                     | Unfiltered passes; filtered status change fails R2-S1                                           |
| Cursor remains small across pages              | PARTIAL                     | 150-task equal-time walk at limit 18: each of first eight cursors 74 chars; long ID fails R2-M2 |
| Strict malformed/forged cursor rejection       | PARTIAL                     | Canonical checks fixed; current-version forgery succeeds R2-M1                                  |
| Chronological date ordering                    | COMPLETE                    | instantOf and equal-instant ID ties, N:477–490                                                  |
| Whole-row MCP summary/full pages               | COMPLETE for measured paths | Summary 8 pages and full 25 pages, 150 unique IDs each, no downstream changes                   |
| Oversized row guidance and progress            | COMPLETE for measured path  | Stub fits, note names ptah_task_get, next page returns B                                        |
| Execute-code defaults explicit                 | COMPLETE                    | No fits callback: 25 summary rows; H:161 distinguishes MCP budget fitting                       |
| count/page versus total/filter set             | COMPLETE                    | D:223 and H:160                                                                                 |
| Invalid summaries/check totals honest          | COMPLETE                    | N:590/N:882–887                                                                                 |
| New parse catch justified                      | COMPLETE                    | Narrow parse catch feeds typed rejection, N:539–546                                             |

No transcript data or task states were changed. Unfiltered ordinary status/title updates do not affect the ID fingerprint. A newer task in a different instant group does not invalidate. An addition/removal in the already-seen prefix of the boundary group does invalidate by design; the serious excess is treating a filter-only status transition as that identity change.

## Edge cases

| Case                                    | Handled          | Evidence / concern                                         |
| --------------------------------------- | ---------------- | ---------------------------------------------------------- |
| Same instant/null dates                 | YES              | ID ties; group prefix hash, N:483/N:507                    |
| New task with newer created             | YES              | Probe continued with B, total 4                            |
| Unfiltered status update                | YES              | Same probe; status is not hashed                           |
| Filtered returned task changes status   | NO               | R2-S1                                                      |
| Single rename across boundary           | YES              | Both directions explicitly refused                         |
| Rename within unseen suffix             | YES              | Continuation includes renamed row                          |
| Other date-group rename                 | YES              | Existing NS regression and group-specific predicate        |
| created manually edited across boundary | NO guarantee     | Explicitly disclosed residual; tools cannot edit created   |
| Page eight of 150 tasks                 | YES              | Constant 74-char cursors in equal-time probe               |
| Long Unicode ID                         | NO               | R2-M2, issued cursor length 802                            |
| Current-version forgery                 | NO               | R2-M1                                                      |
| Default/full row budgets                | YES              | All pages byte-for-byte unchanged by real budget           |
| Oversized title                         | YES in probe     | Fitting stub, visible recovery note and next-page progress |
| Check over 50 invalid/excluded          | YES              | Full totals/verdict before caps; existing specs pass       |
| Dependency rejection                    | YES at namespace | Caught at N:853; inherited lower-layer swallowing remains  |

## Verification

Requested checks each ran once with scoped output tails and one completion read:

- nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache: **PASS**, all three targets, 44.4 seconds.
- nx run degradation-audit:lint --skip-nx-cache: **PASS**, TOTAL 300.
- nx run ptah-electron:validate-deps --skip-nx-cache: **PASS**, including prerequisite.
- ptah_get_diagnostics scoped to tasks namespace, dispatcher and system namespace: **0 errors / 0 warnings**, TypeScript compiler.

Independent Node probes bundled the actual current namespace, budget layer and tokenizer with esbuild. The index was an injected in-memory implementation that genuinely applies status filters; shared schemas and production hashing were not mocked.

| Probe                                         | Result                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| execute-code namespace default, no fits       | 25 rows, 2,500 tokens                                                         |
| MCP summary first page                        | 19 rows, 5,733 chars, 1,929 tokens                                            |
| MCP summary full walk                         | 8 pages, 150 IDs, 150 unique, 0 changed downstream outputs                    |
| MCP full first page                           | 6 rows, 6,812 chars, 1,892 tokens                                             |
| MCP full walk                                 | 25 pages, 150 IDs, 150 unique, 0 changed downstream outputs                   |
| Oversized title at first position             | Stub with ptah_task_get note; fits; real budget unchanged; next row reachable |
| Filtered status change                        | INVALID_CURSOR — R2-S1                                                        |
| Unfiltered status update plus newer insertion | Successful continuation                                                       |
| Forged v2 + correct empty-group hash          | Successful empty page — R2-M1                                                 |
| Long Unicode folder ID                        | 802-character emitted cursor, then INVALID_CURSOR — R2-M2                     |
| Seen/unseen crossing renames                  | INVALID_CURSOR                                                                |
| Unseen rename staying after boundary          | Successful continuation with renamed row                                      |

The fit predicates are equivalent for successful delivery: both enforce 8,000 chars and 2,000 tokens using countTokensPiecewise. fitsBudget's byte-length fast path is a sound token upper bound (token-measure.ts:177–187). No trailer reservation is needed on this path because a fitting raw result returns unchanged; the budget only reserves a trailer on its reduction/spooling path (B:235–255). The probes confirm the normal pages never enter that path.

Probe files reside only under the OS temp directory: b15-r2-probe.cjs, b15-r2-probe-more.cjs, b15-r2-budget-probe.cjs and their generated bundles. The namespace tests cover the real budget function; the dispatcher test separately verifies callback wiring. This review did not run a live MCP server, SQLite/watcher mutation injection, or an exact historical git differential. No source tests were added under the read-only rule; new defects need failing-before regression specs.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the reproduced namespace/budget behavior; MEDIUM for live runtime integration not injected here.
- Top risk: Completing a task during a status-filtered walk rejects the next valid cursor and forces a restart.
- What a robust implementation would add: filter-independent identity validation, authentic cursor issuance checks, encoder/decoder size agreement for accepted IDs, and regressions for all three reproduced cases. Preserve the successful whole-row budget fitting.
