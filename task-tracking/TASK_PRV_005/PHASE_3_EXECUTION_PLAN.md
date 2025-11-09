# Phase 3: AI Providers Migration & Deletion

**Date**: January 11, 2025  
**Status**: 📋 **PLANNED** - Ready to Execute  
**Goal**: Replace OLD ai-providers folder with NEW `@ptah-extension/ai-providers-core` library

---

## 🎯 Objective

Delete `apps/ptah-extension-vscode/src/services/ai-providers/` folder (~400 lines) and migrate to the NEW modular `@ptah-extension/ai-providers-core` library.

---

## 🔍 Current State Analysis

### OLD Implementation (To Be Deleted)

**Location**: `apps/ptah-extension-vscode/src/services/ai-providers/`

**Files** (400+ lines total):

- `base-ai-provider.ts` - Abstract base class
- `claude-cli-provider-adapter.ts` - Claude CLI wrapper
- `vscode-lm-provider.ts` - VS Code LM API wrapper
- `provider-factory.ts` - Manual factory pattern
- `provider-manager.ts` - Provider lifecycle management
- `index.ts` - Exports

**Usage Points**:

1. ✅ `apps/ptah-extension-vscode/src/core/ptah-extension.ts` (lines 18-23, 40-42, 64-71, 167-192, 230, 446)
2. ❓ `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` (need to check)

### NEW Implementation (Already Built!)

**Location**: `libs/backend/ai-providers-core/src/`

**Architecture**:

```
ai-providers-core/
├── interfaces/            # Core abstractions
│   ├── provider.interface.ts
│   └── manager.interface.ts
├── adapters/             # Concrete implementations
│   ├── claude-cli.adapter.ts
│   └── vscode-lm.adapter.ts
├── manager/              # Provider lifecycle
│   └── provider-manager.ts
├── strategies/           # Selection logic
│   └── intelligent-provider-strategy.ts
└── context/              # Context management
    └── context-manager.ts
```

**Key Exports** (from `index.ts`):

```typescript
export type { ProviderContext, EnhancedAIProvider, ProviderSelectionResult };
export { IntelligentProviderStrategy };
export type { ActiveProviderState };
export { ProviderManager };
export { ClaudeCliAdapter, VsCodeLmAdapter };
export { ContextManager };
```

---

## 🚀 Migration Strategy

### Key Architectural Differences

| Aspect                | OLD                        | NEW                            |
| --------------------- | -------------------------- | ------------------------------ |
| **Pattern**           | Factory + Manager          | Manager with DI + Strategy     |
| **Provider Creation** | `ProviderFactory.create()` | DI container resolves adapters |
| **Configuration**     | Manual config objects      | Intelligent strategy-based     |
| **Context**           | Mixed in providers         | Dedicated ContextManager       |
| **Selection**         | Simple fallback            | IntelligentProviderStrategy    |
| **Lifecycle**         | Manual init                | DI-managed lifecycle           |

### Migration Approach

**NOT a 1:1 replacement** - This is an architectural upgrade:

- OLD: Factory creates providers, Manager switches between them
- NEW: DI container provides adapters, Manager uses strategy for selection

---

## 📋 Step-by-Step Execution Plan

### Step 1: Create AI Providers Registration Function (1 hour)

**File**: `libs/backend/ai-providers-core/src/di/register.ts` (NEW FILE)

**Purpose**: Bootstrap function to register all ai-providers-core services

**Implementation**:

```typescript
import { DependencyContainer } from 'tsyringe';
import { ProviderManager, ClaudeCliAdapter, VsCodeLmAdapter, IntelligentProviderStrategy, ContextManager } from '../index';

export interface AIProvidersTokens {
  PROVIDER_MANAGER: symbol;
  CLAUDE_CLI_ADAPTER: symbol;
  VSCODE_LM_ADAPTER: symbol;
  PROVIDER_STRATEGY: symbol;
  CONTEXT_MANAGER: symbol;
  CLAUDE_CLI_SERVICE: symbol; // From claude-domain
}

export function registerAIProvidersServices(container: DependencyContainer, tokens: AIProvidersTokens): void {
  // Register adapters as singletons
  container.registerSingleton(tokens.CLAUDE_CLI_ADAPTER, ClaudeCliAdapter);
  container.registerSingleton(tokens.VSCODE_LM_ADAPTER, VsCodeLmAdapter);

  // Register strategy
  container.registerSingleton(tokens.PROVIDER_STRATEGY, IntelligentProviderStrategy);

  // Register context manager
  container.registerSingleton(tokens.CONTEXT_MANAGER, ContextManager);

  // Register provider manager (orchestrates everything)
  container.registerSingleton(tokens.PROVIDER_MANAGER, ProviderManager);

  console.info('✅ AI Providers services registered');
}
```

**Export**: Update `libs/backend/ai-providers-core/src/index.ts`

```typescript
// DI registration
export { registerAIProvidersServices, type AIProvidersTokens } from './di/register';
```

---

### Step 2: Add Tokens to vscode-core (30 min)

**File**: `libs/backend/vscode-core/src/di/tokens.ts`

**Add**:

```typescript
// AI Providers Core
export const PROVIDER_MANAGER = Symbol.for('ProviderManager');
export const CLAUDE_CLI_ADAPTER = Symbol.for('ClaudeCliAdapter');
export const VSCODE_LM_ADAPTER = Symbol.for('VsCodeLmAdapter');
export const PROVIDER_STRATEGY = Symbol.for('IntelligentProviderStrategy');
export const AI_CONTEXT_MANAGER = Symbol.for('AIContextManager');
```

**Update TOKENS object**:

```typescript
export const TOKENS = {
  // ... existing tokens

  // AI Providers
  PROVIDER_MANAGER,
  CLAUDE_CLI_ADAPTER,
  VSCODE_LM_ADAPTER,
  PROVIDER_STRATEGY,
  AI_CONTEXT_MANAGER,
} as const;
```

---

### Step 3: Update main.ts Registration (30 min)

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Add import**:

```typescript
import { registerAIProvidersServices, type AIProvidersTokens } from '@ptah-extension/ai-providers-core';
```

**Add registration** (after workspace-intelligence, before claude-domain):

```typescript
// 2. Register AI providers services
const aiProvidersTokens: AIProvidersTokens = {
  PROVIDER_MANAGER: TOKENS.PROVIDER_MANAGER,
  CLAUDE_CLI_ADAPTER: TOKENS.CLAUDE_CLI_ADAPTER,
  VSCODE_LM_ADAPTER: TOKENS.VSCODE_LM_ADAPTER,
  PROVIDER_STRATEGY: TOKENS.PROVIDER_STRATEGY,
  CONTEXT_MANAGER: TOKENS.AI_CONTEXT_MANAGER,
  CLAUDE_CLI_SERVICE: TOKENS.CLAUDE_CLI_SERVICE, // Will need this from claude-domain
};
registerAIProvidersServices(DIContainer.getContainer(), aiProvidersTokens);
logger.info('AI providers services registered');
```

---

### Step 4: Update ptah-extension.ts (1.5 hours)

**File**: `apps/ptah-extension-vscode/src/core/ptah-extension.ts`

#### 4.1: Remove OLD imports

```typescript
// ❌ DELETE THESE
import { ProviderFactory, ProviderManager, ProviderFactoryConfig, ProviderManagerConfig } from '../services/ai-providers';
```

#### 4.2: Add NEW imports

```typescript
// ✅ ADD THESE
import type { ProviderManager } from '@ptah-extension/ai-providers-core';
```

#### 4.3: Update ServiceDependencies interface

```typescript
export interface ServiceDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  errorHandler: ErrorHandler;
  configManager: ConfigManager;
  commandManager: CommandManager;
  webviewManager: WebviewManager;
  eventBus: EventBus;
  claudeCliService: ClaudeCliService;
  sessionManager: SessionManager;
  contextManager: ContextManager;
  workspaceAnalyzer: WorkspaceAnalyzerService;
  commandBuilderService: CommandBuilderService;
  analyticsDataCollector: AnalyticsDataCollector;
  angularWebviewProvider: AngularWebviewProvider;
  // ❌ DELETE providerFactory: ProviderFactory;
  providerManager: ProviderManager; // ✅ Keep this (NEW implementation)
}
```

#### 4.4: Update class fields

```typescript
export class PtahExtension implements vscode.Disposable {
  // ... other fields

  // Legacy services
  private claudeCliService?: ClaudeCliService;
  private sessionManager?: SessionManager;
  private contextManager?: ContextManager;
  private workspaceAnalyzer?: WorkspaceAnalyzerService;
  private commandBuilderService?: CommandBuilderService;
  private analyticsDataCollector?: AnalyticsDataCollector;
  private angularWebviewProvider?: AngularWebviewProvider;
  // ❌ DELETE private providerFactory?: ProviderFactory;
  private providerManager?: ProviderManager; // ✅ Keep (NEW implementation via DI)
}
```

#### 4.5: Update initializeLegacyServices()

```typescript
private async initializeLegacyServices(): Promise<void> {
  this.logger.info('Initializing legacy services...');

  try {
    // Initialize core services in dependency order
    this.claudeCliService = new ClaudeCliService();
    this.sessionManager = new SessionManager(this.context);
    this.contextManager = new ContextManager();
    this.workspaceAnalyzer = DIContainer.resolve<WorkspaceAnalyzerService>(
      TOKENS.WORKSPACE_ANALYZER_SERVICE
    );
    this.commandBuilderService = new CommandBuilderService(this.context);

    // Initialize analytics data collector with dependencies
    this.analyticsDataCollector = new AnalyticsDataCollector(
      this.context,
      this.sessionManager,
      this.commandBuilderService,
      this.claudeCliService,
      this.contextManager
    );

    // ❌ DELETE provider factory/manager initialization (lines 167-192)
    // ✅ ADD: Resolve provider manager from DI
    this.providerManager = DIContainer.resolve<ProviderManager>(TOKENS.PROVIDER_MANAGER);

    // Initialize UI provider with dependencies
    this.angularWebviewProvider = new AngularWebviewProvider(
      this.context,
      this.sessionManager,
      this.claudeCliService,
      this.contextManager,
      this.commandBuilderService,
      this.analyticsDataCollector,
      this.eventBus,
      this.providerManager  // NEW implementation
    );

    // Build services object for backward compatibility
    if (!this.workspaceAnalyzer) {
      throw new Error('WorkspaceAnalyzerService not initialized');
    }

    this.services = {
      context: this.context,
      logger: this.logger,
      errorHandler: this.errorHandler,
      configManager: this.configManager,
      commandManager: this.commandManager,
      webviewManager: this.webviewManager,
      eventBus: this.eventBus,
      claudeCliService: this.claudeCliService,
      sessionManager: this.sessionManager,
      contextManager: this.contextManager,
      workspaceAnalyzer: this.workspaceAnalyzer,
      commandBuilderService: this.commandBuilderService,
      analyticsDataCollector: this.analyticsDataCollector,
      angularWebviewProvider: this.angularWebviewProvider,
      // ❌ DELETE providerFactory: this.providerFactory,
      providerManager: this.providerManager,
    };

    this.logger.info('Legacy services initialized successfully');
  } catch (error) {
    this.logger.error('Failed to initialize legacy services', error);
    throw error;
  }
}
```

#### 4.6: Update dispose()

```typescript
dispose(): void {
  this.logger.info('Disposing Ptah extension...');

  try {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];

    // Dispose legacy services
    this.angularWebviewProvider?.dispose?.();
    this.providerManager?.dispose();
    // ❌ DELETE this.providerFactory?.dispose();
    this.analyticsDataCollector?.dispose();
    this.commandBuilderService?.dispose();
    this.workspaceAnalyzer?.dispose();
    this.contextManager?.dispose();
    this.sessionManager?.dispose();
    this.claudeCliService?.dispose();

    this.logger.info('Ptah extension disposed successfully');
  } catch (error) {
    this.logger.error('Extension disposal failed', error);
  }
}
```

---

### Step 5: Check angular-webview.provider.ts (30 min)

**File**: `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`

**Action**: Check if it imports ProviderManager and update if needed

**Expected**:

- ProviderManager type should work with NEW implementation (same interface)
- May need to update import from `'../services/ai-providers'` to `'@ptah-extension/ai-providers-core'`

---

### Step 6: Build & Verify (30 min)

**Commands**:

```bash
# Build all libraries first
npx nx build ai-providers-core
npx nx build vscode-core
npx nx build workspace-intelligence

# Build extension
npx nx build ptah-extension-vscode

# Type check
npx nx run ptah-extension-vscode:typecheck

# Lint
npx nx run ptah-extension-vscode:lint
```

**Verification**:

- ✅ Build successful
- ✅ TypeScript: 0 errors
- ✅ No references to old ai-providers folder

---

### Step 7: Delete Old AI Providers (15 min)

**Delete**:

```bash
rm -rf apps/ptah-extension-vscode/src/services/ai-providers/
```

**Final verification**:

```bash
# Search for any remaining references
grep -r "from '../services/ai-providers'" apps/ptah-extension-vscode/src/
grep -r "from './ai-providers'" apps/ptah-extension-vscode/src/

# Should return: No matches
```

**Build again to confirm**:

```bash
npx nx build ptah-extension-vscode
# Should succeed!
```

---

## 🎯 Success Criteria

- ✅ `registerAIProvidersServices()` function created
- ✅ Tokens added to vscode-core
- ✅ main.ts registers ai-providers-core services
- ✅ ptah-extension.ts uses DI-injected ProviderManager
- ✅ angular-webview.provider.ts updated (if needed)
- ✅ Build successful
- ✅ TypeScript: 0 errors
- ✅ Old `ai-providers/` folder deleted (~400 lines)
- ✅ Runtime test: Extension activates successfully

---

## 📊 Impact Analysis

### Lines of Code

| Metric                  | Before            | After           | Change   |
| ----------------------- | ----------------- | --------------- | -------- |
| Old ai-providers folder | ~400 lines        | 0 lines         | -400     |
| NEW ai-providers-core   | 0 (exists in lib) | (already built) | N/A      |
| ptah-extension.ts       | ~461 lines        | ~440 lines      | -21      |
| **Total Deletion**      | **~400 lines**    | **0 lines**     | **-400** |

### Architecture Benefits

**Before** (Monolithic):

- Factory pattern with manual instantiation
- Hard-coded provider switching logic
- Mixed concerns (creation + lifecycle + selection)

**After** (Modular):

- DI-managed provider lifecycle
- Strategy-based intelligent selection
- Clear separation: adapters, manager, strategy, context
- Reusable across multiple projects
- Fully testable with mocked dependencies

---

## 🚨 Potential Issues & Solutions

### Issue 1: ClaudeCliService Dependency

**Problem**: NEW adapters need ClaudeCliService, but it's in main app  
**Solution**: ClaudeCliAdapter should receive IClaudeCliService interface via DI  
**Action**: Ensure CLAUDE_CLI_SERVICE token passed to ai-providers registration

### Issue 2: ProviderManager API Differences

**Problem**: NEW ProviderManager might have different API than OLD  
**Solution**: Check AngularWebviewProvider usage and adapt if needed  
**Mitigation**: Both implement same core interface (should be compatible)

### Issue 3: Configuration Migration

**Problem**: OLD used ProviderFactoryConfig and ProviderManagerConfig  
**Solution**: NEW uses IntelligentProviderStrategy (no manual config)  
**Benefit**: Smarter auto-selection, less configuration required!

---

## 📋 Execution Checklist

### Pre-Flight Checks

- [ ] Review Phase 4 completion (workspace-intelligence integrated)
- [ ] Confirm ai-providers-core library exists and compiles
- [ ] Backup current ptah-extension.ts (git status clean)

### Step 1: Create Registration Function

- [ ] Create `libs/backend/ai-providers-core/src/di/register.ts`
- [ ] Export from `libs/backend/ai-providers-core/src/index.ts`
- [ ] Build ai-providers-core: `npx nx build ai-providers-core`

### Step 2: Add Tokens

- [ ] Update `libs/backend/vscode-core/src/di/tokens.ts`
- [ ] Add to TOKENS object
- [ ] Build vscode-core: `npx nx build vscode-core`

### Step 3: Update main.ts

- [ ] Import `registerAIProvidersServices`
- [ ] Create `aiProvidersTokens` configuration
- [ ] Call registration function
- [ ] Build extension: `npx nx build ptah-extension-vscode`

### Step 4: Update ptah-extension.ts

- [ ] Remove OLD imports
- [ ] Add NEW imports
- [ ] Update ServiceDependencies interface
- [ ] Update class fields
- [ ] Update initializeLegacyServices()
- [ ] Update dispose()
- [ ] Type check: `npx nx run ptah-extension-vscode:typecheck`

### Step 5: Check angular-webview.provider.ts

- [ ] Search for ProviderManager import
- [ ] Update import path if needed
- [ ] Verify no compilation errors

### Step 6: Build & Verify

- [ ] Build all: `npx nx run-many -t build --all`
- [ ] Type check: `npx nx run ptah-extension-vscode:typecheck`
- [ ] Lint: `npx nx run ptah-extension-vscode:lint`
- [ ] Runtime test: Press F5, verify activation

### Step 7: Delete Old Code

- [ ] Delete `apps/ptah-extension-vscode/src/services/ai-providers/`
- [ ] Search for remaining references (should be none)
- [ ] Final build: `npx nx build ptah-extension-vscode`
- [ ] Final runtime test: Press F5

---

**Estimated Total Time**: 4-5 hours  
**Risk Level**: Medium (architectural change, but well-isolated)  
**Rollback Plan**: Git revert (branch is clean)

**Status**: 📋 **READY TO EXECUTE**  
**Next**: Execute Step 1 - Create registration function
