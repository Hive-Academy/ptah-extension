# Batches - TASK_2026_563_2939

Total tasks: 18 | Batches: 7 | Complete: 7/7

Worktree: `D:\projects\ptah-extension-memory-quality-source` (branch `fix/memory-quality-source`,
base `ebfc73321`). Every path, command and commit happens in this worktree only. Never touch
`D:\projects\ptah-extension`, never commit to `main`. `npm ci` already ran (node_modules present,
verified 2026-09-26).

Source of truth: `implementation-plan.md` r3 (Gate 2 decisions block, :223-231), `task-description.md`
r2, `quarantine-rules.md` r2. Gate 2 outcomes applied here: D1 yes (0049 auto-applies R4), D2 yes
(`fix(rpc-handlers)`), D3 yes (resolve prompt changes), **D4 = B strict** (tier 2 only when tier 1
is non-empty; no runtime flag), R4 policy accepted.

## Execution defaults (recorded, no user gate)

- Waves follow the plan handoff (implementation-plan.md:1122-1129). Batches inside one wave are
  file-disjoint and may run in parallel. No user gate between batches; the run continues to an
  opened PR (context.md:62).
- Every batch: executor implements -> team-leader verifies on disk -> code-logic-reviewer and
  code-style-reviewer (different model family from the implementer, HANDOFF.md rule 7) -> one
  commit per batch, hooks never skipped (no `--no-verify`).
- Commit scopes (all allowed by `.commitlintrc.json` scope-enum, verified): B1 `fix(agent-sdk)`,
  B2 `fix(persistence-sqlite)`, B3/B4/B5/B7 `fix(memory-curator)`, B6 `fix(rpc-handlers)`.
  Header <= 100 chars, subject lower-case, <= 72 chars, no trailing period.
- Same-worktree parallelism rule: two batches running at once in the **same lib**
  (B3 and B4 in memory-curator) run only their own spec files with `--testPathPatterns` during
  development; the full `-p @ptah-extension/memory-curator` verification and the commit happen
  per batch in dependency order (B3 before B4). Batches in different libs (B1 with B2, B5 with B6)
  have no such constraint.
- Verification commands are always `-p`-scoped; never workspace-wide. Output is tailed, and the
  `for N projects` header is checked. SQLite specs run twice: default Jest, and under
  `ELECTRON_RUN_AS_NODE=1` Electron (HANDOFF.md:56-63), with `--testPathPatterns` quoted `'"a|b"'`.
- Known flakes are re-run and both results recorded (HANDOFF.md rule 8).

| Wave | Batches (parallel inside a wave)                                         | Depends on         |
| ---- | ------------------------------------------------------------------------ | ------------------ |
| 1    | B1 agent-sdk prompts, B2 persistence-sqlite migrations                   | none               |
| 2    | B3 store + lifecycle, B4 search service (B4 verified/committed after B3) | B2 (B4 also B3)    |
| 3    | B5 collector + curator wiring, B6 RPC restore surface                    | B5: B3, B4; B6: B3 |
| 4    | B7 round-trip spec + harness + test-report (senior-tester)               | B1-B6              |

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- `corpus.store.spec.ts` exists beside `corpus.store.ts` — **verified** (on disk); B3 extends it,
  does not create it.
- The dead duplicate `memory-curator/src/lib/curator-llm/extract-prompt.ts` has no importer —
  unverified by LSP; Task 1.3 runs `ptah_lsp_references` on `EXTRACT_SYSTEM_PROMPT` before deleting.
- Seams cited by the plan match the base — **verified** by spot read: curator constructor
  `governor` last at `memory-curator.service.ts:192-193`; tier-1 call `:603-612`; merge path
  `getById` at `:652`; `searchRich` at `memory-search.service.ts:264`, `makeCacheKey` `:209`;
  mocked `execute` at `sdk-internal-query.curator-llm.spec.ts:159`; fixture version list at
  `retention-sqlite.test-support.ts:219-220` = `[2, 7, 10, 15, 16, 17, 18, 19, 43, 44, 47]`.
- `memory-rpc.schema.spec.ts` exists beside `memory-rpc.schema.ts` — **verified**; B6 adds the new
  zod cases there (the plan listed only the handler spec).
- SDK `query()` option names used by the harness LLM stand-in match `SdkQueryRunner` — unverified;
  Task 7.2 reads `helpers/sdk-query-runner.service.ts:530-540` first.
- `SessionHistoryReaderService.readHistoryForCuration` does not use model resolver, auth env or
  pricing on the curation path — unverified; Task 7.2 verifies by reading `:679-753` before
  stubbing them with null.

| Risk                                                                                                                                                                                                                                               | Severity                     | Mitigation                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The plan's ratchet list (0028, 0030, 0038-0044, 0046, 0047) **omits `0045_skill_backlog_cleanup.spec.ts:32`**, which also asserts `Math.max(...versions)).toBe(47)`; left alone, the persistence-sqlite suite fails after 0048/0049 are registered | HIGH (would fail B2)         | Task 2.3 is grep-driven: every spec in `migrations/` asserting a max version of 47 moves to 49 — 12 files, 0045 included. Verified list below.                                       |
| memory-curator SQLite specs apply a fixed migration list; without 48 every lifecycle/search real-SQLite spec that touches `quarantined_at` fails                                                                                                   | HIGH                         | Task 3.3 adds 48 to the list as its **first** edit; B4 real-SQLite cases depend on it (B4 commits after B3)                                                                          |
| B3 and B4 both live in memory-curator and run in the same worktree; a half-written file in one breaks the other's full project run                                                                                                                 | MEDIUM                       | Same-worktree rule above: spec-pattern runs while both are in flight; full `-p` verification and commit in order B3 then B4                                                          |
| B1 deletes a memory-curator file while B2 changes `MIGRATIONS` in parallel; a memory-curator check during B2's edit could fail spuriously                                                                                                          | LOW                          | B1's memory-curator `lint typecheck` check runs after both wave-1 executors report                                                                                                   |
| New migrations flow into dependents that apply all `MIGRATIONS` (rpc-handlers, messaging-gateway, skill-synthesis, task-specs, cron-scheduler, cli-engine, thoth-runtime)                                                                          | MEDIUM                       | Per-batch commands stay narrow; the plan's 12-project scoped run is mandatory in B7 (Task 7.3) before the PR                                                                         |
| D4 = B may fail the M3 8(b) replay gate                                                                                                                                                                                                            | MEDIUM                       | Implemented as B only (Task 5.1 step 3). The replay measures A and B (Task 7.2); a failing 8(b) is reported in `test-report.md` and the PR, not hidden                               |
| A read path misses the quarantine predicate                                                                                                                                                                                                        | MEDIUM                       | Plan M5 read-path inventory (implementation-plan.md:942-966) is the checklist for B3, B4, B6 reviews; the single round-trip spec (Task 7.1) walks every agent-facing path            |
| Lifecycle (443) regressions from the new predicate                                                                                                                                                                                                 | HIGH impact / LOW likelihood | `memory-lifecycle.store.spec.ts:56-96` plan pins and every existing lifecycle/retention spec must pass with **no expectation edits** (Task 3.4 verification)                         |
| Tier-2 errors failing a curation pass                                                                                                                                                                                                              | MEDIUM                       | Collector catch keeps tier 1 + collected rows, `// degradation-audit: optional-capability - …` marker, `degradation-audit:lint` in B5                                                |
| New `@inject` on the curator constructor breaks positional spec construction or DI lint                                                                                                                                                            | MEDIUM                       | Appended LAST and optional (after `governor`); `di-lint:lint` in B5                                                                                                                  |
| Harness touching the live DB                                                                                                                                                                                                                       | HIGH impact                  | Harness copy protocol (implementation-plan.md:1008-1019): backup-API copies into `%TEMP%\mqs-563-eval\`, refuse `.ptah\state` and `ptah*` names; never migrate or open the live file |

Edge cases:

- NULL-workspace rows quarantined by 0049 and restored by an explicit `null` scope — Tasks 2.2, 3.1, 6.2, 7.1
- Explicit `null` restore must never touch named-workspace rows, and the reverse — Tasks 3.1, 6.2
- Omitted `workspaceRoot` key on restore is `INVALID_PARAMS`, never "current" or "all" — Task 6.2
- Second application of 0049 changes nothing (idempotent via `quarantined_at IS NULL`) — Task 2.2
- Corpus-linked, pinned and core rows never quarantined (guard) — Task 2.2
- Quarantined corpus member (link inserted after 0049) excluded from corpus reads — Tasks 3.2, 7.1
- Search cache: `null` vs `undefined` scope and `topK` 5 vs 10 must not share entries; restore bumps the counter so a cached query sees restored rows — Task 4.1
- Quarantined BM25 matches exceeding `searchIndex` limit must not starve active matches — Task 4.1
- `timeline` anchor quarantined returns `{ rows: [], anchorIndex: 0 }` — Task 4.1
- Empty tier 1 under D4 = B returns `[]`, `tier2Skipped: 'tier1-empty'`, zero `searchRich` calls — Task 5.1
- `workspaceRoot === ''` skips tier 2 (never widens to all workspaces) — Task 5.1
- Abort during tier 2 stops queries — Task 5.1
- Merge target outside the candidate list, in another workspace, or quarantined → inserted as new — Task 5.2
- `recordUse` / `setPinned` on a quarantined row change nothing (hits, last_used_at, tier, archived_at, pinned frozen) — Task 3.1
- `memory:get` on a quarantined id returns `{ memory: null, chunks: [] }` and records no use — Task 6.2

## Batch 1: Extract and resolve prompts (agent-sdk, M4 + M3/D3) — COMPLETE (commit 87fd6c9fd)

- Wave: 1 (parallel with Batch 2)
- Recommended executor: backend-developer sub-agent
- Fallback executor: a single CLI lane with a self-contained prompt (prompt text + specs only)
- Execution mode: sequential
- Rationale: components 1 and 2 share `sdk-internal-query.curator-llm.spec.ts` (plan finding 5),
  so one executor owns it; text contracts are given verbatim, no design decisions mid-flight.
- Tasks: 3 | Depends on: none
- Commit: `fix(agent-sdk): rewrite curator extract and resolve prompts for durable, mergeable memories`
- Files (6 in 2 libs): agent-sdk `extract-prompt.ts`, `extract-prompt.spec.ts` (new),
  `resolve-prompt.ts`, `resolve-prompt.spec.ts` (new), `sdk-internal-query.curator-llm.spec.ts`;
  memory-curator `curator-llm/extract-prompt.ts` (DELETE)

### Task 1.1: Rewrite EXTRACT_SYSTEM_PROMPT and pin it with a spec — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\agent-sdk\src\lib\curator-llm-adapter\extract-prompt.ts`
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\agent-sdk\src\lib\curator-llm-adapter\extract-prompt.spec.ts`
- Plan reference: implementation-plan.md:235-312 (component 1, text contract :242-280)
- Pattern to follow: `curator-llm-adapter/extract.schema.spec.ts` (spec style in the same folder)
- Quality requirements: M4 criteria 1-5. JSON schema block and field list byte-identical to base;
  `buildExtractUserPrompt` unchanged; TOOLS kept (`:36-49`) with the memory-search bullet rewritten;
  new SUBJECTS and DO NOT EXTRACT sections per the text contract; keep the existing skip line.
- Validation notes: spec freezes the base schema field list (copy it from `ebfc73321` before
  editing); asserts no `"auth-service"` / `"ptah"` subject example, presence of
  `mcp__ptah__ptah_memory_search` and the reuse rule, the three class headings, the final-JSON rule.
- Implementation details: string-constant edit only; no new imports.

### Task 1.2: Rewrite RESOLVE_SYSTEM_PROMPT and pin it with a spec — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\agent-sdk\src\lib\curator-llm-adapter\resolve-prompt.ts`
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\agent-sdk\src\lib\curator-llm-adapter\resolve-prompt.spec.ts`
- Plan reference: implementation-plan.md:314-343 (component 2, text contract :320-328)
- Pattern to follow: Task 1.1's spec
- Quality requirements: replace `:22` with the semantic-merge sentence (including "Use only an id
  that appears in the Existing list"); rewrite the TOOLS sentence at `:26-32` to "only memories in
  the Existing list can be merge targets"; JSON block and `buildResolveUserPrompt` unchanged.
- Validation notes: spec asserts "subjects match (case-insensitive)" is gone, Existing-list-only
  rule present, JSON block unchanged (frozen from base).
- Implementation details: string-constant edit only.

### Task 1.3: Reachability assertions and delete the dead duplicate prompt — COMPLETE

- Depends on: Tasks 1.1, 1.2
- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\agent-sdk\src\lib\curator-llm-adapter\sdk-internal-query.curator-llm.spec.ts`
  - DELETE `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\curator-llm\extract-prompt.ts`
- Plan reference: implementation-plan.md:281-306, :335-338, reachability table :1082-1083
- Pattern to follow: existing `execute` mock at `sdk-internal-query.curator-llm.spec.ts:159` and
  assertions around `:660`
- Quality requirements: `extract` passes exactly the imported `EXTRACT_SYSTEM_PROMPT` as
  `systemPromptAppend` and it contains `DO NOT EXTRACT`; `resolve` passes `RESOLVE_SYSTEM_PROMPT`
  containing "only memories in the Existing list". Both fail if the wiring is removed.
- Validation notes: before deleting, run `ptah_lsp_references` on `EXTRACT_SYSTEM_PROMPT` at the
  memory-curator file's line 9 — must return only the declaration (report the output). Do not
  touch `curator-llm/resolve-prompt.ts` (out of scope, recorded follow-up). `clamp-transcript.ts:26`
  prose mention needs no edit.
- Implementation details: add two `it` cases; delete the file with `git rm`-equivalent (plain
  delete; team-leader stages).

### Batch 1 verification

- Every listed artifact exists / is deleted; no TODO/stub markers
- `npx nx run-many -t test lint typecheck -p @ptah-extension/agent-sdk` passes (tail output)
- After both wave-1 executors report: `npx nx run-many -t lint typecheck -p @ptah-extension/memory-curator` passes (proves the deletion broke no importer)
- `ptah_get_diagnostics` clean on the changed files
- code-logic-reviewer and code-style-reviewer accept
- Edge cases: none beyond the text contracts

## Batch 2: Quarantine schema and R4 rule migrations (persistence-sqlite, M5) — COMPLETE (commit f152a2793)

- Wave: 1 (parallel with Batch 1)
- Recommended executor: backend-developer sub-agent
- Fallback executor: backend-developer re-run with the failing spec output
- Execution mode: sequential
- Rationale: strict migration precedent (0039, 0046, 0047); the ratchet edits are mechanical but
  must land in the same commit as the registration or the suite goes red. 3 production files +
  specs, one lib.
- Tasks: 3 | Depends on: none
- Commit: `fix(persistence-sqlite): add reversible memory quarantine columns and r4 rule migration`

### Task 2.1: Migration 0048_memory_quarantine and its spec — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\persistence-sqlite\src\lib\migrations\0048_memory_quarantine.ts`
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\persistence-sqlite\src\lib\migrations\0048_memory_quarantine.spec.ts`
- Plan reference: implementation-plan.md:348-359, :399-404
- Pattern to follow: `0047_memory_retention_health.ts:1-11` (header comment, NOT IDEMPOTENT line,
  SECURITY line); `0046_memory_merge_subject_index.spec.ts:40-80` (EQP assertion)
- Quality requirements: two nullable `ADD COLUMN`s (`quarantined_at INTEGER`,
  `quarantine_reason TEXT`), no default, no index; static SQL (no `${`).
- Validation notes: spec asserts registry entry shape, columns exist and are NULL for
  pre-existing rows, no `${`, and EQP of the `findMergeCandidates` SQL **with**
  `m.quarantined_at IS NULL` still names `idx_memories_ws_normalized_subject`. Runs on both drivers.
- Implementation details: `export const sql = …`; registered in Task 2.3.

### Task 2.2: Migration 0049_memory_sediment_quarantine and its fixture spec — COMPLETE

- Depends on: Task 2.1
- Files:
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\persistence-sqlite\src\lib\migrations\0049_memory_sediment_quarantine.ts`
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\persistence-sqlite\src\lib\migrations\0049_memory_sediment_quarantine.spec.ts`
- Plan reference: implementation-plan.md:360-377, :405-420; `quarantine-rules.md` r2 §5-§6
- Pattern to follow: `0039_reap_orphaned_queue_rows.ts:1-60` (static one-time data migration)
- Quality requirements: exactly ONE `UPDATE memories SET quarantined_at = CAST(strftime('%s','now') AS INTEGER) * 1000, quarantine_reason = 'rule:commitlint-scope-facts' WHERE <guard> AND <rule>`,
  guard and rule copied **verbatim** from `quarantine-rules.md` r2 §5/§6; no table alias; not
  workspace-scoped; no other rule, no event predicate. Header: sample summary, cites
  quarantine-rules.md, reversible, touches only the two new columns, no DELETE, idempotent, security line.
- Validation notes: spec seeds every fixture listed in `quarantine-rules.md` r2 §6 — 2 positive
  (one NULL-workspace; both quarantined), 13 durable, 3 guard (corpus-linked, pinned, core) — then
  asserts only positives get reason `rule:commitlint-scope-facts`; all durable/guard stay NULL
  (including every event row); a second application changes nothing; `memory_chunks`,
  `memory_chunks_fts_docsize`, `memory_concepts_fts` counts unchanged. Both drivers.
- Implementation details: `export const sql`; the spec applies the needed prior migrations then 48, 49.

### Task 2.3: Register 48 and 49 and move every version-ceiling ratchet 47 -> 49 — COMPLETE

- Depends on: Tasks 2.1, 2.2
- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\persistence-sqlite\src\lib\migrations\index.ts`
  - MODIFY (ratchet, same folder, verified by grep on base — **12 files, includes 0045 which the plan omitted**):
    `0028_gateway_conversation_workspace_root.spec.ts:82`, `0030_skill_event_metrics.spec.ts:37`,
    `0038_gateway_message_turn_state.spec.ts:90`, `0039_reap_orphaned_queue_rows.spec.ts:64`,
    `0040_skill_candidate_workspace_root.spec.ts:77`, `0041_skill_md_migration_state.spec.ts:61`,
    `0042_db_integrity_check_state.spec.ts:69`, `0043_memory_retention.spec.ts:53`,
    `0044_memory_lifecycle.spec.ts:67-69`, `0045_skill_backlog_cleanup.spec.ts:32`,
    `0046_memory_merge_subject_index.spec.ts:32-34`, `0047_memory_retention_health.spec.ts:33`
- Plan reference: implementation-plan.md:378-386
- Pattern to follow: `0030_skill_event_metrics.spec.ts:30-37` comment ratchet;
  `0044_memory_lifecycle.spec.ts:65-66` comment lines
- Quality requirements: append `{ version: 48, name: '0048_memory_quarantine', sql }` and the 49
  entry to `MIGRATIONS`; each ratchet `47` -> `49` plus the comment
  `// 48 and 49 since TASK_2026_563 appended 0048_memory_quarantine and 0049_memory_sediment_quarantine.`
- Validation notes: only the ceiling assertion changes; `0047_memory_retention_health.spec.ts:30-31,45`
  (version-47 registry entry and `< 47` loop) stay as they are; 0044 lifecycle assertions untouched
  (M5 criterion 9(d)). Re-grep after editing: no `toBe(47)` ceiling left in `migrations/`.
- Implementation details: imports follow the existing alias style in `index.ts`.

### Batch 2 verification

- All 4 new files exist; `index.ts` registers 48 and 49; `grep -n "toBe(47)"` in `migrations/` returns no ceiling assertions
- `npx nx run-many -t test lint typecheck -p @ptah-extension/persistence-sqlite` passes (tail output)
- Dual-driver rerun of `0048|0049` specs under `ELECTRON_RUN_AS_NODE=1` Electron passes
- `ptah_get_diagnostics` clean on the changed files
- code-logic-reviewer and code-style-reviewer accept (logic reviewer diff-checks the 0049 guard/rule text against quarantine-rules.md r2 §5/§6 verbatim)

## Batch 3: MemoryStore quarantine awareness + lifecycle exclusion (memory-curator, M5 + M3 guard read) — COMPLETE (commit f453bfebf)

- Wave: 2 (implementation may overlap Batch 4; Batch 3 is verified and committed first)
- Recommended executor: backend-developer sub-agent
- Fallback executor: backend-developer re-run scoped to the failing task
- Execution mode: sequential
- Rationale: cross-method store edits plus the shared fixture every lifecycle and search spec
  depends on; one lib. 5 production files + 4 spec/fixture files.
- Tasks: 4 | Depends on: Batch 2
- Commit: `fix(memory-curator): exclude quarantined memories from store and lifecycle, add restore`

Execution order: Task 3.3 first (Tasks 3.1, 3.4 and Batch 4 depend on the fixture), then 3.1, 3.2, 3.4.

### Task 3.1: MemoryStore reads, write freeze, restore, list, merge-target and active-by-id — COMPLETE

- Depends on: Task 3.3
- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\memory.store.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\memory.store.spec.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\memory.types.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\index.ts`
- Plan reference: implementation-plan.md:435-527 (component 4)
- Pattern to follow: `stats` tri-state `memory.store.ts:727-742`; `recordUse` `json_each` + 500 cap
  `:616-626`; `markWorkspacesChanged` `:164-173`; `handleFatalWriteError` usage `:304-307`;
  `purgeBySubjectPattern` info log `:446-450`
- Quality requirements: predicate in `findMergeCandidates` (CTE WHERE), `list` (count + page),
  `listAll` (both), `stats` (tier counts + MAX(updated_at)); freeze `recordUse` (UPDATE and
  archival-roots SELECT) and `setPinned` (counter bump kept); new `getMergeTarget(id, ws|null)`,
  `getActiveById(id)`, `listQuarantined(filter)` (limit clamp [1,500], order
  `quarantined_at DESC, id DESC`, `workspaceRoot` per row, excerpt 200 chars),
  `restoreQuarantined(selector, ws|null)` in one transaction, clears only the two columns, then
  counter bump. `getById`, `findBySubjectAndTier`, deletes, rebuilds, `all()`, `appendChunks` unchanged.
  Types `QuarantinedMemoryRow` / `QuarantinedMemoryPage` exported in the existing grouped
  `export type` block of `src/index.ts` (+2 lines; barrel already over 150, recorded, no split).
- Validation notes: `findMergeCandidates` caps/ordering untouched (tier 1 unchanged). Hand-written
  `CREATE TABLE memories` fixtures at `memory.store.spec.ts:1289,1567` gain the two columns.
  Spec cases per plan :505-517, including NULL vs named-scope restore isolation both directions,
  idempotence, and `getMergeTarget` for missing / other-workspace / quarantined.
- Implementation details: parameterised SQL only; `workspace_root IS ?` for exact scope.

### Task 3.2: Corpus member exclusion — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\knowledge-agents\corpus.store.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\knowledge-agents\corpus.store.spec.ts` (exists — extend)
- Plan reference: implementation-plan.md:487-490
- Pattern to follow: the member query at `corpus.store.ts:305-325`
- Quality requirements: `AND m.quarantined_at IS NULL` at `:311-315`; spec: a quarantined member is excluded.
- Validation notes: defence in depth (guard never quarantines corpus-linked rows).

### Task 3.3: Test fixture migration list gains 48 — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts`
- Plan reference: implementation-plan.md:550-552
- Pattern to follow: the list at `:219-220`
- Quality requirements: `[2, 7, 10, 15, 16, 17, 18, 19, 43, 44, 47, 48]`; nothing else changes.
- Validation notes: helper, not a spec expectation; users are `di/register.spec.ts`,
  `memory-lifecycle.store.spec.ts`, `memory-retention.integration.spec.ts` — all must stay green.

### Task 3.4: Lifecycle SQL predicates and the quarantine lifecycle spec — COMPLETE

- Depends on: Tasks 3.1, 3.3
- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.store.ts`
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.quarantine.spec.ts`
- Plan reference: implementation-plan.md:529-575 (component 5)
- Pattern to follow: existing constants `:12-61`; real-store setup in `memory-lifecycle.store.spec.ts`
- Quality requirements: predicate on all 10 constants (DELETE_ARCHIVED_SELECT, ARCHIVE_SELECT,
  ARCHIVE_UPDATE, OVER_CAP, EVICT_ARCHIVAL_SELECT, EVICT_RECALL_SELECT, DELETE_CHUNKS inner select,
  DELETE_MEMORIES, ARCHIVE_COUNT, DELETE_COUNT). Predicates only — no service change, no new gate,
  `runStep` untouched, no salience/tier/archived_at write for quarantine.
- Validation notes: `memory-lifecycle.store.spec.ts:56-96` (INDEXED BY plans) and `:325-329` stay
  green with **no expectation edits**; every existing 443 lifecycle/retention spec passes unedited
  (M5 9(d)). New spec: quarantined archival-past-grace, recall-past-cutoff and over-cap rows survive
  one `runStep` pass with chunks, tier, archived_at unchanged; controls behave as 443 expects;
  `readPreview.overCap` excludes quarantined; restore then a second pass makes them eligible. Both drivers.

### Batch 3 verification

- All listed files exist with real implementations; `git diff` shows no edited expectation in existing lifecycle/retention specs
- `npx nx run-many -t test lint typecheck -p @ptah-extension/memory-curator` passes (tail output)
- Dual-driver rerun: `--testPathPatterns '"memory.store|corpus.store|memory-lifecycle|memory-retention"'` under `ELECTRON_RUN_AS_NODE=1` Electron passes
- `ptah_get_diagnostics` clean on changed files
- code-logic-reviewer and code-style-reviewer accept (logic reviewer checks the M5 inventory rows owned by comp. 4/5)

## Batch 4: MemorySearchService exact null scope + quarantine filter (memory-curator, M3 + M5) — COMPLETE (commit b8b8fefef)

- Wave: 2 (may be implemented alongside Batch 3; verified and committed after Batch 3)
- Recommended executor: backend-developer sub-agent
- Fallback executor: backend-developer re-run scoped to the failing spec
- Execution mode: sequential
- Rationale: one file serves both M3 (scope) and M5 (filter) — must not be split (plan :1117-1118);
  cache-key and upstream-filter reasoning needs one owner.
- Tasks: 1 | Depends on: Batch 2; Batch 3 (fixture version 48 and `restoreQuarantined` for the cache-bump case)
- Commit: `fix(memory-curator): scope searchRich exactly and filter quarantined rows from search`

### Task 4.1: Tri-state scope, cache key, and quarantine predicates on every search path — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\memory-search.service.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\memory-search.service.spec.ts`
- Plan reference: implementation-plan.md:577-652 (component 6); inventory :946-951
- Pattern to follow: existing `searchRichInner` fallbacks `:293-306,331-338`; `buildFilterClause` `:754-808`
- Quality requirements: `searchRich(query, topK, workspaceRoot?: string | null)` and private
  helpers tri-state (string → `IS ?`; `null` → `IS NULL`; `undefined`/`''` → no predicate);
  `IMemoryReader.search` signature unchanged. `makeCacheKey` encodes scope tag
  (`'\u0000null'` / ws / `'*'`) and the clamped limit; write counter looked up by actual scope
  (`''` for null/''/undefined). Quarantine: `bm25Search` always joins `memories m` +
  predicate; `vecSearchInner` predicate; `buildFilterClause` always pushes it (covers
  `listIndexRowsByFilter`, `fetchCompactRowsByIds`); `bm25SearchByMemory` and `vecSearchByMemory`
  filter upstream before LIMIT; `timeline` quarantined anchor → `{ rows: [], anchorIndex: 0 }` and
  predicate on before/after; `getObservations` predicate. No new query per call.
- Validation notes: KNN starvation is an accepted limitation (no refill loop). Mock-SQL tests keep
  working; update only expectations that inspect SQL text. New real-SQLite cases on both drivers per
  plan :637-649, including the "no quarantined rows → identical results" equivalence case and the
  `topK` 5 vs 10 cache case.
- Implementation details: failure behaviour unchanged (BM25 `[]` + warn, vector → BM25-only, rerank → RRF).

### Batch 4 verification

- Files exist; no stub markers; `search()` public signature unchanged
- `npx nx run-many -t test lint typecheck -p @ptah-extension/memory-curator` passes (after Batch 3 is committed)
- Dual-driver rerun: `--testPathPatterns '"memory-search"'` under Electron passes
- `ptah_get_diagnostics` clean
- code-logic-reviewer and code-style-reviewer accept

## Batch 5: MergeCandidateCollector + curator wiring and merge guard (memory-curator, M3 + M5 c8) — COMPLETE (commit d97a133f3)

- Wave: 3 (parallel with Batch 6 — different libs)
- Recommended executor: backend-developer sub-agent
- Fallback executor: backend-developer re-run scoped to the failing task
- Execution mode: sequential
- Rationale: new collaborator + constructor injection + guard in one service; DI-reach spec needs
  the whole chain; one lib, 5 files.
- Tasks: 2 | Depends on: Batch 3 (`getMergeTarget`), Batch 4 (`searchRich` null scope)
- Commit: `fix(memory-curator): add semantic tier-2 merge candidates and guard merge targets`

### Task 5.1: MergeCandidateCollector with D4 = B — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\curator-llm\merge-candidate-collector.ts`
  - CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\curator-llm\merge-candidate-collector.spec.ts`
- Plan reference: implementation-plan.md:654-699 (component 7, algorithm :672-699)
- Pattern to follow: `curator-llm/curator-window-runner.ts` (collaborator constructed by the service)
- Quality requirements: constructor `(logger, store: MemoryStore, search: MemorySearchService | null)`;
  exported `TIER2_PER_DRAFT_LIMIT = 5`, `TIER2_TOTAL_LIMIT = 25`, `TIER2_MAX_QUERIES = 10`,
  `TIER2_QUERY_MAX_CHARS = 512`; `collect(drafts, workspaceRoot, signal?)` returns
  `{ candidates, tier1Count, tier2Count, tier2Queries, bm25Only, tier2Skipped }`. Step 3 implements
  **option B only** (empty tier 1 → `[]`, `'tier1-empty'`), no runtime flag. Tier 1 first and never
  displaced; dedupe by id; defence skip when `hit.memory.workspaceRoot !== scope`; never calls
  `recordUse`. Not exported from the barrel.
- Validation notes: throw from `searchRich` → warn once, `tier2Skipped = 'error'`, keep collected
  rows, catch carries `// degradation-audit: optional-capability - …`. Spec cases per plan :757-767
  (ordering/dedupe, bounds 40×10 → ≤10 queries / ≤25 rows / ≤5 per draft, null vs '' scope,
  bm25Only propagation, partial-on-throw, B empty-tier-1 zero calls, abort, no recordUse spy).

### Task 5.2: Curator constructor injection, doCurate call, merge guard, DI reach spec — COMPLETE

- Depends on: Task 5.1
- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\memory-curator.service.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\memory-curator.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\di\register.spec.ts`
- Plan reference: implementation-plan.md:700-788
- Pattern to follow: optional-last `governor` param `memory-curator.service.ts:188-193`;
  `CuratorWindowRunner` construction `:195`; DI-reach precedent `di/register.spec.ts:1-60`
- Quality requirements: append
  `@inject(MEMORY_TOKENS.MEMORY_SEARCH, { isOptional: true }) search: MemorySearchService | null = null`
  AFTER `governor`; construct the collector; replace `:603-612` with the `collect` call + one debug
  line; guard at `:649-664` merges only when the id is in the candidate set AND
  `getMergeTarget(id, workspaceRoot ?? null)` is non-null, else info log
  `{ reason: 'not-in-candidates' | 'ineligible' }` and insert as new. `CuratorRunStats` unchanged;
  no registration change.
- Validation notes: existing positional spec construction stays valid. Service spec: tier-2 source
  invoked; out-of-list, other-workspace and quarantined targets inserted as new; candidate salience
  and hits unchanged after a pass without a merge. DI spec: resolve `MEMORY_CURATOR` via
  `registerPersistenceSqliteServices` + `registerMemoryCuratorServices` against a real temp DB with
  a stub `CURATOR_LLM`, run `curate()`, assert the registered `MEMORY_SEARCH.searchRich` was called
  with the pass's workspace root (seed an exact-subject tier-1 match so B runs tier 2).

### Batch 5 verification

- Files exist; collector implements B only; no stub markers
- `npx nx run-many -t test lint typecheck -p @ptah-extension/memory-curator` passes
- `npx nx run degradation-audit:lint` and `npx nx run di-lint:lint` pass
- `ptah_get_diagnostics` clean
- code-logic-reviewer and code-style-reviewer accept (logic reviewer checks M3 criteria 1-7 and the M5 c8 guard)

## Batch 6: Restore surface RPC + memory:get content filter (shared + rpc-handlers, M5, D2) — COMPLETE (commit 12252d5df)

- Wave: 3 (parallel with Batch 5 — different libs)
- Recommended executor: backend-developer sub-agent
- Fallback executor: backend-developer re-run scoped to the failing spec
- Execution mode: sequential
- Rationale: RPC types, map, handler, schema and surface spec must change together or the
  surface partition spec breaks; 2 libs + 1 app spec.
- Tasks: 2 | Depends on: Batch 3 (`listQuarantined`, `restoreQuarantined`, `getActiveById`)
- Commit: `fix(rpc-handlers): add memory quarantine list and restore rpc methods`

### Task 6.1: Shared RPC types and method map — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\shared\src\lib\types\rpc\rpc-memory.types.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\shared\src\lib\types\rpc.types.ts`
- Plan reference: implementation-plan.md:792-807, :828-833
- Pattern to follow: `memory:purgeJunk` entries at `rpc-memory.types.ts:100-135`,
  `rpc.types.ts:377-385,1693-1715,3706-3720`
- Quality requirements: `memory:listQuarantined` params
  `{ workspaceRoot?: string | null; scope?: MemoryQueryScope; reason?: string; limit?: number; offset?: number }`,
  result `{ items: {id, workspaceRoot: string | null, subject, kind, tier, reason, quarantinedAt, excerpt}[]; total }`;
  `memory:restoreQuarantined` params `{ workspaceRoot: string | null; ids?: string[]; reason?: string; all?: boolean }`
  (workspaceRoot a required key), result `{ restored: number }`.

### Task 6.2: Handlers, zod schema, memory:get switch, specs, VS Code surface list — COMPLETE

- Depends on: Task 6.1
- Files:
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.schema.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts`
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.schema.spec.ts` (exists; zod cases belong here)
  - MODIFY `D:\projects\ptah-extension-memory-quality-source\apps\ptah-extension-vscode\src\di\rpc-surface.spec.ts`
- Plan reference: implementation-plan.md:789-860 (component 8)
- Pattern to follow: `resolveReadScope` `memory-rpc.handlers.ts:185-192`; destructive-call
  authorization `:420-439`; `METHODS` `:111-127`; expected-absent list `rpc-surface.spec.ts:80-105`
- Quality requirements: schema `workspaceRoot: z.union([z.string().min(1), z.null()])` (not
  optional), exactly one selector, ≤500 ids, reason `^rule:[a-z0-9-]+$`. String scope must pass
  `isAuthorizedWorkspace` else `RpcUserError('UNAUTHORIZED_WORKSPACE')`; explicit `null` accepted
  and logged info `{ scope: 'unscoped' }`. SQL failure → `RpcUserError(..., 'PERSISTENCE_UNAVAILABLE')`,
  no row content logged. `memory:get` (`:240-258`) switches to `getActiveById`: quarantined id →
  `{ memory: null, chunks: [] }`, no use recorded. No `includeQuarantined` flag; no manual
  quarantine RPC. Append both names to `METHODS` (manifest picks them up) and to the VS Code
  expected-absent list.
- Validation notes: spec cases per plan :844-853 — omitted key, zero/two selectors, bad reason,
  unauthorized ws; named and explicit-null restore against a real store with cross-scope isolation
  both ways; list tri-state with `workspaceRoot` on every item; `memory:get` null then memory after restore.

### Batch 6 verification

- Files exist; no stub markers
- `npx nx run-many -t test lint typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers ptah-extension-vscode` passes (check the `for 3 projects` header)
- `ptah_get_diagnostics` clean
- code-logic-reviewer and code-style-reviewer accept (logic reviewer checks authorization and the null-scope isolation)

## Batch 7: Round-trip spec, measurement harness, test-report (verification) — COMPLETE (commit 7e0b84987; task-folder artifacts in the docs(task-specs) commit)

- Wave: 4 (last)
- Recommended executor: senior-tester sub-agent (devops-engineer only if the esbuild/Electron harness invocation needs help)
- Fallback executor: senior-tester re-run with the failing measurement isolated
- Execution mode: sequential
- Rationale: plan assigns the round-trip spec, harness and report to senior-tester; LLM-backed
  measurements on real-DB copies need one owner and the copy protocol.
- Tasks: 3 | Depends on: Batches 1-6 (all committed)
- Commit: `fix(memory-curator): add quarantine round-trip spec and memory quality measurements`
  (also carries the task-folder artifacts: harness, test-report.md, batches.md and the planning docs)

### Task 7.1: quarantine.round-trip.spec.ts — COMPLETE

- File: CREATE `D:\projects\ptah-extension-memory-quality-source\libs\backend\memory-curator\src\lib\quarantine.round-trip.spec.ts`
- Plan reference: implementation-plan.md:864-891
- Pattern to follow: real-SQLite setup in `retention/retention-sqlite.test-support.ts` and `di/register.spec.ts`
- Quality requirements: both drivers, real SQLite + sqlite-vec. Seeds R4 rows in a named workspace
  AND the NULL workspace, active controls, one exact-subject tier-1 match (so B runs tier 2); apply
  48 and 49 with production SQL; insert a corpus link for one quarantined row; assert exclusion on
  `search`, `searchRich`, `searchIndex`, `listAll`, `findMergeCandidates`, `collect` (tier 2),
  `timeline`, `getObservations`, corpus members, `getActiveById`; restore `{all:true}` for ws then
  null; assert inclusion on every path for every restored row with content, chunks, subject,
  salience, tier, archived_at, pinned, hits, last_used_at unchanged and both quarantine columns NULL.
  Exactly one round-trip spec in the repo.

### Task 7.2: Measurement harness and test-report.md — COMPLETE

- Files: CREATE `D:\projects\ptah-extension-memory-quality-source\.ptah\specs\TASK_2026_563_2939\harness\` (`lib/copy-db.ts`, `lib/connection.ts`, `lib/embedder.ts`, `lib/llm.ts`, `copy-audit.ts`, `merge-replay.ts`, `extract-eval.ts`, `README.md`); CREATE `D:\projects\ptah-extension-memory-quality-source\.ptah\specs\TASK_2026_563_2939\test-report.md`
- Plan reference: implementation-plan.md:892-940, measurement plan :1006-1044
- Quality requirements: copy protocol (verify snapshot SHA-256 `2661275c…7810`; backup-API copies
  into `%TEMP%\mqs-563-eval\`; refuse `.ptah\state` and `ptah*`; never open, migrate or touch the live
  DB or its `-wal`/`-shm`); MCP tools OFF in LLM runs. Report every measurement: M5 migration
  (counts, integrity, ordered hashes, duration), M5 rules (only `rule:commitlint-scope-facts` = 89),
  KNN starvation, relevance Q1-Q4 (branch ≥ main re-measured AND ≥ 16/20; restore gives identical
  ids; per plan r4 and B4 logic finding 3, "main" = BASE-COMMIT ebfc73321 code on an unmigrated copy of the same snapshot, never the comp. 6 neutrality spec), M3 reach 8(a) incl. the `HTTPS_PROXY=http://127.0.0.1:9` local proof, M3 replay 8(b) for
  before / After-A / After-B with extra resolve calls (After-B must be 0), M4 extraction labelled
  "prompt-only, limited evaluation", latency main vs branch.
- Validation notes: verify the two harness assumptions first (SDK option names at
  `sdk-query-runner.service.ts:530-540`; `readHistoryForCuration` stubs at `:679-753`). If D4 = B
  fails 8(b), report it plainly — not hidden, not re-scoped.

### Task 7.3: Final scoped verification — COMPLETE

- Depends on: Tasks 7.1, 7.2
- Quality requirements: run and record in test-report.md:
  - `npx nx run-many -t test lint typecheck -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/shared @ptah-extension/rpc-handlers ptah-extension-vscode @ptah-extension/messaging-gateway @ptah-extension/skill-synthesis @ptah-extension/cli-engine @ptah-extension/thoth-runtime @ptah-extension/task-specs @ptah-extension/cron-scheduler` — header must read `for 12 projects`
  - `npx nx run degradation-audit:lint` and `npx nx run di-lint:lint`
  - dual-driver SQLite rerun for memory-curator and persistence-sqlite under `ELECTRON_RUN_AS_NODE=1` Electron
  - `ptah_get_diagnostics` on every changed file

### Batch 7 verification

- Round-trip spec, harness files and test-report.md exist with real content; every measurement row in the plan's measurement plan has a number or an explicit, reasoned failure
- `npx nx run-many -t test lint typecheck -p @ptah-extension/memory-curator` passes, and Task 7.3's 12-project run is green
- code-logic-reviewer and code-style-reviewer accept the spec and harness
- After commit: push `fix/memory-quality-source`, open the PR (`## Summary` + `## Test plan`, citing test-report.md numbers), set `task.md` status to `in_review` (orchestrator), keep the worktree

## Follow-ups recorded (non-blocking)

- B1 style (minor): the `schemaBlock` slice in `extract-prompt.spec.ts:49-53` breaks easily if the text around it moves, and `resolve-prompt.ts:40-54` has inline typing. B1 logic (optional): reword the opening of `RESOLVE_SYSTEM_PROMPT` ("same subject") to "states the same fact, decision or preference".
- B2 style (minor): stale describe titles and comments in the ratchet specs ("TASK_2026_511 appends migration 47…", and 0047's "is registered once as the latest"). Accepted as a follow-up; the batch was not reopened.
- Out of scope: the dead duplicate `memory-curator/src/lib/curator-llm/resolve-prompt.ts`.
- B4 deviation, accepted by the orchestrator and to be disclosed in the PR: `bm25SearchByMemory` threw on main ("unable to use function bm25 in the requested context"), so `mem:searchIndex` and the corpus build ranked on vectors only. It is fixed with a MATERIALIZED CTE, and the ranking of `searchIndex` changes as a result. Pre-existing and out of scope: the `''` scope is handled inconsistently between `buildFilterClause` and `bm25SearchByMemory`, and a named-workspace insert does not bump the `''` counter.
- B3 was returned by review (logic NEEDS_REVISION 6/10). Blocking: `setPinned` silently does nothing for a quarantined row, yet `memory:pin`/`unpin` report success. The fix is in progress: `setPinned` returns a boolean; the RPC half of the fix moved to B6. The same fix adds a NULL-scope stats test and a restore-failure test. A cross-batch fix from the B4 review also lands here: every named-workspace write now bumps the global `''` cache generation. B3 style minors, as follow-ups: `memory.store.ts` is 1007 lines, the barrel is 219 lines, and there is formatting noise.
- B4 was returned by review (logic NEEDS_REVISION 5/10): cache-key escaping, the `searchIndex` `''` scope, relabelling the equivalence spec, and regression specs for real insert/forget cache invalidation. Fix in progress.
- B5: `memory-curator.service.ts` was already over the lint max-lines limit of 700 on base (805 lines) and is now 861. Recorded as a follow-up. The DI reach spec replaces `EMBEDDER` and `KNOWLEDGE_AGENT_SERVICE` with stubs; the real `MemorySearchService` and `MemoryStore` are still resolved.
- B3-B6 commits: all four passed the scoped run `-p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/rpc-handlers ptah-extension-vscode` on the full tree before committing. The only failure was the known environment case in rpc-handlers, `harness-skill-selection-rpc.service.spec.ts` › "never writes state.json" (3355 passed / 1 failed / 4 skipped). It fails because `C:\Users\abdal\AppData\Local\Temp\.ptah` exists on this machine; it is unrelated, and the folder was not touched.
- The commits run B3 → B4 → B5 back-to-back, then B6. B3 changes the `appendChunks` contract, and its only production caller is in `memory-curator.service.ts` (a B5 file), so memory-curator does not typecheck at `f453bfebf` and `b8b8fefef`; it does from `d97a133f3` on. B3's commit body says so. Folding the call site into B3 would have meant partially staging a file that also holds B5 changes, and that needs interactive git, which is not allowed. B6 depends only on the boolean `setPinned` from B3, and changing a `void` return to `boolean` breaks no existing caller.
- B4 logic verdict: the recheck file still reads REVISE (7/10). Its only open item, finding 3, asks for a correction to the measurement handoff, not to the code ("runtime cache fixes are accepted", review :173, :184). Plan r4 :649 and :1026 now define the main baseline as the base-commit code, and Task 7.2 carries that rule. I accepted the finding as closed by that document correction, and I record that here instead of treating it as a code rejection.
- B6 logic minor (follow-up): a test that unpinning an already-pinned quarantined row keeps pinned=1 after restore. B6 style minor: a stale count in a handler docstring.
- B7: logic APPROVED 8/10 (after rounds 1-2), style APPROVED 8/10 (1 minor). Measured gates that fail are disclosed in `test-report.md`, not hidden:
  - M3-8(b) fails for the shipped variant B: After-B merged 7/23 vs Before 8/23. After-A, which is not shipped, merged 20/23. Plan :218 says a contradicted estimate returns the D4 choice to the user.
  - M4-8(a) passes on count (145 → 126) but fails on share (98.0% → 99.2%).
  - Relevance: branch 9/20 = main 9/20, so it passes "≥ main", but it fails the literal "≥ 16/20" gate.
- Raw memory and transcript outputs are deliberately left untracked; the repo is public. They are `harness/output/*.json`, `*.jsonl`, `*.tsv` and `m4-draft-classifications.md`.
