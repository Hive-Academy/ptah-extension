# Ptah Extension - Complete Implementation Plan

## 🎯 Overview

This plan covers the complete implementation of rich CLI features in the Ptah VS Code extension, enabling users to access all Claude CLI capabilities through the UI.

---

## ✅ What's Already Working

### 1. Core Infrastructure (DONE ✅)

- **Direct Node.js execution** - No Windows buffering issues
- **Workspace context passing** - CWD, .claude/, .mcp.json detection
- **Session management** - Create, resume, persist sessions
- **Message streaming** - Real-time JSONL parsing and display
- **Basic chat UI** - Send messages, view responses

### 2. Backend Services (DONE ✅)

- **ClaudeCliDetector** - Finds and resolves CLI path
- **ClaudeCliLauncher** - Spawns CLI with direct execution
- **JSONLStreamParser** - Parses streaming responses
- **SessionManager** - CRUD operations, persistence
- **EventBus** - Real-time updates across components

---

## 🚀 Implementation Phases

---

# PHASE 1: @ Mention System (Context Injection)

## Goal

Enable users to inject context into messages using `@` mentions, matching Claude CLI terminal behavior.

## Features

### 1.1 @ Mention Parser Component

**Location**: `libs/frontend/chat/src/lib/components/mention-input/`

**Component**: `MentionInputComponent`

**Functionality**:

```typescript
@Component({
  selector: 'ptah-mention-input',
  standalone: true,
  template: `
    <div class="mention-input-container">
      <textarea #input [(ngModel)]="message" (input)="onInput($event)" (keydown)="onKeyDown($event)" placeholder="Type @ to mention files, agents, commands..."></textarea>

      @if (showMentionMenu()) {
      <div class="mention-menu" [style.top.px]="menuPosition().top" [style.left.px]="menuPosition().left">
        @for (item of filteredItems(); track item.id) {
        <div class="mention-item" (click)="insertMention(item)" [class.selected]="selectedIndex() === $index">
          <span class="mention-icon">{{ item.icon }}</span>
          <span class="mention-label">{{ item.label }}</span>
          <span class="mention-description">{{ item.description }}</span>
        </div>
        }
      </div>
      }
    </div>
  `,
})
export class MentionInputComponent {
  message = signal('');
  showMentionMenu = signal(false);
  filteredItems = signal<MentionItem[]>([]);
  selectedIndex = signal(0);
  menuPosition = signal({ top: 0, left: 0 });

  // Mention sources
  private mentionSources = {
    '@': this.getAllMentions.bind(this),
    '@file:': this.getFiles.bind(this),
    '@agent:': this.getAgents.bind(this),
    '@cmd:': this.getCommands.bind(this),
    '@mcp:': this.getMcpTools.bind(this),
  };

  onInput(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = this.message().substring(0, cursorPos);

    // Detect @ mention trigger
    const mentionMatch = textBeforeCursor.match(/@(\w*):?(\w*)$/);
    if (mentionMatch) {
      this.showMentionMenu.set(true);
      this.filterMentions(mentionMatch[0]);
      this.updateMenuPosition(textarea, cursorPos);
    } else {
      this.showMentionMenu.set(false);
    }
  }

  onKeyDown(event: KeyboardEvent) {
    if (!this.showMentionMenu()) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update((i) => Math.min(i + 1, this.filteredItems().length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        const selected = this.filteredItems()[this.selectedIndex()];
        if (selected) this.insertMention(selected);
        break;
      case 'Escape':
        this.showMentionMenu.set(false);
        break;
    }
  }

  private getAllMentions(query: string): MentionItem[] {
    return [...this.getFiles(query), ...this.getAgents(query), ...this.getCommands(query), ...this.getMcpTools(query)];
  }

  private getFiles(query: string): MentionItem[] {
    // Call workspace file search API
    return this.workspaceService.searchFiles(query).map((file) => ({
      id: file.path,
      type: 'file',
      label: file.name,
      description: file.relativePath,
      icon: '📄',
      insertText: `@file:${file.relativePath}`,
    }));
  }

  private getAgents(query: string): MentionItem[] {
    // Get from session capabilities
    const agents = this.sessionService.currentSession()?.capabilities?.agents || [];
    return agents
      .filter((agent) => agent.toLowerCase().includes(query.toLowerCase()))
      .map((agent) => ({
        id: agent,
        type: 'agent',
        label: agent,
        description: 'Custom agent',
        icon: '🤖',
        insertText: `@agent:${agent}`,
      }));
  }

  private getCommands(query: string): MentionItem[] {
    const commands = this.sessionService.currentSession()?.capabilities?.slash_commands || [];
    return commands
      .filter((cmd) => cmd.toLowerCase().includes(query.toLowerCase()))
      .map((cmd) => ({
        id: cmd,
        type: 'command',
        label: cmd,
        description: 'Slash command',
        icon: '⚡',
        insertText: `/${cmd}`,
      }));
  }

  private getMcpTools(query: string): MentionItem[] {
    const mcpServers = this.sessionService.currentSession()?.capabilities?.mcp_servers || [];
    return mcpServers.flatMap((server) =>
      (server.tools || [])
        .filter((tool) => tool.toLowerCase().includes(query.toLowerCase()))
        .map((tool) => ({
          id: tool,
          type: 'mcp',
          label: tool,
          description: `${server.name} MCP tool`,
          icon: '🔧',
          insertText: `@mcp:${tool}`,
        }))
    );
  }

  insertMention(item: MentionItem) {
    const textarea = this.inputRef().nativeElement;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = this.message().substring(0, cursorPos);
    const textAfterCursor = this.message().substring(cursorPos);

    // Replace @ mention with insertion text
    const mentionMatch = textBeforeCursor.match(/@(\w*):?(\w*)$/);
    if (mentionMatch) {
      const beforeMention = textBeforeCursor.substring(0, textBeforeCursor.length - mentionMatch[0].length);
      this.message.set(beforeMention + item.insertText + ' ' + textAfterCursor);
    }

    this.showMentionMenu.set(false);
  }
}
```

**Backend Support** (ALREADY EXISTS):

```typescript
// libs/backend/claude-domain/src/cli/claude-cli-launcher.ts
// Message with mentions is passed directly to stdin
// Claude CLI handles parsing @file:, @agent:, etc.
```

---

### 1.2 File Search Integration

**Location**: `libs/frontend/core/src/lib/services/workspace.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  async searchFiles(query: string, limit = 20): Promise<FileSearchResult[]> {
    const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', limit);

    return files.map((uri) => ({
      path: uri.fsPath,
      name: path.basename(uri.fsPath),
      relativePath: vscode.workspace.asRelativePath(uri),
    }));
  }
}
```

---

### 1.3 Session Capabilities Tracking

**Location**: `libs/backend/claude-domain/src/session/session-manager.ts`

**Add to session interface**:

```typescript
interface StrictChatSession {
  id: SessionId;
  name: string;
  model?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;

  // NEW: Session capabilities from CLI
  capabilities?: SessionCapabilities;
}

interface SessionCapabilities {
  cwd: string;
  model: string;
  tools: string[];
  agents: string[];
  slash_commands: string[];
  mcp_servers: MCPServerInfo[];
  claude_code_version: string;
}

interface MCPServerInfo {
  name: string;
  status: 'connected' | 'disabled' | 'failed';
  tools?: string[];
}
```

**Update on system init**:

```typescript
// libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts
private handleSystemMessage(msg: JSONLSystemMessage): void {
  if (msg.subtype === 'init' && msg.session_id) {
    this.callbacks.onSessionInit?.(msg.session_id, msg.model);

    // NEW: Pass full capabilities
    this.callbacks.onCapabilitiesDetected?.({
      cwd: msg.cwd,
      model: msg.model,
      tools: msg.tools,
      agents: msg.agents,
      slash_commands: msg.slash_commands,
      mcp_servers: msg.mcp_servers,
      claude_code_version: msg.claude_code_version,
    });
  }
}

// Add to callbacks
export interface JSONLParserCallbacks {
  onCapabilitiesDetected?: (capabilities: SessionCapabilities) => void;
}
```

---

# PHASE 2: Model Selection UI

## Goal

Allow users to select Claude model (Sonnet/Opus/Haiku) per session.

## Implementation

### 2.1 Model Selector Component

**Location**: `libs/frontend/chat/src/lib/components/model-selector/`

```typescript
@Component({
  selector: 'ptah-model-selector',
  standalone: true,
  template: `
    <div class="model-selector">
      <label>Model:</label>
      <select [value]="selectedModel()" (change)="onModelChange($event)">
        @for (model of availableModels; track model.id) {
        <option [value]="model.id">{{ model.name }} - {{ model.description }}</option>
        }
      </select>
      <span class="model-cost">~{{ selectedModelCost() }}/1M tokens</span>
    </div>
  `,
})
export class ModelSelectorComponent {
  selectedModel = input.required<string>();
  modelChanged = output<string>();

  availableModels = [
    {
      id: 'sonnet',
      name: 'Claude Sonnet 4.5',
      fullName: 'claude-sonnet-4-5-20250929',
      description: 'Balanced performance',
      cost: '$3.00',
    },
    {
      id: 'opus',
      name: 'Claude Opus 3',
      fullName: 'claude-3-opus-20240229',
      description: 'Most capable',
      cost: '$15.00',
    },
    {
      id: 'haiku',
      name: 'Claude Haiku 4.5',
      fullName: 'claude-haiku-4-5-20251001',
      description: 'Fast & efficient',
      cost: '$1.00',
    },
  ];

  selectedModelCost = computed(() => {
    const model = this.availableModels.find((m) => m.id === this.selectedModel());
    return model?.cost || 'N/A';
  });

  onModelChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.modelChanged.emit(select.value);
  }
}
```

### 2.2 Backend: Pass Model to CLI

**Location**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`

**ALREADY IMPLEMENTED** - just need to wire it:

```typescript
private buildArgs(model?: string, resumeSessionId?: string): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

  // Model selection
  if (model && model !== 'default') {
    args.push('--model', model);
  }

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  return args;
}
```

### 2.3 Store Model Preference

**Location**: `libs/backend/claude-domain/src/session/session-manager.ts`

```typescript
async createSession(options: CreateSessionOptions): Promise<StrictChatSession> {
  const session: StrictChatSession = {
    id: SessionId.create(),
    name: options.name || `Session ${this.sessionCounter++}`,
    model: options.model || 'sonnet',  // NEW: Store model preference
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  this.sessions.set(session.id, session);
  this.saveSessions();
  return session;
}
```

---

# PHASE 3: MCP Server Status UI

## Goal

Display loaded MCP servers, their status, and available tools.

## Implementation

### 3.1 MCP Server Status Component

**Location**: `libs/frontend/session/src/lib/components/mcp-status/`

```typescript
@Component({
  selector: 'ptah-mcp-status',
  standalone: true,
  template: `
    <div class="mcp-status-panel">
      <h3>MCP Servers</h3>

      @if (mcpServers().length === 0) {
      <p class="empty-state">No MCP servers configured</p>
      } @else { @for (server of mcpServers(); track server.name) {
      <div class="mcp-server" [class]="server.status">
        <div class="server-header">
          <span class="server-name">{{ server.name }}</span>
          <span class="server-status" [class]="server.status">
            {{ server.status }}
          </span>
        </div>

        @if (server.status === 'connected' && server.tools) {
        <div class="server-tools">
          <span class="tools-count">{{ server.tools.length }} tools</span>
          <button (click)="toggleTools(server.name)">
            {{ expandedServers().has(server.name) ? '▼' : '▶' }}
          </button>
        </div>

        @if (expandedServers().has(server.name)) {
        <ul class="tool-list">
          @for (tool of server.tools; track tool) {
          <li class="tool-item">
            <span class="tool-name">{{ tool }}</span>
          </li>
          }
        </ul>
        } } @if (server.status === 'failed') {
        <div class="server-error">
          <span class="error-icon">⚠️</span>
          <span class="error-message">Failed to connect</span>
          <button (click)="retryServer(server.name)">Retry</button>
        </div>
        }
      </div>
      } }
    </div>
  `,
})
export class McpStatusComponent {
  mcpServers = input.required<MCPServerInfo[]>();
  expandedServers = signal(new Set<string>());

  toggleTools(serverName: string) {
    this.expandedServers.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(serverName)) {
        newSet.delete(serverName);
      } else {
        newSet.add(serverName);
      }
      return newSet;
    });
  }

  retryServer(serverName: string) {
    // Emit event to retry MCP server connection
    this.chatService.retryMcpServer(serverName);
  }
}
```

### 3.2 Parse MCP Servers from CLI

**Location**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

**ALREADY PARSING** - just need to expose:

```typescript
export interface JSONLSystemMessage {
  readonly type: 'system';
  readonly subtype: 'init';
  readonly cwd?: string;
  readonly session_id?: string;
  readonly model?: string;
  readonly tools?: string[];
  readonly agents?: string[];
  readonly slash_commands?: string[];
  readonly mcp_servers?: Array<{
    // ALREADY HERE!
    readonly name: string;
    readonly status: 'connected' | 'disabled' | 'failed';
    readonly tools?: string[];
  }>;
}
```

---

# PHASE 4: Cost & Token Tracking

## Goal

Display per-message cost, token usage, and cumulative session cost.

## Implementation

### 4.1 Parse Result Messages

**Location**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

```typescript
export interface JSONLResultMessage {
  readonly type: 'result';
  readonly subtype: 'success' | 'error';
  readonly session_id?: string;
  readonly total_cost_usd?: number;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  readonly modelUsage?: Record<string, {
    readonly costUSD: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly cacheCreationInputTokens: number;
  }>;
}

// Add to parser
private processLine(line: string): void {
  try {
    const parsed = JSON.parse(line) as JSONLMessage;

    switch (parsed.type) {
      case 'result':
        this.handleResultMessage(parsed as JSONLResultMessage);
        break;
      // ... existing cases
    }
  } catch (error) {
    // Handle parse error
  }
}

private handleResultMessage(msg: JSONLResultMessage): void {
  this.callbacks.onResult?.(msg);
}

// Add to callbacks
export interface JSONLParserCallbacks {
  onResult?: (result: JSONLResultMessage) => void;
}
```

### 4.2 Message Cost Display Component

**Location**: `libs/frontend/chat/src/lib/components/message-footer/`

```typescript
@Component({
  selector: 'ptah-message-footer',
  standalone: true,
  template: `
    <div class="message-footer">
      @if (cost()) {
      <span class="cost">
        <span class="cost-icon">💰</span>
        <span class="cost-amount">\${{ cost()?.toFixed(4) }}</span>
      </span>
      } @if (tokens()) {
      <span class="tokens">
        <span class="tokens-icon">📊</span>
        <span class="tokens-count"> {{ tokens()!.input }}↑ {{ tokens()!.output }}↓ </span>
        @if (tokens()!.cacheHit) {
        <span class="cache-badge">cached</span>
        }
      </span>
      } @if (duration()) {
      <span class="duration">
        <span class="duration-icon">⏱️</span>
        <span class="duration-time">{{ duration()! }}ms</span>
      </span>
      }
    </div>
  `,
})
export class MessageFooterComponent {
  cost = input<number>();
  tokens = input<{ input: number; output: number; cacheHit: boolean }>();
  duration = input<number>();
}
```

### 4.3 Session Cost Accumulator

**Location**: `libs/backend/claude-domain/src/session/session-manager.ts`

```typescript
interface StrictChatSession {
  id: SessionId;
  name: string;
  model?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  capabilities?: SessionCapabilities;

  // NEW: Cost tracking
  totalCost?: number;
  totalTokensInput?: number;
  totalTokensOutput?: number;
}

// Update on result message
updateSessionCost(sessionId: SessionId, result: JSONLResultMessage): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  session.totalCost = (session.totalCost || 0) + (result.total_cost_usd || 0);
  session.totalTokensInput = (session.totalTokensInput || 0) + (result.usage?.input_tokens || 0);
  session.totalTokensOutput = (session.totalTokensOutput || 0) + (result.usage?.output_tokens || 0);

  this.saveSessions();
}
```

---

# PHASE 5: Session Capabilities Panel

## Goal

Display all session capabilities (tools, agents, commands) in a sidebar panel.

## Implementation

### 5.1 Capabilities Panel Component

**Location**: `libs/frontend/session/src/lib/components/capabilities-panel/`

```typescript
@Component({
  selector: 'ptah-capabilities-panel',
  standalone: true,
  template: `
    <div class="capabilities-panel">
      <div class="panel-header">
        <h3>Session Capabilities</h3>
        <button (click)="collapsed.update(c => !c)">
          {{ collapsed() ? '▶' : '▼' }}
        </button>
      </div>

      @if (!collapsed()) {
      <div class="panel-content">
        <!-- Workspace Info -->
        <div class="capability-section">
          <h4>Workspace</h4>
          <p class="workspace-path">{{ capabilities()?.cwd }}</p>
        </div>

        <!-- Model Info -->
        <div class="capability-section">
          <h4>Model</h4>
          <p class="model-name">{{ capabilities()?.model }}</p>
        </div>

        <!-- MCP Servers -->
        <div class="capability-section">
          <h4>MCP Servers ({{ mcpServers().length }})</h4>
          <ptah-mcp-status [mcpServers]="mcpServers()" />
        </div>

        <!-- Custom Agents -->
        <div class="capability-section">
          <h4>Custom Agents ({{ customAgents().length }})</h4>
          <ul class="agent-list">
            @for (agent of customAgents(); track agent) {
            <li class="agent-item">
              <span class="agent-icon">🤖</span>
              <span class="agent-name">{{ agent }}</span>
            </li>
            }
          </ul>
        </div>

        <!-- Custom Commands -->
        <div class="capability-section">
          <h4>Custom Commands ({{ customCommands().length }})</h4>
          <ul class="command-list">
            @for (cmd of customCommands(); track cmd) {
            <li class="command-item">
              <span class="command-icon">⚡</span>
              <span class="command-name">{{ cmd }}</span>
            </li>
            }
          </ul>
        </div>

        <!-- Session Stats -->
        <div class="capability-section">
          <h4>Session Stats</h4>
          <div class="stats-grid">
            <div class="stat">
              <span class="stat-label">Total Cost:</span>
              <span class="stat-value">\${{ totalCost()?.toFixed(4) }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Messages:</span>
              <span class="stat-value">{{ messageCount() }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Tokens:</span>
              <span class="stat-value">{{ totalTokens() }}</span>
            </div>
          </div>
        </div>
      </div>
      }
    </div>
  `,
})
export class CapabilitiesPanelComponent {
  capabilities = input.required<SessionCapabilities>();
  collapsed = signal(false);

  mcpServers = computed(() => this.capabilities()?.mcp_servers || []);
  customAgents = computed(() => {
    const allAgents = this.capabilities()?.agents || [];
    const builtIn = ['general-purpose', 'statusline-setup', 'Explore', 'Plan'];
    return allAgents.filter((a) => !builtIn.includes(a));
  });
  customCommands = computed(() => {
    const allCommands = this.capabilities()?.slash_commands || [];
    const builtIn = ['compact', 'context', 'cost', 'init', 'pr-comments', 'release-notes', 'todos', 'review', 'security-review'];
    return allCommands.filter((c) => !builtIn.includes(c));
  });

  totalCost = computed(() => this.sessionService.currentSession()?.totalCost || 0);
  messageCount = computed(() => this.sessionService.currentSession()?.messages.length || 0);
  totalTokens = computed(() => {
    const session = this.sessionService.currentSession();
    return (session?.totalTokensInput || 0) + (session?.totalTokensOutput || 0);
  });
}
```

---

# PHASE 6: Integration & Wiring

## Goal

Wire all components together into cohesive UI flow.

## Implementation Steps

### 6.1 Update Chat Component

**Location**: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`

```typescript
@Component({
  template: `
    <div class="chat-container">
      <!-- Left Sidebar: Session List + Capabilities -->
      <div class="sidebar">
        <ptah-session-selector [sessions]="sessions()" [currentSessionId]="currentSessionId()" (sessionChanged)="onSessionChanged($event)" />

        @if (currentSession()) {
        <ptah-capabilities-panel [capabilities]="currentSession()!.capabilities" />
        }
      </div>

      <!-- Main Chat Area -->
      <div class="chat-main">
        <!-- Header: Model Selector + Session Info -->
        <div class="chat-header">
          <ptah-model-selector [selectedModel]="currentSession()?.model || 'sonnet'" (modelChanged)="onModelChanged($event)" />

          <div class="session-stats">
            <span>Cost: \${{ currentSession()?.totalCost?.toFixed(4) }}</span>
            <span>Messages: {{ currentSession()?.messages.length }}</span>
          </div>
        </div>

        <!-- Messages -->
        <ptah-chat-messages [messages]="messages()" />

        <!-- Input: @ Mention Support -->
        <ptah-mention-input [sessionCapabilities]="currentSession()?.capabilities" (messageSent)="onSendMessage($event)" />
      </div>
    </div>
  `,
})
export class ChatComponent {
  // ... existing code

  onModelChanged(model: string) {
    // Update session model
    this.chatService.updateSessionModel(this.currentSessionId()!, model);
  }

  onSendMessage(content: string) {
    // Parse mentions and send message
    this.chatService.sendMessage(content);
  }
}
```

### 6.2 Update ChatService

**Location**: `libs/frontend/core/src/lib/services/chat.service.ts`

```typescript
export class ChatService {
  // Handle capabilities from CLI
  private setupCapabilitiesListener(): void {
    this.vscodeService.onMessage<SessionCapabilities>('capabilities:detected').subscribe((capabilities) => {
      const session = this.currentSession();
      if (session) {
        session.capabilities = capabilities;
        this.appStateManager.updateCurrentSession(session);
      }
    });
  }

  // Handle cost/token updates from CLI
  private setupResultListener(): void {
    this.vscodeService.onMessage<ResultMessage>('message:result').subscribe((result) => {
      const session = this.currentSession();
      if (session) {
        session.totalCost = (session.totalCost || 0) + (result.total_cost_usd || 0);
        session.totalTokensInput = (session.totalTokensInput || 0) + (result.usage?.input_tokens || 0);
        session.totalTokensOutput = (session.totalTokensOutput || 0) + (result.usage?.output_tokens || 0);
        this.appStateManager.updateCurrentSession(session);
      }

      // Update last message with cost/tokens
      const lastMessage = session?.messages[session.messages.length - 1];
      if (lastMessage) {
        lastMessage.cost = result.total_cost_usd;
        lastMessage.tokens = result.usage;
        lastMessage.duration = result.duration_ms;
      }
    });
  }

  updateSessionModel(sessionId: SessionId, model: string): void {
    this.vscodeService.postMessage({
      type: 'session:updateModel',
      data: { sessionId, model },
    });
  }
}
```

### 6.3 Update Extension Message Handler

**Location**: `apps/ptah-extension-vscode/src/webview-message-handler.ts`

```typescript
async handleMessage(message: WebviewMessage): Promise<void> {
  switch (message.type) {
    case 'session:updateModel':
      await this.handleUpdateSessionModel(message.data);
      break;
    // ... existing cases
  }
}

private async handleUpdateSessionModel(data: { sessionId: SessionId; model: string }): Promise<void> {
  const session = await this.sessionManager.getSession(data.sessionId);
  if (session) {
    session.model = data.model;
    await this.sessionManager.updateSession(session);
  }
}
```

---

# Implementation Timeline

## Week 1: @ Mention System

- [ ] Day 1-2: MentionInputComponent with basic @ detection
- [ ] Day 3: File search integration
- [ ] Day 4: Agent/command/MCP mentions
- [ ] Day 5: Testing & polish

## Week 2: Model Selection & MCP Status

- [ ] Day 1-2: Model selector component + backend wiring
- [ ] Day 3-4: MCP status panel + server list display
- [ ] Day 5: Testing & integration

## Week 3: Cost Tracking & Capabilities

- [ ] Day 1-2: Result message parsing + cost accumulation
- [ ] Day 3-4: Message footer with cost/token display
- [ ] Day 5: Capabilities panel + session stats

## Week 4: Integration & Polish

- [ ] Day 1-2: Wire all components together
- [ ] Day 3-4: End-to-end testing
- [ ] Day 5: Bug fixes, UX polish, documentation

---

# Success Criteria

## Functional Requirements

- ✅ Users can type `@` to see mention suggestions
- ✅ Users can select files, agents, commands, MCP tools via mentions
- ✅ Users can switch models per session
- ✅ Users can see loaded MCP servers and their status
- ✅ Users can see per-message cost and token usage
- ✅ Users can see cumulative session cost
- ✅ Users can see all session capabilities in sidebar

## Technical Requirements

- ✅ All data synced from Claude CLI (no hardcoded lists)
- ✅ Real-time updates via EventBus
- ✅ Session persistence with capabilities
- ✅ No performance degradation with mentions UI

## UX Requirements

- ✅ Mention menu appears instantly (<100ms)
- ✅ Keyboard navigation works (arrows, enter, esc)
- ✅ Cost/token display clear and unobtrusive
- ✅ MCP status easy to understand
- ✅ Model selector obvious and accessible

---

# File Structure Summary

```
libs/
├── frontend/
│   ├── chat/
│   │   ├── components/
│   │   │   ├── mention-input/               # NEW
│   │   │   ├── model-selector/              # NEW
│   │   │   └── message-footer/              # NEW
│   │   └── containers/chat/                 # UPDATE
│   ├── session/
│   │   └── components/
│   │       ├── mcp-status/                  # NEW
│   │       └── capabilities-panel/          # NEW
│   └── core/
│       └── services/
│           ├── workspace.service.ts         # NEW
│           └── chat.service.ts              # UPDATE
├── backend/
│   ├── claude-domain/
│   │   ├── cli/
│   │   │   └── jsonl-stream-parser.ts       # UPDATE
│   │   └── session/
│   │       └── session-manager.ts           # UPDATE
│   └── vscode-core/
│       └── message-handler.ts               # UPDATE
```

---

# Next Steps

1. **Review this plan** - Confirm approach and priorities
2. **Start with Phase 1** - @ Mention System (highest user value)
3. **Iterate quickly** - Get each phase working end-to-end before moving on
4. **Test continuously** - Use ptah-extension workspace for dogfooding

Ready to start implementation? 🚀
