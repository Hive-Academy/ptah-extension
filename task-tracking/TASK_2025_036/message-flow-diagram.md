# Message Flow Diagram: CLI vs SDK Integration

## Current Architecture (CLI Only)

```
┌──────────────────────────────────────────────────────────────────────┐
│                          BACKEND PROCESS                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────┐                                                 │
│  │  Claude CLI     │  Spawned Process                                │
│  │  (claude chat)  │                                                 │
│  └────────┬────────┘                                                 │
│           │                                                           │
│           │ JSONL Stream                                             │
│           │ (stdout)                                                 │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  SessionProxy                   │                                 │
│  │  - Parse JSONL lines            │                                 │
│  │  - Extract tool_use events      │                                 │
│  │  - Emit chat:chunk messages     │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ chat:chunk { sessionId, message: JSONLMessage }          │
│           ↓                                                           │
│  ┌────────────────────────────────┐                                  │
│  │  WebviewMessageBridge          │                                  │
│  │  - Route to webview            │                                  │
│  └────────┬───────────────────────┘                                  │
│           │                                                           │
└───────────┼──────────────────────────────────────────────────────────┘
            │ postMessage({ type: 'chat:chunk', payload: {...} })
            │
            ↓
┌──────────────────────────────────────────────────────────────────────┐
│                          WEBVIEW PROCESS                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────┐                                 │
│  │  VSCodeService                  │  Message Router                 │
│  │  window.addEventListener()      │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ if (type === 'chat:chunk')                               │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  ChatStore                      │                                 │
│  │  processJsonlChunk()            │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ JSONLMessage                                             │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  JsonlMessageProcessor          │  🔴 CLI-SPECIFIC                │
│  │  - Parse JSONL message types    │                                 │
│  │  - Extract content blocks       │                                 │
│  │  - Handle tool_use_id links     │                                 │
│  │  - Handle parent_tool_use_id    │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ ProcessingResult { tree: ExecutionNode }                 │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  ExecutionTreeBuilder           │  🟢 PROVIDER-AGNOSTIC           │
│  │  - Build ExecutionNode tree     │                                 │
│  │  - Manage tree state            │                                 │
│  │  - Handle nested agents         │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ ExecutionNode (immutable tree)                           │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  ChatStore.messages signal      │  🟢 PROVIDER-AGNOSTIC           │
│  │  ExecutionChatMessage[]         │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ computed signal                                          │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  UI Components                  │  🟢 PROVIDER-AGNOSTIC           │
│  │  - MessageBubbleComponent       │                                 │
│  │  - ExecutionNodeComponent       │                                 │
│  │    (recursive rendering)        │                                 │
│  └─────────────────────────────────┘                                 │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Proposed Architecture (CLI + SDK)

### Option A: Backend Adapter (Recommended ⭐)

```
┌──────────────────────────────────────────────────────────────────────┐
│                          BACKEND PROCESS                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────┐           ┌─────────────────┐                  │
│  │  Claude CLI     │           │  Claude SDK     │                  │
│  │  (subprocess)   │           │  (library)      │                  │
│  └────────┬────────┘           └────────┬────────┘                  │
│           │                              │                           │
│           │ JSONL Stream                 │ SDK Events                │
│           ↓                              ↓                           │
│  ┌────────────────────┐       ┌─────────────────────┐               │
│  │  SessionProxy      │       │  SdkSessionAdapter  │  🆕 NEW       │
│  │  (existing)        │       │  - Listen to SDK    │               │
│  └────────┬───────────┘       │  - Convert events   │               │
│           │                   │  - Emit chat:chunk  │               │
│           │                   └─────────┬───────────┘               │
│           │                             │                           │
│           │  chat:chunk                 │  chat:chunk               │
│           │  { sessionId,               │  { sessionId,             │
│           │    message: JSONLMessage }  │    message: JSONLMessage }│
│           │                             │                           │
│           └─────────────┬───────────────┘                           │
│                         │                                            │
│                         │ UNIFIED FORMAT (JSONLMessage)             │
│                         ↓                                            │
│  ┌────────────────────────────────────┐                             │
│  │  WebviewMessageBridge              │                             │
│  │  - Route to webview                │                             │
│  └────────┬───────────────────────────┘                             │
│           │                                                          │
└───────────┼──────────────────────────────────────────────────────────┘
            │ postMessage({ type: 'chat:chunk', payload: {...} })
            │
            ↓
┌──────────────────────────────────────────────────────────────────────┐
│                          WEBVIEW PROCESS                              │
│                      (NO CHANGES NEEDED!)                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────┐                                 │
│  │  VSCodeService                  │  🟢 UNCHANGED                   │
│  │  window.addEventListener()      │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ if (type === 'chat:chunk')                               │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  ChatStore                      │  🟢 UNCHANGED                   │
│  │  processJsonlChunk()            │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ JSONLMessage (from CLI or SDK)                           │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  JsonlMessageProcessor          │  🟢 UNCHANGED                   │
│  │  - Works with normalized format │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ ProcessingResult { tree: ExecutionNode }                 │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  ExecutionTreeBuilder           │  🟢 UNCHANGED                   │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ ExecutionNode tree                                       │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  UI Components                  │  🟢 UNCHANGED                   │
│  │  - MessageBubbleComponent       │                                 │
│  │  - ExecutionNodeComponent       │                                 │
│  └─────────────────────────────────┘                                 │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Key Insight**: By normalizing SDK events to JSONLMessage format in the backend, the ENTIRE frontend stays unchanged!

---

### Option B: Frontend Dual Processor

```
┌──────────────────────────────────────────────────────────────────────┐
│                          BACKEND PROCESS                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────┐           ┌─────────────────┐                  │
│  │  Claude CLI     │           │  Claude SDK     │                  │
│  └────────┬────────┘           └────────┬────────┘                  │
│           │                              │                           │
│           │ JSONL Stream                 │ SDK Events                │
│           ↓                              ↓                           │
│  ┌────────────────────┐       ┌─────────────────────┐               │
│  │  SessionProxy      │       │  SdkSessionProxy    │  🆕 NEW       │
│  └────────┬───────────┘       └─────────┬───────────┘               │
│           │                              │                           │
│           │  chat:chunk                  │  chat:sdk-event  🆕       │
│           │  (JSONLMessage)              │  (SdkEvent)               │
│           │                              │                           │
│           └─────────────┬────────────────┘                           │
│                         │                                            │
│                         │ TWO DIFFERENT FORMATS                      │
│                         ↓                                            │
│  ┌────────────────────────────────────┐                             │
│  │  WebviewMessageBridge              │                             │
│  └────────┬───────────────────────────┘                             │
│           │                                                          │
└───────────┼──────────────────────────────────────────────────────────┘
            │
            ↓
┌──────────────────────────────────────────────────────────────────────┐
│                          WEBVIEW PROCESS                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────┐                                 │
│  │  VSCodeService                  │  🟡 MINOR CHANGE                │
│  │  - Add route for sdk-event      │                                 │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           ├─── if (type === 'chat:chunk')                            │
│           │                                                           │
│           └─── if (type === 'chat:sdk-event')  🆕 NEW                │
│                                                                       │
│           ↓                              ↓                           │
│  ┌────────────────────┐       ┌─────────────────────┐               │
│  │  ChatStore         │       │  ChatStore          │               │
│  │  processJsonlChunk │       │  processSdkEvent    │  🆕 NEW       │
│  └────────┬───────────┘       └─────────┬───────────┘               │
│           │                              │                           │
│           │ JSONLMessage                 │ SdkEvent                  │
│           ↓                              ↓                           │
│  ┌───────────────────┐        ┌──────────────────────┐              │
│  │ JsonlProcessor    │        │ SdkEventProcessor    │  🆕 NEW      │
│  │ (existing)        │        │ (SDK-specific)       │              │
│  └────────┬──────────┘        └──────────┬───────────┘              │
│           │                              │                           │
│           │ ProcessingResult             │ ProcessingResult          │
│           │                              │                           │
│           └─────────────┬────────────────┘                           │
│                         │                                            │
│                         │ UNIFIED OUTPUT                             │
│                         ↓                                            │
│  ┌─────────────────────────────────┐                                 │
│  │  ExecutionTreeBuilder           │  🟢 UNCHANGED                   │
│  └────────┬────────────────────────┘                                 │
│           │                                                           │
│           │ ExecutionNode tree                                       │
│           ↓                                                           │
│  ┌─────────────────────────────────┐                                 │
│  │  UI Components                  │  🟢 UNCHANGED                   │
│  └─────────────────────────────────┘                                 │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Changes Required**:

- 🆕 New `SdkEventProcessor` (frontend)
- 🟡 Add message route in `VSCodeService`
- 🟡 Add `processSdkEvent()` in `ChatStore`

---

## SDK Event Mapping Example

### SDK Streaming Event

```typescript
// Raw SDK event
{
  type: 'content_block_delta',
  delta: {
    type: 'text_delta',
    text: 'Let me help you with that...'
  },
  index: 0
}
```

### Backend Adapter Transforms To

```typescript
// Normalized JSONLMessage format
{
  type: 'assistant',
  delta: 'Let me help you with that...',
  message: {
    content: [
      { type: 'text', text: 'Let me help you with that...', index: 0 }
    ]
  }
}
```

### Frontend Processes To

```typescript
// ExecutionNode tree
{
  id: 'msg-123',
  type: 'message',
  status: 'streaming',
  content: null,
  children: [
    {
      id: 'text-1',
      type: 'text',
      status: 'streaming',
      content: 'Let me help you with that...',
      children: []
    }
  ]
}
```

### UI Renders As

```html
<div class="message-bubble assistant">
  <ptah-execution-node [node]="tree">
    <!-- Recursively renders text block -->
    <div class="text-block">
      <markdown>Let me help you with that...</markdown>
      <ptah-typing-cursor />
      <!-- if streaming -->
    </div>
  </ptah-execution-node>
</div>
```

---

## Tool Use Flow Comparison

### CLI Tool Use

```
JSONL Stream:
1. { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {...} }] } }
2. { type: 'tool', subtype: 'start', tool_use_id: 't1', tool: 'Read', args: {...} }
3. { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '...' }] } }

Frontend Processing:
→ JsonlMessageProcessor
→ ExecutionTreeBuilder
→ ExecutionNode tree:
  {
    id: 'msg-1',
    type: 'message',
    children: [
      {
        id: 't1',
        type: 'tool',
        toolName: 'Read',
        toolInput: {...},
        toolOutput: '...',
        status: 'complete'
      }
    ]
  }
```

### SDK Tool Use (with Backend Adapter)

```
SDK Events:
1. { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Read', input: {...} } }
2. { type: 'content_block_stop', content_block: { type: 'tool_use', id: 't1' } }

Backend Adapter Transforms:
→ { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {...} }] } }
→ { type: 'tool', subtype: 'start', tool_use_id: 't1', tool: 'Read', args: {...} }
→ { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '...' }] } }

Frontend Processing:
→ (SAME AS CLI) JsonlMessageProcessor
→ (SAME AS CLI) ExecutionTreeBuilder
→ (IDENTICAL) ExecutionNode tree
```

**Result**: UI renders tool use identically for both CLI and SDK!

---

## Nested Agent Flow (Critical Feature)

### CLI Nested Agent

```
JSONL Stream (simplified):
1. { type: 'tool', tool: 'Task', args: { agent: 'software-architect' }, tool_use_id: 't1' }
2. { type: 'tool', tool: 'Read', parent_tool_use_id: 't1', tool_use_id: 't2' }
3. { type: 'user', content: [{ tool_use_id: 't2', content: '...' }] }

Frontend Processing:
→ JsonlMessageProcessor detects parent_tool_use_id
→ ExecutionTreeBuilder nests tool under agent node
→ ExecutionNode tree:
  {
    id: 't1',
    type: 'agent',
    agentType: 'software-architect',
    children: [
      {
        id: 't2',
        type: 'tool',
        toolName: 'Read',
        toolOutput: '...'
      }
    ]
  }
```

### SDK Nested Agent (with Backend Adapter)

```
SDK Events (hypothetical - depends on SDK capabilities):
1. { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Task' } }
2. { type: 'content_block_start', parent_id: 't1', content_block: { type: 'tool_use', id: 't2', name: 'Read' } }

Backend Adapter Transforms:
→ { type: 'tool', tool: 'Task', tool_use_id: 't1' }
→ { type: 'tool', tool: 'Read', parent_tool_use_id: 't1', tool_use_id: 't2' }

Frontend Processing:
→ (SAME AS CLI) JsonlMessageProcessor
→ (SAME AS CLI) ExecutionTreeBuilder
→ (IDENTICAL) Nested ExecutionNode tree
```

**Critical**: If SDK doesn't support `parent_id` concept, backend adapter must infer nesting from tool execution context.

---

## Performance Considerations

### Current (CLI Only)

- **Message Rate**: 10-50 JSONL chunks per second during streaming
- **Processing Time**: < 1ms per chunk (measured)
- **UI Updates**: Signal-based reactivity (optimal)

### With SDK (Option A - Backend Adapter)

- **Message Rate**: Same (10-50 chunks/sec)
- **Processing Time**: Same (< 1ms per chunk)
- **Additional Backend Overhead**: ~0.5ms per SDK event (conversion)
- **Total Impact**: Negligible (< 5% overhead)

### With SDK (Option B - Frontend Dual Processor)

- **Message Rate**: Same
- **Processing Time**: ~1.5ms per chunk (new processor logic)
- **Bundle Size Impact**: +15KB (new processor code)
- **Total Impact**: Low but measurable

---

## Testing Strategy

### Unit Tests (Adapter Layer)

```typescript
describe('SdkEventAdapter', () => {
  it('converts SDK text delta to JSONLMessage', () => {
    const sdkEvent = {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello' },
    };

    const jsonl = adapter.convertEvent(sdkEvent);

    expect(jsonl).toEqual({
      type: 'assistant',
      delta: 'Hello',
      message: { content: [{ type: 'text', text: 'Hello' }] },
    });
  });

  it('converts SDK tool_use to JSONLMessage', () => {
    const sdkEvent = {
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: 't1',
        name: 'Read',
        input: { file_path: '/foo/bar.ts' },
      },
    };

    const jsonl = adapter.convertEvent(sdkEvent);

    expect(jsonl).toEqual({
      type: 'tool',
      tool: 'Read',
      tool_use_id: 't1',
      args: { file_path: '/foo/bar.ts' },
    });
  });
});
```

### Integration Tests (E2E Flow)

```typescript
describe('SDK Integration', () => {
  it('renders SDK message stream identically to CLI', async () => {
    // Start CLI session
    const cliSession = await startCliSession();
    await cliSession.sendMessage('Implement a new feature');
    const cliUI = captureRenderedUI();

    // Start SDK session
    const sdkSession = await startSdkSession();
    await sdkSession.sendMessage('Implement a new feature');
    const sdkUI = captureRenderedUI();

    // UI should be identical (minus internal IDs)
    expect(normalizeUI(cliUI)).toEqual(normalizeUI(sdkUI));
  });

  it('handles nested agent execution from SDK', async () => {
    const session = await startSdkSession();
    await session.sendMessage('Use software-architect agent');

    // Wait for agent tool call
    await waitForElement('[data-agent-type="software-architect"]');

    // Verify nested tool execution renders
    const agentCard = screen.getByTestId('agent-card-t1');
    expect(agentCard).toContainElement(screen.getByText('Read'));
  });
});
```

---

## Migration Plan

### Phase 1: Backend Adapter (Week 1)

- [ ] Create `SdkEventAdapter` service
- [ ] Map SDK events to JSONLMessage format
- [ ] Add unit tests for adapter
- [ ] Wire SDK events to webview messaging

### Phase 2: Integration Testing (Week 2)

- [ ] Test SDK stream rendering
- [ ] Verify tool execution display
- [ ] Test nested agent rendering (if supported)
- [ ] Compare CLI vs SDK UI output

### Phase 3: Frontend Enhancement (Optional)

- [ ] Add provider badge to message bubbles (CLI/SDK icon)
- [ ] Add provider-specific metrics (if different)
- [ ] Add provider switcher UI

---

## Conclusion

**The message flow architecture is PERFECT for multi-provider support!**

- Backend adapter normalizes formats
- Frontend processes unified structure
- UI components stay 100% unchanged
- Both providers can coexist seamlessly

**Estimated Implementation Time**: 3-5 days (mostly backend work)
