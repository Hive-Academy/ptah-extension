# Batch A4 — subagent lane

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\utils\subagent-progress.utils.ts` — pure `subagentProgressText` with summary, tool, description, and null precedence (A4.1).
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\utils\subagent-progress.utils.spec.ts` — one case per precedence branch (A4.1).
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.ts` — standalone OnPush lane with the shared execution header, live duration from the monitor's shared tick, progress, counts, background and token metadata, context-gated actions, steer input, keyed RPC error, usage and facts inside details, and child execution nodes with permission forwarding (A4.2).
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.spec.ts` — covers header/details, action flags, steer failure/success, keyed error, background progress, and empty states (A4.2).
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\index.ts` — exports `SubagentLaneComponent` through the existing chat barrel (A4.2).
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.ts` — renders the new lane using the selected record and agent-node children, forwards permission events, moves the usage summary into the lane, and retains the transcript fallback (A4.3).
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts` — asserts the new element and absence of the top-level usage summary; updates former execution-node expectations (A4.3).

## Decisions

- Use the existing `ExecutionHeaderComponent` and `AgentSteerInputComponent`, and derive actions from `SessionAgentTrayService.contextsFor(sessionId)`. Evidence: plan §4 and the inspector's steer path. Reversible: yes.
- Count structured child nodes when they report tools, otherwise use the record's `toolUses`; leave files at the structured distinct-file count. Evidence: plan §4 and `summarizeExecutionNodes`. Reversible: yes.
- Keep the saved-transcript fallback only when the live agent node is absent. Evidence: A4.3 explicitly retains the fallback; showing it beside a live node would be misleading. Reversible: yes.
- Keep the existing `rail-lane-enter` styles, outer tabpanel, `laneBlocks()`, and `track block.key` untouched (Risk 1). The A4.3 edit was confined to the subagent template and its imports; current line positions were used instead of the stale plan offsets (Risk 2). Reversible: yes.
- Copy the bubble's progress precedence into a pure utility without changing the bubble (Risk 10). Reversible: yes.

## Verification and remaining work

- No test, typecheck, lint, build, serve, or e2e command was run, as required by the lane brief.
- Scoped `ptah_get_diagnostics` was attempted twice after edits. Both calls returned *unavailable* because the TypeScript check remained running past the tool's 45-second limit; they did not report a pass or errors.
- The orchestrator should run these exact scoped checks, one at a time:

  1. `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1` (confirm the header says 2 projects)
  2. `npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`
  3. `npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`

- Phase A screenshots and visual review remain with the orchestrator after A4 and A4b; this lane could not capture them under the assigned file scope and no-serve rule.
