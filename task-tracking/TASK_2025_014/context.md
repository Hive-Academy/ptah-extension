# Task Context for TASK_2025_014

## User Intent

Eliminate in-memory session storage in SessionManager, migrate to using Claude CLI `.jsonl` files as the single source of truth, fix all message format inconsistencies between `content: string` and `contentBlocks: Array` formats, eliminate duplicate event emissions causing 7x message duplication, and fix chunk handling issues causing frozen responses.

## Conversation Summary - Critical Findings

### 1. **Duplicate Storage Systems Discovered**

- **SessionManager** (libs/backend/claude-domain/src/session/session-manager.ts:140): Maintains in-memory Map<SessionId, StrictChatSession> + VS Code workspace state persistence
- **Claude CLI Native Storage**: `~/.claude/projects/{workspace}/session-uuid.jsonl` files
- **Problem**: Two sources of truth cause sync issues and complexity

### 2. **Message Format Inconsistency Root Cause**

From deep analysis of logs (vscode-app-1763677356626.log) and example.jsonl:

**Claude CLI Actual Format** (from example.jsonl lines 2-4):

```jsonl
{"role":"user","content":"simple string"}                           // Format A: Simple string
{"role":"user","content":[{"type":"text","text":"..."}]}            // Format B: ContentBlocks array
{"role":"assistant","content":[{"type":"text","text":"..."}]}       // Format B: Always arrays for assistant
```

**Current System Behavior**:

- **SessionManager.addUserMessage()** (line 393): Creates `contentBlocks: [{type:'text',text}]` format ✅ CORRECT
- **SessionManager.addAssistantMessage()** (line 452): Creates `contentBlocks: [{type:'text',text}]` format ✅ CORRECT
- **ChatValidationService.validateChatMessage()** (libs/frontend/core/src/lib/services/chat-validation.service.ts:124): REJECTS contentBlocks, expects `content: string` ❌ WRONG
- **MessageProcessingService.convertToProcessedMessage()** (libs/frontend/core/src/lib/services/message-processing.service.ts:176): Does `contentBlocks.map()` without null check, crashes on old messages ❌ FRAGILE

**Why Old Messages Have Wrong Format**:

- Old sessions loaded from VS Code workspace state (before TASK_2025_009 contentBlocks refactoring) still have `content: string` format
- No migration logic exists to normalize old messages

### 3. **Duplicate Event Emissions**

From log analysis (lines 72-133 of vscode-app-1763677356626.log):

**Duplicate Events Detected**:

- `chat:sessionInit` emitted **TWICE** (lines 91, 94)
- `chat:sessionEnd` emitted **TWICE** (lines 118, 121)
- `chat:messageComplete` emitted **TWICE** (lines 114, 128)
- `chat:messageAdded` emitted **AFTER** streaming completes (line 123) - duplicates the chunks!
- `chat:tokenUsageUpdated` emitted **THREE TIMES** (lines 76, 117, 124)

**Result**: Message rendered 7+ times in UI because frontend subscribes to all events.

### 4. **Chunk Handling Issues**

**Symptom**: Chunks freeze for seconds, then entire message prints 7 times

**Root Cause**:

- `chatState.setClaudeMessages()` called in **3 different places** (chat.service.ts lines 540, 656, 805)
- Same message added multiple times through different event handlers
- No deduplication at UI layer (though deduplication added at service layer in lines 156-157)

### 5. **JsonlSessionParser Confusion**

- **JsonlSessionParser** (libs/backend/claude-domain/src/session/jsonl-session-parser.ts:91): Only extracts METADATA (name, timestamp, count) from .jsonl files
- **Does NOT parse full messages** - only used for session list display
- Actual message history comes from SessionManager's in-memory state, NOT .jsonl files
- This creates confusion about "which storage is the source of truth"

## Technical Context

- **Branch**: feature/014
- **Created**: 2025-11-23
- **Task Type**: REFACTORING (architectural change, eliminate dual storage)
- **Complexity**: Complex (affects multiple layers: backend storage, frontend state, message parsing, event system)
- **Estimated Duration**: 12-16 hours
- **Related Tasks**:
  - TASK_2025_009 (ContentBlocks migration - already complete)
  - TASK_2025_011 (Session Management Simplification - planned, similar scope)
  - TASK_2025_007 (Event handling fixes - in progress)

## Key Constraints

1. **Claude CLI .jsonl Format is Canonical**: We must read Claude's actual storage format
2. **No Data Loss**: Must preserve all existing session/message data during migration
3. **Backward Compatibility**: Handle both old `content: string` and new `contentBlocks: Array` formats during migration
4. **Performance**: Reading .jsonl files must be efficient (streaming, not full load)
5. **Type Safety**: Maintain strict typing throughout the refactored system

## Execution Strategy

**REFACTORING Strategy** (per orchestration guidelines):

```
Phase 1: software-architect → Creates implementation-plan.md
         ↓
         USER VALIDATION ✋
         ↓
Phase 2a: team-leader MODE 1 (DECOMPOSITION) → Creates tasks.md
         ↓
Phase 2b: team-leader MODE 2 (ITERATIVE LOOP) → For each refactoring task:
         - Assigns task to appropriate developer
         - Developer refactors, commits git
         - team-leader MODE 2 verifies
         - Repeat for next task
         ↓
Phase 2c: team-leader MODE 3 (COMPLETION) → Final verification
         ↓
         USER CHOICE ✋ (tester for regression, reviewer, both, or skip)
         ↓
Phase 3: QA agents based on user choice
         ↓
Phase 4: USER handles git operations
         ↓
Phase 5: modernization-detector → Future work analysis
```

## Success Criteria

1. ✅ SessionManager in-memory storage completely removed
2. ✅ All message reads go directly to Claude CLI .jsonl files
3. ✅ Message format normalized: ONLY `contentBlocks: Array` format used everywhere
4. ✅ Old `content: string` messages migrated/normalized on read
5. ✅ Duplicate event emissions eliminated (each event fires once)
6. ✅ Chunk handling fixed: no freezing, no 7x duplication
7. ✅ All existing tests pass
8. ✅ No regressions in chat functionality
9. ✅ Performance acceptable (session list loads < 500ms, message history loads < 1s)
10. ✅ Type safety maintained throughout

## Files Likely Affected

**Backend**:

- libs/backend/claude-domain/src/session/session-manager.ts (major refactoring - remove in-memory storage)
- libs/backend/claude-domain/src/session/session-proxy.ts (expand to handle full message reads)
- libs/backend/claude-domain/src/session/jsonl-session-parser.ts (add full message parsing)
- libs/backend/claude-domain/src/chat/chat-orchestration.service.ts (update getHistory to read from .jsonl)
- libs/backend/claude-domain/src/messaging/message-handler.service.ts (eliminate duplicate emissions)

**Frontend**:

- libs/frontend/core/src/lib/services/chat-validation.service.ts (accept contentBlocks format)
- libs/frontend/core/src/lib/services/message-processing.service.ts (handle null safety)
- libs/frontend/core/src/lib/services/chat.service.ts (remove duplicate setClaudeMessages calls)
- libs/frontend/core/src/lib/services/chat-state.service.ts (message normalization)

**Shared**:

- libs/shared/src/lib/types/message.types.ts (ensure contentBlocks is canonical)

## Risk Assessment

**High Risk**:

- Data loss during migration if not handled carefully
- Breaking existing sessions if format conversion fails
- Performance degradation if .jsonl file reading not optimized

**Medium Risk**:

- Event system changes breaking other features
- Type errors if contentBlocks migration incomplete

**Low Risk**:

- UI rendering issues (covered by tests)

## Migration Strategy

1. **Phase 1**: Add .jsonl message reading capability (additive, no breaking changes)
2. **Phase 2**: Add message format normalization layer (handles both formats)
3. **Phase 3**: Update frontend to use normalized messages
4. **Phase 4**: Remove duplicate event emissions
5. **Phase 5**: Remove SessionManager in-memory storage (breaking change, must be last)
6. **Phase 6**: Cleanup and optimization
