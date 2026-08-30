# Agent Catalog Reference

Comprehensive catalog of all 15 specialist agents with capabilities, triggers, and invocation patterns.

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
| video-director           |   **P**    | **P**  |   -    |   -   |    -     |    S    |  **P**  |       S        |

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
| Content        | technical-content-writer                           | Blogs, docs, scripts |
| Demo video     | video-director                                     | Product tours, demos |
| Infrastructure | devops-engineer                                    | CI/CD, containers    |

**Default**: When uncertain, use `/orchestrate` for full workflow analysis.

---

## Invocation

Every agent is invoked the same way. One shape, filled from the table below:

```typescript
Task({
  subagent_type: '<agent>',
  description: '<description from the table>',
  prompt: `You are <agent> for TASK_2026_042.

**Task Folder**: <absolute path to .ptah/specs/TASK_2026_042>
<context lines from the table>

<instruction from the table>
See <agent>.md for detailed instructions.`,
});
```

The `**Task Folder**` line is always an absolute path and is always present.
Everything else varies only as the table says.

| Agent                    | `description`                                 | Context lines                                                                                                                 | Instruction                                                                                          |
| ------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| project-manager          | Create requirements for TASK_2026_042         | `**User Request**: "<the user's words>"`                                                                                      | Analyze the request and create comprehensive requirements.                                           |
| software-architect       | Design implementation for TASK_2026_042       | `**Requirements**: Read task-description.md in task folder`                                                                   | Design the technical implementation plan.                                                            |
| team-leader              | Decompose tasks for TASK_2026_042             | `**MODE**: 1 - DECOMPOSITION`<br>`**Implementation Plan**: Read implementation-plan.md in task folder`                        | Break down the implementation into atomic, batchable tasks.                                          |
| backend-developer        | Implement Batch N for TASK_2026_042           | `**Tasks**: Read the batch file, find Batch N (IN PROGRESS)`<br>`**Plan**: Read implementation-plan.md for context`           | Implement all tasks in Batch N. Update status to IMPLEMENTED when done.                              |
| frontend-developer       | Implement Batch N for TASK_2026_042           | same as backend-developer                                                                                                     | Implement all tasks in Batch N. Update status to IMPLEMENTED when done.                              |
| devops-engineer          | Implement infrastructure for TASK_2026_042    | `**Plan**: Read implementation-plan.md for infrastructure design`                                                             | Implement the infrastructure changes.                                                                |
| senior-tester            | Test implementation for TASK_2026_042         | `**Changes**: Review the batch file for implemented changes`<br>`**Plan**: Read implementation-plan.md for expected behavior` | Create and run tests, document results in test-report.md.                                            |
| code-style-reviewer      | Review code style for TASK_2026_042           | `**Changes**: Review the batch file for modified files`                                                                       | Review code for style, patterns, and consistency.                                                    |
| code-logic-reviewer      | Review code logic for TASK_2026_042           | `**Changes**: Review the batch file for modified files`<br>`**Plan**: Read implementation-plan.md for expected behavior`      | Review code for logic completeness and correctness.                                                  |
| visual-reviewer          | Visual review for TASK_2026_042               | `**Changes**: Review the batch file for modified frontend files`<br>`**Base URL**: http://localhost:4200`                     | Perform a full visual review — see the visual-reviewer section below for the six-viewport checklist. |
| researcher-expert        | Research X for TASK_2026_042                  | `**Research Question**: "<the question>"`                                                                                     | Investigate options, create comparison matrix, recommend approach.                                   |
| modernization-detector   | Analyze future improvements for TASK_2026_042 | `**Changes**: Review the batch file for what was implemented`                                                                 | Identify opportunities for future improvements and tech debt.                                        |
| ui-ux-designer           | Create design system for TASK_2026_042        | `**Goal**: <what to design>`                                                                                                  | Guide through niche discovery, create design system.                                                 |
| technical-content-writer | Create landing page content for TASK_2026_042 | `**Design System**: Read DESIGN-SYSTEM.md from your own skill directory`<br>`**Goal**: <what to write>`                       | Create design-integrated content specification.                                                      |
| video-director           | Author showcase scene for TASK_2026_042       | `**Goal**: <the feature or flow to demo>`<br>`**App**: <what to launch and at which URL>`                                     | Author the scene walkthrough and narration, then capture and render.                                 |

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

**Note**: team-leader is the one agent whose prompt must open with a mode line —
`**MODE**: 1 - DECOMPOSITION` (or 2, or 3). See the invocation table above.

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

- `.ptah/specs/TASK_[ID]/code-style-review.md`

**Dependencies**: Implementation complete (all batches)

**Parallel With**: senior-tester, code-logic-reviewer

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

- `.ptah/specs/TASK_[ID]/code-logic-review.md`

**Dependencies**: Implementation complete (all batches)

**Parallel With**: senior-tester, code-style-reviewer

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

**Review Checklist** (spell this out in the prompt):

1. Test all 6 viewports (320, 375, 768, 1024, 1366, 1920)
2. Take screenshots at each viewport
3. Test hover, focus, active states
4. Check color contrast ratios
5. Verify touch target sizes
6. Test responsive behavior

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

- `DESIGN-SYSTEM.md`, written into the `technical-content-writer` skill's own
  directory (locate it via the Skill tool / plugin root, not a workspace path)
- `.ptah/specs/TASK_[ID]/visual-design-specification.md`

**Dependencies**: project-manager (optional context)

**Parallel With**: None (design before content)

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

- `DESIGN-SYSTEM.md`, a sibling of the `technical-content-writer` SKILL.md
  (resolve against that skill's own directory, not a workspace path)
- Content brief/requirements
- Codebase features for technical accuracy

**Outputs**:

- `.ptah/specs/TASK_[ID]/content-specification.md`
- `docs/content/*.md` (final content)

**Dependencies**: ui-ux-designer (for CREATIVE workflow)

**Parallel With**: Multiple content-writer instances (different content types)

---

### video-director

**Role**: Marketing videos through the showcase pipeline — a Playwright capture of
the real app, rendered by Remotion into a narrated, captioned MP4

**Triggers**:

- "Make / record / render a demo video", product tour, or feature showcase
- Authoring or editing a scene walkthrough (`*.scene.ts`) or narration script
- Tuning the virtual-camera grammar (zoom, pan, highlight rings, motion blur)
- Re-skinning the videos for a different brand (`brand.config.ts`)
- Porting the whole pipeline into another Nx workspace

**Inputs**:

- The feature or flow to demonstrate, and how to launch the app that shows it
- An existing brand config, where the project already has one

**Outputs**:

- Scene walkthrough and narration script
- The rendered MP4, plus the beats/shots manifest that produced it

**Dependencies**: A runnable app to capture. ui-ux-designer only when the brand
direction does not exist yet.

**Parallel With**: None (capture drives the real app and wants it to itself)

**Note**: video-director operates the `video-showcase` skill — read that skill
before authoring, rather than inferring the scene format from this entry.

---

## Agent Category Summary

| Category    | Agents                                                                   | Purpose                |
| ----------- | ------------------------------------------------------------------------ | ---------------------- |
| Planning    | project-manager, software-architect, team-leader                         | Requirements & design  |
| Development | backend-developer, frontend-developer, devops-engineer                   | Implementation         |
| QA          | senior-tester, code-style-reviewer, code-logic-reviewer, visual-reviewer | Quality assurance      |
| Specialist  | researcher-expert, modernization-detector                                | Research & analysis    |
| Creative    | ui-ux-designer, technical-content-writer, video-director                 | Design, content, video |

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

## CLI Agent Delegation

Agents may delegate focused sub-tasks to CLI agents. That is one subject with one
home: [cli-agent-delegation.md](cli-agent-delegation.md) — the injection block,
the spawn/poll/read cycle, the concurrency limit, and the per-role examples all
live there.

Do not restate the delegation rules here. The copy that used to sit in this file
drifted out of date and hardcoded a vendor list; discovery via `ptah_agent_list`
is the only correct source for which CLI agents exist.
