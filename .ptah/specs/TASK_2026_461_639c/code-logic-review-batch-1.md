# Code Logic Review — Batch 1 — `TASK_2026_461_639c`

Date: 2026-09-16. Reviewer: code-logic-reviewer. Read-only review.

## Scope

Batch 1 files under `libs/backend/skill-synthesis` only:

- `skill-promotion.service.ts` (full file, 765 lines)
- `skill-synthesis.service.ts` (diff and changed regions)
- `types.ts` (diff)
- `eligibility/session-work-evidence.ts` and its spec (full, untracked)
- `skill-promotion.service.spec.ts`, `skill-synthesis.service.spec.ts`, `prefilter-corpus-measurement.spec.ts` (diffs)
- Nine fixture-only spec diffs (two deleted settings keys each)
- `skill-invocation-tracker.ts`, `archaeology/regex-demotion.spec.ts`, `triggers/skill-trigger.service.ts` (read-only checks)

Not reviewed: `libs/backend/persistence-sqlite` (Batch 2).

Inputs read: `implementation-plan.md`, `batches.md`, `batch-1-report.md`, `TASK_2026_439_1310/HANDOFF.md`, the library `CLAUDE.md`.

## Verdict

**CHANGES_REQUESTED** — score **7/10**

The batch meets its acceptance criteria. One major partial-state defect exists on the new `write-failed` path. No blocking issue exists. The implementation follows the approved D1a–D6a plan; the plan itself did not cover this defect.

## Requested check results

| # | Check | Result |
|---|-------|--------|
| 1 | `promoteManually` skips only the frequency threshold; gate order preserved; no generalization leak | PASS — `skill-promotion.service.ts:242-251` wraps the threshold in `if (mode === 'automatic')`. The generalization shortcut (`countDistinctContexts`) is inside the same block, so it cannot run on the manual path and the manual path cannot leak into it. The remaining gates (status, active duplicate, cluster dedup, judge, replay, residency cap, write, status write, repropagation) run in the original order for both modes. |
| 2 | `evaluate` unchanged; tracker compiles | PASS — `evaluate` at `skill-promotion.service.ts:180-193` keeps its signature and delegates to the shared pipeline with `mode 'automatic'`. `skill-invocation-tracker.ts:80` still calls `this.promotion.evaluate(...)`. No other production caller of this `evaluate` exists. |
| 3 | D3a `write-failed`: row stays `candidate`; no partial state; marker placement | PARTIAL — the row stays `candidate` (no `updateStatus` before the write), the marker is in the catch's leading-comment zone at `skill-promotion.service.ts:327`, and repropagation is skipped. But the residency-cap demotion at `:289` commits before the write. See Finding 1. |
| 4 | Fake invocation removed; no other `context_id` writer added or removed | PASS — `skill-synthesis.service.ts` has no `contextId` or `recordInvocation` occurrence. The remaining `crypto` import serves `contentHash` (`:177`), a different function. Other production `contextId` symbols belong to `skill-trigger.service.ts` and `skill-invocation-recorder.ts`, the real invocation-event path, which XB4 protects and which this batch did not change. |
| 5 | Evidence predicate: conversation-only fails; each signal passes alone; thresholds from settings with defaults; floor kept | PASS — `session-work-evidence.ts:14-23` is a pure OR of the three signals. The spec covers each signal alone, all absent, below threshold, and at threshold. `prefilterMinEdits` default 1 and `prefilterMinToolUses` default 2 come from `SETTINGS_DEFAULTS`. `MIN_ROLE_TURNS_FLOOR` still runs first (`tooThin` before `noWork`). See Finding 3 for the invalid-type edge. |
| 6 | Spec quality: do new specs fail on named mutations or pass vacuously | PASS — the report pastes fail-and-restore output for AC2-mut, AC3-mut, and AC6-mut. The zero-success manual spec asserts `countDistinctContexts` was NOT called, which pins the threshold skip structurally. The `shape()` helper defaults `editCount`, `toolUseCount`, and `bashTestPassed` to zero/false, so the edit-only and test-only prefilter cases are not vacuous. |
| 7 | Work the batch silently did not do | PASS — all tasks 1.1–1.3 and Deviation 3 fixtures are done. The library `CLAUDE.md` still describes the removed depth branch; Batch 5 owns that file, so this is a planned deferral, not silent scope loss. |

## Findings

### 1. Residency demotion is not undone when the SKILL.md write fails — major

- **File**: `skill-promotion.service.ts:289` (demotion), `:317-343` (write and fail-closed return), `:355` (repropagation, success path only)
- **Severity**: major
- **Scenario**: The active set is at the residency cap. A promotion reaches the cap block. `setResidency(weakest.id, 'dormant')` commits at line 289. The SKILL.md write at line 317 then throws (disk full, permission denied, invalid `candidatesDir`). The pipeline returns `reason: 'write-failed'` at line 337. The return carries `evictedSkillId`, but nothing rolls the demotion back and nothing repropagates it.
- **Impact**: Two inconsistent states follow.
  1. The database says the weakest skill is `dormant`. The harness directories still contain it, because repropagation runs only on the success path (line 355). The junction layer therefore keeps a skill the database disabled, until some later promotion repropagates a different pair.
  2. A retry after the write problem is fixed no longer hits the cap, because the active count is now `cap - 1`. So the demotion never re-runs and the weakest skill stays dormant with no materialization that justified it. The skill is disabled indefinitely by a promotion that did not happen.
- **Current handling**: The comment block at `:351-354` documents that both residency changes are emitted together after the last write. That reasoning covers the success path only. The write-failed path contradicts it: the demotion is applied and the emission is skipped.
- **Fix**: Do the demotion after the SKILL.md write succeeds. Move the residency-cap block below the `try` block, and keep `demotedSlug` and `evictedSkillId` available for the return. Alternative: keep the current order and, in the catch, roll back with `setResidency(weakest.id, 'active')` (or the prior residency), or still emit the demotion repropagation. Then pin the choice with a spec assertion on `setResidency` and on the repropagation call in the write-failed case. The current write-failed spec asserts repropagation is NOT called and does not assert the demotion state at all, so the current partial state passes every test.

### 2. Cluster-dedup gate on the manual path has no direct spec — minor

- **File**: `skill-promotion.service.ts:249-258`; `skill-promotion.service.spec.ts` (manual promotion describe)
- **Severity**: minor
- **Scenario**: The manual describe pins the status guard, active duplicate, judge score, judge-unscored, replay, already-rejected, and residency cap. It does not pin the cluster-dedup rejection. A future refactor that drops the `clusterDedup` block from the pipeline would keep every current manual test green.
- **Impact**: Low. Both modes share one pipeline, so the gate runs on the manual path by construction today, and the automatic-path specs cover the gate itself.
- **Fix**: Add one manual case with `clusterDedup.isDuplicate` returning true, and assert `reason: 'duplicate'` and `updateStatus(..., 'rejected', { reason: 'cluster-duplicate' })`.

### 3. Invalid settings values do not fall back to the documented defaults — minor

- **File**: `skill-synthesis.service.ts` (`readSettings` and its `get` helper)
- **Severity**: minor (pre-existing pattern; not a Batch 1 regression, but Batch 1 made it load-bearing for the new predicate)
- **Scenario**: A user writes `"prefilterMinEdits": "two"` in `~/.ptah/settings.json`. The `get` helper falls back to the default only when the value is `undefined` or `null` or the read throws. A present but non-numeric value passes through. `readSettings` then returns the raw value, and `trajectory.editCount >= thresholds.prefilterMinEdits` compares a number against a non-number.
- **Impact**: The comparison is always false for invalid types, so edit evidence and tool evidence are silently disabled. Every session without `bashTestPassed` is then rejected as `noWork`. The floor still applies. No error or warning tells the user why.
- **Fix**: Validate the numeric settings with the existing settings boundary, or coerce with a check (`typeof value === 'number' && Number.isFinite(value)`) in `readSettings` before use.

## Data flow notes

- Automatic: `evaluate` → pipeline (`automatic`) → threshold (with generalization shortcut) → dedup → judge → replay → cap → write → status → repropagate. OK.
- Manual: `SkillSynthesisService.promote` / `promoteBulk` → `promoteManually` → pipeline (`manual`) → threshold skipped → same gates. `promoteBulk` loops `promoteManually`, so bulk promotion stays per-item fail-safe. OK.
- Write failure: demotion committed → write throws → return `write-failed` → caller sees `promoted: false` and the row stays `candidate`. The defect is the committed demotion, not the return value. See Finding 1.
- Prefilter: `MIN_ROLE_TURNS_FLOOR` first (`tooThin`), then `hasSessionWorkEvidence` (`noWork`). Order matches the plan: a work-bearing two-turn session is `tooThin`, not `noWork`. OK.
- Fake invocation: deleted; `context_id IS NOT NULL` still identifies exactly the fake rows for the later cleanup, because the tracker never passes `contextId`. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
|-------------|--------|-----|
| Task 1.1 — manual path, threshold-only skip, gate order | COMPLETE | — |
| Task 1.1 — D3a fail-closed write | PARTIAL | Partial state on the demotion (Finding 1) |
| Task 1.2 — fake invocation removal | COMPLETE | — |
| Task 1.3 — evidence-only prefilter + dead-setting removal | COMPLETE | Invalid-type edge (Finding 3) |
| AC1–AC6 and mutations | COMPLETE | Report carries fail-and-restore proof |
| XB1–XB4 | COMPLETE or N/A | XB1 N/A: no real-SQLite spec in this batch |

## Verdict detail

- Recommendation: REVISE — fix Finding 1 before merge; Findings 2 and 3 can follow.
- Confidence: HIGH. All changed files were read in full or in their changed regions; every claim carries a file:line.
- Top risk: A user with a full skills library loses their weakest active skill to dormancy the first time a promotion write fails, and the state never self-corrects.