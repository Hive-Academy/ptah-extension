# Dependency Injection Framework Research for VS Code Extensions

**Research Date**: October 9, 2025  
**Context**: Evaluating mature DI frameworks (NestJS or alternatives) for Ptah VS Code extension  
**Current State**: Using TSyringe (lightweight DI container)

---

## Executive Summary

### Key Findings

✅ **NestJS CAN be used for VS Code extensions** via standalone application mode  
✅ **Several mature DI frameworks** exist with different trade-offs  
⚠️ **Significant architectural change** required - not a drop-in replacement  
🎯 **Recommendation**: Hybrid approach - TSyringe + strategic NestJS patterns

---

## Research Question

> "Can we use NestJS or similar framework to enforce DI patterns by design for our VS Code extension, even though NestJS is primarily for web servers?"

**Short Answer**: YES, but with caveats.

---

## Option 1: NestJS Standalone Applications

### How It Works

NestJS provides `NestFactory.createApplicationContext()` for non-HTTP use cases:

```typescript
// No HTTP server - pure IoC container
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  // Resolve services
  const myService = app.get(MyService);

  // Run logic
  await myService.doSomething();

  // Cleanup
  await app.close();
}
```

### Official Use Cases

Per NestJS documentation (<https://docs.nestjs.com/standalone-applications>):

- **CLI tools** - `@nestjs/cli` itself uses this pattern
- **CRON jobs** - Scheduled task runners
- **Background workers** - Queue processors
- **Script automation** - One-off utilities

**VS Code Extension** = Another valid use case (event-driven, non-HTTP)

### Benefits for VS Code Extensions

#### 1. **Module System**

```typescript
@Module({
  imports: [WorkspaceIntelligenceModule, ClaudeDomainModule],
  providers: [ExtensionService],
  exports: [ExtensionService],
})
export class PtahExtensionModule {}
```

- **Explicit dependencies** between modules
- **Clear boundaries** - no accidental cross-module coupling
- **Lazy loading** - only initialize what's needed

#### 2. **Decorator-Based DI (Enforced by Design)**

```typescript
@Injectable()
export class TokenCounterService {
  constructor(@Inject(VSCODE_CONTEXT) private context: vscode.ExtensionContext, private fileSystem: FileSystemService) {}
}
```

- **Compile-time validation** - missing dependencies = TypeScript error
- **No manual registration** - decorators handle it
- **Scoped services** - Singleton, Transient, Request-scoped

#### 3. **Advanced Features**

- **Lifecycle Hooks**: `onModuleInit()`, `onModuleDestroy()`, `beforeApplicationShutdown()`
- **Dynamic Modules**: Configuration-driven module initialization
- **Interceptors**: Aspect-oriented programming (logging, caching, error handling)
- **Guards**: Authorization/authentication patterns
- **Event Emitter**: Built-in `@nestjs/event-emitter` for pub/sub

#### 4. **Testing Infrastructure**

```typescript
const module = await Test.createTestingModule({
  providers: [TokenCounterService],
}).compile();

const service = module.get<TokenCounterService>(TokenCounterService);
```

- **Mocking made easy** - override providers in tests
- **Isolated unit tests** - no need for full DI container

### Challenges for VS Code Extensions

#### 1. **Bundle Size**

- **NestJS Core**: ~500KB minified (includes Express/Fastify adapters we don't need)
- **VS Code Extension Constraint**: Ideally <2MB total bundle
- **Mitigation**: Tree-shaking with proper imports

#### 2. **Activation Latency**

- **NestJS Bootstrap**: ~100-300ms for `createApplicationContext()`
- **VS Code Activation**: Target <200ms for good UX
- **Mitigation**: Lazy module loading, critical services first

#### 3. **Learning Curve**

- Team must learn NestJS patterns (modules, providers, decorators)
- More complex than TSyringe's simple container

#### 4. **HTTP-Centric Documentation**

- Most NestJS examples assume HTTP context
- Standalone app docs are minimal
- Need to adapt patterns creatively

### Integration with VS Code

```typescript
// apps/ptah-extension-vscode/src/main.ts
import { NestFactory } from '@nestjs/core';
import { PtahExtensionModule } from './ptah-extension.module';

export async function activate(context: vscode.ExtensionContext) {
  // Bootstrap NestJS standalone app
  const app = await NestFactory.createApplicationContext(PtahExtensionModule, {
    logger: new VsCodeLogger(), // Custom logger using VS Code output channels
  });

  // Inject VS Code context as a provider
  app.get(VSCODE_CONTEXT_TOKEN, { strict: false })?.setContext(context);

  // Get main extension service
  const extensionService = app.get(ExtensionService);
  await extensionService.initialize();

  // Register disposal
  context.subscriptions.push({
    dispose: () => app.close(),
  });
}
```

### Real-World Evidence

**@nestjs/cli** - NestJS's own CLI tool:

- Uses standalone application mode
- No HTTP server
- Demonstrates feasibility

**No public VS Code extensions found using NestJS** (searched GitHub, npm)

- Untested in production for this use case
- We'd be pioneers (risk + reward)

---

## Option 2: InversifyJS

### Overview

InversifyJS is a **lightweight, TypeScript-native DI container** inspired by Java's Ninject.

### Key Features

```typescript
// Container setup
const container = new Container();
container.bind<FileSystemService>(TYPES.FileSystem).to(FileSystemService).inSingletonScope();

// Constructor injection
@injectable()
class TokenCounterService {
  constructor(@inject(TYPES.FileSystem) private fileSystem: FileSystemService) {}
}

// Resolve
const service = container.get<TokenCounterService>(TYPES.TokenCounter);
```

### Advantages

- **Smaller bundle**: ~50KB minified (10x smaller than NestJS)
- **Faster activation**: <10ms bootstrap time
- **Flexible scoping**: Singleton, Transient, Request-scoped
- **Multi-injection**: Inject arrays of services
- **Middleware**: Intercept service creation
- **No framework lock-in**: Pure DI, no module system

### Disadvantages

- **No module system** - must manage dependencies manually
- **No lifecycle hooks** - implement your own
- **No event bus** - use separate library (EventEmitter3)
- **Less opinionated** - more boilerplate code

### Best For

- Teams wanting **enforced DI** without full framework
- Extensions prioritizing **small bundle size**
- Projects needing **maximum flexibility**

---

## Option 3: Awilix

### Overview

Awilix is a **minimalist DI container** for Node.js with functional API.

### Key Features

```typescript
import { createContainer, asClass, asValue } from 'awilix';

const container = createContainer();

container.register({
  fileSystem: asClass(FileSystemService).singleton(),
  tokenCounter: asClass(TokenCounterService).singleton(),
  context: asValue(vscodeContext),
});

// Resolve
const tokenCounter = container.resolve('tokenCounter');
```

### Advantages

- **Tiny bundle**: ~15KB minified
- **Auto-wiring**: Automatically resolves constructor dependencies
- **Lifetime management**: Singleton, Scoped, Transient
- **Flexible registration**: Classes, functions, values
- **Proxy-based resolution**: Lazy loading by default

### Disadvantages

- **No TypeScript decorators** - uses class names for resolution
- **Runtime reflection** - requires `tsconfig` preservation
- **No compile-time safety** - errors at runtime
- **Less mature ecosystem**

### Best For

- **Minimalist projects** prioritizing bundle size
- Teams comfortable with **runtime DI**
- Projects using **functional programming** patterns

---

## Option 4: Stay with TSyringe (Enhanced)

### Current State

We're already using TSyringe with manual registration:

```typescript
// libs/backend/vscode-core/src/di/container.ts
container.registerSingleton(TOKENS.TOKEN_COUNTER_SERVICE, TokenCounterService);
container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemService);
```

### Enhancement Strategy: Adopt NestJS Patterns WITHOUT NestJS

#### 1. **Module Pattern**

```typescript
// libs/backend/workspace-intelligence/src/workspace-intelligence.module.ts
export class WorkspaceIntelligenceModule {
  static register(container: DependencyContainer): void {
    // Register types
    container.registerSingleton(TOKENS.TOKEN_COUNTER_SERVICE, TokenCounterService);
    container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemService);
    container.registerSingleton(TOKENS.PROJECT_DETECTOR_SERVICE, ProjectDetectorService);

    // Register with dependencies
    container.register(TOKENS.WORKSPACE_ANALYZER_SERVICE, {
      useFactory: (c) => new WorkspaceAnalyzerService(c.resolve(TOKENS.TOKEN_COUNTER_SERVICE), c.resolve(TOKENS.FILE_SYSTEM_SERVICE), c.resolve(TOKENS.PROJECT_DETECTOR_SERVICE)),
    });
  }
}
```

#### 2. **Lifecycle Hooks Interface**

```typescript
export interface OnModuleInit {
  onModuleInit(): Promise<void> | void;
}

export interface OnModuleDestroy {
  onModuleDestroy(): Promise<void> | void;
}

@injectable()
export class TokenCounterService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    // Initialization logic
  }

  async onModuleDestroy() {
    this.clearCache();
  }
}
```

#### 3. **Centralized Module Registration**

```typescript
// libs/backend/vscode-core/src/di/container.ts
export class DIContainer {
  static async setup(context: vscode.ExtensionContext): Promise<DependencyContainer> {
    // Register VS Code context
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

    // Register modules
    await VsCodeCoreModule.register(container);
    await ClaudeDomainModule.register(container);
    await WorkspaceIntelligenceModule.register(container);

    // Initialize all services with lifecycle hooks
    await this.initializeAll(container);

    return container;
  }

  private static async initializeAll(container: DependencyContainer): Promise<void> {
    const services = this.getAllServices(container);

    for (const service of services) {
      if ('onModuleInit' in service) {
        await service.onModuleInit();
      }
    }
  }
}
```

#### 4. **Event Bus (Already Have with RxJS)**

```typescript
// Current implementation in vscode-core
export class EventBus {
  private subjects = new Map<string, Subject<any>>();

  publish<T>(topic: string, payload: T): void {
    this.getSubject(topic).next(payload);
  }

  subscribe<T>(topic: string): Observable<T> {
    return this.getSubject(topic).asObservable();
  }
}
```

### Benefits of Enhanced TSyringe

✅ **Keep small bundle** (~30KB vs. 500KB)  
✅ **Keep fast activation** (<10ms vs. 100-300ms)  
✅ **Adopt NestJS organizational patterns**  
✅ **No migration required** - incremental enhancement  
✅ **Team already familiar** with current approach

### What We Gain

- **Module system** for organization
- **Lifecycle hooks** for initialization/cleanup
- **Centralized registration** reduces errors
- **Better testability** with module-based mocking

### What We Miss (vs. Full NestJS)

- **No compile-time DI validation** (still runtime errors possible)
- **No interceptors/guards** (implement manually if needed)
- **No dynamic modules** (implement factory pattern instead)
- **Less mature testing infrastructure**

---

## Comparison Matrix

| Feature                 | NestJS         | InversifyJS    | Awilix         | TSyringe Enhanced |
| ----------------------- | -------------- | -------------- | -------------- | ----------------- |
| **Bundle Size**         | ~500KB         | ~50KB          | ~15KB          | ~30KB             |
| **Activation Time**     | 100-300ms      | <10ms          | <5ms           | <10ms             |
| **Module System**       | ✅ Built-in    | ❌ Manual      | ❌ Manual      | ✅ Custom         |
| **Lifecycle Hooks**     | ✅ Built-in    | ❌ Manual      | ❌ Manual      | ✅ Custom         |
| **Decorators**          | ✅ @Injectable | ✅ @injectable | ❌ None        | ✅ @injectable    |
| **Compile-time Safety** | ✅ Full        | ✅ Full        | ⚠️ Partial     | ✅ Full           |
| **Event Bus**           | ✅ Built-in    | ❌ External    | ❌ External    | ✅ Have RxJS      |
| **Testing Support**     | ✅ Excellent   | ✅ Good        | ⚠️ Basic       | ✅ Good           |
| **Learning Curve**      | ⚠️ Steep       | ⚠️ Moderate    | ✅ Low         | ✅ Low            |
| **VS Code Proven**      | ❌ No examples | ❌ No examples | ❌ No examples | ✅ Current use    |
| **Interceptors/Guards** | ✅ Built-in    | ⚠️ Middleware  | ❌ None        | ⚠️ Custom         |
| **Community/Ecosystem** | ✅ Excellent   | ✅ Good        | ⚠️ Small       | ✅ Good           |

---

## 🎯 Recommendation: Hybrid Approach

### Phase 1: Enhance TSyringe (2-3 days)

**Immediate implementation**:

1. **Module Pattern** - Create `*.module.ts` files for each library
2. **Lifecycle Hooks** - Add `OnModuleInit`, `OnModuleDestroy` interfaces
3. **Centralized Registration** - Update `DIContainer.setup()` to register modules
4. **Documentation** - Codify patterns in contribution guide

**Benefits**:

- ✅ No bundle size increase
- ✅ No activation delay
- ✅ Better organization immediately
- ✅ Team learns patterns incrementally

### Phase 2: Evaluate NestJS for Specific Modules (Future)

**Selective adoption**:

- **Use NestJS for**: Background services, scheduled tasks, worker modules
- **Keep TSyringe for**: Core extension, UI-facing services, critical path
- **Mix and match**: NestJS modules can coexist with TSyringe services

**Example**:

```typescript
// NestJS for background analysis
@Module({
  providers: [SemanticAnalysisService, CodeIndexer],
})
export class AnalysisModule {}

// TSyringe for UI-facing services
container.registerSingleton(TOKENS.WEBVIEW_PROVIDER, WebviewManager);
```

---

## Implementation Plan

### Option A: Enhanced TSyringe (Recommended)

**Week 1: Module System**

- [ ] Create base `Module` interface
- [ ] Implement `WorkspaceIntelligenceModule.register()`
- [ ] Implement `ClaudeDomainModule.register()`
- [ ] Update `DIContainer.setup()` to call module registrations

**Week 2: Lifecycle Hooks**

- [ ] Define `OnModuleInit`, `OnModuleDestroy`, `OnApplicationBootstrap` interfaces
- [ ] Implement lifecycle management in `DIContainer`
- [ ] Migrate existing services to use lifecycle hooks
- [ ] Add lifecycle hook tests

**Week 3: Documentation & Validation**

- [ ] Document module pattern in AGENTS.md
- [ ] Add module creation examples
- [ ] Validate with code review
- [ ] Measure activation time impact

### Option B: Full NestJS Migration

**Month 1: Foundation**

- [ ] Add NestJS dependencies (~500KB impact)
- [ ] Create `PtahExtensionModule` as root
- [ ] Migrate core services to NestJS providers
- [ ] Implement VS Code context injection

**Month 2: Module Migration**

- [ ] Convert `workspace-intelligence` to NestJS module
- [ ] Convert `claude-domain` to NestJS module
- [ ] Implement custom logger for VS Code
- [ ] Add lifecycle hooks

**Month 3: Advanced Features**

- [ ] Add interceptors for logging/caching
- [ ] Implement guards for permission handling
- [ ] Set up NestJS testing infrastructure
- [ ] Performance tuning

---

## Risks & Mitigations

### Risk 1: Bundle Size Increase

- **Impact**: Slower extension load times
- **Mitigation**: Tree-shaking, lazy loading, code splitting
- **Acceptance**: Only if <100KB increase

### Risk 2: Activation Latency

- **Impact**: Poor user experience
- **Mitigation**: Defer non-critical module initialization
- **Acceptance**: Max 50ms activation time increase

### Risk 3: Team Learning Curve

- **Impact**: Slower development initially
- **Mitigation**: Phased rollout, comprehensive documentation
- **Acceptance**: 1-2 week onboarding period

### Risk 4: Over-Engineering

- **Impact**: Complexity without benefit
- **Mitigation**: Start with enhanced TSyringe, prove need before NestJS
- **Acceptance**: ROI must be clear

---

## Conclusion

**Best Path Forward**:

1. **Short-term (Now)**: Enhance TSyringe with module pattern and lifecycle hooks
2. **Mid-term (3-6 months)**: Evaluate NestJS for specific complex modules
3. **Long-term (6-12 months)**: Consider full NestJS migration if benefits proven

**Rationale**:

- ✅ **Incremental improvement** - no disruption to current work
- ✅ **Learn patterns first** - validate organizational benefits
- ✅ **Measure impact** - bundle size, activation time, developer experience
- ✅ **Reversible decision** - can adopt NestJS later if needed

**Next Steps**:

1. Review this research document
2. Decide on Phase 1 implementation scope
3. Create TASK for enhanced TSyringe module system
4. Document final architecture decision in ADR

---

## References

- [NestJS Standalone Applications](https://docs.nestjs.com/standalone-applications)
- [InversifyJS Documentation](https://inversify.io/)
- [Awilix Documentation](https://github.com/jeffijoe/awilix)
- [TSyringe GitHub](https://github.com/microsoft/tsyringe)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)

**Research Completed**: October 9, 2025  
**Reviewed By**: [Pending]  
**Decision**: [Pending]
