# TASK_2025_090: Implementation Tasks

## Status: ✅ Complete

## Reference: Official SDK Types

The official SDK types are in:
`node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`

Key types we need:

- `CanUseTool` - Permission callback signature (line 145-171)
- `SDKMessage` - Union of all message types (line 513)
- `Query` - AsyncGenerator interface (line 514-589)
- `Options` - Query options (line 685-1014)

---

## Batch 1: Add Exhaustiveness Helper & Fix Event Handlers

### Task 1.1: Create `assertNever` Helper

**File**: `libs/shared/src/lib/utils/assert-never.ts`

```typescript
/**
 * Exhaustiveness checking helper for discriminated unions.
 * Use in default case of switch statements to get compile-time errors
 * when new union members are added.
 *
 * @example
 * switch (event.eventType) {
 *   case 'text_delta': return handleTextDelta(event);
 *   case 'tool_start': return handleToolStart(event);
 *   default: return assertNever(event); // Compiler error if case missing!
 * }
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}
```

Export from `libs/shared/src/index.ts`.

### Task 1.2: Add Exhaustiveness to StreamingHandlerService

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

Add `default: assertNever(event)` to the switch at line 193-321.

Note: May need to handle `tool_result` and other event types that might be in the union but not currently handled.

### Task 1.3: Audit All Event Switches

Search for other switches on `eventType` and add exhaustiveness checking.

---

## Batch 2: Eliminate `any` Types

### Task 2.1: Fix `canUseTool` Type

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:185`

Replace:

```typescript
canUseTool: any;
```

With proper SDK callback type:

```typescript
canUseTool: (toolName: string, toolInput: Record<string, unknown>) => boolean | Promise<boolean>;
```

### Task 2.2: Fix Iterator Interface

**File**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:35-37`

Replace `any` with proper generic types:

```typescript
interface TypedAsyncIterator<T> {
  next(...args: []): Promise<IteratorResult<T, void>>;
  return?(value?: void): Promise<IteratorResult<T, void>>;
  throw?(e?: unknown): Promise<IteratorResult<T, void>>;
}
```

### Task 2.3: Fix Tree Builder Block Type

**File**: `libs/frontend/chat/src/lib/services/tree-builder.service.ts:211`

Replace:

```typescript
appendToolUse(tree: ExecutionNode, block: any): ExecutionNode
```

With proper type from SDK or shared:

```typescript
import type { ToolUseBlock } from '@ptah-extension/shared';
appendToolUse(tree: ExecutionNode, block: ToolUseBlock): ExecutionNode
```

---

## Batch 3: Verification

### Task 3.1: Run Quality Gates

```bash
npm run typecheck:all
npm run lint:all
npm run build:all
```

### Task 3.2: Search for Remaining `any`

```bash
grep -r ": any" libs/backend/agent-sdk/src --include="*.ts"
grep -r ": any" libs/frontend/chat/src --include="*.ts"
```

Ensure no `any` types remain in SDK message flow.

---

## Files to Modify

| File                                                                          | Change              |
| ----------------------------------------------------------------------------- | ------------------- |
| `libs/shared/src/lib/utils/assert-never.ts`                                   | CREATE              |
| `libs/shared/src/index.ts`                                                    | Export assertNever  |
| `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` | Add default case    |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                         | Fix canUseTool type |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`         | Fix iterator types  |
| `libs/frontend/chat/src/lib/services/tree-builder.service.ts`                 | Fix block type      |

## Completion Checklist

- [ ] `assertNever` helper created and exported
- [ ] All event switches have exhaustiveness checking
- [ ] No `any` types in SDK-related files
- [ ] All quality gates pass
