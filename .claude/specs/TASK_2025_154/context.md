# TASK_2025_154: Multi-Phase Analysis & Elevation Workflow

## User Intent

Replace the current single-JSON shallow analysis with a comprehensive, multi-file analysis system that produces structured, actionable insights. Each analysis phase builds on the previous, all utilizing the Agent SDK's InternalQueryService. The analysis feeds into agent generation and enhanced prompt creation for a true "codebase elevation" workflow.

## Strategy: FEATURE (Full Flow)

PM -> Architect -> Team-Leader -> Developers -> QA

## Complexity: Complex (7 interconnected steps, architecture redesign)

## Key Context

- Current system: 1 agent call → 1 flat JSON → lossy text summary → generic templates
- Target system: Multi-phase pipeline → structured markdown files → agents read files via MCP → specific templates
- Existing infrastructure: InternalQueryService, SdkStreamProcessor, MCP tools (15 namespaces), 13 agent templates
- Branch: feature/sdk-only-migration

## The 7-Step Pipeline

1. **Project Profile** - Pure facts: tech stack, dependencies, file structure, entry points
2. **Architecture Assessment** - Structural evaluation: patterns, dependency flow, coupling, violations
3. **Quality Audit** - File-level deep-dive: anti-patterns, type safety, error handling, security
4. **Elevation Plan** - Prioritized actionable improvements with before/after examples
5. **Agent Context Synthesis** - Combines phases 1-4 into agent-digestible context
6. **Agent Generation** - Uses rich analysis to generate project-specific agent templates
7. **Prompt Enhancement** - Uses analysis to generate enhanced system prompts

## Dependencies

- Builds on: TASK_2025_141 (Unified Project Intelligence), TASK_2025_148 (Generation Pipeline), TASK_2025_150 (Stream Broadcasting)
- Related: TASK_2025_137 (Enhanced Prompts), TASK_2025_153 (Plugin Configuration)

## Created: 2026-02-14

## Status: Implementation complete - All 4 batches done, build passing, code review fixes applied
