# Claude Agent SDK - Message Flow Diagrams

Visual representation of SDK message sequences.

---

## New Session Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         NEW SESSION                              │
└─────────────────────────────────────────────────────────────────┘

User calls query({ prompt: "Hello", options: {} })
    │
    ▼
┌──────────────────────────────────────┐
│ SDKSystemMessage                     │
│ ├─ type: 'system'                    │
│ ├─ subtype: 'init'                   │
│ ├─ session_id: "uuid-123"            │  ← Session identifier
│ ├─ tools: ["Bash", "Read", "Task"]   │  ← Available tools
│ ├─ agents: ["Explore", "Plan"]       │  ← Available agents
│ ├─ model: "claude-sonnet-4-5..."     │  ← Model config
│ └─ permissionMode: "default"         │  ← Permission mode
└──────────────────────────────────────┘
    │ ⚠️ Skip (metadata only, don't emit flat events)
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'message_start'          │
│    └─ message:                       │
│       ├─ id: "msg_abc123"            │  ← 🔑 CANONICAL MESSAGE ID
│       ├─ role: 'assistant'           │
│       ├─ content: []                 │  (empty at start)
│       ├─ model: "claude-sonnet..."   │
│       └─ usage:                      │
│          ├─ input_tokens: 3          │
│          ├─ cache_read_tokens: 1447  │
│          └─ output_tokens: 1         │
└──────────────────────────────────────┘
    │ ✅ Emit: MessageStartEvent { messageId: "msg_abc123" }
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_start'    │
│    ├─ index: 0                       │
│    └─ content_block:                 │
│       ├─ type: 'text'                │
│       └─ text: ""                    │
└──────────────────────────────────────┘
    │ ⚠️ No event (wait for delta)
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │  (multiple times)
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_delta'    │
│    ├─ index: 0                       │
│    └─ delta:                         │
│       ├─ type: 'text_delta'          │
│       └─ text: "Hello"               │  ← Streaming text chunk
└──────────────────────────────────────┘
    │ ✅ Emit: TextDeltaEvent { messageId, delta: "Hello" }
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_stop'     │
│    └─ index: 0                       │
└──────────────────────────────────────┘
    │ ⚠️ No event (frontend accumulates deltas)
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'message_delta'          │
│    └─ usage:                         │
│       └─ output_tokens: 301          │  ← Cumulative token count
└──────────────────────────────────────┘
    │ ✅ Emit: MessageDeltaEvent { messageId, tokenUsage: { output: 301 } }
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    └─ type: 'message_stop'           │
└──────────────────────────────────────┘
    │ ✅ 🔴 CRITICAL: Emit MessageCompleteEvent here!
    │
    ▼
┌──────────────────────────────────────┐
│ SDKResultMessage                     │
│ ├─ type: 'result'                    │
│ ├─ subtype: 'success'                │
│ ├─ total_cost_usd: 0.0164341         │  ← USD cost
│ ├─ usage: { input: 3, output: 301 } │  ← Total tokens
│ ├─ modelUsage: {...}                 │  ← Per-model stats
│ └─ duration_ms: 10224                │  ← Total time
└──────────────────────────────────────┘
    │ ⚠️ Skip flat events, extract via callback
    │
    ▼
[Stream Complete]
```

---

## Resume Session Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      RESUME SESSION                              │
└─────────────────────────────────────────────────────────────────┘

User calls query({ prompt: "Continue", options: { resume: "session-123" } })
    │
    ▼
┌──────────────────────────────────────┐
│ SDKSystemMessage                     │
│ ├─ type: 'system'                    │
│ ├─ subtype: 'init'                   │
│ └─ session_id: "session-123"         │  ← Same session ID
└──────────────────────────────────────┘
    │ ⚠️ Skip (metadata)
    │
    ▼ ┌────────────────────────────────┐
      │  HISTORICAL MESSAGE REPLAY     │
      └────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ SDKUserMessageReplay                 │
│ ├─ type: 'user'                      │
│ ├─ uuid: "msg-1"                     │
│ ├─ isReplay: true                    │  ← 🔑 CHECK THIS FLAG!
│ └─ message:                          │
│    ├─ role: 'user'                   │
│    └─ content: "Hello"               │
└──────────────────────────────────────┘
    │ ⚠️ Skip storage (isReplay: true)
    │
    ▼
┌──────────────────────────────────────┐
│ SDKAssistantMessage                  │
│ ├─ type: 'assistant'                 │
│ ├─ uuid: "msg-2"                     │
│ └─ message:                          │
│    ├─ id: "msg_abc123"               │
│    ├─ role: 'assistant'              │
│    ├─ content: [...]                 │
│    └─ usage: {...}                   │
└──────────────────────────────────────┘
    │ ⚠️ Skip storage (already stored)
    │
    ▼
┌──────────────────────────────────────┐
│ SDKUserMessageReplay                 │
│ ├─ type: 'user'                      │
│ ├─ uuid: "msg-3"                     │
│ ├─ isReplay: true                    │  ← 🔑 Still replaying!
│ └─ message:                          │
│    ├─ role: 'user'                   │
│    └─ content: "What about X?"       │
└──────────────────────────────────────┘
    │ ⚠️ Skip storage (isReplay: true)
    │
    ▼
┌──────────────────────────────────────┐
│ SDKAssistantMessage                  │
│ ├─ type: 'assistant'                 │
│ ├─ uuid: "msg-4"                     │
│ └─ message:                          │
│    ├─ id: "msg_xyz789"               │
│    ├─ role: 'assistant'              │
│    ├─ content: [...]                 │
│    └─ usage: {...}                   │
└──────────────────────────────────────┘
    │ ⚠️ Skip storage (already stored)
    │
    ▼ ┌────────────────────────────────┐
      │   NEW MESSAGE (END OF REPLAY)  │
      └────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ SDKUserMessage                       │  ← Note: NOT SDKUserMessageReplay
│ ├─ type: 'user'                      │
│ ├─ uuid: undefined (or new UUID)     │
│ ├─ (no isReplay field)               │  ← 🔑 NEW MESSAGE!
│ └─ message:                          │
│    ├─ role: 'user'                   │
│    └─ content: "Continue"            │
└──────────────────────────────────────┘
    │ ✅ Store this (no isReplay flag)
    │
    ▼
[Normal streaming continues as in New Session...]
```

---

## Tool Use Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        TOOL EXECUTION                            │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_start'    │
│    ├─ index: 1                       │  ← Tool block position
│    └─ content_block:                 │
│       ├─ type: 'tool_use'            │
│       ├─ id: "toolu_abc123"          │  ← 🔑 REAL TOOL CALL ID
│       ├─ name: "Bash"                │  ← Tool name
│       └─ input: {}                   │  (empty at start)
└──────────────────────────────────────┘
    │ ✅ Emit: ToolStartEvent { toolCallId: "toolu_abc123", toolName: "Bash" }
    │ 📝 Store in map: toolCallIdByBlockIndex.set(1, "toolu_abc123")
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │  (multiple times)
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_delta'    │
│    ├─ index: 1                       │  ← Lookup toolCallId from map!
│    └─ delta:                         │
│       ├─ type: 'input_json_delta'    │
│       └─ partial_json: '{"command"'  │  ← JSON fragment
└──────────────────────────────────────┘
    │ ✅ Emit: ToolDeltaEvent { toolCallId: "toolu_abc123", delta: '{"command"' }
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_stop'     │
│    └─ index: 1                       │
└──────────────────────────────────────┘
    │ ⚠️ No event (input complete)
    │
    ▼
[Tool executes in SDK...]
    │
    ▼
┌──────────────────────────────────────┐
│ SDKUserMessage                       │  ← Tool result from SDK
│ ├─ type: 'user'                      │
│ ├─ isSynthetic: true                 │  ← System-generated
│ ├─ tool_use_result: {...}            │  ← Formatted result (optional)
│ └─ message:                          │
│    ├─ role: 'user'                   │
│    └─ content: [                     │
│       {                              │
│         type: 'tool_result',         │
│         tool_use_id: "toolu_abc123", │  ← Matches tool_use.id
│         content: "file1.txt\nfile2", │  ← Tool output
│         is_error: false              │
│       }                              │
│    ]                                 │
└──────────────────────────────────────┘
    │ ✅ Emit: ToolResultEvent { toolCallId: "toolu_abc123", output: "..." }
    │
    ▼
[Assistant continues response...]
```

---

## Agent (Task Tool) Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT SPAWNING (Task Tool)                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_start'    │
│    ├─ index: 0                       │
│    └─ content_block:                 │
│       ├─ type: 'tool_use'            │
│       ├─ id: "toolu_agent_123"       │  ← Agent's tool call ID
│       ├─ name: "Task"                │  ← 🔑 Task tool = agent spawn
│       └─ input: {}                   │
└──────────────────────────────────────┘
    │ ✅ Emit: ToolStartEvent { isTaskTool: true }
    │ ✅ Emit: AgentStartEvent
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'content_block_delta'    │
│    ├─ index: 0                       │
│    └─ delta:                         │
│       ├─ type: 'input_json_delta'    │
│       └─ partial_json:               │
│          '{"subagent_type":"Explore",│
│            "description":"Search",   │
│            "prompt":"Find files"}'   │
└──────────────────────────────────────┘
    │ ✅ Emit: ToolDeltaEvent (accumulate agent config)
    │
    ▼
[Agent executes...]
    │
    ▼ ┌────────────────────────────────┐
      │ NESTED AGENT MESSAGES          │
      │ (parent_tool_use_id is set)    │
      └────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │  ← From nested agent
│ ├─ type: 'stream_event'              │
│ ├─ parent_tool_use_id: "toolu_agent_123"  ← 🔑 PARENT RELATIONSHIP
│ └─ event:                            │
│    ├─ type: 'message_start'          │
│    └─ message:                       │
│       └─ id: "msg_nested_1"          │  ← Nested message ID
└──────────────────────────────────────┘
    │ ✅ Emit: MessageStartEvent { parentToolUseId: "toolu_agent_123" }
    │
    ▼
[Nested agent streaming continues...]
    │
    ▼
┌──────────────────────────────────────┐
│ SDKUserMessage                       │  ← Agent result
│ ├─ type: 'user'                      │
│ ├─ isSynthetic: true                 │
│ ├─ parent_tool_use_id: null          │  ← Back to top level
│ └─ message:                          │
│    ├─ role: 'user'                   │
│    └─ content: [                     │
│       {                              │
│         type: 'tool_result',         │
│         tool_use_id: "toolu_agent_123",│ ← Agent tool call ID
│         content: "Found 5 files"     │  ← Agent output
│       }                              │
│    ]                                 │
└──────────────────────────────────────┘
    │ ✅ Emit: ToolResultEvent (agent complete)
    │
    ▼
[Main assistant continues...]
```

---

## Error Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         ERROR HANDLING                           │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│ SDKPartialAssistantMessage           │
│ ├─ type: 'stream_event'              │
│ └─ event:                            │
│    ├─ type: 'error'                  │
│    └─ error:                         │
│       ├─ type: 'rate_limit_error'    │
│       └─ message: "Rate limit..."    │
└──────────────────────────────────────┘
    │ ⚠️ Log error, emit error event
    │
    ▼
┌──────────────────────────────────────┐
│ SDKAssistantMessage                  │
│ ├─ type: 'assistant'                 │
│ ├─ error: 'rate_limit'               │  ← Error flag
│ └─ message: {...}                    │  (may be incomplete)
└──────────────────────────────────────┘
    │ ⚠️ Handle error state
    │
    ▼
┌──────────────────────────────────────┐
│ SDKResultMessage                     │
│ ├─ type: 'result'                    │
│ ├─ subtype: 'error_during_execution' │  ← Error result
│ ├─ is_error: true                    │
│ ├─ errors: ["Rate limit exceeded"]  │  ← Error details
│ └─ total_cost_usd: 0.005             │  (partial cost)
└──────────────────────────────────────┘
    │ ⚠️ Extract via callback, show error to user
    │
    ▼
[Stream ends]
```

---

## Legend

```
┌─────────────────────────────────────┐
│ Message Type Box                    │
│ ├─ field: value                     │
│ └─ nested: {...}                    │
└─────────────────────────────────────┘

🔑 CRITICAL FIELD    - Must capture/use this
⚠️  SKIP/WARNING     - Special handling required
✅ EMIT EVENT        - Transform to flat event
📝 STORE IN STATE    - Track for later use
```

---

## See Also

- **Full Type Reference**: [sdk-type-reference.md](./sdk-type-reference.md)
- **Quick Reference**: [quick-reference.md](./quick-reference.md)
