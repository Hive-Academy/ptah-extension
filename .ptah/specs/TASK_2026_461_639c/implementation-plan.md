# Implementation Plan - TASK_2026_461_639c

Phase 3 of the Thoth rework (umbrella TASK_2026_439_1310): skills unblock.

All paths are relative to the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock` (branch
`feat/task-439-phase3-skills-unblock`, based on `origin/main` 97239e814) unless absolute. Every `file:line`
below was opened in this worktree. No build, test or database was run: this worktree has no `node_modules`,
and the plan is read-only analysis.

## Inputs and constraints

- Requirements used: `context.md` (user rules), `../TASK_2026_439_1310/HANDOFF.md` (8 working rules and the
  reachability rule), `../TASK_2026_439_1310/tribunal/verdict.md` section B "Now" (requirements source),
  `tribunal/brief.md` (live-DB numbers), `../TASK_2026_443_40ec/implementation-plan.md` (shape only),
  root `CLAUDE.md`, `libs/backend/skill-synthesis/CLAUDE.md`.
- No `task-description.md`: the verdict is the approved requirements source.
- Corrections applied: none.
- Design handoff used: none. No UI work is planned, except the removal of two dead settings fields if the user
  picks D2 option (a).
- Missing decision-critical input: the verdict does not say HOW "eligible twice across contexts ends
  `promoted`" is reached once the fake invocation is gone. That is D1. The plan is written with the
  recommended option of every decision.

### Live-DB facts this plan relies on (from `brief.md`, not re-measured)

| Fact | Value |
| --- | --- |
| `skill_candidates` | 2,426 `candidate`, 6 `rejected`, 0 `promoted` |
| `skill_invocations` | 2,432 rows, all `succeeded=1` (one per candidate ever created) |
| `skill_session_verdicts` | 136 rows, 56 degraded |
| Queued backlog | prefilter 423, judge-panel 133, trigger-eval 135, archaeology 102 |

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Manual promote calls the automatic `evaluate` | `skill-synthesis.service.ts:1213-1223` (`promote`), `:1268` (`promoteBulk`) | Both manual entry points hit the frequency threshold |
| The only RPC callers of those two methods | `rpc-handlers/.../skills-synthesis-rpc.handlers.ts:453` (`skillSynthesis:promote`), `:1688` (`promoteBulk`) | The method names can stay. The RPC layer needs no change for item A |
| No other backend caller of `SkillSynthesisService.promote` | grep of `libs`, `apps` for `.promote(` / `.promoteBulk(` (CLI `apps/ptah-cli/src/cli/commands/skill-synthesis.ts:185` and TUI `SkillsPanel.tsx:125` go through the RPC) | Changing `promote` changes exactly the user-initiated path |
| Gate order in `evaluate` | `skill-promotion.service.ts:185-194` status guards, `:196-210` active-embedding dedup, `:211-218` frequency threshold (`below-threshold`), `:219-227` cluster dedup, `:229-233` judge, `:236-237` replay, `:239-280` residency cap, `:281-301` SKILL.md write, `:303-306` status write, `:313` repropagation | The threshold is one isolated step. Everything else is shared |
| A failed SKILL.md write still promotes | `skill-promotion.service.ts:293-301` (warn, keep `candidate.bodyPath`), then `:303` | Today there is NO write check. See D3 |
| Judge verdict is schema-enforced by the store | `skill-promotion.service.ts:495-500` → `SkillCandidateStore.recordJudgeVerdict`; `skill-synthesis/CLAUDE.md:69` | "Schema check" = this store gate (Assumption on wording, see Component 1) |
| `evaluate`'s only other caller is the tracker | `skill-invocation-tracker.ts:80`; tracker registered `di/register.ts:72,107`, no production caller (grep) | Automatic promotion has NO production path today, before or after this phase |
| Fake creation invocation | `skill-synthesis.service.ts:917-925` (`recordInvocation`, `succeeded: true`, `contextId`) | Writes a row. It does NOT touch `success_count` |
| `registerCandidate` inserts `success_count = 0` | `skill-candidate.store.ts:201-205` | Every live candidate has `success_count = 0` |
| Only `incrementSuccess` raises `success_count` | `skill-candidate.store.ts:861-870`, called only at `skill-invocation-tracker.ts:67` | The fake row never counted toward the threshold |
| The tracker writes invocations WITHOUT `contextId` | `skill-invocation-tracker.ts:59-65` | `context_id IS NOT NULL` identifies exactly the fake rows |
| `store.recordInvocation` writers | `skill-candidate.store.ts:929-960`; callers `skill-synthesis.service.ts:918`, `skill-invocation-tracker.ts:59` only | No third writer exists |
| Readers of `skill_invocations` | `countDistinctContexts` `skill-candidate.store.ts:918-927`; `listActiveOrderedByDecayScore` `:421-441` (promoted only); `listActiveOrderedByActivity` `:481-500` (promoted only); `listInvocations` `:1406-1415` → RPC `skillSynthesis:invocations` `skills-synthesis-rpc.handlers.ts:494`; `getStats` `:1449-1480` → RPC stats `:509`, `:699`, `diagnostics.service.ts:49` | The 2,432 fake rows show as "invocations" in stats and per-candidate lists |
| Generalization shortcut reads contexts | `skill-promotion.service.ts:211-215` (`countDistinctContexts >= generalizationContextThreshold` halves the threshold) | With the fake row gone, no writer sets `context_id`. The shortcut becomes unreachable (Risk R4) |
| Prefilter predicate | `skill-synthesis.service.ts:1182-1199`; depth-only branch `:1192-1194`; `MIN_ROLE_TURNS_FLOOR` guard `:1186-1188` | One boolean to delete |
| Prefilter caller | `skill-synthesis.service.ts:720-741` inside `analyzeSession`; only background caller is `stage-handlers.service.ts:266-292` | Rejection already maps to queue `skipped` "no candidate from this session" (`:279-284`) |
| Evidence fields on the trajectory | `trajectory-extractor.ts:76-104`; `EDIT_TOOL_NAMES` `:40`; `BASH_TEST_PATTERN` `:46-47`; counting `collectToolSignals` `:331-361` | Evidence is defined from `tool_use` blocks only (Component 3) |
| Trajectory hash normalizes the workspace root | `trajectory-extractor.ts:214-228`, `normalize` `:390-401` | Two identical transcripts in two workspaces hash the same (used by the proof) |
| Reuse on identical trajectory writes nothing | `skill-synthesis.service.ts:750-753` | Second identical session → `reused: true`, prefilter row `done` "reused existing candidate" (`stage-handlers.service.ts:286-291`) |
| Settings used only by the depth branch | `eligibilityMinTurns`, `prefilterMinChars`: `skill-synthesis.service.ts:134,139,1193-1194,1352-1355,1372-1375`; `types.ts:419,429`; `platform-core/src/file-settings-keys.ts:230,235,509,514`; `rpc-handlers/.../skills-synthesis-rpc.schema.ts:36,41`; `shared/src/lib/types/rpc.types.ts:2662,2667`; `skill-settings-panel.component.ts:161,202`; `skill-synthesis-tab.component.ts:794,799` | Dead after item C. See D2 |
| Specs that pin the depth branch | `skill-synthesis.service.spec.ts:535-577`; `prefilter-corpus-measurement.spec.ts:67,135-140,203` (opt-in) | Must be rewritten, not deleted silently |
| Namer never called | `naming/candidate-namer.service.ts:117-128`; registered `di/register.ts:99,206-208`; token `di/tokens.ts:133-134`; exported `src/index.ts:142-148`; grep finds no caller | Wire or delete (item E) |
| `display_name` never reaches the wire | grep of `rpc-handlers/src`, `shared/src`, `skill-synthesis-ui/src` finds no candidate `displayName` mapping; summary mapper `skills-synthesis-rpc.handlers.ts:2396-2401` | Wiring the namer writes a column the Skills tab never shows |
| `displayName` IS read internally | `digest/skill-gap-curator.service.ts:726,1039`; `gates/trigger-eval.service.ts:236,791`; row mapping `skill-candidate.store.ts:1590` | Keep the column and the row field. Only `setDisplayName` (`skill-candidate.store.ts:710-722`) loses its caller |
| The synthesizer already names non-boot candidates | `skill-synthesis.service.ts:782-794` (`synthesized.name`, `.description`) | The namer duplicates this for every LLM-drafted candidate |
| Queue `stage` has a CHECK list | `persistence-sqlite/.../0032_skill_synthesis_queue.ts:48-51` | A new queue stage needs a table rebuild. Cleanup must not be a queue stage |
| Gate stages do not check candidate status | `stage-handlers.service.ts:478-483` (`gateTarget`), used by judge-panel `:513-...` | 268 queued gate rows would spend tokens on rejected candidates |
| One-row state-table migration shape | `0043_memory_retention.ts:58-78` (`id INTEGER PRIMARY KEY CHECK (id = 1)`) | Reuse for the cleanup record |
| Migration "highest version" ratchet | `toBe(44)` in `0028`, `0030`, `0038`, `0039`, `0040`, `0041`, `0042`, `0043` migration specs (grep) | A new migration bumps each of them |
| Cron job seam for a skill-synthesis job | `thoth-runtime/src/lib/skill-drain-jobs.ts:39-64` (data table); `start-thoth-cron.ts:52-127`; `memory-retention-job.ts:37-80` (one job spec + handler factory); `start-thoth-cron.ts:266-300` registered at `:473`; CLI twin `cli-engine/src/lib/bootstrap/thoth-runtime.ts:528`, called `:330` | `skill-synthesis` must never import `cron-scheduler` (`skill-drain-jobs.ts:26-30`). The job lives in `thoth-runtime` + `cli-engine` |
| Boot catch-up can fire a cron slot at launch | `cron-scheduler/src/lib/catchup-coordinator.ts:1-20` | The service needs its own boot-deferral gate, like `memory-retention.service.ts:235-236` |
| Drain gate keys to reuse | `queue/skill-drain.service.ts:302-314` (`enabled`, `foregroundBackoffMs`, `bootDeferralMs`, `pauseOnBattery`) | The cleanup honours the same user switches |
| Verdict lookup | `archaeology/session-verdict.store.ts:195-200` (`findBySession`), `:208-211` (`hasUsableVerdict`) | Direct predicate for "has a verdict" |
| Queue row lookup by session | `queue/skill-queue.store.ts:671-681` (`findBySessionStage`) | Recovers `workspace_root` / `transcript_path` for a candidate whose `workspace_root` is NULL |
| Real SQLite opener with binding fallback | `queue/queue-db.test-support.ts:101-124` (`resolveOpener`) | Reuse. Both bindings per HANDOFF rule 3 |
| Real-lane test support | `lanes/lane-runner.test-support.ts:93,134,150,253,259` (`makeResolverStub`, `resolvedLane`, `makeQueryStub`, `resultMessage`, `assistantText`) | The fake LLM lane for the proof |
| Registration-order pin already exists | `skill-synthesis.stage-handlers.spec.ts:1-28` header; `skill-synthesis.service.ts:313` | The proof reuses this mutation |
| DI completeness spec | `di/register.spec.ts:26-35` | Token deletion (item E) keeps it green only if the token is also removed |

## Architecture decision

- **Chosen approach**: five small, contained changes inside `skill-synthesis`, one one-shot background job in
  the `thoth-runtime` / `cli-engine` seam, and one new real-SQLite integration spec that drives the production
  trigger → drain → prefilter → manual-promote path.
  1. **A**: split `SkillPromotionService` into two public entry points over one private gate pipeline.
     `evaluate` (automatic) keeps the threshold. `promoteManually` skips ONLY the threshold.
  2. **B**: delete the fake invocation write. The cleanup job deletes the 2,432 historical rows.
  3. **C**: delete the depth branch. Move the evidence rule into one exported pure predicate that the
     prefilter and the cleanup job share.
  4. **D**: a resumable, gated, batched cleanup job with a one-row state table (migration `0045`).
  5. **E**: delete `CandidateNamerService`.
  6. **F**: the reachability proof ends `promoted` through the manual path (D1).
- **Rationale**: every "Now" item in verdict B is a deletion or a narrowing, except the manual path and the
  cleanup. The evidence shows automatic promotion already has no production caller (tracker is dead), so phase
  3 cannot break it and must not invent it. Phase 5 owns "promote on real usage from
  `skill_invocation_events`".
- **Rejected alternatives**:
  - A boolean `bypassThreshold` parameter on public `evaluate`. Any caller (the tracker, a future job) can pass
    it, and a review cannot see which path is manual. Two named methods make the manual path greppable.
  - A new `ManualPromotionService`. It would copy seven gates and drift from `evaluate`.
  - Cleanup as a SQL migration. A migration cannot read transcripts, so it cannot decide "code evidence". It
    also runs on the boot path (TASK_2026_380/383).
  - Cleanup as a queue stage. `0032` has a CHECK on `stage` (`0032_skill_synthesis_queue.ts:48-51`); widening
    it is a table rebuild on a hot table.
  - Cleanup as an RPC only. Phase 3 has no UI for it, so the "one-time cleanup" would never run for a user who
    does not know the command.
  - Wiring the namer. See Component 5.
  - An automatic recurrence path for the proof. See D1.
- **Assumptions**: listed per component with the check that resolves each.
- **Effect on existing code**: `evaluate` keeps its signature and behaviour. `promote` / `promoteBulk` keep
  their signatures, and their behaviour changes to skip the threshold. Deleted: the fake invocation, the depth
  branch, `CandidateNamerService` and its token, export and spec, `SkillCandidateStore.setDisplayName`, and (D2)
  two settings keys end to end. Added: migration `0045`, a cleanup store + service, one cron job in two hosts,
  one integration spec.

## Component specifications

### 1. Manual promote path (item A)

- **Purpose**: let a user promote a candidate that has not met `successesToPromote`, with every other gate
  intact.
- **Responsibilities**:
  - `SkillPromotionService` gets one private method that runs the gate pipeline for a loaded candidate, given
    a mode `'automatic' | 'manual'`. The mode controls exactly one step: the threshold at
    `skill-promotion.service.ts:211-218`.
  - Public `evaluate(candidateId, settings, nowFn?, origin?)` → mode `automatic`. Signature and behaviour
    unchanged (`skill-invocation-tracker.ts:80` still compiles).
  - New public `promoteManually(candidateId, settings, origin, nowFn?)` → mode `manual`. `origin` is required,
    because only an RPC handler reaches this path and it always passes `userInitiated: true`
    (`skills-synthesis-rpc.handlers.ts:453-455`).
  - `SkillSynthesisService.promote` (`skill-synthesis.service.ts:1213-1223`) and `promoteBulk` (`:1268`) call
    `promoteManually`. Return type of `promote` changes from `ReturnType<SkillPromotionService['evaluate']>` to
    `Promise<PromotionDecision>` (same shape). Update both doc comments to say "manual path: frequency
    threshold not applied".
  - Gates kept on the manual path, in today's order: status guards (`:185-194`), active-embedding dedup
    (`:196-210`), cluster dedup (`:219-227`), judge gate with `recordJudgeVerdict` (`:229-233`, `:495-500`),
    replay floor (`:236-237`), residency cap (`:239-280`), SKILL.md write (`:281-301`, see D3), status write and
    repropagation (`:303-313`).
- **Verified contracts**: `PromotionDecision` `skill-promotion.service.ts:82-130`; `QueryOrigin` import `:16`;
  `SkillSynthesisPromoteBulkDecision` mapping `skill-synthesis.service.ts:1269-1274`.
- **Assumption**: the verdict's "schema check" means the judge-verdict store gate plus SKILL.md frontmatter
  rendering (`skill-md-generator.ts:234-255`). No other schema validation exists on this path (grep). If the
  user meant a Zod check on the candidate body, that is new work and needs a decision.
- **Dependencies**: unchanged. No new injection.
- **Integration points**: RPC `skillSynthesis:promote` and `promoteBulk` (unchanged code). CLI and TUI reach
  it through those RPCs.
- **Failure behaviour**: identical to `evaluate` for every non-threshold gate. `below-threshold` is
  unreachable from `promoteManually`. With D3 (a), a SKILL.md write failure returns `write-failed` and leaves
  the row `candidate`.
- **Degradation-audit impact**: none, unless D3 (a). Then the catch at `skill-promotion.service.ts:293-301`
  stops failing open and needs `// degradation-audit: reported - promotion refused; decision reason write-failed`
  inside its leading-comment zone. Run `npx nx run degradation-audit:lint` and confirm the `skill-synthesis`
  baseline.
- **Quality requirements**: no new LLM call. The manual path costs exactly what `evaluate` cost once past the
  threshold (one judge call on the `user-action` lane).
- **Verification seam**: unit specs in `skill-promotion.service.spec.ts`:
  - manual path promotes a `success_count = 0` candidate (judge scored ≥ `minJudgeScore`);
  - manual path still rejects: active duplicate → `duplicate`; judge below score → `below-judge-score`;
    judge unscored → `judge-unscored` (row stays `candidate`); replay below floor → `below-replay-confidence`;
    already `rejected` → `already-rejected`;
  - automatic `evaluate` on the same zero-count candidate still returns `below-threshold` and makes no judge
    call.
  - `skill-synthesis.service.spec.ts`: `promote` and `promoteBulk` call `promoteManually`, never `evaluate`.
  - Broader: Component 6 proof.
- **Files**:
  - MODIFY `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts`
  - MODIFY `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (`promote`, `promoteBulk` only)
  - MODIFY `libs/backend/skill-synthesis/src/lib/skill-promotion.service.spec.ts`
  - MODIFY `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.spec.ts`

### 2. Delete the creation-time fake invocation (item B)

- **Purpose**: stop writing telemetry nobody produced.
- **Responsibilities**:
  - Delete `skill-synthesis.service.ts:917-925` and the `contextId` hash at `:892-898` (its only use). Keep
    `workspaceRoot: workspaceRoot || null` at `:915`.
  - Fix the comment at `:908-914`, which cites `countDistinctContexts`.
  - Historical rows: deleted by the cleanup job (Component 4), with predicate `context_id IS NOT NULL`. That
    predicate is exact, because the tracker never passes `contextId` (`skill-invocation-tracker.ts:59-65`) and
    no third writer exists (`skill-candidate.store.ts:929` callers). See D6.
- **What the 2,432 rows affect today** (why deleting them is safe):
  - `success_count`: nothing. The fake row never incremented it (`skill-candidate.store.ts:861-870` has one
    caller, the tracker).
  - `countDistinctContexts`: every candidate reads 1. The shortcut needs ≥ 3 (`SETTINGS_DEFAULTS` `:136`).
    No candidate can reach it through fake rows, so no decision changes.
  - Decay and activity ordering: they read invocations of `promoted` rows only (`:425-427`, `:496`). Zero
    rows are promoted. After a manual promotion of an OLD candidate, its fake row would give it a false decay
    score in the residency demotion order. Deleting the rows removes that.
  - Stats and per-candidate lists: `getStats().invocations` and `skillSynthesis:invocations` show 2,432 fake
    uses. Deleting fixes the display.
- **Failure behaviour**: nothing new. Removing a write removes a failure point.
- **Degradation-audit impact**: none.
- **Verification seam**: `skill-synthesis.service.spec.ts` — a new candidate registration makes zero
  `store.recordInvocation` calls (today's mock at `:114-125` becomes unused; delete it). Proof asserts
  `SELECT COUNT(*) FROM skill_invocations` = 0 after the drain (Component 6, mutation M3).
- **Files**: MODIFY `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`, MODIFY
  `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.spec.ts`.

### 3. Evidence-only prefilter (item C)

- **Purpose**: spend tokens only on sessions that did work in the workspace.
- **Definition of evidence** (against `ExtractedTrajectory`, `trajectory-extractor.ts:76-104`). A session has
  work evidence when at least one of these is true:
  - **edit evidence**: `editCount >= settings.prefilterMinEdits` (default 1). `editCount` counts `tool_use`
    blocks named `Edit`, `Write` or `MultiEdit` (`:40`, `:353-354`).
  - **tool evidence**: `toolUseCount >= settings.prefilterMinToolUses` (default 2). `toolUseCount` counts every
    `tool_use` block in a user or assistant message (`:350-351`).
  - **test evidence**: `bashTestPassed === true`. Despite the name, this means a `Bash` `tool_use` whose
    command matched `BASH_TEST_PATTERN` (`:46-47`, `:355-357`). It says a test command RAN, not that it passed.
    Do not rename it in this phase (the extractor is phase 5 territory); document the meaning at the
    predicate.
  - The existing floor stays: `turnCount < MIN_ROLE_TURNS_FLOOR` → `tooThin` (`skill-synthesis.service.ts:1186-1188`).
- **Conversation-only session**: a transcript whose messages contain only `text` blocks has
  `editCount = 0`, `toolUseCount = 0`, `bashTestPassed = false` (all three counters start at 0,
  `:182-184`, and change only inside `collectToolSignals` on `tool_use`). Turn count and character length no
  longer matter. It fails with `reason: 'noWork'`, bucket `prefilterRejected`, queue row `skipped`
  "no candidate from this session", and no candidate, archaeology, judge-panel or trigger-eval row.
- **Responsibilities**:
  - CREATE `libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts`: one exported pure
    function, for example `hasSessionWorkEvidence(trajectory, thresholds): boolean`, where `thresholds` is
    `Pick<SkillSynthesisSettings, 'prefilterMinEdits' | 'prefilterMinToolUses'>`. It holds the doc comment
    that defines the three kinds of evidence. It must not name the tail-regex success field:
    `archaeology/regex-demotion.spec.ts` scans production file text. (Small file on purpose: it has two
    callers, the prefilter and the cleanup job, so it passes the nameability test.)
  - `passesPrefilter` (`skill-synthesis.service.ts:1182-1199`) keeps the floor check and calls the predicate.
    Delete `depthOk` and rewrite the doc block `:1144-1181` (it currently argues for the depth branch).
  - Fix the stale comments at `:530-533` and `:687-688` that say `eligibilityMinTurns` is applied in
    `passesPrefilter`.
  - D2 (a): delete `eligibilityMinTurns` and `prefilterMinChars` end to end (settings default `:134,139`,
    `readSettings` `:1352-1355,1372-1375`, `types.ts:419,429`, and the non-skill-synthesis files in
    Component 7).
- **Failure behaviour**: the predicate is pure and cannot throw on a valid trajectory.
- **Degradation-audit impact**: none.
- **Quality requirements**: fewer eligible sessions → fewer `prefilter` LLM drafts and fewer chained
  archaeology / judge-panel / trigger-eval rows. Measure it (Component 8), do not assume it.
- **Verification seam**:
  - REWRITE `skill-synthesis.service.spec.ts:535-577`: "rejects a long corrective conversation with no edits
    and no tools" (8 turns, 900 chars → `null`, `prefilterRejected` +1); keep "still rejects a session with
    nothing in it"; delete "rejects a long conversation that is all one-word turns" (the branch it guarded is
    gone); keep the short-tool-session acceptance at `:520-533`; add one acceptance each for edit-only and
    test-command-only.
  - CREATE `libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.spec.ts`: a table of the
    three signals, each alone true, all false, threshold edges.
  - MODIFY `prefilter-corpus-measurement.spec.ts` (opt-in harness): the "old" predicate becomes today's
    phase-2 predicate (with depth), the "new" one is the real `passesPrefilter`. Header text updated.
  - Proof: conversation-only session produces nothing (Component 6, mutation M2).
- **Files**:
  - CREATE `libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts`
  - CREATE `libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.spec.ts`
  - MODIFY `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`
  - MODIFY `libs/backend/skill-synthesis/src/lib/types.ts` (D2)
  - MODIFY `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.spec.ts`
  - MODIFY `libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts`

### 4. One-time backlog cleanup (item D)

- **Purpose**: reject the historical candidates that the phase 3 prefilter would never have accepted and that
  no archaeology verdict supports, with a visible reason and a durable report. Delete the fake invocation rows.
- **Mechanism**: a gated, resumable, batched **cron job** in the existing Thoth seam, backed by a one-row state
  table. Not a migration, not a queue stage, not RPC-only (rejected alternatives above).

#### 4a. Migration `0045_skill_backlog_cleanup`

- `CREATE TABLE IF NOT EXISTS skill_backlog_cleanup_state`, the `0043` one-row shape
  (`id INTEGER PRIMARY KEY CHECK (id = 1)`). Columns (all epoch ms or counters, counters
  `NOT NULL DEFAULT 0`, no CHECK on outcome text, same reason as `0043_memory_retention.ts:25-29`):
  `version`, `cutoff_created_at`, `cursor_created_at`, `cursor_id`, `started_at`, `finished_at`,
  `last_run_at`, `last_outcome`, `last_reason`, `examined`, `kept_evidence`, `kept_verdict`,
  `kept_degraded_verdict`, `rejected_no_evidence`, `rejected_transcript_unreadable`, `invocations_deleted`.
- DDL on an empty table only. No backfill, no INSERT, no index on a large table. Boot cost is the runner's
  existing pre-migration backup.
- Append-only rule: never edit `0044` or earlier. Bump the "highest bundled version" ratchet from 44 to 45 in
  every migration spec that asserts it (8 files found with `toBe(44)`; grep `Math.max(...MIGRATIONS` for any
  other form). Add `0045_skill_backlog_cleanup.spec.ts` (registry entry, idempotent double apply, one-row CHECK
  rejects `id = 2`).
- **Files**: CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.ts` and
  `.spec.ts`; MODIFY `migrations/index.ts`; MODIFY the ratchet specs.

#### 4b. `SkillBacklogCleanupStore` (skill-synthesis)

- Owns every SQL statement of the cleanup: read/upsert the state row; page candidates
  `WHERE status = 'candidate' AND created_at < :cutoff AND (created_at, id) > (:cursorCreatedAt, :cursorId)
  ORDER BY created_at, id LIMIT :n`; reject a batch; delete fake invocations in pages
  (`DELETE FROM skill_invocations WHERE rowid IN (SELECT rowid FROM skill_invocations WHERE context_id IS NOT
  NULL LIMIT :n)` — `DELETE … LIMIT` is not compiled into SQLite by default).
- Batch reject = one `BEGIN IMMEDIATE` … `COMMIT` per batch (≤ 100 rows), `ROLLBACK` on throw, using explicit
  `exec` statements as `skill-queue.store.ts` does (`:684-...`, `inImmediateTransaction`). Do NOT use
  `db.transaction(...)`: the `node:sqlite` test binding does not provide it (`queue-db.test-support.ts:33-41`).
  The UPDATE guards `AND status = 'candidate'`, so a row the user promoted or rejected between the page read
  and the write is not touched. It writes `status = 'rejected'`, `rejected_at`, `rejected_reason`.
- Every named parameter bound on every path (HANDOFF rule 3).
- **Assumption**: `SkillCandidateStore.updateStatus` (`skill-candidate.store.ts:503-...`) stores the reason in
  `rejected_reason` and sets `rejected_at`. Check the UPDATE body; the batch write must write the same columns.
- **Files**: CREATE `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts` and `.spec.ts`.

#### 4c. `SkillBacklogCleanupService` (skill-synthesis)

- `run({ signal, isOnBattery, now? }): Promise<BacklogCleanupReport>`. Never rejects; returns a discriminated
  report (`skipped` with a reason token, or `completed | partial | failed` with counters), the
  `MemoryRetentionReport` shape (`memory-curator/.../memory-retention.types.ts:55-82`).
- Gates, in order, each a `skipped` token: `disabled` (`skillSynthesis.enabled` off,
  `skill-drain.service.ts:303`), `complete` (state row `finished_at` set for the current version),
  `boot-deferred` (construction time + `skillSynthesis.drain.bootDeferralMs`, same as
  `memory-retention.service.ts:235-236`), `on-battery` (`skillSynthesis.drain.pauseOnBattery`),
  `foreground-active` (`ForegroundActivityTracker.msSinceLastActivity()` < `foregroundBackoffMs`), `aborted`.
- First run: write `version`, `started_at`, `cutoff_created_at = now`. Candidates created after the cutoff
  already passed the strict prefilter and are never examined.
- Per candidate (per tick cap 200 candidates and 60 s wall budget; check `signal` and the wall budget between
  candidates):
  1. For each `sourceSessionIds` entry: `SessionVerdictStore.findBySession` (`session-verdict.store.ts:195`).
     A non-degraded row → keep (`kept_verdict`). A degraded row → keep under D4 (a) (`kept_degraded_verdict`).
  2. Else locate the transcript: `workspaceRoot` = candidate `workspaceRoot`, else the `prefilter` queue row's
     `workspace_root` (`skill-queue.store.ts:671`); `transcriptPath` = that row's `transcript_path`. Call
     `TrajectoryExtractor.extract(sessionId, workspaceRoot, MIN_ROLE_TURNS_FLOOR, transcriptPath)`
     (`trajectory-extractor.ts:145`). Local file I/O, no LLM. The extractor already yields every 200 turns.
  3. Any session with `hasSessionWorkEvidence` → keep (`kept_evidence`).
  4. Else, if at least one transcript was read → reject, reason `backlog-cleanup: no code evidence and no verdict`.
     If no transcript was readable → D4 (a): reject, reason
     `backlog-cleanup: transcript unreadable and no verdict`.
  5. Advance the cursor after each committed batch, not per candidate, so a crash repeats at most one batch
     (the UPDATE status guard makes a repeat harmless).
- After the candidate pages are exhausted: delete fake invocation rows in pages of 500 (D6), one transaction per
  page, then set `finished_at`, `last_outcome = 'completed'`, and log one `logger.info` summary with every
  counter.
- **No LLM spend, no new lane.** The job never enqueues work.
- **Degradation-audit impact**: the transcript read already fails soft inside the extractor
  (`trajectory-extractor.ts:169-177`, marked). A new catch around one candidate's evaluation (to keep one bad
  row from failing the tick) needs `// degradation-audit: reported - counted in rejected_transcript_unreadable or last_error`.
  A catch around the whole run that returns `failed` needs `reported`. Record the before/after lint count.
- **Files**: CREATE `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts`,
  `skill-backlog-cleanup.types.ts` (report + reason tokens), `.service.spec.ts`,
  `skill-backlog-cleanup.integration.spec.ts`.

#### 4d. Stop gate stages from grading rejected candidates

- `stage-handlers.service.ts:478-483` `gateTarget`: return `null` when the loaded candidate is `rejected`, and
  the three gate handlers map that to `skipped` with a distinct reason (for example
  `gate-candidate-rejected`), not the "no candidate" reason. `promoted` stays gradeable
  (`gates/trigger-eval.service.ts:497` documents post-promotion evaluation).
- Why here: the cleanup rejects up to ~2,400 rows while 268 gate rows are queued (`brief.md`). Without this,
  the weekly tier spends tokens grading rejected candidates. It also covers manual rejections.
- **Files**: MODIFY `libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts`; MODIFY
  `libs/backend/skill-synthesis/src/lib/skill-synthesis.stage-handlers.spec.ts` (one case per gate stage).

#### 4e. Job registration (both hosts)

- CREATE `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts`: `SKILL_BACKLOG_CLEANUP_JOB`
  (`jobId: '@ptah/skills-backlog-cleanup'`, `handlerName: 'skills:backlog-cleanup'`, `cronExpr: '41 * * * *'`,
  `timezone: 'UTC'`) and `createSkillBacklogCleanupHandler(container)`, on the `memory-retention-job.ts` model:
  resolve per run, `skipped` → `{outcome:'skipped', reason}`, `failed` → throw the reason token only, else a
  counters summary. Minute 41 avoids :00/:15/:30/:45 (drains, backup, integrity) and :17 (memory retention).
- `start-thoth-cron.ts`: `registerSkillBacklogCleanupJob` beside `registerMemoryRetentionJob` (`:266-300`,
  call site `:473`), guarded by `container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_SERVICE)`
  and `handlerRegistry.has`.
- `cli-engine/src/lib/bootstrap/thoth-runtime.ts`: the same registration beside `:528`, called beside `:330`.
- Export from `thoth-runtime/src/index.ts` as `MEMORY_RETENTION_JOB` is.
- After completion the job stays registered; each later tick is one SELECT on a one-row table and returns
  `skipped: complete`. Registration runs no SQL (the `memory-retention` rule). See Risk R6.
- **Files**: CREATE `thoth-runtime/src/lib/skill-backlog-cleanup-job.ts` and `.spec.ts`; MODIFY
  `thoth-runtime/src/lib/start-thoth-cron.ts`, `start-thoth-cron.spec.ts`, `thoth-runtime/src/index.ts`,
  `cli-engine/src/lib/bootstrap/thoth-runtime.ts`, `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts`.

#### 4f. Where the report lives and what it contains

| Report surface | Content | Who reads it |
| --- | --- | --- |
| `skill_backlog_cleanup_state` row | version, cutoff, cursor, started/finished, last outcome/reason, the seven counters | diagnostics, phase 6 "Needs attention", the measurement batch |
| `skill_candidates.rejected_reason` per row | one of the two `backlog-cleanup: …` strings | Skills tab rejected filter today (`rejectedReason` is on the wire, `skills-synthesis-rpc.handlers.ts:2401`, `rpc.types.ts:2227`) |
| cron run history | handler summary: `examined N, rejected N, kept N, invocations deleted N` | `cron:runs` |
| log | one `[skill-synthesis] backlog cleanup complete` info line with all counters | support logs |
| `.ptah/specs/TASK_2026_461_639c/backlog-cleanup-measurement.md` | the byte-copy measurement (Component 8) | the user, before merge |

No UI change in this phase. A UI surface for the report is phase 6.

- **Verification seam**:
  - `skill-backlog-cleanup.store.spec.ts` (real SQLite, both bindings): paging order and cursor, batch reject
    guard skips a row whose status changed, paged fake-invocation delete removes only `context_id IS NOT NULL`
    rows.
  - `skill-backlog-cleanup.service.spec.ts` (stubs): each gate token; D4 branches; wall budget → `partial` and
    resumes from the cursor; abort → `partial`.
  - `skill-backlog-cleanup.integration.spec.ts` (real SQLite, both bindings, real `TrajectoryExtractor` over
    fixture JSONL through a fake `JsonlReaderService`): seed candidates (edit transcript; conversation-only
    transcript; conversation-only with a verdict row; missing transcript; one created after the cutoff) plus
    one tracker-style invocation (`context_id NULL`) and fake ones; run to completion; assert the exact
    status/reason per row, the tracker row survives, fake rows gone, state row counters, a second `run` returns
    `skipped: complete`. **Mutation**: delete the batch-reject call → the conversation-only candidate stays
    `candidate` → spec fails.
  - Reachability (job exists): `start-thoth-cron.spec.ts` asserts `@ptah/skills-backlog-cleanup` is upserted
    and `skills:backlog-cleanup` registered when the token is registered, and absent when it is not.
    `cli-engine` `thoth-runtime.spec.ts` asserts the same for `activateThoth`. **Mutation**: remove each
    registration call → each spec fails.
  - DI: `di/register.spec.ts` stays green only if the new token is registered.

### 5. `CandidateNamerService`: delete (item E)

- **Recommendation**: delete. Evidence:
  1. **No reader on the product surface.** `display_name` is not mapped onto any candidate wire DTO or UI
     (grep of `rpc-handlers/src`, `shared/src`, `skill-synthesis-ui/src`). Wiring the namer writes a column the
     user never sees. Showing it is UI work (phase 4/6), not "call after registration".
  2. **Cost for no visible gain.** One extra `judge`-lane call per new candidate
     (`candidate-namer.service.ts:136-142`). The `prefilter` stage is already the largest spender
     (`skill-synthesis/CLAUDE.md:71`, $0.077 on one boot).
  3. **Duplicate naming.** Every non-boot candidate already gets an LLM `name` and `description` from the
     synthesizer (`skill-synthesis.service.ts:782-794`). Boot candidates skip the LLM on purpose (`:777-781`);
     naming them adds exactly the boot-path spend that rule avoids.
  4. **Phase 5 overlap.** Phase 5 rewrites the synthesizer prompt and authors ONE draft from cited steps after
     archaeology. Naming belongs in that authoring step. A namer wired now is a second naming path phase 5
     must remove.
- **Responsibilities**: delete `naming/candidate-namer.service.ts` and `naming/candidate-namer.service.spec.ts`;
  remove `register.ts:55` import, `:99` singleton, `:206-208` token binding; remove `tokens.ts:133-134`; remove
  `src/index.ts:142-148` exports; delete `SkillCandidateStore.setDisplayName` (`skill-candidate.store.ts:710-722`)
  and its spec block (`skill-candidate.store.spec.ts:1644-1668`). Keep `display_name` (migration `0033`,
  append-only), `SkillCandidateRow.displayName` (`types.ts:184`) and its mapping (`skill-candidate.store.ts:1590`)
  because `skill-gap-curator.service.ts:726,1039` and `trigger-eval.service.ts:791` read it.
- Update `skill-synthesis/CLAUDE.md` lines 26, 37, 63 (namer named in the lane rule), 64.
- **Assumption**: no consumer outside the lib imports the removed exports. Check: grep `CandidateNamerService`,
  `CANDIDATE_DISPLAY_NAME_MAX_CHARS`, `CANDIDATE_NAMING_JSON_SCHEMA`, `CandidateNaming` across `libs` and `apps`
  (this plan's grep found only the lib itself).
- **Failure behaviour**: not applicable (deletion).
- **Degradation-audit impact**: removes one `optional-capability` marker (`candidate-namer.service.ts:145-146`).
  **Assumption**: if the `skill-synthesis` baseline is an exact count, lower it in the same batch; if it is a
  ceiling, no change. Check the degradation-audit baseline file before the batch.
- **Verification seam**: `di/register.spec.ts` (every declared token registered; the token is gone from both
  sides); `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers`
  (check the 2-projects header).
- **Files**: DELETE the two naming files; MODIFY `di/register.ts`, `di/tokens.ts`, `src/index.ts`,
  `skill-candidate.store.ts`, `skill-candidate.store.spec.ts`, `libs/backend/skill-synthesis/CLAUDE.md`.

If the user picks D5 (b) (wire it), the only valid call site is the `prefilter` handler after a NEW
registration (`stage-handlers.service.ts:285-291`, `result.reused === false`), with the trajectory from
`analyzeSession`, plus a wire field and a UI render. That is larger than the verdict's "call it".

### 6. Reachability proof (item F)

- **Purpose**: fail if the production path does not reach the manual promote path, the evidence prefilter, or
  the removal of the fake invocation.
- **File**: CREATE `libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.integration.spec.ts`, with
  a helper `libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.test-support.ts` if the container
  setup passes ~150 lines (`*.test-support.ts` convention, `queue-db.test-support.ts:1-8`).
- **Harness**:
  - A child tsyringe container. Call the production `registerSkillSynthesisServices(container, logger)`
    (`di/register.ts:59`). Do not construct services by hand.
  - Bind ONLY the host-provided tokens: `TOKENS.LOGGER`; `PERSISTENCE_TOKENS.SQLITE_CONNECTION` over a real temp
    SQLite file; `PERSISTENCE_TOKENS.VEC_STATUS` `{available: false}`; `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
    serving a settings map (skills root and candidates dir in a temp dir, `judgeEnabled: true`);
    `SESSION_END_CALLBACK_REGISTRY` (`Symbol.for('SdkSessionEndCallbackRegistry')`, captures the callback);
    `SDK_TOKENS.SDK_JSONL_READER` (a fake that reads the fixture JSONL files); `SDK_TOKENS.SDK_CURATOR_RATE_LIMIT`
    (required by `skill-curator.service.ts:156`); `INTERNAL_QUERY_SERVICE_TOKEN` = **the fake LLM lane**, built
    from `lanes/lane-runner.test-support.ts` (`makeQueryStub`, `resultMessage`, `assistantText`), replying to the
    `synthesis` lane with a skill draft and to the `judge` lane with a five-criteria score of 8.
  - **Assumptions to resolve by resolving the container**: the exact set of non-optional host tokens (the list
    above comes from the `@inject` lines of every class `SkillSynthesisService` reaches); whether
    `SqliteConnectionService` can open a temp path directly (else apply `MIGRATIONS` in order as the `0040` /
    `0041` specs do); how the fake lane tells the synthesis request from the judge request (by
    `systemPromptAppend` content or model); that `prefilter` is in the `frequent` tier's stage set
    (`DRAIN_TIER_STAGES`).
  - Real SQLite: **yes**. Run under both bindings (HANDOFF rule 3). The opener is `resolveOpener`
    (`queue-db.test-support.ts:101-124`), and the spec must `it.skip` only when neither binding loads.
- **Scenario** (one `it` per numbered assertion group, shared `beforeAll`):
  1. `await synthesis.start()` (resolved from the container). Fire the captured session-end callback for three
     sessions: `s-alpha` in `<tmp>/ws-a` and `s-beta` in `<tmp>/ws-b` with the same code-work transcript (one
     `Edit`, one `Bash` `npx nx test …`, text that mentions each workspace root, so normalization gives one
     trajectory hash), and `s-chat` in `<tmp>/ws-a`, 8 turns and > 1,000 chars of text blocks only.
  2. `await drain.drain({ tier: 'frequent', signal, onBattery: false })` until no `prefilter` row is `queued`
     (resolve `SKILL_DRAIN_SERVICE` from the container).
  3. Assert: exactly one `skill_candidates` row; `status = 'candidate'`, `success_count = 0`,
     `source_session_ids = ["s-alpha"]`. Queue: `s-alpha` prefilter `done`; `s-beta` prefilter `done` with reason
     `reused existing candidate`; `s-chat` prefilter `skipped` with `no candidate from this session`; zero
     `archaeology`, `judge-panel`, `trigger-eval` rows for `s-chat`. `SELECT COUNT(*) FROM skill_invocations` = 0.
  4. Automatic path unchanged: `promotion.evaluate(id, synthesis.readSettings())` returns `below-threshold`,
     the fake lane saw zero judge calls, status still `candidate`.
  5. Manual path: `synthesis.promote(id, { userInitiated: true })` returns `{promoted: true, reason:'promoted'}`;
     row `status = 'promoted'`, `judge_status = 'scored'`; `SKILL.md` exists under the temp active root.
- **Mutations** (paste fail and restore outputs into the batch report, HANDOFF rule):
  - **M1** `SkillSynthesisService.promote` calls `promotion.evaluate` → group 5 fails (`below-threshold`).
  - **M2** restore the `depthOk` branch → group 3 fails (a second candidate for `s-chat`).
  - **M3** restore the fake `recordInvocation` block → group 3 fails (invocation count 1).
  - **M4** remove `this.stageHandlers?.registerStageHandlers(this)` (`skill-synthesis.service.ts:313`) → group 3
    fails (prefilter rows `skipped` "no handler for stage prefilter").
  - **M5** make `promoteManually` apply the threshold → group 5 fails.
- **What the proof does NOT claim**: that automatic promotion happens. Group 4 pins that it does not, so phase 5
  must change this spec on purpose when it adds promotion from `skill_invocation_events`.
- **Files**: CREATE the spec (and the optional test-support file).

### 7. Dead settings removal outside skill-synthesis (D2 option (a))

- Delete `skillSynthesis.eligibilityMinTurns` and `skillSynthesis.prefilterMinChars` from:
  `platform-core/src/file-settings-keys.ts:230,235,509,514`;
  `rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:36,41` and its spec;
  `shared/src/lib/types/rpc.types.ts:2662,2667`;
  `skill-synthesis-ui/.../skill-settings-panel.component.ts:161,202` (the two form fields and labels) and its
  spec; `skill-synthesis-tab.component.ts:794,799` and its spec; and any fixture in
  `libs/frontend/webview-e2e-harness/.../skills-lane-pickers.e2e.spec.ts` and
  `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts` that names them (grep hit both files).
- **Assumption**: `file-settings-keys.spec.ts` and `skills-synthesis-rpc.schema.spec.ts` guard the key lists;
  they need the same deletion. A user `settings.json` that still holds the keys must be ignored, not rejected.
  Check how the schema treats unknown keys on read (`z.object` strips by default).
- **Failure behaviour**: none new.
- **Verification seam**: `npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui`
  (check the 4-projects header). Load flakes per HANDOFF rule 8.
- **Files**: MODIFY the files listed above.

### 8. Measurement (no production code)

- **Prefilter narrowing**: run the opt-in `prefilter-corpus-measurement.spec.ts` (`PTAH_PREFILTER_CORPUS=1`)
  over `~/.claude/projects` JSONL. Record phase-2 vs phase-3 eligible counts and how many phase-2 passes were
  depth-only. It reads transcripts, never the database, and prints counts only (its privacy header,
  `:12-14`).
- **Cleanup outcome** on a byte copy (HANDOFF rule 5):
  1. Create a fail-if-exists temp dir whose name does not start with `ptah`.
  2. Byte-copy the newest `ptah.pre-migration-*.sqlite` (a static file) with `COPYFILE_EXCL`. Do not copy the
     live `ptah.sqlite` while any Ptah host runs; a copy without its `-wal` is not the live state.
  3. Open ONLY the copy. Set and read back the six production pragmas (`journal_mode = WAL`,
     `foreign_keys = ON`, `synchronous = NORMAL`, `temp_store = MEMORY`, `mmap_size = 268435456`,
     `busy_timeout = 5000`). Apply migrations through `0045`.
  4. Run `SkillBacklogCleanupService.run` in a loop until `complete`, with the gates satisfied, against the real
     transcripts (read-only).
  5. Record: candidates examined, kept by evidence / verdict / degraded verdict, rejected by each reason, fake
     invocations deleted, ticks, wall time per tick, largest single transcript read time.
  6. Re-check source size and mtime unchanged. Delete the temp dir and confirm it is gone.
- **Deliverable**: `.ptah/specs/TASK_2026_461_639c/backlog-cleanup-measurement.md`.

## Integration architecture

- **Data flow, trigger to promotion**: session end → `enqueueAnalyze` (`skill-synthesis.service.ts:493`) →
  `prefilter` row → frequent drain → `runPrefilterStage` (`stage-handlers.service.ts:266`) → `analyzeSession` →
  `passesPrefilter` → `hasSessionWorkEvidence` → (no evidence: `null` → row `skipped`) / (evidence: synthesizer
  lane → `registerCandidate`, NO invocation row) → chained archaeology / judge-panel / trigger-eval rows → user
  clicks Promote → RPC `skillSynthesis:promote` → `SkillSynthesisService.promote` →
  `SkillPromotionService.promoteManually` → gates (no threshold) → SKILL.md → `promoted` → repropagation.
- **Data flow, cleanup**: cron tick `@ptah/skills-backlog-cleanup` → handler → `SkillBacklogCleanupService.run`
  → gates → page candidates → verdict lookup → transcript extract → evidence predicate → batch reject (one
  `BEGIN IMMEDIATE` per batch) → cursor → … → paged fake-invocation delete → `finished_at`.
- **State and persistence**: `skill_backlog_cleanup_state` (one row, owned by the cleanup store, lifetime =
  database). No in-memory state survives a restart except the construction timestamp for boot deferral.
- **External boundaries**: transcripts on disk (read through `JsonlReaderService`, failures already mapped to
  `null`); user settings (read through `IWorkspaceProvider` with defaults). The RPC boundary is unchanged (Zod in
  `skills-synthesis-rpc.schema.ts`).
- **Failure and rollback**: a batch transaction rolls back as a whole; the cursor moves only after commit; a
  crash repeats at most one batch; the `status = 'candidate'` guard makes a repeat a no-op. A thrown run returns
  `failed` with a token; the next tick resumes. Rejection is terminal (`LEGAL_TRANSITIONS`), which is why D4
  defaults to the conservative predicate and the measurement runs before merge.
- **Observability**: state row counters; cron run summary; one completion log line; `rejected_reason` per row;
  queue reasons `no candidate from this session` and the new `gate-candidate-rejected`.

## Architecture-level quality requirements

- **Functional**: a manual Promote on a zero-count candidate promotes when the judge passes; automatic
  `evaluate` still blocks below threshold; new candidates write zero invocation rows; conversation-only sessions
  produce no candidate and no chained rows; after the job completes, no pre-cutoff `candidate` row lacks both a
  verdict and work evidence (under D4 (a)); zero `skill_invocations` rows with `context_id IS NOT NULL`.
- **Performance**: no work at registration; cleanup tick ≤ 60 s wall and ≤ 200 candidates; no boot-path SQL
  beyond `0045` DDL; no LLM spend from the cleanup.
- **Security**: no new external input. Report strings are fixed tokens; no transcript content is persisted or
  logged by the cleanup (session ids and counters only).
- **Maintainability**: `skill-synthesis` still never imports `cron-scheduler`; the job table lives in
  `thoth-runtime` and is registered in both hosts; one evidence predicate, two callers; no version-suffixed
  copies; dead code deleted (namer, `setDisplayName`, the depth branch, D2 keys).
- **Testability**: every behaviour above has a spec that fails under a named mutation; SQLite specs pass under
  `better-sqlite3` (Electron-as-Node) and `node:sqlite`.

## Test plan — acceptance criteria to specs

| # | Acceptance criterion | Spec | SQLite | Mutation |
| --- | --- | --- | --- | --- |
| AC1 | Manual Promote bypasses only the threshold | `skill-promotion.service.spec.ts`; proof group 5 | proof: yes | M1, M5 |
| AC2 | Manual path keeps dedup, judge, replay, cap, write gates | `skill-promotion.service.spec.ts` | no | force each gate to pass → its case fails |
| AC3 | Automatic `evaluate` keeps `below-threshold` | `skill-promotion.service.spec.ts`; proof group 4 | proof: yes | delete the threshold step → fails |
| AC4 | No invocation row at candidate creation | `skill-synthesis.service.spec.ts`; proof group 3 | proof: yes | M3 |
| AC5 | Conversation-only session produces nothing | `skill-synthesis.service.spec.ts`; `session-work-evidence.spec.ts`; proof group 3 | proof: yes | M2 |
| AC6 | Edit-only, tool-only, test-only sessions stay eligible | `session-work-evidence.spec.ts`; `skill-synthesis.service.spec.ts` | no | invert one signal → fails |
| AC7 | Cleanup rejects no-evidence, no-verdict candidates with the visible reason; keeps the rest | `skill-backlog-cleanup.integration.spec.ts` | yes | delete batch reject → fails |
| AC8 | Cleanup deletes only `context_id IS NOT NULL` invocation rows | `skill-backlog-cleanup.store.spec.ts`, integration spec | yes | drop the predicate → tracker row deleted → fails |
| AC9 | Cleanup is resumable, gated and bounded | `skill-backlog-cleanup.service.spec.ts` | no | remove the wall-budget check → `partial` case fails |
| AC10 | Cleanup job registered in Electron and CLI hosts | `start-thoth-cron.spec.ts`; `cli-engine` `thoth-runtime.spec.ts` | no | remove each registration call |
| AC11 | Gate stages skip rejected candidates | `skill-synthesis.stage-handlers.spec.ts` | no | remove the status check |
| AC12 | Namer deleted, DI complete | `di/register.spec.ts`; typecheck | no | not applicable |
| AC13 | Registration seam still reaches the drain | proof group 3 | yes | M4 |
| AC14 | `degradation-audit:lint` at baseline (or the documented new baseline) | `npx nx run degradation-audit:lint` | no | not applicable |
| AC15 | Measurement report exists with the Component 8 numbers | `backlog-cleanup-measurement.md` | copy only | not applicable |

SQLite specs (run both bindings; HANDOFF rule 3 command, `$root` = the main checkout because this worktree has
no `node_modules`): `skill-synthesis.reachability.integration.spec.ts`,
`skill-backlog-cleanup.store.spec.ts`, `skill-backlog-cleanup.integration.spec.ts`,
`0045_skill_backlog_cleanup.spec.ts`, and every migration spec whose ratchet changed.

Suite commands (check the N-projects header each time):
`npx nx run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers`,
then `npx nx run-many -t typecheck -p` over the same set plus the D2 libs, then
`npx nx run degradation-audit:lint`. Quote any `|` in `--testPathPatterns` as `'"a|b"'`.

## Risks

- **R1 — Rejection is terminal.** `rejected` cannot go back (`skill-promotion.service.ts:192-194`). A wrong
  cleanup predicate loses candidates for good. Mitigation: D4 (a) is conservative on verdicts; the byte-copy
  measurement runs before merge; every rejected row carries a searchable reason.
- **R2 — "Tool evidence" is broad.** `toolUseCount` counts every `tool_use`, including MCP lookups (a HubSpot
  question that calls two MCP tools still passes). The verdict names tool evidence, so this plan keeps it.
  Narrowing to workspace tools is a phase 5 archaeology concern. The measurement shows how many sessions pass on
  tools alone.
- **R3 — Automatic promotion stays impossible.** Deleting the fake invocation does not change that (the fake row
  never raised `success_count`), but users may read the Skills tab text "needs N successful runs"
  (`skill-synthesis-tab.component.ts:1145`) as a path that exists. Phase 5 owns the producer; phase 4 may
  reword the text.
- **R4 — Dead generalization shortcut.** After B, no writer sets `context_id`, so
  `skill-promotion.service.ts:211-215` and `generalizationContextThreshold` are unreachable. Phase 5 rewrites
  the automatic threshold; deleting it now would touch a settings key, the wire and the UI for a path that has
  no producer. Record it in phase 5's context.
- **R5 — `SkillInvocationTracker` is registered and unused** (`register.ts:72,107`). It is the tribunal's
  fourth "built, never called" case. It belongs to phase 5 (promotion from real usage), which must wire or
  delete it. Not touched here.
- **R6 — A finished one-shot job stays in the cron list.** One SELECT per hour. Deleting the job row after
  completion needs boot-time SQL at registration or a self-delete that the next boot re-upserts. Accept it; phase
  6's ledger work can retire it.
- **R7 — Transcript read cost.** Up to 2,426 JSONL reads on the backend main thread, some multi-MB. Mitigation:
  per-tick caps, foreground and battery gates, the extractor's 200-turn yield. The measurement records the
  worst read.
- **R8 — Merge overlap with phase 4.** D2 (a) edits `skill-synthesis-tab.component.ts:794,799`; phase 4 edits the
  same component near `:476-490`. Different hunks; rebase whichever merges second.
- **R9 — Load flakes** listed in HANDOFF rule 8 can fail the suites. Re-run with `--parallel=1` and record both.

## Decisions for the user

**D1 — How the proof "ends `promoted`" after the fake invocation is gone.**
Automatic promotion has no production producer today: `evaluate` is reached only through the dead tracker
(`skill-invocation-tracker.ts:80`) and the manual RPC. The fake row never raised `success_count`.
- (a) **Recommended**: the proof drives two identical code sessions in two workspaces through the production
  drain to ONE candidate, pins that automatic `evaluate` still says `below-threshold`, then ends `promoted`
  through the manual RPC method. Automatic promotion stays phase 5.
- (b) Add a minimal automatic recurrence: when a session from another workspace reuses a candidate by exact
  trajectory hash, append the session, write a real invocation with its context, increment `success_count`, and
  run `evaluate`. Against: an exact normalized-transcript match between real sessions almost never happens, so
  this is a path reachable in code and dead in data (the tribunal's defect); two sessions still miss the default
  threshold of 3; phase 5 replaces it with `skill_invocation_events`.
- (c) Pull phase 5's promotion from `skill_invocation_events` forward. Against: the user said do not start phase 5.

**D2 — The two settings that only the depth branch read (`eligibilityMinTurns`, `prefilterMinChars`).**
- (a) **Recommended**: delete them end to end (Component 7). A visible setting that changes nothing misleads.
- (b) Keep them inert and leave the removal to a later phase. Smaller diff, no UI touch, but dead configuration
  in the settings panel.

**D3 — A SKILL.md write failure during promotion.** Today it warns and still promotes
(`skill-promotion.service.ts:293-303`), so the verdict's "keeps write checks" has nothing to keep.
- (a) **Recommended**: fail closed on both paths: new reason `write-failed`, row stays `candidate`, no
  repropagation. A promoted row with no active SKILL.md is not a skill.
- (b) Keep today's behaviour on both paths.

**D4 — The cleanup predicate.**
- (a) **Recommended**: any verdict row protects a candidate, including degraded ones (counted separately); an
  unreadable transcript with no verdict is rejected with its own reason (nothing can ever produce evidence for
  it: archaeology needs the transcript too).
- (b) Only a usable (non-degraded) verdict protects; degraded ones are rejected.
- (c) As (a), but an unreadable transcript keeps the candidate.

**D5 — `CandidateNamerService`.**
- (a) **Recommended**: delete (Component 5 evidence: no wire/UI reader, per-candidate lane cost, duplicates the
  synthesizer's naming, phase 5 owns authoring).
- (b) Wire it after a new registration in the prefilter handler, plus a wire field and a UI render.

**D6 — The 2,432 historical fake invocation rows.**
- (a) **Recommended**: the cleanup job deletes every `context_id IS NOT NULL` row (exactly the fakes).
- (b) Keep them as history. Stats keep showing 2,432 uses that never happened.

## Team-leader handoff

- **Recommended executors**: `backend-developer` for Batches 1–5 (all TypeScript services, stores, migration,
  DI, cron seam); `frontend-developer` for the UI part of Batch 2 only if D2 (a); `senior-tester` for Batch 6
  (measurement and both-binding runs). Reviews from a different model family (HANDOFF rule 7).
- **Complexity**: MEDIUM. Every change is small, but the cleanup is irreversible for users and the proof needs a
  real-container harness that does not exist yet.
- **Dependencies and ordering** (component level):
  - Batch 1 (Components 1, 2, 3 inside skill-synthesis, D3): first. Files: `skill-promotion.service.ts`,
    `skill-synthesis.service.ts`, `types.ts`, `eligibility/*`, `skill-promotion.service.spec.ts`,
    `skill-synthesis.service.spec.ts`, `prefilter-corpus-measurement.spec.ts`.
  - Batch 2 (Component 7, D2): after Batch 1 (the `SkillSynthesisSettings` fields are gone). Files:
    `platform-core`, `rpc-handlers` schema + spec, `shared` rpc types, `skill-synthesis-ui` two components +
    specs, the two e2e specs.
  - Batch 3 (Components 4a–4d): after Batch 1 (uses the evidence predicate). Files: migration `0045` + spec +
    `index.ts` + ratchet specs, `cleanup/*`, `skill-candidate.store.ts` (only if the batch reject lives there;
    prefer the cleanup store), `queue/stage-handlers.service.ts`, `skill-synthesis.stage-handlers.spec.ts`.
  - Batch 4 (Component 4e + Component 5): after Batch 3. Files: `di/register.ts`, `di/tokens.ts`,
    `src/index.ts`, `naming/*` (delete), `skill-candidate.store.ts` + spec (`setDisplayName` removal),
    `thoth-runtime/*`, `cli-engine/.../thoth-runtime.ts` + spec, `skill-synthesis/CLAUDE.md`. Run `npx nx reset`
    only if a `project.json` changes (none planned), and never while another executor shares the worktree.
  - Batch 5 (Component 6 proof): after Batches 1 and 4 (needs the final DI graph). File-disjoint from all others.
  - Batch 6 (Component 8 measurement + both-binding runs + mutation evidence collation): last.
- **Parallel-safe work**: Batch 2 and Batch 3 after Batch 1 (file-disjoint; if Batch 3 puts the reject SQL in
  `skill-candidate.store.ts`, Batch 4's `setDisplayName` removal must wait for it, which the ordering already
  gives).
- **Files affected**:
  - CREATE: `libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts`, `.spec.ts`;
    `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts`, `.store.spec.ts`,
    `skill-backlog-cleanup.service.ts`, `.service.spec.ts`, `skill-backlog-cleanup.types.ts`,
    `skill-backlog-cleanup.integration.spec.ts`;
    `libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.integration.spec.ts` (and optional
    `.test-support.ts`);
    `libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.ts`, `.spec.ts`;
    `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts`, `.spec.ts`;
    `.ptah/specs/TASK_2026_461_639c/backlog-cleanup-measurement.md`.
  - MODIFY: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts`, `skill-promotion.service.spec.ts`,
    `skill-synthesis.service.ts`, `skill-synthesis.service.spec.ts`, `types.ts`,
    `prefilter-corpus-measurement.spec.ts`, `queue/stage-handlers.service.ts`,
    `skill-synthesis.stage-handlers.spec.ts`, `skill-candidate.store.ts`, `skill-candidate.store.spec.ts`,
    `di/register.ts`, `di/tokens.ts`, `src/index.ts`, `libs/backend/skill-synthesis/CLAUDE.md`;
    `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` and the ratchet specs `0028`, `0030`, `0038`,
    `0039`, `0040`, `0041`, `0042`, `0043`;
    `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`, `start-thoth-cron.spec.ts`, `src/index.ts`;
    `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`, `thoth-runtime.spec.ts`;
    D2 (a): `libs/backend/platform-core/src/file-settings-keys.ts` (+ spec),
    `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts` (+ spec),
    `libs/shared/src/lib/types/rpc.types.ts`,
    `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts` (+ spec),
    `skill-synthesis-tab.component.ts` (+ spec),
    `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts`,
    `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts`.
  - DELETE: `libs/backend/skill-synthesis/src/lib/naming/candidate-namer.service.ts`,
    `candidate-namer.service.spec.ts`.
  - REWRITE: none.
- **Verification points**:
  - Open and confirm before coding: the `SqliteConnectionService` temp-path option; `DRAIN_TIER_STAGES` for
    `prefilter`; the `updateStatus` UPDATE columns; the degradation-audit baseline format; the host token set the
    proof container needs.
  - Contracts to honour: `evaluate` signature unchanged; `promote` / `promoteBulk` signatures unchanged;
    `PromotionDecision.reason` gains `write-failed` only under D3 (a) (the wire carries `reason` as a string,
    `skills-synthesis-rpc.handlers.ts:456-460`); `skill-synthesis` never imports `cron-scheduler`; shipped
    migrations untouched.
  - Data changes: migration `0045` only (DDL). The rejections and deletions happen at runtime through the job.
  - Every batch report pastes: the N-projects header of each `run-many`, both-binding output for SQLite specs,
    fail-then-restore output for each named mutation, and the degradation-audit count.
