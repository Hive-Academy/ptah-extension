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
