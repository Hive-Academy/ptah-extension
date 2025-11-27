# Task Context for TASK_2025_015

## User Intent

Migrate proven code from roocode-generator project to ptah-extension to add:

1. **AST Parsing & Code Insights** → Enhance `workspace-intelligence` library
2. **Langchain Multi-Provider LLM** → Create NEW `llm-abstraction` library for internal commands
3. **Template Generation System** → Create NEW `template-generation` library for CLAUDE.md auto-generation

**Key Principle**: Copy & adapt existing battle-tested code (NOT build from scratch)

## Conversation Summary

**Previous Analysis**:

- Comprehensive comparative analysis completed (task-tracking/TASK_RESEARCH_ROOCODE_PATTERNS/)
- Identified 10 high-value transferable patterns from roocode-generator
- Created detailed migration plan (docs/ROOCODE_TO_PTAH_MIGRATION_PLAN.md)
- 28 files mapped with SOURCE → TARGET paths
- All adaptations documented (DI conversion, import changes, integration points)

**User Request**:

> "Copy over the code we need from roocode-generator to our workspace. We already have the analysis plan ready. Use it to enhance workspace-intelligence, add langchain LLM integration for internal commands (NOT main UI), and implement template generation for CLAUDE.md files."

**Critical Design Decisions**:

- ✅ Main chat UI stays Claude CLI (no changes)
- ✅ VS Code LM adapter becomes internal command (`ptah.callVsCodeLM`)
- ✅ Langchain providers for AI delegation (OpenAI, Google, Anthropic)
- ✅ AST parsing for 60% token reduction
- ✅ Template generation: Workspace → CLAUDE.md with tech-stack-specific content

## Technical Context

- **Branch**: feature/TASK_2025_015
- **Created**: 2025-11-23
- **Task Type**: REFACTORING (code migration + integration)
- **Complexity**: HIGH (28 files, 2 new libraries, DI integration, type alignment)
- **Estimated Duration**: 3-4 weeks (60-80 hours)

**Source Project**: D:\projects\roocode-generator
**Target Project**: D:\projects\ptah-extension

**Migration Plan**: docs/ROOCODE_TO_PTAH_MIGRATION_PLAN.md

## Execution Strategy

**REFACTORING STRATEGY** (with pre-existing architecture plan):

**Planned Agent Sequence**:

1. ~~project-manager~~ (SKIP - requirements clear from migration plan)
2. ~~software-architect~~ (SKIP - architecture already designed in migration plan)
3. **team-leader MODE 1** (DECOMPOSITION) → Reads migration plan, creates tasks.md with atomic migration tasks
4. **team-leader MODE 2** (ITERATIVE LOOP) → For each task:
   - Assigns to backend-developer (all work is backend)
   - Developer copies files, adapts code, integrates, commits git
   - team-leader verifies (git commit + files + tasks.md)
   - Repeat for next task
5. **team-leader MODE 3** (COMPLETION) → Final verification of all 28 files migrated
6. **USER CHOICE** → QA (tester/reviewer/both/skip)
7. **modernization-detector** → Future enhancements analysis

**Rationale for skipping PM/Architect**:

- Migration plan already contains detailed requirements (Section 1: File-by-File Migration Map)
- Architecture already designed (Section 2: New Library Creation Plan, Section 3: Existing Library Enhancements)
- Implementation sequence already planned (Section 5: Integration Sequence)
- All adaptations documented (Section 6: Code Adaptation Guidelines)

## Success Criteria

**Backend Libraries**:

- ✅ `libs/shared` enhanced with Result type, retry utilities, JSON utilities
- ✅ `libs/backend/workspace-intelligence` enhanced with AST parsing (6 new files)
- ✅ `libs/backend/llm-abstraction` created (NEW library - 15 files)
- ✅ `libs/backend/template-generation` created (NEW library - 12 files)

**Dependencies**:

- ✅ 10 npm packages installed (langchain, tree-sitter, etc.)
- ✅ All packages compatible with existing ptah stack

**Integration**:

- ✅ All DI conversions complete (roocode custom DI → tsyringe)
- ✅ All import paths updated to ptah conventions
- ✅ All services registered in DI container
- ✅ No breaking changes to existing features

**Quality**:

- ✅ TypeScript strict mode passes
- ✅ All files compile without errors
- ✅ Unit tests for migrated components (80% coverage target)
- ✅ E2E tests for new commands (ptah.callVsCodeLM)

## Related Work

- **TASK_RESEARCH_ROOCODE_PATTERNS**: Comparative analysis (✅ Complete)
- **TASK_2025_013**: Context Management Platform (will use workspace-intelligence enhancements)
- **docs/ptah-template-system-architecture.md**: Template system design (uses template-generation library)

## Risk Assessment

**HIGH RISK**:

- 28 files to migrate with complex DI integration
- 2 new libraries to create and integrate
- Type system alignment (roocode types → ptah types)
- Potential dependency conflicts (langchain versions)

**MITIGATION**:

- Phase-by-phase migration (Foundation → AST → LLM → Templates)
- Incremental testing after each file migration
- team-leader verification at each task completion
- User validation checkpoints (QA choice)
- Comprehensive migration plan as reference

## Pre-Existing Artifacts

- **Migration Plan**: D:\projects\ptah-extension\docs\ROOCODE_TO_PTAH_MIGRATION_PLAN.md
- **Research Report**: D:\projects\ptah-extension\task-tracking\TASK_RESEARCH_ROOCODE_PATTERNS\research-report.md
- **Executive Summary**: D:\projects\ptah-extension\task-tracking\TASK_RESEARCH_ROOCODE_PATTERNS\executive-summary.md
