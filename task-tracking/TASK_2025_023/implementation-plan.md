# TASK_2025_023: Revolutionary ExecutionNode Architecture

## Executive Summary

This implementation plan creates the **FIRST VS Code extension capable of displaying nested agent orchestration visually**. Unlike existing Claude Code extensions that show flat chat interfaces, Ptah will render recursive execution trees where agent executions display INSIDE parent messages - just like the CLI terminal, but with rich Angular components.

**Core Innovation**: ExecutionNode recursive data structure that maps 1:1 to Claude CLI JSONL message types, enabling true nested UI rendering with collapsible cards, markdown content, and DaisyUI styling.

---

## Current Status (After Batches 1-3)

### Completed Purge

- ✅ Backend CLI management deleted (InteractiveSessionManager, SessionProcess, MessageQueue)
- ✅ Frontend services simplified (ChatStoreService, ChatStateManagerService, ChatService)
- ✅ Frontend components deleted (agent-tree, thinking-display, tool-timeline, message components, session components)
- ✅ Build passes: Bundle reduced from 779 KB → **583 KB** (-25%)

### Preserved Components (Feature Required)

- FileTagComponent - File attachment display
- FileSuggestionsDropdownComponent - @ syntax autocomplete
- UnifiedSuggestionsDropdownComponent - Combined suggestions

### Preserved Services (Clean Architecture)

- **ChatStateService** - Contains JSONL → ProcessedClaudeMessage conversion (will adapt for ExecutionNode)
- **FilePickerService** - Used by suggestion components
- **ClaudeCliDetector** - Detects Claude CLI installation
- **JsonlSessionParser** - Parses .jsonl session files

---

## Architecture Vision

### The Problem We're Solving

Current VS Code extensions for Claude Code display:

- Flat message lists (user → assistant → user → assistant)
- No visibility into nested agent execution
- No collapsible tool results
- No recursive component rendering

### Our Solution: ExecutionNode Tree

```
UserMessage
└── AssistantMessage
    ├── TextContent: "Let me help you with that"
    ├── ThinkingBlock: [collapsible] "Analyzing the codebase..."
    └── AgentExecution: [collapsible card]
        ├── AgentHeader: "software-architect"
        ├── ToolCall: "Read" → [collapsible result]
        ├── ToolCall: "Grep" → [collapsible result]
        └── AgentExecution: [nested!]
            ├── AgentHeader: "frontend-developer"
            └── ToolCall: "Write" → [collapsible result]
```

This renders as nested DaisyUI cards - agents INSIDE agents, tools INSIDE agents - exactly like the CLI terminal but with rich interactive components.

---

## BATCH 4: Build New Backend (Simple ClaudeProcess)

### Philosophy

Replace complex state machine with **direct spawn pattern**:

1. Spawn claude CLI process
2. Write prompt to stdin, close stdin
3. Parse stdout JSONL line-by-line
4. Stream to webview via RPC

No message queues. No session managers. No blocking state machines.

### Task 4.1: Create ClaudeProcess Class

**File**: `libs/backend/claude-domain/src/cli/claude-process.ts`

**Responsibilities**:

- Spawn Claude CLI with --output-format stream-json
- Write initial prompt to stdin
- Parse stdout as JSONL stream
- Emit events for each message type
- Handle process lifecycle (kill, error)

**Interface**:

```typescript
class ClaudeProcess {
  constructor(private readonly cliPath: string, private readonly workspacePath: string) {}

  // Start new conversation
  async start(prompt: string, options?: ClaudeProcessOptions): Promise<void>;

  // Continue existing session
  async resume(sessionId: string, prompt: string): Promise<void>;

  // Abort current execution
  kill(): void;

  // Event emitters
  onMessage: (handler: (msg: JSONLMessage) => void) => void;
  onError: (handler: (error: Error) => void) => void;
  onClose: (handler: (code: number) => void) => void;
}
```

**Target**: ~100 lines of code

### Task 4.2: Create Simple RPC Handlers

**File**: `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts`

**Handlers to implement**:

| RPC Method      | Action                                                |
| --------------- | ----------------------------------------------------- |
| `chat:start`    | Spawn ClaudeProcess, stream JSONL to webview          |
| `chat:continue` | Resume session, stream JSONL                          |
| `chat:abort`    | Kill active process                                   |
| `session:list`  | Read ~/.claude/projects/<workspace>/sessions/\*.jsonl |
| `session:load`  | Parse single .jsonl, return ExecutionNode tree        |

**Streaming Pattern**:

```typescript
// Backend sends chunks as they arrive
webview.postMessage({
  type: 'chat:chunk',
  payload: jsonlMessage,
});

// Frontend ChatStore accumulates into ExecutionNode tree
```

### Task 4.3: Update DI Container

**File**: `libs/backend/vscode-core/src/di/container.ts`

- Register ClaudeProcess factory
- Remove references to deleted services
- Ensure ClaudeCliDetector remains available

---

## BATCH 5: Build New Frontend (ExecutionNode Architecture)

### Design System Stack

| Layer             | Technology                | Purpose                                                 |
| ----------------- | ------------------------- | ------------------------------------------------------- |
| CSS Framework     | **Tailwind CSS**          | Utility-first styling                                   |
| Component Library | **DaisyUI**               | Pre-built components (card, collapse, badge, accordion) |
| Markdown          | **ngx-markdown**          | Rich content rendering with syntax highlighting         |
| State             | **Angular Signals**       | Reactive primitives                                     |
| Theming           | **VS Code CSS Variables** | Native integration                                      |

### Task 5.1: Create ExecutionNode Types

**File**: `libs/shared/src/lib/types/execution-node.types.ts`

**Core Data Structure**:

```typescript
/**
 * ExecutionNode - Recursive structure for nested UI rendering
 *
 * Maps 1:1 to Claude CLI JSONL message types:
 * - system → SystemInit node
 * - assistant → Message node with children
 * - tool → ToolCall node (with result as child)
 * - Task tool → AgentExecution node (with nested children)
 */
export type ExecutionNodeType =
  | 'message' // User or assistant message
  | 'agent' // Task tool spawned agent
  | 'tool' // Tool execution (Read, Write, Bash, etc.)
  | 'thinking' // Extended thinking block
  | 'text' // Plain text content
  | 'system'; // System messages (init, result)

export type ExecutionStatus =
  | 'pending' // Waiting to execute
  | 'streaming' // Currently receiving content
  | 'complete' // Successfully finished
  | 'error'; // Failed with error

export interface ExecutionNode {
  readonly id: string;
  readonly type: ExecutionNodeType;
  readonly status: ExecutionStatus;

  // Content (varies by type)
  readonly content: string | null;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly toolOutput?: unknown;

  // Agent-specific
  readonly agentType?: string; // subagent_type from Task tool
  readonly agentModel?: string; // model parameter

  // Metrics
  readonly startTime?: number;
  readonly endTime?: number;
  readonly duration?: number;
  readonly tokenUsage?: {
    readonly input: number;
    readonly output: number;
  };

  // Recursive children
  readonly children: readonly ExecutionNode[];

  // UI state
  readonly isCollapsed: boolean;
  readonly isHighlighted?: boolean;
}

// Helper type for message role
export type MessageRole = 'user' | 'assistant' | 'system';

// Top-level message wrapper
export interface ChatMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly timestamp: number;
  readonly executionTree: ExecutionNode | null; // Root of execution tree
  readonly rawContent?: string; // For user messages
}
```

**JSONL → ExecutionNode Mapping**:

```typescript
// system init → SystemInit node
{ type: 'system', subtype: 'init', session_id: '...' }
  → { type: 'system', content: 'Session initialized', ... }

// assistant with thinking → Message with Thinking child
{ type: 'assistant', thinking: '...' }
  → { type: 'message', children: [{ type: 'thinking', content: '...' }] }

// assistant with tool_use → Message with ToolCall child
{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', ... }] } }
  → { type: 'message', children: [{ type: 'tool', toolName: 'Read', ... }] }

// Task tool start → AgentExecution node (nested container)
{ type: 'tool', subtype: 'start', tool: 'Task', args: { subagent_type: 'frontend-developer' } }
  → { type: 'agent', agentType: 'frontend-developer', children: [] }

// Nested tool (parent_tool_use_id present) → Child of agent node
{ type: 'tool', subtype: 'start', tool: 'Read', parent_tool_use_id: 'agent-123' }
  → Agent node 'agent-123'.children.push({ type: 'tool', toolName: 'Read', ... })
```

### Task 5.2: Build New ChatStore

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Signal Architecture**:

```typescript
@Injectable({ providedIn: 'root' })
export class ChatStore {
  // Core signals
  private readonly _sessions = signal<readonly SessionSummary[]>([]);
  private readonly _currentSessionId = signal<string | null>(null);
  private readonly _messages = signal<readonly ChatMessage[]>([]);
  private readonly _isStreaming = signal(false);

  // Derived signals
  readonly sessions = this._sessions.asReadonly();
  readonly currentSession = computed(() => this._sessions().find((s) => s.id === this._currentSessionId()));
  readonly messages = this._messages.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();

  // Message count
  readonly messageCount = computed(() => this._messages().length);

  // Current execution tree (for streaming)
  private readonly _currentExecutionTree = signal<ExecutionNode | null>(null);
  readonly currentExecutionTree = this._currentExecutionTree.asReadonly();

  // Actions
  async loadSessions(): Promise<void>;
  async switchSession(sessionId: string): Promise<void>;
  async sendMessage(content: string, files?: string[]): Promise<void>;
  async abortCurrentMessage(): Promise<void>;

  // JSONL processing
  processJsonlChunk(chunk: JSONLMessage): void; // Called by RPC handler
}
```

**JSONL Processing Flow**:

```typescript
processJsonlChunk(chunk: JSONLMessage): void {
  switch (chunk.type) {
    case 'system':
      if (chunk.subtype === 'init') {
        // Initialize new message tree
        this.startNewMessage('assistant');
      }
      break;

    case 'assistant':
      // Append content to current message tree
      if (chunk.thinking) {
        this.appendThinking(chunk.thinking);
      }
      if (chunk.delta) {
        this.appendText(chunk.delta);
      }
      if (chunk.message?.content) {
        this.processContentBlocks(chunk.message.content);
      }
      break;

    case 'tool':
      if (chunk.parent_tool_use_id) {
        // Nested under agent - find parent and add as child
        this.appendToAgent(chunk.parent_tool_use_id, chunk);
      } else {
        // Top-level tool - add to current message
        this.appendTool(chunk);
      }
      break;

    case 'result':
      // Finalize message
      this.finalizeCurrentMessage(chunk);
      break;
  }
}
```

### Task 5.3: Build Atom Components

**DaisyUI Theme Integration**:

```css
/* Use VS Code variables with DaisyUI */
:root {
  --primary: var(--vscode-button-background);
  --primary-content: var(--vscode-button-foreground);
  --secondary: var(--vscode-editor-background);
  --accent: var(--vscode-focusBorder);
  --neutral: var(--vscode-panel-background);
  --base-100: var(--vscode-editor-background);
  --base-content: var(--vscode-editor-foreground);
}
```

**Components**:

| Component            | DaisyUI               | Purpose                              |
| -------------------- | --------------------- | ------------------------------------ |
| `MarkdownBlock`      | -                     | Render markdown with ngx-markdown    |
| `StatusBadge`        | `badge`               | Show streaming/complete/error status |
| `TokenBadge`         | `badge badge-outline` | Display token count                  |
| `DurationBadge`      | `badge badge-ghost`   | Show execution duration              |
| `CollapsibleTrigger` | `collapse-title`      | Clickable header for collapse        |

### Task 5.4: Build Molecule Components

| Component       | DaisyUI                               | Purpose                      |
| --------------- | ------------------------------------- | ---------------------------- |
| `ThinkingBlock` | `collapse collapse-arrow`             | Collapsible thinking content |
| `ToolCallItem`  | `collapse collapse-arrow bg-base-200` | Tool with collapsible result |
| `AgentHeader`   | `card-title` + badges                 | Agent type, model, status    |

**ThinkingBlock Example**:

```html
<div class="collapse collapse-arrow bg-base-200">
  <input type="checkbox" [checked]="!node().isCollapsed" />
  <div class="collapse-title text-sm font-medium">
    <span class="badge badge-info badge-sm mr-2">thinking</span>
    Extended Thinking
  </div>
  <div class="collapse-content">
    <markdown [data]="node().content" />
  </div>
</div>
```

### Task 5.5: Build ExecutionNode Component (THE KEY COMPONENT)

**File**: `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts`

**Recursive Template**:

```typescript
@Component({
  selector: 'ptah-execution-node',
  template: `
    @switch (node().type) { @case ('text') {
    <markdown [data]="node().content" class="prose prose-sm" />
    } @case ('thinking') {
    <ptah-thinking-block [node]="node()" />
    } @case ('tool') {
    <ptah-tool-call-item [node]="node()">
      <!-- Nested children (tool results, sub-tools) -->
      @for (child of node().children; track child.id) {
      <ptah-execution-node [node]="child" />
      }
    </ptah-tool-call-item>
    } @case ('agent') {
    <div class="card bg-base-200 shadow-sm ml-4 my-2">
      <div class="card-body p-3">
        <ptah-agent-header [node]="node()" />

        <!-- RECURSIVE: Agent's children (its tool calls, nested agents) -->
        @for (child of node().children; track child.id) {
        <ptah-execution-node [node]="child" />
        }
      </div>
    </div>
    } @case ('message') { @for (child of node().children; track child.id) {
    <ptah-execution-node [node]="child" />
    } } }
  `,
})
export class ExecutionNodeComponent {
  readonly node = input.required<ExecutionNode>();
}
```

**This is the revolutionary component** - it recursively renders any depth of agent nesting, exactly mirroring the CLI terminal's nested output.

### Task 5.6: Build MessageBubble Component

**File**: `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts`

```typescript
@Component({
  selector: 'ptah-message-bubble',
  template: `
    <div class="chat" [class.chat-start]="message().role === 'assistant'" [class.chat-end]="message().role === 'user'">
      <div class="chat-header">
        {{ message().role === 'user' ? 'You' : 'Claude' }}
        <time class="text-xs opacity-50">{{ formatTime(message().timestamp) }}</time>
      </div>

      <div class="chat-bubble" [class.chat-bubble-primary]="message().role === 'user'">
        @if (message().rawContent) {
        <!-- User message: just text -->
        <markdown [data]="message().rawContent" />
        } @else if (message().executionTree) {
        <!-- Assistant message: ExecutionNode tree -->
        <ptah-execution-node [node]="message().executionTree!" />
        }
      </div>
    </div>
  `,
})
export class MessageBubbleComponent {
  readonly message = input.required<ChatMessage>();
}
```

### Task 5.7: Build ChatView Component

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

```typescript
@Component({
  selector: 'ptah-chat-view',
  template: `
    <div class="flex flex-col h-full">
      <!-- Message List -->
      <div class="flex-1 overflow-y-auto p-4 space-y-4" #messageContainer>
        @for (message of chatStore.messages(); track message.id) {
        <ptah-message-bubble [message]="message" />
        }

        <!-- Streaming indicator -->
        @if (chatStore.isStreaming()) {
        <div class="flex items-center gap-2 text-sm text-base-content/60">
          <span class="loading loading-dots loading-sm"></span>
          Claude is responding...
        </div>
        }
      </div>

      <!-- Input Area -->
      <div class="border-t border-base-300 p-4">
        <ptah-chat-input (send)="onSend($event)" [disabled]="chatStore.isStreaming()" />
      </div>
    </div>
  `,
})
export class ChatViewComponent {
  readonly chatStore = inject(ChatStore);
}
```

### Task 5.8: Build AppShell Component

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`

```typescript
@Component({
  selector: 'ptah-app-shell',
  template: `
    <div class="drawer lg:drawer-open">
      <!-- Sidebar Toggle (mobile) -->
      <input id="session-drawer" type="checkbox" class="drawer-toggle" />

      <!-- Main Content -->
      <div class="drawer-content flex flex-col">
        <!-- Header -->
        <div class="navbar bg-base-100 border-b border-base-300">
          <label for="session-drawer" class="btn btn-square btn-ghost lg:hidden">
            <svg><!-- hamburger --></svg>
          </label>
          <div class="flex-1">
            <span class="text-xl font-bold">Ptah</span>
          </div>
        </div>

        <!-- Chat View -->
        <ptah-chat-view class="flex-1" />
      </div>

      <!-- Session Sidebar -->
      <div class="drawer-side">
        <label for="session-drawer" class="drawer-overlay"></label>
        <ul class="menu bg-base-200 w-80 min-h-full">
          <li class="menu-title">Sessions</li>
          @for (session of chatStore.sessions(); track session.id) {
          <li>
            <a [class.active]="session.id === chatStore.currentSession()?.id" (click)="chatStore.switchSession(session.id)">
              {{ session.name }}
              <span class="badge badge-sm">{{ session.messageCount }}</span>
            </a>
          </li>
          }
        </ul>
      </div>
    </div>
  `,
})
export class AppShellComponent {
  readonly chatStore = inject(ChatStore);
}
```

---

## BATCH 6: Integration & Wiring

### Task 6.1: Wire RPC → ChatStore

**WebviewNavigationService or VSCodeService**:

```typescript
// Listen for JSONL chunks from backend
this.vscode.onMessage('chat:chunk', (chunk: JSONLMessage) => {
  this.chatStore.processJsonlChunk(chunk);
});
```

### Task 6.2: Wire ChatStore → Components

**App Component**:

```typescript
@Component({
  selector: 'ptah-root',
  template: `<ptah-app-shell />`,
  imports: [AppShellComponent],
})
export class AppComponent {}
```

### Task 6.3: Test Full Flow

**Test Scenarios**:

1. **Send message** → User bubble appears → Streaming indicator → Assistant bubble with content
2. **Tool execution** → ToolCallItem appears with collapsible result
3. **Agent spawn** → Nested card appears inside message
4. **Nested agent** → Card INSIDE card (recursive nesting works)
5. **Session switch** → Messages reload, execution trees preserved
6. **Abort** → Streaming stops, partial message retained

---

## Execution Summary

| Batch | Status      | Description                        |
| ----- | ----------- | ---------------------------------- |
| 1     | ✅ Complete | Backend CLI management purged      |
| 2     | ✅ Complete | Frontend services simplified       |
| 3     | ✅ Complete | Frontend components deleted        |
| 4     | ⬜ Pending  | Build new backend (ClaudeProcess)  |
| 5     | ⬜ Pending  | Build new frontend (ExecutionNode) |
| 6     | ⬜ Pending  | Integration and testing            |

**Total Progress**: 56% (18/32 tasks complete)

---

## Dependencies

User will install these dependencies:

```bash
# Tailwind CSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# DaisyUI
npm install daisyui

# ngx-markdown (Angular 20 compatible version)
npm install ngx-markdown@19  # Or wait for v20 release
```

---

## Success Criteria

1. **Nested agents render correctly** - Agent cards inside agent cards
2. **Tools are collapsible** - Click to expand/collapse results
3. **Thinking is collapsible** - Extended thinking hidden by default
4. **Streaming works** - Content appears in real-time
5. **Sessions work** - Switch between sessions, see history
6. **Bundle size** - Stay under 600KB budget

---

Document Version: 2.0
Created: 2025-11-25
Updated: 2025-11-25 (Post-purge completion)
