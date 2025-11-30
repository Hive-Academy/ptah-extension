# TASK_2025_033: Unified Agent Bubble Visual Hierarchy

## Context

**Created:** 2025-11-30
**Status:** Planning Complete
**Type:** Feature Enhancement / Refactoring

## User Intent

The user wants streaming mode to display agent executions with the same superior visual hierarchy as session replay mode:

1. **Separate Chat Bubbles:** Agents should appear as their own chat messages, not nested inside the parent assistant message
2. **Summary + Execution Sections:** Each agent bubble should have collapsible Summary and Execution sections
3. **Live Tool Count:** Show "(3 tools running...)" during streaming
4. **Visual Consistency:** Streaming and loaded sessions should look identical

## Problem Statement

Currently there are TWO different visual representations:

**Streaming Mode (JsonlMessageProcessor):**

- Agents are nested INSIDE the parent ExecutionNode tree
- Rendered via `AgentCardComponent` (simple collapsible card)
- No Summary/Execution separation
- Flat visual hierarchy

**Session Replay Mode (SessionReplayService):**

- Agents are SEPARATE `ExecutionChatMessage` objects with `agentInfo`
- Rendered via `AgentExecutionComponent` (dual-section layout)
- Summary + Execution sections with tool counts
- Superior visual organization

## Solution

Modify streaming to create separate agent messages (like replay does) instead of nesting agents in the tree:

1. When `JsonlMessageProcessor` detects a Task tool_use → Signal to create new agent message
2. `ChatStore` creates `ExecutionChatMessage` with `agentInfo` property
3. Nested content updates the agent message, not the parent tree
4. `AgentExecutionComponent` renders both streaming and loaded agents identically

## Key Files

- `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts` - JSONL processing
- `libs/frontend/chat/src/lib/services/session-replay.service.ts` - Session replay
- `libs/frontend/chat/src/lib/services/chat.store.ts` - State management
- `libs/frontend/chat/src/lib/components/organisms/agent-execution.component.ts` - Agent UI
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts` - Message rendering
- `libs/shared/src/lib/types/execution-node.types.ts` - Type definitions

## Deliverables

1. ✅ Research Report (`research-report.md`)
2. ✅ Implementation Plan (`implementation-plan.md`)
3. ⏳ Type updates (AgentInfo, ProcessingResult)
4. ⏳ JsonlMessageProcessor refactor
5. ⏳ ChatStore agent bubble handlers
6. ⏳ Component enhancements
7. ⏳ Testing and validation

## Constraints

- No backend changes required
- Must maintain backward compatibility with session loading
- Must not break existing streaming functionality
- Must handle nested agents (agents inside agents)

## Related Tasks

- TASK_2025_030: Chat streaming improvements
- TASK_2025_031: (if exists) Related UI work

## Conversation Summary

1. User asked about unifying streaming vs non-streaming node trees
2. Analyzed both services and identified root cause differences
3. User clarified they want the superior VISUAL hierarchy of replay mode
4. Proposed solution: Create separate agent messages during streaming
5. User approved approach, requested detailed implementation plan
6. Created comprehensive research report and implementation plan
