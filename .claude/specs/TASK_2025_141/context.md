# TASK_2025_141: Unified Project Intelligence with Code Quality Assessment

## Task Context

**Created**: 2026-02-05
**Strategy**: FEATURE (major architectural enhancement)
**Complexity**: High (multi-phase, affects 3 libraries, 2 systems)
**Dependencies**: Supersedes TASK_2025_139

## User Request

> "So if we step back one step earlier with all the information we already gathered, the enhancement we need to intelligently apply based on the well-architected and supported pattern for say, if our agent generation has most reliable and also intelligent work of flow, we need to generalize that with an enhanced prompt with also adding a proper step which I think should be the first initial when we detect actually what the user is doing and if he is already following best practices or not to be applied to also both agents' output and also enhanced prompt output."

## Problem Statement

Currently, the system has two parallel intelligence systems that:

1. **Agent Generation** (~60% hardcoded + 40% LLM):

   - Has reliable template backbone with LLM customization
   - Performs deep workspace analysis (samples actual source files)
   - Uses 3-tier validation (schema 40pts + safety 30pts + factual 30pts, threshold ≥70)
   - Generates framework-specific content based on detected context

2. **Enhanced Prompts** (~30% hardcoded + 70% LLM):
   - Only reads metadata (package.json dependencies, project type)
   - Never sees actual source code
   - Generates rules based on "what framework you use" not "how well you use it"
   - Weaker fallback (generic guidance)

**Critical Gap**: Neither system detects whether the user follows best practices. For novice users with anti-patterns, the systems reinforce bad habits instead of teaching better approaches.

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 0: Code Quality Assessment (NEW)                         │
│  - Sample actual source files (components, services, etc.)      │
│  - Detect anti-patterns, architectural smells                   │
│  - Score adherence to framework best practices                  │
│  - Output: QualityAssessment { score, antiPatterns[], gaps[] }  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  ProjectIntelligenceService (unified, in workspace-intelligence)│
│  - Workspace detection (frameworks, dependencies) [existing]    │
│  - Code quality assessment (from Phase 0) [new]                 │
│  - Single source of truth for both systems                      │
└─────────────────────────────────────────────────────────────────┘
                    ↓                       ↓
        ┌───────────────────┐     ┌───────────────────┐
        │  Agent Generation │     │  Enhanced Prompts │
        │  (existing flow)  │     │  (adopt reliable  │
        │                   │     │   workflow)       │
        └───────────────────┘     └───────────────────┘
```

## Key Design Decisions

1. **Generalize Agent Generation's reliable workflow** for reuse by Enhanced Prompts:

   - Template backbone + LLM customization pattern
   - 3-tier validation with retry
   - Graceful fallback cascade

2. **Code Quality Assessment as first-class citizen**:

   - LLM-powered analysis of actual source code samples
   - Detect deviations from framework best practices
   - Generate prescriptive (corrective) guidance, not just descriptive

3. **Unified ProjectIntelligenceService**:
   - Located in `workspace-intelligence` library
   - Single source of truth for project context + quality assessment
   - Consumed by both Agent Generation and Enhanced Prompts

## Expected Outcomes

| Scenario                       | Current Behavior          | New Behavior                                 |
| ------------------------------ | ------------------------- | -------------------------------------------- |
| Expert user with clean code    | Good rules                | Same (validated as following best practices) |
| Novice user with anti-patterns | Bad - reinforces mistakes | Detects gaps, generates corrective guidance  |

## Affected Libraries

- `libs/backend/workspace-intelligence` - New ProjectIntelligenceService
- `libs/backend/agent-generation` - Consume unified service
- `libs/backend/agent-sdk` - Enhanced Prompts adopts reliable workflow

## Planned Agent Sequence

1. **project-manager** - Detailed requirements, scope boundaries, success criteria
2. **researcher-expert** - Deep analysis of current implementations, identify reusable patterns
3. **software-architect** - Unified architecture design, interface contracts
4. **team-leader** - Task decomposition across 3 libraries
5. **backend-developer** - Implementation
6. **code-style-reviewer + code-logic-reviewer** - Quality assurance
