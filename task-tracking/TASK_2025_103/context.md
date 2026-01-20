# Task Context - TASK_2025_103

## User Intent

Add subagent resumption capability so users can continue interrupted subagent executions instead of starting from scratch. Based on Claude SDK's native subagent resumption feature.

## Conversation Summary

### Research Already Completed

**SDK Documentation Analysis**:

- Subagents can be resumed using `resume: sessionId` parameter
- Need to capture `agentId` from Task tool result (format: "agentId: a5a5221")
- Resume prompt: `Resume agent ${agentId} and continue where you left off`
- Resumed subagents retain full conversation history (tool calls, results, reasoning)

**Codebase Analysis** (Explore agent findings):

- ✅ Parent `sessionId` tracked in tab state and session metadata
- ✅ `agentId` (stable identifier) captured at SubagentStart hook
- ✅ `agentType` available from hook events and ExecutionNode
- ✅ Summary content stored in agent-{agentId}.jsonl files
- ✅ Message history persisted in session JSONL files
- ✅ Interruption detection via `status: 'interrupted'` on nodes

**Missing Components**:

- SubagentRegistry to track `(sessionId, agentId, agentType, status)` tuples
- Resumption state tracking (which subagents are resumable vs complete)
- UI entry point ("Resume" button on interrupted agent bubbles)
- Backend RPC handler for `resumeSubagent(sessionId, agentId)`

## Technical Context

- Branch: feature/sdk-only-migration (current)
- Created: 2026-01-18
- Type: FEATURE
- Complexity: Medium (multiple components but well-understood architecture)

## Execution Strategy

FEATURE strategy with research phase SKIPPED (already complete):

1. project-manager → Requirements
2. software-architect → Implementation plan
3. team-leader → Task decomposition & development
4. QA (user choice)
5. Git operations
6. modernization-detector

## Key References

- SDK Docs: https://platform.claude.com/docs/en/agent-sdk/subagents#resuming-subagents
- Agent Session Watcher: libs/backend/vscode-core/src/services/agent-session-watcher.service.ts
- SDK Agent Adapter: libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts
- Session Lifecycle Manager: libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts
- Execution Tree Builder: libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts
