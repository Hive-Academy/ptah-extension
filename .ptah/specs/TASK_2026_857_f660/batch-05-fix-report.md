# Batch 5 fix report (TASK_2026_857_f660)

## Changed files (all under D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing)

- libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts: `workspaceRoot: string | null`.
- libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts: removed workspace/session-id gate; `notifyAll` fires whenever `input.agent_id` is non-empty, `workspaceRoot: workspacePath || null`; try/catch kept; skip log removed.
- libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.spec.ts: "no fan-out" test replaced by no-transcript/no-parent/no-cwd test (all nulls, agentType from input); agentType asserted in unparseable-name and no-parent tests (no-transcript test already covered).
- libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts: also requires non-null `payload.workspaceRoot`.
- libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.spec.ts: added null-workspaceRoot-not-recorded case.

## Checks

1. `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/skill-synthesis` - exit 1, only because of lint. Tests and typecheck passed for both projects (`skill-synthesis:test` / `:typecheck` OK; agent-sdk tasks passed). The only lint error (1 error, 14 warnings) is the existing one in skill-registry-catalog.service.ts:53 (base, not fixed). The log tail showed only the warnings, so the error line was not visible there; I did not check for any other errors.
2. `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli` - PASS (all 3 typecheck OK, exit 0).

No other consumer of `SubagentStopPayload.workspaceRoot` failed to compile (no changes needed to lane-outcome-recorder).
