# Research Report: Ptah Context Engine

**Task**: TASK_2025_183
**Classification**: STRATEGIC_ANALYSIS
**Confidence Level**: 90% (based on full codebase audit + external research)
**Date**: 2026-03-08

---

## Executive Intelligence Brief

The Ptah codebase already contains approximately 60-70% of the foundation needed for a Context Engine. The dependency graph, AST parsing, file relevance scoring, context optimization, and file watching infrastructure are all present and functional. The primary gaps are: (1) no persistent storage layer for session memory, (2) the dependency graph is built once and not incrementally updated, and (3) context curation does not incorporate session history or dependency proximity signals. Building the Context Engine is highly feasible with moderate risk, primarily around SQLite integration in the VS Code extension host.

---

## 1. Existing Capabilities Inventory

### 1.1 File Watching Infrastructure

**FileSystemManager** (`libs/backend/vscode-core/src/api-wrappers/file-system-manager.ts`)

- Fully implemented watcher creation via `createWatcher(config: FileWatcherConfig)` (line 359).
- Supports `FileWatcherConfig` with id, pattern (glob or `RelativePattern`), and granular event ignore flags (create/change/delete).
- Maintains `activeWatchers: Map<string, FileSystemWatcher>` with proper lifecycle management.
- Event handler `handleWatcherEvent()` is a **stub** -- it accepts `(watcherId, eventType, uri)` but currently does nothing (lines 546-555). This is the exact integration point for a live graph update.
- Already wired into `context.subscriptions` for proper cleanup.
- Operation metrics tracking is built in (could be extended for graph update perf monitoring).

**Existing watchers in workspace-intelligence**:

- `AgentDiscoveryService`: watches `.claude/agents/*.md` for cache invalidation.
- `CommandDiscoveryService`: watches `.claude/commands/**/*.md` for cache invalidation.
- `WorkspaceAnalyzerService`: watches workspace folder changes.
- `ContextService`: watches active text editor changes and open documents.

**Assessment**: The watcher infrastructure is production-ready. The `handleWatcherEvent` stub in `FileSystemManager` is the natural hook point for graph invalidation. No new watcher mechanism is needed -- we just need to connect events to `DependencyGraphService.invalidateFile()`.

### 1.2 Dependency Graph

**DependencyGraphService** (`libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`)

Key capabilities:

- `buildGraph(filePaths, workspaceRoot, tsconfigPaths)`: Full graph construction with import resolution.
- `getDependencies(filePath, depth=1)`: Forward traversal with cycle detection (max depth 3).
- `getDependents(filePath)`: Reverse dependency lookup.
- `getSymbolIndex()`: Lazy-computed map of file path to `ExportInfo[]`.
- `invalidateFile(filePath)`: **Already implemented** -- removes a file's node and all forward/reverse edges, then invalidates the symbol index cache (lines 311-356).

Data structures:

- `DependencyGraph`: nodes (`Map<string, FileNode>`), forward edges, reverse edges, build timestamp, unresolved count.
- `FileNode`: path, relativePath, imports (`ImportInfo[]`), exports (`ExportInfo[]`), language.
- `SymbolIndex`: `Map<string, ExportInfo[]>` for relevance scoring.

Import resolution supports:

- Relative imports with extension probing (.ts, .tsx, .js, .jsx).
- Directory index file resolution (index.ts, index.js).
- tsconfig path aliases (wildcard patterns like `@ptah-extension/*`).
- Filesystem fallback for files outside the known set.

**Performance characteristics**: The graph is built sequentially (one file at a time in a for-loop). For a workspace of ~280 TypeScript files, this should complete in under 2 seconds. The `invalidateFile()` method is O(degree) per file, making it suitable for incremental updates.

**Gap**: There is no incremental rebuild -- `invalidateFile()` removes the node but does not re-parse and re-insert it. An `updateFile(filePath)` method is needed that: (1) invalidates, (2) re-parses, (3) re-inserts with new edges.

### 1.3 AST / Tree-Sitter Analysis

**TreeSitterParserService** and **AstAnalysisService**:

- Full tree-sitter integration with JavaScript and TypeScript grammars.
- Query-based extraction for: functions, classes, imports, exports.
- S-expression queries defined in `tree-sitter.config.ts`.

**Existing queries** (`tree-sitter.config.ts`):

- `JS_TS_FUNCTION_QUERY`: function declarations, generators, arrow functions, methods.
- `JS_TS_CLASS_QUERY`: class declarations, class expressions.
- `JS_TS_IMPORT_QUERY`: default, named, namespace, side-effect imports.
- `JS_TS_EXPORT_QUERY`: default, named, function, class, variable, re-exports.

**Gap -- No call-graph queries**: The current queries extract declarations and import/export relationships, but do NOT capture function call sites. A call-graph query would need to match `call_expression` nodes to identify which functions call which other functions. This is technically feasible with tree-sitter but has limitations:

```
; Proposed call-graph query (would need to be added)
(call_expression
  function: (identifier) @call.name) @call.expression

(call_expression
  function: (member_expression
    object: (identifier) @call.object
    property: (property_identifier) @call.method)) @call.method_expression
```

However, tree-sitter call-graph analysis is inherently limited for dynamic languages like TypeScript because:

- It cannot resolve method calls through interfaces or generics.
- Callback/higher-order function calls are opaque.
- The call graph is syntactic, not semantic -- it shows `foo()` calls but not which `foo` is being called when multiple exist.

**Recommendation**: Add call-graph queries as a best-effort signal for relevance scoring, but do not depend on them for correctness. They provide "this file calls functions named X" which is useful for proximity scoring even without perfect resolution.

### 1.4 Context Orchestration

**ContextOrchestrationService** (`libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`)

- Pure facade over `ContextService`.
- Handles: getContextFiles, includeFile, excludeFile, searchFiles, getAllFiles, getFileSuggestions, searchImages.
- Stateless -- delegates all work to `ContextService`.

**ContextService** (`libs/backend/workspace-intelligence/src/context/context.service.ts`)

- Manages included/excluded file sets persisted to workspace configuration.
- File search with debouncing (300ms), LRU caching (100 entries, 5min TTL).
- All files cache (2min TTL).
- Token estimation using chars/4 heuristic.
- Auto-include for open files via `onDidChangeActiveTextEditor`.

**Assessment**: `ContextOrchestrationService` is the right place to coordinate graph lifecycle. It currently has a single dependency (`ContextService`). Adding `DependencyGraphService` and a future `SessionMemoryService` as dependencies would fit naturally.

### 1.5 Context Size Optimization

**ContextSizeOptimizerService** (`libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts`)

- Two modes: `full` (complete file content) and `structural` (.d.ts summaries for lower-priority files).
- Greedy algorithm: rank files by relevance, then pack greedily within token budget.
- Adaptive budgeting: project type (monorepo: 200k, app: 175k, library: 150k) and query complexity (generate: 75k reserve, explain: 50k, simple: 30k).
- **Already has an optional `DependencyGraphInterface`** (lines 33-36) -- set via `setDependencyGraph()`. This means the optimizer was designed to integrate with the graph but currently uses it only optionally.
- Structural mode splits: top 20% by relevance get full content, remaining 80% get structural summaries via `ContextEnrichmentService`.

**Assessment**: The optimizer is ready for graph-aware scoring. The `DependencyGraphInterface` hook is already there. Adding session memory signals (recently read/changed files) would require extending `FileRelevanceScorerService` with additional scoring factors.

### 1.6 Session History

**SessionHistoryReaderService** (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`)

- Reads JSONL files from `~/.claude/projects/{hash}/sessions/{sessionId}.jsonl`.
- Parses `SessionHistoryMessage` objects with: uuid, sessionId, timestamp, type, subtype, message (role, content, usage).
- Loads agent sessions (sub-agent JSONL files).
- Extracts: text content, tool_use blocks (with tool name, input), tool_result blocks.
- Aggregates usage stats (tokens, cost, model detection).
- Handles compact_boundary markers for compaction.

**Data available per session** (from `history.types.ts`):

- `SessionHistoryMessage`: uuid, sessionId, timestamp, type (user/assistant/system), subtype (init/compact_boundary/status), message content (text blocks, tool_use blocks, tool_result blocks), usage stats.
- `ContentBlock`: type (text/thinking/tool_use/tool_result), text, thinking, tool name, tool input, tool result content.
- `AgentSessionData`: agentId, filePath, messages array.
- Tool use tracking: tool name, input parameters (including file paths for Read/Edit tools).

**Assessment**: The JSONL reader provides rich session data. For Session Memory, we need to extract "observations" from this data: files read, files changed, key decisions, error patterns. The `ContentBlock` structure already captures tool_use with input (file paths) and tool_result (outcomes), which is exactly what we need.

### 1.7 Session Metadata Store

**SessionMetadataStore** (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts`)

- Lightweight UI metadata: sessionId, name, workspaceId, timestamps, cost, tokens, CLI session references.
- Backed by `vscode.Memento` (workspaceState) -- survives extension restarts but not workspace changes.
- CRUD operations: save, get, getForWorkspace, getAll, touch, addStats, create, delete.

**Assessment**: This store is intentionally minimal. Session Memory needs a much richer storage layer -- this is where SQLite comes in.

### 1.8 SDK Hooks and Lifecycle

**Available SDK hook events** (from `claude-sdk.types.ts`):

- `PreToolUse`: Before tool execution -- captures what the AI is about to do.
- `PostToolUse`: After tool execution -- captures results.
- `PostToolUseFailure`: Failed tool executions.
- `SessionStart`: Session lifecycle (startup, resume, clear, compact).
- `SessionEnd`: Session completion.
- `SubagentStart`/`SubagentStop`: Sub-agent lifecycle.
- `PreCompact`: Before context compaction.
- `Notification`, `UserPromptSubmit`, `Stop`, `PermissionRequest`, `Setup`.

**SessionStartHookHandler** (`libs/backend/agent-sdk/src/lib/helpers/session-start-hook-handler.ts`)

- Creates SDK hooks for `SessionStart` events.
- Detects sources: startup, resume, clear, compact.
- Currently only acts on `clear` (notifies frontend to reset tab state).
- Pattern: non-blocking, fire-and-forget callback, never throws.

**SdkQueryOptionsBuilder** (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`)

- Central builder for all SDK query configuration.
- Merges hooks from SubagentHookHandler, CompactionHookHandler, SessionStartHookHandler.
- Hook merging: concatenates arrays per event key (line 684).
- This is the injection point for adding Session Memory observation hooks.

**Assessment**: The hook system is well-designed. To capture observations for Session Memory, we would add hooks for:

- `PostToolUse`: Extract file reads (Read tool), file edits (Edit/Write tools), search queries.
- `SessionEnd`: Summarize session observations.
- `PreCompact`: Capture context before it's compacted away.

### 1.9 MCP / Ptah API Namespaces

**PtahAPIBuilder** (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`)

- 16 namespaces: workspace, search, symbols, diagnostics, git, ai, files, commands, context, project, relevance, ast, ide, llm, orchestration, agent.
- Each namespace is built by a dedicated builder function.
- The `context` namespace already exposes token budget management.
- The `relevance` namespace exposes file scoring.

**Assessment**: A new `memory` namespace could be added to expose session memory data to the MCP tool, allowing the AI to query its own past observations.

---

## 2. Technical Feasibility Analysis

### Pillar 1: Live Code Graph

| Aspect                            | Difficulty | Notes                                                                         |
| --------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| File watcher setup                | Easy       | `FileSystemManager.createWatcher()` is ready. Pattern: `**/*.{ts,tsx,js,jsx}` |
| Graph invalidation on change      | Easy       | `DependencyGraphService.invalidateFile()` already implemented                 |
| Incremental re-parse on change    | Medium     | Need new `updateFile()` method: invalidate + re-parse + re-insert edges       |
| Initial graph build trigger       | Easy       | Wire into extension activation or first context request                       |
| Call-graph queries                | Medium     | Tree-sitter queries can match `call_expression` but resolution is approximate |
| Performance for large workspaces  | Low Risk   | 280 files = ~2s build. Incremental updates are O(degree) per file             |
| Graph persistence across restarts | Medium     | Could serialize to JSON, but in-memory rebuild on activation is fast enough   |

**Estimated effort**: 2-3 days for core incremental graph. 1 day for call-graph queries (best-effort).

### Pillar 2: Session Memory

| Aspect                            | Difficulty | Notes                                                                                    |
| --------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| Observation extraction from hooks | Medium     | Parse PostToolUse for file reads/edits, extract paths from tool input                    |
| SQLite storage layer              | Hard       | Native module compatibility is the main risk (see Section 3)                             |
| FTS5 full-text search             | Medium     | sql.js-fts5 exists but requires custom WASM build; alternatively use simple LIKE queries |
| Memory summarization              | Medium     | Use LLM to summarize session observations into structured facts                          |
| Cross-session memory retrieval    | Easy       | SQL queries against observation table                                                    |
| Memory injection into prompts     | Easy       | Add to `assembleSystemPromptAppend()` in SdkQueryOptionsBuilder                          |

**Estimated effort**: 3-4 days for storage + observation extraction. 2 days for query/retrieval. 1 day for prompt injection.

### Pillar 3: Smart Context Curation

| Aspect                                   | Difficulty   | Notes                                                                     |
| ---------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| Graph-aware relevance scoring            | Easy         | `ContextSizeOptimizerService` already has `DependencyGraphInterface` hook |
| Session memory scoring boost             | Medium       | Files recently read/changed get relevance boost                           |
| Context profiles (bugfix/feature/review) | Medium       | Different scoring weights per task type                                   |
| Dependency proximity scoring             | Easy         | Use `getDependencies(file, depth=2)` to boost nearby files                |
| Token budget adaptation                  | Already Done | `optimizeWithAdaptiveBudget()` exists                                     |

**Estimated effort**: 2-3 days for all context curation improvements.

---

## 3. SQLite in VS Code Extensions -- Deep Analysis

### The Problem

VS Code runs on Electron, which bundles its own Node.js version. Native Node.js modules (like `better-sqlite3`) are compiled against a specific Node.js ABI version. When the extension's native module is compiled against a different Node.js version than Electron's, you get:

```
Error: The module was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version of Node.js requires NODE_MODULE_VERSION Y.
```

### Option A: better-sqlite3 (Native Module)

**Pros**:

- Synchronous API (simplifies code dramatically).
- Fastest SQLite implementation for Node.js.
- Full FTS5 support built-in.
- Extensive API with prepared statements, transactions, etc.

**Cons**:

- Requires native binary compilation per platform (win32-x64, linux-x64, darwin-x64, darwin-arm64).
- Must be recompiled against VS Code's Electron version (`electron-rebuild`).
- Breaks on every VS Code update that bumps Electron.
- Multiple open issues spanning 2020-2025 for VS Code compatibility.
- Makes extension packaging significantly more complex (platform-specific builds).

**Verdict**: HIGH RISK. Not recommended unless willing to maintain per-platform builds.

### Option B: @vscode/sqlite3 (Microsoft's Fork)

**Pros**:

- Maintained by Microsoft specifically for VS Code extensions.
- Pre-built against VS Code's Electron ABI.
- Async API (non-blocking).

**Cons**:

- Async API is more complex for transactional operations.
- Less actively maintained than better-sqlite3.
- Still a native module (platform-specific).
- json1 extension bundled, but FTS5 status unclear.

**Verdict**: MEDIUM RISK. Better than better-sqlite3 but still has native module overhead.

### Option C: sql.js (WASM -- RECOMMENDED)

**Pros**:

- Pure JavaScript/WASM -- no native modules. Works on ALL platforms identically.
- Zero compilation step. Zero platform-specific builds.
- FTS5 available via `sql.js-fts5` npm package (pre-compiled WASM with FTS5 enabled).
- Synchronous API (similar to better-sqlite3).
- ~2MB WASM file, loads in ~100ms.
- Can persist to file via `db.export()` -> `Buffer` -> `fs.writeFileSync()`.

**Cons**:

- 2-5x slower than native better-sqlite3 for bulk operations.
- No built-in file persistence (must manually save/load).
- Memory usage: entire DB loaded into WASM memory.
- For our use case (~10MB max DB): performance difference is negligible.

**Performance characteristics for our use case**:

- INSERT 1000 observations: ~50ms (sql.js) vs ~10ms (better-sqlite3).
- SELECT with FTS5 query: ~5ms (sql.js) vs ~1ms (better-sqlite3).
- DB load from file: ~100ms for 10MB database.
- These are well within acceptable limits for a VS Code extension.

**Verdict**: LOW RISK. Strongly recommended. Zero platform concerns, FTS5 available, performance adequate.

### Option D: VS Code Memento + JSON (Simplest)

**Pros**:

- Already used by `SessionMetadataStore`.
- Zero dependencies.
- VS Code handles persistence.

**Cons**:

- No indexing, no FTS.
- O(n) search on all operations.
- Size limited (~5MB practical limit).
- No relational queries.

**Verdict**: Insufficient for Session Memory at scale. Fine for metadata only.

### Recommendation

Use **sql.js** (via `sql.js-fts5` for FTS5 support) as the storage layer. It eliminates all native module risk while providing full SQLite capability including full-text search. The WASM binary is a one-time ~2MB overhead. Persist the database file to the extension's `globalStoragePath`.

---

## 4. Architecture Recommendations

### 4.1 Where Each Component Lives

```
libs/backend/workspace-intelligence/
  src/
    graph/
      live-code-graph.service.ts          # NEW - Graph lifecycle manager
      graph-file-watcher.service.ts       # NEW - File watcher -> graph bridge
    ast/
      dependency-graph.service.ts         # EXISTING - Add updateFile() method
      tree-sitter.config.ts              # EXISTING - Add call-graph queries
      call-graph.queries.ts              # NEW - Call expression queries

libs/backend/agent-sdk/
  src/lib/
    memory/
      session-memory.service.ts           # NEW - Observation storage facade
      observation-extractor.ts            # NEW - Extract observations from hooks
      memory-query.service.ts             # NEW - Query past observations
    helpers/
      observation-hook-handler.ts         # NEW - PostToolUse/SessionEnd hooks
    storage/
      sqlite-storage.service.ts           # NEW - sql.js wrapper
      sqlite-schema.ts                    # NEW - Table definitions + migrations

libs/backend/workspace-intelligence/
  src/
    context-analysis/
      context-profile.service.ts          # NEW - Task-type context profiles
      file-relevance-scorer.service.ts    # EXISTING - Add graph + memory signals
      context-size-optimizer.service.ts   # EXISTING - Wire graph dependency
```

### 4.2 Integration Points

**Live Code Graph Activation**:

1. Extension activation -> `LiveCodeGraphService.initialize()`.
2. Calls `DependencyGraphService.buildGraph()` with workspace files.
3. Creates file watcher via `FileSystemManager.createWatcher()` for `**/*.{ts,tsx,js,jsx}`.
4. On file change/create/delete: calls `DependencyGraphService.updateFile()` (new method).
5. `ContextOrchestrationService` gets `LiveCodeGraphService` as a dependency.

**Session Memory Observation Capture**:

1. `SdkQueryOptionsBuilder.createHooks()` adds `ObservationHookHandler` hooks.
2. `PostToolUse` hook extracts: tool name, file paths from input, success/failure from result.
3. `SessionEnd` hook triggers observation summarization.
4. All observations stored via `SessionMemoryService` -> `SqliteStorageService`.

**Smart Context Curation**:

1. `FileRelevanceScorerService.rankFiles()` enhanced with:
   - Dependency proximity signal from `LiveCodeGraphService`.
   - Session memory signal from `SessionMemoryService` (recently touched files).
   - Context profile weights from `ContextProfileService`.
2. `ContextSizeOptimizerService` already has the `DependencyGraphInterface` hook -- just wire it.

**Session Start Hook (Memory Injection)**:

1. `session-start-hook-handler.ts` already handles `SessionStart`.
2. Extend to query `SessionMemoryService` for relevant observations.
3. Inject into system prompt via `assembleSystemPromptAppend()`.

### 4.3 Database Schema (sql.js)

```sql
-- Session observations table
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,  -- 'file_read', 'file_edit', 'search', 'error', 'decision', 'summary'
  file_path TEXT,
  content TEXT,        -- Observation details (JSON or plain text)
  importance REAL DEFAULT 0.5,  -- 0.0-1.0 importance score
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- FTS5 virtual table for full-text search over observations
CREATE VIRTUAL TABLE observations_fts USING fts5(
  content,
  file_path,
  content='observations',
  content_rowid='id'
);

-- Session summaries
CREATE TABLE session_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  files_touched TEXT,  -- JSON array of file paths
  key_decisions TEXT,  -- JSON array of decisions
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_obs_session ON observations(session_id);
CREATE INDEX idx_obs_workspace ON observations(workspace_id);
CREATE INDEX idx_obs_file ON observations(file_path);
CREATE INDEX idx_obs_type ON observations(type);
CREATE INDEX idx_obs_timestamp ON observations(timestamp DESC);
CREATE INDEX idx_summary_workspace ON session_summaries(workspace_id);
```

---

## 5. Critical Path -- Build Order

### Phase 1: Live Code Graph (Week 1)

**Prerequisites**: None (builds on existing services).

1. **Add `updateFile()` to DependencyGraphService** -- invalidate + re-parse + re-insert.
2. **Create `GraphFileWatcherService`** -- connects FileSystemManager watchers to graph updates.
3. **Create `LiveCodeGraphService`** -- lifecycle manager (init, rebuild, dispose).
4. **Wire into extension activation** -- build graph on startup, watch for changes.
5. **Connect to `ContextSizeOptimizerService`** -- via existing `setDependencyGraph()`.

### Phase 2: SQLite Storage Layer (Week 1-2)

**Prerequisites**: None (independent of Phase 1).

1. **Add `sql.js-fts5` dependency** to `libs/backend/agent-sdk/package.json`.
2. **Create `SqliteStorageService`** -- WASM load, DB create/open/save, schema migrations.
3. **Create schema** -- observations, observations_fts, session_summaries tables.
4. **Persistence strategy** -- save to `context.globalStoragePath` on interval + on dispose.
5. **Unit tests** -- in-memory DB for testing.

### Phase 3: Session Memory (Week 2)

**Prerequisites**: Phase 2 (SQLite storage).

1. **Create `ObservationHookHandler`** -- PostToolUse hook for observation extraction.
2. **Create `ObservationExtractor`** -- parse tool input/output into structured observations.
3. **Create `SessionMemoryService`** -- facade for storing/querying observations.
4. **Create `MemoryQueryService`** -- FTS5 search, recency queries, file-path queries.
5. **Wire hooks into `SdkQueryOptionsBuilder.createHooks()`**.

### Phase 4: Smart Context Curation (Week 2-3)

**Prerequisites**: Phase 1 (graph) + Phase 3 (memory).

1. **Enhance `FileRelevanceScorerService`** -- add graph proximity and memory signals.
2. **Create `ContextProfileService`** -- bugfix/feature/review profiles with different weights.
3. **Inject memory into system prompt** -- extend `assembleSystemPromptAppend()`.
4. **Add `memory` MCP namespace** -- expose memory queries to Ptah API.

### Phase 5: Integration Testing (Week 3)

1. End-to-end test: edit file -> graph updates -> context changes.
2. End-to-end test: session observations captured -> queryable in next session.
3. Performance benchmarks: graph build time, incremental update time, memory query time.

---

## 6. Risk Assessment

### Critical Risks

| Risk                                                | Probability | Impact | Mitigation                                                                     |
| --------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------ |
| sql.js WASM loading fails in VS Code extension host | 10%         | HIGH   | Test early in Phase 2. Fallback: JSON file storage with simple search          |
| sql.js-fts5 package unmaintained                    | 20%         | MEDIUM | Can compile custom sql.js WASM with FTS5 flag. Or use LIKE queries as fallback |
| Graph incremental update introduces stale edges     | 30%         | MEDIUM | Add periodic full rebuild (e.g., every 5 minutes) as consistency check         |
| Session memory grows too large (> 100MB)            | 15%         | LOW    | Add observation expiry (e.g., 30 days), importance-based pruning               |
| PostToolUse hook adds latency to SDK responses      | 10%         | MEDIUM | Hook is fire-and-forget (non-blocking). Buffer observations, batch-insert      |
| Tree-sitter call-graph queries too noisy            | 40%         | LOW    | Best-effort signal only -- not critical for core functionality                 |

### Performance Risks

| Operation                         | Expected | Acceptable | Risk |
| --------------------------------- | -------- | ---------- | ---- |
| Initial graph build (280 files)   | ~2s      | < 5s       | Low  |
| Incremental graph update (1 file) | ~50ms    | < 200ms    | Low  |
| sql.js DB load from disk          | ~100ms   | < 500ms    | Low  |
| Observation insert (single)       | ~1ms     | < 10ms     | Low  |
| FTS5 query                        | ~5ms     | < 50ms     | Low  |
| Memory injection into prompt      | ~10ms    | < 100ms    | Low  |

### Complexity Risks

| Area                                        | Complexity | Notes                                                           |
| ------------------------------------------- | ---------- | --------------------------------------------------------------- |
| sql.js persistence (manual save/load)       | Medium     | Need save-on-interval + save-on-dispose strategy                |
| Observation extraction from tool_use blocks | Medium     | Tool input format varies by tool (Read vs Edit vs Bash)         |
| Context profile selection                   | Low        | Could be automatic based on user prompt keywords                |
| FTS5 index maintenance                      | Low        | Triggers keep FTS index in sync with main table                 |
| Hook merging in SdkQueryOptionsBuilder      | Low        | Pattern already established for SubagentHooks + CompactionHooks |

---

## 7. Key Design Decisions to Make

1. **Graph rebuild strategy**: Full rebuild on activation + incremental updates? Or lazy-build on first context request?

   - Recommendation: Lazy-build on first context request, then incremental updates via watchers.

2. **Observation granularity**: Store every tool_use? Or only file reads/edits?

   - Recommendation: Start with file reads/edits only. Expand to search queries and errors in Phase 2.

3. **Memory retention policy**: How long to keep observations?

   - Recommendation: 30-day rolling window. Summarize old sessions before deletion.

4. **Context profile detection**: Manual selection or automatic?

   - Recommendation: Automatic based on prompt analysis (keywords like "fix", "implement", "review"). Allow manual override.

5. **FTS5 vs simple search**: Is FTS5 worth the complexity?
   - Recommendation: Start with `sql.js-fts5`. If the package proves problematic, fall back to LIKE queries with manual tokenization.

---

## 8. Research Sources

### Codebase Analysis (Primary Sources)

- `FileSystemManager` -- `libs/backend/vscode-core/src/api-wrappers/file-system-manager.ts`
- `DependencyGraphService` -- `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`
- `ContextOrchestrationService` -- `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`
- `tree-sitter.config.ts` -- `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`
- `AstAnalysisService` -- `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts`
- `SessionHistoryReaderService` -- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
- `history.types.ts` -- `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts`
- `SessionMetadataStore` -- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- `ContextSizeOptimizerService` -- `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts`
- `ContextService` -- `libs/backend/workspace-intelligence/src/context/context.service.ts`
- `PtahAPIBuilder` -- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `SdkQueryOptionsBuilder` -- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `SessionStartHookHandler` -- `libs/backend/agent-sdk/src/lib/helpers/session-start-hook-handler.ts`
- `claude-sdk.types.ts` -- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`

### External Research (Secondary Sources)

s/edits only. Expand to search queries and errors in Phase 2.

3. **Memory retention policy**: How long to keep observations?

   - Recommendation: 30-day rolling window. Summarize old sessions before deletion.

4. **Context profile detection**: Manual selection or automatic?

   - Recommendation: Automatic based on prompt analysis (keywords like "fix", "implement", "review"). Allow manual override.

5. **FTS5 vs simple search**: Is FTS5 worth the complexity?
   - Recommendation: Start with `sql.js-fts5`. If the package proves problematic, fall back to LIKE queries with manual tokenization.

---

## 8. Research Sources

### Codebase Analysis (Primary Sources)

- `FileSystemManager` -- `libs/backend/vscode-core/src/api-wrappers/file-system-manager.ts`
- `DependencyGraphService` -- `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`
- `ContextOrchestrationService` -- `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`
- `tree-sitter.config.ts` -- `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`
- `AstAnalysisService` -- `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts`
- `SessionHistoryReaderService` -- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
- `history.types.ts` -- `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts`
- `SessionMetadataStore` -- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- `ContextSizeOptimizerService` -- `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts`
- `ContextService` -- `libs/backend/workspace-intelligence/src/context/context.service.ts`
- `PtahAPIBuilder` -- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `SdkQueryOptionsBuilder` -- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `SessionStartHookHandler` -- `libs/backend/agent-sdk/src/lib/helpers/session-start-hook-handler.ts`
- `claude-sdk.types.ts` -- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`

### External Research (Secondary Sources)

- [better-sqlite3 VS Code compatibility issues](https://github.com/WiseLibs/better-sqlite3/issues/385) -- Documents native module ABI mismatch problems
- [better-sqlite3 Electron integration issue #1321](https://github.com/WiseLibs/better-sqlite3/issues/1321) -- Ongoing compatibility challenges
- [@vscode/sqlite3 npm package](https://www.npmjs.com/package/@vscode/sqlite3) -- Microsoft's VS Code-specific SQLite fork
- [VS Code SQLite discussion](https://github.com/microsoft/vscode-discussions/discussions/16) -- Community guidance on SQLite in extensions
- [sql.js-fts5 npm package](https://www.npmjs.com/package/sql.js-fts5) -- WASM SQLite build with FTS5 enabled
- [Compiling FTS5 into sql.js](https://blog.ouseful.info/2022/04/06/compiling-full-text-search-fts5-into-sqlite-wasm-build/) -- Instructions for custom FTS5 WASM builds
- [SQLite FTS5 Extension documentation](https://www.sqlite.org/fts5.html) -- Official FTS5 reference
- [Aider's repository map with tree-sitter](https://aider.chat/2023/10/22/repomap.html) -- Production example of tree-sitter for code context
- [TypeScript-Call-Graph](https://github.com/whyboris/TypeScript-Call-Graph) -- Call graph generation approach for TypeScript
- [tree-sitter-stack-graphs-typescript](https://crates.io/crates/tree-sitter-stack-graphs-typescript) -- Semantic analysis over tree-sitter

---

## Decision Support

**GO Recommendation**: PROCEED WITH CONFIDENCE

- Technical Feasibility: 5/5 -- All core infrastructure exists, gaps are well-defined
- Business Alignment: 5/5 -- Directly improves AI context quality (core product value)
- Risk Level: 2/5 (Low-Medium) -- sql.js WASM is the only notable risk, and it has clear fallbacks
- Effort Estimate: 2-3 weeks for full implementation across all three pillars
- ROI Projection: High -- better context = better AI responses = core competitive advantage

**Next Agent**: software-architect
**Architect Focus**: Design the DI registration strategy for new services, define the `LiveCodeGraphService` interface, and specify the observation extraction schema for `PostToolUse` hooks.
