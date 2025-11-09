# TASK_CORE_001: Complete Weeks 1-6 Deferred Infrastructure

**Task ID**: TASK_CORE_001  
**Task Name**: Complete All Deferred Infrastructure Work (MONSTER Weeks 1-6)  
**Priority**: HIGH (Blocks Week 7)  
**Estimated Duration**: 8-10 days  
**Created**: October 10, 2025

---

## 🎯 Task Overview

Complete ALL deferred infrastructure work from MONSTER Weeks 1-6 to ensure a solid foundation before proceeding to Week 7 (Session & Analytics Libraries). This task extracts core infrastructure from the main application into properly organized libraries.

---

## 📋 Business Context

### Problem Statement

The main application (`apps/ptah-extension-vscode/`) contains **~3,500 lines of infrastructure code** that should be in reusable libraries per the MONSTER refactor plan. We've successfully created the workspace-intelligence library (Week 6), but deferred critical infrastructure work from Weeks 1-5.

### Why This Matters

**Current State**:

- ❌ Custom DI system (`service-registry.ts`) instead of TSyringe
- ❌ Infrastructure mixed with business logic
- ❌ No command/webview abstractions
- ❌ Provider system incomplete
- ❌ Claude integration in main app (should be library)
- ❌ Cannot integrate workspace-intelligence library yet

**Desired State**:

- ✅ Clean vscode-core library with TSyringe DI
- ✅ CommandManager, WebviewManager abstractions
- ✅ Complete ai-providers-core library
- ✅ claude-domain library extracted
- ✅ Ready to integrate ALL libraries cleanly

**Business Value**: Enables $3.8M annual ROI from workspace-intelligence + sets foundation for all future libraries

---

## 🎯 SMART Requirements

### Specific

Extract and implement infrastructure across 4 libraries:

1. **vscode-core**: DI container, CommandManager, WebviewManager, Logger, ErrorHandler, Config
2. **ai-providers-core**: Full ProviderManager with intelligent selection strategies
3. **claude-domain**: ClaudeCliService, ClaudeCliDetector, permissions
4. **Infrastructure cleanup**: Move registries, handlers, validators to appropriate libraries

### Measurable

**Acceptance Criteria**:

**AC1**: vscode-core library complete with TSyringe DI

- [ ] DIContainer class with proper setup
- [ ] Symbol-based token definitions
- [ ] Service registration helpers
- [ ] ≥80% test coverage

**AC2**: CommandManager and WebviewManager implemented

- [ ] CommandManager with type-safe command registration
- [ ] WebviewManager with lifecycle management
- [ ] EventBus integration
- [ ] ≥80% test coverage

**AC3**: Logger, ErrorHandler, Config moved to vscode-core

- [ ] Logger service with structured logging
- [ ] ErrorHandler with contextual error boundaries
- [ ] ConfigManager with type-safe configuration
- [ ] ≥80% test coverage

**AC4**: ai-providers-core library complete

- [ ] ProviderManager with intelligent selection
- [ ] Selection strategies implemented
- [ ] Health monitoring
- [ ] Context window management
- [ ] ≥80% test coverage

**AC5**: claude-domain library extracted

- [ ] ClaudeCliAdapter implements EnhancedAIProvider
- [ ] ClaudeCliDetector service
- [ ] Permission handling
- [ ] ≥80% test coverage
- [ ] Zero code duplication with main app

**AC6**: Infrastructure cleanup

- [ ] command-registry.ts → CommandManager
- [ ] webview-registry.ts → WebviewManager
- [ ] event-registry.ts → EventBus (already exists)
- [ ] validation/ → vscode-core/validation
- [ ] All infrastructure in libraries, not main app

**AC7**: Zero technical debt

- [ ] Zero `any` types
- [ ] Zero circular dependencies
- [ ] SOLID principles compliance
- [ ] All services use TSyringe DI

**AC8**: Documentation complete

- [ ] README for each library
- [ ] API documentation
- [ ] Migration guide from old to new
- [ ] Integration examples

### Achievable

**Resources Available**:

- MONSTER plan provides detailed architecture
- EventBus already implemented in vscode-core
- Provider interfaces already exist in ai-providers-core
- ClaudeCliService already working (just need to extract)
- workspace-intelligence serves as reference implementation

**Estimated Effort**: 8-10 days

- Week 2 work: 2-3 days (DI container, Logger, ErrorHandler, Config)
- Week 3 work: 2-3 days (CommandManager, WebviewManager)
- Week 4 work: 2 days (ProviderManager, strategies)
- Week 5 work: 2 days (claude-domain extraction)

### Relevant

**Alignment with Goals**:

- ✅ Completes MONSTER Weeks 1-6 properly
- ✅ Enables workspace-intelligence integration
- ✅ Sets foundation for Week 7 (Session & Analytics)
- ✅ Enables final main app cleanup
- ✅ Unlocks $3.8M annual business value

**Impact**:

- Main app reduction: ~2,000 lines deleted
- Code reusability: ~2,500 lines in libraries
- Architecture quality: Clean separation of concerns
- Developer velocity: Faster future development

### Time-Bound

**Timeline**: 8-10 days (2 work weeks)

**Phase Breakdown**:

| Phase                                       | Duration | Deliverables                                            |
| ------------------------------------------- | -------- | ------------------------------------------------------- |
| **Phase 1**: DI & Core Infrastructure       | 3 days   | vscode-core with TSyringe, Logger, ErrorHandler, Config |
| **Phase 2**: Command & Webview Abstractions | 3 days   | CommandManager, WebviewManager                          |
| **Phase 3**: Provider System Completion     | 2 days   | ai-providers-core with ProviderManager                  |
| **Phase 4**: Claude Domain Extraction       | 2 days   | claude-domain library                                   |
| **TOTAL**                                   | 10 days  | All libraries complete                                  |

**Hard Deadline**: Complete before starting Week 7 (Session & Analytics)

---

## 📊 Main App Code Analysis

### Infrastructure Files to Extract/Delete

**From Main App Scan**:

#### Core Infrastructure (→ vscode-core)

| File                                    | Lines            | Move To                                       | MONSTER Week  |
| --------------------------------------- | ---------------- | --------------------------------------------- | ------------- |
| `core/service-registry.ts`              | 188              | DELETE (replace with TSyringe)                | Week 2        |
| `core/logger.ts`                        | ~80              | `vscode-core/logging/logger.ts`               | Week 2        |
| `handlers/error-handler.ts`             | ~100             | `vscode-core/error-handling/error-handler.ts` | Week 2        |
| `config/ptah-config.service.ts`         | ~200             | `vscode-core/config/config-manager.ts`        | Week 2        |
| `registries/command-registry.ts`        | ~150             | `vscode-core/api-wrappers/command-manager.ts` | Week 3        |
| `registries/webview-registry.ts`        | ~120             | `vscode-core/api-wrappers/webview-manager.ts` | Week 3        |
| `registries/event-registry.ts`          | ~100             | EventBus (already exists!)                    | Week 2 ✅     |
| `handlers/command-handlers.ts`          | ~200             | Use CommandManager directly                   | Week 3        |
| `providers/angular-webview.provider.ts` | ~300             | Use WebviewManager                            | Week 3        |
| `services/webview-html-generator.ts`    | ~120             | WebviewManager handles this                   | Week 3        |
| `services/webview-diagnostic.ts`        | ~80              | vscode-core dev tools                         | Week 3        |
| `services/validation/`                  | ~150             | `vscode-core/validation/`                     | Week 2        |
| **Subtotal**                            | **~1,788 lines** | **vscode-core library**                       | **Weeks 2-3** |

---

#### AI Provider System (→ ai-providers-core)

| File                                                   | Lines          | Move To                                             | MONSTER Week |
| ------------------------------------------------------ | -------------- | --------------------------------------------------- | ------------ |
| `services/ai-providers/provider-manager.ts`            | ~200           | `ai-providers-core/manager/provider-manager.ts`     | Week 4       |
| `services/ai-providers/provider-factory.ts`            | ~150           | `ai-providers-core/factory/provider-factory.ts`     | Week 4       |
| `services/ai-providers/base-ai-provider.ts`            | ~100           | `ai-providers-core/base/base-provider.ts`           | Week 4       |
| `services/ai-providers/vscode-lm-provider.ts`          | ~200           | `ai-providers-core/providers/vscode-lm-provider.ts` | Week 4       |
| `services/ai-providers/claude-cli-provider-adapter.ts` | ~150           | DELETE (use claude-domain instead)                  | Week 5       |
| `services/context-manager.ts`                          | ~180           | `ai-providers-core/context/context-manager.ts`      | Week 4       |
| **Subtotal**                                           | **~980 lines** | **ai-providers-core library**                       | **Week 4**   |

---

#### Claude Domain (→ claude-domain)

| File                                      | Lines          | Move To                                    | MONSTER Week |
| ----------------------------------------- | -------------- | ------------------------------------------ | ------------ |
| `services/claude-cli.service.ts`          | ~500           | `claude-domain/cli/claude-cli-adapter.ts`  | Week 5       |
| `services/claude-cli-detector.service.ts` | ~100           | `claude-domain/cli/claude-cli-detector.ts` | Week 5       |
| `services/command-builder.service.ts`     | ~150           | `claude-domain/cli/command-builder.ts`     | Week 5       |
| **Subtotal**                              | **~750 lines** | **claude-domain library**                  | **Week 5**   |

---

#### Already Extracted (✅ Complete)

| File                            | Status                                | Library       |
| ------------------------------- | ------------------------------------- | ------------- |
| `services/workspace-manager.ts` | ✅ Replaced by workspace-intelligence | TASK_PRV_005  |
| **Subtotal**                    | **460 lines removed**                 | **Week 6 ✅** |

---

### Files That Stay in Main App

**UI Message Handlers** (~600 lines):

- `services/webview-message-handlers/` - App-specific UI layer
- These stay because they're app-specific, not reusable infrastructure

**Composition Root** (~100 lines):

- `main.ts` - DI setup and activation
- `core/ptah-extension.ts` - Orchestration

**Total Main App After Cleanup**: ~700 lines (vs. ~4,200 currently = **83% reduction**)

---

## 🏗️ Implementation Plan

### Phase 1: DI & Core Infrastructure (3 days)

#### 1.1: TSyringe DI Container (Day 1)

**Create**: `libs/backend/vscode-core/src/di/`

**Files**:

```typescript
// libs/backend/vscode-core/src/di/container.ts
import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

export class DIContainer {
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // Register VS Code context
    container.registerInstance('VSCodeExtensionContext', context);

    // Register singletons
    container.register('Logger', { useClass: Logger });
    container.register('ErrorHandler', { useClass: ErrorHandler });
    container.register('ConfigManager', { useClass: ConfigManager });

    return container;
  }

  static resolve<T>(token: string | symbol): T {
    return container.resolve<T>(token);
  }
}

// libs/backend/vscode-core/src/di/tokens.ts
export const TOKENS = {
  // VS Code APIs
  EXTENSION_CONTEXT: Symbol.for('VSCodeExtensionContext'),
  WORKSPACE: Symbol.for('VSCodeWorkspace'),

  // Core Services
  LOGGER: Symbol.for('Logger'),
  ERROR_HANDLER: Symbol.for('ErrorHandler'),
  CONFIG_MANAGER: Symbol.for('ConfigManager'),
  EVENT_BUS: Symbol.for('EventBus'),

  // Abstractions
  COMMAND_MANAGER: Symbol.for('CommandManager'),
  WEBVIEW_MANAGER: Symbol.for('WebviewManager'),
} as const;
```

**Tests**:

- Container setup and teardown
- Service registration
- Dependency resolution
- Singleton vs. transient scope

---

#### 1.2: Logger Service (Day 1-2)

**Extract from**: `apps/ptah-extension-vscode/src/core/logger.ts`

**Create**: `libs/backend/vscode-core/src/logging/logger.ts`

**Features**:

```typescript
@injectable()
export class Logger {
  constructor(@inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext) {}

  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, context?: Record<string, unknown>): void;

  // Structured logging with context
  logWithContext(level: LogLevel, message: string, context: LogContext): void;
}
```

**Tests**:

- Log level filtering
- Contextual logging
- Error logging with stack traces
- Output channel integration

---

#### 1.3: ErrorHandler Service (Day 2)

**Extract from**: `apps/ptah-extension-vscode/src/handlers/error-handler.ts`

**Create**: `libs/backend/vscode-core/src/error-handling/error-handler.ts`

**Features**:

```typescript
@injectable()
export class ErrorHandler {
  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  handleError(error: Error, context?: ErrorContext): void;
  handleAsyncError(promise: Promise<unknown>, context?: ErrorContext): void;
  createErrorBoundary<T>(fn: () => T, fallback?: T): T;

  // User-friendly error messages
  showErrorToUser(error: Error, actions?: ErrorAction[]): void;
}
```

**Tests**:

- Error boundaries
- Async error handling
- User notifications
- Error context tracking

---

#### 1.4: ConfigManager Service (Day 2-3)

**Extract from**: `apps/ptah-extension-vscode/src/config/ptah-config.service.ts`

**Create**: `libs/backend/vscode-core/src/config/config-manager.ts`

**Features**:

```typescript
@injectable()
export class ConfigManager {
  constructor(@inject(TOKENS.EVENT_BUS) private eventBus: EventBus) {}

  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
  watch(key: string, callback: (value: unknown) => void): vscode.Disposable;

  // Type-safe configuration
  getTyped<T>(key: string, schema: z.ZodSchema<T>): T;
}
```

**Tests**:

- Configuration get/set
- Workspace vs. global scope
- Configuration watching
- Type validation with Zod

---

### Phase 2: Command & Webview Abstractions (3 days)

#### 2.1: CommandManager (Day 4-5)

**Extract from**: `apps/ptah-extension-vscode/src/registries/command-registry.ts`

**Create**: `libs/backend/vscode-core/src/api-wrappers/command-manager.ts`

**Features**:

```typescript
export interface CommandDefinition<T = unknown> {
  readonly id: string;
  readonly handler: (...args: T[]) => unknown | Promise<unknown>;
  readonly thisArg?: unknown;
  readonly when?: string; // VS Code when clause
}

@injectable()
export class CommandManager {
  constructor(@inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext, @inject(TOKENS.LOGGER) private logger: Logger) {}

  registerCommand<T>(definition: CommandDefinition<T>): void;
  registerCommands(commands: CommandDefinition[]): void;
  executeCommand<T>(id: string, ...args: unknown[]): Promise<T>;

  // Built-in error handling
  private wrapHandler(handler: Function): Function;
}
```

**Tests**:

- Command registration
- Command execution
- Error handling in commands
- Disposable cleanup

---

#### 2.2: WebviewManager (Day 5-6)

**Extract from**: `apps/ptah-extension-vscode/src/registries/webview-registry.ts`

**Create**: `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`

**Features**:

```typescript
@injectable()
export class WebviewManager {
  constructor(@inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext, @inject(TOKENS.EVENT_BUS) private eventBus: EventBus) {}

  createWebviewPanel<T>(viewType: string, title: string, initialData?: T): vscode.WebviewPanel;

  postMessage<T extends keyof MessagePayloadMap>(panel: vscode.WebviewPanel, type: T, payload: MessagePayloadMap[T]): void;

  // HTML generation with CSP
  generateHtml(scriptUri: vscode.Uri, styleUri: vscode.Uri): string;
}
```

**Tests**:

- Webview panel creation
- Message posting
- HTML generation with CSP
- Lifecycle management

---

#### 2.3: Move Validation to vscode-core (Day 6)

**Extract from**: `apps/ptah-extension-vscode/src/services/validation/`

**Create**: `libs/backend/vscode-core/src/validation/`

**Features**:

- Message validation with Zod
- Branded type validation
- Error formatting
- Validation result types

---

### Phase 3: Provider System Completion (2 days)

#### 3.1: ProviderManager Implementation (Day 7)

**Extract from**: `apps/ptah-extension-vscode/src/services/ai-providers/provider-manager.ts`

**Create**: `libs/backend/ai-providers-core/src/manager/provider-manager.ts`

**Features**:

```typescript
@injectable()
export class ProviderManager {
  constructor(@inject(TOKENS.PROVIDER_FACTORY) private factory: ProviderFactory, @inject(TOKENS.PROVIDER_STRATEGY) private strategy: ProviderSelectionStrategy) {}

  async selectProvider(context: ProviderContext): Promise<EnhancedAIProvider>;
  registerProvider(provider: EnhancedAIProvider): void;
  getAvailableProviders(): readonly ProviderId[];

  // Health monitoring
  checkProviderHealth(providerId: ProviderId): Promise<ProviderHealth>;
}
```

---

#### 3.2: Selection Strategies (Day 7-8)

**Create**: `libs/backend/ai-providers-core/src/strategies/`

**Strategies**:

1. **IntelligentProviderStrategy**: Cost vs. quality optimization
2. **FallbackStrategy**: Primary → fallback chain
3. **LoadBalancingStrategy**: Distribute across providers
4. **CapabilityMatchingStrategy**: Match task to provider capabilities

---

#### 3.3: Context Manager Migration (Day 8)

**Extract from**: `apps/ptah-extension-vscode/src/services/context-manager.ts`

**Create**: `libs/backend/ai-providers-core/src/context/context-manager.ts`

**Integration**: Use workspace-intelligence for context optimization

---

### Phase 4: Claude Domain Extraction (2 days)

#### 4.1: ClaudeCliAdapter (Day 9)

**Extract from**: `apps/ptah-extension-vscode/src/services/claude-cli.service.ts`

**Create**: `libs/backend/claude-domain/src/cli/claude-cli-adapter.ts`

**Implements**: `EnhancedAIProvider` interface from ai-providers-core

**Features**:

```typescript
@injectable()
export class ClaudeCliAdapter implements EnhancedAIProvider {
  readonly id = 'claude-cli' as const;

  constructor(@inject(TOKENS.CLAUDE_CLI_DETECTOR) private detector: ClaudeCliDetector, @inject(TOKENS.LOGGER) private logger: Logger) {}

  async sendMessage(message: string, context: ProviderContext): Promise<AsyncIterable<MessageChunk>>;

  async getCapabilities(): Promise<ProviderCapabilities>;
  async checkHealth(): Promise<ProviderHealth>;
}
```

---

#### 4.2: ClaudeCliDetector (Day 9-10)

**Extract from**: `apps/ptah-extension-vscode/src/services/claude-cli-detector.service.ts`

**Create**: `libs/backend/claude-domain/src/cli/claude-cli-detector.ts`

---

#### 4.3: DI Registration (Day 10)

**Create**: `libs/backend/claude-domain/src/di/register.ts`

```typescript
export function registerClaudeDomainServices(container: DependencyContainer): void {
  container.register(TOKENS.CLAUDE_CLI_DETECTOR, { useClass: ClaudeCliDetector });
  container.register(TOKENS.CLAUDE_CLI_ADAPTER, { useClass: ClaudeCliAdapter });
}
```

---

## 🧪 Testing Strategy

### Unit Tests (≥80% Coverage)

**For Each Service**:

- Constructor and initialization
- Public methods with various inputs
- Error handling and edge cases
- Disposal and cleanup

**Tools**:

- Jest testing framework
- reflect-metadata for TSyringe
- VS Code API mocking

---

### Integration Tests

**Cross-Service Integration**:

- DI container → service resolution
- CommandManager → command execution
- WebviewManager → message passing
- ProviderManager → provider selection

**Libraries**:

- EventBus ↔ CommandManager
- ConfigManager ↔ ProviderManager
- workspace-intelligence ↔ ContextManager

---

### Performance Benchmarks

**Targets**:

- DI container resolution: <1ms per service
- CommandManager registration: <10ms for 100 commands
- ProviderManager selection: <100ms with 10 providers
- EventBus message passing: <5ms per message

---

## 📐 Architecture Compliance

### SOLID Principles

**Single Responsibility**:

- CommandManager: Command registration only
- WebviewManager: Webview lifecycle only
- Each service has one clear purpose

**Open/Closed**:

- Provider system extensible via interfaces
- Strategy pattern for provider selection
- Plugin architecture for new providers

**Liskov Substitution**:

- All providers implement EnhancedAIProvider
- All strategies implement SelectionStrategy
- Mock implementations work in tests

**Interface Segregation**:

- Focused interfaces (CommandDefinition, ProviderContext)
- No monolithic interfaces
- Clients depend only on what they need

**Dependency Inversion**:

- All services depend on abstractions
- TSyringe handles concrete implementations
- Easy to swap implementations

---

### Design Patterns

**Dependency Injection**: TSyringe throughout  
**Strategy Pattern**: Provider selection strategies  
**Factory Pattern**: ProviderFactory creates providers  
**Observer Pattern**: EventBus for pub/sub  
**Singleton Pattern**: Logger, ConfigManager (via DI)  
**Command Pattern**: CommandManager with CommandDefinition

---

## 🎯 Success Criteria

### Code Quality

- [ ] Zero `any` types across all libraries
- [ ] ≥80% test coverage (line, branch, function)
- [ ] All ESLint rules passing
- [ ] TypeScript strict mode enabled
- [ ] Zero circular dependencies

### Architecture Quality

- [ ] SOLID principles compliance
- [ ] Clear separation of concerns
- [ ] Reusable services in libraries
- [ ] Main app is composition-only
- [ ] Clean integration points

### Business Value

- [ ] Main app reduced by ~2,000 lines
- [ ] ~2,500 lines of reusable infrastructure
- [ ] Ready to integrate workspace-intelligence
- [ ] Foundation for Week 7 libraries
- [ ] Path to $3.8M annual ROI clear

---

## 📊 Dependencies

### Upstream Dependencies

**Requires**:

- ✅ TASK_PRV_005 complete (workspace-intelligence library)
- ✅ MONSTER plan reviewed
- ✅ TSyringe, RxJS installed

**Blocked By**: None

---

### Downstream Dependencies

**Blocks**:

- ⏳ TASK_PRV_007: Session library extraction
- ⏳ TASK_PRV_008: Analytics library extraction
- ⏳ TASK_INT_001: Final library integration

**Enables**:

- Integration of workspace-intelligence
- Main app cleanup and deletion
- Week 7-9 library work

---

## 🚨 Risks & Mitigations

### Risk 1: Breaking Main App During Extraction

**Probability**: Medium  
**Impact**: High

**Mitigation**:

- Extract to libraries FIRST (don't modify main app)
- Write comprehensive tests for libraries
- Validate libraries work independently
- Main app keeps working until final integration
- Can rollback library changes without affecting main app

---

### Risk 2: Circular Dependencies

**Probability**: Low  
**Impact**: High

**Mitigation**:

- Use Symbol.for() tokens instead of importing
- Follow MONSTER plan's dependency flow
- Validate with `nx graph` after each library
- workspace-intelligence serves as reference

---

### Risk 3: Integration Complexity

**Probability**: Medium  
**Impact**: Medium

**Mitigation**:

- Libraries work independently (no forced integration)
- Integration is separate task (TASK_INT_001)
- Can integrate incrementally, one library at a time
- Comprehensive integration tests before main app changes

---

## 📝 Deliverables Checklist

### Phase 1 Deliverables (DI & Core)

- [ ] `libs/backend/vscode-core/src/di/container.ts`
- [ ] `libs/backend/vscode-core/src/di/tokens.ts`
- [ ] `libs/backend/vscode-core/src/logging/logger.ts`
- [ ] `libs/backend/vscode-core/src/error-handling/error-handler.ts`
- [ ] `libs/backend/vscode-core/src/config/config-manager.ts`
- [ ] Unit tests for all above (≥80% coverage)
- [ ] Integration tests for DI container

---

### Phase 2 Deliverables (Command & Webview)

- [ ] `libs/backend/vscode-core/src/api-wrappers/command-manager.ts`
- [ ] `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`
- [ ] `libs/backend/vscode-core/src/validation/` (moved from main app)
- [ ] Unit tests for all above (≥80% coverage)
- [ ] Integration tests for abstractions

---

### Phase 3 Deliverables (Provider System)

- [ ] `libs/backend/ai-providers-core/src/manager/provider-manager.ts`
- [ ] `libs/backend/ai-providers-core/src/strategies/` (4 strategies)
- [ ] `libs/backend/ai-providers-core/src/context/context-manager.ts`
- [ ] Unit tests for all above (≥80% coverage)
- [ ] Integration tests with workspace-intelligence

---

### Phase 4 Deliverables (Claude Domain)

- [ ] `libs/backend/claude-domain/src/cli/claude-cli-adapter.ts`
- [ ] `libs/backend/claude-domain/src/cli/claude-cli-detector.ts`
- [ ] `libs/backend/claude-domain/src/cli/command-builder.ts`
- [ ] `libs/backend/claude-domain/src/di/register.ts`
- [ ] Unit tests for all above (≥80% coverage)
- [ ] Integration tests with ai-providers-core

---

### Documentation Deliverables

- [ ] `libs/backend/vscode-core/README.md`
- [ ] `libs/backend/ai-providers-core/README.md`
- [ ] `libs/backend/claude-domain/README.md`
- [ ] API documentation for all libraries
- [ ] Migration guide (old → new patterns)
- [ ] Integration examples

---

### Task Tracking Deliverables

- [ ] `task-tracking/TASK_CORE_001/context.md` (this document)
- [ ] `task-tracking/TASK_CORE_001/implementation-plan.md`
- [ ] `task-tracking/TASK_CORE_001/progress.md` (updated daily)
- [ ] `task-tracking/TASK_CORE_001/test-report.md`
- [ ] `task-tracking/TASK_CORE_001/completion-report.md`

---

## 🎯 Definition of Done

**Library Complete When**:

1. All services implemented and tested (≥80% coverage)
2. Exported from library `index.ts`
3. README and API docs written
4. Zero `any` types, zero circular dependencies
5. SOLID principles validated
6. Integration tests passing
7. Performance benchmarks met
8. Git committed with proper message

**Task Complete When**:

1. All 4 libraries complete (vscode-core, ai-providers-core, claude-domain, validation)
2. All tests passing (≥80% coverage across all libraries)
3. Documentation complete (READMEs, API docs, migration guide)
4. Task tracking documents complete
5. Git commits with proper conventional commit format
6. Ready for integration (TASK_INT_001 can begin)

---

## 🚀 Next Steps After Completion

**Immediate** (After TASK_CORE_001):

1. Decide: Integrate now OR continue with Week 7?
2. If integrate: Start TASK_INT_001 (integrate all libraries)
3. If defer: Start TASK_PRV_007 (session library) or TASK_PRV_008 (analytics library)

**Recommended**: **Continue with Week 7** (defer integration until all libraries created)

**Why**:

- Main app keeps working during Week 7-9 development
- All libraries created before big integration
- Clean sweep integration at the end
- Less risk of breaking changes

---

**Task Status**: 📋 Ready to Start  
**Estimated Start**: Immediately  
**Estimated Completion**: 10 days from start  
**Blocks**: Week 7 libraries (Session & Analytics)
