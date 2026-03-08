# Implementation Plan - TASK_2025_183: Ptah Context Engine

## Codebase Investigation Summary

### Libraries Analyzed

- **workspace-intelligence** (`D:\projects\ptah-extension\libs\backend\workspace-intelligence`): 20+ services, tiered DI registration, context orchestration facade
- **agent-sdk** (`D:\projects\ptah-extension\libs\backend\agent-sdk`): SDK hook system, session management, DI tokens with `Symbol.for()` pattern
- **agent-generation** (`D:\projects\ptah-extension\libs\backend\agent-generation`): `AnalysisStorageService` -- the file-based storage pattern to follow
- **vscode-core** (`D:\projects\ptah-extension\libs\backend\vscode-core`): `FileSystemManager` with stub `handleWatcherEvent()`, DI TOKENS namespace
- **vscode-lm-tools** (`D:\projects\ptah-extension\libs\backend\vscode-lm-tools`): MCP namespace builder pattern

### Patterns Identified

1. **DI Registration**: Tiered singleton registration with dependency validation. Workspace-intelligence uses `registerWorkspaceIntelligenceServices()` with 8 tiers. Agent-sdk uses `registerSdkServices()` with explicit `Lifecycle.Singleton`.

   - Evidence: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts:74-239`
   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts:73-364`

2. **Token Convention**: `Symbol.for('DescriptiveName')` -- globally shared symbols, never plain strings.

   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts:1-109`
   - Evidence: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts:101-115` (CONTEXT_SIZE_OPTIMIZER, DEPENDENCY_GRAPH_SERVICE, etc.)

3. **File-Based Storage (AnalysisStorageService pattern)**: Manifest JSON + markdown files + `fs/promises` for all I/O. Directory structure under `.claude/`.

   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.ts:1-267`

4. **Hook Handler Pattern**: Injectable singleton, `createHooks()` returns `Partial<Record<HookEvent, HookCallbackMatcher[]>>`, always returns `{ continue: true }`, never throws.

   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-start-hook-handler.ts:66-209`

5. **Hook Merging**: `SdkQueryOptionsBuilder.createHooks()` merges hooks from multiple handlers by concatenating arrays per event key.

   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:660-709`

6. **System Prompt Injection**: `assembleSystemPromptAppend()` pure function concatenates prompt parts.

   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:156-201`

7. **File Watcher Stub**: `FileSystemManager.handleWatcherEvent()` accepts `(watcherId, eventType, uri)` but is a no-op stub.

   - Evidence: `D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\file-system-manager.ts:546-555`

8. **Graph Interface**: `ContextSizeOptimizerService` already declares `DependencyGraphInterface` and `setDependencyGraph()`.

   - Evidence: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-size-optimizer.service.ts:34-38, 175-177`

9. **MCP Namespace Builder**: Each namespace built by a dedicated builder function with typed dependencies.
   - Evidence: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\analysis-namespace.builders.ts:35-80`

### Integration Points Verified

- `ContextOrchestrationService` already injects `DependencyGraphService` via `TOKENS.DEPENDENCY_GRAPH_SERVICE` and calls `setDependencyGraph()` on the optimizer (line 229).
- `DependencyGraphService.invalidateFile()` exists and is fully implemented (lines 317-362).
- `buildGraph()` uses chunked parallel parsing with `AstAnalysisService.analyzeSource()` (lines 102-236).
- `SdkQueryOptionsBuilder` constructor injects `SubagentHookHandler`, `CompactionHookHandler`, `SessionStartHookHandler` via SDK_TOKENS.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Extension Activation                         │
│  apps/ptah-extension-vscode (consumption point)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │          PILLAR 1: Live Code Graph                           │   │
│  │  libs/backend/workspace-intelligence                         │   │
│  │                                                               │   │
│  │  LiveCodeGraphService (lifecycle: lazy init, rebuild, dispose)│   │
│  │       │                                                       │   │
│  │       ├── GraphFileWatcherService (file events -> graph)      │   │
│  │       │       │                                               │   │
│  │       │       └── FileSystemManager.createWatcher()           │   │
│  │       │                                                       │   │
│  │       ├── DependencyGraphService (EXISTING + updateFile())    │   │
│  │       │       ├── buildGraph()                                │   │
│  │       │       ├── invalidateFile() (EXISTING)                 │   │
│  │       │       └── updateFile() (NEW)                          │   │
│  │       │                                                       │   │
│  │       └── GraphCacheService (JSON persistence)                │   │
│  │               └── .claude/context/graph/graph-cache.json      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │          PILLAR 2: Session Memory                            │   │
│  │  libs/backend/agent-sdk                                      │   │
│  │                                                               │   │
│  │  SessionMemoryService (facade)                                │   │
│  │       │                                                       │   │
│  │       ├── ObservationExtractorService (tool -> observation)   │   │
│  │       │                                                       │   │
│  │       ├── MemoryStorageService (file I/O)                     │   │
│  │       │       ├── .claude/context/memory/sessions/*.md        │   │
│  │       │       ├── .claude/context/memory/summaries/*.md       │   │
│  │       │       └── .claude/context/memory/manifest.json        │   │
│  │       │                                                       │   │
│  │       ├── MemoryQueryService (search + retrieval)             │   │
│  │       │                                                       │   │
│  │       └── ObservationHookHandler (PostToolUse/SessionEnd)     │   │
│  │               └── Merged into SdkQueryOptionsBuilder.hooks    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │          PILLAR 3: Smart Context Curation                    │   │
│  │  libs/backend/workspace-intelligence                         │   │
│  │                                                               │   │
│  │  FileRelevanceScorerService (EXISTING + new signals)          │   │
│  │       ├── Keyword matching (EXISTING)                         │   │
│  │       ├── Symbol matching (EXISTING)                          │   │
│  │       ├── Graph proximity signal (NEW)                        │   │
│  │       └── Session memory signal (NEW)                         │   │
│  │                                                               │   │
│  │  ContextProfileService (NEW - task-type scoring weights)      │   │
│  │       ├── Bugfix profile                                      │   │
│  │       ├── Feature profile                                     │   │
│  │       └── Review profile                                      │   │
│  │                                                               │   │
│  │  ContextOrchestrationService (EXISTING + memory injection)    │   │
│  │       └── Injects memory context into system prompt           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │          MCP Integration                                     │   │
│  │  libs/backend/vscode-lm-tools                                │   │
│  │                                                               │   │
│  │  memory-namespace.builders.ts (NEW)                           │   │
│  │       ├── ptah.memory.search(query)                           │   │
│  │       ├── ptah.memory.getRecent(count)                        │   │
│  │       └── ptah.memory.getForFile(filePath)                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Type Definitions

All new types are defined in the files where they are used (colocated with their services), following the existing codebase pattern.

### Pillar 1: Graph Types

```typescript
// D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph.types.ts

/** Configuration for live code graph initialization */
export interface LiveGraphConfig {
  /** Workspace root path */
  workspaceRoot: string;
  /** File patterns to watch (default: **/*.{ts,tsx,js,jsx}) */
  watchPatterns?: string[];
  /** tsconfig paths for alias resolution */
  tsconfigPaths?: Record<string, string[]>;
  /** Debounce delay for file change events in ms (default: 300) */
  debounceMs?: number;
  /** Whether to persist graph to disk (default: true) */
  enablePersistence?: boolean;
}

/** Status of the live code graph */
export interface GraphStatus {
  /** Whether the graph has been built */
  isBuilt: boolean;
  /** Whether the graph is currently building */
  isBuilding: boolean;
  /** Number of file nodes in the graph */
  nodeCount: number;
  /** Number of edges (import relationships) */
  edgeCount: number;
  /** Timestamp of last build */
  lastBuiltAt: number | null;
  /** Number of incremental updates since last full build */
  incrementalUpdateCount: number;
}

/** Serializable graph cache for persistence */
export interface GraphCacheData {
  version: 1;
  builtAt: number;
  workspaceRoot: string;
  /** Serialized file nodes (path -> { relativePath, imports, exports, language }) */
  nodes: Array<{
    path: string;
    relativePath: string;
    language: string;
    importSources: string[];
    exportNames: string[];
  }>;
  /** Forward edges (path -> array of dependency paths) */
  edges: Array<[string, string[]]>;
}
```

### Pillar 2: Memory Types

```typescript
// D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\memory.types.ts

/** Types of observations extracted from SDK hooks */
export type ObservationType = 'file_read' | 'file_edit' | 'file_create' | 'search' | 'error' | 'decision' | 'command';

/** A single observation extracted from a tool use event */
export interface Observation {
  /** Unique identifier (timestamp-based) */
  id: string;
  /** Session that produced this observation */
  sessionId: string;
  /** Workspace path */
  workspacePath: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Observation type */
  type: ObservationType;
  /** File path involved (if applicable) */
  filePath?: string;
  /** Human-readable description */
  content: string;
  /** Importance score 0.0-1.0 */
  importance: number;
  /** Tool name that produced this observation */
  toolName?: string;
}

/** Session memory summary written at session end */
export interface SessionSummary {
  /** Session ID */
  sessionId: string;
  /** Workspace path */
  workspacePath: string;
  /** Summary creation timestamp */
  createdAt: number;
  /** Human-readable summary text */
  summary: string;
  /** Files touched during the session */
  filesTouched: string[];
  /** Key decisions or patterns observed */
  keyDecisions: string[];
  /** Total observation count */
  observationCount: number;
}

/** Memory manifest stored as JSON */
export interface MemoryManifest {
  version: 1;
  lastUpdated: number;
  /** Session IDs with observation files */
  sessions: Array<{
    sessionId: string;
    createdAt: number;
    observationCount: number;
    hasSummary: boolean;
  }>;
  /** Total observation count across all sessions */
  totalObservations: number;
}

/** Query options for searching memory */
export interface MemoryQueryOptions {
  /** Text search query */
  query?: string;
  /** Filter by file path (exact or prefix match) */
  filePath?: string;
  /** Filter by observation type */
  types?: ObservationType[];
  /** Maximum results to return */
  limit?: number;
  /** Filter by session ID */
  sessionId?: string;
  /** Only return observations newer than this timestamp */
  since?: number;
}

/** Result from a memory query */
export interface MemoryQueryResult {
  observations: Observation[];
  totalCount: number;
  sessionSummaries: SessionSummary[];
}

/** Signals extracted from memory for relevance scoring */
export interface MemorySignals {
  /** Files read in recent sessions (path -> read count) */
  recentlyReadFiles: Map<string, number>;
  /** Files edited in recent sessions (path -> edit count) */
  recentlyEditedFiles: Map<string, number>;
  /** Session count used to compute signals */
  sessionCount: number;
}
```

### Pillar 3: Context Profile Types

```typescript
// D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-profile.types.ts

/** Task type for context profile selection */
export type TaskType = 'bugfix' | 'feature' | 'review' | 'explore' | 'general';

/** Scoring weight multipliers for each signal */
export interface ContextProfileWeights {
  /** Weight for keyword matching (default: 1.0) */
  keywordMatch: number;
  /** Weight for symbol matching (default: 1.0) */
  symbolMatch: number;
  /** Weight for graph proximity (default: 1.0) */
  graphProximity: number;
  /** Weight for session memory recency (default: 1.0) */
  memoryRecency: number;
  /** Weight for file type relevance (default: 1.0) */
  fileType: number;
}

/** A context profile that adjusts scoring for a task type */
export interface ContextProfile {
  /** Task type identifier */
  taskType: TaskType;
  /** Human-readable description */
  description: string;
  /** Weight multipliers */
  weights: ContextProfileWeights;
  /** Keywords that trigger this profile */
  triggerKeywords: string[];
}
```

---

## Detailed Service Design

### Phase 1: Live Code Graph

#### 1.1 DependencyGraphService -- Add `updateFile()` Method

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.ts` (MODIFY)

**Change**: Add `updateFile()` public method and expose `getGraph()` accessor.

```typescript
/**
 * Incrementally update a single file in the graph.
 * Invalidates existing data, re-parses the file, and re-inserts edges.
 *
 * @param filePath - Absolute path to the changed file
 * @param workspaceRoot - Workspace root for relative path computation
 * @param tsconfigPaths - Optional tsconfig paths for alias resolution
 */
async updateFile(
  filePath: string,
  workspaceRoot: string,
  tsconfigPaths?: Record<string, string[]>
): Promise<void>

/**
 * Remove a file from the graph entirely (for deletions).
 * Delegates to invalidateFile().
 */
removeFile(filePath: string): void

/**
 * Get the current graph (or null if not built).
 */
getGraph(): DependencyGraph | null
```

**Implementation Notes**:

- `updateFile()`: calls `invalidateFile()` first, then reads + parses the file using `AstAnalysisService.analyzeSource()`, creates a new `FileNode`, adds it to `graph.nodes`, resolves imports using existing `resolveImportPath()`, builds forward edges and reverse edges. Finally invalidates `symbolIndex`.
- `removeFile()`: alias for `invalidateFile()` -- provides semantic clarity for delete events.
- `getGraph()`: returns `this.graph` -- needed by `LiveCodeGraphService` for cache persistence and status reporting.
- Uses existing `processFile` logic from `buildGraph()` (extract into private method to avoid duplication).
- Error handling: logs warning and returns silently if file cannot be read or parsed (file may be in transient state during saves).

**Evidence**: `invalidateFile()` already handles edge cleanup (lines 317-362). The `processFile` inline function in `buildGraph()` (lines 123-174) contains the parsing logic to reuse.

---

#### 1.2 GraphFileWatcherService -- File Watcher Bridge

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph-file-watcher.service.ts` (CREATE)

**Class**: `GraphFileWatcherService`
**Responsibility**: Creates file system watchers, debounces events, and routes them to `DependencyGraphService.updateFile()` / `removeFile()`.

**Constructor Dependencies**:

- `@inject(TOKENS.FILE_SYSTEM_MANAGER) fileSystemManager: FileSystemManager`
- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Start watching for file changes in the workspace.
 * Creates watchers for TS/JS files and routes events to the callback.
 *
 * @param workspaceRoot - Workspace root path
 * @param onFileChanged - Callback for file create/change events (receives absolute path)
 * @param onFileDeleted - Callback for file delete events (receives absolute path)
 * @param debounceMs - Debounce delay (default: 300)
 */
startWatching(
  workspaceRoot: string,
  onFileChanged: (filePath: string) => Promise<void>,
  onFileDeleted: (filePath: string) => void,
  debounceMs?: number
): void

/**
 * Stop watching and dispose all watchers.
 */
stopWatching(): void

/**
 * Whether watchers are currently active.
 */
isWatching(): boolean
```

**Internal Implementation Notes**:

- Creates watcher via `fileSystemManager.createWatcher({ id: 'context-engine-graph', pattern: '**/*.{ts,tsx,js,jsx}' })`.
- Uses a `Map<string, NodeJS.Timeout>` for per-file debouncing: on each event, clear existing timeout and set a new one at `debounceMs`.
- On `created`/`changed`: debounce then call `onFileChanged(uri.fsPath)`.
- On `deleted`: call `onFileDeleted(uri.fsPath)` immediately (no debounce needed).
- Filters out `node_modules`, `dist`, `.git` paths via simple string check before debouncing.
- `stopWatching()`: clears all pending timeouts, calls `fileSystemManager.disposeWatcher('context-engine-graph')`.

**Error Handling**: Wraps callbacks in try-catch, logs errors, never throws.

---

#### 1.3 GraphCacheService -- Graph Persistence

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph-cache.service.ts` (CREATE)

**Class**: `GraphCacheService`
**Responsibility**: Persists/loads graph data to/from `.claude/context/graph/graph-cache.json` following the `AnalysisStorageService` pattern.

**Constructor Dependencies**:

- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Save graph data to disk cache.
 */
async saveGraph(
  workspacePath: string,
  graph: DependencyGraph
): Promise<void>

/**
 * Load cached graph data from disk.
 * Returns null if cache doesn't exist or is invalid.
 */
async loadGraph(workspacePath: string): Promise<GraphCacheData | null>

/**
 * Delete the graph cache file.
 */
async clearCache(workspacePath: string): Promise<void>

/**
 * Get the cache directory path.
 */
getCacheDir(workspacePath: string): string
```

**Internal Implementation Notes**:

- Cache path: `join(workspacePath, '.claude', 'context', 'graph')`.
- Uses `mkdir(cacheDir, { recursive: true })` + `writeFile()` from `fs/promises`.
- Serializes `DependencyGraph` to `GraphCacheData` (converts Maps to arrays for JSON serialization).
- `loadGraph()`: reads JSON, validates `version === 1`, returns parsed data or null on any error.
- Wrap all I/O in try-catch, return null / log warning on failure.

---

#### 1.4 LiveCodeGraphService -- Lifecycle Manager

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\live-code-graph.service.ts` (CREATE)

**Class**: `LiveCodeGraphService`
**Responsibility**: Orchestrates graph lifecycle: lazy initialization, incremental updates, periodic rebuild, cache persistence, disposal.

**Constructor Dependencies**:

- `@inject(TOKENS.DEPENDENCY_GRAPH_SERVICE) dependencyGraph: DependencyGraphService`
- `@inject(TOKENS.WORKSPACE_INDEXER_SERVICE) workspaceIndexer: WorkspaceIndexerService`
- `graphFileWatcher: GraphFileWatcherService` (auto-wired via `@injectable()`)
- `graphCache: GraphCacheService` (auto-wired)
- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Ensure the graph is initialized. Lazy -- only builds on first call.
 * Returns immediately if graph is already built.
 *
 * @param workspacePath - Workspace root path
 * @param tsconfigPaths - Optional tsconfig paths
 */
async ensureInitialized(
  workspacePath: string,
  tsconfigPaths?: Record<string, string[]>
): Promise<void>

/**
 * Get current graph status.
 */
getStatus(): GraphStatus

/**
 * Force a full graph rebuild (replaces existing graph atomically).
 */
async rebuild(): Promise<void>

/**
 * Get the DependencyGraphService instance (for consumers).
 */
getGraphService(): DependencyGraphService

/**
 * Dispose all resources (watchers, timers).
 */
dispose(): void
```

**Internal Implementation Notes**:

- State: `isBuilding: boolean`, `incrementalUpdateCount: number`, `workspacePath: string | null`, `tsconfigPaths: Record<string, string[]> | undefined`.
- `ensureInitialized()`:
  1. If `dependencyGraph.isBuilt()`, return immediately.
  2. Try loading from cache via `graphCache.loadGraph()`. If valid and fresh (< 1 hour old), restore graph from cache data.
  3. Otherwise, get workspace files from `workspaceIndexer.indexWorkspace()`, call `dependencyGraph.buildGraph()`.
  4. Start file watchers via `graphFileWatcher.startWatching()` with callbacks:
     - `onFileChanged`: calls `dependencyGraph.updateFile()`, increments counter.
     - `onFileDeleted`: calls `dependencyGraph.removeFile()`.
  5. Save graph to cache via `graphCache.saveGraph()`.
  6. Log build time, warn if > 5 seconds.
- `rebuild()`: calls `graphFileWatcher.stopWatching()`, then full `buildGraph()`, then restart watchers.
- `dispose()`: stops watchers, clears timers, saves cache one final time.
- Performance guard: if `ensureInitialized()` is called while already building, queue and resolve when build completes (use a Promise-based mutex).

---

### Phase 2: Session Memory Storage

#### 2.1 MemoryStorageService -- File-Based Storage

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\memory-storage.service.ts` (CREATE)

**Class**: `MemoryStorageService`
**Responsibility**: Read/write observations and summaries as markdown files under `.claude/context/memory/`. Manages manifest.json for indexing.

**Constructor Dependencies**:

- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Initialize the memory directory structure.
 */
async initialize(workspacePath: string): Promise<void>

/**
 * Write an observation to the session's observation file.
 * Appends to existing file or creates new one.
 */
async writeObservation(
  workspacePath: string,
  observation: Observation
): Promise<void>

/**
 * Write a batch of observations (buffered writes).
 */
async writeObservations(
  workspacePath: string,
  observations: Observation[]
): Promise<void>

/**
 * Write a session summary.
 */
async writeSessionSummary(
  workspacePath: string,
  summary: SessionSummary
): Promise<void>

/**
 * Read all observations for a session.
 */
async readSessionObservations(
  workspacePath: string,
  sessionId: string
): Promise<Observation[]>

/**
 * Read all session summaries.
 */
async readAllSummaries(
  workspacePath: string
): Promise<SessionSummary[]>

/**
 * Read the memory manifest.
 */
async readManifest(
  workspacePath: string
): Promise<MemoryManifest | null>

/**
 * Update the memory manifest.
 */
async updateManifest(
  workspacePath: string,
  manifest: MemoryManifest
): Promise<void>

/**
 * Prune observations older than the specified age.
 */
async pruneOldSessions(
  workspacePath: string,
  maxAgeMs: number
): Promise<number>

/**
 * Get memory directory path.
 */
getMemoryDir(workspacePath: string): string
```

**Internal Implementation Notes**:

- Directory structure:
  ```
  .claude/context/memory/
    manifest.json           # Index of all sessions
    sessions/
      {sessionId}.md        # Observations as markdown with frontmatter
    summaries/
      {sessionId}.md        # Session summary with frontmatter
  ```
- Observation markdown format (per session file):

  ```markdown
  ---
  sessionId: 'abc-123'
  createdAt: 1710000000000
  observationCount: 5
  ---

  ## Observations

  ### [2026-03-08 14:30:22] file_read

  - **File**: src/services/auth.service.ts
  - **Tool**: Read
  - **Importance**: 0.7
  - Read authentication service for session validation logic

  ### [2026-03-08 14:30:45] file_edit

  - **File**: src/services/auth.service.ts
  - **Tool**: Edit
  - **Importance**: 0.9
  - Modified session validation to support refresh tokens
  ```

- Summary markdown format:

  ```markdown
  ---
  sessionId: 'abc-123'
  createdAt: 1710000000000
  observationCount: 15
  filesTouched:
    - src/services/auth.service.ts
    - src/guards/auth.guard.ts
  ---

  ## Session Summary

  Added refresh token support to the authentication service.
  Modified auth guard to check token expiry.

  ## Key Decisions

  - Used JWT for refresh tokens instead of opaque tokens
  - Added 7-day expiry for refresh tokens
  ```

- Uses `gray-matter` (already a dependency) for frontmatter parsing when reading.
- Uses `fs/promises` (`mkdir`, `readFile`, `writeFile`, `readdir`, `stat`, `rm`) for all I/O.
- Manifest update is atomic: write to temp file then rename (prevents corruption on crash).
- `pruneOldSessions()`: removes session files older than `maxAgeMs`, updates manifest.

---

#### 2.2 ObservationExtractorService -- Tool Event Parser

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\observation-extractor.service.ts` (CREATE)

**Class**: `ObservationExtractorService`
**Responsibility**: Extracts structured `Observation` objects from SDK `PostToolUse` hook inputs.

**Constructor Dependencies**:

- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Extract an observation from a PostToolUse hook input.
 * Returns null if the tool use is not observation-worthy.
 */
extractFromToolUse(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: unknown,
  sessionId: string,
  workspacePath: string
): Observation | null

/**
 * Generate a session summary from a list of observations.
 */
generateSummary(
  observations: Observation[],
  sessionId: string,
  workspacePath: string
): SessionSummary
```

**Internal Implementation Notes**:

- Tool name mapping:
  - `Read` / `read` -> `file_read` (extract `file_path` from input)
  - `Edit` / `edit` / `Write` / `write` -> `file_edit` (extract `file_path` from input)
  - `MultiEdit` / `multi_edit` -> `file_edit` (extract `file_path` from input)
  - `Bash` / `bash` -> `command` (extract `command` from input, importance 0.5)
  - Tool names containing `search` or `grep` -> `search` (extract query, importance 0.4)
  - Tool result with error -> `error` (importance 0.8)
- Importance scoring:
  - `file_edit`: 0.9 (high -- modifications are important)
  - `file_read`: 0.6 (medium -- reads provide context)
  - `file_create`: 0.9 (high -- new files are important)
  - `error`: 0.8 (high -- errors should be remembered)
  - `search`: 0.4 (low -- searches are routine)
  - `command`: 0.5 (medium -- commands may be significant)
- `generateSummary()`: collects unique file paths, generates a bullet-point summary of what happened (file reads, edits, key patterns). No LLM call -- purely mechanical aggregation.
- Returns `null` for tools that are not observation-worthy (e.g., `LS`, `ListFiles` -- too noisy).
- Content string is a human-readable one-liner describing the observation.

---

#### 2.3 MemoryQueryService -- Search and Retrieval

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\memory-query.service.ts` (CREATE)

**Class**: `MemoryQueryService`
**Responsibility**: Query observations and summaries from memory storage. Provides search by text, file path, type, and recency.

**Constructor Dependencies**:

- `memoryStorage: MemoryStorageService` (auto-wired)
- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Search memory for relevant observations.
 */
async search(
  workspacePath: string,
  options: MemoryQueryOptions
): Promise<MemoryQueryResult>

/**
 * Get most recent observations across all sessions.
 */
async getRecent(
  workspacePath: string,
  limit?: number
): Promise<Observation[]>

/**
 * Get observations for a specific file.
 */
async getForFile(
  workspacePath: string,
  filePath: string
): Promise<Observation[]>

/**
 * Get memory signals for relevance scoring.
 * Returns file read/edit counts from recent sessions.
 */
async getMemorySignals(
  workspacePath: string,
  maxSessions?: number
): Promise<MemorySignals>

/**
 * Format memory context for system prompt injection.
 * Returns a markdown string summarizing relevant memory.
 */
async formatForPrompt(
  workspacePath: string,
  query?: string,
  maxTokens?: number
): Promise<string | undefined>
```

**Internal Implementation Notes**:

- `search()`: reads manifest to find relevant session files, then reads each session's observations, applies filters (query text match via `content.toLowerCase().includes()`, file path prefix match, type filter, since filter). Sorts by timestamp descending.
- `getMemorySignals()`: reads last N session files, counts file read/edit occurrences, returns as `Map<string, number>`. This is the primary input for Pillar 3 relevance scoring.
- `formatForPrompt()`: queries recent observations + summaries, formats as concise markdown suitable for system prompt injection. Truncates to `maxTokens` (default: 2000 tokens, ~8000 chars).
- Performance: reads are sequential (file-based), but observation volumes are small (100s not millions). Acceptable for workspace-scale use.

---

#### 2.4 ObservationHookHandler -- SDK Hook Integration

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\observation-hook-handler.ts` (CREATE)

**Class**: `ObservationHookHandler`
**Responsibility**: Creates SDK hooks for `PostToolUse` and `SessionEnd` events to capture observations.

**Constructor Dependencies**:

- `observationExtractor: ObservationExtractorService` (auto-wired)
- `memoryStorage: MemoryStorageService` (auto-wired)
- `memoryQuery: MemoryQueryService` (auto-wired)
- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Create hooks for SDK query options.
 * Returns hooks for PostToolUse (observation capture) and Stop (session summary).
 */
createHooks(
  sessionId: string,
  workspacePath: string
): Partial<Record<HookEvent, HookCallbackMatcher[]>>

/**
 * Dispose and flush any buffered observations.
 */
dispose(): void
```

**Internal Implementation Notes**:

- Follows `SessionStartHookHandler` pattern exactly:
  - Hook callback is `async (input, toolUseId, options) => Promise<HookJSONOutput>`.
  - Always returns `{ continue: true }`.
  - Wrapped in try-catch, never throws.
  - Fire-and-forget for observation writes.
- **PostToolUse hook**:
  1. Extract tool name and input from `input` (type guard: `isPostToolUseHook(input)`).
  2. Call `observationExtractor.extractFromToolUse()`.
  3. If observation is returned, buffer it (in-memory array).
  4. Flush buffer to disk every 10 observations or every 30 seconds (whichever comes first).
  5. Buffering prevents I/O on every single tool use.
- **Stop hook** (SessionEnd):
  1. Flush any remaining buffered observations.
  2. Call `observationExtractor.generateSummary()` with all session observations.
  3. Write summary via `memoryStorage.writeSessionSummary()`.
  4. Update manifest.
- Buffer: `private observationBuffer: Observation[] = []`, flushed via `flushBuffer()`.
- Timer: `private flushTimer: NodeJS.Timeout | null`, set to 30s interval.

---

#### 2.5 SessionMemoryService -- Facade

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\session-memory.service.ts` (CREATE)

**Class**: `SessionMemoryService`
**Responsibility**: Public facade for session memory. Coordinates storage, query, and hook handler. This is the service injected by consumers.

**Constructor Dependencies**:

- `memoryStorage: MemoryStorageService` (auto-wired)
- `memoryQuery: MemoryQueryService` (auto-wired)
- `observationHookHandler: ObservationHookHandler` (auto-wired)
- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Initialize memory storage for a workspace.
 */
async initialize(workspacePath: string): Promise<void>

/**
 * Create SDK hooks for observation capture.
 */
createHooks(
  sessionId: string,
  workspacePath: string
): Partial<Record<HookEvent, HookCallbackMatcher[]>>

/**
 * Search memory.
 */
async search(
  workspacePath: string,
  options: MemoryQueryOptions
): Promise<MemoryQueryResult>

/**
 * Get memory signals for relevance scoring.
 */
async getMemorySignals(
  workspacePath: string
): Promise<MemorySignals>

/**
 * Format memory for system prompt injection.
 */
async formatForPrompt(
  workspacePath: string,
  query?: string
): Promise<string | undefined>

/**
 * Get recent observations.
 */
async getRecent(
  workspacePath: string,
  limit?: number
): Promise<Observation[]>

/**
 * Get observations for a file.
 */
async getForFile(
  workspacePath: string,
  filePath: string
): Promise<Observation[]>

/**
 * Prune old sessions.
 */
async prune(
  workspacePath: string,
  maxAgeDays?: number
): Promise<number>

/**
 * Dispose resources.
 */
dispose(): void
```

---

### Phase 3: Observation Hooks Wiring

#### 3.1 SdkQueryOptionsBuilder -- Hook Integration

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` (MODIFY)

**Changes**:

1. Add `SessionMemoryService` as an optional constructor dependency (injected via new SDK_TOKEN).
2. In `createHooks()`, add memory hooks to the merge list.
3. In `buildSystemPrompt()` / `assembleSystemPromptAppend()`, add memory context as an additional prompt part.

**Specific Changes**:

Constructor: Add `@inject(SDK_TOKENS.SDK_SESSION_MEMORY_SERVICE) private readonly sessionMemory: SessionMemoryService | null` (use optional injection pattern -- resolve to null if not registered).

`createHooks()` method (line 660): Add to the hooks merge list:

```typescript
// Create memory observation hooks (TASK_2025_183)
const memoryHooks = this.sessionMemory?.createHooks(sessionId ?? '', cwd) ?? {};

// Merge hooks -- concatenate arrays per event key
for (const hooks of [subagentHooks, compactionHooks, sessionStartHooks, memoryHooks]) {
  // ... existing merge logic
}
```

`buildSystemPrompt()` / `assembleSystemPromptAppend()`: Add a new parameter for memory context:

```typescript
// In assembleSystemPromptAppend, add:
// 5. Session memory context (TASK_2025_183)
if (input.memoryContext) {
  appendParts.push(input.memoryContext);
}
```

**Evidence**: Hook merging pattern at line 683-688.

---

#### 3.2 QueryOptionsInput Update

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` (MODIFY)

Add to `QueryOptionsInput` interface:

```typescript
/**
 * Session memory context for prompt injection (TASK_2025_183)
 * Formatted string from SessionMemoryService.formatForPrompt()
 */
memoryContext?: string;
```

Add to `AssembleSystemPromptInput` interface:

```typescript
/** Session memory context (TASK_2025_183) */
memoryContext?: string;
```

---

### Phase 4: Smart Context Curation

#### 4.1 FileRelevanceScorerService -- Enhanced Scoring

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\file-relevance-scorer.service.ts` (MODIFY)

**Changes**: Add two new scoring signals to `scoreFile()`:

1. **Graph proximity signal**: Files that are direct dependencies of the active file get a relevance boost.
2. **Session memory signal**: Files recently read/edited in past sessions get a recency boost.

New parameters added to `scoreFile()` and `rankFiles()`:

```typescript
scoreFile(
  file: IndexedFile,
  query?: string,
  symbolIndex?: SymbolIndex,
  activeFileImports?: ImportInfo[],
  // NEW parameters (TASK_2025_183):
  graphDependencies?: Set<string>,   // Set of file paths that are dependencies of the active file
  memorySignals?: MemorySignals       // Recent file read/edit counts from session memory
): FileRelevanceResult
```

New private scoring methods:

```typescript
/**
 * Score based on graph proximity.
 * Files that are dependencies of the active file get a boost.
 * +12 if file is a direct dependency, +6 if file is a dependent.
 */
private scoreByGraphProximity(
  file: IndexedFile,
  reasons: string[],
  graphDependencies?: Set<string>
): number

/**
 * Score based on session memory signals.
 * Recently edited files get +10, recently read files get +5.
 * Capped at +15 total.
 */
private scoreByMemory(
  file: IndexedFile,
  reasons: string[],
  memorySignals?: MemorySignals
): number
```

**Implementation Notes**:

- `scoreByGraphProximity()`: checks if `file.path` is in `graphDependencies` set. O(1) lookup.
- `scoreByMemory()`: checks if file path is in `memorySignals.recentlyEditedFiles` or `recentlyReadFiles`. Edit boost (+10) is higher than read boost (+5) because edits indicate more important files.
- Both methods return 0 when their input is undefined (zero overhead when signals not available).
- Cap total memory score at 15 to prevent memory signals from dominating.

---

#### 4.2 ContextProfileService -- Task-Type Profiles

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-profile.service.ts` (CREATE)

**Class**: `ContextProfileService`
**Responsibility**: Detects task type from user query and provides scoring weight profiles.

**Constructor Dependencies**:

- `@inject(TOKENS.LOGGER) logger: Logger`

**Public API**:

```typescript
/**
 * Detect the task type from a user query.
 */
detectTaskType(query: string): TaskType

/**
 * Get the context profile for a task type.
 */
getProfile(taskType: TaskType): ContextProfile

/**
 * Get all available profiles.
 */
getAllProfiles(): ContextProfile[]
```

**Internal Implementation Notes**:

- Built-in profiles:
  - **bugfix**: `{ keywordMatch: 1.0, symbolMatch: 1.2, graphProximity: 1.5, memoryRecency: 1.3, fileType: 1.0 }` -- favors graph proximity (related files) and recent memory (files involved in the bug area). Trigger keywords: `fix`, `bug`, `error`, `issue`, `broken`, `crash`, `fail`.
  - **feature**: `{ keywordMatch: 1.2, symbolMatch: 1.0, graphProximity: 1.0, memoryRecency: 0.8, fileType: 1.0 }` -- favors keyword matching for new feature exploration. Trigger keywords: `implement`, `add`, `create`, `feature`, `build`, `new`.
  - **review**: `{ keywordMatch: 0.8, symbolMatch: 0.8, graphProximity: 1.2, memoryRecency: 1.5, fileType: 0.8 }` -- heavily favors recent memory (what was changed). Trigger keywords: `review`, `check`, `audit`, `inspect`, `verify`.
  - **explore**: `{ keywordMatch: 1.5, symbolMatch: 1.0, graphProximity: 0.8, memoryRecency: 0.5, fileType: 1.0 }` -- favors keyword matching for exploration. Trigger keywords: `explain`, `how`, `what`, `where`, `find`, `show`, `explore`.
  - **general**: `{ keywordMatch: 1.0, symbolMatch: 1.0, graphProximity: 1.0, memoryRecency: 1.0, fileType: 1.0 }` -- no bias (default).
- `detectTaskType()`: scans query for trigger keywords. First match wins. Default: `general`.
- Profiles are statically defined (no file I/O). Simple and predictable.

---

#### 4.3 ContextSizeOptimizerService -- Profile Integration

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-size-optimizer.service.ts` (MODIFY)

**Changes**:

1. Add optional `ContextProfileService` reference (same pattern as `setDependencyGraph()`).
2. Add optional `MemorySignals` parameter to optimization methods.
3. Apply profile weights when scoring files.

```typescript
// New optional fields
private contextProfile: ContextProfileService | null = null;

setContextProfile(profile: ContextProfileService | null): void

// Modified optimizeContext signature -- add optional MemorySignals
async optimizeContext(
  request: ContextOptimizationRequest & {
    memorySignals?: MemorySignals;
    graphDependencies?: Set<string>;
  }
): Promise<OptimizedContext>
```

---

### Phase 5: Integration and MCP

#### 5.1 Memory MCP Namespace

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\memory-namespace.builders.ts` (CREATE)

**Responsibility**: Builds the `ptah.memory` MCP namespace for AI agents to query session memory.

```typescript
export interface MemoryNamespaceDependencies {
  sessionMemory: SessionMemoryService;
}

export interface MemoryNamespace {
  search(query: string, options?: { limit?: number; types?: string[] }): Promise<MemoryQueryResult>;
  getRecent(limit?: number): Promise<Observation[]>;
  getForFile(filePath: string): Promise<Observation[]>;
}

export function buildMemoryNamespace(deps: MemoryNamespaceDependencies, workspacePath: string): MemoryNamespace;
```

---

#### 5.2 PtahAPIBuilder -- Add Memory Namespace

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (MODIFY)

Add `memory` namespace to the Ptah API builder. Add `SessionMemoryService` to the builder's dependencies.

---

#### 5.3 System Prompt Update

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts` (MODIFY)

Add documentation for the `ptah.memory` namespace to `PTAH_SYSTEM_PROMPT`.

---

## DI Registration Plan

### New Tokens

#### workspace-intelligence Tokens (in `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`)

```typescript
export const LIVE_CODE_GRAPH_SERVICE = Symbol.for('LiveCodeGraphService');
export const GRAPH_FILE_WATCHER_SERVICE = Symbol.for('GraphFileWatcherService');
export const GRAPH_CACHE_SERVICE = Symbol.for('GraphCacheService');
export const CONTEXT_PROFILE_SERVICE = Symbol.for('ContextProfileService');
```

Add to TOKENS export object.

#### agent-sdk Tokens (in `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`)

```typescript
export const SDK_TOKENS = {
  // ... existing tokens

  // Session Memory (TASK_2025_183)
  SDK_SESSION_MEMORY_SERVICE: Symbol.for('SdkSessionMemoryService'),
  SDK_MEMORY_STORAGE_SERVICE: Symbol.for('SdkMemoryStorageService'),
  SDK_OBSERVATION_EXTRACTOR: Symbol.for('SdkObservationExtractor'),
  SDK_MEMORY_QUERY_SERVICE: Symbol.for('SdkMemoryQueryService'),
  SDK_OBSERVATION_HOOK_HANDLER: Symbol.for('SdkObservationHookHandler'),
} as const;
```

### Registration Order

#### workspace-intelligence (`D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`)

Add after existing Tier 6 (AST Analysis Services):

```
Tier 6c: Graph Services (TASK_2025_183)
  - GRAPH_CACHE_SERVICE (GraphCacheService) -- no deps beyond Logger
  - GRAPH_FILE_WATCHER_SERVICE (GraphFileWatcherService) -- depends on FILE_SYSTEM_MANAGER
  - LIVE_CODE_GRAPH_SERVICE (LiveCodeGraphService) -- depends on DEPENDENCY_GRAPH_SERVICE, WORKSPACE_INDEXER_SERVICE, GraphFileWatcher, GraphCache

Tier 5b: Context Profile (TASK_2025_183)
  - CONTEXT_PROFILE_SERVICE (ContextProfileService) -- depends on Logger only
```

Note: `ContextProfileService` can go in Tier 5 area since it has no dependencies. `LiveCodeGraphService` goes after Tier 6 because it depends on `DependencyGraphService`.

#### agent-sdk (`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`)

Add new section before "Main Adapter":

```
// ============================================================
// Session Memory Services (TASK_2025_183)
// ============================================================
container.register(SDK_TOKENS.SDK_MEMORY_STORAGE_SERVICE, { useClass: MemoryStorageService }, { lifecycle: Lifecycle.Singleton });
container.register(SDK_TOKENS.SDK_OBSERVATION_EXTRACTOR, { useClass: ObservationExtractorService }, { lifecycle: Lifecycle.Singleton });
container.register(SDK_TOKENS.SDK_MEMORY_QUERY_SERVICE, { useClass: MemoryQueryService }, { lifecycle: Lifecycle.Singleton });
container.register(SDK_TOKENS.SDK_OBSERVATION_HOOK_HANDLER, { useClass: ObservationHookHandler }, { lifecycle: Lifecycle.Singleton });
container.register(SDK_TOKENS.SDK_SESSION_MEMORY_SERVICE, { useClass: SessionMemoryService }, { lifecycle: Lifecycle.Singleton });
```

---

## File-by-File Change List

### Files to CREATE

| #   | File Path                                                                                                                        | Service/Module                | Lines (est) |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------- |
| 1   | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph.types.ts`                                        | Graph type definitions        | ~60         |
| 2   | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph-cache.service.ts`                                | GraphCacheService             | ~120        |
| 3   | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph-file-watcher.service.ts`                         | GraphFileWatcherService       | ~130        |
| 4   | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\live-code-graph.service.ts`                            | LiveCodeGraphService          | ~200        |
| 5   | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\index.ts`                                              | Barrel exports                | ~10         |
| 6   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\memory.types.ts`                                               | Memory type definitions       | ~120        |
| 7   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\memory-storage.service.ts`                                     | MemoryStorageService          | ~250        |
| 8   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\observation-extractor.service.ts`                              | ObservationExtractorService   | ~150        |
| 9   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\memory-query.service.ts`                                       | MemoryQueryService            | ~200        |
| 10  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\observation-hook-handler.ts`                                   | ObservationHookHandler        | ~180        |
| 11  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\session-memory.service.ts`                                     | SessionMemoryService (facade) | ~150        |
| 12  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\memory\index.ts`                                                      | Barrel exports                | ~15         |
| 13  | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-profile.types.ts`                   | Profile type definitions      | ~40         |
| 14  | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-profile.service.ts`                 | ContextProfileService         | ~120        |
| 15  | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\memory-namespace.builders.ts` | Memory MCP namespace          | ~80         |

### Files to MODIFY

| #   | File Path                                                                                                               | Change Description                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 16  | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.ts`                    | Add `updateFile()`, `removeFile()`, `getGraph()` methods                                                            |
| 17  | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\file-relevance-scorer.service.ts`  | Add `graphDependencies` and `memorySignals` parameters, add `scoreByGraphProximity()` and `scoreByMemory()` methods |
| 18  | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-size-optimizer.service.ts` | Add `setContextProfile()`, pass new scoring signals through                                                         |
| 19  | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`                                     | Register GraphCacheService, GraphFileWatcherService, LiveCodeGraphService, ContextProfileService                    |
| 20  | `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts`                                           | Export new graph and profile services/types                                                                         |
| 21  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`                                                | Add 5 new SDK_TOKENS for memory services                                                                            |
| 22  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`                                              | Register 5 memory services                                                                                          |
| 23  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`                        | Add memory hooks to `createHooks()`, add memory context to `assembleSystemPromptAppend()`                           |
| 24  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts`                                            | Export memory module                                                                                                |
| 25  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`                                                        | Export SessionMemoryService and memory types                                                                        |
| 26  | `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`                                                  | Add 4 new TOKENS for graph/profile services                                                                         |
| 27  | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`            | Add `memory` namespace                                                                                              |
| 28  | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts`         | Add `ptah.memory` documentation                                                                                     |
| 29  | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`                               | Add MemoryNamespace type                                                                                            |
| 30  | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`                  | Pass memory context to SDK query options                                                                            |

---

## Phase-by-Phase Delivery Plan

### Phase 1: Live Code Graph (Days 1-3)

**Deliverables**:

1. `DependencyGraphService.updateFile()` and `removeFile()` methods
2. `GraphCacheService` -- JSON persistence of graph to `.claude/context/graph/`
3. `GraphFileWatcherService` -- debounced file watcher bridge
4. `LiveCodeGraphService` -- lifecycle manager with lazy init
5. DI registration (4 new tokens in vscode-core, 3 new services in workspace-intelligence)
6. Public exports from workspace-intelligence

**Verification**: Build the graph, modify a file, verify graph updates incrementally. Verify graph persists to disk and reloads on restart.

### Phase 2: Session Memory Storage (Days 3-5)

**Deliverables**:

1. Memory type definitions (`memory.types.ts`)
2. `MemoryStorageService` -- file-based storage following AnalysisStorageService pattern
3. `ObservationExtractorService` -- tool event parser
4. `MemoryQueryService` -- search and retrieval
5. DI registration (5 new tokens in agent-sdk tokens, 3 new services)
6. Public exports from agent-sdk

**Verification**: Write observations to disk, read them back, search by query/file/type. Verify markdown format is human-readable and parseable.

### Phase 3: Observation Hooks (Days 5-7)

**Deliverables**:

1. `ObservationHookHandler` -- PostToolUse + Stop hooks
2. `SessionMemoryService` -- facade coordinating all memory services
3. Hook integration in `SdkQueryOptionsBuilder.createHooks()` -- merge memory hooks
4. System prompt injection via `assembleSystemPromptAppend()` -- add memory context
5. DI registration (2 more services in agent-sdk)

**Verification**: Start a session, use Read/Edit tools, verify observations captured in `.claude/context/memory/sessions/`. End session, verify summary written. Start new session, verify memory context appears in system prompt.

### Phase 4: Smart Context Curation (Days 7-9)

**Deliverables**:

1. `ContextProfileService` -- task-type detection and weight profiles
2. `FileRelevanceScorerService` enhancement -- graph proximity + memory signals
3. `ContextSizeOptimizerService` enhancement -- profile integration
4. DI registration (1 new token + service)
5. Wire memory signals through context pipeline

**Verification**: Query with "fix bug in auth" -- verify bugfix profile activates, graph-proximate files rank higher. Query with "implement feature" -- verify feature profile. Verify files from recent sessions get memory boost.

### Phase 5: MCP Integration and Polish (Days 9-11)

**Deliverables**:

1. `memory-namespace.builders.ts` -- `ptah.memory` MCP namespace
2. `PtahAPIBuilder` update -- add memory namespace
3. System prompt update -- document `ptah.memory` API
4. Chat RPC handlers update -- pass memory context to query options
5. End-to-end integration testing

**Verification**: Use MCP `execute_code` to call `ptah.memory.search('auth')`, verify results. Test full flow: edit file -> graph updates -> new session -> memory signals boost related files.

---

## Testing Strategy

### Unit Tests

| Service                                 | Key Test Scenarios                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DependencyGraphService.updateFile()`   | Invalidate + re-parse produces correct edges; handles missing file gracefully; handles parse error gracefully        |
| `GraphFileWatcherService`               | Debounces rapid changes; filters node_modules; calls correct callback per event type                                 |
| `GraphCacheService`                     | Saves/loads round-trip; returns null for missing cache; returns null for invalid JSON                                |
| `LiveCodeGraphService`                  | Lazy init (no build until first call); rebuilds atomically; disposes cleanly                                         |
| `MemoryStorageService`                  | Writes/reads observations; creates directory structure; prunes old sessions; handles concurrent writes               |
| `ObservationExtractorService`           | Maps each tool name to correct type; extracts file paths; assigns importance; returns null for non-observation tools |
| `MemoryQueryService`                    | Text search matches; file path filter works; recency sort; memory signals computed correctly                         |
| `ObservationHookHandler`                | Buffers observations; flushes on threshold; flushes on dispose; writes summary on Stop; never throws                 |
| `ContextProfileService`                 | Detects bugfix from "fix" keyword; detects feature from "implement"; defaults to general                             |
| `FileRelevanceScorerService` (enhanced) | Graph proximity boosts score; memory signals boost score; scores unchanged when signals absent                       |

### Integration Tests

1. **Graph lifecycle**: Build graph -> modify file -> verify updateFile() -> verify edges updated -> restart -> verify cache loads.
2. **Memory pipeline**: Send PostToolUse hook -> verify observation buffered -> flush -> verify file written -> query -> verify results.
3. **Context curation**: Build graph + write observations -> optimize context -> verify files ranked with all signals.
4. **MCP namespace**: Call `ptah.memory.search()` -> verify results match stored observations.

---

## Risk Mitigations

### Risk 1: File Watcher Event Storm

**Probability**: Medium (large refactoring operations can produce 100+ file events simultaneously)

**Mitigation**:

- Per-file debouncing (300ms default) in `GraphFileWatcherService` prevents redundant updates.
- Filter out `node_modules`, `dist`, `.git` immediately (no debounce overhead for these paths).
- `LiveCodeGraphService` tracks `isBuilding` state to prevent concurrent builds.
- Worst case: events are debounced, graph may be momentarily stale during bulk operations. This is acceptable -- the graph catches up within 300ms of the last change.

### Risk 2: Memory Storage Growth

**Probability**: Low (workspace-scoped, not user-global)

**Mitigation**:

- Observations are stored per-session in individual markdown files (not a single growing file).
- `SessionMemoryService.prune()` removes sessions older than 30 days (configurable).
- Manifest tracks session count -- can warn if approaching limits.
- Observation extraction is selective (only file reads/edits/errors, not every tool use).
- Expected volume: ~50-200 observations per session, ~10 sessions per workspace = ~2000 observations total at any time. File size: ~200KB total. Negligible.

### Risk 3: Hook Latency Impacting SDK Responsiveness

**Probability**: Low (hooks are fire-and-forget)

**Mitigation**:

- `ObservationHookHandler` buffers observations in memory, writes to disk asynchronously.
- Buffer flush is batched (every 10 observations or 30 seconds).
- Hook callback always returns `{ continue: true }` immediately -- the buffer/flush happens in a `void` promise.
- Observation extraction is pure computation (no I/O), completes in < 1ms.

### Risk 4: Graph Cache Corruption

**Probability**: Low (extension crash during write)

**Mitigation**:

- Graph cache is a performance optimization, not a source of truth. If cache is corrupt, it is silently discarded and a full rebuild is triggered.
- `GraphCacheService.loadGraph()` validates `version` field and returns null on any parse error.
- Atomic write via temp file + rename for manifest (MemoryStorageService).
- Graph cache loss costs ~2s rebuild for 280 files -- acceptable recovery time.

### Risk 5: Circular Import Between workspace-intelligence and agent-sdk

**Probability**: None (by design)

**Mitigation**:

- `FileRelevanceScorerService` accepts `MemorySignals` as a plain data interface (no import from agent-sdk).
- `MemorySignals` type is defined in agent-sdk but passed as data through the context pipeline.
- The interface boundary is at `ContextSizeOptimizerService` which accepts `MemorySignals` as an optional parameter on its method -- no constructor dependency on agent-sdk.
- If needed, `MemorySignals` can be duplicated as a simple interface in workspace-intelligence (it's just two Maps and a number).

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in backend TypeScript libraries (no UI/frontend components)
- Requires understanding of DI patterns, SDK hooks, file I/O, AST parsing
- No Angular/HTML/CSS work involved
- NestJS-style service architecture throughout

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 8-11 working days across 5 phases

**Breakdown**:

- Phase 1 (Live Code Graph): 3 days -- 4 new files + 2 modified files
- Phase 2 (Session Memory Storage): 2 days -- 5 new files
- Phase 3 (Observation Hooks): 2 days -- 2 new files + 3 modified files
- Phase 4 (Smart Context Curation): 2 days -- 2 new files + 2 modified files
- Phase 5 (MCP + Integration): 2 days -- 1 new file + 4 modified files

### Files Affected Summary

**CREATE** (15 files):

- `libs/backend/workspace-intelligence/src/graph/graph.types.ts`
- `libs/backend/workspace-intelligence/src/graph/graph-cache.service.ts`
- `libs/backend/workspace-intelligence/src/graph/graph-file-watcher.service.ts`
- `libs/backend/workspace-intelligence/src/graph/live-code-graph.service.ts`
- `libs/backend/workspace-intelligence/src/graph/index.ts`
- `libs/backend/workspace-intelligence/src/context-analysis/context-profile.types.ts`
- `libs/backend/workspace-intelligence/src/context-analysis/context-profile.service.ts`
- `libs/backend/agent-sdk/src/lib/memory/memory.types.ts`
- `libs/backend/agent-sdk/src/lib/memory/memory-storage.service.ts`
- `libs/backend/agent-sdk/src/lib/memory/observation-extractor.service.ts`
- `libs/backend/agent-sdk/src/lib/memory/memory-query.service.ts`
- `libs/backend/agent-sdk/src/lib/memory/observation-hook-handler.ts`
- `libs/backend/agent-sdk/src/lib/memory/session-memory.service.ts`
- `libs/backend/agent-sdk/src/lib/memory/index.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/memory-namespace.builders.ts`

**MODIFY** (15 files):

- `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`
- `libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts`
- `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts`
- `libs/backend/workspace-intelligence/src/di/register.ts`
- `libs/backend/workspace-intelligence/src/index.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/index.ts`
- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/vscode-core/src/di/tokens.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `FileSystemManager` from `@ptah-extension/vscode-core` (verified: `D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\file-system-manager.ts`)
   - `DependencyGraphService` from `@ptah-extension/workspace-intelligence` (verified: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.ts`)
   - `AstAnalysisService` from workspace-intelligence (verified: imported in dependency-graph.service.ts:13)
   - `WorkspaceIndexerService` from workspace-intelligence (verified: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-indexer.service.ts`)
   - `gray-matter` package (verified: listed as dependency in workspace-intelligence CLAUDE.md)
   - `fs/promises` (verified: used in `analysis-storage.service.ts:16`)

2. **All patterns verified from examples**:

   - Hook handler pattern: `SessionStartHookHandler` (verified: lines 66-209)
   - Hook merging pattern: `SdkQueryOptionsBuilder.createHooks()` (verified: lines 660-709)
   - File storage pattern: `AnalysisStorageService` (verified: lines 1-267)
   - DI token pattern: `SDK_TOKENS` with `Symbol.for()` (verified: lines 30-103)
   - DI registration pattern: `registerSdkServices()` (verified: lines 73-364)

3. **Library documentation consulted**:

   - `libs/backend/workspace-intelligence/CLAUDE.md` -- read
   - `libs/backend/agent-sdk/CLAUDE.md` -- read
   - `libs/backend/vscode-core/CLAUDE.md` -- read
   - `libs/backend/vscode-lm-tools/CLAUDE.md` -- read

4. **No hallucinated APIs**:
   - All decorators: `@injectable()`, `@inject()` from tsyringe (verified in all service files)
   - All base types: `DependencyGraph`, `FileNode`, `SymbolIndex` (verified: dependency-graph.service.ts:21-49)
   - `HookEvent`, `HookCallbackMatcher`, `HookJSONOutput`, `HookInput` (verified: claude-sdk.types.ts, imported in session-start-hook-handler.ts:27-34)
   - `FileSystemManager.createWatcher()` (verified: file-system-manager.ts:359)
   - `FileSystemManager.disposeWatcher()` (verified: file-system-manager.ts:408)
   - `ContextSizeOptimizerService.setDependencyGraph()` (verified: context-size-optimizer.service.ts:175)
   - `DependencyGraphService.invalidateFile()` (verified: dependency-graph.service.ts:317)
   - `DependencyGraphService.isBuilt()` (verified: dependency-graph.service.ts:367)
   - `IndexedFile`, `FileType` (verified: exported from workspace.types.ts via index.ts:9)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (error handling, performance, graceful degradation)
- [x] Integration points documented (3 pillars interconnected)
- [x] Files affected list complete (15 create + 15 modify = 30 files)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (HIGH, 8-11 days)
- [x] No step-by-step implementation (that's team-leader's job)
- [x] Each pillar functions independently (graceful degradation)
- [x] File-based storage follows AnalysisStorageService pattern
- [x] No new external dependencies (uses fs/promises + existing gray-matter)
- [x] No backward compatibility layers or parallel implementations
