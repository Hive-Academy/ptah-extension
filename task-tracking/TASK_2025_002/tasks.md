# Development Tasks - TASK_2025_002

**Task Type**: Full-Stack (Backend + Frontend)
**Developer Needed**: Both (backend-developer first, then frontend-developer)
**Total Tasks**: 7 atomic tasks
**Status**: 0/7 Complete (0%)

**Decomposed From**:
- context.md (comprehensive log analysis findings)
- Log evidence at lines 4-300 (analytics), 205-257 (provider init), 618-627 (provider mismatch)

---

## Task Summary

This task addresses **4 interconnected event system issues** with shared root cause: events published before webview initialization complete + event name mismatches.

**Issues**:
- 🔴 FIX-001: Provider data not reaching frontend (BLOCKING)
- 🔴 FIX-002: Analytics event flooding (40+ events before webview ready)
- 🟡 FIX-003: Chat/session events missing (USER-REPORTED BLOCKING)
- 🟠 FIX-004: Provider events dropped during init

**Strategy**: Foundation first (webview readiness gate + event queue), then fix individual event systems.

---

## Task Breakdown

### Task 1: Implement Webview Readiness Gate and Event Queue 🔄 IN PROGRESS

**Type**: BACKEND  
**Complexity**: Level 3 (Complex - affects all event flows)  
**Estimated Time**: 90-120 minutes  
**Assigned To**: backend-developer  
**Status**: Assigned on 2025-11-15

**Description**:
Create a webview readiness tracking system in AngularWebviewProvider that queues events published before webview initialization and flushes them once ready. This fixes FIX-002 (analytics flooding) and FIX-004 (provider events dropped).

**Files to Change**:
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` - Add readiness flag, event queue, and flush mechanism

**Implementation Details**:
- Add `private _webviewReady = false` flag
- Add `private _eventQueue: Array<{type: string, payload: any}> = []`
- Add `markWebviewReady()` method (call after webview HTML loaded)
- Modify `postMessage()` to check readiness:
  - If not ready: queue event instead of posting
  - If ready: post immediately
- Add `flushEventQueue()` method called after `markWebviewReady()`
- Add logging for queue operations

**Expected Commit Pattern**: `fix(webview): implement readiness gate and event queue to prevent premature events`

**Verification Requirements**:
- ✅ File modified with readiness flag and queue
- ✅ Git commit matches pattern
- ✅ Build passes: `npm run compile`
- ✅ No "No active webviews" messages in logs for analytics events
- ✅ Events queued before ready, flushed after ready

**Dependencies**: None (foundation task)

---

### Task 2: Fix Provider Event Data Flow (Backend) ⏸️ PENDING

**Type**: BACKEND  
**Complexity**: Level 2 (Moderate - request handler modification)  
**Estimated Time**: 60-90 minutes  
**Assigned To**: backend-developer

**Description**:
Fix the `providers:getAvailable` request handler in AngularWebviewProvider to properly serialize and return the full provider array from ProviderManager. Currently returns empty array despite 2 providers being registered.

**Files to Change**:
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` - Fix `handleWebviewMessage()` for `providers:getAvailable` case

**Implementation Details**:
- Locate message handling switch statement (around line 277)
- Find `case 'providers:getAvailable':` handler
- Current code likely returns `{ providers: [] }` or has serialization issue
- Fix to properly call `providerManager.getAvailableProviders()`
- Return `{ providers: availableProviders }` with full provider data
- Add logging: "Returning X providers: [provider IDs]"
- Example from working code at line 511 shows expected response format

**Expected Commit Pattern**: `fix(providers): return actual provider data in getAvailable response`

**Verification Requirements**:
- ✅ File modified with proper data flow
- ✅ Git commit matches pattern
- ✅ Build passes: `npm run compile`
- ✅ Log shows "Returning 2 providers: [vscode-lm, claude-cli]"
- ✅ Frontend logs show Array(2) instead of Array(0)

**Dependencies**: Task 1 (readiness gate ensures events arrive at right time)

---

### Task 3: Update Frontend Provider Event Handling ⏸️ PENDING

**Type**: FRONTEND  
**Complexity**: Level 2 (Moderate - event subscription update)  
**Estimated Time**: 60 minutes  
**Assigned To**: frontend-developer

**Description**:
Update ProviderService to properly handle `providers:availableUpdated` and `providers:currentChanged` push events from backend, not just log them. Currently frontend ignores these events (lines 430-454 of provider.service.ts).

**Files to Change**:
- `libs/frontend/core/src/lib/services/provider.service.ts` - Update event handlers at lines 430-454

**Implementation Details**:
- Line 430: `onMessageType('providers:availableUpdated')` currently only logs
- Change to: extract providers from payload and call `this._availableProviders.set(providers)`
- Line 442: `onMessageType('providers:currentChanged')` already updates state correctly
- Keep current behavior for `currentChanged`
- Add guard: only update if payload contains valid provider array
- Remove comment "don't trigger refresh to avoid loops" - no longer needed with readiness gate

**Expected Commit Pattern**: `fix(frontend): handle provider push events to update state`

**Verification Requirements**:
- ✅ File modified with proper state updates
- ✅ Git commit matches pattern
- ✅ Build passes: `npm run build:webview`
- ✅ Typecheck passes: `npm run typecheck:webview`
- ✅ Providers visible in UI immediately after backend registration

**Dependencies**: Task 2 (backend must send correct data first)

---

### Task 4: Audit and Fix Chat/Session Event Names ⏸️ PENDING

**Type**: BACKEND + FRONTEND  
**Complexity**: Level 3 (Complex - cross-boundary event audit)  
**Estimated Time**: 90-120 minutes  
**Assigned To**: backend-developer

**Description**:
Audit all chat and session event names across backend and frontend to identify and fix mismatches like the provider issue. Create event mapping table and fix all inconsistencies (FIX-003).

**Files to Change**:
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` - Fix chat message handlers
- `libs/frontend/core/src/lib/services/chat.service.ts` - Fix event subscriptions
- `libs/shared/src/lib/constants/message-types.ts` - Verify constants match usage

**Implementation Details**:

**Phase 1: Audit (30 min)**
- Search backend for: `chat:sendMessage`, `chat:sessionStart`, `chat:sessionCreated`
- Search frontend for same event names in subscriptions
- Create mapping table in task notes

**Phase 2: Fix Mismatches (60 min)**
- Update backend event publishing to use constants from `CHAT_MESSAGE_TYPES`
- Update frontend subscriptions to match backend event names
- Ensure request types use base name, response types use `:response` suffix
- Ensure event notifications (push) use descriptive names

**Phase 3: Verify (30 min)**
- Test chat message sending end-to-end
- Verify session creation works
- Check logs for successful event delivery

**Expected Commit Pattern**: `fix(chat): align event names between backend and frontend`

**Verification Requirements**:
- ✅ Files modified with aligned event names
- ✅ Git commit matches pattern
- ✅ Build passes: `npm run compile && npm run build:webview`
- ✅ Chat messages successfully reach Claude CLI
- ✅ Session creation working
- ✅ Event mapping table documented in commit message

**Dependencies**: Task 1 (readiness gate prevents timing issues during testing)

---

### Task 5: Batch Provider Events During Initialization ⏸️ PENDING

**Type**: BACKEND  
**Complexity**: Level 2 (Moderate - timing coordination)  
**Estimated Time**: 60 minutes  
**Assigned To**: backend-developer

**Description**:
Modify provider registration in ptah-extension.ts to batch all provider events and send one consolidated update after all providers registered, instead of firing events during registration loop (FIX-004).

**Files to Change**:
- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` - Modify `registerProviders()` method (lines 381-491)

**Implementation Details**:
- Around line 451-459: Provider registration loop fires events per provider
- Change strategy: Suppress events during loop
- After all providers registered (line 468), fire single `providers:availableUpdated` event
- After default provider selected (line 482), fire single `providers:currentChanged` event
- Add flag parameter to providerManager.registerProvider() to suppress events
- Or: unsubscribe from events during init, resubscribe after

**Expected Commit Pattern**: `fix(providers): batch events during initialization to reduce noise`

**Verification Requirements**:
- ✅ File modified with batched events
- ✅ Git commit matches pattern
- ✅ Build passes: `npm run compile`
- ✅ Log shows single "providers:availableUpdated" after all registrations
- ✅ No duplicate provider events during init
- ✅ Cleaner initialization logs

**Dependencies**: Task 1 (readiness gate), Task 2 (provider data flow fixed)

---

### Task 6: Add Event Name Documentation to Shared Types ⏸️ PENDING

**Type**: DOCUMENTATION  
**Complexity**: Level 1 (Simple)  
**Estimated Time**: 30 minutes  
**Assigned To**: backend-developer

**Description**:
Document all event naming conventions and the request-response vs push event patterns in shared message types to prevent future mismatches.

**Files to Change**:
- `libs/shared/src/lib/constants/message-types.ts` - Add comprehensive JSDoc
- `libs/shared/src/lib/types/message.types.ts` - Add pattern documentation

**Implementation Details**:
- Add JSDoc block at top of `message-types.ts` explaining:
  - Request types: No suffix (e.g., `chat:sendMessage`)
  - Response types: `:response` suffix (e.g., `chat:sendMessage:response`)
  - Push events: Descriptive names (e.g., `chat:sessionCreated`, `providers:availableUpdated`)
- Add examples for each pattern
- Document backend vs frontend responsibilities
- Add "CRITICAL: Never use string literals" warning

**Expected Commit Pattern**: `docs(shared): document event naming conventions and patterns`

**Verification Requirements**:
- ✅ Files modified with comprehensive documentation
- ✅ Git commit matches pattern
- ✅ JSDoc includes all 3 patterns with examples
- ✅ Warning about string literals prominent
- ✅ Backend/frontend responsibilities clear

**Dependencies**: Task 4 (event patterns finalized)

---

### Task 7: End-to-End Integration Testing ⏸️ PENDING

**Type**: TEST  
**Complexity**: Level 2 (Moderate)  
**Estimated Time**: 60 minutes  
**Assigned To**: backend-developer

**Description**:
Manual E2E testing of all 4 fixed issues to verify comprehensive fix. Test provider loading, chat messaging, session creation, and initialization performance.

**Test Scenarios**:

**FIX-001 (Provider Loading)**:
1. Launch extension development host (F5)
2. Open Ptah webview
3. Navigate to settings/provider selection
4. Verify: 2 providers visible (VS Code LM + Claude CLI)
5. Verify: Current provider shows correctly
6. Verify: Provider switching works

**FIX-002 (Analytics Flooding)**:
1. Close all extension dev hosts
2. Launch fresh (F5)
3. Check debug console logs
4. Verify: Zero "No active webviews" messages
5. Verify: No analytics events before webview ready
6. Verify: Analytics events delivered after ready

**FIX-003 (Chat/Session Events)**:
1. Open Ptah webview
2. Create new chat session
3. Send message: "Hello"
4. Verify: Message reaches Claude CLI
5. Verify: Response appears in UI
6. Verify: Session persisted

**FIX-004 (Provider Init Events)**:
1. Check debug console during initialization
2. Verify: Single "providers:availableUpdated" after all registered
3. Verify: No duplicate provider events
4. Verify: Clean initialization logs

**Expected Commit Pattern**: `test(integration): verify all 4 event system fixes working`

**Verification Requirements**:
- ✅ All 4 test scenarios pass
- ✅ Test results documented in test-report.md
- ✅ Screenshots/logs captured for evidence
- ✅ No regressions in existing functionality
- ✅ Git commit with test summary

**Dependencies**: Tasks 1-6 (all fixes implemented)

---

## Verification Protocol

**After Each Task Completion**:
1. Developer commits changes immediately
2. Developer updates task status to "✅ COMPLETE"
3. Developer adds git commit SHA to task
4. Team-leader verifies:
   - Git commit exists and matches pattern
   - Files modified as specified
   - Build passes (if applicable)
5. If verification passes: Assign next task
6. If verification fails: Mark "❌ FAILED", escalate to user

---

## Execution Order

**Phase 1: Foundation** (Tasks 1-2)
- Task 1: Webview readiness gate (CRITICAL - foundation for all fixes)
- Task 2: Provider data flow fix (BLOCKING - needed for UI)

**Phase 2: Event Alignment** (Tasks 3-4)
- Task 3: Frontend provider event handling (depends on Task 2)
- Task 4: Chat/session event audit (can run after Task 1)

**Phase 3: Optimization** (Tasks 5-6)
- Task 5: Batch provider events (depends on Tasks 1-2)
- Task 6: Documentation (depends on Task 4)

**Phase 4: Validation** (Task 7)
- Task 7: E2E testing (depends on all previous tasks)

**Parallel Opportunities**: Tasks 3 and 4 can run in parallel after Tasks 1-2 complete.

---

## Completion Criteria

**All tasks complete when**:
- All 7 task statuses show "✅ COMPLETE"
- All git commits verified and documented
- All files exist and build successfully
- All 4 FIX issues verified resolved in Task 7
- No regressions in existing functionality

**Return to orchestrator with**: "All 7 tasks completed and verified ✅ - Event system comprehensively fixed"
