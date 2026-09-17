# Code Logic Review — Batch 5, `TASK_2026_461_639c`

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock` (branch `feat/task-439-phase3-skills-unblock`, HEAD `bb887ef40`). Batch 5 changes are uncommitted.

## Verdict

**APPROVED** — score **9/10**

No blocking and no major findings. Three minor findings, all documentation or test-precision items. The tribunal's exact defect (guard silently skipping the job in a real host) does not occur: both hosts register `SKILL_BACKLOG_CLEANUP_SERVICE` before cron start.

## Evidence basis

A peer session on this machine ran performance measurements during this review. The continuation brief therefore banned all test/build processes. Evidence split:

**Verified by reading code, git and grep (this review):**
- Every production file changed in Batch 5, read in full or in the relevant range.
- The handler contract (`skill-backlog-cleanup-job.ts`), both registration functions, both specs, DI `tokens.ts` / `register.ts` / `register.spec.ts`, the deleted-namer greps, both `CLAUDE.md` files, and the docs page.
- Registration ordering in both real hosts (citations below).
- All production cron expressions, for the minute-collision check.
- The `skillSynthesis.*` key count in `FILE_BASED_SETTINGS_KEYS` (finding 3).

**Accepted from `batch-5-report.md`, not independently re-run:**
- The full `run-many` test/typecheck/lint totals, the XB1 both-bindings runs (80/80), and the XB2 degradation-audit output. Structurally plausible and consistent with the spec files read.
- The AC10-mut-E and AC10-mut-C mutation fail/restore outputs. I verified by reading that both specs assert the `@ptah/skills-backlog-cleanup` upsert against the **real** `startThothCron` / `activateThoth` calls, so removing the production registration call must fail them; the pasted failure outputs match that structure.

**Run by this reviewer before the test ban arrived** (disclosed for completeness; no test process was started after the ban): the three focused spec suites — thoth-runtime `skill-backlog-cleanup-job|start-thoth-cron` (39 passed), cli-engine `thoth-runtime.spec` (23 passed), skill-synthesis `register.spec|skill-candidate.store` (89 passed). All green, matching the report.

## Check results (brief items 1–7)

### 1. Reachability on production boot paths — CONFIRMED

- Electron/shared runtime: `startThothCron` calls `registerSkillBacklogCleanupJob` at `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:532`, inside the `CRON_JOB_STORE && CRON_HANDLER_REGISTRY` guarded block, wrapped in its own non-fatal try/catch — same shape as every sibling block. The spec (`start-thoth-cron.spec.ts:1032-1094`) drives the real `startThothCron`, not a helper.
- CLI: `startCron` calls `registerSkillBacklogCleanupJob(container, logger)` at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:333`, after `registerMemoryRetentionJob` (`:332`). The spec (`thoth-runtime.spec.ts:737-780`) drives the real `activateThoth`, which reaches `startCron` at `:137` on the non-`oneshot` tier.

### 2. Guard cannot silently skip in a real host — CONFIRMED (the tribunal's defect does not recur)

The guard is `container.isRegistered(...)` only (`start-thoth-cron.ts:311-317`; `cli-engine thoth-runtime.ts:576-584`) — no service resolution, no SQL at registration. For the guard to be true at cron start, `SKILL_BACKLOG_CLEANUP_SERVICE` must already be registered:

- **Electron**: `registerSkillSynthesisServices(container, logger)` at `apps/ptah-electron/src/di/phase-2-libraries.ts:355` runs inside `registerPhase2Libraries`, invoked at `apps/ptah-electron/src/di/container.ts:43` during container build. `startThothCron` runs later, at `apps/ptah-electron/src/activation/boot-heavy-services.ts:422`. Registration strictly precedes cron start.
- **CLI**: `registerSkillSynthesisServices` at `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:131` runs inside `registerThothLibraries`, invoked at `libs/backend/cli-engine/src/lib/container.ts:705`. `activateThoth` runs later, from `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:381`. Registration strictly precedes cron start.
- `register.ts` binds both new tokens (`SKILL_BACKLOG_CLEANUP_STORE`, `SKILL_BACKLOG_CLEANUP_SERVICE`) with `registerSingleton` + `{useToken}` aliases, so `isRegistered` returns true for the symbolic tokens.
- `CRON_POWER_MONITOR`, which the handler resolves per run, is registered in both hosts (`apps/ptah-electron/src/di/phase-3-storage.ts:124`; `register-thoth-libraries.ts:159`).
- The VS Code host is Thoth-free by design and never reaches `startThothCron`; the absent-token branch in both specs pins that a host without the service gets no job and no handler.

### 3. Handler mapping — CONFIRMED

`libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts`, read in full:

- Constants (`:22-28`): `jobId '@ptah/skills-backlog-cleanup'`, `handlerName 'skills:backlog-cleanup'`, `cronExpr '41 * * * *'`, `timezone 'UTC'` — match `implementation-plan.md` Component 4e exactly.
- Per-run resolution (`:36-48`): service + power monitor resolved fresh in one try/catch per run; failure → `{outcome:'skipped', reason:'backlog-cleanup-service-unavailable'}`.
- Skipped report → `{outcome:'skipped', reason}` direct mapping (`:54-56`).
- Failed → `throw new Error(report.reason ?? 'unknown')` (`:57-59`) — reason token only, no raw error text. The spec pins this: `rejects.not.toThrow(/SQLITE_IOERR|backlog cleanup failed/)` (`skill-backlog-cleanup-job.spec.ts:133`) against a report whose `error` field carries `SQLITE_IOERR at <path>`.
- Summary (`:71-79`) includes `deferred on error N` (the Batch-4-revise carried item), plus examined/rejected/kept/invocations-deleted. The spec pins the exact string (`spec:101-110`).
- Minute collision: minute 41 collides with nothing — retention `17 * * * *` (`memory-retention-job.ts:43`), backup `0 3` (`start-thoth-cron.ts:461`), integrity `30 3 * * *` (`start-thoth-cron.ts:133`), drain defaults `*/15`, `0 3`, `0 4 * * 0` (`file-settings-keys.ts:526-528`).
- Registration runs no cleanup SQL: both registration functions only `isRegistered` + `handlerRegistry.register` + `jobStore.upsert`.

### 4. DI — CONFIRMED

- `tokens.ts`: both new tokens are `Symbol.for(...)`; `CANDIDATE_NAMER_SERVICE` removed.
- `register.ts`: `registerSingleton` for store and service; `useToken` aliases; no cycle — every constructor dep of `SkillBacklogCleanupService` (`LOGGER`, cleanup store, `SessionVerdictStore`, `SkillQueueStore`, `TrajectoryExtractor`, `ForegroundActivityTracker` at `register.ts:92`, `WORKSPACE_PROVIDER`) is registered by the same `registerSkillSynthesisServices` or by the host composition root.
- `register.spec.ts:30-39` asserts every declared token is registered, including both new ones.
- Minor precision gap in the "singletons" test — finding 2 below.

### 5. Namer deletion — CONFIRMED

Grep across `libs` and `apps` for `CandidateNamerService`, `CANDIDATE_DISPLAY_NAME_MAX_CHARS`, `CANDIDATE_NAMING_JSON_SCHEMA`, `CandidateNaming`, `setDisplayName`, `nameCandidate` returns no matches (the report's AC12 grep matches my own). Both namer files are deleted (git status). The `display_name` migration column, `SkillCandidateRow.displayName`, and the row mapping `skill-candidate.store.ts` (`displayName: raw.display_name ?? null`) are retained; the readers in `skill-gap-curator.service.ts` and `trigger-eval.service.ts` are untouched.

### 6. Docs — CONFIRMED, one count claim off (finding 3)

- Both dead rows (`eligibilityMinTurns`, `prefilterMinChars`) are gone from `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`; grep returns zero in both the docs page and `skill-synthesis/CLAUDE.md`. The `prefilterMinEdits` / `prefilterMinToolUses` rows are reworded as work-evidence predicates. The table rows keep the three-column shape.
- `skill-synthesis/CLAUDE.md`: no depth-branch, fake-invocation, namer, or `eligibilityMinTurns` claims remain; the new bullets (evidence-only prefilter, manual promote, no synthetic invocation, cleanup semantics) match the code.
- `thoth-runtime/CLAUDE.md`: the fourth built-in job is documented in Purpose, the Public API list, and a guideline bullet whose content matches the implementation.
- No trademarked names (`copilot`, `codex`, `claude`, `openai`, `anthropic`) were added to ptah-docs (grep of the diff).

### 7. Anything in 5.1–5.3 silently not done — NONE FOUND

All three tasks are complete. Carried items all present: `deferred on error` in the summary, both docs rows removed, the `CLAUDE.md` false clause removed. XB1/XB2/XB3 claims are internally consistent; XB4 holds — no tracker, invocation-event, extractor, generalization, or clustering behaviour changed in the diff.

## Findings

### 1. Skip reason token misleads when only the power monitor is missing — MINOR

- File: `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:43-47`
- Scenario: `CRON_POWER_MONITOR` resolution throws while `SKILL_BACKLOG_CLEANUP_SERVICE` resolves fine. The handler returns `{outcome:'skipped', reason:'backlog-cleanup-service-unavailable'}`. A reader of the cron run row concludes the cleanup service is broken and investigates the wrong component.
- Note: the memory-retention sibling collapses three dependencies into one reason the same way (`memory-retention-job.ts`), so this is consistent with the established pattern — a naming-precision issue, not a behaviour defect.
- Fix: split the catch into two resolves with distinct reasons, or rename the token to `backlog-cleanup-dependency-unavailable`.

### 2. `register.spec` "singletons" test proves the alias, not singleton-ness — MINOR

- File: `libs/backend/skill-synthesis/src/lib/di/register.spec.ts:41-63`
- Scenario: the test calls `registerSkillSynthesisServices`, then `container.registerInstance(SkillBacklogCleanupStore, store)` — overwriting the class registration entirely — then resolves the symbolic token and expects the instance. This passes identically whether `register.ts` used `registerSingleton` or a transient `register`, because the instance replaced whatever registration strategy existed. A future edit of `register.ts` from singleton to transient keeps the suite green while two hosts silently get two cleanup stores (two cursors over one SQLite file).
- Fix: resolve the symbolic token twice and assert identity, or drop "as singletons" from the test name.

### 3. Docs key-count claim "All 74" does not match the code — MINOR

- File: `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md:8`
- Scenario: `FILE_BASED_SETTINGS_KEYS` contains 46 explicit `skillSynthesis.*` strings (`file-settings-keys.ts:217-313`) plus the lane spread (`:314`) over four lanes × eight fields (`:85-128`) = 32 generated keys, so the true count is **78**, not 74. The batch decremented the previous "76" by the two removed keys without recounting; the pre-batch-3 code held 48 explicit + 32 = 80, so the old "76" was already an undercount — plausibly by exactly the four `skillSynthesis.<lane>.maxPasses` keys (7 fields counted per lane instead of the 8 the table mandates, `file-settings-keys.ts:76`). A user who trusts the count and enumerates the file finds four keys the page does not account for.
- Fix: recount and write the correct number (78 by my count), or state the counting method in the sentence.

## Data flow (registration → run)

1. Host composition root registers skill-synthesis services, including both cleanup tokens — OK.
2. Cron start: `isRegistered(SKILL_BACKLOG_CLEANUP_SERVICE)` + `handlerRegistry.has` guard — OK (check 2).
3. `jobStore.upsert` of the job spec — OK; no cleanup SQL.
4. Scheduler fires at minute 41 UTC; handler resolves service + monitor per run — OK; resolve failure → skipped outcome.
5. `service.run({signal, isOnBattery})` — gates and cursor live in the service (Batch 4 scope).
6. skipped → skipped outcome; failed → throws reason token only; completed/partial → summary with all counters including `deferred on error` — OK.

## Edge cases

| Case | Handled | Where |
| --- | --- | --- |
| Service token absent (host without feature) | YES | Guard returns before upsert/register; pinned by both specs |
| Handler name already registered | YES | `handlerRegistry.has` check (`start-thoth-cron.ts:318`, `thoth-runtime.ts:589`) |
| Job store / registry absent (CLI) | YES | Triple `isRegistered` guard (`thoth-runtime.ts:576-584`) |
| Registration throws (CLI) | YES | Non-fatal warn catch (`thoth-runtime.ts:603-609`) |
| Per-run resolve throws | YES | Skipped outcome (`skill-backlog-cleanup-job.ts:43-47`) — see finding 1 |
| Failed report carries raw error text | YES | Only the reason token is thrown; pinned by spec |
| Cron slot collision | YES | Minute 41 shared with no other built-in job |

## Requirements fulfilment

| Requirement | Status |
| --- | --- |
| 5.1 cleanup DI tokens + singletons + spec | COMPLETE (finding 2 is test precision only) |
| 5.2 job registered in both real hosts | COMPLETE |
| 5.2 handler contract per plan (4e) | COMPLETE |
| 5.3 namer deletion, `display_name` kept | COMPLETE |
| 5.3 docs + CLAUDE.md corrections | COMPLETE (finding 3 is one count) |
| Carried: `deferred on error` in summary | COMPLETE |
| XB1–XB4 | COMPLETE per report (not re-run; see evidence basis) |