# Shared Types Coupling Diagram

**Visual representation of CLI coupling levels and SDK integration strategy**

---

## Current Architecture (CLI-Only)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular Webview)                            │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Chat Components (Provider-Agnostic)                                │    │
│  │  - Uses: IAIProvider interface only                                 │    │
│  │  - Renders: ContentBlock[] (universal format)                       │    │
│  │  - Displays: ExecutionNode tree (any provider)                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ClaudeRPCService                                                    │    │
│  │  currentProvider$: BehaviorSubject<IAIProvider | null>              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                    SHARED TYPES (@libs/shared)                                │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  🟢 FOUNDATION LAYER (100% Generic)                                 │    │
│  │  ┌───────────────────────────────────────────────────────────┐     │    │
│  │  │  branded.types.ts                                         │     │    │
│  │  │  - SessionId, MessageId, CorrelationId                    │     │    │
│  │  │  - UUID-based branded types (CLI-agnostic)                │     │    │
│  │  └───────────────────────────────────────────────────────────┘     │    │
│  │  ┌───────────────────────────────────────────────────────────┐     │    │
│  │  │  content-block.types.ts                                   │     │    │
│  │  │  - ContentBlock (text | thinking | tool_use | tool_result)│     │    │
│  │  │  - Universal content model for CLI & SDK                  │     │    │
│  │  └───────────────────────────────────────────────────────────┘     │    │
│  │  ┌───────────────────────────────────────────────────────────┐     │    │
│  │  │  ai-provider.types.ts                                     │     │    │
│  │  │  - IAIProvider interface (abstraction layer)              │     │    │
│  │  │  - ProviderId: 'claude-cli' | 'vscode-lm'                │     │    │
│  │  │  - ProviderInfo, ProviderCapabilities                     │     │    │
│  │  └───────────────────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  🔴 DOMAIN LAYER (CLI-Specific)                                     │    │
│  │  ┌───────────────────────────────────────────────────────────┐     │    │
│  │  │  claude-domain.types.ts                                   │     │    │
│  │  │  🔴 ClaudeCliHealth (binary path, version, platform)      │     │    │
│  │  │  🔴 ClaudeCliLaunchOptions (subprocess spawn config)      │     │    │
│  │  │  🟡 ClaudeSessionResume (claudeSessionId field)           │     │    │
│  │  │  🟢 ClaudeToolEvent (universal tool lifecycle)            │     │    │
│  │  │  🟢 ClaudeAgentEvent (universal agent lifecycle)          │     │    │
│  │  └───────────────────────────────────────────────────────────┘     │    │
│  │  ┌───────────────────────────────────────────────────────────┐     │    │
│  │  │  message.types.ts (94 message types)                     │     │    │
│  │  │  🟢 Generic: chat:sendMessage, chat:messageChunk (74)     │     │    │
│  │  │  🔴 CLI-Specific: chat:sessionInit (claudeSessionId) (10) │     │    │
│  │  │  🔴 CLI-Specific: chat:healthUpdate (CLI binary) (10)     │     │    │
│  │  └───────────────────────────────────────────────────────────┘     │    │
│  │  ┌───────────────────────────────────────────────────────────┐     │    │
│  │  │  execution-node.types.ts                                  │     │    │
│  │  │  🟢 ExecutionNode (universal tree structure)              │     │    │
│  │  │  🔴 JSONLMessage (CLI JSONL parser types)                 │     │    │
│  │  │  🔴 JSONLMessageType ('system' | 'tool' | 'result')       │     │    │
│  │  └───────────────────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  🟢 UI/FEATURE LAYER (100% Generic)                                 │    │
│  │  - permission.types.ts (MCP standard)                               │    │
│  │  - model-autopilot.types.ts (model selector)                        │    │
│  │  - webview-ui.types.ts (dashboard, dropdowns)                       │    │
│  │  - command-builder.types.ts (command templates)                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                    BACKEND (VS Code Extension)                                │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ProviderManager                                                     │    │
│  │  - Manages: ProviderId ('claude-cli' | 'vscode-lm')                 │    │
│  │  - Current: ClaudeCliAdapter                                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ClaudeCliAdapter (implements IAIProvider)                           │    │
│  │  - Uses: ClaudeCliHealth, ClaudeCliLaunchOptions                     │    │
│  │  - Parses: JSONLMessage → ContentBlock[]                             │    │
│  │  - Emits: ClaudeToolEvent, ClaudeAgentEvent                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  JsonlProcessorService                                               │    │
│  │  - Reads: ~/.claude/sessions/*.jsonl files                           │    │
│  │  - Parses: JSONLMessage lines                                        │    │
│  │  - Builds: ExecutionNode tree (recursive structure)                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Claude CLI Subprocess                                               │    │
│  │  $ claude --output-format stream-json --verbose                      │    │
│  │  Outputs: JSONL stream (JSONLMessage format)                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Legend**:

- 🟢 Generic (works for CLI & SDK)
- 🟡 Adaptable (minor SDK variant needed)
- 🔴 CLI-Specific (parallel SDK type required)

---

## Proposed Architecture (Multi-Provider with SDK)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular Webview)                            │
│                         🟢 ZERO CHANGES NEEDED                                │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Chat Components (Provider-Agnostic)                                │    │
│  │  - Uses: IAIProvider interface only ✅                              │    │
│  │  - Renders: ContentBlock[] (universal format) ✅                    │    │
│  │  - Displays: ExecutionNode tree (any provider) ✅                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ClaudeRPCService                                                    │    │
│  │  currentProvider$: BehaviorSubject<IAIProvider | null>              │    │
│  │  Works with CLI OR SDK transparently ✅                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                    SHARED TYPES (@libs/shared)                                │
│                    🔧 MINIMAL CHANGES (3 new files)                           │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  🟢 FOUNDATION LAYER (Unchanged)                                    │    │
│  │  - branded.types.ts ✅                                              │    │
│  │  - content-block.types.ts ✅                                        │    │
│  │  - ai-provider.types.ts 🔧 (extend ProviderId)                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  🔴 DOMAIN LAYER (Parallel Systems)                                 │    │
│  │  ┌───────────────────────────────┐  ┌───────────────────────────┐  │    │
│  │  │  CLI Types (Existing) ✅       │  │  SDK Types (New) 🆕        │  │    │
│  │  │  - claude-domain.types.ts      │  │  - sdk-domain.types.ts    │  │    │
│  │  │    - ClaudeCliHealth           │  │    - SDKClientHealth      │  │    │
│  │  │    - ClaudeCliLaunchOptions    │  │    - SDKClientOptions     │  │    │
│  │  │    - ClaudeSessionResume       │  │    - SDKSessionResume     │  │    │
│  │  │                                 │  │                           │  │    │
│  │  │  - message.types.ts            │  │  - sdk-message.types.ts   │  │    │
│  │  │    - ChatSessionInitPayload    │  │    - SDKSessionInitPayload│  │    │
│  │  │    - ChatCliErrorPayload       │  │    - SDKAgentErrorPayload │  │    │
│  │  │                                 │  │                           │  │    │
│  │  │  - execution-node.types.ts     │  │  - sdk-stream.types.ts    │  │    │
│  │  │    - JSONLMessage              │  │    - SDKStreamEvent       │  │    │
│  │  │    - JSONLMessageType          │  │    - SDKContentDelta      │  │    │
│  │  └───────────────────────────────┘  └───────────────────────────┘  │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────┐     │    │
│  │  │  🟢 Shared Events (Used by CLI & SDK)                     │     │    │
│  │  │  - ClaudeToolEvent (start | progress | result | error)    │     │    │
│  │  │  - ClaudeAgentEvent (start | activity | complete)         │     │    │
│  │  └───────────────────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  🟢 UI/FEATURE LAYER (Unchanged)                                    │    │
│  │  - permission.types.ts ✅                                           │    │
│  │  - model-autopilot.types.ts ✅                                      │    │
│  │  - webview-ui.types.ts ✅                                           │    │
│  │  - command-builder.types.ts ✅                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                    BACKEND (VS Code Extension)                                │
│                    🆕 NEW: Parallel Provider Implementation                   │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ProviderManager 🔧                                                  │    │
│  │  - Manages: ProviderId ('claude-cli' | 'vscode-lm' | 'claude-sdk') │    │
│  │  - Switches: CLI ↔ SDK dynamically                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                 ↓                                 ↓                           │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐       │
│  │  ClaudeCliAdapter ✅        │  │  ClaudeSDKAdapter 🆕            │       │
│  │  (implements IAIProvider)    │  │  (implements IAIProvider)        │       │
│  │                              │  │                                  │       │
│  │  - Uses: ClaudeCliHealth     │  │  - Uses: SDKClientHealth         │       │
│  │  - Parses: JSONLMessage      │  │  - Parses: SDKStreamEvent        │       │
│  │  - Emits: ClaudeToolEvent ✅ │  │  - Emits: ClaudeToolEvent ✅    │       │
│  │  - Emits: ClaudeAgentEvent ✅│  │  - Emits: ClaudeAgentEvent ✅   │       │
│  └─────────────────────────────┘  └─────────────────────────────────┘       │
│                 ↓                                 ↓                           │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐       │
│  │  JsonlProcessorService ✅   │  │  SDKEventProcessor 🆕           │       │
│  │  JSONL → ExecutionNode       │  │  SDKStreamEvent → ExecutionNode  │       │
│  └─────────────────────────────┘  └─────────────────────────────────┘       │
│                 ↓                                 ↓                           │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐       │
│  │  CLI Subprocess ✅          │  │  SDK Client 🆕                  │       │
│  │  claude --output-format     │  │  @anthropic-ai/claude-agent-sdk  │       │
│  │  stream-json                │  │  - API key authentication        │       │
│  │  - Outputs: JSONLMessage    │  │  - SSE/WebSocket events          │       │
│  └─────────────────────────────┘  └─────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key Changes**:

- 🆕 3 new type files (sdk-domain.types.ts, sdk-message.types.ts, sdk-stream.types.ts)
- 🔧 1 line change (extend ProviderId)
- 🆕 New adapter library (libs/backend/ai-providers-sdk)
- ✅ Frontend unchanged (uses IAIProvider abstraction)

---

## Type Coupling Heatmap

```
┌─────────────────────────────────────────────────────────────────┐
│  FILE                      │ CLI COUPLING │ SDK COMPATIBILITY  │
├─────────────────────────────────────────────────────────────────┤
│  branded.types.ts          │   🟢 None    │   ✅ 100%          │
│  content-block.types.ts    │   🟢 None    │   ✅ 100%          │
│  ai-provider.types.ts      │   🟢 Low     │   ✅ 95% (extend)  │
│  permission.types.ts       │   🟢 None    │   ✅ 100%          │
│  common.types.ts           │   🟢 None    │   ✅ 100%          │
│  webview-ui.types.ts       │   🟢 None    │   ✅ 100%          │
│  command-builder.types.ts  │   🟢 None    │   ✅ 100%          │
│  model-autopilot.types.ts  │   🟢 None    │   ✅ 100%          │
├─────────────────────────────────────────────────────────────────┤
│  message.types.ts          │   🟡 Medium  │   🔄 79% (extend)  │
│  claude-domain.types.ts    │   🔴 High    │   ⚠️ 50% (parallel)│
│  execution-node.types.ts   │   🔴 High    │   ⚠️ 40% (parallel)│
└─────────────────────────────────────────────────────────────────┘

🟢 No coupling (100% generic)      → 72% of types
🟡 Light coupling (minor extension) → 8% of types
🔴 Heavy coupling (parallel system) → 20% of types
```

---

## ContentBlock Flow (Universal Format)

**This is why frontend stays unchanged - all providers emit ContentBlock[]**:

```
CLI PATH:
┌─────────────────────────────────────────────────────────────┐
│  Claude CLI Process                                          │
│  $ claude --output-format stream-json                        │
│  Outputs: {"type": "assistant", "message": {...}}           │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  JsonlProcessorService                                       │
│  Parses: JSONLMessage (CLI-specific format)                 │
│  Extracts: message.content (ContentBlock[])                 │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  ContentBlock[] (Universal Format) ✅                       │
│  [                                                           │
│    { type: 'text', text: 'Let me help you...' },            │
│    { type: 'thinking', thinking: 'I need to...' },          │
│    { type: 'tool_use', id: '...', name: 'Read', input: {}}, │
│    { type: 'tool_result', tool_use_id: '...', content: ''}  │
│  ]                                                           │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend Chat Components                                    │
│  Renders: ContentBlock[] (doesn't care about source)        │
└─────────────────────────────────────────────────────────────┘

SDK PATH:
┌─────────────────────────────────────────────────────────────┐
│  Claude Agent SDK Client                                     │
│  @anthropic-ai/claude-agent-sdk                              │
│  Emits: SSE events (SDKStreamEvent format)                  │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  SDKEventProcessor                                           │
│  Parses: SDKStreamEvent (SDK-specific format)               │
│  Converts: SDK events → ContentBlock[]                      │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  ContentBlock[] (Universal Format) ✅                       │
│  [                                                           │
│    { type: 'text', text: 'Let me help you...' },            │
│    { type: 'thinking', thinking: 'I need to...' },          │
│    { type: 'tool_use', id: '...', name: 'Read', input: {}}, │
│    { type: 'tool_result', tool_use_id: '...', content: ''}  │
│  ]                                                           │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend Chat Components                                    │
│  Renders: ContentBlock[] (doesn't care about source) ✅     │
└─────────────────────────────────────────────────────────────┘
```

**Key Insight**: Frontend receives `ContentBlock[]` from BOTH providers via IAIProvider interface. It doesn't know (or care) if the source is CLI or SDK!

---

## Event Flow (Shared Tool/Agent Events)

**This is why agent visualization works for SDK - same events!**

```
TOOL EXECUTION (CLI):
┌─────────────────────────────────────────────────────────────┐
│  CLI: {"type": "tool", "subtype": "start", "tool": "Read"}  │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  ClaudeCliAdapter emits:                                     │
│  ClaudeToolEventStart { type: 'start', tool: 'Read', ... }  │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  EventBus → WebviewMessageBridge                             │
│  Forwards: chat:toolStart message to frontend               │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend: ToolCallItemComponent renders tool execution     │
└─────────────────────────────────────────────────────────────┘

TOOL EXECUTION (SDK):
┌─────────────────────────────────────────────────────────────┐
│  SDK: event { type: 'tool_start', tool: 'Read', ... }       │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  ClaudeSDKAdapter emits:                                     │
│  ClaudeToolEventStart { type: 'start', tool: 'Read', ... }  │
│  ⬆ SAME EVENT TYPE AS CLI ✅                                │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  EventBus → WebviewMessageBridge                             │
│  Forwards: chat:toolStart message to frontend               │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend: ToolCallItemComponent renders tool execution ✅  │
│  ⬆ SAME COMPONENT, SAME RENDERING LOGIC ✅                  │
└─────────────────────────────────────────────────────────────┘
```

**Key Insight**: `ClaudeToolEvent` and `ClaudeAgentEvent` are **SHARED** between CLI and SDK. Frontend components already handle these events - SDK reuses them!

---

## File Creation Strategy

```
libs/shared/src/lib/types/
├── 🟢 FOUNDATION (Keep as-is)
│   ├── branded.types.ts ✅
│   ├── content-block.types.ts ✅
│   └── ai-provider.types.ts 🔧 (1 line change)
│
├── 🔴 CLI-SPECIFIC (Keep as-is)
│   ├── claude-domain.types.ts ✅ (contains ClaudeToolEvent, ClaudeAgentEvent)
│   ├── message.types.ts ✅ (94 message types)
│   └── execution-node.types.ts ✅ (JSONLMessage, ExecutionNode)
│
├── 🆕 SDK-SPECIFIC (Create parallel files)
│   ├── sdk-domain.types.ts 🆕
│   │   ├── SDKClientHealth
│   │   ├── SDKClientOptions
│   │   └── SDKSessionResume
│   │
│   ├── sdk-message.types.ts 🆕
│   │   ├── SDKSessionInitPayload
│   │   ├── SDKHealthUpdatePayload
│   │   └── SDKAgentErrorPayload
│   │
│   └── sdk-stream.types.ts 🆕
│       ├── SDKStreamEvent
│       └── SDKContentDelta
│
└── 🟢 UI/FEATURE (Keep as-is)
    ├── permission.types.ts ✅
    ├── model-autopilot.types.ts ✅
    ├── webview-ui.types.ts ✅
    └── command-builder.types.ts ✅
```

**Total Changes**:

- ✅ Keep: 8 files unchanged
- 🔧 Modify: 1 file (1 line change)
- 🆕 Create: 3 new files

---

## Adapter Implementation Pattern

```
┌──────────────────────────────────────────────────────────────────┐
│                        IAIProvider Interface                      │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  interface IAIProvider {                               │     │
│  │    readonly providerId: ProviderId;                    │     │
│  │    initialize(): Promise<boolean>;                     │     │
│  │    startChatSession(id: SessionId): Promise<Readable>; │     │
│  │    sendMessageToSession(...): Promise<void>;           │     │
│  │    getHealth(): ProviderHealth;                        │     │
│  │    // ...                                              │     │
│  │  }                                                      │     │
│  └────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
                               ↓
              ┌────────────────┴────────────────┐
              ↓                                  ↓
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  ClaudeCliAdapter ✅         │   │  ClaudeSDKAdapter 🆕         │
│  implements IAIProvider      │   │  implements IAIProvider      │
├──────────────────────────────┤   ├──────────────────────────────┤
│  providerId: 'claude-cli'    │   │  providerId: 'claude-sdk'    │
│                              │   │                              │
│  initialize() {              │   │  initialize() {              │
│    // Verify CLI binary      │   │    // Initialize SDK client  │
│    this.cliHealth = ...      │   │    this.sdkHealth = ...      │
│  }                           │   │  }                           │
│                              │   │                              │
│  startChatSession() {        │   │  startChatSession() {        │
│    // Spawn CLI subprocess   │   │    // Create SDK session     │
│    const process = spawn(...);   │    const session = sdk.create(...);
│    // Parse JSONL stream     │   │    // Listen to SSE stream   │
│    parseJSONL(process.stdout);   │    session.on('event', ...); │
│  }                           │   │  }                           │
│                              │   │                              │
│  getHealth() {               │   │  getHealth() {               │
│    return {                  │   │    return {                  │
│      status: cliHealth.      │   │      status: sdkHealth.      │
│              available       │   │              apiStatus       │
│              ? 'available'   │   │              === 'operational'│
│              : 'unavailable',│   │              ? 'available'   │
│      // ...                  │   │              : 'unavailable',│
│    };                        │   │      // ...                  │
│  }                           │   │    };                        │
│                              │   │  }                           │
│                              │   │                              │
│  🔧 Uses CLI Types:          │   │  🆕 Uses SDK Types:          │
│  - ClaudeCliHealth           │   │  - SDKClientHealth           │
│  - ClaudeCliLaunchOptions    │   │  - SDKClientOptions          │
│  - JSONLMessage              │   │  - SDKStreamEvent            │
│                              │   │                              │
│  🟢 Emits Shared Events:     │   │  🟢 Emits Shared Events:     │
│  - ClaudeToolEvent ✅        │   │  - ClaudeToolEvent ✅        │
│  - ClaudeAgentEvent ✅       │   │  - ClaudeAgentEvent ✅       │
│                              │   │                              │
│  🟢 Returns Universal Types: │   │  🟢 Returns Universal Types: │
│  - ContentBlock[] ✅         │   │  - ContentBlock[] ✅         │
│  - ExecutionNode tree ✅     │   │  - ExecutionNode tree ✅     │
└──────────────────────────────┘   └──────────────────────────────┘
```

**Key Pattern**: Both adapters implement `IAIProvider`, emit `ClaudeToolEvent`/`ClaudeAgentEvent`, and return `ContentBlock[]`. Frontend doesn't know which adapter is active!

---

## Summary

**The shared type system architecture ALREADY supports parallel CLI/SDK systems:**

1. **Foundation types are universal** (SessionId, ContentBlock, IAIProvider)
2. **Events are shared** (ClaudeToolEvent, ClaudeAgentEvent)
3. **Content format is universal** (ContentBlock[])
4. **Frontend is abstracted** (uses IAIProvider, not concrete adapters)

**Adding SDK requires:**

- 3 new type files (sdk-domain.types.ts, sdk-message.types.ts, sdk-stream.types.ts)
- 1 line change (extend ProviderId)
- New adapter library (implements IAIProvider)
- New event processor (SDKStreamEvent → ExecutionNode)

**Result**: SDK integration with ZERO breaking changes to existing CLI code.

---

For full analysis, see:

- [shared-types-cli-coupling-analysis.md](./shared-types-cli-coupling-analysis.md) - Detailed type-by-type breakdown
- [shared-types-coupling-summary.md](./shared-types-coupling-summary.md) - Quick reference tables
