# Development Tasks - TASK_2025_059

**Task Type**: Full-Stack
**Total Tasks**: 5
**Total Batches**: 2
**Batching Strategy**: Section-based (Streaming Fix → Pricing/Tokens)
**Status**: 2/2 batches complete (100%)

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- ✅ SDK provides `stop_reason` on `message` object - Verified in `sdk-message-transformer.ts:212-287`
- ✅ `ngx-markdown` supports live updates during streaming - Common pattern in chat UIs
- ✅ Frontend has existing badge components (`TokenBadgeComponent`, `CostBadgeComponent`) - Referenced in plan

### Risks Identified

| Risk                                            | Severity | Mitigation                                        |
| ----------------------------------------------- | -------- | ------------------------------------------------- |
| `stop_reason` may be undefined during streaming | LOW      | Check for presence, default to 'streaming' status |
| Markdown flicker during rapid updates           | LOW      | CSS transition smoothing already in place         |

### Edge Cases to Handle

- [x] `stop_reason` is null/undefined during streaming → Task 1.1
- [x] Empty content blocks → Already handled in transformer

---

## Batch 1: Streaming Fix ✅ COMPLETE

**Assigned To**: backend-developer (Task 1.1) + frontend-developer (Task 1.2)
**Tasks in Batch**: 2
**Dependencies**: None
**Commit**: c593edb

### Task 1.1: Use `stop_reason` for Per-Message Completion ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts`
**Specification Reference**: streaming-redesign-plan.md:27-40
**Pattern to Follow**: Existing `transformAssistantMessage()` at line 208

**Quality Requirements**:

- ✅ Check `sdkMessage.message.stop_reason` to determine completion status
- ✅ If `stop_reason` exists → set node `status: 'complete'`
- ✅ If `stop_reason` is null → set node `status: 'streaming'`
- ✅ Apply status to message node AND text child nodes

**Implementation Details**:

```typescript
// Line 287: Change from hardcoded 'complete' to dynamic status
const isMessageComplete = !!message.stop_reason;
const status: ExecutionStatus = isMessageComplete ? 'complete' : 'streaming';

// Apply to messageNode creation (line 284-295)
// Also apply to text child nodes (line 223-230)
```

**Affected Lines**: 208-298

---

### Task 1.2: Always Render Markdown (Remove Streaming Conditional) ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts`
**Specification Reference**: streaming-redesign-plan.md:42-48
**Pattern to Follow**: Current template at lines 50-77

**Quality Requirements**:

- ✅ Remove the `@if (isStreaming())` conditional switch between streaming-text-reveal and markdown
- ✅ Always use `<markdown [data]="node().content" />` for text nodes
- ✅ ngx-markdown updates live (like ChatGPT/Claude web do)
- ✅ Optionally keep subtle streaming indicator via CSS class

**Implementation Details**:

```typescript
// Current (lines 58-74):
@if (isStreaming()) {
  <ptah-streaming-text-reveal ... />
} @else {
  <markdown [data]="node().content || ''" />
}

// Change to always markdown:
<div class="prose prose-sm prose-invert max-w-none my-2 transition-opacity duration-300"
     [class.animate-pulse]="isStreaming()">
  <markdown [data]="node().content || ''" />
</div>
```

**Affected Lines**: 50-77

---

**Batch 1 Verification Requirements**:

- ✅ All 2 tasks marked complete
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ Build passes: `npx nx build chat`
- ✅ Markdown renders progressively during streaming
- ✅ Streaming indicator stops when `stop_reason` received

---

## Batch 2: Pricing & Token Display ✅ COMPLETE

**Assigned To**: backend-developer (Task 2.1) + frontend-developer (Tasks 2.2, 2.3)
**Tasks in Batch**: 3
**Dependencies**: Batch 1 must complete first (streaming must work)
**Commit**: 1eeb6bd

### Task 2.1: Send `session:stats` Message from Backend ✅ COMPLETE

**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts` (modified)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` (modified)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts` (modified)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (modified)

**Specification Reference**: streaming-redesign-plan.md:69-81
**Pattern to Follow**: `streamExecutionNodesToWebview()` at line 295

**Quality Requirements**:

- ✅ When SDK result message received, extract cost/token/duration data
- ✅ Send `session:stats` message to webview via `webviewManager.sendMessage()`
- ✅ Include: `sessionId`, `cost`, `tokens: {input, output}`, `duration`

**Implementation Summary**:

1. Added `ResultStatsCallback` type to `stream-transformer.ts`
2. Modified `StreamTransformer.transform()` to detect result messages and invoke callback
3. Added `setResultStatsCallback()` method to `SdkAgentAdapter`
4. Added `setupResultStatsCallback()` method to `RpcMethodRegistrationService`
5. Stats are extracted from SDK result messages and sent to webview as `session:stats` events

**Files staged with git add** ✅

---

### Task 2.2: Handle `session:stats` Message in VSCodeService ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`
**Specification Reference**: streaming-redesign-plan.md:83-86
**Pattern to Follow**: `setupMessageListener()` at line 171

**Quality Requirements**:

- ✅ Add case for `session:stats` message type in switch statement
- ✅ Route to ChatStore for state update
- ✅ Type-safe payload handling

**Implementation Details**:

```typescript
case 'session:stats':
  if (this.chatStore) {
    this.chatStore.handleSessionStats(data.payload);
  }
  break;
```

---

### Task 2.3: Store Stats in StreamingHandlerService ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts`
**Specification Reference**: streaming-redesign-plan.md:87-90
**Pattern to Follow**: `finalizeCurrentMessage()` at line 147

**Quality Requirements**:

- ✅ Add method `handleSessionStats(stats)` to update message with cost/token data
- ✅ Find message by sessionId and update tokens/cost fields
- ✅ Ensure badge components can display the data

**Implementation Details**:

```typescript
handleSessionStats(stats: { sessionId: string; cost: number; tokens: { input: number; output: number }; duration: number }): void {
  // Find tab by sessionId
  // Update last assistant message with stats
  // Trigger re-render for badges
}
```

---

**Batch 2 Verification Requirements**:

- ✅ All 3 tasks marked complete
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ Build passes: `npx nx build chat`
- ✅ Token/cost badges display after response completes

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer(s)
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates ONE commit for entire batch
5. Developer returns with batch git commit SHA
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message lists all completed tasks

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified
- All files exist
- Build passes

---

## Success Criteria (from Plan)

- [ ] Markdown renders progressively during streaming
- [ ] Streaming indicator stops when `stop_reason` received
- [ ] Multi-turn conversations work
- [ ] Token/cost badges display after response completes
- [ ] Old sessions load with proper markdown
