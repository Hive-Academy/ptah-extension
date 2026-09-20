# Track A Retrieval Measurement

## 1. Final rule

The primary expression still drops common English stopwords and joins the remaining content terms with `AND`. The final relaxation rule runs the existing stopword-free `OR` expression whenever the primary query returns fewer than the requested limit, then appends de-duplicated fallback rows after the primary rows until the page is full. Straight and curly apostrophes are also token separators, so `user's` and `user’s` become the indexed content term `user`; the one-character possessive suffix `s` is dropped by the existing single-character rule. The existing FTS5 metacharacter stripping, FTS5 keyword filtering, and last-term prefix `*` are unchanged.

I chose underfilled-page top-up because zero-only fallback leaves partially empty pages and misses available recall. Keeping the primary rows first preserves the precision benefit of `AND`; replacing the whole page with `OR` would discard those stronger matches. Apostrophe separation is required in addition to top-up: with the unsplit `"user's"` term, Q4's primary produced one previously judged poor row and its OR fallback was still dominated by unrelated uses of “user's preference.” Splitting the possessive produced five precise co-occurrence hits and brought Q4 to 3 / 5. Progressive term-by-term relaxation would add more queries and ordering choices without improving these measured acceptance queries.

## 2. MATCH expressions and paths

| Query                                                 | Primary MATCH                                          | Fallback MATCH                                      | Path that produced the printed results                |
| ----------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| Q1: what did we decide about the judge threshold      | `"decide" AND "judge" AND "threshold"*`                | `"decide" OR "judge" OR "threshold"*`               | Primary returned 0; fallback produced all five rows.  |
| Q2: how do we name DI tokens                          | `"name" AND "di" AND "tokens"*`                        | `"name" OR "di" OR "tokens"*`                       | Primary produced all five rows; fallback was not run. |
| Q3: why did the release branch drift                  | `"release" AND "branch" AND "drift"*`                  | `"release" OR "branch" OR "drift"*`                 | Primary produced all five rows; fallback was not run. |
| Q4: what is the user's preference for commit messages | `"user" AND "preference" AND "commit" AND "messages"*` | `"user" OR "preference" OR "commit" OR "messages"*` | Primary produced all five rows; fallback was not run. |

## 3. Results

### Q1: what did we decide about the judge threshold

| Rank | Memory id                    | Subject                     | Kind   | BM25 score | Snippet                                                                                                                           | Relevant | Reason                                                                                       |
| ---: | ---------------------------- | --------------------------- | ------ | ---------: | --------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
|    1 | `01M2G2YBXS5B29DB0HRQJP09S9` | `skill-promotion-threshold` | fact   |     -13.64 | “Skill promotion uses the configured successesToPromote threshold… Duplicate, judge, and replay gates run around this threshold.” | Yes      | Directly states the effective promotion-threshold decision and its judge-gate context.       |
|    2 | `01M03AJC59MFRGJAMGFHFQF9NW` | `task-2026-245`             | entity |     -13.59 | “Give the replay gate a production producer — decide whether a cluster draft meets evidence threshold…”                           | No       | A task title asks for a future decision; it does not record the judge-threshold decision.    |
|    3 | `01KXBGZR5N04QE99N6W269GAWA` | `skill-synthesis`           | fact   |     -10.98 | “Single-session judging… ACE warns that aggressive threshold-gating causes ‘context collapse’.”                                   | Yes      | Records the rationale for rejecting aggressive judge-threshold gating.                       |
|    4 | `01KTMN28N2BD5CTF1PC2X09GEK` | `p3-batch-1-committed`      | fact   |     -10.46 | “enhance() pipeline… judge gate… 5-invocation min threshold.”                                                                     | Yes      | Records the implemented judge-gated threshold for the enhancement path.                      |
|    5 | `01KTM4M5GY25FQWVYQTA16YRHE` | `p3-enhancer-architecture`  | fact   |     -10.46 | “Judge-gated… auto-enhancement triggered inside curator pass or invocation-threshold.”                                            | Yes      | Records the locked architecture decision connecting the judge gate and invocation threshold. |

**4 / 5 relevant**

### Q2: how do we name DI tokens

| Rank | Memory id                    | Subject                         | Kind   | BM25 score | Snippet                                                                                               | Relevant | Reason                                                                             |
| ---: | ---------------------------- | ------------------------------- | ------ | ---------: | ----------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
|    1 | `01KVTQ0JRK249ZWWSS4J50C919` | `workspace-intelligence-tokens` | fact   |     -11.67 | “DI token names… DEPENDENCY_GRAPH_SERVICE, AST_ANALYSIS_SERVICE, TREE_SITTER_PARSER_SERVICE…”         | Yes      | Gives concrete `UPPER_SNAKE` token-name examples.                                  |
|    2 | `01KXCACXX4FXK8TH0RFFS61HC3` | `knowledge-agent-token`         | fact   |     -11.36 | “canonical DI token… `Symbol.for('PtahKnowledgeAgentService')`… direct Symbol.for literal…”           | Yes      | Directly states the canonical symbol name and dual-literal naming rule.            |
|    3 | `01KTRKXNHCAQD68454ZW28F2QC` | `tsyringe-di-container-token`   | fact   |     -10.90 | “`'DependencyContainer'` magic string… Converting to an explicit PLATFORM_TOKENS.DI_CONTAINER token…” | Yes      | Contrasts the magic string with the repository's explicit token naming convention. |
|    4 | `01KWCEMKYZ0GM195MM9QG6V15N` | `skill-synthesizer-service`     | entity |     -10.17 | “New SkillSynthesizerService (injectable, DI token SKILL_SYNTHESIZER_SERVICE)…”                       | No       | Mentions one token incidentally but does not explain the naming rule.              |
|    5 | `01KWMDVPW4QKSQE97JWKCHH70V` | `ddi-symbol-mirror-pattern`     | fact   |     -10.01 | “Cross-lib DI token mirrors via Symbol.for('name')… tokens-uniqueness…”                               | Yes      | Explains the cross-library `Symbol.for` mirror convention and why it is used.      |

**4 / 5 relevant**

### Q3: why did the release branch drift

| Rank | Memory id                    | Subject                            | Kind  | BM25 score | Snippet                                                                                                              | Relevant | Reason                                                                                 |
| ---: | ---------------------------- | ---------------------------------- | ----- | ---------: | -------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
|    1 | `01M1JHQ2ZX974E7W48EMNT6HJG` | `release-branch-policy`            | fact  |     -14.23 | “Never merge into release branches… Prevents merge-commit drift and pre-commit hook side effects.”                   | Yes      | Directly explains the drift mechanism and the policy that prevents it.                 |
|    2 | `01M1CW1PEZ96929CWN94GER54D` | `ptah-release-branches`            | fact  |     -13.78 | “local merges trigger husky, format files nobody edited, and create conflicts that hand-resolve into drifted state.” | Yes      | Gives the concrete causal chain behind release-branch drift.                           |
|    3 | `01KTH10JAVY9S7FQBEDFSXFGJT` | `pr-284-merge-conflict-resolution` | event |     -12.82 | “package-lock.json conflict due to dependency drift between branches…”                                               | Yes      | Records a specific release-branch drift incident and its resolution.                   |
|    4 | `01KXGQVEPVD5SS7T6EMDW0DYP0` | `release/electron`                 | fact  |     -11.24 | “Two direct commits… which main never received. Every hand-resolved merge also becomes branch-local content…”        | Yes      | Precisely identifies direct commits and hand-resolved merges as sources of divergence. |
|    5 | `01KTBMTDZAB85BRHE0TY0EKXWW` | `release-branch-merge-pattern`     | fact  |     -10.61 | “regenerate the lockfile cleanly… rather than manual conflict resolution.”                                           | Yes      | Explains the manual-resolution failure mode and the corrective merge pattern.          |

**5 / 5 relevant**

### Q4: what is the user's preference for commit messages

| Rank | Memory id                    | Subject                                | Kind       | BM25 score | Snippet                                                                                                        | Relevant | Reason                                                                                                   |
| ---: | ---------------------------- | -------------------------------------- | ---------- | ---------: | -------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
|    1 | `01KTRN79C0KAXVJQ16AR08H54Y` | `multi-agent-checkout-coordination`    | preference |     -12.20 | “sweeping them into the wrong commit message is preferable to losing work.”                                    | Yes      | Directly records the user's commit-message tradeoff during concurrent work.                              |
|    2 | `01KVBCN6GG95S8G5ART67ZK4ZB` | `commit-batching`                      | preference |     -11.86 | “related fixes committed discretely… with clear commit messages, rather than batching unrelated WIP together.” | Yes      | Directly states the user's preference for clear, concern-specific commit messages.                       |
|    3 | `01KVBC8PFF81BWXJS4GSTGP0MP` | `concurrent-agent-conflict-resolution` | preference |     -11.71 | “explicit commit message noting the concurrency…”                                                              | Yes      | Directly specifies what the commit message should disclose in this failure mode.                         |
|    4 | `01KVTH8ETY5JH0E3N8D2X1PJAT` | `abdallah-git-workflow`                | preference |     -11.35 | “prefers to commit CI/build fixes directly to main… Write the message to .git/COMMIT_EDITMSG_PTAH.txt…”        | No       | The preference is branch workflow; the message reference is only a PowerShell workaround.                |
|    5 | `01KV60ZM1ZQNQJGDR4XCZJ0314` | `di-refactor-commit-message-accuracy`  | preference |     -11.08 | “minor message inaccuracy… Not amended per user's… preference for new commits over amends.”                    | No       | As in the forensic judgment, this is one typo/amend incident, not the general commit-message preference. |

**3 / 5 relevant**

## 4. Summary

**16 / 20 relevant**, compared with the **4.5 / 20** baseline in the forensics report. Every query reached at least 3 / 5.

## 5. Verification output tails

`npx nx test @ptah-extension/memory-curator --skip-nx-cache`

```text
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
Test Suites: 42 passed, 42 total
Tests:       720 passed, 720 total
Snapshots:   0 total
Time:        31.633 s, estimated 32 s
Ran all test suites.
```

`npx nx run-many -t typecheck -p @ptah-extension/memory-curator`

```text
> nx run @ptah-extension/memory-curator:typecheck

> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json




 NX   Successfully ran target typecheck for project @ptah-extension/memory-curator


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

## 6. Changes outside the four query files

- Modified `libs/backend/memory-curator/src/lib/memory-search.service.spec.ts` only because the new underfilled-page rule intentionally performs two SQL calls for a short mocked result page. The two cache tests still prove that a cache hit performs no additional calls; their expected first-miss call counts changed from one to two per cache key.
- Created `tmp/codex/fts-query.mjs`, `tmp/codex/fts-eval.mjs`, and `tmp/codex/variant-eval.mjs` as the requested scratch bundle and read-only live-database measurement harnesses. Every database handle used `{ readonly: true, fileMustExist: true }`; no migration or write was run.
- Created this required measurement deliverable. No other file was changed for the retrieval work.
