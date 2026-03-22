# TASK_2025_213: Subagent Interruption & Resume State Management

**Type**: BUGFIX
**Priority**: Medium
**Created**: 2026-03-22
**Status**: Planned
**Related**: TASK_2025_211 (resume badge tracking), TASK_2025_109 (context injection)

## Problem Statement

Two related bugs in subagent lifecycle management:

### Bug 1: Stale interrupted subagent records persist in registry

When a subagent is interrupted and then effectively resumed (via a fresh agent completing the same work), the **old interrupted record is never cleared** from `SubagentRegistryService`. This causes:

- The context injection (`chat:continue` RPC) keeps telling Claude about the old interrupted agent on every user message
- Claude repeatedly explains the old agent was "already completed" (see screenshot evidence)
- The `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prefix is injected with stale data indefinitely (until 24hr TTL expires)
- Wastes context tokens and confuses the conversation flow

**Root cause**: `SubagentRegistryService` has no mechanism to clear/mark-completed an interrupted record when:

- A fresh agent of the same type completes the same work
- The user explicitly acknowledges the interruption and moves on
- Claude determines the work was already completed

**Evidence**: User saw Claude repeatedly reporting `ab6e9b5d22d70b788` as interrupted even though "its work was already completed" — the system kept flagging it in the SYSTEM CONTEXT on every continue.

### Bug 2: Tool permission denial doesn't directly mark subagent as interrupted

When a user denies a tool permission within a subagent (hard deny), the flow is:

1. SDK receives `interrupt: true` from permission handler
2. SDK sends completion events (subagent status → `'complete'`)
3. `_lastDenyWasHardInterrupt` flag is set
4. Session stats arrive → `markLastAgentAsInterrupted()` post-processes the tree

This indirect path has timing issues:

- If the parent session is aborted BEFORE session stats arrive, the hard deny flag may not be consumed
- If there are multiple agents, only the LAST agent gets marked (others stay `'complete'`)
- The subagent node transitions `'complete'` → `'interrupted'` via post-processing rather than being directly marked

## Affected Files

### Backend (subagent registry):

- `libs/backend/vscode-core/src/services/subagent-registry.service.ts` — No `markCompleted()` or `clearInterrupted()` method exists
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` — Context injection uses stale registry data (lines 780-865)
- `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` — SubagentStop hook only fires on graceful completion, not on effective resume

### Frontend (permission denial flow):

- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` — Hard deny flag consumption (lines 702-718)
- `libs/frontend/chat/src/lib/services/chat-store/message-finalization.service.ts` — `markLastAgentAsInterrupted()` only marks the last agent (lines 427-489)
- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` — Hard deny flag tracking

## Proposed Fixes

### Fix 1: Clear stale interrupted records on effective resume

**Option A**: When the context injection fires and Claude spawns a fresh agent (not a resume), detect that the old work was superseded and clear the old record from the registry.

**Option B**: Add a `markEffectivelyResumed(toolCallId)` method to `SubagentRegistryService` that transitions `interrupted` → `completed`. Call it when:

- A new agent of the same type completes successfully in the same session
- Claude explicitly states the interrupted work is done

**Option C** (simplest): In the context injection, clear the interrupted record from the registry AFTER injecting the context. The record was already presented to Claude; keeping it around only causes re-injection on subsequent messages. If Claude fails to resume, the user can re-interrupt to recreate the record.

### Fix 2: Improve permission denial interruption marking

- When `interrupt: true` is sent from permission handler, emit a stream event that directly marks the subagent as interrupted
- Don't rely on the indirect `markLastAgentAsInterrupted()` post-processing
- Handle the case where multiple agents exist (not just the last one)

## Testing Notes

- Test with multiple subagents of the same type (e.g., two backend-developers)
- Test permission deny → parent abort timing
- Test that cleared records don't re-appear on next continue
- Test that genuinely interrupted (still-running-work) agents ARE still reported
