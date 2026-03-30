# Agent Catalog Reference

Comprehensive catalog of all 14 specialist agents with capabilities, triggers, and invocation patterns.

---

## Agent Capability Matrix

| Agent                    | Write Code | Design | Review | Plan  | Research | Content | Browser | CLI Delegation |
| ------------------------ | :--------: | :----: | :----: | :---: | :------: | :-----: | :-----: | :------------: |
| project-manager          |     -      |   -    |   -    | **P** |    S     |    -    |    -    |       S        |
| software-architect       |     -      | **P**  |   S    | **P** |    S     |    -    |    -    |       S        |
| team-leader              |     -      |   -    |   S    | **P** |    -     |    -    |    -    |     **P**      |
| backend-developer        |   **P**    |   S    |   -    |   -   |    -     |    -    |    -    |       S        |
| frontend-developer       |   **P**    |   S    |   -    |   -   |    -     |    -    |    -    |       S        |
| devops-engineer          |   **P**    |   S    |   -    |   -   |    S     |    -    |    -    |       S        |
| senior-tester            |   **P**    |   -    | **P**  |   -   |    -     |    -    |    -    |     **P**      |
| code-style-reviewer      |     -      |   -    | **P**  |   -   |    -     |    -    |    -    |       S        |
| code-logic-reviewer      |     -      |   -    | **P**  |   -   |    -     |    -    |    -    |       S        |
| visual-reviewer          |     -      |   -    | **P**  |   -   |    -     |    -    |  **P**  |       -        |
| researcher-expert        |     -      |   -    |   -    |   -   |  **P**   |    S    |    -    |     **P**      |
| modernization-detector   |     -      |   -    |   S    |   -   |  **P**   |    -    |    -    |       S        |
| ui-ux-designer           |     -      | **P**  |   -    |   S   |    -     |    S    |    -    |       -        |
| technical-content-writer |     -      |   S    |   -    |   -   |    -     |  **P**  |    -    |       S        |

**Legend**: **P** = Primary capability, S = Secondary capability, - = Not applicable

### CLI Delegation Column

- **P** (Primary): Agent benefits greatly from CLI delegation — parallel analysis, batch test generation, multi-file reviews
- **S** (Secondary): Agent can delegate occasional sub-tasks for speed
- **-**: Agent should not delegate (visual-reviewer needs browser tools, ui-ux-designer needs interactive design)

---

## Agent Selection Matrix

| Request Type   | Agent Path                                         | Trigger              |
| -------------- | -------------------------------------------------- | -------------------- |
| Implement X    | project-manager -> architect -> team-leader -> dev | New features         |
| Fix bug        | team-leader -> dev -> test -> review               | Bug reports          |
| Research X     | researcher-expert -> architect                     | Technical questions  |
| Review style   | code-style-reviewer                                | Pattern checks       |
| Review logic   | code-logic-reviewer                                | Completeness checks  |
| Review visual  | visual-reviewer                                    | UI/UX visual testing |
| Test X         | senior-tester                                      | Testing              |
| Architecture   | software-architect                                 | Design               |
| Landing page   | ui-ux-designer -> technical-content-writer         | Marketing pages      |
| Brand/visual   | ui-ux-designer                                     | Design system        |
| Content        | technical-content-writer                           | Blogs, docs, video   |
| Infrastructure | devops-engineer                                    | CI/CD, Docker, K8s   |

**Default**: When uncertain, use `/orchestrate` for full workflow analysis.

---

## Planning Agents

### project-manager

**Role**: Requirements gathering, scope definition, stakeholder alignment

**Triggers**:

- Starting new features (FEATURE strategy Phase 1)
- Documentation tasks (DOCUMENTATION strategy Phase 1)
- DevOps tasks (DEVOPS strategy Phase 1)
- Any task needing scope clarification

**Inputs**:

- User request description
- Context from `.ptah/specs/TASK_[ID]/context.md`
- Codebase investigation results

**Outputs**:

- `.ptah/specs/TASK_[ID]/task-description.md`

**Dependencies**: None (first agent in most workflows)

**Parallel With**: None (sequential only)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'project-manager',
  description: 'Create requirements for TASK_2025_042',
  prompt: `You are project-manager for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**User Request**: "Add WebSocket support for real-time updates"

Analyze the request and create comprehensive requirements.
See project-manager.md for detailed instructions.`,
});
```

---

### software-architect

**Role**: Technical design, architecture decisions, implementation planning

**Triggers**:

- After PM completes (FEATURE strategy Phase 4)
- Refactoring tasks (REFACTORING strategy Phase 1)
- DevOps tasks (DEVOPS strategy Phase 2)
- When architectural decisions are needed

**Inputs**:

- `.ptah/specs/TASK_[ID]/task-description.md`
- Research reports (if available)
- Codebase analysis results

**Outputs**:

- `.ptah/specs/TASK_[ID]/implementation-plan.md`

**Dependencies**: project-manager (for FEATURE), researcher-expert (optional)

**Parallel With**: None (sequential only)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'software-architect',
  description: 'Design implementation for TASK_2025_042',
  prompt: `You are software-architect for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Requirements**: Read task-description.md in task folder

Design the technical implementation plan.
See software-architect.md for detailed instructions.`,
});
```

---

### team-leader

**Role**: Task decomposition, developer assignment, work coordination

**Triggers**:

- After architect completes (MODE 1: DECOMPOSITION)
- After developer returns (MODE 2: VERIFY + ASSIGN)
- When all batches complete (MODE 3: COMPLETION)

**Inputs**:

- `.ptah/specs/TASK_[ID]/implementation-plan.md`
- `.ptah/specs/TASK_[ID]/tasks.md` (for MODE 2/3)
- Developer implementation reports

**Outputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (creates and updates)
- Git commits (after verification)
- Developer assignment prompts

**Dependencies**: software-architect (for MODE 1)

**Parallel With**: None (sequential only)

**Invocation Example**:

```typescript
// MODE 1: DECOMPOSITION
Task({
  subagent_type: 'team-leader',
  description: 'Decompose tasks for TASK_2025_042',
  prompt: `You are team-leader for TASK_2025_042.

**MODE**: 1 - DECOMPOSITION
**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Implementation Plan**: Read implementation-plan.md in task folder

Break down the implementation into atomic, batchable tasks.
See team-leader.md for MODE 1 instructions.`,
});
```

---

## Development Agents

### backend-developer

**Role**: Backend implementation, APIs, services, data layer

**Triggers**:

- Backend-focused tasks assigned by team-leader
- API development, database changes
- Node.js/TypeScript backend work
- VS Code extension host code

**Inputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (assigned batch)
- `.ptah/specs/TASK_[ID]/implementation-plan.md`
- Library CLAUDE.md files

**Outputs**:

- Source files in `libs/backend/`, `apps/ptah-extension-vscode/`
- Updates to `.ptah/specs/TASK_[ID]/tasks.md` (status: IMPLEMENTED)

**Dependencies**: team-leader (batch assignment)

**Parallel With**: frontend-developer (different batches)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'backend-developer',
  description: 'Implement Batch 1 for TASK_2025_042',
  prompt: `You are backend-developer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Tasks**: Read tasks.md, find Batch 1 (IN PROGRESS)
**Plan**: Read implementation-plan.md for context

Implement all tasks in Batch 1. Update status to IMPLEMENTED when done.
See backend-developer.md for detailed instructions.`,
});
```

---

### frontend-developer

**Role**: Frontend implementation, UI components, Angular work

**Triggers**:

- Frontend-focused tasks assigned by team-leader
- Angular component development
- Webview/SPA changes
- Signal-based state management

**Inputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (assigned batch)
- `.ptah/specs/TASK_[ID]/implementation-plan.md`
- Library CLAUDE.md files

**Outputs**:

- Source files in `libs/frontend/`, `apps/ptah-extension-webview/`
- Updates to `.ptah/specs/TASK_[ID]/tasks.md` (status: IMPLEMENTED)

**Dependencies**: team-leader (batch assignment)

**Parallel With**: backend-developer (different batches)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'frontend-developer',
  description: 'Implement Batch 2 for TASK_2025_042',
  prompt: `You are frontend-developer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Tasks**: Read tasks.md, find Batch 2 (IN PROGRESS)
**Plan**: Read implementation-plan.md for context

Implement all tasks in Batch 2. Update status to IMPLEMENTED when done.
See frontend-developer.md for detailed instructions.`,
});
```

---

### devops-engineer

**Role**: Infrastructure, CI/CD, deployment, containerization

**Triggers**:

- DEVOPS strategy Phase 3
- CI/CD pipeline changes
- Docker/Kubernetes work
- Infrastructure-as-code tasks
- Package publishing automation

**Inputs**:

- `.ptah/specs/TASK_[ID]/implementation-plan.md`
- Existing workflow files (`.github/workflows/`)
- Infrastructure configs (`Dockerfile`, `terraform/`)

**Outputs**:

- Configuration files (`.github/workflows/`, `Dockerfile`, etc.)
- Infrastructure scripts
- Updates to `.ptah/specs/TASK_[ID]/tasks.md` (status: IMPLEMENTED)

**Dependencies**: software-architect (for DEVOPS strategy)

**Parallel With**: None (typically sequential)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'devops-engineer',
  description: 'Implement infrastructure for TASK_2025_042',
  prompt: `You are devops-engineer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Plan**: Read implementation-plan.md for infrastructure design

Implement the infrastructure changes.
See devops-engineer.md for detailed instructions.`,
});
```

---

## Quality Assurance Agents

### senior-tester

**Role**: Test planning, test implementation, quality verification

**Triggers**:

- QA phase (user selects "tester" or "all")
- When comprehensive testing is needed
- Integration test development
- Test coverage improvements

**Inputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (completed tasks)
- `.ptah/specs/TASK_[ID]/implementation-plan.md`
- Modified source files

**Outputs**:

- Test files (`*.spec.ts`)
- `.ptah/specs/TASK_[ID]/test-report.md`

**Dependencies**: Implementation complete (all batches)

**Parallel With**: code-style-reviewer, code-logic-reviewer

**Invocation Example**:

```typescript
Task({
  subagent_type: 'senior-tester',
  description: 'Test implementation for TASK_2025_042',
  prompt: `You are senior-tester for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Changes**: Review tasks.md for implemented changes
**Plan**: Read implementation-plan.md for expected behavior

Create and run tests, document results in test-report.md.
See senior-tester.md for detailed instructions.`,
});
```

---

### code-style-reviewer

**Role**: Code pattern review, style consistency, best practices

**Triggers**:

- QA phase (user selects "style" or "reviewers" or "all")
- Documentation tasks (final review)
- Pattern compliance checks

**Inputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (file list)
- Modified source files
- Project style guidelines

**Outputs**:

- `.ptah/specs/TASK_[ID]/code-review.md` (style section)

**Dependencies**: Implementation complete (all batches)

**Parallel With**: senior-tester, code-logic-reviewer

**Invocation Example**:

```typescript
Task({
  subagent_type: 'code-style-reviewer',
  description: 'Review code style for TASK_2025_042',
  prompt: `You are code-style-reviewer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Changes**: Review tasks.md for modified files

Review code for style, patterns, and consistency.
See code-style-reviewer.md for detailed instructions.`,
});
```

---

### code-logic-reviewer

**Role**: Logic completeness review, edge cases, correctness

**Triggers**:

- QA phase (user selects "logic" or "reviewers" or "all")
- Complex business logic changes
- Algorithm implementations
- Error handling verification

**Inputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (file list)
- `.ptah/specs/TASK_[ID]/implementation-plan.md`
- Modified source files

**Outputs**:

- `.ptah/specs/TASK_[ID]/code-review.md` (logic section)

**Dependencies**: Implementation complete (all batches)

**Parallel With**: senior-tester, code-style-reviewer

**Invocation Example**:

```typescript
Task({
  subagent_type: 'code-logic-reviewer',
  description: 'Review code logic for TASK_2025_042',
  prompt: `You are code-logic-reviewer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Changes**: Review tasks.md for modified files
**Plan**: Read implementation-plan.md for expected behavior

Review code for logic completeness and correctness.
See code-logic-reviewer.md for detailed instructions.`,
});
```

---

### visual-reviewer

**Role**: Visual UI/UX review, responsive design testing, browser-based visual QA

**Triggers**:

- QA phase for frontend changes (user selects "visual" or "reviewers" or "all")
- Component UI changes
- Responsive design modifications
- CSS/Tailwind changes
- Form/Input styling updates

**Inputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (file list)
- Modified component files (`.html`, `.scss`, `.css`)
- Routes/pages affected

**Outputs**:

- `.ptah/specs/TASK_[ID]/visual-review.md`
- `.ptah/specs/TASK_[ID]/screenshots/*.png` (visual evidence)

**Dependencies**:

- Implementation complete (all batches)
- Frontend build available (nx build web or dev server running)

**Parallel With**: senior-tester, code-style-reviewer, code-logic-reviewer

**Special Capabilities**:

- Chrome DevTools Protocol integration
- Screenshots at multiple viewports
- Responsive breakpoint testing
- Interaction state testing (hover, focus, click)
- Color contrast analysis
- Performance visual testing (layout shifts)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'visual-reviewer',
  description: 'Visual review for TASK_2025_042',
  prompt: `You are visual-reviewer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Changes**: Review tasks.md for modified frontend files
**Base URL**: http://localhost:4200

Perform comprehensive visual review including:
1. Test all 6 viewports (320, 375, 768, 1024, 1366, 1920)
2. Take screenshots at each viewport
3. Test hover, focus, active states
4. Check color contrast ratios
5. Verify touch target sizes
6. Test responsive behavior

See visual-reviewer.md for detailed instructions.`,
});
```

---

## Specialist Agents

### researcher-expert

**Role**: Technical research, feasibility analysis, POC development

**Triggers**:

- FEATURE strategy Phase 2 (when technical unknowns exist)
- RESEARCH strategy (primary agent)
- BUGFIX with unknown cause
- Technical complexity score > 3
- API/library evaluation

**Inputs**:

- Research question/hypothesis
- `.ptah/specs/TASK_[ID]/context.md`
- External documentation links

**Outputs**:

- `.ptah/specs/TASK_[ID]/research-report.md`

**Dependencies**: project-manager (optional context)

**Parallel With**: None (typically sequential)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'researcher-expert',
  description: 'Research WebSocket options for TASK_2025_042',
  prompt: `You are researcher-expert for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Research Question**: "Best WebSocket library for VS Code extension"

Investigate options, create comparison matrix, recommend approach.
See researcher-expert.md for detailed instructions.`,
});
```

---

### modernization-detector

**Role**: Future improvement analysis, tech debt identification

**Triggers**:

- Final phase of any workflow (Phase 8 in FEATURE)
- After all implementation and QA complete
- Periodic codebase analysis
- Technical debt assessment

**Inputs**:

- `.ptah/specs/TASK_[ID]/tasks.md` (what was implemented)
- Modified source files
- Codebase structure

**Outputs**:

- `.ptah/specs/TASK_[ID]/future-enhancements.md`

**Dependencies**: Implementation and QA complete

**Parallel With**: None (final phase)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'modernization-detector',
  description: 'Analyze future improvements for TASK_2025_042',
  prompt: `You are modernization-detector for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Changes**: Review tasks.md for what was implemented

Identify opportunities for future improvements and tech debt.
See modernization-detector.md for detailed instructions.`,
});
```

---

## Creative Agents

### ui-ux-designer

**Role**: Visual design, design systems, brand identity, UI specifications

**Triggers**:

- CREATIVE workflow (design system creation)
- FEATURE with UI components (Phase 3)
- Visual redesigns, brand work
- Landing page design
- Component library design

**Inputs**:

- Brand requirements/preferences
- Reference designs/competitors
- `.ptah/specs/TASK_[ID]/context.md`

**Outputs**:

- `.claude/skills/technical-content-writer/DESIGN-SYSTEM.md`
- `.ptah/specs/TASK_[ID]/visual-design-specification.md`

**Dependencies**: project-manager (optional context)

**Parallel With**: None (design before content)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'ui-ux-designer',
  description: 'Create design system for TASK_2025_042',
  prompt: `You are ui-ux-designer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Goal**: Create brand design system for the project

Guide through niche discovery, create design system.
See ui-ux-designer.md for detailed instructions.`,
});
```

---

### technical-content-writer

**Role**: Marketing content, documentation, blog posts, video scripts

**Triggers**:

- CREATIVE workflow (after design system exists)
- Landing page content creation
- Blog post writing
- Documentation creation
- Video script development

**Inputs**:

- `.claude/skills/technical-content-writer/DESIGN-SYSTEM.md`
- Content brief/requirements
- Codebase features for technical accuracy

**Outputs**:

- `.ptah/specs/TASK_[ID]/content-specification.md`
- `docs/content/*.md` (final content)

**Dependencies**: ui-ux-designer (for CREATIVE workflow)

**Parallel With**: Multiple content-writer instances (different content types)

**Invocation Example**:

```typescript
Task({
  subagent_type: 'technical-content-writer',
  description: 'Create landing page content for TASK_2025_042',
  prompt: `You are technical-content-writer for TASK_2025_042.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_042
**Design System**: Read .claude/skills/technical-content-writer/DESIGN-SYSTEM.md
**Goal**: Create landing page content for the VS Code extension

Create design-integrated content specification.
See technical-content-writer.md for detailed instructions.`,
});
```

---

## Agent Category Summary

| Category    | Agents                                                                   | Purpose               |
| ----------- | ------------------------------------------------------------------------ | --------------------- |
| Planning    | project-manager, software-architect, team-leader                         | Requirements & design |
| Development | backend-developer, frontend-developer, devops-engineer                   | Implementation        |
| QA          | senior-tester, code-style-reviewer, code-logic-reviewer, visual-reviewer | Quality assurance     |
| Specialist  | researcher-expert, modernization-detector                                | Research & analysis   |
| Creative    | ui-ux-designer, technical-content-writer                                 | Design & content      |

---

## Parallel Invocation Patterns

Some agents can run in parallel during QA phase:

### All QA (User selects "all")

```typescript
// Run in parallel (all 4 QA agents)
Promise.all([
  Task({ subagent_type: 'senior-tester', ... }),
  Task({ subagent_type: 'code-style-reviewer', ... }),
  Task({ subagent_type: 'code-logic-reviewer', ... }),
  Task({ subagent_type: 'visual-reviewer', ... })  // Frontend tasks only
]);
```

### Reviewers Only (User selects "reviewers")

```typescript
// Run in parallel (3 reviewers)
Promise.all([
  Task({ subagent_type: 'code-style-reviewer', ... }),
  Task({ subagent_type: 'code-logic-reviewer', ... }),
  Task({ subagent_type: 'visual-reviewer', ... })  // Frontend tasks only
]);
```

### Creative Content (When design exists)

```typescript
// Run in parallel
Promise.all([Task({ subagent_type: 'technical-content-writer', prompt: 'landing page...' }), Task({ subagent_type: 'technical-content-writer', prompt: 'blog post...' })]);
```

### Development Batches (Independent batches)

```typescript
// Run in parallel when batches are independent
Promise.all([Task({ subagent_type: 'backend-developer', prompt: 'Batch 1...' }), Task({ subagent_type: 'frontend-developer', prompt: 'Batch 2...' })]);
```

---

## CLI Agent Delegation Prompt Injection

When CLI Agent Delegation Mode is active (Checkpoint 0.1 = "yes" or "auto"), the following block is appended to every sub-agent's invocation prompt. Role-specific examples are injected per agent type.

**Note**: The per-role examples below are the injection templates appended to sub-agent prompts. For extended examples with full `ptah_agent_spawn` calls and detailed task prompts, see [cli-agent-delegation.md](references/cli-agent-delegation.md#per-role-delegation-examples).

### Standard Injection Block

```markdown
## CLI Agent Delegation (Junior Helpers)

You have CLI agents available as junior helpers. Use them for focused,
independently-executable sub-tasks to speed up your work.

**Available agents** (from discovery):
[injected from ptah_agent_list — e.g., "gemini, ptah-cli"]

**How to delegate:**

1. Spawn: `ptah_agent_spawn { task: "...", cli: "gemini", taskFolder: "...", files: [...] }`
2. Poll: `ptah_agent_status { agentId: "..." }` (repeat until not "running")
3. Read: `ptah_agent_read { agentId: "..." }`
4. Use the results in your deliverable

**Rules:**

- Max 3 concurrent CLI agents
- CLI agents have NO shared context — include ALL necessary info in the task prompt
- CLI agents should NOT commit to git
- YOU own the quality — review CLI agent output before incorporating
- Delegate grunt work, keep synthesis and decisions to yourself
```

### Per-Agent Role-Specific Examples

Append these examples to the injection block based on the sub-agent being invoked:

#### project-manager

```
**When to delegate:** Research specific codebase areas, analyze dependencies, survey file structures
**Example:** ptah_agent_spawn { task: "List all Angular components in libs/frontend/ and categorize by Atomic Design level", cli: "gemini" }
```

#### software-architect

```
**When to delegate:** Analyze existing patterns in specific modules, check dependency graphs, POC spikes
**Example:** ptah_agent_spawn { task: "Analyze the DI setup in libs/backend/vscode-core/src. List all tokens and providers.", cli: "gemini" }
```

#### team-leader

```
**When to delegate:** Spawn CLI developer agents for batch sub-tasks, parallel file verification
**Example:** ptah_agent_spawn { task: "Verify these files exist and are non-empty: [list]", cli: "gemini" }
```

#### backend-developer

```
**When to delegate:** Test scaffolding, boilerplate generation, sub-tasks within a batch
**Example:** ptah_agent_spawn { task: "Create unit test scaffolding for AgentProcessManager with describe/it blocks", cli: "codex" }
```

#### frontend-developer

```
**When to delegate:** Component scaffolding, style migration, template generation
**Example:** ptah_agent_spawn { task: "Generate Angular standalone component skeleton for 'StatusBadge' following project conventions", cli: "gemini" }
```

#### devops-engineer

```
**When to delegate:** Config file generation, script writing, Dockerfile creation
**Example:** ptah_agent_spawn { task: "Generate a multi-stage Dockerfile for Node.js 20 with Alpine base", cli: "codex" }
```

#### senior-tester

```
**When to delegate:** Test file generation per module (in parallel), fixture creation, coverage analysis
**Example:** Spawn 3 agents for 3 modules: ptah_agent_spawn { task: "Write Jest tests for [module]...", cli: "gemini" } (x3)
```

#### code-style-reviewer / code-logic-reviewer

```
**When to delegate:** File-level reviews across many files in parallel
**Example:** Spawn agents per file: ptah_agent_spawn { task: "Review [file] for naming conventions and error handling", cli: "gemini" }
```

#### researcher-expert

```
**When to delegate:** Parallel deep-dives into different aspects of a technology/codebase
**Example:** Spawn 2 agents: one for external docs research, one for codebase usage analysis
```

#### modernization-detector

```
**When to delegate:** Parallel analysis of different modules for improvement opportunities
**Example:** ptah_agent_spawn { task: "Analyze libs/backend/vscode-core/ for deprecated API usage and modernization opportunities", cli: "gemini" }
```

#### technical-content-writer

```
**When to delegate:** Draft sections, research codebase features for content accuracy
**Example:** ptah_agent_spawn { task: "Read libs/backend/agent-sdk/src and produce a technical summary of capabilities", cli: "gemini" }
```

See [cli-agent-delegation.md](references/cli-agent-delegation.md) for the comprehensive delegation reference.
