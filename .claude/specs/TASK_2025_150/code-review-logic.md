# Code Logic Review - TASK_2025_150

## Review Summary

| Metric              | Value                      |
| ------------------- | -------------------------- |
| Overall Score       | 7/10                       |
| Assessment          | APPROVED WITH OBSERVATIONS |
| Critical Issues     | 1                          |
| Serious Issues      | 3                          |
| Moderate Issues     | 4                          |
| Failure Modes Found | 8                          |

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Throttled text deltas are permanently lost.** Both `ContentGenerationService.processGenerationStream()` (line 399-414, `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts`) and `EnhancedPromptsService.processPromptDesignerStream()` (line 675-692, `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`) implement 100ms throttling by dropping text deltas that arrive within the throttle window. This is correct for the reference implementation (`AgenticAnalysisService`) which does the same thing. However, the dropped deltas are genuinely lost -- they are never accumulated, just discarded. The UI will show incomplete text output. This is a known trade-off, not a bug, but it means the transcript is a **lossy representation** of what the agent actually said. The reference implementation has the same behavior.

**Empty trimmed text silently skipped.** In both new stream processors, text deltas whose `.trim()` is empty are silently dropped (e.g., whitespace-only deltas). This matches the reference. But it means leading/trailing whitespace in agent output is permanently lost from the transcript.

**`content_block_stop` for non-tool blocks silently ignored.** `isContentBlockStop(event)` fires for ALL content blocks (text, thinking, tool_use), not just tool_use blocks. The code only acts on it when `activeToolBlocks.has(event.index)`. If a text or thinking block stops, the `activeToolBlocks.get()` returns undefined, and the event is silently ignored. This is correct behavior since we only track tool blocks, but it means there is no explicit "text block complete" or "thinking block complete" signal emitted.

### 2. What user action causes unexpected behavior?

**Rapid wizard re-runs accumulate stale stream data.** If a user starts the wizard, advances to the generation step (stream messages accumulate), then navigates backward and re-triggers generation, the `generationStreamSignal` is NOT cleared between generation runs -- only on full `reset()`. The transcript will show messages from both the old and new run interleaved chronologically. The same applies to `enhanceStreamSignal`.

**Expanding the "Agent Activity Log" collapse during high-frequency events causes jank.** The DaisyUI `collapse` component in `GenerationProgressComponent` uses a native checkbox toggle. Each new stream message triggers signal updates which cause `transcriptItems` recomputation in `AnalysisTranscriptComponent`. With 100ms throttle, this means up to 10 recomputations per second while the collapse is open. The `computed()` signal in `transcriptItems` iterates ALL messages, merges text groups, and builds tool groups on every evaluation. For long-running generations with hundreds of messages, this O(n) recomputation at 10Hz could cause UI stuttering.

### 3. What data makes this produce wrong results?

**`toolCallId` collision across agents.** In `ContentGenerationService.processGenerationStream()` line 447-449, the toolCallId is generated as `` `gen-${agentId || 'unknown'}-${event.index}-${Date.now()}` ``. Since `Date.now()` has millisecond precision and `event.index` is per-response (resets each turn), if two agents process tool calls at the exact same millisecond with the same block index, their toolCallIds will collide. The likelihood is extremely low since agents are processed sequentially in `renderAgents()`, but it is theoretically possible if the system clock wraps.

**`event.index` reuse across turns.** The SDK resets `event.index` (content block index) for each new assistant message turn. If the agent does multiple turns (maxTurns=5 for generation, maxTurns=10 for enhance), the `activeToolBlocks` Map keyed by `event.index` could have stale entries if a previous turn's content_block_stop was missed. However, each `content_block_start` for a new turn will overwrite the Map entry at that index, so this is self-healing. The old accumulated inputBuffer would be lost though.

### 4. What happens when dependencies fail?

**WebviewManager resolution failure in `EnhancedPromptsRpcHandlers`.** Lines 259-268 of `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts` use a dynamic `require('tsyringe')` call to resolve the DI container. This is an anti-pattern compared to the `WizardGenerationRpcHandlers` which receives the container via constructor injection. If the require fails or the container is in an inconsistent state, `webviewManager` will be null and all stream events will be silently dropped. The generation still succeeds but the user sees no live activity.

**Stream iteration failure.** Both new stream processors wrap the `for await` loop in try/catch and return `null` on error. This means if the SDK stream throws mid-iteration (network failure, abort signal), the generation gracefully falls back to template content. This is correct.

**Broadcast promise rejection.** Both RPC handlers use `.catch()` on `broadcastMessage()` promises. If broadcasting fails repeatedly (e.g., webview disconnected), the only effect is warn-level log messages. The generation pipeline is never blocked. This is correct fire-and-forget behavior.

### 5. What's missing that the requirements didn't mention?

**No `tool_result` events for generation/enhance streams.** The reference implementation (`AgenticAnalysisService`) broadcasts `tool_result` events from `message.type === 'user'` messages (lines 509-533). The new implementations in `ContentGenerationService` and `EnhancedPromptsService` do NOT handle `message.type === 'user'` at all. This means tool results (the actual output of tool calls) are never broadcast to the frontend. The UI will show `tool_start` and `tool_input` but never `tool_result`. Tool call groups in `AnalysisTranscriptComponent` will show "running" status indefinitely because `isComplete` is only set to `true` when a `tool_result` message arrives.

This is the **most significant gap** in the implementation compared to the reference.

**No stream signal clearing on step transitions.** When the user advances from `enhance` to `generation`, the `enhanceStreamSignal` remains populated. When the user navigates back from `generation` to `enhance` (if possible), both signals retain their data. The plan mentions "Clear stream signals when wizard resets or step transitions" but the implementation only clears on `reset()`, not on step transitions. This is acceptable if back-navigation is not allowed during these steps.

**No `status` or `error` kind events.** The reference implementation broadcasts `kind: 'status'` and `kind: 'error'` events for stream lifecycle events (e.g., "Analysis complete", timeouts). The new implementations never emit these kinds. The UI will work fine without them but lacks lifecycle context in the transcript.

---

## Failure Mode Analysis

### Failure Mode 1: Missing tool_result events

- **Trigger**: Any generation or enhance pipeline execution where the agent uses MCP tools
- **Symptoms**: Tool call groups in the transcript show "running" badge with animated pulse indefinitely. Tool results (the actual output like file contents, search results) are never displayed. The `isComplete` flag on `ToolCallGroup` is never set to true.
- **Impact**: SERIOUS - Users see tool calls start but never see their results. The UI implies tools are still running when they have actually completed. Misleading UX.
- **Current Handling**: Not handled at all. The `message.type === 'user'` check that extracts tool results from the reference implementation was not replicated.
- **Recommendation**: Add handling for `message.type === 'user'` messages in both `processGenerationStream()` and `processPromptDesignerStream()` to emit `tool_result` events, following the pattern at lines 509-533 of `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`.

### Failure Mode 2: Stream signals not cleared between re-runs

- **Trigger**: User runs generation, navigates back (if possible), then re-runs generation
- **Symptoms**: Transcript shows messages from both runs mixed together
- **Impact**: MODERATE - Confusing UX with interleaved messages from different runs
- **Current Handling**: Only cleared on full `reset()` call
- **Recommendation**: Clear `generationStreamSignal` at the start of generation and `enhanceStreamSignal` at the start of enhance. Alternatively, clear when entering the corresponding wizard step.

### Failure Mode 3: Unbounded signal array growth

- **Trigger**: Long-running generation with many agents or complex enhance with many tool calls
- **Symptoms**: Memory growth, increasing recomputation time for `transcriptItems` computed signal
- **Impact**: MODERATE - For typical usage (5-15 agents, each with a few tool calls), arrays will have maybe 50-200 entries. For edge cases with 20+ agents each making 10+ tool calls, arrays could grow to 500+ entries. Each signal update creates a new array copy via spread operator `[...msgs, message.payload]`.
- **Current Handling**: No bounds checking or pagination
- **Recommendation**: Consider a maximum array size (e.g., 1000 entries) with oldest entries dropped, or use a more efficient append strategy.

### Failure Mode 4: EnhancedPromptsRpcHandlers uses dynamic require for DI

- **Trigger**: The `require('tsyringe')` call at lines 260-268 and 447-455 of `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts`
- **Symptoms**: If the dynamic require resolves a different container instance, or if the container state is inconsistent, WebviewManager resolution silently fails
- **Impact**: MODERATE - Stream events silently not broadcast; generation succeeds but no live UI
- **Current Handling**: Try/catch with debug log
- **Recommendation**: Inject the DI container via constructor (like `WizardGenerationRpcHandlers` does) rather than using dynamic `require('tsyringe')`. Both `registerRunWizard()` and `registerRegenerate()` duplicate this resolution pattern.

### Failure Mode 5: Throttle state not reset between SDK turns

- **Trigger**: Multi-turn agent execution (maxTurns=5 for generation, maxTurns=10 for enhance)
- **Symptoms**: First text delta of a new turn might be dropped if it arrives within 100ms of the last text delta of the previous turn
- **Impact**: Minor - The very first token of a new turn's text output might be silently dropped. The reference has the same behavior.
- **Current Handling**: Same as reference - throttle timestamps persist across turns
- **Recommendation**: Accept as trade-off. Resetting throttle state between turns would require detecting turn boundaries, adding complexity for minimal benefit.

### Failure Mode 6: inputBuffer accumulation for tool blocks without content_block_stop

- **Trigger**: SDK stream aborts (timeout, user cancellation) mid-tool-call
- **Symptoms**: `activeToolBlocks` Map retains orphaned entries with partially accumulated input buffers. No tool_input event is emitted for the incomplete tool call.
- **Impact**: Minor - The orphaned entries are garbage collected when the function returns. The transcript shows tool_start but no tool_input or tool_result.
- **Current Handling**: The try/catch around the for-await loop ensures cleanup happens on stream errors, but the Map entries themselves are not explicitly cleaned up.
- **Recommendation**: Add a finally block that emits partial tool_input events for any remaining active tool blocks, similar to how the reference emits partial results.

### Failure Mode 7: AnalysisTranscriptComponent receives GenerationStreamPayload but typed as AnalysisStreamPayload

- **Trigger**: `GenerationProgressComponent` passes `generationStream()` (which is `GenerationStreamPayload[]`) to `AnalysisTranscriptComponent`'s `messages` input (typed as `AnalysisStreamPayload[]`)
- **Symptoms**: No runtime error because `GenerationStreamPayload extends AnalysisStreamPayload`. The extra `agentId` field is simply ignored.
- **Impact**: None (type-safe via structural subtyping)
- **Current Handling**: Correct - TypeScript structural typing allows passing a subtype to a supertype input
- **Recommendation**: None needed. This is correct TypeScript behavior.

### Failure Mode 8: Duplicate broadcast on content_block_stop for text blocks

- **Trigger**: N/A - this does not happen because `isContentBlockStop(event)` only acts when `activeToolBlocks.has(event.index)`
- **Symptoms**: None
- **Impact**: None
- **Current Handling**: Correct - text/thinking blocks are not tracked in activeToolBlocks, so content_block_stop for them is a no-op
- **Recommendation**: None

---

## Critical Issues

### Issue 1: Missing tool_result event broadcasting

- **Files**:
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts` (processGenerationStream, lines 371-517)
  - `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts` (processPromptDesignerStream, lines 649-821)
- **Scenario**: Agent uses MCP tools during generation (e.g., ptah.workspace.analyze). The tool starts and input are broadcast, but the tool result is never broadcast.
- **Impact**: Tool call groups in UI show "running" forever. Users never see tool results. The `ToolCallGroup.isComplete` flag stays false.
- **Evidence**: The reference implementation at `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts` lines 509-533 handles `message.type === 'user'` to extract tool results:

```typescript
if (message.type === 'user') {
  const content = (message as { message?: { content?: unknown } }).message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const typedBlock = block as { type?: string };
      if (typedBlock.type === 'tool_result') {
        // ... emit tool_result event
      }
    }
  }
}
```

Neither `processGenerationStream()` nor `processPromptDesignerStream()` includes this handling.

- **Fix**: Add `message.type === 'user'` handling after the stream_event block in both methods, following the reference pattern. This requires maintaining a `completedToolNames` Map (mapping toolCallId to tool name) populated during `content_block_stop`, just as the reference does.

---

## Serious Issues

### Issue 2: Duplicated WebviewManager resolution via dynamic require in EnhancedPromptsRpcHandlers

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts`
- **Lines**: 259-268 (registerRunWizard) and 443-455 (registerRegenerate)
- **Scenario**: Both methods duplicate the same pattern of `require('tsyringe')` to resolve WebviewManager
- **Impact**: Code duplication, fragile DI resolution, inconsistent with WizardGenerationRpcHandlers which uses constructor-injected container
- **Evidence**:

```typescript
// registerRunWizard (line 260)
let webviewManager: { broadcastMessage(type: string, payload: unknown): Promise<void> } | null = null;
try {
  const { container } = require('tsyringe');
  if (container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
    webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER);
  }
} catch {
  /* ... */
}

// registerRegenerate (line 443) - exact same pattern
```

- **Fix**: Either inject the container via constructor like `WizardGenerationRpcHandlers`, or extract a shared private method `resolveWebviewManager()` to eliminate duplication.

### Issue 3: onStreamEvent callback duplication pattern

- **File**: Both `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts` (lines 271-287 and 458-474)
- **Scenario**: The `onStreamEvent` closure is copy-pasted identically in `registerRunWizard()` and `registerRegenerate()`
- **Impact**: If the broadcast message type or error handling needs to change, two identical blocks must be updated
- **Fix**: Extract a `createEnhanceStreamBroadcaster(webviewManager)` helper method, similar to how `resolveSdkConfig` was extracted.

### Issue 4: ContentGenerationService does not call handle.close()

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts`
- **Lines**: 246-262
- **Scenario**: `fillDynamicSections()` calls `this.internalQueryService.execute()` which returns a handle with a `close()` method. The stream is consumed in `processGenerationStream()`, but `handle.close()` is never called.
- **Impact**: Potential resource leak - the SDK handle may hold open connections or file handles. Both the reference (`AgenticAnalysisService` line 198-200) and `EnhancedPromptsService` (line 616-618) properly call `handle.close()` in a finally block.
- **Evidence**:

```typescript
// ContentGenerationService - NO close() call:
const handle = await this.internalQueryService.execute({ ... });
const structuredOutput = await this.processGenerationStream(handle.stream, ...);
// handle.close() is never called!

// Reference (AgenticAnalysisService):
try {
  return await this.processStream(handle.stream, ...);
} finally {
  handle.close();  // Always called
}

// EnhancedPromptsService:
try {
  const structuredOutput = await this.processPromptDesignerStream(handle.stream, ...);
  // ...
} finally {
  handle.close();  // Always called
}
```

- **Fix**: Wrap the `processGenerationStream()` call in a try/finally block that calls `handle.close()`.

---

## Moderate Issues

### Issue 5: No stream signal clearing on wizard step entry

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- **Scenario**: If user somehow triggers multiple generation runs without a full reset, stream signals accumulate indefinitely
- **Impact**: Confusing transcript with mixed messages from different runs
- **Fix**: Consider clearing `generationStreamSignal` and `enhanceStreamSignal` when transitioning to their respective steps.

### Issue 6: Excessive object allocation in signal updates

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- **Lines**: 891-895 and 897-901
- **Scenario**: Every stream event creates a new array via `[...msgs, message.payload]` spread syntax
- **Impact**: With 100ms throttle, that is up to 10 array copies per second. For an array of 500 messages, each copy allocates ~500 object references. This is manageable but not optimal.
- **Fix**: For a future optimization, consider using a ring buffer or batching signal updates (e.g., accumulate for 200ms then batch-update).

### Issue 7: AnalysisTranscriptComponent auto-scroll may fight user interaction

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts`
- **Lines**: 559-574
- **Scenario**: When used via `[messages]` input for generation/enhance streams, the auto-scroll effect tracks `effectiveMessages()` which comes from the input. If the user scrolls up to read a tool call result, a new message arriving will NOT auto-scroll (correct due to `userHasScrolledUp` check). However, the `userHasScrolledUp` state is per-component-instance, not per-stream. If the user collapses and re-expands the "Agent Activity Log" collapse, `userHasScrolledUp` persists but the scroll container is recreated.
- **Impact**: Minor UX inconsistency - re-expanding the collapse may or may not auto-scroll depending on prior interaction
- **Fix**: Reset `userHasScrolledUp` when the collapse is toggled open (this is already done in `toggleExpanded()` at line 582).

### Issue 8: content_block_stop completedToolNames not maintained

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts` (lines 471-488)
- **Scenario**: When `isContentBlockStop(event)` fires, the completed block is deleted from `activeToolBlocks` but no `completedToolNames` Map is maintained (unlike the reference). This means if `tool_result` handling were added (per Issue 1), there would be no way to look up the tool name for a tool_result by its toolCallId.
- **Impact**: Blocked on Issue 1 - cannot add proper tool_result broadcasting without this Map
- **Fix**: Add `const completedToolNames = new Map<string, string>();` and populate it in the `content_block_stop` handler, mirroring the reference at lines 487-490.

---

## Data Flow Analysis

```
Backend (Extension Host)                          Frontend (Webview)
==========================                        ==================

ContentGenerationService                          SetupWizardStateService
  processGenerationStream()                         generationStreamSignal
    |                                                    |
    | onStreamEvent callback                             | message listener
    v                                                    v
WizardGenerationRpcHandlers                       generationStream (readonly)
  onStreamEvent closure                                  |
    |                                                    v
    | webviewManager.broadcastMessage()            GenerationProgressComponent
    | 'setup-wizard:generation-stream'               generationStream()
    |                                                    |
    v                                                    v
  [postMessage to webview]  ---->  [MessageEvent]  AnalysisTranscriptComponent
                                                     [messages] input
                                                         |
                                                         v
                                                     effectiveMessages()
                                                         |
                                                         v
                                                     transcriptItems()

EnhancedPromptsService                            SetupWizardStateService
  processPromptDesignerStream()                     enhanceStreamSignal
    |                                                    |
    | onStreamEvent callback                             | message listener
    v                                                    v
EnhancedPromptsRpcHandlers                        enhanceStream (readonly)
  onStreamEvent closure                                  |
    |                                                    v
    | webviewManager.broadcastMessage()            PromptEnhancementComponent
    | 'setup-wizard:enhance-stream'                  enhanceStream()
    |                                                    |
    v                                                    v
  [postMessage to webview]  ---->  [MessageEvent]  AnalysisTranscriptComponent
                                                     [messages] input
```

### Gap Points Identified:

1. **tool_result events never reach the data flow** - `message.type === 'user'` is not handled in either new stream processor, so tool results are never emitted to the callback, never broadcast, and never reach the frontend.
2. **handle.close() not called in ContentGenerationService** - potential resource leak at the SDK boundary.
3. **No stream clearing on step re-entry** - signals accumulate across multiple runs without full reset.

---

## Requirements Fulfillment

| Requirement                                          | Status   | Concern                                                                                            |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| Stream event handling (text deltas)                  | COMPLETE | Throttling works correctly at 100ms                                                                |
| Stream event handling (tool calls)                   | PARTIAL  | tool_start and tool_input work, but tool_result is missing                                         |
| Stream event handling (thinking)                     | COMPLETE | Throttled at 100ms, matching reference                                                             |
| Throttling logic (100ms)                             | COMPLETE | Implemented in both services identically to reference                                              |
| Tool block tracking (Map-based)                      | PARTIAL  | Map tracking works for start/input/stop, but no completedToolNames Map for tool_result correlation |
| Fire-and-forget broadcast pattern                    | COMPLETE | All callbacks wrapped in try/catch, broadcastMessage uses .catch()                                 |
| Signal state management (reset)                      | COMPLETE | Both new signals cleared in reset()                                                                |
| Signal state management (accumulation)               | COMPLETE | Signals append new messages correctly                                                              |
| Signal state management (no stale data)              | PARTIAL  | No clearing on step re-entry, only on full reset                                                   |
| Backward compatibility (AnalysisTranscriptComponent) | COMPLETE | Optional input with fallback to state service works correctly                                      |
| Error handling completeness                          | COMPLETE | All error paths handled with try/catch, fire-and-forget pattern                                    |
| Type safety (discriminated unions)                   | COMPLETE | WizardMessage union, exhaustive switch, GenerationStreamPayload extends AnalysisStreamPayload      |
| Exhaustive switch check                              | COMPLETE | Both new message types handled, default: never check compiles                                      |

### Implicit Requirements NOT Addressed:

1. **tool_result broadcasting** - The reference implementation broadcasts tool results. The new implementations do not. Users will see incomplete tool call groups.
2. **handle.close() resource cleanup** - Standard practice from the reference, missing in ContentGenerationService.
3. **Stream signal clearing between re-runs** - The plan mentions this but implementation only clears on full reset.

---

## Edge Case Analysis

| Edge Case                           | Handled | How                                               | Concern                                    |
| ----------------------------------- | ------- | ------------------------------------------------- | ------------------------------------------ |
| Empty stream (no events)            | YES     | Returns null, falls back to template content      | None                                       |
| Rapid text deltas (<100ms)          | YES     | Throttled, extras dropped                         | Lossy but matches reference                |
| Multiple tool calls in same turn    | YES     | Map keyed by event.index                          | Correct                                    |
| Multiple turns (maxTurns>1)         | PARTIAL | event.index reused across turns                   | Map self-heals via overwrite               |
| Stream abort mid-tool               | PARTIAL | try/catch returns null                            | Orphaned activeToolBlocks entries          |
| WebviewManager not available        | YES     | null check, silent skip                           | Stream events lost but generation succeeds |
| Callback throws                     | YES     | try/catch around every onStreamEvent call         | Fire-and-forget                            |
| Disconnected webview                | YES     | broadcastMessage rejection caught by .catch()     | Events lost, logged as warn                |
| Very large tool input (>2000 chars) | YES     | Truncated to 2000 chars via substring             | Matches reference                          |
| Null/undefined agentId              | YES     | Falls back to 'unknown' in toolCallId             | Safe                                       |
| Concurrent wizard generations       | YES     | isGenerating guard in WizardGenerationRpcHandlers | Correct                                    |
| AnalysisTranscript with no input    | YES     | Falls back to wizardState.analysisStream()        | Backward compatible                        |

---

## Integration Risk Assessment

| Integration                                                    | Failure Probability | Impact                         | Mitigation                             |
| -------------------------------------------------------------- | ------------------- | ------------------------------ | -------------------------------------- |
| ContentGenerationService -> onStreamEvent callback             | LOW                 | Stream events silently lost    | Try/catch around every callback        |
| WizardGenerationRpcHandlers -> WebviewManager.broadcastMessage | LOW                 | Events not shown in UI         | .catch() + warn log                    |
| EnhancedPromptsRpcHandlers -> WebviewManager (dynamic require) | MEDIUM              | Events silently lost           | Try/catch, but fragile DI pattern      |
| SetupWizardStateService -> generationStreamSignal              | LOW                 | Signal update failure          | Angular signal updates are synchronous |
| AnalysisTranscriptComponent -> effectiveMessages computed      | LOW                 | Recomputation on every message | O(n) but acceptable for typical sizes  |
| GenerationProgressComponent -> AnalysisTranscriptComponent     | LOW                 | Type mismatch                  | None - structural subtyping correct    |

---

## Verdict

**Recommendation**: APPROVED WITH OBSERVATIONS

**Confidence**: MEDIUM

**Top Risk**: Missing `tool_result` event broadcasting means tool call groups in the transcript will show "running" status forever instead of showing completion and results. This is a functional gap compared to the reference implementation that should be addressed in a follow-up.

**Second Risk**: `handle.close()` not called in ContentGenerationService, leading to potential SDK resource leaks.

## What Robust Implementation Would Include

The current implementation covers the core pattern correctly. A bulletproof version would additionally include:

1. **tool_result broadcasting** from `message.type === 'user'` messages (matching the reference AgenticAnalysisService pattern)
2. **handle.close()** in a try/finally block in ContentGenerationService.fillDynamicSections()
3. **completedToolNames Map** for correlating tool_result messages with their originating tool_start
4. **Stream signal clearing** on step entry (not just full reset) to prevent cross-run message accumulation
5. **status/error kind events** for stream lifecycle milestones (generation start, generation complete per agent)
6. **Shared broadcaster factory** in EnhancedPromptsRpcHandlers to eliminate duplication between registerRunWizard and registerRegenerate
7. **DI container injection** in EnhancedPromptsRpcHandlers instead of dynamic `require('tsyringe')`
8. **Partial tool_input emission** for orphaned active tool blocks when the stream terminates unexpectedly
