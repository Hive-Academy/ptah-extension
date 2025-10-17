# libs/backend/ai-providers-core - Multi-Provider AI Abstraction

## Purpose

Multi-provider AI abstraction layer enabling intelligent provider selection based on task characteristics. Supports Claude CLI and VS Code LM API with automatic fallback and health monitoring.

## Key Components

- **ProviderManager** (`manager/provider-manager.ts`): Central orchestrator with reactive state
- **IntelligentProviderStrategy** (`strategies/intelligent-provider-strategy.ts`): Task-based scoring algorithm
- **ClaudeCliAdapter** (`adapters/claude-cli-adapter.ts`): Claude CLI integration
- **VsCodeLmAdapter** (`adapters/vscode-lm-adapter.ts`): VS Code LM API integration
- **ContextManager** (`context/context-manager.ts`): File inclusion/exclusion, token estimation

## Quick Start

```typescript
import { registerAIProviderServices } from '@ptah-extension/ai-providers-core';

// In DI setup
registerAIProviderServices(container);

// Use manager
const manager = container.resolve(TOKENS.PROVIDER_MANAGER);
const result = await manager.selectBestProvider({
  taskType: 'coding',
  complexity: 'high',
  fileTypes: ['ts'],
  contextSize: 5000,
});

// Stream messages
for await (const chunk of provider.sendMessage(sessionId, content, context)) {
  console.log(chunk);
}
```

## Provider Selection Algorithm

Scoring (0-100):

- **Task Matching** (50 pts): coding/reasoning/analysis specialization
- **Complexity** (20 pts): high/medium/low capability
- **File Types** (10 pts): language specialization
- **Health** (30 pts): availability and response time
- **Cost** (5 pts): optimization for low-complexity tasks

## Context Management

```typescript
import { ContextManager } from '@ptah-extension/ai-providers-core';

// Include files
await contextManager.includeFile('/path/to/file.ts');

// Get optimization suggestions
const context = await contextManager.getCurrentContext();
context.optimizations.forEach((opt) => {
  console.log(`${opt.type}: ${opt.description} (saves ${opt.estimatedSavings} tokens)`);
});
```

## Dependencies

- `@ptah-extension/shared`: Types
- `@ptah-extension/vscode-core`: DI, Logger, EventBus
- `@ptah-extension/claude-domain`: Claude CLI services
- `@ptah-extension/workspace-intelligence`: Token counting, relevance scoring
- `tsyringe`, `rxjs`, `vscode`

## Testing

```bash
nx test ai-providers-core
```

## File Locations

- **Manager**: `src/manager/provider-manager.ts`
- **Strategy**: `src/strategies/intelligent-provider-strategy.ts`
- **Adapters**: `src/adapters/claude-cli-adapter.ts`, `src/adapters/vscode-lm-adapter.ts`
- **Context**: `src/context/context-manager.ts`
- **DI**: `src/di/register.ts`
