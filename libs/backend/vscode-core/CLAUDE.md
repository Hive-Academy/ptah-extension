# libs/backend/vscode-core - Infrastructure & DI Container

## Purpose

The **vscode-core library** is the infrastructure abstraction layer that wraps VS Code APIs with type-safe, event-driven interfaces. It provides the dependency injection foundation and core services for the entire Ptah extension.

## Key Responsibilities

- **DI Container**: TSyringe-based dependency injection with 60+ tokens
- **API Wrappers**: CommandManager, WebviewManager, OutputManager, StatusBarManager, FileSystemManager
- **Event Bus**: Centralized pub/sub messaging with request-response patterns
- **Core Services**: Logger, ErrorHandler, ConfigManager, MessageValidatorService
- **Metrics Tracking**: Operation counts, durations, error rates for all managers

## Architecture

```
VS Code APIs
    ↓
API Wrappers (Manager Classes)
    ↓
Event Bus (Pub/Sub)
    ↓
Core Services (Logger, ErrorHandler, Config)
    ↓
DI Container (Token Registration)
    ↓
Domain Libraries Integration
```

## Directory Structure

```
libs/backend/vscode-core/src/
├── di/
│   ├── container.ts              # DIContainer setup & bootstrap
│   └── tokens.ts                 # 60+ Symbol.for() tokens (SINGLE SOURCE OF TRUTH)
├── api-wrappers/
│   ├── command-manager.ts        # VS Code command registration
│   ├── webview-manager.ts        # Webview lifecycle & messaging
│   ├── output-manager.ts         # Output channels
│   ├── status-bar-manager.ts     # Status bar items
│   └── file-system-manager.ts    # File operations
├── messaging/
│   └── event-bus.ts              # Pub/sub + request-response
├── logging/
│   └── logger.ts                 # Structured logging
├── error-handling/
│   └── error-handler.ts          # Error boundaries & notifications
├── config/
│   └── config-manager.ts         # Type-safe configuration
└── validation/
    └── message-validator.service.ts  # Zod-based validation
```

## Core Exports

### DI Container & Tokens

```typescript
import { DIContainer, TOKENS, container } from '@ptah-extension/vscode-core';

// Bootstrap in extension activation
export function activate(context: vscode.ExtensionContext) {
  DIContainer.setup(context);

  // Resolve services
  const logger = container.resolve(TOKENS.LOGGER);
  const eventBus = container.resolve(TOKENS.EVENT_BUS);
}
```

### API Wrappers

```typescript
import { CommandManager, WebviewManager } from '@ptah-extension/vscode-core';

// CommandManager
commandManager.registerCommand({
  id: 'ptah.quickChat',
  handler: async () => { ... },
  context: ['alwaysEnabled']
});

// WebviewManager
webviewManager.createWebviewPanel({
  viewType: 'ptah.main',
  title: 'Ptah Chat',
  viewColumn: vscode.ViewColumn.Beside
});
```

### Event Bus

```typescript
import { EventBus } from '@ptah-extension/vscode-core';

// Publish events
eventBus.publish('chat:messageChunk', { chunk: '...', messageId });

// Subscribe to events
eventBus.subscribe('chat:messageChunk').subscribe((event) => {
  console.log(event.payload);
});

// Request-response pattern
const response = await eventBus.request(
  'chat:sendMessage',
  { content: 'Hello' },
  5000 // timeout
);
```

### Logger

```typescript
import { Logger, LogLevel } from '@ptah-extension/vscode-core';

logger.info('Extension activated', 'Lifecycle');
logger.error('Failed to load config', 'Config', { error });
logger.lifecycle('ComponentInitialized', 'ChatService', { sessionId });
```

### Error Handler

```typescript
import { ErrorHandler } from '@ptah-extension/vscode-core';

// Wrap async operations
await errorHandler.handleAsync(async () => await riskyOperation(), { operation: 'loadConfig', service: 'ConfigManager' });

// Error boundaries
const result = errorHandler.executeWithBoundary(() => {
  // code that might throw
});
```

## Token System

**60+ Dependency Tokens** organized by domain:

```typescript
// VS Code APIs
TOKENS.EXTENSION_CONTEXT;
TOKENS.COMMAND_MANAGER;
TOKENS.WEBVIEW_MANAGER;
TOKENS.OUTPUT_MANAGER;
TOKENS.STATUS_BAR_MANAGER;
TOKENS.FILE_SYSTEM_MANAGER;

// Messaging
TOKENS.EVENT_BUS;
TOKENS.MESSAGE_VALIDATOR;

// Core Infrastructure
TOKENS.LOGGER;
TOKENS.ERROR_HANDLER;
TOKENS.CONFIG_MANAGER;

// Domain Services (registered by main app)
TOKENS.SESSION_MANAGER;
TOKENS.CLAUDE_CLI_SERVICE;
TOKENS.PROVIDER_MANAGER;
TOKENS.CHAT_ORCHESTRATION_SERVICE;
// ... 40+ more tokens
```

**Token Pattern**: All use `Symbol.for()` for cross-module boundary access.

## Dependencies

**External**:

- `vscode` (^1.103.0): VS Code extension API
- `tsyringe` (^4.10.0): Dependency injection
- `eventemitter3` (^5.0.1): Event emitter
- `rxjs` (~7.8.0): Observables for reactive patterns
- `zod` (^3.25.76): Runtime validation

**Internal**:

- `@ptah-extension/shared`: Type definitions only

## Integration Pattern

### Main App Setup

```typescript
// In apps/ptah-extension-vscode/src/main.ts
import { DIContainer, TOKENS } from '@ptah-extension/vscode-core';
import { registerClaudeDomainServices } from '@ptah-extension/claude-domain';
import { registerAIProviderServices } from '@ptah-extension/ai-providers-core';

export async function activate(context: vscode.ExtensionContext) {
  // 1. Bootstrap vscode-core
  DIContainer.setup(context);

  // 2. Register domain services (hierarchical)
  registerWorkspaceIntelligenceServices(container);
  registerAIProviderServices(container);
  registerClaudeDomainServices(container, eventBus, storage);

  // 3. Register app-specific services
  container.registerSingleton(TOKENS.COMMAND_HANDLERS, CommandHandlers);

  // 4. Initialize main extension
  const ptahExtension = container.resolve(TOKENS.PTAH_EXTENSION);
  await ptahExtension.initialize();
}
```

## Manager Patterns

### Command Manager

```typescript
// Register commands
commandManager.registerCommands([
  { id: 'ptah.quickChat', handler: handlers.quickChat },
  { id: 'ptah.reviewFile', handler: handlers.reviewFile },
]);

// Get metrics
const metrics = commandManager.getCommandMetrics();
// { executionCount: 42, totalDuration: 1250, errorCount: 2 }
```

### Webview Manager

```typescript
// Create webview
const panel = webviewManager.createWebviewPanel({
  viewType: 'ptah.main',
  title: 'Ptah',
  viewColumn: vscode.ViewColumn.One,
});

// Send message
await webviewManager.sendMessage('ptah.main', 'chat:messageAdded', {
  message: { id, content, type: 'assistant' },
});

// Get metrics
const metrics = webviewManager.getWebviewMetrics('ptah.main');
// { messageCount: 156, lastActivity: Date, isVisible: true }
```

## Testing

```bash
nx test vscode-core           # Run unit tests
nx test vscode-core --watch   # Watch mode
```

**Test Files** (9 comprehensive test suites):

- `command-manager.spec.ts`
- `webview-manager.spec.ts`
- `event-bus.spec.ts`
- `container.spec.ts`
- `file-system-manager.spec.ts`
- `output-manager.spec.ts`
- `status-bar-manager.spec.ts`
- `container-workspace-intelligence.spec.ts`
- `week2-integration.spec.ts`

## Metrics & Observability

All managers track:

- **Execution counts**: Total operations executed
- **Durations**: Average response times
- **Error rates**: Failed operations count
- **Last activity**: Timestamp of last operation
- **Resource counts**: Active resources (channels, status items, etc.)

## Error Handling Strategy

1. **Error Boundaries**: Wrap all operations safely
2. **Contextual Errors**: Include service, operation, metadata
3. **User Notifications**: Show errors in VS Code UI
4. **Event Publication**: All errors published to EventBus
5. **Structured Logging**: All errors logged with context

## Critical Constraints

1. **Infrastructure Only**: No domain logic or business rules
2. **No Library Pollution**: Never re-export from domain libraries
3. **Symbol-Based Tokens**: Ensures proper module boundary handling
4. **Event Bus Integration**: All operations publish events
5. **Metrics Tracking**: Every operation tracked (success/failure/duration)
6. **Proper Cleanup**: dispose() methods for all managers

## File Paths Reference

- **DI**: `src/di/container.ts`, `src/di/tokens.ts`
- **Wrappers**: `src/api-wrappers/*.ts`
- **Messaging**: `src/messaging/event-bus.ts`
- **Logging**: `src/logging/logger.ts`
- **Config**: `src/config/config-manager.ts`
- **Validation**: `src/validation/message-validator.service.ts`
