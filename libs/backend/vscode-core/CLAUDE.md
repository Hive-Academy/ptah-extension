# libs/backend/vscode-core - Infrastructure Layer

[Back to Main](../../../CLAUDE.md)

## Purpose

The **vscode-core library** is the infrastructure foundation of Ptah Extension. It provides core utilities, API wrappers, dependency injection tokens, logging, error handling, configuration management, and validation services. This library abstracts VS Code API interactions and establishes architectural patterns for all backend services.

## Boundaries

**Belongs here**:

- VS Code API wrappers (commands, webviews, file system, status bar, output channels)
- Dependency injection tokens (TOKENS namespace)
- Cross-cutting concerns (logging, error handling, validation, configuration)
- RPC messaging infrastructure for agent SDK integration
- Agent session watching for real-time summary streaming

**Does NOT belong**:

- Business logic (belongs in domain libraries like `claude-domain`, `agent-generation`)
- DI container registration (centralized in `apps/ptah-extension-vscode/src/di/container.ts`)
- Domain-specific services (workspace analysis, AI providers, agent generation)
- Frontend components (belongs in `frontend/` libraries)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Core Infrastructure Layer                │
├──────────────────────────────────────────────────────┤
│  API Wrappers (VS Code abstraction)                  │
│  ├─ CommandManager      - Command registration       │
│  ├─ WebviewManager      - Webview lifecycle          │
│  ├─ OutputManager       - Output channels            │
│  ├─ StatusBarManager    - Status bar items           │
│  └─ FileSystemManager   - File operations            │
├──────────────────────────────────────────────────────┤
│  Cross-Cutting Services                              │
│  ├─ Logger              - Structured logging         │
│  ├─ ErrorHandler        - Error boundary pattern     │
│  ├─ ConfigManager       - Configuration mgmt         │
│  └─ MessageValidatorService - Message validation     │
├──────────────────────────────────────────────────────┤
│  Messaging Infrastructure                            │
│  ├─ RpcHandler          - RPC method routing         │
│  └─ SdkRpcHandlers      - Agent SDK RPC handlers     │
├──────────────────────────────────────────────────────┤
│  Agent Integration                                   │
│  └─ AgentSessionWatcherService - Real-time summaries │
├──────────────────────────────────────────────────────┤
│  Dependency Injection                                │
│  └─ TOKENS              - DI token definitions       │
└──────────────────────────────────────────────────────┘
```

## Key Files

### API Wrappers

- `api-wrappers/command-manager.ts` - Command registration with disposable tracking
- `api-wrappers/webview-manager.ts` - Webview panel lifecycle management
- `api-wrappers/output-manager.ts` - Output channel management
- `api-wrappers/status-bar-manager.ts` - Status bar item management
- `api-wrappers/file-system-manager.ts` - File operations with event support

### Core Services

- `logging/logger.ts` - Structured logging with levels (DEBUG, INFO, WARN, ERROR)
- `error-handling/error-handler.ts` - Error boundary with context capture
- `config/config-manager.ts` - Configuration watching with reactive updates
- `validation/message-validator.service.ts` - Message protocol validation

### Messaging Infrastructure

- `messaging/rpc-handler.ts` - RPC method registration and execution
- `messaging/sdk-rpc-handlers.ts` - Agent SDK RPC method handlers
- `messaging/rpc-types.ts` - RPC message type definitions

### Agent Integration

- `services/agent-session-watcher.service.ts` - Real-time summary streaming

### Dependency Injection

- `di/tokens.ts` - Centralized DI token definitions (TOKENS namespace)

## Dependencies

**Internal**:

- `@ptah-extension/shared` - Type definitions (Result, message types)

**External**:

- `vscode` (^1.96.0) - VS Code Extension API
- `tsyringe` (^4.10.0) - Dependency injection container
- `eventemitter3` (^5.0.1) - Event emitter for reactive patterns
- `rxjs` (^7.8.1) - Reactive programming utilities

## Import Path

```typescript
import { Logger, ErrorHandler, ConfigManager, CommandManager, WebviewManager, OutputManager, StatusBarManager, FileSystemManager, MessageValidatorService, RpcHandler, SdkRpcHandlers, AgentSessionWatcherService, TOKENS } from '@ptah-extension/vscode-core';

// Type imports
import type { LogLevel, LogContext, ErrorContext, CommandDefinition, WebviewPanelConfig, OutputChannelConfig, StatusBarItemConfig, FileOperationOptions, RpcMessage, RpcResponse, AgentSummaryChunk } from '@ptah-extension/vscode-core';
```

## Commands

```bash
# Build library
nx build vscode-core

# Run tests
nx test vscode-core

# Type-check
nx run vscode-core:typecheck

# Lint
nx lint vscode-core
```

## Usage Examples

### Logger

```typescript
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { inject, singleton } from 'tsyringe';

@singleton()
export class MyService {
  constructor(@inject(TOKENS.Logger) private logger: Logger) {}

  async doWork(): Promise<void> {
    this.logger.info('Starting work', { operation: 'doWork' });

    try {
      await this.performOperation();
      this.logger.debug('Operation completed', { success: true });
    } catch (error) {
      this.logger.error('Operation failed', { error });
    }
  }
}
```

### Error Handler

```typescript
import { ErrorHandler } from '@ptah-extension/vscode-core';

const errorHandler = new ErrorHandler(logger);

const result = await errorHandler.withErrorBoundary(
  async () => {
    return await riskyOperation();
  },
  {
    context: { operation: 'riskyOperation', userId: 'user123' },
    fallbackValue: null,
    onError: (error, context) => {
      notifyUser(`Operation failed: ${error.message}`);
    },
  }
);
```

### Command Manager

```typescript
import { CommandManager } from '@ptah-extension/vscode-core';

const commandManager = new CommandManager(context, logger);

commandManager.registerCommand({
  command: 'ptah.openChat',
  handler: async () => {
    await webviewManager.showPanel();
  },
  thisArg: this,
});

// Cleanup handled automatically via VS Code context.subscriptions
```

### Webview Manager

```typescript
import { WebviewManager } from '@ptah-extension/vscode-core';

const webviewManager = new WebviewManager(context, logger);

const panel = webviewManager.createPanel({
  viewType: 'ptah.chatView',
  title: 'Ptah Chat',
  viewColumn: vscode.ViewColumn.One,
  options: {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
  },
});

// Post messages to webview
webviewManager.postMessage(panel, {
  type: 'chat.message',
  payload: { text: 'Hello from extension!' },
});

// Listen for messages from webview
webviewManager.onDidReceiveMessage(panel, (message) => {
  console.log('Received:', message);
});
```

### Config Manager

```typescript
import { ConfigManager } from '@ptah-extension/vscode-core';

const configManager = new ConfigManager(logger);

// Get configuration value
const apiKey = configManager.get<string>('ptah.apiKey');
const timeout = configManager.get<number>('ptah.timeout', 5000);

// Watch for changes
const watcher = configManager.watch('ptah.apiKey', (newValue, oldValue) => {
  logger.info('API key changed', { newValue, oldValue });
  reconnectToAPI(newValue);
});

// Stop watching
watcher.dispose();

// Update configuration
await configManager.update('ptah.enableLogging', true, ConfigurationTarget.Global);
```

### Message Validator

```typescript
import { MessageValidatorService } from '@ptah-extension/vscode-core';

const validator = new MessageValidatorService(logger);

// Validate message
const result = validator.validate({
  type: 'chat.send',
  correlationId: '123',
  payload: { text: 'Hello' },
});

if (!result.success) {
  logger.error('Invalid message', { error: result.error });
  return;
}

// Use validated message
const validatedMessage = result.value;
```

### RPC Handler

```typescript
import { RpcHandler } from '@ptah-extension/vscode-core';

const rpcHandler = new RpcHandler(logger);

// Register RPC method
rpcHandler.registerMethod('getSessionHistory', async (params) => {
  const { sessionId } = params;
  const history = await sessionStorage.getHistory(sessionId);
  return { messages: history };
});

// Handle RPC message
const rpcMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'getSessionHistory',
  params: { sessionId: 'session-123' },
};

const response = await rpcHandler.handleMessage(rpcMessage);
// { jsonrpc: '2.0', id: 1, result: { messages: [...] } }
```

### Agent Session Watcher

```typescript
import { AgentSessionWatcherService } from '@ptah-extension/vscode-core';

const watcher = new AgentSessionWatcherService(logger);

// Watch for summary chunks
watcher.onSummaryChunk((chunk) => {
  console.log(`Session ${chunk.sessionId}: ${chunk.content}`);

  if (chunk.isComplete) {
    console.log('Summary complete:', chunk.fullSummary);
  }
});

// Trigger summary generation (called by agent SDK)
watcher.startWatchingSession('session-123');
```

## Guidelines

### Dependency Injection Pattern

1. **Only export TOKENS, not individual DI tokens**:

   ```typescript
   // ✅ CORRECT
   import { TOKENS } from '@ptah-extension/vscode-core';
   @inject(TOKENS.Logger) private logger: Logger

   // ❌ WRONG
   import { LoggerToken } from '@ptah-extension/vscode-core';
   @inject(LoggerToken) private logger: Logger
   ```

2. **DI registration happens in app layer**:

   - Container setup: `apps/ptah-extension-vscode/src/di/container.ts`
   - This library only defines services and tokens
   - Never register services in library code

3. **Use constructor injection for all dependencies**:
   ```typescript
   @singleton()
   export class MyService {
     constructor(@inject(TOKENS.Logger) private logger: Logger, @inject(TOKENS.ConfigManager) private config: ConfigManager) {}
   }
   ```

### Error Handling

1. **Always use structured logging with context**:

   ```typescript
   this.logger.error('Operation failed', {
     operation: 'processFile',
     filePath: file.path,
     error: error.message,
   });
   ```

2. **Use ErrorHandler for async operations**:

   ```typescript
   const result = await this.errorHandler.withErrorBoundary(() => this.riskyOperation(), { context: { operation: 'riskyOp' }, fallbackValue: null });
   ```

3. **Never swallow errors silently**:

   ```typescript
   // ❌ WRONG
   try {
     await operation();
   } catch (error) {
     // Silent failure
   }

   // ✅ CORRECT
   try {
     await operation();
   } catch (error) {
     this.logger.error('Operation failed', { error });
     throw error; // or return error result
   }
   ```

### API Wrapper Usage

1. **Use managers for all VS Code API interactions**:

   ```typescript
   // ✅ CORRECT - Use manager
   commandManager.registerCommand({ command: 'ptah.cmd', handler: fn });

   // ❌ WRONG - Direct VS Code API
   context.subscriptions.push(vscode.commands.registerCommand('ptah.cmd', fn));
   ```

2. **Managers handle resource cleanup automatically**:

   - Commands, webviews, output channels automatically disposed
   - No need for manual subscription tracking

3. **Always provide type-safe configurations**:
   ```typescript
   const panel = webviewManager.createPanel({
     viewType: 'ptah.view',
     title: 'Ptah',
     viewColumn: vscode.ViewColumn.One,
     options: {
       enableScripts: true,
       retainContextWhenHidden: true,
     },
   });
   ```

### Messaging Infrastructure

1. **RPC methods must be registered before use**:

   ```typescript
   rpcHandler.registerMethod('methodName', async (params) => {
     // Implementation
     return result;
   });
   ```

2. **RPC handlers should validate params**:

   ```typescript
   rpcHandler.registerMethod('getSession', async (params) => {
     if (!params.sessionId) {
       throw new Error('sessionId is required');
     }
     return await sessionStorage.get(params.sessionId);
   });
   ```

3. **Use SdkRpcHandlers for agent SDK integration**:
   ```typescript
   const handlers = new SdkRpcHandlers(sessionStorage, logger);
   handlers.registerAll(rpcHandler);
   ```

## Testing

```bash
# Run tests
nx test vscode-core

# Run tests with coverage
nx test vscode-core --coverage

# Run specific test file
nx test vscode-core --testFile=command-manager.spec.ts
```

## File Paths Reference

- **API Wrappers**: `src/api-wrappers/`
- **Logging**: `src/logging/`
- **Error Handling**: `src/error-handling/`
- **Configuration**: `src/config/`
- **Validation**: `src/validation/`
- **Messaging**: `src/messaging/`
- **Services**: `src/services/`
- **DI Tokens**: `src/di/tokens.ts`
- **Entry Point**: `src/index.ts`

## Integration Points

This library is used by:

- **Backend domain libraries**: `claude-domain`, `agent-generation`, `agent-sdk`, `llm-abstraction`, `workspace-intelligence`
- **Main extension**: `apps/ptah-extension-vscode`
- **All services requiring**: Logging, error handling, VS Code API access, DI tokens

## Performance Considerations

- **Logging**: Use debug level for verbose logs, avoid logging in tight loops
- **Error Handling**: ErrorHandler adds minimal overhead (< 1ms)
- **Config Manager**: Caches configuration values, watch callbacks are debounced
- **Webview Manager**: Reuses panels when possible, handles serialization efficiently
- **Command Manager**: Zero overhead registration, uses native VS Code command system

## Migration Notes

**TASK_2025_051**: RpcMethodRegistrationService moved to app layer to break circular dependency:

- Old location: `vscode-core/src/messaging/rpc-method-registration.service.ts`
- New location: `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts`
- Reason: Break circular dependency between `vscode-core` and `agent-sdk`

**TASK_CORE_001**: DI container registration centralized:

- Old pattern: Libraries registered their own services
- New pattern: All registration in `apps/ptah-extension-vscode/src/di/container.ts`
- Libraries only export services and TOKENS namespace
