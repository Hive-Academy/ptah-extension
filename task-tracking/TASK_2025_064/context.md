# Task Context - TASK_2025_064

## User Intent

Implement **Backend Track** of the Intelligent Project-Adaptive Agent Generation System - specifically the 5 parallel backend service batches (3A-3E) that power agent customization and selection.

**Parent Task**: TASK_2025_058 (split for parallel development)

## Core Objective

Build the backend services that enable intelligent agent generation:

1. **AgentSelectionService** (Batch 3A) - Relevance scoring algorithm (0-100 scale)
2. **VsCodeLmService** (Batch 3B) - VS Code LM API integration for LLM customization
3. **AgentCustomizationService** (Batch 3C) - LLM-powered template section customization
4. **SetupWizardService** (Batch 3D) - Backend orchestration for setup wizard
5. **AgentGenerationOrchestratorService** (Batch 3E) - End-to-end workflow coordination

## Technical Context

- **Branch**: feature/sdk-only-migration (shared with parent task)
- **Created**: 2025-12-10
- **Type**: FEATURE (Backend Services Implementation)
- **Complexity**: High (5 parallel batches, 4-5 days each)
- **Parent Task**: TASK_2025_058

## Prerequisites (from TASK_2025_058)

✅ **Completed**:

- Batch -1: Library scaffold + VS Code LM Provider (commits: 74e7630, d60c0c1, 92136d5)
- Batch 0: Type system (13 types), DI tokens (9), Interfaces (6), Errors (6) - commit: 80a6f94
- Batch 1: Core services (TemplateStorage, FileWriter, OutputValidation, ContentGeneration) - commit: 2ca2488

## Batches in This Task

### Batch 3A: AgentSelectionService ⏸️ PENDING

- **Tasks**: 2 (Service + Unit tests)
- **Pattern**: workspace-intelligence FileRelevanceScorerService
- **Estimated**: 2-3 days

### Batch 3B: VsCodeLmService ⏸️ PENDING

- **Tasks**: 2 (Service + Integration tests)
- **Pattern**: NEW - VS Code LM API integration
- **Estimated**: 4-5 days (HIGH complexity)

### Batch 3C: AgentCustomizationService ⏸️ PENDING

- **Tasks**: 2 (Service + Unit tests)
- **Pattern**: Facade wrapping ptah.ai.invokeAgent()
- **Estimated**: 3-4 days

### Batch 3D: SetupWizardService ⏸️ PENDING

- **Tasks**: 2 (Service + RPC handlers)
- **Pattern**: WebviewProvider + RPC Message Handler
- **Estimated**: 3-4 days

### Batch 3E: AgentGenerationOrchestratorService ⏸️ PENDING

- **Tasks**: 2 (Service + Integration tests)
- **Pattern**: Service Orchestration with Transaction Management
- **Estimated**: 3-4 days

## Parallelization Strategy

**Key Insight**: All 5 batches (3A-3E) can run 100% in parallel because they have:

- No inter-batch dependencies
- Only depend on Batch 1 (already complete)
- Independent file locations
- Separate test suites

**Time Savings**: 4-6 weeks saved vs sequential execution

## Integration Points

**Dependencies FROM This Task**:

- Frontend Batch 5 (Frontend-Backend Wiring) requires batches 3D, 3E
- POC Batch 6 (End-to-End Testing) requires all backend batches complete

**Dependencies ON This Task**:

- Batch 1: Core services (COMPLETE)
- Implementation plan: task-tracking/TASK_2025_058/implementation-plan.md
- Type system: libs/backend/agent-generation/src/lib/types/

## Success Criteria

### Quality Gates

- ✅ All 5 services compile without errors
- ✅ Unit test coverage >80% for each service
- ✅ Integration tests pass for LLM services (3B, 3C)
- ✅ All services registered in DI container
- ✅ Result pattern used consistently

### Performance Targets

- AgentSelectionService: Score 100 agents in <5 seconds
- VsCodeLmService: 95% of requests complete in <10 seconds
- AgentCustomizationService: Batch processing with 5 concurrent requests
- SetupWizardService: State transitions complete in <500ms
- OrchestratorService: End-to-end generation in <3 minutes

## Execution Strategy

**Recommended Approach**: Implement batches in order (3A → 3B → 3C → 3D → 3E) for logical dependencies, BUT each batch can be developed independently by different developers if needed.

**Git Strategy**: One commit per batch with format:

```
feat(agent-generation): batch {N} - {description}

- Task {N}.1: [description]
- Task {N}.2: [description]
```

## Related Tasks

- **TASK_2025_058**: Parent task (strategic planning complete)
- **TASK_2025_065**: Frontend track (Batches 2A-2D) - can run in parallel
- **Future**: Integration batches 4-6 after both tracks complete
