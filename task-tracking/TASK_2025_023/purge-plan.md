# TASK_2025_023: Complete Purge & Rebuild Plan

## Executive Summary

This document defines exactly what gets DELETED, what gets KEPT, and what gets BUILT for the complete Ptah rebuild.

---

## PHASE 1: BACKEND PURGE

### Files to DELETE (Backend)

#### CLI Management (DELETE ENTIRELY)

```
libs/backend/claude-domain/src/cli/
├── interactive-session-manager.ts    # DELETE - Complex state machine
├── session-process.ts                # DELETE - Message queue, backpressure handling
├── message-queue.ts                  # DELETE - Unnecessary complexity
├── jsonl-stream-parser.ts            # DELETE - Will simplify inline
└── process-manager.ts                # KEEP (basic process tracking)
```

#### Session Management (DELETE ENTIRELY)

```
libs/backend/claude-domain/src/session/
├── session-manager.ts                # DELETE - In-memory duplication
├── session-storage.service.ts        # DELETE - workspaceState storage
└── jsonl-session-parser.ts           # KEEP - Parses .jsonl files correctly
```

#### Claude CLI Service Methods (PARTIAL DELETE)

```
libs/backend/claude-domain/src/services/
└── claude-cli.service.ts
    - DELETE: sendChatMessage() - complex routing
    - DELETE: createInteractiveSession() - not needed
    - DELETE: resumeSession() - will rebuild simpler
    - KEEP: getChatSessions() - lists sessions
    - KEEP: executeOneShot() - simple spawn pattern
```

### Files to KEEP (Backend)

```
libs/backend/claude-domain/src/
├── cli/
│   └── claude-cli-detector.ts        # KEEP - Detects CLI installation
├── session/
│   └── jsonl-session-parser.ts       # KEEP - Parses session files
├── services/
│   ├── claude-cli.service.ts         # KEEP (simplified)
│   └── chat-orchestration.service.ts # REVIEW - May simplify
└── index.ts                          # UPDATE exports

libs/backend/vscode-core/                # KEEP ALL - Infrastructure
libs/backend/workspace-intelligence/     # KEEP ALL - Independent package
libs/backend/ai-providers-core/          # KEEP ALL - Independent package
```

---

## PHASE 2: FRONTEND PURGE

### Files to DELETE (Frontend Components - Logic & Styles)

#### Chat Components (PURGE LOGIC/STYLES, KEEP SHELLS)

```
libs/frontend/chat/src/lib/components/
├── chat-empty-state/                 # PURGE - Rebuild with DaisyUI
├── chat-header/                      # PURGE - Rebuild with DaisyUI
├── chat-input/                       # PURGE - Rebuild with DaisyUI
├── chat-message-content/             # PURGE - Rebuild with recursive nesting
├── chat-messages-container/          # PURGE - Rebuild
├── chat-messages-list/               # PURGE - Rebuild
├── chat-status-bar/                  # PURGE - Rebuild
├── chat-streaming-status/            # PURGE - Rebuild
├── chat-token-usage/                 # PURGE - Rebuild
├── file-suggestions-dropdown/        # PURGE - Rebuild
├── file-tag/                         # PURGE - Rebuild
├── session-dropdown/                 # PURGE - Rebuild
├── session-search-overlay/           # PURGE - Rebuild
└── unified-suggestions-dropdown/     # PURGE - Rebuild
```

#### Chat Services (PURGE, REBUILD SINGLE STORE)

```
libs/frontend/chat/src/lib/services/
├── chat-state-manager.service.ts     # DELETE - Merge into ChatStore
├── chat-store.service.ts             # PURGE & REBUILD - Single source of truth
└── message-processor.service.ts      # DELETE - Will process inline
```

#### Chat Container (PURGE LOGIC)

```
libs/frontend/chat/src/lib/containers/
└── chat/chat.component.ts            # PURGE LOGIC - Keep as shell
```

#### Core Services (SIMPLIFY)

```
libs/frontend/core/src/lib/services/
├── chat.service.ts                   # SIMPLIFY - Remove complex event handling
├── claude-rpc.service.ts             # KEEP - RPC communication
├── vscode.service.ts                 # KEEP - VS Code bridge
└── app-state.service.ts              # SIMPLIFY - Remove unused signals
```

#### Shared UI (PURGE - Replace with DaisyUI)

```
libs/frontend/shared-ui/              # PURGE - DaisyUI replaces custom components
```

### Files to KEEP (Frontend)

```
apps/ptah-extension-webview/
├── src/main.ts                       # KEEP - Bootstrap
├── src/app/app.ts                    # KEEP SHELL - Rebuild content
├── src/app/app.html                  # KEEP SHELL - Rebuild content
├── angular.json                      # UPDATE - Add Tailwind
├── tailwind.config.js                # NEW
└── package.json                      # UPDATE - Add dependencies

libs/frontend/core/src/lib/services/
├── claude-rpc.service.ts             # KEEP
└── vscode.service.ts                 # KEEP
```

---

## PHASE 3: NEW ARCHITECTURE

### New Backend Files to BUILD

````
libs/backend/claude-domain/src/cli/
└── claude-process.ts                 # NEW - ~100 lines, simple spawn

Example:
```typescript
export class ClaudeProcess {
  private process: ChildProcess | null = null;

  async sendMessage(
    sessionId: SessionId | null,
    message: string,
    onChunk: (chunk: JsonlMessage) => void
  ): Promise<void> {
    const args = ['--output-format', 'stream-json', '--verbose'];
    if (sessionId) args.push('--resume', sessionId);

    this.process = spawn('claude', args, {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdin.write(message + '\n');
    this.process.stdin.end();

    // Parse stdout JSONL
    let buffer = '';
    this.process.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          onChunk(JSON.parse(line));
        }
      }
    });

    return new Promise((resolve, reject) => {
      this.process.on('close', resolve);
      this.process.on('error', reject);
    });
  }

  abort(): void {
    this.process?.kill('SIGTERM');
  }
}
````

### New Frontend Architecture to BUILD

#### 1. Chat Store (Single Source of Truth)

```typescript
// libs/frontend/chat/src/lib/services/chat.store.ts
@Injectable({ providedIn: 'root' })
export class ChatStore {
  // Core state - 4 signals only
  readonly sessions = signal<SessionSummary[]>([]);
  readonly currentSessionId = signal<SessionId | null>(null);
  readonly executionTree = signal<ExecutionNode[]>([]);
  readonly isStreaming = signal<boolean>(false);

  // Computed
  readonly currentSession = computed(() => this.sessions().find((s) => s.id === this.currentSessionId()));

  // Actions
  async loadSessions(): Promise<void>;
  async switchSession(id: SessionId): Promise<void>;
  async sendMessage(content: string): Promise<void>;

  // JSONL → ExecutionNode mapping
  processJsonlChunk(chunk: JsonlMessage): void;
}
```

#### 2. ExecutionNode Type System

```typescript
// libs/shared/src/lib/types/execution-node.types.ts
export interface ExecutionNode {
  id: string;
  type: 'message' | 'agent' | 'tool' | 'thinking' | 'text';
  status: 'streaming' | 'done' | 'error';

  // Content
  content: string | null;
  toolName?: string;
  toolInput?: Record<string, unknown>;

  // Stats (for agents/tools)
  stats?: {
    tokens?: number;
    duration?: number;
    toolUses?: number;
  };

  // Nesting
  children: ExecutionNode[];

  // UI State
  isCollapsed: boolean;
}
```

#### 3. Component Hierarchy (DaisyUI-based)

**Layer 1 - Atoms:**

```
components/atoms/
├── markdown-block/           # ngx-markdown wrapper
├── status-badge/             # streaming|done|error badge
├── token-badge/              # "80.6k tokens" display
├── duration-badge/           # "5m 3.3s" display
└── tool-icon/                # Icon for each tool type
```

**Layer 2 - Molecules:**

```
components/molecules/
├── thinking-block/           # Collapsible sequential thinking
├── tool-call-item/           # Single tool call with expand
├── tool-call-group/          # "+32 more tool uses"
└── agent-header/             # Agent name + stats row
```

**Layer 3 - Organisms:**

```
components/organisms/
├── execution-node/           # RECURSIVE - renders any ExecutionNode
├── message-bubble/           # Full message with nested content
├── session-item/             # Session in sidebar
└── chat-input/               # Message input with commands
```

**Layer 4 - Templates:**

```
components/templates/
├── chat-view/                # Message list + input
├── session-sidebar/          # Session list
└── app-shell/                # Layout wrapper
```

#### 4. Recursive ExecutionNode Component

```typescript
// The KEY component - recursively renders execution tree
@Component({
  selector: 'ptah-execution-node',
  template: `
    @switch (node().type) { @case ('text') {
    <ptah-markdown-block [content]="node().content" />
    } @case ('thinking') {
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" [checked]="!node().isCollapsed" />
      <div class="collapse-title font-mono text-sm">💭 Thinking ({{ node().children.length }} thoughts)</div>
      <div class="collapse-content">
        <ptah-markdown-block [content]="node().content" />
      </div>
    </div>
    } @case ('tool') {
    <div class="collapse collapse-arrow bg-base-200 my-1">
      <input type="checkbox" />
      <div class="collapse-title text-sm flex items-center gap-2">
        <ptah-tool-icon [name]="node().toolName" />
        <span class="font-mono">{{ node().toolName }}</span>
        @if (node().status === 'streaming') {
        <span class="loading loading-dots loading-xs"></span>
        }
      </div>
      <div class="collapse-content">
        <pre class="text-xs">{{ node().toolInput | json }}</pre>
      </div>
    </div>
    } @case ('agent') {
    <div class="card bg-base-300 my-2">
      <div class="card-body p-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-primary">{{ node().toolName }}</span>
          <ptah-status-badge [status]="node().status" />
          @if (node().stats) {
          <ptah-duration-badge [seconds]="node().stats.duration" />
          <ptah-token-badge [tokens]="node().stats.tokens" />
          }
        </div>
        <!-- RECURSIVE CHILDREN -->
        @for (child of node().children; track child.id) {
        <ptah-execution-node [node]="child" />
        }
      </div>
    </div>
    } }
  `,
})
export class ExecutionNodeComponent {
  node = input.required<ExecutionNode>();
}
```

---

## PHASE 4: DEPENDENCY INSTALLATION

### NPM Packages to Install

```bash
# Frontend (webview)
npm install -D tailwindcss postcss autoprefixer
npm install daisyui@latest
npm install ngx-markdown marked

# Already have
# - @angular/* (v20+)
# - rxjs
```

### Tailwind Configuration

```javascript
// apps/ptah-extension-webview/tailwind.config.js
module.exports = {
  content: ['./src/**/*.{html,ts}', './libs/frontend/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        // VS Code theme integration
        'vscode-bg': 'var(--vscode-editor-background)',
        'vscode-fg': 'var(--vscode-editor-foreground)',
        'vscode-border': 'var(--vscode-panel-border)',
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: ['dark', 'light'],
    darkTheme: 'dark',
  },
};
```

---

## EXECUTION ORDER

### Phase 1: Setup (Day 1)

1. ✅ Create task tracking
2. ⬜ Install Tailwind + DaisyUI + ngx-markdown
3. ⬜ Configure build system

### Phase 2: Backend Purge (Day 1-2)

4. ⬜ Delete CLI management files
5. ⬜ Delete session management files
6. ⬜ Build ClaudeProcess class
7. ⬜ Update RPC handlers
8. ⬜ Test: Send message → receive JSONL

### Phase 3: Frontend Purge (Day 2-3)

9. ⬜ Purge all component logic/styles
10. ⬜ Create ChatStore (single store)
11. ⬜ Create ExecutionNode types

### Phase 4: Component Rebuild (Day 3-5)

12. ⬜ Build atom components
13. ⬜ Build molecule components
14. ⬜ Build ExecutionNodeComponent (recursive)
15. ⬜ Build MessageBubble
16. ⬜ Build ChatView
17. ⬜ Build AppShell

### Phase 5: Integration & Testing (Day 5-6)

18. ⬜ Wire ChatStore → Components
19. ⬜ Test full flow: message → stream → nested display
20. ⬜ Test session switching
21. ⬜ Test session resume

---

## Risk Mitigation

1. **Build won't compile during purge** - Expected, work through incrementally
2. **Lost functionality temporarily** - Accept this, rebuild correctly
3. **Complex JSONL parsing** - Start simple, iterate

## Success Metrics

- [ ] Send message, see response stream
- [ ] Agent spawn shows as nested card
- [ ] Tool calls show as collapsible items
- [ ] Sequential thinking shows as collapsible block
- [ ] Switch session, see history
- [ ] Resume session, continue conversation
- [ ] All using DaisyUI components
- [ ] Clean, modern aesthetic

---

Document Version: 1.0
Created: 2025-11-25
Status: Ready for Execution
