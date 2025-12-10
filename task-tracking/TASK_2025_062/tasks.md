# Development Tasks - TASK_2025_062

**Task Type**: Full-Stack (Shared Types + Frontend + Backend)
**Total Tasks**: 8
**Total Batches**: 3
**Batching Strategy**: Phase-based (Model → Files → Images)
**Status**: 3/3 batches complete (100%)

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- ✅ SDK `SDKUserMessage.content` accepts `string | ContentBlock[]` - Verified in session-lifecycle-manager.ts:38
- ✅ Frontend `ModelStateService.currentModel()` returns full API model name - Verified in model-state.service.ts
- ✅ RPC layer properly receives and forwards params - Verified in rpc-method-registration.service.ts

### Risks Identified

| Risk                                                      | Severity | Mitigation                                          |
| --------------------------------------------------------- | -------- | --------------------------------------------------- |
| Frontend change detection may not trigger on model change | LOW      | Using signal injection, not manual subscription     |
| Large images may exceed message size limits               | MED      | Phase 3 adds size validation before base64 encoding |

### Edge Cases to Handle

- [ ] Model is empty string → Fall back to config default → Task 1.3
- [ ] Files array is undefined vs empty → Handle both in backend → Task 2.3
- [ ] Image read fails (permissions) → Graceful fallback to text-only → Task 3.1

---

## Batch 1: Model Flow ✅ COMPLETE

**Developer**: frontend-developer (primary) + shared types
**Tasks**: 3
**Dependencies**: None
**Estimated Commits**: 1

### Task 1.1: Update RPC Types for Model ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: implementation-plan.md:90-101

**Changes Required**:

- Add `model?: string` to `ChatContinueParams` interface (line ~41-48)
- Add `model?: string` to `ChatStartParams.options` if not already present

**Quality Requirements**:

- ✅ Type exports unchanged (no breaking changes)
- ✅ All existing consumers still compile
- ✅ Optional field (backward compatible)

**Expected Commit Pattern**: `feat(webview): add model field to chat RPC params`

---

### Task 1.2: Frontend - Pass Model in RPC Calls ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\message-sender.service.ts`
**Spec Reference**: implementation-plan.md:103-106
**Pattern to Follow**: `model-state.service.ts` for signal injection

**Changes Required**:

1. Inject `ModelStateService` at class level
2. In `startNewConversation()` (~line 252): Pass `model: this.modelState.currentModel()` in options
3. In `continueConversation()` (~line 380): Pass `model: this.modelState.currentModel()` in params

**Quality Requirements**:

- ✅ Signal access (not subscription) - uses `currentModel()` not `.subscribe()`
- ✅ Model passed in BOTH chat:start and chat:continue
- ✅ Existing tests still pass

**Implementation Details**:

- Import: `import { ModelStateService } from '@ptah-extension/core';`
- Inject: `private readonly modelState = inject(ModelStateService);`

---

### Task 1.3: Backend - Read Model from Params ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md:107-110

**Changes Required**:

1. In `chat:start` handler: Use `options?.model` if provided, else fall back to config
2. In `chat:continue` handler: Use `params.model` if provided, else fall back to config
3. Remove unused imports `AVAILABLE_MODELS` and `ModelInfo` (lint fix)

**Quality Requirements**:

- ✅ Model from frontend takes priority over config
- ✅ Config fallback still works if frontend doesn't send model
- ✅ Lint errors resolved

**Edge Case**: If `model` is empty string, treat as undefined (use config)

---

**Batch 1 Verification**:

- ✅ All 3 files modified at specified paths
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ Typecheck passes: `npx nx run-many --target=typecheck --projects=shared,chat`
- ✅ Lint passes (unused import warnings fixed)

---

## Batch 2: Files/Folders Flow ✅ COMPLETE

**Developer**: frontend-developer + backend-developer
**Tasks**: 3
**Dependencies**: Batch 1 complete
**Estimated Commits**: 1

### Task 2.1: Update RPC Types for Files ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`

**Changes Required**:

- Add `files?: string[]` to `ChatStartParams.options`
- Add `files?: string[]` to `ChatContinueParams`

---

### Task 2.2: Frontend - Pass Files in RPC Calls ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\message-sender.service.ts`

**Changes Required**:

1. In `startNewConversation()`: Always include files in options object
2. In `continueConversation()`: Pass files in params
3. Ensure empty array `[]` is passed when no files (not undefined)

---

### Task 2.3: Backend - Forward Files to SDK ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts`

**Changes Required**:

1. Extract `files` from params in both handlers
2. Log files received for debugging
3. (Note: Actual file content is handled in Phase 3)

---

**Batch 2 Verification**:

- ✅ All 3 files modified
- ✅ Build passes
- ✅ Files array visible in backend logs when sent from frontend

---

## Batch 3: Image Support ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 2
**Dependencies**: Batch 2 complete
**Estimated Commits**: 1

### Task 3.1: Create Image Converter Service ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\image-converter.service.ts` [NEW]

**Changes Required**:

1. Create injectable service with `convertToContentBlocks(text, files)` method
2. Detect image files by extension (.png, .jpg, .jpeg, .gif, .webp)
3. Read image, convert to base64, wrap in ContentBlock
4. Handle read errors gracefully (skip failed images, log warning)
5. Add size validation (max 5MB per image)

**Pattern to Follow**: `auth-manager.ts` for injectable service structure

---

### Task 3.2: Integrate Image Converter in SDK Adapter ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`

**Changes Required**:

1. Inject `ImageConverterService`
2. In `sendMessageToSession()`: Check if files contain images
3. If images present: Use `ContentBlock[]` for message content
4. If no images: Use plain string (existing behavior)

---

**Batch 3 Verification**:

- ✅ New service file created
- ✅ Service registered in DI tokens
- ✅ Build passes
- ✅ Image paths converted to base64 in SDK message content

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (`git add` after each task)
4. Developer creates ONE commit for entire batch
5. Developer returns with batch git commit SHA
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified
- All files exist
- Build passes
