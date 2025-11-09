# Library Integration Architecture

**Date**: October 10, 2025  
**Purpose**: Define how backend libraries work together and integrate with the main application  
**Status**: 🚨 **CRITICAL** - Addresses architectural gap identified in TASK_PRV_005

---

## 🎯 Executive Summary

This document defines the **missing integration layer** between our backend libraries and the main application. It addresses the critical question:

> **"How should backend libraries export services and wire up inside our main application?"**

### The Problem We're Solving

During TASK_PRV_005 (workspace-intelligence extraction), we discovered:

1. ✅ **We built libraries correctly** - Services use @injectable, proper separation of concerns
2. ❌ **We registered services in wrong place** - vscode-core imports and registers domain services
3. ❌ **Main app doesn't use new architecture** - Still uses old ServiceRegistry instead of DIContainer
4. ❌ **No documented integration pattern** - How libraries export, how app imports/registers

**This document provides the complete integration architecture per MONSTER plan.**

---

## 📊 Current State Analysis

### Nx Workspace Dependencies (Current - ❌ WRONG)

```
@ptah-extension/vscode-core
  ├── depends on: @ptah-extension/shared ✅ CORRECT
  ├── depends on: @ptah-extension/claude-domain ❌ WRONG (domain service registration)
  └── depends on: @ptah-extension/workspace-intelligence ❌ WRONG (domain service registration)

@ptah-extension/ai-providers-core
  ├── depends on: @ptah-extension/shared ✅ CORRECT
  ├── depends on: @ptah-extension/vscode-core ✅ CORRECT (uses DI infrastructure)
  └── depends on: @ptah-extension/claude-domain ✅ CORRECT (uses Claude services)

@ptah-extension/claude-domain
  └── depends on: @ptah-extension/shared ✅ CORRECT

@ptah-extension/workspace-intelligence
  └── depends on: @ptah-extension/shared ✅ CORRECT
```

### Problem: vscode-core Violates Single Responsibility

**Current vscode-core/di/container.ts (lines 103-152):**

```typescript
// ❌ WRONG: vscode-core registering domain services
const {
  TokenCounterService,
  FileSystemService,
  ProjectDetectorService,
  // ... 10 workspace-intelligence services
} = require('@ptah-extension/workspace-intelligence');

container.registerSingleton(TOKENS.TOKEN_COUNTER_SERVICE, TokenCounterService);
// ... registering all domain services
```

**Why this is wrong:**

- vscode-core is **infrastructure** (DI container, EventBus, API wrappers)
- It should NOT know about **domain services** (workspace-intelligence, claude-domain)
- This creates **circular dependency risk**
- Violates **MONSTER plan's layered architecture**

---

## 🏗️ Correct Architecture (MONSTER-Aligned)

### Layer Dependency Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Foundation                                        │
│  @ptah-extension/shared                                     │
│  - Types, schemas, message contracts                        │
│  - NO dependencies                                          │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ depends on
                              │
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Infrastructure (Pure VS Code Abstraction)         │
│  @ptah-extension/vscode-core                                │
│  - DI Container setup (infrastructure only)                 │
│  - EventBus (RxJS messaging)                                │
│  - API Wrappers (CommandManager, WebviewManager, etc.)      │
│  - Depends on: shared ONLY                                  │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ depends on
                              │
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Domain Libraries (Business Logic - Peer Level)    │
│                                                              │
│  @ptah-extension/claude-domain                              │
│  - Claude CLI integration, permissions                      │
│  - Depends on: shared                                       │
│                                                              │
│  @ptah-extension/workspace-intelligence                     │
│  - Workspace analysis, file indexing                        │
│  - Depends on: shared                                       │
│                                                              │
│  @ptah-extension/ai-providers-core                          │
│  - Provider abstractions, adapters                          │
│  - Depends on: shared, vscode-core, claude-domain           │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ imports all
                              │
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Main Application (Composition & Orchestration)    │
│  apps/ptah-extension-vscode                                 │
│  - Imports ALL libraries                                    │
│  - Calls DIContainer.setup() for infrastructure             │
│  - Registers domain services in DI container                │
│  - Orchestrates extension activation                        │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

1. **Dependencies flow DOWNWARD only** - No circular dependencies
2. **vscode-core is pure infrastructure** - No domain service registration
3. **Domain libraries are self-contained** - Services use @injectable()
4. **Main app is composer** - Imports libraries, registers services, orchestrates
5. **Separation of Concerns** - Infrastructure ≠ Domain Logic ≠ Application

---

## 📦 Domain Library Export Pattern

### Standard Export Structure

Each domain library follows this pattern:

**libs/backend/workspace-intelligence/src/index.ts**

```typescript
// ========================================
// SERVICE EXPORTS - For DI Registration
// ========================================
export { TokenCounterService } from './services/token-counter.service';
export { FileSystemService } from './services/file-system.service';
export { ProjectDetectorService } from './project-analysis/project-detector.service';
export { FrameworkDetectorService } from './project-analysis/framework-detector.service';
export { DependencyAnalyzerService } from './project-analysis/dependency-analyzer.service';
export { MonorepoDetectorService } from './project-analysis/monorepo-detector.service';
export { PatternMatcherService } from './services/pattern-matcher.service';
export { IgnorePatternResolverService } from './services/ignore-pattern-resolver.service';
export { FileTypeClassifierService } from './context-analysis/file-type-classifier.service';
export { WorkspaceIndexerService } from './context-analysis/workspace-indexer.service';

// ========================================
// TYPE EXPORTS - For Consumers
// ========================================
export type { ProjectType, Framework, MonorepoType, FileType, EnhancedWorkspaceInfo, IndexedFile, ProjectDetectionResult, FrameworkDetectionResult, DependencyAnalysisResult, MonorepoDetectionResult, FileClassificationResult, FileIndex, ContextOptimizationRequest, ContextOptimizationResult } from './types/workspace.types';

// ========================================
// DI REGISTRATION HELPER (Optional)
// ========================================
import { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * Register all workspace-intelligence services in the DI container
 *
 * This is a convenience function for the main application to register
 * all services without manual registration of each service.
 *
 * @param container - The TSyringe DependencyContainer instance
 */
export function registerWorkspaceIntelligenceServices(container: DependencyContainer): void {
  container.registerSingleton(TOKENS.TOKEN_COUNTER_SERVICE, TokenCounterService);
  container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemService);
  container.registerSingleton(TOKENS.PROJECT_DETECTOR_SERVICE, ProjectDetectorService);
  container.registerSingleton(TOKENS.FRAMEWORK_DETECTOR_SERVICE, FrameworkDetectorService);
  container.registerSingleton(TOKENS.DEPENDENCY_ANALYZER_SERVICE, DependencyAnalyzerService);
  container.registerSingleton(TOKENS.MONOREPO_DETECTOR_SERVICE, MonorepoDetectorService);
  container.registerSingleton(TOKENS.PATTERN_MATCHER_SERVICE, PatternMatcherService);
  container.registerSingleton(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE, IgnorePatternResolverService);
  container.registerSingleton(TOKENS.FILE_TYPE_CLASSIFIER_SERVICE, FileTypeClassifierService);
  container.registerSingleton(TOKENS.WORKSPACE_INDEXER_SERVICE, WorkspaceIndexerService);
}
```

### Why This Pattern?

**Exports Services:**

- Main app can import and register manually if needed
- Provides maximum flexibility

**Exports Types:**

- Consumers get type safety
- No need to import from internal paths

**Optional Bootstrap Function:**

- Convenience for main app
- Encapsulates registration logic
- Makes main app activation cleaner

---

## 🔌 Main Application Integration

### Correct Activation Pattern

**apps/ptah-extension-vscode/src/main.ts (NEW):**

```typescript
import * as vscode from 'vscode';
import { DIContainer, TOKENS } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import { registerClaudeDomainServices } from '@ptah-extension/claude-domain';
import { registerAIProviderServices } from '@ptah-extension/ai-providers-core';
import { PtahExtension } from './core/ptah-extension';
import { Logger } from './core/logger';

let ptahExtension: PtahExtension | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    Logger.info('Activating Ptah extension...');

    // ========================================
    // STEP 1: Setup Infrastructure
    // ========================================
    const container = DIContainer.setup(context);

    // ========================================
    // STEP 2: Register Domain Services
    // ========================================
    registerWorkspaceIntelligenceServices(container);
    registerClaudeDomainServices(container);
    registerAIProviderServices(container);

    // ========================================
    // STEP 3: Resolve Main Extension via DI
    // ========================================
    // Option A: If PtahExtension is @injectable
    ptahExtension = container.resolve(PtahExtension);

    // Option B: If PtahExtension needs manual setup
    ptahExtension = new PtahExtension(
      container.resolve(TOKENS.EXTENSION_CONTEXT),
      container.resolve(TOKENS.EVENT_BUS),
      container.resolve(TOKENS.COMMAND_REGISTRY)
      // ... other dependencies
    );

    // ========================================
    // STEP 4: Initialize Extension
    // ========================================
    await ptahExtension.initialize();
    await ptahExtension.registerAll();

    Logger.info('Ptah extension activated successfully');
  } catch (error) {
    Logger.error('Failed to activate Ptah extension', error);
    vscode.window.showErrorMessage(`Ptah activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function deactivate(): void {
  Logger.info('Deactivating Ptah extension');
  ptahExtension?.dispose();
  ptahExtension = undefined;

  // Clean up DI container
  DIContainer.clear();
}
```

### Migration Strategy: Old ServiceRegistry → New DIContainer

**Current State:**

- Main app uses `ServiceRegistry` (manual instantiation)
- New libraries use `@injectable` decorators
- Two DI systems running in parallel ❌

**Migration Path:**

**Phase 1: Hybrid Approach (Current - Temporary)**

```typescript
// Keep old ServiceRegistry for legacy services
const serviceRegistry = new ServiceRegistry(context);
const oldServices = await serviceRegistry.initialize();

// Setup new DIContainer for new library services
const container = DIContainer.setup(context);
registerWorkspaceIntelligenceServices(container);

// Bridge: Make old services available in new container
container.register(TOKENS.CLAUDE_CLI_SERVICE, { useValue: oldServices.claudeCliService });
container.register(TOKENS.SESSION_MANAGER, { useValue: oldServices.sessionManager });
```

**Phase 2: Migrate Old Services**

```typescript
// Convert old services to @injectable pattern
// ClaudeCliService → use ClaudeCliLauncher from claude-domain
// SessionManager → migrate to @injectable
// WorkspaceManager → use workspace-intelligence services
```

**Phase 3: Delete ServiceRegistry**

```typescript
// Once all services migrated:
// - Delete apps/ptah-extension-vscode/src/core/service-registry.ts
// - Use only DIContainer.setup() + domain registration
```

---

## 🔧 vscode-core Refactoring

### Remove Domain Service Registration

**libs/backend/vscode-core/src/di/container.ts (CORRECTED):**

```typescript
import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS } from './tokens';

export class DIContainer {
  /**
   * Setup the DI container with VS Code extension context
   *
   * ✅ Registers ONLY infrastructure services
   * ❌ Does NOT register domain services (that's main app's job)
   */
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // Register VS Code extension context as singleton
    container.register(TOKENS.EXTENSION_CONTEXT, {
      useValue: context,
    });

    // Register event bus as singleton
    const { EventBus } = require('../messaging/event-bus');
    container.registerSingleton(TOKENS.EVENT_BUS, EventBus);

    // Register API wrappers as singletons
    const { CommandManager } = require('../api-wrappers/command-manager');
    const { WebviewManager } = require('../api-wrappers/webview-manager');
    const { OutputManager } = require('../api-wrappers/output-manager');
    const { StatusBarManager } = require('../api-wrappers/status-bar-manager');
    const { FileSystemManager } = require('../api-wrappers/file-system-manager');

    container.registerSingleton(TOKENS.COMMAND_REGISTRY, CommandManager);
    container.registerSingleton(TOKENS.WEBVIEW_PROVIDER, WebviewManager);
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
    container.registerSingleton(TOKENS.STATUS_BAR_MANAGER, StatusBarManager);
    container.registerSingleton(TOKENS.FILE_SYSTEM_MANAGER, FileSystemManager);

    // ========================================
    // END OF INFRASTRUCTURE SETUP
    // Domain services registered by main app
    // ========================================

    return container;
  }

  static getContainer(): DependencyContainer {
    return container;
  }

  static resolve<T>(token: symbol): T {
    return container.resolve<T>(token);
  }

  static isRegistered(token: symbol): boolean {
    return container.isRegistered(token);
  }

  static clear(): void {
    container.clearInstances();
  }
}

export { TOKENS } from './tokens';
export { container };
export type { DependencyContainer };
```

### Update Nx Dependencies

**libs/backend/vscode-core/project.json (update):**

Remove dependencies on domain libraries:

```json
{
  "name": "@ptah-extension/vscode-core",
  "implicitDependencies": [],
  "tags": ["npm:private", "scope:extension", "type:util"]
}
```

**Nx should show:**

```
@ptah-extension/vscode-core
  └── depends on: @ptah-extension/shared ONLY ✅
```

---

## 📋 Complete Integration Checklist

### For Each Domain Library

- [ ] All services use `@injectable()` decorator
- [ ] Services depend on TOKENS from vscode-core (centralized)
- [ ] Barrel export (`src/index.ts`) exports all services
- [ ] Barrel export exports all types
- [ ] Optional: Export `register[LibraryName]Services()` function
- [ ] Nx dependencies: shared ONLY (or shared + vscode-core for infrastructure usage)

### For vscode-core

- [ ] Remove ALL domain service registrations
- [ ] Register ONLY infrastructure (ExtensionContext, EventBus, API wrappers)
- [ ] Depend on shared ONLY
- [ ] Export TOKENS centrally
- [ ] Export DIContainer utility class

### For Main Application

- [ ] Import domain libraries
- [ ] Call DIContainer.setup(context)
- [ ] Register domain services via bootstrap functions
- [ ] Migrate old ServiceRegistry services to @injectable
- [ ] Delete ServiceRegistry once migration complete
- [ ] Use DIContainer.resolve() for all service access

---

## 🎯 Success Criteria

### Architectural Compliance

✅ **Layer Separation**

- vscode-core has NO dependencies on domain libraries
- Domain libraries depend ONLY on shared (or shared + vscode-core for infrastructure)
- Main app imports and orchestrates all libraries

✅ **DI Pattern**

- All services use @injectable
- All services registered in main app activation
- No manual `new` instantiation except in factories

✅ **Type Safety**

- Zero `any` types
- All DI tokens use Symbol-based types
- All service interfaces properly typed

### Integration Success

✅ **Build System**

- `nx build` succeeds for all libraries
- No circular dependency warnings
- Build order: shared → vscode-core → domain libs → main app

✅ **Runtime**

- Extension activates without DI errors
- All services resolve correctly
- No registration conflicts

✅ **Maintainability**

- Clear separation of concerns
- Easy to add new domain libraries
- Simple registration pattern for new services

---

## 🚀 Next Steps (Implementation Order)

### Immediate (TASK_PRV_005 Completion)

1. ✅ **Document this architecture** (this file)
2. **Create bootstrap functions** in domain libraries
   - `libs/backend/workspace-intelligence/src/di/register.ts`
   - `libs/backend/claude-domain/src/di/register.ts`
3. **Refactor vscode-core** - Remove domain service registration
4. **Update Nx dependencies** - vscode-core → shared only
5. **Update main app activation** - Use DIContainer + domain registration

### Short-term (Next Sprint)

6. **Migrate old services** to @injectable pattern
   - ClaudeCliService → use claude-domain
   - WorkspaceManager → use workspace-intelligence
   - SessionManager → migrate to @injectable
7. **Delete ServiceRegistry** once all services migrated
8. **Integration tests** - Verify all DI resolution works

### Long-term (Ongoing)

9. **Add new domain libraries** following this pattern
10. **Document in MONSTER plan** - Update with integration architecture
11. **Developer onboarding** - Use this doc for new team members

---

## 📚 Related Documentation

- **MONSTER_EXTENSION_REFACTOR_PLAN.md** - Overall refactoring strategy
- **BACKEND_LIBRARY_GAP_ANALYSIS.md** - What to extract from old code
- **TASK_PRV_005/implementation-plan.md** - workspace-intelligence extraction
- **vscode-core/README.md** - Infrastructure library usage
- **nx.json** - Nx workspace configuration

---

**Architecture Documented** ✅  
**Ready for Implementation** ✅  
**Alignment with MONSTER Plan** ✅
