# Batches - TASK_2026_578_3b00

Total tasks: 43 | Batches: 14 | Complete: 3/14

Root of every path below: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/` (branch
`feat/task-578-skill-lifecycle`, base `c4ab013f3`). `SS` = `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib`.
Every path is written out in full in the task entries.

## Recorded defaults (execution preferences from the orchestrator prompt and implementation-plan.md handoff)

- Order follows the plan's component graph `1 → (2,3,4) → (5,6,7) → (8,9,11,12) → 10 → 16`, with 13 early and
  14/15 after the TASK_2026_586 rebase. UI (Batch 14) is last so it rebases on 586.
- **Additive first, deletions last.** Old paths (`clusterCandidates`, `synthesizeFromCluster`, `buildClusterPrompt`,
  `insertPending`, `hasExistingForCluster`, `listInvocations`) stay alive until the batch that removes their last
  caller, so every intermediate commit typechecks and tests green. Batch 12 deletes all of them. No shim survives
  Batch 12.
- **File count convention:** the 6-file ceiling counts production files; each production file's co-located spec
  travels with it. Batch 1 is the one documented exception (12 one-line spec bumps the coordinator requires to land
  atomically with the migration).
- **Executors and review (cross-side rule):** CLI lanes are antigravity only, at most 2 in flight (Codex
  unavailable, Glm at quota). A batch authored by an in-process sub-agent is reviewed by an antigravity CLI lane;
  a batch authored by an antigravity lane is reviewed by an in-process reviewer sub-agent.
- **Disk:** no `npm ci`/`npm install` (node_modules is a junction). Only scoped `npx nx run <project>:<target>`
  commands; tail or filter output.
- **No-touch list (every batch):** `libs/backend/agent-sdk`, `libs/backend/cli-agent-runtime`, rpc-handlers
  session/chat handlers, `libs/frontend/chat-state`, `libs/frontend/chat`, the sessions sidebar,
  `libs/shared/src/lib/messages/index.ts`, `MESSAGE_TYPES`, the payload map, and
  `libs/shared/src/lib/types/rpc.types.ts` (no batch needs it: no new RPC method or param; if any executor finds it
  must add one, stop and report — the orchestrator tells the coordinator first). No archaeology pipeline work
  (TASK_2026_588 owns it).

### Gates the orchestrator owns

- **G-580 (before Batch 1 commit):** notify the coordinator session (TASK_2026_580/584) that `0051_skill_lifecycle`
  and the 12 spec bumps are about to be committed. Do not commit Batch 1 before that notice is sent.
- **G-586 (before Batch 10 starts):** rebase `feat/task-578-skill-lifecycle` onto TASK_2026_586. Preferred: after
  586 merges to `main`, `git fetch && git rebase origin/main`. 586 is not merged as of 2026-10-01 (branch
  `fix/task-586-thoth-activity-feed`, HEAD `98b165ba9`, batch 3 of its run committed). If Batches 1-9 finish first,
  pause; do not rebase onto an unmerged 586 branch that may still be rewritten. After the rebase confirm
  `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-diagnostics-accordion.component.ts` is gone.
- **G-580-merge (whenever 580 lands first):** the second to merge rebases the `index.ts` order and moves all 12
  asserts to the higher number, keeping both comment lines.
- **G-580 RESOLVED (2026-10-01).** Coordinator (TASK_2026_584/580 orchestrator) replied "ok: commit 578 migration
  0051 and the 12 asserts as described"; reply recorded verbatim in context.md (Cross-session coordination). The
  runner applies by the `schema_migrations` set and only writes `PRAGMA user_version` (rewritten to max(applied)),
  so 0050 after 0051 is safe — this closes the Batch 1 review note on user_version. 578 likely merges first; the 580
  side owns the G-580-merge rebase. G-586 (PR #620) still gates Batch 10.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 — the 2 live accepted suggestions' registry rows may be `authored` or `synth`; reconcile accepts either when
  `<activeRoot>/<slug>/SKILL.md` exists and slug is `s` or `s-2..s-5`. Unverified (needs a live DB copy); Task 9.3
  implements both branches with spec cases, and senior-tester re-checks on the DB copy in QA.
- A2 — user-layer clone of a retired synth source is reaped by `UserLayerMirrorService.reconcileAll`. Verified by
  plan and review round 1; no task change.
- A3 — union-find `agglomerate` must keep label values. Verified on disk: `SS/cosine-similarity.spec.ts:24-25`
  asserts label arrays (`[0]`). Task 5.2 uses "label = lowest member index in discovery order" and must keep every
  existing case green.
- A4 — Skill tool `command` slug equals the materialized directory slug. Unverified; checked by Batch 13 proof 3
  (suffixed slug counted, base slug not).
- A5 (new) — TASK_2026_586's post-merge `skill-pipeline-status.component.ts` takes a by-status input typed
  `SkillByStatusCounts`. Unverified until G-586; Task 14.2 reads 586's version first and extends whatever type it
  uses.
- A6 (new) — `skillSynthesis.retirement.*` keys are only readable as file-based settings once registered in
  `FILE_BASED_SETTINGS_KEYS`. Batch 2 registers them before Batch 7 reads them.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-a: Plan says `0044` and `0046` "list versions in an array" and should "gain 50, 51". On disk both are multi-line `toBe(\n 49,\n)` asserts (`0044_memory_lifecycle.spec.ts:68-70`, `0046_memory_merge_subject_index.spec.ts:33-35`). Adding 50 anywhere would fail: 0050 is not on this branch or on `origin/main`. | HIGH | Task 1.3: all 12 become `toBe(51)`; no array edits; no 50 anywhere. |
| R-b: Plan says place the 578 comment "directly under 580's" line, but 580's line does not exist on this branch. | LOW | Task 1.3: add `// 51 since TASK_2026_578 appended 0051_skill_lifecycle.` directly under the existing `// 48 and 49 since TASK_2026_563 ...` line; G-580-merge reconciles ordering. |
| R-c: `SkillCandidateStore.listInvocations` has a production caller outside the lib (`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:495`). Deleting it in the store batch breaks rpc-handlers. | HIGH | Batch 3 adds `listInvocationEvents` and keeps `listInvocations`; Batch 11 moves the RPC; Batch 12 deletes it. |
| R-d: Removing `clusterCandidates`/`synthesizeFromCluster`/`insertPending`/`hasExistingForCluster` before the curator rewrite breaks the curator and `SS/gates/cluster-holdout-end-to-end.spec.ts` (mocks all four, `:228-254`), which the plan does not list. | HIGH | Additive in Batches 4-5; curator rewrite in Batch 9 retargets `cluster-holdout-end-to-end.spec.ts` to `SkillUmbrellaMergeService`; deletions in Batch 12. |
| R-e: 586 also edits `SS/diagnostics.types.ts` (+12), `SS/diagnostics.service.spec.ts`, `SS/skill-synthesis.service.ts` (+68), `libs/backend/skill-synthesis/src/index.ts` (+1) — the plan's collision table names only some of these. | MEDIUM | Every one of those files is edited only in Batches 10-14, after G-586. `index.ts` edits are confined to Batch 12 (post-rebase). |
| R-f: Re-entrant `inImmediateTransaction` only tracks nesting through `SkillCandidateStore`. Any store method that opens its own transaction (`SkillCandidateStore.setPin` uses `db.transaction`, `skill-queue.store.ts:698`, `cleanup/skill-backlog-cleanup.store.ts:267`) called inside the shared transaction would throw "cannot start a transaction within a transaction". | MEDIUM | Tasks 6.1, 8.1, 9.2: inside `inImmediateTransaction` callbacks only plain-statement methods are called (`registerCandidate`, `promoteAtomically` (re-entrant), `rejectIfStatus`, suggestion-store writes, `registry.upsert/remove`, `purgeState.markComplete`). Reviewers check every callback body. |
| R-f2 (Batch 3 review MODERATE-1, F-1): `inImmediateTransaction` nests without a SAVEPOINT (`skill-candidate.store.ts:710-731`). If code inside a callback catches an inner write's error and continues, the inner writes made before the throw commit with the outer transaction (partial unit). No savepoint is by design and documented (`:700-709`). | MEDIUM | Caller rule, enforced in Tasks 6.1, 8.1, 9.2 and their reviews: no `try/catch` inside an `inImmediateTransaction` callback (or inside any function it calls) may swallow an error from a store write; a catch there must rethrow. Per-item fail-soft (`per-cluster try/catch` in 8.1, `{accepted:false}` in 9.2, DB-throw cleanup in 6.1) wraps the whole `inImmediateTransaction(...)` call, never sits inside it. Each of those batches adds one spec case proving a mid-callback throw leaves no partial row. |
| R-l (Batch 3 review MODERATE-2, F-2): `listActiveOrderedByDecayScore` runs one events query per resident promoted row (`skill-candidate.store.ts:451-464`, N+1). Bounded by the resident cap; the statement is prepared once. Not a correctness defect. | LOW | Recorded follow-up, not fixed in this task: a single grouped query would also count against the R-h line budget Batch 12 must meet. Carried to the Mode 3 / QA handoff for `future-enhancements.md`. Revisit if the resident cap is raised past a few hundred. |
| R-g: `SkillSuggestionStore.accept(id)` signature gains `promotedCandidateId`; the current curator calls `accept(id)` at `SS/skill-curator.service.ts:602`. | LOW | Task 4.2 makes it `accept(id, promotedCandidateId: string | null)` and updates that single call site to pass `null`; Batch 9 replaces it. |
| R-h: `skill-candidate.store.ts` is 1699 lines; max-lines warning must not grow. | MEDIUM | Batch 3 deletes `listActiveOrderedByActivity`; Batch 12 deletes `listInvocations` (+ `toInvocationRow` if unused). Batch 3 report states the line delta; Batch 12 states the final delta (target ≤ +60 net). |
| R-i: `SS/di/register.spec.ts` may assert the registered token set or the curator's resolved graph. | LOW | Tasks 4.5, 7.2, 8.2 and 9.1 run it and extend it for each new token. |
| R-j: Destructive filesystem removal of an active SKILL.md (retirement, accept merges). | HIGH | Task 7.1 containment check (inside `activeRoot()`, basename = `row.name`), spec case for an outside path. |
| R-k: LLM-supplied reference names reach `path.join`. | HIGH | Task 5.4 Zod regex at the LLM boundary; Task 5.1 regex re-check at the filesystem boundary with `../x` and `a/b` spec cases. |
| R-l: Track B's prompt surface (`buildSystemPrompt`) must not change. | MEDIUM | Task 5.4 snapshot spec of the `buildSystemPrompt` string. |
| R-m: 586 unmerged blocks Batches 10, 11, 13 tail, 14. | MEDIUM | G-586 gate; Batches 1-9 carry no 586-shared file. |

Edge cases:

- Slug collision on accept (`<slug>` dir exists) → `<slug>-2` stored in `name` — Tasks 5.1, 6.1, 13.1.
- UNIQUE violation on `name` inside the promotion transaction rolls back the demotion and removes the directory —
  Tasks 3.2, 6.1.
- Nested transaction throws in the inner call → outer rolls back — Task 3.2.
- `rejectIfStatus` loses a race (another host decided) → logged, skipped, not counted — Tasks 3.3, 6.2, 7.1, 8.1.
- Pool truncated / vec unavailable → purge skipped, no marker — Task 8.1.
- Corrupt `references_json` → `[]` with a warn — Task 4.2.
- Missing `skill_backlog_purge_state` table → `read()` returns null after a warn, purge skips — Task 4.4.
- Invalid N/M settings → defaults 30/30 — Task 7.1.
- Pinned, authored or diverged skills exempt from retirement and pool — Tasks 5.3, 7.1.
- Event at day 50 resets the idle clock — Task 7.1.
- Unscored/disabled umbrella judge → nothing written, retried next pass — Task 8.1.
- User dismisses an umbrella → candidate members stay merged (recorded in the report) — Task 9.1.
- Accept with a pinned member → member skipped — Task 9.2.
- Reconcile with an ambiguous or missing slug → warn, row left for next start; second start is a no-op — Task 9.3.

---

## Batch 1: Migration 0051_skill_lifecycle — COMPLETE (commit faa550fb0)

- Recommended executor: CLI lane x 1 (antigravity) — mechanical, fully specified DDL and one-line bumps
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Reviewer (cross-side): code-logic-reviewer sub-agent (in-process)
- Rationale: static SQL plus 13 one-line edits in one lib; one self-contained prompt; no design decisions.
- Tasks: 3 | Depends on: none
- **COORDINATION FLAG (G-580): the orchestrator must notify the coordinator session (TASK_2026_580/584) BEFORE this
  batch is committed.** File-count exception: 15 files, all in `persistence-sqlite`, 12 of them one-line bumps that
  must land atomically with the migration.
- Verification command: `npx nx run @ptah-extension/persistence-sqlite:test` (tail the summary), plus
  `npx nx run @ptah-extension/persistence-sqlite:lint` filtered to the touched files.

### Task 1.1: Create migration 0051 and its spec — COMPLETE

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/persistence-sqlite/src/lib/migrations/0051_skill_lifecycle.ts`;
  CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/persistence-sqlite/src/lib/migrations/0051_skill_lifecycle.spec.ts`
- Plan reference: implementation-plan.md:249-288
- Pattern to follow: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.ts` (static SQL, one-row table) and its spec; `0049_memory_sediment_quarantine.ts`
- Quality requirements: static SQL only, no `${`; three nullable columns on `skill_suggestions` (`merged_into`,
  `promoted_candidate_id`, `references_json`) with no DEFAULT/CHECK; `skill_backlog_purge_state` one-row table
  (`id INTEGER PRIMARY KEY CHECK (id = 1)`, `cutoff_created_at`, `completed_at`, `rejected INTEGER NOT NULL DEFAULT 0`).
- Validation notes: R-a. The spec applies migrations ≤ 49 then 51 (no 0050 exists here) and asserts columns,
  table, NULL on pre-existing suggestion rows, and that the SQL does not depend on any 0050 object.
- Implementation details: export the SQL constant; spec mirrors 0045's registration/`not.toContain('${')` checks.

### Task 1.2: Register 0051 in the migration index — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
- Depends on: Task 1.1
- Plan reference: implementation-plan.md:282, 1126
- Pattern to follow: the 0049 import and entry at the end of `MIGRATIONS`
- Implementation details: one import plus `{ version: 51, name: '0051_skill_lifecycle', sql: sql0051SkillLifecycle }`
  appended after version 49.

### Task 1.3: Bump the 12 latest-version specs to 51 — COMPLETE

- Files (all under `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/persistence-sqlite/src/lib/migrations/`):
  `0028_gateway_conversation_workspace_root.spec.ts:82-83`, `0030_skill_event_metrics.spec.ts:37-38`,
  `0038_gateway_message_turn_state.spec.ts:90-91`, `0039_reap_orphaned_queue_rows.spec.ts:64-65`,
  `0040_skill_candidate_workspace_root.spec.ts:77-78`, `0041_skill_md_migration_state.spec.ts:61-62`,
  `0042_db_integrity_check_state.spec.ts:69-70`, `0043_memory_retention.spec.ts:53-54`,
  `0044_memory_lifecycle.spec.ts:67-70`, `0045_skill_backlog_cleanup.spec.ts:32-33`,
  `0046_memory_merge_subject_index.spec.ts:32-35`, `0047_memory_retention_health.spec.ts:33-34`
- Depends on: Task 1.2
- Plan reference: implementation-plan.md:283-287 (corrected by R-a, R-b)
- Validation notes: R-a — all 12 are `toBe(49)` asserts (0044 and 0046 are multi-line formatted, not arrays). Change
  each to 51. Do not add 50 anywhere. R-b — add `// 51 since TASK_2026_578 appended 0051_skill_lifecycle.` on the
  line directly under the existing `// 48 and 49 since TASK_2026_563 ...` comment.

### Batch 1 verification

- 0051 files exist, index entry present, all 12 asserts read 51 with the comment line
- `npx nx run @ptah-extension/persistence-sqlite:test` passes
- Coordinator notified (G-580) before commit
- In-process reviewer accepted

### Batch 1 review record

- Verdict: APPROVED (code-logic-reviewer, in-process, 8/10; `code-logic-review.md` section `## Batch 1`). Minor
  only, not blocking: header comment `0051_skill_lifecycle.ts:25` says "IDEMPOTENT" though exactly-once comes from
  the runner; garbled wording at `:20`; `PRAGMA user_version` would drop 51→50 when 0050 lands later (no gate
  depends on it; G-580-merge handles ordering).
- Prettier defect on `0051_skill_lifecycle.spec.ts` fixed by the orchestrator (`prettier --write`); migrations
  folder passes `prettier --check`.
- Commit was held for G-580 until the coordinator replied (2026-10-01, see Gates). Pre-commit re-check:
  persistence-sqlite test 46 suites / 541 passed / 3 skipped. **Committed `faa550fb0`** (15 explicit paths).

## Batch 2: File-based settings keys and docs — COMPLETE (commit 3b739b40f)

- Recommended executor: CLI lane x 1 (antigravity)
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Reviewer (cross-side): code-style-reviewer sub-agent (in-process)
- Rationale: append-only registration plus one default literal and a docs table; file-disjoint from Batch 1, so it
  may be in flight alongside Batch 1 (2 lanes), but it is verified and committed after Batch 1.
- Tasks: 2 | Depends on: none
- Verification command: `npx nx run @ptah-extension/platform-core:test` (tail)

### Task 2.1: Register retirement keys and raise the pool default — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/platform-core/src/file-settings-keys.ts` (+ `file-settings-keys.spec.ts` in the same folder if it asserts key/default parity)
- Plan reference: implementation-plan.md:836-857
- Pattern to follow: `skillSynthesis.replayValidation.*` registration (`file-settings-keys.ts:309-310`, `:573,583`)
- Implementation details: add `skillSynthesis.retirement.dormantAfterDays` and
  `skillSynthesis.retirement.retireAfterDormantDays` to `FILE_BASED_SETTINGS_KEYS` (near `:241-244`) and to
  `FILE_BASED_SETTINGS_DEFAULTS` (near `:530-533`) with value 30; change `skillSynthesis.suggestionMaxCandidates`
  default 200 → 1000 at `:533`. Do NOT touch `SS/skill-synthesis.service.ts:153` (586-shared; Batch 10).
- Validation notes: A6.

### Task 2.2: Settings docs table — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`
- Plan reference: implementation-plan.md:850-851
- Implementation details: `suggestionMaxCandidates` row (`:42`) → `1000`; add two rows for the retirement keys
  (default `30`, describing dormant after N idle days and retired M days after dormancy; pinned and user-authored
  exempt). Keep the table's column alignment.

### Batch 2 verification

- Keys and defaults present; docs rows present; platform-core tests pass; reviewer accepted

### Batch 2 write-path trace (team-leader, on disk)

- Registered default is consulted only when the caller passes no fallback (`platform-core/src/file-settings-manager.ts:83-91`:
  stored value → caller default → registered default).
- Reader 1, runtime: `SS/skill-synthesis.service.ts:1366-1369` `readSettings()` passes `SETTINGS_DEFAULTS.suggestionMaxCandidates`
  (`:153`, still `200`), so the curator/clustering (`SS/skill-clustering.service.ts:46`) keeps using 200 for users with no
  explicit value until Batch 10 Task 10.2 changes that literal.
- Reader 2, settings panel: `rpc-handlers/.../skills-synthesis-rpc.handlers.ts:529-549` `skillSynthesis:getSettings` falls back
  to `FILE_BASED_SETTINGS_DEFAULTS`, so the panel shows 1000 immediately (Zod max 5000, `skills-synthesis-rpc.schema.ts:91`).
- Interim split (Batch 2 → Batch 10, spans the G-586 pause): panel shows 1000, runtime uses 200; saving the panel persists
  whatever the form submits as an explicit value. Users with an explicit stored value are unaffected by either change.
- Retirement keys: no runtime reader until Batch 7 (A6); getSettings only iterates `SkillSynthesisSettingsSchema.shape`,
  which does not include them, so they are not surfaced in the panel.

### Batch 2 review record

- Verdict: APPROVED (code-style-reviewer, in-process, 8/10; `code-style-review.md` section `## Batch 2`). platform-core
  typecheck/test/lint pass; keys at `file-settings-keys.ts:245-246` and `:536-537`; `SS/skill-synthesis.service.ts:153`
  untouched. Condition: Batches 7 and 10 ship in the same PR (interim 1000-panel / 200-runtime split, retirement docs
  ahead of the Batch 7 reader).
- **Pre-commit docs fix-up required (team-leader decision; the commit is held for G-580 anyway, so it costs no time).**
  Sent back to the Batch 2 executor, `settings.md` only:
  - F-1 (`settings.md:8`): the "80 / 48" key count is wrong (reviewer counts 82 / 50; the 2-key undercount predates
    this task). Drop the hard numbers, e.g. "All `skillSynthesis.*` keys (the named keys plus 8 fields for each of
    the 4 lanes) live in ...", so the sentence stops drifting each time a key is added.
  - F-2 (`settings.md:43-44`): the exemption is not "user-authored". The rule (implementation-plan.md:736-737) is:
    pinned, or the registry row has `clone_status` `authored` or `diverged` (user-authored or user-edited).
  - F-3 (`settings.md:44`, minor, include it): replace "Days of remaining dormant without use" with wording that says
    retirement happens at `dormantAfterDays + retireAfterDormantDays` idle days (plan :739-740), the row is retired,
    and its skill directory is deleted.
  - Keep the table's column alignment; run `npx prettier --check` on the file. No other file is touched.
- Re-verification after the fix-up: the team-leader reads the diff on disk; no new reviewer round, because the change
  is a docs-only correction of the reviewer's own findings.
- **Commit HELD behind Batch 1 (G-580).** Commit order: Batch 1, then Batch 2.
- Fix-up re-verified on disk (team-leader, `git diff` of `settings.md`): F-1 — `:8` now reads "All `skillSynthesis.*`
  keys live in ..." with no counts; F-2 — both retirement rows say "Pinned, user-authored or user-edited skills are
  exempt."; F-3 — `retireAfterDormantDays` row states `dormantAfterDays` + `retireAfterDormantDays` idle days in total
  and that retirement retires the row and deletes its skill directory. `suggestionMaxCandidates` row reads `1000`;
  table columns re-aligned. Only `settings.md` changed. **Batch 2 ACCEPTED.** Pre-commit re-check: platform-core
  test 46 suites / 1002 passed / 4 todo. **Committed `3b739b40f`** (3 explicit paths), after Batch 1.

### Stacking decision (uncommitted Batches 1-2 still on disk)

- Batch 3 may be implemented and reviewed now. It is file-disjoint from Batches 1 and 2 (skill-synthesis lib vs
  persistence-sqlite, platform-core and docs). It reads only existing columns (`skill_candidates`,
  `skill_invocation_events`), so a renumber or rework of 0051 after the coordinator replies cannot invalidate it.
  Its executor is an in-process sub-agent, so it does not compete for the 2 antigravity slots with the Batch 2
  fix-up lane.
- Stacking ceiling: Batch 3 only. Batch 4 consumes the 0051 columns (`merged_into`, `promoted_candidate_id`,
  `references_json`, `skill_backlog_purge_state`) and the shared DI registries. It does not start until Batch 1 is
  committed, because the coordinator may still change 0051.
- Batch 3 commits only after Batches 1 and 2. Every commit stages an explicit path list (never `git add -A`). No
  stash anywhere, because the stash stack is shared across worktrees.
- If G-580 is still unsent when Batch 3 passes review, stop and escalate to the user: three held batches is the limit.

## Batch 3: SkillCandidateStore lifecycle primitives — COMPLETE (commit 3a3cfcc85)

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: tightly coupled edits in one 1699-line file (transaction helper, CAS write, reads, stats).
- Tasks: 6 | Depends on: Batch 1
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test --testFile=skill-candidate.store.spec.ts`
  then `npx nx run @ptah-extension/skill-synthesis:typecheck`

### Task 3.1: Reason constants — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/types.ts`
- Plan reference: implementation-plan.md:316-317
- Implementation details: export `MERGED_INTO_PREFIX = 'merged-into:'`, `RETIRED_UNUSED_REASON = 'retired:unused'`,
  `BACKLOG_PURGE_REASON = 'backlog-purge: unclustered >30d'`.

### Task 3.2: Slug-aware promoteAtomically and re-entrant public transaction — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` (+ `skill-candidate.store.spec.ts`)
- Plan reference: implementation-plan.md:294-299
- Pattern to follow: `promoteAtomically` `:467-542`, `inImmediateTransaction` `:637-647`
- Validation notes: R-f. Depth counter owned by the store; do not rely on `db.inTransaction`
  (`skill-synthesis.reachability.test-support.ts:100-115`). Only the outermost call issues BEGIN/COMMIT/ROLLBACK;
  an inner throw propagates and the outer rolls back.
- Implementation details: optional `name` in `promoteAtomically` options sets `name = @name` in the UPDATE; UNIQUE
  violation throws and rolls back the demotion. Make `inImmediateTransaction` public.

### Task 3.3: rejectIfStatus compare-and-set — COMPLETE

- Same file + spec. Plan reference: implementation-plan.md:318-335
- Implementation details: `rejectIfStatus(id, expected: 'candidate' | 'promoted', reason, rejectedAt = Date.now()): boolean`
  — one `UPDATE … WHERE id = ? AND status = ?`, returns `changes === 1`. Spec: true on match, false on mismatch, no
  write on mismatch.

### Task 3.4: Event-based reads by slug — COMPLETE

- Same file + spec. Plan reference: implementation-plan.md:300-308
- Implementation details: `listActiveOrderedByDecayScore` reads `skill_invocation_events WHERE skill_slug = row.name
  ORDER BY invoked_at DESC LIMIT 1000` (decay formula unchanged); NEW `listInvocationEvents(candidateId, limit)`
  mapping to `SkillInvocationRow` (`skillId = candidateId`, `notes = source`); NEW `listPromotedLastUse()` single
  LEFT JOIN aggregate with `COALESCE(max_invoked_at, promoted_at, created_at)`.
- Validation notes: R-c — keep `listInvocations` (rpc-handlers caller); deleted in Batch 12. Spec: a `-2` suffixed
  slug counts only its own events.

### Task 3.5: getStats lifecycle counts — COMPLETE

- Same file + spec. Plan reference: implementation-plan.md:309-312
- Implementation details: add `active` (promoted + resident), `dormant`, `merged`, `retired` via one `SUM(CASE …)`
  statement over `skill_candidates`; `invocations` = events whose slug is a promoted row's `name` (second statement).
  Existing fields keep their names.

### Task 3.6: Delete listActiveOrderedByActivity — COMPLETE

- Same file. Plan reference: implementation-plan.md:313
- Validation notes: run `ptah_lsp_references` first; only a stale mock key remains in `SS/skill-promotion.service.spec.ts:103`
  (removed in Batch 12). R-h: report the file's line delta.

### Batch 3 verification

- All six tasks on disk with spec cases; scoped test and typecheck pass; reviewer accepted

### Batch 3 on-disk verification (team-leader)

- `types.ts:24-26` constants; `types.ts:351` `SkillCandidateStats` (in `types.ts`, not the barrel — `index.ts` is
  Batch 12's, post-586; accepted deviation).
- `skill-candidate.store.ts`: `promoteAtomically` `:499-582` (`name = COALESCE(@name, name)` `:557`, empty slug
  rejected before any write `:522-526`); `listPromotedLastUse` `:604-623`; `rejectIfStatus` `:684-698` (single CAS
  UPDATE); `inImmediateTransaction` `:710-731` public, depth counter `:189`, only outermost BEGIN/COMMIT/ROLLBACK,
  reset in `finally`; `listActiveOrderedByDecayScore` `:443-469` reads events by `row.name`; `listInvocationEvents`
  `:1579-1604`; `getStats` `:1638-1674`. `listActiveOrderedByActivity` gone from the store; only the stale mock key
  in `SS/skill-promotion.service.spec.ts` remains (Batch 12). No TODO/STUB markers.
- Re-run by team-leader: store spec 98 passed / 0 skipped; `skill-synthesis:typecheck` succeeded.
- R-f addressed in the doc comment (`:700-709`); callback-body checks stay with Tasks 6.1, 8.1, 9.2 reviews.
- **R-h decision (team-leader):** the target is measured in the ESLint `max-lines` count, the number the warning
  reports. Base 1212; after Batch 3 1302 (+90). Batch 12 must land the store at ≤ 1272 (+60). Task 12.3 deletes
  `listInvocations`, and also `toInvocationRow` and its raw-row type when no caller remains. If the count is still
  above 1272, Task 12.3 moves the private raw-row → domain mappers (`toCandidateRow` and siblings) into a co-located
  `SS/skill-candidate.row-mappers.ts`; this is a move, not a shim. Batch 12 reports the final count.
- **Carried to Batch 11 (Task 11.2):** `getStats().invocations` now counts `skill_invocation_events` rows whose slug
  is a promoted row's `name`, not `skill_invocations` rows. Check the rpc-handlers readers at
  `skills-synthesis-rpc.handlers.ts:510` and `:700` and the UI label they feed.
- Tasks 3.1-3.6 IMPLEMENTED.

### Batch 3 review verdict

- Cross-side antigravity lane, logic scope: **APPROVED 8/10**, 0 blocking, 0 serious (`code-logic-review.md`
  `## Batch 3`). Lane re-checks: store spec 98/98 uncached, typecheck clean, 0 live callers of the deleted
  `listActiveOrderedByActivity`.
- MODERATE-1 (`skill-candidate.store.ts:710-731`, F-1, no SAVEPOINT on nested calls): accepted as designed; not
  changed in Batch 3. Recorded as risk R-f2 and carried as a caller rule plus one spec case each into Tasks 6.1,
  8.1 and 9.2, the only batches that open `inImmediateTransaction` callbacks. Their reviewers check that no catch
  inside a callback swallows a store-write error.
- MODERATE-2 (`skill-candidate.store.ts:451-464`, F-2, N+1 events query per resident row): accepted; bounded by the
  resident cap, statement prepared once. Recorded as risk R-l, a follow-up for the QA handoff /
  `future-enhancements.md`; not fixed in this task (R-h line budget).
- **Batch 3 ACCEPTED; commit HELD (G-580).** Commit order stays Batch 1, Batch 2, Batch 3, explicit path lists.
- Three held batches reached (the limit set above). Escalation done: the user chose to relay this session's name to
  the coordinator; TASK_2026_578 stays paused until the coordinator replies. Batch 4 is not started and not
  marked; it waits for the Batch 1 commit.
- Coordinator replied (G-580 resolved). Pre-commit re-check: skill-synthesis typecheck succeeded. **Committed
  `3a3cfcc85`** (3 explicit paths), after Batch 2. Hooks (lint-staged, electron validate-deps, commitlint) passed
  on all three commits. Batch 4 started.

## Batch 4: Suggestion, registry and purge-state stores + DI — IN_PROGRESS

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: three stores plus shared `types.ts` and DI files; the DI files are shared registries, so not parallel.
- Tasks: 5 | Depends on: Batches 1, 3
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 4.1: Suggestion lineage types — IN_PROGRESS

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/types.ts`
- Plan reference: implementation-plan.md:360-367
- Implementation details: `SkillReference = { name: string; body: string }`; `SkillSuggestionRow` gains
  `mergedInto: string | null`, `promotedCandidateId: string | null`, `references: SkillReference[]`;
  `NewSuggestionInput` gains `references?: SkillReference[]`.

### Task 4.2: SkillSuggestionStore lineage API — IN_PROGRESS

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts` (+ `skill-suggestion.store.spec.ts`)
- Depends on: Task 4.1
- Plan reference: implementation-plan.md:356-388
- Pattern to follow: `insertPending` `:52-82`, `transition` `:173-194`, `parseStringArray` `:213-223`
- Implementation details: `toRow` reads the 3 new columns (corrupt `references_json` → `[]` + warn); NEW
  `insert(input, status: 'pending' | 'dismissed')` (dismissed writes `decided_at`); `accept(id, promotedCandidateId: string | null)`;
  `markMerged(ids, umbrellaId)` guarded `WHERE status='pending'` returning count; `listMemberCandidateIds(filter?)`
  with parameterized `status IN (?…)`; `listAcceptedWithoutPromotedCandidate()`.
- Validation notes: R-d — keep `insertPending` and `hasExistingForCluster` (removed in Batch 12). R-g — update the
  single curator call `SS/skill-curator.service.ts:602` to `accept(id, null)`; no other curator edit. No method opens
  its own transaction (R-f).

### Task 4.3: SkillRegistryStore.remove — IN_PROGRESS

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-registry.store.ts` (+ `skill-registry.store.spec.ts`)
- Plan reference: implementation-plan.md:767-769, 809-810
- Implementation details: `remove(kind, slug, onlyCloneStatus: CloneStatus = 'synth'): boolean` — one parameterized
  `DELETE … WHERE kind = ? AND slug = ? AND clone_status = ?`, `changes === 1`. Spec: authored and diverged rows
  untouched.

### Task 4.4: SkillBacklogPurgeStateStore — IN_PROGRESS

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.ts` and `.spec.ts`
- Plan reference: implementation-plan.md:390-405
- Pattern to follow: `SS/skill-md-migration-state.store.ts`, `SS/cleanup/skill-backlog-cleanup.store.ts`
- Implementation details: `read()` (null + warn on missing table), `markComplete(...)` with
  `INSERT … ON CONFLICT(id) DO NOTHING` (first writer wins). Explicit `@inject` on every constructor parameter.

### Task 4.5: DI token and registration for the purge-state store — IN_PROGRESS

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `.../di/register.ts` (+ `.../di/register.spec.ts` if it asserts the token set)
- Depends on: Task 4.4
- Implementation details: `SKILL_BACKLOG_PURGE_STATE_STORE: Symbol.for('PtahSkillBacklogPurgeStateStore')`,
  registered singleton. R-i.

### Batch 4 verification

- Files exist with real implementations; skill-synthesis test + typecheck pass; reviewer accepted

## Batch 5: Generator slugs/references, union-find clustering, umbrella synthesizer (additive) — PENDING

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lanes x 2 (antigravity), one per file group, if the sub-agent stalls
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic + security scope (path traversal, Zod boundary)
- Rationale: four production files in one lib; Tasks 5.2/5.3 depend on each other and on Batch 4 APIs.
- Tasks: 4 | Depends on: Batch 4
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 5.1: SkillMdGenerator — DB-aware slug and references — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-md-generator.ts` (+ `skill-md-generator.spec.ts`)
- Plan reference: implementation-plan.md:407-430
- Validation notes: R-k. Reference name regex `/^[a-z0-9][a-z0-9-]{0,59}$/` re-checked before any `path.join`; throw on violation.
- Implementation details: `SkillMdInput.references?`; `promoteToActive(input, candidatesDir?, options?: { isSlugTaken? })`;
  `writeAtRoot` treats `existsSync(dir) || isSlugTaken(slug)` as occupied, keeps `-2..-5` and the final throw;
  writes `<dir>/references/<name>.md`. Specs: `foo` taken in DB → `foo-2`; references written; `../x`, `a/b` throw;
  `removeActive` removes `references/`.

### Task 5.2: Union-find agglomerate — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/cosine-similarity.ts` (+ `cosine-similarity.spec.ts`)
- Plan reference: implementation-plan.md:432-438, 463-464
- Validation notes: A3 verified — existing spec asserts label arrays; labels = lowest member index. All existing cases
  and `SS/skill-cluster-dedup.service.spec.ts` stay green. Add chain case `a~b~c`, `a≁c` → one component.
- Implementation details: same signature, `> threshold` single linkage, one O(n²·d) sweep.

### Task 5.3: SkillClusteringService.partitionPool — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts` (+ `skill-clustering.service.spec.ts`)
- Depends on: Task 5.2
- Plan reference: implementation-plan.md:439-471
- Validation notes: R-d — add `partitionPool`; keep `clusterCandidates` until Batch 12. Vec unavailable →
  `{vecAvailable:false, clusters:[], orphans:[]}`. Inject `SKILL_SUGGESTION_STORE` with explicit `@inject`.
- Implementation details: pool = candidates newest-first capped at `suggestionMaxCandidates` excluding
  `exclusions.suggestionMemberIds` (sets `truncated`), pending-suggestion centroids of member embeddings,
  promoted rows not pinned and not in `exclusions.exemptSlugs`; components ≥ `suggestionMinClusterSize` are clusters.

### Task 5.4: SkillSynthesizerService.synthesizeUmbrella — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts` (+ `skill-synthesizer.service.spec.ts`)
- Plan reference: implementation-plan.md:473-501
- Validation notes: R-k, R-l. New `UMBRELLA_SYSTEM_PROMPT`; `buildSystemPrompt` untouched and pinned by a string
  snapshot. Keep `synthesizeFromCluster`/`buildClusterPrompt` until Batch 12 (R-d).
- Implementation details: `UMBRELLA_SKILL_JSON_SCHEMA` (references maxItems 8); Zod `UmbrellaSkillSchema`
  (reference name regex, body 1..20000, default `[]`); `runSynthesis` takes schema + parser as parameters;
  `UMBRELLA_MAX_MEMBERS = 12`, bodies clipped by `CLUSTER_MEMBER_MAX_CHARS`; non-success returns `null`.

### Batch 5 verification

- Four files implemented; old paths still compile; skill-synthesis test + typecheck pass; reviewer accepted

## Batch 6: Promotion entries and judge-panel gate — PENDING

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope (transactions, compensation, races)
- Rationale: transactional multi-store promotion; needs judgement on shared tail extraction.
- Tasks: 3 | Depends on: Batches 3, 4, 5
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 6.1: Automatic-path slug fix, shared cap selection, promoteSuggestion, adoptMaterializedSkill — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts` (+ `skill-promotion.service.spec.ts`, `skill-promotion.repropagation.spec.ts`)
- Plan reference: implementation-plan.md:608-657
- Validation notes: R-f (only plain-statement calls inside the transaction); R-f2 (no error-swallowing catch inside
  the callback; the directory-removal catch wraps the whole transaction call and rethrows or returns after rollback;
  spec: a throw after `registerCandidate` leaves no candidate row); filesystem first, DB second, remove the
  directory on any DB throw; no dedup/judge gates on the suggestion path, cap applies.
- Implementation details: automatic path passes `isSlugTaken` and `name: materialized.slug`, repropagates the
  materialized slug; private `selectWeakestResident`; `promoteSuggestion` (registerCandidate `trajectoryHash:
  'suggestion:'+id` → promoteAtomically → `registry.upsert({..., cloneStatus:'synth', candidateId})` → `onCommit`);
  `adoptMaterializedSkill` (same tail without materialization; link-only if slug already promoted). Specs per
  plan:650-655.

### Task 6.2: Judge-panel stage decides — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts` (+ `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesis.stage-handlers.spec.ts`)
- Plan reference: implementation-plan.md:812-834
- Implementation details: in `case 'scored'` (`:541-546`), score `< settings.minJudgeScore` →
  `store.rejectIfStatus(id, 'candidate', 'below-judge-score')`; reason `${result.reason}:rejected` or
  `:not-candidate`. Specs: below → rejected; at threshold → unchanged; promoted meanwhile → unchanged.

### Task 6.3: Update the stale stage-handlers doc comment — PENDING

- Same file, `:363` references `SkillCuratorService.runSuggestionPass`; reword to the umbrella pass.

### Batch 6 verification

- Promotion and stage gate implemented with specs; tests + typecheck pass; reviewer accepted

## Batch 7: SkillRetirementService — PENDING

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic + security scope (destructive filesystem removal)
- Rationale: new service with destructive actions; shares DI files with Batch 8, so they are sequential.
- Tasks: 2 | Depends on: Batches 2, 3, 4
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 7.1: Retirement service and acceptance-3 spec — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts` and `.spec.ts`
- Plan reference: implementation-plan.md:727-810
- Pattern to follow: settings read with fallback `SS/skill-promotion.service.ts:502-519`; repropagation `:369-375`; fail-soft registry `:621-632`
- Validation notes: R-j containment (inside `mdGenerator.activeRoot()`, basename = `row.name`), R-f, Zod
  `z.number().int().min(1).max(3650)` with default 30. Exempt pinned and registry `authored`/`diverged`. FS removal
  first, then one transaction (`rejectIfStatus(id,'promoted',RETIRED_UNUSED_REASON)` → `registry.remove('skill', name)` only when true).
- Implementation details: `run(origin, now)`, `removeMaterializations(rows, origin)`; 6 explicit `@inject` deps.
  Spec cases per plan:796-807 (29d resident, 30d dormant, 60d retired + dir gone + registry row gone, lost race keeps
  registry row, pinned 100d untouched, authored untouched, event at day 50 resets, outside path not deleted, invalid
  settings → defaults).

### Task 7.2: DI token and registration — PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `.../di/register.ts` (+ `register.spec.ts` if needed)
- Implementation details: `SKILL_RETIREMENT_SERVICE`. R-i.

### Batch 7 verification

- Service and spec exist; acceptance-3 cases pass; reviewer accepted

## Batch 8: SkillUmbrellaMergeService — PENDING

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: the largest new unit (umbrella, R7, singletons, one-time purge) with real-DB specs.
- Tasks: 2 | Depends on: Batches 4, 5
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 8.1: Umbrella merge service and spec — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.ts` and `.spec.ts`
- Plan reference: implementation-plan.md:503-606 (R1, R2, R3, R5, R6, R7 at :120-174)
- Pattern to follow: current suggestion pass `SS/skill-curator.service.ts:390-536` (authored-dominance guard
  `:434-448`, rate limit `:449-458`, judge `:474-504`); move `technologyFingerprint`/`readCandidateBody`
  (`:669-699`) verbatim (the curator copies are removed in Batch 9).
- Validation notes: R-f; R-f2 (the per-cluster try/catch wraps the whole `inImmediateTransaction` call, never sits
  inside it; spec: a throw mid-cluster leaves no umbrella row and no member marked merged); re-read members inside the transaction and abort on change;
  `rejectIfStatus` false → skip, not counted; purge only when marker absent, vec available, pool not truncated;
  never throws into the caller. 8 explicit `@inject` deps; exempt slugs passed in by the caller.
- Implementation details: returns `UmbrellaPassResult` with `clustersRemaining` and `rateLimited`. Spec cases per
  plan:589-604 on a real migrated DB with a plain `skill_candidates_vec(rowid INTEGER PRIMARY KEY, embedding BLOB)`.

### Task 8.2: DI token and registration — PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `.../di/register.ts` (+ `register.spec.ts` if needed)
- Implementation details: `SKILL_UMBRELLA_MERGE_SERVICE`. R-i.

### Batch 8 verification

- Service and spec exist with all listed cases; tests + typecheck pass; reviewer accepted

## Batch 9: SkillCuratorService rewrite (facade) — PENDING

- Recommended executor: backend-developer sub-agent
- Fallback executor: none (needs design judgement on the facade); re-run the sub-agent with reviewer findings
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: rewrite of one service plus its spec and the e2e spec that drove the old suggestion pass (R-d).
- Tasks: 4 | Depends on: Batches 6, 7, 8
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 9.1: runPass orchestration and report — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-curator.service.ts` (+ `skill-curator.service.spec.ts`, rewritten)
- Plan reference: implementation-plan.md:659-725
- Implementation details: order retirement → umbrella → enhancement (unchanged) → report → `curator-pass` event
  with the new stats; remove the 0-promoted early return and the LLM overlap review; `CuratorReport` keeps
  `{reportPath, changesQueued, skippedPinned, suggestionsCreated}`; each sub-pass in its own try/catch. Deps: 9
  (logger, store, rateLimiter, registry, enhancer, suggestionStore, umbrella, retirement, promotion), all explicit
  `@inject`. Remove `technologyFingerprint`/`readCandidateBody` copies.

### Task 9.2: acceptSuggestion delegates to promoteSuggestion — PENDING

- Same files. Plan reference: implementation-plan.md:677-688
- Validation notes: R-f; R-f2 (`{accepted:false}` comes from a catch around the whole transaction call, after
  rollback; spec: a throw after the promotion write leaves the suggestion pending and no promoted row); pinned members skipped; registry `remove` for merged promoted members inside the
  transaction; `retirement.removeMaterializations` after commit; `{accepted:false}` on any failure, suggestion stays pending.

### Task 9.3: reconcileAcceptedSuggestions at start — PENDING

- Same files. Plan reference: implementation-plan.md:689-696
- Validation notes: A1 — match registry rows of either `authored` or `synth`, require `<activeRoot>/<slug>/SKILL.md`,
  slug ∈ {s, s-2..s-5}; runs before the `curatorEnabled` early return; idempotent; never throws out of `start()`.

### Task 9.4: Retarget the cluster hold-out end-to-end spec — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/gates/cluster-holdout-end-to-end.spec.ts`
- Validation notes: R-d — it mocks `clusterCandidates`, `synthesizeFromCluster`, `hasExistingForCluster`,
  `insertPending` (`:194-254`) against the curator. Retarget to `SkillUmbrellaMergeService` (`partitionPool`,
  `synthesizeUmbrella`, `insert`) keeping its hold-out assertions; it must stop referencing the four old symbols.

### Batch 9 verification

- Curator rewritten (~550 lines), no caller of the old methods remains outside their own files; tests + typecheck
  pass; reviewer accepted

## Batch 10: Diagnostics counts and SS default (post-586) — PENDING

- **Precondition: G-586 rebase done.**
- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, style scope (minimal edits to 586-shared files)
- Rationale: three 586-shared skill-synthesis files; must be edited on top of 586's versions.
- Tasks: 2 | Depends on: Batch 3, G-586
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 10.1: Diagnostics status counts — PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/diagnostics.types.ts`, `.../diagnostics.service.ts` (+ `diagnostics.service.spec.ts`)
- Plan reference: implementation-plan.md:863-864
- Validation notes: R-e — edit 586's versions; append fields only.
- Implementation details: `SkillCandidateStatusCounts` gains `active`, `dormant`, `merged`, `retired`; `readStats`
  maps with zero fallbacks.

### Task 10.2: Pool default literal — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`
- Plan reference: implementation-plan.md:843-849
- Implementation details: `SETTINGS_DEFAULTS.suggestionMaxCandidates` 200 → 1000 only; do not touch `recentEvents`.

### Batch 10 verification

- Rebased on 586; only the named lines changed in shared files; tests pass; reviewer accepted

## Batch 11: Shared DTO and RPC handler wiring (post-586) — PENDING

- **Precondition: G-586 rebase done.**
- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: two libs (shared, rpc-handlers), both 586-shared; minimal-edit rules.
- Tasks: 2 | Depends on: Batches 3, 10
- Verification command: `npx nx run @ptah-extension/rpc-handlers:test --testFile=skills-synthesis-rpc` (tail) and
  `npx nx run @ptah-extension/shared:typecheck`

### Task 11.1: Append lifecycle fields to SkillDiagnosticsResult — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`
- Plan reference: implementation-plan.md:865-866, 877-878
- Implementation details: append `readonly totalMerged`, `totalRetired`, `totalDormant: number`; nothing else.
  Not `rpc.types.ts`.

### Task 11.2: RPC handler bodies — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (+ `.spec.ts`)
- Depends on: Task 11.1
- Plan reference: implementation-plan.md:867-887
- Validation notes: R-c — `skillSynthesis:invocations` uses `store.listInvocationEvents`. Edit only the three method
  bodies; do not touch 586's `recentEvents` mapping. No new RPC method, no `ALLOWED_METHOD_PREFIXES` change.
- Implementation details: stats → `activeSkills = s.active`, `totalInvocations = s.invocations`; diagnostics → same
  plus the three new fields after `activeSkills`. Spec: mapping, resident-only active, events-based invocations.

### Batch 11 verification

- Fields appended; handler bodies moved; rpc-handlers tests pass; reviewer accepted

## Batch 12: Remove superseded paths — PENDING

- Recommended executor: backend-developer sub-agent (uses `ptah_lsp_references` before each deletion)
- Fallback executor: CLI lane x 1 (antigravity) with grep-based reference checks
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, style scope (dead code, barrel exports)
- Rationale: deletion-only batch after every caller has moved; touches the 586-shared barrel, so post-rebase.
- Tasks: 4 | Depends on: Batches 9, 11
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail), `:typecheck`, `:lint` (confirm
  `skill-candidate.store.ts` max-lines did not grow beyond the R-h target)

### Task 12.1: Delete old clustering and synthesizer paths — PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts` (+ spec), `.../skill-synthesizer.service.ts` (+ spec)
- Implementation details: delete `clusterCandidates`, `synthesizeFromCluster`, `buildClusterPrompt` and their spec cases.

### Task 12.2: Delete old suggestion-store methods — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts` (+ spec)
- Implementation details: delete `insertPending`, `hasExistingForCluster`; update the doc comments that cite
  `insertPending` in `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.ts:17,760` and its spec's assertion name to `insert`.

### Task 12.3: Delete listInvocations from the candidate store — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- Implementation details: delete `listInvocations` and `toInvocationRow` if unused; remove the stale
  `listActiveOrderedByActivity` mock key at `SS/skill-promotion.service.spec.ts:103`. Report final line delta (R-h).

### Task 12.4: Barrel exports — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/index.ts`
- Implementation details: `ClusterMemberInput` → `UmbrellaMemberInput` (`:138-139`); `SkillCandidateCluster` →
  new partition result type or drop (`:143-144`); curator type exports per Batch 9. Verify external consumers with
  `ptah_lsp_references`. Leave `SkillSynthesisCuratorOverlap` in `rpc.types.ts` untouched (no-touch file).

### Batch 12 verification

- No reference to any deleted symbol remains (grep evidence); tests, typecheck, lint pass; reviewer accepted

## Batch 13: Lifecycle reachability integration spec — PENDING

- Recommended executor: backend-developer sub-agent
- Fallback executor: senior-tester sub-agent
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope (does each proof fail when the production call is removed)
- Rationale: one production-DI integration spec covering acceptance 2, 4 and 5.
- Tasks: 1 | Depends on: Batches 9-12
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test --testFile=skill-lifecycle.reachability` (tail)

### Task 13.1: Reachability spec — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts`; optional helper in `.../skill-synthesis.reachability.test-support.ts` (`seedVecTable`)
- Plan reference: implementation-plan.md:932-978
- Pattern to follow: `SS/skill-synthesis.reachability.integration.spec.ts:57-245`
- Validation notes: A4 (suffixed slug counted, base slug not); each of the four proofs runs through a production
  entry (`synthesis.start()`, the 1 h `setInterval`, `acceptSuggestion`, the weekly drain). Executor states, per
  proof, which production call removal makes it fail (ideally demonstrated once by temporarily commenting the call
  and reverting).

### Batch 13 verification

- Spec exists and passes; reviewer confirms each proof is load-bearing

## Batch 14: Frontend counters and post-accept refresh (post-586) — PENDING

- **Precondition: G-586 rebase done; Batch 11 committed.**
- Recommended executor: frontend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane (logic/style) and visual-reviewer sub-agent (rendered UI, dark + light
  before/after screenshots of the Skills diagnostics surface; the "before" captured from the commit preceding this
  batch, since no prototype exists for a 3-cell addition)
- Rationale: Angular signals/OnPush edits in 586's versions of shared files.
- Tasks: 3 | Depends on: Batch 11, G-586
- Verification command: `npx nx run @ptah-extension/skill-synthesis-ui:test` (tail) and `:lint`

### Task 14.1: Diagnostics state fields — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts` (+ spec)
- Plan reference: implementation-plan.md:898-902
- Implementation details: `SkillByStatusCounts` + `totalMerged`, `totalRetired`, `totalDormant`; default zeros;
  three `?? 0` lines in `applySnapshot`. Nothing else.

### Task 14.2: Pipeline status cells — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts` (+ spec)
- Depends on: Task 14.1
- Plan reference: implementation-plan.md:903-911
- Validation notes: A5 — read 586's version first. Do not touch the (removed) accordion. Edit
  `skill-synthesis-tab.component.ts` only if 586 binds by-status fields individually, and list that edit in the report.
- Implementation details: Merged, Retired, Dormant cells using the existing label/value markup inside the
  `aria-label` section; OnPush, signal inputs.

### Task 14.3: Refresh stats after accept — PENDING

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts` (+ spec)
- Plan reference: implementation-plan.md:912-913
- Implementation details: `await this.loadStats()` after `refreshSuggestions()` in `accept` (`:433-445`); spec
  asserts the stats call.

### Batch 14 verification

- Three files edited on 586's versions; UI tests and lint pass; logic/style reviewer and visual-reviewer accepted
  with dark + light before/after screenshots
