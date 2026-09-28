# Implementation Plan - TASK_2026_563_2939

Memory quality at the source: M4 (extract prompt), M3 (semantic merge candidates) and M5 (reversible
sediment quarantine). All paths are relative to the worktree
`D:\projects\ptah-extension-memory-quality-source` (branch `fix/memory-quality-source`, base
`ebfc73321`). Line numbers were verified on that base on 2026-09-26.

**Revision r3** (2026-09-26). Gate 2 approved; r3 records the decisions and removes stale rule
references. Revision r2 answered the codex cross-side review in
`implementation-plan-review.md`: round 1, findings 1 to 11 (r1), and the r1 recheck, findings 1 and
12 to 14 (r2).

## Revision changes (r1, r2 and r3)

| #     | Finding                                               | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | The rules caught durable root-cause rows              | `quarantine-rules.md` r1 does the following: <ul><li>classifies the 3 counterexamples as durable</li><li>refines the rubric to judge every structured field</li><li>drops R2 and R3</li><li>adds a structural event guard to R1: empty `learned`, and type not bugfix/decision/refactor</li><li>narrows R4 to commitlint **facts** that mention scope, with an explicit policy</li><li>draws fresh seeded holdouts (0 durable caught by the kept rules)</li></ul> Totals at r1: 345 rows (256 + 89). **Superseded by r2-1.**                                                                   |
| 2     | `memory:get` returned quarantined content by id       | New `MemoryStore.getActiveById`. `memory:get` uses it and returns `{ memory: null, chunks: [] }` for a quarantined id. No flag is exposed to agents. `getById` stays raw for the guard, `lookupMemory` and diagnostics. The path is added to the inventory and to the round-trip spec (components 4, 8 and 9).                                                                                                                                                                                                                                                                                 |
| 3     | NULL-workspace rows had no restore route              | `memory:restoreQuarantined` takes `workspaceRoot: string \| null` as a **required** key. An explicit `null` targets exactly `workspace_root IS NULL`; there is no "all workspaces" mode. `listQuarantined` returns `workspaceRoot` per row. Specs cover restore for both a null and a named workspace, and 0049 has a NULL-workspace fixture (components 4 and 8).                                                                                                                                                                                                                             |
| 4     | D4 conflicted with M3 criterion 4                     | D4 now offers two options with their cost: **(A)** accept the extra resolve calls; **(B, recommended)** strict, where tier 2 runs only when tier 1 is non-empty. The expected effect of each on the merge gate is stated. M3.4 is not claimed met under A. The replay measures both.                                                                                                                                                                                                                                                                                                           |
| 5     | Wave 1 was not file-disjoint                          | Components 1 and 2 are **one agent-sdk batch**, which owns `sdk-internal-query.curator-llm.spec.ts` (handoff).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6     | The backup is best-effort                             | Every claim is corrected. The runner skips the backup when no service is wired, and treats a backup failure as non-fatal. D1's safety rests on reversibility inside the upgraded schema, not on a backup.                                                                                                                                                                                                                                                                                                                                                                                      |
| 7     | The cache key ignored topK                            | `makeCacheKey` includes the clamped limit, and a spec covers two limits (component 6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8     | Starvation in `searchIndex`                           | The BM25 and vector by-memory queries now filter upstream. KNN starvation is documented and accepted for both paths, and the tester measures it (component 6, measurement plan).                                                                                                                                                                                                                                                                                                                                                                                                               |
| 9     | The round-trip restored only one class                | It now restores **all**. A quarantined corpus member is created by inserting a `corpus_memories` link after 0049 has run (component 9).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10    | Delivery checklist; D2                                | A delivery checklist is added at the end of the handoff. D2 stays a Gate 2 decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| r2-1  | R1 still caught 4 durable rows (the r1 recheck)       | The four rows are classified durable. The narrowing options were evaluated on the copy. The narrowest variant (every structured field empty, plus 20 causal/constraint words) still held 3 durable and 2 borderline rows in a full read of all 43 rows, so **R1 is dropped**. A fresh 30-row R4 holdout was read across every field: 0 durable. Only R4 remains: **89 rows, 89 chunks, 0 known durable caught** (`quarantine-rules.md` §4.4-4.5 and §6). The four ids, and one more, are added as durable fixtures. The counts in D1, component 3, the measurement plan and Risks are updated. |
| r2-12 | Arithmetic and the chunk bound                        | `quarantine-rules.md` §6 explains the counts: one rule, so the union equals the first-match count; "377" was a dropped-rule artifact. The chunk figure is now the measured 89 of 29,447 (the review's 394 was for r1's 345 memories).                                                                                                                                                                                                                                                                                                                                                          |
| r2-13 | The fixture preamble                                  | The fixtures are named durable/guard/positive. The positive NULL-workspace fixture is exempt from the stay-NULL rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| r2-14 | D4 timing                                             | Gate 2 sees the proxy estimates only. The measured A/B replay arrives during testing, to validate the choice. No experiment runs before the gate.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| r3-15 | Stale rule references (review finding 15)             | Every stale reference to four rules, R1, R2, R3 or the r1 `EV` event guard is removed from the live design. Migration 0049 is exactly one UPDATE: the common guard plus the R4 predicate, both copied verbatim from `quarantine-rules.md` r2 §5-§6. Rows 1 and r2-1 of this table remain as history only.                                                                                                                                                                                                                                                                                      |
| r3-16 | The round-trip workspace sentence (review finding 16) | The round-trip spec seeds a named workspace **and** the NULL workspace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| r3-G2 | The Gate 2 decisions                                  | A "Gate 2 decisions (user-approved 2026-09-26)" block is added under the Decisions section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 11    | Citations and labels                                  | `Migration` is at `index.ts:78`. The M4 evaluation is relabelled "prompt-only, limited". The ≥16/20 gate is kept beside the re-measured gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Inputs and constraints

- **Requirements used:**
  - `context.md`
  - `task-description.md` (r2)
  - `task-description-review.md`
  - `../TASK_2026_471_b3d1/forensics-memory-quality.md`
  - `../TASK_2026_471_b3d1/implementation-plan.md:185-199`
  - `../TASK_2026_473_c9f4/track-a-*.md`
  - `../TASK_2026_439_1310/HANDOFF.md:50-75`
  - `CONVENTIONS.md`
  - `quarantine-rules.md` (written in this phase, from the classified sample on the DB copy)
- **Corrections applied:** none. Findings 2 and 7 of `task-description-review.md` were wording
  fixes, and r2 already contains them. This plan treats the M4/M3/M5 parallel split as binding
  where files allow it (see the handoff).
- **Design handoff used:** none. There is no UI work.
- **Missing decision-critical input:** none that blocks the work. Four decisions are made here and
  listed under "Decisions for the user at Gate 2", so the plan stop can confirm or strike them.
- **Instruction files:** `CONVENTIONS.md` governs:
  - `*Store` is pure storage.
  - Tokens are `Symbol.for`, kept in `di/tokens.ts`.
  - The layer rule applies.
  - Barrels stay at 150 lines or fewer.

  The worktree has no per-library `CLAUDE.md`. `HANDOFF.md:50-75` rules 1 to 5 are adopted as
  verification rules:
  - nx `run-many -p`
  - quoting
  - dual SQLite drivers
  - degradation-audit markers
  - never opening the live DB

- **Environment prerequisite (blocking for every batch):** the worktree has no `node_modules`
  (verified). `better-sqlite3` and `sqlite-vec` cannot load, and `nx` cannot run. Before batch 1,
  the team-leader runs `npm ci` inside the worktree. The main checkout is never touched, so no
  junction into it is made.

## Settled items from the cross-side review

| Unresolved item                                 | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Where the dual-driver rule comes from           | Verified. `HANDOFF.md:56-63`, rule 3: "CI loads `better-sqlite3`; local Node falls back to `node:sqlite` … Run SQLite specs both ways". The shared fixture already implements the fallback (`libs/backend/memory-curator/src/lib/retention/retention-sqlite.test-support.ts:50-72`).                                                                                                                                                                         | Read on 2026-09-26                                                                                 |
| Network and fallback behaviour of hybrid search | Every tier-2 call is local once the model files are cached, and main already loads both models. See "Network calls on the tier-2 path". The fallbacks are already in `searchRichInner`: a vector failure falls back to BM25 (`memory-search.service.ts:293-306`) and a reranker failure falls back to RRF order (`:331-338`). A throw from `searchRich` itself is caught by the new collector.                                                               | `embedder-worker.ts:132-175,213-251,298-306`; `wire-runtime.ts:641-649`; `memory.store.ts:229-233` |
| Transcript availability for the M4 evaluation   | Available. 252 of the 779 sessions that have memories in `D:\projects\ptah-extension` on the copy have a JSONL at `~/.claude/projects/D--projects-ptah-extension/<sessionId>.jsonl` (`transcripts.mjs` in the snapshot folder). The production reader `SessionHistoryReaderService.readHistoryForCuration` reads exactly that file through `jsonlReader.findSessionsDirectory` (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:679-753`). | See "Measurement plan"                                                                             |

## Codebase evidence

| Evidence                                                                                                                                                                          | Location                                                                                                                                                                                                                                                                                                                                              | Architectural implication                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The production extract prompt uses catch-all subject examples (`"auth-service"`, `"ptah"`) and has one line of durability guidance                                                | `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:25,33-34`                                                                                                                                                                                                                                                                       | M4 rewrites this constant only                                                                                                                          |
| The prompt reaches production at extract                                                                                                                                          | `sdk-internal-query.curator-llm.ts:33-36,294-299`; registered as `SDK_CURATOR_LLM_ADAPTER` = `Symbol.for('PtahCuratorLlm')` at `agent-sdk/src/lib/di/register.ts:544-545`                                                                                                                                                                             | M4 reachability seam                                                                                                                                    |
| The duplicate prompt `memory-curator/src/lib/curator-llm/extract-prompt.ts` has no importer                                                                                       | A repository-wide grep for `extract-prompt`, `EXTRACT_SYSTEM_PROMPT` and `buildExtractUserPrompt` finds only the agent-sdk import (`sdk-internal-query.curator-llm.ts:33-36`) and a prose mention in `clamp-transcript.ts:26`. It is not exported from `memory-curator/src/index.ts`.                                                                 | Delete it                                                                                                                                               |
| The same folder has a second dead duplicate, `curator-llm/resolve-prompt.ts`                                                                                                      | Same grep: no importer                                                                                                                                                                                                                                                                                                                                | Out of scope; recorded as a follow-up                                                                                                                   |
| The resolve prompt ties merging to subject equality and invites merge targets found by tool search                                                                                | `curator-llm-adapter/resolve-prompt.ts:22,26-32`                                                                                                                                                                                                                                                                                                      | M3 cannot raise the merge rate with differently worded candidates unless this changes                                                                   |
| Resolve skips the LLM call when `related` is empty                                                                                                                                | `sdk-internal-query.curator-llm.ts:359-362`                                                                                                                                                                                                                                                                                                           | Tier 2 makes that existing call happen in more passes (Decision D4)                                                                                     |
| Tier 1 today builds candidates from subjects only                                                                                                                                 | `memory-curator.service.ts:603-612`                                                                                                                                                                                                                                                                                                                   | Tier 2 goes after `:612` and before `:614`                                                                                                              |
| The merge applies without checking candidate list, workspace or quarantine                                                                                                        | `memory-curator.service.ts:649-664`                                                                                                                                                                                                                                                                                                                   | The M3 criterion 7 and M5 criterion 8 guard goes here                                                                                                   |
| `findMergeCandidates` uses `workspace_root IS ?` with case-folded subjects, 5 per subject and 50 in total                                                                         | `memory.store.ts:357-410`                                                                                                                                                                                                                                                                                                                             | Tier 1 stays unchanged except for the quarantine predicate                                                                                              |
| `searchRich` filters by workspace only when `workspaceRoot` is truthy                                                                                                             | `memory-search.service.ts:383-386,402,444,456`; cache key `workspaceRoot ?? ''` at `:209-216`                                                                                                                                                                                                                                                         | A null scope needs a tri-state and its own cache key                                                                                                    |
| `searchRich` never writes usage                                                                                                                                                   | `memory-search.service.ts:264-366` (reads plus an LRU cache only); usage is recorded by callers (`memory-prompt-injector.ts:138`, `memory-namespace.builder.ts:234`, `mem-rpc.handlers.ts:156`, `memory-rpc.handlers.ts:249`)                                                                                                                         | Tier 2 satisfies M3 criterion 6 as long as the collector never calls `recordUse`                                                                        |
| Pattern: a pipeline collaborator constructed inside the curator service, not injected                                                                                             | `memory-curator.service.ts:158-166,195-197` (`CuratorWindowRunner`, `CuratorJobQueue`)                                                                                                                                                                                                                                                                | `MergeCandidateCollector` follows it                                                                                                                    |
| Pattern: optional dependencies go last on the curator constructor, because specs construct it positionally                                                                        | `memory-curator.service.ts:188-193`                                                                                                                                                                                                                                                                                                                   | The search dependency is appended as the last optional parameter                                                                                        |
| `MEMORY_SEARCH` is registered as a singleton                                                                                                                                      | `memory-curator/src/lib/di/register.ts:96-103`                                                                                                                                                                                                                                                                                                        | No registration change                                                                                                                                  |
| DI-reach spec precedent against a real SQLite file                                                                                                                                | `memory-curator/src/lib/di/register.spec.ts:1-60`                                                                                                                                                                                                                                                                                                     | M3 reachability spec goes here                                                                                                                          |
| The lifecycle SQL constants, and a spec that pins their index plans                                                                                                               | `retention/memory-lifecycle.store.ts:12-75`; `memory-lifecycle.store.spec.ts:56-96`                                                                                                                                                                                                                                                                   | The quarantine predicate goes into each constant. The `INDEXED BY` plans stay valid (EQP below).                                                        |
| The lifecycle test fixture applies a fixed list of migrations                                                                                                                     | `retention-sqlite.test-support.ts:219-229`                                                                                                                                                                                                                                                                                                            | Add version 48, or every lifecycle spec fails on the new column                                                                                         |
| Migration conventions: static SQL, a header comment, registration, a spec, and a version-ceiling ratchet in older specs                                                           | `persistence-sqlite/src/lib/migrations/index.ts:1-18,98-104`, `0046_memory_merge_subject_index.ts`, `0047_memory_retention_health.ts`; ratchet asserts in the specs for 0028, 0030, 0038-0044, 0046 and 0047 (e.g. `0030_skill_event_metrics.spec.ts:30-37`)                                                                                          | 0048 and 0049 follow them. The ratchet asserts move from 47 to 49 with a comment, as each earlier task did.                                             |
| Precedent for a one-time data migration with static predicates                                                                                                                    | `0039_reap_orphaned_queue_rows.ts:1-60`                                                                                                                                                                                                                                                                                                               | The rules are applied by migration `0049`                                                                                                               |
| The runner is exactly-once and forward-only. It attempts a `pre-migration` backup only when a backup service is wired, and a backup failure is logged as non-fatal (best-effort). | `migration-runner.ts:65-158`, especially `:79-85,88-104`; applied at boot from `sqlite-connection.service.ts:239`                                                                                                                                                                                                                                     | Rules reach every host at boot. Downgrade after 0049 is refused (Risks). A backup may not exist, so reversibility must hold inside the upgraded schema. |
| No trigger on `memories` UPDATE; FTS and vec triggers live on `memory_chunks`                                                                                                     | Copy schema: `memory_chunks_ai/ad/au`, `memory_chunks_vec_ad`, `memories_concepts_ad` (delete only)                                                                                                                                                                                                                                                   | Setting quarantine columns never touches FTS or vector entries (M5 criterion 7)                                                                         |
| RPC surface pattern                                                                                                                                                               | `rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:111-127,403-462` (METHODS plus refusal of unscoped destructive calls); `host-profile/manifest.ts:308-313`; `shared/src/lib/types/rpc/rpc-memory.types.ts:100-135`; `shared/src/lib/types/rpc.types.ts:1693-1715,3470,3706-3720`; `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:80-105` | Restore and list methods follow `memory:purgeJunk`                                                                                                      |
| `ptah interact` exposes any registered RPC as `rpc.call { method, params }`                                                                                                       | `apps/ptah-cli/src/cli/commands/interact.ts:546-558`                                                                                                                                                                                                                                                                                                  | The restore RPC is reachable from the CLI without a new subcommand                                                                                      |
| Harness precedent: an offline tool under `scripts/` with its own jest config; Track A used gitignored scratch harnesses                                                           | `scripts/drain-observation-queue.ts:1-60`, `scripts/jest.config.ts`; `track-a-retrieval-measurement.md:104`                                                                                                                                                                                                                                           | Harnesses are evidence artifacts, not product (component 9)                                                                                             |

EXPLAIN QUERY PLAN and timings were measured on a scratch copy with both quarantine columns added
(`eqp.mjs`). All results are Verified:

- `findMergeCandidates` with `AND m.quarantined_at IS NULL` still uses
  `SEARCH m USING INDEX idx_memories_ws_normalized_subject (workspace_root=? AND <expr>=?)`. The
  plan is identical to main's, and the warm median is 0.25 ms on main and 0.27 ms with the
  predicate (30 runs, `D:\projects\ptah-extension`, `commitlint-scope-enum`).
- The archive and delete-archived selects with the predicate still use
  `idx_memories_tier_last_used` and `idx_memories_tier_archived`, plus `idx_corpus_mem_memory`.
- The BM25 query with a mandatory join to `memories` uses `sqlite_autoindex_memories_1 (id=?)`.
- `ALTER TABLE … ADD COLUMN` × 2 took 66 ms. Applying rules took at most 668 ms, measured with an earlier and heavier draft of the rules (the final R4 update touches 89 rows), and `integrity_check`
  stayed `ok`.

## Architecture decision

- **Chosen approach:**
  - **M4:** rewrite the text of `EXTRACT_SYSTEM_PROMPT` only. The schema, the user prompt and the
    parse stay unchanged. Delete the dead memory-curator copy.
  - **M3:** add a new `MergeCandidateCollector`, constructed inside `MemoryCuratorService`, that
    returns tier 1 (the unchanged `findMergeCandidates`) followed by bounded tier-2 hits from
    `MemorySearchService.searchRich` under an exact workspace scope. Add a merge-target guard in
    the service. Change the resolve prompt so that a semantic match inside the candidate list is a
    valid merge.
  - **M5:** add a nullable `quarantined_at` column and a `quarantine_reason` column (migration
    `0048`). Apply the sampled R4 rule once (migration `0049`: commitlint facts that mention scope; `quarantine-rules.md` r2 §6). Add `quarantined_at IS NULL` to
    every read path that returns memory content, to merge, to usage and pin writes, and to all
    lifecycle SQL. Provide restore and list as `MemoryStore` operations exposed through two new
    RPC methods.
- **Rationale:**
  - A column rather than a status keeps the migration metadata-only: nullable `ADD COLUMN`, with
    no rewrite and no default backfill. The flag cannot be confused with `tier`, which the 443
    lifecycle owns, so the non-functional requirement "not implemented by writing
    salience/tier/archived_at" holds by construction.
  - The quarantine timestamp and reason make restore by rule possible.
  - The rules live in a migration, following the 0039 precedent: a one-time, static,
    production-reachable application on every host. Its safety rests on the rules touching only
    the two new columns, and on restore through RPC. It does not rest on the runner's best-effort
    backup.
  - Tier 2 reuses the hybrid search already running in process (the "R2" analysis, which is not a quarantine rule, at
    `../TASK_2026_471_b3d1/implementation-plan.md:185-199`), so it adds no new dependency.
- **Rejected alternatives:**
  - **A `status` text column with a CHECK constraint.** Same filter cost, but it adds a second
    state vocabulary beside `tier`, and it loses the timestamp.
  - **Applying the rules at runtime inside `MemoryRetentionService.run`.** This is the "new
    retention gate or step" the non-functional requirement forbids. It would also re-evaluate
    heuristics on every run.
  - **An operator-only rule command.** Production would stay dirty until someone runs it, and the
    user asked for the fix at the source.
  - **Filtering inside `MemoryStore.getById`.** It would hide rows from restore, admin get and the
    merge guard's own diagnostics. The filter belongs in the list and search SQL.
  - **Adding `quarantinedAt` to the `Memory` domain type.** It would ripple into every `Memory`
    literal across libraries. A dedicated `getMergeTarget` read is narrower.
  - **Tier 2 as a new port or interface.** There is one implementation and no second consumer, so
    the concrete `MemorySearchService` is injected, as `KnowledgeAgentService` already does.
  - **A separate `MemoryQuarantineStore`.** Restore has to bump `MemoryStore`'s write counters
    (`memory.store.ts:141,163-179`), and every existing write on `memories` lives in `MemoryStore`
    and bumps its own counters (`setPinned` `:515-521`, `forget` `:523-527`). Splitting it out
    would add cross-store coupling for no gain.
- **Assumptions:** each is labelled at its component, with the check that resolves it.
- **Effect on existing code:**
  - Nothing is replaced wholesale.
  - Tier 1, migration 0046, `fts-query.util.ts` and salience ranking stay unchanged.
  - Lifecycle behaviour for rows that are not quarantined is unchanged. The 443 specs keep their
    expectations; only the shared fixture's migration list grows.
  - One dead file is deleted.

### Decisions for the user at Gate 2 (made here, visible at the plan stop)

1. **D1: the rules are applied automatically by migration 0049** at the next app start on every
   host. The result is 89 rows on the copy (0.33%, one r2 rule: commitlint scope facts), all restorable
   through
   `memory:restoreQuarantined`, for named workspaces and the NULL workspace alike.
   - Safety does not depend on a backup. The runner's pre-migration backup is best-effort: it is
     skipped when no backup service is wired, and a failure is non-fatal
     (`migration-runner.ts:88-104`).
   - Safety rests on three facts: 0049 writes only the two new columns, and never deletes or
     changes any pre-existing column; restore is exact inside the upgraded schema; and the rules
     are sampled with 0 durable rows caught.
   - A code downgrade after 0049 is refused by the forward-only runner. The only way back to older
     code is a backup, if one exists.
   - Striking D1 turns 0049 into an operator RPC instead.
2. **D2: the public RPC contract grows by two methods**, `memory:listQuarantined` and
   `memory:restoreQuarantined`. They need edits to `shared`, `rpc-handlers` and the VS Code
   surface spec. Their commit uses scope `fix(rpc-handlers)`, which `.commitlintrc.json` allows.
   That scope is outside the three the user named.
3. **D3: the resolve prompt (agent-sdk) changes as part of M3.** Without the change, tier-2
   candidates with different subjects are rarely merged, because the prompt at
   `resolve-prompt.ts:22` says "Prefer mergeTargetId when subjects match". The guard also makes a
   tool-found id outside the list ineligible, which the prompt must say.
4. **D4: tier 2 and M3 criterion 4 conflict. The user chooses A or B at Gate 2.**

   **The conflict.** Tier 2 itself calls nothing remote. But main makes no resolve LLM call when
   `related` is empty (`sdk-internal-query.curator-llm.ts:360-362`), and a tier-2 hit turns such a
   pass into a remote resolve call (`:363-368`).

   **How often that happens.** This is a proxy on the copy (`passes.mjs`): the last 30 days in
   `D:\projects\ptah-extension`, with rows grouped by session and minute as pseudo-passes.
   - 1,651 pseudo-passes, 6.5 drafts per pass on average
   - 16.6% of drafts have an exact-subject tier-1 hit
   - **48.6% of passes have an empty tier 1**

   | Option                                                                                | What it does                                                                                                                                                                            | Cost envelope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Effect on M3 criterion 4                                                                                                 | Expected effect on the merge gate (M3 criterion 8)                                                                                                                                                                                                                                                                              |
   | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **A**: accept the extra calls                                                         | Tier 2 runs in every pass                                                                                                                                                               | At most **1 extra resolve call per pass**, because resolve is one call per pass and its queue-timeout retries are unchanged. On the proxy, about 49% of passes, about 27 extra calls a day at the observed 55 passes a day. Each call is about 3k to 6k input tokens (a 2 KB system prompt, about 6.5 drafts at about 200 tokens, and at most 25 tier-2 rows at about 100 tokens) plus about 1.3k output tokens, on the `haiku` tier, with at most `CURATOR_MAX_TURNS` = 6 turns. That is about 80k to 160k input tokens a day. | **Not met as written.** It needs the user's explicit approval of this envelope. The plan does not mark M3.4 met under A. | Tier 2 reaches every draft, so the best chance of meeting 8(a) and 8(b)                                                                                                                                                                                                                                                         |
   | **B** (recommended, because it keeps the user's words "No new network calls"): strict | The collector runs tier 2 **only when tier 1 is non-empty**. When tier 1 is empty it returns `[]` and sets `tier2Skipped: 'tier1-empty'`, so resolve short-circuits exactly as on main. | Zero extra resolve calls. Tier 2 adds only local work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Met.** No pass makes a resolve call that main would not make.                                                          | 8(a) still improves: the `commitlint-scope-enum` draft has exact tier-1 rows, so tier 2 runs and reaches other family subjects. 8(b) improves only for replay drafts whose pass has a tier-1 hit. With one draft per replay pass, singleton-subject drafts get no tier 2, **so the 8(b) gate is at risk and may fail under B.** |

   **Timing (r2):** at Gate 2 the user decides on the proxy estimates above only. No experiment
   runs before the gate. The replay measures **both** A and B on the same attempted set during
   testing, to validate the choice (measurement plan). If the measured numbers contradict the
   estimate, the choice goes back to the user. The Gate 2 answer selects the one line in
   `MergeCandidateCollector.collect` that implements B. There is
   no runtime switch; the implementer builds only the chosen behaviour. Until the user answers, the
   implementation follows B.

### Gate 2 decisions (user-approved 2026-09-26)

| Decision                                                                | Outcome        | Consequence for the implementation                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1: rules applied automatically by migration 0049                       | **Approved**   | 0049 applies R4 once on every host at boot (89 rows on the copy), restorable through `memory:restoreQuarantined`                                                                                                              |
| D2: two new RPC methods; commit scope `fix(rpc-handlers)`               | **Approved**   | Component 8 lands as the `fix(rpc-handlers)` batch                                                                                                                                                                            |
| D3: the resolve prompt changes as part of M3                            | **Approved**   | Component 2 is in the `{1+2}` agent-sdk batch                                                                                                                                                                                 |
| D4: tier 2 and M3 criterion 4                                           | **B (strict)** | `MergeCandidateCollector.collect` skips tier 2 when tier 1 is empty (step 3). M3 criterion 4 holds. The replay still measures A and B during testing. If B fails gate 8(b), that is reported in `test-report.md`, not hidden. |
| R4 policy for commitlint workflow lessons (`quarantine-rules.md` r2 §6) | **Accepted**   | A commitlint _fact_ that mentions scope is quarantined even when it holds a workflow lesson. It stays restorable.                                                                                                             |

## Component specifications

### 1. Extract prompt (M4)

- **Purpose:** make extraction emit durable drafts under stable, reusable subjects.
- **Responsibilities:** only the text of `EXTRACT_SYSTEM_PROMPT`.
  - The JSON schema block and field list stay byte-identical (M4 criterion 5).
  - `buildExtractUserPrompt` stays unchanged.
  - The TOOLS section stays and is strengthened (M4 criterion 2).
- **Text contract.** The implementer may use this verbatim.
  - Replace the opening sentence with: "extract only DURABLE knowledge — facts, decisions,
    preferences and lessons that will still be true and useful in a future, unrelated
    conversation."
  - Kind lines:
    - `"event"`: "a past occurrence that changes how future work must be done (e.g., a data
      migration that renamed a column). Never a status report."
    - `"entity"`: "a named component, file or person the user keeps referencing."
    - `"fact"` adds "root cause".
    - `"preference"` adds "workflow".
  - `"subject"` line: "the stable topic key the memory is about — see SUBJECTS."
  - `"content"` adds "true without the transcript".
  - New section **SUBJECTS**:
    - lowercase kebab-case, 2 to 5 words, naming the specific topic, e.g.
      `"sqlite-migration-conventions"`, `"memory-merge-candidates"`,
      `"embedder-worker-lifecycle"`, `"commit-message-preferences"`,
      `"provider-auth-fallback"`
    - before choosing a subject, search existing memories (`mcp__ptah__ptah_memory_search`), and
      if one covers the topic, reuse its subject key EXACTLY and never invent a variant spelling
    - never a bare repository, product, app or service name (those collect unrelated facts)
    - never a task id, ticket, PR or batch number, branch or worktree name, date or commit hash
  - New section **DO NOT EXTRACT (return fewer memories, or an empty "memories" array)**, naming
    the three classes of the rubric in `quarantine-rules.md` §2:
    1. Transient events: PR, CI or check status; commits pushed, merged or rebased; review
       verdicts or scores; agent timeouts, rosters or lane assignments; test counts; any one-off
       run outcome or measurement.
    2. Task, worktree or branch chatter: `TASK_YYYY_NNN` progress, batch or wave numbers, plan
       approvals, worktree paths or layout, branch names or sync state.
    3. Restatements of rules already stored in the repository: commitlint scopes or
       commit-message rules, lint, tsconfig or CI settings, package versions, or any config file's
       contents. The file is the source of truth.

    Follow the list with: "If such a passage contains a real lesson or root cause, extract only
    that lesson under its topic subject, without the task id, PR number, commit hash or date." Keep
    the existing "skip transient chit-chat, code that is already in the repo, and anything private
    to a single message".

  - TOOLS: keep `:36-49`. Rewrite the memory-search bullet as "search before choosing a subject;
    reuse the exact subject key of the best-matching existing memory; do not re-extract what is
    already remembered".
- **Duplicate:** delete `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts`.
  - Verified that it has no importer (grep above).
  - The implementer re-runs `ptah_lsp_references` on `EXTRACT_SYSTEM_PROMPT` at that file's line 9
    before deleting. It must return only the declaration.
  - `clamp-transcript.ts:26` mentions the constant in prose. That still names the agent-sdk
    constant, so no edit is needed.
- **Verified contracts and entry points:** `extract-prompt.ts:1-53`;
  `sdk-internal-query.curator-llm.ts:294-299`; `extract.schema.ts` (unchanged).
- **Dependencies:** none new.
- **Integration points:** `SdkInternalQueryCuratorLlm.extract` passes the constant as
  `systemPromptAppend` (`:294-296` to `:417-421`).
- **Failure behaviour:** unchanged. A model that returns `{"memories": []}` is a clean empty run
  (`:344`).
- **Quality requirements:** the prompt must stay within the curator's small turn budget, so no
  added tool calls are demanded beyond one search. M4 criteria 1 to 4 are asserted by a spec.
- **Verification seam:**
  - New `curator-llm-adapter/extract-prompt.spec.ts` asserts:
    - no `"auth-service"` and no `"ptah"` subject example
    - the reuse rule and `mcp__ptah__ptah_memory_search` are present
    - the three class headings are present
    - the final-JSON rule is intact
    - the schema field list equals a frozen copy of the base list
  - Reachability: `sdk-internal-query.curator-llm.spec.ts` adds one assertion that the
    `systemPromptAppend` passed to `internalQuery.execute` on `extract` is exactly the imported
    `EXTRACT_SYSTEM_PROMPT` and contains `DO NOT EXTRACT`. The mocked `execute` is at `:159`. That
    spec fails if the adapter stops passing the new prompt.
  - M4 criteria 6 to 8 are covered by the harness in component 9.
- **Files:**
  - MODIFY `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts`
  - CREATE `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.spec.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts`
  - DELETE `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts`

### 2. Resolve prompt (M3, Decision D3)

- **Purpose:** let the resolve model merge a draft into a differently worded candidate that states
  the same thing, and only into a listed candidate.
- **Responsibilities:** only the text of `RESOLVE_SYSTEM_PROMPT`. The JSON block and
  `buildResolveUserPrompt` stay unchanged.
- **Text contract:**
  - Replace `:22` with: "Set mergeTargetId to the id of an Existing memory when the candidate
    states the same fact, decision or preference about the same topic, even when the subjects are
    worded differently (e.g. "commitlint-scopes" and "commit-scope-rules"). Two different facts
    that only share a topic are not a merge. Use only an id that appears in the Existing list; any
    other id is ignored and the candidate is stored as new. If unsure, set null."
  - TOOLS (`:26-32`): keep the tool line, and replace "a wider search can surface the memory a
    candidate really refines" with "a wider search can help you judge whether a candidate is new,
    but only memories in the Existing list can be merge targets".
- **Verified contracts:** `resolve-prompt.ts:1-52`; used at `sdk-internal-query.curator-llm.ts:363-368`.
- **Failure behaviour:** unchanged. The parse fallback stores the drafts unmerged (`:548-567`).
- **Verification seam:** new `curator-llm-adapter/resolve-prompt.spec.ts` asserts:
  - the "subjects match (case-insensitive)" sentence is gone
  - the Existing-list-only rule is present
  - the JSON block is unchanged
- **Reachability:** `sdk-internal-query.curator-llm.spec.ts` asserts that `resolve` passes
  `RESOLVE_SYSTEM_PROMPT` as `systemPromptAppend`, and that the text contains
  "only memories in the Existing list". That spec file is shared with component 1, so **components
  1 and 2 form one batch** (r1, finding 5).
- **Files:**
  - MODIFY `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts`
  - CREATE `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.spec.ts`
  - The resolve assertion goes in `sdk-internal-query.curator-llm.spec.ts`, which component 1 lists;
    the one batch owns it.

### 3. Quarantine schema and rule migrations (M5)

- **Purpose:** add the quarantine state (0048), and apply the sampled R4 rule once (0049).
- **0048 `0048_memory_quarantine`:**
  - Plain `sql`:
    ```sql
    ALTER TABLE memories ADD COLUMN quarantined_at INTEGER;
    ALTER TABLE memories ADD COLUMN quarantine_reason TEXT;
    ```
  - Both columns are nullable with no default, so no rows are rewritten.
  - No index. Listing and restore scan about 27k rows, and every hot query keeps its existing index
    (EQP above). A partial index was measured at 195 ms and is not needed.
  - The header comment follows `0047_memory_retention_health.ts:1-11`: what is added, "NOT
    IDEMPOTENT: bare ADD COLUMN relies on the runner's exactly-once bookkeeping", and the SECURITY
    line.
- **0049 `0049_memory_sediment_quarantine`:**
  - Plain `sql`: one `UPDATE memories SET quarantined_at = CAST(strftime('%s','now') AS INTEGER) * 1000, quarantine_reason = 'rule:<name>' WHERE <guard> AND <rule>`
    statement, with `rule:<name>` = `rule:commitlint-scope-facts`. It is the only statement in 0049.
  - `<guard>` is the common guard and `<rule>` is the R4 predicate, both copied verbatim from
    `quarantine-rules.md` r2 §5 and §6:
    - `<guard>`: `pinned = 0 AND tier <> 'core' AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = memories.id) AND quarantined_at IS NULL`
    - `<rule>`: `kind = 'fact' AND TRIM(LOWER(subject)) LIKE '%commitlint%' AND LOWER(content) LIKE '%scope%'`
    - Use no table alias.
    - No other rule, and no event predicate, is part of 0049.
  - The rule is **not** workspace-scoped, so NULL-workspace rows can be quarantined. Component 8
    restores them.
  - The header comment summarises the sample, cites `quarantine-rules.md`, and states:
    - reversible
    - touches only the two new columns
    - no DELETE
    - idempotent through `quarantined_at IS NULL`
    - the security line
- **Registration:** import both in `migrations/index.ts` and append
  `{ version: 48, name: '0048_memory_quarantine', sql }` and the same shape for 49.
- **Ratchet:** in the specs for 0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043, 0044, 0046 and
  0047, change `toBe(47)` to `toBe(49)`, and add a comment line
  `// 48 and 49 since TASK_2026_563 appended 0048_memory_quarantine and 0049_memory_sediment_quarantine.`,
  following `0030_skill_event_metrics.spec.ts:30-37`.

  These are registry-ceiling assertions, not lifecycle behaviour. The 0044 spec's lifecycle
  assertions are untouched, so this is consistent with M5 criterion 9(d).

- **Verified contracts:** `Migration` interface `index.ts:78` (the `MIGRATIONS` array starts at
  `:127`); runner `migration-runner.ts:65-158`; the 0039 data-migration precedent.
- **Dependencies:** `corpus_memories` from 0018. `kind`, `pinned`, `tier` and `content` exist since
  0002/0017. The columns come from 0048.
- **Failure behaviour:** a failing statement rolls back that migration's transaction, and the
  runner does not record the version, so the next boot retries it. The runner's pre-migration
  backup (`migration-runner.ts:88-104`) is best-effort, not guaranteed. It is skipped without a
  backup service, and a backup failure is non-fatal. It is therefore not relied on.
- **Quality requirements:** static SQL (lint rule `no-template-curly-in-migration`). Boot cost on
  the copy: 66 ms plus under 668 ms, once. 668 ms was measured for the heavier r0 rule set; the r1
  set is a subset of it.
- **Verification seam:**
  - `0048_memory_quarantine.spec.ts`:
    - the registry entry shape
    - columns exist and are NULL for pre-existing rows
    - no `${`
    - an EQP on the `findMergeCandidates` SQL with the predicate still names
      `idx_memories_ws_normalized_subject`, following `0046_memory_merge_subject_index.spec.ts:40-80`
  - `0049_memory_sediment_quarantine.spec.ts` seeds **every durable, guard and positive fixture**
    in `quarantine-rules.md` r2 §6:
    - **2 positive** (R4 scope facts, one of them with a NULL workspace). Both must be quarantined.
    - **13 durable.** Among them are the seven reviewer counterexamples from r1 and r2, the
      `codex.resumeThread` row, a `pr-NNN` behaviour event, a task-subject fact, two commitlint
      preferences, and a commitlint fact without the word scope.
    - **3 guard** (corpus-linked, pinned, core).

    It then applies 0048 and 0049 and asserts:
    - only the positive fixtures are quarantined, with reason `rule:commitlint-scope-facts`
    - every durable and guard fixture stays NULL, including every event row, because r2 has no
      event rule
    - a second application changes nothing
    - `memory_chunks`, `memory_chunks_fts_docsize` and `memory_concepts_fts` counts are unchanged

    It runs on both drivers.
- **Files:**
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0048_memory_quarantine.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0048_memory_quarantine.spec.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0049_memory_sediment_quarantine.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0049_memory_sediment_quarantine.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
  - MODIFY the migration specs `0028_gateway_conversation_workspace_root.spec.ts`,
    `0030_skill_event_metrics.spec.ts`, `0038_gateway_message_turn_state.spec.ts`,
    `0039_reap_orphaned_queue_rows.spec.ts`, `0040_skill_candidate_workspace_root.spec.ts`,
    `0041_skill_md_migration_state.spec.ts`, `0042_db_integrity_check_state.spec.ts`,
    `0043_memory_retention.spec.ts`, `0044_memory_lifecycle.spec.ts`,
    `0046_memory_merge_subject_index.spec.ts` and `0047_memory_retention_health.spec.ts`, all in the
    same folder

### 4. MemoryStore quarantine awareness, restore and list (M5, plus the M3 guard read)

- **Purpose:** exclude quarantined rows from store-level reads, freeze their mutable fields, and
  provide restore, list and the merge-target read.
- **Responsibilities** (all in `memory.store.ts`):
  - **Add `m.quarantined_at IS NULL`** (or the unaliased form) to:
    - `findMergeCandidates` `:378-381`, inside the `candidates` CTE `WHERE`
    - `list` `:420-438` (both the count and the page)
    - `listAll` `:462-491` (both)
    - `stats` `:743-771`, both the tier counts and `MAX(updated_at)`. With `workspaceRoot`
      undefined, the WHERE becomes `WHERE quarantined_at IS NULL`.
  - **Freeze writes:**
    - `recordUse` `:630-637`: add `AND quarantined_at IS NULL` to the UPDATE, and to the
      archival-roots SELECT at `:622-628`.
    - `setPinned` `:517-519`: `WHERE id = ? AND quarantined_at IS NULL`. The counter bump stays.
  - **New `getMergeTarget(id: MemoryId, workspaceRoot: string | null): MemoryId | null`:**
    `SELECT id FROM memories WHERE id = ? AND workspace_root IS ? AND quarantined_at IS NULL`.
  - **New `getActiveById(id: MemoryId): Memory | null`** (r1, finding 2):
    `SELECT * FROM memories WHERE id = ? AND quarantined_at IS NULL`, mapped through `rowToMemory`.
    It is the content-facing lookup that `memory:get` uses.
  - **New `listQuarantined(filter: { workspaceRoot: string | null | undefined; reason?: string; limit?: number; offset?: number }): QuarantinedMemoryPage`:**
    - Rows: `{ id, workspaceRoot, subject, kind, tier, reason, quarantinedAt, excerpt (content first 200 chars) }`
      plus `total`, ordered by `quarantined_at DESC, id DESC`. `workspaceRoot` (string or null) is
      returned per row, so an all-scope listing can be routed back to a scoped restore (r1,
      finding 3).
    - Limit clamp `[1, 500]` as in `list`.
    - `workspaceRoot` uses the tri-state of `stats` (`:727-742`).
  - **New `restoreQuarantined(selector: { ids: readonly string[] } | { reason: string } | { all: true }, workspaceRoot: string | null): { restored: number }`:**
    - One transaction:
      `UPDATE memories SET quarantined_at = NULL, quarantine_reason = NULL WHERE quarantined_at IS NOT NULL AND workspace_root IS @ws AND <selector>`
    - The ids selector goes through `json_each(@ids)`, capped at 500 ids, as `recordUse` does at
      `:616-626`.
    - Then `markWorkspacesChanged([ws])` (`:164-173`), so cached searches cannot hide restored rows.
    - It touches no other column, so `salience`, `tier`, `archived_at`, `pinned`, `hits`,
      `last_used_at`, chunks, FTS and vectors come back exactly as they were (M5 criterion 6).
    - It is idempotent: restoring an active row matches nothing (M5 criterion 7).
    - `workspaceRoot: null` means exactly `workspace_root IS NULL`. There is no "all workspaces"
      form: a caller restores one scope at a time.
  - **Leave unchanged (decided):**
    - `getById` `:329-335`: the raw identity lookup, kept for `lookupMemory` (which runs after the
      SQL filter) and for diagnostics. `memory:get` no longer uses it; it uses `getActiveById`.
    - `findBySubjectAndTier` `:337-344`: wizard seed upsert. Rules never target seeded rows.
    - `forget`, `deleteBySubjectPrefix` and `purgeBySubjectPattern` `:523-606`: explicit user
      deletes stay authoritative. They are not quarantine operations.
    - `rebuildIndex` and `rebuildConceptsIndex` `:789-833`: index maintenance must keep the
      entries of quarantined rows so restore is exact.
    - `all()` `:774-779`: no production caller (grep).
    - `appendChunks` `:651-725`: guarded by the caller through `getMergeTarget`.
- **Types:** `QuarantinedMemoryRow` and `QuarantinedMemoryPage` in `memory.types.ts`. Export them
  from `src/index.ts` next to `MemoryListResponse`. The barrel is 217 lines today, which is already
  over the 150-line rule, and this adds 2 lines to an existing grouped `export type` block. That is
  recorded; it does not justify a split in this task.
- **Corpus members:** `knowledge-agents/corpus.store.ts:311-315` adds
  `AND m.quarantined_at IS NULL`. This covers `corpus:query`/`prime`, which return member content
  to agents. Corpus-linked rows are never quarantined by the rules (guard), so this is defence in
  depth.
- **Verified contracts:** as cited per method. `IMemoryLister.listAll` in
  `@ptah-extension/memory-contracts` is unchanged in shape.
- **Dependencies:** `SqliteConnectionService` (existing), and the columns from component 3.
- **Integration points:**
  - `listAll` feeds session-start injection (`agent-sdk/src/lib/helpers/memory-prompt-injector.ts:217`)
    and the agent namespace `list` (`vscode-lm-tools/.../memory-namespace.builder.ts:270`).
  - `list` feeds `memory:list` (`memory-rpc.handlers.ts:200`).
  - `stats` feeds `memory:stats` (`:349`).
- **Failure behaviour:**
  - SQL errors propagate as today. For example, `recordUse` keeps its warn-and-continue
    (`:643-647`).
  - `restoreQuarantined` runs in a transaction and calls `handleFatalWriteError`, as
    `insertMemoryWithChunks` does at `:304-307`.
- **Quality requirements:** parameterised SQL only.
- **Verification seam:** `memory.store.spec.ts`, one case per changed method:
  - exclusion
  - freeze of `hits`, `last_used_at`, `tier`, `archived_at` and `pinned` under `recordUse` and
    `setPinned`
  - restore by ids, by reason and all
  - restore for a **named** workspace and for the **NULL** workspace, with a NULL-scope restore
    leaving named-workspace rows quarantined, and the reverse
  - `getActiveById` returns null for a quarantined row, and the row again after restore
  - `listQuarantined` returns `workspaceRoot` per row
  - workspace scoping
  - idempotence
  - counter bump
  - `getMergeTarget` for a missing row, another workspace, and a quarantined row

  The hand-written `CREATE TABLE memories` fixtures at `memory.store.spec.ts:1289,1567` gain the
  two columns. `corpus.store` spec: a quarantined member is excluded.

- **Files:**
  - MODIFY `libs/backend/memory-curator/src/lib/memory.store.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/memory.store.spec.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/memory.types.ts`
  - MODIFY `libs/backend/memory-curator/src/index.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/knowledge-agents/corpus.store.ts` and its spec
    (Assumption: `corpus.store.spec.ts` exists beside it. If it does not, CREATE it.)

### 5. Lifecycle exclusion (M5 criterion 9)

- **Purpose:** the 443 lifecycle never archives, deletes or evicts a quarantined row, and never
  counts one toward the cap.
- **Responsibilities:** add `AND m.quarantined_at IS NULL` (or the unaliased
  `AND quarantined_at IS NULL`) to every constant in `memory-lifecycle.store.ts`:
  - `DELETE_ARCHIVED_SELECT_SQL` `:12-15`
  - `ARCHIVE_SELECT_SQL` `:17-20`
  - `ARCHIVE_UPDATE_SQL` `:22-23`
  - `OVER_CAP_SQL` `:25-31` (the cap count, criterion 9(c))
  - `EVICT_ARCHIVAL_SELECT_SQL` `:33-37`
  - `EVICT_RECALL_SELECT_SQL` `:39-42`
  - the inner select of `DELETE_CHUNKS_SQL` `:44-47`
  - `DELETE_MEMORIES_SQL` `:49-50`
  - `ARCHIVE_COUNT_SQL` `:55-57`
  - `DELETE_COUNT_SQL` `:59-61`

  The DELETE predicates are defence in depth: even a wrong id list cannot delete a quarantined row
  or its chunks. The FTS and vector entries follow the chunk triggers, so they are protected too.

- **Mechanism choice:** predicates only. No service change, no new gate, and `runStep` is
  untouched (`memory-lifecycle.service.ts:80-210`).
- **Fixture:** `retention-sqlite.test-support.ts:219-221` adds 48 to the `memorySchema` version
  list (`[2, 7, 10, 15, 16, 17, 18, 19, 43, 44, 47, 48]`). This is a helper, not a spec
  expectation.
- **Verified contracts:** the plan-pinning spec `memory-lifecycle.store.spec.ts:56-96` stays green,
  as EQP showed. `contains no salience update` (`:325-329`) stays green.
- **Failure behaviour:** unchanged (`RetentionStepError` mapping).
- **Verification seam:** new `retention/memory-lifecycle.quarantine.spec.ts` covers M5 criterion
  10 on both drivers. It seeds, all quarantined:
  - an archival row past grace
  - a recall row past the unused cutoff
  - rows in a workspace over its cap

  It also seeds equal control rows that are not quarantined. It runs one
  `MemoryLifecycleService.runStep` pass with real stores, then asserts:
  - the quarantined rows and their chunks still exist
  - `tier` and `archived_at` are unchanged
  - the controls are archived, deleted or evicted exactly as the existing 443 specs expect
  - `readPreview.overCap` excludes quarantined rows

  It then restores, asserts the pre-quarantine values, and runs a second pass to show the restored
  rows are eligible again. The existing lifecycle and retention specs pass unedited (criterion
  9(d)).

- **Files:**
  - MODIFY `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/retention/retention-sqlite.test-support.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.quarantine.spec.ts`

### 6. MemorySearchService: exact scope and quarantine filter (M3 and M5)

- **Purpose:**
  - Give `searchRich` an exact null-workspace scope, needed by tier 2 (M3 criterion 3).
  - Exclude quarantined rows from every search and index read path (M5 criterion 5).
- **Responsibilities:**
  - **Scope.** Change `searchRich(query, topK, workspaceRoot?: string | null)`, and the private
    `searchRichInner`, `bm25Search` and `vecSearch`/`vecSearchInner` the same way, to a tri-state:
    - a non-empty string: `m.workspace_root IS ?`, as today
    - `null`: `m.workspace_root IS NULL`, which is new
    - `undefined` or `''`: no workspace predicate, which is today's behaviour, so the existing
      `search()` callers (`IMemoryReader.search(query, topK, workspaceRoot?: string)`) are
      unaffected
  - **Cache key** (r1, finding 7). `makeCacheKey` (`:209-216`) must encode the tri-state scope and
    the clamped limit (`Math.max(1, Math.min(50, topK))`, `:281`), e.g.
    `${normalizedQuery}|${scopeTag}|${limit}|${counter}` with
    `scopeTag = ws === null ? '\u0000null' : (ws || '*')`.
    - The write counter is looked up by the _actual_ scope, not by the sentinel: `null`, `''` and
      `undefined` all use `getWriteCounter('')`, and a string uses `getWriteCounter(ws)`. That is
      correct because unscoped writes bump `''` (`memory.store.ts:176-179`).
    - Without the limit in the key, the collector's `topK = 5` response and an ordinary
      `topK = 10` search would share a cache entry (`:281-288,363-364`).
  - **Quarantine:**
    - `bm25Search` `:378-414` always joins `memories m` (the join is no longer conditional) and
      adds `AND m.quarantined_at IS NULL`.
    - `vecSearchInner` `:445-453` adds the same predicate.
    - `buildFilterClause` `:754-808` always pushes `m.quarantined_at IS NULL`. That covers
      `listIndexRowsByFilter` `:810-832` and `fetchCompactRowsByIds` `:834-857`, the final fetch.
    - **Upstream** (r1, finding 8): `bm25SearchByMemory` `:859-897` always joins `memories m` and
      adds `AND m.quarantined_at IS NULL` before its `LIMIT`, so quarantined hits cannot take BM25
      slots. `vecSearchByMemory` `:915-925` always joins and adds the same predicate on its
      chunk-to-memory resolution.
    - `timeline` `:626-673`: return `{ rows: [], anchorIndex: 0 }` if the anchor is quarantined,
      and add the predicate to the before and after queries.
    - `getObservations` `:686-693` adds `AND quarantined_at IS NULL`.
- **Known trade-off, accepted for both `searchRich` and `searchIndex`:**
  - The vec0 KNN (`:436-441` and `:907-912`) returns the `limit*4` nearest chunks _before_ any SQL
    predicate can apply. vec0 KNN cannot take a join filter. Quarantined chunks, like
    other-workspace chunks today, can take those slots, and fewer vector candidates survive the
    join.
  - BM25 is filtered upstream in both paths, so a query with active lexical matches still returns
    them. No quarantined row is ever returned.
  - Bounded refill is not added: it would mean repeated KNN rounds per query on the hot path.
  - The tester measures the effect on the copy: for Q1 to Q4 and the 8(a) draft, the vector
    candidates that survive the join, before and after 0049. On the copy, the quarantined memories own 89 of
    29,447 chunk rows (measured). A corpus-wide share does not bound local top-K crowding, so the
    per-query measurement is what counts. The numbers go in `test-report.md`.
- **Verified contracts:** `MemorySearchService` is exported (`src/index.ts`). Callers:
  - `memory-rpc.handlers.ts:224` (`searchRich`)
  - `mem-rpc.handlers.ts:76,115,151` (`searchIndex`, `timeline`, `getObservations`)
  - `knowledge-agent.service.ts:212` (`searchIndex`)
  - `IMemoryReader.search` consumers: `memory-prompt-injector.ts:110`,
    `memory-namespace.builder.ts:232` (and through it `ptah_memory_search` at
    `protocol-dispatcher.ts:1794-1822`), and `skill-synthesis/.../skill-gap-curator.service.ts:580`
- **Failure behaviour:** unchanged. BM25 errors give `[]` with a warning (`:406-413`). Vector
  errors give BM25-only (`:295-305`). Reranker errors keep RRF order (`:331-338`).
- **Quality requirements:** no new query per call. Only a join exists that did not before in the
  unscoped BM25 case.
- **Verification seam:** `memory-search.service.spec.ts`. The mock-SQL tests keep working; any
  expectation that inspects SQL text is updated. New real-SQLite cases on both drivers (seeded
  through `retention-sqlite.test-support` with `memorySchema: true`):
  - A null scope returns only NULL-workspace rows, while `undefined` returns all.
  - The cache does not leak between `null` and `undefined`.
  - The same query and scope with `topK` 5 and then 10 return 5 and 10 hits (a cache-key spec).
  - After `restoreQuarantined`, a cached query returns the restored row, because the counter was
    bumped.
  - `searchIndex` with more quarantined BM25 matches than its limit still returns the active
    matches (upstream filter).
  - Quarantined rows are absent from `search`, `searchRich`, `searchIndex` (query and pure-filter),
    `timeline` and `getObservations`.
  - With no quarantined rows, results are identical to a run without the predicate (predicate
    neutrality only). This does NOT prove equivalence with main: the "main" relevance baseline
    is measured on the base-commit code (see the measurement plan, r4).
- **Files:**
  - MODIFY `libs/backend/memory-curator/src/lib/memory-search.service.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/memory-search.service.spec.ts`

### 7. MergeCandidateCollector and the curator wiring (M3, plus the M5 criterion 8 guard)

- **Purpose:** build the resolve candidate list as tier 1 followed by bounded, workspace-scoped
  tier-2 hits, and refuse any ineligible merge target.
- **New unit** `curator-llm/merge-candidate-collector.ts`, class `MergeCandidateCollector`.
  `MemoryCuratorService` constructs it in its constructor, following `CuratorWindowRunner`
  (`memory-curator.service.ts:195`). It is not injected and not exported from the barrel. The
  harness imports it by path.
  - Constructor: `(logger, store: MemoryStore, search: MemorySearchService | null)`.
  - Exported named constants:
    - `TIER2_PER_DRAFT_LIMIT = 5` (mirrors tier 1's 5 per subject)
    - `TIER2_TOTAL_LIMIT = 25` (the worst-case prompt is 50 + 25 = 75 rows)
    - `TIER2_MAX_QUERIES = 10` (bounds `searchRich` calls, and so embed and rerank work, per pass)
    - `TIER2_QUERY_MAX_CHARS = 512` (equals the reranker's candidate clip,
      `memory-search.service.ts:315`)
  - `collect(drafts, workspaceRoot: string | null | undefined, signal?): Promise<MergeCandidateSet>`
    returns
    `{ candidates: readonly {id, subject, content}[]; tier1Count; tier2Count; tier2Queries; bm25Only: boolean; tier2Skipped: null | 'no-search' | 'blank-workspace' | 'tier1-empty' | 'error'; }`.
  - **Algorithm:**
    1. `tier1 = store.findMergeCandidates(subjects, workspaceRoot ?? null)` when there is at least
       one subject, else `[]`. This is the same call and the same arguments as `:603-612` today.
    2. If `search` is null, or `workspaceRoot === ''`, return tier 1 only and set `tier2Skipped`.
       A blank root has no exact scope, and tier 2 must never widen to all workspaces.
    3. **Decision D4, option B (the default until Gate 2 says otherwise):** if `tier1.length === 0`,
       return `[]` with `tier2Skipped: 'tier1-empty'`. The resolve adapter then short-circuits
       exactly as on main (`sdk-internal-query.curator-llm.ts:360-362`). Under option A, this step
       is omitted. There is no runtime flag.
    4. `scope = workspaceRoot ?? null`, and `seen = new Set(tier1 ids)`.
    5. For each draft in extraction order, while the query count is below `TIER2_MAX_QUERIES`,
       tier 2 holds fewer than `TIER2_TOTAL_LIMIT`, and `signal` is not aborted:
       - The query is `` `${subject ?? ''} ${content}`.trim().slice(0, TIER2_QUERY_MAX_CHARS) ``.
         Subject plus content matches how chunk text is written (chunk text is the content,
         `memory-curator.service.ts:687-692`), and the subject adds the topic words.
       - Call `await search.searchRich(query, TIER2_PER_DRAFT_LIMIT, scope)`.
       - Walk the hits:
         - skip ids already in `seen`
         - skip a hit whose `memory.workspaceRoot !== scope` (defence)
         - take `{ id: hit.memory.id, subject: hit.memory.subject, content: hit.memory.content }`
         - stop at `TIER2_PER_DRAFT_LIMIT` per draft or at the total
       - Set `bm25Only ||= res.bm25Only`.
       - If `searchRich` throws, log once with a warning, set `tier2Skipped = 'error'`, stop
         issuing queries, and keep what was collected. Carry the
         `// degradation-audit: optional-capability - …` marker inside the catch (`HANDOFF.md:64-67`).
    6. Return `[...tier1, ...tier2]`. Tier 1 keeps its order and is never displaced (M3 criterion 1).
  - It never calls `recordUse` and never writes salience (M3 criterion 6). `searchRich` has no
    write path.
- **`MemoryCuratorService` changes:**
  - **Constructor:** append the last parameter
    `@inject(MEMORY_TOKENS.MEMORY_SEARCH, { isOptional: true }) search: MemorySearchService | null = null`,
    after `governor` at `:192-193`, so that positional spec construction stays valid. Then
    `this.mergeCandidates = new MergeCandidateCollector(this.logger, this.store, search)`.
  - **`doCurate`:** replace `:603-612` with
    `const { candidates: related, ...diag } = await this.mergeCandidates.collect(drafts, input.workspaceRoot, input.signal)`.
    Log one debug line with the counts. `resolveWithinBudget` is unchanged.
  - **Guard:** at `:649-664`, build `const candidateIds = new Set(related.map((c) => c.id))`. Merge
    only when all three hold:
    - `r.mergeTargetId` is in `candidateIds`
    - `this.store.getMergeTarget(memoryId(r.mergeTargetId), input.workspaceRoot ?? null)` is
      non-null
    - (which also covers "not quarantined")

    Otherwise, log at info with `{ reason: 'not-in-candidates' | 'ineligible' }` and fall through
    to the existing insert path. `getById` at `:652` is no longer used there.

  - `CuratorRunStats` is unchanged (no wire change).
- **DI and circularity:** `MemorySearchService` depends on `EMBEDDER`, `MEMORY_STORE`,
  `OBSERVATION_QUEUE_STORE`, `VEC_STATUS` and `TRACER` (`memory-search.service.ts:191-203`), none
  of which depend on the curator. Both are registered as singletons in `di/register.ts` (`:96-99`
  and `:162-166`). No registration change.
- **Network calls on the tier-2 path, each shown local:**
  1. **BM25:** `connection.db` SQLite (`memory-search.service.ts:378-414`). Local file.
  2. **Query embedding:** `embedder.embed` goes to `EmbedderWorkerClient` (registered at
     `di/register.ts:61-65`), then the Electron utility process, then the `@huggingface/transformers`
     `feature-extraction` pipeline `Xenova/bge-small-en-v1.5` q8, running ONNX in process
     (`embedder-worker.ts:132-185`).
     - The weights load from `modelCacheDir = ~/.ptah/models` (`apps/ptah-electron/src/di/phase-2-libraries.ts:311-326`).
       Verified present on this machine: `~/.ptah/models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx`.
     - A first-ever load downloads the files. Main already performs that load at boot warmup
       (`wire-runtime.ts:641-649` to `embedder-worker.ts:298-306`) and on every curator insert
       (`memory.store.ts:229-233`).
  3. **Vector KNN:** `memory_chunks_vec` in SQLite (`:436-441`). Local.
  4. **Rerank:** `EmbedderWorkerClient.rerank`, the cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2`
     (`embedder-worker.ts:213-251`), present in `~/.ptah/models/Xenova/`. Main loads it at warmup
     and on every `searchRich` with 5 or more fused rows (`memory-search.service.ts:311-323`),
     e.g. per-turn prompt injection.
  5. **`lookupMemory` to `getById`:** SQLite.

  On VS Code and the CLI, no worker factory is registered (`worker-process.port.ts` doc;
  `di/register.ts:53-58` comment). `embed` throws, `searchRichInner` falls back to BM25-only, and
  rerank is skipped. The network count there is zero.

  The tester proves "local" by running the tier-2 candidate phase of the harness with
  `HTTPS_PROXY=http://127.0.0.1:9` and `HTTP_PROXY` set to the same value, over a copied model
  cache. The embeddings still succeed, which shows that no request was needed.

- **Failure behaviour:**
  - Tier-2 errors never fail, defer or drop the pass (M3 criterion 5). The fallback is "tier 1
    plus whatever tier 2 collected".
  - An abort during tier 2 stops issuing queries. The existing abort handling downstream is
    unchanged.
- **Quality requirements:**
  - Bounded work per pass: at most 10 `searchRich` calls, each with 1 embed, 1 KNN, 2 SQL and a
    rerank over at most 20 candidates.
  - Latency is recorded in `test-report.md` for main and the branch (task risk row 3).
- **Verification seam:**
  - `merge-candidate-collector.spec.ts`:
    - ordering and dedupe (tier 1 first, tier-2 duplicates of tier-1 ids dropped)
    - bounds: 40 drafts with 10 hits each give at most 10 queries and at most 25 tier-2 rows, and
      at most 5 per draft
    - `null` scope is passed as `null`, and `''` skips
    - `bm25Only` is propagated
    - a thrown `searchRich` still returns tier 1 and the tier-2 rows collected before the throw
    - under option B, an empty tier 1 gives `[]`, with `tier2Skipped: 'tier1-empty'` and zero
      `searchRich` calls. Under option A, this case asserts that tier 2 runs instead.
    - abort stops queries
    - no `recordUse` (spy)
  - `memory-curator.service.spec.ts`:
    - the tier-2 source is invoked in a pass
    - a merge target outside the list, one in another workspace, and one that is quarantined are
      each inserted as new
    - salience and `hits` of candidates are unchanged after a pass without a merge
  - **Reachability:** `di/register.spec.ts` gains a case that resolves `MEMORY_TOKENS.MEMORY_CURATOR`
    from `registerPersistenceSqliteServices` plus `registerMemoryCuratorServices` against the real
    temp DB with a stub `CURATOR_LLM`, runs `curate()` once, and asserts the registered
    `MEMORY_SEARCH` singleton's `searchRich` was called with the pass's workspace root. The case
    fails if the injection or the collector call is removed.
  - Production callers of `curate`:
    - PreCompact `memory-curator.service.ts:231-244`
    - `memory-trigger.service.ts:848,998`
    - `memory:runNow` `memory-rpc.handlers.ts:622`
- **Files:**
  - CREATE `libs/backend/memory-curator/src/lib/curator-llm/merge-candidate-collector.ts`
  - CREATE `libs/backend/memory-curator/src/lib/curator-llm/merge-candidate-collector.spec.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/memory-curator.service.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/di/register.spec.ts`

### 8. Restore surface: RPC (M5, Decision D2)

- **Purpose:** a production-reachable way to see and restore quarantined rows.
- **`memory:listQuarantined`**
  - Params: `{ workspaceRoot?: string | null; scope?: MemoryQueryScope; reason?: string; limit?: number; offset?: number }`.
    Read scope is resolved with `resolveReadScope` (`memory-rpc.handlers.ts:185-192`), as
    `memory:stats` does.
  - Result:
    `{ items: { id, workspaceRoot: string | null, subject, kind, tier, reason, quarantinedAt, excerpt }[]; total }`.
    Each row carries its scope, so an all-scope listing can be routed back to a scoped restore.
- **`memory:restoreQuarantined`** (r1, finding 3)
  - Params: `{ workspaceRoot: string | null; ids?: string[]; reason?: string; all?: boolean }`.
  - `workspaceRoot` is a **required key**:
    `z.union([z.string().min(1), z.null()])`, not `.optional()`.
    - An omitted key is `INVALID_PARAMS`, never "current workspace" and never "all".
    - An explicit `null` targets exactly the unscoped rows (`workspace_root IS NULL`). It is not a
      cross-workspace union: there is no all-workspaces restore.
  - The zod schema in `memory-rpc.schema.ts` also requires exactly one selector, at most 500 ids,
    and a `reason` matching `^rule:[a-z0-9-]+$`.
  - **Authorization:**
    - A string must pass `isAuthorizedWorkspace` (`rpc-handlers/src/lib/utils/workspace-authorization.ts:13-22`),
      following the destructive-call precedent at `memory-rpc.handlers.ts:420-439`. Otherwise it
      throws `RpcUserError('UNAUTHORIZED_WORKSPACE')`.
    - `null` has no folder to authorize. It is accepted only as an explicit value, and logged at
      info with `{ scope: 'unscoped' }`.
    - The operation cannot delete or widen anything: it only clears the two quarantine columns
      within that exact scope. That is why the unscoped case is allowed where
      `purgeBySubjectPattern` refuses null.
  - It then calls `store.restoreQuarantined(selector, workspaceRoot)`.
  - Result: `{ restored: number }`. A failure throws `RpcUserError(..., 'PERSISTENCE_UNAVAILABLE')`.
- **`memory:get` content filter** (r1, finding 2): the handler at `memory-rpc.handlers.ts:240-258`
  changes from `store.getById` to `store.getActiveById`.
  - A quarantined id returns `{ memory: null, chunks: [] }`, and records no use.
  - No `includeQuarantined` flag is exposed on this or any agent-reachable method. Operators inspect
    quarantined rows through `memory:listQuarantined`, which gives an excerpt, and restore to read
    them in full.
  - Raw `getById` stays in the store for the merge guard's diagnostics and for `lookupMemory`.
- **No manual quarantine RPC.** The rules are the only quarantine producer, so there is no
  speculative write surface.
- **Wiring:**
  - Append both names to `MemoryRpcHandlers.METHODS` (`:111-127`). The manifest picks them up
    through `methods: MemoryRpcHandlers.METHODS` (`manifest.ts:310`).
  - Add types to `rpc-memory.types.ts`.
  - Add imports, the method map and `RPC_METHOD_ENTRIES` in `rpc.types.ts` (`:377-385`,
    `:1693-1715`, `:3706-3720`).
  - Add both names to the VS Code expected-absent list (`rpc-surface.spec.ts:80-105`), because the
    VS Code host serves no `memory:*` method.
- **CLI:** reachable today through
  `ptah interact` → `{"method":"rpc.call","params":{"method":"memory:restoreQuarantined","params":{…}}}`
  (`interact.ts:546-558`). No new subcommand, which keeps the blast radius small. A later UI or CLI
  surface is a follow-up.
- **Failure behaviour:** zod failure raises `INVALID_PARAMS`. SQL failure raises
  `PERSISTENCE_UNAVAILABLE`, logged without row content.
- **Security:** an explicit scope (an authorized string, or an explicit `null`). Ids and reason are
  bound as parameters. Nothing is deleted.
- **Verification seam:** `memory-rpc.handlers.spec.ts`:
  - validation: zero or two selectors, a bad reason, an unauthorized workspace, and an **omitted**
    `workspaceRoot` key all raise `INVALID_PARAMS` or `UNAUTHORIZED_WORKSPACE`
  - restore passes through to the store for a **named** workspace and for an explicit **null**
    workspace, against a real store: a NULL-workspace quarantined row is restored, and a
    named-workspace row stays quarantined, and the reverse
  - list scope tri-state, with `workspaceRoot` present on every item
  - `memory:get` returns null for a quarantined id and the memory after restore

  The VS Code rpc-surface spec stays partition-green.

- **Files:**
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-memory.types.ts`
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts`
  - MODIFY `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`

### 9. Round-trip spec and measurement harness (verification)

- **Round-trip spec (M5 criterion 6: exactly one spec):**
  `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts`, on both drivers, with real
  SQLite and sqlite-vec.
  1. Seed R4-matching rows in a named workspace and in the NULL workspace, plus active controls and one draft-shaped exact-subject match
     (so that tier 2 runs under D4 option B). The seeds span a named workspace **and** the NULL
     workspace.
  2. Apply migrations 48 and 49 with their production SQL. This is the production quarantine path.
  3. **Corpus member.** The rules never quarantine corpus-linked rows (guard), so after 0049 the
     spec inserts a `corpus_memories` link for one already-quarantined R4 row. This is the state a
     corpus build could only reach before this task, and it is the one the corpus filter defends
     against.
  4. Assert exclusion from:
     - `search`, `searchRich`, `searchIndex`
     - `listAll` (injection)
     - `findMergeCandidates`
     - `MergeCandidateCollector.collect` (tier 2)
     - `timeline`, `getObservations`
     - corpus members
     - **`getActiveById`, the path behind `memory:get`**
  5. Call `MemoryStore.restoreQuarantined({ all: true }, ws)` and then
     `MemoryStore.restoreQuarantined({ all: true }, null)`, the path the RPC calls. Together they
     restore every quarantined row in both scopes (r1, finding 9; after r2 the only rule class is
     R4).
  6. Assert inclusion again on every path in step 4 for **every** restored row in both scopes,
     with content, chunks, subject, salience, tier, `archived_at`, pinned, `hits` and
     `last_used_at` unchanged, and `quarantined_at` and `quarantine_reason` NULL.

  Other specs may test exclusion per path. Only this one walks the whole cycle.

- **Measurement harness:** evidence artifacts, not product. They live in
  `.ptah/specs/TASK_2026_563_2939/harness/`. They are bundled with
  `npx esbuild <file>.ts --bundle --platform=node --tsconfig=tsconfig.base.json --external:better-sqlite3 --external:sqlite-vec --external:@huggingface/transformers --external:@anthropic-ai/claude-agent-sdk --outfile=%TEMP%\mqs-563-eval\<file>.cjs`,
  and run with `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd <file>.cjs`, which loads the
  production `better-sqlite3` ABI (`HANDOFF.md:56-63`). The files:
  - `harness/lib/copy-db.ts`: working copies through the backup API, with fail-if-exists targets
    in `%TEMP%\mqs-563-eval\`. It refuses any path under `%USERPROFILE%\.ptah\state` and any file
    name starting with `ptah`.
  - `harness/lib/connection.ts`: a `{ db }` stand-in for `SqliteConnectionService`, like
    `retention-sqlite.test-support.ts` `adaptSqliteDatabase`.
  - `harness/lib/embedder.ts`: `EmbedderWorkerClient` with a `node:worker_threads`
    `IEmbedderWorkerProcessFactory` over the bundled `embedder-worker.ts`. The worker supports
    `worker_threads` (`embedder-worker.ts:55-83`). `modelCacheDir` is a byte copy of
    `~/.ptah/models/Xenova/{bge-small-en-v1.5,ms-marco-MiniLM-L-6-v2}`.
  - `harness/lib/llm.ts`: builds the real `SdkInternalQueryCuratorLlm` (resolver null, MCP status
    null, workspace stub) over an `InternalQueryService`-shaped stand-in. Its `execute(config)`
    forwards to `@anthropic-ai/claude-agent-sdk` `query()` with `config.model`, `config.maxTurns`,
    `config.cwd`, `config.abortController` and `config.systemPromptAppend` as appended system
    prompt, and returns `{ stream }` (`internal-query.types.ts:29,103-105`).
    - For an "old prompt" run, the stand-in substitutes the base-commit prompt text for the
      `systemPromptAppend` it receives. It first asserts that the received text equals the branch
      constant, so the adapter's `runQuery`, last-message capture and `parseDrafts`/`parseResolved`
      run verbatim in both variants.
    - The old texts are captured with
      `git show ebfc73321:libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts`
      (and `resolve-prompt.ts`) into `%TEMP%\mqs-563-eval\`.
    - **Assumption:** the SDK `query()` option names that match `SdkQueryRunner`'s mapping.
      Resolve it by reading `helpers/sdk-query-runner.service.ts:530-540` and the options block it
      builds.
  - `harness/copy-audit.ts`: M5 migration evidence, rules, Track A relevance, and restore
    equivalence.
  - `harness/merge-replay.ts`: M3 reach, the replay set, and timing.
  - `harness/extract-eval.ts`: M4, old against new.
  - A `harness/README.md` with the exact commands.
- **MCP tools are off in the harness LLM runs**, for both prompt variants. With the real Ptah MCP
  server, `ptah_memory_search` would search the live database and record usage there
  (`memory-namespace.builder.ts:232-235`), which the task forbids. The reuse-by-search lever of the
  new prompt is therefore not exercised. The M4 run is a **prompt-only, limited evaluation**, not a
  proven lower bound: turning search off can change the model's behaviour and recall in either
  direction.
  - `test-report.md` must carry that label.
  - A snapshot-backed stub of `ptah_memory_search`, answering read-only from copy B, would exercise
    reuse without touching the live database. It is recorded as an optional extension. It is not
    required by this plan.
- **Files:**
  - CREATE `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts`
  - CREATE `.ptah/specs/TASK_2026_563_2939/harness/**` (lib/copy-db.ts, lib/connection.ts,
    lib/embedder.ts, lib/llm.ts, copy-audit.ts, merge-replay.ts, extract-eval.ts, README.md)
  - CREATE `.ptah/specs/TASK_2026_563_2939/test-report.md` (senior-tester)

## M5 read-path inventory (M5 criterion 5)

| Path                                           | Where (base)                                                                  | Returns content to an agent?                                                                                              | Decision                                                                            | Spec                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| `searchRich`, BM25                             | `memory-search.service.ts:378-414`                                            | yes (`memory:search`, and through `search`)                                                                               | exclude                                                                             | comp. 6 and round-trip                   |
| `searchRich`, vector                           | `:428-467`                                                                    | yes                                                                                                                       | exclude                                                                             | comp. 6                                  |
| `search` (`IMemoryReader`)                     | `:239-262`                                                                    | yes: injection `memory-prompt-injector.ts:110`, `ptah_memory_search` `memory-namespace.builder.ts:232`, skill-gap curator | exclude, through `searchRich`                                                       | comp. 6 and round-trip                   |
| `searchIndex` (query and filter)               | `:540-619`, filter `:754-857`                                                 | yes (`mem:searchIndex`, corpus build `knowledge-agent.service.ts:212`)                                                    | exclude in `buildFilterClause`                                                      | comp. 6 and round-trip                   |
| `timeline`                                     | `:626-673`                                                                    | yes (`mem:timeline`)                                                                                                      | exclude, and a quarantined anchor returns empty                                     | comp. 6 and round-trip                   |
| `getObservations`                              | `:680-736`                                                                    | yes (`mem:getObservations`)                                                                                               | exclude                                                                             | comp. 6 and round-trip                   |
| `findMergeCandidates`                          | `memory.store.ts:357-410`                                                     | yes (resolve prompt)                                                                                                      | exclude, keeps the 0046 index (EQP)                                                 | comp. 4, 3 and round-trip                |
| Tier-2 collector                               | new                                                                           | yes (resolve prompt)                                                                                                      | exclude, through `searchRich`                                                       | comp. 7 and round-trip                   |
| Merge target                                   | `memory-curator.service.ts:649-664`                                           | n/a (a write)                                                                                                             | refuse, and insert as new                                                           | comp. 7                                  |
| `list`                                         | `memory.store.ts:412-450`                                                     | UI or admin (`memory:list`)                                                                                               | exclude. Quarantined rows are visible through `memory:listQuarantined`.             | comp. 4                                  |
| `listAll`                                      | `:456-504`                                                                    | yes: session-start injection `memory-prompt-injector.ts:217`, agent `list` `memory-namespace.builder.ts:270`              | exclude                                                                             | comp. 4 and round-trip                   |
| `stats`                                        | `:743-771`                                                                    | no (counts)                                                                                                               | exclude, so counts equal what search sees                                           | comp. 4                                  |
| Corpus members                                 | `corpus.store.ts:305-325`                                                     | yes (`corpus:query`/`prime`)                                                                                              | exclude (defence)                                                                   | comp. 4 and round-trip                   |
| Corpus suggestions                             | `corpus-suggestion.service.ts:201-214,325-345`                                | no (concept statistics)                                                                                                   | unchanged, recorded                                                                 | n/a                                      |
| `memory:get` (explicit id)                     | `memory-rpc.handlers.ts:240-258` → `getActiveById` (new) and then `getChunks` | yes: any RPC caller, including agents through `ptah interact rpc.call` (`interact.ts:539-558`)                            | exclude. A quarantined id returns `{ memory: null, chunks: [] }`. No admin flag.    | comp. 8 and round-trip (`getActiveById`) |
| Raw `getById`                                  | `memory.store.ts:329-335`                                                     | no. Its internal callers are `lookupMemory`, which runs after the SQL filter, and diagnostics.                            | unchanged (raw identity lookup)                                                     | n/a                                      |
| `recordUse`, `setPinned`                       | `:608-648`, `:515-521`                                                        | n/a (writes)                                                                                                              | freeze quarantined rows                                                             | comp. 4                                  |
| Lifecycle archive, delete, evict, cap, preview | `memory-lifecycle.store.ts:12-61`                                             | n/a                                                                                                                       | exclude                                                                             | comp. 5                                  |
| `rebuildIndex` / `rebuildConceptsIndex`        | `memory.store.ts:789-833`                                                     | n/a                                                                                                                       | include all rows, so restore stays exact                                            | n/a                                      |
| Diagnostics counts                             | `diagnostics.service.ts`                                                      | no                                                                                                                        | include all rows, because the coherence check compares chunk, FTS and vector counts | n/a                                      |
| Explicit deletes (`forget`, purge)             | `memory.store.ts:523-606`                                                     | n/a                                                                                                                       | unchanged; user-initiated                                                           | n/a                                      |

## Integration architecture

- **Data flow (M3):**
  1. PreCompact, the trigger service or `memory:runNow` calls `curate`.
  2. `doCurate` extracts across windows (`:549-562`).
  3. `MergeCandidateCollector.collect`: tier 1 SQL, then up to 10 × `searchRich(scope)`.
  4. `llm.resolve(drafts, related)` (`:614-622`).
  5. Per draft: the guard, then `appendChunks`, or `insertMemoryWithChunks`.
- **Data flow (M5):**
  1. Boot: `SqliteConnectionService` runs `applyAll(MIGRATIONS)` (`sqlite-connection.service.ts:239`),
     which attempts a best-effort pre-migration backup when a backup service is wired, then
     applies 0048 and 0049.
  2. Every read path filters.
  3. Restore: `memory:restoreQuarantined` → `MemoryStore.restoreQuarantined` → counter bump. The
     next search sees the rows.
- **State:** quarantine lives only in the two columns of `memories`. They are owned by
  `persistence-sqlite` (schema) and `MemoryStore` (reads and writes), and they persist until a
  restore. Quarantined rows are never deleted by the lifecycle, so their storage is permanent and
  bounded (89 rows on the copy).
- **External boundaries:**
  - RPC params are validated by zod.
  - The workspace is authorized, or it is an explicit `null` meaning unscoped rows only.
  - Tier-2 queries come from model output but are used only as bound FTS and embedding input.
    `buildFtsQueryPlan` strips FTS metacharacters (`fts-query.util.ts`).
- **Failure and rollback:**
  - A tier-2 failure degrades to tier 1.
  - A migration failure rolls back, and the version is not recorded.
  - A wrong quarantine is undone by restore by rule or all.
  - A code rollback after 0048 and 0049 have applied is refused by the forward-only runner
    (`migration-runner.ts:79-85`). A pre-migration backup can serve for that, but only if one
    exists: it is best-effort. See Risks.
- **Observability:**
  - Migration application is logged by the runner (`:141-146`).
  - The collector logs one debug line per pass (tier-1 count, tier-2 count, queries, `bm25Only`,
    skipped reason) and warns once on a tier-2 error.
  - Guard refusals log at info with a reason.
  - Restore logs the count at info, as `purgeBySubjectPattern` does at `:446-450`.

## Measurement plan (reuses TASK_2026_473 Track A)

All runs happen on copies. The copy protocol is:

- The baseline is `C:\Users\abdal\AppData\Local\Temp\mqs-563-snapshot\memcopy-563.sqlite`, with
  SHA-256 `2661275c…7810`, integrity `ok`, taken with the online backup API from a read-only
  handle (`quarantine-rules.md` §1). The tester verifies the hash, then derives working copies with
  `harness/lib/copy-db.ts`, which also uses the backup API.
- If a fresh snapshot is needed, use the same `take-snapshot.mjs` method. Its source handle is
  `readOnly: true`, it runs as a single step, and its target is fail-if-exists, outside `.ptah\state`
  and not named `ptah*`.
- Never open the live file for writing, never migrate it, and never touch its `-wal`/`-shm` or any
  `ptah.pre-migration-*`.
- `test-report.md` records the path, time, method and integrity result for every working copy.

| Measurement                         | Procedure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gate                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M5 migration** (M5 criterion 4)   | Working copy A: <ul><li>before: row counts of `memories`, `memory_chunks`, the FTS entries (`memory_chunks_fts`, counted through `memory_chunks_fts_docsize`) and the vector entries (`memory_chunks_vec`, counted through `memory_chunks_vec_rowids`, plus `SELECT COUNT(*) FROM memory_chunks_vec` with vec loaded); `integrity_check`</li><li>ordered SHA-256 over `JSON.stringify` of every row: for `memories`, the 25 pre-existing columns from `PRAGMA table_info` taken before migrating, `ORDER BY id`; for `memory_chunks`, `rowid` plus all 6 columns, `ORDER BY id`</li><li>`new SqliteMigrationRunner(db, logger).applyAll(MIGRATIONS, { vecExtensionLoaded })` with no backup service, timed</li><li>after: the same counts, integrity and hashes, excluding the two new columns</li></ul>                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Counts equal, integrity `ok` both times, hashes equal, duration recorded                                                                                                               |
| **M5 rules** (M5 criterion 11)      | On copy A after migration: `quarantine_reason` counts per rule, compared with `quarantine-rules.md` r2 §6: only `rule:commitlint-scope-facts`, 89. This is set against 36,252 and the copy total of 26,706. Also checked: every durable fixture id in r2 §6 that exists on the copy stays NULL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Exact match with r2 §6                                                                                                                                                                 |
| **KNN starvation** (r1, finding 8)  | On copy A, for Q1 to Q4 and the 8(a) draft, the vector candidates that survive the join, and the final hit count, before and after 0049, for both `searchRich` and `searchIndex`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Recorded (accepted limitation)                                                                                                                                                         |
| **Relevance** (§4 criterion 1)      | Q1 to Q4 from `track-a-retrieval-measurement.md` §2, top 5, the Track A rubric with a reason per row. The path is `MemorySearchService.searchRich` with `VecStatus.available = false` and a plain embedder, which is BM25 through `fts-query.util`, the same path Track A printed, scoped to `D:\projects\ptah-extension`. <ul><li>"main" (r4, Batch 4 review finding 3): the BASE-COMMIT code `ebfc73321` (a throwaway detached worktree or a harness bundled from base sources) on an unmigrated working copy of the same snapshot. The comp. 6 predicate-neutrality spec is not a substitute.</li><li>"branch": copy A (49 applied)</li><li>restore-all on copy A, then re-run: the ids must equal "main"</li></ul>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Both gates:** branch ≥ main re-measured on the copy, **and** branch ≥ 16/20 (task-description §4, criterion 1). Both numbers are recorded if main ≠ 16. Restore gives identical ids. |
| **M3 reach** (M3 criterion 8a)      | Copy B migrated to 48 only (M5 off). The draft is `{kind:'fact', subject:'commitlint-scope-enum', content:<content of the newest 'commitlint-scope-enum' row on the copy, recorded verbatim>}`. <ul><li>Before: `findMergeCandidates(['commitlint-scope-enum'], ws)`</li><li>After: `MergeCandidateCollector.collect([draft], ws)` with the real embedder and reranker</li></ul> Count the distinct case-folded family subjects (`LIKE '%commitlint%'`) in each set. Repeat after with `HTTPS_PROXY`/`HTTP_PROXY=http://127.0.0.1:9` to prove the path is local.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | After > before (baseline 1 on the copy's family of 49 subjects)                                                                                                                        |
| **M3 replay** (M3 criterion 8b)     | Replay set, fixed and listed in `test-report.md`: seed `TASK_2026_563_2939:m3`. <ul><li>From copy B's `D:\projects\ptah-extension` rows, select the 20 rows with the highest hash order whose chunk has a nearest neighbour (vector KNN) in the same workspace with a different case-folded subject and cosine similarity ≥ 0.85.</li><li>Copy B′ = copy B with those 20 rows removed, which is a scratch copy, so the draft cannot find itself.</li><li>Each draft is the row's `{kind, subject, content, type, concepts, files}`, one resolve call per draft.</li><li>Before: tier 1 plus the base resolve prompt.</li><li>**After-A:** tier 1 + tier 2, always, plus the branch prompt.</li><li>**After-B:** tier 2 only when tier 1 is non-empty, plus the branch prompt. Both after variants are measured during testing, **after** Gate 2, to validate the D4 choice. Gate 2 itself sees only the proxy estimates in D4.</li><li>A merge = a non-null `mergeTargetId` that passes the comp. 7 guard.</li><li>Record the attempts (20), merges and rate for each run, the number of drafts where resolve made an LLM call, and the collector wall time per draft.</li><li>The **extra resolve calls over main** in After-A are the D4 cost. After-B must be 0.</li></ul> | Attempted set identical; after merges > before; after rate > before. The gate is judged on the variant chosen at Gate 2. If B is chosen and fails 8(b), that is reported, not hidden.  |
| **M4 extraction** (M4 criteria 6-8) | Sample: seed `TASK_2026_563_2939:m4`, 10 sessions from `D:\projects\ptah-extension` with ≥ 1 memory on the copy, a JSONL present at `~/.claude/projects/D--projects-ptah-extension/`, 200 KB to 5 MB in size, and not modified in the last 24 h (so it is closed). Ids are listed in the report. <ul><li>Per session: `SessionHistoryReaderService.readHistoryForCuration`, built from its real `JsonlReaderService` and `HistoryEventFactory` with null stubs for model resolver, auth env and pricing. **Assumption:** those three are unused on this path; verified by reading `:679-753` and the projection helper that follows it.</li><li>Join the history as `SdkTranscriptReaderAdapter.read` does (`sdk-transcript-reader.adapter.ts:28-39`), then `planCuratorWindows` (production windowing, at most 8 windows).</li><li>Call `SdkInternalQueryCuratorLlm.extract` per window with the old and the new prompt, interleaved.</li><li>Record per run: drafts, distinct subjects, single-use count and share, subjects already on copy B's workspace (`TRIM(LOWER(subject))`).</li><li>Classify every draft with the `quarantine-rules.md` §2 rubric, and list the old durable drafts with no durable equivalent in the new run.</li></ul>                            | M4 criterion 8(a) to (c)                                                                                                                                                               |

**Cost and network of the LLM measurements.** They are the only non-local steps, and they run on
the user's configured Claude auth through the `claude` CLI:

- M4: at most 10 sessions × 8 windows × 2 prompts = 160 extract calls on the `haiku` tier, each
  with at most about 9k input tokens (a 32 KB window, `clamp-transcript.ts:48`, plus the prompt).
  That is at most about 1.5M input tokens.
- M3: 40 resolve calls.

No live-database access happens. Transcripts are read-only.

**Commitlint merge measurement.** 8(a) is the family reach. The replay set in 8(b) must contain at
least 3 commitlint-family drafts if the selection yields them. If it does not, the tester adds the
3 newest family rows as fixed extra drafts, listed separately. The added drafts do not change the
identical-set rule, because they are in both runs.

## Architecture-level quality requirements

- **Functional:**
  - M4 criteria 1 to 8.
  - M3 criteria 1 to 8: tier 1 is first and unchanged; the bounds are 5, 25 and 10 queries;
    scoping is exact, including `null`; no usage or salience writes; the guard holds.
  - M5 criteria 1 to 11.
  - Relevance is at least main re-measured, and at least 16/20.
- **Performance:**
  - Tier 2 is at most 10 hybrid searches per pass. The added resolve-path time is recorded against
    main in the replay.
  - The boot migration cost is about 0.75 s once on a 27k-row DB.
  - `findMergeCandidates` median time is within noise of main (0.25 ms against 0.27 ms).
- **Security:**
  - Static migration SQL.
  - All other SQL parameterised; the LIKE and GLOB patterns are static literals.
  - Restore requires an authorized explicit workspace.
  - No memory content in logs beyond the existing patterns.
- **Maintainability:**
  - No edits to 0044, 0046 or 0047, to `fts-query.util.ts`, or to `findMergeCandidates` caps and
    ordering.
  - No resurrection of `MemoryDecayJob` or `SalienceScorer`, no new retention step, and no write
    to `salience`, `tier` or `archived_at` for quarantine.
  - The layer rule holds: memory-curator imports persistence-sqlite and memory-contracts only;
    agent-sdk changes are string constants.
- **Testability:**
  - Every changed unit has a spec.
  - SQLite specs are green on `better-sqlite3` (Electron as node) and on `node:sqlite`.
  - Exactly one round-trip spec.
  - One lifecycle quarantine spec.
  - Reachability specs for M4, M3 and M5, listed below.

### Reachability proof (§4 criterion 3)

| Change                                 | Production caller (file:line)                                                                                                                                                 | Spec that fails if the wiring is removed                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| M4 prompt                              | `sdk-internal-query.curator-llm.ts:294-299` (`extract` → `runQuery(EXTRACT_SYSTEM_PROMPT, …)`), registered at `agent-sdk/src/lib/di/register.ts:544-545`                      | `sdk-internal-query.curator-llm.spec.ts`: the new assertion on `execute`'s `systemPromptAppend`              |
| M3 resolve prompt                      | `sdk-internal-query.curator-llm.ts:363-368`                                                                                                                                   | `sdk-internal-query.curator-llm.spec.ts`: the same pattern for `resolve` (add it)                            |
| M3 tier 2                              | `memory-curator.service.ts` `doCurate` (replacing `:603-612`); curate callers `:231-244`, `memory-trigger.service.ts:848,998`, `memory-rpc.handlers.ts:622`                   | `di/register.spec.ts`: the real DI `curate()` asserts that `MEMORY_SEARCH.searchRich` was called             |
| M3/M5 guard                            | `memory-curator.service.ts` (replacing `:649-664`)                                                                                                                            | `memory-curator.service.spec.ts`: guard cases                                                                |
| M5 search, injection and merge filters | `memory-search.service.ts` (above); `memory-prompt-injector.ts:110,217`; `memory-namespace.builder.ts:232,270`; `memory-curator.service.ts` collector call                    | `quarantine.round-trip.spec.ts` (real `MemorySearchService`, `MemoryStore` and collector)                    |
| M5 rule application                    | boot `sqlite-connection.service.ts:239` → `MIGRATIONS` includes 49                                                                                                            | `0049_memory_sediment_quarantine.spec.ts` (registry entry plus effect); `copy-audit` on the real runner      |
| M5 restore                             | `memory-rpc.handlers.ts`, new `memory:restoreQuarantined`, served on hosts with `memory` capability through `manifest.ts:308-313`; reachable through `ptah interact rpc.call` | `memory-rpc.handlers.spec.ts` (the handler calls `store.restoreQuarantined`); the rpc-surface partition spec |
| M5 lifecycle                           | `MemoryRetentionService.run` → `MemoryLifecycleService.runStep` → `MemoryLifecycleStore` constants                                                                            | `memory-lifecycle.quarantine.spec.ts`                                                                        |

## Team-leader handoff

- **Recommended executors:**
  - components 1 and 2, as **one batch**: backend-developer (prompt text plus specs in agent-sdk).
    The batch owns the shared `sdk-internal-query.curator-llm.spec.ts`.
  - component 3: backend-developer (migrations follow a strict precedent)
  - components 4 to 8: backend-developer
  - component 9: senior-tester, who owns the round-trip spec, the harness and `test-report.md`,
    with devops-engineer only if the esbuild/electron harness invocation needs help

  Per `HANDOFF.md` rule 7, reviews should come from a different model family than the implementer.

- **Complexity:** HIGH. Three libraries plus `shared` and `rpc-handlers`, two migrations, a
  lifecycle-sensitive change, and LLM-backed measurements on a real-DB copy.
- **Dependencies and ordering (component-level):**
  - `npm ci` in the worktree comes first.
  - Component 3 (schema) comes before any memory-curator SQL that names `quarantined_at` is
    verified (components 4, 5, 6 and 9).
  - Component 4 (`getMergeTarget`, `getActiveById`, `restoreQuarantined`) comes before components
    7 and 8 are verified.
  - The Gate 2 answer to D4 comes before component 7 is finalised. Until then it implements
    option B.
  - Component 6 (the `searchRich` null scope) comes before component 7 is verified.
  - Components 1 and 2 are independent of everything.
  - Component 9's round-trip spec needs 3 to 7. The harness needs 1 to 7. Its M4 part needs only
    component 1.
- **Shared files that force ordering:**
  - `memory-search.service.ts` serves both M3 (scope) and M5 (filter). Give it to a single batch
    (component 6). Do not split it between M3 and M5 batches.
  - `memory.store.ts` serves both M3 (`getMergeTarget`) and M5. Give it to a single batch
    (component 4).
  - The migration `index.ts` and the ratchet specs belong to component 3 only.
- **Parallel-safe work (file-disjoint):**
  - Wave 1 in parallel: {1 + 2} (one agent-sdk batch) and {3}. These are file-disjoint.
  - Wave 2 in parallel: {4 + 5}, {6}. They are file-disjoint.
  - Wave 3 in parallel: {7}, {8}.
  - Wave 4: {9}.

  M4 runs fully parallel. M3's resolve prompt runs in wave 1. M3's collector must be verified after
  waves 2a and 2b; it may be implemented in parallel against the signatures specified here.

- **Commit scopes:**
  - {1 + 2}: `fix(agent-sdk)`
  - {3}: `fix(persistence-sqlite)`
  - {4+5}, {6}, {7} and the round-trip spec: `fix(memory-curator)`
  - {8}: `fix(rpc-handlers)`. This is **Decision D2, pending Gate 2.** If D2 is refused, the RPC
    batch must still land, because a restore surface is required, and the user names the scope.

  The harness and report go in the tester's commit. Its scope is `fix(memory-curator)`, because the
  round-trip spec lives there; no `docs` scope is introduced without approval.

- **Files affected:**
  - **CREATE:**
    - `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.spec.ts`
    - `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.spec.ts`
    - `libs/backend/persistence-sqlite/src/lib/migrations/0048_memory_quarantine.ts` and `.spec.ts`
    - `libs/backend/persistence-sqlite/src/lib/migrations/0049_memory_sediment_quarantine.ts` and `.spec.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.quarantine.spec.ts`
    - `libs/backend/memory-curator/src/lib/curator-llm/merge-candidate-collector.ts` and `.spec.ts`
    - `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts`
    - `.ptah/specs/TASK_2026_563_2939/harness/**`
    - `.ptah/specs/TASK_2026_563_2939/test-report.md`
  - **MODIFY:**
    - agent-sdk: `extract-prompt.ts`, `resolve-prompt.ts` and `sdk-internal-query.curator-llm.spec.ts`
    - persistence-sqlite: `migrations/index.ts` and 11 ratchet specs (listed in component 3)
    - memory-curator:
      - `memory.store.ts`, `memory.store.spec.ts` and `memory.types.ts`
      - `src/index.ts`
      - `knowledge-agents/corpus.store.ts` and its spec
      - `retention/memory-lifecycle.store.ts` and `retention/retention-sqlite.test-support.ts`
      - `memory-search.service.ts` and `memory-search.service.spec.ts`
      - `memory-curator.service.ts` and `memory-curator.service.spec.ts`
      - `di/register.spec.ts`
    - shared: `types/rpc/rpc-memory.types.ts` and `types/rpc.types.ts`
    - rpc-handlers: `memory-rpc.handlers.ts`, `memory-rpc.schema.ts` and `memory-rpc.handlers.spec.ts`
    - `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
  - **DELETE:** `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts`
- **Verification points:**
  - Before deleting the duplicate prompt, `ptah_lsp_references` on it must show no references.
  - Before merge, `ptah_get_diagnostics` passes on every changed file.
  - The EQP in `0048_memory_quarantine.spec.ts` names `idx_memories_ws_normalized_subject`.
  - The lifecycle plan spec (`memory-lifecycle.store.spec.ts:56-96`) and every 443 spec pass with
    no edit to their expectations.
  - The migration dry run on the copy gives equal counts, `ok` integrity and equal hashes.
  - Rule counts equal `quarantine-rules.md` r2 §6 (`rule:commitlint-scope-facts` = 89, and no other reason).
  - The scoped command, with its `for 12 projects` header checked:
    `npx nx run-many -t test lint typecheck -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/shared @ptah-extension/rpc-handlers ptah-extension-vscode @ptah-extension/messaging-gateway @ptah-extension/skill-synthesis @ptah-extension/cli-engine @ptah-extension/thoth-runtime @ptah-extension/task-specs @ptah-extension/cron-scheduler`
  - Why these direct dependents:
    - persistence-sqlite's `MIGRATIONS` feed specs in memory-curator, rpc-handlers
      (`skills-synthesis-rpc.digest.spec.ts:97` applies all migrations), messaging-gateway,
      skill-synthesis, task-specs, cron-scheduler, cli-engine and thoth-runtime.
    - memory-curator's reader and store semantics feed rpc-handlers, skill-synthesis, cli-engine
      and thoth-runtime.
    - shared's RPC map feeds the VS Code surface spec.
  - Why the other agent-sdk dependents are excluded: the agent-sdk edits change two non-exported
    string constants (`curator-llm-adapter/index.ts` exports only the adapter and its error), so
    none of those dependents can observe a difference. `ptah-electron` is excluded because it gets
    no source change; its DI graph is covered by `di/register.spec.ts`.
  - Also run: `npx nx run degradation-audit:lint` (new catch markers, `HANDOFF.md` rule 4) and
    `npx nx run di-lint:lint` (the new `@inject` on the curator).
  - SQLite specs run a second time under `ELECTRON_RUN_AS_NODE=1` Electron per `HANDOFF.md:56-63`,
    for memory-curator and persistence-sqlite, with the `--testPathPatterns` value quoted as
    `'"a|b"'`.
  - Known flakes, per `HANDOFF.md` rule 8, are re-run and both results recorded.

### Delivery checklist (from `context.md:29` and the `task-description.md` delivery constraints)

1. [ ] **Gate 2:** the user approves this plan together with `task-description.md`, and answers
       D1 to D4 (D2 is the `fix(rpc-handlers)` scope; D4 is option A or B).
2. [ ] `npm ci` in the worktree. Never touch `D:\projects\ptah-extension`.
3. [ ] team-leader Mode 1 writes `batches.md` with the waves above (file-disjoint; {1+2}
       combined).
4. [ ] Per batch: the developer implements; code-logic-reviewer and code-style-reviewer review it
       (a different model family from the implementer, `HANDOFF.md` rule 7); the team-leader verifies
       with the scoped command.
5. [ ] Per batch: **one commit**, `fix(<scope>): …` with the scopes above. Hooks are never skipped
       (no `--no-verify`), and failures are fixed rather than bypassed.
6. [ ] senior-tester: the round-trip spec, the harness, and `test-report.md` with every measurement
       in this plan, including the D4 call counts for A and B, the KNN starvation numbers, and the
       prompt-only M4 label.
7. [ ] The full scoped `run-many` is green (`for 12 projects`). degradation-audit and di-lint pass.
       The dual-driver SQLite runs pass.
8. [ ] Push `fix/memory-quality-source`. Open a PR against `main` whose body has `## Summary` and
       `## Test plan`, citing the `test-report.md` numbers, and ending with the required attribution
       line.
9. [ ] Set the task `status:` line in `task.md` to `in_review`.
10. [ ] Keep the worktree until the user merges. Nothing is committed to `main` and nothing is
        removed from `main`.

## Risks and rollback

| Risk                                                                            | Likelihood / impact | Mitigation                                                                                                                                                                                                                                                                                                      | Rollback                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A rule quarantines durable rows that the sample missed                          | LOW / LOW           | r2 keeps one rule, R4 (commitlint facts that mention scope). Event rules were dropped because no guard reached zero durable loss. 72 R4 rows were read across all fields, with 0 durable. The durable/guard/positive fixtures in the 0049 spec pin both the event non-targeting and the R4 boundary.            | `memory:restoreQuarantined` by `reason` or `all`, per named workspace or the NULL workspace                                                                                                                 |
| 0049 runs on every user's DB at the next start (D1)                             | certain / LOW       | Only the two new nullable columns are written; nothing is deleted; the single R4 rule is static and sampled; restore is exact inside the upgraded schema. The pre-migration backup is **best-effort** (skipped without a backup service, and failures are non-fatal), so it is not part of the safety argument. | Restore through RPC, per scope. A code downgrade is refused by the forward-only runner (`migration-runner.ts:79-85`); the only way back to older code is a backup, **if one exists**, as for any migration. |
| Under D4 option A, tier 2 raises resolve-call frequency                         | MED / LOW           | Measured in the replay; the envelope is in D4; option B removes it                                                                                                                                                                                                                                              | Choose B, or revert the collector commit. Tier 1 is untouched.                                                                                                                                              |
| Under D4 option B, the M3 merge gate 8(b) fails                                 | MED / MED           | At Gate 2 the user chooses on the proxy estimates in D4. Both variants are measured during testing and reported; if the measurement contradicts the estimate, the choice is revisited with the user.                                                                                                            | Choose A with explicit approval                                                                                                                                                                             |
| The resolve prompt over-merges distinct facts (D3)                              | MED / MED           | "Different facts that only share a topic are not a merge"; candidate-list-only guard; a merge appends a chunk and never overwrites content                                                                                                                                                                      | Revert the `{2}` commit                                                                                                                                                                                     |
| A missing quarantine predicate on some read path                                | LOW / MED           | The inventory table plus the single round-trip spec over every agent-facing path                                                                                                                                                                                                                                | Add the predicate                                                                                                                                                                                           |
| Lifecycle spec regressions from the new column                                  | LOW / HIGH          | The fixture adds 48; plans verified by EQP; the dedicated quarantine lifecycle spec                                                                                                                                                                                                                             | Revert `{4+5}`                                                                                                                                                                                              |
| Quarantined vector chunks crowd the KNN top-N in `searchRich` and `searchIndex` | LOW / LOW           | BM25 is filtered upstream in both paths. KNN behaves as it already does for other-workspace chunks, with over-fetch ×4, and 89 of 29,447 chunk rows are quarantined on the copy (measured). Measured by the tester.                                                                                             | n/a (accepted limitation)                                                                                                                                                                                   |
| The worktree lacks `node_modules`                                               | certain / blocking  | `npm ci` in the worktree first; never a junction into the main checkout                                                                                                                                                                                                                                         | n/a                                                                                                                                                                                                         |
| The M4 eval does not exercise search-based subject reuse (MCP off)              | certain / LOW       | The run is labelled a "prompt-only, limited evaluation", not a lower bound. The optional snapshot-backed search stub is recorded.                                                                                                                                                                               | n/a                                                                                                                                                                                                         |
| The dead duplicate `curator-llm/resolve-prompt.ts` remains                      | certain / LOW       | Recorded as a follow-up; out of this task's scope                                                                                                                                                                                                                                                               | n/a                                                                                                                                                                                                         |
