# PTAH PROJECT SPECIFICS

## Project Overview

**Ptah** is an AI coding orchestra for VS Code, powered by Claude Agent SDK. Built with TypeScript and Angular webviews, it provides intelligent workspace analysis, project-adaptive AI agents, and a built-in MCP server — all natively integrated into VS Code.

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

### License Server & Database

```bash
# Start database services (PostgreSQL + Redis)
npm run docker:db:start

# Run Prisma migrations
npm run prisma:migrate:dev

# Open Prisma Studio
npm run prisma:studio

# Start license server
nx serve ptah-license-server
```

## Tech Stack

- **Language**: TypeScript 5.8.2 (strict mode)
- **Extension Runtime**: Node.js, VS Code API 1.103.0
- **Frontend**: Angular 20.1.0 (zoneless, standalone components), TailwindCSS 3.4, DaisyUI 4.12
- **Backend**: NestJS 11.0.0, Prisma 7.1.0, PostgreSQL 16, Redis 7
- **AI/LLM**: Claude Agent SDK 0.2.25, Langchain (Anthropic, OpenAI, Google Gemini, OpenRouter)
- **DI**: tsyringe 4.10.0 with reflect-metadata
- **Build**: Nx 21.4/22.1, Webpack 5, esbuild, ng-packagr
- **Testing**: Jest 30.0.2, jest-preset-angular
- **Linting**: ESLint 9.8 (flat config), Prettier 2.6, commitlint, husky
- **Payments**: Paddle 1.6/2.0
- **Auth**: WorkOS 7.77 (enterprise SSO)
- **Icons**: Lucide Angular 0.542
- **Markdown**: ngx-markdown 21.0, prismjs
- **Animations**: GSAP 3.14, @hive-academy/angular-gsap 1.1

---

## WORKSPACE ARCHITECTURE & LIBRARY MAP

### Overview

The Ptah workspace is organized as an Nx monorepo with **6 apps + 12 libraries** following a strict layered architecture pattern.

### Architecture Layers

```
+-----------------------------------------------------+
|  Applications Layer                                  |
|  - ptah-extension-vscode (VS Code extension)        |
|  - ptah-extension-webview (Angular SPA)             |
|  - ptah-landing-page (Marketing site)               |
|  - ptah-license-server (NestJS + Prisma)            |
+-----------------------------------------------------+
|  Frontend Feature Libraries                          |
|  - chat, providers, analytics, dashboard            |
+-----------------------------------------------------+
|  Frontend Core Services                              |
|  - core (state, services, VS Code integration)      |
+-----------------------------------------------------+
|  Backend Domain Libraries                            |
|  - claude-domain (business logic)                    |
|  - ai-providers-core (multi-provider abstraction)    |
|  - workspace-intelligence (workspace analysis)       |
+-----------------------------------------------------+
|  Infrastructure Layer                                |
|  - vscode-core (DI container, API wrappers)         |
+-----------------------------------------------------+
|  Foundation Layer                                    |
|  - shared (type system & contracts)                  |
+-----------------------------------------------------+
```

### Library Documentation Index

Each library has a dedicated `CLAUDE.md` file with architecture details, usage patterns, and integration examples:

#### **Applications** (6)

- **[ptah-extension-vscode](apps/ptah-extension-vscode/CLAUDE.md)** - Main VS Code extension with command handlers, webview providers, and DI orchestration
- **[ptah-extension-webview](apps/ptah-extension-webview/CLAUDE.md)** - Angular 20+ SPA with signal-based navigation and zoneless change detection
- **[ptah-landing-page](apps/ptah-landing-page/CLAUDE.md)** - Marketing landing page (Angular) with 3D scenes and GSAP animations
- **[ptah-license-server](apps/ptah-license-server/CLAUDE.md)** - License management API (NestJS + Prisma + PostgreSQL) with Paddle subscriptions and WorkOS auth
- **[ptah-license-server-e2e](apps/ptah-license-server-e2e/CLAUDE.md)** - End-to-end tests for the license server
- **[infra-test](apps/infra-test/CLAUDE.md)** - Infrastructure testing application

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
Apps -> Feature Libs -> Core Services -> Domain Libs -> Infrastructure -> Shared (foundation)
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

- **Total Projects**: 18 (6 apps + 12 libraries)
- **Total Components**: 48+ Angular components
- **Total Services**: 40+ backend/frontend services
- **TypeScript Files**: 280+ source files
- **Test Coverage Target**: 80% minimum
- **Dependency Tokens**: 60+ DI tokens
- **Message Types**: 94 distinct message types

For workspace-wide operations, consult the [Nx CLI documentation](#general-guidelines-for-working-with-nx) above.

## **IMPORTANT**: There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations. Always use full paths for all of our Read/Write/Modify operations

## ORCHESTRATION & WORKFLOW (BLOCKING REQUIREMENT)

**CRITICAL: Orchestration is the DEFAULT entry point for all engineering work.** When the user requests any implementation task (feature, bugfix, refactoring, docs, research, devops, creative), you MUST invoke the `orchestration` skill BEFORE writing any code or using EnterPlanMode. Do NOT bypass orchestration by defaulting to internal planning or direct implementation.

**The ONLY exceptions where you may skip orchestration:**

- Pure Q&A questions ("what does X do?", "explain this code")
- Single-line or trivial edits (typo fix, add a console.log, rename a variable)
- Running commands or checking status (build, test, lint, git status)
- User explicitly says "don't orchestrate" or "just do it directly"

**Skill**: `.claude/skills/orchestration/SKILL.md`
**Command**: `/orchestrate [task]` or `/orchestrate TASK_2025_XXX`

**Supported Workflows**: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, CREATIVE

**Flexible Invocation Patterns**:

- **Full**: PM -> Architect -> Team-Leader -> Developers -> QA (new features with unclear scope)
- **Partial**: Architect -> Team-Leader -> Developers (refactoring with known requirements)
- **Minimal**: Direct developer/reviewer invocation (simple fixes, quick reviews)

The skill contains all orchestration logic, agent catalog (14 agents), user checkpoints, team-leader integration (3 modes), task tracking, and git commit standards.
