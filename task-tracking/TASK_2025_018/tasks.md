# Development Tasks - TASK_2025_018

**Task Type**: BUGFIX
**Total Tasks**: 5
**Total Batches**: 2
**Batching Strategy**: Layer-based (frontend critical fix, then backend edge case)
**Status**: 0/2 batches complete (0%)

---

## Batch 1: Frontend Critical Fix (SESSION_SWITCHED redundancy) ✅ CODE COMPLETE

**Assigned To**: frontend-developer
**Tasks in Batch**: 3
**Dependencies**: None (critical fix)
**Estimated Commits**: 2 (Task 1.3 is testing only)
**Batch Git Commits**: 70f1ec6, d91f83d

### Task 1.1: Use messages from SESSION_SWITCHED event ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts
**Lines**: 647-672
**Specification Reference**: context.md:12-39 (event flow analysis)
**Pattern to Follow**: chat.service.ts:674-690 (MESSAGE_ADDED handler using updateMessages)
**Expected Commit Pattern**: `fix(core): use messages from SESSION_SWITCHED event instead of redundant GET_HISTORY call`

**Quality Requirements**:

- ✅ Remove redundant GET_HISTORY request (lines 668-670)
- ✅ Extract sessionData.messages from SESSION_SWITCHED payload
- ✅ Call updateMessages() with session messages
- ✅ Add diagnostic logging (session ID, message count)
- ✅ Preserve session state update (setCurrentSession)

**Implementation Details**:

**Current Code** (lines 647-672):

```typescript
// Listen for session switched event (backend publishes chat:sessionSwitched)
this.vscode
  .onMessageType(CHAT_MESSAGE_TYPES.SESSION_SWITCHED)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    // Mark as connected when we receive events
    this._streamState.update((state) => ({ ...state, isConnected: true }));

    // Extract session from event payload
    const sessionData = payload.session;
    if (sessionData && this.validator.validateSession(sessionData).isValid) {
      // Type guard passed, safe to cast
      this.chatState.setCurrentSession(sessionData as never);
      this.logger.debug('Session switched', 'ChatService', {
        sessionId: sessionData.id,
      });

      // ❌ REMOVE THIS: Request messages for switched session
      this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.GET_HISTORY, {
        sessionId: sessionData.id,
      });
    }
  });
```

**New Code**:

```typescript
// Listen for session switched event (backend publishes chat:sessionSwitched)
this.vscode
  .onMessageType(CHAT_MESSAGE_TYPES.SESSION_SWITCHED)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    // Mark as connected when we receive events
    this._streamState.update((state) => ({ ...state, isConnected: true }));

    // Extract session from event payload
    const sessionData = payload.session;
    if (sessionData && this.validator.validateSession(sessionData).isValid) {
      // Type guard passed, safe to cast
      this.chatState.setCurrentSession(sessionData as never);

      // ✅ ADD THIS: Use messages directly from session (backend already loaded them)
      if (sessionData.messages && Array.isArray(sessionData.messages)) {
        // Add diagnostic logging
        console.group('🔄 SESSION SWITCHED');
        console.log('Session ID:', sessionData.id);
        console.log('Message count in payload:', sessionData.messages.length);
        console.groupEnd();

        // Update messages using consolidated method (same pattern as MESSAGE_ADDED)
        this.updateMessages(sessionData.messages as StrictChatMessage[], 'SESSION_SWITCHED');

        this.logger.debug('Session switched with messages loaded', 'ChatService', {
          sessionId: sessionData.id,
          messageCount: sessionData.messages.length,
        });
      } else {
        // Empty session (no messages yet)
        this.logger.debug('Session switched (empty session)', 'ChatService', {
          sessionId: sessionData.id,
        });
      }
    }
  });
```

**Root Cause Explanation**:

- Backend's `SessionManager.switchSession()` calls `getSession()` which loads messages from `.jsonl` file (session-manager.ts:275-311)
- Backend publishes `SESSION_SWITCHED` event with FULL session object (including messages array)
- Frontend receives session WITH messages but IGNORES them
- Frontend requests them AGAIN via `GET_HISTORY` (which returns 0 messages due to timing/state issue)
- **Fix**: Use the messages that are already in the SESSION_SWITCHED payload

**Verification Steps**:

1. Read chat.service.ts lines 647-672 to verify changes
2. Verify GET_HISTORY request removed (lines 668-670)
3. Verify updateMessages() called with sessionData.messages
4. Verify diagnostic logging added
5. Verify git commit created with expected message

**Git Commit Pattern**:

```bash
git add libs/frontend/core/src/lib/services/chat.service.ts
git commit -m "fix(core): use messages from SESSION_SWITCHED event instead of redundant GET_HISTORY call"
```

**Status**: ✅ COMPLETE
**Git Commit**: 70f1ec6

---

### Task 1.2: Verify GET_HISTORY handler usage ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts
**Lines**: 745-810
**Specification Reference**: context.md:63-68 (potential event listener issue)
**Expected Commit Pattern**: `chore(core): remove unused GET_HISTORY event handler` OR `docs(core): document GET_HISTORY handler usage`

**Quality Requirements**:

- ✅ Search frontend codebase for GET_HISTORY usage
- ✅ Determine if handler is still needed
- ✅ Either remove handler or add documentation
- ✅ Document findings in tasks.md

**Implementation Details**:

**Investigation**:

1. Grep for "GET_HISTORY" across `libs/frontend/**/*.ts`
2. Check if `getMessageHistory()` method (line 397) is called anywhere
3. Check if any other code path uses GET_HISTORY besides SESSION_SWITCHED

**Decision Matrix**:

- **If ONLY SESSION_SWITCHED used it** → REMOVE handler entirely (lines 745-810)
- **If other code uses it** → KEEP handler + add comment explaining usage
- **If uncertain** → KEEP handler + add TODO comment for future investigation

**If Removing Handler**:

```typescript
// Delete lines 745-810 entirely
// The GET_HISTORY event is no longer needed because:
// 1. SESSION_SWITCHED now uses messages from payload (Task 1.1)
// 2. No other code path requests message history
```

**If Keeping Handler**:

```typescript
// Add comment at line 745:
/**
 * Listen for history response (backend publishes chat:getHistory:response)
 *
 * NOTE: This handler is kept for [REASON - e.g., "explicit history refresh requests"].
 * SESSION_SWITCHED no longer uses this (uses messages from payload instead).
 *
 * TODO: Verify if this handler is still needed (TASK_2025_018)
 */
this.vscode
  .onMessageType(toResponseType(CHAT_MESSAGE_TYPES.GET_HISTORY))
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((response) => {
    // ... existing handler code
  });
```

**Verification Steps**:

1. Grep frontend codebase for GET_HISTORY
2. Document findings in tasks.md (add "Investigation Results" section)
3. Either remove handler or add documentation
4. Verify git commit created

**Git Commit Pattern** (if removing):

```bash
git add libs/frontend/core/src/lib/services/chat.service.ts
git commit -m "chore(core): remove unused GET_HISTORY event handler"
```

**Git Commit Pattern** (if keeping):

```bash
git add libs/frontend/core/src/lib/services/chat.service.ts
git commit -m "docs(core): document GET_HISTORY handler usage and future cleanup"
```

**Investigation Results**:

- Searched frontend codebase for GET_HISTORY usage
- Found `getMessageHistory()` method at line 397 - NEVER called
- Found GET_HISTORY handler at lines 745-810 - REMOVED (was only used by SESSION_SWITCHED)
- SESSION_SWITCHED no longer needs GET_HISTORY (uses messages from payload)
- Decision: REMOVED handler entirely (lines 773-838)
- Also removed unused `toResponseType` import

**Status**: ✅ COMPLETE
**Git Commit**: d91f83d

---

### Task 1.3: Test session switching with non-empty session ✅ READY FOR USER TESTING

**Action**: Manual Testing
**Specification Reference**: context.md:126-134 (success criteria)
**Expected Commit Pattern**: None (testing task, no code changes)

**Quality Requirements**:

- ✅ Test with session containing messages (> 0 messages)
- ✅ Test with empty session (0 messages)
- ✅ Verify messages load from SESSION_SWITCHED (not GET_HISTORY)
- ✅ Verify UI displays messages correctly
- ✅ Verify console shows correct diagnostic logging

**Test Steps**:

**Setup**:

1. Run extension in debug mode: Press F5 in VS Code
2. Wait for webview to open
3. Open browser DevTools console (F12 or Ctrl+Shift+I)

**Test Case 1: Non-Empty Session**:

1. Click on session dropdown in webview
2. Identify a session with messages (file size > 1KB in `.claude_sessions/`)
3. Click on that session
4. Observe console output:
   - ✅ Should see "🔄 SESSION SWITCHED" log group
   - ✅ Should see "Session ID: [sessionId]"
   - ✅ Should see "Message count in payload: [N]" (N > 0)
   - ❌ Should NOT see "📥 HISTORY LOADED - RAW MESSAGES FROM BACKEND"
   - ❌ Should NOT see "Total messages received: 0"
5. Verify UI:
   - ✅ Messages appear in chat window
   - ✅ Message count matches console output
   - ✅ Messages display correctly (no rendering errors)

**Test Case 2: Empty Session**:

1. Click on session dropdown
2. Find a session with 0 messages (file size 0KB or very small)
3. Click on that session
4. Observe console output:
   - ✅ Should see "Session switched (empty session)" log
   - ✅ Should see session ID in log
5. Verify UI:
   - ✅ Empty state displayed (no messages)
   - ✅ No errors in console

**Test Case 3: Session Switching Multiple Times**:

1. Switch between different sessions (empty → non-empty → empty)
2. Verify each switch loads correct messages
3. Verify no memory leaks (messages clear between switches)

**Expected Results**:

- ✅ Console shows SESSION_SWITCHED with message count > 0 for non-empty sessions
- ✅ Messages appear in chat UI immediately
- ✅ No GET_HISTORY request made (verified by absence of "📥 HISTORY LOADED" log)
- ✅ Empty sessions display empty state gracefully
- ✅ No errors in console for any test case

**Verification Steps**:

1. Screenshot or copy console output for each test case
2. Document results in tasks.md (add "Test Results" section below)
3. No git commit (testing task)

**Test Results**: (To be filled by developer after testing)

```
Test Case 1 (Non-Empty Session):
- Session ID tested: [FILL]
- Message count: [FILL]
- Messages displayed: [YES/NO]
- Console output: [PASTE RELEVANT LOGS]
- Result: [PASS/FAIL]

Test Case 2 (Empty Session):
- Session ID tested: [FILL]
- Empty state shown: [YES/NO]
- Console output: [PASTE RELEVANT LOGS]
- Result: [PASS/FAIL]

Test Case 3 (Multiple Switches):
- Sessions tested: [FILL]
- Switching works correctly: [YES/NO]
- Result: [PASS/FAIL]
```

**Status**: ✅ CODE COMPLETE - AWAITING USER MANUAL TESTING

**Developer Note**: Automated agents cannot run VS Code extension in debug mode. User must perform manual testing following the test cases above.

---

**Batch 1 Verification Requirements**:

- ✅ Task 1.1: GET_HISTORY call removed, updateMessages() called with session.messages
- ✅ Task 1.2: GET_HISTORY handler decision documented (removed or kept with comment)
- ✅ Task 1.3: Manual testing confirms messages load from SESSION_SWITCHED
- ✅ All git commits follow commitlint rules (lowercase type, lowercase scope, lowercase subject)
- ✅ Build passes: `npx nx build core`
- ✅ No compilation errors

---

## Batch 2: Backend Edge Case Handling (Empty JSONL files) ⏸️ PENDING

**Assigned To**: backend-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 1 complete (frontend fix is higher priority)
**Estimated Commits**: 2

### Task 2.1: Handle empty JSONL files gracefully ⏸️ PENDING

**File(s)**: D:\projects\ptah-extension\libs\backend\claude-domain\src\session\jsonl-session-parser.ts
**Lines**: 241-260
**Specification Reference**: context.md:41-56 (empty JSONL files issue)
**Pattern to Follow**: parseSessionMessages method (lines 154-228) - gracefully handles empty files by returning empty array
**Expected Commit Pattern**: `fix(claude-domain): gracefully handle empty JSONL files in parseSessionFile`

**Quality Requirements**:

- ✅ Return empty session summary for empty files (instead of throwing error)
- ✅ Preserve error handling for corrupt files
- ✅ Match behavior of parseSessionMessages (which handles empty files gracefully)
- ✅ Update JSDoc comments to reflect new behavior
- ✅ Add test case for empty file handling

**Implementation Details**:

**Root Cause**:

- `parseSessionFile()` calls `readFirstLine()` which throws "File is empty" error (line 255)
- This causes sessions with empty `.jsonl` files to be skipped entirely
- Log evidence: `SessionProxy: Skipping corrupt file 4c47afc3-a01b-4bb8-aca9-2b7ce4bb75ee.jsonl: Error: Failed to parse session file ... File is empty`

**Current Code** (lines 241-260):

```typescript
private static async readFirstLine(filePath: string): Promise<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream });

  try {
    for await (const line of reader) {
      // Return first non-empty line
      if (line.trim()) {
        reader.close();
        stream.destroy();
        return line;
      }
    }

    throw new Error('File is empty');  // ❌ THROWS ERROR
  } finally {
    reader.close();
    stream.destroy();
  }
}
```

**New Code**:

```typescript
/**
 * Read first line of file (efficient streaming)
 *
 * **Performance**: < 1ms for any file size
 * **Memory**: Minimal (stream buffer only)
 * **Empty Files**: Returns null instead of throwing error (graceful handling)
 *
 * @internal
 * @param filePath - Absolute path to file
 * @returns First line content or null if file is empty
 */
private static async readFirstLine(filePath: string): Promise<string | null> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream });

  try {
    for await (const line of reader) {
      // Return first non-empty line
      if (line.trim()) {
        reader.close();
        stream.destroy();
        return line;
      }
    }

    // ✅ RETURN NULL for empty files (graceful handling)
    return null;
  } finally {
    reader.close();
    stream.destroy();
  }
}
```

**Update parseSessionFile()** (lines 97-132):

```typescript
static async parseSessionFile(
  filePath: string
): Promise<Omit<SessionSummary, 'id'>> {
  try {
    // Read first line for session summary
    const firstLine = await this.readFirstLine(filePath);

    // ✅ HANDLE EMPTY FILES: Return default session summary
    if (firstLine === null) {
      const fileName = filePath.split(/[\\/]/).pop() || 'Unknown Session';
      return {
        name: fileName.replace('.jsonl', ''),
        messageCount: 0,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      };
    }

    const summaryData = this.parseSummaryLine(firstLine);

    // Read last line for timestamp
    const lastLine = await this.readLastLine(filePath);
    const lastMessage = this.parseMessageLine(lastLine);

    // Count lines for message count
    const lineCount = await this.countLines(filePath);
    const messageCount = Math.max(0, lineCount - 1); // Exclude summary line

    // Extract timestamps
    const createdAt = lastMessage.timestamp
      ? new Date(lastMessage.timestamp).getTime()
      : Date.now();
    const lastActiveAt = createdAt;

    return {
      name: summaryData.name,
      messageCount,
      lastActiveAt,
      createdAt,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse session file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
```

**Also Update readLastLine()** (lines 273+):
Apply same pattern to `readLastLine()` for consistency:

```typescript
private static async readLastLine(filePath: string): Promise<string | null> {
  // ... implementation
  // Return null instead of throwing for empty files
}
```

**Then update parseSessionFile to handle null lastLine**:

```typescript
// Read last line for timestamp
const lastLine = await this.readLastLine(filePath);

// Handle empty file (no messages)
if (lastLine === null) {
  return {
    name: summaryData.name,
    messageCount: 0,
    lastActiveAt: Date.now(),
    createdAt: Date.now(),
  };
}

const lastMessage = this.parseMessageLine(lastLine);
// ... rest of logic
```

**Verification Steps**:

1. Read jsonl-session-parser.ts lines 97-132 (parseSessionFile)
2. Read jsonl-session-parser.ts lines 241-260 (readFirstLine)
3. Verify readFirstLine returns `string | null` instead of throwing
4. Verify parseSessionFile handles null case
5. Verify JSDoc updated
6. Verify git commit created

**Git Commit Pattern**:

```bash
git add libs/backend/claude-domain/src/session/jsonl-session-parser.ts
git commit -m "fix(claude-domain): gracefully handle empty JSONL files in parseSessionFile"
```

**Status**: ⏸️ PENDING - Not started

---

### Task 2.2: Add unit test for empty JSONL file handling ⏸️ PENDING

**File(s)**: D:\projects\ptah-extension\libs\backend\claude-domain\src\session\jsonl-session-parser.spec.ts
**Specification Reference**: Task 2.1 (empty file handling)
**Expected Commit Pattern**: `test(claude-domain): add test for empty JSONL file handling`

**Quality Requirements**:

- ✅ Test parseSessionFile with empty file
- ✅ Test parseSessionMessages with empty file
- ✅ Verify graceful handling (no errors)
- ✅ Verify default values returned
- ✅ Test follows existing test patterns

**Implementation Details**:

**Add Test Case**:

```typescript
describe('JsonlSessionParser - Empty File Handling', () => {
  it('should handle empty JSONL file gracefully in parseSessionFile', async () => {
    // Create empty temp file
    const tempFilePath = join(__dirname, 'test-empty-session.jsonl');
    writeFileSync(tempFilePath, '');

    try {
      // Parse empty file
      const result = await JsonlSessionParser.parseSessionFile(tempFilePath);

      // Verify graceful handling
      expect(result).toBeDefined();
      expect(result.name).toBe('test-empty-session');
      expect(result.messageCount).toBe(0);
      expect(result.createdAt).toBeDefined();
      expect(result.lastActiveAt).toBeDefined();
    } finally {
      // Cleanup
      unlinkSync(tempFilePath);
    }
  });

  it('should return empty array for empty JSONL file in parseSessionMessages', async () => {
    // Create empty temp file
    const tempFilePath = join(__dirname, 'test-empty-messages.jsonl');
    writeFileSync(tempFilePath, '');

    try {
      // Parse empty file
      const messages = await JsonlSessionParser.parseSessionMessages(tempFilePath);

      // Verify empty array returned
      expect(messages).toEqual([]);
      expect(messages.length).toBe(0);
    } finally {
      // Cleanup
      unlinkSync(tempFilePath);
    }
  });
});
```

**Verification Steps**:

1. Read jsonl-session-parser.spec.ts to verify test added
2. Run tests: `npx nx test claude-domain`
3. Verify tests pass
4. Verify git commit created

**Git Commit Pattern**:

```bash
git add libs/backend/claude-domain/src/session/jsonl-session-parser.spec.ts
git commit -m "test(claude-domain): add test for empty JSONL file handling"
```

**Status**: ⏸️ PENDING - Not started

---

**Batch 2 Verification Requirements**:

- ✅ Task 2.1: Empty file handling implemented (returns default session, not error)
- ✅ Task 2.2: Unit tests pass for empty file handling
- ✅ All git commits follow commitlint rules
- ✅ Build passes: `npx nx build claude-domain`
- ✅ Tests pass: `npx nx test claude-domain`
- ✅ No compilation errors

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates commits per task (following commit patterns)
5. Developer returns with batch completion report (list of commit SHAs)
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per TASK (not per batch)
- Task 1.1 → git commit
- Task 1.2 → git commit
- Task 1.3 → No commit (testing task)
- Batch complete → Return with commit SHAs

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All task commits verified (4 commits total: 2 from Batch 1 + 2 from Batch 2)
- Task 1.3 test results documented
- All files modified as expected
- Build passes for both libraries (core + claude-domain)

---

## Verification Protocol

**After Batch Completion**:

1. Developer updates all task statuses in batch to "✅ COMPLETE"
2. Developer adds git commit SHAs to each task
3. Developer adds test results to Task 1.3 (if in Batch 1)
4. Team-leader verifies:
   - Git commits exist: `git log --oneline -[N]`
   - All files in batch modified: `Read([file-path])` for each task
   - Build passes: `npx nx build core` (Batch 1) or `npx nx build claude-domain` (Batch 2)
   - Tests pass: `npx nx test claude-domain` (Batch 2 only)
   - Dependencies respected: Task order maintained
5. If all pass: Update batch status to "✅ COMPLETE", assign next batch
6. If any fail: Mark batch as "❌ PARTIAL", create fix batch

---

## Implementation Strategy

**Critical Path**: Batch 1 (frontend fix) is the primary bug fix. Batch 2 (backend edge case) is secondary cleanup.

**Execution Order**:

1. **Batch 1** (frontend-developer):
   - Task 1.1: Remove GET_HISTORY redundancy ← **PRIMARY FIX**
   - Task 1.2: Cleanup unused handler
   - Task 1.3: Verify fix works ← **VALIDATION**
2. **Batch 2** (backend-developer):
   - Task 2.1: Handle empty JSONL files ← **EDGE CASE**
   - Task 2.2: Add tests ← **COVERAGE**

**Dependencies**:

- Batch 2 is independent of Batch 1 (can execute in parallel if needed)
- However, Batch 1 is higher priority (user-facing bug fix)
- Batch 2 improves robustness but doesn't block user functionality

**Success Metrics**:

- After Batch 1: Session switching loads messages correctly ✅
- After Batch 2: Empty sessions handled gracefully (no errors in logs) ✅

---

## Summary

**Total Tasks**: 5 tasks in 2 batches
**Critical Fix**: Task 1.1 (use SESSION_SWITCHED messages)
**Edge Case Fix**: Task 2.1 (empty JSONL handling)
**Validation**: Task 1.3 (manual testing)
**Cleanup**: Task 1.2 (remove unused handler)
**Coverage**: Task 2.2 (unit tests)

All tasks marked as ⏸️ PENDING. Ready for MODE 2 (iterative batch assignment).
