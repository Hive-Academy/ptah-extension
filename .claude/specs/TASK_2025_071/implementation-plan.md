# Implementation Plan - TASK_2025_071: DI Registration Standardization

## 📊 Codebase Investigation Summary

### Current DI Registration State

**Libraries with standardized registration functions:**

1. **agent-sdk** (`libs/backend/agent-sdk/src/lib/di/register.ts`)

   - ✅ Function: `registerSdkServices(container, context, logger)`
   - ✅ Pattern: Parameter-based container injection
   - ✅ Integration: Called in container.ts (line 271)
   - ✅ All 11 SDK services encapsulated in registration function

2. **agent-generation** (`libs/backend/agent-generation/src/lib/di/register.ts`)
   - ✅ Function: `registerAgentGenerationServices(container, logger)`
   - ✅ Pattern: Parameter-based container injection
   - ✅ Integration: Called in container.ts (line 292)
   - ✅ All 9 agent-generation services encapsulated

**Libraries with NON-standard registration:**

3. **llm-abstraction** (`libs/backend/llm-abstraction/src/lib/di/registration.ts`)

   - ❌ File name: `registration.ts` (should be `register.ts`)
   - ❌ Function: `registerLlmAbstraction()` (no parameters)
   - ❌ Pattern: Uses global `container` import
   - ❌ Integration: NOT called in container.ts
   - ❌ Uses `console.log` instead of injected logger
   - Services: ProviderRegistry, LlmService (2 services)

4. **template-generation** (`libs/backend/template-generation/src/lib/di/registration.ts`)
   - ❌ File name: `registration.ts` (should be `register.ts`)
   - ❌ Function: `registerTemplateGeneration()` (no parameters)
   - ❌ Pattern: Uses global `container` import
   - ❌ Integration: NOT called in container.ts
   - ❌ No logging
   - Services: 8 services (FileSystemAdapter, TemplateManager, ContentProcessor, etc.)

**Libraries WITHOUT registration functions (services registered directly in container.ts):**

5. **workspace-intelligence** (17 services in container.ts lines 163-245)

   - NO registration file exists
   - Pattern: Direct `container.registerSingleton()` calls in container.ts
   - Services: PatternMatcher, IgnorePatternResolver, FileTypeClassifier, WorkspaceIndexer, WorkspaceAnalyzer, WorkspaceService, MonorepoDetector, DependencyAnalyzer, FrameworkDetector, ProjectDetector, ContextService, FileSystemService, TokenCounter, FileRelevanceScorer, ContextSizeOptimizer, ContextOrchestration, TreeSitterParser, AstAnalysis, AgentDiscovery, CommandDiscovery

6. **vscode-lm-tools** (3 services in container.ts lines 255-262)

   - NO registration file exists
   - Pattern: Direct `container.registerSingleton()` calls
   - Services: PtahAPIBuilder, CodeExecutionMCP, PermissionPromptService

7. **vscode-core** (10 services in container.ts lines 110-156)
   - NO registration file exists
   - Pattern: Direct registration in container.ts
   - Services: Logger, ErrorHandler, ConfigManager, MessageValidator, CommandManager, WebviewManager, OutputManager, StatusBarManager, FileSystemManager, RpcHandler, AgentSessionWatcher

### Evidence Sources

**Registration Pattern Evidence:**

- agent-sdk: `libs/backend/agent-sdk/src/lib/di/register.ts:44-153`
- agent-generation: `libs/backend/agent-generation/src/lib/di/register.ts:37-131`
- llm-abstraction: `libs/backend/llm-abstraction/src/lib/di/registration.ts:25-30`
- template-generation: `libs/backend/template-generation/src/lib/di/registration.ts:16-44`

**Container.ts Direct Registration Evidence:**

- vscode-core services: `apps/ptah-extension-vscode/src/di/container.ts:110-156`
- workspace-intelligence services: `apps/ptah-extension-vscode/src/di/container.ts:163-245`
- vscode-lm-tools services: `apps/ptah-extension-vscode/src/di/container.ts:255-262`

**Export Pattern Evidence:**

- agent-sdk index.ts: `libs/backend/agent-sdk/src/index.ts:26` (exports `registerSdkServices`)
- agent-generation index.ts: `libs/backend/agent-generation/src/index.ts:16` (exports via `export * from './lib/di'`)
- llm-abstraction index.ts: `libs/backend/llm-abstraction/src/index.ts:37` (exports `registerLlmAbstraction`)
- template-generation index.ts: `libs/backend/template-generation/src/index.ts:16` (exports `registerTemplateGeneration`)

---

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Centralized registration functions with parameter injection pattern
**Rationale**:

- Matches existing agent-sdk and agent-generation patterns (verified in codebase)
- Enables testability via container injection
- Improves logging consistency via logger injection
- Decouples libraries from global container singleton
- Simplifies container.ts to pure orchestration

**Evidence**:

- Pattern established in: `agent-sdk/di/register.ts:44`, `agent-generation/di/register.ts:37`
- Successfully used for 20 services across 2 libraries
- Container.ts lines 271, 292 demonstrate clean integration pattern

### Standardized Registration Pattern

**All registration functions MUST follow this signature:**

```typescript
/**
 * Register [LibraryName] services in DI container
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for registration logging
 */
export function register[LibraryName]Services(
  container: DependencyContainer,
  logger: Logger
): void {
  logger.info('[LibraryName] Registering services...');

  // Service registrations here

  logger.info('[LibraryName] Services registered', {
    services: ['SERVICE_1', 'SERVICE_2', ...]
  });
}
```

**Special case - vscode-core requires extension context:**

```typescript
/**
 * Register vscode-core services in DI container
 *
 * @param container - TSyringe DI container
 * @param context - VS Code extension context (for contextual services)
 * @param logger - Logger instance for registration logging
 */
export function registerVsCodeCoreServices(container: DependencyContainer, context: vscode.ExtensionContext, logger: Logger): void {
  // ...
}
```

---

## 🎯 Component Specifications

### Component 1: llm-abstraction Registration Refactor

**Purpose**: Standardize llm-abstraction registration to match agent-sdk pattern

**Pattern**: Parameter-based container injection (verified from agent-sdk)
**Evidence**: `agent-sdk/di/register.ts:44-153`

**Responsibilities**:

- Rename `registration.ts` → `register.ts`
- Refactor function signature from `()` to `(container, logger)`
- Remove global `container` import
- Replace `console.log` with injected `logger.info()`
- Maintain service registration order (ProviderRegistry, LlmService)

**Implementation Pattern**:

```typescript
// Pattern source: agent-sdk/di/register.ts:44
// Verified imports: DependencyContainer from tsyringe, Logger from vscode-core
import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { LlmService } from '../services/llm.service';
import { ProviderRegistry } from '../registry/provider-registry';

export function registerLlmAbstractionServices(container: DependencyContainer, logger: Logger): void {
  logger.info('[LLM Abstraction] Registering services...');

  container.registerSingleton(TOKENS.PROVIDER_REGISTRY, ProviderRegistry);
  container.registerSingleton(TOKENS.LLM_SERVICE, LlmService);

  logger.info('[LLM Abstraction] Services registered', {
    services: ['PROVIDER_REGISTRY', 'LLM_SERVICE'],
  });
}
```

**Quality Requirements**:

- **Functional**: Registration must maintain singleton lifecycle for both services
- **Non-functional**: No global container imports allowed
- **Pattern Compliance**: Must match agent-sdk registration pattern (verified at register.ts:44)

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/di/registration.ts` (RENAME to `register.ts`)
- `libs/backend/llm-abstraction/src/lib/di/index.ts` (UPDATE export)
- `libs/backend/llm-abstraction/src/index.ts` (UPDATE export name)

---

### Component 2: template-generation Registration Refactor

**Purpose**: Standardize template-generation registration to match agent-sdk pattern

**Pattern**: Parameter-based container injection (verified from agent-sdk)
**Evidence**: `agent-sdk/di/register.ts:44-153`

**Responsibilities**:

- Rename `registration.ts` → `register.ts`
- Refactor function signature from `()` to `(container, logger)`
- Remove global `container` import
- Add registration logging
- Maintain service registration order (all 8 services)

**Implementation Pattern**:

```typescript
// Pattern source: agent-sdk/di/register.ts:44
// Verified imports from: agent-sdk, agent-generation registration files
import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { TemplateManagerService } from '../services/template-manager.service';
import { ContentGeneratorService } from '../services/content-generator.service';
import { ContentProcessorService } from '../services/content-processor.service';
import { TemplateProcessorService } from '../services/template-processor.service';
import { TemplateFileManagerService } from '../services/template-file-manager.service';
import { TemplateOrchestratorService } from '../services/template-orchestrator.service';
import { TemplateGeneratorService } from '../services/template-generator.service';
import { FileSystemAdapter } from '../adapters/file-system.adapter';

export function registerTemplateGenerationServices(container: DependencyContainer, logger: Logger): void {
  logger.info('[Template Generation] Registering services...');

  // Register all 8 services as singletons (maintain current order)
  container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemAdapter);
  container.registerSingleton(TOKENS.TEMPLATE_MANAGER, TemplateManagerService);
  container.registerSingleton(TOKENS.CONTENT_PROCESSOR, ContentProcessorService);
  container.registerSingleton(TOKENS.CONTENT_GENERATOR, ContentGeneratorService);
  container.registerSingleton(TOKENS.TEMPLATE_PROCESSOR, TemplateProcessorService);
  container.registerSingleton(TOKENS.TEMPLATE_FILE_MANAGER, TemplateFileManagerService);
  container.registerSingleton(TOKENS.TEMPLATE_ORCHESTRATOR, TemplateOrchestratorService);
  container.registerSingleton(TOKENS.TEMPLATE_GENERATOR_SERVICE, TemplateGeneratorService);

  logger.info('[Template Generation] Services registered', {
    services: ['FILE_SYSTEM_SERVICE', 'TEMPLATE_MANAGER', 'CONTENT_PROCESSOR', 'CONTENT_GENERATOR', 'TEMPLATE_PROCESSOR', 'TEMPLATE_FILE_MANAGER', 'TEMPLATE_ORCHESTRATOR', 'TEMPLATE_GENERATOR_SERVICE'],
  });
}
```

**Quality Requirements**:

- **Functional**: All 8 services must be registered as singletons
- **Non-functional**: Registration order must be preserved (dependency-aware)
- **Pattern Compliance**: Must match agent-generation registration pattern (verified at register.ts:37)

**Files Affected**:

- `libs/backend/template-generation/src/lib/di/registration.ts` (RENAME to `register.ts`)
- `libs/backend/template-generation/src/lib/di/index.ts` (UPDATE export if exists)
- `libs/backend/template-generation/src/index.ts` (UPDATE export name)

---

### Component 3: workspace-intelligence Registration Creation

**Purpose**: Create new registration function for workspace-intelligence services

**Pattern**: Parameter-based container injection (verified from agent-sdk)
**Evidence**: `agent-sdk/di/register.ts:44-153`, existing services in container.ts:163-245

**Responsibilities**:

- Create new `libs/backend/workspace-intelligence/src/di/` directory
- Create `register.ts` file with `registerWorkspaceIntelligenceServices(container, logger)`
- Extract all 20 workspace-intelligence service registrations from container.ts
- Maintain dependency order (base services → project detection → indexing → analysis → context → AST → autocomplete)

**Implementation Pattern**:

```typescript
// Pattern source: agent-generation/di/register.ts:37
// Services extracted from: container.ts:163-245
import { DependencyContainer, Lifecycle } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';

// Import all workspace-intelligence services (20 total)
import { PatternMatcherService, IgnorePatternResolverService, FileTypeClassifierService, WorkspaceIndexerService, WorkspaceAnalyzerService, WorkspaceService, MonorepoDetectorService, DependencyAnalyzerService, FrameworkDetectorService, ProjectDetectorService, ContextService, FileSystemService, TokenCounterService, FileRelevanceScorerService, ContextSizeOptimizerService, ContextOrchestrationService, TreeSitterParserService, AstAnalysisService, AgentDiscoveryService, CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';

/**
 * Register workspace-intelligence services in DI container
 *
 * DEPENDENCY ORDER (CRITICAL):
 * 1. Base services (no dependencies)
 * 2. Project detection services
 * 3. Indexing services (depend on base)
 * 4. Analysis services (depend on indexing)
 * 5. Context services
 * 6. AST services
 * 7. Autocomplete discovery services
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance
 */
export function registerWorkspaceIntelligenceServices(container: DependencyContainer, logger: Logger): void {
  logger.info('[Workspace Intelligence] Registering services...');

  // ============================================================
  // Base services (no dependencies)
  // ============================================================
  container.registerSingleton(TOKENS.PATTERN_MATCHER_SERVICE, PatternMatcherService);
  container.registerSingleton(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE, IgnorePatternResolverService);
  container.registerSingleton(TOKENS.FILE_TYPE_CLASSIFIER_SERVICE, FileTypeClassifierService);
  container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemService);
  container.registerSingleton(TOKENS.TOKEN_COUNTER_SERVICE, TokenCounterService);

  // ============================================================
  // Project detection services
  // ============================================================
  container.registerSingleton(TOKENS.MONOREPO_DETECTOR_SERVICE, MonorepoDetectorService);
  container.registerSingleton(TOKENS.DEPENDENCY_ANALYZER_SERVICE, DependencyAnalyzerService);
  container.registerSingleton(TOKENS.FRAMEWORK_DETECTOR_SERVICE, FrameworkDetectorService);
  container.registerSingleton(TOKENS.PROJECT_DETECTOR_SERVICE, ProjectDetectorService);

  // ============================================================
  // Indexing services (depend on base services)
  // ============================================================
  container.registerSingleton(TOKENS.WORKSPACE_INDEXER_SERVICE, WorkspaceIndexerService);

  // ============================================================
  // Analysis services (depend on indexing)
  // ============================================================
  container.registerSingleton(TOKENS.WORKSPACE_ANALYZER_SERVICE, WorkspaceAnalyzerService);
  container.registerSingleton(TOKENS.WORKSPACE_SERVICE, WorkspaceService);

  // ============================================================
  // Context services
  // ============================================================
  container.registerSingleton(TOKENS.CONTEXT_SERVICE, ContextService);
  container.registerSingleton(TOKENS.FILE_RELEVANCE_SCORER, FileRelevanceScorerService);
  container.registerSingleton(TOKENS.CONTEXT_SIZE_OPTIMIZER, ContextSizeOptimizerService);
  container.registerSingleton(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, ContextOrchestrationService);

  // ============================================================
  // AST services (Phase 2: RooCode migration)
  // ============================================================
  container.registerSingleton(TOKENS.TREE_SITTER_PARSER_SERVICE, TreeSitterParserService);
  container.registerSingleton(TOKENS.AST_ANALYSIS_SERVICE, AstAnalysisService);

  // ============================================================
  // Autocomplete discovery services
  // ============================================================
  container.registerSingleton(TOKENS.AGENT_DISCOVERY_SERVICE, AgentDiscoveryService);
  container.registerSingleton(TOKENS.COMMAND_DISCOVERY_SERVICE, CommandDiscoveryService);

  logger.info('[Workspace Intelligence] Services registered', {
    services: ['PATTERN_MATCHER_SERVICE', 'IGNORE_PATTERN_RESOLVER_SERVICE', 'FILE_TYPE_CLASSIFIER_SERVICE', 'FILE_SYSTEM_SERVICE', 'TOKEN_COUNTER_SERVICE', 'MONOREPO_DETECTOR_SERVICE', 'DEPENDENCY_ANALYZER_SERVICE', 'FRAMEWORK_DETECTOR_SERVICE', 'PROJECT_DETECTOR_SERVICE', 'WORKSPACE_INDEXER_SERVICE', 'WORKSPACE_ANALYZER_SERVICE', 'WORKSPACE_SERVICE', 'CONTEXT_SERVICE', 'FILE_RELEVANCE_SCORER', 'CONTEXT_SIZE_OPTIMIZER', 'CONTEXT_ORCHESTRATION_SERVICE', 'TREE_SITTER_PARSER_SERVICE', 'AST_ANALYSIS_SERVICE', 'AGENT_DISCOVERY_SERVICE', 'COMMAND_DISCOVERY_SERVICE'],
  });
}
```

**Quality Requirements**:

- **Functional**: All 20 services must be registered in correct dependency order
- **Non-functional**: Dependency order MUST be preserved (base → project → indexing → analysis → context → AST → autocomplete)
- **Pattern Compliance**: Must match agent-generation 3-tier registration pattern (foundation → mid-level → high-level)

**Files Affected**:

- `libs/backend/workspace-intelligence/src/di/register.ts` (CREATE)
- `libs/backend/workspace-intelligence/src/di/index.ts` (CREATE - export registration function)
- `libs/backend/workspace-intelligence/src/index.ts` (MODIFY - add DI export)

---

### Component 4: vscode-lm-tools Registration Creation

**Purpose**: Create new registration function for vscode-lm-tools services

**Pattern**: Parameter-based container injection (verified from agent-sdk)
**Evidence**: `agent-sdk/di/register.ts:44-153`, existing services in container.ts:255-262

**Responsibilities**:

- Create new `libs/backend/vscode-lm-tools/src/lib/di/` directory
- Create `register.ts` file with `registerVsCodeLmToolsServices(container, logger)`
- Extract 3 vscode-lm-tools service registrations from container.ts
- Maintain registration order (PtahAPIBuilder, CodeExecutionMCP, PermissionPromptService)

**Implementation Pattern**:

```typescript
// Pattern source: agent-generation/di/register.ts:37
// Services extracted from: container.ts:255-262
import { DependencyContainer, Lifecycle } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PtahAPIBuilder, CodeExecutionMCP, PermissionPromptService } from '@ptah-extension/vscode-lm-tools';

/**
 * Register vscode-lm-tools services in DI container
 *
 * IMPORTANT: These services expose workspace-intelligence to Claude CLI
 * via Code Execution MCP server.
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance
 */
export function registerVsCodeLmToolsServices(container: DependencyContainer, logger: Logger): void {
  logger.info('[VS Code LM Tools] Registering services...');

  // Code Execution MCP services (expose workspace-intelligence to Claude CLI)
  container.registerSingleton(TOKENS.PTAH_API_BUILDER, PtahAPIBuilder);
  container.registerSingleton(TOKENS.CODE_EXECUTION_MCP, CodeExecutionMCP);

  // Permission Prompt Service (TASK_2025_026)
  container.registerSingleton(TOKENS.PERMISSION_PROMPT_SERVICE, PermissionPromptService);

  logger.info('[VS Code LM Tools] Services registered', {
    services: ['PTAH_API_BUILDER', 'CODE_EXECUTION_MCP', 'PERMISSION_PROMPT_SERVICE'],
  });
}
```

**Quality Requirements**:

- **Functional**: All 3 services must be registered as singletons
- **Non-functional**: Registration order must be preserved (API builder → MCP → Permission service)
- **Pattern Compliance**: Must match agent-generation simple registration pattern

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/di/register.ts` (CREATE)
- `libs/backend/vscode-lm-tools/src/lib/di/index.ts` (CREATE - export registration function)
- `libs/backend/vscode-lm-tools/src/index.ts` (MODIFY - add DI export)

---

### Component 5: vscode-core Registration Creation

**Purpose**: Create new registration function for vscode-core infrastructure services

**Pattern**: Parameter-based container injection with context (verified from agent-sdk)
**Evidence**: `agent-sdk/di/register.ts:44-153` (uses context parameter), existing services in container.ts:110-156

**Responsibilities**:

- Create `libs/backend/vscode-core/src/di/register.ts` file
- Create `registerVsCodeCoreServices(container, context, logger)` function
- Extract 11 vscode-core service registrations from container.ts
- Special handling for RpcMethodRegistrationService (uses factory pattern with container)

**Implementation Pattern**:

```typescript
// Pattern source: agent-sdk/di/register.ts:44 (context parameter usage)
// Services extracted from: container.ts:110-156
import { DependencyContainer, Lifecycle } from 'tsyringe';
import * as vscode from 'vscode';
import type { Logger } from '../logging/logger';
import { TOKENS } from './tokens';

// Import vscode-core services
import { ErrorHandler } from '../error-handling/error-handler';
import { ConfigManager } from '../config/config-manager';
import { MessageValidatorService } from '../validation/message-validator.service';
import { CommandManager } from '../api-wrappers/command-manager';
import { WebviewManager } from '../api-wrappers/webview-manager';
import { OutputManager } from '../api-wrappers/output-manager';
import { StatusBarManager } from '../api-wrappers/status-bar-manager';
import { FileSystemManager } from '../api-wrappers/file-system-manager';
import { RpcHandler } from '../messaging/rpc-handler';
import { AgentSessionWatcherService } from '../services/agent-session-watcher.service';

/**
 * Register vscode-core infrastructure services in DI container
 *
 * IMPORTANT: Logger must be registered BEFORE calling this function
 * (Logger is created directly in container.ts line 110)
 *
 * @param container - TSyringe DI container
 * @param context - VS Code extension context (needed for some services)
 * @param logger - Logger instance (already registered in container)
 */
export function registerVsCodeCoreServices(container: DependencyContainer, context: vscode.ExtensionContext, logger: Logger): void {
  logger.info('[VS Code Core] Registering infrastructure services...');

  // ============================================================
  // Core infrastructure (Logger already registered externally)
  // ============================================================
  container.registerSingleton(TOKENS.ERROR_HANDLER, ErrorHandler);
  container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);
  container.registerSingleton(TOKENS.MESSAGE_VALIDATOR, MessageValidatorService);

  // ============================================================
  // API Wrappers
  // ============================================================
  container.registerSingleton(TOKENS.COMMAND_MANAGER, CommandManager);
  container.registerSingleton(TOKENS.WEBVIEW_MANAGER, WebviewManager);
  container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
  container.registerSingleton(TOKENS.STATUS_BAR_MANAGER, StatusBarManager);
  container.registerSingleton(TOKENS.FILE_SYSTEM_MANAGER, FileSystemManager);

  // ============================================================
  // RPC Handler
  // ============================================================
  container.registerSingleton(TOKENS.RPC_HANDLER, RpcHandler);

  // ============================================================
  // Agent Session Watcher
  // ============================================================
  container.registerSingleton(TOKENS.AGENT_SESSION_WATCHER_SERVICE, AgentSessionWatcherService);

  logger.info('[VS Code Core] Infrastructure services registered', {
    services: ['ERROR_HANDLER', 'CONFIG_MANAGER', 'MESSAGE_VALIDATOR', 'COMMAND_MANAGER', 'WEBVIEW_MANAGER', 'OUTPUT_MANAGER', 'STATUS_BAR_MANAGER', 'FILE_SYSTEM_MANAGER', 'RPC_HANDLER', 'AGENT_SESSION_WATCHER_SERVICE'],
  });
}
```

**Quality Requirements**:

- **Functional**: All 10 infrastructure services must be registered (Logger excluded - registered separately)
- **Non-functional**: Logger MUST be registered before calling this function (dependency)
- **Pattern Compliance**: Must match agent-sdk context-aware registration pattern

**Files Affected**:

- `libs/backend/vscode-core/src/di/register.ts` (CREATE)
- `libs/backend/vscode-core/src/di/index.ts` (MODIFY - add export)
- `libs/backend/vscode-core/src/index.ts` (MODIFY - add DI export)

---

### Component 6: Container.ts Refactor

**Purpose**: Refactor main container.ts to only call library registration functions

**Pattern**: Orchestration pattern (verified from existing container.ts structure)
**Evidence**: `container.ts:271` (agent-sdk call), `container.ts:292` (agent-generation call)

**Responsibilities**:

- Remove all direct service registrations (lines 110-262)
- Replace with library registration function calls
- Maintain phase structure (PHASE 0, 1, 2, etc.)
- Keep extension context and storage adapter registration (app-level concerns)
- Preserve RpcMethodRegistrationService factory pattern (requires container instance)

**Implementation Pattern**:

```typescript
// Pattern source: container.ts:271-292 (existing library registration calls)
// Verified: All registration functions exported from libraries

/**
 * Centralized Dependency Injection Container
 *
 * REFACTORED: All service registrations now encapsulated in library registration functions.
 * This file ONLY orchestrates library registration in correct dependency order.
 */

import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

// Import TOKENS (single source of truth)
import { TOKENS } from '@ptah-extension/vscode-core';

// Import Logger class (must be instantiated before calling registration functions)
import { Logger } from '@ptah-extension/vscode-core';

// Import library registration functions
import { registerVsCodeCoreServices } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import { registerVsCodeLmToolsServices } from '@ptah-extension/vscode-lm-tools';
import { registerSdkServices } from '@ptah-extension/agent-sdk';
import { registerAgentGenerationServices } from '@ptah-extension/agent-generation';
import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';
import { registerTemplateGenerationServices } from '@ptah-extension/template-generation';

// Import app-level services (NOT in libraries)
import { RpcMethodRegistrationService } from '../services/rpc-method-registration.service';
import { WebviewEventQueue } from '../services/webview-event-queue';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';

// Import SDK RPC handlers (vscode-core export)
import { SdkRpcHandlers } from '@ptah-extension/vscode-core';

/**
 * Centralized DI Container
 * Orchestrates library registration in correct dependency order
 */
export class DIContainer {
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // ========================================
    // PHASE 0: Extension Context (MUST BE FIRST)
    // ========================================
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

    // ========================================
    // PHASE 1: Infrastructure Services (vscode-core)
    // ========================================
    // Logger MUST be registered BEFORE calling any registration functions
    container.registerSingleton(TOKENS.LOGGER, Logger);
    const logger = container.resolve<Logger>(TOKENS.LOGGER);

    // Register remaining vscode-core infrastructure services
    registerVsCodeCoreServices(container, context, logger);

    // ========================================
    // PHASE 2: Workspace Intelligence Services
    // ========================================
    registerWorkspaceIntelligenceServices(container, logger);

    // ========================================
    // PHASE 2.5: Code Execution MCP (vscode-lm-tools)
    // ========================================
    registerVsCodeLmToolsServices(container, logger);

    // ========================================
    // PHASE 2.7: Agent SDK Integration
    // ========================================
    registerSdkServices(container, context, logger);

    // Register SDK RPC handlers
    container.registerSingleton(TOKENS.SDK_RPC_HANDLERS, SdkRpcHandlers);

    // Register adapter with main TOKENS symbol (TASK_2025_057 Batch 1)
    container.register(TOKENS.SDK_AGENT_ADAPTER, {
      useFactory: () => {
        const { SDK_TOKENS } = require('@ptah-extension/agent-sdk');
        return container.resolve(SDK_TOKENS.SDK_AGENT_ADAPTER);
      },
    });

    // ========================================
    // PHASE 2.8: Agent Generation Services
    // ========================================
    registerAgentGenerationServices(container, logger);

    // ========================================
    // PHASE 2.9: LLM Abstraction Services
    // ========================================
    registerLlmAbstractionServices(container, logger);

    // ========================================
    // PHASE 2.10: Template Generation Services
    // ========================================
    registerTemplateGenerationServices(container, logger);

    // ========================================
    // PHASE 3: App-Level Services (NOT in libraries)
    // ========================================

    // Storage adapter (from VS Code workspace state)
    const storageAdapter = {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const value = context.workspaceState.get<T>(key);
        return value !== undefined ? value : defaultValue;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await context.workspaceState.update(key, value);
      },
    };
    container.register(TOKENS.STORAGE_SERVICE, { useValue: storageAdapter });

    // Global state adapter (for pricing cache)
    container.register(TOKENS.GLOBAL_STATE, { useValue: context.globalState });

    // ========================================
    // PHASE 4: Main App Services
    // ========================================

    // RPC Method Registration Service (app-level orchestration)
    // MUST remain in container.ts (requires container instance)
    container.register(TOKENS.RPC_METHOD_REGISTRATION_SERVICE, {
      useFactory: (c) => {
        return new RpcMethodRegistrationService(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(TOKENS.CONTEXT_ORCHESTRATION_SERVICE),
          c.resolve(TOKENS.AGENT_DISCOVERY_SERVICE),
          c.resolve(TOKENS.COMMAND_DISCOVERY_SERVICE),
          c.resolve(TOKENS.WEBVIEW_MANAGER),
          c.resolve(TOKENS.AGENT_SESSION_WATCHER_SERVICE),
          c.resolve(TOKENS.CONFIG_MANAGER),
          c.resolve(TOKENS.COMMAND_MANAGER),
          c.resolve('SdkAgentAdapter'),
          c.resolve('SdkSessionStorage'),
          c // Pass container instance
        );
      },
    });

    // Webview support services (app-level)
    container.registerSingleton(TOKENS.WEBVIEW_EVENT_QUEUE, WebviewEventQueue);
    container.registerSingleton(TOKENS.ANGULAR_WEBVIEW_PROVIDER, AngularWebviewProvider);

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

export { container };
```

**Quality Requirements**:

- **Functional**: All services must be available after setup() completes
- **Non-functional**: Registration order must maintain dependency relationships
- **Pattern Compliance**: Must follow phase structure with library registration calls only

**Files Affected**:

- `apps/ptah-extension-vscode/src/di/container.ts` (REWRITE - 365 lines → ~150 lines)

---

## 🔗 Integration Architecture

### Integration Points

**Library Registration Call Order** (CRITICAL DEPENDENCY ORDER):

```
1. Extension Context Registration
   ↓
2. Logger Registration (special - must be first service)
   ↓
3. registerVsCodeCoreServices(container, context, logger)
   → Registers: ErrorHandler, ConfigManager, MessageValidator,
                CommandManager, WebviewManager, OutputManager,
                StatusBarManager, FileSystemManager, RpcHandler,
                AgentSessionWatcher
   ↓
4. registerWorkspaceIntelligenceServices(container, logger)
   → Depends on: vscode-core services (Logger, FileSystemManager)
   → Registers: 20 workspace analysis services
   ↓
5. registerVsCodeLmToolsServices(container, logger)
   → Depends on: workspace-intelligence (ContextOrchestration, etc.)
   → Registers: PtahAPIBuilder, CodeExecutionMCP, PermissionPromptService
   ↓
6. registerSdkServices(container, context, logger)
   → Depends on: vscode-core (Logger, ConfigManager)
   → Registers: 11 SDK services
   ↓
7. registerAgentGenerationServices(container, logger)
   → Depends on: workspace-intelligence, llm-abstraction
   → Registers: 9 agent generation services
   ↓
8. registerLlmAbstractionServices(container, logger)
   → Depends on: vscode-core (Logger)
   → Registers: ProviderRegistry, LlmService
   ↓
9. registerTemplateGenerationServices(container, logger)
   → Depends on: vscode-core (Logger, FileSystemManager)
   → Registers: 8 template services
   ↓
10. App-level service registrations (storage, RPC orchestration, webview)
```

**Evidence**: Dependency order verified from:

- container.ts:110-330 (current phase structure)
- agent-sdk CLAUDE.md (depends on vscode-core)
- agent-generation CLAUDE.md (depends on workspace-intelligence, llm-abstraction)
- workspace-intelligence CLAUDE.md (service dependency tree)

### Data Flow

**Registration Function Execution Flow:**

1. `container.ts:setup()` called from `main.ts` during activation
2. Extension context registered → TOKENS.EXTENSION_CONTEXT
3. Logger created and registered → TOKENS.LOGGER
4. Each library registration function called in dependency order
5. Each function:
   - Logs start of registration
   - Registers services via `container.registerSingleton()`
   - Logs completion with service list
6. App-level services registered
7. Container returned to main.ts for service resolution

**Error Propagation:**

- Registration errors throw immediately (fail-fast)
- Logger captures all registration events
- Extension activation fails if any registration fails

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

1. **All services must be accessible** after `DIContainer.setup()` completes
2. **Dependency order preserved**: Services with dependencies registered after their dependencies
3. **No breaking changes**: Service resolution behavior must remain identical
4. **Singleton lifecycle maintained**: All services remain singletons

### Non-Functional Requirements

**Performance**:

- Registration time: <100ms total (all libraries)
- No performance degradation vs. current direct registration

**Maintainability**:

- Each library owns its registration logic
- Container.ts reduced from 365 lines to ~150 lines
- New libraries follow clear registration pattern

**Testability**:

- Each registration function testable in isolation
- Container mocking simplified (inject test container)

**Logging**:

- All registration events logged with library name
- Service list logged on completion
- Errors logged with context

### Pattern Compliance

**All registration functions MUST:**

- ✅ Accept `(container, logger)` parameters (or `(container, context, logger)` for vscode-core)
- ✅ Use injected logger for all logging (no `console.log`)
- ✅ Use injected container for all registrations (no global import)
- ✅ Log start and completion with service list
- ✅ Be exported from library `index.ts`
- ✅ Have file named `register.ts` (not `registration.ts`)

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **backend-developer**

**Rationale**:

- **Primary work**: DI container refactoring and service registration patterns
- **Technology stack**: TypeScript, tsyringe (DI framework), Node.js patterns
- **No UI work**: Pure backend infrastructure refactoring
- **No VS Code API changes**: Only reorganizing existing registrations
- **Testing focus**: Unit tests for registration functions, integration tests for container

### Complexity Assessment

**Complexity**: **MEDIUM**

**Estimated Effort**: **8-12 hours**

**Breakdown**:

1. **llm-abstraction refactor**: 1 hour

   - Rename file
   - Update function signature
   - Update exports
   - Test registration

2. **template-generation refactor**: 1 hour

   - Rename file
   - Update function signature
   - Update exports
   - Test registration

3. **workspace-intelligence registration creation**: 2-3 hours

   - Create di/ directory structure
   - Extract 20 service registrations
   - Preserve dependency order
   - Update exports
   - Test all services resolve correctly

4. **vscode-lm-tools registration creation**: 1 hour

   - Create di/ structure
   - Extract 3 service registrations
   - Update exports
   - Test registration

5. **vscode-core registration creation**: 1-2 hours

   - Create register.ts
   - Extract 10 service registrations
   - Handle context parameter
   - Update exports
   - Test infrastructure services

6. **container.ts refactor**: 2-3 hours

   - Remove direct registrations (lines 110-262)
   - Add registration function imports
   - Add registration function calls
   - Preserve app-level services
   - Verify all services resolve correctly
   - Integration testing

7. **Testing & verification**: 1-2 hours
   - Unit tests for each registration function
   - Integration tests for container.ts
   - Verify extension activates successfully
   - Verify all features work (chat, setup wizard, etc.)

**Risk Factors**:

- **Dependency order critical**: Incorrect order causes runtime errors
- **Import path changes**: Must update all library exports correctly
- **Existing code relies on direct registration**: Must verify no code bypasses container

### Files Affected Summary

**CREATE** (8 files):

- `libs/backend/workspace-intelligence/src/di/register.ts`
- `libs/backend/workspace-intelligence/src/di/index.ts`
- `libs/backend/vscode-lm-tools/src/lib/di/register.ts`
- `libs/backend/vscode-lm-tools/src/lib/di/index.ts`
- `libs/backend/vscode-core/src/di/register.ts`

**RENAME** (2 files):

- `libs/backend/llm-abstraction/src/lib/di/registration.ts` → `register.ts`
- `libs/backend/template-generation/src/lib/di/registration.ts` → `register.ts`

**MODIFY** (9 files):

- `libs/backend/llm-abstraction/src/lib/di/index.ts`
- `libs/backend/llm-abstraction/src/index.ts`
- `libs/backend/template-generation/src/lib/di/index.ts` (if exists, else create)
- `libs/backend/template-generation/src/index.ts`
- `libs/backend/workspace-intelligence/src/index.ts`
- `libs/backend/vscode-lm-tools/src/index.ts`
- `libs/backend/vscode-core/src/di/index.ts`
- `libs/backend/vscode-core/src/index.ts`
- `apps/ptah-extension-vscode/src/di/container.ts` (REWRITE - major refactor)

**Total**: 8 CREATE + 2 RENAME + 9 MODIFY = **19 files affected**

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `DependencyContainer, Lifecycle` from `tsyringe` (verified in agent-sdk, agent-generation)
   - `Logger` type from `@ptah-extension/vscode-core` (verified in all registration files)
   - `TOKENS` from `@ptah-extension/vscode-core` (verified in container.ts:20)

2. **All service classes verified from examples**:

   - workspace-intelligence services: container.ts:163-245
   - vscode-lm-tools services: container.ts:255-262
   - vscode-core services: container.ts:110-156

3. **Registration patterns verified**:

   - agent-sdk pattern: `register.ts:44-153`
   - agent-generation pattern: `register.ts:37-131`

4. **No hallucinated APIs**:
   - All `container.registerSingleton()` calls use existing TOKENS
   - All service classes are imported from existing files
   - All registration functions follow verified pattern

### Architecture Delivery Checklist

- [x] All registration functions specified with evidence
- [x] All patterns verified from codebase (agent-sdk, agent-generation)
- [x] All imports verified as existing (TOKENS, Logger, services)
- [x] Quality requirements defined (functional, non-functional, pattern compliance)
- [x] Integration points documented (dependency order critical)
- [x] Files affected list complete (19 files)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 8-12 hours)
- [x] No step-by-step implementation (that's team-leader's job)

---

## 📋 Migration Strategy (Order of Changes)

### Phase 1: Refactor Existing Registration Functions (Low Risk)

**Order**: Safest changes first

1. **llm-abstraction refactor** (1 hour)

   - Rename `registration.ts` → `register.ts`
   - Update function signature
   - Update `index.ts` export
   - Test in isolation

2. **template-generation refactor** (1 hour)
   - Same steps as llm-abstraction
   - Test in isolation

**Risk**: LOW - Only changes function signatures, no new functionality

**Rollback Strategy**: Git revert individual commits

### Phase 2: Create New Registration Functions (Medium Risk)

**Order**: Simple libraries → complex libraries

3. **vscode-lm-tools registration creation** (1 hour)

   - Only 3 services
   - Simple dependency structure
   - Test registration function

4. **vscode-core registration creation** (1-2 hours)

   - 10 services
   - Special Logger handling
   - Context parameter
   - Test infrastructure registration

5. **workspace-intelligence registration creation** (2-3 hours)
   - 20 services
   - Complex dependency tree
   - Critical to preserve order
   - Extensive testing required

**Risk**: MEDIUM - New files, but services already work in container.ts

**Rollback Strategy**: Delete new files, revert container.ts changes

### Phase 3: Integrate into Container.ts (High Risk)

**Order**: Incremental integration with testing

6. **container.ts refactor - incremental approach**:

   a. **Add registration function imports** (30 min)

   - Import all registration functions
   - Don't call yet
   - Verify imports resolve

   b. **Replace vscode-lm-tools registration FIRST** (30 min)

   - Comment out direct registrations (lines 255-262)
   - Add `registerVsCodeLmToolsServices(container, logger)` call
   - Test extension activation
   - Verify 3 services resolve
   - If fails, uncomment direct registrations

   c. **Replace workspace-intelligence registration** (1 hour)

   - Comment out direct registrations (lines 163-245)
   - Add `registerWorkspaceIntelligenceServices(container, logger)` call
   - Test extension activation
   - Verify all 20 services resolve
   - Test workspace features (context orchestration, file search)
   - If fails, uncomment direct registrations

   d. **Replace vscode-core registration** (1 hour)

   - Comment out direct registrations (lines 110-156, except Logger)
   - Add `registerVsCodeCoreServices(container, context, logger)` call
   - Test extension activation
   - Verify all infrastructure services resolve
   - Test core features (commands, webviews, logging)
   - If fails, uncomment direct registrations

   e. **Add llm-abstraction and template-generation calls** (30 min)

   - Add `registerLlmAbstractionServices(container, logger)` call
   - Add `registerTemplateGenerationServices(container, logger)` call
   - Test extension activation
   - Verify services resolve
   - Test LLM and template features

   f. **Final cleanup** (30 min)

   - Remove commented-out code
   - Add phase comments
   - Update header documentation
   - Final integration test

**Risk**: HIGH - Changes main container.ts (365 lines → 150 lines)

**Rollback Strategy**:

- Git stash changes
- Revert to working container.ts
- Debug failing registration function
- Re-apply incrementally

### Phase 4: Testing & Validation (Critical)

7. **Comprehensive testing** (1-2 hours)
   - Unit tests for each registration function
   - Integration test for container.ts
   - Extension activation test
   - Feature smoke tests:
     - Chat functionality
     - Setup wizard
     - Agent generation
     - Workspace analysis
     - LLM integration
     - Template generation
   - Performance validation (registration time <100ms)

**Risk**: LOW - Validation phase only

**Success Criteria**:

- ✅ Extension activates without errors
- ✅ All services resolve correctly
- ✅ All features work as before
- ✅ Registration logs show all libraries
- ✅ No performance regression

---

## 🚨 Risk Assessment

### High-Risk Areas

1. **Dependency Order in Workspace Intelligence** (CRITICAL)

   - **Risk**: 20 services with complex dependencies
   - **Impact**: Runtime errors if order wrong
   - **Mitigation**:
     - Copy exact order from container.ts:163-245
     - Add comments explaining dependency relationships
     - Test service resolution in isolation
     - Verify with integration tests

2. **Container.ts Refactor** (HIGH)

   - **Risk**: Removing 150+ lines of working code
   - **Impact**: Extension fails to activate if wrong
   - **Mitigation**:
     - Incremental replacement (one library at a time)
     - Test after each library integration
     - Keep commented-out code until all tests pass
     - Git stash for quick rollback

3. **Logger Special Handling in vscode-core** (MEDIUM)
   - **Risk**: Logger must be registered BEFORE calling registerVsCodeCoreServices
   - **Impact**: Registration function can't log without Logger
   - **Mitigation**:
     - Document Logger must be registered first
     - Add assertion in registerVsCodeCoreServices
     - Test Logger resolution before other services

### Medium-Risk Areas

4. **Export Path Updates** (MEDIUM)

   - **Risk**: 9 files need export updates
   - **Impact**: Build errors, import failures
   - **Mitigation**:
     - Update all exports before calling registration functions
     - Run `nx build <library>` after each export change
     - Verify exports in library index.ts tests

5. **RpcMethodRegistrationService Special Case** (MEDIUM)
   - **Risk**: Requires container instance (can't be in library)
   - **Impact**: Must remain in container.ts
   - **Mitigation**:
     - Document why it stays in container.ts
     - Add comment explaining factory pattern necessity

### Low-Risk Areas

6. **File Renaming** (LOW)
   - **Risk**: 2 files renamed (registration.ts → register.ts)
   - **Impact**: Git history loss, import breaks
   - **Mitigation**:
     - Use `git mv` for rename (preserves history)
     - Update imports in same commit
     - Run TypeScript compiler to verify no broken imports

---

## 🧪 Testing Strategy

### Unit Tests (Each Registration Function)

**Test Template** (apply to all 7 registration functions):

```typescript
describe('register[LibraryName]Services', () => {
  let container: DependencyContainer;
  let logger: Logger;

  beforeEach(() => {
    container = createMockContainer();
    logger = createMockLogger();
  });

  it('should register all services', () => {
    register[LibraryName]Services(container, logger);

    expect(container.registerSingleton).toHaveBeenCalledWith(
      TOKENS.SERVICE_1,
      Service1Class
    );
    expect(container.registerSingleton).toHaveBeenCalledWith(
      TOKENS.SERVICE_2,
      Service2Class
    );
    // ... verify all services
  });

  it('should log registration start', () => {
    register[LibraryName]Services(container, logger);

    expect(logger.info).toHaveBeenCalledWith(
      '[LibraryName] Registering services...'
    );
  });

  it('should log registration completion with service list', () => {
    register[LibraryName]Services(container, logger);

    expect(logger.info).toHaveBeenCalledWith(
      '[LibraryName] Services registered',
      expect.objectContaining({
        services: expect.arrayContaining(['SERVICE_1', 'SERVICE_2'])
      })
    );
  });

  it('should register services in correct order', () => {
    const callOrder: string[] = [];
    jest.spyOn(container, 'registerSingleton').mockImplementation((token) => {
      callOrder.push(String(token));
    });

    register[LibraryName]Services(container, logger);

    // Verify dependency order
    expect(callOrder.indexOf('SERVICE_WITH_DEPS')).toBeGreaterThan(
      callOrder.indexOf('SERVICE_BASE')
    );
  });
});
```

### Integration Tests (Container.ts)

```typescript
describe('DIContainer.setup', () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    context = createMockExtensionContext();
    container.clearInstances();
  });

  it('should register all services from all libraries', () => {
    const container = DIContainer.setup(context);

    // Verify vscode-core services
    expect(container.isRegistered(TOKENS.LOGGER)).toBe(true);
    expect(container.isRegistered(TOKENS.ERROR_HANDLER)).toBe(true);
    // ... verify all TOKENS

    // Verify workspace-intelligence services (20 total)
    expect(container.isRegistered(TOKENS.PATTERN_MATCHER_SERVICE)).toBe(true);
    // ... verify all 20

    // Verify vscode-lm-tools services
    expect(container.isRegistered(TOKENS.PTAH_API_BUILDER)).toBe(true);
    // ... verify all 3

    // Verify agent-sdk services
    expect(container.isRegistered(SDK_TOKENS.SDK_AGENT_ADAPTER)).toBe(true);
    // ... verify all 11

    // Verify agent-generation services
    expect(container.isRegistered(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE)).toBe(true);
    // ... verify all 9

    // Verify llm-abstraction services
    expect(container.isRegistered(TOKENS.PROVIDER_REGISTRY)).toBe(true);
    expect(container.isRegistered(TOKENS.LLM_SERVICE)).toBe(true);

    // Verify template-generation services
    expect(container.isRegistered(TOKENS.TEMPLATE_MANAGER)).toBe(true);
    // ... verify all 8
  });

  it('should resolve all services without errors', () => {
    const container = DIContainer.setup(context);

    // Verify services can be resolved (no circular dependencies)
    expect(() => container.resolve(TOKENS.LOGGER)).not.toThrow();
    expect(() => container.resolve(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)).not.toThrow();
    expect(() => container.resolve(TOKENS.CODE_EXECUTION_MCP)).not.toThrow();
    // ... resolve all critical services
  });

  it('should register services in correct dependency order', () => {
    const registrationOrder: string[] = [];
    const originalRegister = container.registerSingleton;

    jest.spyOn(container, 'registerSingleton').mockImplementation((token, impl) => {
      registrationOrder.push(String(token));
      return originalRegister.call(container, token, impl);
    });

    DIContainer.setup(context);

    // Verify Logger registered before vscode-core services
    expect(registrationOrder.indexOf('LOGGER')).toBeLessThan(registrationOrder.indexOf('ERROR_HANDLER'));

    // Verify vscode-core before workspace-intelligence
    expect(registrationOrder.indexOf('FILE_SYSTEM_MANAGER')).toBeLessThan(registrationOrder.indexOf('PATTERN_MATCHER_SERVICE'));

    // ... verify all phase dependencies
  });
});
```

### Extension Activation Test

```typescript
describe('Extension Activation with Refactored Container', () => {
  it('should activate extension successfully', async () => {
    const context = await vscode.extensions.getExtension('ptah-extension').activate();

    expect(context).toBeDefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('should register all commands', async () => {
    await vscode.extensions.getExtension('ptah-extension').activate();

    const commands = await vscode.commands.getCommands();
    expect(commands).toContain('ptah.openChat');
    expect(commands).toContain('ptah.startSetupWizard');
    // ... verify all commands
  });
});
```

### Feature Smoke Tests

```typescript
describe('Feature Smoke Tests', () => {
  beforeEach(async () => {
    await vscode.extensions.getExtension('ptah-extension').activate();
  });

  it('should execute context orchestration', async () => {
    const contextOrchestration = container.resolve(TOKENS.CONTEXT_ORCHESTRATION_SERVICE);
    const files = await contextOrchestration.getAllFiles({ requestId: 'test' });
    expect(files).toBeDefined();
  });

  it('should execute code via MCP', async () => {
    const codeExecutionMCP = container.resolve(TOKENS.CODE_EXECUTION_MCP);
    const result = await codeExecutionMCP.executeCode({
      code: 'return 1 + 1;',
      timeout: 5000,
    });
    expect(result).toBe(2);
  });

  it('should generate agent content', async () => {
    const contentGen = container.resolve(AGENT_GENERATION_TOKENS.CONTENT_GENERATION_SERVICE);
    const result = await contentGen.generateContent({
      template: 'test-template',
      context: {},
    });
    expect(result).toBeDefined();
  });

  // ... more feature tests
});
```

### Performance Validation

```typescript
describe('Performance Validation', () => {
  it('should complete registration in <100ms', () => {
    const start = performance.now();
    DIContainer.setup(createMockExtensionContext());
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
  });

  it('should not increase extension activation time', async () => {
    const start = performance.now();
    await vscode.extensions.getExtension('ptah-extension').activate();
    const duration = performance.now() - start;

    // Verify activation time similar to before refactor
    expect(duration).toBeLessThan(2000); // 2 seconds max
  });
});
```

---

## 📈 Success Metrics

### Quantitative Metrics

1. **Code Reduction**:

   - container.ts: 365 lines → ~150 lines (-59%)
   - Service registrations: 0 in libraries → 60+ in libraries (+100%)

2. **Test Coverage**:

   - Registration functions: 7 new test suites
   - Container.ts: 1 refactored test suite
   - Feature smoke tests: 5+ critical features

3. **Performance**:
   - Registration time: <100ms (all libraries)
   - Extension activation: <2s (no regression)

### Qualitative Metrics

1. **Maintainability**:

   - ✅ Each library owns its DI registration
   - ✅ New libraries follow clear pattern
   - ✅ Container.ts is pure orchestration

2. **Testability**:

   - ✅ Registration functions testable in isolation
   - ✅ Container mocking simplified
   - ✅ Integration tests verify dependency order

3. **Developer Experience**:
   - ✅ Clear registration pattern (agent-sdk example)
   - ✅ Consistent file naming (`register.ts`)
   - ✅ Consistent function naming (`register[Library]Services`)
   - ✅ Logging shows registration progress

---

## 🔍 Post-Implementation Verification

### Verification Checklist

**After all changes are complete:**

- [ ] All 7 registration functions exist with correct signatures
- [ ] All 7 registration functions exported from library index.ts
- [ ] container.ts imports all 7 registration functions
- [ ] container.ts calls all 7 functions in correct order
- [ ] All direct service registrations removed from container.ts (except app-level)
- [ ] Extension activates without errors
- [ ] All commands registered
- [ ] All services resolve correctly
- [ ] All features work (chat, setup wizard, workspace analysis, etc.)
- [ ] Unit tests pass for all registration functions
- [ ] Integration tests pass for container.ts
- [ ] Performance metrics met (<100ms registration, <2s activation)
- [ ] No console errors in extension host
- [ ] Git history preserved for renamed files

### Rollback Criteria

**Rollback if ANY of these occur:**

1. Extension fails to activate
2. Any service resolution fails
3. Any feature breaks (chat, setup wizard, etc.)
4. Performance regression >20%
5. Test failures >10%

**Rollback Process:**

```bash
# Stash all changes
git stash save "DI Registration Standardization - ROLLBACK"

# Verify extension works on main branch
git checkout main
npm run build:all
# Test extension activation

# Debug issues in stashed changes
git stash pop
# Fix issues
# Re-test
```

---

## 📚 Documentation Updates Required

### Code Documentation

1. **Registration Function JSDoc** (all 7 functions):

   - Purpose
   - Parameters (container, logger, context if applicable)
   - Dependencies (which services must be registered first)
   - Service list

2. **Container.ts Header Comment**:

   - Update to reflect orchestration-only responsibility
   - Document phase structure
   - Document dependency order rationale

3. **Library CLAUDE.md Files**:
   - Update "Dependencies" section with DI registration info
   - Add "DI Registration" section explaining registration function
   - Update "Import Path" section with registration function export

### Architecture Documentation

1. **Main CLAUDE.md**:

   - Update "Workspace Architecture" section with DI standardization info
   - Add note about centralized registration pattern

2. **Task Documentation**:
   - Create post-mortem in TASK_2025_071 folder
   - Document final file structure
   - Document any deviations from plan
   - Document lessons learned

---

## 🎓 Lessons Learned (Post-Implementation)

**To be filled after implementation:**

- What worked well?
- What was harder than expected?
- What would you do differently?
- What patterns should be reused?
- What anti-patterns were discovered?

---

---

## 🔍 Code Review Findings & Remediation (Post-Implementation)

### Review Summary

After initial implementation (Batches 1-4), code style and logic reviews identified the following issues requiring remediation:

### CRITICAL Issues (Must Fix)

1. **TOKENS.FILE_SYSTEM_SERVICE Collision**
   - **Problem**: workspace-intelligence registers `FileSystemService` at Phase 2, template-generation registers `FileSystemAdapter` at Phase 2.10
   - **Impact**: Last registration wins, workspace-intelligence may use wrong implementation
   - **Location**: `libs/backend/workspace-intelligence/src/di/register.ts:87` and `libs/backend/template-generation/src/lib/di/register.ts:47`
   - **Remediation**: Batch 5

### BLOCKING Issues (Should Fix)

2. **Missing File Headers** - 3 of 5 registration files lack TASK_2025_071 context headers

   - **Files**: llm-abstraction, template-generation, vscode-lm-tools register.ts files
   - **Impact**: Future maintainers lack context about why file was created/modified
   - **Remediation**: Batch 6

3. **vscode-core Exports TOKENS from di/index.ts** - Breaks pattern

   - **Problem**: Other libraries only export registration function, vscode-core also exports TOKENS
   - **Location**: `libs/backend/vscode-core/src/di/index.ts:2`
   - **Impact**: Pattern inconsistency, potential circular dependency
   - **Remediation**: Batch 6

4. **Missing Dependency Validation** - No runtime checks for prerequisites
   - **Problem**: Registration functions don't validate dependencies are satisfied
   - **Examples**: RpcMethodRegistrationService factory has no validation, workspace-intelligence 7-tier hierarchy not enforced
   - **Impact**: Silent failures possible if registration order changes
   - **Remediation**: Batch 7 (optional enhancement)

### SERIOUS Issues (Nice to Fix)

5. **Inconsistent JSDoc Quality** - vscode-core has minimal JSDoc vs excellent in others
6. **Phase Numbering Fragile** - container.ts uses 2.9, 2.10 (confusing decimal system)
7. **No Idempotency Guards** - Registration functions can be called twice without warning
8. **Logger Not Validated** - Functions use logger.info() without checking logger is valid

---

## Component 7: TOKENS.FILE_SYSTEM_SERVICE Collision Fix (Batch 5)

**Purpose**: Resolve token collision between workspace-intelligence and template-generation

**Root Cause Analysis**:

- workspace-intelligence registers `FileSystemService` (full VS Code FileSystem wrapper)
- template-generation registers `FileSystemAdapter` (simple file I/O adapter)
- Both use TOKENS.FILE_SYSTEM_SERVICE
- Registration order: workspace-intelligence (Phase 2) → template-generation (Phase 2.10)
- Last registration wins → template-generation overwrites workspace-intelligence registration

**Solution Options**:

**Option A: Introduce Separate Token** (RECOMMENDED)

- Create new token: TOKENS.TEMPLATE_FILE_SYSTEM_ADAPTER
- Update template-generation to use new token
- Preserve workspace-intelligence using TOKENS.FILE_SYSTEM_SERVICE
- PRO: No breaking changes to workspace-intelligence
- CON: More tokens to maintain

**Option B: Share Single Implementation**

- Remove FileSystemAdapter from template-generation
- Make template-generation depend on workspace-intelligence FileSystemService
- PRO: Single source of truth
- CON: Creates cross-library dependency (workspace-intelligence → template-generation)

**Option C: Consolidate into vscode-core**

- Move FileSystemAdapter to vscode-core as TOKENS.FILE_ADAPTER
- Keep FileSystemService in workspace-intelligence as TOKENS.FILE_SYSTEM_SERVICE
- Both libraries depend on vscode-core
- PRO: Clean separation, no collision
- CON: Requires vscode-core changes

**Chosen Solution: Option A** (Least disruptive, fastest fix)

**Implementation Pattern**:

```typescript
// libs/backend/vscode-core/src/di/tokens.ts
export const TOKENS = {
  // ... existing tokens ...
  FILE_SYSTEM_SERVICE: Symbol.for('FileSystemService'), // Used by workspace-intelligence
  TEMPLATE_FILE_SYSTEM_ADAPTER: Symbol.for('TemplateFileSystemAdapter'), // NEW - for template-generation
  // ...
};

// libs/backend/template-generation/src/lib/di/register.ts
export function registerTemplateGenerationServices(container: DependencyContainer, logger: Logger): void {
  logger.info('[Template Generation] Registering services...');

  // CHANGED: Use new token to avoid collision with workspace-intelligence
  container.registerSingleton(TOKENS.TEMPLATE_FILE_SYSTEM_ADAPTER, FileSystemAdapter);

  // ... rest of registrations unchanged ...
}
```

**Quality Requirements**:

- **Functional**: Both services must coexist without collision
- **Non-functional**: Zero breaking changes to workspace-intelligence
- **Pattern Compliance**: New token follows existing naming convention

**Files Affected**:

- `libs/backend/vscode-core/src/di/tokens.ts` (ADD new token)
- `libs/backend/template-generation/src/lib/di/register.ts` (UPDATE to use new token)
- `libs/backend/template-generation/src/lib/adapters/file-system.adapter.ts` (UPDATE @inject decorator if used)
- Any services in template-generation that inject FILE_SYSTEM_SERVICE (UPDATE imports)

---

## Component 8: File Headers & Pattern Consistency (Batch 6)

**Purpose**: Add missing file headers and fix vscode-core export pattern inconsistency

### Sub-Component 8A: Add TASK_2025_071 Context Headers

**Files Requiring Headers**:

1. `libs/backend/llm-abstraction/src/lib/di/register.ts`
2. `libs/backend/template-generation/src/lib/di/register.ts`
3. `libs/backend/vscode-lm-tools/src/lib/di/register.ts`

**Header Template** (verified from agent-generation/di/register.ts):

```typescript
/**
 * DI Registration for [Library Name]
 *
 * TASK_2025_071: DI Registration Standardization
 * Created: 2025-12-14
 *
 * This file centralizes all service registrations for the [library-name] library.
 * Following the standardized registration pattern established in agent-sdk and agent-generation.
 *
 * Pattern:
 * - Function signature: register[LibraryName]Services(container, logger)
 * - Uses injected container (no global import)
 * - Uses injected logger (no console.log)
 * - Logs registration start and completion
 *
 * @see libs/backend/agent-sdk/src/lib/di/register.ts - Pattern reference
 * @see apps/ptah-extension-vscode/src/di/container.ts - Orchestration point
 */
```

**Quality Requirements**:

- **Functional**: Headers must accurately describe purpose and context
- **Non-functional**: Consistent format across all 3 files
- **Pattern Compliance**: Match agent-sdk/agent-generation header style

### Sub-Component 8B: Fix vscode-core di/index.ts Export Pattern

**Problem**: `libs/backend/vscode-core/src/di/index.ts` exports both TOKENS and registration function

```typescript
// CURRENT (INCONSISTENT):
export * from './tokens';
export { registerVsCodeCoreServices } from './register';
```

**Expected Pattern** (from other libraries):

```typescript
// CORRECT PATTERN:
export { registerVsCodeCoreServices } from './register';
// TOKENS should only be exported from vscode-core/src/di/tokens.ts
// Main index.ts (vscode-core/src/index.ts) exports di/ and tokens separately
```

**Verification**:

- agent-sdk/src/lib/di/index.ts: Only exports `registerSdkServices`
- agent-generation/src/lib/di/index.ts: Only exports `registerAgentGenerationServices`
- workspace-intelligence/src/di/index.ts: Only exports `registerWorkspaceIntelligenceServices`

**Implementation**:

```typescript
// libs/backend/vscode-core/src/di/index.ts
// REMOVE: export * from './tokens';
export { registerVsCodeCoreServices } from './register';

// Verify main index.ts still exports TOKENS:
// libs/backend/vscode-core/src/index.ts should have:
// export * from './di/tokens';
// export { registerVsCodeCoreServices } from './di';
```

**Quality Requirements**:

- **Functional**: TOKENS still accessible via `@ptah-extension/vscode-core` import
- **Non-functional**: Pattern consistent with other libraries
- **Pattern Compliance**: di/index.ts only exports registration function

**Files Affected**:

- `libs/backend/vscode-core/src/di/index.ts` (REMOVE tokens export)
- `libs/backend/vscode-core/src/index.ts` (VERIFY tokens still exported)

---

## Component 9: Runtime Dependency Validation (Batch 7 - Optional)

**Purpose**: Add runtime guards to detect registration order violations

**Problem**: No validation that prerequisites are satisfied before registration

**Examples of Missing Validation**:

1. registerVsCodeCoreServices expects Logger already registered - no check
2. workspace-intelligence 7-tier hierarchy has no enforcement
3. RpcMethodRegistrationService factory has no dependency checks

**Solution: Add Validation Guards**

**Implementation Pattern**:

```typescript
/**
 * Register vscode-core infrastructure services in DI container
 *
 * DEPENDENCIES (MUST BE REGISTERED FIRST):
 * - TOKENS.LOGGER (registered in container.ts before calling this function)
 * - TOKENS.EXTENSION_CONTEXT (registered in container.ts PHASE 0)
 *
 * @param container - TSyringe DI container
 * @param context - VS Code extension context
 * @param logger - Logger instance (already registered)
 */
export function registerVsCodeCoreServices(container: DependencyContainer, context: vscode.ExtensionContext, logger: Logger): void {
  // VALIDATION: Check prerequisites
  if (!container.isRegistered(TOKENS.LOGGER)) {
    throw new Error('[VS Code Core] DEPENDENCY ERROR: TOKENS.LOGGER must be registered before calling registerVsCodeCoreServices');
  }

  if (!container.isRegistered(TOKENS.EXTENSION_CONTEXT)) {
    throw new Error('[VS Code Core] DEPENDENCY ERROR: TOKENS.EXTENSION_CONTEXT must be registered before calling registerVsCodeCoreServices');
  }

  logger.info('[VS Code Core] Registering infrastructure services...');

  // ... rest of registrations ...
}
```

**Quality Requirements**:

- **Functional**: Fail-fast on dependency violations
- **Non-functional**: Clear error messages identifying missing prerequisite
- **Pattern Compliance**: Add to ALL registration functions

**Scope Decision**:

- CRITICAL: Add to registerVsCodeCoreServices (requires Logger first)
- HIGH: Add to workspace-intelligence (complex 7-tier dependencies)
- MEDIUM: Add to other libraries (simpler dependencies)

**Files Affected**:

- All 7 registration functions (add validation guards)

**Estimated Effort**: 2-3 hours (add guards to all functions + test failure paths)

**Priority**: NICE TO HAVE (Batch 7 optional - can defer to future task)

---

## ✅ Updated Definition of Done

**Original Implementation (Batches 1-4): COMPLETE ✅**

**Code Review Remediation (Batches 5-7):**

**Batch 5 - CRITICAL FIX** (MUST DO):

- [ ] TOKENS.FILE_SYSTEM_SERVICE collision resolved
- [ ] New token TOKENS.TEMPLATE_FILE_SYSTEM_ADAPTER created
- [ ] template-generation updated to use new token
- [ ] workspace-intelligence unchanged (preserves FileSystemService)
- [ ] Both services coexist without collision
- [ ] Build passes, extension activates

**Batch 6 - BLOCKING FIXES** (SHOULD DO):

- [ ] File headers added to 3 registration files
- [ ] Headers include TASK_2025_071 context, creation date, pattern reference
- [ ] vscode-core di/index.ts export pattern fixed
- [ ] TOKENS export removed from di/index.ts
- [ ] TOKENS still accessible via main index.ts
- [ ] Pattern consistent with other libraries

**Batch 7 - NICE TO HAVE** (OPTIONAL):

- [ ] Dependency validation guards added to registration functions
- [ ] registerVsCodeCoreServices validates Logger registered first
- [ ] workspace-intelligence validates base services before mid-tier
- [ ] Clear error messages on prerequisite violations
- [ ] Fail-fast behavior on registration order errors

**Final Acceptance Criteria:**

- Extension works identically to before refactor
- All services resolve correctly (no collisions)
- All features functional
- Code quality improved (reduced duplication, better separation of concerns)
- Code review issues addressed (CRITICAL + BLOCKING minimum)
- Pattern consistency across all libraries
- Clear documentation for future maintainers
