# Implementation Plan - TASK_CORE_001

**Task ID**: TASK_CORE_001  
**Created**: October 10, 2025  
**Architect**: software-architect  
**Revised Estimate**: **3 days** (down from 8-10 days)

---

## 🎯 Original User Request

**User Asked For**: "can we target them ( make sure we have all work done until phase 7 ) all in a new task please and lets scan our old application code for reference"

**Translation**: Complete ALL Weeks 1-6 infrastructure before proceeding to Week 7 (Session & Analytics libraries)

---

## 🔍 Research Evidence Integration

**CRITICAL FINDING**: Weeks 1-6 infrastructure is **~95% complete**!

**Evidence from Code Scan**:

✅ **Week 1** (Dependencies): `tsyringe`, `rxjs`, library scaffolding - COMPLETE  
✅ **Week 2** (Core DI): `DIContainer`, `EventBus`, tokens - COMPLETE (`libs/backend/vscode-core/src/di/`)  
✅ **Week 3** (API Wrappers): `CommandManager`, `WebviewManager`, `OutputManager`, `StatusBarManager`, `FileSystemManager` - COMPLETE (`libs/backend/vscode-core/src/api-wrappers/`)  
✅ **Week 4** (Provider System): `EnhancedAIProvider`, `ProviderManager`, `IntelligentProviderStrategy`, `ClaudeCliAdapter`, `VsCodeLmAdapter` - COMPLETE (`libs/backend/ai-providers-core/`)  
✅ **Week 5** (Claude Domain): `ClaudeCliDetector`, `SessionManager`, `ClaudeCliLauncher`, `ProcessManager`, `PermissionService` - COMPLETE (`libs/backend/claude-domain/`)  
✅ **Week 6** (Workspace Intelligence): 12 services, 3,003 lines - COMPLETE (TASK_PRV_005)

**What's Actually Missing** (5 services from main app):

1. ❌ `Logger` service (72 lines in `apps/ptah-extension-vscode/src/core/logger.ts`)
2. ❌ `ErrorHandler` service (127 lines in `apps/ptah-extension-vscode/src/handlers/error-handler.ts`)
3. ❌ `ConfigManager` service (558 lines in `apps/ptah-extension-vscode/src/config/ptah-config.service.ts`)
4. ❌ `ContextManager` service (180 lines in `apps/ptah-extension-vscode/src/services/context-manager.ts`)
5. ❌ Validation utilities (~150 lines in `apps/ptah-extension-vscode/src/services/validation/`)

**Total Missing Code**: ~1,087 lines (not ~3,500 as originally estimated)

**Old Code to Delete** (replaced by existing libraries):

- `service-registry.ts` (188 lines) → Replaced by `DIContainer`
- `command-registry.ts` (150 lines) → Replaced by `CommandManager`
- `webview-registry.ts` (120 lines) → Replaced by `WebviewManager`
- `event-registry.ts` (100 lines) → Replaced by `EventBus`
- `angular-webview.provider.ts` (300 lines) → Replaced by `WebviewManager`
- `webview-html-generator.ts` (120 lines) → Functionality in `WebviewManager`

---

## 🏗️ Architecture Overview

### Design Decisions

**Pattern**: **Extract & Delete** (not Build from Scratch)

**Rationale**:

- User requested completion of Weeks 1-6
- Research shows Weeks 1-6 are ~95% complete
- Only 5 services need extraction from main app
- Existing libraries already use SOLID patterns
- Main app has old registries that need deletion

**SOLID Compliance**:

1. **Single Responsibility**: Each service has one clear purpose

   - Logger: Structured logging only
   - ErrorHandler: Error boundaries and user notifications only
   - ConfigManager: Type-safe configuration only
   - ContextManager: Context optimization only
   - Validation: Message validation only

2. **Open/Closed**: Services extensible via composition

   - Logger uses OutputChannel (can add file logging later)
   - ErrorHandler uses Logger (can add remote error reporting later)
   - ConfigManager uses VS Code API (can add custom backends later)

3. **Liskov Substitution**: Services use constructor injection

   - All services can be mocked with same interface
   - Tests use mock implementations seamlessly

4. **Interface Segregation**: Focused public APIs

   - Logger: `info()`, `warn()`, `error()`, `debug()`
   - ErrorHandler: `handleError()`, `handleAsyncError()`, `createErrorBoundary()`
   - ConfigManager: `get()`, `set()`, `watch()`

5. **Dependency Inversion**: All depend on abstractions
   - Services use `@inject(TOKENS.X)` for dependencies
   - No concrete class imports between services
   - Easy to swap implementations

---

## 🔄 Type/Schema Strategy

### Existing Types to Reuse

**Search Completed** ✅

**From `@ptah-extension/shared`**:

- `ProviderId` - Already used in ConfigManager
- `ChatMessage`, `ChatSession` - For ContextManager
- `MessagePayloadMap` - For validation utilities
- `BrandedTypes` (`SessionId`, `MessageId`) - For type safety

**From `libs/backend/vscode-core/src/di/tokens.ts`**:

- `TOKENS.EXTENSION_CONTEXT` - VS Code context injection
- `TOKENS.EVENT_BUS` - EventBus injection
- `TOKENS.OUTPUT_MANAGER` - For Logger
- Existing pattern for new tokens

**From `libs/backend/ai-providers-core/src/interfaces/`**:

- `ProviderContext` - For ContextManager integration
- `EnhancedAIProvider` - For context optimization

**From `libs/backend/workspace-intelligence/src/`**:

- `WorkspaceIndexerService` - For ContextManager integration
- `TokenCounterService` - For context window management

### New Types Required

**1. Logger Types** - `libs/backend/vscode-core/src/logging/types.ts`:

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  readonly service?: string;
  readonly operation?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: Date;
  readonly context?: LogContext;
}
```

**2. ErrorHandler Types** - `libs/backend/vscode-core/src/error-handling/types.ts`:

```typescript
export interface ErrorContext {
  readonly service: string;
  readonly operation: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ErrorAction {
  readonly title: string;
  readonly handler: () => void | Promise<void>;
}

export interface ErrorBoundaryResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly error?: Error;
}
```

**3. Config Types** - `libs/backend/vscode-core/src/config/types.ts`:

```typescript
export interface ConfigWatcher {
  readonly key: string;
  readonly callback: (value: unknown) => void;
  readonly disposable: vscode.Disposable;
}

export interface ConfigurationSchema<T> {
  readonly key: string;
  readonly default: T;
  readonly scope: 'workspace' | 'global';
  readonly validator?: (value: unknown) => value is T;
}
```

**No Duplication**: All new types are domain-specific and don't overlap with existing shared types.

---

## 📁 File Changes

### Phase 1: Core Services Extraction (Day 1)

#### 1.1 Files to CREATE

**`libs/backend/vscode-core/src/logging/logger.ts`** (100 lines)

- **Purpose**: Extract Logger from main app with DI integration
- **Content**:
  - `@injectable()` class with `@inject(TOKENS.OUTPUT_MANAGER)`
  - Methods: `debug()`, `info()`, `warn()`, `error()`, `logWithContext()`
  - Structured logging with timestamps and context
- **Source**: `apps/ptah-extension-vscode/src/core/logger.ts` (72 lines + enhancements)

**`libs/backend/vscode-core/src/logging/types.ts`** (30 lines)

- **Purpose**: Type definitions for logging
- **Content**: `LogLevel`, `LogContext`, `LogEntry` interfaces

**`libs/backend/vscode-core/src/logging/index.ts`** (5 lines)

- **Purpose**: Export logging public API
- **Content**: Re-exports from logger.ts and types.ts

**`libs/backend/vscode-core/src/error-handling/error-handler.ts`** (150 lines)

- **Purpose**: Extract ErrorHandler with DI integration
- **Content**:
  - `@injectable()` class with `@inject(TOKENS.LOGGER)`
  - Methods: `handleError()`, `handleAsyncError()`, `createErrorBoundary()`, `showErrorToUser()`
  - Error boundaries with contextual information
- **Source**: `apps/ptah-extension-vscode/src/handlers/error-handler.ts` (127 lines + enhancements)

**`libs/backend/vscode-core/src/error-handling/types.ts`** (40 lines)

- **Purpose**: Type definitions for error handling
- **Content**: `ErrorContext`, `ErrorAction`, `ErrorBoundaryResult` interfaces

**`libs/backend/vscode-core/src/error-handling/index.ts`** (5 lines)

- **Purpose**: Export error handling public API

**`libs/backend/vscode-core/src/config/config-manager.ts`** (600 lines)

- **Purpose**: Extract ConfigManager with type-safe configuration
- **Content**:
  - `@injectable()` class with `@inject(TOKENS.EVENT_BUS)`
  - Methods: `get()`, `set()`, `watch()`, `getTyped()` (with Zod validation)
  - Configuration change notifications via EventBus
- **Source**: `apps/ptah-extension-vscode/src/config/ptah-config.service.ts` (558 lines + refactoring)

**`libs/backend/vscode-core/src/config/types.ts`** (50 lines)

- **Purpose**: Type definitions for configuration
- **Content**: `ConfigWatcher`, `ConfigurationSchema` interfaces

**`libs/backend/vscode-core/src/config/index.ts`** (5 lines)

- **Purpose**: Export config public API

**`libs/backend/vscode-core/src/__tests__/logging/logger.spec.ts`** (150 lines)

- **Purpose**: Unit tests for Logger
- **Content**: Test all logging methods, context handling, output channel integration

**`libs/backend/vscode-core/src/__tests__/error-handling/error-handler.spec.ts`** (150 lines)

- **Purpose**: Unit tests for ErrorHandler
- **Content**: Test error boundaries, async error handling, user notifications

**`libs/backend/vscode-core/src/__tests__/config/config-manager.spec.ts`** (150 lines)

- **Purpose**: Unit tests for ConfigManager
- **Content**: Test get/set, watchers, type validation with Zod

#### 1.2 Files to MODIFY

**`libs/backend/vscode-core/src/di/tokens.ts`** (+15 lines)

- **Purpose**: Add tokens for new services
- **Changes**:
  ```typescript
  // Core Services (add after existing)
  LOGGER: Symbol.for('Logger'),
  ERROR_HANDLER: Symbol.for('ErrorHandler'),
  CONFIG_MANAGER: Symbol.for('ConfigManager'),
  ```

**`libs/backend/vscode-core/src/di/container.ts`** (+20 lines)

- **Purpose**: Register new services in DIContainer.setup()
- **Changes**:

  ```typescript
  // Register core services
  const { Logger } = require('../logging/logger');
  const { ErrorHandler } = require('../error-handling/error-handler');
  const { ConfigManager } = require('../config/config-manager');

  container.registerSingleton(TOKENS.LOGGER, Logger);
  container.registerSingleton(TOKENS.ERROR_HANDLER, ErrorHandler);
  container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);
  ```

**`libs/backend/vscode-core/src/index.ts`** (+10 lines)

- **Purpose**: Export new services
- **Changes**: Add exports for Logger, ErrorHandler, ConfigManager with types

**`libs/backend/vscode-core/package.json`** (+1 dependency)

- **Purpose**: Add Zod for configuration validation
- **Changes**: Add `"zod": "^3.22.4"` to dependencies

---

### Phase 2: Context & Validation Extraction (Day 2)

#### 2.1 Files to CREATE

**`libs/backend/ai-providers-core/src/context/context-manager.ts`** (250 lines)

- **Purpose**: Extract ContextManager with workspace-intelligence integration
- **Content**:
  - `@injectable()` class with `@inject(TOKENS.WORKSPACE_INDEXER_SERVICE)`, `@inject(TOKENS.TOKEN_COUNTER_SERVICE)`
  - Methods: `optimizeContext()`, `getRelevantFiles()`, `estimateTokens()`, `suggestContextReduction()`
  - Integration with workspace-intelligence for file relevance scoring
- **Source**: `apps/ptah-extension-vscode/src/services/context-manager.ts` (180 lines + integration)

**`libs/backend/ai-providers-core/src/context/types.ts`** (60 lines)

- **Purpose**: Type definitions for context management
- **Content**: `ContextOptimizationResult`, `FileRelevanceScore`, `ContextSuggestion` interfaces

**`libs/backend/ai-providers-core/src/context/index.ts`** (5 lines)

- **Purpose**: Export context management public API

**`libs/backend/ai-providers-core/src/__tests__/context/context-manager.spec.ts`** (200 lines)

- **Purpose**: Unit tests for ContextManager
- **Content**: Test context optimization, file relevance, token estimation

**`libs/backend/vscode-core/src/validation/message-validator.ts`** (100 lines)

- **Purpose**: Extract message validation with Zod
- **Content**:
  - Validation functions for `MessagePayloadMap`
  - Branded type validation (`SessionId`, `MessageId`)
  - Error formatting
- **Source**: `apps/ptah-extension-vscode/src/services/validation/message-validator.service.ts` (~150 lines, simplified)

**`libs/backend/vscode-core/src/validation/types.ts`** (30 lines)

- **Purpose**: Type definitions for validation
- **Content**: `ValidationResult`, `ValidationError` interfaces

**`libs/backend/vscode-core/src/validation/index.ts`** (5 lines)

- **Purpose**: Export validation public API

**`libs/backend/vscode-core/src/__tests__/validation/message-validator.spec.ts`** (100 lines)

- **Purpose**: Unit tests for validation
- **Content**: Test message validation, branded types, error handling

#### 2.2 Files to MODIFY

**`libs/backend/vscode-core/src/di/tokens.ts`** (+5 lines)

- **Purpose**: Add CONTEXT_MANAGER token
- **Changes**:
  ```typescript
  CONTEXT_MANAGER: Symbol.for('ContextManager'),
  ```

**`libs/backend/vscode-core/src/di/container.ts`** (+10 lines)

- **Purpose**: Register ContextManager
- **Changes**:
  ```typescript
  const { ContextManager } = require('@ptah-extension/ai-providers-core');
  container.registerSingleton(TOKENS.CONTEXT_MANAGER, ContextManager);
  ```

**`libs/backend/ai-providers-core/src/index.ts`** (+5 lines)

- **Purpose**: Export ContextManager
- **Changes**: Add ContextManager to exports

**`libs/backend/vscode-core/src/index.ts`** (+5 lines)

- **Purpose**: Export validation utilities
- **Changes**: Add validation exports

---

### Phase 3: Main App Cleanup (Day 3)

#### 3.1 Files to DELETE

**`apps/ptah-extension-vscode/src/core/service-registry.ts`** (188 lines)

- **Reason**: Replaced by `DIContainer` from vscode-core
- **Impact**: Custom DI system no longer needed

**`apps/ptah-extension-vscode/src/core/logger.ts`** (72 lines)

- **Reason**: Moved to `libs/backend/vscode-core/src/logging/logger.ts`

**`apps/ptah-extension-vscode/src/handlers/error-handler.ts`** (127 lines)

- **Reason**: Moved to `libs/backend/vscode-core/src/error-handling/error-handler.ts`

**`apps/ptah-extension-vscode/src/config/ptah-config.service.ts`** (558 lines)

- **Reason**: Moved to `libs/backend/vscode-core/src/config/config-manager.ts`

**`apps/ptah-extension-vscode/src/services/context-manager.ts`** (180 lines)

- **Reason**: Moved to `libs/backend/ai-providers-core/src/context/context-manager.ts`

**`apps/ptah-extension-vscode/src/services/validation/message-validator.service.ts`** (~150 lines)

- **Reason**: Moved to `libs/backend/vscode-core/src/validation/message-validator.ts`

**`apps/ptah-extension-vscode/src/registries/command-registry.ts`** (150 lines)

- **Reason**: Replaced by `CommandManager` from vscode-core

**`apps/ptah-extension-vscode/src/registries/webview-registry.ts`** (120 lines)

- **Reason**: Replaced by `WebviewManager` from vscode-core

**`apps/ptah-extension-vscode/src/registries/event-registry.ts`** (100 lines)

- **Reason**: Replaced by `EventBus` from vscode-core

**`apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`** (300 lines)

- **Reason**: Replaced by `WebviewManager` from vscode-core

**`apps/ptah-extension-vscode/src/services/webview-html-generator.ts`** (120 lines)

- **Reason**: Functionality integrated into `WebviewManager`

**Total Lines Deleted**: ~2,065 lines

#### 3.2 Files to MODIFY

**`apps/ptah-extension-vscode/src/main.ts`** (major refactor)

- **Purpose**: Use DIContainer.setup() instead of ServiceRegistry
- **Changes**:

  ```typescript
  // OLD
  import { ServiceRegistry } from './core/service-registry';
  ServiceRegistry.initialize(context);

  // NEW
  import { DIContainer, TOKENS } from '@ptah-extension/vscode-core';
  const container = DIContainer.setup(context);
  ```

- **Estimated LOC Change**: -50 lines (simplification)

**`apps/ptah-extension-vscode/src/core/ptah-extension.ts`** (major refactor)

- **Purpose**: Resolve services via DI instead of ServiceRegistry
- **Changes**:

  ```typescript
  // OLD
  private logger = ServiceRegistry.get('logger');
  private errorHandler = ServiceRegistry.get('errorHandler');

  // NEW
  @injectable()
  class PtahExtension {
    constructor(
      @inject(TOKENS.LOGGER) private logger: Logger,
      @inject(TOKENS.ERROR_HANDLER) private errorHandler: ErrorHandler,
      @inject(TOKENS.CONFIG_MANAGER) private configManager: ConfigManager,
      @inject(TOKENS.COMMAND_MANAGER) private commandManager: CommandManager,
      @inject(TOKENS.WEBVIEW_MANAGER) private webviewManager: WebviewManager,
      @inject(TOKENS.EVENT_BUS) private eventBus: EventBus
    ) {}
  }
  ```

- **Estimated LOC Change**: -100 lines (cleaner DI)

**`apps/ptah-extension-vscode/src/services/webview-message-handlers/*.ts`** (multiple files)

- **Purpose**: Import Logger, ErrorHandler from vscode-core
- **Changes**: Update imports from `../core/logger` to `@ptah-extension/vscode-core`
- **Estimated LOC Change**: ~10 files × 2 lines = 20 lines changed

---

## 🔗 Integration Points

### Dependencies

**Internal Library Dependencies**:

```
vscode-core
  ├── Uses: VS Code API
  └── Exports: DIContainer, EventBus, CommandManager, WebviewManager, Logger, ErrorHandler, ConfigManager, validation

ai-providers-core
  ├── Uses: vscode-core (TOKENS, EventBus)
  ├── Uses: workspace-intelligence (WorkspaceIndexerService, TokenCounterService)
  ├── Uses: claude-domain (ClaudeCliAdapter)
  └── Exports: ProviderManager, ContextManager, strategies, adapters

claude-domain
  ├── Uses: vscode-core (EventBus via IEventBus adapter)
  └── Exports: ClaudeCliDetector, SessionManager, ClaudeCliLauncher, PermissionService

workspace-intelligence
  ├── Uses: VS Code API
  └── Exports: 12 services for workspace analysis

main app (apps/ptah-extension-vscode)
  ├── Uses: vscode-core (DIContainer, all services)
  ├── Uses: ai-providers-core (ProviderManager, ContextManager)
  ├── Uses: claude-domain (via ai-providers-core)
  ├── Uses: workspace-intelligence (via ai-providers-core)
  └── Provides: UI-specific handlers, commands, webview controllers
```

**External Dependencies**:

- `tsyringe` - Already installed ✅
- `rxjs` - Already installed ✅
- `zod` - Need to add for ConfigManager validation

**Nx Library Aliases** (already configured):

- `@ptah-extension/vscode-core`
- `@ptah-extension/ai-providers-core`
- `@ptah-extension/claude-domain`
- `@ptah-extension/workspace-intelligence`
- `@ptah-extension/shared`

### Breaking Changes

- [x] **None - Backwards Compatible**

**Justification**:

- Extracting services to libraries (not changing APIs)
- Main app will continue working during extraction
- Old code deleted only after new code verified
- All changes internal to extension (no public API changes)
- Extension users see no difference

---

## 📐 Implementation Steps

### Step 1: Core Services Extraction (Day 1)

**Files**: Logger, ErrorHandler, ConfigManager + tests

**Tasks**:

1. Create `libs/backend/vscode-core/src/logging/` with Logger service
2. Create `libs/backend/vscode-core/src/error-handling/` with ErrorHandler service
3. Create `libs/backend/vscode-core/src/config/` with ConfigManager service
4. Add TOKENS for new services in `tokens.ts`
5. Register services in `DIContainer.setup()`
6. Add Zod dependency to vscode-core
7. Write unit tests (≥80% coverage)
8. Update vscode-core exports

**Validation**:

```bash
# Build vscode-core library
nx build vscode-core

# Run tests
nx test vscode-core

# Check coverage (should be ≥80%)
nx test vscode-core --coverage
```

**Expected Outcome**:

- ✅ Logger service works with OutputManager
- ✅ ErrorHandler service works with Logger
- ✅ ConfigManager service works with VS Code configuration API
- ✅ All tests passing with ≥80% coverage
- ✅ No breaking changes to existing vscode-core API

---

### Step 2: Context & Validation Extraction (Day 2)

**Files**: ContextManager + workspace-intelligence integration, validation utilities + tests

**Tasks**:

1. Create `libs/backend/ai-providers-core/src/context/` with ContextManager
2. Integrate ContextManager with workspace-intelligence services
3. Create `libs/backend/vscode-core/src/validation/` with message validators
4. Add CONTEXT_MANAGER token
5. Register ContextManager in DIContainer
6. Write unit tests for ContextManager (≥80% coverage)
7. Write unit tests for validation (≥80% coverage)
8. Update library exports

**Validation**:

```bash
# Build ai-providers-core
nx build ai-providers-core

# Build vscode-core (for validation)
nx build vscode-core

# Run tests
nx test ai-providers-core
nx test vscode-core

# Check coverage
nx test ai-providers-core --coverage
nx test vscode-core --coverage
```

**Expected Outcome**:

- ✅ ContextManager optimizes context using workspace-intelligence
- ✅ Validation utilities validate messages with Zod
- ✅ All tests passing with ≥80% coverage
- ✅ Integration tests show ContextManager ↔ workspace-intelligence working

---

### Step 3: Main App Cleanup (Day 3)

**Files**: main.ts, ptah-extension.ts, webview-message-handlers/, delete old registries

**Tasks**:

1. Update `main.ts` to use `DIContainer.setup()`
2. Refactor `ptah-extension.ts` to use constructor injection
3. Update webview-message-handlers to import from libraries
4. Delete service-registry.ts
5. Delete command-registry.ts, webview-registry.ts, event-registry.ts
6. Delete angular-webview.provider.ts, webview-html-generator.ts
7. Delete logger.ts, error-handler.ts, ptah-config.service.ts, context-manager.ts, validation/
8. Build extension and verify it works
9. Run extension in debug mode (F5) and test functionality

**Validation**:

```bash
# Build entire workspace
nx run-many --target=build --all

# Run all tests
nx run-many --target=test --all

# Build extension specifically
nx build ptah-extension-vscode

# Package extension (VSCode)
npm run package
```

**Expected Outcome**:

- ✅ Extension builds successfully
- ✅ Extension activates in debug mode
- ✅ All commands work
- ✅ Webview works
- ✅ ~2,065 lines deleted from main app
- ✅ Main app now uses libraries exclusively

---

### Step 4: Documentation & Cleanup (Day 3 evening)

**Files**: READMEs, update task tracking

**Tasks**:

1. Update `libs/backend/vscode-core/README.md` with new services
2. Update `libs/backend/ai-providers-core/README.md` with ContextManager
3. Create migration guide: old patterns → new library imports
4. Update `task-tracking/TASK_CORE_001/progress.md` with completion
5. Create `task-tracking/TASK_CORE_001/completion-report.md`
6. Update `task-tracking/registry.md` with future work items

**Validation**:

- ✅ READMEs document all new services
- ✅ Migration guide shows before/after code examples
- ✅ Progress tracking complete
- ✅ Registry updated with future enhancements

---

## ⏱️ Timeline & Scope

### Current Scope (This Task)

**Estimated Time**: **3 days** (NOT 8-10 days as originally estimated)

**Breakdown**:

- Day 1: Extract Logger, ErrorHandler, ConfigManager to vscode-core
- Day 2: Extract ContextManager to ai-providers-core, validation to vscode-core
- Day 3: Main app cleanup (delete old code, wire up DI)

**Core Deliverable**: All Weeks 1-6 infrastructure complete in libraries

**Quality Threshold**:

- ≥80% test coverage across all new services
- Zero `any` types
- SOLID principles compliance
- Extension works in debug mode
- Main app reduced by ~2,065 lines

**Why 3 Days (Not 8-10)**:

1. **Weeks 1-6 already ~95% complete** - Most work done in previous tasks
2. **Only 5 services need extraction** - Logger, ErrorHandler, ConfigManager, ContextManager, validation
3. **No new architecture** - Following existing patterns from workspace-intelligence
4. **No complex integration** - DIContainer already wired up
5. **Straightforward deletion** - Old registries simply removed

---

### Future Work (Registry Tasks)

The following enhancements exceed the 3-day scope and go to `task-tracking/registry.md`:

| Future Task ID | Description                                          | Effort | Priority | Blocks        |
| -------------- | ---------------------------------------------------- | ------ | -------- | ------------- |
| TASK_CORE_002  | Additional provider selection strategies             | 1-2d   | Medium   | Provider UX   |
| TASK_CORE_003  | Performance monitoring for DI container              | 1d     | Low      | Optimization  |
| TASK_CORE_004  | Advanced logging features (rotation, remote logging) | 2d     | Low      | Production    |
| TASK_CORE_005  | Configuration validation and migration system        | 1-2d   | Medium   | Config UX     |
| TASK_CORE_006  | Error tracking and analytics integration             | 2d     | Low      | Observability |

**Total Future Work**: ~8-10 days (matches original estimate for enhancements)

**Registry Updates**: Will be added in Step 4 of implementation

---

## 🚨 Risk Mitigation

### Technical Risks

**Risk 1: Breaking Main App During Extraction**

- **Probability**: Low
- **Impact**: High
- **Mitigation**:
  - Extract to libraries FIRST (don't delete main app code yet)
  - Write comprehensive tests for library services
  - Verify libraries work independently
  - Update main app imports incrementally
  - Delete old code only after new code verified
- **Contingency**: Keep old code in git history, can rollback library changes

**Risk 2: ContextManager Integration Complexity**

- **Probability**: Medium
- **Impact**: Medium
- **Mitigation**:
  - workspace-intelligence services already use DI
  - ContextManager will use `@inject(TOKENS.WORKSPACE_INDEXER_SERVICE)`
  - Integration pattern already proven in DIContainer
  - Write integration tests before production use
- **Contingency**: Start with simple context optimization, add intelligence incrementally

**Risk 3: Configuration Migration**

- **Probability**: Low
- **Impact**: Low
- **Mitigation**:
  - ConfigManager reads same VS Code settings as PtahConfigService
  - No configuration file format changes
  - Backward compatibility maintained
  - Users see no difference
- **Contingency**: Keep old config service in git history if issues arise

---

## 🧪 Testing Strategy

### Unit Tests Required

**Logger Tests** (`libs/backend/vscode-core/src/__tests__/logging/logger.spec.ts`):

- ✅ `info()`, `warn()`, `error()`, `debug()` methods
- ✅ Context handling with metadata
- ✅ OutputManager integration
- ✅ Timestamp formatting
- **Coverage Target**: ≥80%

**ErrorHandler Tests** (`libs/backend/vscode-core/src/__tests__/error-handling/error-handler.spec.ts`):

- ✅ Error boundary creation
- ✅ Async error handling
- ✅ User-friendly error messages
- ✅ Logger integration
- ✅ VS Code notification display
- **Coverage Target**: ≥80%

**ConfigManager Tests** (`libs/backend/vscode-core/src/__tests__/config/config-manager.spec.ts`):

- ✅ Get/set configuration values
- ✅ Configuration watchers
- ✅ Type validation with Zod
- ✅ EventBus integration for change notifications
- ✅ Workspace vs. global scope
- **Coverage Target**: ≥80%

**ContextManager Tests** (`libs/backend/ai-providers-core/src/__tests__/context/context-manager.spec.ts`):

- ✅ Context optimization with workspace-intelligence
- ✅ File relevance scoring
- ✅ Token estimation
- ✅ Context reduction suggestions
- ✅ Integration with WorkspaceIndexerService
- **Coverage Target**: ≥80%

**Validation Tests** (`libs/backend/vscode-core/src/__tests__/validation/message-validator.spec.ts`):

- ✅ Message payload validation
- ✅ Branded type validation
- ✅ Error formatting
- ✅ Zod schema validation
- **Coverage Target**: ≥80%

---

### Integration Tests Required

**DI Container Integration** (`libs/backend/vscode-core/src/__tests__/integration/di-integration.spec.ts`):

- ✅ DIContainer resolves Logger correctly
- ✅ DIContainer resolves ErrorHandler with Logger dependency
- ✅ DIContainer resolves ConfigManager with EventBus dependency
- ✅ All services can be resolved without errors
- ✅ Singleton scope works (same instance returned)

**ContextManager + workspace-intelligence Integration** (`libs/backend/ai-providers-core/src/__tests__/integration/context-integration.spec.ts`):

- ✅ ContextManager uses WorkspaceIndexerService
- ✅ ContextManager uses TokenCounterService
- ✅ File relevance scores calculated correctly
- ✅ Context optimization reduces token count

**Library Integration Test** (`apps/ptah-extension-vscode/src/__tests__/integration/library-integration.spec.ts`):

- ✅ Main app can import from all libraries
- ✅ DIContainer.setup() works in extension context
- ✅ Services resolve correctly in extension
- ✅ No circular dependency errors

---

### Manual Testing Checklist

After Phase 3 (Main App Cleanup):

- [ ] **Extension Activation**: Press F5, extension activates without errors
- [ ] **Commands Work**: All ptah.\* commands execute successfully
- [ ] **Webview Opens**: Ptah webview displays correctly
- [ ] **Chat Functionality**: Can send messages and receive responses
- [ ] **Provider Selection**: Can switch between Claude CLI and VS Code LM providers
- [ ] **Configuration**: Can modify settings in VS Code preferences
- [ ] **Error Handling**: Intentional errors show user-friendly messages
- [ ] **Logging**: Output channel shows structured logs
- [ ] **Context Optimization**: Context suggestions appear in UI
- [ ] **No Console Errors**: VS Code Developer Tools show no errors

---

## 📊 Performance Considerations

### Performance Targets

**DI Container Resolution**:

- **Target**: <1ms per service resolution
- **Strategy**: TSyringe singleton caching (already implemented)
- **Measurement**: Add timing logs in DIContainer.resolve() during tests

**Logger Performance**:

- **Target**: <5ms per log call
- **Strategy**: Async output channel writes (already in VS Code API)
- **Measurement**: Benchmark 1000 log calls in tests

**ConfigManager Watchers**:

- **Target**: <10ms to notify all watchers on config change
- **Strategy**: EventBus pub/sub pattern (already implemented)
- **Measurement**: Benchmark with 50 active watchers

**ContextManager Optimization**:

- **Target**: <100ms to optimize context for typical workspace
- **Strategy**: workspace-intelligence caching (already implemented)
- **Measurement**: Benchmark with 1000-file workspace

**Validation Performance**:

- **Target**: <1ms per message validation
- **Strategy**: Zod schema compilation (one-time cost)
- **Measurement**: Benchmark 1000 message validations

---

## 📝 Success Criteria

### Code Quality ✅

- [ ] Zero `any` types across all new services
- [ ] ≥80% test coverage (line, branch, function) for all new code
- [ ] All ESLint rules passing (nx lint vscode-core, nx lint ai-providers-core)
- [ ] TypeScript strict mode enabled and passing
- [ ] Zero circular dependencies (verified with nx graph)

### Architecture Quality ✅

- [ ] SOLID principles compliance verified
- [ ] All services use constructor injection with @injectable()
- [ ] All dependencies resolved via TOKENS (no concrete imports)
- [ ] Clean separation: infrastructure in libraries, UI in main app
- [ ] READMEs document all services with examples

### Functionality ✅

- [ ] Extension builds successfully (nx build ptah-extension-vscode)
- [ ] Extension activates in debug mode (F5)
- [ ] All commands work (verified manually)
- [ ] Webview displays and functions correctly
- [ ] Chat functionality works end-to-end
- [ ] Configuration changes take effect immediately
- [ ] Error handling shows user-friendly messages
- [ ] Logging outputs structured logs

### Business Value ✅

- [ ] Main app reduced by ~2,065 lines (old registries and services deleted)
- [ ] ~1,087 lines of reusable services added to libraries
- [ ] All Weeks 1-6 infrastructure complete
- [ ] Ready to start Week 7 (Session & Analytics libraries)
- [ ] Path to $3.8M annual ROI from workspace-intelligence now unblocked

---

## 🎯 Definition of Done

**Task Complete When**:

1. ✅ All 5 services extracted to libraries (Logger, ErrorHandler, ConfigManager, ContextManager, validation)
2. ✅ All tests passing with ≥80% coverage across all libraries
3. ✅ Main app cleanup complete (~2,065 lines deleted)
4. ✅ Extension works in debug mode (manual testing checklist complete)
5. ✅ Documentation updated (READMEs, migration guide)
6. ✅ `task-tracking/TASK_CORE_001/completion-report.md` created
7. ✅ `task-tracking/registry.md` updated with future enhancements (6 items)
8. ✅ Git commits follow conventional commit format
9. ✅ Ready for Week 7: TASK_SES_001 (Session) and TASK_ANLYT_001 (Analytics)

---

## 🚀 Next Phase

**After TASK_CORE_001 Complete**:

**Recommended**: Start Week 7 libraries in parallel:

- **TASK_SES_001**: Extract ptah-session library (3-4 days)
- **TASK_ANLYT_001**: Extract ptah-analytics library (3-4 days)

**Defer Integration**: Save final integration (TASK_INT_001) until all libraries created (Weeks 7-9 complete)

**Why Defer**:

- Main app keeps working during Week 7-9 development
- All libraries created before big integration
- Clean sweep integration at the end reduces risk
- Less chance of breaking changes during active development

---

## 📋 PHASE 3 COMPLETE ✅

**Deliverable**: `task-tracking/TASK_CORE_001/implementation-plan.md` created

**Scope Summary**:

- **Current Task**: 3 days (extract 5 services + main app cleanup)
- **Future Tasks Added to Registry**: 6 enhancements (~8-10 days total)
- **Total**: ~11-13 days work identified, 3 days for critical path, 8-10 days deferred

**Key Finding**: Weeks 1-6 infrastructure is ~95% complete. Only missing Logger, ErrorHandler, ConfigManager, ContextManager, and validation utilities.

**Revised Timeline**: 3 days (NOT 8-10 days as originally estimated)

**Next Phase**: backend-developer (for implementation)

---

## 📋 NEXT STEP - Validation Gate

Copy and paste this command into the chat:

```
/validation-gate PHASE_NAME="Phase 3 - Architecture Planning" AGENT_NAME="software-architect" DELIVERABLE_PATH="task-tracking/TASK_CORE_001/implementation-plan.md" TASK_ID=TASK_CORE_001
```

**What happens next**: Business analyst will validate this implementation plan and decide APPROVE or REJECT.
