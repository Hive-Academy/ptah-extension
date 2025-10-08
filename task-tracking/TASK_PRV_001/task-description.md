# Task Description - TASK_PRV_001

## User Request

Week 4 Provider Core Infrastructure

## SMART Requirements

- **Specific**: Implement the Provider Core Infrastructure from Week 4 of the MONSTER_EXTENSION_REFACTOR_PLAN, focusing on enhanced provider interfaces, intelligent provider selection strategies, and factory patterns for multi-provider AI management
- **Measurable**: Successfully create core provider infrastructure with EnhancedAIProvider interface, IntelligentProviderStrategy, and provider manager that can handle multiple AI providers (Claude CLI, VS Code LM) with measurable selection confidence scores
- **Achievable**: Build on existing `libs/shared/src/lib/types/ai-provider.types.ts` foundation and Week 2-3 DI/messaging infrastructure; library structure already exists at `libs/backend/ai-providers-core/`
- **Relevant**: Critical foundation for multi-provider support, enabling Cline-style intelligent model selection based on task type, complexity, and provider capabilities
- **Time-bound**: 3-4 days implementation following the MONSTER plan specification

## Acceptance Criteria (BDD Format)

### Scenario 1: Enhanced Provider Interface with Context-Aware Capabilities

**Given** the existing `IAIProvider` interface in `libs/shared/src/lib/types/ai-provider.types.ts`
**When** the `EnhancedAIProvider` interface is implemented in `libs/backend/ai-providers-core/src/interfaces/provider.interface.ts`
**Then** it extends the base interface with:

- `canHandle(context: ProviderContext)` method for task-specific matching
- `estimateCost(context: ProviderContext)` for cost prediction
- `estimateLatency(context: ProviderContext)` for performance estimation
- `createSession(config: AISessionConfig)` for session initialization
- `sendMessage()` with `AsyncIterable<string>` streaming support
- `performHealthCheck()` for provider availability monitoring

### Scenario 2: Intelligent Provider Selection Strategy

**Given** multiple AI providers registered with different capabilities
**When** `IntelligentProviderStrategy.selectProvider()` is called with a `ProviderContext`
**Then** the strategy:

- Scores providers based on task type matching (coding, reasoning, analysis, debugging, refactoring)
- Considers complexity level (low, medium, high) in selection
- Evaluates provider health status and response times
- Returns `ProviderSelectionResult` with confidence score, reasoning, and fallback options
- Implements Cline-style specialization (e.g., DeepSeek R1 for reasoning, Claude Sonnet for coding)

### Scenario 3: Provider Manager with RxJS State Management

**Given** the EventBus and DI container from Week 2 infrastructure
**When** `ProviderManager` is implemented with RxJS `BehaviorSubject`
**Then** it provides:

- `state$` observable for reactive provider state tracking
- `registerProvider()` for adding new providers to the system
- `selectBestProvider()` that delegates to `IntelligentProviderStrategy`
- Automatic health monitoring every 30 seconds with `interval()` operator
- Provider switch event emission through EventBus
- Fallback handling when current provider fails

### Scenario 4: Type-Safe Provider Context System

**Given** VS Code workspace and active editor context
**When** creating a `ProviderContext` for AI operations
**Then** it captures:

- Task type classification (coding, reasoning, analysis, refactoring, debugging)
- Complexity assessment (low, medium, high)
- File types array for specialization matching
- Project type detection (optional)
- Context size for cost/latency estimation

### Scenario 5: Factory Pattern Integration with DI

**Given** the TSyringe DI container from Week 2
**When** providers are registered and resolved through dependency injection
**Then**:

- Provider interfaces use `@injectable()` decorator
- Dependencies injected via `@inject(TOKENS.X)` pattern
- EventBus integration for provider events
- Proper lifecycle management with `dispose()` methods
- New tokens added to `libs/backend/vscode-core/src/di/tokens.ts`

## Success Metrics

- Enhanced provider interface extends existing types without breaking changes
- Intelligent selection strategy scores providers with 0-100 confidence scores
- Provider manager state observable emits on every provider state change
- Health monitoring runs automatically and detects provider failures
- Zero `any` types - all provider operations use strict TypeScript types from `@ptah-extension/shared`
- Integration with Week 2 EventBus for all provider events
- Providers can be instantiated and managed through DI container

## Implementation Scope

**Files to Create**:

- `libs/backend/ai-providers-core/src/interfaces/provider.interface.ts` - Enhanced provider contracts
- `libs/backend/ai-providers-core/src/interfaces/provider-context.interface.ts` - Context types
- `libs/backend/ai-providers-core/src/strategies/intelligent-provider-strategy.ts` - Selection logic
- `libs/backend/ai-providers-core/src/manager/provider-manager.ts` - Multi-provider orchestration
- `libs/backend/ai-providers-core/src/manager/provider-state.types.ts` - State management types
- `libs/backend/ai-providers-core/src/interfaces/index.ts` - Interface exports
- `libs/backend/ai-providers-core/src/strategies/index.ts` - Strategy exports
- `libs/backend/ai-providers-core/src/manager/index.ts` - Manager exports
- Unit tests for all core components

**Files to Modify**:

- `libs/backend/ai-providers-core/src/index.ts` - Export all new interfaces and classes
- `libs/backend/vscode-core/src/di/tokens.ts` - Add provider-specific DI tokens
- `libs/backend/vscode-core/src/di/container.ts` - Register provider infrastructure (optional, may defer to Week 5)

**Dependencies**:

- Week 2: TSyringe DI container, RxJS EventBus, DI tokens system ✅
- Week 3: VS Code API wrappers (OutputManager, StatusBarManager, FileSystemManager) ✅
- `@ptah-extension/shared` types: `IAIProvider`, `ProviderCapabilities`, `ProviderHealth` ✅
- RxJS: `BehaviorSubject`, `Observable`, `interval`, `filter` ✅
- TSyringe: `@injectable()`, `@inject()` decorators ✅

**Timeline Estimate**: 3-4 days
**Complexity**: Medium-High - Core infrastructure with multiple interacting components, but clear MONSTER plan specification provides architectural guidance

## Dependencies & Constraints

**Technical Constraints**:

- Must preserve and extend existing `libs/shared/src/lib/types/ai-provider.types.ts` without breaking changes
- Must integrate with Week 2 EventBus and DI container patterns
- Must maintain strict TypeScript typing with zero `any` types
- Must support streaming responses via `AsyncIterable<string>` pattern
- Health monitoring must be non-blocking and run in background
- Provider selection must complete within reasonable time (<100ms)

**Prerequisites**:

- TASK_CMD_002 (Week 2) completed: DI container and EventBus operational ✅
- TASK_CMD_003 (Week 3) completed: VS Code API wrappers available ✅
- RxJS installed and configured for reactive programming ✅
- TSyringe DI system functional ✅
- Shared types library with provider interfaces ✅

**Integration Points**:

- EventBus for provider lifecycle events (`provider:registered`, `provider:switched`, `provider:error`, `provider:failover`)
- DI container for provider resolution and dependency injection
- Shared types for provider contracts and capabilities
- Future Week 5: Claude domain implementation will use these interfaces
- Future Week 6: Angular UI will consume provider state via observables

**Deferred Work** (to be tracked in registry for future tasks):

- Actual provider implementations (Claude CLI adapter, VS Code LM adapter) - Week 5
- Angular UI components for provider selection and health monitoring - Week 5
- Advanced features: load balancing, intelligent routing, cost optimization - Week 6
- Performance monitoring and analytics integration - Week 6+

## Risk Assessment

**Technical Risks**:

- **Complexity Risk (Medium)**: Multiple interacting components (interfaces, strategies, manager) require careful coordination
  - _Mitigation_: Follow MONSTER plan architecture exactly, build incrementally with tests
- **Integration Risk (Low)**: RxJS and TSyringe integration already proven in Week 2-3
  - _Mitigation_: Reuse established patterns from CommandManager and WebviewManager
- **Scope Creep Risk (Medium)**: Week 4 spec includes extensive code examples that could expand scope
  - _Mitigation_: Focus on core infrastructure only, defer provider implementations to Week 5

**Scope Risks**:

- **Timeline Risk (Low-Medium)**: 3-4 day estimate depends on clear separation from Week 5 implementation
  - _Mitigation_: Create interfaces and infrastructure only, stub out actual providers
- **Over-Engineering Risk (Medium)**: MONSTER plan includes advanced features like cost estimation and load balancing
  - _Mitigation_: Implement basic infrastructure now, add advanced features in Week 6

**Dependency Risks**:

- **External Dependency Risk (None)**: All required dependencies already installed
- **Version Compatibility Risk (Low)**: RxJS and TSyringe versions already validated in Week 2-3

## Next Phase Recommendation

**Recommendation**: ✅ **software-architect**

**Rationale**:

- Requirements are well-defined based on MONSTER_EXTENSION_REFACTOR_PLAN Week 4 specification
- Clear architectural patterns established in the refactor plan
- No research needed - provider infrastructure patterns are industry-standard (factory, strategy, manager)
- Week 2-3 foundation provides proven DI and messaging patterns to follow
- Focus on infrastructure design before implementation

**Key Context for Next Agent**:

- Week 4 builds on Week 2-3 DI/EventBus/VS Code API wrappers foundation
- Core focus: interfaces, selection strategy, and manager infrastructure
- Actual provider implementations (Claude CLI, VS Code LM adapters) deferred to Week 5
- Architecture must support future Angular UI integration (Week 5 webview)
- Provider selection logic should mirror Cline's intelligent model routing
- All components must be testable in isolation with proper DI

**Architecture Priorities**:

1. **Enhanced Provider Interface**: Extend existing types with context-aware methods
2. **Selection Strategy**: Implement scoring algorithm for provider selection
3. **Provider Manager**: RxJS-based state management with EventBus integration
4. **Type Safety**: Zero `any` types, full TypeScript strict mode compliance
5. **Testing**: Unit tests for strategy scoring and manager state transitions
