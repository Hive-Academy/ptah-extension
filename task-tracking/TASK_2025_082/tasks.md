# Development Tasks - TASK_2025_082

**Total Tasks**: 31 | **Batches**: 6 | **Status**: 2/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ExecutionNode recursive rendering: Verified in execution-node.component.ts (lines 73-80)
- Signal-based reactivity: Verified in Angular 20+ (chat library CLAUDE.md)
- TreeBuilder service exists: Verified at libs/frontend/chat/src/lib/services/tree-builder.service.ts
- SdkMessageTransformer exists: Verified at libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts (1034 lines)

### Risks Identified

| Risk                                                                    | Severity | Mitigation                                                              |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Frontend depends on backend flat events BEFORE backend rewrite complete | HIGH     | Batch 1 (types) + Batch 2 (backend) MUST complete before Batch 3 starts |
| StreamingHandlerService tightly coupled with ExecutionNode tree merging | MEDIUM   | Batch 4 rewrites processExecutionNode → processStreamEvent carefully    |
| Tree building performance at render time unknown                        | MEDIUM   | Add performance measurement in Batch 5, fallback to caching if needed   |
| Message routing changes affect all streaming                            | HIGH     | Batch 6 integration requires careful testing with backend               |

### Edge Cases to Handle

- [ ] Race condition: Permission request arrives before tool node exists → Handled in Batch 5 (reactive lookup with computed signal)
- [ ] Interleaved sub-agent streams corrupt tree → Handled by flat event storage (Batch 3-4)
- [ ] Multiple text blocks in same message → Handled in Batch 1 (blockIndex field in flat events)
- [ ] Tool result arrives before tool start → Store events by ID, build tree handles order (Batch 5)

---

## Batch 1: Foundation - Flat Event Types ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: None
**Commit**: d579222

### Task 1.1: Add flat stream event types to shared library ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts
**Spec Reference**: implementation-plan.md:140-285
**Pattern to Follow**: Existing ExecutionNode types (lines 75-100)

**Quality Requirements**:

- All event types defined: message_start, text_delta, thinking_start, thinking_delta, tool_start, tool_delta, tool_result, agent_start, message_complete, message_delta
- Each event has proper TypeScript interface with readonly fields
- Union type FlatStreamEventUnion created for all events
- NO changes to existing ExecutionNode interface (backward compatible)

**Validation Notes**:

- Ensure parentToolUseId is optional (for root messages vs nested content)
- blockIndex field present in text_delta and thinking_delta (handles multiple text blocks)

**Implementation Details**:

- Add after line 285 in execution-node.types.ts
- Imports: None (pure type definitions)
- Key interfaces: FlatStreamEvent (base), MessageStartEvent, TextDeltaEvent, ThinkingStartEvent, ThinkingDeltaEvent, ToolStartEvent, ToolDeltaEvent, ToolResultEvent, AgentStartEvent, MessageCompleteEvent, MessageDeltaEvent
- Union type: FlatStreamEventUnion = MessageStartEvent | TextDeltaEvent | ... (all 10 types)

---

### Task 1.2: Add StreamEventType string literal union ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts
**Spec Reference**: implementation-plan.md:145-159
**Dependencies**: Task 1.1

**Quality Requirements**:

- String literal union for all event types
- Discriminated union pattern (for TypeScript narrowing)

**Implementation Details**:

- Add before FlatStreamEvent interface
- Type definition: `export type StreamEventType = 'message_start' | 'text_delta' | ...`
- Used in eventType field of FlatStreamEvent

---

### Task 1.3: Export new types from shared library index ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\index.ts
**Spec Reference**: implementation-plan.md:1019-1020
**Dependencies**: Task 1.1, Task 1.2

**Quality Requirements**:

- All new types exported properly
- No breaking changes to existing exports

**Implementation Details**:

- Add exports: `export type { StreamEventType, FlatStreamEvent, FlatStreamEventUnion, MessageStartEvent, TextDeltaEvent, ... } from './lib/types/execution-node.types';`

---

### Task 1.4: Create ExecutionTreeBuilderService shell (no implementation yet) ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Spec Reference**: implementation-plan.md:341-559
**Dependencies**: Task 1.1

**Quality Requirements**:

- Service structure matches implementation-plan.md algorithm
- All method signatures defined with proper types
- NO actual implementation yet (stubs return empty arrays/null)
- Injectable decorator present

**Validation Notes**:

- This is a NEW file (libs/frontend/chat already has tree-builder.service.ts, this is execution-tree-builder.service.ts)
- Distinct from existing tree-builder.service.ts (that one builds from messages, this one builds from flat events)

**Implementation Details**:

- Create new file: execution-tree-builder.service.ts
- Imports: `Injectable, FlatStreamEventUnion, ExecutionNode, createExecutionNode`
- Methods: buildTree(streamingState), buildMessageNode(messageId, state), buildMessageChildren(messageId, state), collectTextBlocks(events, state), collectThinkingBlocks(events, state), collectTools(events, state), buildToolNode(toolStart, state), buildToolChildren(toolCallId, state)
- All methods return empty/null for now (real implementation in Batch 5)

---

### Task 1.5: Build shared library to verify types compile ✅ COMPLETE

**File**: N/A (build verification)
**Spec Reference**: implementation-plan.md:586-588
**Dependencies**: Task 1.1, Task 1.2, Task 1.3

**Quality Requirements**:

- `npx nx build shared` succeeds with no errors
- No lint errors
- TypeScript compilation succeeds

**Implementation Details**:

- Command: `npx nx build shared`
- Expected: Clean build with no errors

---

### Task 1.6: Verify types accessible in both backend and frontend ✅ COMPLETE

**File**: N/A (verification task)
**Spec Reference**: implementation-plan.md:586-588
**Dependencies**: Task 1.5

**Quality Requirements**:

- Types importable in backend libraries (agent-sdk)
- Types importable in frontend libraries (chat)

**Implementation Details**:

- Test import in backend: Add `import { FlatStreamEventUnion } from '@ptah-extension/shared';` to sdk-message-transformer.ts (then remove)
- Test import in frontend: Add `import { FlatStreamEventUnion } from '@ptah-extension/shared';` to streaming-handler.service.ts (then remove)

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build shared`
- No TypeScript errors
- No lint errors
- Types accessible in both backend and frontend

---

## Batch 2: Backend Rewrite - Flat Event Emission ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: Batch 1 complete
**Commit**: 67674b2

### Task 2.1: Rewrite SdkMessageTransformer.transform() signature to return FlatStreamEventUnion[] ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: implementation-plan.md:596-659
**Pattern to Follow**: Keep existing SDKMessage type guards (lines 100-115)

**Quality Requirements**:

- Change return type from `ExecutionNode[]` to `FlatStreamEventUnion[]`
- NO tree building logic in return values
- Method signature: `transform(sdkMessage: SDKMessage, sessionId?: SessionId): FlatStreamEventUnion[]`

**Validation Notes**:

- This changes the contract - downstream consumers will break (fixed in Batch 6)

**Implementation Details**:

- Update return type in method signature (around line 150)
- Update all return statements to return flat events array instead of ExecutionNode array
- Remove all `children` field manipulation

---

### Task 2.2: Remove complex state tracking fields from SdkMessageTransformer ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: implementation-plan.md:596-662
**Dependencies**: Task 2.1

**Quality Requirements**:

- Remove: `messageStates` Map (line 190-228 region)
- Remove: `messageUuidStack` array
- Remove: `StreamingBlockState` interface
- Remove: `getOrCreateMessageState()` method
- Remove: `getCurrentMessageUuid()` method
- Remove: `clearMessageState()` method

**Validation Notes**:

- This is 87 lines of complex state management being deleted
- Massive simplification

**Implementation Details**:

- Delete private fields: messageStates, messageUuidStack
- Delete helper methods: getOrCreateMessageState, getCurrentMessageUuid, clearMessageState
- Delete interface: StreamingBlockState

---

### Task 2.3: Implement transformStreamEventToFlatEvents() method ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: implementation-plan.md:619-658
**Dependencies**: Task 2.2

**Quality Requirements**:

- Handle all SDK event types: message_start, content_block_delta, content_block_stop, message_delta, message_stop
- Emit flat events with relationship IDs (messageId, toolCallId, parentToolUseId)
- NO tree building (no children field manipulation)
- Track currentMessageId as simple variable (not in Map)

**Validation Notes**:

- Use event.message.id for messageId (from SDK)
- Use event.index for blockIndex (for text/thinking blocks)
- Use sdkMessage.parent_tool_use_id for parentToolUseId (sub-agent nesting)

**Implementation Details**:

- Method signature: `private transformStreamEventToFlatEvents(sdkMessage: SDKMessage, sessionId?: SessionId): FlatStreamEventUnion[]`
- Switch on event.type: 'message_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'
- Generate event IDs: Use `generateEventId()` helper (create if needed)
- Return array of flat events (usually single event, sometimes multiple)

---

### Task 2.4: Implement transformAssistantToFlatEvents() method ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: implementation-plan.md:612-658
**Dependencies**: Task 2.3

**Quality Requirements**:

- Handle complete assistant messages (non-streaming path)
- Emit message_start + content events + message_complete
- Extract tool_use blocks, emit tool_start events

**Implementation Details**:

- Method signature: `private transformAssistantToFlatEvents(sdkMessage: SDKAssistantMessage, sessionId?: SessionId): FlatStreamEventUnion[]`
- Create message_start event
- Iterate message.content blocks, emit text/thinking/tool events
- Create message_complete event with token usage
- Return array of all events

---

### Task 2.5: Update transform() switch statement to call new flat event methods ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: implementation-plan.md:605-617
**Dependencies**: Task 2.4

**Quality Requirements**:

- Replace all ExecutionNode tree building with flat event emission
- Keep case structure (stream_event, assistant, user, system, result)
- Each case returns FlatStreamEventUnion[]

**Implementation Details**:

- Update transform() method body
- Case 'stream_event': return this.transformStreamEventToFlatEvents(sdkMessage, sessionId)
- Case 'assistant': return this.transformAssistantToFlatEvents(sdkMessage, sessionId)
- Case 'user', 'system', 'result': emit appropriate flat events

---

### Task 2.6: Update sdk-agent-adapter.ts callback to send flat events ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
**Spec Reference**: implementation-plan.md:664-676
**Dependencies**: Task 2.5

**Quality Requirements**:

- Change onChunk callback to emit FlatStreamEventUnion instead of ExecutionNode
- Update payload structure: `{ sessionId, event }` instead of `{ sessionId, message: node }`

**Implementation Details**:

- Find onChunk callback invocation (around line 150-200)
- Change: `onChunk({ sessionId, message: executionNode })` → `onChunk({ sessionId, event: flatEvent })`
- Update type imports

---

### Task 2.7: Build backend to verify flat event emission compiles ✅ COMPLETE

**File**: N/A (build verification)
**Spec Reference**: implementation-plan.md:672-676
**Dependencies**: Task 2.6

**Quality Requirements**:

- `npx nx build agent-sdk` succeeds
- No lint errors
- No tree building logic in backend (verified by searching for `children.push()` - should be absent)

**Implementation Details**:

- Command: `npx nx build agent-sdk`
- Verify: Search for `children.push()` or `children: [` in sdk-message-transformer.ts - NONE should exist
- Expected: Clean build

---

**Batch 2 Verification**:

- Backend compiles successfully
- Backend emits flat events (verified in logs or types)
- No ExecutionNode tree building in backend (search for `children.push()` - absent)
- SdkMessageTransformer return type is FlatStreamEventUnion[]

---

## Batch 3: Frontend Storage Model - StreamingState 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 6 | **Dependencies**: Batch 2 complete

### Task 3.1: Add StreamingState interface to chat.types.ts 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.types.ts
**Spec Reference**: implementation-plan.md:293-334
**Pattern to Follow**: Existing TabState interface (lines 53-105)

**Quality Requirements**:

- Interface matches spec exactly (events Map, messageEventIds array, toolCallMap, textAccumulators, toolInputAccumulators, currentMessageId, currentTokenUsage)
- All fields properly typed with FlatStreamEventUnion
- Readonly where appropriate

**Implementation Details**:

- Add after NodeMaps interface (after line 12)
- Import: `import { FlatStreamEventUnion } from '@ptah-extension/shared';`
- Interface fields:
  - events: Map<string, FlatStreamEventUnion>
  - messageEventIds: string[]
  - toolCallMap: Map<string, string[]>
  - textAccumulators: Map<string, string>
  - toolInputAccumulators: Map<string, string>
  - currentMessageId: string | null
  - currentTokenUsage: { input: number; output: number } | null

---

### Task 3.2: Update TabState interface to replace executionTree with streamingState 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.types.ts
**Spec Reference**: implementation-plan.md:318-334
**Dependencies**: Task 3.1

**Quality Requirements**:

- Replace field: `executionTree: ExecutionNode | null` → `streamingState: StreamingState | null`
- NO breaking changes to other TabState fields
- Keep messages array (historical)

**Validation Notes**:

- This breaks existing code that accesses tab.executionTree (fixed in later batches)

**Implementation Details**:

- Update line 91: Change `executionTree: ExecutionNode | null;` to `streamingState: StreamingState | null;`
- Update comments to reflect new streaming model

---

### Task 3.3: Update TabManagerService to initialize streamingState: null 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
**Spec Reference**: implementation-plan.md:684-699
**Dependencies**: Task 3.2

**Quality Requirements**:

- All tab creation initializes streamingState: null
- No executionTree field initialization

**Implementation Details**:

- Find createTab() method (around line 100-150)
- Update tab initialization: Replace `executionTree: null` with `streamingState: null`

---

### Task 3.4: Create helper to initialize empty StreamingState 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.types.ts
**Spec Reference**: implementation-plan.md:728-739
**Dependencies**: Task 3.1

**Quality Requirements**:

- Factory function returns empty StreamingState
- All Maps and arrays initialized empty

**Implementation Details**:

- Add after StreamingState interface:

```typescript
export function createEmptyStreamingState(): StreamingState {
  return {
    events: new Map(),
    messageEventIds: [],
    toolCallMap: new Map(),
    textAccumulators: new Map(),
    toolInputAccumulators: new Map(),
    currentMessageId: null,
    currentTokenUsage: null,
  };
}
```

---

### Task 3.5: Update TabState creation in all locations to use streamingState 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
**Spec Reference**: implementation-plan.md:684-699
**Dependencies**: Task 3.3, Task 3.4

**Quality Requirements**:

- All tab creation/update uses streamingState field
- Search codebase for `executionTree:` and replace with `streamingState:`

**Implementation Details**:

- Search file for all occurrences of `executionTree`
- Replace with `streamingState` (using createEmptyStreamingState() where needed)

---

### Task 3.6: Build frontend to verify storage model compiles 🔄 IN PROGRESS

**File**: N/A (build verification)
**Spec Reference**: implementation-plan.md:695-699
**Dependencies**: Task 3.5

**Quality Requirements**:

- `npx nx build chat` succeeds
- No TypeScript errors

**Implementation Details**:

- Command: `npx nx build chat`
- Expected: Build may have errors in components accessing tab.executionTree (fixed in Batch 4-5)

---

**Batch 3 Verification**:

- Frontend compiles (errors expected in components, fixed in next batch)
- TabState has streamingState field
- StreamingState interface complete
- Tab creation initializes streamingState: null

---

## Batch 4: Streaming Handler Rewrite - Flat Event Storage PENDING

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 3 complete

### Task 4.1: Remove mergeExecutionNode() method from StreamingHandlerService PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts
**Spec Reference**: implementation-plan.md:708-787
**Pattern to Follow**: None (deletion)

**Quality Requirements**:

- Delete method: mergeExecutionNode() (lines 92-145)
- Delete helper methods: findNodeInTree(), replaceNodeInTree()
- Total deletion: 53 lines of complex recursive merging

**Implementation Details**:

- Delete lines 92-145 (mergeExecutionNode method)
- Delete any helper methods used only by mergeExecutionNode

---

### Task 4.2: Rename processExecutionNode() to processStreamEvent() and change signature PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts
**Spec Reference**: implementation-plan.md:716-778
**Dependencies**: Task 4.1

**Quality Requirements**:

- Method signature: `processStreamEvent(event: FlatStreamEventUnion): void`
- Remove node parameter, add event parameter
- Update type imports

**Implementation Details**:

- Line 32: Change `processExecutionNode(node: ExecutionNode, sessionId?: string): void` to `processStreamEvent(event: FlatStreamEventUnion): void`
- Import: `import { FlatStreamEventUnion } from '@ptah-extension/shared';`

---

### Task 4.3: Implement flat event storage logic in processStreamEvent() PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts
**Spec Reference**: implementation-plan.md:722-778
**Dependencies**: Task 4.2

**Quality Requirements**:

- Find target tab by event.sessionId
- Initialize streamingState if null (using createEmptyStreamingState())
- Store event by ID: state.events.set(event.id, event)
- Handle each event type: message_start, text_delta, tool_start, tool_result, message_complete
- Accumulate text deltas in textAccumulators Map
- NO tree building (no mergeExecutionNode calls)

**Validation Notes**:

- message_start: Add messageId to messageEventIds, set currentMessageId
- text_delta: Accumulate in textAccumulators with key `${messageId}-block-${blockIndex}`
- tool_start: Add to toolCallMap
- message_complete: Keep for finalization metadata

**Implementation Details**:

- Replace method body (lines 32-87)
- Implementation:

```typescript
processStreamEvent(event: FlatStreamEventUnion): void {
  // 1. Find target tab
  const targetTab = this.tabManager.findTabBySessionId(event.sessionId);
  if (!targetTab) return;

  // 2. Initialize streaming state
  if (!targetTab.streamingState) {
    targetTab.streamingState = createEmptyStreamingState();
  }

  const state = targetTab.streamingState;

  // 3. Store event
  state.events.set(event.id, event);

  // 4. Handle by type
  switch (event.eventType) {
    case 'message_start':
      state.messageEventIds.push(event.messageId);
      state.currentMessageId = event.messageId;
      break;

    case 'text_delta': {
      const blockId = `${event.messageId}-block-${event.blockIndex}`;
      const current = state.textAccumulators.get(blockId) || '';
      state.textAccumulators.set(blockId, current + event.delta);
      break;
    }

    case 'tool_start':
      if (!state.toolCallMap.has(event.toolCallId)) {
        state.toolCallMap.set(event.toolCallId, []);
      }
      state.toolCallMap.get(event.toolCallId)!.push(event.id);
      break;

    // ... other cases
  }

  // 5. Update tab
  this.tabManager.updateTab(targetTab.id, { streamingState: state });
}
```

---

### Task 4.4: Remove SessionManager agent/tool registration from streaming handler PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts
**Spec Reference**: implementation-plan.md:708-787
**Dependencies**: Task 4.3

**Quality Requirements**:

- Remove lines 68-72 (registerAgent, registerTool calls)
- Flat events don't need node registration during streaming

**Implementation Details**:

- Delete lines 68-72 in processExecutionNode (now processStreamEvent)

---

### Task 4.5: Update all callers of processExecutionNode to use processStreamEvent PENDING

**File**: Multiple files (search for processExecutionNode usage)
**Spec Reference**: implementation-plan.md:896-923
**Dependencies**: Task 4.4

**Quality Requirements**:

- Search codebase for `processExecutionNode(`
- Update all callers to pass FlatStreamEventUnion instead of ExecutionNode
- Update method name to processStreamEvent

**Validation Notes**:

- Main caller is VSCodeService (fixed in Batch 6)
- May have other callers in tests

**Implementation Details**:

- Command: Search for `processExecutionNode` in libs/frontend
- Update each caller: Change method name + change parameter

---

**Batch 4 Verification**:

- StreamingHandlerService compiles
- processStreamEvent() stores flat events in Map
- No tree merging logic (search for `mergeExecutionNode` - absent)
- Text accumulators work (verify in logs)

---

## Batch 5: Tree Builder Integration - Render-Time Tree Building PENDING

**Developer**: frontend-developer
**Tasks**: 6 | **Dependencies**: Batch 4 complete

### Task 5.1: Implement buildTree() method in ExecutionTreeBuilderService PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Spec Reference**: implementation-plan.md:347-367
**Pattern to Follow**: Existing tree-builder.service.ts immutable pattern

**Quality Requirements**:

- Iterate messageEventIds, build message node for each
- Return array of root ExecutionNode objects
- Pure function (no mutations)

**Implementation Details**:

- Replace stub implementation from Task 1.4
- Algorithm:

```typescript
buildTree(streamingState: StreamingState): ExecutionNode[] {
  const rootNodes: ExecutionNode[] = [];

  for (const messageId of streamingState.messageEventIds) {
    const messageNode = this.buildMessageNode(messageId, streamingState);
    rootNodes.push(messageNode);
  }

  return rootNodes;
}
```

---

### Task 5.2: Implement buildMessageNode() method PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Spec Reference**: implementation-plan.md:369-402
**Dependencies**: Task 5.1

**Quality Requirements**:

- Find message_start event by messageId
- Find message_complete event (may not exist if still streaming)
- Build children using buildMessageChildren()
- Return complete message ExecutionNode

**Implementation Details**:

- Use createExecutionNode factory
- Status: 'complete' if message_complete exists, 'streaming' otherwise
- Include token usage, cost, duration from message_complete event

---

### Task 5.3: Implement buildMessageChildren() method PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Spec Reference**: implementation-plan.md:404-423
**Dependencies**: Task 5.2

**Quality Requirements**:

- Filter events by messageId AND NOT parentToolUseId (root-level content only)
- Collect text blocks using collectTextBlocks()
- Collect thinking blocks using collectThinkingBlocks()
- Collect tools using collectTools()
- Return ordered array of children

**Implementation Details**:

- Filter: `state.events.values().filter(e => e.messageId === messageId && !e.parentToolUseId)`
- Call helper methods for each content type
- Merge arrays: `[...textBlocks, ...thinkingBlocks, ...tools]`

---

### Task 5.4: Implement collectTextBlocks() and collectThinkingBlocks() methods PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Spec Reference**: implementation-plan.md:425-461
**Dependencies**: Task 5.3

**Quality Requirements**:

- Group text_delta events by blockIndex
- Retrieve accumulated text from textAccumulators Map
- Return array of text ExecutionNode objects ordered by blockIndex
- Same for thinking blocks

**Implementation Details**:

- collectTextBlocks(): Map blockIndex → accumulated text from textAccumulators
- Create text node for each block using createExecutionNode
- Sort by blockIndex, return array

---

### Task 5.5: Implement collectTools(), buildToolNode(), buildToolChildren() methods PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Spec Reference**: implementation-plan.md:463-531
**Dependencies**: Task 5.4

**Quality Requirements**:

- collectTools(): Find all tool_start events, build tool node for each
- buildToolNode(): Create tool ExecutionNode with nested children (RECURSIVE)
- buildToolChildren(): Find events with parentToolUseId = toolCallId, build nested messages (RECURSIVE)

**Validation Notes**:

- RECURSIVE: buildToolChildren calls buildMessageNode for sub-agent messages
- Use parentToolUseId for nesting hierarchy
- Handle both regular tools and agent tools (Task tool with isTaskTool = true)

**Implementation Details**:

- collectTools(): Filter tool_start events, map to buildToolNode
- buildToolNode(): Create tool node, find tool_result, build children recursively
- buildToolChildren(): Filter by parentToolUseId, group by messageId, call buildMessageNode for each

---

### Task 5.6: Add currentExecutionTree computed signal to ChatStore PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Spec Reference**: implementation-plan.md:799-824
**Dependencies**: Task 5.5

**Quality Requirements**:

- Inject ExecutionTreeBuilderService
- Add computed signal: `currentExecutionTree = computed(() => this.buildTreeFromStreamingState())`
- Computed signal rebuilds tree whenever streamingState changes
- Return single root or null (not array)

**Implementation Details**:

- Inject: `private readonly treeBuilder = inject(ExecutionTreeBuilderService);`
- Add computed:

```typescript
readonly currentExecutionTree = computed(() => {
  const activeTab = this.tabManager.activeTab();
  if (!activeTab?.streamingState) return null;

  const rootNodes = this.treeBuilder.buildTree(activeTab.streamingState);
  return rootNodes.length === 1 ? rootNodes[0] : null;
});
```

---

**Batch 5 Verification**:

- ExecutionTreeBuilderService fully implemented
- buildTree() returns proper ExecutionNode tree
- Tree structure matches expected hierarchy (logs/debugger)
- currentExecutionTree computed signal works
- UI renders tree correctly (visual inspection)

---

## Batch 6: Integration - Message Routing + Finalization + Cleanup PENDING

**Developer**: frontend-developer (or backend-developer for Task 6.1)
**Tasks**: 7 | **Dependencies**: Batch 5 complete

### Task 6.1: Update VSCodeService message routing to route flat events PENDING

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts
**Spec Reference**: implementation-plan.md:902-923
**Pattern to Follow**: Existing MESSAGE_TYPES routing (lines 188-200)

**Quality Requirements**:

- Change payload structure: `{ sessionId, event }` instead of `{ sessionId, message: node }`
- Route to chatStore.processStreamEvent(event)
- Type: FlatStreamEventUnion

**Implementation Details**:

- Find CHAT_CHUNK message routing (around line 188-200)
- Update:

```typescript
// BEFORE
if (message.type === MESSAGE_TYPES.CHAT_CHUNK) {
  if (message.payload && this.chatStore) {
    const { sessionId, message: node } = message.payload;
    this.chatStore.processExecutionNode(node as ExecutionNode, sessionId);
  }
}

// AFTER
if (message.type === MESSAGE_TYPES.CHAT_CHUNK) {
  if (message.payload && this.chatStore) {
    const { sessionId, event } = message.payload;
    this.chatStore.processStreamEvent(event as FlatStreamEventUnion);
  }
}
```

---

### Task 6.2: Update ChatViewComponent to use currentExecutionTree computed signal PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
**Spec Reference**: implementation-plan.md:826-838
**Dependencies**: Task 5.6

**Quality Requirements**:

- Use `chatStore.currentExecutionTree()` instead of `tab.executionTree`
- Update template bindings

**Implementation Details**:

- Find template references to `tab.executionTree`
- Replace with `chatStore.currentExecutionTree()`

---

### Task 6.3: Update finalization logic in StreamingHandlerService PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts
**Spec Reference**: implementation-plan.md:846-883
**Dependencies**: Batch 5 complete

**Quality Requirements**:

- Update finalizeCurrentMessage() to build final tree from streamingState
- Extract metadata from message_complete event
- Clear streamingState after finalization

**Implementation Details**:

- Update finalizeCurrentMessage() method:

```typescript
finalizeCurrentMessage(tabId?: string): void {
  const targetTab = this.tabManager.activeTab();
  const streamingState = targetTab?.streamingState;

  if (!streamingState || !streamingState.currentMessageId) return;

  // Build final tree
  const finalTree = this.treeBuilder.buildTree(streamingState);

  // Find message_complete event
  const completeEvent = this.findCompleteEvent(streamingState);

  // Create chat message
  const assistantMessage = createExecutionChatMessage({
    id: streamingState.currentMessageId,
    role: 'assistant',
    executionTree: finalTree[0] || null,
    sessionId: targetTab?.claudeSessionId ?? undefined,
    tokens: completeEvent?.tokenUsage,
    cost: completeEvent?.cost,
    duration: completeEvent?.duration,
  });

  // Add to messages, clear streaming state
  this.tabManager.updateTab(targetTab.id, {
    messages: [...targetTab.messages, assistantMessage],
    streamingState: null,
    status: 'loaded',
  });
}
```

---

### Task 6.4: Remove deprecated code from SdkMessageTransformer PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: implementation-plan.md:944-967
**Dependencies**: All other tasks complete

**Quality Requirements**:

- Remove any remaining ExecutionNode tree building code
- Remove unused helper methods
- Clean up comments referencing old approach

**Implementation Details**:

- Search for `children.push()` - delete any occurrences
- Remove unused private methods
- Update file header comments

---

### Task 6.5: Update ExecutionNode type documentation PENDING

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts
**Spec Reference**: implementation-plan.md:951-955
**Dependencies**: Task 6.4

**Quality Requirements**:

- Add comment: ExecutionNode is for FINALIZED trees only, not streaming
- Document that flat events are used during streaming

**Implementation Details**:

- Update file header comment (lines 1-21)
- Add note about streaming vs finalized distinction

---

### Task 6.6: Run full test suite and fix any failing tests PENDING

**File**: N/A (testing)
**Spec Reference**: implementation-plan.md:957-966
**Dependencies**: Task 6.5

**Quality Requirements**:

- All unit tests pass
- All integration tests pass
- No lint errors
- Build succeeds for all affected libraries

**Implementation Details**:

- Command: `npx nx run-many --target=test --projects=shared,agent-sdk,chat`
- Fix any failing tests (update mocks, update assertions)

---

### Task 6.7: Manual testing of streaming scenarios PENDING

**File**: N/A (manual testing)
**Spec Reference**: implementation-plan.md:957-966
**Dependencies**: Task 6.6

**Quality Requirements**:

- Single streaming bubble during response (text accumulates, not duplicates)
- Tool inputs/outputs display correctly
- Sub-agents nest visually under parent Task tool
- No empty agent boxes
- No user message duplication

**Implementation Details**:

- Test scenario 1: Simple text response (verify single bubble)
- Test scenario 2: Tool call with result (verify tool card displays)
- Test scenario 3: Agent spawn with nested execution (verify nesting)
- Test scenario 4: Interleaved sub-agent messages (verify no corruption)

---

**Batch 6 Verification**:

- All tests pass (unit + integration)
- Build succeeds
- UI works correctly (manual testing)
- No backward compatibility debt (old code removed)

---

## Success Criteria

- Single streaming bubble during response (text accumulates, not duplicates)
- Tool inputs/outputs display correctly with collapsible sections
- Sub-agents nest visually under parent Task tool
- No empty agent boxes
- No user message duplication
- Build passes for all affected libraries
- No lint errors
- All tests pass
- Performance: Tree building < 5ms for typical messages

---

## Notes

- **Backend-first approach**: Batches 1-2 complete before frontend work begins
- **Atomic batches**: Each batch is independently verifiable and committable
- **Zero backward compatibility**: Old patterns deleted, not deprecated
- **Performance target**: Tree building at render time < 5ms for typical messages (< 50 events)
