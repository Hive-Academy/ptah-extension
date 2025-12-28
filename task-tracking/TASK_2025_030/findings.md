# TASK_2025_030: Technical Findings

## Current Streaming Architecture Analysis

### 1. How Claude CLI Sends Chunks

**Location**: `libs/backend/claude-domain/src/cli/claude-process.ts:261-274`

```typescript
private processChunk(chunk: Buffer | string): void {
  this.buffer += chunk.toString('utf8');
  const lines = this.buffer.split('\n');
  this.buffer = lines.pop() || ''; // Keep incomplete line
  for (const line of lines) {
    if (line.trim()) {
      this.parseLine(line);
    }
  }
}
```

**Behavior**: Buffers data until complete JSONL lines are received. While `JSONLMessage` has a `delta` field, Claude CLI often sends larger chunks, not single characters.

### 2. Frontend Delta Processing

**Location**: `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts:212-214`

```typescript
if (chunk.delta) {
  tree = this.treeBuilder.appendTextDelta(tree, chunk.delta);
}
```

**Location**: `libs/frontend/chat/src/lib/services/tree-builder.service.ts:154-188`

```typescript
appendTextDelta(tree: ExecutionNode, delta: string): ExecutionNode {
  const lastChild = tree.children[tree.children.length - 1];
  if (lastChild?.type === 'text' && lastChild.status === 'streaming') {
    // Append to existing streaming text node - INSTANT, no animation
    const updatedChild: ExecutionNode = {
      ...lastChild,
      content: (lastChild.content ?? '') + delta,
    };
    // ...
  }
}
```

**Issue**: Delta is appended instantly - no animation or typing effect.

### 3. Chat View Streaming Logic

**Location**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:12-23`

```html
<!-- Streaming message - ONLY shown when tree EXISTS -->
@if (chatStore.isStreaming() && streamingMessage(); as msg) {
<ptah-message-bubble [message]="msg" />
}

<!-- Loading dots - ONLY shown when tree does NOT exist -->
@if (chatStore.isStreaming() && !chatStore.currentExecutionTree()) {
<div class="flex items-center gap-2 text-sm text-base-content/60 ml-4">
  <span class="loading loading-dots loading-sm"></span>
  Claude is responding...
</div>
}
```

**Problem**: Streaming indicator vanishes as soon as tree starts building. During long pauses mid-stream, the bubble appears static.

### 4. Tool Streaming Status

**Location**: `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts:126-130`

```html
@else if (node().status === 'streaming') {
<lucide-angular [img]="LoaderIcon" class="w-3 h-3 text-info animate-spin flex-shrink-0" />
}
```

**Good**: Shows spinner when streaming.
**Missing**: No text showing what tool is doing (e.g., "Reading file.ts...").

### 5. Status Badge

**Location**: `libs/frontend/chat/src/lib/components/atoms/status-badge.component.ts:27-29`

```html
@if (status() === 'streaming') {
<span class="loading loading-spinner loading-xs mr-1"></span>
}
```

**Good**: Shows DaisyUI spinner.
**Could enhance**: Add pulsing effect during long operations.

### 6. Message Bubble Avatar

**Location**: `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:68-79`

```html
<div class="chat-image avatar">
  <div class="w-8 h-8 rounded-full overflow-hidden">
    <img [ngSrc]="ptahIconUri" alt="Claude" width="32" height="32" />
  </div>
</div>
```

**Missing**: No activity indicator on avatar during streaming.

## Proposed Solutions

### Fix 1: Streaming Indicator Logic

**Change `chat-view.component.html`**:

```html
<!-- Always show streaming message when isStreaming, regardless of tree -->
@if (chatStore.isStreaming()) { @if (streamingMessage(); as msg) {
<ptah-message-bubble [message]="msg" [isStreaming]="true" />
} @else {
<!-- Skeleton/placeholder before tree starts -->
<div class="chat chat-start">
  <div class="chat-bubble bg-neutral">
    <div class="skeleton h-4 w-48"></div>
    <div class="skeleton h-4 w-32 mt-1"></div>
  </div>
</div>
} }
```

### Fix 2: Typing Cursor Component

**New file**: `libs/frontend/chat/src/lib/components/atoms/typing-cursor.component.ts`

```typescript
@Component({
  selector: 'ptah-typing-cursor',
  template: `<span class="typing-cursor animate-blink">▌</span>`,
  styles: [
    `
      @keyframes blink {
        0%,
        50% {
          opacity: 1;
        }
        51%,
        100% {
          opacity: 0;
        }
      }
      .animate-blink {
        animation: blink 1s step-end infinite;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TypingCursorComponent {}
```

### Fix 3: Tool Activity Description

**Enhance `tool-call-item.component.ts`**:

```html
@if (node().status === 'streaming') {
<span class="text-base-content/50 text-[10px] animate-pulse"> {{ getStreamingDescription() }} </span>
}
```

```typescript
protected getStreamingDescription(): string {
  const toolName = this.node().toolName;
  const input = this.node().toolInput;
  switch (toolName) {
    case 'Read': return `Reading ${this.shortenPath(input?.['file_path'])}...`;
    case 'Write': return `Writing ${this.shortenPath(input?.['file_path'])}...`;
    case 'Bash': return `Running command...`;
    case 'Grep': return `Searching...`;
    default: return `Executing ${toolName}...`;
  }
}
```

### Fix 4: Avatar Activity Ring

**Enhance `message-bubble.component.html`**:

```html
<div class="chat-image avatar" [class.ring]="isStreaming()" [class.ring-info]="isStreaming()" [class.animate-pulse]="isStreaming()"></div>
```

### Fix 5: Typewriter Animation Directive

**New file**: `libs/frontend/chat/src/lib/directives/typewriter.directive.ts`

```typescript
@Directive({ selector: '[ptahTypewriter]' })
export class TypewriterDirective implements OnChanges {
  @Input('ptahTypewriter') text = '';
  @Input() speed = 10; // ms per character

  private displayedText = signal('');

  ngOnChanges(changes: SimpleChanges) {
    if (changes['text']) {
      this.animateText(changes['text'].previousValue, changes['text'].currentValue);
    }
  }

  private animateText(prev: string, curr: string) {
    const newChars = curr.slice(prev?.length || 0);
    let i = 0;
    const interval = setInterval(() => {
      if (i < newChars.length) {
        this.displayedText.update((t) => t + newChars[i]);
        i++;
      } else {
        clearInterval(interval);
      }
    }, this.speed);
  }
}
```

## DaisyUI Components Available

| Component       | Class                     | Use Case            |
| --------------- | ------------------------- | ------------------- |
| Loading dots    | `loading loading-dots`    | General waiting     |
| Loading spinner | `loading loading-spinner` | Tool execution      |
| Skeleton        | `skeleton`                | Placeholder content |
| Pulse           | `animate-pulse`           | Activity indicator  |
| Ring            | `ring ring-info`          | Avatar activity     |

## Performance Considerations

1. **Use CSS animations over JS** where possible (GPU accelerated)
2. **Debounce rapid updates** if typewriter animation causes jank
3. **Use OnPush** change detection (already in place)
4. **Avoid re-rendering entire tree** for cursor position changes
