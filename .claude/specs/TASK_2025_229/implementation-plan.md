# Implementation Plan - TASK_2025_229 (Revised)

## Wire Setup Wizard Transcript to Chat Execution Tree Pipeline

## Approach: Reuse, Don't Rebuild

Everything needed is already exported from `@ptah-extension/chat` and `@ptah-extension/shared`:

- `ExecutionTreeBuilderService` — `providedIn: 'root'`, stateless per call, exported
- `ExecutionNodeComponent` — pure input-driven, exported, no injected services
- `createEmptyStreamingState()` — factory exported from chat
- `StreamingState` — type exported from chat
- `FlatStreamEventUnion` — type exported from shared

**No new services needed.** The wizard just needs to:

1. Convert backend `StreamEvent` to `FlatStreamEventUnion` (small converter function)
2. Feed events into a `StreamingState` signal (manual map mutation)
3. Call `buildTree()` at render time
4. Render with `<ptah-execution-node>`

---

## Tasks

### Task 1: Backend — Convert StreamEvent to FlatStreamEventUnion at broadcast layer

**File**: `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`

**What changes**:

- In the `emitter.emit` callback inside `processPhaseStream`, convert each `StreamEvent` to a `FlatStreamEventUnion` before broadcasting
- Generate synthetic `messageId` per phase (`wizard-phase-{phaseId}`)
- Track `blockIndex` for text/thinking deltas (simple counter)
- Broadcast via existing `MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM` with the new event shape (add a `flatEvent` field to the payload alongside the existing fields for backward compat)
- Emit `message_start` at phase start, `message_complete` at phase end

**Add to shared types** (`libs/shared/src/lib/types/rpc/rpc-misc.types.ts` or `setup-wizard.types.ts`):

- Extend `AnalysisStreamPayload` with optional `flatEvent?: FlatStreamEventUnion` field

**Complexity**: LOW (~1h)

### Task 2: Frontend — Feed events into StreamingState in SetupWizardStateService

**File**: `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`

**What changes**:

- Add a `phaseStreamingStates` signal: `signal<Map<string, StreamingState>>(new Map())`
- In the existing `handleAnalysisStream()` handler, when `payload.flatEvent` is present:
  - Get or create `StreamingState` for the current phase
  - Insert event into `state.events` Map
  - Push `messageId` to `messageEventIds` (dedup)
  - Accumulate text deltas in `textAccumulators` (key: `{messageId}-block-{blockIndex}`)
  - Accumulate tool input in `toolInputAccumulators` (key: `{toolCallId}-input`)
  - Index event in `eventsByMessage` Map
- On phase change (from scan progress handler): create fresh `StreamingState` for new phase
- On reset: clear all states

**Complexity**: MEDIUM (~1.5h)

### Task 3: Frontend — Rewrite AnalysisTranscriptComponent to use ExecutionNodeComponent

**File**: `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts`

**What changes**:

- Import `ExecutionTreeBuilderService` and `ExecutionNodeComponent` from `@ptah-extension/chat`
- Add `ExecutionNodeComponent` to `imports` array
- Inject `ExecutionTreeBuilderService`
- Create a `computed()` that calls `buildTree(currentPhaseState, 'wizard-phase-{id}')`
- Replace the entire template with:
  ```html
  @for (node of executionTree(); track node.id) {
  <ptah-execution-node [node]="node" [isStreaming]="isPhaseActive()" />
  }
  ```
- Remove all the custom `GroupedMessage`, `ToolCallGroup`, `TranscriptItem` types and rendering logic
- Keep auto-scroll behavior

**Complexity**: MEDIUM (~1.5h)

### Task 4: Frontend — Update AnalysisStatsDashboardComponent data source

**File**: `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.ts`

**What changes**:

- Derive stats from `StreamingState.events` Map instead of flat `AnalysisStreamPayload[]`
- Tool call count = events where `eventType === 'tool_start'`
- Thinking count = events where `eventType === 'thinking_delta'` (unique by blockIndex)
- Keep the same UI template

**Complexity**: LOW (~0.5h)

---

## Task Dependencies

```
Task 1 (backend converter)  →  Task 2 (frontend state)  →  Task 3 (transcript rewrite)
                                                          →  Task 4 (stats update)
```

All sequential — each builds on the previous. Total: ~4.5h

## Files Affected (4 files modified, 0 created)

1. MODIFY: `libs/shared/src/lib/types/rpc/rpc-misc.types.ts` — add `flatEvent` to payload
2. MODIFY: `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts` — convert + broadcast
3. MODIFY: `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts` — StreamingState accumulation
4. REWRITE: `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts` — use ExecutionNodeComponent

Optional: 5. MODIFY: `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.ts` — derive from StreamingState
