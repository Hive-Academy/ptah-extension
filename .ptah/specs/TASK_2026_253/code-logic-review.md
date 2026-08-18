# Code Logic Review — TASK_2026_253

## Review Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall Score   | 8/10     |
| Assessment      | APPROVED |
| Critical Issues | 0        |
| Serious Issues  | 0        |
| Moderate Issues | 0        |
| Nits            | 1        |

This is a well-scoped, well-verified fix. Every one of the eight review points named in the task brief was independently checked (not taken from the report), including re-running the mutation test myself and re-running the full gate. Nothing contradicts the report.

## Independent Verification Performed

### 1. Public token removal — repo-wide search

`rg` for `TRIGGER_EVAL_SKIP_REASONS` and the literal string `trigger-eval-prompt-generation-unavailable` across the whole repo (apps, libs, frontend, e2e, CLI, specs) found exactly the files the report lists: the six files inside `skill-synthesis` that were edited, plus `.ptah/specs/TASK_2026_180/CONTINUATION.md` (historical prose, correctly left alone) and this task's own `context.md`/`implementation-report.md`. No RPC handler, no `skill-synthesis-ui` component, no `cli-engine`/`thoth-runtime` file references either. The removal is safe — confirmed, not assumed.

### 2. Persisted value — is `skill_synthesis_queue.reason` compared anywhere

Traced every read of `SkillQueueRow.reason`: `skills-synthesis-rpc.handlers.ts:2202` (`reason: row.reason`) surfaces it verbatim for display; `skill-pipeline-status.component.ts`'s `reasonChip` never inspects the queue reason string (only `event.kind`); `skill-digest-panel.component.ts` doesn't touch it at all. The one place a UI component does `counts.set(d.reason, …)` (`skill-synthesis-tab.component.ts:1134`) is grouping `PromotionDecision.reason` from bulk-promote, a completely different data source — not the trigger-eval skip token. The "display-only, nothing reads it back for comparison" claim holds.

### 3. The `noLane → skipped` mapping — traced to ground truth, not just re-stated

This is the one place I extended past what the report argued, because the task flagged it as highest-risk. Traced `TriggerEvalService.generatePrompts`'s three branches back to `LaneRunnerService.run`:

- `result.status === 'unavailable'` fires **only** when `!this.internalQuery` — i.e., no `IInternalQuery` wired into this host at all (`lane-runner.service.ts:271-276`). That is a structural host property (e.g. a CLI/e2e host with no SDK), not a "misconfigured today, fixed tomorrow" condition.
- Auth misconfiguration (`resolution.ok === false`, `kind: 'auth-unresolvable'`) goes through `this.fail(...)`, which returns `status: 'failed'` — **not** `'unavailable'`. `generatePrompts` maps that to `laneFailed`, which is in `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS` and lands on `unscored`, re-eligible under `not_before`.

So the scenario the task worried about — a host that is misconfigured today and configured tomorrow — is actually classified as `laneFailed`/`unscored` (retryable), not `noLane`/`skipped`. `noLane` is reserved for a host that structurally never has an `IInternalQuery`, which genuinely cannot self-heal without a restart — the same shape as the pre-existing `noEmbedder`. Confirmed against `ELIGIBLE_SQL`/`CLAIM_SQL` (`status IN ('queued','unscored')`) and `REOPEN_SQL` (`status IN ('done','failed','unscored','skipped')`, gated on `turn_count` growth): `unscored` rows are picked up automatically on the next tick past `not_before`; `skipped` rows only come back if the session grows and the producer (`prefilter`) re-enqueues with a higher `turn_count`. That is a real behavioural difference between the two outcomes, and the mapping is on the correct side of it. Also checked that `laneRunner.run` is called without `queueItemId` from this call site, so `LaneRunnerService`'s own pre-emptive `requeue()` special-case for `timeout`/`auth-unresolvable` does not double-write the row here — no interaction bug.

**Verdict: the mapping is correct, not a regression.**

### 4. Cost re-rank

`STAGE_COST_RANK: Record<SkillQueueStage, number>` — the `Record` type itself makes exhaustiveness a compile-time property, confirmed by a clean `tsc --noEmit`. Counted `SKILL_QUEUE_STAGES` — 11 members — against the rank table (0–10, all distinct): exhaustive. Only `judge`/`trigger-eval` swapped (3↔4); every other numeral is untouched.

### 5. Budget-gate correctness

Read `skill-drain.service.ts:653-665` directly: the per-item check is `TOKEN_SPENDING_STAGES.has(row.stage) && isBudgetExhausted(...)`, generic over stage — `trigger-eval` gets no special case, same `continue` (deferred, not claimed) as every other spending stage. `budgetDeferred++` / `budgetExhausted = true` on the shared summary object, and the row is never touched by `markSkipped` (only `runItem`, which is skipped via `continue`, calls that).

### 6. Mutation check — reproduced myself, not trusted from the report

Reverted both production edits in `skill-drain.service.ts` (removed `'trigger-eval'` from `TOKEN_SPENDING_STAGES`; restored `'trigger-eval': 3` / `judge: 4`), ran `skill-drain.budget.spec.ts` in isolation:

```
● defers a trigger-eval row once the budget is exhausted mid-tick
  Expected ['judge-1'], received ['judge-1','trigger-eval-1']
● ranks trigger-eval after judge and before digest under cheap-first
  Expected ['judge-1','trigger-eval-1','digest-1'], received ['trigger-eval-1','judge-1','digest-1']
Tests: 2 failed, 9 passed, 11 total
```

Exactly matches the report's claimed mutation result. Restored the file from a backup, re-ran the same spec (11/11 passed) and `nx lint skill-synthesis` (0 errors, 30 pre-existing warnings, same count as reported) to confirm the restore was clean and complete.

### 7. Four failure branches → three tokens

Traced all four sites in `generatePrompts`: the `catch` around `laneRunner.run` → `laneFailed`; `result.status === 'unavailable'` → `noLane`; `result.status === 'failed'` → `laneFailed`; schema `safeParse` failure → `unusableReply`. `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS` correctly contains exactly `laneFailed` and `unusableReply`; the spec's `it.each` table drives all four branches through the real service (not against the constant map) and a separate test pins membership for all six reasons including the three pre-generation ones (`disabled`/`noEmbedder`/`noDescription`), which correctly are NOT in the retryable set.

### 8. Dead code

`skill-synthesis.service.ts` import swapped cleanly from `TRIGGER_EVAL_SKIP_REASONS` to `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS` — grepped the file, no remaining reference to the old import, no orphaned `noPrompts` usage anywhere, no compat alias.

### Gate — reproduced independently

```
nx test skill-synthesis --skip-nx-cache      → 1268 passed, 37 skipped  (matches report)
nx typecheck skill-synthesis                  → clean                    (matches report)
nx lint skill-synthesis                       → 0 errors, 30 pre-existing warnings (matches report)
nx test rpc-handlers --skip-nx-cache          → 2132 passed, 31 skipped  (matches report)
```

All numbers match the implementation report exactly.

## Nits (non-blocking)

- `implementation-report.md`'s "sit between `judge` (one call) and `digest`, above `judge-panel`" phrasing (also echoed in `CLAUDE.md`) is a little loose — the actual rank table has `digest`, `synthesis`, `cluster-synthesis` between `trigger-eval` (4) and `judge-panel` (8), so "above `judge-panel`" means "cheaper-ranked than," not "adjacent to." The code and tests are unambiguous; only the prose reads as if the two are neighbours. Not worth a re-edit on its own.

## What Was Not Re-litigated

The task brief correctly scoped this as **not** requiring re-derivation of the probe-caching alternative (explicitly deferred, not rejected, and documented as such in three places) — that's a legitimate scope boundary, not a gap.

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top risk assessed and cleared**: the `noLane → skipped` state-mapping change, traced to the actual `LaneRunnerService` branch logic rather than accepted from the report's prose — auth-misconfiguration (the realistic "fixable tomorrow" case) is retryable via `laneFailed`/`unscored`; `noLane` is reserved for a host with no `IInternalQuery` wired at all, which is a structural condition, not a transient one. The mapping is correct.
