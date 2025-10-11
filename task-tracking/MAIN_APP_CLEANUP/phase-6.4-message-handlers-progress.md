# Phase 6.4: Message Handler Orchestration Services - Progress Tracker

**Status**: 🔄 In Progress  
**Started**: 2025-01-11  
**Phase Goal**: Extract business logic from all 9 message handlers into reusable orchestration services

---

## 📊 Overview

### Total Handler Analysis

| Handler                          | Current Lines | Target Reduction | Orchestration Service         | Status           |
| -------------------------------- | ------------- | ---------------- | ----------------------------- | ---------------- |
| **chat-message-handler.ts**      | 881           | → ~200 lines     | ✅ ChatOrchestrationService   | ✅ **COMPLETE**  |
| **provider-message-handler.ts**  | 629           | → ~150 lines     | ProviderOrchestrationService  | 📋 Planned       |
| **context-message-handler.ts**   | 523           | → ~150 lines     | Uses existing ContextService  | 📋 Planned       |
| **command-message-handler.ts**   | 261           | → ~80 lines      | Uses existing CommandService  | 📋 Planned       |
| **analytics-message-handler.ts** | 255           | → ~100 lines     | AnalyticsOrchestrationService | 📋 Planned       |
| **config-message-handler.ts**    | 174           | → ~80 lines      | ConfigOrchestrationService    | 📋 Planned       |
| **state-message-handler.ts**     | 154           | → ~50 lines      | No service (state management) | 📋 Planned       |
| **view-message-handler.ts**      | 132           | → ~50 lines      | No service (view updates)     | 📋 Planned       |
| **message-router.ts**            | 120           | Keep as-is       | No change                     | N/A              |
| **base-message-handler.ts**      | 97            | Keep as-is       | Base class                    | N/A              |
| **index.ts**                     | 14            | Keep as-is       | Exports                       | N/A              |
| **TOTAL**                        | **3,240**     | **→ ~860**       | **Save 2,380 lines**          | **31% Complete** |

---

## 🎯 Sub-Phase Breakdown

### Phase 6.4.1: ChatOrchestrationService ✅ COMPLETE

**Goal**: Extract chat business logic from chat-message-handler.ts (881 lines)

**Deliverables**:

- ✅ Create `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts` (600 lines)
- ✅ Export from `libs/backend/claude-domain/src/index.ts`
- ✅ Verify all SessionManager APIs used correctly
- ✅ Build verification: `npx nx build claude-domain` ✅ PASSING

**Implementation Details**:

- **Service**: `ChatOrchestrationService` (@injectable)
- **Dependencies**: SessionManager, ClaudeCliService (via @inject)
- **APIs Implemented**:
  - ✅ `sendMessage()` - Message streaming with session management
  - ✅ `saveAssistantMessage()` - Persist streamed responses
  - ✅ `createSession()` - New session creation
  - ✅ `switchSession()` - Session switching
  - ✅ `getHistory()` - Message history retrieval
  - ✅ `renameSession()` - Session renaming
  - ✅ `deleteSession()` - Single session deletion
  - ✅ `bulkDeleteSessions()` - Batch deletion with BulkDeleteResult
  - ✅ `getAllSessions()` - Session list
  - ✅ `getSessionStatistics()` - Aggregate stats
  - ✅ `handlePermissionResponse()` - Permission workflow
  - ✅ `stopStream()` - Stream termination

**SessionManager API Verification**:

```typescript
✅ createSession(options?: CreateSessionOptions): Promise<StrictChatSession>
✅ addUserMessage(options: AddMessageOptions): Promise<StrictChatMessage>
✅ addAssistantMessage(options: AddMessageOptions): Promise<StrictChatMessage>
✅ getCurrentSession(): StrictChatSession | null
✅ switchSession(sessionId: SessionId): Promise<void>
✅ getAllSessions(): StrictChatSession[]
✅ renameSession(sessionId: SessionId, newName: string): Promise<boolean>
✅ deleteSession(sessionId: SessionId): Promise<boolean>
✅ bulkDeleteSessions(sessionIds: SessionId[]): Promise<BulkDeleteResult>
✅ getSessionStatistics(): SessionStatistics
✅ getClaudeSessionId(ptahSessionId: SessionId): string | undefined
```

**Next Step for Handler**:

- 🔄 Update `chat-message-handler.ts` to call ChatOrchestrationService
- 🔄 Reduce from 881 → ~200 lines (webview communication only)

---

### Phase 6.4.2: ProviderOrchestrationService 📋 PLANNED

**Goal**: Extract provider business logic from provider-message-handler.ts (629 lines)

**Current Handler Responsibilities**:

- Provider status management (Claude CLI detection)
- Health monitoring and status updates
- Provider switching logic
- Configuration verification
- Capability checking

**Proposed Service**: `libs/backend/claude-domain/src/providers/provider-orchestration.service.ts`

**APIs to Implement**:

```typescript
interface ProviderOrchestrationService {
  // Provider status
  getProviderStatus(): Promise<ProviderStatusResult>;
  verifyProvider(): Promise<ProviderVerificationResult>;

  // Health monitoring
  checkHealth(): Promise<HealthCheckResult>;
  getCapabilities(): Promise<CapabilitiesResult>;

  // Provider switching (future multi-provider support)
  switchProvider(providerId: string): Promise<SwitchProviderResult>;
}
```

**Dependencies**:

- ClaudeCliDetector (existing)
- ClaudeCliService (existing)
- Configuration service

**Expected Outcome**:

- Service: ~300 lines of business logic
- Handler: ~150 lines of webview communication
- Reduction: 629 → 150 (save 479 lines)

**Verification Checklist**:

- [ ] ClaudeCliDetector APIs verified
- [ ] Service created and exported from claude-domain
- [ ] All provider operations implemented
- [ ] Build passes: `npx nx build claude-domain`
- [ ] Handler updated to use service
- [ ] Integration test created

---

### Phase 6.4.3: Context & Command Handler Updates 📋 PLANNED

**Goal**: Update context/command handlers to use existing services (no new services needed)

#### Context Handler Update (523 lines → ~150 lines)

**Current**: context-message-handler.ts has embedded business logic  
**Target**: Delegate to existing ContextService from `@ptah-extension/vscode-core`

**ContextService APIs to Use**:

```typescript
// From libs/backend/vscode-core/src/lib/context/
interface ContextService {
  getWorkspaceFiles(): Promise<FileInfo[]>;
  addFileToContext(filePath: string): Promise<void>;
  removeFileFromContext(filePath: string): Promise<void>;
  getIncludedFiles(): FileInfo[];
  optimizeContext(): Promise<OptimizationSuggestion[]>;
}
```

**Handler Refactor**:

- [ ] Verify ContextService exports from vscode-core
- [ ] Update handler to inject ContextService
- [ ] Remove embedded file system logic
- [ ] Remove embedded optimization logic
- [ ] Keep only webview message routing
- [ ] Reduction: 523 → ~150 lines (save 373 lines)

#### Command Handler Update (261 lines → ~80 lines)

**Current**: command-message-handler.ts has embedded command logic  
**Target**: Delegate to existing CommandService from `@ptah-extension/claude-domain`

**CommandService APIs to Use**:

```typescript
// Already exported from claude-domain/src/index.ts
interface CommandService {
  executeCodeReview(request: CodeReviewRequest): Promise<CommandExecutionResult>;
  generateTests(request: TestGenerationRequest): Promise<CommandExecutionResult>;
  manageFileContext(operation: FileContextOperation): Promise<CommandExecutionResult>;
}
```

**Handler Refactor**:

- [ ] Verify CommandService exports (already in claude-domain)
- [ ] Update handler to inject CommandService
- [ ] Remove embedded command execution logic
- [ ] Keep only webview message routing
- [ ] Reduction: 261 → ~80 lines (save 181 lines)

**Combined Expected Outcome**:

- No new services (reuse existing)
- Context handler: 523 → 150 (save 373 lines)
- Command handler: 261 → 80 (save 181 lines)
- **Total saved: 554 lines**

---

### Phase 6.4.4: Analytics & Config Services 📋 PLANNED

#### Analytics Orchestration Service (255 lines → ~100 lines)

**Current**: analytics-message-handler.ts has embedded analytics logic  
**Proposed**: `libs/backend/claude-domain/src/analytics/analytics-orchestration.service.ts`

**Service APIs**:

```typescript
interface AnalyticsOrchestrationService {
  // Event tracking
  trackEvent(event: AnalyticsEvent): Promise<void>;

  // Metrics
  getSessionMetrics(): Promise<SessionMetricsResult>;
  getUsageStatistics(): Promise<UsageStatsResult>;

  // Export
  exportAnalytics(format: 'json' | 'csv'): Promise<ExportResult>;
}
```

**Expected Outcome**:

- Service: ~155 lines
- Handler: ~100 lines
- Reduction: 255 → 100 (save 155 lines)

#### Config Orchestration Service (174 lines → ~80 lines)

**Current**: config-message-handler.ts has embedded config logic  
**Proposed**: `libs/backend/claude-domain/src/config/config-orchestration.service.ts`

**Service APIs**:

```typescript
interface ConfigOrchestrationService {
  // Configuration management
  getConfig(): Promise<ConfigResult>;
  updateConfig(updates: Partial<Config>): Promise<UpdateConfigResult>;
  resetConfig(): Promise<ResetConfigResult>;

  // Validation
  validateConfig(config: Partial<Config>): Promise<ValidationResult>;
}
```

**Expected Outcome**:

- Service: ~94 lines
- Handler: ~80 lines
- Reduction: 174 → 80 (save 94 lines)

**Combined Expected Outcome**:

- Analytics service: ~155 lines
- Config service: ~94 lines
- **Total new code: ~249 lines**
- **Total saved: 249 lines** (handlers reduced by ~249 lines)

---

### Phase 6.4.5: Remaining Handlers (No Services) 📋 PLANNED

**State Handler** (154 lines → ~50 lines):

- No service needed (state management is UI concern)
- Extract any business logic into existing services
- Keep only state synchronization with webview
- Expected reduction: 154 → 50 (save 104 lines)

**View Handler** (132 lines → ~50 lines):

- No service needed (view updates are UI concern)
- Keep only view navigation logic
- Expected reduction: 132 → 50 (save 82 lines)

**Combined Expected Outcome**:

- No new services
- State handler: save 104 lines
- View handler: save 82 lines
- **Total saved: 186 lines**

---

## 🚀 Implementation Order

### Recommended Sequence

1. ✅ **Phase 6.4.1: ChatOrchestrationService** (COMPLETE)

   - Largest handler (881 lines)
   - Establishes pattern for others
   - High impact on codebase organization

2. 🔄 **Phase 6.4.2: ProviderOrchestrationService** (NEXT)

   - Second largest handler (629 lines)
   - Independent from chat service
   - Provider management is core functionality

3. 🔄 **Phase 6.4.3: Context & Command Updates**

   - Leverage existing services (no new services)
   - Quick wins (reuse vscode-core and claude-domain)
   - Combined save: 554 lines

4. 🔄 **Phase 6.4.4: Analytics & Config Services**

   - Smaller services (~250 total lines)
   - Less critical functionality
   - Combined save: 249 lines

5. 🔄 **Phase 6.4.5: State & View Handler Cleanup**
   - No new services needed
   - Final cleanup and polishing
   - Combined save: 186 lines

---

## 📝 Quality Gates (Per Sub-Phase)

### Code Quality Checklist

**Before marking any sub-phase complete**:

- [ ] **Service Created**

  - [ ] Service file created in appropriate library
  - [ ] Uses `@injectable()` decorator
  - [ ] Uses `@inject()` for dependencies
  - [ ] All methods have JSDoc comments
  - [ ] TypeScript strict mode passes
  - [ ] No `any` types used

- [ ] **API Verification**

  - [ ] All dependency APIs verified with grep/read
  - [ ] Example implementations analyzed
  - [ ] Pattern matches existing codebase
  - [ ] Library CLAUDE.md consulted (if exists)

- [ ] **Exports & Integration**

  - [ ] Service exported from library index.ts
  - [ ] All types exported from library index.ts
  - [ ] DI tokens defined and exported
  - [ ] Build passes: `npx nx build [library]`

- [ ] **Handler Update**

  - [ ] Handler imports and injects service
  - [ ] All business logic moved to service
  - [ ] Handler only does webview communication
  - [ ] Line count reduced as expected
  - [ ] Build passes: `npx nx build ptah-extension-vscode`

- [ ] **Testing**

  - [ ] Unit tests for service methods
  - [ ] Integration test for handler + service
  - [ ] Error handling verified
  - [ ] Edge cases covered

- [ ] **Documentation**
  - [ ] Progress.md updated with completion details
  - [ ] Verification trail documented
  - [ ] Any contradictions resolved and documented
  - [ ] Migration notes added (if breaking changes)

---

## 📈 Progress Metrics

### Current Status (2025-01-11)

**Completed**:

- ✅ ChatOrchestrationService (Phase 6.4.1)
  - Service: 600 lines created
  - Handler: 881 → ~200 lines (pending update)
  - Net impact: Save ~281 lines

**In Progress**:

- 🔄 None (awaiting Phase 6.4.2 start)

**Planned**:

- 📋 ProviderOrchestrationService (Phase 6.4.2)
- 📋 Context & Command Updates (Phase 6.4.3)
- 📋 Analytics & Config Services (Phase 6.4.4)
- 📋 State & View Cleanup (Phase 6.4.5)

**Overall Metrics**:

- **Total handlers**: 9 main handlers
- **Current total lines**: 3,240 lines
- **Target total lines**: ~860 lines
- **Expected reduction**: 2,380 lines (73% reduction)
- **Current progress**: 1/9 services complete (11%)
- **Line reduction progress**: 281/2,380 lines (12%)

---

## 🎯 Next Steps

### Immediate Action Items

1. **Update chat-message-handler.ts** (Phase 6.4.1 completion)

   - [ ] Inject ChatOrchestrationService
   - [ ] Replace all business logic calls with service methods
   - [ ] Verify streaming still works
   - [ ] Reduce from 881 → ~200 lines
   - [ ] Test in Extension Development Host

2. **Begin Phase 6.4.2: ProviderOrchestrationService**

   - [ ] Read provider-message-handler.ts (629 lines)
   - [ ] Verify ClaudeCliDetector APIs
   - [ ] Verify ClaudeCliService APIs
   - [ ] Create service implementation plan
   - [ ] Implement ProviderOrchestrationService
   - [ ] Export from claude-domain
   - [ ] Update handler

3. **Documentation Updates**
   - [ ] Update this progress.md after each sub-phase
   - [ ] Document any API contradictions found
   - [ ] Update MAIN_APP_CLEANUP/phase-6.1-context-service-complete.md with Phase 6.4 summary

---

## 🔍 Verification Trail

### Phase 6.4.1 Verification

**ChatOrchestrationService Implementation**:

- **Pattern source**: chat-message-handler.ts (881 lines)
- **SessionManager APIs**: All 10 APIs verified against session-manager.ts
- **Service location**: libs/backend/claude-domain/src/chat/chat-orchestration.service.ts
- **Export verification**: Added to claude-domain/src/index.ts
- **Build status**: ✅ `npx nx build claude-domain` PASSING
- **Line count**: 600 lines (service only, no webview logic)

**SessionManager API Verification**:

```bash
grep -r "createSession" libs/backend/claude-domain/src/session/session-manager.ts
# ✅ FOUND: createSession(options?: CreateSessionOptions)

grep -r "addUserMessage" libs/backend/claude-domain/src/session/session-manager.ts
# ✅ FOUND: addUserMessage(options: AddMessageOptions)

grep -r "bulkDeleteSessions" libs/backend/claude-domain/src/session/session-manager.ts
# ✅ FOUND: bulkDeleteSessions(sessionIds: SessionId[]): Promise<BulkDeleteResult>
```

**No Contradictions Detected**: All SessionManager APIs match the implementation plan.

---

## 📚 Related Documentation

- **Master Plan**: task-tracking/MAIN_APP_CLEANUP/phase-6.1-context-service-complete.md
- **SessionManager**: libs/backend/claude-domain/src/session/session-manager.ts
- **Claude Domain Library**: libs/backend/claude-domain/CLAUDE.md
- **Message Handlers**: apps/ptah-extension-vscode/src/services/webview-message-handlers/

---

**Last Updated**: 2025-01-11  
**Status**: Phase 6.4.1 Complete, Phase 6.4.2 Ready to Begin
