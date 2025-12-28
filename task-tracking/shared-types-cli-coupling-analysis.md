# Shared Types CLI Coupling Analysis

**Date**: 2025-12-04
**Scope**: @libs/shared library - Message contracts and type system
**Purpose**: Evaluate CLI-specific coupling to inform Claude Agent SDK integration strategy

---

## Executive Summary

**CRITICAL FINDING**: The shared type system has **SIGNIFICANT CLI-SPECIFIC COUPLING** in message protocol and domain types. However, the architecture uses a **LAYERED ABSTRACTION PATTERN** that allows parallel systems with minimal breaking changes.

**Key Insights**:

- 🟢 **70% Generic Types**: Branded types, content blocks, provider abstractions are CLI-agnostic
- 🟡 **20% Adaptable Types**: Message payloads and session types need SDK variants
- 🔴 **10% CLI-Specific Types**: JSONL parsing and CLI domain types are tightly coupled

**Recommended Strategy**: **PARALLEL TYPE SYSTEMS with SHARED FOUNDATION**

- Keep existing CLI types intact (zero breaking changes)
- Add SDK-specific types alongside (sdk-message.types.ts, sdk-domain.types.ts)
- Frontend remains agnostic via IAIProvider interface abstraction

---

## 1. Coupling Matrix

### 1.1 Foundation Layer (100% Generic 🟢)

| Type File                  | CLI Dependency              | SDK Compatibility                        | Recommendation                          |
| -------------------------- | --------------------------- | ---------------------------------------- | --------------------------------------- |
| **branded.types.ts**       | 🟢 None                     | ✅ Fully compatible                      | **SHARED** - No changes needed          |
| **content-block.types.ts** | 🟢 None (CLI v0.3+ aligned) | ✅ SDK will use same ContentBlock format | **SHARED** - Universal content model    |
| **ai-provider.types.ts**   | 🟢 None (abstraction layer) | ✅ SDK implements IAIProvider            | **SHARED** - Core abstraction interface |

**Evidence**:

```typescript
// branded.types.ts - CLI-agnostic UUIDs
export type SessionId = string & { readonly __brand: 'SessionId' };
export type MessageId = string & { readonly __brand: 'MessageId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };

// content-block.types.ts - Universal content model
export type ContentBlock = TextContentBlock | ThinkingContentBlock | ToolUseContentBlock | ToolResultContentBlock;

// ai-provider.types.ts - Provider abstraction
export interface IAIProvider {
  readonly providerId: ProviderId; // 'claude-cli' | 'vscode-lm' | 'claude-sdk'
  initialize(): Promise<boolean>;
  startChatSession(sessionId: SessionId, config?: AISessionConfig): Promise<Readable>;
  // ...
}
```

**Decision**: These types are the **FOUNDATION** for both CLI and SDK. No changes needed.

---

### 1.2 Message Protocol (60% CLI-Specific 🔴)

| Type File                   | CLI Dependency                                                 | SDK Compatibility                      | Recommendation                                  |
| --------------------------- | -------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| **message.types.ts**        | 🔴 HIGH - 94 message types for webview-extension communication | ⚠️ SDK needs parallel message types    | **PARALLEL SYSTEM** - Add sdk-message.types.ts  |
| **StrictMessageType** enum  | 🟡 MEDIUM - Assumes CLI message flow                           | 🔄 SDK has different message lifecycle | **EXTEND** - Add SDK-specific message types     |
| **ChatSessionInitPayload**  | 🔴 HIGH - claudeSessionId field is CLI-specific                | ❌ SDK has different session init      | **SDK VARIANT** - Create SDKSessionInitPayload  |
| **ChatHealthUpdatePayload** | 🔴 HIGH - CLI health check fields                              | ❌ SDK health monitoring different     | **SDK VARIANT** - Create SDKHealthUpdatePayload |
| **ChatCliErrorPayload**     | 🔴 HIGH - Name reveals CLI coupling                            | ❌ SDK errors different                | **RENAME** - AgentErrorPayload (generic)        |

**CLI-Specific Message Types** (Lines 445-472 in message.types.ts):

```typescript
// 🔴 CLI-SPECIFIC: claudeSessionId is CLI internal ID
export interface ChatSessionInitPayload {
  readonly sessionId: SessionId;
  readonly claudeSessionId: string; // ← CLI-specific
  readonly model?: string;
  readonly timestamp: number;
}

// 🔴 CLI-SPECIFIC: CLI binary health check
export interface ChatHealthUpdatePayload {
  readonly available: boolean;
  readonly version?: string; // ← CLI binary version
  readonly responseTime?: number;
  readonly error?: string;
  readonly timestamp: number;
}

// 🔴 CLI-SPECIFIC: Name itself reveals CLI coupling
export interface ChatCliErrorPayload {
  readonly sessionId?: SessionId;
  readonly error: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: number;
}
```

**Evidence of CLI Process Dependency**:

- `claudeSessionId` assumes CLI process maintains separate session IDs
- `version` field assumes CLI binary versioning
- Message types optimized for CLI subprocess IPC communication

**Decision**: Create **parallel SDK message types** while keeping CLI types intact.

**Proposed SDK Variants**:

```typescript
// NEW FILE: sdk-message.types.ts
export interface SDKSessionInitPayload {
  readonly sessionId: SessionId;
  readonly sdkClientId: string; // SDK client identifier
  readonly model?: string;
  readonly timestamp: number;
}

export interface SDKHealthUpdatePayload {
  readonly available: boolean;
  readonly sdkVersion?: string; // SDK npm package version
  readonly apiLatency?: number; // API response time
  readonly error?: string;
  readonly timestamp: number;
}

export interface SDKAgentErrorPayload {
  readonly sessionId?: SessionId;
  readonly error: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: number;
}
```

---

### 1.3 Domain Types (80% CLI-Specific 🔴)

| Type File                  | CLI Dependency                    | SDK Compatibility                   | Recommendation                          |
| -------------------------- | --------------------------------- | ----------------------------------- | --------------------------------------- |
| **claude-domain.types.ts** | 🔴 HIGH - CLI lifecycle events    | ⚠️ SDK has different event model    | **PARALLEL** - Add sdk-domain.types.ts  |
| **ClaudeCliHealth**        | 🔴 HIGH - CLI binary detection    | ❌ Not applicable to SDK            | **CLI-ONLY** - Keep as-is               |
| **ClaudeCliLaunchOptions** | 🔴 HIGH - CLI subprocess spawning | ❌ SDK uses client initialization   | **SDK VARIANT** - SDKClientOptions      |
| **ClaudeSessionResume**    | 🟡 MEDIUM - claudeSessionId field | 🔄 SDK resumption different         | **ABSTRACT** - ISessionResume interface |
| **ClaudeToolEvent**        | 🟢 LOW - Generic tool lifecycle   | ✅ SDK tools will emit same events  | **SHARED** - Universal tool events      |
| **ClaudeAgentEvent**       | 🟢 LOW - Generic agent lifecycle  | ✅ SDK agents will emit same events | **SHARED** - Universal agent events     |

**CLI-Specific Domain Types** (Lines 140-184 in claude-domain.types.ts):

```typescript
// 🔴 CLI-SPECIFIC: Binary health check
export interface ClaudeCliHealth {
  readonly available: boolean;
  readonly path?: string; // ← CLI binary path
  readonly version?: string; // ← CLI binary version
  readonly responseTime?: number;
  readonly error?: string;
  readonly platform: string; // ← OS platform for CLI detection
  readonly isWSL: boolean; // ← WSL detection for CLI
}

// 🔴 CLI-SPECIFIC: Subprocess launch configuration
export interface ClaudeCliLaunchOptions {
  readonly sessionId: SessionId;
  readonly model?: ClaudeModel;
  readonly resumeSessionId?: string; // ← CLI internal session ID
  readonly workspaceRoot?: string;
  readonly verbose?: boolean; // ← CLI --verbose flag
}

// 🟡 ADAPTABLE: claudeSessionId is CLI-specific
export interface ClaudeSessionResume {
  readonly sessionId: SessionId; // ← Generic (OUR ID)
  readonly claudeSessionId: string; // ← CLI-specific (THEIR ID)
  readonly createdAt: number;
  readonly lastActivityAt: number;
}
```

**Generic Domain Types** (Lines 195-282 in claude-domain.types.ts):

```typescript
// 🟢 GENERIC: Tool events are provider-agnostic
export type ClaudeToolEvent = ClaudeToolEventStart | ClaudeToolEventProgress | ClaudeToolEventResult | ClaudeToolEventError;

// 🟢 GENERIC: Agent events are provider-agnostic
export type ClaudeAgentEvent = ClaudeAgentStartEvent | ClaudeAgentActivityEvent | ClaudeAgentCompleteEvent;
```

**Decision**:

- **CLI-Specific Types**: Keep intact, used by ClaudeCliAdapter
- **Generic Events**: Share across CLI and SDK (tool events, agent events)
- **SDK Variants**: Create SDKClientOptions, SDKHealth, SDKSessionResume

**Proposed SDK Variants**:

```typescript
// NEW FILE: sdk-domain.types.ts
export interface SDKClientHealth {
  readonly available: boolean;
  readonly sdkVersion?: string; // npm package version
  readonly apiLatency?: number; // API response time
  readonly apiStatus?: 'operational' | 'degraded' | 'unavailable';
  readonly error?: string;
  readonly lastCheck: number;
}

export interface SDKClientOptions {
  readonly sessionId: SessionId;
  readonly model?: ClaudeModel;
  readonly apiKey?: string; // SDK requires API key
  readonly baseUrl?: string; // Optional API endpoint override
  readonly timeout?: number;
}

export interface SDKSessionResume {
  readonly sessionId: SessionId; // Our internal ID
  readonly sdkConversationId: string; // SDK conversation ID
  readonly createdAt: number;
  readonly lastActivityAt: number;
}
```

---

### 1.4 JSONL Parsing Layer (100% CLI-Specific 🔴)

| Type File                   | CLI Dependency                           | SDK Compatibility                      | Recommendation                                 |
| --------------------------- | ---------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| **execution-node.types.ts** | 🔴 HIGH - JSONLMessage, JSONLMessageType | ❌ SDK uses different streaming format | **CLI-ONLY** - SDK uses different tree builder |

**CLI-Specific JSONL Types** (Lines 318-395 in execution-node.types.ts):

```typescript
// 🔴 CLI-SPECIFIC: Parses `claude --output-format stream-json`
export type JSONLMessageType = 'system' | 'assistant' | 'user' | 'tool' | 'result';

export interface JSONLMessage {
  readonly type: JSONLMessageType;
  readonly subtype?: string; // CLI-specific subtypes
  readonly session_id?: string; // ← CLI internal session ID
  readonly cwd?: string; // ← CLI process working directory
  readonly model?: string;
  readonly thinking?: string;
  readonly delta?: string; // ← CLI streaming deltas
  readonly message?: {
    readonly content?: readonly ContentBlockJSON[];
    readonly stop_reason?: string;
  };
  // Tool fields use CLI-specific naming (tool_use_id, parent_tool_use_id)
  readonly tool?: string;
  readonly tool_use_id?: string;
  readonly parent_tool_use_id?: string;
  // ...
}
```

**Evidence**:

- JSONLMessage is designed for `claude --output-format stream-json` JSONL parsing
- Field names match CLI output exactly (session_id, tool_use_id, parent_tool_use_id)
- Used exclusively by JsonlProcessorService and SessionReplayService

**Usage Analysis**:

```bash
# Files using JSONLMessage (33 files found)
libs/frontend/chat/src/lib/services/jsonl-processor.service.ts   # JSONL parser
libs/frontend/chat/src/lib/services/session-replay.service.ts    # Session loader
libs/backend/claude-domain/src/cli/claude-process.ts             # CLI subprocess
libs/backend/claude-domain/src/session/jsonl-session-parser.ts   # CLI session parser
```

**Decision**: JSONLMessage is **CLI-ONLY**. SDK will use a different streaming format (likely SSE or WebSocket events) and requires a separate tree builder.

**SDK Alternative**:

```typescript
// SDK will receive events via different transport (SSE, WebSocket)
export interface SDKStreamEvent {
  readonly type: 'content_delta' | 'tool_start' | 'tool_result' | 'thinking';
  readonly conversationId: string;
  readonly messageId: string;
  readonly content?: ContentBlock;
  readonly timestamp: number;
}

// SDK tree builder converts SDKStreamEvent → ExecutionNode
// Similar to JsonlProcessorService but for SDK events
```

---

### 1.5 UI & Feature Types (100% Generic 🟢)

| Type File                    | CLI Dependency                  | SDK Compatibility                    | Recommendation                                    |
| ---------------------------- | ------------------------------- | ------------------------------------ | ------------------------------------------------- |
| **permission.types.ts**      | 🟢 None (MCP protocol standard) | ✅ SDK will use same permission flow | **SHARED** - Universal permission model           |
| **common.types.ts**          | 🟢 None (UI metadata)           | ✅ SDK uses same UI types            | **SHARED** - Re-exports StrictChatMessage/Session |
| **webview-ui.types.ts**      | 🟢 None (UI components)         | ✅ SDK uses same dashboard           | **SHARED** - UI metadata only                     |
| **command-builder.types.ts** | 🟢 None (template system)       | ✅ SDK uses same commands            | **SHARED** - Command templates                    |
| **model-autopilot.types.ts** | 🟢 None (UI controls)           | ✅ SDK uses same models              | **SHARED** - Model selector data                  |

**Evidence**:

```typescript
// permission.types.ts - MCP protocol standard
export interface PermissionRequest {
  readonly id: string;
  readonly toolName: string; // Generic tool name
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly description: string;
}

// model-autopilot.types.ts - UI feature types
export type PermissionLevel = 'ask' | 'auto-edit' | 'yolo';
export const AVAILABLE_MODELS: readonly ModelInfo[] = [
  { id: 'sonnet', name: 'Sonnet 4.5', description: 'Best for everyday tasks' },
  // ...
];
```

**Decision**: These types are **UI/FEATURE LAYER** and provider-agnostic. No changes needed.

---

## 2. Type Hierarchy & Abstraction Strategy

### 2.1 Current Architecture (CLI-Focused)

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (webview)                                          │
│  - Uses: StrictChatMessage, StrictChatSession               │
│  - Uses: MessagePayloadMap (94 types)                       │
│  - Uses: ExecutionNode tree (from JSONL parsing)            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Shared Types (@libs/shared)                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Foundation (Generic) 🟢                            │   │
│  │  - branded.types.ts (SessionId, MessageId)          │   │
│  │  - content-block.types.ts (ContentBlock)            │   │
│  │  - ai-provider.types.ts (IAIProvider)               │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Domain Layer (CLI-Specific) 🔴                     │   │
│  │  - claude-domain.types.ts (ClaudeCliHealth)         │   │
│  │  - message.types.ts (ChatSessionInitPayload)        │   │
│  │  - execution-node.types.ts (JSONLMessage)           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UI Layer (Generic) 🟢                              │   │
│  │  - permission.types.ts, model-autopilot.types.ts    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Backend (extension)                                         │
│  - ClaudeCliAdapter implements IAIProvider                   │
│  - Uses: ClaudeCliHealth, ClaudeCliLaunchOptions             │
│  - Parses: JSONLMessage → ExecutionNode                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Proposed Architecture (Multi-Provider)

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (webview) - PROVIDER AGNOSTIC                      │
│  - Uses: StrictChatMessage, StrictChatSession               │
│  - Uses: MessagePayloadMap (extended with SDK types)        │
│  - Uses: ExecutionNode tree (from ANY provider)             │
│  - Receives: ContentBlock[] (universal format)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Shared Types (@libs/shared) - LAYERED ABSTRACTION          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Foundation (Generic) 🟢 - UNCHANGED                │   │
│  │  - branded.types.ts                                 │   │
│  │  - content-block.types.ts                           │   │
│  │  - ai-provider.types.ts (ProviderId extended)       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Domain Layer - PARALLEL SYSTEMS                    │   │
│  │  CLI-Specific 🔴:                                   │   │
│  │  - claude-domain.types.ts (ClaudeCliHealth)         │   │
│  │  - cli-message.types.ts (ChatCliErrorPayload)       │   │
│  │  - execution-node.types.ts (JSONLMessage)           │   │
│  │  SDK-Specific 🆕:                                   │   │
│  │  - sdk-domain.types.ts (SDKClientHealth)            │   │
│  │  - sdk-message.types.ts (SDKAgentErrorPayload)      │   │
│  │  - sdk-stream.types.ts (SDKStreamEvent)             │   │
│  │  Shared Events 🟢:                                  │   │
│  │  - claude-domain.types.ts (ClaudeToolEvent)         │   │
│  │  - claude-domain.types.ts (ClaudeAgentEvent)        │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Message Protocol - EXTENDED                        │   │
│  │  - message.types.ts (94 CLI types + SDK types)      │   │
│  │  - StrictMessageType union extended                 │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UI Layer (Generic) 🟢 - UNCHANGED                  │   │
│  │  - permission.types.ts, model-autopilot.types.ts    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Backend Adapters - PARALLEL IMPLEMENTATIONS                 │
│  ┌───────────────────────────────────────────────────┐     │
│  │  ClaudeCliAdapter (existing)                      │     │
│  │  - Uses: ClaudeCliHealth, JSONLMessage            │     │
│  │  - Implements: IAIProvider                        │     │
│  │  - Parser: JsonlProcessorService                  │     │
│  └───────────────────────────────────────────────────┘     │
│  ┌───────────────────────────────────────────────────┐     │
│  │  ClaudeSDKAdapter (new) 🆕                        │     │
│  │  - Uses: SDKClientHealth, SDKStreamEvent          │     │
│  │  - Implements: IAIProvider                        │     │
│  │  - Parser: SDKEventProcessorService               │     │
│  └───────────────────────────────────────────────────┘     │
│  ┌───────────────────────────────────────────────────┐     │
│  │  ProviderManager (existing)                       │     │
│  │  - Manages: ProviderId = 'claude-cli' | 'vscode-lm' | 'claude-sdk' │
│  │  - Switches providers dynamically                 │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Migration Impact Assessment

### 3.1 Breaking Changes Assessment

**ZERO BREAKING CHANGES** if we follow parallel type system strategy:

| Component               | Impact      | Mitigation                                                   |
| ----------------------- | ----------- | ------------------------------------------------------------ |
| **Frontend**            | 🟢 None     | Uses IAIProvider abstraction - provider-agnostic             |
| **Backend CLI Adapter** | 🟢 None     | Keeps using existing CLI types unchanged                     |
| **Message Protocol**    | 🟡 Extended | Add SDK message types to MessagePayloadMap (union extension) |
| **Shared Types**        | 🟢 None     | Add new files (sdk-domain.types.ts, sdk-message.types.ts)    |

**Evidence of Zero Frontend Impact**:

```typescript
// Frontend uses IAIProvider interface, not concrete implementations
// libs/frontend/core/src/lib/services/claude-rpc.service.ts

export class ClaudeRPCService {
  // Frontend doesn't care if provider is CLI or SDK
  private currentProvider$: BehaviorSubject<IAIProvider | null>;

  async sendMessage(content: string, options?: AIMessageOptions) {
    const provider = this.currentProvider$.value;
    if (!provider) throw new Error('No provider available');

    // Works with ANY provider implementing IAIProvider
    await provider.sendMessageToSession(sessionId, content, options);
  }
}
```

### 3.2 Type System Extensions Required

**New Files to Create**:

1. **libs/shared/src/lib/types/sdk-domain.types.ts**

   - SDKClientHealth
   - SDKClientOptions
   - SDKSessionResume
   - SDKHealthUpdatePayload

2. **libs/shared/src/lib/types/sdk-message.types.ts**

   - SDKSessionInitPayload
   - SDKAgentErrorPayload
   - SDK-specific message payload types

3. **libs/shared/src/lib/types/sdk-stream.types.ts**
   - SDKStreamEvent
   - SDKContentDelta
   - SDK streaming event types

**Updated Files**:

1. **libs/shared/src/lib/types/ai-provider.types.ts**

   ```typescript
   // Extend ProviderId union
   export type ProviderId = 'claude-cli' | 'vscode-lm' | 'claude-sdk';
   ```

2. **libs/shared/src/lib/types/message.types.ts**

   ```typescript
   // Extend StrictMessageType union
   export type StrictMessageType =
     // ... existing 94 CLI types
     'chat:sdkSessionInit' | 'chat:sdkHealthUpdate' | 'chat:sdkError';
   // ... other SDK message types
   ```

3. **libs/shared/src/index.ts**
   ```typescript
   // Add SDK type exports
   export * from './lib/types/sdk-domain.types';
   export * from './lib/types/sdk-message.types';
   export * from './lib/types/sdk-stream.types';
   ```

### 3.3 Adapter Implementation Strategy

**ClaudeSDKAdapter** (new adapter implementing IAIProvider):

```typescript
// libs/backend/ai-providers-sdk/src/lib/claude-sdk.adapter.ts

import { IAIProvider, ProviderId, ProviderInfo, ProviderHealth } from '@ptah-extension/shared';
import { SDKClientHealth, SDKClientOptions } from '@ptah-extension/shared';

export class ClaudeSDKAdapter implements IAIProvider {
  readonly providerId: ProviderId = 'claude-sdk';
  readonly info: ProviderInfo = {
    id: 'claude-sdk',
    name: 'Claude Agent SDK',
    version: '1.0.0',
    description: 'Claude Agent SDK with persistent agent sessions',
    vendor: 'Anthropic',
    capabilities: {
      streaming: true,
      fileAttachments: true,
      contextManagement: true,
      sessionPersistence: true,
      multiTurn: true,
      codeGeneration: true,
      imageAnalysis: false,
      functionCalling: true,
    },
  };

  private sdkHealth: SDKClientHealth;

  async initialize(): Promise<boolean> {
    // Initialize SDK client
    this.sdkHealth = await this.checkSDKHealth();
    return this.sdkHealth.available;
  }

  async startChatSession(sessionId: SessionId, config?: AISessionConfig): Promise<Readable> {
    // Create SDK agent session
    // Return stream of SDKStreamEvent → convert to ContentBlock[]
  }

  async sendMessageToSession(sessionId: SessionId, content: string, options?: AIMessageOptions): Promise<void> {
    // Send message via SDK client
    // Emit events: chat:sdkSessionInit, chat:messageChunk, chat:agentActivity, etc.
  }

  getHealth(): ProviderHealth {
    return {
      status: this.sdkHealth.apiStatus === 'operational' ? 'available' : 'unavailable',
      lastCheck: this.sdkHealth.lastCheck,
      errorMessage: this.sdkHealth.error,
      responseTime: this.sdkHealth.apiLatency,
    };
  }

  // ... other IAIProvider methods
}
```

**SDKEventProcessorService** (equivalent to JsonlProcessorService):

```typescript
// libs/backend/ai-providers-sdk/src/lib/sdk-event-processor.service.ts

import { SDKStreamEvent } from '@ptah-extension/shared';
import { ExecutionNode, ContentBlock } from '@ptah-extension/shared';

export class SDKEventProcessorService {
  // Converts SDK streaming events → ExecutionNode tree
  processSDKEvent(event: SDKStreamEvent): ExecutionNode[] {
    // Similar logic to JsonlProcessorService but for SDK events
    // Maps SDK event types → ExecutionNode types
  }

  // Converts SDK content → ContentBlock[]
  convertSDKContent(content: unknown): ContentBlock[] {
    // SDK content format → ContentBlock[] (universal format)
  }
}
```

---

## 4. Shared vs Implementation-Specific Type Decisions

### 4.1 SHARED Types (Keep as-is)

**Rationale**: These types represent **UNIVERSAL CONCEPTS** that transcend provider implementations.

| Type Category            | Why Shared                                                   | Example Types                                       |
| ------------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| **Identity**             | Universal ID system for sessions, messages, correlations     | SessionId, MessageId, CorrelationId                 |
| **Content Model**        | Universal content representation (text, thinking, tool use)  | ContentBlock, TextContentBlock, ToolUseContentBlock |
| **Provider Abstraction** | Interface contract for all AI providers                      | IAIProvider, ProviderInfo, ProviderCapabilities     |
| **Tool Events**          | Universal tool lifecycle (start → progress → result → error) | ClaudeToolEvent, ClaudeToolEventStart               |
| **Agent Events**         | Universal agent lifecycle (start → activity → complete)      | ClaudeAgentEvent, ClaudeAgentStartEvent             |
| **Permissions**          | Universal permission model (MCP standard)                    | PermissionRequest, PermissionResponse               |
| **UI Metadata**          | Provider-agnostic UI state                                   | ModelInfo, PermissionLevel, DropdownOption          |

**Key Principle**: If the type represents a **CONCEPT** (not an implementation detail), it's shared.

### 4.2 IMPLEMENTATION-SPECIFIC Types (Parallel systems)

**Rationale**: These types represent **PROVIDER-SPECIFIC IMPLEMENTATION DETAILS**.

| Type Category         | Why Implementation-Specific       | CLI Types                                 | SDK Types                             |
| --------------------- | --------------------------------- | ----------------------------------------- | ------------------------------------- |
| **Health Monitoring** | Different health check mechanisms | ClaudeCliHealth (binary path, version)    | SDKClientHealth (API latency, status) |
| **Initialization**    | Different setup processes         | ClaudeCliLaunchOptions (subprocess spawn) | SDKClientOptions (API key, endpoint)  |
| **Session Resume**    | Different session ID systems      | ClaudeSessionResume (claudeSessionId)     | SDKSessionResume (sdkConversationId)  |
| **Streaming Format**  | Different event structures        | JSONLMessage (JSONL parser)               | SDKStreamEvent (SSE/WebSocket)        |
| **Error Payloads**    | Different error contexts          | ChatCliErrorPayload (process errors)      | SDKAgentErrorPayload (API errors)     |

**Key Principle**: If the type represents an **IMPLEMENTATION DETAIL** (how, not what), it's provider-specific.

### 4.3 Decision Matrix

Use this decision matrix to classify future types:

```
Does the type represent a UNIVERSAL CONCEPT?
│
├─ YES → Is it used by frontend?
│        │
│        ├─ YES → SHARED (add to foundation layer)
│        │        Example: ContentBlock, SessionId
│        │
│        └─ NO → Is it part of IAIProvider interface?
│                 │
│                 ├─ YES → SHARED (add to abstraction layer)
│                 │        Example: ProviderInfo, ProviderHealth
│                 │
│                 └─ NO → Could multiple providers use it?
│                          │
│                          ├─ YES → SHARED (add to common domain)
│                          │        Example: ClaudeToolEvent
│                          │
│                          └─ NO → IMPLEMENTATION-SPECIFIC
│                                   Example: ClaudeCliHealth
│
└─ NO → Does it describe HOW a provider works?
        │
        ├─ YES → IMPLEMENTATION-SPECIFIC
        │        Example: JSONLMessage, ClaudeCliLaunchOptions
        │
        └─ NO → SHARED (edge case - review with team)
```

---

## 5. Recommendations

### 5.1 Immediate Actions (Phase 1: Foundation)

**GOAL**: Prepare shared types for SDK integration without breaking CLI.

1. **Extend ProviderId enum** (libs/shared/src/lib/types/ai-provider.types.ts)

   ```typescript
   export type ProviderId = 'claude-cli' | 'vscode-lm' | 'claude-sdk';
   ```

2. **Create SDK type files** (libs/shared/src/lib/types/)

   - sdk-domain.types.ts
   - sdk-message.types.ts
   - sdk-stream.types.ts

3. **Document type classification** (libs/shared/CLAUDE.md)

   - Add "Type Classification Guide" section
   - Explain shared vs implementation-specific decisions
   - Provide decision matrix for future types

4. **Add SDK exports** (libs/shared/src/index.ts)
   ```typescript
   export * from './lib/types/sdk-domain.types';
   export * from './lib/types/sdk-message.types';
   export * from './lib/types/sdk-stream.types';
   ```

**Validation**: Run `nx test shared` and `nx lint shared` - should pass with zero changes to existing code.

### 5.2 SDK Integration Phase (Phase 2: Implementation)

**GOAL**: Implement ClaudeSDKAdapter alongside ClaudeCliAdapter.

1. **Create SDK adapter library** (libs/backend/ai-providers-sdk)

   ```bash
   nx generate @nx/node:library --name=ai-providers-sdk --directory=libs/backend
   ```

2. **Implement ClaudeSDKAdapter** (implements IAIProvider)

   - Uses SDKClientOptions for initialization
   - Converts SDKStreamEvent → ContentBlock[]
   - Emits SDK-specific messages (chat:sdkSessionInit, etc.)

3. **Create SDKEventProcessorService** (equivalent to JsonlProcessorService)

   - Processes SDKStreamEvent → ExecutionNode tree
   - Maintains same tree structure as CLI (frontend compatibility)

4. **Update ProviderManager** (libs/backend/ai-providers-core)

   - Register 'claude-sdk' provider
   - Add SDK health checks
   - Enable CLI ↔ SDK switching

5. **Extend message handlers** (libs/backend/vscode-core)
   - Add handlers for SDK-specific message types
   - Route SDK messages to ClaudeSDKAdapter

**Validation**: Frontend should work with SDK without code changes (uses IAIProvider interface).

### 5.3 Message Protocol Extension (Phase 3: Refinement)

**GOAL**: Unify CLI and SDK message types where possible.

1. **Review message overlap**

   - Identify semantically identical CLI/SDK messages
   - Example: ChatCliErrorPayload vs SDKAgentErrorPayload
   - Could be unified as: ChatAgentErrorPayload (generic)

2. **Abstract common patterns**

   - Extract shared payload interfaces
   - Example: ISessionInitPayload base interface
   - CLI and SDK variants extend base

3. **Extend StrictMessageType** incrementally

   - Add SDK message types to union
   - Maintain backward compatibility with CLI types
   - Document migration path for future consolidation

4. **Type validation**
   - Add Zod schemas for SDK message types
   - Ensure runtime validation for SDK messages
   - Update MessagePayloadMap with SDK types

**Validation**: All message types covered by MessagePayloadMap, no `any` types.

### 5.4 Future Consolidation (Phase 4: Optimization)

**GOAL**: Eliminate redundancy between CLI and SDK types.

1. **Deprecate redundant CLI-specific names**

   - Rename: ChatCliErrorPayload → ChatAgentErrorPayload
   - Mark CLI-specific types with @deprecated tags
   - Provide migration path in documentation

2. **Abstract session initialization**

   - Create: ISessionInitPayload interface
   - CLI variant: CLISessionInitPayload extends ISessionInitPayload
   - SDK variant: SDKSessionInitPayload extends ISessionInitPayload

3. **Consolidate health monitoring**

   - Create: IProviderHealth interface
   - CLI variant: ClaudeCliHealth implements IProviderHealth
   - SDK variant: SDKClientHealth implements IProviderHealth

4. **Review execution node tree**
   - Ensure ExecutionNode structure works for SDK events
   - Validate SDKEventProcessorService produces same tree shape
   - Confirm frontend components render SDK trees correctly

**Validation**: Backward compatibility maintained via deprecated aliases.

---

## 6. Risk Assessment

### 6.1 Technical Risks

| Risk                                         | Likelihood | Impact    | Mitigation                                             |
| -------------------------------------------- | ---------- | --------- | ------------------------------------------------------ |
| **Type explosion** (too many parallel types) | 🟡 Medium  | 🟡 Medium | Use decision matrix, consolidate aggressively          |
| **Frontend breaks** (assumes CLI types)      | 🟢 Low     | 🔴 High   | Frontend uses IAIProvider abstraction (verified)       |
| **Message routing errors** (wrong adapter)   | 🟡 Medium  | 🟡 Medium | Strict typing with MessagePayloadMap validation        |
| **Streaming format incompatibility**         | 🟡 Medium  | 🟡 Medium | ContentBlock[] is universal, adapters translate        |
| **SDK event mapping complexity**             | 🟡 Medium  | 🟡 Medium | SDKEventProcessorService mirrors JsonlProcessorService |

### 6.2 Backward Compatibility Risks

| Risk                           | Likelihood | Impact    | Mitigation                                            |
| ------------------------------ | ---------- | --------- | ----------------------------------------------------- |
| **Breaking existing CLI code** | 🟢 Low     | 🔴 High   | Parallel type system - zero changes to CLI types      |
| **Message protocol changes**   | 🟢 Low     | 🟡 Medium | Union extension (add SDK types, keep CLI types)       |
| **Dependency conflicts**       | 🟢 Low     | 🟡 Medium | SDK adapter in separate library (optional dependency) |

### 6.3 Maintenance Risks

| Risk                                | Likelihood | Impact    | Mitigation                                                            |
| ----------------------------------- | ---------- | --------- | --------------------------------------------------------------------- |
| **Type drift** (CLI vs SDK diverge) | 🟡 Medium  | 🟡 Medium | Shared events (ClaudeToolEvent, ClaudeAgentEvent) enforce consistency |
| **Documentation gaps**              | 🟡 Medium  | 🟡 Medium | Type classification guide in libs/shared/CLAUDE.md                    |
| **New developer confusion**         | 🟡 Medium  | 🟢 Low    | Decision matrix clarifies when to use CLI vs SDK types                |

---

## 7. Success Criteria

### 7.1 Phase 1 Success Metrics

- ✅ Zero breaking changes to existing CLI types
- ✅ SDK type files created (sdk-domain.types.ts, sdk-message.types.ts)
- ✅ ProviderId extended to include 'claude-sdk'
- ✅ All tests pass (nx test shared)
- ✅ Documentation updated (libs/shared/CLAUDE.md)

### 7.2 Phase 2 Success Metrics

- ✅ ClaudeSDKAdapter implements IAIProvider successfully
- ✅ Frontend works with SDK without code changes
- ✅ SDKEventProcessorService produces correct ExecutionNode tree
- ✅ Provider switching works (CLI ↔ SDK)
- ✅ SDK messages routed correctly via MessageHandler

### 7.3 Phase 3 Success Metrics

- ✅ Message protocol supports CLI + SDK seamlessly
- ✅ No `any` types in message payloads
- ✅ Runtime validation works for SDK messages
- ✅ Frontend components render SDK content correctly

### 7.4 Phase 4 Success Metrics

- ✅ Redundant types consolidated (CLI + SDK variants unified where possible)
- ✅ Deprecated CLI-specific names migrated
- ✅ Type system documentation complete
- ✅ Developer experience improved (clear type classification)

---

## 8. Conclusion

**Final Verdict**: The shared type system architecture **SUPPORTS PARALLEL CLI/SDK SYSTEMS** with minimal refactoring.

**Key Architectural Strengths**:

1. **IAIProvider abstraction** enables provider-agnostic frontend
2. **ContentBlock[] universal format** decouples content from provider
3. **Branded types** (SessionId, MessageId) work with any provider
4. **Layered architecture** allows parallel type systems without breaking changes

**Recommended Strategy**: **PARALLEL TYPE SYSTEMS with SHARED FOUNDATION**

- Keep CLI types intact (100% backward compatible)
- Add SDK types alongside (sdk-domain.types.ts, sdk-message.types.ts)
- Share universal concepts (ContentBlock, ClaudeToolEvent, IAIProvider)
- Frontend remains provider-agnostic via interface abstraction

**Why This Works**:

- **Zero breaking changes**: CLI code untouched
- **Minimal duplication**: 70% types shared, 30% provider-specific
- **Clean boundaries**: Decision matrix clarifies shared vs implementation-specific
- **Future-proof**: Consolidation phase eliminates redundancy over time

**Next Steps**: Proceed with Phase 1 (Foundation) - extend ProviderId and create SDK type files.
