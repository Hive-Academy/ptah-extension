# JSONLStreamParser Integration Guide

**Last Updated**: 2025-11-23
**File Location**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

---

## Parser Overview

**Purpose**: Parse Claude CLI's JSONL stdout into typed callbacks WITHOUT splitting unified messages.

**Key Design Principle**: Parser outputs `ClaudeContentChunk` with `blocks: ContentBlock[]` array — preserving the unified message structure from Claude CLI.

---

## Callback Interface

```typescript
// From jsonl-stream-parser.ts lines 153-165
export interface JSONLParserCallbacks {
  onSessionInit?: (sessionId: string, model?: string) => void;
  onContent?: (chunk: ClaudeContentChunk) => void; // ← Unified content
  onThinking?: (event: ClaudeThinkingEvent) => void;
  onTool?: (event: ClaudeToolEvent) => void;
  onPermission?: (request: ClaudePermissionRequest) => void;
  onAgentStart?: (event: ClaudeAgentStartEvent) => void;
  onAgentActivity?: (event: ClaudeAgentActivityEvent) => void;
  onAgentComplete?: (event: ClaudeAgentCompleteEvent) => void;
  onMessageStop?: () => void; // NEW: Message streaming complete
  onResult?: (result: JSONLResultMessage) => void; // NEW: Final metrics
  onError?: (error: Error, rawLine?: string) => void;
}
```

---

## ClaudeContentChunk Structure

**CRITICAL**: `onContent` receives unified chunks with all block types together.

```typescript
// From jsonl-stream-parser.ts lines 368-376
const contentChunk: ClaudeContentChunk = {
  type: 'content',
  blocks: [
    { type: 'text', text: 'Hello', index: 0 },
    { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {...}, index: 0 }
  ], // ← Multiple block types in SAME array
  index: 0,
  timestamp: Date.now(),
};
this.callbacks.onContent?.(contentChunk);
```

**Why This Matters**: Frontend receives `contentChunk.blocks` and can render all types in single iteration.

---

## Integration Example: ClaudeCliLauncher

**File**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`

### Complete Integration Code

```typescript
// From claude-cli-launcher.ts lines 282-413
private createStreamingPipeline(
  childProcess: ChildProcess,
  sessionId: SessionId,
  spawnCommand: string,
  spawnShell: boolean
): Readable {
  if (!childProcess.stdout) {
    throw new Error('Child process stdout is null');
  }

  const outputStream = new Readable({
    objectMode: true,
    read() {
      // Resume child process stdout when consumer is ready for more data
      if (childProcess.stdout?.isPaused()) {
        childProcess.stdout.resume();
      }
    },
  });

  // Create parser with event callbacks
  const callbacks: JSONLParserCallbacks = {
    onSessionInit: (claudeSessionId, model) => {
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.sessionManager?.setClaudeSessionId?.(sessionId, claudeSessionId);
      this.deps.eventPublisher?.emitSessionInit?.(sessionId, claudeSessionId, model);
    },

    onContent: (chunk) => {
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.sessionManager?.touchSession?.(sessionId);
      this.deps.eventPublisher?.emitContentChunk?.(sessionId, chunk.blocks);
      pushWithBackpressure({ type: 'content', data: chunk });
    },

    onThinking: (thinking) => {
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.eventPublisher?.emitThinking?.(sessionId, thinking);
      pushWithBackpressure({ type: 'thinking', data: thinking });
    },

    onTool: (toolEvent) => {
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.eventPublisher?.emitToolEvent?.(sessionId, toolEvent);
      pushWithBackpressure({ type: 'tool', data: toolEvent });
    },

    onPermission: async (request) => {
      await this.handlePermissionRequest(sessionId, request, childProcess);
    },

    onError: (error, rawLine) => {
      console.error('[ClaudeCliLauncher] Parser error:', error.message);
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.eventPublisher?.emitError?.(error.message, sessionId, { rawLine });
    },

    onAgentStart: (event) => {
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.eventPublisher?.emitAgentStarted?.(sessionId, event);
    },

    onAgentActivity: (event) => {
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.eventPublisher?.emitAgentActivity?.(sessionId, event);
    },

    onAgentComplete: (event) => {
      // TODO: Phase 2 RPC - Restore via RPC
      this.deps.eventPublisher?.emitAgentCompleted?.(sessionId, event);
    },

    onMessageStop: () => {
      console.log('[ClaudeCliLauncher] Streaming complete (message_stop received)');
      // NOTE: MESSAGE_COMPLETE event is emitted by message-handler.service.ts
      // when the stream 'end' event fires with the complete accumulated message.
      // Emitting here would cause duplicate MESSAGE_COMPLETE events.
      // The message-handler has better context (full message object vs just sessionId).
    },

    onResult: (result) => {
      console.log('[ClaudeCliLauncher] Final result received:', {
        cost: result.total_cost_usd,
        duration: result.duration_ms,
        tokens: result.usage,
      });

      // Emit token usage if available
      // TODO: Phase 2 RPC - Restore via RPC
      if (result.usage) {
        this.deps.eventPublisher?.emitTokenUsage?.(sessionId, {
          inputTokens: result.usage.input_tokens || 0,
          outputTokens: result.usage.output_tokens || 0,
          cacheReadTokens: result.usage.cache_read_input_tokens || 0,
          cacheCreationTokens: result.usage.cache_creation_input_tokens || 0,
          totalCost: result.total_cost_usd || 0,
        });
      }

      // Emit session end
      // TODO: Phase 2 RPC - Restore via RPC
      const reason = result.subtype === 'success' ? 'completed' : 'error';
      this.deps.eventPublisher?.emitSessionEnd?.(sessionId, reason);
    },
  };

  const parser = new JSONLStreamParser(callbacks);

  // Pipe stdout through parser
  childProcess.stdout.on('data', (chunk: Buffer) => {
    console.log('[ClaudeCliLauncher] Received stdout data:', {
      chunkLength: chunk.length,
      chunkPreview: chunk.toString('utf8').substring(0, 200),
    });
    parser.processChunk(chunk);
  });

  // Handle stderr
  if (childProcess.stderr) {
    childProcess.stderr.on('data', (data) => {
      const stderr = data.toString();
      console.error('[ClaudeCliLauncher] STDERR:', stderr);
      // TODO: Phase 2 RPC - Restore via RPC
      if (stderr.trim()) {
        this.deps.eventPublisher?.emitError?.(stderr, sessionId);
      }
    });
  }

  // Handle process close
  childProcess.on('close', (code) => {
    parser.processEnd();
    outputStream.push(null); // End stream

    console.log(
      `[ClaudeCliLauncher] Process closed for session ${sessionId} with exit code ${code}`
    );
  });

  // Handle process error (ENOENT, EACCES, etc.)
  childProcess.on('error', (error) => {
    console.error('[ClaudeCliLauncher] Process spawn/execution error:', {
      errorMessage: error.message,
      errorCode: (error as NodeJS.ErrnoException).code,
      sessionId,
    });
    // TODO: Phase 2 RPC - Restore via RPC
    this.deps.eventPublisher?.emitError?.(error.message, sessionId);
    outputStream.destroy(error);
  });

  return outputStream;
}
```

---

## Simple Forwarding Pattern (RPC Migration Phase 3.5)

**Goal**: Replace `// TODO: Phase 2 RPC` comments with simple postMessage forwarding.

### Template for RPC Callback Forwarding

```typescript
// CORRECT: Simple forwarding (NO transformation)
const callbacks: JSONLParserCallbacks = {
  onSessionInit: (sessionId, model) => {
    webview.postMessage({
      type: 'streaming:session-init',
      data: { sessionId, model },
    });
  },

  onContent: (chunk) => {
    // ✅ Forward chunk AS-IS with blocks array intact
    webview.postMessage({
      type: 'streaming:content',
      data: chunk, // { type: 'content', blocks: [...], timestamp }
    });
  },

  onThinking: (event) => {
    webview.postMessage({
      type: 'streaming:thinking',
      data: event,
    });
  },

  onTool: (event) => {
    webview.postMessage({
      type: 'streaming:tool',
      data: event,
    });
  },

  onPermission: async (request) => {
    // Permission requires user interaction, not streaming
    await this.handlePermissionRequest(sessionId, request, childProcess);
  },

  onAgentStart: (event) => {
    webview.postMessage({
      type: 'streaming:agent-start',
      data: event,
    });
  },

  onAgentActivity: (event) => {
    webview.postMessage({
      type: 'streaming:agent-activity',
      data: event,
    });
  },

  onAgentComplete: (event) => {
    webview.postMessage({
      type: 'streaming:agent-complete',
      data: event,
    });
  },

  onMessageStop: () => {
    webview.postMessage({
      type: 'streaming:message-stop',
      data: {},
    });
  },

  onResult: (result) => {
    webview.postMessage({
      type: 'streaming:result',
      data: result,
    });
  },

  onError: (error, rawLine) => {
    webview.postMessage({
      type: 'streaming:error',
      data: { message: error.message, rawLine },
    });
  },
};
```

---

## What NOT to Do

### ❌ WRONG: Transforming Callbacks

```typescript
// DON'T DO THIS - Transforms unified chunk into separate messages
onContent: (chunk) => {
  for (const block of chunk.blocks) {
    if (block.type === 'text') {
      webview.postMessage('text-chunk', { text: block.text }); // ❌ Split
    }
    if (block.type === 'tool_use') {
      webview.postMessage('tool-start', { tool: block.name }); // ❌ Split
    }
  }
  // This recreates EventBus splitting problem!
};
```

**Why Wrong**: Destroys unified message structure, recreates EventBus anti-pattern.

### ❌ WRONG: Creating New Event Taxonomy

```typescript
// DON'T DO THIS - New event types that don't match parser callbacks
onContent: (chunk) => {
  eventEmitter.emit('MESSAGE_CHUNK_RECEIVED', chunk); // ❌ New event
  eventEmitter.emit('CONTENT_PROCESSING_START', chunk); // ❌ New event
  eventEmitter.emit('CONTENT_READY_FOR_RENDER', chunk); // ❌ New event
  // This creates event splitting again!
};
```

**Why Wrong**: Adds unnecessary abstraction, delays streaming, creates complexity.

---

## Callback Lifecycle Flow

```
CLI spawns
  ↓
stdout emits data
  ↓
parser.processChunk(buffer)
  ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Callback Sequence (typical conversation):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. onSessionInit(sessionId, model)          // First JSONL line
2. onContent(chunk) [multiple times]        // Streaming text deltas
3. onContent(chunk) [with tool_use block]   // Complete message with text + tool_use
4. onTool({ type: 'start', ... })           // Tool execution starts
5. onTool({ type: 'result', ... })          // Tool execution completes
6. onContent(chunk) [more text]             // Assistant continues response
7. onMessageStop()                           // Stream ends
8. onResult(result)                          // Final metrics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Process exits
```

**Key Observations**:

- `onContent` called multiple times (incremental chunks)
- `onContent` can contain BOTH text AND tool_use blocks (unified)
- `onTool` called separately for tool lifecycle (parallel to content)
- `onMessageStop` signals end of streaming (frontend can finalize UI)
- `onResult` provides cost/usage data for analytics

---

## Backpressure Handling

**Important**: Parser outputs chunks faster than frontend can render. Use backpressure to prevent memory issues.

```typescript
// From claude-cli-launcher.ts lines 292-316
const outputStream = new Readable({
  objectMode: true,
  read() {
    // Resume child process stdout when consumer is ready for more data
    if (childProcess.stdout?.isPaused()) {
      childProcess.stdout.resume();
    }
  },
});

const pushWithBackpressure = (data: unknown): void => {
  const canContinue = outputStream.push(data);
  if (!canContinue && childProcess.stdout && !childProcess.stdout.isPaused()) {
    // Buffer is full - pause source stream to prevent memory issues
    childProcess.stdout.pause();
  }
};

// Use in callbacks:
onContent: (chunk) => {
  pushWithBackpressure({ type: 'content', data: chunk });
},
```

**For RPC**: Backpressure handled by VS Code postMessage buffering (no manual pause needed).

---

## Error Handling

### Parser Errors (Invalid JSONL)

```typescript
onError: (error, rawLine) => {
  console.error('[Parser] JSONL parse error:', error.message);
  console.error('[Parser] Raw line:', rawLine);
  // Log but continue processing (graceful degradation)
  // Don't crash entire CLI process for one bad line
};
```

### CLI Process Errors

```typescript
childProcess.on('error', (error) => {
  console.error('[Launcher] Process error:', error);
  // This is CRITICAL - process failed to spawn or execute
  callbacks.onError?.(error);
  outputStream.destroy(error); // End stream with error
});
```

---

## Agent Tracking (Advanced)

**Only Task tool creates agents**. Parser maintains `activeAgents` Map:

```typescript
// From jsonl-stream-parser.ts lines 183, 494-526
private readonly activeAgents = new Map<string, AgentMetadata>();

private handleTaskToolEvent(msg: JSONLToolMessage, timestamp: number): void {
  if (msg.subtype === 'start') {
    // Extract agent metadata from Task tool args
    const metadata: AgentMetadata = {
      agentId: msg.tool_call_id,
      subagentType: this.extractString(msg.args, 'subagent_type'),
      description: this.extractString(msg.args, 'description'),
      prompt: this.extractString(msg.args, 'prompt'),
      model: this.extractStringOptional(msg.args, 'model'),
      startTime: timestamp,
    };
    this.activeAgents.set(msg.tool_call_id, metadata);

    // Emit agent start event
    this.callbacks.onAgentStart?.({ ...metadata, type: 'agent_start', timestamp });
  }

  if (msg.subtype === 'result') {
    const agent = this.activeAgents.get(msg.tool_call_id);
    if (agent) {
      const duration = timestamp - agent.startTime;
      this.callbacks.onAgentComplete?.({
        type: 'agent_complete',
        agentId: msg.tool_call_id,
        duration,
        result: this.extractStringOptional(msg.output, 'result'),
        timestamp,
      });
      this.activeAgents.delete(msg.tool_call_id); // Cleanup
    }
  }
}
```

**Usage**: Frontend can build agent activity trees from `onAgentStart`, `onAgentActivity`, `onAgentComplete` events.

---

## Testing Parser Integration

```typescript
// Example test (NOT using real CLI)
describe('JSONLStreamParser Integration', () => {
  it('should preserve contentBlocks array in onContent callback', () => {
    let receivedChunk: ClaudeContentChunk | null = null;

    const parser = new JSONLStreamParser({
      onContent: (chunk) => {
        receivedChunk = chunk;
      },
    });

    const jsonl = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} },
        ],
      },
    });

    parser.processChunk(Buffer.from(jsonl + '\n'));

    expect(receivedChunk).not.toBeNull();
    expect(receivedChunk!.blocks).toHaveLength(2);
    expect(receivedChunk!.blocks[0].type).toBe('text');
    expect(receivedChunk!.blocks[1].type).toBe('tool_use');
  });
});
```

---

## Summary: Integration Checklist

✅ **DO**:

- [ ] Forward callbacks as-is to webview postMessage
- [ ] Preserve `chunk.blocks` array without splitting
- [ ] Handle `onMessageStop` to detect streaming end
- [ ] Use `onResult` for cost/usage tracking
- [ ] Implement error handling for parser + process errors
- [ ] Log all callbacks for debugging

❌ **DON'T**:

- [ ] Transform chunks into separate messages per block type
- [ ] Create new event taxonomy beyond parser callbacks
- [ ] Buffer/cache chunks before forwarding
- [ ] Split `contentBlocks` array into separate postMessages
- [ ] Emit events for message lifecycle (start, progress, end)

**Next Steps**: See `frontend-content-blocks-rendering.md` for unified rendering patterns.
