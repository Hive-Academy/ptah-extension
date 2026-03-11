# @ptah-extension/agent-sdk

Official Claude Agent SDK wrapper for Ptah Extension.

This library provides a production-ready integration with the `@anthropic-ai/claude-agent-sdk` package, implementing the `IAIProvider` interface with 10x performance improvements over CLI-based integration.

## Features

- **SDK-based Agent Communication**: Direct in-process communication with Claude agents
- **Explicit Parent-Child Relationships**: Eliminates correlation bugs from CLI integration
- **Streaming Support**: Real-time message streaming via AsyncIterable
- **ExecutionNode Transformation**: Converts SDK messages to UI-compatible format
- **Event-Driven**: Integrates with EventBus for reactive UI updates
- **Type-Safe**: Full TypeScript support with branded types (SessionId, MessageId)

## Usage

```typescript
import { SdkAgentAdapter } from '@ptah-extension/agent-sdk';

// Adapter implements IAIProvider interface
const adapter = container.resolve(SdkAgentAdapter);

// Start chat session with streaming
const stream = await adapter.startChatSession(sessionId, {
  projectPath: '/path/to/workspace',
  model: 'claude-sonnet-4.5-20250929',
});

// Consume ExecutionNode messages
for await (const node of stream) {
  console.log('Received node:', node);
}
```

## Architecture

- **SdkAgentAdapter**: Core adapter implementing IAIProvider
- **SdkMessageTransformer**: Transforms SDK messages to ExecutionNode format
- **Event Integration**: Publishes messages to EventBus for UI reactivity

## Dependencies

- `@anthropic-ai/claude-agent-sdk`: Official Claude SDK
- `@ptah-extension/shared`: Type system (ExecutionNode, SessionId)
- `@ptah-extension/vscode-core`: Infrastructure (EventBus, Logger, DI)
- `tsyringe`: Dependency injection

## Build

```bash
nx build agent-sdk
```
