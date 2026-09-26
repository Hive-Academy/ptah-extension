# Quarantine rules - TASK_2026_563_2939 (M5)

**Revision r2** (2026-09-26). Written by software-architect. Revised twice after the codex
cross-side review (`implementation-plan-review.md`, finding 1 in round 1 and again in the r1 recheck).

The sample and every number below were produced on a copy of the real memory database, before the
design was fixed (M5 criterion 1). The **final rule is in section 6**. Migration `0049` applies
only that one.

What changed in r2:

- R1 still caught four durable rows. Every narrowing was tried, and the narrowest still caught
  durable rows in a full 43-row read, so **R1 is dropped** (§4.4).
- A fresh 30-row R4 holdout was read across every field, and 0 are durable (§4.5).
- Only R4 remains: 89 rows and 89 chunks.
- The arithmetic explanation is corrected.
- The fixture set is renamed durable/guard/positive, and the positive NULL-workspace fixture is
  exempt from the stay-NULL rule.

What changed in r1:

- The rubric now judges every structured field, not only `content` (§4.2).
- The reviewer's three durable counterexamples are classified (§4.1).
- R2 and R3 are dropped.
- R1 gains a structural event guard (empty `learned`, and type not bugfix/decision/refactor).
- R4 is narrowed to commitlint facts that mention scope, with an explicit policy.
- Fresh seeded holdouts were drawn per candidate rule (§4.3).
- Totals are recomputed (345 rows at r1; superseded by r2, which keeps 89).
- Durable counterexample fixtures are specified for the 0049 spec.

In the section 3 tables, the `Rule` column records the **r0** rules (R1 to R4 of r0) and is kept as
sampling history. Section 6 states which r1 rule catches which sampled row.

## 1. The database copy

| Item                                 | Value                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                               | `C:\Users\abdal\.ptah\state\ptah.sqlite` (476,868,608 bytes + a live 5.6 MB `-wal`; Ptah was running, 7 `Ptah.exe` processes)                                                                                                                                                                                          |
| Method                               | SQLite online backup API: `node:sqlite` `backup(new DatabaseSync(src, { readOnly: true }), out, { rate: 2_000_000_000 })`. One step, so the whole copy comes from one read transaction. The source was opened read-only and nothing was written next to it. The live directory listing was identical before and after. |
| Taken                                | 2026-09-26 15:53:26.738Z to 15:53:29.639Z UTC (2,901 ms), 116,586 pages                                                                                                                                                                                                                                                |
| Copy                                 | `C:\Users\abdal\AppData\Local\Temp\mqs-563-snapshot\memcopy-563.sqlite` (477,536,256 bytes). It is outside `%USERPROFILE%\.ptah\state`, and its name does not start with `ptah`.                                                                                                                                       |
| SHA-256 of the copy                  | `2661275c4c120fd7554953cfae60ec6cc5f82c726ef0ebe925adf5b2e33b7810`                                                                                                                                                                                                                                                     |
| `PRAGMA integrity_check` on the copy | `ok` (3,377 ms)                                                                                                                                                                                                                                                                                                        |
| Schema                               | `schema_migrations` max = 47, `journal_mode = wal`                                                                                                                                                                                                                                                                     |
| Tool                                 | Node v24.15.0, `node:sqlite` (SQLite 3.51.3). The worktree has no `node_modules`, so `better-sqlite3` and `sqlite-vec` were not loaded. Vector tables were not read, except for their shadow row counts.                                                                                                               |

The copy is pristine: every script opened it only for reading. The tester must not modify it.
Take working copies from it with the same backup call. A disposable scratch copy with the rules
applied is `...\mqs-563-snapshot\scratch-eqp-563.sqlite`. All scripts used here are kept next to the
copy: `take-snapshot.mjs`, `stats*.mjs`, `sample.mjs`, `holdout.mjs`, `rules.mjs`, `matrix.mjs`,
`eqp.mjs`, `apply-rules-timing.mjs`, `tracka-check.mjs`, `transcripts.mjs`, `sample-ids.json`,
`holdout-ids.json` and `rule-matches.json`.

### Corpus on the copy

| Measure                                                                                 |                                                                                               Value |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------: |
| `memories` rows                                                                         | 26,706 (the forensics report measured 36,252. The 443 lifecycle has since deleted about 9.5k rows.) |
| `memory_chunks` rows                                                                    |                                                                                              29,447 |
| FTS entries (`memory_chunks_fts`, counted through shadow `memory_chunks_fts_docsize`)   |                                                                                              29,447 |
| Vector entries (`memory_chunks_vec`, counted through shadow `memory_chunks_vec_rowids`) |                                                                                              29,443 |
| `kind = 'event'`                                                                        |                                                                5,293 (3,587 recall, 1,706 archival) |
| Distinct case-folded subjects                                                           |                                                       20,241, of which 17,701 are used once (87.5%) |
| `ptah-video-studio` rows                                                                |                                                                                                 246 |
| Task-subject rows (`TRIM(LOWER(subject)) GLOB 'task[-_][0-9]*'`)                        |                                                                                               2,899 |
| Worktree rows (subject or `workspace_root` contains `worktree`)                         |                                                                                                 725 |
| Commitlint family (`LOWER(subject) LIKE '%commitlint%'`)                                |                     171 rows, 49 subjects (Track A measured 284 rows and 81 subjects on 2026-09-19) |
| Corpus-linked rows (`corpus_memories`)                                                  |                                                                                                 700 |
| Pinned / core                                                                           |                                                                                               2 / 2 |

## 2. Rubric: one rubric for the whole task

The same rubric classifies the sample here and the M4 extraction drafts (M4 criterion 7).

A row is **sediment** when its useful content belongs to one of these three classes. They match the
durability filter in the new extract prompt:

1. **Transient event.** PR, CI or check status. A commit pushed, merged, rebased or synced. A review
   verdict or score. An agent timeout, roster or lane assignment. A test-run count. A one-off run
   outcome or measurement.
2. **Task, worktree or branch chatter.** `TASK_YYYY_NNN` progress, batch numbers, plan approvals,
   worktree paths, layouts and state, branch names and sync state, stash cleanup.
3. **A restatement of a rule already stored in the repository.** Commitlint scopes, commit-message
   rules, lint, tsconfig or CI config contents, and package versions. The file in the repository is
   the source of truth, and the stored copy goes stale. This has been verified for commitlint:
   `.commitlintrc.json` now allows `agent-sdk`, `platform-electron`, `chat`, `chat-ui`,
   `auth-providers` and `memory-curator`, which every sampled commitlint row calls invalid.

A row is **durable** when it records a reusable fact, decision, preference, root cause or lesson
that stays true beyond the session, even if it was filed under a task subject or stored as
`kind = 'event'`. A code fact such as "X has a 6-arg constructor" is durable under this rubric. It is
not one of the three sediment classes.

A row that mixes both is listed as **mixed** when a rule catches it. Revision r1 replaces the r0
"primary content" test with the any-structured-field test in §4.2.

## 3. Sampling

- **Seed:** `TASK_2026_563_2939`. Within each category, rows are ordered by
  `sha256(seed + ':' + id)` in ascending hex order, and the first N are taken. The draw is
  deterministic and repeatable (`sample.mjs`), with no `RANDOM()`.
- **Category predicates**, run over the whole table in all workspaces:

| Category | Predicate                                                                     | Population |   N |
| -------- | ----------------------------------------------------------------------------- | ---------: | --: |
| E        | `kind = 'event'`                                                              |      5,293 |  30 |
| T        | `TRIM(LOWER(subject)) GLOB 'task[-_][0-9]*'`                                  |      2,899 |  20 |
| W        | `LOWER(subject) LIKE '%worktree%' OR LOWER(workspace_root) LIKE '%worktree%'` |        725 |  20 |
| C        | `LOWER(subject) LIKE '%commitlint%'`                                          |        171 |  20 |

- Because the hash order is shared, the categories overlap: 11 T rows are also E rows, and one W row
  (`01M274M5…`) is in E, T and W. That leaves 78 distinct rows, with more than 15 in every category.
- **Holdout.** After the rules were drafted, 12 more rows per rule were drawn from each rule's
  matched set with seed `TASK_2026_563_2939:holdout`, excluding already-sampled ids
  (`holdout.mjs`, `holdout-ids.json`). They estimated the precision of the **r0** rules. r1 draws fresh
  holdouts in section 4.3.
- The column `Rule` shows which **r0** rule caught the row. This is history; see section 6 for r1. `-` means no rule does.
  `guarded` means a rule's predicate matches but the row is protected by the common guard
  (corpus-linked, pinned or core).

### 3.1 E: `kind = 'event'` (30)

|   # | id                         | subject                               | excerpt                                                                                                          | Verdict  | Reason                                                  | Rule     |
| --: | -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------- | -------- |
|   1 | 01KWQ0RS8XQG2JVG98R7N8EW3Z | research-methodology-lesson           | "Lesson: always supplement scoped API queries with broader web research…"                                        | durable  | Reusable method lesson                                  | -        |
|   2 | 01M2K3EF7XDKEJKY5DTE2AYZ02 | task-2026-443-batch-4                 | "Batch 4 … accepted and committed as a6c92e4c2"                                                                  | sediment | Class 1+2: batch commit status                          | R1+R2+R3 |
|   3 | 01KV61EJM10M1FWBHCD478JJAX | ptah-extension                        | "Completed TASK_2026_125 … + TASK_2026_126 … ready for PR"                                                       | sediment | Class 2: task completion log                            | R3       |
|   4 | 01M2P3R4XZPBNDK9NARE2F33D7 | task-453-batch-12                     | "Batch 12 was committed as 990955dfe … pushed … PR #524"                                                         | sediment | Class 1+2                                               | R1+R2+R3 |
|   5 | 01M239AWQ3JCP6GMP3FW7WGXSB | task-2026-402-agent-two-way-messaging | "The user approved the implementation plan … wave 1 was assigned"                                                | sediment | Class 2: plan approval                                  | guarded  |
|   6 | 01M341CGTK1PNXMAQ4XQW01RP9 | task-2026-492-shell-spec              | "TASK_2026_492 has a dedicated worktree `docs/task-492-shell-spec`…"                                             | sediment | Class 2: worktree chatter                               | R1+R3    |
|   7 | 01M0802204E94Q8RGSK4Y1YAZE | tribunal-panel-wiring-completed       | "All eight batches of TASK_2026_237 completed … 330 tests"                                                       | sediment | Class 1+2                                               | R3       |
|   8 | 01KXKBWP66C48EAVVA6EX4DK7H | video-showcase-pipeline               | "Fixed a Remotion camera zoom bug … release shot HOLD_MS (2600ms)…"                                              | durable  | Behaviour and reason of camera grammar                  | -        |
|   9 | 01KWYABX0XT83J4RKZNW900JE1 | task-2026-153-completion              | "TASK_2026_153 … was COMPLETED … cherry-picked…"                                                                 | sediment | Class 2                                                 | R1+R3    |
|  10 | 01M24T2E7KKE6KR3W11W8FH2KK | pr-489                                | "PR #489 … was OPEN but CONFLICTING/DIRTY…"                                                                      | sediment | Class 1: PR status                                      | R2+R3    |
|  11 | 01KXK8PQQTXRC6RXMEHB79NRRJ | lm-studio-bug                         | "…pointed the Anthropic-speaking SDK straight at LM Studio's raw OpenAI /v1 endpoint with no translation proxy…" | durable  | Root cause, architectural                               | -        |
|  12 | 01M30JJRYQBAF1PXRMWNVVY1Z9 | nx-22-7-12-hop                        | "…nx migrate did not change optionalDependencies"                                                                | durable  | Upgrade lesson                                          | -        |
|  13 | 01KXEVMRHT2Z43689G42J170VB | ptah-workspace-switching-bugs         | "…streaming crash from background-workspace events … per-workspace isolated proxy pool…"                         | durable  | Three root causes plus a design (commit ids incidental) | -        |
|  14 | 01M2QCKBY9TFZS2BM881VDKGWK | task-2026-453-batch-13-review         | "…logic review scored 7/10 with NEEDS_REVISION…"                                                                 | sediment | Class 1: review verdict                                 | R1+R2+R3 |
|  15 | 01KWS7VTF2BV3Y5RDCS3TDK1V1 | orchestration-skill-execution         | "TASK_2026_145 orchestrated via /orchestrate skill: 6 batches…"                                                  | sediment | Class 1+2: one run's shape                              | R3       |
|  16 | 01M2K0JZHZEV70TCDRP77XWF0V | task-2026-442                         | "…committed as 06075afd5 … pushed to PR #514…"                                                                   | sediment | Class 1+2                                               | R1+R3    |
|  17 | 01M274M5QSN8ZQ8D4CPVM1V0AH | task-2026-419-worktree-resume         | "TASK_2026_419_95af tracks … did not establish a completed delivery commit"                                      | sediment | Class 2: task progress                                  | R1+R3    |
|  18 | 01M23W5XDE0XZG9KSZ4W6KGH45 | main-branch-sync                      | "The local main branch was fast-forwarded … PR #484…"                                                            | sediment | Class 1+2                                               | R3       |
|  19 | 01M2GQYBVQVCBTEC5AWC19ZQ65 | batch-9-adapters                      | "Batch 9 implemented … contract suites passed…"                                                                  | sediment | Class 1+2                                               | R2       |
|  20 | 01KXEK9AXV5GNBX7WGRW6E0M7W | canvas                                | "Commit `7a5469f4` on branch … three files staged…"                                                              | sediment | Class 1                                                 | -        |
|  21 | 01M1X6NQNDP547AZP1TQ9ME6K1 | stash-cleanup-2026-09-07              | "Two stashes were investigated and cleaned up…"                                                                  | sediment | Class 2                                                 | R2       |
|  22 | 01M26408PAYANMRE7646ARKP2M | pr-489                                | "PR #489 was reconciled … MERGEABLE, though still BLOCKED"                                                       | sediment | Class 1                                                 | R2+R3    |
|  23 | 01M30TECH8ZPHF4AYB9GRF5VES | dependency-migration-wave-4b          | "Wave 4b applied 15 … upgrades … verification was still pending"                                                 | sediment | Class 1+3: versions and run state                       | -        |
|  24 | 01KWJH8EA0K7YDFRES8K6F739R | ptah-tui                              | "Fixed Ink <Static> rendering escaped full-screen frame … bounded flex viewport"                                 | durable  | UI framework lesson                                     | -        |
|  25 | 01M2KJCTKTTMCAH8J3WSQXGSK3 | task-2026-443-phase2                  | "…rebased onto origin/main without conflicts … a3b2d7c71"                                                        | sediment | Class 1+2                                               | R1+R3    |
|  26 | 01M23E5K5X5GFPDV4MT92DKY9J | electron-startup-lag-2026-09-09       | "…maximum of 22,548.6 ms shortly before memory-curator startup"                                                  | sediment | Class 1: one-off measurement                            | R2       |
|  27 | 01M07WXCFH5T9BMTDWMJ4PS200 | mcp-oauth-handoff                     | "Completed all 4 handoff items … All committed on ak/elevate-video-and-tasks"                                    | sediment | Class 1+2                                               | -        |
|  28 | 01M2QC9PSP62RPT2T5WYTGAEZZ | task-2026-461-pr-526-fixes            | "PR #526 fixes … were completed on branch…"                                                                      | sediment | Class 1+2                                               | guarded  |
|  29 | 01M2JVSA2RBVE1KZQWZ70M4RJY | pr-510-sonar-fix                      | "…SonarCloud security findings were fixed … quality gate is green"                                               | sediment | Class 1                                                 | R2+R3    |
|  30 | 01M2BDXQ3WHMD2F7N5BK9S8ZRH | task-2026-429-agent-lifecycle         | "Follow-up BUGFIX task TASK_2026_429_ba4e was filed and committed…"                                              | sediment | Class 2                                                 | R1+R3    |

E result: 6 durable (20%) and 24 sediment. The forensics claim that `event` is about 100% sediment
does not hold on this corpus, so a blanket `kind = 'event'` rule is rejected (section 6).

### 3.2 T: task-subject rows (20)

|   # | id                         | subject                                         | excerpt                                                                               | Verdict  | Reason                           | Rule     |
| --: | -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- | -------- | -------------------------------- | -------- |
|   1 | 01M2K3EF7XDKEJKY5DTE2AYZ02 | task-2026-443-batch-4                           | (E2)                                                                                  | sediment | Class 1+2                        | R1+R2+R3 |
|   2 | 01M2P3R4XZPBNDK9NARE2F33D7 | task-453-batch-12                               | (E4)                                                                                  | sediment | Class 1+2                        | R1+R2+R3 |
|   3 | 01M239AWQ3JCP6GMP3FW7WGXSB | task-2026-402-agent-two-way-messaging           | (E5)                                                                                  | sediment | Class 2                          | guarded  |
|   4 | 01M21SAPC4ZX4SXVGVYWR1JD34 | task-2026-391-in-review (fact)                  | "…code-logic-review reports NEEDS_REVISION (5/10)…"                                   | sediment | Class 1: review status           | -        |
|   5 | 01M341CGTK1PNXMAQ4XQW01RP9 | task-2026-492-shell-spec                        | (E6)                                                                                  | sediment | Class 2                          | R1+R3    |
|   6 | 01M2Q5B8V1PEZ6D1HNP13RES6Y | task-2026-453-ac11 (fact)                       | "…no renderer long task over 200 ms and no more than 1,500 ms … must not be loosened" | durable  | Standing performance budget      | -        |
|   7 | 01KWYABX0XT83J4RKZNW900JE1 | task-2026-153-completion                        | (E9)                                                                                  | sediment | Class 2                          | R1+R3    |
|   8 | 01KXCC44267ZJSZ2EZR2E3YM6Z | task-2026-voice-providers (fact)                | "VoiceRpcHandlers now has a 6-arg constructor…"                                       | durable  | Code fact (not a sediment class) | -        |
|   9 | 01M26Q1SMPAXAM479KNJ10JYV6 | task-2026-411-sequencing (fact)                 | "TASK_2026_411 has completed B1 … plans B2 … B9 is final validation"                  | sediment | Class 2: batch sequencing        | -        |
|  10 | 01M2QCKBY9TFZS2BM881VDKGWK | task-2026-453-batch-13-review                   | (E14)                                                                                 | sediment | Class 1                          | R1+R2+R3 |
|  11 | 01M2G7QEQNACB0ESS80QCMD73T | task-437-ci (fact)                              | "CI, Electron E2E … all passed for earlier commits … on PR #510"                      | sediment | Class 1: CI status               | -        |
|  12 | 01M2K0JZHZEV70TCDRP77XWF0V | task-2026-442                                   | (E16)                                                                                 | sediment | Class 1+2                        | R1+R3    |
|  13 | 01M274M5QSN8ZQ8D4CPVM1V0AH | task-2026-419-worktree-resume                   | (E17)                                                                                 | sediment | Class 2                          | R1+R3    |
|  14 | 01M2KJCTKTTMCAH8J3WSQXGSK3 | task-2026-443-phase2                            | (E25)                                                                                 | sediment | Class 1+2                        | R1+R3    |
|  15 | 01M2QC9PSP62RPT2T5WYTGAEZZ | task-2026-461-pr-526-fixes                      | (E28)                                                                                 | sediment | Class 1+2                        | guarded  |
|  16 | 01M2BDXQ3WHMD2F7N5BK9S8ZRH | task-2026-429-agent-lifecycle                   | (E30)                                                                                 | sediment | Class 2                          | R1+R3    |
|  17 | 01KX7BY1GSABG7D0W6H09BE73K | task-2026-180-architecture (fact, property-hub) | "…dedicated COACH surface … AgentSurfaceKind union…"                                  | durable  | Architecture                     | -        |
|  18 | 01M2G67BCKRSWDRCP3CXBW01TQ | task-2026-437-batch-5                           | "Batch 5 … added Electron crash and hang observability … uncommitted"                 | sediment | Class 2                          | R1+R2+R3 |
|  19 | 01M1M3TMF3Y1K17Z2WPY2BY2G7 | task-2026-372 (fact)                            | "…parallel multi-provider web search … merges results by normalized URL…"             | durable  | Feature behaviour                | -        |
|  20 | 01M2G1X53QFJ33PEZ7S4JEDX2J | task-2026-437                                   | "TASK_2026_437 documents the Electron main-process freeze…"                           | sediment | Class 2                          | R1+R3    |

T result: 4 durable, all `kind = 'fact'`, and 16 sediment. A task-subject rule without
`kind = 'event'` would catch all 4 durable rows, so it is rejected (section 6).

### 3.3 W: worktree rows (20)

|   # | id                         | subject (workspace if worktree)                        | excerpt                                                                       | Verdict  | Reason                             | Rule  |
| --: | -------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | -------- | ---------------------------------- | ----- |
|   1 | 01M274M5QSN8ZQ8D4CPVM1V0AH | task-2026-419-worktree-resume                          | (E17)                                                                         | sediment | Class 2                            | R1+R3 |
|   2 | 01M261PEBR6BY10FX5BXTMA713 | compaction-metrics (ws: …compaction-ui-consistency)    | "…postTokens … must be treated as token counts…"                              | durable  | Token semantics                    | -     |
|   3 | 01M26SBC7RTRKRT70A8QG0H5AD | task-worktree-isolation (preference)                   | "…one writing agent per worktree, with read-only reviewers"                   | durable  | Standing practice                  | -     |
|   4 | 01M20ZCHDWKQ0G63CBNEKK000X | worktree-cleanup-procedure                             | "Worktree node_modules are junctions … remove junction before deleting…"      | durable  | Procedure                          | -     |
|   5 | 01M2G56P6HJS5511QWVVKFGVRX | orphan-queue-reaping (ws: …skill-corpus-tasks)         | "Migration 0039 reaps only unprocessed, never-attempted…"                     | durable  | Code fact                          | -     |
|   6 | 01M266XJJ69C6XK5PV68DK4WBB | stream-transformer-context-usage (ws: worktree)        | "…input_tokens + cache_read_input_tokens + cache_creation_input_tokens"       | durable  | Code fact                          | -     |
|   7 | 01M32JZHMK4A1EX1J2XJDTDV2R | local-only-worktrees                                   | "The `native-loop` … worktrees contained commits not present on origin…"      | sediment | Class 2: point-in-time state       | -     |
|   8 | 01M23JPD9SKG7NDDEKR9H641MX | worktree-test-regressions (event)                      | "Targeted worktree tests exposed two failures…"                               | sediment | Class 1                            | -     |
|   9 | 01M2118ARNK5B0N06GK33AN047 | ptah-worktree-layout                                   | "Active git worktrees: deploy-blockers (b41c4f453)…"                          | sediment | Class 2                            | -     |
|  10 | 01M264XR7KJCS5BNPND37FQKBY | worktree-subagent-access                               | "…workspace/permission-root mismatch…"                                        | durable  | Known limitation                   | -     |
|  11 | 01M28TT586KHXK3V43P2JPMJM3 | worktree-ui-layout                                     | "…WorktreeSectionComponent injects ElectronLayoutService…"                    | durable  | Code fact                          | -     |
|  12 | 01KWHQDWJ3Q1PYVVKTADFBQR6G | worktree-namespace-unscopd                             | "git:worktrees … still resolve backend-active folder…"                        | durable  | Known scoping gap                  | -     |
|  13 | 01M28PY0QS413D10SC1GXE47EY | worktree-cleanup (preference)                          | "…only be removed after confirming they contain no unique commits…"           | durable  | Preference                         | -     |
|  14 | 01M26MDNJB9615P6F1SJTKEC9G | git-review-cache-safety (ws: …git-review-controls)     | "`GitInfoService.reviewChanges` resolves and validates both refs…"            | durable  | Code fact                          | -     |
|  15 | 01M2G3T2WZ028TWY9HD065JAY5 | pr-worktree-isolation (preference)                     | "For this PR, work exclusively in `.claude-worktrees/agent-strip-summary`…"   | sediment | Class 2: PR-specific               | -     |
|  16 | 01M28W75FG3JW9YKWV1VM8603C | post-compaction-context-stats (ws: worktree)           | "Post-compaction context synthesis accepts a finite positive context window…" | durable  | Code fact                          | -     |
|  17 | 01M23HV9Y6533DVB23WKJMKSP8 | codex-compaction-audit-fix-worktree (event)            | "…each subagent to modify only its tool-created child worktree…"              | durable  | Workflow lesson                    | -     |
|  18 | 01M26QGMHQV8VR79TXGKRQHT62 | task-2026-414-batch-1 (fact, ws: worktree)             | "…immutable compaction resume snapshot … additive staleSnapshot?: true…"      | durable  | Design content; task id incidental | -     |
|  19 | 01M2JSYVD5CDGYCH88BHJJSD5G | task-2026-442-fluid-canvas-spans (event, ws: worktree) | "TASK_2026_442_68ba is implementing fluid, session-specific … layouts"        | sediment | Class 2                            | R1+R3 |
|  20 | 01KVT3D2411D0PR0EHVYT9EM3D | claude-sdk-worktree-vs-ptah                            | "Claude Agent SDK … native git worktree support…"                             | durable  | Product fact                       | -     |

W result: 14 durable and 6 sediment. A worktree keyword or worktree `workspace_root` is not a
sediment signal (section 6).

### 3.4 C: commitlint family (20)

|   # | id                         | subject                                      | excerpt                                                               | Verdict  | Reason                                                       | Rule    |
| --: | -------------------------- | -------------------------------------------- | --------------------------------------------------------------------- | -------- | ------------------------------------------------------------ | ------- |
|   1 | 01KWHRYNS7FG9BG13K65QH3FW6 | commitlint-config                            | "custom scope enum (webview, vscode, …, cli)…"                        | sediment | Class 3, stale                                               | R4      |
|   2 | 01KXERX33FBZJVC8N349VBQBJD | ptah-commitlint                              | "…does not include 'platform-electron' as a valid scope"              | sediment | Class 3, wrong today                                         | guarded |
|   3 | 01KXEQX6Q2MTEXGCTXNVC6R7KA | ptah-commitlint                              | "'agent-sdk' is NOT a valid scope"                                    | sediment | Class 3, wrong today                                         | guarded |
|   4 | 01KXGH79XAP5QCVAYXSWWAMCM5 | ptah-commitlint (preference)                 | "scope-enum restricts scopes to: webview … cli"                       | sediment | Class 3, stale                                               | R4      |
|   5 | 01KXGS233AZBW6P7JA1HF3QPNA | ptah-commitlint                              | "The scope 'chat' is not valid…"                                      | sediment | Class 3, wrong today                                         | R4      |
|   6 | 01KW9MGWYHC7ZCP0RHH2BN6V10 | commitlint-scope-enum                        | "strict scope-enum: webview … cli. Subject max 72 chars"              | sediment | Class 3                                                      | R4      |
|   7 | 01KX2YRSM5XH9NYK52RMXJJR11 | commitlint-scope (preference)                | "libs/frontend/chat-ui require commit scope 'webview'"                | sediment | Class 3, wrong today                                         | R4      |
|   8 | 01KXDY4KFXSP703GSYNX3N0B4C | ptah-commitlint                              | "allowed scopes do not include 'chat'"                                | sediment | Class 3, wrong today                                         | R4      |
|   9 | 01M1XMRK9PFTXVVB4G7JMSR0MC | commitlint-multi-scope-batching (preference) | "…split into separate commits per scope…"                             | durable  | Working practice derived from, but not a copy of, the config | guarded |
|  10 | 01KXBM3P58SVTXDDZCKGP0SV30 | commitlint-scopes                            | "allowed scopes are [webview … cli]"                                  | sediment | Class 3                                                      | R4      |
|  11 | 01KWSVYMF0JG813RETR3NHHQAT | commitlint-scope-mapping                     | "`auth-providers` lib scope maps to the `electron` runtime scope"     | sediment | Class 3, wrong today                                         | R4      |
|  12 | 01KVZMQM2H20ASABZ2Z4VGB74A | commitlint-subject-case                      | "Commit subject line … must be lowercase only"                        | sediment | Class 3: `subject-case` rule copy                            | R4      |
|  13 | 01KVWYX2VD8EQA06MP7XER4SBS | commitlint-subject-case-rule                 | "subject-case rule rejects sentence-case…"                            | sediment | Class 3                                                      | guarded |
|  14 | 01KWQ0FB3Y06GHDG890M24M244 | ptah-commitlint-scopes                       | "No 'agent-sdk' scope exists…"                                        | sediment | Class 3, wrong today                                         | R4      |
|  15 | 01M1WAX4T4Y2JMZHY82KFCADT3 | commitlint-scope-enum                        | "git-ui must be added to .commitlintrc.json scope-enum…"              | sediment | Class 1+3: one-off, done                                     | guarded |
|  16 | 01KXEMK27560GQPPGKJH1H1M4W | ptah-commitlint                              | "Valid commitlint scopes in this repo: webview … cli"                 | sediment | Class 3                                                      | guarded |
|  17 | 01M24941ZZ3Q1E66E4Z8301S67 | commitlint-scopes                            | "agent-run-store is not included … used the persistence-sqlite scope" | sediment | Class 1+3                                                    | guarded |
|  18 | 01KWHRDGDR0WD2JK4V0042ZZF4 | commitlint-scope-enum-correction             | "only `webview, vscode, …` accepted…"                                 | sediment | Class 3, wrong today                                         | R4      |
|  19 | 01KW9QZ5XZG79SWQDD0QKQPW0J | ptah-extension-commitlint                    | "Types: build, chore … Scopes: webview … cli…"                        | sediment | Class 3                                                      | R4      |
|  20 | 01KWMMZSN09NQN0WSKGT7RTYQ0 | ptah-commitlint-scope-enum                   | "Memory-curator and voice changes use `electron` scope"               | sediment | Class 3, wrong today                                         | R4      |

C result: 1 durable and 19 sediment. 9 of the 20 rows are corpus-linked, so the guard keeps them
active.

### 3.5 Holdout (12 per rule, drawn from each rule's matched set)

| Rule | Holdout ids                                                                                                                                                                                                                                                                                                                                        | Verdicts                                                                                                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | 01M05S5GKF6TQC6QSJNF70XNK1, 01M2APSNAF4D4MEWMBP7Z995FG, 01KTGHDN44S1MDDT98EWRB94AF, 01KXGJ4SMYGS006XBQ27B5ZNRH, 01M2QA7XMT720MGC2QJRV122B6, 01M2KD3CFY8M87C6JXF3MPA948, 01KW24MMYWHX8VS6G2W23H3DFX, 01M32HC64AA69DC6VEMW91D8YE, 01M2KT0N0QHXQA2R1DKR1CY7WF, 01M2G4BMJ02MZG7AFF1KN0KR3S, 01M2GPCWVA5QECSWJ2H4K5Y5N1, 01M2HA71PFM4S3BJQ69M2X0SF5     | 12 sediment: task completions, review verdicts, batch or commit status, verification runs                                                                                                                                                       |
| R2   | 01M2QA7XMT720MGC2QJRV122B6, 01M2RHB504JCVT6RDFZ7093A13, 01M2HQYXKQ0VAYH1PP1AY4576P, 01M2Q9W8SRJ9EC41ZGNXAB26NX, 01M1XN1TMN608TWW8NCJ8DKWJX, 01M2G4BMJ02MZG7AFF1KN0KR3S, 01M2GPCWVA5QECSWJ2H4K5Y5N1, 01M2HA71PFM4S3BJQ69M2X0SF5, 01M04WBXT931YMB890WT9C13WK, 01KXGJCBN840J991CQ8FZ2H9CD, 01M26408NDMVD175ZGSQ0SY2X0, 01M2ZS0TXAT8015MKC1JK0807Q     | 12 sediment: PR status, branch commit logs, batch status, follow-up lists                                                                                                                                                                       |
| R3   | 01M05S5GKF6TQC6QSJNF70XNK1, 01M1C0ECR9V4ZAFYGFRD4Z35JX, 01M2APSNAF4D4MEWMBP7Z995FG, 01KTGHDN44S1MDDT98EWRB94AF, 01KXGJ4SMYGS006XBQ27B5ZNRH, 01M2QA7XMT720MGC2QJRV122B6, 01M2KD3CFY8M87C6JXF3MPA948, 01M2RHB504JCVT6RDFZ7093A13, **01KXK7Z2YKPBY09DA2PGPN87ND**, 01M32HC64AA69DC6VEMW91D8YE, 01M2HQYXKQ0VAYH1PP1AY4576P, 01M2Q9W8SRJ9EC41ZGNXAB26NX | 11 sediment. **01KXK7Z2…** (`tribunal-panel`: "Root problem: the panel re-implemented chat logic…") is **durable**. It led to the r0 LESSON guard, which r1 keeps inside `EV` (section 6).                                                      |
| R4   | 01KWHR6QZ9BET4H7YBTE35NB5F, 01KXGQ0T9B02TNRE8WWGA296M5, 01KWC0MW1Y7E6SHT3YXB9KWYA7, 01KXBPRYRSKD60C0D3712PJEE7, 01KXE0T8VVKYDMXYK55A2MKTXY, 01KW27F0Y5AME62HCEYSW8X0DG, **01KW9R8WEE5KBG2Y1N7F3TK9TC**, 01KXDYRR0A8T0YDEAT057KE382, 01KWMCPFJ06CDBHEPGJ2YFR8QV, 01KWY8S2HTM883FEK4TP45J5FS, 01KXDZAQCBW046BHB4WQ6MJCJ4, 01KXDXWZD9B26P1XJ1HC6PEPSR | 11 sediment (stale scope lists or "X is not a valid scope"). **01KW9R8WEE…** (`commitlint-constraints`) is **mixed**: a stale scope rule plus the tip "pre-commit hooks … can fail on transient concurrent edits; retry". Accepted in R4 below. |

## 4. Revision r1: counterexamples, refined rubric and fresh holdouts

### 4.1 The reviewer's counterexamples

These rows were caught by the r0 rules (`implementation-plan-review.md` finding 1). The copy was
re-read read-only on 2026-09-26 (`r1check.mjs`).

| id                         | subject                   | kind/type    | caught by (r0)            | Verdict     | Reason                                                                                                                                                  |
| -------------------------- | ------------------------- | ------------ | ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01KWHNZ35HE87Y9BN1QJ4RY5FM | /clear-command-regression | event/bugfix | R2 (`subject LIKE '%/%'`) | **durable** | Its `learned` field holds the root cause and the fix: CHAT_COMPLETE is deliberately ignored per turn, and the fix re-registers it narrowly for `clear`. |
| 01KXDT44N5NS5JFVFNTCJC77KY | vscode-e2e                | event/bugfix | R3 (`PR #`)               | **durable** | Its content and `learned` hold the root cause: an awaited `showInformationMessage` with buttons never resolves headlessly and deadlocks activation.     |
| 01KXKCB1ND5JQDE6W8P5F4P199 | chat-view-empty-state     | event/bugfix | R3 (`TASK_20`)            | **durable** | It records the `@for` with zero tabs regression and the `@empty` fix.                                                                                   |

The r0 rules were unsafe for two reasons:

- They read `content` only.
- The `LESSON` guard matched four literal words.

On the copy, 3,984 of 5,293 events (75%) carry a non-empty `learned` field. Many rows that look like
sediment by `content` hold a reusable root cause in `learned`. One example is `01M2HA71…`: "A shared
single-slot `default` lane allows a long curator synthesis … to delay interactive wizard work".

### 4.2 Rubric refinement (applies from r1, including to the M4 draft classification)

1. **Every structured field counts.** A row is durable if _any_ of `content`, `learned`,
   `investigated`, `completed` or `next_steps` holds a durable fact, root cause, behaviour or lesson.
   The row's primary content does not decide it.
2. **A change log is sediment class 1.** "X removed", "Y wired", "Z committed as <sha>" describe a
   diff that the repository already holds.
3. **A change record is durable when it states behaviour, a constraint or a reason** that the code
   does not make evident. For example: "now uses mtime or changed content to detect rewrites", or
   "resume now sends the user's typed message instead of a canned string".

Under clause 1, the section 3 classifications were re-checked for every row a revised rule still
catches:

- T20 `01M2G1X53QFJ33PEZ7S4JEDX2J`, caught by R1. `EV` requires an empty `learned`, so there is
  no structured-field content to consider.
- The 11 C rows caught by R4. They are stale scope-list facts; any `learned` content restates the
  same config.

All of them stay sediment.

### 4.3 Fresh holdouts per r1 candidate rule

The draws use seeds `TASK_2026_563_2939:r1-holdout` and `…:r1-holdout-pr`. They exclude every
previously sampled id, with 15 rows per rule (`rules-r1.mjs`, `rules-r1-final.mjs`,
`holdout-r1-ids.json`, `holdout-r1-pr-ids.json`). Each candidate rule below uses the r1 structural
event guard `EV` from section 6.

| Candidate rule                                   | Holdout result under the refined rubric                                                                                                                                                                                                                                                                     | Decision                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Event with task subject                          | 15 of 15 sediment: task completions, agent assignments, review counts, wave or batch status. Three are change logs classified sediment by clause 2: `01M05QV23NVEZAVC8W1638JSSR` (deleted symbols), `01M178XVR3EK02EBDD3GC4B83M` (template size reduction), `01KX2XW97DT12VGQNTS5M7FH4D` (providers wired). | **Kept as R1 in r1; dropped in r2 (§4.4)**                        |
| Event with `pr-NNN` or `*batch-N` subject        | 1 durable of 15: `01M05TZG25SK3SE2FMB9S4ZXCZ` (`batch-2-wiring`, which says where derived tiers are wired).                                                                                                                                                                                                 | Narrow to `pr-NNN` only, then re-sample                           |
| Event with `pr-NNN` subject only (fresh seed)    | **2 durable of 15**, both clause 3: `01M2135N2GWQJSRTDJ4VEH759M` (`recordPhaseOutcome` uses mtime or content) and `01M21KFMMZ3BFAR5Y9QGMYETS5` (resume sends typed text).                                                                                                                                   | **Dropped**. Only 32 rows, and it cannot be made safe by subject. |
| Event whose content mentions `TASK_20` or `PR #` | **1 durable** (`01KWS71R2W22S7622E9RQ33F9S`: `session:list` gains a server-side `since` filter) and 2 borderline incidents (`01KW2813RFMEBJ97KDDE32DTY2`, `01M05QQS8G3KVBHTE6250PAV8D`: concurrent agents switching or stashing a shared checkout).                                                         | **Dropped**                                                       |
| Commitlint fact that mentions scope              | 15 of 15 sediment: stale scope lists, and "X is not a valid scope" rows now contradicted by `.commitlintrc.json`.                                                                                                                                                                                           | **Keep as R4**                                                    |

The r0 branches `subject LIKE '%/%'` and the date suffix were dropped with R2. They reached the
first counterexample, and no guard makes a free-form subject shape safe.

### 4.4 Revision r2: R1 still caught durable rows, so R1 is dropped

The r1 recheck (`implementation-plan-review.md`, finding 1 of the r1 round) found four more rows
that match r1's R1 and are durable. I re-read them on the copy (`r2eval.mjs`).

| id                         | subject / type            | Where the durable content is                                                                                                                            | Verdict                            |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 01M19SPXP18AFNSEWZ97GJRR5V | task-2026-306 / change    | `content`: `TaskIndexService.rebuild` skips writes when `isReady()` is false; "this guard pattern prevents state corruption during connection failures" | **durable** (behaviour and reason) |
| 01M215720HVHDSD2PPD5BRVDEV | task-2026-394 / discovery | `content`: "keytar is guarded with .catch(() => null) and documented as optional — must stay undeclared"                                                | **durable** (a constraint)         |
| 01M215720Z7652DGW8MQYGNXQY | task-2026-395 / discovery | `content`: "HARD CONSTRAINT: app must refuse to serve partially-applied schema (prevents silent data corruption)"                                       | **durable** (a constraint)         |
| 01KX27X86M0BWY264NHQS0QEHT | task_2026_154 / feature   | `content` and `completed`: `switchGeneration` and recency guards against A→B→A races; a per-file Monaco model cache keeps undo, scroll and cursor       | **durable** (behaviour)            |

In all four, `learned` is NULL. An empty `learned` field is therefore not evidence that a row has no
durable content. The review also counted 205 R1 matches with a non-empty `investigated`,
`completed` or `next_steps`.

I evaluated the reviewer's narrowing options against the r1 R1 base (task subject, event, type not
bugfix/decision/refactor) on the copy:

| Variant                                                                                             | Rows (guarded) | Of the four, caught | Full read                                                                                                             |
| --------------------------------------------------------------------------------------------------- | -------------: | ------------------: | --------------------------------------------------------------------------------------------------------------------- |
| r1 R1 (`learned` empty plus LESSON words)                                                           |            256 |                   4 | n/a                                                                                                                   |
| `learned` empty plus 20 causal/constraint words in `content`*                                       |            212 |                   0 | not pursued (larger than the next variant)                                                                            |
| All of `learned`, `investigated`, `completed`, `next_steps` empty                                   |             51 |                   0 | not pursued                                                                                                           |
| All of `request`, `learned`, `investigated`, `completed`, `next_steps` empty **plus** the 20 words* |         **43** |                   0 | **every one of the 43 rows was read** (seed `TASK_2026_563_2939:r2-holdout`, `r2final.mjs`, `holdout-r2-R1-ids.json`) |

\* The 20 words and phrases are: root cause, root problem, lesson, learned, prevent, must,
constraint, never, race, corrupt, because, guard, invariant, requires, should, always, avoid,
instead, so that, why.

The full read of the narrowest variant, with all structured fields empty, still finds durable rows:

- `01M21ASKKYY4NBCJF96TD6PE25` (task-2026-398-backlog): "Codex … can [resume], via
  `codex.resumeThread`". The stale warning that says otherwise is false. This is a product fact.
- `01M1C076NWJM4SQ80BV6V586YM` (task-2026-273): "ptah-cli WASM verification exists and is tested at
  pack time. Missing: electron WASM verification for asar packaging." This is a known gap.
- `01M1WTG1G0C9QV8E0VX1TWH401` (task-2026-387): a codebase-wide observation that catch blocks return
  safe defaults. This is a code fact.
- Borderline: `01M1C076NK…` (task-278: `ptah harness doctor [--fix]` exists) and `01M17F3905…`
  (task-359: templates ship stack-agnostic).

**Decision: R1 is dropped.** No subject, type, empty-field or keyword guard produced a task-subject
event set with zero known durable rows. The remaining candidate would be a hand-picked id list, which
is not a rule and would not generalise to other users' databases. Event and task sediment is
handled at the source by M4 and is not cleaned retroactively. This is a lower yield, and the review
accepted a lower yield in exchange for no durable loss.

### 4.5 Revision r2: a fresh R4 holdout of 30, read across every field

Draw: seed `TASK_2026_563_2939:r2-holdout-R4`, excluding every id sampled in r0 or r1, from a pool
of 52 (`r2r4.mjs`, `holdout-r2-R4-ids.json`). Every row was read in `content`, `request`,
`investigated`, `learned`, `completed` and `next_steps`.

The result is **30 of 30 sediment**, all class 3:

- stale scope lists ("allowed scopes: webview … cli")
- "X is not a valid scope" rows (`chat`, `memory`, `platform-electron`, `plugins`, `agent-sdk`,
  `skill-synthesis`, `tui`), which `.commitlintrc.json` now contradicts in most cases
- subject-length and subject-case restatements

The structured fields repeat the same hook rejections ("first commit attempt with scope 'chat'
failed"). The closest to a lesson is `01M1VHTZG61Y2WFG6SC59TSVH5` ("always verify against commitlint
config"). That is itself a pointer to the config, so it is class 3.

Together with the earlier R4 checks, that is:

- 11 section-3 rows
- 12 r0 holdout rows
- 15 r1 holdout rows
- 30 r2 holdout rows
- the 4 rows the reviewer inspected

This gives **72 R4 rows read, 0 durable**, and 1 mixed row (01KW9R8WEE…). The mixed row is a
`preference`, so r1's `kind = 'fact'` already excludes it.

## 5. Common guard, applied to every rule

`pinned = 0 AND tier <> 'core' AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = memories.id) AND quarantined_at IS NULL`

- Pinned and core rows express explicit intent. The lifecycle protects them the same way
  (`memory-lifecycle.store.ts:13,18,28`).
- Corpus-linked rows are protected as the lifecycle does (`:14,19,29`), because corpus membership
  is curation.
- `quarantined_at IS NULL` makes re-application a no-op (M5 criterion 7).

## 6. Rules (revision r2: final, applied by migration `0049`)

Revision r2 keeps **one rule**. R1 was dropped in r2 (§4.4). R2 and R3 were dropped in r1 (§4.3).

### R4 `rule:commitlint-scope-facts`

- **Predicate** (together with the common guard of section 5):
  `kind = 'fact' AND TRIM(LOWER(subject)) LIKE '%commitlint%' AND LOWER(content) LIKE '%scope%'`
- **Rows:** 125 before the guard, **89** after the guard, 0 with a NULL workspace on this copy.
- **Chunks:** the 89 memories own **89** `memory_chunks` rows (measured).
- **Known durable, mixed or borderline rows caught: 0.** The rows checked:
  - 72 R4 rows read across all fields (§4.5)
  - every durable id listed in sections 3, 4.1, 4.3 and 4.4
  - the durable `01M1XMRK9PFTXVVB4G7JMSR0MC` and the mixed `01KW9R8WEE5KBG2Y1N7F3TK9TC`. Both are
    `preference` rows, so the kind filter excludes them.
- **Accepted policy for commitlint workflow lessons.**
  - A commitlint _fact_ that mentions scopes restates `.commitlintrc.json` (class 3) and has gone
    stale. Every one of the 72 rows read contradicts the current file or repeats it.
  - Workflow lessons stored as `preference`, and commitlint facts that do not mention scope, are
    never caught.
  - A workflow lesson stored as a `fact` that mentions scope would be quarantined. That is accepted,
    because the rule it depends on lives in the config file. The row stays restorable by id or by
    rule. This trade-off is disclosed for Gate 2.
- **Canonical row:** none by rule. The repository file is canonical. The 48 corpus-linked commitlint
  rows stay active because of the guard.
- **M3 interaction:** the M3 measurement runs before 0049. New commitlint copies are stopped by the
  M4 prompt (class 3).

### Totals (r2)

| Rule                      |                     Rows |                              Chunks |
| ------------------------- | -----------------------: | ----------------------------------: |
| R4 commitlint-scope-facts |                       89 |                                  89 |
| **Total quarantined**     | **89 of 26,706 (0.33%)** | **89 of 29,447 chunk rows (0.30%)** |

- There is one rule, so the union, the standalone count and the first-match count are all 89.
- Earlier drafts reported 345 rows, which was r1's 256 + 89. That count was correct for r1's two
  rules, which do not overlap because they select different kinds. The review measured 394 chunk
  rows for those 345 memories.
- The "377" printed by `rules-r1-final.mjs` came from a candidate run that still included the
  dropped `pr-NNN` rule (32 rows). It was never a union or first-match figure for the rules as
  written.
- The forensics estimate was about 55% sediment in 36,252 rows. The yield here is far lower on
  purpose. Rows with rule-level certainty are quarantined, and M4 stops new sediment at the source.

**Tester check:** after 0049, the only `quarantine_reason` is `rule:commitlint-scope-facts`, with a
count of 89.

### Fixtures for `0049_memory_sediment_quarantine.spec.ts` (durable, guard and positive)

- The **durable** and **guard** fixtures must stay `quarantined_at IS NULL` after 0049.
- The **positive** fixtures must be quarantined, with reason `rule:commitlint-scope-facts`.
- Each fixture mirrors a real row.

| Kind of fixture | Fixture                                                                                                                                                           | Mirrors                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| positive        | Commitlint fact that mentions scope, in a named workspace                                                                                                         | a section 3.4 R4 row                     |
| **positive**    | **Commitlint fact that mentions scope, NULL workspace.** Proves that 0049 is not workspace-scoped and that restore works under the NULL scope (plan component 8). | a class 3 row with `workspace_root` NULL |
| durable         | Event/bugfix `/clear-command-regression` with `learned` set                                                                                                       | 01KWHNZ35HE87Y9BN1QJ4RY5FM               |
| durable         | Event/bugfix `vscode-e2e`, content with `PR #364`                                                                                                                 | 01KXDT44N5NS5JFVFNTCJC77KY               |
| durable         | Event/bugfix `chat-view-empty-state`, content with `TASK_2026_155`                                                                                                | 01KXKCB1ND5JQDE6W8P5F4P199               |
| durable         | Event/change `task-2026-306`, all structured fields NULL except `next_steps`, content "guard … prevents state corruption"                                         | 01M19SPXP18AFNSEWZ97GJRR5V               |
| durable         | Event/discovery `task-2026-394`, content "must stay undeclared"                                                                                                   | 01M215720HVHDSD2PPD5BRVDEV               |
| durable         | Event/discovery `task-2026-395`, content "HARD CONSTRAINT … prevents silent data corruption"                                                                      | 01M215720Z7652DGW8MQYGNXQY               |
| durable         | Event/feature `task_2026_154`, `completed` describing race guards                                                                                                 | 01KX27X86M0BWY264NHQS0QEHT               |
| durable         | Event/discovery `task-2026-398-backlog`, all structured fields empty, "Codex can resume via codex.resumeThread"                                                   | 01M21ASKKYY4NBCJF96TD6PE25               |
| durable         | Event/change `pr-468-write-signal`, behaviour content                                                                                                             | 01M2135N2GWQJSRTDJ4VEH759M               |
| durable         | Fact `task-2026-180-architecture`                                                                                                                                 | 01KX7BY1GSABG7D0W6H09BE73K               |
| durable         | Preference `commitlint-multi-scope-batching` (no corpus link)                                                                                                     | 01M1XMRK9PFTXVVB4G7JMSR0MC               |
| durable         | Preference `commitlint-constraints` (mixed)                                                                                                                       | 01KW9R8WEE5KBG2Y1N7F3TK9TC               |
| durable         | Fact `commitlint-subject-case`, content without the word "scope"                                                                                                  | kind and content distinction             |
| guard           | Corpus-linked commitlint scope fact                                                                                                                               | corpus guard                             |
| guard           | Pinned commitlint scope fact                                                                                                                                      | pinned guard                             |
| guard           | Core-tier commitlint scope fact                                                                                                                                   | core guard                               |

The event fixtures stay in the spec even though no r2 rule targets events. They pin the fact that
0049 never touches events, so a future rule edit cannot silently bring the r0 or r1 losses back.

## 7. Rules considered and rejected (r0, r1 and r2)

| Candidate                                                                | Evidence                                                 | Decision                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------- |
| `kind = 'event'` as a blanket rule                                       | 6 of 30 sampled events are durable                       | Rejected (r0)                    |
| Task subject of any kind                                                 | 4 of 20 durable, all facts                               | Narrowed (r0), then dropped (r2) |
| Worktree keyword or workspace                                            | 14 of 20 durable                                         | Rejected (r0)                    |
| `subject LIKE '%/%'`, a date-suffixed subject, `*batch-N`                | Counterexample `01KWHNZ3…`; `batch-2-wiring` durable     | Rejected (r1)                    |
| `pr-NNN` subject                                                         | 2 of 15 durable                                          | Rejected (r1)                    |
| Content mentions `TASK_20` or `PR #`                                     | 3 reviewer and holdout durable rows                      | Rejected (r1)                    |
| Task-subject event with r1's `EV` guard (`learned` empty)                | 4 durable (reviewer, r1 recheck)                         | Rejected (r2)                    |
| Task-subject event with all structured fields empty plus 20 causal words | 3 durable and 2 borderline in a full read of all 43 rows | Rejected (r2). R1 dropped.       |
| Any commitlint subject (r0 R4)                                           | Catches preferences and non-scope facts                  | Narrowed to R4 (r1)              |

## 8. Track A cross-check

Of the 20 rows judged in `../TASK_2026_473_c9f4/track-a-retrieval-measurement.md` §3, **12 no
longer exist on the copy**, because the 443 lifecycle deleted them after 2026-09-19. **None of the
8 survivors is caught by R4**, since none has a commitlint subject.

The main re-measurement will differ from 16/20 because of those lifecycle deletions. Both gates of
measurement criterion 1 apply:

- the branch is at least the main value re-measured on the copy
- the branch is at least 16/20

## 9. Handoff to the tester

- Use the copy in section 1. Verify its SHA-256 first, and never modify it.
- Re-run these scripts to reproduce every row set above:
  - `sample.mjs` and `holdout.mjs` (r0)
  - `rules-r1.mjs` and `rules-r1-final.mjs` (r1)
  - `r2eval.mjs`, `r2final.mjs` and `r2r4.mjs` (r2)
- Apply the rules only through migration `0049`, run by the real `SqliteMigrationRunner` on a
  backup-API working copy.
- The per-reason count must equal section 6: `rule:commitlint-scope-facts` = 89, and no other
  reason may appear.
- Every fixture in section 6 must behave as listed.
