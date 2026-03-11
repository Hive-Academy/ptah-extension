# Shared Library

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **shared** library is the **foundation layer** of the Ptah monorepo. It provides the type system, branded types, message protocol definitions, and shared utilities used across all backend and frontend libraries.

## Boundaries

**Belongs here**:

- Type definitions and interfaces
- Branded types (SessionId, MessageId, etc.)
- Message protocol contracts
- Cross-cutting utilities (pricing, session totals)
- Common constants and enums

**Does NOT belong**:

- Business logic (belongs in backend domain libraries)
- UI components (belongs in frontend libraries)
- Infrastructure code (belongs in vscode-core)
- Framework-specific code (Angular, VS Code API)

## Key Files

- `src/lib/types/branded.types.ts` - Type-safe ID system (SessionId, MessageId, TaskId)
- `src/lib/types/message.types.ts` - Message protocol with 94+ message types
- `src/lib/types/content-block.types.ts` - Content block definitions for streaming
- `src/lib/types/ai-provider.types.ts` - AI provider abstractions
- `src/lib/types/execution-node.types.ts` - Execution tree data structures
- `src/lib/types/rpc.types.ts` - RPC message definitions
- `src/lib/utils/pricing.utils.ts` - Token pricing calculations
- `src/lib/utils/message-normalizer.ts` - Message normalization utilities

## Dependencies

**External Dependencies**:

- None (pure TypeScript types and utilities)

**Dependents** (who imports this):

- All backend libraries (`vscode-core`, `workspace-intelligence`, `agent-generation`, etc.)
- All frontend libraries (`core`, `chat`, `setup-wizard`, etc.)
- Both applications (`ptah-extension-vscode`, `ptah-extension-webview`)

## Import Path

```typescript
import { SessionId, MessageId, type Message } from '@ptah-extension/shared';
```

## Commands

```bash
# Build library
nx build shared

# Run tests
nx test shared

# Type-check
nx run shared:typecheck

# Lint
nx lint shared
```

## Guidelines

### Type Safety

1. **Always use branded types** for IDs:

   ```typescript
   // ✅ Correct
   function getSession(id: SessionId): Session { ... }

   // ❌ Wrong
   function getSession(id: string): Session { ... }
   ```

2. **Never re-export types from other libraries**:

   ```typescript
   // ❌ Wrong - creates circular dependencies
   export { SomeType } from '@ptah-extension/vscode-core';

   // ✅ Correct - define types here or import where needed
   export type SharedType = { ... };
   ```

3. **Keep utilities pure** (no side effects, no dependencies)

### Message Protocol

All communication between extension and webview uses the message protocol defined here:

```typescript
import { type Message, MessageType } from '@ptah-extension/shared';

const message: Message = {
  id: messageId('msg_123'),
  type: MessageType.CHAT_STARTED,
  payload: { ... }
};
```

### Adding New Types

When adding new types:

1. Create new file in `src/lib/types/` with descriptive name
2. Export from `src/index.ts`
3. Update this documentation
4. Run `nx affected:test` to verify no breaking changes

## Architecture Notes

- **Zero Dependencies**: This library has no dependencies to prevent circular dependencies
- **Build Target**: CommonJS format for Node.js compatibility
- **Test Coverage**: Target 90%+ (types are self-documenting)
