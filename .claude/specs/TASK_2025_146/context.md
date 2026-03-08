# TASK_2025_146: Wizard Analysis Runtime Fixes + Live Agent Chat

## Strategy: FEATURE (Partial: Architect -> Team-Leader -> Developers -> QA)

## Branch: feature/sdk-only-migration (existing)

## Phase: ARCHITECT

## User Request

Fix all 7 wizard analysis runtime issues discovered during investigation (log file analysis of vscode-app-1768436443449.log) AND add live Claude agent message streaming to the scan-progress UI by reusing the existing chat component as a child component. The chat component's API MUST NOT be modified - create an adapter/wrapper if needed.

## Issues Found (from log analysis)

### CRITICAL

1. **Phase/detection markers in MCP code, not text stream** - Agent puts `[PHASE:*]` and `[DETECTED:*]` inside `console.log()` in MCP tool calls. Stream processor (agentic-analysis.service.ts:359-361) only searches `text_delta` events. Markers never found, `broadcastProgress` never called for phases/detections.
2. **90s timeout reported as "cancelled by user"** - Timeout fires `AbortController.abort()`. SDK error says "Claude Code process aborted by user". No distinction between timeout and user cancellation.

### HIGH

3. **No progress updates reach UI** - Only `content_block_start` tool_use fires (showing "Using: mcp\_\_ptah_execute_code..."). No phase, no detections, no file count.
4. **Fallback result invisible after abort** - After timeout abort, RPC handler falls through to hardcoded analysis but UI doesn't reflect this transition.

### MEDIUM

5. **Agent calls workspace.analyze() twice** - Tool call #1 uses console.log (returns undefined), then tool call #2 calls same API with return. Wastes a tool turn + tokens.
6. **180-line JSON directory dump wastes tokens** - Lines 64-243 of log show full directory structure JSON. Wasteful.
7. **System prompt ambiguity** - "Emit `[PHASE:discovery]`" is ambiguous. Agent interprets "emit" as "put in code" rather than "output as text".

### NEW FEATURE

8. **Live agent chat in scan-progress UI** - Show Claude's streaming messages (text, tool calls, reasoning) in the scan-progress component by embedding the existing chat component. DO NOT modify chat component API - create adapter/wrapper.

## Key Files

### Backend

- `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts` - Stream processing, broadcast, timeout
- `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts` - RPC handler, fallback path
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` - Message broadcasting

### Frontend

- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts` - Progress display
- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts` - State management
- `libs/frontend/chat/src/lib/components/` - Chat component to reuse

### Types

- `libs/shared/src/lib/types/message.types.ts` - MESSAGE_TYPES
- `libs/shared/src/lib/types/setup-wizard.types.ts` - ScanProgressPayload

## Constraints

- Chat component API must NOT be modified
- Must work on existing `feature/sdk-only-migration` branch
- All changes from TASK_2025_145 are already committed
