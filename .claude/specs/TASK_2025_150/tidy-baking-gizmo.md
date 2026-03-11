# Plan: Add Agent Execution Stream Broadcasting for Generation & Enhanced Prompts

## Context

After the SDK-only migration (previous plan - completed), both the Content Generation and Enhanced Prompts pipelines now use `InternalQueryService` (Agent SDK) for LLM calls. However, their stream processing methods (`processGenerationStream()` and `processPromptDesignerStream()`) only extract the final `structured_output` from the result message and **discard all intermediate stream events** (text deltas, tool calls, thinking).

Meanwhile, the Analysis phase (AgenticAnalysisService) broadcasts rich real-time stream events to the UI via `SETUP_WIZARD_ANALYSIS_STREAM`, showing users exactly what the agent is doing — tool calls, text output, thinking. The generation and enhanced prompts phases lack this visibility.

**Goal**: Add the same stream event broadcasting pattern to both pipelines so the UI shows live agent activity during content generation and prompt enhancement.

## Existing Pattern (AgenticAnalysisService)

The analysis service follows this chain:

```
AgenticAnalysisService.processStream()
  → detects stream_event (text_delta, tool calls, thinking)
  → broadcasts via WebviewManager.broadcastMessage('setup-wizard:analysis-stream', payload)
    → frontend SetupWizardStateService receives, appends to analysisStreamSignal
      → AnalysisTranscriptComponent renders grouped tool calls, text, thinking
```

Key patterns:

- **Throttling**: Text/thinking deltas throttled at 100ms
- **Tool tracking**: Tool start/input/result grouped by `toolCallId`
- **Stream payload**: `AnalysisStreamPayload` with `kind`, `content`, `toolName`, `toolCallId`, `isError`, `timestamp`
- **Fire-and-forget**: Broadcasts don't block the stream processing loop

## Approach

Use **callbacks** (not direct WebviewManager injection) to keep services decoupled from the UI layer. The RPC handler creates a broadcaster callback and passes it down to the service. This matches the existing `progressCallback` pattern used in the orchestrator.

---

## Files to Change

### 1. Shared Types — Add new stream message types

**`libs/shared/src/lib/types/setup-wizard.types.ts`**

- Add `GenerationStreamPayload` type (extends `AnalysisStreamPayload` with `agentId`):

  ```typescript
  export interface GenerationStreamPayload extends AnalysisStreamPayload {
    /** Which agent template is currently being processed */
    agentId?: string;
  }
  ```

- Add new `WizardMessageType` entries:

  ```typescript
  | 'setup-wizard:generation-stream'
  | 'setup-wizard:enhance-stream'
  ```

- Add to `WizardMessage` discriminated union:

  ```typescript
  | { type: 'setup-wizard:generation-stream'; payload: GenerationStreamPayload }
  | { type: 'setup-wizard:enhance-stream'; payload: AnalysisStreamPayload }
  ```

### 2. ContentGenerationSdkConfig — Add stream callback

**`libs/backend/agent-generation/src/lib/interfaces/content-generation.interface.ts`**

- Import `GenerationStreamPayload` from `@ptah-extension/shared`
- Add `onStreamEvent` callback to `ContentGenerationSdkConfig`:

  ```typescript
  export interface ContentGenerationSdkConfig {
    isPremium: boolean;
    mcpServerRunning: boolean;
    mcpPort?: number;
    model?: string;
    /** Callback for real-time stream events (text, tool calls, thinking) */
    onStreamEvent?: (event: GenerationStreamPayload) => void;
  }
  ```

### 3. ContentGenerationService — Enhance stream processing to emit events

**`libs/backend/agent-generation/src/lib/services/content-generation.service.ts`**

- Import type guards: `isStreamEvent`, `isContentBlockDelta`, `isContentBlockStart`, `isContentBlockStop`, `isTextDelta`, `isInputJsonDelta`, `isThinkingDelta` from `@ptah-extension/agent-sdk`
- Import `GenerationStreamPayload` from `@ptah-extension/shared`
- Update `processGenerationStream()` signature to accept callbacks:

  ```typescript
  private async processGenerationStream(
    stream: AsyncIterable<SDKMessage>,
    onStreamEvent?: (event: GenerationStreamPayload) => void,
    agentId?: string
  ): Promise<unknown | null>
  ```

- Add stream event handling inside the `for await` loop (before the result check):

  ```typescript
  // Stream events — broadcast for live UI updates
  if (message.type === 'stream_event' && onStreamEvent) {
    const event = message.event;

    if (isContentBlockDelta(event)) {
      if (isTextDelta(event.delta)) {
        // Throttle text deltas at 100ms
        onStreamEvent({ kind: 'text', content: event.delta.text, agentId, timestamp: Date.now() });
      }
      if (isInputJsonDelta(event.delta)) {
        // Accumulate tool input for display
        onStreamEvent({ kind: 'tool_input', content: event.delta.partial_json, agentId, timestamp: Date.now(), toolCallId: ... });
      }
      if (isThinkingDelta(event.delta)) {
        onStreamEvent({ kind: 'thinking', content: event.delta.thinking, agentId, timestamp: Date.now() });
      }
    }
    if (isContentBlockStart(event) && event.content_block.type === 'tool_use') {
      onStreamEvent({ kind: 'tool_start', content: '', toolName: event.content_block.name, agentId, timestamp: Date.now(), toolCallId: ... });
    }
  }
  ```

- Add throttling (100ms) for text and thinking deltas (same as AgenticAnalysisService)
- Track active tool blocks via `Map<number, { name, inputBuffer, toolCallId }>` for tool call grouping
- Pass `onStreamEvent` and `agentId` from `fillDynamicSections()` to `processGenerationStream()`
- In `fillDynamicSections()`, extract `sdkConfig.onStreamEvent` and pass template name as `agentId`

### 4. OrchestratorService — Pass stream callback through to content generator

**`libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`**

- Add `onStreamEvent` to `OrchestratorGenerationOptions`:

  ```typescript
  /** Callback for real-time stream events during content generation */
  onStreamEvent?: (event: GenerationStreamPayload) => void;
  ```

- In `renderAgents()`, pass `onStreamEvent` to sdkConfig:

  ```typescript
  const sdkConfig = {
    isPremium: options.isPremium ?? false,
    mcpServerRunning: options.mcpServerRunning ?? false,
    mcpPort: options.mcpPort,
    onStreamEvent: options.onStreamEvent,
  };
  ```

### 5. WizardGenerationRpcHandlers — Create generation stream broadcaster

**`apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`**

- Import `GenerationStreamPayload` from `@ptah-extension/shared`
- Create stream event broadcaster and pass to orchestrator options:

  ```typescript
  const onStreamEvent = (event: GenerationStreamPayload): void => {
    try {
      if (!webviewManager) return;
      webviewManager.broadcastMessage('setup-wizard:generation-stream', event).catch((err) => {
        this.logger.warn('Failed to broadcast generation stream event', { error: err.message });
      });
    } catch (error) {
      // Swallow to avoid crashing generation pipeline
    }
  };

  // Add to options
  const options: OrchestratorGenerationOptions = {
    ...existingOptions,
    onStreamEvent,
  };
  ```

### 6. EnhancedPromptsService — Enhance stream processing to emit events

**`libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`**

- Import type guards from sdk types
- Add `onStreamEvent` to `EnhancedPromptsSdkConfig`:

  ```typescript
  export interface EnhancedPromptsSdkConfig {
    isPremium: boolean;
    mcpServerRunning: boolean;
    mcpPort?: number;
    onStreamEvent?: (event: AnalysisStreamPayload) => void;
  }
  ```

- Update `processPromptDesignerStream()` to accept and emit stream events:

  ```typescript
  private async processPromptDesignerStream(
    stream: AsyncIterable<SDKMessage>,
    abortController: AbortController,
    onStreamEvent?: (event: AnalysisStreamPayload) => void
  ): Promise<unknown | null>
  ```

- Add stream event handling inside the loop (same pattern as ContentGenerationService)
- Pass `sdkConfig.onStreamEvent` from `generateGuidanceViaSdk()` to `processPromptDesignerStream()`

### 7. EnhancedPromptsRpcHandlers — Create enhance stream broadcaster

**`apps/ptah-extension-vscode/src/services/rpc/handlers/enhanced-prompts-rpc.handlers.ts`**

- Update `resolveSdkConfig()` to accept optional `onStreamEvent` callback:

  ```typescript
  private resolveSdkConfig(
    isPremium: boolean,
    onStreamEvent?: (event: AnalysisStreamPayload) => void
  ): EnhancedPromptsSdkConfig
  ```

- In `registerRunWizard()` and `registerRegenerate()`, create stream broadcaster:

  ```typescript
  const onStreamEvent = (event: AnalysisStreamPayload): void => {
    try {
      webviewManager?.broadcastMessage('setup-wizard:enhance-stream', event).catch(/*...*/);
    } catch {
      /* swallow */
    }
  };
  const sdkConfig = this.resolveSdkConfig(isPremium, onStreamEvent);
  ```

### 8. SetupWizardStateService — Add stream signals and handlers

**`libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`**

- Import `GenerationStreamPayload` from `@ptah-extension/shared`
- Add new signals:

  ```typescript
  private generationStreamSignal = signal<GenerationStreamPayload[]>([]);
  private enhanceStreamSignal = signal<AnalysisStreamPayload[]>([]);

  readonly generationStream = this.generationStreamSignal.asReadonly();
  readonly enhanceStream = this.enhanceStreamSignal.asReadonly();
  ```

- Add handlers in the message switch:

  ```typescript
  case 'setup-wizard:generation-stream':
    this.generationStreamSignal.update(msgs => [...msgs, message.payload]);
    break;
  case 'setup-wizard:enhance-stream':
    this.enhanceStreamSignal.update(msgs => [...msgs, message.payload]);
    break;
  ```

- Update `isWizardMessage()` type guard to include new message types
- Clear stream signals when wizard resets or step transitions

### 9. GenerationProgressComponent — Add collapsible agent activity transcript

**`libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts`**

- Add a collapsible "Agent Activity" section below overall progress (before agent items):

  ```html
  @if (hasStreamMessages()) {
  <div class="collapse collapse-arrow bg-base-200 mb-6">
    <input type="checkbox" />
    <div class="collapse-title text-lg font-medium">
      Agent Activity Log
      <span class="badge badge-sm ml-2">{{ streamMessageCount() }}</span>
    </div>
    <div class="collapse-content">
      <ptah-analysis-transcript [messages]="generationStream()" />
    </div>
  </div>
  }
  ```

- Inject `SetupWizardStateService` and expose:

  ```typescript
  protected readonly generationStream = this.wizardState.generationStream;
  protected readonly hasStreamMessages = computed(() => this.generationStream().length > 0);
  protected readonly streamMessageCount = computed(() => this.generationStream().length);
  ```

- Import and use the existing `AnalysisTranscriptComponent` (reuse the same component for rendering tool calls and text)

### 10. PromptEnhancementComponent — Add enhance activity transcript

**`libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts`**

- Add a similar collapsible "Agent Activity" section showing enhance stream events
- Reuse `AnalysisTranscriptComponent` for rendering
- Expose `enhanceStream` from state service

### 11. AnalysisTranscriptComponent — Make reusable via input binding

**`libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts`**

- Currently reads directly from `wizardState.analysisStream()` — refactor to accept messages as an `@Input()`:

  ```typescript
  /** Stream messages to display. Falls back to analysis stream from state service if not provided. */
  messages = input<AnalysisStreamPayload[]>();

  protected readonly effectiveMessages = computed(() => {
    return this.messages() ?? this.wizardState.analysisStream();
  });
  ```

- Update all template references from `wizardState.analysisStream()` to `effectiveMessages()`
- Existing usage in ScanProgressComponent continues to work (no input = uses state service)

---

## Implementation Order

1. Shared types (new message types + `GenerationStreamPayload`)
2. AnalysisTranscriptComponent (make reusable via input binding)
3. ContentGenerationService + interface (add stream event broadcasting)
4. OrchestratorService (pass `onStreamEvent` through)
5. WizardGenerationRpcHandlers (create broadcaster, pass to orchestrator)
6. EnhancedPromptsService + types (add stream event broadcasting)
7. EnhancedPromptsRpcHandlers (create broadcaster)
8. SetupWizardStateService (add signals + handlers)
9. GenerationProgressComponent (add transcript section)
10. PromptEnhancementComponent (add transcript section)

## Verification

1. `npm run build:all` — compile check
2. `npx nx test agent-sdk` — existing tests pass
3. `npx nx test agent-generation` — existing tests pass
4. `npx nx test setup-wizard` — existing tests pass
5. Manual: run wizard end-to-end, verify:
   - During generation step: "Agent Activity Log" appears with real-time text/tool events per agent
   - During enhance step: transcript shows SDK activity
   - Text deltas are throttled (no UI flooding)
   - Tool calls are grouped by toolCallId
   - Auto-scroll works in transcript
   - Analysis transcript still works as before (regression check)
