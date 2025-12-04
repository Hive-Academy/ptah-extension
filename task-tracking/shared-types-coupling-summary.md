# Shared Types Coupling Summary - Quick Reference

**Analysis Date**: 2025-12-04
**Full Report**: [shared-types-cli-coupling-analysis.md](./shared-types-cli-coupling-analysis.md)

---

## TL;DR - Executive Summary

**Question**: Can our shared type system support both Claude CLI AND Claude Agent SDK?

**Answer**: ✅ **YES** - with a parallel type system strategy (70% shared, 30% provider-specific)

**Strategy**: Keep CLI types intact, add SDK types alongside, frontend stays agnostic via IAIProvider interface.

**Impact**: 🟢 **ZERO BREAKING CHANGES** to existing codebase

---

## Type System Breakdown (11 Files Analyzed)

### 🟢 100% Generic (Shared Across CLI & SDK)

| File                         | Types                                           | Why Generic                    | Action               |
| ---------------------------- | ----------------------------------------------- | ------------------------------ | -------------------- |
| **branded.types.ts**         | SessionId, MessageId, CorrelationId             | Universal ID system            | ✅ Keep as-is        |
| **content-block.types.ts**   | ContentBlock, TextContentBlock, etc.            | Universal content model        | ✅ Keep as-is        |
| **ai-provider.types.ts**     | IAIProvider, ProviderInfo, ProviderCapabilities | Provider abstraction interface | 🔧 Extend ProviderId |
| **permission.types.ts**      | PermissionRequest, PermissionResponse           | MCP standard (universal)       | ✅ Keep as-is        |
| **common.types.ts**          | Re-exports of StrictChatMessage/Session         | UI metadata                    | ✅ Keep as-is        |
| **webview-ui.types.ts**      | Dashboard, DropdownOption                       | UI components                  | ✅ Keep as-is        |
| **command-builder.types.ts** | CommandTemplate, TemplateParameter              | Command system                 | ✅ Keep as-is        |
| **model-autopilot.types.ts** | ModelInfo, PermissionLevel                      | UI controls                    | ✅ Keep as-is        |

**Result**: 8/11 files (72%) are provider-agnostic - no changes needed!

---

### 🟡 60% Adaptable (Needs SDK Variants)

| File                 | CLI-Specific Types                             | SDK Needs                                 | Action              |
| -------------------- | ---------------------------------------------- | ----------------------------------------- | ------------------- |
| **message.types.ts** | ChatSessionInitPayload (claudeSessionId field) | SDKSessionInitPayload (sdkConversationId) | 🔧 Add SDK variants |
| **message.types.ts** | ChatHealthUpdatePayload (CLI binary health)    | SDKHealthUpdatePayload (API latency)      | 🔧 Add SDK variants |
| **message.types.ts** | ChatCliErrorPayload (process errors)           | SDKAgentErrorPayload (API errors)         | 🔧 Add SDK variants |

**Result**: ~20% of message types need SDK-specific variants (94 types → ~20 new SDK types)

---

### 🔴 100% CLI-Specific (Parallel Implementation)

| File                        | CLI-Specific Types                        | SDK Alternative                       | Action                        |
| --------------------------- | ----------------------------------------- | ------------------------------------- | ----------------------------- |
| **claude-domain.types.ts**  | ClaudeCliHealth (binary path, version)    | SDKClientHealth (API status, latency) | 🆕 Create sdk-domain.types.ts |
| **claude-domain.types.ts**  | ClaudeCliLaunchOptions (subprocess spawn) | SDKClientOptions (API key, endpoint)  | 🆕 Create sdk-domain.types.ts |
| **claude-domain.types.ts**  | ClaudeSessionResume (claudeSessionId)     | SDKSessionResume (sdkConversationId)  | 🆕 Create sdk-domain.types.ts |
| **execution-node.types.ts** | JSONLMessage (JSONL parser)               | SDKStreamEvent (SSE/WebSocket)        | 🆕 Create sdk-stream.types.ts |

**Result**: 2/11 files (18%) are CLI-only - create parallel SDK files.

---

## Shared Events (Universal Across Providers)

**These types work for BOTH CLI and SDK without changes**:

```typescript
// From claude-domain.types.ts - UNIVERSAL TOOL EVENTS
export type ClaudeToolEvent =
  | ClaudeToolEventStart // Tool execution started
  | ClaudeToolEventProgress // Tool in progress
  | ClaudeToolEventResult // Tool completed successfully
  | ClaudeToolEventError; // Tool failed

// From claude-domain.types.ts - UNIVERSAL AGENT EVENTS
export type ClaudeAgentEvent =
  | ClaudeAgentStartEvent // Agent spawned (Task tool)
  | ClaudeAgentActivityEvent // Agent executing tools
  | ClaudeAgentCompleteEvent; // Agent task finished
```

**Why this matters**: Frontend components already render these events - SDK will emit the same events, zero UI changes needed!

---

## Architecture Decision: Parallel Type Systems

### Current (CLI-Only)

```
Frontend → IAIProvider → ClaudeCliAdapter → CLI Subprocess
             ↓
         CLI Types (claude-domain.types.ts, message.types.ts)
```

### Proposed (Multi-Provider)

```
                      ┌→ ClaudeCliAdapter → CLI Subprocess
Frontend → IAIProvider                       (CLI Types)
                      │
                      └→ ClaudeSDKAdapter → SDK Client
                                            (SDK Types)
```

**Key Insight**: Frontend only depends on `IAIProvider` interface - adding SDK adapter requires ZERO frontend changes!

---

## New Files to Create (Phase 1)

**libs/shared/src/lib/types/**:

1. **sdk-domain.types.ts** (60 lines)

   - SDKClientHealth
   - SDKClientOptions
   - SDKSessionResume
   - SDKHealthUpdatePayload

2. **sdk-message.types.ts** (120 lines)

   - SDKSessionInitPayload
   - SDKAgentErrorPayload
   - SDK-specific message payloads

3. **sdk-stream.types.ts** (80 lines)
   - SDKStreamEvent
   - SDKContentDelta
   - SDK streaming event types

**Total**: 3 new files (~260 lines), ZERO modifications to existing files.

---

## Updated Files (Minimal Changes)

1. **libs/shared/src/lib/types/ai-provider.types.ts** (1 line change)

   ```typescript
   // Before
   export type ProviderId = 'claude-cli' | 'vscode-lm';

   // After
   export type ProviderId = 'claude-cli' | 'vscode-lm' | 'claude-sdk';
   ```

2. **libs/shared/src/index.ts** (3 lines added)
   ```typescript
   export * from './lib/types/sdk-domain.types';
   export * from './lib/types/sdk-message.types';
   export * from './lib/types/sdk-stream.types';
   ```

**Total**: 2 files, 4 lines changed.

---

## Type Reuse Matrix

| Type Category       | Total Types | Shared (CLI+SDK) | CLI-Only     | SDK-Only     |
| ------------------- | ----------- | ---------------- | ------------ | ------------ |
| Foundation Types    | 3           | 3 (100%)         | 0            | 0            |
| Content Blocks      | 5           | 5 (100%)         | 0            | 0            |
| Provider Interfaces | 8           | 8 (100%)         | 0            | 0            |
| Tool/Agent Events   | 10          | 10 (100%)        | 0            | 0            |
| Domain Types        | 12          | 0 (0%)           | 7            | 5            |
| Message Payloads    | 94          | 74 (79%)         | 10           | 10           |
| Streaming Types     | 15          | 0 (0%)           | 8            | 7            |
| UI Types            | 20          | 20 (100%)        | 0            | 0            |
| **TOTAL**           | **167**     | **120 (72%)**    | **25 (15%)** | **22 (13%)** |

**Takeaway**: 72% of types are shared! Only 15% are CLI-specific, 13% will be SDK-specific.

---

## Impact Assessment by Component

| Component                    | CLI Types Used                           | Impact of Adding SDK | Required Changes                     |
| ---------------------------- | ---------------------------------------- | -------------------- | ------------------------------------ |
| **Frontend (webview)**       | IAIProvider, ContentBlock, ExecutionNode | 🟢 None              | 0 files (uses interface abstraction) |
| **Backend CLI Adapter**      | ClaudeCliHealth, JSONLMessage            | 🟢 None              | 0 files (keeps using CLI types)      |
| **Backend Provider Manager** | ProviderId, ProviderInfo                 | 🟡 Minimal           | 1 file (register 'claude-sdk')       |
| **Message Handlers**         | MessagePayloadMap                        | 🟡 Minimal           | 1 file (add SDK message handlers)    |
| **Event Bus**                | ClaudeToolEvent, ClaudeAgentEvent        | 🟢 None              | 0 files (events are universal)       |

---

## Risk Assessment

| Risk                   | Impact      | Likelihood | Mitigation                                |
| ---------------------- | ----------- | ---------- | ----------------------------------------- |
| Breaking CLI code      | 🔴 Critical | 🟢 Low     | Parallel types - zero CLI changes         |
| Frontend breaks        | 🔴 Critical | 🟢 Low     | IAIProvider abstraction shields frontend  |
| Type explosion         | 🟡 Medium   | 🟡 Medium  | Decision matrix + consolidation phase     |
| Message routing errors | 🟡 Medium   | 🟡 Medium  | Strict typing via MessagePayloadMap       |
| SDK event mapping      | 🟡 Medium   | 🟡 Medium  | SDKEventProcessor mirrors JSONL processor |

**Overall Risk**: 🟢 **LOW** - Architecture supports parallel systems cleanly.

---

## Implementation Phases

### Phase 1: Foundation (1-2 hours)

- ✅ Create SDK type files (sdk-domain.types.ts, sdk-message.types.ts, sdk-stream.types.ts)
- ✅ Extend ProviderId to include 'claude-sdk'
- ✅ Add SDK exports to libs/shared/src/index.ts
- ✅ Update documentation (libs/shared/CLAUDE.md)

**Validation**: `nx test shared` and `nx lint shared` pass (zero breaking changes)

### Phase 2: SDK Adapter (4-6 hours)

- ✅ Create libs/backend/ai-providers-sdk library
- ✅ Implement ClaudeSDKAdapter (implements IAIProvider)
- ✅ Create SDKEventProcessorService (equivalent to JsonlProcessorService)
- ✅ Register SDK provider in ProviderManager

**Validation**: Frontend works with SDK without code changes

### Phase 3: Message Protocol (2-3 hours)

- ✅ Add SDK message types to MessagePayloadMap
- ✅ Add SDK message handlers to MessageHandlerService
- ✅ Add Zod schemas for SDK message validation

**Validation**: SDK messages routed correctly, runtime validation works

### Phase 4: Consolidation (Optional, 3-4 hours)

- ✅ Abstract common patterns (ISessionInitPayload, IProviderHealth)
- ✅ Deprecate redundant CLI-specific names
- ✅ Consolidate overlapping types where possible

**Validation**: Backward compatibility maintained via deprecated aliases

---

## Key Architectural Insights

### 1. IAIProvider Abstraction is the Key

Frontend depends on `IAIProvider` interface, not concrete implementations. This means:

- Adding ClaudeSDKAdapter requires ZERO frontend changes
- Provider switching works automatically via ProviderManager
- Frontend components don't know (or care) if provider is CLI or SDK

**Evidence**:

```typescript
// libs/frontend/core/src/lib/services/claude-rpc.service.ts
export class ClaudeRPCService {
  private currentProvider$: BehaviorSubject<IAIProvider | null>;

  async sendMessage(content: string, options?: AIMessageOptions) {
    const provider = this.currentProvider$.value;
    // Works with ANY provider implementing IAIProvider
    await provider.sendMessageToSession(sessionId, content, options);
  }
}
```

### 2. ContentBlock[] is the Universal Content Format

All providers emit `ContentBlock[]` arrays (text, thinking, tool_use, tool_result). Frontend components render ContentBlock arrays without knowing the provider:

- CLI: JSONLMessage → ContentBlock[] (via JsonlProcessorService)
- SDK: SDKStreamEvent → ContentBlock[] (via SDKEventProcessorService)

**Why this matters**: Frontend chat components work with ANY provider without changes!

### 3. Tool/Agent Events are Provider-Agnostic

`ClaudeToolEvent` and `ClaudeAgentEvent` types work for both CLI and SDK:

- CLI subprocess emits tool events (start, progress, result, error)
- SDK will emit the SAME events (start, progress, result, error)
- Frontend components already render these events

**Result**: Agent visualization (ExecutionNode tree) works for SDK without changes!

### 4. Parallel Type Systems Avoid Breaking Changes

Instead of refactoring existing CLI types (risky), we add SDK types alongside:

- CLI types stay intact (100% backward compatible)
- SDK types live in separate files (sdk-domain.types.ts, sdk-message.types.ts)
- Future consolidation phase merges overlapping types (Phase 4)

**Benefit**: Zero risk to existing CLI functionality during SDK integration.

---

## Decision Matrix (Quick Reference)

Use this to classify new types:

```
Is the type a UNIVERSAL CONCEPT (what) or IMPLEMENTATION DETAIL (how)?

UNIVERSAL → SHARED
- Identity: SessionId, MessageId
- Content: ContentBlock, ToolUseContentBlock
- Events: ClaudeToolEvent, ClaudeAgentEvent
- Interfaces: IAIProvider, ProviderInfo

IMPLEMENTATION DETAIL → PROVIDER-SPECIFIC
- Health: ClaudeCliHealth (CLI) vs SDKClientHealth (SDK)
- Initialization: ClaudeCliLaunchOptions (CLI) vs SDKClientOptions (SDK)
- Streaming: JSONLMessage (CLI) vs SDKStreamEvent (SDK)
- Session IDs: claudeSessionId (CLI) vs sdkConversationId (SDK)
```

---

## Success Criteria

### ✅ Phase 1 Complete When:

- SDK type files created (3 new files)
- ProviderId includes 'claude-sdk'
- All tests pass (`nx test shared`)
- Documentation updated (type classification guide)

### ✅ Phase 2 Complete When:

- ClaudeSDKAdapter implements IAIProvider
- Frontend works with SDK (no code changes)
- Provider switching works (CLI ↔ SDK)
- SDKEventProcessor produces correct ExecutionNode tree

### ✅ Phase 3 Complete When:

- SDK messages routed correctly
- Runtime validation works for SDK messages
- No `any` types in message payloads

### ✅ Phase 4 Complete When:

- Redundant types consolidated
- Deprecated aliases removed
- Type system documentation complete

---

## Conclusion

**The shared type system is READY for Claude Agent SDK integration.**

**Why**:

- 72% of types are already provider-agnostic (no changes needed)
- IAIProvider abstraction shields frontend from provider details
- ContentBlock[] universal format works for CLI and SDK
- Parallel type system strategy avoids breaking changes

**Recommended Path**: Proceed with Phase 1 (create SDK type files), then implement ClaudeSDKAdapter in Phase 2. Frontend will work with SDK automatically via IAIProvider interface.

**Estimated Effort**: 10-15 hours total (Phases 1-3), Phase 4 (consolidation) is optional.

**Risk Level**: 🟢 LOW - Architecture supports this cleanly with zero breaking changes.

---

**Full Analysis**: See [shared-types-cli-coupling-analysis.md](./shared-types-cli-coupling-analysis.md) for detailed type-by-type breakdown, code examples, and risk assessment.
