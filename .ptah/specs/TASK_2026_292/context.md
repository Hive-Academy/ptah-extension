# Context

## What the user saw

Tribunal, RELAY move, a Codex lane on the Plan phase. The lane produced its
plan, the conductor asked the user a checkpoint question, the user answered,
and the conductor said:

> The Codex Plan lane has been re-spawned with your decision.

The tool call in the transcript is `mcp__ptah__ptah_agent_spawn`. Two things
went wrong at once:

1. **The Codex process did not continue the thread it had just written a plan
   in.** It started cold, re-ran its web searches and shell calls, and had no
   memory of the plan it produced a minute earlier.
2. **The panel grew a tile.** The `PLAN / Codex` lane tile shows the new run,
   and a separate closable `Codex CLI — DONE` tile appeared for the old one.

Both follow from the same missing capability, not from two separate bugs.

## Root cause

### 1. The continuation primitive exists and is not on the MCP surface

`AgentProcessManager.continueConversation(agentId, message)`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:760`)
is exactly the operation the conductor wanted. It:

- looks up the **existing** tracked agent by `agentId`,
- cancels the pending cleanup and deferred-exit timers,
- flips `status` back to `running` and re-emits `agent:spawned` with the **same
  id** (so the frontend re-opens the existing card rather than adding one —
  `AgentMonitorStore.onAgentSpawned` takes the `existingIndex !== -1` branch at
  `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:542`),
- calls `sdkHandle.continue(message)`.

Codex implements it as another turn on the captured thread:

```ts
// libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:563
supportsContinuation: () => true,
continue: (message: string) => Promise.resolve({ done: runTurn(message) }),
```

The only caller is RPC `agent:continue`
(`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:703`), and
the only caller of _that_ is the webview's `agent-continue-input` component —
the "Send a follow-up…" box visible at the bottom of the lane tile in the
screenshot. **A human can do this from the UI. The conductor cannot.**

The MCP agent namespace
(`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:574-720`)
dispatches `ptah_agent_spawn`, `_status`, `_read`, `_steer`, `_stop`, `_list`.
There is no `_continue`, and `ptah.agent.*` in `agent-namespace.builder.ts` has
no `continue` method either.

### 2. `ptah_agent_steer` is not a workaround

`AgentProcessManager.steer()` (`:741-757`) routes to `sdkHandle.steer` — only
the Pi adapter implements it — and otherwise falls back to
`tracked.process.stdin`, which is `null` for every SDK-based adapter. For Codex
it throws _"does not support stdin steering"_. It also requires the agent to be
`running`, which a finished plan lane is not.

### 3. `resume_session_id` is a weaker fallback, and the skill never points at it

`ptah_agent_spawn({ resume_session_id })` does work — Codex honours it via
`codex.resumeThread(...)` (`codex-cli.adapter.ts:492`). But it allocates a new
`agentId` and a new tracked entry, so continuity depends on the frontend
collapsing two cards after the fact rather than on there having been one card.

And the conductor was never told to use it here. `references/relay.md:143`
(Step 3, checkpoints) says:

> …then re-spawn the same lane with a `## User Decisions` section in the prompt.

`resume_session_id` appears only in the **timeout** guidance (`:136`) and the
closing bullet _"Resume over respawn on timeout"_ (`:158`). The conductor
followed the skill correctly; the skill is what is wrong.

### 4. Stale capability warning misreports which CLIs can resume

```ts
// agent-process-manager.service.ts:411
if (request.resumeSessionId && request.cli !== 'copilot') {
  this.logger.warn(`[AgentProcessManager] resume_session_id provided for ${request.cli} ` + `which does not support session resume`);
}
```

Codex, Cursor, opencode, Antigravity and Pi all accept `resumeSessionId` in
their `runSdk` options. The guard is log-only so it changes no behaviour, but
it is the line a developer debugging this would read and believe. It also reads
`request.cli`, which is `undefined` when the CLI was auto-detected, rather than
the resolved `cli`.

### 5. Why a second tile appears

`TribunalStateService.matchLaneToAgent`
(`libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:457-483`)
binds a lane to an agent by, in order: the `[tribunal:<laneId>]` tag in the
task text, `lane.agentId`, then the `cli` + `displayName` + `model` triple. It
scans `agentsForSession()`, which is derived from `agents()` — sorted
**newest-first** (`agent-monitor.store.ts:322`).

So after a respawn both agents match the Plan lane, the newest wins, and the
old completed one is left unclaimed. `reconcileSlice` (`:356-397`) then treats
it as a late panelist, synthesizes a `dynamic-<agentId>` lane and appends a
vendor tile. That is the `Codex CLI — DONE` tile.

`AgentMonitorStore.findReplacementCard` (`:864-886`) would have merged the two
cards, but it only fires on `resumedFromAgentId` (set by the `agent:resumeCliSession`
RPC, i.e. the UI resume button) or on a matching `cliSessionId`. A plain spawn
carries neither.

## Constraint worth designing around

Completed agents are evicted from the tracking map after
`COMPLETED_AGENT_TTL = 30 * 60 * 1000`
(`agent-process-manager-helpers.ts:31`). A relay checkpoint that waits on a
slow human can outlive that window, so continuation cannot be the _only_ path —
`resume_session_id` stays the correct fallback once the agent has aged out.
The two need to be presented to the conductor as a pair with a clear rule.

## Proposed shape of the fix

1. **Add `ptah_agent_continue { agentId, message }`** to the MCP agent surface,
   dispatching to `AgentProcessManager.continueConversation`. Surface the typed
   `AgentContinueError` codes (`not_found` / `unsupported` / `busy`) so the
   conductor can fall back deterministically instead of guessing.
2. **Report continuability in `ptah_agent_status`.** `supportsContinuation`
   already rides on `AgentProcessInfo` (`:545-547`); the status formatter does
   not print it. Without it the conductor cannot tell a continuable lane from
   one that must be resumed.
3. **Rewrite relay.md Step 3 and vendor-panel §3** around the rule: follow-up
   to a finished lane is `ptah_agent_continue`; on `not_found` (aged out) or
   `unsupported`, fall back to `ptah_agent_spawn({ resume_session_id })` read
   off `ptah_agent_status`; a cold respawn is the last resort and must be
   declared as one in the summary. Same edit applies to
   `skills/orchestration/references/cli-agent-delegation.md`, which teaches the
   same spawn/poll/read loop.
4. **Fix the `:411` warning** to branch on the resolved `cli` and on real
   adapter capability rather than a hardcoded `'copilot'`.
5. **Tribunal lane binding (lower priority once 1–3 land).** Decide what a lane
   does when two agents match it. Options: prefer the _oldest_ unclaimed agent
   for a tagged lane so the phase tile keeps its history; or teach
   `reconcileSlice` to skip an agent that a lane previously owned instead of
   promoting it to a dynamic tile. This is only reachable through the cold
   respawn path, so it may be sufficient to leave it once the conductor stops
   taking that path.

## Acceptance criteria

- A conductor can send a follow-up to a completed Codex lane and the lane's CLI
  session continues — the reply demonstrates knowledge of the prior turn.
- No new tile appears in the Tribunal panel for that follow-up; the phase lane
  tile shows the continued run.
- `ptah_agent_status` tells the conductor whether an agent can be continued.
- The relay and orchestration skill docs name `ptah_agent_continue` as the
  follow-up verb, with the resume/respawn fallback ladder spelled out.
- A spec pins the case where the agent has aged past `COMPLETED_AGENT_TTL`: the
  continue call fails with `not_found` and the documented fallback is a
  `resume_session_id` spawn.

## Files touched (expected)

| Path                                                                                                          | Why                                                  |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`                    | new tool definition; `ptah_agent_status` description |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`                         | dispatch case                                        |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`                      | result + continuability formatting                   |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`           | `ptah.agent.continue`                                |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`                          | stale resume warning at `:411`                       |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/relay.md`                     | Step 3 follow-up rule                                |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/vendor-panel.md`              | spawn/poll/read loop                                 |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/cli-agent-delegation.md` | same loop, orchestration copy                        |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts`                                     | lane rebinding (item 5)                              |
