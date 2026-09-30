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
4. Members go to the existing reversible quarantine: set `quarantined_at` and
   `quarantine_reason = 'merged-into:<id>'`, where `<id>` is the id of the generated merged row. Nothing is
   hard-deleted. Facts that shape this item:
   - The columns are `memories.quarantined_at` (epoch ms) and `memories.quarantine_reason`
     (`0048_memory_quarantine.ts:19-20`). The only writer today is migration `0049`; `MemoryStore` has no
     quarantine method, only `restoreQuarantined` (`memory.store.ts:912-960`). The job needs one.
   - `restoreQuarantined` clears both columns on the selected quarantined rows and nothing else
     (`memory.store.ts:940-946`). It does not touch the merged row.
   - The RPC `reason` selector only accepts `rule:[a-z0-9-]+` (`memory-rpc.schema.ts:115-118`). Memory ids
     are ULIDs, upper case (`memory.store.ts:200`). So `merged-into:<id>` cannot be restored by reason through
     `memory:restoreQuarantined` today. Widen the schema to accept `merged-into:<ULID>`.

   Revert a merge: restore by reason `merged-into:<id>` in the member's workspace. In the same transaction,
   the members become active again and the merged row is quarantined with reason `merge-reverted`. After
   the revert, the active rows of that workspace are exactly the pre-merge active rows.

   Restore one member by id: that member becomes active and its reason is cleared, so the link is lost. The
   merged row stays active; one duplicate is accepted. A later revert of the same merge restores the other
   members and quarantines the merged row. Because the reason is cleared, the job keeps its own record of
   each merge (merged id, member ids), and never merges a member the user restored by hand again.
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
4. A spec proves merge, then quarantine of the members with `merged-into:<merged id>`, then revert. After
   the revert, the members have `quarantined_at IS NULL`, the merged row still exists with
   `quarantine_reason = 'merge-reverted'`, and the set of active rows equals the pre-merge set. A second
   case restores one member by id first: the merged row stays active, and the later revert restores the
   rest and quarantines the merged row. The revert runs through `memory:restoreQuarantined`.
5. Reachability proof: a boot or integration spec fails if the job is not registered.

## Depends on

TASK_2026_572: the user must be able to see and restore quarantined rows before this job quarantines at
scale.
