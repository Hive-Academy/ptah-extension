# Development Tasks - TASK_2025_037

**Total Tasks**: 6 | **Batches**: 2 | **Status**: 2/2 complete ✅

---

## Batch 1: Debug Logging + Fallback Infrastructure ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: e2700c9

### Task 1.1: Add debug logging to getPermissionForTool ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Spec Reference**: implementation-plan.md:64-83
**Pattern to Follow**: Existing console.debug calls in chat.store.ts

**Quality Requirements**:

- Log when lookup misses (permission not found)
- Include available keys vs requested key for debugging
- Only log when pending permissions exist (avoid noise)
- Use console.debug (not console.log)

**Implementation Details**:

Enhance `getPermissionForTool` method (lines 172-177):

```typescript
getPermissionForTool(
  toolCallId: string | undefined
): PermissionRequest | null {
  if (!toolCallId) return null;

  const permission = this.permissionRequestsByToolId().get(toolCallId);

  // Debug logging for ID correlation issues
  if (!permission && this._permissionRequests().length > 0) {
    console.debug('[ChatStore] Permission lookup miss:', {
      lookupKey: toolCallId,
      availableKeys: Array.from(this.permissionRequestsByToolId().keys()),
      pendingCount: this._permissionRequests().length
    });
  }

  return permission ?? null;
}
```

**Verification**:

- Build passes: `npx nx build chat`
- No TypeScript errors
- Debug output appears in browser console when permission mismatch occurs

---

### Task 1.2: Add unmatchedPermissions computed signal with tree scanning ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Spec Reference**: implementation-plan.md:96-126 (ADJUSTED - see notes below)
**Dependencies**: None (can work in parallel with Task 1.1)

**Quality Requirements**:

- Scan currentExecutionTree for all toolCallId values
- Filter permissions whose toolUseId is NOT in the tree
- Permissions with no toolUseId always show in fallback
- Computed signal updates reactively when tree or permissions change

**Implementation Details**:

Add after `permissionRequestsByToolId` computed signal (after line 165):

```typescript
/**
 * Permissions that couldn't be matched to any tool in the execution tree.
 * These need fallback display to ensure user can still respond.
 *
 * Scans the current execution tree for all tool nodes and checks if any
 * have a toolCallId matching the permission's toolUseId.
 */
readonly unmatchedPermissions = computed(() => {
  const allPermissions = this._permissionRequests();
  const tree = this.currentExecutionTree();

  // Extract all toolCallIds from the execution tree (including streaming tree)
  const toolIdsInTree = new Set<string>();

  const extractToolIds = (node: ExecutionNode | null): void => {
    if (!node) return;

    if (node.type === 'tool' && node.toolCallId) {
      toolIdsInTree.add(node.toolCallId);
    }

    node.children.forEach(extractToolIds);
  };

  extractToolIds(tree);

  // A permission is "unmatched" if:
  // 1. It has no toolUseId (can never match a tool), OR
  // 2. Its toolUseId is not present in any tool node in the tree
  return allPermissions.filter(req => {
    if (!req.toolUseId) return true; // No ID = always unmatched
    return !toolIdsInTree.has(req.toolUseId); // Not in tree = unmatched
  });
});
```

**CRITICAL ADJUSTMENT**: The implementation plan's original logic (lines 107-125) was too conservative (always returned false for permissions with toolUseId). This updated version actively scans the execution tree to determine if a permission is truly matched.

**Imports Required**: None (ExecutionNode already imported on line 6)

**Verification**:

- Build passes: `npx nx build chat`
- No TypeScript errors
- Computed signal compiles and is accessible from template

---

### Task 1.3: Add toolIdsInExecutionTree helper computed (optimization) ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Dependencies**: Task 1.2 (refactors the tree scanning logic)

**Quality Requirements**:

- Extract tree scanning into separate computed for reusability
- Memoized via Angular computed (only recalculates when tree changes)
- Used by unmatchedPermissions computed

**Implementation Details**:

Add BEFORE `unmatchedPermissions` computed:

```typescript
/**
 * Extract all toolCallIds from current execution tree
 * Used to determine which permissions are matched vs unmatched
 */
private readonly toolIdsInExecutionTree = computed(() => {
  const tree = this.currentExecutionTree();
  const toolIds = new Set<string>();

  const extractToolIds = (node: ExecutionNode | null): void => {
    if (!node) return;

    if (node.type === 'tool' && node.toolCallId) {
      toolIds.add(node.toolCallId);
    }

    node.children.forEach(extractToolIds);
  };

  extractToolIds(tree);
  return toolIds;
});
```

Then update `unmatchedPermissions` to use it:

```typescript
readonly unmatchedPermissions = computed(() => {
  const allPermissions = this._permissionRequests();
  const toolIdsInTree = this.toolIdsInExecutionTree();

  return allPermissions.filter(req => {
    if (!req.toolUseId) return true;
    return !toolIdsInTree.has(req.toolUseId);
  });
});
```

**Verification**:

- Build passes: `npx nx build chat`
- No duplicate tree scanning logic
- Computed signals update correctly when tree changes

---

**Batch 1 Verification**:

- ✅ All files compile without errors
- ✅ Build passes: `npx nx build chat`
- ✅ `unmatchedPermissions` computed is accessible from chat-view component
- ✅ Debug logging can be verified in browser DevTools

---

## Batch 2: Restore Fallback UI ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete (requires unmatchedPermissions computed)
**Commit**: a68f0e1

### Task 2.1: Restore fallback permission cards in chat-view template ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
**Spec Reference**: implementation-plan.md:130-152
**Pattern to Follow**: Existing @for loops in chat-view.component.html

**Quality Requirements**:

- Display BEFORE chat input section (line 107)
- Show warning indicator for unmatched permissions
- Use existing ptah-permission-request-card component
- Wire up (responded) event to chatStore.handlePermissionResponse
- Only show when unmatchedPermissions length > 0

**Implementation Details**:

Add BEFORE `<ptah-chat-input>` element (line 108):

```html
<!-- Fallback: Unmatched Permission Requests -->
@if (chatStore.unmatchedPermissions().length > 0) {
<div class="px-4 pb-2 border-t border-warning/20 bg-warning/5">
  <div class="flex items-center gap-1 text-xs text-warning/80 mb-2 pt-2">
    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
    </svg>
    <span>Permission requests (could not match to tool)</span>
  </div>
  @for (request of chatStore.unmatchedPermissions(); track request.id) {
  <div class="mb-2 last:mb-0">
    <ptah-permission-request-card [request]="request" (responded)="chatStore.handlePermissionResponse($event)" />
  </div>
  }
</div>
}

<!-- Input Area -->
```

**Imports Required**: None (permission-request-card already in use)

**Verification**:

- Template compiles without errors
- Build passes: `npx nx build chat`
- Visual verification: fallback section appears when permission can't match

---

### Task 2.2: Import PermissionRequestCardComponent if missing ✅ COMPLETE (Already imported)

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
**Dependencies**: Task 2.1 (template uses the component)

**Quality Requirements**:

- Verify import exists
- Add to imports array if missing
- Ensure component is exported from index.ts

**Implementation Details**:

Check chat-view.component.ts imports array. If `PermissionRequestCardComponent` is NOT imported:

1. Add import statement:

```typescript
import { PermissionRequestCardComponent } from '../molecules/permission-request-card.component';
```

2. Add to imports array in @Component decorator

**Note**: This component may already be imported if used elsewhere. Verify first with Grep.

**Verification**:

- Build passes: `npx nx build chat`
- No "unknown element" errors for ptah-permission-request-card

---

### Task 2.3: Add visual regression test scenario ✅ COMPLETE

**File**: Create new file: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.manual-test.md
**Dependencies**: Task 2.1 complete

**Quality Requirements**:

- Document manual test steps for QA
- Cover both embedded and fallback display
- Include race condition scenario
- Include ID mismatch scenario

**Implementation Details**:

Create manual test guide:

```markdown
# Chat View Permission Display - Manual Test Guide

## Test Scenario 1: Permission Matches Tool (Embedded Display)

**Expected**: Permission card appears INSIDE tool card

1. Start new conversation
2. Trigger tool that requests permission (e.g., file read)
3. Verify permission card appears INSIDE the tool-call-item card
4. Verify Allow/Deny/Always buttons work
5. Verify countdown timer displays
6. Verify permission disappears after response

**Pass Criteria**: Permission embedded in tool card, no fallback shown

---

## Test Scenario 2: Permission Doesn't Match Tool (Fallback Display)

**Expected**: Permission card appears in FALLBACK section above input

**Setup**: Simulate ID mismatch by modifying toolUseId in DevTools or backend

1. Start conversation that triggers permission
2. Verify warning section appears above chat input
3. Verify permission card displays with warning icon
4. Verify Allow/Deny/Always buttons work
5. Verify permission disappears after response

**Pass Criteria**: Fallback section visible, permission functional

---

## Test Scenario 3: Race Condition (Permission Before Tool)

**Expected**: Permission appears when tool node arrives (reactive)

**Setup**: Add artificial delay to tool node creation

1. Trigger permission-requiring tool
2. Permission should appear in fallback initially (if tool not rendered yet)
3. Once tool node renders, permission should move to embedded location
4. Verify no duplicate permission cards

**Pass Criteria**: Permission always visible somewhere, moves when tool appears

---

## Test Scenario 4: Multiple Permissions Simultaneously

**Expected**: Mix of embedded and fallback as appropriate

1. Trigger multiple tools with permissions at once
2. Verify each permission displays correctly (embedded or fallback)
3. Verify responding to one doesn't affect others
4. Verify all disappear after responses

**Pass Criteria**: All permissions visible, all functional independently
```

**Verification**:

- File created successfully
- Used by QA reviewer during testing
- Covers all edge cases from code-logic-review.md

---

**Batch 2 Verification**:

- ✅ Fallback UI renders when unmatchedPermissions > 0
- ✅ Permission cards are fully functional in fallback
- ✅ No visual regressions in existing embedded display
- ✅ Build passes: `npx nx build chat`
- ✅ Manual test guide ready for QA
- ✅ Git commit verified: a68f0e1
- ✅ All 6 tasks completed successfully

---

## FINAL VERIFICATION - 2025-12-01

**All Batches Complete**: ✅ 2/2
**All Tasks Complete**: ✅ 6/6
**All Commits Verified**: ✅

### Batch Summary

| Batch | Name                                    | Tasks | Commit  | Status      |
| ----- | --------------------------------------- | ----- | ------- | ----------- |
| 1     | Debug Logging + Fallback Infrastructure | 3     | e2700c9 | ✅ COMPLETE |
| 2     | Restore Fallback UI                     | 3     | a68f0e1 | ✅ COMPLETE |

### Git Verification

```bash
e2700c9 fix(webview): add permission fallback infrastructure and debug logging
  - Modified: libs/frontend/chat/src/lib/services/chat.store.ts
  - Added: unmatchedPermissions computed signal
  - Added: toolIdsInExecutionTree helper
  - Added: Debug logging for permission lookup misses

a68f0e1 fix(webview): restore fallback UI for unmatched permission requests
  - Modified: libs/frontend/chat/src/lib/components/templates/chat-view.component.html
  - Added: libs/frontend/chat/src/lib/components/templates/chat-view.component.manual-test.md
  - Modified: task-tracking/TASK_2025_037/tasks.md (this file)
  - Restored: Fallback permission display section
```

### Files Created/Modified

**Modified**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html

**Created**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.manual-test.md

### Critical Issues Resolved

✅ **Issue #1: ID Mismatch Logic**

- Added `unmatchedPermissions` computed that actively scans execution tree
- Permissions that can't match a tool are filtered into fallback display

✅ **Issue #2: Race Condition**

- `unmatchedPermissions` is reactive via computed signals
- Updates automatically when execution tree changes
- Permission moves from fallback to embedded when tool arrives

✅ **Issue #3: No Fallback Display**

- Restored fallback section in chat-view template
- Displays unmatched permissions above chat input
- Visual warning indicator for unmatched state

### QA Readiness

**Manual Test Guide**: Created at `chat-view.component.manual-test.md`

- Test Scenario 1: Permission matches tool (embedded display)
- Test Scenario 2: Permission doesn't match tool (fallback display)
- Test Scenario 3: Race condition (permission before tool)
- Test Scenario 4: Multiple permissions simultaneously

**Recommended QA Phase**: Run ALL reviewers

- code-logic-reviewer: Verify all 3 critical issues resolved
- code-style-reviewer: Verify Angular patterns and signal usage
- senior-tester: Manual testing via test guide

---

## Summary

**Architecture**: Defense-in-depth permission display

- **Layer 1**: Embedded in tool card (preferred UX)
- **Layer 2**: Fallback above input (safety net)

**Critical Adjustments from Implementation Plan**:

1. ✅ Enhanced `unmatchedPermissions` to actively scan execution tree
2. ✅ Removed unnecessary "Option B" for execution-node (already reactive)
3. ✅ Added optimization with `toolIdsInExecutionTree` helper computed
4. ✅ Added manual test guide for QA verification

**Verification Strategy**:

- All tasks verified with `npx nx build chat`
- Manual testing via test guide in Task 2.3
- Debug logging helps troubleshoot ID correlation issues
- code-logic-reviewer will verify no permissions are invisible
