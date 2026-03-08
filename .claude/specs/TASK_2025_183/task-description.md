# Requirements Document - TASK_2025_183: Ptah Context Engine

## Introduction

Ptah is an AI coding orchestra for VS Code that relies on high-quality context to deliver effective AI-assisted development. Today, context assembly is stateless: each session starts from scratch with no memory of prior interactions, and the dependency graph is built once without incremental updates. This results in stale graph data, redundant file re-reading across sessions, and missed opportunities to leverage relationship signals for context selection.

The Ptah Context Engine addresses these gaps by introducing three pillars: (1) a live, auto-updating code graph that stays current via file watchers and incremental parsing, (2) persistent session memory that captures what the AI observed across sessions and stores it in markdown files under `.claude/context/`, and (3) smart context curation that combines graph proximity, session memory signals, and task-type profiles to select minimal-token, highest-quality context for each AI request.

The storage approach follows the proven `AnalysisStorageService` pattern already established in the codebase: manifest JSON files for structured metadata, markdown files for human-readable content, and `fs/promises` for all I/O. This eliminates external dependencies (no WASM, no native modules) and produces files that are inspectable, version-controllable, and trivially debuggable. Search is handled by simple string matching over markdown content -- sufficient for the observation volume expected in a single-workspace context.

The existing codebase provides approximately 60-70% of the required foundation. `DependencyGraphService` already supports graph building and invalidation. `FileSystemManager` has production-ready watcher infrastructure with a stub event handler awaiting connection. `SdkQueryOptionsBuilder` provides hook merging for `PostToolUse`/`SessionStart`/`SessionEnd`. `ContextSizeOptimizerService` already declares an optional `DependencyGraphInterface` designed for graph integration. This task connects these existing capabilities and fills the remaining gaps.

**Affected Libraries**:

- `libs/backend/workspace-intelligence` (primary -- graph lifecycle, context curation)
- `libs/backend/agent-sdk` (primary -- session memory, observation hooks, file-based storage)
- `libs/backend/vscode-core` (secondary -- file watcher event bridging)
- `libs/backend/vscode-lm-tools` (secondary -- new `memory` MCP namespace)
- `apps/ptah-extension-vscode` (consumption point)

---

## Requirements

### Requirement 0: Foundation Wiring (TASK_2025_182 QA Dependency)

**User Story:** As a developer working on the Context Engine, I want the foundation wiring from TASK_2025_182 QA fixes to be complete, so that I can build on a stable base without rework.

**Context:** TASK_2025_182 QA fixes are being applied in parallel. This task assumes they are complete. The fixes include: `contentOverrides` map in `ContextSizeOptimizerService`, dependency graph wiring in `ContextOrchestrationService`, and `DependencyGraphService.updateFile()` method stub.

#### Acceptance Criteria

1. WHEN this task begins implementation THEN the `contentOverrides` map in `ContextSizeOptimizerService` SHALL be functional and tested.
2. WHEN `ContextOrchestrationService` is initialized THEN it SHALL accept `DependencyGraphService` as an optional dependency via DI.
3. WHEN `DependencyGraphService.invalidateFile()` is called THEN it SHALL remove the file node and all forward/reverse edges and invalidate the symbol index cache.
4. WHEN any TASK_2025_182 QA fix is incomplete at implementation start THEN the implementing developer SHALL flag a blocker and coordinate with the TASK_2025_182 team.

---

### Requirement 1: Live Code Graph

**User Story:** As an AI agent working in a VS Code workspace, I want the dependency graph to stay current as files change, so that context selection reflects the actual state of the codebase rather than a stale snapshot.

#### 1.1 LiveCodeGraphService -- Lifecycle Manager

**User Story:** As the extension host, I want a single service managing graph lifecycle (lazy init, rebuild, dispose), so that the graph is available when needed without blocking extension activation.

##### Acceptance Criteria

1. WHEN the first context request arrives and no graph exists THEN `LiveCodeGraphService` SHALL trigger a full graph build via `DependencyGraphService.buildGraph()` using workspace files from `WorkspaceIndexerService`.
2. WHEN the graph is built THEN `LiveCodeGraphService` SHALL register file watchers via `GraphFileWatcherService` for `**/*.{ts,tsx,js,jsx}` patterns.
3. WHEN `LiveCodeGraphService.dispose()` is called THEN all file watchers SHALL be unregistered and graph resources released.
4. WHEN a full graph rebuild is triggered (manual or periodic) THEN the existing graph SHALL be replaced atomically -- no partial state visible to consumers.
5. WHEN the graph build takes longer than 5 seconds THEN `LiveCodeGraphService` SHALL log a performance warning with the file count and elapsed time.
6. WHEN `LiveCodeGraphService` is resolved from DI THEN it SHALL NOT trigger a graph build until the first consumer requests the graph (lazy initialization).

##### Non-Functional Requirements

- Initial graph build for 280 files SHALL complete in under 5 seconds.
- Memory overhead of the live graph SHALL not exceed 50MB for a 500-file workspace.
- `LiveCodeGraphService` SHALL be registered as a singleton in the DI container.

#### 1.2 GraphFileWatcherService -- File Watcher Bridge

**User Story:** As the live code graph system, I want file system change events routed to the dependency graph, so that the graph updates incrementally without full rebuilds.

##### Acceptance Criteria

1. WHEN a TypeScript/JavaScript file is created THEN `GraphFileWatcherService` SHALL call `DependencyGraphService.updateFile()` for the new file.
2. WHEN a TypeScript/JavaScript file is modified THEN `GraphFileWatcherService` SHALL call `DependencyGraphService.updateFile()` for the changed file.
3. WHEN a TypeScript/JavaScript file is deleted THEN `GraphFileWatcherService` SHALL call `DependencyGraphService.invalidateFile()` for the removed file.
4. WHEN multiple file changes occur within 100ms THEN `GraphFileWatcherService` SHALL debounce and batch the updates into a single graph update cycle.
5. WHEN a file change event arrives for a non-TypeScript/JavaScript file THEN the event SHALL be ignored.
6. WHEN the watcher encounters an error (e.g., permission denied) THEN it SHALL log the error and continue watching -- never crash the extension host.

#### 1.3 DependencyGraphService.updateFile() -- Incremental Update

**User Story:** As the graph file watcher, I want to incrementally update a single file in the dependency graph, so that changes are reflected in O(degree) time rather than O(n) full rebuild time.

##### Acceptance Criteria

1. WHEN `updateFile(filePath)` is called THEN it SHALL: (a) call `invalidateFile(filePath)` to remove stale edges, (b) re-parse the file using `TreeSitterParserService`, (c) extract imports/exports, (d) re-insert the `FileNode` with updated edges.
2. WHEN the file content has not changed since last parse THEN `updateFile()` SHALL skip re-parsing (content hash check).
3. WHEN `updateFile()` completes THEN the symbol index cache SHALL be invalidated so subsequent queries reflect the update.
4. WHEN `updateFile()` is called for a file not currently in the graph THEN it SHALL add the file as a new node with resolved edges.
5. WHEN `updateFile()` fails to read or parse the file THEN it SHALL log a warning and leave the graph in its previous valid state (no partial updates).

##### Non-Functional Requirements

- Incremental update for a single file SHALL complete in under 200ms.
- `updateFile()` SHALL be safe to call concurrently (queue or serialize concurrent calls).

#### 1.4 Graph Cache Persistence

**User Story:** As the context engine, I want the dependency graph and symbol index cached to disk as JSON files, so that subsequent extension activations can load the graph faster than a full rebuild.

##### Acceptance Criteria

1. WHEN `LiveCodeGraphService` completes a full graph build THEN it SHALL write the graph to `.claude/context/graph/dependency-graph.json` via `ContextStorageService`.
2. WHEN `LiveCodeGraphService` completes a full graph build THEN it SHALL write the symbol index to `.claude/context/graph/symbol-index.json` via `ContextStorageService`.
3. WHEN `LiveCodeGraphService` initializes and cached graph files exist THEN it SHALL load the cached graph and validate it against a content hash to detect staleness.
4. WHEN the cached graph is stale (hash mismatch) THEN `LiveCodeGraphService` SHALL perform a full rebuild and overwrite the cache.
5. WHEN writing graph cache files fails THEN the error SHALL be logged and the system continues with the in-memory graph -- cache is a performance optimization, not a requirement.

##### Non-Functional Requirements

- Graph cache write SHALL be non-blocking (fire-and-forget after build completes).
- Graph cache load SHALL complete in under 500ms for a 280-file workspace.

#### 1.5 Call-Graph Queries (Optional, Best-Effort)

**User Story:** As the relevance scoring system, I want best-effort call-graph signals from tree-sitter, so that files calling or called by the active file get a proximity boost.

##### Acceptance Criteria

1. WHEN tree-sitter parses a TypeScript/JavaScript file THEN call-graph queries SHALL extract `call_expression` nodes capturing function name and member expression calls.
2. WHEN call-graph data is available for a file THEN `FileRelevanceScorerService` MAY use it as an additional scoring signal.
3. WHEN call-graph resolution is ambiguous (e.g., dynamic dispatch, generics) THEN the system SHALL treat the signal as low-confidence and weight it accordingly.
4. WHEN call-graph extraction fails for any file THEN the system SHALL gracefully degrade -- graph proximity scoring continues without call-graph data.

##### Non-Functional Requirements

- Call-graph extraction SHALL NOT increase per-file parse time by more than 50%.
- This requirement is explicitly best-effort. Partial or approximate results are acceptable.

---

### Requirement 2: File-Based Context Storage

**User Story:** As the session memory system, I want a persistent, file-based storage layer using the `.claude/context/` directory structure, so that observations survive extension restarts and remain inspectable as plain markdown files without external dependencies.

#### 2.1 ContextStorageService -- File-Based Storage Manager

**User Story:** As the storage layer consumer, I want a service that manages the `.claude/context/` directory structure (create, read, write, list, delete), so that I can store and query context data without managing file paths or I/O directly.

##### Acceptance Criteria

1. WHEN `ContextStorageService.initialize(workspacePath)` is called THEN it SHALL ensure the `.claude/context/` directory tree exists: `graph/`, `memory/sessions/`, `memory/summaries/`, `profiles/`.
2. WHEN `ContextStorageService.writeSessionFile(sessionId, content)` is called THEN it SHALL write a markdown file to `.claude/context/memory/sessions/{session-id}.md` with a YAML frontmatter header containing metadata (session ID, workspace ID, timestamps, observation count).
3. WHEN `ContextStorageService.readSessionFile(sessionId)` is called THEN it SHALL read and parse the session markdown file, returning both frontmatter metadata and observation content.
4. WHEN `ContextStorageService.writeGraphCache(type, data)` is called with type `dependency-graph` or `symbol-index` THEN it SHALL write the JSON data to `.claude/context/graph/{type}.json`.
5. WHEN `ContextStorageService.readGraphCache(type)` is called THEN it SHALL read and parse the JSON file, returning `null` if the file does not exist or is corrupt.
6. WHEN `ContextStorageService.writeSummary(summaryId, content)` is called THEN it SHALL write the summary markdown to `.claude/context/memory/summaries/{summaryId}.md`.
7. WHEN `ContextStorageService.listSessionFiles()` is called THEN it SHALL return metadata for all session files sorted by last-modified date descending.
8. WHEN any file I/O operation fails THEN `ContextStorageService` SHALL log the error and return a safe default (null, empty array) -- never throw exceptions that could crash the extension.
9. WHEN a session file is corrupted (invalid frontmatter or unreadable) THEN `ContextStorageService` SHALL log a warning and skip the file in listings -- never crash.

##### Non-Functional Requirements

- All I/O SHALL use `fs/promises` (async, non-blocking) -- consistent with `AnalysisStorageService` pattern.
- `ContextStorageService` SHALL live in `libs/backend/agent-sdk/src/lib/storage/`.
- `ContextStorageService` SHALL be registered as a singleton in the DI container.
- Directory creation SHALL be idempotent (safe to call multiple times).

#### 2.2 Session File Format

**User Story:** As a developer inspecting session memory, I want session files to be human-readable markdown with structured frontmatter, so that I can review what the AI observed without specialized tooling.

##### Acceptance Criteria

1. WHEN a session file is written THEN it SHALL follow this format:

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

   ### [2026-03-08T10:05:00Z] error

   - **File**: src/utils/parser.ts
   - **Content**: TypeError - cannot read property 'name' of undefined
   - **Importance**: 0.8

   ### [2026-03-08T10:10:00Z] search

   - **Content**: grep for "authentication" in src/
   - **Importance**: 0.3
   ```

2. WHEN frontmatter is parsed THEN the metadata fields (`session_id`, `workspace_id`, `created_at`, `updated_at`, `observation_count`) SHALL be extractable via YAML parsing (using `gray-matter`, already a project dependency).
3. WHEN observations are appended to an existing session file THEN the file SHALL be read, new observations appended to the `## Observations` section, and the frontmatter `updated_at` and `observation_count` updated.
4. WHEN an observation has a `file_path` THEN the path SHALL be stored as workspace-relative (e.g., `src/services/auth.service.ts` not `/absolute/path/src/services/auth.service.ts`).

#### 2.3 Summary File Format

##### Acceptance Criteria

1. WHEN a session summary is written THEN it SHALL follow this format:

   ```markdown
   ---
   session_id: 'sess_abc123'
   workspace_id: '/path/to/workspace'
   created_at: '2026-03-08T10:30:00Z'
   files_touched:
     - src/services/auth.service.ts
     - src/utils/parser.ts
   key_decisions:
     - 'Added input validation to login flow'
     - 'Skipped parser refactor due to time constraints'
   ---

   ## Session Summary

   Worked on authentication improvements. Added login validation to the authenticate() method in auth.service.ts. Encountered a TypeError in parser.ts but deferred the fix. Searched for authentication patterns across the codebase.
   ```

2. WHEN a rolling summary is written THEN it SHALL be saved as `.claude/context/memory/summaries/latest.md`, overwriting the previous latest summary.
3. WHEN a daily snapshot is written THEN it SHALL be saved as `.claude/context/memory/summaries/{YYYY-MM-DD}.md`.

#### 2.4 Retention and Pruning

##### Acceptance Criteria

1. WHEN `ContextStorageService.pruneOldSessions(retentionDays)` is called THEN it SHALL delete session files whose `updated_at` frontmatter timestamp is older than the retention period.
2. WHEN pruning session files THEN sessions containing observations with `importance >= 0.8` SHALL be retained for an additional retention period (2x the base retention).
3. WHEN pruning summary files THEN daily snapshots older than the retention period SHALL be deleted, but `latest.md` SHALL never be deleted.
4. WHEN pruning encounters a file that cannot be parsed (missing frontmatter) THEN it SHALL delete the file (assume it is corrupt/orphaned).

##### Non-Functional Requirements

- Default retention period SHALL be 30 days.
- High-importance sessions (containing observations >= 0.8) SHALL be retained for 60 days.
- Pruning SHALL run automatically on extension activation and daily thereafter.
- Pruning SHALL be non-blocking (run in background, never stall extension activation).

---

### Requirement 3: Session Memory

**User Story:** As an AI agent, I want the system to remember what files I read, what I changed, what searches I performed, and what errors I encountered across sessions, so that future sessions can leverage this history for better context selection and avoid repeating mistakes.

#### 3.1 ObservationHookHandler -- SDK Hook Integration

**User Story:** As the session memory system, I want to capture observations from SDK PostToolUse events, so that every file read, edit, search, and error is recorded without modifying the core SDK adapter.

##### Acceptance Criteria

1. WHEN a `PostToolUse` event fires for a `Read` tool THEN `ObservationHookHandler` SHALL create a `file_read` observation with the file path extracted from `tool_input.file_path`.
2. WHEN a `PostToolUse` event fires for an `Edit` or `Write` tool THEN `ObservationHookHandler` SHALL create a `file_edit` observation with the file path and a summary of the change.
3. WHEN a `PostToolUse` event fires for a `Bash` or `Grep` tool THEN `ObservationHookHandler` SHALL create a `search` observation with the search query/command.
4. WHEN a `PostToolUseFailure` event fires THEN `ObservationHookHandler` SHALL create an `error` observation with the tool name, input, and error message.
5. WHEN a `SessionEnd` event fires THEN `ObservationHookHandler` SHALL trigger session summarization (see 3.2).
6. WHEN observation extraction encounters any error THEN the hook SHALL log the error and return without throwing -- hooks MUST be non-blocking and fire-and-forget.
7. WHEN observations are created THEN they SHALL be buffered in memory and batch-flushed to the session markdown file at configurable intervals (default: 5 seconds) to minimize I/O overhead.

##### Non-Functional Requirements

- Hook execution SHALL add no more than 5ms latency to the SDK response pipeline.
- Observation extraction SHALL never block or delay tool execution results.

#### 3.2 ObservationExtractor -- Structured Observation Parsing

**User Story:** As the observation hook handler, I want a dedicated parser that converts raw tool_use blocks into structured observations, so that observation extraction logic is testable and maintainable independently.

##### Acceptance Criteria

1. WHEN given a `PostToolUse` event with tool name `Read` THEN `ObservationExtractor` SHALL return an observation of type `file_read` with `file_path` set to the read target and `content` containing a brief description (e.g., "Read file: src/app.ts").
2. WHEN given a `PostToolUse` event with tool name `Edit` or `Write` THEN `ObservationExtractor` SHALL return an observation of type `file_edit` with `file_path` set to the edited file and `content` summarizing the edit scope.
3. WHEN given a `PostToolUse` event with tool name `Bash` THEN `ObservationExtractor` SHALL return an observation of type `search` if the command contains search-related keywords (grep, find, rg, ag), otherwise skip.
4. WHEN given a `PostToolUseFailure` event THEN `ObservationExtractor` SHALL return an observation of type `error` with `importance` set to 0.8 (errors are high-value signals).
5. WHEN given a tool_use event for a tool not in the recognized set THEN `ObservationExtractor` SHALL return `null` (skip unrecognized tools).
6. WHEN extracting file paths from tool input THEN `ObservationExtractor` SHALL normalize paths to workspace-relative format for consistent querying.

#### 3.3 SessionMemoryService -- Storage Facade

**User Story:** As a consumer of session memory, I want a single facade for storing and querying observations, so that I do not interact with file I/O directly.

##### Acceptance Criteria

1. WHEN `addObservation(observation)` is called THEN `SessionMemoryService` SHALL validate the observation structure and add it to the in-memory buffer for the current session.
2. WHEN `flushObservations()` is called (or the flush interval fires) THEN `SessionMemoryService` SHALL append buffered observations to the session markdown file via `ContextStorageService.writeSessionFile()`.
3. WHEN `addSessionSummary(summary)` is called THEN `SessionMemoryService` SHALL write the summary to both `summaries/latest.md` and `summaries/{date}.md` via `ContextStorageService`.
4. WHEN `getRecentObservations(workspaceId, limit)` is called THEN it SHALL read the most recent session files, parse their observations, and return them ordered by timestamp descending.
5. WHEN `getFileHistory(workspaceId, filePath)` is called THEN it SHALL scan session files for observations referencing the specified file path.
6. WHEN `searchObservations(workspaceId, query)` is called THEN it SHALL delegate to `MemoryQueryService` for content search across session files.
7. WHEN `pruneOldObservations(retentionDays)` is called THEN it SHALL delegate to `ContextStorageService.pruneOldSessions()`.
8. WHEN the storage directory is not available (e.g., workspace not open) THEN all methods SHALL return empty results and log warnings -- never throw.

##### Non-Functional Requirements

- Default retention period SHALL be 30 days.
- High-importance observations (>= 0.8) SHALL cause their session to be retained for 60 days.
- Pruning SHALL run automatically on extension activation and daily thereafter.

#### 3.4 MemoryQueryService -- File-Based Querying

**User Story:** As the smart context curation system, I want query capabilities over session memory stored in markdown files, so that I can find relevant past observations by content, file, recency, and importance.

##### Acceptance Criteria

1. WHEN `searchByContent(workspaceId, query, limit)` is called THEN it SHALL read session markdown files and perform case-insensitive substring matching against observation content, returning results ranked by recency (most recent first).
2. WHEN `getRecentlyTouchedFiles(workspaceId, days, limit)` is called THEN it SHALL scan session files within the time window and return distinct file paths from observations of type `file_read` or `file_edit`, ordered by most recent first.
3. WHEN `getFileObservations(workspaceId, filePath, limit)` is called THEN it SHALL scan session files for observations matching the given file path, ordered by timestamp descending.
4. WHEN `getSessionSummaries(workspaceId, limit)` is called THEN it SHALL read summary files from `.claude/context/memory/summaries/`, ordered by creation date descending.
5. WHEN `getErrorPatterns(workspaceId, days)` is called THEN it SHALL scan session files for error observations and group them by file path, enabling detection of repeatedly problematic files.
6. WHEN the number of session files exceeds 100 THEN `MemoryQueryService` SHALL limit scanning to the most recent files (by modification date) to bound search time.

##### Non-Functional Requirements

- Content search across 50 session files SHALL complete in under 200ms.
- All query methods SHALL accept a `limit` parameter with sensible defaults (default: 20).
- Query results SHALL be cached in memory for 30 seconds to avoid redundant file reads during a single curation pass.

#### 3.5 Hook Wiring

##### Acceptance Criteria

1. WHEN `SdkQueryOptionsBuilder.createHooks()` is called THEN it SHALL include hooks from `ObservationHookHandler` merged alongside existing `SubagentHookHandler`, `CompactionHookHandler`, and `SessionStartHookHandler` hooks.
2. WHEN observation hooks are added THEN they SHALL follow the existing non-blocking, fire-and-forget pattern established by other hook handlers.
3. WHEN the `ObservationHookHandler` is not available (e.g., storage initialization failed) THEN `SdkQueryOptionsBuilder` SHALL skip observation hooks gracefully.

---

### Requirement 4: Smart Context Curation

**User Story:** As an AI agent, I want the context selection system to use dependency graph proximity and session memory signals alongside relevance scoring, so that I receive the most relevant files with minimal token waste.

#### 4.1 ContextProfileService -- Task-Type Profiles

**User Story:** As the context curation system, I want predefined scoring profiles for different task types (bugfix, feature, review), so that context selection is optimized for the type of work being performed.

##### Acceptance Criteria

1. WHEN a `bugfix` profile is active THEN scoring weights SHALL favor: error-related files (high), recently edited files (high), test files (medium), dependency files (medium).
2. WHEN a `feature` profile is active THEN scoring weights SHALL favor: interface/type files (high), similar feature implementations (high), test files (medium), configuration files (low).
3. WHEN a `review` profile is active THEN scoring weights SHALL favor: changed files (highest), test coverage files (high), related dependency files (medium).
4. WHEN no profile is explicitly selected THEN `ContextProfileService` SHALL auto-detect the profile from prompt keywords: "fix", "bug", "error" -> bugfix; "implement", "add", "create", "feature" -> feature; "review", "check", "audit" -> review. Default: feature.
5. WHEN `ContextProfileService.getProfile(taskType)` is called THEN it SHALL return a `ContextProfile` object with named scoring weights for each signal dimension (path relevance, graph proximity, memory recency, memory frequency, file type).
6. WHEN profiles are stored THEN they SHALL be saved as markdown files under `.claude/context/profiles/` (e.g., `bugfix.md`, `feature.md`, `review.md`) with YAML frontmatter containing the weight coefficients, allowing users to customize profiles.

#### 4.2 Enhanced FileRelevanceScorerService

**User Story:** As the file ranking system, I want to incorporate graph proximity and session memory signals into relevance scoring, so that structurally related and historically relevant files rank higher.

##### Acceptance Criteria

1. WHEN scoring a file THEN `FileRelevanceScorerService` SHALL compute a composite score from: (a) existing path/keyword relevance (current behavior), (b) graph proximity signal, (c) session memory signal.
2. WHEN computing graph proximity signal THEN files within 1 hop of the active file in the dependency graph SHALL receive a proximity boost of 0.3, and files within 2 hops SHALL receive a boost of 0.15. Files beyond 2 hops receive no boost.
3. WHEN computing session memory signal THEN files read or edited in the last 3 sessions SHALL receive a recency boost scaled by session recency (most recent session: 0.2, two sessions ago: 0.1, three sessions ago: 0.05).
4. WHEN computing session memory signal THEN files that appear in error observations SHALL receive a relevance boost of 0.15 (error-prone files are high-value context).
5. WHEN the dependency graph is not available THEN the scorer SHALL use existing scoring only -- no error, no degradation of current behavior.
6. WHEN session memory is not available THEN the scorer SHALL use existing scoring only -- no error, no degradation of current behavior.
7. WHEN a `ContextProfile` is active THEN the signal weights SHALL be multiplied by the profile's weight coefficients before computing the composite score.

##### Non-Functional Requirements

- Composite scoring for 500 files SHALL complete in under 100ms.
- Signal weights SHALL be configurable via `ContextProfile` objects, not hardcoded.

#### 4.3 Dependency Proximity Scoring

##### Acceptance Criteria

1. WHEN the active file is known THEN `FileRelevanceScorerService` SHALL call `DependencyGraphService.getDependencies(activeFile, depth=2)` to get the proximity set.
2. WHEN `getDependencies()` returns results THEN files in the result set SHALL be annotated with their hop distance (1 or 2) for weight calculation.
3. WHEN `getDependents(activeFile)` is also available THEN reverse dependencies (files that import the active file) SHALL receive the same proximity boost as forward dependencies.

---

### Requirement 5: Context Injection

**User Story:** As an AI agent starting a new session, I want relevant session memory injected into my system prompt, so that I have continuity with prior work without manually re-reading files.

#### 5.1 Session Start Memory Injection

##### Acceptance Criteria

1. WHEN a `SessionStart` event fires with source `startup` or `resume` THEN `SessionStartHookHandler` SHALL query `SessionMemoryService` for relevant observations (recent file reads/edits, errors, session summaries for the current workspace).
2. WHEN relevant observations are found THEN they SHALL be formatted into a structured memory context block and appended to the system prompt via `assembleSystemPromptAppend()`.
3. WHEN the memory context exceeds 2000 tokens THEN it SHALL be truncated to the most recent and highest-importance observations, respecting the token budget.
4. WHEN no relevant observations exist THEN no memory context SHALL be injected -- the system prompt remains unchanged.
5. WHEN memory injection encounters an error THEN it SHALL log the error and proceed without memory context -- never block session start.

#### 5.2 Memory Context Format

##### Acceptance Criteria

1. WHEN memory context is injected THEN it SHALL follow a structured format:

   ```
   <session_memory>
   ## Recent File Activity
   - [timestamp] Read: src/services/auth.service.ts
   - [timestamp] Edited: src/services/auth.service.ts (added login validation)

   ## Previous Session Summary
   [Summary text from latest.md summary file]

   ## Known Issues
   - [timestamp] Error in src/utils/parser.ts: TypeError - cannot read property of undefined
   </session_memory>
   ```

2. WHEN formatting timestamps THEN they SHALL use relative time (e.g., "2 hours ago", "yesterday", "3 days ago").
3. WHEN file paths are displayed THEN they SHALL use workspace-relative paths.

#### 5.3 Memory MCP Namespace

**User Story:** As an AI agent during a session, I want to query my own session memory via the Ptah API, so that I can recall what I did in previous sessions without relying solely on injected context.

##### Acceptance Criteria

1. WHEN the `memory` namespace is accessed via `ptah.memory` THEN it SHALL expose: `searchMemory(query)`, `getRecentFiles(days)`, `getSessionSummaries(limit)`, `getFileHistory(filePath)`.
2. WHEN `ptah.memory.searchMemory(query)` is called THEN it SHALL delegate to `MemoryQueryService.searchByContent()` and return formatted results.
3. WHEN `ptah.memory.getRecentFiles(days)` is called THEN it SHALL delegate to `MemoryQueryService.getRecentlyTouchedFiles()` and return a list of file paths with last-touched timestamps.
4. WHEN `ptah.memory.getSessionSummaries(limit)` is called THEN it SHALL return the most recent session summaries read from `.claude/context/memory/summaries/`.
5. WHEN `ptah.memory.getFileHistory(filePath)` is called THEN it SHALL return the observation history for the specified file, read from session markdown files.
6. WHEN the memory system is unavailable THEN all namespace methods SHALL return empty results with an informative message.

---

### Requirement 6: Integration and Testing

**User Story:** As the development team, I want end-to-end validation that the Context Engine pillars work together correctly, so that we have confidence in the system before release.

#### 6.1 Live Code Graph Integration Tests

##### Acceptance Criteria

1. WHEN a file is edited in the workspace THEN within 500ms the dependency graph SHALL reflect the updated imports/exports (end-to-end: file save -> watcher event -> graph update -> verifiable query).
2. WHEN a new file is created with imports from existing files THEN the graph SHALL show the new dependency edges.
3. WHEN a file is deleted THEN the graph SHALL remove all edges to/from that file and the file node.
4. WHEN 10 files are modified rapidly (within 1 second) THEN the debounced update SHALL process all changes and the graph SHALL be consistent after settling.

#### 6.2 Session Memory Integration Tests

##### Acceptance Criteria

1. WHEN a session completes with file reads and edits THEN the observations SHALL be queryable from `SessionMemoryService` immediately after the flush interval fires.
2. WHEN a new session starts in the same workspace THEN the session start hook SHALL inject memory context from the previous session's observations read from `.claude/context/memory/sessions/`.
3. WHEN `ptah.memory.searchMemory("authentication")` is called THEN it SHALL return observations containing the word "authentication" from past session files.
4. WHEN the extension is restarted THEN previously stored observations SHALL be loadable from the persisted session markdown files in `.claude/context/memory/sessions/`.

#### 6.3 Performance Benchmarks

##### Acceptance Criteria

1. WHEN benchmarked THEN initial graph build for 280 TypeScript files SHALL complete in under 5 seconds.
2. WHEN benchmarked THEN incremental graph update for a single file change SHALL complete in under 200ms.
3. WHEN benchmarked THEN content search across 50 session files (average 100 observations each) SHALL return results in under 200ms.
4. WHEN benchmarked THEN observation buffer flush (appending 20 observations to a session file) SHALL complete in under 50ms.
5. WHEN benchmarked THEN memory context assembly for session start injection SHALL complete in under 100ms.
6. WHEN benchmarked THEN graph cache load from `.claude/context/graph/dependency-graph.json` SHALL complete in under 500ms.
7. WHEN benchmarked THEN session file listing and frontmatter parsing for 100 session files SHALL complete in under 300ms.

---

## Phasing Strategy

### Phase 1: Live Code Graph (Estimated: 2-3 days)

**Prerequisites:** TASK_2025_182 QA fixes complete.

**Deliverables:**

1. `DependencyGraphService.updateFile()` method -- incremental invalidate + re-parse + re-insert
2. `GraphFileWatcherService` -- connects `FileSystemManager` watchers to graph updates with debouncing
3. `LiveCodeGraphService` -- lifecycle manager (lazy init on first request, rebuild, dispose)
4. Wire `LiveCodeGraphService` into `ContextOrchestrationService` and `ContextSizeOptimizerService` (via existing `setDependencyGraph()`)
5. Unit tests for all new services

**Can run in parallel with Phase 2.**

### Phase 2: File-Based Context Storage (Estimated: 2-3 days)

**Prerequisites:** None (independent of Phase 1).

**Deliverables:**

1. `ContextStorageService` -- directory structure creation, session/summary/graph file read/write/list/prune using `fs/promises`
2. Session markdown file format with YAML frontmatter (via `gray-matter`, already a project dependency)
3. Summary markdown file format with rolling `latest.md` and daily snapshots
4. Graph cache JSON file write/read (dependency-graph.json, symbol-index.json)
5. Retention pruning with importance-aware retention periods
6. Context profile markdown files (bugfix.md, feature.md, review.md) under `.claude/context/profiles/`
7. Unit tests with temporary directory fixtures

### Phase 3: Session Memory (Estimated: 3-4 days)

**Prerequisites:** Phase 2 (file-based context storage must be functional).

**Deliverables:**

1. `ObservationExtractor` -- parse tool_use blocks into structured observations
2. `ObservationHookHandler` -- PostToolUse/PostToolUseFailure/SessionEnd hooks
3. `SessionMemoryService` -- facade for store/query with buffered batch flushes to session markdown files
4. `MemoryQueryService` -- content search via substring matching across session files, recency queries, file-path queries, error pattern queries, result caching
5. Wire hooks into `SdkQueryOptionsBuilder.createHooks()`
6. Retention pruning (30-day default, 60-day for high-importance)
7. Unit tests for all services

### Phase 4: Smart Context Curation (Estimated: 2-3 days)

**Prerequisites:** Phase 1 (graph) + Phase 3 (memory).

**Deliverables:**

1. `ContextProfileService` -- bugfix/feature/review profiles with scoring weights, loaded from `.claude/context/profiles/` markdown files
2. Enhanced `FileRelevanceScorerService` with graph proximity and memory signals
3. Extend `SessionStartHookHandler` for memory injection into system prompt
4. Add `memory` MCP namespace to `PtahAPIBuilder`
5. Unit tests for scoring with and without graph/memory signals

### Phase 5: Integration and Testing (Estimated: 2-3 days)

**Prerequisites:** All prior phases.

**Deliverables:**

1. End-to-end integration tests for graph updates
2. End-to-end integration tests for session memory capture and retrieval
3. Performance benchmarks for all critical operations
4. Graph cache persistence integration tests
5. Documentation updates to CLAUDE.md files for affected libraries

**Total Estimated Effort:** 11-16 days (2-3 weeks)

---

## Out of Scope

1. **Semantic embeddings or vector search** -- Substring matching over markdown files is sufficient for this iteration. Embedding-based retrieval is a future enhancement.
2. **Cross-workspace memory sharing** -- Observations are scoped to a single workspace's `.claude/context/` directory. Cross-workspace intelligence is a future enhancement.
3. **LLM-powered session summarization** -- Session summaries in this iteration are rule-based (files touched, key actions). LLM summarization is a Phase 2 enhancement.
4. **UI for memory inspection** -- No webview UI for browsing session memory. The MCP namespace (`ptah.memory`) and the human-readable markdown files are the inspection interfaces.
5. **Support for non-TypeScript/JavaScript languages** -- Graph and AST analysis are scoped to TS/JS. Other languages can be added later.
6. **Database storage** -- This system intentionally uses file-based storage (markdown + JSON) to avoid external dependencies and maintain inspectability. No SQLite, IndexedDB, or other database engines.

---

## Risk Assessment

### Technical Risks

| Risk                                                                        | Probability | Impact | Mitigation                                                                                                                                 | Contingency                                                                                                          |
| --------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Session file count grows large (1000+ files) causing slow directory listing | 20%         | Medium | 30-day retention with auto-pruning on activation. `MemoryQueryService` limits scan to most recent 100 files.                               | Archive old sessions into monthly rollup files. Add date-based subdirectories (e.g., `sessions/2026-03/`).           |
| Substring search across many session files is too slow                      | 15%         | Medium | Cache query results for 30 seconds. Limit scan to most recent session files. Summary files provide pre-aggregated data for common queries. | Add a lightweight index file (`sessions-index.json`) mapping file paths and keywords to session IDs for O(1) lookup. |
| Incremental graph updates introduce stale or inconsistent edges             | 30%         | Medium | Add content-hash checks to skip unchanged files. Comprehensive unit tests for edge cases (circular deps, re-exports).                      | Add periodic full rebuild every 5 minutes as consistency safety net.                                                 |
| PostToolUse hook adds observable latency to SDK responses                   | 10%         | Medium | Hook is fire-and-forget with buffered batch writes. Never awaited in the SDK pipeline.                                                     | Increase batch interval or reduce observation granularity.                                                           |
| Concurrent file writes to same session markdown file                        | 20%         | Medium | Buffer observations in memory and flush on interval. Single writer per session (serialized via flush queue).                               | Use write-to-temp-then-rename pattern for atomic file updates.                                                       |
| Tree-sitter call-graph queries produce too much noise                       | 40%         | Low    | Treat as best-effort signal with low weight. Skip if extraction fails.                                                                     | Remove call-graph signal entirely. Core functionality unaffected.                                                    |
| Concurrent file watcher events cause race conditions in graph updates       | 25%         | Medium | Debounce file events (100ms). Serialize `updateFile()` calls via queue.                                                                    | Use mutex/lock around graph mutation operations.                                                                     |
| gray-matter frontmatter parsing fails on edge cases                         | 10%         | Low    | Use try/catch around all frontmatter parsing. Files with invalid frontmatter are skipped or treated as corrupt.                            | Fall back to regex-based frontmatter extraction if gray-matter fails.                                                |

### Performance Risk Matrix

| Operation                                           | Expected | Acceptable Limit | Risk Level |
| --------------------------------------------------- | -------- | ---------------- | ---------- |
| Initial graph build (280 files)                     | ~2s      | < 5s             | Low        |
| Incremental graph update (1 file)                   | ~50ms    | < 200ms          | Low        |
| Session file write (append 20 observations)         | ~10ms    | < 50ms           | Low        |
| Session file listing (100 files, frontmatter parse) | ~100ms   | < 300ms          | Low        |
| Content search (50 session files)                   | ~50ms    | < 200ms          | Medium     |
| Memory context assembly                             | ~10ms    | < 100ms          | Low        |
| Graph cache write (JSON serialize + write)          | ~50ms    | < 200ms          | Low        |
| Graph cache load (JSON read + parse)                | ~100ms   | < 500ms          | Low        |
| Observation buffer flush                            | ~5ms     | < 50ms           | Low        |

---

## Success Metrics

### Functional Success

| Metric                                      | Target                                                  | Measurement Method                                                        |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Graph stays current after file changes      | 100% of changes reflected within 500ms                  | Integration test: file edit -> graph query                                |
| Observations captured for file reads/edits  | 95%+ capture rate                                       | Unit test: mock PostToolUse events -> verify observations in session file |
| Memory survives extension restart           | 100% persistence                                        | Integration test: store observations -> restart -> query session files    |
| Content search returns relevant results     | Top-5 results contain the target observation            | Manual testing with representative queries                                |
| Context profiles auto-detected from prompts | 80%+ accuracy on sample prompt set                      | Unit test with labeled prompt dataset                                     |
| Session files are human-readable            | 100% of files openable and parseable in any text editor | Manual review of generated session files                                  |

### Performance Success

| Metric                                            | Target             |
| ------------------------------------------------- | ------------------ |
| Graph build time (280 files)                      | < 5 seconds        |
| Incremental update time (1 file)                  | < 200ms            |
| Content search time (50 session files)            | < 200ms            |
| Memory context injection time                     | < 100ms            |
| Extension activation overhead from Context Engine | < 500ms additional |

### Quality Success

| Metric                                                   | Target                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Unit test coverage for new services                      | >= 80%                                                       |
| Zero `any` types in new code                             | 0 violations                                                 |
| Zero extension host crashes from Context Engine failures | All errors caught and logged                                 |
| Graceful degradation when subsystems unavailable         | Graph, memory, search each independently optional            |
| Zero external dependencies added                         | No new npm packages (uses existing fs/promises, gray-matter) |

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder               | Impact | Involvement                         | Success Criteria                                                    |
| ------------------------- | ------ | ----------------------------------- | ------------------------------------------------------------------- |
| AI Agents (end consumers) | High   | Automatic (receives better context) | More relevant files in context window, fewer re-reads of same files |
| Extension Users           | High   | Transparent (no UI changes)         | Faster, more accurate AI responses due to better context            |
| Development Team          | High   | Implementation                      | Clean architecture, testable services, clear DI boundaries          |

### Secondary Stakeholders

| Stakeholder                         | Impact | Involvement          | Success Criteria                                                           |
| ----------------------------------- | ------ | -------------------- | -------------------------------------------------------------------------- |
| Extension Host Runtime              | Medium | Resource consumption | No memory leaks, no activation slowdown, graceful error handling           |
| VS Code Marketplace                 | Low    | Packaging            | No native module dependencies, no WASM, single VSIX works on all platforms |
| Users inspecting `.claude/context/` | Low    | Debugging/inspection | Files are human-readable markdown, browsable in any editor                 |

---

## Dependencies

### Internal Dependencies

| Dependency                                              | Type                                                   | Status                 |
| ------------------------------------------------------- | ------------------------------------------------------ | ---------------------- |
| TASK_2025_182 QA fixes (contentOverrides, graph wiring) | Blocking for Phase 1                                   | In progress (parallel) |
| `DependencyGraphService`                                | Existing, needs `updateFile()` addition                | Available              |
| `FileSystemManager.createWatcher()`                     | Existing, ready to use                                 | Available              |
| `SdkQueryOptionsBuilder.createHooks()`                  | Existing, needs hook addition                          | Available              |
| `SessionStartHookHandler`                               | Existing, needs extension                              | Available              |
| `PtahAPIBuilder`                                        | Existing, needs new namespace                          | Available              |
| `ContextSizeOptimizerService.setDependencyGraph()`      | Existing, ready to wire                                | Available              |
| `AnalysisStorageService` (pattern reference)            | Pattern to follow for file-based storage               | Available              |
| `gray-matter`                                           | Existing project dependency (YAML frontmatter parsing) | Available              |

### External Dependencies

| Dependency                       | Version | Purpose                                    | Risk                                |
| -------------------------------- | ------- | ------------------------------------------ | ----------------------------------- |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.0  | PostToolUse hook events                    | Low -- already integrated           |
| `tree-sitter`                    | ^0.21.1 | AST parsing for call-graph queries         | Low -- already integrated           |
| `gray-matter`                    | ^4.0.3  | YAML frontmatter parsing for session files | Low -- already a project dependency |

**Note:** No new external dependencies are required. The file-based storage approach uses `fs/promises` (Node.js built-in) and `gray-matter` (already installed for `agent-generation` library).

---

## Architecture Notes for Software Architect

### Directory Structure

```
.claude/context/                                  # Root context directory (per workspace)
  graph/
    dependency-graph.json                         # Cached dependency graph (JSON)
    symbol-index.json                             # Cached symbol exports (JSON)
  memory/
    sessions/
      {session-id}.md                             # Per-session observations (markdown + frontmatter)
    summaries/
      latest.md                                   # Rolling summary (most recent session)
      {YYYY-MM-DD}.md                             # Daily snapshots
  profiles/
    bugfix.md                                     # Context profile weights (markdown + frontmatter)
    feature.md
    review.md
```

### File Placement

```
libs/backend/workspace-intelligence/src/
  graph/
    live-code-graph.service.ts              # NEW - Graph lifecycle manager
    graph-file-watcher.service.ts           # NEW - File watcher -> graph bridge
  ast/
    dependency-graph.service.ts             # MODIFY - Add updateFile() method
    tree-sitter.config.ts                   # MODIFY - Add call-graph queries (optional)
  context-analysis/
    context-profile.service.ts              # NEW - Task-type context profiles (reads profile .md files)
    file-relevance-scorer.service.ts        # MODIFY - Add graph + memory signals

libs/backend/agent-sdk/src/lib/
  storage/
    context-storage.service.ts              # NEW - File-based storage manager (.claude/context/)
    context-storage.types.ts                # NEW - Storage types (SessionFileMetadata, ObservationRecord, etc.)
  memory/
    session-memory.service.ts               # NEW - Observation storage facade
    observation-extractor.ts                # NEW - Tool_use -> observation parser
    memory-query.service.ts                 # NEW - File-based search and query service
  helpers/
    observation-hook-handler.ts             # NEW - PostToolUse/SessionEnd hooks
    session-start-hook-handler.ts           # MODIFY - Add memory injection
    sdk-query-options-builder.ts            # MODIFY - Wire observation hooks
```

### DI Registration Strategy

All new services should follow the existing tsyringe singleton pattern. New DI tokens needed in respective libraries:

- `workspace-intelligence`: `LIVE_CODE_GRAPH`, `GRAPH_FILE_WATCHER`, `CONTEXT_PROFILE`
- `agent-sdk`: `CONTEXT_STORAGE`, `SESSION_MEMORY`, `OBSERVATION_EXTRACTOR`, `MEMORY_QUERY`, `OBSERVATION_HOOK_HANDLER`

### Key Design Decisions for Architect

1. **File-based storage over database**: Uses `.claude/context/` directory with markdown + JSON files. Follows `AnalysisStorageService` pattern. No WASM, no native modules, no external dependencies. Files are human-readable and version-controllable.
2. **Graph build strategy**: Lazy-build on first context request, then incremental updates via watchers. Graph cached to JSON for fast reload.
3. **Observation granularity**: Start with file reads/edits/searches/errors. Expand later if needed.
4. **Memory retention**: 30-day rolling window, 60-day for high-importance observations. File-based pruning by deletion.
5. **Search strategy**: Substring matching over markdown file content. Cached results (30s TTL) to avoid redundant reads. Summary files provide pre-aggregated data for common patterns.
6. **Context profile detection**: Automatic from prompt keywords, with manual override capability. Profiles stored as editable markdown files.
7. **Error isolation**: Each pillar (graph, memory, curation) must function independently. Failure in one must not affect others.
8. **Frontmatter parsing**: Use `gray-matter` (already a project dependency in `agent-generation`) for YAML frontmatter in session/summary/profile files.
9. **Buffered writes**: Observations accumulate in memory and flush to disk on interval (5s default) to minimize I/O. Final flush on session end / extension deactivation.
10. **Atomic file writes**: Use write-to-temp-then-rename pattern for session files to prevent corruption from interrupted writes.
