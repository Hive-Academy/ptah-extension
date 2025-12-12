---
trigger: glob
globs: libs/backend/workspace-intelligence/**/*.ts
---

# workspace-intelligence - Workspace Analysis

**Active**: Working in `libs/backend/workspace-intelligence/**/*.ts`

## Purpose

Brain of Ptah: comprehensive workspace analysis, file indexing, context optimization, autocomplete discovery. Powers intelligent file selection for AI context and MCP server tools.

## Responsibilities

✅ **File Indexing**: Async workspace scanning with .gitignore respect
✅ **Context Optimization**: Token-budgeted file selection (greedy algorithm)
✅ **Relevance Scoring**: Query-based file ranking
✅ **Project Detection**: 13+ project types (Angular, React, Python, etc.)
✅ **Monorepo Detection**: 6 tools (Nx, Lerna, Turborepo, etc.)
✅ **Autocomplete**: Agent/@/command discovery

❌ **NOT**: File I/O (→ vscode-core), UI (→ frontend)

## Architecture

```
ContextOrchestrationService (Entry Point)
  ├─ Context Analysis
  │   ├─ FileRelevanceScorer (query-based ranking)
  │   ├─ ContextSizeOptimizer (token budgeting)
  │   └─ FileTypeClassifier (source/test/config detection)
  ├─ File Indexing
  │   ├─ WorkspaceIndexer (async file discovery)
  │   ├─ PatternMatcher (glob matching, LRU cache)
  │   └─ IgnorePatternResolver (.gitignore parsing)
  ├─ Project Analysis
  │   ├─ ProjectDetector (13+ project types)
  │   ├─ FrameworkDetector (package.json analysis)
  │   ├─ MonorepoDetector (6 tools)
  │   └─ DependencyAnalyzer (dependency graph)
  ├─ Autocomplete
  │   ├─ AgentDiscovery (.claude/agents)
  │   ├─ MCPDiscovery (.mcp.json + health check)
  │   └─ CommandDiscovery (.claude/commands)
  └─ AST Analysis (Phase 2)
      ├─ TreeSitterParser (native AST)
      └─ AstAnalysisService (stub)
```

## Entry Point: ContextOrchestrationService

### Get All Files

```typescript
import { ContextOrchestrationService } from '@ptah-extension/workspace-intelligence';

@injectable()
export class MyService {
  constructor(
    @inject(TOKENS.contextOrchestration)
    private context: ContextOrchestrationService
  ) {}

  async getAllFiles(): Promise<IndexedFile[]> {
    const result = await this.context.getAllFiles({
      requestId: uuid() as RequestId,
      includeImages: false,
      limit: 1000,
    });

    if (Result.isOk(result)) {
      return result.value;
    }
    throw new Error(result.error.message);
  }
}
```

### Search Files by Query

```typescript
async searchFiles(query: string): Promise<IndexedFile[]> {
  const result = await this.context.searchFiles({
    requestId: uuid() as RequestId,
    query: 'authentication handler',
    maxResults: 20
  });

  if (Result.isOk(result)) {
    return result.value;  // Ranked by relevance
  }
  return [];
}
```

## File Relevance Scoring

### Scoring Algorithm

Ranks files by relevance to query using:

1. **Path keyword matching** (filename > path components)
2. **File type weighting** (source: 1.5x, test: 1.0x, config: 0.5x)
3. **Language patterns** (service, component, util)
4. **Framework patterns** (Angular, React)
5. **Task patterns** (auth, api, database)

### Usage

```typescript
import { FileRelevanceScorerService } from '@ptah-extension/workspace-intelligence';

const scorer = container.resolve(FileRelevanceScorerService);

// Score single file
const score = scorer.scoreFile(file, 'authentication handler');
// { file, score: 85, reasons: ['Path contains "auth"', 'Source file'] }

// Rank multiple files
const ranked = scorer.rankFiles(files, 'authentication');
// Map<IndexedFile, number> sorted by score DESC

// Get top N
const top10 = scorer.getTopFiles(files, 'auth api', 10);
```

## Context Size Optimization

### Token Budgeting

```typescript
import { ContextSizeOptimizerService } from '@ptah-extension/workspace-intelligence';

const optimizer = container.resolve(ContextSizeOptimizerService);

// Manual budget
const result = await optimizer.optimizeContext({
  files: indexedFiles,
  query: 'implement authentication',
  maxTokens: 200_000,
  responseReserve: 50_000, // For AI response
});

console.log(result.selectedFiles); // Files to include
console.log(result.excludedFiles); // Files excluded
console.log(result.totalTokens); // Total token count
console.log(result.tokensRemaining); // Budget remaining

// Adaptive budgeting (auto-calculates based on project type)
const adaptive = await optimizer.optimizeWithAdaptiveBudget(files, 'implement auth');
// Monorepo: 200k, App: 175k, Library: 150k
```

### Greedy Algorithm

1. Score files by relevance
2. Sort by score DESC
3. Add files until budget exceeded
4. Return selected files + stats

## Workspace Indexing

### Full Indexing

```typescript
import { WorkspaceIndexerService } from '@ptah-extension/workspace-intelligence';

const indexer = container.resolve(WorkspaceIndexerService);

const index = await indexer.indexWorkspace(
  {
    includePatterns: ['**/*.ts', '**/*.tsx'],
    excludePatterns: ['**/dist/**', '**/node_modules/**'],
    respectIgnoreFiles: true,
    estimateTokens: true,
  },
  (progress) => {
    console.log(`${progress.percentComplete}% - ${progress.currentFile}`);
  }
);

console.log(index.files); // All indexed files
console.log(index.totalFiles); // Count
console.log(index.totalTokens); // Estimated total
```

### Streaming for Large Workspaces

```typescript
for await (const file of indexer.indexWorkspaceStream(options)) {
  console.log(`Indexed: ${file.relativePath} (${file.estimatedTokens} tokens)`);
  processFile(file);
}
```

## Project Detection

### Detect Project Type

```typescript
import { ProjectDetectorService, ProjectType } from '@ptah-extension/workspace-intelligence';

const detector = container.resolve(ProjectDetectorService);

const projectType = await detector.detectProjectType(workspaceUri);

switch (projectType) {
  case ProjectType.Angular:
    console.log('Angular project');
    break;
  case ProjectType.React:
    console.log('React project');
    break;
  case ProjectType.Node:
    console.log('Node.js project');
    break;
  // ... 10 more types
}
```

### Supported Project Types (13+)

- Node.js
- React
- Vue
- Angular
- Next.js
- Python
- Java
- Rust
- Go
- .NET
- PHP
- Ruby
- General

## Monorepo Detection

### Detect Monorepo Tool

```typescript
import { MonorepoDetectorService, MonorepoType } from '@ptah-extension/workspace-intelligence';

const detector = container.resolve(MonorepoDetectorService);

const result = await detector.detectMonorepo(workspaceUri);

if (result.isMonorepo) {
  console.log(`Monorepo type: ${result.type}`);
  console.log(`Packages: ${result.packageCount}`);
  console.log(`Config files: ${result.workspaceFiles}`);
}
```

### Supported Monorepo Tools (6)

- **Nx** (nx.json, workspace.json)
- **Lerna** (lerna.json)
- **Rush** (rush.json)
- **Turborepo** (turbo.json)
- **pnpm workspaces** (pnpm-workspace.yaml)
- **Yarn workspaces** (package.json workspaces field)

## Autocomplete Discovery

### Agent Discovery

```typescript
import { AgentDiscoveryService } from '@ptah-extension/workspace-intelligence';

const discovery = container.resolve(AgentDiscoveryService);

const agents = await discovery.searchAgents({
  query: 'explore',
  maxResults: 10,
});

agents.forEach((agent) => {
  console.log(`${agent.name} (${agent.scope}): ${agent.description}`);
});
```

**Sources**:

- Built-in agents (general-purpose, Explore, Plan, etc.)
- Project agents (.claude/agents/\*.md)
- User agents (~/.claude/agents/\*.md)

### MCP Server Discovery

```typescript
import { MCPDiscoveryService } from '@ptah-extension/workspace-intelligence';

const discovery = container.resolve(MCPDiscoveryService);

const mcps = await discovery.searchMCPServers({
  query: 'ptah',
  includeOffline: false,
});

mcps.forEach((mcp) => {
  console.log(`${mcp.name}: ${mcp.status}`);
});
```

**Sources**:

- Project config (.mcp.json)
- User config (~/.claude/settings.local.json)
- Health check via `claude mcp list`
- Auto-refresh every 30s

### Command Discovery

```typescript
import { CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';

const discovery = container.resolve(CommandDiscoveryService);

const commands = await discovery.searchCommands({
  query: 'help',
});

commands.forEach((cmd) => {
  console.log(`/${cmd.name}: ${cmd.description}`);
});
```

**Sources**:

- Built-in commands (16 documented)
- Project commands (.claude/commands/\*.md)
- User commands (~/.claude/commands/\*.md)

## Pattern Matching (High Performance)

### Using picomatch (7x faster than minimatch)

```typescript
import { PatternMatcherService } from '@ptah-extension/workspace-intelligence';

const matcher = container.resolve(PatternMatcherService);

// Single match
const matches = matcher.isMatch('src/app.ts', '**/*.ts'); // true

// Batch with exclusions
const results = matcher.matchFiles(['src/app.ts', 'src/app.spec.ts', 'node_modules/pkg/index.js'], ['**/*.ts', '!**/*.spec.ts', '!node_modules/**']);
// [{ path: 'src/app.ts', matched: true }]
```

**Performance**:

- LRU cache (100 patterns, 1000 results)
- picomatch 7x faster than minimatch
- Supports ! prefix for exclusions

## Types

### IndexedFile

```typescript
export interface IndexedFile {
  path: string; // Absolute path
  relativePath: string; // Relative to workspace
  type: FileType; // source/test/config/docs/asset
  size: number; // Bytes
  language?: string; // ts, js, py, etc.
  estimatedTokens: number; // Token count estimate
}

export enum FileType {
  Source = 'source',
  Test = 'test',
  Config = 'config',
  Documentation = 'docs',
  Asset = 'asset',
}
```

## MCP Server Integration

Exposes via PtahAPIBuilder for MCP server (`@ptah-extension/vscode-lm-tools`):

| Namespace        | Methods                                      | Source                      |
| ---------------- | -------------------------------------------- | --------------------------- |
| `ptah.workspace` | `analyze()`, `getInfo()`, `getProjectType()` | WorkspaceAnalyzerService    |
| `ptah.search`    | `findFiles()`, `getRelevantFiles()`          | ContextOrchestrationService |

## Performance

| Service          | Optimization                       |
| ---------------- | ---------------------------------- |
| PatternMatcher   | LRU cache, picomatch (7x faster)   |
| TokenCounter     | LRU cache (1000 entries, 5min TTL) |
| WorkspaceIndexer | Async generators, streaming        |
| FileRelevance    | No I/O, pure computation, O(n)     |
| Discovery        | File watching, auto-refresh        |

## Rules

1. **Use ContextOrchestrationService** - Entry point for all ops
2. **Respect .gitignore** - Always use respectIgnoreFiles: true
3. **Estimate tokens** - Enable estimateTokens for context work
4. **Progress callbacks** - Use for large workspace operations
5. **Cache results** - Services use LRU caching internally

## Commands

```bash
nx test workspace-intelligence
nx build workspace-intelligence
nx typecheck workspace-intelligence
```
