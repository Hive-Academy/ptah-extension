# libs/backend/workspace-intelligence - Intelligent Workspace Analysis

## Purpose

The **workspace-intelligence library** is the brain of Ptah extension. It provides comprehensive workspace analysis, file indexing, context optimization, and autocomplete discovery services. This library powers intelligent file selection for AI context, project detection, and Claude CLI integration features.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Context Orchestration Layer                    │
│  ContextOrchestrationService - Unified API for all operations    │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐ │
│  │ Context Analysis│ │ File Indexing   │ │ Autocomplete        │ │
│  ├─────────────────┤ ├─────────────────┤ ├─────────────────────┤ │
│  │ RelevanceScorer │ │ WorkspaceIndexer│ │ AgentDiscovery      │ │
│  │ SizeOptimizer   │ │ PatternMatcher  │ │ MCPDiscovery        │ │
│  │ FileClassifier  │ │ IgnoreResolver  │ │ CommandDiscovery    │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐ │
│  │ Project Analysis│ │ Workspace       │ │ AST Analysis        │ │
│  ├─────────────────┤ ├─────────────────┤ ├─────────────────────┤ │
│  │ ProjectDetector │ │ WorkspaceService│ │ TreeSitterParser    │ │
│  │ FrameworkDetect │ │ WorkspaceAnalyz │ │ AstAnalysisService  │ │
│  │ MonorepoDetector│ │                 │ │ (Phase 2 stub)      │ │
│  │ DependencyAnalyz│ │                 │ │                     │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐ ┌─────────────────┐                         │
│  │ Base Services   │ │ Context Service │                         │
│  ├─────────────────┤ ├─────────────────┤                         │
│  │ FileSystemSvc   │ │ ContextService  │                         │
│  │ TokenCounterSvc │ │                 │                         │
│  └─────────────────┘ └─────────────────┘                         │
└──────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
libs/backend/workspace-intelligence/src/
├── context/
│   ├── context-orchestration.service.ts    # Main entry point for context operations
│   └── context.service.ts                  # File context building
├── context-analysis/
│   ├── file-relevance-scorer.service.ts    # Query-based file ranking
│   ├── context-size-optimizer.service.ts   # Token budget management
│   └── file-type-classifier.service.ts     # File type detection
├── file-indexing/
│   ├── workspace-indexer.service.ts        # Async file discovery
│   ├── pattern-matcher.service.ts          # High-perf glob matching
│   └── ignore-pattern-resolver.service.ts  # .gitignore parsing
├── project-analysis/
│   ├── project-detector.service.ts         # Project type detection
│   ├── framework-detector.service.ts       # Framework detection
│   ├── monorepo-detector.service.ts        # Monorepo tool detection
│   └── dependency-analyzer.service.ts      # Dependency analysis
├── workspace/
│   ├── workspace.service.ts                # Workspace operations
│   └── workspace-analyzer.service.ts       # Structure analysis
├── autocomplete/
│   ├── agent-discovery.service.ts          # Claude agents (@agents)
│   ├── mcp-discovery.service.ts            # MCP servers (@mcp)
│   └── command-discovery.service.ts        # Slash commands (/cmd)
├── ast/
│   ├── tree-sitter-parser.service.ts       # Native AST parsing
│   ├── ast-analysis.service.ts             # Code insights (Phase 2 stub)
│   ├── ast.types.ts                        # Generic AST node types
│   └── tree-sitter.config.ts               # Language mappings
├── services/
│   ├── file-system.service.ts              # VS Code workspace.fs wrapper
│   ├── token-counter.service.ts            # Native token counting
│   └── code-symbol-indexer.service.ts      # Walks workspace, extracts JS/TS symbols via AstAnalysisService, stores as entity memory chunks; exposed via ptah.code.searchSymbols + ptah.code.reindex (TASK_2026_THOTH_CODE_INDEX)
├── types/
│   └── workspace.types.ts                  # Domain type definitions
└── index.ts                                # Public exports
```

## Core Services

### 1. Context Orchestration (Entry Point)

**File**: `context/context-orchestration.service.ts`

The main facade for all context-related operations. Coordinates between indexing, analysis, and optimization services.

```typescript
import { ContextOrchestrationService } from '@ptah-extension/workspace-intelligence';

// Get all files in workspace (respects .gitignore)
const files = await contextOrchestration.getAllFiles({
  requestId: correlationId,
  includeImages: false,
  limit: 1000,
});

// Search files by query/pattern
const searchResults = await contextOrchestration.searchFiles({
  requestId: correlationId,
  query: 'authentication',
  maxResults: 20,
});

// Get file suggestions for autocomplete
const suggestions = await contextOrchestration.getFileSuggestions({
  requestId: correlationId,
  query: 'auth',
  limit: 10,
});
```

### 2. File Relevance Scoring

**File**: `context-analysis/file-relevance-scorer.service.ts`

Ranks files by relevance to a user query using:

- Path keyword matching (filename > path components)
- File type weighting (source > test > config > docs > assets)
- Language-specific patterns (service, component, util)
- Framework patterns (Angular, React)
- Task patterns (auth, api, database)

```typescript
import { FileRelevanceScorerService } from '@ptah-extension/workspace-intelligence';

// Score single file
const result = scorer.scoreFile(file, 'authentication handler');
// { file, score: 85, reasons: ['Path contains "auth"', 'Source code file'] }

// Rank multiple files
const ranked = scorer.rankFiles(files, 'authentication');
// Map<IndexedFile, number> sorted by score descending

// Get top N files
const top = scorer.getTopFiles(files, 'authentication', 10);
```

### 3. Context Size Optimizer

**File**: `context-analysis/context-size-optimizer.service.ts`

Manages token budgets for Claude CLI integration:

- Greedy algorithm for optimal file selection
- Adaptive budgeting based on query complexity
- Project type recommendations (monorepo: 200k, app: 175k, library: 150k)
- Response reserve calculation (generate: 75k, explain: 50k, simple: 30k)

```typescript
import { ContextSizeOptimizerService } from '@ptah-extension/workspace-intelligence';

// Optimize with budget constraints
const result = await optimizer.optimizeContext({
  files: indexedFiles,
  query: 'implement authentication',
  maxTokens: 200_000,
  responseReserve: 50_000,
});
// { selectedFiles, excludedFiles, totalTokens, tokensRemaining, stats }

// Adaptive budgeting
const adaptive = await optimizer.optimizeWithAdaptiveBudget(files, query);
```

### 4. Workspace Indexer

**File**: `file-indexing/workspace-indexer.service.ts`

Efficient file discovery with:

- Async generators for memory efficiency
- Automatic .gitignore/.npmignore respect
- File type classification
- Token count estimation
- Progress callbacks

```typescript
import { WorkspaceIndexerService } from '@ptah-extension/workspace-intelligence';

// Full indexing with progress
const index = await indexer.indexWorkspace(
  {
    includePatterns: ['**/*.ts', '**/*.tsx'],
    excludePatterns: ['**/dist/**'],
    respectIgnoreFiles: true,
    estimateTokens: true,
  },
  (progress) => console.log(`${progress.percentComplete}%`),
);

// Streaming for large workspaces
for await (const file of indexer.indexWorkspaceStream(options)) {
  processFile(file);
}
```

### 5. Pattern Matcher

**File**: `file-indexing/pattern-matcher.service.ts`

High-performance glob matching using picomatch (7x faster than minimatch):

- LRU caching for compiled patterns
- Inclusion/exclusion support (! prefix)
- Batch file matching

```typescript
import { PatternMatcherService } from '@ptah-extension/workspace-intelligence';

// Single match
const matches = matcher.isMatch('src/app.ts', '**/*.ts'); // true

// Batch with exclusions
const results = matcher.matchFiles(['src/app.ts', 'src/app.spec.ts', 'node_modules/pkg/index.js'], ['**/*.ts', '!**/*.spec.ts', '!node_modules/**']);
// [{ path: 'src/app.ts', matched: true, matchedPatterns: ['**/*.ts'] }]
```

### 6. Project Detection

**File**: `project-analysis/project-detector.service.ts`

Detects 13+ project types:

- Node.js, React, Vue, Angular, Next.js
- Python, Java, Rust, Go, .NET, PHP, Ruby

```typescript
import { ProjectDetectorService } from '@ptah-extension/workspace-intelligence';

const projectType = await detector.detectProjectType(workspaceUri);
// ProjectType.Angular | ProjectType.React | ProjectType.Node | ...
```

### 7. Framework Detection

**File**: `project-analysis/framework-detector.service.ts`

Identifies frameworks by package.json/requirements.txt analysis.

### 8. Monorepo Detection

**File**: `project-analysis/monorepo-detector.service.ts`

Supports 6 monorepo tools:

- Nx (nx.json, workspace.json)
- Lerna (lerna.json)
- Rush (rush.json)
- Turborepo (turbo.json)
- pnpm workspaces (pnpm-workspace.yaml)
- Yarn workspaces (package.json workspaces)

```typescript
import { MonorepoDetectorService } from '@ptah-extension/workspace-intelligence';

const result = await detector.detectMonorepo(workspaceUri);
// { isMonorepo: true, type: MonorepoType.Nx, packageCount: 12, workspaceFiles: ['nx.json'] }
```

### 9. Autocomplete Discovery Services

#### Agent Discovery

**File**: `autocomplete/agent-discovery.service.ts`

Discovers Claude CLI agents from .claude/agents/ directories:

- Built-in agents (general-purpose, Explore, Plan, etc.)
- Project agents (.claude/agents/\*.md)
- User agents (~/.claude/agents/\*.md)
- YAML frontmatter parsing

```typescript
const agents = await agentDiscovery.searchAgents({ query: 'explore', maxResults: 10 });
// [{ name: 'Explore', description: 'Fast agent for codebase exploration', scope: 'builtin' }]
```

#### MCP Server Discovery

**File**: `autocomplete/mcp-discovery.service.ts`

Discovers MCP servers from .mcp.json configuration:

- Project config (.mcp.json)
- User config (~/.claude/settings.local.json)
- Health checking via `claude mcp list`
- Auto-refresh every 30s

```typescript
const mcps = await mcpDiscovery.searchMCPServers({ query: 'ptah', includeOffline: false });
// [{ name: 'ptah', command: 'http', status: 'connected' }]
```

#### Command Discovery

**File**: `autocomplete/command-discovery.service.ts`

Discovers Claude CLI commands:

- Built-in commands (16 documented)
- Project commands (.claude/commands/\*.md)
- User commands (~/.claude/commands/\*.md)
- YAML frontmatter for metadata

```typescript
const commands = await commandDiscovery.searchCommands({ query: 'help' });
// [{ name: 'help', description: 'List all available commands', scope: 'builtin' }]
```

### 10. AST Analysis (Phase 2)

**Files**: `ast/tree-sitter-parser.service.ts`, `ast/ast-analysis.service.ts`

Native Tree-sitter parsing for JavaScript/TypeScript:

- Generic AST node conversion
- Parser caching per language
- Phase 3: LLM-powered code insights extraction

```typescript
import { TreeSitterParserService } from '@ptah-extension/workspace-intelligence';

const result = parser.parse(sourceCode, 'typescript');
// Result<GenericAstNode, Error> - platform-agnostic AST
```

## Type Definitions

### Core Types

```typescript
// Project types
enum ProjectType {
  Node,
  React,
  Vue,
  Angular,
  NextJS,
  Python,
  Java,
  Rust,
  Go,
  DotNet,
  PHP,
  Ruby,
  General,
}

// File classification
enum FileType {
  Source = 'source',
  Test = 'test',
  Config = 'config',
  Documentation = 'docs',
  Asset = 'asset',
}

// Monorepo types
enum MonorepoType {
  Nx,
  Lerna,
  Rush,
  Turborepo,
  PnpmWorkspaces,
  YarnWorkspaces,
}

// Indexed file metadata
interface IndexedFile {
  path: string;
  relativePath: string;
  type: FileType;
  size: number;
  language?: string;
  estimatedTokens: number;
}
```

## MCP Server Integration

This library powers the Ptah MCP server (`@ptah-extension/vscode-lm-tools`) through:

### Exposed via PtahAPIBuilder

| Namespace        | Methods                                                         | Source Service                                 |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `ptah.workspace` | `analyze()`, `getInfo()`, `getProjectType()`, `getFrameworks()` | WorkspaceAnalyzerService                       |
| `ptah.search`    | `findFiles()`, `getRelevantFiles()`                             | ContextOrchestrationService                    |
| `ptah.code`      | `searchSymbols()`, `reindex()`                                  | CodeSymbolIndexer (TASK_2026_THOTH_CODE_INDEX) |

### Current MCP Tool Description (execute_code)

```json
{
  "name": "execute_code",
  "description": "Execute TypeScript/JavaScript code with access to Ptah extension APIs. Available namespaces: workspace, search, symbols, diagnostics, git, ai, files, commands.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "description": "TypeScript/JavaScript code to execute. Has access to \"ptah\" global object."
      },
      "timeout": {
        "type": "number",
        "description": "Execution timeout in milliseconds (default: 5000, max: 30000)"
      }
    }
  }
}
```

### MCP Exposure Gap Analysis

**Currently Exposed (via execute_code)**:

- ✅ WorkspaceAnalyzerService → `ptah.workspace.*`
- ✅ ContextOrchestrationService → `ptah.search.*`

**NOT Exposed (Significant Capabilities)**:

- ❌ FileRelevanceScorerService - Query-based relevance ranking
- ❌ ContextSizeOptimizerService - Token budget management
- ❌ MonorepoDetectorService - Monorepo type detection
- ❌ ProjectDetectorService - Project type detection
- ✅ TreeSitterParserService - AST parsing (now exposed indirectly via `CodeSymbolIndexer` → `ptah.code.*`; agents can search symbols extracted by tree-sitter without calling the parser directly)
- ❌ AgentDiscoveryService - Agent autocomplete
- ❌ MCPDiscoveryService - MCP server discovery
- ❌ CommandDiscoveryService - Command autocomplete

### Recommended Additional MCP Tools

To fully expose workspace-intelligence capabilities, consider adding:

1. **`analyze_project`** - Project/framework/monorepo detection
2. **`rank_files`** - Relevance-based file ranking for a query
3. **`optimize_context`** - Token-budgeted file selection
4. **`parse_ast`** - AST analysis for code understanding
5. **`discover_agents`** - List available Claude agents
6. **`discover_mcps`** - List configured MCP servers

## Dependencies

**Internal**:

- `@ptah-extension/shared`: Type definitions (CorrelationId, Result)
- `@ptah-extension/vscode-core`: DI tokens, Logger

**External**:

- `tsyringe` (^4.10.0): Dependency injection
- `picomatch` (^4.0.2): High-performance glob matching
- `gray-matter` (^4.0.3): YAML frontmatter parsing
- `tree-sitter` (^0.21.1): Native AST parsing
- `tree-sitter-javascript` (^0.21.4): JavaScript grammar
- `tree-sitter-typescript` (^0.21.2): TypeScript grammar

## Performance Characteristics

| Service            | Optimization                                                               |
| ------------------ | -------------------------------------------------------------------------- |
| PatternMatcher     | LRU cache (100 patterns, 1000 results), picomatch 7x faster than minimatch |
| TokenCounter       | LRU cache (1000 entries, 5min TTL), native VS Code API when available      |
| WorkspaceIndexer   | Async generators for memory efficiency, streaming support                  |
| FileRelevance      | No I/O, pure computation, O(n) file ranking                                |
| Discovery Services | File watching for auto-refresh, caching                                    |

## Testing

```bash
nx test workspace-intelligence        # Run unit tests
nx run workspace-intelligence:build   # Build to CommonJS
```

## File Paths Reference

- **Context**: `src/context/`, `src/context-analysis/`
- **Indexing**: `src/file-indexing/`
- **Project**: `src/project-analysis/`
- **Autocomplete**: `src/autocomplete/`
- **AST**: `src/ast/`
- **Services**: `src/services/`
- **Types**: `src/types/`
- **Entry Point**: `src/index.ts`
