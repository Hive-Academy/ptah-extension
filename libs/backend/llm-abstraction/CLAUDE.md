# libs/backend/llm-abstraction - VS Code LM Abstraction Layer

[Back to Main](../../../CLAUDE.md)

## Purpose

The **llm-abstraction library** provides a unified interface for the VS Code Language Model API. It abstracts away provider-specific implementation details, enabling AI-driven features in Ptah Extension through VS Code's built-in language model support. No external API keys are required.

## Boundaries

**Belongs here**:

- LLM provider abstraction (ILlmProvider interface)
- VS Code LM provider implementation
- Provider registry and selection logic
- API key management (LlmSecretsService)
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
│  ILlmProvider Implementation                         │
│  └─ VsCodeLmProvider      - VS Code LM API           │
├──────────────────────────────────────────────────────┤
│  BaseLlmProvider (Abstract base class)               │
│  ├─ Common streaming logic                           │
│  ├─ Error handling                                   │
│  └─ Configuration management                         │
├──────────────────────────────────────────────────────┤
│  Configuration                                       │
│  ├─ LlmSecretsService     - API key management       │
│  └─ LlmConfigurationService - Provider config        │
└──────────────────────────────────────────────────────┘
```

## Key Files

### Core Interfaces

- `interfaces/llm-provider.interface.ts` - ILlmProvider interface definition

### Provider Implementations

- `providers/base-llm.provider.ts` - Abstract base class for providers
- `providers/vscode-lm.provider.ts` - VS Code Language Model API

### Configuration Services

- `services/llm-secrets.service.ts` - API key management via VS Code SecretStorage
- `services/llm-configuration.service.ts` - Provider configuration and model selection

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

- `zod` (^3.23.8) - Schema validation
- `tsyringe` (^4.10.0) - Dependency injection
- `vscode` (^1.96.0) - VS Code Extension API (for VsCodeLmProvider)

## Import Path

```typescript
// Core imports
import { LlmService, ProviderRegistry, BaseLlmProvider, LlmSecretsService, LlmConfigurationService, registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';

// Interface imports
import type { ILlmProvider } from '@ptah-extension/llm-abstraction';

// Error imports
import { LlmProviderError } from '@ptah-extension/llm-abstraction';
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

// Generate content using VS Code LM API
const response = await llmService.generate({
  correlationId: 'corr-123',
  prompt: 'Explain TypeScript generics',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxTokens: 1000,
});

console.log(response.content);

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
registry.register('vscode-lm', vsCodeLmProvider);

// Get provider by name
const provider = registry.get('vscode-lm');

// List all providers
const providers = registry.list();
// ['vscode-lm']

// Check if provider exists
const hasVsCodeLm = registry.has('vscode-lm');
// true
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
    const result = await this.callCustomAPI(request.prompt);

    return {
      content: result.text,
      model: request.model,
      tokens: result.usage.totalTokens,
      finishReason: 'stop',
    };
  }

  async *generateStream(request: LlmGenerateRequest): AsyncGenerator<LlmStreamChunk> {
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

1. **Use LlmService for provider selection**:

   ```typescript
   // ✅ CORRECT - Service handles provider selection
   const response = await llmService.generate({
     prompt: 'Hello',
     model: 'claude-3-5-sonnet-20241022',
   });
   ```

2. **Currently only VS Code LM provider is available**:

   ```typescript
   // Models are resolved via VS Code's Language Model API
   // No API keys needed - uses VS Code's built-in auth (e.g., Copilot)
   ```

### Streaming Best Practices

1. **Always use async generators for streaming**:

   ```typescript
   const stream = llmService.generateStream({
     prompt: 'Write a long article',
     model: 'claude-3-5-sonnet-20241022',
   });

   for await (const chunk of stream) {
     console.log(chunk.content);

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
   }
   ```

3. **Implement backpressure for large streams**:

   ```typescript
   const stream = llmService.generateStream(request);
   let buffer = '';

   for await (const chunk of stream) {
     buffer += chunk.content;

     if (buffer.length > 1000) {
       await flushToUI(buffer);
       buffer = '';
     }
   }

   if (buffer.length > 0) {
     await flushToUI(buffer);
   }
   ```

### Configuration & Authentication

1. **VS Code LM API requires no API keys** - authentication is handled by VS Code itself (e.g., GitHub Copilot subscription).

2. **LlmSecretsService** is available for any future API key needs:

   ```typescript
   const secretsService = container.resolve(LlmSecretsService);
   const apiKey = await secretsService.getApiKey('provider-name');
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

2. **Log errors with context**:
   ```typescript
   try {
     const response = await provider.generate(request);
   } catch (error) {
     this.logger.error('Generation failed', {
       correlationId: request.correlationId,
       provider: 'vscode-lm',
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

## Model Support

### VS Code LM API

- Models available through VS Code Language Model API (e.g., Copilot)
- Model selection handled by VS Code
- Auth: No API key needed (uses VS Code's built-in auth)

## Integration with Other Libraries

**Used by `@ptah-extension/agent-generation`**:

- Content generation for agent prompts
- Template processing with LLM adaptation
- Dynamic agent generation

**Uses `@ptah-extension/vscode-core`**:

- Logger for structured logging
- ErrorHandler for error boundaries
- ConfigManager for configuration management

## Future Enhancements

- Prompt caching for repeated queries
- Response caching with TTL
- Cost tracking and budgeting
- A/B testing for model comparison
- Multi-modal support (vision, audio)

## Performance Considerations

- **Provider caching**: Providers initialized once and reused
- **Streaming efficiency**: Use async generators for memory efficiency
- **Token counting**: Providers return token usage for cost tracking
- **Concurrent requests**: Providers support parallel requests

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
- **Providers**: `src/lib/providers/` (VS Code LM)
- **Registry**: `src/lib/registry/`
- **Services**: `src/lib/services/` (LlmService, LlmSecretsService, LlmConfigurationService)
- **Errors**: `src/lib/errors/`
- **DI**: `src/lib/di/`
- **Entry Point**: `src/index.ts`
