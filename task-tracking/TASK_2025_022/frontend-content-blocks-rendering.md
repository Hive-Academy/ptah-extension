# Frontend Content Blocks Rendering

**Last Updated**: 2025-11-23
**Component**: `libs/frontend/chat/src/lib/components/chat-messages/components/chat-message-content/chat-message-content.component.ts`

---

## Unified Message Rendering Philosophy

**Core Principle**: Iterate `message.contentBlocks` array ONCE, render all block types together.

**Why**: Preserves natural ordering from Claude CLI, shows user text + thinking + tools in intended sequence.

---

## ProcessedClaudeMessage Wrapper

**Type Definition** (from `@ptah-extension/core`):

```typescript
export interface ProcessedClaudeMessage extends StrictChatMessage {
  // Extends base message with processed fields
  contentBlocks: ContentBlock[]; // ← Unified array of all block types
  toolsUsed?: string[];
  hasImages?: boolean;
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface StrictChatMessage {
  id: MessageId;
  type: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[]; // Legacy support + new format
  timestamp: number;
  sessionId?: SessionId;
}
```

**Key Insight**: `contentBlocks` is the PROCESSED version of `content`, expanded into discriminated union array.

---

## ContentBlock Union Type

```typescript
// From libs/shared/src/lib/types/content-block.types.ts
export type ContentBlock = TextContentBlock | ThinkingContentBlock | ToolUseContentBlock | ToolResultContentBlock;
```

**Type Guards** (exported from `@ptah-extension/core`):

```typescript
export function isTextContent(block: ContentBlock): block is TextContentBlock {
  return block.type === 'text';
}

export function isThinkingContent(block: ContentBlock): block is ThinkingContentBlock {
  return block.type === 'thinking';
}

export function isToolUseContent(block: ContentBlock): block is ToolUseContentBlock {
  return block.type === 'tool_use';
}

export function isToolResultContent(block: ContentBlock): block is ToolResultContentBlock {
  return block.type === 'tool_result';
}
```

---

## ChatMessageContentComponent Template

**File**: `chat-message-content.component.html`

### Single Message Iteration Pattern

```html
<!-- From chat-message-content.component.html -->
<div class="message-content" #contentContainer>
  <!-- Iterate contentBlocks array ONCE -->
  @for (block of message().contentBlocks; track trackByContent($index, block)) {

  <!-- Switch on block type (discriminated union) -->
  @switch (block.type) {

  <!-- Text block -->
  @case ('text') {
  <div class="text-block" [innerHTML]="block.text | safeHtml"></div>
  }

  <!-- Thinking block -->
  @case ('thinking') {
  <ptah-thinking-block [content]="block.thinking" [timestamp]="block.timestamp || message().timestamp" />
  }

  <!-- Tool use block -->
  @case ('tool_use') {
  <ptah-tool-use-block [toolUse]="block" [timestamp]="message().timestamp" />
  }

  <!-- Tool result block -->
  @case ('tool_result') {
  <ptah-tool-result-block [result]="block" [timestamp]="message().timestamp" />
  } } }
</div>
```

**Benefits**:

- **Single iteration**: Efficient, predictable rendering
- **Natural ordering**: Blocks appear in Claude's intended sequence
- **Type-safe**: TypeScript discriminates on `block.type`
- **Extensible**: New block types added without breaking existing switches

---

## Component Breakdown

### 1. ThinkingBlockComponent

**Purpose**: Render `<thinking>` content with collapsible UI.

```typescript
// libs/frontend/chat/src/lib/components/thinking-block/thinking-block.component.ts
@Component({
  selector: 'ptah-thinking-block',
  template: `
    <div class="thinking-block">
      <div class="thinking-header" (click)="toggleExpanded()">
        <span class="thinking-icon">💭</span>
        <span class="thinking-label">Claude's Thinking</span>
        <span class="thinking-toggle">{{ isExpanded() ? '▼' : '▶' }}</span>
      </div>
      @if (isExpanded()) {
      <div class="thinking-content">
        {{ content() }}
      </div>
      }
    </div>
  `,
})
export class ThinkingBlockComponent {
  readonly content = input.required<string>();
  readonly timestamp = input<number>();

  protected isExpanded = signal(false);

  toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }
}
```

**Features**:

- Collapsible (default: collapsed to reduce clutter)
- Shows thinking process when expanded
- Timestamp for debugging

---

### 2. ToolUseBlockComponent

**Purpose**: Render tool execution START with args.

```typescript
// libs/frontend/chat/src/lib/components/tool-use-block/tool-use-block.component.ts
@Component({
  selector: 'ptah-tool-use-block',
  template: `
    <div class="tool-use-block">
      <div class="tool-header">
        <span class="tool-icon">{{ getToolIcon() }}</span>
        <span class="tool-name">{{ toolUse().name }}</span>
        <span class="tool-status">Starting...</span>
      </div>
      @if (hasParameters()) {
      <div class="tool-parameters">
        @for (param of getParameters(); track param.key) {
        <div class="param-row">
          <span class="param-key">{{ param.key }}:</span>
          <span class="param-value" [innerHTML]="formatValue(param.value) | safeHtml"></span>
        </div>
        }
      </div>
      }
    </div>
  `,
})
export class ToolUseBlockComponent {
  readonly toolUse = input.required<ToolUseContentBlock>();
  readonly timestamp = input<number>();

  protected getToolIcon(): string {
    const iconMap: Record<string, string> = {
      Read: '📖',
      Write: '✏️',
      Edit: '📝',
      Bash: '💻',
      Grep: '🔎',
      Glob: '🔍',
    };
    return iconMap[this.toolUse().name] || '🔧';
  }

  protected hasParameters(): boolean {
    return Object.keys(this.toolUse().input).length > 0;
  }

  protected getParameters(): Array<{ key: string; value: unknown }> {
    return Object.entries(this.toolUse().input).map(([key, value]) => ({
      key,
      value,
    }));
  }

  protected formatValue(value: unknown): string {
    if (typeof value === 'string') {
      return `<code>${value}</code>`;
    }
    return `<pre><code>${JSON.stringify(value, null, 2)}</code></pre>`;
  }
}
```

**Features**:

- Tool icon mapping
- Expandable parameters
- JSON formatting for complex inputs

---

### 3. ToolResultBlockComponent

**Purpose**: Render tool execution RESULT/ERROR.

```typescript
// libs/frontend/chat/src/lib/components/tool-result-block/tool-result-block.component.ts
@Component({
  selector: 'ptah-tool-result-block',
  template: `
    <div class="tool-result-block" [class.error]="result().is_error">
      <div class="result-header">
        <span class="result-icon">{{ result().is_error ? '❌' : '✅' }}</span>
        <span class="result-label">
          {{ result().is_error ? 'Tool Error' : 'Tool Result' }}
        </span>
      </div>
      <div class="result-content">
        {{ getResultText() }}
      </div>
    </div>
  `,
})
export class ToolResultBlockComponent {
  readonly result = input.required<ToolResultContentBlock>();
  readonly timestamp = input<number>();

  protected getResultText(): string {
    const content = this.result().content;

    if (typeof content === 'string') {
      return content;
    }

    // Handle array of text blocks (Messages API format)
    if (Array.isArray(content)) {
      return content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n');
    }

    return JSON.stringify(content, null, 2);
  }
}
```

**Features**:

- Error state styling (red border)
- Handles both string and array content formats
- Success/error icons

---

### 4. AgentTreeComponent

**Purpose**: Render agent hierarchy from activity events.

```typescript
// libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts
@Component({
  selector: 'ptah-agent-tree',
  template: `
    <div class="agent-tree">
      @for (agent of agents(); track agent.agentId) {
      <div class="agent-node" [class.active]="agent.isActive">
        <div class="agent-header">
          <span class="agent-icon">🤖</span>
          <span class="agent-type">{{ agent.subagentType }}</span>
          @if (agent.isActive) {
          <span class="agent-status">Running...</span>
          } @else {
          <span class="agent-duration">{{ formatDuration(agent.duration) }}</span>
          }
        </div>
        <div class="agent-description">{{ agent.description }}</div>
        @if (agent.activities.length > 0) {
        <div class="agent-activities">
          @for (activity of agent.activities; track activity.toolName + activity.timestamp) {
          <div class="activity-item">
            <span class="activity-tool">{{ getToolIcon(activity.toolName) }} {{ activity.toolName }}</span>
          </div>
          }
        </div>
        }
      </div>
      }
    </div>
  `,
})
export class AgentTreeComponent {
  readonly agents = input.required<AgentNode[]>();

  protected formatDuration(ms: number | undefined): string {
    if (!ms) return '';
    return `${(ms / 1000).toFixed(1)}s`;
  }

  protected getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      Read: '📖',
      Write: '✏️',
      Task: '🔧',
    };
    return iconMap[toolName] || '🔧';
  }
}

interface AgentNode {
  agentId: string;
  subagentType: string;
  description: string;
  isActive: boolean;
  duration?: number;
  activities: Array<{
    toolName: string;
    timestamp: number;
  }>;
}
```

**Features**:

- Hierarchical agent display
- Activity timeline per agent
- Duration tracking
- Active state indicator

---

## Why This Works

### Unified Rendering Benefits

```typescript
// CORRECT: Single iteration, all blocks together
@for (block of message().contentBlocks; track block.type) {
  @switch (block.type) {
    @case ('text') { <div>{{ block.text }}</div> }
    @case ('tool_use') { <ptah-tool-use-block [toolUse]="block" /> }
  }
}

// Result: User sees:
// "I'll help you with that." (text block)
// 🔧 Read file: src/app.ts (tool_use block)
// ✅ File contents: ... (tool_result block)
// "Based on the code..." (text block)
// All in natural order!
```

**Why**: Single loop preserves Claude's intended narrative flow.

---

## Why EventBus Failed

### EventBus Pattern (WRONG)

```typescript
// EventBus split into 3 separate subscriptions:

// Subscription 1: Text content
this.chatService.textChunks$.subscribe((chunk) => {
  this.renderText(chunk); // Renders text immediately
});

// Subscription 2: Tool usage
this.chatService.toolEvents$.subscribe((tool) => {
  this.renderTool(tool); // Renders tool separately
});

// Subscription 3: Thinking
this.chatService.thinkingEvents$.subscribe((thinking) => {
  this.renderThinking(thinking); // Renders thinking separately
});

// PROBLEM: Subscriptions fire at different times!
// Result:
// - Tool appears BEFORE text (wrong order)
// - Thinking appears AFTER tool result (wrong order)
// - Duplicate text blocks (event fired twice)
// - Missing tool blocks (event lost in transit)
```

**Why Wrong**:

- **Timing Issues**: Separate subscriptions race, blocks arrive out-of-order
- **Duplication**: Same content arrives via multiple event paths
- **Lost Context**: Can't render "text before tool" because they're separate streams

---

## Real-Time Message Accumulation

**Pattern**: Append content chunks to existing message via signal updates.

```typescript
// ChatStoreService (from @ptah-extension/core)
export class ChatStoreService {
  private _messages = signal<ProcessedClaudeMessage[]>([]);
  readonly messages = this._messages.asReadonly();

  appendContentChunk(chunk: ClaudeContentChunk): void {
    this._messages.update((messages) => {
      const lastMessage = messages[messages.length - 1];

      if (lastMessage && lastMessage.streaming) {
        // Append blocks to existing streaming message
        return messages.map((msg, idx) =>
          idx === messages.length - 1
            ? {
                ...msg,
                contentBlocks: [...msg.contentBlocks, ...chunk.blocks],
              }
            : msg
        );
      }

      // Create new message if no streaming message exists
      return [
        ...messages,
        {
          id: MessageId.create(),
          type: 'assistant',
          content: chunk.blocks,
          contentBlocks: chunk.blocks,
          timestamp: chunk.timestamp,
          streaming: true,
        },
      ];
    });
  }

  finalizeStreamingMessage(): void {
    this._messages.update((messages) => messages.map((msg) => ({ ...msg, streaming: false })));
  }
}
```

**Usage**:

1. Backend sends `streaming:content` postMessage with `ClaudeContentChunk`
2. Frontend `VSCodeService` calls `chatStore.appendContentChunk(chunk)`
3. Signal update triggers component re-render
4. `ChatMessageContentComponent` iterates updated `contentBlocks` array
5. User sees new blocks appear in real-time (word-by-word effect)

---

## ChatStreamingStatusComponent Usage

**Purpose**: Show streaming banner while assistant is responding.

```typescript
// ChatComponent.ts (container)
@Component({
  template: `
    <ptah-chat-streaming-status [isVisible]="isStreaming()" [streamingMessage]="'Claude is responding...'" [canStop]="true" (stopStreaming)="handleStopStreaming()" />

    <ptah-chat-messages-list [messages]="messages()" [isStreaming]="isStreaming()" />
  `,
})
export class ChatComponent {
  protected readonly isStreaming = computed(() => {
    const messages = this.chatStore.messages();
    return messages.some((msg) => msg.streaming === true);
  });

  protected handleStopStreaming(): void {
    this.chatService.stopCurrentResponse();
  }
}
```

**Features**:

- Sticky banner at top of message list
- Spinner animation (reduced motion support)
- Stop button (kills backend CLI process)
- Auto-hides when `message_stop` event received

---

## Signal-Based State Management

**Pattern**: Use Angular signals, NOT RxJS BehaviorSubject.

```typescript
// ✅ CORRECT: Signals
export class ChatStoreService {
  private _messages = signal<ProcessedClaudeMessage[]>([]);
  readonly messages = this._messages.asReadonly();

  readonly messageCount = computed(() => this.messages().length);
  readonly hasMessages = computed(() => this.messageCount() > 0);
}

// ❌ WRONG: RxJS (old EventBus pattern)
export class ChatStoreService {
  private _messages$ = new BehaviorSubject<ProcessedClaudeMessage[]>([]);
  readonly messages$ = this._messages$.asObservable();
  // Requires subscriptions, memory leaks, complex lifecycle management
}
```

**Why Signals**:

- **Automatic cleanup**: No unsubscribe needed
- **Synchronous**: No async timing issues
- **Computed derivations**: Auto-update when dependencies change
- **OnPush compatible**: Works with Angular change detection

---

## Performance Optimization

### Virtual Scrolling (for 100+ messages)

```typescript
// ChatMessagesListComponent
@Component({
  template: `
    <div class="messages-container" style="content-visibility: auto;">
      @for (message of messages(); track message.id) {
      <ptah-chat-message-content [message]="message" style="content-visibility: auto;" />
      }
    </div>
  `,
})
export class ChatMessagesListComponent {
  readonly messages = input.required<ProcessedClaudeMessage[]>();
}
```

**CSS `content-visibility: auto`**:

- Browser skips rendering off-screen messages
- Massive performance improvement for long conversations
- Native browser feature, no library needed

---

## Testing Unified Rendering

```typescript
describe('ChatMessageContentComponent', () => {
  it('should render all content block types in single iteration', () => {
    const message: ProcessedClaudeMessage = {
      id: MessageId.create(),
      type: 'assistant',
      content: [],
      contentBlocks: [
        { type: 'text', text: 'Hello' },
        { type: 'thinking', thinking: 'I should help' },
        { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} },
        { type: 'tool_result', tool_use_id: 'toolu_01', content: 'File contents' },
      ],
      timestamp: Date.now(),
    };

    const fixture = TestBed.createComponent(ChatMessageContentComponent);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    // Verify all 4 block types rendered
    expect(compiled.querySelector('.text-block')).toBeTruthy();
    expect(compiled.querySelector('ptah-thinking-block')).toBeTruthy();
    expect(compiled.querySelector('ptah-tool-use-block')).toBeTruthy();
    expect(compiled.querySelector('ptah-tool-result-block')).toBeTruthy();

    // Verify order preserved (text first, then thinking, then tool_use, then result)
    const blocks = Array.from(compiled.querySelectorAll('.text-block, ptah-thinking-block, ptah-tool-use-block, ptah-tool-result-block'));
    expect(blocks[0].classList.contains('text-block')).toBe(true);
    expect(blocks[1].tagName.toLowerCase()).toBe('ptah-thinking-block');
    expect(blocks[2].tagName.toLowerCase()).toBe('ptah-tool-use-block');
    expect(blocks[3].tagName.toLowerCase()).toBe('ptah-tool-result-block');
  });
});
```

---

## Summary Checklist

✅ **Unified Rendering Principles**:

- [ ] Iterate `message.contentBlocks` array ONCE
- [ ] Use `@switch (block.type)` for type discrimination
- [ ] Render all block types in same component
- [ ] Preserve ordering from Claude CLI
- [ ] Use signals for state management (not RxJS)

❌ **EventBus Anti-Patterns to Avoid**:

- [ ] Separate subscriptions for text vs tools vs thinking
- [ ] Multiple iterations over content array
- [ ] Splitting blocks into separate components that render independently
- [ ] BehaviorSubject for message state
- [ ] Reconstructing messages from event fragments

**Next Steps**: See `rpc-phase-3.5-streaming-solution.md` for wiring templates.
