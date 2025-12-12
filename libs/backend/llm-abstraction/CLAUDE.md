# libs/backend/llm-abstraction - Multi-Provider LLM Abstraction Layer

[Back to Main](../../../CLAUDE.md)

## Purpose

The **llm-abstraction library** provides a unified interface for multiple Large Language Model (LLM) providers using Langchain. It abstracts away provider-specific implementations, enabling seamless switching between Anthropic, OpenAI, Google Gemini, OpenRouter, and VS Code Language Model API. This library powers agent generation, content processing, and AI-driven features in Ptah Extension.

## Boundaries

**Belongs here**:

- LLM provider abstraction (ILlmProvider interface)
- Provider implementations (Anthropic, OpenAI, Google GenAI, OpenRouter, VS Code LM)
- Provider registry and selection logic
- Langchain integration and configuration
- Model configuration and parameter management
- Streaming response handling

**Does NOT belong**:

- Business logic for specific features (belongs in domain libraries)
- Agent-specific prompts (belongs in `agent-generation`)
- VS Code API wrappers (belongs in `vscode-core`)
- Session management (belongs in `agent-sdk` or `claude-domain`)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│         LLM Abstraction & Provider Layer              │
├──────────────────────────────────────────────────────┤
│  LlmService (High-level API)                         │
│  └─ Provider selection & orchestration                │
├──────────────────────────────────────────────────────┤
│  ProviderRegistry                                    │
│  └─ Provider registration & lookup                   │
├──────────────────────────────────────────────────────┤
│  ILlmProvider Implementations                        │
│  ├─ AnthropicProvider     - Claude (Langchain)       │
│  ├─ OpenAIProvider        - GPT (Langchain)          │
│  ├─ GoogleGenAIProvider   - Gemini (Langchain)       │
│  ├─ OpenRouterProvider    - Multi-model (Langchain)  │
│  └─ VsCodeLmProvider      - VS Code LM API           │
├──────────────────────────────────────────────────────┤
│  BaseLlmProvider (Abstract base class)               │
│  ├─ Common streaming logic                           │
│  ├─ Error handling                                   │
│  └─ Configuration management                         │
├──────────────────────────────────────────────────────┤
│  Langchain Integration                               │
│  └─ ChatAnthropic, ChatOpenAI, ChatGoogleGenerativeAI│
└──────────────────────────────────────────────────────┘
```

## Key Files

### Core Interfaces

- `interfaces/llm-provider.interface.ts` - ILlmProvider interface definition

### Provider Implementations

- `providers/base-llm.provider.ts` - Abstract base class for providers
- `providers/anthropic.provider.ts` - Anthropic Claude via Langchain
- `providers/openai.provider.ts` - OpenAI GPT via Langchain
- `providers/google-genai.provider.ts` - Google Gemini via Langchain
- `providers/openrouter.provider.ts` - OpenRouter multi-model via Langchain
- `providers/vscode-lm.provider.ts` - VS Code Language Model API

### Registry & Service

- `registry/provider-registry.ts` - Provider registration and lookup
- `services/llm.service.ts` - High-level LLM service orchestration

### Error Handling

- `errors/llm-provider.error.ts` - LLM-specific error classes

### Dependency Injection

- `di/registration.ts` - DI registration function

## Dependencies

**Internal**:

- `@ptah-extension/shared` - Type definitions (Result, CorrelationId)
- `@ptah-extension/vscode-core` - Logger, TOKENS

**External**:

- `@langchain/core` (^0.3.29) - Langchain core abstractions
- `@langchain/anthropic` (^0.3.11) - Anthropic integration
- `@langchain/openai` (^0.3.17) - OpenAI integration
- `@langchain/google-genai` (^0.1.7) - Google Gemini integration
- `langchain` (^0.3.9) - Langchain utilities
- `zod` (^3.23.8) - Schema validation
- `tsyringe` (^4.10.0) - Dependency injection
- `vscode` (^1.96.0) - VS Code Extension API (for VsCodeLmProvider)

## Import Path

```typescript
import { LlmService, ProviderRegistry, AnthropicProvider, OpenAIProvider, GoogleGenAIProvider, OpenRouterProvider, VsCodeLmProvider, BaseLlmProvider, registerLlmAbstraction } from '@ptah-extension/llm-abstraction';

// Interface imports
import type { ILlmProvider, LlmGenerateRequest, LlmGenerateResponse, LlmStreamChunk } from '@ptah-extension/llm-abstraction';

// Error imports
import { LlmProviderError, ProviderNotFoundError, ModelNotAvailableError } from '@ptah-extension/llm-abstraction';
```

## Commands

```bash
# Build library
nx build llm-abstraction

# Run tests
nx test llm-abstraction

# Type-check
nx run llm-abstraction:typecheck

# Lint
nx lint llm-abstraction
```

## Usage Examples

### LLM Service (High-level API)

```typescript
import { LlmService } from '@ptah-extension/llm-abstraction';

const llmService = container.resolve(LlmService);

// Generate content with default provider
const response = await llmService.generate({
  correlationId: 'corr-123',
  prompt: 'Explain TypeScript generics',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxTokens: 1000,
});

console.log(response.content);
// "TypeScript generics provide a way to create reusable components..."

// Generate with specific provider
const openAIResponse = await llmService.generate({
  correlationId: 'corr-456',
  prompt: 'Write a React component',
  provider: 'openai',
  model: 'gpt-4-turbo',
  temperature: 0.7,
});

// Stream responses
await llmService.generateStream({
  correlationId: 'corr-789',
  prompt: 'Write a long article about AI',
  model: 'claude-3-5-sonnet-20241022',
  onChunk: (chunk) => {
    process.stdout.write(chunk.content);
  },
  onComplete: () => {
    console.log('\n\nStream complete!');
  },
});
```

### Provider Registry

```typescript
import { ProviderRegistry } from '@ptah-extension/llm-abstraction';

const registry = container.resolve(ProviderRegistry);

// Register provider
registry.register('anthropic', anthropicProvider);
registry.register('openai', openAIProvider);

// Get provider by name
const provider = registry.get('anthropic');

// List all providers
const providers = registry.list();
// ['anthropic', 'openai', 'google-genai', 'openrouter', 'vscode-lm']

// Check if provider exists
const hasOpenAI = registry.has('openai');
// true
```

### Anthropic Provider

```typescript
import { AnthropicProvider } from '@ptah-extension/llm-abstraction';

const anthropicProvider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  logger,
});

// Generate content
const response = await anthropicProvider.generate({
  correlationId: 'corr-123',
  prompt: 'Explain dependency injection',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxTokens: 1000,
});

// Stream content
const stream = anthropicProvider.generateStream({
  correlationId: 'corr-456',
  prompt: 'Write a tutorial',
  model: 'claude-3-5-sonnet-20241022',
});

for await (const chunk of stream) {
  console.log(chunk.content);
}
```

### OpenAI Provider

```typescript
import { OpenAIProvider } from '@ptah-extension/llm-abstraction';

const openAIProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  logger,
});

const response = await openAIProvider.generate({
  correlationId: 'corr-123',
  prompt: 'Generate a Python function',
  model: 'gpt-4-turbo',
  temperature: 0.5,
});
```

### Google Gemini Provider

```typescript
import { GoogleGenAIProvider } from '@ptah-extension/llm-abstraction';

const geminiProvider = new GoogleGenAIProvider({
  apiKey: process.env.GOOGLE_API_KEY,
  logger,
});

const response = await geminiProvider.generate({
  correlationId: 'corr-123',
  prompt: 'Analyze this code',
  model: 'gemini-1.5-pro',
  temperature: 0.3,
});
```

### OpenRouter Provider

```typescript
import { OpenRouterProvider } from '@ptah-extension/llm-abstraction';

const openRouterProvider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  logger,
});

// Access multiple models through OpenRouter
const response = await openRouterProvider.generate({
  correlationId: 'corr-123',
  prompt: 'Compare these approaches',
  model: 'anthropic/claude-3-5-sonnet', // OpenRouter model naming
  temperature: 0.7,
});
```

### VS Code Language Model Provider

```typescript
import { VsCodeLmProvider } from '@ptah-extension/llm-abstraction';

const vsCodeLmProvider = new VsCodeLmProvider({
  logger,
  modelSelector: async (models) => {
    // Custom model selection logic
    return models.find((m) => m.family === 'claude') || models[0];
  },
});

// Uses VS Code's Language Model API (no API key needed)
const response = await vsCodeLmProvider.generate({
  correlationId: 'corr-123',
  prompt: 'Refactor this function',
  model: 'claude-3-5-sonnet-20241022', // Resolved via VS Code LM API
});
```

### Base Provider (Custom Implementation)

```typescript
import { BaseLlmProvider } from '@ptah-extension/llm-abstraction';

class CustomProvider extends BaseLlmProvider {
  constructor(config: CustomProviderConfig, logger: Logger) {
    super(logger);
    this.config = config;
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    // Implement custom generation logic
    const result = await this.callCustomAPI(request.prompt);

    return {
      content: result.text,
      model: request.model,
      tokens: result.usage.totalTokens,
      finishReason: 'stop',
    };
  }

  async *generateStream(request: LlmGenerateRequest): AsyncGenerator<LlmStreamChunk> {
    // Implement custom streaming logic
    for await (const chunk of this.streamCustomAPI(request.prompt)) {
      yield {
        content: chunk.delta,
        isComplete: chunk.done,
      };
    }
  }
}
```

## Guidelines

### Provider Selection

1. **Use LlmService for automatic provider selection**:

   ```typescript
   // ✅ CORRECT - Service handles provider selection
   const response = await llmService.generate({
     prompt: 'Hello',
     model: 'claude-3-5-sonnet-20241022',
   });

   // ✅ ALSO CORRECT - Explicit provider
   const response = await llmService.generate({
     prompt: 'Hello',
     provider: 'openai',
     model: 'gpt-4-turbo',
   });

   // ❌ AVOID - Direct provider usage (unless needed)
   const provider = new AnthropicProvider(config, logger);
   const response = await provider.generate(request);
   ```

2. **Provider priority order**:

   ```typescript
   // 1. Explicit provider in request
   // 2. Model-based inference (claude-* → anthropic, gpt-* → openai)
   // 3. Default provider (configured in settings)
   // 4. First available provider
   ```

3. **Fallback handling**:
   ```typescript
   try {
     const response = await llmService.generate({
       prompt: 'Hello',
       provider: 'anthropic',
       model: 'claude-3-5-sonnet-20241022',
     });
   } catch (error) {
     if (error instanceof ProviderNotFoundError) {
       // Fallback to different provider
       const response = await llmService.generate({
         prompt: 'Hello',
         provider: 'openai',
         model: 'gpt-4-turbo',
       });
     }
   }
   ```

### Streaming Best Practices

1. **Always use async generators for streaming**:

   ```typescript
   const stream = llmService.generateStream({
     prompt: 'Write a long article',
     model: 'claude-3-5-sonnet-20241022',
   });

   for await (const chunk of stream) {
     // Process chunk
     console.log(chunk.content);

     // Check for completion
     if (chunk.isComplete) {
       console.log('Stream complete');
     }
   }
   ```

2. **Handle streaming errors gracefully**:

   ```typescript
   try {
     const stream = llmService.generateStream(request);

     for await (const chunk of stream) {
       // Process chunk
     }
   } catch (error) {
     logger.error('Streaming failed', { error });
     // Show partial results if available
   }
   ```

3. **Implement backpressure for large streams**:

   ```typescript
   const stream = llmService.generateStream(request);
   let buffer = '';

   for await (const chunk of stream) {
     buffer += chunk.content;

     // Flush buffer when threshold reached
     if (buffer.length > 1000) {
       await flushToUI(buffer);
       buffer = '';
     }
   }

   // Flush remaining content
   if (buffer.length > 0) {
     await flushToUI(buffer);
   }
   ```

### Configuration Management

1. **Use environment variables for API keys**:

   ```typescript
   const anthropicProvider = new AnthropicProvider({
     apiKey: process.env.ANTHROPIC_API_KEY,
     logger,
   });

   // Never hardcode API keys
   // ❌ apiKey: 'sk-ant-1234567890'
   ```

2. **Validate configuration on initialization**:

   ```typescript
   if (!process.env.ANTHROPIC_API_KEY) {
     throw new LlmProviderError('ANTHROPIC_API_KEY not configured');
   }
   ```

3. **Support multiple configuration sources**:
   ```typescript
   const apiKey = config.get('anthropic.apiKey') || process.env.ANTHROPIC_API_KEY || (await promptUserForApiKey());
   ```

### Error Handling

1. **Use typed error classes**:

   ```typescript
   import { LlmProviderError, ProviderNotFoundError, ModelNotAvailableError } from '@ptah-extension/llm-abstraction';

   try {
     const response = await llmService.generate(request);
   } catch (error) {
     if (error instanceof ProviderNotFoundError) {
       console.error('Provider not found:', error.providerName);
     } else if (error instanceof ModelNotAvailableError) {
       console.error('Model not available:', error.modelName);
     } else if (error instanceof LlmProviderError) {
       console.error('LLM error:', error.message);
     }
   }
   ```

2. **Handle rate limiting**:

   ```typescript
   try {
     const response = await llmService.generate(request);
   } catch (error) {
     if (error.code === 'RATE_LIMIT_EXCEEDED') {
       // Implement exponential backoff
       await sleep(error.retryAfter * 1000);
       return await llmService.generate(request);
     }
   }
   ```

3. **Log errors with context**:
   ```typescript
   try {
     const response = await provider.generate(request);
   } catch (error) {
     this.logger.error('Generation failed', {
       correlationId: request.correlationId,
       provider: 'anthropic',
       model: request.model,
       error: error.message,
     });
     throw error;
   }
   ```

### Testing

1. **Mock providers for unit tests**:

   ```typescript
   const mockProvider: ILlmProvider = {
     generate: jest.fn().mockResolvedValue({
       content: 'Mock response',
       model: 'claude-3-5-sonnet-20241022',
       tokens: 50,
     }),
     generateStream: jest.fn().mockImplementation(async function* () {
       yield { content: 'Mock', isComplete: false };
       yield { content: ' chunk', isComplete: true };
     }),
   };

   const llmService = new LlmService(mockRegistry, logger);
   ```

2. **Test streaming with async generators**:

   ```typescript
   it('should stream responses', async () => {
     const chunks: string[] = [];
     const stream = provider.generateStream(request);

     for await (const chunk of stream) {
       chunks.push(chunk.content);
     }

     expect(chunks).toEqual(['Hello', ' world', '!']);
   });
   ```

3. **Test provider selection logic**:

   ```typescript
   it('should select provider based on model', async () => {
     const response = await llmService.generate({
       prompt: 'Hello',
       model: 'claude-3-5-sonnet-20241022',
     });

     expect(mockAnthropicProvider.generate).toHaveBeenCalled();
     expect(mockOpenAIProvider.generate).not.toHaveBeenCalled();
   });
   ```

## Langchain Integration

### Provider Initialization

```typescript
import { ChatAnthropic } from '@langchain/anthropic';

const langchainModel = new ChatAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxTokens: 1000,
});

// Use in BaseLlmProvider
class AnthropicProvider extends BaseLlmProvider {
  private model: ChatAnthropic;

  constructor(config, logger) {
    super(logger);
    this.model = new ChatAnthropic(config);
  }

  async generate(request) {
    const result = await this.model.invoke(request.prompt);
    return this.transformResponse(result);
  }
}
```

### Streaming with Langchain

```typescript
async *generateStream(request: LlmGenerateRequest) {
  const stream = await this.model.stream(request.prompt);

  for await (const chunk of stream) {
    yield {
      content: chunk.content,
      isComplete: false
    };
  }

  yield { content: '', isComplete: true };
}
```

## Performance Considerations

- **Provider caching**: Providers initialized once and reused
- **Streaming efficiency**: Use async generators for memory efficiency
- **Connection pooling**: Langchain handles HTTP connection pooling
- **Token counting**: Providers return token usage for cost tracking
- **Concurrent requests**: Providers support parallel requests

## Model Support

### Anthropic (via Langchain)

- claude-3-5-sonnet-20241022
- claude-3-opus-20240229
- claude-3-sonnet-20240229
- claude-3-haiku-20240307

### OpenAI (via Langchain)

- gpt-4-turbo
- gpt-4-turbo-preview
- gpt-4
- gpt-3.5-turbo

### Google Gemini (via Langchain)

- gemini-1.5-pro
- gemini-1.5-flash
- gemini-pro

### OpenRouter (via Langchain)

- All models available on OpenRouter platform
- Use format: `provider/model` (e.g., `anthropic/claude-3-5-sonnet`)

### VS Code LM API

- Models available through VS Code Language Model API
- Model selection handled by VS Code

## Integration with Other Libraries

**Used by `@ptah-extension/agent-generation`**:

- Content generation for agent prompts
- Template processing with LLM adaptation
- Dynamic agent generation

**Used by `@ptah-extension/template-generation`**:

- Template variable resolution
- Content expansion and formatting

**Uses `@ptah-extension/vscode-core`**:

- Logger for structured logging
- ErrorHandler for error boundaries
- ConfigManager for API key management

## Future Enhancements

- Prompt caching for repeated queries
- Response caching with TTL
- Cost tracking and budgeting
- A/B testing for model comparison
- Custom model fine-tuning support
- Multi-modal support (vision, audio)

## Testing

```bash
# Run tests
nx test llm-abstraction

# Run tests with coverage
nx test llm-abstraction --coverage

# Run specific test
nx test llm-abstraction --testFile=llm.service.spec.ts
```

## File Paths Reference

- **Interfaces**: `src/lib/interfaces/`
- **Providers**: `src/lib/providers/`
- **Registry**: `src/lib/registry/`
- **Services**: `src/lib/services/`
- **Errors**: `src/lib/errors/`
- **DI**: `src/lib/di/`
- **Entry Point**: `src/index.ts`
