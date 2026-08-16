---
id: TASK_2026_253
status: done
type: BUGFIX
title: >-
  trigger-eval spends lane tokens that TOKEN_SPENDING_STAGES does not count,
  so the drain's budget gate under-reads weekly cost
description: >-
  `TOKEN_SPENDING_STAGES` in
  `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts` lists
  seven stages and deliberately excludes `trigger-eval`, on the documented
  premise that its complement is "pure local computation (regex prefilter, the
  local embedder, cosine math)". That premise is false for `trigger-eval`. Its
  SCORING path is local, but `TriggerEvalService.generatePrompts`
  (`libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.ts:542`)
  calls `laneRunner.run` to generate the probe prompts, so every `trigger-eval`
  row makes one LLM call. The consequence is not a wrong number in a report —
  it is that the drain's per-item budget check and its "order cheap stages
  first above 80% of budget" rule both treat a token-spending stage as free.
  `trigger-eval` is also one of only two weekly stages with a producer, so it
  is roughly half of all weekly rows. Found 2026-08-16 by TASK_2026_180 B4.6
  while deriving the weekly cap, and confirmed by the orchestrator; the batch
  correctly did not fix it, as the file was outside its ownership. Pre-existing
  since phase 3, not introduced by the weekly-cap change.
---

# `trigger-eval` spends tokens the budget gate does not count

Machine-owned metadata carrier. Prose lives in `./context.md`.
