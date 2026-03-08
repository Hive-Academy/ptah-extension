# Implementation Plan - TASK_2025_106

## Session History Reader Service Refactoring

**Objective**: Refactor `session-history-reader.service.ts` (1,278 lines) by extracting responsibilities into focused child services while **maintaining the existing public API**.

---

## Codebase Investigation Summary

### Libraries Discovered

- **agent-sdk** (`libs/backend/agent-sdk`)
  - Purpose: Official Claude Agent SDK integration
  - Documentation: `libs/backend/agent-sdk/CLAUDE.md`
  - Key pattern: Injectable services with `@injectable()` decorator
  - DI: `tsyringe` with string tokens in `SDK_TOKENS`

### Patterns Identified

**1. Injectable Service Pattern** (verified from 22 files):

```typescript
// Source: libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158
@injectable()
export class StreamTransformer {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer
  ) {}
}
```

**2. DI Token Registration** (verified from `di/tokens.ts`):

```typescript
// Source: libs/backend/agent-sdk/src/lib/di/tokens.ts:10-39
export const SDK_TOKENS = {
  SDK_AGENT_ADAPTER: 'SdkAgentAdapter',
  // ... string tokens for all services
} as const;
```

**3. Service Registration Pattern** (verified from `di/register.ts`):

```typescript
// Source: libs/backend/agent-sdk/src/lib/di/register.ts:71-82
container.register(SDK_TOKENS.SDK_SESSION_HISTORY_READER, { useClass: SessionHistoryReaderService }, { lifecycle: Lifecycle.Singleton });
```

**4. Helper Index Export Pattern** (verified from `helpers/index.ts`):

```typescript
// Source: libs/backend/agent-sdk/src/lib/helpers/index.ts:13-14
export { AuthManager, type AuthResult, type AuthConfig } from './auth-manager';
export { SessionLifecycleManager, ... } from './session-lifecycle-manager';
```

### Integration Points

- **Logger**: Injected via `@inject(TOKENS.LOGGER)` from `@ptah-extension/vscode-core`
- **Shared types**: `FlatStreamEventUnion`, `JSONLMessage`, `isTaskToolInput` from `@ptah-extension/shared`
- **Usage utils**: `extractTokenUsage`, `estimateCostFromTokens` from `./helpers/usage-extraction.utils`

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Child Services with Facade Pattern
**Rationale**:

- Maintains public API (`readSessionHistory()`, `readHistoryAsMessages()`)
- Each child service has single responsibility
- Follows existing `helpers/` pattern in agent-sdk
- Injectable services enable testing and composition

**Evidence**:

- Pattern matches `StreamTransformer`, `SessionLifecycleManager` (verified at `helpers/`)
- DI registration matches existing SDK services (verified at `di/register.ts:70-82`)

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  SessionHistoryReaderService (Facade)                    │
│                                                                          │
│  Public API (UNCHANGED):                                                 │
│  - readSessionHistory(sessionId, workspacePath)                          │
│  - readHistoryAsMessages(sessionId, workspacePath)                       │
│                                                                          │
│  Internal Orchestration:                                                 │
│  - Stats aggregation (kept in facade - uses existing utils)              │
├─────────────────────────────────────────────────────────────────────────┤
│                         Child Services                                   │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │  JsonlReader    │  │ AgentCorrelation│  │HistoryEventFact │          │
│  │    Service      │  │    Service      │  │      ory        │          │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤          │
│  │findSessionsDir  │  │buildAgentDataMap│  │createMsgStart   │          │
│  │readJsonlMessages│  │extractTaskTools │  │createTextDelta  │          │
│  │loadAgentSessions│  │correlateAgents  │  │createToolStart  │          │
│  │convertToHistory │  │extractToolResult│  │createAgentStart │          │
│  │ Message         │  │                 │  │createToolResult │          │
│  └────────┬────────┘  └────────┬────────┘  │createMsgComplete│          │
│           │                    │           │extractTextContent│          │
│           │                    │           │generateId        │          │
│           │                    │           └────────┬─────────┘          │
│           └──────────┬─────────┴────────────────────┘                    │
│                      │                                                   │
│           ┌──────────▼──────────┐                                        │
│           │  SessionReplay      │                                        │
│           │     Service         │                                        │
│           ├─────────────────────┤                                        │
│           │replayToStreamEvents │                                        │
│           │processAgentMessages │                                        │
│           └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Dependency Flow

```
SessionHistoryReaderService (Facade)
├── JsonlReaderService (injected)
│   └── Logger (from TOKENS.LOGGER)
├── SessionReplayService (injected)
│   ├── Logger (from TOKENS.LOGGER)
│   ├── AgentCorrelationService (injected)
│   │   └── Logger (from TOKENS.LOGGER)
│   └── HistoryEventFactory (injected)
│       └── (no dependencies - pure factory)
└── usage-extraction.utils (import - not DI)
```

---

## Component Specifications

### Component 1: HistoryEventFactory

**Purpose**: Create FlatStreamEventUnion events for session history replay. Pure factory with no dependencies.

**Pattern**: Factory class (no DI needed - pure functions)
**Evidence**: Event creation methods in current file (lines 1107-1257)

**Responsibilities**:

- Create all event types (message_start, text_delta, thinking_delta, tool_start, agent_start, tool_result, message_complete)
- Generate unique event/message IDs
- Extract text content from content blocks

**Implementation Pattern**:

```typescript
// Pattern source: session-history-reader.service.ts:1107-1257
export class HistoryEventFactory {
  createMessageStart(sessionId: string, messageId: string, role: 'user' | 'assistant', index: number, timestamp: number): MessageStartEvent {
    return {
      eventType: 'message_start',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      role,
      timestamp,
      source: 'history',
    };
  }

  // ... other create methods

  generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return (content as ContentBlock[])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');
    }
    return '';
  }
}
```

**Quality Requirements**:

- All methods must return proper FlatStreamEventUnion types
- generateId() must produce unique IDs
- extractTextContent() must handle all content formats

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts` (CREATE)

---

### Component 2: JsonlReaderService

**Purpose**: Handle all JSONL file I/O operations including finding session directories and reading messages.

**Pattern**: Injectable service with Logger
**Evidence**: File I/O methods in current file (lines 371-513)

**Responsibilities**:

- Find sessions directory for a workspace path
- Read JSONL messages from session files
- Load linked agent session files
- Convert raw JSONL lines to SessionHistoryMessage format

**Implementation Pattern**:

```typescript
// Pattern source: helpers/stream-transformer.ts:158-164
@injectable()
export class JsonlReaderService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  // Pattern source: session-history-reader.service.ts:374-412
  async findSessionsDirectory(workspacePath: string): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');
    // ... directory lookup logic
  }

  // Pattern source: session-history-reader.service.ts:417-442
  async readJsonlMessages(filePath: string): Promise<SessionHistoryMessage[]> {
    const messages: SessionHistoryMessage[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    // ... streaming read logic
  }

  // Pattern source: session-history-reader.service.ts:467-513
  async loadAgentSessions(sessionsDir: string, parentSessionId: string): Promise<AgentSessionData[]> {
    // ... agent file loading logic
  }
}
```

**Quality Requirements**:

- Must handle missing directories gracefully
- Must handle malformed JSONL lines (skip, don't throw)
- Must properly close file streams

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts` (CREATE)

---

### Component 3: AgentCorrelationService

**Purpose**: Correlate agent sessions to Task tool_uses using timestamp-based matching and extract tool results.

**Pattern**: Injectable service with Logger
**Evidence**: Correlation methods in current file (lines 916-1101)

**Responsibilities**:

- Build agent data map (filter warmup agents, extract timestamps)
- Extract Task tool_use blocks from messages
- Correlate agents to tasks by timestamp proximity
- Extract tool_result blocks from user messages

**Implementation Pattern**:

```typescript
// Pattern source: helpers/stream-transformer.ts:158-164
@injectable()
export class AgentCorrelationService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  // Pattern source: session-history-reader.service.ts:916-980
  buildAgentDataMap(agentSessions: AgentSessionData[]): Map<string, AgentDataMapEntry> {
    const map = new Map<string, AgentDataMapEntry>();
    for (const agent of agentSessions) {
      // ... warmup filtering, timestamp extraction
    }
    return map;
  }

  // Pattern source: session-history-reader.service.ts:982-1017
  extractTaskToolUses(messages: SessionHistoryMessage[]): TaskToolUse[] {
    // ... extract Task tool_use blocks
  }

  // Pattern source: session-history-reader.service.ts:1019-1065
  correlateAgentsToTasks(taskToolUses: TaskToolUse[], agentDataMap: Map<string, AgentDataMapEntry>): Map<string, string> {
    // ... timestamp-based correlation
  }

  // Pattern source: session-history-reader.service.ts:1067-1101
  extractAllToolResults(messages: SessionHistoryMessage[]): Map<string, ToolResultData> {
    // ... extract tool_result blocks
  }
}
```

**Quality Requirements**:

- Must filter warmup agents correctly
- Must handle missing timestamps gracefully
- Correlation window: -1s to +60s (verified from line 1048)

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/history/agent-correlation.service.ts` (CREATE)

---

### Component 4: SessionReplayService

**Purpose**: Orchestrate the conversion of JSONL messages to FlatStreamEventUnion events, handling message sequencing and nested agent events.

**Pattern**: Injectable service with multiple child service dependencies
**Evidence**: Replay methods in current file (lines 522-910)

**Responsibilities**:

- Replay main session messages to stream events
- Process nested agent messages
- Handle event sequencing with micro-offsets for ordering
- Coordinate correlation and event factory services

**Implementation Pattern**:

```typescript
// Pattern source: helpers/session-lifecycle-manager.ts:108-126
@injectable()
export class SessionReplayService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_AGENT_CORRELATION)
    private readonly correlationService: AgentCorrelationService,
    @inject(SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY)
    private readonly eventFactory: HistoryEventFactory
  ) {}

  // Pattern source: session-history-reader.service.ts:522-784
  replayToStreamEvents(sessionId: string, mainMessages: SessionHistoryMessage[], agentSessions: AgentSessionData[]): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];

    // Build correlation maps
    const agentDataMap = this.correlationService.buildAgentDataMap(agentSessions);
    const taskToolUses = this.correlationService.extractTaskToolUses(mainMessages);
    const taskToAgentMap = this.correlationService.correlateAgentsToTasks(taskToolUses, agentDataMap);
    const allToolResults = this.correlationService.extractAllToolResults(mainMessages);

    // Process messages with proper sequencing
    // ... main replay logic using eventFactory

    return events;
  }

  // Pattern source: session-history-reader.service.ts:792-910
  private processAgentMessages(sessionId: string, parentToolUseId: string, messages: SessionHistoryMessage[], parentTimestamp: number): FlatStreamEventUnion[] {
    // ... nested agent event processing
  }
}
```

**Quality Requirements**:

- Must preserve event ordering with micro-offset timestamps
- Must handle nested Task tool spawning (agent within agent)
- Must link tool_result to tool_use correctly

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` (CREATE)

---

### Component 5: History Types Module

**Purpose**: Centralize all type definitions used by history services.

**Pattern**: Pure type exports (no runtime code)
**Evidence**: Interface definitions in current file (lines 44-113)

**Type Definitions**:

```typescript
// Move from session-history-reader.service.ts:52-113

export interface JsonlMessageLine {
  uuid: string;
  sessionId: string;
  timestamp: string;
  cwd?: string;
  type?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    usage?: ClaudeApiUsage;
  };
  isMeta?: boolean;
  slug?: string;
}

export interface SessionHistoryMessage extends JSONLMessage {
  readonly uuid?: string;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly isMeta?: boolean;
  readonly slug?: string;
  readonly usage?: ClaudeApiUsage;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | unknown[];
  is_error?: boolean;
}

export interface AgentSessionData {
  agentId: string;
  filePath: string;
  messages: SessionHistoryMessage[];
}

export interface ToolResultData {
  content: string;
  isError: boolean;
}

export interface AgentDataMapEntry {
  agentId: string;
  timestamp: number;
  executionMessages: SessionHistoryMessage[];
}

export interface TaskToolUse {
  toolUseId: string;
  timestamp: number;
  subagentType: string;
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts` (CREATE)

---

### Component 6: Refactored SessionHistoryReaderService (Facade)

**Purpose**: Maintain public API while delegating to child services. Keep stats aggregation logic.

**Pattern**: Facade with injected child services
**Evidence**: Current public methods (lines 132-202, 294-365)

**Responsibilities**:

- Public API: `readSessionHistory()`, `readHistoryAsMessages()`
- Stats aggregation (uses existing `usage-extraction.utils`)
- Orchestration of child services

**Implementation Pattern**:

```typescript
// Pattern source: Current file with child service injection
@injectable()
export class SessionHistoryReaderService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonlReader: JsonlReaderService,
    @inject(SDK_TOKENS.SDK_SESSION_REPLAY)
    private readonly replayService: SessionReplayService,
    @inject(SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY)
    private readonly eventFactory: HistoryEventFactory
  ) {}

  // PUBLIC API - UNCHANGED SIGNATURES
  async readSessionHistory(sessionId: string, workspacePath: string): Promise<{...}> {
    // 1. Find sessions directory (delegate to jsonlReader)
    // 2. Read main session messages (delegate to jsonlReader)
    // 3. Load agent sessions (delegate to jsonlReader)
    // 4. Replay to stream events (delegate to replayService)
    // 5. Aggregate stats (kept here - uses existing utils)
  }

  async readHistoryAsMessages(sessionId: string, workspacePath: string): Promise<{...}[]> {
    // Uses jsonlReader and eventFactory
  }

  // Stats aggregation stays here (simple, uses existing utils)
  private aggregateUsageStats(...): {...} | null {
    // Uses extractTokenUsage, estimateCostFromTokens from usage-extraction.utils
  }
}
```

**Quality Requirements**:

- Public method signatures must NOT change
- Return types must NOT change
- Behavior must be identical to current implementation

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` (REWRITE)

---

## File Structure

```
libs/backend/agent-sdk/src/lib/
├── helpers/
│   ├── history/                              (CREATE directory)
│   │   ├── index.ts                          (CREATE - ~30 lines)
│   │   ├── history.types.ts                  (CREATE - ~70 lines)
│   │   ├── history-event-factory.ts          (CREATE - ~170 lines)
│   │   ├── jsonl-reader.service.ts           (CREATE - ~150 lines)
│   │   ├── agent-correlation.service.ts      (CREATE - ~180 lines)
│   │   └── session-replay.service.ts         (CREATE - ~280 lines)
│   └── index.ts                              (MODIFY - add history exports)
├── di/
│   ├── tokens.ts                             (MODIFY - add 4 new tokens)
│   └── register.ts                           (MODIFY - register 4 services)
└── session-history-reader.service.ts         (REWRITE - ~200 lines facade)
```

**Line Count Summary**:

- New child services: ~880 lines total
- Refactored facade: ~200 lines
- Total after refactoring: ~1,080 lines (vs 1,278 before)
- Net reduction: ~200 lines (better separation, less duplication)

---

## DI Token Additions

```typescript
// Add to libs/backend/agent-sdk/src/lib/di/tokens.ts

export const SDK_TOKENS = {
  // ... existing tokens

  // History reader child services (TASK_2025_106)
  SDK_JSONL_READER: 'SdkJsonlReader',
  SDK_AGENT_CORRELATION: 'SdkAgentCorrelation',
  SDK_HISTORY_EVENT_FACTORY: 'SdkHistoryEventFactory',
  SDK_SESSION_REPLAY: 'SdkSessionReplay',
} as const;
```

---

## Implementation Batches

### Batch 1: Foundation (Types & Event Factory)

**Tasks**:

1. Create `helpers/history/` directory
2. Create `history.types.ts` with all interface definitions
3. Create `history-event-factory.ts` (pure factory, no DI)
4. Create `helpers/history/index.ts` with exports

**Risk**: Low (no behavior change, pure extractions)
**Verification**: TypeScript compilation

---

### Batch 2: JSONL Reader Service

**Tasks**:

1. Create `jsonl-reader.service.ts`
2. Add `SDK_JSONL_READER` token to `di/tokens.ts`
3. Register service in `di/register.ts`
4. Export from `helpers/history/index.ts`

**Risk**: Medium (file I/O operations)
**Verification**: Manual test reading existing session files

---

### Batch 3: Agent Correlation Service

**Tasks**:

1. Create `agent-correlation.service.ts`
2. Add `SDK_AGENT_CORRELATION` token to `di/tokens.ts`
3. Register service in `di/register.ts`
4. Export from `helpers/history/index.ts`

**Risk**: Low (pure algorithms, well-tested patterns)
**Verification**: Unit tests for correlation logic

---

### Batch 4: Session Replay Service

**Tasks**:

1. Create `session-replay.service.ts`
2. Add `SDK_SESSION_REPLAY` token to `di/tokens.ts`
3. Register service in `di/register.ts`
4. Export from `helpers/history/index.ts`

**Risk**: Medium (complex orchestration)
**Verification**: Integration test with real session data

---

### Batch 5: Refactor Main Service

**Tasks**:

1. Update `session-history-reader.service.ts` to use child services
2. Inject child services via constructor
3. Verify public API unchanged
4. Update `helpers/index.ts` to include history exports

**Risk**: Medium (critical path, public API)
**Verification**: End-to-end test of session loading

---

### Batch 6: Final Integration & Documentation

**Tasks**:

1. Update `CLAUDE.md` with new file structure
2. Verify all exports in `src/index.ts`
3. Run full test suite
4. Manual QA test in VS Code extension

**Risk**: Low (documentation and verification)
**Verification**: Full extension test

---

## Risk Assessment

### Low Risk

- **Type extraction** - Moving interfaces to separate file
- **Event factory extraction** - Pure functions, no side effects
- **DI token additions** - Additive change

### Medium Risk

- **JSONL reader extraction** - File I/O needs careful stream handling
- **Correlation service extraction** - Algorithm correctness critical
- **Session replay extraction** - Complex state management
- **Facade refactoring** - Must preserve exact behavior

### Mitigations

1. **Incremental batches** - Each batch independently verifiable
2. **Type safety** - TypeScript ensures interface compatibility
3. **Existing tests** - Run after each batch
4. **Manual QA** - Test with real session data between batches

---

## Quality Requirements

### Functional Requirements

- `readSessionHistory()` returns identical events to current implementation
- `readHistoryAsMessages()` returns identical messages to current implementation
- Stats aggregation produces identical results
- Agent correlation matches agents correctly

### Non-Functional Requirements

- **Performance**: No degradation in session load time
- **Memory**: No increase in memory usage
- **Maintainability**: Each service <300 lines
- **Testability**: Each service independently testable

### Pattern Compliance

- All services use `@injectable()` decorator (verified pattern)
- All services registered with string tokens (verified pattern)
- All services use `Lifecycle.Singleton` (verified pattern)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Pure TypeScript/Node.js refactoring
- DI container configuration (tsyringe)
- File I/O operations
- No frontend/Angular involvement

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Batch 1 (Foundation): 30-45 min
- Batch 2 (JSONL Reader): 45-60 min
- Batch 3 (Correlation): 45-60 min
- Batch 4 (Replay): 60-90 min
- Batch 5 (Facade): 45-60 min
- Batch 6 (Integration): 30-45 min

### Files Affected Summary

**CREATE** (6 files):

- `libs/backend/agent-sdk/src/lib/helpers/history/index.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/agent-correlation.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts`

**MODIFY** (3 files):

- `libs/backend/agent-sdk/src/lib/di/tokens.ts` - Add 4 tokens
- `libs/backend/agent-sdk/src/lib/di/register.ts` - Register 4 services
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` - Export history module

**REWRITE** (1 file):

- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` - Facade pattern

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `@injectable()` from `tsyringe` (verified at multiple files)
   - `@inject(TOKENS.LOGGER)` from `@ptah-extension/vscode-core`
   - `SDK_TOKENS` from `./di/tokens`
   - `FlatStreamEventUnion` from `@ptah-extension/shared`

2. **All patterns verified from examples**:

   - Service pattern: `helpers/stream-transformer.ts:158-164`
   - Token pattern: `di/tokens.ts:10-39`
   - Registration pattern: `di/register.ts:71-82`

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`

4. **No hallucinated APIs**:
   - All decorators verified: `@injectable()`, `@inject()`
   - All DI patterns verified from existing services
   - All event types verified from `@ptah-extension/shared`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (team-leader's job)
