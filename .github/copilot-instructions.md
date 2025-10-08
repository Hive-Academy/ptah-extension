# Ptah Extension - AI Coding Instructions

> **📋 Related Documentation**: For agent workflow orchestration, task management protocols, and quality enforcement standards, see [AGENTS.md](../AGENTS.md) in the root directory.

## 🏗️ Architecture Overview

**Ptah** is a VS Code extension with **dual-architecture**: a TypeScript extension host with Angular webview frontend.

### Core Architecture Patterns

- **Registry-Based DI**: `ServiceRegistry` in `apps/ptah-extension-vscode/src/core/` manages all service initialization and dependencies
- **Event-Driven Communication**: Extension ↔ Webview communication via message passing with strict typing in `libs/shared/src/lib/types/`
- **Nx Monorepo**: Organized with `apps/` (extension + webview) and `libs/` (shared, backend, frontend modules)

**Key Entry Points:**

- Extension: `apps/ptah-extension-vscode/src/main.ts` → `PtahExtension` class
- Webview: `apps/ptah-extension-webview/src/main.ts` → Angular 20+ standalone app
- Shared Types: `libs/shared/src/index.ts` exports all cross-boundary interfaces

## 🛠️ Development Workflow

### Build & Development Commands

```bash
# Primary development workflow
npm run build:extension  # VS Code extension (webpack)
npm run build:webview    # Angular app (into extension's webview/)
npm run dev:extension     # Watch mode for extension
npm run dev:webview       # Watch mode with development config

# Quality gates - ALWAYS run before commits
npm run lint:all          # ESLint across all projects
npm run typecheck:all     # TypeScript validation
npm run test:all          # Jest test suite

# Nx-based project management
nx affected:build         # Build only changed projects
nx graph                  # Visualize dependencies
```

### Extension Testing

- Press `F5` in VS Code to launch Extension Development Host
- Extension bundles to `dist/apps/ptah-extension-vscode/`
- Webview builds into `dist/apps/ptah-extension-vscode/webview/`

## 📋 Project-Specific Conventions

### Strict Type Safety

- **NO `any` types** - use branded types from `libs/shared/src/lib/types/branded.types.ts`
- **Deprecated types**: Avoid `ChatMessage`/`ChatSession`, use `StrictChatMessage`/`StrictChatSession`
- **Message typing**: Use `MessagePayloadMap` for all extension ↔ webview communication

### Import Patterns

```typescript
// Extension code - relative imports
import { ServiceRegistry } from '../core/service-registry';
import { StrictChatMessage } from '@ptah-extension/shared';

// Angular webview - path aliases
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
```

### Angular Standards

- **Standalone components only** - no NgModules
- **Control flow**: Use `@if`, `@for`, `@switch` over `*ngIf`, `*ngFor`
- **Signals**: Prefer `input()`, `output()`, `viewChild()` over decorators
- **Change detection**: OnPush required, leveraging Angular 20+ optimizations

### Service Architecture

- **DI Pattern**: All services use `@injectable()` with `@inject(TOKENS.X)` constructors
- **Initialization Order**: Config service first, then core services, then UI providers
- **Error Boundaries**: Every service implements `dispose()` for proper cleanup
- **Registry Access**: `ServiceRegistry.getAllServices()` provides typed service access

## 🔄 Cross-Component Communication

### Extension → Webview

```typescript
// Through AngularWebviewProvider
webview.postMessage({
  type: 'chat:messageChunk',
  data: chatMessage,
});
```

### Webview → Extension

```typescript
// Via VS Code webview API
vscode.postMessage({
  type: 'sendMessage',
  data: { content: 'message' },
});
```

### Event Bus Pattern

- Commands publish events: `eventBus.publish('chat:messageChunk', payload)`
- Webview subscribes: `eventBus.subscribe('chat:messageChunk').pipe(...)`
- Request-response: `eventBus.request('context:getFiles', params, timeout)`

## 🎯 Key Integration Points

### Claude CLI Integration

- `ClaudeCliService`: Automatic CLI detection, process spawning, streaming responses
- **Configuration**: Extension settings in `package.json` → `contributes.configuration`
- **Error Handling**: Graceful fallback with user-friendly messages via `ErrorHandler`

### VS Code Extension Manifest

- **Activity Bar**: Ptah icon (📜) in `package.json` → `contributes.viewsContainers`
- **Commands**: Prefix `ptah.*`, context menus for file actions
- **Keybindings**: Multi-key sequences (Ctrl+Shift+P Ctrl+Shift+C)

### File System & Context

- **Workspace Intelligence**: `WorkspaceManager` detects project types
- **Context Management**: File inclusion/exclusion with token optimization
- **Path Resolution**: Always use `vscode.workspace.workspaceFolders` and `path.resolve()`

## 📦 Library Boundaries

### Backend Libraries (`libs/backend/`)

- `ai-providers-core`: Provider abstractions, Claude CLI wrapper
- `claude-domain`: Claude-specific business logic
- `vscode-core`: VS Code API wrappers, extension utilities
- `workspace-intelligence`: Project detection, context optimization

### Frontend Libraries (`libs/frontend/`)

- `shared-ui`: Egyptian-themed Angular components with Tailwind CSS
- `chat`: Chat interface components and message handling
- `session`: Session management UI and state
- `dashboard`: Analytics and overview interfaces

### Shared Library (`libs/shared/`)

- **Single source of truth** for all cross-boundary types
- **MessagePayloadMap**: Strict typing for all event payloads
- **Branded types**: `SessionId`, `MessageId` for type safety

## 🚨 Quality Gates

### Code Size Limits

- Services: <200 lines
- Modules: <500 lines
- Functions: <30 lines

### Testing Requirements

- Minimum 80% coverage across line/branch/function
- Mock external dependencies in unit tests
- Integration tests in `libs/backend/vscode-core/src/integration/`

### Build Configuration

- **Extension**: Webpack with `target: 'node'`, CommonJS output
- **Webview**: Angular build with hash-based routing for webview compatibility
- **Development**: Source maps enabled, watch mode for both targets

---

## 📚 Additional Resources

### Agent Workflow & Task Management

This file focuses on **technical architecture and coding patterns**. For comprehensive information on:

- **Agent orchestration workflows** (`/orchestrate` command patterns)
- **Task management structure** (TASK*[DOMAIN]*[NUMBER] format)
- **Quality gate frameworks** (validation at each development phase)
- **SOLID principles and design patterns**
- **Universal critical constraints** (type safety, no backward compatibility, etc.)

**See**:

- [AGENTS.md](../AGENTS.md) - Universal agent framework and task tracking protocols
- [MODULAR_ORCHESTRATION_SYSTEM.md](../docs/MODULAR_ORCHESTRATION_SYSTEM.md) - Complete modular orchestration implementation guide

### Orchestration Implementation

The Ptah project uses a **modular phase-based orchestration system**:

- **8 sequential phases**: Each phase is an independent `.prompt.md` file in `.github/prompts/`
- **Validation gates**: Business analyst reviews between each phase
- **Deliverable-driven**: Each phase produces specific artifacts in `task-tracking/{TASK_ID}/`
- **Instruction-based role adoption**: Uses `#file` references to load chatmode personas
- **Git integration**: Automatic branch creation, commits, and PR generation

**Invocation**: `/orchestrate "task description"` triggers the full workflow from requirements → implementation → testing → review → completion

### Separation of Concerns

- **copilot-instructions.md** (this file): Technical architecture, coding patterns, project-specific conventions
- **AGENTS.md**: Universal agent framework, task management, quality gates, SOLID principles
- **MODULAR_ORCHESTRATION_SYSTEM.md**: Complete implementation of modular orchestration, phase details, usage examples
