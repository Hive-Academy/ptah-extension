# Development Tasks - TASK_2025_167

**Total Tasks**: 12 | **Batches**: 4 (sequential) | **Status**: IN PROGRESS

## Batch 1: Foundation Types (Shared Library)

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Extend ProviderId union type

**File**: `libs/shared/src/lib/types/ai-provider.types.ts`
**Action**: MODIFY — Add `'custom-agent'` to `ProviderId` union, update `isValidProviderId()` and `PROVIDER_IDS`
**Status**: IMPLEMENTED

### Task 1.2: Create CustomAgent type definitions

**File**: `libs/shared/src/lib/types/custom-agent.types.ts`
**Action**: CREATE — `CustomAgentConfig`, `CustomAgentState`, `CustomAgentSummary` interfaces
**Status**: IMPLEMENTED

### Task 1.3: Add Custom Agent RPC types

**File**: `libs/shared/src/lib/types/rpc.types.ts`
**Action**: MODIFY — Add Custom Agent RPC param/result types, add `customAgentId` to `ChatStartParams`
**Status**: IMPLEMENTED

### Task 1.4: Export new types from shared barrel

**File**: `libs/shared/src/lib/types/index.ts`
**Action**: MODIFY — Export `custom-agent.types.ts`
**Status**: IMPLEMENTED

## Batch 2: Custom Agent Adapter + Registry (Agent SDK Library)

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Create CustomAgentAdapter (IAIProvider implementation)

**File**: `libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-adapter.ts`
**Action**: CREATE — Full IAIProvider with isolated AuthEnv, session tracking, stream transformation
**Status**: IMPLEMENTED

### Task 2.2: Create CustomAgentRegistry

**File**: `libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-registry.ts`
**Action**: CREATE — Manages configs (ConfigManager), API keys (AuthSecretsService), adapter lifecycle
**Status**: IMPLEMENTED

### Task 2.3: DI token + registration + barrel exports

**Files**:

- `libs/backend/agent-sdk/src/lib/custom-agent/index.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY)
- `libs/backend/agent-sdk/src/index.ts` (MODIFY)
  **Status**: IMPLEMENTED

## Batch 3: RPC Handlers + DI Wiring (Extension App)

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2

### Task 3.1: Create Custom Agent RPC handlers

**File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/custom-agent-rpc.handlers.ts`
**Action**: CREATE — RPC handlers for customAgent:list/create/update/delete/testConnection/listModels/getProviders
**Status**: IMPLEMENTED

### Task 3.2: Wire RPC handlers + Chat dispatch + Extension activation

**Files**:

- `apps/ptah-extension-vscode/src/services/rpc/index.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/di/container.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/main.ts` (MODIFY)
  **Status**: IMPLEMENTED

## Batch 4: Frontend Integration (Webview)

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 3

### Task 4.1: Custom Agent Settings Component

**Action**: CREATE — Settings UI for CRUD operations on custom agents
**Status**: IMPLEMENTED

### Task 4.2: Agent Selector + Chat Integration

**Action**: MODIFY — Add custom agents to agent selector, pass customAgentId in chat:start
**Status**: IMPLEMENTED
