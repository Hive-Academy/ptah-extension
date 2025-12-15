# TASK_2025_074: RPC Method Registration Refactoring

## Task Overview

**Created**: 2025-12-15
**Status**: PLANNED
**Priority**: MEDIUM
**Type**: REFACTORING
**Complexity**: Complex

## User Intent

Refactor the monolithic `RpcMethodRegistrationService` (~1500 lines) into a distributed registration system where each library owns and registers its own RPC handlers, matching the established DI registration pattern.

## Background

The current `rpc-method-registration.service.ts` file:

- Contains ~1500 lines in a single file
- Registers ALL 25 RPC methods in one place
- Violates library encapsulation (app layer knows all implementation details)
- Has poor type safety (generic `registerMethod<TParams, TResult>`)
- Is difficult to test in isolation
- Is a merge conflict hotspot

## Proposed Architecture

### Pattern: Per-Library RPC Registration

Each library will own its RPC handlers following the same pattern as DI registration:

```
libs/backend/{library}/src/rpc/
├── register-rpc-handlers.ts          # Main registration function
├── handlers/
│   └── {domain}-rpc-handlers.ts      # Handler class per domain
└── types/
    └── rpc-handler-types.ts          # Type definitions
```

### Library Ownership

| Library                  | Methods | Handlers                    |
| ------------------------ | ------- | --------------------------- |
| `agent-sdk`              | 13      | chat, session, config, auth |
| `workspace-intelligence` | 4       | context, autocomplete       |
| `vscode-core`            | 1       | file operations             |
| `agent-generation`       | 2       | setup status/wizard         |
| `llm-abstraction`        | 5       | LLM provider management     |

### Type-Safe Registry

Add `RpcMethodRegistry` interface to `@ptah-extension/shared`:

```typescript
export interface RpcMethodRegistry {
  'chat:start': { params: ChatStartParams; result: ChatStartResult };
  'chat:continue': { params: ChatContinueParams; result: ChatContinueResult };
  // ... all 25 methods
}

export type RpcMethodName = keyof RpcMethodRegistry;
export type RpcMethodParams<T extends RpcMethodName> = RpcMethodRegistry[T]['params'];
export type RpcMethodResult<T extends RpcMethodName> = RpcMethodRegistry[T]['result'];
```

### Enhanced RpcHandler

Add type-safe registration method:

```typescript
registerTypedMethod<T extends RpcMethodName>(
  name: T,
  handler: RpcMethodHandler<RpcMethodParams<T>, RpcMethodResult<T>>
): void
```

### Orchestrator Pattern

Main service reduced to ~350 lines (75% reduction):

```typescript
registerAll(): void {
  registerAgentSdkRpcHandlers(this.rpcHandler, this.logger);
  registerWorkspaceIntelligenceRpcHandlers(this.rpcHandler, this.logger);
  registerVsCodeCoreRpcHandlers(this.rpcHandler, this.logger);
  registerAgentGenerationRpcHandlers(this.rpcHandler, this.logger);
  registerLlmAbstractionRpcHandlers(this.rpcHandler, this.logger);
}
```

## Files Impact

### CREATE (29 files)

**agent-sdk** (7 files):

- `libs/backend/agent-sdk/src/lib/rpc/register-rpc-handlers.ts`
- `libs/backend/agent-sdk/src/lib/rpc/handlers/chat-rpc-handlers.ts`
- `libs/backend/agent-sdk/src/lib/rpc/handlers/session-rpc-handlers.ts`
- `libs/backend/agent-sdk/src/lib/rpc/handlers/config-rpc-handlers.ts`
- `libs/backend/agent-sdk/src/lib/rpc/handlers/auth-rpc-handlers.ts`
- `libs/backend/agent-sdk/src/lib/rpc/types/rpc-handler-types.ts`
- `libs/backend/agent-sdk/src/lib/rpc/index.ts`

**workspace-intelligence** (5 files):

- `libs/backend/workspace-intelligence/src/rpc/register-rpc-handlers.ts`
- `libs/backend/workspace-intelligence/src/rpc/handlers/context-rpc-handlers.ts`
- `libs/backend/workspace-intelligence/src/rpc/handlers/autocomplete-rpc-handlers.ts`
- `libs/backend/workspace-intelligence/src/rpc/types/rpc-handler-types.ts`
- `libs/backend/workspace-intelligence/src/rpc/index.ts`

**vscode-core** (4 files):

- `libs/backend/vscode-core/src/rpc/register-rpc-handlers.ts`
- `libs/backend/vscode-core/src/rpc/handlers/file-rpc-handlers.ts`
- `libs/backend/vscode-core/src/rpc/types/rpc-handler-types.ts`
- `libs/backend/vscode-core/src/rpc/index.ts`

**agent-generation** (5 files):

- `libs/backend/agent-generation/src/lib/rpc/register-rpc-handlers.ts`
- `libs/backend/agent-generation/src/lib/rpc/handlers/setup-rpc-handlers.ts`
- `libs/backend/agent-generation/src/lib/rpc/types/rpc-handler-types.ts`
- `libs/backend/agent-generation/src/lib/rpc/index.ts`

**llm-abstraction** (5 files):

- `libs/backend/llm-abstraction/src/lib/rpc/register-rpc-handlers.ts`
- `libs/backend/llm-abstraction/src/lib/rpc/handlers/llm-provider-rpc-handlers.ts`
- `libs/backend/llm-abstraction/src/lib/rpc/types/rpc-handler-types.ts`
- `libs/backend/llm-abstraction/src/lib/rpc/index.ts`

### MODIFY (8 files)

1. `libs/shared/src/lib/types/rpc-messages.ts` - Add RpcMethodRegistry
2. `libs/backend/vscode-core/src/messaging/rpc-handler.ts` - Add registerTypedMethod
3. `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts` - Refactor to orchestrator
4. `libs/backend/agent-sdk/src/index.ts` - Export RPC registration
5. `libs/backend/workspace-intelligence/src/index.ts` - Export RPC registration
6. `libs/backend/vscode-core/src/index.ts` - Export RPC registration
7. `libs/backend/agent-generation/src/index.ts` - Export RPC registration
8. `libs/backend/llm-abstraction/src/index.ts` - Export RPC registration

## Benefits

1. **Library Encapsulation**: Each library owns its RPC handlers
2. **Type Safety**: Compile-time enforcement of request/response types
3. **Testability**: Handler classes can be unit tested in isolation
4. **Maintainability**: Smaller files (50-200 lines each)
5. **Scalability**: Libraries can evolve independently

## Implementation Phases

### Phase 1: Infrastructure Setup

- Add `RpcMethodRegistry` to shared types
- Add `registerTypedMethod()` to RpcHandler
- Update library exports

### Phase 2: Library Registration Functions

- Extract handlers to each library
- Create registration functions
- Maintain backward compatibility

### Phase 3: Orchestrator Refactoring

- Replace registration logic with delegation calls
- Remove old registration methods
- Update tests

### Phase 4: Testing & Cleanup

- Unit tests for handler classes
- Integration tests
- Documentation updates

## Related Tasks

- **TASK_2025_071**: DI Registration Standardization (pattern reference)
- **TASK_2025_073**: LLM Abstraction Remediation (created LLM RPC handlers)
