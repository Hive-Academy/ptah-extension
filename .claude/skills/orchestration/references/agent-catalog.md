# Agent Catalog Reference

Comprehensive catalog of all 13 specialist agents with capabilities, triggers, and invocation patterns.

---

## Agent Selection Matrix

| Request Type     | Agent Path                                      | Trigger                |
|------------------|-------------------------------------------------|------------------------|
| Implement X      | project-manager -> architect -> team-leader -> dev | New features         |
| Fix bug          | team-leader -> dev -> test -> review            | Bug reports            |
| Research X       | researcher-expert -> architect                  | Technical questions    |
| Review style     | code-style-reviewer                             | Pattern checks         |
| Review logic     | code-logic-reviewer                             | Completeness checks    |
| Test X           | senior-tester                                   | Testing                |
| Architecture     | software-architect                              | Design                 |
| Landing page     | ui-ux-designer -> technical-content-writer      | Marketing pages        |
| Brand/visual     | ui-ux-designer                                  | Design system          |
| Content          | technical-content-writer                        | Blogs, docs, video     |
| Infrastructure   | devops-engineer                                 | CI/CD, Docker, K8s     |

**Default**: When uncertain, use `/orchestrate` for full workflow analysis.

---

## Planning Agents

### project-manager

**Purpose**: Requirements gathering, scope definition, stakeholder alignment

**When to invoke**:
- Starting new features (FEATURE strategy Phase 1)
- Documentation tasks (DOCUMENTATION strategy Phase 1)
- DevOps tasks (DEVOPS strategy Phase 1)
- Any task needing scope clarification

**Output file(s)**:
- `task-tracking/TASK_[ID]/task-description.md`

**Invocation example**:
```typescript
Task({
  subagent_type: 'project-manager',
  description: 'Create requirements for TASK_2025_042',
  prompt: `You are project-manager for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**User Request**: "Add WebSocket support for real-time updates"

Analyze the request and create comprehensive requirements.
See project-manager.md for detailed instructions.`
});
```

---

### software-architect

**Purpose**: Technical design, architecture decisions, implementation planning

**When to invoke**:
- After PM completes (FEATURE strategy Phase 4)
- Refactoring tasks (REFACTORING strategy Phase 1)
- DevOps tasks (DEVOPS strategy Phase 2)
- When architectural decisions are needed

**Output file(s)**:
- `task-tracking/TASK_[ID]/implementation-plan.md`

**Invocation example**:
```typescript
Task({
  subagent_type: 'software-architect',
  description: 'Design implementation for TASK_2025_042',
  prompt: `You are software-architect for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Requirements**: Read task-description.md in task folder

Design the technical implementation plan.
See software-architect.md for detailed instructions.`
});
```

---

### team-leader

**Purpose**: Task decomposition, developer assignment, work coordination

**When to invoke**:
- After architect completes (MODE 1: DECOMPOSITION)
- After developer returns (MODE 2: VERIFY + ASSIGN)
- When all batches complete (MODE 3: COMPLETION)

**Output file(s)**:
- `task-tracking/TASK_[ID]/tasks.md` (creates and updates)

**Invocation example**:
```typescript
// MODE 1: DECOMPOSITION
Task({
  subagent_type: 'team-leader',
  description: 'Decompose tasks for TASK_2025_042',
  prompt: `You are team-leader for TASK_2025_042.

**MODE**: 1 - DECOMPOSITION
**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Implementation Plan**: Read implementation-plan.md in task folder

Break down the implementation into atomic, batchable tasks.
See team-leader.md for MODE 1 instructions.`
});
```

---

## Development Agents

### backend-developer

**Purpose**: Backend implementation, APIs, services, data layer

**When to invoke**:
- Backend-focused tasks assigned by team-leader
- API development, database changes
- Node.js/TypeScript backend work

**Output file(s)**:
- Source files in `libs/backend/`, `apps/ptah-extension-vscode/`
- Updates to `task-tracking/TASK_[ID]/tasks.md` (status changes)

**Invocation example**:
```typescript
Task({
  subagent_type: 'backend-developer',
  description: 'Implement Batch 1 for TASK_2025_042',
  prompt: `You are backend-developer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Tasks**: Read tasks.md, find Batch 1 (IN PROGRESS)
**Plan**: Read implementation-plan.md for context

Implement all tasks in Batch 1. Update status to IMPLEMENTED when done.
See backend-developer.md for detailed instructions.`
});
```

---

### frontend-developer

**Purpose**: Frontend implementation, UI components, Angular work

**When to invoke**:
- Frontend-focused tasks assigned by team-leader
- Angular component development
- Webview/SPA changes

**Output file(s)**:
- Source files in `libs/frontend/`, `apps/ptah-extension-webview/`
- Updates to `task-tracking/TASK_[ID]/tasks.md` (status changes)

**Invocation example**:
```typescript
Task({
  subagent_type: 'frontend-developer',
  description: 'Implement Batch 2 for TASK_2025_042',
  prompt: `You are frontend-developer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Tasks**: Read tasks.md, find Batch 2 (IN PROGRESS)
**Plan**: Read implementation-plan.md for context

Implement all tasks in Batch 2. Update status to IMPLEMENTED when done.
See frontend-developer.md for detailed instructions.`
});
```

---

### devops-engineer

**Purpose**: Infrastructure, CI/CD, deployment, containerization

**When to invoke**:
- DEVOPS strategy Phase 3
- CI/CD pipeline changes
- Docker/Kubernetes work
- Infrastructure-as-code tasks

**Output file(s)**:
- Configuration files (`.github/workflows/`, `Dockerfile`, etc.)
- Infrastructure scripts
- Updates to `task-tracking/TASK_[ID]/tasks.md`

**Invocation example**:
```typescript
Task({
  subagent_type: 'devops-engineer',
  description: 'Implement infrastructure for TASK_2025_042',
  prompt: `You are devops-engineer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Plan**: Read implementation-plan.md for infrastructure design

Implement the infrastructure changes.
See devops-engineer.md for detailed instructions.`
});
```

---

## Quality Assurance Agents

### senior-tester

**Purpose**: Test planning, test implementation, quality verification

**When to invoke**:
- QA phase (user selects "tester" or "all")
- When comprehensive testing is needed
- Integration test development

**Output file(s)**:
- Test files (`*.spec.ts`)
- `task-tracking/TASK_[ID]/test-report.md`

**Invocation example**:
```typescript
Task({
  subagent_type: 'senior-tester',
  description: 'Test implementation for TASK_2025_042',
  prompt: `You are senior-tester for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Changes**: Review tasks.md for implemented changes
**Plan**: Read implementation-plan.md for expected behavior

Create and run tests, document results in test-report.md.
See senior-tester.md for detailed instructions.`
});
```

---

### code-style-reviewer

**Purpose**: Code pattern review, style consistency, best practices

**When to invoke**:
- QA phase (user selects "style" or "reviewers" or "all")
- Documentation tasks (final review)
- Pattern compliance checks

**Output file(s)**:
- `task-tracking/TASK_[ID]/code-review.md` (style section)

**Invocation example**:
```typescript
Task({
  subagent_type: 'code-style-reviewer',
  description: 'Review code style for TASK_2025_042',
  prompt: `You are code-style-reviewer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Changes**: Review tasks.md for modified files

Review code for style, patterns, and consistency.
See code-style-reviewer.md for detailed instructions.`
});
```

---

### code-logic-reviewer

**Purpose**: Logic completeness review, edge cases, correctness

**When to invoke**:
- QA phase (user selects "logic" or "reviewers" or "all")
- Complex business logic changes
- Algorithm implementations

**Output file(s)**:
- `task-tracking/TASK_[ID]/code-review.md` (logic section)

**Invocation example**:
```typescript
Task({
  subagent_type: 'code-logic-reviewer',
  description: 'Review code logic for TASK_2025_042',
  prompt: `You are code-logic-reviewer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Changes**: Review tasks.md for modified files
**Plan**: Read implementation-plan.md for expected behavior

Review code for logic completeness and correctness.
See code-logic-reviewer.md for detailed instructions.`
});
```

---

## Specialist Agents

### researcher-expert

**Purpose**: Technical research, feasibility analysis, POC development

**When to invoke**:
- FEATURE strategy Phase 2 (when technical unknowns exist)
- RESEARCH strategy (primary agent)
- BUGFIX with unknown cause
- Technical complexity score > 3

**Output file(s)**:
- `task-tracking/TASK_[ID]/research-report.md`

**Invocation example**:
```typescript
Task({
  subagent_type: 'researcher-expert',
  description: 'Research WebSocket options for TASK_2025_042',
  prompt: `You are researcher-expert for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Research Question**: "Best WebSocket library for VS Code extension"

Investigate options, create comparison matrix, recommend approach.
See researcher-expert.md for detailed instructions.`
});
```

---

### modernization-detector

**Purpose**: Future improvement analysis, tech debt identification

**When to invoke**:
- Final phase of any workflow (Phase 8 in FEATURE)
- After all implementation and QA complete
- Periodic codebase analysis

**Output file(s)**:
- `task-tracking/TASK_[ID]/future-enhancements.md`

**Invocation example**:
```typescript
Task({
  subagent_type: 'modernization-detector',
  description: 'Analyze future improvements for TASK_2025_042',
  prompt: `You are modernization-detector for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Changes**: Review tasks.md for what was implemented

Identify opportunities for future improvements and tech debt.
See modernization-detector.md for detailed instructions.`
});
```

---

## Creative Agents

### ui-ux-designer

**Purpose**: Visual design, design systems, brand identity, UI specifications

**When to invoke**:
- CREATIVE workflow (design system creation)
- FEATURE with UI components (Phase 3)
- Visual redesigns, brand work
- Landing page design

**Output file(s)**:
- `.claude/skills/technical-content-writer/DESIGN-SYSTEM.md`
- `task-tracking/TASK_[ID]/visual-design-specification.md`

**Invocation example**:
```typescript
Task({
  subagent_type: 'ui-ux-designer',
  description: 'Create design system for TASK_2025_042',
  prompt: `You are ui-ux-designer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Goal**: Create brand design system for the project

Guide through niche discovery, create design system.
See ui-ux-designer.md for detailed instructions.`
});
```

---

### technical-content-writer

**Purpose**: Marketing content, documentation, blog posts, video scripts

**When to invoke**:
- CREATIVE workflow (after design system exists)
- Landing page content creation
- Blog post writing
- Documentation creation
- Video script development

**Output file(s)**:
- `task-tracking/TASK_[ID]/content-specification.md`
- `docs/content/*.md` (final content)

**Invocation example**:
```typescript
Task({
  subagent_type: 'technical-content-writer',
  description: 'Create landing page content for TASK_2025_042',
  prompt: `You are technical-content-writer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/task-tracking/TASK_2025_042
**Design System**: Read .claude/skills/technical-content-writer/DESIGN-SYSTEM.md
**Goal**: Create landing page content for the VS Code extension

Create design-integrated content specification.
See technical-content-writer.md for detailed instructions.`
});
```

---

## Agent Category Summary

| Category  | Agents                                                      | Purpose               |
|-----------|-------------------------------------------------------------|-----------------------|
| Planning  | project-manager, software-architect, team-leader            | Requirements & design |
| Development | backend-developer, frontend-developer, devops-engineer    | Implementation        |
| QA        | senior-tester, code-style-reviewer, code-logic-reviewer     | Quality assurance     |
| Specialist | researcher-expert, modernization-detector                  | Research & analysis   |
| Creative  | ui-ux-designer, technical-content-writer                    | Design & content      |

---

## Parallel Invocation Patterns

Some agents can run in parallel during QA phase:

### All QA (User selects "all")
```typescript
// Run in parallel
Promise.all([
  Task({ subagent_type: 'senior-tester', ... }),
  Task({ subagent_type: 'code-style-reviewer', ... }),
  Task({ subagent_type: 'code-logic-reviewer', ... })
]);
```

### Reviewers Only (User selects "reviewers")
```typescript
// Run in parallel
Promise.all([
  Task({ subagent_type: 'code-style-reviewer', ... }),
  Task({ subagent_type: 'code-logic-reviewer', ... })
]);
```

### Creative Content (When design exists)
```typescript
// Run in parallel
Promise.all([
  Task({ subagent_type: 'technical-content-writer', prompt: 'landing page...' }),
  Task({ subagent_type: 'technical-content-writer', prompt: 'blog post...' })
]);
```
