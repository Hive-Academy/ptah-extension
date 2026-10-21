# Code Logic Review - `TASK_2026_662_3eea` (Phase A, batches 1-15)

Review family: implementer codex (backend) + Glm/Ollama (UI batches 7, 11); reviewer Claude subagent (third family).
Scope: `git diff 271198ced..fd0110afc -- libs apps`, read in the worktree. No source edited, no state-changing git. No test run (static trace only).

## Summary

| Metric              | Value                         |
| ------------------- | ----------------------------- |
| Overall score       | 6/10                          |
| Assessment          | NEEDS_REVISION (verdict: REVISE) |
| Blocking issues     | 0                             |
| Serious issues      | 3                             |
| Moderate issues     | 9                             |
| Failure modes found | 12                            |

Score basis: the storage layer (0056, event store, grade store, archive) is carefully built and the null-not-zero rule holds on the new surfaces. 6 rather than 7 because the central new feature (a success signal from task-folder reviews) does not parse the review format this repository actually produces, and two Phase-A write paths diverge from their readers. Not 4: nothing corrupts data, nothing kept is deleted, and 0057 is correctly dormant.

## Five logic questions

### 1. How does this fail silently?
- Review verdicts: `parseReviewVerdict` (`spec-extractor.ts:95-120`) accepts only `Verdict|Review status|Status: <word>` or a heading followed by a bare terminal word, with terminal words pass/passed/approved/complete/success and fail/failed/rejected/revise (`:76-81`). The repo's real reviews say `Recommendation: APPROVE` / `REVISE` / `NEEDS_REVISION`. In `.ptah/specs` I counted about 25 `- Recommendation: APPROVE`, 19 `- Recommendation: REVISE` and 6 `**Recommendation**: APPROVE` lines in `code-*-review.md`. None would parse. `parseReviewVerdict` returns null, `reviews` stays empty, and `writeGrades` (`spec-harvester.service.ts:164-178`) falls through to `if (!verdict) continue`. The marker is written anyway (`:134`), so the task is recorded as harvested with no grade and no diagnostic (diagnostics are only pushed for `.json`, `spec-extractor.ts:~262`).
- `fields.at(-1)` (`spec-extractor.ts:111`) keeps only the LAST `verdict:/status:` line. A later non-terminal line (`**Verdict: the mapping is correct**`, or `status: open` in a finding) hides an earlier real verdict. A stray `Status: complete` flips to a false pass.
- Settings: after the one-time copy, the settings UI still writes `skillSynthesis.judgeProvider/judgeModel/enhanceTimeoutMs` (`skill-synthesis.service.ts:1619-1630`, `providers-commit.service.ts:158-160`, `skills-synthesis-rpc.schema.ts:88-90`), while the enhancer reads only `skills.enhancement.*` (`skill-enhancer.service.ts:~833-872`). The edit saves successfully and is ignored.
- `getRecentFindings`/`removeAbsent` can drop grades quietly; see failure modes.

### 2. What user action produces unexpected behaviour?
- Opening the Library: every skill/command clone with invocations shows a 0% success rate (see Serious 2).
- Changing the enhancement provider/model/timeout in Settings after first boot: no effect (Serious 3).
- Using a slash command during a lane run: it is no longer listed in the run's skill scope (Moderate 3).
- Editing a clone between Preview and Save: handled, `stale-source` refuses the write, but the user sees "Invalid params" code (Minor).

### 3. What input data produces a wrong answer?
- Mixed-case or multi-`status:` review files (above).
- A task with a COMPLETE batch plus a rejected review: grade is `pass`. This follows the plan precedence (plan :107), but the conflict gate at `spec-harvester.service.ts:171-174` runs first, so conflicting reviews DROP the grade even when an explicit batch verdict outranks them.
- Windows/POSIX path spelling: `workspaceRoot = join(specsRoot,'..','..')` (`spec-harvester.service.ts:150`) is compared by exact SQL equality (`skill-task-grade.store.ts:113,116,124,148`) to `workspace_root` stored from hook payloads. A trailing slash, forward slashes or drive-letter case difference yields zero attributions and no grade.
- A generic review with no run or session id (`code-style-review.md`) is attributed to every unique agent slug in the task (`spec-harvester.service.ts:167`). One task-level REVISE then fails every agent, including ones unrelated to the finding. This is a design choice, but it is not called out in the plan or UI.

### 4. What happens when a dependency fails?
- Grade store failure in `findAttributions`: logged with `error.name` only, returns early, marker still written (`spec-harvester.service.ts:152-158,134`). The task stays ungraded until the artifact digest changes; there is no retry. Moderate.
- Archive preflight failure: fatal by design for versions >= 57 (`migration-runner.ts:138`), correct. Not yet reachable (0057 not registered).
- Settings migration write failure: warns and continues, in-memory migrated values are used for this process only (`file-settings-manager.ts:~549-559`). OK.
- Enhancer auth failure: provider-unreachable skip, logged without the message (decision O3). Judged below.

### 5. What is missing that the requirements never mentioned?
- No telemetry when reviews parse to nothing (counter or warn per task), so the format gap above cannot be seen.
- No lock around the `loadSync` settings rewrite (cross-process).
- No retention for repeated archive directories if migration 57 keeps failing after the archive.
- No test that parses a real `code-logic-review.md` from `.ptah/specs`.

## Failure modes

### Real-world review formats produce no grade
- Trigger: any task whose review files use `Recommendation: APPROVE|REVISE|NEEDS_REVISION`.
- Symptom: scorecards stay "No grade"; the success signal the epic exists to add is absent for most tasks.
- Evidence: `spec-extractor.ts:76-81,108-116`; real files e.g. `TASK_2026_251/code-logic-review.md:241`, `TASK_2026_239/code-logic-review.md:264`.
- Current handling: silent skip.
- Recommendation: add `recommendation|assessment|overall` as field names, accept `approve|needs[_ -]revision|revise`, prefer the verdict inside the `## Verdict` section, warn once per task when a `*-review.md` yields no verdict.

### Last-match-wins verdict extraction
- Trigger: review text with more than one `verdict`/`status` line.
- Evidence: `spec-extractor.ts:109-111`.
- Recommendation: scan matches from the end for the first terminal one, or restrict to the `## Verdict` section.

### Enhancement settings diverge after migration
- Trigger: user edits judge provider/model/timeout after the first `loadSync` copy.
- Evidence: writers `skill-synthesis.service.ts:1619-1630`, `providers-commit.service.ts:158-160`; reader `skill-enhancer.service.ts:~833-872`. Batch 17 (UI) is the planned fix.
- Recommendation: dual-write in `saveSettings` until batch 17, or make the enhancer fall back to the old key until it is removed.

### Ungraded events read as 0%
- Trigger: any skill/command clone with events (recorder writes `succeeded` NULL, `skill-invocation-recorder.ts:~57`).
- Evidence: `skills-synthesis-rpc.handlers.ts:2311-2314` computes `stats.succeeded / stats.total`; `skill-candidate.store.ts:1462` is `COALESCE(SUM(succeeded),0)`, so NULL rows give `0 / n = 0`. The UI renders it as `0%` (`clone-action-gating.ts:255-260`; only a null renders "No grade").
- Current handling: `null` only when `total === 0`.
- Recommendation: batch 22 must land before any Phase A build ships, or compute the rate from `SkillTaskGradeStore.getAggregates` now.

### Conflict gate outranks batch and lane verdicts
- Evidence: `spec-harvester.service.ts:170-174` vs `:176-178`. Grade skipped and then pruned by `removeAbsent` (`:189`).
- Recommendation: evaluate conflict only when the verdict comes from `review`.

### Legacy reconcile writes the grade into `is_error`
- Evidence: `spec-harvester.service.ts:122` (`isError: batch.status === 'FAILED'`) into `skill-candidate.store.ts:1430-1436` (`SET is_error = ?`). A subagent run that really errored (is_error=1 from SubagentStop) is reset to 0 by a COMPLETE batch, and a clean run becomes is_error=1 by a FAILED one. Batch 4 made `is_error` independent of grade at write time; this still-live path re-couples them.
- Recommendation: stop passing `isError` (keep the existing value) in `applyReconciliation`.

### Re-harvest can erase backfilled grades
- Trigger: a legacy marker (version 0/absent digest) causes re-harvest (`:112`); `findAttributions` only returns events whose slug exists in `skill_registry` with the matching kind (`skill-task-grade.store.ts:109-112`). If the registry lacks the agent, `keep` is empty and `removeAbsent` (`:146-154`) deletes the 0056 backfill rows for that task (same `workspace_root`).
- Uncertainty: depends on whether built-in agents are in `skill_registry`; not verified.
- Recommendation: never delete rows whose `evidence_source` starts with `spec:` (backfill), or skip `removeAbsent` when attributions are empty.

### Slash commands dropped from scope lookup
- Evidence: `skill-invocation-event.store.ts:108` and `skill-candidate.store.ts:1661` filter `source IN ('tool-use','prompt-expansion')`; `skill-trigger.service.ts:693` now writes `slash-command`.
- Recommendation: add `'slash-command'` to both filters.

### Unlocked settings.json rewrite
- Evidence: `file-settings-manager.ts:~538-560` reads, rewrites and renames without the manager's write queue or a cross-process lock. A concurrent `set` from another host between read and rename is lost. Bounded: happens once per file, only when an old key exists without the new one.

### Archive hardening gaps
- Evidence: `skill-pipeline-archive.ts:43-46,57,~96` use POSIX modes; on Windows `0o700/0o600` do nothing, so the archive (candidate bodies) relies on home-directory ACLs. A new `pre-0057-*` directory is created on every attempt (`:45`), and also on a fresh install with empty tables. The window between archive and the 0057 transaction is not locked against another host writing.

### Grade store failure leaves task un-retried
- Evidence: `spec-harvester.service.ts:152-158` then `:134` writes the marker with the same digest. Fix: skip `writeMarker` when attribution lookup threw.

### Scorecard misses agents with grades but no events
- Evidence: `skill-scorecard.service.ts:56` iterates `aggregates` (event-derived) only; slugs in `grades` without events never get a scorecard. Minor in practice (lane-only grades).

## Blocking issues

None.

## Serious issues

### S1. The review-verdict parser does not recognise this repository's review format
- File: `libs/backend/skill-synthesis/src/lib/spec-extractor.ts:76-81,108-120`
- Scenario: harvest of any done task whose `code-logic-review.md`/`code-style-review.md` ends with `Recommendation: APPROVE|REVISE|NEEDS_REVISION`.
- Impact: acceptance criterion "success signal from task-folder reviews" is met only for `judge-round-*.json` and the few files with a literal `Verdict:` line. Grades silently absent; no diagnostic.
- Fix: widen field names and terminal words, anchor to the `## Verdict` section, add a spec that parses real files from `.ptah/specs`, and log a diagnostic when a review file has no verdict.

### S2. CloneSummary success rate shows 0% for ungraded skills and commands
- File: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2311-2314` (with `skill-candidate.store.ts:1462`)
- Scenario: Phase A is live, events are written with `succeeded` NULL, so `succeeded = 0` and `total > 0`.
- Impact: every invoked clone card says `0%`, which is exactly the "turn NULL into 0%" failure. Batches.md (:189) records the `=== 1` interim for per-event views but not this user-facing figure; the fix is only planned in batch 22 (:790).
- Fix: read `SkillTaskGradeStore.getAggregates(kind, slugs)` here now, or return null whenever `succeeded + failed < total`.

### S3. Enhancement settings are read from keys the settings UI does not write
- File: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:~833-872` vs `skill-synthesis.service.ts:1619-1630`
- Scenario: any settings change to judge provider/model/timeout after the one-time copy.
- Impact: save reports success, behaviour unchanged. Same shape for `skills.telemetry.enabled`, which nothing reads yet (`skill-trigger.service.ts:1099` still uses the old key; consistent but the new key is a dead write target).
- Fix: dual-write until batch 17, or fall back to the old key in the enhancer.

## Moderate and minor issues

1. `spec-harvester.service.ts:171-174` conflict check precedes batch/lane precedence (Moderate).
2. `spec-harvester.service.ts:122` legacy reconcile overwrites `is_error` (Moderate).
3. `skill-invocation-event.store.ts:108`, `skill-candidate.store.ts:1661` omit `slash-command` (Moderate).
4. `spec-harvester.service.ts:150` vs `skill-task-grade.store.ts:113`: workspace root compared as raw strings (Moderate; normalise both sides with the same helper).
5. `skill-task-grade.store.ts:146-154` prunes backfilled rows on re-harvest (Moderate, see above).
6. `spec-harvester.service.ts:152-158,134` marker written after a failed attribution (Moderate).
7. `skill-enhancer.service.ts:459-463,981-984`, `:560-564`: decision O3 is correct for the auth site (`:~885`), where the provider and slug are still logged. It is over-applied: the "proposal generation failed" and "candidate generation failed" warns lost the error entirely, and those paths (judge, file I/O, SDK) carry no credentials. Log `error.name` plus a sanitised code there (Moderate).
8. `file-settings-manager.ts:~538-560` unlocked rewrite (Moderate).
9. `skill-pipeline-archive.ts:43-57`, `migration-runner.ts:113-127` Windows modes, directory accumulation (Moderate).
10. `skills-synthesis-rpc.handlers.ts:~1467` stale draft is reported as `INVALID_PARAMS`; a dedicated code in `rpc-error-codes.types.ts` would let the UI offer "re-preview" (Minor).
11. `skill-enhancer.service.ts:1236-1257` `draftDiff` emits a lone `-` line when only additions exist (empty string splits to `['']`); and the draft returns up to 1600 chars each of trajectory/findings to the webview (Minor).
12. `spec-extractor.ts` plan filter `/plan|architecture/i` on the file name (`spec-harvester.service.ts:167`) also excludes names such as `explanation-review.md` (Minor).

## Data flow

Write path, hook to rate:
1. Hook payload to `SkillTriggerService` (`skill-trigger.service.ts:591-700`): OK, `isError` from tool success, never a grade.
2. `SkillInvocationRecorder.recordSkillEvent` (`skill-invocation-recorder.ts:46-60`): OK, `succeeded: null`, source `slash-command` for slash commands.
3. `SkillInvocationEventStore.recordSkillEvent` (`:57-75`): OK, NULL preserved; schema NULLable via 0056.
4. Migration 0056 (`0056_skill_nullable_grades.ts:33-47`): OK, unreconciled rows become NULL/0; all six indexes recreated; backfill (:72-97) limited to exact `spec:<task>` subagent rows with unique task/slug/run.
5. `SpecHarvesterService.harvest` (`:102-146`): GAP, S1 (no verdict parsed), conflict ordering, marker after failure.
6. `SkillTaskGradeStore.findAttributions/upsert/removeAbsent` (`:77-154`): GAP, string workspace equality, pruning of backfill.
7. `SkillScorecardService` (`:50-109`): OK, sole rate source is the grade store; null when graded = 0; store errors degrade to unmeasured, not 0.
8. Scorecard UI (`scorecard-badge.component.ts:~100-115`, `scorecard-detail.component.ts`, `agent-outcome-signals.ts`): OK, `null` renders "No grade", `succeeded === true/false` checks.
9. CloneSummary (`skills-synthesis-rpc.handlers.ts:2311`): GAP, S2.
10. Enhancement preview/save (batch 10): OK. Hash is computed from the same `readFile(..., 'utf8')` text on both sides (`skill-enhancer.service.ts:401,460` and `user-layer-mirror.service.ts:~709,~805`), compared inside `withSlugLock`; preview writes nothing to the clone (it caches a proposal in memory only); `expectedSourceHash` is validated by regex.
11. Archive (batch 15): OK, owner-only on POSIX, fsync, rereads receipt, fatal before version >= 57; 0057 not in `migrations/index.ts` so dormant.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 1 nullable grades + `skill_task_grades` backfill | COMPLETE | none found |
| 2 settings copy to `skills.enhancement.*` | PARTIAL | UI writers still old keys (S3); unlocked rewrite |
| 3 event store | COMPLETE | `slash-command` missing from scope filter |
| 4 succeeded NULL, `slash-command`, `isError` independent | PARTIAL | legacy reconcile still writes `is_error` from grade |
| 5 scorecard sole rate source | PARTIAL | CloneSummary still event-derived (S2, batch 22) |
| 6 review-derived grades, marker, containment, bounded reads | PARTIAL | containment and size caps good; verdict parser S1 |
| 7, 8, 11 UI null semantics | COMPLETE | none found |
| 9 enhancer reads new keys, pause gate | COMPLETE | O3 over-applied (Moderate 7) |
| 10 stale-hash save, preview writes nothing | COMPLETE | error code choice |
| 12, 13, 14 skills-root, tracker, verdict store | COMPLETE | `start()` is called by `memory-retention-job` (`thoth-runtime/.../memory-retention-job.ts:~130`), so the tracker stays live once the drain is removed |
| 15 archive + fatal preflight | COMPLETE | hardening notes only |

Implicit requirements not addressed: observability for unparseable reviews; real-format parser fixture; migration of writers before readers.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Symlinked or oversize artifact | YES | `realpath` containment, 256 KiB cap, 64 file cap (`spec-extractor.ts:~215-250`) | none |
| Malformed `judge-round-*.json` | YES | try/catch, object check, task id mismatch diagnostic | none |
| Review for a different task id | YES | diagnostic, excluded | none |
| Marker revised after harvest | YES | digest compare re-harvests | stale marker still marks spec `harvested` for clear-stale |
| Duplicate agent runs in one task | YES (conservative) | siblings count gates review/batch | under-grades |
| 0056 on unreconciled/reconciled mix | YES | CASE keeps verdicts only when reconciled | none |
| Concurrent harvests | PARTIAL | upsert idempotent, atomic marker rename | no lock; `removeAbsent` may race `upsert` |
| Ungraded NULL end to end | MOSTLY | scorecards and UI correct | CloneSummary 0% (S2) |

## Verdict

- Recommendation: REVISE (Verdict: REVISE)
- Confidence: MEDIUM-HIGH (static trace, whole files read for the grade store, event store, harvester, extractor parser, scorecard service, migration, archive; migration-runner and UI read by diff plus targeted sections; no tests executed).
- Top risk: the review parser silently yields no grades for the review format the repo actually writes, so the epic's new success signal would be mostly empty.
- What a robust implementation would add: a verdict parser tested against real `.ptah/specs` reviews with a no-verdict diagnostic; CloneSummary rates read from `skill_task_grades` before ship (or dual-written settings keys until batch 17); precedence applied before the conflict gate; `is_error` left alone by legacy reconcile; `slash-command` in scope filters; a shared workspace-root normaliser; `removeAbsent` that spares backfill rows; error names (not messages) in the two over-trimmed warns.
