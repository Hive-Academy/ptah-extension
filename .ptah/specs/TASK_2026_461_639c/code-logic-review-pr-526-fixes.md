# Code Logic Review — PR #526 CodeRabbit fixes (`TASK_2026_461_639c`)

Scope: uncommitted worktree diff on top of HEAD `d0731ee8c`, as reported in
`pr-526-fixes-report.md`. Files read in full: `skill-candidate.store.ts` (+ spec),
`skill-promotion.service.ts` (+ spec, + repropagation spec), `skill-md-generator.ts`,
`skill-backlog-cleanup.service.ts` (+ spec), `skill-backlog-cleanup.types.ts`,
`skill-synthesis.service.ts` (readSettings + promote/promoteBulk), `skills-synthesis-rpc.schema.ts`
(+ spec), `skill-synthesis-tab.component.ts` (settings form), `skill-backlog-cleanup-job.ts`.
C5–C7 (docs/type-union) spot-checked against the report's own diffs, not re-audited line by line.

## Summary

| Metric              | Value            |
| -------------------- | ---------------- |
| Overall score        | 7/10             |
| Assessment            | NEEDS_REVISION  |
| Blocking issues       | 0                |
| Serious issues        | 1                |
| Moderate issues       | 2                |
| Failure modes found   | 3                |

## Five logic questions

### 1. How does this fail silently?

The atomic-promotion catch block (`skill-promotion.service.ts:322-339`) is
supposed to convert every promotion failure into a clean `write-failed`
decision. It does that for a `promoteAtomically` throw, but **not** for a
`removeActive` throw: `if (materialized) this.mdGenerator.removeActive(materialized);`
at line 324 has no `try/catch` of its own, so an `fs.rmSync` failure there
(EPERM/EBUSY on a locked directory — realistic on Windows, the platform this
repo runs on) replaces the intended `write-failed` return with an **uncaught
exception**, and the on-disk artifact `promoteToActive` just wrote is left
behind while the DB is correctly rolled back to `status='candidate'`. See
Finding S1 below — this is the one place in the file that breaks the
file/try-catch pattern every sibling method here uses (`workspaceRoot()`,
`winRatesBySlug()`, `authoredSlugs()` all wrap their fallible call).

### 2. What user action produces unexpected behaviour?

A user clicking "Promote" (or "Promote all" in a bulk selection) on a
candidate whose slug directory write later needs to be rolled back, at the
exact moment the active-root file is locked by another process (AV scanner,
Explorer preview, a sync client), sees the RPC call fail with a raw/opaque
error instead of the designed `write-failed` decision — and a stray
`<activeRoot>/<slug>/` directory is left on disk that no DB row points at,
because it was never cleaned up. See S1.

A user who types `0` into the "Min edits before analysis" / "Min tool uses"
inputs on the Skills Settings panel (`skill-synthesis-tab.component.ts:797-798`,
no `Validators.min(1)` on either control — confirmed, matching the report) and
saves gets a generic RPC error from `SkillSynthesisSettingsSchema.parse` (now
`.int().min(1)`) with no field-level message, and the save silently does not
apply (`registerUpdateSettings` validates before writing any key, so this is
at least atomic — no half-applied settings). See M1.

### 3. What input data produces a wrong answer?

None found that produces a *wrong* answer rather than a thrown/rejected
error — C1's transaction and C2's retry bookkeeping both degrade to explicit,
typed stop reasons rather than silently drifting state. The one place a wrong
answer is plausible is the counter-identity comment in
`skill-backlog-cleanup.types.ts:45-48` versus the actual code: `deferredOnError`
is per-run only (never persisted in `BacklogCleanupState`), which is
documented, but a maintainer skimming just the type file could still miscompute
"examined" across restarts if they forget `examined` (which *is* persisted)
already includes deferred-on-error candidates. Documentation-adjacent, not a
runtime defect — not scored as a finding.

### 4. What happens when a dependency fails?

- SQLite mid-transaction failure (C1): correctly rolled back by
  `inImmediateTransaction`'s explicit `ROLLBACK`, verified with a real
  aborting `BEFORE UPDATE` trigger over both bindings
  (`skill-candidate.store.spec.ts:228-256`). Confirmed non-vacuous.
- Filesystem failure during `promoteToActive` (C1): caught, DB never touched,
  clean `write-failed`. Confirmed by test at
  `skill-promotion.service.spec.ts:1213-1259`.
- Filesystem failure during the *compensating* `removeActive` (C1): **not**
  handled — see S1. No test exercises this path (`makeMdGenerator()` at
  `skill-promotion.service.spec.ts:140-152` returns a bare non-throwing
  `jest.fn()` for `removeActive` in every test that reaches this branch).
- Candidate evaluation throwing repeatedly in the backlog cleanup (C2):
  bounded at 3 attempts per process, verified with real retry/cursor
  assertions (`skill-backlog-cleanup.service.spec.ts:522-658`). On process
  restart the in-memory `evaluationFailures` map resets, so a candidate that
  fails on *every* attempt can cost up to 2 extra hourly ticks after every
  restart before the 3rd-attempt fallback forces it through. This is
  documented behaviour a reviewer can accept, but the report doesn't
  disclose the restart interaction at all — flagged as M2, not blocking.

### 5. What is missing that the requirements never mentioned?

- A compensating-action failure path (removeActive throws) was not covered by
  the review checklist's own C1 questions being answered in code — see S1.
- The UI-side consequence of tightening the RPC schema (C3) — a user can still
  compose an invalid save that now bounces off the server with an unhelpful
  message — is real but was flagged by the report's own C3 note as
  intentionally deferred; I agree with deferring a UI fix but the "what does
  the RPC then return" half of the question wasn't actually answered in the
  report. See M1.

## Failure modes

### F1 — Uncaught exception from `removeActive` during promotion rollback

- Trigger: `promoteAtomically` (or, less likely, the store call itself)
  throws inside the `try` at `skill-promotion.service.ts:307-321`, `materialized`
  is non-null, and `this.mdGenerator.removeActive(materialized)` at line 324
  itself throws (e.g. `fs.rmSync` hits `EBUSY`/`EPERM` on Windows, or a
  filesystem exhaustion, or a symlink race).
- Symptom: `runGatePipeline` throws instead of resolving to
  `{promoted:false, reason:'write-failed', ...}`. The manual RPC paths
  (`SkillSynthesisService.promote` / `promoteBulk`,
  `skill-synthesis.service.ts:1155-1219`) have no local catch, so the RPC
  handler's outer `catch` (`skills-synthesis-rpc.handlers.ts:592-595`) turns
  this into a generic RPC error instead of the documented decision shape; the
  automatic path (`skill-invocation-tracker.ts:79-93`) swallows it as
  "promotion evaluation failed (non-fatal)" and silently drops the promotion
  attempt with no `write-failed` counted anywhere.
- Evidence: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts:322-339`;
  `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:205-207`
  (`removeActive` is a bare `fs.rmSync(..., {force:true})`, which suppresses
  ENOENT but not EBUSY/EPERM); no throwing test exists
  (`skill-promotion.service.spec.ts:140-152`, `:1261-1299`).
- Current handling: none — the exception propagates.
- Recommendation: wrap the `removeActive` call in its own `try/catch` (mirroring
  `winRatesBySlug`/`authoredSlugs`/`workspaceRoot` in the same file), log a
  second warning that names the orphaned directory path, and still return the
  `write-failed` decision. The orphaned directory is then a known, logged
  cleanup item instead of a thrown error that both discards the decision shape
  and hides the directory's existence.

### F2 — Poison candidate re-blocks the backlog cleanup cursor for up to 2 ticks per process restart

- Trigger: a candidate whose `evaluateCandidate` throws unconditionally (e.g.
  a permanently corrupt row, or a session id that always raises reading the
  transcript locator).
- Symptom: each restart re-arms `evaluationFailures` at 0 for that candidate,
  so the hourly job (`41 * * * *`) reports `partial`/`deferred-error` and makes
  no forward progress on that page for up to 2 ticks after every restart,
  before the 3rd-attempt fallback advances past it.
- Evidence: `skill-backlog-cleanup.service.ts:75-76` (`evaluationFailures` is
  an instance field of a `registerSingleton`, `skill-synthesis/src/lib/di/register.ts:70`,
  so it is process-lifetime, not persisted); `skill-backlog-cleanup.service.spec.ts:574-617`
  proves the 3-attempt bound within one process but nothing exercises the
  restart case.
- Current handling: acceptable given the job's low cadence and the rarity of
  both a genuinely poison candidate and frequent restarts, but the report
  presents the 3-attempt bound as the whole story without naming this residual
  interaction.
- Recommendation: no code change required; add one sentence to the report (or
  the lib's `CLAUDE.md`) documenting the restart/poison-candidate interaction
  so a future reader doesn't have to re-derive it from the singleton
  registration.

### F3 — Settings save UX regression is real but unaddressed, not just "intentionally not fixed"

- Trigger: user types `0` (or leaves a field blank, which Angular reactive
  forms coerce to `null`/empty string depending on control type) into either
  prefilter threshold field and clicks Save.
- Symptom: `skillSynthesis:updateSettings` throws a `ZodError` from
  `SkillSynthesisSettingsSchema.parse` (now `.int().min(1)`); the handler's
  catch (`skills-synthesis-rpc.handlers.ts:592-595`) reports and rethrows,
  which the frontend almost certainly renders as an unstructured error message
  rather than a field-specific "must be at least 1" hint tied to the visible
  input.
- Evidence: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:797-798`
  (`prefilterMinEdits: [1]`, `prefilterMinToolUses: [2]`, no `Validators`);
  `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:39-40`.
- Current handling: none on the client; server-side rejection is correct and
  atomic (validated before any key is written), so no bad value reaches
  settings storage — this is a UX gap, not a data-integrity one.
- Recommendation: at minimum add `Validators.min(1)` to the two controls (a
  small, low-risk client change that does not require inventing a "numeric
  validator convention" the report says doesn't exist yet — Angular's built-in
  validator is exactly the convention-free option). Out of scope for a
  same-day PR-fix pass is defensible, but the report should say "the RPC now
  rejects and the user sees a raw error" instead of implying the gap is inert.

## Blocking issues

None.

## Serious issues

### S1 — `removeActive` failure is not caught inside the promotion rollback path

- File: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts:324`
- Scenario: filesystem error during the compensating removal after
  `promoteAtomically` (or a downstream throw) fails post-materialization.
- Impact: the promotion decision contract (`write-failed`, no `evictedSkillId`,
  no repropagation) is broken by an unhandled exception; callers either see a
  raw RPC error (manual promote/promoteBulk) or a silently dropped decision
  (automatic path via the invocation tracker's blanket catch), and an orphaned
  `<slug>/SKILL.md` directory is left in the active root outside DB knowledge.
- Fix: wrap the `removeActive` call in its own `try/catch`; on failure, log a
  warning naming the orphaned path and still return the `write-failed`
  decision (see F1).

## Moderate and minor issues

- M1 (moderate): Settings UI allows `0`/invalid values into the two prefilter
  fields with no client-side validator; the now-stricter RPC schema surfaces a
  generic error rather than a field-level message. `skill-synthesis-tab.component.ts:797-798`.
- M2 (moderate): A permanently-failing backlog candidate blocks up to 2 ticks
  of cursor progress after every process restart, because the attempt counter
  is in-memory only. `skill-backlog-cleanup.service.ts:75-76`. Not a bug, but
  undisclosed in the fix report.
- Minor: the `BacklogCleanupState`/`BacklogCleanupRunCounters` counter-identity
  comment (`skill-backlog-cleanup.types.ts:45-48`) is easy to misread in
  isolation from the code that actually increments `examined` for
  deferred-on-error rows; consider inlining the identity assertion as a code
  comment next to `execute()`'s `increments.examined++` rather than only in the
  types file.

## Data flow

**C1 — promotion:**
1. `runGatePipeline` computes eviction candidate (`weakestResident`) — OK.
2. `mdGenerator.promoteToActive` writes the new active `SKILL.md` — OK, collision-safe (`writeAtRoot` only claims a directory it verified didn't exist).
3. `store.promoteAtomically` — one `BEGIN IMMEDIATE` wrapping the optional demotion UPDATE (guarded on `status='promoted' AND residency='resident'`, so a concurrently-changed resident rolls the whole transaction back) and the promotion UPDATE (guarded on `status='candidate'`, so a concurrently-promoted/rejected candidate also rolls back) — OK, verified with a real aborting trigger.
4. On success: `clusterDedup.invalidate()` runs **after** the transaction commits, then repropagation fires for both slugs — OK, matches the documented ordering rationale (no half-applied state exposed to the harness).
5. On failure: `removeActive` cleans up the just-written file **without its own error handling** — gap, see S1.

**C2 — backlog cleanup:**
1. `run()` gates (disabled/complete/boot-deferred/battery/foreground/abort) — OK.
2. `execute()` pages candidates, evaluates each; a throw increments a per-id in-memory counter and stops the page **before** the failed candidate on attempts 1-2, letting predecessors in the same page commit exactly once — OK, verified.
3. Attempt 3 forces the candidate through as `deferred-error`, counted in `examined`, cursor advances — OK, verified.
4. `stopReason` (abort/wall-budget) is checked before any candidate in a page is touched, so a mid-run abort never burns a retry attempt — OK.
5. Completion (`deleteInvocationsAndComplete`) is only reached once `pageCandidates` returns empty, which requires every candidate — including permanently-poison ones — to eventually clear via the 3-attempt fallback, so `complete` cannot be reached while a genuinely stuck retry is pending forever — OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| C1: atomic promotion + compensating removal | PARTIAL | Transaction and status guards are correct and tested; the compensating `removeActive` call is not itself failure-safe (S1). |
| C2: bounded backlog-cleanup retry | COMPLETE | Attempt bound, cursor semantics, and stop-reason plumbing all verified; restart interaction (F2) is an acceptable, undisclosed residual. |
| C3: positive prefilter thresholds | PARTIAL | Backend helper + RPC schema correctly reject `<1`; UI can still submit `0` and gets an unhelpful RPC error (F3/M1). |
| C4: closed cleanup reason union | COMPLETE | `BacklogCleanupStopReason | null`; thoth-runtime forwards it generically. |
| C5–C7: docs/type fixes | COMPLETE (spot-checked) | — |

Implicit requirements not addressed: symmetry between the "fail-soft with a
try/catch" pattern already used three times in `skill-promotion.service.ts`
and the new `removeActive` call, which breaks that pattern (S1).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Concurrent status change on the promoted candidate | YES | `promoteAtomically`'s `WHERE status=@candidateStatus` guard, `changes !== 1` throws, transaction rolls back | None |
| Concurrent status/residency change on the demoted resident | YES | Same pattern on the demotion UPDATE | None |
| `promoteToActive` throws before any DB write | YES | Caught, no store call made, `write-failed` returned cleanly | None |
| `promoteAtomically` throws after `promoteToActive` succeeded | PARTIAL | Rolled back in DB; `removeActive` invoked but not itself guarded | S1 |
| First candidate of a cleanup page throws | YES | `processed===0` path leaves cursor untouched, no double-processing next run | None |
| Same-page predecessors before a failing candidate | YES | Committed once via `rejectBatch` + cursor advance to the last successful id | None |
| Backlog candidate poisons every attempt | YES (bounded per process) | 3rd-attempt forced advance | F2 (undisclosed restart interaction) |
| UI submits `prefilterMinEdits: 0` | PARTIAL | RPC schema rejects it | M1 (poor UX, no inline validation) |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a filesystem error during the promotion-rollback's compensating
  `removeActive` call turns a designed `write-failed` decision into an
  unhandled exception and leaves an orphaned active-skill directory outside DB
  control (S1).
- What a robust implementation would add: a `try/catch` around `removeActive`
  matching the file's existing fail-soft idiom; a one-line note on the
  poison-candidate/restart interaction in C2; and `Validators.min(1)` on the
  two prefilter form controls so C3's server-side fix isn't undermined by a
  silent client-side gap.
