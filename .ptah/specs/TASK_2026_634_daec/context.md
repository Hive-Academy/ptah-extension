# Context: remaining TASK_2026_614 token-burn stages

## Origin

TASK_2026_614 closed on 2026-10-12. Its follow-up stages shipped:

- Stages D + E: PR #650.
- Stages F + G: PR #655 (Batches 16-33, 35, 36. Batch 34 dropped by user decision G-C).

A code check on 2026-10-12 found no implementation of Stages A, B and C on `main`, and Stage H was
never started. This task holds that remaining scope.

**Source of truth:** `../TASK_2026_614_327a/context.md`, sections "Stage A", "Stage B", "Stage C",
"Stage H", "Rules (carried over, strict)" and "Workspace lessons". Batch bodies for Stages A and B
are in `../TASK_2026_597_ab22/batches.md`. Read only the sections that 614's context names.
TASK_2026_627 (session budget handoff, PR #706) changed the same budget code after Stage H was
written, so re-verify each Stage H item against current source before you fix it.

## Scope

### Stage A — S3 rest

- A.1 597 Batches 12-15: Ollama window, proxied predicate, Responses translator, OpenCode lane config
  and usage split, strict MCP on proxied routes, cache flag, ledger cost, skill budget cache columns.
- A.2 `compaction:getConfig` / `compaction:setConfig` RPC with the one-shot migration of
  `compaction.threshold` into the file store. Not present in `libs/shared` on 2026-10-12.
- A.3 PR1-M2: a live change to `compaction.enabled` is not applied.
- A.4 Codex config TOML writer and RPC (opt-in, diff preview). Only
  `codex-lane-config.builder.ts` exists today.
- A.5 Frontend settings state, lane budgets card, usage displays and the no-cache hint.

### Stage B — S1b and S2

- B.1 `CodexExecRunner` and the adapter switch to the runner, with the dotted model-name matcher.
  Not present on 2026-10-12.
- B.2 Lane capture entries for tool M.

### Stage C — QA session

Small budgeted runs only. Experiment E2 (`autoCompactWindow`), N1 "after" measurement (needs user
approval), before/after screenshots, PR 3 scripted 2M-token session, one proxied-route run, the
transcript-fix check, and the final `compaction.subagentStopWeightedTokens` value (provisional
3,000,000). After Stage C, close TASK_2026_597_ab22.

### Stage H — F + G review follow-ups

H.1-H.14 as listed in 614's context (H.1 needs a user decision, H.11 is the deferred `stopped`
sub-agent status feature).

## Order

Stage H items that touch the same files can join Stage A batches. Then Stage A, Stage B, and
Stage C last. Keep batches small (about 4 files, at most 4 tasks), per 614's H.13 process note.
