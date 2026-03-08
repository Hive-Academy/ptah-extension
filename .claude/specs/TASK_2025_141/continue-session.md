# Continue TASK_2025_141 - Phase C & D Implementation

## Quick Start Command

```
/orchestrate TASK_2025_141
```

## Context Summary

TASK_2025_141 "Unified Project Intelligence with Code Quality Assessment" has completed **Phases A, B, and E** (foundation). The core infrastructure is built and tested:

### Completed (8 commits, ~6,572 lines)

- ✅ Quality Assessment Types (`@ptah-extension/shared`)
- ✅ DI Tokens and Service Interfaces
- ✅ Anti-Pattern Rule Engine (10 rules: TypeScript, error handling, architecture, testing)
- ✅ Core Assessment Services (AntiPatternDetection, CodeQualityAssessment)
- ✅ Unified ProjectIntelligenceService facade with caching
- ✅ DI Registration
- ✅ Comprehensive tests (136 passing)

### Remaining Work (Phases C & D)

**Phase C: Enhanced Prompts Integration** (2-3 days)

- Modify `PromptDesignerAgent` to consume `ProjectIntelligenceService`
- Add quality-aware prompt generation (prescriptive guidance)
- Implement reliable workflow pattern (template + LLM + 3-tier validation)

**Phase D: Agent Generation Integration** (2-3 days)

- Modify `DeepProjectAnalysisService` to use unified `ProjectIntelligenceService`
- Eliminate duplicate workspace detection logic
- Feed quality assessment into agent customization

## Key Files for Phase C

### To Modify

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer-agent.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts.service.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-cache.service.ts`

### To Reference (New Infrastructure)

- `libs/backend/workspace-intelligence/src/quality/services/project-intelligence.service.ts` - Main facade
- `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts` - Interfaces
- `libs/shared/src/lib/types/quality-assessment.types.ts` - Type definitions
- `libs/shared/src/lib/types/reliable-workflow.types.ts` - Workflow pattern types

## Key Files for Phase D

### To Modify

- `libs/backend/agent-generation/src/lib/services/wizard/deep-analysis.service.ts`
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`

## Unstaged Changes (From Earlier Session)

There are unstaged changes from an earlier session that should be committed first:

- Settings page cleanup (removed broken promptHarness components)
- Setup wizard Enhanced Prompts integration

Run `git status` to see all unstaged changes.

## Documentation References

- `task-tracking/TASK_2025_141/implementation-plan.md` - Full architecture spec
- `task-tracking/TASK_2025_141/research-report.md` - Analysis of existing systems
- `task-tracking/TASK_2025_141/future-enhancements.md` - Phase C/D details
- `task-tracking/TASK_2025_141/tasks.md` - Completed task checklist

## Architecture Diagram

```
ProjectIntelligenceService (workspace-intelligence) ← NEW, COMPLETED
    ├── WorkspaceContext (project detection)
    ├── QualityAssessment (anti-pattern analysis)
    │   ├── CodeQualityAssessmentService
    │   ├── AntiPatternDetectionService
    │   └── RuleRegistry (10 rules)
    └── PrescriptiveGuidance (recommendations)
                ↓
    ┌───────────────────────────────────────┐
    │                                       │
    ▼                                       ▼
Enhanced Prompts (Phase C)         Agent Generation (Phase D)
- PromptDesignerAgent              - DeepProjectAnalysisService
- Adopt reliable workflow          - Consume unified service
- Quality-aware prompts            - Eliminate duplication
```

## Expected Outcome

After Phases C & D:

- **Expert users**: Get validated best practices (same as before)
- **Novice users**: Get corrective guidance based on detected anti-patterns in their actual code
- **No duplicate analysis**: Single `ProjectIntelligenceService` used by both systems
