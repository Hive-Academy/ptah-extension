# TASK_2025_185: Graceful Re-Steering — Stop Killing CLI Agent Sessions

## Task Type: BUGFIX

## Priority: P1 (Critical UX)

## Created: 2026-03-08

## Problem

When a user sends a new message while CLI agents (Gemini, Ptah CLI, Copilot) are still running, the entire SDK session is aborted. This kills ALL active subagents and their in-progress MCP tool calls, causing:

- "Tool execution interrupted — session ended before completion" errors
- Loss of partial work from agents that were mid-execution
- Poor UX — users lose 15+ minutes of agent work

## Root Cause Analysis

**Kill chain** (from log analysis):

1. User sends new message while agents running
2. `ChatStore.interruptAndSend()` calls `chat:abort` RPC
3. `SessionLifecycleManager.endSession()` aborts entire SDK session
4. `subagentRegistry.markAllInterrupted()` marks all agents
5. `abortController.abort()` kills SDK session
6. All CLI agent processes lose MCP connections → tools fail

**Key finding**: No global timeout is responsible. The 1-hour agent timeout and undefined maxTurns are NOT the cause. The re-steering UX pattern is the culprit.

## Affected Files

### Backend

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` — endSession() abort logic
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — interrupt/abort methods
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` — chat:abort/continue RPC

### Frontend

- Chat store (interruptAndSend logic)
- Message sender service

## Requirements

1. **Re-steering should NOT kill running subagents** — queue the new message, let agents finish their current tool call
2. **Add user confirmation** when re-steering with active subagents ("X agents running. Interrupt?")
3. **Graceful agent completion** — if user confirms interrupt, let agents finish current tool call before aborting
4. **Background agent survival** — agents already marked as background should NEVER be killed by re-steering

## Strategy

BUGFIX streamlined: Architect → Team-Leader → Developers → QA
