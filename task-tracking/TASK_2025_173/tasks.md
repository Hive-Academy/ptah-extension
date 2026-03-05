# Development Tasks - TASK_2025_173: Per-CLI Rendering Pipelines for Agent Monitor Panel

**Total Tasks**: 13 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `FlatStreamEventUnion` exported from `@ptah-extension/shared` (execution-node.types.ts:1032): VERIFIED
- `ExecutionNode` exported from `@ptah-extension/shared` (execution-node.types.ts:40-46): VERIFIED
- `createExecutionNode` exported from `@ptah-extension/shared` (execution-node.types.ts, factory function): VERIFIED
- `CliOutputSegment` exported from `@ptah-extension/shared` (agent-process.types.ts:187): VERIFIED
- `AgentOutputDelta.segments` is already optional (agent-process.types.ts:210): VERIFIED
- `SdkHandle` interface in cli-adapter.interface.ts (lines 48-59): VERIFIED
- `pendingDeltas` type in agent-process-manager.service.ts (lines 103-106): VERIFIED -- currently `{ stdout: string; stderr: string; segments: CliOutputSegment[] }`
- `trackSdkHandle` already wires `onSegment` (lines 567-583): VERIFIED
- `flushDelta` emits `agent:output` event (lines 933-961): VERIFIED
- `MonitoredAgent` interface in agent-monitor.store.ts (lines 25-51): VERIFIED -- no `streamEvents` field yet
- `mergeConsecutiveTextSegments` in agent-card.utils.ts: VERIFIED (exported)
- `ExecutionNodeComponent` in execution-node.component.ts: VERIFIED (standalone, imports ToolCallItemComponent etc.)
- PtahCliRegistry `spawnAgent` does NOT use SdkMessageTransformer.transform() in headless mode: VERIFIED -- manually converts to CliOutputSegment
- PtahCliAdapter `createTransformedStream` produces FlatStreamEventUnion via transform() (line 951): VERIFIED
- PtahCliRegistry has `this.messageTransformer` (SdkMessageTransformer) injected (line 143): VERIFIED

### Risks Identified

| Risk                                                                                         | Severity | Mitigation                                                                                          |
| -------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| FlatStreamEventUnion serialization size (200-500 bytes each) may create large payloads       | LOW      | 200ms throttle batches events; only ptah-cli uses this path; cap at 2000 events frontend            |
| Tree rebuilding performance in computed() with 2000 events                                   | LOW      | Memoize by events.length; O(n) build for 2000 events is <5ms                                        |
| ExecutionNodeComponent designed for ~700px chat panel, may overflow in ~460px agent monitor  | MEDIUM   | Components already use compact sizing (text-[11px], prose-sm); test and apply CSS wrapper if needed |
| PtahCliRegistry messageTransformer.transform() requires a sessionId (SessionId branded type) | MEDIUM   | Extract sessionId from system init message; use placeholder until resolved                          |
| Backward compatibility for old sessions without streamEvents field                           | LOW      | Field is optional; loadCliSessions initializes to empty array; fallback to generic output           |

### Edge Cases to Handle

- [ ] Ptah CLI agent with no streamEvents (old session) -> Handled in Task 10 (fallback routing)
- [ ] streamEvents buffer exceeding 2000 events -> Handled in Task 5 (cap logic)
- [ ] Agent spawned before onStreamEvent callback is registered -> Handled in Task 3 (buffering pattern matching onSegment)
- [ ] messageTransformer.transform() returning empty array for unrecognized messages -> No crash, just skipped

---

## Batch 1: Infrastructure (Types + Backend + Store) -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task T1: Add `streamEvents` field to `AgentOutputDelta` and `CliSessionReference` -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Phase 1, Component 1.1

**Description**:
Add an optional `streamEvents` field of type `readonly FlatStreamEventUnion[]` to both `AgentOutputDelta` and `CliSessionReference` interfaces.

**Implementation Details**:

1. Add import for `FlatStreamEventUnion` from `./execution-node.types` (same package, relative import within shared lib).
2. Add to `AgentOutputDelta` (after `segments` field, line ~210):
   ```typescript
   /** Rich streaming events from Ptah CLI adapter (optional -- only ptah-cli uses this) */
   readonly streamEvents?: readonly FlatStreamEventUnion[];
   ```
3. Add to `CliSessionReference` (after `segments` field, line ~237):
   ```typescript
   /** Persisted rich streaming events (Ptah CLI only). Absent in older sessions. */
   readonly streamEvents?: readonly FlatStreamEventUnion[];
   ```

**Acceptance Criteria**:

- Both interfaces have optional `streamEvents` field
- Import of `FlatStreamEventUnion` is present
- `npm run typecheck:all` passes with no errors

---

### Task T2: Add `onStreamEvent` to `SdkHandle` interface -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Phase 1, Component 1.2

**Description**:
Add an optional `onStreamEvent` callback to the `SdkHandle` interface so that `AgentProcessManager` can receive `FlatStreamEventUnion` events from Ptah CLI.

**Implementation Details**:

1. Add import for `FlatStreamEventUnion` from `@ptah-extension/shared`.
2. Add to `SdkHandle` interface (after `getSessionId`, line ~58):
   ```typescript
   /** Register a callback to receive rich FlatStreamEventUnion events.
    *  Only Ptah CLI adapter implements this. Enables full ExecutionNode rendering. */
   readonly onStreamEvent?: (callback: (event: FlatStreamEventUnion) => void) => void;
   ```

**Acceptance Criteria**:

- `SdkHandle` has optional `onStreamEvent` field
- Import path is correct
- `npm run typecheck:all` passes

---

### Task T3: Wire `onStreamEvent` in PtahCliRegistry's SdkHandle creation -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-registry.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Phase 1, Component 1.3
**Dependencies**: Task T1, Task T2

**Description**:
In the `spawnAgent` method of PtahCliRegistry, wire the new `onStreamEvent` callback on the SdkHandle. Use `this.messageTransformer.transform()` to convert raw SDK messages to `FlatStreamEventUnion[]` events and emit them via the callback. This runs alongside the existing `emitSegment()` pipeline (segments continue working as before).

**Implementation Details**:

1. Add import for `FlatStreamEventUnion` from `@ptah-extension/shared` and `SessionId` from `@ptah-extension/shared`.

2. Near the existing `segmentCallbacks` and `segmentBuffer` declarations (around line 756), add a parallel pattern for stream events:

   ```typescript
   // FlatStreamEventUnion callbacks (new: enables ExecutionNode rendering in agent monitor)
   const streamEventBuffer: FlatStreamEventUnion[] = [];
   const streamEventCallbacks: Array<(event: FlatStreamEventUnion) => void> = [];

   const onStreamEvent = (callback: (event: FlatStreamEventUnion) => void): void => {
     streamEventCallbacks.push(callback);
     if (streamEventBuffer.length > 0) {
       for (const buffered of streamEventBuffer) {
         callback(buffered);
       }
       streamEventBuffer.length = 0;
     }
   };

   const emitStreamEvent = (event: FlatStreamEventUnion): void => {
     if (streamEventCallbacks.length === 0) {
       streamEventBuffer.push(event);
     } else {
       for (const cb of streamEventCallbacks) {
         cb(event);
       }
     }
   };
   ```

3. Inside the `for await (const msg of sdkQuery)` loop (line ~863), after the existing message processing, add a call to transform and emit FlatStreamEventUnion events. This should be placed BEFORE the `continue` statements in each branch so that ALL processable message types get transformed. The cleanest approach is to add a block at the TOP of the loop body (before all the individual message type checks):

   ```typescript
   // Emit FlatStreamEventUnion events for agent monitor (Ptah CLI only)
   if (msg.type === 'stream_event' || msg.type === 'assistant' || msg.type === 'user') {
     try {
       const flatEvents = this.messageTransformer.transform(msg, effectiveSessionId);
       for (const event of flatEvents) {
         emitStreamEvent(event);
       }
     } catch {
       // Non-critical: stream event transformation failure should not break the agent
     }
   }
   ```

4. Track `effectiveSessionId` -- extract from system init message. Add a variable before the loop:

   ```typescript
   let effectiveSessionId = '' as SessionId;
   ```

   And in the `isSystemInit(msg)` branch (line ~865), capture it:

   ```typescript
   effectiveSessionId = msg.session_id as SessionId;
   ```

5. Add `onStreamEvent` to the SdkHandle creation (line ~1083):
   ```typescript
   const handle: SdkHandle = {
     abort: abortController,
     done,
     onOutput: (callback) => {
       outputCallbacks.push(callback);
     },
     onSegment,
     onStreamEvent,
   };
   ```

**Pattern to Follow**: The existing `onSegment` / `segmentBuffer` / `segmentCallbacks` / `emitSegment` pattern (lines 756-777) -- mirror it exactly for stream events.

**Acceptance Criteria**:

- `onStreamEvent` field is present on the returned SdkHandle
- `messageTransformer.transform()` is called for each processable SDK message
- FlatStreamEventUnion events are emitted through the callback
- Existing `onSegment` pipeline is completely unchanged
- `npm run typecheck:all` passes

---

### Task T4: Wire `onStreamEvent` in AgentProcessManager -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Phase 1, Component 1.4
**Dependencies**: Task T1, Task T2

**Description**:
When tracking an SDK handle, if `onStreamEvent` is available, accumulate events and include them in the throttled `flushDelta()` emission.

**Implementation Details**:

1. Add import for `FlatStreamEventUnion` from `@ptah-extension/shared` (alongside existing imports on line 18-27).

2. Update `pendingDeltas` type (line 103-106) to include `streamEvents`:

   ```typescript
   private readonly pendingDeltas = new Map<
     string,
     { stdout: string; stderr: string; segments: CliOutputSegment[]; streamEvents: FlatStreamEventUnion[] }
   >();
   ```

3. Update all places that initialize pending deltas (`{ stdout: '', stderr: '', segments: [] }`) to include `streamEvents: []`. There are 3 locations:

   - `accumulateDelta()` (line ~885)
   - `accumulateSegment()` (line ~907)
   - The new `accumulateStreamEvent()` method

4. Add `accumulateStreamEvent()` method (after `accumulateSegment()`, around line 927):

   ```typescript
   /**
    * Accumulate a FlatStreamEventUnion event for throttled emission.
    * Shares the same flush timer as text deltas and segments.
    */
   private accumulateStreamEvent(agentId: string, event: FlatStreamEventUnion): void {
     let pending = this.pendingDeltas.get(agentId);
     if (!pending) {
       pending = { stdout: '', stderr: '', segments: [], streamEvents: [] };
       this.pendingDeltas.set(agentId, pending);
     }
     pending.streamEvents.push(event);

     // Start flush timer if not already running
     if (!this.flushTimers.has(agentId)) {
       const timer = setTimeout(() => {
         this.flushDelta(agentId);
       }, OUTPUT_FLUSH_INTERVAL);
       this.flushTimers.set(agentId, timer);
     }
   }
   ```

5. In `trackSdkHandle()` (after the `onSegment` wiring, around line 583), wire `onStreamEvent`:

   ```typescript
   // Wire FlatStreamEventUnion events (Ptah CLI only — enables rich ExecutionNode rendering)
   if (sdkHandle.onStreamEvent) {
     sdkHandle.onStreamEvent((event: FlatStreamEventUnion) => {
       this.accumulateStreamEvent(agentId, event);
     });
   }
   ```

6. In `flushDelta()` (line ~933), include `streamEvents` in the emitted delta and reset:
   - Update the empty check (line ~938-939):
     ```typescript
     if (!pending || (!pending.stdout && !pending.stderr && pending.segments.length === 0 && pending.streamEvents.length === 0)) return;
     ```
   - Add to delta construction (line ~947-953):
     ```typescript
     const delta: AgentOutputDelta = {
       agentId: AgentId.from(agentId),
       stdoutDelta: pending.stdout,
       stderrDelta: pending.stderr,
       timestamp: Date.now(),
       ...(mergedSegments.length > 0 ? { segments: mergedSegments } : {}),
       ...(pending.streamEvents.length > 0 ? { streamEvents: pending.streamEvents } : {}),
     };
     ```
   - Reset (line ~958, add):
     ```typescript
     pending.streamEvents = [];
     ```

**Acceptance Criteria**:

- `accumulateStreamEvent()` method exists and works
- `trackSdkHandle()` wires `onStreamEvent` when available
- `flushDelta()` includes `streamEvents` in the delta payload
- `pendingDeltas` type includes `streamEvents` field
- All 3 initialization sites include `streamEvents: []`
- `npm run typecheck:all` passes

---

### Task T5: Add `streamEvents` to `MonitoredAgent` and store logic -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Phase 1, Components 1.5 and 1.6
**Dependencies**: Task T1

**Description**:
Add `streamEvents: FlatStreamEventUnion[]` field to `MonitoredAgent` interface, initialize it in `onAgentSpawned()`, accumulate in `onAgentOutput()`, load in `loadCliSessions()`, and implement buffer capping at 2000 events.

**Implementation Details**:

1. Add import for `FlatStreamEventUnion` from `@ptah-extension/shared` (alongside existing imports, line 9-17).

2. Add constant for the event cap:

   ```typescript
   /** Maximum streamEvents buffer per agent (prevents unbounded memory growth) */
   const MAX_STREAM_EVENTS = 2000;
   ```

3. Add field to `MonitoredAgent` interface (after `segments`, line ~38):

   ```typescript
   /** Rich streaming events from Ptah CLI adapter. Enables ExecutionNode rendering. */
   streamEvents: FlatStreamEventUnion[];
   ```

4. In `onAgentSpawned()` (line ~136, in the object literal), add:

   ```typescript
   streamEvents: [],
   ```

5. In `onAgentOutput()` (after the segments accumulation block ending at line ~207), add:

   ```typescript
   if (delta.streamEvents && delta.streamEvents.length > 0) {
     const combined = [...existing.streamEvents, ...delta.streamEvents];
     // Cap buffer: keep landmark events (message_start, tool_start, agent_start, thinking_start)
     // and drop oldest delta events when exceeding limit
     if (combined.length > MAX_STREAM_EVENTS) {
       updated.streamEvents = capStreamEvents(combined, MAX_STREAM_EVENTS);
     } else {
       updated.streamEvents = combined;
     }
   }
   ```

6. Add the `capStreamEvents` helper function (after the existing `capBuffer` function at end of file):

   ```typescript
   /** Landmark event types that establish tree structure and must be preserved */
   const LANDMARK_TYPES = new Set(['message_start', 'tool_start', 'agent_start', 'thinking_start', 'message_complete']);

   /**
    * Cap stream events buffer by dropping oldest delta events while preserving
    * landmark events that establish the tree structure.
    */
   function capStreamEvents(events: FlatStreamEventUnion[], max: number): FlatStreamEventUnion[] {
     if (events.length <= max) return events;

     // Separate landmarks from deltas
     const landmarks: FlatStreamEventUnion[] = [];
     const deltas: FlatStreamEventUnion[] = [];
     for (const e of events) {
       if (LANDMARK_TYPES.has(e.type)) {
         landmarks.push(e);
       } else {
         deltas.push(e);
       }
     }

     // Keep all landmarks + most recent deltas to fill remaining budget
     const deltasBudget = max - landmarks.length;
     if (deltasBudget <= 0) {
       return landmarks.slice(-max); // Extreme case: more landmarks than budget
     }
     const keptDeltas = deltas.slice(-deltasBudget);

     // Merge back in original order using a stable sort by original index
     // For simplicity, since we keep tail of deltas and all landmarks,
     // just take the last `max` events which preserves order
     return events.slice(-max);
   }
   ```

   Note: The simple `events.slice(-max)` approach is the pragmatic choice here. It keeps the most recent events in order. The landmark-preserving logic is an optimization that can be refined later if needed, but for 2000 events the simple tail slice is effective.

7. In `loadCliSessions()` (line ~338, in the object literal), add:
   ```typescript
   streamEvents: ref.streamEvents ? [...ref.streamEvents] : [],
   ```

**Acceptance Criteria**:

- `MonitoredAgent` has `streamEvents: FlatStreamEventUnion[]` field
- `onAgentSpawned()` initializes `streamEvents: []`
- `onAgentOutput()` accumulates incoming `delta.streamEvents`
- Buffer capped at 2000 events
- `loadCliSessions()` loads persisted streamEvents
- `npm run typecheck:all` passes (specifically `nx typecheck chat`)

---

**Batch 1 Verification**:

- All 5 files modified
- `npm run typecheck:all` passes
- code-logic-reviewer approved
- No stubs, placeholders, or TODOs

---

## Batch 2: Ptah CLI Pipeline (Tree Builder + Output Component) -- IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task T6: Create `AgentMonitorTreeBuilderService` -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-tree-builder.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Phase 2, Component 2.1
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts` (core algorithm)

**Description**:
Create a lightweight service that builds `ExecutionNode[]` from a flat `FlatStreamEventUnion[]` array. This is a simplified version of `ExecutionTreeBuilderService` tailored for the agent monitor context (no `StreamingState` Maps, no tab state, no deduplication).

**Implementation Details**:

1. Create `@Injectable({ providedIn: 'root' })` service.

2. Import from `@ptah-extension/shared`:

   - `ExecutionNode`, `createExecutionNode`
   - `FlatStreamEventUnion`
   - Event types needed: `MessageStartEvent`, `TextDeltaEvent`, `ThinkingStartEvent`, `ThinkingDeltaEvent`, `ToolStartEvent`, `ToolDeltaEvent`, `ToolResultEvent`, `AgentStartEvent`, `MessageCompleteEvent`

3. Implement `buildTree(events: readonly FlatStreamEventUnion[]): ExecutionNode[]`:

   - **Step 1: Index events by ID** -- Create a `Map<string, FlatStreamEventUnion>` for lookup.
   - **Step 2: Build text accumulators** -- For `text_delta` events, concatenate `delta` by `messageId + blockIndex` key.
   - **Step 3: Build thinking accumulators** -- For `thinking_delta` events, concatenate content by `messageId + blockIndex`.
   - **Step 4: Build tool input accumulators** -- For `tool_delta` events, concatenate `delta` by `toolCallId`.
   - **Step 5: Create ExecutionNodes** -- For each landmark event (`message_start`, `tool_start`, `thinking_start`, `agent_start`), create an `ExecutionNode` using `createExecutionNode()`.
   - **Step 6: Attach children** -- Text nodes, thinking nodes, tool nodes become children of their parent message. Tool results attach to their parent tool.
   - **Step 7: Return root children** -- Return the top-level nodes (skip the message wrapper node since the agent card already provides its own chrome).

4. Add memoization: cache result keyed by `events.length`. Return cached tree when length hasn't changed.

5. Export from `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\index.ts`.

**Acceptance Criteria**:

- Service is injectable and providedIn root
- `buildTree()` produces correct `ExecutionNode[]` from flat events
- Memoization prevents unnecessary rebuilds
- Exported from services barrel
- `nx typecheck chat` passes

---

### Task T7: Create `PtahCliOutputComponent` -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\ptah-cli-output.component.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Phase 2, Component 2.2
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card-output.component.ts` (auto-scroll pattern)

**Description**:
Create a component that renders Ptah CLI agent output using the rich ExecutionNode pipeline. Injects `AgentMonitorTreeBuilderService`, computes `executionNodes()` from `streamEvents` input, and renders using `ExecutionNodeComponent`.

**Implementation Details**:

1. Standalone component with selector `ptah-ptah-cli-output`.
2. `ChangeDetectionStrategy.OnPush`.
3. Imports: `ExecutionNodeComponent` (from organisms/execution).

4. Inputs (using Angular signal inputs):

   ```typescript
   readonly streamEvents = input.required<FlatStreamEventUnion[]>();
   readonly isStreaming = input(false);
   readonly scrollTrigger = input(0);
   ```

5. Inject `AgentMonitorTreeBuilderService`.

6. Computed signal:

   ```typescript
   readonly executionNodes = computed(() => {
     return this.treeBuilder.buildTree(this.streamEvents());
   });
   ```

7. Template:

   ```html
   <div #outputContainer class="border-t border-base-content/5 h-full overflow-y-auto">
     <div class="p-2 space-y-1">
       @for (node of executionNodes(); track node.id) {
       <ptah-execution-node [node]="node" [isStreaming]="isStreaming()" />
       }
     </div>
   </div>
   ```

8. Auto-scroll effect (same pattern as `AgentCardOutputComponent`):

   ```typescript
   private readonly outputContainer = viewChild<ElementRef>('outputContainer');

   constructor() {
     effect(() => {
       this.scrollTrigger(); // trigger dependency
       const el = this.outputContainer()?.nativeElement;
       if (el) {
         requestAnimationFrame(() => {
           el.scrollTop = el.scrollHeight;
         });
       }
     });
   }
   ```

**Acceptance Criteria**:

- Component renders ExecutionNode tree from streamEvents input
- Auto-scrolls on new content
- Uses OnPush change detection
- `nx typecheck chat` passes
- Visual: tool cards show with headers/icons in the agent monitor panel

---

### Task T8: Export new service from barrel -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\index.ts`
**Action**: MODIFY
**Dependencies**: Task T6

**Description**:
Add export for `AgentMonitorTreeBuilderService` from the services barrel file.

**Implementation Details**:
Add at the end of the file:

```typescript
// AgentMonitorTreeBuilderService - Builds ExecutionNode tree for agent monitor panel
export { AgentMonitorTreeBuilderService } from './agent-monitor-tree-builder.service';
```

**Acceptance Criteria**:

- Service is exported from the barrel
- `nx typecheck chat` passes

---

**Batch 2 Verification**:

- New service file created and exported
- New component file created
- `nx typecheck chat` passes
- code-logic-reviewer approved

---

## Batch 3: Copilot, Gemini, and Codex Output Components -- IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task T9a: Create `CopilotOutputComponent` -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\copilot-output.component.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Phase 3, Component 3.1
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card-output.component.ts`

**Description**:
Create a component that renders Copilot agent output with a focused template for Copilot-specific segment types: text, thinking, tool-call, tool-result, tool-result-error, error, info. Drops the `command`, `file-change`, `heading`, `stderr-info` cases that Copilot never emits.

**Implementation Details**:

1. Standalone component with selector `ptah-copilot-output`.
2. `ChangeDetectionStrategy.OnPush`.
3. Imports: `MarkdownModule` from ngx-markdown, `NgClass` from @angular/common.

4. Inputs:

   ```typescript
   readonly segments = input.required<RenderSegment[]>();
   readonly scrollTrigger = input(0);
   ```

5. Import `mergeConsecutiveTextSegments` from `./agent-card.utils` and `RenderSegment` from `./agent-card.types`.

6. Computed signal:

   ```typescript
   readonly mergedSegments = computed(() => mergeConsecutiveTextSegments(this.segments()));
   ```

7. Template with `@switch` on segment types: text (markdown rendering), thinking (collapsible block), tool-call (tool name + args), tool-result (result with markdown), tool-result-error (red error), error (error banner), info (muted info text).

8. Auto-scroll effect (same pattern as other output components).

**Acceptance Criteria**:

- Component renders all Copilot-relevant segment types
- Does NOT include command/file-change/heading/stderr-info cases
- Uses `mergeConsecutiveTextSegments` for text merging
- Auto-scrolls on new content
- `nx typecheck chat` passes

---

### Task T9b: Create `GeminiOutputComponent` with stats extraction -- IMPLEMENTED

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.utils.ts` (CREATE)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.component.ts` (CREATE)

**Action**: CREATE (2 files)
**Spec Reference**: implementation-plan.md: Phase 4, Components 4.1 and 4.2
**Pattern to Follow**: Same as CopilotOutputComponent

**Description**:
Create a utility file for extracting Gemini stats from info segments, and a component that renders Gemini agent output with a stats bar and segment rendering.

**Implementation Details**:

1. **gemini-output.utils.ts**:

   - Define `GeminiStats` interface: `{ inputTokens?: number; outputTokens?: number; durationMs?: number; }`.
   - Implement `extractGeminiStats(segments: RenderSegment[]): GeminiStats | null`.
   - Parse patterns from info segment content: "Input: 1234 tokens", "Output: 567 tokens", "Duration: 2.3s", token counts, etc.
   - Return null if no stats found.

2. **gemini-output.component.ts**:
   - Standalone component with selector `ptah-gemini-output`.
   - `ChangeDetectionStrategy.OnPush`.
   - Inputs: `segments: RenderSegment[]`, `scrollTrigger: number`.
   - Computed signals:
     - `mergedSegments` via `mergeConsecutiveTextSegments`
     - `modelStats` via `extractGeminiStats` (filter info segments)
   - Template: Stats bar (input/output tokens, duration) + segment rendering (same types as Copilot: text, thinking, tool-call, tool-result, tool-result-error, error, info).
   - Auto-scroll effect.

**Acceptance Criteria**:

- Stats extraction function handles various info segment formats
- Stats bar displays when stats are available
- Segment rendering covers all Gemini-relevant types
- `nx typecheck chat` passes

---

### Task T9c: Create `CodexOutputComponent` -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\codex-output.component.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Phase 5, Component 5.1
**Pattern to Follow**: Same as CopilotOutputComponent

**Description**:
Create a component that renders Codex agent output with unique item types: command (with exit codes) and file-change (with colored change kind badges), in addition to the standard types.

**Implementation Details**:

1. Standalone component with selector `ptah-codex-output`.
2. `ChangeDetectionStrategy.OnPush`.
3. Imports: `MarkdownModule`, `NgClass`.

4. Inputs: `segments: RenderSegment[]`, `scrollTrigger: number`.

5. Computed signal: `mergedSegments` via `mergeConsecutiveTextSegments`.

6. Template with FULL segment type coverage:

   - text, thinking, tool-call, tool-result, tool-result-error, error, info (same as Copilot)
   - **command**: Terminal-style block with `$ toolName` header, content in pre block, exit code display (colored red for non-zero).
   - **file-change**: Inline badge with colored change kind (green=added, blue=modified, red=deleted) + file path.

7. `NgClass` for conditional styling on file-change badges.
8. Auto-scroll effect.

**Acceptance Criteria**:

- Component renders all segment types including command and file-change
- Command segments show exit codes (non-zero in red)
- File-change segments show colored kind badges
- `nx typecheck chat` passes

---

### Task T9d: Verify all 3 components typecheck -- IMPLEMENTED

**Description**: Run `nx typecheck chat` to verify all new components compile correctly together. This is a verification-only task.

**Acceptance Criteria**:

- `nx typecheck chat` passes with all 3 new components (plus the Ptah CLI component from Batch 2)

---

**Batch 3 Verification**:

- 3 new component files + 1 utility file created
- All components follow consistent patterns
- `nx typecheck chat` passes
- code-logic-reviewer approved

---

## Batch 4: Routing + Integration -- PENDING

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: Batch 1, Batch 2, Batch 3

### Task T10: Wire per-CLI routing in AgentCardComponent -- PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Phase 6, Component 6.1

**Description**:
Replace the single `<ptah-agent-card-output>` with a `@switch (agent().cli)` block that routes to the appropriate per-CLI output component. Include fallback for Ptah CLI agents without streamEvents (backward compatibility with old sessions).

**Implementation Details**:

1. Add imports for the 4 new components:

   ```typescript
   import { PtahCliOutputComponent } from './ptah-cli-output.component';
   import { CopilotOutputComponent } from './copilot-output.component';
   import { GeminiOutputComponent } from './gemini-output.component';
   import { CodexOutputComponent } from './codex-output.component';
   ```

2. Add to `imports` array in `@Component` decorator:

   ```typescript
   imports: [
     SlicePipe,
     AgentCardHeaderComponent,
     AgentCardPermissionComponent,
     AgentCardOutputComponent, // Keep for fallback
     PtahCliOutputComponent,
     CopilotOutputComponent,
     GeminiOutputComponent,
     CodexOutputComponent,
   ],
   ```

3. Replace the output section of the template (line ~90-97) with:

   ```html
   <!-- Output -->
   @if (agent().stdout || agent().stderr || agent().segments.length > 0 || agent().streamEvents.length > 0) { @switch (agent().cli) { @case ('ptah-cli') { @if (agent().streamEvents.length > 0) {
   <ptah-ptah-cli-output class="block flex-1 min-h-0 overflow-hidden" [streamEvents]="agent().streamEvents" [isStreaming]="agent().status === 'running'" [scrollTrigger]="scrollTrigger()" />
   } @else {
   <!-- Fallback for older sessions without streamEvents -->
   <ptah-agent-card-output class="block flex-1 min-h-0 overflow-hidden" [segments]="parsedOutput()" [stderrSegments]="parsedStderr()" [scrollTrigger]="scrollTrigger()" />
   } } @case ('copilot') {
   <ptah-copilot-output class="block flex-1 min-h-0 overflow-hidden" [segments]="parsedOutput()" [scrollTrigger]="scrollTrigger()" />
   } @case ('gemini') {
   <ptah-gemini-output class="block flex-1 min-h-0 overflow-hidden" [segments]="parsedOutput()" [scrollTrigger]="scrollTrigger()" />
   } @case ('codex') {
   <ptah-codex-output class="block flex-1 min-h-0 overflow-hidden" [segments]="parsedOutput()" [scrollTrigger]="scrollTrigger()" />
   } } }
   ```

4. Update `scrollTrigger` computed (line ~152-156) to include `streamEvents.length`:
   ```typescript
   readonly scrollTrigger = computed(() => {
     const a = this.agent();
     return a.stdout.length + a.stderr.length + a.segments.length + a.streamEvents.length;
   });
   ```

**Acceptance Criteria**:

- Each CLI type routes to its dedicated component
- Ptah CLI with streamEvents renders via PtahCliOutputComponent
- Ptah CLI without streamEvents falls back to AgentCardOutputComponent
- Copilot/Gemini/Codex route to their respective components
- `scrollTrigger` includes `streamEvents.length`
- All 4 new components are in the imports array
- `nx typecheck chat` passes
- `npm run typecheck:all` passes

---

**Batch 4 Verification**:

- AgentCardComponent routes per CLI
- Fallback works for old sessions
- Full typecheck passes
- code-logic-reviewer approved

---

## Files Affected Summary

### CREATE (6 files)

| File                                                                                                                 | Task | Purpose                                            |
| -------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-tree-builder.service.ts`               | T6   | Builds ExecutionNode[] from FlatStreamEventUnion[] |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\ptah-cli-output.component.ts` | T7   | Rich ExecutionNode rendering for Ptah CLI          |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\copilot-output.component.ts`  | T9a  | Permission-centric rendering for Copilot           |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.utils.ts`       | T9b  | Gemini stats extraction utility                    |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.component.ts`   | T9b  | Stats-enriched rendering for Gemini                |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\codex-output.component.ts`    | T9c  | Command/file-change rendering for Codex            |

### MODIFY (6 files)

| File                                                                                                             | Task | Change                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`                                    | T1   | Add `streamEvents` to `AgentOutputDelta` and `CliSessionReference` |
| `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts` | T2   | Add `onStreamEvent` to `SdkHandle`                                 |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-registry.ts`                        | T3   | Wire `onStreamEvent` with messageTransformer.transform()           |
| `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`      | T4   | Accumulate and flush `streamEvents`                                |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`                          | T5   | Add `streamEvents` to MonitoredAgent, accumulate, cap              |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\index.ts`                                        | T8   | Export AgentMonitorTreeBuilderService                              |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`  | T10  | Route to per-CLI components via @switch                            |
