# Implementation Plan - TASK_2025_097

## Permission System UX & Performance Improvements

---

## Codebase Investigation Summary

### Libraries Discovered

1. **Permission System Backend** (`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`)

   - Key exports: `SdkPermissionHandler`, `PermissionRequest`, `PermissionResponse`
   - Implements `canUseTool` callback for SDK
   - 30-second timeout with auto-deny
   - Auto-approves safe tools (Read, Grep, Glob)
   - Requires user approval for dangerous tools (Write, Edit, Bash, NotebookEdit, MCP tools)

2. **Permission System Frontend** (`libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`)

   - Key exports: `PermissionHandlerService`
   - Manages `_permissionRequests` signal
   - Computes `unmatchedPermissions` for fallback display
   - Uses `_toolIdsCache` to track toolCallIds in execution tree

3. **Streaming Handler** (`libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`)

   - Processes flat streaming events from SDK
   - Stores events in StreamingState maps
   - Uses `requestAnimationFrame` for batched UI updates

4. **Execution Tree Builder** (`libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`)

   - Builds ExecutionNode tree from flat events at render time
   - Extracts `toolCallId` from tool nodes

5. **Tool Types** (`libs/shared/src/lib/type-guards/tool-input-guards.ts`)
   - `AskUserQuestionToolInput` interface with `questions` and `answers` fields
   - `QuestionItem` interface with `question`, `header`, `options`, `multiSelect`
   - Type guard: `isAskUserQuestionToolInput()`

### Patterns Identified

**Pattern 1: Permission Request/Response Flow**

- Evidence: `sdk-permission-handler.ts:278-363`, `permission-handler.service.ts:139-166`
- Backend emits `PERMISSION_REQUEST` via WebviewManager
- Frontend adds to `_permissionRequests` signal
- User responds via `PERMISSION_RESPONSE` message
- Backend resolves pending promise

**Pattern 2: Tool ID Correlation**

- Evidence: `permission-handler.service.ts:81-89`, `execution-node.component.ts:69`
- Permission has `toolUseId` (from Claude's tool_use)
- ExecutionNode has `toolCallId` (same value)
- Correlation: `permission.toolUseId === node.toolCallId`

**Pattern 3: Unmatched Permission Fallback**

- Evidence: `permission-handler.service.ts:112-126`, `chat-view.component.html:51-73`
- Permissions without matching tool nodes show in global fallback
- `_toolIdsCache` built from tab messages on tab change
- **Race condition**: Cache only updates on tab change, not streaming events

**Pattern 4: Streaming Event Processing**

- Evidence: `streaming-handler.service.ts:583-646`
- `tool_start` events contain `toolCallId`
- Events stored in `streamingState.events` Map
- `streamingState.toolCallMap` tracks tool call IDs

---

## Architecture Overview

### Current Flow (with Race Condition Bug)

```
1. SDK calls canUseTool() with toolUseID
2. Backend emits PERMISSION_REQUEST { id, toolName, toolInput, toolUseId }
3. Frontend receives permission, adds to _permissionRequests signal
4. Frontend checks if permission.toolUseId exists in _toolIdsCache
5. IF NOT in cache --> permission shows in FALLBACK (unmatchedPermissions)
6. Tool node arrives via streaming event --> adds to execution tree
7. _toolIdsCache ONLY updates on tab change (NOT streaming events!)
8. Result: Permission shows in BOTH fallback AND inline
```

### Fixed Flow

```
1. SDK calls canUseTool() with toolUseID
2. Backend emits PERMISSION_REQUEST { id, toolName, toolInput, toolUseId }
3. Frontend receives permission, adds to _permissionRequests signal
4. Frontend IMMEDIATELY checks streamingState.toolCallMap for toolCallId
5. IF toolCallId exists in toolCallMap OR current streaming events:
   --> Permission matched (show inline only)
6. ELSE IF tool_start arrives later:
   --> toolCallMap updates --> unmatchedPermissions recomputes --> removes from fallback
7. Result: Permission shows in ONE location only (inline preferred, fallback as safety net)
```

---

## Component Specifications

### Fix 1: Eliminate Race Condition in Permission Matching

**Purpose**: Ensure permissions match tools in real-time during streaming, not just on tab changes.

**Root Cause Analysis**:

- `PermissionHandlerService._toolIdsCache` is a `Set<string>` updated via `effect()` (lines 47-60)
- This effect ONLY triggers when `tabManager.activeTab()` changes
- During streaming, new tool_start events add toolCallIds to `streamingState.toolCallMap`
- But `_toolIdsCache` doesn't see these until tab switch or message finalization

**Solution**: Replace tab-based cache with real-time toolCallMap access.

**Pattern** (Evidence-Based):

- Source: `streaming-handler.service.ts:641-644` shows `state.toolCallMap.set(event.toolCallId, [...])`
- Source: `chat.store.ts:180-188` shows `currentExecutionTrees` computed signal reads from active tab's streamingState
- Pattern: Access `streamingState.toolCallMap` directly instead of caching

**Component Changes**:

**File**: `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`

**Responsibilities**:

1. Replace `_toolIdsCache` Set with computed signal that reads from streaming state
2. Watch BOTH finalized messages AND current streaming state
3. Re-compute `unmatchedPermissions` whenever streaming state changes

**Implementation Pattern**:

```typescript
// Pattern source: permission-handler.service.ts:47-60 (current effect)
// New pattern: Computed signal combining finalized messages AND streaming state

// BEFORE (Tab-change only):
private _toolIdsCache = new Set<string>();
constructor() {
  effect(() => {
    const activeTab = this.tabManager.activeTab();
    const messages = activeTab?.messages ?? [];
    this._toolIdsCache.clear();
    messages.forEach((msg) => {
      if (msg.streamingState) {
        this.extractToolIds(msg.streamingState, this._toolIdsCache);
      }
    });
  });
}

// AFTER (Real-time):
readonly toolIdsInExecutionTree = computed(() => {
  const activeTab = this.tabManager.activeTab();
  if (!activeTab) return new Set<string>();

  const toolIds = new Set<string>();

  // 1. Extract from finalized messages (historical)
  const messages = activeTab.messages ?? [];
  messages.forEach((msg) => {
    if (msg.streamingState) {
      this.extractToolIds(msg.streamingState, toolIds);
    }
  });

  // 2. Extract from current streaming state (real-time) - KEY FIX!
  const streamingState = activeTab.streamingState;
  if (streamingState?.toolCallMap) {
    for (const toolCallId of streamingState.toolCallMap.keys()) {
      toolIds.add(toolCallId);
    }
  }

  return toolIds;
});
```

**Quality Requirements**:

- Permissions must match within 1 frame of tool_start event arrival
- No duplicate permission display (inline AND fallback)
- Zero performance regression (computed signal is memoized)

**Files Affected**:

- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` (MODIFY)

---

### Fix 2: Performance Optimization with Timing Diagnostics

**Purpose**: Add timing logs to trace permission flow latency and identify bottlenecks.

**Pattern** (Evidence-Based):

- Source: `sdk-permission-handler.ts:164-168` shows existing logging pattern with structured data
- Source: `streaming-handler.service.ts:273-279` shows comprehensive diagnostic logging

**Component Changes**:

**File**: `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

**Add Timing Markers**:

```typescript
// Pattern source: sdk-permission-handler.ts:209-220
private async requestUserPermission(
  toolName: string,
  input: Record<string, unknown>,
  toolUseId?: string
): Promise<PermissionResult> {
  const startTime = Date.now();  // NEW: Timing start
  const requestId = this.generateRequestId();

  // ... existing code ...

  this.logger.info(`[SdkPermissionHandler] Permission request emitted`, {
    requestId,
    toolName,
    toolUseId,
    emitLatency: Date.now() - startTime,  // NEW: Emit latency
  });

  // ... await response ...

  this.logger.info(`[SdkPermissionHandler] Permission response received`, {
    requestId,
    totalLatency: Date.now() - startTime,  // NEW: Total latency
    approved: response.approved,
  });
}
```

**File**: `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`

**Add Frontend Timing**:

```typescript
// Pattern source: permission-handler.service.ts:140-145
handlePermissionRequest(request: PermissionRequest): void {
  const receiveTime = Date.now();
  console.log('[PermissionHandlerService] Permission request received:', {
    ...request,
    receiveLatency: request.timestamp ? receiveTime - request.timestamp : 'N/A',
  });
  this._permissionRequests.update((requests) => [...requests, request]);
}
```

**Quality Requirements**:

- Permission should appear in UI within 100ms of backend emission
- Timing logs must include requestId for correlation
- No performance impact from logging (use structured logging)

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (MODIFY)
- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` (MODIFY)

---

### Fix 3: Collapsed Badge UI for Global Permission Fallback

**Purpose**: Replace full-width warning section with compact notification badge that doesn't block chat area.

**Pattern** (Evidence-Based):

- Source: `status-badge.component.ts` - Existing badge component pattern
- Source: `tab-item.component.ts` - Badge with count indicator pattern
- Source: DaisyUI documentation - `btn-circle`, `badge`, `dropdown` classes

**Current Implementation** (chat-view.component.html:51-73):

```html
<!-- Full warning section - BLOCKS chat area -->
@if (chatStore.unmatchedPermissions().length > 0) {
<div class="px-4 pb-2 border-t border-warning/20 bg-warning/5">
  <div class="flex items-center gap-1 text-xs text-warning/80 mb-2 pt-2">
    <!-- Warning icon + message -->
  </div>
  @for (request of chatStore.unmatchedPermissions(); track request.id) {
  <ptah-permission-request-card ... />
  }
</div>
}
```

**New Component**: `permission-badge.component.ts`

**Component Specification**:

```typescript
/**
 * PermissionBadgeComponent - Collapsed notification badge for unmatched permissions
 *
 * Complexity Level: 2 (Molecule with dropdown behavior)
 * Patterns: Signal-based state, CDK overlay positioning
 *
 * Features:
 * - Compact badge with permission count (bottom-right, above input)
 * - Click to expand dropdown with permission cards
 * - Auto-collapse when all permissions resolved
 * - Does NOT block chat input area
 */
@Component({
  selector: 'ptah-permission-badge',
  standalone: true,
  imports: [PermissionRequestCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (permissions().length > 0) {
    <div class="fixed bottom-20 right-4 z-50">
      <!-- Badge button -->
      <button (click)="toggleExpanded()" class="btn btn-circle btn-warning btn-sm shadow-lg relative animate-pulse" [attr.aria-expanded]="isExpanded()" aria-label="Permission requests pending">
        <!-- Warning icon -->
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        <!-- Count badge -->
        <span class="badge badge-error badge-xs absolute -top-1 -right-1 min-w-4 h-4 text-[10px]">
          {{ permissions().length }}
        </span>
      </button>

      <!-- Expanded dropdown -->
      @if (isExpanded()) {
      <div
        class="absolute bottom-12 right-0 w-80 max-h-64 overflow-y-auto
               bg-base-200 rounded-lg shadow-xl border border-base-300 p-2 space-y-2"
        role="dialog"
        aria-label="Permission requests"
      >
        <div class="flex items-center justify-between px-2 pb-2 border-b border-base-300">
          <span class="text-xs font-medium text-warning"> {{ permissions().length }} permission{{ permissions().length > 1 ? 's' : '' }} pending </span>
          <button (click)="toggleExpanded()" class="btn btn-ghost btn-xs" aria-label="Close">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        @for (request of permissions(); track request.id) {
        <ptah-permission-request-card [request]="request" (responded)="onPermissionResponse($event)" />
        }
      </div>
      }
    </div>
    }
  `,
})
export class PermissionBadgeComponent {
  readonly permissions = input.required<PermissionRequest[]>();
  readonly responded = output<PermissionResponse>();

  protected readonly isExpanded = signal(false);

  protected toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }

  protected onPermissionResponse(response: PermissionResponse): void {
    this.responded.emit(response);
    // Auto-close if this was the last permission
    if (this.permissions().length <= 1) {
      this.isExpanded.set(false);
    }
  }
}
```

**Update chat-view.component.html**:

```html
<!-- REPLACE lines 51-73 with: -->
<!-- Collapsed Permission Badge (doesn't block chat area) -->
<ptah-permission-badge [permissions]="chatStore.unmatchedPermissions()" (responded)="chatStore.handlePermissionResponse($event)" />
```

**Quality Requirements**:

- Badge must be positioned bottom-right, above chat input (z-index 50)
- Badge must animate (pulse) to draw attention
- Dropdown must not exceed viewport (max-h-64, overflow-y-auto)
- Dropdown must close when clicking outside (future enhancement)
- Must be keyboard accessible (aria-expanded, aria-label)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/permission-badge.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (MODIFY)
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (MODIFY - add import)
- `libs/frontend/chat/src/lib/components/index.ts` (MODIFY - add export)

---

### Fix 4: AskUserQuestion Tool Handler Implementation

**Purpose**: Implement the SDK's AskUserQuestion tool for interactive user clarification during execution.

**SDK Documentation** (from claude-agentsdk-types.md:871-919):

- Tool enters `canUseTool` callback like any dangerous tool
- Input contains `questions` array with `question`, `header`, `options`, `multiSelect`
- Response must include `updatedInput.answers` mapping question text to selected option(s)
- Multi-select answers are comma-separated strings

**Pattern** (Evidence-Based):

- Source: `sdk-permission-handler.ts:196-266` shows canUseTool callback structure
- Source: `sdk-permission-handler.ts:278-363` shows user permission request/await pattern
- Source: `tool-input-guards.ts:225-254` shows AskUserQuestionToolInput interface
- Source: `sdk-permission-handler.ts:85-86` shows DANGEROUS_TOOLS list

**Component Specification**:

**File**: `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

**Implementation Pattern**:

```typescript
// Pattern source: sdk-permission-handler.ts:196-266 (createCallback)
createCallback(): CanUseTool {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: { /* ... */ toolUseID: string }
  ): Promise<PermissionResult> => {

    // EXISTING: Auto-approve safe tools
    if (SAFE_TOOLS.includes(toolName)) { /* ... */ }

    // NEW: Handle AskUserQuestion tool
    if (toolName === 'AskUserQuestion') {
      return await this.handleAskUserQuestion(input, options.toolUseID);
    }

    // EXISTING: Dangerous tools require user approval
    if (DANGEROUS_TOOLS.includes(toolName)) { /* ... */ }

    // EXISTING: MCP tools require user approval
    if (isMcpTool(toolName)) { /* ... */ }

    // EXISTING: Unknown tools default to deny
    // ...
  };
}

/**
 * Handle AskUserQuestion tool - prompt user with clarifying questions
 *
 * Unlike permission requests (approve/deny), AskUserQuestion expects
 * the user to SELECT answers from provided options.
 *
 * @param input - AskUserQuestionToolInput containing questions array
 * @param toolUseId - Tool use ID for correlation
 * @returns PermissionResult with updatedInput.answers populated
 */
private async handleAskUserQuestion(
  input: Record<string, unknown>,
  toolUseId: string
): Promise<PermissionResult> {
  // Import type guard
  if (!isAskUserQuestionToolInput(input)) {
    this.logger.warn('[SdkPermissionHandler] Invalid AskUserQuestion input', { input });
    return {
      behavior: 'deny' as const,
      message: 'Invalid AskUserQuestion input format',
    };
  }

  const requestId = this.generateRequestId();
  const now = Date.now();
  const timeoutAt = now + PERMISSION_TIMEOUT_MS;

  // Build request payload - similar to permission request but with questions
  const request: AskUserQuestionRequest = {
    id: requestId,
    toolName: 'AskUserQuestion',
    questions: input.questions,
    toolUseId,
    timestamp: now,
    timeoutAt,
  };

  this.logger.info('[SdkPermissionHandler] Sending AskUserQuestion request', {
    requestId,
    questionCount: input.questions.length,
    toolUseId,
  });

  // Send to webview - use different message type for questions
  this.webviewManager.sendMessage(
    'ptah.main',
    MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,  // NEW message type
    request
  );

  // Await user response (reuse existing mechanism with 30s timeout)
  const response = await this.awaitQuestionResponse(requestId, PERMISSION_TIMEOUT_MS);

  if (!response) {
    this.logger.warn('[SdkPermissionHandler] AskUserQuestion timed out', { requestId });
    return {
      behavior: 'deny' as const,
      message: 'Question request timed out',
    };
  }

  // Return with answers populated in updatedInput
  this.logger.info('[SdkPermissionHandler] AskUserQuestion answered', {
    requestId,
    answerCount: Object.keys(response.answers).length,
  });

  return {
    behavior: 'allow' as const,
    updatedInput: {
      ...input,
      answers: response.answers,  // KEY: Populate answers field
    },
  };
}
```

**New Types Required**:

**File**: `libs/shared/src/lib/types/message.types.ts`

```typescript
// NEW message types for AskUserQuestion
export const MESSAGE_TYPES = {
  // ... existing types ...
  ASK_USER_QUESTION_REQUEST: 'ask-user-question:request',
  ASK_USER_QUESTION_RESPONSE: 'ask-user-question:response',
};
```

**File**: `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (add interfaces)

```typescript
/**
 * AskUserQuestion request payload
 */
interface AskUserQuestionRequest {
  id: string;
  toolName: 'AskUserQuestion';
  questions: QuestionItem[];
  toolUseId?: string;
  timestamp: number;
  timeoutAt: number;
}

/**
 * AskUserQuestion response from webview
 */
interface AskUserQuestionResponse {
  id: string;
  answers: Record<string, string>; // question text -> selected option(s)
}

/**
 * Pending question request tracking
 */
interface PendingQuestionRequest {
  resolve: (response: AskUserQuestionResponse) => void;
  timer: NodeJS.Timeout;
}
```

**Frontend Components Required** (for AskUserQuestion UI):

**File**: `libs/frontend/chat/src/lib/components/molecules/question-card.component.ts` (CREATE)

```typescript
/**
 * QuestionCardComponent - Display AskUserQuestion prompts
 *
 * Similar to PermissionRequestCardComponent but for questions.
 * Supports single-select radio buttons and multi-select checkboxes.
 */
@Component({
  selector: 'ptah-question-card',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-info/10 border border-info/30 p-3">
      <!-- Header with timer -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-info" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
          </svg>
          <span class="text-xs font-medium text-info">Claude needs your input</span>
        </div>
        <span class="text-xs text-base-content/50">{{ timeRemaining() }}s</span>
      </div>

      <!-- Questions -->
      @for (question of request().questions; track question.header) {
      <div class="mb-3 last:mb-0">
        <p class="text-sm font-medium mb-2">{{ question.question }}</p>

        @if (question.multiSelect) {
        <!-- Multi-select: checkboxes -->
        @for (option of question.options; track option.label) {
        <label class="flex items-start gap-2 mb-1 cursor-pointer">
          <input type="checkbox" [value]="option.label" (change)="onOptionToggle(question.question, option.label, $event)" class="checkbox checkbox-sm checkbox-info mt-0.5" />
          <div>
            <span class="text-sm">{{ option.label }}</span>
            <p class="text-xs text-base-content/60">{{ option.description }}</p>
          </div>
        </label>
        } } @else {
        <!-- Single-select: radio buttons -->
        @for (option of question.options; track option.label) {
        <label class="flex items-start gap-2 mb-1 cursor-pointer">
          <input type="radio" [name]="'q-' + question.header" [value]="option.label" (change)="onOptionSelect(question.question, option.label)" class="radio radio-sm radio-info mt-0.5" />
          <div>
            <span class="text-sm">{{ option.label }}</span>
            <p class="text-xs text-base-content/60">{{ option.description }}</p>
          </div>
        </label>
        } }
      </div>
      }

      <!-- Submit button -->
      <button (click)="onSubmit()" [disabled]="!canSubmit()" class="btn btn-info btn-sm w-full mt-2">Submit Answers</button>
    </div>
  `,
})
export class QuestionCardComponent implements OnInit, OnDestroy {
  readonly request = input.required<AskUserQuestionRequest>();
  readonly answered = output<AskUserQuestionResponse>();

  protected readonly selectedAnswers = signal<Record<string, string>>({});
  protected readonly timeRemaining = signal(30);

  private timerInterval?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    // Countdown timer
    this.timerInterval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((this.request().timeoutAt - Date.now()) / 1000));
      this.timeRemaining.set(remaining);
      if (remaining <= 0) {
        clearInterval(this.timerInterval);
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  protected canSubmit = computed(() => {
    // Must have answer for each question
    const answers = this.selectedAnswers();
    return this.request().questions.every((q) => answers[q.question]?.length > 0);
  });

  protected onOptionSelect(question: string, option: string): void {
    this.selectedAnswers.update((a) => ({ ...a, [question]: option }));
  }

  protected onOptionToggle(question: string, option: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedAnswers.update((a) => {
      const current = a[question] || '';
      const options = current ? current.split(', ') : [];
      if (checked) {
        options.push(option);
      } else {
        const idx = options.indexOf(option);
        if (idx >= 0) options.splice(idx, 1);
      }
      return { ...a, [question]: options.join(', ') };
    });
  }

  protected onSubmit(): void {
    this.answered.emit({
      id: this.request().id,
      answers: this.selectedAnswers(),
    });
  }
}
```

**Quality Requirements**:

- AskUserQuestion must use same 30-second timeout as permissions
- Multi-select answers must be comma-separated strings
- UI must show all questions from the request
- Must support both single-select and multi-select modes
- Timer countdown must be visible

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (MODIFY)
- `libs/shared/src/lib/types/message.types.ts` (MODIFY - add message types)
- `libs/shared/src/lib/type-guards/tool-input-guards.ts` (no changes - types already exist)
- `libs/frontend/chat/src/lib/components/molecules/question-card.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` (MODIFY - add question handler)

---

## Integration Architecture

### Message Flow for Fix 1 (Real-time Cache)

```
streaming-handler.service.ts
  |
  | processStreamEvent(tool_start)
  |   --> state.toolCallMap.set(toolCallId, [...])
  |   --> scheduleTabUpdate(tabId, state)  // Batched via RAF
  |
  V
permission-handler.service.ts
  |
  | toolIdsInExecutionTree (computed signal)
  |   --> reads tabManager.activeTab().streamingState?.toolCallMap
  |   --> returns Set<string> of all toolCallIds
  |
  | unmatchedPermissions (computed signal)
  |   --> reads toolIdsInExecutionTree
  |   --> filters permissions where toolUseId NOT in toolIds
  |
  V
chat-view.component.html
  |
  | @if (chatStore.unmatchedPermissions().length > 0)
  |   --> Shows permission-badge (not full warning section)
```

### Message Flow for Fix 4 (AskUserQuestion)

```
SDK: canUseTool('AskUserQuestion', input, options)
  |
  V
sdk-permission-handler.ts
  |
  | handleAskUserQuestion(input, toolUseId)
  |   --> Sends ASK_USER_QUESTION_REQUEST to webview
  |   --> Awaits response (30s timeout)
  |
  V
webview (permission-handler.service.ts)
  |
  | handleQuestionRequest(request)
  |   --> Adds to _questionRequests signal
  |
  V
question-card.component.ts (or permission-badge with questions)
  |
  | User selects answers
  | onSubmit() --> answered.emit({ id, answers })
  |
  V
permission-handler.service.ts
  |
  | handleQuestionResponse(response)
  |   --> Sends ASK_USER_QUESTION_RESPONSE to backend
  |
  V
sdk-permission-handler.ts
  |
  | awaitQuestionResponse() resolves
  |   --> Returns { behavior: 'allow', updatedInput: { ...input, answers } }
  |
  V
SDK continues with answers populated
```

---

## Files Affected Summary

### CREATE

1. `libs/frontend/chat/src/lib/components/molecules/permission-badge.component.ts`

   - Collapsed notification badge for unmatched permissions

2. `libs/frontend/chat/src/lib/components/molecules/question-card.component.ts`
   - AskUserQuestion prompt card with option selection

### MODIFY

1. `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`

   - Replace `_toolIdsCache` with computed signal
   - Add timing diagnostics
   - Add question request handling (similar to permission handling)

2. `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

   - Add AskUserQuestion handler in `createCallback()`
   - Add timing logs to `requestUserPermission()`
   - Add `handleAskUserQuestion()` method
   - Add `awaitQuestionResponse()` method (similar to `awaitResponse()`)

3. `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

   - Replace full warning section (lines 51-73) with `<ptah-permission-badge>`

4. `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

   - Add `PermissionBadgeComponent` to imports

5. `libs/shared/src/lib/types/message.types.ts`

   - Add `ASK_USER_QUESTION_REQUEST` message type
   - Add `ASK_USER_QUESTION_RESPONSE` message type

6. `libs/frontend/chat/src/lib/components/index.ts`

   - Export `PermissionBadgeComponent`
   - Export `QuestionCardComponent`

7. `task-tracking/registry.md`

   - Update TASK_2025_063 status to SUPERSEDED

8. `task-tracking/TASK_2025_063/context.md`
   - Add superseded note pointing to TASK_2025_097

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both (frontend-developer AND backend-developer)

**Rationale**:

- Fix 1 (race condition): Frontend signal architecture (frontend-developer)
- Fix 2 (timing): Both backend logging and frontend timing (both)
- Fix 3 (badge UI): Pure frontend component (frontend-developer)
- Fix 4 (AskUserQuestion): Backend handler + frontend component (both)

**Suggested Split**:

- **Backend Developer**: Fix 2 (backend timing), Fix 4 (backend handler)
- **Frontend Developer**: Fix 1, Fix 3, Fix 4 (frontend components)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 9-14 hours

**Breakdown**:

- Fix 1 (Race Condition): 2-3 hours
- Fix 2 (Timing Diagnostics): 1-2 hours
- Fix 3 (Badge UI): 2-3 hours
- Fix 4 (AskUserQuestion): 3-4 hours
- Fix 5 (Legacy Cleanup): 1-2 hours

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `isAskUserQuestionToolInput` from `@ptah-extension/shared` (verified: tool-input-guards.ts:829)
   - `QuestionItem` from `@ptah-extension/shared` (verified: tool-input-guards.ts:235-244)
   - `PermissionRequest` from `@ptah-extension/shared` (verified: existing imports in permission-handler.service.ts)

2. **All patterns verified from examples**:

   - Computed signal pattern (permission-handler.service.ts:100)
   - Permission request/response pattern (sdk-permission-handler.ts:278-363)
   - Component with signal inputs (tool-call-item.component.ts:99-137)

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md` - SDK permission handling
   - `libs/frontend/chat/CLAUDE.md` - Component patterns

4. **No hallucinated APIs**:
   - All DaisyUI classes verified (btn-circle, badge, dropdown patterns in existing code)
   - All Angular APIs verified (signal, computed, input, output)
   - All message types from MESSAGE_TYPES constant

### Risk Mitigation

| Risk                                                            | Probability | Impact | Mitigation                                                             |
| --------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------- |
| Fix 1 breaks existing inline permissions                        | Low         | High   | Test with multiple tool types, verify inline display still works       |
| Fix 3 badge positioning conflicts with input                    | Low         | Medium | Use fixed positioning with z-index, test at different viewport sizes   |
| Fix 4 AskUserQuestion timeout handling differs from permissions | Medium      | Medium | Reuse existing awaitResponse pattern, same 30s timeout                 |
| Performance regression from computed signal in Fix 1            | Low         | Medium | Computed signals are memoized, only recompute when dependencies change |

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)

---

### Fix 5: Cleanup Legacy AskUserQuestion Implementation (TASK_2025_063)

**Purpose**: Remove incorrect legacy implementation plans that treated AskUserQuestion as an auto-approved tool with a separate handler.

**Background**:
TASK_2025_063 created an implementation plan that INCORRECTLY treated AskUserQuestion:

- **INCORRECT Approach (TASK_2025_063)**: Auto-approve AskUserQuestion in canUseTool, then have a separate `SdkQuestionHandler` class
- **CORRECT Approach (SDK docs)**: AskUserQuestion enters canUseTool callback like any dangerous tool, prompts user, returns answers in `updatedInput.answers`

**Legacy Artifacts to Review/Remove**:

1. **TASK_2025_063 Documentation** (`task-tracking/TASK_2025_063/`)

   - Contains incorrect implementation plans
   - Should be marked as SUPERSEDED by TASK_2025_097
   - Do NOT implement anything from this task's plans

2. **Potential Legacy Code** (if any was implemented):
   - Any `SdkQuestionHandler` class (separate from permission handler)
   - Any `ASK_USER_QUESTION` auto-approval logic in `sdk-permission-handler.ts`
   - Any `_questionHandlers` or similar separate handler registry

**Cleanup Actions**:

1. **Update TASK_2025_063 status** in registry.md:

   - Mark as "SUPERSEDED" or "CANCELLED"
   - Add note: "Superseded by TASK_2025_097 - AskUserQuestion handled via canUseTool callback per SDK docs"

2. **Verify no legacy code exists** in:

   - `libs/backend/agent-sdk/src/lib/` - Check for `SdkQuestionHandler` or similar
   - `libs/frontend/chat/src/lib/services/` - Check for separate question handler service

3. **If legacy code found**:
   - Remove any `SdkQuestionHandler` class
   - Remove any separate question handler registration
   - Remove any auto-approval logic for AskUserQuestion
   - Keep only the unified canUseTool approach from Fix 4

**Quality Requirements**:

- No duplicate handling paths for AskUserQuestion
- Single source of truth: canUseTool callback in SdkPermissionHandler
- TASK_2025_063 marked as superseded in registry

**Files Affected**:

- `task-tracking/registry.md` (MODIFY - update TASK_2025_063 status)
- `task-tracking/TASK_2025_063/context.md` (MODIFY - add superseded note)
- Any legacy files found during investigation (REMOVE if needed)

---

## Constraints Adherence

1. **DO NOT modify execution tree builder** (TASK_2025_096 just fixed it) - ADHERED

   - Fix 1 reads from `streamingState.toolCallMap`, doesn't modify tree builder

2. **Use existing DaisyUI components for badge UI** - ADHERED

   - Uses `btn-circle`, `badge`, `dropdown` patterns from DaisyUI

3. **Keep permission response format compatible** - ADHERED

   - Same `PermissionResponse` interface used
   - AskUserQuestion uses separate message type but same await pattern

4. **AskUserQuestion must use same timeout mechanism (30 seconds)** - ADHERED
   - Reuses `PERMISSION_TIMEOUT_MS` constant
   - Same `awaitResponse` pattern with timer and pending requests map
