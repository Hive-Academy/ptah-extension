# 🛣️ Implementation Roadmap - Correct Build Order

**Date**: 2025-10-11  
**Approach**: Bottom-Up (Build dependencies before dependents)  
**Current Status**: ✅ Phase 1 COMPLETE - All 5 orchestration services ready

---

## 🎉 PHASE 1 COMPLETE!

**Total Orchestration Services**: 5/5 ✅
**Total Lines**: 2,096 lines
**Time Spent**: ~4 hours (estimate: ~10-15 hours)
**Time Saved**: ~6-11 hours (60-70% faster than planned)

### Completed Services

1. ✅ **ChatOrchestrationService** (600 lines) - Pre-existing
2. ✅ **ProviderOrchestrationService** (530 lines) - Phase 1.1, ~2h
3. ✅ **ContextOrchestrationService** (476 lines) - Phase 1.2, ~1.5h
4. ✅ **AnalyticsOrchestrationService** (248 lines) - Phase 1.3, ~25min
5. ✅ **ConfigOrchestrationService** (242 lines) - Phase 1.4, ~20min

**Pattern Mastery**: Each service took less time than the previous (5x speed increase by service #5)

---

## 🎯 Implementation Sequence

### Why Bottom-Up?

**MessageHandlerService depends on ALL orchestration services:**

```typescript
@injectable()
export class MessageHandlerService {
  constructor(
    @inject(EVENT_BUS) private readonly eventBus: IEventBus,
    @inject(CHAT_ORCHESTRATION_SERVICE) private readonly chatOrchestration: ChatOrchestrationService, // ✅ EXISTS
    @inject(PROVIDER_ORCHESTRATION_SERVICE) private readonly providerOrchestration: ProviderOrchestrationService, // ✅ EXISTS
    @inject(CONTEXT_ORCHESTRATION_SERVICE) private readonly contextOrchestration: ContextOrchestrationService, // ✅ EXISTS
    @inject(ANALYTICS_ORCHESTRATION_SERVICE) private readonly analyticsOrchestration: AnalyticsOrchestrationService, // ✅ EXISTS
    @inject(CONFIG_ORCHESTRATION_SERVICE) private readonly configOrchestration: ConfigOrchestrationService // ✅ EXISTS
  ) {}
}
```

**All dependencies now exist! MessageHandlerService can be created in Phase 2.**

---

## 📋 Phase 1: Build Orchestration Services Layer ✅ COMPLETE

### Phase 1.1: ProviderOrchestrationService ✅ COMPLETE

**File**: `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts`

**Status**: ✅ **COMPLETE**

**Implementation Summary**:

- Created: 530 lines total (~300 business logic, ~150 types, ~80 docs)
- Pattern: Interface-based DI using IProviderManager
- Dependencies: IProviderManager from @ptah-extension/shared
- Build: ✅ Passing (0 errors)
- Time: ~2 hours (planned: 3-4 hours)

**Completion Date**: 2025-10-11

**Details**: See `task-tracking/MAIN_APP_CLEANUP/phase-1.1-provider-orchestration-progress.md`

---

### Phase 1.2: ContextOrchestrationService ✅ COMPLETE

**File**: `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`

**Status**: ✅ **COMPLETE**

**Implementation Summary**:

- Created: 476 lines total (leveraged existing ContextService)
- Pattern: Direct service injection (same library)
- Dependencies: ContextService from workspace-intelligence
- Library: workspace-intelligence (NOT claude-domain - context is workspace concern)
- Build: ✅ Passing (0 errors)
- Time: ~1.5 hours (planned: 4-5 hours, saved 2.5h due to existing service)

**Completion Date**: 2025-10-11

**Details**: See `task-tracking/MAIN_APP_CLEANUP/phase-1.2-context-orchestration-progress.md`

---

### Phase 1.3: AnalyticsOrchestrationService ✅ COMPLETE

**File**: `libs/backend/claude-domain/src/analytics/analytics-orchestration.service.ts`

**Status**: ✅ **COMPLETE**

**Implementation Summary**:

- Created: 248 lines total
- Pattern: Interface-based DI using IAnalyticsDataCollector
- Dependencies: IAnalyticsDataCollector from main app
- Build: ✅ Passing (0 errors)
- Time: ~25 minutes (planned: 1-2 hours, 5x faster due to pattern mastery)

**Completion Date**: 2025-10-11

**Details**: See `task-tracking/MAIN_APP_CLEANUP/phase-1.3-analytics-orchestration-progress.md`

---

### Phase 1.4: ConfigOrchestrationService ✅ COMPLETE

**File**: `libs/backend/claude-domain/src/config/config-orchestration.service.ts`

**Status**: ✅ **COMPLETE**

**Implementation Summary**:

- Created: 242 lines total
- Pattern: Interface-based DI using IConfigurationProvider
- Dependencies: VS Code API wrapper (IConfigurationProvider)
- Build: ✅ Passing (0 errors)
- Time: ~20 minutes (planned: 1 hour, 3x faster, simplest service)

**Completion Date**: 2025-10-11

**Details**: See `task-tracking/MAIN_APP_CLEANUP/phase-1.4-config-orchestration-progress.md`

**Dependencies**: ClaudeCliDetector, ClaudeCliService (both exist in claude-domain)

**Implementation Steps**:

1. **Read Current Handler**

   ```bash
   # Read to understand business logic
   Read(apps/ptah-extension-vscode/src/services/webview-message-handlers/provider-message-handler.ts)
   ```

2. **Verify Dependencies**

   ```bash
   # Verify ClaudeCliDetector exists
   grep -r "export class ClaudeCliDetector" libs/backend/claude-domain/src/

   # Verify ClaudeCliService interface
   grep -r "interface.*ClaudeCliService" libs/backend/claude-domain/src/
   ```

3. **Create Service** (~300 lines)

   ```typescript
   /**
    * ProviderOrchestrationService - Provider management for Ptah extension
    *
    * Migrated from: provider-message-handler.ts (629 lines)
    * Business logic only: ~300 lines
    */

   import { injectable, inject } from 'tsyringe';
   import type { ClaudeCliDetector } from '../detector/claude-cli-detector';
   import type { IClaudeCliService } from '../chat/chat-orchestration.service';

   export const CLAUDE_CLI_DETECTOR = Symbol.for('ClaudeCliDetector');
   export const CLAUDE_CLI_SERVICE = Symbol.for('ClaudeCliService');

   export interface SwitchProviderRequest {
     providerId: string;
   }

   export interface SwitchProviderResult {
     success: boolean;
     providerId?: string;
     error?: string;
   }

   export interface ProviderStatusResult {
     success: boolean;
     status?: {
       installed: boolean;
       version?: string;
       healthy: boolean;
     };
     error?: string;
   }

   export interface HealthCheckResult {
     success: boolean;
     healthy?: boolean;
     capabilities?: string[];
     error?: string;
   }

   @injectable()
   export class ProviderOrchestrationService {
     constructor(@inject(CLAUDE_CLI_DETECTOR) private readonly detector: ClaudeCliDetector, @inject(CLAUDE_CLI_SERVICE) private readonly claudeService: IClaudeCliService) {}

     async switchProvider(request: SwitchProviderRequest): Promise<SwitchProviderResult> {
       try {
         // Business logic from provider-message-handler.ts
         console.info(`Switching to provider: ${request.providerId}`);

         // Currently only Claude CLI is supported
         if (request.providerId !== 'claude-cli') {
           return {
             success: false,
             error: `Provider ${request.providerId} not supported`,
           };
         }

         return {
           success: true,
           providerId: request.providerId,
         };
       } catch (error) {
         console.error('Error switching provider:', error);
         return {
           success: false,
           error: error instanceof Error ? error.message : 'Failed to switch provider',
         };
       }
     }

     async getProviderStatus(): Promise<ProviderStatusResult> {
       try {
         const installation = await this.detector.detect();
         const isInstalled = installation !== null;

         return {
           success: true,
           status: {
             installed: isInstalled,
             version: installation?.version,
             healthy: isInstalled,
           },
         };
       } catch (error) {
         console.error('Error getting provider status:', error);
         return {
           success: false,
           error: error instanceof Error ? error.message : 'Failed to get provider status',
         };
       }
     }

     async checkHealth(): Promise<HealthCheckResult> {
       try {
         const isAvailable = await this.claudeService.verifyInstallation();

         return {
           success: true,
           healthy: isAvailable,
           capabilities: isAvailable ? ['chat', 'streaming', 'permissions'] : [],
         };
       } catch (error) {
         console.error('Error checking health:', error);
         return {
           success: false,
           error: error instanceof Error ? error.message : 'Health check failed',
         };
       }
     }
   }
   ```

4. **Export from Library**

   ```typescript
   // libs/backend/claude-domain/src/index.ts

   // Provider Orchestration
   export { ProviderOrchestrationService } from './provider/provider-orchestration.service';
   export type { SwitchProviderRequest, SwitchProviderResult, ProviderStatusResult, HealthCheckResult } from './provider/provider-orchestration.service';
   ```

5. **Build Verification**

   ```bash
   npx nx build claude-domain
   ```

**Expected Result**: ✅ Build passes, service ready for use

**Estimated Time**: 3-4 hours

### Phase 1.2: ContextOrchestrationService ✅ COMPLETE

**File**: `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`

**Status**: ✅ **COMPLETE**

**Implementation Summary**:

- Created: 476 lines total (~200 business logic, ~200 types, ~76 docs)
- Pattern: Direct service dependency (ContextService from workspace-intelligence)
- Dependencies: ContextService from same library
- Build: ✅ Passing (0 errors)
- Time: ~1.5 hours (planned: 4-5 hours, faster due to existing ContextService)

**Completion Date**: 2025-10-11

**Details**: See `task-tracking/MAIN_APP_CLEANUP/phase-1.2-context-orchestration-progress.md`

---

### Phase 1.3: AnalyticsOrchestrationService 🎯 NEXT

**File**: `libs/backend/claude-domain/src/analytics/analytics-orchestration.service.ts`

**Dependencies**: workspace-intelligence services (WorkspaceIndexerService, etc.)

**Note**: May need to move to workspace-intelligence library instead of claude-domain (context management is workspace concern, not Claude-specific)

**Estimated Time**: 4-5 hours

---

### Phase 1.3: AnalyticsOrchestrationService

**File**: `libs/backend/claude-domain/src/analytics/analytics-orchestration.service.ts`

**Dependencies**: Minimal (analytics tracking only)

**Estimated Time**: 2-3 hours

---

### Phase 1.4: ConfigOrchestrationService

**File**: `libs/backend/claude-domain/src/config/config-orchestration.service.ts`

**Dependencies**: Minimal (configuration management only)

**Estimated Time**: 1-2 hours

---

## 📋 Phase 2: Create MessageHandlerService Router

**⚠️ PREREQUISITE**: All Phase 1 orchestration services MUST be complete and building

**File**: `libs/backend/claude-domain/src/messaging/message-handler-service.ts`

**Why Now?** All dependencies exist, we can safely inject them.

**Estimated Time**: 2-3 hours

---

## 📋 Phase 3: Delete Main App Handlers

**Files to Delete**: `apps/ptah-extension-vscode/src/services/webview-message-handlers/`

**Estimated Time**: 10 minutes

---

## 📋 Phase 4: Update Main App

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Changes**: Register MessageHandlerService with DI

**Estimated Time**: 1 hour

---

## 📋 Phase 5: Testing

**Verification**: End-to-end message flow via EventBus

**Estimated Time**: 2-3 hours

---

## 📊 Progress Tracking

### Orchestration Services

| Service                       | Status  | Lines | Estimated | Actual |
| ----------------------------- | ------- | ----- | --------- | ------ |
| ChatOrchestrationService      | ✅ DONE | 600   | -         | -      |
| ProviderOrchestrationService  | ✅ DONE | 530   | 3-4h      | ~2h    |
| ContextOrchestrationService   | ✅ DONE | 476   | 4-5h      | ~1.5h  |
| AnalyticsOrchestrationService | 🎯 NEXT | 155   | 2-3h      | -      |
| ConfigOrchestrationService    | 📋 TODO | 94    | 1-2h      | -      |

**Total**: 1,855 lines across 5 services (3 complete, 2 remaining)

---

### Integration Layer

| Component             | Status     | Lines | Estimated | Actual |
| --------------------- | ---------- | ----- | --------- | ------ |
| MessageHandlerService | ⏸️ BLOCKED | 200   | 2-3h      | -      |

**Blocked By**: Needs all orchestration services completed first

---

### Main App Cleanup

| Task               | Status     | Estimated | Actual |
| ------------------ | ---------- | --------- | ------ |
| Delete handlers    | ⏸️ BLOCKED | 10min     | -      |
| Update main.ts     | ⏸️ BLOCKED | 1h        | -      |
| End-to-end testing | ⏸️ BLOCKED | 2-3h      | -      |

**Blocked By**: Needs MessageHandlerService completed first

---

## 🎯 Current Action

**START HERE**: Phase 1.1 - ProviderOrchestrationService

**Next Steps**:

1. Read `provider-message-handler.ts` (629 lines)
2. Verify ClaudeCliDetector and ClaudeCliService APIs
3. Create ProviderOrchestrationService (~300 lines)
4. Export from claude-domain/src/index.ts
5. Verify build: `npx nx build claude-domain`

**Ready to begin?** ✅

---

**Total Estimated Time**: 15-20 hours  
**Implementation Order**: Bottom-Up ✅  
**Current Phase**: 1.1 (ProviderOrchestrationService) 🎯
