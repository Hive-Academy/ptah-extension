# Development Tasks - TASK_2025_008

**Task Type**: REFACTORING
**Total Tasks**: 3 (organized into 3 atomic batches)
**Total Batches**: 3
**Batching Strategy**: Parallel execution for independent changes, sequential for dependent changes
**Status**: 1/3 batches complete (33%)

**Context**: Critical frontend event handling fixes - eliminate dual namespace pattern, complete type system fields, add missing frontend subscriptions.

**Architectural Decision**: Single source of truth - use CHAT_MESSAGE_TYPES directly in backend (eliminate claude:\* namespace in ClaudeDomainEventPublisher).

---

## Batch 1: Event Namespace Unification ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 1
**Dependencies**: None (can run parallel with Batch 2)
**Estimated Duration**: 2-3 hours
**Estimated Commits**: 1
**Git Commit**: c514a09f894b71561da5bbc01d17b9ebe2dead9d

### Task 1.1: Eliminate Dual Namespace in ClaudeDomainEventPublisher ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\backend\claude-domain\src\events\claude-domain.events.ts

**Specification Reference**:

- context.md: User confirmed single source of truth approach
- EVENT_HANDLING_ENHANCEMENT_ARCHITECTURE.md: Documents dual namespace problem
- Current state: Lines 24-59 define CLAUDE_DOMAIN_EVENTS with `claude:*` namespace

**Pattern to Follow**: CHAT_MESSAGE_TYPES constant (libs/shared/src/lib/constants/message-types.ts:18-68)

**Expected Commit Pattern**: `refactor(claude-domain): eliminate dual namespace, use CHAT_MESSAGE_TYPES directly`

**Changes Required**:

1. **Import CHAT_MESSAGE_TYPES** (add to line 7):

   ```typescript
   import { CHAT_MESSAGE_TYPES } from '@ptah-extension/shared';
   ```

2. **Replace CLAUDE_DOMAIN_EVENTS constant** (lines 24-59):

   ```typescript
   // BEFORE (lines 24-59):
   export const CLAUDE_DOMAIN_EVENTS = {
     CONTENT_CHUNK: 'claude:content:chunk',
     THINKING: 'claude:thinking',
     TOOL_START: 'claude:tool:start',
     // ... 17 claude:* event types
   } as const;

   // AFTER:
   // DELETED - Use CHAT_MESSAGE_TYPES directly from @ptah-extension/shared
   ```

3. **Update all emit methods** (lines 154-310):

   - Change `CLAUDE_DOMAIN_EVENTS.CONTENT_CHUNK` → `CHAT_MESSAGE_TYPES.MESSAGE_CHUNK`
   - Change `CLAUDE_DOMAIN_EVENTS.THINKING` → `CHAT_MESSAGE_TYPES.THINKING`
   - Change `CLAUDE_DOMAIN_EVENTS.TOOL_START` → `CHAT_MESSAGE_TYPES.TOOL_START`
   - Change `CLAUDE_DOMAIN_EVENTS.TOOL_PROGRESS` → `CHAT_MESSAGE_TYPES.TOOL_PROGRESS`
   - Change `CLAUDE_DOMAIN_EVENTS.TOOL_RESULT` → `CHAT_MESSAGE_TYPES.TOOL_RESULT`
   - Change `CLAUDE_DOMAIN_EVENTS.TOOL_ERROR` → `CHAT_MESSAGE_TYPES.TOOL_ERROR`
   - Change `CLAUDE_DOMAIN_EVENTS.PERMISSION_REQUESTED` → `CHAT_MESSAGE_TYPES.PERMISSION_REQUEST`
   - Change `CLAUDE_DOMAIN_EVENTS.PERMISSION_RESPONDED` → `CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE`
   - Change `CLAUDE_DOMAIN_EVENTS.SESSION_INIT` → `CHAT_MESSAGE_TYPES.SESSION_INIT`
   - Change `CLAUDE_DOMAIN_EVENTS.SESSION_END` → `CHAT_MESSAGE_TYPES.SESSION_END`
   - Change `CLAUDE_DOMAIN_EVENTS.MESSAGE_COMPLETE` → `CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE`
   - Change `CLAUDE_DOMAIN_EVENTS.TOKEN_USAGE_UPDATED` → `CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED`
   - Change `CLAUDE_DOMAIN_EVENTS.HEALTH_UPDATE` → `CHAT_MESSAGE_TYPES.HEALTH_UPDATE`
   - Change `CLAUDE_DOMAIN_EVENTS.CLI_ERROR` → `CHAT_MESSAGE_TYPES.CLI_ERROR`
   - Change `CLAUDE_DOMAIN_EVENTS.AGENT_STARTED` → `CHAT_MESSAGE_TYPES.AGENT_STARTED`
   - Change `CLAUDE_DOMAIN_EVENTS.AGENT_ACTIVITY` → `CHAT_MESSAGE_TYPES.AGENT_ACTIVITY`
   - Change `CLAUDE_DOMAIN_EVENTS.AGENT_COMPLETED` → `CHAT_MESSAGE_TYPES.AGENT_COMPLETED`

4. **Verify payload compatibility**:
   - ClaudeContentChunkEvent → ChatMessageChunkPayload (may need transformation)
   - All other payloads should match exactly

**Quality Requirements**:

- ✅ All 17 event types use CHAT_MESSAGE_TYPES constants
- ✅ No `claude:*` namespace strings remain in file
- ✅ All emit methods compile without errors
- ✅ Imports resolve correctly from @ptah-extension/shared
- ✅ No breaking changes to event payload structures

**Verification Steps**:

```bash
# Build backend library
npx nx build claude-domain

# Typecheck
npx nx run claude-domain:typecheck

# Search for any remaining claude:* references
grep -r "claude:" libs/backend/claude-domain/src/events/
```

**Implementation Notes**:

- **Critical**: This eliminates the dual namespace problem at the source
- **Impact**: All backend events now publish directly to `chat:*` namespace
- **Benefit**: Frontend subscriptions will immediately start receiving events (no translation needed)
- **Risk**: Must ensure payload structures are compatible with MessagePayloadMap

---

**Batch 1 Verification Requirements**:

- ✅ File exists at D:\projects\ptah-extension\libs\backend\claude-domain\src\events\claude-domain.events.ts
- ✅ Git commit exists with pattern `refactor(claude-domain): eliminate dual namespace, use CHAT_MESSAGE_TYPES directly`
- ✅ Build passes: `npx nx build claude-domain`
- ✅ No `claude:*` strings in claude-domain.events.ts
- ✅ All CLAUDE_DOMAIN_EVENTS references replaced with CHAT_MESSAGE_TYPES

---

## Batch 2: Type System Foundation Enhancement ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 1
**Dependencies**: None (can run parallel with Batch 1)
**Estimated Duration**: 1-2 hours
**Estimated Commits**: 1
**Batch Git Commit**: 24f9132

### Task 2.1: Add Missing Fields to StrictChatSession and StrictChatMessage ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts

**Specification Reference**:

- context.md: "StrictChatSession missing 5 fields, StrictChatMessage missing 3 fields"
- Current StrictChatSession: Lines 829-845 (7 fields)
- Current StrictChatMessage: Lines 810-824 (9 fields)

**Pattern to Follow**: InitialDataPayload (lines 598-618) for complete session structure

**Expected Commit Pattern**: `refactor(shared): add missing fields to StrictChatSession and StrictChatMessage`

**Changes Required**:

1. **Enhance StrictChatSession interface** (lines 829-845):

   ```typescript
   // CURRENT (lines 829-845):
   export interface StrictChatSession {
     readonly id: SessionId;
     readonly name: string;
     readonly workspaceId?: string;
     readonly messages: readonly StrictChatMessage[];
     readonly createdAt: number;
     readonly lastActiveAt: number;
     readonly updatedAt: number; // Alias for lastActiveAt
     readonly messageCount: number; // Derived field
     readonly tokenUsage: Readonly<{
       input: number;
       output: number;
       total: number;
       percentage: number;
       maxTokens?: number;
     }>;
   }

   // ENHANCED (add 5 missing fields):
   export interface StrictChatSession {
     readonly id: SessionId;
     readonly name: string;
     readonly workspaceId?: string;
     readonly messages: readonly StrictChatMessage[];
     readonly createdAt: number;
     readonly lastActiveAt: number;
     readonly updatedAt: number;
     readonly messageCount: number;

     // NEW: Missing fields for IMPLEMENTATION_PLAN compatibility
     readonly model?: string; // Field 1: AI model used
     readonly provider?: string; // Field 2: Provider ID
     readonly status?: 'active' | 'archived'; // Field 3: Session state
     readonly tags?: readonly string[]; // Field 4: User tags
     readonly description?: string; // Field 5: Session description

     readonly tokenUsage: Readonly<{
       input: number;
       output: number;
       total: number;
       percentage: number;
       maxTokens?: number;
       cacheRead?: number; // ENHANCED: Cache read tokens
       cacheCreation?: number; // ENHANCED: Cache creation tokens
     }>;
   }
   ```

2. **Enhance StrictChatMessage interface** (lines 810-824):

   ```typescript
   // CURRENT (lines 810-824):
   export interface StrictChatMessage {
     readonly id: MessageId;
     readonly sessionId: SessionId;
     readonly type: 'user' | 'assistant' | 'system';
     readonly content: string;
     readonly timestamp: number;
     readonly streaming?: boolean;
     readonly files?: readonly string[];
     readonly isError?: boolean;
     readonly metadata?: Readonly<Record<string, unknown>>;
     readonly isComplete?: boolean;
     readonly level?: 'info' | 'warning' | 'error';
   }

   // ENHANCED (add 3 missing fields):
   export interface StrictChatMessage {
     readonly id: MessageId;
     readonly sessionId: SessionId;
     readonly type: 'user' | 'assistant' | 'system';
     readonly content: string;
     readonly timestamp: number;
     readonly streaming?: boolean;
     readonly files?: readonly string[];
     readonly isError?: boolean;
     readonly metadata?: Readonly<Record<string, unknown>>;
     readonly isComplete?: boolean;
     readonly level?: 'info' | 'warning' | 'error';

     // NEW: Missing fields for full message lifecycle
     readonly model?: string; // Field 1: Model used for this message
     readonly tokenCount?: number; // Field 2: Token count for this message
     readonly duration?: number; // Field 3: Generation duration (ms)
   }
   ```

3. **Update Zod schemas** (lines 927-963):
   - Update `StrictChatMessageSchema` (lines 927-941) to include new optional fields
   - Update `StrictChatSessionSchema` (lines 943-963) to include new optional fields

**Quality Requirements**:

- ✅ All 5 new StrictChatSession fields are optional (backward compatible)
- ✅ All 3 new StrictChatMessage fields are optional (backward compatible)
- ✅ Zod schemas updated to validate new fields
- ✅ All fields use readonly modifier
- ✅ Type safety preserved (no `any` types)

**Verification Steps**:

```bash
# Build shared library
npx nx build shared

# Typecheck
npx nx run shared:typecheck

# Verify no breaking changes
npx nx run-many --target=typecheck --all
```

**Implementation Notes**:

- **Backward Compatible**: All new fields are optional (won't break existing code)
- **Forward Compatible**: Enables IMPLEMENTATION_PLAN features (Phase 1.3, Phase 4)
- **Evidence-Based**: Fields identified from requirements gap analysis
- **Type Safety**: Zod schemas provide runtime validation

---

**Batch 2 Verification Requirements**:

- ✅ File exists at D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts
- ✅ Git commit exists with pattern `refactor(shared): add missing fields to StrictChatSession and StrictChatMessage`
- ✅ Build passes: `npx nx build shared`
- ✅ StrictChatSession has 5 new optional fields (model, provider, status, tags, description)
- ✅ StrictChatMessage has 3 new optional fields (model, tokenCount, duration)
- ✅ Zod schemas updated to validate new fields
- ✅ All workspace libraries still typecheck: `npx nx run-many --target=typecheck --all`

---

## Batch 3: Frontend Event Subscriptions ✅ COMPLETE

**Assigned To**: frontend-developer
**Tasks in Batch**: 1
**Dependencies**: Batch 1 COMPLETE (requires namespace unification)
**Estimated Duration**: 1-2 hours
**Estimated Commits**: 1
**Batch Git Commit**: e519cd2

### Task 3.1: Add TOKEN_USAGE_UPDATED Event Subscription to ChatService ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts

**Specification Reference**:

- context.md: "ChatService not subscribed to TOKEN_USAGE_UPDATED event"
- Current subscriptions: Lines 429-510, 750-804 (20+ existing subscriptions)
- Missing: TOKEN_USAGE_UPDATED (CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED)

**Pattern to Follow**: Existing event subscriptions in chat.service.ts (lines 429-510)

**Expected Commit Pattern**: `feat(core): add TOKEN_USAGE_UPDATED event subscription to ChatService`

**Changes Required**:

1. **Verify imports** (lines 1-40):

   - Ensure `ChatTokenUsageUpdatedPayload` is imported from @ptah-extension/shared
   - Should already be imported (line 15+)

2. **Add TOKEN_USAGE_UPDATED subscription** (insert near line 500):

   ```typescript
   // Add this subscription alongside other event subscriptions

   /**
    * Subscribe to token usage updates
    * Updates session token usage in real-time during streaming
    */
   this.vscode
     .onMessageType(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED)
     .pipe(takeUntilDestroyed(this.destroyRef))
     .subscribe({
       next: (payload: ChatTokenUsageUpdatedPayload) => {
         this.logger.debug('ChatService: Token usage updated', {
           sessionId: payload.sessionId,
           tokenUsage: payload.tokenUsage,
         });

         // Update current session token usage
         const currentSession = this.currentSession();
         if (currentSession && currentSession.id === payload.sessionId) {
           const updatedSession = {
             ...currentSession,
             tokenUsage: payload.tokenUsage,
           };
           this.chatState.setCurrentSession(updatedSession);
         }

         // Also update session in sessions list
         const sessions = this.sessions();
         const sessionIndex = sessions.findIndex((s) => s.id === payload.sessionId);
         if (sessionIndex !== -1) {
           const updatedSessions = [...sessions];
           updatedSessions[sessionIndex] = {
             ...sessions[sessionIndex],
             tokenUsage: payload.tokenUsage,
           };
           this.chatState.setSessions(updatedSessions);
         }
       },
       error: (error) => {
         this.logger.error('ChatService: Error handling token usage update', {
           error,
         });
       },
     });
   ```

3. **Verify subscription placement**:
   - Place near other session-related subscriptions (SESSION_UPDATED, SESSION_SWITCHED, etc.)
   - Follow existing patterns for error handling and logging
   - Use `takeUntilDestroyed(this.destroyRef)` for automatic cleanup

**Quality Requirements**:

- ✅ Subscription uses `onMessageType(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED)`
- ✅ Payload typed as `ChatTokenUsageUpdatedPayload`
- ✅ Updates both currentSession and sessions list
- ✅ Includes error handling with logger
- ✅ Uses `takeUntilDestroyed()` for automatic cleanup
- ✅ Follows existing subscription pattern (consistent with other subscriptions)

**Verification Steps**:

```bash
# Build frontend library
npx nx build core

# Typecheck
npx nx run core:typecheck

# Lint
npx nx lint core

# Verify subscription exists
grep -A 20 "TOKEN_USAGE_UPDATED" libs/frontend/core/src/lib/services/chat.service.ts
```

**Implementation Notes**:

- **Critical**: Must update BOTH currentSession and sessions list for UI consistency
- **Pattern**: Follows existing subscription patterns for SESSION_UPDATED
- **Benefit**: Real-time token usage display in UI during streaming
- **Integration**: Completes event flow from backend → frontend

---

**Batch 3 Verification Requirements**:

- ✅ File exists at D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts
- ✅ Git commit exists with pattern `feat(core): add TOKEN_USAGE_UPDATED event subscription to ChatService`
- ✅ Build passes: `npx nx build core`
- ✅ Subscription to `CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED` exists
- ✅ Updates both currentSession and sessions signals
- ✅ Error handling implemented
- ✅ Automatic cleanup via `takeUntilDestroyed()`

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns batch to developer
2. Developer executes ALL tasks in batch (in order if dependencies exist)
3. Developer stages files progressively: `git add [file]` after each task
4. Developer creates ONE commit for batch: `git commit -m "type(scope): description"`
5. Developer updates tasks.md (all tasks → ✅ COMPLETE, add commit SHA)
6. Developer returns with batch completion report + commit SHA
7. Team-leader verifies entire batch
8. If verification passes: Assign next batch (if dependencies allow)
9. If verification fails: Create fix batch

**Parallel Execution** (Batches 1 + 2):

- Batch 1 and Batch 2 are INDEPENDENT
- Can be assigned simultaneously to backend-developer
- Developer can work on both in parallel OR sequentially (developer's choice)
- Both must complete before Batch 3 can start

**Sequential Execution** (Batch 3):

- Batch 3 DEPENDS on Batch 1 (namespace unification must complete first)
- Cannot start until Batch 1 is verified complete
- Batch 2 completion is NOT required for Batch 3

**Commit Strategy**:

- ONE commit per batch (not per task)
- Batch 1: 1 commit
- Batch 2: 1 commit
- Batch 3: 1 commit
- Total: 3 commits for entire task

**Commit Message Format**:

```
type(scope): description

- Detailed changes
- File modifications
- Impact summary
```

**Example**:

```bash
# Batch 1 commit
refactor(claude-domain): eliminate dual namespace, use CHAT_MESSAGE_TYPES directly

- Replace CLAUDE_DOMAIN_EVENTS with CHAT_MESSAGE_TYPES imports
- Update all 17 emit methods to use chat:* namespace
- Remove claude:* event constants
- Maintain backward compatible payload structures

# Batch 2 commit
refactor(shared): add missing fields to StrictChatSession and StrictChatMessage

- Add 5 optional fields to StrictChatSession (model, provider, status, tags, description)
- Add 3 optional fields to StrictChatMessage (model, tokenCount, duration)
- Update Zod validation schemas
- Backward compatible (all fields optional)

# Batch 3 commit
feat(core): add TOKEN_USAGE_UPDATED event subscription to ChatService

- Subscribe to CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED
- Update both currentSession and sessions list
- Add error handling and logging
- Enable real-time token usage display
```

---

## Completion Criteria

**All Batches Complete When**:

- All 3 batch statuses are "✅ COMPLETE"
- All 3 batch commits verified (git log shows all 3 commits)
- All files exist and modified correctly
- All builds pass:
  - `npx nx build claude-domain` ✅
  - `npx nx build shared` ✅
  - `npx nx build core` ✅
- All typechecks pass:
  - `npx nx run claude-domain:typecheck` ✅
  - `npx nx run shared:typecheck` ✅
  - `npx nx run core:typecheck` ✅
- No `claude:*` namespace strings remain in claude-domain.events.ts
- StrictChatSession has 5 new fields
- StrictChatMessage has 3 new fields
- ChatService has TOKEN_USAGE_UPDATED subscription

---

## Verification Protocol

**After Each Batch Completion**:

1. **Developer Actions**:

   - Update all task statuses in batch to "✅ COMPLETE"
   - Add git commit SHA to batch header
   - Add commit message to batch section
   - Return batch completion report to team-leader

2. **Team-Leader Verification**:

   - Verify git commit exists: `git log --oneline -1`
   - Verify commit message follows format
   - Read modified files to verify changes
   - Run build command for affected library
   - Run typecheck for affected library
   - Check specific verification requirements (see each batch)

3. **Outcomes**:
   - **Pass**: Update batch status to "✅ COMPLETE", assign next batch
   - **Partial**: Mark batch as "⚠️ PARTIAL", create fix batch
   - **Fail**: Mark batch as "❌ FAILED", escalate to user

---

## Risk Mitigation

**Batch 1 Risks**:

- **Risk**: Payload structure mismatch between ClaudeContentChunkEvent and ChatMessageChunkPayload
- **Mitigation**: Verify payload compatibility, add transformation if needed
- **Rollback**: Revert to CLAUDE_DOMAIN_EVENTS constant

**Batch 2 Risks**:

- **Risk**: Breaking changes to existing code using StrictChatSession/StrictChatMessage
- **Mitigation**: All new fields are optional (backward compatible)
- **Verification**: Run `npx nx run-many --target=typecheck --all`

**Batch 3 Risks**:

- **Risk**: Subscription fires before Batch 1 namespace change (events still `claude:*`)
- **Mitigation**: Batch 3 DEPENDS on Batch 1 (sequential execution)
- **Verification**: Test after both Batch 1 and Batch 3 complete

---

## Success Metrics

**Functional Success**:

- ✅ All backend events use `chat:*` namespace (single source of truth)
- ✅ Type system complete with all required fields
- ✅ Frontend subscriptions receive all events (zero event loss)
- ✅ Token usage displays in real-time during streaming

**Technical Success**:

- ✅ All builds pass (3/3 libraries)
- ✅ All typechecks pass (entire workspace)
- ✅ No `claude:*` strings in backend event publisher
- ✅ Backward compatible (no breaking changes)

**Code Quality**:

- ✅ Commit messages follow conventions (commitlint validation)
- ✅ Type safety maintained (no `any` types introduced)
- ✅ Consistent patterns (follows existing codebase conventions)
- ✅ Documentation updated (inline comments where needed)

---

**TASK_2025_008 STATUS**: Ready for batch execution
**NEXT ACTION**: Assign Batch 1 and Batch 2 in PARALLEL to backend-developer
