# Testing Checklist: Complete Message Streaming & Event Handling Fix

## Pre-Testing Setup

- [ ] Backup current extension code
- [ ] Ensure Claude CLI is installed and authenticated (`claude auth status`)
- [ ] Clear browser cache for VS Code webview
- [ ] Open VS Code Developer Tools (Help → Toggle Developer Tools)
- [ ] Enable verbose logging if needed

---

## Phase 1: Backend Validation (CRITICAL)

### Test 1.1: Basic Message Sending ✅

**Objective**: Verify messages sent to Claude CLI receive responses

**Steps**:

1. Build extension: `nx build @ptah-extension/claude-domain && nx build ptah-extension-vscode`
2. Launch extension (F5 in VS Code)
3. Open Ptah extension webview
4. Send message: "Hello"
5. Watch console logs

**Expected Results**:

```
✅ [ClaudeCliLauncher] Process spawned successfully, PID: 12345
✅ [ClaudeCliLauncher] Writing message to stdin: ...
✅ [ClaudeCliLauncher] stdin ended (EOF signaled)
✅ [ClaudeCliLauncher] Received stdout data: { chunkLength: 726, ... }
✅ UI shows response from Claude
```

**Actual Results**:

- [ ] Process spawned: ****\_\_\_****
- [ ] stdin written: ****\_\_\_****
- [ ] Response received: ****\_\_\_****
- [ ] UI updated: ****\_\_\_****

**Status**: 🎯 PENDING

---

### Test 1.2: Streaming Works ✅

**Objective**: Verify real-time streaming (chunks appear as generated)

**Steps**:

1. Send message: "Write a 200-word story"
2. Watch UI for incremental text updates
3. Watch console logs for stdout chunks

**Expected Results**:

```
✅ [ClaudeCliLauncher] Received stdout data: (multiple times)
✅ [JSONLStreamParser] content_block_delta events
✅ UI shows text appearing word-by-word or sentence-by-sentence
✅ NO full-text-at-once rendering
```

**Actual Results**:

- [ ] Chunks logged in console: ****\_\_\_****
- [ ] UI updates incrementally: ****\_\_\_****
- [ ] No lag between chunks: ****\_\_\_****

**Status**: 🎯 PENDING

---

### Test 1.3: message_stop Event Handled ✅

**Objective**: Verify `message_stop` stream event is parsed and handled

**Steps**:

1. Send message: "Hello"
2. Wait for response to complete
3. Check console logs for message_stop event

**Expected Results**:

```
✅ [JSONLStreamParser] message_stop received - streaming complete
✅ [ClaudeCliLauncher] Streaming complete (message_stop received)
✅ EventPublisher emits MESSAGE_COMPLETE event
```

**Actual Results**:

- [ ] message_stop logged: ****\_\_\_****
- [ ] MESSAGE_COMPLETE emitted: ****\_\_\_****
- [ ] Timestamp: ****\_\_\_****

**Status**: 🎯 PENDING

---

### Test 1.4: result Message Parsed ✅

**Objective**: Verify `result` message with cost/usage/duration is parsed

**Steps**:

1. Send message: "Hello"
2. Wait for response to complete
3. Check console logs for result message

**Expected Results**:

```
✅ [JSONLStreamParser] result message received: {
     subtype: 'success',
     duration: 2866,
     cost: 0.016623600000000002,
     tokens: { input_tokens: 2, output_tokens: 12, ... }
   }
✅ [ClaudeCliLauncher] Final result received: ...
✅ EventPublisher emits TOKEN_USAGE_UPDATED event
✅ EventPublisher emits SESSION_END event with reason='completed'
```

**Actual Results**:

- [ ] result message logged: ****\_\_\_****
- [ ] Cost displayed: ****\_\_\_****
- [ ] Token counts shown: ****\_\_\_****
- [ ] Duration logged: ****\_\_\_****

**Status**: 🎯 PENDING

---

### Test 1.5: Process Cleanup ✅

**Objective**: Verify child process closes cleanly

**Steps**:

1. Send message: "Hello"
2. Wait for response to complete
3. Check Task Manager (Windows) or `ps aux | grep node` (Mac/Linux)

**Expected Results**:

```
✅ Process PID appears in Task Manager during streaming
✅ Process PID disappears after completion
✅ No zombie processes
✅ [ClaudeCliLauncher] close event logged with code 0
```

**Actual Results**:

- [ ] Process spawned: PID ****\_\_\_****
- [ ] Process closed: ****\_\_\_****
- [ ] Exit code: ****\_\_\_****
- [ ] No zombies: ****\_\_\_****

**Status**: 🎯 PENDING

---

## Phase 2: Frontend Validation (CRITICAL)

### Test 2.1: "Claude is typing..." Stops ✅

**Objective**: Verify typing indicator clears when streaming completes

**Steps**:

1. Send message: "Hello"
2. Watch for "Claude is typing..." banner/indicator
3. Wait for response to complete
4. Verify typing indicator disappears

**Expected Results**:

```
✅ Typing indicator appears while streaming
✅ Typing indicator disappears within 1 second of completion
✅ UI allows sending next message
```

**Actual Results**:

- [ ] Typing indicator appeared: ****\_\_\_****
- [ ] Typing indicator cleared: ****\_\_\_****
- [ ] Time to clear: ****\_\_\_**** ms

**Status**: 🎯 PENDING

---

### Test 2.2: No Duplicate Messages ✅

**Objective**: Verify each message appears exactly once

**Steps**:

1. Send message: "Hello"
2. Wait for response
3. Count how many times the response appears in the UI
4. Check for duplicate message blocks

**Expected Results**:

```
✅ User message appears once
✅ Assistant response appears once
✅ No duplicate text blocks
✅ Message IDs are unique
```

**Actual Results**:

- [ ] User message count: ****\_\_\_****
- [ ] Assistant message count: ****\_\_\_****
- [ ] Duplicates found: ****\_\_\_****

**Status**: 🎯 PENDING

---

### Test 2.3: Thinking Indicator Clears ✅

**Objective**: Verify thinking display clears properly

**Steps**:

1. Send complex message that triggers thinking
2. Watch for thinking indicator/display
3. Wait for response to start
4. Verify thinking indicator disappears

**Expected Results**:

```
✅ Thinking indicator appears (if backend sends thinking event)
✅ Thinking indicator clears when content starts arriving
✅ No stuck "Claude is thinking..." state
```

**Actual Results**:

- [ ] Thinking appeared: ****\_\_\_****
- [ ] Thinking cleared: ****\_\_\_****
- [ ] Time displayed: ****\_\_\_**** seconds

**Status**: 🎯 PENDING

---

### Test 2.4: Multiple Messages in Sequence ✅

**Objective**: Verify can send multiple messages without issues

**Steps**:

1. Send message 1: "Hello"
2. Wait for response 1
3. Send message 2: "How are you?"
4. Wait for response 2
5. Send message 3: "Tell me a joke"
6. Wait for response 3

**Expected Results**:

```
✅ All 3 messages get responses
✅ No state gets stuck between messages
✅ Typing indicators work for all messages
✅ No duplicates for any message
```

**Actual Results**:

- [ ] Message 1 worked: ****\_\_\_****
- [ ] Message 2 worked: ****\_\_\_****
- [ ] Message 3 worked: ****\_\_\_****
- [ ] Issues encountered: ****\_\_\_****

**Status**: 🎯 PENDING

---

### Test 2.5: Session Switch ✅

**Objective**: Verify session switching works correctly

**Steps**:

1. Send message in session A
2. Create new session B
3. Switch to session B
4. Send message in session B
5. Switch back to session A
6. Verify messages preserved

**Expected Results**:

```
✅ Session A shows correct messages
✅ Session B shows correct messages
✅ No message mixing between sessions
✅ Typing indicators work in both sessions
```

**Actual Results**:

- [ ] Session A messages: ****\_\_\_****
- [ ] Session B messages: ****\_\_\_****
- [ ] Mixing occurred: ****\_\_\_****

**Status**: 🎯 PENDING

---

## Phase 3: Edge Cases & Error Handling

### Test 3.1: Network Interruption ⚠️

**Objective**: Verify graceful handling of network issues

**Steps**:

1. Send message
2. Simulate network disconnect (disable Wi-Fi or disconnect ethernet)
3. Reconnect network
4. Try sending another message

**Expected Results**:

```
✅ Extension doesn't crash
✅ Error message shown to user
✅ Can retry after reconnection
✅ No duplicate messages on reconnect
```

**Actual Results**:

- [ ] Error handled gracefully: ****\_\_\_****
- [ ] Retry worked: ****\_\_\_****
- [ ] Duplicates: ****\_\_\_****

**Status**: 📋 PLANNED

---

### Test 3.2: Claude CLI Not Installed ⚠️

**Objective**: Verify error handling when CLI missing

**Steps**:

1. Rename/move Claude CLI executable
2. Try to send message
3. Check error message

**Expected Results**:

```
✅ Clear error message: "Claude CLI not found"
✅ Extension doesn't crash
✅ Provides installation instructions
```

**Actual Results**:

- [ ] Error message shown: ****\_\_\_****
- [ ] Extension stable: ****\_\_\_****

**Status**: 📋 PLANNED

---

### Test 3.3: Very Long Response ⚠️

**Objective**: Verify handling of long streaming responses

**Steps**:

1. Send message: "Write a 2000-word essay on AI"
2. Watch streaming performance
3. Verify all text appears

**Expected Results**:

```
✅ Streaming continues for full response
✅ No memory leaks or slowdowns
✅ Typing indicator clears at end
✅ All text present in UI
```

**Actual Results**:

- [ ] Full text received: ****\_\_\_****
- [ ] Performance issues: ****\_\_\_****
- [ ] Indicator cleared: ****\_\_\_****

**Status**: 📋 PLANNED

---

### Test 3.4: Rapid Message Sending ⚠️

**Objective**: Verify handling of rapid sequential messages

**Steps**:

1. Send message 1: "Hello"
2. Immediately send message 2: "Hi"
3. Immediately send message 3: "Hey"
4. Watch how system handles queue

**Expected Results**:

```
✅ All messages queued properly
✅ Responses arrive in order
✅ No state corruption
✅ No crashes or freezes
```

**Actual Results**:

- [ ] All messages sent: ****\_\_\_****
- [ ] Responses received: ****\_\_\_****
- [ ] Order preserved: ****\_\_\_****

**Status**: 📋 PLANNED

---

## Phase 4: Performance & Memory

### Test 4.1: Memory Leaks 🔍

**Objective**: Verify no memory leaks from uncleaned subscriptions

**Steps**:

1. Open Chrome DevTools Memory tab
2. Take heap snapshot
3. Send 20 messages
4. Take another heap snapshot
5. Compare memory usage

**Expected Results**:

```
✅ Memory growth < 10MB after 20 messages
✅ No detached DOM nodes
✅ All subscriptions cleaned up
✅ Event listeners removed
```

**Actual Results**:

- [ ] Initial memory: ****\_\_\_**** MB
- [ ] After 20 messages: ****\_\_\_**** MB
- [ ] Growth: ****\_\_\_**** MB
- [ ] Leaks detected: ****\_\_\_****

**Status**: 📋 PLANNED

---

### Test 4.2: Change Detection Cycles 📊

**Objective**: Verify reduced change detection cycles

**Steps**:

1. Enable Angular DevTools profiler
2. Send message
3. Count change detection cycles
4. Compare to baseline

**Expected Results**:

```
✅ 40% fewer cycles than before
✅ No unnecessary re-renders
✅ Components update exactly once per event
```

**Actual Results**:

- [ ] Cycles before fix: ****\_\_\_****
- [ ] Cycles after fix: ****\_\_\_****
- [ ] Reduction: ****\_\_\_**** %

**Status**: 📋 PLANNED

---

### Test 4.3: Event Processing Latency ⏱️

**Objective**: Verify event processing < 50ms

**Steps**:

1. Add performance marks in code:

   ```typescript
   performance.mark('event-start');
   // ... process event
   performance.mark('event-end');
   performance.measure('event-processing', 'event-start', 'event-end');
   ```

2. Send message
3. Check performance measurements

**Expected Results**:

```
✅ Event processing < 50ms
✅ No blocking operations
✅ Smooth UI updates
```

**Actual Results**:

- [ ] Average latency: ****\_\_\_**** ms
- [ ] Max latency: ****\_\_\_**** ms
- [ ] p95 latency: ****\_\_\_**** ms

**Status**: 📋 PLANNED

---

## Phase 5: Regression Testing

### Test 5.1: Tool Execution Still Works ✅

**Objective**: Verify tool events still processed correctly

**Steps**:

1. Send message that triggers tool use
2. Watch for tool start/progress/result events
3. Verify UI shows tool timeline

**Expected Results**:

```
✅ Tool events logged
✅ Tool timeline displays
✅ Tool results shown
```

**Actual Results**:

- [ ] Tools executed: ****\_\_\_****
- [ ] Timeline shown: ****\_\_\_****

**Status**: 📋 PLANNED

---

### Test 5.2: Permissions Still Work ✅

**Objective**: Verify permission prompts still work

**Steps**:

1. Send message that requires permission
2. Wait for permission prompt
3. Grant/deny permission
4. Verify response

**Expected Results**:

```
✅ Permission prompt appears
✅ Grant/deny works correctly
✅ Response continues after grant
```

**Actual Results**:

- [ ] Prompt appeared: ****\_\_\_****
- [ ] Grant worked: ****\_\_\_****
- [ ] Response continued: ****\_\_\_****

**Status**: 📋 PLANNED

---

### Test 5.3: Agent Events Still Work ✅

**Objective**: Verify agent lifecycle events still tracked

**Steps**:

1. Send message that spawns agents
2. Watch for agent start/activity/complete events
3. Verify agent timeline

**Expected Results**:

```
✅ Agent events logged
✅ Agent timeline displays
✅ Agent results shown
```

**Actual Results**:

- [ ] Agents tracked: ****\_\_\_****
- [ ] Timeline shown: ****\_\_\_****

**Status**: 📋 PLANNED

---

## Summary Template

### Test Run Information

- **Date**: ****\_\_\_****
- **Tester**: ****\_\_\_****
- **Extension Version**: ****\_\_\_****
- **Claude CLI Version**: ****\_\_\_****
- **VS Code Version**: ****\_\_\_****
- **OS**: ****\_\_\_****

### Overall Results

- **Tests Passed**: **_/_**
- **Tests Failed**: \_\_\_
- **Tests Skipped**: \_\_\_
- **Critical Issues**: \_\_\_
- **Non-Critical Issues**: \_\_\_

### Critical Issues Found

1. ***
2. ***
3. ***

### Recommendations

- [ ] Ready for production
- [ ] Needs fixes before production
- [ ] Needs more testing

### Sign-Off

- **Tested By**: ****\_\_\_****
- **Approved By**: ****\_\_\_****
- **Date**: ****\_\_\_****
