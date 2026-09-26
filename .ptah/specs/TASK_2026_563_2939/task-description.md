# Requirements - TASK_2026_563_2939

Revision: r2 (2026-09-26). r1 addressed the findings in `task-description-review.md` (codex
cross-side review, round 1). r2 rewords the M3 criterion 8 gates only.

## Context

The memory curator writes rows that do not last and cannot find the rows it should merge into. The
forensics report (`../TASK_2026_471_b3d1/forensics-memory-quality.md:7-9`) measured 36,252 rows and
estimated about 55% as ephemeral sediment. `event` rows are close to 100% sediment (5,691 rows). A
further 222 rows are verbatim copies of the `.commitlintrc.json` scopes (`:544-546`, `:388-395`).
There are 27,354 distinct subjects, and 86.7% of them are used only once. One repository name,
`ptah-video-studio`, collects 246 rows because the extract prompt's only subject examples are
service and repository names. The production prompt is
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:25`
(`"subject": a normalized lowercase key (e.g., "auth-service", "ptah")`), and it is loaded by
`sdk-internal-query.curator-llm.ts:34-36,295-296`. The prompt's only durability guidance is one line
(`:33-34`). A second copy of the prompt, `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts`,
has no importer in `libs/` or `apps/` (verified by grep on 2026-09-26). The forensics report cites
that dead copy, not the production one.

TASK_2026_473 Track A shipped two fixes. M1 is FTS stopword removal with AND and an OR top-up
(`12865f539`), which raised the four-query relevance score from 4.5/20 to **16/20**
(`../TASK_2026_473_c9f4/track-a-retrieval-measurement.md` §4). M2 is workspace-wide, case-folded,
exact-subject merge candidates (`MemoryStore.findMergeCandidates`, `memory.store.ts:357-400`: 5 per
subject, 50 in total, partitioned in SQL), with its index in migration
`0046_memory_merge_subject_index`. M2 cannot reach differently worded subjects. From the draft
subject `commitlint-scope-enum`, it reaches 1 of the 81 commitlint-family subjects (284 rows)
(`track-a-merge-measurement.md` §3). The resolve path still builds candidates from subject equality
only (`memory-curator.service.ts:601-611`). The hybrid BM25 + vector search `searchRich`
(`memory-search.service.ts:264-362`) exists in the same library but is not used for resolve. The
R2 analysis in the implementation plan (`../TASK_2026_471_b3d1/implementation-plan.md:185-199`)
names it as the merge-candidate source that needs no network call.

TASK_2026_443 (439 phase 2) is on main. It made salience an immutable base value used only for
ranking (`salience-ranking.ts`, migration `0044_memory_lifecycle`). It also added an age lifecycle:
recall rows move to archival after N days unused, and archival rows are hard-deleted after a grace
period or evicted over a per-workspace cap (`retention/memory-lifecycle.store.ts:13-60`). Usage is
recorded explicitly, and reads no longer write. No quarantine state exists today. The only removal
paths are hard deletes (`memory.store.ts:523-600`, lifecycle delete and evict). The user wants
three changes at the source: M4 (the extract prompt), M3 (semantic merge candidates) and M5
(reversible quarantine of existing sediment). Each change must be measured on a copy of the real
database and proven reachable from production.

## Classification

- Type: BUGFIX. It fixes defective write-path output (fragmented subjects, sediment) and a
  merge-candidate retrieval defect. This type was set by the user in `context.md`.
- Estimate: L. Three changes span three libraries (agent-sdk, memory-curator,
  persistence-sqlite), including one new migration. The work also needs LLM-backed extraction and
  resolve runs on a copy of the real DB, plus a hand-classified sediment sample.
- Priority: not defined here.

## Scope

In scope:

- M4: the extract system prompt in `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts`
  needs stable reusable subject guidance, a durability filter, and the fragmenting subject examples
  replaced. The unreferenced duplicate prompt in `libs/backend/memory-curator/src/lib/curator-llm/`
  is also in scope: after this task, exactly one extract prompt is served to production.
- M3: merge candidates in the `MemoryCuratorService` resolve path come from hybrid `searchRich`
  as a second tier. The M2 exact-subject path stays as tier 1. The added candidates are bounded
  (top-k) and workspace-scoped, and they add no new network calls.
- M5: reversible quarantine of existing sediment, with the following parts:
  - a quarantine state added by a new migration;
  - quarantined rows excluded from retrieval and from merge;
  - a restore operation;
  - no hard delete.
  - Rules are chosen only after a classified sample, and they are written to
    `quarantine-rules.md` in this task folder.
- Before and after measurements on a copy of the real DB, recorded in `test-report.md`.
- Unit specs, reachability specs, and scoped nx test, lint and typecheck runs.

Out of scope (as the user wrote it):

- M6 salience from real use: not part of this task.
- S1-S9 skill synthesis: not part of this task.
- TASK_2026_473 Track B: not part of this task.
- 439 phase 5: not part of this task.
- Jev/TypeSafe integration: not part of this task.

Also out of scope, because it is already shipped and must not be redone:

- Track A M1 (the FTS query rule in `fts-query.util.ts`).
- Track A M2 (the exact-subject SQL and migration 0046).

## Delivery constraints

These come from the user (`context.md:6,29`) and are binding for every specialist.

- All work happens in the worktree `D:\projects\ptah-extension-memory-quality-source`, on branch
  `fix/memory-quality-source`, created from origin/main at `ebfc73321`. No file in the main
  checkout `D:\projects\ptah-extension` is read for editing or written.
- Nothing is committed to main. Nothing is removed from main.
- The flow is fixed and runs in this order:
  1. project-manager writes this document.
  2. software-architect writes `implementation-plan.md`.
  3. The flow stops so the user can approve the plan. `task-description.md` and
     `implementation-plan.md` are shown together. This is the only planned stop.
  4. team-leader splits the plan into file-disjoint batches. The M4, M3 and M5 batches may run in
     parallel.
  5. Developers implement the batches.
  6. code-logic-reviewer and code-style-reviewer review each batch.
  7. senior-tester writes and runs the tests and produces `test-report.md`.
  8. Each batch gets one commit, with a message of the form
     `fix(memory-curator|agent-sdk|persistence-sqlite): ...`, using the scope of the library the
     batch changes. Hooks are never skipped.
- End state:
  - The branch is pushed.
  - A PR is opened against main, with a body containing `## Summary` and `## Test plan`.
  - The task `status:` is set to `in_review`.
  - The worktree is kept until the user merges.

## Requirements

### 1. M4: durable extraction with stable subjects

Requirement: the curator's extract step (`SdkInternalQueryCuratorLlm`) emits drafts that are
durable and filed under subjects future drafts on the same topic will reuse. This stops the store
from filling with single-use subjects and transient events.

Acceptance criteria:

1. When the extract system prompt is inspected, it shall contain no subject example that is a
   repository, app or service name used as a catch-all (today `"auth-service"` and `"ptah"`).
   Its examples shall show topic-level subjects that can be reused across sessions.
2. When the prompt is inspected, it shall instruct the model to reuse an existing subject key when
   one covers the topic. The existing `mcp__ptah__ptah_memory_search` tool guidance stays or is
   strengthened, not removed.
3. When the prompt is inspected, it shall instruct the model not to extract each of these
   categories, and each shall be named explicitly:
   - transient events, such as PR or CI status, agent timeouts or rosters, and one-off run
     outcomes;
   - task, worktree or branch chatter, such as `TASK_YYYY_NNN` progress and worktree paths;
   - restatements of rules already stored in the repository, such as commitlint scopes and lint
     or config contents.
4. When the task is complete, a repository-wide search shall find exactly one exported
   `EXTRACT_SYSTEM_PROMPT` that production code imports. The unreferenced memory-curator copy is
   either removed or the plan records why it stays.
5. When the extract output schema (`extract.schema.ts`) is validated after the change, it shall
   accept the same draft shape as today. No field is removed and the downstream resolve and insert
   code is unchanged by M4.
6. When the extraction evaluation runs over the same fixed sample of real session transcripts
   (taken from the DB copy) with the old prompt and then the new prompt, `test-report.md` shall
   record the following for both runs, and the new run shall show fewer single-use subjects than
   the old run (user AC 2):
   - the sample definition (session ids, how they were chosen);
   - the number of drafts;
   - the number of distinct subjects;
   - the number and percentage of subjects used once;
   - the number of subjects that already exist in the DB copy's workspace.

   The corpus-wide baseline of 86.7% single-use is cited for context only. The gate is the
   old-prompt run on the same sample.

7. When that evaluation runs, `test-report.md` shall classify every draft from both runs as
   durable or sediment using one written rubric. It shall list every durable draft from the old
   run that has no durable equivalent in the new run, so any loss of real facts is visible to
   review.
8. The extraction gate from criterion 6 passes only if all three of these hold:
   - (a) The single-use count is lower in the new run, and so is the single-use share (single-use
     subjects divided by distinct subjects). A lower count alone is not enough, because extracting
     fewer drafts lowers the count without any gain.
   - (b) The number of durable drafts in the new run is at least the number in the old run.
   - (c) The code-logic-reviewer or senior-tester has reviewed every entry in the durable-loss list
     from criterion 7, and each entry is either matched by a durable draft in the new run or
     marked "accepted" with a written reason. A whole class of durable fact is missing from the
     new run if the rubric category that held it in the old run has no durable draft in the new
     run. When that happens, the gate fails unless that loss is marked accepted with a reason.

### 2. M3: semantic merge candidates

Requirement: the resolve step of `MemoryCuratorService` sees existing memories that are about the
same topic even when their subject is worded differently. The model can then merge near-duplicates,
such as the commitlint family, instead of creating new rows.

Acceptance criteria:

1. When a curator pass has drafts with subjects, the system shall build the candidate list as
   follows:
   - Tier 1 is the unchanged `findMergeCandidates` result (case-folded equality, 5 per subject,
     50 in total).
   - Tier 2 is candidates from `searchRich`, with tier-2 duplicates of tier-1 ids removed.
   - Tier-1 candidates keep their order and are never displaced by tier 2.
2. When tier 2 runs, it shall request a bounded number of results per draft and a bounded total.
   Both bounds shall be named constants covered by a spec, and a spec shall prove neither is
   exceeded for a pass with many drafts.
3. When the pass has a workspace root, tier-2 candidates shall come only from that workspace.
   When the pass has a null workspace root, tier-2 candidates shall come only from rows whose
   `workspace_root IS NULL`, not from every workspace. Today `searchRich` applies no workspace
   filter when `workspaceRoot` is undefined (`memory-search.service.ts:379-381`), so this case
   needs its own spec.
4. When tier 2 runs, the pass shall make no network call beyond those made on main today. The
   embedder and reranker used are the ones already in process. The plan names each call and shows
   it is local.
5. When vector search is unavailable or fails (`bm25Only`), or `searchRich` throws, the system
   shall still resolve with the tier-1 candidates plus any BM25 tier-2 candidates. The pass is not
   failed, deferred or dropped because of tier 2.
6. When tier 2 fetches candidates, it shall not record usage for them and shall not write salience.
   This keeps the 443 rule that reads do not write and salience is set only at insert. Only an
   actual merge records usage, as today.
7. When the resolve model returns a `mergeTargetId` that is not in the candidate list sent to it,
   or that belongs to another workspace, the system shall not append to that row. It shall insert
   the draft as new instead. A spec covers both cases.
8. When the M3 merge measurement runs on the DB copy, `test-report.md` shall record the following
   before (main) and after (branch), and it shall meet the gates below (user AC 1, merge half):
   - (a) For draft subject `commitlint-scope-enum`, the number of distinct commitlint-family
     subjects in the candidate set (baseline 1 of 81). Gate: the after count is higher than the
     before count.
   - (b) A fixed, listed set of near-duplicate drafts replayed through the resolve step, recorded
     as three numbers: the drafts attempted (the denominator), the drafts resolved as merges (the
     numerator), and the merge rate (merges divided by attempts). Gates:
     - the attempted set is identical before and after;
     - the after merge count is higher than the before merge count;
     - the after merge rate is higher than the before merge rate.

   This M3 measurement runs without the M5 quarantine applied, so the M3 effect is isolated from
   the quarantine.

### 3. M5: reversible sediment quarantine

Requirement: existing sediment rows are taken out of retrieval and merge without being destroyed.
A maintainer can restore any quarantined row to exactly its previous behaviour.

Acceptance criteria:

1. Before any quarantine rule is chosen, `quarantine-rules.md` in this task folder shall record a
   random classified sample from each of these categories, with more than 15 rows per category:
   - `kind = 'event'`;
   - task-subject rows (`task-2026-%` or similar);
   - worktree rows;
   - commitlint-family rows.

   For each sampled row it shall record the id, the subject, a content excerpt, a durable or
   sediment verdict, and the reason. It shall also record the sampling query and seed or row ids,
   so the sample can be re-run.

2. When the rules are written in `quarantine-rules.md`, each rule shall state:
   - its exact predicate;
   - the rows it matches on the DB copy;
   - how many sampled durable rows it would catch, with each one listed.

   A rule that catches a sampled durable row shall be narrowed, or the false positive shall be
   listed as accepted, with the reason.

3. When migration `0048` (or the next free number after the highest on main at implementation
   time) is applied, it shall add the quarantine state and nothing else destructive:
   - it shall follow persistence-sqlite conventions: static SQL with no template interpolation,
     a header comment, registration in `migrations/index.ts`, and its own spec;
   - it shall not edit any already-applied migration, including 0044, 0046 and 0047.
4. When the migration runs on a copy of the real DB, `test-report.md` shall record the following
   before and after (user AC 4):
   - The row count of each of these tables, equal before and after:
     - `memories`;
     - `memory_chunks`;
     - the FTS table;
     - the vector table.

     The implementation plan names the actual FTS and vector tables.

   - The `PRAGMA integrity_check` result. It shall be exactly `ok` both before and after.
   - A deterministic identity and content comparison of every row that existed before the
     migration, in `memories` and `memory_chunks`. The comparison uses all pre-existing columns,
     excludes the new quarantine column, and sorts by primary key. It shows zero rows added,
     removed or changed. An ordered hash per table is acceptable if the plan specifies it.
   - The migration duration.
5. When a row is quarantined, it shall not appear in any of these:
   - `search`, `searchRich` or `searchIndex` results;
   - context injection into agent prompts;
   - `findMergeCandidates`;
   - M3 tier-2 candidates;
   - any other path that returns memory content to an agent.

   The plan shall list every such read path with `file:line`, and a spec shall cover each one.

6. When a quarantined row is restored, it shall appear again in every path from criterion 5, with
   its content, chunks, subject, salience, tier and pinned state unchanged. Exactly one spec shall
   walk quarantine, then exclusion from search and merge, then restore, then inclusion again
   (user AC 3).
7. When quarantine or restore runs, no row, chunk, FTS entry or vector entry shall be deleted by
   that operation. It shall be idempotent: quarantining a quarantined row, or restoring an active
   row, changes nothing.
8. When a quarantined row's id is returned by the resolve model as a merge target, the system
   shall not append to it.
9. The 439 phase 2 age lifecycle (archive, delete after grace, per-workspace cap eviction) runs
   in `MemoryRetentionService.run` and `retention/memory-lifecycle.store.ts`. While a row is
   quarantined, the following shall hold:
   - (a) The lifecycle shall never hard-delete, archive or evict it. The same holds for its
     chunks, FTS entries and vector entries.
   - (b) Its `tier`, `archived_at`, `salience`, `pinned`, `hits` and `last_used_at` values shall
     stay frozen at their values when it was quarantined, and restore returns them unchanged.
     A row that was archival when quarantined is archival again after restore.
   - (c) It shall not count toward the per-workspace cap. It is neither counted as over-cap nor
     chosen for eviction. So quarantining rows can only lower a workspace's cap pressure, and
     restoring rows can raise it again from the next lifecycle run.
   - (d) Lifecycle behaviour for rows that are not quarantined shall be unchanged. The existing
     lifecycle specs from TASK_2026_443 pass without edits to their expectations.

   Only the minimal lifecycle integration needed to enforce (a) to (c) is allowed. The architect
   chooses the mechanism.

10. When a spec quarantines rows (an archival row past its grace cutoff, a recall row past its
    unused cutoff, and rows in a workspace over its cap), runs one lifecycle pass, and then
    restores the rows, all of the following shall hold:
    - every quarantined row, and all of its chunks, still exists after the pass;
    - none of them changed tier or `archived_at` during the pass;
    - after restore they have their pre-quarantine values;
    - an equivalent control row that is not quarantined is archived, deleted or evicted exactly
      as on main.
11. When the quarantine rules are applied to the DB copy, `test-report.md` shall record the
    following:
    - the rows quarantined per rule and in total, against the 36,252-row forensics figure and the
      copy's actual total;
    - confirmation that restoring all quarantined rows returns the copy to its pre-quarantine
      retrieval results for the four Track A queries.

### 4. Measurement and reachability (all three changes)

Requirement: each claim is backed by numbers from the real corpus and by proof that production
code runs the changed code.

Acceptance criteria:

1. When relevance is measured, it shall use the Track A method: the four queries Q1-Q4 from
   `track-a-retrieval-measurement.md` §2, the same search path, top 5, and the same relevance
   rubric, with a reason written for every row. The measurement runs on the DB copy for main and
   for the branch with M3, M4 and M5 applied.
   - The branch total shall be at least the main total on the same copy.
   - Main shall be re-measured on the copy. If the re-measured total differs from 16/20, both
     numbers are recorded and the re-measured one is the gate. The branch total shall also be at
     least 16/20 (user AC 1, relevance half).
2. When any measurement, migration dry run or quarantine run happens, it shall use a copy of the
   real memory DB, never the live file:
   - The copy shall be a consistent snapshot, made in one of these ways:
     - with the SQLite online backup API or `VACUUM INTO` from a read-only connection;
     - by a file copy of the DB and its `-wal` taken while no Ptah process has the database open,
       with that absence recorded.
   - `test-report.md` records the copy's path, when it was taken, the method used, and
     `PRAGMA integrity_check = ok` on the copy before any measurement runs.
   - The copy lives outside `%USERPROFILE%\.ptah\state` and its backup directory. Its file name
     does not start with `ptah`. The reason: `SqliteBackupService` rotation
     (`libs/backend/persistence-sqlite/src/lib/backup.service.ts:258-264, 599-607`) deletes files
     that start with the DB base name followed by `-` or `.pre-migration-` and end in `.sqlite`.
     A copy with such a name could be rotated away, or could push a real backup out of the
     retained set.
   - Nothing opens for writing, migrates, renames or deletes `%USERPROFILE%\.ptah\state\ptah.sqlite`,
     its `-wal` or `-shm` files, or any `ptah.pre-migration-*.sqlite`.
3. For each of M4, M3 and M5, a spec shall fail if the production caller stops calling the
   changed code (user AC 6). `test-report.md` shall list the `file:line` of each production
   caller. The three production paths are:
   - M4: the system prompt passed by `SdkInternalQueryCuratorLlm.extract` is the new one.
   - M3: the `MemoryCuratorService` pass invokes the tier-2 source.
   - M5: the production search, injection and merge paths exclude quarantined rows, and the path
     that applies the rules to a user's DB is reachable, or the plan states it is a one-time
     application and where it runs.
4. When verification runs, it shall use `npx nx run-many -t test lint typecheck -p <projects>`,
   limited to memory-curator, agent-sdk, persistence-sqlite and the direct dependents the plan
   names. The `for N projects` header is checked. No workspace-wide run is made (user AC 5).
   - SQLite specs pass under both `better-sqlite3` (Electron ABI) and `node:sqlite`. The source
     is `.ptah/specs/TASK_2026_439_1310/HANDOFF.md:56` (working rule 3: CI loads
     `better-sqlite3`, local Node falls back to `node:sqlite`, and an unbound named parameter
     passes locally but fails on CI).
   - Every changed unit has a unit spec.

## Non-functional requirements

- Compatibility (Track A): the Track A code shall stay as it is:
  - migration 0046 and its `idx_memories_ws_normalized_subject` index;
  - the case-folded subject predicate `TRIM(LOWER(subject))`;
  - the `findMergeCandidates` caps and ordering;
  - the FTS query rule in `fts-query.util.ts`.

  Any M5 filter added to `findMergeCandidates` shall keep that index usable, and the plan shows it
  with `EXPLAIN QUERY PLAN` on the copy.

- Compatibility (439 phase 2): the quarantine shall not be implemented by writing `salience`,
  `tier` or `archived_at`. It shall not resurrect `MemoryDecayJob`, `SalienceScorer`,
  `updateTier` or `lastDecay*`. It shall not add a second retention job or new retention gates
  (boot, battery, foreground or budget gates). The one lifecycle change allowed is the exclusion
  of quarantined rows from archive, delete, evict and cap counting (M5 criterion 9).
- Security: new migration SQL stays static. Quarantine rule predicates run as parameterised or
  static SQL.

## Stakeholders

| Stakeholder                                 | What they need from this change                                                     | How they will judge it                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ptah user (repository owner)                | Memory search returns durable knowledge, not sediment, and nothing is lost for good | Relevance at or above 16/20 in `test-report.md`; quarantine restorable; row counts equal after the migration |
| Agents consuming memory (search, injection) | Fewer transient or duplicated rows competing for top-k                              | Track A queries on the branch copy; rows quarantined per rule                                                |
| Curator pipeline (extract, then resolve)    | Drafts merge into existing topics instead of creating singletons                    | Commitlint-family reachability above 1 of 81; replayed merge count up                                        |
| Owners of 439 phase 2 lifecycle and Track A | Their shipped behaviour is unchanged                                                | Their existing specs still pass; no edits to 0044, 0046 or 0047                                              |

## Risks

| Risk                                                                                                              | Likelihood                           | Impact | Mitigation                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quarantine rules catch durable rows, for example an `event` that records a real decision                          | MEDIUM                               | HIGH   | Developer: classify the per-category sample first and list every durable row each rule catches (M5 criteria 1-2). Reviewer: reject any rule without that listing. Rows stay restorable.    |
| The lifecycle's archival hard delete or cap eviction deletes quarantined rows, breaking "never hard delete"       | MEDIUM                               | HIGH   | Architect: exclude quarantined rows in every lifecycle query (M5 criterion 9). Senior-tester: pin this with the quarantine → lifecycle run → restore spec (M5 criterion 10).               |
| Tier-2 `searchRich` in resolve adds latency, or runs with embeddings unavailable                                  | MEDIUM                               | MEDIUM | Architect: bound top-k. Senior-tester: record resolve-path timing on the copy for main and the branch in `test-report.md`, and prove the fallback when `bm25Only` is set (M3 criterion 5). |
| `searchRich` with a null workspace searches every workspace and merges across projects                            | HIGH, since the code does this today | HIGH   | Developer: add the null-workspace spec (M3 criterion 3) and the out-of-list merge-target guard (M3 criterion 7).                                                                           |
| The durability filter lowers recall of real facts                                                                 | MEDIUM                               | MEDIUM | Senior-tester: produce the durable-draft loss list (M4 criterion 7) for review before merge.                                                                                               |
| Quarantining the whole commitlint family leaves M3 nothing to merge into, and the two ACs pull against each other | MEDIUM                               | LOW    | Measure M3 without quarantine applied (M3 criterion 8). The architect decides whether a canonical row stays active.                                                                        |

## Open questions

These are for the software-architect. They do not block starting.

- How the lifecycle exclusion from M5 criterion 9 is enforced. The behaviour is decided; only
  the mechanism is open.
- Where are the quarantine rules applied in production (in the migration, in a one-time step
  inside the existing retention job, or through an operator command), and who can restore rows
  and through which surface? Restore has to be at least a store operation with a production-reachable
  caller.
- Which read surfaces show quarantined rows? Examples are `stats`, the admin list and `listAll`,
  the corpus rebuild, `timeline` and `getObservations`. Should an admin surface show quarantined
  rows so they can be restored?
- Should one canonical commitlint row stay active, or should the family be quarantined as copies
  of a repository rule?
- What are the tier-2 top-k values per draft and in total, and what query text is used per draft
  (subject, content, or both)?

## Author-introduced constraints

The following are project-manager proposals that go beyond the user's request in `context.md`.
The user may approve or strike each one at the plan stop.

- M4 criterion 4: a single production extract prompt. The unreferenced memory-curator copy is
  removed or its retention justified.
- M4 criterion 7 and criterion 8(b)-(c): the durable-draft rubric, the loss list and its gate.
  The user asked only for fewer single-use subjects.
- M4 criterion 8(a): the single-use share condition, which guards against a lower count caused
  by extracting less.
- M3 criteria 3, 6 and 7:
  - null-workspace scoping;
  - no usage recording for candidates;
  - refusal of a merge target that is out of the candidate list or in another workspace.
- M3 criterion 8: the merge metric is defined as family reachability plus a replayed resolve
  merge rate, and it is measured with quarantine off.
- M5 criteria 1 and 2: the four sampling categories, and per-rule false-positive listing. The user
  asked for more than 15 event rows and for the rules to be written to the spec folder.
- M5 criteria 8 to 10:
  - merge-target refusal for quarantined rows;
  - frozen lifecycle fields and cap exclusion;
  - the lifecycle round-trip spec.

  The coordinator's round-1 revision directed these, to keep the user's "never hard delete"
  guarantee intact against the 443 lifecycle.

- M5 criterion 4: `integrity_check = ok` and the row identity and content comparison. These
  tighten user AC 4.
- Measurement criterion 1: re-measuring main on the copy, with the re-measured total as the gate.
- Measurement criterion 2: the consistent-snapshot methods and the copy location and name rule.
  The name rule is justified by `backup.service.ts` rotation.
- Measurement criterion 4: the dual-driver SQLite run, sourced from
  `TASK_2026_439_1310/HANDOFF.md:56`, not from the user.
- Non-functional requirements: `EXPLAIN QUERY PLAN` evidence that the 0046 index stays usable.

## Handoff

- Next specialist: software-architect.
- Why: the requirements are fixed. What remains is shape: the quarantine state and its interaction
  with the 443 lifecycle, the placement of tier 2 in the resolve path, where the rules are applied,
  and the list of read paths.
