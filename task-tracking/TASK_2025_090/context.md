# TASK_2025_090: SDK Message Flow Type Safety (100% Coverage)

## Context

From the type safety analysis in TASK_2025_088, we identified gaps in the SDK message flow that prevent 100% type safety. This task addresses the remaining issues to achieve complete type safety from UI to agent-sdk and back.

## Current State: 85% Type-Safe

After TASK_2025_088 and TASK_2025_089:

- ✅ Permission handler uses `Record<string, unknown>` (not `any`)
- ✅ Tool input type guards created (9 guards in `tool-input-guards.ts`)
- ✅ Session storage conversion code removed (591 lines deleted)
- ✅ SDK types centralized in `claude-sdk.types.ts`

## Remaining Gaps (15%)

### 1. No Exhaustiveness Checking in Event Handlers

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts:193-321`

**Problem**: Switch statement on `event.eventType` has no `default` case. If a new event type is added, it will silently be ignored.

**Fix**: Add `assertNever()` helper and use in default case.

### 2. `any` Types in SDK Adapter

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:185`

**Problem**: `canUseTool: any` should be properly typed with SDK's callback signature.

### 3. `any` Types in Session Lifecycle Manager

**File**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:35-37`

**Problem**: Iterator interface uses `any`:

```typescript
next(...args: any[]): Promise<IteratorResult<any, void>>;
return?(value?: any): Promise<IteratorResult<any, void>>;
throw?(e?: any): Promise<IteratorResult<any, void>>;
```

### 4. `any` Type in Tree Builder

**File**: `libs/frontend/chat/src/lib/services/tree-builder.service.ts:211`

**Problem**: `appendToolUse(tree: ExecutionNode, block: any)` should use proper SDK block type.

## Target State: 100% Type-Safe

After this task:

- All switch statements on discriminated unions have exhaustiveness checking
- No `any` types in SDK message flow
- Compiler catches missing event handlers at build time
- Type guards used consistently across frontend and backend

## Success Criteria

- [ ] `assertNever()` helper added to shared library
- [ ] All event switches use exhaustiveness checking
- [ ] No `any` types in SDK-related files
- [ ] `npm run typecheck:all` passes
- [ ] `npm run lint:all` passes
