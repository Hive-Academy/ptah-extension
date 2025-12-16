# TASK_2025_074: RPC Method Registration Refactoring

## Task Overview

**Created**: 2025-12-15
**Updated**: 2025-12-16
**Status**: IN_PROGRESS (Phase 1 Complete)
**Priority**: MEDIUM
**Type**: REFACTORING
**Complexity**: Complex

## User Intent

Refactor the monolithic `RpcMethodRegistrationService` (~1500 lines) into a distributed registration system where each library owns and registers its own RPC handlers, matching the established DI registration pattern.

## Background

The current `rpc-method-registration.service.ts` file:

- Contains ~1500 lines in a single file
- Registers ALL 25+ RPC methods in one place
- Violates library encapsulation (app layer knows all implementation details)
- Is difficult to test in isolation
- Is a merge conflict hotspot

## Completed Work (Phase 1)

### Type Safety Foundation ✅

The following type infrastructure has been implemented:

**1. `RpcMethodRegistry` Interface** (`libs/shared/src/lib/types/rpc.types.ts`)

```typescript
export interface RpcMethodRegistry {
  'chat:start': { params: ChatStartParams; result: ChatStartResult };
  'chat:continue': { params: ChatContinueParams; result: ChatContinueResult };
  // ... all 27 methods with typed params/results
}

export type RpcMethodName = keyof RpcMethodRegistry;
export type RpcMethodParams<T extends RpcMethodName> = RpcMethodRegistry[T]['params'];
export type RpcMethodResult<T extends RpcMethodName> = RpcMethodRegistry[T]['result'];
```

**2. `RPC_METHOD_NAMES` Runtime Array** (`libs/shared/src/lib/types/rpc.types.ts`)

```typescript
export const RPC_METHOD_NAMES: RpcMethodName[] = [
  'chat:start',
  'chat:continue',
  'chat:abort',
  'session:list',
  'session:load',
  // ... all 27 methods
] as const;
```

**3. Verification Helper** (`libs/backend/vscode-core/src/messaging/rpc-verification.ts`)

```typescript
export function verifyRpcRegistration(rpcHandler: RpcHandler, logger: Logger): RpcVerificationResult;

export function assertRpcRegistration(rpcHandler: RpcHandler, logger: Logger): void; // Throws if incomplete
```

**4. Frontend Type-Safe Calls** (`libs/frontend/core/src/lib/services/claude-rpc.service.ts`)

```typescript
// Compile-time enforcement - only valid method names accepted
async call<T extends RpcMethodName>(
  method: T,
  params: RpcMethodParams<T>,
  options?: RpcCallOptions
): Promise<RpcResult<RpcMethodResult<T>>>;
```

**5. Verification Integration** (`rpc-method-registration.service.ts`)

- `verifyRpcRegistration()` called after all handlers registered
- Logs errors if expected methods missing handlers

---

## Remaining Work (Phases 2-4)

### Phase 2: Split Types by Domain

Split the monolithic `rpc.types.ts` into domain-specific files:

```
libs/shared/src/lib/types/rpc/
├── index.ts                    # Re-exports + RpcMethodRegistry composition
├── chat.rpc.types.ts           # ChatStartParams, ChatContinueParams, etc.
├── session.rpc.types.ts        # SessionListParams, SessionLoadParams, etc.
├── context.rpc.types.ts        # ContextGetAllFilesParams, etc.
├── autocomplete.rpc.types.ts   # AutocompleteAgentsParams, etc.
├── file.rpc.types.ts           # FileOpenParams, FileOpenResult
├── config.rpc.types.ts         # ConfigModelSwitchParams, etc.
├── auth.rpc.types.ts           # AuthSaveSettingsParams, etc.
├── setup.rpc.types.ts          # SetupStatusGetParams, etc.
└── llm.rpc.types.ts            # LlmSetApiKeyParams, etc.
```

Each domain file exports:

```typescript
// chat.rpc.types.ts
export interface ChatStartParams { ... }
export interface ChatStartResult { ... }
// ...

export interface ChatRpcMethods {
  'chat:start': { params: ChatStartParams; result: ChatStartResult };
  'chat:continue': { params: ChatContinueParams; result: ChatContinueResult };
  'chat:abort': { params: ChatAbortParams; result: ChatAbortResult };
}

export const CHAT_RPC_METHOD_NAMES = [
  'chat:start', 'chat:continue', 'chat:abort'
] as const;
```

The main `index.ts` composes:

```typescript
import { ChatRpcMethods, CHAT_RPC_METHOD_NAMES } from './chat.rpc.types';
import { SessionRpcMethods, SESSION_RPC_METHOD_NAMES } from './session.rpc.types';
// ...

export interface RpcMethodRegistry extends ChatRpcMethods, SessionRpcMethods, ContextRpcMethods, AutocompleteRpcMethods, FileRpcMethods, ConfigRpcMethods, AuthRpcMethods, SetupRpcMethods, LlmRpcMethods {}

export const RPC_METHOD_NAMES: RpcMethodName[] = [
  ...CHAT_RPC_METHOD_NAMES,
  ...SESSION_RPC_METHOD_NAMES,
  // ...
];
```

### Phase 3: Per-Library RPC Registration

Each library owns its RPC handlers:

**Library Ownership Matrix:**

| Library                  | Methods | Domain                      |
| ------------------------ | ------- | --------------------------- |
| `agent-sdk`              | 13      | chat, session, config, auth |
| `workspace-intelligence` | 4       | context, autocomplete       |
| `vscode-core`            | 1       | file operations             |
| `agent-generation`       | 2       | setup status/wizard         |
| `llm-abstraction`        | 6       | LLM provider management     |

**File Structure per Library:**

```
libs/backend/{library}/src/rpc/
├── index.ts                      # Export registration function
├── register-{domain}.ts          # Registration function
└── handlers/
    └── {domain}-handlers.ts      # Handler implementations
```

**Example: agent-sdk registration**

```typescript
// libs/backend/agent-sdk/src/rpc/register-agent-sdk-rpc.ts
import type { RpcHandler, Logger } from '@ptah-extension/vscode-core';
import type { ChatRpcMethods, SessionRpcMethods } from '@ptah-extension/shared';

export interface AgentSdkRpcDependencies {
  sdkAdapter: SdkAgentAdapter;
  sdkStorage: SdkSessionStorage;
  webviewManager: WebviewManager;
  sessionWatcher: AgentSessionWatcherService;
}

export function registerAgentSdkRpcHandlers(
  rpcHandler: RpcHandler,
  logger: Logger,
  deps: AgentSdkRpcDependencies
): void {
  // Chat handlers
  rpcHandler.registerMethod<
    ChatRpcMethods['chat:start']['params'],
    ChatRpcMethods['chat:start']['result']
  >('chat:start', async (params) => {
    // Implementation using deps.sdkAdapter
  });

  // Session handlers
  rpcHandler.registerMethod<
    SessionRpcMethods['session:list']['params'],
    SessionRpcMethods['session:list']['result']
  >('session:list', async (params) => {
    // Implementation using deps.sdkStorage
  });

  logger.info('Agent SDK RPC handlers registered', {
    methods: ['chat:start', 'chat:continue', 'chat:abort', 'session:list', 'session:load', ...]
  });
}
```

### Phase 4: Orchestrator Refactoring

Reduce `rpc-method-registration.service.ts` to ~100 lines:

```typescript
// apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts
import { registerAgentSdkRpcHandlers } from '@ptah-extension/agent-sdk';
import { registerWorkspaceIntelligenceRpcHandlers } from '@ptah-extension/workspace-intelligence';
import { registerVsCodeCoreRpcHandlers } from '@ptah-extension/vscode-core';
import { registerAgentGenerationRpcHandlers } from '@ptah-extension/agent-generation';
import { registerLlmAbstractionRpcHandlers } from '@ptah-extension/llm-abstraction';
import { verifyRpcRegistration } from '@ptah-extension/vscode-core';

@injectable()
export class RpcMethodRegistrationService {
  constructor(@inject(TOKENS.RPC_HANDLER) private rpcHandler: RpcHandler, @inject(TOKENS.LOGGER) private logger: Logger) // ... other dependencies
  {}

  registerAll(): void {
    // Delegate to library-specific registration functions
    registerAgentSdkRpcHandlers(this.rpcHandler, this.logger, {
      sdkAdapter: this.sdkAdapter,
      sdkStorage: this.sdkStorage,
      webviewManager: this.webviewManager,
      sessionWatcher: this.sessionWatcher,
    });

    registerWorkspaceIntelligenceRpcHandlers(this.rpcHandler, this.logger, {
      contextService: this.contextOrchestrationService,
      agentDiscovery: this.agentDiscoveryService,
      commandDiscovery: this.commandDiscoveryService,
    });

    registerVsCodeCoreRpcHandlers(this.rpcHandler, this.logger, {
      commandManager: this.commandManager,
    });

    registerAgentGenerationRpcHandlers(this.rpcHandler, this.logger, {
      container: this.container,
    });

    registerLlmAbstractionRpcHandlers(this.rpcHandler, this.logger, {
      llmRpcHandlers: this.llmRpcHandlers,
    });

    // Verify all expected methods have handlers
    const result = verifyRpcRegistration(this.rpcHandler, this.logger);
    if (!result.valid) {
      this.logger.error('RPC registration incomplete', {
        missing: result.missingHandlers,
        orphan: result.orphanHandlers,
      });
    }

    this.logger.info('All RPC methods registered', {
      total: result.actualCount,
      expected: result.expectedCount,
    });
  }
}
```

---

## Files Impact Summary

### Phase 2: Type Splitting

**CREATE (10 files):**

- `libs/shared/src/lib/types/rpc/index.ts`
- `libs/shared/src/lib/types/rpc/chat.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/session.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/context.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/autocomplete.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/file.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/config.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/auth.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/setup.rpc.types.ts`
- `libs/shared/src/lib/types/rpc/llm.rpc.types.ts`

**DELETE (1 file):**

- `libs/shared/src/lib/types/rpc.types.ts` (after migration)

**MODIFY (1 file):**

- `libs/shared/src/index.ts` (update exports)

### Phase 3: Per-Library Registration

**CREATE (15 files):**

agent-sdk:

- `libs/backend/agent-sdk/src/rpc/index.ts`
- `libs/backend/agent-sdk/src/rpc/register-agent-sdk-rpc.ts`
- `libs/backend/agent-sdk/src/rpc/handlers/chat-handlers.ts`
- `libs/backend/agent-sdk/src/rpc/handlers/session-handlers.ts`
- `libs/backend/agent-sdk/src/rpc/handlers/config-handlers.ts`
- `libs/backend/agent-sdk/src/rpc/handlers/auth-handlers.ts`

workspace-intelligence:

- `libs/backend/workspace-intelligence/src/rpc/index.ts`
- `libs/backend/workspace-intelligence/src/rpc/register-workspace-rpc.ts`
- `libs/backend/workspace-intelligence/src/rpc/handlers/context-handlers.ts`
- `libs/backend/workspace-intelligence/src/rpc/handlers/autocomplete-handlers.ts`

agent-generation:

- `libs/backend/agent-generation/src/lib/rpc/index.ts`
- `libs/backend/agent-generation/src/lib/rpc/register-setup-rpc.ts`

llm-abstraction:

- `libs/backend/llm-abstraction/src/lib/rpc/index.ts`
- `libs/backend/llm-abstraction/src/lib/rpc/register-llm-rpc.ts`

vscode-core:

- `libs/backend/vscode-core/src/rpc/register-file-rpc.ts`

**MODIFY (5 files):**

- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/workspace-intelligence/src/index.ts`
- `libs/backend/agent-generation/src/index.ts`
- `libs/backend/llm-abstraction/src/index.ts`
- `libs/backend/vscode-core/src/index.ts`

### Phase 4: Orchestrator Refactoring

**MODIFY (1 file):**

- `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts`
  - From ~1500 lines → ~100 lines
  - Remove all `private register*Methods()` functions
  - Replace with delegation calls

---

## Benefits

1. **Library Encapsulation**: Each library owns its RPC handlers
2. **Type Safety**: Compile-time enforcement via `RpcMethodRegistry`
3. **Runtime Verification**: `verifyRpcRegistration()` catches missing handlers
4. **Testability**: Handler classes can be unit tested in isolation
5. **Maintainability**: Smaller files (50-200 lines each vs 1500)
6. **Scalability**: Libraries can evolve independently
7. **Reduced Conflicts**: Changes to one domain don't affect others

---

## Implementation Order

1. **Phase 2** - Split types (low risk, no runtime changes)
2. **Phase 3** - Create library registration functions (one library at a time)
3. **Phase 4** - Refactor orchestrator (after all libraries migrated)

Each phase can be done incrementally with full test coverage maintained.

---

## Related Tasks

- **TASK_2025_071**: DI Registration Standardization (pattern reference)
- **TASK_2025_073**: LLM Abstraction Remediation (created LLM RPC handlers)
- **TASK_2025_075**: License Management (added LICENSE_COMMANDS token)
- **TASK_2025_076**: Auth Secrets Service (added auth:getAuthStatus)
