# Dependency Injection Troubleshooting Guide

## Issues Encountered & Solutions

### Issue 1: Unregistered Dependency Token

**Error**:

```
Cannot inject the dependency "outputManager" at position #0 of "Logger" constructor.
Reason: Cannot inject the dependency "context" at position #0 of "OutputManager" constructor.
Reason: Attempted to resolve unregistered dependency token: "Symbol(ExtensionContext)".
```

**Root Cause**: `EXTENSION_CONTEXT` was registered AFTER services that depend on it.

**Fix**: Moved `EXTENSION_CONTEXT` registration to Phase 0 (before all other services).

**File**: `apps/ptah-extension-vscode/src/di/container.ts`

```typescript
// BEFORE (Wrong):
container.registerSingleton(TOKENS.LOGGER, Logger); // Depends on EXTENSION_CONTEXT
container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context }); // Too late!

// AFTER (Correct):
// PHASE 0: Extension Context (MUST BE FIRST)
container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });
// PHASE 1: Infrastructure Services
container.registerSingleton(TOKENS.LOGGER, Logger); // ✅ Can resolve EXTENSION_CONTEXT
```

---

### Issue 2: TypeInfo Not Known

**Error**:

```
Cannot inject the dependency "interactiveSessionManager" at position #5 of "RpcMethodRegistrationService" constructor.
Reason: TypeInfo not known for "InteractiveSessionManager"
```

**Root Cause**: `InteractiveSessionManager` had a runtime dependency (`vscode.Webview`) that cannot be injected automatically.

**Problem**: Constructor signature was:

```typescript
constructor(
  private readonly cliLauncher: ClaudeCliLauncher,
  private readonly webview: vscode.Webview,  // ❌ Cannot auto-inject!
  private readonly options: InteractiveSessionManagerOptions = {}
)
```

**Fix**: Used setter injection pattern:

1. Removed `webview` from constructor
2. Added `@injectable()` decorator
3. Added `setWebview()` method
4. Stored webview as nullable property

**File**: `libs/backend/claude-domain/src/cli/interactive-session-manager.ts`

```typescript
@injectable()  // ✅ Added decorator
export class InteractiveSessionManager {
  private webview: vscode.Webview | null = null;  // ✅ Nullable

  constructor(
    private readonly cliLauncher: ClaudeCliLauncher,  // ✅ Auto-injected
    private readonly options: InteractiveSessionManagerOptions = {}
  ) {
    // ...
  }

  setWebview(webview: vscode.Webview): void {  // ✅ Setter injection
    this.webview = webview;
  }

  async sendMessage(...): Promise<void> {
    if (!this.webview) {  // ✅ Guard clause
      throw new Error('Webview not set. Call setWebview() first.');
    }
    // ...
  }
}
```

**Wiring**: Set webview in `AngularWebviewProvider.resolveWebviewView()`:

```typescript
async resolveWebviewView(webviewView: vscode.WebviewView, ...): Promise<void> {
  // ... other setup ...

  // TASK_2025_010: Set webview for InteractiveSessionManager
  this.interactiveSessionManager.setWebview(webviewView.webview);
  this.logger.info('Webview set for InteractiveSessionManager');
}
```

---

## How to Discover Similar Issues

### 1. Check Registration Order

**Rule**: Dependencies must be registered BEFORE services that use them.

**How to Check**:

```typescript
// Bad practice:
container.registerSingleton(TOKENS.SERVICE_A, ServiceA); // Depends on SERVICE_B
container.registerSingleton(TOKENS.SERVICE_B, ServiceB); // Registered too late!

// Good practice:
container.registerSingleton(TOKENS.SERVICE_B, ServiceB); // Register first
container.registerSingleton(TOKENS.SERVICE_A, ServiceA); // Can now resolve SERVICE_B
```

**Tool**: Create a dependency graph to visualize order:

```bash
# Pseudo-code - could be automated
SERVICE_A depends on [SERVICE_B, SERVICE_C]
SERVICE_B depends on [EXTENSION_CONTEXT]
SERVICE_C depends on []
EXTENSION_CONTEXT depends on []

# Correct registration order:
1. EXTENSION_CONTEXT (no deps)
2. SERVICE_C (no deps)
3. SERVICE_B (depends on EXTENSION_CONTEXT)
4. SERVICE_A (depends on SERVICE_B, SERVICE_C)
```

### 2. Check for `@injectable()` Decorator

**Rule**: All classes registered with `container.registerSingleton()` must have `@injectable()`.

**How to Check**:

```typescript
// Missing decorator (tsyringe can't inject)
export class MyService {
  // ❌ No @injectable()
  constructor(private dep: SomeDep) {}
}

// Correct
@injectable() // ✅ Decorator present
export class MyService {
  constructor(private dep: SomeDep) {}
}
```

**Automated Check** (grep pattern):

```bash
# Find classes registered in DI that might be missing @injectable()
grep -n "registerSingleton(TOKENS\." container.ts | \
while read line; do
  class_name=$(echo "$line" | sed 's/.*registerSingleton.*,\s*\(\w*\)).*/\1/')
  echo "Checking: $class_name"
  grep -l "@injectable()" "**/$class_name.ts" || echo "  ⚠️  Missing @injectable()"
done
```

### 3. Check Constructor Parameters

**Rule**: Constructor parameters must be either:

- Injected via `@inject(TOKEN)`
- Optional with default values
- Provided via factory function

**How to Check**:

```typescript
// ❌ Cannot auto-inject (no @inject, not optional)
constructor(
  private readonly webview: vscode.Webview  // Runtime value!
) {}

// ✅ Option 1: Use @inject for DI-managed deps
constructor(
  @inject(TOKENS.LOGGER) private logger: Logger
) {}

// ✅ Option 2: Optional with default
constructor(
  private options: Options = {}
) {}

// ✅ Option 3: Setter injection for runtime values
private webview: vscode.Webview | null = null;
setWebview(webview: vscode.Webview): void {
  this.webview = webview;
}
```

### 4. Check for Circular Dependencies

**Rule**: A → B → A creates a circular dependency (tsyringe error).

**How to Check**:

```typescript
// ServiceA depends on ServiceB
@injectable()
class ServiceA {
  constructor(@inject(TOKENS.SERVICE_B) private b: ServiceB) {}
}

// ServiceB depends on ServiceA (circular!)
@injectable()
class ServiceB {
  constructor(@inject(TOKENS.SERVICE_A) private a: ServiceA) {} // ❌ Circular!
}
```

**Solution**: Use lazy injection or event bus to break cycle:

```typescript
// Option 1: Lazy injection
@injectable()
class ServiceA {
  constructor(@inject(delay(() => ServiceB)) private b: ServiceB) {}
}

// Option 2: Event bus (better)
@injectable()
class ServiceA {
  constructor(@inject(TOKENS.EVENT_BUS) private eventBus: EventBus) {}

  doSomething() {
    this.eventBus.emit('serviceA:event', data); // Loose coupling
  }
}
```

### 5. Verify Token Uniqueness

**Rule**: Each token must be globally unique (use `Symbol.for()`).

**How to Check**:

```typescript
// ❌ Local symbols (not global)
const LOGGER = Symbol('Logger'); // Created in tokenA.ts
const LOGGER = Symbol('Logger'); // Created in tokenB.ts - different symbol!

// ✅ Global symbols (same across files)
const LOGGER = Symbol.for('Logger'); // Created in tokenA.ts
const LOGGER = Symbol.for('Logger'); // Same symbol - ✅
```

**Automated Check**:

```bash
# Check for Symbol() instead of Symbol.for()
grep -rn "Symbol\('.*'\)" --include="*.ts" src/
# Should find: 0 results
```

---

## Prevention Strategies

### 1. Centralized DI Container

✅ **Do**: Single `container.ts` file with all registrations

```typescript
// apps/ptah-extension-vscode/src/di/container.ts
export class DIContainer {
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // Phase 0: Extension Context
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

    // Phase 1: Infrastructure
    container.registerSingleton(TOKENS.LOGGER, Logger);
    // ... all other registrations in dependency order
  }
}
```

❌ **Don't**: Scattered `register()` calls across multiple files

### 2. Dependency Graph Documentation

Document dependencies in comments:

```typescript
// Phase 1: Infrastructure Services
// Dependencies: EXTENSION_CONTEXT
container.registerSingleton(TOKENS.LOGGER, Logger);
container.registerSingleton(TOKENS.ERROR_HANDLER, ErrorHandler);

// Phase 2: Workspace Intelligence
// Dependencies: LOGGER, ERROR_HANDLER, FILE_SYSTEM_MANAGER
container.registerSingleton(TOKENS.WORKSPACE_SERVICE, WorkspaceService);
```

### 3. Factory Functions for Complex Dependencies

For services with runtime dependencies, use factories:

```typescript
container.register(TOKENS.INTERACTIVE_SESSION_MANAGER, {
  useFactory: (deps) => {
    const manager = new InteractiveSessionManager(deps.resolve(TOKENS.CLAUDE_CLI_LAUNCHER));
    // Set runtime deps later via setter
    return manager;
  },
});
```

### 4. Type-Safe Token Access

Use const object for token access:

```typescript
export const TOKENS = {
  LOGGER: Symbol.for('Logger'),
  ERROR_HANDLER: Symbol.for('ErrorHandler'),
  // ... all tokens
} as const;

// Usage: TOKENS.LOGGER (autocomplete + type safety)
```

### 5. Automated Testing

Add DI container validation tests:

```typescript
describe('DI Container', () => {
  it('should resolve all registered services', () => {
    const context = createMockContext();
    const container = DIContainer.setup(context);

    // Verify each service can be resolved
    expect(() => container.resolve(TOKENS.LOGGER)).not.toThrow();
    expect(() => container.resolve(TOKENS.INTERACTIVE_SESSION_MANAGER)).not.toThrow();
  });
});
```

---

## Quick Checklist

When adding a new service to DI:

- [ ] Add `@injectable()` decorator to class
- [ ] Add token to `TOKENS` object (use `Symbol.for()`)
- [ ] Register in `DIContainer.setup()` in correct phase
- [ ] Verify dependencies are registered before this service
- [ ] If runtime deps needed, use setter injection
- [ ] Add null checks for nullable injected deps
- [ ] Test that service resolves without errors

---

## Common Error Patterns

### Pattern 1: "TypeInfo not known"

**Meaning**: tsyringe doesn't know how to construct the class

**Causes**:

1. Missing `@injectable()` decorator
2. Constructor has non-injectable parameters
3. Circular dependency

**Fix**: Add `@injectable()`, use `@inject()`, or setter injection

### Pattern 2: "Attempted to resolve unregistered dependency"

**Meaning**: Token not registered in container

**Causes**:

1. Forgot to register service
2. Wrong phase order
3. Typo in token name

**Fix**: Register service, check order, verify token

### Pattern 3: "Maximum call stack size exceeded"

**Meaning**: Circular dependency detected

**Causes**:

1. A → B → A cycle
2. Self-injection (service depends on itself)

**Fix**: Break cycle with event bus or lazy injection

---

## Debugging Tools

### 1. Enable tsyringe Debugging

Add before container usage:

```typescript
import 'reflect-metadata';
import { container } from 'tsyringe';

// Log all resolutions
const originalResolve = container.resolve.bind(container);
container.resolve = function <T>(token: any): T {
  console.log('Resolving:', token.toString());
  return originalResolve(token);
};
```

### 2. Check Registered Services

```typescript
// In main.ts after DIContainer.setup()
console.log('Registered services:', container.isRegistered(TOKENS.LOGGER));
console.log('Can resolve:', !!container.resolve(TOKENS.LOGGER));
```

### 3. Dependency Tree Visualization

```typescript
function printDependencyTree(token: symbol, indent = 0) {
  const padding = '  '.repeat(indent);
  console.log(`${padding}${token.toString()}`);

  // Recursively print dependencies (pseudo-code)
  const deps = getDependencies(token);
  deps.forEach((dep) => printDependencyTree(dep, indent + 1));
}
```

---

## Summary

**Key Takeaways**:

1. Registration order matters - dependencies first
2. Use `@injectable()` on all DI-managed classes
3. Runtime values need setter injection
4. Centralize all registrations in one file
5. Document dependency phases clearly

**Files Modified**:

- `apps/ptah-extension-vscode/src/di/container.ts` - Fixed registration order
- `libs/backend/claude-domain/src/cli/interactive-session-manager.ts` - Added setter injection
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` - Wired up webview

**Result**: Extension activates successfully, all services resolve correctly! ✅
