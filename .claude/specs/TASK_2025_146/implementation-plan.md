# Implementation Plan - TASK_2025_146: Wizard Analysis Runtime Fixes + Live Agent Chat

## Codebase Investigation Summary

### Libraries Discovered

- **agent-generation** (`libs/backend/agent-generation/`) - Contains `AgenticAnalysisService` with stream processing, `broadcastProgress`, timeout logic

  - Key file: `services/wizard/agentic-analysis.service.ts` (555 lines)
  - Key export: `buildAnalysisSystemPrompt()` (lines 57-166) - the system prompt causing marker issues
  - Key export: `processStream()` (lines 305-465) - stream processing with marker extraction
  - Key export: `broadcastProgress()` (lines 535-554) - webview message broadcasting
  - Documentation: `libs/backend/agent-generation/CLAUDE.md`

- **agent-sdk** (`libs/backend/agent-sdk/`) - Internal query service, SDK types

  - Key file: `internal-query/internal-query.service.ts` - executes one-shot SDK queries
  - Key types: `claude-sdk.types.ts` - SDKMessage, SDKPartialAssistantMessage, SDKAssistantMessage, RawMessageStreamEvent
  - `SDKPartialAssistantMessage.event` is `RawMessageStreamEvent` (line 514)
  - `ContentBlockDeltaEvent.delta` is `TextDelta | InputJsonDelta | ThinkingDelta` (line 247)
  - `SDKAssistantMessage.message.content` is `ContentBlock[]` (TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock)

- **vscode-core** (`libs/backend/vscode-core/`) - WebviewManager for broadcasting, RpcHandler

  - Key file: `api-wrappers/webview-manager.ts` - `broadcastMessage()` method

- **setup-wizard** (`libs/frontend/setup-wizard/`) - Frontend wizard components and state

  - Key file: `components/scan-progress.component.ts` (398 lines) - progress display
  - Key file: `services/setup-wizard-state.service.ts` - signal-based state, message listener
  - Key file: `components/wizard-view.component.ts` - main wizard container

- **chat** (`libs/frontend/chat/`) - Chat UI components

  - Key file: `components/templates/chat-view.component.ts` - depends heavily on ChatStore
  - Key file: `services/chat.store.ts` - manages messages, streaming state, execution trees
  - ChatViewComponent depends on: `ChatStore`, `VSCodeService`, `createExecutionChatMessage`

- **shared** (`libs/shared/`) - Type definitions

  - Key file: `types/setup-wizard.types.ts` - ScanProgressPayload, WizardMessage, AnalysisPhase
  - Key file: `types/message.types.ts` - MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS

- **ptah-extension-vscode** (`apps/ptah-extension-vscode/`) - RPC handlers
  - Key file: `services/rpc/handlers/setup-rpc.handlers.ts` - deep-analyze handler with fallback

### Patterns Identified

1. **Broadcast Pattern**: Backend uses `webviewManager.broadcastMessage(MESSAGE_TYPES.X, payload)` to push messages to all webviews. Frontend listens via `window.addEventListener('message', ...)` in `SetupWizardStateService` (lines 740-810).

2. **Stream Processing Pattern**: `processStream()` iterates over `AsyncIterable<SDKMessage>`, checks `message.type` discriminated union, and extracts data from `stream_event` (text_delta), `content_block_start` (tool_use), `assistant` (complete messages), and `result` (final output).

3. **Frontend State Pattern**: Signal-based state in `SetupWizardStateService` with `scanProgress` signal updated by `handleScanProgress()` method.

4. **RPC + Fallback Pattern**: `registerDeepAnalyze()` tries agentic analysis first, catches errors, falls back to hardcoded `DeepProjectAnalysisService`.

5. **Chat Component Pattern**: `ChatViewComponent` depends on injected `ChatStore` service for all data. It reads `chatStore.currentExecutionTrees()`, `chatStore.messages()`, etc. It does NOT accept @Input() data -- everything comes from ChatStore.

### Integration Points

- **Backend -> Frontend**: `webviewManager.broadcastMessage()` -> `window.addEventListener('message')` -> `SetupWizardStateService.handleMessage()`
- **Frontend RPC**: `WizardRpcService.deepAnalyze()` -> RPC -> `SetupRpcHandlers.registerDeepAnalyze()` -> `AgenticAnalysisService.analyzeWorkspace()`
- **Cancel flow**: `WizardRpcService.cancelAnalysis()` -> RPC -> `SetupRpcHandlers.registerCancelAnalysis()` -> `AgenticAnalysisService.cancelAnalysis()`

---

## Architecture Design

### Design Philosophy

**Approach**: Fix root causes in the backend stream processing, improve the system prompt clarity, and add a new broadcast channel for streaming agent messages to the frontend. For the chat feature, create a lightweight "analysis transcript" component in setup-wizard that renders SDK messages directly -- NOT by embedding the full ChatViewComponent (which requires ChatStore, session management, and interactive features that don't apply to wizard analysis).

**Rationale**: The ChatViewComponent is tightly coupled to ChatStore (injected service, not @Input props). ChatStore manages sessions, tabs, streaming state, permission requests, and interactive chat -- none of which apply to a read-only analysis transcript. Embedding it would require either (a) modifying its API (forbidden) or (b) creating a fake ChatStore that mimics its entire interface. Both approaches are fragile. Instead, we create a focused `AnalysisTranscriptComponent` in setup-wizard that renders the same visual atoms (MessageBubble-like cards) but is fed directly by the existing broadcast mechanism.

---

## Component Specifications

### Component 1: Fix System Prompt Ambiguity (Issue 7 + Issue 1 Root Cause)

**Purpose**: Eliminate the root cause of markers not appearing in text_delta events. The current prompt says "Emit `[PHASE:discovery]`" which the agent interprets as "emit within code". The fix: instruct the agent to output markers as direct text output, not inside tool code.

**Pattern**: Direct modification of `buildAnalysisSystemPrompt()`.
**Evidence**: `agentic-analysis.service.ts` lines 57-166 (system prompt), lines 359-361 (text_delta matching)

**Changes**:

```
File: libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts
Action: MODIFY - buildAnalysisSystemPrompt() function
```

**Specification**:

- Replace "Emit `[PHASE:discovery]`" language with explicit instruction: "Before starting each phase, output exactly this text as a standalone line (NOT inside any tool call or code block): `[PHASE:discovery]`"
- Add negative examples: "DO NOT put phase markers inside execute_code tool input. They MUST appear as your direct text output."
- Reduce verbosity of the prompt to address Issue 6 (token waste). Remove redundant instructions about `ptah.ai.invokeAgent()` and `ptah.ai.chatWithTools()` which add confusion.
- Add explicit instruction: "When calling execute_code, return the result directly. Do NOT wrap it in console.log() -- the return value IS the output."

**Quality Requirements**:

- Phase markers MUST appear in text_delta events
- Agent should NOT double-call workspace.analyze() (Issue 5)
- Reduced token consumption vs. current prompt

**Complexity**: LOW
**Estimated Effort**: 30 minutes

---

### Component 2: Multi-Source Marker Extraction (Issue 1 Defense-in-Depth)

**Purpose**: Even with the improved prompt, the agent may occasionally put markers in unexpected places. Add fallback marker extraction from `input_json_delta` (tool call code) and `assistant` message content blocks, in addition to `text_delta`.

**Pattern**: Extend existing `processStream()` marker matching logic.
**Evidence**: `agentic-analysis.service.ts` lines 354-442 (current stream event processing), `claude-sdk.types.ts` lines 237-240 (`InputJsonDelta`), lines 429-436 (`SDKAssistantMessage.message.content` ContentBlock[])

**Changes**:

```
File: libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts
Action: MODIFY - processStream() method
```

**Specification**:

Add two additional extraction paths within processStream():

**Path A: input_json_delta extraction** (lines ~359-425 area)

- When `event.type === 'content_block_delta' && event.delta.type === 'input_json_delta'`, accumulate `event.delta.partial_json` into a separate `toolInputBuffer` string
- Apply the same `[PHASE:X]` and `[DETECTED:X]` regex matching against `toolInputBuffer`
- Use separate cursor variables (`lastPhaseCheckPosToolInput`, `lastDetectionCheckPosToolInput`)
- This catches markers the agent puts inside MCP tool call code

**Path B: assistant message content block extraction** (around lines 444-450)

- When `message.type === 'assistant'`, iterate `message.message.content` blocks
- For each `TextBlock` (block.type === 'text'), extract markers from `block.text`
- For each `ToolUseBlock` (block.type === 'tool_use'), extract markers from `JSON.stringify(block.input)`
- This catches markers after a complete turn finishes

**Deduplication**: The existing `completedPhases` array and `detections` array already deduplicate. No additional logic needed.

**Quality Requirements**:

- Markers found in ANY stream location trigger broadcastProgress
- No duplicate broadcasts for same phase/detection
- No performance regression (regex matching is O(n) on small strings)

**Complexity**: MEDIUM
**Estimated Effort**: 1 hour

---

### Component 3: Timeout vs. Cancellation Disambiguation (Issue 2)

**Purpose**: Distinguish between a 90s timeout abort and a user-initiated cancellation. Currently both call `abortController.abort()` with no distinction, causing "aborted by user" error messages for timeouts.

**Pattern**: Use AbortController.abort(reason) with typed reasons.
**Evidence**: `agentic-analysis.service.ts` lines 237-238 (AbortController creation), lines 317-322 (timeout firing abort), lines 290-300 (cancel method)

**Changes**:

```
File: libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts
Action: MODIFY - analyzeWorkspace(), processStream(), cancelAnalysis()
```

**Specification**:

1. Define abort reason enum at module level:

   ```typescript
   const ABORT_REASONS = {
     TIMEOUT: 'analysis_timeout',
     USER_CANCELLED: 'user_cancelled',
   } as const;
   type AbortReason = (typeof ABORT_REASONS)[keyof typeof ABORT_REASONS];
   ```

2. In `processStream()` timeout handler (line 318-322), change:

   ```typescript
   // Before:
   abortController.abort();
   // After:
   abortController.abort(ABORT_REASONS.TIMEOUT);
   ```

3. In `cancelAnalysis()` (line 293), change:

   ```typescript
   // Before:
   this.activeAbortController.abort();
   // After:
   this.activeAbortController.abort(ABORT_REASONS.USER_CANCELLED);
   ```

4. In the `catch` block of `analyzeWorkspace()` (lines 267-272), inspect the abort reason:

   ```typescript
   const errorObj = error instanceof Error ? error : new Error(String(error));
   const abortReason = abortController.signal.reason as AbortReason | undefined;

   if (abortReason === ABORT_REASONS.TIMEOUT) {
     this.logger.warn(`${SERVICE_TAG} Analysis timed out after ${timeout}ms`);
     // Broadcast timeout status to frontend
     this.broadcastProgress({
       filesScanned: 0,
       totalFiles: 0,
       detections: [],
       agentReasoning: 'Analysis timed out. Falling back to quick analysis...',
     });
   } else if (abortReason === ABORT_REASONS.USER_CANCELLED) {
     this.logger.info(`${SERVICE_TAG} Analysis cancelled by user`);
   }
   ```

5. Extend the return type to include the abort reason in the error for the RPC handler to distinguish:
   - Return `Result.err(new Error('Analysis timed out'))` for timeouts
   - Return `Result.err(new Error('Analysis cancelled by user'))` for user cancellation

**Quality Requirements**:

- Timeout produces "timed out" message, NOT "aborted by user"
- User cancellation produces "cancelled" message
- Frontend can distinguish between the two for UX messaging

**Complexity**: LOW
**Estimated Effort**: 30 minutes

---

### Component 4: Fallback Transition UX (Issue 4)

**Purpose**: When agentic analysis fails/times out and the RPC handler falls back to hardcoded analysis, broadcast a status message to the frontend so the UI reflects this transition.

**Pattern**: Add broadcast messages in the setup-rpc.handlers.ts fallback path.
**Evidence**: `setup-rpc.handlers.ts` lines 274-320 (agentic try/catch), lines 322-351 (fallback path). `agentic-analysis.service.ts` lines 535-554 (broadcastProgress)

**Changes**:

```
File: apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts
Action: MODIFY - registerDeepAnalyze() method
```

**Specification**:

In the `registerDeepAnalyze()` handler, after the agentic analysis fails and before calling the fallback:

1. Resolve WebviewManager from DI container (it is available as TOKENS.WEBVIEW_MANAGER)
2. Import MESSAGE_TYPES from `@ptah-extension/shared`
3. Broadcast a progress message indicating fallback:

   ```typescript
   // After agentic analysis failure, before fallback:
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

4. Also broadcast when fallback analysis starts:
   ```typescript
   webviewManager.broadcastMessage(MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS, {
     filesScanned: 0,
     totalFiles: 0,
     detections: [],
     agentReasoning: 'Running quick project analysis...',
   });
   ```

**Quality Requirements**:

- UI shows "Switching to quick analysis mode..." when fallback triggers
- User is NOT left with a stale "Using: mcp\_\_ptah_execute_code..." message
- Fallback transition is visually smooth

**Complexity**: LOW
**Estimated Effort**: 30 minutes

---

### Component 5: Tool Input Token Waste Prevention (Issue 5 + Issue 6)

**Purpose**: The agent calls `workspace.analyze()` twice (once with console.log wrapping, once without) and dumps 180 lines of JSON. Fix via system prompt improvement.

**Pattern**: System prompt refinement in buildAnalysisSystemPrompt().
**Evidence**: `agentic-analysis.service.ts` lines 62-66 (Phase 1 instructions)

**Changes**:

```
File: libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts
Action: MODIFY - buildAnalysisSystemPrompt() (same file as Component 1)
```

**Specification** (merged with Component 1's prompt changes):

1. Add explicit instruction: "Call each MCP tool EXACTLY ONCE. Return the result directly -- the execute_code tool returns the value of the last expression. Do NOT use console.log()."

2. Add instruction about workspace.analyze(): "The ptah.workspace.analyze() call returns a summary object. Do NOT call it more than once. If you need to inspect specific files, use ptah.search.findFiles() instead."

3. Add instruction to prevent JSON dumps: "When analyzing workspace.analyze() results, summarize key findings in your text output. Do NOT reproduce the entire JSON structure in your response text."

**Quality Requirements**:

- workspace.analyze() called exactly once
- No 180-line JSON dumps in agent text output
- Token consumption reduced by ~30-50%

**Complexity**: LOW (merged with Component 1)
**Estimated Effort**: Included in Component 1

---

### Component 6: Stream Progress Enhancement (Issue 3)

**Purpose**: Beyond fixing marker extraction (Components 1 & 2), add more progress signals from events that DO fire today (tool_use starts, tool_use completions, thinking blocks).

**Pattern**: Extend stream event processing in processStream().
**Evidence**: `agentic-analysis.service.ts` lines 428-441 (existing tool_use handling). Types: `ThinkingDelta` (line 242-245), `ContentBlockStopEvent` (line 255-258)

**Changes**:

```
File: libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts
Action: MODIFY - processStream() method
```

**Specification**:

1. **Track tool calls for implicit phase detection**: Maintain a `toolCallCount` counter. Increment on each `content_block_start` with `tool_use`. Use tool count heuristics:

   - 1st-2nd tool calls: discovery phase
   - 3rd-4th: architecture phase
   - 5th-6th: health phase
   - 7th+: quality phase

   If no explicit `[PHASE:X]` marker has been seen but tool calls are firing, use the heuristic to set an implicit phase. Only apply the heuristic if `currentPhase` is undefined (explicit markers always take priority).

2. **Add thinking block progress**: When `event.delta.type === 'thinking_delta'`, broadcast a reasoning update:

   ```typescript
   if (event.delta.type === 'thinking_delta') {
     // Truncate thinking text for display
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

3. **Improve tool_use naming**: Instead of just `Using: mcp__ptah_execute_code...`, parse the tool input to extract the API call:
   - Track the current `content_block_start` tool name
   - When `input_json_delta` events arrive, accumulate partial JSON
   - On `content_block_stop`, try to extract the ptah.\* API call from the accumulated input
   - Broadcast a more descriptive message like "Analyzing: ptah.workspace.analyze()" or "Searching: ptah.search.findFiles(...)"

**Quality Requirements**:

- Progress updates visible even when markers are missing
- At minimum, tool_use events produce visible progress
- Thinking block previews give user insight into agent reasoning

**Complexity**: MEDIUM
**Estimated Effort**: 1.5 hours

---

### Component 7: Analysis Transcript (Live Agent Chat) -- NEW FEATURE

**Purpose**: Show Claude's streaming messages (text output, tool calls, reasoning) in real-time within the scan-progress component. This replaces the current minimal "Agent Activity" collapsible with a rich scrollable transcript.

**Design Decision**: NOT embedding ChatViewComponent.

**Why**: ChatViewComponent (verified at `chat-view.component.ts` lines 71-274) depends on `ChatStore` (injected, not @Input), which manages interactive sessions, tabs, permission dialogs, message sending, and execution tree state. None of these apply to a read-only analysis transcript. Creating a mock ChatStore would be brittle and couple wizard to chat internals. Instead, we create a focused `AnalysisTranscriptComponent` that reuses the visual PATTERNS (DaisyUI card styling, code block formatting) but receives data via a simple signal-based service fed by the existing broadcast mechanism.

### Sub-Components

#### 7A: New Message Type - Analysis Stream Messages

**Purpose**: Add a new broadcast message type for streaming SDK messages to the frontend, separate from scan-progress (which carries phase/detection data).

**Changes**:

```
File: libs/shared/src/lib/types/message.types.ts
Action: MODIFY - add new message type constant

File: libs/shared/src/lib/types/setup-wizard.types.ts
Action: MODIFY - add AnalysisStreamPayload type and extend WizardMessage union
```

**Specification**:

Add to MESSAGE_TYPES:

```typescript
SETUP_WIZARD_ANALYSIS_STREAM: 'setup-wizard:analysis-stream',
```

Add new payload type to setup-wizard.types.ts:

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

Extend WizardMessage union:

```typescript
| { type: 'setup-wizard:analysis-stream'; payload: AnalysisStreamPayload }
```

Extend WizardMessageType:

```typescript
| 'setup-wizard:analysis-stream'
```

#### 7B: Backend Stream Broadcasting

**Purpose**: Broadcast SDK stream events as AnalysisStreamPayload messages to the frontend for real-time transcript display.

**Changes**:

```
File: libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts
Action: MODIFY - processStream() method
```

**Specification**:

Add a new private method `broadcastStreamMessage()`:

```typescript
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

Import the new type:

```typescript
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
```

In `processStream()`, add broadcast calls at each relevant event:

1. **text_delta**: Broadcast text chunks

   ```typescript
   // After accumulating text in fullText
   this.broadcastStreamMessage({
     kind: 'text',
     content: text, // The individual delta, not accumulated
     timestamp: Date.now(),
   });
   ```

2. **content_block_start (tool_use)**: Broadcast tool start

   ```typescript
   this.broadcastStreamMessage({
     kind: 'tool_start',
     content: `Calling ${event.content_block.name}`,
     toolName: event.content_block.name,
     toolCallId: event.content_block.id,
     timestamp: Date.now(),
   });
   ```

3. **input_json_delta**: Broadcast accumulated tool input (debounced -- only on content_block_stop)

   - Track current tool block index and accumulated input per block

4. **thinking_delta**: Broadcast thinking

   ```typescript
   this.broadcastStreamMessage({
     kind: 'thinking',
     content: event.delta.thinking,
     timestamp: Date.now(),
   });
   ```

5. **assistant message (complete)**: After a complete assistant message, broadcast tool results from content blocks:
   ```typescript
   for (const block of message.message.content) {
     if (block.type === 'tool_use') {
       this.broadcastStreamMessage({
         kind: 'tool_input',
         content: JSON.stringify(block.input, null, 2),
         toolName: block.name,
         toolCallId: block.id,
         timestamp: Date.now(),
       });
     }
   }
   ```

**Note**: We broadcast BOTH the granular stream events (text_delta for real-time) AND the complete assistant messages (for tool call/result correlation). The frontend transcript component decides what to render.

#### 7C: Frontend State Extension

**Purpose**: Add analysis stream handling to SetupWizardStateService.

**Changes**:

```
File: libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts
Action: MODIFY - add analysisStream signal and message handler
```

**Specification**:

1. Add new signal:

   ```typescript
   private readonly analysisStreamSignal = signal<AnalysisStreamPayload[]>([]);
   readonly analysisStream = this.analysisStreamSignal.asReadonly();
   ```

2. Add handler method:

   ```typescript
   private handleAnalysisStream(payload: AnalysisStreamPayload): void {
     this.analysisStreamSignal.update(messages => [...messages, payload]);
   }
   ```

3. Extend message listener to handle new type:

   ```typescript
   case 'setup-wizard:analysis-stream':
     this.handleAnalysisStream(message.payload);
     break;
   ```

4. Clear stream on reset:

   ```typescript
   // In reset():
   this.analysisStreamSignal.set([]);
   ```

5. Add the new type to `validTypes` array (line 752).

#### 7D: AnalysisTranscriptComponent

**Purpose**: A scrollable, read-only transcript showing the agent's streaming messages during analysis.

**Changes**:

```
File: libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts
Action: CREATE
```

**Specification**:

```typescript
@Component({
  selector: 'ptah-analysis-transcript',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...`,
  styles: [`...`],
})
export class AnalysisTranscriptComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  readonly messages = this.wizardState.analysisStream;
  readonly isExpanded = signal(true);

  // Auto-scroll to bottom on new messages
  // Uses viewChild + afterNextRender pattern (same as ChatViewComponent)
}
```

**Template structure** (DaisyUI styling, matching chat visual language):

- Outer container: `div.bg-base-200.rounded-lg.overflow-hidden` with max height
- Expandable header with toggle: "Agent Transcript" with expand/collapse chevron
- Inner scrollable div: `div.overflow-y-auto.max-h-64.p-3.space-y-2`
- Message rendering per kind:
  - `text`: Simple text paragraph with monospace font, text wrapping. Accumulate consecutive text messages into one block.
  - `tool_start`: Badge with tool icon + tool name (e.g., "Calling: execute_code")
  - `tool_input`: Collapsible code block showing tool input JSON (truncated to 500 chars with "show more")
  - `thinking`: Italic, muted text with brain icon
  - `error`: Red alert styling
  - `status`: Muted info text
- Auto-scroll behavior: scroll to bottom on new messages unless user has scrolled up

**Visual design**: Reuses DaisyUI classes used throughout the wizard (alert, badge, collapse, card patterns). Does NOT import from `@ptah-extension/chat` library -- no cross-library dependency.

#### 7E: Embed Transcript in ScanProgressComponent

**Purpose**: Integrate the transcript into the scan-progress view.

**Changes**:

```
File: libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts
Action: MODIFY - add AnalysisTranscriptComponent to imports and template
```

**Specification**:

1. Add import:

   ```typescript
   import { AnalysisTranscriptComponent } from './analysis-transcript.component';
   ```

2. Add to imports array:

   ```typescript
   imports: [LucideAngularModule, ConfirmationModalComponent, AnalysisTranscriptComponent],
   ```

3. Replace the current "Agent Activity" collapsible section (lines 144-156) with the transcript:

   ```html
   <!-- Replace existing agent reasoning collapsible with full transcript -->
   @if (hasStreamMessages()) {
   <ptah-analysis-transcript />
   } @else if (progressData.agentReasoning) {
   <!-- Fallback: simple text for non-agentic analysis -->
   <div class="alert alert-info mb-6">
     <p class="text-sm">{{ progressData.agentReasoning }}</p>
   </div>
   }
   ```

4. Add computed signal:
   ```typescript
   protected readonly hasStreamMessages = computed(() => {
     return this.wizardState.analysisStream().length > 0;
   });
   ```

---

## Data Flow Architecture

### Bug Fix Data Flow (Issues 1-7)

```
                    Backend                              Frontend
                    ------                              --------

Agent SDK Stream
     |
     v
processStream()  --------text_delta--------+
     |                                      |
     |  --------input_json_delta-----+      |   Extract markers
     |                               |      |   from ALL sources
     |  --------assistant msg--------+------+
     |                                      |
     v                                      v
[PHASE:X] / [DETECTED:X]  ------>  broadcastProgress()
     |                                      |
     |                              SETUP_WIZARD_SCAN_PROGRESS
     |                                      |
     v                                      v
                                    SetupWizardStateService
                                    handleScanProgress()
                                            |
                                            v
                                    scanProgress signal
                                            |
                                            v
                                    ScanProgressComponent
                                    (phase stepper + detections)
```

### Live Transcript Data Flow (Issue 8)

```
                    Backend                              Frontend
                    ------                              --------

Agent SDK Stream
     |
     v
processStream()
     |
     +--- text_delta -------> broadcastStreamMessage({kind:'text',...})
     |                                    |
     +--- tool_use start ---> broadcastStreamMessage({kind:'tool_start',...})
     |                                    |
     +--- input_json -------> broadcastStreamMessage({kind:'tool_input',...})
     |                                    |
     +--- thinking_delta ---> broadcastStreamMessage({kind:'thinking',...})
     |                                    |
     +--- assistant msg ----> broadcastStreamMessage({kind:'tool_input',...})
     |                                    |
     v                           SETUP_WIZARD_ANALYSIS_STREAM
                                          |
                                          v
                                 SetupWizardStateService
                                 handleAnalysisStream()
                                          |
                                          v
                                 analysisStream signal (AnalysisStreamPayload[])
                                          |
                                          v
                                 AnalysisTranscriptComponent
                                 (scrollable message list)
                                          |
                                          v
                                 ScanProgressComponent
                                 (embeds transcript)
```

### Timeout vs. Cancellation Flow

```
                  Timeout (90s)                    User Cancel
                  ------------                     -----------
setTimeout fires                            cancelAnalysis() called
     |                                              |
     v                                              v
abortController.abort(TIMEOUT)        abortController.abort(USER_CANCELLED)
     |                                              |
     v                                              v
SDK stream throws AbortError          SDK stream throws AbortError
     |                                              |
     v                                              v
catch block: inspect signal.reason    catch block: inspect signal.reason
     |                                              |
     v                                              v
Result.err("Analysis timed out")      Result.err("Cancelled by user")
     |                                              |
     v                                              v
RPC handler: fall back to             RPC handler: throw to frontend
hardcoded analysis                    (no fallback needed)
     |
     v
Broadcast "Switching to quick analysis..."
     |
     v
Run DeepProjectAnalysisService
```

---

## Files Affected Summary

### CREATE

| File                                                                             | Purpose                            |
| -------------------------------------------------------------------------------- | ---------------------------------- |
| `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts` | New read-only transcript component |

### MODIFY

| File                                                                                | Purpose                                                                                                                    |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts` | Fix system prompt (C1), multi-source markers (C2), timeout/cancel (C3), stream enhancement (C6), stream broadcasting (C7B) |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`        | Fallback UX broadcast (C4)                                                                                                 |
| `libs/shared/src/lib/types/message.types.ts`                                        | Add SETUP_WIZARD_ANALYSIS_STREAM constant (C7A)                                                                            |
| `libs/shared/src/lib/types/setup-wizard.types.ts`                                   | Add AnalysisStreamPayload type, extend WizardMessage (C7A)                                                                 |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`         | Add analysisStream signal, message handler (C7C)                                                                           |
| `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`          | Embed transcript component (C7E)                                                                                           |

---

## Risk Assessment

### Low Risk

- **System prompt changes (C1, C5)**: Pure text change, no code API modifications. Risk: agent may still occasionally put markers in code. Mitigated by C2 (multi-source extraction).
- **Timeout/cancel disambiguation (C3)**: Uses standard AbortController.abort(reason) API. Well-supported in Node.js 16+.
- **Fallback UX broadcast (C4)**: Best-effort broadcast, failure is silent. No risk to main functionality.

### Medium Risk

- **Multi-source marker extraction (C2)**: Adds complexity to stream processing. Risk: regex matching on accumulated buffers could theoretically miss edge cases. Mitigated by: existing deduplication logic, and the improved prompt (C1) makes this path less needed.
- **Stream broadcasting (C7B)**: High-frequency broadcasts during streaming. Risk: could cause performance issues in the frontend if text_delta events fire very rapidly. Mitigation: consider throttling text_delta broadcasts (e.g., batch every 100ms).

### Low Risk (Feature)

- **AnalysisTranscriptComponent (C7D)**: New standalone component within setup-wizard library. No cross-library dependencies. No modification to existing chat components.
- **State service extension (C7C)**: Adding a new signal and handler. Existing signals are unaffected. Reset clears the new signal.

---

## Quality Requirements

### Functional Requirements

1. Phase markers (`[PHASE:X]`) MUST trigger broadcastProgress regardless of whether they appear in text_delta, input_json_delta, or assistant content blocks
2. Timeout (90s) MUST produce "timed out" messaging, NOT "cancelled by user"
3. User cancellation MUST produce "cancelled" messaging
4. Fallback to hardcoded analysis MUST broadcast status transition to frontend
5. Agent MUST NOT call workspace.analyze() more than once per analysis
6. Live transcript MUST show text output, tool calls, and thinking in real-time
7. Transcript MUST auto-scroll but respect user scroll-up

### Non-Functional Requirements

- **Performance**: Text delta broadcast throttling at ~100ms intervals to prevent UI jank
- **Memory**: AnalysisStreamPayload array cleared on wizard reset; bounded by analysis duration (~90s max)
- **Robustness**: All broadcasts are best-effort (try/catch). Failures logged at debug level.

### Pattern Compliance

- Signal-based state management (Angular signals, not RxJS) -- verified in SetupWizardStateService
- Broadcast pattern via webviewManager.broadcastMessage() -- verified in agentic-analysis.service.ts:545
- Standalone components with OnPush change detection -- verified in scan-progress.component.ts:63
- DaisyUI styling classes -- verified in scan-progress.component.ts template

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both backend-developer AND frontend-developer

**Rationale**:

- Components 1-6 are backend changes (stream processing, system prompt, RPC handler) -- **backend-developer**
- Component 7 spans both: 7A (shared types), 7B (backend broadcasting), 7C-7E (frontend components) -- **both developers**
- Suggested split: backend-developer handles C1-C6 + C7A + C7B; frontend-developer handles C7C + C7D + C7E

### Complexity Assessment

**Overall Complexity**: MEDIUM
**Estimated Effort**: 6-8 hours total

**Breakdown**:
| Component | Complexity | Effort |
|-----------|-----------|--------|
| C1: System prompt fix | LOW | 30 min |
| C2: Multi-source markers | MEDIUM | 1 hour |
| C3: Timeout vs cancel | LOW | 30 min |
| C4: Fallback UX | LOW | 30 min |
| C5: Token waste (merged with C1) | LOW | 0 min |
| C6: Stream progress enhancement | MEDIUM | 1.5 hours |
| C7A: Shared types | LOW | 20 min |
| C7B: Backend broadcasting | MEDIUM | 1 hour |
| C7C: Frontend state | LOW | 30 min |
| C7D: Transcript component | MEDIUM | 1.5 hours |
| C7E: Embed in scan-progress | LOW | 20 min |

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `MESSAGE_TYPES` from `@ptah-extension/shared` (verified: `libs/shared/src/lib/types/message.types.ts:316`)
   - `SDKMessage` type from `@ptah-extension/agent-sdk` (verified: `claude-sdk.types.ts:683-699`)
   - `AnalysisPhase` from `@ptah-extension/shared` (verified: `setup-wizard.types.ts` - used by agentic-analysis.service.ts:26)
   - `WebviewManager` from `@ptah-extension/vscode-core` (verified: `api-wrappers/webview-manager.ts`)
   - `TOKENS.WEBVIEW_MANAGER` (verified: used in agentic-analysis.service.ts:191)

2. **All patterns verified from examples**:

   - Broadcasting: `agentic-analysis.service.ts:545-548` (broadcastProgress)
   - Signal state: `setup-wizard-state.service.ts:194-200` (signal pattern)
   - Message handling: `setup-wizard-state.service.ts:750-810` (message listener)
   - Standalone component: `scan-progress.component.ts:59-63` (component pattern)

3. **Stream event types verified**:

   - `text_delta`: `claude-sdk.types.ts:232-235`
   - `input_json_delta`: `claude-sdk.types.ts:237-240`
   - `thinking_delta`: `claude-sdk.types.ts:242-245`
   - `content_block_start`: `claude-sdk.types.ts:226-230`
   - `content_block_stop`: `claude-sdk.types.ts:255-258`
   - SDKAssistantMessage.message.content: `claude-sdk.types.ts:429-436`

4. **No hallucinated APIs**:
   - `AbortController.abort(reason)` - standard Web API, supported in Node.js 16+
   - `AbortSignal.reason` - standard Web API, supported in Node.js 16+
   - All DaisyUI classes used exist in current codebase (verified in scan-progress.component.ts template)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Data flow diagrams provided
- [x] Risk assessment included
- [x] No step-by-step implementation (that is team-leader's job)
