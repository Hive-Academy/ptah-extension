# Implementation Plan - TASK_2025_184: Reasoning Effort Configuration

## Codebase Investigation Summary

### Data Flow Discovered

The reasoning config must flow through this chain:

```
Frontend UI → ChatStartParams.options → ChatRpcHandlers
  → SdkAgentAdapter.startChatSession(config: AISessionConfig & {...})
    → SessionLifecycleManager.executeQuery(ExecuteQueryConfig)
      → SdkQueryOptionsBuilder.build(QueryOptionsInput)
        → SdkQueryOptions → SDK Options (query function)

  → PtahCliAdapter.startChatSession(config)
    → PtahCliAdapter.buildQueryOptions(input)
      → SdkQueryOptions → SDK Options (query function)
```

### SDK API Verified

The actual Claude Agent SDK (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` lines 614-644) confirms these options exist on the `Options` interface:

```typescript
// SDK Options interface (verified)
thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' };
effort?: 'low' | 'medium' | 'high' | 'max';
maxThinkingTokens?: number; // deprecated, use thinking instead
```

### Local SDK Types File

The project copies SDK types to `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` (line 1539: `interface Options`). This file currently does NOT include `thinking` or `effort` fields. They must be added.

### Existing Pattern: Codex/Copilot Reasoning Effort

The agent orchestration config component already has reasoning effort selectors for Codex and Copilot CLI agents (lines 172-228 and 278-330 in `agent-orchestration-config.component.ts`). These use a different mechanism (stored in `AgentOrchestrationConfig`, passed via CLI flags). The main SDK adapter has no such configuration.

### Key Files & Evidence

| File                                                                                     | Purpose                                              | Evidence                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `libs/shared/src/lib/types/ai-provider.types.ts:83-108`                                  | `AISessionConfig` interface                          | No thinking/effort fields currently                   |
| `libs/shared/src/lib/types/rpc.types.ts:45-77`                                           | `ChatStartParams` interface                          | Has `options` object with model, systemPrompt, preset |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:202-289`            | `QueryOptionsInput` and `SdkQueryOptions` interfaces | No thinking/effort fields                             |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:82-125`             | `ExecuteQueryConfig` interface                       | No thinking/effort fields                             |
| `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-adapter.ts:736-894`                    | `buildQueryOptions` private method                   | No thinking/effort in options output                  |
| `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:1539-1637`           | SDK `Options` interface (local copy)                 | Missing thinking/effort (needs update)                |
| `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts` | Model selector UI in chat input bar                  | Good location candidate for effort selector           |

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Thread configuration through existing `AISessionConfig` -> `QueryOptionsInput` -> `SdkQueryOptions` chain, matching the established pattern for other SDK options (model, systemPrompt, maxTokens, preset, etc.).

**Rationale**: Every existing option follows this exact chain. Adding thinking/effort follows the same pattern with zero architectural changes.

**Default Behavior**:

- `thinking`: `undefined` (SDK defaults to `adaptive` for Opus 4.6+, `enabled` for older models)
- `effort`: `undefined` (SDK defaults to `high`)

This means existing sessions are unaffected -- the SDK applies its own defaults when these are omitted.

---

## Component Specifications

### Component 1: Shared Types - ThinkingConfig and EffortLevel

**Purpose**: Define the reasoning configuration types in the shared library so both frontend and backend can use them.

**Pattern**: Same as existing `preset` field on `AISessionConfig` (verified: `ai-provider.types.ts:97-107`)

**Evidence**: `AISessionConfig` already has `model`, `systemPrompt`, `preset` -- these are simple optional fields.

**Responsibilities**:

- Define `ThinkingConfig` type union
- Define `EffortLevel` type
- Add both to `AISessionConfig` interface

**Implementation Pattern**:

```typescript
// In libs/shared/src/lib/types/ai-provider.types.ts

/** Thinking/reasoning mode configuration for Claude SDK */
export type ThinkingConfig = { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' };

/** Effort level for Claude's reasoning depth */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface AISessionConfig {
  // ... existing fields ...

  /**
   * TASK_2025_184: Thinking/reasoning configuration for Claude SDK.
   * Controls how Claude uses extended thinking.
   * - adaptive: Claude decides when/how much to think (default for Opus 4.6+)
   * - enabled: Fixed thinking token budget
   * - disabled: No extended thinking
   *
   * When undefined, SDK applies its own default (adaptive for supported models).
   */
  readonly thinking?: ThinkingConfig;

  /**
   * TASK_2025_184: Effort level for Claude's reasoning depth.
   * Works with adaptive thinking to guide thinking depth.
   * - low: Minimal thinking, fastest responses
   * - medium: Moderate thinking
   * - high: Deep reasoning (SDK default)
   * - max: Maximum effort (Opus 4.6 only)
   *
   * When undefined, SDK defaults to 'high'.
   */
  readonly effort?: EffortLevel;
}
```

**Quality Requirements**:

- Types must be serializable (no functions) since they cross the RPC boundary
- Must be exported from `@ptah-extension/shared`

**Files Affected**:

- `libs/shared/src/lib/types/ai-provider.types.ts` (MODIFY) - Add types + fields to AISessionConfig
- `libs/shared/src/index.ts` (MODIFY) - Export new types if not already barrel-exported via ai-provider.types.ts

---

### Component 2: SDK Types Update - Add thinking/effort to Options

**Purpose**: Update the local copy of SDK types to include the `thinking` and `effort` fields that exist in the actual SDK.

**Pattern**: Direct copy from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (lines 614-644)

**Evidence**: These fields exist in the installed SDK (verified via grep of sdk.d.ts)

**Responsibilities**:

- Add `thinking` field to `Options` interface
- Add `effort` field to `Options` interface

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` (MODIFY) - Add thinking/effort to Options interface (around line 1587, after `includePartialMessages`)

---

### Component 3: QueryOptionsBuilder - Thread thinking/effort through

**Purpose**: Accept thinking/effort in input, pass them to the SDK query options.

**Pattern**: Same as how `isPremium`, `mcpServerRunning`, `enhancedPromptsContent`, `pluginPaths`, `permissionMode` are threaded (verified: `sdk-query-options-builder.ts:202-253`)

**Evidence**:

- `QueryOptionsInput` interface (line 202) accepts session-level config
- `SdkQueryOptions` interface (line 259) maps to SDK `Options`
- `build()` method (line 345) destructures input and builds options

**Responsibilities**:

- Add `thinking` and `effort` to `QueryOptionsInput` interface
- Add `thinking` and `effort` to `SdkQueryOptions` interface
- Thread them through in `build()` method

**Implementation Pattern**:

```typescript
// In QueryOptionsInput (add fields):
thinking?: ThinkingConfig;
effort?: EffortLevel;

// In SdkQueryOptions (add fields):
thinking?: ThinkingConfig;
effort?: EffortLevel;

// In build() method, add to returned options:
return {
  prompt: userMessageStream,
  options: {
    // ...existing fields...
    thinking: sessionConfig?.thinking,
    effort: sessionConfig?.effort,
  },
};
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)

---

### Component 4: SessionLifecycleManager - Thread thinking/effort

**Purpose**: Pass thinking/effort from `ExecuteQueryConfig` through to `queryOptionsBuilder.build()`.

**Pattern**: Same as `isPremium`, `mcpServerRunning` threading (verified: `session-lifecycle-manager.ts:82-125` and lines 618-630)

**Evidence**: `ExecuteQueryConfig` has fields that get passed through to `queryOptionsBuilder.build()`

**Responsibilities**:

- No changes needed to `ExecuteQueryConfig` -- thinking/effort are already part of `sessionConfig: AISessionConfig` which is passed through
- Verify that `sessionConfig` is passed to `queryOptionsBuilder.build()` (it is, at line 621)

**Analysis**: The `sessionConfig` is passed as-is to `queryOptionsBuilder.build()` via the `sessionConfig` field. The builder reads thinking/effort from `sessionConfig` directly. No changes needed in this file.

**Files Affected**: None (thinking/effort travel via `sessionConfig`)

---

### Component 5: PtahCliAdapter - Add thinking/effort to query options

**Purpose**: Pass thinking/effort from the session config to the SDK query options in the Ptah CLI adapter's own `buildQueryOptions` method.

**Pattern**: Same as how `systemPrompt`, `preset`, `isPremium`, etc. are threaded (verified: `ptah-cli-adapter.ts:736-894`)

**Evidence**:

- `buildQueryOptions` accepts its own input object (line 736)
- Builds `SdkQueryOptions` independently from the DI builder
- Returns options to be passed to `queryFn()`

**Responsibilities**:

- Accept `thinking` and `effort` in the input parameter
- Pass them through to the returned options object
- Thread from `startChatSession` and `resumeSession` callers

**Implementation Pattern**:

```typescript
// In buildQueryOptions input type, add:
thinking?: ThinkingConfig;
effort?: EffortLevel;

// In returned options:
return {
  prompt: userMessageStream,
  options: {
    // ...existing fields...
    thinking: input.thinking,
    effort: input.effort,
  },
};

// In startChatSession, pass from config:
const queryOptions = this.buildQueryOptions({
  // ...existing...
  thinking: config.thinking,
  effort: config.effort,
});

// Same in resumeSession
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-adapter.ts` (MODIFY)

---

### Component 6: RPC Types - Add thinking/effort to ChatStartParams

**Purpose**: Allow the frontend to pass thinking/effort configuration when starting or continuing a chat.

**Pattern**: Same as `preset` in `ChatStartParams.options` (verified: `rpc.types.ts:61-76`)

**Evidence**: `ChatStartParams.options` already has `model`, `systemPrompt`, `files`, `images`, `preset`

**Responsibilities**:

- Add `thinking` and `effort` to `ChatStartParams.options`
- Add `thinking` and `effort` to `ChatContinueParams` (for mid-session changes)

**Implementation Pattern**:

```typescript
// In ChatStartParams.options:
export interface ChatStartParams {
  // ...existing...
  options?: {
    model?: string;
    systemPrompt?: string;
    files?: string[];
    images?: InlineImageAttachment[];
    preset?: 'claude_code' | 'enhanced';
    /** TASK_2025_184: Thinking/reasoning configuration */
    thinking?: ThinkingConfig;
    /** TASK_2025_184: Effort level for reasoning depth */
    effort?: EffortLevel;
  };
}
```

**Files Affected**:

- `libs/shared/src/lib/types/rpc.types.ts` (MODIFY)

---

### Component 7: ChatRpcHandlers - Thread thinking/effort to adapter

**Purpose**: Pass the thinking/effort config from RPC params to the SDK adapter's `startChatSession` call.

**Pattern**: Same as `preset` threading (verified: `chat-rpc.handlers.ts` lines 699-716)

**Evidence**: The handler extracts `options` from params and passes individual fields to `startChatSession`

**Responsibilities**:

- Extract `thinking` and `effort` from `params.options`
- Pass to `startChatSession` config
- Same for PtahCliAdapter dispatch path

**Files Affected**:

- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` (MODIFY)

---

### Component 8: Frontend UI - Effort Level Selector

**Purpose**: Allow users to configure the effort level for the main Claude SDK sessions. The thinking config is more advanced (adaptive is the default and rarely needs changing), so only expose effort level in the UI.

**Pattern**: Matches the existing reasoning effort selectors for Codex/Copilot in `agent-orchestration-config.component.ts` (lines 172-228). However, this goes in the main chat input area since it applies to the main Claude adapter.

**Responsibilities**:

- Add an effort level dropdown near the model selector in the chat input bar
- Store the selected effort level in the chat store or pass it per-message
- Pass the value through `ChatStartParams.options.effort`

**Design Decision**: The effort selector should be placed in the **chat input bar** near the model selector, since effort level is a per-session concern (like model selection). It should be a compact dropdown matching the model selector's style.

**Alternative considered**: Adding it to Settings. Rejected because effort level is something users toggle frequently based on task complexity, similar to model selection.

**Implementation Pattern**:

The effort selector should be a new compact component in the chat input bar area. It can be a simple `<select>` or a small dropdown button showing the current effort level (e.g., "High" by default).

```typescript
// New component: effort-selector.component.ts
// Location: libs/frontend/chat/src/lib/components/molecules/chat-input/

@Component({
  selector: 'ptah-effort-selector',
  template: `
    <select class="select select-ghost select-xs h-6 min-h-0 text-[10px] font-mono w-20" [value]="selectedEffort()" (change)="onEffortChange($event)">
      <option value="">Default</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="max">Max</option>
    </select>
  `,
})
export class EffortSelectorComponent {
  readonly selectedEffort = signal<EffortLevel | ''>('');
  readonly effortChanged = output<EffortLevel | undefined>();

  onEffortChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as EffortLevel | '';
    this.selectedEffort.set(value);
    this.effortChanged.emit(value || undefined);
  }
}
```

The `ChatInputComponent` should track the selected effort level and include it in `ChatStartParams.options.effort` when sending messages.

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` (MODIFY) - Integrate effort selector
- `libs/frontend/chat/src/index.ts` (MODIFY) - Export new component if needed

---

## Integration Architecture

### Data Flow

```
User selects "Low" in effort dropdown
  → ChatInputComponent stores effort signal
  → On message send, includes effort in ChatStartParams.options.effort
  → ChatRpcHandlers receives params
  → Extracts options.effort, passes to SdkAgentAdapter.startChatSession({...effort})
  → AISessionConfig now has effort field
  → SessionLifecycleManager.executeQuery passes sessionConfig to builder
  → SdkQueryOptionsBuilder.build reads sessionConfig.effort
  → Includes effort in SdkQueryOptions
  → SDK query() receives effort in options
  → Claude adjusts reasoning depth accordingly
```

For PtahCliAdapter, the same chain but shorter:

```
ChatRpcHandlers → PtahCliAdapter.startChatSession(config with effort)
  → buildQueryOptions reads config.effort
  → Passes to SDK options
```

### Dependencies

- `ThinkingConfig` and `EffortLevel` types defined in `@ptah-extension/shared`
- Imported by both `agent-sdk` library and `chat` frontend library
- No new external dependencies required

---

## Quality Requirements

### Functional Requirements

- Effort level selection available in the chat input area
- Selected effort level is passed to the SDK for each new session/message
- Default behavior unchanged when no effort level is selected (SDK defaults to "high")
- Thinking config passthrough works for programmatic use (no UI, but wired)
- Both SdkAgentAdapter and PtahCliAdapter support the new options

### Non-Functional Requirements

- **Performance**: No impact -- just two additional optional fields in config objects
- **Backward Compatibility**: All new fields are optional with undefined defaults
- **Type Safety**: ThinkingConfig is a discriminated union, EffortLevel is a string literal union

### Pattern Compliance

- Follows AISessionConfig extension pattern (verified: `ai-provider.types.ts:83-108`)
- Follows ChatStartParams.options extension pattern (verified: `rpc.types.ts:61-76`)
- Follows SdkQueryOptions extension pattern (verified: `sdk-query-options-builder.ts:259-289`)
- Follows chat input component pattern for per-session selectors (verified: `model-selector.component.ts`)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both (backend + frontend)

**Rationale**:

- Backend work: Type definitions, config threading through 4 files -- straightforward plumbing
- Frontend work: New effort selector component, integration into chat input -- small Angular component

**Alternative**: A single full-stack developer can handle this since it's all TypeScript with minimal complexity per file.

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-4 hours

**Breakdown**:

- Shared types (Component 1): ~15 min
- SDK types update (Component 2): ~10 min
- QueryOptionsBuilder (Component 3): ~15 min
- PtahCliAdapter (Component 5): ~20 min
- RPC types (Component 6): ~10 min
- ChatRpcHandlers (Component 7): ~20 min
- Frontend effort selector (Component 8): ~60 min
- Testing & verification: ~30 min

### Files Affected Summary

**CREATE**:

- `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts`

**MODIFY**:

- `libs/shared/src/lib/types/ai-provider.types.ts` - Add ThinkingConfig, EffortLevel types + AISessionConfig fields
- `libs/shared/src/lib/types/rpc.types.ts` - Add thinking/effort to ChatStartParams.options
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` - Add thinking/effort to Options interface
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` - Thread thinking/effort through QueryOptionsInput, SdkQueryOptions, and build()
- `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-adapter.ts` - Thread thinking/effort through buildQueryOptions, startChatSession, resumeSession
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` - Pass thinking/effort from RPC params to adapters
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` - Integrate effort selector

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **SDK types match actual SDK**:

   - Check `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for exact thinking/effort types
   - Ensure local types in `claude-sdk.types.ts` match exactly

2. **All imports exist**:

   - `ThinkingConfig` from `@ptah-extension/shared` (after adding)
   - `EffortLevel` from `@ptah-extension/shared` (after adding)

3. **No breaking changes**:

   - All new fields are optional
   - Default behavior (undefined) matches SDK defaults
   - Existing tests should pass unchanged

4. **SDK version compatibility**:
   - Verify SDK version 0.2.25 supports thinking/effort options
   - Already confirmed via grep of `sdk.d.ts`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
