# TASK_2025_190: Codex SDK Headless Mode & Permission Bridge

## User Request

Implement Codex SDK headless mode improvements and permission bridge for the Ptah extension.

## Task Type

FEATURE

## Workflow

Partial (Architect -> Team-Leader -> QA)
Requirements well-defined from prior research.

## Scope

### 1. Add `sandboxMode` to Codex SDK Thread Options

- Currently not passed to SDK despite being supported
- Default to `workspace-write`, make configurable

### 2. Port CopilotPermissionBridge Pattern to Codex

- Create `CodexPermissionBridge` reusing `AgentPermissionRequest` RPC flow
- Reuse permission presets (readOnly, safeWrite, fullAuto)
- Intercept Codex SDK approval events via streaming API
- Forward to Ptah UI via existing RPC mechanism

### 3. User-Facing Permission Tier Setting

- Safe mode: `read-only` sandbox + `on-request` approval
- Standard mode: `workspace-write` sandbox + `on-failure` approval
- Full Auto mode: `danger-full-access` + `never` approval

### 4. Timeout Wrapper

- `Promise.race` with configurable timeout on `thread.run()`
- Prevent agent hangs (issue from analysis doc)

### 5. MCP Config Always Forwarded

- Ensure `mcp_servers` config is always passed to Codex SDK threads

### 6. PowerShell Env Var Fix

- Add `FORCE_COLOR=0`, `NO_COLOR=1` env vars to Codex process spawn

## Key Files

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-permission-bridge.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts`
- `libs/shared/src/lib/types/agent-permission.types.ts`
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

## Codex SDK Capabilities (from research)

- `@openai/codex-sdk`: `approvalMode: 'never' | 'on-request' | 'on-failure' | 'untrusted'`
- `sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access'`
- `runStreamed()` returns async generator of events
- `skipGitRepoCheck: true`
- Config via constructor: `new Codex({ config: { sandbox_mode, approval_policy, ... } })`

## Created

2026-03-13
