# Context

## What happened

TASK_2026_180 turned the skill-synthesis pipeline into a queue-driven one. It
created a directory per new concern — `queue/`, `lanes/`, `gates/`,
`archaeology/`, `digest/`, `naming/` — and documented each in the lib's
`CLAUDE.md` under "Internal Structure".

The stage _dispatch_ layer is the exception. It went straight into
`skill-synthesis.service.ts`, which grew from **906 lines on `main` to 1929**.

That file now owns, in one class:

- service lifecycle (`start`, settings reads, the trigger wiring)
- `analyzeSession` and the prefilter path
- the RPC-backing manual promote / reject methods
- **`registerStageHandlers()` and the six `run*Stage` methods** — six unrelated
  stage protocols with their own outcome mappings
- the queue-chaining helpers: `enqueueArchaeology`, `enqueueCandidateGates`,
  `enqueueGate`, `gateTarget`, `gateClusterSessionIds`, `recordVerdictFallback`,
  `withClaimHeartbeat`, `candidateBody`

## Why it is worth doing

This is not "the file is long". It is that `SkillSynthesisService.start()` is
documented as **the registration seam** — a genuinely important role — and that
role is now buried among six stage protocols that have nothing to do with each
other beyond being dispatched from the same map.

Concrete costs already visible:

- **The stage-handler spec is the lib's largest**, and every new stage widens it.
- TASK_2026_180's B4.9 had to touch this file for a queue-transaction fix that
  has nothing to do with service lifecycle.
- The outcome-mapping rules (`lane-failed` handed over verbatim, gate-disabled →
  `skipped`, ran-but-unmeasured → `unscored`, measured → `done`) are a real
  contract documented at length in `CLAUDE.md`, and they are currently expressed
  six times in a file whose main subject is something else.

## Suggested shape

`libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts`

- owns `registerStageHandlers()` and the six `run*Stage` methods plus their
  private helpers
- takes the collaborators `SkillSynthesisService` already injects
  (`archaeologist`, `judgePanel`, `replayValidator`, `triggerEval`, `queue`,
  `store`), several of them `{isOptional: true}` — **preserve that**, because a
  CLI/e2e host has no LLM lane and registering a handler that can only answer
  "I am not here" spends a claim and an attempt
- `SkillSynthesisService.start()` calls `stageHandlers.registerStageHandlers()`

`SkillSynthesisService` keeps lifecycle, settings, `analyzeSession`, and the
RPC-backing methods.

## Rules the refactor must not break

These are all documented in `libs/backend/skill-synthesis/CLAUDE.md` and several
of them bit an agent during TASK_2026_180:

- **Registration happens ABOVE both of `start()`'s early returns.** Registering
  spends nothing, and a host that booted while `skillSynthesis.enabled` was false
  must still drain once the tray re-enables it. Moving registration below a guard
  is a silent regression that no test currently catches by construction.
- **Nothing outside `lanes/lane-runner.service.ts` may contain the string
  `queueItemId` — including in comments.** The guard is a substring scan over
  file text. Two agents were bitten by this.
- **`drain()` must never throw**, so no handler may propagate.
- **The `prefilter` handler passes `force: true` deliberately.** `enqueueAnalyze`
  already recorded the turn count in the same-process `analyzedSessions` map, so
  without it the drain's own callback is deduped out and the queue drains into a
  void.
- **`archaeology`, `judge-panel` and `trigger-eval` rows chain from the END of a
  successful prefilter, with `dependsOn` left NULL on purpose.** `ELIGIBLE_SQL`
  requires an ancestor to be `done`, so pointing them at the prefilter row would
  strand the dependent forever the first time that row ended `skipped`.
- **`replay` keeps its handler and no producer** (TASK_2026_245).
- The three phase-3 gates are registered **conditionally**, only when their
  service resolved.

## Verification bar

Behaviour-preserving. The gate is that `skill-synthesis` and `rpc-handlers` come
back at their recorded counts with **skip counts unchanged** — a rise means a
suite went dark, which is the specific failure mode a file split can cause when
a spec's imports quietly stop resolving.

Note `--testPathPattern` is ignored in this repo and `nx test <p>
--runTestsByPath` does not filter; use
`npx jest --config libs/backend/skill-synthesis/jest.config.ts --runTestsByPath <path>`.

## Provenance

Raised by the code-style review of TASK_2026_180 on 2026-08-16, confirmed by the
orchestrator against the source (line counts re-measured: 906 on `main`, 1929 at
`868da42d1`). Deliberately not folded into that task — its remaining batches were
feature work, and mixing a structural refactor into them would have made the
verification of both weaker.
