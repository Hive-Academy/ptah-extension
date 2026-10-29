# Decisions — TASK_LANE_BUDGET_WRAP_UP

Revised 2026-10-29 after the user's review. The earlier per-task-kind budget table and the
wrap-up relaunch (old D1/D2) are dropped. Batch A implemented the table; its diff is kept as
`batch-A-superseded.patch` and has been reverted.

## Why the count budget goes

Lane cost is roughly requests × context, and it is dominated by cached context (97% of input is
a cache read, which costs about 0.1×). A tool-call count therefore says little about cost. A
hard stop at N calls also throws away everything spent so far, often before the deliverable
exists. That is the worst outcome for both tokens and quality. The vendor CLIs already manage
their own context (Claude Code auto-compact, Codex auto-compact, Copilot compaction). The
evidence (`evidence-context-budget.md`) shows that no adapter reports a per-request context
figure mid-turn, so a Ptah-side context handoff for lanes would be blind, and it would
duplicate native compaction.

## D1. Subagents keep caps, lanes keep vendor behaviour

- Subagents keep the existing context-budget flow unchanged: handoff tokens, the weighted stop,
  the near-budget notice and handoff records.
- Lanes get no tool-call budget, no steer and no Ptah context rotation. The settings
  `agentOrchestration.laneToolCallSteerAt` and `laneToolCallStopAt` are removed everywhere:
  - settings keys, defaults and export list;
  - RPC get/set config;
  - shared types;
  - settings UI.
- `LaneStopReason` loses `'tool-call-budget'`.
- Kept: the repeat-call stop (`laneRepeatCallStopAt`, default 20) as a loop safety net only.
  Twenty identical calls is a loop, not work.

## D2. No wrap-up machinery

Only a repeat-call loop can stop a lane now. It is rare, and a looping model is unlikely to
produce a good wrap-up. The final stop is therefore kept, and the envelope reports it honestly
(D3). Revisit this only if outcome records show that loop stops are common.

## D3. Completion signal says who stopped the lane and why

- New fields on the lane completion signal: `stopReason` (when the host stopped the lane),
  `toolCalls` (count at exit) and `queuedMessagesDropped` (when a stop discarded queued
  messages).
- Verdict: a lane the HOST stopped (repeat-call) is judged by its deliverables
  (`delivered` / `no-deliverable` / `unverified`) instead of always `failed`. `failed` again
  means a crash or a caller stop. The envelope text names the reason ("stopped by Ptah: repeated
  the same call 20 times").
- The agent-wait tool text loses the `tool-call-budget` case.

## D4. Resume-gate context limit 60k → 150k

With a warm cache (the 600 s idle gate still applies), a resume pays its first request at
cache-read price and then only the new tokens. At the measured 115k average that is about 11.5k
input-equivalent. A fresh lane pays its ~27k baseline uncached and then re-reads ~88k of what
the old lane held, about 140k+ input-equivalent. At 60k the gate picked the expensive path for
almost every lane. 150k still blocks near-window threads (58% of a 258k Codex window, 75% of a
200k Claude window).

## D5. Lane text agrees with the runtime

- The agent-lanes SKILL.md §8 "40 tool calls per lane" and lane-assignment.md's per-lane
  ceiling wording are replaced with the real rule: no call ceiling; a lane stopped only on a
  repeated-call loop; split work by scope, not by call count.
- Skeleton-first deliverable rule: a lane writes its deliverable file early (headings or
  stub) and fills it in as it goes, so any stop leaves usable output.

## D6. Out of scope on this branch

- Codex-only caps (`codexAutoCompactTokens`, `codexToolOutputTokenLimit`): to be removed as
  part of the user's separate Codex adapter revamp, not here.
- A global lane efficiency layer (Headroom-style compression proxy, cache-preserving mode,
  telemetry off, loopback only, off by default): a separate pilot task on one CLI, decided by
  measured per-lane tokens/cost and delivery rate.
