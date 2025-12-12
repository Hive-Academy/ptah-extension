# Infrastructure Test Application

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **infra-test** app is a standalone Node.js application used for testing infrastructure libraries (DI container, event bus, logger, etc.) in isolation without VS Code dependencies.

## Boundaries

**Belongs here**:

- Infrastructure library integration tests
- DI container testing scenarios
- Event bus message flow tests
- Logger output verification
- Service lifecycle testing

**Does NOT belong**:

- VS Code extension tests (belong in ptah-extension-vscode)
- Frontend component tests (belong in webview apps)
- Unit tests (belong in respective libraries)

## Key Files

- `src/main.ts` - Test runner entry point
- `src/test-scenarios/` - Infrastructure test scenarios
- `src/assets/` - Test fixtures and data

## Use Cases

### Testing DI Container

```typescript
// Test service registration and resolution
import { container } from 'tsyringe';
import { DIToken } from '@ptah-extension/vscode-core';

container.register(DIToken.Logger, { useClass: ConsoleLogger });
const logger = container.resolve(DIToken.Logger);
logger.info('Testing DI container');
```

### Testing Event Bus

```typescript
// Test event publishing and subscription
import { EventBus } from '@ptah-extension/vscode-core';

const eventBus = new EventBus();

eventBus.on('test:event', (payload) => {
  console.log('Event received:', payload);
});

eventBus.emit('test:event', { data: 'test' });
```

### Testing Service Lifecycle

```typescript
// Test service initialization and cleanup
import { SessionManager } from '@ptah-extension/claude-domain';

const manager = new SessionManager();
await manager.initialize();
// Run tests...
await manager.dispose();
```

## Commands

```bash
# Build
nx build infra-test

# Run tests
nx serve infra-test  # Runs main.ts

# Development (watch mode)
nx build infra-test --watch

# Run specific scenario
node dist/apps/infra-test/main.js --scenario=di-container
```

## Test Scenarios

### 1. DI Container Registration

Tests:

- Singleton registration
- Transient registration
- Factory registration
- Circular dependency detection
- Token resolution

### 2. Event Bus

Tests:

- Event emission and subscription
- Multiple subscribers
- Event payload validation
- Unsubscribe functionality
- Error handling in subscribers

### 3. Logger

Tests:

- Log level filtering
- Multiple transports
- Structured logging
- Performance (high-volume logging)

### 4. Service Orchestration

Tests:

- Service initialization order
- Dependency resolution
- Graceful shutdown
- Error propagation

## Configuration

```typescript
// Test configuration
export const testConfig = {
  logLevel: 'debug',
  enableMetrics: true,
  mockExternalServices: true,
};
```

## Running Tests

```bash
# Run all scenarios
nx serve infra-test

# Run specific scenario
BUILD_TARGET=infra-test:build node dist/apps/infra-test/main.js

# With debugging
node --inspect-brk dist/apps/infra-test/main.js
```

## Output

Test results are logged to console:

```
✓ DI Container: Singleton registration
✓ DI Container: Dependency resolution
✓ Event Bus: Event emission
✓ Event Bus: Multiple subscribers
...

Total: 15 passed, 0 failed
```

## Guidelines

1. **Isolation**: Each scenario should clean up after itself
2. **No VS Code Dependencies**: Use mocks for VS Code API
3. **Fast Execution**: Keep tests quick (< 1s per scenario)
4. **Clear Output**: Use descriptive test names and logging

## Related Documentation

- [VS Code Core Library](../../libs/backend/vscode-core/CLAUDE.md)
- [Shared Types](../../libs/shared/CLAUDE.md)
