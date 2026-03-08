# TASK_2025_182 - Deep Tree-Sitter Integration for AI Context Pipeline

## Task Type: FEATURE

## Complexity: Complex

## Workflow: Full (PM -> Architect -> Team-Leader -> Developers -> QA)

## Created: 2026-03-07

## User Request

Leverage the existing tree-sitter foundation in workspace-intelligence to actively enrich the AI context pipeline. Currently tree-sitter is a passive capability (available via MCP `ptah.ast.*` namespace) but not woven into the core context building flow.

## Key Features Requested

1. **Context Enrichment** - Extract function signatures and class outlines instead of sending full file contents, dramatically reducing token usage while preserving semantic understanding
2. **Smart Relevance Scoring** - Enhance FileRelevanceScorerService to use tree-sitter for symbol-aware file ranking (e.g., find files that export specific symbols)
3. **Dependency Graph** - Use import queries to build file dependency graphs for smarter context selection ("include files this file depends on")
4. **Incremental Parsing** - Leverage tree-sitter's incremental re-parsing on edits for real-time code understanding

## Existing Foundation

- `TreeSitterParserService` - Native C++ parser with caching, S-expression queries
- `AstAnalysisService` - Extracts CodeInsights (functions, classes, imports, exports)
- `tree-sitter.config.ts` - Language mappings + 4 pre-built queries for JS/TS
- MCP `ptah.ast.*` namespace in vscode-lm-tools (7 methods)
- Languages: JS/TS only currently (.js, .jsx, .ts, .tsx)

## Affected Libraries

- `libs/backend/workspace-intelligence` (primary - context-analysis/, file-indexing/, ast/)
- `libs/backend/vscode-lm-tools` (secondary - may need new MCP exposure)
- `apps/ptah-extension-vscode` (consumption point)

## Strategy

FEATURE workflow: PM -> [Research optional] -> Architect -> Team-Leader -> Developers -> QA
