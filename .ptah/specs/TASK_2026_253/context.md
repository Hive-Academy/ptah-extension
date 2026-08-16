# Context

## What is wrong

`skill-drain.service.ts` declares which stages cost money:

```ts
const TOKEN_SPENDING_STAGES: ReadonlySet<SkillQueueStage> = new Set<SkillQueueStage>(['synthesis', 'cluster-synthesis', 'judge', 'judge-panel', 'replay', 'archaeology', 'digest']);
```

Its comment says the complement — `prefilter`, `embedding`, `clustering`,
`trigger-eval` — "is pure local computation (regex prefilter, the local
embedder, cosine math) and therefore keeps running after the budget is gone."

Three of those four are genuinely local. `trigger-eval` is not.
`TriggerEvalService.generatePrompts` (`gates/trigger-eval.service.ts:542`)
calls `laneRunner.run` to generate the probe prompts it then scores locally.
The _scoring_ is local; the probe generation is an LLM call.

## Why it matters more than a miscounted number

Two drain behaviours read this set, and both are now wrong for `trigger-eval`:

1. **The per-item budget check.** `trigger-eval` rows continue to be dispatched
   after `maxTokensPerDay` is exhausted, because the drain believes they are
   free. They are not, so the daily ceiling is not a ceiling.
2. **Cheap-stages-first ordering above 80% of budget.** `STAGE_COST_RANK` puts
   `trigger-eval` at 3, below `judge` at 4 — so when the budget is nearly gone
   the drain deliberately _prefers_ a stage it thinks is free and that in fact
   spends.

The exposure is not marginal. `trigger-eval` and `judge-panel` are the only two
weekly stages with producers (`replay` has none — TASK_2026_245), and both are
chained off every successful `prefilter`, so `trigger-eval` is about half of all
weekly rows. TASK_2026_180 B4.6 raised the weekly cap from 4 to 400 against a
measured ~325 rows/week of demand, which means this stage went from at most a
handful of uncounted calls a week to potentially ~160.

The spend is not invisible everywhere: `LaneRunnerService` still records usage
into `SkillBudgetStore`, so the tokens land in the ledger. They are **counted
after the fact but not gated before it**, and the ordering heuristic actively
mis-ranks the stage.

## The decision this needs

Not a one-line set membership change. Adding `trigger-eval` to
`TOKEN_SPENDING_STAGES` is probably right, but it has consequences worth
deciding deliberately:

- It changes which stages survive an exhausted budget, so a host that is over
  budget stops measuring trigger quality entirely. That may be correct — it does
  spend — but it is a behaviour change to the weekly gate lane, not a bookkeeping
  fix.
- `STAGE_COST_RANK` needs revisiting at the same time. One LLM call is cheaper
  than `judge-panel`'s two-plus-escalation, so `trigger-eval` should probably sit
  between `judge` and `digest` rather than below all of them.
- The alternative reading is that `generatePrompts` should not be on the scoring
  path at all — the header of that service goes to some length to separate the
  measured path from the LLM one. If the probes could be generated once and
  cached per skill rather than per evaluation, the stage really would become
  local and the current set membership would become true. That is the more
  invasive fix and it is the one that matches the stage's documented intent.

Decide between "count it honestly" and "make it actually local" before editing.

## Related, do not conflate

- **TASK_2026_242** — the Skills settings panel shows one "Max items per run"
  number that is now false for two tiers. Different defect, same neighbourhood.
- **TASK_2026_245** — `replay` has a handler and no producer, deliberately.
- The `trigger-eval` gate also has a separate known defect recorded in
  `libs/backend/skill-synthesis/CLAUDE.md`: `TRIGGER_EVAL_SKIP_REASONS.noPrompts`
  collapses three different facts (no lane in this host, the lane failed, an
  unparseable reply) into one token, so a handler cannot tell a permanent skip
  from a retryable one. **Note the overlap**: `generatePrompts` returning `null`
  is exactly how a lane failure reaches that token. Whoever fixes this task will
  be standing in the same method, and the two are worth fixing together.

## Reference

- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts` —
  `TOKEN_SPENDING_STAGES`, `STAGE_COST_RANK`, and the per-item budget check.
- `libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.ts:542` —
  the `laneRunner.run` call.
- `libs/backend/skill-synthesis/CLAUDE.md` — the drain-semantics bullet, which
  repeats the "pure local computation" claim and must be corrected with the fix.

## Provenance

Found 2026-08-16 by TASK_2026_180 batch B4.6 while deriving the weekly tier's
item cap from a measured corpus. The batch text handed it the false premise;
the agent checked it rather than accepting it, and correctly declined to fix a
file outside its ownership. The orchestrator independently confirmed both the
`laneRunner.run` call site and the absence of `trigger-eval` from
`TOKEN_SPENDING_STAGES` before filing.
