# Phase 3: Software Architect - Implementation Plan

## Architecture Overview

**Task**: Fix tsyringe DI issues with systematic service registration patterns  
**Root Cause**: EventBus interface mismatch and complex token mapping systems  
**Solution**: Simplify DI patterns using tsyringe v4.10.0 best practices

---

## 🏗️ Current Architecture Analysis

### Problematic Pattern (Current)

```typescript
// Problem 1: Multiple EventBus interfaces
// vscode-core/EventBus (RxJS-based)
class EventBus { subscribe<T>(): Observable<T> }

// claude-domain/IEventBus (different signature)
interface IEventBus { subscribe<T>(): { subscribe(handler) => Subscription } }

// Problem 2: Complex token mapping with adapters
const eventBusAdapter: DI_IEventBus = {
  subscribe: (messageType) => eventBus.subscribe(messageType), // Wrong!
  publish: (topic, payload) => eventBus.publish(topic, payload)
};

// Problem 3: ProviderManager gets adapter instead of real EventBus
@injectable()
class ProviderManager {
  constructor(@inject(TOKENS.EVENT_BUS) private eventBus: EventBus) {
    // eventBus is actually the adapter, not real EventBus!
    this.eventBus.subscribe('providers:error').subscribe() // FAILS
  }
}
```

### Target Architecture (Fixed)

```typescript
// Solution 1: Single EventBus interface (eliminate duplication)
// Use vscode-core EventBus everywhere, no adapters needed

// Solution 2: Direct service registration (no complex mapping)
container.registerSingleton(TOKENS.EVENT_BUS, EventBus);
container.registerSingleton(TOKENS.PROVIDER_MANAGER, ProviderManager);

// Solution 3: Consistent injection patterns
@injectable()
class ProviderManager {
  constructor(
    @inject(TOKENS.EVENT_BUS) private eventBus: EventBus, // Real EventBus
    @inject(TOKENS.INTELLIGENT_PROVIDER_STRATEGY) private strategy: IntelligentProviderStrategy
  ) {}
}
```

---

## 🔧 Implementation Strategy

### Phase 3A: Interface Standardization (4 hours)

**Goal**: Eliminate duplicate EventBus interfaces and use single source of truth

#### Files to Modify

1. **libs/backend/claude-domain/src/messaging/message-handler.service.ts**

   - Remove `IEventBus` interface (lines 50-60)
   - Import `EventBus` from vscode-core instead
   - Update constructor injection to use real EventBus

2. **libs/backend/claude-domain/src/di/register.ts**

   - Remove `IEventBus` interface duplication
   - Update registration to use vscode-core EventBus token

3. **apps/ptah-extension-vscode/src/main.ts**
   - Remove `DI_IEventBus` adapter creation (lines 103-110)
   - Direct registration of services without adapters

#### Implementation Steps

```typescript
// Step 1: Update claude-domain to use vscode-core EventBus
import { EventBus } from '@ptah-extension/vscode-core';

@injectable()
export class MessageHandlerService {
  constructor(
    @inject(EVENT_BUS) private readonly eventBus: EventBus,
    // ... other dependencies
  ) {}
}

// Step 2: Remove adapter pattern from main.ts
// OLD (problematic):
const eventBusAdapter: DI_IEventBus = { ... };
registerClaudeDomainServices(container, { eventBus: eventBusAdapter });

// NEW (direct):
registerClaudeDomainServices(container, { eventBus: TOKENS.EVENT_BUS });
```

### Phase 3B: Registration Simplification (4 hours)

**Goal**: Simplify service registration using tsyringe best practices

#### Key Changes

1. **Bootstrap Function Pattern** (per library)

```typescript
// Each library provides one bootstrap function
export function registerAIProviderServices(container: DependencyContainer, tokens: { EVENT_BUS: symbol; PROVIDER_MANAGER: symbol }): void {
  // Register strategies first (no dependencies)
  container.registerSingleton(tokens.INTELLIGENT_PROVIDER_STRATEGY, IntelligentProviderStrategy);

  // Register manager with factory for complex dependencies
  container.register(tokens.PROVIDER_MANAGER, {
    useFactory: (c) => new ProviderManager(c.resolve(tokens.EVENT_BUS), c.resolve(tokens.INTELLIGENT_PROVIDER_STRATEGY)),
  });
}
```

2. **Token Mapping Elimination**

```typescript
// OLD (complex mapping):
const aiProviderTokens: AIProviderTokens = {
  PROVIDER_MANAGER: CLAUDE_PROVIDER_MANAGER,
  EVENT_BUS: TOKENS.EVENT_BUS,
  // ... 6 more mappings
};

// NEW (direct reference):
registerAIProviderServices(container, {
  EVENT_BUS: TOKENS.EVENT_BUS,
  PROVIDER_MANAGER: TOKENS.PROVIDER_MANAGER,
});
```

3. **Dependency Order Management**

```typescript
// Main app registration order (apps/ptah-extension-vscode/src/main.ts)
export async function activate(context: vscode.ExtensionContext) {
  // 1. Setup infrastructure container
  const container = DIContainer.setup(context);

  // 2. Register domain libraries in dependency order
  registerWorkspaceIntelligenceServices(container);
  registerAIProviderServices(container);
  registerClaudeDomainServices(container);

  // 3. Initialize services
  const messageHandler = container.resolve(TOKENS.MESSAGE_HANDLER);
  messageHandler.initialize();
}
```

### Phase 3C: Type Safety Enforcement (2 hours)

**Goal**: Ensure all DI registrations use proper TypeScript types

#### Type Safety Patterns

```typescript
// 1. Generic container methods with type safety
class DIContainer {
  static registerSingleton<T>(token: symbol, target: new (...args: any[]) => T): void {
    container.registerSingleton<T>(token, target);
  }

  static resolve<T>(token: symbol): T {
    return container.resolve<T>(token);
  }
}

// 2. Service interfaces for complex dependencies
interface IProviderManager {
  selectBestProvider(context: ProviderContext): Promise<ProviderSelectionResult>;
  getCurrentProvider(): EnhancedAIProvider | null;
}

// 3. Token-to-Type mapping for compile-time safety
declare module '@ptah-extension/vscode-core' {
  interface TokenMap {
    [TOKENS.EVENT_BUS]: EventBus;
    [TOKENS.PROVIDER_MANAGER]: IProviderManager;
    [TOKENS.MESSAGE_HANDLER]: MessageHandlerService;
  }
}
```

---

## 📁 File Changes Plan

### Critical Files (High Priority)

1. **apps/ptah-extension-vscode/src/main.ts** - Main registration orchestration

   - Remove DI_IEventBus adapter (lines 103-110)
   - Simplify service registration calls
   - Fix dependency order

2. **libs/backend/ai-providers-core/src/manager/provider-manager.ts** - Fix injection

   - Verify EventBus injection uses correct token
   - Test subscription methods work correctly

3. **libs/backend/claude-domain/src/messaging/message-handler.service.ts** - Interface fix

   - Remove IEventBus interface duplication
   - Import EventBus from vscode-core
   - Update constructor injection

4. **libs/backend/ai-providers-core/src/di/register.ts** - Registration fix
   - Simplify token mapping interface
   - Use factory pattern for ProviderManager
   - Ensure EventBus token is correctly passed

### Supporting Files (Medium Priority)

5. **libs/backend/claude-domain/src/di/register.ts** - Bootstrap function

   - Remove IEventBus interface
   - Update registration pattern
   - Ensure consistent token usage

6. **libs/backend/vscode-core/src/di/container.ts** - Container setup
   - Verify EventBus registration is correct
   - Ensure no circular dependencies

### Test Files (Lower Priority)

7. **libs/backend/ai-providers-core/src/**/\*.spec.ts\*\* - Update mocks
8. **libs/backend/claude-domain/src/**/\*.spec.ts\*\* - Update interfaces

---

## 🔄 Integration Points

### EventBus Service (Central Hub)

- **Location**: `libs/backend/vscode-core/src/messaging/event-bus.ts`
- **Consumers**: ProviderManager, MessageHandlerService, all orchestration services
- **Registration**: Single registration as singleton in DIContainer.setup()

### ProviderManager Service (Core AI Service)

- **Location**: `libs/backend/ai-providers-core/src/manager/provider-manager.ts`
- **Dependencies**: EventBus, IntelligentProviderStrategy
- **Registration**: Factory pattern in ai-providers-core bootstrap

### MessageHandlerService (Router)

- **Location**: `libs/backend/claude-domain/src/messaging/message-handler.service.ts`
- **Dependencies**: EventBus, 5 orchestration services
- **Registration**: Singleton in claude-domain bootstrap

---

## 🧪 Testing Strategy

### Unit Tests

- Mock EventBus interface consistently across all tests
- Verify service resolution doesn't throw DI errors
- Test factory registrations work correctly

### Integration Tests

- Test full DI container setup from main.ts
- Verify EventBus methods work across all consumers
- Test service initialization order

### Manual Testing

- Extension activation without errors (F5 launch)
- Verify all features work: chat, provider selection, context
- Performance check: activation time < 500ms

---

## ⚡ Performance Considerations

### Registration Performance

- Use registerSingleton for stateless services
- Use factory pattern only for complex dependencies
- Avoid registerInstance for large objects

### Memory Management

- Ensure all services implement dispose() correctly
- Container.clearInstances() for testing cleanup
- No memory leaks from event subscriptions

### Startup Performance

- Lazy initialization where possible
- EventBus registration before dependent services
- Minimize factory function complexity

---

## 🚨 Risk Mitigation

### Breaking Changes Risk

- **Risk**: Changing EventBus interface breaks existing code
- **Mitigation**: Update all consumers in same commit
- **Rollback**: Git rollback preserves working state

### Circular Dependencies Risk

- **Risk**: Library cross-references create circular imports
- **Mitigation**: Use tsyringe delay() helper where needed
- **Detection**: Build errors will catch immediately

### Type Safety Risk

- **Risk**: Runtime errors from incorrect type assumptions
- **Mitigation**: Comprehensive TypeScript strict mode
- **Testing**: Unit tests verify all injections

---

## 📊 Success Criteria

### Technical Success

- [ ] Extension activates without DI errors
- [ ] All services resolve with correct dependencies
- [ ] TypeScript compilation passes with strict mode
- [ ] All existing tests pass
- [ ] No performance regression

### Code Quality Success

- [ ] DI configuration code reduced by 50%
- [ ] Zero interface duplications
- [ ] Single EventBus source of truth
- [ ] Consistent registration patterns across libraries

### Business Success

- [ ] All AI features work correctly (chat, providers, context)
- [ ] Extension is production-ready
- [ ] Developer experience improved for future changes

---

## 🎯 Implementation Timeline

### Day 1 (8 hours)

- **Morning (4h)**: Phase 3A - Interface standardization
- **Afternoon (4h)**: Phase 3B - Registration simplification

### Day 2 (6 hours)

- **Morning (2h)**: Phase 3C - Type safety enforcement
- **Afternoon (4h)**: Testing and validation

**Total Estimated**: 14 hours over 2 days  
**Confidence**: High (90%) - Clear plan, well-understood problem

---

## ✅ Phase 3 Deliverables

### Architecture Artifacts

- [x] Current vs target architecture analysis
- [x] File-by-file change plan with specific line numbers
- [x] Implementation strategy with 3 clear phases
- [x] Integration points and dependency mapping
- [x] Risk assessment and mitigation strategies

### Ready for Implementation

This implementation plan provides a clear roadmap for fixing the tsyringe DI issues systematically without breaking existing functionality.

**Next Phase**: Phase 4 (Implementation) - Backend Developer execution
