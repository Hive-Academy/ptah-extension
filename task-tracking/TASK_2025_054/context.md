# TASK_2025_054: ChatStore Service Architecture Cleanup

## Overview

Comprehensive refactoring to address 5 SERIOUS architectural issues identified during TASK_2025_053 code review. These issues are technical debt from the facade pattern refactoring that, while functional, violate best practices and create maintenance challenges.

## User Intent

Clean up architectural issues in ChatStore and child services:

1. Eliminate shared mutable state between services
2. Fix memory leaks in session resolution tracking
3. Remove callback indirection (3-level complexity)
4. Simplify dual session ID system (sessionId vs claudeSessionId)
5. Centralize message validation logic

## Dependencies

**Prerequisite**: TASK_2025_053 must be complete and merged

- Requires the facade pattern implementation
- Builds on the 5 child services (SessionLoader, Conversation, PermissionHandler, StreamingHandler, CompletionHandler)

## Technical Context

### Current State (After TASK_2025_053)

**Architecture**:

- ChatStore facade (783 lines)
- 5 child services (SessionLoader, Conversation, PermissionHandler, StreamingHandler, CompletionHandler)
- Facade pattern correctly implemented
- 100% backward compatibility maintained

**Issues Identified by QA Reviewers**:

- **Code-Style-Reviewer Score**: 6.5/10 (NEEDS_REVISION)
- **Code-Logic-Reviewer Score**: 6.5/10 (NEEDS_REVISION)
- **Blocking Issues Fixed**: 4/4 ✅
- **Serious Issues Remaining**: 5/5 ⏸️ (deferred to this task)

### The 5 Serious Issues

#### Issue #1: Shared Mutable State (Service Coupling)

**Location**: `conversation.service.ts:310`

**Problem**: ConversationService directly mutates SessionLoaderService's `pendingSessionResolutions` Map

```typescript
// ❌ Violates encapsulation
this.sessionLoader.pendingSessionResolutions.set(placeholderSessionId, tabId);
```

**Impact**:

- Tight coupling between services
- Hard to test independently
- Violates Single Responsibility Principle
- If SessionLoader changes Map structure, Conversation breaks

#### Issue #2: Memory Leak (No Cleanup Mechanism)

**Location**: `session-loader.service.ts:40`

**Problem**: Failed session creations leave orphaned entries in Map forever

```typescript
// Map grows unbounded - no cleanup for failures
public readonly pendingSessionResolutions = new Map<string, string>();
```

**Impact**:

- 1,000 failed sessions = 1,000 orphaned Map entries
- Slow leak over months/years
- No timeout or error cleanup

#### Issue #3: Callback Pattern Indirection (3-Level Complexity)

**Location**: ChatStore → ConversationService → CompletionHandler

**Problem**: Circular dependency workaround creates 3-level callback chain

```typescript
// Level 1: ChatStore.initializeServices()
this.conversation.setSendMessageCallback(this.sendMessage.bind(this));

// Level 2: ConversationService stores callback
private _sendMessageCallback: ((content: string) => void) | null = null;

// Level 3: ConversationService calls through indirection
this._sendMessageCallback(content);
```

**Impact**:

- Confusing for new developers (where is this callback set?)
- 3 levels of indirection to trace
- Exists only to avoid circular dependency

#### Issue #4: Dual ID System Confusion (sessionId vs claudeSessionId)

**Location**: Throughout all services

**Problem**: Two separate session ID properties used inconsistently

```typescript
// Different services use different IDs
sessionManager.setSessionId(placeholderSessionId); // Draft ID
sessionManager.setClaudeSessionId(actualSessionId); // Real ID

// When to use which? No clear convention.
```

**Impact**:

- Developer confusion (which ID to use when?)
- No clear state transition (draft → confirmed)
- Inconsistent usage across services

#### Issue #5: Magic String Validation (No Centralization)

**Location**: `conversation.service.ts:133-139`

**Problem**: Whitespace validation only in `queueOrAppendMessage()`, not in `sendMessage()`

```typescript
// ❌ Inconsistent validation
queueOrAppendMessage() {
  if (content.trim() === '') return; // VALIDATES
}

sendMessage() {
  // NO validation - can send whitespace-only
}
```

**Impact**:

- Inconsistent behavior (queue rejects, send allows)
- No centralized validation rules
- Edge cases not handled (null, undefined, punctuation-only)

---

## Goals

### Primary Goal

Transform ChatStore architecture from "functional but flawed" to "clean and maintainable"

### Success Criteria

- ✅ No shared mutable state between services
- ✅ No memory leaks (timeout + error cleanup)
- ✅ No callback indirection (direct service calls via mediator)
- ✅ Single session ID system (clear state machine)
- ✅ Centralized validation (consistent rules everywhere)
- ✅ All tests pass (100% regression-free)
- ✅ Code review scores improve to 9/10+

### Non-Goals

- ❌ SDK migration (deferred to TASK_2025_044)
- ❌ New features
- ❌ UI changes
- ❌ Performance optimization (already addressed in TASK_2025_053)

---

## Execution Strategy

**Type**: REFACTORING
**Complexity**: Medium-High
**Estimated Time**: 17-24 hours (2-3 focused days)

**Strategy**: Incremental batches with independent commits

- Each batch is self-contained
- Each batch can be tested independently
- Each batch improves one aspect of architecture

**Batch Breakdown**:

1. **Batch 1**: Extract PendingSessionManager service (3-4h)
2. **Batch 2**: Add cleanup mechanisms (2-3h)
3. **Batch 3**: Extract MessageSender service (4-6h)
4. **Batch 4**: Session ID system redesign (6-8h)
5. **Batch 5**: Centralize validation (2-3h)

---

## Risk Assessment

### Medium Risk Factors

- **Session Logic**: Critical user flow (don't break session resolution)
- **Permission Logic**: Critical user flow (don't break permissions)
- **Large Scope**: Touches 5+ services
- **Testing Required**: Comprehensive integration tests needed

### Mitigation Strategies

1. **Test-First Approach**: Write integration tests BEFORE refactoring
2. **Incremental Commits**: Commit after each batch (5 commits)
3. **Extensive Manual Testing**: Test all session/permission flows
4. **Code Review**: Request thorough review from team

---

## Files to Modify

### New Services (Create)

- `libs/frontend/chat/src/lib/services/pending-session-manager.service.ts` (NEW)
- `libs/frontend/chat/src/lib/services/message-sender.service.ts` (NEW)
- `libs/frontend/chat/src/lib/services/message-validation.service.ts` (NEW)

### Modified Services

- `libs/frontend/chat/src/lib/services/chat.store.ts` (inject new services)
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (remove Map, inject manager)
- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` (inject manager, remove callbacks)
- `libs/frontend/chat/src/lib/services/chat-store/completion-handler.service.ts` (remove callbacks)
- `libs/backend/claude-domain/src/lib/session/session-manager.service.ts` (simplify session ID logic)

---

## Branch Strategy

**Branch Name**: `feature/chatstore-architecture-cleanup`
**Base Branch**: `main` (or `feature/sdk-only-migration` if TASK_2025_053 not merged yet)

---

## Testing Strategy

### Unit Tests (Per Service)

- PendingSessionManager: add, remove, get, timeout cleanup
- MessageSender: send, queue, message routing
- MessageValidation: all validation rules

### Integration Tests (End-to-End)

- Session creation → resolution → success
- Session creation → RPC failure → cleanup
- Permission request → user approval → backend response
- Message send while streaming → queue → restore on stop

### Manual Testing Checklist

- [ ] Create new conversation → verify session ID resolves
- [ ] Create conversation, close VS Code mid-flight → verify cleanup
- [ ] Send message while streaming → verify queued
- [ ] Stop streaming → verify queue restored
- [ ] Trigger permission → approve → verify tool executes
- [ ] Switch tabs rapidly → verify no session ID mix-up

---

## Rollback Plan

If issues discovered after merge:

1. **Revert commit**: `git revert <commit-sha>` (clean revert, 5 commits)
2. **Feature flag** (if implemented): Toggle to old code path
3. **Hotfix**: Address specific issue, re-merge

---

## Post-Completion

### Documentation Updates

- Update `libs/frontend/chat/CLAUDE.md` (architecture changes)
- Update code review documents (mark issues RESOLVED)
- Update registry.md (mark TASK_2025_054 complete)

### Follow-Up Tasks

- None expected (this addresses all architectural debt)
- If SDK migration (TASK_2025_044) happens, may need minor adjustments

---

## Timeline Estimate

**Day 1** (8 hours):

- Batch 1: PendingSessionManager (3-4h)
- Batch 2: Cleanup mechanisms (2-3h)
- Batch 3: MessageSender (start, 2-3h)

**Day 2** (8 hours):

- Batch 3: MessageSender (complete, 2-3h)
- Batch 4: Session ID redesign (6-8h start)

**Day 3** (6-8 hours):

- Batch 4: Session ID redesign (complete, 4-5h)
- Batch 5: Validation (2-3h)
- Testing + PR

**Total**: 2-3 days focused work

---

## Approval

**Created**: 2025-12-07
**Status**: 📋 Planned
**Owner**: frontend-developer (via team-leader orchestration)
**Reviewer**: code-style-reviewer + code-logic-reviewer
