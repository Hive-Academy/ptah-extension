# Batches - TASK_2026_578_3b00

Total tasks: 46 | Batches: 15 | Complete: 15/15

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
- **Lane roster revised (user, 2026-10-01, from Batch 5):** CLI lanes may be antigravity, opencode
  (`opencode-go/kimi-k2.7-code`) or Glm (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`). Wherever a batch below
  says "antigravity CLI lane", any of the three qualifies. Still at most 2 lanes in flight; cross-side rule unchanged.
  Batches with a two-scope review (logic + security) split it into two lanes from different vendors.
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
| R-n (Batch 4 review MODERATE + F-1): `SkillSuggestionStore.markMerged` (`skill-suggestion.store.ts:197-209`) does not exclude `umbrellaId` from `ids` (the umbrella, inserted `pending` in the same transaction, would dismiss itself with `merged_into` = itself), and returns `changes`, so a caller that ignores the count silently misses members that were no longer pending. No caller exists yet (grep: store + spec only). | MEDIUM | HARD REQUIREMENT on Batch 8. Task 8.3: `markMerged` filters `umbrellaId` out of `ids` before the UPDATE, plus a spec case (umbrella id among ids → umbrella stays `pending`, `merged_into` NULL, count excludes it). Task 8.1: the caller compares the returned count with the member-suggestion count it expected and throws inside the `inImmediateTransaction` callback on mismatch (whole cluster rolls back, logged by the outer per-cluster catch, retried next pass); spec case for a member that turned non-pending. Batch 8 does not pass review without both. |
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

## Batch 1: Migration 0051_skill_lifecycle — COMPLETE (commit faa550fb0; rebased as a8d25b538)

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

## Batch 2: File-based settings keys and docs — COMPLETE (commit 3b739b40f; rebased as 3bd24475f)

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

## Batch 3: SkillCandidateStore lifecycle primitives — COMPLETE (commit 3a3cfcc85; rebased as 69ed95213)

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

## Batch 4: Suggestion, registry and purge-state stores + DI — COMPLETE (commit 6dbf1a5b4; rebased as bbd02ebf8)

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: three stores plus shared `types.ts` and DI files; the DI files are shared registries, so not parallel.
- Tasks: 5 | Depends on: Batches 1, 3
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 4.1: Suggestion lineage types — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/types.ts`
- Plan reference: implementation-plan.md:360-367
- Implementation details: `SkillReference = { name: string; body: string }`; `SkillSuggestionRow` gains
  `mergedInto: string | null`, `promotedCandidateId: string | null`, `references: SkillReference[]`;
  `NewSuggestionInput` gains `references?: SkillReference[]`.

### Task 4.2: SkillSuggestionStore lineage API — COMPLETE

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

### Task 4.3: SkillRegistryStore.remove — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-registry.store.ts` (+ `skill-registry.store.spec.ts`)
- Plan reference: implementation-plan.md:767-769, 809-810
- Implementation details: `remove(kind, slug, onlyCloneStatus: CloneStatus = 'synth'): boolean` — one parameterized
  `DELETE … WHERE kind = ? AND slug = ? AND clone_status = ?`, `changes === 1`. Spec: authored and diverged rows
  untouched.

### Task 4.4: SkillBacklogPurgeStateStore — COMPLETE

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.ts` and `.spec.ts`
- Plan reference: implementation-plan.md:390-405
- Pattern to follow: `SS/skill-md-migration-state.store.ts`, `SS/cleanup/skill-backlog-cleanup.store.ts`
- Implementation details: `read()` (null + warn on missing table), `markComplete(...)` with
  `INSERT … ON CONFLICT(id) DO NOTHING` (first writer wins). Explicit `@inject` on every constructor parameter.

### Task 4.5: DI token and registration for the purge-state store — COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `.../di/register.ts` (+ `.../di/register.spec.ts` if it asserts the token set)
- Depends on: Task 4.4
- Implementation details: `SKILL_BACKLOG_PURGE_STATE_STORE: Symbol.for('PtahSkillBacklogPurgeStateStore')`,
  registered singleton. R-i.

### Batch 4 verification

- Files exist with real implementations; skill-synthesis test + typecheck pass; reviewer accepted
- Team-leader verification (Mode 2): all 12 files are on disk with real code, and the diff matches the report. Checks
  re-run by the team-leader: skill-synthesis lint passed (no cache); `degradation-audit:lint` passed (no cache);
  rpc-handlers and skill-synthesis typecheck passed; skill-synthesis tests passed (82 suites passed, 1 skipped; 1649
  tests passed, 1 skipped). The only consumer outside the lib is `rpc-handlers/.../skills-synthesis-rpc.handlers.ts`,
  which reads `SkillSuggestionRow` and still typechecks. Tasks 4.1-4.5 are IMPLEMENTED. Waiting for the
  cross-side logic verdict.

### Batch 4 review verdict

- Cross-side antigravity lane, logic scope: **APPROVED 8/10**, 0 blocking, 0 serious, 1 moderate, 1 failure mode
  (`code-logic-review.md` `## Batch 4`). Lane re-checks: 82 suites / 1649 tests passed, typecheck and
  degradation audit passed.
- Transaction race (team-leader point 1): accepted. `accept()` keeps the `findById` guard plus the CAS
  `WHERE id = ? AND status='pending'`; the curator (`skill-curator.service.ts:555`) already returns
  `{accepted:false}` for a non-pending row. Remaining risk, accepted: a concurrent loser gets the already-transitioned row
  back with no error. Batch 9 Task 9.2 must take the outcome from `promoteSuggestion`/the transaction result, not
  from `accept()`'s return value alone.
- `markMerged` sets `dismissed` (team-leader point 2): confirmed consistent with the plan lineage.
- MODERATE (unchecked `changes`) and F-1 (umbrella self-merge): **carried to Batch 8 as a hard requirement (R-n,
  new Task 8.3, plus a count check in Task 8.1)**, not sent back now. Reason: `markMerged` has no caller until
  Task 8.1, so the defect cannot fire on any committed path. The fix lands in the batch that adds the first
  caller, under the same review.
- Commit: 13 explicit code paths (11 modified, 2 created under `lifecycle/`); the two one-line spec edits
  (`skill-curator.service.spec.ts`, `digest/skill-gap-curator.service.spec.ts`) are R-g's `accept(id, null)` call-site
  updates and belong to this batch.
- **Batch 4 ACCEPTED. Committed `6dbf1a5b4`** (13 explicit paths; hooks passed).
- **Run paused after Batch 4 at the user's request (2026-10-01).** Batch 5 stays PENDING (not marked
  IN_PROGRESS) until the run resumes; the next team-leader or orchestrator marks it IN_PROGRESS when the executor is
  spawned. Open items at the pause: R-n (Batch 8 hard requirement), R-f2 (caller rule for Tasks 6.1, 8.1, 9.2),
  R-l N+1 (QA / `future-enhancements.md`), R-h (store ≤ 1272 ESLint lines at Batch 12, currently 1302), G-586
  (rebase onto merged 586 before Batch 10).

### G-586 resolved (2026-10-01, before Batch 5)

- PR #620 merged to `main` at `a4a3f8212` (2026-10-01T16:10:58Z). The branch had a clean tree and no agent in
  flight, so the orchestrator ran `git fetch && git rebase origin/main` before Batch 5 instead of after Batch 9
  (Batches 5-9 carry no 586 file, so the earlier rebase removes a later pause). 7 commits replayed with no conflict;
  new HEAD `0726ab99d`. `skill-diagnostics-accordion.component.ts` is gone. Batches 10, 11 and 14 are unblocked.

## Batch 5: Generator slugs/references, union-find clustering, umbrella synthesizer (additive) — COMPLETE (commit 985b14ccf)

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lanes x 2 (antigravity), one per file group, if the sub-agent stalls
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic + security scope (path traversal, Zod boundary)
- Rationale: four production files in one lib; Tasks 5.2/5.3 depend on each other and on Batch 4 APIs.
- Tasks: 4 | Depends on: Batch 4
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 5.1: SkillMdGenerator — DB-aware slug and references — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-md-generator.ts` (+ `skill-md-generator.spec.ts`)
- Plan reference: implementation-plan.md:407-430
- Validation notes: R-k. Reference name regex `/^[a-z0-9][a-z0-9-]{0,59}$/` re-checked before any `path.join`; throw on violation.
- Implementation details: `SkillMdInput.references?`; `promoteToActive(input, candidatesDir?, options?: { isSlugTaken? })`;
  `writeAtRoot` treats `existsSync(dir) || isSlugTaken(slug)` as occupied, keeps `-2..-5` and the final throw;
  writes `<dir>/references/<name>.md`. Specs: `foo` taken in DB → `foo-2`; references written; `../x`, `a/b` throw;
  `removeActive` removes `references/`.

### Task 5.2: Union-find agglomerate — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/cosine-similarity.ts` (+ `cosine-similarity.spec.ts`)
- Plan reference: implementation-plan.md:432-438, 463-464
- Validation notes: A3 verified — existing spec asserts label arrays; labels = lowest member index. All existing cases
  and `SS/skill-cluster-dedup.service.spec.ts` stay green. Add chain case `a~b~c`, `a≁c` → one component.
- Implementation details: same signature, `> threshold` single linkage, one O(n²·d) sweep.

### Task 5.3: SkillClusteringService.partitionPool — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts` (+ `skill-clustering.service.spec.ts`)
- Depends on: Task 5.2
- Plan reference: implementation-plan.md:439-471
- Validation notes: R-d — add `partitionPool`; keep `clusterCandidates` until Batch 12. Vec unavailable →
  `{vecAvailable:false, clusters:[], orphans:[]}`. Inject `SKILL_SUGGESTION_STORE` with explicit `@inject`.
- Implementation details: pool = candidates newest-first capped at `suggestionMaxCandidates` excluding
  `exclusions.suggestionMemberIds` (sets `truncated`), pending-suggestion centroids of member embeddings,
  promoted rows not pinned and not in `exclusions.exemptSlugs`; components ≥ `suggestionMinClusterSize` are clusters.

### Task 5.4: SkillSynthesizerService.synthesizeUmbrella — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts` (+ `skill-synthesizer.service.spec.ts`)
- Plan reference: implementation-plan.md:473-501
- Validation notes: R-k, R-l. New `UMBRELLA_SYSTEM_PROMPT`; `buildSystemPrompt` untouched and pinned by a string
  snapshot. Keep `synthesizeFromCluster`/`buildClusterPrompt` until Batch 12 (R-d).
- Implementation details: `UMBRELLA_SKILL_JSON_SCHEMA` (references maxItems 8); Zod `UmbrellaSkillSchema`
  (reference name regex, body 1..20000, default `[]`); `runSynthesis` takes schema + parser as parameters;
  `UMBRELLA_MAX_MEMBERS = 12`, bodies clipped by `CLUSTER_MEMBER_MAX_CHARS`; non-success returns `null`.

### Batch 5 verification

- Four files implemented; old paths still compile; skill-synthesis test + typecheck pass; reviewer accepted

### Batch 5 on-disk verification (team-leader)

- Diff scope: exactly the 8 Batch 5 paths (`SS/skill-md-generator.ts`, `SS/cosine-similarity.ts`,
  `SS/skill-clustering.service.ts`, `SS/skill-synthesizer.service.ts`, each + `.spec.ts`), 1172+/78- with the docs
  edits. No barrel (`index.ts`) edit: deferred to Batch 12 per R-e, new symbols have only in-lib consumers so far.
  No TODO/FIXME/stub markers. Batch 7 files that appeared mid-verification (`SS/lifecycle/skill-retirement.service.ts`
  + spec, `SS/di/tokens.ts`, `SS/di/register.ts`, `SS/di/register.spec.ts`) are the parallel Batch 7 executor's and
  are excluded from Batch 5.
- 5.1: `promoteToActive(input, candidatesDir?, options = {})` → `writeAtRoot(..., isSlugTaken)`
  (`skill-md-generator.ts:245`). References validated before any disk write; occupied = dir exists OR DB taken; walk
  base, -2..-5, throw on -5 occupied (same exhaustion point as before); `references/<name>.md` written
  (`:275`). `SKILL_REFERENCE_NAME_PATTERN` exported and reused by the synthesizer Zod schema (one source of truth,
  R-k). Specs: DB-taken → `-2`, exhaustion throws, references written, none → no dir, `../x`/`a/b`/`a\b`/empty/upper/
  leading-hyphen throw, duplicate throws, `removeActive` removes `references/`.
- 5.2: union-find with path compression, link only when `cosineSimilarity > threshold`, root = lowest index (A3).
  Existing label-array cases unchanged; new chain, lowest-index labels (`[0,1,0,1]`) and strict-`>` cases.
- 5.3: `partitionPool` (`skill-clustering.service.ts`) returns `{vecAvailable, truncated, clusters, orphans,
  unembedded}`; candidates (`listByStatus` is `created_at DESC`, so newest first) minus member ids, capped,
  `truncated` when eligible > cap; pending-suggestion centroids (dimension-mismatch skipped, null when none); promoted
  minus pinned/exempt. `SKILL_SUGGESTION_STORE` injected with explicit `@inject`; `di/tokens.ts` has no imports,
  so no cycle. `clusterCandidates` kept (R-d).
- 5.4: `synthesizeUmbrella`, `UMBRELLA_SYSTEM_PROMPT`, `UMBRELLA_SKILL_JSON_SCHEMA` (maxItems 8), Zod
  `UmbrellaSkillSchema` (regex, body 1..20000, unique, default `[]`), `UMBRELLA_MAX_MEMBERS = 12`, bodies clipped by
  `CLUSTER_MEMBER_MAX_CHARS`, empty input → `null` without a lane call. `runSynthesis<T>` takes schema + parser; both
  existing callers pass `SYNTHESIZED_SKILL_JSON_SCHEMA` + `parseSynthesizedSkill`. `buildSystemPrompt` untouched and
  pinned byte-for-byte (R-l). `synthesizeFromCluster`/`buildClusterPrompt` kept (R-d).
- Commands (team-leader re-run): `skill-synthesis:typecheck` exit 0. `skill-synthesis:lint` 0 errors, 29 warnings,
  none in a Batch 5 file. Degradation audit exit 0, `libs/backend/skill-synthesis: 6 ok (baseline 6)`.
  `skill-synthesis:test --maxWorkers=2`: first run was an Nx cache replay (82 passed / 1 skipped, 1693 tests); a
  `--skip-nx-cache` re-run while the Batch 7 executor was running tests in the same worktree timed out 2 tests
  (5000 ms) in suites Batch 5 does not touch (`cleanup/skill-backlog-cleanup.integration.spec.ts`,
  `spec-harvester.concurrent-attribution.spec.ts`); a second fresh run passed everything: 83 passed / 1 skipped
  suites, 1709 passed / 1 skipped tests (count includes the in-flight Batch 7 retirement spec). Load-induced, not a
  Batch 5 defect.
- Jest "worker process has failed to exit gracefully": pre-existing, repo-wide. Recorded before this task in
  `.ptah/specs/TASK_2026_334/batch-b.report.md:54` and analysed in `.ptah/specs/TASK_2026_404_edeb/investigation.md`
  (jest-worker 500 ms graceful-exit force-exit under fan-out). Not attributed to Batch 5.
- Deviation decisions (all ACCEPTED):
  1. `PoolMember` carries `embedding` — ACCEPT. Additive; Batch 8 needs it to order members closest-to-centroid for
     `UMBRELLA_MAX_MEMBERS` and to compute the umbrella centroid without a second read.
  2. Duplicate reference names rejected at both boundaries — ACCEPT. Prevents a silent overwrite of
     `references/<name>.md`; strengthens R-k.
  3. JSON schema lists `references` as required while Zod defaults `[]` — ACCEPT. Strict structured-output
     providers need every property in `required`; the Zod default covers the text-extraction path. Prompt tells the
     model to send an empty array.
  4. `UmbrellaMemberInput.kind` is a local literal union — ACCEPT. Same literals as `PoolMember['kind']`; keeping it
     local avoids a synthesizer → clustering dependency. Style reviewers may suggest a shared alias; not required.
  5. Exclusions come from the caller — ACCEPT. Matches the plan (`partitionPool(settings, exclusions)`, "reads exempt
     slugs from its caller, so no registry dependency is needed").
- Note for Batch 8 (LOW, not a Batch 5 defect): if an I/O error hits mid-way through the reference writes
  (`skill-md-generator.ts:275-285`), `writeAtRoot` throws after SKILL.md is on disk and the caller has no
  `MaterializedSkill` to pass to `removeActive`. Names are validated before any write, so only filesystem errors
  reach this. Batch 8's umbrella-merge caller should treat a `promoteToActive` throw as "directory may exist" or the
  generator should clean up on throw; reviewers of Batch 8 check it. **Resolved in the review fix-up (item 4 below).**
- Review: cross-side lanes in flight (logic → `code-logic-review.md ## Batch 5`, security →
  `code-security-review.md ## Batch 5`). No commit until both verdicts are in.

### Batch 5 review verdict

- Logic (antigravity lane): **APPROVED 8/10**, `code-logic-review.md` `## Batch 5`. Moderate: `writeAtRoot` partial
  write. Minor: `centroidOf` silently skips a dimension mismatch. Minor: `synthesizeUmbrella` slices the first 12 in
  caller order (carried to Batch 8).
- Security (opencode Kimi K2.7 lane): **APPROVED 7/10**, `code-security-review.md` `## Batch 5`. Moderate:
  `overwriteCandidate` ignores references. Moderate: Windows reserved device names. Minor: `removeActive` has no
  root guard.
- Fix-up applied by the executor from the reviewers' own findings (same rule as the Batch 2 docs fix-up; no new
  review round). Verified on disk by team-leader:
  1. `SS/skill-md-generator.ts:49`, `:365`: `con|prn|aux|nul|com0-9|lpt0-9` reference names refused at the filesystem
     boundary. The Zod schema does not refuse them, so such an answer parses and then fails closed at the write
     (caller's existing write-failed policy). Acceptable.
  2. `:203-209`: `overwriteCandidate` throws when references are passed (no silent drop).
  3. `:259-268`: `removeActive` resolves both paths and throws unless the dir is strictly inside `activeRoot()`.
  4. `:299-317`, `removeDirAfterFailedWrite` `:331-347`: a failed SKILL.md/reference write removes the new dir and
     rethrows the original error (`throw error` at `:316`; no return inside the catch). A cleanup failure only warns.
     This closes the Batch 8 note above.
  5. `SS/skill-clustering.service.ts:240-272`: `centroidOf` counts mismatched members and warns once per suggestion
     with `{suggestionId, expectedDimension, skipped}`.
  - Spec: `skill-md-generator.spec.ts:10-17` `jest.mock('node:fs')` with `jest.fn(actual.*)` passthroughs (file-scoped
    by Jest; the generator imports `node:fs` at `:21`); the two failing-write cases restore in `finally`
    (`:349-350`, `:372-373`), so no leak into other cases.
- Re-run after fix-up (team-leader): `--testFile=skill-clustering` 14/14 passed (14 `it` cases, including the new
  dimension-mismatch case at spec `:354`). Full `skill-synthesis:test --maxWorkers=2 --skip-nx-cache`: 83 passed /
  1 skipped suites, 1723 passed / 1 skipped tests (includes the uncommitted Batch 7 retirement spec). Typecheck exit 0.
  Lint 0 errors / 29 warnings, none in a Batch 5 file. Degradation audit exit 0, skill-synthesis 6 ok (baseline 6).
- **Batch 8 carry (HARD):** the umbrella-merge caller sorts cluster members by distance to the cluster centroid
  (closest first) before calling `synthesizeUmbrella`, which keeps only the first `UMBRELLA_MAX_MEMBERS` (12).
  Batch 8 review checks it.
- **Batch 5 ACCEPTED. Committed `985b14ccf`** (8 explicit paths, 4 production files + specs; hooks passed). Batch 7 files (`SS/lifecycle/skill-retirement.*`,
  `SS/di/*`) left unstaged.

## Batch 6: Promotion entries and judge-panel gate — COMPLETE (commit 5c29b6fe6)

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope (transactions, compensation, races)
- Rationale: transactional multi-store promotion; needs judgement on shared tail extraction.
- Tasks: 3 | Depends on: Batches 3, 4, 5
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 6.1: Automatic-path slug fix, shared cap selection, promoteSuggestion, adoptMaterializedSkill — COMPLETE

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

### Task 6.2: Judge-panel stage decides — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts` (+ `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesis.stage-handlers.spec.ts`)
- Plan reference: implementation-plan.md:812-834
- Implementation details: in `case 'scored'` (`:541-546`), score `< settings.minJudgeScore` →
  `store.rejectIfStatus(id, 'candidate', 'below-judge-score')`; reason `${result.reason}:rejected` or
  `:not-candidate`. Specs: below → rejected; at threshold → unchanged; promoted meanwhile → unchanged.

### Task 6.3: Update the stale stage-handlers doc comment — COMPLETE

- Same file, `:363` references `SkillCuratorService.runSuggestionPass`; reword to the umbrella pass.

### Batch 6 verification

- Promotion and stage gate implemented with specs; tests + typecheck pass; reviewer accepted

### Batch 6 on-disk verification (team-leader, 2026-10-01)

Result: ISSUES (one: deviation 4 below; a fix-up is required before commit). Glm logic lane reviewing in parallel →
code-logic-review.md `## Batch 6`. Not committed.

- Files on disk (real code, no TODO/FIXME/PLACEHOLDER/STUB/XXX): MODIFY `SS/skill-promotion.service.ts` (1084 raw
  lines, 688 effective), `SS/queue/stage-handlers.service.ts`, `SS/skill-promotion.service.spec.ts`,
  `SS/skill-promotion.repropagation.spec.ts`, `SS/skill-synthesis.stage-handlers.spec.ts`. `SS/skill-suggestion.store*`
  in the working tree belong to Batch 8, not Batch 6.
- 6.1 automatic path: `isSlugTaken` excludes the candidate's own name (`:324`), `promoteAtomically(..., name:
  materialized.slug)`, repropagates `materialized.slug`. Cap selection extracted to `selectWeakestResident` (`:607`).
- R-f / R-f2: `commitResidentPromotion` (`:537-569`) is one `inImmediateTransaction` holding `registerCandidate` →
  re-entrant `promoteAtomically` → `linkRegistryRow` (`getBySlug` + `upsert`, plain statements) → `onCommit(row)`;
  no catch inside. The adopt link-only path (`:490`) wraps only `onCommit(existing)`. `promoteSuggestion`'s catch
  (`:434-448`) wraps the whole call, removes the directory and rethrows. Spec: throw after `registerCandidate`, an
  `onCommit` throw and a UNIQUE on name each leave no row and no directory.
- 6.2: `case 'scored'` → `applyJudgePanelGate` (`stage-handlers.service.ts:545-596`), CAS `rejectIfStatus(id,
  'candidate','below-judge-score')`, reasons `:rejected` / `:not-candidate`; specs below/at/lost-CAS. 6.3 doc reworded.
- Re-run by team-leader (scoped): `--testFile=skill-promotion` 2 suites 76/76; `--testFile=stage-handlers` 47/47;
  typecheck success; lint 0 errors, no `max-lines` for the promotion file (effective 688 < 700; its only warning is
  the pre-existing `no-useless-assignment` at `:310`); degradation audit exit 0, `skill-synthesis: 6 ok (baseline 6)`.
  Full suite not run (Batch 8 in parallel).

Deviation decisions:

1. Rethrow instead of `{promoted:false, reason:'write-failed'}` — ACCEPTED. It matches the Batch 9 R-f2 rule
   (`{accepted:false}` comes from a catch around the whole call) and keeps the original error. Carry to 9.1/9.3:
   both callers must catch.
2. Generic `onCommit: (row) => T` — ACCEPTED. It avoids importing Batch 8's `MergeOutcome` into the promotion file.
3. Trailing `nowFn`; adopt repropagates with origin `{}` — ACCEPTED. The plan's adopt signature has no origin; the
   reconcile runs with no query origin.
4. `linkRegistryRow` sets `cloneStatus:'synth'` over any existing row (`skill-promotion.service.ts:596`) — REJECTED
   as written. Defect: for a `diverged` row it keeps `diverged = true` but writes `clone_status = 'synth'`, an
   inconsistent row. Retirement exempts by `clone_status` only (`lifecycle/skill-retirement.service.ts:349-350`) and
   `registry.remove` deletes only `synth`, so a skill the user edited becomes retirable and its folder deletable. A
   plugin `clone` row would also lose its owner. Required fix (same executor): use the precedence the catalog
   already applies to a slug with a candidate (`skill-registry-catalog.service.ts:91-96`): (a) `existing.diverged`
   or `cloneStatus === 'diverged'` → keep `'diverged'`; (b) `cloneStatus === 'clone'` or `originPluginId !== null` →
   throw a named error inside the transaction (rollback; promote removes its directory, adopt keeps it); (c) otherwise
   `'synth'`. Flipping `authored` → `synth` stays: the catalog sync does the same on its next pass once a candidate
   holds the name, and pre-578 accepted suggestions are catalogued `authored` because they had no candidate row.
   Add specs: adopt over a diverged row keeps `diverged` + candidate_id set; adopt over a clone row throws and
   leaves no candidate row. Carry to 9.3 (HARD): the reconcile adopts only a slug proven to be an accepted
   suggestion's directory, never a slug matched by name alone, since that is the only guard for hand-written skills.
5. File size — ACCEPTED. Effective 688 lines (rule skips blanks and comments), under the 700 soft ceiling; raw 1084
   is mostly contract docs. No split now. If Batch 9 or 12 pushes it over 700, extract the shared tail
   (`commitResidentPromotion`, `linkRegistryRow`, `selectWeakestResident`, `afterResidencyChange`) into a
   `ResidentPromotionWriter` collaborator under `SS/lifecycle/`, with `SkillPromotionService` staying the facade.

- Carry (out of scope, from the executor): adopt on a slug held by a non-promoted row hits UNIQUE on name and throws
  on every start. Batch 9.3 decides (skip + warn, or reuse that row).

### Batch 6 review verdict

- Logic (Glm lane): NEEDS_REVISION 7/10 — code-logic-review.md `## Batch 6`. S-1 `linkRegistryRow` always wrote
  `synth`; M-1 adopt hits UNIQUE on a slug held by a non-promoted row; M-2 over-cap race. Rethrow deviation ACCEPTED on
  condition that Batch 9 catches around `promoteSuggestion` / `adoptMaterializedSkill` and adds a spec.
- S-1 decision (orchestrator, team-leader proposal): catalog precedence, not the reviewer's "preserve existing
  status". Reason: `SkillRegistryCatalogService.deriveStatus` (`skill-registry-catalog.service.ts:91-96`) rewrites
  `authored` to `synth` at the next sync once a candidate holds the name, so preserving `authored` would not last and
  would hide pre-578 accepted suggestions (catalogued `authored`) from cap and retirement. Diverged is kept; a plugin
  clone is refused.
- Fix-up (same executor): `RegistrySlugOwnedByPluginError` (`skill-promotion.service.ts:161-177`); adopt doc comment
  with the Task 9.3 rule (`:493-497`); `linkRegistryRow` (`:612-641`) keeps `diverged` (flag or status), throws on
  `clone` / `originPluginId !== null` inside the transaction, else `synth`; 5 new real-SQLite specs.
- Re-review (antigravity lane; Glm hit its 429 limit): APPROVED 8/10 — code-logic-review.md `### Batch 6 re-review`
  (:945). S-1 resolved; M-1, M-2 carried.
- Team-leader re-verification on disk: R-f/R-f2 hold — `commitResidentPromotion` (`:561-594`) unchanged, one
  transaction, no catch inside; the new throw is deliberate and uncaught, so it rolls back the unit. Scoped re-runs:
  `--testFile=skill-promotion` 2 suites 81/81; `--testFile=stage-handlers` 47/47; typecheck success; degradation
  audit exit 0, `skill-synthesis: 6 ok (baseline 6)`.
- max-lines reconciled: the reviewer's 1008 is `skill-synthesis.service.ts` (the lint line next to it), not this
  file. `skill-promotion.service.ts` after the fix-up: 1126 raw, 707 effective (rule skips blanks and comments),
  so it now raises a `max-lines` WARNING, 7 over the 700 soft ceiling, well under 1000. Accepted for this batch;
  the split below becomes a required follow-up rather than optional.
- **Batch 6 ACCEPTED. Committed `5c29b6fe6`** (5 explicit paths). Batch 8 files (`SS/skill-suggestion.store*`,
  `SS/lifecycle/skill-umbrella-merge*`, `SS/di/*`) left unstaged.
- Carries to Batch 9:
  1. (HARD) 9.1 / 9.3 callers catch around the whole `promoteSuggestion` / `adoptMaterializedSkill` call
     (including `RegistrySlugOwnedByPluginError`) and return the fail-soft answer, with a spec each.
  2. (HARD) Task 9.3 adopts only a slug proven to be an accepted suggestion's materialized directory, never a slug
     matched by name alone.
  3. Task 9.3 decides adopt on a slug held by a non-promoted row (M-1): skip + warn, or reuse that row.
- Follow-ups (future-enhancements.md): M-2 over-cap race between `selectWeakestResident` and the transaction;
  extract the shared tail (`commitResidentPromotion`, `linkRegistryRow`, `selectWeakestResident`,
  `afterResidencyChange`) into a `ResidentPromotionWriter` under `SS/lifecycle/` with `SkillPromotionService` as the
  facade — due before Batch 9 or 12 adds lines to the file.

## Batch 7: SkillRetirementService — COMPLETE (commit 8c8e05bdd)

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic + security scope (destructive filesystem removal)
- Rationale: new service with destructive actions; shares DI files with Batch 8, so they are sequential.
- Tasks: 2 | Depends on: Batches 2, 3, 4
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 7.1: Retirement service and acceptance-3 spec — COMPLETE

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

### Task 7.2: DI token and registration — COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `.../di/register.ts` (+ `register.spec.ts` if needed)
- Implementation details: `SKILL_RETIREMENT_SERVICE`. R-i.

### Batch 7 verification

- Service and spec exist; acceptance-3 cases pass; reviewer accepted

### Batch 7 on-disk verification (team-leader, 2026-10-01)

Result: VERIFIED (pending the two cross-side reviews: Glm logic → code-logic-review.md `## Batch 7`, opencode
Kimi K2.7 security → code-security-review.md `## Batch 7`). Not committed.

- Files on disk (real code, no TODO/FIXME/PLACEHOLDER/STUB): CREATE `SS/lifecycle/skill-retirement.service.ts`
  (371 lines) and `.spec.ts` (459 lines, 15 tests); MODIFY `SS/di/tokens.ts` (`SKILL_RETIREMENT_SERVICE =
  Symbol.for('PtahSkillRetirementService')`), `SS/di/register.ts` (`registerSingleton` + `useToken` alias),
  `SS/di/register.spec.ts` (singleton + alias + description case).
- 6 explicit `@inject` deps match plan:780-786 (registry, repropagation, workspace optional).
- R-f / R-f2: `retire()` (`skill-retirement.service.ts:204-224`) holds only plain statements in one
  `inImmediateTransaction` — `rejectIfStatus(id,'promoted',RETIRED_UNUSED_REASON,now)` then
  `registry.remove('skill', name)` only when it returned true; no catch inside the callback; the per-row catch at
  `:131-142` wraps the whole call. Spec "mid-callback throw" proves rollback and loop continuation.
- R-j: `removeActiveDir()` (`:232-256`) requires `path.relative(activeRoot, dir) === row.name` and
  `basename(dir) === row.name`; the root itself, nested dirs, `..` and absolute escapes all fail.
- Zod `z.number().int().min(1).max(3650)`, default 30, warn on invalid; exempt pinned + registry
  `authored`/`diverged`.
- Re-run by team-leader (scoped): `test --testFile=skill-retirement` 15/15; `test --testFile=di/register` 11/11;
  `typecheck` (skip-nx-cache) success; degradation audit exit 0, `libs/backend/skill-synthesis: 6 ok (baseline 6)`.
  Full suite deliberately not run (Batch 5 fix-up executor running tests in parallel).

Deviation decisions:

1. Uncontained path → row stays promoted + warn, no DB retire — ACCEPTED. The plan (:741-744) reads as "skip the
   FS step, still retire in DB". That would reject a row whose SKILL.md may still be live (e.g. a `-2` suffixed
   or sanitized dir inside the root, since `promoteToActive` does not rename `row.name`), leaving an orphan active
   skill with no DB owner. Keeping it promoted is the consistent, non-destructive choice. RESIDUAL RISK (recorded,
   not a Batch 7 blocker): such rows — suffixed/sanitized slugs, or every row after the user changes the skills
   root setting — are never retired and warn on every pass. Carry to Batch 9 (reconcile of suffixed slugs, A1)
   and Batch 13 proof 3 (A4); logic reviewer may weigh it.
2. Registry bound but unreadable → whole pass skipped — ACCEPTED. Fail-closed is required: without the
   authored/diverged set, a pass could delete user-owned content. Unbound registry keeps the plan's pinned-only
   fail-soft (plan:791-792).
3. `removeMaterializations` returns the removed slugs — ACCEPTED. Additive; plan gives no return type and the
   Batch 9 accept path can use it for logging.
4. `registry.remove` unchanged — ACCEPTED. It already landed in Batch 4 (`bbd02ebf8`,
   `SS/skill-registry.store.ts:196-209`) with the guarded `clone_status` delete the plan asks for; no Batch 7 change
   needed.
5. `fs.rmSync` directly instead of `mdGenerator.removeActive` — ACCEPTED. `removeActive` takes a
   `MaterializedSkill` (not a row), only checks `startsWith(root + sep)` (no basename = slug rule), and sits in
   `skill-md-generator.ts`, a Batch 5 file under fix-up; depending on it would couple the Batch 7 commit to
   Batch 5. The stricter R-j check lives in one private method.

### Batch 7 review verdict

- Logic (Glm lane): APPROVED 8/10 — code-logic-review.md `## Batch 7`. M1 `listPromotedLastUse` throw escapes
  `run()`; M2 no `skippedUncontained` counter; minor spec gaps.
- Filesystem safety (antigravity lane): NEEDS_REVISION 6/10 — code-security-review.md `## Batch 7`. S1 unbound
  registry exempted pinned only; S2 folder removed before the DB move; TOCTOU between snapshot and delete; letter
  case of exempt slugs; symlink (minor).
- Fix-up (same executor, 6 items): `readExemptSlugs` fails closed when no registry is bound, `run()` returns
  `skippedReason: 'registry-unavailable'` (supersedes the pinned-only half of deviation 2 above;
  `SKILL_REGISTRY_STORE` is registered unconditionally in `di/register.ts`, so only test hosts hit it);
  `stillRetirable()` re-reads row + registry right before `removeActiveDir`; case-insensitive exempt lookup;
  `readPromotedLastUse` wrapper (M1); `skippedUncontained` in the result (M2); extra specs (22 total).
- Re-review (Glm, antigravity returned 503): APPROVED 8/10 — code-security-review.md `### Batch 7 re-review`. S1,
  TOCTOU and letter case resolved; symlink accepted (fails closed); S2 reduced to MODERATE.
- S2 decision (orchestrator): keep the plan's order, folder first then one transaction. Reason: DB-first leaves an
  orphan live folder with no promoted owner after a failed `rmSync`, while folder-first self-heals (`rmSync` force
  is idempotent; the next pass finishes the DB move).
- Team-leader re-verification of the fix-up on disk: R-f/R-f2 still hold (`skill-retirement.service.ts:241-262`,
  no catch inside the callback, per-row catch `:146-157`). Scoped re-runs: retirement 22/22, `di/register` 11/11,
  typecheck (skip-nx-cache) success, degradation audit exit 0 (`skill-synthesis: 6 ok, baseline 6`).
- Follow-ups for future-enhancements.md (MINOR, not fixed):
  1. `stillRetirable` does not re-check `lastUsedAt`; an invocation between the pass snapshot and `rmSync` can
     still retire a just-used skill.
  2. `registry.remove('skill', row.name)` at `skill-retirement.service.ts:252` is not case-normalized, unlike the
     exemption lookup.
- Remaining risk (carried from deviation 1): rows whose directory name differs from `row.name` (suffixed `-2..-5`
  or sanitized slugs, or every row after the skills-root setting changes) are never retired and warn every pass
  (now counted in `skippedUncontained`) until Batch 6 / Task 9.3 align names with the materialized slug.

## Batch 8: SkillUmbrellaMergeService — COMPLETE (commit ddb6e1348)

- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: the largest new unit (umbrella, R7, singletons, one-time purge) with real-DB specs.
- Tasks: 3 | Depends on: Batches 4, 5
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 8.1: Umbrella merge service and spec — COMPLETE

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.ts` and `.spec.ts`
- Plan reference: implementation-plan.md:503-606 (R1, R2, R3, R5, R6, R7 at :120-174)
- Pattern to follow: current suggestion pass `SS/skill-curator.service.ts:390-536` (authored-dominance guard
  `:434-448`, rate limit `:449-458`, judge `:474-504`); move `technologyFingerprint`/`readCandidateBody`
  (`:669-699`) verbatim (the curator copies are removed in Batch 9).
- Validation notes: R-f; R-f2 (the per-cluster try/catch wraps the whole `inImmediateTransaction` call, never sits
  inside it; spec: a throw mid-cluster leaves no umbrella row and no member marked merged); re-read members inside the transaction and abort on change;
  `rejectIfStatus` false → skip, not counted; purge only when marker absent, vec available, pool not truncated;
  never throws into the caller. 8 explicit `@inject` deps; exempt slugs passed in by the caller. R-n (hard
  requirement): never pass the umbrella id to `markMerged`; check its returned count and throw inside the callback
  on mismatch (see Task 8.3). Batch 5 review carry (hard): sort each cluster's members by distance to the cluster
  centroid (closest first, using `PoolMember.embedding`) before `synthesizeUmbrella`, which keeps only the first
  `UMBRELLA_MAX_MEMBERS`; spec case with a cluster > 12 proves the farthest members are the ones dropped.
- Implementation details: returns `UmbrellaPassResult` with `clustersRemaining` and `rateLimited`. Spec cases per
  plan:589-604 on a real migrated DB with a plain `skill_candidates_vec(rowid INTEGER PRIMARY KEY, embedding BLOB)`.

### Task 8.2: DI token and registration — COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `.../di/register.ts` (+ `register.spec.ts` if needed)
- Implementation details: `SKILL_UMBRELLA_MERGE_SERVICE`. R-i.

### Task 8.3: markMerged self-exclusion (R-n, Batch 4 review F-1) — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts` (+ `skill-suggestion.store.spec.ts`)
- Do this before Task 8.1 (Task 8.1 depends on it).
- Implementation details: in `markMerged` (`:197-209`), drop `umbrellaId` from the de-duplicated id list before
  the empty check and the UPDATE. Spec: umbrella id passed among `ids` → umbrella row stays `pending` with
  `merged_into` NULL and the returned count excludes it.
- Task 8.1 hard requirement (same risk): compare `markMerged`'s return with the expected pending-member count and
  throw inside the transaction callback on mismatch; spec case where one member became non-pending → no umbrella
  row and no member marked merged.

### Batch 8 verification

- Service and spec exist with all listed cases; tests + typecheck pass; reviewer accepted

### Batch 8 on-disk verification (team-leader)

- Files on disk match the report: NEW `lifecycle/skill-umbrella-merge.service.ts` (868 lines, under the 700
  code-line `max-lines` ceiling with comments/blanks skipped) and `.spec.ts` (25 cases); `skill-suggestion.store.ts`
  `markMerged` filters `umbrellaId` before the empty check (+1 spec); `di/tokens.ts`
  `SKILL_UMBRELLA_MERGE_SERVICE = Symbol.for('PtahSkillUmbrellaMergeService')`; `di/register.ts` singleton +
  `useToken` alias; `register.spec.ts` resolves all 8 deps through the real registration. No TODO/stub markers.
- R-f: transaction callbacks hold only plain statements. `commitUmbrella` (`:518-545`): `membersUnchanged`
  (findById reads) → `suggestions.insert(…,'pending')` → `markMerged` → `rejectIfStatus` loop.
  `commitRejectedUmbrella` (`:558-566`): `insert(…,'dismissed')` → `rejectIfStatus` loop over candidate members only.
  Singletons (`:659-678`): findById → `listMemberCandidateIds` → `insert`. Purge (`:717-719` → `:753-791`):
  marker re-read → `listMemberCandidateIds({statuses:['pending','accepted']})` → `listByStatus` → `getEmbedding`
  → `rejectIfStatus` → `markComplete` (false → throw).
- R-f2: no catch inside any callback that swallows a store-write error. The per-cluster catch (`:276-288`) wraps
  `mergeCluster` (synthesis, judge and the whole transaction); singleton (`:658-689`) and purge (`:716-734`)
  catches wrap their whole `inImmediateTransaction` call. The only catch reachable from inside a callback is
  `readCandidateBody`'s fs catch (`:811-821`, singleton callback), which never wraps a store write. Spec
  "R-f2: a throw mid-cluster…" (spec `:535`) proves no umbrella row and no member merged.
- R-n: `markMerged` never receives the umbrella id (store filter + caller filter `:521-523`); the returned count
  is compared with the expected pending-suggestion count and throws inside the callback (`:528-532`). Spec `:493`
  forces a member non-pending between re-read and UPDATE → whole cluster rolled back, warn carries
  "merged 1 of 2 pending suggestions".
- Batch 5 member-order carry: `buildPlan` orders by cosine similarity to the centroid (`orderByCentroidDistance`
  `:846-868`) and `umbrellaInputs` iterates `plan.ordered` (`:461-480`); spec `:562` (14 members) proves the two
  farthest sit at positions 12-13, past the `UMBRELLA_MAX_MEMBERS` cut. Hold-out body never reaches the synthesizer.
- Re-run by team-leader (scoped, `--skip-nx-cache`): `--testFile=skill-umbrella-merge` 25/25;
  `--testFile=skill-suggestion.store` 29/29; `--testFile=di/register` 12/12; `typecheck` success; eslint on the 7
  changed files 0 problems (`--max-warnings=0` on the service, exit 0); degradation audit exit 0,
  `libs/backend/skill-synthesis: 6 ok (baseline 6)`.

Deviation decisions:

1. memberSessionIds include merged suggestions' sessions — ACCEPTED. Suggestion members are always drafted, so
   their sessions are part of what the umbrella body was written from; it is the plan's intent.
2. `purgeSkippedReason: 'failed'` — ACCEPTED. Carry to Batches 9 and 11: the curator report and shared DTO must
   include `'failed'` in the union.
3. `clustersRemaining` = clusters not reached because of the cap or the rate limit (guard-skipped clusters count
   as visited) — ACCEPTED; matches plan "eligible clusters left unprocessed".
4. Judge anchor = drafted member closest to the centroid, else first resolvable suggestion member, else skip —
   ACCEPTED. Minor note (follow-up, not blocking): a skipped cluster has already spent its `skill.analyze` token.
5. Singletons in one transaction each with a re-check — ACCEPTED (plan silent; per-item rollback is the safer
   shape). Minor fix-up F8-3 below.
6. Copied helpers with `[skill-synthesis]` log prefix — ACCEPTED (curator copies removed in Batch 9).
7. Authored-dominance guard uses caller `exemptSlugs` with exact-case match — ACCEPTED (identical to the current
   curator `skill-curator.service.ts:434-448`). Carry to Batch 9: the curator builds one exempt set; if it reuses
   the retirement lowercased set, the guard and `partitionPool` must normalise case the same way.

Out-of-scope notes:

- `types.ts:22` says `MERGED_INTO_PREFIX + umbrellaSlug`; R3 and the code use the umbrella suggestion id —
  Batch 8 fix-up F8-1 (comment only).
- `SkillBacklogPurgeStateStore` header `:8-11` and the read() catch comment `:69-70` claim an unreadable marker
  makes the purge skip; `read()` returns `null`, which `purgePrecondition` treats as absent, so the purge runs and
  is saved only because `markComplete` then throws and rolls the unit back (missing table) — behaviour is safe,
  the comments are wrong. Batch 8 fix-up F8-2 (correct both comments to the actual rollback guarantee; no
  behaviour change). A tri-state `read()` is a follow-up, not this task.

Fix-up list (pending the logic-lane verdict; all small, no behaviour change except F8-3):

- F8-1 `libs/backend/skill-synthesis/src/lib/types.ts:22`: "umbrellaSlug" → "umbrella suggestion id (R3)".
- F8-2 `libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.ts:8-11, :69-70`: state that
  `null` is indistinguishable from absent and the purge relies on `markComplete` throwing inside its transaction.
- F8-3 (MINOR, recommended) `skill-umbrella-merge.service.ts:664-675`: read the singleton body and fingerprint
  before `inImmediateTransaction`, so no file I/O runs while the IMMEDIATE write lock is held (the body is also
  read twice today).

### Batch 8 review verdict

- Logic (antigravity CLI lane, `code-logic-review.md` `## Batch 8`): APPROVED 8/10. Moderates: exact-case
  authored-dominance guard; mismatched-dimension members reaching the synthesizer. Minors: `types.ts:22` comment,
  purge-state `read()` null ambiguity. Team-leader Mode 2: VERIFIED with F8-1..F8-3.
- Fix-up applied by the executor (reviewer-own findings, no new review round) and re-verified on disk:
  - F8-1 `types.ts:22` comment now names the umbrella suggestion id (R3).
  - F8-2 `skill-backlog-purge-state.store.ts` header `:8-13` and catch comment `:69-70` describe the real
    guarantee (null reads as absent; `markComplete` throws in the transaction and rolls the purge back).
  - F8-3 `surfaceSingletons` builds the input (body read + fingerprint) before the transaction (`:683-700`).
  - Lane moderate 1: `runPass` builds `exemptLower` once (`:208-210`); `planCluster` compares
    `dominant.toLowerCase()` (`:339`); `partitionPool` still receives the caller's original set. Spec
    'My-Skill' vs 'my-skill'.
  - Lane moderate 2: `orderByCentroidDistance` returns `{ordered, mismatched}` over the majority dimension;
    excluded members are not synthesized, not the judge anchor, not merged; warn per cluster; a cluster below
    `suggestionMinClusterSize` after exclusion is skipped before the rate limiter (`:314-338`). Excluded members
    stay in the purge's `clustered` set (protected, conservative). 2 specs.
- `lifecycle/centroid-order.ts` (50 lines) decision: ACCEPTED. A named, generic, pure function
  (`orderByCentroidDistance<T extends {embedding}>` + `CentroidOrder<T>`) with one responsibility and its own
  doc; not a cap-only fragment. Service now 861 lines, under the 700 code-line `max-lines` ceiling.
- R-f / R-f2 / R-n re-checked after the fix-up: `commitUmbrella` `:541-568`, `commitRejectedUmbrella` `:581-589`,
  singleton callback `:693-700` (plain reads + insert only), purge `:739` → `purgeInTransaction`; all catches
  wrap whole transaction calls; umbrella id filtered and count-checked with an in-callback throw (`:544-555`).
- Re-run by team-leader (scoped, `--skip-nx-cache`): `--testFile=skill-umbrella-merge` 28/28;
  `--testFile=skill-suggestion.store` 29/29; `--testFile=skill-backlog-purge-state` 6/6;
  `--testFile=di/register` 12/12; `typecheck` success; eslint `--max-warnings=0` on the 10 Batch 8 files exit 0;
  degradation audit exit 0, `libs/backend/skill-synthesis: 6 ok (baseline 6)`.
- Carries to Batch 9: the curator builds ONE exempt set and passes it to both retirement and umbrella merge,
  with consistent case handling (umbrella lowercases internally for the guard; `partitionPool` gets the set as
  passed); `purgeSkippedReason: 'failed'` must surface in the curator report, and in the Batch 11 shared DTO union.
- Follow-ups (not this task): `SkillBacklogPurgeStateStore.read()` cannot tell absent from unreadable (tri-state
  read); its warn text still says "purge will skip" though the effect is a rollback; a cluster skipped for
  having no judge anchor has already spent a `skill.analyze` token.

## Batch 9: SkillCuratorService rewrite (facade) — COMPLETE (commit 678db0b17)

- Recommended executor: backend-developer sub-agent
- Fallback executor: none (needs design judgement on the facade); re-run the sub-agent with reviewer findings
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: rewrite of one service plus its spec and the e2e spec that drove the old suggestion pass (R-d).
- Tasks: 4 | Depends on: Batches 6, 7, 8
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 9.1: runPass orchestration and report — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-curator.service.ts` (+ `skill-curator.service.spec.ts`, rewritten)
- Plan reference: implementation-plan.md:659-725
- Implementation details: order retirement → umbrella → enhancement (unchanged) → report → `curator-pass` event
  with the new stats; remove the 0-promoted early return and the LLM overlap review; `CuratorReport` keeps
  `{reportPath, changesQueued, skippedPinned, suggestionsCreated}`; each sub-pass in its own try/catch. Deps: 9
  (logger, store, rateLimiter, registry, enhancer, suggestionStore, umbrella, retirement, promotion), all explicit
  `@inject`. Remove `technologyFingerprint`/`readCandidateBody` copies.

### Task 9.2: acceptSuggestion delegates to promoteSuggestion — COMPLETE

- Same files. Plan reference: implementation-plan.md:677-688
- Validation notes: R-f; R-f2 (`{accepted:false}` comes from a catch around the whole transaction call, after
  rollback; spec: a throw after the promotion write leaves the suggestion pending and no promoted row); pinned members skipped; registry `remove` for merged promoted members inside the
  transaction; `retirement.removeMaterializations` after commit; `{accepted:false}` on any failure, suggestion stays pending.

### Task 9.3: reconcileAcceptedSuggestions at start — COMPLETE

- Same files. Plan reference: implementation-plan.md:689-696
- Validation notes: A1 — match registry rows of either `authored` or `synth`, require `<activeRoot>/<slug>/SKILL.md`,
  slug ∈ {s, s-2..s-5}; runs before the `curatorEnabled` early return; idempotent; never throws out of `start()`.
- Scope addition (team-leader, during Batch 9, executor-reported plan gap, verified on disk): `accept()` goes through
  `transition()`, which returns a non-`pending` row unchanged (`SS/skill-suggestion.store.ts:305-307`), so it cannot
  write `promoted_candidate_id` on an already-`accepted` row; without a write the "second start is a no-op" case
  cannot hold. Approved: add `SkillSuggestionStore.linkPromotedCandidate(id, candidateId): boolean`, one plain
  `UPDATE ... SET promoted_candidate_id = ? WHERE id = ? AND status = 'accepted' AND promoted_candidate_id IS NULL`
  returning `changes === 1` (no own transaction, R-f; no catch, R-f2), plus specs in `skill-suggestion.store.spec.ts`
  (links once; second call / non-accepted / already-linked → false and row unchanged). Reconcile calls it inside the
  `inImmediateTransaction` unit and throws on `false` so the unit rolls back. Files added to Batch 9:
  `SS/skill-suggestion.store.ts`, `SS/skill-suggestion.store.spec.ts`. Batch 12 (deletions in the same store) runs
  later and must keep this method.

### Task 9.4: Retarget the cluster hold-out end-to-end spec — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/gates/cluster-holdout-end-to-end.spec.ts`
- Validation notes: R-d — it mocks `clusterCandidates`, `synthesizeFromCluster`, `hasExistingForCluster`,
  `insertPending` (`:194-254`) against the curator. Retarget to `SkillUmbrellaMergeService` (`partitionPool`,
  `synthesizeUmbrella`, `insert`) keeping its hold-out assertions; it must stop referencing the four old symbols.

### Batch 9 verification

- Curator rewritten (~550 lines), no caller of the old methods remains outside their own files; tests + typecheck
  pass; reviewer accepted

### Batch 9 on-disk verification (team-leader)

- Files on disk, real implementations (no stubs): `SS/skill-curator.service.ts` (834 lines), `SS/lifecycle/adoptable-slug.ts`
  and `SS/lifecycle/curator-report.ts` (new), `SS/skill-suggestion.store.ts` (+`linkPromotedCandidate`, +17), and specs
  `skill-curator.service.spec.ts`, `skill-suggestion.store.spec.ts`, `gates/cluster-holdout-end-to-end.spec.ts`,
  `di/register.spec.ts`.
- R-f / R-f2 by reading: `commitAccept` (`:412-428`), `mergeMembers` (`:437-468`), `commitReconcile` (`:627-638`) call only
  plain statements (`accept`, `findById`, `rejectIfStatus`, `registry.remove`, `linkPromotedCandidate`) and hold no catch.
  The fail-soft answers come from catches around the whole `promoteSuggestion` (`:383-401`) / `adoptMaterializedSkill`
  (`:597-620`) call.
- Re-run by team-leader (`--skip-nx-cache`): `skill-synthesis:typecheck` pass; `lint` 0 errors, 27 warnings, none in a
  Batch 9 file; tests 84 suites passed + 1 skipped, 1788 passed / 1 skipped / 0 failed; degradation audit exit 0,
  `libs/backend/skill-synthesis: 5 ok (baseline 6)`.
- Not Batch 9 (do not stage): `libs/frontend/skill-synthesis-ui/**` (Batch 14, another team-leader), `context.md`,
  `visual-review.md`, `visual/`.

### Batch 9 open-point decisions (team-leader)

1. `linkPromotedCandidate` — ACCEPTED. It is the scope addition approved during Batch 9 (Task 9.3 above). It is one guarded
   UPDATE with no own transaction and no catch, and it has 4 store specs. Batch 12 must keep it.
2. `materializedBaseSlug` duplicates the private `SkillMdGenerator.sanitizeSlug` (`skill-md-generator.ts:419-426`). It is
   ACCEPTED as a copy: making `sanitizeSlug` public widens the generator's API for one caller. Condition: a spec must
   pin the two together, e.g. `promoteToActive` with an awkward name writes `<root>/<materializedBaseSlug(name)>`. If
   they drift, the result is fail-closed but silent (legacy accepted suggestions are never adopted). This spec is part
   of the revision below.
3. `lifecycle/adoptable-slug.ts` and `lifecycle/curator-report.ts` — ACCEPTED under the facade rule. Each module has
   one nameable purpose: the A1 proof rule (`findAdoptableSlug`), and the pass-stats type plus its report writer
   (`CuratorPassStats`, `writeCuratorReport`). Neither is a fragment of the curator's private state, and both sit in
   `lifecycle/` next to their siblings.
4. 10 constructor deps (plan: 9) — ACCEPTED. `mdGenerator` is read only for `activeRoot()` (reconcile rule A1), and a
   root-path token would be a new DI surface for the same value. Carry: if Batch 12 adds an 11th dep, extract the
   reconcile (`reconcileAcceptedSuggestions`, `reconcileOne`, `commitReconcile`) into a `lifecycle/` collaborator.
5. Degradation baseline 6 → 5 — ACCEPTED. The drop comes from removing the old curator's sentinel catch. `tools/degradation-audit/baseline.json` is
   shared config outside this batch's files and is NOT edited here. Carry to Batch 12 / Mode 3: ratchet the
   `libs/backend/skill-synthesis` entry down to the final count after Batch 12's deletions.

### Batch 9 review verdict

- Review mode (user decision, 2026-10-02: "In-process now, lane later"): no CLI vendor had quota, so an in-process
  code-logic-reviewer is this batch's review. An antigravity lane re-reviews the same Batch 9 commits before the PR,
  and its findings land as fix-up commits.
- Logic (in-process code-logic-reviewer): NEEDS_REVISION 7/10 (`code-logic-review.md` `## Batch 9`). No BLOCKING
  findings; production logic holds for R-f, R-f2, the Batch 6 HARD carries (in code) and the Task 9.1 order.
- Revision list (same executor; real fixes, no suppressions):
  1. S-1 (spec gaps on the adopt path, `skill-curator.service.spec.ts:1015-1029`). Add (a) a real-DB mid-callback
     throw in the adopt `onCommit` proving rollback: no promoted row, `promoted_candidate_id` NULL, registry row
     unchanged. This is the R-f2 proof on the adopt side; accept already has it at `:774-791`. Add (b) an adopt-side
     `RegistrySlugOwnedByPluginError` → `failed` case (Batch 6 HARD carry 1: "a spec each"). Add (c) the
     `linkedOnly` adopt branch, (d) `runManual` awaiting an in-flight reconcile, and (e) a reconcile that merges a
     promoted member and removes its directory after commit.
  2. M-1 (`skill-curator.service.ts:690-701`): `exempt` is assigned before `listByStatus('promoted')` runs, so a throw
     there returns a PARTIAL set and the umbrella pass runs fail-open. Build the set in a local and assign it only
     after both reads succeed, so a throw returns `null`. Add a spec for that case.
  3. Decision 2 above: a spec pinning `materializedBaseSlug` to `SkillMdGenerator`'s slug derivation.
- Carried, not part of this revision:
  - M-2: reconcile applies the full member merge to legacy accepted suggestions, so promoted members' directories are
    removed at boot. This follows plan A1/9.3; it goes to the Mode 3 handoff for user visibility.
  - M-3: unproven legacy rows (edited body) warn on every start and are never adopted. This fails safe; it goes to
    `future-enhancements.md` (a one-time warn, or a relaxed proof).
  - M-4: a pass awaits the reconcile with no timeout, and the reconcile's repropagation is not user-initiated. This
    goes to `future-enhancements.md`.
  - MINOR: `start()` twice leaks the interval (pre-existing); `skippedExempt` is only logged. Both go to
    `future-enhancements.md`.

### Batch 9 re-review and commit

- Revision (same executor): adopt-path specs S-1 (a)-(e) in `skill-curator.service.spec.ts:1073-1273`; M-1 fixed
  (`skill-curator.service.ts:680-701`, local `built`, `null` on throw; spec `:441-460`); slug pin in the new
  `lifecycle/adoptable-slug.spec.ts:46-83` (10 names through the real `promoteToActive`, 2 that sanitize to nothing).
- Logic re-review (in-process code-logic-reviewer): APPROVED 8/10 (`code-logic-review.md` `## Batch 9 re-review`).
  Every revision item is resolved and every spec is load-bearing; R-f / R-f2 hold. Two MINOR notes (no `linkedOnly`
  rollback case of its own; the M-1 spec throws on every `listByStatus` call), not blocking.
- Team-leader pre-commit re-run (`--skip-nx-cache`): skill-synthesis typecheck pass; lint 0 errors / 27 warnings
  (unchanged); degradation audit exit 0 (`skill-synthesis: 5 ok (baseline 6)`). Each suite was run alone:
  - `skill-curator.service.spec` 31/31
  - `adoptable-slug.spec` 12/12
  - `cluster-holdout-end-to-end.spec` 3/3
  - `skill-suggestion.store.spec` 33/33
  - `register.spec` 13/13
- Load flakes, not regressions: `spec-harvester.service.spec` (13/13) and
  `cleanup/skill-backlog-cleanup.integration.spec` (2/2) pass in isolation. They timed out at 5000 ms only in
  full-project runs. Batch 9 does not touch either file.
- Committed as 678db0b17 with exactly the 9 Batch 9 source/spec files. Not staged: `context.md`,
  `visual/batch-14/_work/`.
- Antigravity lane re-review of 678db0b17 is still owed before the PR (user decision); its findings land as fix-up
  commits.

### Batch 9 carries

`future-enhancements.md` does not exist yet; these are the carries until Mode 3 consolidates them.

- Batch 12:
  - keep `SkillSuggestionStore.linkPromotedCandidate`;
  - ratchet `tools/degradation-audit/baseline.json` `libs/backend/skill-synthesis` down to the final count after the
    deletions (5 today);
  - if the curator gains an 11th constructor dep, extract the reconcile (`reconcileAcceptedSuggestions`,
    `reconcileOne`, `commitReconcile`) into a `lifecycle/` collaborator.
- Mode 3 handoff (user visibility), M-2: the boot reconcile merges promoted members of legacy accepted suggestions and
  removes their directories. This follows plan A1/9.3, but before 578 an accept never merged promoted members.
- Future enhancements:
  - M-3: unproven legacy rows (body edited) warn on every start and are never adopted. Options: a one-time warn, or a
    relaxed proof.
  - M-4: a pass awaits the reconcile with no timeout, and the reconcile's repropagation is not user-initiated, so a
    manual run can wait behind it.
  - MINOR: a second `start()` leaks the first interval (pre-existing).
  - MINOR: `skippedExempt` is only logged, not returned.
  - MINOR: no dedicated rollback spec for the `linkedOnly` adopt branch.
  - R-l (from Batch 3): N+1 in `listActiveOrderedByDecayScore`.

## Batch 10: Diagnostics counts and SS default (post-586) — COMPLETE (1a6c5f2fe)

- **Precondition: G-586 rebase done.**
- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, style scope (minimal edits to 586-shared files)
- Rationale: three 586-shared skill-synthesis files; must be edited on top of 586's versions.
- Tasks: 2 | Depends on: Batch 3, G-586
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail) and `:typecheck`

### Task 10.1: Diagnostics status counts — COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/diagnostics.types.ts`, `.../diagnostics.service.ts` (+ `diagnostics.service.spec.ts`)
- Plan reference: implementation-plan.md:863-864
- Validation notes: R-e — edit 586's versions; append fields only.
- Implementation details: `SkillCandidateStatusCounts` gains `active`, `dormant`, `merged`, `retired`; `readStats`
  maps with zero fallbacks.

### Task 10.2: Pool default literal — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`
- Plan reference: implementation-plan.md:843-849
- Implementation details: `SETTINGS_DEFAULTS.suggestionMaxCandidates` 200 → 1000 only; do not touch `recentEvents`.

### Batch 10 verification

- Rebased on 586; only the named lines changed in shared files; tests pass; reviewer accepted

### Batch 10 on-disk verification (team-leader)

- 586 untouched: `git diff origin/main` on the five Batch 10 files equals the working-tree diff (47+/4-);
  no branch commit touches them (`git log origin/main..HEAD` on them is empty). Only appended fields,
  the readStats mapping/catch, and the `:155` literal changed; `recentEvents` untouched.
- 10.1: `diagnostics.types.ts:53-60` appends active/dormant/merged/retired (readonly number);
  `diagnostics.service.ts:55-58` maps them; catch `:65-74` returns all eight as 0; spec types
  `makeStore` as `SkillCandidateStats`, asserts distinct values (4/1/2/6) and the throw -> zeros path.
- Deviation (no per-field `?? 0` in readStats) ACCEPTED: `SkillCandidateStats` fields are required
  `number` (`types.ts:351-365`, committed), and the producer already coalesces
  (`skill-candidate.store.ts:1668-1671` `c?.x ?? 0`), so a second fallback would be dead code.
- 10.2: `skill-synthesis.service.ts:155` 200 -> 1000, spec `:1022` pins it; agrees with
  `file-settings-keys.ts:535` (1000) and schema max 5000 (`skills-synthesis-rpc.schema.ts:91`).
  Other `200` literals in spec fixtures are explicit test settings, not defaults.
- Consumers: `index.ts:430` re-export only; rpc-handlers spec `byStatus` fixtures are untyped 4-field
  literals; handler wiring is Batch 11.
- Re-run: diagnostics.service.spec 4/4, skill-synthesis.service.spec 54/54 (executor's 79 included
  the `.enqueue` sibling via pattern match); skill-synthesis:typecheck and rpc-handlers:typecheck
  pass. A full-project run showed spec-harvester (58.7 s) and reachability.integration failing under
  load; both pass in isolation (18/18) and neither touches Batch 10 files - flake, not a regression.
- Not committed (awaiting antigravity style verdict; Batch 8 files unstaged and not owned here).

### Batch 10 review verdict

- Style (antigravity CLI lane): APPROVED 9/10, no findings (`code-style-review.md` `## Batch 10`).
- Team-leader Mode 2: VERIFIED. Pre-commit re-check: diagnostics.service.spec + skill-synthesis.service.spec
  58/58, `@ptah-extension/skill-synthesis:typecheck` pass.
- Committed as 1a6c5f2fe with exactly the five Batch 10 files; Batch 9 files left unstaged.

## Batch 11: Shared DTO and RPC handler wiring (post-586) — COMPLETE (commit 2c1c8840b)

- **Precondition: G-586 rebase done.**
- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (antigravity)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope
- Rationale: two libs (shared, rpc-handlers), both 586-shared; minimal-edit rules.
- Tasks: 2 | Depends on: Batches 3, 10
- Verification command: `npx nx run @ptah-extension/rpc-handlers:test --testFile=skills-synthesis-rpc` (tail) and
  `npx nx run @ptah-extension/shared:typecheck`

### Task 11.1: Append lifecycle fields to SkillDiagnosticsResult — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`
- Plan reference: implementation-plan.md:865-866, 877-878
- Implementation details: append `readonly totalMerged`, `totalRetired`, `totalDormant: number`; nothing else.
  Not `rpc.types.ts`.

### Task 11.2: RPC handler bodies — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (+ `.spec.ts`)
- Depends on: Task 11.1
- Plan reference: implementation-plan.md:867-887
- Validation notes: R-c — `skillSynthesis:invocations` uses `store.listInvocationEvents`. Edit only the three method
  bodies; do not touch 586's `recentEvents` mapping. No new RPC method, no `ALLOWED_METHOD_PREFIXES` change.
- Implementation details: stats → `activeSkills = s.active`, `totalInvocations = s.invocations`; diagnostics → same
  plus the three new fields after `activeSkills`. Spec: mapping, resident-only active, events-based invocations.

### Batch 11 verification

- Fields appended; handler bodies moved; rpc-handlers tests pass; reviewer accepted

### Batch 11 on-disk verification (team-leader)

- `rpc-curator-diagnostics.types.ts:259-261`: `totalMerged`, `totalRetired`, `totalDormant` (readonly number)
  appended to `SkillDiagnosticsResult`; nothing else in `libs/shared` changed. `git diff HEAD --name-only` shows no
  `rpc.types.ts`, MESSAGE_TYPES, payload-map or session-chat handler edit, and no new RPC method.
- `skills-synthesis-rpc.handlers.ts:496` `store.listInvocationEvents(skillId, limit)` (store method at
  `skill-candidate.store.ts:1579`, same `SkillInvocationRow` shape, so `toInvocation` unchanged); `:517` stats
  `activeSkills: s.active`; `:709-712` diagnostics `activeSkills: stats.active` + `totalMerged/Retired/Dormant` from
  `getStats()`. `recentEvents` mapping untouched.
- Spec: diagnostics mapping (`handlers.spec.ts:344`), resident-only active + event-based invocations (`:537`),
  events read by candidate id with default limit 200 and no call without a skillId (`:563`, `:614`).
- Fixture fix-up ACCEPTED (orchestrator decision): the new required fields broke spec compilation of 4 frontend
  fixtures and 2 rpc-handlers `getStats` mocks; fixing them here keeps this commit green (additive-first rule).
  Each edit is +3/+4 zero-valued fields, no assertion change.
- `skill-diagnostics-state.service.spec.ts:36,39` fixture has `activeSkills: 3 > totalPromoted: 2`, which breaks the
  new invariant `active + dormant = promoted`. No assertion reads `activeSkills` (pass-through only), so it is not a
  Batch 11 defect. Carried to Batch 14 (which owns the counters and their specs): make it consistent, e.g.
  `activeSkills: 2`.
- `purgeSkippedReason` (Batch 8 carry): no shared type mirrors it (grep: only `skill-synthesis` files), so no Batch 11
  DTO change is needed; the carry closes with Batch 9's curator report.
- `listInvocations` now has no production caller; Batch 12.3 deletes it.
- Re-run by team-leader (`--skip-nx-cache`): typecheck shared + rpc-handlers + skill-synthesis-ui success;
  `rpc-handlers:test --testFile=skills-synthesis-rpc` 5 suites, 523/523, exit 0; degradation audit exit 0.
- Batch 9 files (`skill-curator.service*`, `gates/cluster-holdout-end-to-end.spec.ts`, `skill-suggestion.store*`,
  `di/register.spec.ts`) are in the working tree and are NOT Batch 11; do not stage them with this batch.

### Batch 11 review verdict

- Reviewer: antigravity CLI lane, logic scope (cross-side; the batch was authored by an in-process sub-agent).
  Verdict APPROVED, 9/10, 0 findings (`code-logic-review.md` `## Batch 11`, `:1172`, assessment `:1179`).
- Fixture decision: the frontend and rpc-handlers fixture edits are part of this batch, so the commit stays green
  (additive-first rule); accepted.
- Committed `2c1c8840b` with the 9 Batch 11 files only; no Batch 9 file was staged.
- Carry to Batch 14: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.spec.ts:39`
  `activeSkills: 3` -> `2` (the snapshot fixture at `:32-42`), so that `active + dormant = promoted` holds against
  `totalPromoted: 2`.
- Carry to Batch 12 (Task 12.3): delete `SkillCandidateStore.listInvocations` (`skill-candidate.store.ts:1562`);
  it has no production caller after this batch.

## Batch 12: Remove superseded paths — COMPLETE (commit 9a16da40f)

- Recommended executor: backend-developer sub-agent (uses `ptah_lsp_references` before each deletion)
- Fallback executor: CLI lane x 1 (antigravity) with grep-based reference checks
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, style scope (dead code, barrel exports)
- Rationale: deletion-only batch after every caller has moved; touches the 586-shared barrel, so post-rebase.
- Tasks: 4 | Depends on: Batches 9, 11
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail), `:typecheck`, `:lint` (confirm
  `skill-candidate.store.ts` max-lines did not grow beyond the R-h target)

### Task 12.1: Delete old clustering and synthesizer paths — COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts` (+ spec), `.../skill-synthesizer.service.ts` (+ spec)
- Implementation details: delete `clusterCandidates`, `synthesizeFromCluster`, `buildClusterPrompt` and their spec cases.

### Task 12.2: Delete old suggestion-store methods — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts` (+ spec)
- Implementation details: delete `insertPending`, `hasExistingForCluster`; update the doc comments that cite
  `insertPending` in `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.ts:17,760` and its spec's assertion name to `insert`.

### Task 12.3: Delete listInvocations from the candidate store — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- Implementation details: delete `listInvocations` and `toInvocationRow` if unused; remove the stale
  `listActiveOrderedByActivity` mock key at `SS/skill-promotion.service.spec.ts:103`. Report final line delta (R-h).

### Task 12.4: Barrel exports — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/index.ts`
- Implementation details: `ClusterMemberInput` → `UmbrellaMemberInput` (`:138-139`); `SkillCandidateCluster` →
  new partition result type or drop (`:143-144`); curator type exports per Batch 9. Verify external consumers with
  `ptah_lsp_references`. Leave `SkillSynthesisCuratorOverlap` in `rpc.types.ts` untouched (no-touch file).

### Batch 12 verification

- No reference to any deleted symbol remains (grep evidence); tests, typecheck, lint pass; reviewer accepted

### Batch 12 on-disk verification and commit (team-leader)

- Deleted symbols: `git grep -nw` over `libs`/`apps` finds 0 references to `clusterCandidates`,
  `SkillCandidateCluster`, `ClusterMemberInput`, `synthesizeFromCluster`, `buildClusterPrompt`, `insertPending`,
  `hasExistingForCluster`, `listInvocations`, `RawInvocationRow`, `listActiveOrderedByActivity`. The only
  `toInvocationRow` left is `skill-scorecard.service.ts:217`, its own private mapper over `GradedInvocationRow`.
  `linkPromotedCandidate` is kept (`skill-curator.service.ts:632`, plus its specs).
- Barrel (`src/index.ts`): `ClusterMemberInput` → `UmbrellaMemberInput`; `SkillCandidateCluster` → `PoolExclusions`,
  `PoolMember`, `PoolPartition`; `CuratorPassStats` added. `rpc.types.ts` is untouched. The rpc-handlers change is 2
  removed mock keys in `skills-synthesis-rpc.handlers.spec.ts`.
- Batch 9 carry closed: `tools/degradation-audit/baseline.json` skill-synthesis 6 → 5; audit exit 0 (`5 ok (baseline 5)`).
- R-h: executor reports `skill-candidate.store.ts` 1302 → 1272 ESLint lines (target met; no row-mappers split). The
  reviewer confirmed it.
- Re-run by team-leader (`--skip-nx-cache`): typecheck for skill-synthesis and rpc-handlers both pass. skill-synthesis
  lint shows 0 errors / 27 warnings, unchanged. skill-synthesis test: 85 suites passed + 1 skipped, 1793 passed /
  1 skipped / 0 failed. `rpc-handlers:test --testFile=skills-synthesis-rpc`: 5 suites, 523/523.
- Full rpc-handlers failures, judged environmental, not Batch 12:
  - `skills-sh-legacy-adoption.spec` is a load timeout and passes alone.
  - `harness/selection/harness-skill-selection-rpc.service.spec.ts:113` ("never writes state.json") also fails alone.
    A stray `%TEMP%\.ptah\harness\state.json` (mtime 2026-10-02 03:35) breaks it: the spec makes its workspace under
    `tmpdir()`, and `resolveHarnessWorkspaceRoot` walks up to that ancestor `.ptah`. The spec imports only
    vscode-core, harness-sync, platform-core and shared, with no skill-synthesis code. Batch 12's whole rpc-handlers
    diff against 7998b9ce3 is 2 mock-key lines in another spec, so the spec fails the same way on the parent commit.
    The temp dir was not deleted.
- Review: in-process code-style-reviewer APPROVED 9/10 (`code-style-review.md` `## Batch 12`, verdict on disk), with
  3 MINOR findings and nothing blocking. This follows the same user decision as Batch 9: an antigravity lane
  re-reviews 9a16da40f before the PR.
- Committed as 9a16da40f with exactly the 13 Batch 12 files (11 skill-synthesis, 1 rpc-handlers spec,
  `baseline.json`). The pre-commit lint-staged/prettier hook reformatted the 3 prettier-flagged files (commit shows
  +99/-410 against the +102/-410 working diff), with no behaviour change. Not staged: `context.md`,
  `visual/batch-14/_work/`.

### Batch 12 carries

- M1: rename `CLUSTER_MEMBER_MAX_CHARS` to `UMBRELLA_MEMBER_MAX_CHARS` in `skill-synthesizer.service.ts`; its only
  remaining user is the umbrella prompt.
- M2: the gap-curator source scan now pins `'.insert('`, which is looser than the old `insertPending` scan. The doc
  comments (`digest/skill-gap-curator.service.ts:17,760`) could name `SkillSuggestionStore.insert` explicitly.
- M3: the new barrel types (`UmbrellaMemberInput`, `PoolExclusions`, `PoolMember`, `PoolPartition`,
  `CuratorPassStats`) have no external consumer yet. This matches the barrel's existing pattern; no action unless
  the barrel is trimmed.
- These go to the antigravity pre-PR re-review / `future-enhancements.md` at Mode 3, together with the Batch 9 carries.

## Batch 13: Lifecycle reachability integration spec — COMPLETE (commit eb7693b19)

- Recommended executor: backend-developer sub-agent
- Fallback executor: senior-tester sub-agent
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane, logic scope (does each proof fail when the production call is removed)
- Rationale: one production-DI integration spec covering acceptance 2, 4 and 5.
- Tasks: 1 | Depends on: Batches 9-12
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test --testFile=skill-lifecycle.reachability` (tail)

### Task 13.1: Reachability spec — COMPLETE

- Files: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts`; optional helper in `.../skill-synthesis.reachability.test-support.ts` (`seedVecTable`)
- Plan reference: implementation-plan.md:932-978
- Pattern to follow: `SS/skill-synthesis.reachability.integration.spec.ts:57-245`
- Validation notes: A4 (suffixed slug counted, base slug not); each of the four proofs runs through a production
  entry (`synthesis.start()`, the 1 h `setInterval`, `acceptSuggestion`, the weekly drain). Executor states, per
  proof, which production call removal makes it fail (ideally demonstrated once by temporarily commenting the call
  and reverting).

### Batch 13 verification

- Spec exists and passes; reviewer confirms each proof is load-bearing

### Batch 13 on-disk verification, review and commit (team-leader)

- The only change is the new `SS/skill-lifecycle.reachability.integration.spec.ts` (649 lines). There is no
  production change and `skill-synthesis.reachability.test-support.ts` is untouched.
- Review (same user decision: in-process now, antigravity lane before the PR): code-logic-reviewer APPROVED 8/10
  (`code-logic-review.md` `## Batch 13`). The reviewer mutated each production call one at a time and restored it
  from a backup afterwards. `git diff -- libs/` was empty after the review.
  - Proof 1 fails without `startReconciliation`.
  - Proof 2 fails without `runPurge`, without `runRetirementStep`, and without `runUmbrellaStep`. It fires the real
    `setInterval` through fake timers.
  - Proof 3 fails when the row is named by its base slug (`skill-promotion.service.ts:576,588`).
  - Proof 4 fails when `rejectIfStatus` is short-circuited (`stage-handlers.service.ts:578`).
- Deviation (a), `openAndMigrate` called before `start()`: ACCEPTED. `start()` opens only when the connection is not
  already open (`skill-synthesis.service.ts:351`), and `openAndMigrate` is idempotent, so the pre-call runs the real
  migration runner and proof 1 depends only on the later `startReconciliation`. In real use, `start()` still runs
  the production migrate path. Deviation (b), the proof 4 candidate created inside proof 4: ACCEPTED, because proof 2
  consumes the earlier rows.
- Team-leader re-run: my first run overlapped the reviewer's temporary mutations and its results were discarded.
  The clean re-run was done with `git diff -- libs` empty before and after:
  - new spec: 4/4;
  - full `skill-synthesis:test --skip-nx-cache`: 85 suites passed + 1 skipped; 1796 tests passed, 1 skipped,
    1 failed;
  - the 1 failure was `cleanup/skill-backlog-cleanup.integration.spec`, the known load flake (106.9 s), which passes
    alone (2/2, 28.8 s);
  - typecheck passes; lint 0 errors / 27 warnings, none in the new spec; degradation audit exit 0 (`5 ok (baseline 5)`).
- Committed as eb7693b19 (1 file).

### Batch 13 carries

- MODERATE 1: the proofs depend on running in order. Proof 3 needs proof 2's `umbrellaId`, and proof 4 needs the
  stage handlers that proof 1 registers through `start()`. Running with `-t` or `--randomize` breaks them. Move the
  shared setup into `beforeAll` or document the order.
- MODERATE 2: proof 4 has no positive control (spec `:609-648`). Add a candidate that scores at or above the floor
  and survives.
- MODERATE 3: proof 2 waits on the log string `'[skill-curator] report written'` (spec `:222-225`, `:500`). If the
  message is renamed, the failure shows up as a misleading timeout.
- MINOR: the `settle` return value is unchecked (`:477`). `describe.skip` on a missing sqlite factory (`:97-98`)
  silently skips all four proofs. The `beforeAll` cost is about 112 s against a 30 s per-test timeout under CI load.

## Mode 3 completion checks (team-leader, 2026-10-02)

- Every batch and all 44 tasks are COMPLETE, and every batch carries a commit SHA.
  - Batches 1-4 were rewritten by the pre-Batch-5 rebase. Their current SHAs are a8d25b538, 3bd24475f, 69ed95213
    and bbd02ebf8, noted in each header. The original SHAs are no longer ancestors of HEAD.
  - Every other SHA is an ancestor of HEAD (`git merge-base --is-ancestor`).
  - All 80 files changed in `libs`/`tools`/`apps` since the merge base exist on disk.
- Parity: the curator was rebuilt, but no user-facing surface was replaced.
  - Compared against the merge base a4a3f8212: the `SkillCuratorService` public API (`start`, `stop`, `runManual`,
    `acceptSuggestion`, `dismissSuggestion`, `listSuggestions`) is identical. The `skillSynthesis:*` RPC method set is
    identical. `rpc.types.ts` is unchanged. `CuratorReport` keeps its 4 fields and adds `lifecycle`.
  - Removed internal behaviours: `runSuggestionPass` was replaced by the umbrella pass. The report-only LLM overlap
    review was removed; its `overlaps` were already omitted by the RPC. Both removals are in implementation-plan.md
    Revision 1 (`:106`, `:182-183`, `:227`, rule tag `:1108`), which the user approved at Gate 2 (context.md:100-102).
  - No `parity-inventory.md` is required for this backend rebuild behind an unchanged surface.
- Rendered visual evidence (Batch 14, a UI change that adds no surface and so needs no prototype): `visual-review.md`
  APPROVED, with 24 before/after PNGs in `visual/batch-14/` (dark `anubis` and light `anubis-light`, 320/400/1280).
  The "before" screenshots come from `HEAD` before Batch 14.
- Write-path trace: Batch 2's trace is recorded above.
  - `skillSynthesis.retirement.dormantAfterDays` and `retireAfterDormantDays` are registered at
    `file-settings-keys.ts:245-246,536-537` and read at runtime in `lifecycle/skill-retirement.service.ts:44-46`.
  - The `suggestionMaxCandidates` default of 1000 agrees between `file-settings-keys.ts:535` and
    `skill-synthesis.service.ts:155` (Batch 10).
  - Migration 0051 writes are exactly-once through the runner (Batch 1).
- Antigravity lane (pre-PR, cross-side): `lane-review-batches-9-12-14.md` APPROVED 678db0b17, 9a16da40f and
  4659e2e33, each with 1 MINOR. Batch 13 (eb7693b19) is not yet lane-reviewed.
- Carries are consolidated in `future-enhancements.md`.

## Batch 14: Frontend counters and post-accept refresh (post-586) — COMPLETE (commit 4659e2e33)

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

### Task 14.1: Diagnostics state fields — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts` (+ spec)
- Plan reference: implementation-plan.md:898-902
- Implementation details: `SkillByStatusCounts` + `totalMerged`, `totalRetired`, `totalDormant`; default zeros;
  three `?? 0` lines in `applySnapshot`. Nothing else.

### Task 14.2: Pipeline status cells — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts` (+ spec)
- Depends on: Task 14.1
- Plan reference: implementation-plan.md:903-911
- Validation notes: A5 — read 586's version first. Do not touch the (removed) accordion. Edit
  `skill-synthesis-tab.component.ts` only if 586 binds by-status fields individually, and list that edit in the report.
- Implementation details: Merged, Retired, Dormant cells using the existing label/value markup inside the
  `aria-label` section; OnPush, signal inputs.

### Task 14.3: Refresh stats after accept — COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts` (+ spec)
- Plan reference: implementation-plan.md:912-913
- Implementation details: `await this.loadStats()` after `refreshSuggestions()` in `accept` (`:433-445`); spec
  asserts the stats call.

### Batch 14 verification

- Three files edited on 586's versions; UI tests and lint pass; logic/style reviewer and visual-reviewer accepted
  with dark + light before/after screenshots

### Batch 14 on-disk verification (team-leader, 2026-10-02)

- The diff touches exactly the six batch files (three sources plus their specs). No `skill-synthesis-tab.component.ts`
  edit. No accordion touched. No new catch blocks.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/skill-synthesis-ui --skip-nx-cache`: all three targets
  succeeded. Degradation audit exit 0, `libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)`.
- visual-review.md `## Batch 14`: APPROVED. Its 3 minors go to future-enhancements.md.

### Batch 14 review record

- Reviewer decision (user, 2026-10-02): "In-process now, lane later". No CLI vendor has quota now. An in-process
  code-style-reviewer, covering both logic and style, is this batch's review gate. An antigravity CLI lane re-reviews
  the same commits before the PR, and its findings land as fix-up commits.
- In-process review (code-style-review.md `## Batch 14`): **NEEDS_REVISION**. There are no blockers.
  - MODERATE 1: `skill-synthesis-state.service.ts:444` / `skill-pipeline-status.component.ts:203`. Accept refreshes
    `SkillSynthesisStateService.stats` (the stats strip). The pipeline cells read `SkillDiagnosticsStateService.byStatus`,
    which refreshes only on tab open, on manual Refresh, or on the 30 s poll. So the Promoted, Merged, Retired and
    Dormant cells lag after accept. Fix: after a successful accept, also refresh the diagnostics service. The
    tab-level call is in `skill-synthesis-tab.component.ts`, which needs a scope extension listed in the report.
    Add a spec for it.
  - MODERATE 2: `skill-synthesis-state.service.spec.ts` (accept block): add a spec for "accept succeeds, then stats
    rejects".
  - MINOR 1: `skill-diagnostics-state.service.spec.ts:39`. The fixture's `activeSkills` changed from 3 to 2 with no
    stated reason. Revert it or justify it.
  - MINOR 2 and 3 (shared error-string comment; an optional `@for` for the cells) are carries for future-enhancements.md.
- Round 1 left the batch IN_PROGRESS. No commit was made until an APPROVED verdict was on disk.
- Revision 1 (executor, 2026-10-02):
  - `SkillSynthesisStateService.accept()` returns `Promise<boolean>`. Its catch carries a
    `degradation-audit: reported` marker.
  - `components/suggestions/skill-suggestions-view.component.ts` (+ spec), the only caller of accept, calls
    `void diagnostics.refresh()` on success. This extends the batch from 6 to 8 files; the tab component is untouched.
  - A failed accept now shows an error toast instead of the success toast, and the review modal stays open so the
    user can retry. The orchestrator accepted this.
  - New spec: the accept succeeds, then the stats read fails.
  - The `activeSkills: 2` fixture is kept, with a comment justifying it.
- Team-leader re-verification:
  - `npx nx run-many -t test,lint,typecheck -p @ptah-extension/skill-synthesis-ui --skip-nx-cache`: all three
    succeeded.
  - Degradation audit exit 0, `skill-synthesis-ui: 5 ok (baseline 5)`.
- In-process re-review (code-style-review.md `### Batch 14 re-review (revision 1)`): **APPROVED**. All three prior
  findings are resolved. 4 minors are not gating.
- Committed as 4659e2e33 (8 files, explicit paths). The antigravity lane re-reviews this commit before the PR, and
  its findings land as fix-up commits.

### Batch 14 carries (future-enhancements.md does not exist yet; listed here for the modernization pass)

- Visual review `## Batch 14`: the 3 minors recorded in visual-review.md.
- R1 MINOR 2: a stats-only failure after a successful accept shows the same shared `error` string as an accept
  failure (`skill-synthesis-state.service.ts` accept). Add a comment or a separate signal.
- R1 MINOR 3: the five near-identical count cells in `skill-pipeline-status.component.ts` could become an `@for`.
- R2 M1: `skill-diagnostics-state.service.spec.ts:39`. The comment cites "Batch 11 (2c1c8840b)". State only the
  invariant (active <= promoted).
- R2 M2: `skill-diagnostics-state.service.ts:139`. `refresh()` has no last-request-wins guard, so an older
  in-flight snapshot can overwrite newer counts. This predates the batch; accept adds one more caller.
- R2 M4: each accept makes two stats-shaped reads (`loadStats` for the stats strip, diagnostics `refresh` for the
  pipeline card). A one-line comment should say why both stay.

## Batch 15: Adopt legacy accepted suggestions (QA follow-up) — COMPLETE (commit 9978b040e)

- Origin: QA on a copy of the live data (`test-report.md`). The startup reconcile adopted 0 of 2 legacy accepted
  suggestions: `{"adopted":0,"missing":1,"ambiguous":0,"blockedByCandidateRow":1,"failed":0}`. This leaves Scope 3 /
  A1 unmet. User decision: "Fix before PR".
- Recommended executor: backend-developer sub-agent (in-process; already ran)
- Fallback executor: none (needs design judgement on the revive path)
- Execution mode: sequential
- Reviewer (cross-side): antigravity CLI lane (`lane-review-batch-15.md`), plus an in-process code-logic-reviewer
  focused on stale columns of a revived row
- Tasks: 2 | Depends on: Batches 6, 9, 12, 13
- Verification command: `npx nx run @ptah-extension/skill-synthesis:test` (tail), `:typecheck`, `:lint`; degradation
  audit

### Task 15.1: Revive a rejected slug holder in place — COMPLETE

- Files: `SS/skill-curator.service.ts` (+ spec), `SS/skill-promotion.service.ts`, `SS/skill-candidate.store.ts`, new
  `SS/skill-candidate.row-mappers.ts` (pure move that keeps the store under its R-h budget)
- Details: a slug held by a `rejected` candidate row is re-promoted in place through `promoteAtomically` with
  `fromStatus: 'rejected'`. A guarded `UPDATE ... WHERE status = 'rejected'` throws when `changes !== 1`, which rolls
  the adopt back. R-f / R-f2 apply. Any other non-promoted holder stays blocked.

### Task 15.2: Adopt a diverged registry row — COMPLETE

- Files: `SS/lifecycle/adoptable-slug.ts` (+ spec)
- Details: a `diverged` registry row with no `originPluginId` and an existing `<activeRoot>/<slug>/SKILL.md` is
  adopted without the body check, and the registry row stays `diverged`. A plugin-owned row is never adopted.
  Retirement keeps leaving diverged skills alone.

### Batch 15 verification

- Both live shapes from test-report.md are adopted in specs; tests, typecheck, lint and audit pass; both reviewers
  accept

### Batch 15 on-disk verification, review and commit (team-leader)

- Files (8, all under `SS/`):
  - `lifecycle/adoptable-slug.ts` (+ spec);
  - `skill-candidate.store.ts` (+ spec), now 1231 lines;
  - new `skill-candidate.row-mappers.ts`, a pure move of `RawCandidateRow`/`toCandidateRow`/`toJudgeStatus` with the
    logger passed in;
  - `skill-curator.service.ts` (+ spec), 688 effective lines;
  - `skill-promotion.service.ts`, 720 lines, still its one pre-existing max-lines warning.
  - There is no change outside `libs/backend/skill-synthesis`.
- Design as committed:
  - `slugHolderDecision` returns one of four paths. `new-row` and `link-promoted` are unchanged. `repromote-rejected`
    covers a rejected holder that is not `merged-into:*` or `retired:*`. `blocked` covers a live candidate, a merged
    holder or a retired holder.
  - The revive goes through `promoteAtomically({ fromStatus: 'rejected' })`, a compare-and-set that throws on
    `changes !== 1`. `resetRevivedContent` then runs inside the same `inImmediateTransaction`, guarded on
    `status = 'promoted'`. It writes the description, the source sessions and a fresh embedding (a new vec row, or
    NULL without vec), and NULLs `display_name`, `workspace_root` and the judge/replay/trigger columns.
  - A `diverged` registry row with no `originPluginId` plus an existing SKILL.md is adopted without the body check.
    The row stays `diverged`, so retirement and the curator's exempt set still protect it.
  - `listPromotedLastUse` is now MAX(last event, `promoted_at`), falling back to `created_at`. A revived or freshly
    promoted row gets N days of grace; a long-promoted row with no events still goes dormant at N and retires at N+M.
- Review. The antigravity lane hit a quota 429 and wrote no file, so the user's standing "in-process now, lane later"
  rule applies:
  - in-process code-logic-reviewer: APPROVED 7/10 (`code-logic-review.md` `## Batch 15`), with M1-M4 and minor
    findings;
  - the orchestrator routed M1 (old embedding), M2 (idle clock and `retired:*` holders) and M3 (stale
    description/display name/judge/`workspace_root`) back to the executor before the commit;
  - re-review of the delta: APPROVED 8/10 (`## Batch 15 re-review`), with no blocking, serious or moderate findings
    and minors m5-m7. The M2 grace period was ruled a faithful reading of context.md Scope 4. Reachability proof 2
    (dormant at 45 days, retired at 100) still holds.
  - R-f and R-f2 hold: `insertEmbedding` and `resetRevivedContent` are plain statements with no catch inside the
    callback.
- Team-leader re-run after the fixes (`--skip-nx-cache`):
  - skill-synthesis test: 86 suites passed + 1 skipped; 1828 tests passed, 1 skipped, 0 failed;
  - typecheck passes;
  - lint 0 errors / 27 warnings, unchanged;
  - degradation audit exit 0 (`5 ok (baseline 5)`).
- Committed as 9978b040e (8 files).
- **Pending: the antigravity lane review of 9978b040e (quota reset).** The orchestrator resumes the lane on this
  commit, and its findings land as fix-up commits.
- Carries go to `future-enhancements.md`: items 32-37 (M4, m3, m4, m1/m6, m7, and the row-mapper silent catch) and
  the Batch 13 lane minors (items 38-40). Item 6 was updated: both live shapes are now adoptable.
- Next: the orchestrator re-runs QA on the live data copy, expecting the reconcile to adopt 2 of 2.
