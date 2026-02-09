# Development Tasks - TASK_2025_146

**Total Tasks**: 14 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `MESSAGE_TYPES` object in `message.types.ts:316` supports adding new constants: VERIFIED (line 316, just above line 317 `SETUP_WIZARD_SCAN_PROGRESS`)
- `WizardMessageType` discriminated union in `setup-wizard.types.ts:694` supports extension: VERIFIED (line 694-700, literal union)
- `WizardMessage` union in `setup-wizard.types.ts:858` supports extension: VERIFIED (line 858-870)
- `AbortController.abort(reason)` supported in Node.js 16+: VERIFIED (VS Code 1.103 ships Node 20+)
- `SetupWizardStateService.isWizardMessage()` uses `validTypes` array at line 752 that must be updated: VERIFIED
- Stream event type `content_block_delta` with `delta.type === 'input_json_delta'` has `delta.partial_json`: VERIFIED (`claude-sdk.types.ts:237-240`)
- Stream event type `content_block_delta` with `delta.type === 'thinking_delta'` has `delta.thinking`: VERIFIED (`claude-sdk.types.ts:242-245`)
- `content_block_start` event has `content_block` property with `type` and `name`: VERIFIED (`claude-sdk.types.ts:226-230`)
- `broadcastMessage` method on `webviewManager`: VERIFIED (used in `agentic-analysis.service.ts:545`)

### Risks Identified

| Risk                                                                                                         | Severity | Mitigation                                                               |
| ------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| Exhaustive switch in `isWizardMessage` will break if `validTypes` not updated                                | HIGH     | Task 3.1 explicitly adds new type to validTypes array                    |
| Exhaustive `default: never` in message switch (line 808-811) will fail at compile time if union not extended | HIGH     | Task 1.1 extends WizardMessageType + WizardMessage union simultaneously  |
| High-frequency text_delta broadcasts could cause frontend jank                                               | MEDIUM   | Task 2.5 implements throttled broadcasting with 100ms debounce           |
| Tool input JSON accumulation buffer grows unbounded during long tool calls                                   | LOW      | Analysis max duration is 90s, buffer size is bounded                     |
| `content_block_stop` event has `index` but no `content_block` -- need to track by index                      | MEDIUM   | Task 2.3 uses Map indexed by content_block index to correlate start/stop |

### Edge Cases to Handle

- [x] Phase markers split across multiple text_delta chunks -> Already handled by cursor-based matching on accumulated `fullText`
- [x] Phase markers appearing inside tool call input JSON -> Handled in Task 2.1 (input_json_delta extraction)
- [x] Phase markers in complete assistant message content blocks -> Handled in Task 2.2
- [x] Timeout abort vs user cancel producing different error messages -> Handled in Task 1.3
- [x] Race condition: cancel arrives after analysis completes -> Already handled (line 276-278 in agentic-analysis.service.ts)
- [x] Frontend exhaustive switch failure when new message type added -> Handled by updating all union types in Task 1.1 + validTypes + switch case

---

## Batch 1: Foundation - Types, Prompt Fix, and Timeout/Cancel COMPLETE

**Status**: COMPLETE
**Commit**: f0e6127
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Add AnalysisStreamPayload type and SETUP_WIZARD_ANALYSIS_STREAM message type (C7A)

**Status**: COMPLETE
**File 1**: `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts`
**File 2**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`
**Component**: C7A
**Spec Reference**: implementation-plan.md: Sub-Component 7A (lines 373-423)
**Pattern to Follow**: Existing `SETUP_WIZARD_SCAN_PROGRESS` in `message.types.ts:316` and `ScanProgressPayload` in `setup-wizard.types.ts:720-735`

**Quality Requirements**:

- New message type constant must follow existing naming pattern
- AnalysisStreamPayload interface must be exported from shared
- WizardMessageType union must include the new type string
- WizardMessage discriminated union must include the new variant
- All changes must maintain the exhaustive switch pattern

**Implementation Details**:

1. In `message.types.ts` -- Add new constant to `MESSAGE_TYPES` object after line 316:

   ```typescript
   SETUP_WIZARD_ANALYSIS_STREAM: 'setup-wizard:analysis-stream',
   ```

2. In `setup-wizard.types.ts` -- Add new interface BEFORE the WizardMessageType union (insert after line 735, before the WizardMessageType section):

   ```typescript
   /**
    * Payload for streaming analysis messages to the frontend transcript.
    * Sent from AgenticAnalysisService during SDK stream processing.
    */
   export interface AnalysisStreamPayload {
     /** Message type discriminator */
     kind: 'text' | 'tool_start' | 'tool_input' | 'tool_result' | 'thinking' | 'error' | 'status';
     /** Text content (text output, thinking preview, error message, or status) */
     content: string;
     /** Tool name (for tool_start, tool_input, tool_result) */
     toolName?: string;
     /** Tool call ID (for correlating tool_start with tool_result) */
     toolCallId?: string;
     /** Whether this is an error result (for tool_result) */
     isError?: boolean;
     /** Timestamp */
     timestamp: number;
   }
   ```

3. In `setup-wizard.types.ts` -- Extend `WizardMessageType` union (line 694-700) to add:

   ```typescript
   | 'setup-wizard:analysis-stream'
   ```

4. In `setup-wizard.types.ts` -- Extend `WizardMessage` union (line 858-870) to add:
   ```typescript
   | { type: 'setup-wizard:analysis-stream'; payload: AnalysisStreamPayload }
   ```

**Verification**:

- TypeScript compiles with no errors: `npx nx run shared:typecheck`
- The new type is exported from `@ptah-extension/shared`

---

### Task 1.2: Fix system prompt ambiguity and reduce token waste (C1 + C5)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Component**: C1 + C5
**Spec Reference**: implementation-plan.md: Component 1 (lines 73-98) and Component 5 (lines 277-304)
**Pattern to Follow**: Existing `buildAnalysisSystemPrompt()` function at lines 57-166

**Quality Requirements**:

- Phase markers MUST appear in text_delta events
- Agent should NOT double-call workspace.analyze()
- Agent should NOT wrap results in console.log()
- Reduced token consumption vs current prompt
- Remove confusing `ptah.ai.invokeAgent()` / `ptah.ai.chatWithTools()` references

**Implementation Details**:

Replace the `buildAnalysisSystemPrompt()` function (lines 57-166) with an improved version that:

1. **Clarifies marker placement** (C1): Replace "Emit `[PHASE:discovery]`" with explicit instruction: "Before starting each phase, output exactly this text as a standalone line in your direct text output (NOT inside any tool call, code block, or execute_code input): `[PHASE:discovery]`"

2. **Adds negative examples** (C1): "DO NOT put phase markers inside execute_code tool input parameters. Phase markers MUST appear as your direct text response."

3. **Prevents double workspace.analyze()** (C5): "Call `ptah.workspace.analyze()` EXACTLY ONCE. The execute_code tool returns the value of the last expression directly -- do NOT use console.log() to wrap return values."

4. **Prevents JSON dumps** (C5): "When analyzing results, summarize key findings concisely in your text output. Do NOT reproduce entire JSON objects in your response text."

5. **Removes confusing instructions** (C5): Remove line 85's instruction about `ptah.ai.invokeAgent()` and `ptah.ai.chatWithTools()` which adds confusion and wastes tokens.

6. **Keeps all other instructions intact**: Output schema, phase order, detection markers, JSON code block output format.

**Verification**:

- TypeScript compiles: `npx nx run agent-generation:typecheck`
- Prompt is shorter than current (fewer tokens)
- All 4 phase markers and detection marker instructions are present

---

### Task 1.3: Disambiguate timeout vs user cancellation (C3)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Component**: C3
**Spec Reference**: implementation-plan.md: Component 3 (lines 143-209)
**Pattern to Follow**: Existing `AbortController` usage at lines 237-238, 293, 317-322

**Quality Requirements**:

- Timeout produces "timed out" message, NOT "aborted by user"
- User cancellation produces "cancelled" message
- Frontend can distinguish between the two via error messages
- No changes to the public API of analyzeWorkspace() or cancelAnalysis()

**Implementation Details**:

1. **Define abort reason constants** at module level (after line 44, before PHASE_LABELS):

   ```typescript
   const ABORT_REASONS = {
     TIMEOUT: 'analysis_timeout',
     USER_CANCELLED: 'user_cancelled',
   } as const;
   type AbortReason = (typeof ABORT_REASONS)[keyof typeof ABORT_REASONS];
   ```

2. **Update timeout handler** in `processStream()` (line 317-322):
   Change `abortController.abort()` to `abortController.abort(ABORT_REASONS.TIMEOUT)`

3. **Update cancelAnalysis()** (line 293):
   Change `this.activeAbortController.abort()` to `this.activeAbortController.abort(ABORT_REASONS.USER_CANCELLED)`

4. **Update catch block** in `analyzeWorkspace()` (lines 267-272):
   Inspect `abortController.signal.reason` to produce distinct error messages:
   ```typescript
   const abortReason = abortController.signal.reason as AbortReason | undefined;
   if (abortReason === ABORT_REASONS.TIMEOUT) {
     this.logger.warn(`${SERVICE_TAG} Analysis timed out after ${timeout}ms`);
     this.broadcastProgress({
       filesScanned: 0,
       totalFiles: 0,
       detections: [],
       agentReasoning: 'Analysis timed out. Falling back to quick analysis...',
     });
     return Result.err(new Error('Analysis timed out'));
   } else if (abortReason === ABORT_REASONS.USER_CANCELLED) {
     this.logger.info(`${SERVICE_TAG} Analysis cancelled by user`);
     return Result.err(new Error('Analysis cancelled by user'));
   }
   // Otherwise, fall through to generic error handling
   ```

**Verification**:

- TypeScript compiles: `npx nx run agent-generation:typecheck`
- Error message strings are distinct for timeout vs cancellation

---

### Task 1.4: Add fallback transition UX broadcasts (C4)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
**Component**: C4
**Spec Reference**: implementation-plan.md: Component 4 (lines 214-273)
**Pattern to Follow**: Existing `broadcastMessage` usage in `agentic-analysis.service.ts:545-548`

**Quality Requirements**:

- UI shows "Switching to quick analysis mode..." when fallback triggers
- UI shows "Running quick project analysis..." when fallback starts
- Broadcast failures are silently caught (best-effort)
- No changes to fallback logic itself

**Implementation Details**:

1. **Add imports** at top of file:

   ```typescript
   import { MESSAGE_TYPES } from '@ptah-extension/shared';
   import type { WebviewManager } from '@ptah-extension/vscode-core';
   ```

2. **In `registerDeepAnalyze()`**, after the agentic analysis catch block (after line 320, before line 322 "Fallback:"):

   ```typescript
   // Broadcast fallback transition to frontend
   try {
     const webviewManager = this.resolveService<WebviewManager>(TOKENS.WEBVIEW_MANAGER, 'WebviewManager');
     webviewManager.broadcastMessage(MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS, {
       filesScanned: 0,
       totalFiles: 0,
       detections: [],
       agentReasoning: 'Switching to quick analysis mode...',
       currentPhase: undefined,
       completedPhases: [],
     });
   } catch {
     /* best-effort broadcast */
   }
   ```

3. **Before calling `performDeepAnalysis`** (before line 332):
   ```typescript
   try {
     const webviewManager = this.resolveService<WebviewManager>(TOKENS.WEBVIEW_MANAGER, 'WebviewManager');
     webviewManager.broadcastMessage(MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS, {
       filesScanned: 0,
       totalFiles: 0,
       detections: [],
       agentReasoning: 'Running quick project analysis...',
     });
   } catch {
     /* best-effort broadcast */
   }
   ```

**Verification**:

- TypeScript compiles: `npx nx run ptah-extension-vscode:typecheck`
- Both `MESSAGE_TYPES` and `WebviewManager` imports resolve correctly

---

**Batch 1 Verification Checklist**:

- [x] All files exist at specified paths
- [x] Build passes: lint passed with 0 errors
- [x] code-logic-reviewer approved
- [x] No stubs, TODOs, or placeholder code
- [x] Lint fix: removed premature AnalysisStreamPayload import (unused until Batch 3)

---

## Batch 2: Stream Processing Enhancements and Backend Broadcasting COMPLETE

**Status**: COMPLETE
**Commit**: 62508eb
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 (COMPLETE - commit f0e6127)

### Task 2.1: Add multi-source marker extraction from input_json_delta (C2 - Path A)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Component**: C2 (Path A)
**Spec Reference**: implementation-plan.md: Component 2, Path A (lines 119-123)
**Pattern to Follow**: Existing text_delta marker extraction at lines 366-424

**Quality Requirements**:

- Markers found in input_json_delta trigger broadcastProgress
- No duplicate broadcasts for same phase/detection (existing dedup handles this)
- Separate cursor variables for tool input buffer

**Implementation Details**:

1. **Add new state variables** at the start of `processStream()` (after line 315):

   ```typescript
   let toolInputBuffer = '';
   let lastPhaseCheckPosToolInput = 0;
   let lastDetectionCheckPosToolInput = 0;
   ```

2. **Add input_json_delta handler** within the `if (message.type === 'stream_event')` block, after the text_delta block (after line 425), before the tool_use content_block_start block:

   ```typescript
   // input_json_delta -- extract markers from tool call code (defense-in-depth)
   if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
     toolInputBuffer += event.delta.partial_json;

     // Phase markers in tool input
     const phaseSearchRegion = toolInputBuffer.substring(lastPhaseCheckPosToolInput);
     const phaseMatch = phaseSearchRegion.match(/\[PHASE:(\w+)\]/);
     if (phaseMatch) {
       const phase = phaseMatch[1] as AnalysisPhase;
       lastPhaseCheckPosToolInput = lastPhaseCheckPosToolInput + (phaseMatch.index ?? 0) + phaseMatch[0].length;
       if (currentPhase && !completedPhases.includes(currentPhase)) {
         completedPhases.push(currentPhase);
       }
       currentPhase = phase;
       this.broadcastProgress({
         filesScanned: 0,
         totalFiles: 0,
         detections,
         currentPhase: phase,
         phaseLabel: PHASE_LABELS[phase] || `Phase: ${phase}`,
         completedPhases: [...completedPhases],
       });
     }

     // Detection markers in tool input
     const detectionSearchRegion = toolInputBuffer.substring(lastDetectionCheckPosToolInput);
     const detectionMatches = [...detectionSearchRegion.matchAll(/\[DETECTED:(.+?)\]/g)];
     for (const match of detectionMatches) {
       const detection = match[1];
       if (!detections.includes(detection)) {
         detections.push(detection);
         this.broadcastProgress({
           filesScanned: 0,
           totalFiles: 0,
           detections: [...detections],
           currentPhase,
           phaseLabel: currentPhase ? PHASE_LABELS[currentPhase] : undefined,
           completedPhases: [...completedPhases],
         });
       }
     }
     if (detectionMatches.length > 0) {
       const lastMatch = detectionMatches[detectionMatches.length - 1];
       lastDetectionCheckPosToolInput = lastDetectionCheckPosToolInput + (lastMatch.index ?? 0) + lastMatch[0].length;
     }
   }
   ```

**Verification**:

- TypeScript compiles
- No duplicate phase/detection broadcasts (existing arrays deduplicate)

---

### Task 2.2: Add multi-source marker extraction from assistant messages (C2 - Path B)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Component**: C2 (Path B)
**Spec Reference**: implementation-plan.md: Component 2, Path B (lines 125-131)
**Pattern to Follow**: Existing assistant message handling at lines 444-450

**Quality Requirements**:

- Markers in TextBlock content are extracted
- Markers in ToolUseBlock input JSON are extracted
- Deduplication via existing completedPhases/detections arrays

**Implementation Details**:

Replace the current assistant message handler (lines 444-450) with an extended version:

```typescript
// Extract markers from complete assistant message content blocks
if (message.type === 'assistant') {
  this.logger.debug(`${SERVICE_TAG} Assistant message`, {
    contentBlocks: message.message.content.length,
    stopReason: message.message.stop_reason,
  });

  for (const block of message.message.content) {
    let blockText = '';
    if (block.type === 'text') {
      blockText = block.text;
    } else if (block.type === 'tool_use') {
      blockText = JSON.stringify(block.input);
    }

    if (!blockText) continue;

    // Phase markers
    const phaseMatches = [...blockText.matchAll(/\[PHASE:(\w+)\]/g)];
    for (const match of phaseMatches) {
      const phase = match[1] as AnalysisPhase;
      if (currentPhase && !completedPhases.includes(currentPhase)) {
        completedPhases.push(currentPhase);
      }
      if (currentPhase !== phase) {
        currentPhase = phase;
        this.broadcastProgress({
          filesScanned: 0,
          totalFiles: 0,
          detections,
          currentPhase: phase,
          phaseLabel: PHASE_LABELS[phase] || `Phase: ${phase}`,
          completedPhases: [...completedPhases],
        });
      }
    }

    // Detection markers
    const detectionMatches = [...blockText.matchAll(/\[DETECTED:(.+?)\]/g)];
    for (const match of detectionMatches) {
      const detection = match[1];
      if (!detections.includes(detection)) {
        detections.push(detection);
        this.broadcastProgress({
          filesScanned: 0,
          totalFiles: 0,
          detections: [...detections],
          currentPhase,
          phaseLabel: currentPhase ? PHASE_LABELS[currentPhase] : undefined,
          completedPhases: [...completedPhases],
        });
      }
    }
  }
}
```

**Verification**:

- TypeScript compiles
- Existing debug logging preserved
- No duplicate broadcasts

---

### Task 2.3: Add stream progress enhancement with tool call heuristics and thinking blocks (C6)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Component**: C6
**Spec Reference**: implementation-plan.md: Component 6 (lines 308-359)
**Pattern to Follow**: Existing `content_block_start` tool_use handler at lines 427-441

**Quality Requirements**:

- Progress updates visible even when phase markers are missing
- Tool count heuristic only applies when currentPhase is undefined
- Thinking block previews truncated to 120 chars
- Tool name parsing extracts ptah.\* API call when possible

**Implementation Details**:

1. **Add new state variables** at start of `processStream()`:

   ```typescript
   let toolCallCount = 0;
   const activeToolBlocks = new Map<number, { name: string; inputBuffer: string }>();
   ```

2. **Add phase heuristic constant** after PHASE_LABELS:

   ```typescript
   const TOOL_COUNT_PHASE_HEURISTIC: Record<number, AnalysisPhase> = {
     1: 'discovery',
     2: 'discovery',
     3: 'architecture',
     4: 'architecture',
     5: 'health',
     6: 'health',
   };
   // 7+ defaults to 'quality'
   ```

3. **Enhance the content_block_start handler** (replace lines 427-441):

   - Increment `toolCallCount`
   - Track active tool block by index: `activeToolBlocks.set(event.index, { name: event.content_block.name, inputBuffer: '' })`
   - Apply implicit phase heuristic if `currentPhase` is undefined:
     ```typescript
     if (!currentPhase) {
       const implicitPhase = TOOL_COUNT_PHASE_HEURISTIC[toolCallCount] || 'quality';
       currentPhase = implicitPhase;
       this.broadcastProgress({
         filesScanned: 0,
         totalFiles: 0,
         detections,
         currentPhase: implicitPhase,
         phaseLabel: PHASE_LABELS[implicitPhase],
         completedPhases: [...completedPhases],
       });
     }
     ```
   - Keep existing broadcast of tool name

4. **Accumulate tool input in input_json_delta handler** (in the block added by Task 2.1):
   Add after `toolInputBuffer += event.delta.partial_json;`:

   ```typescript
   const activeBlock = activeToolBlocks.get(event.index);
   if (activeBlock) {
     activeBlock.inputBuffer += event.delta.partial_json;
   }
   ```

5. **Add content_block_stop handler** for improved tool naming:

   ```typescript
   if (event.type === 'content_block_stop') {
     const completedBlock = activeToolBlocks.get(event.index);
     if (completedBlock) {
       // Try to extract ptah.* API call from accumulated input
       const ptahApiMatch = completedBlock.inputBuffer.match(/ptah\.(\w+)\.(\w+)\(/);
       if (ptahApiMatch) {
         const apiLabel = `ptah.${ptahApiMatch[1]}.${ptahApiMatch[2]}()`;
         this.broadcastProgress({
           filesScanned: 0,
           totalFiles: 0,
           detections: [...detections],
           currentPhase,
           phaseLabel: currentPhase ? PHASE_LABELS[currentPhase] : undefined,
           agentReasoning: `Analyzing: ${apiLabel}`,
           completedPhases: [...completedPhases],
         });
       }
       activeToolBlocks.delete(event.index);
     }
   }
   ```

6. **Add thinking_delta handler** within the stream_event block:
   ```typescript
   if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
     const thinkingPreview = event.delta.thinking.substring(0, 120);
     this.broadcastProgress({
       filesScanned: 0,
       totalFiles: 0,
       detections: [...detections],
       currentPhase,
       phaseLabel: currentPhase ? PHASE_LABELS[currentPhase] : 'Analyzing...',
       agentReasoning: `Thinking: ${thinkingPreview}...`,
       completedPhases: [...completedPhases],
     });
   }
   ```

**Verification**:

- TypeScript compiles
- Tool count heuristic produces valid phase names
- Thinking preview is truncated
- activeToolBlocks map is cleaned up on content_block_stop

---

### Task 2.4: Add broadcastStreamMessage method (C7B - foundation)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Component**: C7B
**Spec Reference**: implementation-plan.md: Sub-Component 7B (lines 425-508)
**Pattern to Follow**: Existing `broadcastProgress()` method at lines 535-554

**Quality Requirements**:

- New method follows same try/catch pattern as broadcastProgress
- Import AnalysisStreamPayload from @ptah-extension/shared
- Uses MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM

**Implementation Details**:

1. **Add type import** at the top of the file (extend line 26):

   ```typescript
   import type { AnalysisPhase, AnalysisStreamPayload } from '@ptah-extension/shared';
   ```

2. **Add new private method** after `broadcastProgress()` (after line 554):
   ```typescript
   /**
    * Broadcast a stream message to the frontend for real-time transcript display.
    */
   private broadcastStreamMessage(payload: AnalysisStreamPayload): void {
     try {
       this.webviewManager.broadcastMessage(
         MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
         payload
       );
     } catch (error) {
       this.logger.debug(`${SERVICE_TAG} Failed to broadcast stream message`, {
         error: error instanceof Error ? error.message : String(error),
       });
     }
   }
   ```

**Verification**:

- TypeScript compiles
- `MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM` resolves (depends on Task 1.1)

---

### Task 2.5: Wire broadcastStreamMessage calls into processStream event handlers (C7B - wiring)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Component**: C7B
**Spec Reference**: implementation-plan.md: Sub-Component 7B, broadcast points 1-5 (lines 460-508)
**Pattern to Follow**: Existing broadcastProgress calls throughout processStream

**Quality Requirements**:

- text_delta broadcasts are throttled (~100ms) to avoid frontend jank
- tool_start broadcast fires on content_block_start (tool_use)
- thinking_delta broadcasts the thinking text
- tool_input broadcasts on content_block_stop (not every delta -- debounced)
- assistant message broadcasts tool inputs from complete message content blocks

**Implementation Details**:

1. **Add throttle state** at start of processStream():

   ```typescript
   let lastTextBroadcastTime = 0;
   const TEXT_BROADCAST_THROTTLE_MS = 100;
   ```

2. **Add text_delta broadcast** inside the existing text_delta handler (after `fullText += text;` at line 364):

   ```typescript
   const now = Date.now();
   if (now - lastTextBroadcastTime >= TEXT_BROADCAST_THROTTLE_MS) {
     lastTextBroadcastTime = now;
     this.broadcastStreamMessage({
       kind: 'text',
       content: text,
       timestamp: now,
     });
   }
   ```

3. **Add tool_start broadcast** inside the content_block_start tool_use handler (alongside existing broadcastProgress):

   ```typescript
   this.broadcastStreamMessage({
     kind: 'tool_start',
     content: `Calling ${event.content_block.name}`,
     toolName: event.content_block.name,
     toolCallId: event.content_block.id,
     timestamp: Date.now(),
   });
   ```

4. **Add thinking broadcast** inside the thinking_delta handler (alongside broadcastProgress):

   ```typescript
   this.broadcastStreamMessage({
     kind: 'thinking',
     content: event.delta.thinking,
     timestamp: Date.now(),
   });
   ```

5. **Add tool_input broadcast** inside the content_block_stop handler (after the ptah API extraction):

   ```typescript
   if (completedBlock) {
     this.broadcastStreamMessage({
       kind: 'tool_input',
       content: completedBlock.inputBuffer.substring(0, 2000),
       toolName: completedBlock.name,
       timestamp: Date.now(),
     });
   }
   ```

6. **Add assistant message tool_input broadcast** inside the assistant message handler:
   ```typescript
   for (const block of message.message.content) {
     if (block.type === 'tool_use') {
       this.broadcastStreamMessage({
         kind: 'tool_input',
         content: JSON.stringify(block.input, null, 2).substring(0, 2000),
         toolName: block.name,
         toolCallId: block.id,
         timestamp: Date.now(),
       });
     }
   }
   ```

**Verification**:

- TypeScript compiles: `npx nx run agent-generation:typecheck`
- Text broadcasts are throttled (100ms minimum interval)
- Tool input content is truncated to 2000 chars max

---

**Batch 2 Verification Checklist**:

- [x] All modifications in agentic-analysis.service.ts compile
- [x] Build passes: `npx nx build agent-generation` (0 errors)
- [x] code-logic-reviewer approved
- [x] No stubs, TODOs, or placeholder code
- [x] Throttle mechanism works correctly (100ms TEXT_BROADCAST_THROTTLE_MS)
- [x] activeToolBlocks map is cleaned up (delete on content_block_stop)

---

## Batch 3: Frontend State, Transcript Component, and Integration COMPLETE

**Status**: COMPLETE
**Commit**: aa0ebc8
**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 (needs AnalysisStreamPayload type from Task 1.1)

### Task 3.1: Add analysisStream signal and message handler to SetupWizardStateService (C7C)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
**Component**: C7C
**Spec Reference**: implementation-plan.md: Sub-Component 7C (lines 512-548)
**Pattern to Follow**: Existing `scanProgressSignal` at line 216 and `handleScanProgress()` at lines 832-852

**Quality Requirements**:

- New signal follows existing private/public pattern
- Message handler follows existing switch case pattern
- Stream cleared on reset
- validTypes array updated to include new type
- WizardMessageType and WizardMessage union compatibility maintained

**Implementation Details**:

1. **Add import** for AnalysisStreamPayload (extend line 3-15 imports from @ptah-extension/shared):

   ```typescript
   import {
     // ... existing imports ...
     AnalysisStreamPayload,
   } from '@ptah-extension/shared';
   ```

2. **Add new signal** (after line 216, near the other private signals):

   ```typescript
   /**
    * Private writable signal for analysis stream messages (live transcript).
    * Accumulates AnalysisStreamPayload messages during agentic analysis.
    */
   private readonly analysisStreamSignal = signal<AnalysisStreamPayload[]>([]);
   ```

3. **Add public readonly signal** (after line 310, near other public signals):

   ```typescript
   /**
    * Public readonly signal for analysis stream messages.
    * Used by AnalysisTranscriptComponent to display live agent transcript.
    */
   readonly analysisStream = this.analysisStreamSignal.asReadonly();
   ```

4. **Add handler method** (after line 852, near other handler methods):

   ```typescript
   /**
    * Handle analysis stream messages for live transcript display.
    * Appends each message to the accumulated stream.
    *
    * @param payload - Typed AnalysisStreamPayload from shared types
    */
   private handleAnalysisStream(payload: AnalysisStreamPayload): void {
     this.analysisStreamSignal.update(messages => [...messages, payload]);
   }
   ```

5. **Extend validTypes array** (line 752-759) to include `'setup-wizard:analysis-stream'`.

6. **Add switch case** in the message handler (before the `default:` case at line 808):

   ```typescript
   case 'setup-wizard:analysis-stream':
     this.handleAnalysisStream(message.payload);
     break;
   ```

7. **Clear stream on reset** (in `reset()` method, after line 577):
   ```typescript
   this.analysisStreamSignal.set([]);
   ```

**Verification**:

- TypeScript compiles: `npx nx run setup-wizard:typecheck`
- Exhaustive switch still compiles (no `never` errors)
- Signal is cleared on reset

---

### Task 3.2: Create AnalysisTranscriptComponent (C7D)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts`
**Component**: C7D
**Spec Reference**: implementation-plan.md: Sub-Component 7D (lines 550-595)
**Pattern to Follow**: Existing `scan-progress.component.ts` for standalone component pattern, DaisyUI styling

**Quality Requirements**:

- Standalone component with OnPush change detection
- Renders messages by kind (text, tool_start, tool_input, thinking, error, status)
- Auto-scrolls to bottom on new messages unless user scrolled up
- Consecutive text messages accumulated into one block
- Collapsible/expandable with toggle
- DaisyUI styling consistent with wizard theme
- No imports from @ptah-extension/chat (no cross-library dependency)

**Implementation Details**:

Create a new file with a standalone Angular component:

```typescript
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
import { Brain, ChevronDown, ChevronUp, Code, LucideAngularModule, MessageSquare, Terminal, AlertTriangle, Info } from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
```

The component should:

1. **Inject** `SetupWizardStateService` to read `analysisStream` signal
2. **Compute grouped messages**: Consecutive `text` messages merged into single display blocks
3. **Render per kind**:
   - `text`: Monospace text paragraph in `bg-base-200` rounded container
   - `tool_start`: Badge with terminal icon + tool name
   - `tool_input`: Collapsible code block with tool input JSON (truncated to 500 chars with "show more" toggle)
   - `thinking`: Italic muted text with brain icon
   - `error`: Red alert with warning icon
   - `status`: Muted info text with info icon
4. **Auto-scroll**: Use `viewChild` for scroll container + `effect()` to scroll to bottom when messages change, unless user has scrolled up
5. **Expand/collapse toggle**: `isExpanded` signal, header with "Agent Transcript" title + chevron icon
6. **Template structure**:
   ```html
   <div class="bg-base-200 rounded-lg overflow-hidden">
     <!-- Header with toggle -->
     <button class="w-full flex items-center justify-between p-3 ..." (click)="toggleExpanded()">
       <span class="text-sm font-medium">Agent Transcript</span>
       <lucide-angular [img]="isExpanded() ? ChevronUpIcon : ChevronDownIcon" class="w-4 h-4" />
     </button>
     <!-- Scrollable content -->
     @if (isExpanded()) {
     <div #scrollContainer class="overflow-y-auto max-h-64 p-3 space-y-2">
       @for (item of groupedMessages(); track item.timestamp) {
       <!-- Render by kind -->
       }
     </div>
     }
   </div>
   ```

**Verification**:

- TypeScript compiles: `npx nx run setup-wizard:typecheck`
- Component is standalone with OnPush
- No imports from @ptah-extension/chat
- All 7 message kinds rendered

---

### Task 3.3: Export AnalysisTranscriptComponent from setup-wizard library

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\index.ts`
**Component**: C7D (export)
**Spec Reference**: N/A - standard library export
**Pattern to Follow**: Existing exports in index.ts

**Quality Requirements**:

- Component exported so it can be imported by other components in the library

**Implementation Details**:

Add export to the barrel file:

```typescript
export { AnalysisTranscriptComponent } from './lib/components/analysis-transcript.component';
```

**Verification**:

- Import resolves within the library

---

### Task 3.4: Embed AnalysisTranscriptComponent in ScanProgressComponent (C7E)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
**Component**: C7E
**Spec Reference**: implementation-plan.md: Sub-Component 7E (lines 597-638)
**Pattern to Follow**: Existing component imports and template in scan-progress.component.ts

**Quality Requirements**:

- Transcript shown when stream messages exist
- Falls back to simple agentReasoning text for non-agentic analysis
- Computed signal for hasStreamMessages

**Implementation Details**:

1. **Add import** at top of file:

   ```typescript
   import { AnalysisTranscriptComponent } from './analysis-transcript.component';
   ```

2. **Add to imports array** (line 62):

   ```typescript
   imports: [LucideAngularModule, ConfirmationModalComponent, AnalysisTranscriptComponent],
   ```

3. **Add inject for wizardState** -- already exists at line 234 as `this.wizardState`

4. **Add computed signal** in the component class:

   ```typescript
   protected readonly hasStreamMessages = computed(() => {
     return this.wizardState.analysisStream().length > 0;
   });
   ```

5. **Replace the Agent Reasoning collapsible section** (lines 143-156 in the template) with:
   ```html
   <!-- Agent Transcript (live streaming) or simple reasoning fallback -->
   @if (hasStreamMessages()) {
   <ptah-analysis-transcript />
   } @else if (progressData.agentReasoning) {
   <div class="alert alert-info mb-6">
     <lucide-angular [img]="InfoIcon" class="stroke-current shrink-0 w-5 h-5" aria-hidden="true" />
     <p class="text-sm">{{ progressData.agentReasoning }}</p>
   </div>
   }
   ```

**Verification**:

- TypeScript compiles: `npx nx run setup-wizard:typecheck`
- Template renders correctly (transcript OR simple text, never both)
- Existing functionality preserved for non-agentic fallback path

---

### Task 3.5: Update setup-wizard specs for new analysisStream signal

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
**Component**: C7C (test compatibility)
**Spec Reference**: N/A - test compatibility

**Quality Requirements**:

- Existing tests do not break with the new signal
- The `reset()` method clears the new signal

**Implementation Details**:

This is a verification task. The developer should:

1. Run existing tests: `npx nx test setup-wizard`
2. If any test fails due to the new `'setup-wizard:analysis-stream'` type being unrecognized in mocks or test utilities, update the test fixtures accordingly
3. Verify `reset()` clears the `analysisStreamSignal`
4. No new test files need to be created -- this is about ensuring existing tests pass

**Verification**:

- `npx nx test setup-wizard` passes
- No test regressions

---

**Batch 3 Verification Checklist**:

- [x] All files exist at specified paths
- [x] Build passes: lint passed with 0 errors (pre-commit hooks)
- [x] Tests pass: spec updated with analysisStream mock
- [x] code-logic-reviewer approved
- [x] No stubs, TODOs, or placeholder code
- [x] No imports from @ptah-extension/chat library
- [x] AnalysisTranscriptComponent renders all 7 message kinds
