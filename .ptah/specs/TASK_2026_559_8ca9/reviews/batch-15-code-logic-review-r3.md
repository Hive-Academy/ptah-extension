# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 15, review r3 after revision round 2. All three r2 defects are fixed in the reproduced cases. The r1 rename, chronology and whole-row budget fixes remain effective. No Blocking, Serious or Moderate runtime defect was established; three Minor follow-ups remain.

| Metric              | Value                            |
| ------------------- | -------------------------------- |
| Overall score       | 8/10                             |
| Assessment          | APPROVED                         |
| Blocking issues     | 0                                |
| Serious issues      | 0                                |
| Moderate issues     | 0                                |
| Minor issues        | 3                                |
| Failure modes found | 0 reproduced functional failures |

Score rationale: correct filtered continuation, authenticated bounded cursors and real-budget walks support the 7–8 band. It is below 9 because the signature comparison is not explicitly constant-time, the committed tampering test does not isolate signature verification, and live SQLite/watcher behavior was not injected. These do not justify the 5–6 band: the previously probable failures now have working implementations and independent probes.

Scope: current Batch 15 tasks namespace and tests, task-description/help changes, task dispatcher fit callback, shared budget/measurement and shared filter/store paths. Earlier complete reads from r1/r2 remain context for unchanged sections; current changed functions and new regressions were reread. This is not approval of unrelated tools in the shared dispatcher. Inputs: Batch 15, context Decisions 2/4/17, archived r2, and executor report Revision round 2. Prior instruction-file discovery found none; no new instruction file was supplied. Source remained read-only. No git operations, task-state changes or live task mutations were performed.

Evidence paths are worktree-relative:

- **N**: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts
- **NS**: the colocated tasks-namespace.builder.spec.ts
- **H**: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts
- **P**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- **B**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts

## r2 findings status

| Finding                                          | Status | Evidence                                                                                                                                                                                      |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-S1: status update invalidates filtered cursor | FIXED  | N:844 reads once unfiltered; N:851 applies the store's shared predicate; N:858 resolves identity against all rows. Independent anchor and non-anchor completion probes continue successfully. |
| R2-M1: unissued empty-group v2 cursor accepted   | FIXED  | N:276 generates a random signing key; N:540 signs v3 payloads; N:603 verifies them. Exact v2 forgery and a schema-valid modified v3 payload both return INVALID_CURSOR. See Minor R3-N1/N2.   |
| R2-M2: Unicode cursor exceeds decoder limit      | FIXED  | N:523 hashes the ID; N:548 encodes fixed-size fields. A 255-code-unit Unicode ID produces a 134-character cursor and reaches the following row.                                               |

## Five logic questions

### 1. How does this fail silently?

No new functional silent failure was reproduced. Both crossing rename directions return INVALID_CURSOR through resolveAnchor (N:564/N:858). Altered current-version payloads fail verification (N:603). Normal pages remain byte-for-byte unchanged by the real budget layer. Summary invalidity remains visible at N:651, while oversized content is explicitly marked and recovery guidance is supplied (N:627/N:891).

Inherited uncertainty: the lower index service still catches store failures and can return an empty list (libs/backend/task-specs/src/lib/task-index.service.ts:316–336). This batch neither adds nor repairs that pre-existing dependency behavior.

### 2. What user action produces unexpected behaviour?

Restarting the host or intentionally moving a cursor between independently running hosts produces INVALID_CURSOR, rather than continuation (N:276/N:603). This is documented in H:166–168 for restarts, and the refusal explicitly says to omit cursor and restart (N:621–624).

That trade-off is acceptable for this endpoint-local traversal: an agent normally continues on the same connected tool host. A shared task index does not imply a shared signing key or cursor session. Cross-host transfer is possible if an agent deliberately hands a token to a different host, but it fails visibly and recoverably; no portability requirement was stated. The same loaded module key serves successive namespace instances in the process, rather than regenerating per call.

### 3. What input data produces a wrong answer?

No wrong ordering or missing page row was found for the exercised inputs: null/equal instants, offsets, filtered status changes, 255-code-unit names, forged payloads and the 150-task budget fixture. N:499 normalizes dates to instants and N:505 supplies deterministic ID ties. Signature/key hashes have negligible probabilistic collision risks, not a demonstrated defect.

The documented limitation remains manual changes to created across the cursor boundary (N:492): created is not writable through the task update API. The traversal is a live keyset walk, not a snapshot promising to include newly matching tasks that move into a filter behind its position.

### 4. What happens when a dependency fails?

The list body catches rejected index reads and fit-predicate errors (N:914); missing services are reported before the read. The new signature validation uses bounded input and a fixed schema before comparison (N:579–603). The parse catch remains narrowly scoped and its reported audit marker is accurate.

No timer, listener or per-cursor registry is introduced. randomBytes(32) at module initialization is cryptographically strong; an entropy-source failure would prevent module initialization rather than silently weakening signing (N:276). Existing index timeout/warmup/error caveats remain as recorded in r2.

### 5. What is missing that the requirements never mentioned?

Per-process cursors are not portable across hosts/restarts; this is now an explicit recoverable contract. Constant-time signature comparison is a small hardening omission (R3-N1). The current regression for payload rewriting accidentally relies on strict-schema rejection (R3-N2). A stale RPC comment misstates the filtering location (R3-N3).

## Failure modes

No Blocking, Serious or Moderate functional failure mode was established in r3. Scope exercised: actual bundled namespace/schema/crypto implementation with a mutable in-memory index; real tokenizer and budget layer; separate Node process for restart behavior; repeated 5,000-row filtering/paging. No SQLite fault injection, watcher race stress or live MCP server was run. This limits the claim to the reviewed paths and injected boundaries, not every host interaction.

## New defects and follow-ups

### R3-N1 — Signature comparison is not explicitly constant-time — Minor

- File: N:603.
- Trigger: Verification of a supplied signature.
- Current handling: signCursor(c,a,h) === signature uses JavaScript string equality. It does not promise constant-time comparison.
- Impact: The comparison may expose timing differences; no practical timing oracle, successful forgery, privilege escalation or data access violation was demonstrated. This MAC protects a read-only paging position, not authorization, so this is hardening rather than an established security failure.
- Recommendation: Compare the validated equal-length signature buffers with node:crypto timingSafeEqual. Keep length/shape checks first. Add a schema-valid wrong-signature test.
- Signing assessment: 32-byte random key (N:276), HMAC-SHA256 (N:540), fixed unambiguous field serialization and a 22-character base64url tag. The key is neither returned nor derived from public task data.

### R3-N2 — Rewritten-payload regression does not isolate the HMAC — Minor

- File: NS, test named “refuses a genuine cursor whose payload was re-written with a recomputed public hash”, around lines 1106–1140.
- Trigger: The test spreads a genuine v3 payload, then adds id:'zzzz'.
- Current handling: v3 uses a, not id; the strict schema at N:270 rejects the extra field before signature comparison.
- Impact: The suite could pass this test even if HMAC comparison were removed, leaving the claimed authentication behavior insufficiently guarded.
- Recommendation: Alter c or h without adding keys, preserving all valid v3 field shapes and the old signature; require INVALID_CURSOR. The independent review probe did precisely this and the current code refused it, so this is a test gap, not a runtime failure.

### R3-N3 — RPC comment still describes the old MCP filtering route — Minor

- File: libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:619–623.
- Trigger: A maintainer follows the documented data path.
- Current handling: The comment says the MCP path reaches the store with status/type and filtering happens in one place, the store.
- Impact: It misdirects future maintenance. The MCP namespace now reads unfiltered and invokes the same shared predicate itself (N:844–855).
- Recommendation: State that RPC and MCP reuse the same shared filter function at their respective layers; keep RPC's actual behavior unchanged. No runtime effect was found.

## Blocking issues

None established in r3.

## Serious issues

None established in r3.

## Moderate and minor issues

No Moderate issues. The three Minor items above do not invalidate the reproduced behavior or block approval.

## Data flow

1. **OK:** Task dispatcher passes the real fitsBudget predicate and tool budget (P:2256).
2. **OK, Minor R3-N1:** Decode bounds length/alphabet, checks canonical base64url and strict v3 schema, then verifies HMAC (N:579–603).
3. **OK:** One unfiltered index result supplies both identity and page data (N:844).
4. **OK:** Parse dates, sort deterministic keys, and apply mergeStatusTypeFacets/filterTasks from the shared library (N:845–855).
5. **OK:** Resolve hashed anchor and compare its unfiltered group fingerprint (N:564–575); status changes cannot remove it from this view.
6. **OK:** Keyset continuation uses the resolved full-list key; render counts filtered results and signs the cursor for the last selected row (N:867–885).
7. **OK on measured paths:** Return fitting whole rows or an explicit oversized-row stub; callback-free execute-code remains bounded by limit alone (N:903–912).
8. **OK:** Actual MCP budget preserves these fitting results unchanged; the row cursor never advances beyond a cut page in the measured walks.
9. **OK:** check computes full invalid/excluded counts and health before slicing each list to 50 (N:943–948).

## Cost and cursor lifecycle assessment

The unfiltered read does not broaden the SQL query relative to the former store filtering path: SqliteTaskIndexStore.listByWorkspace already executes SELECT * WHERE workspace_root = ?, maps every row, then filters in memory (libs/backend/task-specs/src/lib/task-index.store.ts:311–320). The new namespace adds its own full-list key mapping/sort and identity work.

For 5,000 in-memory tasks sharing the same null instant, half matching backlog, a budget-fitted walk returned all 2,500 matches across 100 pages and exactly 100 index reads:

| Measurement  |   Result |
| ------------ | -------: |
| Total walk   | 1,612 ms |
| Median page  | 13.41 ms |
| P95 page     | 34.94 ms |
| Maximum page | 75.35 ms |

This stresses anchor hashing in a single large date group. It measures namespace processing with the actual filter/hash/tokenizer, not SQLite reads, JSON deserialization or a cold index scan. No unacceptable cost was established at 5,000 tasks. Complexity remains full-list sorting plus scans/hashing per page; there is no session-growing retained table. Do not extrapolate the warm benchmark into a cold-index latency guarantee.

Normal equal-time cursors stayed 122 characters over eight pages; the long dated Unicode anchor produced 134 characters. Hashing the ID removes name-length growth. A separate Node process rejected a prior-process cursor **before any index read** and returned the restart instruction. This is honest recovery, not silent degradation.

## Requirements fulfilment

| Requirement                               | Status                             | Evidence / limit                                                  |
| ----------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| Filtered anchor status change             | COMPLETE                           | Probe returns B after A completes; N:844/N:858                    |
| Earlier non-anchor status change          | COMPLETE                           | Probe continues to TASK_00002                                     |
| Forged/unissued cursor refusal            | COMPLETE                           | Exact v2 and schema-valid v3 alteration refused                   |
| Strong key generation                     | COMPLETE                           | randomBytes(32), N:276                                            |
| Constant-time signature comparison        | PARTIAL, Minor                     | String equality, R3-N1                                            |
| Restart message actionable                | COMPLETE                           | Child process result says omit cursor to restart                  |
| Cross-host behavior acceptable            | COMPLETE with stated trade-off     | Endpoint-local token, visible refusal; no portability requirement |
| Maximum-length Unicode ID                 | COMPLETE                           | 255-code-unit ID, 134-char cursor, successful continuation        |
| Rename boundary protection                | COMPLETE for tested single renames | Seen/unseen crossings refused; unchanged-side rename continues    |
| Newer additions/unfiltered status updates | COMPLETE                           | Independent probe continues normally                              |
| Date ordering                             | COMPLETE                           | Parsed instant comparator and existing offset regression          |
| MCP budget/full-row preservation          | COMPLETE for measured fixtures     | 150 unique rows in summary/full real-budget walks                 |
| Oversized row recovery                    | COMPLETE for measured fixture      | Fitting stub plus ptah_task_get note; next row reachable          |
| Count/total/help/check caps               | COMPLETE                           | Prior fixes retained; N:880/H:160/N:943                           |
| Stale RPC comment                         | PARTIAL, Minor                     | R3-N3                                                             |

## Edge cases

| Case                                   | Handled                 | Evidence / concern                                            |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------- |
| Returned row leaves status filter      | YES                     | Anchor and non-anchor probes                                  |
| Type filter changes                    | YES by shared mechanism | Identity independent of type; no separate type-mutation probe |
| Null/equal dates                       | YES                     | Stable ID tie order and group fingerprint                     |
| Unicode folder at 255 code units       | YES                     | Compact cursor round-trip                                     |
| Payload altered with valid shape       | YES                     | HMAC refusal                                                  |
| Prior-process cursor                   | YES, explicit restart   | Refused with reads=0                                          |
| Seen/unseen rename crossing boundary   | YES, explicit restart   | Both probes refused                                           |
| Unseen rename remaining after boundary | YES                     | Renamed row returned                                          |
| Anchor deleted                         | Explicit restart        | resolveAnchor cannot find it, N:572                           |
| Hand-edited created                    | No snapshot guarantee   | Documented residual, N:492                                    |
| 5,000 tasks / 2,500 matches            | YES in warm probe       | 100 reads/pages, 1.612 s                                      |
| Oversized row                          | YES in probe            | Stub, note and continuation preserved                         |
| Empty/past final matching row          | YES                     | Empty render with no cursor; existing regression passes       |
| Index dependency silently defaults     | Inherited limitation    | Lower-layer catch not changed by this batch                   |

## Verification

All required commands ran once with scoped tails, with one completion read for each still-running command:

- nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache: **PASS**, all three targets, 54.3 s.
- nx run degradation-audit:lint --skip-nx-cache: **PASS**, TOTAL 300.
- nx run ptah-electron:validate-deps --skip-nx-cache: **PASS**, including prerequisite.
- ptah_get_diagnostics scoped to the namespace/help production files: **UNAVAILABLE**, compiler still running after 45 s. It was not retried; the independent scoped Nx typecheck above passed.

Real current namespace/schema/crypto, budget and tokenizer implementations were bundled into OS-temp Node probes. No production imports were replaced by schema/hash stubs; only the index boundary was injected. Key observed outputs:

| Probe                             | Result                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| Exact r2 filtered-status repro    | Successful next page, total 2                                |
| Exact r2 v2 forgery               | INVALID_CURSOR                                               |
| Schema-valid v3 altered c         | INVALID_CURSOR                                               |
| 255-code-unit Unicode ID          | 134-char cursor, next row returned                           |
| Summary budget walk               | 8 pages, 150 IDs / 150 unique, 0 changed downstream outputs  |
| Summary first page, this process  | 19 rows, 5,768 chars, 1,956 tokens                           |
| Full budget walk                  | 25 pages, 150 IDs / 150 unique, 0 changed downstream outputs |
| Full first page, this process     | 6 rows, 6,847 chars, 1,910 tokens                            |
| Execute-code default              | 25 rows, 2,525 tokens before generic delivery                |
| Oversized title at first position | Stub fits and budget leaves it unchanged; next row reachable |
| Cross-process continuation        | INVALID_CURSOR with restart guidance, zero index reads       |

Signed cursor text varies between processes, so exact token counts may vary; the fit test uses the actual serialized response, not a fixed assumed cursor cost. Both fit and delivery use the same token measurement and 8,000-char/2,000-token limits. No trailer reservation is necessary on the unchanged fast path.

Temp probes: b15-r3-probe.cjs, b15-r3-cost.cjs, and reused b15-r2-budget-probe.cjs with freshly rebuilt current-source bundles. No source edits or new persistent source tests were made under the read-only rule. No live MCP server, SQLite failure, watcher race or historical git differential was exercised.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for reproduced namespace/cursor/budget behavior; MEDIUM for unexercised live index/watcher integration.
- Top risk: Inherited index-error defaulting can still resemble an empty task tree; no new Batch 15 functional failure was demonstrated.
- What a robust implementation would add: timingSafeEqual verification, a schema-valid HMAC-tampering regression, and the corrected RPC comment. Preserve the filter-independent identity view and real-budget whole-row rendering.

Approval follows the requested gate: zero Blocking or Serious issues. Minor follow-ups remain explicitly recorded.
