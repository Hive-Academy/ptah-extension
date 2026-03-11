# Task Context - TASK_2025_094

## Overview

This task covers multiple related issues with streaming and session history:

1. **Streaming Disconnection** (streaming-fix-summary.md) - Fixed tool_result loss and premature finalization
2. **Session History Replay** (investigation-report.md) - Fixed Task tools not rendering as agent bubbles

## Documents

| Document                   | Description                                                 |
| -------------------------- | ----------------------------------------------------------- |
| `streaming-fix-summary.md` | Fixes for live streaming disconnection and tool_result loss |
| `investigation-report.md`  | Fixes for session history sub-agent rendering               |
| `context.md`               | This file - task context and overview                       |

---

## Issue 1: Streaming Disconnection (Previous Session)

**Problem:** Frontend UI getting detached from streaming when tool calls executed.

**Root Causes:**

- MessageId mismatch between streaming and complete messages
- Premature finalization clearing streamingState
- UI visibility tied to streaming status instead of content existence

**Fixes:** See `streaming-fix-summary.md` for details.

---

## Issue 2: Session History Sub-Agent Rendering (Current Session)

**Problem:** Task tools appearing as collapsed normal tools instead of showing agent bubbles with nested execution.

**User Quote:**

> "i do believe its much bigger than what you are trying to fix and is complex and extended from backend to frontend and how we build the executionTree"

**Root Cause:** `buildToolChildren()` created MESSAGE nodes instead of AGENT nodes from `agent_start` events.

**Fix:** Create proper AGENT type ExecutionNodes that `InlineAgentBubbleComponent` can render.

**Details:** See `investigation-report.md` for complete investigation timeline and fix.

---

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-28
- Type: BUGFIX
- Complexity: High (end-to-end pipeline from backend to frontend)
- Related Task: TASK_2025_093 (temp_id removal, session handling)

## Key Files

**Backend (Event Creation):**

- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` - Creates FlatStreamEventUnion from JSONL

**Frontend (Event Processing & Tree Building):**

- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` - Stores events in StreamingState
- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` - Builds ExecutionNode tree
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` - Orchestrates session loading

**UI Components:**

- `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts` - Renders nodes by type
- `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts` - Renders agent bubbles

---

## Testing Checklist

### Streaming (from streaming-fix-summary.md)

- [ ] Basic tool calls complete properly
- [ ] Multiple tool calls work
- [ ] Content persists after chat:complete
- [ ] Multi-turn conversation works
- [ ] Message queuing works

### Session History Replay (from investigation-report.md)

- [ ] Load session with single Task tool invocation
- [ ] Load session with multiple Task tool invocations
- [ ] Load session with nested Task tools (agent spawning agents)
- [ ] Verify agent bubble displays with correct agentType
- [ ] Verify nested tools/text display inside agent bubble
