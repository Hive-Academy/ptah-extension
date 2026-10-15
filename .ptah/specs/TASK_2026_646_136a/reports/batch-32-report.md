# Batch 32 report — Correlation-signal guards in agent-sdk

P1-C1, P1-C2, and P1-C3 are implemented. A successful budget stop publishes once whenever the registry record has an `agentId`, including a safety stop with no handoff record. A stop with no `agentId` warns and does not publish. Run-tag misses `missing-agent-id` and `invalid-agent-id` warn at most once per parent session. The registry port is `Pick<SubagentRegistryService, 'get'>`.

Jest and Nx were not run. The task forbids them; the team-leader verifies.

## Files

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.spec.ts`

`SubagentBudgetStopPayload`, the budget-stop registry class, `onStopFailed`, and both `stopFired` guards are unchanged. Both `degradation-audit: reported` markers remain (`post-tool-use-hook-handler.ts:125`, `:193`).

## P1-C1 — publish every real budget stop

`subagent-budget-monitor.ts:998-1013`. After `stopFired` and `stopped` are set, `notifyAll` runs when `registryRecord?.agentId` is set. `prepared.record` is no longer required. The payload is still `{ agentId, parentSessionId, timestamp }` only. When the stop succeeded and `agentId` is missing, `warn` at `:1009-1012` names `toolCallId` (and `sessionId`) and does not publish.

## P1-C2 — run-tag misses

`post-tool-use-hook-handler.ts:68` holds a `Set` of parent session ids. `logRunTagSkip` (`:143-169`) warns once per resolved parent session for `missing-agent-id` and `invalid-agent-id` (`:148-161`). The same message stays at `debug` for a tool that is not `Agent` or `Task` (`:163-168`), with `reason: 'not-an-agent-tool'`. `runTag` takes the closure session id (`:98-101`, called at `:230`) and resolves the parent with `resolveHookSessionId`. Logs carry `reason` and `toolName` only.

## P1-C3 — registry port

`post-tool-use-hook-handler.ts:2-6` imports `SubagentRegistryService` as a type from `@ptah-extension/vscode-core`. The constructor parameter at `:82-83` is `Pick<SubagentRegistryService, 'get'>`. `get` therefore returns `SubagentRecord | null`, not `| undefined`. The parameter stays optional.

## Spec cases

| Case | Where | What it pins |
| --- | --- | --- |
| (a) record-less safety stop publishes once | `subagent-budget-monitor.spec.ts:322-346` | Failed record write, output weight at the safety limit, one payload `{ agentId, parentSessionId, timestamp }`, `markInvoked` not called |
| (b) stop without an `agentId` warns and does not publish | `subagent-budget-monitor.spec.ts:348-368` | `agentId: ''`, `stopSubagent` once, `notifyAll` not called, one warn naming `toolCallId` |
| (c) second trigger after a stop publishes nothing | `subagent-budget-monitor.spec.ts:370-388` | One publish on the handoff stop, a later message leaves the list at length 1 and does not call `stopSubagent` again |
| (d) two `missing-agent-id` misses warn once | `post-tool-use-hook-handler.spec.ts:105-142` | Two Agent results in session `parent`, `warn` called once with `reason: 'missing-agent-id'` |
| (e) non-Agent tool logs at debug only | `post-tool-use-hook-handler.spec.ts:144-170` | `Read` result, `warn` not called, one `debug` with `reason: 'not-an-agent-tool'` |

`invalid-agent-id` uses the same once-per-session Set as `missing-agent-id`. The task did not ask for a separate spec.

## Assertions updated so existing cases match the new rules

- `subagent-budget-monitor.spec.ts:529-533`: a stop with no registry record (task id from `task_started`) now expects the missing-agent-id warn. It previously expected no warn.
- `post-tool-use-hook-handler.spec.ts:531-537` and `:678-682`: Bash paths now also emit the non-Agent debug line, so those tests count the original notice and abort messages instead of `debug` call count 1.
- `post-tool-use-hook-handler.spec.ts:93-100`: the lookup-throw test expected `debug`. The catch already warns (`subagent run tag lookup failed`) and does not call `debug`. The assertion now expects that warn. The `{ continue: true }` check is unchanged.
- `post-tool-use-hook-handler.spec.ts:49-62`: the run-tag lookup mock returns a `SubagentRecord` so it matches `Pick<SubagentRegistryService, 'get'>`.

## Not done

- No `nx test`, `nx typecheck`, or `nx lint`. The task says the team-leader runs them.
- No git commit, push, or pull request. The task forbids git writes.
- `ptah_agent_report` was called once as `ptah_agent_report` and once as `mcp__ptah__ptah_agent_report`. Neither name is registered. The connected MCP server is `tasks` (automations) only. Treated as not delivered.
