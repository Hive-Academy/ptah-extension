# TASK_2025_183 - Ptah Context Engine (Re-Plan)

## Task Type: FEATURE

## Complexity: Complex

## Workflow: Partial (Architect -> Team-Leader -> Developers -> QA)

## Created: 2026-03-08

## Re-Plan Date: 2026-03-18

## User Request

Build a VS Code-native context intelligence system inspired by Claude-Mem (persistent session memory) and Augment's Context Engine (semantic code graph). Leverage the existing tree-sitter foundation, dependency graph, and agent SDK hooks to create a 3-pillar system:

1. **Live Code Graph** — Auto-updating dependency graph using file watchers + incremental parsing
2. **Session Memory** — Persistent memory across AI sessions (what files the AI read/changed, patterns learned, errors hit) stored as markdown files in `.claude/context/`
3. **Smart Context Curation** — Intelligent context selection using graph proximity, session memory signals, and task-type profiles

## Re-Planning Context (March 2026)

Since the original plan was written (TASK_2025_183, March 8), 20+ tasks have been completed (up to TASK_2025_205). The codebase has changed significantly:

### Major Changes Since Original Plan

1. **Platform Abstraction Layer** (Tasks 199-203):

   - New `libs/backend/platform-core/` — Platform-agnostic interfaces (IWorkspaceProvider, ISecretStorage, etc.)
   - New `libs/backend/platform-vscode/` — VS Code implementations
   - New `libs/backend/platform-electron/` — Electron implementations
   - New `libs/backend/rpc-handlers/` — Unified RPC handlers (platform-agnostic)
   - **Impact**: New Context Engine services MUST use platform-core interfaces, not direct VS Code APIs

2. **RPC Handler Unification** (Task 203):

   - Shared handler library means context engine RPC endpoints need one implementation
   - Tier 1-2 handlers are platform-agnostic

3. **Multi-Provider CLI Adapters**:

   - Gemini CLI (spawn-based), Codex SDK, Copilot SDK added alongside Claude SDK
   - **Impact**: Session memory hooks should work across all providers, not just Claude SDK

4. **File-Based Storage Pattern**:
   - `AnalysisStorageService` pattern well-established (markdown + JSON manifests + fs/promises)
   - **Decision**: Drop sql.js/SQLite. Use file-based storage matching existing patterns

### Current Completion Status

| Component                                     | Status       |
| --------------------------------------------- | ------------ |
| DependencyGraphService.buildGraph()           | DONE         |
| DependencyGraphService.invalidateFile()       | DONE         |
| DependencyGraphService.updateFile()           | NOT DONE     |
| ContextEnrichmentService                      | DONE         |
| ContextSizeOptimizerService (structural mode) | DONE         |
| LiveCodeGraphService (lifecycle)              | NOT DONE     |
| GraphFileWatcherService                       | NOT DONE     |
| FileSystemManager.handleWatcherEvent()        | STUB (no-op) |
| Graph cache persistence                       | NOT DONE     |
| Session Memory (entire pillar)                | 0%           |
| Smart Context Curation (entire pillar)        | 0%           |
| MCP memory namespace                          | NOT DONE     |

## Existing Foundation

- `DependencyGraphService` — Import-based file dependency tracking with invalidation
- `ContextEnrichmentService` — Structural summaries (.d.ts-style)
- `TreeSitterParserService` — Incremental parsing with LRU tree cache
- `FileRelevanceScorerService` — Symbol-aware relevance scoring
- `ContextSizeOptimizerService` — Token-budgeted structural optimization
- `FileSystemManager` — File watcher infrastructure with stub event handler
- `SessionHistoryReaderService` — JSONL session log reader
- `SdkQueryOptionsBuilder` — Hook merging for PostToolUse/SessionStart/SessionEnd
- `PtahAPIBuilder` — 16+ MCP namespaces
- `platform-core` — Platform-agnostic interfaces for cross-platform services
- `rpc-handlers` — Unified RPC handler library

## Storage Decision

File-based storage using `.claude/context/` (markdown + JSON manifests). Follows existing `AnalysisStorageService` pattern. No sql.js, no WASM, no SQLite.

## Affected Libraries

- `libs/backend/workspace-intelligence` (primary — graph lifecycle, context curation)
- `libs/backend/agent-sdk` (primary — session memory, observation hooks)
- `libs/backend/vscode-core` (secondary — file watcher event bridging)
- `libs/backend/vscode-lm-tools` (secondary — new `memory` MCP namespace)
- `libs/backend/platform-core` (interfaces if needed)
- `apps/ptah-extension-vscode` (consumption point)

## Original Research & Specs

- `task-description.md` — 58KB requirements document (still valid for requirements)
- `implementation-plan.md` — 77KB plan (OUTDATED — needs re-architecture)
- `research-report.md` — Detailed codebase audit (partially outdated)

## Strategy

FEATURE workflow: Architect -> Team-Leader -> Developers -> QA
Requirements still valid. Architecture needs fresh plan accounting for platform abstraction, multi-provider hooks, and file-based storage.
