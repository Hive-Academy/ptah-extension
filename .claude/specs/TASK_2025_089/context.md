# TASK_2025_089: Fix Session Resume Flow & Remove Dead Code

## Context

During code review of TASK_2025_088 (SDK-only migration), we discovered that the migration was **incomplete**:

- **Backend was updated**: `session:load` returns `{ messages: [] }` with comment "frontend should call `chat:resume`"
- **Frontend was NOT updated**: Still expects messages from `session:load`, never calls `chat:resume`
- **Result**: Clicking a session from sidebar opens an EMPTY tab

## Root Cause Analysis

### Current Broken Flow

```
User clicks session in sidebar
  ↓
app-shell.component.html:120 → chatStore.switchSession(session.id)
  ↓
session-loader.service.ts:214 → calls 'session:load' RPC
  ↓
Backend returns { messages: [] }  ← Changed in TASK_2025_088
  ↓
Frontend displays EMPTY chat  ← No resume triggered!
```

### Expected Correct Flow

```
User clicks session in sidebar
  ↓
session:load RPC → validates session exists, returns metadata
  ↓
chat:resume RPC → triggers sdkAgentAdapter.resumeSession()
  ↓
SDK loads ~/.claude/projects/{sessionId}.jsonl
  ↓
SDK streams replayed messages (isReplay: true)
  ↓
Frontend ExecutionTreeBuilder processes stream → displays messages
```

## Dead Code Identified

`session-loader.service.ts` has **565 lines** of conversion logic that never executes because it receives an empty array:

- `convertStoredMessages()` - 120 lines
- `convertFlatEventsToMessages()` - 150 lines
- `buildExecutionNodesFromEvents()` - 200 lines
- `convertLegacyNodesToMessages()` - 95 lines
- Various helper methods

## Scope

1. **Fix Resume Flow**: Wire up `chat:resume` call when session is clicked
2. **Remove Dead Code**: Delete 565 lines of unnecessary conversion logic
3. **Test End-to-End**: Verify session resumption works correctly

## Related Tasks

- TASK_2025_088: SDK-only migration (partially complete)
- TASK_2025_082: SDK streaming architecture
- TASK_2025_068: Session ID system refactoring

## Success Criteria

- [ ] Clicking session from sidebar loads conversation history
- [ ] Messages appear via SDK replay (isReplay: true events)
- [ ] 565+ lines of dead code removed
- [ ] Build, typecheck, lint all pass
