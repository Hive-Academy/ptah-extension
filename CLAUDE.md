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

## 🎯 ORCHESTRATOR WORKFLOW

### Architecture: Hybrid Orchestrator-Executor Pattern

**Components**:

1. **Slash Command** (.claude/commands/orchestrate.md): Triggers workflow
2. **Main Thread (you)**: Execution engine implementing iterative loop
3. **Orchestrator Agent** (.claude/agents/workflow-orchestrator.md): GPS coordinator
   - Executes Phase 0 (git, task setup)
   - Analyzes task type, creates dynamic strategy
   - Provides turn-by-turn guidance
4. **Team Leader Agent** (.claude/agents/team-leader.md): Task decomposition & assignment coordinator
   - DECOMPOSITION mode: Breaks implementation plans into atomic tasks
   - ASSIGNMENT mode: Assigns tasks to developers with git verification
   - COMPLETION mode: Validates all tasks complete, triggers final review
5. **Specialist Agents**: project-manager, researcher, architect, developers, testers, reviewers
6. **Validation Agent**: business-analyst (quality gates)

**Key Insight**: Agents return to main thread, NOT to other agents. Orchestrator = GPS, Team Leader = project manager, Main thread = driver.

### Execution Flow

```
User: /orchestrate [task]
  ↓
You: Invoke workflow-orchestrator
  ↓
Orchestrator: "Phase 0 ✅ + INVOKE project-manager"
  ↓
You: Invoke project-manager
  ↓
PM: Returns requirements
  ↓
You: Return to orchestrator with results
  ↓
Orchestrator: "INVOKE business-analyst for validation"
  ↓
You: Invoke business-analyst
  ↓
BA: APPROVED ✅
  ↓
You: Return to orchestrator
  ↓
Orchestrator: "INVOKE software-architect"
  ↓
You: Invoke software-architect
  ↓
Architect: Returns implementation-plan.md
  ↓
You: Return to orchestrator with results
  ↓
Orchestrator: "INVOKE team-leader"
  ↓
You: Invoke team-leader (DECOMPOSITION mode)
  ↓
Team Leader: Creates tasks.md with atomic tasks
  ↓
You: Return to orchestrator
  ↓
Orchestrator: "INVOKE team-leader (ASSIGNMENT)"
  ↓
You: Invoke team-leader (ASSIGNMENT mode)
  ↓
Team Leader: "ASSIGN TASK [N] to senior-developer"
  ↓
You: Invoke senior-developer with task
  ↓
Developer: Implements code
  ↓
You: Verify git commit exists
  ↓
You: Return to team-leader with results
  ↓
Team Leader: Updates tasks.md, assigns next task OR "COMPLETION"
  ↓
... repeat assignment loop until all tasks complete
  ↓
You: Return to orchestrator
  ↓
Orchestrator: "INVOKE senior-tester"
  ↓
... continue until "WORKFLOW COMPLETE"
```

### Dynamic Task-Type Strategies

- **FEATURE**: PM → Research → Architect → Team Leader (Decomposition) → Team Leader (Assignment Loop) → Test → Review → Modernization
- **BUGFIX**: Team Leader (Decomposition) → Team Leader (Assignment Loop) → Test → Review
- **REFACTORING**: Architect → Team Leader (Decomposition) → Team Leader (Assignment Loop) → Test → Review
- **DOCUMENTATION**: PM → Team Leader (Decomposition) → Team Leader (Assignment Loop) → Review
- **RESEARCH**: Researcher → conditional implementation (Team Leader if code needed)

### Usage

```bash
/orchestrate implement WebSocket integration    # New feature
/orchestrate fix auth token bug                 # Bug fix
/orchestrate refactor user service              # Refactoring
/orchestrate TASK_2025_001                      # Continue task
```

**Workflow Steps**:

1. You receive command → invoke workflow-orchestrator
2. Orchestrator returns: "NEXT ACTION: INVOKE [agent] with [prompt]"
3. You invoke recommended agent
4. Agent returns results
5. You return to orchestrator with results
6. **Team Leader Iterative Loop** (when in ASSIGNMENT mode):
   - Team Leader assigns task to developer
   - You invoke developer with task details
   - Developer implements and commits code
   - You verify git commit exists before returning to Team Leader
   - Team Leader updates tasks.md and assigns next task OR signals COMPLETION
   - Repeat until all tasks complete
7. Repeat orchestrator loop until "WORKFLOW COMPLETE"

---

## 🚨 WORKFLOW PROTOCOL

### Before ANY Request

1. **Check Registry**: `cat task-tracking/registry.md`
2. **Present Context**: Show active/pending/complete tasks
3. **Route Decision**:
   - Complex work → `/orchestrate [description]`
   - Continue task → `/orchestrate TASK_2025_XXX`
   - Quick fix → Only if user confirms

### Agent Selection Matrix

| Request Type | Agent Path                                      | Trigger             |
| ------------ | ----------------------------------------------- | ------------------- |
| Implement X  | project-manager → architect → team-leader → dev | New features        |
| Fix bug      | team-leader → dev → test → review               | Bug reports         |
| Research X   | researcher-expert → architect                   | Technical questions |
| Review code  | code-reviewer                                   | Quality checks      |
| Test X       | senior-tester                                   | Testing             |
| Architecture | software-architect                              | Design              |

**Default**: When uncertain, use `/orchestrate`

---

## 📁 Task Management

### Task ID Format

`TASK_YYYY_NNN` - Sequential format (TASK_2025_001, TASK_2025_002, etc.)

### Folder Structure

```
task-tracking/
  TASK_[ID]/
    ├── context.md            # User intent, conversation summary
    ├── task-description.md   # Requirements
    ├── implementation-plan.md # Design
    ├── tasks.md              # Atomic task breakdown & assignments (team-leader managed)
    ├── test-report.md        # Testing
    ├── code-review.md        # Review
    └── future-enhancements.md # Future work
```

### Git Operations & Commit Standards

**CRITICAL**: All commits MUST follow commitlint rules to pass pre-commit hooks.

#### Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

#### Allowed Types (REQUIRED)

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

#### Allowed Scopes (REQUIRED)

- `chromadb`: ChromaDB library changes
- `neo4j`: Neo4j library changes
- `langgraph`: LangGraph modules changes
- `deps`: Dependency updates
- `release`: Release-related changes
- `ci`: CI/CD changes
- `docs`: Documentation changes
- `hooks`: Git hooks changes
- `scripts`: Script changes
- `angular-3d`: Angular 3D UI changes

#### Commit Rules (ENFORCED)

- ✅ Type: lowercase, required, from allowed list
- ✅ Scope: lowercase, required, from allowed list
- ✅ Subject:
  - lowercase only (NOT Sentence-case, Start-case, UPPER-CASE)
  - 3-72 characters
  - No period at end
  - Imperative mood ("add" not "added")
- ✅ Header: max 100 characters total
- ✅ Body/Footer lines: max 100 characters each

#### Valid Examples

```bash
feat(chromadb): add semantic search for documents
fix(neo4j): resolve connection timeout issue
docs(langgraph): update workflow examples
refactor(hooks): simplify pre-commit validation
chore(deps): update langchain to v0.3.30
```

#### Invalid Examples (WILL FAIL)

```bash
❌ "Feature: Add search" # Wrong type, wrong case
❌ "feat: Add search"    # Missing scope
❌ "feat(search): Add search" # Invalid scope, wrong case
❌ "feat(chromadb): Add search." # Period at end
❌ "feat(chromadb): Add Search" # Uppercase in subject
```

#### Branch & PR Operations

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

#### Pre-commit Checks

All commits automatically run:

1. **lint-staged** (no auto-stash): Format & lint staged files
2. **typecheck:affected**: Type-check changed libraries
3. **commitlint**: Validate commit message format

#### Commit Hook Failure Protocol

**CRITICAL**: When a commit hook fails, ALWAYS stop and ask the user to choose:

```
⚠️ Pre-commit hook failed: [specific error]

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
│  - chat, session, providers, analytics, dashboard   │
├─────────────────────────────────────────────────────┤
│  Frontend Core Services                              │
│  - core (state, services, VS Code integration)      │
│  - shared-ui (reusable components)                   │
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

#### **Backend Libraries** (4)

- **[shared](libs/shared/CLAUDE.md)** - Type system foundation: Branded types (SessionId, MessageId), message protocol (94 types), AI provider abstractions
- **[vscode-core](libs/backend/vscode-core/CLAUDE.md)** - Infrastructure layer: DI container (60+ tokens), API wrappers (CommandManager, WebviewManager), EventBus, Logger
- **[claude-domain](libs/backend/claude-domain/CLAUDE.md)** - Business logic: CLI integration, session management, orchestration services, permission handling
- **[ai-providers-core](libs/backend/ai-providers-core/CLAUDE.md)** - Multi-provider abstraction: Intelligent provider selection, context management, Claude CLI & VS Code LM adapters
- **[workspace-intelligence](libs/backend/workspace-intelligence/CLAUDE.md)** - Workspace analysis: Project detection (13+ types), file indexing, token optimization

#### **Frontend Libraries** (7)

- **[core](libs/frontend/core/CLAUDE.md)** - Service layer: AppStateManager, VSCodeService, ChatService, signal-based state management
- **[chat](libs/frontend/chat/CLAUDE.md)** - Chat UI: 11 components for message display, input, streaming, session management
- **[session](libs/frontend/session/CLAUDE.md)** - Session management: SessionSelector, SessionCard, session lifecycle operations
- **[providers](libs/frontend/providers/CLAUDE.md)** - Provider UI: Provider selection, health monitoring, capabilities display
- **[analytics](libs/frontend/analytics/CLAUDE.md)** - Analytics dashboard: Usage statistics, performance metrics visualization
- **[dashboard](libs/frontend/dashboard/CLAUDE.md)** - Performance dashboard: Real-time metrics, historical trends, activity feed
- **[shared-ui](libs/frontend/shared-ui/CLAUDE.md)** - Component library: 12 reusable components with VS Code theming and accessibility

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
'@ptah-extension/session'; // Session UI
'@ptah-extension/providers'; // Provider UI
'@ptah-extension/analytics'; // Analytics UI
'@ptah-extension/dashboard'; // Dashboard UI
'@ptah-extension/shared-ui'; // Reusable components
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

- **Total Projects**: 14 (2 apps + 12 libraries)
- **Total Components**: 50+ Angular components
- **Total Services**: 40+ backend/frontend services
- **TypeScript Files**: 300+ source files
- **Test Coverage Target**: 80% minimum
- **Dependency Tokens**: 60+ DI tokens
- **Message Types**: 94 distinct message types

For workspace-wide operations, consult the [Nx CLI documentation](#general-guidelines-for-working-with-nx) above.
