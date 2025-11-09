# Architectural Alignment Strategy - TASK_CORE_001

**Date**: October 11, 2025  
**Purpose**: Synthesize findings from codebase-cleanup-analysis.md and LIBRARY_INTEGRATION_ARCHITECTURE.md  
**Status**: 🚨 **CRITICAL** - Two separate architectural violations identified

---

## 🎯 Executive Summary

Analysis of **two critical documents** reveals that TASK_CORE_001 has **dual architectural violations**:

1. **From codebase-cleanup-analysis.md**: Legacy registries not deleted, Phase 3 incomplete
2. **From LIBRARY_INTEGRATION_ARCHITECTURE.md**: vscode-core violates layer separation by registering domain services

**Key Finding**: These violations are **interconnected** - fixing one helps fix the other.

**Recommendation**: **Unified refactoring approach** that addresses both issues simultaneously.

---

## 📚 Document Analysis

### Document 1: codebase-cleanup-analysis.md

**Date Created**: October 11, 2025 (today)  
**Focus**: Implementation plan vs. reality check  
**Key Findings**:

- ❌ **Legacy registries still active**: CommandRegistry, WebviewRegistry, EventRegistry (370 lines)
- ❌ **AngularWebviewProvider not migrated**: 543 lines + 120 lines HTML generator
- ❌ **Old service files not deleted**: ptah-config.service.ts, context-manager.ts, validation (888 lines)
- ❌ **Phase 3 only 25% complete**: ~1,877 lines of dead code remain

**Recommended Actions**:

1. Replace legacy registries with library services
2. Migrate AngularWebviewProvider
3. Delete old service files
4. Delete registry files

---

### Document 2: LIBRARY_INTEGRATION_ARCHITECTURE.md

**Date Created**: October 10, 2025 (yesterday)  
**Focus**: Correct library integration pattern  
**Key Principles**:

✅ **Layer 1 (Foundation)**: @ptah-extension/shared - no dependencies  
✅ **Layer 2 (Infrastructure)**: @ptah-extension/vscode-core - shared ONLY  
✅ **Layer 3 (Domain)**: claude-domain, workspace-intelligence - shared ONLY  
✅ **Layer 4 (Application)**: main app - imports ALL, orchestrates ALL

**Critical Rule**: **vscode-core should NOT register domain services**

**Migration Strategy**:

- Phase 1: Hybrid (keep old ServiceRegistry, use new DIContainer)
- Phase 2: Migrate old services to @injectable
- Phase 3: Delete ServiceRegistry

---

## 🔍 Codebase Validation Against LIBRARY_INTEGRATION_ARCHITECTURE.md

### Current vscode-core State (WRONG ❌)

**File**: `libs/backend/vscode-core/src/di/container.ts`

**Lines 47-62: Infrastructure Services (CORRECT ✅)**

```typescript
// Register event bus as singleton
const { EventBus } = require('../messaging/event-bus');
container.registerSingleton(TOKENS.EVENT_BUS, EventBus);

// Register API wrappers as singletons
const { CommandManager } = require('../api-wrappers/command-manager');
const { WebviewManager } = require('../api-wrappers/webview-manager');
// ... etc.
```

**Status**: ✅ **CORRECT** - These are infrastructure services

---

**Lines 67-118: Claude Domain Services (WRONG ❌)**

```typescript
// Register Claude domain services (MONSTER Week 5)
const { ClaudeCliDetector, ClaudeCliLauncher, SessionManager: ClaudeSessionManager, PermissionService, ProcessManager, ClaudeDomainEventPublisher, InMemoryPermissionRulesStore } = require('@ptah-extension/claude-domain');

container.registerSingleton(TOKENS.CLAUDE_CLI_DETECTOR, ClaudeCliDetector);
// ... etc.
```

**Status**: ❌ **WRONG** - These are DOMAIN services, should be registered in MAIN APP

---

**Lines 125-174: Workspace Intelligence Services (WRONG ❌)**

```typescript
// Register workspace intelligence services (TASK_PRV_005)
const {
  TokenCounterService,
  FileSystemService,
  ProjectDetectorService,
  // ... 10 services total
} = require('@ptah-extension/workspace-intelligence');

container.registerSingleton(TOKENS.TOKEN_COUNTER_SERVICE, TokenCounterService);
// ... etc.
```

**Status**: ❌ **WRONG** - These are DOMAIN services, should be registered in MAIN APP

---

### Current Main App State (INCOMPLETE ⚠️)

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Current Code**:

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Initialize DI Container first
    DIContainer.setup(context);

    // Get logger from DI container
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.info('Activating Ptah extension...');

    // Initialize main extension controller
    ptahExtension = new PtahExtension(context);
    await ptahExtension.initialize();

    // Register all providers, commands, and services
    await ptahExtension.registerAll();
```

**Status**: ⚠️ **INCOMPLETE** - Missing domain service registration

**Should Be** (per LIBRARY_INTEGRATION_ARCHITECTURE.md):

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    // STEP 1: Setup Infrastructure
    const container = DIContainer.setup(context);

    // STEP 2: Register Domain Services
    registerWorkspaceIntelligenceServices(container);
    registerClaudeDomainServices(container);
    registerAIProviderServices(container);

    // STEP 3: Resolve Main Extension via DI
    ptahExtension = new PtahExtension(context);
    await ptahExtension.initialize();
```

---

### Domain Libraries State (MISSING EXPORTS ❌)

**File**: `libs/backend/workspace-intelligence/src/index.ts`

**Current Exports**:

```typescript
// Service exports
export { TokenCounterService } from './services/token-counter.service';
export { FileSystemService } from './services/file-system.service';
// ... etc.
```

**Status**: ❌ **MISSING** bootstrap function

**Should Also Export**:

```typescript
/**
 * Register all workspace-intelligence services in the DI container
 */
export function registerWorkspaceIntelligenceServices(container: DependencyContainer): void {
  container.registerSingleton(TOKENS.TOKEN_COUNTER_SERVICE, TokenCounterService);
  container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemService);
  // ... etc.
}
```

---

## 🔗 How Both Issues Connect

### The Connection

**Legacy Registries Issue** + **Domain Service Registration Issue** = **Same Root Cause**

Both stem from: **Main app not properly orchestrating service registration**

### Why They're Related

1. **Legacy registries** (CommandRegistry, WebviewRegistry, EventRegistry) exist because:

   - Main app doesn't know how to register commands/webviews/events via library services
   - PtahExtension.ts is trying to do too much

2. **vscode-core registering domain services** exists because:

   - Main app isn't set up to register domain services
   - Someone took a shortcut and put registration in vscode-core

3. **Both violate the same principle**:
   - Main app should be the **orchestrator**
   - Libraries should be **self-contained but passive**
   - Main app should **compose everything together**

---

## 🎯 Unified Solution Strategy

### The "Kill Two Birds" Approach

**Instead of**:

- Fix legacy registries separately (codebase-cleanup-analysis.md actions)
- Fix domain registration separately (LIBRARY_INTEGRATION_ARCHITECTURE.md alignment)

**Do this**:

- **Single refactoring** that addresses both issues
- Implement LIBRARY_INTEGRATION_ARCHITECTURE.md pattern
- As part of that, replace legacy registries with library usage
- Result: Both issues solved, architecture correct

---

## 📋 Unified Action Plan

### Phase 1: Create Bootstrap Functions (Foundation)

**Effort**: 1-2 hours  
**Priority**: HIGH (enables everything else)

#### Action 1.1: workspace-intelligence Bootstrap

**Create**: `libs/backend/workspace-intelligence/src/di/register.ts`

```typescript
import { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { TokenCounterService, FileSystemService, ProjectDetectorService, FrameworkDetectorService, DependencyAnalyzerService, MonorepoDetectorService, PatternMatcherService, IgnorePatternResolverService, FileTypeClassifierService, WorkspaceIndexerService } from '../index';

/**
 * Register all workspace-intelligence services
 * Called by main app during activation
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

**Export from**: `libs/backend/workspace-intelligence/src/index.ts`

```typescript
// Add to exports
export { registerWorkspaceIntelligenceServices } from './di/register';
```

---

#### Action 1.2: claude-domain Bootstrap

**Create**: `libs/backend/claude-domain/src/di/register.ts`

```typescript
import { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { ClaudeCliDetector, ClaudeCliLauncher, SessionManager, PermissionService, ProcessManager, ClaudeDomainEventPublisher, InMemoryPermissionRulesStore } from '../index';

/**
 * Register all claude-domain services
 * Called by main app during activation
 */
export function registerClaudeDomainServices(container: DependencyContainer): void {
  // Register permission rules store
  container.register('IPermissionRulesStore', {
    useValue: new InMemoryPermissionRulesStore(),
  });

  // Register event bus adapter
  container.register('IEventBus', {
    useFactory: (c) => {
      const eventBus = c.resolve(TOKENS.EVENT_BUS);
      return {
        publish: <T>(topic: string, payload: T) => {
          eventBus.publish(topic, payload);
        },
      };
    },
  });

  container.registerSingleton(TOKENS.CLAUDE_CLI_DETECTOR, ClaudeCliDetector);
  container.registerSingleton(TOKENS.CLAUDE_SESSION_MANAGER, SessionManager);
  container.registerSingleton(TOKENS.CLAUDE_PROCESS_MANAGER, ProcessManager);
  container.registerSingleton(TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER, ClaudeDomainEventPublisher);
  container.registerSingleton(TOKENS.CLAUDE_PERMISSION_SERVICE, PermissionService);

  // Register launcher with factory
  container.register(TOKENS.CLAUDE_CLI_LAUNCHER, {
    useFactory: (c) => {
      return new ClaudeCliLauncher({
        sessionManager: c.resolve(TOKENS.CLAUDE_SESSION_MANAGER),
        permissionService: c.resolve(TOKENS.CLAUDE_PERMISSION_SERVICE),
        processManager: c.resolve(TOKENS.CLAUDE_PROCESS_MANAGER),
        eventPublisher: c.resolve(TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER),
      });
    },
  });
}
```

**Export from**: `libs/backend/claude-domain/src/index.ts`

---

### Phase 2: Refactor vscode-core (Clean Infrastructure)

**Effort**: 1 hour  
**Priority**: HIGH (critical path)

#### Action 2.1: Remove Domain Service Registration

**File**: `libs/backend/vscode-core/src/di/container.ts`

**DELETE lines 67-174** (all domain service registration)

**Keep only**:

- EXTENSION_CONTEXT
- EventBus
- API wrappers (CommandManager, WebviewManager, etc.)
- Infrastructure services (Logger, ErrorHandler, ConfigManager, MessageValidator)

**Final container.ts should be**:

```typescript
static setup(context: vscode.ExtensionContext): DependencyContainer {
  // Register VS Code extension context
  container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

  // Register event bus
  const { EventBus } = require('../messaging/event-bus');
  container.registerSingleton(TOKENS.EVENT_BUS, EventBus);

  // Register API wrappers
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

  // Register core infrastructure services (TASK_CORE_001)
  const { Logger } = require('../logging/logger');
  const { ErrorHandler } = require('../error-handling/error-handler');
  const { ConfigManager } = require('../config/config-manager');
  const { MessageValidatorService } = require('../validation/message-validator.service');
  container.registerSingleton(TOKENS.LOGGER, Logger);
  container.registerSingleton(TOKENS.ERROR_HANDLER, ErrorHandler);
  container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);
  container.registerSingleton(TOKENS.MESSAGE_VALIDATOR, MessageValidatorService);

  // ========================================
  // END OF INFRASTRUCTURE SETUP
  // Domain services registered by main app
  // ========================================

  return container;
}
```

**Impact**: ~100 lines deleted from vscode-core

---

### Phase 3: Refactor Main App (Orchestrator Pattern)

**Effort**: 2-3 hours  
**Priority**: CRITICAL

#### Action 3.1: Update main.ts

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Replace activation function**:

```typescript
import * as vscode from 'vscode';
import { DIContainer, TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import { registerClaudeDomainServices } from '@ptah-extension/claude-domain';
// Import other domain library bootstrap functions as they become available

import { PtahExtension } from './core/ptah-extension';

let ptahExtension: PtahExtension | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    // ========================================
    // STEP 1: Setup Infrastructure
    // ========================================
    const container = DIContainer.setup(context);
    const logger = container.resolve<Logger>(TOKENS.LOGGER);
    logger.info('Activating Ptah extension...');

    // ========================================
    // STEP 2: Register Domain Services
    // ========================================
    logger.info('Registering domain services...');
    registerWorkspaceIntelligenceServices(container);
    registerClaudeDomainServices(container);
    // registerAIProviderServices(container); // Future
    // registerSessionServices(container);    // Future
    // registerAnalyticsServices(container);  // Future
    logger.info('Domain services registered');

    // ========================================
    // STEP 3: Initialize Main Extension
    // ========================================
    ptahExtension = new PtahExtension(context);
    await ptahExtension.initialize();
    await ptahExtension.registerAll();

    logger.info('Ptah extension activated successfully');

    // Show welcome message for first-time users
    const isFirstTime = context.globalState.get('ptah.firstActivation', true);
    if (isFirstTime) {
      await ptahExtension.showWelcome();
      await context.globalState.update('ptah.firstActivation', false);
    }
  } catch (error) {
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.error('Failed to activate Ptah extension', error);
    vscode.window.showErrorMessage(`Ptah activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function deactivate(): void {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');
  ptahExtension?.dispose();
  ptahExtension = undefined;
  DIContainer.clear();
}
```

**Impact**: Main app now orchestrates domain registration

---

#### Action 3.2: Refactor PtahExtension.ts (Replace Registries)

**File**: `apps/ptah-extension-vscode/src/core/ptah-extension.ts`

**Changes**:

1. **Remove legacy registry imports**:

```typescript
// DELETE these
import { CommandRegistry } from '../registries/command-registry';
import { WebviewRegistry } from '../registries/webview-registry';
import { EventRegistry } from '../registries/event-registry';
```

2. **Remove legacy registry properties**:

```typescript
// DELETE these
private commandRegistry?: CommandRegistry;
private webviewRegistry?: WebviewRegistry;
private eventRegistry?: EventRegistry;
```

3. **Use library services instead**:

```typescript
// In registerAllComponents() method
private registerAllComponents(): void {
  // Use CommandManager from vscode-core
  this.commandManager.registerCommand(
    'ptah.quickChat',
    () => this.commandHandlers.quickChat()
  );
  // ... register all commands

  // Use WebviewManager from vscode-core
  this.webviewManager.registerWebviewView(
    'ptah.main',
    this.angularWebviewProvider,
    { retainContextWhenHidden: true }
  );

  // Use EventBus from vscode-core (already injected)
  this.eventBus.subscribe('workspace:changed').subscribe(() => {
    this.contextManager.refreshContext();
  });
  // ... register all events

  this.logger.info('All components registered successfully');
}
```

**Impact**: Removes dependency on legacy registries

---

### Phase 4: Delete Dead Code (Cleanup)

**Effort**: 30 minutes  
**Priority**: MEDIUM (after Phase 3 complete)

#### Action 4.1: Delete Registry Files

```bash
# After Phase 3 complete, these have zero imports
rm apps/ptah-extension-vscode/src/registries/command-registry.ts
rm apps/ptah-extension-vscode/src/registries/webview-registry.ts
rm apps/ptah-extension-vscode/src/registries/event-registry.ts
rmdir apps/ptah-extension-vscode/src/registries  # If empty
```

**Impact**: -370 lines of dead code

---

#### Action 4.2: Delete Old Service Files

**Verify no imports first**:

```bash
grep -r "ptah-config.service" apps/ptah-extension-vscode/src/
grep -r "from.*context-manager" apps/ptah-extension-vscode/src/
grep -r "message-validator.service" apps/ptah-extension-vscode/src/
```

**If no imports found**:

```bash
rm apps/ptah-extension-vscode/src/config/ptah-config.service.ts
rm apps/ptah-extension-vscode/src/services/context-manager.ts
rm apps/ptah-extension-vscode/src/services/validation/message-validator.service.ts
```

**Impact**: -888 lines of dead code

---

### Phase 5: Build & Test (Validation)

**Effort**: 1 hour  
**Priority**: CRITICAL

#### Action 5.1: Build Validation

```bash
# Build all libraries
npx nx run-many --target=build --all

# Build extension specifically
npx nx build ptah-extension-vscode
```

**Expected**: ✅ All builds pass

---

#### Action 5.2: Manual Testing

```bash
# Press F5 in VS Code
# Extension Development Host launches
```

**Test Checklist**:

- [ ] Extension activates without errors
- [ ] Commands work (ptah.quickChat, ptah.reviewCurrentFile, etc.)
- [ ] Webview displays correctly
- [ ] Chat functionality works
- [ ] Provider selection works
- [ ] Configuration changes work
- [ ] No console errors in VS Code Developer Tools

---

## 📊 Impact Analysis

### Code Reduction

| Category                        | Before                | After                     | Delta            |
| ------------------------------- | --------------------- | ------------------------- | ---------------- |
| **vscode-core/di/container.ts** | 195 lines             | ~95 lines                 | **-100 lines**   |
| **Legacy registries**           | 370 lines             | 0 lines                   | **-370 lines**   |
| **Old service files**           | 888 lines             | 0 lines                   | **-888 lines**   |
| **main.ts complexity**          | Simple but incomplete | Slightly more but correct | **+~20 lines**   |
| **Bootstrap functions**         | 0                     | ~200 lines (2 libs)       | **+200 lines**   |
| **Net Change**                  | -                     | -                         | **-1,138 lines** |

### Architectural Compliance

| Principle                               | Before                  | After                    |
| --------------------------------------- | ----------------------- | ------------------------ |
| **Layer Separation**                    | ❌ Violated             | ✅ Compliant             |
| **vscode-core Purity**                  | ❌ Has domain services  | ✅ Infrastructure only   |
| **Main App as Orchestrator**            | ❌ Passive              | ✅ Active composer       |
| **Domain Library Independence**         | ✅ Services @injectable | ✅ + Bootstrap functions |
| **LIBRARY_INTEGRATION_ARCHITECTURE.md** | ❌ Not followed         | ✅ Fully aligned         |

---

## 🎯 Success Criteria

### Must Achieve

- [ ] vscode-core registers ONLY infrastructure services
- [ ] Domain libraries export bootstrap functions
- [ ] Main app calls bootstrap functions during activation
- [ ] Legacy registries deleted (command, webview, event)
- [ ] Old service files deleted (ptah-config, context-manager, validation)
- [ ] Extension builds successfully
- [ ] Extension works in F5 debug mode
- [ ] All manual tests pass

### Quality Gates

- [ ] Zero TypeScript compilation errors
- [ ] Zero circular dependency warnings
- [ ] Nx graph shows correct layer dependencies
- [ ] No `any` types in new code
- [ ] LIBRARY_INTEGRATION_ARCHITECTURE.md fully implemented

---

## 🚀 Recommended Execution Order

### Immediate (Today)

1. **Create bootstrap functions** (Phase 1) - 1-2 hours
2. **Refactor vscode-core** (Phase 2) - 1 hour
3. **Test build** - Verify no breaking changes

### Next (Tomorrow)

4. **Refactor main.ts** (Phase 3.1) - 30 min
5. **Refactor ptah-extension.ts** (Phase 3.2) - 2 hours
6. **Test build & manual testing** (Phase 5) - 1 hour

### Final (After Testing)

7. **Delete dead code** (Phase 4) - 30 min
8. **Final build & test** - 30 min
9. **Update documentation** - 30 min

**Total Effort**: ~7-8 hours spread over 2 days

---

## 💡 Why This Approach is Superior

### Compared to "Fix Registries Only"

**If we only fixed legacy registries** (codebase-cleanup-analysis.md approach):

- ✅ Would remove 370 lines of registry code
- ❌ vscode-core still violates architecture
- ❌ Main app still not proper orchestrator
- ❌ LIBRARY_INTEGRATION_ARCHITECTURE.md still not followed
- ❌ Future library additions still confusing

### Compared to "Fix Architecture Only"

**If we only aligned to LIBRARY_INTEGRATION_ARCHITECTURE.md**:

- ✅ Would fix layer separation
- ✅ Would create bootstrap functions
- ❌ Legacy registries still exist
- ❌ Dead code still in codebase
- ❌ Main app still has technical debt

### This Unified Approach

**Advantages**:

- ✅ Fixes BOTH issues simultaneously
- ✅ Single refactoring effort (not two separate)
- ✅ Ends with clean architecture
- ✅ Follows documented patterns
- ✅ Sets foundation for future work
- ✅ No wasted effort on intermediate states

---

## 📚 Documentation Updates Required

After implementation:

1. **Update TASK_CORE_001/progress.md**:

   - Mark Phase 3 as truly complete
   - Document architectural alignment
   - Update metrics (lines deleted, etc.)

2. **Update LIBRARY_INTEGRATION_ARCHITECTURE.md**:

   - Change status from "Addresses architectural gap" to "Implemented"
   - Add "Implementation Complete" section
   - Reference TASK_CORE_001 as implementation task

3. **Update codebase-cleanup-analysis.md**:

   - Mark all actions as complete
   - Document unified approach taken
   - Cross-reference architectural-alignment-strategy.md

4. **Create TASK_CORE_001/completion-report.md**:
   - Document final state
   - Include before/after metrics
   - Lessons learned

---

## 🔍 Risk Assessment

### Low Risk

- Bootstrap function creation (new code, no breaking changes)
- vscode-core refactoring (well-defined, clear separation)
- Dead code deletion (after verification of no imports)

### Medium Risk

- PtahExtension.ts refactoring (complex, many dependencies)
- Command/webview/event registration replacement (needs careful testing)

### Mitigation

- Make changes incrementally
- Build after each phase
- Test extension in F5 mode frequently
- Keep git commits granular (easy to rollback)
- Manual testing checklist after each major change

---

**Strategy Complete** ✅  
**Ready for Implementation** ✅  
**Addresses Both Documents** ✅  
**Architecturally Sound** ✅
