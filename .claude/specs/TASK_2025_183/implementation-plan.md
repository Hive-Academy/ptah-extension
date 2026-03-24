# Implementation Plan - TASK_2025_183: Ptah Context Engine (Re-Plan)

**Re-Plan Date**: 2026-03-18
**Replaces**: Previous 77KB implementation plan (outdated)
**Requirements**: task-description.md (58KB, still valid)
**Status**: ~50-70% of Pillar 1 done, 0% of Pillars 2 and 3

---

## Codebase Investigation Summary

### What Changed Since the Original Plan

| Change                                                             | Impact on Architecture                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `platform-core` library added (Tasks 199-203)                      | New services SHOULD use `IFileSystemProvider` / `IWorkspaceProvider` for cross-platform compatibility |
| `platform-vscode` / `platform-electron` added                      | Platform implementations exist for all interfaces                                                     |
| `rpc-handlers` library added (Task 203)                            | Context Engine RPC endpoints (if any) go here                                                         |
| Multi-provider CLI adapters (Gemini, Codex, Copilot)               | Session memory hooks must work across ALL providers, not just Claude SDK                              |
| File-based storage decision confirmed                              | NO sql.js/SQLite. Use `fs/promises` + markdown + JSON                                                 |
| `ContextOrchestrationService` now injects `DependencyGraphService` | Wiring already done via `TOKENS.DEPENDENCY_GRAPH_SERVICE` (line 221-229)                              |
| `DependencyGraphService.invalidateFile()` fully implemented        | Lines 314-359, removes node + edges + invalidates symbol index                                        |
| gray-matter available as dependency                                | Listed in `workspace-intelligence/package.json`                                                       |

### Current API Surface (Verified 2026-03-18)

#### DependencyGraphService (`libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`)

- `buildGraph(filePaths, workspaceRoot, tsconfigPaths?)` -- Full graph build with chunked parallelism (line 101)
- `getDependencies(filePath, depth=1)` -- Forward traversal, max depth 3, cycle detection (line 243)
- `getDependents(filePath)` -- Reverse dependency lookup (line 272)
- `getSymbolIndex()` -- Lazy-computed `Map<string, ExportInfo[]>` (line 289)
- `invalidateFile(filePath)` -- Removes node + all edges + invalidates symbol cache (line 314)
- `isBuilt()` -- Returns boolean (line 364)
- **MISSING**: `updateFile(filePath)` -- Incremental re-parse after invalidation
- **MISSING**: `getGraph()` accessor for cache serialization
- Data structures: `DependencyGraph`, `FileNode`, `SymbolIndex` (exported)

#### ContextOrchestrationService (`libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`)

- Already injects `DependencyGraphService` via `@inject(TOKENS.DEPENDENCY_GRAPH_SERVICE)` (line 221)
- Already injects `ContextSizeOptimizerService` via `@inject(TOKENS.CONTEXT_SIZE_OPTIMIZER)` (line 223)
- Already wires graph into optimizer: `this.contextSizeOptimizer.setDependencyGraph(this.dependencyGraph)` (line 229)
- Stateless facade over `ContextService` -- delegates all operations

#### FileRelevanceScorerService (`libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts`)

- `scoreFile(file, query?, symbolIndex?, activeFileImports?)` -- Returns `FileRelevanceResult` (line 50)
- `rankFiles(files, query?, symbolIndex?, activeFileImports?)` -- Returns sorted Map (line 174)
- `getTopFiles(files, query, limit, symbolIndex?, activeFileImports?)` -- Top N results (line 209)
- Scoring factors: path keywords, file type, language patterns, framework patterns, task patterns, symbol matching
- **MISSING**: Graph proximity signal (dependency hop distance)
- **MISSING**: Session memory signal (recently touched files, error patterns)
- **MISSING**: Context profile weighting

#### ContextSizeOptimizerService (`libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts`)

- Already has `DependencyGraphInterface` (lines 34-38) and `setDependencyGraph()` (line 175)
- Uses `dependencyGraph?.getSymbolIndex()` for symbol-aware scoring (line 198-204)
- `contentOverrides` map for structural summaries (line 114)
- Two modes: `full` and `structural`

#### FileSystemManager (`libs/backend/vscode-core/src/api-wrappers/file-system-manager.ts`)

- `handleWatcherEvent(watcherId, eventType, uri)` -- **STUB** at lines 546-555, no-op implementation
- `createWatcher(config)` -- Fully implemented, manages `activeWatchers` map
- This is VS Code-specific (uses `vscode.FileSystemWatcher`)

#### SdkQueryOptionsBuilder (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`)

- `createHooks(cwd, sessionId?, onCompactionStart?)` -- Merges SubagentHookHandler + CompactionHookHandler hooks (line 718)
- Hook merging: concatenates `HookCallbackMatcher[]` arrays per event key (line 737-743)
- **NOTE**: `SessionStartHookHandler` is NOT currently merged here -- it was deleted (file does not exist)
- **FINDING**: Session start hook handling is done differently now

#### AnalysisStorageService (`libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`)

- Pattern to follow: `fs/promises` (mkdir, readdir, readFile, writeFile, rm, stat)
- Uses `join()` for path construction
- JSON manifests + markdown phase files
- Error handling: try/catch returning null on failure
- Idempotent directory creation

#### Platform Core (`libs/backend/platform-core/`)

- `IFileSystemProvider` -- readFile, writeFile, createDirectory, exists, delete, findFiles, createFileWatcher (line 17-105)
- `IWorkspaceProvider` -- getWorkspaceFolders, getWorkspaceRoot, getConfiguration (line 9-51)
- `IFileWatcher` -- onDidChange, onDidCreate, onDidDelete events (platform.types.ts line 73-77)
- `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
- Used by PtahAPIBuilder already (line 37-41 of ptah-api-builder.service.ts)

#### CLI Adapters (`libs/backend/llm-abstraction/src/lib/services/cli-adapters/`)

- `CliAdapter` interface with `name: CliType`, `detect()`, `buildCommand()`, `runSdk?()` (line 82-137)
- Implementations: `gemini-cli.adapter.ts` (spawn), `codex-cli.adapter.ts` (SDK), `copilot-sdk.adapter.ts` (SDK)
- `CliDetectionService` in `llm-abstraction` registered as `TOKENS.CLI_DETECTION_SERVICE`
- `AgentProcessManager` orchestrates agent execution

#### DI Token Pattern

- All tokens use `Symbol.for('DescriptiveName')` -- globally unique
- `TOKENS` namespace in `vscode-core/src/di/tokens.ts` for core/workspace-intelligence tokens
- `SDK_TOKENS` in `agent-sdk/src/lib/di/tokens.ts` for SDK-specific tokens
- Registration in `workspace-intelligence/src/di/register.ts` uses 8 tiers
- Registration in container.ts: Phase 2 = workspace-intelligence, Phase 2.7 = agent-sdk

### Multi-Provider Hook Architecture

The observation hooks need to work with ALL providers. The current hook system:

1. **Claude SDK path**: `SdkQueryOptionsBuilder.createHooks()` creates `PostToolUse`, `SessionEnd`, etc. hooks. These are Claude SDK-specific hooks using `HookCallbackMatcher` from `claude-sdk.types.ts`.
2. **CLI adapters (Gemini, Codex, Copilot)**: These use `AgentProcessManager` which spawns processes via `CliAdapter.buildCommand()` or `CliAdapter.runSdk()`. They do NOT use SDK hooks -- they produce `CliOutputSegment` or `FlatStreamEventUnion` events.

**Architecture Decision**: Session memory observation must work at TWO levels:

- **SDK hooks level** (Claude SDK only): `PostToolUse`, `SessionEnd` hooks in `SdkQueryOptionsBuilder`
- **Process output level** (all providers): Parse `FlatStreamEventUnion` events from `AgentProcessManager` for non-SDK providers

For this initial implementation, we focus on the SDK hooks path (Claude SDK) as the primary integration. Multi-provider support for Gemini/Codex/Copilot will use the same `SessionMemoryService` but observations will be captured from `AgentProcessManager` output parsing in a future phase.

---

## Architecture Overview

```
                         ┌─────────────────────────────────────────┐
                         │         Smart Context Curation          │
                         │  ContextProfileService                  │
                         │  Enhanced FileRelevanceScorerService    │
                         │  Memory Injection (SessionStart hooks)  │
                         │  MCP Memory Namespace                   │
                         └──────────┬──────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │                                     │
    ┌─────────────▼──────────────┐    ┌────────────────▼──────────────┐
    │     Live Code Graph        │    │      Session Memory           │
    │  LiveCodeGraphService      │    │  ObservationHookHandler       │
    │  GraphFileWatcherService   │    │  ObservationExtractor         │
    │  DependencyGraph.updateFile│    │  SessionMemoryService         │
    │  Graph Cache Persistence   │    │  MemoryQueryService           │
    └─────────────┬──────────────┘    └────────────────┬──────────────┘
                  │                                     │
    ┌─────────────▼──────────────────────────────────────▼──────────────┐
    │                    File-Based Context Storage                      │
    │  ContextStorageService (.claude/context/)                         │
    │  Session files (markdown + YAML frontmatter)                     │
    │  Graph cache (JSON)                                              │
    │  Context profiles (markdown)                                     │
    └──────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
.claude/context/
├── graph/
│   ├── dependency-graph.json     # Serialized DependencyGraph
│   └── symbol-index.json         # Serialized SymbolIndex
├── memory/
│   ├── sessions/
│   │   ├── sess_abc123.md        # Session observation log
│   │   └── sess_def456.md
│   └── summaries/
│       ├── latest.md             # Rolling summary (overwritten)
│       └── 2026-03-18.md         # Daily snapshot
└── profiles/
    ├── bugfix.md                 # Task-type scoring profile
    ├── feature.md
    └── review.md
```

---

## Phase Breakdown

### Phase 1: File-Based Context Storage (Independent, Start First)

**Estimated Effort**: 2-3 days
**Library**: `libs/backend/agent-sdk` (storage subdirectory)
**Prerequisites**: None

This phase creates the storage foundation that ALL other phases depend on.

#### 1.1 ContextStorageService

**File**: `libs/backend/agent-sdk/src/lib/storage/context-storage.service.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';
import { join } from 'path';
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'fs/promises';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import * as matter from 'gray-matter';

export interface SessionFileMetadata {
  session_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  observation_count: number;
}

export interface SessionFileContent {
  metadata: SessionFileMetadata;
  observations: string; // Raw markdown observations section
}

@injectable()
export class ContextStorageService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  // Core methods:
  async initialize(workspacePath: string): Promise<void>; // Ensure .claude/context/ tree exists
  async writeSessionFile(workspacePath: string, sessionId: string, content: SessionFileContent): Promise<void>;
  async readSessionFile(workspacePath: string, sessionId: string): Promise<SessionFileContent | null>;
  async appendObservations(workspacePath: string, sessionId: string, newObservations: string, newCount: number): Promise<void>;
  async listSessionFiles(workspacePath: string): Promise<SessionFileMetadata[]>; // Sorted by updated_at desc
  async writeGraphCache(workspacePath: string, type: 'dependency-graph' | 'symbol-index', data: unknown): Promise<void>;
  async readGraphCache(workspacePath: string, type: 'dependency-graph' | 'symbol-index'): Promise<unknown | null>;
  async writeSummary(workspacePath: string, summaryId: string, content: string): Promise<void>;
  async readSummary(workspacePath: string, summaryId: string): Promise<string | null>;
  async writeProfile(workspacePath: string, profileName: string, content: string): Promise<void>;
  async readProfile(workspacePath: string, profileName: string): Promise<string | null>;
  async pruneOldSessions(workspacePath: string, retentionDays: number): Promise<number>; // Returns count deleted
}
```

**Pattern**: Follow `AnalysisStorageService` exactly:

- All I/O via `fs/promises` (import from `fs/promises`, NOT `vscode.workspace.fs`)
- `join()` for path construction
- `mkdir(path, { recursive: true })` for idempotent directory creation
- `try/catch` returning `null` on read failures
- `gray-matter` for YAML frontmatter parsing (already a dependency)

**DI Token**: `SDK_TOKENS.SDK_CONTEXT_STORAGE` = `Symbol.for('SdkContextStorage')`

**Evidence**:

- `AnalysisStorageService` pattern: `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:1-267`
- `gray-matter` available: `libs/backend/workspace-intelligence/package.json:17`
- Storage path convention: `.claude/context/` (per context.md line 79)

#### 1.2 Session File Format Implementation

The session markdown files use YAML frontmatter (parsed by gray-matter) with an observations section:

```markdown
---
session_id: 'sess_abc123'
workspace_id: '/path/to/workspace'
created_at: '2026-03-08T10:00:00Z'
updated_at: '2026-03-08T10:30:00Z'
observation_count: 15
---

## Observations

### [2026-03-08T10:01:00Z] file_read

- **File**: src/services/auth.service.ts
- **Importance**: 0.5

### [2026-03-08T10:02:00Z] file_edit

- **File**: src/services/auth.service.ts
- **Content**: Added login validation to authenticate() method
- **Importance**: 0.6
```

**Append strategy**: Read file, parse with gray-matter, append new observation entries to content, update frontmatter `updated_at` and `observation_count`, write back.

#### 1.3 Context Profile Files

**Files**: `libs/backend/agent-sdk/src/lib/storage/default-profiles/` (CREATE directory)

- `bugfix.md` -- Bugfix scoring weights
- `feature.md` -- Feature scoring weights
- `review.md` -- Review scoring weights

Profile format:

```markdown
---
name: bugfix
description: Optimized for bug fixing tasks
weights:
  path_relevance: 1.0
  graph_proximity: 1.2
  memory_recency: 1.5
  memory_frequency: 1.0
  error_history: 2.0
  file_type: 0.8
---

## Bugfix Profile

Error-related files and recently edited files are prioritized...
```

#### 1.4 Unit Tests

**File**: `libs/backend/agent-sdk/src/lib/storage/context-storage.service.spec.ts` (CREATE)

Tests with temporary directory fixtures:

- Directory creation (idempotent)
- Session file CRUD (write, read, append, list)
- Graph cache CRUD
- Summary file CRUD
- Profile file CRUD
- Pruning with retention periods
- Error handling (corrupt files, missing dirs)
- Frontmatter parsing edge cases

#### 1.5 DI Registration

**File**: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY)

- Add `SDK_CONTEXT_STORAGE: Symbol.for('SdkContextStorage')`

**File**: `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY)

- Register `ContextStorageService` as singleton

**File**: `libs/backend/agent-sdk/src/index.ts` (MODIFY)

- Export `ContextStorageService` and types

---

### Phase 2: Live Code Graph (Partially Done)

**Estimated Effort**: 2-3 days
**Library**: `libs/backend/workspace-intelligence`
**Prerequisites**: None (independent of Phase 1, but Phase 1.1 needed for graph cache)

#### 2.1 DependencyGraphService.updateFile() -- Incremental Update

**File**: `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts` (MODIFY)

Add method after `invalidateFile()` (after line 359):

```typescript
/**
 * Incrementally update a single file in the dependency graph.
 * Invalidates old data, re-parses, and re-inserts with new edges.
 *
 * @param filePath - Absolute file path
 * @param workspaceRoot - Workspace root for relative path resolution
 * @param tsconfigPaths - Optional tsconfig paths for alias resolution
 */
async updateFile(
  filePath: string,
  workspaceRoot: string,
  tsconfigPaths?: Record<string, string[]>
): Promise<void>;
```

Implementation steps:

1. Normalize path
2. Read file content via `this.fileSystem.readFile(filePath)`
3. Compare content hash against previous (skip if unchanged)
4. Call `this.invalidateFile(filePath)` to remove old data
5. Parse with `this.astAnalysis.analyzeSource(content, language, normalizedPath)`
6. Create new `FileNode` with imports/exports
7. Insert into `this.graph.nodes`
8. Resolve imports against existing `knownFiles` set + the file's own new node
9. Build forward edges, update reverse edges
10. Invalidate symbol index cache

Also add:

- `getGraph(): DependencyGraph | null` -- accessor for serialization
- Private `contentHashes: Map<string, string>` for content hash caching (use simple string hash)

**Evidence**:

- `invalidateFile()` pattern: lines 314-359
- `buildGraph()` parsing pattern: lines 122-176 (processFile)
- Import resolution: `resolveImportPath()` at line 410

#### 2.2 GraphFileWatcherService

**File**: `libs/backend/workspace-intelligence/src/graph/graph-file-watcher.service.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IFileSystemProvider, IFileWatcher, IDisposable } from '@ptah-extension/platform-core';

@injectable()
export class GraphFileWatcherService {
  private watchers: IDisposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingUpdates: Map<string, 'created' | 'changed' | 'deleted'> = new Map();

  constructor(@inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) private readonly fs: IFileSystemProvider, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Start watching for TS/JS file changes.
   * @param onBatch - Callback with batched file changes after debounce
   */
  startWatching(onBatch: (changes: Map<string, 'created' | 'changed' | 'deleted'>) => void): void;

  /**
   * Stop all watchers and clean up.
   */
  stopWatching(): void;
}
```

Uses `IFileSystemProvider.createFileWatcher('**/*.{ts,tsx,js,jsx}')` from platform-core for cross-platform support.

Debounce: Collect events for 100ms, then call `onBatch` with the merged set. If a file has multiple events within the window, last event wins (e.g., created+changed = changed, changed+deleted = deleted).

**DI Token**: `TOKENS.GRAPH_FILE_WATCHER_SERVICE` = `Symbol.for('GraphFileWatcherService')`

**Evidence**:

- `IFileSystemProvider.createFileWatcher()` at `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:98-104`
- `IFileWatcher` type at `libs/backend/platform-core/src/types/platform.types.ts:73-77`
- Existing watcher patterns in workspace-intelligence (AgentDiscoveryService, CommandDiscoveryService)

#### 2.3 LiveCodeGraphService -- Lifecycle Manager

**File**: `libs/backend/workspace-intelligence/src/graph/live-code-graph.service.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { DependencyGraphService, type DependencyGraph, type SymbolIndex } from '../ast/dependency-graph.service';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { GraphFileWatcherService } from './graph-file-watcher.service';

@injectable()
export class LiveCodeGraphService {
  private initialized = false;
  private building = false;

  constructor(@inject(TOKENS.DEPENDENCY_GRAPH_SERVICE) private readonly graphService: DependencyGraphService, @inject(TOKENS.WORKSPACE_INDEXER_SERVICE) private readonly indexer: WorkspaceIndexerService, @inject(TOKENS.GRAPH_FILE_WATCHER_SERVICE) private readonly watcher: GraphFileWatcherService, @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** Ensure graph is built (lazy init). Safe to call multiple times. */
  async ensureGraph(): Promise<void>;

  /** Force a full graph rebuild. */
  async rebuild(): Promise<void>;

  /** Dispose watchers and resources. */
  dispose(): void;

  /** Get reference to the underlying DependencyGraphService. */
  getGraphService(): DependencyGraphService;
}
```

Lifecycle:

1. `ensureGraph()` called on first context request -- indexes workspace files, calls `buildGraph()`, starts watchers
2. Watcher `onBatch` callback: for each changed file, call `updateFile()` (created/changed) or `invalidateFile()` (deleted)
3. After initial build and after periodic full rebuilds, persist graph cache via `ContextStorageService` (optional dependency)
4. `dispose()` stops watchers, releases graph reference

**DI Token**: `TOKENS.LIVE_CODE_GRAPH_SERVICE` = `Symbol.for('LiveCodeGraphService')`

#### 2.4 Graph Cache Persistence

In `LiveCodeGraphService`:

- After `buildGraph()` completes, fire-and-forget write to `.claude/context/graph/dependency-graph.json` and `symbol-index.json`
- On `ensureGraph()`, attempt to load from cache first. Validate freshness by comparing workspace file count and build timestamp.
- If cache is stale or missing, perform full build.

Serialization: `DependencyGraph` uses `Map` objects. Serialize with custom replacer:

```typescript
// Serialize: Map -> Array of [key, value]
// DependencyGraph.nodes -> Array<[string, FileNode]>
// DependencyGraph.edges -> Array<[string, string[]]> (Set -> Array)
```

The `ContextStorageService` dependency is optional -- if not available (e.g., storage init failed), skip caching silently.

#### 2.5 Wire LiveCodeGraphService into Existing Services

**File**: `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts` (MODIFY)

Replace direct `DependencyGraphService` injection with `LiveCodeGraphService`:

```typescript
constructor(
  private readonly contextService: ContextService,
  @inject(TOKENS.LIVE_CODE_GRAPH_SERVICE)
  private readonly liveCodeGraph: LiveCodeGraphService,
  @inject(TOKENS.CONTEXT_SIZE_OPTIMIZER)
  private readonly contextSizeOptimizer: ContextSizeOptimizerService
) {
  // Wire the underlying graph service into the optimizer
  this.contextSizeOptimizer.setDependencyGraph(this.liveCodeGraph.getGraphService());
}
```

This ensures the graph is lazily initialized and auto-updated.

#### 2.6 DI Registration for Graph Services

**File**: `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY)

- Add `GRAPH_FILE_WATCHER_SERVICE: Symbol.for('GraphFileWatcherService')`
- Add `LIVE_CODE_GRAPH_SERVICE: Symbol.for('LiveCodeGraphService')`
- Add these to `TOKENS` object

**File**: `libs/backend/workspace-intelligence/src/di/register.ts` (MODIFY)

- Add Tier 6c after Tier 6b: Register `GraphFileWatcherService` and `LiveCodeGraphService`
- `LiveCodeGraphService` depends on `DependencyGraphService`, `WorkspaceIndexerService`, `GraphFileWatcherService`

**File**: `libs/backend/workspace-intelligence/src/index.ts` (MODIFY)

- Export `LiveCodeGraphService`, `GraphFileWatcherService`

#### 2.7 Unit Tests

**Files to create**:

- `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.spec.ts` -- Test `updateFile()`, content hash skipping
- `libs/backend/workspace-intelligence/src/graph/graph-file-watcher.service.spec.ts` -- Test debouncing, event batching
- `libs/backend/workspace-intelligence/src/graph/live-code-graph.service.spec.ts` -- Test lazy init, rebuild, dispose

---

### Phase 3: Session Memory (Depends on Phase 1)

**Estimated Effort**: 3-4 days
**Library**: `libs/backend/agent-sdk`
**Prerequisites**: Phase 1 (ContextStorageService)

#### 3.1 Observation Types

**File**: `libs/backend/agent-sdk/src/lib/storage/observation.types.ts` (CREATE)

```typescript
export type ObservationType = 'file_read' | 'file_edit' | 'search' | 'error' | 'decision';

export interface Observation {
  readonly timestamp: string; // ISO 8601
  readonly type: ObservationType;
  readonly filePath?: string; // Workspace-relative
  readonly content?: string; // Description
  readonly importance: number; // 0.0 - 1.0
}

export interface SessionSummary {
  readonly session_id: string;
  readonly workspace_id: string;
  readonly created_at: string;
  readonly files_touched: string[];
  readonly key_decisions: string[];
  readonly summary_text: string;
}
```

#### 3.2 ObservationExtractor

**File**: `libs/backend/agent-sdk/src/lib/storage/observation-extractor.ts` (CREATE)

Pure function module (no class needed, testable independently):

```typescript
import type { Observation } from './observation.types';

/**
 * Extract a structured observation from a PostToolUse event.
 * Returns null for unrecognized tools.
 */
export function extractObservation(toolName: string, toolInput: Record<string, unknown>, toolResult?: string, isError?: boolean): Observation | null;

/**
 * Normalize a file path to workspace-relative format.
 */
export function normalizeFilePath(filePath: string, workspacePath: string): string;

/**
 * Format observations as markdown for session file append.
 */
export function formatObservationsAsMarkdown(observations: Observation[]): string;
```

Extraction rules:

- `Read` tool -> `file_read` observation, importance 0.5
- `Edit` / `Write` tool -> `file_edit` observation, importance 0.6
- `Bash` tool with grep/find/rg -> `search` observation, importance 0.3
- `PostToolUseFailure` -> `error` observation, importance 0.8
- Other tools -> return `null` (skip)

**Evidence**:

- Tool names from SDK types: `Read`, `Edit`, `Write`, `Bash`, `Grep` (from claude-sdk.types.ts)
- `file_path` field in tool input (from task-description.md requirement 3.2)

#### 3.3 ObservationHookHandler

**File**: `libs/backend/agent-sdk/src/lib/helpers/observation-hook-handler.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { HookEvent, HookCallbackMatcher } from '../types/sdk-types/claude-sdk.types';
import type { Observation } from '../storage/observation.types';

@injectable()
export class ObservationHookHandler {
  private buffer: Observation[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private workspacePath: string | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger // ContextStorageService injected via SDK_TOKENS.SDK_CONTEXT_STORAGE
  ) {}

  /** Create hooks for PostToolUse and SessionEnd events. */
  createHooks(workspacePath: string, sessionId: string): Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  /** Flush buffered observations to session file. */
  async flush(): Promise<void>;

  /** Stop flush interval and flush remaining observations. */
  async dispose(): Promise<void>;
}
```

Pattern: Follow `SubagentHookHandler` and `CompactionHookHandler`:

- Return `{ continue: true }` from all hooks (never block)
- Fire-and-forget callbacks (never await in hook)
- Buffer observations in memory, flush every 5 seconds
- On `SessionEnd`, flush remaining observations and generate summary

**DI Token**: `SDK_TOKENS.SDK_OBSERVATION_HOOK_HANDLER` = `Symbol.for('SdkObservationHookHandler')`

**Evidence**:

- `SubagentHookHandler.createHooks()` pattern: `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts`
- `CompactionHookHandler.createHooks()` pattern: `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`
- Hook merging in `SdkQueryOptionsBuilder`: lines 718-743

#### 3.4 SessionMemoryService -- Storage Facade

**File**: `libs/backend/agent-sdk/src/lib/storage/session-memory.service.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';
import type { Observation, SessionSummary } from './observation.types';

@injectable()
export class SessionMemoryService {
  constructor() {} // @inject(SDK_TOKENS.SDK_MEMORY_QUERY) memoryQuery // @inject(SDK_TOKENS.SDK_CONTEXT_STORAGE) contextStorage

  async addObservation(workspacePath: string, sessionId: string, observation: Observation): Promise<void>;
  async flushObservations(workspacePath: string, sessionId: string): Promise<void>;
  async addSessionSummary(workspacePath: string, summary: SessionSummary): Promise<void>;
  async getRecentObservations(workspacePath: string, limit?: number): Promise<Observation[]>;
  async getFileHistory(workspacePath: string, filePath: string, limit?: number): Promise<Observation[]>;
  async pruneOldObservations(workspacePath: string, retentionDays?: number): Promise<void>;
}
```

**DI Token**: `SDK_TOKENS.SDK_SESSION_MEMORY` = `Symbol.for('SdkSessionMemory')`

#### 3.5 MemoryQueryService -- File-Based Querying

**File**: `libs/backend/agent-sdk/src/lib/storage/memory-query.service.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';

@injectable()
export class MemoryQueryService {
  private queryCache: Map<string, { result: unknown; expiry: number }> = new Map();

  constructor() {} // @inject(SDK_TOKENS.SDK_CONTEXT_STORAGE) contextStorage

  async searchByContent(workspacePath: string, query: string, limit?: number): Promise<Observation[]>;
  async getRecentlyTouchedFiles(workspacePath: string, days?: number, limit?: number): Promise<string[]>;
  async getFileObservations(workspacePath: string, filePath: string, limit?: number): Promise<Observation[]>;
  async getSessionSummaries(workspacePath: string, limit?: number): Promise<SessionSummary[]>;
  async getErrorPatterns(workspacePath: string, days?: number): Promise<Map<string, number>>; // file -> error count
}
```

Query implementation:

- Read session files via `ContextStorageService.listSessionFiles()` (sorted by recency)
- Limit scan to most recent 100 files
- Case-insensitive substring matching for content search
- Cache results for 30 seconds

**DI Token**: `SDK_TOKENS.SDK_MEMORY_QUERY` = `Symbol.for('SdkMemoryQuery')`

#### 3.6 Wire Hooks into SdkQueryOptionsBuilder

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)

In `createHooks()` method (line 718):

1. Add `ObservationHookHandler` as a constructor dependency
2. Create observation hooks via `this.observationHookHandler.createHooks(cwd, sessionId)`
3. Merge into `mergedHooks` alongside subagent and compaction hooks

```typescript
// Add to constructor:
@inject(SDK_TOKENS.SDK_OBSERVATION_HOOK_HANDLER)
private readonly observationHookHandler: ObservationHookHandler

// In createHooks():
const observationHooks = this.observationHookHandler.createHooks(cwd, sessionId ?? '');
for (const hooks of [subagentHooks, compactionHooks, observationHooks]) {
  for (const [event, matchers] of Object.entries(hooks)) {
    const key = event as HookEvent;
    mergedHooks[key] = [...(mergedHooks[key] || []), ...matchers];
  }
}
```

#### 3.7 DI Registration

**File**: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY)

- Add `SDK_OBSERVATION_HOOK_HANDLER: Symbol.for('SdkObservationHookHandler')`
- Add `SDK_SESSION_MEMORY: Symbol.for('SdkSessionMemory')`
- Add `SDK_MEMORY_QUERY: Symbol.for('SdkMemoryQuery')`
- Add `SDK_CONTEXT_STORAGE: Symbol.for('SdkContextStorage')` (from Phase 1)

**File**: `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY)

- Register `ContextStorageService`, `MemoryQueryService`, `SessionMemoryService`, `ObservationHookHandler`

**File**: `libs/backend/agent-sdk/src/index.ts` (MODIFY)

- Export new services and types

#### 3.8 Unit Tests

**Files to create**:

- `libs/backend/agent-sdk/src/lib/storage/observation-extractor.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/observation-hook-handler.spec.ts`
- `libs/backend/agent-sdk/src/lib/storage/session-memory.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/storage/memory-query.service.spec.ts`

---

### Phase 4: Smart Context Curation (Depends on Phases 2 + 3)

**Estimated Effort**: 2-3 days
**Library**: `libs/backend/workspace-intelligence` + `libs/backend/agent-sdk` + `libs/backend/vscode-lm-tools`
**Prerequisites**: Phase 2 (graph), Phase 3 (memory)

#### 4.1 ContextProfileService

**File**: `libs/backend/workspace-intelligence/src/context-analysis/context-profile.service.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';

export interface ContextProfile {
  name: string;
  description: string;
  weights: {
    path_relevance: number;
    graph_proximity: number;
    memory_recency: number;
    memory_frequency: number;
    error_history: number;
    file_type: number;
  };
}

const DEFAULT_PROFILES: Record<string, ContextProfile> = {
  bugfix: {
    name: 'bugfix',
    description: 'Optimized for bug fixing tasks',
    weights: { path_relevance: 1.0, graph_proximity: 1.2, memory_recency: 1.5, memory_frequency: 1.0, error_history: 2.0, file_type: 0.8 },
  },
  feature: {
    name: 'feature',
    description: 'Optimized for feature development',
    weights: { path_relevance: 1.0, graph_proximity: 1.0, memory_recency: 1.0, memory_frequency: 1.0, error_history: 0.5, file_type: 1.0 },
  },
  review: {
    name: 'review',
    description: 'Optimized for code review',
    weights: { path_relevance: 0.8, graph_proximity: 1.5, memory_recency: 1.2, memory_frequency: 0.8, error_history: 1.0, file_type: 0.8 },
  },
};

@injectable()
export class ContextProfileService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** Get profile by name (loads from .claude/context/profiles/ if exists, falls back to defaults) */
  async getProfile(profileName: string): Promise<ContextProfile>;

  /** Auto-detect profile from prompt keywords */
  detectProfile(prompt: string): string; // Returns profile name

  /** List available profiles */
  async listProfiles(workspacePath: string): Promise<string[]>;
}
```

Profile auto-detection rules:

- Keywords `fix`, `bug`, `error`, `crash`, `broken` -> `bugfix`
- Keywords `implement`, `add`, `create`, `feature`, `build` -> `feature`
- Keywords `review`, `check`, `audit`, `inspect` -> `review`
- Default: `feature`

**DI Token**: `TOKENS.CONTEXT_PROFILE_SERVICE` = `Symbol.for('ContextProfileService')`

#### 4.2 Enhanced FileRelevanceScorerService

**File**: `libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts` (MODIFY)

Add new scoring signals to `scoreFile()`:

```typescript
scoreFile(
  file: IndexedFile,
  query?: string,
  symbolIndex?: SymbolIndex,
  activeFileImports?: ImportInfo[],
  // NEW optional parameters:
  graphProximitySet?: Map<string, number>, // file path -> hop distance (1 or 2)
  memorySignals?: MemorySignals,
  profile?: ContextProfile
): FileRelevanceResult;
```

New interface:

```typescript
export interface MemorySignals {
  recentlyTouched: Set<string>; // File paths touched in last 3 sessions
  sessionRecency: Map<string, number>; // File path -> recency score (0.05-0.2)
  errorFiles: Set<string>; // Files that appeared in error observations
}
```

New scoring methods (private):

- `scoreByGraphProximity(file, graphProximitySet, reasons)` -- 1 hop: +0.3, 2 hops: +0.15
- `scoreByMemory(file, memorySignals, reasons)` -- Recency boost from map, error file boost +0.15
- Profile weight multiplication: multiply each signal's score by `profile.weights[signal]`

**Important**: All new parameters are optional. When not provided, scoring degrades gracefully to existing behavior. This preserves backward compatibility for all existing callers.

#### 4.3 Graph Proximity Building

In `ContextSizeOptimizerService.optimizeContext()` (MODIFY):

Before ranking files, build the graph proximity set if the dependency graph is available:

```typescript
// Build graph proximity set for the active file
let graphProximitySet: Map<string, number> | undefined;
if (this.dependencyGraph?.isBuilt() && activeFilePath) {
  graphProximitySet = new Map();
  // 1-hop dependencies
  for (const dep of this.dependencyGraph.getDependencies(activeFilePath, 1)) {
    graphProximitySet.set(dep, 1);
  }
  // 2-hop dependencies
  for (const dep of this.dependencyGraph.getDependencies(activeFilePath, 2)) {
    if (!graphProximitySet.has(dep)) {
      graphProximitySet.set(dep, 2);
    }
  }
  // Reverse dependencies (files that import active file)
  for (const dep of this.dependencyGraph.getDependents(activeFilePath)) {
    if (!graphProximitySet.has(dep)) {
      graphProximitySet.set(dep, 1);
    }
  }
}
```

Then pass `graphProximitySet` to `relevanceScorer.scoreFile()` / `rankFiles()`.

**Note**: The `activeFilePath` parameter needs to be added to `ContextOptimizationRequest` interface.

#### 4.4 Memory Context Injection at Session Start

**File**: `libs/backend/agent-sdk/src/lib/helpers/memory-context-builder.ts` (CREATE)

```typescript
import { injectable, inject } from 'tsyringe';

@injectable()
export class MemoryContextBuilder {
  constructor() {} // @inject(SDK_TOKENS.SDK_MEMORY_QUERY) memoryQuery // @inject(SDK_TOKENS.SDK_SESSION_MEMORY) sessionMemory

  /**
   * Build a <session_memory> block for system prompt injection.
   * Returns empty string if no relevant memory exists.
   */
  async buildMemoryContext(workspacePath: string, maxTokens?: number): Promise<string>;
}
```

Output format:

```
<session_memory>
## Recent File Activity
- [2 hours ago] Read: src/services/auth.service.ts
- [2 hours ago] Edited: src/services/auth.service.ts (added login validation)

## Previous Session Summary
[Summary text from latest.md]

## Known Issues
- [yesterday] Error in src/utils/parser.ts: TypeError - cannot read property of undefined
</session_memory>
```

Token budget: Default 2000 tokens. Truncate by dropping oldest observations first.

#### 4.5 Wire Memory into System Prompt

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)

In `assembleSystemPromptAppend()` or the prompt building flow:

1. Inject `MemoryContextBuilder`
2. Call `buildMemoryContext(workspacePath)` to get the memory block
3. Append to the system prompt if non-empty

This is done at session creation time, not per-message.

**DI Token**: `SDK_TOKENS.SDK_MEMORY_CONTEXT_BUILDER` = `Symbol.for('SdkMemoryContextBuilder')`

#### 4.6 Memory MCP Namespace

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/memory-namespace.builder.ts` (CREATE)

```typescript
export function buildMemoryNamespace(sessionMemoryService: SessionMemoryService, memoryQueryService: MemoryQueryService, workspacePath: string) {
  return {
    searchMemory: async (query: string, limit?: number) => {
      return memoryQueryService.searchByContent(workspacePath, query, limit);
    },
    getRecentFiles: async (days?: number, limit?: number) => {
      return memoryQueryService.getRecentlyTouchedFiles(workspacePath, days, limit);
    },
    getSessionSummaries: async (limit?: number) => {
      return memoryQueryService.getSessionSummaries(workspacePath, limit);
    },
    getFileHistory: async (filePath: string, limit?: number) => {
      return memoryQueryService.getFileObservations(workspacePath, filePath, limit);
    },
  };
}
```

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (MODIFY)

- Import `buildMemoryNamespace`
- Add `memory` namespace to the `PtahAPI` object
- Resolve `SessionMemoryService` and `MemoryQueryService` from container

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (MODIFY)

- Add `memory` namespace type to `PtahAPI` interface

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` (MODIFY)

- Add `memory` namespace documentation to system prompt

#### 4.7 DI Registration for Curation Services

**File**: `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY)

- Add `CONTEXT_PROFILE_SERVICE: Symbol.for('ContextProfileService')`

**File**: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY)

- Add `SDK_MEMORY_CONTEXT_BUILDER: Symbol.for('SdkMemoryContextBuilder')`

**File**: `libs/backend/workspace-intelligence/src/di/register.ts` (MODIFY)

- Add `ContextProfileService` registration in Tier 5 (context services)

**File**: `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY)

- Register `MemoryContextBuilder`

#### 4.8 Unit Tests

**Files to create**:

- `libs/backend/workspace-intelligence/src/context-analysis/context-profile.service.spec.ts`
- `libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.spec.ts` (extend existing or create)
- `libs/backend/agent-sdk/src/lib/helpers/memory-context-builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/memory-namespace.builder.spec.ts`

---

### Phase 5: Integration and Testing (Depends on All Prior Phases)

**Estimated Effort**: 2-3 days
**Libraries**: All affected
**Prerequisites**: Phases 1-4

#### 5.1 Integration Tests

- Graph update end-to-end: file save -> watcher event -> debounce -> updateFile() -> verifiable query
- Session memory capture: mock PostToolUse events -> verify observations in session file
- Memory persistence: store observations -> simulate restart -> query session files
- Content search: write observations with known keywords -> searchByContent returns them
- Memory injection: store observations -> create session -> verify system prompt contains memory block
- Graph cache: build graph -> persist -> load from cache -> verify consistency

#### 5.2 Performance Benchmarks

- Graph build time (280 files) < 5 seconds
- Incremental update (1 file) < 200ms
- Session file write (append 20 observations) < 50ms
- Content search (50 session files) < 200ms
- Memory context assembly < 100ms
- Graph cache load < 500ms

#### 5.3 Documentation Updates

**Files to update**:

- `libs/backend/workspace-intelligence/CLAUDE.md` -- Add graph lifecycle, LiveCodeGraphService docs
- `libs/backend/agent-sdk/CLAUDE.md` -- Add session memory, ContextStorageService docs
- `libs/backend/vscode-lm-tools/CLAUDE.md` -- Add memory namespace docs
- `libs/backend/vscode-core/CLAUDE.md` -- Add new TOKENS docs

---

## DI Registration Strategy

### New Tokens Summary

| Token                                     | Location              | Service                   |
| ----------------------------------------- | --------------------- | ------------------------- |
| `TOKENS.GRAPH_FILE_WATCHER_SERVICE`       | vscode-core/tokens.ts | `GraphFileWatcherService` |
| `TOKENS.LIVE_CODE_GRAPH_SERVICE`          | vscode-core/tokens.ts | `LiveCodeGraphService`    |
| `TOKENS.CONTEXT_PROFILE_SERVICE`          | vscode-core/tokens.ts | `ContextProfileService`   |
| `SDK_TOKENS.SDK_CONTEXT_STORAGE`          | agent-sdk/tokens.ts   | `ContextStorageService`   |
| `SDK_TOKENS.SDK_OBSERVATION_HOOK_HANDLER` | agent-sdk/tokens.ts   | `ObservationHookHandler`  |
| `SDK_TOKENS.SDK_SESSION_MEMORY`           | agent-sdk/tokens.ts   | `SessionMemoryService`    |
| `SDK_TOKENS.SDK_MEMORY_QUERY`             | agent-sdk/tokens.ts   | `MemoryQueryService`      |
| `SDK_TOKENS.SDK_MEMORY_CONTEXT_BUILDER`   | agent-sdk/tokens.ts   | `MemoryContextBuilder`    |

### Registration Order

**workspace-intelligence** (`registerWorkspaceIntelligenceServices`):

```
Existing Tier 1-6b: (unchanged)
NEW Tier 6c: GraphFileWatcherService (depends on PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
NEW Tier 6d: LiveCodeGraphService (depends on DependencyGraphService, WorkspaceIndexerService, GraphFileWatcherService)
Modified Tier 5: Add ContextProfileService
Existing Tier 7-8: (unchanged)
```

**IMPORTANT**: `ContextOrchestrationService` (Tier 5) currently injects `TOKENS.DEPENDENCY_GRAPH_SERVICE`. After this task, it will inject `TOKENS.LIVE_CODE_GRAPH_SERVICE` instead. Since `LiveCodeGraphService` is in Tier 6d (after Tier 5), we need to change `ContextOrchestrationService` to use lazy resolution or move its registration after Tier 6d. The simplest approach: use `container.resolve()` in a factory registration for `ContextOrchestrationService`, or move it to a new Tier 7 position.

**agent-sdk** (`registerSdkServices`):

```
Existing services: (unchanged)
NEW: ContextStorageService (no dependencies beyond Logger)
NEW: MemoryQueryService (depends on ContextStorageService)
NEW: SessionMemoryService (depends on ContextStorageService, MemoryQueryService)
NEW: ObservationHookHandler (depends on ContextStorageService, Logger)
NEW: MemoryContextBuilder (depends on SessionMemoryService, MemoryQueryService)
```

---

## Interface Definitions

### Key TypeScript Interfaces (All New)

```typescript
// ===== Storage Types =====

interface SessionFileMetadata {
  session_id: string;
  workspace_id: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  observation_count: number;
}

interface SessionFileContent {
  metadata: SessionFileMetadata;
  observations: string; // Raw markdown
}

// ===== Observation Types =====

type ObservationType = 'file_read' | 'file_edit' | 'search' | 'error' | 'decision';

interface Observation {
  readonly timestamp: string; // ISO 8601
  readonly type: ObservationType;
  readonly filePath?: string; // Workspace-relative
  readonly content?: string; // Description text
  readonly importance: number; // 0.0 - 1.0
}

interface SessionSummary {
  readonly session_id: string;
  readonly workspace_id: string;
  readonly created_at: string;
  readonly files_touched: string[];
  readonly key_decisions: string[];
  readonly summary_text: string;
}

// ===== Context Profile Types =====

interface ContextProfile {
  name: string;
  description: string;
  weights: {
    path_relevance: number;
    graph_proximity: number;
    memory_recency: number;
    memory_frequency: number;
    error_history: number;
    file_type: number;
  };
}

// ===== Memory Signals for Scoring =====

interface MemorySignals {
  recentlyTouched: Set<string>; // File paths from last 3 sessions
  sessionRecency: Map<string, number>; // File -> recency score
  errorFiles: Set<string>; // Files with error observations
}
```

---

## Integration Points

### 1. DependencyGraphService <-> LiveCodeGraphService

- `LiveCodeGraphService` owns the graph lifecycle
- Wraps `DependencyGraphService` for lazy init and auto-update
- Exposes `getGraphService()` for consumers that need direct access

### 2. GraphFileWatcherService <-> Platform Core

- Uses `IFileSystemProvider.createFileWatcher()` (not VS Code API directly)
- Returns `IFileWatcher` with `onDidChange/Create/Delete` events
- Cross-platform compatible (VS Code + Electron)

### 3. ObservationHookHandler <-> SdkQueryOptionsBuilder

- Hooks merged via existing array concatenation pattern (line 737-743)
- New hook handler added alongside SubagentHookHandler and CompactionHookHandler
- All hooks follow fire-and-forget, `{ continue: true }` pattern

### 4. MemoryContextBuilder <-> System Prompt

- Generates `<session_memory>` block
- Appended to system prompt via `assembleSystemPromptAppend()` flow
- Respects 2000 token budget with graceful truncation

### 5. Memory MCP Namespace <-> PtahAPIBuilder

- New `ptah.memory` namespace exposed to AI agents
- 4 methods: searchMemory, getRecentFiles, getSessionSummaries, getFileHistory
- Follows existing namespace builder pattern

### 6. ContextStorageService <-> fs/promises

- All I/O via Node.js `fs/promises` (NOT VS Code workspace.fs, NOT IFileSystemProvider)
- Reason: Session files are in `.claude/context/` which is a workspace-local directory. Using `fs/promises` directly matches the `AnalysisStorageService` pattern and avoids platform abstraction overhead for file-based storage that is always local.

---

## Testing Strategy

### Unit Testing (Per Service)

| Service                               | Approach                      | Key Test Scenarios                                          |
| ------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `ContextStorageService`               | Temp directory fixtures       | CRUD ops, pruning, corrupt file handling, concurrent writes |
| `DependencyGraphService.updateFile()` | Mock AstAnalysisService       | Invalidate+reparse, content hash skip, new file addition    |
| `GraphFileWatcherService`             | Mock IFileSystemProvider      | Debounce timing, event batching, multi-event merge          |
| `LiveCodeGraphService`                | Mock dependencies             | Lazy init, rebuild, dispose cleanup, cache load             |
| `ObservationExtractor`                | Pure function tests           | Each tool type, unknown tools, path normalization           |
| `ObservationHookHandler`              | Mock ContextStorageService    | Buffer/flush cycle, SessionEnd flush, error resilience      |
| `SessionMemoryService`                | Mock storage                  | Observation CRUD, summary generation, pruning delegation    |
| `MemoryQueryService`                  | Temp directory with fixtures  | Content search, recency queries, file queries, cache TTL    |
| `ContextProfileService`               | Default profiles + temp files | Profile loading, auto-detection, fallback to defaults       |
| `FileRelevanceScorerService`          | Extended existing tests       | Graph proximity scoring, memory signals, profile weighting  |
| `MemoryContextBuilder`                | Mock query service            | Format correctness, token budget truncation, empty memory   |

### Integration Testing

| Test                   | Libraries                          | Scope                                                       |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Graph lifecycle        | workspace-intelligence             | file create -> watcher -> updateFile -> query               |
| Session memory flow    | agent-sdk                          | PostToolUse hook -> buffer -> flush -> query                |
| Memory injection       | agent-sdk                          | store observations -> build memory context -> verify prompt |
| MCP memory namespace   | vscode-lm-tools                    | execute ptah.memory.searchMemory() -> verify results        |
| Graph cache round-trip | workspace-intelligence + agent-sdk | build -> persist -> load -> verify consistency              |

---

## Risk Assessment (Updated)

| Risk                                            | Prob | Impact | Mitigation                                                                                                                                                      |
| ----------------------------------------------- | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session file count grows large (1000+)          | 20%  | Medium | 30-day auto-pruning, scan limit to 100 most recent files                                                                                                        |
| Substring search across session files too slow  | 15%  | Medium | 30s result cache, limit scan to recent files, summaries provide pre-aggregated data                                                                             |
| Incremental graph updates introduce stale edges | 30%  | Medium | Content hash skip for unchanged files, comprehensive unit tests for edge cases                                                                                  |
| PostToolUse hook adds latency to SDK pipeline   | 10%  | Medium | Fire-and-forget with 5s batch flush, never awaited                                                                                                              |
| Concurrent writes to same session file          | 20%  | Medium | In-memory buffer with single flush writer, serialized via interval                                                                                              |
| Platform abstraction gap for file watchers      | 15%  | Low    | GraphFileWatcherService uses IFileSystemProvider.createFileWatcher() -- implementations exist for VS Code and Electron                                          |
| Multi-provider observation capture deferred     | 40%  | Low    | Initial implementation covers Claude SDK only. Gemini/Codex/Copilot observation capture designed but not wired -- clean extension point via AgentProcessManager |
| ContextOrchestrationService DI ordering         | 25%  | Medium | Move registration to factory pattern or reorder tiers. Well-defined fix.                                                                                        |

---

## Files Affected Summary

### CREATE (14 files)

| File                                                                                                 | Library                | Purpose                          |
| ---------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------- |
| `libs/backend/agent-sdk/src/lib/storage/context-storage.service.ts`                                  | agent-sdk              | File-based storage manager       |
| `libs/backend/agent-sdk/src/lib/storage/context-storage.service.spec.ts`                             | agent-sdk              | Storage tests                    |
| `libs/backend/agent-sdk/src/lib/storage/observation.types.ts`                                        | agent-sdk              | Observation type definitions     |
| `libs/backend/agent-sdk/src/lib/storage/observation-extractor.ts`                                    | agent-sdk              | Tool event -> Observation parser |
| `libs/backend/agent-sdk/src/lib/storage/observation-extractor.spec.ts`                               | agent-sdk              | Extractor tests                  |
| `libs/backend/agent-sdk/src/lib/storage/session-memory.service.ts`                                   | agent-sdk              | Session memory facade            |
| `libs/backend/agent-sdk/src/lib/storage/session-memory.service.spec.ts`                              | agent-sdk              | Memory service tests             |
| `libs/backend/agent-sdk/src/lib/storage/memory-query.service.ts`                                     | agent-sdk              | File-based querying              |
| `libs/backend/agent-sdk/src/lib/storage/memory-query.service.spec.ts`                                | agent-sdk              | Query service tests              |
| `libs/backend/agent-sdk/src/lib/helpers/observation-hook-handler.ts`                                 | agent-sdk              | SDK hook handler                 |
| `libs/backend/agent-sdk/src/lib/helpers/observation-hook-handler.spec.ts`                            | agent-sdk              | Hook handler tests               |
| `libs/backend/agent-sdk/src/lib/helpers/memory-context-builder.ts`                                   | agent-sdk              | System prompt memory block       |
| `libs/backend/workspace-intelligence/src/graph/graph-file-watcher.service.ts`                        | workspace-intelligence | File watcher bridge              |
| `libs/backend/workspace-intelligence/src/graph/live-code-graph.service.ts`                           | workspace-intelligence | Graph lifecycle manager          |
| `libs/backend/workspace-intelligence/src/context-analysis/context-profile.service.ts`                | workspace-intelligence | Task-type profiles               |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/memory-namespace.builder.ts` | vscode-lm-tools        | MCP memory namespace             |

### MODIFY (12 files)

| File                                                                                         | Library                | Change                                                     |
| -------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`                    | workspace-intelligence | Add updateFile(), getGraph(), content hashing              |
| `libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts`  | workspace-intelligence | Add graph proximity + memory signal scoring                |
| `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts` | workspace-intelligence | Pass graph proximity set to scorer                         |
| `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`           | workspace-intelligence | Use LiveCodeGraphService instead of DependencyGraphService |
| `libs/backend/workspace-intelligence/src/di/register.ts`                                     | workspace-intelligence | Add Tier 6c/6d, ContextProfileService                      |
| `libs/backend/workspace-intelligence/src/index.ts`                                           | workspace-intelligence | Export new services                                        |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`                        | agent-sdk              | Add ObservationHookHandler + MemoryContextBuilder          |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                                                | agent-sdk              | Add 5 new tokens                                           |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                                              | agent-sdk              | Register 5 new services                                    |
| `libs/backend/agent-sdk/src/index.ts`                                                        | agent-sdk              | Export new services and types                              |
| `libs/backend/vscode-core/src/di/tokens.ts`                                                  | vscode-core            | Add 3 new tokens                                           |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`            | vscode-lm-tools        | Add memory namespace                                       |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in backend TypeScript libraries (Node.js runtime)
- No Angular/frontend components involved
- Heavy DI container work, file I/O, AST services
- Requires understanding of tsyringe DI patterns and SDK hook system

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 10-14 days across 5 phases

### Phase Dependencies

```
Phase 1 (Storage)     ──────────────────────────────────────┐
                                                             │
Phase 2 (Graph)       ──────────────────────────┐           │
                                                 │           │
                                                 ├──> Phase 4 (Curation) ──> Phase 5 (Integration)
                                                 │           │
Phase 3 (Memory)      ──────────────────────────┘           │
    depends on Phase 1 ─────────────────────────────────────┘
```

Phases 1 and 2 can run in parallel. Phase 3 depends on Phase 1. Phase 4 depends on Phases 2 and 3. Phase 5 depends on all.

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `gray-matter` from workspace-intelligence/package.json (verified)
   - `IFileSystemProvider` from `@ptah-extension/platform-core` (verified: file-system-provider.interface.ts:17)
   - `IWorkspaceProvider` from `@ptah-extension/platform-core` (verified: workspace-provider.interface.ts:9)
   - `PLATFORM_TOKENS` from `@ptah-extension/platform-core` (verified: tokens.ts:11)
   - `HookEvent`, `HookCallbackMatcher` from `claude-sdk.types.ts` (verified: sdk-query-options-builder.ts:36-40)

2. **All patterns verified from examples**:

   - File storage: AnalysisStorageService (verified: analysis-storage.service.ts:1-267)
   - Hook handlers: SubagentHookHandler, CompactionHookHandler (verified: sdk-query-options-builder.ts:727-743)
   - DI registration: workspace-intelligence/di/register.ts tiers (verified: lines 74-239)
   - Token convention: Symbol.for() pattern (verified: tokens.ts throughout)

3. **No hallucinated APIs**:

   - All DependencyGraphService methods verified: lines 101, 243, 272, 289, 314, 364
   - `setDependencyGraph()` on ContextSizeOptimizerService verified: line 175
   - `IFileSystemProvider.createFileWatcher()` verified: file-system-provider.interface.ts:104
   - `handleWatcherEvent` stub verified: file-system-manager.ts:546-555

4. **SessionStartHookHandler does NOT exist as a file** -- was deleted. Memory injection must go through a different mechanism (system prompt assembly in SdkQueryOptionsBuilder).
