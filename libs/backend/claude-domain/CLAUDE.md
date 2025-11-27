# libs/backend/claude-domain - Business Logic & CLI Integration

## Purpose

The **claude-domain library** encapsulates all business logic for Claude Code CLI integration. It provides orchestration services, session management, message handling, and CLI process management with event-driven architecture.

## Key Responsibilities

- **Claude CLI Integration**: Detection, health checking, process spawning
- **Session Management**: CRUD operations, message tracking, token estimation
- **Chat Orchestration**: Workflow coordination with streaming support
- **Permission Handling**: Permission requests, rules, user decisions
- **Command Execution**: Code review, test generation workflows
- **Provider Orchestration**: AI provider switching and health monitoring
- **Analytics Orchestration**: Event tracking and metrics collection
- **Process Management**: Child process lifecycle and cleanup

## Architecture

```
Extension/Handlers
    ↓
Orchestration Services (Business Logic)
├── ChatOrchestrationService
├── ProviderOrchestrationService
├── AnalyticsOrchestrationService
└── ConfigOrchestrationService
    ↓
Core Domain Services
├── SessionManager
├── ClaudeCliService
├── CommandService
├── PermissionService
└── ProcessManager
    ↓
Infrastructure
├── ClaudeCliDetector (WSL-aware detection)
├── ClaudeCliLauncher (process spawning)
└── JSONLStreamParser (JSONL parsing)
```

## Directory Structure

```
libs/backend/claude-domain/src/
├── chat/
│   └── chat-orchestration.service.ts      # Chat workflow coordination
├── provider/
│   └── provider-orchestration.service.ts  # Provider management
├── analytics/
│   └── analytics-orchestration.service.ts # Analytics tracking
├── config/
│   └── config-orchestration.service.ts    # Configuration management
├── session/
│   ├── session-manager.ts                 # Session CRUD + persistence
│   └── session-proxy.service.ts           # Read-only session file access
├── cli/
│   ├── claude-cli.service.ts              # CLI facade
│   ├── claude-cli-launcher.ts             # Process spawning
│   ├── process-manager.ts                 # Process lifecycle
│   └── jsonl-stream-parser.ts             # Stream parsing
├── detector/
│   └── claude-cli-detector.ts             # Cross-platform detection
├── commands/
│   └── command.service.ts                 # Command execution
├── permissions/
│   ├── permission-service.ts              # Permission handling
│   └── permission-rules.store.ts          # In-memory rules
├── events/
│   └── claude-domain.events.ts            # Event publisher
├── messaging/
│   └── message-handler.service.ts         # Message routing
└── di/
    └── register.ts                        # DI registration
```

## Core Exports

### Orchestration Services

```typescript
import { ChatOrchestrationService, ProviderOrchestrationService, AnalyticsOrchestrationService } from '@ptah-extension/claude-domain';

// Chat orchestration
const result = await chatOrchestration.sendMessage({
  sessionId,
  content: 'Hello',
  files: ['/path/to/file.ts'],
});

// Provider orchestration
const providers = await providerOrchestration.getAvailableProviders({});
await providerOrchestration.switchProvider({ providerId: 'claude-cli' });
```

### Session Management

#### SessionManager (Internal Use)

```typescript
import { SessionManager } from '@ptah-extension/claude-domain';

// Create session
const session = await sessionManager.createSession('My Chat', 'workspace-1');

// Add message
await sessionManager.addMessage(session.id, {
  id: MessageId.create(),
  type: 'user',
  content: 'Hello',
  timestamp: Date.now(),
});

// Get all sessions
const sessions = await sessionManager.getAllSessions('workspace-1');

// Export session
const markdown = await sessionManager.exportSession(session.id, 'markdown');
```

#### SessionProxy (Read-Only Access)

**Purpose**: Provides read-only access to `.claude_sessions/` directory for session listing and details without mutating session state.

```typescript
import { SessionProxy } from '@ptah-extension/claude-domain';

// List all sessions (read-only from disk)
const sessions: SessionSummary[] = await sessionProxy.listSessions();
// Returns: [{ id, name, lastActiveAt, messageCount, workspaceId }]

// Get session details (read-only from disk)
const session: SessionData | null = await sessionProxy.getSessionById(sessionId);
// Returns: { id, name, workspaceId, messages: ProcessedClaudeMessage[] }
```

**Key Characteristics**:

- Read-only operations (no create/update/delete)
- Direct file system access to `.claude_sessions/`
- No in-memory cache (always reads from disk)
- Used by frontend for session list display
- Complements SessionManager (which handles writes)

### Claude CLI Detection

```typescript
import { ClaudeCliDetector } from '@ptah-extension/claude-domain';

// Detect Claude CLI
const installation = await detector.detectClaude();
// Returns: { available, path, version, platform, isWSL }

// Verify health
const health = await detector.verifyHealth(installation.path);
// Returns: { available, responseTime, version, error? }
```

### CLI Service

```typescript
import { ClaudeCliService } from '@ptah-extension/claude-domain';

// Verify installation
const isInstalled = await cliService.verifyInstallation();

// Send message with streaming
for await (const chunk of cliService.sendMessage(sessionId, content)) {
  console.log(chunk); // Process streamed responses
}
```

### Command Execution

```typescript
import { CommandService } from '@ptah-extension/claude-domain';

// Code review
const result = await commandService.reviewFile({
  filePath: '/path/to/file.ts',
  focusAreas: ['performance', 'security'],
});

// Generate tests
await commandService.generateTests({
  filePath: '/path/to/component.ts',
  testFramework: 'jest',
});
```

## Dependencies

**Internal**:

- `@ptah-extension/shared`: Type definitions (SessionId, MessageId, etc.)
- `@ptah-extension/vscode-core`: DI tokens, EventBus

**External**:

- `tsyringe` (^4.10.0): Dependency injection
- `minimatch` (9.0.3): Pattern matching for permissions
- Node.js built-ins: `child_process`, `stream`, `fs`, `path`, `os`

## DI Registration

```typescript
import { registerClaudeDomainServices } from '@ptah-extension/claude-domain';

// In extension activation
export function activate(context: vscode.ExtensionContext) {
  const eventBus = container.resolve(TOKENS.EVENT_BUS);
  const storage = context.workspaceState;

  // Register all claude-domain services
  registerClaudeDomainServices(container, eventBus, storage, contextOrchestration);

  // Services now available:
  // - CHAT_ORCHESTRATION_SERVICE
  // - PROVIDER_ORCHESTRATION_SERVICE
  // - ANALYTICS_ORCHESTRATION_SERVICE
  // - CONFIG_ORCHESTRATION_SERVICE
  // - SESSION_MANAGER
  // - CLAUDE_CLI_SERVICE
  // - CLAUDE_CLI_DETECTOR
  // - PROCESS_MANAGER
}
```

## Event System

**Published Events**:

- `claude:contentChunk` - Streaming text chunks
- `claude:thinking` - Thinking state updates
- `claude:toolExecution` - Tool usage events
- `claude:permissionRequest` - Permission prompts
- `session:created` - New session created
- `session:switched` - Session changed
- `session:messageAdded` - Message added to session
- `claude:healthChanged` - CLI health status update
- `claude:error` - CLI errors

## CLI Detection Strategy

1. **Config Path** - Check `ptah.claudeCliPath` setting
2. **System Paths** - Search PATH environment variable
3. **WSL Detection** - Check `/usr/local/bin/claude` via WSL
4. **Caching** - Cache results for 5 minutes

**Cross-platform Support**:

- Windows: `C:\Users\<user>\AppData\Local\Claude\claude.exe`
- macOS: `/usr/local/bin/claude`, `~/bin/claude`
- Linux: `/usr/local/bin/claude`, `~/.local/bin/claude`
- WSL: Detects and uses WSL paths on Windows

## Session Persistence

```typescript
// Sessions stored in workspace state (VS Code API)
interface SessionStorage {
  [workspaceId: string]: {
    sessions: StrictChatSession[];
    currentSessionId: SessionId | null;
  };
}

// Auto-saves on every operation
// Restoration on extension activation
```

## Testing

```bash
nx test claude-domain        # Run unit tests
nx run claude-domain:build   # Build to CommonJS
```

**Framework**: Jest with ts-jest transformer
**Coverage Target**: 80% minimum

## Request/Result Patterns

All orchestration services use consistent request/result types:

```typescript
// Example: ChatOrchestrationService
interface SendMessageRequest {
  sessionId: SessionId;
  content: string;
  files?: string[];
  correlationId?: CorrelationId;
}

interface SendMessageResult {
  success: boolean;
  messageId?: MessageId;
  error?: string;
}

// Example: ProviderOrchestrationService
interface SwitchProviderRequest {
  providerId: ProviderId;
  reason?: 'user-request' | 'auto-fallback';
}

interface SwitchProviderResult {
  success: boolean;
  previousProvider?: ProviderId;
  currentProvider?: ProviderId;
}
```

## Process Management

```typescript
import { ProcessManager } from '@ptah-extension/claude-domain';

// Register process
processManager.registerProcess(sessionId, childProcess);

// Get process
const proc = processManager.getProcess(sessionId);

// Kill process
processManager.killProcess(sessionId);

// Auto-cleanup on process exit
```

## JSONL Stream Parsing

```typescript
import { JSONLStreamParser } from '@ptah-extension/claude-domain';

const parser = new JSONLStreamParser({
  onSystemMessage: (msg) => {
    /* handle system */
  },
  onAssistantMessage: (msg) => {
    /* handle assistant */
  },
  onToolMessage: (msg) => {
    /* handle tool */
  },
  onPermissionRequest: (req) => {
    /* handle permission */
  },
});

childProcess.stdout?.pipe(parser.createParseStream());
```

## Critical Design Decisions

1. **Orchestration Services**: High-level business logic coordination
2. **Event-Driven**: All state changes published via EventBus
3. **Type Safety**: Request/result pairs for all operations
4. **Cross-Platform**: Robust CLI detection across Windows, macOS, Linux, WSL
5. **Streaming First**: Native AsyncIterable support
6. **Session Persistence**: Complete session lifecycle with export

## Integration Points

**Consumed By**:

- `apps/ptah-extension-vscode` - Command handlers delegate to orchestration services
- `libs/backend/ai-providers-core` - ClaudeCliAdapter uses ClaudeCliService

**Depends On**:

- `@ptah-extension/shared` - Type contracts
- `@ptah-extension/vscode-core` - Infrastructure services

## File Paths Reference

- **Orchestration**: `src/chat/`, `src/provider/`, `src/analytics/`, `src/config/`
- **Core Services**: `src/session/`, `src/commands/`, `src/permissions/`
- **CLI**: `src/cli/`, `src/detector/`
- **Events**: `src/events/claude-domain.events.ts`
- **DI**: `src/di/register.ts`
- **Entry Point**: `src/index.ts`
