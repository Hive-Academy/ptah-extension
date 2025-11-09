# libs/backend/workspace-intelligence - Workspace Analysis & Context Optimization

## Purpose

Intelligent workspace analysis and context optimization for AI interactions. Provides project detection, dependency analysis, file indexing, and token-aware context management.

## Key Services

- **WorkspaceAnalyzerService** (`composite/workspace-analyzer.service.ts`): Unified workspace analysis facade
- **ContextOrchestrationService** (`context/context-orchestration.service.ts`): Context management orchestrator
- **ProjectDetectorService** (`project-analysis/project-detector.service.ts`): 13+ project types
- **WorkspaceIndexerService** (`file-indexing/workspace-indexer.service.ts`): Scalable file indexing
- **TokenCounterService** (`services/token-counter.service.ts`): Native VS Code token counting
- **ContextSizeOptimizerService** (`context-analysis/context-size-optimizer.service.ts`): Token budget optimization

## Quick Start

```typescript
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';

// Register services
registerWorkspaceIntelligenceServices(container);

// Analyze workspace
const analyzer = container.resolve(TOKENS.WORKSPACE_ANALYZER_SERVICE);
const analysis = await analyzer.analyzeWorkspace(workspaceUri);
console.log(`Project type: ${analysis.projectType}`);
console.log(`Frameworks: ${analysis.frameworks.join(', ')}`);

// Context orchestration
const contextOrch = container.resolve(TOKENS.CONTEXT_ORCHESTRATION_SERVICE);
const files = await contextOrch.getContextFiles({});
const suggestions = await contextOrch.getFileSuggestions({ query: '@' });
```

## Project Detection

Supports 13+ project types:

- Node.js, React, Angular, Vue, Next.js, NestJS, Express
- Python (Django, Flask, FastAPI)
- Java (Spring Boot, Maven, Gradle)
- Rust (Cargo)
- Go (Go modules)
- .NET Core

## Performance Optimizations

- **Pattern Matching**: 7x faster via picomatch + LRU caching
- **File Search**: Debounced with result caching (5min TTL)
- **Token Counting**: Native VS Code API with fallback estimation
- **Streaming Indexing**: AsyncGenerator for large workspaces

## Testing

```bash
nx test workspace-intelligence
```

## File Locations

- **Composite**: `src/composite/workspace-analyzer.service.ts`
- **Context**: `src/context/context-orchestration.service.ts`, `src/context/context.service.ts`
- **Analysis**: `src/project-analysis/*.service.ts` (4 services)
- **Indexing**: `src/file-indexing/*.service.ts` (3 services)
- **DI**: `src/di/register.ts`
