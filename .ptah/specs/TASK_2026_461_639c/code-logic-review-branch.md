# Code Logic Review — `TASK_2026_461_639c`

Gate 3 Whole-Branch Review for `feat/task-439-phase3-skills-unblock` (base `97239e814`, HEAD `6607d0d09`, 80 files changed outside `.ptah`).

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 4        |

## Five logic questions

### 1. How does this fail silently?

- **Deferred error candidates advance cursor without re-attempt**: In [`skill-backlog-cleanup.service.ts:218-227`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L218-L227), when `evaluateCandidate()` throws an unexpected error, the service catches it, logs a warning, increments `deferredOnError`, and assigns disposition `'deferred-error'`. In [`skill-backlog-cleanup.service.ts:258-267`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L258-L267), the cursor advances past `last.id` and `last.createdAt` regardless of whether candidates encountered errors. The candidate row in `skill_candidates` is NOT modified (rejection is skipped), remaining in status `'candidate'`. The cleanup completes and reports success without re-evaluating the candidate, though the candidate was never resolved. This fail-safe design prevents infinite wedge loops on poison candidates, but silently leaves un-evaluated candidates behind if an error was transient.
- **Root-resolved extractor swallowed read errors**: In [`trajectory-extractor.ts:169-179`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts#L169-L179), when `readJsonlMessages(filePath)` throws, the error is caught, logged as a debug/warn, and `null` is returned. In [`skill-backlog-cleanup.service.ts:343-345`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L343-L345), because `attempted = true` and `rootReadable = false`, the candidate is rejected with reason `'backlog-cleanup: transcript unreadable and no verdict'`. As measured in Batch 7/8/9, Decision 2 and Decision 3 mitigated this, but `TrajectoryExtractor` itself does not distinguish `EBUSY` from `ENOENT` on root-resolved paths.

### 2. What user action produces unexpected behaviour?

- **Clicking "Promote" on a candidate rejected by cleanup returns an expected rejection notice**: In [`skill-promotion.service.ts:223-225`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts#L223-L225), if a user attempts to manually promote a candidate that was marked `rejected` by the backlog cleanup, the pipeline early-returns `{ promoted: false, reason: 'already-rejected', candidate }`. The candidate is not promoted or re-scored. This is the intended behavior, but users viewing stale UI tabs who click Promote will see the action fail without the judge running.
- **Re-running work in a session whose candidate was rejected by cleanup**: If a user resumes conversation in a session that was previously rejected by cleanup, and adds new edits or tools, [`skill-synthesis.service.ts:811-827`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts#L811-L827) looks up prior candidates using `findLatestBySourceSession(sessionId, 'candidate')`. Because the prior row is `rejected`, it is ignored, and a brand-new candidate is minted once prefilter evidence passes. This is correct and desirable.

### 3. What input data produces a wrong answer?

- **Session transcripts with empty string or path traversal in session ID**: Handled safely. In [`session-transcript-locator.ts:38-45`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts#L38-L45), `isSafeSessionId` explicitly rejects session IDs containing `/`, `\`, or `..`, returning `unavailable`.
- **Corrupted source session IDs JSON**: In [`skill-backlog-cleanup.store.ts:233-244`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts#L233-L244), `parseSessionIds` wraps `JSON.parse` in a try/catch and filters for valid strings. If corrupted, it returns `[]`, which [`skill-backlog-cleanup.service.ts:346-348`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L346-L348) treats as `kept-root-unknown` (safe, does not reject).

### 4. What happens when a dependency fails?

- **`SDK_TOKENS.SDK_JSONL_READER` missing or throws in `listSessionsDirectories`**: In [`session-transcript-locator.ts:63-76`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts#L63-L76), if `listSessionsDirectories` is not a function or throws, `directories` is assigned `null`, causing `locate()` to return `{ kind: 'unavailable' }`. Candidates are safely kept under `kept-root-unknown` instead of being rejected.
- **SQLite concurrency / `SQLITE_BUSY`**: All batch store writes ([`skill-backlog-cleanup.store.ts:145,164`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts#L145)) use `inImmediateTransaction`, issuing `BEGIN IMMEDIATE`. Under concurrent host access, writers queue against the SQLite busy timeout (5,000 ms) rather than crashing or escalating to unrecoverable deadlocks.

### 5. What is missing that the requirements never mentioned?

- **Per-run counter observability across cron runs**: Counters `keptRootUnknown`, `rejectedNoTranscript`, and `deferredOnError` were intentionally not added to migration 0045 to keep the schema ratchet frozen. While logged in the cron run summary, they are not accumulated in `skill_backlog_cleanup_state`, meaning telemetry across ticks must be harvested from logs rather than the database state row.
- **Archived candidate revival**: If a candidate was erroneously rejected by an overly strict historical prefilter, there is no manual "unreject" RPC method. Re-running requires either manual database status manipulation or generating a new session turn.

---

## Failure modes

### 1. Transient read error on candidate evaluation advances cursor without resolution
- Trigger: An unexpected I/O exception or transient SQLite busy failure occurs inside `evaluateCandidate` ([`skill-backlog-cleanup.service.ts:213-227`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L213-L227)).
- Symptom: Warning logged in `[skill-synthesis] backlog candidate evaluation failed`, `deferredOnError` incremented in run report, but candidate row remains untouched in status `'candidate'` while the cursor advances past it ([`skill-backlog-cleanup.service.ts:260-261`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L260-L261)).
- Evidence: [`libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:221-222,260`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L221-L222).
- Current handling: Candidate is deferred from rejection, cursor moves on, and run report reflects `deferredOnError`.
- Recommendation: In Phase 5, provide an optional `--retry-deferred` flag or check `deferredOnError > 0` before marking cleanup permanently completed.

### 2. Candidate promoted while cleanup batch is in-flight
- Trigger: User initiates manual promotion (`promoteManually`) while cleanup is evaluating a batch of candidates containing that candidate.
- Symptom: None — safe by design.
- Evidence: [`libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts:150`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts#L150).
- Current handling: The store statement is `UPDATE skill_candidates SET status = 'rejected' ... WHERE id = @id AND status = 'candidate'`. If the row was promoted, its status is `'promoted'`, so the update changes 0 rows and does not overwrite the promotion.
- Recommendation: Current handling is verified and sound.

### 3. Empty transcript directory listing
- Trigger: Claude transcript folder exists but is empty or readdir fails.
- Symptom: Candidates could have been falsely categorized as `absent` and rejected.
- Evidence: Fixed in Batch 9 Revise 1 ([`session-transcript-locator.ts:95-98`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts#L95-L98)).
- Current handling: If `sessionDirectories === null || sessionDirectories.length === 0`, the locator immediately returns `{ kind: 'unavailable' }`, keeping candidates as `kept-root-unknown`.
- Recommendation: Current handling is verified and sound.

### 4. Concurrent execution from two hosts sharing one database
- Trigger: Electron app and CLI daemon both boot and schedule `@ptah/skills-backlog-cleanup`.
- Symptom: Potential double execution.
- Evidence: [`libs/backend/cron-scheduler/src/lib/job-runner.ts:135-141`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/cron-scheduler/src/lib/job-runner.ts#L135-L141).
- Current handling: `CronScheduler` enforces single-worker execution using `RunStore.tryClaim` with `UNIQUE(job_id, scheduled_for)`. The second host encounters `SlotAlreadyClaimedError` and quietly skips.
- Recommendation: Current handling is verified and sound.

---

## Blocking issues

*None.*

---

## Serious issues

*None.*

---

## Moderate and minor issues

### 1. [Moderate] Deferred error candidates are not retried prior to cleanup completion
- File: [`libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:258-267`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L258-L267)
- Scenario: If a transient I/O or locking error occurs when reading a candidate during cleanup, `deferredOnError` increments and the candidate stays as status `candidate`. However, the cleanup cursor advances past it. If no further runs occur after reaching `finishedAt`, the candidate remains in limbo.
- Impact: In production runs on the 2,418 candidate backlog, `deferredOnError` was measured at 0, so this did not manifest. However, if a future candidate hits a transient error, it is never retried unless the cleanup state table is manually reset.
- Fix: When `deleteInvocationsAndComplete()` is called, if cumulative `deferredOnError > 0`, consider resetting `cursorCreatedAt`/`cursorId` to re-attempt deferred candidates, or report `lastOutcome = 'completed-with-deferred'`.

### 2. [Minor] Stale settings keys cannot be purged via CLI `ptah config`
- File: [`libs/backend/platform-core/src/file-settings-keys.ts:233`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/platform-core/src/file-settings-keys.ts#L233)
- Scenario: Settings `skillSynthesis.eligibilityMinTurns` and `skillSynthesis.prefilterMinChars` were removed from known configuration keys in Batch 3.
- Impact: If a user has those keys in their `.ptah/settings.json`, `ptah config` CLI does not know about them and cannot display or clear them.
- Fix: Acceptable and previously noted; Zod settings schemas strip unknown keys safely on load.

---

## Cross-batch interactions checked and found sound

### 1. Manual Promote (B1) × Gate Stages (B4) × Cleanup Rejections (B4/B8/B9)
- **Status check in promotion**: [`SkillPromotionService.runGatePipeline`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts#L223-L225) explicitly checks `candidate.status === 'rejected'` and returns `{ promoted: false, reason: 'already-rejected', candidate }`.
- **Status check in gate stages**: [`SkillStageHandlersService.runJudgePanelStage`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts#L523-L525), `runReplayStage` ([`:601`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts#L601)), and `runTriggerEvalStage` ([`:730`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts#L730)) call `gateTarget(ctx.row)`. If the candidate status is `'rejected'`, each stage returns `{ outcome: 'skipped', reason: 'gate-candidate-rejected' }`.
- **Concurrent cleanup rejection vs promote**: [`SkillBacklogCleanupStore.rejectBatch`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts#L150) uses `UPDATE skill_candidates ... WHERE id = @id AND status = 'candidate'`. A candidate promoted concurrently has `status = 'promoted'`, matching 0 rows, which guarantees that cleanup rejections cannot overwrite user promotion.
- **Session re-open after cleanup rejection**: If cleanup rejects a candidate drafted from session $S_1$, and $S_1$ later re-opens with new user edits:
  - If no work was done, `passesPrefilter` rejects it (`'noWork'`) and enqueues nothing.
  - If the trajectory is identical, `findByTrajectoryHash` finds the rejected row, returns `reused: true`, and downstream gates skip it via `gate-candidate-rejected`.
  - If new work evidence was performed (new edits or tools), `findLatestBySourceSession(sessionId, 'candidate')` returns null (as the previous was rejected), and a fresh candidate is legitimately minted. Verified sound.

### 2. Cleanup Dispositions across Predicate Changes (B4 → B8 → B9)
- **Verdict protection first**: [`SkillBacklogCleanupService.evaluateCandidate`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L308-L315) checks `verdicts.findBySession(sessionId)` first. If present, it immediately returns `kept-verdict` or `kept-degraded-verdict` before performing any filesystem operations.
- **Root-resolved vs by-ID fallback**: If `workspaceRoot` resolves and is attempted, it only falls back to by-ID search if no attempt could be made ([`skill-backlog-cleanup.service.ts:346-353`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L346-L353)).
- **Counter identity holds**:
  $$\text{examined} = \text{keptEvidence} + \text{keptVerdict} + \text{keptDegradedVerdict} + \text{rejectedNoEvidence} + \text{rejectedTranscriptUnreadable} + \text{keptRootUnknown} + \text{deferredOnError}$$
  Every disposition path updates `examined` and exactly one term of the identity sum. `rejectedNoTranscript` is recorded as a report-only subset of `rejectedTranscriptUnreadable`. Verified on the 2,418 candidate dataset.

### 3. Prefilter Evidence (B1) × Non-MCP Tool Count (B8) × Cleanup Predicate
- Single source of truth: [`hasSessionWorkEvidence`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts#L15-L24) in `libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts`.
- Evaluates:
  $$\text{trajectory.editCount} \ge \text{prefilterMinEdits} \lor \text{trajectory.nonMcpToolUseCount} \ge \text{prefilterMinToolUses} \lor \text{trajectory.bashTestPassed} = \text{true}$$
- Both [`SkillSynthesisService.passesPrefilter`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts#L1136) and [`SkillBacklogCleanupService.evaluateCandidate`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts#L335,370) invoke this exact function. No logic drift exists between live synthesis and backlog cleanup.

### 4. Migration 0045 (B2) × Store Writes (B4) × Per-Run Counters (B8/B9)
- Table `skill_backlog_cleanup_state` contains 17 columns defined in [`0045_skill_backlog_cleanup.ts:24-41`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.ts#L24-L41).
- [`SkillBacklogCleanupStore.writeProgress`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts#L197-L220) binds all persisted fields.
- Non-persisted counters (`keptRootUnknown`, `rejectedNoTranscript`, `deferredOnError`) flow through `BacklogCleanupRunCounters` and `BacklogCleanupRunReport` without attempting to alter the frozen schema.

### 5. Dependency Injection & Cross-Host Seams (B5/B9)
- Singletons registered in [`register.ts:67-70`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/di/register.ts#L67-L70): `SkillCandidateStore`, `SkillBacklogCleanupStore`, `SessionTranscriptLocator`, `SkillBacklogCleanupService`.
- Both hosts register the cron job:
  - Electron / VS Code host: [`start-thoth-cron.ts:304-339,531-548`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts#L304-L339)
  - CLI daemon host: [`cli-engine/src/lib/bootstrap/thoth-runtime.ts:571-610,333`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts#L571-L610)
- Candidate namer deletion: Complete; grep for `CandidateNamer` and `CANDIDATE_NAMER` across all libraries and apps returns 0 matches.
- Agent SDK directory listing seam: In [`session-transcript-locator.ts:6-8`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts#L6-L8), `SessionsDirectoryLister` defines an optional structural method `listSessionsDirectories?(): Promise<readonly string[] | null>`. No hardcoded `.claude` or `projects` path literal exists in `skill-synthesis`.

### 6. Purged Settings Keys (B3)
- `eligibilityMinTurns` and `prefilterMinChars` removed from:
  - `libs/backend/skill-synthesis/src/lib/types.ts`
  - `libs/backend/platform-core/src/file-settings-keys.ts`
  - `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
  - `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts`
  - `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`
- Grep across the entire codebase confirmed zero occurrences outside the benchmark comparison in `prefilter-corpus-measurement.spec.ts`.

### 7. Reachability Proof (B6/B7)
- [`skill-synthesis.reachability.integration.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase3-skills-unblock/libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.integration.spec.ts) runs through production DI (`registerSkillSynthesisServices`), real `SqliteConnectionService` through migration 0045, real event callbacks, drain, prefilter, and manual promotion.
- Validated 5/5 passing under both `node:sqlite` and `better-sqlite3` (Electron-as-Node).
- Proved 5 mutation kills (M1-M5) without altering production code.

---

## Data flow

1. **Trigger / Session End**: `SkillTriggerService` receives session end callback $\to$ calls `SkillSynthesisService.enqueueAnalyze(sessionId, workspaceRoot, { turnCount })`. [OK]
2. **Queueing**: `SkillQueueStore.enqueue` inserts stage `'prefilter'` with observed turn count; zero invocation rows written. [OK]
3. **Drain Dispatch**: `SkillDrainService.drain()` claims item, checks budget and battery $\to$ dispatches to `SkillStageHandlersService.runPrefilterStage`. [OK]
4. **Trajectory Extraction**: `TrajectoryExtractor.extract()` extracts turns, counting edits, total tools, and `nonMcpToolUseCount`. [OK]
5. **Prefilter Gate**: `hasSessionWorkEvidence(trajectory, settings)` checks for edits $\ge 1$, non-MCP tools $\ge 2$, or bash test commands. Conversation-only sessions return `noWork` and finish `skipped`. [OK]
6. **Candidate Creation / Reuse**: If evidence passes, `SkillCandidateStore.registerCandidate` inserts candidate without fake invocation; `runPrefilterStage` enqueues downstream gates (`judge-panel`, `trigger-eval`). [OK]
7. **Backlog Cleanup (Cron)**: Hourly job runs `SkillBacklogCleanupService.run()` in pages of 100 up to 200 items/tick. Protected by verdict store check first, root extraction second, and by-ID transcript locator third. Rejects invalid candidates with `AND status = 'candidate'`. [OK]
8. **Promotion**: User triggers `promoteManually` $\to$ bypasses recurrence threshold, passes dedup, judge panel, residency cap $\to$ writes `SKILL.md` $\to$ commits residency demotion $\to$ marks candidate `promoted`. [OK]

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| AC1: Manual Promote bypasses only threshold | COMPLETE | None; verified in `skill-promotion.service.spec.ts` & proof group 5 |
| AC2: Manual path keeps dedup, judge, replay, cap, write gates | COMPLETE | None; residency demotion deferred until after write succeeds |
| AC3: Automatic `evaluate` keeps `below-threshold` | COMPLETE | None; verified in proof group 4 |
| AC4: No invocation row at candidate creation | COMPLETE | None; creation-time `recordInvocation` call deleted |
| AC5: Conversation-only session produces nothing | COMPLETE | None; rejected by `hasSessionWorkEvidence` |
| AC6: Edit-only, tool-only, test-only sessions stay eligible | COMPLETE | None; non-MCP tool evidence narrowed per User Decision 1 |
| AC7: Cleanup rejects no-evidence, no-verdict candidates; keeps rest | COMPLETE | None; Decision 2 (keep root-unknown) and Decision 3 (by-ID lookup) implemented |
| AC8: Cleanup deletes only `context_id IS NOT NULL` invocations | COMPLETE | None; 2,424 deleted on byte copy, tracker rows survived |
| AC9: Cleanup is resumable, gated, bounded | COMPLETE | None; 13 ticks on 2,418 candidates, bounded by 200 items and 60s wall budget |
| AC10: Job registered in Electron and CLI hosts | COMPLETE | None; registered in `start-thoth-cron.ts` and `cli-engine` bootstrap |
| AC11: Gate stages skip rejected candidates | COMPLETE | None; `gateTarget` skips `gate-candidate-rejected` in all gate stages |
| AC12: Candidate namer deleted, DI complete | COMPLETE | None; namer deleted, DI tests pass |
| AC13: Registration seam reaches drain | COMPLETE | None; verified by reachability proof |
| AC14: `degradation-audit:lint` at baseline | COMPLETE | None; exit 0 at baselines across all libs |
| AC15: Measurement report with Component 8 numbers | COMPLETE | None; documented in `backlog-cleanup-measurement.md` |

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Manual promote on already rejected candidate | YES | Returns `{ promoted: false, reason: 'already-rejected' }` | None |
| Manual promote when judge unscored | YES | Returns `{ promoted: false, reason: 'unscored' }`, remains candidate | None |
| SKILL.md write fails during promotion | YES | Returns `write-failed`, candidate remains `candidate`, residency demotion reverted | None |
| Session has $\ge 2$ MCP tools but 0 non-MCP tools | YES | Rejected by `hasSessionWorkEvidence` | None |
| Candidate workspace root cannot be resolved | YES | Looks up transcript by session ID across live project folders | None |
| Transcript absent from all project folders | YES | Rejected with distinct reason `backlog-cleanup: no transcript found for any session` | None |
| Candidate promoted while cleanup batch is in-flight | YES | `WHERE id = @id AND status = 'candidate'` matches 0 rows; promotion preserved | None |
| Cleanup tick interrupted by abort signal or wall budget | YES | Returns `partial`, writes progress, resumes from cursor on next tick | None |
| Concurrent cleanup invocation by two hosts | YES | `CronScheduler` claims slot via `UNIQUE(job_id, scheduled_for)` | None |
| Candidate ID contains path traversal (`..` or `/`) | YES | Rejected by `isSafeSessionId` in locator before file operations | None |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: Candidates whose evaluation threw an unexpected error are deferred from rejection while the cursor advances past them; they will not be re-evaluated unless cleanup state is manually cleared.
- What a robust implementation would add:
  1. A post-cleanup reconciliation sweep for any candidate where `deferredOnError > 0`.
  2. Persistent tracking of `keptRootUnknown` and `rejectedNoTranscript` counters in a future schema migration.
  3. Narrowing tool evidence in Phase 5 from Read/Grep tools to mutating tools only.
