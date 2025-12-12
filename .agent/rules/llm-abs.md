---
trigger: glob
globs: libs/backend/llm-abstraction/**/*.ts
---

# llm-abstraction - Multi-Provider LLM Layer

**Active**: Working in `libs/backend/llm-abstraction/**/*.ts`

## Purpose

Provider-agnostic LLM abstraction layer supporting multiple AI providers (Claude CLI, OpenAI, VS Code LM API). Enables switching providers without changing business logic.

## Responsibilities

✅ **Provider Abstraction**: Unified interface for all LLM providers
✅ **Provider Selection**: Intelligent selection based on availability/capabilities  
✅ **Context Management**: Format context for each provider's API
✅ **Response Normalization**: Normalize provider responses to common format
✅ **Error Handling**: Wrap provider errors in Result<T,E>

❌ **NOT**: Session management (→ agent-sdk), VS Code API (→ vscode-core), UI (→ frontend)

## Providers Supported

1. **Claude CLI** (via @anthropic-ai/claude-agent-sdk)
2. **VS Code LM API** (vscode.lm.\*)
3. **OpenAI** (future - via LangChain)

## Services

```
libs/backend/llm-abstraction/src/lib/
├── services/
│   ├── llm-provider.service.ts          # Main entry point
│   ├── provider-registry.service.ts     # Provider registration
│   └── context-formatter.service.ts     # Format context per provider
├── providers/
│   ├── claude-cli.provider.ts           # Claude CLI implementation
│   ├── vscode-lm.provider.ts            # VS Code LM implementation
│   └── openai.provider.ts               # OpenAI implementation
└── types/
    └── provider.types.ts                # Provider interface
```

## Provider Interface

```typescript
export interface ILlmProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapability[];

  // Lifecycle
  initialize(): Promise<Result<void, ProviderError>>;
  isAvailable(): Promise<boolean>;

  // Core operations
  sendMessage(request: LlmRequest): Promise<Result<LlmResponse, ProviderError>>;
  streamMessage(request: LlmRequest): AsyncGenerator<LlmToken, void, unknown>;
  stopStream(requestId: string): void;

  // Models
  getModels(): Promise<Result<LlmModel[], ProviderError>>;
  getDefaultModel(): string;
}

export enum ProviderCapability {
  Chat = 'chat',
  Streaming = 'streaming',
  FunctionCalling = 'function_calling',
  Vision = 'vision',
  LongContext = 'long_context',
}
```

## LlmProviderService (Main Entry)

```typescript
import { LlmProviderService } from '@ptah-extension/llm-abstraction';

@injectable()
export class ChatOrchestrator {
  constructor(@inject(TOKENS.llmProvider) private llm: LlmProviderService) {}

  async sendMessage(message: string): Promise<Result<string, Error>> {
    // Auto-selects best available provider
    const result = await this.llm.sendMessage({
      message,
      model: 'claude-3.5-sonnet', // Provider-specific model
      context: this.buildContext(),
    });

    if (Result.isOk(result)) {
      return Result.ok(result.value.content);
    }

    return Result.err(result.error);
  }
}
```

### API

```typescript
export class LlmProviderService {
  private providers: Map<string, ILlmProvider> = new Map();
  private selectedProviderId: string | null = null;

  constructor(@inject(TOKENS.providerRegistry) private registry: ProviderRegistryService, @inject(TOKENS.logger) private logger: Logger) {}

  async initialize(): Promise<void> {
    // Register all providers
    await this.registry.registerProvider(new ClaudeCliProvider());
    await this.registry.registerProvider(new VsCodeLmProvider());

    // Select best available
    await this.selectBestProvider();
  }

  private async selectBestProvider(): Promise<void> {
    const providers = await this.registry.getAvailableProviders();

    if (providers.length === 0) {
      throw new Error('No LLM providers available');
    }

    // Priority: Claude CLI > VS Code LM > OpenAI
    const priority = ['claude-cli', 'vscode-lm', 'openai'];

    for (const id of priority) {
      if (providers.some((p) => p.id === id)) {
        this.selectedProviderId = id;
        this.logger.info(`Selected provider: ${id}`);
        return;
      }
    }

    // Fallback to first available
    this.selectedProviderId = providers[0].id;
  }

  async sendMessage(request: LlmRequest): Promise<Result<LlmResponse, ProviderError>> {
    const provider = await this.getSelectedProvider();

    if (!provider) {
      return Result.err({
        code: 'NO_PROVIDER',
        message: 'No LLM provider available',
      });
    }

    this.logger.info('Sending message', {
      provider: provider.id,
      model: request.model,
    });

    return await provider.sendMessage(request);
  }

  async streamMessage(request: LlmRequest): AsyncGenerator<LlmToken> {
    const provider = await this.getSelectedProvider();

    if (!provider) {
      throw new Error('No LLM provider available');
    }

    yield * provider.streamMessage(request);
  }

  private async getSelectedProvider(): Promise<ILlmProvider | null> {
    if (!this.selectedProviderId) {
      await this.selectBestProvider();
    }

    return this.registry.getProvider(this.selectedProviderId!);
  }
}
```

## ClaudeCliProvider

```typescript
import { ClaudeAgentSDK } from '@anthropic-ai/claude-agent-sdk';

export class ClaudeCliProvider implements ILlmProvider {
  readonly id = 'claude-cli';
  readonly name = 'Claude CLI';
  readonly capabilities = [ProviderCapability.Chat, ProviderCapability.Streaming, ProviderCapability.FunctionCalling, ProviderCapability.Vision, ProviderCapability.LongContext];

  private sdk: ClaudeAgentSDK;

  async initialize(): Promise<Result<void, ProviderError>> {
    try {
      this.sdk = new ClaudeAgentSDK();
      return Result.ok(undefined);
    } catch (error) {
      return Result.err({
        code: 'INIT_ERROR',
        message: 'Failed to initialize Claude CLI',
        provider: this.id,
      });
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Claude CLI is installed
      await exec('claude --version');
      return true;
    } catch {
      return false;
    }
  }

  async sendMessage(request: LlmRequest): Promise<Result<LlmResponse, ProviderError>> {
    try {
      const response = await this.sdk.messages.create({
        model: request.model,
        messages: [{ role: 'user', content: request.message }],
        system: request.systemPrompt,
        max_tokens: request.maxTokens ?? 4096,
      });

      return Result.ok({
        content: response.content[0].text,
        model: response.model,
        tokens: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
      });
    } catch (error) {
      return Result.err({
        code: 'API_ERROR',
        message: error.message,
        provider: this.id,
      });
    }
  }

  async *streamMessage(request: LlmRequest): AsyncGenerator<LlmToken> {
    const stream = this.sdk.messages.stream({
      model: request.model,
      messages: [{ role: 'user', content: request.message }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta') {
        yield {
          content: chunk.delta.text,
          done: false,
        };
      } else if (chunk.type === 'message_stop') {
        yield {
          content: '',
          done: true,
        };
      }
    }
  }

  getDefaultModel(): string {
    return 'claude-3.5-sonnet-20241022';
  }
}
```

## VsCodeLmProvider

```typescript
import * as vscode from 'vscode';

export class VsCodeLmProvider implements ILlmProvider {
  readonly id = 'vscode-lm';
  readonly name = 'VS Code LM API';
  readonly capabilities = [ProviderCapability.Chat, ProviderCapability.Streaming];

  async initialize(): Promise<Result<void, ProviderError>> {
    return Result.ok(undefined);
  }

  async isAvailable(): Promise<boolean> {
    const models = await vscode.lm.selectChatModels();
    return models.length > 0;
  }

  async sendMessage(request: LlmRequest): Promise<Result<LlmResponse, ProviderError>> {
    try {
      const models = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: 'gpt-4',
      });

      if (models.length === 0) {
        return Result.err({
          code: 'NO_MODEL',
          message: 'No VS Code LM models available',
          provider: this.id,
        });
      }

      const model = models[0];
      const messages = [vscode.LanguageModelChatMessage.User(request.message)];

      const response = await model.sendRequest(messages);

      let content = '';
      for await (const chunk of response.text) {
        content += chunk;
      }

      return Result.ok({
        content,
        model: model.id,
        tokens: {
          input: 0, // VS Code API doesn't expose
          output: 0,
        },
      });
    } catch (error) {
      return Result.err({
        code: 'API_ERROR',
        message: error.message,
        provider: this.id,
      });
    }
  }

  async *streamMessage(request: LlmRequest): AsyncGenerator<LlmToken> {
    const models = await vscode.lm.selectChatModels();
    const model = models[0];

    const messages = [vscode.LanguageModelChatMessage.User(request.message)];

    const response = await model.sendRequest(messages);

    for await (const chunk of response.text) {
      yield {
        content: chunk,
        done: false,
      };
    }

    yield {
      content: '',
      done: true,
    };
  }

  getDefaultModel(): string {
    return 'copilot-gpt-4';
  }
}
```

## Context Formatting

```typescript
export class ContextFormatterService {
  formatForProvider(providerId: string, context: ChatContext): string {
    switch (providerId) {
      case 'claude-cli':
        return this.formatForClaude(context);

      case 'vscode-lm':
        return this.formatForVsCodeLm(context);

      default:
        return this.formatGeneric(context);
    }
  }

  private formatForClaude(context: ChatContext): string {
    return `
<workspace>
  <files>
    ${context.files.map((f) => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n')}
  </files>
  <conversation>
    ${context.messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n')}
  </conversation>
</workspace>
    `.trim();
  }

  private formatForVsCodeLm(context: ChatContext): string {
    // VS Code LM prefers simpler format
    return context.files.map((f) => `File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
  }
}
```

## Testing

```typescript
describe('LlmProviderService', () => {
  let service: LlmProviderService;
  let mockClaudeProvider: jest.Mocked<ILlmProvider>;

  beforeEach(() => {
    mockClaudeProvider = {
      id: 'claude-cli',
      isAvailable: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn(),
    } as any;

    service = new LlmProviderService(registry, logger);
  });

  it('should select Claude CLI if available', async () => {
    await service.initialize();

    const result = await service.sendMessage({
      message: 'Hello',
    });

    expect(mockClaudeProvider.sendMessage).toHaveBeenCalled();
  });
});
```

## Rules

1. **Provider interface** - All providers implement ILlmProvider
2. **Result<T,E>** - Wrap all provider errors
3. **Capability-based selection** - Check capabilities before use
4. **Fallback chain** - Claude CLI → VS Code LM → OpenAI
5. **Context formatting** - Format context per provider needs

## Commands

```bash
nx test llm-abstraction
nx build llm-abstraction
nx typecheck llm-abstraction
```
