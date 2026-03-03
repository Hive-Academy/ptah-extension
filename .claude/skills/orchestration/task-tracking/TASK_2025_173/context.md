# TASK_2025_173: CLI Agent Session Resume-on-Click

## Type: FEATURE

## Status: IN_PROGRESS

## Workflow: Partial (Architect → Team-Leader → Developers)

## User Request

When a user clicks a CLI agent session card in the sidebar (from a loaded/resumed parent session), spawn a new process with resumeSessionId set to the stored cliSessionId, reconnecting to the Gemini/Copilot/PtahCli session where it left off.

## Existing Infrastructure (already implemented)

- **Gemini CLI adapter**: `--resume <sessionId>` flag in `buildCommand()` (gemini-cli.adapter.ts:276-281)
- **Copilot SDK adapter**: `client.resumeSession(sessionId, config)` (copilot-sdk.adapter.ts:422-459)
- **Ptah CLI adapter**: `resumeSession()` via SDK query builder (ptah-cli-adapter.ts:411-489)
- **CLI adapter interface**: `CliCommandOptions.resumeSessionId?: string` (cli-adapter.interface.ts:32-33)
- **AgentProcessManager**: `SpawnAgentRequest.resumeSessionId` field (agent-process-manager.service.ts:104-105)
- **CliSessionReference type**: Stores `cliSessionId` for resume (agent-process.types.ts:220-237)
- **SessionMetadataStore**: Persists `cliSessions[]` per parent session
- **chat:resume RPC**: Returns `cliSessions` in ChatResumeResult (chat-rpc.handlers.ts:902-919)

## What's Missing (the gap)

1. **Frontend**: No click handler on CLI session cards that triggers resume
2. **RPC method**: No `agent:resumeCliSession` RPC endpoint
3. **Backend wiring**: No code that takes a `CliSessionReference` and calls `AgentProcessManager.spawn()` with `resumeSessionId`

## Planned Flow

```
User clicks "Resume" on CLI agent card
  → Frontend emits RPC: agent:resumeCliSession { cliSessionId, cli, parentSessionId, task }
  → Backend RPC handler:
    1. Resolves AgentProcessManager via TOKEN
    2. Calls spawn({ cli, resumeSessionId: cliSessionId, parentSessionId, task, ... })
    3. Adapter uses resumeSessionId (--resume for Gemini, resumeSession() for Copilot)
    4. New process streams output back to the agent card (existing monitoring flow)
  → Frontend updates agent card status to "running"
```

## Files to Modify

1. **shared/types/rpc.types.ts** — Add RPC type for `agent:resumeCliSession`
2. **agent-rpc.handlers.ts** — Implement the RPC handler
3. **rpc-method-registration.service.ts** — Register the new RPC method
4. **agent-monitor.store.ts** — Add resume action/method
5. **agent-card.component.ts** — Add Resume button to non-running agent cards
