# Implementation Plan: TASK_2025_009 - Message Type System Refactoring (ContentBlocks Migration)

**Task ID**: TASK_2025_009
**Created**: 2025-11-20
**Architect**: software-architect
**Status**: Architecture Complete
**Complexity**: HIGH (systematic refactoring across 4 layers)
**Estimated Effort**: 12-16 hours

---

## 🔍 Codebase Investigation Summary

### Libraries Analyzed

- **libs/shared**: Foundation types - Message protocol (94 types), StrictChatMessage definition

  - Key exports: SessionId, MessageId, CorrelationId, StrictMessageType, MessagePayloadMap
  - Documentation: libs/shared/CLAUDE.md
  - Usage: All message types currently use `content: string` (lines 75, 87, 332, 814)

- **libs/backend/claude-domain**: Business logic - CLI integration, JSONL parsing

  - Key components: JSONLStreamParser (802 lines), ClaudeCliLauncher
  - Pattern: Parser extracts structured data from CLI output, emits events via callbacks
  - Evidence: libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:1-802

- **libs/frontend/core**: Service layer - ChatService, VSCodeService, state management

  - Key exports: ChatService (message handling), ChatStateService (state)
  - Pattern: Signal-based reactivity, event subscription via VSCodeService
  - Evidence: libs/frontend/core/CLAUDE.md

- **libs/frontend/chat**: UI layer - 19 components for message display
  - Key components: ChatMessageContentComponent (content rendering)
  - Pattern: Signal inputs, OnPush change detection, @if/@for control flow
  - Evidence: libs/frontend/chat/CLAUDE.md

### Patterns Identified

#### Pattern 1: Current Message Structure (String-Based)

**Evidence**: libs/shared/src/lib/types/message.types.ts:810-834

```typescript
export interface StrictChatMessage {
  readonly id: MessageId;
  readonly sessionId: SessionId;
  readonly type: 'user' | 'assistant' | 'system';
  readonly content: string; // ← CURRENT: Flat string
  readonly timestamp: number;
  readonly streaming?: boolean;
  readonly files?: readonly string[];
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly isComplete?: boolean;
  readonly level?: 'info' | 'warning' | 'error';
  readonly cost?: number;
  readonly tokens?: {
    readonly input: number;
    readonly output: number;
    readonly cacheHit?: number;
  };
  readonly duration?: number;
}
```

#### Pattern 2: Current Parser Structure (JSONL → Events)

**Evidence**: libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:301-372

```typescript
private handleAssistantMessage(msg: JSONLAssistantMessage): void {
  const timestamp = Date.now();

  // Thinking content
  if (msg.thinking) {
    const thinkingEvent: ClaudeThinkingEvent = {
      type: 'thinking',
      content: msg.thinking, // ← Structured data from CLI
      timestamp,
    };
    this.callbacks.onThinking?.(thinkingEvent);
    return;
  }

  // Streaming content delta
  if (msg.delta) {
    const contentChunk: ClaudeContentChunk = {
      type: 'content',
      delta: msg.delta, // ← Converted to flat string
      index: msg.index,
      timestamp,
    };
    this.callbacks.onContent?.(contentChunk);
    return;
  }

  // Messages API format (from --output-format stream-json)
  if (msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        const contentChunk: ClaudeContentChunk = {
          type: 'content',
          delta: block.text, // ← LOST STRUCTURE: tool_use blocks ignored
          index: msg.index,
          timestamp,
        };
        this.callbacks.onContent?.(contentChunk);
      } else if (block.type === 'tool_use' && block.id && block.name) {
        // ← Emitted as separate TOOL_START event (causes duplication)
        const toolEvent: ClaudeToolEvent = {
          type: 'start',
          toolCallId: block.id,
          tool: block.name,
          args: (block.input as Record<string, unknown>) || {},
          timestamp,
        };
        this.callbacks.onTool?.(toolEvent);
      }
    }
  }
}
```

**Problem Identified**: Parser splits tool_use blocks into separate events instead of preserving message structure.

#### Pattern 3: Current Event Flow (Duplication Issue)

**Evidence**: task-tracking/TASK_2025_008/DUPLICATION_AND_SIDE_EFFECTS.md:311-323

```
Root Cause: TWO SEPARATE EVENT PUBLISHERS emitting MESSAGE_CHUNK

1. ClaudeDomainEventPublisher.publishContentChunk() (line 126-127)
2. MessageHandlerService streaming loop (line 212)

Result: Same chunk content published TWICE
```

**Analysis**: Event splitting pattern creates duplicate subscriptions and handlers.

---

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Structured Content Blocks Pattern
**Rationale**:

- Matches Claude API Messages format (content blocks array)
- Preserves structured data from CLI parser (no information loss)
- Eliminates need for event splitting (single message = single event)
- Aligns with frontend rendering patterns (blocks map to UI components)

**Evidence**: JSONLAssistantMessage already provides structured content (libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:33-53)

```typescript
export interface JSONLAssistantMessage {
  readonly type: 'assistant';
  readonly delta?: string;
  readonly content?: string;
  readonly thinking?: string;
  readonly message?: {
    readonly content?: Array<{
      // ← STRUCTURED DATA FROM CLI
      readonly type: 'text' | 'tool_use';
      readonly text?: string;
      readonly id?: string;
      readonly name?: string;
      readonly input?: Record<string, unknown>;
    }>;
  };
}
```

### Component Specifications

---

#### Component 1: Shared Types - ContentBlocks Type Definition

**Purpose**: Define structured content blocks to replace flat string content
**Pattern**: Branded types, readonly contracts, discriminated unions
**Evidence**: libs/shared/src/lib/types/branded.types.ts (SessionId, MessageId patterns)

**Responsibilities**:

- Define ContentBlock discriminated union (text, tool_use, thinking types)
- Update StrictChatMessage to use contentBlocks array
- Update ChatMessageChunkPayload to support structured chunks
- Provide Zod schemas for runtime validation

**Implementation Pattern**:

```typescript
// Pattern source: libs/shared/src/lib/types/message.types.ts:810-834
// Verified imports from: libs/shared/src/lib/types/branded.types.ts:1-50

// NEW: ContentBlock discriminated union
export type ContentBlock = TextContentBlock | ToolUseContentBlock | ThinkingContentBlock;

export interface TextContentBlock {
  readonly type: 'text';
  readonly text: string;
  readonly index?: number;
}

export interface ToolUseContentBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly index?: number;
}

export interface ThinkingContentBlock {
  readonly type: 'thinking';
  readonly thinking: string;
  readonly index?: number;
}

// UPDATED: StrictChatMessage (replace content: string)
export interface StrictChatMessage {
  readonly id: MessageId;
  readonly sessionId: SessionId;
  readonly type: 'user' | 'assistant' | 'system';
  readonly contentBlocks: readonly ContentBlock[]; // ← NEW: Structured content
  readonly timestamp: number;
  readonly streaming?: boolean;
  readonly files?: readonly string[];
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly isComplete?: boolean;
  readonly level?: 'info' | 'warning' | 'error';
  readonly cost?: number;
  readonly tokens?: {
    readonly input: number;
    readonly output: number;
    readonly cacheHit?: number;
  };
  readonly duration?: number;
}

// UPDATED: ChatMessageChunkPayload (replace content: string)
export interface ChatMessageChunkPayload {
  readonly sessionId: SessionId;
  readonly messageId: MessageId;
  readonly contentBlocks: readonly ContentBlock[]; // ← NEW: Chunk as structured blocks
  readonly isComplete: boolean;
  readonly streaming: boolean;
}

// NEW: Zod schemas for validation
export const TextContentBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    index: z.number().optional(),
  })
  .strict();

export const ToolUseContentBlockSchema = z
  .object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
    index: z.number().optional(),
  })
  .strict();

export const ThinkingContentBlockSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    index: z.number().optional(),
  })
  .strict();

export const ContentBlockSchema = z.discriminatedUnion('type', [TextContentBlockSchema, ToolUseContentBlockSchema, ThinkingContentBlockSchema]);

export const StrictChatMessageSchema = z
  .object({
    id: MessageIdSchema,
    sessionId: SessionIdSchema,
    type: z.enum(['user', 'assistant', 'system']),
    contentBlocks: z.array(ContentBlockSchema), // ← NEW: Array validation
    timestamp: z.number(),
    streaming: z.boolean().optional(),
    files: z.array(z.string()).optional(),
    isError: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    isComplete: z.boolean().optional(),
    level: z.enum(['info', 'warning', 'error']).optional(),
    cost: z.number().optional(),
    tokens: z
      .object({
        input: z.number(),
        output: z.number(),
        cacheHit: z.number().optional(),
      })
      .optional(),
    duration: z.number().optional(),
  })
  .strict();
```

**Quality Requirements**:

- **Type Safety**: Zero `any` types, branded IDs preserved
- **Immutability**: All properties readonly
- **Validation**: Zod schemas for runtime validation
- **Documentation**: JSDoc comments for all exports

**Pattern Compliance**:

- Must follow branded types pattern (libs/shared/src/lib/types/branded.types.ts)
- Must use discriminated unions for type safety
- Must provide readonly contracts

**Files Affected**:

- `libs/shared/src/lib/types/message.types.ts` (MODIFY - update StrictChatMessage, ChatMessageChunkPayload)
- `libs/shared/src/lib/types/claude-domain.types.ts` (MODIFY - verify ClaudeContentChunk compatibility)

---

#### Component 2: Backend Parser - Structure Preservation Strategy

**Purpose**: Preserve message structure from CLI output (no content splitting)
**Pattern**: Event-driven parsing with callbacks
**Evidence**: libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:178-801

**Responsibilities**:

- Parse JSONL assistant messages into ContentBlock arrays
- Emit single MESSAGE_CHUNK event with all blocks (no splitting)
- Remove duplicate tool_use event emission logic
- Preserve thinking, text, and tool_use blocks in original order

**Implementation Pattern**:

```typescript
// Pattern source: libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:301-372
// Verified callbacks: JSONLParserCallbacks interface (lines 152-164)

// UPDATED: ClaudeContentChunk type (align with shared types)
import { ContentBlock } from '@ptah-extension/shared';

export interface ClaudeContentChunk {
  readonly type: 'content';
  readonly blocks: readonly ContentBlock[]; // ← NEW: Structured blocks
  readonly index?: number;
  readonly timestamp: number;
}

// UPDATED: handleAssistantMessage (preserve structure)
private handleAssistantMessage(msg: JSONLAssistantMessage): void {
  const timestamp = Date.now();
  const blocks: ContentBlock[] = [];

  // Check for agent activity correlation via parent_tool_use_id
  if (msg.parent_tool_use_id) {
    this.correlateAgentActivity(msg.parent_tool_use_id, msg);
  }

  // Thinking content
  if (msg.thinking) {
    blocks.push({
      type: 'thinking',
      thinking: msg.thinking,
      index: msg.index,
    });
  }

  // Streaming content delta (simple text)
  if (msg.delta) {
    blocks.push({
      type: 'text',
      text: msg.delta,
      index: msg.index,
    });
  }

  // Full content (non-streaming, simple text)
  if (msg.content) {
    blocks.push({
      type: 'text',
      text: msg.content,
      index: msg.index,
    });
  }

  // Messages API format (from --output-format stream-json)
  // Extract text content and tool_use blocks from nested message.content array
  if (msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        blocks.push({
          type: 'text',
          text: block.text,
          index: msg.index,
        });
      } else if (block.type === 'tool_use' && block.id && block.name) {
        // PRESERVE STRUCTURE: Keep tool_use in contentBlocks
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) || {},
          index: msg.index,
        });
      }
    }
  }

  // Emit single content chunk with all blocks
  if (blocks.length > 0) {
    const contentChunk: ClaudeContentChunk = {
      type: 'content',
      blocks,
      index: msg.index,
      timestamp,
    };
    this.callbacks.onContent?.(contentChunk);
  }
}

// REMOVE: Separate tool event emission from handleAssistantMessage
// Tool events will now come ONLY from handleToolMessage (tool execution results)
```

**Quality Requirements**:

- **No Data Loss**: All blocks from CLI preserved in order
- **No Splitting**: Single assistant message = single content chunk event
- **Backward Compatibility**: Tool execution events (start/progress/result) remain separate
- **Performance**: Stream processing maintains backpressure handling

**Pattern Compliance**:

- Must follow callback pattern (JSONLParserCallbacks interface)
- Must preserve CLI output order (text, thinking, tool_use blocks)
- Must not duplicate events (eliminate double publication)

**Files Affected**:

- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` (MODIFY - lines 301-372)
- `libs/shared/src/lib/types/claude-domain.types.ts` (MODIFY - update ClaudeContentChunk interface)

---

#### Component 3: Event System - Elimination of Splitting Logic

**Purpose**: Eliminate duplicate event publishers for MESSAGE_CHUNK
**Pattern**: Single source of truth (single publisher per event type)
**Evidence**: task-tracking/TASK_2025_008/DUPLICATION_AND_SIDE_EFFECTS.md:110-192

**Responsibilities**:

- Remove duplicate MESSAGE_CHUNK publication from MessageHandlerService
- Keep ClaudeDomainEventPublisher as sole publisher for CLI events
- Update event payload to use contentBlocks instead of string content
- Remove frontend event splitting logic (ChatService)

**Implementation Pattern**:

```typescript
// Pattern source: libs/backend/claude-domain/src/events/claude-domain.events.ts:116-127
// Verified: ClaudeDomainEventPublisher is SOLE PUBLISHER for CLI events

// UPDATED: publishContentChunk method signature
import { ContentBlock, SessionId, MessageId } from '@ptah-extension/shared';

publishContentChunk(
  sessionId: SessionId,
  messageId: MessageId,
  blocks: readonly ContentBlock[], // ← NEW: Structured blocks
  isComplete: boolean
): void {
  this.eventBus.publish<ClaudeContentChunkEvent>(
    CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
    {
      sessionId,
      messageId,
      contentBlocks: blocks, // ← NEW: Structured payload
      isComplete,
      streaming: !isComplete
    }
  );
}

// REMOVE: MessageHandlerService duplicate publish (line 212)
// DELETE THIS CODE BLOCK:
// this.eventBus.publish(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK, {
//   sessionId: result.sessionId,
//   messageId: assistantMessageId,
//   content: chunk.toString(), // ← DUPLICATE EVENT
//   isComplete: false,
//   streaming: true
// });

// REASON: ClaudeDomainEventPublisher already publishes MESSAGE_CHUNK
// from JSONLStreamParser callbacks. MessageHandlerService should NOT
// re-publish the same data.
```

**Quality Requirements**:

- **Single Publisher**: Only ClaudeDomainEventPublisher emits MESSAGE_CHUNK
- **No Duplication**: MESSAGE_CHUNK event emitted exactly once per chunk
- **Event Consistency**: All MESSAGE_CHUNK events have same payload structure

**Pattern Compliance**:

- Must follow single publisher pattern (evidence: DUPLICATION_AND_SIDE_EFFECTS.md:110-192)
- Must preserve event ordering (parser callbacks → event bus → frontend)
- Must maintain streaming backpressure (existing pattern)

**Files Affected**:

- `libs/backend/claude-domain/src/events/claude-domain.events.ts` (MODIFY - line 126)
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (MODIFY - remove line 212)

---

#### Component 4: Frontend Services - ContentBlocks State Management

**Purpose**: Update frontend services to handle structured contentBlocks
**Pattern**: Signal-based reactivity with computed signals
**Evidence**: libs/frontend/core/src/lib/services/chat.service.ts

**Responsibilities**:

- Update ChatService MESSAGE_CHUNK handler to process contentBlocks
- Update ChatStateService to store messages with contentBlocks
- Update message transformation logic (ClaudeMessageTransformerService)
- Remove frontend event splitting logic (currently handles string content)

**Implementation Pattern**:

```typescript
// Pattern source: libs/frontend/core/src/lib/services/chat.service.ts:429-510
// Verified: Signal-based reactivity, takeUntilDestroyed pattern

// UPDATED: MESSAGE_CHUNK subscription handler
import { ContentBlock, StrictChatMessage } from '@ptah-extension/shared';

this.vscode
  .onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    // Mark as connected when we receive events
    this._streamState.update((state) => ({ ...state, isConnected: true }));

    const { messageId, sessionId, contentBlocks, isComplete } = payload;

    // Update or create message with structured content blocks
    this.chatState.addOrUpdateMessage(sessionId, {
      id: messageId,
      sessionId,
      type: 'assistant',
      contentBlocks, // ← NEW: Structured blocks (no splitting)
      timestamp: Date.now(),
      streaming: !isComplete,
      isComplete,
    });

    // Update streaming state
    if (isComplete) {
      this._streamState.update((state) => ({
        ...state,
        isStreaming: false,
        lastMessageTimestamp: Date.now(),
      }));
    }
  });

// REMOVE: String concatenation logic (no longer needed)
// OLD CODE (delete):
// const currentMessage = this.chatState.getMessage(messageId);
// const newContent = currentMessage ? currentMessage.content + payload.content : payload.content;
// this.chatState.addOrUpdateMessage(sessionId, {
//   ...currentMessage,
//   content: newContent, // ← OLD: String concatenation
// });

// UPDATED: ClaudeMessageTransformerService (transform contentBlocks)
transform(message: StrictChatMessage): ClaudeMessage {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.type,
    contentBlocks: message.contentBlocks, // ← NEW: Pass through structured blocks
    timestamp: message.timestamp,
    streaming: message.streaming,
    isComplete: message.isComplete,
    metadata: message.metadata,
  };
}
```

**Quality Requirements**:

- **Signal Reactivity**: All state updates trigger computed signal propagation
- **No Duplication**: MESSAGE_CHUNK handler updates message exactly once
- **Type Safety**: All transformations preserve branded types (MessageId, SessionId)

**Pattern Compliance**:

- Must follow signal-based state pattern (libs/frontend/core/CLAUDE.md)
- Must use takeUntilDestroyed for subscription cleanup
- Must preserve immutability (readonly properties)

**Files Affected**:

- `libs/frontend/core/src/lib/services/chat.service.ts` (MODIFY - lines 429-510)
- `libs/frontend/core/src/lib/services/chat-state.service.ts` (MODIFY - message storage)
- `libs/frontend/core/src/lib/services/claude-message-transformer.service.ts` (MODIFY - transform logic)

---

#### Component 5: Frontend UI - ContentBlocks Rendering

**Purpose**: Render structured contentBlocks in UI components
**Pattern**: Signal inputs, OnPush change detection, control flow (@if/@for)
**Evidence**: libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts

**Responsibilities**:

- Update ChatMessageContentComponent to render contentBlocks array
- Create sub-components for each block type (text, tool_use, thinking)
- Apply existing rendering logic (markdown, syntax highlighting, tool displays)
- Preserve accessibility (WCAG 2.1 AA, keyboard navigation)

**Implementation Pattern**:

```typescript
// Pattern source: libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts
// Verified: Signal inputs, OnPush, @if/@for control flow (Angular 20 patterns)

// UPDATED: Component interface
import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { ContentBlock } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-chat-message-content',
  standalone: true,
  imports: [CommonModule, MarkdownComponent, TextBlockComponent, ToolUseBlockComponent, ThinkingBlockComponent],
  templateUrl: './chat-message-content.component.html',
  styleUrls: ['./chat-message-content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatMessageContentComponent {
  // NEW: Signal input for contentBlocks array
  readonly contentBlocks = input.required<readonly ContentBlock[]>();
  readonly streaming = input<boolean>(false);
}

// UPDATED: Template (use @for to render blocks)
// <ng-container>
//   @for (block of contentBlocks(); track block.index ?? $index) {
//     @if (block.type === 'text') {
//       <ptah-text-block [text]="block.text" [streaming]="streaming()" />
//     } @else if (block.type === 'tool_use') {
//       <ptah-tool-use-block
//         [toolName]="block.name"
//         [toolInput]="block.input"
//       />
//     } @else if (block.type === 'thinking') {
//       <ptah-thinking-block [thinking]="block.thinking" />
//     }
//   }
// </ng-container>

// NEW: TextBlockComponent (presentational)
@Component({
  selector: 'ptah-text-block',
  standalone: true,
  imports: [MarkdownComponent],
  template: `
    <div class="text-content-block">
      <ptah-markdown [content]="text()" [streaming]="streaming()" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextBlockComponent {
  readonly text = input.required<string>();
  readonly streaming = input<boolean>(false);
}

// NEW: ToolUseBlockComponent (presentational)
@Component({
  selector: 'ptah-tool-use-block',
  standalone: true,
  template: `
    <div class="tool-use-block">
      <div class="tool-header">
        <lucide-icon name="tool" size="16" />
        <span class="tool-name">{{ toolName() }}</span>
      </div>
      <div class="tool-input">
        <pre><code>{{ toolInputJson() }}</code></pre>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolUseBlockComponent {
  readonly toolName = input.required<string>();
  readonly toolInput = input.required<Record<string, unknown>>();

  readonly toolInputJson = computed(() => JSON.stringify(this.toolInput(), null, 2));
}

// NEW: ThinkingBlockComponent (presentational)
@Component({
  selector: 'ptah-thinking-block',
  standalone: true,
  template: `
    <div class="thinking-block">
      <div class="thinking-header">
        <lucide-icon name="brain" size="16" />
        <span>Thinking...</span>
      </div>
      <div class="thinking-content">
        {{ thinking() }}
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThinkingBlockComponent {
  readonly thinking = input.required<string>();
}
```

**Quality Requirements**:

- **Signal Inputs**: All component inputs use signal-based APIs
- **OnPush Detection**: All components use OnPush change detection
- **Accessibility**: ARIA labels, keyboard navigation, WCAG 2.1 AA contrast
- **Type Safety**: All props strictly typed with ContentBlock types

**Pattern Compliance**:

- Must follow TASK_2025_004 patterns (signal inputs, OnPush, @if/@for)
- Must use VS Code CSS variables for theming
- Must use lucide-angular icons (16px × 16px)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts` (MODIFY)
- `libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.html` (MODIFY)
- `libs/frontend/chat/src/lib/components/text-block/text-block.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/tool-use-block/tool-use-block.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/thinking-block/thinking-block.component.ts` (CREATE)

---

## 🔗 Integration Architecture

### Integration Points

**Integration 1: Shared Types → Backend Parser**

- **Pattern**: Import ContentBlock types, use in ClaudeContentChunk interface
- **Evidence**: libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:6-14 (imports from @ptah-extension/shared)

**Integration 2: Backend Parser → Event Publisher**

- **Pattern**: Callback-based event emission (onContent → publishContentChunk)
- **Evidence**: libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:18-19 (JSONLParserCallbacks, ClaudeDomainEventPublisher)

**Integration 3: Event Publisher → Frontend Services**

- **Pattern**: EventBus publish/subscribe with VSCodeService IPC bridge
- **Evidence**: libs/frontend/core/src/lib/services/chat.service.ts:429-510 (MESSAGE_CHUNK subscription)

**Integration 4: Frontend Services → UI Components**

- **Pattern**: Signal-based props propagation (ChatService → ChatComponent → ChatMessageContentComponent)
- **Evidence**: libs/frontend/chat/src/lib/containers/chat/chat.component.ts (signal consumption)

### Data Flow

```
CLI JSONL Output (structured content)
  ↓
JSONLStreamParser.handleAssistantMessage()
  → Creates ContentBlock[] from msg.message.content
  ↓
ClaudeDomainEventPublisher.publishContentChunk()
  → Emits MESSAGE_CHUNK event with contentBlocks
  ↓
EventBus.publish('chat:messageChunk', { contentBlocks })
  ↓
WebviewMessageBridge (forwards to webview)
  ↓
VSCodeService.onMessageType('chat:messageChunk')
  ↓
ChatService.subscribe(MESSAGE_CHUNK)
  → Updates ChatStateService with contentBlocks
  ↓
ChatStateService.addOrUpdateMessage()
  → Signal update triggers computed propagation
  ↓
ChatComponent.messages() signal
  ↓
ChatMessageContentComponent.contentBlocks() input
  → Renders blocks using @for loop
  ↓
UI Components (TextBlock, ToolUseBlock, ThinkingBlock)
```

### Dependencies

**External Dependencies**: None (all patterns use existing workspace libraries)

**Internal Dependencies**:

- `@ptah-extension/shared`: ContentBlock types (NEW)
- `@ptah-extension/vscode-core`: EventBus, DI tokens (existing)
- `@ptah-extension/claude-domain`: Parser, event publisher (modified)
- `@ptah-extension/core`: ChatService, ChatStateService (modified)
- `@ptah-extension/chat`: ChatMessageContentComponent (modified)

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

- **Structure Preservation**: All content blocks from CLI preserved in original order
- **No Data Loss**: Text, thinking, tool_use blocks all retained
- **Single Event**: One MESSAGE_CHUNK event per assistant message (no splitting)
- **UI Rendering**: All block types rendered with appropriate UI components
- **Streaming Support**: Partial contentBlocks arrays supported during streaming

### Non-Functional Requirements

- **Performance**: No additional memory overhead (replace string concatenation with block arrays)
- **Type Safety**: Zero `any` types, all ContentBlock types validated
- **Testability**: All components unit testable in isolation
- **Maintainability**: Clear separation of concerns (parser → events → services → UI)

### Pattern Compliance

**Shared Types**:

- Branded types pattern (SessionId, MessageId)
- Readonly contracts (all properties readonly)
- Discriminated unions (ContentBlock type guards)
- Zod schemas (runtime validation)

**Backend Parser**:

- Callback-based events (JSONLParserCallbacks interface)
- Stream processing (backpressure handling)
- Single responsibility (parsing only, no business logic)

**Event System**:

- Single publisher per event type (ClaudeDomainEventPublisher)
- EventBus publish/subscribe pattern
- No duplicate publishers (MessageHandlerService removal)

**Frontend Services**:

- Signal-based reactivity (ChatService, ChatStateService)
- DestroyRef cleanup (takeUntilDestroyed pattern)
- Computed signals for derived state

**Frontend UI**:

- Signal inputs/outputs (Angular 20 patterns)
- OnPush change detection
- @if/@for control flow (no *ngIf/*ngFor)
- VS Code theming (CSS variables)
- WCAG 2.1 AA accessibility

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: `senior-developer`

**Rationale**:

- **Full-Stack Refactoring**: Changes span all 4 layers (shared types → backend parser → frontend services → UI)
- **Type System Expertise**: Requires understanding of branded types, discriminated unions, Zod schemas
- **Event System Knowledge**: Must understand EventBus architecture and publisher/subscriber patterns
- **Angular 20 Proficiency**: Requires signal-based reactivity, OnPush detection, control flow
- **Architectural Awareness**: Must understand data flow across 4 libraries without breaking integrations

**Skills Required**:

- TypeScript strict mode (branded types, discriminated unions)
- Node.js streams (JSONL parsing, backpressure)
- Angular 20 (signals, OnPush, standalone components, control flow)
- Event-driven architecture (publish/subscribe patterns)
- VS Code extension development (EventBus, webview IPC)

---

### Complexity Assessment

**Overall Complexity**: HIGH
**Estimated Total Effort**: 12-16 hours

**Breakdown by Component**:

- **Component 1 (Shared Types)**: 2-3 hours (types + Zod schemas + tests)
- **Component 2 (Backend Parser)**: 3-4 hours (parser refactoring + event updates)
- **Component 3 (Event System)**: 1-2 hours (remove duplicate publisher)
- **Component 4 (Frontend Services)**: 3-4 hours (ChatService + ChatStateService + transformers)
- **Component 5 (Frontend UI)**: 3-4 hours (component updates + new block components)

**Risks**:

- **Integration Breakage**: Changes to message structure could break existing integrations (mitigate: comprehensive testing)
- **Streaming Regression**: Partial contentBlocks handling during streaming (mitigate: test with real CLI streaming)
- **Event Ordering**: contentBlocks must preserve CLI order (mitigate: verify parser block ordering logic)

---

### Files Affected Summary

**CREATE (3 files)**:

- `libs/frontend/chat/src/lib/components/text-block/text-block.component.ts`
- `libs/frontend/chat/src/lib/components/tool-use-block/tool-use-block.component.ts`
- `libs/frontend/chat/src/lib/components/thinking-block/thinking-block.component.ts`

**MODIFY (8 files)**:

- `libs/shared/src/lib/types/message.types.ts` (ContentBlock types, StrictChatMessage)
- `libs/shared/src/lib/types/claude-domain.types.ts` (ClaudeContentChunk interface)
- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` (handleAssistantMessage logic)
- `libs/backend/claude-domain/src/events/claude-domain.events.ts` (publishContentChunk signature)
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (remove duplicate publish)
- `libs/frontend/core/src/lib/services/chat.service.ts` (MESSAGE_CHUNK handler)
- `libs/frontend/core/src/lib/services/chat-state.service.ts` (message storage)
- `libs/frontend/core/src/lib/services/claude-message-transformer.service.ts` (transform logic)
- `libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts` (render contentBlocks)
- `libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.html` (template @for blocks)

---

### Critical Verification Points

**Before implementation, team-leader MUST ensure developer verifies**:

1. **All imports exist in codebase**:

   - `ContentBlock` type from `@ptah-extension/shared` (NEW - will be created)
   - `StrictChatMessage` from `@ptah-extension/shared` (EXISTING - libs/shared/src/lib/types/message.types.ts:810)
   - `ClaudeContentChunk` from `@ptah-extension/shared` (EXISTING - libs/shared/src/lib/types/claude-domain.types.ts:175)
   - `JSONLParserCallbacks` from `libs/backend/claude-domain` (EXISTING - jsonl-stream-parser.ts:152)

2. **All patterns verified from examples**:

   - Branded types pattern: `libs/shared/src/lib/types/branded.types.ts:1-50`
   - Signal inputs pattern: `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts`
   - OnPush + @if/@for pattern: `libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts`
   - Event publisher pattern: `libs/backend/claude-domain/src/events/claude-domain.events.ts:116-127`

3. **Library documentation consulted**:

   - `libs/shared/CLAUDE.md` (type system guidelines)
   - `libs/backend/claude-domain/CLAUDE.md` (parser architecture)
   - `libs/frontend/core/CLAUDE.md` (service layer patterns)
   - `libs/frontend/chat/CLAUDE.md` (UI component patterns)

4. **No hallucinated APIs**:
   - All ContentBlock types created based on existing JSONLAssistantMessage structure
   - All component patterns follow TASK_2025_004 established conventions
   - All service methods follow existing ChatService signal-based patterns
   - All event payloads align with existing MessagePayloadMap structure

---

## Architecture Delivery Checklist

- [x] All components specified with evidence (5 components with file:line citations)
- [x] All patterns verified from codebase (branded types, signals, OnPush, events)
- [x] All imports/decorators verified as existing (StrictChatMessage, JSONLParserCallbacks, etc.)
- [x] Quality requirements defined (functional, non-functional, pattern compliance)
- [x] Integration points documented (4 integration points with data flow)
- [x] Files affected list complete (3 CREATE, 10 MODIFY)
- [x] Developer type recommended (senior-developer with full-stack expertise)
- [x] Complexity assessed (12-16 hours, HIGH complexity)
- [x] No step-by-step implementation (architecture specification only)

---

## Appendix: Evidence Index

### Current Architecture Evidence

**String-Based Content**:

- `libs/shared/src/lib/types/message.types.ts:814` - `content: string`
- `libs/shared/src/lib/types/common.types.ts:12` - `content: string` (deprecated)

**Parser Structure Loss**:

- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:301-372` - handleAssistantMessage
- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:359-369` - tool_use blocks split into separate events

**Event Duplication**:

- `libs/backend/claude-domain/src/events/claude-domain.events.ts:126-127` - publishContentChunk (publisher 1)
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts:212` - duplicate publish (publisher 2)
- `task-tracking/TASK_2025_008/DUPLICATION_AND_SIDE_EFFECTS.md:311-323` - root cause analysis

**Frontend String Handling**:

- `libs/frontend/core/src/lib/services/chat.service.ts:429-510` - MESSAGE_CHUNK handler (string concatenation)
- `libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts` - renders string content

### Pattern Evidence

**Branded Types Pattern**:

- `libs/shared/src/lib/types/branded.types.ts:1-50` - SessionId, MessageId, CorrelationId
- `libs/shared/CLAUDE.md:33-43` - Smart constructors, Zod schemas

**Signal-Based Reactivity**:

- `libs/frontend/core/CLAUDE.md:46-50` - Signal-based service pattern
- `libs/frontend/chat/CLAUDE.md:25-30` - Signal inputs/outputs, OnPush detection

**Event Publisher Pattern**:

- `task-tracking/TASK_2025_008/DUPLICATION_AND_SIDE_EFFECTS.md:110-192` - Single publisher analysis
- `libs/backend/claude-domain/src/events/claude-domain.events.ts:116-257` - Event publisher methods

**Parser Callback Pattern**:

- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:152-164` - JSONLParserCallbacks interface
- `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:270-375` - Callback usage

---

## Conclusion

This architecture blueprint eliminates the root causes of message duplication and event splitting identified in TASK_2025_007 and TASK_2025_008. By migrating from string-based content to structured ContentBlocks, the system preserves message structure from CLI output through to UI rendering, eliminating the need for event splitting and duplicate publishers.

The refactoring follows established workspace patterns (branded types, signal-based reactivity, OnPush components, event-driven architecture) and requires no new external dependencies. All proposed APIs are either existing or created based on verified codebase patterns.

Upon completion, the message type system will provide:

- **Zero Data Loss**: All CLI output preserved in original structure
- **Zero Duplication**: Single MESSAGE_CHUNK event per assistant message
- **Type Safety**: Compile-time guarantees for content block types
- **UI Flexibility**: Individual blocks rendered with specialized components

**Architecture Status**: ✅ Complete
**Ready for Team-Leader Decomposition**: YES
**Recommended Next Step**: team-leader (DECOMPOSITION mode → create tasks.md)
