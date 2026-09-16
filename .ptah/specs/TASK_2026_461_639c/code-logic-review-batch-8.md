# Code Logic Review — Batch 8 (Tasks 8.1 / 8.2) — `TASK_2026_461_639c`

Scope: uncommitted worktree diff on top of HEAD `4b8e4de87` in
`D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock`.
Reviewed via `git diff` / `git status --short` (read-only; no edits, no tests run,
no spawned lanes).

## Verdict

**APPROVED**

Score: **9/10**

Both tasks implement exactly the two binding decisions, with counters that stay
internally consistent across every report path (`run` success, `finishPartial`,
the caught-error `failed` report, and the thoth-runtime job summary), a hash that
is provably unaffected by the new field, and test fixtures that exercise the real
production predicate (`SkillSynthesisService.passesPrefilter`) rather than a
shadow reimplementation. No blocking or serious defects found. Two minor
observations below are pre-existing behaviour, not regressions introduced by this
batch.

## Five logic questions

### 1. How does this fail silently?

Nothing found that turns a real failure into a silent success. `kept-root-unknown`
looks superficially like a place where "we couldn't tell" could be miscoded as "we
verified" (matching the shape of a swallowed error), but it is a distinct,
labelled disposition (`skill-backlog-cleanup.service.ts:55,316-320`), it is
excluded from `countDisposition` (`:414-427`, no branch matches
`'kept-root-unknown'`), and it is surfaced in every report (`runCounters`,
`:429+`) and in the cron job's human-readable summary
(`skill-backlog-cleanup-job.ts:88`, "root unknown N"). A reviewer or operator
reading the summary sees the count; it is not hidden inside "kept".

### 2. What user action produces unexpected behaviour?

None identified from this batch specifically. The nearest candidate — a
Read/Grep/Glob-only session now clearing `prefilterMinToolUses` purely on
non-MCP tool count with zero edits — is **unchanged behaviour**: those tool
names never started with `mcp__`, so they contributed to the pre-batch
`toolUseCount` exactly as they now contribute to `nonMcpToolUseCount`
(`trajectory-extractor.ts:357-361`, `trajectory-extractor.spec.ts:101-115`,
which literally uses `Read`/`Grep` as the non-MCP fixture). The batch tightens
MCP-heavy sessions; it does not loosen anything for tool-only sessions that were
already eligible. Flagged under "what's missing" below rather than as a defect.

### 3. What input data produces a wrong answer?

- A `tool_use` block whose `name` is missing or non-string is treated as
  non-MCP (`toolName = typeof block.name === 'string' ? block.name : ''`, then
  `''.startsWith('mcp__') === false`) — this matches decision 1 exactly and is
  pinned by `trajectory-extractor.spec.ts:118-137`.
- A backlog candidate with `sourceSessionIds: []` reaches the second loop with
  zero iterations (`readable=false`, `attempted=false`) and returns
  `'kept-root-unknown'` (`skill-backlog-cleanup.service.ts:290-320`), matching
  decision 2's "empty sourceSessionIds → kept-root-unknown" exactly, pinned at
  `skill-backlog-cleanup.service.spec.ts:365-380` (report asserts
  `keptRootUnknown: 1`, `extractor.extract` not called).

No case found where these inputs produce a wrong count.

### 4. What happens when a dependency fails?

- `TrajectoryExtractor.extract` throwing (not returning `null`) inside
  `evaluateCandidate` propagates out of the function and is caught one level up
  in `execute()`, which assigns `disposition = 'deferred-error'` and increments
  `progress.deferredOnError` (`:200-212`) — this path is untouched by the batch
  and stays distinct from the new `kept-root-unknown` disposition, so a thrown
  read is never miscounted as "root unknown".
- `SkillQueueStore.findBySessionStage` returning a row with no
  `workspaceRoot` still yields `workspaceRoot = undefined` via the ternary at
  `:294-297`, so that session is skipped (`continue`) exactly as before; this is
  pre-existing and not a regression.

### 5. What is missing that the requirements never mentioned?

- The decision narrows *which tools* count (non-MCP only) but not *what those
  tools do*. A session with two `Read`/`Grep` calls and zero edits, zero tests,
  still counts as "work evidence" under both the old and the new predicate. If
  the intent behind decision 1 was "only tools that produce durable change,"
  that gap survives this batch — but it is explicitly out of scope per the
  decision text ("threshold stays 2; edit and test evidence unchanged") and is
  not something this batch broke.
- No production code path currently *reports* `keptRootUnknown` anywhere a human
  would see it besides the log line and the RPC/report object — there is no
  telemetry alarm if the root-unknown count grows unexpectedly large over many
  runs (e.g., a systemic bug elsewhere causing candidates to never carry a
  workspace root). Given the counter is explicitly "report-only" per the
  decision, this is acceptable, not a gap in this batch's scope.

## Failure modes

No new failure mode was found that the code does not already handle correctly.
Scope examined: `trajectory-extractor.ts` (`collectToolSignals`, `extract`),
`session-work-evidence.ts`, `skill-backlog-cleanup.service.ts` (`evaluateCandidate`,
`execute`, `run`, `finishPartial`, `runCounters`, `countDisposition`),
`skill-backlog-cleanup.types.ts`, `skill-backlog-cleanup-job.ts`, and all touched
spec files. Residual uncertainty: I did not execute the suites myself (a
senior-tester process may be running measurements in the same worktree per the
task's own constraint); the analysis above is from static reading of the diff
against the batch-8-report.md's recorded green runs, not a re-execution.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### M1 (minor): Read/Grep-only sessions still count as "work evidence" (pre-existing, not a regression)

- File: `libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts:20-24`, `libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts:355-362`
- Scenario: a session that only reads/greps the workspace twice, makes no edits and runs no tests, still passes `hasSessionWorkEvidence` because `Read`/`Grep`/`Glob` are non-MCP tool names.
- Impact: low — unchanged from before this batch (those tools already contributed to the un-tightened `toolUseCount`). Worth a note in `CLAUDE.md` if the eventual intent is "real work," but not a defect of 8.1/8.2.
- Fix: none required for this batch; if desired, a future task should narrow the tool allowlist rather than just the MCP exclusion.

### M2 (minor): No cross-run visibility on `keptRootUnknown` growth

- File: `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.types.ts:27-33`
- Scenario: if a future regression stops resolving workspace roots for a broad swath of candidates, each run's `keptRootUnknown` is reported but never accumulated or alarmed on since it is deliberately non-persisted.
- Impact: low — this is exactly what the frozen-migration decision asked for (report-only, not persisted); flagged only as an observability gap, not a logic defect.
- Fix: none required; out of scope per binding decision 2.

## Data flow

### 8.1 — non-MCP tool counting

1. `TrajectoryExtractor.extract` iterates `messages` (both roles, no role filter) → OK.
2. For each message, `collectToolSignals` is called once and populates `editCount`, `toolUseCount`, `nonMcpToolUseCount`, `bashTestPassed` from the SAME `content` array and the SAME `block.type !== 'tool_use'` filter (`trajectory-extractor.ts:349-368`) → OK, no drift between the two counters possible.
3. `toolName` normalizes missing/non-string names to `''`; `''.startsWith('mcp__')` is `false`, so it increments `nonMcpToolUseCount` → OK, matches decision 1's "missing/non-string names count as non-MCP."
4. `ExtractedTrajectory.nonMcpToolUseCount` is returned; hash is computed earlier and independently over `turns` text only (`:219-232`), never touching tool counts → OK, hash unaffected as decided.
5. `hasSessionWorkEvidence` reads `trajectory.nonMcpToolUseCount >= thresholds.prefilterMinToolUses` in place of the old `toolUseCount` comparison (`session-work-evidence.ts:20`) → OK, single call site, no other consumer of the old field for eligibility found besides display/telemetry.
6. Consumers (`skill-synthesis.service.spec.ts`, `.enqueue.spec.ts`, `skill-synthesizer.service.spec.ts`, gate specs, archaeology specs) all add `nonMcpToolUseCount` to their `ExtractedTrajectory` fixtures with the same value as `toolUseCount` where no MCP tool is implied → OK, type-checks and preserves each spec's original intent.
7. The corpus harness recomputes `phase3UntightenedEligible` from a locally re-stated (non-production) predicate — deliberate, matching the file's own stated pattern for the phase-2 predicate — and computes `mcpOnlyRejected = u && !n` and the corrected `phase2DepthOnly = o && !u` (previously `o && !n`, which would have conflated the MCP tightening with the depth-branch removal) → OK, and it is a genuine correctness improvement over the prior formula, kept behind `PTAH_PREFILTER_CORPUS=1` (`prefilter-corpus-measurement.spec.ts:44`) → OK, opt-in preserved.

### 8.2 — root-unknown backlog disposition

1. `evaluateCandidate` first checks every source session for an existing verdict; any hit returns early (`kept-verdict`/`kept-degraded-verdict`) before `attempted`/`readable` are touched → OK, verdict early-return unchanged.
2. Second loop: `attempted` starts `false`, flips `true` only immediately before `extractor.extract` is called, which only happens once a `workspaceRoot` is resolved (candidate-level or via the prefilter queue row) → OK, matches "attempted set only when extract is actually called."
3. Loop exhausted with `readable=false, attempted=false` → `'kept-root-unknown'` (covers empty `sourceSessionIds` and "every session resolves no root") → OK, matches decision 2.
4. Loop exhausted with `readable=false, attempted=true` → `'reject-unreadable'` (covers "mixed no-root + failed read", proven by `skill-backlog-cleanup.service.spec.ts:285-317` where session 1 has no root and session 2 resolves a root but its read is stubbed to fail) → OK.
5. `readable=true` at any point and no evidence found by loop end → `'reject-no-evidence'` → OK, unchanged.
6. `'kept-root-unknown'` bumps `progress.keptRootUnknown` (`:213-215`) but is a no-op in `countDisposition` (`:414-427`), so it never reaches `BacklogCleanupCounters`/persisted state → OK, matches "keptRootUnknown never reaches persisted counters."
7. `increments.examined++` runs unconditionally per candidate regardless of disposition (`:222`), so the cursor (`state.cursorCreatedAt`/`cursorId` written from `page[processed-1]`, `:238-247`) advances past root-unknown candidates exactly like any other disposition → OK, matches "cursor still advances."
8. All four report-construction sites (`run`'s catch block `:147`, `finishComplete`'s `:371`, `finishPartial`'s `:398`) spread `this.runCounters(progress, ...)`, which always includes `keptRootUnknown` → OK, whole-run-failed and partial reports both carry it.
9. `skill-backlog-cleanup-job.ts:88` appends `root unknown ${report.keptRootUnknown}` to the human summary → OK, pinned by `skill-backlog-cleanup-job.spec.ts`.
10. Integration spec constructs a real SQLite-backed candidate (`root-unknown`, `workspaceRoot: null`, session `root-unknown-session` with no `queue.enqueue` call and no `verdicts.save`/`recordDegraded` call for it) — confirmed by reading the harness setup: no `queue.enqueue({sessionId: 'root-unknown-session', ...})` and no verdict registration exist anywhere in the spec — so the assertion `keptRootUnknown: 1` and `byId.get('root-unknown')?.status === 'candidate'` is not vacuous; it exercises a candidate that genuinely has neither a prefilter queue row nor a verdict → OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 8.1: `nonMcpToolUseCount` computed identically to `toolUseCount` (same blocks, same messages) | COMPLETE | none |
| 8.1: missing/non-string tool names count as non-MCP | COMPLETE | none |
| 8.1: threshold unchanged, edit/test evidence unchanged | COMPLETE | none |
| 8.1: every `ExtractedTrajectory` consumer still type-checks/behaves the same; hash unaffected | COMPLETE | none (verified hash computed from turn text only, before the counters are even finalized) |
| 8.1: corpus harness counts `phase3UntightenedEligible`/`phase3Eligible`/`mcpOnlyRejected`, opt-in preserved | COMPLETE | none |
| 8.2: `attempted` set only when extract is called; verdict early-return unchanged | COMPLETE | none |
| 8.2: empty `sourceSessionIds` → kept-root-unknown; mixed no-root+failed-read → reject-unreadable; readable-without-evidence → reject-no-evidence | COMPLETE | none |
| 8.2: `keptRootUnknown` never persisted; cursor still advances; reports/cron summary carry it | COMPLETE | none |
| 8.2: integration spec assertion not vacuous | COMPLETE | none |
| No trademarked product names added to `apps/ptah-docs` | COMPLETE | none — `settings.md` diff only adds "non-MCP" |
| Migration 0045 / `SkillBacklogCleanupStore` frozen | COMPLETE | confirmed via `git status` — no `libs/backend/persistence-sqlite` changes present |

Implicit requirements not addressed: none found beyond the minor observability
note (M2), which the decision explicitly puts out of scope.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| MCP-only session (all tool_use names `mcp__*`) | YES | `nonMcpToolUseCount` stays 0, evidence fails | none |
| Mixed MCP + non-MCP tools, non-MCP count below threshold | YES | rejects, pinned at `session-work-evidence.spec.ts:73-79` | none |
| `tool_use` block with missing/non-string `name` | YES | counted as non-MCP, pinned at `trajectory-extractor.spec.ts:118-137` | none |
| Backlog candidate with `sourceSessionIds: []` | YES | `kept-root-unknown`, pinned at `skill-backlog-cleanup.service.spec.ts:365-380` | none |
| One session with no root + one session with a root whose read fails | YES | `reject-unreadable` (attempted=true wins), pinned at `:285-317` | none |
| Real SQLite candidate with NULL `workspace_root`, no queue row, no verdict | YES | integration spec, `keptRootUnknown: 1`, status stays `candidate` | none — confirmed non-vacuous |
| Mutation 8.1-mut (`toolUseCount` swapped back in) | YES | report documents 2 failing assertions restored to 11/11 passing | plausible from source; matches the two MCP-specific tests added |
| Mutation 8.2-mut (`readable ? reject-no-evidence : reject-unreadable`, dropping the `attempted` branch) | YES | report documents 3 failing assertions restored to 17/17 passing | plausible from source — with the mutation, the root-unknown candidate (readable=false) falls to `reject-unreadable` instead of `kept-root-unknown`, exactly matching the report's "Expected keptRootUnknown: 1; Received: 0" |

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: none blocking; the only residual risk is scope-external (M1) — non-MCP tool evidence still accepts read-only sessions with no durable change, which was true before this batch and is unaffected by it.
- What a robust implementation would add: a future pass narrowing "work evidence" to tools that mutate the workspace or run tests (not just any non-MCP tool), and/or lightweight telemetry on `keptRootUnknown` trend across runs — both explicitly out of scope for this batch's binding decisions.
