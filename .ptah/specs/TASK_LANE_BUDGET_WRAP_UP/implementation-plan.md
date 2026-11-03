# Implementation plan — TASK_LANE_BUDGET_WRAP_UP (revised)

One backend batch implements `decisions.md` D1, D3, D4 and D5. The earlier plan (per-kind
table, wrap-up relaunch) is superseded. Paths are relative to the worktree root.
`RT` = `libs/backend/cli-agent-runtime/src/lib/cli-agents`.

## 1. Remove the lane tool-call budget (D1)

- `RT/lane-budget-guard.ts`: delete `steerAt`/`stopAt`, the steer action, the steer message
  and the `tool-call-budget` stop. Keep the repeat detection and the call counter (`toolCalls`,
  which D3 needs). Thresholds become `{ repeatAt }`.
- `RT/agent-spawn-environment.service.ts`: `resolveLaneGuardThresholds` reads only
  `laneRepeatCallStopAt` (default 20; an invalid value falls back to the default with one
  warning).
- `RT/agent-process-manager.service.ts`: drop `steerLane` and the steer branch. Keep the
  repeat-call stop path.
- Remove the keys `agentOrchestration.laneToolCallSteerAt` / `laneToolCallStopAt` from:
  - `libs/backend/platform-core/src/file-settings-keys.ts` (key list and defaults);
  - `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`;
  - `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` (get + set config);
  - `libs/shared/src/lib/types/rpc/rpc-auth.types.ts`;
  - `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (the pair validation
    and write order go away);
  - `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.{logic,component}.ts`
    (only the repeat field remains).
- `libs/shared/src/lib/types/agent-process.types.ts`: `LaneStopReason = 'repeat-call'`.

## 2. Honest completion signal (D3)

- `LaneCompletionSignal` gets `stopReason?`, `toolCalls?` and `queuedMessagesDropped?`. These
  are filled from the tracked record and the guard at exit.
- `RT/lane-completion-notifier.service.ts` `verdictOf`: a host stop with `stopReason` is judged
  by its deliverables like a completed lane. The envelope prints the reason and the count.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.ts`: remove the
  `tool-call-budget` case and keep `repeat-call`.

## 3. Resume gate (D4)

`RT/lane-resume-gate.ts`: `RESUME_GATE_MAX_CONTEXT_TOKENS = 150_000`, with a comment that gives
the cache-economics reason.

## 4. Lane text (D5)

- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` §8 (~262)
  and `.../orchestration/references/lane-assignment.md` (~97): no call ceiling, repeated-call
  loop stop, skeleton-first deliverable.
- Also update any lane prompt text in the runtime that names a call budget.

## Verify

Run `npm run verify -- -p <changed @ptah-extension/* projects>,ptah-electron,ptah-extension-vscode`.
Nx names are scoped, for example `@ptah-extension/cli-agent-runtime`.
