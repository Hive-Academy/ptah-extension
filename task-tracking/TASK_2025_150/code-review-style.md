# Code Style Review - TASK_2025_150

## Review Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall Score   | 6.5/10         |
| Assessment      | NEEDS_REVISION |
| Blocking Issues | 1              |
| Serious Issues  | 6              |
| Minor Issues    | 8              |
| Files Reviewed  | 11             |

## The 5 Critical Questions

### 1. What could break in 6 months?

The **massive code duplication** between `ContentGenerationService.processGenerationStream()` and `EnhancedPromptsService.processPromptDesignerStream()` will break. These are ~90 lines of nearly identical stream event handling logic (throttling, tool tracking, event emission). When someone fixes a bug in one, they will forget the other. This is not theoretical -- it is the most predictable failure mode of copy-paste code.

Files:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts:386-489`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts:654-761`

Additionally, the `AgenticAnalysisService` (`D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts:355-440`) has a THIRD copy of this same pattern, but uses raw `event.type` string checks instead of type guard functions. That is three places where stream event handling lives with slightly different approaches.

### 2. What would confuse a new team member?

1. **Why does ContentGenerationService use type guard functions (`isContentBlockDelta`, `isTextDelta`) while AgenticAnalysisService uses raw string comparisons (`event.type === 'content_block_delta'`)?** A new developer would not know which pattern is "correct." The new code in this PR uses the type guard approach, but the existing analysis service does not. There is no documented rationale for the inconsistency.

2. **The local interface mirror pattern in `wizard-generation-rpc.handlers.ts` (`D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts:56-88`).** Two copies of `OrchestratorGenerationOptions` and `GenerationProgress` -- one canonical, one local -- with a comment "Defined locally because this type is not barrel-exported." A new developer will update the canonical one and wonder why their change has no effect in the RPC handler.

3. **The `EnhancedPromptsRpcHandlers` resolves `WebviewManager` via `require('tsyringe')` at runtime** (`D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts:260-268`), while `WizardGenerationRpcHandlers` resolves it via the injected `container` parameter. Same task, two different DI resolution patterns in the same directory.

### 3. What's the hidden complexity cost?

1. **Unbounded memory growth in stream signal arrays.** `SetupWizardStateService` accumulates stream messages into arrays (`generationStreamSignal`, `enhanceStreamSignal`) via `update(msgs => [...msgs, message.payload])`. For a long generation run producing thousands of stream events, this creates increasingly large arrays with O(n) copies on each update. The `analysisStreamSignal` has the same problem, but at least analysis runs are typically shorter. Generation of 13 agents can produce far more events.

   - File: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:891-901`

2. **The `AnalysisTranscriptComponent.transcriptItems` computed signal** (`D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts:464-554`) recomputes the entire grouping pipeline on every new message because the `effectiveMessages` signal changes. With hundreds of messages, this is O(n) recomputation on each append. The component is now shared across three consumers.

### 4. What pattern inconsistencies exist?

1. **Type guard vs string comparison for SDK events**: New code uses imported type guards (`isContentBlockDelta`, `isTextDelta`). Existing `AgenticAnalysisService` uses `event.type === 'content_block_delta'` and `event.delta.type === 'text_delta'`. Same codebase, same task, different approach.

2. **DI resolution pattern for WebviewManager**:

   - `WizardGenerationRpcHandlers`: Uses `this.resolveService<WebviewBroadcaster>(TOKENS.WEBVIEW_MANAGER, 'WebviewManager')` via injected `container`
   - `EnhancedPromptsRpcHandlers`: Uses `const { container } = require('tsyringe'); container.resolve(TOKENS.WEBVIEW_MANAGER)` via runtime import

3. **Tool call ID generation differs**:

   - `ContentGenerationService`: `gen-${agentId || 'unknown'}-${event.index}-${Date.now()}`
   - `EnhancedPromptsService`: `enhance-${event.index}-${Date.now()}`
   - `AgenticAnalysisService`: Uses `event.content_block.id` directly from SDK

   The inconsistency in ID format means the same `AnalysisTranscriptComponent` will group tools differently depending on the source.

4. **Payload type for enhance stream**: `'setup-wizard:enhance-stream'` uses `AnalysisStreamPayload` while `'setup-wizard:generation-stream'` uses `GenerationStreamPayload`. The only difference is `GenerationStreamPayload` adds an optional `agentId`. Since `AnalysisTranscriptComponent` does not read `agentId` at all in the template, there is no functional reason for this type divergence.

### 5. What would I do differently?

1. **Extract a shared `StreamEventBroadcaster` utility** that both `ContentGenerationService` and `EnhancedPromptsService` call. The throttling, tool tracking, and event emission logic is identical and should live in one place. A helper function like:

   ```typescript
   function createStreamEventHandler(onStreamEvent: (event: AnalysisStreamPayload) => void, options?: { agentId?: string; prefix?: string }): (message: SDKMessage) => void;
   ```

2. **Export `OrchestratorGenerationOptions` and `GenerationProgress` from the barrel** instead of maintaining local interface mirrors. The `eslint-disable-next-line @nx/enforce-module-boundaries` comments already show that cross-boundary imports exist in these files.

3. **Use a ring buffer or capped array** for stream signals instead of unbounded accumulation. A simple cap at 1000 messages with `msgs.length > MAX ? msgs.slice(-MAX) : msgs` would prevent memory issues.

4. **Unify the payload type** for both stream message types to `GenerationStreamPayload` (which extends `AnalysisStreamPayload`) so both streams can carry `agentId` if needed in the future.

---

## Blocking Issues

### Issue 1: Massive stream event handling duplication across three services

- **Files**:
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts:386-489`
  - `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts:654-761`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts:355-440` (pre-existing)
- **Problem**: ~90 lines of nearly identical throttle + tool-tracking + event-emission logic copied verbatim between `processGenerationStream()` and `processPromptDesignerStream()`. A third variant exists in `AgenticAnalysisService`. This is a textbook DRY violation that guarantees future divergence.
- **Impact**: Bug fixes or throttle tuning must be applied in three places. The next developer will fix one and forget the others. The inconsistency between the type guard approach (new code) and the string comparison approach (analysis service) compounds the problem.
- **Fix**: Extract a shared utility function (e.g., `createStreamEventProcessor` or `processStreamEventsForBroadcast`) into a common location that all three services can call. The function would accept the `onStreamEvent` callback and return a handler that processes each `SDKMessage`. This is the single most impactful refactor for this task.

---

## Serious Issues

### Issue 1: Inconsistent DI resolution for WebviewManager across RPC handlers

- **Files**:
  - `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts:277-287` (uses injected `container`)
  - `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts:259-268` (uses `require('tsyringe')`)
- **Problem**: `WizardGenerationRpcHandlers` resolves WebviewManager via `this.container.resolve()` (proper DI). `EnhancedPromptsRpcHandlers` uses `const { container } = require('tsyringe')` which bypasses the injected container and accesses the global container directly. This is fragile -- if tests override the container, the enhanced prompts handler will not see the overrides.
- **Tradeoff**: Fixing this requires injecting `DependencyContainer` into `EnhancedPromptsRpcHandlers`, which changes its constructor signature. However, `WizardGenerationRpcHandlers` already demonstrates this pattern works.
- **Recommendation**: Inject `DependencyContainer` into `EnhancedPromptsRpcHandlers` and use the same `this.container.resolve()` pattern.

### Issue 2: Local interface mirrors instead of barrel exports

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts:56-88`
- **Problem**: `GenerationProgress` and `OrchestratorGenerationOptions` are duplicated locally with the comment "Defined locally because this type is not barrel-exported from agent-generation." These are now used in a task that modifies the canonical interfaces (adding `onStreamEvent`). Both the canonical AND local copy must be updated in sync. This is exactly the kind of manual sync that breaks silently.
- **Tradeoff**: Barrel-exporting these types might widen the public API of the library, but the alternative (maintaining two copies) is worse.
- **Recommendation**: Export `OrchestratorGenerationOptions` and `GenerationProgress` from `@ptah-extension/agent-generation` and remove the local mirrors.

### Issue 3: Unbounded stream signal array growth

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:891-901`
- **Problem**: Both `generationStreamSignal.update(msgs => [...msgs, message.payload])` and `enhanceStreamSignal.update(msgs => [...msgs, message.payload])` create new arrays by spreading the entire previous array plus the new item. For a generation run producing 2000+ events, this means 2000 array copies with O(n) per copy. The `analysisStreamSignal` handler at line 961 has the same pattern, but the new streams compound the problem.
- **Tradeoff**: A ring buffer or capped array adds slight complexity but prevents memory issues during long runs.
- **Recommendation**: Add a maximum size cap (e.g., 2000 entries) with `const capped = msgs.length >= MAX_STREAM_MESSAGES ? msgs.slice(-MAX_STREAM_MESSAGES + 1) : msgs; return [...capped, message.payload];`

### Issue 4: Inconsistent tool call ID generation across services

- **Files**:
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts:447-449` -- `gen-${agentId}-${event.index}-${Date.now()}`
  - `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts:723` -- `enhance-${event.index}-${Date.now()}`
  - Existing: `AgenticAnalysisService` uses `event.content_block.id` from the SDK directly.
- **Problem**: Three different formats for `toolCallId`. The `AnalysisTranscriptComponent` groups tool calls by `toolCallId`. While this works because each stream is separate, the inconsistency in ID format conventions is a maintainability concern, and if someone concatenates streams, grouping will not work as expected.
- **Tradeoff**: Using `event.content_block.id` directly from the SDK (like the analysis service) would be the most canonical approach, but that ID is only available at `content_block_start`, requiring it to be threaded through to `content_block_stop`.
- **Recommendation**: Use the SDK-provided `event.content_block.id` where available. Document the ID format convention.

### Issue 5: Missing JSDoc on new `effectiveMessages` computed signal in AnalysisTranscriptComponent

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts:394-396`
- **Problem**: The `effectiveMessages` computed signal has a basic comment but lacks proper JSDoc explaining the fallback behavior and why it exists. The `messages` input has proper JSDoc, but the computed signal that implements the fallback logic -- which is the critical behavioral contract -- does not explain the "when input is undefined, falls back to state service" behavior in a way that is immediately clear.
- **Tradeoff**: Minor documentation gap, but this is the key integration point that makes the component reusable.
- **Recommendation**: Add explicit JSDoc noting the fallback contract: "Returns the externally-provided messages if available; otherwise falls back to the analysis stream from the state service. This enables reuse across generation and enhance transcripts while maintaining backward compatibility with the scan progress transcript."

### Issue 6: `AnalysisTranscriptComponent` hardcoded `id="analysis-transcript-content"` for accessibility

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts:132`
- **Problem**: The component uses `id="analysis-transcript-content"` for `aria-controls`. Now that the component is reused in three places on different views, there could be a scenario where multiple instances exist in the DOM simultaneously (though currently they are in different wizard steps). The `id` attribute must be unique per document. If the component is ever used twice on the same page, accessibility will break and DOM queries will return incorrect elements.
- **Tradeoff**: Using a generated ID (e.g., via Angular's `inject(ElementRef)` or a counter) adds complexity.
- **Recommendation**: Generate a unique ID per component instance, or at minimum document the constraint that only one instance should exist at a time.

---

## Minor Issues

1. **`content-generation.service.ts:40-53` -- Three separate `eslint-disable-next-line` comments for SDK imports**: These could be a single block disable/enable pair. Three back-to-back suppression comments add visual noise.

2. **`content-generation.service.ts:400` -- Trimming text delta before throttle check but emitting untrimmed content**: `const trimmed = event.delta.text.trim()` is used only for the empty check, then `event.delta.text` (untrimmed) is emitted. This is intentional (preserving whitespace in output) but the variable name `trimmed` suggests it will be used for the emission. A comment would clarify.

3. **`enhanced-prompts.service.ts:678` -- Same trim-but-emit-untrimmed pattern**: Identical to the content generation service. Confirms this is intentional but also confirms the duplication issue.

4. **`setup-wizard-state.service.ts:233-241` -- Missing blank line between `generationStreamSignal` and `enhanceStreamSignal` declarations**: The existing pattern in this file uses section comments and spacing between signal groups. The new signals are declared with proper JSDoc but are visually tighter than the surrounding code.

5. **`generation-progress.component.ts:97` -- DaisyUI `collapse` checkbox without controlled state**: The `<input type="checkbox" />` for the collapse is uncontrolled. If the component re-renders or the user navigates away and back, the collapse state resets. The existing `AnalysisTranscriptComponent` uses a signal-controlled `isExpanded` pattern for its toggle. Consider consistency.

6. **`prompt-enhancement.component.ts:147` -- Same uncontrolled checkbox collapse pattern**: Same issue as above. Both new components use the native DaisyUI checkbox collapse instead of a signal-controlled approach.

7. **`wizard-generation-rpc.handlers.ts:383-402` -- `onStreamEvent` callback defined inside `registerSubmitSelection` alongside `progressCallback`**: These two callbacks follow the same pattern (fire-and-forget broadcast with error swallowing). Consider extracting a `createBroadcaster(type: string)` helper to reduce the boilerplate.

8. **`content-generation.interface.ts:11` -- `import type` used for `GenerationStreamPayload`**: Correct usage of `import type` for type-only import. However, the regular `import` on line 10 brings in `Result` as a value. The file now has two import statements from `@ptah-extension/shared` -- one value, one type. These could be combined into a single import with mixed value/type syntax: `import { Result, type GenerationStreamPayload } from '@ptah-extension/shared'`.

---

## File-by-File Analysis

### `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

**Analysis**: Clean, well-structured type additions. `GenerationStreamPayload` correctly extends `AnalysisStreamPayload` with an optional `agentId`. JSDoc is thorough and follows the existing patterns in the file. The `WizardMessageType` union and `WizardMessage` discriminated union are properly extended. Formatting of the new union members matches the existing style (some members inline, some multi-line for readability).

**Specific Concerns**: None. This is the strongest file in the batch.

---

### `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 1 serious, 1 minor

**Analysis**: The refactoring from hardcoded `wizardState.analysisStream()` to an optional `messages` input with `effectiveMessages` computed fallback is clean and backward-compatible. The `input()` signal is properly typed as `AnalysisStreamPayload[]`. All three internal references (`messageCount`, `transcriptItems`, auto-scroll effect) correctly use `effectiveMessages()`.

**Specific Concerns**:

1. (Serious) `id="analysis-transcript-content"` will conflict if multiple instances exist simultaneously (line 132).
2. (Minor) `effectiveMessages` JSDoc could be more explicit about the fallback contract.

---

### `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts`

**Score**: 6/10
**Issues Found**: 1 blocking, 1 serious, 2 minor

**Analysis**: The stream event broadcasting logic in `processGenerationStream()` (lines 386-489) is functionally correct: throttling at 100ms, tool block tracking via `Map<number, ...>`, fire-and-forget callbacks with try/catch. The `fillDynamicSections()` method correctly passes `sdkConfig?.onStreamEvent` and `templateName` to the stream processor. However, this is ~100 lines of logic that is duplicated almost verbatim in `EnhancedPromptsService`.

**Specific Concerns**:

1. (Blocking) ~90 lines duplicated with `EnhancedPromptsService` (lines 392-488 vs enhanced-prompts lines 670-761).
2. (Serious) Tool call ID uses a synthetic format (`gen-${agentId}-${event.index}-${Date.now()}`) instead of the SDK-provided `event.content_block.id`.
3. (Minor) Three eslint-disable comments for SDK imports (lines 40, 50, 52).
4. (Minor) `trimmed` variable misleads about what gets emitted (line 400).

---

### `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\interfaces\content-generation.interface.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 1 minor

**Analysis**: Simple, clean addition of `onStreamEvent` to `ContentGenerationSdkConfig`. JSDoc on the new field matches the style of existing fields. Import of `GenerationStreamPayload` is correctly type-only.

**Specific Concerns**:

1. (Minor) Two separate import statements from `@ptah-extension/shared` (lines 10-11) could be combined.

---

### `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`

**Score**: 7.5/10
**Issues Found**: 0 blocking, 1 serious, 0 minor

**Analysis**: The `onStreamEvent` field addition to `OrchestratorGenerationOptions` is clean with proper JSDoc. The `renderAgents()` method correctly passes `options.onStreamEvent` into the `sdkConfig` object (line 629). Import of `GenerationStreamPayload` is type-only.

**Specific Concerns**:

1. (Serious) `OrchestratorGenerationOptions` is not barrel-exported, forcing the local mirror in `wizard-generation-rpc.handlers.ts`. This task added `onStreamEvent` to both copies, but the next modification may not.

---

### `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

**Score**: 6/10
**Issues Found**: 0 blocking, 2 serious, 1 minor

**Analysis**: The `onStreamEvent` broadcaster (lines 383-402) follows the exact same pattern as the existing `progressCallback` (lines 419-460): try/catch wrapping, fire-and-forget `.catch()`, null check on `webviewManager`. The callback is correctly added to the `options` object (line 415). The local `OrchestratorGenerationOptions` mirror (line 76-88) has been updated with `onStreamEvent`.

**Specific Concerns**:

1. (Serious) Local interface mirror for `OrchestratorGenerationOptions` (lines 76-88) and `GenerationProgress` (lines 56-69) -- drift risk.
2. (Serious) `registerRetryItem()` (lines 729-733) does NOT include `onStreamEvent` in its options. If a user retries a failed item, no stream events will be broadcast for the retry run.
3. (Minor) `onStreamEvent` and `progressCallback` follow identical patterns -- extract a helper.

---

### `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`

**Score**: 5.5/10
**Issues Found**: 1 blocking, 1 serious, 1 minor

**Analysis**: The stream event handling in `processPromptDesignerStream()` (lines 654-761) is nearly identical to `ContentGenerationService.processGenerationStream()`. The throttling, tool tracking, and emission patterns are copy-pasted with only minor differences (no `agentId`, different toolCallId prefix). The `onStreamEvent` addition to `EnhancedPromptsSdkConfig` is clean. The callback is correctly threaded from `generateGuidanceViaSdk()` to `processPromptDesignerStream()`.

**Specific Concerns**:

1. (Blocking) Duplicated stream event handling logic (see blocking issue 1).
2. (Serious) The existing `processPromptDesignerStream` already had complex result-handling logic (JSON parse fallback, error subtype handling). The new stream event code was inserted before the result handling, making this a 160+ line method.
3. (Minor) Same trim-but-emit-untrimmed pattern as content-generation (line 678).

---

### `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts`

**Score**: 6/10
**Issues Found**: 0 blocking, 1 serious, 0 minor

**Analysis**: The `resolveSdkConfig()` method (lines 658-680) was extended to accept an optional `onStreamEvent` parameter and include it in the returned config. The broadcaster closures in `registerRunWizard()` (lines 271-287) and `registerRegenerate()` (lines 458-474) follow the same fire-and-forget pattern used in the generation handler.

**Specific Concerns**:

1. (Serious) WebviewManager resolution uses `require('tsyringe')` instead of injected container (lines 260-268 and 443-455), inconsistent with `WizardGenerationRpcHandlers`.

---

### `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 1 serious, 1 minor

**Analysis**: Clean signal additions following the existing pattern exactly. `generationStreamSignal` and `enhanceStreamSignal` are properly typed, have JSDoc, and expose `asReadonly()` accessors. The `isWizardMessage()` type guard correctly includes both new message types. The switch cases handle the new messages inline (lines 891-901) rather than via dedicated handler methods like `handleAnalysisStream` -- this is a minor inconsistency but acceptable for simple one-line handlers. The `reset()` method correctly clears both new signals (lines 644-645). The `default: never` exhaustive check compiles without error.

**Specific Concerns**:

1. (Serious) Unbounded array growth in stream signal updates (lines 891-901).
2. (Minor) New stream cases use inline handling while existing cases delegate to private methods. Not wrong, but inconsistent.

---

### `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 2 minor

**Analysis**: The collapsible "Agent Activity Log" section (lines 94-106) uses the DaisyUI `collapse collapse-arrow` pattern correctly. The `AnalysisTranscriptComponent` is properly imported and added to the component's `imports` array (line 50). The `[messages]="generationStream()"` input binding correctly passes the generation stream. The `hasStreamMessages` and `streamMessageCount` computed signals (lines 619-628) are clean.

**Specific Concerns**:

1. (Minor) Uncontrolled checkbox collapse (line 97) vs signal-controlled toggle in `AnalysisTranscriptComponent`.
2. (Minor) The `mb-8` spacing on the collapse section matches the agent/command/skill sections below it, which is good visual consistency.

---

### `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\prompt-enhancement.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 2 minor

**Analysis**: Same pattern as `GenerationProgressComponent` for the collapsible transcript. The `AnalysisTranscriptComponent` is imported (line 18), added to `imports` (line 38), and receives `enhanceStream()` via `[messages]`. The computed signals `hasStreamMessages` and `streamMessageCount` follow the exact same pattern. The component correctly places the activity section between the status card and footer buttons.

**Specific Concerns**:

1. (Minor) Uncontrolled checkbox collapse (line 147).
2. (Minor) The component does not clear `enhanceStream` when retrying via `onRetry()`. If the user retries, old stream messages from the failed run will still be visible alongside new ones. Consider calling `wizardState.enhanceStreamSignal.set([])` before triggering retry -- though this requires either a public method or handling in the state service.

---

## Pattern Compliance

| Pattern            | Status | Concern                                                                                                    |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| Signal-based state | PASS   | All new signals follow the private-writable + public-readonly pattern correctly                            |
| Type safety        | PASS   | `GenerationStreamPayload` properly extends `AnalysisStreamPayload`. Discriminated union correctly extended |
| DI patterns        | FAIL   | Inconsistent DI resolution for WebviewManager between RPC handlers                                         |
| Layer separation   | PASS   | Callback pattern correctly decouples services from UI layer                                                |
| DaisyUI components | PASS   | Collapse sections use standard DaisyUI patterns                                                            |
| Import ordering    | PASS   | Angular imports first, then library imports, then relative imports                                         |
| JSDoc completeness | PASS   | New fields and methods have JSDoc, matching existing file conventions                                      |
| Error handling     | PASS   | Fire-and-forget with try/catch, consistent with existing progressCallback pattern                          |
| Code duplication   | FAIL   | ~90 lines of stream event handling duplicated across two services (three counting analysis)                |

## Technical Debt Assessment

**Introduced**:

- ~180 lines of duplicated stream event handling code across two services (will likely need a third update when the analysis service is migrated to type guards)
- Two local interface mirrors in `wizard-generation-rpc.handlers.ts` that must be manually synced
- Unbounded array growth in two new stream signals
- Inconsistent DI resolution pattern in `EnhancedPromptsRpcHandlers`

**Mitigated**:

- The callback pattern (`onStreamEvent`) is a good architectural choice that keeps services decoupled from the WebviewManager
- The `AnalysisTranscriptComponent` refactoring to accept optional input is clean and eliminates the need for a new component

**Net Impact**: Moderate increase in technical debt. The feature works correctly, but the implementation takes shortcuts that will compound over time. The duplication is the most concerning -- it is the kind of debt that accumulates interest every time the stream event protocol evolves.

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Key Concern**: The ~90 lines of duplicated stream event handling logic between `ContentGenerationService` and `EnhancedPromptsService` (with a third variant in `AgenticAnalysisService`) is the single most impactful issue. This is not a style preference -- it is a maintainability hazard that will cause bugs when the stream protocol changes.

## What Excellence Would Look Like

A 10/10 implementation would:

1. **Extract a shared `StreamEventBroadcaster` utility** that encapsulates throttling, tool block tracking, and event emission. All three services (`ContentGenerationService`, `EnhancedPromptsService`, `AgenticAnalysisService`) would call the same function, eliminating ~250 lines of duplicated code.

2. **Export canonical types from barrel files** instead of maintaining local mirrors. `OrchestratorGenerationOptions` and `GenerationProgress` would be importable from `@ptah-extension/agent-generation`.

3. **Cap stream signal arrays** at a maximum size (e.g., 2000 entries) to prevent unbounded memory growth during long generation runs.

4. **Use consistent DI resolution** across all RPC handlers -- either all inject `DependencyContainer` or all use the same approach for resolving non-constructor dependencies.

5. **Include `onStreamEvent` in the retry path** (`registerRetryItem`) so retried items also produce live stream events.

6. **Unify tool call ID format** across all three services, preferably using the SDK-provided `event.content_block.id`.

7. **Add a `clearGenerationStream()` method** to `SetupWizardStateService` that the enhance component can call before retrying, so stale stream events from a failed run are not shown alongside events from the retry.
