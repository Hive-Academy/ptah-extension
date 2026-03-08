# Development Tasks - TASK_2025_164

**Total Tasks**: 6 | **Batches**: 2 (parallel) | **Status**: IN PROGRESS

## Batch 1: Foundation + Writers (AuthEnv type, DI, AuthManager, ProviderModelsService)

**Developer**: backend-developer
**Tasks**: 3

### Task 1.1: Create AuthEnv type and DI infrastructure

**Files**:

- CREATE `libs/shared/src/lib/types/auth-env.types.ts`
- MODIFY `libs/shared/src/index.ts`
- MODIFY `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- MODIFY `libs/backend/agent-sdk/src/lib/di/register.ts`
  **Status**: IMPLEMENTED

### Task 1.2: Refactor AuthManager to write AuthEnv instead of process.env

**File**: `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`
**Status**: IMPLEMENTED

### Task 1.3: Refactor ProviderModelsService to write AuthEnv instead of process.env

**File**: `libs/backend/agent-sdk/src/lib/provider-models.service.ts`
**Status**: IMPLEMENTED

## Batch 2: Readers (SdkQueryOptionsBuilder, resolveActualModelForPricing, callers)

**Developer**: backend-developer
**Tasks**: 3

### Task 2.1: Refactor SdkQueryOptionsBuilder to merge AuthEnv with process.env

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
**Status**: IMPLEMENTED

### Task 2.2: Add optional authEnv param to resolveActualModelForPricing

**File**: `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts`
**Status**: IMPLEMENTED

### Task 2.3: Update all callers of resolveActualModelForPricing to inject and pass AuthEnv

**Files**:

- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts`
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` (applicable - calls resolveActualModelForPricing directly)
  **Status**: IMPLEMENTED
