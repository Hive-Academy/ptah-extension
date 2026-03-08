# TASK_2025_083: RPC Message Batching for UI Initialization

## Overview

Implement message batching for initial UI load to reduce round-trips from N to 1.

## Problem

Currently, UI initialization makes multiple sequential RPC calls:

- `config:model:get`
- `llm:getProviderStatus`
- `session:list`
- etc.

Each call is a separate round-trip through VS Code's postMessage API.

## Proposed Solution

### Frontend: Add `callBatch` method to ClaudeRpcService

```typescript
async callBatch<T extends RpcMethodName[]>(
  calls: { method: T[number]; params: RpcMethodParams<T[number]> }[]
): Promise<RpcResult<unknown>[]> {
  // Single RPC call with array of sub-calls
  const result = await this.call('rpc:batch', { calls });
  return result.data as RpcResult<unknown>[];
}
```

### Backend: Add `rpc:batch` handler

```typescript
rpcHandler.registerMethod<BatchRequest, BatchResult>('rpc:batch', async (params) => {
  const results = await Promise.all(params.calls.map((call) => this.handleMessage(call)));
  return results;
});
```

## Expected Impact

- Reduces initial page load round-trips from 3-5 to 1
- Improves perceived performance

## Files to Modify

- `libs/frontend/core/src/lib/services/claude-rpc.service.ts`
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
- `libs/shared/src/lib/types/rpc.types.ts`

## Status

**Created:** 2025-12-17
**Priority:** Low (optimization)
**Status:** Pending
