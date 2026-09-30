# Task Context - TASK_2026_577_cbfb

## Background

The memory corpus has two ways to get smaller: the age lifecycle (TASK_2026_443, recall to archival after
30 days unused, delete after 60 more days) and quarantine (TASK_2026_563). Neither of them combines
duplicates. Merge candidates (tier 1 exact subject, tier 2 hybrid `searchRich`) are checked only in the
resolve path of a new curation pass. A near-duplicate that is still being used is never merged and never
ages out.

Live state on 2026-09-30 (`~/.ptah/state/ptah.sqlite`, read-only):

- memories: 12,363 recall, 14,341 archival, 2 core; 89 quarantined, all `rule:commitlint-scope-facts`.
- unquarantined kinds: 18,331 fact, 5,293 event, 2,273 preference, 720 entity.
- TASK_2026_471 forensics: 86.7% of subjects are used once.

## Goal

A scheduled job that reduces the existing corpus by merging near-duplicates, without losing durable facts
and without a hard delete.

## Scope

1. Register an idle- and power-gated job in `thoth-runtime` cron start, through the background-work
   governor, with a bounded budget for each run and a resumable cursor (follow the retention job pattern).
2. Candidate clusters: same workspace, lowercased subject match first, then embedding similarity over a
   threshold. Bounded cluster size.
3. For each cluster, one curator LLM call writes the merged memory (subject, content, kind, tier = highest
   of the members, pinned wins). Clusters of one are skipped without an LLM call.
4. Members go to the existing reversible quarantine with a reason such as `merged-into:<id>`. Restore
   through `memory:restoreQuarantined` must bring them back.
5. Diagnostics: last run, clusters merged, rows quarantined, and a dry-run preview.

## Out of scope

- Sediment classification (TASK_2026_568).
- Changes to write-time merge (TASK_2026_566).
- Salience from real use (forensics M6), unless it is needed to pick the survivor.

## Acceptance criteria

1. A dry run on a copy of a real database reports cluster counts and sample merges. A reviewer checks 20
   samples and finds no lost durable fact.
2. A real run on the copy reduces active memories by a measured amount. The number is in the test report.
3. The Track A relevance query set (TASK_2026_569) does not regress.
4. A spec proves merge, then quarantine of the members, then restore.
5. Reachability proof: a boot or integration spec fails if the job is not registered.

## Depends on

TASK_2026_572: the user must be able to see and restore quarantined rows before this job quarantines at
scale.
