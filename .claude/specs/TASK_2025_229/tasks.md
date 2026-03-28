# Development Tasks - TASK_2025_229

**Total Tasks**: 4 | **Batches**: 2 | **Status**: 0/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `ExecutionTreeBuilderService` is `providedIn: 'root'`, stateless per call, and exported from `@ptah-extension/chat` - VERIFIED in `libs/frontend/chat/src/lib/services/index.ts` line 13 and service decorator
- `ExecutionNodeComponent` is standalone, pure input-driven, exported from `@ptah-extension/chat` - VERIFIED in `libs/frontend/chat/src/lib/components/index.ts` line 88
- `FlatStreamEventUnion` is exported from `@ptah-extension/shared` via `execution-node.types.ts` - VERIFIED in `libs/shared/src/index.ts` line 7
- `AnalysisStreamPayload` is defined in `libs/shared/src/lib/types/setup-wizard.types.ts` lines 806-826 - VERIFIED
- `SdkStreamProcessor` emits `StreamEvent` (kind-based) via `StreamEventEmitter.emit()` callback - VERIFIED in `sdk-stream-processor.types.ts`
- `broadcastStreamMessage` in `MultiPhaseAnalysisService` already accepts `AnalysisStreamPayload` - VERIFIED at line 663

### Risks Identified

| Risk                                                                                                              | Severity | Mitigation                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StreamingState` and `createEmptyStreamingState` are NOT exported from `@ptah-extension/chat` public API barrel   | HIGH     | Task 2 must add these exports to `libs/frontend/chat/src/lib/services/index.ts` before the setup-wizard library can import them                                   |
| `ExecutionNodeComponent` requires `[isStreaming]` input and `getPermissionForTool` input that wizard doesn't have | LOW      | Wizard passes `isStreaming` from phase active state; `getPermissionForTool` defaults to `undefined` (already optional)                                            |
| `ExecutionTreeBuilderService.buildTree()` depends on `BackgroundAgentStore` injection                             | LOW      | BackgroundAgentStore is `providedIn: 'root'` - will be available; wizard context has no background agents so it returns empty set (cache fingerprint still works) |
| `FlatStreamEvent` requires `sessionId` field but wizard has no session concept                                    | MEDIUM   | Use synthetic sessionId per phase: `wizard-phase-{phaseId}` as planned; this only affects cache keying and tree grouping, both of which work with any string      |

### Edge Cases to Handle

- [ ] Phase reset (user restarts analysis): Clear all StreamingState maps in state service reset() - Handled in Task 2
- [ ] Empty phase (no stream events): buildTree returns empty array, template @for renders nothing - OK by default
- [ ] Race condition on rapid phase transitions: Each phase has its own StreamingState keyed by phaseId - Handled in Task 2
- [ ] Backward compatibility: Old `AnalysisStreamPayload` without `flatEvent` field must still work - Handled in Task 1 (optional field) and Task 2 (null check)

---

## Batch 1: Backend + Chat Library Exports [IMPLEMENTED]

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Add `flatEvent` field to AnalysisStreamPayload and convert StreamEvent to FlatStreamEventUnion in MultiPhaseAnalysisService [IMPLEMENTED]

**Files to modify**:

1. `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`
2. `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.ts`

**Spec Reference**: implementation-plan.md: Task 1 (lines 24-38)

**Pattern to Follow**: The chat pipeline's streaming handler in `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` shows how FlatStreamEventUnion events are created with proper IDs and relationships.

**Quality Requirements**:

- Backward compatible: `flatEvent` is optional on `AnalysisStreamPayload`
- Each phase gets a synthetic messageId: `wizard-phase-{phaseId}` (e.g., `wizard-phase-project-profile`)
- Track `blockIndex` for text/thinking deltas with a simple counter per phase
- Generate unique event IDs using `{phaseId}-{eventType}-{counter}` pattern
- Emit `message_start` event at phase start, `message_complete` event at phase end

**Implementation Details**:

**File 1: `setup-wizard.types.ts`** - Add optional `flatEvent` field to `AnalysisStreamPayload`:

```typescript
// In AnalysisStreamPayload interface (around line 806), add:
import type { FlatStreamEventUnion } from '../execution-node.types';

export interface AnalysisStreamPayload {
  // ... existing fields unchanged ...
  /** Optional flat stream event for ExecutionNode rendering pipeline (TASK_2025_229) */
  flatEvent?: FlatStreamEventUnion;
}
```

NOTE: The import may need to be added at the top of the file or the type referenced inline. Check existing imports in the file.

**File 2: `multi-phase-analysis.service.ts`** - Convert StreamEvent to FlatStreamEventUnion in the emitter callback:

1. Add imports at top:
   - Import `FlatStreamEventUnion`, `MessageStartEvent`, `TextDeltaEvent`, `ThinkingDeltaEvent`, `ToolStartEvent`, `ToolDeltaEvent`, `ToolResultEvent`, `MessageCompleteEvent` from `@ptah-extension/shared`

2. In `processPhaseStream` method, add conversion state tracking before the emitter:

   ```typescript
   // Conversion state for FlatStreamEventUnion generation
   const syntheticMessageId = `wizard-phase-${phaseId}`;
   const syntheticSessionId = `wizard-${phaseId}`;
   let eventCounter = 0;
   let textBlockIndex = 0;
   let thinkingBlockIndex = 0;
   ```

3. In the `emitter.emit` callback (around line 551-558), after the existing `textChunks.push` logic, convert each `StreamEvent` to a `FlatStreamEventUnion` and attach it to the broadcast payload:

   The conversion mapping is:
   - `kind: 'text'` -> `TextDeltaEvent` with `eventType: 'text_delta'`, `delta: event.content`, `blockIndex: textBlockIndex`
   - `kind: 'thinking'` -> `ThinkingDeltaEvent` with `eventType: 'thinking_delta'`, `delta: event.content`, `blockIndex: thinkingBlockIndex++`
   - `kind: 'tool_start'` -> `ToolStartEvent` with `eventType: 'tool_start'`, `toolCallId: event.toolCallId`, `toolName: event.toolName`, `isTaskTool: false`
   - `kind: 'tool_input'` -> `ToolDeltaEvent` with `eventType: 'tool_delta'`, `toolCallId: event.toolCallId`, `delta: event.content`
   - `kind: 'tool_result'` -> `ToolResultEvent` with `eventType: 'tool_result'`, `toolCallId: event.toolCallId`, `content: event.content`, `isError: event.isError`
   - `kind: 'error'` -> skip (no FlatStreamEventUnion equivalent, keep as-is in payload)
   - `kind: 'status'` -> skip (no FlatStreamEventUnion equivalent, keep as-is in payload)

   Each event needs: `id: '${phaseId}-${eventCounter++}'`, `eventType`, `timestamp: event.timestamp`, `sessionId: syntheticSessionId`, `messageId: syntheticMessageId`

4. Modify `broadcastStreamMessage` to include the `flatEvent`:
   The existing call `this.broadcastStreamMessage(event)` in the emitter callback needs to be changed to pass the converted flat event. The simplest approach: build the `AnalysisStreamPayload` with the `flatEvent` attached before broadcasting.

5. Emit `message_start` at the beginning of `processPhaseStream` (before processing stream):

   ```typescript
   this.broadcastStreamMessage({
     kind: 'status',
     content: `Phase ${phaseId} starting...`,
     timestamp: Date.now(),
     flatEvent: {
       id: `${phaseId}-msg-start`,
       eventType: 'message_start',
       timestamp: Date.now(),
       sessionId: syntheticSessionId,
       messageId: syntheticMessageId,
       role: 'assistant',
     } as MessageStartEvent,
   });
   ```

6. Emit `message_complete` after `processor.process()` completes (before the return):
   ```typescript
   this.broadcastStreamMessage({
     kind: 'status',
     content: `Phase ${phaseId} complete`,
     timestamp: Date.now(),
     flatEvent: {
       id: `${phaseId}-msg-complete`,
       eventType: 'message_complete',
       timestamp: Date.now(),
       sessionId: syntheticSessionId,
       messageId: syntheticMessageId,
     } as MessageCompleteEvent,
   });
   ```

---

### Task 1.2: Export `StreamingState` and `createEmptyStreamingState` from chat library public API [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\index.ts`

**Spec Reference**: Plan Validation finding - these types are needed by setup-wizard but not currently exported

**Pattern to Follow**: Existing exports in the same file (e.g., `NodeMaps`, `SessionStatus` on line 20-24)

**Quality Requirements**:

- Add `StreamingState` as a type export
- Add `createEmptyStreamingState` as a value export
- Do not break existing imports

**Implementation Details**:

In `libs/frontend/chat/src/lib/services/index.ts`, modify the existing `chat.types` export block (around lines 18-24):

```typescript
// Before:
export type { NodeMaps, SessionStatus, SessionState, SessionLoadResult } from './chat.types';

// After:
export { createEmptyStreamingState, type StreamingState, type NodeMaps, type SessionStatus, type SessionState, type SessionLoadResult } from './chat.types';
```

Note: The block changes from `export type { ... }` to `export { ..., type ... }` because `createEmptyStreamingState` is a value export (function), not just a type.

---

**Batch 1 Verification**:

- `flatEvent` field is optional on `AnalysisStreamPayload` (backward compat)
- `StreamingState` and `createEmptyStreamingState` importable from `@ptah-extension/chat`
- Build passes: `npx nx build shared && npx nx build agent-generation && npx nx build chat`
- code-logic-reviewer approved
- No stubs, no TODOs

---

## Batch 2: Frontend State + Rendering [PENDING]

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 2.1: Feed flat events into StreamingState in SetupWizardStateService [PENDING]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

**Spec Reference**: implementation-plan.md: Task 2 (lines 42-56)

**Pattern to Follow**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` shows how events are accumulated into StreamingState maps

**Quality Requirements**:

- New signal: `phaseStreamingStates` of type `signal<Map<string, StreamingState>>(new Map())`
- Public readonly accessor for phaseStreamingStates
- Accumulate events from `payload.flatEvent` when present in `handleAnalysisStream`
- Clear streaming states on reset
- Clear streaming states when analysis stream is cleared
- Each phase's StreamingState is keyed by the `flatEvent.messageId` (which is `wizard-phase-{phaseId}`)

**Implementation Details**:

1. Add imports at top of file:

   ```typescript
   import { createEmptyStreamingState, type StreamingState } from '@ptah-extension/chat';
   import type { FlatStreamEventUnion } from '@ptah-extension/shared';
   ```

2. Add new private signal after `analysisStreamSignal` (around line 232):

   ```typescript
   /**
    * Private writable signal for per-phase StreamingState maps.
    * Keyed by phase messageId (e.g., 'wizard-phase-project-profile').
    * Each StreamingState accumulates FlatStreamEventUnion events for ExecutionNode rendering.
    * TASK_2025_229
    */
   private readonly phaseStreamingStatesSignal = signal<Map<string, StreamingState>>(new Map());
   ```

3. Add public readonly accessor (in the public signals section, around line 405):

   ```typescript
   /**
    * Public readonly signal for per-phase streaming states.
    * Used by AnalysisTranscriptComponent to build ExecutionNode trees.
    * TASK_2025_229
    */
   public readonly phaseStreamingStates = this.phaseStreamingStatesSignal.asReadonly();
   ```

4. Modify `handleAnalysisStream` method (currently at line 1167-1169) to accumulate flat events:

   ```typescript
   private handleAnalysisStream(payload: AnalysisStreamPayload): void {
     // Existing: keep flat payload accumulation for backward compat (stats dashboard uses it)
     this.analysisStreamSignal.update((messages) => [...messages, payload]);

     // TASK_2025_229: Accumulate flat events into per-phase StreamingState
     if (payload.flatEvent) {
       this.accumulateFlatEvent(payload.flatEvent);
     }
   }
   ```

5. Add new private method `accumulateFlatEvent`:

   ```typescript
   /**
    * Accumulate a FlatStreamEventUnion into the appropriate phase's StreamingState.
    * Mirrors the accumulation logic in ChatStore's streaming handler.
    * TASK_2025_229
    */
   private accumulateFlatEvent(event: FlatStreamEventUnion): void {
     const phaseKey = event.messageId;

     this.phaseStreamingStatesSignal.update((statesMap) => {
       const newMap = new Map(statesMap);
       let state = newMap.get(phaseKey);

       if (!state) {
         state = createEmptyStreamingState();
         newMap.set(phaseKey, state);
       }

       // Store event by ID
       state.events.set(event.id, event);

       // Index by messageId for O(1) lookup
       const messageEvents = state.eventsByMessage.get(event.messageId) ?? [];
       messageEvents.push(event);
       state.eventsByMessage.set(event.messageId, messageEvents);

       // Handle event-type-specific accumulation
       switch (event.eventType) {
         case 'message_start':
           // Track message ID ordering (dedup)
           if (!state.messageEventIds.includes(event.messageId)) {
             state.messageEventIds.push(event.messageId);
           }
           state.currentMessageId = event.messageId;
           break;

         case 'text_delta': {
           // Track message in ordering if not yet tracked
           if (!state.messageEventIds.includes(event.messageId)) {
             state.messageEventIds.push(event.messageId);
           }
           // Accumulate text by block key
           const textKey = `${event.messageId}-block-${event.blockIndex}`;
           const existing = state.textAccumulators.get(textKey) ?? '';
           state.textAccumulators.set(textKey, existing + event.delta);
           break;
         }

         case 'thinking_delta': {
           const thinkKey = `${event.messageId}-thinking-${event.blockIndex}`;
           const existingThink = state.textAccumulators.get(thinkKey) ?? '';
           state.textAccumulators.set(thinkKey, existingThink + event.delta);
           break;
         }

         case 'tool_start': {
           // Track in toolCallMap
           const toolChildren = state.toolCallMap.get(event.toolCallId) ?? [];
           toolChildren.push(event.id);
           state.toolCallMap.set(event.toolCallId, toolChildren);
           break;
         }

         case 'tool_delta': {
           // Accumulate tool input JSON
           const inputKey = `${event.toolCallId}-input`;
           const existingInput = state.toolInputAccumulators.get(inputKey) ?? '';
           state.toolInputAccumulators.set(inputKey, existingInput + event.delta);
           // Track in toolCallMap
           const deltaToolChildren = state.toolCallMap.get(event.toolCallId) ?? [];
           deltaToolChildren.push(event.id);
           state.toolCallMap.set(event.toolCallId, deltaToolChildren);
           break;
         }

         case 'tool_result': {
           // Track in toolCallMap
           const resultToolChildren = state.toolCallMap.get(event.toolCallId) ?? [];
           resultToolChildren.push(event.id);
           state.toolCallMap.set(event.toolCallId, resultToolChildren);
           break;
         }

         case 'message_complete':
           state.currentMessageId = null;
           break;
       }

       return newMap;
     });
   }
   ```

6. In the `reset()` method (find it by searching for `reset()` or the existing `analysisStreamSignal.set([])`), add:

   ```typescript
   this.phaseStreamingStatesSignal.set(new Map());
   ```

7. Also clear streaming states where `analysisStreamSignal` is cleared (search for any `.set([])` calls on `analysisStreamSignal` that happen outside of `reset()`).

**Validation Notes**:

- The `accumulateFlatEvent` mutates the StreamingState in-place within the signal update callback. This is safe because we create a new Map wrapper (`new Map(statesMap)`) which triggers change detection, even though the inner StreamingState objects are mutated. This matches the pattern used in ChatStore.
- `blockIndex` for thinking events uses a `thinking-` prefix key to avoid collision with text block keys.

---

### Task 2.2: Rewrite AnalysisTranscriptComponent to use ExecutionNodeComponent + Update AnalysisStatsDashboardComponent [PENDING]

**Files to modify**:

1. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts`
2. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts`

**Spec Reference**: implementation-plan.md: Tasks 3 and 4 (lines 58-88)

**Pattern to Follow**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` shows how ExecutionNodeComponent is used with `buildTree()` in a computed signal

**Quality Requirements**:

- Remove ALL custom transcript rendering logic (GroupedMessage, ToolCallGroup, TranscriptItem types)
- Remove ToolOutputFormatterService dependency
- Remove lucide icons that are no longer needed (keep Terminal for header)
- Import and use ExecutionNodeComponent from `@ptah-extension/chat`
- Import and inject ExecutionTreeBuilderService from `@ptah-extension/chat`
- Keep the expand/collapse header toggle and auto-scroll behavior
- Keep the skeleton loading state for empty transcript
- Use `computed()` that calls `buildTree()` for the current active phase's StreamingState
- Stats dashboard: derive tool count from StreamingState events instead of flat array (optional, can keep existing if it still works since `analysisStream` signal still populated)

**Implementation Details for File 1 (`analysis-transcript.component.ts`)**:

1. Replace imports:

   ```typescript
   import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
   import { ChevronDown, ChevronUp, LucideAngularModule, Terminal } from 'lucide-angular';
   import { ExecutionNodeComponent, ExecutionTreeBuilderService } from '@ptah-extension/chat';
   import type { StreamingState } from '@ptah-extension/chat';
   import { SetupWizardStateService } from '../services/setup-wizard-state.service';
   ```

2. Remove ALL deleted types: `GroupedMessage`, `ToolCallGroup`, `TranscriptItem` interfaces (lines 33-65)

3. Remove `ToolOutputFormatterService` import and injection

4. Update `@Component` metadata:
   - Remove `MarkdownModule` from imports
   - Add `ExecutionNodeComponent` to imports
   - Keep `LucideAngularModule`

5. Replace template (keep header + scroll container structure, replace content):

   ```html
   <div class="bg-base-200 rounded-lg overflow-hidden h-full max-h-[70vh] flex flex-col">
     <!-- Header with toggle -->
     <button type="button" class="w-full flex items-center justify-between p-3 hover:bg-base-300 transition-colors" [attr.aria-expanded]="isExpanded()" aria-controls="analysis-transcript-content" (click)="toggleExpanded()">
       <span class="flex items-center gap-2">
         <lucide-angular [img]="TerminalIcon" class="w-4 h-4 text-primary" aria-hidden="true" />
         <span class="text-sm font-medium">Agent Transcript</span>
         <span class="badge badge-sm badge-ghost">{{ messageCount() }}</span>
       </span>
       <lucide-angular [img]="isExpanded() ? ChevronUpIcon : ChevronDownIcon" class="w-4 h-4 text-base-content/60" aria-hidden="true" />
     </button>

     <!-- Scrollable content -->
     @if (isExpanded()) {
     <div id="analysis-transcript-content" #scrollContainer class="overflow-y-auto flex-1 min-h-0 p-3 space-y-2 border-t border-base-300" (scroll)="onUserScroll()">
       @for (node of executionTree(); track node.id) {
       <ptah-execution-node [node]="node" [isStreaming]="isPhaseActive()" />
       } @empty {
       <div class="space-y-3 py-4">
         <div class="flex items-center gap-2">
           <div class="skeleton w-4 h-4 rounded-full shrink-0"></div>
           <div class="skeleton h-3 w-3/4"></div>
         </div>
         <div class="skeleton h-12 w-full rounded-md"></div>
         <div class="flex items-center gap-2">
           <div class="skeleton w-4 h-4 rounded-full shrink-0"></div>
           <div class="skeleton h-3 w-1/2"></div>
         </div>
         <div class="skeleton h-8 w-full rounded-md"></div>
       </div>
       }
     </div>
     }
   </div>
   ```

6. Rewrite the component class body:

   ```typescript
   export class AnalysisTranscriptComponent {
     private readonly wizardState = inject(SetupWizardStateService);
     private readonly treeBuilder = inject(ExecutionTreeBuilderService);

     // Icons
     protected readonly TerminalIcon = Terminal;
     protected readonly ChevronUpIcon = ChevronUp;
     protected readonly ChevronDownIcon = ChevronDown;

     // UI state
     protected readonly isExpanded = signal(true);
     private readonly userHasScrolledUp = signal(false);
     protected readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

     /** Message count for badge - use analysis stream length for continuity */
     protected readonly messageCount = computed(() => this.wizardState.analysisStream().length);

     /** Get the current active phase's StreamingState */
     private readonly currentPhaseState = computed<StreamingState | null>(() => {
       const statesMap = this.wizardState.phaseStreamingStates();
       const scanProgress = this.wizardState.scanProgress();
       const currentPhase = scanProgress?.currentPhase;

       if (!currentPhase || statesMap.size === 0) return null;

       // Try current phase first
       const phaseKey = `wizard-phase-${currentPhase}`;
       if (statesMap.has(phaseKey)) return statesMap.get(phaseKey)!;

       // Fallback: return the last phase's state (for when viewing completed phases)
       const keys = Array.from(statesMap.keys());
       return keys.length > 0 ? statesMap.get(keys[keys.length - 1])! : null;
     });

     /** Build execution tree from current phase's streaming state */
     protected readonly executionTree = computed(() => {
       const state = this.currentPhaseState();
       if (!state || state.events.size === 0) return [];

       const scanProgress = this.wizardState.scanProgress();
       const cacheKey = `wizard-${scanProgress?.currentPhase ?? 'default'}`;
       return this.treeBuilder.buildTree(state, cacheKey);
     });

     /** Whether the current phase is actively streaming */
     protected readonly isPhaseActive = computed(() => {
       const scanProgress = this.wizardState.scanProgress();
       if (!scanProgress?.phaseStatuses) return false;
       return scanProgress.phaseStatuses.some((s) => s.status === 'running');
     });

     public constructor() {
       // Auto-scroll effect
       effect(() => {
         const tree = this.executionTree();
         if (tree.length === 0) return;
         if (!this.userHasScrolledUp()) {
           requestAnimationFrame(() => {
             const container = this.scrollContainer()?.nativeElement;
             if (container) {
               container.scrollTop = container.scrollHeight;
             }
           });
         }
       });
     }

     protected toggleExpanded(): void {
       this.isExpanded.update((v) => !v);
       if (this.isExpanded()) {
         this.userHasScrolledUp.set(false);
       }
     }

     protected onUserScroll(): void {
       const container = this.scrollContainer()?.nativeElement;
       if (!container) return;
       const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
       this.userHasScrolledUp.set(!isAtBottom);
     }
   }
   ```

7. Remove ALL methods that are no longer needed:
   - `toggleToolInput`, `isToolInputExpanded`, `toggleFullToolInput`, `isFullToolInputShown`
   - `getToolInputContent`, `toggleToolGroup`, `isToolGroupCollapsed`
   - `isToolGroup`, `getFormattedToolInput`, `getFormattedToolResult`
   - `getToolGroupLabel`, `getFormattedTextContent`
   - `transcriptItems` computed signal
   - `effectiveMessages` computed signal
   - `messages` input signal

**Implementation Details for File 2 (`analysis-stats-dashboard.component.ts`)** (OPTIONAL - lower priority):

The stats dashboard currently reads from `wizardState.analysisStream()` which is still populated (backward compat). The existing code will continue to work. However, if the developer wants to align it with the new pipeline, they can optionally derive stats from the StreamingState events:

- Tool call count: count events with `eventType === 'tool_start'` from all phase StreamingStates
- Thinking count: count events with `eventType === 'thinking_delta'` (unique by blockIndex)
- Text count: count events with `eventType === 'text_delta'` (unique by blockIndex)

**Since `analysisStream()` is still populated (Task 2.1 keeps backward compat), the stats dashboard continues to work as-is. No changes required. Skip this file unless build issues arise.**

---

**Batch 2 Verification**:

- AnalysisTranscriptComponent renders ExecutionNodeComponent tree
- Stats dashboard still shows metrics (backward compat via analysisStream signal)
- Auto-scroll still works
- Expand/collapse toggle still works
- Skeleton loading state shows when no events
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- No stubs, no TODOs
