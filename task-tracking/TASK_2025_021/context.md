# Task Context for TASK_2025_021

## User Intent

Complete RPC architecture migration to replace the deleted event-based messaging system with a simplified, direct communication pattern between frontend and backend.

## Conversation Summary

**Previous Session Work (TASK_2025_010 branch)**:

- Phase 0 (PURGE) completed: ~14,000 lines of event-based code deleted
- Deleted EventBus, MessageHandlerService, SessionManager, SessionProxy
- Deleted 94 message types and all event subscriptions
- Deleted provider abstraction (18 files, 3,616 lines)
- 4 commits created: 44d116f, fa82b80, 05e8dcb, bc0ca56

**Current State**:

- Codebase is in "broken but clean" state
- Event system fully purged
- Build likely failing (compilation errors expected)
- No replacement RPC system yet

**User Decision**:

- Continue RPC migration work as TASK_2025_021
- Use existing implementation plan from RPC_MIGRATION_PLAN.md
- Delegate to team-leader + developers for execution

## Technical Context

- **Branch**: feature/TASK_2025_010 (will continue on this branch)
- **Created**: 2025-11-23
- **Task Type**: REFACTORING (Architecture transformation)
- **Complexity**: Complex (4-6 new components, full-stack changes)
- **Estimated Duration**: 10-14 hours
- **Related Docs**:
  - task-tracking/RPC_MIGRATION_PLAN.md (full migration guide)
  - task-tracking/SESSION_END_SUMMARY.md (previous session summary)

## Execution Strategy

**Strategy**: REFACTORING (Architecture replacement after purge)

**Phases**:

1. **Phase 1**: Verify & Fix Build (1-2 hours)

   - Run `npm run build:all`, document errors
   - Fix compilation errors (remove/comment broken references)
   - Goal: Build succeeds with zero errors

2. **Phase 2**: Create RPC System (4-6 hours)

   - Backend: RpcHandler (~200 lines)
   - Frontend: ClaudeRpcService (~150 lines)
   - Frontend: ClaudeFileService (~100 lines)
   - Frontend: ChatStoreService (~200 lines)
   - Goal: RPC infrastructure complete

3. **Phase 3**: Wire System (2-3 hours)

   - Update main.ts to use RpcHandler
   - Update ChatComponent to use ChatStoreService
   - Wire RPC to ClaudeCliLauncher
   - Goal: All components connected

4. **Phase 4**: Test System (2-3 hours)

   - Test session loading
   - Test message sending
   - Test file reading
   - Goal: Extension works end-to-end

5. **Phase 5**: Fix Lint Errors (1-2 hours)
   - Fix pre-existing lint errors in shared/backend libraries
   - Goal: All lint checks pass

## Architecture Transformation

### Before (Event-Based) ❌

```
Frontend Component
  ↓ postMessage(type, payload)
WebviewMessageBridge
  ↓ route to EventBus
MessageHandlerService (800 lines)
  ↓ subscribe to 94 message types
Orchestration Services (1,620 lines)
  ↓ business logic
SessionManager (896 lines) + SessionProxy (359 lines)
  ↓ caching hell
.jsonl files
```

**Problems**: 15+ message hops, 3 caching layers, message duplication, UI hallucination

### After (RPC-Based) ✅

```
Frontend Component
  ↓ ClaudeRpcService.call(method, params)
RpcHandler (~200 lines)
  ↓ route to method handler
Direct service calls (ClaudeCliLauncher, etc.)
  ↓
.jsonl files (OR direct FileSystem read)
```

**Benefits**: 3 hops (5x simpler), no caching, no duplication, type-safe, direct file reads

## Success Criteria

**Functional**:

- ✅ Extension launches without errors
- ✅ Session list loads from .jsonl files
- ✅ Switching sessions loads messages
- ✅ Sending messages spawns Claude CLI
- ✅ Responses stream back and display
- ✅ No message duplication
- ✅ No UI hallucination

**Technical**:

- ✅ Zero TypeScript compilation errors
- ✅ Zero runtime errors in Extension Host console
- ✅ All lint errors fixed (including pre-existing)
- ✅ Build passes: `npm run build:all`
- ✅ Tests pass: `nx run-many --target=test`

**Code Quality**:

- ✅ No EventBus references remain
- ✅ No event subscription code remains
- ✅ RPC pattern implemented correctly
- ✅ Direct file reads working
- ✅ Signal-based state management

## Critical Reminders

**DO NOT**:

- ❌ Try to restore EventBus or event subscriptions
- ❌ Use orchestration services (deleted)
- ❌ Use SessionManager/SessionProxy (deleted)
- ❌ Use MESSAGE_TYPES constants (deleted)

**DO**:

- ✅ Use direct .jsonl file reads (VS Code FileSystem API)
- ✅ Use RPC for backend operations (spawning CLI)
- ✅ Use signals for frontend state (no RxJS BehaviorSubject)
- ✅ Follow RPC_MIGRATION_PLAN.md for detailed patterns

## Risk Assessment

**Known Issues**:

- Pre-existing lint errors in shared/backend libraries (NOT caused by migration)
- Build will fail initially (expected - Phase 1 fixes this)
- Extension won't launch until Phase 3 complete

**Mitigation**:

- Phase 1 surfaces all issues quickly
- RPC design is simpler (less can go wrong)
- Can bypass pre-commit hooks if needed (user approved in previous session)
- Team-leader verification prevents hallucination

## Reference Files

- **Migration Plan**: task-tracking/RPC_MIGRATION_PLAN.md
- **Session Summary**: task-tracking/SESSION_END_SUMMARY.md
- **Purge Commits**: 44d116f, fa82b80, 05e8dcb, bc0ca56
