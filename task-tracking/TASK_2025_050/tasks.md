# Development Tasks - TASK_2025_050

**Task Type**: Full-Stack (Shared + Backend + Frontend)
**Total Tasks**: 8
**Total Batches**: 3
**Batching Strategy**: Layer-based (Shared → Backend → Frontend)
**Status**: 1/3 batches complete (33%)

---

## Plan Validation Summary

**Validation Status**: ✅ PASSED

### Assumptions Verified

- ✅ `SdkAgentAdapter.setSessionModel()` exists at line 675 - Verified
- ✅ `SdkAgentAdapter.setSessionPermissionMode()` exists at line 703 - Verified
- ✅ `chat:abort` RPC already calls `sdkAdapter.interruptSession()` - Verified
- ✅ Lucide-angular pattern exists in codebase - Verified in multiple components

### Risks Identified

| Risk                                  | Severity | Mitigation                                |
| ------------------------------------- | -------- | ----------------------------------------- |
| SessionId null when no active session | LOW      | Backend handles gracefully with try/catch |
| Model apiName format may change       | LOW      | Centralized in AVAILABLE_MODELS           |

### Edge Cases to Handle

- [x] No active session when config changes → Backend logs warning, continues
- [x] SDK setModel/setPermissionMode fails → Config still saved, warn logged

---

## Batch 1: Shared Types ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 2
**Dependencies**: None
**Commit**: `23bea62`

### Task 1.1: Add apiName to ModelInfo Interface ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\model-autopilot.types.ts`
**Spec Reference**: implementation-plan.md:Component 2
**Pattern to Follow**: Same file, existing interface structure

**Quality Requirements**:

- ✅ Add `apiName: string` field to `ModelInfo` interface
- ✅ Add apiName values to each entry in `AVAILABLE_MODELS`
- ✅ Use correct SDK API model names (e.g., 'claude-sonnet-4-20250514')

**Implementation Details**:

- Interface change at lines 29-38
- Array update at lines 105-122
- ApiNames: opus='claude-opus-4-20250514', sonnet='claude-sonnet-4-20250514', haiku='claude-haiku-3-20240307'

---

### Task 1.2: Add sessionId to Config RPC Params ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: implementation-plan.md:Component 5
**Dependencies**: None

**Quality Requirements**:

- ✅ Add `sessionId?: SessionId | null` to `ConfigModelSwitchParams`
- ✅ Add `sessionId?: SessionId | null` to `ConfigAutopilotToggleParams`
- ✅ Import `SessionId` type if not already imported

**Implementation Details**:

- Optional field (won't break existing callers)
- Allows live sync to active session when provided

---

**Batch 1 Verification**:

- All 2 files modified at specified paths
- `npx nx typecheck shared`
- `npx nx lint shared`

---

## Batch 2: Backend SDK Sync 🔄 IN PROGRESS

**Assigned To**: backend-developer
**Tasks in Batch**: 1
**Dependencies**: Batch 1 complete ✅
**Estimated Commits**: 1

### Task 2.1: Add SDK Sync to Config RPC Handlers 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md:Component 3
**Pattern to Follow**: Existing handlers in same file

**Quality Requirements**:

- ✅ Import `AVAILABLE_MODELS` from `@ptah-extension/shared`
- ✅ In `config:model-switch`: lookup apiName via `AVAILABLE_MODELS.find()`
- ✅ In `config:model-switch`: call `sdkAdapter.setSessionModel()` if sessionId provided
- ✅ In `config:autopilot-toggle`: add `mapPermissionToSdkMode()` helper method
- ✅ In `config:autopilot-toggle`: call `sdkAdapter.setSessionPermissionMode()` if sessionId provided
- ✅ Wrap SDK calls in try/catch (log warning on failure, don't throw)

**Implementation Details**:

- Model switch handler at lines 555-586
- Autopilot toggle handler at lines 612-668
- Permission mapping: ask→'default', auto-edit→'acceptEdits', yolo→'bypassPermissions'

---

**Batch 2 Verification**:

- File modified at specified path
- `npx nx typecheck ptah-extension-vscode`
- `npx nx lint ptah-extension-vscode`

---

## Batch 3: Frontend Stop Button & SessionId ⏸️ PENDING

**Assigned To**: frontend-developer
**Tasks in Batch**: 5
**Dependencies**: Batch 1 complete
**Estimated Commits**: 1

### Task 3.1: Expose isStopping Signal in ChatStore ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
**Spec Reference**: implementation-plan.md:Component 1
**Pattern to Follow**: Same file line 135 (`readonly sessions = this._sessions.asReadonly()`)

**Quality Requirements**:

- ✅ Add `readonly isStopping = this._isStopping.asReadonly()` after line 128
- ✅ Signal already exists as private, just needs public accessor

---

### Task 3.2: Add Stop Button to ChatView Template ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
**Spec Reference**: implementation-plan.md:Component 1
**Pattern to Follow**: Same file existing button patterns

**Quality Requirements**:

- ✅ Add stop button visible when `chatStore.isStreaming()` is true
- ✅ Use lucide-angular Square icon (not raw SVG)
- ✅ Button disabled when `chatStore.isStopping()` is true
- ✅ Show loading spinner when stopping
- ✅ Add aria-label for accessibility

---

### Task 3.3: Import Lucide Icons in ChatView Component ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
**Spec Reference**: implementation-plan.md:Component 1
**Pattern to Follow**: app-shell.component.ts lines 13-15

**Quality Requirements**:

- ✅ Import `LucideAngularModule, Square` from 'lucide-angular'
- ✅ Add `LucideAngularModule` to component imports
- ✅ Add `readonly SquareIcon = Square` property

---

### Task 3.4: Pass SessionId in ModelStateService ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\model-state.service.ts`
**Spec Reference**: implementation-plan.md:Component 4
**Pattern to Follow**: Existing RPC call pattern in same file

**Quality Requirements**:

- ✅ Get `currentSessionId()` from ChatStore (inject if needed)
- ✅ Add sessionId to `config:model-switch` RPC call params

---

### Task 3.5: Pass SessionId in AutopilotStateService ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\autopilot-state.service.ts`
**Spec Reference**: implementation-plan.md:Component 4
**Pattern to Follow**: Existing RPC call pattern in same file

**Quality Requirements**:

- ✅ Get `currentSessionId()` from ChatStore (inject if needed)
- ✅ Add sessionId to `config:autopilot-toggle` RPC call params

---

**Batch 3 Verification**:

- All 5 files modified at specified paths
- `npx nx typecheck ptah-extension-webview`
- `npx nx lint chat core`

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively
4. Developer creates ONE commit for entire batch
5. Team-leader verifies and approves
6. Next batch assigned

**Commit Messages**:

- Batch 1: `feat(deps): add apiName to ModelInfo and sessionId to config RPC types`
- Batch 2: `feat(vscode): add live SDK sync for model and permission changes`
- Batch 3: `feat(webview): add stop button UI and sessionId to config calls`

**Build Verification Commands**:

```bash
npx nx typecheck shared
npx nx typecheck ptah-extension-vscode
npx nx typecheck ptah-extension-webview
npx nx lint shared chat core
```
