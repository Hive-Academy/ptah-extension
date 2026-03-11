---
trigger: glob
globs: libs/backend/vscode-core/**/*.ts
---

# vscode-core - Infrastructure Foundation

**Active**: Working in `libs/backend/vscode-core/**/*.ts`

## Purpose

Foundation for ALL backend services. Provides DI container (60+ tokens), VS Code API wrappers, EventBus, Logger, CommandManager, WebviewManager.

## Responsibilities

✅ **Dependency Injection**: Register/resolve services with tsyringe
✅ **API Wrappers**: Type-safe VS Code API (commands, webviews, workspace)
✅ **EventBus**: Domain event pub/sub system
✅ **Logger**: Structured logging with correlation IDs
✅ **Lifecycle**: Extension activation/deactivation

❌ **NOT**: Business logic (→ domain libs), UI (→ frontend)

## Directory Structure

```
libs/backend/vscode-core/src/
├── di/
│   ├── container.ts           # DI container setup
│   ├── tokens.ts              # 60+ injection tokens
│   └── decorators.ts          # Custom DI decorators
├── services/
│   ├── command-manager.service.ts     # Command registration
│   ├── webview-manager.service.ts     # Webview lifecycle
│   ├── event-bus.service.ts           # Event pub/sub
│   ├── logger.service.ts              # Structured logging
│   └── workspace.service.ts           # Workspace operations
├── wrappers/
│   ├── vscode-commands.wrapper.ts     # VS Code commands API
│   ├── vscode-workspace.wrapper.ts    # Workspace API
│   └── vscode-window.wrapper.ts       # Window/UI API
└── types/
    └── vscode.types.ts                # Type definitions
```

## DI Container Pattern

### Registering Services

```typescript
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

// Singleton (one instance)
container.registerSingleton(TOKENS.logger, LoggerService);

// Scoped (per resolution)
container.register(TOKENS.sessionService, SessionService, {
  lifecycle: Lifecycle.ContainerScoped,
});

// Instance
const config = new ConfigService();
container.registerInstance(TOKENS.config, config);
```

### Injecting Dependencies

```typescript
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

@injectable()
export class MyService {
  constructor(@inject(TOKENS.logger) private readonly logger: Logger, @inject(TOKENS.eventBus) private readonly eventBus: EventBus, @inject(TOKENS.commandManager) private readonly commands: CommandManager) {}

  async execute(): Promise<void> {
    this.logger.info('Executing', { correlationId: '...' });
    this.eventBus.publish('my-event', { data: '...' });
  }
}
```

### Available Tokens

**Core Services**:

- `TOKENS.logger` - Structured logger
- `TOKENS.eventBus` - Event pub/sub
- `TOKENS.commandManager` - Command registration
- `TOKENS.webviewManager` - Webview lifecycle
- `TOKENS.workspaceService` - Workspace operations

**Domain Services** (registered by domain libs):

- `TOKENS.sessionService` - Session management
- `TOKENS.agentService` - Agent operations
- `TOKENS.contextService` - Context building
- `TOKENS.llmProvider` - LLM abstraction

**Configuration**:

- `TOKENS.extensionContext` - VS Code extension context
- `TOKENS.outputChannel` - VS Code output channel

## CommandManager Usage

### Registering Commands

```typescript
import { CommandManager } from '@ptah-extension/vscode-core';

@injectable()
export class ChatCommands {
  constructor(@inject(TOKENS.commandManager) private commands: CommandManager) {}

  register(): void {
    this.commands.registerCommand('ptah.chat.start', async () => {
      await this.startChat();
    });

    this.commands.registerCommand('ptah.chat.stop', async (sessionId: string) => {
      await this.stopChat(sessionId);
    });
  }
}
```

### Command Lifecycle

Commands are automatically disposed when extension deactivates. No manual cleanup needed.

## EventBus Pattern

### Publishing Events

```typescript
import { EventBus } from '@ptah-extension/vscode-core';

@injectable()
export class SessionService {
  constructor(@inject(TOKENS.eventBus) private eventBus: EventBus) {}

  async createSession(): Promise<SessionId> {
    const id = await this.doCreate();

    // Publish domain event
    this.eventBus.publish('session:created', {
      sessionId: id,
      timestamp: Date.now(),
    });

    return id;
  }
}
```

### Subscribing to Events

```typescript
import { EventBus, EventSubscription } from '@ptah-extension/vscode-core';

@injectable()
export class MetricsCollector {
  private subscriptions: EventSubscription[] = [];

  constructor(@inject(TOKENS.eventBus) private eventBus: EventBus) {}

  start(): void {
    // Subscribe to events
    this.subscriptions.push(
      this.eventBus.subscribe('session:created', (data) => {
        this.recordSessionCreated(data);
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe('message:sent', (data) => {
        this.recordMessageSent(data);
      })
    );
  }

  stop(): void {
    // Unsubscribe all
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }
}
```

### Event Naming Convention

- Format: `<domain>:<action>` (e.g., `session:created`, `message:sent`)
- Use past tense for completed actions
- Use present for in-progress (`session:creating`)

## Logger Pattern

### Structured Logging

```typescript
import { Logger } from '@ptah-extension/vscode-core';

@injectable()
export class DataService {
  constructor(@inject(TOKENS.logger) private logger: Logger) {}

  async loadData(id: string): Promise<Data> {
    const correlationId = uuid();

    this.logger.info('Loading data', {
      correlationId,
      dataId: id,
    });

    try {
      const data = await this.fetch(id);
      this.logger.info('Data loaded', {
        correlationId,
        dataId: id,
        size: data.length,
      });
      return data;
    } catch (error) {
      this.logger.error('Failed to load data', {
        correlationId,
        dataId: id,
        error: error.message,
      });
      throw error;
    }
  }
}
```

### Log Levels

- `logger.trace()` - Verbose debugging
- `logger.debug()` - Debug information
- `logger.info()` - Informational
- `logger.warn()` - Warnings
- `logger.error()` - Errors

## Testing

### Mocking DI Container

```typescript
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

describe('MyService', () => {
  let service: MyService;
  let mockLogger: jest.Mocked<Logger>;
  let mockEventBus: jest.Mocked<EventBus>;

  beforeEach(() => {
    // Create mocks
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
    } as any;

    mockEventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(),
    } as any;

    // Register mocks
    container.registerInstance(TOKENS.logger, mockLogger);
    container.registerInstance(TOKENS.eventBus, mockEventBus);

    // Resolve service (will inject mocks)
    service = container.resolve(MyService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should log and publish event', async () => {
    await service.execute();

    expect(mockLogger.info).toHaveBeenCalled();
    expect(mockEventBus.publish).toHaveBeenCalledWith('my-event', expect.any(Object));
  });
});
```

## Rules

1. **All backend services MUST use DI** - Register with container
2. **Use tokens from TOKENS** - Never hardcode strings
3. **Wrap VS Code API** - Don't use `vscode.*` directly in domain libs
4. **EventBus for cross-cutting** - Loosely couple services
5. **Logger for all operations** - Include correlationId

## Commands

```bash
nx test vscode-core
nx build vscode-core
nx typecheck vscode-core
```
