# Task Context - TASK_2025_006

**Created**: 2025-11-18
**Owner**: team-leader
**Task Type**: Event Relay System Implementation

## User Intent

Implement complete Event Relay System to fix critical gaps in Claude CLI event forwarding, increasing event coverage from 7% (1/15 types) to 100% (15/15 types).

## Problem Summary

From EVENT_SYSTEM_GAP_ANALYSIS.md:

**Current State**: Only MESSAGE_CHUNK events are being forwarded to the frontend webview. All other Claude CLI events (thinking, tool execution, permissions, agent lifecycle, session events, health updates, errors) are emitted by the backend but never reach the frontend.

**Root Cause**: The extension's `setupEventBusToWebviewBridge()` method in `angular-webview.provider.ts` only forwards message types ending with `:response` (request-response pairs). Streaming events like `chat:messageChunk`, `chat:thinking`, `chat:toolStart`, etc. don't follow this pattern and are ignored.

**Impact**: Users don't see:

- Claude's thinking/reasoning process
- Real-time tool execution status
- Permission request dialogs
- Nested agent execution timelines
- CLI health status
- Error notifications

## Solution Architecture

From EVENT_RELAY_IMPLEMENTATION_PLAN.md:

**5-Layer Implementation**:

1. **Layer 1 (Batch 1)**: Add 7 missing MESSAGE_TYPES constants + 9 payload interfaces
2. **Layer 2 (Batch 2)**: Create ClaudeEventRelayService to bridge EventBus → Webview
3. **Layer 3 (Batch 3)**: Add frontend subscriptions in ChatService for all 15 event types
4. **Layer 4 (Batch 4)**: Build 4 UI components (permission dialog, tool timeline, thinking display, agent timeline)
5. **Layer 5 (Batch 5)**: Manual testing and validation

## Key Technical Details

**Namespace Mapping**:

- Backend EventBus uses `claude:*` prefix (e.g., `claude:thinking`)
- Frontend webview expects `chat:*` prefix (e.g., `chat:thinking`)
- ClaudeEventRelayService bridges these two namespaces

**Event Types to Implement** (15 total):

1. MESSAGE_CHUNK (already working)
2. THINKING (new)
3. TOOL_START (new)
4. TOOL_PROGRESS (new)
5. TOOL_RESULT (new)
6. TOOL_ERROR (new)
7. PERMISSION_REQUESTED (new)
8. PERMISSION_RESPONDED (new)
9. AGENT_STARTED (existing, needs subscription)
10. AGENT_ACTIVITY (existing, needs subscription)
11. AGENT_COMPLETED (existing, needs subscription)
12. SESSION_INIT (new)
13. SESSION_END (new)
14. HEALTH_UPDATE (new)
15. CLI_ERROR (new)

## Decomposition Strategy

**Batch-Based Execution**: Tasks grouped into 5 batches by architectural layer, with strict dependency ordering. Each batch assigned to appropriate developer type (backend vs frontend).

**Why Batching?**:

- Reduces orchestration overhead (5 iterations vs 19)
- Groups related tasks together
- Maintains dependency ordering within batches
- One commit per batch for cleaner git history

## Success Criteria

- All 15 CLAUDE_DOMAIN_EVENTS forwarded to webview
- All 15 message types have frontend subscriptions
- Real-time streaming works without manual workarounds
- Permission dialogs display and respond correctly
- Tool execution timeline shows all tool events
- No "unknown message type" console warnings
- Extension builds without errors: `npm run build:all`

## Related Documentation

- **Analysis**: D:\projects\ptah-extension\docs\EVENT_SYSTEM_GAP_ANALYSIS.md
- **Implementation Plan**: D:\projects\ptah-extension\docs\EVENT_RELAY_IMPLEMENTATION_PLAN.md
- **Tasks Breakdown**: D:\projects\ptah-extension\task-tracking\TASK_2025_006\tasks.md
