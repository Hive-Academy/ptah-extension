# Relevance "branch" and restore-all equivalence — TASK_2026_563_2939 (Phase 2)

Measurement table row **Relevance**, bullets 2 ("branch": copy A with 49 applied) and 3 (restore-all
on copy A, then re-run; the ids must equal "main"). Raw output:
`output/relevance-branch.raw.json`. Script: `harness/branch-audit.ts relevance-branch`.

## Method

- **Code:** the BRANCH, HEAD `12252d5df` (Batches 1-6 committed), bundled from this worktree's
  `tsconfig.base.json`. The bundle asserts `max(MIGRATIONS.version) = 49`.
- **Copy A:** a fresh backup-API working copy, `%TEMP%\mqs-563-eval\relbranch-copyA49.sqlite`
  (started 2026-09-26T18:31:05.510Z, backup 2,607 ms, `integrity_check` `ok` in 2,476 ms,
  477,536,256 bytes). It was migrated with the production
  `SqliteMigrationRunner.applyAll(MIGRATIONS, { vecExtensionLoaded: true })`, which applied
  `[48, 49]` in 56 ms. `finalVersion` is 49.
- **After 0049:** 89 rows quarantined, all `rule:commitlint-scope-facts`, all in
  `D:\projects\ptah-extension`. The workspace has 25,683 rows, of which 25,594 are active.
- **Entry point:** the branch `MemorySearchService.searchRich(query, 5, 'D:\projects\ptah-extension')`.
  This is the same signature as base; `workspaceRoot` is now tri-state, and a non-empty string
  still scopes to `m.workspace_root IS ?`.
  - `VecStatus.available = false`
  - a plain `IEmbedder` stub that throws if called (it was never called), so there is no vector
    path and no rerank
  - BM25 through `fts-query.util`
  - These are exactly the relevance-main parameters.
- **Quarantine filter:** the branch applies `m.quarantined_at IS NULL` inside the BM25 SQL, before
  `LIMIT` (`memory-search.service.ts:446-458`).
- **Rubric:** Track A (`track-a-retrieval-measurement.md` §3), a reason on every row. **Every one of
  the 20 branch hits is a row Phase 1 already judged** in `relevance-main.md`, at the same rank, so
  every verdict below is reused from there. No row was judged fresh.

MATCH expressions recorded from the bound statement parameters. They are identical to main, and
so are the row counts:

| Query | Primary MATCH (rows)                                       | Fallback MATCH (rows)                                    |
| ----- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Q1    | `"decide" AND "judge" AND "threshold"*` (0)                | `"decide" OR "judge" OR "threshold"*` (20)               |
| Q2    | `"name" AND "di" AND "tokens"*` (13)                       | `"name" OR "di" OR "tokens"*` (20)                       |
| Q3    | `"release" AND "branch" AND "drift"*` (6)                  | `"release" OR "branch" OR "drift"*` (20)                 |
| Q4    | `"user" AND "preference" AND "commit" AND "messages"*` (1) | `"user" OR "preference" OR "commit" OR "messages"*` (20) |

## Results (branch, copy A, 49 applied)

The top 5 is **identical, id for id and in order, to "main"** for all four queries.

| Query | Rank | Memory id                    | Subject                                     | Relevant        | Reason (reused from relevance-main.md)                                                             |
| ----- | ---: | ---------------------------- | ------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| Q1    |    1 | `01M03AJC59MFRGJAMGFHFQF9NW` | `task-2026-245`                             | No              | A task title that asks for a future decision. It does not record the decision.                     |
| Q1    |    2 | `01KXBGZR5N04QE99N6W269GAWA` | `skill-synthesis`                           | Yes             | The rationale for rejecting aggressive judge-threshold gating.                                     |
| Q1    |    3 | `01KTMN28N2BD5CTF1PC2X09GEK` | `p3-batch-1-committed`                      | Yes             | The implemented judge gate with a 5-invocation minimum threshold.                                  |
| Q1    |    4 | `01M2ZPG0603WEV68X1CVGSHWSM` | `memory-retrieval-benchmark`                | No              | A meta row describing the Track A benchmark. It records no decision.                               |
| Q1    |    5 | `01M2Q4ZHRF0FMZMY86E4P7AMM6` | `thoth-phase3-scope`                        | Yes             | Manual promotion skips only the frequency threshold and keeps the judge, dedup and replay gates.   |
| Q2    |    1 | `01KXCACXX4FXK8TH0RFFS61HC3` | `knowledge-agent-token`                     | Yes             | The canonical `Symbol.for` name and the dual-literal naming rule.                                  |
| Q2    |    2 | `01KWCEMKYZ0GM195MM9QG6V15N` | `skill-synthesizer-service`                 | No              | It mentions one token incidentally and gives no naming rule.                                       |
| Q2    |    3 | `01KWMDVPW4QKSQE97JWKCHH70V` | `ddi-symbol-mirror-pattern`                 | Yes             | The cross-library `Symbol.for('name')` mirror convention and why it exists.                        |
| Q2    |    4 | `01M15Z86XBASYMTT45TJPE5SS6` | `plugin-browser-modal-component-line-count` | No              | A line-count note. "DI token" appears only in a keep-names-unchanged rule.                         |
| Q2    |    5 | `01M1XHJR23JE8Z1A7DMZ2DMZ8N` | `sonarqube-facade-rule`                     | No              | It says to preserve a token, not how to name one.                                                  |
| Q3    |    1 | `01M1JHQ2ZX974E7W48EMNT6HJG` | `release-branch-policy`                     | Yes             | The drift mechanism and the policy that prevents it.                                               |
| Q3    |    2 | `01M1CW1PEZ96929CWN94GER54D` | `ptah-release-branches`                     | Yes             | The causal chain (husky, reformatting, hand-resolved conflicts).                                   |
| Q3    |    3 | `01KXGQVEPVD5SS7T6EMDW0DYP0` | `release/electron`                          | Yes             | Direct commits and hand-resolved merges as the sources of divergence.                              |
| Q3    |    4 | `01M2ZPG0603WEV68X1CVGSHWSM` | `memory-retrieval-benchmark`                | No              | The meta benchmark row. It gives no cause of drift.                                                |
| Q3    |    5 | `01KXE1JS34PDS6C4QZXKCPEM2X` | `release/electron`                          | Yes             | Why branch protection does not stop drift: direct electron-only commits diverge.                   |
| Q4    |    1 | `01KWMMAJ7GCCSZNY421W5BCR3Q` | `ptah-concurrent-agent-branch-switch`       | No              | A commit landed on the wrong branch. Nothing about commit messages.                                |
| Q4    |    2 | `01KWC0GS4SSG9W38K620WEK5S2` | `concurrent-agents-same-checkout`           | No              | In-place commits over worktrees: workflow, not message content.                                    |
| Q4    |    3 | `01M28W9Y2MHQ4Q52KBCQT9MEG1` | `sdk-user-message-filtering`                | No              | SDK user-message filtering; matched on "user" and "messages" only.                                 |
| Q4    |    4 | `01M1SYWXWBN13KQ899DA8MDWNK` | `chat-refactoring`                          | No (borderline) | A timing and batching preference for one area; scored No as in main, for consistency with Track A. |
| Q4    |    5 | `01KTBKV3YK8YNSXPB4W6T96BYQ` | `orchestration-workflow`                    | No              | An orchestration-workflow preference; nothing about commit messages.                               |

| Query     |     branch | main (re-measured, Phase 1) | Track A 2026-09-19 |
| --------- | ---------: | --------------------------: | -----------------: |
| Q1        |      3 / 5 |                       3 / 5 |              4 / 5 |
| Q2        |      2 / 5 |                       2 / 5 |              4 / 5 |
| Q3        |      4 / 5 |                       4 / 5 |              5 / 5 |
| Q4        |      0 / 5 |                       0 / 5 |              3 / 5 |
| **Total** | **9 / 20** |                  **9 / 20** |        **16 / 20** |

## Gates (both stated; the rubric was not adjusted)

| Gate                                                  | Requirement | Branch | Result           |
| ----------------------------------------------------- | ----------- | -----: | ---------------- |
| **A** (plan: "branch ≥ main re-measured on the copy") | ≥ 9 / 20    | 9 / 20 | **PASS** (equal) |
| **B** (task-description §4 criterion 1, literal)      | ≥ 16 / 20   | 9 / 20 | **FAIL**         |

### Why gate B cannot be met on this corpus (existence counts on copy A)

Existence was checked on copy A with 49 applied, before the restore:

- **10 of Track A's 20 printed rows exist on copy A.** None of the 10 is quarantined. The other 10
  are absent from the snapshot itself: they are missing on the unmigrated copy too
  (`relevance-main.md`). `quarantine-rules.md` §8 attributes the loss to the 443 lifecycle; this
  harness did not re-derive that cause.
- **Track A judged 16 rows relevant.**
  - 8 of them exist on the copy.
  - **7 exist inside the `D:\projects\ptah-extension` scope** (Q1 2, Q2 2, Q3 3, Q4 0).
  - The eighth, Q1 `01M2G2YBXS5B29DB0HRQJP09S9` `skill-promotion-threshold`, is in
    `…\.claude-worktrees\skill-corpus-tasks`, so it is out of scope.
- **All 7 reachable relevant rows are in the branch top 5.** The other 2 relevant branch hits are
  the rows Phase 1 judged new (`thoth-phase3-scope`, `release/electron` `01KXE1JS…`). So the branch
  reaches **every** Track-A-relevant row this corpus still holds in scope.
- **The ceiling for "Track A rows" is 7, and 16 would need 9 more relevant rows.** To reach 16/20,
  7 of the 11 non-relevant slots would have to be filled by relevant rows that no query path
  surfaces today. That would need a ranking change, which is outside this task. Q4 alone is 0/5
  because none of its three Track A relevant rows exists any more.

## Quarantine filter on these four queries: did it remove anything?

For every recorded MATCH expression, the harness re-ran the branch BM25 SQL with the same scope
and `LIMIT 20` but **without** the `quarantined_at IS NULL` predicate (`unfilteredProbes` in the raw
file):

| Query | Expression  | Quarantined rows in unfiltered top 20 | Quarantined rows matching at any rank |
| ----- | ----------- | ------------------------------------: | ------------------------------------: |
| Q1    | primary AND |                                     0 |                                     0 |
| Q1    | fallback OR |                                     0 |                                     0 |
| Q2    | primary AND |                                     0 |                                     0 |
| Q2    | fallback OR |                                     0 |                                    14 |
| Q3    | primary AND |                                     0 |                                     0 |
| Q3    | fallback OR |                                     0 |                                    55 |
| Q4    | primary AND |                                     0 |                                     0 |
| Q4    | fallback OR |                                     0 |                                    49 |

- **No quarantined row is in any branch hit** (0 of 20).
- **No quarantined row would have been in any unfiltered top 20.**
- **The OR fallbacks do match quarantined rows**: 14, 55 and 49 distinct commitlint facts
  (matched on "name", "branch" and "commit" respectively). All of them rank below 20, so the filter
  changes nothing on these four queries.

That is the expected result for this query set: none of the four is about commitlint scopes. It is
recorded here as a measured fact, not assumed.

## Restore-all equivalence

On the same copy A:

1. `MemoryStore.restoreQuarantined({ all: true }, 'D:\projects\ptah-extension')` restored **89**.
2. `MemoryStore.restoreQuarantined({ all: true }, null)` restored **0**. All 89 were in the workspace.
3. After both, **0** rows had `quarantined_at` set.
4. Q1-Q4 were re-run through a fresh `MemorySearchService`, with the same parameters.

| Query | Restored ids = main ids (ordered, all 5) | MATCH expressions and row counts = main | Branch (pre-restore) ids = main |
| ----- | ---------------------------------------- | --------------------------------------- | ------------------------------- |
| Q1    | **PASS**                                 | yes                                     | yes                             |
| Q2    | **PASS**                                 | yes                                     | yes                             |
| Q3    | **PASS**                                 | yes                                     | yes                             |
| Q4    | **PASS**                                 | yes                                     | yes                             |

- **Restore gives identical ids: PASS, 4 of 4.**
- "main" is the Phase 1 base-commit run on the unmigrated copy (`relevance-main.raw.json`).
- No commitlint row entered any restored top 5. The restored rows only add candidates below rank 20
  in the OR fallbacks, as the table above shows.
