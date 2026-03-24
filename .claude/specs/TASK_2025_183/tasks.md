# TASK_2025_183 - Ptah Context Engine - Development Tasks

**Total Tasks**: 24 | **Batches**: 7 | **Status**: 0/7 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- gray-matter dependency available in workspace-intelligence package.json: VERIFIED
- IFileSystemProvider.createFileWatcher() exists in platform-core: VERIFIED
- DependencyGraphService.invalidateFile() fully implemented: VERIFIED (lines 314-359)
- SubagentHookHandler/CompactionHookHandler hook pattern exists: VERIFIED
- AnalysisStorageService pattern for file storage: VERIFIED
- All 14 CREATE target files do NOT yet exist: VERIFIED
- namespace-builders directory exists with pattern files: VERIFIED

### Risks Identified

| Risk                                                                                           | Severity | Mitigation                                                                                    |
| ---------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| ContextOrchestrationService DI ordering - currently in Tier 5, LiveCodeGraphService in Tier 6d | MED      | Move ContextOrchestrationService registration after Tier 6d or use factory pattern (Task 4.3) |
| Incremental graph updates may introduce stale edges                                            | MED      | Content hash skip for unchanged files + comprehensive unit tests (Task 2.1)                   |
| Concurrent writes to same session file                                                         | MED      | In-memory buffer with single flush writer, serialized via interval (Task 3.2)                 |
| Multi-provider observation capture deferred                                                    | LOW      | Initial implementation covers Claude SDK only; clean extension point designed                 |

### Edge Cases to Handle

- [ ] Corrupt/malformed session files (gray-matter parse failure) -> Task 1.1
- [ ] Missing .claude/context/ directory on first run -> Task 1.1
- [ ] File watcher events arriving during graph build -> Task 2.2
- [ ] Empty/null observations from unrecognized tools -> Task 3.1
- [ ] Session file count exceeding 1000 -> Task 1.1 (pruning)
- [ ] Graph cache staleness after workspace file count changes -> Task 2.3

---

## Batch 1: Context Storage Foundation

**Status**: PENDING
**Developer**: backend-developer
**Dependencies**: None
**Tasks**: 4

### Task 1.1: Create ContextStorageService

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\context-storage.service.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\context-storage.service.spec.ts`

**Spec Reference**: implementation-plan.md lines 174-298

**Pattern to Follow**: `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts` (exact pattern for fs/promises, mkdir, try/catch, etc.)

**Description**:
Create the file-based storage service that manages all `.claude/context/` directories and files. This is the foundation for ALL other phases.

**Implementation Details**:

- Use `fs/promises` (mkdir, readdir, readFile, writeFile, rm, stat) - NOT vscode.workspace.fs
- Use `join()` for path construction
- Use `gray-matter` for YAML frontmatter parsing/serialization in session files
- `mkdir(path, { recursive: true })` for idempotent directory creation
- try/catch returning null on read failures
- Directory structure: `.claude/context/{graph/, memory/sessions/, memory/summaries/, profiles/}`
- Methods: initialize, writeSessionFile, readSessionFile, appendObservations, listSessionFiles, writeGraphCache, readGraphCache, writeSummary, readSummary, writeProfile, readProfile, pruneOldSessions

**Acceptance Criteria**:

- [ ] All CRUD methods implemented for session files, graph cache, summaries, and profiles
- [ ] YAML frontmatter parsing with gray-matter for session files
- [ ] Idempotent directory creation on initialize()
- [ ] Pruning with configurable retention period
- [ ] Error handling returns null on read failures (never throws)
- [ ] Spec file covers: CRUD ops, pruning, corrupt file handling, missing dirs, frontmatter edge cases
- [ ] Uses temp directory fixtures in tests

---

### Task 1.2: Create Observation Types

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\observation.types.ts`

**Spec Reference**: implementation-plan.md lines 520-543

**Description**:
Create the type definitions for observations and session summaries. Pure type file, no logic.

**Implementation Details**:

- ObservationType union: 'file_read' | 'file_edit' | 'search' | 'error' | 'decision'
- Observation interface: timestamp, type, filePath?, content?, importance
- SessionSummary interface: session_id, workspace_id, created_at, files_touched, key_decisions, summary_text
- All fields marked readonly

**Acceptance Criteria**:

- [ ] All types defined as specified in the plan
- [ ] All fields use readonly modifier
- [ ] Exported for use by other modules

---

### Task 1.3: Create Default Context Profiles

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\default-profiles\bugfix.md`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\default-profiles\feature.md`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\default-profiles\review.md`

**Spec Reference**: implementation-plan.md lines 259-283

**Description**:
Create the default context profile markdown files with YAML frontmatter containing scoring weights.

**Implementation Details**:

- Each profile: YAML frontmatter with name, description, weights object
- Weights: path_relevance, graph_proximity, memory_recency, memory_frequency, error_history, file_type
- bugfix: error_history=2.0, memory_recency=1.5
- feature: balanced weights (1.0 across the board, error_history=0.5)
- review: graph_proximity=1.5, memory_recency=1.2

**Acceptance Criteria**:

- [ ] Three profile files created with valid YAML frontmatter
- [ ] Weight values match the plan specification
- [ ] Parseable by gray-matter

---

### Task 1.4: DI Registration and Exports for Storage

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`

**Spec Reference**: implementation-plan.md lines 299-309

**Description**:
Register ContextStorageService in the DI container and export from the library barrel.

**Implementation Details**:

- Add `SDK_CONTEXT_STORAGE: Symbol.for('SdkContextStorage')` to SDK_TOKENS
- Register ContextStorageService as singleton in register.ts
- Export ContextStorageService, SessionFileMetadata, SessionFileContent, Observation, ObservationType, SessionSummary from index.ts

**Acceptance Criteria**:

- [ ] SDK_CONTEXT_STORAGE token added to SDK_TOKENS
- [ ] ContextStorageService registered as singleton
- [ ] All types and service exported from barrel file
- [ ] Build passes: `npx nx build agent-sdk`

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-sdk`
- code-logic-reviewer approved
- Edge cases from validation handled

---

## Batch 2: Dependency Graph Enhancements

**Status**: PENDING
**Developer**: backend-developer
**Dependencies**: None (independent of Batch 1)
**Tasks**: 3

### Task 2.1: Add updateFile() and getGraph() to DependencyGraphService

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.ts`

**Spec Reference**: implementation-plan.md lines 318-359

**Pattern to Follow**: Existing `invalidateFile()` at lines 314-359, `buildGraph()` parsing at lines 122-176

**Description**:
Add incremental file update capability and graph accessor to DependencyGraphService.

**Implementation Details**:

- `updateFile(filePath, workspaceRoot, tsconfigPaths?)`: normalize path, read file, compare content hash, invalidate old data, re-parse with astAnalysis.analyzeSource(), create FileNode, insert into graph.nodes, resolve imports, build edges, invalidate symbol index
- `getGraph(): DependencyGraph | null`: accessor for cache serialization
- Private `contentHashes: Map<string, string>` for content hash caching (simple string hash)
- Skip update if content hash unchanged

**Acceptance Criteria**:

- [ ] updateFile() incrementally re-parses a single file
- [ ] Content hash comparison skips unchanged files
- [ ] Old edges properly removed before new edges added
- [ ] Symbol index cache invalidated after update
- [ ] getGraph() returns the current graph or null
- [ ] No regressions in existing buildGraph/invalidateFile behavior

---

### Task 2.2: Create GraphFileWatcherService

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph-file-watcher.service.ts`

**Spec Reference**: implementation-plan.md lines 361-404

**Pattern to Follow**: Existing watcher patterns in workspace-intelligence (AgentDiscoveryService, CommandDiscoveryService)

**Description**:
Create a file watcher bridge that uses platform-core's IFileSystemProvider for cross-platform file watching with debounced batch delivery.

**Implementation Details**:

- Inject IFileSystemProvider via PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER
- Watch pattern: `**/*.{ts,tsx,js,jsx}`
- Debounce: collect events for 100ms, then call onBatch with merged set
- Event merging: last event wins (created+changed=changed, changed+deleted=deleted)
- startWatching(onBatch) and stopWatching() lifecycle methods
- Store IDisposable[] for cleanup

**Acceptance Criteria**:

- [ ] Uses IFileSystemProvider.createFileWatcher() (not VS Code API directly)
- [ ] 100ms debounce with event batching
- [ ] Event merging with last-event-wins semantics
- [ ] Clean disposal of watchers on stopWatching()
- [ ] Cross-platform compatible (no VS Code API imports)

---

### Task 2.3: Create LiveCodeGraphService

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\live-code-graph.service.ts`

**Spec Reference**: implementation-plan.md lines 406-468

**Description**:
Create the graph lifecycle manager that wraps DependencyGraphService with lazy initialization, auto-update via file watchers, and optional cache persistence.

**Implementation Details**:

- Inject DependencyGraphService, WorkspaceIndexerService, GraphFileWatcherService, IWorkspaceProvider, Logger
- ensureGraph(): lazy init - index workspace files, call buildGraph(), start watchers. Safe to call multiple times (idempotent).
- rebuild(): force full graph rebuild
- dispose(): stop watchers, release graph reference
- getGraphService(): return underlying DependencyGraphService
- Watcher onBatch: updateFile() for created/changed, invalidateFile() for deleted
- Graph cache persistence: after buildGraph(), fire-and-forget write to .claude/context/graph/. On ensureGraph(), try cache load first, validate freshness.
- Optional ContextStorageService dependency (skip caching if unavailable)
- Map serialization: Map -> Array of [key, value], Set -> Array

**Acceptance Criteria**:

- [ ] Lazy initialization with ensureGraph()
- [ ] File watcher integration for incremental updates
- [ ] Graph cache persistence (serialize/deserialize Maps)
- [ ] Cache freshness validation (file count + build timestamp)
- [ ] Clean disposal of watchers and resources
- [ ] Optional storage dependency (graceful degradation)

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved
- updateFile() handles edge cases (hash skip, new file, deleted file)

---

## Batch 3: Graph DI, Wiring, and Tests

**Status**: PENDING
**Developer**: backend-developer
**Dependencies**: Batch 2
**Tasks**: 4

### Task 3.1: DI Registration for Graph Services

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts`

**Spec Reference**: implementation-plan.md lines 491-504

**Description**:
Register graph services in DI and export from library barrel.

**Implementation Details**:

- Add to TOKENS: GRAPH_FILE_WATCHER_SERVICE = Symbol.for('GraphFileWatcherService'), LIVE_CODE_GRAPH_SERVICE = Symbol.for('LiveCodeGraphService')
- Register in workspace-intelligence/di/register.ts: Tier 6c for GraphFileWatcherService, Tier 6d for LiveCodeGraphService
- Export LiveCodeGraphService, GraphFileWatcherService from index.ts

**Acceptance Criteria**:

- [ ] Tokens added to TOKENS namespace
- [ ] Services registered in correct tier order (6c, 6d)
- [ ] Services exported from barrel file
- [ ] Build passes

---

### Task 3.2: Wire LiveCodeGraphService into ContextOrchestrationService

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context\context-orchestration.service.ts`

**Spec Reference**: implementation-plan.md lines 470-489, 1046-1048

**Description**:
Replace direct DependencyGraphService injection with LiveCodeGraphService in ContextOrchestrationService.

**Implementation Details**:

- Change @inject(TOKENS.DEPENDENCY_GRAPH_SERVICE) to @inject(TOKENS.LIVE_CODE_GRAPH_SERVICE)
- Change type from DependencyGraphService to LiveCodeGraphService
- Update setDependencyGraph() call: `this.contextSizeOptimizer.setDependencyGraph(this.liveCodeGraph.getGraphService())`
- Handle DI ordering: ContextOrchestrationService is in Tier 5, LiveCodeGraphService in Tier 6d. Move ContextOrchestrationService registration to after Tier 6d or use factory pattern.

**Validation Notes**:

- RISK: DI ordering conflict. ContextOrchestrationService currently registered in Tier 5 but will depend on Tier 6d service. Must reorder registration in register.ts.

**Acceptance Criteria**:

- [ ] LiveCodeGraphService injected instead of DependencyGraphService
- [ ] DI registration order corrected (no circular dependency)
- [ ] contextSizeOptimizer still receives graph service reference
- [ ] Build passes

---

### Task 3.3: Graph Unit Tests - DependencyGraphService

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.spec.ts`

**Spec Reference**: implementation-plan.md lines 506-510

**Description**:
Unit tests for the new updateFile() and getGraph() methods on DependencyGraphService.

**Implementation Details**:

- Mock AstAnalysisService for controlled parsing results
- Test updateFile(): invalidate + reparse cycle, content hash skip for unchanged, new file addition, edge updates
- Test getGraph(): returns graph or null

**Acceptance Criteria**:

- [ ] Tests for updateFile() with mock AST analysis
- [ ] Tests for content hash skip behavior
- [ ] Tests for getGraph() accessor
- [ ] All tests pass

---

### Task 3.4: Graph Unit Tests - Watcher and LiveCodeGraph

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\graph-file-watcher.service.spec.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\graph\live-code-graph.service.spec.ts`

**Spec Reference**: implementation-plan.md lines 506-510

**Description**:
Unit tests for GraphFileWatcherService and LiveCodeGraphService.

**Implementation Details**:

- GraphFileWatcherService: mock IFileSystemProvider, test debounce timing, event batching, multi-event merge
- LiveCodeGraphService: mock all dependencies, test lazy init, rebuild, dispose cleanup, cache load

**Acceptance Criteria**:

- [ ] Watcher tests: debounce, batching, event merge, disposal
- [ ] LiveCodeGraph tests: lazy init, rebuild, dispose, cache round-trip
- [ ] All tests pass

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved
- DI ordering validated (no circular deps)
- All unit tests pass

---

## Batch 4: Session Memory Core

**Status**: PENDING
**Developer**: backend-developer
**Dependencies**: Batch 1 (ContextStorageService)
**Tasks**: 4

### Task 4.1: Create ObservationExtractor

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\observation-extractor.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\observation-extractor.spec.ts`

**Spec Reference**: implementation-plan.md lines 545-586

**Description**:
Create pure function module for extracting structured observations from SDK tool events.

**Implementation Details**:

- extractObservation(toolName, toolInput, toolResult?, isError?): returns Observation or null
- normalizeFilePath(filePath, workspacePath): workspace-relative path
- formatObservationsAsMarkdown(observations): markdown string for session file append
- Extraction rules: Read->file_read(0.5), Edit/Write->file_edit(0.6), Bash with grep/find/rg->search(0.3), failure->error(0.8), other->null
- Pure functions, no class needed

**Acceptance Criteria**:

- [ ] Each tool type correctly mapped to observation type and importance
- [ ] Unknown tools return null (not error)
- [ ] File paths normalized to workspace-relative
- [ ] Markdown formatting matches session file format spec
- [ ] Spec covers all tool types, unknown tools, path normalization

---

### Task 4.2: Create ObservationHookHandler

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\observation-hook-handler.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\observation-hook-handler.spec.ts`

**Spec Reference**: implementation-plan.md lines 587-631

**Pattern to Follow**: `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts`, `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`

**Description**:
Create SDK hook handler that captures tool use events as observations and buffers them for periodic flush.

**Implementation Details**:

- createHooks(workspacePath, sessionId): returns Partial<Record<HookEvent, HookCallbackMatcher[]>>
- PostToolUse hook: extract observation via ObservationExtractor, buffer in memory
- SessionEnd hook: flush remaining observations, generate summary
- Buffer: Observation[] in memory, flush every 5 seconds via setInterval
- flush(): write buffered observations to session file via ContextStorageService.appendObservations()
- dispose(): clearInterval, flush remaining
- All hooks return { continue: true } (never block)
- Fire-and-forget callbacks (never await in hook)

**Acceptance Criteria**:

- [ ] Hooks follow SubagentHookHandler/CompactionHookHandler pattern
- [ ] Buffer/flush cycle with 5s interval
- [ ] SessionEnd triggers final flush
- [ ] All hooks return { continue: true }
- [ ] Error resilience (never throws in hook callback)
- [ ] Spec covers buffer/flush, SessionEnd, error resilience

---

### Task 4.3: Create SessionMemoryService

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\session-memory.service.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\session-memory.service.spec.ts`

**Spec Reference**: implementation-plan.md lines 633-657

**Description**:
Create the session memory facade that coordinates observation storage and retrieval.

**Implementation Details**:

- Inject ContextStorageService and MemoryQueryService
- addObservation(): delegate to storage
- flushObservations(): delegate to storage
- addSessionSummary(): write summary via storage
- getRecentObservations(): delegate to query service
- getFileHistory(): delegate to query service
- pruneOldObservations(): delegate to storage pruning

**Acceptance Criteria**:

- [ ] All methods delegate to appropriate underlying service
- [ ] Proper error handling (never throws, logs errors)
- [ ] Spec covers all delegation paths

---

### Task 4.4: Create MemoryQueryService

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\memory-query.service.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\memory-query.service.spec.ts`

**Spec Reference**: implementation-plan.md lines 659-688

**Description**:
Create file-based query service for searching session memory.

**Implementation Details**:

- Inject ContextStorageService
- searchByContent(): read session files, case-insensitive substring match, limit scan to 100 most recent
- getRecentlyTouchedFiles(): parse session files for file paths, deduplicate, sort by recency
- getFileObservations(): filter observations by file path
- getSessionSummaries(): read summary files
- getErrorPatterns(): count error observations per file
- Query cache: Map with 30s TTL per query key

**Acceptance Criteria**:

- [ ] Content search with case-insensitive matching
- [ ] Scan limited to 100 most recent session files
- [ ] 30-second query cache with TTL
- [ ] All query methods return correct results
- [ ] Spec covers content search, recency queries, cache TTL, error patterns

---

**Batch 4 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-sdk`
- code-logic-reviewer approved
- Buffer/flush mechanism tested
- Query cache TTL tested

---

## Batch 5: Session Memory DI and Hook Integration

**Status**: PENDING
**Developer**: backend-developer
**Dependencies**: Batch 4
**Tasks**: 3

### Task 5.1: DI Registration for Memory Services

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`

**Spec Reference**: implementation-plan.md lines 714-727

**Description**:
Register all session memory services in DI and export from library barrel.

**Implementation Details**:

- Add tokens: SDK_OBSERVATION_HOOK_HANDLER, SDK_SESSION_MEMORY, SDK_MEMORY_QUERY
- Register order: MemoryQueryService (depends on ContextStorageService), SessionMemoryService (depends on both), ObservationHookHandler (depends on ContextStorageService)
- Export all new services and types from index.ts

**Acceptance Criteria**:

- [ ] All tokens added to SDK_TOKENS
- [ ] Services registered in correct dependency order
- [ ] All services and types exported from barrel
- [ ] Build passes

---

### Task 5.2: Wire ObservationHookHandler into SdkQueryOptionsBuilder

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`

**Spec Reference**: implementation-plan.md lines 690-712

**Description**:
Integrate observation hooks into the SDK hook merging pipeline.

**Implementation Details**:

- Add ObservationHookHandler as constructor dependency via @inject(SDK_TOKENS.SDK_OBSERVATION_HOOK_HANDLER)
- In createHooks(): call this.observationHookHandler.createHooks(cwd, sessionId)
- Merge observation hooks into mergedHooks alongside subagent and compaction hooks
- Follow existing hook merging pattern (lines 737-743)

**Acceptance Criteria**:

- [ ] ObservationHookHandler injected via DI
- [ ] Observation hooks merged in createHooks()
- [ ] Existing hook behavior unaffected
- [ ] Build passes

---

### Task 5.3: Wire MemoryContextBuilder into System Prompt

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\memory-context-builder.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\memory-context-builder.spec.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`

**Spec Reference**: implementation-plan.md lines 874-924

**Description**:
Create the memory context builder that generates `<session_memory>` blocks for system prompt injection, and wire it into SdkQueryOptionsBuilder.

**Implementation Details**:

- MemoryContextBuilder: inject SessionMemoryService and MemoryQueryService
- buildMemoryContext(workspacePath, maxTokens=2000): build `<session_memory>` block with recent file activity, previous session summary, known issues
- Token budget: default 2000 tokens, truncate by dropping oldest observations first
- Returns empty string if no relevant memory
- Wire into SdkQueryOptionsBuilder: inject MemoryContextBuilder, call buildMemoryContext() in prompt building flow, append to system prompt if non-empty
- DI Token: SDK_TOKENS.SDK_MEMORY_CONTEXT_BUILDER = Symbol.for('SdkMemoryContextBuilder')

**Acceptance Criteria**:

- [ ] MemoryContextBuilder generates correct `<session_memory>` XML block
- [ ] Token budget respected with graceful truncation
- [ ] Empty string returned when no memory exists
- [ ] Wired into SdkQueryOptionsBuilder prompt assembly
- [ ] Token registered and service exported
- [ ] Spec covers format, truncation, empty memory

---

**Batch 5 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-sdk`
- code-logic-reviewer approved
- Hook integration does not break existing SDK pipeline
- Memory context appears in system prompt when observations exist

---

## Batch 6: Smart Context Curation

**Status**: PENDING
**Developer**: backend-developer
**Dependencies**: Batches 3 and 5 (graph + memory)
**Tasks**: 4

### Task 6.1: Create ContextProfileService

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-profile.service.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-profile.service.spec.ts`

**Spec Reference**: implementation-plan.md lines 744-803

**Description**:
Create the context profile service with hardcoded defaults and file-based overrides.

**Implementation Details**:

- DEFAULT_PROFILES: bugfix, feature, review with weights as specified
- getProfile(profileName): load from .claude/context/profiles/ if exists, fall back to defaults
- detectProfile(prompt): keyword matching (fix/bug/error->bugfix, implement/add/create->feature, review/check/audit->review, default->feature)
- listProfiles(workspacePath): list available profiles (defaults + custom)
- DI Token: TOKENS.CONTEXT_PROFILE_SERVICE = Symbol.for('ContextProfileService')

**Acceptance Criteria**:

- [ ] Three default profiles with correct weights
- [ ] File-based profile loading with fallback to defaults
- [ ] Keyword-based auto-detection
- [ ] Spec covers profile loading, detection, fallback

---

### Task 6.2: Enhance FileRelevanceScorerService with Graph and Memory Signals

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\file-relevance-scorer.service.ts`

**Spec Reference**: implementation-plan.md lines 805-838

**Description**:
Add graph proximity and session memory scoring signals to the existing file relevance scorer.

**Implementation Details**:

- Add optional params to scoreFile(): graphProximitySet, memorySignals, profile
- New MemorySignals interface: recentlyTouched Set, sessionRecency Map, errorFiles Set
- scoreByGraphProximity(): 1 hop = +0.3, 2 hops = +0.15
- scoreByMemory(): recency boost from map, error file boost +0.15
- Profile weight multiplication: each signal score \* profile.weights[signal]
- All new params optional - backward compatible, degrades gracefully

**Acceptance Criteria**:

- [ ] New scoring signals integrated without breaking existing callers
- [ ] Graph proximity scoring: 1-hop and 2-hop distances
- [ ] Memory signals: recency and error boosts
- [ ] Profile weight multiplication applied
- [ ] All existing tests still pass
- [ ] New tests for graph/memory scoring

---

### Task 6.3: Add Graph Proximity Building to ContextSizeOptimizerService

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-size-optimizer.service.ts`

**Spec Reference**: implementation-plan.md lines 840-872

**Description**:
Build graph proximity set in optimizeContext() and pass to the relevance scorer.

**Implementation Details**:

- Before ranking files, build graphProximitySet Map<string, number> from active file
- 1-hop: getDependencies(activeFilePath, 1) -> distance 1
- 2-hop: getDependencies(activeFilePath, 2) -> distance 2 (only if not already 1)
- Reverse: getDependents(activeFilePath) -> distance 1 (only if not already set)
- Add activeFilePath to ContextOptimizationRequest interface
- Pass graphProximitySet to relevanceScorer.scoreFile()/rankFiles()

**Acceptance Criteria**:

- [ ] Graph proximity set built from active file dependencies
- [ ] Both forward and reverse dependencies included
- [ ] Passed to scorer in ranking flow
- [ ] activeFilePath added to request interface
- [ ] Graceful when graph not available (skip proximity)

---

### Task 6.4: DI Registration for Curation Services

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`

**Spec Reference**: implementation-plan.md lines 964-977

**Description**:
Register ContextProfileService and MemoryContextBuilder in DI.

**Implementation Details**:

- Add CONTEXT_PROFILE_SERVICE to TOKENS (vscode-core)
- Add SDK_MEMORY_CONTEXT_BUILDER to SDK_TOKENS (agent-sdk)
- Register ContextProfileService in workspace-intelligence Tier 5
- Register MemoryContextBuilder in agent-sdk
- Export ContextProfileService from workspace-intelligence barrel

**Acceptance Criteria**:

- [ ] All tokens added
- [ ] Services registered in correct tiers
- [ ] Exports updated
- [ ] Build passes for both libraries

---

**Batch 6 Verification**:

- All files exist at paths
- Build passes: `npx nx build workspace-intelligence` and `npx nx build agent-sdk`
- code-logic-reviewer approved
- Scoring backward compatibility verified
- Profile detection tested

---

## Batch 7: MCP Integration, Documentation, and Final Wiring

**Status**: PENDING
**Developer**: backend-developer
**Dependencies**: Batch 6
**Tasks**: 3

### Task 7.1: Create Memory MCP Namespace

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\memory-namespace.builder.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts`

**Spec Reference**: implementation-plan.md lines 926-963

**Pattern to Follow**: Existing namespace builders in `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`

**Description**:
Create the MCP memory namespace exposing session memory to AI agents.

**Implementation Details**:

- buildMemoryNamespace(sessionMemoryService, memoryQueryService, workspacePath): returns object with searchMemory, getRecentFiles, getSessionSummaries, getFileHistory
- Add `memory` namespace to PtahAPI interface in types.ts
- Add memory namespace to PtahAPIBuilder (resolve services from container)
- Add memory namespace documentation to system prompt constant

**Acceptance Criteria**:

- [ ] Memory namespace builder follows existing pattern
- [ ] 4 methods exposed: searchMemory, getRecentFiles, getSessionSummaries, getFileHistory
- [ ] PtahAPI interface updated
- [ ] System prompt documentation updated
- [ ] Build passes: `npx nx build vscode-lm-tools`

---

### Task 7.2: Documentation Updates

**Status**: PENDING
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\CLAUDE.md`
- MODIFY: `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\CLAUDE.md`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\CLAUDE.md`

**Spec Reference**: implementation-plan.md lines 1012-1018

**Description**:
Update library documentation with new services, tokens, and architecture.

**Implementation Details**:

- workspace-intelligence CLAUDE.md: Add LiveCodeGraphService, GraphFileWatcherService, ContextProfileService, graph lifecycle docs
- agent-sdk CLAUDE.md: Add ContextStorageService, SessionMemoryService, ObservationHookHandler, MemoryContextBuilder docs
- vscode-lm-tools CLAUDE.md: Add memory namespace docs
- vscode-core CLAUDE.md: Add new TOKENS (GRAPH_FILE_WATCHER_SERVICE, LIVE_CODE_GRAPH_SERVICE, CONTEXT_PROFILE_SERVICE)

**Acceptance Criteria**:

- [ ] All new services documented in their library CLAUDE.md
- [ ] New tokens documented
- [ ] Architecture overview updated
- [ ] Integration patterns described

---

### Task 7.3: Integration Smoke Tests

**Status**: PENDING
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\storage\context-engine.integration.spec.ts`

**Spec Reference**: implementation-plan.md lines 988-1010

**Description**:
Integration tests verifying end-to-end flows across services.

**Implementation Details**:

- Session memory flow: mock PostToolUse events -> verify observations written to session file -> query back
- Memory persistence: store observations -> read from files -> verify content
- Content search: write observations with known keywords -> searchByContent returns them
- Memory injection: store observations -> build memory context -> verify output format
- Use temp directory fixtures for all file operations

**Acceptance Criteria**:

- [ ] Session memory capture flow tested end-to-end
- [ ] Memory persistence across simulated restart
- [ ] Content search returns correct results
- [ ] Memory context builder produces valid output
- [ ] All tests pass

---

**Batch 7 Verification**:

- All files exist at paths
- Build passes for all affected libraries
- code-logic-reviewer approved
- Integration tests pass
- Documentation complete
- ALL validation risks addressed

---

## Execution Order Summary

```
Batch 1 (Storage)          \
                             >-- Can run in parallel
Batch 2 (Graph Core)       /
         |                           |
         v                           v
Batch 3 (Graph DI+Tests)    Batch 4 (Memory Core)
         |                           |
         |                           v
         |                  Batch 5 (Memory DI+Hooks)
         |                           |
         +------------+--------------+
                      |
                      v
             Batch 6 (Curation)
                      |
                      v
             Batch 7 (MCP+Docs+Integration)
```

**Parallel execution opportunities**:

- Batches 1 and 2 can run simultaneously
- Batches 3 and 4 can run simultaneously (after their respective dependencies)
