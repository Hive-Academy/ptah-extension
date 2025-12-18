# 📜 PTAH PROJECT SPECIFICS

## Project Overview

**Ptah** is a VS Code extension that provides a complete visual interface for Claude Code CLI. Built with TypeScript and Angular webviews, it transforms Claude Code's CLI experience into native, integrated VS Code functionality.

## Development Commands

### Core Extension Development

```bash
# Install dependencies
npm install

# Compile TypeScript (main extension)
npm run compile

# Watch mode for development
npm run watch

# Lint TypeScript code
npm run lint

# Run tests
npm run test

# Build everything (extension + webview)
npm run build:all

# Quality gates (linting & typechecking)
npm run lint:all
npm run typecheck:all
```

---

## 📦 WORKSPACE ARCHITECTURE & LIBRARY MAP

### Overview

The Ptah workspace is organized as an Nx monorepo with **14 projects** (2 apps + 12 libraries) following a strict layered architecture pattern.

### Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│  Applications Layer                                  │
│  - ptah-extension-vscode (VS Code extension)        │
│  - ptah-extension-webview (Angular SPA)             │
├─────────────────────────────────────────────────────┤
│  Frontend Feature Libraries                          │
│  - chat, providers, analytics, dashboard            │
├─────────────────────────────────────────────────────┤
│  Frontend Core Services                              │
│  - core (state, services, VS Code integration)      │
├─────────────────────────────────────────────────────┤
│  Backend Domain Libraries                            │
│  - claude-domain (business logic)                    │
│  - ai-providers-core (multi-provider abstraction)    │
│  - workspace-intelligence (workspace analysis)       │
├─────────────────────────────────────────────────────┤
│  Infrastructure Layer                                │
│  - vscode-core (DI container, API wrappers)         │
├─────────────────────────────────────────────────────┤
│  Foundation Layer                                    │
│  - shared (type system & contracts)                  │
└─────────────────────────────────────────────────────┘
```

### Library Documentation Index

Each library has a dedicated `CLAUDE.md` file with architecture details, usage patterns, and integration examples:

#### **Applications** (2)

- **[ptah-extension-vscode](apps/ptah-extension-vscode/CLAUDE.md)** - Main VS Code extension with command handlers, webview providers, and DI orchestration
- **[ptah-extension-webview](apps/ptah-extension-webview/CLAUDE.md)** - Angular 20+ SPA with signal-based navigation and zoneless change detection

#### **Backend Libraries** (7)

- **[shared](libs/shared/CLAUDE.md)** - Type system foundation: Branded types (SessionId, MessageId), message protocol (94 types), AI provider abstractions
- **[vscode-core](libs/backend/vscode-core/CLAUDE.md)** - Infrastructure layer: DI tokens (60+), API wrappers, logging, error handling, RPC infrastructure, agent session watching
- **[agent-sdk](libs/backend/agent-sdk/CLAUDE.md)** - Official Claude Agent SDK integration (10x faster than CLI): IAIProvider implementation, session storage, message transformation, streaming
- **[agent-generation](libs/backend/agent-generation/CLAUDE.md)** - Intelligent agent generation: Template storage, content generation, validation, agent selection, setup status tracking
- **[llm-abstraction](libs/backend/llm-abstraction/CLAUDE.md)** - Multi-provider LLM abstraction (Langchain): Anthropic, OpenAI, Google Gemini, OpenRouter, VS Code LM, streaming support
- **[template-generation](libs/backend/template-generation/CLAUDE.md)** - Template processing: Variable interpolation, Zod validation, LLM-powered expansion, caching, frontmatter parsing
- **[vscode-lm-tools](libs/backend/vscode-lm-tools/CLAUDE.md)** - VS Code LM Tools & MCP server: Code Execution MCP, Ptah API namespaces (workspace, search, symbols, diagnostics, git, ai, files, commands)
- **[workspace-intelligence](libs/backend/workspace-intelligence/CLAUDE.md)** - Workspace analysis: Project detection (13+ types), file indexing, context orchestration, token optimization

#### **Frontend Libraries** (5)

- **[core](libs/frontend/core/CLAUDE.md)** - Service layer: AppStateManager, VSCodeService, WebviewNavigationService, ClaudeRpcService, signal-based state management, discovery facades
- **[chat](libs/frontend/chat/CLAUDE.md)** - Chat UI: 48+ components (Atomic Design), ExecutionNode architecture, ChatStore, streaming text reveal, autocomplete
- **[dashboard](libs/frontend/dashboard/CLAUDE.md)** - Performance dashboard: Real-time metrics, cost/token charts, agent performance tracking, activity feed
- **[setup-wizard](libs/frontend/setup-wizard/CLAUDE.md)** - Agent setup wizard: 6-step codebase scanning, project analysis, agent selection, rule generation
- **[ui](libs/frontend/ui/CLAUDE.md)** - Shared UI components: CDK Overlay-based dropdowns, popovers, autocomplete with keyboard navigation

### Dependency Rules

**Strict Layering Enforcement**:

- Libraries can only depend on layers below them
- No circular dependencies allowed
- Frontend/backend separation strictly enforced
- Type contracts defined in `shared` library only

**Dependency Flow**:

```
Apps → Feature Libs → Core Services → Domain Libs → Infrastructure → Shared (foundation)
```

### Key Design Decisions

1. **Signal-Based Reactivity**: All frontend state uses Angular signals (not RxJS BehaviorSubject)
2. **No Cross-Library Pollution**: Libraries never re-export types from other libraries
3. **Branded Types**: SessionId, MessageId prevent ID type mixing at compile time
4. **Event-Driven**: All state changes published via EventBus for reactive updates
5. **Multi-Provider**: Abstract AI provider interface enables Claude CLI + VS Code LM API
6. **Zoneless Angular**: 30% performance improvement via zoneless change detection
7. **No Angular Router**: Signal-based navigation for VS Code webview constraints

### Import Path Aliases

```typescript
'@ptah-extension/shared'; // Foundation types
'@ptah-extension/vscode-core'; // Infrastructure
'@ptah-extension/claude-domain'; // Business logic
'@ptah-extension/ai-providers-core'; // Provider abstraction
'@ptah-extension/workspace-intelligence'; // Workspace analysis
'@ptah-extension/core'; // Frontend services
'@ptah-extension/chat'; // Chat UI
'@ptah-extension/providers'; // Provider UI
'@ptah-extension/analytics'; // Analytics UI
'@ptah-extension/dashboard'; // Dashboard UI
```

### Testing Strategy

Each library has isolated test configuration:

```bash
# Run tests for specific library
nx test shared
nx test vscode-core
nx test claude-domain
nx test chat

# Run all tests
nx run-many --target=test

# Run tests with coverage
nx test <library> --coverage
```

### Build System

**Nx Workspace** with:

- esbuild for backend libraries (CommonJS)
- Angular CLI for frontend libraries
- Parallel execution for maximum performance
- Incremental builds with computation caching

### Quick Navigation

For detailed information about any library:

1. Navigate to `libs/<category>/<library>/CLAUDE.md`
2. Or `apps/<app>/CLAUDE.md` for applications
3. All files follow consistent structure:
   - Purpose & Responsibility
   - Key Components
   - Quick Start Examples
   - Dependencies
   - Testing Approach
   - File Locations

### Workspace Stats

- **Total Projects**: 12 (2 apps + 10 libraries)
- **Total Components**: 48+ Angular components
- **Total Services**: 40+ backend/frontend services
- **TypeScript Files**: 280+ source files
- **Test Coverage Target**: 80% minimum
- **Dependency Tokens**: 60+ DI tokens
- **Message Types**: 94 distinct message types

For workspace-wide operations, consult the [Nx CLI documentation](#general-guidelines-for-working-with-nx) above.

## **IMPORTANT**: There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations. Always use full paths for all of our Read/Write/Modify operations

## 🎯 ORCHESTRATION & WORKFLOW

**For complete orchestration workflow, task management, and git commit standards, see:**

# ORCHESTRATION & WORKFLOW RULES

## YOUR ROLE: ORCHESTRATOR & MANAGER

**CRITICAL**: You are the **orchestrator and manager**, NOT the implementer. Your primary responsibility is to:

1. **Delegate to Specialist Agents** - ALWAYS use the Task tool to invoke specialist agents for implementation work
2. **Coordinate Workflows** - Manage the flow between agents, handle validation checkpoints, track progress
3. **Verify Quality** - Ensure agents complete tasks correctly, validate deliverables, enforce standards
4. **Never Implement Directly** - Avoid writing code, creating files, or implementing features yourself
5. **Strategic Planning** - Analyze tasks, choose strategies, break down complex work into agent-appropriate units

### When to Use Agents (ALWAYS)

**Rule of Thumb**: If the user request involves ANY of the following, use `/orchestrate` or invoke agents directly:

- Writing code (use backend-developer or frontend-developer)
- Creating new features (use project-manager architect team-leader developers)
- Fixing bugs (use team-leader developers senior-tester)
- Refactoring code (use software-architect team-leader developers)
- Testing functionality (use senior-tester)
- Reviewing code style and patterns (use code-style-reviewer)
- Reviewing business logic and completeness (use code-logic-reviewer)
- Researching technical solutions (use researcher-expert)
- Designing architecture (use software-architect)
- Planning tasks (use project-manager)
- Analyzing future improvements (use modernization-detector)

### When You Can Work Directly (RARELY)

Only handle tasks directly when they are:

- Simple information retrieval (reading files, searching code)
- Answering questions about existing code
- Navigating documentation
- Explaining concepts
- Coordinating between user and agents

**Default Behavior**: When in doubt, delegate to agents via `/orchestrate` or direct Task tool invocation.

---

## ORCHESTRATOR WORKFLOW

### Architecture: Direct Orchestration Pattern

**Components**:

1. **Slash Command** (.claude/commands/orchestrate.md): Complete orchestration logic
2. **Main Thread (you)**: **YOU ARE THE ORCHESTRATOR** - you execute all coordination directly
   - Execute Phase 0 (task ID generation, context.md creation)
   - Analyze task type, determine dynamic strategy
   - Invoke specialist agents directly
   - Manage user validation checkpoints
   - Track all workflow state
3. **Team Leader Agent** (.claude/agents/team-leader.md): Task decomposition & assignment coordinator
   - DECOMPOSITION mode: Breaks implementation plans into atomic tasks
   - ASSIGNMENT mode: Assigns tasks to developers with git verification
   - COMPLETION mode: Validates all tasks complete, triggers final review
4. **Specialist Agents**: project-manager, researcher, architect, developers, senior-tester, code-style-reviewer, code-logic-reviewer

**Key Insight**: No separate orchestrator agent. Main thread (you) has all orchestration logic built-in, making decisions directly using tools.

### Execution Flow

```
User: /orchestrate [task]
|
You (Main Thread - THE ORCHESTRATOR):
  1. Read task-tracking/registry.md
  2. Generate TASK_2025_XXX
  3. Create context.md
  4. Analyze task type & complexity
  5. Choose execution strategy
|
You: Invoke project-manager directly
|
PM: Returns requirements (task-description.md)
|
You: Ask USER for validation
|
User: "APPROVED "
|
You: Invoke software-architect directly
|
Architect: Returns implementation-plan.md
|
You: Ask USER for validation
|
User: "APPROVED "
|
You: Invoke team-leader MODE 1 (DECOMPOSITION)
|
Team Leader: Creates tasks.md with atomic tasks
|
You: Invoke team-leader MODE 2 (ASSIGNMENT - first task)
|
Team Leader: "ASSIGN TASK 1 to [developer]"
|
You: Invoke developer with task details
|
Developer: Implements code, commits git
|
You: Invoke team-leader MODE 2 (VERIFICATION+ASSIGNMENT)
|
Team Leader: Verifies git commit , assigns next task
|
... repeat MODE 2 loop for each task
|
You: Invoke team-leader MODE 3 (COMPLETION)
|
Team Leader: Final verification, all tasks complete
|
You: Ask USER for QA choice
|
User: "all" (tester + style-reviewer + logic-reviewer)
|
You: Invoke senior-tester AND code-style-reviewer AND code-logic-reviewer in PARALLEL
|
You: Guide user through git operations
|
You: Invoke modernization-detector
|
You: Present final summary - WORKFLOW COMPLETE <
```

### Dynamic Task-Type Strategies

- **FEATURE**: PM USER VALIDATES [Research] [UI/UX Designer] Architect USER VALIDATES Team Leader (3 modes) USER CHOOSES QA (tester/style/logic/all) Modernization
- **BUGFIX**: Team Leader (3 modes) USER CHOOSES QA (skip PM/Architect - requirements clear)
- **REFACTORING**: Architect USER VALIDATES Team Leader (3 modes) USER CHOOSES QA
- **DOCUMENTATION**: PM USER VALIDATES Developer Style Reviewer
- **RESEARCH**: Researcher [conditional implementation]

### Usage

```bash
/orchestrate implement WebSocket integration    # New feature
/orchestrate fix auth token bug                 # Bug fix
/orchestrate refactor user service              # Refactoring
/orchestrate TASK_2025_001                      # Continue task
```

**How It Works**:

1. You receive `/orchestrate` command
2. **You execute Phase 0 directly** (read registry, create context.md, analyze task)
3. **You choose execution strategy** based on task type analysis
4. **You invoke agents directly** following chosen strategy
5. **You handle user validation** (PM & Architect deliverables)
6. **You manage team-leader 3-mode loop** (DECOMPOSITION ITERATIVE ASSIGNMENT COMPLETION)
7. **You handle QA choice** (user decides: tester/reviewer/both/skip)
8. **You guide git operations** (user handles when ready)
9. **You invoke modernization-detector** for future work analysis
10. **You present final summary** when all phases complete

**Benefits**:

- **Faster**: No orchestrator agent overhead
- **More Reliable**: Direct tool access (Read, Write, Glob, Bash) prevents hallucination
- **Simpler**: One less abstraction layer
- **Clearer**: User sees direct progress
- **Less Context**: No copying results between agents

---

## WORKFLOW PROTOCOL

### Before ANY Request

**MANDATORY PROTOCOL**: For EVERY user request, follow these steps:

1. **Check Registry**: Read `task-tracking/registry.md` to understand current project state
2. **Analyze Request Type**: Classify the request (feature, bug, refactor, research, etc.)
3. **Choose Delegation Strategy**:
   - **Implementation work (90% of requests)** Use `/orchestrate [description]` (creates new task) OR `/orchestrate TASK_2025_XXX` (continues existing)
   - **Quick information retrieval (10% of requests)** Answer directly (file reading, code search, explanations)
4. **Present Context**: Show user the plan before proceeding

   ```
   = Request Analysis:
   - Type: [FEATURE|BUGFIX|REFACTORING|etc]
   - Complexity: [Simple|Medium|Complex]
   - Strategy: [Agent workflow you'll use]
   - Task ID: [TASK_2025_XXX or "New task"]

   Proceeding with agent delegation...
   ```

### Mandatory Delegation Rules

**YOU MUST USE AGENTS FOR**:

- L **NEVER** write code yourself Use backend-developer or frontend-developer
- L **NEVER** create implementation files Use team-leader developers
- L **NEVER** fix bugs yourself Use team-leader developers senior-tester
- L **NEVER** design architecture yourself Use software-architect
- L **NEVER** plan features yourself Use project-manager
- L **NEVER** write tests yourself Use senior-tester
- L **NEVER** review code yourself Use code-style-reviewer and/or code-logic-reviewer

**YOUR RESPONSIBILITIES**:

- Invoke `/orchestrate` for complex multi-phase work
- Invoke agents directly via Task tool for single-phase work
- Manage validation checkpoints (ask user for approval)
- Track workflow state and progress
- Verify agent deliverables
- Coordinate between agents
- Handle errors and escalations

### Agent Selection Matrix

| Request Type     | Agent Path                                      | Trigger                |
| ---------------- | ----------------------------------------------- | ---------------------- |
| Implement X      | project-manager → architect → team-leader → dev | New features           |
| Fix bug          | team-leader → dev → test → review               | Bug reports            |
| Research X       | researcher-expert → architect                   | Technical questions    |
| Review style     | code-style-reviewer                             | Pattern checks         |
| Review logic     | code-logic-reviewer                             | Completeness checks    |
| Test X           | senior-tester                                   | Testing                |
| Architecture     | software-architect                              | Design                 |
| **Landing page** | **ui-ux-designer → technical-content-writer**   | **Marketing pages**    |
| **Brand/visual** | **ui-ux-designer**                              | **Design system**      |
| **Content**      | **technical-content-writer**                    | **Blogs, docs, video** |

**Default**: When uncertain, use `/orchestrate`

---

## CREATIVE WORKFLOW ORCHESTRATION

### Design-First Principle

**CRITICAL**: For any content or marketing work, **design system MUST exist first**.

```
┌─────────────────────────────────────────────────────────────────┐
│  CREATIVE WORKFLOW DEPENDENCY CHAIN                             │
│                                                                 │
│  1. DESIGN SYSTEM (Foundation)                                  │
│     └── ui-ux-designer creates if missing                       │
│         └── Output: .claude/skills/technical-content-writer/    │
│                     DESIGN-SYSTEM.md                            │
│                                                                 │
│  2. CONTENT GENERATION (Depends on #1)                          │
│     └── technical-content-writer uses design system             │
│         └── Output: Design-integrated content specs             │
│                                                                 │
│  3. IMPLEMENTATION (Depends on #1 and #2)                       │
│     └── frontend-developer implements with specs                │
└─────────────────────────────────────────────────────────────────┘
```

### Automatic Design System Check

**BEFORE invoking technical-content-writer for landing pages, run this check:**

```bash
# Check if design system exists
design_system_path=".claude/skills/technical-content-writer/DESIGN-SYSTEM.md"

if NOT exists(design_system_path):
    → Invoke ui-ux-designer FIRST
    → "Create design system for this project"
    → Wait for completion
    → Then invoke technical-content-writer

if exists(design_system_path):
    → Invoke technical-content-writer directly
    → Content will use existing design system
```

### Creative Request Detection

**Trigger phrases that require creative workflow:**

| User Says                         | Workflow                               |
| --------------------------------- | -------------------------------------- |
| "Create landing page"             | Design check → ui-ux → content-writer  |
| "Design our homepage"             | Design check → ui-ux → content-writer  |
| "Marketing content for..."        | Design check → content-writer          |
| "Visual design for..."            | ui-ux-designer                         |
| "Brand identity"                  | ui-ux-designer (full discovery)        |
| "Write a blog post"               | content-writer (design check optional) |
| "Video script for..."             | content-writer                         |
| "What should our site look like?" | ui-ux-designer (discovery)             |

### Creative Workflow Execution

#### Workflow A: Full Creative (Landing Page, Marketing Site)

```
User: "Create a landing page for our extension"

You (Orchestrator):
  1. Check design system exists
     Read(.claude/skills/technical-content-writer/DESIGN-SYSTEM.md)

  2. IF MISSING → Invoke ui-ux-designer:
     Task("Create design system", subagent_type="ui-ux-designer")
     - Agent loads NICHE-DISCOVERY.md skill
     - Agent guides user through aesthetic discovery
     - Agent creates DESIGN-SYSTEM.md
     - Wait for completion

  3. Invoke technical-content-writer:
     Task("Create landing page content", subagent_type="technical-content-writer")
     - Agent loads LANDING-PAGES.md skill
     - Agent loads DESIGN-SYSTEM.md
     - Agent creates design-integrated content

  4. Deliver combined output:
     - Design system (if created)
     - Content specification with visual specs
     - Asset generation briefs
```

#### Workflow B: Content Only (Blog, Docs, Video)

```
User: "Write a blog post about the SDK"

You (Orchestrator):
  1. Design system check (OPTIONAL for blogs)
     - If exists, content-writer can reference it
     - If missing, proceed without (text-focused content)

  2. Invoke technical-content-writer:
     Task("Write blog post about SDK", subagent_type="technical-content-writer")
     - Agent loads BLOG-POSTS.md skill
     - Agent investigates codebase
     - Agent creates evidence-backed content
```

#### Workflow C: Design System Only

```
User: "Help me define our visual identity"

You (Orchestrator):
  1. Invoke ui-ux-designer:
     Task("Create design system with full discovery", subagent_type="ui-ux-designer")
     - Agent loads NICHE-DISCOVERY.md
     - Agent loads DESIGN-SYSTEM-BUILDER.md
     - Agent guides through discovery questions
     - Agent creates complete design system
```

### Parallel vs Sequential

**Sequential (Default for Creative)**:

- Design system MUST complete before content
- Content informs implementation

**Parallel (When Design Exists)**:

- Multiple content pieces can be created in parallel
- Different content types (blog + video) can run simultaneously

```
# Sequential (design missing)
ui-ux-designer → technical-content-writer → frontend-developer

# Parallel (design exists)
┌→ technical-content-writer (landing page)
├→ technical-content-writer (blog post)
└→ technical-content-writer (video script)
```

### Output Locations

| Agent                    | Output File                                                | Purpose                           |
| ------------------------ | ---------------------------------------------------------- | --------------------------------- |
| ui-ux-designer           | `.claude/skills/technical-content-writer/DESIGN-SYSTEM.md` | Design tokens, colors, typography |
| ui-ux-designer           | `task-tracking/TASK_[ID]/visual-design-specification.md`   | Page-specific visual specs        |
| technical-content-writer | `task-tracking/TASK_[ID]/content-specification.md`         | Content with design integration   |
| technical-content-writer | `docs/content/*.md`                                        | Final content files               |

### Handoff Protocol

**ui-ux-designer → technical-content-writer:**

```markdown
## Design Handoff for Content

**Design System**: .claude/skills/technical-content-writer/DESIGN-SYSTEM.md
**Aesthetic**: [Name - e.g., "Sacred Tech"]
**Key Colors**: [Primary accent, backgrounds]
**Typography**: [Display + body fonts]
**Animation Patterns**: [Key effects to reference]

Content writer should:

- Reference DESIGN-SYSTEM.md for all visual specs
- Use LANDING-PAGES.md templates with design integration
- Include animation/effect specifications in content
```

**technical-content-writer → frontend-developer:**

```markdown
## Content Handoff for Implementation

**Content Spec**: task-tracking/TASK\_[ID]/content-specification.md
**Design System**: .claude/skills/technical-content-writer/DESIGN-SYSTEM.md
**Assets Needed**: [List from asset briefs]

Developer should:

- Implement content following visual specs
- Use design system tokens exactly
- Generate/source assets from briefs
```

---

## TASK MANAGEMENT

### Task ID Format

`TASK_YYYY_NNN` - Sequential format (TASK_2025_001, TASK_2025_002, etc.)

### Folder Structure

```
task-tracking/
  TASK_[ID]/
     context.md            # User intent, conversation summary
     task-description.md   # Requirements
     implementation-plan.md # Design
     tasks.md              # Atomic task breakdown & assignments (team-leader managed)
     test-report.md        # Testing
     code-review.md        # Review
     future-enhancements.md # Future work
```

---

## GIT OPERATIONS & COMMIT STANDARDS

**CRITICAL**: All commits MUST follow commitlint rules to pass pre-commit hooks.

### Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Allowed Types (REQUIRED)

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style (formatting, no logic change)
- `refactor`: Code restructuring (no bug fix or feature)
- `perf`: Performance improvements
- `test`: Adding/updating tests
- `build`: Build system/dependency changes
- `ci`: CI configuration changes
- `chore`: Maintenance tasks (no src/test changes)
- `revert`: Revert previous commit

### Allowed Scopes (REQUIRED)

- `webview`: Webview (Angular SPA) changes
- `vscode`: VS Code extension changes
- `vscode-lm-tools`: VS Code LM tools library changes
- `deps`: Dependency updates
- `release`: Release-related changes
- `ci`: CI/CD changes
- `docs`: Documentation changes
- `hooks`: Git hooks changes
- `scripts`: Script changes

### Commit Rules (ENFORCED)

- Type: lowercase, required, from allowed list
- Scope: lowercase, required, from allowed list
- Subject:
- lowercase only (NOT Sentence-case, Start-case, UPPER-CASE)
- 3-72 characters
- No period at end
- Imperative mood ("add" not "added")
- Header: max 100 characters total
- Body/Footer lines: max 100 characters each

### Valid Examples

```bash
feat(webview): add semantic search for chat messages
fix(vscode): resolve webview communication timeout issue
docs(webview): update component usage examples
refactor(hooks): simplify pre-commit validation
chore(deps): update @angular/core to v20.1.2
```

### Invalid Examples (WILL FAIL)

```bash
L "Feature: Add search" # Wrong type, wrong case
L "feat: Add search"    # Missing scope
L "feat(search): Add search" # Invalid scope (not in allowed list), wrong case
L "feat(webview): Add search." # Period at end
L "feat(webview): Add Search" # Uppercase in subject
```

### Branch & PR Operations

```bash
# New task (orchestrator handles this)
git checkout -b feature/TASK_2025_XXX
git push -u origin feature/TASK_2025_XXX

# Continue task
git checkout feature/TASK_2025_XXX
git pull origin feature/TASK_2025_XXX --rebase

# Commit changes
git add .
git commit -m "type(scope): description"

# Complete task (orchestrator handles this)
gh pr create --title "type(scope): description"
```

### Pre-commit Checks

All commits automatically run:

1. **lint-staged** (no auto-stash): Format & lint staged files
2. **typecheck:affected**: Type-check changed libraries
3. **commitlint**: Validate commit message format

### Commit Hook Failure Protocol

**CRITICAL**: When a commit hook fails, ALWAYS stop and ask the user to choose:

```
 Pre-commit hook failed: [specific error]

Please choose how to proceed:

1. **Fix Issue** - I'll fix the issue if it's related to current work
   (Use for: lint errors, type errors, commit message format issues in current changes)

2. **Bypass Hook** - Commit with --no-verify flag
   (Use for: Unrelated errors in other files, blocking issues outside current scope)

3. **Stop & Report** - Mark as blocker and escalate
   (Use for: Critical infrastructure issues, complex errors requiring investigation)

Which option would you like? (1/2/3)
```

**Agent Behavior**:

- NEVER automatically bypass hooks with --no-verify
- NEVER automatically fix issues without user consent
- NEVER proceed with alternative approaches without user decision
- ALWAYS present the 3 options and wait for user choice
- Document the chosen option in task tracking if option 2 or 3 is selected

**Example Scenarios**:

```bash
# Scenario 1: Lint error in current file
User chooses: Option 1 (Fix Issue)
Action: Run npm run lint:fix, verify, retry commit

# Scenario 2: Type error in unrelated library
User chooses: Option 2 (Bypass Hook)
Action: git commit --no-verify -m "message"
Document: Add note to tasks.md about bypassed hook

# Scenario 3: Complex build failure
User chooses: Option 3 (Stop & Report)
Action: Mark current task as blocked, create detailed error report
```

**NEVER run destructive git commands** (reset, force push, rebase --hard, etc.) that cause data loss.
