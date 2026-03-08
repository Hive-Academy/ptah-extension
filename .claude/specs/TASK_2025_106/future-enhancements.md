# Future Enhancements - TASK_2025_106

## Summary

**Completed Work**: Refactored `session-history-reader.service.ts` from a 1,278-line monolithic service into 6 focused child services using the Facade pattern while maintaining the existing public API.

**Services Created**:
| Service | Lines | Responsibility |
|---------|-------|----------------|
| `HistoryEventFactory` | ~495 | Event creation for all FlatStreamEventUnion types |
| `JsonlReaderService` | ~240 | JSONL file I/O operations |
| `AgentCorrelationService` | ~268 | Agent-to-task timestamp correlation |
| `SessionReplayService` | ~457 | Event replay orchestration |
| `SessionHistoryReaderService` | ~327 | Facade (public API) |

**Security Fixes Applied**:

- Path traversal validation (SESSION_ID_PATTERN regex)
- File size limit (50MB max) to prevent memory exhaustion

---

## 1. Immediate Enhancements

### 1.1 Parallel Agent File Loading

**Priority**: HIGH
**Effort**: 1-2 hours
**Business Value**: Performance improvement for sessions with multiple agents

**Current Pattern**:

```typescript
// JsonlReaderService.loadAgentSessions() - Sequential loading
for (const file of agentFiles) {
  const messages = await this.readJsonlMessages(filePath);
  // ... process
}
```

**Modern Pattern**:

```typescript
// Parallel loading with Promise.all()
const agentPromises = agentFiles.map(async (file) => {
  const messages = await this.readJsonlMessages(filePath);
  // ... return agent data
});
const results = await Promise.all(agentPromises);
return results.filter(Boolean);
```

**Affected Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts`

**Implementation Notes**:

- Add error handling per-file so one failing agent doesn't break entire load
- Consider concurrency limit (e.g., 5 parallel reads) for very large agent counts
- Benchmark with real sessions to measure improvement

---

### 1.2 Unit Tests for Child Services

**Priority**: HIGH
**Effort**: 4-6 hours
**Business Value**: Regression prevention, confidence in refactoring

**Test Coverage Targets**:

| Service                   | Test Focus                                              | Priority |
| ------------------------- | ------------------------------------------------------- | -------- |
| `HistoryEventFactory`     | Event creation, ID generation, text extraction          | HIGH     |
| `JsonlReaderService`      | File reading, malformed line handling, directory lookup | HIGH     |
| `AgentCorrelationService` | Warmup filtering, timestamp correlation, edge cases     | HIGH     |
| `SessionReplayService`    | Event ordering, micro-offsets, nested agents            | MEDIUM   |

**Test Fixtures Needed**:

- `test-session.jsonl` - Sample main session file
- `test-agent.jsonl` - Sample agent session file
- `test-malformed.jsonl` - File with bad JSON lines
- `test-warmup-agent.jsonl` - Warmup agent to verify filtering

**Pattern Reference**:

```typescript
// Test pattern from libs/backend/agent-sdk/src/lib/helpers/
import { container } from 'tsyringe';
import { HistoryEventFactory } from './history-event-factory';

describe('HistoryEventFactory', () => {
  let factory: HistoryEventFactory;

  beforeEach(() => {
    factory = container.resolve(HistoryEventFactory);
  });

  it('should create message_start event with correct structure', () => {
    const event = factory.createMessageStart('session-1', 'msg-1', 'user', 0, Date.now());
    expect(event.eventType).toBe('message_start');
    expect(event.source).toBe('history');
  });
});
```

**Affected Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\history-event-factory.spec.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.spec.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\agent-correlation.service.spec.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.spec.ts`

---

### 1.3 Progress Callbacks for Long Session Loads

**Priority**: MEDIUM
**Effort**: 2-3 hours
**Business Value**: UX improvement - users know loading is progressing

**Current Pattern**:

```typescript
async readSessionHistory(sessionId: string, workspacePath: string): Promise<{...}>
```

**Modern Pattern**:

```typescript
interface SessionLoadProgress {
  phase: 'finding' | 'reading' | 'loading-agents' | 'replaying' | 'complete';
  current?: number;
  total?: number;
}

async readSessionHistory(
  sessionId: string,
  workspacePath: string,
  onProgress?: (progress: SessionLoadProgress) => void
): Promise<{...}>
```

**Affected Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts`

**Implementation Notes**:

- Optional callback maintains backward compatibility
- Frontend can display progress bar or spinner text
- Useful for sessions with 100+ messages

---

## 2. Strategic Enhancements

### 2.1 Session Caching Layer

**Priority**: MEDIUM
**Effort**: 3-4 hours
**Business Value**: Faster navigation between previously viewed sessions

**Implementation**:

```typescript
// Add to SessionHistoryReaderService
import LRUCache from 'lru-cache';

interface CachedSession {
  events: FlatStreamEventUnion[];
  stats: SessionStats | null;
  timestamp: number;
}

private cache = new LRUCache<string, CachedSession>({
  max: 10, // Cache last 10 sessions
  ttl: 5 * 60 * 1000, // 5 minute TTL
});

private getCacheKey(sessionId: string, workspacePath: string): string {
  return `${sessionId}:${workspacePath}`;
}
```

**Cache Invalidation Triggers**:

- Session file modification time changes
- User explicitly refreshes session
- Cache TTL expires

**Affected Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`
- `D:\projects\ptah-extension\package.json` (add lru-cache dependency)

---

### 2.2 Typed Tool Inputs

**Priority**: MEDIUM
**Effort**: 3-4 hours
**Business Value**: Type safety, IDE autocomplete, compile-time error detection

**Current Pattern**:

```typescript
// ContentBlock.input is Record<string, unknown>
interface ContentBlock {
  input?: Record<string, unknown>;
}
```

**Modern Pattern**:

```typescript
// Use discriminated union with existing type guards
import type { ToolInput, TaskToolInput, ReadToolInput, ... } from '@ptah-extension/shared';

interface ContentBlock {
  type: string;
  name?: string;
  input?: ToolInput; // Discriminated union of all tool inputs
}

// In processing code, use type guards
if (block.name === 'Task' && isTaskToolInput(block.input)) {
  // block.input is now TaskToolInput with full type safety
  const agentType = block.input.subagent_type; // typed!
}
```

**Dependencies**:

- Extends existing `isTaskToolInput` pattern from `@ptah-extension/shared`
- Reference: `D:\projects\ptah-extension\libs\shared\src\lib\types\tool-types.ts`

**Affected Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\history-event-factory.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\agent-correlation.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.ts`

---

### 2.3 Branded ID Types

**Priority**: LOW
**Effort**: 2-3 hours
**Business Value**: Compile-time prevention of ID type mixing

**Current Pattern**:

```typescript
// All IDs are plain strings - easy to mix up
createMessageStart(sessionId: string, messageId: string, ...)
createAgentStart(sessionId: string, messageId: string, toolCallId: string, ...)
```

**Modern Pattern**:

```typescript
// Branded types prevent mixing
type EventId = string & { readonly __brand: 'EventId' };
type MessageId = string & { readonly __brand: 'MessageId' };
type ToolCallId = string & { readonly __brand: 'ToolCallId' };
type AgentId = string & { readonly __brand: 'AgentId' };

// Usage
createMessageStart(sessionId: SessionId, messageId: MessageId, ...)

// Compiler error if you pass wrong ID type
createMessageStart(sessionId, toolCallId, ...) // Error!
```

**Reference**: Existing branded types in shared library

- `D:\projects\ptah-extension\libs\shared\src\lib\types\branded.types.ts`

**Affected Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts`
- All services using ID parameters

---

## 3. Advanced Enhancements

### 3.1 Incremental/Paginated Session Loading

**Priority**: LOW
**Effort**: 6-8 hours
**Business Value**: Handle extremely large sessions (1000+ messages) without memory issues

**Concept**:

```typescript
interface PaginatedSessionResult {
  events: FlatStreamEventUnion[];
  hasMore: boolean;
  cursor: string; // Resume point for next page
}

async readSessionHistoryPaginated(
  sessionId: string,
  workspacePath: string,
  options: { limit: number; cursor?: string }
): Promise<PaginatedSessionResult>
```

**Implementation Considerations**:

- Cursor could be line number in JSONL file
- Need to track message boundaries (can't split mid-message)
- Frontend would request more events on scroll

---

### 3.2 Event Filtering During Replay

**Priority**: LOW
**Effort**: 3-4 hours
**Business Value**: Search/filter capabilities in session history

**Concept**:

```typescript
interface ReplayFilter {
  eventTypes?: ('text_delta' | 'tool_start' | 'agent_start')[];
  roles?: ('user' | 'assistant')[];
  toolNames?: string[];
  textContains?: string;
}

replayToStreamEvents(
  sessionId: string,
  mainMessages: SessionHistoryMessage[],
  agentSessions: AgentSessionData[],
  filter?: ReplayFilter
): FlatStreamEventUnion[]
```

**Use Cases**:

- "Show only tool calls" for debugging
- "Show only my messages" for context review
- "Search for specific text" in session

---

### 3.3 Worker Thread Processing

**Priority**: RESEARCH
**Effort**: 8-12 hours
**Business Value**: Non-blocking main thread for very large sessions

**Concept**:

- Offload JSONL parsing to Node.js Worker Thread
- Main thread remains responsive during large file processing
- Communication via MessageChannel

**Prerequisites**:

- Benchmark to determine threshold where worker is beneficial
- Likely only needed for sessions > 10MB

---

## 4. Testing Priorities

### Integration Test Scenarios

| Scenario                    | Priority | Description                               |
| --------------------------- | -------- | ----------------------------------------- |
| Basic session load          | HIGH     | Single user-assistant exchange            |
| Multi-agent session         | HIGH     | Session with nested Task tool calls       |
| Large session (500+ events) | MEDIUM   | Performance regression test               |
| Malformed JSONL handling    | HIGH     | Graceful degradation                      |
| Warmup agent filtering      | HIGH     | Verify warmup agents not shown            |
| Missing agent files         | MEDIUM   | Graceful handling when agent file missing |
| Session file not found      | HIGH     | Error handling                            |
| Path traversal attempt      | HIGH     | Security validation                       |

### Property-Based Testing Candidates

- **AgentCorrelationService.correlateAgentsToTasks()**:
  - Property: Each agent matched at most once
  - Property: Matched agents have timestamp within window
  - Property: Unmatched tasks logged as warnings

---

## 5. Dependencies & References

### Related Tasks

| Task          | Relationship                                                 |
| ------------- | ------------------------------------------------------------ |
| TASK_2025_096 | Agent message ID collision fix (incorporated in refactoring) |
| TASK_2025_088 | SDK type consolidation (types referenced from shared)        |
| TASK_2025_095 | Tool type system migration (typed tool inputs enhancement)   |

### Code References

| Pattern            | Location                                                           |
| ------------------ | ------------------------------------------------------------------ |
| Injectable service | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158` |
| DI token pattern   | `libs/backend/agent-sdk/src/lib/di/tokens.ts`                      |
| Type guards        | `libs/shared/src/lib/types/tool-types.ts`                          |
| Branded types      | `libs/shared/src/lib/types/branded.types.ts`                       |

---

## Summary Table

| Enhancement            | Priority | Effort | Category    |
| ---------------------- | -------- | ------ | ----------- |
| Parallel agent loading | HIGH     | 1-2h   | Performance |
| Unit tests             | HIGH     | 4-6h   | Testing     |
| Progress callbacks     | MEDIUM   | 2-3h   | UX          |
| Session caching        | MEDIUM   | 3-4h   | Performance |
| Typed tool inputs      | MEDIUM   | 3-4h   | Type Safety |
| Branded ID types       | LOW      | 2-3h   | Type Safety |
| Paginated loading      | LOW      | 6-8h   | Performance |
| Event filtering        | LOW      | 3-4h   | Feature     |
| Worker threads         | RESEARCH | 8-12h  | Performance |

**Source**: Modernization analysis of TASK_2025_106 refactored code
