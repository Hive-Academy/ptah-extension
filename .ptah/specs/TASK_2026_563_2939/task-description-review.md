# Requirements review — TASK_2026_563_2939

## Review state

- author: project-manager subagent, in-process side
- reviewer: codex CLI lane
- reviewed revision: r2
- rounds completed: 2 (final automatic round)
- verdict: **APPROVED**

Findings 1, 3, 4, 5, 6 and 7 are resolved. Finding 2 is closed with the disposition “dispositioned by orchestrator: matches user wording.” R2 fixes the contradictory merge metric by keeping the attempted set identical while requiring increased family reach, merge count and merge rate. No open review findings remain.

This final round checked only the revised M3 criterion 8 and recorded the caller's explicit disposition of finding 2. No new defect was identified in the inspected revision. Unchanged requirements and source feasibility evidence retain their previous assessment; no new code audit was performed. All paths below are relative to `D:\projects\ptah-extension-memory-quality-source`. Retained evidence line numbers refer to r1 unless explicitly marked r2; r2 adds two lines after criterion 8, so subsequent unchanged sections are two lines later. Only this review file was written. No tests, database operations or git commands were run. Approval is of the requirements document, not implementation or measured outcomes.

## Traceability

| Requirement → source                                                                                                                | Artifact section → evidence                                                                   | OK/MISSING                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Worktree-only, branch `fix/memory-quality-source`, base `ebfc73321`, never commit to main → context.md:6                            | Delivery constraints:92-95                                                                    | OK — previously MISSING                                                   |
| Reuse existing evidence; do not redo Track A → context.md:8-12                                                                      | Context:9-40; Scope:83-86; §4:317-324                                                         | OK                                                                        |
| M4 production prompt, stable subjects, replace fragmenting examples → context.md:15                                                 | Scope:58-61; §1:125-130                                                                       | OK                                                                        |
| M4 filter transient events, task/worktree chatter, repository-rule copies → context.md:15                                           | §1:131-137                                                                                    | OK                                                                        |
| M3 hybrid searchRich, bounded top-k, workspace scope, exact-subject first tier, no new network calls → context.md:16                | §2:179-195                                                                                    | OK                                                                        |
| M5 migration state, retrieval/merge exclusion, restoration, no hard delete → context.md:17                                          | §3:242-302; Non-functional requirements:368-372                                               | OK — lifecycle guarantee now explicit                                     |
| More than 15 event rows classified before rules; save rules in spec folder → context.md:17                                          | §3:225-241, quarantine-rules.md                                                               | OK                                                                        |
| AC1 Track A real queries, relevance ≥16/20 without regression, increased near-duplicate merge rate, numbers → context.md:22         | R2 §2:205-218; retained §4:317-324, test-report.md                                            | OK — finding 7 resolved                                                   |
| AC2 fewer single-use subjects on real-session sample; numbers → context.md:23                                                       | §1:144-169, test-report.md                                                                    | OK                                                                        |
| AC3 quarantine → search/merge exclusion → restore → inclusion spec → context.md:24                                                  | §3:262-273,295-302                                                                            | OK                                                                        |
| AC4 conventional migration on real DB copy without data loss → context.md:25                                                        | §3:242-261; §4:325-340                                                                        | OK                                                                        |
| AC5 every changed unit tested; affected projects/direct dependents only, test/lint/typecheck, no workspace-wide run → context.md:26 | §4:349-356                                                                                    | OK                                                                        |
| AC6 production caller reachability for each change → context.md:27                                                                  | §4:341-348                                                                                    | OK                                                                        |
| Exclude M6 salience from real use → context.md:19                                                                                   | Scope:77                                                                                      | OK                                                                        |
| Exclude S1-S9 skill synthesis → context.md:19                                                                                       | Scope:78                                                                                      | OK                                                                        |
| Exclude TASK_2026_473 Track B → context.md:19                                                                                       | Scope:79                                                                                      | OK                                                                        |
| Exclude 439 phase 5 → context.md:19                                                                                                 | Scope:80                                                                                      | OK                                                                        |
| Exclude Jev/TypeSafe → context.md:19                                                                                                | Scope:81                                                                                      | OK                                                                        |
| Preserve shipped Track A M1/M2 and migration 0046 → context.md:11                                                                   | Scope:83-86; Non-functional requirements:360-367                                              | OK                                                                        |
| Preserve TASK_2026_443 age lifecycle/ranking-only salience → context.md:12                                                          | §2:199-201; §3:279-302; Non-functional requirements:368-372                                   | OK — quarantine exception bounded explicitly                              |
| PM → architect → STOP and show plan → context.md:29                                                                                 | Delivery constraints:96-100                                                                   | OK — previously MISSING                                                   |
| Team-leader file-disjoint M4/M3/M5 batches, which can run in parallel → caller's final-round clarification of user intent           | R2 Delivery constraints:101-102 requires file-disjoint batches and permits parallel execution | OK — dispositioned by orchestrator: matches user wording                  |
| Developers → both code reviewers → senior-tester → context.md:29                                                                    | Delivery constraints:103-105                                                                  | OK — previously MISSING                                                   |
| Per-batch commits with specified fix scopes → context.md:29                                                                         | Delivery constraints:106-108                                                                  | OK — previously MISSING                                                   |
| Push branch; PR against main with Summary and Test plan → context.md:29                                                             | Delivery constraints:109-111                                                                  | OK — previously MISSING                                                   |
| End in_review, remove nothing from main, keep worktree → context.md:29                                                              | Delivery constraints:95,112-113 preserves the worktree through the requested task end state   | OK — previously MISSING; no post-merge deletion authorized by this review |

### Acceptance-criterion checkability after revision

| User AC | Evidence and expected result                                                                                                                                                                                   | Assessment                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1       | test-report.md: four queries × top 5; branch relevance ≥ same-copy main and ≥16/20; commitlint subject reach improves; attempted draft set fixed; merge count and merges/attempts rate increase                | Checkable — r2:205-215 separates equal-denominator and improvement gates |
| 2       | test-report.md: session IDs, draft/distinct/single-use counts and share, overlap; new singleton count and share lower; durable draft count not lower; each lost durable fact reviewed and disposition recorded | Prior loss-disposition concern resolved, §1:160-169                      |
| 3       | Round-trip spec: no quarantined search/merge hits; restored eligibility and fields; lifecycle-pass spec retains quarantined rows/chunks while control rows follow existing behavior                            | Prior lifecycle gap resolved, §3:270-302                                 |
| 4       | Migration spec and test-report.md: equal table counts; integrity exactly ok before/after; zero existing memory/chunk rows added, removed or changed using deterministic comparison; duration                   | Prior evidence gap resolved, §3:247-261                                  |
| 5       | Every changed unit has a spec; named affected projects/direct dependents pass Nx test/lint/typecheck                                                                                                           | Retained, §4:349-356                                                     |
| 6       | Caller file:line evidence in test-report.md and specs sensitive to production wiring for M4/M3/M5                                                                                                              | Retained, §4:341-348                                                     |

## Author-introduced constraints

The r0 inventory remains historical review context, not a new set of findings. R1 now labels many additions as proposals at task-description.md:414-447, subject to the planned user checkpoint. This round did not re-audit unchanged additions.

- Prior additions retained include duplicate-prompt cleanup; exact prompt/schema restrictions; extra extraction metrics and rubric; tier ordering, deduplication and fallback details; invalid-target insertion behavior; four-category sediment sampling; exact spec counts/idempotence; per-rule totals; exact Nx syntax and dual-driver verification; index-plan and timing evidence; and a production restore surface. Their presence alone was not a blocking finding.
- New M4 gate at §1:160-169 requires lower singleton share, nondecreasing durable-draft count, and reviewed loss dispositions. R1 explicitly identifies these proposals at lines 421-424. This addresses finding 6.
- M5 lifecycle freeze, cap exclusion and lifecycle-pass test are explicit at §3:279-302 and identified as additions at lines 433-439. They operationalize the user's no-hard-delete guarantee and address finding 3.
- Migration identity/content checks and exact integrity result (§3:247-261) are disclosed at lines 440-441; consistent-snapshot methods/location/naming (§4:325-340) at lines 443-444. These address findings 4 and 5.
- Delivery constraints:108 newly says hooks are never skipped. This is an author-added delivery restriction relative to the exact user request; no new conflict identified.
- Snapshot filename restriction now has a cited rotation rationale at lines 333-338. Backup implementation was not inspected in this restricted follow-up; the rationale is recorded as the author's evidence, not independently verified source behavior.
- Dual-driver verification now names HANDOFF.md:56 at lines 352-355. The earlier missing source attribution is supplied; its contents remain outside this round's authorized inspection.

## Parity deltas

not applicable

## Feasibility evidence

No additional code reads were needed for the six-finding recheck. The following evidence is carried forward from r0, not represented as freshly verified:

- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:25,33-34,40-41` confirms fragmenting examples, limited durability guidance and existing subject-reuse tool guidance. M4 remains feasible at that prompt.
- `libs/backend/memory-curator/src/lib/memory-curator.service.ts:603-622` collects exact-subject candidates and passes them to resolve; lines 651-663 append to an existing returned ID without candidate/workspace/quarantine checks in that block; lines 665-694 provide the insert fallback. The proposed M3 path/guards remain new behavior at identified production sites.
- Names-only migration inspection found 0044, 0046, 0047 and index.ts, with no 0048. R1 preserves a next-free number and no edits to applied migrations at task-description.md:242-246.
- Track A retrieval measurement lines 13-16,70 establish the four queries and 16/20 baseline. Track A merge measurement lines 3-17 distinguish candidate supply from actual merge decisions. The fairness report lines 90-110 records final 5-per-subject/50-total supply.
- Track A PR follow-up lines 24-29,72-88 confirms TRIM(LOWER(subject)) and migration 0046. R1 keeps these at task-description.md:360-367. No new Track A conflict identified.
- R1 resolves the documented lifecycle conflict through explicit exclusion/frozen fields, cap behavior and control-row tests at task-description.md:279-302, with the allowed integration narrowed at lines 368-372. Only the mechanism remains open at lines 400-401.
- Hybrid internals, lifecycle source, duplicate-prompt imports, DB transcript availability, backup rotation and dual-driver infrastructure were not independently inspected in this round.

## Findings

1. **RESOLVED — prior blocking: workspace/branch protection.** `task-description.md:92-95` now names the required worktree, branch and base commit; prohibits editing the main checkout, committing to main and removing anything from main. This meets `context.md:6` and the corresponding part of `context.md:29`.

2. **CLOSED — dispositioned by orchestrator: matches user wording.** R2 `task-description.md:96-113` retains the restored execution/completion flow. Lines 101-102 permit file-disjoint M4/M3/M5 batches to run in parallel. The caller explicitly clarified in this final-round instruction that the user's wording is “can be parallel” and directed this disposition. That clarification supersedes the earlier interpretation of mandatory parallel execution; no new contrary evidence was identified. No artifact edit is required for this finding.

3. **RESOLVED — prior blocking: quarantine/lifecycle reversibility conflict.** `task-description.md:279-294` forbids lifecycle archive/delete/eviction of quarantined rows and dependent data, freezes named state, excludes rows from cap counting and preserves non-quarantine behavior. Lines 295-302 require lifecycle-pass round-trip/control evidence. Lines 368-372 expressly allow the minimal exclusion integration while still banning unrelated retention gates. Lines 400-401 leave only implementation mechanism open. The no-hard-delete guarantee is no longer an architect choice.

4. **RESOLVED — prior minor: migration no-loss evidence.** `task-description.md:247-261` requires named-table counts, integrity exactly `ok` before/after, and deterministic comparisons of all pre-existing columns in memories/memory_chunks with zero changed/added/removed rows. It delegates actual FTS/vector table names to the plan. This addresses the equality-of-failing-integrity and counts-only concerns.

5. **RESOLVED — prior minor: snapshot consistency.** `task-description.md:325-340` now requires a consistent snapshot, specifies backup/read-only or quiescent-copy alternatives, records method/time/path, and requires integrity `ok` before measurement while retaining live-data protection. Lines 333-338 give a rationale for the filename/location rule. This review verifies the requirement correction, not a performed backup.

6. **RESOLVED — prior minor: merge denominator and durable-loss disposition.** R2 `task-description.md:210-215` specifies attempts, merges and merges/attempts on an identical attempted set. Lines 160-169 require lower singleton count/share, nondecreasing durable drafts and explicit review/disposition of losses. The r1 introductory wording defect is separately closed in finding 7.

7. **RESOLVED — prior minor: contradictory merge measurement gate.** R2 `task-description.md:205-215` removes “each after value shall be higher.” Lines 207-209 explicitly require increased family-subject reach. Lines 210-215 record attempts, merges and merge rate, require the attempted set to remain identical, and require merge count and rate to increase. These gates are consistent; the denominator is no longer required to increase. No new defect was found in this change.

## Unresolved items

- None for requirements approval. All seven findings are resolved or dispositioned as recorded above.
- This is the final automatic review round. The planned user checkpoint after architecture remains in force; this review does not replace it.
- Tier-2 bounds/query text, restore/application surface and read-path inventory remain architecture choices under the defined requirements.
- Source feasibility limits listed above remain verification boundaries, not additional approval blockers.
