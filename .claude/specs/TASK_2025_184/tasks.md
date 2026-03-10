# Development Tasks - TASK_2025_184: Reasoning Effort Configuration

**Total Tasks**: 10 | **Batches**: 2 | **Status**: 0/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `AISessionConfig` currently has no thinking/effort fields: VERIFIED (ai-provider.types.ts:83-108)
- `ChatStartParams.options` pattern extensible with optional fields: VERIFIED (rpc.types.ts:61-76)
- `SdkQueryOptions` missing thinking/effort: VERIFIED (sdk-query-options-builder.ts:259-289)
- `Options` interface in local SDK types missing thinking/effort: VERIFIED (claude-sdk.types.ts:1539-1637)
- `sessionConfig` flows as-is through SessionLifecycleManager to QueryOptionsBuilder: VERIFIED (sdk-agent-adapter.ts:398, session-lifecycle-manager.ts)
- `PtahCliAdapter.buildQueryOptions` uses separate input object, needs explicit threading: VERIFIED (ptah-cli-adapter.ts:736-894)
- `ChatRpcHandlers` extracts options and passes to adapter: VERIFIED (chat-rpc.handlers.ts:699-713)
- `ChatContinueParams` has flat fields (no options object): VERIFIED (rpc.types.ts:86-106)
- `MessageSenderService` passes `options` to `chat:start` and flat fields to `chat:continue`: VERIFIED (message-sender.service.ts:317-328, 463-472)
- Types exported via barrel from `@ptah-extension/shared`: VERIFIED (shared/src/index.ts:1)
- All new fields are optional -- no breaking changes: VERIFIED

### Risks Identified

| Risk            | Severity | Mitigation                                                |
| --------------- | -------- | --------------------------------------------------------- |
| None identified | -        | Plan is straightforward plumbing with all-optional fields |

### Edge Cases to Handle

- [x] undefined thinking/effort should pass through as undefined (SDK applies its own defaults)
- [x] ChatContinueParams needs effort/thinking too (for mid-session changes)
- [x] Both SdkAgentAdapter and PtahCliAdapter resume paths need threading

---

## Batch 1: Backend Type Threading

**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: None
**Status**: IMPLEMENTED

### Task 1.1: Add ThinkingConfig and EffortLevel types to shared library

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 1

**Quality Requirements**:

- Types must be serializable (no functions) since they cross the RPC boundary
- ThinkingConfig is a discriminated union with `type` field
- EffortLevel is a string literal union
- Both fields added to AISessionConfig as optional readonly

**Implementation Details**:

- Add `ThinkingConfig` type union: `{ type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' }`
- Add `EffortLevel` type: `'low' | 'medium' | 'high' | 'max'`
- Add `thinking?: ThinkingConfig` and `effort?: EffortLevel` to `AISessionConfig` (after the `preset` field, line ~107)
- Include JSDoc comments matching the implementation plan
- No need to modify `libs/shared/src/index.ts` -- it already re-exports all from `ai-provider.types.ts`

---

### Task 1.2: Add thinking/effort to local SDK Options interface

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\types\sdk-types\claude-sdk.types.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 2
**Dependencies**: None (independent of Task 1.1)

**Quality Requirements**:

- Must match actual SDK types in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- Add after `includePartialMessages` field (around line 1587)

**Implementation Details**:

- Add `thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' }` to Options interface
- Add `effort?: 'low' | 'medium' | 'high' | 'max'` to Options interface
- Use inline types (matching SDK declaration style) rather than importing from shared

---

### Task 1.3: Thread thinking/effort through SdkQueryOptionsBuilder

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 3
**Dependencies**: Task 1.1 (needs ThinkingConfig/EffortLevel types)

**Quality Requirements**:

- Import ThinkingConfig and EffortLevel from `@ptah-extension/shared`
- Add to both `QueryOptionsInput` and `SdkQueryOptions` interfaces
- Thread through `build()` method

**Implementation Details**:

- Add `thinking?: ThinkingConfig` and `effort?: EffortLevel` to `QueryOptionsInput` interface (after `permissionMode` field, ~line 252)
- Add `thinking?: ThinkingConfig` and `effort?: EffortLevel` to `SdkQueryOptions` interface (after `compactionControl` field, ~line 288)
- In `build()` method, read from `sessionConfig?.thinking` and `sessionConfig?.effort` and include in returned options object (after `compactionControl`, ~line 458)
- Pattern to follow: same as how `permissionMode` is threaded (input -> destructure -> output)

---

### Task 1.4: Add thinking/effort to RPC types (ChatStartParams and ChatContinueParams)

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 6
**Dependencies**: Task 1.1 (needs ThinkingConfig/EffortLevel types)

**Quality Requirements**:

- Import ThinkingConfig and EffortLevel from the same file or from ai-provider.types
- Add to ChatStartParams.options object
- Add to ChatContinueParams (flat fields, matching its existing pattern)

**Implementation Details**:

- Import `ThinkingConfig, EffortLevel` from `./ai-provider.types`
- Add `thinking?: ThinkingConfig` and `effort?: EffortLevel` to `ChatStartParams.options` (after `preset`, ~line 75)
- Add `thinking?: ThinkingConfig` and `effort?: EffortLevel` to `ChatContinueParams` (after `images`, ~line 105)
- Include JSDoc comments with TASK_2025_184 reference

---

### Task 1.5: Thread thinking/effort in PtahCliAdapter.buildQueryOptions

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-adapter.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 5
**Dependencies**: Task 1.1, Task 1.3

**Quality Requirements**:

- Import ThinkingConfig and EffortLevel from `@ptah-extension/shared`
- Thread through buildQueryOptions input type, output, startChatSession caller, and resumeSession caller

**Implementation Details**:

- Add `thinking?: ThinkingConfig` and `effort?: EffortLevel` to `buildQueryOptions` input parameter type (~line 748)
- Include in returned `options` object (~line 861, after `compactionControl`)
- In `startChatSession` call to `buildQueryOptions` (~line 372), add: `thinking: config.thinking, effort: config.effort`
- In `resumeSession` call to `buildQueryOptions` (~line 460), add: `thinking: config?.thinking, effort: config?.effort`

---

### Task 1.6: Thread thinking/effort in ChatRpcHandlers

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 7
**Dependencies**: Task 1.1, Task 1.4

**Quality Requirements**:

- Extract thinking and effort from params.options (for chat:start)
- Pass to sdkAdapter.startChatSession config
- Handle chat:continue path too (flat fields from params)

**Implementation Details**:

- In `registerChatStart` handler (~line 699), extract `thinking` and `effort` from `options`:
  ```
  const thinking = options?.thinking;
  const effort = options?.effort;
  ```
- Pass to `this.sdkAdapter.startChatSession({ ...existing, thinking, effort })` (~line 699-713)
- Also pass in the PtahCliAdapter dispatch path (same handler, ptahCliId branch)
- In `registerChatContinue` handler, extract `thinking` and `effort` from `params` (flat fields) and pass to resume/continue calls

---

### Task 1.7: Thread effort in frontend MessageSenderService

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\message-sender.service.ts
**Action**: MODIFY
**Dependencies**: Task 1.4

**Quality Requirements**:

- Accept effort parameter in send methods
- Pass through to RPC calls (chat:start options and chat:continue flat params)
- No breaking changes to existing callers (effort is optional)

**Implementation Details**:

- Add `effort?: EffortLevel` parameter to `send()`, `sendOrQueue()`, `startNewConversation()`, and `continueConversation()` methods
- Import `EffortLevel` from `@ptah-extension/shared`
- In `startNewConversation`, include `effort` in the `options` object of the `chat:start` RPC call (~line 323-327)
- In `continueConversation`, include `effort` as a flat field in the `chat:continue` RPC call (~line 463-472)
- In `ChatStore.sendOrQueueMessage`, thread the effort parameter through to `messageSender.send()` (~line 388-423 in chat.store.ts)

**Note**: This task also requires a small modification to `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts` to pass effort through `sendOrQueueMessage`.

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build shared && npx nx build agent-sdk`
- Types are properly exported from `@ptah-extension/shared`
- Typecheck passes: `npx nx typecheck shared && npx nx typecheck agent-sdk`
- code-logic-reviewer approved
- All new fields are optional (no breaking changes)

---

## Batch 2: Frontend Effort Selector UI

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1
**Status**: IMPLEMENTED

### Task 2.1: Create EffortSelectorComponent - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\effort-selector.component.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Component 8
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\model-selector.component.ts

**Quality Requirements**:

- Standalone Angular component with OnPush change detection
- Signal-based state (no BehaviorSubject)
- Compact design matching model-selector button style
- DaisyUI + Tailwind classes only (no inline styles)
- Use `output()` API (not @Output decorator)
- Use `signal()` for local state

**Implementation Details**:

- Component selector: `ptah-effort-selector`
- A compact dropdown button (btn-ghost btn-xs) showing current effort level
- Options: "Default" (empty/undefined), "Low", "Medium", "High", "Max"
- Default selection: "" (empty string = undefined = SDK default which is "high")
- Use a simple `<select>` element styled with DaisyUI `select select-ghost select-xs` classes
- Output: `effortChanged = output<EffortLevel | undefined>()` that emits on change
- Internal signal: `selectedEffort = signal<EffortLevel | ''>('')`
- Import `EffortLevel` from `@ptah-extension/shared`

---

### Task 2.2: Integrate EffortSelector into ChatInputComponent - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts
**Action**: MODIFY
**Dependencies**: Task 2.1

**Quality Requirements**:

- Place effort selector near the model selector in the chat input bar
- Track selected effort in a signal
- Pass effort through when sending messages

**Implementation Details**:

- Import `EffortSelectorComponent` and add to `imports` array
- Add `<ptah-effort-selector (effortChanged)="onEffortChange($event)" />` near the model selector in the template
- Add internal signal: `private readonly _selectedEffort = signal<EffortLevel | undefined>(undefined)`
- Add handler: `onEffortChange(effort: EffortLevel | undefined): void { this._selectedEffort.set(effort); }`
- Modify `handleSend()` to pass effort to `chatStore.sendOrQueueMessage()`
- This requires `sendOrQueueMessage` to accept effort (done in Task 1.7)

---

### Task 2.3: Export EffortSelectorComponent from chat library - SKIPPED (subcomponents not exported)

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\index.ts
**Action**: MODIFY (if needed)
**Dependencies**: Task 2.1

**Quality Requirements**:

- Component should be exported if other modules need it
- Check if chat-input subcomponents are typically exported

**Implementation Details**:

- Check current exports in `libs/frontend/chat/src/index.ts`
- Add export for `EffortSelectorComponent` if subcomponents like `ModelSelectorComponent` are exported
- If subcomponents are NOT exported (kept internal), skip this task

---

**Batch 2 Verification**:

- Effort selector renders in chat input bar
- Selecting an effort level updates the signal
- Sending a message includes the effort in RPC params
- Default (no selection) passes undefined (SDK default behavior)
- Build passes: `npx nx build chat`
- code-logic-reviewer approved
