# Task Description - TASK_2025_097

## Title

Permission System Performance & UX Improvements

## Summary

Fix permission system issues causing duplicate rendering, massive delays, and missing AskUserQuestion tool support. Implement collapsed notification badge UI for global permission fallback.

## Problem Statement

When the SDK agent makes subsequent permission requests, users experience:

1. **Duplicate Permission Rendering**: Same permission shown twice - inline (correct) AND in global fallback section
2. **Massive Processing Delay**: Permissions take too long to process (possibly RPC or rendering related)
3. **Global Notification UX**: Fallback section expands fully, blocking the chat input area
4. **Missing AskUserQuestion Support**: The SDK's AskUserQuestion tool may not be properly implemented

## Root Cause Analysis

### Issue 1: Duplicate Permission Rendering

**Root Cause**: Race condition between permission arrival and execution tree building.

The permission flow has a timing dependency:

```
1. SDK sends permission request with toolUseId = "toolu_abc123"
2. Frontend receives permission, adds to _permissionRequests signal
3. Frontend tries to match permission.toolUseId to ExecutionNode.toolCallId
4. IF tool node not yet created → permission shows in FALLBACK (unmatchedPermissions)
5. Tool node created → permission ALSO shows INLINE
6. Result: BOTH displays show the same permission
```

**Code Flow**:

- `PermissionHandlerService._toolIdsCache` is built from tab messages via `effect()` (lines 47-60)
- This cache updates when `tabManager.activeTab()` changes
- BUT the tool node may be added to streaming state AFTER cache was built
- `unmatchedPermissions` computed signal (lines 112-126) checks if `toolUseId` is in cache
- If not in cache → permission is "unmatched" → shows in fallback

**Location**: `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`

### Issue 2: Processing Delay

**Potential Causes**:

1. RPC round-trip latency between extension and webview
2. Tree cache rebuild on every tab change
3. Signal recalculation cascading
4. Multiple permission requests arriving in quick succession

**Investigation Needed**: Add timing logs to trace the flow.

### Issue 3: Global Notification UX

**Current Behavior**: Full-size warning section with complete permission cards

**Desired Behavior**: Collapsed icon/badge that expands on click

**Location**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (lines 51-73)

### Issue 4: AskUserQuestion Tool

**Current State**: Types exist (`AskUserQuestionToolInput`, `AskUserQuestionToolOutput`) but handler may not be implemented.

**SDK Documentation**: AskUserQuestion enters `canUseTool` callback, expects answers returned in `updatedInput.answers`.

**Required Implementation**:

- Detect `toolName === 'AskUserQuestion'` in `canUseTool`
- Show question UI to user (similar to permission prompt)
- Return answers in the response

## Acceptance Criteria

### AC1: Single Permission Display

- [ ] Each permission request shows in ONLY ONE location (inline OR fallback, never both)
- [ ] Inline display takes priority when tool node exists
- [ ] Fallback only shows permissions that genuinely cannot be matched

### AC2: Performance Improvement

- [ ] Permission appears in UI within 100ms of backend emission
- [ ] No visible delay between permission request and UI display
- [ ] Add timing logs to measure RPC → render latency

### AC3: Collapsed Badge UI

- [ ] Global fallback section collapsed by default
- [ ] Small notification icon with badge counter in bottom-right corner
- [ ] Badge shows count of unmatched permissions
- [ ] Click/hover expands to show permission cards
- [ ] Does not block chat input area

### AC4: AskUserQuestion Support

- [ ] Detect AskUserQuestion tool in canUseTool callback
- [ ] Display question UI with options to user
- [ ] Support multi-select questions
- [ ] Return answers in updatedInput.answers format
- [ ] Timeout handling consistent with permission requests

## Technical Approach

### Fix 1: Eliminate Race Condition

**Option A**: Defer matching until tool node exists

- Wait a short delay (50-100ms) after permission arrives before checking unmatchedPermissions
- Risk: May still miss if tree building is slow

**Option B**: Real-time cache updates

- Update `_toolIdsCache` whenever streaming state changes (not just tab changes)
- Subscribe to streaming events to add new toolCallIds immediately
- Better: Ensures cache is always current

**Option C**: Move matching to render time

- Don't compute unmatchedPermissions in service
- Let components check at render time whether their tool has a permission
- Risk: May cause extra renders

**Recommended**: Option B - Real-time cache updates

### Fix 2: Performance Optimization

1. Add `console.time/timeEnd` markers at key points
2. Consider debouncing permission updates
3. Optimize cache lookup to O(1) with Map instead of Array.find()

### Fix 3: Collapsed Badge UI

```html
<!-- Replace current fallback section with collapsible badge -->
@if (chatStore.unmatchedPermissions().length > 0) {
<div class="absolute bottom-16 right-4">
  <button (click)="toggleUnmatchedPermissions()" class="btn btn-circle btn-warning btn-sm relative">
    <svg class="w-4 h-4"><!-- Warning icon --></svg>
    <span class="badge badge-error badge-sm absolute -top-1 -right-1"> {{ chatStore.unmatchedPermissions().length }} </span>
  </button>

  @if (showUnmatchedPermissions()) {
  <div class="absolute bottom-12 right-0 w-80 max-h-60 overflow-y-auto bg-base-200 rounded-lg shadow-lg p-2">
    @for (request of chatStore.unmatchedPermissions(); track request.id) {
    <ptah-permission-request-card [request]="request" (responded)="..." />
    }
  </div>
  }
</div>
}
```

### Fix 4: AskUserQuestion Implementation

```typescript
// In SdkPermissionHandler.createCallback()
if (toolName === 'AskUserQuestion') {
  const questions = input.questions as QuestionItem[];
  const answers = await this.promptUserQuestions(questions, options.toolUseID);

  return {
    behavior: 'allow',
    updatedInput: {
      questions,
      answers, // User-provided answers
    },
  };
}
```

## Files to Modify

### Backend

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`
  - Add AskUserQuestion handling
  - Add timing logs

### Frontend Services

- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`
  - Fix real-time cache updates
  - Add streaming state subscription

### Frontend Components

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
  - Replace fallback section with collapsed badge UI
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
  - Add toggle logic for collapsed badge

### New Components (if needed)

- `libs/frontend/chat/src/lib/components/molecules/permission-badge.component.ts`
  - Collapsed badge with count and expand functionality

### Types

- `libs/shared/src/lib/types/permission.types.ts`
  - Add QuestionRequest type (if AskUserQuestion uses different format)

## Dependencies

- No new external dependencies
- Uses existing DaisyUI components (badge, btn-circle)

## Testing Strategy

1. **Unit Tests**: Permission matching logic
2. **Integration Tests**: RPC round-trip timing
3. **Manual Tests**:
   - Rapid permission requests (5+ in quick succession)
   - Permission for tool that takes time to start
   - AskUserQuestion with single and multi-select

## Risk Assessment

| Risk                                 | Probability | Impact | Mitigation                     |
| ------------------------------------ | ----------- | ------ | ------------------------------ |
| Breaking existing inline permissions | Medium      | High   | Test with multiple tool types  |
| Performance regression               | Low         | Medium | Add timing metrics             |
| Badge UI clutters chat               | Low         | Low    | Position carefully, small size |

## Estimated Complexity

**Medium** - Involves coordination between backend and frontend, state management changes, and new UI component.

## Priority

**High** - Permission system is critical for user safety and UX. Duplicate display and delays cause confusion.
