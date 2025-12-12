---
trigger: glob
globs: libs/backend/agent-sdk/**/*.ts
---

# agent-sdk - Claude Agent SDK Integration

**Active**: Working in `libs/backend/agent-sdk/**/*.ts`

## Purpose

Integration layer for @anthropic-ai/claude-agent-sdk. Manages Claude AI sessions, message streaming, tool execution, and conversation state via SDK APIs.

## Responsibilities

✅ **Session Management**: Create, resume, delete Claude sessions via SDK
✅ **Message Streaming**: Real-time token streaming from Claude AI
✅ **Tool Execution**: Handle tool calls from Claude (MCP tools)
✅ **State Synchronization**: Keep frontend in sync with SDK session state
✅ **Error Handling**: Wrap SDK errors in Result<T,E> pattern

❌ **NOT**: UI (→ frontend), multi-provider logic (→ llm-abstraction), VS Code API (→ vscode-core)

## Services

```
libs/backend/agent-sdk/src/lib/services/
├── session-manager.service.ts      # Session CRUD via SDK
├── message-handler.service.ts      # Send messages, handle responses
├── streaming-controller.service.ts # Token streaming orchestration
├── tool-executor.service.ts        # Execute MCP tools requested by Claude
└── sdk-adapter.service.ts          # Direct SDK wrapper
```

## SDK Architecture

```
Claude Agent SDK
  ├─ Session Management (create, resume, delete)
  ├─ Message Streaming (async generators)
  ├─ Tool Execution (MCP server integration)
  └─ State Management (session persistence)

Our Wrapper (agent-sdk lib)
  ├─ SessionManagerService (DI-injected, Result<T,E>)
  ├─ StreamingControllerService (EventBus publishing)
  ├─ ToolExecutorService (MCP tool routing)
  └─ MessageHandlerService (RPC coordination)
```

## SessionManagerService

### Creating Sessions

```typescript
import { SessionManagerService } from '@ptah-extension/agent-sdk';

@injectable()
export class ChatService {
  constructor(@inject(TOKENS.sessionManager) private sessions: SessionManagerService) {}

  async startChat(message: string): Promise<Result<SessionId, Error>> {
    const result = await this.sessions.createSession({
      initialMessage: message,
      model: 'claude-3.5-sonnet',
    });

    if (Result.isOk(result)) {
      this.logger.info('Session created', { sessionId: result.value });
    }

    return result;
  }
}
```

### API

```typescript
export class SessionManagerService {
  constructor(@inject(TOKENS.sdkAdapter) private sdk: SdkAdapterService, @inject(TOKENS.eventBus) private eventBus: EventBus, @inject(TOKENS.logger) private logger: Logger) {}

  async createSession(opts: CreateSessionOptions): Promise<Result<SessionId, SdkError>> {
    try {
      // Use SDK to create session
      const session = await this.sdk.createSession({
        model: opts.model,
        systemPrompt: opts.systemPrompt,
      });

      const sessionId = session.id as SessionId;

      // Publish event
      this.eventBus.publish('session:created', {
        sessionId,
        model: opts.model,
        timestamp: Date.now(),
      });

      return Result.ok(sessionId);
    } catch (error) {
      this.logger.error('Failed to create session', { error });
      return Result.err({
        code: 'SDK_ERROR',
        message: error.message,
        originalError: error,
      });
    }
  }

  async resumeSession(sessionId: SessionId): Promise<Result<void, SdkError>> {
    try {
      await this.sdk.resumeSession(sessionId);

      this.eventBus.publish('session:resumed', { sessionId });

      return Result.ok(undefined);
    } catch (error) {
      return Result.err({
        code: 'SESSION_NOT_FOUND',
        message: `Session ${sessionId} not found`,
        sessionId,
      });
    }
  }

  async deleteSession(sessionId: SessionId): Promise<Result<void, SdkError>> {
    try {
      await this.sdk.deleteSession(sessionId);

      this.eventBus.publish('session:deleted', { sessionId });

      return Result.ok(undefined);
    } catch (error) {
      return Result.err({
        code: 'SDK_ERROR',
        message: error.message,
      });
    }
  }
}
```

## StreamingControllerService

### Streaming Messages

```typescript
export class StreamingControllerService {
  constructor(@inject(TOKENS.sdkAdapter) private sdk: SdkAdapterService, @inject(TOKENS.eventBus) private eventBus: EventBus, @inject(TOKENS.webviewManager) private webview: WebviewManager) {}

  async streamMessage(sessionId: SessionId, message: string): Promise<Result<MessageId, SdkError>> {
    try {
      // Start streaming
      this.eventBus.publish('stream:started', { sessionId });

      // Send to frontend
      this.webview.postMessage({
        type: 'chat:streaming:started',
        payload: { sessionId },
      });

      // Stream tokens via SDK
      const stream = this.sdk.streamMessage(sessionId, message);

      for await (const token of stream) {
        // Publish to EventBus
        this.eventBus.publish('stream:token', {
          sessionId,
          token: token.content,
        });

        // Send to frontend
        this.webview.postMessage({
          type: 'chat:streaming',
          payload: {
            sessionId,
            token: token.content,
          },
        });
      }

      // Stream complete
      const messageId = uuid() as MessageId;

      this.eventBus.publish('stream:complete', {
        sessionId,
        messageId,
      });

      this.webview.postMessage({
        type: 'chat:complete',
        payload: { sessionId, messageId },
      });

      return Result.ok(messageId);
    } catch (error) {
      this.logger.error('Streaming failed', { sessionId, error });

      this.webview.postMessage({
        type: 'chat:error',
        payload: {
          sessionId,
          error: { code: 'STREAM_ERROR', message: error.message },
        },
      });

      return Result.err({
        code: 'STREAM_ERROR',
        message: error.message,
      });
    }
  }

  stopStream(sessionId: SessionId): void {
    this.sdk.stopStream(sessionId);

    this.eventBus.publish('stream:stopped', { sessionId });

    this.webview.postMessage({
      type: 'chat:stopped',
      payload: { sessionId },
    });
  }
}
```

## ToolExecutorService

### Handling Tool Calls

```typescript
export class ToolExecutorService {
  constructor(@inject(TOKENS.eventBus) private eventBus: EventBus, @inject(TOKENS.logger) private logger: Logger) {}

  async executeTool(toolName: string, args: unknown): Promise<Result<unknown, ToolError>> {
    this.logger.info('Executing tool', { toolName, args });

    try {
      // Route to appropriate handler
      switch (toolName) {
        case 'read_file':
          return await this.readFile(args as { path: string });

        case 'write_file':
          return await this.writeFile(args as { path: string; content: string });

        case 'list_directory':
          return await this.listDirectory(args as { path: string });

        case 'execute_command':
          return await this.executeCommand(args as { command: string });

        default:
          return Result.err({
            code: 'UNKNOWN_TOOL',
            message: `Tool ${toolName} not found`,
            toolName,
          });
      }
    } catch (error) {
      this.logger.error('Tool execution failed', { toolName, error });

      return Result.err({
        code: 'TOOL_ERROR',
        message: error.message,
        toolName,
      });
    }
  }

  private async readFile(args: { path: string }): Promise<Result<string, ToolError>> {
    // Delegate to workspace service
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(args.path));
    return Result.ok(content.toString());
  }

  private async writeFile(args: { path: string; content: string }): Promise<Result<void, ToolError>> {
    const content = Buffer.from(args.content, 'utf8');
    await vscode.workspace.fs.writeFile(vscode.Uri.file(args.path), content);
    return Result.ok(undefined);
  }
}
```

## SdkAdapterService (Direct SDK Wrapper)

### Wrapping SDK Methods

```typescript
import { ClaudeAgentSDK } from '@anthropic-ai/claude-agent-sdk';

export class SdkAdapterService {
  private sdk: ClaudeAgentSDK;

  constructor(@inject(TOKENS.logger) private logger: Logger) {
    this.sdk = new ClaudeAgentSDK({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async createSession(opts: { model: string; systemPrompt?: string }): Promise<Session> {
    return await this.sdk.sessions.create({
      model: opts.model,
      system_prompt: opts.systemPrompt,
    });
  }

  async resumeSession(sessionId: string): Promise<Session> {
    return await this.sdk.sessions.resume(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sdk.sessions.delete(sessionId);
  }

  streamMessage(sessionId: string, message: string): AsyncGenerator<Token> {
    return this.sdk.messages.stream(sessionId, {
      role: 'user',
      content: message,
    });
  }

  stopStream(sessionId: string): void {
    this.sdk.messages.stopStream(sessionId);
  }
}
```

## Integration with Frontend

### RPC Message Flow

```
Frontend (VSCodeService)
  ↓ postMessage({ type: 'chat:start', payload: { message, model } })
Extension (RPC Handler)
  ↓ Extract message, model
SessionManagerService
  ↓ createSession(model)
SdkAdapterService
  ↓ sdk.sessions.create()
StreamingControllerService
  ↓ streamMessage(sessionId, message)
SdkAdapterService
  ↓ for await (token of sdk.messages.stream())
StreamingControllerService
  ↓ webview.postMessage({ type: 'chat:streaming', payload: { token } })
Frontend (VSCodeService)
  ↓ onMessage('chat:streaming', handler)
ChatService
  ↓ appendToken(token)
```

## Error Handling

### SDK Error Codes

```typescript
export enum SdkErrorCode {
  SDK_ERROR = 'SDK_ERROR',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  STREAM_ERROR = 'STREAM_ERROR',
  TOOL_ERROR = 'TOOL_ERROR',
  UNKNOWN_TOOL = 'UNKNOWN_TOOL',
  RATE_LIMITED = 'RATE_LIMITED',
  UNAUTHORIZED = 'UNAUTHORIZED',
}

export interface SdkError {
  code: SdkErrorCode;
  message: string;
  sessionId?: SessionId;
  toolName?: string;
  originalError?: unknown;
}
```

## Testing

### Mocking SDK

```typescript
import { SdkAdapterService } from './sdk-adapter.service';

describe('SessionManagerService', () => {
  let service: SessionManagerService;
  let mockSdk: jest.Mocked<SdkAdapterService>;

  beforeEach(() => {
    mockSdk = {
      createSession: jest.fn(),
      resumeSession: jest.fn(),
      deleteSession: jest.fn(),
    } as any;

    container.registerInstance(TOKENS.sdkAdapter, mockSdk);
    service = container.resolve(SessionManagerService);
  });

  it('should create session via SDK', async () => {
    mockSdk.createSession.mockResolvedValue({
      id: 'sess-123',
      model: 'claude-3.5-sonnet',
    });

    const result = await service.createSession({
      model: 'claude-3.5-sonnet',
    });

    expect(Result.isOk(result)).toBe(true);
    expect(mockSdk.createSession).toHaveBeenCalledWith({
      model: 'claude-3.5-sonnet',
    });
  });
});
```

## Rules

1. **Wrap SDK in Result<T,E>** - Never throw, always return Result
2. **Publish events** - All state changes via EventBus
3. **WebviewManager for frontend** - Send streaming tokens in real-time
4. **DI for services** - Register with TOKENS from vscode-core
5. **Log all operations** - Include sessionId in every log

## Commands

```bash
nx test agent-sdk
nx build agent-sdk
nx typecheck agent-sdk
```
