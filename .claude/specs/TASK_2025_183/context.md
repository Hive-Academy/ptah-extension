# TASK_2025_183 - Ptah Context Engine

## Task Type: FEATURE

## Complexity: Complex

## Workflow: Full (PM -> Architect -> Team-Leader -> Developers -> QA)

## Created: 2026-03-08

## User Request

Build a VS Code-native context intelligence system inspired by Claude-Mem (persistent session memory) and Augment's Context Engine (semantic code graph). Leverage the existing tree-sitter foundation, dependency graph, and agent SDK hooks to create a 3-pillar system:

1. **Live Code Graph** — Auto-updating dependency graph using file watchers + incremental parsing
2. **Session Memory** — Persistent memory across AI sessions (what files the AI read/changed, patterns learned, errors hit) stored as markdown files in `.claude/context/`
3. **Smart Context Curation** — Intelligent context selection using graph proximity, session memory signals, and task-type profiles

## Existing Foundation (from TASK_2025_182)

- `DependencyGraphService` — Import-based file dependency tracking with invalidation
- `ContextEnrichmentService` — Structural summaries (.d.ts-style)
- `TreeSitterParserService` — Incremental parsing with LRU tree cache
- `FileRelevanceScorerService` — Symbol-aware relevance scoring
- `ContextSizeOptimizerService` — Token-budgeted structural optimization
- `FileSystemManager` — File watcher infrastructure with stub event handler
- `SessionHistoryReaderService` — JSONL session log reader
- `SdkQueryOptionsBuilder` — Hook merging for PostToolUse/SessionStart/SessionEnd
- `PtahAPIBuilder` — 16 MCP namespaces

## Research Phase

Research completed — see `research-report.md` in this folder.

Key findings:

- 60-70% of foundation already exists
- File-based storage using `.claude/context/` (markdown + JSON) — follows existing `AnalysisStorageService` pattern
- Zero new external dependencies (uses `fs/promises` + existing `gray-matter`)
- 5 phases over 2-3 weeks

## Storage Decision (User Override)

User explicitly rejected the SQLite/sql.js/WASM approach from the research phase. Rationale:

- Existing patterns (`.claude/analysis/`, task-tracking, skills) prove file-based intelligence works
- Markdown files are inspectable, debuggable, and version-controllable
- No WASM loading risk, no native module risk, no new dependencies
- Agent can natively Read/Grep markdown files

**Architecture**: `.claude/context/` with `graph/` (JSON cache), `memory/sessions/` (session markdown), `memory/summaries/` (rolling summaries), `profiles/` (context scoring profiles)

## Affected Libraries

- `libs/backend/workspace-intelligence` (primary — graph lifecycle, context curation)
- `libs/backend/agent-sdk` (primary — session memory, observation hooks, file-based storage)
- `libs/backend/vscode-core` (secondary — file watcher event bridging)
- `libs/backend/vscode-lm-tools` (secondary — new `memory` MCP namespace)
- `apps/ptah-extension-vscode` (consumption point)

## Strategy

FEATURE workflow: PM -> Architect -> Team-Leader -> Developers -> QA
Research phase complete. PM task description revised with file-based approach. Next: User validation, then Architect.
