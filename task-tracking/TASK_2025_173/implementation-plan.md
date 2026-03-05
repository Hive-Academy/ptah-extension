# Implementation Plan - TASK_2025_173: Per-CLI Rendering Pipelines for Agent Monitor Panel

## Codebase Investigation Summary

### Libraries Analyzed

- **shared** (`D:\projects\ptah-extension\libs\shared\src\lib\types\`)
  - `agent-process.types.ts`: `CliType`, `CliOutputSegment`, `AgentOutputDelta`, `AgentProcessInfo`
  - `execution-node.types.ts`: `ExecutionNode`, `FlatStreamEventUnion` (17+ event types), `createExecutionNode`
- **chat** (`D:\projects\ptah-extension\libs\frontend\chat\src\lib\`)
  - `services/agent-monitor.store.ts`: `MonitoredAgent`, signal-based store
  - `services/execution-tree-builder.service.ts`: Builds `ExecutionNode[]` from `StreamingState`
  - `services/agent-monitor-message-handler.service.ts`: Routes webview messages to store
  - `components/molecules/agent-card/`: 6 files (component, header, output, permission, types, utils)
  - `components/organisms/execution/`: `execution-node.component.ts`, `inline-agent-bubble.component.ts`
  - `components/molecules/tool-execution/`: 7 files (tool-call-item, tool-call-header, tool-input-display, tool-output-display, code-output, diff-display, todo-list-display)
- **agent-sdk** (`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\`)
  - `ptah-cli-adapter.ts`: Produces `FlatStreamEventUnion` via `SdkMessageTransformer`
  - `ptah-cli-registry.ts`: Creates `SdkHandle` that wraps PtahCliAdapter stream
- **llm-abstraction** (`D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\`)
  - `agent-process-manager.service.ts`: Manages agent lifecycle, throttled output emission
  - `cli-adapters/cli-adapter.interface.ts`: `SdkHandle`, `CliAdapter`, `CliCommandOptions`
- **vscode app** (`D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\`)
  - `rpc-method-registration.service.ts`: Wires `agent:output` events to webview via `broadcastMessage`

### Key Patterns Identified

**Pattern 1: Signal-based immutable store updates**

- Evidence: `agent-monitor.store.ts:163-211` (onAgentOutput creates new Map + spread-copied agents)
- All state mutations create new objects; Angular OnPush detects changes via signal reads

**Pattern 2: Throttled output flushing (200ms)**

- Evidence: `agent-process-manager.service.ts:54,878-927` (accumulateDelta/accumulateSegment/flushDelta)
- Backend batches stdout + stderr + segments into 200ms intervals before emitting `agent:output`

**Pattern 3: ExecutionNode tree built at render time**

- Evidence: `execution-tree-builder.service.ts:1-16` (comment: "builds ExecutionNode tree AT RENDER TIME from flat events")
- StreamingState stores flat events in Maps; tree is computed lazily

**Pattern 4: Component-per-type rendering via @switch**

- Evidence: `execution-node.component.ts:50-105` (`@switch (node().type)` routes to different components)
- Evidence: `agent-card-output.component.ts:32-240` (`@switch (segment.type)` for segment rendering)

**Pattern 5: SdkHandle callback interface for adapters**

- Evidence: `cli-adapter.interface.ts:48-59` (`onOutput`, `onSegment` callbacks)
- Backend wires these to `appendBuffer` and `accumulateSegment` respectively

### Critical Finding: FlatStreamEventUnion Data Path

The Ptah CLI adapter (`ptah-cli-adapter.ts:894-1010`) already produces `FlatStreamEventUnion` events via `SdkMessageTransformer.transform()`. However, the `PtahCliRegistry` (`ptah-cli-registry.ts`) wraps this into an `SdkHandle` that only exposes `onOutput` (raw text) and `onSegment` (`CliOutputSegment`). The rich `FlatStreamEventUnion` events are **never forwarded** to the frontend.

The key backend change is adding an `onStreamEvent` callback to `SdkHandle` so that `AgentProcessManager` can accumulate and forward `FlatStreamEventUnion` events alongside (not replacing) the existing `CliOutputSegment` pipeline.

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Component-per-CLI routing with data-path enhancement

**Rationale**: Each CLI has fundamentally different streaming formats, event semantics, and UI requirements. A single polymorphic component would accumulate too many `@if` branches. The component-per-CLI pattern matches the existing `@switch (node().type)` pattern used in `execution-node.component.ts`.

**Evidence**: `execution-node.component.ts:50-105` uses `@switch` to route to specialized components per node type. We apply the same pattern at the CLI level.

### Data Flow Overview

```
CURRENT (all CLIs identical):
  Backend: SdkHandle.onSegment() -> accumulateSegment() -> flushDelta()
  Wire:    agent:output { segments: CliOutputSegment[] } -> webview
  Store:   MonitoredAgent.segments: CliOutputSegment[]
  Render:  AgentCardOutputComponent (flat @switch on segment.type)

NEW (per-CLI):
  Backend (Ptah CLI ONLY - new path):
    SdkHandle.onStreamEvent() -> accumulateStreamEvent() -> flushDelta()
    agent:output { streamEvents: FlatStreamEventUnion[] } -> webview
  Store:   MonitoredAgent.streamEvents: FlatStreamEventUnion[]  (new field, Ptah CLI only)
  Render:  @switch (agent.cli):
    'ptah-cli' -> PtahCliOutputComponent -> ExecutionTreeBuilder -> ExecutionNodeComponent
    'copilot'  -> CopilotOutputComponent (segments + permission)
    'gemini'   -> GeminiOutputComponent (segments + stats)
    'codex'    -> CodexOutputComponent (segments + unique item types)

  Backend (Copilot/Gemini/Codex - unchanged):
    SdkHandle.onSegment() -> accumulateSegment() -> flushDelta()
    agent:output { segments: CliOutputSegment[] } -> webview
  Store:   MonitoredAgent.segments: CliOutputSegment[]  (unchanged)
  Render:  Each CLI's dedicated component consumes CliOutputSegment[]
```

---

## Phase 1: Infrastructure (Shared Types + Backend Changes)

### Component 1.1: Enhance `AgentOutputDelta` type

**Purpose**: Add optional `streamEvents` field to carry `FlatStreamEventUnion[]` for Ptah CLI agents.

**Pattern**: Additive type extension (same as `segments` was added as optional field).
**Evidence**: `agent-process.types.ts:209-211` shows `segments` is already optional on `AgentOutputDelta`.

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`
**Action**: MODIFY

**Change**:

```typescript
export interface AgentOutputDelta {
  readonly agentId: AgentId;
  readonly stdoutDelta: string;
  readonly stderrDelta: string;
  readonly timestamp: number;
  /** Structured output segments from SDK-based adapters (optional) */
  readonly segments?: readonly CliOutputSegment[];
  /** Rich streaming events from Ptah CLI adapter (optional — only ptah-cli uses this) */
  readonly streamEvents?: readonly FlatStreamEventUnion[];
}
```

Also add `streamEvents` to `CliSessionReference` for persistence:

```typescript
export interface CliSessionReference {
  // ... existing fields ...
  readonly segments?: readonly CliOutputSegment[];
  /** Persisted rich streaming events (Ptah CLI only). Absent in older sessions. */
  readonly streamEvents?: readonly FlatStreamEventUnion[];
}
```

### Component 1.2: Enhance `SdkHandle` interface

**Purpose**: Add `onStreamEvent` callback so `AgentProcessManager` can receive `FlatStreamEventUnion` events from Ptah CLI.

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts`
**Action**: MODIFY

**Change**:

```typescript
export interface SdkHandle {
  readonly abort: AbortController;
  readonly done: Promise<number>;
  readonly onOutput: (callback: (data: string) => void) => void;
  readonly onSegment?: (callback: (segment: CliOutputSegment) => void) => void;
  readonly getSessionId?: () => string | undefined;
  /** Register a callback to receive rich FlatStreamEventUnion events.
   *  Only Ptah CLI adapter implements this. Enables full ExecutionNode rendering. */
  readonly onStreamEvent?: (callback: (event: FlatStreamEventUnion) => void) => void;
}
```

### Component 1.3: Wire `onStreamEvent` in PtahCliRegistry

**Purpose**: When `PtahCliRegistry` creates an `SdkHandle` from a `PtahCliAdapter` stream, it must expose the `FlatStreamEventUnion` events via the new `onStreamEvent` callback.

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-registry.ts`
**Action**: MODIFY

**Key change**: In the method that creates `SdkHandle` from the adapter's `AsyncIterable<FlatStreamEventUnion>`, add an `onStreamEvent` field that accumulates callbacks and invokes them as events arrive from the stream iterator. The existing `onSegment` pipeline continues to work alongside.

```typescript
// Pseudocode for the SdkHandle creation:
const streamEventCallbacks: ((event: FlatStreamEventUnion) => void)[] = [];

const handle: SdkHandle = {
  // ... existing abort, done, onOutput, onSegment ...
  onStreamEvent: (cb) => {
    streamEventCallbacks.push(cb);
  },
};

// In the stream iteration loop (already exists):
for await (const event of adapterStream) {
  // Existing: convert to text + CliOutputSegment for onOutput/onSegment
  // NEW: also forward raw event
  for (const cb of streamEventCallbacks) {
    cb(event);
  }
}
```

### Component 1.4: Wire `onStreamEvent` in AgentProcessManager

**Purpose**: When tracking an SDK handle, if `onStreamEvent` is available, accumulate events and include them in the throttled `flushDelta()` emission.

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Action**: MODIFY

**Changes**:

1. Add `streamEvents: FlatStreamEventUnion[]` to the `pendingDeltas` type and `TrackedAgent.accumulatedStreamEvents`:

```typescript
// In pendingDeltas map value type:
private readonly pendingDeltas = new Map<
  string,
  { stdout: string; stderr: string; segments: CliOutputSegment[]; streamEvents: FlatStreamEventUnion[] }
>();
```

2. In `trackSdkHandle()`, wire `onStreamEvent`:

```typescript
if (sdkHandle.onStreamEvent) {
  sdkHandle.onStreamEvent((event: FlatStreamEventUnion) => {
    this.accumulateStreamEvent(agentId, event);
  });
}
```

3. Add `accumulateStreamEvent()` method (mirrors `accumulateSegment()`):

```typescript
private accumulateStreamEvent(agentId: string, event: FlatStreamEventUnion): void {
  let pending = this.pendingDeltas.get(agentId);
  if (!pending) {
    pending = { stdout: '', stderr: '', segments: [], streamEvents: [] };
    this.pendingDeltas.set(agentId, pending);
  }
  pending.streamEvents.push(event);
  // ... start flush timer if not running ...
}
```

4. In `flushDelta()`, include `streamEvents` in the emitted delta:

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

### Component 1.5: Enhance `MonitoredAgent` in AgentMonitorStore

**Purpose**: Add `streamEvents: FlatStreamEventUnion[]` field for accumulating raw SDK events on the frontend.

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`
**Action**: MODIFY

**Changes to `MonitoredAgent` interface**:

```typescript
export interface MonitoredAgent {
  // ... existing fields ...
  segments: CliOutputSegment[];
  /** Rich streaming events from Ptah CLI adapter. Enables ExecutionNode rendering. */
  streamEvents: FlatStreamEventUnion[];
  // ... rest ...
}
```

**Changes to `onAgentSpawned()`**: Initialize `streamEvents: []`

**Changes to `onAgentOutput()`**: Accumulate incoming `delta.streamEvents` into the agent's `streamEvents` array:

```typescript
if (delta.streamEvents && delta.streamEvents.length > 0) {
  updated.streamEvents = [...existing.streamEvents, ...delta.streamEvents];
}
```

**Changes to `loadCliSessions()`**: Load persisted `streamEvents` from `CliSessionReference`.

### Component 1.6: Cap streamEvents buffer

**Purpose**: Prevent unbounded memory growth for long-running Ptah CLI agents.

**Design**: Cap at 2000 events. When exceeded, drop oldest events but keep all `message_start`, `tool_start`, `agent_start` landmark events (they establish tree structure). Drop `text_delta`, `thinking_delta`, `tool_delta` events from the beginning.

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`
**Action**: MODIFY (add capping logic in `onAgentOutput`)

---

## Phase 2: Ptah CLI Pipeline (Highest Value)

### Component 2.1: AgentMonitorTreeBuilder service

**Purpose**: Lightweight service that builds `ExecutionNode[]` from a flat `FlatStreamEventUnion[]` array. This is a simplified version of `ExecutionTreeBuilderService` tailored for the agent monitor context (no `StreamingState` Maps, no tab state, no deduplication).

**Why not reuse `ExecutionTreeBuilderService` directly**: The existing service (`execution-tree-builder.service.ts`, 63KB) operates on `StreamingState` which requires Maps for `events`, `messageEventIds`, `toolCallMap`, `textAccumulators`, `toolInputAccumulators`, etc. It is deeply coupled to the chat tab model. Building a lightweight wrapper is cleaner.

**Pattern**: Pure function + injectable service wrapper.
**Evidence**: `createExecutionNode()` factory from `execution-node.types.ts:630-640`.

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-tree-builder.service.ts`
**Action**: CREATE

**Responsibilities**:

- Accept `FlatStreamEventUnion[]` array
- Build lookup maps (event ID -> event, tool call ID -> child event IDs, text accumulators)
- Produce `ExecutionNode[]` tree (same structure as main chat)
- Memoize: cache result keyed by `streamEvents.length` (same optimization as `ExecutionTreeBuilderService`)

**API**:

```typescript
@Injectable({ providedIn: 'root' })
export class AgentMonitorTreeBuilderService {
  /**
   * Build ExecutionNode tree from flat streaming events.
   * Returns root-level nodes (text, thinking, tool, agent).
   */
  buildTree(events: readonly FlatStreamEventUnion[]): ExecutionNode[];
}
```

**Algorithm** (mirrors core logic from `ExecutionTreeBuilderService.buildTree()`):

1. Index events by ID into a Map
2. Build text accumulators (concatenate `text_delta.delta` by `messageId + blockIndex`)
3. Build tool input accumulators (concatenate `tool_delta.delta` by `toolCallId`)
4. Create ExecutionNodes for each landmark event (`message_start`, `tool_start`, `thinking_start`, `agent_start`)
5. Attach text nodes, thinking nodes, tool nodes as children of their parent message
6. Attach tool results to tool nodes
7. Return flattened root children (skip the message wrapper - agent card already has its own chrome)

**Reuse**: The core tree-building algorithm from `ExecutionTreeBuilderService` lines 100-400 (node creation, child attachment, status resolution). Extract shared logic into pure functions if beneficial, or duplicate the ~200 lines of core logic for simplicity.

### Component 2.2: PtahCliOutputComponent

**Purpose**: Renders Ptah CLI agent output using the rich ExecutionNode pipeline.

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\ptah-cli-output.component.ts`
**Action**: CREATE

**Pattern**: Composition of existing execution components.
**Evidence**: `execution-node.component.ts` already renders `ExecutionNode` trees recursively.

**Template structure**:

```html
<div #outputContainer class="border-t border-base-content/5 h-full overflow-y-auto">
  <div class="p-2 space-y-1">
    @for (node of executionNodes(); track node.id) {
    <ptah-execution-node [node]="node" [isStreaming]="isStreaming()" />
    }
  </div>
</div>
```

**Inputs**:

- `streamEvents: FlatStreamEventUnion[]` - Raw events from MonitoredAgent
- `isStreaming: boolean` - Whether the agent is still running
- `scrollTrigger: number` - Triggers auto-scroll

**Computed signals**:

```typescript
private readonly treeBuilder = inject(AgentMonitorTreeBuilderService);

readonly executionNodes = computed(() => {
  return this.treeBuilder.buildTree(this.streamEvents());
});
```

**Styling**: Scale down from main chat sizing. Use `agent-prose` class (already exists in agent-card context) for 10-11px text. The execution-node components render at their default size, which is already compact (`text-[11px]`, `text-xs`, `prose-sm`).

**Auto-scroll**: Same pattern as `AgentCardOutputComponent` - `effect()` that reads signals and scrolls container.

**Imports**: `ExecutionNodeComponent`, `MarkdownModule`.

### Component 2.3: Fallback handling

**Purpose**: When a Ptah CLI agent has no `streamEvents` (e.g., loaded from an older session before this feature), fall back to the existing `AgentCardOutputComponent` rendering.

**Logic in AgentCardComponent**:

```html
@if (agent().cli === 'ptah-cli' && agent().streamEvents.length > 0) {
<ptah-ptah-cli-output [streamEvents]="agent().streamEvents" [isStreaming]="agent().status === 'running'" [scrollTrigger]="scrollTrigger()" />
} @else {
<ptah-agent-card-output ... />
}
```

---

## Phase 3: Copilot Pipeline

### Component 3.1: CopilotOutputComponent

**Purpose**: Renders Copilot agent output with permission-centric display tailored to Copilot's streaming format.

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\copilot-output.component.ts`
**Action**: CREATE

**Copilot streaming specifics** (from investigation of Copilot adapter):

- Segment types used: `text`, `thinking`, `tool-call`, `tool-result`, `tool-result-error`, `error`, `info`
- Permission requests come via separate `AgentPermissionRequest` (already handled by `AgentCardPermissionComponent`)
- Tool display is simpler than Ptah CLI (no typed `toolInput` objects, just `toolName` + `toolArgs` strings)

**Template structure**:

```html
<div #outputContainer class="border-t border-base-content/5 h-full overflow-y-auto">
  <div class="p-2 space-y-1.5">
    @for (segment of mergedSegments(); track $index) { @switch (segment.type) { @case ('text') { /* markdown rendering */ } @case ('thinking') { /* collapsible thinking block */ } @case ('tool-call') {
    <!-- Copilot-specific: emphasize tool name + args, no typed input -->
    <div class="bg-base-200/60 rounded border ...">
      <div class="flex items-center gap-1.5 px-2 py-1">
        <span class="text-[10px] font-medium text-info">Tool:</span>
        <code class="text-[10px] font-mono text-accent">{{ segment.toolName }}</code>
        @if (segment.toolArgs) {
        <span class="text-[10px] text-base-content/40 ...">{{ segment.toolArgs }}</span>
        }
      </div>
    </div>
    } @case ('tool-result') { /* result with markdown */ } @case ('tool-result-error') { /* red error result */ } @case ('error') { /* error banner */ } @case ('info') { /* muted info text */ } } }
  </div>
</div>
```

**Inputs**:

- `segments: CliOutputSegment[]`
- `scrollTrigger: number`

**Computed signals**:

```typescript
readonly mergedSegments = computed(() => {
  return mergeConsecutiveTextSegments(this.segments());
});
```

**Key difference from generic output**: Copilot output removes the `command`, `file-change`, `heading`, `stderr-info` cases (Copilot never emits these). The template is cleaner and more focused.

---

## Phase 4: Gemini CLI Pipeline

### Component 4.1: GeminiOutputComponent

**Purpose**: Renders Gemini CLI agent output with stats display and structured tool I/O.

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.component.ts`
**Action**: CREATE

**Gemini streaming specifics** (from investigation of Gemini adapter):

- Segment types used: `text`, `thinking`, `tool-call`, `tool-result`, `tool-result-error`, `error`, `info`
- `info` segments carry model stats (tokens, duration)
- Tool calls have `toolName` and `toolArgs` (JSON stringified)
- No file-change or command segments

**Template structure**: Similar to Copilot but adds:

1. **Stats bar**: Extract token/duration info from `info`-type segments that match stats patterns
2. **Tool I/O display**: Parse `toolArgs` JSON for structured display when possible

```html
<!-- Stats summary (extracted from info segments) -->
@if (modelStats()) {
<div class="flex items-center gap-3 px-2 py-1 bg-base-200/40 border-b border-base-content/5">
  @if (modelStats()!.inputTokens) {
  <span class="text-[9px] text-base-content/40"> In: {{ modelStats()!.inputTokens | number }} </span>
  } @if (modelStats()!.outputTokens) {
  <span class="text-[9px] text-base-content/40"> Out: {{ modelStats()!.outputTokens | number }} </span>
  } @if (modelStats()!.durationMs) {
  <span class="text-[9px] text-base-content/40"> {{ (modelStats()!.durationMs / 1000).toFixed(1) }}s </span>
  }
</div>
}
<!-- Segments (same structure as Copilot but with Gemini-specific refinements) -->
```

**Inputs**:

- `segments: CliOutputSegment[]`
- `scrollTrigger: number`

**Computed signals**:

```typescript
/** Extract stats from info segments that look like token/duration reports */
readonly modelStats = computed(() => {
  const infoSegments = this.segments().filter(s => s.type === 'info');
  // Parse patterns like "Input: 1234 tokens" "Output: 567 tokens" "Duration: 2.3s"
  return extractGeminiStats(infoSegments);
});
```

---

## Phase 5: Codex CLI Pipeline

### Component 5.1: CodexOutputComponent

**Purpose**: Renders Codex CLI agent output with unique item types (command_execution, file_change, todo_list, web_search, mcp_tool_call).

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\codex-output.component.ts`
**Action**: CREATE

**Codex streaming specifics** (from investigation of Codex adapter):

- Segment types used: `text`, `thinking`, `tool-call`, `tool-result`, `tool-result-error`, `error`, `info`, `command`, `file-change`
- `command` segments have `exitCode` (unique to Codex)
- `file-change` segments have `changeKind` ('added', 'modified', 'deleted')
- These are already defined in `CliOutputSegmentType` and `CliOutputSegment`

**Template structure**: Most comprehensive of the 4 CLIs:

```html
<div #outputContainer class="border-t border-base-content/5 h-full overflow-y-auto">
  <div class="p-2 space-y-1.5">
    @for (segment of mergedSegments(); track $index) { @switch (segment.type) { @case ('text') { /* markdown */ } @case ('thinking') { /* collapsible thinking */ } @case ('tool-call') { /* generic tool display */ } @case ('tool-result') { /* result with markdown */ } @case ('tool-result-error') { /* error result */ } @case ('command') {
    <!-- Codex-specific: terminal-style command with exit code -->
    <div class="bg-neutral/80 rounded border border-base-content/10 overflow-hidden">
      <div class="px-2 py-1">
        <pre class="text-[10px] font-mono text-neutral-content ...">$ {{ segment.toolName }}</pre>
      </div>
      @if (segment.content) {
      <div class="border-t border-base-content/10 px-2 py-1 max-h-24 overflow-y-auto">
        <pre class="text-[10px] font-mono text-base-content/60 ...">{{ segment.content }}</pre>
      </div>
      } @if (segment.exitCode !== undefined && segment.exitCode !== 0) {
      <div class="border-t border-error/20 px-2 py-0.5 bg-error/10">
        <span class="text-[10px] font-mono text-error">exit {{ segment.exitCode }}</span>
      </div>
      }
    </div>
    } @case ('file-change') {
    <!-- Codex-specific: file change with colored kind badge -->
    <div class="inline-flex items-center gap-1 bg-base-200/50 rounded px-1.5 py-0.5 ...">
      <span
        class="text-[9px] font-semibold uppercase tracking-wider"
        [ngClass]="{
                'text-success': segment.changeKind === 'added',
                'text-info': segment.changeKind === 'modified',
                'text-error': segment.changeKind === 'deleted'
              }"
        >{{ segment.changeKind }}</span
      >
      <code class="text-[10px] font-mono text-base-content/70">{{ segment.content }}</code>
    </div>
    } @case ('error') { /* error banner */ } @case ('info') { /* muted info */ } } }
  </div>
</div>
```

**Inputs**:

- `segments: CliOutputSegment[]`
- `scrollTrigger: number`

**Note**: The `command` and `file-change` rendering is extracted from the current `AgentCardOutputComponent` which already handles these types. The Codex component keeps them; the Copilot/Gemini components drop them.

---

## Phase 6: Routing + Migration

### Component 6.1: Modify AgentCardComponent to route per CLI

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`
**Action**: MODIFY

**Changes**:

1. Import the 4 new output components
2. Replace the single `<ptah-agent-card-output>` with a `@switch (agent().cli)` block:

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

3. Update imports array to include all 4 new components
4. Add `streamEvents` to `scrollTrigger` computation:

```typescript
readonly scrollTrigger = computed(() => {
  const a = this.agent();
  return a.stdout.length + a.stderr.length + a.segments.length + a.streamEvents.length;
});
```

### Component 6.2: Keep AgentCardOutputComponent as fallback

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card-output.component.ts`
**Action**: NO CHANGE (retained as-is for backward compatibility)

The component is still used:

- As fallback for Ptah CLI agents loaded from older sessions (no `streamEvents`)
- Could be used if a new CLI type is added in the future before its dedicated component exists

---

## Files Affected Summary

### CREATE (7 files)

| File                                                                                                                 | Purpose                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-tree-builder.service.ts`               | Builds ExecutionNode[] from FlatStreamEventUnion[] for agent card context |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\ptah-cli-output.component.ts` | Rich ExecutionNode rendering for Ptah CLI agents                          |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\copilot-output.component.ts`  | Permission-centric rendering for Copilot agents                           |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.component.ts`   | Stats-enriched rendering for Gemini CLI agents                            |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\codex-output.component.ts`    | Command/file-change rendering for Codex agents                            |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.utils.ts`       | Pure function to extract stats from Gemini info segments                  |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\copilot-output.utils.ts`      | (Optional) Copilot-specific parsing utilities if needed                   |

### MODIFY (8 files)

| File                                                                                                             | Change                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`                                    | Add `streamEvents` to `AgentOutputDelta` and `CliSessionReference`                   |
| `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts` | Add `onStreamEvent` to `SdkHandle`                                                   |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-registry.ts`                        | Wire `onStreamEvent` callback in SdkHandle creation                                  |
| `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`      | Wire `onStreamEvent`, accumulate, flush `streamEvents`                               |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`                          | Add `streamEvents` field to `MonitoredAgent`, accumulate in `onAgentOutput`          |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`  | Route to per-CLI components via `@switch`                                            |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\index.ts`                                        | Export `AgentMonitorTreeBuilderService`                                              |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.utils.ts`      | Extract reusable `mergeConsecutiveTextSegments` (already exported, no change needed) |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developers**: Both backend-developer AND frontend-developer

**Rationale**:

- Phase 1 requires backend changes (TypeScript types, process manager, registry) = **backend-developer**
- Phases 2-6 are frontend Angular components = **frontend-developer**

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 16-24 hours

**Breakdown**:

- Phase 1 (Infrastructure): 4-6 hours
- Phase 2 (Ptah CLI Pipeline): 6-8 hours (most complex - tree builder + component)
- Phase 3 (Copilot Pipeline): 2-3 hours
- Phase 4 (Gemini Pipeline): 2-3 hours
- Phase 5 (Codex Pipeline): 2-3 hours
- Phase 6 (Routing): 1-2 hours

### Task Breakdown for Team-Leader (MODE 1)

#### Phase 1 Tasks (Backend)

**Task 1.1**: Add `streamEvents` field to `AgentOutputDelta` and `CliSessionReference`

- File: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`
- Import `FlatStreamEventUnion` from same package (already in `execution-node.types.ts`)
- Verify: `npm run typecheck:all` passes

**Task 1.2**: Add `onStreamEvent` to `SdkHandle` interface

- File: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts`
- Import `FlatStreamEventUnion` from `@ptah-extension/shared`
- Verify: `npm run typecheck:all` passes

**Task 1.3**: Wire `onStreamEvent` in PtahCliRegistry's SdkHandle creation

- File: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-registry.ts`
- Find the method that creates `SdkHandle` from `PtahCliAdapter.startChatSession()` stream
- Add `streamEventCallbacks` array, expose via `onStreamEvent`, invoke in stream loop
- Verify: `npm run typecheck:all` passes

**Task 1.4**: Wire `onStreamEvent` in AgentProcessManager

- File: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
- Add `streamEvents: FlatStreamEventUnion[]` to pending deltas type
- Add `accumulateStreamEvent()` method
- Wire in `trackSdkHandle()` method
- Include `streamEvents` in `flushDelta()` emission
- Verify: `npm run typecheck:all` passes

**Task 1.5**: Add `streamEvents` to `MonitoredAgent` and store logic

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`
- Add field to interface, initialize in `onAgentSpawned`, accumulate in `onAgentOutput`, load in `loadCliSessions`
- Add buffer cap (2000 events, drop oldest deltas, keep landmarks)
- Verify: `npm run typecheck:all` passes

#### Phase 2 Tasks (Frontend - Ptah CLI)

**Task 2.1**: Create `AgentMonitorTreeBuilderService`

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-tree-builder.service.ts`
- Implement `buildTree(events: readonly FlatStreamEventUnion[]): ExecutionNode[]`
- Core algorithm: index events -> build accumulators -> create nodes -> attach children -> return roots
- Reference: `execution-tree-builder.service.ts` lines 100-400 for node creation logic
- Add export to `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\index.ts`
- Verify: Write unit test, `nx test chat` passes

**Task 2.2**: Create `PtahCliOutputComponent`

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\ptah-cli-output.component.ts`
- Inject `AgentMonitorTreeBuilderService`
- Inputs: `streamEvents`, `isStreaming`, `scrollTrigger`
- Computed: `executionNodes()` via tree builder
- Template: `@for` over nodes, render with `<ptah-execution-node>`
- Auto-scroll effect
- Verify: Component renders in browser, tool cards show with headers/icons

#### Phase 3 Tasks (Frontend - Copilot)

**Task 3.1**: Create `CopilotOutputComponent`

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\copilot-output.component.ts`
- Inputs: `segments: CliOutputSegment[]`, `scrollTrigger: number`
- Template: `@switch` on segment types (text, thinking, tool-call, tool-result, tool-result-error, error, info)
- Import `mergeConsecutiveTextSegments` from `agent-card.utils.ts`
- Auto-scroll effect
- Verify: Copilot agent output renders with correct segment types

#### Phase 4 Tasks (Frontend - Gemini)

**Task 4.1**: Create Gemini stats extraction utility

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.utils.ts`
- Pure function `extractGeminiStats(infoSegments: CliOutputSegment[]): GeminiStats | null`
- Parse patterns: token counts, duration, model info from info segment content

**Task 4.2**: Create `GeminiOutputComponent`

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\gemini-output.component.ts`
- Inputs: `segments: CliOutputSegment[]`, `scrollTrigger: number`
- Computed: `modelStats()` via `extractGeminiStats()`
- Template: Stats bar + segment rendering
- Verify: Gemini agent output shows stats and segments

#### Phase 5 Tasks (Frontend - Codex)

**Task 5.1**: Create `CodexOutputComponent`

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\codex-output.component.ts`
- Inputs: `segments: CliOutputSegment[]`, `scrollTrigger: number`
- Template: Full segment type coverage including `command` (exit codes) and `file-change` (change kinds)
- Import `NgClass` for conditional styling
- Verify: Codex agent output shows commands with exit codes and file changes with colored badges

#### Phase 6 Tasks (Integration)

**Task 6.1**: Wire routing in AgentCardComponent

- File: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`
- Add imports for all 4 new components
- Replace `<ptah-agent-card-output>` with `@switch (agent().cli)` block
- Update `scrollTrigger` to include `streamEvents.length`
- Verify: Each CLI type renders with its dedicated component, fallback works for old sessions

**Task 6.2**: End-to-end verification

- Spawn a Ptah CLI agent -> verify rich tool rendering (file paths, diffs, todo progress)
- Spawn a Copilot agent -> verify permission-centric display
- Spawn a Gemini agent -> verify stats bar and tool display
- Spawn a Codex agent -> verify command execution and file change display
- Load an old session -> verify fallback to generic output

---

## Risk Analysis

### Risk 1: FlatStreamEventUnion serialization size

**Risk**: `FlatStreamEventUnion` events are larger than `CliOutputSegment` (they include `sessionId`, `messageId`, `timestamp`, `source`, etc.). For agents with 1000+ tool calls, the delta payloads could be significant.

**Mitigation**: The 200ms throttle in `AgentProcessManager` already batches events. Additionally, `streamEvents` is only populated for `ptah-cli` agents (the other 3 CLIs use the existing lightweight `segments` path). The frontend cap of 2000 events prevents unbounded memory growth.

### Risk 2: Tree rebuilding performance on every signal change

**Risk**: `AgentMonitorTreeBuilderService.buildTree()` runs inside a `computed()` signal. With 2000 events, rebuilding the tree on every new event batch could be expensive.

**Mitigation**: Memoize by event count (same pattern as `ExecutionTreeBuilderService`'s cache). Only rebuild when `events.length` changes. Tree building is O(n) where n = event count; 2000 events should build in < 5ms.

### Risk 3: ExecutionNode component size mismatch

**Risk**: The main chat `ExecutionNodeComponent` and its children (`ToolCallItemComponent`, etc.) are designed for the full chat panel width (~700px+). In the agent monitor sidebar (~460-640px), they may overflow or look cramped.

**Mitigation**: The execution components already use responsive sizing (`text-[11px]`, `text-xs`, `prose-sm`). The agent monitor panel has `min-width: 300px` and responsive widths up to 640px. Testing is needed but the components should work without modification. If adjustments are needed, CSS can be scoped via a wrapper class.

### Risk 4: Circular dependency between chat services

**Risk**: `AgentMonitorTreeBuilderService` imports from `@ptah-extension/shared` (for `FlatStreamEventUnion`, `ExecutionNode`, `createExecutionNode`). These are foundation types with no circular dependency risk. The service does NOT import from `execution-tree-builder.service.ts` (the main chat tree builder) to avoid coupling.

**Mitigation**: Keep `AgentMonitorTreeBuilderService` self-contained. It shares no state with the main chat tree builder. Both import the same types from `@ptah-extension/shared`.

### Risk 5: Backward compatibility for session persistence

**Risk**: Old `CliSessionReference` objects (from before this feature) have no `streamEvents` field. Loading them should not crash.

**Mitigation**: The `streamEvents` field is optional (`readonly streamEvents?: ...`). The `loadCliSessions()` method initializes `streamEvents: ref.streamEvents ? [...ref.streamEvents] : []`. Old sessions fall back to the generic output component.

---

## Performance Considerations

### Throttled event delivery (200ms)

The existing 200ms flush interval in `AgentProcessManager` naturally batches `streamEvents`. During rapid streaming (e.g., 100 events/second), the frontend receives ~5 batches/second with ~20 events each. This prevents Angular change detection from firing per-event.

### Memoized tree building

The `AgentMonitorTreeBuilderService` caches its result keyed by `events.length`. Since `computed()` only re-evaluates when dependencies change, and `streamEvents` only changes on new batches from the store, tree rebuilding happens at most 5 times/second during active streaming.

### Virtual scrolling consideration

For agents with 100+ tool calls, the rendered DOM could have thousands of nodes. The current implementation does NOT use virtual scrolling (neither does the main chat). For the agent monitor's constrained height (55vh), this is acceptable. If performance issues arise, `@angular/cdk/scrolling` virtual scroll could be added as a future optimization.

### Memory budget

- `FlatStreamEventUnion` events: ~200-500 bytes each
- Cap at 2000 events: ~400KB-1MB per agent
- `ExecutionNode` tree: roughly same size as events (no duplication, just restructured)
- With max 2 expanded agent cards, total memory impact: < 2-4MB

### Signal granularity

The `MonitoredAgent.streamEvents` array is replaced on each update (immutable). Angular's OnPush change detection efficiently skips re-renders when the signal hasn't changed. The `computed()` for `executionNodes` only recomputes when `streamEvents` length changes (via memoization).

---

## Critical Verification Points

**Before Implementation, Developers Must Verify**:

1. **All imports exist in codebase**:

   - `FlatStreamEventUnion` from `@ptah-extension/shared` (verified: `execution-node.types.ts:1032`)
   - `ExecutionNode` from `@ptah-extension/shared` (verified: `execution-node.types.ts:110`)
   - `createExecutionNode` from `@ptah-extension/shared` (verified: `execution-node.types.ts:630`)
   - `CliOutputSegment` from `@ptah-extension/shared` (verified: `agent-process.types.ts:187`)
   - `ExecutionNodeComponent` from chat library (verified: `execution-node.component.ts:38`)
   - `mergeConsecutiveTextSegments` from `agent-card.utils.ts` (verified: line 241)
   - `MarkdownModule` from `ngx-markdown` (verified: used in multiple components)

2. **All patterns verified from examples**:

   - Signal-based store with immutable updates: `agent-monitor.store.ts:163-211`
   - Computed tree building: `execution-tree-builder.service.ts:1-16`
   - Component-per-type routing: `execution-node.component.ts:50-105`
   - Auto-scroll effect: `agent-card-output.component.ts:256-268`
   - Throttled delta flushing: `agent-process-manager.service.ts:878-961`

3. **Library documentation consulted**:

   - `libs/shared/CLAUDE.md`: Type definitions belong in shared
   - `libs/backend/agent-sdk/CLAUDE.md`: SDK handle and adapter patterns
   - `libs/backend/llm-abstraction/CLAUDE.md`: Agent process manager patterns

4. **No hallucinated APIs**:
   - All decorators verified: `@Component`, `@Injectable` (Angular standard)
   - All base types verified: `ExecutionNode`, `FlatStreamEventUnion`, `CliOutputSegment` (shared types)
   - All services verified: `ExecutionTreeBuilderService` (chat services), `AgentMonitorStore` (chat services)
   - `SdkHandle` interface verified: `cli-adapter.interface.ts:48-59`

---

## Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (performance caps, memoization)
- [x] Integration points documented (backend -> store -> components)
- [x] Files affected list complete (7 CREATE, 8 MODIFY)
- [x] Developer type recommended (backend + frontend)
- [x] Complexity assessed (HIGH, 16-24 hours)
- [x] No step-by-step implementation (team-leader decomposes into atomic tasks)
- [x] Backward compatibility for old sessions (optional fields, fallback rendering)
- [x] Performance analysis complete (throttling, memoization, memory caps)
