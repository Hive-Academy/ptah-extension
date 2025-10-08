# Implementation Plan - TASK_PRV_001

## Original User Request

**User Asked For**: Week 4 Provider Core Infrastructure

## Research Evidence Integration

**Critical Findings Addressed**:

- User requested Week 4 from MONSTER_EXTENSION_REFACTOR_PLAN which includes BOTH infrastructure AND basic provider implementations
- MONSTER plan Week 4 specification (lines 424-624) explicitly includes Claude CLI Adapter implementation
- Existing `libs/shared/src/lib/types/ai-provider.types.ts` provides complete foundation (IAIProvider, ProviderCapabilities, ProviderHealth, etc.)
- Week 2-3 infrastructure (EventBus, DI container, tokens) operational and tested
- MessagePayloadMap already includes provider event types ('providers:\*')
- Week 4 bridges to Week 5 which focuses on Angular UI integration, NOT provider implementations

**Evidence Source**:

- task-tracking/TASK_PRV_001/task-description.md (user request and acceptance criteria)
- MONSTER_EXTENSION_REFACTOR_PLAN.md Week 4 (lines 424-624, includes EnhancedAIProvider interface AND ClaudeCliAdapter implementation)
- MONSTER_EXTENSION_REFACTOR_PLAN.md Week 5 (lines 625+, focuses on Angular UI components, not provider implementations)

## Architecture Approach

**Design Pattern**: Strategy Pattern + Manager Pattern + Factory Pattern + Adapter Pattern
**Implementation Timeline**: 6-8 days (infrastructure + basic provider implementations within Week 4 scope)

**Scope Correction**:

- ❌ **PREVIOUS ERROR**: Separated provider implementations (Claude CLI, VS Code LM) as future registry tasks
- ✅ **CORRECTED SCOPE**: Week 4 includes basic provider implementations as core deliverables per MONSTER plan
- ✅ **TRULY FUTURE WORK**: Advanced features (load balancing, cost optimization, performance dashboards) moved to registry## Phase 1: Core Interfaces (Day 1-2 - 10-12 hours)

### Task 1.1: Enhanced Provider Interface

**Complexity**: MEDIUM
**Files to Create**: `libs/backend/ai-providers-core/src/interfaces/provider.interface.ts`
**Expected Outcome**: Context-aware provider interface extending existing IAIProvider
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
// Extends existing IAIProvider from @ptah-extension/shared
export interface ProviderContext {
  readonly taskType: 'coding' | 'reasoning' | 'analysis' | 'refactoring' | 'debugging';
  readonly complexity: 'low' | 'medium' | 'high';
  readonly fileTypes: readonly string[];
  readonly projectType?: string;
  readonly contextSize: number;
}

export interface EnhancedAIProvider extends IAIProvider {
  // Context-aware capabilities
  canHandle(context: ProviderContext): boolean;
  estimateCost(context: ProviderContext): number;
  estimateLatency(context: ProviderContext): number;

  // Enhanced session management with streaming
  createSession(config: AISessionConfig): Promise<string>;
  sendMessage(sessionId: string, message: string, context: ProviderContext): AsyncIterable<string>;

  // Health monitoring
  performHealthCheck(): Promise<ProviderHealth>;
}
```

**Type Reuse**:

- `IAIProvider` from `@ptah-extension/shared` - base provider interface
- `ProviderHealth` from `@ptah-extension/shared` - health status type
- `AISessionConfig` from `@ptah-extension/shared` - session configuration

### Task 1.2: Provider Selection Result Types

**Complexity**: LOW
**Files to Create**: `libs/backend/ai-providers-core/src/interfaces/provider-selection.interface.ts`
**Expected Outcome**: Type-safe selection result with confidence scoring
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
export interface ProviderSelectionResult {
  readonly providerId: ProviderId;
  readonly confidence: number; // 0-100 score
  readonly reasoning: string;
  readonly fallbacks: readonly ProviderId[];
}
```

**Type Reuse**:

- `ProviderId` from `@ptah-extension/shared` - provider identifier type

## Phase 2: Selection Strategy (Day 2-3 - 8-10 hours)

### Task 2.1: Intelligent Provider Selection Strategy

**Complexity**: HIGH
**Files to Create**: `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.ts`
**Expected Outcome**: Cline-style scoring algorithm for provider selection
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
@injectable()
export class IntelligentProviderStrategy {
  async selectProvider(context: ProviderContext, availableProviders: Map<ProviderId, EnhancedAIProvider>): Promise<ProviderSelectionResult> {
    // Score providers 0-100 based on:
    // - Task type specialization (50 points max)
    // - Complexity matching (20 points max)
    // - Health status (30 points max)
    // Return best match with fallbacks
  }

  private calculateScore(context: ProviderContext, provider: EnhancedAIProvider): number;
  private generateReasoning(context: ProviderContext, provider: EnhancedAIProvider): string;
}
```

**Type Reuse**:

- `@injectable()` decorator from TSyringe
- `ProviderContext` from phase 1
- `EnhancedAIProvider` from phase 1
- `ProviderId` from `@ptah-extension/shared`

**Scoring Algorithm**:

- **Task Type Matching** (50 points): claude-3.5-sonnet for coding, deepseek-r1 for reasoning
- **Complexity Matching** (20 points): High complexity requires advanced capabilities
- **Health Status** (30 points): Available=30, Degraded=10, Error=0

## Phase 3: Provider Manager (Day 3-4 - 10-12 hours)

### Task 3.1: Provider State Management Types

**Complexity**: LOW
**Files to Create**: `libs/backend/ai-providers-core/src/manager/provider-state.types.ts`
**Expected Outcome**: Type-safe state structure for RxJS BehaviorSubject
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
export interface ActiveProviderState {
  readonly current: EnhancedAIProvider | null;
  readonly available: ReadonlyMap<ProviderId, EnhancedAIProvider>;
  readonly health: ReadonlyMap<ProviderId, ProviderHealth>;
  readonly lastSwitch?: {
    readonly from: ProviderId | null;
    readonly to: ProviderId;
    readonly reason: string;
    readonly timestamp: number;
  };
}
```

**Type Reuse**:

- `ProviderId` from `@ptah-extension/shared`
- `ProviderHealth` from `@ptah-extension/shared`
- `EnhancedAIProvider` from phase 1

### Task 3.2: Provider Manager with RxJS

**Complexity**: HIGH
**Files to Create**: `libs/backend/ai-providers-core/src/manager/provider-manager.ts`
**Expected Outcome**: Reactive provider orchestration with EventBus integration
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
@injectable()
export class ProviderManager {
  private providersSubject = new BehaviorSubject<ActiveProviderState>({
    current: null,
    available: new Map(),
    health: new Map(),
  });

  readonly state$: Observable<ActiveProviderState> = this.providersSubject.asObservable();

  constructor(@inject(TOKENS.EVENT_BUS) private eventBus: EventBus, private strategy: IntelligentProviderStrategy) {
    this.startHealthMonitoring();
    this.setupEventListeners();
  }

  registerProvider(provider: EnhancedAIProvider): void;
  async selectBestProvider(context: ProviderContext): Promise<EnhancedAIProvider>;
  private startHealthMonitoring(): void; // 30-second interval
  private setupEventListeners(): void; // EventBus subscriptions
}
```

**Type Reuse**:

- `EventBus` from `@ptah-extension/vscode-core`
- `TOKENS` from `@ptah-extension/vscode-core`
- `BehaviorSubject`, `Observable`, `interval` from RxJS
- `EnhancedAIProvider` from phase 1
- `ProviderContext` from phase 1
- `ActiveProviderState` from task 3.1

**EventBus Integration**:

- Publish `provider:registered` when provider added
- Publish `provider:switched` on provider change
- Publish `provider:error` on provider failure
- Publish `provider:failover` on automatic fallback

## Phase 4: Claude CLI Provider Adapter (Day 4-5 - 8-12 hours)

### Task 4.1: Claude CLI Adapter Implementation

**Complexity**: HIGH
**Files to Create**: `libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts`
**Expected Outcome**: Functional Claude CLI provider with streaming support
**Developer Assignment**: backend-developer

**Implementation Details** (from MONSTER plan Week 4):

```typescript
@injectable()
export class ClaudeCliAdapter implements EnhancedAIProvider {
  readonly id = 'claude-cli' as const;

  readonly capabilities = {
    streaming: true,
    fileAttachments: true,
    contextManagement: true,
    sessionPersistence: true,
    multiTurn: true,
    codeGeneration: true,
    imageAnalysis: true,
    functionCalling: true,
  };

  private processes = new Map<string, ChildProcess>();

  canHandle(context: ProviderContext): boolean {
    // Claude CLI excels at coding and complex reasoning
    return ['coding', 'reasoning', 'refactoring'].includes(context.taskType);
  }

  estimateCost(context: ProviderContext): number {
    const baseRate = 0.015; // per 1k tokens
    const contextTokens = context.contextSize;
    return (contextTokens / 1000) * baseRate;
  }

  estimateLatency(context: ProviderContext): number {
    const base = 500; // ms
    const complexityMultiplier = {
      low: 1,
      medium: 1.5,
      high: 2.5,
    }[context.complexity];

    return base * complexityMultiplier + (context.contextSize / 1000) * 10;
  }

  async createSession(config: AISessionConfig): Promise<string> {
    // Spawn Claude CLI process with streaming support
  }

  async *sendMessage(sessionId: string, message: string, context: ProviderContext): AsyncIterable<string> {
    // Stream responses from Claude CLI process
  }

  async performHealthCheck(): Promise<ProviderHealth> {
    // Check Claude CLI availability and response time
  }
}
```

**Dependencies**:

- Node.js `child_process` for CLI spawning
- EnhancedAIProvider interface from Phase 1
- ProviderContext from Phase 1

**Key Features**:

- Process spawning and management
- Streaming response handling via AsyncIterable
- Session lifecycle management
- Health monitoring with response time tracking
- Error handling and process cleanup

### Task 4.2: VS Code LM Provider Adapter (Basic)

**Complexity**: MEDIUM
**Files to Create**: `libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.ts`
**Expected Outcome**: Basic VS Code LM API provider adapter
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
@injectable()
export class VsCodeLmAdapter implements EnhancedAIProvider {
  readonly id = 'vscode-lm' as const;

  readonly capabilities = {
    streaming: true,
    fileAttachments: false, // VS Code LM has limited file support
    contextManagement: true,
    sessionPersistence: false, // Stateless
    multiTurn: true,
    codeGeneration: true,
    imageAnalysis: false,
    functionCalling: false,
  };

  canHandle(context: ProviderContext): boolean {
    // VS Code LM good for quick coding tasks
    return context.taskType === 'coding' && context.complexity !== 'high';
  }

  estimateCost(context: ProviderContext): number {
    return 0; // Free with VS Code
  }

  estimateLatency(context: ProviderContext): number {
    return 300; // Generally faster than Claude CLI
  }

  async createSession(config: AISessionConfig): Promise<string> {
    // VS Code LM is stateless, return session ID for tracking only
  }

  async *sendMessage(sessionId: string, message: string, context: ProviderContext): AsyncIterable<string> {
    // Use VS Code LM API with streaming
  }

  async performHealthCheck(): Promise<ProviderHealth> {
    // Check VS Code LM API availability
  }
}
```

**Dependencies**:

- VS Code LM API (vscode.lm namespace)
- EnhancedAIProvider interface from Phase 1

**Note**: Basic implementation focusing on core functionality. Advanced features deferred.

## Phase 5: Integration & Testing (Day 6-7 - 10-14 hours)

### Task 5.1: Update Module Exports

**Complexity**: LOW
**Files to Modify**:

- `libs/backend/ai-providers-core/src/index.ts`
- `libs/backend/ai-providers-core/src/interfaces/index.ts`
- `libs/backend/ai-providers-core/src/strategies/index.ts`
- `libs/backend/ai-providers-core/src/manager/index.ts`
- `libs/backend/ai-providers-core/src/adapters/index.ts` (NEW)

**Expected Outcome**: Clean public API for ai-providers-core library
**Developer Assignment**: backend-developer

### Task 5.2: DI Token Registration

**Complexity**: LOW
**Files to Modify**: `libs/backend/vscode-core/src/di/tokens.ts`
**Expected Outcome**: Add PROVIDER_STRATEGY token
**Developer Assignment**: backend-developer

**Implementation**:

```typescript
// Add to TOKENS constant
export const PROVIDER_STRATEGY = Symbol('ProviderStrategy');

export const TOKENS = {
  // ... existing tokens
  PROVIDER_STRATEGY, // New token
} as const;
```

### Task 5.3: Comprehensive Unit Tests

**Complexity**: HIGH
**Files to Create**:

- `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.spec.ts`
- `libs/backend/ai-providers-core/src/manager/provider-manager.spec.ts`
- `libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.spec.ts`
- `libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.spec.ts`

**Expected Outcome**: 80%+ test coverage for all core components
**Developer Assignment**: backend-developer

**Test Scenarios**:

**Strategy Tests**:

- Strategy scores coding tasks higher for Claude Sonnet
- Strategy scores reasoning tasks higher for DeepSeek R1
- Strategy prioritizes healthy providers over degraded ones
- Strategy returns fallback providers in confidence order

**Manager Tests**:

- Manager emits state changes on provider registration
- Manager publishes EventBus events on provider switch
- Health monitoring runs every 30 seconds
- Manager handles provider failures gracefully

**Adapter Tests**:

- Claude CLI adapter spawns processes correctly
- Claude CLI adapter streams responses via AsyncIterable
- VS Code LM adapter uses VS Code API correctly
- Both adapters implement health checks
- Error handling and cleanup work properly

### Task 5.4: Integration Testing

**Complexity**: MEDIUM
**Files to Create**: `libs/backend/ai-providers-core/src/integration/provider-integration.spec.ts`
**Expected Outcome**: End-to-end provider workflow validation
**Developer Assignment**: backend-developer

**Test Scenarios**:

- Register Claude CLI provider → Select for coding task → Verify selection
- Register VS Code LM provider → Select for simple coding → Verify selection
- Trigger health monitoring → Verify state updates
- Simulate provider failure → Verify fallback behavior

### Task 1.1: Enhanced Provider Interface

**Complexity**: MEDIUM  
**Files to Create**: `libs/backend/ai-providers-core/src/interfaces/provider.interface.ts`  
**Expected Outcome**: Context-aware provider interface extending existing IAIProvider  
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
// Extends existing IAIProvider from @ptah-extension/shared
export interface ProviderContext {
  readonly taskType: 'coding' | 'reasoning' | 'analysis' | 'refactoring' | 'debugging';
  readonly complexity: 'low' | 'medium' | 'high';
  readonly fileTypes: readonly string[];
  readonly projectType?: string;
  readonly contextSize: number;
}

export interface EnhancedAIProvider extends IAIProvider {
  // Context-aware capabilities
  canHandle(context: ProviderContext): boolean;
  estimateCost(context: ProviderContext): number;
  estimateLatency(context: ProviderContext): number;

  // Enhanced session management with streaming
  createSession(config: AISessionConfig): Promise<string>;
  sendMessage(sessionId: string, message: string, context: ProviderContext): AsyncIterable<string>;

  // Health monitoring
  performHealthCheck(): Promise<ProviderHealth>;
}
```

**Type Reuse**:

- `IAIProvider` from `@ptah-extension/shared` - base provider interface
- `ProviderHealth` from `@ptah-extension/shared` - health status type
- `AISessionConfig` from `@ptah-extension/shared` - session configuration

### Task 1.2: Provider Selection Result Types

**Complexity**: LOW  
**Files to Create**: `libs/backend/ai-providers-core/src/interfaces/provider-selection.interface.ts`  
**Expected Outcome**: Type-safe selection result with confidence scoring  
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
export interface ProviderSelectionResult {
  readonly providerId: ProviderId;
  readonly confidence: number; // 0-100 score
  readonly reasoning: string;
  readonly fallbacks: readonly ProviderId[];
}
```

**Type Reuse**:

- `ProviderId` from `@ptah-extension/shared` - provider identifier type

## Phase 2: Selection Strategy (Day 2 - 6-8 hours)

### Task 2.1: Intelligent Provider Selection Strategy

**Complexity**: HIGH  
**Files to Create**: `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.ts`  
**Expected Outcome**: Cline-style scoring algorithm for provider selection  
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
@injectable()
export class IntelligentProviderStrategy {
  async selectProvider(context: ProviderContext, availableProviders: Map<ProviderId, EnhancedAIProvider>): Promise<ProviderSelectionResult> {
    // Score providers 0-100 based on:
    // - Task type specialization (50 points max)
    // - Complexity matching (20 points max)
    // - Health status (30 points max)
    // Return best match with fallbacks
  }

  private calculateScore(context: ProviderContext, provider: EnhancedAIProvider): number;
  private generateReasoning(context: ProviderContext, provider: EnhancedAIProvider): string;
}
```

**Type Reuse**:

- `@injectable()` decorator from TSyringe
- `ProviderContext` from phase 1
- `EnhancedAIProvider` from phase 1
- `ProviderId` from `@ptah-extension/shared`

**Scoring Algorithm**:

- **Task Type Matching** (50 points): claude-3.5-sonnet for coding, deepseek-r1 for reasoning
- **Complexity Matching** (20 points): High complexity requires advanced capabilities
- **Health Status** (30 points): Available=30, Degraded=10, Error=0

## Phase 3: Provider Manager (Day 3 - 8-10 hours)

### Task 3.1: Provider State Management Types

**Complexity**: LOW  
**Files to Create**: `libs/backend/ai-providers-core/src/manager/provider-state.types.ts`  
**Expected Outcome**: Type-safe state structure for RxJS BehaviorSubject  
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
export interface ActiveProviderState {
  readonly current: EnhancedAIProvider | null;
  readonly available: ReadonlyMap<ProviderId, EnhancedAIProvider>;
  readonly health: ReadonlyMap<ProviderId, ProviderHealth>;
  readonly lastSwitch?: {
    readonly from: ProviderId | null;
    readonly to: ProviderId;
    readonly reason: string;
    readonly timestamp: number;
  };
}
```

**Type Reuse**:

- `ProviderId` from `@ptah-extension/shared`
- `ProviderHealth` from `@ptah-extension/shared`
- `EnhancedAIProvider` from phase 1

### Task 3.2: Provider Manager with RxJS

**Complexity**: HIGH  
**Files to Create**: `libs/backend/ai-providers-core/src/manager/provider-manager.ts`  
**Expected Outcome**: Reactive provider orchestration with EventBus integration  
**Developer Assignment**: backend-developer

**Implementation Details**:

```typescript
@injectable()
export class ProviderManager {
  private providersSubject = new BehaviorSubject<ActiveProviderState>({
    current: null,
    available: new Map(),
    health: new Map(),
  });

  readonly state$: Observable<ActiveProviderState> = this.providersSubject.asObservable();

  constructor(@inject(TOKENS.EVENT_BUS) private eventBus: EventBus, private strategy: IntelligentProviderStrategy) {
    this.startHealthMonitoring();
    this.setupEventListeners();
  }

  registerProvider(provider: EnhancedAIProvider): void;
  async selectBestProvider(context: ProviderContext): Promise<EnhancedAIProvider>;
  private startHealthMonitoring(): void; // 30-second interval
  private setupEventListeners(): void; // EventBus subscriptions
}
```

**Type Reuse**:

- `EventBus` from `@ptah-extension/vscode-core`
- `TOKENS` from `@ptah-extension/vscode-core`
- `BehaviorSubject`, `Observable`, `interval` from RxJS
- `EnhancedAIProvider` from phase 1
- `ProviderContext` from phase 1
- `ActiveProviderState` from task 3.1

**EventBus Integration**:

- Publish `provider:registered` when provider added
- Publish `provider:switched` on provider change
- Publish `provider:error` on provider failure
- Publish `provider:failover` on automatic fallback

## Phase 4: Integration & Testing (Day 4 - 4-6 hours)

### Task 4.1: Update Module Exports

**Complexity**: LOW  
**Files to Modify**:

- `libs/backend/ai-providers-core/src/index.ts`
- `libs/backend/ai-providers-core/src/interfaces/index.ts`
- `libs/backend/ai-providers-core/src/strategies/index.ts`
- `libs/backend/ai-providers-core/src/manager/index.ts`

**Expected Outcome**: Clean public API for ai-providers-core library  
**Developer Assignment**: backend-developer

### Task 4.2: DI Token Registration

**Complexity**: LOW  
**Files to Modify**: `libs/backend/vscode-core/src/di/tokens.ts`  
**Expected Outcome**: Add PROVIDER_STRATEGY token  
**Developer Assignment**: backend-developer

**Implementation**:

```typescript
// Add to TOKENS constant
export const PROVIDER_STRATEGY = Symbol('ProviderStrategy');

export const TOKENS = {
  // ... existing tokens
  PROVIDER_STRATEGY, // New token
} as const;
```

### Task 4.3: Unit Tests

**Complexity**: MEDIUM  
**Files to Create**:

- `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.spec.ts`
- `libs/backend/ai-providers-core/src/manager/provider-manager.spec.ts`

**Expected Outcome**: 80%+ test coverage for strategy scoring and manager state  
**Developer Assignment**: backend-developer

**Test Scenarios**:

- Strategy scores coding tasks higher for Claude Sonnet
- Strategy scores reasoning tasks higher for DeepSeek R1
- Strategy prioritizes healthy providers over degraded ones
- Manager emits state changes on provider registration
- Manager publishes EventBus events on provider switch
- Health monitoring runs every 30 seconds

## Future Work Moved to Registry

**Truly Out-of-Scope Enhancements (NOT part of user's Week 4 request)**:

The following items are NOT part of Week 4 Provider Core Infrastructure. They are genuine future enhancements that go beyond the user's request:

**NOT Added to Registry** (These were incorrectly added previously - they ARE part of current task):

- ~~TASK_PRV_005: Claude CLI Adapter~~ → ✅ **INCLUDED in Phase 4** (Task 4.1) - Core part of Week 4
- ~~TASK_PRV_006: VS Code LM Provider Adapter~~ → ✅ **INCLUDED in Phase 4** (Task 4.2) - Core part of Week 4
- ~~TASK_PRV_007: Provider Selection UI~~ → Already exists as separate task TASK_PRV_002 (Week 5 focus)

**Genuinely Future Work** (Already in registry as TASK_PRV_002 and TASK_PRV_003):

| Existing Task | Description                                             | Rationale                                               |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| TASK_PRV_002  | Week 5 Provider Angular UI Integration                  | Separate task - Angular webview components (NOT Week 4) |
| TASK_PRV_003  | Week 6 Provider Testing & Optimization - Load balancing | Advanced optimization (NOT requested in Week 4)         |

**Additional Future Enhancements** (Could be added to registry if needed later):

- Advanced Load Balancing Algorithms - Beyond basic provider selection (optimization)
- Cost Optimization and Budget Tracking - Not requested, nice-to-have feature
- Performance Monitoring Dashboard - Analytics enhancement, not core functionality

**Registry Status**: No new tasks added. TASK_PRV_005-010 were removed as they were registry pollution.

## Developer Handoff

**Next Agent**: backend-developer
**Priority Order**: Execute phases 1→2→3→4→5 sequentially

**Success Criteria**:

- All interfaces compile without errors
- Strategy scoring algorithm returns 0-100 confidence scores
- Manager state$ observable emits on provider changes
- EventBus integration verified with unit tests
- **Claude CLI adapter spawns processes and streams responses**
- **VS Code LM adapter integrates with VS Code API**
- **Both adapters implement health checks correctly**
- Zero `any` types used in implementation
- Test coverage ≥80% across all components

---

## Type/Schema Strategy

### Existing Types to Reuse (Search Completed)

**From `@ptah-extension/shared` (`libs/shared/src/lib/types/ai-provider.types.ts`)**:

- ✅ `IAIProvider` - Base provider interface (lines 109-150) - Extended by EnhancedAIProvider
- ✅ `ProviderId` - Union type 'claude-cli' | 'vscode-lm' (line 13) - Used throughout
- ✅ `ProviderStatus` - Health status enum (line 18) - Used in ProviderHealth
- ✅ `ProviderCapabilities` - Feature flags interface (lines 23-32) - Used in scoring
- ✅ `ProviderInfo` - Provider metadata (lines 37-45) - Used in provider registration
- ✅ `ProviderHealth` - Health monitoring interface (lines 50-56) - Used in state management
- ✅ `AISessionConfig` - Session configuration (lines 75-82) - Used in createSession()
- ✅ `AIMessageOptions` - Message options (lines 61-70) - Used in sendMessage()
- ✅ `ProviderError`, `ProviderErrorType` - Error handling (lines 87-104, 152-157) - Used in error events

**From `@ptah-extension/shared` (`libs/shared/src/lib/types/message.types.ts`)**:

- ✅ `MessagePayloadMap` - Type-safe event payloads (lines 423-490) - Already includes provider events:
  - `'providers:switch'` - Provider switching
  - `'providers:healthChanged'` - Health updates
  - `'providers:error'` - Error events
  - `'providers:currentChanged'` - Current provider changed

**From `@ptah-extension/vscode-core` (`libs/backend/vscode-core/src/messaging/event-bus.ts`)**:

- ✅ `EventBus` - RxJS event bus (line 53) - Injected into ProviderManager
- ✅ `TypedEvent<T>` - Event structure (lines 17-22) - Used for provider events

**From `@ptah-extension/vscode-core` (`libs/backend/vscode-core/src/di/tokens.ts`)**:

- ✅ `TOKENS.AI_PROVIDER_MANAGER` - DI token (line 18) - Already defined
- ✅ `TOKENS.AI_PROVIDER_FACTORY` - DI token (line 17) - Already defined
- ✅ `TOKENS.EVENT_BUS` - DI token (line 15) - Already defined

**From TSyringe**:

- ✅ `@injectable()` - Class decorator for DI
- ✅ `@inject()` - Constructor parameter decorator

**From RxJS**:

- ✅ `BehaviorSubject<T>` - Stateful observable
- ✅ `Observable<T>` - Observable stream
- ✅ `interval()` - Timer operator for health monitoring

### New Types Required

**Phase 1 - Interfaces**:

- `ProviderContext` in `libs/backend/ai-providers-core/src/interfaces/provider-context.interface.ts`
  - Purpose: Capture task context for intelligent provider selection
  - Structure: taskType, complexity, fileTypes, projectType, contextSize
- `EnhancedAIProvider` in `libs/backend/ai-providers-core/src/interfaces/provider.interface.ts`

  - Purpose: Extend IAIProvider with context-aware methods
  - Structure: Extends IAIProvider, adds canHandle(), estimateCost(), estimateLatency(), performHealthCheck()

- `ProviderSelectionResult` in `libs/backend/ai-providers-core/src/interfaces/provider-selection.interface.ts`
  - Purpose: Type-safe result from provider selection strategy
  - Structure: providerId, confidence, reasoning, fallbacks

**Phase 3 - State Management**:

- `ActiveProviderState` in `libs/backend/ai-providers-core/src/manager/provider-state.types.ts`
  - Purpose: State structure for ProviderManager's BehaviorSubject
  - Structure: current, available, health, lastSwitch

**No Duplication Evidence**:

- ✅ Searched `libs/shared/src/lib/types/ai-provider.types.ts` - Found comprehensive base types
- ✅ Searched `libs/shared/src/lib/types/message.types.ts` - Found MessagePayloadMap with provider events
- ✅ Searched `libs/backend/vscode-core/src/di/tokens.ts` - Found existing DI tokens
- ✅ New types (ProviderContext, EnhancedAIProvider, etc.) are extensions, not duplicates

## Architecture Overview

### Design Decisions

**Pattern**: Strategy Pattern + Manager Pattern + Dependency Injection

- **Strategy Pattern**: `IntelligentProviderStrategy` encapsulates provider selection algorithm, allowing future strategies (e.g., cost-optimized, latency-optimized)
- **Manager Pattern**: `ProviderManager` centralizes provider lifecycle, state management, and event orchestration
- **Dependency Injection**: TSyringe DI enables testability and loose coupling

**SOLID Compliance**:

- ✅ **Single Responsibility**:
  - `EnhancedAIProvider`: Provider contract only
  - `IntelligentProviderStrategy`: Selection logic only
  - `ProviderManager`: Lifecycle orchestration only
- ✅ **Open/Closed**:
  - `EnhancedAIProvider` interface extensible via new implementations
  - Strategy pattern allows adding new selection strategies without modifying manager
- ✅ **Liskov Substitution**:
  - All `EnhancedAIProvider` implementations must fulfill contract
  - Strategy implementations interchangeable
- ✅ **Interface Segregation**:
  - `ProviderContext` focused on selection context only
  - `ProviderSelectionResult` focused on selection output only
- ✅ **Dependency Inversion**:
  - Manager depends on `EnhancedAIProvider` interface, not concrete implementations
  - EventBus injected via DI, not hardcoded

**Type/Schema Reuse**:

- Extends existing `IAIProvider` from `@ptah-extension/shared`
- Reuses `ProviderHealth`, `ProviderCapabilities`, `ProviderId` types
- Integrates with existing `MessagePayloadMap` event system
- Leverages Week 2 `EventBus` and DI infrastructure

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    ProviderManager                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ state$: Observable<ActiveProviderState>                │ │
│  │ registerProvider(provider)                             │ │
│  │ selectBestProvider(context)                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                        ▲         │                          │
│                        │         │ publishes events         │
│                        │         ▼                          │
│                        │    EventBus (Week 2)               │
│                        │                                    │
│                   uses │                                    │
│                        │                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │       IntelligentProviderStrategy                      │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ selectProvider(context, providers)               │  │ │
│  │  │ calculateScore(context, provider)                │  │ │
│  │  │ generateReasoning(context, provider)             │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                        │                                    │
│                        │ scores and selects                 │
│                        ▼                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         EnhancedAIProvider (interface)                 │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ canHandle(context): boolean                      │  │ │
│  │  │ estimateCost(context): number                    │  │ │
│  │  │ estimateLatency(context): number                 │  │ │
│  │  │ performHealthCheck(): Promise<ProviderHealth>    │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │         extends IAIProvider (@ptah-extension/shared)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                        ▲                                    │
│                        │                                    │
│                        │ implements (Week 5)                │
│                        │                                    │
│         ┌──────────────┴──────────────┐                    │
│         │                              │                    │
│  ClaudeCliAdapter            VsCodeLmProvider              │
│  (Week 5 - deferred)         (Week 5 - deferred)           │
└─────────────────────────────────────────────────────────────┘
```

**Legend**:

- `ProviderManager`: Orchestrates provider lifecycle, maintains reactive state
- `IntelligentProviderStrategy`: Scores providers based on context
- `EnhancedAIProvider`: Context-aware provider interface (extends existing IAIProvider)
- `EventBus`: Week 2 infrastructure for inter-component communication
- Actual provider implementations (ClaudeCliAdapter, VsCodeLmProvider) deferred to Week 5

## File Changes

### Files to Create

1. **`libs/backend/ai-providers-core/src/interfaces/provider-context.interface.ts`**

   - Purpose: Define ProviderContext type for task context
   - Content: TaskType, Complexity enums and ProviderContext interface
   - Estimated LOC: 25-30 lines

2. **`libs/backend/ai-providers-core/src/interfaces/provider.interface.ts`**

   - Purpose: Enhanced provider interface extending IAIProvider
   - Content: EnhancedAIProvider interface with context-aware methods
   - Estimated LOC: 40-50 lines

3. **`libs/backend/ai-providers-core/src/interfaces/provider-selection.interface.ts`**

   - Purpose: Provider selection result types
   - Content: ProviderSelectionResult interface
   - Estimated LOC: 15-20 lines

4. **`libs/backend/ai-providers-core/src/interfaces/index.ts`**

   - Purpose: Export all interfaces
   - Content: Re-exports from provider-context, provider, provider-selection
   - Estimated LOC: 5-10 lines

5. **`libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.ts`**

   - Purpose: Cline-style provider selection algorithm
   - Content: IntelligentProviderStrategy class with scoring logic
   - Estimated LOC: 120-150 lines

6. **`libs/backend/ai-providers-core/src/strategies/index.ts`**

   - Purpose: Export strategy classes
   - Content: Re-export IntelligentProviderStrategy
   - Estimated LOC: 3-5 lines

7. **`libs/backend/ai-providers-core/src/manager/provider-state.types.ts`**

   - Purpose: State management types for ProviderManager
   - Content: ActiveProviderState interface
   - Estimated LOC: 20-25 lines

8. **`libs/backend/ai-providers-core/src/manager/provider-manager.ts`**

   - Purpose: Provider lifecycle orchestration with RxJS
   - Content: ProviderManager class with state management and EventBus integration
   - Estimated LOC: 180-200 lines (within 200-line limit)

9. **`libs/backend/ai-providers-core/src/manager/index.ts`**

   - Purpose: Export manager classes
   - Content: Re-export ProviderManager and state types
   - Estimated LOC: 5-10 lines

10. **`libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts`** ← **NEW**

    - Purpose: Claude CLI provider implementation with streaming support
    - Content: ClaudeCliAdapter class implementing EnhancedAIProvider
    - Estimated LOC: 250-300 lines
    - Dependencies: Node.js child_process, EnhancedAIProvider interface

11. **`libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.ts`** ← **NEW**

    - Purpose: VS Code LM API provider implementation
    - Content: VsCodeLmAdapter class implementing EnhancedAIProvider
    - Estimated LOC: 150-200 lines
    - Dependencies: VS Code LM API, EnhancedAIProvider interface

12. **`libs/backend/ai-providers-core/src/adapters/index.ts`** ← **NEW**

    - Purpose: Export adapter classes
    - Content: Re-export ClaudeCliAdapter and VsCodeLmAdapter
    - Estimated LOC: 3-5 lines

13. **`libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.spec.ts`**

    - Purpose: Unit tests for selection strategy
    - Content: Test scoring algorithm, task type matching, health prioritization
    - Estimated LOC: 150-200 lines

14. **`libs/backend/ai-providers-core/src/manager/provider-manager.spec.ts`**

    - Purpose: Unit tests for provider manager
    - Content: Test state management, EventBus integration, health monitoring
    - Estimated LOC: 200-250 lines

15. **`libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.spec.ts`** ← **NEW**

    - Purpose: Unit tests for Claude CLI adapter
    - Content: Test process spawning, streaming, session management, health checks
    - Estimated LOC: 200-250 lines

16. **`libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.spec.ts`** ← **NEW**

    - Purpose: Unit tests for VS Code LM adapter
    - Content: Test VS Code API integration, streaming, health checks
    - Estimated LOC: 150-200 lines

17. **`libs/backend/ai-providers-core/src/integration/provider-integration.spec.ts`** ← **NEW**
    - Purpose: Integration tests for end-to-end provider workflows
    - Content: Test provider registration, selection, failover, health monitoring
    - Estimated LOC: 200-250 lines

### Files to Modify

1. **`libs/backend/ai-providers-core/src/index.ts`**

   - Purpose: Export public API for ai-providers-core library
   - Scope: Add exports for interfaces, strategies, manager, **adapters**
   - Estimated LOC: +12 lines

   ```typescript
   // Export interfaces
   export * from './interfaces';

   // Export strategies
   export * from './strategies';

   // Export manager
   export * from './manager';

   // Export adapters ← NEW
   export * from './adapters';
   ```

2. **`libs/backend/vscode-core/src/di/tokens.ts`**

   - Purpose: Add PROVIDER_STRATEGY DI token
   - Scope: Add new token symbol and update TOKENS constant
   - Estimated LOC: +2 lines

   ```typescript
   export const PROVIDER_STRATEGY = Symbol('ProviderStrategy');

   export const TOKENS = {
     // ... existing tokens
     PROVIDER_STRATEGY,
   } as const;
   ```

## Integration Points

### Dependencies

**Internal**:

- `@ptah-extension/shared`: IAIProvider, ProviderHealth, ProviderId, MessagePayloadMap
- `@ptah-extension/vscode-core`: EventBus, TOKENS, DI container
- RxJS: BehaviorSubject, Observable, interval, filter
- TSyringe: @injectable, @inject decorators

**External**:

- None - all dependencies already installed and validated in Week 2-3

### Breaking Changes

- [x] None - backwards compatible
  - Extends existing IAIProvider interface without modification
  - New provider system is additive, doesn't change existing types
  - EventBus MessagePayloadMap already includes provider events

## Timeline & Scope

### Current Scope (This Task - TASK_PRV_001)

**Estimated Time**: 6-8 days (48-64 hours) - **CORRECTED FROM 3-4 DAYS**
**Core Deliverable**: Complete provider infrastructure + basic provider implementations (Claude CLI + VS Code LM adapters)
**Quality Threshold**: 80%+ test coverage, zero `any` types, EventBus integration verified, both adapters functional

**Breakdown**:

- Day 1-2 (10-12 hours): Phase 1 - Core interfaces (EnhancedAIProvider, ProviderContext, selection types)
- Day 2-3 (8-10 hours): Phase 2 - Selection strategy with Cline-style scoring algorithm
- Day 3-4 (10-12 hours): Phase 3 - Provider manager with RxJS state and EventBus integration
- Day 4-5 (8-12 hours): Phase 4 - Claude CLI adapter implementation with streaming
- Day 4-5 (6-8 hours): Phase 4.2 - VS Code LM adapter (basic implementation, can overlap with Task 4.1)
- Day 6-7 (10-14 hours): Phase 5 - Integration, exports, comprehensive unit tests, integration tests

**Total**: 52-68 hours across 6-8 days (well under 2-week limit)

### Scope Clarification

**What's INCLUDED in TASK_PRV_001** (Week 4 deliverables per MONSTER plan):

- ✅ Enhanced provider interfaces and contracts
- ✅ Intelligent provider selection strategy
- ✅ Provider manager with RxJS state management
- ✅ **Claude CLI adapter implementation** (with streaming, session management, health checks)
- ✅ **VS Code LM adapter implementation** (basic, with streaming and health checks)
- ✅ Comprehensive unit tests for all components
- ✅ Integration tests for end-to-end workflows

**What's DEFERRED to Future Tasks** (truly separate work, not part of Week 4):

- ❌ Week 5: Angular UI components for provider selection (TASK_PRV_002 already in registry)
- ❌ Week 6: Advanced load balancing and intelligent routing (optimization beyond basic selection)
- ❌ Week 6+: Cost optimization, budget tracking, performance dashboards (analytics features)

### Rationale for Revised Scope

**Why Provider Implementations Are Included**:

1. **MONSTER Plan Evidence**: Week 4 specification (lines 424-624) explicitly includes Claude CLI adapter code examples
2. **User Request Context**: "Week 4 Provider Core Infrastructure" refers to the complete Week 4 deliverable, not just interfaces
3. **Week 5 Focus**: MONSTER plan Week 5 is about Angular UI integration, NOT provider implementations
4. **Functional Completeness**: Infrastructure without providers is not usable - Week 4 delivers functional system
5. **Timeline Discipline**: 6-8 days < 2 weeks, includes provider implementations + testing

**Previous Error Analysis**:

- Architect incorrectly interpreted "infrastructure" as "interfaces only"
- Moved core provider implementations to registry as TASK_PRV_005-006 (registry pollution)
- Created unrealistic 3-4 day timeline that excluded essential components
- Ignored MONSTER plan's explicit Week 4 provider adapter code examples

## Risk Mitigation

### Technical Risks

**Risk**: Strategy scoring algorithm may not accurately predict best provider for complex tasks

- **Mitigation**: Start with simple weighted scoring (task type 50%, health 30%, complexity 20%), iterate based on usage patterns
- **Contingency**: Provide manual provider override option, log selection decisions for analysis

**Risk**: Health monitoring interval (30 seconds) may cause performance impact with many providers

- **Mitigation**: Use RxJS interval operator for efficient scheduling, debounce health checks
- **Contingency**: Make interval configurable, allow disabling for single-provider scenarios

**Risk**: Provider selection may take >100ms with complex scoring

- **Mitigation**: Cache provider scores for same context type, use early exit for obvious matches
- **Contingency**: Implement timeout with fallback to first available provider

### Performance Considerations

**Concern**: BehaviorSubject state emissions on every provider registration may cause unnecessary updates

- **Strategy**: Use distinctUntilChanged() operator to prevent duplicate state emissions
- **Measurement**: Unit tests verify state only emits when actual changes occur

**Concern**: Health monitoring every 30 seconds for multiple providers

- **Strategy**: Batch health checks using Promise.allSettled(), run in background
- **Measurement**: Integration tests validate non-blocking execution

## Testing Strategy

### Unit Tests Required

**`libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.spec.ts`**:

- ✅ Scores coding tasks higher for Claude Sonnet (>70 confidence)
- ✅ Scores reasoning tasks higher for DeepSeek R1 (>70 confidence)
- ✅ Scores debugging tasks appropriately
- ✅ Prioritizes healthy providers (available=30pts, degraded=10pts, error=0pts)
- ✅ Returns fallback providers in confidence order
- ✅ Generates human-readable reasoning strings
- Coverage target: 85%+

**`libs/backend/ai-providers-core/src/manager/provider-manager.spec.ts`**:

- ✅ Emits state on provider registration
- ✅ Publishes 'provider:registered' event to EventBus
- ✅ Publishes 'provider:switched' event on provider change
- ✅ Delegates selection to IntelligentProviderStrategy
- ✅ Health monitoring observable emits every 30 seconds
- ✅ Handles provider failures with EventBus 'provider:error' event
- ✅ Updates health status in state after monitoring
- Coverage target: 80%+

**`libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.spec.ts`** ← **NEW**:

- ✅ Spawns Claude CLI process with correct arguments
- ✅ Streams responses via AsyncIterable
- ✅ Handles session creation and cleanup
- ✅ Performs health checks and reports status
- ✅ Estimates cost and latency correctly
- ✅ Error handling for process failures
- Coverage target: 80%+

**`libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.spec.ts`** ← **NEW**:

- ✅ Integrates with VS Code LM API correctly
- ✅ Streams responses via AsyncIterable
- ✅ Handles stateless sessions
- ✅ Performs health checks
- ✅ Returns correct cost (0) and latency estimates
- Coverage target: 80%+

### Integration Tests Required

**`libs/backend/ai-providers-core/src/integration/provider-integration.spec.ts`** ← **NEW**:

- ✅ End-to-end provider registration → selection → message flow
- ✅ Provider failover on health check failure
- ✅ EventBus event emission throughout workflow
- ✅ State synchronization across manager and providers

---

## 🏗️ REVISED ARCHITECTURE PLAN COMPLETE - TASK_PRV_001

**User Request Addressed**: Week 4 Provider Core Infrastructure (complete deliverable per MONSTER plan)

**Research Integration**:

- ✅ MONSTER_EXTENSION_REFACTOR_PLAN Week 4 specification (lines 424-624) analyzed
- ✅ Week 4 includes both infrastructure AND provider implementations confirmed
- ✅ Week 5 focuses on Angular UI, NOT provider implementations
- ✅ Existing type system in @ptah-extension/shared leveraged
- ✅ Week 2-3 infrastructure (EventBus, DI) integration planned

**Timeline**: 6-8 days (52-68 hours) - under 2 weeks confirmed ✅

**Registry Updates**:

- ❌ REMOVED registry pollution (TASK_PRV_005-010 deleted)
- ✅ Confirmed existing future tasks (TASK_PRV_002, TASK_PRV_003) remain valid
- ✅ No new future tasks added (provider implementations ARE current scope)

**Implementation Strategy**:

- **Phase 1 (Day 1-2)**: Core interfaces - EnhancedAIProvider, ProviderContext, selection types
- **Phase 2 (Day 2-3)**: Selection strategy - Cline-style intelligent scoring algorithm
- **Phase 3 (Day 3-4)**: Provider manager - RxJS state + EventBus integration
- **Phase 4 (Day 4-5)**: Provider adapters - Claude CLI + VS Code LM implementations
- **Phase 5 (Day 6-7)**: Integration + comprehensive testing (≥80% coverage)

**Developer Assignment**: backend-developer

**Next Priority**: Phase 1 Task 1.1 - Enhanced Provider Interface

**Files Generated**:

- ✅ task-tracking/TASK_PRV_001/implementation-plan.md (REVISED - comprehensive, evidence-based)
- ✅ task-tracking/registry.md updated (TASK_PRV_005-010 removed)
- ✅ .github/chatmodes/software-architect.chatmode.md updated (scope discipline clarified)
- ✅ Clear developer handoff with 5 phases and 17 file deliverables

**Scope Validation**:

- ✅ Addresses user's actual Week 4 request (infrastructure + providers)
- ✅ Includes provider implementations (Claude CLI + VS Code LM) as core deliverables
- ✅ Timeline realistic at 6-8 days (well under 2 weeks)
- ✅ Truly future work correctly identified (Angular UI, advanced optimizations)
- ✅ Registry cleaned of pollution (provider implementations NOT separate tasks)

**Lessons Learned**:

1. **Read MONSTER plan specification carefully** - Week 4 explicitly includes provider implementations
2. **"Infrastructure" ≠ "interfaces only"** - Complete infrastructure includes working implementations
3. **Week boundaries matter** - Week 5 is Angular UI integration, NOT provider implementations
4. **Registry is for enhancements** - NOT for breaking down user's core request into pieces
5. **Scope discipline requires evidence** - Always validate against source documents before deferring work
