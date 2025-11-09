# Browser Mode Testing Guide

## ✅ Server Status: RUNNING

The dev server is running at: **http://localhost:4200/**

## 📋 Testing Checklist

### Step 1: Initial Load Test

1. **Open Browser**: Navigate to http://localhost:4200/
2. **Open DevTools**: Press `F12` or right-click → Inspect
3. **Check Console**: Look for these messages:

```plaintext
Expected Console Output:
✅ 🎭 MOCK ENVIRONMENT INITIALIZATION
✅ Running in browser development mode
✅ Mock API will simulate VS Code extension behavior
✅ [Mock VSCode API] Initialized with: { sessions: 3, providers: 2 }
✅ === PTAH WEBVIEW BOOTSTRAP STARTING ===
✅ Window globals: { hasVscode: true, mode: 'Browser (Mock API)' }
✅ === PTAH WEBVIEW BOOTSTRAP COMPLETE ===
```

**Result**: □ PASS / □ FAIL

---

### Step 2: UI Load Test

**What to Check**:

- □ Page loads without errors
- □ Egyptian-themed UI visible
- □ Chat interface displays
- □ No red error messages in console
- □ Mock data appears (3 sessions in sidebar)

**Expected UI Elements**:

- □ Ptah logo/branding
- □ Session list (left sidebar)
- □ Chat message area (center)
- □ Navigation buttons (settings, analytics)

**Result**: □ PASS / □ FAIL

---

### Step 3: Session Management Test

#### 3.1 View Existing Sessions

**Actions**:

1. Look at session list in sidebar
2. Should see 3 pre-populated sessions:
   - "Current Development Session" (8 messages)
   - "Feature Implementation Planning" (15 messages)
   - "Bug Investigation" (6 messages)

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: chat:requestSessions
[Mock VSCode API] Sending to webview: chat:sessionsUpdated
```

**Result**: □ PASS / □ FAIL

#### 3.2 Switch Sessions

**Actions**:

1. Click on a different session
2. Chat area should update with that session's messages

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: chat:switchSession
[Mock VSCode API] Sending to webview: chat:sessionSwitched
[Mock VSCode API] Sending to webview: chat:getHistory:response
```

**Result**: □ PASS / □ FAIL

#### 3.3 Create New Session

**Actions**:

1. Click "New Session" button (or equivalent)
2. New session should appear in list

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: chat:newSession
[Mock VSCode API] Sending to webview: chat:sessionCreated
[Mock VSCode API] Sending to webview: chat:switchSession
```

**Result**: □ PASS / □ FAIL

---

### Step 4: Chat Message Test

#### 4.1 Send Message

**Actions**:

1. Type a message in chat input: "Hello, can you help me?"
2. Press Enter or click Send

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: chat:sendMessage
[Mock VSCode API] Sending to webview: chat:messageAdded
[Mock VSCode API] Sending to webview: chat:messageChunk (multiple times)
[Mock VSCode API] Sending to webview: chat:messageComplete
```

**Result**: □ PASS / □ FAIL

#### 4.2 Streaming Response Test

**Actions**:

1. After sending message, watch the assistant response
2. Response should appear in chunks (streaming effect)
3. Should see "..." or typing indicator during streaming
4. Final complete response should display

**Timing Check**:

- First chunk: appears after ~150ms
- Subsequent chunks: every ~150ms
- Complete: after all chunks sent

**Result**: □ PASS / □ FAIL

#### 4.3 Message Content Test

**Actions**:

1. Send message: "test error handling"
2. Response should mention error handling

**Expected Response Pattern**:

- Should be context-aware based on keywords
- Should mention injection context, takeUntil, etc.

**Result**: □ PASS / □ FAIL

---

### Step 5: Provider Management Test

#### 5.1 View Providers

**Actions**:

1. Navigate to Settings or Provider section
2. Should see provider list

**Expected Providers**:

- □ Claude CLI (default, available)
- □ VS Code LM (available)

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: providers:getAvailable
[Mock VSCode API] Sending to webview: providers:availableUpdated
```

**Result**: □ PASS / □ FAIL

#### 5.2 Switch Provider

**Actions**:

1. Click on different provider (e.g., VS Code LM)
2. UI should update to show new active provider

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: providers:switch
[Mock VSCode API] Sending to webview: providers:currentChanged
```

**Result**: □ PASS / □ FAIL

---

### Step 6: Navigation Test

**Actions**:

1. Click Settings button
2. Click Analytics button (if available)
3. Click Chat button to return

**Expected Behavior**:

- □ View changes without page reload
- □ URL updates (with hash routing)
- □ No console errors

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: view:changed
```

**Result**: □ PASS / □ FAIL

---

### Step 7: State Persistence Test

#### 7.1 Save State

**Actions**:

1. Perform some actions (send message, switch session)
2. Check if state save is called

**Console Check**:

```plaintext
Expected:
[Mock VSCode API] Received message: state:save
[Mock VSCode API] State updated: {...}
```

**Result**: □ PASS / □ FAIL

---

### Step 8: Error Handling Test

#### 8.1 Network Tab Check

**Actions**:

1. Open DevTools Network tab
2. Reload page
3. Check for failed requests

**Expected**:

- □ All JavaScript files load successfully
- □ All CSS files load successfully
- □ No 404 errors
- □ Mock API lazy chunk loads on demand

**Result**: □ PASS / □ FAIL

#### 8.2 Console Error Check

**Actions**:

1. Check Console tab for any red errors
2. Warnings are OK, errors are not

**Expected**:

- □ No TypeScript errors
- □ No runtime errors
- □ No unhandled promise rejections

**Result**: □ PASS / □ FAIL

---

### Step 9: Mock API Verification

#### 9.1 Window Globals Check

**Actions**:

1. Open Console
2. Type: `window.vscode`
3. Type: `window.ptahConfig`

**Expected Output**:

```javascript
window.vscode:
{
  postMessage: ƒ(),
  getState: ƒ(),
  setState: ƒ()
}

window.ptahConfig:
{
  isVSCode: false,
  theme: "dark",
  workspaceRoot: "/mock/workspace",
  workspaceName: "mock-project",
  ...
}
```

**Result**: □ PASS / □ FAIL

#### 9.2 Message Protocol Check

**Actions**:

1. In Console, type:

   ```javascript
   window.vscode.postMessage({
     type: 'chat:sendMessage',
     payload: { content: 'Test from console' },
   });
   ```

2. Check for response in console

**Expected**:

- Mock API logs message received
- Response sent back to webview
- Message appears in chat UI

**Result**: □ PASS / □ FAIL

---

### Step 10: Performance Test

#### 10.1 Initial Load Time

**Actions**:

1. Open DevTools → Network tab
2. Hard refresh (Ctrl+Shift+R)
3. Check load time in Network summary

**Expected**:

- □ Initial load < 3 seconds
- □ Main bundle ~1MB (development mode)
- □ Mock lazy chunk loads when needed (~18KB)

**Result**: □ PASS / □ FAIL

#### 10.2 Streaming Performance

**Actions**:

1. Send a message
2. Watch for chunk delivery timing

**Expected**:

- First chunk: ~150ms after send
- Subsequent chunks: ~150ms apart
- Smooth visual streaming effect

**Result**: □ PASS / □ FAIL

---

## 🎯 Final Verification

### Critical Path Test

**Complete Flow**:

1. Load page → See 3 sessions ✓
2. Click session → See messages ✓
3. Send message → See streaming response ✓
4. Create new session → Session created ✓
5. Switch provider → Provider changed ✓

**Result**: □ ALL PASS / □ SOME FAIL

---

## 🐛 Common Issues & Fixes

### Issue: Page loads but no mock console messages

**Fix**:

1. Check `environment.ts` has `useMockApi: true`
2. Verify build is using development config
3. Hard refresh browser (Ctrl+Shift+F5)

### Issue: Messages not streaming

**Fix**:

1. Check `environment.mockDelay` is > 0
2. Verify console shows mock message events
3. Check Network tab for WebSocket errors

### Issue: Sessions don't load

**Fix**:

1. Check console for errors
2. Verify `mock-data-generator.ts` is being loaded
3. Check `window.vscode` exists in console

### Issue: UI not responding

**Fix**:

1. Check for JavaScript errors in console
2. Verify all chunks loaded in Network tab
3. Check if signals are updating (use Angular DevTools)

---

## 📊 Test Results Summary

| Test Category       | Status | Notes |
| ------------------- | ------ | ----- |
| Initial Load        | □      |       |
| UI Display          | □      |       |
| Session Management  | □      |       |
| Chat Messages       | □      |       |
| Streaming           | □      |       |
| Provider Management | □      |       |
| Navigation          | □      |       |
| State Persistence   | □      |       |
| Error Handling      | □      |       |
| Performance         | □      |       |

---

## ✅ Success Criteria

**Minimum Requirements**:

- [x] Page loads without errors
- [x] Mock console messages appear
- [x] 3 sessions visible
- [x] Can send message and see response
- [x] Streaming works smoothly

**Full Success**:

- [x] All 10 test sections pass
- [x] No console errors
- [x] Performance meets targets
- [x] All UI features functional

---

## 📝 Notes & Observations

Use this space to record any issues or observations:

```
[Your notes here]
```

---

## 🚀 Next Steps After Testing

If all tests pass:

1. ✅ Mock system is working correctly
2. ✅ Ready for active development
3. ✅ Can build features in browser mode

If tests fail:

1. Note which tests failed
2. Check console errors
3. Review mock implementation
4. Ask for help with specific errors

---

**Testing completed by**: **\*\***\_**\*\***  
**Date**: **\*\***\_**\*\***  
**Overall Result**: □ PASS / □ FAIL
