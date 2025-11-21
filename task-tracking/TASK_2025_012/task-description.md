# TASK_2025_012 - Task Description

## Title

Frontend Integration & Code Modernization

## Objective

Complete remaining frontend integration work and code modernization tasks identified from TASK_2025_008 validation, including critical workspace-intelligence integration architecture fix.

## Priority

**HIGH** (Batch 6 blocks @ mention file selection feature)

## Estimated Effort

15-21 hours (11 sub-tasks across 6 batches)

---

## Requirements

### Batch 1: Angular Modernization (2 hours)

#### REQ-1.1: Migrate ChatComponent to DestroyRef

**Description**: Replace destroy$ Subject pattern with Angular 20 DestroyRef in ChatComponent

**Current State**: Uses `private readonly destroy$ = new Subject<void>()` (line 325)

**Acceptance Criteria**:

- Replace destroy$ with `private readonly destroyRef = inject(DestroyRef)`
- Replace all `takeUntil(this.destroy$)` with `takeUntilDestroyed(this.destroyRef)`
- Remove ngOnDestroy() method
- Type check passes: `nx run chat:typecheck`
- No destroy$ pattern found: `grep -n "destroy$" chat.component.ts` returns 0 results

**Files**:

- MODIFY: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`

---

#### REQ-1.2: Migrate DashboardComponent to DestroyRef

**Description**: Replace destroy$ Subject pattern with Angular 20 DestroyRef in DashboardComponent

**Current State**: Uses `private readonly destroy$ = new Subject<void>()` (line 136)

**Acceptance Criteria**:

- Replace destroy$ with `private readonly destroyRef = inject(DestroyRef)`
- Replace all `takeUntil(this.destroy$)` with `takeUntilDestroyed(this.destroyRef)`
- Remove ngOnDestroy() method
- Type check passes: `nx run dashboard:typecheck`
- No destroy$ pattern found: `grep -n "destroy$" dashboard.component.ts` returns 0 results

**Files**:

- MODIFY: `libs/frontend/dashboard/src/lib/containers/dashboard/dashboard.component.ts`

---

### Batch 2: Code Consolidation (2-3 hours)

#### REQ-2.1: Extract formatDuration() Utility

**Description**: Create shared utility to eliminate code duplication across 3 components

**Current State**: formatDuration() method duplicated in:

- `agent-tree.component.ts:101-109`
- `agent-status-badge.component.ts`
- `agent-timeline.component.ts`

**Acceptance Criteria**:

- CREATE: `libs/frontend/shared-ui/src/lib/utils/time-formatting.utils.ts` with formatDuration() function
- MODIFY: 3 component files to import and use shared utility
- Remove local formatDuration() method from all 3 components
- Support hours, minutes, seconds (e.g., "1h 5m", "2m 30s", "45s")
- Type check passes: `nx run-many --target=typecheck`
- No local formatDuration definitions: `grep -rn "formatDuration(" libs/frontend/chat/src/lib/components --include="*.ts"` shows only imports

**Files**:

- CREATE: `libs/frontend/shared-ui/src/lib/utils/time-formatting.utils.ts`
- MODIFY: `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts`
- MODIFY: `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.ts`
- MODIFY: `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.ts`
- MODIFY: `libs/frontend/shared-ui/src/index.ts` (export utility)

---

### Batch 3: State Restoration (3-4 hours)

#### REQ-3.1: Implement REQUEST_INITIAL_DATA Backend Handler

**Description**: Implement backend handler to restore webview state on reload

**Current State**:

- ✅ Message type exists: `SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA`
- ✅ Frontend sends on init: `chat-state-manager.service.ts:341`
- ❌ Backend handler NOT implemented in message-handler.service.ts

**Acceptance Criteria**:

- Add REQUEST_INITIAL_DATA subscription in MessageHandlerService.subscribeToChatMessages()
- Gather current session, all sessions, provider info, workspace root
- Publish INITIAL_DATA event with gathered state
- Publish acknowledgment response
- Handle errors gracefully (log + return error response)
- Type check passes: `nx run claude-domain:typecheck`
- Handler exists: `grep -n "REQUEST_INITIAL_DATA.*subscribe" libs/backend/claude-domain/src/messaging/message-handler.service.ts` returns implementation

**Files**:

- MODIFY: `libs/backend/claude-domain/src/messaging/message-handler.service.ts`

**Testing**:

- Reload webview → REQUEST_INITIAL_DATA sent → INITIAL_DATA received → state restored
- Current session, sessions list, provider info all populated

---

### Batch 4: Provider Integration (2-3 hours)

#### REQ-4.1: Add SELECT_MODEL Message Type

**Description**: Add message type for model selection in provider system

**Current State**: Not in codebase (only in TASK_2025_008 docs)

**Acceptance Criteria**:

- Add `SELECT_MODEL: 'providers:selectModel'` to PROVIDER_MESSAGE_TYPES
- Create ProviderSelectModelPayload interface (modelId, optional providerId)
- Create ProviderSelectModelResult interface (success, modelId, error)
- Add to MessagePayloadMap with proper typing
- Type check passes: `nx run shared:typecheck`

**Files**:

- MODIFY: `libs/shared/src/lib/constants/message-types.ts`
- MODIFY: `libs/shared/src/lib/types/message-payload.types.ts`

---

#### REQ-4.2: Implement SELECT_MODEL Backend Handler

**Description**: Implement backend handler and orchestration method for model selection

**Acceptance Criteria**:

- Add SELECT_MODEL subscription in MessageHandlerService.subscribeToProviderMessages()
- Implement selectModel() method in ProviderOrchestrationService
- Validate model exists for provider
- Update current model selection
- Publish MODEL_CHANGED event
- Handle errors gracefully
- Type check passes: `nx run claude-domain:typecheck`

**Files**:

- MODIFY: `libs/backend/claude-domain/src/messaging/message-handler.service.ts`
- MODIFY: `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts`

**Testing**:

- Select model from dropdown → SELECT_MODEL message sent → backend validates → model changed event published

---

### Batch 5: Analytics Integration (2-3 hours)

#### REQ-5.1: Replace Hardcoded Analytics Data with Real Service Calls

**Description**: Replace hardcoded analytics values (12, 47, 1234) with real data from analytics service

**Current State**: analytics.component.ts:200-218 has hardcoded values with TODO comment

**Acceptance Criteria**:

- Inject AnalyticsService into AnalyticsComponent
- Create signals for analytics data and loading state
- Fetch real data in ngOnInit() via analyticsService.fetchAnalyticsData()
- Update getStatsData() to use signal data
- Handle loading and error states
- CREATE AnalyticsService if not exists (with VSCodeService integration)
- No hardcoded values: `grep -n "sessions: 12\|messages: 47\|tokens: 1234" analytics.component.ts` returns 0 results
- Type check passes: `nx run analytics:typecheck`

**Files**:

- MODIFY: `libs/frontend/analytics/src/lib/containers/analytics/analytics.component.ts`
- CREATE (if not exists): `libs/frontend/analytics/src/lib/services/analytics.service.ts`
- MODIFY: `libs/frontend/analytics/src/index.ts` (export service if created)

**Testing**:

- Open analytics view → displays real session count, message count, token usage
- Loading state shown during fetch
- Error handled gracefully if fetch fails

---

### Batch 6: Workspace Intelligence Integration (4-6 hours) **[CRITICAL]**

#### REQ-6.1: Fix File Include/Exclude Architecture

**Description**: Create architectural bridge to enable file include/exclude functionality for @ mentions

**Problem**: Handlers commented out in message-handler.service.ts (lines 584-634) because:

- workspace-intelligence requires vscode.Uri objects
- message-handler is in claude-domain (shouldn't depend on vscode)
- No bridge layer exists to convert filePath string → vscode.Uri

**Acceptance Criteria**:

- CREATE ContextMessageBridgeService in main app layer
- Subscribe to INCLUDE_FILE and EXCLUDE_FILE messages
- Convert filePath strings to vscode.Uri objects
- Delegate to contextOrchestration.includeFile()/excludeFile()
- Publish response events through EventBus
- Register service in extension.ts activation
- Add CONTEXT_MESSAGE_BRIDGE token to vscode-core
- Remove commented code from message-handler.service.ts (lines 584-634)
- Add documentation comment explaining bridge pattern
- Type check passes: `nx run-many --target=typecheck`
- @ mention file selection works in chat input
- Files successfully added to context (visible in context panel)

**Files**:

- CREATE: `apps/ptah-extension-vscode/src/services/context-message-bridge.service.ts`
- MODIFY: `apps/ptah-extension-vscode/src/extension.ts` (register bridge)
- MODIFY: `libs/backend/vscode-core/src/di/tokens.ts` (add token)
- MODIFY: `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (remove commented code, add docs)

**Sub-tasks**:

- 6.1.1: Create ContextMessageBridgeService class
- 6.1.2: Register bridge in extension activation
- 6.1.3: Remove commented code from MessageHandler
- 6.1.4: Integration testing

**Testing**:

- Type @ in chat input → file suggestions appear
- Select file → INCLUDE_FILE message sent → bridge converts to Uri → context updated
- File visible in context panel
- Click remove → EXCLUDE_FILE message sent → file removed from context
- No vscode import errors in claude-domain
- All type checks pass

---

## Non-Functional Requirements

### Build & Quality

- All TypeScript projects must compile without errors
- All ESLint checks must pass
- No new type safety escape hatches (`any` types)
- Maintain or improve test coverage (80% minimum)

### Architecture

- No VS Code module imports in claude-domain library
- EventBus message patterns followed consistently
- DI container properly configured for all new services
- Separation of concerns maintained (main app vs libraries)

### Performance

- No degradation in page load time
- Analytics data fetch < 2 seconds
- REQUEST_INITIAL_DATA response < 1 second
- File context operations < 500ms

### Documentation

- JSDoc comments for all public methods
- Update CLAUDE.md files if architecture changes
- Inline comments for non-obvious code
- README updates if new patterns introduced

---

## Out of Scope

The following from TASK_2025_008 are explicitly OUT OF SCOPE (already complete):

- ContentBlock type system (TASK_2025_009)
- Message deduplication system (TASK_2025_009)
- Backend parser structure preservation (TASK_2025_009)
- Frontend ContentBlock rendering (TASK_2025_009)
- Dedicated block components (ThinkingBlock, ToolUseBlock, ToolResultBlock) (TASK_2025_009)
- Signal migration for ChatStateService (pre-existing)
- Signal migration for WebviewNavigationService (pre-existing)
- SessionManagerComponent decomposition (TASK_2025_011 alternative)
- SessionProxy service creation (TASK_2025_011)
- FileSuggestionsDropdownComponent integration (already integrated)
- Status calculation method consolidation (no duplication found)

---

## Dependencies

### Internal Libraries

- `@ptah-extension/shared` - Message types, payload interfaces
- `@ptah-extension/vscode-core` - DI tokens, EventBus
- `@ptah-extension/claude-domain` - Orchestration services
- `@ptah-extension/workspace-intelligence` - Context services
- `@ptah-extension/core` - Frontend services
- `@ptah-extension/shared-ui` - Shared utilities

### External Dependencies

- `@angular/core` (^20.1.2) - DestroyRef, inject, signals
- `rxjs` (^7.8.1) - takeUntilDestroyed operator
- `tsyringe` (^4.10.0) - Dependency injection
- `vscode` (^1.96.0) - Uri objects (main app only)

---

## Risks & Mitigations

### Risk 1: Context Bridge Complexity

**Impact**: Medium
**Probability**: Low
**Mitigation**: Clear separation of concerns, thorough testing, documentation

### Risk 2: Breaking Changes in EventBus Messages

**Impact**: High
**Probability**: Low
**Mitigation**: Update MessagePayloadMap types, run full type checks

### Risk 3: Performance Degradation

**Impact**: Medium
**Probability**: Low
**Mitigation**: Profile critical paths, optimize if needed

---

## Verification Plan

### Unit Testing

- ContextMessageBridgeService unit tests (mock EventBus, contextOrchestration)
- formatDuration() utility unit tests (edge cases: 0ms, 59s, 60s, 3600s, 86400s)
- ProviderOrchestrationService.selectModel() unit tests

### Integration Testing

- End-to-end @ mention file selection flow
- REQUEST_INITIAL_DATA → INITIAL_DATA round trip
- Model selection → MODEL_CHANGED event
- Analytics data fetch → UI update

### Manual Testing

- Reload webview multiple times → state restored correctly
- Select files with @ mentions → files added to context
- Change model in provider dropdown → model changes
- View analytics page → real data displayed

---

## Success Metrics

- ✅ All 11 sub-tasks completed
- ✅ Zero type errors: `nx run-many --target=typecheck`
- ✅ Zero lint errors: `nx run-many --target=lint`
- ✅ All builds pass: `nx run-many --target=build`
- ✅ All feature acceptance criteria met
- ✅ Zero VS Code imports in claude-domain
- ✅ ContextMessageBridge registered and functional
- ✅ @ mention file selection works end-to-end
- ✅ Analytics displays real data (not hardcoded)
