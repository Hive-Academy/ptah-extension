# Development Tasks - TASK_2025_065

**Project**: Agent Generation System - Frontend Track
**Parent Task**: TASK_2025_058 (Intelligent Project-Adaptive Agent Generation System)
**Total Batches**: 4 (Batch 2A to 2D) | **Status**: 1/4 complete ✅
**Current**: Batch 2A - COMPLETE | **Next**: Batch 2B - Frontend Library Setup
**Execution Strategy**: Sequential frontend development (2A → 2B → 2C → 2D)
**Estimated Timeline**: 2-4 days per batch (total 9-13 days)

---

## 📋 Task Overview

This task implements the **frontend wizard UI and template assets** for the intelligent agent generation system. All batches extracted from TASK_2025_058 for focused frontend development.

**Completed Prerequisites** (from TASK_2025_058):

- ✅ Batch -1: Library scaffold (commits: 74e7630, d60c0c1, 92136d5)
- ✅ Batch 0: Type system + RPC message types (commit: 80a6f94)
- ✅ Batch 1: Core backend services (commit: 2ca2488)

**Full Implementation Details**: See `task-tracking/TASK_2025_058/tasks.md` (lines 874-1569)

---

## Batch 2A: Template Assets Creation ✅ COMPLETE

**Type**: CONTENT (Template Conversion)
**Developer**: backend-developer
**Tasks**: 2/2 ✅ | **Dependencies**: Batch 0 (COMPLETE)
**Can Run In Parallel With**: Backend batches 3A-3E
**Estimated Complexity**: Medium (2-3 days)
**Full Spec**: task-tracking/TASK_2025_058/tasks.md:874-1021

### Task 2A.1: Convert backend-developer to template ✅ COMPLETE

**File**: `extension/templates/agents/backend-developer.template.md` (725 lines)
**Pattern**: Hybrid syntax (HTML comments + Handlebars)
**Spec Reference**: research-report.md:128-232

**Implementation**: Converted `.claude/agents/backend-developer.md` (999 lines) to template format with:

- YAML frontmatter with applicabilityRules for Node/Python/Java/Go/DotNet/PHP/Ruby
- 8 STATIC sections (core principles, protocols, rules)
- 3 LLM sections (framework specifics, architecture, conventions)
- 1 VAR section (project context with conditional monorepo support)

### Task 2A.2: Convert frontend-developer to template ✅ COMPLETE

**File**: `extension/templates/agents/frontend-developer.template.md` (655 lines)
**Pattern**: Same hybrid syntax as backend-developer

**Implementation**: Converted `.claude/agents/frontend-developer.md` (1051 lines) to template format with:

- YAML frontmatter with applicabilityRules for React/Angular/Vue/Svelte
- 8 STATIC sections (UI principles, accessibility, quality standards)
- 3 LLM sections (framework specifics, UI patterns, styling)
- 1 VAR section (project context with design system support)

**Batch 2A Commit Format**:

```
feat(agent-generation): batch 2A - template assets

- Convert backend-developer and frontend-developer to template format
- Add YAML frontmatter with applicability rules
```

---

## Batch 2B: Frontend Library Setup ⏸️ PENDING

**Type**: FRONTEND INFRASTRUCTURE
**Developer**: frontend-developer **Tasks**: 3 | **Dependencies**: Batch 0 (RPC types - COMPLETE)
**Can Run In Parallel With**: Backend batches 3A-3E
**Estimated Complexity**: Low (1-2 days)
**Full Spec**: task-tracking/TASK_2025_058/tasks.md:1024-1145

### Task 2B.1: Create setup-wizard Angular library ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/`
**Pattern**: libs/frontend/chat (Angular library structure)
**Spec Reference**: implementation-plan.md:169-272

**Implementation**: Standalone Angular library, signal-based state, zoneless change detection, lazy-loadable components

### Task 2B.2: Create setup wizard state service ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`
**Pattern**: Signal-based state management

**Implementation**: WritableSignals for wizard steps, computed signals, type-safe wizard step tracking

### Task 2B.3: Create wizard RPC service ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`
**Pattern**: libs/frontend/core VSCodeService

**Implementation**: Type-safe RPC message sending, promise handling, error handling, timeout protection

**Batch 2B Commit Format**:

```
feat(setup-wizard): batch 2B - frontend library setup

- Create standalone Angular library with signal-based state
- Add wizard state and RPC services
```

---

## Batch 2C: Wizard Components (Steps 1-3) ⏸️ PENDING

**Type**: FRONTEND COMPONENTS
**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2B
**Can Run In Parallel With**: Backend batches 3A-3E
**Estimated Complexity**: Medium (3-4 days)
**Full Spec**: task-tracking/TASK_2025_058/tasks.md:1148-1325

### Task 2C.1: Build WelcomeComponent ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts`
**Pattern**: Standalone component + DaisyUI styling

**Implementation**: Hero layout, "Start Setup" button, RPC trigger, step transition

### Task 2C.2: Build ScanProgressComponent ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`
**Pattern**: Real-time progress updates

**Implementation**: Progress bar, file count display, live detection updates, cancel button

### Task 2C.3: Build AnalysisResultsComponent ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`
**Pattern**: Confirmation UI

**Implementation**: Display detected characteristics, user confirmation, manual adjustment link, proceed to selection

**Batch 2C Commit Format**:

```
feat(setup-wizard): batch 2C - wizard steps 1-3

- Implement Welcome, Scan Progress, Analysis Results components
- Add DaisyUI styling and signal-based reactivity
```

---

## Batch 2D: Wizard Components (Steps 4-6) ⏸️ PENDING

**Type**: FRONTEND COMPONENTS
**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2C
**Can Run In Parallel With**: Backend batches 3A-3E
**Estimated Complexity**: Medium (3-4 days)
**Full Spec**: task-tracking/TASK_2025_058/tasks.md:1328-1568

### Task 2D.1: Build AgentSelectionComponent ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`
**Pattern**: DaisyUI table with checkboxes

**Implementation**: Agent selection table, relevance scores, checkbox interactions, total count, generate button

### Task 2D.2: Build GenerationProgressComponent ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts`
**Pattern**: Per-item progress cards

**Implementation**: Per-agent progress display, live customization preview, real-time RPC updates, overall progress bar

### Task 2D.3: Build CompletionComponent ⏸️ PENDING

**File**: `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`
**Pattern**: Success hero layout

**Implementation**: Success message, generation summary, file structure preview, action buttons, useful tip

**Batch 2D Commit Format**:

```
feat(setup-wizard): batch 2D - wizard steps 4-6

- Implement Agent Selection, Generation Progress, Completion components
- Add DaisyUI tables/cards and real-time progress updates
```

---

## 📊 Progress Tracking

| Batch | Component                        | Status     | Commit SHA | Completed |
| ----- | -------------------------------- | ---------- | ---------- | --------- |
| 2A    | Template Assets (2 templates)    | ⏸️ PENDING | -          | -         |
| 2B    | Frontend Library Setup (3 files) | ⏸️ PENDING | -          | -         |
| 2C    | Wizard Steps 1-3 (3 components)  | ⏸️ PENDING | -          | -         |
| 2D    | Wizard Steps 4-6 (3 components)  | ⏸️ PENDING | -          | -         |

---

## 🎯 Success Criteria

### Quality Gates (All Batches)

- ✅ All components compile without TypeScript errors
- ✅ Signal-based state management (no RxJS BehaviorSubject)
- ✅ Zoneless change detection enabled
- ✅ DaisyUI styling applied consistently
- ✅ All 6 wizard steps functional (mock data acceptable)
- ✅ Git commit per batch with proper format

### UX Targets

- Wizard completion time: <4 minutes (including reading)
- Step transitions: <500ms
- Loading states displayed during async operations
- Error messages clear and actionable

---

## 🔗 Integration Dependencies

**This Task Blocks**:

- Integration Batch 5: Frontend-Backend Wiring (requires Batches 2B-2D + Backend 3C-3D)
- POC Batch 6: End-to-End Testing (requires complete wizard UI)

**This Task Depends On**:

- TASK_2025_058 Batch 0: RPC message types (✅ COMPLETE)
- libs/frontend/core: VSCodeService for RPC
- DaisyUI: Component styling library

---

## 📝 Development Notes

### Template Syntax Specification

Templates use **hybrid syntax** (HTML comments + Handlebars):

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

### Git Workflow

```bash
# For each batch
git checkout feature/sdk-only-migration
git pull --rebase

# Implement batch tasks
# ...

# One commit per batch
git add [batch-files]
git commit -m "feat(setup-wizard): batch {N} - {description}

- Task {N}.1: [description]
- Task {N}.2: [description]"

git push origin feature/sdk-only-migration
```

### Testing Strategy

```bash
# Run frontend library tests
npx nx test setup-wizard

# Run specific component test
npx nx test setup-wizard --testPathPattern=welcome.component.spec.ts

# Build library
npx nx build setup-wizard
```

---

**For complete implementation details, refer to**:

- Parent Task: task-tracking/TASK_2025_058/tasks.md (lines 874-1569)
- Implementation Plan: task-tracking/TASK_2025_058/implementation-plan.md
- Template Examples: task-tracking/TASK_2025_058/research-report.md
