# Code Style Review — `TASK_2026_563_2939`, Batch 2

## Summary

| Metric          | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| Overall score   | 8/10                                                           |
| Assessment      | APPROVED                                                       |
| Blocking issues | 0                                                              |
| Serious issues  | 0                                                              |
| Minor issues    | 1                                                              |
| Files reviewed  | 17 batch files in full, plus 4 production migration precedents |

The implementation fits the existing migration structure: static SQL exports, descriptive safety headers, ordered explicit registration, and real-SQLite specs with local structural binding types. Evidence: `0048_memory_quarantine.ts:13`, `0049_memory_sediment_quarantine.ts:20`, `index.ts:76`, `index.ts:358`, and `0048_memory_quarantine.spec.ts:11`. The score is above the 5–6 band because no material structural or boundary gap was established; below 9–10 because the ratchet descriptions still contradict their assertions (finding 1) and independent static verification is unavailable.

All source references below are relative to **D:/projects/ptah-extension-memory-quality-source/libs/backend/persistence-sqlite/src/lib/migrations/**. `task/` means **D:/projects/ptah-extension-memory-quality-source/.ptah/specs/TASK_2026_563_2939/**; `root/` means that worktree's root. No source was modified. Concurrent memory-curator work was excluded.

## Scope and verification

- Read all 17 requested files in full, including the complete 572-line 0049 spec and all 12 ratchet specs. Compared the production headers with 0039, 0044, 0046 and 0047, and spec organization with 0044/0046/0047.
- Read `root/CONVENTIONS.md`, task context, Batch 2 and implementation-plan r3 component 3. Root and covering ancestor/directory checks found no applicable AGENTS.md or CLAUDE.md in this worktree. The supplied project-specific guidance also informed the review.
- Inspected the new SQL literals, imports, registry entries, fixtures, assertions and ratchet values. All 12 listed ceilings now assert 49 and carry the specified comment; examples and every file's evidence appear below. A migration-spec search found no `toBe(47)` occurrence. This is current-file verification, not a claim that a base diff was independently checked; no git operations were performed.
- `ptah_get_diagnostics` was called with absolute paths for the four new files. Result: **Unavailable — None of the requested files are inside the workspace root.** This is not a passing diagnostic result. Workspace-bound search could not select the required worktree, so native absolute-path reads were used.
- Available verification evidence: `task/reviews/batch-2-code-logic-review.md:22` records the scoped Jest invocation, and `:26` records **2 suites / 12 tests passed, no skips**. This reviewer did not rerun that suite. No independent lint/typecheck or Electron run was performed; the remaining batch gates are listed at `task/batches.md:238`.

## Five style questions

### 1. What breaks in six months?

Future migration additions require updating the replicated ceiling assertions again (`0028_gateway_conversation_workspace_root.spec.ts:83`, `0045_skill_backlog_cleanup.spec.ts:33`, `0047_memory_retention_health.spec.ts:34`). That is existing, explicitly requested maintenance work, not a new abstraction problem. The new fixtures freeze the accepted R4 policy with readable data and predicates (`0049_memory_sediment_quarantine.spec.ts:53`, `:82`, `:340`); a later policy should be introduced through a new migration, as `index.ts:124` requires, rather than generalized into configurable SQL.

### 2. What would a new team member misread?

The older test names imply their individual migration is still the latest while checking a registry maximum of 49 (`0047_memory_retention_health.spec.ts:29`, `:34`; `0046_memory_merge_subject_index.spec.ts:21`, `:33`). Finding 1 requests accurate registry-oriented language. The new tests avoid that ambiguity by asserting exact registration without claiming latest status (`0048_memory_quarantine.spec.ts:44`, `0049_memory_sediment_quarantine.spec.ts:317`).

### 3. What does this cost to maintain?

The 0049 fixture table occupies lines 82–303, with explicit fields exposing each counterexample's classification. Seeding is already centralized at `0049_memory_sediment_quarantine.spec.ts:380`, and snapshot/count readers at `:424`, `:433`, `:448` remove repeated query mechanics. Keeping these local costs less navigation than a separate fixture framework. The two new specs repeat the established binding opener (`0048_memory_quarantine.spec.ts:22`, `0049_memory_sediment_quarantine.spec.ts:30`; precedent `0044_memory_lifecycle.spec.ts:24`) without observed behavioral drift; no shared helper extraction is required by this batch.

### 4. Where is this inconsistent with the rest of the repository?

No material new inconsistency was established. The 0048 NOT IDEMPOTENT/SECURITY header matches 0047 (`0048_memory_quarantine.ts:13`, `0047_memory_retention_health.ts:7`); 0049 documents evidence and bounded data changes as 0039 does (`0049_memory_sediment_quarantine.ts:4`, `0039_reap_orphaned_queue_rows.ts:24`). The new tests use 0044's fail-if-no-binding structure and 0046's EQP detail assertion (`0048_memory_quarantine.spec.ts:59`, `:151`; `0044_memory_lifecycle.spec.ts:104`; `0046_memory_merge_subject_index.spec.ts:65`). The stale wording is inherited inconsistency adjacent to the ratchet edits, not a reason to alter production design.

### 5. What would you have done differently?

Update the stale titles/comments in finding 1 while adjusting their assertions, so the test runner describes what is actually checked. Keep the 0049 file together: its fixture table, shared seed function, and three distinct behavioral tests form one responsibility (`0049_memory_sediment_quarantine.spec.ts:82`, `:380`, `:455`, `:520`, `:542`). More helpers, fixture defaults or table-driven test generation would hide relevant input fields or add indirection without removing a demonstrated maintenance problem.

## Blocking issues

None established within the reviewed batch.

## Serious issues

None established within the reviewed batch.

## Minor issues

### 1. Ratchet titles and adjacent comments describe an obsolete latest migration — Minor

- **Files:** `0028_gateway_conversation_workspace_root.spec.ts:67`, `0030_skill_event_metrics.spec.ts:21`, `0038_gateway_message_turn_state.spec.ts:77`, `0039_reap_orphaned_queue_rows.spec.ts:52`, `0040_skill_candidate_workspace_root.spec.ts:65`, `0041_skill_md_migration_state.spec.ts:50`, `0042_db_integrity_check_state.spec.ts:59`, `0043_memory_retention.spec.ts:46`, `0044_memory_lifecycle.spec.ts:54`, `0046_memory_merge_subject_index.spec.ts:21`, `0047_memory_retention_health.spec.ts:29`.
- **Problem:** The `TASK_2026_511 appends migration 47` text is an adjacent comment, not a describe title. It remains present-tense guidance above ratchets that now assert 49. Several `it` titles also call the older migration the highest/latest. In particular, 0047's title explicitly conflicts with its maximum assertion at `0047_memory_retention_health.spec.ts:34`.
- **Impact:** Test output and nearby guidance misdescribe the assertion, creating avoidable confusion when investigating the next migration's failures. No production behavior or assertion correctness is affected; this is one grouped documentation finding, not eleven separate defects.
- **Recommendation:** **Fix now as a small, non-blocking wording cleanup.** Use an enduring title such as `tracks the current highest bundled registry version`; for combined registration tests, `is registered once as plain static SQL and tracks the registry ceiling`. Remove the obsolete present-tense comment or make it explicitly historical. Preserve the required 48/49 comment and all assertions, including 0047's version-47 lookup and pre-47 schema loop. Do not replace this with a version-number rename that will immediately age again.

## File-by-file

Scores below assess Batch 2's structure within each complete file; pre-existing test infrastructure is context, not an implied refactor request. `[M1]` refers to the single grouped finding above.

### `0048_memory_quarantine.ts`

Score 8/10 — 0 B, 0 S, 0 M. The header states column meaning, reversibility and runner-owned DDL application (`:3`, `:13`). A single exported static literal contains exactly the two additive statements (`:18`), matching 0047's public shape without introducing runtime branching.

### `0048_memory_quarantine.spec.ts`

Score 8/10 — 0 B, 0 S, 0 M. Registry/static checks and real-schema behavior are separate describes (`:43`, `:56`), consistent with 0044. The EQP assertion exposes the relevant predicate locally (`:139`) and DB use closes in finally blocks (`:125`, `:154`); no helper expansion is warranted.

### `0049_memory_sediment_quarantine.ts`

Score 8/10 — 0 B, 0 S, 0 M. The header documents the accepted evidence, protection guard, reversibility and idempotency (`:4`, `:14`, `:20`, `:25`). Its one static UPDATE remains directly auditable (`:33`), with no caller-dependent SQL builder or import boundary added.

### `0049_memory_sediment_quarantine.spec.ts`

Score 8/10 — 0 B, 0 S, 0 M. **The 572 lines are readable and maintainable as written.** Typed fixture data (`:62`, `:82`) and focused seed/read helpers (`:380`, `:424`, `:433`, `:448`) already provide the proposed table/helper structure. Three behavior tests separate selection, preservation and replay (`:455`, `:520`, `:542`); splitting solely on length would scatter the policy evidence.

### `index.ts`

Score 8/10 — 0 B, 0 S, 0 M. Aliased SQL imports extend the existing sequence (`:74`, `:76`), and versions 48/49 append with the same object shape as 47 (`:353`, `:358`, `:363`). This is a migration registry containing contracts/data, not a newly enlarged public export barrel; the 150-line barrel rule does not justify a registry split (`root/CONVENTIONS.md:42`, `index.ts:80`, `:129`).

### `0028_gateway_conversation_workspace_root.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The ceiling/comment pair is consistent with the batch contract (`:82`, `:83`). The stale lead-in and highest-version title remain ambiguous (`:67`, `:68`); registration continues to explicitly target 28 (`:58`).

### `0030_skill_event_metrics.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The local maxVersion variable and 49 assertion preserve the existing ratchet structure (`:35`, `:38`). The comment/title still imply the older migration is current (`:21`, `:22`), although the registration check correctly targets 30 (`:12`).

### `0038_gateway_message_turn_state.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The new comment and ceiling align with other ratchets (`:90`, `:91`). The highest-version wording at `:77`/`:78` remains misleading; migration-specific shape assertions are still clearly separated at `:94`.

### `0039_reap_orphaned_queue_rows.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The 49 ceiling uses the established shape (`:64`, `:65`), but the lead-in/title at `:52`/`:53` misdescribe it. The static migration checks stay distinct (`:68`, `:77`), so the wording can be corrected without restructuring behavior tests.

### `0040_skill_candidate_workspace_root.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The comment/assertion pair is consistent (`:77`, `:78`) and the exact-once entry check remains explicit (`:60`). Updating the stale registry wording (`:65`, `:66`) is sufficient; no new framework is warranted.

### `0041_skill_md_migration_state.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The 48/49 explanation and ceiling follow the requested ratchet (`:61`, `:62`). The older present-tense comment and highest-version title at `:50`/`:51` should become registry-oriented wording.

### `0042_db_integrity_check_state.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The ceiling is 49 with the specified comment (`:69`, `:70`), while the historical registration check remains version 42 (`:45`). The current-version language at `:59`/`:60` is the only batch-relevant style concern.

### `0043_memory_retention.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The new ratchet pair is consistent (`:53`, `:54`). Its title/comment at `:46`/`:47` should describe the registry ceiling; the file's fail-loud binding precedent remains legible at `:151`.

### `0044_memory_lifecycle.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The ceiling at `:68` is now 49 and carries the required explanation at `:67`. The title still calls 44 the highest (`:54`); the actual version-44 entry and lifecycle behavior remain separately expressed (`:55`, `:151`).

### `0045_skill_backlog_cleanup.spec.ts`

Score 8/10 — 0 B, 0 S, 0 M. The previously omitted ratchet is covered (`:32`, `:33`), as Batch 2 explicitly requires (`task/batches.md:220`). Its title makes the durable claim that 45 follows 44 (`:26`), avoiding the other files' obsolete latest claim.

### `0046_memory_merge_subject_index.spec.ts`

Score 7/10 — 0 B, 0 S, M1. The ceiling/comment is consistent (`:32`, `:33`), but the unique-latest title remains stale (`:21`). The compact EQP test is a useful precedent retained in the new 0048 spec (`:39`, `:65`).

### `0047_memory_retention_health.spec.ts`

Score 7/10 — 0 B, 0 S, M1. Version-47 registration and the schema lineage cutoff remain explicit (`:30`, `:46`), while the registry ceiling is correctly 49 (`:34`). Remove the title's latest claim (`:29`); do not change either historical version selector.

## Pattern compliance

| Repository rule or nearby convention                                | Status         | Evidence                                                                                                                                     |
| ------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Static SQL exports and explicit safety headers                      | PASS           | `index.ts:14`; `0048_memory_quarantine.ts:16`; `0049_memory_sediment_quarantine.ts:31`                                                       |
| 0047 additive-column header shape                                   | PASS           | `0047_memory_retention_health.ts:7`; `0048_memory_quarantine.ts:13`                                                                          |
| Data-migration evidence and bounded-change explanation              | PASS           | `0039_reap_orphaned_queue_rows.ts:24`; `0049_memory_sediment_quarantine.ts:4`, `:20`                                                         |
| Ordered append registration with aliased SQL imports                | PASS           | `index.ts:124`, `:76`, `:358`                                                                                                                |
| Local numbered migration naming overrides general kebab-case naming | PASS           | `index.ts:124`; `0048_memory_quarantine.ts:1`; `0049_memory_sediment_quarantine.ts:1`                                                        |
| No new cross-lib or platform-runtime dependency                     | PASS           | `0048_memory_quarantine.ts:18`; `0049_memory_sediment_quarantine.ts:33`; new specs' imports at `:7` and `:12` respectively                   |
| 0044 binding fallback and fail-loud spec structure                  | PASS           | `0044_memory_lifecycle.spec.ts:24`, `:104`; `0048_memory_quarantine.spec.ts:22`, `:59`; `0049_memory_sediment_quarantine.spec.ts:30`, `:355` |
| Parameterized fixture inserts and static query text                 | PASS           | `0049_memory_sediment_quarantine.spec.ts:385`, `:403`; `0048_memory_quarantine.spec.ts:80`                                                   |
| Narrow local types; no new any or suppression                       | PASS           | `0048_memory_quarantine.spec.ts:11`; `0049_memory_sediment_quarantine.spec.ts:16`, `:62`, `:310`                                             |
| Same 49 ceiling/comment in every requested ratchet                  | PASS           | All twelve file-by-file entries above; `task/batches.md:220`                                                                                 |
| Accurate test descriptions                                          | FAIL (Minor)   | Finding 1; especially `0047_memory_retention_health.spec.ts:29`, `:34`                                                                       |
| DI/facade, UI lifecycle and external-network conventions            | NOT_APPLICABLE | Plain SQL exports at `0048_memory_quarantine.ts:18`, `0049_memory_sediment_quarantine.ts:33` introduce none of these surfaces                |

## Maintenance debt

- **Introduced:** Two permanent migration artifacts and their policy/schema regression specifications (`0048_memory_quarantine.ts:18`, `0049_memory_sediment_quarantine.spec.ts:82`). Fixture detail is intentional evidence, not unnecessary structural debt.
- **Retired:** The current ratchet ceiling lag is resolved across all twelve listed tests (for example `0045_skill_backlog_cleanup.spec.ts:33` and `0047_memory_retention_health.spec.ts:34`).
- **Net:** Small, justified growth with no new production layer or dependency (`index.ts:358`). Existing duplicated ceilings remain by explicit batch contract (`task/batches.md:230`); stale descriptions should be cleaned up without turning this batch into a ratchet redesign.

## Verdict

- Recommendation: **APPROVE** — one non-blocking wording finding; no production structural correction requested.
- Confidence: **HIGH** for the inspected structure and conventions; static tooling and dual-driver execution remain independently unverified here.
- Key concern: Test names should distinguish historical migration identity from the current registry ceiling (`0047_memory_retention_health.spec.ts:29`, `:34`).
- What a 10/10 version would do differently: Resolve finding 1 with lasting registry-oriented wording and attach successful worktree-scoped lint/typecheck/diagnostics plus the planned Electron evidence (`task/batches.md:241`). Keep the current 0049 fixture table and helpers; no file split is needed.
