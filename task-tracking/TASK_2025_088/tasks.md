# Development Tasks - TASK_2025_088

**Total Tasks**: 23 | **Batches**: 6 | **Status**: 0/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Session metadata store exists and implemented correctly
- `sdk-session-storage.ts` already deleted (confirmed in git status)
- StreamTransformer message storage already removed (verified in code)
- Helper classes exist and can be inlined with dependency handling

### Risks Identified

| Risk                                            | Severity | Mitigation                                                |
| ----------------------------------------------- | -------- | --------------------------------------------------------- |
| SDK type consolidation NOT a simple import swap | HIGH     | Batch 1 creates type guards first, then gradual migration |
| JSON.parse data loss in ExecutionTreeBuilder    | HIGH     | Batch 2 high-priority fix with error handling             |
| Helper inlining requires DI token removal       | MEDIUM   | Batch 3 handles dependencies carefully                    |

### Edge Cases to Handle

- [ ] Property access patterns change from bracket notation to dot notation → Handled in Batch 1
- [ ] JSON.parse failures need UI error display → Handled in Batch 2
- [ ] Injected dependencies need local alternatives → Handled in Batch 3

---

## Batch 1: SDK Type Consolidation (Backend) 🔄 IN PROGRESS

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create Type Guards for SDK Message Transformer 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: purge-over-engineered-layers.md:60-96, claude-sdk.types.ts:459-639
**Pattern to Follow**: claude-sdk.types.ts:465-638

**Quality Requirements**:

- Use type guards from claude-sdk.types.ts (isStreamEvent, isResultMessage, isSystemInit, etc.)
- Replace `msg['property']` bracket notation with type-safe dot notation
- NO type casts (`as Type`)
- Handle ALL SDK message types in discriminated union

**Implementation Details**:

- Imports: Import type guards from '../types/sdk-types/claude-sdk.types'
- Replace lines 30-86: Delete local type definitions
- Add type guards before each property access
- Key Logic: Use `if (isStreamEvent(msg)) { msg.event.type }` instead of `msg['event']['type']`

**Validation Notes**:

- RISK: Current code uses `[key: string]: any` - new types are strict discriminated unions
- Must refactor ALL property accesses to use dot notation after type narrowing
- Test with multiple SDK message types to ensure no runtime errors

---

### Task 1.2: Update Stream Transformer to Use SDK Types 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts
**Dependencies**: Task 1.1

**Quality Requirements**:

- Import SDKMessage, SDKResultMessage from claude-sdk.types.ts
- Remove local type definitions (lines 27-30)
- Use isResultMessage type guard
- Use isSystemInit type guard

**Implementation Details**:

- Imports: `import { SDKMessage, SDKResultMessage, isResultMessage, isSystemInit } from '../types/sdk-types/claude-sdk.types'`
- Delete lines 27-30 (local SDKMessage definition)
- Replace `sdkMessage.type === 'result'` with `isResultMessage(sdkMessage)`
- Replace `sdkMessage.type === 'system' && sdkMessage['subtype'] === 'init'` with `isSystemInit(sdkMessage)`

**Validation Notes**:

- Check that stats extraction still works with typed SDKResultMessage
- Verify session ID callback receives correct type

---

### Task 1.3: Update SDK Permission Handler to Use SDK Types 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
**Dependencies**: Task 1.1

**Quality Requirements**:

- Remove duplicate SDK type definitions (purge-over-engineered-layers.md:63-75)
- Import from claude-sdk.types.ts
- Use type guards for narrowing

**Implementation Details**:

- Imports: Import ContentBlock, ToolUseBlock, isToolUseBlock from claude-sdk.types.ts
- Delete local type definitions (lines 1-75 approximate)
- Use isToolUseBlock(block) type guard
- Use block.input (typed as Record<string, unknown>)

**Validation Notes**:

- Verify permission callback parameters are correctly typed
- Test with real tool permission requests

---

### Task 1.4: Update Session Lifecycle Manager to Use SDK Types 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts
**Dependencies**: Task 1.1

**Quality Requirements**:

- Remove duplicate SDK type definitions (purge-over-engineered-layers.md:67)
- Import from claude-sdk.types.ts

**Implementation Details**:

- Imports: Import SDKMessage, SDKSystemMessage from claude-sdk.types.ts
- Delete local type definitions (lines 36-72 approximate)
- Use isSystemInit type guard

**Validation Notes**:

- Verify session lifecycle events fire correctly

---

**Batch 1 Verification**:

- All files import from claude-sdk.types.ts (no local duplicates)
- Build passes: `npx nx build agent-sdk`
- Typecheck passes: `npx nx run agent-sdk:typecheck`
- No `any` types in SDK message handling code
- All property accesses use dot notation after type guards

---

## Batch 2: Fix JSON.parse Data Loss (Frontend) 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None (high priority, independent)

### Task 2.1: Add Safe JSON Parser with Error Tracking 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Spec Reference**: purge-over-engineered-layers.md:355-392, type-safety-report.md:206-324
**Pattern to Follow**: type-safety-report.md:298-324

**Quality Requirements**:

- Create ParseResult<T> type with success/failure branches
- NO silent failures (no `catch { return undefined }`)
- Return parse errors for UI display
- Log parse failures with context

**Implementation Details**:

- Add interface before class:

```typescript
interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: string;
}
```

- Create private method:

```typescript
private parseToolInput(input: string): ParseResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, error: 'Not an object', raw: input };
    }
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: String(e), raw: input };
  }
}
```

**Validation Notes**:

- CRITICAL: This fixes data loss bug reported in type-safety-report.md:209
- Must preserve raw input on parse failure for debugging
- Test with malformed JSON, non-object JSON, valid JSON

---

### Task 2.2: Update Tool Input Parsing to Use Safe Parser 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts
**Dependencies**: Task 2.1

**Quality Requirements**:

- Replace unsafe JSON.parse (lines 292-303)
- Surface parse errors in ExecutionNode
- Preserve original input for debugging

**Implementation Details**:

- Find current code:

```typescript
try {
  toolInput = JSON.parse(inputString);
} catch {
  toolInput = undefined; // DELETE THIS
}
```

- Replace with:

```typescript
const result = this.parseToolInput(inputString);
if (result.success) {
  toolInput = result.data;
} else {
  toolInput = { __parseError: result.error, __raw: result.raw };
  this.logger.warn('[ExecutionTreeBuilder] Tool input parse failed', {
    eventId,
    error: result.error,
    raw: result.raw.substring(0, 100), // Log first 100 chars
  });
}
```

**Validation Notes**:

- ExecutionNode.toolInput type needs to allow `{ __parseError: string, __raw: string }`
- Update ExecutionNode type if needed
- Test with broken tool inputs from real SDK messages

---

### Task 2.3: Update UI Components to Display Parse Errors 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-call-header.component.ts
**Dependencies**: Task 2.2

**Quality Requirements**:

- Check for `__parseError` in toolInput
- Display error message in UI
- Show raw JSON for debugging

**Implementation Details**:

- Add computed signal:

```typescript
readonly hasParseError = computed(() => {
  const input = this.node().toolInput;
  return input && typeof input === 'object' && '__parseError' in input;
});

readonly parseError = computed(() => {
  const input = this.node().toolInput as any;
  return input?.__parseError;
});
```

- Update template:

```html
@if (hasParseError()) {
<div class="parse-error">
  <span class="error-icon">⚠</span>
  Parse Error: {{ parseError() }}
  <button (click)="showRawInput()">Show Raw JSON</button>
</div>
}
```

**Validation Notes**:

- Apply similar pattern to all tool display components
- List: tool-call-header.component.ts, permission-request-card.component.ts, code-output.component.ts, tool-output-display.component.ts

---

**Batch 2 Verification**:

- No silent JSON.parse failures
- Parse errors visible in UI
- Build passes: `npx nx build ptah-extension-webview`
- Typecheck passes: `npx nx run chat:typecheck`
- Manual test: Send message with intentionally broken tool JSON

---

## Batch 3: Inline Helper Classes (Backend) ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 complete

### Task 3.1: Read Helper Dependencies and Plan Inlining ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\user-message-stream-factory.ts
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-builder.ts
**Spec Reference**: purge-over-engineered-layers.md:261-318

**Quality Requirements**:

- Document all injected dependencies
- Identify which dependencies need to be parameters
- Plan method signatures for inlined versions

**Implementation Details**:

- Read UserMessageStreamFactory constructor
- Read SdkQueryBuilder constructor
- List all `@inject()` dependencies
- Note which can become method parameters
- Note which need to stay as class fields in SdkAgentAdapter

**Validation Notes**:

- UserMessageStreamFactory likely injects: Logger, possibly EventBus
- SdkQueryBuilder likely injects: AttachmentProcessor, Logger

---

### Task 3.2: Inline UserMessageStreamFactory into SdkAgentAdapter ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
**Dependencies**: Task 3.1

**Quality Requirements**:

- Copy logic as private method
- Remove factory wrapper boilerplate
- Handle dependencies via existing injected services
- Update all call sites

**Implementation Details**:

- Add private method to SdkAgentAdapter:

```typescript
private createUserMessageStream(
  sessionId: SessionId,
  abortController: AbortController
): AsyncIterable<SDKUserMessage> {
  // Copy implementation from UserMessageStreamFactory.create()
  // Use this.logger instead of injected logger
}
```

- Find all usages of `this.userMessageStreamFactory.create()`
- Replace with `this.createUserMessageStream()`
- Delete UserMessageStreamFactory file after

**Validation Notes**:

- Saves 129 lines (purge-over-engineered-layers.md:273)
- Verify AbortController handling still works

---

### Task 3.3: Inline SdkQueryBuilder into SdkAgentAdapter ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
**Dependencies**: Task 3.1

**Quality Requirements**:

- Copy logic as private method
- Remove class wrapper boilerplate
- Handle AttachmentProcessor dependency
- Update all call sites

**Implementation Details**:

- Add private method to SdkAgentAdapter:

```typescript
private async buildQueryOptions(config: QueryBuildConfig): Promise<SdkQueryOptions> {
  // Copy implementation from SdkQueryBuilder.build()
  // Use this.attachmentProcessor for processing
}
```

- Find all usages of `this.queryBuilder.build()`
- Replace with `this.buildQueryOptions()`
- Delete SdkQueryBuilder file after

**Validation Notes**:

- Saves 172 lines (purge-over-engineered-layers.md:296)
- Verify attachment processing still works

---

### Task 3.4: Remove DI Tokens for Inlined Helpers ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts
**Dependencies**: Task 3.2, Task 3.3

**Quality Requirements**:

- Remove SDK_TOKENS.USER_MESSAGE_STREAM_FACTORY
- Remove SDK_TOKENS.QUERY_BUILDER
- Remove registrations in register.ts
- Update SdkAgentAdapter constructor to not inject these

**Implementation Details**:

- Delete from tokens.ts:

```typescript
// DELETE:
USER_MESSAGE_STREAM_FACTORY: Symbol('SDK_USER_MESSAGE_STREAM_FACTORY'),
QUERY_BUILDER: Symbol('SDK_QUERY_BUILDER'),
```

- Delete from register.ts:

```typescript
// DELETE:
container.register(SDK_TOKENS.USER_MESSAGE_STREAM_FACTORY, UserMessageStreamFactory);
container.register(SDK_TOKENS.QUERY_BUILDER, SdkQueryBuilder);
```

- Update SdkAgentAdapter constructor: remove @inject() decorators for these

**Validation Notes**:

- Build must pass after token removal
- No orphaned imports

---

### Task 3.5: Delete Inlined Helper Files ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\user-message-stream-factory.ts
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-builder.ts
**Dependencies**: Task 3.4

**Quality Requirements**:

- Verify no remaining imports
- Update index.ts exports
- Delete files completely

**Implementation Details**:

- Glob search for imports: `import.*UserMessageStreamFactory`
- Glob search for imports: `import.*SdkQueryBuilder`
- Confirm zero results
- Delete both files
- Remove from `helpers/index.ts` exports

**Validation Notes**:

- Saves 301 lines total
- Build must pass after deletion

---

**Batch 3 Verification**:

- UserMessageStreamFactory and SdkQueryBuilder deleted
- DI tokens removed
- Build passes: `npx nx build agent-sdk`
- Session creation and message sending still work
- No factory/builder references remain

---

## Batch 4: Delete Dead Code (Backend + Frontend) ⏸️ PENDING

**Developer**: backend-developer (for backend files), frontend-developer (for frontend files)
**Tasks**: 4 | **Dependencies**: None (independent cleanup)

### Task 4.1: Delete Deprecated Message Types ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts
**Spec Reference**: purge-over-engineered-layers.md:44-56

**Quality Requirements**:

- Delete deprecated type aliases (lines 228-231 approximate)
- Search codebase for usages
- Replace with new types if any found

**Implementation Details**:

- Delete:

```typescript
/** @deprecated Use SDK_PERMISSION_RESPONSE instead */
CHAT_PERMISSION_RESPONSE: 'chat:permission-response',  // Line 229

/** @deprecated Use MCP_PERMISSION_RESPONSE instead */
PERMISSION_RESPONSE: 'permission:response',  // Line 231
```

- Grep for 'CHAT_PERMISSION_RESPONSE'
- Grep for 'PERMISSION_RESPONSE'
- Replace with SDK_PERMISSION_RESPONSE or MCP_PERMISSION_RESPONSE

**Validation Notes**:

- These are marked deprecated, should be safe to remove
- Check if any code still references old types

---

### Task 4.2: Remove Orphaned Imports from Test Files ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\conversation.service.spec.ts
**Spec Reference**: purge-over-engineered-layers.md:36-42

**Quality Requirements**:

- Remove import for deleted PendingSessionManagerService
- Remove variable declarations
- Remove TestBed.inject() calls
- Clean up test structure if needed

**Implementation Details**:

- Delete line 24 (approximate):

```typescript
import { PendingSessionManagerService } from '../pending-session-manager.service';
```

- Delete line 30 (approximate):

```typescript
let pendingSessionManager: PendingSessionManagerService;
```

- Remove from TestBed.inject() (line 98 approximate)
- Remove variable reference (line 108 approximate)

**Validation Notes**:

- Test file should still compile
- Run tests to verify: `npx nx test chat`

---

### Task 4.3: Delete Dead Test Files ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\pending-session-manager.service.spec.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\message-sender.service.spec.ts
**Spec Reference**: purge-over-engineered-layers.md:28-32

**Quality Requirements**:

- Verify corresponding service files are already deleted
- Delete test files

**Implementation Details**:

- Verify `pending-session-manager.service.ts` does not exist
- Verify `message-sender.service.ts` does not exist (or will be deleted in next batch)
- Delete `.spec.ts` files

**Validation Notes**:

- Saves ~300 lines
- Test suite should pass without these

---

### Task 4.4: Scan and Remove All Orphaned Helper Imports ⏸️ PENDING

**File**: All files in D:\projects\ptah-extension\libs\backend\agent-sdk\
**Dependencies**: Batch 3 complete

**Quality Requirements**:

- Grep for imports of deleted files
- Remove orphaned imports
- Verify no runtime errors

**Implementation Details**:

- Grep: `import.*StreamTransformer` (if deleted)
- Grep: `import.*UserMessageStreamFactory`
- Grep: `import.*SdkQueryBuilder`
- Remove all found imports
- Verify files still compile

**Validation Notes**:

- May find imports in test files
- Update tests if needed

---

**Batch 4 Verification**:

- No deprecated message types in message.types.ts
- No orphaned imports in test files
- Build passes: `npx nx build:all`
- Test passes: `npx nx run-many --target=test`

---

## Batch 5: Type Safety Fixes (Backend + Frontend) ⏸️ PENDING

**Developer**: backend-developer (for backend), frontend-developer (for frontend)
**Tasks**: 4 | **Dependencies**: Batch 1, Batch 2 complete

### Task 5.1: Replace `any` with Proper Types in SDK RPC Handlers ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\sdk-rpc-handlers.ts
**Spec Reference**: purge-over-engineered-layers.md:325-332, type-safety-report.md:219-223

**Quality Requirements**:

- Replace `modifiedInput?: any` with `Record<string, unknown>`
- Replace `payload: any` with `FlatStreamEventUnion`
- Use generic typed sendMessage<T>()
- NO `any` types

**Implementation Details**:

- Line 48: `modifiedInput?: any` → `modifiedInput?: Record<string, unknown>`
- Line 52: `payload: any` → `payload: FlatStreamEventUnion`
- Line 57: `sendMessage(..., any)` → `sendMessage<FlatStreamEventUnion>(...)`
- Line 97: `payload: any` → Typed event union

**Validation Notes**:

- Import FlatStreamEventUnion from @ptah-extension/shared
- Verify RPC messages are correctly typed
- Test message sending end-to-end

---

### Task 5.2: Add Type Guards for UI Component Tool Input Access ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\tool-call-header.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\permission-request-card.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\code-output.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\tool-output-display.component.ts
**Spec Reference**: type-safety-report.md:237-244, purge-over-engineered-layers.md:343-363

**Quality Requirements**:

- Create type guards for each tool type (Read, Bash, Grep, Task, etc.)
- Replace `toolInput?.['file_path'] as string` with type-safe access
- NO bracket notation
- NO type casts

**Implementation Details**:

- Create file: `libs/shared/src/lib/type-guards/tool-guards.ts`
- Add type guards:

```typescript
export interface ReadToolInput {
  file_path: string;
  limit?: number;
  offset?: number;
}

export function isReadToolInput(input: unknown): input is ReadToolInput {
  return typeof input === 'object' && input !== null && 'file_path' in input && typeof (input as any).file_path === 'string';
}

// Similar for BashToolInput, GrepToolInput, TaskToolInput, etc.
```

- Update components to use type guards:

```typescript
readonly filePath = computed(() => {
  const input = this.node().toolInput;
  return isReadToolInput(input) ? input.file_path : null;
});
```

**Validation Notes**:

- Apply to all 15+ bracket notation violations (type-safety-report.md:237)
- Test with real tool inputs from SDK

---

### Task 5.3: Fix Type Casts in Session Loader Service ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
**Spec Reference**: type-safety-report.md:223-226

**Quality Requirements**:

- Replace `as StoredSessionMessage[]` with type guard
- Replace `as FlatStreamEventUnion` with validation
- Replace `as ExecutionNode[]` with validation

**Implementation Details**:

- Line 231: Add validation:

```typescript
function isStoredSessionMessageArray(value: unknown): value is StoredSessionMessage[] {
  return Array.isArray(value) && value.every(isStoredSessionMessage);
}

const messages = isStoredSessionMessageArray(data.messages) ? data.messages : [];
```

- Line 562: Add validation for FlatStreamEventUnion
- Line 801: Add validation for ExecutionNode[]

**Validation Notes**:

- May need to create isStoredSessionMessage type guard
- Log validation failures for debugging

---

### Task 5.4: Remove Type Casts from SDK Message Transformer ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Dependencies**: Task 1.1 (type guards exist)
**Spec Reference**: type-safety-report.md:217-219

**Quality Requirements**:

- Replace casts at lines 669, 672, 675 with type guards
- Create TaskToolInput interface
- Use type guard for safe access

**Implementation Details**:

- Create interface:

```typescript
interface TaskToolInput {
  subagent_type?: string;
  description?: string;
  prompt?: string;
}

function isTaskToolInput(input: unknown): input is TaskToolInput {
  return typeof input === 'object' && input !== null && ('subagent_type' in input || 'description' in input || 'prompt' in input);
}
```

- Replace lines 669-675:

```typescript
// DELETE:
const subagentType = (block.input as { subagent_type?: string }).subagent_type;

// REPLACE WITH:
if (isTaskToolInput(block.input)) {
  const { subagent_type, description, prompt } = block.input;
  // Use typed properties
}
```

**Validation Notes**:

- Test with Task tool invocations
- Verify subagent calls work correctly

---

**Batch 5 Verification**:

- Zero `any` usages in RPC handlers
- Zero type casts in UI components
- Zero bracket notation in tool input access
- Build passes: `npx nx build:all`
- Typecheck passes: `npx nx typecheck:all`
- Lint passes: `npx nx lint:all`

---

## Batch 6: Final Cleanup and Documentation ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: All previous batches complete

### Task 6.1: Update Index Exports ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts

**Quality Requirements**:

- Remove exports for deleted files
- Add exports for new types
- Verify public API is clean

**Implementation Details**:

- Remove from exports:

```typescript
// DELETE:
export * from './lib/sdk-session-storage';
export * from './lib/helpers/user-message-stream-factory';
export * from './lib/helpers/sdk-query-builder';
```

- Add new exports:

```typescript
// ADD:
export * from './lib/session-metadata-store';
export * from './lib/types/sdk-types/claude-sdk.types';
```

**Validation Notes**:

- Verify consuming code (apps/ptah-extension-vscode) still imports correctly

---

### Task 6.2: Update CLAUDE.md Documentation ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md

**Quality Requirements**:

- Update architecture diagram (remove deleted services)
- Update key files list
- Update usage examples
- Add migration notes

**Implementation Details**:

- Remove from architecture diagram:
  - SdkSessionStorage
  - UserMessageStreamFactory
  - SdkQueryBuilder
- Add to architecture:
  - SessionMetadataStore
- Update file list
- Add section: "Migration Notes - TASK_2025_088"

**Validation Notes**:

- Documentation should reflect actual codebase state

---

### Task 6.3: Create Migration Summary Report ⏸️ PENDING

**File**: D:\projects\ptah-extension\task-tracking\TASK_2025_088\migration-summary.md

**Quality Requirements**:

- Document all deleted files with line counts
- Document all inlined code
- Document type safety improvements
- List remaining risks or tech debt

**Implementation Details**:

- Create markdown report with sections:
  - Files Deleted (with line counts)
  - Code Inlined (with line savings)
  - Type Safety Metrics (before/after)
  - Breaking Changes (if any)
  - Remaining Tech Debt
  - Performance Impact

**Validation Notes**:

- Use as reference for future migrations
- Share with team for review

---

**Batch 6 Verification**:

- All exports correct
- Documentation up-to-date
- Migration summary created
- Build passes: `npx nx build:all`
- All tests pass: `npx nx run-many --target=test`

---

## Final Acceptance Criteria

**Code Reduction**:

- [ ] 2,778+ lines removed (purge-over-engineered-layers.md target)
- [ ] No redundant type definitions
- [ ] No wrapper classes without value

**Type Safety**:

- [ ] Zero `any` usages in SDK message handling
- [ ] Zero type casts in production code
- [ ] All bracket notation replaced with type guards
- [ ] JSON.parse failures properly handled

**Architecture**:

- [ ] SDK types centralized in claude-sdk.types.ts
- [ ] Helper logic inlined (no unnecessary classes)
- [ ] Session metadata separate from message storage
- [ ] All dead code removed

**Quality Gates**:

- [ ] `npx nx build:all` passes
- [ ] `npx nx typecheck:all` passes
- [ ] `npx nx lint:all` passes
- [ ] Manual testing: Session creation, messaging, permissions work

---

## Estimated Effort

| Batch                           | Tasks  | Estimated Time  |
| ------------------------------- | ------ | --------------- |
| Batch 1: SDK Type Consolidation | 4      | 4-5 hours       |
| Batch 2: JSON.parse Fix         | 3      | 3-4 hours       |
| Batch 3: Helper Inlining        | 5      | 5-6 hours       |
| Batch 4: Dead Code Cleanup      | 4      | 2-3 hours       |
| Batch 5: Type Safety Fixes      | 4      | 4-5 hours       |
| Batch 6: Final Cleanup          | 3      | 2-3 hours       |
| **Total**                       | **23** | **20-26 hours** |
