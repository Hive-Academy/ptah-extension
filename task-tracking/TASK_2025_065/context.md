# Task Context - TASK_2025_065

## User Intent

Implement **Frontend Track** of the Intelligent Project-Adaptive Agent Generation System - specifically the setup wizard UI components and template asset creation (Batches 2A-2D).

**Parent Task**: TASK_2025_058 (split for parallel development)

## Core Objective

Build the frontend components and template assets for the setup wizard:

1. **Template Assets** (Batch 2A) - Convert backend-developer.md and frontend-developer.md to template format
2. **Frontend Library Setup** (Batch 2B) - Create setup-wizard Angular library with state services
3. **Wizard Steps 1-3** (Batch 2C) - Welcome, Scan Progress, Analysis Results components
4. **Wizard Steps 4-6** (Batch 2D) - Agent Selection, Generation Progress, Completion components

## Technical Context

- **Branch**: feature/sdk-only-migration (shared with parent task)
- **Created**: 2025-12-10
- **Type**: FEATURE (Frontend Components + Template Assets)
- **Complexity**: Medium (4 batches, Angular + DaisyUI)
- **Parent Task**: TASK_2025_058

## Prerequisites (from TASK_2025_058)

✅ **Completed**:

- Batch -1: Library scaffold + Content Processor utilities
- Batch 0: Type system, RPC message types, DI tokens
- Batch 1: Core backend services (TemplateStorage can load templates)

## Batches in This Task

### Batch 2A: Template Assets Creation ⏸️ PENDING

- **Tasks**: 2 (backend-developer.template.md + frontend-developer.template.md)
- **Pattern**: Hybrid syntax (HTML comments + Handleb ars)
- **Estimated**: 2-3 days

### Batch 2B: Frontend Library Setup ⏸️ PENDING

- **Tasks**: 3 (Angular library + State service + RPC service)
- **Pattern**: Standalone Angular, Signal-based state, Zoneless
- **Estimated**: 1-2 days

### Batch 2C: Wizard Components (Steps 1-3) ⏸️ PENDING

- **Tasks**: 3 (WelcomeComponent + ScanProgressComponent + AnalysisResultsComponent)
- **Pattern**: DaisyUI styling, Signal-based reactivity
- **Estimated**: 3-4 days

### Batch 2D: Wizard Components (Steps 4-6) ⏸️ PENDING

- **Tasks**: 3 (AgentSelectionComponent + GenerationProgressComponent + CompletionComponent)
- **Pattern**: DaisyUI tables/cards, Real-time progress updates
- **Estimated**: 3-4 days

## Parallelization Strategy

**Key Insight**: Batches 2A-2D have some internal dependencies but can run in parallel with TASK_2025_064 (backend track):

**Dependencies**:

- Batch 2A → No dependencies (can start immediately)
- Batch 2B → Depends on Batch 0 (RPC types - COMPLETE)
- Batch 2C → Depends on Batch 2B
- Batch 2D → Depends on Batch 2C

**Parallel Execution**: All frontend batches can run in parallel with backend batches 3A-3E

## Integration Points

**Dependencies FROM This Task**:

- Batch 5 (Frontend-Backend Wiring) requires Batches 2B-2D + Backend 3D-3E
- POC Batch 6 requires complete wizard UI

**Dependencies ON This Task**:

- Batch 0: RPC message types (COMPLETE)
- libs/frontend/core: VSCodeService for RPC communication
- DaisyUI: Component styling library

## Success Criteria

### Quality Gates

- ✅ All components compile without errors
- ✅ Signal-based state management (no RxJS)
- ✅ Zoneless change detection enabled
- ✅ DaisyUI styling applied consistently
- ✅ All 6 wizard steps functional (mock data OK)

### UX Targets

- Wizard completion time: <4 minutes (including reading)
- Step transitions: <500ms
- Loading states displayed during async operations
- Error messages clear and actionable

## Template Syntax Specification

Templates use **hybrid syntax**:

```markdown
---
templateId: agent-name-v1
templateVersion: 1.0.0
applicabilityRules:
  projectTypes: [Node, Python]
  minimumRelevanceScore: 60
---

<!-- STATIC:CORE_PRINCIPLES -->

[Hardcoded content that never changes]

<!-- /STATIC:CORE_PRINCIPLES -->

<!-- LLM:FRAMEWORK_SPECIFICS -->

{{GENERATED_CONTENT}}

<!-- /LLM:FRAMEWORK_SPECIFICS -->

<!-- VAR:PROJECT_CONFIG -->

Project: {{PROJECT_NAME}}

<!-- /VAR:PROJECT_CONFIG -->
```

## Execution Strategy

**Recommended Order**: 2A → 2B → 2C → 2D (sequential within frontend track)

**Git Strategy**: One commit per batch:

```
feat(setup-wizard): batch {N} - {description}

- Task {N}.1: [description]
- Task {N}.2: [description]
```

## Related Tasks

- **TASK_2025_058**: Parent task (strategic planning complete)
- **TASK_2025_064**: Backend track (Batches 3A-3E) - runs in parallel
- **Future**: Integration batches 4-6 after both tracks complete
