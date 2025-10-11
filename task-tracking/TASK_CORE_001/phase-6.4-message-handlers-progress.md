# Phase 6.4: Message Handlers Migration Progress

**Started**: 2025-01-15  
**Status**: 🔄 In Progress  
**Target**: Extract business logic from 9 message handlers (~3,240 lines) into orchestration services

---

## 📊 Overall Progress: 15% Complete

| Sub-Phase                            | Status         | Lines                     | Completion |
| ------------------------------------ | -------------- | ------------------------- | ---------- |
| 6.4.1: ChatOrchestrationService      | ✅ COMPLETE    | 881 → Service (600 lines) | 100%       |
| 6.4.2: ProviderOrchestrationService  | 🔄 IN PROGRESS | 629 → Service             | 10%        |
| 6.4.3: Update Existing Service Usage | ⏳ PENDING     | 784 (context + command)   | 0%         |
| 6.4.4: Analytics & Config Services   | ⏳ PENDING     | 429 (analytics + config)  | 0%         |

---

## ✅ Phase 6.4.1: ChatOrchestrationService - COMPLETE

### Business Logic Extracted

- **Source**: `chat-message-handler.ts` (881 lines)
- **Target**: `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts` (600 lines)

### Features Implemented

- ✅ Claude CLI streaming with permission handling
- ✅ Session orchestration (create, switch, rename, delete, bulk delete)
- ✅ Message streaming with token counting
- ✅ Error recovery and retry logic
- ✅ Permission approval workflow
- ✅ Session history and statistics
- ✅ Stop stream functionality

### API Verification

- ✅ SessionManager API verified (Phase 6.3)
  - `createSession({ name })` → returns StrictChatSession
  - `addUserMessage({ sessionId, content, files })` → returns StrictChatMessage
  - `addAssistantMessage({ sessionId, content })` → saves message
  - `getAllSessions()` → returns StrictChatSession[]
  - `getSessionStatistics()` → returns SessionStatistics
  - `bulkDeleteSessions([ids])` → returns BulkDeleteResult { deleted: string[], failed: Array<{id, reason}> }

### Build Status

- ✅ TypeScript compilation: PASSING
- ✅ No lint errors
- ✅ Exported from claude-domain/index.ts
- ✅ All type imports resolved

### Next Handler Update Required

- ⏳ Update `chat-message-handler.ts` to thin adapter (~100 lines)
- Pattern: Delegate to ChatOrchestrationService, forward streaming to webview

---

## 🔄 Phase 6.4.2: ProviderOrchestrationService - IN PROGRESS

### Business Logic to Extract

- **Source**: `provider-message-handler.ts` (629 lines)
- **Target**: `libs/backend/ai-providers-core/src/orchestration/provider-orchestration.service.ts`

### Features to Implement

- 🔄 Provider switching with health checks
- 🔄 Fallback provider management
- 🔄 Auto-switch on failure
- 🔄 Health monitoring with event emission
- 🔄 Default provider configuration
- 🔄 Get available/current provider operations
- 🔄 Provider health status retrieval

### Dependencies Required

- 🔄 ProviderManager from ai-providers (verify API)
- 🔄 IEventBus for event publishing
- 🔄 Type definitions from @ptah-extension/shared

### Event Listeners to Implement

- 🔄 provider-switched → Forward to webview
- 🔄 provider-health-changed → Forward to webview
- 🔄 provider-error → Forward to webview

### API to Verify

- ⏳ ProviderManager.getAvailableProviders()
- ⏳ ProviderManager.getCurrentProvider()
- ⏳ ProviderManager.switchProvider(id, reason)
- ⏳ ProviderManager.getProviderHealth(id)
- ⏳ ProviderManager.getAllProviderHealth()
- ⏳ ProviderManager.setDefaultProvider(id)
- ⏳ ProviderManager.enableFallback(enabled)
- ⏳ ProviderManager.setAutoSwitchOnFailure(enabled)
- ⏳ ProviderManager.on(event, handler) → Event emitter pattern

---

## ⏳ Phase 6.4.3: Update Existing Service Usage - PENDING

### Context Message Handler (523 lines)

- **Current**: Depends on ContextManager (unknown API)
- **Target**: Update to use ContextService from Phase 6.1 ✅
- **Effort**: 2-3 hours
- **Actions**:
  1. Verify ContextService API from workspace-intelligence
  2. Replace ContextManager calls with ContextService calls
  3. Reduce handler to ~80 lines (thin adapter)

### Command Message Handler (261 lines)

- **Current**: Depends on SessionManager (old API)
- **Target**: Update to use CommandService from Phase 6.3 ✅
- **Effort**: 1-2 hours
- **Actions**:
  1. Replace SessionManager calls with CommandService calls
  2. Update executeCodeReview/executeTestGeneration workflows
  3. Reduce handler to ~60 lines (thin adapter)

---

## ⏳ Phase 6.4.4: Analytics & Config Services - PENDING

### Analytics Message Handler (255 lines)

- **Source**: `analytics-message-handler.ts`
- **Target**: `libs/backend/vscode-core/src/analytics/analytics.service.ts`
- **Features**: Event tracking, metrics, telemetry
- **Reduction**: Handler becomes ~50 lines

### Config Message Handler (174 lines)

- **Source**: `config-message-handler.ts`
- **Target**: `libs/backend/vscode-core/src/config/config.service.ts`
- **Features**: Settings management, validation
- **Reduction**: Handler becomes ~40 lines

---

## 📋 Handlers Remaining Thin (No Extraction Needed)

### State Message Handler (154 lines)

- **Status**: Already thin, uses `IStorageService`
- **Action**: Keep as-is, minimal business logic

### View Message Handler (132 lines)

- **Status**: Already thin (just logging)
- **Action**: Keep as-is, no business logic to extract

---

## 🎯 Expected Outcomes After Phase 6.4

### Business Logic Extracted to Services

1. **ChatOrchestrationService** (claude-domain) - ✅ COMPLETE
2. **ProviderOrchestrationService** (ai-providers-core) - 🔄 IN PROGRESS
3. **AnalyticsService** (vscode-core) - ⏳ PENDING
4. **ConfigService** (vscode-core) - ⏳ PENDING

### Handlers Using Existing Services

1. **context-message-handler** → ContextService ✅ (Phase 6.1)
2. **command-message-handler** → CommandService ✅ (Phase 6.3)

### Handlers Remaining Thin

1. **state-message-handler** (~154 lines, minimal logic)
2. **view-message-handler** (~132 lines, just logging)

### Infrastructure (No Changes)

1. **base-message-handler** (97 lines) - Base class, stays in vscode-core
2. **message-router** (120 lines) - Router logic, stays in vscode-core

### Total Line Reduction

- **Before**: 3,240 lines in handlers
- **After**: ~600 lines in handlers (all thin adapters)
- **Savings**: ~2,640 lines moved to services
- **New Services**: ~2,200 lines (cleaner, testable business logic)

---

## 🔨 Current Work

**Working on**: Creating ProviderOrchestrationService in ai-providers-core

**Next Steps**:

1. Read ProviderManager API from ai-providers service
2. Create ProviderOrchestrationService with all provider operations
3. Build and verify TypeScript compilation
4. Export from ai-providers-core/index.ts
5. Update provider-message-handler to thin adapter

---

## 📝 Notes

- **ANTI-BACKWARD COMPATIBILITY**: No "enhanced" or "v2" versions created
- **Type Safety**: Zero `any` types, strict typing throughout
- **API Verification**: All APIs verified against actual source code before implementation
- **Build Status**: All libraries building successfully between phases

**Last Updated**: 2025-01-15 (Phase 6.4.1 complete, starting 6.4.2)
