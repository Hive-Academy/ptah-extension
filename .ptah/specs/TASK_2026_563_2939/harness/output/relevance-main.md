# Relevance "main" baseline — TASK_2026_563_2939 (Phase 1)

Measurement table row **Relevance**, first bullet only ("main"). The "branch" run and the
restore-all equivalence are Phase 2 and were NOT run.

## Method

- **Code:** BASE COMMIT `ebfc73321`, from a throwaway detached worktree at
  `%TEMP%\mqs-563-base`. `harness/copy-audit.ts` was bundled with that worktree's
  `tsconfig.base.json`, so every `@ptah-extension/*` alias resolved to base sources. The esbuild
  metafile lists 0 inputs from the branch worktree's `libs/`. The bundle asserts
  `max(MIGRATIONS.version) = 47`.
- **Entry point:** `MemorySearchService.searchRich(query, 5, 'D:\projects\ptah-extension')`.
  `searchRich` exists on base with this signature (`memory-search.service.ts:264-273` at base).
  - `VecStatus.available = false`
  - a plain `IEmbedder` stub that throws if called (it was never called)
  - no `EmbedderWorkerClient`, so no rerank
  - BM25 through `fts-query.util` (`buildFtsQueryPlan` / `executeFtsQueryPlan`)
- **Copy:** a fresh, UNMIGRATED working copy `relmain-unmigrated.sqlite`:
  - `schema_migrations` max 47
  - no `quarantined_at` column
  - 25,683 rows in the workspace
- **Rubric:** Track A (`track-a-retrieval-measurement.md` §3), with a reason for every row. Where the
  same row was judged in Track A, the Track A verdict is reused, and the table says so.
- **Scores:** base `searchRich` returns RRF scores, not raw BM25. `bm25Rank` equals the rank in
  every row, because there is no vector list.
- **Archived rows:** some hits have `archived_at` set. Base BM25 does not filter archived rows, and
  that is the base behaviour being measured.

MATCH expressions recorded from the bound statement parameters. Base `bm25Search` asks for
`limit * 4 = 20` rows, so the fallback runs whenever the primary returns fewer than 20.

| Query                                                | Primary MATCH (rows)                                       | Fallback MATCH (rows)                                    | Where the top 5 came from          |
| ---------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| Q1 what did we decide about the judge threshold      | `"decide" AND "judge" AND "threshold"*` (0)                | `"decide" OR "judge" OR "threshold"*` (20)               | fallback                           |
| Q2 how do we name DI tokens                          | `"name" AND "di" AND "tokens"*` (13)                       | `"name" OR "di" OR "tokens"*` (20)                       | primary                            |
| Q3 why did the release branch drift                  | `"release" AND "branch" AND "drift"*` (6)                  | `"release" OR "branch" OR "drift"*` (20)                 | primary                            |
| Q4 what is the user's preference for commit messages | `"user" AND "preference" AND "commit" AND "messages"*` (1) | `"user" OR "preference" OR "commit" OR "messages"*` (20) | rank 1 primary, ranks 2-5 fallback |

The MATCH expressions are identical to Track A §2.

## Q1: what did we decide about the judge threshold — 3 / 5

| Rank | Memory id                    | Subject                      | Kind              | Relevant | Reason                                                                                                                                                                                                                                           |
| ---: | ---------------------------- | ---------------------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|    1 | `01M03AJC59MFRGJAMGFHFQF9NW` | `task-2026-245`              | entity (archived) | No       | Same row and verdict as Track A: a task title that asks for a future decision. It does not record the decision.                                                                                                                                  |
|    2 | `01KXBGZR5N04QE99N6W269GAWA` | `skill-synthesis`            | fact (archived)   | Yes      | Same row and verdict as Track A: the rationale for rejecting aggressive judge-threshold gating.                                                                                                                                                  |
|    3 | `01KTMN28N2BD5CTF1PC2X09GEK` | `p3-batch-1-committed`       | fact              | Yes      | Same row and verdict as Track A: the implemented judge gate with a 5-invocation minimum threshold.                                                                                                                                               |
|    4 | `01M2ZPG0603WEV68X1CVGSHWSM` | `memory-retrieval-benchmark` | fact              | No       | Describes the Track A benchmark itself, a meta row that lists the query topics. It records no judge-threshold decision.                                                                                                                          |
|    5 | `01M2Q4ZHRF0FMZMY86E4P7AMM6` | `thoth-phase3-scope`         | fact              | Yes      | Records the decision that manual promotion skips only the frequency threshold while keeping the judge, dedup and replay gates. This is the same kind of threshold-and-judge-gate decision that Track A scored Yes (`skill-promotion-threshold`). |

## Q2: how do we name DI tokens — 2 / 5

| Rank | Memory id                    | Subject                                     | Kind            | Relevant | Reason                                                                                                                                                            |
| ---: | ---------------------------- | ------------------------------------------- | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | `01KXCACXX4FXK8TH0RFFS61HC3` | `knowledge-agent-token`                     | fact (archived) | Yes      | Same row and verdict as Track A: the canonical `Symbol.for` name and the dual-literal naming rule.                                                                |
|    2 | `01KWCEMKYZ0GM195MM9QG6V15N` | `skill-synthesizer-service`                 | entity          | No       | Same row and verdict as Track A: it mentions one token incidentally and gives no naming rule.                                                                     |
|    3 | `01KWMDVPW4QKSQE97JWKCHH70V` | `ddi-symbol-mirror-pattern`                 | fact (archived) | Yes      | Same row and verdict as Track A: the cross-library `Symbol.for('name')` mirror convention and why it exists.                                                      |
|    4 | `01M15Z86XBASYMTT45TJPE5SS6` | `plugin-browser-modal-component-line-count` | fact            | No       | A file line-count note. "DI token" appears only in a refactor rule about keeping names unchanged.                                                                 |
|    5 | `01M1XHJR23JE8Z1A7DMZ2DMZ8N` | `sonarqube-facade-rule`                     | fact            | No       | A refactor rule: keep the class name, DI token and signatures unchanged. It says to preserve a token, not how to name one. Track A scored incidental mentions No. |

## Q3: why did the release branch drift — 4 / 5

| Rank | Memory id                    | Subject                      | Kind            | Relevant | Reason                                                                                                                                                                 |
| ---: | ---------------------------- | ---------------------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | `01M1JHQ2ZX974E7W48EMNT6HJG` | `release-branch-policy`      | fact            | Yes      | Same row and verdict as Track A: the drift mechanism and the policy that prevents it.                                                                                  |
|    2 | `01M1CW1PEZ96929CWN94GER54D` | `ptah-release-branches`      | fact            | Yes      | Same row and verdict as Track A: the causal chain (husky, reformatting, hand-resolved conflicts).                                                                      |
|    3 | `01KXGQVEPVD5SS7T6EMDW0DYP0` | `release/electron`           | fact (archived) | Yes      | Same row and verdict as Track A: direct commits and hand-resolved merges as the sources of divergence.                                                                 |
|    4 | `01M2ZPG0603WEV68X1CVGSHWSM` | `memory-retrieval-benchmark` | fact            | No       | The meta benchmark row again. It gives no cause of drift.                                                                                                              |
|    5 | `01KXE1JS34PDS6C4QZXKCPEM2X` | `release/electron`           | fact (archived) | Yes      | Explains why branch protection does not stop drift: direct electron-only commits diverge whenever main later touches the same files. This is a direct answer to "why". |

## Q4: what is the user's preference for commit messages — 0 / 5

| Rank | Memory id                    | Subject                               | Kind                  | Relevant        | Reason                                                                                                                                                                                                                                                                                                   |
| ---: | ---------------------------- | ------------------------------------- | --------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | `01KWMMAJ7GCCSZNY421W5BCR3Q` | `ptah-concurrent-agent-branch-switch` | event (archived)      | No              | A commit landed on the wrong branch during concurrent work. It says nothing about commit messages.                                                                                                                                                                                                       |
|    2 | `01KWC0GS4SSG9W38K620WEK5S2` | `concurrent-agents-same-checkout`     | preference (archived) | No              | A preference for in-place commits over worktrees, which is branch and workflow, not message content.                                                                                                                                                                                                     |
|    3 | `01M28W9Y2MHQ4Q52KBCQT9MEG1` | `sdk-user-message-filtering`          | fact                  | No              | SDK user-message filtering. It matched on "user" and "messages" only.                                                                                                                                                                                                                                    |
|    4 | `01M1SYWXWBN13KQ899DA8MDWNK` | `chat-refactoring`                    | preference            | No (borderline) | Commit only after tests pass, as a single `refactor(chat)` commit. This is a timing and batching preference for one area. Its only message aspect is a conventional type and scope. Track A scored `abdallah-git-workflow` No for an incidental message reference, so this is scored No for consistency. |
|    5 | `01KTBKV3YK8YNSXPB4W6T96BYQ` | `orchestration-workflow`              | preference            | No              | An orchestration-workflow preference. It has nothing about commit messages.                                                                                                                                                                                                                              |

None of the five Q4 rows Track A printed on 2026-09-19 exists on this copy (see "Track A overlap"),
and neither do the three it judged relevant. The primary AND expression now matches only 1 row, and
the OR fallback fills the page with unrelated "user"/"preference" rows.

## Total

| Query     | main (this run) | Track A 2026-09-19 |
| --------- | --------------: | -----------------: |
| Q1        |           3 / 5 |              4 / 5 |
| Q2        |           2 / 5 |              4 / 5 |
| Q3        |           4 / 5 |              5 / 5 |
| Q4        |           0 / 5 |              3 / 5 |
| **Total** |      **9 / 20** |        **16 / 20** |

## Track A overlap

The 20 ids Track A printed were checked read-only on the same unmigrated copy
(`%TEMP%\mqs-563-eval\tracka-ids-check.cjs`, a `readonly` + `fileMustExist` handle).

- **10 of the 20 still exist.** `quarantine-rules.md` §8 says 8 survive. This measurement finds 10:

  | Query | Surviving Track A ids                                                                                                               | Missing Track A ids      |
  | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
  | Q1    | `01M2G2YB…` (workspace `…\.claude-worktrees\skill-corpus-tasks`, so it is out of this scope), `01M03AJC…`, `01KXBGZR…`, `01KTMN28…` | `01KTM4M5…`              |
  | Q2    | `01KXCACX…`, `01KWCEMK…`, `01KWMDVP…`                                                                                               | `01KVTQ0J…`, `01KTRKXN…` |
  | Q3    | `01M1JHQ2…`, `01M1CW1P…`, `01KXGQVE…`                                                                                               | `01KTH10J…`, `01KTBMTD…` |
  | Q4    | none                                                                                                                                | all five                 |

- **Track A judged 16 rows relevant.** Of those, 7 exist on this copy inside the
  `D:\projects\ptah-extension` scope: 2 for Q1, 2 for Q2, 3 for Q3 and 0 for Q4.
- **All 7 surfaced in this run's top 5**, and each keeps its Track A verdict. Together with the 2
  non-relevant Track A rows that also surfaced (Q1 `01M03AJC…` and Q2 `01KWCEMK…`), 9 of the 20 hits
  are Track A rows.
- **The two other relevant hits are new:**
  - Q1 `thoth-phase3-scope`
  - Q3 `release/electron` `01KXE1JS…`

  So 9/20 = 7 surviving Track A relevant rows + 2 new relevant rows.

- **The drop from 16 to 9 comes from the corpus, not from ranking:**
  - 9 of Track A's 16 relevant rows are unreachable: 8 are gone, and 1 is outside the scope.
  - Q4's primary expression now matches only one row, and the OR fallback fills the page with
    unrelated rows.
- **Gates for the branch run (Phase 2).** It must reach at least this re-measured 9/20 **and** at
  least 16/20. Both gates are in the plan's measurement table, and both numbers are recorded. This
  baseline does not settle whether the second gate can be met on this copy.
