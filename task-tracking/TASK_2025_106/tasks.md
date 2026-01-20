# Development Tasks - TASK_2025_106

**Total Tasks**: 18 | **Batches**: 6 | **Status**: 0/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- [DI Pattern]: Verified from StreamTransformer.ts:158 - @injectable() with @inject() decorators
- [Token Pattern]: Verified from tokens.ts - string tokens in SDK_TOKENS object
- [Registration Pattern]: Verified from register.ts - Lifecycle.Singleton registration
- [Export Pattern]: Verified from helpers/index.ts - named exports with types

### Risks Identified

| Risk                                                                     | Severity | Mitigation                                         |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------------- |
| Public API behavior must remain identical                                | MEDIUM   | Add verification step after Batch 5 with manual QA |
| HistoryEventFactory plan inconsistency (says no DI, but shows injection) | LOW      | Make it injectable for consistency - Task 1.3      |

### Edge Cases to Handle

- [ ] Missing session directory -> Return empty events (handled in JsonlReaderService)
- [ ] Malformed JSONL lines -> Skip, don't throw (handled in JsonlReaderService)
- [ ] Warmup agents -> Filter out (handled in AgentCorrelationService)
- [ ] Missing timestamps -> Default to Date.now() (handled in AgentCorrelationService)
- [ ] Tool results without matching tool_use -> Skip gracefully (handled in SessionReplayService)

---

## Batch 1: Foundation (Types & Event Factory)

**Status**: IN PROGRESS
**Commit Message**: `refactor(vscode): extract history types and event factory from session-history-reader`
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create history types module

- **Status**: IN PROGRESS
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts
- **Action**: CREATE
- **Description**: Extract all interface definitions from session-history-reader.service.ts (lines 52-113) to a dedicated types file
- **Verification**: TypeScript compilation passes, no import errors

**Implementation Details**:

- Extract: JsonlMessageLine, SessionHistoryMessage, ContentBlock, AgentSessionData, ToolResultData
- Add new interfaces: AgentDataMapEntry, TaskToolUse (from inline usage in current file)
- Import ClaudeApiUsage from './usage-extraction.utils'
- Import JSONLMessage from '@ptah-extension/shared'

**Pattern Reference**: libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts

---

### Task 1.2: Create history event factory

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\history-event-factory.ts
- **Action**: CREATE
- **Description**: Extract all create\* methods (lines 1107-1258) and utility methods (generateId, extractTextContent) to an injectable factory service
- **Verification**: All event creation methods produce correct FlatStreamEventUnion types

**Implementation Details**:

- Use @injectable() decorator (no dependencies needed, but injectable for consistency)
- Methods: createMessageStart, createTextDelta, createThinkingDelta, createToolStart, createAgentStart, createToolResult, createMessageComplete
- Utility methods: generateId(), extractTextContent()
- Import event types from '@ptah-extension/shared'

**Pattern Reference**: libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158

---

### Task 1.3: Create history barrel export

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\index.ts
- **Action**: CREATE
- **Description**: Create barrel export file for history module
- **Verification**: All types and factory are exportable

**Implementation Details**:

- Export all types from './history.types'
- Export HistoryEventFactory from './history-event-factory'
- Follow pattern from helpers/index.ts

---

### Task 1.4: Add DI token for HistoryEventFactory

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts
- **Action**: MODIFY
- **Description**: Add SDK_HISTORY_EVENT_FACTORY token
- **Verification**: Token is exported and usable

**Implementation Details**:

- Add: SDK_HISTORY_EVENT_FACTORY: 'SdkHistoryEventFactory'
- Add comment: // History reader child services (TASK_2025_106)

---

**Batch 1 Verification**:

- [ ] All files exist at specified paths
- [ ] TypeScript compilation passes: `npx nx build agent-sdk`
- [ ] No import errors in new files

---

## Batch 2: JSONL Reader Service

**Status**: PENDING
**Commit Message**: `refactor(vscode): extract jsonl reader service from session-history-reader`
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete

### Task 2.1: Create JSONL reader service

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts
- **Action**: CREATE
- **Description**: Extract JSONL file I/O operations (lines 374-513) to dedicated service
- **Verification**: Service can read real session files correctly

**Implementation Details**:

- Use @injectable() decorator
- Inject Logger via @inject(TOKENS.LOGGER)
- Methods: findSessionsDirectory(), readJsonlMessages(), loadAgentSessions(), convertToSessionHistoryMessage()
- Import types from './history.types'
- Import fs, path, os for file operations
- Handle stream cleanup properly (reader.close(), stream.destroy())

**Pattern Reference**: libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158-164

**Validation Notes**:

- Must handle missing directories gracefully (return null)
- Must skip malformed JSONL lines (try/catch, continue)
- Must properly close file streams in finally block

---

### Task 2.2: Add DI token for JsonlReaderService

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts
- **Action**: MODIFY
- **Description**: Add SDK_JSONL_READER token
- **Verification**: Token is exported

**Implementation Details**:

- Add: SDK_JSONL_READER: 'SdkJsonlReader'

---

### Task 2.3: Update history barrel export

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\index.ts
- **Action**: MODIFY
- **Description**: Export JsonlReaderService
- **Verification**: Service is exportable from history module

---

**Batch 2 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build agent-sdk`
- [ ] JsonlReaderService can be instantiated

---

## Batch 3: Agent Correlation Service

**Status**: PENDING
**Commit Message**: `refactor(vscode): extract agent correlation service from session-history-reader`
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete

### Task 3.1: Create agent correlation service

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\agent-correlation.service.ts
- **Action**: CREATE
- **Description**: Extract correlation logic (lines 916-1101) to dedicated service
- **Verification**: Correlation window matches original (-1s to +60s)

**Implementation Details**:

- Use @injectable() decorator
- Inject Logger via @inject(TOKENS.LOGGER)
- Methods: buildAgentDataMap(), extractTaskToolUses(), correlateAgentsToTasks(), extractAllToolResults()
- Import types from './history.types'
- Import isTaskToolInput from '@ptah-extension/shared'

**Pattern Reference**: libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158-164

**Validation Notes**:

- Warmup agent filtering: Check first message content === 'warmup' (case insensitive)
- Correlation window: agent.timestamp - task.timestamp >= -1000 && < 60000
- Must handle missing timestamps (default to Date.now())

---

### Task 3.2: Add DI token for AgentCorrelationService

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts
- **Action**: MODIFY
- **Description**: Add SDK_AGENT_CORRELATION token
- **Verification**: Token is exported

**Implementation Details**:

- Add: SDK_AGENT_CORRELATION: 'SdkAgentCorrelation'

---

### Task 3.3: Update history barrel export

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\index.ts
- **Action**: MODIFY
- **Description**: Export AgentCorrelationService
- **Verification**: Service is exportable from history module

---

**Batch 3 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build agent-sdk`
- [ ] AgentCorrelationService can be instantiated

---

## Batch 4: Session Replay Service

**Status**: PENDING
**Commit Message**: `refactor(vscode): extract session replay service from session-history-reader`
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batches 1, 3 complete

### Task 4.1: Create session replay service

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.ts
- **Action**: CREATE
- **Description**: Extract replay logic (lines 522-910) to dedicated service
- **Verification**: Event ordering preserved with micro-offsets

**Implementation Details**:

- Use @injectable() decorator
- Inject: Logger, AgentCorrelationService, HistoryEventFactory
- Methods: replayToStreamEvents(), processAgentMessages()
- Import types from './history.types'
- Import FlatStreamEventUnion, MessageStartEvent, etc. from '@ptah-extension/shared'

**Pattern Reference**: libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:108-126

**Validation Notes**:

- Must preserve event ordering with micro-offsets (0.001ms per event)
- Must handle nested Task tool spawning (agent within agent)
- Must link tool_result to tool_use via toolCallId
- CRITICAL: Include parentToolUseId in agent message IDs to prevent collision (TASK_2025_096 fix)

---

### Task 4.2: Add DI token for SessionReplayService

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts
- **Action**: MODIFY
- **Description**: Add SDK_SESSION_REPLAY token
- **Verification**: Token is exported

**Implementation Details**:

- Add: SDK_SESSION_REPLAY: 'SdkSessionReplay'

---

### Task 4.3: Update history barrel export

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\index.ts
- **Action**: MODIFY
- **Description**: Export SessionReplayService
- **Verification**: Service is exportable from history module

---

**Batch 4 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build agent-sdk`
- [ ] SessionReplayService can be instantiated with dependencies

---

## Batch 5: Refactor Main Service (Facade)

**Status**: PENDING
**Commit Message**: `refactor(vscode): convert session-history-reader to facade pattern with child services`
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batches 1-4 complete

### Task 5.1: Register all history services in DI

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts
- **Action**: MODIFY
- **Description**: Register HistoryEventFactory, JsonlReaderService, AgentCorrelationService, SessionReplayService
- **Verification**: All services resolve correctly from container

**Implementation Details**:

- Add imports for all 4 services from '../helpers/history'
- Register each with Lifecycle.Singleton
- Add comment section: // History reader child services (TASK_2025_106)
- Registration order: EventFactory, JsonlReader, AgentCorrelation, SessionReplay

**Pattern Reference**: Lines 70-82 of current register.ts

---

### Task 5.2: Refactor SessionHistoryReaderService to facade

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts
- **Action**: REWRITE
- **Description**: Convert to facade pattern, inject child services, delegate operations
- **Verification**: Public API unchanged, behavior identical

**Implementation Details**:

- Keep @injectable() decorator
- Inject: Logger, JsonlReaderService, SessionReplayService, HistoryEventFactory
- Remove all extracted methods (private methods that are now in child services)
- Keep: readSessionHistory(), readHistoryAsMessages(), aggregateUsageStats()
- Public method bodies delegate to child services
- Keep usage stats aggregation logic (simple, uses existing utils)
- Final file should be ~200 lines (down from 1,278)

**CRITICAL**: Public method signatures MUST NOT change:

- readSessionHistory(sessionId: string, workspacePath: string): Promise<{events, stats}>
- readHistoryAsMessages(sessionId: string, workspacePath: string): Promise<{id, role, content, timestamp}[]>

---

### Task 5.3: Update helpers barrel export

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts
- **Action**: MODIFY
- **Description**: Export history module
- **Verification**: History services accessible from helpers module

**Implementation Details**:

- Add: export \* from './history'
- Place at end of file after existing exports

---

**Batch 5 Verification**:

- [ ] Build passes: `npx nx build agent-sdk`
- [ ] Public API signatures unchanged
- [ ] Manual QA: Load a session in VS Code extension and verify events display correctly
- [ ] No regressions in session loading behavior

---

## Batch 6: Final Integration & Documentation

**Status**: PENDING
**Commit Message**: `docs(vscode): update agent-sdk documentation for history service refactoring`
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 5 complete

### Task 6.1: Update agent-sdk CLAUDE.md

- **Status**: PENDING
- **File**: D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md
- **Action**: MODIFY
- **Description**: Add documentation for new history services architecture
- **Verification**: Documentation reflects actual file structure

**Implementation Details**:

- Add new section under "Helper Services" for history services
- Document: HistoryEventFactory, JsonlReaderService, AgentCorrelationService, SessionReplayService
- Update file paths reference section
- Note the facade pattern in SessionHistoryReaderService

---

### Task 6.2: Run full verification suite

- **Status**: PENDING
- **File**: N/A (verification task)
- **Action**: VERIFY
- **Description**: Run build, lint, and typecheck for agent-sdk
- **Verification**: All quality gates pass

**Implementation Details**:

- Run: `npx nx build agent-sdk`
- Run: `npx nx lint agent-sdk`
- Run: `npx nx run agent-sdk:typecheck`
- Manual test: Open extension, load session, verify events display

---

**Batch 6 Verification**:

- [ ] Build passes: `npx nx build agent-sdk`
- [ ] Lint passes: `npx nx lint agent-sdk`
- [ ] Typecheck passes: `npx nx run agent-sdk:typecheck`
- [ ] Documentation updated
- [ ] Manual QA completed

---

## Files Summary

### CREATE (6 files)

- `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/index.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/agent-correlation.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts`

### MODIFY (4 files)

- `libs/backend/agent-sdk/src/lib/di/tokens.ts` - Add 4 tokens
- `libs/backend/agent-sdk/src/lib/di/register.ts` - Register 4 services
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` - Export history module
- `libs/backend/agent-sdk/CLAUDE.md` - Update documentation

### REWRITE (1 file)

- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` - Facade pattern (~1,278 -> ~200 lines)
