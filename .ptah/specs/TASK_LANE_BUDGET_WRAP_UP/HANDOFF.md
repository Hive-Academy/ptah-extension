# HANDOFF — TASK_LANE_BUDGET_WRAP_UP

Worktree: `/home/amun/ptah-extension/.claude-worktrees/fix-lane-budget-wrap-up-aef7114fd22f`
Branch: `fix/lane-budget-wrap-up` (from `main` at `30b50f788`). There are no commits yet.

## Goal

Background CLI lanes should end predictably and never lose their work. The user reviewed the
design and decided the following (recorded in `decisions.md`):

1. Subagents keep the existing context-budget caps and the handoff flow. Do not touch them.
2. Lanes keep their vendor CLI context behaviour:
   - no tool-call budget, no steer, no Ptah context rotation;
   - remove `agentOrchestration.laneToolCallSteerAt` / `laneToolCallStopAt` everywhere;
   - keep only the repeat-call loop stop (`laneRepeatCallStopAt`, default 20).
3. The completion signal and envelope must report `stopReason`, `toolCalls` and
   `queuedMessagesDropped`. A lane the host stopped is judged by its deliverables, not marked
   `failed`.
4. The resume-gate context limit goes from 60k to 150k (`RESUME_GATE_MAX_CONTEXT_TOKENS`).
5. The lane skill text must match the runtime: no call ceiling, a skeleton-first deliverable.
6. Out of scope on this branch:
   - the Codex-only caps (`codexAutoCompactTokens`, `codexToolOutputTokenLimit`), which go
     with the user's separate Codex revamp; do not touch the Codex adapter;
   - a Headroom-style lane compression proxy, which is a separate pilot task;
   - tokens/cost on lane outcome records, which is deferred.

## Done

- The old design (per-task-kind budgets and a wrap-up relaunch) was implemented, rejected and
  reverted. Its diff is kept in `batch-A-superseded.patch` for reference only. Do NOT reapply
  it.
- `decisions.md`, `implementation-plan.md` and `task.md` were rewritten for the new design.
- A backend-developer subagent implemented the plan as uncommitted edits in 40 files
  (+667/−871). See `git status`.
  - Runtime: guard, spawn env, process manager, tracked agent, message router, envelope,
    notifier, resume gate.
  - Shared types, platform-core keys, agent-sdk settings export, rpc-handlers, agent-wait tool.
  - Frontend: lane-guards settings, agent-monitor store, agent-card header.
  - Skill text in both `.claude/skills/...` and
    `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/...`.
- Its verification result is UNKNOWN. The subagent ended with the old session before it wrote
  `batch-1-report.md`. At handoff time the verify lock had no holders.

## In progress

The uncommitted subagent edits listed above. They are not reviewed or verified.

## Open problems and decisions

- Treat the edits as untrusted until verified and reviewed. In particular, check:
  - that no `laneToolCall*` or `tool-call-budget` reference is left (`git grep -n laneToolCall`,
    `git grep -n tool-call-budget`);
  - the `verdictOf` change in `lane-completion-notifier.service.ts`;
  - that `stopReason`/`toolCalls`/`queuedMessagesDropped` are populated at exit.
- Earlier, three unrelated `WorkspaceCoordinatorService` git tests failed in the
  cli-agent-runtime test run. Confirm whether they also fail on `main` before you treat them as
  pre-existing.
- Product gap (not this task): a new worktree workspace does not inherit the main checkout's
  plugin settings. `ptah-core` is therefore off there, and Ptah writes `skillOverrides` off
  for its skills (session-handoff, orchestration, agent-lanes). An open session keeps its
  overrides until restart. Offer the user a separate task.

## Key files

- `/home/amun/ptah-extension/.claude-worktrees/fix-lane-budget-wrap-up-aef7114fd22f/.ptah/specs/TASK_LANE_BUDGET_WRAP_UP/decisions.md`:
  binding decisions D1–D6.
- `.../TASK_LANE_BUDGET_WRAP_UP/implementation-plan.md`: file-by-file plan for the current
  design.
- `.../TASK_LANE_BUDGET_WRAP_UP/evidence-context-budget.md`: why lanes get no Ptah context
  handoff.
- `.../libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts`: repeat-only
  guard.
- `.../libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts`:
  verdict and envelope.
- `.../libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts`: the 150k limit.
- `.../libs/shared/src/lib/types/agent-process.types.ts`: `LaneStopReason` and the
  `LaneCompletionSignal` fields.

## Background work

None. The backend-developer subagent ended with the old session. No CLI lanes or child sessions
were started.

## Next steps

1. Read `decisions.md` and `implementation-plan.md`. Then review the full diff with `git diff`.
2. Run the scoped verification once, in the foreground, with a long timeout:
   `npm run verify -- -p @ptah-extension/shared,@ptah-extension/platform-core,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools,@ptah-extension/chat,@ptah-extension/chat-streaming,ptah-electron,ptah-extension-vscode,ptah-tui 2>&1 | tail -60`
3. Fix the failures that the change caused. Prove that any other failure also happens on
   `main`.
4. Get an independent review (code-logic-reviewer) of the diff. Address the confirmed findings.
5. Write `batch-1-report.md` with the files, the behaviour change and the verify result.
6. Commit in the foreground per `.commitlintrc.json`. Stage files by explicit path, including
   the task folder. A suggested subject is `fix(cli-agent-runtime,chat): drop lane tool-call
   budget, report stops`.
7. Push in the background and open a PR against `main` with `## Summary` and `## Test plan`.
   Watch CI and the reviews with `gh`, and address the actionable findings.
8. Never merge, force-push or remove the worktree.
