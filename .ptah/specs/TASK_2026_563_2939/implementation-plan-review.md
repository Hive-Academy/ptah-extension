# Implementation plan review

## Review state

- author: software-architect subagent, in-process side
- reviewer: codex CLI lane
- reviewed revision: r2
- rounds completed: 2
- verdict: **REVISE**

Final automatic review round. The intended R4-only design resolves finding 1 and findings 12-14. However, the operative migration instructions still direct the implementer to copy the removed r1 event guard, contradicting the R4-only specification. This is the remaining blocking document defect (finding 15). The user gate should receive this review rather than starting another automatic review cycle.

Only this file was written. Source/artifacts were read only under `D:\projects\ptah-extension-memory-quality-source`; the permitted snapshot was opened with node:sqlite readOnly:true. No git commands, live-state access, migrations, database writes, source edits, or test runs occurred.

References below are worktree-relative. **P** = `.ptah/specs/TASK_2026_563_2939/implementation-plan.md`; **Q** = companion `quarantine-rules.md`; **R** = approved `task-description.md` r2. P/Q line numbers refer to revision r2. OK denotes a plan commitment, not passed implementation evidence.

## Traceability

| Requirement / acceptance criterion                                       | r2 coverage                                                                                            | State                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| M4.1 Topic subjects; no catch-all examples                               | Component 1 topic-level examples                                                                       | OK                                 |
| M4.2 Reuse existing subject and retain search guidance                   | Component 1 SUBJECTS/TOOLS                                                                             | OK                                 |
| M4.3 Explicit transient/task/worktree/repo-rule exclusions               | Component 1 DO NOT EXTRACT                                                                             | OK                                 |
| M4.4 One production extract prompt                                       | Component 1 duplicate deletion/reference check                                                         | OK                                 |
| M4.5 Same schema/downstream shape                                        | Component 1 text-only/schema contract                                                                  | OK                                 |
| M4.6 Fixed transcript sample and all draft/subject metrics               | Measurement M4 row P:1012                                                                              | OK                                 |
| M4.7 Classify both runs and list durable losses                          | P:1012; Q refined any-field rubric                                                                     | OK                                 |
| M4.8 Lower count AND share, durable count and accepted-loss gates        | P:1012 requires M4.8(a)-(c)                                                                            | OK                                 |
| M3.1 Tier 1 first/unchanged, deduplicated tier 2                         | Component 7; empty-tier exception explicit under D4 B                                                  | OK subject to Gate 2               |
| M3.2 Named per-draft/total bounds and many-draft test                    | P:647-652 and collector specs                                                                          | OK                                 |
| M3.3 Exact named/NULL workspace                                          | Component 6 and P:665-675                                                                              | OK                                 |
| M3.4 No extra network calls                                              | P:194-217 explicitly distinguishes A requiring approval from B preserving resolve invocation condition | OK as decision presentation        |
| M3.5 BM25/error fallback                                                 | Components 6/7 catch and fallback specs                                                                | OK                                 |
| M3.6 No candidate usage/salience writes                                  | P:682-683 and no-write specs                                                                           | OK                                 |
| M3.7 Refuse out-of-list/cross-workspace target and insert new            | P:692-700 and guard tests                                                                              | OK                                 |
| M3.8(a) Increased family reach, M5 off                                   | Measurement M3 reach P:1010                                                                            | OK                                 |
| M3.8(b) Fixed attempted set, increased count/rate, M5 off                | P:1011, selected D4 variant judged                                                                     | OK; B failure risk disclosed       |
| M5.1 >15 classified rows in each category                                | Q:98-250 retains original 30/20/20/20 samples                                                          | OK                                 |
| M5.2 Exact predicates/counts and durable-loss disposition                | Q:398-444 defines R4 only and explicit workflow-loss policy; snapshot verified                         | OK, policy for Gate 2              |
| M5.3 Static additive migration/registration/spec, no old migration edits | P:346-403 mostly correct but contradictory removed-rule instructions at P:350-352                      | **MISSING — finding 15**           |
| M5.4 Counts/integrity/sorted all-column hashes/duration on copy          | P:1006                                                                                                 | OK                                 |
| M5.5 Exclude normal agent content paths and cover each                   | Components 4/6/8; read inventory; active memory:get                                                    | OK                                 |
| M5.6 Restore any scope and exactly one full round trip, fields unchanged | P:851-872, two restore calls for named/NULL scopes                                                     | OK; wording correction finding 16  |
| M5.7 Metadata-only/idempotent, no chunk/FTS/vector deletion              | P:347,357-360,397-402; store restore; copy audit                                                       | OK                                 |
| M5.8 Quarantined merge target refused                                    | getMergeTarget and component 7 guard                                                                   | OK                                 |
| M5.9(a) No lifecycle archive/delete/evict                                | Component 5 SQL predicates                                                                             | OK                                 |
| M5.9(b) Freeze lifecycle/usage/pin fields                                | Components 4/5 and restore assertions                                                                  | OK                                 |
| M5.9(c) Exclude cap pressure                                             | OVER_CAP and preview filters                                                                           | OK                                 |
| M5.9(d) Active-row behavior/443 expectations unchanged                   | Nullable state plus fixture migration 48; ceiling assertions separated from behavior                   | OK                                 |
| M5.10 Lifecycle quarantine/control/restore spec                          | Dedicated component 5 spec retained                                                                    | OK                                 |
| M5.11 Per-rule/total baselines and restored Track A results              | P:1007,1009; Q:426-444                                                                                 | OK                                 |
| Section 4.1 Same Track A method; >=main AND >=16/20                      | P:1009; Q:496-500                                                                                      | OK                                 |
| Section 4.2 Isolated consistent snapshot, recorded metadata/integrity    | Measurement copy protocol; Q section 1                                                                 | OK                                 |
| Section 4.3 M4/M3/M5 production reachability                             | Reachability table, DI, migration registry, RPC and round-trip specs                                   | OK subject to migration correction |
| Section 4.4 Scoped nx/header, both drivers, unit specs                   | Handoff verification and delivery checklist                                                            | OK                                 |
| Non-functional M1/M2/index/caps/order/0046 preserved, EQP evidence       | Components 3/4; index plan assertion                                                                   | OK                                 |
| Non-functional immutable salience; no decay or extra retention gates     | Component 5 and architecture quality requirements                                                      | OK                                 |
| Non-functional static/parameterized SQL                                  | Migration/store/RPC contracts                                                                          | OK                                 |
| Delivery isolation/branch/no main changes                                | P:4-6 and delivery checklist                                                                           | OK                                 |
| Delivery PM -> architect -> single user plan stop                        | Gate 2 checklist                                                                                       | OK                                 |
| Delivery file-disjoint parallel batches                                  | Combined {1+2}; other ownership unchanged                                                              | OK                                 |
| Delivery developer/reviews/tester/hooks/commit per batch                 | Delivery checklist                                                                                     | OK                                 |
| Delivery allowed commit scopes                                           | D2 explicit pending scope exception                                                                    | OK as decision presentation        |
| Delivery push/PR sections/in_review/retain worktree                      | Delivery checklist                                                                                     | OK                                 |
| Exclusions M6/S1-S9/Track B/439 phase 5/Jev; no M1/M2 redo               | No r2 expansion                                                                                        | OK                                 |

**M5 with one rule:** the approved criteria require sampling, justified predicates, reversible state, complete exclusion/restoration, lifecycle protection and measurements. They impose no minimum quarantine count, no 55% cleanup target, and no requirement that every sampled category yield a rule. Dropping unsafe event rules therefore does not itself violate M5. Sampling those categories remains valuable evidence supporting rejection. The limited outcome must be clear at Gate 2: only 89 existing commitlint scope facts (0.33% of this copy) are targeted; existing event/task/worktree sediment remains. M4 addresses future extraction, not historical cleanup.

## Author-introduced constraints

| Decision / constraint                                                                               | Provenance                                  | Disposition                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| M4/M3/M5, isolated worktree, copy measurements, single stop, scoped checks and delivery             | user-requested                              | Binding                                                                                                                        |
| D1 automatic 0049 on every user's DB                                                                | author-proposed                             | P:173-185; intended R4-only operation, reversible metadata; backup explicitly best-effort                                      |
| D2 two RPC methods and fix(rpc-handlers)                                                            | author-proposed                             | P:186-189 and handoff; user must choose at Gate 2                                                                              |
| D3 semantic-equivalence resolve prompt/listed targets                                               | author-proposed                             | P:190-193; supports M3 and approved guard                                                                                      |
| D4 A extra calls versus B exact-tier prerequisite                                                   | author-proposed                             | P:194-217; A does not meet original M3.4 without approval, B risks merge gate                                                  |
| R4-only retrospective cleanup, dropping all event rules                                             | author-proposed                             | Q:313-358,398-420; compatible with acceptance criteria, substantially smaller yield                                            |
| R4 may hide a durable workflow lesson stored as a scope-related fact                                | author-proposed                             | Explicit accepted-policy proposal at Q:413-420; requires informed Gate 2 disposition, not a claim of universal semantic safety |
| Pinned/core/corpus guards; no canonical row by rule                                                 | author-proposed                             | Q:388-422                                                                                                                      |
| 5/25/10/512 collector constants, two columns/two migrations/no new index                            | author-proposed                             | Retained                                                                                                                       |
| Active content reads separate from raw diagnostics; explicit named/NULL restore                     | author-proposed                             | Retained fixes                                                                                                                 |
| Durable-loss gates, exact-null scope, merge guard, lifecycle freezing/cap exclusion                 | author-proposed in approved r2 requirements | Now binding baseline                                                                                                           |
| Static migration/DI/layer conventions, dual drivers, degradation/DI lint                            | project-rule                                | Retained                                                                                                                       |
| Isolated npm ci, fixed samples/seeds, Claude/haiku harness, MCP-off limited evaluation              | author-proposed                             | Retained; future validation                                                                                                    |
| Bounded KNN over-fetch without refill                                                               | author-proposed                             | Documented for both search paths, per-query effect measured                                                                    |
| Explicit deletes remain authoritative; admin/statistics policy; dead resolve copy/barrel trade-offs | author-proposed                             | Unchanged                                                                                                                      |

## Parity deltas

not applicable

## Feasibility evidence

### Read-only R4 spot-check

Opened only `C:\Users\abdal\AppData\Local\Temp\mqs-563-snapshot\memcopy-563.sqlite` with `new DatabaseSync(path, { readOnly: true })`. Executed SELECTs; no mutation or vector loading.

Predicate from Q:405:

```sql
kind = 'fact'
AND TRIM(LOWER(subject)) LIKE '%commitlint%'
AND LOWER(content) LIKE '%scope%'
```

Combined with Q:390's pinned/core/corpus guard. The snapshot has no quarantine column, so omitted only `quarantined_at IS NULL`, uniformly true after nullable ADD COLUMN.

| Check                                     |                    Observed |
| ----------------------------------------- | --------------------------: |
| R4 before common guard                    |                         125 |
| R4 after common guard                     |                          89 |
| Matching NULL-workspace rows on this copy |                           0 |
| Chunks owned by matched memories          |                          89 |
| Union / standalone / first-match          | All 89, since only one rule |

These match Q:406-407,430-439 and P:174,605-606,1007. Prior 345/394 figures now clearly describe historical r1; 377 is correctly identified as a dropped candidate artifact.

All seven prior reviewer counterexamples returned R4 matches = 0:

- 01KWHNZ35HE87Y9BN1QJ4RY5FM
- 01KXDT44N5NS5JFVFNTCJC77KY
- 01KXKCB1ND5JQDE6W8P5F4P199
- 01M19SPXP18AFNSEWZ97GJRR5V
- 01M215720HVHDSD2PPD5BRVDEV
- 01M215720Z7652DGW8MQYGNXQY
- 01KX27X86M0BWY264NHQS0QEHT

Inspected three additional recent R4 matches: 01M1XE120FY133X5AXJC4FAFST, 01M1VHTZG61Y2WFG6SC59TSVH5 and 01KXKES19C4RR1KYY0QGWFBQWA. The second is the config-checking example already discussed at Q:373-375. The first combines a scope change with commit invocation and explicit-staging advice; the third combines scope/length rules with a no-hook-bypass instruction. These illustrate the disclosed mixed workflow-content risk in Q:418-420. The plan cannot infer semantic purity merely from kind=fact and the word scope; Gate 2 should evaluate that explicit trade-off. This round does not reopen the already-disclosed R4 policy as an undisclosed predicate defect.

The claimed 72 reads in Q:377-385 were not independently reconstructed as 72 distinct final-rule matches: historical holdouts include a preference excluded by current R4, and the reviewer samples may overlap other draws. Treat that statement as reported review effort, not independently verified population coverage. Required per-category sample sizes and the independently verified counts do not depend on that figure.

### Retained source feasibility

Earlier rounds checked the following load-bearing claims; r2 does not change their underlying design:

- `memory-curator.service.ts:603-612`: exact tier-1 call; :649-664 merge location supports the candidate-membership/eligible-target guard and insert fallback.
- `memory-search.service.ts:209-216,281-288`: shared cache needs scope and clamped topK; the plan retains both plus actual-scope counters and tests.
- Same file :383-402,444-456: workspace truthiness must change consistently in joins, filters and binds. Mandatory parent filters hide quarantine in BM25/vector reads; by-memory BM25 now filters before LIMIT.
- `memory.store.ts:357-410`: case-folded partitioned 5/50 tier 1 remains intact except the active predicate.
- `retention/memory-lifecycle.store.ts:12-61,281-285`: select/count/update/delete guards cover lifecycle and trigger-driven index deletion; `memory-lifecycle.store.spec.ts:56-96` pins index names, not exact EQP. Existing active-row expectations need no inherent change.
- `migrations/index.ts:78-109,346-355`: static Migration interface and highest version 47; 48/49 are proposed next versions on reviewed base.
- `migration-runner.ts:79-104`: no downgrade and optional/non-fatal backup, accurately disclosed.
- `sdk-internal-query.curator-llm.ts:294-299,359-368` and `resolve-prompt.ts:22,26-32`: production prompt use and empty-related short circuit support D3/D4.
- `memory-rpc.handlers.ts:240-258`: active lookup replacement remains specified, closing the explicit-ID content gap.

The prior libs SQL inventory found no additional unlisted production content-returning SQL path. r2 retains that inventory and active read policy. Raw FTS/vector entries remain for exact restore, but final parent filtering prevents returned quarantined content. KNN crowding remains an accepted, measured limitation. All listed waves remain file-disjoint after combining prompt components 1+2.

### r2 consistency audit

Scanned both documents for R1/R2/R3/R4, stale counts, guard names, migration/fixture instructions, round-trip and measurement references. Historical Q sample Rule columns are explicitly marked r0 at Q:31-32; retained event fixtures intentionally prove events are untouched at Q:473-474. These references are appropriate history/regressions, not instructions to revive a rule.

The intended current specification is one R4 UPDATE at P:347-349 and Q:400-405, 2 positive/13 durable/3 guard fixtures at P:389-400, named/NULL R4 round trip at P:851-872, and one reason/count at P:1007 and P:1155. The exceptions are findings 15-16 below.

## Findings

### Status of prior findings

1. **RESOLVED in intended r2 design (formerly blocking): durable event catches.** Q:320-323 classifies the four r1 examples, Q:354-358 drops R1, Q:400 drops all event rules, and Q:456-474 retains the seven reviewer examples plus further event regressions as negative fixtures. All seven were independently confirmed not to match R4. R4's workflow-loss policy is explicitly disclosed Q:413-420. The remaining operative stale-guard contradiction is tracked separately as finding 15.

2. **RESOLVED, retained:** explicit-ID retrieval. Components 4/8 still define getActiveById and change memory:get to return neither memory nor chunks for quarantined ids; component 9 retains active lookup coverage.

3. **RESOLVED, retained:** NULL-workspace restoration. Component 8 still requires explicit named/null scope, rejects omission, returns row scope in list and tests scope isolation. P:851,866-869 now exercises R4 in both scopes.

4. **RESOLVED AS GATE 2 DECISION, retained:** D4. P:194-217 states A needs approval and B preserves the resolve invocation condition while risking the merge gate. Pending user choice is not a review blocker.

5. **RESOLVED, retained:** shared-spec ownership. Handoff keeps {1+2} together; no new overlapping file ownership was introduced.

6. **RESOLVED, retained:** backup caveat. P:177-184,375-378 retains optional/non-fatal backup and downgrade limitations.

7. **RESOLVED, retained:** cache key includes clamped topK and tri-state scope with proper counter lookup and tests.

8. **RESOLVED, retained:** searchIndex BM25 filters upstream; KNN limitation covers both paths and is measured. P:605-607 now uses measured chunk count and disclaims a global-share bound on local crowding.

9. **RESOLVED, retained:** round trip restores all R4 rows across named and NULL scopes, and adds the corpus link after migration. P:866-872. Minor leftover workspace wording is finding 16.

10. **RESOLVED, retained:** delivery checklist covers reviews, hooks, tester, scoped checks, commits, push/PR/in_review/worktree. D2 remains explicit user scope choice.

11. **RESOLVED, retained:** Migration citation, prompt-only evaluation label, and both relevance gates remain corrected.

12. **RESOLVED:** Q:430-439 correctly explains 89 rows/chunks and historical totals; P:605-607 uses 89 measured chunks rather than a memories-to-chunks bound. Counts independently verified.

13. **RESOLVED:** Q:446-471 separates durable/guard/positive fixtures and explicitly marks the NULL-workspace scope fact positive. P:389-400 uses the same split and correct counts (2/13/3). No dropped event is a positive fixture.

14. **RESOLVED:** P:211-217 says Gate 2 sees proxy estimates only and replay arrives in testing; P:1011 and risk row P:1207 match that timing. A later return to the user occurs only if validation contradicts the choice, not as another scheduled approval stop.

### New r2 findings

15. **blocking — Operative migration instructions still copy the removed event guard.** P:347-349 correctly requires one R4 UPDATE, but P:350-352 then directs the implementer to copy “the EV event guard” and predicates from **quarantine-rules.md r1**. EV included kind=event; final R4 requires kind=fact. Combining them can select no rows; following the older revision can instead revive discarded event rules. Q:400-405 contains no EV and explicitly requires R4 only. P:129 also still says “Apply the four sampled rules once.” **Required before implementation:** replace P:350-352 with the exact r2 common guard plus R4 predicate (Q:390 and Q:405), remove EV entirely from operative instructions, and change P:129 to one sampled rule. This is a localized document repair, not a request for new architecture or another automatic review round.

16. **minor — Round-trip scope wording contradicts its new two-scope fixture.** P:851 seeds a named workspace and NULL workspace; P:852 still says “all in one workspace.” P:866-872 correctly restores both. Remove the stale clause and specify which active exact-subject control/draft belongs to each tested scope if tier 2 is exercised in both under B. Keep assertions scoped to the appropriate calls; “every restored row” should not imply that a named-only query returns NULL-workspace rows.

## Unresolved items

For the final user gate:

1. **Document correction required:** finding 15, the stale EV/r1 migration instructions and four-rule summary. The intended R4-only design resolves the earlier blocking rule-safety finding, but the current executable handoff is contradictory.
2. **Minor correction:** finding 16, one-workspace wording in the two-scope round trip.
3. **D1:** approve automatic boot application versus an operator-triggered alternative, understanding that the intended retrospective cleanup is only 89 commitlint scope facts on this copy; existing event/task/worktree sediment remains.
4. **R4 policy:** approve or narrow the disclosed treatment of scope-related facts that also contain workflow advice (Q:413-420). Read-only example 01M1XE120FY133X5AXJC4FAFST makes this trade-off concrete; restoration is available but does not mean the content lacks durability.
5. **D2:** approve the RPC surface and extra commit scope, or name the acceptable scope.
6. **D3:** approve the semantic-equivalence resolve prompt change.
7. **D4:** choose A (explicitly relax M3.4 for added resolve invocations) or B (preserve invocation condition, accept risk of failing merge-rate gate). Current gate evidence is proxy estimates; real replay follows during testing.
8. All implementation acceptance gates remain unexecuted: scoped checks, dual-driver tests, migration hashes/integrity, lifecycle/round-trip behavior, and M3/M4/relevance measurements. This review approves no implementation result.

No required final-round review operation was blocked. Final automatic verdict is REVISE for finding 15; no further automatic review was started.
