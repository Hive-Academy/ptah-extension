# libs/frontend/chat - Chat UI Components & Services

[Back to Main](../../../CLAUDE.md)

## Purpose

The **chat library** provides the complete chat interface for the Ptah Extension, built using Atomic Design methodology with revolutionary ExecutionNode architecture. It handles message display, input, streaming, session management, and agent execution visualization.

## Key Responsibilities

- **Chat UI Components**: 48+ components organized by Atomic Design (Atoms → Molecules → Organisms → Templates)
- **ExecutionNode Architecture**: Recursive tree visualization of agent spawning and tool calls
- **Message Display**: Streaming text reveal, markdown rendering, code highlighting
- **Chat Input**: Autocomplete (@agent, /command), file attachments, validation
- **Session Management**: Session loading, switching, cost tracking
- **Settings UI**: Authentication config, model selection, autopilot controls
- **State Management**: ChatStore (signal-based) + SessionManager + ExecutionTreeBuilder

## Architecture

```
libs/frontend/chat/src/lib/
├── components/                     # UI Components (Atomic Design)
│   ├── atoms/                      # Basic building blocks
│   │   ├── markdown-block.component.ts
│   │   ├── status-badge.component.ts
│   │   ├── token-badge.component.ts
│   │   ├── cost-badge.component.ts
│   │   ├── duration-badge.component.ts
│   │   ├── streaming-text-reveal.component.ts
│   │   ├── typing-cursor.component.ts
│   │   ├── error-alert.component.ts
│   │   ├── expandable-content.component.ts
│   │   ├── file-path-link.component.ts
│   │   └── tool-icon.component.ts
│   │
│   ├── molecules/                  # Combinations of atoms
│   │   ├── thinking-block.component.ts
│   │   ├── tool-call-header.component.ts
│   │   ├── agent-summary.component.ts
│   │   ├── chat-input.component.ts
│   │   ├── chat-empty-state.component.ts
│   │   ├── session-cost-summary.component.ts
│   │   ├── setup-status-widget.component.ts
│   │   ├── agent-selector.component.ts
│   │   ├── model-selector.component.ts
│   │   ├── autopilot-popover.component.ts
│   │   ├── confirmation-dialog.component.ts
│   │   ├── code-output.component.ts
│   │   ├── permission-request-card.component.ts
│   │   ├── tab-item.component.ts
│   │   └── todo-list-display.component.ts
│   │
│   ├── organisms/                  # Complex sections
│   │   ├── execution-node.component.ts      # RECURSIVE tree visualization
│   │   ├── inline-agent-bubble.component.ts
│   │   ├── agent-execution.component.ts
│   │   └── message-bubble.component.ts
│   │
│   ├── templates/                  # Page layouts
│   │   ├── chat-view.component.ts
│   │   └── app-shell.component.ts
│   │
│   └── file-suggestions/           # Autocomplete components
│       ├── file-tag.component.ts
│       ├── suggestion-option.component.ts
│       └── unified-suggestions-dropdown.component.ts
│
├── services/                       # Chat-specific services
│   ├── chat.store.ts               # Signal-based reactive store
│   ├── session-manager.service.ts  # Session lifecycle management
│   ├── tree-builder.service.ts     # Immutable ExecutionNode tree construction
│   ├── file-picker.service.ts      # File attachment logic
│   ├── message-sender.service.ts   # Centralized message sending mediator
│   ├── message-validation.service.ts # Message validation logic
│   ├── pending-session-manager.service.ts # Pending session resolution
│   └── confirmation-dialog.service.ts # Custom confirmation dialogs
│
├── settings/                       # Settings UI components
│   ├── settings.component.ts
│   └── auth-config.component.ts
│
└── directives/                     # Custom directives
    └── code-highlight.directive.ts
```

## Critical Design Decisions

### 1. Atomic Design Hierarchy

**All components organized by complexity level:**

- **Atoms**: Basic UI elements (badges, icons, markdown)
- **Molecules**: Combinations of atoms (thinking block, tool call header)
- **Organisms**: Complex sections (ExecutionNode, message bubble)
- **Templates**: Full page layouts (ChatView, AppShell)

**Benefits**:

- Clear component hierarchy
- Easy to find components
- Encourages composition over duplication
- Scales to large UI libraries

### 2. ExecutionNode Architecture (TASK_2025_023)

**Revolutionary recursive tree visualization of agent execution.**

```typescript
export interface ExecutionNode {
  id: string;
  type: 'message' | 'thinking' | 'tool-call' | 'tool-result' | 'agent-spawn';
  content: string;
  agentName?: string;
  timestamp: number;
  children: ExecutionNode[]; // Recursive!
  metadata?: {
    toolName?: string;
    cost?: number;
    duration?: number;
  };
}

// ExecutionNodeComponent renders recursively
@Component({
  selector: 'ptah-execution-node',
  template: `
    <div class="execution-node" [class.nested]="depth > 0">
      <!-- Current node content -->
      <div class="node-content">
        @if (node.type === 'thinking') {
        <ptah-thinking-block [content]="node.content" />
        } @if (node.type === 'tool-call') {
        <ptah-tool-call-header [toolName]="node.metadata?.toolName" />
        <ptah-code-output [content]="node.content" />
        } @if (node.type === 'agent-spawn') {
        <ptah-inline-agent-bubble [agentName]="node.agentName" />
        }
      </div>

      <!-- RECURSIVE: Render children -->
      @for (child of node.children; track child.id) {
      <ptah-execution-node [node]="child" [depth]="depth + 1" />
      }
    </div>
  `,
})
export class ExecutionNodeComponent {
  readonly node = input.required<ExecutionNode>();
  readonly depth = input<number>(0);
}
```

**Tree Example**:

```
User Message: "Create a login page"
└─ Main Agent (software-architect) THINKING
   ├─ TOOL: read-file ("src/app/app.component.ts")
   │  └─ RESULT: "import { Component } from '@angular/core'..."
   ├─ AGENT SPAWN: frontend-developer
   │  ├─ THINKING: "I'll create LoginComponent..."
   │  ├─ TOOL: write-file ("src/app/login/login.component.ts")
   │  │  └─ RESULT: "File created successfully"
   │  └─ TOOL: write-file ("src/app/login/login.component.html")
   │     └─ RESULT: "File created successfully"
   └─ Main Agent RESPONSE: "Login page created with authentication..."
```

**Benefits**:

- Visual clarity of agent orchestration
- Clear parent-child relationships
- Infinite nesting support
- Performance optimized (ChangeDetectionStrategy.OnPush)

### 3. ChatStore: Signal-Based Reactive State (TASK_2025_023)

**Immutable state management with Angular signals.**

```typescript
export interface ChatStoreState {
  messages: readonly ChatMessage[];
  executionNodes: readonly ExecutionNode[];
  sessions: ReadonlyMap<SessionId, Session>;
  activeSessionId: SessionId | null;
  streamingNodeId: string | null;
  isLoading: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatStore {
  // Private mutable state
  private readonly _state = signal<ChatStoreState>(INITIAL_STATE);

  // Public readonly signals
  readonly state = this._state.asReadonly();

  // Computed signals (derived state)
  readonly activeSession = computed(() => {
    const sessionId = this._state().activeSessionId;
    return sessionId ? this._state().sessions.get(sessionId) : null;
  });

  readonly isStreaming = computed(() => this._state().streamingNodeId !== null);

  readonly totalCost = computed(() => {
    const session = this.activeSession();
    return session?.messages.reduce((sum, msg) => sum + (msg.cost || 0), 0) || 0;
  });

  // Immutable state updates
  addMessage(message: ChatMessage): void {
    this._state.update((state) => ({
      ...state,
      messages: [...state.messages, message],
    }));
  }

  updateStreamingNode(nodeId: string, deltaContent: string): void {
    this._state.update((state) => ({
      ...state,
      executionNodes: updateNodeImmutably(state.executionNodes, nodeId, deltaContent),
    }));
  }
}
```

**Key Principles**:

- ✅ All state updates are immutable (new arrays/objects)
- ✅ Computed signals for derived state (no manual updates)
- ✅ Single source of truth
- ❌ NO BehaviorSubject (use signals!)
- ❌ NO manual change detection (signals handle it)

### 4. SessionManager: Lifecycle Orchestration (TASK_2025_023 Phase 4)

**Manages session loading, switching, and node map caching.**

```typescript
@Injectable({ providedIn: 'root' })
export class SessionManager {
  private readonly chatStore = inject(ChatStore);
  private readonly vscode = inject(VSCodeService);

  // Load session from extension
  async loadSession(sessionId: SessionId): Promise<SessionLoadResult> {
    const result = await this.vscode.rpc.callExtension<LoadSessionRequest, Session>('load-session', { sessionId });

    if (result.success) {
      // Build ExecutionNode tree from messages
      const nodes = this.treeBuilder.buildTree(result.data.messages);

      // Update ChatStore
      this.chatStore.setActiveSession(sessionId, result.data, nodes);

      return { success: true, session: result.data };
    }

    return { success: false, error: result.error };
  }

  // Switch between sessions (instant with cached node maps)
  async switchSession(sessionId: SessionId): Promise<void> {
    const cachedSession = this.chatStore.getSession(sessionId);

    if (cachedSession) {
      // Instant switch (no RPC call)
      this.chatStore.setActiveSession(sessionId, cachedSession.session, cachedSession.nodes);
    } else {
      // Load from extension
      await this.loadSession(sessionId);
    }
  }
}
```

### 5. ExecutionTreeBuilder: Immutable Tree Construction (TASK_2025_023 Phase 2)

**Builds ExecutionNode trees from flat message arrays.**

```typescript
@Injectable({ providedIn: 'root' })
export class ExecutionTreeBuilder {
  buildTree(messages: ChatMessage[]): ExecutionNode[] {
    const rootNodes: ExecutionNode[] = [];
    const nodeStack: ExecutionNode[] = [];

    for (const message of messages) {
      const node = this.messageToNode(message);

      if (message.type === 'agent-spawn') {
        // Push to stack, all subsequent nodes are children until agent-end
        nodeStack.push(node);
      } else if (message.type === 'agent-end') {
        // Pop from stack, return to parent context
        const completedAgent = nodeStack.pop();
        if (nodeStack.length === 0) {
          rootNodes.push(completedAgent);
        } else {
          nodeStack[nodeStack.length - 1].children.push(completedAgent);
        }
      } else {
        // Add to current context (root or current agent)
        if (nodeStack.length === 0) {
          rootNodes.push(node);
        } else {
          nodeStack[nodeStack.length - 1].children.push(node);
        }
      }
    }

    return rootNodes;
  }
}
```

**Algorithm**:

1. Iterate flat message array
2. Track agent context with stack
3. Nest nodes based on agent spawn/end markers
4. Return tree of root nodes

### 6. Streaming Text Reveal (Cursor-Based)

**Smooth character-by-character reveal with typing cursor.**

```typescript
@Component({
  selector: 'ptah-streaming-text-reveal',
  template: `
    <span>{{ visibleText() }}</span>
    @if (isRevealing()) {
    <ptah-typing-cursor />
    }
  `,
})
export class StreamingTextRevealComponent implements OnInit {
  readonly fullText = input.required<string>();
  readonly speed = input<number>(20); // ms per character

  readonly visibleText = signal('');
  readonly isRevealing = signal(false);

  ngOnInit(): void {
    this.startReveal();
  }

  private startReveal(): void {
    this.isRevealing.set(true);
    const text = this.fullText();
    let index = 0;

    const interval = setInterval(() => {
      if (index < text.length) {
        this.visibleText.set(text.slice(0, index + 1));
        index++;
      } else {
        this.isRevealing.set(false);
        clearInterval(interval);
      }
    }, this.speed());
  }
}
```

### 7. File Attachment with Autocomplete

**UnifiedSuggestionsDropdownComponent handles @ and / autocomplete.**

```typescript
@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  template: `
    <ptah-autocomplete [suggestions]="suggestions()" [isLoading]="isLoading()" [isOpen]="isOpen()" [headerTitle]="headerTitle()" (suggestionSelected)="selectSuggestion($event)" (closed)="close()">
      <!-- Render suggestion with icon -->
      <ng-template suggestionTemplate let-suggestion>
        <div class="flex items-center gap-2">
          <span>{{ suggestion.icon }}</span>
          <span>{{ suggestion.name }}</span>
        </div>
      </ng-template>
    </ptah-autocomplete>
  `,
})
export class UnifiedSuggestionsDropdownComponent {
  private readonly agentDiscovery = inject(AgentDiscoveryFacade);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);

  readonly query = input.required<string>();
  readonly triggerChar = input.required<'@' | '/'>(); // @ = agents, / = commands

  readonly suggestions = computed(() => {
    const q = this.query();
    const trigger = this.triggerChar();

    if (trigger === '@') {
      return this.agentDiscovery.searchAgents(q);
    } else {
      return this.commandDiscovery.searchCommands(q);
    }
  });
}
```

**Usage in ChatInputComponent**:

```typescript
@Component({
  template: `
    <textarea [(ngModel)]="message" (input)="onInput($event)" placeholder="Type @ for agents, / for commands"> </textarea>

    @if (showSuggestions()) {
    <ptah-unified-suggestions-dropdown [query]="autocompleteQuery()" [triggerChar]="triggerChar()" (suggestionSelected)="insertSuggestion($event)" />
    }
  `,
})
export class ChatInputComponent {
  readonly message = signal('');
  readonly showSuggestions = signal(false);
  readonly autocompleteQuery = signal('');
  readonly triggerChar = signal<'@' | '/'>('@');

  onInput(event: Event): void {
    const input = (event.target as HTMLTextAreaElement).value;
    const cursorPos = (event.target as HTMLTextAreaElement).selectionStart;
    const textBeforeCursor = input.slice(0, cursorPos);

    // Detect @ or / trigger
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    const slashMatch = textBeforeCursor.match(/\/(\w*)$/);

    if (atMatch) {
      this.triggerChar.set('@');
      this.autocompleteQuery.set(atMatch[1]);
      this.showSuggestions.set(true);
    } else if (slashMatch) {
      this.triggerChar.set('/');
      this.autocompleteQuery.set(slashMatch[1]);
      this.showSuggestions.set(true);
    } else {
      this.showSuggestions.set(false);
    }
  }
}
```

---

## Key Components API Reference

### ChatViewComponent (Template)

**Purpose**: Main chat interface layout with message list and input.

```typescript
@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [
    /* ... */
  ],
  template: `
    <div class="flex flex-col h-full">
      <!-- Header: Session info + cost summary -->
      <header class="px-4 py-2 border-b">
        <ptah-session-cost-summary [session]="activeSession()" />
      </header>

      <!-- Message list with ExecutionNodes -->
      <main class="flex-1 overflow-y-auto p-4">
        @for (node of executionNodes(); track node.id) {
        <ptah-execution-node [node]="node" [depth]="0" />
        } @if (isLoading()) {
        <div class="loading">Loading...</div>
        }
      </main>

      <!-- Input area -->
      <footer class="border-t">
        <ptah-chat-input (messageSent)="sendMessage($event)" (filesAttached)="attachFiles($event)" />
      </footer>
    </div>
  `,
})
export class ChatViewComponent {
  private readonly chatStore = inject(ChatStore);

  readonly activeSession = this.chatStore.activeSession;
  readonly executionNodes = this.chatStore.executionNodes;
  readonly isLoading = this.chatStore.isLoading;

  async sendMessage(message: string): Promise<void> {
    await this.chatStore.sendMessage(message);
  }
}
```

### ExecutionNodeComponent (Organism)

**Purpose**: Recursive tree visualization of agent execution.

```typescript
@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    /* ... */
  ],
  template: `
    <div class="execution-node" [class.pl-4]="depth > 0" [class.border-l-2]="depth > 0" [class.border-base-300]="depth > 0">
      <!-- Node content based on type -->
      @switch (node().type) { @case ('thinking') {
      <ptah-thinking-block [content]="node().content" />
      } @case ('tool-call') {
      <div class="tool-call">
        <ptah-tool-call-header [toolName]="node().metadata?.toolName" [duration]="node().metadata?.duration" />
        <ptah-code-output [content]="node().content" />
      </div>
      } @case ('agent-spawn') {
      <ptah-inline-agent-bubble [agentName]="node().agentName" [cost]="node().metadata?.cost" />
      } }

      <!-- RECURSIVE: Render children -->
      @for (child of node().children; track child.id) {
      <ptah-execution-node [node]="child" [depth]="depth() + 1" />
      }
    </div>
  `,
})
export class ExecutionNodeComponent {
  readonly node = input.required<ExecutionNode>();
  readonly depth = input<number>(0);
}
```

### ChatInputComponent (Molecule)

**Purpose**: Message input with autocomplete and file attachments.

```typescript
@Component({
  selector: 'ptah-chat-input',
  standalone: true,
  imports: [
    /* ... */
  ],
  template: `
    <div class="relative">
      <!-- File tags (attached files) -->
      @if (attachedFiles().length > 0) {
      <div class="flex gap-2 p-2 bg-base-200">
        @for (file of attachedFiles(); track file.path) {
        <ptah-file-tag [file]="file" (removed)="removeFile(file)" />
        }
      </div>
      }

      <!-- Textarea with autocomplete -->
      <textarea [(ngModel)]="message" (input)="onInput($event)" (keydown.enter)="onEnter($event)" placeholder="Type your message... (@ for agents, / for commands)" class="w-full p-3 resize-none" rows="3"> </textarea>

      <!-- Autocomplete dropdown -->
      @if (showSuggestions()) {
      <ptah-unified-suggestions-dropdown [query]="autocompleteQuery()" [triggerChar]="triggerChar()" (suggestionSelected)="insertSuggestion($event)" (closed)="closeSuggestions()" />
      }

      <!-- Send button -->
      <button (click)="send()" [disabled]="!canSend()" class="btn btn-primary">Send</button>
    </div>
  `,
})
export class ChatInputComponent {
  readonly message = signal('');
  readonly attachedFiles = signal<ChatFile[]>([]);
  readonly showSuggestions = signal(false);

  readonly messageSent = output<string>();
  readonly filesAttached = output<ChatFile[]>();

  readonly canSend = computed(() => {
    return this.message().trim().length > 0 || this.attachedFiles().length > 0;
  });

  onEnter(event: KeyboardEvent): void {
    if (event.shiftKey) return; // Allow newline with Shift+Enter

    event.preventDefault();
    this.send();
  }

  send(): void {
    if (this.canSend()) {
      this.messageSent.emit(this.message());
      this.message.set('');
    }
  }
}
```

### StreamingTextRevealComponent (Atom)

**Purpose**: Smooth character-by-character text reveal with typing cursor.

```typescript
@Component({
  selector: 'ptah-streaming-text-reveal',
  standalone: true,
  imports: [TypingCursorComponent],
  template: `
    <span>{{ visibleText() }}</span>
    @if (isRevealing()) {
    <ptah-typing-cursor />
    }
  `,
})
export class StreamingTextRevealComponent implements OnInit, OnDestroy {
  readonly fullText = input.required<string>();
  readonly speed = input<number>(20); // ms per character

  readonly visibleText = signal('');
  readonly isRevealing = signal(false);

  private intervalId?: number;

  ngOnInit(): void {
    this.startReveal();
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private startReveal(): void {
    this.isRevealing.set(true);
    const text = this.fullText();
    let index = 0;

    this.intervalId = window.setInterval(() => {
      if (index < text.length) {
        this.visibleText.set(text.slice(0, index + 1));
        index++;
      } else {
        this.isRevealing.set(false);
        clearInterval(this.intervalId);
      }
    }, this.speed());
  }
}
```

---

## Services API Reference

### ChatStore

**Purpose**: Signal-based reactive state management for chat.

```typescript
@Injectable({ providedIn: 'root' })
export class ChatStore {
  // Public readonly signals
  readonly state: Signal<ChatStoreState>;
  readonly activeSession: Signal<Session | null>;
  readonly executionNodes: Signal<ExecutionNode[]>;
  readonly isStreaming: Signal<boolean>;
  readonly totalCost: Signal<number>;

  // State mutations
  addMessage(message: ChatMessage): void;
  updateStreamingNode(nodeId: string, deltaContent: string): void;
  setActiveSession(sessionId: SessionId, session: Session, nodes: ExecutionNode[]): void;
  clearMessages(): void;
}
```

### SessionManager

**Purpose**: Session lifecycle orchestration.

```typescript
@Injectable({ providedIn: 'root' })
export class SessionManager {
  loadSession(sessionId: SessionId): Promise<SessionLoadResult>;
  switchSession(sessionId: SessionId): Promise<void>;
  createNewSession(): Promise<SessionId>;
  deleteSession(sessionId: SessionId): Promise<void>;
}
```

### ExecutionTreeBuilder

**Purpose**: Immutable ExecutionNode tree construction.

```typescript
@Injectable({ providedIn: 'root' })
export class ExecutionTreeBuilder {
  buildTree(messages: ChatMessage[]): ExecutionNode[];
  updateNodeContent(tree: ExecutionNode[], nodeId: string, deltaContent: string): ExecutionNode[];
}
```

### FilePickerService

**Purpose**: File attachment logic with fuzzy search.

```typescript
@Injectable({ providedIn: 'root' })
export class FilePickerService {
  searchFiles(query: string): Promise<FileSuggestion[]>;
  attachFile(file: FileSuggestion): ChatFile;
  removeFile(file: ChatFile): void;
}

export interface FileSuggestion {
  path: string;
  name: string;
  icon: string;
  isDirectory: boolean;
}

export interface ChatFile {
  path: string;
  name: string;
  size: number;
}
```

---

## Boundaries

**Belongs Here**:

- Chat UI components (Atomic Design hierarchy)
- ExecutionNode visualization
- Message display (streaming, markdown, code)
- Chat input (autocomplete, validation, file attachments)
- Session UI (switching, cost summary)
- Settings UI (auth config, model selection)
- Chat-specific state (ChatStore, SessionManager)

**Does NOT Belong**:

- Application-level state (belongs in `@ptah-extension/core`)
- Generic UI components (belongs in `@ptah-extension/ui`)
- Business logic (belongs in backend libraries)
- Analytics UI (belongs in `@ptah-extension/analytics`)

---

## Dependencies

**Internal Libraries**:

- `@ptah-extension/shared` - Type contracts (ChatMessage, SessionId, ExecutionNode)
- `@ptah-extension/core` - VSCodeService, AppStateManager, discovery facades
- `@ptah-extension/ui` - DropdownComponent, OptionComponent, AutocompleteComponent

**External Dependencies**:

- `@angular/core` (^20.1.2) - Component framework, signals
- `@angular/common` (^20.1.2) - NgFor, NgIf, NgSwitch
- `@angular/forms` (^20.1.2) - NgModel for textarea
- `marked` (^15.0.6) - Markdown parsing
- `highlight.js` (^11.11.1) - Code syntax highlighting

---

## Import Path

```typescript
// Components
import { ChatViewComponent } from '@ptah-extension/chat';
import { ExecutionNodeComponent } from '@ptah-extension/chat';
import { ChatInputComponent } from '@ptah-extension/chat';
import { StreamingTextRevealComponent } from '@ptah-extension/chat';

// Services
import { ChatStore } from '@ptah-extension/chat';
import { SessionManager } from '@ptah-extension/chat';
import { ExecutionTreeBuilder } from '@ptah-extension/chat';
import { FilePickerService } from '@ptah-extension/chat';

// Types
import type { ExecutionNode, ChatFile, FileSuggestion } from '@ptah-extension/chat';
```

---

## Commands

```bash
# Test
nx test chat

# Typecheck
nx typecheck chat

# Lint
nx lint chat

# Build to ESM
nx build chat
```

---

## Guidelines

1. **Atomic Design**: Organize components by complexity (Atoms → Molecules → Organisms → Templates)
2. **Signal-First**: All component state MUST use Angular signals
3. **Immutable State**: ChatStore state updates are immutable (new arrays/objects)
4. **Recursive Components**: ExecutionNode supports infinite nesting via recursive template
5. **OnPush Change Detection**: All components use ChangeDetectionStrategy.OnPush for performance
6. **DaisyUI Classes**: Use DaisyUI + Tailwind for styling consistency
7. **Accessibility**: Semantic HTML + ARIA labels for screen readers
8. **Code Highlighting**: Use highlight.js directive for syntax highlighting
9. **Markdown Rendering**: Use marked library with XSS sanitization
10. **No Inline Styles**: Use Tailwind utility classes only

---

## File Paths Reference

- **Components**: `src/lib/components/`
  - **Atoms**: `atoms/*.component.ts`
  - **Molecules**: `molecules/*.component.ts`
  - **Organisms**: `organisms/*.component.ts`
  - **Templates**: `templates/*.component.ts`
  - **Autocomplete**: `file-suggestions/*.component.ts`
- **Services**: `src/lib/services/`
- **Settings**: `src/lib/settings/`
- **Directives**: `src/lib/directives/`
- **Entry Point**: `src/index.ts`
