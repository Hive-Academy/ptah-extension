# Task Context - TASK_2025_111

## User Intent

Enhance the setup wizard to deeply analyze projects using Ptah MCP server and generate tailored Claude orchestration configurations (agents, commands, skills) based on project characteristics.

## Core Objective

Transform the setup wizard from basic agent file generation to intelligent, MCP-powered orchestration setup:

1. **Deep Project Analysis** using Ptah MCP namespaces:

   - `ptah.workspace.getProjectInfo()` - Project structure
   - `ptah.workspace.analyzeArchitecture()` - Architecture patterns
   - `ptah.search.findFiles()` - Key files discovery
   - `ptah.symbols.getWorkspaceSymbols()` - Code structure
   - `ptah.diagnostics.getProblems()` - Existing issues

2. **Intelligent Generation** of Claude configs:

   - `.claude/agents/*.md` - All 13 agent templates, customized per project
   - `.claude/commands/*.md` - Orchestrate + project-specific commands
   - `.claude/skills/orchestration/` - The orchestration skill (from TASK_2025_110)
   - Project-specific context embedded in each file

3. **Premium Feature Gating**:
   - License check before wizard access
   - Free tier: View project info only
   - Premium tier: Full generation capabilities

## Technical Context

- **Branch**: feature/sdk-only-migration
- **Created**: 2025-01-22
- **Type**: FEATURE (Major enhancement)
- **Complexity**: Complex (MCP integration + template engine + premium gating)
- **Priority**: MEDIUM (after TASK_2025_110)

## Current Wizard State

### What Exists (libs/backend/agent-generation/)

| Component                  | Status | Purpose                          |
| -------------------------- | ------ | -------------------------------- |
| `SetupWizardService`       | ✅     | 6-step wizard flow orchestration |
| `AgentSelectionService`    | ✅     | Relevance scoring for agents     |
| `AgentFileWriterService`   | ✅     | Write to `.claude/agents/`       |
| `TemplateStorageService`   | ✅     | Store agent templates            |
| `ContentGenerationService` | ✅     | LLM-powered content generation   |

### What's Missing

1. **MCP Integration**: Wizard doesn't use Ptah MCP for analysis
2. **Full Template Set**: Need all 13 agent templates + orchestration skill
3. **Project Adaptation**: Current output is generic, not project-specific
4. **Premium Gating**: No license check before wizard access
5. **Command Generation**: Only generates agents, not commands/skills

## Target Wizard Flow

```
Step 1: Welcome
├── License check (premium required)
├── Show wizard benefits
└── "Start Setup" button

Step 2: Deep Scan (MCP-Powered)
├── ptah.workspace.getProjectInfo()
├── ptah.workspace.analyzeArchitecture()
├── ptah.search.findFiles("**/*.{ts,js,py,go,java}")
├── ptah.symbols.getWorkspaceSymbols()
└── Display: Project type, frameworks, patterns

Step 3: Analysis
├── Recommend relevant agents
├── Identify project-specific customizations
├── Show what will be generated
└── Allow user to select/deselect

Step 4: Configuration
├── Agent customization options
├── Orchestration preferences (full/partial)
├── Integration points (CI/CD, testing, etc.)
└── Preview generated content

Step 5: Generation (MCP-Powered)
├── Use ptah.ai for intelligent content
├── Generate .claude/agents/*.md (all 13)
├── Generate .claude/commands/orchestrate.md
├── Generate .claude/skills/orchestration/
├── Embed project-specific context
└── Progress indicators

Step 6: Complete
├── Show generated files
├── Quick start guide
├── Link to documentation
└── "Open Claude Code" button
```

## MCP Integration Points

### Analysis Phase (Step 2)

```typescript
// Get project structure
const projectInfo = await mcpClient.call('ptah.workspace.getProjectInfo');

// Analyze architecture
const architecture = await mcpClient.call('ptah.workspace.analyzeArchitecture');

// Find key files
const keyFiles = await mcpClient.call('ptah.search.findFiles', {
  patterns: ['**/package.json', '**/tsconfig.json', '**/*.config.*'],
});

// Get code symbols
const symbols = await mcpClient.call('ptah.symbols.getWorkspaceSymbols', {
  query: 'class|interface|function',
});
```

### Generation Phase (Step 5)

```typescript
// Generate agent with project context
const agentContent = await mcpClient.call('ptah.ai.generateContent', {
  template: 'backend-developer',
  context: {
    projectType: 'angular-nx-monorepo',
    frameworks: ['Angular 20', 'NestJS', 'TypeScript'],
    patterns: ['DI', 'Signal-based', 'Layered architecture'],
    keyFiles: ['libs/', 'apps/', 'nx.json'],
  },
});
```

## Agent Templates Required

All 13 agents need templates that can be customized per project:

| Agent                    | Template Focus                                    |
| ------------------------ | ------------------------------------------------- |
| project-manager          | Requirements gathering patterns for project type  |
| software-architect       | Architecture patterns relevant to project         |
| team-leader              | Batching strategy for project structure           |
| backend-developer        | Backend patterns (NestJS, Express, FastAPI, etc.) |
| frontend-developer       | Frontend patterns (Angular, React, Vue, etc.)     |
| devops-engineer          | CI/CD patterns (GitHub Actions, GitLab CI, etc.)  |
| senior-tester            | Testing patterns (Jest, Vitest, pytest, etc.)     |
| code-style-reviewer      | Style guide for project (ESLint, Prettier, etc.)  |
| code-logic-reviewer      | Logic patterns for project domain                 |
| researcher-expert        | Research context for project stack                |
| modernization-detector   | Modernization opportunities for project           |
| ui-ux-designer           | Design patterns for project UI framework          |
| technical-content-writer | Documentation patterns for project                |

## Premium Gating

### Implementation

```typescript
// In SetupWizardService
async startWizard(): Promise<void> {
  const licenseStatus = await this.licenseService.verifyLicense();

  if (!this.isPremiumTier(licenseStatus)) {
    throw new PremiumFeatureError('Setup wizard requires premium license');
  }

  // Continue with wizard...
}
```

### UI Handling

```typescript
// In wizard-view.component.ts
readonly isPremium = signal(false);

async ngOnInit() {
  const status = await this.rpc.call('license:getStatus');
  this.isPremium.set(status.isPremium);
}

// Template
@if (!isPremium()) {
  <premium-upsell feature="Setup Wizard" />
} @else {
  <wizard-steps />
}
```

## Success Criteria

- [ ] Wizard uses Ptah MCP for deep project analysis
- [ ] All 13 agent templates exist and are customizable
- [ ] Orchestration skill is generated (from TASK_2025_110)
- [ ] Commands are generated (at least /orchestrate)
- [ ] Output is project-specific (not generic)
- [ ] Premium gating enforced (backend + frontend)
- [ ] Generation uses ptah.ai for intelligent content
- [ ] Progress indicators during generation
- [ ] Error handling for MCP failures

## Dependencies

- **Depends on**: TASK_2025_110 (Orchestration Skill) - must exist before wizard can generate it
- **Related**: TASK_2025_108 (Premium Enforcement) - license gating patterns

## Files to Modify

### Backend

- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts`
- `libs/backend/agent-generation/src/lib/services/content-generation.service.ts`
- `libs/backend/agent-generation/src/lib/templates/` (add all 13 templates)

### Frontend

- `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/scan-step.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/generation-step.component.ts`

### Integration

- `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`

## Related Tasks

- **TASK_2025_110**: Orchestration Skill Conversion (dependency - COMPLETED)
- **TASK_2025_108**: Premium Feature Enforcement (completed - reuse patterns)
- **TASK_2025_064/065**: Original agent generation tasks (reference)

---

## Orchestration Skill Enhancements (from TASK_2025_110 Future Work)

These enhancements were identified during TASK_2025_110 and should be implemented as part of this task to create a comprehensive, intelligent orchestration system.

### Category 1: Skill Capability Improvements

#### 1.1 Parallel Agent Execution Optimization

**Priority**: MEDIUM | **Effort**: 4-6 hours

Enable parallel execution of independent agents (e.g., researcher + ui-ux-designer in FEATURE strategy).

**Files to Modify**:

- `.claude/skills/orchestration/SKILL.md` (orchestration loop)
- `.claude/skills/orchestration/references/strategies.md` (FEATURE strategy)

---

#### 1.2 Adaptive Strategy Selection

**Priority**: HIGH | **Effort**: 6-8 hours

Replace keyword-based task detection with confidence-based analysis considering:

- Keywords in request
- Files likely affected (semantic analysis)
- Complexity score (multi-file, cross-library)
- Recent task patterns

**Files to Modify**:

- `.claude/skills/orchestration/SKILL.md` (Workflow Selection Matrix)

---

#### 1.3 Checkpoint Customization

**Priority**: LOW | **Effort**: 2-3 hours

Allow users to skip certain checkpoints (e.g., auto-approve PM requirements) with explicit opt-in.

**Files to Modify**:

- `.claude/skills/orchestration/references/checkpoints.md`
- `.claude/skills/orchestration/SKILL.md`

---

### Category 2: Integration Enhancements

#### 2.1 MCP Tool Integration for Workflow State

**Priority**: HIGH | **Effort**: 8-10 hours

Add MCP tools for explicit workflow state management:

```typescript
// New MCP tools in ptah.orchestration namespace
ptah.orchestration.getState(taskId: string)
ptah.orchestration.setState(taskId: string, state: WorkflowState)
ptah.orchestration.getNextAction(taskId: string)
```

**Files to Create/Modify**:

- NEW: `libs/backend/vscode-lm-tools/src/lib/tools/orchestration-tools.ts`
- `.claude/skills/orchestration/SKILL.md` (continuation mode)
- `.claude/skills/orchestration/references/task-tracking.md`

---

#### 2.2 Skill Composition Support

**Priority**: MEDIUM | **Effort**: 6-8 hours

Enable subagents to invoke minimal orchestration workflows for blocking issues discovered during implementation.

**Files to Modify**:

- `.claude/skills/orchestration/SKILL.md` (add "Subagent Orchestration" section)
- `.claude/skills/orchestration/references/agent-catalog.md`

---

#### 2.3 Workspace Intelligence Integration

**Priority**: HIGH | **Effort**: 6-8 hours

Integrate workspace-intelligence library with orchestration:

- Auto-detect affected libraries for feature requests
- Recommend frontend vs backend developer based on file patterns
- Estimate complexity from code analysis

**Files to Modify**:

- `.claude/skills/orchestration/SKILL.md` (Phase 0 initialization)
- `.claude/skills/orchestration/references/task-tracking.md` (context.md template)

---

### Category 3: Quality and Validation

#### 3.1 Automated Skill Validation

**Priority**: HIGH | **Effort**: 4-6 hours

Create validation script for orchestration skill:

- Syntax validation (all markdown valid)
- Reference validation (all links point to existing files)
- Content validation (all 6 strategies, all 13 agents documented)
- Consistency validation (invocation patterns match agent-catalog.md)

**Files to Create**:

- NEW: `scripts/validate-orchestration-skill.ts`
- Update: `.husky/pre-commit`

---

#### 3.2 Workflow Telemetry

**Priority**: LOW | **Effort**: 6-8 hours

Track workflow metrics: strategy usage, agent durations, failure points, validation counts.

**Files to Create**:

- NEW: `task-tracking/TASK_[ID]/telemetry.json` (auto-generated)

---

#### 3.3 Strategy Test Suite

**Priority**: MEDIUM | **Effort**: 8-10 hours

Automated tests for each strategy flow:

- Mock user requests matching strategy keywords
- Verify correct phase sequence
- Verify correct agents called
- Verify correct checkpoints presented

**Files to Create**:

- NEW: `task-tracking/test-scenarios/` (test scenarios)

---

### Category 4: Documentation and Discoverability

#### 4.1 Interactive Strategy Selection Guide

**Priority**: LOW | **Effort**: 3-4 hours

Decision tree wizard in SKILL.md to help users select appropriate strategy.

**Files to Modify**:

- `.claude/skills/orchestration/SKILL.md`

---

#### 4.2 Agent Capability Matrix

**Priority**: MEDIUM | **Effort**: 2-3 hours

Comparative matrix showing which agents can do what (write code, design, review, etc.)

**Files to Modify**:

- `.claude/skills/orchestration/references/agent-catalog.md`

---

#### 4.3 Example Workflow Traces

**Priority**: LOW | **Effort**: 4-6 hours

Complete workflow traces showing orchestration from start to finish.

**Files to Create**:

- NEW: `.claude/skills/orchestration/examples/feature-trace.md`
- NEW: `.claude/skills/orchestration/examples/bugfix-trace.md`
- NEW: `.claude/skills/orchestration/examples/creative-trace.md`

---

### Category 5: Modernization Opportunities

#### 5.1 Progressive Reference Loading Optimization

**Priority**: HIGH | **Effort**: 2-3 hours

Audit SKILL.md for content duplicating reference files. Target: reduce from 398 to <300 lines.

**Files to Modify**:

- `.claude/skills/orchestration/SKILL.md`

---

#### 5.2 Reference File Consolidation

**Priority**: LOW | **Effort**: 3-4 hours

Potential merges:

- `team-leader-modes.md` + `task-tracking.md` -> `development-workflow.md`
- `checkpoints.md` + `git-standards.md` -> `validation-reference.md`

---

#### 5.3 Agent Profile Standardization

**Priority**: MEDIUM | **Effort**: 4-6 hours

Standardize all agent profiles with consistent structure:

- Role, Triggers, Inputs, Outputs, Dependencies, Parallel With, Invocation Example

**Files to Modify**:

- `.claude/skills/orchestration/references/agent-catalog.md`
- `.claude/agents/*.md` (sync with catalog)

---

## Enhancement Priority Summary

| Priority   | Enhancements                                                                                                      | Total Effort |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| **HIGH**   | 2.1 MCP Tools, 1.2 Adaptive Selection, 2.3 Workspace Intelligence, 3.1 Validation, 5.1 Progressive Loading        | ~28-35 hours |
| **MEDIUM** | 1.1 Parallel Execution, 2.2 Skill Composition, 3.3 Test Suite, 4.2 Capability Matrix, 5.3 Profile Standardization | ~24-32 hours |
| **LOW**    | 1.3 Checkpoint Customization, 3.2 Telemetry, 4.1 Strategy Guide, 4.3 Workflow Traces, 5.2 Consolidation           | ~18-24 hours |

**Recommended Implementation Order**:

1. HIGH priority items first (foundational improvements)
2. MEDIUM items that support wizard generation
3. LOW items as time permits

---

## Updated Success Criteria

Original criteria plus:

- [ ] MCP orchestration tools implemented (`ptah.orchestration.*`)
- [ ] Adaptive strategy selection with confidence scoring
- [ ] Workspace intelligence integrated into Phase 0
- [ ] Automated skill validation script created
- [ ] SKILL.md optimized to <300 lines
- [ ] Agent capability matrix added to agent-catalog.md
- [ ] Agent profiles standardized across catalog and agent files
