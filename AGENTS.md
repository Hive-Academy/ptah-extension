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

### Angular Webview Development

```bash
# Install webview dependencies
npm run install:webview

# Build webview for extension
npm run build:webview

# Watch mode for webview development
npm run dev:webview

# Quality assurance
npm run lint:webview
npm run typecheck:webview
npm run test:webview
```

### Extension Testing

Press `F5` in VS Code to launch Extension Development Host for testing.

## Architecture

### Dual-Architecture System

- **Extension Host** (`src/`) - TypeScript VS Code extension with registry-based service architecture
- **Angular Webview** (`webview/ptah-webview/`) - Angular 20+ app with standalone components and zoneless change detection

### Key Extension Components

- **PtahExtension** (`src/core/ptah-extension.ts`) - Main coordinator using registry pattern
- **ServiceRegistry** (`src/core/service-registry.ts`) - Dependency injection container
- **ClaudeCliService** (`src/services/claude-cli.service.ts`) - Claude Code CLI integration with streaming
- **Message Handlers** (`src/services/webview-message-handlers/`) - Extension ↔ Webview communication

### Angular Webview Architecture

- **Angular 20.2+** with zoneless change detection
- **Standalone components** throughout
- **Tailwind CSS** with Egyptian-themed custom components
- **Hash-based routing** for webview compatibility
- **Shared components** in `src/app/shared/`

## Type System & Import Standards

### Shared Types

All shared types defined in `src/types/common.types.ts`:

- **ChatMessage** - Core messaging with streaming support
- **ChatSession** - Session management with token tracking
- **CommandTemplate** - Visual command builder templates
- **ContextInfo** - File inclusion/optimization suggestions

### Import Patterns

```typescript
// Extension code (relative imports)
import { Logger } from '../core/logger';
import { ChatMessage } from '../types/common.types';

// Angular webview (standard Angular patterns)
import { Component } from '@angular/core';
import { SHARED_COMPONENTS } from '../shared';
```

### VS Code Integration Points

- **Activity Bar** - Ptah icon (📜) main entry point
- **Commands** - Command palette integration (`ptah.*` commands)
- **Context Menus** - File-level actions (review, test generation)
- **Webview Communication** - Message passing for extension ↔ webview

## Quality Standards

### Code Quality & Linting

- **ESLint + Angular ESLint** with modern Angular 16+ rules
- **Signal-based APIs**: `input()`, `output()`, `viewChild()` over decorators
- **Control Flow Syntax**: `@if`, `@for`, `@switch` over structural directives
- **OnPush change detection** enforced for performance
- **Prettier formatting** with pre-commit hooks via Husky

### TypeScript Configuration

- **Strict mode enabled** with ES2020 target
- **CommonJS modules** for extension compatibility
- **Source maps** enabled for debugging
- **Separate configs** for main extension and tests

### Angular Best Practices

- **Standalone components** (no NgModules)
- **Signal-based reactivity** with computed() and effect()
- **WebView-optimized routing** with hash location strategy
- **Egyptian-themed component system** with shared design tokens

## Error Handling & Communication

### Extension Error Boundaries

- **ErrorHandler** class with contextual information
- **Service-level** error boundaries with graceful fallback
- **Logger service** with structured logging

### Webview Communication Protocol

```typescript
// Extension -> Webview
webview.postMessage({ type: 'updateChat', data: chatMessage });

// Webview -> Extension
vscode.postMessage({ type: 'sendMessage', data: { content: 'message' } });
```

## Claude CLI Integration

- **Automatic detection** via ClaudeCliDetector service
- **Process spawning** with streaming response handling
- **Session management** with workspace-aware context
- **Real-time token tracking** and optimization suggestions

## 🚨 UNIVERSAL CRITICAL CONSTRAINTS

### 🔴 ABSOLUTE REQUIREMENTS (VIOLATIONS = IMMEDIATE FAILURE)

1. **MANDATORY AGENT WORKFLOW**: Every development request MUST use `/orchestrate` command - NO direct implementation unless user explicitly confirms "quick fix only"
2. **TYPE/SCHEMA REUSE PROTOCOL**: Search existing shared/common libraries FIRST, document search in progress.md, extend existing never duplicate
3. **NO BACKWARD COMPATIBILITY**: Never target backward compatibility unless explicitly requested by user
4. **NO CROSS-LIBRARY POLLUTION**: Libraries/modules must not re-export types/services from other libraries

### 🎯 QUALITY ENFORCEMENT STANDARDS

- **Type/Schema Safety**: Zero loose types (any, object, \*, etc.) - strict typing always
- **Import Standards**: Use project-detected alias paths consistently
- **Code Size Limits**: Services <200 lines, modules <500 lines, functions <30 lines
- **Test Coverage**: Minimum 80% across line/branch/function coverage
- **Progress Tracking**: Update progress.md every 30 minutes during active development
- **Documentation**: Document architectural decisions and patterns used In their Respective files **DON'T GENERATE MORE FILES THAN NECESSARY ASK USERS BEFORE GENERATING ANY NEW DOCUMENT.**

## ⚡ AGENT WORKFLOW ORCHESTRATION

### Modular Phase-Based System

**IMPLEMENTATION**: The Ptah extension uses a modular orchestration system where each development phase is an independent `.prompt.md` file.

**For complete implementation details, see**: [MODULAR_ORCHESTRATION_SYSTEM.md](docs/MODULAR_ORCHESTRATION_SYSTEM.md)

### Sequential Execution Framework

**MANDATORY**: All agent workflows follow this pattern:

1. **User Request** → `/orchestrate "task description"` → **Task Initialization (Git + Registry)**
2. **Phase Execution** → **Phase-Specific Agent** → **Deliverable Creation**
3. **Phase Completion** → **Business Analyst Validation** → **[APPROVE/REJECT]**
4. **If APPROVE** → **Next Phase Execution** OR **Task Completion**
5. **If REJECT** → **Re-execute Same Phase with Corrections**

### Core Agent Roles (Technology Agnostic)

| Agent Role             | Symbol | Primary Responsibility                    | When to Invoke                        |
| ---------------------- | ------ | ----------------------------------------- | ------------------------------------- |
| **project-manager**    | 🪃     | Requirements analysis, strategic planning | Complex tasks, new features           |
| **business-analyst**   | 🔍     | Workflow validation, scope adherence      | After each agent (validation gates)   |
| **researcher-expert**  | 🔎     | Technical research, best practices        | Knowledge gaps, technology evaluation |
| **software-architect** | 🏗️     | System design, architecture planning      | After requirements clear              |
| **backend-developer**  | 💻     | Server-side implementation                | API, services, data layer work        |
| **frontend-developer** | 🎨     | Client-side implementation                | UI, components, user interaction      |
| **senior-tester**      | 🧪     | Quality assurance, testing strategy       | After implementation                  |
| **code-reviewer**      | 🔍     | Final quality validation                  | Before task completion                |

### Modular Phase Invocation

**Phase Prompts in** `.github/prompts/`:

- `phase1-project-manager.prompt.md` - Requirements analysis
- `phase2-researcher-expert.prompt.md` - Technical research (conditional)
- `phase3-software-architect.prompt.md` - Architecture planning
- `phase4-backend-developer.prompt.md` - Backend implementation
- `phase4-frontend-developer.prompt.md` - Frontend implementation
- `phase5-senior-tester.prompt.md` - Quality assurance
- `phase6-code-reviewer.prompt.md` - Final review
- `phase8-modernization-detector.prompt.md` - Future work consolidation
- `validation-gate.prompt.md` - Reusable validation (parameterized)

**Invocation Pattern** (in orchestrator):

```markdown
**Execute Phase Prompt**: /phase1-project-manager

**Context Variables**:

- TASK_ID: {from initialization}
- USER_REQUEST: {from user}
- BRANCH_NAME: {from git setup}

**Wait for**: Phase completion signal
```

**For detailed phase architecture, see**: [MODULAR_ORCHESTRATION_SYSTEM.md](docs/MODULAR_ORCHESTRATION_SYSTEM.md)

---

## 🎨 DEVELOPMENT STANDARDS FRAMEWORK

### Universal Architecture Principles

**SOLID Compliance (Language Agnostic):**

- **Single Responsibility**: Each component has one clear purpose
- **Open/Closed**: Extensible through interfaces/protocols/traits
- **Liskov Substitution**: All implementations honor their contracts
- **Interface Segregation**: Focused contracts for specific use cases
- **Dependency Inversion**: Depend on abstractions, not concretions

**Design Pattern Guidelines:**

- **Module Pattern**: Consistent initialization and configuration
- **Factory Pattern**: Dynamic component creation
- **Strategy Pattern**: Multiple implementations with selection logic
- **Observer/Event Pattern**: Decoupled communication between components
- **Decorator/Wrapper Pattern**: Cross-cutting concerns (logging, validation, etc.)

### Code Quality Standards

**Type/Schema Safety:**

- Comprehensive type definitions for all data structures
- Runtime validation where static typing unavailable
- Proper error handling and boundary conditions
- No escape hatches unless absolutely necessary with documentation

**Testing Strategy:**

- **Unit Tests**: Mock external dependencies, test individual components
- **Integration Tests**: Test component interactions with real services
- **E2E Tests**: Full workflow testing from user perspective
- **Performance Tests**: Validate response times and resource usage

### Error Handling Framework

**Universal Error Principles:**

- Comprehensive error boundaries at module/service levels
- Contextual error information (what failed, why, how to recover)
- Graceful degradation where possible
- Proper logging and monitoring for debugging
- User-friendly error messages with actionable guidance

---

## 📁 TASK MANAGEMENT FRAMEWORK

### Universal Task Structure

**Task ID Format**: `TASK_[DOMAIN]_[NUMBER]`

- **Domains**: CMD (command/core), INT (integration), FE (frontend), BE (backend), QA (quality), DOC (documentation)
- **Numbering**: Sequential (001, 002, 003...)

**Standard Folder Structure:**

```
task-tracking/
  TASK_[ID]/
    ├── task-description.md     # Business requirements, acceptance criteria
    ├── research-report.md      # Technical research (if needed)
    ├── implementation-plan.md  # Architecture and design
    ├── progress.md            # Real-time progress updates
    ├── test-report.md         # Testing results and coverage
    ├── code-review.md         # Quality validation
    └── completion-report.md   # Final metrics and lessons
```

### Quality Gate Framework

**Mandatory Validation at Each Phase:**

1. **Requirements Phase** (Project Manager)

   - [ ] SMART criteria compliance (Specific, Measurable, Achievable, Relevant, Time-bound)
   - [ ] BDD format acceptance criteria (Given/When/Then)
   - [ ] Comprehensive risk assessment
   - [ ] Stakeholder impact analysis

2. **Research Phase** (Researcher Expert - if needed)

   - [ ] Multiple authoritative sources (minimum 3-5)
   - [ ] Comparative analysis of approaches
   - [ ] Performance and security implications
   - [ ] Production case studies or examples

3. **Architecture Phase** (Software Architect)

   - [ ] SOLID principles compliance
   - [ ] Design pattern justification
   - [ ] Type/schema reuse documented
   - [ ] Integration strategy defined
   - [ ] Performance and scalability considerations

4. **Implementation Phase** (Developers)

   - [ ] Code compiles/builds successfully
   - [ ] Zero loose types or escape hatches
   - [ ] Comprehensive error handling
   - [ ] Unit tests written and passing
   - [ ] Performance within acceptable limits

5. **Testing Phase** (Senior Tester)

   - [ ] Coverage above minimum threshold
   - [ ] All acceptance criteria tested
   - [ ] Edge cases and error conditions covered
   - [ ] Performance benchmarks validated
   - [ ] Security testing completed

6. **Review Phase** (Code Reviewer)
   - [ ] All previous gates passed
   - [ ] Code follows project conventions
   - [ ] No critical security issues
   - [ ] Documentation adequate
   - [ ] Ready for production deployment

---

## 🚀 INSTANT DEPLOYMENT

### Zero-Configuration Setup

**For Any New Project:**

1. **Copy Complete `.claude/` Directory**: Framework adapts automatically
2. **Run `/orchestrate [task]`**: Agents detect project context and begin work
3. **That's It**: No customization, configuration, or setup required

**Auto-Detected Capabilities:**

- Language and framework detection
- Build system and tooling identification
- Import alias and shared library discovery
- Quality standards and testing framework detection

**Universal Compatibility:**

- **Languages**: TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, etc.
- **Frameworks**: React, Angular, Vue, Django, Rails, Spring, NestJS, Express, etc.
- **Build Systems**: Nx, Lerna, Rush, Webpack, Vite, Cargo, Go modules, etc.
- **Project Types**: Web apps, mobile apps, desktop apps, libraries, microservices, monorepos

---

**The framework automatically adapts to ANY project structure with zero configuration required. Just copy the `.claude` directory and start using `/orchestrate`.**

---

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->
