# Code Logic Review — TASK_2026_256

## Review Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall Score         | 9/10                                  |
| Assessment            | APPROVED                              |
| Critical Issues       | 0                                     |
| Serious Issues        | 0                                     |
| Moderate Issues       | 0                                     |
| Minor / Informational | 1 (baseline-count discrepancy, non-blocking) |

This is behaviour-preserving structural work and it is, in fact, behaviour-preserving. Every claim in the implementation report was independently reproduced rather than trusted, including the one claim most reviewers would wave through (the mutation test on rule 1). Nothing here needed to be walked back.

## The 5 Paranoid Questions

### 1. How does this fail silently?

The candidate failure mode for this kind of split is exactly what `context.md` calls out: registration silently sinking below a guard, or a handler quietly changing its outcome mapping so a stage that used to retry now terminates (or vice versa). I checked both by diffing the extracted block against the pre-refactor source line-by-line (see Data Flow Analysis) rather than reading it as prose — the only textual differences between the removed block and the new file are the `this.` → `workers.` port indirection and the `workers` parameter threading. No mapping, no reason token, no `dependsOn`, no `force` flag changed. A silent behaviour change was the single most likely defect class here and it did not happen.

### 2. What user action causes unexpected behavior?

None found. The one user-visible seam — the Electron tray's "Pause background learning" toggle re-enabling `skillSynthesis.enabled` after boot — is exactly rule 1, and I reproduced the regression by hand (moved `registerStageHandlers()` below the `enabled` guard) to confirm a paused-then-resumed host would in fact lose every stage handler under the mutated code, and that the shipped code does not have that defect.

### 3. What data makes this produce wrong results?

Nothing new. The two structural traps this lib is already scarred by — enqueuing a row with `turnCount: 0` (permanently un-reopenable) and enqueuing a gate row with `dependsOn` pointing at a prefilter row that can legitimately end `skipped` (permanently ineligible) — are both still avoided verbatim in the moved code (`stage-handlers.service.ts:336`, `:445`, `:409-413`).

### 4. What happens when dependencies fail?

- A missing `stageHandlers` (unregistered token, hand-built service): `start()`'s `this.stageHandlers?.registerStageHandlers(this)` no-ops via optional chaining — same shape as the pre-refactor `if (!this.drain) return;` guard, just moved one level out.
- A missing `queue`/`drain`/`archaeologist`/`judgePanel`/`replayValidator`/`triggerEval` inside `SkillStageHandlersService`: every one is still `{isOptional: true}` and every call site still null-checks before touching it (confirmed by reading the constructor and `registerStageHandlers` body, `stage-handlers.service.ts:129-243`).
- A lane failure inside a gate: handed over as `{outcome: 'lane-failed', failure}` verbatim in `runReplayStage` and `runArchaeologyStage`; `runJudgePanelStage` and `runTriggerEvalStage` still have no such branch, which the code's own docblocks (carried over unchanged) admit is a known gap belonging to `JudgePanelService`/`TriggerEvalService`, not to this refactor.

### 5. What's missing that the requirements didn't mention?

Nothing structural. The one thing worth surfacing even though it's not a defect in this diff: the task brief's stated rpc-handlers baseline (2132 passed) does not match either the implementation report's own recorded baseline or my independently re-run count (2142 passed, 31 skipped, 2173 total, both before-mutation and after-restore). The **skip count** — the actual verification-bar metric per `context.md` — matches exactly (31/31), so this is not a regression signal, just a stale number somewhere upstream of the developer (most plausibly the task brief predates TASK_2026_253 landing more tests on this branch, mirroring the 1929→2027 line-count note in `context.md` itself). Flagging so it doesn't get miscited as a discrepancy caused by this refactor.

## Failure Mode Analysis

### Failure Mode 1: Registration silently sinking below the `enabled` guard

- **Trigger**: A future edit reorders `start()` so `stageHandlers?.registerStageHandlers(this)` moves below `if (!this.readSettings().enabled) return;`.
- **Symptoms**: A host that boots with `skillSynthesis.enabled: false` and is later re-enabled via the Electron tray never gets its stage handlers wired; every enqueued row is marked `skipped` with "no handler for stage X" forever.
- **Impact**: Silent total loss of background skill synthesis for any host that ever booted paused — a real, common startup state, not a corner case.
- **Current Handling**: Registration sits above both early returns (`skill-synthesis.service.ts:273-280`), exactly as documented, and I confirmed by mutation that moving it below the `enabled` guard fails `skill-synthesis.stage-handlers.spec.ts`'s "registers handlers even when the master switch is off at start" (1 failed, 39 passed → 40 passed on restore).
- **Recommendation**: None — already pinned and verified. Worth noting the `started` early return is *not* separately pinned (harmless by construction per the report, and I have no reason to dispute that reasoning), so a future regression that moves registration below only that guard would not be caught by this test. That is a pre-existing gap in test coverage, not something this refactor introduced or worsened.

### Failure Mode 2: The `queueItemId` substring guard missing the new files

- **Trigger**: A future stage handler needs to call `LaneRunnerService.run` directly and copies a `queueItemId` field into a request literal or even into a comment inside `stage-handlers.service.ts` or `candidate-body.ts`.
- **Symptoms**: Two writers of the lane-failure queue transition (`LaneRunnerService.fail`'s own `requeue` and the drain's `applyLaneFailure`) could double-write a row; benign under normal operation, live defect once `maxAttempts`'s terminal ceiling fires because the runner would already have released a claim the terminal mark expects to hold.
- **Impact**: Silent double-write, surfacing only under a specific race at the attempt ceiling.
- **Current Handling**: `skill-drain.failures.spec.ts`'s "is referenced by no production file other than the runner that declares it" walks every non-spec `.ts` file under `src/` recursively (`productionSources()`, `skill-drain.failures.spec.ts:60-73`) — this necessarily includes both new files, and running it explicitly confirms 0 offenders (9/9 passed).
- **Recommendation**: None needed; the guard's directory-walking design means it required no update for the split to stay covered.

### Failure Mode 3: A stage's outcome mapping quietly changes shape during extraction

- **Trigger**: Copy-paste extraction is exactly the kind of mechanical, high-volume edit where a `switch` branch or a boolean condition gets transposed without anyone noticing, especially across six near-identical-looking dispatch methods.
- **Symptoms**: One stage starts terminating on what used to be a retryable outcome (or the reverse) — the highest-risk outcome the task's own brief calls out explicitly (item 8 in my brief).
- **Impact**: Candidates silently stop being re-evaluated (permanent `skipped` mis-applied) or the drain wastes budget retrying something permanent (`unscored` mis-applied) — both are quiet, no crash, no failing test unless something already pins that exact branch.
- **Current Handling**: I extracted the original block (`skill-synthesis.service.ts` lines 605–1271 at `HEAD`) and the new block (`stage-handlers.service.ts` lines 216–878) and diffed them directly rather than reading each for plausibility. The only differences across 660+ lines are the `SkillStageWorkers` parameter threading and `this.` → `workers.` call-site rewrites on exactly three call sites (`analyzeSession`, `readSettings` ×2, `backfillEmbeddings`). Every `switch`, every reason string, every `dependsOn`/`force`/`payload` literal is unchanged.
- **Recommendation**: None — this is the one failure mode I'd have bet money on finding *something* in, and the line-level diff rules it out mechanically rather than by trust.

## Critical Issues

None found.

## Serious Issues

None found.

## Data Flow Analysis

```
SkillSynthesisService.start()
  ├─ this.stageHandlers?.registerStageHandlers(this)   [ABOVE both early returns — verified by mutation]
  │     └─ SkillStageHandlersService.registerStageHandlers(workers: SkillStageWorkers)
  │           ├─ drain.registerStageHandler('prefilter',   ctx => runPrefilterStage(ctx, workers))
  │           ├─ drain.registerStageHandler('embedding',   ctx => runEmbeddingStage(ctx, workers))
  │           ├─ if (archaeologist)  drain.registerStageHandler('archaeology',  ctx => runArchaeologyStage(ctx))
  │           ├─ if (judgePanel)     drain.registerStageHandler('judge-panel',  ctx => runJudgePanelStage(ctx, workers))
  │           ├─ if (replayValidator) drain.registerStageHandler('replay',      ctx => runReplayStage(ctx))
  │           └─ if (triggerEval)    drain.registerStageHandler('trigger-eval',ctx => runTriggerEvalStage(ctx, workers))
  ├─ if (this.started) return
  └─ if (!enabled) return
```

Diff-level comparison of the extracted block (`skill-synthesis.service.ts@HEAD:605-1271`, 667 lines) against the new file's equivalent (`stage-handlers.service.ts:216-878`, 663 lines) shows only mechanical differences:
- method signatures gain a `workers: SkillStageWorkers` parameter (6 call sites)
- `this.analyzeSession(...)` → `workers.analyzeSession(...)` (1 site)
- `this.readSettings()` → `workers.readSettings()` (2 sites)
- `this.backfillEmbeddings()` → `workers.backfillEmbeddings()` (1 site)
- `private registerStageHandlers()` → public `registerStageHandlers(workers)`
- one docblock line updated from `` by `start()` `` to `` by `SkillSynthesisService.start()` ``

No `switch`/`if` branch, reason token, `dependsOn`, `force`, `payload` key, or heartbeat interval changed. This is not "looks unchanged" — it is a line-diff with the differences enumerated above and nothing else.

### Gap Points Identified

None. `drain()`'s never-throw contract is unaffected (no new `throw` statements in either new file — confirmed by grep). The queue-payload single-transaction re-point (`enqueueGate`/`enqueue`) is untouched; the refactor did not add a second call site.

## Requirements Fulfillment

| Requirement | Status | Concern |
|---|---|---|
| Extract six `run*Stage` methods + `registerStageHandlers()` + queue-chaining helpers into `queue/stage-handlers.service.ts` | COMPLETE | None |
| `SkillSynthesisService.start()` calls `stageHandlers.registerStageHandlers()` | COMPLETE | Shape is `registerStageHandlers(this)` rather than `()` — necessary to stay cycle-free per tsyringe, documented and justified, not a deviation in substance |
| Registration above both early returns | COMPLETE | Verified by mutation, not inspection |
| `queueItemId` guard | COMPLETE | Confirmed 0 occurrences in both new files; guard spec run explicitly and green |
| Optional injection (`archaeologist`, `judgePanel`, `replayValidator`, `triggerEval`) preserved | COMPLETE | All four still `{isOptional: true}`; three phase-3 gates still conditional |
| `prefilter` passes `force: true` | COMPLETE | Present with full docblock, unchanged |
| `dependsOn` NULL for archaeology/judge-panel/trigger-eval | COMPLETE | Neither `enqueue` call passes `dependsOn` |
| `drain()` cannot throw | COMPLETE | No new throw paths; grep confirms zero `throw` statements in either new file |
| `replay` has handler, no producer | COMPLETE | `enqueueCandidateGates` still names only `judge-panel` and `trigger-eval` |
| Outcome-mapping contract unchanged | COMPLETE | Line-diff confirms byte-identical mappings; not unified across stages (deliberately, per the report's own reasoning, which holds up) |
| TASK_2026_253 (`TOKEN_SPENDING_STAGES` incl. `trigger-eval`, `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS`) carried across | COMPLETE | Both constants live untouched in their owning files (`skill-drain.service.ts`, `gates/trigger-eval.service.ts`); the new file only consumes them correctly |
| DI registration (token, register.ts, index.ts) | COMPLETE | Token, singleton registration, and barrel export all present and consistent with the existing pattern |

### Implicit Requirements NOT Addressed

None identified beyond what the implementation report itself already flags as deliberately out of scope (folding the three `readCandidateBodyFile` copies into one; widening `JudgePanelResult`/`TriggerEvalService` to carry `lane-failed`). Both are pre-existing, named follow-ups, not gaps introduced here.

## Edge Case Analysis

| Edge Case | Handled | How | Concern |
|---|---|---|---|
| Host with no `stageHandlers` resolved | YES | `this.stageHandlers?.registerStageHandlers(this)` optional-chains to a no-op | None |
| Host with `stageHandlers` but no `drain` | YES | `registerStageHandlers` returns immediately on `if (!this.drain) return;` | None |
| Host with drain but no archaeologist/judgePanel/replayValidator/triggerEval | YES | Each stage registered conditionally; unregistered stage marked `skipped` by the drain itself | None |
| `enabled: false` at boot, later re-enabled | YES | Registration above the guard; verified by mutation | None |
| Constructing `SkillSynthesisService` by hand with fewer args (existing specs) | YES | Four specs updated for the new positional tail; full suite green | None |
| A stage that runs long (heartbeat) | YES | `withClaimHeartbeat` moved verbatim, unchanged interval/abort semantics | None |
| Circular DI (stage handlers ↔ synthesis service) | YES | Avoided by design — `SkillStageWorkers` port passed at call time instead of injected | None |

## Integration Risk Assessment

| Integration | Failure Probability | Impact | Mitigation |
|---|---|---|---|
| `SkillSynthesisService` ↔ `SkillStageHandlersService` (new DI edge) | LOW | Registration silently missing | Optional injection + mutation-verified ordering |
| `stage-handlers.service.ts` ↔ `lane-runner.service.ts` (`queueItemId` boundary) | LOW | Double-write queue transition on lane failure | Mechanical directory-wide guard spec, confirmed green |
| Six positional-constructor consumers (specs + any production caller) | LOW | Wrong argument bound to wrong parameter | `npx tsc` across skill-synthesis, rpc-handlers, thoth-runtime, cli-engine, both apps — all green; would have caught a positional mismatch |

## Test Gate Results

| Suite | Baseline (per task brief) | Baseline (developer-recorded / independently re-run) | This run |
|---|---|---|---|
| `skill-synthesis` tests | 1268 passed / 37 skipped | 1268 passed / 37 skipped | **1268 passed / 37 skipped** — match |
| `rpc-handlers` tests | 2132 passed / 31 skipped | 2142 passed / 31 skipped | **2142 passed / 31 skipped** — matches developer's own recorded baseline; skip count matches the task brief too |
| `skill-synthesis` typecheck | — | green | **green** |
| Guard spec (`skill-drain.failures.spec.ts`) | — | 9 passed | **9 passed** |
| Rule-1 mutation (registration ordering) | — | 1 failed / 39 passed → 40 passed on restore | **reproduced identically**, then restored and reconfirmed 40/40 |
| Cross-consumer typecheck (skill-synthesis, rpc-handlers, thoth-runtime, cli-engine, ptah-extension-vscode, ptah-electron) | — | green | **green** |

No skip count rose anywhere. The rpc-handlers passed-count discrepancy against the task brief (2132 vs 2142) is a stale-baseline artifact, not a regression — see Paranoid Question 5.

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: None blocking. The only thing worth carrying forward is that the task brief's stated rpc-handlers baseline (2132) is stale relative to what's actually on this branch (2142, matching both the developer's own before/after measurement and my independent re-run) — cosmetic, not caused by this diff, but worth correcting at the source so it doesn't get cited as a discrepancy against a future change.

## What Robust Implementation Would Include

This already has what a bulletproof structural refactor needs: byte-level parity between removed and added code (verifiable, and I verified it rather than trusting the report), a reproduced mutation test for the one rule with no existing safety net, explicit re-verification of a substring guard that could easily have been assumed to "just work," and cross-consumer typechecking after a constructor-signature change. Nothing to add.
