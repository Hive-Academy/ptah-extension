# Task Context: TASK_2025_002

**Created**: 2025-11-15  
**Original Request**: Fix critical event system issues - provider mismatches, excessive logging, and premature initialization

---

## User Intent

Based on comprehensive log analysis (log-analysis-findings.md), there are **4 critical interconnected issues** with the event system:

### 🔴 FIX-001: Provider Data Not Reaching Frontend (BLOCKING)

1. **Backend** successfully registers 2 AI providers (VS Code LM + Claude CLI)
2. **Frontend** receives ZERO providers due to event name mismatch
3. **Root Cause**: Backend publishes `providers:availableUpdated` and `providers:currentChanged`, but frontend only listens for `providers:getAvailable:response`
4. **Impact**: Frontend cannot display or use any AI providers - BLOCKING all AI functionality

### 🔴 FIX-002: Analytics Event Flooding During Initialization (PERFORMANCE)

1. **40+ analytics events** published before webview ready (lines 4-300+)
2. All dropped with "No active webviews" message
3. **Root Cause**: Analytics tracked during initialization before webview exists
4. **Impact**: Wasted EventBus cycles, potential performance degradation

### 🟡 FIX-003: Chat/Session Events Missing (USER-REPORTED BLOCKING)

1. User reports: "events going from angular (webview) to claude cli running instance (session)" not working
2. **Root Cause**: Similar to provider issue - likely event name mismatches for chat/session operations
3. **Expected Events**: `chat:sendMessage`, `session:start`, `session:create`
4. **Impact**: Cannot send messages to Claude CLI, session management broken

### 🟠 FIX-004: Provider Push Events Dropped Before Webview Ready

1. `providers:availableUpdated` published twice before webview ready (lines 205-214)
2. `providers:currentChanged` published before webview ready (line 254)
3. **Root Cause**: Provider events fired during initialization before webview exists
4. **Impact**: Medium - Less frequent than analytics but still wasteful

**All 4 issues share the same root cause: Events published before webview initialization complete**

---

## Conversation Summary

### Log Analysis Findings (Lines 618-627)

**Evidence from logs:**

```
[ProviderService] Providers from response: Array(0)
[ProviderService] Setting available providers to: 0 items
[ProviderService] Available providers after set: Array(0)
```

**Backend State (Lines 200-254):**

- VS Code LM adapter initialized and registered
- Claude CLI adapter initialized and registered  
- Default provider selected: `claude-cli`
- **Backend has 2 providers available**

**Frontend State (Lines 618-627):**

- Request-response flow working correctly (protocol level)
- Response received but contains empty array
- **Frontend shows 0 providers**

### Additional Context

There's also a related **FIX-003** (Chat/Session Event Audit) that likely has the same root cause - event name mismatches between backend and frontend. This task will focus on the provider system first, then the pattern can be applied to fix chat/session events.

---

## Technical Background

### Architecture Overview

**Ptah Extension** = TypeScript VS Code extension + Angular webview frontend

**Communication Flow:**

1. Backend services publish events via EventBus
2. WebviewMessageBridge forwards events to webview
3. Angular services subscribe to events via VSCodeService

**Event Pattern Mismatch:**

- Backend uses **push-based events** (fire and forget)
- Frontend uses **request-response pattern** (request → wait → response)

### Expected Deliverable

**Comprehensive event system fix addressing all 4 issues:**

**FIX-001: Provider Event Alignment**

1. Frontend receives all 2 providers from backend
2. Provider dropdown populated correctly
3. Current provider selection working
4. Real-time provider updates working

**FIX-002: Webview Readiness Gate**

1. Implement webview readiness check before publishing events
2. Queue events during initialization
3. Flush queue once webview ready
4. Zero dropped events in logs

**FIX-003: Chat/Session Event Audit**

1. Audit all chat/session event names (backend vs frontend)
2. Create event mapping table
3. Fix all mismatches
4. Test end-to-end chat flow with Claude CLI

**FIX-004: Event Batching During Init**

1. Batch provider events during initialization
2. Send consolidated update once webview ready
3. Reduce event noise in logs

---

## Success Criteria

**FIX-001 (Provider Mismatch):**

- [ ] Frontend ProviderService receives Array(2) instead of Array(0)
- [ ] Both providers (VS Code LM + Claude CLI) visible in UI
- [ ] Provider selection functional
- [ ] No more "Array(0)" log entries for providers

**FIX-002 (Analytics Flooding):**

- [ ] Zero "No active webviews" messages for analytics events
- [ ] Event queue implemented with readiness gate
- [ ] Performance improvement measurable

**FIX-003 (Chat/Session Events):**

- [ ] Chat messages successfully reach Claude CLI
- [ ] Session creation working
- [ ] Event mapping table documented
- [ ] End-to-end chat flow functional

**FIX-004 (Provider Event Batching):**

- [ ] No provider events published before webview ready
- [ ] Consolidated provider update on initialization complete
- [ ] Clean initialization logs

**Universal:**

- [ ] Event names documented in shared types
- [ ] All quality gates pass (typecheck, lint, build, test)
- [ ] No regression in existing functionality

---

## Files Likely Affected

**Backend (Event Publishing & Lifecycle):**

- `apps/ptah-extension-vscode/src/services/provider-manager.ts` (event publishing, FIX-001, FIX-004)
- `apps/ptah-extension-vscode/src/services/webview-message-bridge.ts` (event forwarding, FIX-002 readiness gate)
- `apps/ptah-extension-vscode/src/services/analytics.service.ts` (analytics events, FIX-002)
- `apps/ptah-extension-vscode/src/services/claude-cli.service.ts` (chat/session events, FIX-003)
- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` (initialization order)

**Frontend (Event Subscription):**

- `apps/ptah-extension-webview/src/app/services/provider.service.ts` (event subscription, FIX-001)
- `apps/ptah-extension-webview/src/app/services/vscode.service.ts` (message handling, all fixes)
- `apps/ptah-extension-webview/src/app/services/chat.service.ts` (chat events, FIX-003)
- `apps/ptah-extension-webview/src/app/services/session.service.ts` (session events, FIX-003)

**Shared (Event Contracts):**

- `libs/shared/src/lib/types/message.types.ts` (event type definitions, all fixes)
- `libs/shared/src/lib/constants/message-types.ts` (event name constants, all fixes)

---

**Task Type**: BUGFIX (Complex - Multiple Interconnected Issues)  
**Complexity**: High (4 related fixes, initialization timing, event lifecycle)  
**Execution Strategy**: Team-Leader (3 modes) → User Choice QA  
**Estimated Effort**: 4-6 hours (comprehensive fix across all 4 issues)
