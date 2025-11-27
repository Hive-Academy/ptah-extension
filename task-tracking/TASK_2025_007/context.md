# TASK_2025_007: Complete Message Streaming & Event Handling Fix

## Task Metadata

- **Task ID**: TASK_2025_007
- **Created**: 2025-11-19
- **Owner**: orchestrator
- **Status**: 🔄 In Progress
- **Priority**: CRITICAL
- **Dependencies**: TASK_2025_006 (Event Relay System)

## User Intent

Fix the complete message streaming and event handling system to eliminate:

1. Messages appearing twice in the UI
2. "Claude is typing..." indicator never stopping
3. Frontend feeling detached from backend
4. Duplicate event processing across multiple services
5. Missing event handlers causing state to get stuck

## Problem Statement

After 2 days of debugging, we identified the root causes:

### Backend Issues (NOW FIXED)

1. ❌ Claude CLI `-p` flag requires `stdin.end()` to signal EOF → **FIXED** with `stdin.end()` call
2. ❌ `message_stop` stream event IGNORED by parser → **FIXED** with `onMessageStop()` callback
3. ❌ `result` message type NOT PARSED (cost/usage/duration) → **FIXED** with `JSONLResultMessage` interface
4. ❌ Missing callbacks in launcher → **FIXED** with `onMessageStop` and `onResult` wiring

### Frontend Issues (TO BE FIXED)

1. ❌ Duplicate event subscriptions (ChatService + ChatStateManagerService)
2. ❌ Dual message collections (`messages[]` + `claudeMessages[]`)
3. ❌ No event deduplication mechanism
4. ❌ No cleanup for thinking/streaming states (no timeouts)
5. ❌ Multiple services managing overlapping state
6. ❌ Components reading from 7 different signal sources

## Conversation Summary

**Key Discovery Timeline**:

1. Started with "extension broken" - TypeError: postMessage is not a function
2. Fixed to use `sendMessage()` instead
3. Found duplicate event forwarding (ClaudeEventRelayService vs WebviewMessageBridge)
4. Removed ClaudeEventRelayService entirely
5. User reported messages not getting responses from Claude CLI
6. Created standalone test scripts to isolate the issue
7. **BREAKTHROUGH**: Discovered `-p` flag needs `stdin.end()` to signal EOF
8. Fixed stdin handling - messages now stream! ✅
9. BUT: "Claude is typing..." never stops
10. **ROOT CAUSE ANALYSIS**: Parser ignores `message_stop` and `result` events
11. **COMPREHENSIVE FIX**: Added missing event handlers + callbacks
12. **FRONTEND DEEP DIVE**: Identified 5 architectural issues causing detachment

## Success Criteria

### Phase 1: Backend (COMPLETED ✅)

- [x] Messages sent to Claude CLI get responses
- [x] Streaming works (content chunks appear)
- [x] `message_stop` event handled
- [x] `result` event parsed (cost, usage, duration)
- [x] Events properly emitted to frontend

### Phase 2: Frontend Quick Wins (IN PROGRESS)

- [ ] "Claude is typing..." stops when streaming completes
- [ ] Messages appear exactly once (no duplicates)
- [ ] Thinking indicator clears properly
- [ ] No zombie processes or stuck states

### Phase 3: Frontend Architecture (PLANNED)

- [ ] Single event processing pipeline
- [ ] Event deduplication service
- [ ] Unified state management (one message collection)
- [ ] Automatic cleanup registry for transient states
- [ ] Components read from single source of truth

## Testing Approach

### Manual Testing

1. Send message to Claude → Should get response
2. Watch streaming → Should see chunks appear in real-time
3. Wait for completion → "Claude is typing..." should disappear
4. Send another message → Should work seamlessly
5. Check for duplicates → Each message appears once

### Automated Testing

1. Unit tests for event deduplication
2. Unit tests for cleanup registry
3. Integration tests for event flow
4. E2E tests for user workflows

## References

- **Analysis Document**: `PARSER_MISSING_EVENTS_ANALYSIS.md`
- **Frontend Analysis**: Task agent report (comprehensive event flow diagram)
- **Test Scripts**: `test-stdin-with-end.js`, `test-direct-with-arg.js`
- **Backend Fixes**: `jsonl-stream-parser.ts`, `claude-cli-launcher.ts`
- **Frontend Code**: `chat.service.ts`, `chat-state-manager.service.ts`, `vscode.service.ts`
