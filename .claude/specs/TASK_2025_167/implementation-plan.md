# Implementation Plan - TASK_2025_167: Custom Agent Adapter

## Codebase Investigation Summary

### Libraries Discovered

- **agent-sdk** (`libs/backend/agent-sdk/`): Main SDK integration with IAIProvider, session lifecycle, streaming, auth, DI tokens
  - Key exports: `SdkAgentAdapter`, `SDK_TOKENS`, `registerSdkServices`, `StreamTransformer`, `SdkMessageTransformer`, `SdkModuleLoader`
  - Documentation: `libs/backend/agent-sdk/CLAUDE.md`
- **shared** (`libs/shared/`): Type system foundation with `IAIProvider`, `ProviderId`, `AuthEnv`, `FlatStreamEventUnion`, RPC types
  - Key exports: `IAIProvider`, `ProviderId`, `AuthEnv`, `createEmptyAuthEnv`, `SessionId`
- **vscode-core** (`libs/backend/vscode-core/`): DI tokens, Logger, ConfigManager, AuthSecretsService
  - Key exports: `TOKENS`, `Logger`, `ConfigManager`, `IAuthSecretsService`

### Patterns Identified

1. **DI Registration Pattern**: All services use `@injectable()` + `@inject()` decorators with `Symbol.for()` tokens registered as singletons in library-level `register.ts` files. Evidence: `libs/backend/agent-sdk/src/lib/di/register.ts:66-328`

2. **IAIProvider Pattern**: Heavyweight singleton implementing `IAIProvider` interface with `initialize()`, `startChatSession()`, `resumeSession()`, `endSession()`, `sendMessageToSession()`. Evidence: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:94-665`

3. **AuthEnv Isolation Pattern**: `createEmptyAuthEnv()` creates a fresh `AuthEnv` object. `SdkQueryOptionsBuilder` merges `{ ...process.env, ...authEnv }` into the SDK `query()` env option. Evidence: `libs/shared/src/lib/types/auth-env.types.ts:19-21`, `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:360`

4. **Provider Registry Pattern**: `AnthropicProvider` interface with static registry array, helper functions `getAnthropicProvider()`, `getProviderBaseUrl()`. Evidence: `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts:60-83`

5. **Per-Provider Secret Storage**: `AuthSecretsService.getProviderKey(providerId)` stores keys with pattern `ptah.auth.provider.{providerId}`. Evidence: `libs/backend/vscode-core/src/services/auth-secrets.service.ts:269-286`

6. **Stream Transformation Pattern**: `StreamTransformer.transform()` takes an `AsyncIterable<SDKMessage>` and yields `FlatStreamEventUnion`. Depends on `SdkMessageTransformer` for message-to-event conversion. Evidence: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:186-469`

### Integration Points

- **DI Container Orchestration**: `apps/ptah-extension-vscode/src/di/container.ts:159-452` orchestrates all library registrations
- **Extension Activation**: `apps/ptah-extension-vscode/src/main.ts:390-411` resolves and initializes SDK adapter
- **Auth RPC Handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts` manages auth settings save/load
- **Chat RPC Handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` dispatches chat:start to SDK adapter
- **Config RPC Handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/config-rpc.handlers.ts` handles model selection

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Independent IAIProvider with isolated session infrastructure

**Rationale**: The user explicitly requires maximum independence to protect the main Claude SDK adapter. The custom adapter creates its own `AuthEnv` instance, its own lightweight session tracking, its own stream transformer -- no shared mutable state with the main adapter. This means a controlled amount of code duplication in exchange for zero risk of impacting the main SDK flow.

**Evidence**: The existing `SdkAgentAdapter` pattern (file: `sdk-agent-adapter.ts`) proves the IAIProvider contract works. The `AuthEnv` + `query()` env isolation mechanism (file: `sdk-query-options-builder.ts:360`) proves environment isolation is the SDK's built-in approach.

### Architecture Diagram

```
+------------------------------------------------------------------+
|                    Extension Host (main.ts)                       |
|  +--------------------------+  +-----------------------------+   |
|  | SdkAgentAdapter          |  | CustomAgentAdapter          |   |
|  | (IAIProvider: claude-cli) |  | (IAIProvider: custom-agent) |   |
|  |                          |  |                             |   |
|  | DI Singleton AuthEnv  ---|  | OWN AuthEnv instance     ---|   |
|  | SharedSessionLifecycle---|  | OWN session tracking     ---|   |
|  | SharedStreamTransformer--|  | OWN stream transformer   ---|   |
|  | SharedQueryOptionsBuilder|  | OWN query options builder---|   |
|  |                          |  |                             |   |
|  | SdkModuleLoader <--------+--+ SdkModuleLoader (SHARED)    |   |
|  | SdkMessageTransformer <--+--+ SdkMessageTransformer(SHARED)|   |
|  | SdkPermissionHandler <---+--+ SdkPermissionHandler(SHARED)|   |
|  +--------------------------+  +-----------------------------+   |
|                                                                  |
|  +--------------------------------------------------------------+|
|  | CustomAgentRegistry (manages multiple configured providers)   ||
|  | - Stores active custom agents (providerId -> config)          ||
|  | - Creates/destroys CustomAgentAdapter instances                ||
|  | - Delegates to AuthSecretsService for key storage             ||
|  +--------------------------------------------------------------+|
+------------------------------------------------------------------+
```

**Shared (read-only) services** -- safe to reuse because they are stateless:

- `SdkModuleLoader`: Caches the `query()` function (pure, no session state)
- `SdkMessageTransformer`: Stateless message-to-event converter
- `SdkPermissionHandler`: Permission state is per-session, handler is shared

**Duplicated (independent) services** -- to ensure zero impact:

- `AuthEnv`: Each custom adapter creates its own via `createEmptyAuthEnv()`
- Session tracking: Lightweight `Map<string, CustomActiveSession>` inside the adapter
- Stream transformation: Own async generator that uses shared `SdkMessageTransformer`
- Query options building: Inline method (no system prompt, no MCP, simpler than main)

---

## Component Specifications

### Component 1: Extended ProviderId Type

**Purpose**: Add `'custom-agent'` to the `ProviderId` union so custom adapters are first-class IAIProvider instances.

**Pattern**: Existing union type at `libs/shared/src/lib/types/ai-provider.types.ts:14`
**Evidence**: Current definition: `export type ProviderId = 'claude-cli' | 'vscode-lm';`

**Specification**:

```typescript
// libs/shared/src/lib/types/ai-provider.types.ts:14
export type ProviderId = 'claude-cli' | 'vscode-lm' | 'custom-agent';
```

Update the type guard and constants:

```typescript
// libs/shared/src/lib/types/ai-provider.types.ts:288-298
export function isValidProviderId(id: string): id is ProviderId {
  return id === 'claude-cli' || id === 'vscode-lm' || id === 'custom-agent';
}

export const PROVIDER_IDS: readonly ProviderId[] = ['claude-cli', 'vscode-lm', 'custom-agent'] as const;
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts` (MODIFY)

---

### Component 2: Custom Agent Configuration Types

**Purpose**: Define the configuration shape for a custom agent instance -- which provider from the registry, which model, the user's API key reference.

**Pattern**: Follows `AnthropicProvider` shape from `anthropic-provider-registry.ts:60-83` and `AuthEnv` from `auth-env.types.ts:8-16`

**Specification**:

```typescript
// NEW FILE: libs/shared/src/lib/types/custom-agent.types.ts

import type { AnthropicProviderId } from './custom-agent-provider.types';

/**
 * Persisted configuration for a single custom agent instance.
 * Stored in VS Code workspace settings under ptah.customAgents[].
 *
 * Each custom agent maps to one Anthropic-compatible provider
 * from the provider registry (OpenRouter, Moonshot, Z.AI).
 */
export interface CustomAgentConfig {
  /** Unique instance ID (UUID, generated on creation) */
  readonly id: string;
  /** User-facing display name (e.g., "My Kimi Agent") */
  readonly name: string;
  /** Provider ID from the Anthropic-compatible registry */
  readonly providerId: string;
  /** Whether this agent is enabled (appears in agent selector) */
  readonly enabled: boolean;
  /** Model tier mappings (same structure as main provider) */
  readonly tierMappings?: {
    readonly sonnet?: string;
    readonly opus?: string;
    readonly haiku?: string;
  };
  /** Selected model ID for direct selection (overrides tier if set) */
  readonly selectedModel?: string;
  /** Timestamp of last configuration change */
  readonly updatedAt: number;
}

/**
 * Runtime state for a custom agent (not persisted).
 * Tracks initialization status and health.
 */
export interface CustomAgentState {
  /** Whether the agent has been initialized */
  readonly initialized: boolean;
  /** Current health status */
  readonly status: 'available' | 'error' | 'initializing' | 'unconfigured';
  /** Error message if status is 'error' */
  readonly errorMessage?: string;
}

/**
 * Summary information sent to the frontend for agent selection.
 * Combines config + runtime state.
 */
export interface CustomAgentSummary {
  /** Config ID */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** Provider name (e.g., "Moonshot (Kimi)") */
  readonly providerName: string;
  /** Provider ID */
  readonly providerId: string;
  /** Whether the agent has a configured API key */
  readonly hasApiKey: boolean;
  /** Runtime status */
  readonly status: CustomAgentState['status'];
  /** Whether enabled */
  readonly enabled: boolean;
  /** Available models (static or dynamic) */
  readonly modelCount: number;
}
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\custom-agent.types.ts` (CREATE)
- `D:\projects\ptah-extension\libs\shared\src\lib\types\index.ts` (MODIFY - add export)

---

### Component 3: Custom Agent RPC Types

**Purpose**: Define RPC parameter/response types for frontend communication.

**Pattern**: Follows existing RPC type pattern from `libs/shared/src/lib/types/rpc.types.ts:465-630`

**Specification**:

```typescript
// Add to: libs/shared/src/lib/types/rpc.types.ts (append to existing file)

import type { CustomAgentConfig, CustomAgentSummary } from './custom-agent.types';

// ============================================================
// Custom Agent RPC Types (TASK_2025_167)
// ============================================================

/** Parameters for customAgent:list RPC method */
export interface CustomAgentListParams {
  /** No parameters needed */
}

/** Response from customAgent:list */
export interface CustomAgentListResult {
  agents: CustomAgentSummary[];
}

/** Parameters for customAgent:create */
export interface CustomAgentCreateParams {
  /** User-facing display name */
  name: string;
  /** Provider ID from the registry (e.g., 'openrouter', 'moonshot', 'z-ai') */
  providerId: string;
  /** API key for this provider instance */
  apiKey: string;
}

/** Response from customAgent:create */
export interface CustomAgentCreateResult {
  success: boolean;
  /** Created agent config (if success) */
  agent?: CustomAgentSummary;
  error?: string;
}

/** Parameters for customAgent:update */
export interface CustomAgentUpdateParams {
  /** Agent instance ID */
  id: string;
  /** Fields to update (partial) */
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  tierMappings?: {
    sonnet?: string;
    opus?: string;
    haiku?: string;
  };
  selectedModel?: string;
}

/** Response from customAgent:update */
export interface CustomAgentUpdateResult {
  success: boolean;
  error?: string;
}

/** Parameters for customAgent:delete */
export interface CustomAgentDeleteParams {
  /** Agent instance ID */
  id: string;
}

/** Response from customAgent:delete */
export interface CustomAgentDeleteResult {
  success: boolean;
  error?: string;
}

/** Parameters for customAgent:testConnection */
export interface CustomAgentTestConnectionParams {
  /** Agent instance ID */
  id: string;
}

/** Response from customAgent:testConnection */
export interface CustomAgentTestConnectionResult {
  success: boolean;
  /** Connection latency in ms */
  latencyMs?: number;
  error?: string;
}

/** Parameters for customAgent:listModels */
export interface CustomAgentListModelsParams {
  /** Agent instance ID */
  id: string;
}

/** Response from customAgent:listModels */
export interface CustomAgentListModelsResult {
  models: Array<{
    id: string;
    name: string;
    description?: string;
    contextLength?: number;
  }>;
  isStatic: boolean;
  error?: string;
}
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (MODIFY - append types)

---

### Component 4: CustomAgentAdapter (Core)

**Purpose**: Independent `IAIProvider` implementation that uses SDK `query()` with its own isolated `AuthEnv`. This is the heart of the feature.

**Pattern**: Follows `SdkAgentAdapter` structure (`sdk-agent-adapter.ts:94-665`) but with significantly reduced complexity -- no CLI detection, no config watchers, no auth manager. The adapter is thin: it receives its config, builds an AuthEnv, and calls `query()`.

**Evidence for reusable services**:

- `SdkModuleLoader.getQueryFunction()` returns cached `QueryFunction` (file: `sdk-module-loader.ts:44-66`)
- `SdkMessageTransformer.transform()` is stateless per-call (file: `sdk-message-transformer.ts:10-55`)
- `SdkPermissionHandler.createCallback()` returns a callback (file: `sdk-permission-handler.ts`)

**Specification**:

```typescript
// NEW FILE: libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-adapter.ts

import { injectable, inject } from 'tsyringe';
import { IAIProvider, ProviderId, ProviderInfo, ProviderHealth, ProviderStatus, ProviderCapabilities, AISessionConfig, AIMessageOptions, SessionId, FlatStreamEventUnion, AuthEnv, createEmptyAuthEnv, MessageTokenUsage, calculateMessageCost } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import type { SdkModuleLoader } from '../helpers/sdk-module-loader';
import type { SdkPermissionHandler } from '../sdk-permission-handler';
import type { CustomAgentConfig } from '@ptah-extension/shared';
import type { AnthropicProvider } from '../helpers/anthropic-provider-registry';
import { getAnthropicProvider, getProviderAuthEnvVar, seedStaticModelPricing, resolveActualModelForPricing } from '../helpers/anthropic-provider-registry';
import { SDKMessage, SDKUserMessage, UserMessageContent, isResultMessage, isSystemInit, isCompactBoundary, Options } from '../types/sdk-types/claude-sdk.types';

/**
 * Lightweight active session tracking for custom agents.
 * Intentionally simpler than the main SessionLifecycleManager.
 */
interface CustomActiveSession {
  readonly sessionId: SessionId;
  query: AsyncIterable<SDKMessage> | null;
  readonly abortController: AbortController;
  messageQueue: SDKUserMessage[];
  resolveNext: (() => void) | null;
  currentModel: string;
}

/**
 * Callbacks for session events (mirrors main adapter pattern)
 */
type SessionIdResolvedCallback = (tabId: string | undefined, realSessionId: string) => void;

type ResultStatsCallback = (stats: { sessionId: SessionId; cost: number; tokens: MessageTokenUsage; duration: number }) => void;

/**
 * CustomAgentAdapter - Independent IAIProvider for Anthropic-compatible providers.
 *
 * Architecture: Each instance operates with COMPLETE isolation from the main
 * SdkAgentAdapter. It creates its own AuthEnv, manages its own sessions,
 * and transforms its own streams. The only shared services are stateless:
 * SdkModuleLoader (caches query function) and SdkMessageTransformer (pure).
 *
 * TASK_2025_167: Isolated provider support for Moonshot, Z.AI, OpenRouter.
 */
export class CustomAgentAdapter implements IAIProvider {
  readonly providerId: ProviderId = 'custom-agent' as ProviderId;
  readonly info: ProviderInfo;

  /** Isolated AuthEnv for this adapter instance (NOT the DI singleton) */
  private readonly authEnv: AuthEnv;

  /** Provider definition from registry */
  private readonly provider: AnthropicProvider;

  /** Lightweight session tracking (independent of main SessionLifecycleManager) */
  private readonly activeSessions = new Map<string, CustomActiveSession>();

  /** Initialization state */
  private initialized = false;
  private health: ProviderHealth = {
    status: 'initializing' as ProviderStatus,
    lastCheck: Date.now(),
  };

  /** Event callbacks (set by RPC registration layer) */
  private sessionIdResolvedCallback: SessionIdResolvedCallback | null = null;
  private resultStatsCallback: ResultStatsCallback | null = null;

  constructor(private readonly config: CustomAgentConfig, private readonly apiKey: string, private readonly logger: Logger, private readonly moduleLoader: SdkModuleLoader, private readonly messageTransformer: SdkMessageTransformer, private readonly permissionHandler: SdkPermissionHandler) {
    // Look up provider from registry
    const provider = getAnthropicProvider(config.providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${config.providerId}`);
    }
    this.provider = provider;

    // Create ISOLATED AuthEnv (NOT the DI singleton)
    this.authEnv = createEmptyAuthEnv();

    // Build provider info
    this.info = {
      id: 'custom-agent' as ProviderId,
      name: `${config.name} (${provider.name})`,
      version: '1.0.0',
      description: `Custom agent using ${provider.name}`,
      vendor: provider.name,
      capabilities: {
        streaming: true,
        fileAttachments: true,
        contextManagement: true,
        sessionPersistence: true,
        multiTurn: true,
        codeGeneration: true,
        imageAnalysis: true,
        functionCalling: true,
      },
      maxContextTokens: 200000,
      supportedModels: [],
    };
  }

  // ... full implementation following the IAIProvider contract
  // See detailed method specs below
}
```

**Key methods to implement**:

1. `initialize()`: Sets up AuthEnv with provider base URL + API key, seeds pricing, marks healthy
2. `startChatSession()`: Creates abort controller, message stream, builds query options with isolated AuthEnv, calls `query()`, returns transformed stream
3. `resumeSession()`: Same as start but with `resume` option
4. `endSession()`: Aborts and cleans up session from `activeSessions` map
5. `sendMessageToSession()`: Queues message and wakes iterator
6. `dispose()`: Cleans up all active sessions

**The query options are simpler than the main adapter**:

- No MCP server configuration (custom agents are BYOK, not premium-gated)
- No enhanced prompts
- No plugin paths
- No config watchers
- Model identity prompt IS included (reuse `buildModelIdentityPrompt` from existing code)

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-adapter.ts` (CREATE)

---

### Component 5: CustomAgentRegistry

**Purpose**: Manages the lifecycle of multiple `CustomAgentAdapter` instances. Stores configurations in VS Code settings, retrieves API keys from `AuthSecretsService`, creates/destroys adapter instances on demand.

**Pattern**: Follows the registry pattern seen in `anthropic-provider-registry.ts` but with dynamic instances rather than static definitions. Uses `ConfigManager` for persistence (evidence: `auth-rpc.handlers.ts:118-121` uses `configManager.getWithDefault()`).

**Specification**:

```typescript
// NEW FILE: libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-registry.ts

import { injectable, inject } from 'tsyringe';
import { AuthEnv, createEmptyAuthEnv, CustomAgentConfig, CustomAgentState, CustomAgentSummary } from '@ptah-extension/shared';
import { Logger, ConfigManager, IAuthSecretsService, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import type { SdkModuleLoader } from '../helpers/sdk-module-loader';
import type { SdkPermissionHandler } from '../sdk-permission-handler';
import { getAnthropicProvider } from '../helpers/anthropic-provider-registry';
import { CustomAgentAdapter } from './custom-agent-adapter';
import { randomUUID } from 'crypto';

/** Config key for custom agent storage */
const CUSTOM_AGENTS_CONFIG_KEY = 'customAgents';

/** Secret storage prefix for custom agent API keys */
const CUSTOM_AGENT_SECRET_PREFIX = 'customAgent';

@injectable()
export class CustomAgentRegistry {
  /** Active adapter instances keyed by config ID */
  private readonly adapters = new Map<string, CustomAgentAdapter>();

  /** Runtime state per agent */
  private readonly states = new Map<string, CustomAgentState>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler
  ) {}

  /**
   * Get all configured custom agents with their runtime state.
   */
  async listAgents(): Promise<CustomAgentSummary[]> {
    /* ... */
  }

  /**
   * Create a new custom agent configuration.
   * Stores config in VS Code settings, API key in SecretStorage.
   */
  async createAgent(name: string, providerId: string, apiKey: string): Promise<CustomAgentSummary> {
    /* ... */
  }

  /**
   * Update an existing custom agent.
   */
  async updateAgent(id: string, updates: Partial<Pick<CustomAgentConfig, 'name' | 'enabled' | 'tierMappings' | 'selectedModel'>>, apiKey?: string): Promise<void> {
    /* ... */
  }

  /**
   * Delete a custom agent and its API key.
   */
  async deleteAgent(id: string): Promise<void> {
    /* ... */
  }

  /**
   * Get or create the adapter instance for a custom agent.
   * Lazy initialization: adapter is created on first use.
   */
  async getAdapter(id: string): Promise<CustomAgentAdapter | undefined> {
    /* ... */
  }

  /**
   * Test connection for a custom agent (validates API key works).
   */
  async testConnection(id: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    /* ... */
  }

  /**
   * Dispose all active adapters.
   */
  disposeAll(): void {
    /* ... */
  }

  // --- Private helpers ---

  private loadConfigs(): CustomAgentConfig[] {
    return this.config.getWithDefault<CustomAgentConfig[]>(CUSTOM_AGENTS_CONFIG_KEY, []);
  }

  private async saveConfigs(configs: CustomAgentConfig[]): Promise<void> {
    await this.config.set(CUSTOM_AGENTS_CONFIG_KEY, configs);
  }

  private getSecretKey(agentId: string): string {
    // Uses AuthSecretsService.setProviderKey/getProviderKey with prefixed ID
    return `${CUSTOM_AGENT_SECRET_PREFIX}.${agentId}`;
  }
}
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts` (CREATE)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\index.ts` (CREATE)

---

### Component 6: DI Token and Registration

**Purpose**: Register `CustomAgentRegistry` in the DI container with a new SDK token.

**Pattern**: Follows existing token convention at `libs/backend/agent-sdk/src/lib/di/tokens.ts:30-91` using `Symbol.for()`.

**Specification**:

```typescript
// ADD to libs/backend/agent-sdk/src/lib/di/tokens.ts

// Custom Agent Registry (TASK_2025_167)
// Manages custom agent configurations and adapter lifecycle
SDK_CUSTOM_AGENT_REGISTRY: Symbol.for('SdkCustomAgentRegistry'),
```

```typescript
// ADD to libs/backend/agent-sdk/src/lib/di/register.ts

import { CustomAgentRegistry } from '../custom-agent';

// ============================================================
// Custom Agent Registry (TASK_2025_167)
// Manages multiple custom agent adapter instances
// ============================================================
container.register(SDK_TOKENS.SDK_CUSTOM_AGENT_REGISTRY, { useClass: CustomAgentRegistry }, { lifecycle: Lifecycle.Singleton });
```

```typescript
// ADD to libs/backend/agent-sdk/src/index.ts

// Custom Agent exports (TASK_2025_167)
export { CustomAgentAdapter } from './lib/custom-agent/custom-agent-adapter';
export { CustomAgentRegistry } from './lib/custom-agent/custom-agent-registry';
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts` (MODIFY)

---

### Component 7: Custom Agent RPC Handlers

**Purpose**: Backend RPC handlers for frontend communication -- CRUD operations on custom agents, connection testing, model listing.

**Pattern**: Follows existing RPC handler pattern from `auth-rpc.handlers.ts:36-357` -- `@injectable()` class with `register()` method that calls `rpcHandler.registerMethod()`.

**Specification**:

```typescript
// NEW FILE: apps/ptah-extension-vscode/src/services/rpc/handlers/custom-agent-rpc.handlers.ts

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, CustomAgentRegistry, ANTHROPIC_PROVIDERS } from '@ptah-extension/agent-sdk';
import type { CustomAgentListResult, CustomAgentCreateParams, CustomAgentCreateResult, CustomAgentUpdateParams, CustomAgentUpdateResult, CustomAgentDeleteParams, CustomAgentDeleteResult, CustomAgentTestConnectionParams, CustomAgentTestConnectionResult, CustomAgentListModelsParams, CustomAgentListModelsResult } from '@ptah-extension/shared';

@injectable()
export class CustomAgentRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_CUSTOM_AGENT_REGISTRY)
    private readonly registry: CustomAgentRegistry
  ) {}

  register(): void {
    this.registerList();
    this.registerCreate();
    this.registerUpdate();
    this.registerDelete();
    this.registerTestConnection();
    this.registerListModels();
    this.registerGetProviders(); // Returns available providers from registry
  }

  // RPC method implementations...
}
```

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\custom-agent-rpc.handlers.ts` (CREATE)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\index.ts` (MODIFY - export)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts` (MODIFY - register handler)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (MODIFY - add handler)

---

### Component 8: Chat RPC Integration

**Purpose**: Enable the `chat:start` and `chat:continue` RPC methods to dispatch to a custom agent when selected by the frontend.

**Pattern**: The frontend sends a `tabId` and optional agent config. The chat handler checks if a custom agent is selected, resolves the adapter from the registry, and delegates to it instead of the main `SdkAgentAdapter`.

**Specification**:

The `ChatStartParams` type needs an optional field to indicate which custom agent to use:

```typescript
// MODIFY: libs/shared/src/lib/types/rpc.types.ts - ChatStartParams

export interface ChatStartParams {
  prompt?: string;
  tabId: string;
  name?: string;
  workspacePath?: string;
  options?: {
    model?: string;
    // ... existing fields
  };
  /** TASK_2025_167: Custom agent ID (if using a custom agent instead of main SDK) */
  customAgentId?: string;
}
```

In `ChatRpcHandlers.registerChatStart()`:

- If `params.customAgentId` is set, resolve the adapter from `CustomAgentRegistry.getAdapter(id)`
- Call `adapter.startChatSession(...)` on the custom adapter
- Stream events through the same webview broadcast mechanism

```typescript
// MODIFY: apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts

// Add constructor injection:
@inject(SDK_TOKENS.SDK_CUSTOM_AGENT_REGISTRY)
private readonly customAgentRegistry: CustomAgentRegistry,

// In chat:start handler, BEFORE calling sdkAdapter.startChatSession():
if (params.customAgentId) {
  const customAdapter = await this.customAgentRegistry.getAdapter(params.customAgentId);
  if (!customAdapter) {
    return { success: false, error: 'Custom agent not found or not configured' };
  }
  // Delegate to custom adapter (same streaming pattern)
  const stream = await customAdapter.startChatSession({ ... });
  // ... pipe stream to webview (same code as main adapter)
}
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (MODIFY - add customAgentId to ChatStartParams)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts` (MODIFY - add custom agent dispatch)

---

## Integration Architecture

### Data Flow

```
Frontend (Agent Selector)
  |
  v
customAgent:list  ------>  CustomAgentRpcHandlers.registerList()
                              |
                              v
                           CustomAgentRegistry.listAgents()
                              |
                              v
                           ConfigManager.get('customAgents')
                           AuthSecretsService.hasProviderKey()
                              |
                              v
                           Return CustomAgentSummary[]
```

```
Frontend (Chat Start with Custom Agent)
  |
  v
chat:start { customAgentId: 'abc-123' }
  |
  v
ChatRpcHandlers
  |-- customAgentId present? YES
  |     |
  |     v
  |   CustomAgentRegistry.getAdapter('abc-123')
  |     |
  |     v
  |   CustomAgentAdapter.initialize() (if first use)
  |     |-- Creates AuthEnv with provider base URL + API key
  |     |-- Sets ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
  |     |-- Applies tier mappings from config
  |     v
  |   CustomAgentAdapter.startChatSession(config)
  |     |-- Gets query() from SdkModuleLoader (shared)
  |     |-- Creates message stream (own implementation)
  |     |-- Builds query options with isolated AuthEnv
  |     |-- Calls query({ prompt, options: { env: { ...process.env, ...this.authEnv } } })
  |     |-- Returns transformed stream (own generator, shared SdkMessageTransformer)
  |     v
  |   Stream events -> WebviewManager.broadcastMessage()
  |
  |-- customAgentId NOT present
        |
        v
      SdkAgentAdapter.startChatSession() (existing flow, UNTOUCHED)
```

### API Key Storage Flow

```
Frontend (Save Custom Agent)
  |
  v
customAgent:create { name, providerId, apiKey }
  |
  v
CustomAgentRegistry.createAgent()
  |
  +-- Config: configManager.set('customAgents', [...existing, newConfig])
  |   (stores: id, name, providerId, enabled, tierMappings, updatedAt)
  |   (does NOT store API key in config)
  |
  +-- API Key: authSecretsService.setProviderKey(`customAgent.${id}`, apiKey)
      (encrypted via VS Code SecretStorage)
      (key pattern: ptah.auth.provider.customAgent.{agentId})
```

---

## Batched Task Breakdown

### Batch 1: Foundation Types (Shared Library)

**Developer**: backend-developer
**Estimated Effort**: 1-2 hours
**No dependencies on other batches**

| #   | File                                                                         | Action | Description                                                                                 |
| --- | ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 1   | `D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts`  | MODIFY | Add `'custom-agent'` to `ProviderId` union, update `isValidProviderId()` and `PROVIDER_IDS` |
| 2   | `D:\projects\ptah-extension\libs\shared\src\lib\types\custom-agent.types.ts` | CREATE | `CustomAgentConfig`, `CustomAgentState`, `CustomAgentSummary` interfaces                    |
| 3   | `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`          | MODIFY | Add Custom Agent RPC types, add `customAgentId` to `ChatStartParams` and `ChatResumeParams` |
| 4   | `D:\projects\ptah-extension\libs\shared\src\lib\types\index.ts`              | MODIFY | Export new `custom-agent.types.ts`                                                          |

**Verification**: `nx run shared:typecheck` passes

---

### Batch 2: Custom Agent Adapter + Registry (Agent SDK Library)

**Developer**: backend-developer
**Estimated Effort**: 4-6 hours
**Depends on**: Batch 1

| #   | File                                                                                              | Action | Description                                                                                      |
| --- | ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| 1   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-adapter.ts`  | CREATE | Full `IAIProvider` implementation with isolated AuthEnv, session tracking, stream transformation |
| 2   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts` | CREATE | Registry managing configs (ConfigManager), API keys (AuthSecretsService), adapter lifecycle      |
| 3   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\index.ts`                 | CREATE | Barrel exports for custom-agent module                                                           |
| 4   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`                          | MODIFY | Add `SDK_CUSTOM_AGENT_REGISTRY` token                                                            |
| 5   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`                        | MODIFY | Register `CustomAgentRegistry` as singleton                                                      |
| 6   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`                                  | MODIFY | Export `CustomAgentAdapter`, `CustomAgentRegistry`                                               |

**Verification**: `nx run agent-sdk:typecheck` passes, `nx test agent-sdk` passes

---

### Batch 3: RPC Handlers + DI Wiring (Extension App)

**Developer**: backend-developer
**Estimated Effort**: 3-4 hours
**Depends on**: Batch 2

| #   | File                                                                                                           | Action | Description                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| 1   | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\custom-agent-rpc.handlers.ts` | CREATE | RPC handlers for customAgent:list/create/update/delete/testConnection/listModels/getProviders |
| 2   | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\index.ts`                              | MODIFY | Export `CustomAgentRpcHandlers`                                                               |
| 3   | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`                                    | MODIFY | Register `CustomAgentRpcHandlers`, add to `RpcMethodRegistrationService` factory              |
| 4   | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`    | MODIFY | Add `CustomAgentRpcHandlers` to constructor injection and `registerAll()`                     |
| 5   | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`         | MODIFY | Add custom agent dispatch in `chat:start` and `chat:continue` handlers                        |
| 6   | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`                                            | MODIFY | Initialize custom agent registry during activation (after SDK services)                       |

**Verification**: `nx run ptah-extension-vscode:typecheck` passes, extension activates without errors

---

### Batch 4: Frontend Integration (Webview)

**Developer**: frontend-developer
**Estimated Effort**: 4-6 hours
**Depends on**: Batch 3

This batch covers the Angular webview changes to expose the Custom Agents feature. The specifics depend on the existing webview architecture, but the integration points are:

| #   | Area                              | Description                                                                                                                                                                |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Custom Agent Settings Component   | New component in settings area for CRUD operations on custom agents. Uses `customAgent:list`, `customAgent:create`, `customAgent:update`, `customAgent:delete` RPC calls.  |
| 2   | Agent Selector Integration        | Add custom agents to the agent/provider selector dropdown. Each configured custom agent appears as a selectable option. When selected, `chat:start` sends `customAgentId`. |
| 3   | Model Selection for Custom Agents | When a custom agent is selected, show its available models (from `customAgent:listModels`). Support tier mapping configuration (Sonnet/Opus/Haiku -> provider model).      |
| 4   | Connection Test UI                | Button to test API key validity. Calls `customAgent:testConnection` and shows result.                                                                                      |
| 5   | RPC Service Types                 | Add typed RPC method signatures for all new custom agent methods.                                                                                                          |

**Verification**: Webview builds, custom agents appear in settings, agents selectable in chat

---

## Quality Requirements

### Functional Requirements

1. **Zero impact on main SDK**: The `SdkAgentAdapter` code must not be modified in any way. Custom agents must work entirely through parallel infrastructure.
2. **AuthEnv isolation**: Each `CustomAgentAdapter` creates its own `AuthEnv` via `createEmptyAuthEnv()`. The DI singleton `AuthEnv` (at `SDK_TOKENS.SDK_AUTH_ENV`) must never be read or written by custom adapters.
3. **Multiple simultaneous agents**: Users can configure multiple custom agents (e.g., one Moonshot, one Z.AI) and switch between them.
4. **Secure API key storage**: API keys stored via VS Code `SecretStorage` (encrypted). Never stored in ConfigManager settings (plaintext).
5. **Provider registry alignment**: Custom agents use the same `ANTHROPIC_PROVIDERS` registry for provider definitions (base URLs, auth env vars, static models).
6. **Tier mapping support**: Each custom agent supports independent Sonnet/Opus/Haiku tier mappings, persisted per-agent in config.

### Non-Functional Requirements

- **Performance**: Custom adapter initialization should be < 100ms (no CLI detection, no OAuth flow)
- **Memory**: Each custom adapter instance adds minimal overhead (small Map, one AuthEnv object)
- **Security**: API keys never logged, never in ConfigManager, only in SecretStorage
- **Maintainability**: Custom agent code lives in isolated `custom-agent/` directory within `agent-sdk` library

### Pattern Compliance

- All DI tokens use `Symbol.for()` convention (verified: `tokens.ts:5-21`)
- All services use `@injectable()` + `@inject()` (verified: all existing services)
- All RPC handlers follow `register()` method pattern (verified: `auth-rpc.handlers.ts:53-67`)
- AuthEnv created via `createEmptyAuthEnv()` (verified: `auth-env.types.ts:19-21`)
- Provider info from `getAnthropicProvider()` (verified: `anthropic-provider-registry.ts:283-287`)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (Batches 1-3), frontend-developer (Batch 4)

**Rationale**:

- Batches 1-3 are pure TypeScript/DI/RPC work in the extension host
- Batch 4 is Angular component work in the webview
- Batches 1-3 can be done sequentially by one developer
- Batch 4 can be parallelized with Batch 3 (frontend can stub RPC types early)

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 12-18 hours total (across both developers)

**Breakdown**:

- Batch 1 (Foundation Types): 1-2 hours
- Batch 2 (Adapter + Registry): 4-6 hours (most complex -- full IAIProvider implementation)
- Batch 3 (RPC + DI Wiring): 3-4 hours
- Batch 4 (Frontend): 4-6 hours

### Files Affected Summary

**CREATE** (7 files):

- `D:\projects\ptah-extension\libs\shared\src\lib\types\custom-agent.types.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-adapter.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\index.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\custom-agent-rpc.handlers.ts`

**MODIFY** (12 files):

- `D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\types\index.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\index.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
- Frontend files (Batch 4 -- specific files depend on webview architecture investigation)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `createEmptyAuthEnv` from `@ptah-extension/shared` (file: `auth-env.types.ts:19`)
   - `getAnthropicProvider` from `anthropic-provider-registry.ts:283`
   - `getProviderAuthEnvVar` from `anthropic-provider-registry.ts:316`
   - `seedStaticModelPricing` from `anthropic-provider-registry.ts:329`
   - `resolveActualModelForPricing` from `anthropic-provider-registry.ts:375`
   - `SdkModuleLoader` from `helpers/sdk-module-loader.ts:27`
   - `SdkMessageTransformer` from `sdk-message-transformer.ts:10`
   - `SdkPermissionHandler` from `sdk-permission-handler.ts`
   - `SDKMessage`, `isResultMessage`, `isSystemInit`, `isCompactBoundary` from `claude-sdk.types.ts`

2. **All patterns verified from examples**:

   - DI token convention: `Symbol.for()` pattern from `tokens.ts:30-91`
   - DI registration: Singleton lifecycle from `register.ts:91-95`
   - RPC handler: `register()` method pattern from `auth-rpc.handlers.ts:53-67`
   - AuthEnv merge: `{ ...process.env, ...authEnv }` from `sdk-query-options-builder.ts:360`

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`
   - `libs/shared/CLAUDE.md`
   - `apps/ptah-extension-vscode/CLAUDE.md`

4. **No hallucinated APIs**:
   - All decorators verified: `@injectable()`, `@inject()` from `tsyringe`
   - All base interfaces verified: `IAIProvider` at `ai-provider.types.ts:141`
   - All utility functions verified: `createEmptyAuthEnv` at `auth-env.types.ts:19`
   - `SdkModuleLoader.getQueryFunction()` at `sdk-module-loader.ts:44`
   - `AuthSecretsService.setProviderKey(id, value)` at `auth-secrets.service.ts:292`
   - `AuthSecretsService.getProviderKey(id)` at `auth-secrets.service.ts:276`
   - `AuthSecretsService.hasProviderKey(id)` at `auth-secrets.service.ts:329`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that is team-leader's job)
- [x] Zero impact on main SdkAgentAdapter verified (no modifications to existing adapter files)
- [x] AuthEnv isolation strategy documented (createEmptyAuthEnv, not DI singleton)
- [x] API key security strategy documented (SecretStorage, not ConfigManager)

---

## Testing Considerations

### Unit Tests (Batch 2)

1. **CustomAgentAdapter**:

   - `initialize()` sets AuthEnv correctly for each provider type
   - `startChatSession()` creates isolated session with correct env vars
   - `endSession()` cleans up session from map
   - `sendMessageToSession()` queues message and wakes iterator
   - `dispose()` cleans up all sessions
   - AuthEnv isolation: verify DI singleton AuthEnv is never touched

2. **CustomAgentRegistry**:
   - `createAgent()` persists config and API key separately
   - `deleteAgent()` removes config AND API key
   - `getAdapter()` creates adapter with correct config
   - `listAgents()` returns summaries with correct runtime state
   - Multiple agents can exist simultaneously

### Integration Tests (Batch 3)

1. **Chat dispatch**: `chat:start` with `customAgentId` routes to custom adapter
2. **Chat dispatch**: `chat:start` WITHOUT `customAgentId` routes to main SDK (regression test)
3. **RPC round-trip**: Create -> List -> Update -> Delete lifecycle

### Manual Testing Checklist

1. Configure a Moonshot custom agent with valid API key
2. Send a chat message using the custom agent
3. Verify streaming works (events appear in chat UI)
4. Verify main Claude SDK still works (switch back to main provider)
5. Configure multiple custom agents simultaneously
6. Delete a custom agent and verify cleanup
7. Test with invalid API key (should show error, not crash)
